<!-- 進遊戲時的蓋板公告。
     同時有多則時一則一則接著跳（見 data/announcements.js 的 splashNotices），每則都要
     自己按掉。「今日不再顯示」只壓這一則、只壓今天 —— 把它做成永久關閉的話，下一次
     真的需要所有人看到的那則公告就再也送不到任何人面前。 -->
<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { hideSplashToday, markRead, noticeKey } from '../../data/announcements'
import Icon from '../Icon.vue'

const props = defineProps({
  notice: { type: Object, required: true }
})
const emit = defineEmits(['close'])
const { t } = useI18n()

const hideToday = ref(false)

function close() {
  // 看到就算讀過。蓋板是主動推到人臉上的，再要求他去公告列表點一次才算讀，紅點就會
  // 變成一個永遠消不掉的東西。記的是信箱那一列的鍵（noticeKey），不是公告編號 ——
  // 信箱問的是「a3 讀過沒」，記成 3 的話那一列永遠都是未讀。
  markRead(noticeKey(props.notice.id))
  if (hideToday.value) hideSplashToday(props.notice.id)
  // 關掉的是哪一則要由這裡講。勾了「今日不再顯示」的話，上面那行已經把自己從待跳的
  // 那疊裡拿掉了，外面再去讀「現在該跳哪一則」拿到的會是下一則 —— 等於一次按掉兩則。
  emit('close', props.notice.id)
}
</script>

<template>
  <div class="ns" @click.self="close">
    <div class="ns-sheet" role="dialog" aria-modal="true">
      <button class="ns-x" :aria-label="t('common.close')" @click="close"><Icon name="x" /></button>

      <img v-if="notice.imageUrl" class="ns-img" :src="notice.imageUrl" :alt="notice.title">

      <div class="ns-body">
        <h2 class="ns-title">{{ notice.title }}</h2>
        <!-- 換行照著後台打的走。公告常常是一行一件事，擠成一段就沒有人讀得下去。 -->
        <p v-for="(line, i) in (notice.body || '').split('\n')" :key="i" class="ns-line">{{ line }}</p>
      </div>

      <label class="ns-skip">
        <input v-model="hideToday" type="checkbox">
        <span>{{ t('mailbox.hideToday') }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.ns {
  position: fixed;
  inset: 0;
  z-index: 9900;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  /* 透明灰。比條款那種浮層再深一點 —— 它是整個畫面唯一要被看的東西。 */
  background: rgba(40, 40, 38, 0.66);
}
.ns-sheet {
  position: relative;
  width: 100%;
  max-width: 22rem;
  max-height: 86vh; max-height: 86dvh;
  overflow-y: auto;
  border-radius: 0.875rem;
  background: #FFFDF7;
  color: #1F1F1D;
  box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.35);
}
.ns-x {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 1.875rem;
  height: 1.875rem;
  border: 0;
  border-radius: 50%;
  /* 圖可能一路頂到角落，所以關閉鈕自帶底色 —— 疊在淺色照片上會整顆消失。 */
  background: rgba(31, 31, 29, 0.55);
  color: #fff;
  font-size: 0.9375rem;
  cursor: pointer;
}
.ns-img { display: block; width: 100%; border-radius: 0.875rem 0.875rem 0 0; }
.ns-body { padding: 0.875rem 1rem 0.25rem; }
.ns-title { margin: 0 0 0.5rem; font-size: 1rem; font-weight: 800; }
.ns-line { margin: 0 0 0.375rem; font-size: 0.8125rem; line-height: 1.8; color: #3A3A35; }
.ns-line:empty { height: 0.5rem; }

.ns-skip {
  display: flex;
  align-items: center;
  gap: 0.4375rem;
  padding: 0.75rem 1rem 1rem;
  font-size: 0.75rem;
  color: #6B6B66;
  cursor: pointer;
}
.ns-skip input { width: 0.9375rem; height: 0.9375rem; accent-color: #1F1F1D; }
</style>
