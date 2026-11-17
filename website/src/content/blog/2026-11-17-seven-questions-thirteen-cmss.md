---
title: "Seven questions that decide a CMS in 2026, checked across thirteen of them"
description: "We scored Contentful, Sanity, Strapi, WordPress, Drupal and eight more on the seven things that now decide a CMS: who owns the database, where permissions live, whether agents can use it. Every cell has a source."
pubDate: 2026-11-17
authors: francesco
---

In 2022 I wrote a guide to [picking a CMS](https://francescogatti.medium.com/picking-a-cms-in-2023-c76b476d1acb). It sorted the field by the questions people asked back then: web-oriented or general purpose, headless or coupled, REST or GraphQL, which SDK languages. It still gets read, and it has a [feature table](https://gist.github.com/fgatti675/21ee0ebee276fe27eb87529fadf273b7) behind it that compares thirteen products row by row.

Four years on, those questions rarely decide anything. Nearly every CMS has a REST API and a JavaScript SDK now. The arguments we actually hear, from teams picking one and from teams leaving one, are about other things: whose database the content ends up in, what stops a script from reading rows it shouldn't, and whether the AI assistant everyone now works with can operate the thing at all.

So we added seven rows to that table, scored all thirteen products against current vendor docs, and wrote down a source for every cell. This post is those seven questions, why each one matters, and the evidence.

One thing to know before you read the table: we build [Rebase](/cms), and Rebase has ✅ on all seven. That is not a coincidence. These are the questions we designed it around. Read the table as a statement of what we think matters, then decide whether it matters to you. If you care more about GraphQL or a Java SDK, the original table has those rows, and Rebase loses them.

## The table

| | Own SQL database | Schema in code | App-user sign-up | Functions + cron | MCP server | Existing database | DB-enforced permissions |
|---|---|---|---|---|---|---|---|
| **Rebase** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Agility CMS | ❌ | ~ | ❌ | ❌ | ✅ | ❌ | ❌ |
| ButterCMS | ❌ | ❌ | ❌ | ❌ | ~ | ❌ | ❌ |
| Contentful | ❌ | ✅ | ❌ | ~ | ✅ | ❌ | ❌ |
| Drupal | ✅ | ✅ | ✅ | ✅ | ~ | ❌ | ❌ |
| Ghost | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Hygraph | ❌ | ~ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Keystone | ✅ | ✅ | ~ | ~ | ❌ | ❌ | ❌ |
| Prismic | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Sanity | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Storyblok | ❌ | ✅ | ❌ | ~ | ✅ | ❌ | ❌ |
| Strapi | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| WordPress | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |

✅ yes · ~ partly, or through a plugin or community project · ❌ no. Checked in November 2026.

A few things stand out. MCP went from nothing to nearly universal in about two years. The self-hosted open-source projects (Strapi, WordPress, Drupal) do well on the first four columns, because owning the server gives you the database, the code and the cron for free. And two columns are almost empty, which is the part worth explaining.

## 1. Is the content in a SQL database you own?

This is the question that decides the next five years, and it is easy to skip when you are comparing editors. A hosted CMS keeps your content in its own store and lends it back to you through an API. That is a fine arrangement until you want to join content with orders, run a report the API doesn't offer, or leave.

If the content is in Postgres or MySQL on a server you control, all of that is a SQL query. Your BI tool can read it. A migration is a dump. The CMS becomes one client of your data among several, rather than the place your data lives.

Every self-hosted product in the table scores here. None of the hosted ones do, by design: Sanity's Content Lake, Contentful and Storyblok are all API-only stores. That is a trade, not a flaw. You give up the database and get someone else running it.

Rebase runs on your PostgreSQL, whether that is a local database, a managed one from your cloud, or ours.

## 2. Is the schema defined in code?

When the content model lives only in a web UI, changing it is a production event. Someone clicks, and staging and production drift apart until somebody notices. When it lives in files, a new field goes through a pull request, gets reviewed, and ships with the code that reads it.

Most products now support this in some form. Sanity, Keystone and Strapi define the model in files from the start. Contentful, Prismic and Storyblok have CLIs that push a model kept in your repo. Agility and Hygraph get a ~ because their tooling scripts changes against an API, or exports snapshots, rather than reading the model from your files.

In Rebase a table is a TypeScript file, and the migration is generated from it:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        status:   col.enum(["draft", "published"]).notNull().default("draft"),
        authorId: col.uuid().notNull().onCreateUser(),
    },
    rls: [
        { operation: "select", access: "public", condition: { status: "published" } },
        { operations: ["select", "insert", "update"], ownerField: "authorId" },
        { operation: "delete", roles: ["editor"] },
    ],
});
```

The admin panel, the REST API and the typed SDK are all generated from that file. Keep the `rls` block in mind for question 7.

## 3. Can the users of your app sign up?

Not the editors: the people using the app the content is for. A recipe app needs accounts to save favourites, and a course site needs members. If the CMS can't hold those users, you add an auth provider, and now your content permissions and your user accounts live in two systems that have to agree.

WordPress, Drupal, Ghost (through Members) and Strapi (through its built-in Users & Permissions plugin) all handle sign-up for site users. Keystone gives you password sign-in for any list but leaves the sign-up flow to you. The hosted headless products don't do this at all. They expect you to bring your own.

Rebase ships the auth: email and password, magic links, OAuth providers, MFA and anonymous sessions, all stored in a users table in your own database.

## 4. Can it run your code, on a schedule?

Sooner or later something has to happen when content changes, or every night at three. Webhooks get you halfway, but they need a server on your side to receive them. A webhook-only CMS has quietly made you run a backend anyway.

We scored this strictly. Webhooks alone are ❌, because the original table already has a row for them. Server-side functions without a scheduler are ~. Only both together score ✅. Strapi, WordPress and Drupal have both because you run the server. Sanity is the one hosted product with both, since it added scheduled Functions this year.

In Rebase, a function is a file of Hono routes and a cron job is a file with a schedule and a handler. Both are picked up from folders in your backend, and Studio shows each job's runs and logs.

## 5. Can an AI agent work with it?

This column didn't exist a year ago. MCP (the Model Context Protocol) is how Claude, Cursor and similar tools reach outside the chat. A CMS with an MCP server lets someone say "add a summary field to articles and fill it for the last fifty posts" and have it happen, under that person's permissions.

Most vendors now ship one, some still in beta. We counted any server the vendor itself publishes as ✅, beta included. Drupal and ButterCMS get ~ because the only servers we found are contrib or community projects. Keystone has none we could find.

The thing to check is not whether a server exists but what it is allowed to do. Ask which credential it runs with, and what stands between an agent and production. Rebase's local [MCP server](/docs/ai/mcp/) refuses every tool that changes data unless the target is on your own machine, and the [hosted connector](/docs/ai/rebase-connector/) asks you to confirm each change before it runs.

## 6. Can it take over a database you already have?

This is the first of the two near-empty columns. Every other product creates its own tables and expects your data to move in. That is reasonable for new content, and a non-starter when the "content" is an existing product database: the orders table, the customers table, ten years of rows another app writes to every second.

Hygraph comes closest, with content federation that pulls in external APIs. But that federates API responses. It doesn't manage the tables in place.

Rebase can start from your database instead of from scratch:

```bash
rebase schema introspect
```

That reads every table, column, foreign key and policy, and writes one `defineTable` file per table. From there you have an admin panel and an API over the database you already run.

## 7. Are permissions enforced by the database?

The other empty column, and the one we care about most. Every CMS has roles. The question is where they are checked. In all twelve others, it is the application. The rules hold only while the application is the sole way in. The day someone connects a reporting tool, writes a script, or points a second service at the same tables, those requests skip the roles entirely.

Postgres has row-level security for exactly this. The rules are attached to the table, and the database applies them to every query from every client. The `rls` block in the snippet under question 2 compiles to real Postgres policies. Anyone can read published posts, authors can see and edit their own drafts, and editors can delete. That holds whether the request comes from the admin panel, the API or a script connecting to the database with an ordinary role. Every table has to declare its rules, and by default Rebase refuses to serve one the database isn't protecting.

This is also why the column is empty elsewhere. You can only enforce permissions in a database you own (question 1), and every self-hosted product in the table supports MySQL, which has no row-level security, so none of them builds on it.

## How we scored

- Every cell was checked against the vendor's own documentation, changelog or repository in November 2026. Where a vendor's docs and a third-party article disagreed, the docs won.
- ~ means partly: one of two required things, a plugin or contrib module, or a tool that scripts changes rather than reading files.
- A few ❌ cells rest on the feature not being in the docs, rather than on a page saying it doesn't exist. Those are the app-user and functions columns for the hosted products, and functions for Ghost. If one of those is wrong, we want to know.
- Products change faster than posts. If a cell is out of date, [tell us](/contact) and we'll fix it, with the date.

## Where Rebase doesn't score

On the original table's rows, Rebase has no GraphQL API, no Java, C# or PHP SDK, and no visual page builder. If you are building a marketing site and want editors to drag sections around a page, a web-oriented CMS is built for exactly that. What Rebase is built for is the content that is really your app's data: products, exercises, listings, orders, with an admin panel your team uses to run it.

If that sounds like your project, `pnpm dlx @rebasepro/cli init my-app` gets you a running admin panel and API in a couple of minutes. Or point `rebase schema introspect` at the database you already have.

## Sources

- **Rebase:** [self-hosting](/docs/deployment/self-hosting/), [schema](/docs/schema/), [authentication](/docs/backend/authentication/), [functions](/docs/backend/custom-functions/) and [cron jobs](/docs/backend/cron-jobs/), [MCP](/docs/ai/mcp/), [existing databases](/docs/deployment/existing-database/), [security rules](/docs/collections/security-rules/)
- **Agility CMS:** [CLI](https://agilitycms.com/docs/developers/cli), [MCP server](https://agilitycms.com/blog/agility-cms-launches-mcp-server-enables-customers-to-enhance-content-operations-with-leading-ai-tools)
- **ButterCMS:** [building your own MCP server](https://buttercms.com/blog/what-is-an-mcp-server-and-how-to-connect-one-to-buttercms-apis/) (Butter's own guide; we found no official server)
- **Contentful:** [CMS as code](https://www.contentful.com/developers/docs/help/cms-as-code), [App Framework functions](https://contentful.com/developers/docs/extensibility/app-framework/functions.md), [MCP server](https://contentful.com/developers/docs/tools/mcp-server.md)
- **Drupal:** [configuration management](https://www.drupal.org/docs/administering-a-drupal-site/configuration-management), [cron](https://www.drupal.org/docs/administering-a-drupal-site/cron-automated-tasks/cron-automated-tasks-overview), [MCP Server module](https://www.drupal.org/project/mcp_server)
- **Ghost:** [install](https://ghost.org/docs/install/), [Members](https://docs.ghost.org/members), [webhooks](https://docs.ghost.org/webhooks), [ghst CLI and MCP](https://github.com/TryGhost/ghst)
- **Hygraph:** [schema as code](https://hygraph.com/docs/api-reference/schema/schema-as-code), [authorization](https://hygraph.com/docs/authorization), [webhooks](https://hygraph.com/docs/guides/webhooks/webhooks-overview), [MCP server](https://hygraph.com/docs/hygraph-ai/mcp-server), [content federation](https://hygraph.com/docs/getting-started/fundamentals/content-federation)
- **Keystone:** [config](https://keystonejs.com/docs/config/config), [auth](https://keystonejs.com/docs/config/auth)
- **Prismic:** [CLI](https://prismic.io/docs/cli), [MCP server](https://prismic.io/docs/mcp)
- **Sanity:** [scheduled functions](https://www.sanity.io/docs/functions/scheduled-function-quickstart), [MCP server](https://www.sanity.io/docs/ai/mcp-server)
- **Storyblok:** [CLI](https://www.storyblok.com/docs/packages/storyblok-cli), [MCP server](https://www.storyblok.com/docs/libraries/mcp-server)
- **Strapi:** [database](https://docs.strapi.io/cms/configurations/database), [Users & Permissions](https://docs.strapi.io/cms/features/users-permissions), [cron](https://docs.strapi.io/cms/configurations/cron), [MCP server](https://docs.strapi.io/cms/features/strapi-mcp-server)
- **WordPress:** [register_post_type](https://developer.wordpress.org/reference/functions/register_post_type/), [WP-Cron](https://developer.wordpress.org/plugins/cron/), [MCP adapter](https://github.com/WordPress/mcp-adapter)
