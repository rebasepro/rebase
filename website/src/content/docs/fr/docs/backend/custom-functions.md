---
sourceHash: 9240cd2dc83f4b7b
title: Fonctions personnalisées
sidebar_label: Fonctions personnalisées
description: Ajoutez des points de terminaison d'API Hono personnalisés aux côtés de vos routes CRUD Rebase. Détectés automatiquement à partir d'un répertoire, avec un accès complet à l'instance backend.
---

## Présentation

Les fonctions personnalisées vous permettent d'ajouter des **routes d'API Hono arbitraires** aux côtés des points de terminaison CRUD générés automatiquement par Rebase. Elles suivent le même modèle de **découverte basée sur les fichiers** que les tâches cron : déposez un fichier TypeScript dans votre répertoire `functions/`, et Rebase le monte automatiquement.

Utilisez les fonctions personnalisées pour :

- **Les points de terminaison de logique métier** — approbations, promotions, flux de travail personnalisés
- **Les intégrations tierces** — webhooks Stripe, commandes Slack, proxys d'API externes
- **Les points de terminaison publics** — formulaires de contact, capture de leads, vérifications d'état (health checks)
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

`POST`, car c'est ce que le SDK envoie par défaut — voir [Appeler depuis le client](#appeler-depuis-le-client). Une route `GET` est tout aussi valide ; l'appelant doit alors spécifier `{ method: "GET" }`.

`rebase dev` surveille le répertoire des fonctions, de sorte qu'un fichier ajouté pendant son exécution est monté au rechargement suivant — sans redémarrage. (Il doit être prévenu : le répertoire est scanné plutôt qu'importé, le watcher ne peut donc pas l'inférer seul.)

## Appeler depuis le client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` construit l'URL, attache le jeton de l'appelant et lève une exception `RebaseApiError` en cas de code de statut non-2xx — ainsi, le format d'erreur propre à la fonction parvient à l'appelant au lieu d'un simple rejet de `fetch`.

Quatre paramètres supplémentaires acceptés au-delà du nom :

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
`client.call("functions/hello", payload)` permet également d'atteindre une fonction. Il effectue toujours un `POST`, et tout comme `invoke`, il renvoie le corps textuellement — aucun des deux ne cherche une clé `data` interne. Préférez `functions.invoke`, qui accepte une méthode, un sous-chemin et un `responseType` ; `call` existe pour les routes montées en dehors de `/api/functions`, ce qu'`invoke` ne peut pas exprimer.
:::

:::important
Importez depuis **`@rebasepro/server/functions`**, et non depuis `@rebasepro/server`.

Les deux fonctionnent. Le sous-chemin constitue la surface de développement *portable* : il n'importe rien qui nécessite Node, de sorte qu'une fonction écrite avec celui-ci peut s'exécuter sur n'importe quel runtime JavaScript. La racine du package accède à l'ensemble du framework — la séquence de démarrage, les chargeurs de fichiers, la couche WebSocket — ce qui convient pour un point d'entrée de serveur mais représente bien plus que ce dont un gestionnaire de route a besoin. Il fournit également des accesseurs de contexte typés (`getUser`, `getDriver`) au lieu de devoir transtyper `c.get("user")` manuellement.

