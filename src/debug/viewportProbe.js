// 旋轉後點擊錯位的診斷工具。網址加 ?vpdebug=1 才會出現，其他時候整支不做事。
//
// 為什麼需要它：那個 bug 只在真機的 iOS standalone 上重現，而我們改了兩輪都沒效 ——
// 第一輪猜「時機沒抓到」、第二輪猜「尺寸還沒定下來」，兩次都是猜的。這支把「現在到底
// 發生什麼事」直接寫在畫面上，讓一次旋轉就能分辨是哪一種問題。
//
// 最關鍵的一行是 target ≠ fromPoint：
//   - 兩者相同 → 瀏覽器的命中判定跟版面是一致的，問題不在座標，而在別的地方。
//   - 兩者不同 → 命中判定確實停在舊的座標系，這時候才輪得到強制重排那類手段。
//
// 面板設成 pointer-events:none，不會吃掉任何一下點擊，所以開著它測跟平常操作一樣。

const MAX_TAPS = 5

export function installViewportProbe() {
  if (!new URLSearchParams(location.search).has('vpdebug')) return

  const box = document.createElement('div')
  box.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'z-index:99999',
    'max-width:100vw', 'padding:4px 6px',
    'background:rgba(0,0,0,.78)', 'color:#9f9',
    'font:10px/1.35 ui-monospace,Menlo,monospace',
    'white-space:pre', 'pointer-events:none'
  ].join(';')
  document.body.appendChild(box)

  const taps = []
  let lastSig = ''
  let lastChangeAt = performance.now()
  let changes = 0
  let rotatedAt = 0

  function describe(el) {
    if (!el) return 'null'
    const cls = (el.className || '').toString().trim().split(/\s+/)[0] || ''
    const txt = (el.textContent || '').trim().slice(0, 10)
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${txt ? `"${txt}"` : ''}`
  }

  // 用 capture 而且 passive：在任何人處理之前就記下來，而且不干擾原本的行為。
  window.addEventListener('pointerdown', e => {
    const from = document.elementFromPoint(e.clientX, e.clientY)
    taps.unshift({
      x: Math.round(e.clientX), y: Math.round(e.clientY),
      target: describe(e.target),
      from: describe(from),
      // 這一格就是答案：命中判定跟版面有沒有對上。
      match: from === e.target ? 'OK' : 'MISMATCH',
      t: rotatedAt ? Math.round(performance.now() - rotatedAt) : null
    })
    taps.length = Math.min(taps.length, MAX_TAPS)
  }, { capture: true, passive: true })

  window.addEventListener('orientationchange', () => {
    rotatedAt = performance.now()
    changes = 0
  })

  function tick() {
    const vp = window.visualViewport
    const de = document.documentElement
    const sig = [
      window.innerWidth, window.innerHeight,
      Math.round(vp?.width || 0), Math.round(vp?.height || 0),
      de.clientWidth, de.clientHeight
    ].join('x')
    const now = performance.now()
    if (sig !== lastSig) { lastSig = sig; lastChangeAt = now; changes++ }

    const stage = document.getElementById('stage')
    const sr = stage?.getBoundingClientRect()

    box.textContent = [
      `win   ${window.innerWidth}x${window.innerHeight}`,
      `vv    ${Math.round(vp?.width || 0)}x${Math.round(vp?.height || 0)} @${Math.round(vp?.offsetLeft || 0)},${Math.round(vp?.offsetTop || 0)} s${(vp?.scale || 1).toFixed(2)}`,
      `docEl ${de.clientWidth}x${de.clientHeight}`,
      `stage ${sr ? `${Math.round(sr.left)},${Math.round(sr.top)} ${Math.round(sr.width)}x${Math.round(sr.height)}` : '-'}`,
      `rem   ${getComputedStyle(de).fontSize}  chg ${changes}  quiet ${Math.round(now - lastChangeAt)}ms`,
      `rot   ${rotatedAt ? Math.round(now - rotatedAt) + 'ms ago' : '-'}`,
      ...taps.map(t => `tap ${t.t === null ? '--' : t.t + 'ms'} ${t.x},${t.y} ${t.match}\n  hit ${t.from}\n  tgt ${t.target}`)
    ].join('\n')

    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
