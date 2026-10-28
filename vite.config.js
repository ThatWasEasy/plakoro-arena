import { readFileSync } from 'fs'
import { fileURLToPath, URL } from 'url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'))

export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    // Online duel needs two devices, so the dev server gets reached through a tunnel. Vite
    // rejects unknown Host headers by default (a DNS-rebinding guard), which is what blocks an
    // ngrok URL from loading.
    //
    // A leading dot matches the domain and all its subdomains — necessary rather than tidy,
    // since ngrok's free tier hands out a fresh random subdomain on every restart and pinning
    // one would mean editing this file each time. Scoped to the tunnel providers instead of
    // `true`, so an arbitrary host still can't reach the dev server.
    allowedHosts: ['.ngrok-free.app', '.ngrok.io', '.trycloudflare.com', '.loca.lt'],
    // Serves on the LAN too, so a phone on the same wifi can skip the tunnel entirely.
    host: true,
    proxy: {
      // The handbook prototype, served from `npm run split-handbook`'s output:
      //     cd handbook-build/pdf && python3 -m http.server 4801
      //
      // Proxied rather than fetched directly so the prototype uses the same URL shape the
      // real thing will — `/api/handbook/...`, same origin, no CORS — which means going live
      // is deleting this block, not rewriting the client.
      //
      // Dev only. The chapters are a paid product and never belong in this repo or its build.
      '/api/handbook': {
        target: 'http://localhost:4801',
        changeOrigin: true,
        // /api/handbook/<catalogue>            -> that catalogue's manifest
        // /api/handbook/<catalogue>/<unit>      -> one chapter
        rewrite: p => {
          const rest = p.replace(/^\/api\/handbook\/?/, '')
          const slash = rest.indexOf('/')
          if (slash === -1) return `/${rest}/manifest.json`
          return `/${rest.slice(0, slash)}/${rest.slice(slash + 1)}.pdf`
        }
      }
    }
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  }
})
