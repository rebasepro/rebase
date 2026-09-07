---
sourceHash: 65910bc3708c9f5d
title: Fonctions Personnalisées
sidebar_label: Fonctions Personnalisées
description: Ajoutez des points de terminaison d'API Hono personnalisés à côté de vos routes CRUD Rebase. Découverts automatiquement depuis un répertoire, avec un accès complet à l'instance backend.
---

## Vue d'ensemble

Les fonctions personnalisées vous permettent d'ajouter des **routes d'API Hono arbitraires** à côté des points de terminaison CRUD générés automatiquement par Rebase. Elles suivent le même modèle de **découverte par fichiers** que les collections et les tâches cron : déposez un fichier TypeScript dans votre répertoire `functions/`, et Rebase le monte automatiquement.

Utilisez les fonctions personnalisées pour :

- **Points de terminaison de logique métier** — approbations, promotions, workflows personnalisés
- **Intégrations tierces** — webhooks Stripe, commandes Slack, proxys d'API externes
- **Points de terminaison publics** — formulaires de contact, capture de prospects, contrôles de santé
- **Requêtes agrégées** — statistiques de tableaux de bord, rapports, analyses

## Définir une Fonction Personnalisée

Créez un fichier dans votre répertoire `backend/functions/` qui exporte par défaut une application Hono :

```typescript
// backend/functions/hello.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/", (c) => c.json({ message: "Hello from custom function!" }));
});
```

Elle est montée sur **`/api/functions/hello`**. Le nom du fichier (sans extension) devient le préfixe de la route.

:::important
Importez depuis **`@rebasepro/server/functions`**, et non depuis `@rebasepro/server`.

Les deux fonctionnent. Le sous-chemin est la surface d'écriture *portable* : elle n'entraîne rien qui exige Node, de sorte qu'une fonction écrite avec elle peut s'exécuter sur n'importe quel runtime JavaScript. La racine du paquet atteint tout le framework — la séquence de démarrage, les chargeurs de fichiers, la couche WebSocket — ce qui convient à un point d'entrée de serveur et dépasse ce dont un gestionnaire de route a besoin. Elle vous donne aussi des accesseurs de contexte typés (`getUser`, `getDriver`) plutôt que de convertir `c.get("user")` à la main.

