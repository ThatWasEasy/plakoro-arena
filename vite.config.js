import { readFileSync } from 'fs'
import { fileURLToPath, URL } from 'url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

import { LEGAL_KEYS, renderLegalPage } from './scripts/build-legal.mjs'

// 條款與隱私權政策的那兩頁在 docs/，是 build 之後才產生的 —— dev server 服務的是原始碼，
// 所以本機開 /terms/ 本來只會拿到首頁。這裡用同一支產生器現場畫，而不是把檔案複製進
// public/：複製的話又變成兩份來源，而 dev 看到的會是上一次 build 的舊內容。
function legalPages() {
  return {
    name: 'plakoro-legal-pages',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const key = (req.url || '').split('?')[0].replace(/^\/|\/$/g, '')
        if (!LEGAL_KEYS.includes(key)) return next()
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(renderLegalPage(key))
      })
    }
  }
}

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'))

export default defineConfig({
  base: './',
  // 輸出到 docs/，因為 GitHub Pages 的「從分支部署」只服務得了根目錄或 /docs ——
  // 指定不了 dist。放根目錄的話會跟原始碼混在一起（而根目錄那支 index.html 是開發用
  // 的，指向未編譯的 /src/main.js），所以站的網址只能是 .../dist/。
  //
  // 專案文件原本也住在 docs/，已經搬去 design/ —— 建置會清空輸出目錄，兩者不能共存。
  build: { outDir: 'docs' },
  plugins: [vue(), legalPages()],
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
