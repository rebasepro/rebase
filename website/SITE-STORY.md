# rebase.pro — the story the site tells

This is the source of truth for **what each page is for**. If a section can't be
justified from this document, it does not belong on the site.

Written 2026-07-27, during the full marketing-site rework.

---

## 1. What Rebase is, in one sentence

> Rebase turns a Postgres database into a product backend — REST, a typed SDK,
> realtime, auth, storage, functions and cron — with access control enforced by
> Postgres itself. When a human needs to touch the data, the same definition
> renders a full admin panel.

Two products, one definition. That is the whole story, and every page is a view
onto it.

**Order matters.** The backend leads. The admin panel is the layer you opt into.
See `~/.claude/.../memory/backend-first-positioning.md` — the site used to sell
the panel first, which undersells the product and mispositions it against
Supabase-class competitors.

## 2. The four claims we are allowed to lead with

Ranked. Anything below the line is a feature, not a claim.

1. **Security lives in the database.** Row-level security, fail-closed by
   default, generated from your collection definition — not middleware you can
   forget to call. `npx @rebasepro/rls-check $DATABASE_URL` proves it against a
   database we have never seen, in ten seconds, with nothing installed.
2. **One definition, every surface.** A collection compiles to a Drizzle schema,
   REST routes, an OpenAPI spec, typed SDK accessors, RLS policies — and, if you
   want it, an admin panel. There is no second data model.
3. **The panel is a separate product.** It is a React app that talks to the same
   public API under the same policies. Add it, skip it, or delete it; the API
   response does not move. Nobody else in this category can say that.
4. **Agent-native.** MCP server, scoped API keys, installable agent skills. An
   agent can operate the backend through the same authorization the humans get.

Below the line (true, useful, never the headline): kanban boards, the block
editor, import/export, branding.

## 3. The three-act shape, reused everywhere

Every major page is a variation on the same three acts:

| Act | Beat | Proof we own |
|-----|------|--------------|
| I | Point it at Postgres → APIs appear | `TerminalInit`, `HeroConnectionWidget`, `ApiMiniDemo` |
| II | One collection is the source of truth | `CollectionPowerSection`, `SdkMiniDemo`, `RLSEditorDemo` |
| III | The panel is optional | `SplitLayerDemo`, `AdoptionStackDemo`, `AdminDemoCarousel` |

## 4. Information architecture

```
/                    Home — the story in seven beats, for someone who arrived cold
/product             The platform map — both layers, every subsystem, one screen each
├── /backend         The BaaS, in depth. Live proof per API surface.
│   ├── /security    RLS-first security, rls-check, hosting & GDPR
│   └── /ai          Agents: MCP, scoped keys, skills
└── /admin           The optional panel, in depth
    ├── /studio      Studio — the database workspace (SQL, schema, RLS, branches, cron)
    └── /editing     Editing — content & fields (block editor, kanban, spreadsheet)
/developers          Build with Rebase — SDK, CLI, extending, deploying
├── /sdk             SDK tour
└── /cli             CLI tour
/compare             Comparison hub  (was /why-rebase)
└── /rebase-vs-*     8 head-to-head pages
/pricing  /demo  /about  /manifesto  /contact  /pitch
/startups /agencies /kit-digital /europe    campaign pages
```

Plus `/ui` — the `@rebasepro/ui` component gallery. It is not in the nav; it is
reached from `/admin` and `/developers`, and it now says what it is for (the
library your custom fields should be built with) instead of "Build Beautifully,
Build Fast".

**Removed** (duplicated a page above, 301 redirect in `firebase.json`):

| Gone | → | Why |
|------|---|-----|
| `/features` | `/product` | Was a near-verbatim copy of `/product`: same hero claim, same "Edit like a spreadsheet" section, same import/branding images. |
| `/why-rebase` | `/compare` | Its only distinct content was "how we compare"; the rest restated the home page. |

