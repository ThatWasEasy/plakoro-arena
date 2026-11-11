<!-- Admin-only: 哪一檔訂閱看得到手冊的哪幾冊。
     手冊是訂閱制，所以權限不是一張持有清單，而是比兩個位置：玩家的方案 rank >= 這一冊
     要求的 rank。這個畫面就是在編那兩件事 —— 階梯本身，以及每一冊站在階梯的哪一階。

     為什麼要有這個後台：這些是營運決定（當季結束、加開一檔、某章降階），不該每次都變成
     重切 190 頁 PDF 再重新部署。切書算出來的 tier 留著當預設值，這裡存的蓋過它。 -->
<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as adminApi from '../../data/adminApi'
import { applyServerConfig } from '../../data/handbookTiers'
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
// 可買的期間與折扣，從同一份設定讀回來 —— 改價確認頁要照它換算年繳實收多少，而那個
// 數字不能是這個畫面自己猜的。
const periods = ref([])
// unitId → 最後一天。跟 access 分開存，因為它不是階梯上的位置而是階梯的例外，而且它
// 按一下就直接送出，不跟著下面那顆「儲存」走。
const freeUntil = ref({})
// 下架中的冊子：id → 封面那條字。有值就是下架。
const holds = ref({})
// 整家書店開了沒。跟逐冊下架是兩件事：那是一本，這是全部。
const shopOpen = ref(false)
const units = ref([])
const busy = ref(true)
const saving = ref(false)
const error = ref('')
const saved = ref(false)

// 存檔前的樣子。有了它才知道「有沒有改」，不然存檔鈕永遠是亮的，看不出自己改了沒。
let snapshot = ''
// 價格單獨再留一份。整份快照只答得出「有沒有改」，但改價要問的是「從多少改成多少」——
// 那是唯一一種按錯就會從真實的信用卡上扣錯錢的修改。
const basePrices = ref({})
const current = computed(() => JSON.stringify({ tiers: tiers.value, access: access.value }))
const dirty = computed(() => current.value !== snapshot)

/**
 * 按下當天起算七天，含當天。
 *
 * 刻意不對齊到星期日：這個按鈕是配著社團公告用的，而公告是按下去之後才發的。對齊週日
 * 的話，星期五按下去只剩三天，貼文還沒傳開就過期了 —— 試讀期的長度不該取決於那天星期幾。
 *
 * until 是最後一天、當天仍然有效，所以七天是 +6 而不是 +7。
 */
/**
 * 'YYYY-MM-DD'，照按下去的人所在地的日期算。
 *
 * 不用 toISOString()：那是 UTC 的日期。台灣是 UTC+8，所以凌晨零點到八點之間，UTC 還
 * 停在前一天 —— 那段時間按下去會少給一天。試閱的到期日是會被人記在行事曆上的東西。
 */
