#!/usr/bin/env python3
"""Turn the 秘笈手冊 into structured content the app can render and sell.

The source is the Google Docs **Markdown** export, and that choice is why this script is short.
The HTML export describes the same book far worse:

    h5 used as a styling shortcut   1,759  ->  93
    tables                          a <p> inside every <td>, so every cell parsed empty and
                                    67 tables were dropped as if they were blank
    images                          40 loose files against 53 references, which had to be
                                    re-matched by reading Google's own ref list — matching
                                    them by ordinal put the wrong diagram under a third of
                                    the paragraphs, and looked completely normal on screen

The Markdown export has real tables and carries its images as base64 reference definitions, so
one file is the whole book: nothing to hotlink, nothing to expire, nothing to re-match.

What it costs: the published `/pub` URL could be re-fetched automatically and a downloaded file
cannot, so re-exporting is a manual step whenever the authors change the text.

Output goes to `handbook-build/`, which is gitignored on purpose. This repo is public and its
build is served as static files; a handbook committed here is a handbook given away. Paid
content reaches players through the API's player_unlocks check and nowhere else.

    npm run build-handbook -- --md "temp/Plakoro 秘笈手冊.md"
"""
import argparse
import base64
import json
import pathlib
import re
import shutil
import sys
import unicodedata

BASE, CHARACTER, SPECIAL = 'base', 'character', 'special'

CH3_PREFIX = '三、'
SET_HEADER = re.compile(r'^(啟程套組|探險盒\s*\d+|.*套組)\s*$')
# "7. 甲賀忍蛙(EBC02-001)" — the bracketed code ties a section to a card and is the only part
# worth trusting; the leading number restarts inside each set, so it is a label, not an id.
CHARACTER_HEADING = re.compile(r'^\s*(\d+)\.\s*(.+?)\s*[（(]\s*([A-Za-z]{3}\d{2}(?:-\d{3})?)\s*[)）]\s*$')
TEMPLATE_HEADING = re.compile(r'^\s*X\.\s')

RATING = re.compile(r'[★☆]{3,}')
SPEAKER = re.compile(r'^\s*(Andy|Shawn)\s*[：:]')

IMAGE_DEF = re.compile(r'^\[(image\d+)\]:\s*<data:image/(\w+);base64,([^>]+)>\s*$', re.M)
IMAGE_REF = re.compile(r'!\[[^\]]*\]\[(image\d+)\]')
HEADING = re.compile(r'^(#{1,6})\s+(.*?)\s*(?:\{#[^}]*\})?\s*$')
# The exported contents list is ~150 lines of "[title\t12](#anchor)" before the book starts.
# It is navigation, regenerated on every export, and the reader builds its own.
TOC_LINE = re.compile(r'^\s*\[.*\]\(#.*\)\s*$')
TABLE_RULE = re.compile(r'^\s*\|?[\s:|-]+\|[\s:|-]*$')
BULLET = re.compile(r'^(\s*)[*+-]\s+(.*)$')


def unescape(text):
    """Undo the export's escaping and drop emphasis markers.

    Bold and italics are decoration applied in a word processor, not structure the reader
    needs — left in, the asterisks print literally.
    """
    # Google writes a line break *inside* a cell as a vertical tab. Left alone it is invisible
    # whitespace, so "28.6\x0b24.2\x0b10" — three expected values, one per line on the page —
    # renders as "28.624.210". In a book about expected values that is not a cosmetic loss.
    text = text.replace('\x0b', '\n').replace('\r', '\n')
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)', r'\1', text)
    text = re.sub(r'\\([\\`*_{}\[\]()#+\-.!|])', r'\1', text)
    text = re.sub(r'[ \t]+', ' ', text)
    return re.sub(r' ?\n ?', '\n', text).strip()


def parse_cell(raw, images):
    """A table cell, which may hold pictures as well as words.

    Half the book's images sit inside table rows — a state column beside the diagram it labels —
    so they have to stay in the cell rather than being lifted out to sit near the table, or the
    picture stops being attached to the row it explains.
    """
    imgs = [images[r] for r in IMAGE_REF.findall(raw) if r in images]
    text = unescape(IMAGE_REF.sub('', raw))
    # "Andy：★☆☆☆☆；。" — the template leaves the punctuation of a review behind even when
    # nobody wrote one. Printed, it reads as a one-character verdict on every move in the book.
    text = re.sub(r'([★☆])\s*[；;]\s*。\s*', r'\1', text).strip()
    return {'t': text, 'imgs': imgs} if imgs else {'t': text}