Consultez [Portabilité du runtime](#portabilité-du-runtime) pour le contrat complet.
:::

## Configuration

:::note[Emplacement]
**Runtime managé :** rien à configurer — le runtime découvre `backend/functions/` par lui-même (`functions` dans l'entrée `rebase.json` de l'application backend si vous l'avez déplacé). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` restreignent celles qu'un processus `REBASE_ROLE=functions` dessert ; tout autre rôle refuse de démarrer s'ils sont définis.
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

Rebase effectuera les étapes suivantes :

1. Scanner le répertoire à la recherche de fichiers `.ts` / `.js`
2. Valider que chaque export par défaut est une application Hono (par duck-typing via `.fetch()` + `.routes`)
3. Monter chaque application sur `/api/functions/<filename>`
4. Appliquer le middleware d'authentification (voir [Authentification](#authentification-et-propagation-du-contexte) ci-dessous)

### Fonctions sous forme de valeurs

Un répertoire est une façon de produire ce que le serveur dessert : un mapping entre un segment d'URL et une application Hono. Passez vous-même cet objet via `functions`, ou lisez un répertoire pour le remplir avec `loadFunctions` :

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Fournissez `functions` ou `functionsDir`, mais pas les deux : le processus de démarrage rejettera la combinaison des deux. `loadFunctions(dir, { onSkip })` vous transmet chaque fichier ignoré, avec la raison associée. `loadFunctionsFromDirectory` et `loadFunctionsWithDiagnostics` fonctionnent toujours, sont dépréciés, et émettent un avertissement unique. De manière autonome, le groupe de fonctions se monte sur n'importe quel chemin avec `app.route("/hooks", backend.routes.functions())`, et `getUser(c)` ainsi que `getDriver(c)` fonctionnent à l'intérieur ; consultez [Intégration d'un serveur personnalisé](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Nommage des fichiers et correspondance des routes

| Fichier | Chemin de montage |
|---------|-------------------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Les fonctions sont découvertes au **premier niveau du répertoire uniquement** — il n'y a pas de récursivité. `functions/admin/users.ts` est compilé par `rebase build` mais n'est jamais monté ; aplatissez le nom à la place (`functions/admin-users.ts`). Un sous-répertoire est signalé au démarrage et comptabilisé sur le point de terminaison de listage plutôt que d'être ignoré silencieusement.

Fichiers **ignorés** :

- `index.ts` / `index.js` — réservés
- `*.test.ts` / `*.test.js` — fichiers de test
- `*.d.ts` — déclarations de types
- Les sous-répertoires, ainsi que les fichiers `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — signalés comme anomalies, car le build compile plus de fichiers que le runtime n'en charge

Le nom constitue l'identité de la fonction partout ailleurs : c'est le segment d'URL, la cible de la portée `functions:invoke:<name>` requise par une clé pour l'appeler, et la valeur sélectionnée par `REBASE_FUNCTIONS_ONLY` lorsque vous attribuez à une fonction son propre processus.

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

`defineFunction` renvoie exactement l'application Hono que ces variantes construisent manuellement, les trois approches sont donc interchangeables. Elle vous évite de déclarer `Hono<HonoEnv>` et vous transmet le singleton `rebase` dans le callback.

---

## Sous le capot : le chargeur par Duck-Typing

Dans un monorepo, vos fonctions peuvent résoudre une copie de Hono différente de celle utilisée par Rebase, rendant `exported instanceof Hono` faux pour un routeur pourtant fonctionnel. Le chargeur vérifie donc la structure à la place (`isHonoLike`) : un objet non nul possédant une méthode `.fetch` et un tableau `.routes`.

### Contournement du compilateur de modules ES

Le chargeur convertit chaque chemin de fichier en URL de fichier (`pathToFileURL(filePath).href`), afin qu'il s'importe aussi bien sous Windows que sur POSIX, et appelle `import(url)` via `new Function("url", "return import(url)")`, empêchant ainsi une compilation TypeScript de le réécrire en un `require()` qui échouerait sous ESM.

---

## Authentification et propagation du contexte

Les fonctions personnalisées sont montées avec le **même middleware d'authentification** que les routes de données, mais avec `requireAuth: false`. Cela signifie que :

- Le JWT de l'utilisateur est **analysé et injecté** dans le contexte s'il est présent
- Mais les requêtes ne sont **pas rejetées** si aucun JWT n'est fourni
- Vous devez **protéger explicitement** les routes qui nécessitent une authentification

Un appelant qui présente un jeton *invalide* n'atteint jamais votre gestionnaire : un jeton invérifiable ou expiré est rejeté avec une erreur 401 directement par le middleware, évitant ainsi qu'une session expirée ne soit rétrogradée silencieusement en session anonyme.

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

`getUser` renvoie un objet restreint : `uid` est une chaîne de caractères et `roles` est toujours un tableau, quelle que soit la méthode d'authentification employée par l'appelant. `getUserId(c)` et `getRoles(c)` sont des raccourcis. `getScopes(c)` contient tout ce que l'appelant a le droit de faire, sous forme de chaînes de [portées (scopes)](/docs/backend/roles-and-scopes/) : pour un utilisateur, le plan de données, les portées propres à l'application et celles de ses rôles ; pour une clé d'API, exactement ce que détient la clé.

### Le compte de l'appelant

`getUser(c)` lit le jeton d'accès, et le jeton contient l'identifiant, les rôles et l'adresse de l'appelant. Il n'indique pas comment le compte s'est connecté ni quel est son nom d'affichage. `getUserProfile(c)` lit ces informations depuis le magasin d'authentification :

```typescript
import { defineFunction, getUserProfile } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/whoami", async (c) => {
        const profile = await getUserProfile(c);
        if (!profile) return c.json({ error: "Unauthorized" }, 401);
        // { uid, email?, displayName?, photoURL?, emailVerified, isAnonymous, providers }
        return c.json({ name: profile.displayName ?? null, social: profile.providers.some(p => p !== "password") });
    });
});
```

`providers` énumère les méthodes par lesquelles le compte peut se connecter : `"password"` s'il en a un, puis chaque fournisseur lié (`"google"`, `"apple"`, …) dans l'ordre où ils ont été associés. Un compte invité, ou un compte qui se connecte uniquement avec un code à usage unique, a une liste vide.

La lecture est actualisée pour chaque requête : un fournisseur lié par l'appelant un instant auparavant apparaît dès sa requête suivante, sans attendre le renouvellement du jeton. Le premier appel dans une requête nécessite deux recherches par clé, effectuées simultanément. Les appels ultérieurs dans la même requête réutilisent le résultat, et une requête qui ne l'appelle jamais ne coûte rien.

Elle renvoie `undefined` pour un appelant anonyme, pour un appelant utilisant une clé de service ou une clé d'API n'agissant en tant qu'aucun compte, ainsi que pour un compte qui n'existe plus. Elle renvoie également `undefined` sur un backend dont les comptes résident auprès d'un [adaptateur d'authentification](/docs/backend/auth-adapters/) externe : interrogez ce fournisseur à la place. Lorsqu'un administrateur transmet `x-rebase-impersonate`, elle renvoie le compte usurpé.

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

Placez les gardes dans **l'emplacement de middleware propre à la route**, comme ci-dessus, plutôt qu'avec `app.use("/*", requireAuth)`. `use()` ne couvre que les routes déclarées *en dessous* de lui ; une route ajoutée plus tard — tout en bas du fichier, des mois après — resterait silencieusement non protégée.

:::important
Lire `getUser(c)` ne constitue **pas** une garde. Un appelant anonyme reçoit `undefined` et votre gestionnaire s'exécute quand même. Seule une garde, ou un `if (!user) return 401` explicite, bloque la requête.
:::

### Portées et portées d'application

`requireAdmin` autorise le rôle `admin` et personne d'autre. Pour une action qu'un rôle plus restreint ou une clé d'API doit pouvoir effectuer, protégez la route avec `requireScope`. Il prend une [portée](/docs/backend/roles-and-scopes/) intégrée, ou une portée déclarée par l'application sous `auth.scopes` sur la collection des utilisateurs, telle que `"project:deploy": { label: "Deploy projects", target: "project" }` :

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

Chaque utilisateur connecté possède toutes les portées de l'application, donc pour une personne physique, `requireScope` ne tranche rien : vérifiez dans le gestionnaire si cette personne a le droit de déployer ce projet. Ce que la portée apporte, c'est un moyen de **restreindre une clé** : une clé détenant `project:deploy:p1` sera acceptée pour `p1` uniquement. Une clé a également besoin de `functions:invoke`, ou de `functions:invoke:<name>`, pour pouvoir simplement atteindre la fonction. Voir [Portées d'application](/docs/backend/roles-and-scopes/#app-scopes).

### Limites de débit (Rate limits)

Une route qui entraîne un coût par appel accepte le middleware `rateLimit`, qui effectue le décompte sur l'ensemble des réplicas. Consultez [Limites de débit dans les fonctions](/docs/backend/function-rate-limits/).

### Authentification par clé de service

Rebase prend en charge une clé statique `REBASE_SERVICE_KEY` définie dans votre `.env` pour les scripts ou les appels de serveur à serveur.

Lorsqu'une requête externe transmet la clé de service via l'en-tête Authorization (`Authorization: Bearer <service_key>`), le middleware d'authentification effectue automatiquement les opérations suivantes :
1. Valider la clé à l'aide d'une comparaison en temps constant afin d'empêcher les attaques temporelles.
2. Accorder un accès de niveau administrateur, en définissant l'appelant sur `{ uid: "service", roles: ["admin"] }`.
3. Injecter un `DataDriver` restreint à cette même identité de service. La sécurité au niveau des lignes (Row-Level Security) s'applique toujours — elle est évaluée en tant que `{ uid: "service", roles: ["admin"] }`, et non ignorée.

### Auto-authentification interne

Si vous n'avez pas configuré de `REBASE_SERVICE_KEY`, Rebase génère une **clé interne aléatoire par démarrage**. Le singleton `rebase` utilise cette clé automatiquement lors de l'appel aux API du plan de contrôle du serveur lui-même (comme `rebase.auth` ou `rebase.storage`). Cela signifie que votre logique côté serveur peut toujours effectuer des tâches administratives, même sans clé de service configurée manuellement.

## Accéder à la base de données et aux services

### 1. Le pilote délimité à l'utilisateur — pour tout ce qui traite une requête

`getDriver(c)` renvoie le pilote **délimité à l'appelant**, de sorte que chaque lecture et écriture est évaluée par rapport à vos politiques de sécurité au niveau des lignes (RLS) sous l'identité de cet utilisateur :

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

`requireDriver(c)` est un `getDriver(c)` sans le `!` — il lève une exception indiquant le problème de configuration au lieu d'échouer vingt lignes plus loin sur `undefined`.

`fetchCollection` et `fetchOne` renvoient les lignes que `GET /api/data/<table>` renvoie : les dates sous forme de chaînes RFC 3339, un `belongsTo` sous sa clé étrangère (`authorId`), et une ligne liée uniquement lorsque `include` la mentionne — `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

