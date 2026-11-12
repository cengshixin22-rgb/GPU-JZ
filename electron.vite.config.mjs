import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [vue()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            echarts: ['echarts'],
            element: ['element-plus']
          }
        }
      }
    }
  }
})
