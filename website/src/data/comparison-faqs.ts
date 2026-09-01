/**
 * The six questions a buyer actually asks on each comparison page.
 *
 * ── Why this is data and not markup ──────────────────────────────────────────
 * Each comparison page is several hundred lines of hand-built layout, and that
 * is why there are eight of them rather than eighty: adding one is a design
 * job. The questions are not. Keeping them here means a new competitor page
 * needs one array and one component, and it means all eight blocks stay in the
 * same voice instead of drifting apart one edit at a time.
 *
 * ── The rules these answers follow ───────────────────────────────────────────
 *  1. **Every set concedes something.** There is a "when is X the better
 *     choice?" question on every page, and its answer is real. A comparison
 *     that never gives ground reads as a brochure, and a brochure is not
 *     quoted by anyone — not by a reader deciding, and not by a model
 *     assembling an answer from the pages it trusts.
 *  2. **No numbers we cannot stand behind.** No benchmarks, no competitor
 *     prices (they change, and a stale price is a lie with a date on it), no
 *     "10x faster". Every claim here is about architecture, which is checkable.
 *  3. **Answer the question asked.** The first sentence answers it; the rest
 *     explains. An answer that opens with three sentences of positioning is an
 *     answer a reader skips and a model truncates.
 *  4. **The migration question comes first**, because it is the one that
 *     actually blocks a decision.
 */

export interface Faq {
    q: string;
    a: string;
}

/** Repeated verbatim wherever hosting comes up, so the story cannot drift. */
const HOSTING: Faq = {
    q: "Do I have to self-host Rebase?",
    a: "No. Self-host it and you own the data, the code and the machine it runs on — that is the default and it is fully supported. Or deploy the same project to Rebase Cloud, which is live with real tenants today and opening in batches while it is in private beta, priced per resource rather than per seat. Your code is identical either way; hosting is a deployment target, not a fork."
};