def classify_aside(text):
    """An h5 is never a heading here — the authors reached for it to get a particular look.

    After the Markdown export only 93 remain and they really are asides: a note, a reminder,
    or one of the two authors speaking. A star rating that still turns up gets split from the
    review beside it, so the stars can be drawn as stars rather than read as a sentence.
    """
    m = RATING.search(text)
    if m:
        speaker = SPEAKER.match(text)
        stars = m.group(0)
        comment = text[m.end():].lstrip('；;：: ').strip()
        if not re.search(r'[\w一-鿿]', comment):
            comment = ''
        return {'type': 'rating', 'by': speaker.group(1) if speaker else None,
                'filled': stars.count('★'), 'outOf': len(stars), 'comment': comment}
    speaker = SPEAKER.match(text)
    if speaker:
        return {'type': 'aside', 'by': speaker.group(1),
                'text': text[speaker.end():].lstrip('：: ').strip()}
    return {'type': 'aside', 'by': None, 'text': text}


def parse(md, images):
    """Markdown to an ordered block list.

    Line-based on purpose. The export is machine-written, so its table rows really do start
    with a pipe and its headings really are at the start of a line; a general parser would
    only add ways to be wrong about a document this regular.
    """
    blocks, para = [], []
    table = None
    in_toc = True

    def flush_para():
        if para:
            text = unescape(' '.join(para))
            if text:
                blocks.append({'type': 'p', 'text': text})
            para.clear()

    def flush_table():
        nonlocal table
        if table:
            rows = [r for r in table if any(c.get('t') or c.get('imgs') for c in r)]
            if rows:
                blocks.append({'type': 'table', 'rows': rows})
        table = None

    for raw in md.split('\n'):
        line = raw.rstrip()

        if IMAGE_DEF.match(line):          # definitions sit at the end; already extracted
            continue

        # Everything before the first real heading is the generated contents list.
        if in_toc:
            if HEADING.match(line):
                in_toc = False
            else:
                continue
        if TOC_LINE.match(line):
            continue

        h = HEADING.match(line)
        if h:
            flush_para()
            flush_table()
            level, text = len(h.group(1)), unescape(h.group(2))
            if text:
                blocks.append(classify_aside(text) if level >= 5
                              else {'type': 'heading', 'level': level, 'text': text})
            continue

        if line.lstrip().startswith('|'):
            flush_para()
            if TABLE_RULE.match(line):     # the |---|---| rule carries no data
                continue
            if table is None:
                table = []
            table.append([parse_cell(c, images) for c in line.strip().strip('|').split('|')])
            continue
        flush_table()

        refs = IMAGE_REF.findall(line)
        if refs:
            flush_para()
            # A line often carries several: "![][image1]![][image2]![][image3]". Taking only
            # the first dropped 43 of the book's 51 pictures, and the page still looked fine.
            for ref in refs:
                name = images.get(ref)
                if name:
                    blocks.append({'type': 'img', 'src': name})
            continue

        if not line.strip():
            flush_para()
            continue

        bullet = BULLET.match(line)
        if bullet:
            flush_para()
            text = unescape(bullet.group(2))
            if text:
                blocks.append({'type': 'li', 'depth': len(bullet.group(1)) // 2, 'text': text})
            continue

        para.append(line.strip())

    flush_para()
    flush_table()
    return blocks


def extract_images(md, out_dir, report):
    """Writes each base64 definition out as a real file, keyed by its reference name."""
    dest = out_dir / 'images'
    dest.mkdir(parents=True, exist_ok=True)
    found = {}
    for name, ext, payload in IMAGE_DEF.findall(md):
        try:
            data = base64.b64decode(payload)
        except Exception as e:
            report.append(('error', f'{name} 的 base64 解不開：{e}'))
            continue
        filename = f'{name}.{"jpg" if ext == "jpeg" else ext}'
        (dest / filename).write_bytes(data)
        found[name] = filename
    refs = set(IMAGE_REF.findall(md))
    for missing in sorted(refs - set(found)):
        report.append(('error', f'文中引用 {missing}，但檔案裡沒有它的定義'))
    for unused in sorted(set(found) - refs):
        report.append(('warn', f'{unused} 有定義但沒有被引用'))
    return found


def split_units(blocks, report):
    """Group the flat block list into the things that can be sold separately.

    Everything outside chapter three is one `base` unit; chapter three becomes one unit per
    character. A set header ("探險盒 01") is recorded as the group a character belongs to,
    rather than becoming a unit of its own — bundles are assembled in the shop, so regrouping
    a set later is a pricing change and not a rebuild.
    """
    base = {'id': 'base', 'kind': BASE, 'title': '本體', 'group': None, 'blocks': []}
    units = [base]
    cur, in_ch3, group = base, False, None

    for b in blocks:
        if b['type'] == 'heading' and b['level'] == 1:
            in_ch3 = b['text'].startswith(CH3_PREFIX)
            group = None
            if not in_ch3:
                cur = base
            cur['blocks'].append(b)
            continue

        if in_ch3 and b['type'] == 'heading' and b['level'] == 2:
            title = b['text']
            if TEMPLATE_HEADING.match(title):
                report.append(('skipped', f'略過樣板區塊「{title}」'))
                cur = {'id': '_t', 'blocks': [], 'drop': True}
                continue
            m = CHARACTER_HEADING.match(title)
            if m:
                _, name, code = m.groups()
                cur = {'id': f'chara.{code.upper()}', 'kind': CHARACTER, 'title': name,
                       'cardCode': code.upper(), 'group': group, 'blocks': []}
                units.append(cur)
                continue
            if SET_HEADER.match(title):
                group = title.strip()
                report.append(('group', f'套組「{group}」'))
                cur = base
                continue
            report.append(('warn', f'第三章有個 h2 既不是角色也不是套組：「{title}」'))
        cur['blocks'].append(b)

    return [u for u in units if not u.get('drop')]


def block_text(b):
    """Every piece of prose in a block, wherever the authors put it.

    Counting only `text` undercounts wildly — most of this book is written inside table cells,
    and a 1,788-word character section was once reported as 63.
    """
    parts = [b.get('text', ''), b.get('comment', '')]
    for row in b.get('rows', []):
        parts.extend(c.get('t', '') for c in row)
    return ''.join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--md', default='temp/Plakoro 秘笈手冊.md', help='Google Docs 的 Markdown 匯出')
    ap.add_argument('--out', default='handbook-build')
    args = ap.parse_args()

    src = pathlib.Path(args.md)
    if not src.is_file():
        sys.exit(f'找不到檔案：{src}')
    md = src.read_text(encoding='utf-8', errors='replace')

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report = []
    images = extract_images(md, out, report)
    units = split_units(parse(md, images), report)

    doc = {
        'source': str(src),
        'units': [{**u,
                   'words': sum(len(re.sub(r'\s+', '', block_text(b))) for b in u['blocks']),
                   'images': sum(1 if b['type'] == 'img' else
                                 sum(len(c.get('imgs', [])) for r in b.get('rows', []) for c in r)
                                 for b in u['blocks'])}
                  for u in units],
    }
    # NFC, because macOS hands back decomposed filenames and browsers ask for composed ones —
    # the same mismatch that 404'd the character art.
    (out / 'handbook.json').write_text(
        unicodedata.normalize('NFC', json.dumps(doc, ensure_ascii=False, indent=2)),
        encoding='utf-8')

    reader = pathlib.Path(__file__).with_name('handbook-reader.html')
    if reader.exists():
        shutil.copy2(reader, out / 'reader.html')

    print(f'來源：{src}')
    print(f'輸出：{out}/handbook.json  （{len(units)} 個可販售單位，{len(images)} 張圖）\n')
    print(f"{'unit id':22}{'類型':<10}{'字數':>8}{'圖':>4}  標題")
    for u in doc['units']:
        print(f"  {u['id']:20}{u['kind']:<10}{u['words']:>8,}{u['images']:>4}  {u['title']}"
              + (f"  [{u['group']}]" if u.get('group') else ''))

    chars = [u for u in doc['units'] if u['kind'] == CHARACTER]
    if chars:
        typical = sorted(u['words'] for u in chars)[len(chars) // 2]
        for u in chars:
            if u['words'] < typical * 0.6:
                report.append(('warn', f"「{u['title']}」只有 {u['words']:,} 字，"
                                       f'約是其他角色（{typical:,}）的一半 —— 可能還沒寫完'))
            if u['images'] == 0:
                report.append(('warn', f"「{u['title']}」沒有任何圖"))

    print(f"\n合計 {sum(u['words'] for u in doc['units']):,} 字")
    print(f'閱讀器：cd {out} && python3 -m http.server 4800   → http://localhost:4800/reader.html')
    if report:
        print('\n--- 需要你確認 ---')
        for level, msg in report:
            mark = '❌' if level == 'error' else '⚠️ ' if level == 'warn' else '·'
            print(f'  {mark} {msg}')


if __name__ == '__main__':
    main()
