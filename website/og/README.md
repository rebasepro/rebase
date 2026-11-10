# Preview cards

Every preview image the site serves is a still of a drafted hero: the glow
`HeroBackdrop.astro` draws (NeatBackground's `GLOW_CONFIG`) lighting the top
and fading into the `#08090A` ground, the faint drafting grid and the two rails
over it, a mono uppercase eyebrow with a cyan dot, and the headline in
Instrument Sans. No ticks or corner markers, no curves, no panel behind the
type: the hero has none of them.

One template, `card.html`, and one module, `../scripts/og/neat.mjs` (the glow
config, the seat each card is lit from, and the renderer), back all three
scripts below, so the cards cannot drift from each other. Each card's glow is
seated where the live hero for that route opens (`seatFor` mirrors
`glowPoseForPath` in `NeatBackground.tsx`), so `/pricing` previews the light
`/pricing` shows.

| Output | Size | Rendered by | Used by |
| --- | --- | --- | --- |
| `../public/img/og/*.png` | 1200×630 | `scripts/generate_og_images.mjs` | The per-route cards; `Layout.astro` picks `og/<route>.png`, falling back to `og/home.png` (also the JSON-LD `screenshot`); the docs' `og:image` in `astro.config.mjs` is `og/docs.png` |
| `../public/img/blog/og/<slug>.png` | 1200×630 | `scripts/generate_blog_images.mjs` | Each blog post's `og:image` |
| `../public/img/social-preview.png` | 1280×640 | `og/render.mjs` | GitHub repo → **Settings → Social preview** (uploaded by hand; GitHub has no API for it) |
| `../public/img/teaser.png`, `twitter_teaser.png` | 1200×630 | `scripts/og/render.mjs`, from `scripts/og/teaser.html` | Nothing in `src/` since 2026-09-23; not rendered from this template |

From the repo root:

```bash
node website/scripts/generate_og_images.mjs           # all route cards; --only <slug> for one
node website/scripts/generate_blog_images.mjs --force # all blog cards; without --force only missing ones
node website/og/render.mjs                            # the GitHub social preview; --open to view it
pnpm --dir website check:blog-images                  # every published post has a card
```

They need `@playwright/test` (Playwright's Chromium, or `OG_CHROME_CHANNEL=chrome`
for the installed Chrome, which is also tried when the bundled browser is
missing). `og/render.mjs` also needs ImageMagick's `magick`.

## Notes for whoever edits it next

- **`card.html` cannot be opened as a file.** The copy and the glow's seat are
  injected at its `/*CARD*/` marker, and the Neat licence validates through Web
  Crypto, which only exists in a secure context: `http://localhost` is one, a
  `file://` URL is not. `neat.mjs` serves it on a local port.
- **Keep `GLOW` in step with `GLOW_CONFIG`.** The one deliberate difference is
  `speed: 0`, which holds the shader clock at the seat's `seed` so a re-run
  rewrites the same bytes.
- **One composition, any width.** `1rem` is 1/75 of the width (16px at 1200), and
  every length is in `rem`, so 1200×630 and 1280×640 are the same card. At 1200
  it is the 1440 desktop shell scaled to fit: rails at 120px, 80px cells.
- **Long headlines step down** in the page until the copy clears the nav row. A
  `\n` in a title is a line of its own, as the home hero's two lines are.
- **The copy is the page's.** Route cards keep their eyebrow, headline and
  subtitle in `CARDS`; the home card's headline is the hero's H1. The social
  preview reads the hero's badge, headline and subtitle from `src/i18n/en.ts`
  and the install command from `HomeContent.astro` at render time.
- **The social preview is captured at `deviceScaleFactor: 2` and downsampled with
  Lanczos.** The mark is 64 flat fills meeting along long diagonals, so nearly all
  of its antialiasing is blend colour between two facets. Never put a colour
  quantiser in this path — `logo_small.png` shipped visibly aliased once that way.
- Keep the social preview under **1MB**; that is GitHub's ceiling, and
  `og/render.mjs` fails when it is over.