### 2. `rebase.dataAsAdmin` — pour les tâches de fond fiables

```typescript
import { defineFunction, requireAuth, requireAdmin } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/:id/approve", requireAuth, requireAdmin, async (c) => {
        const id = c.req.param("id");
        await rebase.dataAsAdmin.table<Record<string, unknown>>("jobs").update(id, {
            status: "published",
            approved_at: new Date().toISOString(),
        });
        return c.json({ success: true });
    });
});
```

`rebase.dataAsAdmin` n'est pas typé tant que vous n'avez pas [enregistré votre `Database` générée](/docs/backend/typed-server-data).

### Pilote délimité par RLS vs Singleton Rebase

|                     | `getDriver(c)` (délimité à la requête)         | `rebase.dataAsAdmin` (identité de service)                       |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **S'exécute en tant que** | L'appelant (`uid`, ses rôles)            | `{ uid: "service", roles: ["admin"] }`                            |
| **Application RLS** | ✅ Oui (évalué par rapport à l'appelant)        | ✅ Oui (évalué par rapport à l'identité de service)              |
| **Idéal pour...**   | CRUD utilisateur général, recherche et requêtes | Tâches de fond, déclencheurs système, webhooks                  |
| **Style d'API**     | Méthodes au niveau du pilote (`fetchCollection`, `save`) | Accesseurs de table fluents (`rebase.dataAsAdmin.jobs.find`) |

