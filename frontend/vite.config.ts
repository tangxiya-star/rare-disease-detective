import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The backend runs on :8000 (uv run uvicorn app.main:app --port 8000).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', ws: true, changeOrigin: true },
    },
  },
})
