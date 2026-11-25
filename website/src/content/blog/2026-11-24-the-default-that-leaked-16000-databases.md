---
title: "The default that leaked 16,000 databases"
description: "UpGuard found 16,326 Supabase projects serving tables anyone could read. The cause wasn't a hack — it was a fail-open default, and the fix doesn't close the ones already open."
pubDate: 2026-11-24
authors: francesco
---

In September 2026 the security firm [UpGuard](https://www.upguard.com/blog/everything-everywhere-systemic-data-exposure-in-supabase-apps) scanned the public internet and found **16,326 Supabase projects serving tables that anyone could read without logging in.** More than half showed signs of personal data — names, emails, and in some cases plaintext passwords and auth tokens.

I don't write this to dunk on Supabase. They're a good product, the number is a symptom of something more general, and they've since moved to close the default that caused it — though, as we'll see, the fix has a catch that leaves those 16,326 right where they are. I write it because the root cause is a design decision every backend-as-a-service makes, usually silently, and almost always in the wrong direction: **what happens to a table when you forget to protect it?**

There are only two answers. The table is readable until you lock it (fail-open), or the table is unreadable until you open it (fail-closed). That single choice is the difference between 16,000 leaks and zero.

## How a table ends up public without anyone deciding it should

The mechanism is boring, which is exactly why it bites so many people.

A typical Postgres BaaS exposes your `public` schema through an auto-generated REST API. A built-in anonymous role is granted access to that schema. Row-level security (RLS) is the thing that would restrict what that anonymous role can see — but on a plain `CREATE TABLE`, RLS is off.

So the sequence that leaks data is not an attack. It's a Tuesday:

1. You create a table to ship a feature.
2. You don't enable RLS, because nothing forces you to and the app works fine without it.
3. The anonymous role already has access to the schema.
4. Your table is now world-readable over HTTPS, and nothing in your app behaves any differently.

No error. No warning in the request path. The app you're testing works perfectly, because *you* are authenticated. The hole is only visible to someone who isn't — which is to say, to everyone except you.

This is fail-open. The absence of a decision resolves to "exposed." Multiply one forgetful Tuesday by every developer shipping fast, and you get five figures of leaking databases.

## Supabase is closing the default — with a catch

To their credit, Supabase saw this coming and changed it. New projects created after May 30, 2026 no longer auto-expose public-schema tables to the Data API; a table needs an explicit grant before the API will serve it, and without one the API returns a clean `42501 permission denied` instead of your rows. On October 30, 2026 the same enforcement reached existing projects. ([Changelog](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).)

Here's the catch, and it's the whole reason the 16,326 number won't just evaporate: **tables that already exist keep their grants.** Supabase's own changelog says it plainly — existing tables "keep their current grants and stay reachable." The safer default protects the *next* table you create. It does not retroactively close the one that's been public since last spring. Every one of those exposed databases stays exposed until a human goes and revokes the grant by hand.

Which is the fail-open tax in miniature: even the fix is opt-in for the data that's already leaking.

## The fix isn't "try harder"

The usual response to this class of bug is education: dashboards that nag you, docs that remind you to enable RLS, linters that flag tables without policies. Supabase shipped all of these. People still leaked data, because warnings compete with shipping and shipping wins.

Warnings are fail-open with a conscience. The data is still served; you're just told you probably shouldn't be serving it. The request still returns 200.

The only thing that reliably closes this hole is making the unsafe state *impossible to reach*, not merely discouraged. If a table with no access rules cannot be served at all, forgetting to write the rules costs you a failed request in development — which you fix in thirty seconds — instead of a breach in production that you find out about from a security researcher.

## What fail-closed actually looks like

I work on [Rebase](https://rebase.pro), a Postgres backend, so treat the rest of this as a worked example of the principle rather than a neutral survey. The principle is the point; we're just one implementation of it. (We argued the deeper case — that authorization belongs *in the database*, not in code you might forget to call — in [an earlier post](/blog/2026-08-23-security-that-does-not-depend-on-remembering/).)

Three rules, and they're the whole idea:

**A table must declare how it's accessed, or it isn't served.** You can't define a table without an `rls` field. There's no "I'll add policies later" state that happens to be readable in the meantime, because the meantime doesn't exist.

**A table the database isn't protecting is withheld, not exposed.** If something is reachable but has no row-level protection behind it, the API refuses it outright — the client gets a `503 TABLE_WITHHELD`, not a page of rows. The failure is loud, it happens in development, and it points at the exact missing piece.

**"Public" is a sentence you have to write.** Some tables *should* be world-readable — a list of blog posts, a product catalog. That's fine. But it's `access: "public"`, typed on purpose, reviewable in a diff, greppable across your codebase. Nobody ever has to ask "wait, which of our tables are public?" because the answer is a search result, not an audit.

The test for whether a system is fail-closed is simple: **what does the laziest possible mistake produce?** On a fail-open system, it produces a silent public table. Here, it produces a 503 in your terminal before you've even deployed.

## "But my prototype is already on the fail-open thing"

Most of those 16,000 projects weren't built by careless people. They were prototypes that worked, got users, and quietly became production without ever getting the security pass that "real" software gets. The backend that was perfect for proving an idea is now holding real people's data under the same defaults it had on day one.

If that's you, the move is **not** to go scanning the internet for exposed projects — not even your own hunch about which ones. Reading data to confirm it's exposed is still reading data. The move is to check your own house, against a database you own, with a tool that only reads the catalog:

- Point [`rls-check`](/docs/rls-check/) at your database. It reads the Postgres catalog and reports exactly what's actually exposed: tables served with RLS switched off, policies that are decorative because RLS was never enabled, and what the anonymous role can reach. It's read-only, needs no signup, and works on Supabase, Neon, RDS or your own server — you don't need Rebase to run it.
- For every table it flags, make the call: is this genuinely public, or did it default into public? Then write that decision down as code.
- Treat anything that's been fail-open in production as already seen, and rotate credentials and tokens accordingly.

The tool matters less than the mental shift: **stop asking "did I remember to lock this?" and start using a system where the lock is the only way the door opens.**

## The uncomfortable part

Fail-closed is less convenient. The first time a BaaS refuses to serve your table until you've said how it's accessed, it feels like the tool is in your way. That friction is the entire value. It's the system spending your attention at the one moment it's cheap — while you're writing the table — instead of at the one moment it's catastrophic, which is after a stranger has your users' data.

Sixteen thousand databases is what the convenient default costs at scale. The number isn't a Supabase problem. It's a fail-open problem, and it'll show up again under a different logo until the industry agrees that a table nobody has protected is a table nobody gets to read.

---

If you're graduating a prototype off a fail-open backend, the [migration guide](/docs/recipes/migrate-from-supabase/) walks the whole path — schema, RLS, data (keeping your user ids), functions and deploy — and [`rls-check`](/docs/rls-check/) will tell you where you stand before you start.

**Sources:** UpGuard, [*Everything Everywhere: Systemic Data Exposure in Supabase Apps*](https://www.upguard.com/blog/everything-everywhere-systemic-data-exposure-in-supabase-apps) (September 2026). Supabase, [*Breaking Change: Tables not exposed to Data and GraphQL API automatically*](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).
