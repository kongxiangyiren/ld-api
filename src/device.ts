import { ofetch, type $Fetch } from 'ofetch';
import type { Scheduler } from './type';

// ── Response types ──

export interface Info {
  app: 'localdream';
  version: string;
  protocol: 1;
  device: string;
}

export interface Module {
  id: string;
  name: string;
  description: string;
  run_on_cpu: boolean;
  is_sdxl: boolean;
  is_anima: boolean;
  dit_kind: string;
  is_custom: boolean;
  generation_size: number;
  defaults: {
    prompt: string;
    negative_prompt: string;
    steps: number;
    cfg: number;
    scheduler: Scheduler;
  };
  resolutions: Array<[number, number]> | [];
}

export interface Models {
  use_img2img: boolean;
  models: Array<Module>;
  upscalers: any[];
}

export interface SelectResult {
  ok: boolean;
}

export interface Status {
  serving_model_id: string | null;
  state: 'idle' | 'starting' | 'running' | 'error';
  message: string | null;
  error_model_id: string | null;
  width: number | null;
  height?: number | null;
}

export interface StopResult {
  ok: boolean;
  ignored?: boolean;
}

// ── Client ──

/** 设备互连客户端，对应 `127.0.0.1:8808`（App 内「设备互联」开关，2.8.1+）。 */
export class LdDeviceApi {
  private $fetch: $Fetch;

  constructor(baseURL: string, timeout = 30000) {
    // retry: false 与旧版 axios 行为一致，ofetch 默认会给 GET 重试一次
    this.$fetch = ofetch.create({ baseURL, timeout, retry: false });
  }

  /** 设备与后端版本信息。 */
  async getInfo(): Promise<Info> {
    return this.$fetch<Info>('/info');
  }

  /** 本机可用模型列表。 */
  async getModels(): Promise<Models> {
    return this.$fetch<Models>('/models');
  }

  /** 加载模型并指定分辨率。NPU 模式下生成尺寸必须与此处一致。 */
  async selectModel(model_id: string, width: number, height: number): Promise<SelectResult> {
    return this.$fetch<SelectResult>('/select', {
      method: 'POST',
      body: { model_id, width, height }
    });
  }

  /** 当前后端状态。 */
  async getStatus(): Promise<Status> {
    return this.$fetch<Status>('/status');
  }

  /** 停止正在服务的模型；未在服务时返回 `ignored: true`。 */
  async stop(model_id: string): Promise<StopResult> {
    return this.$fetch<StopResult>('/stop', { method: 'POST', body: { model_id } });
  }
}