Voir [Portabilité entre runtimes](#portabilité-entre-runtimes) pour le contrat complet.
:::

## Configuration

Activez les fonctions personnalisées en ajoutant `functionsDir` à votre configuration backend :

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase va :

1. Parcourir le répertoire à la recherche de fichiers `.ts` / `.js`
2. Vérifier que chaque export par défaut est une application Hono (duck-typing via `.fetch()` + `.routes`)
3. Monter chaque application sur `/api/functions/<filename>`
4. Appliquer le middleware d'authentification (voir [Authentification](#authentification-et-propagation-du-contexte) ci-dessous)

## Noms de Fichiers et Correspondance des Routes

| Fichier | Chemin de Montage |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Les fonctions sont découvertes **uniquement au premier niveau du répertoire** — il n'y a pas de récursion. `functions/admin/users.ts` est compilé par `rebase build` mais jamais monté ; aplatissez plutôt le nom (`functions/admin-users.ts`). Un sous-répertoire est signalé au démarrage et comptabilisé sur le point de terminaison de listage, au lieu d'être ignoré en silence.

Fichiers **ignorés** :

- `index.ts` / `index.js` — réservés
- `*.test.ts` / `*.test.js` — fichiers de test
- `*.d.ts` — déclarations de types
- Sous-répertoires, ainsi que les fichiers `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — signalés comme problèmes, puisque la compilation couvre plus que ce que le runtime charge

Le nom est aussi l'identité de la fonction partout ailleurs : c'est le segment d'URL, la permission `functions/<name>` d'une clé d'API, et la valeur que `REBASE_FUNCTIONS_ONLY` sélectionne lorsque vous donnez à une fonction son propre processus.

## Formats d'Export

Outre `defineFunction`, le chargeur accepte deux formats d'export :

### Application Hono

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

const app = new Hono<HonoEnv>();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Fonction Fabrique

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

`defineFunction` renvoie exactement l'application Hono que celles-ci construisent à la main : les trois sont donc interchangeables. Elle vous évite de déclarer `Hono<HonoEnv>` et vous remet le singleton `rebase` dans le rappel.

---

## Sous le Capot : Le Chargeur par Duck-Typing

En compilant des bases de code comportant plusieurs répertoires imbriqués ou dans des monorepos, vous pouvez rencontrer une **duplication du paquet Hono**.

Si le framework Rebase dépend d'une version de Hono et que votre répertoire local de fonctions en résout une autre, les vérifications d'héritage classiques (`exported instanceof Hono`) échouent, car leurs prototypes vivent dans des espaces mémoire distincts.

Pour éviter les faux négatifs et le rejet de routeurs valides, Rebase utilise un validateur par duck-typing (`isHonoLike`) :
- Il vérifie que l'objet exporté est un `object` non nul.
- Il vérifie que l'objet expose une méthode `.fetch` (nécessaire au routage des requêtes).
- Il vérifie que `.routes` est un `array`.

```typescript no-verify
function isHonoLike(obj: unknown): boolean {
    if (!obj || typeof obj !== "object") return false;
    const record = obj as Record<string, unknown>;
    return typeof record.fetch === "function" && Array.isArray(record.routes);
}
```

### Échappatoire du Compilateur de Modules ES

Pour importer dynamiquement des fichiers TypeScript et JavaScript aussi bien sous Windows que sous Posix, le chargeur convertit les chemins de fichiers en URI de fichiers standard via `pathToFileURL(filePath).href`.

Pour empêcher la compilation TypeScript de réécrire les imports dynamiques ESM natifs (`import(url)`) en appels `require()` CommonJS (ce qui lèverait des erreurs à l'exécution sous des runtimes ESM), Rebase exécute une échappatoire du compilateur à l'exécution :

```typescript no-verify
const dynamicImport = new Function("url", "return import(url)");
const mod = await dynamicImport(fileUrl);
```

---

## Authentification et Propagation du Contexte

Les fonctions personnalisées sont montées avec le **même middleware d'authentification** que les routes de données, mais avec `requireAuth: false`. Cela signifie que :

- Le JWT de l'utilisateur est **analysé et injecté** dans le contexte s'il est présent
- Mais les requêtes ne sont **pas rejetées** si aucun JWT n'est fourni
- Vous devez **protéger explicitement** les routes qui exigent une authentification

Un appelant qui présente un *mauvais* jeton n'atteint jamais votre gestionnaire : un jeton invérifiable ou expiré est rejeté avec un 401 par le middleware lui-même, afin qu'une session expirée ne soit jamais silencieusement rétrogradée en session anonyme.

### Lire l'appelant

```typescript
import { defineFunction, getUser, getUserId, getRoles, isAdmin } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/me", (c) => {
        const user = getUser(c);          // { uid, roles, ...claims } | undefined
        if (!user) return c.json({ error: "Unauthorized" }, 401);
        return c.json({ uid: user.uid, roles: user.roles, admin: isAdmin(c) });
    });
});
```

`getUser` renvoie un objet restreint : `uid` est une chaîne et `roles` toujours un tableau, quelle que soit la méthode d'authentification employée par l'appelant. `getUserId(c)` et `getRoles(c)` sont des raccourcis.

### Protéger les Routes

```typescript
import { defineFunction, requireAuth, requireAdmin, requireRole, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // Public endpoint — no guard, so anyone can call it.
    app.get("/public", (c) => c.json({ message: "Anyone can access this" }));

    // 401 for anonymous callers.
    app.post("/protected", requireAuth, (c) => c.json({ message: `Hello, ${getUserId(c)}` }));

    // 401 anonymous, 403 without an administrative role. Order matters.
    app.post("/admin-only", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

    // Any one of the named roles.
    app.post("/publish", requireAuth, requireRole("editor", "admin"), (c) => c.json({ ok: true }));
});
```

Placez les gardes dans l'**emplacement de middleware propre à la route**, comme ci-dessus, plutôt que `app.use("/*", requireAuth)`. `use()` ne couvre que les routes déclarées *en dessous* de lui : une route ajoutée plus tard — en bas du fichier, dans quelques mois — reste donc silencieusement non protégée.

:::important
Lire `getUser(c)` n'est **pas** une garde. Un appelant anonyme obtient `undefined` et votre gestionnaire s'exécute quand même. Seule une garde, ou un `if (!user) return 401` explicite, arrête la requête.
:::

### Authentification par Clé de Service

Rebase prend en charge une `REBASE_SERVICE_KEY` statique définie dans votre `.env` pour les scripts ou les appels de serveur à serveur.

Lorsqu'une requête externe transmet la clé de service via l'en-tête Authorization (`Authorization: Bearer <service_key>`), le middleware d'authentification :
1. Valide la clé par comparaison en temps constant, pour empêcher les attaques temporelles.
2. Accorde un accès de niveau administrateur, en fixant l'appelant à `{ uid: "service", roles: ["admin"] }`.
3. Injecte un `DataDriver` restreint à cette même identité de service. La sécurité au niveau des lignes s'applique toujours — elle est évaluée comme `{ uid: "service", roles: ["admin"] }`, non ignorée.

### Auto-Authentification Interne

Si vous n'avez pas configuré de `REBASE_SERVICE_KEY`, Rebase génère une **clé interne aléatoire par démarrage**. Le singleton `rebase` l'utilise automatiquement lorsqu'il appelle les API du plan de contrôle du serveur lui-même (comme `rebase.auth` ou `rebase.storage`). Votre logique côté serveur peut donc toujours effectuer des tâches administratives, même sans clé de service configurée manuellement.

## Accéder à la Base de Données et aux Services

### 1. Le driver restreint à l'utilisateur — pour tout ce qui sert une requête

`getDriver(c)` renvoie le driver **restreint à l'appelant**, de sorte que chaque lecture et chaque écriture est évaluée contre vos politiques de sécurité au niveau des lignes en tant que cet utilisateur :

```typescript
import { defineFunction, requireAuth, requireDriver } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/", requireAuth, async (c) => {
        const driver = requireDriver(c);
        const myProducts = await driver.fetchCollection({ path: "products", limit: 10 });
        return c.json(myProducts);
    });
});
```

`requireDriver(c)` est `getDriver(c)` sans le `!` — il lève un message nommant le problème de montage au lieu d'échouer vingt lignes plus loin sur `undefined`.

### 2. `rebase.dataAsAdmin` — pour le travail de fond de confiance

```typescript
import { defineFunction, requireAuth, requireAdmin } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/:id/approve", requireAuth, requireAdmin, async (c) => {
        const id = c.req.param("id");
        await rebase.dataAsAdmin.collection<Record<string, unknown>>("jobs").update(id, {
            status: "published",
            approved_at: new Date().toISOString(),
        });
        return c.json({ success: true });
    });
});
```

### Driver restreint par RLS vs. Singleton Rebase

|                     | `getDriver(c)` (lié à la requête)              | `rebase.dataAsAdmin` (identité de service)                        |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **S'exécute comme** | L'appelant (`uid`, ses rôles)                  | `{ uid: "service", roles: ["admin"] }`                            |
| **Application RLS** | ✅ Oui (évaluée contre l'appelant)             | ✅ Oui (évaluée contre l'identité de service)                     |
| **Idéal pour...**   | CRUD utilisateur, recherche et requêtes         | Tâches de fond, déclencheurs système, webhooks                    |
| **Style d'API**     | Méthodes du driver (`fetchCollection`, `save`)  | Accesseurs fluides de collection (`rebase.dataAsAdmin.jobs.find`) |

#### Ce qu'est `dataAsAdmin`, précisément

`rebase.dataAsAdmin` est **restreint à l'administrateur, il ne contourne pas la RLS**. Le driver est restreint une seule fois, au démarrage, avec `withAuth({ uid: "service", roles: ["admin"] })`, de sorte que chaque lecture et écriture s'exécute dans une transaction ayant basculé sur le rôle restreint `rebase_user` avec `app.uid = 'service'`. Vos politiques sont évaluées — contre cette identité.

Pour la plupart des projets la distinction n'apparaît jamais, car les politiques par défaut que Rebase injecte dans chaque collection admettent `serverContext() OR rolesOverlap(['admin'])`, et l'identité de service satisfait la seconde branche. Elle apparaît dès que vous écrivez vos propres politiques :

- **`policy.serverContext()` est faux pour lui.** Cet assistant se compile en `rebase.uid() IS NULL`, et l'`uid` de cet accesseur est `'service'`. Une collection avec `disableDefaultPolicies: true` dont la seule règle d'écriture est `serverContext()` refusera une écriture `dataAsAdmin` avec l'erreur Postgres `42501`, et une lecture sur une telle collection renvoie **zéro ligne avec un HTTP 200** — la direction silencieuse. Écrivez `rolesOverlap(["admin"])` (ou ajoutez-le à côté) quand vous voulez dire « mon backend ».
- **Sa portée équivaut à celle d'un utilisateur `admin`.** Accorder le rôle `admin` à un utilisateur de l'application lui accorde exactement les lignes que voit cet accesseur. Ce n'est pas un canal privé.

### 3. `rebase.sql()` — SQL brut, et le seul accesseur réservé à Node

Si vous avez vraiment besoin d'un contournement inconditionnel, `rebase.sql()` en est un : SQL brut sur la connexion du propriétaire, aucune politique, toutes les lignes. C'est ce qu'il y a de plus privilégié dans le contexte d'une fonction — davantage que l'accesseur qui porte « admin » dans son nom.

```typescript
import { defineFunction, requireAuth, requireAdmin } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/stats", requireAuth, requireAdmin, async (c) => {
        const rows = await rebase.sql(
            "SELECT count(*) AS total FROM jobs WHERE status = $1",
            { params: ["published"] }
        );
        return c.json({ totalJobs: Number(rows[0]?.total ?? 0) });
    });
});
```

Il s'exécute sur une connexion TCP vers votre base de données, ce qui en fait le seul accesseur lié à un processus Node. Cela ne coûte rien sur aucun déploiement existant aujourd'hui — c'est simplement la seule chose à savoir si une fonction devait déménager plus tard. Voir [Portabilité entre runtimes](#portabilité-entre-runtimes).

:::caution[L'accès direct à Drizzle est réservé à Node]
Vous pouvez aussi importer votre propre instance Drizzle et l'interroger directement (`db.execute(sql\`…\`)`). Cela fonctionne, et sur un déploiement Node auto-hébergé ou géré c'est très bien.

