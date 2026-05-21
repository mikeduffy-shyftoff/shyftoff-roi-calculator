import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// `base` is set for GitHub Pages deployment under
// /shyftoff-roi-calculator/. If you move this to a custom domain or a
// different host (Netlify root, etc.), set base back to '/'.
export default defineConfig({
  base: '/shyftoff-roi-calculator/',
  plugins: [react()],
})
