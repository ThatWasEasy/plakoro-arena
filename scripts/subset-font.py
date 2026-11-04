#!/usr/bin/env python3
"""把思源黑體（Noto Sans TC）裁成這個專案用得到的字，產生一個自架的 woff2。

為什麼要自架：CSS 裡原本的中文 fallback 是 Hiragino Sans → Noto Sans JP，
在 macOS / iOS 上中文會落到**蘋方**，而且有些字會拿到日文字形（骨、直、角、海…
中日寫法不同）。同一句話裡兩套字形混著出現，就是「中文字體有點醜」的來源。
思源黑體不是系統字，不自己帶就保證不了。

為什麼要裁：完整的思源黑體有 20,950 個字，11MB。這個專案（含 UI 文案、角色與招式
名稱、手冊章節名）總共只用到 1,400 個字元左右，裁完 350KB 左右，手機上才背得動。

    python3 scripts/subset-font.py

來源字體第一次會自動下載到 src/assets/_original/（已 gitignore）。
輸出 public/NotoSansTC-subset.woff2，是保留 wght 400–700 的可變字體 ——
一個檔案同時供常規與粗體，比兩個靜態檔（196K + 201K）省，也多拿到中間的字重。

**新增文案或新角色之後要重跑**，不然新字會掉回系統字型，一句話裡混兩套字形。
伺服器回來的內容（玩家暱稱、商城品名、賽事名稱）掃不到，那些字仍會用系統字型。
"""
import json
import pathlib
import re
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC_FONT = ROOT / 'src/assets/_original/NotoSansTC[wght].ttf'
# google/fonts 的 OFL 目錄。思源黑體是 SIL Open Font License，可商用、可重新散布。
SRC_URL = 'https://github.com/google/fonts/raw/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf'
OUT = ROOT / 'public/NotoSansTC-subset.woff2'
# 介面只用到常規與粗體，軸留這一段就好 —— 留整段 100–900 會多 112KB。
AXIS = 'wght=400:700'

# 會被畫在畫面上的字串在哪裡。JSON 只取值不取 key；.vue / .js 整份掃，
# 裡面的中文註解會一起進來，多幾十個字而已，比漏字安全。
JSON_SOURCES = [
    'src/i18n/locales/zh-TW.json', 'src/i18n/locales/ja.json', 'src/i18n/locales/en.json',
    'src/data/translations/zh-TW.json', 'src/data/translations/en.json',
    'src/data/generated/chara.json', 'src/data/generated/waza.json',
    'src/data/localCards.json',
    # 手冊的章節與角色名不在 src 裡，是切書時產生的。沒切過就跳過。
    'handbook-build/catalogues/handbook/manifest.json',
    'handbook-build/catalogues/preview/manifest.json',
    'scripts/handbook.config.json',
]


def strings_of(node, out):
    if isinstance(node, dict):
        for v in node.values():
            strings_of(v, out)
    elif isinstance(node, list):
        for v in node:
            strings_of(v, out)
    elif isinstance(node, str):
        out |= set(node)


def wanted():
    chars = set()
    for rel in JSON_SOURCES:
        p = ROOT / rel
        if p.is_file():
            strings_of(json.loads(p.read_text(encoding='utf-8')), chars)
        else:
            print(f'  （跳過 {rel}，不存在）')
    for p in (ROOT / 'src').rglob('*'):
        if p.suffix in ('.vue', '.js'):
            chars |= set(p.read_text(encoding='utf-8'))
    # 整個可見 ASCII：數字與英文混在中文句子裡，少了就會換成另一套字型。
    chars |= {chr(c) for c in range(0x20, 0x7F)}
    return {c for c in chars if c not in '\n\r\t'}


def fetch_source():
    if SRC_FONT.is_file():
        return
    SRC_FONT.parent.mkdir(parents=True, exist_ok=True)
    print(f'下載來源字體 → {SRC_FONT.relative_to(ROOT)}')
    urllib.request.urlretrieve(SRC_URL, SRC_FONT)


def run(*args):
    r = subprocess.run([sys.executable, '-m', *args], capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr.strip() or r.stdout.strip())


def main():
    try:
        import fontTools  # noqa: F401
        import brotli  # noqa: F401
    except ImportError:
        sys.exit('需要 fonttools 與 brotli：python3 -m pip install --user fonttools brotli')

    fetch_source()
    chars = wanted()
    cjk = sum(1 for c in chars if re.match(r'[㐀-鿿豈-﫿]', c))
    print(f'用到 {len(chars)} 個字元（其中漢字 {cjk}）')

    tmp = ROOT / 'public/.noto-tmp.ttf'
    txt = ROOT / 'public/.noto-tmp.txt'
    txt.write_text(''.join(sorted(chars)), encoding='utf-8')
    try:
        run('fontTools.varLib.instancer', str(SRC_FONT), AXIS, '-o', str(tmp))
        run('fontTools.subset', str(tmp), f'--text-file={txt}', '--flavor=woff2',
            f'--output-file={OUT}', '--no-hinting')
    finally:
        tmp.unlink(missing_ok=True)
        txt.unlink(missing_ok=True)

    print(f'輸出 {OUT.relative_to(ROOT)}  {OUT.stat().st_size / 1024:.0f}KB'
          f'（原始 {SRC_FONT.stat().st_size / 1048576:.0f}MB）')


if __name__ == '__main__':
    main()
