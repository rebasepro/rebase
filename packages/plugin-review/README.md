# @rebasepro/plugin-review

Agents propose inserts, updates and deletes; people approve them in the Rebase
admin panel.

```bash
pnpm add @rebasepro/plugin-review
```

| Entry | Loaded by | What it holds |
|---|---|---|
| `@rebasepro/plugin-review/config` | `backend/schema` table files, the function, the panel | `ReviewConfig`, `reviewRls()`, the config checks, `diffStagedChange()` |
| `@rebasepro/plugin-review/server` | a function file | `reviewFunction()` — propose, list, approve, reject |
| `@rebasepro/plugin-review` | the admin panel | `useReviewPlugin()` — the review queue |

```ts
// backend/review.ts — keyed by the slugs of tables in backend/schema
import type { ReviewConfig } from "@rebasepro/plugin-review/config";

export const review: ReviewConfig = {
    collections: {
        orders: { mode: "staged-table", agentRoles: ["agent"], reviewerRoles: ["ops"] },
        posts: { mode: "state-field", field: "status", pendingValue: "draft", approvedValue: "published", rejectedValue: "rejected", agentRoles: ["agent"] }
    }
};
```

```ts
// functions/review.ts — answers under /api/functions/review
import { reviewFunction } from "@rebasepro/plugin-review/server";
import { review } from "../review";

export default reviewFunction(review);
```

```tsx
// the admin app
const reviewPlugin = useReviewPlugin(review);
```

- **Staged table:** proposals wait in `rebase.staged_changes` (created on first
  use, out of the end-user role's reach) and are applied, in one transaction,
  under the reviewer's own row-level security. Give an agent's key
  `functions:invoke:review` and no `data:write`, and proposing is the only way
  it can change the table.
- **State field:** spread `reviewRls("posts", review.collections.posts)` into
  the table's `rls`; Postgres then refuses an agent role that moves a row out of
  the pending state. The field is a text or enum column of the table:

  ```ts
  // backend/schema/posts.ts
  import { col, defineTable } from "@rebasepro/server/schema";
  import { reviewRls } from "@rebasepro/plugin-review/config";
  import { review } from "../review";

  export const posts = defineTable("posts", {
      columns: {
          id: col.uuid().primaryKey().defaultRandom(),
          title: col.text().notNull(),
          status: col.enum(["draft", "published", "rejected"]).notNull().default("draft")
      },
      rls: [
          { operations: ["select", "insert", "update"], roles: ["agent", "editor"] },
          ...reviewRls("posts", review.collections.posts)
      ]
  });
  ```

  The function checks the configuration against the backend's tables
  (`services.tables()`) on its first request and answers
  `REVIEW_CONFIG_INVALID` naming each mismatch.

The queue: `j` / `k` move, `a` approves, `r` rejects, Space selects for a batch.

Full guide: https://rebase.pro/docs/backend/review-queue

## Tests

```bash
pnpm --filter @rebasepro/plugin-review test       # unit and component tests
pnpm --filter @rebasepro/plugin-review test:e2e   # a real backend and Postgres; needs Docker
```