function localDate(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const today = localDate(new Date())

function sevenDays() {
  const d = new Date()
  d.setDate(d.getDate() + 6)
  return localDate(d)
}

async function toggleFree(u) {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    const cfg = freeUntil.value[u.id]
      ? await adminApi.clearHandbookFree(adminToken.value, u.id)
      : await adminApi.setHandbookFree(adminToken.value, u.id, sevenDays(), 'weekly')
    freeUntil.value = cfg.freeUntil || {}
    holds.value = cfg.holds || {}
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

/**
 * 下架 / 重新上架。
 *
 * 立刻生效、立刻存檔，跟免費試讀一樣 —— 它常常是臨時決定要按的（發現某一章印錯了），
 * 不該跟其他還沒存的修改綁在同一次送出。
 */
/** 開賣 / 停售。立刻生效 —— 這是上線當天要按的那顆鈕，不該跟其他未存的修改綁在一起。 */
async function toggleShop() {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    const cfg = await adminApi.setHandbookShopOpen(adminToken.value, !shopOpen.value)
    shopOpen.value = !!cfg.open
    // 首頁那張卡片讀的是共用的那一份，而首頁此刻已經掛著了 —— 不同步的話要重新整理
    // 才看得到開賣。其他兩顆鈕（下架、試讀）只影響書架，而書架每次打開都會重抓。
    applyServerConfig(cfg)
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

async function toggleHold(u) {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    const cfg = holds.value[u.id]
      ? await adminApi.releaseHandbookUnit(adminToken.value, u.id)
      : await adminApi.holdHandbookUnit(adminToken.value, u.id, '', 'admin')
    holds.value = cfg.holds || {}
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

/** 改試閱的到期日。空字串代表關掉試閱。 */
async function setFreeUntil(u, until) {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    const cfg = until
      ? await adminApi.setHandbookFree(adminToken.value, u.id, until, 'admin')
      : await adminApi.clearHandbookFree(adminToken.value, u.id)
    freeUntil.value = cfg.freeUntil || {}
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

function mark() {
  snapshot = current.value
  basePrices.value = Object.fromEntries(
    tiers.value.filter(x => x.key !== FREE).map(x => [x.key, x.usd === '' ? null : Number(x.usd)])
  )
  saved.value = false
}

/**
 * 這次存檔會動到哪些價格。空陣列就代表這次沒碰錢。
 *
 * 新增一檔有價的、刪掉一檔有價的，都算 —— 前者是多了一個會被收費的東西，後者是少了
 * 一個，兩種都該在確認頁上被看見。
 */
const priceChanges = computed(() => {
  const out = []
  const now = tiers.value.filter(x => x.key !== FREE)
  for (const x of now) {
    const to = x.usd === '' ? null : Number(x.usd)
    const had = Object.prototype.hasOwnProperty.call(basePrices.value, x.key)
    const from = had ? basePrices.value[x.key] : null
    if (!had) {
      if (to !== null) out.push({ key: x.key, name: x.name || x.key, from: null, to, kind: 'new' })
    } else if (to !== from) {
      out.push({ key: x.key, name: x.name || x.key, from, to, kind: 'change' })
    }
  }
  for (const key of Object.keys(basePrices.value)) {
    if (now.some(x => x.key === key)) continue
    out.push({ key, name: key, from: basePrices.value[key], to: null, kind: 'gone' })
  }
  return out
})

const confirming = ref(false)
const typed = ref('')

/**
 * 第二道關卡要打的字：這次所有新價格，由上到下。
 *
 * 用數字而不是「確認」兩個字，是因為會出事的從來不是「不小心按到存檔」，而是 149 打成
 * 1490 —— 要擋的是那個，而要擋住它，手就得再走一次那幾位數。
 */
const wantTyped = computed(() => priceChanges.value.filter(c => c.to !== null).map(c => c.to).join(' '))
const typedOk = computed(() => !wantTyped.value || typed.value.trim().replace(/\s+/g, ' ') === wantTyped.value)

/** 這個月費在某個期間下實際會收多少 —— 跟方案頁、跟伺服器開單用的是同一個公式。 */
function amountFor(monthly, p) {
  return (Number(monthly) || 0) * (p.months - p.free)
}

function requestSave() {
  // 沒動到錢就照舊，一下存檔。確認頁天天跳的話，它會變成一個大家閉著眼睛按掉的東西。
  if (!priceChanges.value.length) return save()
  typed.value = ''
  confirming.value = true
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
    tiers.value = (config.tiers || []).map(x => ({ ...x, usd: x.usd ?? '', joinUrl: x.joinUrl || '', hidden: !!x.hidden }))
    access.value = { ...(config.access || {}) }
    freeUntil.value = { ...(config.freeUntil || {}) }
  holds.value = { ...(config.holds || {}) }
  shopOpen.value = !!config.open
    periods.value = config.periods || []
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
  tiers.value = [...tiers.value, { key: `tier${n}`, name: '', usd: '', joinUrl: '', hidden: false }]
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
  confirming.value = false
  saving.value = true
  error.value = ''
  try {
    const payload = {
      tiers: tiers.value.map(x => ({
        key: x.key,
        name: x.name,
        usd: x.usd === '' ? null : Number(x.usd),
        // 畫面上沒有這一欄了：站內結帳上線之後沒有任何地方把人送去 Patreon。
        // 這裡照樣把讀到的值原樣送回去，免得一次儲存就把資料庫裡的舊字串清掉。
        joinUrl: x.joinUrl,
        hidden: !!x.hidden
      })),
      access: access.value
    }
    const fresh = await adminApi.saveHandbookTiers(adminToken.value, payload)
    tiers.value = (fresh.tiers || []).map(x => ({ ...x, usd: x.usd ?? '', joinUrl: x.joinUrl || '', hidden: !!x.hidden }))
    access.value = { ...(fresh.access || {}) }
    freeUntil.value = { ...(fresh.freeUntil || {}) }
    holds.value = { ...(fresh.holds || {}) }
    shopOpen.value = !!fresh.open
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
        <!-- 整家書店的開關。擺在最上面：其他設定都在回答「誰能讀哪一冊」，這一顆回答
             「現在有沒有書店」，關著的話下面每一格都還不生效。 -->
        <div class="ah-shop" :class="{ on: shopOpen }">
          <span class="ah-shop-name">{{ t('admin.handbookShop') }}</span>
          <button class="ah-shop-btn" :disabled="saving" @click="toggleShop">
            {{ shopOpen ? t('admin.handbookShopOpen') : t('admin.handbookShopClosed') }}
          </button>
        </div>

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
              <!-- 下架 ≠ 刪除。刪掉會被訂了這一檔的人的外鍵擋住，而且「暫時不賣」跟
                   「這檔不存在了」本來就不是同一件事 —— 下架之後階梯照舊、已訂的人照舊。 -->
              <button
                class="ah-mini"
                :class="{ off: tier.hidden }"
                :title="t('admin.handbookHidden')"
                @click="tier.hidden = !tier.hidden"
              >{{ tier.hidden ? '🚫' : '👁' }}</button>
              <button class="ah-mini" :disabled="i <= 1" @click="moveTier(i, -1)">↑</button>
              <button class="ah-mini" :disabled="i === tiers.length - 1" @click="moveTier(i, 1)">↓</button>
              <button class="ah-mini del" @click="removeTier(i)">✕</button>
            </template>
            <span v-else class="ah-free">{{ t('admin.handbookFreeBadge') }}</span>
          </div>
          <p v-if="tier.key === FREE" class="ah-note">{{ t('admin.handbookFreeHint') }}</p>
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
            <!-- 權限等級的左邊：按下去這一冊本週對所有人開放，無視它右邊設的那一檔。
                 兩者刻意分開 —— 把它做成「把等級降到 free」的話，期限過了得記得改回來，
                 而那種「記得改回來」正是遲早會忘的事。 -->
            <button
              class="ah-trial"
              :class="{ on: freeUntil[u.id] }"
              :disabled="saving"
              :title="freeUntil[u.id] ? t('handbook.freeUntil', { date: freeUntil[u.id] }) : t('handbook.freeThisWeek')"
              @click="toggleFree(u)"
            >{{ freeUntil[u.id] ? t('handbook.freeOn') : t('handbook.freeOff') }}</button>
            <!-- 下架：按下去連買到那一檔的人也讀不到，書架上那本會帶一條「監修中」。
                 跟右邊的方案選單是兩件事 —— 那邊答「要買哪一檔」，這邊答「現在給不給讀」。 -->
            <button
              class="ah-hold"
              :class="{ on: holds[u.id] }"
              :disabled="saving"
              :title="t('admin.handbookHoldHint')"
              @click="toggleHold(u)"
            >{{ t('admin.handbookHold') }}</button>
            <span class="ah-unit-name" :class="{ held: holds[u.id] }">{{ u.title }}</span>
            <!-- 沿用預設時把預設值寫在選項裡，不然「預設」兩個字沒有告訴任何人它是哪一檔。 -->
            <!-- 試閱開著的時候才出現。到期日要能改 —— 「按一下給七天」只是個預設，
                 真正要回答的是「開放到哪一天」。 -->
            <input
              v-if="freeUntil[u.id]"
              class="ah-in ah-trial-date"
              type="date"
              :value="freeUntil[u.id]"
              :min="today"
              :disabled="saving"
              @change="setFreeUntil(u, $event.target.value)"
            >
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
      <button class="btn" :disabled="!dirty || saving" @click="requestSave">
        {{ saving ? t('admin.handbookSaving') : t('common.save') }}
      </button>
      <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
    </div>

    <!-- 改價的第二道門。只在真的動到金額時才出現 —— 每次存檔都跳的確認頁，三天之內就
         會變成一個閉著眼睛按掉的東西，那時它擋不住任何事。 -->
    <div v-if="confirming" class="ap" @click.self="confirming = false">
      <div class="ap-sheet">
        <h3 class="ap-title">{{ t('admin.priceConfirmTitle') }}</h3>
        <p class="ap-lede">{{ t('admin.priceConfirmLede') }}</p>

        <div v-for="c in priceChanges" :key="c.key" class="ap-row">
          <div class="ap-head">
            <strong>{{ (c.name || '').split('｜')[0] || c.key }}</strong>
            <span v-if="c.kind === 'new'" class="ap-tag">{{ t('admin.priceNew') }}</span>
            <span v-else-if="c.kind === 'gone'" class="ap-tag gone">{{ t('admin.priceGone') }}</span>
          </div>
          <div class="ap-money">
            <span class="ap-from">{{ c.from === null ? t('admin.priceNoPrice') : `NT$ ${c.from}` }}</span>
            <span class="ap-arrow">→</span>
            <span class="ap-to">{{ c.to === null ? t('admin.priceNoPrice') : `NT$ ${c.to}` }}</span>
            <span class="ap-unit">{{ t('admin.pricePerMonth') }}</span>
          </div>
          <!-- 月費不是買家看到的數字。真正會被刷的是乘完期數、扣掉折抵月之後的金額，
               所以確認頁上列的是那個。 -->
          <ul v-if="c.to !== null" class="ap-periods">
            <li v-for="prd in periods" :key="prd.key">
              <span>{{ t(`handbook.period.${prd.key}`) }}</span>
              <span class="ap-amt">NT$ {{ amountFor(c.to, prd) }}</span>
            </li>
          </ul>
        </div>

        <p class="ap-safe">{{ t('admin.priceSafe') }}</p>

        <template v-if="wantTyped">
          <label class="ap-ask">{{ t('admin.priceTypeToConfirm', { n: wantTyped }) }}</label>
          <input v-model="typed" class="ah-in ap-in" inputmode="numeric" autocomplete="off">
        </template>

        <div class="ap-foot">
          <button class="btn secondary" @click="confirming = false">{{ t('common.cancel') }}</button>
          <button class="btn" :disabled="!typedOk || saving" @click="save">{{ t('admin.priceConfirmCta') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ah-board { display: flex; flex-direction: column; min-height: 0; }

/* 改價確認。蓋在整個後台之上，因為它問的事情比底下任何一欄都重要。 */
.ap {
  position: fixed;
  inset: 0;
  z-index: 9700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.6);
}
.ap-sheet {
  width: 100%;
  max-width: 26rem;
  max-height: 86vh; max-height: 86dvh;
  overflow-y: auto;
  padding: 1rem;
  border-radius: 0.75rem;
  background: var(--card, #fff);
  color: var(--ink, #1b1b1b);
}
.ap-title { margin: 0 0 0.25rem; font-size: 0.9375rem; font-weight: 800; }
.ap-lede { margin: 0 0 0.75rem; font-size: 0.6875rem; line-height: 1.7; color: var(--sub); }
.ap-row {
  padding: 0.5rem 0;
  border-top: 1px solid var(--line, rgba(0, 0, 0, 0.12));
}
.ap-head { display: flex; align-items: center; gap: 0.375rem; font-size: 0.8125rem; }
.ap-tag {
  padding: 0.0625rem 0.375rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.08);
  font-size: 0.5625rem;
  font-weight: 800;
}
.ap-tag.gone { background: rgba(200, 60, 40, 0.16); color: #B3341F; }
.ap-money {
  display: flex;
  align-items: baseline;
  gap: 0.375rem;
  margin-top: 0.1875rem;
  font-variant-numeric: tabular-nums;
}
.ap-from { font-size: 0.8125rem; color: var(--sub); text-decoration: line-through; }
.ap-arrow { color: var(--sub); }
.ap-to { font-size: 1.125rem; font-weight: 800; }
.ap-unit { font-size: 0.625rem; color: var(--sub); }
.ap-periods { margin: 0.375rem 0 0; padding: 0; list-style: none; }
.ap-periods li {
  display: flex;
  justify-content: space-between;
  padding: 0.125rem 0;
  font-size: 0.6875rem;
  color: var(--sub);
}
.ap-amt { font-variant-numeric: tabular-nums; }
.ap-safe {
  margin: 0.75rem 0;
  padding: 0.5rem 0.625rem;
  border-radius: 0.5rem;
  background: rgba(0, 0, 0, 0.05);
  font-size: 0.6875rem;
  line-height: 1.7;
}
.ap-ask { display: block; margin-bottom: 0.25rem; font-size: 0.6875rem; font-weight: 700; }
.ap-in { width: 100%; }
.ap-foot { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
.ap-foot .btn { flex: 1; }
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
.ah-mini.off { background: #A8571F; color: #fff; }
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
  /* 試閱的日期欄出現時讓它換行，不要跟冊名擠在同一行把名字壓扁。 */
  flex-wrap: wrap;
}
.ah-trial-date { flex: none; width: 8.5rem; font-size: 0.625rem; }
/* 等級下拉的左邊，窄到不會跟冊名搶位置。開啟時整顆翻成實心，因為這是個會花錢的狀態
   （這一冊現在不收錢了），掃過一排時要一眼看得出哪幾冊正開著。 */
.ah-trial {
  flex: none;
  padding: 0.1875rem 0.4375rem;
  border: 0.0625rem solid var(--line);
  border-radius: 999px;
  background: none;
  color: var(--sub);
  font: inherit;
  font-size: 0.5625rem;
  font-weight: 700;
  cursor: pointer;
}
.ah-trial.on { background: #A8571F; border-color: #A8571F; color: #fff; }
.ah-trial:disabled { opacity: .45; cursor: default; }

/* 跟試讀鍵同一個形狀，顏色不同：試讀是放寬（暖橘），下架是收回（深灰）。 */
.ah-hold {
  flex: none;
  padding: 0.1875rem 0.4375rem;
  border: 0.0625rem solid var(--line);
  border-radius: 999px;
  background: none;
  color: var(--sub);
  font: inherit;
  font-size: 0.5625rem;
  font-weight: 700;
  cursor: pointer;
}
.ah-hold.on { background: #3A3A3A; border-color: #3A3A3A; color: #fff; }

.ah-shop {
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  margin-bottom: 0.625rem; padding: 0.5rem 0.625rem;
  border: 0.0625rem solid var(--line); border-radius: var(--radius-sm);
  background: #EFEDE6;
}
.ah-shop.on { background: #E3F0E4; border-color: #2E7D4F; }
.ah-shop-name { font-size: 0.6875rem; font-weight: 800; color: var(--ink); }
.ah-shop-btn {
  flex: none; padding: 0.25rem 0.625rem;
  border: 0.0625rem solid var(--ink); border-radius: 999px;
  background: var(--ink); color: #fff;
  font: inherit; font-size: 0.625rem; font-weight: 800; cursor: pointer;
}
.ah-shop.on .ah-shop-btn { background: #2E7D4F; border-color: #2E7D4F; }
.ah-shop-btn:disabled { opacity: .45; cursor: default; }
.ah-hold:disabled { opacity: .45; cursor: default; }

.ah-unit-name {
  flex: 1;
  min-width: 0; font-size: 0.625rem; font-weight: 700;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 下架中的書名劃掉：一眼看出這一列現在不給讀，不必去比對旁邊那顆鍵亮不亮。 */
.ah-unit-name.held { text-decoration: line-through; color: var(--sub); }

.ah-foot {
  flex: none; display: flex; align-items: center; justify-content: center; gap: 0.5rem;
  padding: 0.5rem 0 0.125rem;
}
.ah-saved { font-size: 0.625rem; font-weight: 800; color: var(--sub); }
</style>
