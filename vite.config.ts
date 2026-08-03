import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// SPA se builda u ./dist, odakle ga Worker servira kroz ASSETS binding
// (wrangler.jsonc `not_found_handling: single-page-application`).
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
  server: {
    port: 5174,
    // `npm run dev` (Vite) + `npm run api` (wrangler dev na :8787)
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/webhook": "http://127.0.0.1:8787",
    },
  },
});