**The nav A/B test is parked.** `navigation-structure` was splitting 50/50
between the mega-nav and a flat four-link nav — which meant half of all visitors
never saw the backend/admin-panel split the whole site is organised around. The
variant is kept in the code at weight 0 (`src/layouts/Layout.astro`,
`src/scripts/ab-testing.ts`); flip the weights to run it again.

## 5. Page contracts

Each page must answer its question, carry at least one **live demo** (not a card
grid), and end with the same CTA pair: *Try the demo* + `pnpm dlx @rebasepro/cli init`.

| Page | The one question it answers | Demos it owns |
|------|------------------------------|---------------|
| `/` | What is this and why should I care? | Terminal, CollectionPower, mini-demos, SplitLayer, AdminCarousel, AgentConsole, Mosaic |
| `/product` | What do I actually get, in both layers? | AdoptionStack, per-subsystem strip, AdminDemoCarousel |
| `/backend` | Is the backend good enough on its own? | HeroConnection, ApiMini, SdkMini, RealtimeMini, RLSEditor, SplitLayer |
| `/admin` | What does my team get, and what does it cost me? | AdminDemoCarousel, ScrollSync, CustomFields, ReactExt |
| `/studio` | Can I run my database from here? | SQLEditor, SchemaBuilder, RLSEditor, OrdersList, JSEditor |
| `/editing` | Will non-developers actually live in this? | Editor demos, Kanban, Spreadsheet, CustomFields |
| `/security` | Can I trust it with production data? | RLSEditor, RbacMini, rls-check |
| `/ai` | Can an agent drive this safely? | McpSession, AgentConsole |
| `/developers` | How do I build with it day to day? | TerminalInit, SdkMini, Architecture, DeveloperPlayground |
| `/compare` | Why this and not X? | comparison matrix |
| `/europe` | Can I run this myself, in Europe, and what does it cost? | Jurisdiction, DeployTarget, EuHostingCost |

**The home page's beat order, and why it is that order.** Revised 2026-08-10 after
the competitor audit in `COMPETITOR-AUDIT-2026-08-10.md`.

| Beat | Section | Carries |
|------|---------|---------|
| — | `s-hero` | Headline, one action, and the install terminal |
| — | `s-social-proof` | Logo wall |
| 01 | `s-collection-power` | Claim 2 — one definition, every surface |
| 02 | `s-backend-engine` | What that definition generates |
| 03 | `s-security` | **Claim 1** — security lives in the database |
| 04 | `s-modes` | Claim 3 — the panel is a separate product |
| 05 | `s-demo-carousel` | The panel itself |
| 06 | `s-personas` | Developer / support / agent, one scenario each |
| 07 | `s-agent-era` | Claim 4 — agent-native |
| 08 | `s-case-study` | Real products |

Three rules are encoded in that table and should not be quietly undone:

- **Security runs at 03, not 06.** It is the highest-ranked claim and it used to
  sit sixth, behind a screen of admin-panel screenshots — the ordering the
  backend-first rule exists to prevent. It cannot be first, because "RLS written
  in the same file as the collection" needs the collection beat to have run. The
  build is: the definition (01) → what it generates (02) → what enforces it (03).
- **The hero carries a product artifact.** It used to be a WebGL gradient with
  type on it, and the install command appeared twice — once in a small hero box
  and again two screens later as beat 01, with the logo wall between the two
  tellings. Those are now one thing, in the hero. Every competitor hero audited
  carried a product artifact and ours carried decoration, which broke
  proof-over-assertion in the one place it matters most.
- **GitHub is not a hero action.** Payload and Strapi put star counts up front
  because theirs are proof; ours is not one yet, and a primary hero button that
  spends the highest-intent click on our weakest signal is a self-inflicted
  wound. GitHub stays in the header and the footer. Revisit when the number
  argues for us.

**Beat 06 is the only place a person appears.** The page was mechanism from top to
bottom, which left the reader to translate every claim into their own week
unaided. Each column is one concrete scenario closing on a different deep page —
`/backend`, `/admin`, `/ai`. It is three columns of prose divided by hairlines
rather than three cards, because beat 05 above it is a carousel and §6 bans a card
grid straight after another one.

