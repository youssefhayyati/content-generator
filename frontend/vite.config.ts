import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// vite.config runs in Node, but the app build doesn't type it (no @types/node here).
declare const process: { env: Record<string, string | undefined> }

// The Laravel API (docker compose up) answers on :8002 — this project owns the 8002 port
// block, and :8000 belongs to another local service, so pointing here by default avoids
// proxying the whole app into someone else's server. Override with API_ORIGIN if needed.
// Proxying keeps the app, the API and the OAuth callbacks on one origin, so the session
// cookie just works. The Host header is passed through unchanged so signed links (email
// verification) still match.
// (The string shorthand would rewrite Host to the target, hence the explicit objects.)
const api = { target: process.env.API_ORIGIN ?? 'http://localhost:8002', changeOrigin: false }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 5175 to match SANCTUM_STATEFUL_DOMAINS; 5173/5174 are taken by other local projects.
    port: 5175,
    strictPort: true,
    proxy: {
      '/api': api,
      '/sanctum': api,
      '/oauth': api,
    },
  },
})
