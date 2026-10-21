import { defineConfig } from 'tsdown';

export default defineConfig({
  dts: {
    generator: 'tsgo'
  },
  exports: true,
  platform: 'neutral',
  minify: true,
  format: ['cjs', 'es']
});
