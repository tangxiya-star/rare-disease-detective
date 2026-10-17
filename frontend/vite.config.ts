import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The backend runs on :8000 (uv run uvicorn app.main:app --port 8000). API_TARGET overrides it.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: loadEnv(mode, '.', '').API_TARGET || 'http://localhost:8000', ws: true, changeOrigin: true },
    },
  },
}))
