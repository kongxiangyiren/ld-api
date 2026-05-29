import axios, { type AxiosInstance } from 'axios';
import type { GenerateImageParams } from './type';

// ── SSE response types ──

export interface ProgressEvent {
  type: 'progress';
  step: number;
  total_steps: number;
  /** base64 intermediate image preview, only present when show_diffusion_process is enabled */
  image?: string;
}

export interface CompleteEvent {
  type: 'complete';
  /** base64-encoded raw RGB pixel bytes (channels = 3) */
  image: string;
  seed: number;
  width: number;
  height: number;
  channels: 3;
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
}

export interface GenerateImageOptions {
  onProgress?: (event: ProgressEvent) => void;
}

// ── Client ──

export class LdApi {
  private $axios: AxiosInstance;

  constructor(baseURL: string, timeout = 30000) {
    this.$axios = axios.create({ baseURL, timeout });
  }

  /** Count prompt tokens against the model's 77-token CLIP cap. */
  async tokenize(prompt: string, signal?: AbortSignal): Promise<TokenizeResult> {
    const { data } = await this.$axios.post<TokenizeResult>('/tokenize', { prompt }, { signal });
    return data;
  }

  /** Run image generation and stream results via Server-Sent Events. */
  async generateImage(
    params: GenerateImageParams,
    options?: GenerateImageOptions
  ): Promise<GenerateImageResult> {
    const response = await this.$axios.post('/generate', params, {
      responseType: 'stream',
      headers: { Accept: 'text/event-stream' },
      validateStatus: status => status < 500
    });
    // console.log(response.data);
    // Non-streaming error response (HTTP 400/500)
    const contentType = (response.headers['content-type'] as string) || '';
    if (!contentType.includes('text/event-stream')) {
      const body = await this.readStream(response.data);

      if (contentType.includes('application/json')) {
        return Promise.reject(JSON.parse(body).error as ErrorEvent);
      }

      throw new Error(`HTTP ${response.status}: ${body}`);
    }

    return this.parseSSEStream(response.data, options?.onProgress);
  }

  // ── Private helpers ──

  private readStream(stream: NodeJS.ReadableStream): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      stream.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf-8');
      });
      stream.on('end', () => resolve(body));
      stream.on('error', reject);
    });
  }

  private parseSSEStream(
    stream: NodeJS.ReadableStream,
    onProgress?: (event: ProgressEvent) => void
  ): Promise<GenerateImageResult> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      let settled = false;

      const onError = (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      stream.on('data', (chunk: Buffer) => {
        if (settled) return;
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.replace(/\r$/, '');
          if (!trimmed) continue;
          if (!trimmed.startsWith('data: ')) continue;

          const content = trimmed.slice(6);
          if (content === '[DONE]') continue;

          let msg: SSEEvent;
          try {
            msg = JSON.parse(content);
          } catch {
            continue;
          }

          if (msg.type === 'progress') {
            onProgress?.(msg);
          } else if (msg.type === 'complete') {
            settled = true;
            resolve(msg);
          } else if (msg.type === 'error') {
            settled = true;
            reject(msg);
          }
        }
      });

      stream.on('error', onError);
      stream.on('end', () => {
        if (!settled) {
          settled = true;
          reject(new Error('Stream ended without completion event'));
        }
      });
    });
  }
}

export type { GenerateImageParams } from './type';
