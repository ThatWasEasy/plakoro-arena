import { createI18n } from 'vue-i18n'
import ja from './locales/ja.json'
import en from './locales/en.json'
import zhTW from './locales/zh-TW.json'

export const SUPPORTED_LOCALES = ['ja', 'en', 'zh-TW']
const LOCALE_STORAGE_KEY = 'plakoro_locale'

function detectDefaultLocale() {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (saved && SUPPORTED_LOCALES.includes(saved)) return saved
  } catch (e) {}
  const nav = (navigator.language || 'ja').toLowerCase()
  if (nav.startsWith('zh')) return 'zh-TW'
  if (nav.startsWith('en')) return 'en'
  return 'ja'
}

// index.html 寫死 lang="ja"，換語言時沒人改它。字型堆疊（style.css 的 --ui-cjk）靠
// :lang() 決定中文要不要用思源黑體，所以這個屬性必須跟著語言走，不然中文版會一直吃到
// 日文字形。順便也讓螢幕閱讀器念對語言。
function applyLang(locale) {
  document.documentElement.lang = locale
}

export const i18n = createI18n({
  legacy: false,
  locale: detectDefaultLocale(),
  fallbackLocale: 'ja',
  messages: { ja, en, 'zh-TW': zhTW }
})
applyLang(i18n.global.locale.value)

export function setLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) return
  i18n.global.locale.value = locale
  applyLang(locale)
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch (e) {}
}
