---
title: Fonctions Personnalisées
sidebar_label: Fonctions Personnalisées
description: Ajoutez des points de terminaison d'API Hono personnalisés aux côtés de vos routes CRUD Rebase. Découverte automatique à partir d'un répertoire, avec un accès complet à l'instance de backend.
---

## Overview

Les fonctions personnalisées vous permettent d'ajouter des **routes d'API Hono arbitraires** aux côtés des points de terminaison CRUD auto-générés de Rebase. Elles suivent le même modèle de **découverte basée sur les fichiers** que les collections et les tâches cron : déposez un fichier TypeScript dans votre répertoire `functions/`, et Rebase le monte automatiquement.

Utilisez les fonctions personnalisées pour :

- **Points de terminaison de logique métier** — approbations, promotions, workflows personnalisés
- **Intégrations tierces** — webhooks Stripe, commandes Slack, proxys d'API externes
- **Points de terminaison publics** — formulaires de contact, capture de leads, vérifications de l'état de santé
- **Requêtes agrégées** — statistiques de tableau de bord, rapports, analyses

## Définir une fonction personnalisée

Créez un fichier dans votre répertoire `backend/functions/` qui exporte par défaut une application Hono :

```typescript
// backend/functions/hello.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

app.get("/", (c) => {
    return c.json({ message: "Hello from custom function!" });
});

export default app;
```

Ceci est monté à **`/api/functions/hello`**. Le nom de fichier (sans extension) devient le préfixe de la route.

## Configuration

Activez les fonctions personnalisées en ajoutant `functionsDir` à votre configuration de backend :

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase va :

1. Scanner le répertoire pour les fichiers `.ts` / `.js`
2. Valider que chaque exportation par défaut est une application Hono (duck-typed via `.fetch()` + `.routes`)
3. Monter chaque application à `/api/functions/<filename>`
4. Appliquer le middleware d'authentification (voir [Authentification](#authentication) ci-dessous)

## Nommage des fichiers et mappage des routes

| Fichier | Chemin de montage |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Fichiers qui sont **ignorés** :

- `index.ts` / `index.js` — réservé
- `*.test.ts` / `*.test.js` — fichiers de test
- `*.d.ts` — déclarations de type

## Export Formats

Le chargeur accepte deux formats d'exportation :

### Application Hono (recommandé)

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
const app = new Hono<HonoEnv>();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Fonction Fabrique

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

Les deux sont détectés via le duck-typing — le chargeur vérifie les propriétés `.fetch()` et `.routes`, de sorte que toute instance compatible Hono fonctionnera quelle que soit la version de Hono installée.

## Authentication

Les fonctions personnalisées sont montées avec le **même middleware d'authentification** que les routes de données, mais avec `requireAuth: false`. Cela signifie :

- Le JWT de l'utilisateur est **analysé et injecté** dans le contexte s'il est présent
- Mais les requêtes ne sont **pas rejetées** si aucun JWT n'est fourni
- Vous devez **protéger explicitement** les routes qui nécessitent une authentification

### Protection des routes

Utilisez les assistants d'authentification intégrés de Rebase :

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

// Public endpoint — no auth required
app.get("/public", (c) => {
    return c.json({ message: "Anyone can access this" });
});

// Protected endpoint — requires a valid JWT
app.post("/protected", async (c) => {
    // Narrowed: the env types every variable the middleware may set.
    const user = c.get("user") as { uid: string; roles?: string[] } | undefined;
    if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
    }
    return c.json({ message: `Hello, ${user.uid}` });
});

// Admin-only endpoint
app.post("/admin-only", async (c) => {
    const user = c.get("user") as { uid: string; roles?: string[] } | undefined;
    const roles: string[] = user?.roles ?? [];
    if (!roles.includes("admin")) {
        return c.json({ error: "Admin access required" }, 403);
    }
    return c.json({ message: "Admin operation succeeded" });
});

