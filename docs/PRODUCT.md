# Product

<!-- impeccable:product-schema 1 -->

Shared product truth for the Rebase monorepo. App-specific records extend this file
and do not repeat it:

- [`website/PRODUCT.md`](website/PRODUCT.md) — the marketing site and docs at rebase.pro
- [`packages/admin/PRODUCT.md`](packages/admin/PRODUCT.md) — the CMS / admin panel
- [`packages/ui/PRODUCT.md`](packages/ui/PRODUCT.md) — the public design system

## Platform

web

## Users

Three audiences, in the order the product serves them:

1. **The developer who owns the database.** Adopts Rebase to turn a Postgres
   database they already control into a product backend. Works in a terminal and
   an editor, in TypeScript, with `pnpm`. Evaluates on whether they can keep
   owning the data and the code.
2. **The operator team the developer hands the panel to.** Editors, ops, and
   support staff who live in the admin panel to read and change production data.
   They did not choose Rebase and will not read its docs.
3. **The agent.** MCP clients and coding agents operating the backend through
   scoped API keys, under the same authorization the humans get. Treated as a
   first-class caller, not an integration.

## Product Purpose

Rebase turns a Postgres database into a product backend — REST, a typed SDK,
realtime, auth, storage, functions, cron, and backups — with access control
enforced by Postgres itself. When a human needs to touch the data, the same
collection definition renders a full admin panel.

Success is a developer pointing Rebase at a database they own and getting a
production-ready backend, without a second data model and without a vendor
holding their credentials.

## Positioning

Four claims, ranked. Anything below them is a feature, not a claim.

1. **Security lives in the database.** Row-level security, fail-closed by
   default, generated from the collection definition — not middleware someone can
   forget to call. Tables without RLS are not served.
2. **One definition, every surface.** A collection compiles to a Drizzle schema,
   REST routes, an OpenAPI spec, typed SDK accessors, and RLS policies — and, if
   wanted, an admin panel. There is no second data model.
3. **The panel is a separate product.** It is a React app talking to the same
   public API under the same policies. Add it, skip it, or delete it; the API
   response does not move.
4. **Agent-native.** MCP server, scoped API keys, installable agent skills.

Three adoption modes are the shape of the offer (see
[MODULAR-ARCHITECTURE.md](MODULAR-ARCHITECTURE.md)): **BaaS** (API only, no React
in the dependency tree), **CMS** (BaaS + schema-driven admin panel), and **Full**
(CMS + Studio).

## Operating Context

- Adoption starts at a terminal: `pnpm dlx @rebasepro/cli init`, then
  `docker compose up -d db`, `pnpm run db:push`, `pnpm run dev`. Panel on
  `:5173`, API on `:3001`.
- Self-hosting is the deployment story: the developer runs it on their own
  infrastructure and holds their own credentials.
- `npx @rebasepro/rls-check $DATABASE_URL` audits a database Rebase has never
  seen, with nothing installed — the one claim that can be verified by a stranger
  in seconds.
- Evaluation happens against named competitors: Supabase, Firebase, Payload,
  Directus, Strapi, Hasura, Retool, Django.
- Community and support run through Discord and GitHub.

## Capabilities and Constraints

**Confirmed capabilities**

- PostgreSQL-first, via Drizzle ORM, with schema introspection and automatic
  migrations. MongoDB and Firebase drivers also exist.
- Auth, S3-compatible storage, realtime (LISTEN/NOTIFY-based CDC), backups and
  restore, serverless functions, cron.
- Studio: SQL editor, schema visualizer, RLS editor, logs, API explorer.
- MCP server; scoped API keys; installable agent skills.
- Admin panel views: virtualized spreadsheet table, card grid, list, and
  arbitrary custom React views. Import/export in CSV, JSON, and Excel.

**Durable constraints**

- Open source, MIT, at `github.com/rebasepro/rebase`. Packages publish to npm
  under `@rebasepro/*`; current line is `0.13.x`.
