
import { defineConfig } from 'vite';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';

export default defineConfig({
  // Node 22.21 has an HTTPS upgrade regression with Vite's dev server.
  // Localhost remains a secure context, so the XR emulator still works.
  plugins: [iwsdkDev({ https: false })],
});
