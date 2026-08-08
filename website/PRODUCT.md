# Product

<!-- impeccable:product-schema 1 -->

The marketing site and documentation at `rebase.pro`. Inherits
[`/PRODUCT.md`](../PRODUCT.md) for shared Rebase truth — users, positioning,
capabilities, brand commitments, and the self-host-only constraint. This file
records only what is specific to the site.

## Platform

web

## Users

The **evaluating developer**, arriving cold. They own a Postgres database or are
about to, they are comparing against a named alternative (Supabase, Firebase,
Payload, Directus, Strapi, Hasura, Retool, Django), and they will decide from the
page whether to run `pnpm dlx @rebasepro/cli init`.

Secondary, and never at the primary developer's expense:

- **The technical decision-maker** on `/europe`, `/security`, `/compare`, and the
  campaign pages (`/startups`, `/agencies`, `/kit-digital`), who is weighing
  control, jurisdiction, and cost rather than API ergonomics.
- **The already-committed developer** in `/docs`, `/sdk`, `/cli`, and
  `/developers`, who has stopped evaluating and is now building.

## Product Purpose

Turn a cold arrival into a scaffolded project. Every page answers one question
and ends at the same CTA pair: *Try the demo* + `pnpm dlx @rebasepro/cli init`.

The docs exist to keep that developer building without leaving.

## Operating Context

- **Astro 7** with Starlight for docs, React 19 islands for demos, MDX content,
  Tailwind v4. Deployed to Firebase Hosting (`rebase-578f2`) via
  `pnpm run deploy`.
- **Localisation is asymmetric and deliberate:** marketing runs 4 locales
  (`en`, `es`, `de`, `fr`, routed through `src/pages/[...lang]/`), docs run 6
  (`en`, `de`, `es`, `fr`, `it`, `pt`).
- Machine-readable surfaces are generated at build time: `llms.txt`, the sitemap,
  per-page `.md` variants, and the changelog copy. A page absent from the sidebar
  is absent from `llms.txt`.
- An A/B testing harness exists (`src/scripts/ab-testing.ts`); the
  `navigation-structure` variant is parked at weight 0 rather than deleted.
- `/dev/demos` is an internal gallery of the site's live demo components.
- The site consumes the real product packages (`@rebasepro/ui`,
  `@rebasepro/admin`, `@rebasepro/app`) as workspace dependencies, so demos run
  the actual components rather than mockups.

## Capabilities and Constraints

- **`SITE-STORY.md` is the site's own source of truth** for what each page is
  for, the four leadable claims, the three-act shape, the information
  architecture, the per-page demo budget, and the design language. A section that
  cannot be justified from it does not belong on the site. Read it before
  changing any page; extend it when a page's job changes.
- **Every major page carries at least one live demo**, not a card grid. A demo
  appears on the home page *and* at most one deep page — whichever page makes the
  claim it proves.
- **`/europe` argues control, not location.** Competitors do provision in the EU;
  claiming otherwise is false and a knowledgeable reader will catch it. The true
  argument is structural: a managed backend has a second party who operates the
  service and holds the credentials.
- **The cost comparison must size both columns from the workload, by the same
  rule**, and must say "here the managed bill wins" when it does. Any change to
  its constants requires re-sweeping every slider combination; the test is zero
  combinations where the figure claims hardware that could not hold the workload,
  on either side.
- Removed routes carry 301s in `firebase.json` (`/features` → `/product`,
  `/why-rebase` → `/compare`). Do not resurrect them.
- Legal pages exist under `/policy`; open items are tracked in `LEGAL-TODO.md`.

## Brand Commitments

Inherits the root record. Site-specific:

- Design language is fixed in `SITE-STORY.md` §6 and marked *do not renegotiate*.
- The numbered eyebrow idiom (`01 · BADGE`) is home-page-only; deep pages use a
  plain uppercase eyebrow.
- Nothing sits above the header.
- A free tool is not a hero: `rls-check` lives next to the claim it tests, shown
  as its real terminal output.

## Evidence on Hand

- Live demo at `demo.rebase.pro`; real product screenshots in `public/img/`.
- Blog under `src/content/blog`; docs under `src/content/docs`.
- Comparison pages are built against real competitor behaviour and must stay
  that way.
- **Absences:** no testimonials, no customer logos, no case studies, no
  benchmarks, no hosted-tier pricing. Do not invent them to fill a section.

## Product Principles

1. **Backend first, panel second** — on every page, in every hero.
2. **One page, one question.** If a page cannot state the question it answers, it
   is a duplicate of another page.
3. **Proof over assertion.** A live demo, real terminal output, or a runnable
   command — never a card grid standing in for evidence.
4. **Defensible against an expert.** Any comparison must survive a reader who
   uses the competitor daily.
5. **Sell only what exists.** Self-hosting is the offer; no hosted tier is
   mentioned in any form.

## Accessibility & Inclusion

Inherits the root record. Site-specific: the sub-`xs` type tier (`--text-2xs`,
`--text-3xs`) is marketing-only and exists to name a real tier the site had
already improvised ~450 times — it is not a licence to shrink copy further, and
product UI must not use it.
