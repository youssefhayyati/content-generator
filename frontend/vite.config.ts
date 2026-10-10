import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// vite.config runs in Node, but the app build doesn't type it (no @types/node here).
declare const process: { env: Record<string, string | undefined> }

// The Laravel API (docker compose up) answers on :8000 (override with API_ORIGIN when it
// doesn't). Proxying it keeps the app, the API and the OAuth callbacks on one origin, so
// the session cookie just works. The Host header is passed through unchanged so signed
// links (email verification) still match.
// (The string shorthand would rewrite Host to :8000, hence the explicit objects.)
const api = { target: process.env.API_ORIGIN ?? 'http://localhost:8000', changeOrigin: false }

// The voice assistant (docker compose --profile assistant up -d) on :8003: its WebSocket, its
// pictures and its microphone worklet, all under /assistant/.
const assistant = {
  target: process.env.ASSISTANT_ORIGIN ?? 'http://localhost:8003',
  ws: true,
  rewrite: (p: string) => p.replace(/^\/assistant/, ''),
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/sanctum': api,
      '/oauth': api,
      '/assistant': assistant,
    },
  },
})
