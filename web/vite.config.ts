import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiTarget = process.env.VITE_DEV_API_PROXY ?? 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Frontend calls the API under `/api` (see src/lib/api.ts). Strip the prefix
      // before forwarding so the backend still sees its real routes (/sessions, /me…).
      // Keeping the API on its own prefix avoids colliding with SPA routes of the
      // same name, so opening e.g. /sessions/:id in a fresh tab loads the app.
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
