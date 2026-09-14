# Preview cards

Three scripts render the site's preview images, and two of them write the same
files. Check which one owns an image before you re-render it.

| Output | Size | Rendered by | Used by |
| --- | --- | --- | --- |
| `../public/img/social-preview.png` | 1280×640 | `og/render.mjs`, from `og/card.html` | GitHub repo → **Settings → Social preview** (uploaded by hand; GitHub has no API for it) |
| `../public/img/teaser.png` | 1200×630 | `scripts/og/render.mjs`, from `scripts/og/teaser.html` | The default `ogImage` in `src/layouts/Layout.astro` — `og:image`, `twitter:image` and the JSON-LD `screenshot` of any page that passes none |
| `../public/img/twitter_teaser.png` | 1200×630 | `scripts/og/render.mjs`, as a copy of `teaser.png` | Nothing in `src/`: `twitter:image` follows `ogImage` now |
| `../public/img/og/*.png` | 1200×630 | `scripts/generate_og_images.mjs` | The per-route cards pages pass as `ogImage`, and the docs' `og:image` in `astro.config.mjs` |

This directory's template, `card.html`, now owns only the GitHub social preview.
From the repo root:

```bash
node website/og/render.mjs            # add --open to preview the results
```

It needs `@playwright/test` and ImageMagick's `magick` on the path. It **also
overwrites `teaser.png` and `twitter_teaser.png`** with this card, replacing the
hero card `scripts/og/` renders. Unless that is what you want, discard those two
files afterwards or re-run `node website/scripts/og/render.mjs`.

## Notes for whoever edits it next

- **The mark is not copied in.** `card.html` points `<img>` at
  `../public/logo.svg`, so a logo change lands here on the next run. The previous
  template inlined all 64 paths and had to be synced by hand.
- **One set of numbers, two aspect ratios.** `html { font-size: calc(100vw / 80) }`
  makes `1rem` = 16px at 1280 wide; everything else is in `rem`, so 1200×630
  renders the same composition 6% smaller with a little more vertical air.
- **Captures run at `deviceScaleFactor: 2` and downsample with Lanczos.** The mark
  is 64 flat fills meeting along long diagonals, so nearly all of its
  antialiasing is blend colour between two facets. Never put a colour quantiser
  in this path — `logo_small.png` shipped visibly aliased once that way.
- **Fonts come from Google Fonts at render time**, and the capture waits on
  `document.fonts.ready`. Offline, it silently falls back to system metrics.
- Keep the card under **1MB**; that is GitHub's ceiling for a social preview.
- The design follows `SITE-STORY.md` §6: ground `#08090A`, headings weight 500 at
  `-0.022em`, headlines one colour, left-aligned, no eyebrow, no emoji.
