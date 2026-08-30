import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rootPackage = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
const builtAt = new Date().toISOString();
const buildId = process.env.ISSUEFLOW_BUILD_ID?.trim() || builtAt.replace(/\D/g, '').slice(0, 14);

export default defineConfig({
  plugins: [react()],
  define: {
    __ISSUEFLOW_VERSION__: JSON.stringify(process.env.ISSUEFLOW_APP_VERSION?.trim() || rootPackage.version),
    __ISSUEFLOW_BUILD_ID__: JSON.stringify(buildId),
    __ISSUEFLOW_BUILT_AT__: JSON.stringify(builtAt),
  },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3101' } },
  test: { globals: true, environment: 'jsdom', setupFiles: './src/test/setup.ts', css: true },
});
