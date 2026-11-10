// 主畫面底下那條帶子。
//
// 自己一份資料、自己一個後台，不是公告的一個旗標：公告是一則一則要被讀完的東西（有
// 標題與內文、會進信箱、有未讀紅點），跑馬燈只有一行字跟一段時間。綁在一起的話，要
// 發一條跑馬燈就得先發一則沒有人要讀的公告。
//
// 跟公告同一種態度：拿不到就當作沒有。帶子空著的主畫面是對的，一行過期的字不是。
import { computed, ref } from 'vue'

const API_BASE = import.meta.env.VITE_API_URL || ''

const list = ref([])

/** 現在要跑的字。多條就一條接一條，所以帶子上永遠只有一份文字在跑。 */
export const tickerText = computed(() => list.value.map(m => m.text).join('　・　'))

export async function refreshTicker() {
  try {
    const res = await fetch(`${API_BASE}/api/ticker`)
    if (!res.ok) throw new Error(String(res.status))
    const d = await res.json()
    list.value = d.messages || []
  } catch (e) {
    list.value = []
  }
}
