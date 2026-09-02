import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5180 },
  // Everything under src/ that is worth testing is pure TypeScript, so the
  // suite needs no DOM.
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
