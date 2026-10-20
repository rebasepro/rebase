---
sourceHash: 9eaa953076c5923b
title: Fonctions personnalisées
sidebar_label: Fonctions personnalisées
description: Ajoutez des points de terminaison d'API Hono personnalisés aux côtés de vos routes CRUD Rebase. Découverte automatique à partir d'un répertoire, avec un accès complet à l'instance backend.
---

## Vue d'ensemble

Les fonctions personnalisées vous permettent d'ajouter des **routes d'API Hono arbitraires** aux côtés des points de terminaison CRUD générés automatiquement par Rebase. Elles suivent le même modèle de **découverte basée sur les fichiers** que les collections et les tâches cron : déposez un fichier TypeScript dans votre répertoire `functions/`, et Rebase le monte automatiquement.

Utilisez les fonctions personnalisées pour :

- **Les points de terminaison de logique métier** — approbations, promotions, flux de travail personnalisés
- **Les intégrations tierces** — webhooks Stripe, commandes Slack, proxys d'API externes
- **Les points de terminaison publics** — formulaires de contact, capture de leads, health checks
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

Elle est montée sur **`/api/functions/hello`**. Le nom du fichier (sans extension) devient le préfixe de la route.

`POST`, car c'est ce que le SDK envoie par défaut — voir
[Invoquer depuis le client](#invoquer-depuis-le-client). Une route `GET` est tout
aussi valide ; l'appelant doit alors spécifier `{ method: "GET" }`.

`rebase dev` surveille le répertoire des fonctions, de sorte qu'un fichier ajouté pendant
son exécution est monté au rechargement suivant — sans redémarrage. (Il doit en être informé : le
répertoire est scanné plutôt qu'importé, le watcher ne peut donc pas le déduire).

## Invoquer depuis le client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` construit l'URL, attache le jeton de l'appelant et lève une
`RebaseApiError` en cas de code non-2xx — ainsi, le format d'erreur propre à la
fonction parvient à l'appelant au lieu d'un simple rejet de `fetch`.

Quatre paramètres supplémentaires pris en charge au-delà du nom :

```typescript
// A different method. The payload is dropped for GET, since GET has no body.
await client.functions.invoke("hello", undefined, { method: "GET" });

// A sub-path — `/api/functions/hello/stats`. It goes here, never in the name:
// a name containing "/" is refused rather than percent-encoded into a 404.
await client.functions.invoke("hello", undefined, { method: "GET", path: "stats" });

// A query string. Passed as `path`, with no separator inserted before `?`.
await client.functions.invoke("reports", undefined, { method: "GET", path: "?days=30" });

// A function that answers text or a file (`c.text(csv)`, `c.body(pdf)`).
// The answer is read as JSON unless you say otherwise: "text" gives a string,
// "blob" a Blob, "response" the Response itself with its body unread.
const csv = await client.functions.invoke<string>("export-orders", undefined, { method: "GET", responseType: "text" });
```

:::note
`client.call("functions/hello", payload)` permet également d'atteindre une fonction. Elle effectue
toujours un `POST` et, comme `invoke`, elle renvoie le corps textuellement — aucune des deux n'extrait
une clé `data`. Privilégiez `functions.invoke`, qui accepte une méthode, un sous-chemin et un
`responseType` ; `call` existe pour les routes montées en dehors de `/api/functions`, ce que
`invoke` ne peut pas exprimer.
:::

:::important
Importez depuis **`@rebasepro/server/functions`**, et non depuis `@rebasepro/server`.

Les deux fonctionnent. Le sous-chemin représente la surface d'écriture *portable* : il n'importe rien qui nécessite Node, de sorte qu'une fonction écrite avec celui-ci peut s'exécuter sur n'importe quel environnement d'exécution JavaScript. La racine du package accède à l'ensemble du framework — la séquence d'amorçage, les chargeurs de fichiers, la couche WebSocket — ce qui convient pour un point d'entrée de serveur, mais dépasse les besoins d'un gestionnaire de route. Elle vous fournit également des accesseurs de contexte typés (`getUser`, `getDriver`) au lieu de transtyper manuellement `c.get("user")`.

Voir [Portabilité du runtime](#portabilité-du-runtime) pour le contrat complet.
:::

## Configuration

:::note[Où cela se configure]
**Runtime managé :** rien à configurer — le runtime découvre `backend/functions/` de lui-même (`functions` dans l'entrée `rebase.json` de l'application backend si vous l'avez déplacé). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` restreignent celles qu'un processus dessert.
**Éjecté :** `initializeRebaseBackend({ functionsDir })`, ou `functions` (ci-dessous), dans `backend/src/index.ts`.
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

1. Scanner le répertoire à la recherche de fichiers `.ts` / `.js`
2. Valider que chaque export par défaut est une application Hono (vérification duck-typing via `.fetch()` + `.routes`)
3. Monter chaque application sur `/api/functions/<filename>`
4. Appliquer le middleware d'authentification (voir [Authentification](#authentification-et-propagation-du-contexte) ci-dessous)

### Fonctions sous forme de valeurs

Sur la version 0.24, les fonctions proviennent uniquement d'un répertoire.

Un répertoire n'est qu'une des manières de produire ce que le serveur dessert : un enregistrement associant un segment d'URL à une application Hono. Passez vous-même cet enregistrement via `functions`, ou lisez un répertoire pour le construire avec `loadFunctions` :

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Fournissez `functions` ou `functionsDir`, mais pas les deux : le processus d'amorçage refusera l'association des deux. `loadFunctions(dir, { onSkip })` vous transmet chaque fichier ignoré, accompagné de la raison. `loadFunctionsFromDirectory` et `loadFunctionsWithDiagnostics` fonctionnent toujours, sont dépréciés et émettent un avertissement unique. Isolément, le groupe de fonctions se monte sur n'importe quel chemin avec `app.route("/hooks", backend.routes.functions())`, et `getUser(c)` ainsi que `getDriver(c)` fonctionnent à l'intérieur ; voir [Intégration d'un serveur personnalisé](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Nommage des fichiers et mappage des routes

| Fichier | Chemin de montage |
|---------|-------------------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Les fonctions sont découvertes **au premier niveau du répertoire uniquement** — il n'y a pas de récursivité. `functions/admin/users.ts` est compilé par `rebase build` mais jamais monté ; aplatissez le nom à la place (`functions/admin-users.ts`). Un sous-répertoire est signalé au démarrage et comptabilisé sur le point de terminaison de listage plutôt que d'être ignoré silencieusement.

Fichiers qui sont **ignorés** :

- `index.ts` / `index.js` — réservés
- `*.test.ts` / `*.test.js` — fichiers de test
- `*.d.ts` — déclarations de types
- Sous-répertoires, et fichiers `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — signalés comme des problèmes, car le build compile plus de formats que le runtime n'en charge

Le nom constitue également l'identité de la fonction partout ailleurs : c'est le segment d'URL, la cible de la portée `functions:invoke:<name>` dont une clé a besoin pour l'appeler, et la valeur sur laquelle `REBASE_FUNCTIONS_ONLY` filtre lorsque vous attribuez à une fonction son propre processus.

## Formats d'exportation

Le chargeur accepte deux formats d'exportation en plus de `defineFunction` :

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

`defineFunction` renvoie exactement l'application Hono que ces approches construisent manuellement, les trois sont donc interchangeables. Elle vous évite de déclarer `Hono<HonoEnv>` et vous transmet le singleton `rebase` dans le callback.

---

## Sous le capot : le chargeur à typage structurel (Duck-Typing)

Dans un monorepo, vos fonctions peuvent résoudre une copie de Hono différente de celle utilisée par Rebase, et dans ce cas `exported instanceof Hono` sera faux pour un routeur pourtant parfaitement fonctionnel. Le chargeur vérifie donc plutôt la forme de l'objet (`isHonoLike`) : un objet non nul avec une méthode `.fetch` et un tableau `.routes`.

### Échappement du compilateur de modules ES

Le chargeur transforme chaque chemin de fichier en une URL de fichier (`pathToFileURL(filePath).href`), afin de pouvoir l'importer aussi bien sous Windows que sous POSIX, et appelle `import(url)` via `new Function("url", "return import(url)")`, empêchant ainsi une compilation TypeScript de le réécrire en un `require()` qui échouerait sous ESM.

---

## Authentification et propagation du contexte

Les fonctions personnalisées sont montées avec le **même middleware d'authentification** que les routes de données, mais avec `requireAuth: false`. Cela signifie :

- Le JWT de l'utilisateur est **analysé et injecté** dans le contexte s'il est présent
- Mais les requêtes ne sont **pas rejetées** si aucun JWT n'est fourni
- Vous devez **protéger explicitement** les routes nécessitant une authentification

Un appelant qui présente un *mauvais* jeton n'atteint jamais votre gestionnaire : un jeton invérifiable ou expiré est rejeté avec une erreur 401 par le middleware lui-même, de sorte qu'une session expirée n'est jamais rétrogradée silencieusement en session anonyme.

### Lire l'appelant

```typescript
import { defineFunction, getUser, getUserId, getRoles, getScopes, isAdmin } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/me", (c) => {
        const user = getUser(c);          // { uid, roles, ...claims } | undefined
        if (!user) return c.json({ error: "Unauthorized" }, 401);
        return c.json({ uid: user.uid, roles: user.roles, admin: isAdmin(c), scopes: getScopes(c) });
    });
});
```

`getUser` renvoie un objet restreint : `uid` est une chaîne de caractères et `roles` est toujours un tableau, quelle que soit la méthode d'authentification utilisée par l'appelant. `getUserId(c)` et `getRoles(c)` sont des raccourcis. `getScopes(c)` contient tout ce que l'appelant est autorisé à faire, sous forme de chaînes de [portée (scope)](/docs/backend/roles-and-scopes/) : pour un utilisateur, le plan de données, les portées propres à l'application et les portées de ses rôles ; pour une clé d'API, exactement ce que la clé détient.

### Protéger les routes

```typescript
import { defineFunction, requireAuth, requireAdmin, requireRole, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // Public endpoint — no guard, so anyone can call it.
    app.get("/public", (c) => c.json({ message: "Anyone can access this" }));

    // 401 for anonymous callers.
    app.post("/protected", requireAuth, (c) => c.json({ message: `Hello, ${getUserId(c)}` }));

    // 401 anonymous, 403 without the admin role. Order matters.
    app.post("/admin-only", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

    // Any one of the named roles.
    app.post("/publish", requireAuth, requireRole("editor", "admin"), (c) => c.json({ ok: true }));
});
```

Placez les gardes dans le **slot de middleware de la route elle-même**, comme ci-dessus, plutôt que d'utiliser `app.use("/*", requireAuth)`. `use()` ne couvre que les routes déclarées *en dessous* de lui, de sorte qu'une route ajoutée plus tard — au bas du fichier, des mois plus tard — se retrouverait silencieusement non protégée.

:::important
Lire `getUser(c)` ne constitue **pas** une garde. Un appelant anonyme obtient `undefined` et votre gestionnaire s'exécute quand même. Seule une garde, ou un `if (!user) return 401` explicite, bloque la requête.
:::

### Portées (Scopes) et portées d'application

`requireAdmin` autorise le rôle `admin` et personne d'autre. Pour une action qu'un rôle plus restreint ou une clé d'API doit pouvoir effectuer, protégez la route avec `requireScope`. Elle accepte une [portée](/docs/backend/roles-and-scopes/) intégrée, ou une portée déclarée par l'application sous `auth.scopes` sur la collection des utilisateurs, par exemple `"project:deploy": { label: "Deploy projects", target: "project" }` :

```typescript
import { defineFunction, requireAuth, requireScope, hasScope } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // 403 SCOPE_MISSING unless the caller holds project:deploy, or project:deploy:<this project>.
    app.post("/:project", requireAuth, requireScope("project:deploy", c => c.req.param("project")), (c) => {
        return c.json({ deploying: c.req.param("project") });
    });

    // The same question inside a handler.
    app.get("/:project/can-deploy", requireAuth, (c) => c.json({ allowed: hasScope(c, "project:deploy", c.req.param("project")) }));
});
```

Chaque personne connectée possède toutes les portées de l'application, donc pour un utilisateur humain, `requireScope` ne tranche rien : vérifiez dans le gestionnaire si cette personne peut déployer ce projet. Ce que la portée apporte, c'est un moyen de **restreindre une clé** : une clé détenant `project:deploy:p1` ne passera que pour `p1`. Une clé a également besoin de `functions:invoke`, ou `functions:invoke:<name>`, avant même de pouvoir atteindre la fonction. Voir [Portées d'application](/docs/backend/roles-and-scopes/#app-scopes).

### Authentification par clé de service

Rebase prend en charge une clé statique `REBASE_SERVICE_KEY` définie dans votre `.env` pour les scripts ou les appels de serveur à serveur.

Lorsqu'une requête externe transmet la clé de service via l'en-tête Authorization (`Authorization: Bearer <service_key>`), le middleware d'authentification effectue automatiquement les actions suivantes :
1. Valide la clé à l'aide d'une comparaison en temps constant pour éviter les attaques par analyse temporelle.
2. Accorde un accès de niveau administrateur, en attribuant à l'appelant l'identité `{ uid: "service", roles: ["admin"] }`.
3. Injecte un `DataDriver` restreint à cette même identité de service. La sécurité au niveau des lignes (RLS) s'applique toujours — elle est évaluée sous l'identité `{ uid: "service", roles: ["admin"] }` et n'est pas contournée.

### Auto-authentification interne

Si vous n'avez pas configuré de `REBASE_SERVICE_KEY`, Rebase génère une clé aléatoire **interne propre à chaque démarrage**. Le singleton `rebase` utilise cette clé automatiquement lors de l'appel aux API de plan de contrôle du serveur (comme `rebase.auth` ou `rebase.storage`). Cela signifie que votre logique côté serveur peut toujours exécuter des tâches administratives, même sans clé de service configurée manuellement.

## Accéder à la base de données et aux services

### 1. Le pilote restreint à l'utilisateur — pour tout ce qui répond à une requête

`getDriver(c)` renvoie le pilote **restreint à l'appelant**, de sorte que chaque lecture et écriture est évaluée par rapport à vos politiques de sécurité au niveau des lignes (RLS) en tant que cet utilisateur :

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

`requireDriver(c)` est un `getDriver(c)` sans le `!` — il renvoie un message d'erreur identifiant le problème de configuration au lieu d'échouer vingt lignes plus bas sur un `undefined`.

### 2. `rebase.dataAsAdmin` — pour le travail d'arrière-plan de confiance

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

`rebase.dataAsAdmin` n'est pas typé tant que vous n'avez pas [enregistré votre `Database` générée](/docs/backend/typed-server-data).

### Pilote restreint par RLS vs Singleton Rebase

|                     | `getDriver(c)` (portée requête)                | `rebase.dataAsAdmin` (identité de service)                       |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **S'exécute en tant que** | L'appelant (`uid`, ses rôles)            | `{ uid: "service", roles: ["admin"] }`                            |
| **Application RLS** | ✅ Oui (évaluée selon l'appelant)              | ✅ Oui (évaluée selon l'identité de service)                      |
| **Idéal pour...**   | CRUD utilisateur classique, recherche, requêtes | Tâches d'arrière-plan, triggers système, webhooks                 |
| **Style d'API**     | Méthodes de niveau pilote (`fetchCollection`, `save`) | Accesseurs de collection fluides (`rebase.dataAsAdmin.jobs.find`) |

#### Ce qu'est précisément `dataAsAdmin`

`rebase.dataAsAdmin` est **restreint au rôle admin, sans contourner la RLS**. Le pilote est configuré une seule fois, au démarrage, avec `withAuth({ uid: "service", roles: ["admin"] })`, de sorte que chaque lecture et écriture s'exécute au sein d'une transaction ayant basculé vers le rôle restreint `rebase_user` avec `app.uid = 'service'`. Vos politiques sont donc évaluées — par rapport à cette identité.

Pour la plupart des projets, la distinction n'est jamais visible, car les politiques par défaut injectées par Rebase sur chaque collection autorisent `serverContext() OR rolesOverlap(['admin'])`, et l'identité de service valide la seconde condition. La différence apparaît dès que vous écrivez vos propres politiques :

- **`policy.serverContext()` est faux pour lui.** Cet helper compile en `rebase.uid() IS NULL`, et le `uid` de cet accesseur est `'service'`. Une collection avec `disableDefaultPolicies: true` dont la seule règle d'écriture est `serverContext()` refusera une écriture `dataAsAdmin` avec l'erreur Postgres `42501`, et une lecture sur cette collection renverra **zéro ligne avec un code HTTP 200** — le cas le plus discret. Écrivez `rolesOverlap(["admin"])` (ou ajoutez-le en parallèle) lorsque vous voulez cibler "mon backend".
- **Sa portée équivaut à celle d'un utilisateur `admin`.** Attribuer le rôle `admin` à un utilisateur de l'application lui donne accès exactement aux mêmes lignes que celles vues par cet accesseur. Il ne s'agit pas d'un canal privé.

### 3. `rebase.sql()` — SQL brut, et le seul accesseur réservé à Node

Si vous avez véritablement besoin d'un contournement inconditionnel, `rebase.sql()` est la solution : du SQL brut sur la connexion propriétaire, sans politiques, avec accès à toutes les lignes. C'est l'élément le plus privilégié dans le contexte d'une fonction — encore plus que l'accesseur comportant "admin" dans son nom.

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

Il s'exécute sur une connexion TCP vers votre base de données, ce qui en fait le seul accesseur lié à un processus Node. Cela ne coûte rien sur les déploiements existant aujourd'hui — c'est simplement le point à connaître si une fonction devait être déplacée plus tard. Voir [Portabilité du runtime](#portabilité-du-runtime).

:::caution[L'accès direct à Drizzle est réservé à Node]
Vous pouvez également importer votre propre instance de Drizzle et l'interroger directement (`db.execute(sql\`…\`)`). Cela fonctionne, et sur un déploiement Node auto-hébergé ou managé, cela ne pose aucun problème.

