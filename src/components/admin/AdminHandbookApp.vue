<!-- Admin-only: 哪一檔訂閱看得到手冊的哪幾冊。
     手冊是訂閱制，所以權限不是一張持有清單，而是比兩個位置：玩家的方案 rank >= 這一冊
     要求的 rank。這個畫面就是在編那兩件事 —— 階梯本身，以及每一冊站在階梯的哪一階。

     為什麼要有這個後台：這些是營運決定（當季結束、加開一檔、某章降階），不該每次都變成
     重切 190 頁 PDF 再重新部署。切書算出來的 tier 留著當預設值，這裡存的蓋過它。 -->
<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as adminApi from '../../data/adminApi'
import { adminToken } from '../../data/adminSession'
import { fetchManifest } from '../../data/handbookSource'

const emit = defineEmits(['back'])
const { t } = useI18n()

// 手冊沿用預設值的記號。空字串而不是 null：它要當 <select> 的 value，而 null 在 DOM
// 上會變成字串 "null"，跟一個叫 null 的方案分不開。
const INHERIT = ''

// 「沒有訂閱的人」在階梯上的位置。它是一檔真的方案，所以「免費開放哪幾冊」跟
// 「Basic 開放哪幾冊」是同一個下拉選單、同一套規則，不用另外長一張免費清單。
// 不能刪、不能移 —— 刪掉它，免費開放的冊子會變成沒有人看得到，而不是全部開放。
const FREE = 'free'

const tiers = ref([])
const access = ref({})
const units = ref([])
const busy = ref(true)
const saving = ref(false)
const error = ref('')
const saved = ref(false)

// 存檔前的樣子。有了它才知道「有沒有改」，不然存檔鈕永遠是亮的，看不出自己改了沒。
let snapshot = ''
const current = computed(() => JSON.stringify({ tiers: tiers.value, access: access.value }))
const dirty = computed(() => current.value !== snapshot)

function mark() {
  snapshot = current.value
  saved.value = false
}