- **Self-host is the only thing that ships today.** There is no purchasable
  managed Rebase tier, and no surface may present one as available, priced, or
  deployable. Pre-launch lead capture *is* allowed: a clearly-labelled
  "not launched yet" lane and a waitlist are legitimate, and both ship on the
  home page today. The internal cloud work under `saas/` is not product truth —
  never describe its capabilities, tenancy, or timeline publicly.
- **The `/europe` exception:** that page argues self-hosting and nothing else. Its
  counterweight to "you are the only processor" is *"being the only processor is
  also a job"* — never a hosted tier we would rather sell. This restriction is
  specific to `/europe`, not site-wide.
- `pnpm` exclusively. Node `>=22.22.0` for the server line.
- React `>=19.2.7`, `react-router` 8, Tailwind CSS v4, Radix UI, lucide-react.
- Authorization is Postgres RLS. A `securityRules` edit is only real once a
  migration applies it.

**Terminology** — *collection* (the single TypeScript definition), *snapshot* (a
record in the admin panel), *driver* (the data backend), *Studio* (the database
workspace), *BaaS / CMS / Full* (the three adoption modes).

## Brand Commitments

- Name **Rebase**; domain `rebase.pro`; npm scope `@rebasepro`; logo at
  `https://rebase.pro/img/logo_small.png`.
- **Backend-first positioning is binding.** The backend leads; the admin panel is
  the layer you opt into. Leading with the panel undersells the product and
  mispositions it against Supabase-class competitors.
- A binding design language already exists and is not renegotiated per surface.
  Its authority lives in `packages/ui/src/theme.css` (tokens) and
  `website/SITE-STORY.md` §6 (site-level rules). New work reads them; it does not
  restate or replace them without an explicit decision.
- **No emoji in product or marketing UI.** Icons are lucide paths, inherited
  colour, sized to the text.
- Claims must be defensible against a reader who knows the competing products.
  A comparison that cannot be defended costs more than it is worth.

## Evidence on Hand

- Live demo: `demo.rebase.pro`. Docs: `rebase.pro/docs`. Community: Discord.
- Real product screenshots under `https://rebase.pro/img/` (e.g.
  `demo_products.png`) and `website/public/`.
- `packages/rls-check` produces real terminal output that marketing renders
  verbatim (`RlsCheckReport.astro` ← `packages/rls-check/src/report.ts`).
- Runnable example apps: `app/`, `examples/firebase`, `examples/sdk-demo`.
- **Client logos and case studies are real and already shipped** — see
  `website/src/components/ClientLogos.astro` (logo wall, with the assets in
  `website/public/img/logos/`) and `website/src/components/CaseStudiesCarousel.astro`
  (three named projects with live URLs). Note the logo wall is deliberately
  labelled as teams shipping on *"Rebase and FireCMS"*, not on Rebase alone;
  future copy must keep that distinction rather than implying they are all
  Rebase users.
- **Absences future work must not fabricate:** no written testimonials or
  pull-quotes, no published benchmarks, no user or download counts, no pricing
  for a hosted tier.

## Product Principles

1. **The backend stands alone.** Every surface must hold up for someone who will
   never install the admin panel.
2. **One definition, no second model.** If a surface needs data shape, it derives
   it from the collection rather than restating it.
3. **Prove it, don't assert it.** A claim earns its place with something the
   reader can run or watch — real output, a live demo, a verifiable command.
4. **Modularity is the promise.** Nothing is bundled that the user did not ask
   for; anything added must be removable without moving the API response.
5. **The operator is not the buyer.** The person who chose Rebase and the person
   who lives in the panel are different people with different needs, and the
   panel answers to the second one.

## Accessibility & Inclusion

- WCAG AA contrast is treated as a floor, not an aspiration: brand colours have
  already been changed to meet it (the secondary was moved off `#FF5B79` at
  2.99:1 to `#E11D48` at 4.70:1 for exactly this reason).
- `prefers-reduced-motion` is honoured in existing UI and must stay honoured.
- Radix UI primitives carry the keyboard and ARIA semantics; components wrap them
  rather than reimplementing the behaviour.
- **Undecided:** no specific conformance target (e.g. WCAG 2.2 AA) has been
  formally committed to.