Il est bon de savoir ce que cela implique : une fonction qui importe `drizzle-orm` et un pool `pg` est définitivement une fonction Node, elle contourne vos callbacks de collection exécutés par `rebase.data` (aucun des deux ne vérifie la `validation`, qui s'applique aux [requêtes d'API](/docs/collections/validation-and-conditions/#where-validation-runs)), et elle tire sa connexion d'ailleurs que de la requête. `rebase.sql()` vous offre le même SQL brut via la propre connexion du framework. Privilégiez cette dernière.
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

Une lecture au niveau du module est évaluée lors de l'importation du fichier, avant même qu'une requête n'existe. Sur Node, cela signifie qu'une seule variable manquante fait échouer tout le fichier ainsi que toutes les routes qu'il contient. Sur un hébergeur qui rattache la configuration à la requête plutôt qu'au processus, il n'y a tout simplement rien à lire au moment de l'importation.

- `getEnv(c)` — chaque variable visible pour cette requête
- `env(c, "NAME")` — une variable, nettoyée des espaces superflus ; une valeur vide est considérée comme non définie
- `requireEnv(c, "NAME")` — identique, mais lève une exception indiquant le nom de la variable
- `lazyResource(factory)` — construit un client coûteux une seule fois, lors de sa première utilisation

`rebase doctor` signale les lectures de `process.env` effectuées au niveau du module dans votre répertoire de fonctions.

## Travail d'arrière-plan

Le travail qui doit survivre à la réponse s'effectue dans `waitUntil` :

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

Une promesse non attendue semble équivalente, mais ne l'est pas. `waitUntil` apporte deux avantages :

- **Sur Node**, la promesse est suivie, de sorte qu'un arrêt propre attend qu'elle se termine au lieu que le processus s'arrête brusquement au beau milieu de l'envoi d'un webhook. Une promesse flottante lors d'un `SIGTERM` est tout simplement perdue.
- **Sur un hébergeur basé sur des isolats**, l'hôte est informé qu'il doit maintenir l'isolat en vie jusqu'à ce que la promesse soit résolue. Sans cela, le travail est abandonné dès que la réponse est envoyée — silencieusement, avec un code 200 normal dans les journaux.

Un rejet est consigné dans les logs plutôt que d'être laissé au gestionnaire de rejets non interceptés, de sorte qu'une erreur indique la route dont elle provient.

## Portabilité du runtime

Une fonction personnalisée est une application Hono, et Hono fonctionne sur tous les runtimes de serveurs JavaScript. La capacité de *votre* fonction à s'exécuter ailleurs que sur un processus Node dépend donc de ce que son propre fichier importe et utilise.

Rien de tout cela ne constitue une restriction sur ce que vous pouvez écrire aujourd'hui. Chaque déploiement Rebase est un processus Node, une fonction qui lit un fichier ou ouvre un socket est une fonction tout à fait valable, et aucun build ni déploiement n'échoue à cause de ces éléments. Cela est documenté afin que la réponse soit connue dès maintenant plutôt que découverte fichier par fichier plus tard.

**Portable — fonctionne sur tous les runtimes :**

- Tout ce qui est exporté depuis `@rebasepro/server/functions`
- `getDriver(c)` et `rebase.dataAsAdmin` — tous deux transitent par le même canal quel que soit l'environnement
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — la plateforme web
- Toute dépendance ne nécessitant pas Node

**Réservé à Node :**

- `rebase.sql()` — la connexion propriétaire à la base de données est un socket TCP
- Un client Drizzle/`pg`/`mongodb` importé directement, pour la même raison
- Les modules natifs de Node : `fs`, `path`, `crypto` (le module Node — `globalThis.crypto` est portable), `child_process`, …
- Les packages basés sur ceux-ci : `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bugs latents sur tous les runtimes** — il est recommandé de les corriger dans tous les cas :

- Lecture de `process.env` au niveau du module (voir [Configuration et secrets](#configuration-et-secrets))
- Promesses sans attente ("fire-and-forget") au lieu de [`waitUntil`](#travail-darrière-plan)
- Compter sur le fait qu'un gestionnaire continue de s'exécuter après l'expiration du délai de sa requête. Sur Node, c'est le cas ; c'est une caractéristique du processus, et non une garantie offerte par le framework

### Vérifier vos propres fonctions

`rebase build` affiche une ligne par observation nécessitant une action et consigne le verdict pour chaque fonction dans le manifeste du bundle :

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` signale la même chose sans nécessiter de build.

### Si vous avez besoin d'une branche spécifique à un runtime

`runtimeKey()` renvoie `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` ou `"other"` ; `isNodeRuntime()` est la vérification standard. Utilisez-les pour dégrader gracieusement, non pour dupliquer une implémentation — une fonction qui nécessite deux implémentations distinctes correspond à deux fonctions.

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

Les fonctions personnalisées sont chargées et montées **après** que `initializeRebaseBackend()` a terminé l'initialisation principale. L'ordre d'initialisation est le suivant :

1. **Bootstrappers** — Connexions à la base de données, tables d'authentification, services temps réel
2. **Routes d'authentification** — `/api/auth/*`, `/api/admin/*`
3. **Routes de stockage** — `/api/storage/*`
4. **Routes de données** — `/api/data/*` (CRUD pour les collections)
5. **Fonctions personnalisées** ← `/api/functions/*`
6. **Tâches cron** — `/api/admin/cron/*`
7. **WebSocket** — Abonnements en temps réel

Cela signifie que vos fonctions personnalisées ont accès à tous les services initialisés. Enregistrez les routes qui doivent s'exécuter **avant** Rebase directement sur l'application Hono, avant d'appeler `initializeRebaseBackend()` :

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Les routes que vous ajoutez de cette manière à votre propre application sont **en dehors** de tout routeur Rebase ; aucun middleware d'authentification n'a donc été exécuté dessus et `getDriver(c)` n'est pas défini. Protégez-les avec `requireAuth` / `requireAdmin` importés depuis **`@rebasepro/server`** — la racine du package — qui vérifient le jeton par eux-mêmes. Les gardes situées sur le sous-chemin `/functions` lisent une identité déjà résolue par un routeur Rebase, et renverront une erreur 500 plutôt que de feindre qu'une identité existe.
:::

## Exemple : gestionnaire de webhook

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

Le routeur est monté pour le **répertoire**, pas pour les fonctions qu'il contient. Si l'importation de tous les fichiers échoue — une seule variable d'environnement manquante au niveau du module suffit pour tous les bloquer — `GET /api/functions` répond toujours `200` avec une liste vide et un compteur `skipped`, ce qui permet de distinguer "rien n'a pu être chargé" de "ce build ne comportait aucune fonction". Le listage lui-même nécessite un appelant connecté, une clé d'API détenant la simple portée `functions:invoke`, ou la clé de service — les fonctions restent appelables par quiconque y est autorisé, mais leur inventaire n'est pas public. Les explications détaillées restent consignées dans le journal de démarrage.

## Délais d'expiration (Timeouts) et limites de débit (Rate Limits)

Deux plafonds s'appliquent à `/api/functions/*` :

- **Délai d'expiration de la requête** — 30 secondes par défaut, répondant `504` avec le code `FUNCTION_TIMEOUT`. Configurable avec `functionsTimeoutMs` (ou `REBASE_FUNCTIONS_TIMEOUT_MS`) ; `0` le désactive. Le gestionnaire ne peut pas être interrompu depuis l'extérieur, mais il en est informé : `getSignal(c)` issu de `@rebasepro/server/functions` est annulé au moment de la 504, vous devez donc le transmettre à `fetch` et à tout ce qui accepte un signal (`fetch(url, { signal: getSignal(c) })`). Les tâches auxquelles le signal n'a pas été transmis continuent de s'exécuter — le délai d'attente libère le client et le socket, mais n'interrompt pas le travail. Le fait que le gestionnaire *continue de tourner* après le 504 est une propriété d'un processus Node à longue durée de vie, et non une garantie du contrat ; tout ce qui doit impérativement aller à son terme doit être placé dans [`waitUntil`](#travail-darrière-plan).
- **Limite de débit** — Les appelants avec clé d'API et les utilisateurs connectés partagent les quotas de l'API de données. Les appelants anonymes disposent de leur propre quota, bien plus souple (3000 par fenêtre), car ce routeur est public par défaut pour la réception de webhooks. Modifiez cette valeur avec `rateLimit.anonymousFunctions` ; `null` la désactive.

Les rejets de promesses non gérés sont consignés dans les journaux plutôt que d'être fatals : un appel "fire-and-forget" non intercepté dans une fonction mettrait autrement fin à l'ensemble du processus. Définissez `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` pour rétablir le comportement par défaut de Node.

Sur Rebase Cloud, l'edge placé devant vos fonctions a ses propres limites, et l'état au niveau du module, le système de fichiers ainsi que les ports sortants se comportent d'une manière qu'il est bon de connaître avant de concevoir votre architecture. Voir [Runtime backend managé](/docs/deployment/managed-runtime/).

## Prochaines étapes

- **[Vue d'ensemble du backend](/docs/backend)** — Référence complète de configuration du backend
- **[Callbacks d'entités](/docs/collections/callbacks)** — Exécuter de la logique lors des modifications de données
- **[Tâches cron](/docs/backend/cron-jobs)** — Tâches d'arrière-plan planifiées
