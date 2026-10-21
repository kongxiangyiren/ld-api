import { ofetch, type $Fetch } from 'ofetch';
import type { GenerateImageParams } from './type';

// ── SSE response types ──

export interface ProgressEvent {
  type: 'progress';
  step: number;
  total_steps: number;
  /** @description base64 编码的中间过程预览图，仅在 show_diffusion_process 开启且运行时支持时存在 */
  image?: string;
  /** @description 预览图编码格式，当前固定为 `raw`（原始 RGB 像素） */
  format?: 'raw';
}

export interface CompleteEvent {
  type: 'complete';
  /** @description base64 编码的原始 RGB 像素字节（channels = 3） */
  image: string;
  seed: number;
  width: number;
  height: number;
  channels: 3;
  /** @description 结果图编码格式，当前固定为 `raw`（原始 RGB 像素） */
  format?: 'raw';
  generation_time_ms: number;
  first_step_time_ms: number;
}

export interface ErrorEvent {
  type: 'error' | 'request_error';
  message: string;
}

export type SSEEvent = ProgressEvent | CompleteEvent | ErrorEvent;

export interface GenerateImageResult extends CompleteEvent {}

export interface TokenizeResult {
  count: number;
  max_length: number;
  /** @description 提示词超出 77 token 上限时的溢出偏移，未溢出为 -1 */
  overflow_offset: number;
}

export interface GenerateImageOptions {
  /** @description 每次 progress 事件的回调 */
  onProgress?: (event: ProgressEvent) => void;
  /** @description 取消本次生成（中断 SSE 流） */
  signal?: AbortSignal;
}

// ── Client ──

/** 生成 API 客户端，对应 `127.0.0.1:8081`（App 内「HTTP API」开关，需先选定模型）。 */
export class LdApi {
  private $fetch: $Fetch;

  constructor(baseURL: string, timeout = 30000) {
    // retry: false 与旧版 axios 行为一致，ofetch 默认会给 GET 重试一次
    this.$fetch = ofetch.create({ baseURL, timeout, retry: false });
  }

  /** 统计提示词在模型 77-token CLIP 上限下的 token 数。 */
  async tokenize(prompt: string, signal?: AbortSignal): Promise<TokenizeResult> {
    return this.$fetch<TokenizeResult>('/tokenize', { method: 'POST', body: { prompt }, signal });
  }

  /** 执行一次生成，通过 Server-Sent Events 流式接收进度与结果。 */
  async generateImage(
    params: GenerateImageParams,
    options?: GenerateImageOptions
  ): Promise<GenerateImageResult> {
    const response = await this.$fetch.raw('/generate', {
      method: 'POST',
      body: params,
      headers: { accept: 'text/event-stream' },
      responseType: 'stream',
      ignoreResponseError: true,
      signal: options?.signal
    });

    const stream = response._data;
    const contentType = response.headers.get('content-type') || '';

    // 请求侧错误时后端返回非流式的 JSON 错误体（HTTP 400 / 500）
    if (!contentType.includes('text/event-stream')) {
      throw toErrorEvent(stream ? await readText(stream) : '', response.status);
    }

    if (!stream) throw errorEvent('request_error', `HTTP ${response.status}: empty body`);

    return readSSE(stream, options?.onProgress);
  }
}

// ── Private helpers ──

function errorEvent(type: ErrorEvent['type'], message: string): ErrorEvent {
  return { type, message };
}

/** 把非流式的错误响应体转换成 ErrorEvent。 */
function toErrorEvent(body: string, status: number): ErrorEvent {
  try {
    const payload = JSON.parse(body);
    const error = payload?.error;
    if (error && typeof error === 'object' && typeof error.message === 'string') {
      return errorEvent(error.type ?? 'request_error', error.message);
    }
    if (typeof error === 'string') return errorEvent('request_error', error);
  } catch {
    // 不是 JSON，走下面的兜底
  }
  return errorEvent('request_error', `HTTP ${status}: ${body}`);
}

/** 读完整个流，用于非 SSE 的错误响应体。 */
async function readText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/** 按 SSE 行协议解析 `/generate` 的响应流，resolve 第一个 complete 事件。 */
function readSSE(
  stream: ReadableStream<Uint8Array>,
  onProgress?: (event: ProgressEvent) => void
): Promise<GenerateImageResult> {
  return new Promise((resolve, reject) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let settled = false;

    // 落定后立刻取消底层流，避免连接继续下载
    const settle = (done: () => void) => {
      if (settled) return;
      settled = true;
      done();
      reader.cancel().catch(() => {});
    };

    const pump = (): void => {
      reader.read().then(
        ({ done, value }) => {
          if (settled) return;
          if (done) {
            settle(() => reject(new Error('Stream ended without completion event')));
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const event = parseLine(line);
            if (!event) continue;
            if (event.type === 'progress') {
              onProgress?.(event);
            } else if (event.type === 'complete') {
              settle(() => resolve(event));
              break;
            } else if (event.type === 'error' || event.type === 'request_error') {
              settle(() => reject(event));
              break;
            }
          }

          if (!settled) pump();
        },
        error => settle(() => reject(error))
      );
    };

    pump();
  });
}

/** 解析单行 SSE，只关心 `data:` 负载。 */
function parseLine(line: string): SSEEvent | undefined {
  const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (!trimmed.startsWith('data:')) return;
  const content = trimmed.slice(5).trim();
  if (!content || content === '[DONE]') return;
  try {
    return JSON.parse(content) as SSEEvent;
  } catch {
    return;
  }
}
