<!-- Admin-only：公告。
     玩家端的未讀狀態記在**裝置**上（見 data/announcements.js），伺服器只存「有哪些公告」，
     所以這個畫面沒有任何「誰讀過」可以看 —— 那份資料從來不會離開那台瀏覽器。 -->
<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { deleteAnnouncement, listAnnouncements, saveAnnouncement } from '../../data/adminApi'
import { adminToken } from '../../data/adminSession'

const emit = defineEmits(['back'])
const { t } = useI18n()

const list = ref([])
const busy = ref(false)
const error = ref('')
const editing = ref(null)

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

const load = () => run(async () => { list.value = (await listAnnouncements(adminToken.value)).announcements })
load()

// 一則公告現在處於哪一段。
//
//   刊登中   玩家現在看得到
//   預約發布 已發布，但還沒到開始日 —— 時間到自己上架，不必有人記得回來按
//   草稿     沒勾發布的，寫好放著
//   已結束   過了結束日、自己下架的
//
// 「發布」是總開關，開始／結束日是排程：沒勾發布，日期填得再漂亮也不會上架；勾了
// 發布而日期留白，就是立刻上架、不會自己下架。兩個欄位問的是不同的問題，所以都留著。
function phaseOf(a) {
  if (!a.published) return 'draft'
  const now = Date.now()
  if (a.startsAt && new Date(a.startsAt).getTime() > now) return 'scheduled'
  if (a.endsAt && new Date(a.endsAt).getTime() < now) return 'ended'
  return 'live'
}

// 前三個分頁固定在，空的也留著 —— 那三個名字本身就是這個畫面在講的規則，看到
// 「預約發布 0」比看不到那一頁更清楚。已結束只在真的有東西時才長出來：它是堆積物，
// 不是一個需要被記得的狀態。
const TABS = [
  { key: 'live', label: 'Live' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'draft', label: 'Draft' },
  { key: 'ended', label: 'Ended' }
]

const tab = ref('live')

const tabs = computed(() => TABS
  .map(g => ({ ...g, items: list.value.filter(a => phaseOf(a) === g.key) }))
  .filter(g => g.key !== 'ended' || g.items.length))

// 看的那一頁如果整個消失（最後一則已結束的被刪掉），回到刊登中，而不是留在一個
// 已經不存在的分頁上看空白。
const current = computed(() => tabs.value.find(g => g.key === tab.value) || tabs.value[0])

function blank() {
  return { id: null, title: '', body: '', imageUrl: '', category: 'notice', splash: false, pinned: false, published: true, startsAt: '', endsAt: '' }
}

function edit(a) {
  editing.value = a ? {
    id: a.id,
    title: a.title,
    body: a.body || '',
    imageUrl: a.imageUrl || '',
    category: a.category || 'notice',
    splash: a.splash,
    pinned: a.pinned,
    published: a.published,
    startsAt: (a.startsAt || '').slice(0, 10),
    endsAt: (a.endsAt || '').slice(0, 10)
  } : blank()
}

const save = () => run(async () => {
  const e = editing.value
  await saveAnnouncement(adminToken.value, {
    ...e,
    // 日期收的是「哪一天」，送出去的是那天的起點與終點。後台填的人想的是日期，不是時刻。
    startsAt: e.startsAt ? `${e.startsAt}T00:00:00` : null,
    endsAt: e.endsAt ? `${e.endsAt}T23:59:59` : null
  })
  editing.value = null
  await load()
})

const remove = a => run(async () => {
  await deleteAnnouncement(adminToken.value, a.id)
  await load()
})
</script>

