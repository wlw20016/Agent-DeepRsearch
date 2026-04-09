import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
  rollupOptions: {
    output: {
      manualChunks: (id) => {
        // 将所有来自 node_modules 的依赖打包到 vendor.js
        if (id.includes('node_modules')) {
          return 'vendor';
        }
      }
    }
  }
}
});
