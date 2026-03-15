import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/piano-tiles',
  build: {
    outDir: 'docs',
  },
  plugins: [react()],
  server: {
    host: true,
  },
})
