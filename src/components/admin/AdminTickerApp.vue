<!-- Admin-only：主畫面底下那條跑馬燈。
     自己一個畫面，不是公告的一個勾選：公告是一則一則要被讀完的東西（有標題與內文、
     會進信箱、有未讀紅點），跑馬燈只有一行字跟一段時間。發一條跑馬燈不該先逼人發一則
     沒有人要讀的公告。

     同時有多條就一條接一條跑，所以每一條都要能單獨成立 —— 它不會有上下文。 -->
<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { deleteTicker, listTicker, saveTicker } from '../../data/adminApi'
import { adminToken } from '../../data/adminSession'

const emit = defineEmits(['back'])
const { t } = useI18n()

const list = ref([])
const editing = ref(null)
const busy = ref(false)
const error = ref('')

async function run(fn) {
  busy.value = true
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

const load = () => run(async () => { list.value = (await listTicker(adminToken.value)).messages })
load()

/**
 * datetime-local 的值 ⇄ 伺服器的時間戳。
 *
 * 轉換在瀏覽器做，因為「11/15 20:00」指的是填的人所在地的 20:00；送一個沒有時區的
 * 字串上去，是由伺服器那台機器（UTC）去解讀它。
 */
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function toIso(local) {
  return local ? new Date(local).toISOString() : null
}
function shortStamp(iso) {
  return iso ? toLocalInput(iso).replace('T', ' ') : '—'
}

/** 這一條現在在不在帶子上。停用、還沒開始、已經結束，玩家都看不到。 */
function liveNow(m) {
  if (!m.active) return false
  const now = Date.now()
  if (m.startsAt && new Date(m.startsAt).getTime() > now) return false
  if (m.endsAt && new Date(m.endsAt).getTime() < now) return false
  return true
}

// 帶子上現在長什麼樣子。多條是接起來跑的，所以要看的是接起來之後那一串 —— 一條一條
// 分開看不出「跑完一輪要多久」。
const preview = computed(() => list.value.filter(liveNow).map(m => m.text).join('　・　'))

function edit(m) {
  editing.value = m
    ? { id: m.id, text: m.text, active: m.active, startsAt: toLocalInput(m.startsAt), endsAt: toLocalInput(m.endsAt) }
    : { id: null, text: '', active: true, startsAt: '', endsAt: '' }
}

const save = () => run(async () => {
  const e = editing.value
  await saveTicker(adminToken.value, {
    id: e.id,
    text: e.text.trim(),
    active: e.active,
    startsAt: toIso(e.startsAt),
    endsAt: toIso(e.endsAt)
  })
  editing.value = null
  await load()
})

const remove = m => run(async () => {
  await deleteTicker(adminToken.value, m.id)
  await load()
})
</script>

<template>
  <div class="board select-board tk-board">
    <div class="modal-title">{{ editing ? (editing.id ? `#${editing.id}` : t('admin.tickerNew')) : t('admin.tickerTitle') }}</div>

    <!-- 列表與編輯是兩個畫面，不是同一頁的上下段。 -->
    <div v-if="editing" class="tk-scroll">
      <p v-if="error" class="tk-error">{{ error }}</p>
      <label class="tk-f top">
        <span>{{ t('admin.tickerText') }}</span>
        <textarea v-model="editing.text" class="tk-in" rows="3"></textarea>
      </label>
      <label class="tk-f">
        <span>{{ t('admin.couponFrom') }}</span>
        <input v-model="editing.startsAt" class="tk-in" type="datetime-local">
      </label>
      <label class="tk-f">
        <span>{{ t('admin.couponTo') }}</span>
        <input v-model="editing.endsAt" class="tk-in" type="datetime-local">
      </label>
      <label class="tk-f">
        <span>{{ t('admin.couponActive') }}</span>
        <input v-model="editing.active" type="checkbox">
      </label>
    </div>

    <div v-else class="tk-scroll">
      <p v-if="error" class="tk-error">{{ error }}</p>

      <!-- 帶子現在長什麼樣子。這個畫面唯一要回答的問題就是這個，所以它排在最上面，
           而且是接起來之後的那一串。 -->
      <div class="tk-preview">
        <span v-if="preview" class="tk-preview-text">{{ preview }}</span>
        <span v-else class="tk-preview-none">{{ t('admin.tickerEmpty') }}</span>
      </div>

      <div class="tk-bar">
        <button class="tk-btn" @click="edit(null)">{{ t('admin.tickerNew') }}</button>
        <button class="tk-btn ghost" @click="load">{{ t('admin.salesReload') }}</button>
      </div>

      <div v-for="m in list" :key="m.id" class="tk-item">
        <div class="tk-top">
          <span class="tk-dot" :class="{ on: liveNow(m) }"></span>
          <span class="tk-text">{{ m.text }}</span>
        </div>
        <div v-if="m.startsAt || m.endsAt" class="tk-sub">
          {{ shortStamp(m.startsAt) }} ~ {{ shortStamp(m.endsAt) }}
        </div>
        <div class="tk-act">
          <button class="tk-btn ghost" @click="edit(m)">{{ t('admin.couponEdit') }}</button>
          <button class="tk-btn ghost" @click="remove(m)">{{ t('admin.couponDelete') }}</button>
        </div>
      </div>
    </div>

    <div class="tk-foot">
      <template v-if="editing">
        <button class="tk-btn" :disabled="busy || !editing.text.trim()" @click="save">{{ t('common.save') }}</button>
        <button class="tk-btn ghost" @click="editing = null">{{ t('common.cancel') }}</button>
      </template>
      <button v-else class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
    </div>
  </div>
</template>

<style scoped>
.tk-board { display: flex; flex-direction: column; min-height: 0; }
.tk-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 0.125rem; }
.tk-foot { display: flex; gap: 0.5rem; padding-top: 0.75rem; }
.tk-error { margin: 0 0 0.375rem; font-size: 0.625rem; font-weight: 800; color: #C0392B; }

/* 做成帶子的樣子，不是一段引文：要判斷的是它在那條深色帶子上好不好讀。 */
.tk-preview {
  margin-bottom: 0.625rem;
  padding: 0.4375rem 0.625rem;
  border-radius: var(--radius-sm);
  background: #1F1F1D;
  color: #F2E8D6;
  font-size: 0.6875rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.tk-preview-none { color: rgba(242, 232, 214, 0.5); }

.tk-bar { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
.tk-btn {
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--ink);
  border-radius: var(--radius-sm);
  background: var(--ink);
  color: #fff;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
}
.tk-btn.ghost { background: none; color: var(--ink); }
.tk-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.tk-item { padding: 0.5rem 0; border-top: 1px solid var(--line); }
.tk-top { display: flex; align-items: baseline; gap: 0.375rem; }
/* 亮著 = 玩家現在看得到。停用、還沒開始、已經結束都是暗的，三種情況在這裡沒有分別，
   因為要問的只有「它在不在帶子上」—— 為什麼不在，下面那行日期會說。 */
.tk-dot {
  flex: none; width: 0.4375rem; height: 0.4375rem; margin-top: 0.1875rem;
  border-radius: 999px; background: rgba(0, 0, 0, 0.2);
}
.tk-dot.on { background: #2E7D4F; }
.tk-text { font-size: 0.8125rem; font-weight: 700; line-height: 1.5; overflow-wrap: anywhere; }
.tk-sub {
  margin: 0.125rem 0 0 0.8125rem;
  font-size: 0.625rem; color: var(--sub); font-variant-numeric: tabular-nums;
}
.tk-act { display: flex; gap: 0.375rem; margin-top: 0.375rem; }

.tk-f { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.375rem; font-size: 0.6875rem; }
.tk-f.top { align-items: flex-start; }
.tk-f > span { flex: none; width: 4rem; color: var(--sub); }
.tk-in {
  flex: 1; min-width: 0;
  padding: 0.3125rem 0.4375rem;
  border: 1px solid var(--line); border-radius: var(--radius-sm);
  background: #fff; color: var(--ink);
  font: inherit; font-size: 0.75rem;
}
textarea.tk-in { resize: vertical; line-height: 1.6; }
</style>
