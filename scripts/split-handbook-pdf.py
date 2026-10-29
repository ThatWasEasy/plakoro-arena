#!/usr/bin/env python3
"""Split the 秘笈手冊 PDF into the units that are sold separately.

Why the PDF rather than the structured conversion: the book is built out of tables and
diagrams laid out on a page, and every conversion route lost something — images matched to the
wrong paragraph, cells parsed empty, in-cell line breaks eaten so three expected values read as
one number. A PDF is what the authors see. The cost is real and worth stating: no search across
chapters, and fixed-layout pages are harder to read on a phone.

Chapter boundaries come from the PDF's own outline, which Google Docs writes from the heading
styles — not from guessing at page numbers.

Each unit becomes its own file, and that is the whole point of the design: there is never a
file, and never an endpoint, that hands over the entire book. A player's entitlement is checked
per unit (`player_unlocks.kind = 'handbook'`, `asset` = the unit id used here), and only those
bytes are served.

Page numbers restart at 1 in every unit. The source carries no printed page numbers, so this
needs nothing stamped — a reader simply sees "page 3 of 7" within the chapter they bought.

    python3 scripts/split-handbook-pdf.py --pdf "temp/Plakoro 秘笈手冊.pdf"
"""
import argparse
import json
import logging
import pathlib
import re
import sys
import unicodedata
import warnings

logging.disable(logging.CRITICAL)
warnings.filterwarnings('ignore')

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    sys.exit('需要 pypdf：python3 -m pip install --user pypdf')

REPORT = []

CH3_PREFIX = '三、'
# Front matter is a chapter as far as the shelf is concerned: it is where a reader starts, and
# its contents list doubles as a look at what else there is to buy.
FRONT_MATTER = ('序',)
CHAPTER = re.compile(r'^[一二三四五六七八九十]+、')
SET_HEADER = re.compile(r'^(啟程套組|探險盒\s*\d+|.*套組)\s*$')
CHARACTER = re.compile(r'^\s*(\d+)\.\s*(.+?)\s*[（(]\s*([A-Za-z]{3}\d{2}(?:-\d{3})?)\s*[)）]\s*$')
TEMPLATE = re.compile(r'^\s*X\.\s')


def outline_entries(reader):
    """Every bookmark as (depth, page index, title), in reading order.

    Google Docs emits a bookmark for each heading, including empty ones left behind by blank
    paragraphs; those are dropped here because a nameless boundary cannot start a chapter.
    """
    out = []

    def walk(items, depth=0):
        for it in items:
            if isinstance(it, list):
                walk(it, depth + 1)
                continue
            title = str(getattr(it, 'title', '') or '').strip()
            if not title:
                continue
            try:
                page = reader.get_destination_page_number(it)
            except Exception:
                continue
            out.append((depth, page, title))

    walk(reader.outline)
    return out


def page_text(reader, i, _cache={}):
    """Normalised text of a page.

    NFKC because this PDF renders many CJK characters as Kangxi radicals — 子 comes back as
    ⼦, 火 as ⽕ — so a naive string compare against the outline's titles fails on half the
    book while the content is perfectly fine.
    """
    key = (id(reader), i)
    if key not in _cache:
        try:
            raw = reader.pages[i].extract_text() or ''
        except Exception:
            raw = ''
        _cache[key] = unicodedata.normalize('NFKC', re.sub(r'\s+', '', raw))
    return _cache[key]


# How far a bookmark is allowed to be wrong before we give up and trust it anyway.
BOOKMARK_DRIFT = 3
# How much text may sit above a heading before its page counts as shared with the section
# before it. A heading that genuinely opens a page has almost nothing in front of it.
SHARED_PAGE_CHARS = 40