Il vaut la peine d'en connaître le prix : une fonction qui importe `drizzle-orm` et un pool `pg` est définitivement une fonction Node, elle contourne les rappels et la validation de votre collection, et elle prend sa connexion ailleurs que dans la requête. `rebase.sql()` vous donne le même SQL brut via la connexion du framework. Préférez-le.
:::

## Configuration et Secrets

Lisez la configuration **à l'intérieur** du gestionnaire, jamais au niveau du module :

```typescript
import { defineFunction, requireEnv, lazyResource } from "@rebasepro/server/functions";

// Built once, on the first request that needs it — not at import time.
const apiKey = lazyResource((env) => env.PRICING_API_KEY ?? "");

export default defineFunction((app) => {
    app.get("/price", async (c) => {
        const endpoint = requireEnv(c, "PRICING_API_URL");
        const response = await fetch(endpoint, {
            headers: { authorization: `Bearer ${apiKey(c)}` }
        });
        return c.json(await response.json());
    });
});
```

Pourquoi cela compte sur **tout** runtime, Node compris :

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Une lecture au niveau du module est évaluée à l'import du fichier, avant qu'aucune requête n'existe. Sous Node, cela signifie qu'une seule variable manquante emporte le fichier entier et toutes ses routes. Sur un hôte qui attache la configuration à la requête plutôt qu'au processus, il n'y a tout simplement rien à lire au moment de l'import.

