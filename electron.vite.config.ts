import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()], // keep better-sqlite3 external (native)
    resolve: { alias: { "@shared": resolve("src/shared") } },
    build: { rollupOptions: { input: resolve("src/main/index.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve("src/preload/index.ts") } },
  },
  renderer: {
    resolve: { alias: { "@shared": resolve("src/shared") } },
    build: {
      rollupOptions: {
        input: {
          notch: resolve("src/renderer/notch/index.html"),
          dashboard: resolve("src/renderer/dashboard/index.html"),
          settings: resolve("src/renderer/settings/index.html"),
          captureWorker: resolve("src/renderer/captureWorker/index.html"),
        },
      },
    },
  },
});
