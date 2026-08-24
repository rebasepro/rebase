# rebase.pro

The Rebase marketing site and documentation, at [rebase.pro](https://rebase.pro).
Astro 7 with Starlight for docs, React 19 islands for the live demos, MDX content
and Tailwind CSS v4.

## Before you change a page

Read [`SITE-STORY.md`](SITE-STORY.md) first. It is the source of truth for what
each page is for: the claims the site is allowed to lead with, the information
architecture, the per-page demo budget, and the design language. **If a section
can't be justified from that document, it does not belong on the site.**

[`PRODUCT.md`](PRODUCT.md) records the durable product truth behind it —
audience, constraints, and the things future work must not fabricate.

## Commands

Run from `website/`. This repo uses `pnpm` exclusively.

| Command | Action |
| :--- | :--- |
| `pnpm install` | Install dependencies (run from the repo root) |
| `pnpm dev` | Dev server at `localhost:4321` |
| `pnpm build` | Production build to `./dist/` (runs `prebuild` first) |
| `pnpm preview` | Preview the production build locally |
| `pnpm generate-all` | Regenerate the changelog copy, `llms.txt` and the sitemap |
| `pnpm genAPI` | Regenerate the API reference from TypeDoc |
| `pnpm deploy` | Build and deploy to Firebase Hosting (`rebase-578f2`) |

## Structure

```text
website/
├── public/                 static assets, images, redirect targets
├── scripts/                build-time generators (see "Generated artifacts")
└── src/
    ├── components/         page sections and the live demo components
    ├── content/
    │   ├── blog/           blog posts
    │   └── docs/           Starlight documentation, one directory per locale
    ├── i18n/               marketing-site translations (en, es, de, fr)
    ├── layouts/            Layout.astro — the shell every marketing page uses
    ├── pages/
    │   ├── [...lang]/      every marketing page, localised
    │   ├── blog/           blog index and post routes
    │   ├── dev/demos.astro internal gallery of the live demo components
    │   └── policy/         legal pages
    ├── scripts/            client-side scripts, incl. the A/B testing harness
    └── styles/             global.css and per-surface stylesheets
```

The site imports the real product packages (`@rebasepro/ui`, `@rebasepro/admin`,
`@rebasepro/app`) as workspace dependencies and aliases them to source in
`astro.config.mjs`, so the demos run the actual components rather than mockups.

## Localisation

Marketing and docs are deliberately asymmetric:

- **Marketing — 4 locales** (`en`, `es`, `de`, `fr`), served from
  `src/pages/[...lang]/` with strings in `src/i18n/`.
- **Docs — 6 locales** (`en`, `de`, `es`, `fr`, `it`, `pt`), configured in the
  Starlight integration in `astro.config.mjs`.

## Generated artifacts

`prebuild` runs before every build and regenerates:

- `llms.txt` — the machine-readable site index. **A page absent from the
  Starlight sidebar is absent from `llms.txt`.**
- the sitemap and the per-page `.md` variants (`[page].md.ts`, `index.md.ts`)
- the changelog, copied in from the repo root

Never hand-edit these; change the source or the generator in `scripts/`.

## Things that will surprise you

- **Removed routes carry 301s in `firebase.json`** (`/features` → `/product`,
  `/why-rebase` → `/compare`). Don't resurrect them.
- **The `navigation-structure` A/B variant is parked at weight 0**, not deleted
  (`src/scripts/ab-testing.ts`, `src/layouts/Layout.astro`). Flip the weights to
  run it again.
- **`NeatBackground` does not render in headless screenshots.** It is decoration,
  never a section's only light — pair it with CSS radial gradients.
- Open legal items are tracked in [`LEGAL-TODO.md`](LEGAL-TODO.md).