def true_start(reader, page, code, total):
    """Where a character's section really begins.

    The outline is written from the heading styles and is usually exact, but not always: 大岩蛇
    is bookmarked one page before its heading, so splitting on the bookmark alone opened that
    chapter on the previous character's match-up table. The card code in the heading —
    "(EBC01-005)" — is unambiguous, so the page carrying it is the real boundary.
    """
    needle = unicodedata.normalize('NFKC', code)
    for delta in range(0, BOOKMARK_DRIFT + 1):
        for cand in ({page + delta, page - delta} if delta else {page}):
            if 0 <= cand < total and needle in page_text(reader, cand):
                return cand, delta != 0
    return page, False


def plan(reader):
    """Work out which pages belong to which sellable unit.

    Every top-level chapter is a unit, and chapter three — the 84% of the book that is
    per-character writing — explodes into one unit per character. The catalogue then reads as
    chapters with the character chapters sold alongside them, rather than as one
    undifferentiated "everything else" bundle.

    A unit owns every page from its own heading up to whatever starts next, so the ranges come
    from neighbours rather than from a length nobody wrote down. Set headers ("探險盒 01")
    share a page with the first character under them and own nothing themselves — they are
    recorded as a group label, because bundles are priced in the shop and a regroup should be
    a pricing change, not a re-split.
    """
    entries = outline_entries(reader)
    total = len(reader.pages)

    marks, in_ch3, group = [], False, None
    for _, page, title in entries:
        if CHAPTER.match(title) or title in FRONT_MATTER:
            in_ch3 = title.startswith(CH3_PREFIX)
            # Chapter three owns no pages of its own: its divider page falls to the first
            # character after it, and the chapter appears in the catalogue as the group those
            # characters belong to.
            if not in_ch3:
                marks.append({'kind': 'chapter', 'page': page, 'title': title})
            continue
        if not in_ch3:
            continue
        if TEMPLATE.match(title):
            marks.append({'kind': 'template', 'page': page, 'title': title})
            continue
        m = CHARACTER.match(title)
        if m:
            _, name, code = m.groups()
            marks.append({'kind': 'character', 'page': page, 'title': name,
                          'id': f'chara.{code.upper()}', 'code': code.upper(), 'group': group})
            continue
        if SET_HEADER.match(title):
            group = title.strip()

    # Deduplicate: Google repeats a bookmark when a heading is split across runs.
    seen, ordered = set(), []
    for m in marks:
        key = (m['kind'], m.get('id'), m.get('title'), m['page'])
        if key in seen:
            continue
        seen.add(key)
        ordered.append(m)
    ordered.sort(key=lambda m: m['page'])

    # Correct each boundary against the page that actually carries the heading, before the
    # ranges are derived from neighbours — otherwise one bad bookmark shifts two units.
    for m in ordered:
        if m['kind'] == 'character':
            fixed, moved = true_start(reader, m['page'], m['code'], total)
            if moved:
                m['drift'] = fixed - m['page']
            m['page'] = fixed
    ordered.sort(key=lambda m: m['page'])

    # Each unit runs up to whatever starts next; the last one runs to the end of the book.
    # (It used to fall back to "where chapter three ends", which was right when only characters
    # were being cut and silently gave the final chapter zero pages once chapters were too.)
    for i, m in enumerate(ordered):
        nxt = ordered[i + 1]['page'] if i + 1 < len(ordered) else total
        m['end'] = nxt - 1

    # A page is the smallest thing that can be split, so a section starting halfway down one
    # carries the tail of its neighbour with it. Nothing can fix that here — the page belongs
    # to the later unit so that chapter is at least complete — but one page break in the Doc
    # fixes it at source, which is why this is reported rather than papered over.
    for m in ordered:
        if m['kind'] != 'character':
            continue
        text = page_text(reader, m['page'])
        at = text.find(unicodedata.normalize('NFKC', m['code']))
        if at > SHARED_PAGE_CHARS:
            REPORT.append(('warn',
                           f"{m['id']}（{m['title']}）的標題在第 {m['page'] + 1} 頁的中段，"
                           '該頁上半屬於前一個角色 —— 請在 Google Docs 的這個標題前插入分頁符'))

    for m in ordered:
        if m.get('drift'):
            REPORT.append(('warn', f"{m.get('id', m['title'])} 的書籤偏了 {m['drift']:+d} 頁，"
                                   '已依標題所在頁修正'))

    units = []
    for m in ordered:
        if m['kind'] == 'template':
            continue
        pages = list(range(m['page'], m['end'] + 1))
        if m['kind'] == 'chapter':
            units.append({'id': chapter_id(m['title']), 'kind': 'chapter',
                          'title': m['title'], 'group': None, 'pages': pages})
        else:
            units.append({'id': m['id'], 'kind': 'character', 'title': m['title'],
                          'group': m['group'], 'cardCode': m['code'], 'pages': pages})

    # The cover and the contents list come before the first bookmark, so nothing claimed them.
    # They belong with the front matter.
    if units and units[0]['pages'] and units[0]['pages'][0] > 0:
        units[0]['pages'] = list(range(0, units[0]['pages'][0])) + units[0]['pages']
    return units


