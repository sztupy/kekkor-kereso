// vite.config.js
import { resolve } from 'path'

export default {
  base: '/kekkor-kereso/',
  build: {
    outDir: 'docs',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        import: resolve(__dirname, 'import.html'),
      },
    },
  },
  json: {
    stringify: true
  }
}
