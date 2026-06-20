---
title: Global Backend Hooks
sidebar_label: Global Hooks
description: Intercept database operations, user management, and roles globally at the server API boundary.
---

## Overview

While **[Entity Callbacks](/docs/collections/callbacks)** run on the database adapter layer scoped to individual collections, **Global Backend Hooks** run at the HTTP API boundary. They allow you to define cross-cutting logic that applies globally across all collections or admin endpoints.

Use global backend hooks for:
- **Global PII masking**: Filtering out or redacting sensitive user information for specific roles.
- **Unified audit logging**: Writing log entries for all creations, updates, or deletions across all collections.
- **Global validation rules**: Restricting certain HTTP methods or operations under custom context rules.
- **User lifecycle side-effects**: Sending custom welcome emails or syncing external identity providers when users are saved or deleted.

## Configuration

Configure hooks in `initializeRebaseBackend` by providing the `hooks` property of type `BackendHooks`:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server-core";

const instance = await initializeRebaseBackend({
    app,
    server,
    // ... basic config
    hooks: {
        users: {
            afterRead: (user, context) => {
                // Return user or null to filter it out
                return user;
            }
        },
        data: {
            afterRead: (slug, entity, context) => {
                // Apply global data transformations
                return entity;
            }
        }
    }
});
```

---

## Hook Context

Every boundary hook receives a `BackendHookContext` detailing the request environment:

```typescript
interface BackendHookContext {
    /** The authenticated user payload, or undefined if public */
    requestUser?: {
        userId: string;
        roles: string[];
    };
    
    /** The HTTP method triggering the hook */
    method: "GET" | "POST" | "PUT" | "DELETE";
}
```

---

## User Hooks (`users`)

Intercept user account operations at the `/api/admin` boundary.

| Hook | Signature | Description |
|------|-----------|-------------|
| `afterRead` | `(user, context) => user \| null` | Transform user record before returning. Returning `null` hides it. |
| `beforeSave` | `(data, context) => data` | Modify user fields (email, roles, name) before database insert/update. Throw to reject. |
| `afterSave` | `(user, context) => void` | Post-save hook for side effects. |
| `beforeDelete` | `(userId, context) => void` | Intercept delete operations. Throw to prevent. |
| `afterDelete` | `(userId, context) => void` | Post-delete side effects hook. |

### Example: Sync User to CRM on signup

```typescript
const hooks: BackendHooks = {
    users: {
        afterSave: async (user, context) => {
            if (context.method === "POST") {
                // New user signed up - sync to HubSpot/Salesforce
                await syncToCRM(user.email, user.displayName);
            }
        },
        beforeDelete: async (userId, context) => {
            // Prevent deleting protected system accounts
            if (userId === "system-admin-uuid") {
                throw new Error("Cannot delete system admin account!");
            }
        }
    }
};
```

---

## Role Hooks (`roles`)

Intercept role definitions fetched by the admin panel.

| Hook | Signature | Description |
|------|-----------|-------------|
| `afterRead` | `(role, context) => role \| null` | Modify or hide role properties dynamically. |

---

## Data Boundary Hooks (`data`)

These hooks intersect **ALL** collection entities flowing through the REST API routes. 

### Execution Priorities & Boundaries

It is critical to distinguish between **Entity Callbacks** and **Global Backend Hooks**:
1. **Database Adapter Boundary (Entity Callbacks)**: Callbacks defined on individual collections (e.g., `beforeSave`, `beforeDelete`) execute *inside* the Postgres driver's transactional block, under the subscriber's specific RLS parameters (`app.user_id`, `app.user_roles`). They are designed for database integrity, field defaults, and transaction-bound validations.
2. **HTTP API Boundary (Global Hooks)**: Global hooks execute at the Hono router boundary *outside* the Postgres transaction scope. 

```
[Client Request]
       │
       ▼
 [Hono Router]
       │
 ┌─────┴───────────────────────────────────────────────────────┐
 │ 1. Global Hook: data.beforeSave (HTTP Boundary - Blocking)  │
 └─────┬───────────────────────────────────────────────────────┘
       │
 [Database Driver]
 ┌─────┴───────────────────────────────────────────────────────┐
 │ 2. Start PostgreSQL Transaction                             │
 │ 3. Set Config: app.user_id = '<uid>', app.user_roles = ...  │
 │ 4. Entity Callback: beforeSave (Tx Boundary - Blocking)     │
 │ 5. Drizzle SQL execution & Postgres RLS evaluation          │
 │ 6. Entity Callback: afterSave (Tx Boundary - Blocking)      │
 │ 7. Commit Transaction                                       │
 └─────┬───────────────────────────────────────────────────────┘
       │
 ┌─────┴───────────────────────────────────────────────────────┐
 │ 8. Global Hook: data.afterSave (HTTP Boundary - Deferred)   │
 └─────┬───────────────────────────────────────────────────────┘
       │
       ▼
[Client Response]
```

### Blocking vs. Asynchronous Hook Semantics

- **Blocking Hooks (`beforeSave`, `beforeDelete`)**: Executed sequentially and synchronously prior to running database operations. If any hook throws an error, the pipeline is immediately halted, aborting the transaction and returning a `400 Bad Request` or `403 Forbidden` response to the client.
- **Asynchronous Hooks (`afterSave`, `afterDelete`)**: Executed after the database transaction has committed. To keep HTTP response times low, these hooks are handled via deferred promises. They execute in the background without holding up the HTTP response to the client.

These run **after** the per-collection `EntityCallbacks`.

| Hook | Signature | Description |
|------|-----------|-------------|
| `afterRead` | `(slug, entity, context) => entity \| null` | Modify or redact fields before sending to client. Return `null` to exclude the record. |
| `beforeSave` | `(slug, values, entityId, context) => values` | Perform global checks or inject values before saving. Throw to abort. |
| `afterSave` | `(slug, entity, context) => void` | Run post-save tasks (e.g. syncing search indexes). |
| `beforeDelete` | `(slug, entityId, context) => void` | Run validation before deletion. Throw to block. |
| `afterDelete` | `(slug, entityId, context) => void` | Post-deletion cleanup. |

### Example: Global PII Masking and Global Audit Logging

```typescript
import { BackendHooks } from "@rebasepro/types";

const hooks: BackendHooks = {
    data: {
        // Redact email addresses for non-admin requests
        afterRead: (slug, entity, context) => {
            const isAdmin = context.requestUser?.roles.includes("admin");
            
            if (!isAdmin && entity.email) {
                return {
                    ...entity,
                    email: "********" // Mask email
                };
            }
            return entity;
        },
        
        // Log all deletion actions globally
        afterDelete: async (slug, entityId, context) => {
            console.log(`[AUDIT] User ${context.requestUser?.userId} deleted ${slug}/${entityId}`);
            await writeToAuditLogs({
                action: "delete",
                collection: slug,
                entityId,
                userId: context.requestUser?.userId
            });
        }
    }
};
```
