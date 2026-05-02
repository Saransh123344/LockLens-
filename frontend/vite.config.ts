import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,          // ← listen on 0.0.0.0 so other devices on the network can connect
    allowedHosts: true,  // ← This stops Vite from blocking your Ngrok URL
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['face-api.js'],
  },
})