**The `/europe` rule: control, not location.** The tempting sovereignty pitch —
"their servers are in Virginia" — is false. Supabase provisions in
`eu-central-1`; Firestore has `eur3`. If the page ever implies otherwise it is
lying and a reader who knows the products will catch it. The argument that is
true is structural: a managed backend has a *second party* who operates the
service and holds the credentials, and a self-hosted one does not.

**The cost demo must size *both* columns from the workload, with the same rule.**
Sizing only our side was the second version of the same bug as the first: with
files parked on the VPS disk and Supabase left on its included Micro instance,
the managed plan came out cheaper across the most-used part of the sliders. Both
errors were modelling shortcuts that happened to point in opposite directions,
and both were caught by sweeping every slider combination rather than by looking
at the default state. Any future change to the constants must be re-swept: the
test is *zero* combinations where the figure claims hardware that could not hold
the workload, on either side.

**The cost demo must size the box from the workload.** The first version let the
self-hosted column sit at €12 while the sliders described 5M users and 10 TB of
files, and reported "1538× cheaper" — a number that is not merely optimistic but
arithmetically impossible, since 512 GB of database does not fit on a 40 GB
disk. The figure now derives a minimum machine from the sliders, refuses boxes
too small to hold it, stops the sliders where one machine stops being the right
shape, and says **"here the managed bill wins"** when it does. A comparison this
page cannot defend costs more than the comparison is worth.

**`/europe` sells self-hosting and nothing else.** There is no managed Rebase
offering today, so the page must not mention one — not as a footnote, not as a
"coming soon", not as a waitlist. The counterweight to "you are the only
processor" is *"being the only processor is also a job"* (backups, keys,
uptime), not a hosted tier we would rather sell.

**No emoji, anywhere.** `/ai` shipped with a card grid headed 📝 👤 🗄️ 🌿 ⚙️ 🖥️ 📁.
Icons are fine — lucide paths, inherited colour, sized to the text. Emoji render
differently on every platform, cannot be recoloured, and read as a placeholder
for a design decision nobody made. The same goes for `✓` as a list bullet: use
the primary-filled check used everywhere else.

**A figure that shows a mechanism must model it, not mirror it.** The `/ai`
session demo draws two gates — the API key's permission list and Postgres RLS —
and the first draft rendered both from one boolean, so revoking a key permission
lit "RLS ✗" next to a caption saying RLS would have allowed it. They are
independent, and the state worth showing is the one where they disagree: grant
`orders:delete` and the call still deletes nothing, because a key permission is
not a policy.

**Demo budget rule.** A demo appears on the home page *and* at most one deep
page. If a demo is the proof of a claim, it lives on the page that makes the
claim. Previously every good demo was hoarded on `/`, and the secondary pages
were left with card grids — which is what made them feel generic.

## 6. Design language (do not renegotiate)

- Stock `@rebasepro/ui` theme: primary `#0070F4`, neutral surface scale, near-black page.
- **Semibold (600) is the maximum font weight.** No `font-bold` anywhere.
- Never a card grid immediately after another card grid. Alternate: figure →
  prose → figure. If two card sections must be adjacent, one becomes a demo.
- `NeatBackground` is decoration, never a section's only light — it does not
  render in headless screenshots. Pair it with CSS radial gradients.
- **A free tool is not a hero.** `rls-check` lives inside the security beat, next
  to the claim it tests — not near the top of the page, where nobody yet knows
  what the claim is. And it is shown as its actual terminal output
  (`RlsCheckReport.astro`, taken verbatim from `packages/rls-check/src/report.ts`),
  never as a centred card with a command in it.
- **Nothing sits above the header.** The manifesto banner was a 70vh interstitial
  that pushed the product below the fold; it is a one-line dismissible strip now.
- Section headers use the numbered eyebrow idiom (`01 · BADGE`) only on the home
  page; deep pages use a plain uppercase eyebrow.