export const COMPARISON_FAQS: Record<string, Faq[]> = {
    supabase: [
        {
            q: "Can I use Rebase with my existing Supabase database?",
            a: "Yes. Rebase connects to any PostgreSQL database, including the one behind a Supabase project, and it reads the tables that are already there rather than insisting on its own shape. What does not travel is the part of Supabase that is not Postgres: their auth schema, edge functions and storage buckets are their implementations, so those you would be replacing rather than importing."
        },
        {
            q: "If both are Postgres with row-level security, what is actually different?",
            a: "Where the policies come from. On Supabase you write RLS as SQL in a dashboard, and a policy that silently returns zero rows is a debugging session with no stack trace. In Rebase the policy is part of the collection definition in TypeScript and is compiled to a real Postgres policy when you migrate. The enforcement is identical — it is Postgres in both cases — but the rule lives in your repository, goes through code review, and shows up in a diff."
        },
        {
            q: "Isn't the Supabase dashboard already an admin panel?",
            a: "It is a table editor, which is a different product. It is built for the developer: raw rows, foreign-key UUIDs, no workflow, no roles beyond database roles. Rebase generates an interface for the people who run the business — forms, media, permissions, kanban boards, and your own React components wherever the generated defaults are wrong — out of the same collection definitions that produced the API."
        },
        {
            q: "When is Supabase the better choice?",
            a: "When you want the largest ecosystem in this category, the most third-party tutorials, or edge functions running at the CDN. Supabase is the more mature product with a much bigger community, and if nobody outside your engineering team will ever open the back office, most of what Rebase adds is weight you will not use."
        },
        {
            q: "How much of a rewrite is moving an app from Supabase to Rebase?",
            a: "The database is the part that does not move — it is Postgres on both sides. What changes is the client: Supabase's JS client and Rebase's typed SDK are different APIs, so calls have to be rewritten, and any policy you wrote in the dashboard has to be expressed as a collection's security rules. Realistically it is a client-layer migration, not a data migration."
        },
        HOSTING
    ],

    firebase: [
        {
            q: "Can I migrate from Firestore to Rebase?",
            a: "The data can move, but it is a genuine migration rather than a connection change: Firestore is a document store and Rebase is relational, so collections of nested documents have to be modelled as tables and foreign keys. That modelling work is the migration. What you get for it is SQL, joins, transactions and constraints — which is usually the reason people leave in the first place."
        },
        {
            q: "Does Rebase have realtime like Firestore?",
            a: "Yes — realtime subscriptions over WebSocket, driven by changes in Postgres, and delivered under the same row-level security as every other read. That last part is the difference worth knowing: a subscription cannot see rows the subscriber is not allowed to read, because the policy is enforced by the database rather than by the code that set up the listener."
        },
        {
            q: "What replaces Firebase Auth?",
            a: "Rebase ships authentication with JWT and Google OAuth, and the signed-in user's identity is what row-level security policies are written against. The practical difference is that your users live in your own Postgres, in a table you can query and join against, rather than in a separate identity service you reach over an API."
        },
        {
            q: "When is Firebase the better choice?",
            a: "When you are building a mobile app that has to work offline. Firebase's client SDKs and their offline persistence are genuinely excellent and there is no equivalent here. It is also the better answer if you want Google's operational scale without thinking about a database at all — the flip side of owning your Postgres is that you own your Postgres."
        },
        {
            q: "Why move to Postgres at all?",
            a: "Usually because a query got hard. Document stores are pleasant until you need to ask a question that spans three collections, enforce that two writes happen together, or hand an analyst something they can query. Those are one-line problems in SQL and architectural problems in Firestore."
        },
        HOSTING
    ],

    directus: [
        {
            q: "Can Rebase run on a database Directus already manages?",
            a: "Yes. Rebase points at an existing PostgreSQL database and reads the tables it finds, so a Directus-managed schema is a valid starting point. Directus's own bookkeeping tables stay where they are and are simply not modelled as collections — you describe the tables you care about and leave the rest alone."
        },
        {
            q: "Who owns the schema?",
            a: "You do, and this is the central difference. In Directus content types are created through its interface, in its migration format, in tables it manages. In Rebase the schema is TypeScript in your repository; Rebase generates the Postgres tables from it and never asks for a shape of its own. Point it at a database that predates it and it works."
        },
        {
            q: "Where is access control enforced?",
            a: "In Postgres. Rebase compiles a collection's security rules into real row-level security policies, so a query that reaches the database any other way — psql, a report, another service — is still governed by them. Directus enforces permissions in its application layer, in front of the database, which is a real and well-built engine but one that stops at the edge of Directus."
        },
        {
            q: "When is Directus the better choice?",
            a: "When you need a mature content-management experience today. Directus has years of work in its editorial interface, a larger marketplace, and a broader set of database engines behind it — Rebase is PostgreSQL only, deliberately, because the row-level-security story depends on it. If your team is primarily editors managing content, Directus is the more finished product for that job."
        },
        {
            q: "Does Rebase give me an API as well as an admin panel?",
            a: "Both, from the same definition. A REST API, a typed client SDK, realtime subscriptions and an MCP server for agents are generated from the collections, and the admin panel is a consumer of that same public API under the same policies. There is no privileged back channel and no second copy of the data."
        },
        HOSTING
    ],

    strapi: [
        {
            q: "Can I point Rebase at the database behind my Strapi project?",
            a: "Yes, if it is PostgreSQL. Rebase reads existing tables rather than creating its own, so Strapi's content tables are readable as collections. Be aware that Strapi models some relations through its own join tables and metadata, so you will be describing the shape you actually want rather than importing Strapi's internal model wholesale."
        },
        {
            q: "Is Rebase a headless CMS?",
            a: "Not exactly, and the difference matters when choosing. A headless CMS owns the schema and hands you content through its API. Rebase is a backend: your Postgres schema stays yours, the API and the admin panel are both generated from it, and content management is one of the things the panel happens to be good at rather than the whole product."
        },
        {
            q: "What about the plugin ecosystem?",
            a: "This is where Strapi is ahead and it would be dishonest to pretend otherwise — its marketplace is far larger. Rebase extends differently: the admin panel is React, and any custom field, view or page you can build in React drops into it with access to the internal hooks. That suits a team that already writes React, and suits a team that wants to install a plugin much less well."
        },
        {
            q: "When is Strapi the better choice?",
            a: "When the primary users are content editors and you want a polished editorial experience out of the box, or when you need one of the plugins in its marketplace. Strapi has spent years on that surface. Rebase is the better answer when the application is the point and the back office has to follow the schema rather than define it."
        },
        {
            q: "How is authorization different?",
            a: "Strapi has a role and permission system inside the application. Rebase compiles its security rules to PostgreSQL row-level security, so the rules are enforced by the database for every client, not only for requests that arrive through the framework. If somebody connects with psql, the policies are still there."
        },
        HOSTING
    ],

    payload: [
        {
            q: "Do I have to use Next.js?",
            a: "No. Payload is designed to live inside a Next.js application, which is a real advantage if that is your stack. Rebase runs as its own backend and serves any client — React, Vue, mobile, another service — over a REST API and a typed SDK. If you are already all-in on Next.js, Payload's integration is tighter; if you are not, Rebase does not ask you to be."
        },
        {
            q: "Can Rebase work with an existing Postgres schema?",
            a: "Yes, including one that predates it. Rebase reads the tables it is pointed at and generates the API and the admin panel from collection definitions you write against them. It does not require ownership of the database and does not maintain a schema of its own alongside yours."
        },
        {
            q: "What about rich content editing?",
            a: "Rebase ships a block editor in its CMS layer, alongside forms, media handling and roles. Payload's content modelling — nested blocks, localisation, versioning of editorial content — is deeper, and if the product you are building is fundamentally a publication, that depth is the thing you are buying."
        },
        {
            q: "When is Payload the better choice?",
            a: "When you are building a content-heavy site in Next.js and want the CMS to live in the same codebase and deploy. That is a genuinely good architecture and Rebase does not replicate it. Rebase fits better when the backend has to stand on its own — several clients, a team that is not all frontend developers, or authorization that has to hold at the database."
        },
        {
            q: "Where does authorization live?",
            a: "In PostgreSQL. Collection security rules compile to row-level security policies, which the database applies to every query regardless of which client sent it. Payload enforces access control in application code, which is expressive and easy to reason about, but it is only in force for requests that go through Payload."
        },
        HOSTING
    ],

    retool: [
        {
            q: "Does Rebase connect to my database the way Retool does?",
            a: "It runs on your infrastructure rather than connecting inward to it. Retool is a hosted canvas that reaches your database over a credential you give it — or a self-hosted agent you also operate. Rebase is the backend: it sits with your Postgres and serves the panel from the same place, so there is no outbound connection and no third party holding a database credential."
        },
        {
            q: "Do I have to build every screen by hand?",
            a: "No, and this is the largest practical difference. Retool screens are drawn one at a time, and they stay drawn: add a column and you revisit every screen that should show it. Rebase generates the interface from the collection definitions, so a new field appears in the table, the form and the API at once. You still drop to custom React wherever the generated version is wrong."
        },
        {
            q: "How does the pricing model compare?",
            a: "Retool is priced per user, which is what makes an internal tool expensive precisely as it succeeds — every viewer you add costs more. Rebase is open source and self-hostable at no licence cost, and Rebase Cloud is priced per resource rather than per seat. Adding the eleventh person who needs read access does not change the bill."
        },
        {
            q: "When is Retool the better choice?",
            a: "When you need to join data from many places quickly. Retool's catalogue of integrations — Stripe, Salesforce, S3, half a dozen databases, arbitrary REST — is enormous, and building an ops screen across four SaaS products is genuinely fast there. Rebase is Postgres-centred; if your data is not mostly in Postgres, much of the argument here does not apply."
        },
        {
            q: "Can non-developers use Rebase CMS?",
            a: "That is who it is for. Roles and permissions, forms with validation, media, kanban and list views, inline editing and search are the default experience, and what each role can see is enforced by row-level security in the database rather than by hiding a button."
        },
        HOSTING
    ],

    hasura: [
        {
            q: "REST or GraphQL?",
            a: "Rebase generates a REST API and a typed TypeScript SDK; Hasura generates GraphQL. If GraphQL is a requirement — a federated graph, clients that depend on it, an existing schema stitched across services — Hasura is built for that and Rebase is not. If you mainly wanted a good API over Postgres without writing one, the typed SDK gets you there with less machinery in between."
        },
        {
            q: "Can Rebase run on a database Hasura already serves?",
            a: "Yes. Both point at an existing PostgreSQL database rather than owning it, so the same schema can back both while you evaluate. Hasura's metadata lives in its own schema and is left alone."
        },
        {
            q: "How do permissions compare?",
            a: "Hasura's permission system is defined in its metadata and applied by the engine as it builds each query — powerful, and thoroughly designed. Rebase compiles security rules to PostgreSQL row-level security, so enforcement happens inside the database and survives any client, including ones that never go through Rebase. The trade-off is expressiveness against reach."
        },
        {
            q: "What does Rebase add that Hasura does not?",
            a: "An admin panel your non-technical colleagues can use, generated from the same definitions as the API. Hasura's console is a developer tool for building and inspecting the graph; it is not a back office, and it is not meant to be. If you have been planning to build an internal UI on top of Hasura, that is the piece Rebase brings."
        },
        {
            q: "When is Hasura the better choice?",
            a: "When GraphQL is the product decision, when you need to federate several data sources behind one graph, or when your clients are already generating code from a GraphQL schema. Those are Hasura's home ground."
        },
        HOSTING
    ],

    django: [
        {
            q: "Do I have to leave Python?",
            a: "For the backend, yes — Rebase is TypeScript. That is the honest cost, and if your team's expertise and existing code are Python, it is a large one. What you get back is one language across the stack: the same collection definitions produce the database schema, the REST API, the typed client SDK and the admin panel, so the frontend is not consuming an API that somebody maintains by hand."
        },
        {
            q: "Can Rebase read a database Django created?",
            a: "Yes, if it is PostgreSQL. Rebase connects to existing tables rather than generating its own schema, so Django's tables — including its auth tables, if you want them modelled — can be described as collections and get an admin panel and an API without touching the data."
        },
        {
            q: "How does the admin compare to django-admin?",
            a: "django-admin is excellent and deservedly famous, and this comparison exists because people ask for it elsewhere. The differences: Rebase's panel is React, so it extends in the framework most frontend teams already use, and it is generated alongside a typed API rather than being a separate surface over the ORM. django-admin is more battle-tested by a wide margin."
        },
        {
            q: "When is Django the better choice?",
            a: "When your team writes Python, when you need its ecosystem — data science libraries, Celery, the ORM's maturity — or when the application is a server-rendered Django app and adding a separate backend would be a second thing to run. Django is a complete framework; Rebase is a backend plus an admin panel, and it does not try to be the former."
        },
        {
            q: "Where is authorization enforced?",
            a: "In PostgreSQL, through row-level security compiled from the collection definitions. Django enforces permissions in the application layer, which is the normal and sensible thing for a framework to do. The difference shows up when something other than your Django app reaches the database — a script, a report, another service — and the rules either travel with the data or do not."
        },
        HOSTING
    ]
};
