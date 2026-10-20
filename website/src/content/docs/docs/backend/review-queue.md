---
title: Review Queue
sidebar_label: Review Queue
description: Let agents propose inserts, updates and deletes while people approve them in the admin panel, with @rebasepro/plugin-review.
---

`@rebasepro/plugin-review` puts a person between an agent and your data. The agent proposes a change; nothing in the collection moves until someone who reviews that collection approves it in the admin panel.

It is a plugin, outside the core packages, with three entry points:

| Entry | Loaded by | What it holds |
|---|---|---|
| `@rebasepro/plugin-review/config` | collection files, the function, the panel | The configuration types, `reviewSecurityRules()`, the config checks |
| `@rebasepro/plugin-review/server` | a function file | `reviewFunction()`: propose, list, approve, reject |
| `@rebasepro/plugin-review` | the admin panel | `useReviewPlugin()`: the review queue |

There are two ways to review a collection.

- **Staged table.** A proposal is recorded in `rebase.staged_changes`, beside the table. The row is untouched until a reviewer approves, and the approval runs the write under the reviewer's own row-level security.
- **State field.** The row carries its own review state in a string property such as `status`. An agent role may only write rows in the pending state; Postgres enforces it with a restrictive policy. A reviewer approves by setting the field to the approved value.

## Declare the review once

The server function and the admin plugin read the same object, so keep it in one file:

```typescript
// config/review.ts
import type { ReviewConfig, StateFieldReview } from "@rebasepro/plugin-review/config";

// Rows carry their own state.
export const postsReview: StateFieldReview = {
    mode: "state-field",
    field: "status",
    pendingValue: "draft",
    approvedValue: "published",
    rejectedValue: "rejected",
    agentRoles: ["agent"],
    reviewerRoles: ["editor"]
};

export const review: ReviewConfig = {
    collections: {
        // Proposals wait beside the table.
        orders: { mode: "staged-table", agentRoles: ["agent"], reviewerRoles: ["ops"] },
        posts: postsReview
    }
};
```

The `admin` role always reviews. A staged-table review's `agentRoles` are the roles that may propose besides the reviewers; leave it out and any signed-in caller may. A state-field review's `agentRoles` are the roles held to `pendingValue`; leave it out and every caller who is not a reviewer is.

## Staged table: register the function

```typescript
// functions/review.ts
import { reviewFunction } from "@rebasepro/plugin-review/server";
import { review } from "../config/review";

export default reviewFunction(review);
```

The file name is the function's name, so its routes answer under `/api/functions/review` — see [Custom Functions](/docs/backend/custom-functions) for how functions are loaded. Set `functionName` in the configuration if you register it under another name.

| Route | What it does |
|---|---|
| `POST /changes` | Propose `{ collection, operation, recordId?, data?, reason? }`. `operation` is `insert`, `update` or `delete`. Answers `201` with the pending change. |
| `GET /changes?collection=&status=` | The changes the caller reviews, and the caller's own proposals. |
| `GET /changes/count?collection=&status=` | How many there are. |
| `POST /changes/:id/approve` | Apply one change. Optional `{ note }`. |
| `POST /changes/:id/reject` | Reject one change. Optional `{ note }`. |
| `POST /changes/batch` | `{ action, ids, note? }`: an approval applies every change in one transaction, or none of them. |

An update or a delete is checked against the row as the proposer can read it, through their own row-level security, and that snapshot is what the reviewer sees as "before".

The table is created on first use, and the end-user database role holds nothing on it: proposals are read and decided through the function alone.

### Give the agent a key that can only propose

Create a service key with `functions:invoke:review` and the read scopes the agent needs, and without `data:write` ([API Keys](/docs/backend/api-keys) and [Roles & Scopes](/docs/backend/roles-and-scopes) cover both). `ADMIN_TOKEN` is an administrator's access token:

```bash
REBASE_URL=http://localhost:3001
ADMIN_TOKEN="<an administrator's access token>"
curl -X POST "$REBASE_URL/api/admin/api-keys" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{ "name": "outreach-agent", "scopes": ["functions:invoke:review", "data:read:orders"], "roles": ["agent"] }'
```

The agent then proposes with the key it was given, and cannot write `orders` directly:

```bash
AGENT_KEY="<the rk_live_ key created above>"
curl -X POST "$REBASE_URL/api/functions/review/changes" \
  -H "Authorization: Bearer $AGENT_KEY" -H "Content-Type: application/json" \
  -d '{ "collection": "orders", "operation": "update", "recordId": "42", "data": { "total": 150 }, "reason": "Upsell accepted" }'
```

An agent on MCP reaches the same route with `invoke_function` (`name: "review"`, `method: "POST"`, `path: "/changes"`).

## State field: add the policy

`reviewSecurityRules()` builds the restrictive policy. Spread it into the collection's [security rules](/docs/collections/security-rules), after the rules that let the agent write at all:

```typescript
// config/collections/posts.ts
import { defineCollection } from "@rebasepro/cms-types";
import { reviewSecurityRules } from "@rebasepro/plugin-review/config";
import { postsReview } from "../review";

export const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    securityRules: [
        { operations: ["select", "insert", "update"], roles: ["agent", "editor"] },
        ...reviewSecurityRules("posts", postsReview)
    ],
    properties: {
        title: { type: "string", name: "Title" },
        status: { type: "string", name: "Status", enum: { draft: "Draft", published: "Published", rejected: "Rejected" } }
    }
});
```

The policy is named `posts_review_pending_only`, from the slug, so it is the same on every `db push`. It lets an agent role insert a row only as `draft`, and update a row only while it is `draft` and stays `draft`; setting `status` to `published` is refused by Postgres, through the API or any other way in under the user role. The trusted server context, the `admin` role and the reviewer roles pass untouched.

## Add the queue to the admin panel

```tsx
import { useReviewPlugin } from "@rebasepro/plugin-review";
import { review } from "../config/review";

const reviewPlugin = useReviewPlugin(review);
// <Rebase plugins={[reviewPlugin]} … />
```

Every reviewed collection gets a **Review queue (N)** button beside its view switcher. It opens the queue:

- a staged change shows an INSERT, UPDATE or DELETE badge, who proposed it (a key's prefix and name, or a person's email), the reason they gave, and a field-by-field diff — the old value struck through, the new one beside it;
- a state-field row shows its fields, and Approve and Reject set its state.

`j` and `k` move, `a` approves, `r` rejects, and Space adds the focused entry to a selection that the buttons at the bottom decide in one batch. A note typed at the bottom is saved with the decision.

The function checks the configuration against the backend's collections on its first request, and answers `500 REVIEW_CONFIG_INVALID` naming every problem — a field that does not exist or is not a string, or a value outside its `enum`.