#### Ce qu'est précisément `dataAsAdmin`

`rebase.dataAsAdmin` est **délimité au rôle admin, il ne contourne pas RLS**. Le pilote est délimité une seule fois, au démarrage, avec `withAuth({ uid: "service", roles: ["admin"] })`, de sorte que chaque lecture et écriture s'exécute au sein d'une transaction qui a basculé sur le rôle restreint `rebase_user` avec `app.uid = 'service'`. Vos politiques sont évaluées — par rapport à cette identité.

Pour la plupart des projets, la distinction n'apparaît jamais, car les politiques par défaut injectées par Rebase sur chaque table acceptent `serverContext() OR rolesOverlap(['admin'])`, et l'identité de service valide la seconde condition. Cela devient visible dès que vous écrivez vos propres politiques :

- **`policy.serverContext()` est faux pour lui.** Ce helper se compile en `rebase.uid() IS NULL`, et l'`uid` de cet accesseur est `'service'`. Une table configurée avec `defaultPolicies: false` dont la seule règle d'écriture est `serverContext()` refusera une écriture via `dataAsAdmin` avec l'erreur Postgres `42501`, et une lecture sur cette table renverra **zéro ligne avec un statut HTTP 200** — le cas silencieux. Écrivez `rolesOverlap(["admin"])` (ou ajoutez-le en parallèle) lorsque vous voulez signifier "mon backend".
- **Sa portée équivaut à celle d'un utilisateur `admin`.** Attribuer le rôle `admin` à un utilisateur applicatif lui donne accès exactement aux mêmes lignes que celles vues par cet accesseur. Il ne s'agit pas d'un canal privé.

