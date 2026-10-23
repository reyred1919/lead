/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "سامانه لیدهای نمایشگاهی",
        short_name: "لید نمایشگاه",
        lang: "fa",
        dir: "rtl",
        display: "standalone",
        start_url: "/",
        background_color: "#FAFBFD",
        theme_color: "#10294C",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // App shell only. API responses are never cached by the service worker.
        globPatterns: ["**/*.{js,css,html,woff2,png,svg}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: { "/api": { target: backend, changeOrigin: false } },
  },
  preview: { port: 4173, proxy: { "/api": { target: backend, changeOrigin: false } } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
  },
});
