# Glyph-only type icons

The white symbol from each `../{type}.png` badge, with its coloured plate and white outline
removed, on transparency.

Needed for dual-energy chips: those are one square split corner to corner, drawn as a diagonal
gradient of the two type colours (see `TYPE_CHIP_COLORS` in `src/data/constants.js`) with a glyph
laid in each half. Using the full badges there instead makes one chip read as two, because each
badge carries its own fill, rounding and outline.

Derived from the badges rather than redrawn, so the two can't drift apart. For each pixel the
alpha is solved from `P = a·white + (1 − a)·fill` using the channel with the most contrast
against white, and the outer 13% is cropped first to drop the badge's white outline ring.
Filenames are NFC-normalised — macOS writes the dakuten in `みず`/`はがね` decomposed, which the
dev server then fails to match against the composed form the browser requests.
