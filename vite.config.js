import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 使用相对 base，方便部署到 GitHub Pages 等任意子路径
export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    host: true,
    port: 5173
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500
  }
})