export default app;
```

:::important
Le middleware JWT de Rebase est limité aux routes API intégrées (`/api/data`, `/api/auth`, etc.). Les routes de fonctions personnalisées obtiennent le **contexte utilisateur analysé**, mais vous devez appliquer le contrôle d'accès vous-même.
:::

## Accès à la base de données

Les fonctions personnalisées s'exécutent aux côtés de Rebase, vous pouvez donc accéder à la base de données via deux approches :

### 1. Via le Singleton Rebase (Recommandé)

Le package `@rebasepro/server` fournit un singleton `rebase` qui vous donne un accès de niveau administrateur à tous les services (données, authentification, stockage, e-mail) liés à l'application, depuis n'importe où dans votre backend.

```typescript
// backend/functions/approve-job.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { rebase } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

app.post("/:id/approve", async (c) => {
    const id = c.req.param("id");

    // Use the admin-level data API (bypasses RLS)
    await rebase.data.saveEntity("jobs", {
        id,
        status: "published",
        approved_at: new Date().toISOString(),
    });

    return c.json({ success: true });
});

export default app;
```

### 2. Via l'Accès Direct à Drizzle

```typescript
// backend/functions/reports.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { db } from "../src/db"; // Your Drizzle instance
import { sql } from "drizzle-orm";

const app = new Hono<HonoEnv>();

app.get("/stats", async (c) => {
    const result = await db.execute(sql`
        SELECT COUNT(*) as total FROM jobs WHERE status = 'published'
    `);
    return c.json({ totalJobs: result.rows[0]?.total });
});

export default app;
```

:::tip
L'instance Drizzle `db` utilisée par Rebase est la même que celle que vous passez à `createPostgresBootstrapper`. Vous pouvez la partager librement entre les fonctions personnalisées et Rebase.
:::

## Ordre d'enregistrement des routes

Les fonctions personnalisées sont chargées et montées **après** que `initializeRebaseBackend()` ait terminé la configuration principale. L'ordre d'initialisation est :

1. **Bootstrappers** — Connexions à la base de données, tables d'authentification, services en temps réel
2. **Routes d'authentification** — `/api/auth/*`, `/api/admin/*`
3. **Routes de stockage** — `/api/storage/*`
4. **Routes de données** — `/api/data/*` (CRUD pour les collections)
5. **Fonctions personnalisées** ← `/api/functions/*`
6. **Tâches Cron** — `/api/cron/*`
7. **WebSocket** — Abonnements en temps réel

Cela signifie que vos fonctions personnalisées ont accès à tous les services initialisés. Enregistrez toutes les routes qui doivent s'exécuter **avant** Rebase directement sur l'application Hono, avant d'appeler `initializeRebaseBackend()` :

```typescript no-verify
const app = new Hono<HonoEnv>();

// Ceci s'exécute AVANT les routes Rebase
app.get("/health", (c) => c.json({ status: "ok" }));

// Initialisation de Rebase — enregistre toutes les routes /api/*
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

## Exemple : Gestionnaire de Webhook

```typescript
// backend/functions/stripe-webhook.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import Stripe from "stripe";
import { instance } from "../src/index";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const app = new Hono<HonoEnv>();

app.post("/", async (c) => {
    const sig = c.req.header("stripe-signature")!;
    const body = await c.req.text();

    const event = stripe.webhooks.constructEvent(
        body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!
    );

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        await instance.driver.data.subscriptions.create({
            userId: session.client_reference_id,
            stripe_id: session.subscription,
            status: "active",
        });
    }

    return c.json({ received: true });
});

export default app;
```

## Debugging

Lorsqu'une fonction est chargée avec succès, vous verrez :

```
⚡ Loaded function route: hello
```

Si le chargement échoue, le chargeur fournit une sortie de diagnostic :

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
```

## Prochaines Étapes

- **[Présentation du Backend](/docs/backend)** — Référence complète de la configuration du backend
- **[Callbacks d'Entité](/docs/collections/callbacks)** — Exécutez de la logique sur les modifications de données
- **[Tâches Cron](/docs/backend/cron-jobs)** — Tâches d'arrière-plan planifiées
---
