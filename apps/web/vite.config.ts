import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiProxy = {
    target: env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
    changeOrigin: true,
    // SPA routes such as /polls/:id share prefixes with the API; page loads go to the app.
    bypass: (request: { headers: { accept?: string } }) =>
      request.headers.accept?.includes('text/html') ? '/index.html' : undefined,
  };

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': apiProxy,
        '/auth': apiProxy,
        '/polls': apiProxy,
        '/users': apiProxy,
        '/profiles': apiProxy,
        '/search': apiProxy,
        '/media': apiProxy,
        '/notifications': apiProxy,
        '/notification-preferences': apiProxy,
        '/notification-devices': apiProxy,
        '/realtime': { ...apiProxy, ws: true },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      exclude: ['test/**/*.mjs'],
    },
  };
});
