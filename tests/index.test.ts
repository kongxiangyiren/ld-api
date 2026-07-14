import { describe, test, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { type ErrorEvent, LdApi } from '../src/index';
import sharp from 'sharp';
import { join } from 'node:path';

beforeAll(() => {
  rmSync('output', {
    recursive: true,
    force: true
  });
  mkdirSync('output', {
    recursive: true
  });
});

describe('getInfo', () => {
  const BASE_URL = 'http://192.168.1.40:8808';
  const api = new LdApi(BASE_URL, 10000);

  test('returns info', { timeout: 10000 }, async () => {
    const result = await api.getInfo();
    expect(result.app).toBe('localdream');
    expect(result.protocol).toBe(1);
    expect(result.version).toBeTypeOf('string');
    expect(result.device).toBeTypeOf('string');
  });
});

describe('getModels', () => {
  const BASE_URL = 'http://192.168.1.40:8808';
  const api = new LdApi(BASE_URL, 10000);

  test('returns models', { timeout: 10000 }, async () => {
    const result = await api.getModels();
    expect(result.use_img2img).toBeTypeOf('boolean');
    expect(result.models).toBeTypeOf('object');
  });
});

describe('selectModel', () => {
  const BASE_URL = 'http://192.168.1.40:8808';
  const api = new LdApi(BASE_URL, 10000);
  test('select model', { timeout: 10000 }, async () => {
    const models = await api.getModels();
    const presence_size = models.models[0].resolutions.length !== 0;
    const result = await api.selectModel(
      models.models[0].id,
      presence_size ? models.models[0].resolutions[0][0] : 1024,
      presence_size ? models.models[0].resolutions[0][1] : 1024
    );
    expect(result.ok).toBeTypeOf('boolean');
  });
});

describe('status', () => {
  const BASE_URL = 'http://192.168.1.40:8808';
  const api = new LdApi(BASE_URL, 10000);
  test('status', { timeout: 10000 }, async () => {
    const result = await api.getStatus();
    expect(result.state).toBeTypeOf('string');
  });
});

describe('generateImage', () => {
  const BASE_URL = 'http://192.168.1.40:8081';
  const api = new LdApi(BASE_URL, 30000);

  test('generates an image with basic params', { timeout: 120000 }, async () => {
    const result = await api.generateImage({
      prompt: 'a cute cat',
      steps: 20,
      seed: 42,
      size: 512
    });

    expect(result.image).toBeTypeOf('string');
    expect(result.image.length).toBeGreaterThan(0);
    expect(result.seed).toBe(42);
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.first_step_time_ms).toBeGreaterThan(0);
    expect(result.generation_time_ms).toBeGreaterThan(0);

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
        writeFileSync('output/basic.png', buffer);
      });
  });

  test('img2img', { timeout: 120000 }, async () => {
    const result = await api.generateImage({
      prompt: 'a cute cat, Blue eyes',
      image: readFileSync(join(__dirname, 'cat.png'), 'base64'),
      steps: 20,
      // seed: 42,
      size: 512
    });

    expect(result.image).toBeTypeOf('string');
    expect(result.image.length).toBeGreaterThan(0);
    expect(result.seed).toBeGreaterThan(0);
    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.first_step_time_ms).toBeGreaterThan(0);
    expect(result.generation_time_ms).toBeGreaterThan(0);

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
        writeFileSync('output/img2img.png', buffer);
      });
  });

  //需要手机端设置对应尺寸,否则图片生成失败
  test('generates an image with non-square dimensions', { timeout: 120000 }, async () => {
    const result = await api.generateImage({
      prompt: 'a cute cat',
      steps: 20,
      width: 512,
      height: 768
    });

    expect(result.image).toBeTypeOf('string');
    expect(result.width).toBe(512);
    expect(result.height).toBe(768);
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
        writeFileSync('output/non-square.png', buffer);
      });
  });

  test(
    'show_diffusion_process includes intermediate image previews in progress events',
    { timeout: 120000 },
    async () => {
      const previews: { step: number; hasImage: boolean }[] = [];
      const size = 512;

      const result = await api.generateImage(
        {
          prompt: 'a cat',
          steps: 25,
          seed: 100,
          size,
          show_diffusion_process: true,
          show_diffusion_stride: 1
        },
        {
          onProgress: event => {
            previews.push({
              step: event.step,
              hasImage: typeof event.image === 'string' && event.image.length > 0
            });

            if (event.image) {
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
                  writeFileSync(`output/cat_preview${event.step}.png`, buffer);
                });
            }
          }
        }
      );

      expect(result.image).toBeTypeOf('string');
      expect(previews.length).toBeGreaterThan(0);
      // At least some progress events should carry an image preview
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

describe('tokenize', () => {
  const BASE_URL = 'http://192.168.1.40:8081';
  const api = new LdApi(BASE_URL, 10000);

  test('returns token count ', { timeout: 10000 }, async () => {
    const result = await api.tokenize('1girl, masterpiece');
    expect(result.count).toBeGreaterThan(0);
    expect(result.max_length).toBe(77);
  });
});

describe('stop', () => {
  const BASE_URL = 'http://192.168.1.40:8808';
  const api = new LdApi(BASE_URL, 10000);

  test('stop', { timeout: 10000 }, async () => {
    const status = await api.getStatus();
    console.log(status.state);
    if (status.state === 'running' && status.serving_model_id) {
      const result = await api.stop(status.serving_model_id);
      expect(result.ok).toBeTypeOf('boolean');
    }
  });
});
