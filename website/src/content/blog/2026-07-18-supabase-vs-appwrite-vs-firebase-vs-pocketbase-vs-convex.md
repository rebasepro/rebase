---
title: "Supabase vs Appwrite vs Firebase vs PocketBase vs Convex: choosing a backend in 2026"
description: "A deep, honest comparison of the major backend-as-a-service platforms — databases, authorization models, realtime, self-hosting, pricing — and where Rebase fits in."
pubDate: 2026-07-18
authors: francesco
---

Picking a backend platform in 2026 is harder than it looks. Every option promises auth, a database, storage, realtime and functions — but they differ radically in the things that actually bite you two years in: **who owns the database, how authorization is enforced, what self-hosting really gets you, and how costs scale**.

We build [Rebase](https://rebase.pro), so we obviously have a horse in this race. But we use these tools, we migrated from some of them, and we'd rather publish a comparison that's actually useful than a scorecard where we win every row. Where a competitor is better, we say so. If you spot something outdated or unfair, [tell us](/contact).

Here's the field: **Supabase**, **Appwrite**, **Firebase**, **PocketBase**, **Convex**, and **Payload CMS** — plus honorable mentions for Nhost, Directus and AWS Amplify at the end.

## The one-table view

| | **Rebase** | **Supabase** | **Appwrite** | **Firebase** | **PocketBase** | **Convex** | **Payload** |
|---|---|---|---|---|---|---|---|
| Database | Postgres (yours) | Postgres (theirs or self-hosted) | MariaDB internally ("TablesDB" API) | Firestore (NoSQL, proprietary) | SQLite | Proprietary reactive DB | Postgres or MongoDB (yours) |
| License | MIT | Apache 2.0 (core) | BSD-3 | Proprietary | MIT | FSL (source-available) | MIT |
| Runs as | npm packages in *your* Node app | ~6-container Docker stack | Docker Compose stack | Google Cloud only | Single Go binary | Rust binary + dashboard | Next.js app |
| Authorization | **Postgres RLS, enforced** — tables without RLS aren't served | Postgres RLS (opt-in) | Role/permission rules | Security rules DSL | JS-like filter rules | TypeScript functions | TS access-control functions |
| Schema source of truth | TypeScript collections → migrations, or inferred from an existing DB | The database itself (SQL) | Console/API-defined | Schemaless | Admin UI / JS migrations | TS schema | TS config |
| Realtime | Live queries, broadcast, presence + **DB-level CDC** | Postgres WAL-based | WebSocket events | Native listeners | SSE subscriptions | **Best-in-class** reactive queries | None built in |
| Admin panel | **Opt-in**: spreadsheet CMS + Studio (SQL, RLS editor, ER diagram) | Studio (DB-centric) | Console | Firebase console | Minimal | Dashboard | **Excellent**, content-centric |
| Typed client | Generated TS SDK from collections | Generated types from DB | SDKs (many languages) | SDKs | SDKs | **End-to-end types** | Generated types |
| Managed cloud | Early | Mature ($25 Pro / $599 Team) | $15/member Pro | Pay-per-operation | **None** | $25/dev + usage | Payload Cloud |

Now the detail — because the table hides everything that matters.

## Supabase: the benchmark, with a self-hosting asterisk

Supabase is the platform everyone measures against, and deservedly so: real Postgres, a mature managed cloud (branching, point-in-time recovery, vector buckets, read replicas), a huge ecosystem, and serious momentum — it [raised $500M in June 2026](https://designrevision.com/blog/supabase-pricing) largely on the back of AI coding tools defaulting to it.

Two things deserve scrutiny.

**Self-hosting is a different product.** The Docker Compose stack runs ~6 services (Kong, GoTrue, PostgREST, Realtime, Storage, Meta), and [what you get is honestly documented but easy to miss](https://queryglow.com/blog/supabase-self-hosted): no branching, no managed backups or PITR, no multi-project Studio, no platform API. A self-hosted instance behaves as *one project*; staging and production means two full stacks, and every upgrade is yours. The open-source core is real, but the product most people know is the cloud.

**RLS is opt-in.** Supabase's authorization model — Postgres Row-Level Security — is the right one. But it's your job to remember to enable it, and "anon key + table without RLS" data leaks are practically a genre of postmortem by now.

This is the comparison where Rebase is most direct: Rebase is npm packages inside your own Node app (one process plus your database), backups are first-class *locally* (`rebase db backup`, scheduled uploads, retention pruning), Studio ships fully in self-host — and **tables without RLS aren't served, period**. Policies for the common cases (ownership, junction tables, auth collections) are derived for you. What Supabase clearly wins today: managed-cloud maturity, enterprise auth (MFA, SAML), vector/AI storage, and ecosystem size. Full breakdown: [Rebase vs Supabase](/rebase-vs-supabase).

## Appwrite: broad, polished, but the database is abstracted

Appwrite's pitch is breadth: auth, databases, storage, functions, messaging (push/SMS/email), realtime, and even static hosting via Sites — all in [one Docker Compose stack](https://github.com/appwrite/appwrite) or a cloud with a generous free tier (75K MAU) and a [$15/member Pro plan](https://appwrite.io/pricing). The 2025–2026 releases added a redesigned TablesDB API and console-level AI suggestions.

The structural difference: **Appwrite's database is an abstraction, not your database**. Under the hood it runs MariaDB, but you don't get SQL, you can't point it at an existing Postgres, and permissions live in Appwrite's own rule system rather than in the database. If your app outgrows the abstraction — reporting queries, migrations, another service reading the same data — you're working around the platform instead of with it.

Where Appwrite genuinely leads: multi-platform SDKs (Flutter, Swift, Kotlin, and more), built-in messaging campaigns, and a very polished console. Rebase is TypeScript-first on the client; if you're building Flutter apps, Appwrite is the stronger fit today. If your data model is relational and you want to own it in SQL, that's Rebase's home turf — including [pointing Rebase at an existing database](/docs) and inferring collections from it.

## Firebase: still the mobile king, still a one-way door

Firebase remains excellent at what made it famous: mobile SDKs, offline sync, push notifications, and the surrounding Google suite. But the two structural criticisms have only compounded:

- **Pricing is inseparable from architecture.** The Blaze plan [bills per operation](https://www.sashido.io/en/blog/firebase-guide-and-pricing-traps-2026) — reads, writes, deletes — so a data-modeling decision is a billing decision, and traffic spikes translate directly into invoice spikes.
- **The lock-in is real.** Firestore is proprietary NoSQL, locked to Google Cloud, and [exports in a custom format](https://encore.dev/articles/firebase-alternatives) that doesn't map cleanly onto anything else. The deeper you embed Firestore semantics, the more expensive leaving becomes.

The migration path away from Firebase usually leads to SQL and flat, predictable costs — which is exactly the profile of Supabase, Appwrite self-hosted, or Rebase. One thing specific to us: Rebase ships a Firestore adapter, so you can put the Rebase panel on your existing Firebase project *first* and migrate the data to Postgres on your own schedule. More: [Rebase vs Firebase](/rebase-vs-firebase).

## PocketBase: the minimalist ceiling

PocketBase deserves its cult following: a **single Go binary** with auth, an SQLite database, file storage, SSE realtime and a small admin UI, comfortably serving real apps [from a $4 VPS](https://dev.to/tumf/if-youre-concerned-about-supabase-costs-consider-pocketbase-criteria-for-choosing-a-baas-running-4me7). For prototypes, internal tools and side projects it's arguably the best deal in software.

The ceiling is structural, not a bug: [SQLite's single-writer model](https://leanware.co/insights/supabase-vs-pocketbase), one server, no horizontal scaling, no Postgres option, no managed cloud, and extensibility limited to Go/JS hooks. PocketBase's author is admirably clear that this is by design.

Rebase aims at the same feeling — one process, your data, no ceremony — but on real Postgres, with RLS, migrations, React extensibility and a growth path. If you know the project will stay small, PocketBase is fantastic. If there's any chance it won't, starting on Postgres saves you the rewrite.

## Convex: the best realtime DX, on someone else's database

Convex is the strongest *new-school* competitor for TypeScript teams. Queries and mutations are pure TypeScript functions, types flow end-to-end, and reactive queries invalidate and re-run automatically — the realtime developer experience is, frankly, the best in the industry. It's also [self-hostable](https://docs.convex.dev/self-hosting), with the same code the cloud runs.

The trade-offs are just as clear:

- **Your data lives in Convex's engine**, not in standard Postgres. There's no SQL surface; every other tool in your data stack has to go through Convex.
- **The license is FSL** — [source-available with a non-compete](https://www.convex.dev/open-source), not OSI open source. Fine for most users, worth knowing for some.
- **Authorization is imperative** — access rules are code you write in each function, not policies the database enforces regardless of the caller.
- There's no admin panel a non-developer could use.

Rebase's counter-position is almost a mirror image: standard Postgres you own, SQL when you want it, authorization enforced *by the database* (so it also binds cron jobs, scripts, and anything else that touches the data), and a spreadsheet-grade panel for your team. Convex's realtime ergonomics are the bar we measure our live queries against.

## Payload: the philosophical twin, post-acquisition

Payload is the closest project to Rebase in spirit: TypeScript collection configs, code-owned access control, a React-extensible admin panel, MIT license, your own Postgres or MongoDB. If you're evaluating Rebase, you should evaluate Payload too.

Two real differences:

1. **Where authorization runs.** Payload's [access control](https://payloadcms.com/docs/access-control/overview) is JavaScript executed in your Node app. Rebase compiles rules to **Postgres RLS**, so the same policy binds the REST API, the admin panel, a psql session and a cron job. App-level rules can't make that guarantee.
2. **Framework coupling and ownership.** Payload v3 runs inside Next.js — elegant if you're all-in on Next, constraining if you're not. And since [Figma acquired Payload](https://techsy.io/en/blog/payload-cms-guide), its roadmap serves a design platform first; how much energy the standalone CMS keeps getting is an open question.

Payload clearly wins today on deep editorial features: blocks, drafts and versions, localization workflows. If you're building a content-heavy marketing site, it's excellent. If the product is an application backend with an admin layer on top, that's the case Rebase was built for. More: [Rebase vs Payload](/rebase-vs-payload).

## Honorable mentions

- **Nhost** — Postgres + Hasura GraphQL, right instincts, but GraphQL-first has lost momentum and the project is quieter than it was.
- **Directus** — a genuinely good data-first admin over any SQL database, but the BSL license change and per-user cloud pricing pushed much of its community elsewhere, and it's weaker as an API backend. See [Rebase vs Directus](/rebase-vs-directus).
- **AWS Amplify** — less a product than a wiring layer over Cognito, DynamoDB/Aurora, S3 and Lambda. Enormous power, very little coherence.

## So which one?

- **You want a managed platform with every enterprise box ticked** → Supabase Cloud.
- **You're building mobile-first in Flutter/Swift/Kotlin** → Appwrite (or Firebase if you're staying in Google's ecosystem and accept the lock-in).
- **It's a prototype or small internal tool, forever** → PocketBase.
- **You're a TypeScript team whose product is realtime collaboration, and you're fine with a proprietary data engine** → Convex.
- **You're building a content-heavy site on Next.js** → Payload.
- **You want real Postgres you own, authorization enforced by the database instead of by discipline, realtime that catches every write path, and an admin panel your team can actually use — in one Node process, MIT-licensed** → that's [Rebase](/product). Point it at a database and see: `pnpm dlx @rebasepro/cli init`.

And to be honest about our own gaps as of July 2026: Rebase's managed cloud is young, our auth doesn't yet cover MFA/SAML, our client SDK is TypeScript-only, and our community is a fraction of Supabase's. If those are your blockers today, we'd rather you pick the right tool — and check back, because every one of them is on the roadmap.
