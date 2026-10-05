import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

// The app's version (the desktop package's), for "What's new" in a plain browser too.
const version = JSON.parse(readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8')).version as string;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/pd2': 'http://127.0.0.1:8080',
    },
  },
});
