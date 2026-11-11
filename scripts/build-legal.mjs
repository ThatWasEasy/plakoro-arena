// 把服務條款與隱私權政策輸出成兩頁獨立的 HTML。
//
// 為什麼需要「實體頁面」：Google OAuth 送審要求條款與隱私權政策各有一個可公開存取的
// 網址，而且跟應用程式同網域。站內那個浮層是 JS 畫出來的，審核端抓不到文字。
//
// 為什麼用產生的而不是手寫兩頁：法律文件只能有一份來源。手抄一份到 public/ 的話，改了
// 其中一邊而另一邊沒改，是只有在出事那天才會被逐字比對出來的那種錯。這裡跟站內浮層讀
// 的是同一個 src/data/legalDocs.js。
//
// dev 看不到產生出來的檔案（它們在 docs/，而 dev server 服務的是原始碼），所以這支把
// render 匯出去給 vite.config.js 的 middleware 現場畫 —— 同一支程式、同一份來源，
// 本機開 /terms/ 看到的就是上線後的那一頁。
//
// 為什麼寫進 docs/ 而不是 public/：public/ 的東西會被原封不動複製進 docs/，等於同一份
// 檔案在 git 裡存兩次。vite 建置會清空 docs/，所以這支一定要排在 vite build 之後 ——
// 見 package.json 的 build 指令。
import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

import { LEGAL_DOCS, CONTACT_EMAIL, OPERATOR } from '../src/data/legalDocs.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs')

const SITE = 'https://plakoro.tw'

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 條款內文裡的網址與信箱本來就是給人點的 —— 第八條那句「行使方式」整句的用處就是讓人
// 找得到我們。跑在跳脫之後，所以這裡接到的已經是安全的字串。
//
// 網址與信箱在同一條規則裡輪替，不是兩次 replace：分成兩次的話，第二次會掃進第一次剛
// 產生的 <a> 標記裡。信箱的字元集也刻意收緊到 ASCII —— 放寬成「非空白」會把緊接在後面
// 的中文標點跟句子一起吞進 mailto。
const LINK_RE = /(https?:\/\/[^\s<>「」（）()，。、]+)|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g
function linkify(escaped) {
  return escaped.replace(LINK_RE, (m, url, mail) =>
    url ? `<a href="${url}" rel="noopener">${url}</a>` : `<a href="mailto:${mail}">${mail}</a>`)
}

/** 這份文件要畫成哪一頁。給 vite 的 middleware 用，正式輸出也走同一條。 */
export function renderLegalPage(key) {
  const doc = LEGAL_DOCS.find(d => d.key === key)
  return doc ? render(doc, LEGAL_DOCS.filter(d => d.key !== key)) : null
}

/** 有哪幾頁。middleware 用它決定要不要接手這個路徑。 */
export const LEGAL_KEYS = LEGAL_DOCS.map(d => d.key)

function render(doc, others) {
  const nav = others
    .map(o => `<a class="nav" href="/${o.key}/">${escapeHtml(o.title)}</a>`)
    .join('')

  const body = doc.sections
    .map(s => {
      const ps = s.p.map(line => `        <p>${linkify(escapeHtml(line))}</p>`).join('\n')
      return `      <section>\n        <h2>${escapeHtml(s.h)}</h2>\n${ps}\n      </section>`
    })
    .join('\n')

  // 整頁自給自足：沒有外部 CSS、沒有 JS、沒有字型下載。審核端與搜尋引擎拿到的就是純
  // 文字，而玩家在賽場的行動網路下開也是一次請求的事。
  return `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(doc.title)}｜PLAKORO ARENA</title>
<link rel="canonical" href="${SITE}/${doc.key}/">
<meta name="description" content="PLAKORO ARENA ${escapeHtml(doc.title)}，生效日 ${escapeHtml(doc.effective)}。">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2rem 1rem calc(3rem + env(safe-area-inset-bottom, 0px));
    background: #F3F2EC;
    color: #1F1F1D;
    font-family: system-ui, -apple-system, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif;
    /* 法律文字的行距要比介面寬 —— 這是會被一行一行讀完的東西。 */
    line-height: 1.9;
  }
  main {
    max-width: 44rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 2rem;
    background: #fff;
    border-radius: 0.75rem;
  }
  .home { display: block; max-width: 44rem; margin: 0 auto 0.75rem; font-size: 0.8125rem; font-weight: 700; color: #6B6B66; text-decoration: none; }
  .home:hover { color: #1F1F1D; }
  h1 { margin: 0 0 0.25rem; font-size: 1.25rem; font-weight: 800; }
  .eff { margin: 0 0 0.5rem; font-size: 0.75rem; color: #8A8A82; }
  .nav { display: inline-block; margin: 0 0 1.5rem; font-size: 0.8125rem; font-weight: 700; color: #3A3A35; }
  section { margin-bottom: 1.5rem; }
  h2 { margin: 0 0 0.5rem; font-size: 0.9375rem; font-weight: 800; }
  p { margin: 0 0 0.625rem; font-size: 0.875rem; color: #3A3A35; }
  a { color: #3A3A35; }
  footer { max-width: 44rem; margin: 1.25rem auto 0; font-size: 0.75rem; color: #8A8A82; }
</style>
</head>
<body>
  <a class="home" href="/">&larr; PLAKORO ARENA</a>
  <main>
    <h1>${escapeHtml(doc.title)}</h1>
    <p class="eff">生效日：${escapeHtml(doc.effective)}</p>
    ${nav}
${body}
  </main>
  <footer>${escapeHtml(OPERATOR)}　${linkify(escapeHtml(CONTACT_EMAIL))}</footer>
</body>
</html>
`
}

/** 寫進 docs/。只有被直接執行時才跑 —— 被 vite.config.js 匯入時不該有副作用。 */
export async function writeLegalPages() {
  for (const doc of LEGAL_DOCS) {
    // 目錄而不是 terms.html：網址是要貼進 Google 審核表單跟條款本身的，/terms/ 比
    // /terms.html 乾淨，而且之後換任何靜態主機都不會變。
    const dir = join(OUT, doc.key)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'index.html'), renderLegalPage(doc.key), 'utf-8')
    console.log(`legal: docs/${doc.key}/index.html  →  ${SITE}/${doc.key}/`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeLegalPages()
}
