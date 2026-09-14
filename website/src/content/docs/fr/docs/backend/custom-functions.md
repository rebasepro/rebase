---
sourceHash: 65910bc3708c9f5d
title: Fonctions personnalisées
sidebar_label: Fonctions personnalisées
description: Ajoutez des points de terminaison d'API Hono personnalisés aux côtés de vos routes CRUD Rebase. Découverte automatique à partir d'un répertoire, avec un accès complet à l'instance backend.
---

## Vue d'ensemble

Les fonctions personnalisées vous permettent d'ajouter des **routes d'API Hono arbitraires** aux côtés des points de terminaison CRUD générés automatiquement par Rebase. Elles suivent le même modèle de **découverte basée sur les fichiers** que les collections et les tâches cron : déposez un fichier TypeScript dans votre répertoire `functions/`, et Rebase le monte automatiquement.

Utilisez les fonctions personnalisées pour :

- **Les points de terminaison de logique métier** — validations, promotions, flux de travail personnalisés
- **Les intégrations tierces** — webhooks Stripe, commandes Slack, proxys d'API externes
- **Les points de terminaison publics** — formulaires de contact, capture de prospects, vérifications de l'état du système (health checks)
- **Les requêtes d'agrégation** — statistiques de tableau de bord, rapports, analyses

## Définir une fonction personnalisée

Créez un fichier dans votre répertoire `backend/functions/` qui exporte par défaut une application Hono :

```typescript
// backend/functions/hello.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post("/", async (c) => {
        const { name } = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
        return c.json({ message: `Hello, ${name ?? "world"}!` });
    });
});
```

Ceci est monté sur **`/api/functions/hello`**. Le nom du fichier (sans extension) devient le préfixe de la route.

