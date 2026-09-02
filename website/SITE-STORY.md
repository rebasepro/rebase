# rebase.pro — the story the site tells

This is the source of truth for **what each page is for**. If a section can't be
justified from this document, it does not belong on the site.

Written 2026-07-27, during the full marketing-site rework. Revised 2026-09-02
after the brand and storytelling audit (PR #39): §2 naming, §4 IA, §5 contracts
and beat table, §6 additions, and §7, which is new.

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
3. **The panel is a client, not a back door.** It is the same definition
   rendered for people: a React app reading your data through the same public
   API, in the same `rebase_user` role, under the same row-level security.
   Whatever it can see, your policies said so — and you can read them. Add it,
   skip it, or delete it; no API response moves. Nobody else in this category
   can say that.

   > Revised 2026-08-28. This claim used to read "the panel is a separate
   > product", which is true of the architecture and wrong as a claim. It is a
   > PACKAGING fact, and packaging is the least interesting thing about it: it
   > makes the panel sound like a second thing to buy and the backend sound
   > like it ships with an afterthought attached. What competitors actually
   > cannot say is the security fact underneath — their studio is privileged,
   > ours is a client with no more reach than the user holding it. Stated that
   > way the claim leans on claim 1 instead of standing apart from it.
   >
   > "Separate product" survives as internal vocabulary for the architecture.
   > It does not appear in customer-facing copy.
   >
   > **The boundary, so nobody overstates this later.** The claim is about the
   > DATA PLANE, and only that. The panel's reads and writes go through
   > `withAuth` → `rebase_user` → RLS, exactly like any other client, and it
   > has no privileged data path. It is NOT true that the panel can reach
   > nothing a user can: `/api/admin/*` exists — backups, rls-audit, the schema
   > editor, cron, logs — and an admin in the panel reaches those. It is also
   > not true that an admin sees the same ROWS as everyone else; the injected
   > `default_admin_read` policy grants them more. The point is that this is a
   > POLICY the customer can read in their own database, not a service role
   > quietly bypassing it. Claiming more than that would fail the standard
   > claim 1 sets.
4. **Agent-native.** MCP server, scoped API keys, installable agent skills. An
   agent can operate the backend through the same authorization the humans get.
5. **It is yours.** MIT, end to end — the schema editor, the generated APIs, the
   typed SDK, all of it. Self-hosted on your own infrastructure, holding your own
   credentials. *Added 2026-08-29.*

Below the line (true, useful, never the headline): kanban boards, the block
editor, import/export, branding.

### Why claim 5 is fifth, and why that is not a demotion

Claims 1-4 are things the software does. Claim 5 is a fact about the TERMS, and
it is the only one no alternative in this category can answer: Supabase,
Directus, Payload and Strapi are all services you rent or open cores with a paid
centre. It ranks last because it is worth nothing to a reader who has not yet
decided the product is good — and it is worth more than any of the others to one
who has. **It belongs at the close, not the open.** The copy for it already
existed (`opensource.*`, translated in all four locales) and was dropped in the
V2 rework; see §5.

### The three products are the page's spine, not a feature list

Decided 2026-08-27 and applied to the site 2026-09-02: Rebase is three peers
under one umbrella, not a parent with two children.

| Product | What it is | Who it is for |
|---------|------------|---------------|
| **Rebase Backend** | REST, typed SDK, realtime, auth, storage, functions, cron, backups. The panel's packages are never installed. | The developer who owns the database |
| **Rebase CMS** | The above plus a schema-driven panel — spreadsheet, every field type, import/export, custom React views. | The operator team |
| **Rebase Studio** | SQL editor, schema visualizer, RLS editor, logs, API explorer. *Studio is the developer workspace. It registers inside the same panel as CMS.* | The developer, again, day to day |

Told in that order it is ADDITIVE, which carries claim 3 structurally instead of
asserting it: the panel is obviously optional because the reader was shown what
came before it. It also stops the product reading as "a way to generate REST
routes", which is what happens when only the middle product is described.

**The naming sheet.** Three product names, one descriptive phrase, nothing else.

- **Rebase Backend**, **Rebase CMS**, **Rebase Studio** — with the prefix, in
  every heading, nav item and meta title. Never "Studio" alone beside "Rebase
  CMS" in the same menu.
- **the panel** — lowercase, the only phrase for CMS and Studio rendered
  together. The nav column is "The panel".
- Studio's place is one sentence, used verbatim wherever it is described:
  *Studio is the developer workspace. It registers inside the same panel as
  CMS.* Before 2026-09-02 four pages described it four ways — a child of CMS,
  "the database half of the panel", "layer 03", and inside "the admin panel".
- Banned in copy: "Rebase Admin", "Admin UI", "admin console", "admin tool",
  "admin scaffolding", "the Rebase Studio". The one legitimate "admin UI" in
  the tree is `src/data/alternatives.ts` describing PocketBase's and Directus's
  own products; a competitor's product keeps its own name.
- The `admin:` collection key, `roles: ["admin"]` and `/api/admin/*` are code,
  not copy. They are not renamed.

## 3. The three-act shape, reused everywhere

Every major page is a variation on the same three acts:

| Act | Beat | Proof we own |
|-----|------|--------------|
| I | Point it at Postgres → APIs appear | `TerminalInit`, `HeroConnectionWidget`, `ApiMiniDemo` |
| II | One collection is the source of truth | `CollectionPowerSection`, `SdkMiniDemo`, `RLSEditorDemo` |
| III | The panel is optional | `SplitLayerDemo`, `AdoptionStackDemo`, `AdminDemoCarousel` |

## 4. Information architecture

```
/                    Home — the story in nine beats, for someone who arrived cold
/product             The platform map — every product, every subsystem, one screen each
├── /backend         Rebase Backend, in depth. Live proof per API surface.
│   ├── /security    RLS-first security, rls-check, hosting & GDPR
│   └── /ai          Agents: MCP, scoped keys, skills
├── /cms             Rebase CMS — the optional panel; content & fields live here too
└── /studio          Rebase Studio — the developer workspace (SQL, schema, RLS, logs)
/developers          Build with Rebase — SDK, CLI, extending, deploying
├── /sdk             SDK tour
└── /cli             CLI tour
/compare             Comparison hub  (was /why-rebase)
├── /rebase-vs-*     8 head-to-head pages
└── /alternatives/*  7 programmatic pages from src/data/alternatives.ts
/rls-check           The free audit — the proof for claim 1, on its own page
/pricing  /demo  /about  /manifesto  /contact  /pitch
/startups /agencies /kit-digital /europe    campaign pages
```

Plus `/ui` — the `@rebasepro/ui` component gallery. It is not in the nav; it is
reached from `/cms` and `/developers`, and it says what it is for (the library
your custom fields should be built with) instead of "Build Beautifully, Build
Fast".

**The nav teaches the product.** The Product menu is three labelled columns —
*The backend* (Backend & APIs · Security & RLS · AI & agents), *The panel*
(Rebase CMS · Rebase Studio · Component library) and *Explore* (Platform
overview · Compare). The footer mirrors it.

**Removed** (duplicated a page above, 301 redirect in `firebase.json`):

| Gone | → | Why |
|------|---|-----|
| `/features` | `/product` | Was a near-verbatim copy of `/product`: same hero claim, same "Edit like a spreadsheet" section, same import/branding images. |
| `/why-rebase` | `/compare` | Its only distinct content was "how we compare"; the rest restated the home page. |
| `/admin` | `/cms` | Renamed with the product (2026-08-27). |
| `/editing` | `/cms` | Folded into the CMS page: content and fields are what the CMS is, not a sibling of it. |

**Two A/B tests are parked at weight 0** in `src/scripts/ab-testing.ts`
(`navigation-structure` also in `src/layouts/Layout.astro`). `navigation-structure`
was splitting 50/50 between the mega-nav and a flat four-link nav — which meant
half of all visitors never saw the backend/panel split the whole site is
organised around. `manifesto-banner-text` varied a banner that no longer renders
(§6, *Nothing sits above the header*). Flip the weights to run either again.

## 5. Page contracts

Each page must answer its question, carry at least one **live demo** (not a card
grid), and end with the same close: `ClosingCta.astro`, and nothing else. It
renders *Try the demo* → `/demo` (localised and in the IA; the one link to
`demo.rebase.pro` is on `/demo` itself, via `demoHref`), the command
`pnpm dlx @rebasepro/cli init`, and *Read the docs*. Labels are sentence case.
Before 2026-09-02 ten pages stacked a hand-rolled close above the shared one,
every vs page stacked four asks, and the demo button had eight labels and two
destinations. `/kit-digital` is the exception: its ask is a call, so it keeps
its own close and drops `ClosingCta`.

| Page | The one question it answers | Demos it owns |
|------|------------------------------|---------------|
| `/` | What is this and why should I care? | Terminal, CollectionPower, mini-demos, RLSEditor, AdminCarousel, AgentConsole |
| `/product` | What do I actually get, in every product? | AdoptionStack, per-subsystem strip, AdminDemoCarousel |
| `/backend` | Is the backend good enough on its own? | HeroConnection, ApiMini, SdkMini, RealtimeMini, RLSEditor, SplitLayer |
| `/cms` | Will non-developers actually live in this? | AdminDemoCarousel, ScrollSync, the editor, Kanban, Spreadsheet, CustomFields, ReactExt — each mounted once |
| `/studio` | Can I run my database from here? | SQLEditor, SchemaBuilder, RLSEditor, OrdersList, JSEditor |
| `/security` | Can I trust it with production data? | RLSEditor, RbacMini, rls-check |
| `/ai` | Can an agent drive this safely? | McpSession, AgentConsole |
| `/developers` | How do I build with it day to day? | TerminalInit, Architecture, DeveloperPlayground |
| `/sdk` | What does calling it from my code look like? | SdkMini; every snippet is checked against `packages/client` |
| `/cli` | What does each step look like in a terminal? | One real run — init → db push → dev — plus `skills install` and `db backup` |
| `/ui` | What do I build my custom fields with? | UIReferenceView |
| `/rls-check` | Is my database exposed right now? | The tool's real output; the 14 checks from `src/data/rls-checks.ts` |
| `/demo` | Can I see it before I run it? | The hosted panel, in place |
| `/compare` | Why this and not X? | comparison matrix, RLSEditor, "four times you should not pick Rebase" |
| `/rebase-vs-*` | Why this and not X, for someone who uses X today? | The shared FAQ layer, and a visible "When to stay on X" section on every page |
| `/alternatives/*` | Which of these should I actually use? | `src/data/alternatives.ts` — "Stay." rows, the disclosure line, no prices |
| `/pricing` | What is free, what costs money, and who operates what? | — |
| `/about` | Who builds this, and why? | The manifesto's why, the FireCMS heritage paragraph, the roadmap |
| `/manifesto` | What do you believe? | Five beliefs, each one disagreeable |
| `/startups`, `/agencies` | Why this for my kind of team? | The `/europe` spine — backend → the panel as opt-in → ownership. SpreadsheetDemo, BodyPartsDemo |
| `/kit-digital` | Can my Spanish SME get this subsidised? | Sourced amounts; one product under five categories |
| `/europe` | Can I run this myself, in Europe, and what does it cost? | Jurisdiction, DeployTarget, EuHostingCost |

**The home page's beat order, and why it is that order.** Revised 2026-08-10 after
the competitor audit in `COMPETITOR-AUDIT-2026-08-10.md`, and again 2026-09-02
after the brand audit.

| Beat | Section | Carries |
|------|---------|---------|
| — | `s-hero` | Headline, one action, and the install terminal — whose output names the API and realtime before the panel |
| — | `s-social-proof` | Logo wall, captioned "Rebase and FireCMS" |
| 01 | `s-collection-power` | Claim 2 — one definition, every surface; the chips run schema → REST → SDK → forms → views |
| 02 | `s-backend-engine` | What that definition generates |
| 03 | `s-security` | **Claim 1** — security lives in the database; links to `/security`, the page that carries it |
| — | rls-check band | The proof for 03: "Don't take that on faith." Unnumbered on purpose — the numerals are the spine, and a proof point is not a chapter |
| 04 | `s-modes` | Claim 3 — Rebase Backend / Rebase CMS / Rebase Studio; "take only the parts you need" |
| 05 | `s-demo-carousel` | The panel itself; eyebrow "The panel" |
| 06 | `s-personas` | Developer / operator / agent, one scenario each |
| 07 | `s-agent-era` | Claim 4 — agent-native |
| 08 | `s-case-study` | Real products, seven of them |
| 09 | `s-opensource` | Claim 5 — it is yours. Immediately before the ask |
| — | `ground-close` | Three lanes: run it locally, self-host it, Rebase Cloud (private beta, request access) |

**Not on the page, by decision.** The roadmap — moved to `/about` on 2026-09-02:
it is not a beat, and a list of things that do not exist yet sat between the real
customers and the close. The manifesto banner (§6). The FAQ, the "what you will
never build again" list and the feature bento from the pre-V2 page — their keys
were deleted with `IndexContent.astro`, so they cannot come back by accident.

**One beat the page is still missing.** Recorded 2026-08-29 while rebuilding the
intro film against `docs/PRODUCT.md`: **recognition, before the argument
starts.** Every beat above is an assertion — here is what it does, here is what
it generates, here is why that is safe. Nothing asks the reader to recognise a
problem they already have, so "there is no second data model" arrives as a
feature rather than as relief. The film opens its argument by showing the same
table declared five times (a schema, a type, a validator, a route file, a form
field) and collapsing them into one. That beat belongs here too, above 01. (The
other beat recorded missing that day, ownership at the close, is 09 now.)

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
`/backend`, `/cms`, `/ai`. It is three columns of prose divided by hairlines
rather than three cards, because beat 05 above it is a carousel and §6 bans a card
grid straight after another one.

**The `/europe` rule: jurisdiction, not location.** The tempting sovereignty
pitch — "their servers are in Virginia" — is false. Supabase provisions in
`eu-central-1`; Firestore has `eur3`. If the page ever implies otherwise it is
lying and a reader who knows the products will catch it. The argument that is
true is structural, and it has **three** states rather than two: no second party
at all (you run it), a second party seated inside EU jurisdiction (we run it, as
a Spanish company), or a second party a US court can reach whatever the region
says. Location is the row that does not move; the operator's seat is the row that
does — which is why `JurisdictionDemo` carries a three-valued `posture` and not a
`thirdParty` boolean. A boolean there collapses the two answers the page exists
to separate.

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

**`/europe` may sell Rebase Cloud, but only by naming us as the second party.**
This rule used to be its exact opposite — "sells self-hosting and nothing else",
not as a footnote, not as a "coming soon", not as a waitlist — because there was
no managed offering and a waitlist inheriting into the footer contradicted the
page's own argument. Rebase Cloud exists now and the page carries it. What does
not change is that the page cannot win the argument by being vague about our
role: if we operate it we are a processor, the page says that in those words,
and it discloses the sub-processor underneath (today Google Cloud in Belgium)
*including* the part we have not finished. A page arguing about who can be served
with a warrant does not get to round its own answer up.

The counterweight to "you are the only processor" is still *"being the only
processor is also a job"* (backups, keys, uptime). Rebase Cloud is now the named
answer to that job rather than a tier the page pretends not to have.

The footer form is a request-access form now, not a waitlist: it renders
`cloud.status` and its button says *Request access*. If `/europe` ever goes
back to a no-operator argument, the footer suppression in `Footer.astro` has to
come back with it.

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

## 6. Design language

Revised 2026-08-19, during the home-page rework. The previous version of this
section was headed *"do not renegotiate"*; it was renegotiated, deliberately and
with the owner, so what follows describes what the code now does. Anything here
that a page contradicts is a bug in the page, not licence to drift.

**The system lives in one file.** `src/styles/global.css`. (This section used to
name `src/styles/page-system.css`; no such file has ever existed. Corrected
2026-08-24.) Ground, copy colour, heading tracking, shell width, copy measures,
the eyebrow, the product frame, the demo well and the accent link are defined
there once. Do not re-implement any of them inline on a page.

- **Ground is `#08090A`, not pure black.** Pure black kills the shadow system.
- **Copy is `#B4B8BD`.** `surface-400` read washed at page scale.
- **Headings are weight 600 at `-0.025em`, and the tier decides both.** Revised
  2026-08-24 from 500/-0.022em. The ladder is monotonic — 600 for h1-h4, 500 for
  h5/h6, 400 body — and **700 stays banned**; the display end separates itself by
  SIZE, never by weight. Before this it ran 500/500/600/600/500/500, a hump where
  h3 outweighed h1.
  - `global.css` sets `h1..h6` **unlayered**, so it beats every Tailwind utility.
    Override with a real rule, never `tracking-[...]` or `font-[...]` on the
    element. `font-[560]` parses as a font-*family*; the weight syntax is
    `font-[weight:560]`.
  - **Never write weight or tracking on a heading.** 166 headings across 34 files
    each declared their own `font-semibold`/`font-medium` + `tracking-tight`,
    disagreeing with each other at the same rendered size. They are gone; the
    size class is the only thing a page states.
- **Two display tiers, defined in `@rebasepro/ui/theme.css`** so the panel and
  the console inherit them: `text-display-1` (40→76px) for the home hero only,
  `text-display-2` (36→64px) for every deep-page hero and every home section
  head. Both are fluid — German and French run 15-25% longer, and a fixed size
  that fits English does not fit them.
  - **A new display class must be added to the `:is()` tier selector in
    `global.css`,** or it silently renders at `-0.01em`. That is how the old
    home page's `text-[2.6rem]` missed the tier.
  - The hero cap is bounded by the fold, not by taste: past ~84px the CTA row
    drops below the fold on a 1440x900 window.
- **`TypeDevPanel` is not a preview of production.** It injects `!important`
  overrides, and three of its "SHIPPED" defaults were lying — display weight,
  display tracking, and an **unlayered** `p { font-weight: 400 }` that beat every
  layered `.typography-*` class and flattened the whole variant scale on
  localhost while production shipped it correctly. All three are fixed. Before
  trusting a local type judgement, confirm the panel is not the thing you are
  looking at.
- **One shell width (`72rem`) on every section**, so left edges agree across the
  page. Copy blocks are constrained separately: 42rem for section heads, 38rem
  for leads, 34rem for the hero sub.
- **Headlines are one colour.** The white-line/accent-line split is retired; it
  had reached 21 instances across 13 pages and read as a template.
- **Section labels are neutral**, not tinted.
- **One product frame** (`.frame`): 14px radius, a single hairline, a layered
  shadow, no gradient fill and no hover glow. It replaced eight drifted card
  recipes. A demo that draws its own window chrome must not also get a
  `.frame-head`.
- **Every embedded demo gets a reserved, clipped `.well`.** They animate; an
  auto-height container makes the page resize on every frame.
- **Window chrome only on real terminals.** Three survive site-wide
  (`rebase dev`, `after rebase init`, `zsh`). File, browser and panel frames do
  not get traffic lights.
- **Heroes are left-aligned.**
- **Neat is composition, not wallpaper.** Dividers use the masked, bled pattern
  (`height: 600px` with `-my-72`, `z-index: -1`, `.neat-divider`) so the canvas
  passes behind the neighbouring sections and leaves no seam. Every instance
  shares one palette and `textureSeed`; only the camera differs. The hero also
  runs a second pass of the same canvas *above* the type at
  `mix-blend-mode: multiply`, so the shape modulates the letterforms.
- **Four grounds, and the ground says what kind of thing you are reading.** Every
  section sits on one of them; nothing is left to look picked.

  | | | |
  |---|---|---|
  | **BASE** `#08090A` | evidence | the logo wall, the panel, the people, the customers, the roadmap. You are being shown, not argued at. |
  | **RAISED** `#14161B` | mechanism | 01 the collection and what it generates, 02 the running backend, 04 the two halves, 07 what an agent can reach. The lift says *a machine is being opened*. |
  | **LIT** Neat | transition | the hero and the dividers, where the page changes subject. The only register with the full palette. |
  | **CHROMA** flat hue | remember this | twice, and only twice. |

  Which gives the page a shape: `LIT · RAISED RAISED [BLUE] RAISED · LIT · BASE
  BASE RAISED BASE · [CORAL]`.

- **The two chroma sections are the claim and the close, and they are not
  interchangeable.**
  - `ground-claim` — **03, deepened brand blue `#0021C1`.** The argument the
    product rests on: security lives in the database, ranked first in §2 and the
    one claim that survives an expert. It wears the brand colour because this is
    what Rebase *is*.
  - `ground-close` — **the final CTA, coral `#FB5066` with near-black ink.** The
    ask. The reader arrives having seen colour exactly once before, and the blue
    primary button is unmissable on it. Before this the section ran a Neat canvas
    under a gradient ending at `#000`, so the page faded to pure black at the
    moment it asked for the click.
  - **The page opens in art and closes in colour.** Atmosphere while you are
    being persuaded; flat colour when you are being asked. That is why the CTA
    lost its canvas — it is a register change, not a saving.
  - **Do not spend chroma on a mid-page claim again.** It was previously on 03
    and 07 under the rule "claims whose proof is absent". True of both, but it
    could not survive the ranking: 07 is claim *four of four*, so the loudest
    frame on the page sat on the argument this document ranks last, while claims
    2 and 3 got nothing.
  - **Half the chroma palette cannot be a dark ground.** Ultramarine, violet and
    cyan hold chroma at low lightness; coral, yellow and blush only exist as
    colours at high lightness, so darkening them yields blood red or olive. A
    light hue can only ever be a bright ground with dark ink. The raw brand blue
    is likewise unusable as a ground — white body copy on `#0070F4` is 3.74:1.
  - **A raised ground eats the muted tier's headroom.** `--color-surface-500` is
    tuned for `#000`/`#0a0a0a` and falls to 4.16:1 on `#14161B`. The eyebrow
    lifts to `#8a8a8a` there. A muted value is only muted relative to something.
- **A free tool is not a hero.** `rls-check` lives next to the claim it tests.
- **Nothing sits above the header.** The manifesto banner was the violation:
  it sat above the header on the home page, in raw `#0070F4` (white on it is
  3.74:1), and it made a values line the first sentence a cold visitor read.
  Off the home page since 2026-09-02; the manifesto link lives in the footer
  and `manifesto-banner-text` is parked (§4). `showBanner` still exists on
  `Layout.astro`; no page passes it.
- **No emoji, anywhere.**
- **No English sentence in a page component.** Every marketing page goes through
  `t()`; a hardcoded sentence ships English into three locales. The rule, the
  key naming and the deliberate exceptions are in `PRODUCT.md` (Operating
  Context).
- **The social card is generated, not drawn.** `scripts/og/` renders
  `public/img/teaser.png` and `twitter_teaser.png` from `teaser.html`: the hero
  headline, on the ground, weight 600, one colour. When the hero changes, run it
  again. Before 2026-09-02 the card said "Ship Faster with Postgres Superpowers",
  a line the site had never said, in bold with the retired split line.
- **Meta titles are `<Page> — Rebase`**, em dash. `Layout.astro`'s default
  title, description and the Organization JSON-LD read `index.meta.*`; a page
  that sets no meta gets the home page's, never a stale string of its own.
- **Only the GitHub org is a real social handle.** `@rebasepro` on X is an
  unrelated account, `x.com/rebaseco` does not exist, and the LinkedIn page that
  was in `sameAs` is Rebase Australia. Do not add a handle you have not opened.

**Trap, recorded because it cost most of a day:** Astro's dev server serves stale
component style modules after edits. A rule that appears not to apply is usually
cache, not cascade - restart `astro dev` before debugging specificity.

## 7. Facts with one home

Revised 2026-09-02, after the brand audit (PR #39). Each of these had drifted
into two or more versions across the site, because no gate reads prose. Each
now has one home: change it there, then grep.

| Fact | Home | Anything else is drift |
|------|------|------------------------|
| Rebase Cloud's status | `cloud.status` in the four locale files | "not launched", "on its way", "coming", "in progress", "waitlist" |
| The product names | the §2 naming sheet | "admin panel" as a product, "Admin UI", "the Rebase Studio" |
| Where Studio lives | the one sentence in §2 | "half of the panel", "layer 03", a child of CMS |
| Why we build it | `/manifesto`, belief 1; `/about` quotes it | the CRUD-fatigue story, "a global platform", the EU-lock-in origin in the pitch |
| The close | `ClosingCta.astro` | any hand-rolled CTA above it |
| The demo destination | `/demo` | `demo.rebase.pro` anywhere but `/demo` itself |
| The logo wall caption | `social.title` — "Rebase and FireCMS" | "trusted by developers at…" |
| What Rebase runs on | Postgres — the hero badge, the footer tagline, claim 1 | MongoDB on a roadmap, "database-agnostic", "multi-database engine" |
| Proof | real products (`CaseStudiesCarousel`), real terminal output | invented multipliers, anonymous cases, testimonials |
| Competitor facts | the competitor's own docs, verified with a date, below | any adjective |

**Competitor facts as verified 2026-09-02.** Re-verify before a comparison page
changes, and replace the date here.

- Firebase: Firestore is the document store; Data Connect is Cloud SQL for
  PostgreSQL. "Firebase is NoSQL" is wrong as written.
- Retool: exports JSON or a Toolscript archive; never XML.
- Supabase: Apache-2.0. Studio has a policy editor with a generator and
  templates. Self-hosting is a supported path with a published Compose file.
- Directus: `schema snapshot` / `schema apply` are built in; it introspects an
  existing database, so the hub must not file it under "the CMS owns the
  schema". Licence: MIT → BSL (2023) → the Monospace Sustainable Core License
  with v12 (2026-04; GPL-3.0 after four years; free under $5M revenue / 50 staff).
- Strapi: Community Edition is MIT Expat; only `ee/` is separately licensed.
- Hasura: `graphql-engine` is Apache-2.0 (DDN is a different product).
- Payload: MIT; part of Figma since 2025-06-17; Payload Cloud exists and is
  closed to new sign-ups.
- None of the eight keeps a second copy of your data. "Often two databases" was
  false for all of them.

**Still English** — on purpose or not yet; the reasons are in `PRODUCT.md`:
`src/data/rls-checks.ts` (verbatim from the tool), `/pitch` (`lang="en"`),
demos that mock product UI. Not yet: `src/data/alternatives.ts` and the three
`/europe` demos that argue rather than mock.
