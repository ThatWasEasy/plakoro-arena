<script setup>
// The shelf.
//
// Portrait and full-screen, like the reader — the whole mode steps outside #stage rather than
// only the reading view. Browsing a book and reading it are one activity, and making someone
// turn their phone between the two was the wrong seam to put a transition on.
//
// Dressed as an old document: aged paper, sepia ink, a serif face and ruled entries, because
// that is what this is — a manual, not a settings screen. The texture is a 17KB crop of the
// reference sheet rather than CSS gradients pretending to be paper, and the type does most of
// the work: a serif at a generous size reads as a book the moment it appears.
//
// Character chapters still carry their own artwork. Twenty-one of the twenty-six units are
// characters and the app already holds their portraits; numbering them instead would throw
// away the one thing that makes the shelf scannable.
import { computed, inject, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { asset } from '../../data/assetPath'
import { typeBgColor } from '../../data/constants'
import { CHARACTER_ID_BY_ZH_NAME } from '../../composables/useCharacterData'
import { currentIdentity, isSignedIn } from '../../data/currentPlayer'
import { fetchManifest, fetchTierConfig, isPrototype } from '../../data/handbookSource'
import { mostRecent, pageOf, refreshProgress, startedOf } from '../../data/handbookProgress'
import {
  applyServerConfig, freeReadUntil, holdLabel, metaOf, myTier, rankOf, setLadder, showsFreeBadge, tierFor, tierLadder, unlocked
} from '../../data/handbookTiers'
import Icon from '../Icon.vue'
import HandbookDetail from './HandbookDetail.vue'
import HandbookReader from './HandbookReader.vue'
import HandbookPlans from './HandbookPlans.vue'
import HandbookCheckout from './HandbookCheckout.vue'

// 從綠界導回來時帶著訂單編號，直接開結帳頁看結果。平常是空字串。
const props = defineProps({ ecpayOrder: { type: String, default: '' } })
const emit = defineEmits(['back', 'signIn', 'orderSeen'])
const { t } = useI18n()
const { characters } = inject('characterData')

const units = ref([])
const loading = ref(true)
const error = ref('')
const open = ref(null)

// Stand-in for the player's own plan when there is no session to read one from. 'pro' rather than the
// cheapest on purpose: it leaves both sides of the lock on screen — the past sets readable,
// the current season still shut — which is the thing worth looking at.
const PROTOTYPE_TIER = 'pro'
const showAll = ref(false)
const owns = u => showAll.value || unlocked(u)

// The handbook names characters the way the book does and the app names them the way the cards
// do (STW01 against STC01-001), so the code is no join key and the name has to be.
//
// 對的是**中文名**，不是畫面上顯示的那個名字。書永遠用中文名，而 `characters` 的 name 會跟
// 著介面語言走 —— 拿後者當鑰匙的話，整副封面與屬性底色在日文和英文介面下會全部對不上。
const byName = computed(() => {
  const byId = new Map(characters.value.map(c => [c.id, c]))
  const m = new Map()
  for (const [zhName, id] of CHARACTER_ID_BY_ZH_NAME) {
    const c = byId.get(id)
    if (c) m.set(zhName, c)
  }
  return m
})

// "一、PLAKORO 基礎規則" carries its own numbering, which is right in a printed contents list
// and wrong beside a seal showing the same character twice.
function numeral(u) {
  if (u.kind !== 'chapter') return ''
  const n = u.title.charAt(0)
  // The front matter is titled 序 with no numbering to strip, so the seal would repeat the
  // title back at itself. It gets a printer's ornament instead.
  return u.title === label(u) ? '❧' : n
}
function label(u) {
  return u.kind === 'chapter' ? u.title.replace(/^[^、]+、\s*/, '') : u.title
}

// The cut-out, which is what lets the figure cast a shadow and sit proud of the cover rather
// than being a white rectangle pasted into a circle. Falls back to the opaque original if a
// character was added without re-running scripts/cutout-chara.py.
function art(u) {
  const c = byName.value.get(u.title)
  // Derived from imageUrl, not from `c.name`: the roster is localised, so `name` is the
  // Chinese one while the files on disk are named in Japanese. Building the path from the
  // name sent every request to a filename that does not exist, and the fallback quietly
  // covered it up — 19 of 21 covers were still the opaque original.
  return c?.imageUrl
    ? c.imageUrl.replace('/CHARA/', '/CHARA-cut/').replace(/\.jpe?g$/i, '.webp')
    : null
}
function artFallback(e, u) {
  const c = byName.value.get(u.title)
  if (c?.imageUrl && e.target.src !== c.imageUrl) e.target.src = c.imageUrl
}
function tint(u) {
  const c = byName.value.get(u.title)
  return c ? typeBgColor(c.type) : '#E7E5DC'
}

// Chapters read as a contents list; characters read as plates. Grouping keeps them apart
// without needing a tab bar — the book's own order already separates them.
// The six main chapters stand on the shelf as one volume, because that is what they are —
// the handbook itself, beside its character supplements. They stay six separately sellable
// units underneath; opening the volume lists them with their own locks. Collapsing them into
// one product later would be a pricing change, not a rebuild.
// Which units are shelved together as one volume, and which stand alone. Driven by the
// manifest's `bundle`, which the split config decides — so moving Meta out of the main
// volume is a line in a config, not a change here.
const bundled = computed(() => {
  const m = new Map()
  for (const u of units.value) {
    if (!u.bundle) continue
    if (!m.has(u.bundle)) m.set(u.bundle, [])
    m.get(u.bundle).push(u)
  }
  return m
})
const openBundle = ref(null)
const mainUnits = computed(() => (openBundle.value ? bundled.value.get(openBundle.value) : []) || [])

const shelves = computed(() => {
  const out = []
  const seenBundles = new Set()
  for (const u of units.value) {
    const shelfTitle = u.kind === 'character' ? (u.group || '') : t('handbook.mainVolumes')
    let shelf = out.find(x => x.title === shelfTitle)
    if (!shelf) {
      shelf = { id: 's' + out.length, title: shelfTitle, items: [] }
      out.push(shelf)
    }
    if (u.bundle) {
      // One entry for the whole bundle, at the position of its first member.
      if (seenBundles.has(u.bundle)) continue
      seenBundles.add(u.bundle)
      shelf.items.push({ bundle: u.bundle, kind: 'bundle' })
    } else {
      shelf.items.push(u)
    }
  }
  return out
})

/**
 * 這一冊要哪一檔才讀得到 —— 封面左上角那個標籤的字。
 *
 * 顯示的是「需要什麼」，不是「你有沒有」：一個人自己的方案會變，但這一冊的門檻是書
 * 本身的屬性。已經讀得到的人也看得到它，那是在告訴他這一冊屬於哪一檔。
 */
/**
 * 這一冊的標籤要戴哪一種金屬。
 *
 * 由低到高：銅、銀、金。第四檔以上一律金 —— 讓最高的那一檔永遠是金，比讓它們輪流
 * 換色要好讀。免費與試閱不是階梯上的位置，所以不戴金屬。
 */
function tagMetal(u) {
  if (u.kind !== 'bundle' && showsFreeBadge(u)) return 'free'
  const key = u.kind === 'bundle' ? bundleTier(u.bundle) : tierFor(u)
  const r = rankOf(key)
  if (r <= 0) return 'free'
  return r === 1 ? 'bronze' : r === 2 ? 'silver' : 'gold'
}

function planTag(u) {
  if (u.kind === 'bundle') {
    // 整套的門檻取「還沒解鎖的那幾本裡最高的那一檔」—— 已經讀得到一半的人，要的是
    // 開啟剩下一半的那一檔（跟 bundleTier 同一個理由）。
    const need = bundleTier(u.bundle)
    return need ? (metaOf(need)?.name || need).split('｜')[0] : t('handbook.tagFree')
  }
  // 當週試閱蓋過原本的門檻：這幾天它就是不用訂閱也讀得到。
  if (showsFreeBadge(u)) return t('handbook.tagTrial')
  const key = tierFor(u)
  if (rankOf(key) <= 0) return t('handbook.tagFree')
  return (metaOf(key)?.name || key).split('｜')[0]
}

function bundleUnits(id) { return bundled.value.get(id) || [] }
function bundlePages(id) { return bundleUnits(id).reduce((n, u) => n + u.pages, 0) }
function bundleOwned(id) { return bundleUnits(id).filter(owns).length }
// The plan that would open the *rest* of a bundle, which is the one worth quoting: a volume
// half of which is already readable should ask for the half that is not.
function bundleTier(id) {
  return bundleUnits(id).filter(u => !owns(u))
    .reduce((hi, u) => (rankOf(u.tier) > rankOf(hi) ? u.tier : hi), null)
}


const sections = computed(() => {
  const out = []
  for (const u of units.value) {
    const key = u.kind === 'character' ? (u.group || '') : ''
    const kind = u.kind === 'character' ? 'plates' : 'list'
    const last = out[out.length - 1]
    if (last && last.key === key && last.kind === kind) last.items.push(u)
    else out.push({ key, kind, title: key, items: [u] })
  }
  return out
})

const ownedCount = computed(() => units.value.filter(owns).length)
const myPlanName = computed(() => metaOf(myTier.value)?.name || t('handbook.noPlan'))

// Where to pick back up. A 190-page book cut into 27 chapters needs a way in that is not
// "find your place again" — without it the shelf is a pile.
const showIndex = ref(false)

/**
 * 只留讀得到的那幾本。
 *
 * 篩的是「看得到哪些書」，不是「有沒有權限」—— 鎖住的書照樣鎖著，只是暫時不陳列。
 * 二十七本裡只訂了五本的人，大部分時間要找的是那五本。
 *
 * 進出手冊會回到「全部」：它是當下在找什麼的狀態，不是一個偏好設定，而且下一次進來
 * 看到一個被篩過的書架、卻不記得自己篩過，比多按一下更糟。讀書的來回不會重設它——
 * 閱讀器掛在這個畫面底下，沒有換過。
 */
const onlyOwned = ref(false)

function readable(u) {
  return u.kind === 'bundle' ? bundleOwned(u.bundle) > 0 : owns(u)
}

const visibleShelves = computed(() => {
  if (onlyOwned.value) {
    return shelves.value
      .map(sec => ({ ...sec, items: sec.items.filter(readable) }))
      // 整層都讀不到就連書架一起收起來，不要留一排空的層板。
      .filter(sec => sec.items.length)
  }
  // 「全部」底下讀得到的排在每一層的前面。鎖住的書照樣在，只是排在後面 —— 每一層的
  // 第一本就是這一層裡現在能翻的那本，不必橫向捲過一整排鎖頭去找。
  // 不跨層搬動：層板是「這些書屬於同一盒」，拆掉它書架就只剩一堆書。
  // 兩邊各自維持原本的順序（sort 是穩定的），所以同一本書不會因為訂閱變動而跳來跳去。
  return shelves.value.map(sec => ({
    ...sec,
    items: [...sec.items].sort((a, b) => (readable(b) ? 1 : 0) - (readable(a) ? 1 : 0))
  }))
})

// Jump targets for the quick index. The shelf is 27 rows tall; without this, reaching
// 探險盒 01 means scrolling past every starter.
const jumps = computed(() => {
  const out = [{ id: '__top', label: t('handbook.title'), n: 0 }]
  for (const sec of visibleShelves.value) {
    if (sec.title) out.push({ id: sec.id, label: sec.title, n: sec.items.length })
  }
  return out
})

function jumpTo(id) {
  showIndex.value = false
  const el = id === '__top'
    ? document.querySelector('.hb-sheet')
    : document.getElementById(id)
  el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

// The whole book, in reading order, as the reader needs it: every chapter listed, each
// saying whether it is open and — when it is not — what would open it. Locked chapters are
// listed on purpose. A chapter list that hid them could not say what the subscription buys,
// and the foot of a chapter is the moment that question is actually worth asking.
const readerUnits = computed(() => units.value.map(u => ({
  ...u,
  owned: owns(u),
  planName: (metaOf(tierFor(u))?.name || '').split('｜')[0],
  // showsFreeBadge 而不是 freeReadUntil：已經靠自己方案讀得到的人不該看到這個標籤。
  freeUntil: showsFreeBadge(u) ? freeReadUntil(u) : null
})))

// 方案頁與結帳。兩個分開的狀態而不是一個精靈流程：從書架點「方案」、從某一本鎖住的書
// 點「需要 Pro」、從閱讀器底部點下一章的鎖 —— 三條路都通到同一頁，而結帳是它之後的事。
const plans = ref(false)
const checkout = ref(null)
// 付完款回來的那一筆。跟 checkout 分開是因為這時候沒有 tier / period 物件可以傳 ——
// 我們手上只有一個單號，其餘的向後端問。
const resultOrder = ref(props.ecpayOrder)

/**
 * 打開方案頁。先把權限設定重讀一次再開。
 *
 * 這一頁上的每一個數字都是拿「哪一冊要哪一檔」算出來的，而那是後台隨時會改的東西。
 * 進手冊時讀過一次不夠 —— 人可能在書架上待了十分鐘才按進來，而這一頁的下一步是付錢。
 */
async function openPlans() {
  detail.value = null
  await reloadTiers()
  plans.value = true
}

function pickPlan(sel) {
  // 一筆訂單要記在某個帳號上，所以結帳的前提是有身分。方案與價目對訪客全開 —— 要擋的
  // 是「開單」這個動作本身，不是先看一眼要多少錢。
  //
  // 方案頁的按鈕在訪客眼裡就寫著「登入後訂閱」，所以這裡直接把人送去登入；登入畫面回來
  // 時會回到手冊（App.vue 的 modeRequest.from）。
  if (!isSignedIn.value) {
    plans.value = false
    return emit('signIn')
  }
  checkout.value = sel
}
function checkoutDone() {
  checkout.value = null
  plans.value = false
}

/**
 * 綠界那一筆的結果看完了。
 *
 * 往上報一聲，讓單號從 App 手上消失 —— 它活在 `?ecpay=` 的網址參數裡，而那個參數在開機
 * 當下就被 replaceState 拿掉了，只剩記憶體裡這一份。不收掉的話，之後每次重新進手冊都會
 * 再跳一次同一張收據。
 *
 * 收在這裡而不是開機時收，是因為中間可能要去登入一趟 —— 手冊會被卸載再掛回來，單號得
 * 撐過那一趟，人才回得到自己的完成頁。
 */
function resultSeen(reload) {
  resultOrder.value = ''
  emit('orderSeen')
  if (reload) reloadTiers()
}

const resume = computed(() => mostRecent(units.value.filter(owns)))
const resumePct = computed(() => {
  const r = resume.value
  return r && r.pages ? Math.min(100, Math.round(r.page / r.pages * 100)) : 0
})
const watermark = computed(() => currentIdentity.value?.code || '')

// An owned volume opens; an unowned one explains itself. A shelf whose locked books do
// nothing cannot sell anything, and "locked" is not an answer to "what is this".
const detail = ref(null)

function enter(u) {
  // Checked here as well as in the markup: a disabled button is a courtesy, the rule is the
  // server's 404, and this mirrors where that rule lives.
  if (owns(u)) open.value = u
  else detail.value = u
}

// A volume with nothing readable in it has to say what it is before handing over a list of
// locked rows; once any chapter is open, the list is the more useful thing to see.
function enterBundle(id) {
  if (bundleOwned(id)) openBundle.value = id
  else detail.value = { kind: 'bundle', bundle: id }
}

function readDetail() {
  const u = detail.value
  detail.value = null
  if (u.kind === 'bundle') openBundle.value = u.bundle
  else open.value = u
}

const detailProps = computed(() => {
  const u = detail.value
  if (!u) return null
  const members = u.kind === 'bundle' ? bundleUnits(u.bundle) : []
  const need = u.kind === 'bundle' ? bundleTier(u.bundle) : tierFor(u)
  return {
    unit: u.kind === 'bundle'
      ? { title: t('handbook.title'), pages: bundlePages(u.bundle), toc: [] }
      : u,
    owned: u.kind === 'bundle' ? bundleOwned(u.bundle) === members.length : owns(u),
    cover: u.kind === 'character' ? asset('image/handbook-cover.jpg') : asset('image/handbook-cover-main.jpg'),
    art: u.kind === 'character' ? art(u) : '',
    code: u.cardCode || '',
    members,
    plan: metaOf(need),
    group: u.group || (u.kind === 'character' ? '' : t('handbook.mainVolumes'))
  }
})

function onKey(e) {
  if (e.key === 'Escape' && !open.value) emit('back')
}

onMounted(async () => {
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
  try {
    // 兩個來源，各管各的：manifest 說有哪些冊（切書的產物），API 說誰看得到（後台現改現
    // 生效）。API 沒回應就整份退回 manifest 裡切書時算的預設值 —— 權限服務掛掉不該讓
    // 書架變成一片空白，只是後台的調整當下不生效而已。
    // 進度跟這兩份一起要：書架第一眼就要能畫出「繼續閱讀」與每一本的書籤。
    const [m, cfg] = await Promise.all([fetchManifest(), fetchTierConfig(), refreshProgress()])
    units.value = m.units || []
    if (!applyServerConfig(cfg)) {
      setLadder(m.tiers)
      // 原型沒有 session 可讀，直接給一個方案看效果。
      myTier.value = isPrototype ? PROTOTYPE_TIER : null
    }
  } catch (e) {
    error.value = t('handbook.manifestFailed')
  } finally {
    loading.value = false
  }
})
/**
 * 換人了。登出，或換一個帳號登入。
 *
 * 閱讀器要收掉。它把抓過的章節留在 `entry.data` 裡好讓來回翻頁不用重抓，而那份快取是
 * 上一個身分的；`v-if` 一收，元件連同快取一起消失。
 *
 * 順手重讀一次權限，新的身分才看得到自己的鎖。
 */
watch(() => currentIdentity.value?.code || '', () => {
  open.value = null
  detail.value = null
  checkout.value = null
  reloadTiers()
})

// 付款開通之後重讀一次權限，不重讀 manifest —— 書的內容沒變，變的是誰看得到。
async function reloadTiers() {
  try {
    applyServerConfig(await fetchTierConfig())
  } catch {
    // 讀不到就維持現狀。付款已經成功了，這裡失敗只是畫面上的鎖還沒打開，重開一次就好，
    // 不值得把一個「已付款」的畫面變成錯誤訊息。
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div class="hb">
      <header class="hb-bar">
        <div class="hb-bar-wrap">
          <!-- 標題與自己的訂閱等級同一行。
               「已解鎖 n / 27 章」拿掉了：每一本的鎖與左上角的方案旗子已經把那件事
               逐本講完了，標題列再報一次總數，是在回答一個沒人問的問題。
               留下來的是「我是哪一檔」—— 那個資訊在書架上沒有別的地方看得到。 -->
          <div class="hb-bar-title">
            {{ t('handbook.title') }}
            <span class="hb-bar-plan">
              <span class="hb-bar-plan-lab">{{ t('handbook.myPlanLabel') }}</span>{{ myPlanName }}
            </span>
          </div>
        </div>
        <!-- 篩選放在標題列，不放在 ☰ 選單裡：它改的是整個書架現在長什麼樣子，不是一個
             跳頁的動作；藏在選單裡的話，想找「我訂的那幾本」得先知道那個選單存在。 -->
        <div v-if="units.length" class="hb-seg">
          <button :class="['hb-seg-b', { on: !onlyOwned }]" @click="onlyOwned = false">
            {{ t('handbook.filterAll') }}
          </button>
          <button :class="['hb-seg-b', { on: onlyOwned }]" @click="onlyOwned = true">
            {{ t('handbook.filterOwned') }}
          </button>
        </div>
        <button
          v-if="units.length"
          class="hb-x hb-idx"
          :class="{ on: showIndex }"
          :aria-label="t('handbook.quickIndex')"
          @click="showIndex = !showIndex"
        >☰</button>
        <button class="hb-x" :aria-label="t('common.back')" @click="emit('back')">✕</button>
      </header>

      <div v-if="isPrototype" class="hb-proto">
        <span>{{ t('handbook.prototypeNote') }}</span>
        <!-- Switching plan here is the only way to see what each one actually opens, which is
             the question the shelf now exists to answer. -->
        <select v-model="myTier" :aria-label="t('handbook.yourPlan', { plan: myPlanName })">
          <option :value="null">{{ t('handbook.noPlan') }}</option>
          <option v-for="k in tierLadder.order" :key="k" :value="k">{{ metaOf(k)?.name }}</option>
        </select>
        <label><input v-model="showAll" type="checkbox">{{ t('handbook.unlockAll') }}</label>
      </div>

      <div v-if="showIndex" class="hb-jump" @click.self="showIndex = false">
        <div class="hb-jump-sheet">
          <button v-for="j in jumps" :key="j.id" class="hb-jump-row" @click="jumpTo(j.id)">
            <span>{{ j.label }}</span>
            <!-- 右邊放這一層有幾冊，不放箭頭：整份目錄每一行都指向右邊，那個箭頭沒有
                 分辨任何東西；冊數則是決定要不要跳過去的依據。 -->
            <span v-if="j.n" class="hb-jump-n">{{ t('handbook.volumes', { n: j.n }) }}</span>
          </button>
        </div>
      </div>

      <div v-if="loading" class="hb-state">{{ t('handbook.loading') }}</div>
      <div v-else-if="error" class="hb-state">{{ error }}</div>
      <div v-else-if="!units.length" class="hb-state">{{ t('handbook.empty') }}</div>

      <div v-else class="hb-scroll">
        <button v-if="resume" class="hb-resume" @click="enter(resume.unit)">
          <span class="hb-resume-lab">{{ t('handbook.continue') }}</span>
          <span class="hb-resume-name">{{ label(resume.unit) }}</span>
          <span class="hb-resume-pos">{{ resume.page }} / {{ resume.pages }}</span>
          <span class="hb-progress"><i :style="{ width: resumePct + '%' }"></i></span>
        </button>

        <!-- One shelf per group. Horizontal, because that is how books are kept and because
             27 covers stacked vertically is a page nobody reaches the bottom of. -->
        <section v-for="sec in visibleShelves" :key="sec.id" class="hb-shelf" :id="sec.id">
          <h2 class="hb-shelf-head">
            <span>{{ sec.title }}</span>
            <!-- The main shelf holds one volume made of six chapters, so its count is the
                 chapters, not the books standing there. -->
            <small>{{ t('handbook.volumes', { n: sec.items.length }) }}</small>
          </h2>

          <div class="hb-case">
            <div class="hb-books">

              <!-- A bundle stands as one volume; opening it lists what is inside. -->
              <button
                v-for="u in sec.items"
                :key="u.id || u.bundle"
                class="hb-book"
                :class="[u.kind, { locked: u.kind !== 'bundle' && !owns(u) }]"
                :style="{ '--tint': tint(u) }"
                @click="u.kind === 'bundle' ? enterBundle(u.bundle) : enter(u)"
              >
                <span class="hb-spine" aria-hidden="true"></span>
                <template v-if="u.kind === 'bundle'">
                  <span class="hb-face hb-maincover">
                    <span class="hb-maintitle">{{ t('handbook.title') }}</span>
                  </span>
                  <span class="hb-owned">{{ bundleOwned(u.bundle) }} / {{ bundleUnits(u.bundle).length }}</span>
                </template>
                <span v-else-if="u.kind === 'chapter'" class="hb-face hb-maincover">
                  <span class="hb-maintitle">{{ label(u) }}</span>
                </span>
                <!-- The printed cover, with the three places it leaves for us: the circle
                     for the figure, the ruled box for the name, the corner for the code. -->
                <span v-else class="hb-face hb-cover">
                  <img class="hb-art" :src="art(u)" :alt="u.title" loading="lazy"
                       @error="artFallback($event, u)">
                  <span class="hb-covername">{{ u.title }}</span>
                  <span class="hb-covercode">{{ u.cardCode }}</span>
                </span>
                <!-- 左上角：要哪一檔才讀得到。右上角是鎖，兩個角各答一個問題 ——
                     「我現在能不能讀」跟「這本屬於哪一檔」不是同一件事。 -->
                <span class="hb-tag" :class="tagMetal(u)">{{ planTag(u) }}</span>
                <!-- 下架中：橫過封面的一條帶子。不是角落的小標 —— 這本現在誰都讀不到，
                     包含已經買到那一檔的人，所以它要蓋在書上，不是躲在角落。 -->
                <span v-if="u.kind !== 'bundle' && holdLabel(u)" class="hb-hold">{{ holdLabel(u) }}</span>
                <template v-if="u.kind !== 'bundle'">
                  <span v-if="!owns(u)" class="hb-locked" aria-hidden="true"><Icon name="lock" /></span>
                  <span v-else-if="startedOf(u.id)" class="hb-ribbon" aria-hidden="true"></span>
                </template>
              </button>
            </div>
            <!-- The board the books stand on, drawn over their feet so they sit *in* the
                 shelf rather than floating above a stripe. -->
            <div class="hb-board" aria-hidden="true"></div>
          </div>
        </section>
      </div>

      <!-- Inside the main volume: its chapters, each with its own lock. Same sheet pattern as
           the reader's own contents list. -->
      <div v-if="openBundle" class="hb-jump" @click.self="openBundle = null">
        <div class="hb-main-sheet">
          <div class="hb-main-head">{{ t('handbook.title') }}</div>
          <button
            v-for="u in mainUnits"
            :key="u.id"
            class="hb-main-row"
            :class="{ locked: !owns(u) }"
            @click="openBundle = null; enter(u)"
          >
            <span class="hb-main-seal">{{ numeral(u) }}</span>
            <span class="hb-main-title">{{ label(u) }}</span>
            <span v-if="!owns(u)" class="hb-main-lock">{{ t('handbook.lockedShort') }}</span>
            <span class="hb-main-pages">{{ t('handbook.pages', { n: u.pages }) }}</span>
            <span v-if="owns(u)" class="hb-go">❯</span>
          </button>
        </div>
      </div>

      <HandbookDetail
        v-if="detailProps"
        v-bind="detailProps"
        @close="detail = null"
        @read="readDetail"
        @plans="openPlans()"
      />

      <HandbookPlans
        v-if="plans"
        :units="units"
        @close="plans = false"
        @reload="reloadTiers()"
        @pick="pickPlan"
      />

      <!-- 從綠界回來：只有單號，狀態自己去查。 -->
      <HandbookCheckout
        v-if="resultOrder"
        :order-no="resultOrder"
        :units="units"
        @close="resultSeen(false)"
        @sign-in="emit('signIn')"
        @done="resultSeen(true)"
      />

      <HandbookCheckout
        v-else-if="checkout"
        :tier="checkout.tier"
        :period="checkout.period"
        :units="units"
        @close="checkout = null"
        @sign-in="emit('signIn')"
        @done="checkoutDone"
      />

      <HandbookReader
        v-if="open"
        :units="readerUnits"
        :start-id="open.id"
        :watermark="watermark"
        @close="open = null"
        @locked="u => { open = null; detail = u }"
      />
    </div>
  </Teleport>
</template>

<style scoped>
/* Outside #stage, so px and viewport units — the root font-size tracks the stage's short edge
   and this screen has no relationship to it. Same reasoning as HandbookReader. */
.hb {
  zoom: var(--hb-scale, 1);
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  --ink: #2A2118;
  --ink-soft: #7C6A55;
  --wood: #7A5636;
  --wood-dark: #5A3E26;
  --wood-light: #9A7249;
  background: #EFE9DC;
  color: var(--ink);
  font-family: var(--ui-cjk);
}

.hb-bar {
  flex: none;
  display: flex; align-items: center; gap: 16px;
  padding: max(20px, calc(env(safe-area-inset-top) / var(--hb-scale, 1))) 24px 22px;
  background: #241B13;
  color: #F2E8D6;
  border-bottom: 3px solid var(--wood-dark);
}
.hb-bar-wrap { flex: 1; min-width: 0; }
/* 書名自己一行、絕不斷字 —— 「秘笈手／冊」那樣斷開是這一列最先被看到的東西。
   等級那一行可以被截掉，因為它是附註，而且完整的資訊在方案頁上。 */
.hb-bar-title {
  font-size: 34px; font-weight: 700; letter-spacing: .18em; white-space: nowrap;
}

/* 連成一條的兩格，不是兩顆各自獨立的按鈕 —— 它們是同一個選擇的兩個位置。 */
.hb-seg { flex: none; display: flex; }
.hb-seg-b {
  padding: 10px 12px;
  border: 1px solid rgba(242, 232, 214, .32);
  margin-left: -1px;
  background: none; color: rgba(242, 232, 214, .72);
  font: inherit; font-size: 22px; font-weight: 700; white-space: nowrap; cursor: pointer;
}
.hb-seg-b:first-child { margin-left: 0; }
.hb-seg-b.on { background: #F2E8D6; color: #241B13; }
/* 比書名小、也比書名淡：它是附註，不是標題的第二半。 */
.hb-bar-plan {
  display: block; margin-top: 4px;
  font-size: 20px; font-weight: 700; letter-spacing: .08em;
  color: rgba(242, 232, 214, .88);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.hb-bar-plan-lab { color: rgba(242, 232, 214, .55); margin-right: .25em; }
.hb-x {
  flex: none; width: 56px; height: 56px; border: 1px solid rgba(242,232,214,.32);
  background: none; color: #F2E8D6; font-size: 26px; cursor: pointer;
}
.hb-idx.on { background: #F2E8D6; color: #241B13; }

.hb-proto {
  flex: none; display: flex; gap: 20px; align-items: center; flex-wrap: wrap;
  padding: 12px 32px; background: #E0D2B4; border-bottom: 1px solid #C2A87F;
  font-size: 22px; color: #6B5636; font-family: system-ui, sans-serif;
}
.hb-proto label { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--ink); }
.hb-proto select {
  font: inherit; font-size: 22px; color: var(--ink);
  background: #F3EADA; border: 1px solid #C2A87F; padding: 4px 8px;
}

.hb-jump {
  position: absolute; inset: 0; z-index: 10; background: rgba(20,14,8,.5);
  display: flex; align-items: flex-start; justify-content: flex-end;
}
.hb-jump-sheet {
  margin: 16px 20px 0 0; min-width: 340px; padding: 12px;
  background: #EFE9DC; border: 1px solid var(--wood); box-shadow: 6px 8px 0 rgba(60,40,22,.35);
}
.hb-jump-row {
  display: flex; align-items: center; justify-content: space-between; gap: 28px;
  width: 100%; padding: 20px; border: 0; border-bottom: 1px solid rgba(122,86,54,.3);
  background: none; color: var(--ink); font: inherit; font-size: 28px; text-align: left; cursor: pointer;
}
.hb-jump-row:last-child { border-bottom: 0; }
.hb-jump-n { font-size: 22px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.hb-go { font-size: 22px; color: var(--ink-soft); }

.hb-scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 32px 0 96px; }

.hb-resume {
  display: grid; grid-template-columns: 1fr auto; gap: 4px 20px;
  width: calc(100% - 64px); margin: 0 32px 52px; padding: 24px 28px;
  border: 1px solid rgba(122,86,54,.4); background: #FBF6EA;
  box-shadow: 4px 4px 0 rgba(90,62,38,.2);
  color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.hb-resume:active { transform: translate(1px,1px); box-shadow: none; }
.hb-resume-lab { grid-column: 1 / -1; font-size: 19px; letter-spacing: .22em; color: var(--ink-soft); }
.hb-resume-name { font-size: 32px; font-weight: 700; }
.hb-resume-pos { font-size: 22px; color: var(--ink-soft); font-variant-numeric: tabular-nums; align-self: end; }
.hb-progress { grid-column: 1 / -1; height: 6px; margin-top: 14px; background: rgba(122,86,54,.22); }
.hb-progress i { display: block; height: 100%; background: var(--wood); }

/* --- a shelf --- */
.hb-shelf { margin-bottom: 60px; }
.hb-shelf-head {
  display: flex; align-items: baseline; justify-content: space-between;
  margin: 0 32px 20px; font-size: 30px; font-weight: 700; letter-spacing: .1em;
}
.hb-shelf-head small { font-size: 22px; color: var(--ink-soft); letter-spacing: .06em; font-variant-numeric: tabular-nums; }

.hb-case { position: relative; }
.hb-books {
  display: flex; align-items: flex-end; gap: 20px;
  padding: 0 32px 40px;
  overflow-x: auto; overflow-y: visible;
  -webkit-overflow-scrolling: touch;
  scroll-snap-type: x proximity;
  /* Without this the snap pulls the first book flush to the edge and eats the padding —
     the shelf looked like it started off-screen. */
  scroll-padding-inline: 16px;
  scrollbar-width: none;
}
.hb-books::-webkit-scrollbar { display: none; }

/* The board. Drawn over the books' feet, which is the whole trick — it puts them *in* the
   shelf instead of on top of a stripe. Sits outside the scroller so it stays put while the
   books slide past it, the way a real shelf does. */
.hb-board {
  position: absolute; left: 0; right: 0; bottom: 0; height: 44px;
  pointer-events: none;
  background:
    linear-gradient(180deg, var(--wood-light) 0 3px, var(--wood) 3px 9px, var(--wood-dark) 9px 100%);
  box-shadow: 0 12px 20px rgba(60,40,22,.3);
}
/* The grain, and the two end supports a fitted shelf is screwed into. */
.hb-board::before {
  content: ""; position: absolute; inset: 0;
  background: repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 2px, transparent 2px 9px);
}
.hb-board::after {
  content: ""; position: absolute; left: 12px; right: 12px; top: 8px; height: 2px;
  background: rgba(255,255,255,.18);
}

.hb-book {
  position: relative; flex: none;
  width: 184px; height: 264px;
  /* Overlaps the board so the feet are hidden behind it. */
  margin-bottom: -10px;
  padding: 0; border: 0; background: none; cursor: pointer;
  scroll-snap-align: start;
  transition: transform .12s ease;
}
.hb-book:not(.locked):active { transform: translateY(2px); }
.hb-book:not(.locked):hover { transform: translateY(-3px); }

/* A sliver of the board edge, so each volume reads as a thing with thickness. */
.hb-spine {
  position: absolute; left: 0; top: 0; bottom: 20px; width: 14px;
  background: linear-gradient(90deg, rgba(0,0,0,.34), rgba(0,0,0,.08));
  z-index: 2;
}
.hb-face {
  position: absolute; inset: 0 0 20px 0;
  display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
  gap: 4px; padding: 14px 14px 16px 22px; overflow: hidden;
  background: var(--tint, #DCD3C2);
  box-shadow: 4px 6px 12px rgba(60,40,22,.35), inset 0 0 0 2px rgba(255,255,255,.35);
}
/* --- the printed character cover --- */
/* Regions measured off the artwork rather than eyeballed, as percentages so they hold at any
   book size: the circle spans x 21–80% / y 21.5–70%, the name box x 25.6–80.9% / y 76.4–86.2%. */
.hb-cover {
  display: block;
  padding: 0;
  background: #EFE7D5 url("/image/handbook-cover.jpg") center / 100% 100% no-repeat;
  box-shadow: 4px 6px 12px rgba(60,40,22,.35);
}
.hb-art {
  position: absolute;
  /* Larger than the circle and allowed to cross it. The figure is a cut-out pasted onto the
     cover, and a cut-out that stops politely at a printed rule reads as clip-art; breaking
     the rule is what makes it look stuck on. */
  left: 17%; width: 66%;
  top: 20%; height: 54%;
  object-fit: contain;
  object-position: bottom;
  /* Possible at all only because the source is keyed: on the opaque JPEG this cast the
     rectangle's shadow, not the figure's. Two passes — a tight contact shadow to seat it on
     the page, a wider soft one for depth. */
  filter:
    drop-shadow(0 1px 1px rgba(60, 44, 26, .55))
    drop-shadow(1px 3px 5px rgba(60, 44, 26, .38));
}
.hb-covername {
  position: absolute;
  /* Centred on the printed box but not confined to it: the name is the one thing here that
     must be readable at shelf size, and the box is drawn for a page, not a thumbnail. A long
     name simply sits proud of the rule. */
  left: 4%; width: 92%;
  /* 往上挪一點，把下面讓給編號。印刷的名牌框在 y 76.4–86.2%，所以名字坐在框的上半部，
     編號接在框底下 —— 兩個都還在同一組印刷元素的範圍裡，不會看起來像飄出去的。 */
  top: 75%; height: 10%;
  display: grid; place-items: center;
  /* The app's own display face, already loaded for move names. A Mincho at 15px over a
     textured cover reads thin and muddy; this is the weight a cover label wants, and it
     covers all 65 characters these titles use (龜 and 歐 included, which Japanese faces
     often drop). */
  font-family: 'CorporateLogoBold', 'Noto Sans TC', 'PingFang TC', sans-serif;
  /* 700 而不是 400：CorporateLogoBold 大部分中文字都沒有，實際畫出來的是後面那支。
     思源的 Regular 擺在印刷封面的框線裡太輕，撐不起一個標籤。 */
  font-size: 30px; font-weight: 700; line-height: 1;
  letter-spacing: .02em;
  color: #231C14;
  white-space: nowrap;
}
.hb-covercode {
  position: absolute;
  /* 橫著排在角色名稱正下方。
     以前它是立在右緣、由下往上轉 90° 的 —— 那是因為封面只有 112px 寬時，橫排要縮到
     5px 才塞得下，根本讀不出來。現在封面大了一倍，橫排放在名字底下是看型錄編號最自然
     的地方，也不必再要求人家歪著頭看。 */
  /* 寬度由字決定，不是撐滿整行 —— 底色要貼著編號，撐滿的話那塊黑會變成一條橫槓，
     把封面下半截切掉。
     做法是 left/right 都歸零再 margin auto，而不是 left:50% + translateX：後者的可用
     寬度只剩封面的一半，EBC01-001 這種長一點的編號就是這樣被折成兩行的 —— 它從來
     不是字太大，是那個框只有一半寬。 */
  left: 0; right: 0;
  width: fit-content;
  margin-inline: auto;
  /* 名字佔到 85%，這裡從 88% 起跳，中間那 3% 就是跟名字之間的距離。 */
  top: 88%;
  padding: 4px 12px;
  background: #1A1A18;
  color: #FAF6EC;
  border-radius: 3px;
  font-size: 14px; font-weight: 700; letter-spacing: .12em;
  /* 編號是一個整體，任何情況都不折 —— 折成兩行的型錄編號等於兩個編號。 */
  white-space: nowrap;
  font-family: ui-monospace, "SFMono-Regular", monospace;
}
.hb-booktitle {
  flex: none; width: 100%; text-align: center;
  font-size: 23px; font-weight: 700; line-height: 1.25;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* The hardback cover, shared by the main volume and every non-character chapter — its middle
   is left clear precisely so a title can be set there, which is why a new DLC does not need
   artwork of its own.
   Measured off the file: the spine is cropped away (the shelf draws its own, and two would
   read as a fold), leaving the clear panel at roughly x 22–88%, y 48–72%. */
.hb-maincover {
  display: block;
  padding: 0;
  background: #1C1510 url("/image/handbook-cover-main.jpg") center / 100% 100% no-repeat;
  box-shadow: 4px 6px 12px rgba(60,40,22,.4);
}
.hb-maintitle {
  position: absolute;
  /* 對齊封面的中線，不是對齊印刷留白區的中線。
     那塊留白量出來是 x 22–88%，中點在 55% —— 書背被裁掉之後它本來就偏右，把標題塞進
     它的正中央，看起來就是整行往右偏了 5%。印刷區是底圖，中線是人眼在看的東西。 */
  left: 12%; width: 76%;
  top: 48%; height: 24%;
  display: grid; place-items: center;
  text-align: center;
  font-family: 'CorporateLogoBold', 'Noto Sans TC', 'PingFang TC', sans-serif;
  font-size: 28px; font-weight: 400; line-height: 1.3;
  color: #F2E8D6;
}

/* A ribbon marker for a volume already started — what a reader leaves in a book. */
.hb-ribbon {
  position: absolute; left: 32px; top: -3px; width: 14px; height: 60px; z-index: 3;
  background: #B4402F;
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 82%, 0 100%);
}
/* A drawn clasp in the top-right corner, not an emoji across the cover: at this size an
   emoji lock is a different object on every platform, and over the middle it read as the
   character holding a padlock. */
/* 掛在左上角附近的一面旗子，不是壓在角上。
   以角為中心的版本有兩個問題：整排第一本的旗子會被捲動框切掉，而且上下各露一半看起來
   像是沒對準。往內挪開一點之後它還是浮著（有影子），但有了自己的位置。
   左邊仍然留 4px 探出書緣 —— 那一點點探出去正是「掛上去的」跟「印上去的」的差別。 */
.hb-tag {
  position: absolute; left: -4px; top: 12px; z-index: 4;
  /* 右邊多留一個缺口的寬度，字才不會頂在那個 V 上。 */
  padding: 0 24px 0 15px; height: 38px;
  display: grid; place-items: center;
  /* 旗子：左邊方的，右邊切一個往內的 V —— 書籤尾巴的形狀。
     膠囊是「按鈕」的語彙，而這個東西不能按；旗子是「掛上去的牌子」，那才是它。 */
  clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 50%, 100% 100%, 0 100%);
  font-size: 19px; font-weight: 800; letter-spacing: .04em;
  white-space: nowrap;
  /* 上緣一道白：金屬是靠這個成立的，少了就只是一塊色塊。 */
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .55);
  /* 外框與陰影都走 filter，不走 border / box-shadow —— 那兩個會被 clip-path 一起剪掉，
     缺口那一段就會沒有線。drop-shadow 是沿著**剪完的輪廓**畫的，所以四個方向各推一格
     零模糊的陰影疊起來，等於一圈跟著 V 形走的描邊。最後那道才是真的影子。 */
  filter:
    drop-shadow(1px 0 0 #2A1C0C) drop-shadow(-1px 0 0 #2A1C0C)
    drop-shadow(0 1px 0 #2A1C0C) drop-shadow(0 -1px 0 #2A1C0C)
    drop-shadow(0 2px 4px rgba(40, 26, 12, .4));
}
.hb-tag.bronze { background: var(--metal-bronze); color: var(--metal-bronze-ink); }
.hb-tag.silver { background: var(--metal-silver); color: var(--metal-silver-ink); }
.hb-tag.gold   { background: var(--metal-gold);   color: var(--metal-gold-ink); }
/* 免費與試閱不在階梯上，所以不戴金屬 —— 做成紙的顏色，一眼就知道它不是一檔方案。 */
.hb-tag.free { background: #F4ECDC; color: #2A2014; box-shadow: none; }

/* 監修中的帶子。橫過書腰的位置（約三分之二高），而不是蓋住封面正中央 —— 書還要認得出
   是哪一本，帶子是加在上面的一句話，不是替代品。 */
.hb-hold {
  position: absolute;
  left: 0;
  right: 0;
  top: 62%;
  padding: 0.1875rem 0;
  background: rgba(31, 31, 29, 0.88);
  color: #F2E8D6;
  font-size: 0.5rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-align: center;
  pointer-events: none;
  z-index: 3;
}

.hb-locked {
  position: absolute; right: 0; top: 0; z-index: 4;
  width: 42px; height: 42px; display: grid; place-items: center;
  font-size: 22px; background: #241B13; color: #F2E8D6;
}
.hb-book.locked { cursor: default; }
/* Dimmed and drained, but not to grey: at .75 every locked cover collapsed into the same
   brown and the shelf stopped being scannable. The tint has to survive. */
.hb-book.locked .hb-face { filter: saturate(.45) brightness(.94); opacity: .82; }
/* The cover is printed paper, so draining it reads as a faded copy rather than a greyed
   control — which is the right signal for something not yet bought. */
.hb-book.locked .hb-cover { filter: saturate(.3) brightness(.97); opacity: .72; }
.hb-book.locked .hb-booktitle { color: var(--ink-soft); }
.hb-book.locked .chapterface .hb-booktitle { color: rgba(242,232,214,.6); }

/* "4 / 6" on the main volume's cover: one book, but six things inside it, and the shelf
   should say so without being opened. */
.hb-owned {
  /* Top-left, beside the extent badge: the title runs full width along the foot, so the
     bottom corners are not free. */
  position: absolute; left: 22px; top: 8px; z-index: 3;
  padding: 2px 10px; background: rgba(200,168,106,.9); color: #241B13;
  font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums;
}

.hb-main-sheet {
  align-self: flex-end;
  width: 100%; max-height: 72%; overflow-y: auto;
  padding: 32px 36px calc(40px + calc(env(safe-area-inset-bottom) / var(--hb-scale, 1)));
  background: #EFE9DC; border-top: 3px solid var(--wood);
}
.hb-main-head {
  font-size: 24px; font-weight: 700; letter-spacing: .26em; color: var(--ink-soft);
  padding-bottom: 18px; border-bottom: 1px solid rgba(122,86,54,.35);
}
.hb-main-row {
  display: flex; align-items: center; gap: 22px; width: 100%;
  padding: 24px 4px; border: 0; border-bottom: 1px solid rgba(122,86,54,.22);
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.hb-main-seal {
  flex: none; width: 52px; height: 52px; display: grid; place-items: center;
  border: 1px solid var(--wood); font-size: 26px; font-weight: 700;
}
.hb-main-title { flex: 1; font-size: 32px; font-weight: 700; }
.hb-main-pages { flex: none; font-size: 24px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.hb-main-lock {
  flex: none; padding: 2px 14px; border: 1px solid var(--wood);
  font-size: 19px; letter-spacing: .14em; color: var(--ink-soft); font-family: system-ui, sans-serif;
}
.hb-main-row.locked { cursor: default; }
.hb-main-row.locked .hb-main-title, .hb-main-row.locked .hb-main-seal {
  color: var(--ink-soft); font-weight: 600;
}

.hb-state {
  flex: 1; display: grid; place-items: center; padding: 80px 40px;
  text-align: center; color: var(--ink-soft); font-size: 28px;
}

@media (min-width: 560px) {
  .hb-book { width: 224px; height: 320px; }
  .hb-covername { font-size: 36px; }
  .hb-maintitle { font-size: 30px; }
  .hb-covercode { font-size: 19px; }
  .hb-books { gap: 28px; padding: 0 48px 44px; }
  .hb-shelf-head { margin: 0 48px 24px; }
}
</style>
