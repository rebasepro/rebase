# Competitor landing-page audit — Payload, Directus, Strapi

Written 2026-08-10. Feeds `SITE-STORY.md`; nothing here is a decision until it is
merged into that file.

**Method.** Full-text transcription of every landing page, plus `/developers`,
`/enterprise`, `/use-cases`, `/case-studies`, `/compare`, `/features`, `/pricing`
and `/ai` where they exist, fetched 2026-08-10. Everything quoted below is their
current live wording.

**Limitation, stated up front.** The in-app browser's page-content tools were
returning `Policy check temporarily unavailable` for the whole session, so this
audit has **no screenshots**. Copy, information architecture, section order, image
alt text and proof structure are all first-hand; judgements about *visual* craft
(spacing, motion, type) are not, and are marked where they occur.

---

## 1. Where the three of them actually stand

**Payload** — acquired by Figma on 2025-06-17; the site's top strip still leads
with it ("Payload is now part of Figma! Learn More"). Sells hard on named logos:
Microsoft, Mazda, Vodafone, Sonos, ASICS, Blue Origin. Positioning has moved off
"CMS": *"both an app framework and a headless CMS. It's truly the Rails for
TypeScript — and you get an admin panel."* Demo is sales-gated ("Schedule a Demo").
Twenty case studies, almost all narrative, almost none with a number in them.

**Directus** — the closest competitor to Rebase, and the one to watch. Their
hero is *"The backend for your whole team"* over *"Connect any database. Get
instant APIs, a no-code interface, and a native MCP server."* Their use-case copy
is nearly our pitch verbatim: *"Connect a database and Directus generates a
production-ready REST and GraphQL API automatically. Your schema stays exactly as
you built it, with full access and no abstraction layer in the way."* First nav
item is **AI & MCP**. Claims 45M downloads, SOC 2 Type II, G2 4.9. Demo is
sales-gated.

**Strapi** — repositioning out of the CMS box too: *"More than a CMS"*, *"Extend
it like a framework. Run it like a CMS."* Leads on AI in the eyebrow (MCP GA).
72.8k GitHub stars in the nav. The only one of the three with a **public live
demo** rather than a sales call. Cloud is metered per project ($35 / $90 / $450
per month, plus overage per 25k API requests).

**All three have converged on the same three words we use: "the backend".** The
category is no longer contested on whether a headless CMS should be a backend —
it is contested on *whose database it is*, and Directus is arguing our side of
that.

---

## 2. The four heroes, side by side

| | Eyebrow | Headline | Sub | Actions | Product artifact above the fold |
|---|---|---|---|---|---|
| **Payload** | "Payload is now part of Figma!" | The backend to build the modern web. | "the open-source Next.js backend used in production by the most innovative companies on earth" | Get a Demo · `npx create-payload-app` | **Yes** — admin-panel screenshot |
| **Directus** | "AI Assistant: Query Your Data, Update Content + More" | The backend for your whole team. | "Connect any database. Get instant APIs, a no-code interface, and a native MCP server." | Get Started Free · Get a demo · `npx directus-template-cli@latest init` | **Yes** — logo wall + JSON response payload |
| **Strapi** | "Strapi MCP is now Generally Available" | Open-Source Content Framework for AI-Powered Websites | "Shape your content, ship your API, and scale it without limits." | `npx create-strapi-app@latest` · Try Live Demo | **Yes** — feature-icon grid, GitHub count in nav |
| **Rebase** | "Open-source · Self-hosted · Postgres-native" | The Postgres you already have. / The backend you always wanted. | "Point it at the database you already run. Nothing to provision, nothing copied, nothing migrated." | See the live demo · View on GitHub · `pnpm dlx @rebasepro/cli init` | **No** — WebGL gradient only |

Two things fall out of that table.

