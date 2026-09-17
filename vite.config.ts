import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// base relativo: funciona en local y en GitHub Pages (project site)
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'F110 - Distribution Power System',
        short_name: 'F110 DPS',
        description:
          'SCADA de distribuciÃ³n elÃ©ctrica de un buque â€” consulta y simulaciÃ³n unifilar',
        lang: 'es',
        theme_color: '#0e1614',
        background_color: '#0e1614',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Revisar actualizaciones al enfocar la app y en red
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        // Nueva clave: fuerza abandonar caches PWA viejas en el mÃ³vil
        cacheId: 'scada-f110-movil-v10-equip-balloon',
        // El bundle unifilar (abtDownstream + topologÃ­a) supera con creces 2 MiB
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: [
          '**/*.{js,css,html,ico,svg,png,woff2,json,xlsx}',
        ],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'scada-html-movil-v10',
              networkTimeoutSeconds: 4,
            },
          },
        ],
      },
      devOptions: {
        // Evita ruido del SW en desarrollo local
        enabled: false,
      },
    }),
  ],
  base: './',
  server: {
    watch: {
      // Evita EBUSY al descomprimir Excel en .tmp durante imports
      ignored: ['**/.tmp/**'],
    },
  },
})