CHAPTER_NUMERAL = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6,
                   '七': 7, '八': 8, '九': 9, '十': 10}


def chapter_id(title):
    """A stable id for a chapter, so re-wording a heading does not orphan what people bought."""
    if title in FRONT_MATTER:
        return 'front'
    n = CHAPTER_NUMERAL.get(title[0])
    return f'ch{n}' if n else 'ch-' + re.sub(r'\W+', '', title)[:12].lower()



def shrink(path, quality):
    """Re-encode the embedded images, which is where almost all the weight is.

    The source puts an aged-paper texture behind every page as a 1054x1492 **PNG** — 3.3MB of
    photographic noise in a lossless format — so every extracted chapter carried it and a
    six-page file came out at 3.9MB. Re-encoding to JPEG takes the same chapter to ~0.5MB.

    Measured against the original render at 150dpi: mean pixel difference 1.6/255, and not one
    pixel differing by more than 16. The body text is vector and is not touched at all; only
    the texture and the diagrams are images.

    Needs PyMuPDF. Without it the split still works, just heavy.
    """
    try:
        import fitz
    except ImportError:
        return None
    doc = fitz.open(str(path))
    doc.rewrite_images(quality=quality)
    doc.subset_fonts()
    # MuPDF refuses to rewrite a file it has open, so the compacted copy is written beside it
    # and swapped in. Garbage collection is the point: it is what drops the objects the
    # extracted pages no longer reach.
    tmp = path.with_suffix('.tmp')
    doc.save(str(tmp), garbage=4, deflate=True, clean=True)
    doc.close()
    tmp.replace(path)
    return path.stat().st_size


# The h5-as-styling noise again: the source's outline carries a bookmark for every star
# rating, percentage triple and speaker label, so a chapter's 7 pages produce 80 bookmarks of
# which 4 are section headings.
TOC_NOISE = (
    re.compile(r'[★☆]'),
    re.compile(r'^\s*[\d.]+%'),
    re.compile(r'^\s*(打擊|傷害)\s*\d'),
    re.compile(r'^\s*(Andy|Shawn)\s*[：:]'),
    re.compile(r'^\s*【'),
    re.compile(r'^\s*此招式'),
)


def unit_toc(entries, unit):
    """The sections inside one unit, as the book itself lists them.

    Taken from the source's own outline rather than written by hand, so a chapter that gains a
    section gains it here too. Only the level directly below the unit's own heading is kept —
    one deeper is where the noise lives, and shallower is the unit itself.

    Pages are relative to the unit, because that is the only numbering its reader knows.
    """
    first, last = unit['pages'][0], unit['pages'][-1]
    inside = [(d, p, t) for d, p, t in entries if first <= p <= last]
    if not inside:
        return []
    want = min(d for d, _, _ in inside) + 1
    toc, seen = [], set()
    for d, page, title in inside:
        if d != want or any(rx.search(title) for rx in TOC_NOISE):
            continue
        label = title.rstrip('：: ').strip()
        key = (label, page)
        if not label or key in seen:
            continue
        seen.add(key)
        toc.append({'title': label, 'page': page - first + 1})
    return toc


