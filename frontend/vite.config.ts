import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    // Stops face-api.js from silently crashing
    'process.env': {}
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', changeOrigin: true, ws: true },
    },
  },
  optimizeDeps: {
    // This tells the internal bundler to never print warnings
    esbuildOptions: {
      logLevel: 'silent', 
    }
  }
})