<template>
  <div class="board select-board an-board">
    <!-- 列表與編輯是兩個畫面，不是同一頁的上下段。編輯表單接在列表後面時，按下「編輯」
         之後真正要操作的欄位在整串公告的下方，每改一個欄位都要先捲過一遍列表；而且畫面
         上同時有兩份東西在搶注意力，看不出來自己正在編的是哪一則。 -->
    <div class="modal-title">{{ editing ? (editing.id ? `#${editing.id}` : t('admin.noticeNew')) : t('admin.noticeTitle') }}</div>

    <div v-if="editing" class="an-scroll">
      <p v-if="error" class="an-error">{{ error }}</p>
      <label class="an-f"><span>{{ t('admin.noticeFieldTitle') }}</span>
        <input v-model="editing.title" class="an-in"></label>
      <label class="an-f top"><span>{{ t('admin.noticeFieldBody') }}</span>
        <textarea v-model="editing.body" class="an-in" rows="8"></textarea></label>
      <label class="an-f"><span>{{ t('admin.noticeFieldImage') }}</span>
        <input v-model="editing.imageUrl" class="an-in" placeholder="image/notice/2026-11.webp"></label>
      <!-- 決定它出現在玩家信箱的哪一個分頁。禮物是另一回事（來自解鎖與點數），
           不在這張表裡，所以這裡只有兩種。 -->
      <label class="an-f"><span>{{ t('admin.noticeCategory') }}</span>
        <select v-model="editing.category" class="an-in">
          <option value="notice">{{ t('mailbox.cat.notice') }}</option>
          <option value="handbook">{{ t('mailbox.cat.handbook') }}</option>
        </select>
      </label>
      <label class="an-f"><span>{{ t('admin.noticeSplash') }}</span>
        <input v-model="editing.splash" type="checkbox"></label>
      <label class="an-f"><span>{{ t('admin.noticePinned') }}</span>
        <input v-model="editing.pinned" type="checkbox"></label>
      <label class="an-f"><span>{{ t('admin.noticePublished') }}</span>
        <input v-model="editing.published" type="checkbox"></label>
      <label class="an-f"><span>{{ t('admin.couponStarts') }}</span>
        <input v-model="editing.startsAt" class="an-in" type="date"></label>
      <label class="an-f"><span>{{ t('admin.couponEnds') }}</span>
        <input v-model="editing.endsAt" class="an-in" type="date"></label>
    </div>

    <div v-else class="an-scroll">
      <p v-if="error" class="an-error">{{ error }}</p>
      <div class="an-bar">
        <button class="an-btn" @click="edit(null)">{{ t('admin.noticeNew') }}</button>
        <button class="an-btn ghost" @click="load">{{ t('admin.salesReload') }}</button>
      </div>

      <!-- 分頁而不是三段堆在一起：同一串裡混著「玩家正在看的」「還沒到時間的」「關掉的」，
           要確認「現在到底掛著什麼」就得一則一則去對發布欄位跟兩個日期；堆成三段又得
           一直捲。切到哪一頁，那一頁就是全部。 -->
      <div class="an-tabs">
        <button
          v-for="g in tabs"
          :key="g.key"
          :class="['an-tab', { on: tab === g.key }]"
          @click="tab = g.key"
        >{{ t(`admin.noticeGroup${g.label}`) }} {{ g.items.length }}</button>
      </div>

      <div v-for="a in current.items" :key="a.id" class="an-item">
        <div class="an-top">
          <span class="an-id">#{{ a.id }}</span>
          <span class="an-title">{{ a.title }}</span>
          <span class="an-grow"></span>
          <span class="an-tag">{{ t(`mailbox.cat.${a.category === 'handbook' ? 'handbook' : 'notice'}`) }}</span>
          <span v-if="a.splash" class="an-tag splash">{{ t('admin.noticeSplash') }}</span>
          <span v-if="a.pinned" class="an-tag">{{ t('admin.noticePinned') }}</span>
        </div>
        <div v-if="a.startsAt || a.endsAt" class="an-sub">
          {{ (a.startsAt || '').slice(0, 10) || '—' }} ~ {{ (a.endsAt || '').slice(0, 10) || '—' }}
        </div>
        <div class="an-act">
          <button class="an-btn ghost" @click="edit(a)">{{ t('admin.couponEdit') }}</button>
          <button class="an-btn ghost" @click="remove(a)">{{ t('admin.couponDelete') }}</button>
        </div>
      </div>
      <p v-if="!current.items.length" class="an-empty">{{ t('admin.noticeEmpty') }}</p>
    </div>

    <!-- 儲存／取消釘在底部：表單再長，送出的那顆鍵都在同一個位置，不必捲到最後才找得到。 -->
    <div class="an-foot">
      <template v-if="editing">
        <button class="an-btn" :disabled="busy || !editing.title.trim()" @click="save">{{ t('common.save') }}</button>
        <button class="an-btn ghost" @click="editing = null">{{ t('common.cancel') }}</button>
      </template>
      <button v-else class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
    </div>
  </div>
</template>

<style scoped>
.an-board { display: flex; flex-direction: column; min-height: 0; }
.an-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 0.125rem; }
.an-foot { display: flex; gap: 0.5rem; padding-top: 0.75rem; }
.an-error { margin: 0 0 0.5rem; font-size: 0.75rem; font-weight: 700; color: #C0392B; }
.an-bar { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
.an-btn {
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
.an-btn.ghost { background: none; color: var(--ink); }
.an-btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* 連在一起的一條，不是四顆各自獨立的按鈕 —— 跟玩家資料那三個分頁同一套：共用邊框
   （負 margin 疊起來）、只有最外兩個角是圓的。 */
.an-tabs { display: flex; margin-bottom: 0.5rem; }
.an-tab {
  flex: 1;
  min-width: 0;
  padding: 0.375rem 0.25rem;
  border: 0.0625rem solid var(--line);
  margin-left: -0.0625rem;
  background: #fff;
  color: var(--ink);
  font: inherit;
  font-size: 0.6875rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  position: relative;
}
.an-tab:first-child { margin-left: 0; border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
.an-tab:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.an-tab.on { background: #1F1F1D; border-color: #1F1F1D; color: #fff; z-index: 1; }
.an-empty { margin: 1.25rem 0; font-size: 0.75rem; text-align: center; color: var(--sub); }

.an-item { padding: 0.5rem 0; border-top: 1px solid var(--line); }
.an-top { display: flex; align-items: center; gap: 0.375rem; }
.an-id { font-size: 0.625rem; color: var(--sub); font-variant-numeric: tabular-nums; }
.an-title { font-size: 0.8125rem; font-weight: 700; }
.an-grow { flex: 1; }
.an-tag {
  padding: 0.0625rem 0.375rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.08);
  font-size: 0.5625rem;
  font-weight: 800;
}
.an-tag.splash { background: rgba(168, 87, 31, 0.16); color: #A8571F; }
.an-tag.off { background: rgba(192, 57, 43, 0.14); color: #C0392B; }
.an-sub { margin-top: 0.125rem; font-size: 0.625rem; color: var(--sub); }
.an-act { display: flex; gap: 0.375rem; margin-top: 0.375rem; }

.an-f { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.375rem; font-size: 0.6875rem; }
.an-f.top { align-items: flex-start; }
.an-f > span { flex: none; width: 5rem; color: var(--sub); }
.an-in {
  flex: 1;
  min-width: 0;
  padding: 0.3125rem 0.4375rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--ink);
  font: inherit;
  font-size: 0.75rem;
}
textarea.an-in { resize: vertical; line-height: 1.6; }
</style>
