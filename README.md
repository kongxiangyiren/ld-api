# @kongxiangyiren/ld-api

本地扩散模型（Local Dream）HTTP API 的 Node.js / TypeScript 客户端，支持文生图、图生图、inpaint 以及扩散过程预览。

## 安装

```bash
pnpm add @kongxiangyiren/ld-api sharp
```

## 两个接口，两个类

App 里有两个互相独立、默认就开放的 HTTP 端口，可以分别使用：

| 类 | 默认端口 | App 内开关 | 前提 |
| --- | --- | --- | --- |
| `LdApi` | `8081` | HTTP API（默认开启） | 需要先在 App 内选定模型，后端才会开始监听 |
| `LdDeviceApi` | `8808` | 设备互联（默认开启，2.8.1+） | 无 |

两个类互不依赖。只用 8081 时只 `import { LdApi }` 即可，但此时拿不到模型列表，生成尺寸要自己在 App 里记下来。

```ts
import { LdApi, LdDeviceApi } from '@kongxiangyiren/ld-api';

// 同一局域网内直接用手机 IP；在手机本机（Termux）上跑脚本时换成 127.0.0.1 即可
const HOST = 'http://<手机IP>';

const api = new LdApi(`${HOST}:8081`, 30000); // 生成
const device = new LdDeviceApi(`${HOST}:8808`, 30000); // 设备互连
```

> 两个端口默认对外监听，**不需要 `adb forward`**，局域网内任意设备可直接访问。唯一的例外是 8081：它要等 App 内选定模型后才开始监听，此时未选定模型的话 `:8081` 会直接连接被拒。
>
> 也正因为默认对整个局域网开放，在公共网络下使用时留意一下网络环境。

## 设备互连

> 设备互连默认开启（2.8.1+），无需额外配置。

```ts
import { LdDeviceApi } from '@kongxiangyiren/ld-api';

const device = new LdDeviceApi('http://<手机IP>:8808', 30000);

// 获取信息
const info = await device.getInfo();

// 获取模型列表
const { models } = await device.getModels();
const presenceSize = models[0].resolutions.length !== 0;

// 选择模型（NPU 模式下生成尺寸必须与这里选的分辨率一致）
const selected = await device.selectModel(
  models[0].id,
  presenceSize ? models[0].resolutions[0][0] : 1024,
  presenceSize ? models[0].resolutions[0][1] : 1024
);

if (!selected.ok) {
  throw new Error('模型选择失败');
}

// 获取状态
const status = await device.getStatus();

if (status.state !== 'running') {
  throw new Error('模型未就绪');
}

// 停止模型
const stopped = await device.stop(models[0].id);
if (!stopped.ok) {
  throw new Error('模型停止失败');
}
```

## 快速开始

```ts
import { LdApi } from '@kongxiangyiren/ld-api';
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const api = new LdApi('http://<手机IP>:8081', 30000);

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
| `format`             | `string` | 结果图编码格式，当前为 `'raw'`           |
| `first_step_time_ms` | `number` | 第一步推理耗时（毫秒）                   |
| `generation_time_ms` | `number` | 总生成耗时（毫秒）                       |

## 非正方形尺寸

通过 `width` 和 `height` 参数指定非正方形输出。注意：**NPU 模式下必须与选定模型时的分辨率一致，否则图片生成失败。**

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
      // event.image 为当前步骤的 base64 中间预览图，未开启或运行时未提供时不存在
      if (event.image) {
        // 保存或展示预览图
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
| `format`      | `string \| undefined` | 预览图编码格式，当前为 `'raw'` |

生成结果是一张图，但 `progress` 事件的首步可能重复推送，客户端无需去重。

## 取消生成

`generateImage` 的第二个参数支持传入 `AbortSignal`：

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);

await api.generateImage({ prompt: 'a cat' }, { signal: controller.signal });
```

## Token 计数

查询提示词在模型 77-token CLIP 上限下的 token 数量。

```ts
const result = await api.tokenize('1girl, masterpiece');
console.log(result.count); // token 数量
console.log(result.max_length); // 77（CLIP 上限）
console.log(result.overflow_offset); // 未溢出为 -1
```

## 错误处理

生成接口的参数错误有两条路径，都会 reject 一个 `ErrorEvent`：

```ts
import { type ErrorEvent } from '@kongxiangyiren/ld-api';

// 缺少 prompt：后端返回 HTTP 400 + JSON 错误体
const err1 = await api.generateImage({}).catch((e: ErrorEvent) => e);
console.log(err1.type); // 'request_error'
console.log(err1.message); // 包含 "prompt"

// 参数值非法（如负数的 steps）：后端在 SSE 流里推送 error 事件
const err2 = await api
  .generateImage({ prompt: 'a cat', steps: -1 })
  .catch((e: ErrorEvent) => e);
console.log(err2.type); // 'error'
console.log(err2.message); // 包含错误描述
```

`ErrorEvent` 字段：

| 字段      | 类型                         | 说明     |
| --------- | ---------------------------- | -------- |
| `type`    | `'error' \| 'request_error'` | 错误类型 |
| `message` | `string`                     | 错误描述 |

`tokenize` 与 `LdDeviceApi` 的各方法失败时，底层会抛出 ofetch 的 `FetchError`，错误详情在 `error.data.error.message` 里：

```ts
import { FetchError } from 'ofetch';

await device.selectModel('不存在的模型', 512, 512).catch(error => {
  if (error instanceof FetchError) {
    console.log(error.status); // 404
    console.log(error.data?.error?.message); // 'model not found'
  }
});
```

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
| `scheduler`              | `string`  | `'dpm'` | 采样方法，未知值回退到 `'dpm'`                    |
| `image`                  | `string`  | -       | base64 图片，传入则切换为图生图模式              |
| `mask`                   | `string`  | -       | base64 蒙版，与 `image` 同时传入则切换为 inpaint |
| `denoise_strength`       | `number`  | `0.6`   | 图生图 / inpaint 去噪强度                        |
| `show_diffusion_process` | `boolean` | `false` | 是否开启中间步骤预览                             |
| `show_diffusion_stride`  | `number`  | `1`     | 预览步幅                                         |
| `use_opencl`             | `boolean` | `false` | CPU 模式下切换 MNN 后端到 GPU OpenCL             |
| `aspect_ratio`           | `string`  | `'1:1'` | 仅 SDXL NPU 生效，如 `'3:4'`、`'16:9'`            |

完整字段说明见 [HTTP API 参考](https://ld-guide.chino.icu/zh/features/http-api)。

## 开发

```bash
pnpm install       # 安装依赖
pnpm typecheck     # 类型检查
pnpm test          # 对真机跑单元测试（手机 IP 写在 tests/index.test.ts 的 HOST）
pnpm build         # 构建产物
```

测试直连真机：`LdDeviceApi` 打到 `:8808`，`LdApi` 打到 `:8081`。缺哪个端口就跳过哪一组用例，开跑前会打印跳过原因。

## 许可

MIT
