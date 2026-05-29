# @kongxiangyiren/ld-api

本地扩散模型（Local Diffusion）HTTP API 的 Node.js / TypeScript 客户端，支持文生图、图生图、inpaint 以及扩散过程预览。

## 安装

```bash
npm install @kongxiangyiren/ld-api
```

## 快速开始

```ts
import { LdApi } from '@kongxiangyiren/ld-api';
import sharp from 'sharp';

const api = new LdApi('http://127.0.0.1:8081', 30000);

// 生成一张图片
const result = await api.generateImage({
  prompt: 'a cute cat',
  steps: 20,
  seed: 42,
  size: 512
});

// result.image 是 base64 编码的原始 RGB 像素数据
// result.width / result.height 为图像尺寸
// result.seed 为实际使用的种子
const rawPixels = Buffer.from(result.image, 'base64');
sharp(rawPixels, {
  raw: {
    width: result.width,
    height: result.height,
    channels: 3
  }
})
  .png()
  .toBuffer()
  .then(buffer => {
    writeFileSync('basic.png', buffer);
  });
```

生成结果中包含以下字段：

| 字段                 | 类型     | 说明                                     |
| -------------------- | -------- | ---------------------------------------- |
| `image`              | `string` | base64 编码的原始 RGB 像素（channels=3） |
| `seed`               | `number` | 实际使用的随机种子                       |
| `width`              | `number` | 图像宽度                                 |
| `height`             | `number` | 图像高度                                 |
| `first_step_time_ms` | `number` | 第一步推理耗时（毫秒）                   |
| `generation_time_ms` | `number` | 总生成耗时（毫秒）                       |

## 非正方形尺寸

通过 `width` 和 `height` 参数指定非正方形输出。注意：**需要在手机端设置对应尺寸，否则图片生成可能失败。**

```ts
const result = await api.generateImage({
  prompt: 'a cute cat',
  steps: 20,
  width: 512,
  height: 768
});

console.log(result.width, result.height); // 512 768
```

> `size` 和 `width`/`height` 互斥：传入 `size` 时会忽略 `width`/`height`。

## 扩散过程预览

开启 `show_diffusion_process` 后，可以通过 `onProgress` 回调实时获取中间步骤的预览图。注意：**需要在手机端开启显示生成过程**

```ts
const size = 512;
const result = await api.generateImage(
  {
    prompt: 'a cat',
    steps: 25,
    seed: 100,
    size,
    show_diffusion_process: true,
    show_diffusion_stride: 1 // 每 N 步发送一次预览，默认 1
  },
  {
    onProgress: event => {
      console.log(`步骤 ${event.step} / ${event.total_steps}`);
      // event.image 为当前步骤的 base64 中间预览图
      if (event.image) {
        // 保存或展示预览图
        const rawPixels = Buffer.from(event.image, 'base64');
        sharp(rawPixels, {
          raw: {
            width: size,
            height: size,
            channels: 3
          }
        })
          .png()
          .toBuffer()
          .then(buffer => {
            writeFileSync(`cat_preview${event.step}.png`, buffer);
          });
      }
    }
  }
);
```

`ProgressEvent` 字段：

| 字段          | 类型                  | 说明                         |
| ------------- | --------------------- | ---------------------------- |
| `step`        | `number`              | 当前步数                     |
| `total_steps` | `number`              | 总步数                       |
| `image`       | `string \| undefined` | 当前步骤的 base64 中间预览图 |

## Token 计数

查询提示词在模型 77-token CLIP 上限下的 token 数量。

```ts
const result = await api.tokenize('1girl, masterpiece');
console.log(result.count); // token 数量
console.log(result.max_length); // 77（CLIP 上限）
```

## 错误处理

当请求参数有误时，API 会 reject 一个 `ErrorEvent`：

```ts
import { type ErrorEvent } from '@kongxiangyiren/ld-api';
// 缺少 prompt
const err1 = await api.generateImage({}).catch((e: ErrorEvent) => e);
console.log(err1.type); // 'request_error'
console.log(err1.type === 'request_error' && err1.message); // 包含 "prompt"

// 参数值非法（如负数的 steps）
const err2 = await api.generateImage({
  prompt: 'a cat',
  steps: -1
})((e: ErrorEvent) => e);

console.log(err2.type); // 'error'
console.log(err1.type === 'error' && err2.message); // 包含错误描述
```

`ErrorEvent` 字段：

| 字段      | 类型                         | 说明     |
| --------- | ---------------------------- | -------- |
| `type`    | `'error' \| 'request_error'` | 错误类型 |
| `message` | `string`                     | 错误描述 |

## 完整参数

`generateImage` 主要参数一览：

| 参数                     | 类型      | 默认值  | 说明                                             |
| ------------------------ | --------- | ------- | ------------------------------------------------ |
| `prompt`                 | `string`  | -       | **必填**。正向提示词                             |
| `negative_prompt`        | `string`  | `""`    | 反向提示词                                       |
| `steps`                  | `number`  | `20`    | 采样步数                                         |
| `seed`                   | `number`  | `-1`    | 随机种子（-1 为随机）                            |
| `cfg`                    | `number`  | `7.5`   | CFG 系数                                         |
| `size`                   | `number`  | `512`   | 正方形输出尺寸                                   |
| `width`                  | `number`  | `512`   | 输出宽度                                         |
| `height`                 | `number`  | `512`   | 输出高度                                         |
| `scheduler`              | `string`  | `'dpm'` | 采样方法                                         |
| `image`                  | `string`  | -       | base64 图片，传入则切换为图生图模式              |
| `mask`                   | `string`  | -       | base64 蒙版，与 `image` 同时传入则切换为 inpaint |
| `denoise_strength`       | `number`  | `0.6`   | 图生图 / inpaint 去噪强度                        |
| `show_diffusion_process` | `boolean` | `false` | 是否开启中间步骤预览                             |
| `show_diffusion_stride`  | `number`  | `1`     | 预览步幅                                         |
| `use_opencl`             | `boolean` | `false` | CPU 模式下切换 MNN 后端到 GPU OpenCL             |

## 开发

```bash
npm install        # 安装依赖
npm run test       # 运行单元测试
npm run build      # 构建产物
```

## 许可

MIT