- `getEnv(c)` — toutes les variables visibles pour cette requête
- `env(c, "NAME")` — une variable, sans espaces superflus ; vide vaut non définie
- `requireEnv(c, "NAME")` — la même chose, mais lève un message nommant la variable
- `lazyResource(factory)` — construit un client coûteux une seule fois, au premier usage

`rebase doctor` signale les lectures de `process.env` au niveau du module dans votre répertoire de fonctions.

## Travail en Arrière-Plan

Le travail qui doit survivre à la réponse va dans `waitUntil` :

```typescript
import { defineFunction, requireAuth, waitUntil } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/orders", requireAuth, async (c) => {
        const order = await c.req.json();
        // The caller does not wait for this, but shutdown does.
        waitUntil(c, rebase.email.send({
            to: "warehouse@example.com",
            subject: "New order",
            html: "<p>Pick and pack</p>"
        }));
        return c.json({ received: true });
    });
});
```

Une promesse sans `await` semble équivalente et ne l'est pas. `waitUntil` apporte deux choses :

- **Sous Node**, la promesse est suivie, de sorte qu'un arrêt gracieux l'attend au lieu que le processus se retire sous un webhook à moitié envoyé. Une promesse flottante à `SIGTERM` est purement et simplement perdue.
- **Sur un hôte à base d'isolats**, l'hôte reçoit l'instruction de maintenir l'isolat en vie jusqu'à ce que la promesse aboutisse. Sans cela, le travail est abandonné dès que la réponse est résolue — en silence, avec un 200 impeccable dans les journaux.