**Our headline is the best of the four and the most contested.** "The Postgres you
already have" is sharper than anything they run — but Directus's subhead makes the
same promise in plainer words, and their *"Your schema stays exactly as you built
it"* is the sentence we should have written. The moat is not "existing database"
any more. What none of them can say is the rest of our claim stack: policies
compiled into Postgres, a typed SDK, and a panel you can delete without the API
moving.

**We are the only one of the four whose hero contains no product.** `s-hero` is
`NeatBackground` + badge + h1 + subtitle + two buttons + a command box. The first
product artifact on the page is the terminal in beat 01, several screens down.
This is the site breaking its own rule — PRODUCT.md principle 3 is *"Proof over
assertion: a live demo, real terminal output, or a runnable command — never a card
grid standing in for evidence"* — in the one place where the rule matters most.

---

## 3. Nine things they do that we don't

Ranked by value × how cheaply we can do it honestly.

### 3.1 A product artifact in the hero
All three have one. Directus's is the best and the cheapest to steal: a raw JSON
API response, right at the top. It answers "what do I actually get" in two
seconds, needs no screenshot pipeline, and survives dark mode, i18n and headless
rendering. We already have `ApiMiniDemo`. A trimmed version beside the hero
copy — or the response payload alone — costs one component move.

### 3.2 A "what do I build with this" axis
Payload sells four use cases at nav level (Headless CMS, Headless eCommerce,
Enterprise App Builder, DAM). Strapi sells eleven under **Solutions**. Directus
runs five one-liners on the homepage:

> Build websites and apps from your database · Edit content without filing a
> ticket · Govern data access across your team and agents · Connect AI directly
> to your live data · Replace spreadsheets with structured data

Our site has *audience* pages (`/startups`, `/agencies`, `/kit-digital`,
`/europe`) and *capability* pages (`/backend`, `/admin`, `/studio`, `/editing`)
and **zero** "is this for my kind of app" pages. A cold arrival can read the whole
homepage and never learn whether Rebase suits a marketplace, a SaaS with tenants,
or an internal tool. Our three case studies already map onto three answers.

### 3.3 A person doing a task
Directus's strongest block, and the one I would copy nearly wholesale:

> **Operations — Tag 500 images before lunch.** An ops manager connects Claude
> Desktop to Directus and asks it to analyze product images, generate alt text,
> and apply category tags. The metadata is written directly to the asset records.
> Hours of manual work, gone.

Three personas, one concrete scenario each, one number each, one "See it in
action" link each. **Our homepage never once describes a human doing a task.** It
is mechanism end to end — excellent mechanism, but a reader has to do the
translation into their own week. This is compatible with the demo-budget rule:
a scenario plus a demo is not a card grid.

