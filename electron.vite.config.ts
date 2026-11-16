import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

// main = Composition Root (src/main), preload = IPC-Brücke, renderer = Oberfläche (Client).
export default defineConfig({
  main: { build: { lib: { entry: resolve('src/main/index.ts') } } },
  preload: { build: { lib: { entry: resolve('src/client/bridge/preload.ts') } } },
  renderer: {
    root: resolve('src/client/ui'),
    build: { rollupOptions: { input: resolve('src/client/ui/index.html') } },
  },
});