### 3. `getSql(c)` — SQL en tant qu'appelant

Lorsque le SDK n'exprime pas une requête ou une écriture proprement — un upsert conditionnel, un compare-and-swap `UPDATE … WHERE rev = $3 RETURNING`, un `count(*) FILTER (…)`, une CTE — écrivez le SQL, et exécutez-le sous l'identité de l'appelant :

```typescript
import { defineFunction, getSql, requireAuth } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/my-stats", requireAuth, async (c) => {
        const sql = getSql(c);
        const rows = await sql(
            "SELECT lower(artist) AS artist, count(*) FILTER (WHERE liked) AS likes FROM songs WHERE lang = $1 GROUP BY 1",
            { params: [c.req.query("lang") ?? "en"] }
        );
        return c.json(rows);
    });
});
```
Les valeurs sont celles de Postgres, avec deux exceptions formatées comme `/api/data` les formate : un `timestamptz` est au format RFC 3339 en UTC (`2026-11-18T10:52:23.500Z`), et un `bigint` est un nombre lorsqu'il rentre dans un entier sûr (au-delà de 2^53, il reste sous forme de chiffres dans une chaîne). Un `numeric` est une chaîne, de sorte qu'aucun chiffre n'est perdu ; convertissez-le dans la requête (`total::float8`) si c'est un nombre que vous souhaitez.

L'instruction s'exécute dans la transaction propre à l'appelant, avec le rôle restreint `rebase_user` sous son identité — la transaction que le pilote délimité à l'utilisateur ouvre — de sorte que les règles `rls` de vos tables déterminent chaque ligne, exactement comme pour le SDK. Une requête demandant toutes les lignes obtiendra celles de l'appelant.

