import { defineConfig } from 'tsdown';

export default defineConfig({
  dts: {
    tsgo: true
  },
  exports: true,
  // ...config options
  platform: 'neutral',
  minify: true,
  format: ['cjs', 'es']
});
