import { describe, test, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import { ofetch } from 'ofetch';
import { LdApi, LdDeviceApi, type ErrorEvent, type Module } from '../src';

const HOST = '192.168.1.40';
const DEVICE_URL = `http://${HOST}:8808`;
const GEN_URL = `http://${HOST}:8081`;
const SIZE = 512;

const device = new LdDeviceApi(DEVICE_URL, 10000);
const api = new LdApi(GEN_URL, 30000);

/** 端口是否在监听：8081 在选定模型前是连接被拒，选定后任意路径都会返回响应。 */
async function listening(url: string): Promise<boolean> {
  try {
    await ofetch(url, { timeout: 3000, retry: false, ignoreResponseError: true });
    return true;
  } catch {
    return false;
  }
}

// 8081 与 8808 是两个独立开关，缺哪个就只跑哪一组
const deviceUp = await listening(DEVICE_URL);
const genUp = (await listening(GEN_URL)) || deviceUp;

if (!deviceUp) {
  console.warn(`[跳过] ${DEVICE_URL} 不可达：设备互连相关用例不会执行（需在 App 内开启「设备互联」）`);
}
if (!genUp) {
  console.warn(`[跳过] ${GEN_URL} 不可达：生成相关用例不会执行（8081 需先在 App 内选定模型才会监听）`);
}

let model: Module;
let nonSquareModel: Module;

/** 切换模型会重启 8081 的监听，等它重新可用，顺便让连接池丢掉失效连接。 */
async function waitForGenerationBackend() {
  for (let i = 0; i < 100; i++) {
    if (await listening(GEN_URL)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error('等待生成后端重新监听超时');
}

/** 通过设备互连接口加载模型，并等到 running 且生成后端可用。 */
async function selectModel(width: number, height: number, target: Module = model) {
  const result = await device.selectModel(target.id, width, height);
  expect(result.ok).toBe(true);

  for (let i = 0; i < 60; i++) {
    const status = await device.getStatus();
    if (status.state === 'running') {
      await waitForGenerationBackend();
      return;
    }
    if (status.state === 'error') throw new Error(`模型加载失败: ${status.message}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error('等待模型加载超时');
}

/** 把 base64 原始 RGB 像素存成 PNG，方便肉眼验收。 */
function savePng(name: string, image: string, width: number, height: number) {
  const rawPixels = Buffer.from(image, 'base64');
  sharp(rawPixels, {
    raw: {
      width,
      height,
      channels: 3
    }
  })
    .png()
    .toBuffer()
    .then(buffer => {
      writeFileSync(`output/${name}.png`, buffer);
    });
}

beforeAll(async () => {
  rmSync('output', {
    recursive: true,
    force: true
  });
  mkdirSync('output', {
    recursive: true
  });

  if (!deviceUp) return;

  // 生成后端只有模型加载后才会监听，用设备互连接口把模型准备好
  const { models } = await device.getModels();
  model = models.find(m => m.resolutions.some(([w, h]) => w === SIZE && h === SIZE)) ?? models[0];
  // 非正方形用例必须换成真的支持 512×768 的模型，否则后端不报错但输出是噪点
  nonSquareModel =
    models.find(m => m.resolutions.some(([w, h]) => w === 512 && h === 768)) ?? model;
  await selectModel(SIZE, SIZE);
}, 120000);

describe.skipIf(!deviceUp)('getInfo', () => {
  test('returns info', { timeout: 10000 }, async () => {
    const result = await device.getInfo();
    expect(result.app).toBe('localdream');
    expect(result.protocol).toBe(1);
    expect(result.version).toBeTypeOf('string');
    expect(result.device).toBeTypeOf('string');
  });
});

describe.skipIf(!deviceUp)('getModels', () => {
  test('returns models', { timeout: 10000 }, async () => {
    const result = await device.getModels();
    expect(result.use_img2img).toBeTypeOf('boolean');
    expect(result.models).toBeTypeOf('object');
  });
});

describe.skipIf(!deviceUp)('selectModel', () => {
  test('select model', { timeout: 30000 }, async () => {
    const result = await device.selectModel(model.id, SIZE, SIZE);
    expect(result.ok).toBeTypeOf('boolean');
  });
});

describe.skipIf(!deviceUp)('status', () => {
  test('status', { timeout: 10000 }, async () => {
    const result = await device.getStatus();
    expect(result.state).toBeTypeOf('string');
  });
});

describe.skipIf(!genUp)('generateImage', () => {
  test('generates an image with basic params', { timeout: 120000 }, async () => {
    const result = await api.generateImage({
      prompt: 'a cute cat',
      steps: 20,
      seed: 42,
      size: SIZE
    });

    expect(result.image).toBeTypeOf('string');
    expect(result.image.length).toBeGreaterThan(0);
    expect(result.seed).toBe(42);
    expect(result.width).toBe(SIZE);
    expect(result.height).toBe(SIZE);
    expect(result.first_step_time_ms).toBeGreaterThan(0);
    expect(result.generation_time_ms).toBeGreaterThan(0);

    savePng('basic', result.image, result.width, result.height);
  });

  test('img2img', { timeout: 120000 }, async () => {
    const result = await api.generateImage({
      prompt: 'a cute cat, Blue eyes',
      image: readFileSync(new URL('./cat.png', import.meta.url), 'base64'),
      steps: 20,
      size: SIZE
    });

    expect(result.image).toBeTypeOf('string');
    expect(result.image.length).toBeGreaterThan(0);
    expect(result.seed).toBeGreaterThan(0);
    expect(result.width).toBe(SIZE);
    expect(result.height).toBe(SIZE);
    expect(result.first_step_time_ms).toBeGreaterThan(0);
    expect(result.generation_time_ms).toBeGreaterThan(0);

    savePng('img2img', result.image, result.width, result.height);
  });

  test(
    'show_diffusion_process includes intermediate image previews in progress events',
    { timeout: 120000 },
    async () => {
      const previews: { step: number; hasImage: boolean }[] = [];

      const result = await api.generateImage(
        {
          prompt: 'a cat',
          steps: 25,
          seed: 100,
          size: SIZE,
          show_diffusion_process: true,
          show_diffusion_stride: 1
        },
        {
          onProgress: event => {
            previews.push({
              step: event.step,
              hasImage: typeof event.image === 'string' && event.image.length > 0
            });

            if (event.image) savePng(`cat_preview${event.step}`, event.image, SIZE, SIZE);
          }
        }
      );

      expect(result.image).toBeTypeOf('string');
      expect(previews.length).toBeGreaterThan(0);
      // 至少有一部分 progress 事件应该携带预览图
      const withImage = previews.filter(p => p.hasImage);
      expect(withImage.length).toBeGreaterThan(0);
    }
  );

  test('handles missing prompt error', { timeout: 10000 }, async () => {
    // @ts-expect-error testing server validation
    const result = await api.generateImage({}).catch((e: ErrorEvent) => e);
    expect(result.type).toBe('request_error');
    expect(result.type === 'request_error' && result.message).toMatch(/prompt/);
  });

  test('parameter error', { timeout: 10000 }, async () => {
    const result = await api
      .generateImage({
        prompt: 'a cat',
        steps: -1
      })
      .catch((e: ErrorEvent) => e);

    expect(result.type).toBe('error');
    expect(result.type === 'error' && result.message).toMatch(/vector/);
  });
});

describe.skipIf(!deviceUp || !genUp)('非正方形尺寸', () => {
  // NPU 模式下生成尺寸必须与选定模型的 resolutions 一致，所以要换到支持 512×768 的模型
  test('generates an image with non-square dimensions', { timeout: 120000 }, async () => {
    await selectModel(512, 768, nonSquareModel);

    try {
      const result = await api.generateImage({
        prompt: 'a cute cat',
        steps: 20,
        width: 512,
        height: 768
      });

      expect(result.image).toBeTypeOf('string');
      expect(result.width).toBe(512);
      expect(result.height).toBe(768);

      savePng('non-square', result.image, result.width, result.height);
    } finally {
      await selectModel(SIZE, SIZE);
    }
  });
});

describe.skipIf(!genUp)('tokenize', () => {
  test('returns token count ', { timeout: 10000 }, async () => {
    const result = await api.tokenize('1girl, masterpiece');
    expect(result.count).toBeGreaterThan(0);
    expect(result.max_length).toBe(77);
  });
});

describe.skipIf(!deviceUp)('stop', () => {
  test('stop', { timeout: 30000 }, async () => {
    const status = await device.getStatus();
    console.log(status.state);
    if (status.state === 'running' && status.serving_model_id) {
      const result = await device.stop(status.serving_model_id);
      expect(result.ok).toBeTypeOf('boolean');
    }
  });
});
