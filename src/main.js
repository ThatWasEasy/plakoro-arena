import { createApp } from 'vue'
import App from './App.vue'
import { i18n } from './i18n'
import './style.css'

import { installViewportProbe } from './debug/viewportProbe'

createApp(App).use(i18n).mount('#app')

// 只有網址帶 ?vpdebug=1 才會出現。見那支檔案的開頭 —— 它是為了查「旋轉後點不到東西」
// 用的，查完就可以整個拿掉。
installViewportProbe()