def write_unit(reader, unit, out_dir):
    """One unit, one file, carrying nothing that refers to the rest of the book.

    The outline and the link annotations both address the whole document, so copied into a
    seven-page extract they point at pages that are not there — and, worse, name chapters the
    reader has not bought. Both are dropped; navigation is the app's job.
    """
    writer = PdfWriter()
    for p in unit['pages']:
        page = reader.pages[p]
        if '/Annots' in page:
            del page['/Annots']
        writer.add_page(page)
    path = out_dir / f"{unit['id']}.pdf"
    with path.open('wb') as f:
        writer.write(f)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', default='temp/Plakoro 秘笈手冊.pdf')
    ap.add_argument('--catalogue', default='handbook',
                    help="哪一份目錄：handbook（完整）或 preview（試閱）")
    ap.add_argument('--out', default=None,
                    help='預設是 handbook-build/catalogues/<catalogue>')
    ap.add_argument('--quality', type=int, default=80,
                    help='重新編碼內嵌影像的 JPEG 品質；0 表示不壓')
    args = ap.parse_args()

    src = pathlib.Path(args.pdf)
    if not src.is_file():
        sys.exit(f'找不到檔案：{src}')
    reader = PdfReader(str(src))
    out = pathlib.Path(args.out or f'handbook-build/catalogues/{args.catalogue}')
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob('*.pdf'):
        old.unlink()

    units = plan(reader)
    entries = outline_entries(reader)
    manifest, report, saved_total = [], list(REPORT), []
    for u in units:
        if not u['pages']:
            report.append(('warn', f"{u['id']} 沒有任何頁面，略過"))
            continue
        path = write_unit(reader, u, out)
        raw = path.stat().st_size
        if args.quality:
            if shrink(path, args.quality) is None:
                report.append(('warn', '沒有 PyMuPDF，檔案維持未壓縮的大小。'
                                       '安裝：python3 -m pip install --user pymupdf'))
                args.quality = 0
        saved_total.append((raw, path.stat().st_size))
        manifest.append({k: v for k, v in u.items() if k != 'pages'}
                        | {'pages': len(u['pages']), 'file': path.name,
                           'bytes': path.stat().st_size,
                           'toc': unit_toc(entries, u)})

    (out / 'manifest.json').write_text(
        json.dumps({'source': str(src), 'sourcePages': len(reader.pages), 'units': manifest},
                   ensure_ascii=False, indent=2), encoding='utf-8')

    shelf = pathlib.Path(__file__).with_name('handbook-shelf.html')
    if shelf.exists():
        import shutil
        shutil.copy2(shelf, out / 'shelf.html')

    print(f'來源：{src}（{len(reader.pages)} 頁）')
    print(f'輸出：{out}  （{len(manifest)} 個單位）\n')
    print(f"{'unit id':22}{'頁數':>5}{'大小':>10}  標題")
    for m in manifest:
        print(f"  {m['id']:20}{m['pages']:>5}{m['bytes']/1024:>9.0f}K  {m['title']}"
              + (f"  [{m['group']}]" if m.get('group') else ''))

    covered = sum(m['pages'] for m in manifest)
    if saved_total:
        a = sum(x for x, _ in saved_total)
        b = sum(y for _, y in saved_total)
        print(f'\n影像重新編碼：{a / 1048576:.0f}MB → {b / 1048576:.0f}MB'
              f'（省 {100 - 100 * b / a:.0f}%）')
    print(f"\n涵蓋 {covered}/{len(reader.pages)} 頁"
          f"（差額是「X. 範本」，刻意排除）")
    print(f'書架：cd {out.parent} && python3 -m http.server 4801'
          f'   → http://localhost:4801/{out.name}/shelf.html')
    for level, msg in report:
        print(f'  {"⚠️ " if level == "warn" else "·"} {msg}')


if __name__ == '__main__':
    main()