Un rejet est journalisé plutôt que laissé au gestionnaire de rejets non traités, afin que l'échec nomme la route dont il provient.

## Portabilité entre runtimes

Une fonction personnalisée est une application Hono, et Hono s'exécute sur tous les runtimes serveur JavaScript. Savoir si *votre* fonction pourrait s'exécuter ailleurs que dans un processus Node se ramène donc entièrement à ce que son propre fichier importe et touche.

Rien de tout cela ne restreint ce que vous pouvez écrire aujourd'hui. Tout déploiement Rebase est un processus Node, une fonction qui lit un fichier ou ouvre une socket est une fonction parfaitement valable, et aucune compilation ni aucun déploiement n'échoue pour autant. C'est écrit pour que la réponse soit connue maintenant plutôt que découverte fichier par fichier plus tard.

**Portable — fonctionne sur tout runtime :**

- Tout ce qu'exporte `@rebasepro/server/functions`
- `getDriver(c)` et `rebase.dataAsAdmin` — tous deux passent par le même fil où qu'ils s'exécutent
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — la plateforme web
- Toute dépendance qui n'a pas besoin de Node

**Réservé à Node :**

- `rebase.sql()` — la connexion propriétaire de la base de données est une socket TCP
- Un client Drizzle/`pg`/`mongodb` importé directement, pour la même raison
- Modules intégrés de Node : `fs`, `path`, `crypto` (le module Node — `globalThis.crypto` est portable), `child_process`, …
- Paquets bâtis dessus : `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bogues latents sur tout runtime** — à corriger de toute façon :

- `process.env` lu au niveau du module (voir [Configuration et Secrets](#configuration-et-secrets))
- Promesses flottantes au lieu de [`waitUntil`](#travail-en-arrière-plan)
- Compter sur un gestionnaire qui continuerait de s'exécuter après l'expiration de sa requête. Sous Node c'est le cas ; c'est une propriété du processus, pas une promesse du framework

### Vérifier vos propres fonctions

`rebase build` imprime une ligne par constat exploitable et consigne le verdict par fonction dans le manifeste du bundle :

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` signale la même chose sans compiler.

### Si vous avez besoin d'un chemin propre au runtime

`runtimeKey()` renvoie `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` ou `"other"` ; `isNodeRuntime()` est la vérification courante. Utilisez-les pour dégrader, non pour bifurquer une implémentation — une fonction qui a besoin de deux implémentations, ce sont deux fonctions.

```typescript
import { defineFunction, isNodeRuntime } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/stats", async (c) => {
        if (!isNodeRuntime()) return c.json({ error: "Not available here" }, 501);
        const rows = await rebase.sql("SELECT count(*) AS total FROM jobs");
        return c.json({ totalJobs: Number(rows[0]?.total ?? 0) });
    });
});
```

## Ordre d'Enregistrement des Routes

Les fonctions personnalisées sont chargées et montées **après** que `initializeRebaseBackend()` a terminé la configuration principale. L'ordre d'initialisation est :

1. **Bootstrappers** — connexions à la base de données, tables d'authentification, services temps réel
2. **Routes d'authentification** — `/api/auth/*`, `/api/admin/*`
3. **Routes de stockage** — `/api/storage/*`
4. **Routes de données** — `/api/data/*` (CRUD des collections)
5. **Fonctions personnalisées** ← `/api/functions/*`
6. **Tâches cron** — `/api/cron/*`
7. **WebSocket** — abonnements temps réel