`POST`, car c'est ce que le SDK envoie par défaut — voir
[Appeler depuis le client](#appeler-depuis-le-client). Une route `GET` est tout aussi
valide ; l'appelant doit alors spécifier `{ method: "GET" }`.

`rebase dev` surveille le répertoire des fonctions, ainsi un fichier ajouté pendant son
exécution est monté au rechargement suivant — sans redémarrage. (Il doit en être
informé : le répertoire est analysé plutôt qu'importé, le surveillant ne peut donc pas le déduire.)

## Appeler depuis le client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` construit l'URL, attache le jeton de l'appelant et lève une
`RebaseApiError` en cas de réponse non-2xx — ainsi, le format d'erreur propre à la fonction
parvient à l'appelant au lieu d'un simple rejet de `fetch`.

Trois éléments qu'il accepte en plus du nom :

```typescript
// A different method. The payload is dropped for GET, since GET has no body.
await client.functions.invoke("hello", undefined, { method: "GET" });

// A sub-path — `/api/functions/hello/stats`. It goes here, never in the name:
// a name containing "/" is refused rather than percent-encoded into a 404.
await client.functions.invoke("hello", undefined, { method: "GET", path: "stats" });

// A query string. Passed as `path`, with no separator inserted before `?`.
await client.functions.invoke("reports", undefined, { method: "GET", path: "?days=30" });
```

:::note
`client.call("functions/hello", …)` permet également d'atteindre une fonction, et fait quelque
chose de subtilement différent : il désencapsule `res.data` lorsque la réponse en contient un. Avoir deux
façons d'accéder avec deux contrats de réponse est un piège — utilisez `functions.invoke`. `call` existe
pour les routes montées en dehors de `/api/functions`, ce que `invoke` ne peut pas exprimer.
:::

:::important
Importez depuis **`@rebasepro/server/functions`**, et non depuis `@rebasepro/server`.

Les deux fonctionnent. Le sous-chemin est la surface de développement *portable* : il n'importe rien qui nécessite Node, ainsi une fonction écrite avec celui-ci peut s'exécuter sur n'importe quel environnement d'exécution JavaScript. La racine du package accède à l'ensemble du framework — la séquence de démarrage, les chargeurs de fichiers, la couche WebSocket — ce qui est approprié pour un point d'entrée de serveur et bien plus que ce dont un gestionnaire de route a besoin. Il vous offre également des accesseurs de contexte typés (`getUser`, `getDriver`) au lieu de transtyper manuellement `c.get("user")`.

Voir [Portabilité du runtime](#portabilité-du-runtime) pour le contrat complet.
:::

## Configuration

:::note[Où placer ceci]
**Runtime managé :** rien à configurer — le runtime découvre `backend/functions/` par lui-même (`entry.functions` dans `rebase.json` si vous l'avez déplacé). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` restreignent celles qu'un processus dessert.
**Éjecté :** `initializeRebaseBackend({ functionsDir })` dans `backend/src/index.ts`.
:::

Activez les fonctions personnalisées en ajoutant `functionsDir` à votre configuration backend :

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase va :

1. Analyser le répertoire à la recherche de fichiers `.ts` / `.js`
2. Valider que chaque export par défaut est une application Hono (duck-typée via `.fetch()` + `.routes`)
3. Monter chaque application sur `/api/functions/<filename>`
4. Appliquer le middleware d'authentification (voir [Authentification](#authentification-et-propagation-du-contexte) ci-dessous)

## Nommage des fichiers et mappage des routes

| Fichier | Chemin de montage |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Les fonctions sont découvertes au **premier niveau du répertoire uniquement** — il n'y a pas de récursion. `functions/admin/users.ts` est compilé par `rebase build` mais n'est jamais monté ; aplatissez plutôt le nom (`functions/admin-users.ts`). Un sous-répertoire est signalé au démarrage et comptabilisé sur le point de terminaison de listage plutôt que d'être ignoré silencieusement.

Fichiers qui sont **ignorés** :

- `index.ts` / `index.js` — réservés
- `*.test.ts` / `*.test.js` — fichiers de test
- `*.d.ts` — déclarations de types
- Les sous-répertoires et les fichiers `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — signalés comme des problèmes, car le build compile plus de fichiers que le runtime n'en charge

Le nom constitue également l'identité de la fonction partout ailleurs : c'est le segment d'URL, la permission de clé d'API `functions/<name>`, et la valeur selon laquelle `REBASE_FUNCTIONS_ONLY` filtre lorsque vous dédiez un processus à une fonction spécifique.

## Formats d'export

Le chargeur accepte deux formats d'export en plus de `defineFunction` :

### Application Hono

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

const app = new Hono<HonoEnv>();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Fonction Factory

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

`defineFunction` retourne exactement l'application Hono que ces approches construisent manuellement, les trois sont donc interchangeables. Cela vous évite de déclarer `Hono<HonoEnv>` et vous fournit le singleton `rebase` dans le callback.

---

## Sous le capot : le chargeur par Duck-Typing

Lors de la compilation de bases de code avec plusieurs répertoires imbriqués ou dans des monorepos, vous pouvez rencontrer une **duplication du package Hono**.

Si le framework Rebase dépend d'une version de Hono et que votre répertoire de fonctions local en résout une autre, les vérifications d'héritage de classe standard (`exported instanceof Hono`) échoueront car leurs prototypes résident dans des espaces mémoire distincts.

Pour éviter les faux négatifs et ne pas rejeter le chargement de routeurs fonctionnels, Rebase utilise un validateur duck-typé (`isHonoLike`) :
- Il vérifie que l'objet exporté est un `object` non nul.
- Il s'assure que l'objet expose une méthode `.fetch` (requise pour router les requêtes).
- Il vérifie que `.routes` est un tableau (`array`).

```typescript no-verify
function isHonoLike(obj: unknown): boolean {
    if (!obj || typeof obj !== "object") return false;
    const record = obj as Record<string, unknown>;
    return typeof record.fetch === "function" && Array.isArray(record.routes);
}
```

### Échappement du compilateur pour les modules ES

Pour importer dynamiquement des fichiers TypeScript et JavaScript sous Windows comme sous les systèmes Posix, le chargeur convertit les chemins de fichiers en URI de fichiers standards via `pathToFileURL(filePath).href`.

Pour empêcher la compilation TypeScript de réécrire les imports dynamiques ESM natifs (`import(url)`) en appels CommonJS `require()` (ce qui provoquerait des erreurs à l'exécution sous les runtimes ESM), Rebase effectue un échappement de compilateur à l'exécution :

```typescript no-verify
const dynamicImport = new Function("url", "return import(url)");
const mod = await dynamicImport(fileUrl);
```

---

## Authentification et propagation du contexte

Les fonctions personnalisées sont montées avec le **même middleware d'authentification** que les routes de données, mais avec `requireAuth: false`. Cela signifie que :

- Le JWT de l'utilisateur est **analysé et injecté** dans le contexte s'il est présent
- Mais les requêtes ne sont **pas rejetées** si aucun JWT n'est fourni
- Vous devez **protéger explicitement** les routes qui nécessitent une authentification

Un appelant qui présente un *mauvais* jeton n'atteint jamais votre gestionnaire : un jeton invérifiable ou expiré est rejeté avec une erreur 401 par le middleware lui-même, de sorte qu'une session expirée n'est jamais silencieusement rétrogradée en session anonyme.

### Lecture de l'appelant

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

`getUser` renvoie un objet restreint : `uid` est une chaîne et `roles` est toujours un tableau, quelle que soit la méthode d'authentification utilisée par l'appelant. `getUserId(c)` et `getRoles(c)` sont des raccourcis.

### Protection des routes

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

Placez les gardes dans **l'emplacement middleware propre à la route**, comme ci-dessus, plutôt que d'utiliser `app.use("/*", requireAuth)`. `use()` ne couvre que les routes déclarées *en dessous* de lui, donc une route ajoutée plus tard — au bas du fichier, dans plusieurs mois — serait silencieusement non protégée.

:::important
Lire `getUser(c)` ne constitue **pas** une garde. Un appelant anonyme reçoit `undefined` et votre gestionnaire s'exécute quand même. Seule une garde, ou un `if (!user) return 401` explicite, interrompt la requête.
:::

### Authentification par clé de service

Rebase prend en charge une clé statique `REBASE_SERVICE_KEY` définie dans votre `.env` pour les scripts ou les appels de serveur à serveur.

Lorsqu'une requête externe transmet la clé de service via l'en-tête Authorization (`Authorization: Bearer <service_key>`), le middleware d'authentification effectue automatiquement ce qui suit :
1. Il valide la clé en utilisant une comparaison en temps constant pour éviter les attaques temporelles.
2. Il accorde un accès de niveau administrateur, définissant l'appelant comme `{ uid: "service", roles: ["admin"] }`.
3. Il injecte un `DataDriver` restreint à cette même identité de service. La sécurité au niveau des lignes (Row-Level Security) s'applique toujours — elle est évaluée en tant que `{ uid: "service", roles: ["admin"] }`, elle n'est pas ignorée.

### Auto-authentification interne

Si vous n'avez pas configuré de `REBASE_SERVICE_KEY`, Rebase génère une **clé interne aléatoire par démarrage**. Le singleton `rebase` utilise cette clé automatiquement lors de l'appel aux API du plan de contrôle du serveur lui-même (comme `rebase.auth` ou `rebase.storage`). Cela signifie que votre logique côté serveur peut toujours effectuer des tâches administratives, même sans clé de service configurée manuellement.

## Accès à la base de données et aux services

### 1. Le driver limité à l'utilisateur — pour tout ce qui répond à une requête

`getDriver(c)` retourne le driver **restreint à l'appelant**, afin que chaque lecture et écriture soit évaluée par rapport à vos stratégies de Row-Level Security en tant que cet utilisateur :

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

`requireDriver(c)` est identique à `getDriver(c)` sans le `!` — il lève une erreur nommant le problème d'intégration au lieu d'échouer vingt lignes plus tard sur `undefined`.

### 2. `rebase.dataAsAdmin` — pour les tâches de fond de confiance

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

### Driver restreint par RLS vs Singleton Rebase

|                     | `getDriver(c)` (restreint à la requête)        | `rebase.dataAsAdmin` (identité de service)                       |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **S'exécute en tant que** | L'appelant (`uid`, ses rôles)            | `{ uid: "service", roles: ["admin"] }`                            |
| **Application de la RLS** | ✅ Oui (évaluée par rapport à l'appelant)     | ✅ Oui (évaluée par rapport à l'identité de service)              |
| **Idéal pour...**    | Opérations CRUD utilisateur, recherche, requêtes | Tâches de fond, déclencheurs système, webhooks                   |
| **Style d'API**       | Méthodes au niveau du driver (`fetchCollection`, `save`) | Accesseurs de collection fluides (`rebase.dataAsAdmin.jobs.find`) |

#### Ce qu'est précisément `dataAsAdmin`

`rebase.dataAsAdmin` est **restreint au rôle admin, il ne contourne pas la RLS**. Le driver est initialisé une seule fois, au démarrage, avec `withAuth({ uid: "service", roles: ["admin"] })`, de sorte que chaque lecture et écriture s'exécute dans une transaction ayant basculé sur le rôle restreint `rebase_user` avec `app.uid = 'service'`. Vos stratégies sont évaluées — par rapport à cette identité.

Pour la plupart des projets, la distinction n'apparaît jamais, car les stratégies par défaut que Rebase injecte sur chaque collection autorisent `serverContext() OR rolesOverlap(['admin'])`, et l'identité de service valide la seconde condition. Cela se remarque dès l'instant où vous écrivez vos propres stratégies :

- **`policy.serverContext()` est faux pour lui.** Cet utilitaire se compile en `rebase.uid() IS NULL`, et le `uid` de cet accesseur est `'service'`. Une collection avec `disableDefaultPolicies: true` dont la seule règle d'écriture est `serverContext()` refusera une écriture `dataAsAdmin` avec l'erreur Postgres `42501`, et une lecture sur une telle collection retourne **zéro ligne avec un code HTTP 200** — le cas silencieux. Écrivez `rolesOverlap(["admin"])` (ou ajoutez-le en parallèle) lorsque vous voulez dire « mon backend ».
- **Sa portée est égale à la portée d'un utilisateur `admin`.** Attribuer le rôle `admin` à un utilisateur de l'application lui accorde exactement les lignes que cet accesseur voit. Ce n'est pas un canal privé.

### 3. `rebase.sql()` — SQL brut, et le seul accesseur réservé à Node

Si vous avez véritablement besoin d'un contournement inconditionnel, `rebase.sql()` est fait pour cela : du SQL brut sur la connexion propriétaire, sans stratégies, pour chaque ligne. C'est l'élément le plus privilégié dans le contexte d'une fonction — bien plus que l'accesseur comportant « admin » dans son nom.

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

Il s'exécute sur une connexion TCP à votre base de données, ce qui en fait le seul accesseur lié à un processus Node. Cela n'a aucun coût sur les déploiements actuels — c'est simplement la seule chose à savoir si une fonction doit être déplacée ultérieurement. Voir [Portabilité du runtime](#portabilité-du-runtime).

:::caution[L'accès direct à Drizzle est réservé à Node]
Vous pouvez également importer votre propre instance Drizzle et la requêter directement (`db.execute(sql\`…\`)`). Cela fonctionne, et sur un déploiement Node auto-hébergé ou managé, cela ne pose aucun problème.

Il convient de mesurer ce que cela implique : une fonction qui importe `drizzle-orm` et un pool `pg` est définitivement une fonction Node, elle contourne les callbacks et la validation de votre collection, et elle obtient sa connexion d'ailleurs que de la requête. `rebase.sql()` vous offre le même SQL brut via la propre connexion du framework. Privilégiez cette approche.
:::

## Configuration et secrets

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

Pourquoi cela a de l'importance sur **n'importe quel** runtime, y compris Node :

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Une lecture au niveau du module est évaluée lors de l'import du fichier, avant même qu'une requête n'existe. Sur Node, cela signifie qu'une seule variable manquante fait échouer tout le fichier et toutes les routes qu'il contient. Sur un hébergeur qui attache la configuration à la requête plutôt qu'au processus, il n'y a absolument rien à lire au moment de l'import.

- `getEnv(c)` — chaque variable visible pour cette requête
- `env(c, "NAME")` — une variable, nettoyée des espaces ; une valeur vide est considérée comme non définie
- `requireEnv(c, "NAME")` — identique, mais lève une erreur précisant le nom de la variable
- `lazyResource(factory)` — instancie un client lourd une seule fois, lors de la première utilisation

`rebase doctor` signale les lectures de `process.env` au niveau du module dans votre répertoire de fonctions.

## Tâches en arrière-plan

Le travail qui doit survivre à la réponse doit être placé dans `waitUntil` :

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

Une promesse non attendue semble équivalente mais ne l'est pas. `waitUntil` apporte deux avantages :

- **Sur Node**, la promesse est suivie, de sorte qu'un arrêt gracieux l'attend au lieu que le processus ne s'arrête en plein milieu d'un webhook en cours d'envoi. Une promesse en suspens lors d'un `SIGTERM` est simplement perdue.
- **Sur un hébergeur basé sur des isolates**, l'hôte reçoit l'instruction de maintenir l'isolate en vie jusqu'à ce que la promesse soit résolue. Sans cela, le travail est abandonné dès que la réponse se termine — silencieusement, avec un statut 200 impeccable dans les logs.

Un rejet de promesse est consigné dans les logs plutôt que laissé au gestionnaire de rejets non gérés, de sorte qu'une panne mentionne la route d'où elle provient.

## Portabilité du runtime

Une fonction personnalisée est une application Hono, et Hono s'exécute sur tous les runtimes serveur JavaScript. La capacité de *votre* fonction à s'exécuter ailleurs que sur un processus Node dépend donc de ce que son propre fichier importe et manipule.

Rien ici ne restreint ce que vous pouvez écrire aujourd'hui. Chaque déploiement Rebase est un processus Node, une fonction qui lit un fichier ou ouvre un socket est tout à fait valable, et aucun build ni déploiement n'échouera à cause de cela. Cela est documenté ici pour que la réponse soit connue dès maintenant plutôt que découverte fichier par fichier plus tard.

**Portable — fonctionne sur tous les runtimes :**

- Tout ce qui est exporté depuis `@rebasepro/server/functions`
- `getDriver(c)` et `rebase.dataAsAdmin` — les deux utilisent le même protocole réseau quel que soit l'endroit où ils s'exécutent
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — la plateforme web
- Toute dépendance qui ne requiert pas Node

**Réservé à Node :**

- `rebase.sql()` — la connexion propriétaire à la base de données est un socket TCP
- Un client Drizzle/`pg`/`mongodb` importé directement, pour la même raison
- Les modules natifs de Node : `fs`, `path`, `crypto` (le module Node — `globalThis.crypto` est portable), `child_process`, …
- Les packages basés sur ceux-ci : `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bugs latents sur tous les runtimes** — il est conseillé de les corriger dans tous les cas :

- Lecture de `process.env` au niveau du module (voir [Configuration et secrets](#configuration-et-secrets))
- Promesses de type « fire-and-forget » au lieu de [`waitUntil`](#tâches-en-arrière-plan)
- Dépendre du fait qu'un gestionnaire continue à s'exécuter après l'expiration du délai d'attente de sa requête. Sur Node, il le fait ; c'est une caractéristique du processus, pas une garantie offerte par le framework

### Vérifier vos propres fonctions

`rebase build` affiche une ligne par constat exploitable et consigne le verdict pour chaque fonction dans le manifeste du bundle :

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` fournit le même rapport sans compiler.

### Si vous avez besoin d'un embranchement spécifique à un runtime

`runtimeKey()` retourne `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` ou `"other"` ; `isNodeRuntime()` est la vérification courante. Utilisez-les pour dégrader gracieusement, pas pour dédoubler une implémentation — une fonction qui nécessite deux implémentations représente deux fonctions.

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

## Ordre d'enregistrement des routes

Les fonctions personnalisées sont chargées et montées **après** que `initializeRebaseBackend()` a terminé la configuration principale. L'ordre d'initialisation est le suivant :

1. **Initialisateurs (Bootstrappers)** — Connexions à la base de données, tables d'authentification, services temps réel
2. **Routes d'authentification** — `/api/auth/*`, `/api/admin/*`
3. **Routes de stockage** — `/api/storage/*`
4. **Routes de données** — `/api/data/*` (CRUD pour les collections)
5. **Fonctions personnalisées** ← `/api/functions/*`
6. **Tâches cron** — `/api/cron/*`
7. **WebSocket** — Abonnements temps réel

Cela signifie que vos fonctions personnalisées ont accès à tous les services initialisés. Enregistrez toutes les routes qui doivent s'exécuter **avant** Rebase directement sur l'application Hono, avant d'appeler `initializeRebaseBackend()` :

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Les routes que vous ajoutez à votre propre application de cette manière se trouvent **en dehors** de chaque routeur Rebase, aucun middleware d'authentification ne s'est donc exécuté sur elles et `getDriver(c)` n'est pas défini. Protégez-les avec `requireAuth` / `requireAdmin` importés depuis **`@rebasepro/server`** — la racine du package — qui vérifient le jeton par eux-mêmes. Les gardes du sous-chemin `/functions` lisent une identité qu'un routeur Rebase a déjà résolue, et répondront avec une erreur 500 plutôt que de feindre qu'elle existe.
:::

## Exemple : Gestionnaire de webhook

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

Le routeur est monté pour le **répertoire**, et non pour les fonctions qu'il contient. Si l'importation de chaque fichier échoue — une seule variable d'environnement manquante au niveau du module suffit à faire échouer l'ensemble —, `GET /api/functions` répond toujours `200` avec une liste vide ainsi qu'un décompte de fonctions `skipped`, de sorte que « rien n'a été chargé » est différenciable de « ce build n'a fourni aucune fonction ». La liste elle-même nécessite un appelant connecté, une clé d'API ou la clé de service — les fonctions restent appelables par quiconque chacune d'entre elles autorise, mais leur inventaire n'est pas public. Les motifs d'échec restent indiqués dans le journal de démarrage.

## Délais d'expiration et limites de débit

Deux plafonds s'appliquent à `/api/functions/*` :

- **Délai d'expiration de la requête (timeout)** — 30 secondes par défaut, renvoyant un code `504` avec le code `FUNCTION_TIMEOUT`. Se configure via `functionsTimeoutMs` (ou `REBASE_FUNCTIONS_TIMEOUT_MS`) ; `0` le désactive. Le gestionnaire ne peut pas être annulé depuis l'extérieur, fournissez donc un `AbortSignal` aux appels HTTP sortants — le timeout libère le client et le socket, pas le travail en cours. Le fait que le gestionnaire *continue de s'exécuter* après l'erreur 504 est une propriété inhérente à un processus Node de longue durée, et non une garantie contractuelle ; tout ce qui doit impérativement aller à son terme doit être placé dans [`waitUntil`](#tâches-en-arrière-plan).
- **Limite de débit (rate limit)** — Les appelants avec clé d'API et les appelants connectés partagent les quotas de l'API de données. Les appelants anonymes disposent de leur propre quota, bien plus large (3000 par fenêtre), car ce routeur est public par défaut pour les récepteurs de webhooks. Modifiez cela avec `rateLimit.anonymousFunctions` ; `null` le désactive.

Les rejets de promesses non gérés sont consignés dans les logs plutôt que fatals : un appel non attendu (fire-and-forget) dans une fonction interromprait sinon l'intégralité du processus. Définissez `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` pour rétablir le comportement par défaut de Node.

## Prochaines étapes

- **[Vue d'ensemble du backend](/docs/backend)** — Référence complète de la configuration du backend
- **[Callbacks d'entités](/docs/collections/callbacks)** — Exécuter de la logique lors des modifications de données
- **[Tâches cron](/docs/backend/cron-jobs)** — Tâches d'arrière-plan planifiées
