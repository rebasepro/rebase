# Rebase in Claude's connector directory — submission package

Everything the form at **claude.ai/directory/manage → Submit new → MCP
connector** asks for, ready to paste, plus what still has to happen before
submitting. Requirements were read from Anthropic's pages on 2026-11-06:
[submission](https://claude.com/docs/connectors/building/submission),
[review criteria](https://claude.com/docs/connectors/building/review-criteria),
[authentication](https://claude.com/docs/connectors/building/authentication),
[MCP Apps](https://claude.com/docs/connectors/building/mcp-apps/getting-started).

Who can submit: any paid Claude plan. On a Team or Enterprise organization,
an Owner. The listing belongs to the organization you submit from.

## Before submitting (in order)

1. ~~Deploy the scope fix~~ — done 2026-11-07. The 401 challenge names all
   five scopes:
   `curl -si -X POST https://app.rebase.pro/mcp -d '{}' | grep -i www-authenticate`.
   Connecting from Claude in Chrome also works since 2026-11-07 (consent
   `form-action` and the token endpoint's CSRF check, both fixed and deployed).
2. ~~Publish the privacy-policy section~~ — live since 2026-11-07, section 17
   of `https://rebase.pro/policy/privacy_policy/`.
3. **Create the reviewer account** (below). The connector already being added
   to your own Claude does not cover this: reviewers sign in with their own
   login. Reviewers must get "a fully
   populated account" and be able to run the write tools on real data.
4. **Run every tool yourself** in Claude (custom connector) and with
   `npx @modelcontextprotocol/inspector --cli https://app.rebase.pro/mcp --transport http --method tools/list`.
   The form asks you to confirm you did.

## 1. Connection

- **Server URL:** `https://app.rebase.pro/mcp`
- **Users connect to:** one URL (the same for everyone).

## 2. Tools (synced from the server)

Ten tools; every one has a `title` and annotations.

| Tool | Kind | Annotations |
|---|---|---|
| `projects` | read | `readOnlyHint: true` |
| `project_status` | read | `readOnlyHint: true` |
| `logs` | read | `readOnlyHint: true` |
| `schema` | read | `readOnlyHint: true` |
| `query` | read | `readOnlyHint: true` |
| `show_collection` | read, MCP App (table) | `readOnlyHint: true` |
| `write` | write, plan then confirm | `destructiveHint: true`, `idempotentHint: true` |
| `deploy` | write, plan then confirm | `destructiveHint: true` |
| `env` | write, plan then confirm | `destructiveHint: true`, `idempotentHint: true` |
| `cron` | write, plan then confirm | `destructiveHint: true` |

## 3. Listing

- **Server name:** `Rebase`
- **One-liner** (≤200): `Your Rebase projects in Claude: read and change data, deploy, roll back, set env vars and run cron jobs, on Rebase Cloud or self-hosted. Every change is confirmed first.`
- **Description** (≤2,000):

> Rebase is an open-source backend on Postgres: a typed API, auth, realtime,
> storage, functions and an admin panel, run on Rebase Cloud or on your own
> servers. This connector reaches every Rebase project you have access to
> from one place.
>
> Ask Claude to list your projects and their status, read build, runtime and
> cron logs, look at a project's schema, and query its rows. Show a collection
> as a table in the conversation and edit cells in place. Deploy a branch, roll
> back to an earlier deployment, set or remove environment variables, and run
> or pause cron jobs.
>
> Every change takes two steps: Claude first shows a plan of exactly what will
> happen, and nothing runs until you agree. In the table, an edited cell shows
> the plan and waits for you to press Save. Environment variable values are
> never shown back.
>
> The connector acts as you, with the access your Rebase account has: the
> projects of your organizations, your role in each, and your project's
> row-level security on every data call. It holds no key of its own.
>
> Self-hosted Rebase servers join with one command, `rebase cloud connect
> <url>`, and then appear beside your Cloud projects. On those, the connector
> reads and changes data, reads the schema and runs cron jobs; deploys, env
> vars and logs stay on your own server.

- **Categories (1–5):** Developer tools; Databases; Data & analytics; Productivity. (Use the closest names the form offers.)
- **Documentation URL:** `https://rebase.pro/docs/ai/rebase-connector/`
- **Privacy policy URL:** `https://rebase.pro/policy/privacy_policy/` (after the section below is published)
- **Support contact:** `hello@rebase.pro`
- **Icon:** [`icon-512.png`](icon-512.png) (512×512 PNG, the Rebase cube)
- **URL slug:** `rebase` (permanent once published)
- **Detail card description:** the one-liner above.
- **Allowed link URIs:** leave empty. The table opens no links.
- **Carousel screenshots** (required because `show_collection` is an MCP App;
  PNG, ≥1000 px wide, 3–5, the app response only, no prompt in the image,
  each paired with its prompt). Taken in Claude on 2026-11-07 with the live
  connector, the table opened fullscreen over a real Rebase project
  (SongBuzz's `songs`: public song metadata, no personal data). 1568×680
  PNG each:

  | File | Prompt |
  |---|---|
  | [`screenshots/1-table.png`](screenshots/1-table.png) | Show me the songs table in my SongBuzz project, most played first. |
  | [`screenshots/2-edit-plan.png`](screenshots/2-edit-plan.png) | (in the table) Edit a song's title — the change waits on Save. |
  | [`screenshots/3-switches-and-stats.png`](screenshots/3-switches-and-stats.png) | (in the table) Scroll right to the switches and play counts. |

  Images from outside hosts (the cover column) show as an "Image" label:
  Claude loads only the origins a view declares, and a project's image hosts
  are its data. The edit in shot 2 was cancelled, not saved.

## 4. Use cases

- **Primary use cases:** checking on and operating Rebase projects without
  leaving Claude: status and logs when something breaks, reading and fixing
  rows, shipping a branch or rolling back, rotating an environment variable,
  re-running a cron job.
- **What users need first:** a Rebase account (app.rebase.pro) with at
  least one project, or a self-hosted Rebase 0.28.1+ server added with
  `rebase cloud connect`. Data, schema and cron need the organization's owner
  or admin role and, on Cloud, Studio access switched on for the project.
- **Reads, writes or both:** both.

## 5. Company

- **Company:** FireCMS S.L. (operates Rebase) — **Website:** `https://rebase.pro`
- **Primary contact for review:** your email.

## 6. Authentication

- **Requirement:** always required.
- **Method:** OAuth sign-in card, dynamic client registration (`oauth_dcr`, RFC 7591). No Anthropic-held credentials.
- What reviewers will see: Claude registers itself, opens the Rebase consent
  screen (it names the redirect host, `claude.ai`), the person signs in with
  their Rebase account (or is offered the console session already open in
  that browser) and presses Allow. PKCE S256, refresh-token rotation with family
  revocation on reuse, `invalid_grant` for dead refresh tokens.

## 7. Data handling

- **Whose API:** our own (first-party): Rebase Cloud's control plane and the
  customer's own Rebase projects. For a self-hosted instance the connector
  calls a server the customer added and configured to accept it.
- **Personal health data:** no (we do not process it as a category; a
  customer's own tables are their data).
- **Sponsored content:** no.

## 8. Test & launch — reviewer account (you create it; agents may not create accounts)

1. Sign up at `https://app.rebase.pro` with a dedicated address, e.g.
   `claude-review@rebase.pro`, and a strong password.
2. Create an organization "Claude Review" and one project, `shop`, with
   populated tables (for example `orders`, `customers` and `products`, a few
   dozen rows each), at least one cron job, and a few deployments (deploy it
   twice, so a rollback has somewhere to go).
3. Switch **Studio access** on for the project (project settings).
4. Optional: add one self-hosted instance with `rebase cloud connect` so
   reviewers see a linked instance next to the Cloud project.
5. Paste into the form:

> Sign in with claude-review@rebase.pro / <password> on the Rebase consent
> screen and press Allow. You own the organization "Claude Review" with one
> project, "shop". Try: "list my Rebase projects", "what's the status of shop
> and its last deployments", "show the orders table in shop" (opens an
> editable table; edit a cell and press Save), "change the plan of customer
> cus_85 to pro" (Claude shows a plan; confirm), "set env FEATURE_X=on on shop"
> (confirm), "roll shop back to its previous deployment" (confirm), "run one
> of shop's cron jobs now" (confirm). Every write runs only after the second,
> confirmed call. All data in this project is test data; change anything.

## 9. Compliance acknowledgments

None conflicts with the connector: no first-party API of anyone else, no
financial transactions, no AI media generation, tool descriptions carry no
instructions to call other tools, no conversation data is collected beyond
the call itself, and the documentation is public.

## Privacy-policy section to add (DRAFT — needs your approval)

Proposed as a new section of `website/src/pages/policy/privacy_policy.astro`,
"THE REBASE CONNECTOR FOR AI ASSISTANTS". Facts below are what the code does
today; check them against the legal wording you want.

> When you connect an AI assistant such as Claude to Rebase through the Rebase
> connector (`https://app.rebase.pro/mcp`), we process the following, only to
> operate the connection you asked for:
>
> - **The authorization you grant:** the assistant's client registration (its
>   name and redirect address), the permissions you allowed, and your account
>   identifier. Access tokens expire after one hour. Refresh tokens last 30
>   days and are stored only as a SHA-256 hash; we delete expired ones within
>   30 days. You can revoke the connection at any time by removing the
>   connector in your assistant, or by signing out everywhere in Rebase.
> - **Each request the assistant makes:** the tool, its arguments and the
>   project it names, to run it as you. The result — your project's data, logs
>   or status — is returned to the assistant and is not stored by the
>   connector. For a change, we keep only the identifier of the single-use
>   confirmation token until it expires (five minutes), never its arguments.
> - **Operational logs:** for each request into one of your projects, the time,
>   your account identifier, the project and the permission used; for each
>   confirmed change or failed request, also the tool. They are kept with our
>   other service logs, for security and debugging. A project's own logs
>   record the same request when it arrives there.
> - **Self-hosted instances you add:** the instance's address, name and
>   organization, until you remove it. Requests to it are made from our
>   servers on your behalf and their results are not stored.
>
> What the assistant does with the data it receives is governed by its
> provider's terms and privacy policy (for Claude, Anthropic's). We do not
> sell this data or use it to train models.
