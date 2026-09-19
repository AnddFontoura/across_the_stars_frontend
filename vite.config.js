import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 8202,
    strictPort: true,
    // Allow the browser (host) to reach the container's dev server.
    watch: {
      usePolling: true,
    },
  },
})
