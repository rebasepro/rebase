# Preview cards

`card.html` is the single source for every preview image the project serves.
`render.mjs` shoots it at each size the platforms want:

| Output | Size | Used by |
| --- | --- | --- |
| `../public/img/social-preview.png` | 1280×640 | GitHub repo → **Settings → Social preview** (uploaded by hand; GitHub has no API for it) |
| `../public/img/teaser.png` | 1200×630 | `og:image` — [`src/layouts/Layout.astro:41`](../src/layouts/Layout.astro) and the JSON-LD `screenshot` |
| `../public/img/twitter_teaser.png` | 1200×630 | `twitter:image` — [`src/layouts/Layout.astro:181`](../src/layouts/Layout.astro) |

```bash
pnpm --filter website og
```

Add `--open` to preview the results.

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
