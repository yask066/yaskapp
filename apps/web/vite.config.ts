import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiProxy = {
    target: env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
    changeOrigin: true,
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