- **En lecture seule par défaut.** Passez `{ write: true }` pour insérer, mettre à jour ou supprimer ; les politiques d'insertion et de mise à jour s'appliquent toujours.
- **Le texte de la requête vous appartient ; les valeurs vont dans `params`** (`$1`, `$2`, …). L'identité de l'appelant réside dans les paramètres de transaction, que le SQL peut modifier ; une instruction susceptible de le faire — `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, ou plusieurs instructions réunies — est rejetée avec l'erreur `400 SQL_NOT_ALLOWED` avant même son exécution. Interpoler les entrées utilisateur dans le texte est précisément ce qui testerait cette garde ; ne le faites pas.
- **Ce qui est partagé avec le SDK.** Les politiques, ainsi que trois règles que Postgres applique pour les deux : une [vue matérialisée](/docs/collections/views/#materialized-views) ne sert ses lignes qu'à ses `roles`, une ligne d'une table déclarant `tenant` ne peut être déplacée vers un autre tenant que par un appelant disposant de `bypassRoles` (`TENANT_IMMUTABLE`), et les fonctions internes du serveur (`rebase.record_history`, `rebase.enqueue_job`) sont refusées. Une colonne que l'appelant n'a pas le droit de lire — `.private()`, ou un `.access({ read })` qui lui manque — est omise des lignes, tout comme l'API l'omet, lorsqu'il s'agit d'une référence directe à la colonne (`SELECT *`, `password_hash AS h`) ; une valeur *calculée* à partir d'elle (`md5(password_hash)`) n'est pas reconnue, ne calculez donc rien à partir de celle-ci.
- **Ce qui n'est pas partagé.** `beforeQuery` et `afterRead`, la validation, les hooks de sauvegarde et l'historique résident dans Node et ne s'exécutent pas.

Depuis un script, [`openRebase`](/docs/backend/embedding-postgres-driver/) vous offre la même possibilité : `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` — SQL en tant qu'identité de service

Une fonction qui applique ses propres règles (un ticket par jour, un contrôle d'horodatage) sur des tables que seuls les administrateurs peuvent lire ne peut pas utiliser `getSql(c)` : l'appelant aurait besoin de politiques qui l'autorisent, et ces mêmes politiques ouvriraient également les tables sur l'API de données publique. `rebase.sqlAsAdmin` exécute l'instruction en tant que `{ uid: "service", roles: ["admin"] }`, l'identité utilisée par `rebase.dataAsAdmin`, sous la même sécurité au niveau des lignes :

```typescript
import { defineFunction, rebase } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post("/claim", async (c) => {
        const { device } = await c.req.json();
        const rows = await rebase.sqlAsAdmin(
            "INSERT INTO tickets (device, day) VALUES ($1, current_date) ON CONFLICT DO NOTHING RETURNING id",
            { params: [device], write: true }
        );
        return c.json({ claimed: rows.length === 1 });
    });
});
```

Il s'agit de `getSql(c)` avec une identité différente : le rôle de requête restreint, la branche administrateur de vos politiques, en lecture seule sauf si `{ write: true }`, et la même protection `SQL_NOT_ALLOWED`. Contrairement au `rebase.sql()` du propriétaire, il ne peut pas exécuter de DDL, et dans le magasin d'authentification, il n'accède qu'à ce qu'un administrateur atteint via la collection des utilisateurs : les sessions, les clés et les secrets MFA sont masqués au rôle de requête, et le hachage de mot de passe est retiré des lignes. Une instruction isolée coûte un aller-retour (round trip), tout comme `rebase.sql()`. Depuis un script, `openRebase()` le propose également.

### 4. `rebase.sql()` — SQL propriétaire, et le seul accesseur réservé à Node

Si vous avez véritablement besoin d'un contournement inconditionnel, `rebase.sql()` est fait pour cela : du SQL brut sur la connexion propriétaire, sans politiques, accédant à chaque ligne. C'est l'élément le plus privilégié dans le contexte d'une fonction — plus encore que l'accesseur comportant "admin" dans son nom.

Il n'est pas destiné à créer des tables. Une table est [déclarée](/docs/schema/) avec `defineTable` dans `backend/schema/` et créée au démarrage ; une table créée avec `CREATE TABLE` dans une fonction n'aura aucune validation, aucun hook, aucune configuration RLS, aucune vue d'administration ni aucun type dans le SDK. `rebase.sql()` exécutera une telle instruction, mais enregistrera un avertissement indiquant la table à déclarer à la place.

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

Il s'exécute sur une connexion TCP vers votre base de données, ce qui en fait le seul accesseur lié à un processus Node. Cela ne coûte rien sur les déploiements existant aujourd'hui — c'est simplement le seul point à garder en tête si une fonction doit être déplacée ultérieurement. Consultez [Portabilité du runtime](#portabilité-du-runtime).

:::caution[L'accès direct à Drizzle est réservé à Node]
Vous pouvez également importer votre propre instance de Drizzle et l'interroger directement (`db.execute(sql\`…\`)`). Cela fonctionne, et sur un déploiement Node auto-hébergé ou managé, cela ne pose aucun problème.