### 3.4 Named testimonials
Directus runs eight (Club Med, Tripadvisor, Weber, Prusa, Copa Airlines,
Ripley's, Rescue.org, The Shift Network) with name, title and company. Strapi
runs three with headshots (Vercel's CEO, Tesco, Airbus). Payload runs five with
logos linked to case studies.

We run **zero**. PRODUCT.md is explicit that we must not invent them — correct,
and it means the fix is not a design task. We have live customers already on the
logo wall: MedicalMotion, SustenTalent, DearDoc, Proton Health, WithU, Social
Income, Bitforge, Somnio, NFQ. **Three two-sentence quotes with a name and a role
is the single highest-value marketing asset we can create, and it costs a week of
emails, not a sprint.** Everything else in this document is worth less.

### 3.5 A stack-compatibility grid
Directus lists fifteen frontends under *"Unopinionated — Fit your stack. Not the
other way around."* Strapi's footer runs "React CMS / Next.js CMS / Astro CMS /
Vue / Nuxt / Flutter / Svelte / React Native" as SEO landing pages.

We say the equivalent exactly once, as a negative, buried in a card:
`modes.baas.desc` — *"No UI, no React anywhere in the dependency tree."* A reader
who skims sees a React admin panel, a React UI library and React demos, and can
easily conclude the backend is React-coupled. A positive grid fixes an anxiety we
are actively creating.

### 3.6 A trust row at the point of decision
Strapi puts three badges directly under the install command in the final CTA:
**Open source (MIT) · SOC 2 certified · GDPR Compliant**. Directus puts SOC 2
Type II / G2 4.9 / GDPR in the footer.

We cannot claim SOC 2 and must not imply it. We *can* claim, truthfully, at the
same moment in the page: **MIT-licensed · Self-hosted — your data never reaches us
· No second processor · EU-based.** That is the honest version of their move and
it is stronger than theirs on the axis we actually win, because "no second
processor" is a thing Strapi's SOC 2 badge concedes.

### 3.7 A signal that the project is alive
Directus closes with three dated resource cards — a release note plus two
articles. Strapi's footer carries Changelog and Roadmap. Payload's top strip
carries company news.

Our top strip carries the manifesto: evergreen, brand-level, and silent about
whether anything shipped this month. For a repo that is four months old with 7
GitHub stars, **aliveness is our single biggest credibility problem**, and this is
the cheapest possible signal. We have a blog at `src/content/blog` that the
homepage never touches, and `RoadmapSection.astro` is used only on `/about`.

### 3.8 The agent claim is buried while Directus leads with it
`SITE-STORY` §2 ranks agent-native as claim 4 and the homepage puts it at beat
**07**, near the bottom. Directus made **AI & MCP the first item in their nav**
and shipped a whole page on it, with framing that is close to ours:

> "AI that acts on your data. Not a copy of it." · "One permissions system.
> Humans and agents both." · "Your data stays in your database. The MCP server
> runs against your existing infrastructure."

Our copy is genuinely better — *"Agents are extremely good at producing plausible
backends, and famously bad at producing secure ones"* is the sharpest sentence on
either site, and their version has no equivalent to "Boilerplate depreciates,
guarantees appreciate." We are simply being out-placed. This does not require
re-ranking the claims; it requires the badge in the header nav and one line in the
hero region.

### 3.9 A feature index
Strapi's `/features` is a flat, categorised index — Collaboration, Content
Management, Create APIs, Customization, Hosting, Security — each entry a card plus
one line. It is an evaluator's checklist and a long-tail SEO surface ("does X have
audit logs"). Our `/product` is a narrative map, which is a different and better
thing, but it does not answer checklist questions and does not rank for them.

---

## 4. Five things we already do better and under-exploit

1. **Our demo is the product; two of theirs are a sales call.** Payload and
   Directus both mean "book a meeting" by "Get a Demo". We mean `demo.rebase.pro`,
   instantly, no signup. The hero says "No signup for the demo" once, in small
   grey text under the buttons. That line deserves to be on the button.

2. **`rls-check` has no equivalent anywhere in the category.** A free tool that
   runs against a database we have never seen and finds real problems, in ten
   seconds, with nothing installed. None of the three has anything like it.
   Keeping it inside the security beat is right (§6 of SITE-STORY); marketing it
   *off* the site — as a standalone tool people share — is untapped.

3. **Live in-page demos.** Directus, Payload and Strapi have, between them, zero
   embedded interactive product on their homepages: screenshots, illustrations and
   icon grids only. We have eight. This is our largest unfair advantage and the
   reason the demo-budget rule should be defended rather than relaxed.

4. **No caps, and theirs are brutal.** Directus Core caps free at **25
   collections, 3 seats and 5 flows**; Team is $499/mo for 50 collections. Strapi
   Cloud meters API requests and bills $1.50 per additional 25k. One true,
   checkable line — *"No per-seat pricing. No collection limits. No API-request
   metering."* — lands against all three at once. `/pricing` implies it; the
   homepage never says it.

5. **The panel is a separate product and the API does not move.** Claim 3 in
   SITE-STORY, and it is correct that nobody else in the category can say it.
   Strapi and Directus both hard-couple the admin; Payload's whole pitch is that
   you get the panel. Beat 04 makes this well.

---

## 5. What not to copy

- **Their numbers.** 45M downloads, 72.8k stars, "3K+ customers", Payload's "700%
  faster GraphQL". We have 7 GitHub stars and a repo four months old. Any scale
  claim invites the comparison we lose. *Note:* npm reports ~21k monthly downloads
  for `@rebasepro/server` and ~18k for `@rebasepro/cli`, which against 7 stars
  almost certainly means our own CI and the published-install e2e. **Do not put
  those on the site without isolating real traffic first.**
- **The sales-gated demo.** It is the thing we beat them on.
- **Strapi's illustration-led feature cards.** Icon-and-illustration triplets
  where we currently run live components would be a straight regression.
- **Strapi's emoji eyebrow** (`✨ … ✨`). SITE-STORY §6 already bans this; it
  reads as cheap next to their own copy.
- **Payload's twenty narrative case studies with no metrics.** Volume without
  numbers. Three case studies with one real number each beats it.

---

## 6. Two defects found while reading our own page

Not competitor findings, but they surfaced during the comparison and both affect
how the landing page reads.

**6.1 The machine-readable homepage is a different, stale homepage.**
`src/utils/markdownGenerator.ts:31-33` builds the `index.md` variant — which feeds
`llms.txt` — from `howitworks.step1..3`. Those keys exist in all four locales and
are rendered **nowhere on the visual page**. So the version of our homepage that
LLMs and agents read opens with:

> **Boilerplate admin UIs**: … Connect your Postgres and get a complete, editable
> admin panel — instantly.

That is panel-first — the exact framing `backend-first-positioning` exists to
prevent — and it never mentions the security claim, the two-products split, or the
agent-era claim. With all three competitors now optimising for agent discovery,
the page our competitors' *users* see and the page an evaluating agent sees should
not disagree.

**6.2 The GitHub repo description contradicts the site.**
`rebasepro/rebase` is described as *"Next-gen Postgres admin panel"*. The site
spent a rework moving to backend-first, and the most-linked external surface still
says panel.

---

## 7. Recommendations, in priority order

| # | Change | Cost | SITE-STORY compatibility | Status |
|---|---|---|---|---|
| 1 | **Get three named customer quotes** (name, role, company) from the existing logo wall | a week of email | Fills the stated absence; no rule change | **open — not an engineering task** |
| 2 | **Put a product artifact in the hero** — merge the beat-01 terminal into `s-hero` | one component move | Enforces principle 3 where it was broken | **done 2026-08-10** |
| 3 | **Fix the `llms.txt` homepage** to render the real beats instead of dead `howitworks.*` copy | small | Bug fix; backend-first | **done 2026-08-10** |
| 4 | **Add a persona-scenario beat** — three roles, one concrete task each, each closing on a different deep page | one section | Compatible: scenario + link, not a card grid | **done 2026-08-10** (beat 06) |
| 5 | **Trust row under the final CTA** — MIT · self-hosted · no second processor · EU | tiny | True and defensible; §5 "sell only what exists" | open |
| 6 | **The no-caps line** on the homepage — no seats, no collection limits, no request metering | one line | Defensible against an expert; verifiable | open |
| 7 | **Move the agent claim up** — an `AI & MCP` badge in the header nav and one hero-region line | small | Claim 4 stays ranked 4; only placement changes | open |
| 8 | **A "what's new" strip** — swap the manifesto banner payload for the latest release, or add three dated cards before the final CTA | medium | Nothing sits above the header; banner stays one line | open |
| 9 | **Stack-compatibility grid** — "works with any frontend", stated positively | small | Removes an anxiety we create | open |
| 10 | **Use-case pages** — SaaS with tenants / internal tool / marketplace back office / mobile backend | large | Needs a SITE-STORY §4 amendment | open — deliberately deferred |
| 11 | **A `/features` index** for checklist evaluation and long-tail search | large | New page; `/product` stays the narrative map | open — deliberately deferred |
| 12 | **"No sales call" on the demo button itself** | tiny | Already true | open |
| 13 | **Fix the GitHub repo description** ("Next-gen Postgres admin panel") | tiny | backend-first | open |

Item 1 is worth more than the rest combined and is not an engineering task.

Items 10 and 11 are deferred on purpose. The page does not have a coverage problem,
it has a proof problem, and eleven Strapi-style solution pages spread thin content
over a site whose credibility gap is that nobody has vouched for it yet.

---

## 8. What shipped on 2026-08-10

Five changes, plus the cleanups they forced.

1. **GitHub is no longer a hero action** (`IndexContent.astro`). A primary button
   sending an evaluator to a 7-star repo spends the highest-intent click on our
   weakest signal. Still in the header and the footer; `hero.cta.github` deleted
   from all four locales.
2. **The hero absorbed beat 01.** The install command used to appear twice — a
   small hero box and, two screens later, the beat-01 terminal — with the logo
   wall between them. Now one terminal, in the hero, above the fold at 1440×900.
   `demo.badge` / `demo.title` deleted from all four locales; the terminal's
   output keys and its three copy-tracking ids are unchanged, so the analytics
   series is continuous.
3. **Security moved from beat 06 to beat 03**, extracted to
   `components/SecuritySection.astro` (same markup, same three rows, `rls-check`
   still inside the beat). Final order: 01 collection → 02 backend → 03 security
   → 04 modes → 05 panel → 06 personas → 07 agents → 08 cases.
4. **The logo wall gained a `product` marker** — and did *not* change on screen.
   Implementing this surfaced the reason the caption has to hedge: the list has no
   record of which company ships on which tool, and only one entry
   (`medicalmotion`) is verifiable from this repo. One logo is not a wall, so the
   field is recorded and documented but not yet wired into the rendering, and the
   "Rebase and FireCMS" qualifier stays exactly as it is. Absence of the field
   means *unknown*, never *firecms* — guessing would put an unverified claim on
   the page, which is the failure the caption exists to prevent. **Someone who
   knows the accounts needs to fill this in; then filter the wall and drop the
   qualifier.**
5. **The persona beat** at 06, and **the `llms.txt` fix**: `markdownGenerator.ts`
   now builds the home page's `.md` variant from the real beats. `howitworks.*` —
   nine keys × four locales, rendered on no page, reachable only through that
   generator — is deleted.

Verified: production build clean (1144 pages), zero console errors on the built
site, beat sequence 01–08 with no gaps, personas correct at 1440px (three columns,
hairline dividers) and at 375px (single column, no dividers, no horizontal
overflow), all four locales carrying the new copy, and no GitHub link inside
`s-hero` in any locale.

**Then items 5 and 6 shipped too.**

6. **Trust row under the closing CTA** — MIT-licensed · Your data never reaches us ·
   No second processor · No account to create. Four claims already asserted in
   prose elsewhere, concentrated where the decision happens. No certification we do
   not hold; the axis chosen is the one Strapi's SOC 2 badge concedes.
7. **The no-caps line** in the open-source block: *"No seat count. No collection
   cap. No request meter. The only ceiling is the machine you run it on."* Scoped
   to self-hosted on purpose — a statement about what ships, not a promise about an
   unlaunched Cloud, and the closing clause is the honest half. `opensource.desc`
   lost its now-redundant "no per-seat pricing".

---

## 9. The gradient sweep

The blue → purple → transparent gradient-border ribbons were off-system and are
gone. Two problems, not one: **purple is not in the palette** (SITE-STORY §6 fixes
the theme at primary `#0070F4` over a neutral surface scale), and a gradient that
fades out at 80% **lit the first card and abandoned the last** — a visual ranking of
options that are meant to read as a choice. The "two ways in" pair had its backend
half lit and its admin half dark, which is the exact opposite of the beat's point.

Replaced everywhere with the idiom the rest of the site already uses: one hairline
border, hairline dividers, and a single primary rule that wipes in from the left on
hover. Instances fixed:

| Where | Was |
|---|---|
| `IndexContent` — "two ways in" (beat 04) | gradient border + two coloured radial washes |
| `IndexContent` — closing three lanes | gradient border + three coloured radial washes |
| `SpotlightCard.astro` | masked gradient border in `rgba(56,189,248)` — sky-400, also not the theme blue |

`RoadmapSection.astro` was checked and left alone: its gradient is neutral
(`surface-900 → surface-950`) with a primary hairline, which is already the
restrained version of this.

---

## 10. Sweep of every page except the landing

**Fixed.**

- **`✓` as a list bullet — 30 instances across `/editing` (17), `/backend` (6),
  `/sdk` (4) and `/studio` (3).** SITE-STORY §6 bans exactly this: *"The same goes
  for `✓` as a list bullet: use the primary-filled check used everywhere else."*
  All replaced with the lucide check. The check marks inside fake terminal output
  (`SecuritySection`, `/sdk`'s `rebase generate-sdk` block) are real CLI text and
  were deliberately left.
- **`/product` and `/studio` shipped English SEO to every locale.** They were the
  only two pages hardcoding `title` and `description` instead of routing through
  `t()`, so `/es/product`, `/de/product`, `/fr/product` and the three `/studio`
  equivalents served English `<title>` and meta description — while the localized
  `product.meta.*` and `studio.meta.*` keys sat unread in all four locale files.
  Both now use `t()`. **The keys had to be refreshed first**: they had drifted to
  "Rebase Product Ecosystem" and "Rebase Studio — Visual Schema Editor", so
  switching to `t()` on its own would have *downgraded* the English — the same
  inversion recorded in `generated-artifact-drift-can-invert`. The old hardcoded
  Studio title also called it "Visual Admin Panel for Postgres", which contradicts
  §4: `/admin` is the panel, `/studio` is the workspace registered inside it.

**Found, not fixed — these want a decision.**

- **43 i18n keys are referenced nowhere.** Most are residue from the two removed
  routes (`features.*`, `features.group.*`, `nav.features`, `nav.whyRebase`,
  `footer.features`, `footer.whyRebase`, `footer.product`, `footer.solutions`,
  `footer.ui`, `footer.studio`, `footer.ai`, `footer.security`) and are safe to
  delete. Three are not residue and look like unfinished work:
  - `agencies.leverage.c4.title` / `.challenge` / `.solution` / `.result` plus
    `agencies.leverage.c3.result` — a fourth card written and never rendered.
  - `agencies.cta.title` / `.primary` / `.secondary` — a CTA block written and
    never rendered on `/agencies`.
  - `ai.badge` / `ai.title` / `ai.subtitle`, `banner.subtitle`, `paths.title` /
    `paths.subtitle` — headings that exist in copy but not on the page.
  I did not delete any of them: deleting copy is not reversible from the page, and
  the `agencies` ones look like something that was meant to ship.
- **`/sdk` and `/cli` carry no live demo**, against the §5 page contract. This is
  structural, not neglect: the demo-budget rule allows a demo on `/` plus one deep
  page, and `SdkMiniDemo` has already spent its deep slot on `/backend`. Fixing it
  means either rebalancing which page owns which demo or amending the budget rule —
  a call for you, not a 1am edit.
- The eight `rebase-vs-*` pages have no demo either, but §5 never assigns them one
  (only the `/compare` hub), so that is by design.

**Checked and clean:** no `font-bold` anywhere (semibold is still the ceiling), no
emoji in page copy, and the numbered-eyebrow idiom appears only on the home page
and in `CaseStudiesCarousel`, which the home page is its only consumer of.
