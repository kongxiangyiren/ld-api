// ── Base shared fields ──

interface BaseParams {
  /**
   * @description 正向提示词
   * @example "a photo of an astronaut riding a horse on mars"
   */
  prompt: string;
  /**
   * @description 反向提示词
   * @default ""
   * @example "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry"
   */
  negative_prompt?: string;
  /**
   * @description 采样步数
   * @default 20
   */
  steps?: number;
  /**
   * @description CFG 系数。在 NPU 模式下，cfg == 1.0 会触发跳过无条件 UNet 计算的优化。
   * @default 7.5
   */
  cfg?: number;
  /**
   * @description 随机种子。
   * @default -1
   * @example 42
   */
  seed?: number;
  /**
   * @description 采样方法
   * @default 'dpm'
   * 
   * `dpm`: `DPM++ 2M Karras`
   *
   * `dpm_karras`: `DPM++ 2M + Karras`
   *
   * `dpm_sde`: `DPM++ 2M SDE`
   *
   * `dpm_sde_karras`: `DPM++ 2M SDE + Karras`
   *
   * `euler_a` | `eulera`: `Euler A`
   *
   * `euler_a_karras`: `Euler A + Karras`
   *
   * `euler`: `Euler`
   *
   * `euler_karras`: `Euler + Karras`
   *
   * `lcm`: `LCM`
   */
  scheduler?:
    | 'dpm'
    | 'dpm_karras'
    | 'dpm_sde'
    | 'dpm_sde_karras'
    | 'euler_a'
    | 'eulera'
    | 'euler_a_karras'
    | 'euler'
    | 'euler_karras'
    | 'lcm';

  /**
   * @description 仅 CPU 模式有效
   * @description 会把 MNN 计算后端切换到 GPU 上的 OpenCL。每个分辨率首次运行会生成缓存因此较慢，之后同分辨率的运行会快很多。
   * @default false
   */
  use_opencl?: boolean;

  /**
   * @description 仅 SDXL NPU 模式生效。两个正整数 W:H（如 "3:4"、"16:9"）。长边为 1024，短边按比例计算后向上取整到 8 的倍数。其他模式下被忽略。
   * @default "1:1"
   * @see https://ld-guide.chino.icu/zh/models/sdxl-aspect-ratio
   */
  aspect_ratio?: string;
}

// ── Rule 1, 2, 3: size 与 width/height 互斥，width/height 必须成对出现，size 优先级更高 ──

type DimensionParams =
  | {
      /**
       * @description 正方形输出的快捷写法。若提供，会覆盖 width / height。
       * @default 512
       */
      size: number;
      width?: never;
      height?: never;
    }
  | {
      size?: never;
      /**
       * @description 宽度。仅在未提供 size 时生效。
       * @default 512
       */
      width: number;
      /**
       * @description 高度。仅在未提供 size 时生效。
       * @default 512
       */
      height: number;
    }
  | {
      size?: never;
      width?: never;
      height?: never;
    };

// ── Rule 5: mask 或 denoise_strength 存在时 image 必填 ──

type ImageParams =
  | {
      /**
       * @description Base64 编码的 PNG/JPG 字节。一旦提供，本次运行切换为 img2img。
       */
      image: string;
      /**
       * @description Base64 编码的 PNG/JPG 蒙版字节。必须与 image 同时提供，提供时切换为 inpaint。
       */
      mask?: string;
      /**
       * @description img2img / inpaint 的去噪强度。
       * @default 0.6
       */
      denoise_strength?: number;
    }
  | {
      /**
       * @description Base64 编码的 PNG/JPG 字节。一旦提供，本次运行切换为 img2img。
       */
      image?: string;
      mask?: never;
      denoise_strength?: never;
    };

// ── Rule 4: show_diffusion_stride 存在时 show_diffusion_process 必填 true ──

type DiffusionProcessParams =
  | {
      /**
       * @description 开启后，每个 progress 事件附带一张中间过程预览图（仅在运行时支持时）。
       * @default false
       */
      show_diffusion_process: true;
      /**
       * @description 每 N 步发送一次预览。仅在 show_diffusion_process 为 true 时有意义。
       * @default 1
       */
      show_diffusion_stride?: number;
    }
  | { show_diffusion_process?: false; show_diffusion_stride?: never };

// ── Final type ──

export type GenerateImageParams = BaseParams &
  DimensionParams &
  ImageParams &
  DiffusionProcessParams;