async function load() {
  busy.value = true
  error.value = ''
  try {
    // 清單來自切書的 manifest，權限來自資料庫：有哪些冊子是書本身的事實，誰看得到才是
    // 營運決定。兩邊分開，新角色上架不用先在後台建一筆才看得到。
    const [config, manifest] = await Promise.all([
      adminApi.getHandbookTiers(adminToken.value),
      fetchManifest()
    ])
    tiers.value = (config.tiers || []).map(x => ({ ...x, usd: x.usd ?? '', joinUrl: x.joinUrl || '' }))
    access.value = { ...(config.access || {}) }
    units.value = manifest.units || []
    mark()
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
load()

// 依書架上的分組排，跟玩家看到的順序一樣 —— 後台的順序跟前台對不上時，找一隻角色
// 要從頭掃到尾。
const groups = computed(() => {
  const out = []
  for (const u of units.value) {
    const title = u.kind === 'character' ? (u.group || t('handbook.mainVolumes')) : t('handbook.mainVolumes')
    let g = out.find(x => x.title === title)
    if (!g) out.push(g = { title, units: [] })
    g.units.push(u)
  }
  return out
})

/** 這一冊實際生效的方案：後台設定優先，沒設定就是切書算出來的。 */
function effective(u) {
  return access.value[u.id] || u.tier || null
}

function setUnit(u, key) {
  const next = { ...access.value }
  if (key === INHERIT) delete next[u.id]
  else next[u.id] = key
  access.value = next
}

function setGroup(g, key) {
  const next = { ...access.value }
  for (const u of g.units) {
    if (key === INHERIT) delete next[u.id]
    else next[u.id] = key
  }
  access.value = next
}

// 每一檔實際看得到幾冊。這才是這個畫面真正在回答的問題 —— 一格一格點的時候很容易
// 做出一個「最低階什麼都看不到」或「最高階跟低階一樣」的階梯，加總會立刻說出來。
const coverage = computed(() => tiers.value.map((tier, i) => ({
  ...tier,
  n: units.value.filter(u => {
    const need = effective(u)
    const at = tiers.value.findIndex(x => x.key === need)
    return at >= 0 && at <= i
  }).length
})))

const orphans = computed(() => units.value.filter(u => {
  const need = effective(u)
  return !need || !tiers.value.some(x => x.key === need)
}))

function moveTier(i, by) {
  const to = i + by
  if (to < 0 || to >= tiers.value.length) return
  if (tiers.value[i].key === FREE || tiers.value[to].key === FREE) return
  const next = tiers.value.slice()
  ;[next[i], next[to]] = [next[to], next[i]]
  tiers.value = next
}

function addTier() {
  // key 是給程式用的，不是給人看的 —— 產一個不會撞的就好，名稱才是後台要填的東西。
  let n = tiers.value.length + 1
  while (tiers.value.some(x => x.key === `tier${n}`)) n++
  tiers.value = [...tiers.value, { key: `tier${n}`, name: '', usd: '', joinUrl: '' }]
}

function removeTier(i) {
  const key = tiers.value[i].key
  if (key === FREE) return
  tiers.value = tiers.value.filter((_, x) => x !== i)
  // 指著它的冊子一起退回預設，不然存檔時會被伺服器默默丟掉，畫面上卻還留著舊名字。
  const next = { ...access.value }
  for (const id of Object.keys(next)) if (next[id] === key) delete next[id]
  access.value = next
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const payload = {
      tiers: tiers.value.map(x => ({
        key: x.key,
        name: x.name,
        usd: x.usd === '' ? null : Number(x.usd),
        joinUrl: x.joinUrl
      })),
      access: access.value
    }
    const fresh = await adminApi.saveHandbookTiers(adminToken.value, payload)
    tiers.value = (fresh.tiers || []).map(x => ({ ...x, usd: x.usd ?? '', joinUrl: x.joinUrl || '' }))
    access.value = { ...(fresh.access || {}) }
    mark()
    saved.value = true
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="board select-board ah-board">
    <div class="modal-title">{{ t('admin.handbookTitle') }}</div>

    <div class="ah-scroll">
      <p v-if="error" class="ah-error">{{ error }}</p>
      <p v-if="busy" class="ah-note">{{ t('handbook.loading') }}</p>

      <template v-if="!busy">
        <!-- 階梯本身。由上到下 = 由低到高，高階自動包含低階。 -->
        <h3 class="ah-label">{{ t('admin.handbookTiers') }}</h3>
        <p class="ah-note">{{ t('admin.handbookTiersHint') }}</p>
        <div v-for="(tier, i) in tiers" :key="tier.key" class="ah-tier">
          <div class="ah-tier-top">
            <span class="ah-rank">{{ tier.key === FREE ? '—' : i }}</span>
            <input v-model="tier.name" class="ah-in grow" :placeholder="t('admin.handbookTierName')">
            <!-- 未訂閱沒有價格、不能移動、不能刪：它是「沒有方案」這個狀態，不是一檔商品。 -->
            <template v-if="tier.key !== FREE">
              <span class="ah-usd">$</span>
              <input v-model="tier.usd" class="ah-in num" type="number" min="0" step="1">
              <button class="ah-mini" :disabled="i <= 1" @click="moveTier(i, -1)">↑</button>
              <button class="ah-mini" :disabled="i === tiers.length - 1" @click="moveTier(i, 1)">↓</button>
              <button class="ah-mini del" @click="removeTier(i)">✕</button>
            </template>
            <span v-else class="ah-free">{{ t('admin.handbookFreeBadge') }}</span>
          </div>
          <input
            v-if="tier.key !== FREE"
            v-model="tier.joinUrl" class="ah-in" :placeholder="t('admin.handbookJoinUrl')"
          >
          <p v-else class="ah-note">{{ t('admin.handbookFreeHint') }}</p>
        </div>
        <button class="btn secondary ah-add" @click="addTier">{{ t('admin.handbookAddTier') }}</button>

        <!-- 這份設定實際造成的結果。一格一格點的時候最容易做出互相矛盾的階梯。 -->
        <h3 class="ah-label">{{ t('admin.handbookCoverage') }}</h3>
        <div class="ah-cover">
          <div v-for="c in coverage" :key="c.key" class="ah-cover-row">
            <span>{{ c.name || c.key }}</span>
            <span class="ah-cover-n">{{ t('handbook.volumes', { n: c.n }) }} / {{ units.length }}</span>
          </div>
        </div>
        <p v-if="orphans.length" class="ah-warn">
          {{ t('admin.handbookOrphans', { n: orphans.length, names: orphans.slice(0, 3).map(u => u.title).join('、') }) }}
        </p>

        <!-- 每一冊站在哪一階。 -->
        <h3 class="ah-label">{{ t('admin.handbookAccess') }}</h3>
        <p class="ah-note">{{ t('admin.handbookAccessHint') }}</p>
        <div v-for="g in groups" :key="g.title" class="ah-group">
          <div class="ah-group-head">
            <span>{{ g.title }}</span>
            <!-- 整組一起改。探險盒一次六隻，一隻一隻點是六次出錯的機會。 -->
            <select class="ah-in sel" @change="setGroup(g, $event.target.value); $event.target.value = '__'">
              <option value="__">{{ t('admin.handbookBulk') }}</option>
              <option :value="INHERIT">{{ t('admin.handbookInherit') }}</option>
              <option v-for="tier in tiers" :key="tier.key" :value="tier.key">{{ tier.name || tier.key }}</option>
            </select>
          </div>
          <div v-for="u in g.units" :key="u.id" class="ah-unit">
            <span class="ah-unit-name">{{ u.title }}</span>
            <!-- 沿用預設時把預設值寫在選項裡，不然「預設」兩個字沒有告訴任何人它是哪一檔。 -->
            <select
              class="ah-in sel"
              :value="access[u.id] || INHERIT"
              @change="setUnit(u, $event.target.value)"
            >
              <option :value="INHERIT">
                {{ t('admin.handbookInheritAs', { tier: tiers.find(x => x.key === u.tier)?.name || u.tier || '—' }) }}
              </option>
              <option v-for="tier in tiers" :key="tier.key" :value="tier.key">{{ tier.name || tier.key }}</option>
            </select>
          </div>
        </div>
      </template>
    </div>

    <div class="ah-foot">
      <span v-if="saved && !dirty" class="ah-saved">{{ t('admin.handbookSaved') }}</span>
      <button class="btn" :disabled="!dirty || saving" @click="save">
        {{ saving ? t('admin.handbookSaving') : t('common.save') }}
      </button>
      <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
    </div>
  </div>
</template>

<style scoped>
.ah-board { display: flex; flex-direction: column; min-height: 0; }
.ah-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 0.125rem; }

.ah-label {
  margin: 0.875rem 0 0.25rem; font-size: 0.6875rem; font-weight: 800; letter-spacing: 0.08em;
  color: var(--sub); border-bottom: 0.125rem solid var(--line); padding-bottom: 0.1875rem;
}
.ah-note { margin: 0 0 0.375rem; font-size: 0.5625rem; font-weight: 600; color: var(--sub); line-height: 1.5; }
.ah-error { margin: 0 0 0.375rem; font-size: 0.625rem; font-weight: 800; color: #C0392B; }
.ah-warn {
  margin: 0.25rem 0 0; font-size: 0.5625rem; font-weight: 700; color: #B9770E; line-height: 1.5;
}

.ah-tier {
  display: flex; flex-direction: column; gap: 0.1875rem;
  padding: 0.3125rem; margin-bottom: 0.25rem;
  border: 0.0625rem solid var(--line); border-radius: 0.375rem; background: var(--card);
}
.ah-tier-top { display: flex; align-items: center; gap: 0.25rem; }
.ah-rank {
  flex: none; width: 1rem; text-align: center;
  font-size: 0.625rem; font-weight: 800; color: var(--sub);
}
.ah-in {
  min-width: 0; font-size: 0.625rem; font-weight: 700; color: var(--ink);
  padding: 0.1875rem 0.25rem; border: 0.0625rem solid var(--line); border-radius: 0.25rem;
  background: #fff;
}
.ah-in.grow { flex: 1; }
.ah-in.num { width: 3rem; }
.ah-in.sel { flex: none; max-width: 11rem; }
.ah-usd { font-size: 0.625rem; font-weight: 800; color: var(--sub); }
.ah-mini {
  flex: none; width: 1.25rem; height: 1.25rem; padding: 0; line-height: 1;
  border: 0.0625rem solid var(--line); border-radius: 0.25rem; background: #fff;
  font-size: 0.625rem; font-weight: 800; cursor: pointer;
}
.ah-mini:disabled { opacity: 0.35; cursor: default; }
.ah-mini.del { color: #C0392B; }
.ah-add { padding: 0.1875rem 0.5rem; font-size: 0.625rem; }

.ah-cover {
  display: flex; flex-direction: column;
  border: 0.0625rem solid var(--line); border-radius: 0.375rem; overflow: hidden;
}
.ah-cover-row {
  display: flex; justify-content: space-between; gap: 0.5rem;
  padding: 0.25rem 0.375rem; font-size: 0.625rem; font-weight: 700;
  border-bottom: 0.0625rem solid var(--line); background: var(--card);
}
.ah-cover-row:last-child { border-bottom: 0; }
.ah-cover-n { color: var(--sub); font-variant-numeric: tabular-nums; }

.ah-group { margin-bottom: 0.5rem; }
.ah-group-head {
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  padding: 0.25rem 0.125rem; font-size: 0.6875rem; font-weight: 800;
}
.ah-unit {
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  padding: 0.1875rem 0.375rem; border-bottom: 0.0625rem solid var(--line);
}
.ah-unit-name {
  min-width: 0; font-size: 0.625rem; font-weight: 700;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.ah-foot {
  flex: none; display: flex; align-items: center; justify-content: center; gap: 0.5rem;
  padding: 0.5rem 0 0.125rem;
}
.ah-saved { font-size: 0.625rem; font-weight: 800; color: var(--sub); }
</style>