Il est important de savoir ce que cela implique : une fonction qui importe `drizzle-orm` et un pool `pg` est définitivement une fonction Node, elle contourne les hooks de vos tables exécutés par `rebase.data` (aucun des deux ne vérifie `.validate()`, qui s'applique aux [requêtes d'API](/docs/collections/validation-and-conditions/#where-validation-runs)), et elle tire sa connexion d'ailleurs que de la requête. `rebase.sql()` vous fournit le même SQL brut via la propre connexion du framework, et `getSql(c)` vous l'offre sous les politiques de l'appelant. Préférez ces derniers.
:::

## Configuration et secrets

Lisez la configuration **à l'intérieur** du gestionnaire, jamais au niveau de la portée du module :

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

Une lecture au niveau du module est évaluée lors de l'importation du fichier, avant même qu'une requête n'existe. Sur Node, cela signifie qu'une seule variable manquante fait échouer tout le fichier ainsi que chaque route qu'il contient. Sur un hébergeur qui rattache la configuration à la requête plutôt qu'au processus, il n'y a absolument rien à lire au moment de l'import.

- `getEnv(c)` — toutes les variables visibles pour cette requête
- `env(c, "NAME")` — une variable, nettoyée des espaces superflus ; une valeur vide est considérée comme non définie
- `requireEnv(c, "NAME")` — identique, mais lève une exception indiquant le nom de la variable manquante
- `lazyResource(factory)` — construit un client coûteux une seule fois, à la première utilisation

`rebase doctor` signale les lectures de `process.env` faites au niveau du module dans votre répertoire de fonctions.

## Travail en arrière-plan

Déplacé sur sa propre page : [Travail en arrière-plan](/docs/backend/background-work/).

## Portabilité du runtime

Une fonction personnalisée est une application Hono ; ainsi, sa capacité à s'exécuter ailleurs que dans un processus Node dépend de ce que son fichier importe. `rebase.sql()`, un client de base de données importé directement et les modules internes de Node la lient à Node ; le reste de `rebase` et la plateforme web ne le font pas, et rien n'échoue aujourd'hui à cause de l'un ou de l'autre. [Portabilité du runtime](/docs/backend/runtime-portability/) détaille ce qui est portable, la façon dont `rebase build` et `rebase doctor` le signalent, et comment adapter le code selon le runtime.

## Ordre d'enregistrement des routes

Les fonctions personnalisées sont chargées et montées **après** que `initializeRebaseBackend()` a terminé la configuration de base. L'ordre d'initialisation est le suivant :

1. **Bootstrappers** — Connexions à la base de données, tables d'authentification, services temps réel
2. **Routes d'authentification** — `/api/auth/*`, `/api/admin/*`
3. **Routes de stockage** — `/api/storage/*`
4. **Routes de données** — `/api/data/*` (CRUD pour les tables)
5. **Fonctions personnalisées** ← `/api/functions/*`
6. **Tâches cron** — `/api/admin/cron/*`
7. **WebSocket** — Abonnements en temps réel

Cela signifie que vos fonctions personnalisées ont accès à tous les services initialisés. Enregistrez toutes les routes qui doivent s'exécuter **avant** Rebase directement sur l'application Hono, préalablement à l'appel de `initializeRebaseBackend()` :

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Les routes que vous ajoutez ainsi à votre propre application sont **en dehors** de tout routeur Rebase ; aucun middleware d'authentification ne s'est donc exécuté sur elles et `getDriver(c)` n'est pas défini. Protégez-les avec `requireAuth` / `requireAdmin` importés depuis **`@rebasepro/server`** — la racine du package — qui vérifient le jeton par eux-mêmes. Les gardes du sous-chemin `/functions` lisent une identité qu'un routeur Rebase a déjà résolue, et répondront une erreur 500 plutôt que de feindre qu'il en existe une.
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
            await rebase.dataAsAdmin.table("subscriptions").create({
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

Journalisez depuis une fonction avec `logger` de `@rebasepro/server/functions`, pas avec `console.log` : voir [Logging](/docs/backend/logging/). Lorsque les fonctions se chargent, le démarrage consigne `Loaded custom functions` avec leur nombre. La ligne propre à chaque fonction est enregistrée au niveau `debug` (`LOG_LEVEL=debug`) :

```
Loaded function route: hello
```

Si le chargement échoue, le chargeur fournit un résultat de diagnostic :

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

Le routeur est monté pour le **répertoire**, et non pour les fonctions individuelles qu'il contient. Si chaque fichier échoue à l'import — une variable d'environnement manquante au niveau de la portée du module suffit à tous les faire échouer —, `GET /api/functions` répond tout de même `200` avec une liste vide et un compteur `skipped`, afin de pouvoir distinguer "rien n'a pu charger" de "ce build n'embarque aucune fonction". Le listage lui-même nécessite un appelant connecté, une clé d'API disposant de la portée simple `functions:invoke`, ou la clé de service — les fonctions restent appelables par quiconque est autorisé par chacune d'elles, mais leur inventaire n'est pas public. Les détails des raisons restent dans le journal de démarrage.

## Délais d'attente et limites de débit

Deux plafonds s'appliquent à `/api/functions/*` :

- **Délai d'expiration de la requête (Request timeout)** — 30 secondes par défaut, répondant par une erreur `504` avec le code `FUNCTION_TIMEOUT`. Configurez-le pour toutes les fonctions avec `functionsTimeoutMs` (ou `REBASE_FUNCTIONS_TIMEOUT_MS`) ; `0` le désactive. Une fonction qui attend un service lent, tel qu'un LLM, déclare son propre délai comme second argument de `defineFunction` : `defineFunction((app) => { … }, { timeoutMs: 150_000 })`. Cela remplace le délai global du serveur pour cette fonction uniquement, qu'il soit plus long ou plus court, décompté à partir du moment où la requête a atteint le routeur de fonctions, et s'applique même si le délai global est à `0` ; le serveur le plafonne à `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` (300000 ms, soit 5 minutes, par défaut), et il ne peut pas être fixé à `0`. Le message du code 504 indique quelle limite a été appliquée et où elle a été définie, et `error.details` la transmet sous la forme `{ timeoutMs, source }` (`source` étant `default`, `env`, `option` ou `function`). Le gestionnaire ne peut pas être interrompu depuis l'extérieur, mais il en est notifié : `getSignal(c)` de `@rebasepro/server/functions` est annulé (aborted) au moment du code 504 ; transmettez-le donc à `fetch` et à tout autre mécanisme acceptant un signal (`fetch(url, { signal: getSignal(c) })`). Les tâches auxquelles le signal n'a pas été transmis continuent — le délai libère le client et le socket, pas le travail en cours. Le fait que le gestionnaire *continue de s'exécuter* après le code 504 est une propriété inhérente aux processus Node persistants, et non une garantie contractuelle ; toute opération devant impérativement aller à son terme doit être placée dans [`waitUntil`](#travail-en-arrière-plan).
- **Limite de débit (Rate limit)** — Les clés d'API et les appelants connectés partagent les quotas de l'API de données. Les appelants anonymes bénéficient de leur propre quota, beaucoup plus généreux (3 000 par fenêtre), car ce routeur est public par défaut pour les récepteurs de webhooks. Modifiez-le via `rateLimit.anonymousFunctions` ; `null` le désactive.

Les rejets de promesses non gérés (unhandled rejections) sont consignés dans les logs plutôt que d'être fatals : un appel "fire-and-forget" dans une fonction interromprait sinon l'ensemble du processus. Définissez `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` pour retrouver le comportement par défaut de Node.

Sur Rebase Cloud, l'infrastructure edge placée devant vos fonctions dispose de ses propres limites, et l'état au niveau du module, le système de fichiers ainsi que les ports sortants se comportent d'une manière qu'il convient de connaître avant de concevoir votre application. Consultez [Runtime backend managé](/docs/deployment/managed-runtime/).

## Prochaines étapes

- **[Vue d'ensemble du backend](/docs/backend)** — Référence complète de configuration du backend
- **[Hooks de table](/docs/collections/callbacks)** — Exécuter de la logique lors des modifications de données
- **[Tâches Cron](/docs/backend/cron-jobs)** — Tâches d'arrière-plan planifiées