Vos fonctions personnalisées ont donc accès à tous les services initialisés. Enregistrez les routes qui doivent s'exécuter **avant** Rebase directement sur l'application Hono, avant d'appeler `initializeRebaseBackend()` :

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Les routes que vous ajoutez ainsi à votre propre application sont **en dehors** de tous les routeurs Rebase : aucun middleware d'authentification ne s'y est exécuté, et `getDriver(c)` n'est pas défini. Protégez-les avec `requireAuth` / `requireAdmin` importés depuis **`@rebasepro/server`** — la racine du paquet — qui vérifient le jeton eux-mêmes. Les gardes du sous-chemin `/functions` lisent une identité qu'un routeur Rebase a déjà résolue, et répondront 500 plutôt que d'en inventer une.
:::

## Exemple : Gestionnaire de Webhook

```typescript
import { defineFunction, requireEnv, waitUntil, lazyResource } from "@rebasepro/server/functions";

/** Constructed on the first request, from that request's configuration. */
const secret = lazyResource((env) => env.STRIPE_WEBHOOK_SECRET ?? "");

export default defineFunction((app, { rebase }) => {
    // Deliberately public: Stripe has no token to send. The signature is the
    // authentication, so verify it before doing anything else.
    app.post("/", async (c) => {
        const signature = c.req.header("stripe-signature");
        const body = await c.req.text();

        if (!signature || !verifySignature(body, signature, secret(c))) {
            return c.json({ error: "Bad signature" }, 400);
        }

        const event = JSON.parse(body) as { type: string; data: { object: Record<string, string> } };

        if (event.type === "checkout.session.completed") {
            const session = event.data.object;
            await rebase.dataAsAdmin.collection("subscriptions").create({
                user_id: session.client_reference_id,
                stripe_id: session.subscription,
                status: "active",
            });
            // Fulfilment can outlive the response; the 200 tells Stripe to stop retrying.
            waitUntil(c, notifyFulfilment(requireEnv(c, "FULFILMENT_URL"), session));
        }

        return c.json({ received: true });
    });
});

declare function verifySignature(body: string, signature: string, secret: string): boolean;
declare function notifyFulfilment(url: string, session: Record<string, string>): Promise<void>;
```

## Débogage

Lorsqu'une fonction se charge correctement, vous verrez :

```
⚡ Loaded function route: hello
```

Si le chargement échoue, le chargeur fournit un diagnostic :

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
```

Le routeur est monté pour le **répertoire**, non pour les fonctions qu'il contient. Si tous les fichiers échouent à l'import — une seule variable d'environnement manquante au niveau du module suffit à tous les faire tomber — `GET /api/functions` répond toujours `200` avec une liste vide et un compteur `skipped`, de sorte que « rien n'a été chargé » se distingue de « cette compilation ne contenait aucune fonction ». Les raisons restent dans le journal de démarrage.

## Délais d'Attente et Limites de Débit

Deux plafonds s'appliquent à `/api/functions/*` :

- **Délai d'attente de la requête** — 30 secondes par défaut, réponse `504` avec le code `FUNCTION_TIMEOUT`. Configurable via `functionsTimeoutMs` (ou `REBASE_FUNCTIONS_TIMEOUT_MS`) ; `0` le désactive. Le gestionnaire ne peut pas être annulé de l'extérieur : donnez donc un `AbortSignal` aux appels HTTP sortants — le délai libère le client et la socket, pas le travail. Que le gestionnaire *continue de s'exécuter* après le 504 est une propriété d'un processus Node de longue durée, non une garantie du contrat ; tout ce qui doit aboutir relève de [`waitUntil`](#travail-en-arrière-plan).
- **Limite de débit** — les appelants avec clé d'API et ceux qui sont authentifiés partagent les compartiments de l'API de données. Les appelants anonymes disposent de leur propre allocation, bien plus large (3000 par fenêtre), car ce routeur est public par défaut pour les récepteurs de webhooks. Redéfinissez-la avec `rateLimit.anonymousFunctions` ; `null` la désactive.

Les rejets de promesses non gérés sont journalisés plutôt que fatals : un appel sans attente dans une fonction mettrait sinon fin au processus entier. Définissez `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` pour le comportement par défaut de Node.

## Étapes Suivantes

- **[Vue d'ensemble du Backend](/docs/backend)** — Référence complète de la configuration backend
- **[Rappels d'Entité](/docs/collections/callbacks)** — Exécuter de la logique lors des changements de données
- **[Tâches Cron](/docs/backend/cron-jobs)** — Tâches de fond planifiées
