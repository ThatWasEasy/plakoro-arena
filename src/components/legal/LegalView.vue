<!-- 服務條款與隱私權政策。
     一律繁體中文，不走 i18n —— 連這個畫面上的字也是。理由寫在 data/legalDocs.js：
     這兩份是有生效日的法律文件，不是介面字串，多一種語言就多一個「以哪一版為準」。

     做成蓋在上層的浮層而不是一個獨立模式，是因為它最常見的開啟時機是「註冊表單填到
     一半，想先看看條款」。換頁會把人填好的帳號跟暱稱清掉。 -->
<script setup>
import { ref } from 'vue'
import { LEGAL_DOCS } from '../../data/legalDocs'

const props = defineProps({
  // 'terms' | 'privacy'：一進來先看哪一份。
  start: { type: String, default: 'terms' }
})
const emit = defineEmits(['close'])

const which = ref(LEGAL_DOCS.some(d => d.key === props.start) ? props.start : 'terms')
const doc = () => LEGAL_DOCS.find(d => d.key === which.value)
</script>

<template>
  <div class="lg" @click.self="emit('close')">
    <div class="lg-sheet">
      <div class="lg-bar">
        <button
          v-for="d in LEGAL_DOCS"
          :key="d.key"
          class="lg-tab"
          :class="{ on: d.key === which }"
          @click="which = d.key"
        >{{ d.title }}</button>
        <button class="lg-x" aria-label="關閉" @click="emit('close')">✕</button>
      </div>

      <div class="lg-body">
        <h2 class="lg-title">{{ doc().title }}</h2>
        <p class="lg-eff">生效日：{{ doc().effective }}</p>
        <section v-for="s in doc().sections" :key="s.h" class="lg-sec">
          <h3>{{ s.h }}</h3>
          <p v-for="(line, i) in s.p" :key="i">{{ line }}</p>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lg {
  position: fixed;
  inset: 0;
  z-index: 9800;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem 0.75rem;
  background: rgba(0, 0, 0, 0.62);
}
.lg-sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 34rem;
  max-height: 88vh;
  border-radius: 0.75rem;
  background: #fff;
  color: #1F1F1D;
  overflow: hidden;
}
.lg-bar {
  display: flex;
  align-items: stretch;
  flex: none;
  border-bottom: 0.0625rem solid rgba(0, 0, 0, 0.12);
}
.lg-tab {
  flex: 1;
  padding: 0.75rem 0.5rem;
  border: 0;
  background: none;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 700;
  color: #6B6B66;
  cursor: pointer;
}
.lg-tab.on { color: #1F1F1D; box-shadow: inset 0 -0.1875rem 0 #1F1F1D; }
.lg-x {
  flex: none;
  width: 2.75rem;
  border: 0;
  background: none;
  font-size: 0.875rem;
  color: #6B6B66;
  cursor: pointer;
}
.lg-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem 1.125rem 1.5rem;
  /* 法律文字的行距要比介面寬 —— 這是會被一行一行讀完的東西。 */
  line-height: 1.9;
}
.lg-title { margin: 0 0 0.125rem; font-size: 1.0625rem; font-weight: 800; }
.lg-eff { margin: 0 0 1rem; font-size: 0.6875rem; color: #8A8A82; }
.lg-sec { margin-bottom: 1.125rem; }
.lg-sec h3 { margin: 0 0 0.375rem; font-size: 0.875rem; font-weight: 800; }
.lg-sec p { margin: 0 0 0.5rem; font-size: 0.8125rem; color: #3A3A35; }
</style>
