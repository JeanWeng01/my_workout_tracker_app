/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // The new version installs in the background and takes over on the next open. Drafts autosave
      // on every tap, so even a reload mid-workout loses nothing.
      registerType: 'autoUpdate',
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Bulletproof',
        short_name: 'Bulletproof',
        description: 'Personal strength training tracker: StrongLifts 5x5, then 5/3/1.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#DBCEFF',
        theme_color: '#DBCEFF',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the whole app shell, including the self-hosted fonts, so it opens with no signal.
        globPatterns: ['**/*.{js,css,html,woff2,woff,png,svg,ico,webmanifest}'],
        navigateFallback: '/index.html',
        // API calls always go to the network and are never cached: not by precache, not at runtime.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
