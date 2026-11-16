---
sourceHash: 981d8ad3d6e13c80
title: Fonctions personnalisées
sidebar_label: Fonctions personnalisées
description: Ajoutez des points de terminaison d'API Hono personnalisés aux côtés de vos routes CRUD Rebase. Découverte automatique depuis un répertoire, avec un accès complet à l'instance backend.
---

## Vue d'ensemble

Les fonctions personnalisées vous permettent d'ajouter des **routes d'API Hono arbitraires** aux côtés des points de terminaison CRUD générés automatiquement par Rebase. Elles suivent le même modèle de **découverte basée sur les fichiers** que les tâches cron : déposez un fichier TypeScript dans votre répertoire `functions/`, et Rebase le monte automatiquement.

Utilisez des fonctions personnalisées pour :

- **Points de terminaison de logique métier** — approbations, promotions, flux de travail personnalisés
- **Intégrations tierces** — webhooks Stripe, commandes Slack, proxys d'API externes
- **Points de terminaison publics** — formulaires de contact, capture de leads, vérifications de santé (health checks)
- **Requêtes d'agrégation** — statistiques de tableau de bord, rapports, analytique

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

Cela se monte sur **`/api/functions/hello`**. Le nom de fichier (sans extension) devient le préfixe de la route.

`POST`, car c'est ce que le SDK envoie par défaut — voir [Appel depuis le client](#appel-depuis-le-client). Une route `GET` est tout aussi valide ; l'appelant doit alors spécifier `{ method: "GET" }`.

`rebase dev` surveille le répertoire des fonctions, de sorte qu'un fichier ajouté pendant son exécution est monté au rechargement suivant — sans redémarrage. (Il doit en être informé : le répertoire est scanné plutôt qu'importé, le surveillant ne peut donc pas le déduire).

## Appel depuis le client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` construit l'URL, attache le jeton de l'appelant et lève une erreur `RebaseApiError` en cas de code différent de 2xx — ainsi, la structure d'erreur propre à la fonction parvient à l'appelant au lieu d'un simple rejet de `fetch`.

Quatre éléments qu'il accepte en plus du nom :

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
`client.call("functions/hello", payload)` permet également d'atteindre une fonction. Il effectue toujours un `POST` et, comme `invoke`, il renvoie le corps textuellement — aucun des deux n'extrait une clé `data`. Privilégiez `functions.invoke`, qui accepte une méthode, un sous-chemin et un `responseType` ; `call` existe pour les routes montées en dehors de `/api/functions`, ce que `invoke` ne peut pas exprimer.
:::

:::important
Importez depuis **`@rebasepro/server/functions`**, et non depuis `@rebasepro/server`.

Les deux fonctionnent. Le sous-chemin est la surface de développement *portable* : il n'importe rien qui nécessite Node, donc une fonction écrite avec celui-ci peut s'exécuter sur n'importe quel runtime JavaScript. La racine du package permet d'accéder à l'ensemble du framework — la séquence de démarrage, les chargeurs de fichiers, la couche WebSocket — ce qui convient pour un point d'entrée de serveur, mais dépasse les besoins d'un gestionnaire de route. Il vous fournit également des accesseurs de contexte typés (`getUser`, `getDriver`) au lieu de transtyper manuellement `c.get("user")`.

Consultez [Portabilité du runtime](#portabilité-du-runtime) pour le contrat complet.
:::

## Configuration

:::note[Où placer ceci]
**Runtime managé :** rien à configurer — le runtime découvre `backend/functions/` de lui-même (`functions` dans l'entrée `rebase.json` de l'application backend si vous l'avez déplacé). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` restreignent celles qu'un processus `REBASE_ROLE=functions` sert ; tout autre rôle refuse de démarrer s'ils sont définis.
**Éjecté :** `initializeRebaseBackend({ functionsDir })`, ou `functions` (ci-dessous), dans `backend/src/index.ts`.
:::

Activez les fonctions personnalisées en ajoutant `functionsDir` à la configuration de votre backend :

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase va :

1. Scanner le répertoire à la recherche de fichiers `.ts` / `.js`
2. Valider que chaque export par défaut est une application Hono (duck-typée via `.fetch()` + `.routes`)
3. Monter chaque application sur `/api/functions/<filename>`
4. Appliquer le middleware d'authentification (voir [Authentification](#authentification-et-propagation-du-contexte) ci-dessous)

### Fonctions en tant que valeurs

Un répertoire est un moyen de produire ce que le serveur dessert : un enregistrement associant un segment d'URL à une application Hono. Transmettez cet enregistrement vous-même via `functions`, ou lisez un répertoire pour le remplir avec `loadFunctions` :

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Fournissez `functions` ou `functionsDir`, mais pas les deux : le démarrage refusera la combinaison. `loadFunctions(dir, { onSkip })` vous transmet chaque fichier ignoré ainsi que la raison. `loadFunctionsFromDirectory` et `loadFunctionsWithDiagnostics` fonctionnent toujours, sont dépréciés et émettent un avertissement unique. De manière autonome, le groupe de fonctions se monte sur n'importe quel chemin avec `app.route("/hooks", backend.routes.functions())`, et `getUser(c)` et `getDriver(c)` fonctionnent à l'intérieur ; voir [Intégration de serveur personnalisé](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Nommage des fichiers et correspondance des routes

| Fichier | Chemin de montage |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Les fonctions sont découvertes au **premier niveau du répertoire uniquement** — il n'y a pas de récursivité. `functions/admin/users.ts` est compilé par `rebase build` mais ne sera jamais monté ; aplatissez le nom à la place (`functions/admin-users.ts`). Un sous-répertoire est signalé au démarrage et comptabilisé sur le point de terminaison de liste plutôt que d'être ignoré silencieusement.

Fichiers **ignorés** :

- `index.ts` / `index.js` — réservés
- `*.test.ts` / `*.test.js` — fichiers de test
- `*.d.ts` — déclarations de types
- Les sous-répertoires, et les fichiers `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — signalés comme des anomalies, puisque le build compile plus de fichiers que le runtime n'en charge

Le nom constitue également l'identité de la fonction partout ailleurs : c'est le segment d'URL, la cible du scope `functions:invoke:<name>` dont une clé a besoin pour l'appeler, et la valeur sélectionnée par `REBASE_FUNCTIONS_ONLY` lorsque vous dédiez son propre processus à une fonction.

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

`defineFunction` renvoie exactement l'application Hono que ces méthodes construisent manuellement, les trois sont donc interchangeables. Elle vous évite de déclarer `Hono<HonoEnv>` et vous transmet le singleton `rebase` dans le callback.

---

## Sous le capot : le chargeur par duck-typing

Dans un monorepo, vos fonctions peuvent résoudre une copie de Hono différente de celle utilisée par Rebase, et dans ce cas `exported instanceof Hono` sera faux pour un routeur pourtant fonctionnel. Le chargeur vérifie donc la forme à la place (`isHonoLike`) : un objet non nul doté d'une méthode `.fetch` et d'un tableau `.routes`.

### Échappement du compilateur ES Module

Le chargeur convertit chaque chemin de fichier en URL de fichier (`pathToFileURL(filePath).href`), de sorte qu'il s'importe de la même manière sous Windows et POSIX, et appelle `import(url)` via `new Function("url", "return import(url)")`, afin qu'un build TypeScript ne puisse pas le réécrire en un `require()` qui échouerait sous ESM.

---

## Authentification et propagation du contexte

Les fonctions personnalisées sont montées avec le **même middleware d'authentification** que les routes de données, mais avec `requireAuth: false`. Cela signifie que :

- Le JWT de l'utilisateur est **analysé et injecté** dans le contexte s'il est présent
- Mais les requêtes ne sont **pas rejetées** si aucun JWT n'est fourni
- Vous devez **protéger explicitement** les routes qui nécessitent une authentification

Un appelant qui présente un *mauvais* jeton n'atteint jamais votre gestionnaire : un jeton non vérifiable ou expiré est rejeté avec un code 401 par le middleware lui-même, de sorte qu'une session expirée n'est jamais rétrogradée silencieusement en session anonyme.

### Lecture de l'appelant

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

`getUser` renvoie un objet restreint : `uid` est une chaîne de caractères et `roles` est toujours un tableau, quelle que soit la méthode d'authentification utilisée par l'appelant. `getUserId(c)` et `getRoles(c)` sont des raccourcis. `getScopes(c)` représente tout ce que l'appelant a le droit de faire, sous forme de chaînes de [scopes](/docs/backend/roles-and-scopes/) : pour une personne, le plan de données, les scopes propres à l'application et les scopes de ses rôles ; pour une clé d'API, exactement ce que la clé détient.

### Le compte de l'appelant

`getUser(c)` lit le jeton d'accès, et le jeton contient l'identifiant, les rôles et l'adresse de l'appelant. Il n'indique pas comment le compte se connecte ni quel est son nom d'affichage. `getUserProfile(c)` lit ces informations depuis le magasin d'authentification :

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

`providers` liste les méthodes permettant au compte de se connecter : `"password"` lorsqu'il en a un, puis chaque fournisseur lié (`"google"`, `"apple"`, …) dans l'ordre où il a été associé. Un compte invité, ou un compte qui se connecte uniquement avec un code à usage unique, a une liste vide.

La lecture est fraîche à chaque requête : un fournisseur que l'appelant vient de lier apparaît dès sa requête suivante, sans attendre le rafraîchissement du jeton. Le premier appel dans une requête coûte deux recherches indexées, effectuées conjointement. Les appels ultérieurs dans la même requête réutilisent le résultat, et une requête qui ne l'appelle jamais ne coûte rien.

Il renvoie `undefined` pour un appelant anonyme, pour un appelant utilisant une clé de service ou une clé d'API qui n'agit pas au nom d'un compte, ainsi que pour un compte qui n'existe plus. Il renvoie également `undefined` sur un backend dont les comptes résident auprès d'un [adaptateur d'authentification](/docs/backend/auth-adapters/) externe : interrogez plutôt ce fournisseur. Lorsqu'un administrateur envoie `x-rebase-impersonate`, il renvoie le compte usurpé.

### Protection des routes

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

Placez les gardes dans **l'emplacement de middleware propre à la route**, comme ci-dessus, plutôt que dans `app.use("/*", requireAuth)`. `use()` ne couvre que les routes déclarées *en dessous* de lui, de sorte qu'une route ajoutée ultérieurement — en bas du fichier, dans plusieurs mois — ne serait silencieusement pas protégée.

:::important
Lire `getUser(c)` n'est **pas** un garde. Un appelant anonyme obtient `undefined` et votre gestionnaire s'exécute quand même. Seul un garde, ou un `if (!user) return 401` explicite, interrompt la requête.
:::

### Scopes et scopes d'application

`requireAdmin` n'autorise que le rôle `admin` et personne d'autre. Pour une action qu'un rôle plus restreint ou une clé d'API devrait pouvoir atteindre, protégez la route avec `requireScope`. Elle accepte un [scope](/docs/backend/roles-and-scopes/) intégré, ou un scope que l'application déclare sous `auth.scopes` dans la collection des utilisateurs, tel que `"project:deploy": { label: "Deploy projects", target: "project" }` :

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

Toute personne connectée détient tous les scopes d'application, donc pour une personne, `requireScope` ne décide de rien : vérifiez dans le gestionnaire si cette personne peut déployer ce projet. Ce que le scope apporte, c'est un moyen de **restreindre une clé** : une clé détenant `project:deploy:p1` ne passera que pour `p1`. Une clé a également besoin de `functions:invoke`, ou `functions:invoke:<name>`, avant même d'atteindre la fonction. Voir [Scopes d'application](/docs/backend/roles-and-scopes/#app-scopes).

### Limites de débit (Rate limits)

Une route dont chaque appel a un coût peut utiliser le middleware `rateLimit`, qui effectue le décompte à travers les différents réplicas. Voir [Limites de débit dans les fonctions](/docs/backend/function-rate-limits/).

### Authentification par clé de service

Rebase prend en charge une clé statique `REBASE_SERVICE_KEY` définie dans votre `.env` pour les scripts ou les appels de serveur à serveur.

Lorsqu'une requête externe transmet la clé de service via l'en-tête Authorization (`Authorization: Bearer <service_key>`), le middleware d'authentification effectue automatiquement les opérations suivantes :
1. Valide la clé à l'aide d'une comparaison en temps constant afin d'empêcher les attaques temporelles (timing attacks).
2. Accorde un accès de niveau administrateur, en définissant l'appelant sur `{ uid: "service", roles: ["admin"] }`.
3. Injecte un `DataDriver` scopé sur cette même identité de service. La sécurité au niveau des lignes (Row-Level Security ou RLS) s'applique toujours — elle est évaluée en tant que `{ uid: "service", roles: ["admin"] }`, et non ignorée.

### Auto-authentification interne

Si vous n'avez pas configuré de `REBASE_SERVICE_KEY`, Rebase génère une **clé interne aléatoire à chaque démarrage**. Le singleton `rebase` utilise automatiquement cette clé lors de l'appel des API du plan de contrôle du serveur lui-même (comme `rebase.auth` ou `rebase.storage`). Cela signifie que votre logique côté serveur peut toujours effectuer des tâches administratives, même sans clé de service configurée manuellement.

## Accès à la base de données et aux services

### 1. Le driver scopé sur l'utilisateur — pour tout ce qui sert une requête

`getDriver(c)` renvoie le driver **scopé sur l'appelant**, de sorte que chaque lecture et écriture est évaluée par rapport à vos politiques de Row-Level Security en tant que cet utilisateur :

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

`requireDriver(c)` correspond à `getDriver(c)` sans le `!` — elle lève une erreur précisant le problème de raccordement au lieu d'échouer vingt lignes plus tard sur un `undefined`.

`fetchCollection` et `fetchOne` renvoient les lignes renvoyées par `GET /api/data/<table>` : les dates sous forme de chaînes RFC 3339, un `belongsTo` sous forme de sa clé étrangère (`authorId`), et une ligne liée uniquement lorsque `include` la mentionne — `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

### 2. `rebase.dataAsAdmin` — pour les tâches de fond de confiance

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

### Driver scopé RLS vs Singleton Rebase

|                     | `getDriver(c)` (request-scoped)                | `rebase.dataAsAdmin` (service identity)                          |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **S'exécute en tant que** | L'appelant (`uid`, ses rôles)                | `{ uid: "service", roles: ["admin"] }`                            |
| **Application de la RLS** | ✅ Oui (évaluée par rapport à l'appelant)          | ✅ Oui (évaluée par rapport à l'identité de service)                   |
| **Idéal pour...**    | Opérations CRUD utilisateur générales, recherche et requêtes | Tâches de fond, déclencheurs système, webhooks                        |
| **Style d'API**       | Méthodes au niveau du driver (`fetchCollection`, `save`) | Accesseurs de table fluides (`rebase.dataAsAdmin.jobs.find`) |

#### Ce qu'est précisément `dataAsAdmin`

`rebase.dataAsAdmin` est **scopé administrateur, il ne contourne pas la RLS**. Le driver est scopé une seule fois, au démarrage, avec `withAuth({ uid: "service", roles: ["admin"] })`, de sorte que chaque lecture et écriture s'exécute dans une transaction ayant basculé sur le rôle restreint `rebase_user` avec `app.uid = 'service'`. Vos politiques sont évaluées — par rapport à cette identité.

Pour la plupart des projets, la distinction n'apparaît jamais, car les politiques par défaut injectées par Rebase sur chaque table acceptent `serverContext() OR rolesOverlap(['admin'])`, et l'identité de service valide la seconde branche. Elle se manifeste dès lors que vous écrivez vos propres politiques :

- **`policy.serverContext()` est faux pour lui.** Ce helper se compile en `rebase.uid() IS NULL`, et le `uid` de cet accesseur est `'service'`. Une table avec `defaultPolicies: false` dont la seule règle d'écriture est `serverContext()` refusera une écriture de `dataAsAdmin` avec l'erreur Postgres `42501`, et une lecture sur une telle collection renvoie **zéro ligne avec un HTTP 200** — le cas silencieux. Écrivez `rolesOverlap(["admin"])` (ou ajoutez-le à côté) lorsque vous voulez dire « mon backend ».
- **Sa portée équivaut à celle d'un utilisateur `admin`.** Accorder le rôle `admin` à un utilisateur de l'application lui donne accès exactement aux lignes que cet accesseur voit. Il ne s'agit pas d'un canal privé.

### 3. `getSql(c)` — Du SQL en tant qu'appelant

Lorsque le SDK n'exprime pas une requête ou une écriture de manière optimale — un upsert conditionnel, un compare-and-swap `UPDATE … WHERE rev = $3 RETURNING`, un `count(*) FILTER (…)`, une CTE — écrivez le SQL et exécutez-le en tant qu'appelant :

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

L'instruction s'exécute dans la propre transaction de l'appelant, sous le rôle restreint `rebase_user` avec son identité — la transaction que le driver scopé sur l'utilisateur ouvre — de sorte que les règles `rls` de vos tables décident de chaque ligne, exactement comme pour le SDK. Une requête demandant toutes les lignes n'obtient que celles de l'appelant.

- **En lecture seule par défaut.** Passez `{ write: true }` pour insérer, mettre à jour ou supprimer ; les politiques d'insertion et de mise à jour s'appliquent toujours.
- **Le texte de la requête est le vôtre ; les valeurs vont dans `params`** (`$1`, `$2`, …). L'identité de l'appelant réside dans les paramètres de transaction, que le SQL peut modifier ; une instruction susceptible de le faire — `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, ou plusieurs instructions — est donc rejetée avec `400 SQL_NOT_ALLOWED` avant son exécution. Interpoler des entrées utilisateur dans le texte reviendrait à mettre ce garde à l'épreuve ; ne le faites pas.
- **Ce qu'il partage avec le SDK.** Les politiques, ainsi que trois règles appliquées par Postgres pour les deux : une [vue matérialisée](/docs/collections/views/#materialized-views) ne sert ses lignes qu'à ses `roles`, une ligne d'une table déclarant `tenant` ne peut pas être déplacée vers un autre tenant sauf par un appelant `bypassRoles` (`TENANT_IMMUTABLE`), et les fonctions internes du serveur (`rebase.record_history`, `rebase.enqueue_job`) sont refusées. Une colonne que l'appelant ne peut pas lire — `.private()`, ou un `.access({ read })` dont il ne dispose pas — est retirée des lignes, tout comme l'API la retire, lorsqu'il s'agit d'une référence directe à la colonne (`SELECT *`, `password_hash AS h`) ; une valeur *calculée* à partir de celle-ci (`md5(password_hash)`) n'est pas reconnue, évitez donc d'effectuer des calculs à partir de celle-ci.
- **Ce qu'il ne partage pas.** `beforeQuery` et `afterRead`, la validation, les hooks de sauvegarde et l'historique résident dans Node et ne s'exécutent pas.

Depuis un script, [`openRebase`](/docs/backend/embedding-postgres-driver/) vous offre la même chose : `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` — Du SQL en tant qu'identité de service

Une fonction qui applique ses propres règles (un ticket par jour, une vérification de timing) sur des tables que seuls les administrateurs peuvent lire ne peut pas utiliser `getSql(c)` : l'appelant aurait besoin de politiques qui l'autorisent, et ces mêmes politiques ouvriraient également les tables sur l'API publique de données. `rebase.sqlAsAdmin` exécute l'instruction en tant que `{ uid: "service", roles: ["admin"] }`, l'identité utilisée par `rebase.dataAsAdmin`, sous la même sécurité au niveau des lignes :

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

C'est `getSql(c)` avec une identité différente : le rôle de requête restreint, la branche admin de vos politiques, en lecture seule sauf mention de `{ write: true }`, et le même garde `SQL_NOT_ALLOWED`. Contrairement au `rebase.sql()` du propriétaire (owner), il ne peut pas exécuter de DDL, et concernant le magasin d'authentification, il n'accède qu'à ce qu'un administrateur peut atteindre via la collection des utilisateurs : les sessions, clés et secrets MFA sont masqués au rôle de requête, et le hachage du mot de passe est retiré des lignes. Une instruction isolée coûte un aller-retour (round trip), tout comme `rebase.sql()`. Depuis un script, `openRebase()` le propose également.

### 4. `rebase.sql()` — SQL propriétaire (owner), et le seul accesseur réservé à Node

Si vous avez réellement besoin d'un contournement inconditionnel, `rebase.sql()` est la solution : du SQL brut sur la connexion propriétaire, aucune politique, toutes les lignes. C'est l'élément le plus privilégié dans le contexte d'une fonction — plus encore que l'accesseur comportant « admin » dans son nom.

Il n'est pas destiné à créer des tables. Une table est [déclarée](/docs/schema/) avec `defineTable` dans `backend/schema/` et créée au démarrage ; une table créée avec `CREATE TABLE` dans une fonction ne dispose d'aucune validation, hook, posture de sécurité au niveau des lignes, vue d'administration ou typage SDK. `rebase.sql()` exécutera une telle instruction, mais consignera un avertissement indiquant la table à déclarer à la place.

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

Il s'exécute sur une connexion TCP vers votre base de données, ce qui en fait le seul accesseur lié à un processus Node. Cela ne coûte rien sur aucun des déploiements actuels — c'est simplement la seule chose à savoir si une fonction est amenée à être déplacée ultérieurement. Voir [Portabilité du runtime](#portabilité-du-runtime).

:::caution[L'accès direct à Drizzle est réservé à Node]
Vous pouvez également importer votre propre instance Drizzle et l'interroger directement (`db.execute(sql\`…\`)`). Cela fonctionne, et sur un déploiement Node auto-hébergé ou managé, c'est parfaitement acceptable.

Il convient de mesurer ce que cela implique : une fonction qui importe `drizzle-orm` et un pool `pg` est définitivement une fonction Node, elle contourne les hooks de vos tables exécutés par `rebase.data` (aucun des deux ne vérifie `.validate()`, qui s'applique aux [requêtes API](/docs/collections/validation-and-conditions/#where-validation-runs)), et elle tire sa connexion d'ailleurs que de la requête. `rebase.sql()` vous offre le même SQL brut via la propre connexion du framework, et `getSql(c)` vous le fournit sous les politiques de l'appelant. Privilégiez ces options.
:::

## Configuration et secrets

Lisez la configuration **à l'intérieur** du gestionnaire, jamais au niveau de la portée du module (module scope) :

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

Une lecture au niveau du module est évaluée lorsque le fichier est importé, avant même qu'une requête n'existe. Sur Node, cela signifie qu'une seule variable manquante fait planter tout le fichier et toutes les routes qu'il contient. Sur un hébergeur qui rattache la configuration à la requête plutôt qu'au processus, il n'y a absolument rien à lire au moment de l'importation.

- `getEnv(c)` — toutes les variables visibles pour cette requête
- `env(c, "NAME")` — une variable, nettoyée des espaces superflus ; une valeur vide est considérée comme non définie
- `requireEnv(c, "NAME")` — identique, mais lève une erreur mentionnant le nom de la variable
- `lazyResource(factory)` — instancie un client coûteux une seule fois, lors de sa première utilisation

`rebase doctor` signale les lectures de `process.env` au niveau du module dans votre répertoire de fonctions.

## Tâches de fond

Déplacé vers sa propre page : [Tâches de fond](/docs/backend/background-work/).

## Portabilité du runtime

Une fonction personnalisée est une application Hono, donc sa capacité à s'exécuter ailleurs que dans un processus Node dépend de ce que son propre fichier importe. `rebase.sql()`, un client de base de données importé directement et les modules intégrés de Node la lient à Node ; le reste de `rebase` et la plateforme web ne le font pas, et rien n'échoue aujourd'hui à cause de l'un ou de l'autre. [Portabilité du runtime](/docs/backend/runtime-portability/) énumère ce qui est portable, la façon dont `rebase build` et `rebase doctor` le signalent, et comment adapter le code en fonction du runtime.

## Ordre d'enregistrement des routes

Les fonctions personnalisées sont chargées et montées **après** que `initializeRebaseBackend()` a terminé la configuration de base. L'ordre d'initialisation est le suivant :

1. **Bootstrappers** — Connexions à la base de données, tables d'authentification, services temps réel
2. **Routes d'authentification** — `/api/auth/*`, `/api/admin/*`
3. **Routes de stockage** — `/api/storage/*`
4. **Routes de données** — `/api/data/*` (CRUD pour les tables)
5. **Fonctions personnalisées** ← `/api/functions/*`
6. **Tâches cron** — `/api/admin/cron/*`
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
Les routes que vous ajoutez ainsi à votre propre application se trouvent **en dehors** de tout routeur Rebase ; aucun middleware d'authentification n'a donc été exécuté dessus et `getDriver(c)` n'est pas défini. Protégez-les avec `requireAuth` / `requireAdmin` importés depuis **`@rebasepro/server`** — la racine du package — qui vérifient le jeton par eux-mêmes. Les gardes situés sur le sous-chemin `/functions` lisent une identité qu'un routeur Rebase a déjà résolue, et répondront par un code 500 plutôt que de feindre qu'une identité existe.
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

Lorsque les fonctions sont chargées, le démarrage enregistre `Loaded custom functions` avec leur nombre. La ligne propre à chaque fonction est consignée au niveau `debug` (`LOG_LEVEL=debug`) :

```
⚡ Loaded function route: hello
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

Le routeur est monté pour le **répertoire**, et non pour les fonctions qui s'y trouvent. Si l'importation de chaque fichier échoue — une seule variable d'environnement manquante au niveau du module suffit à faire échouer l'ensemble — `GET /api/functions` répond tout de même `200` avec une liste vide accompagnée d'un décompte `skipped`, de sorte que « rien n'a été chargé » se distingue de « ce build n'embarquait aucune fonction ». Le listing lui-même requiert un appelant connecté, une clé d'API détenant le simple scope `functions:invoke`, ou la clé de service — les fonctions restent appelables par quiconque chacune autorise, mais leur inventaire n'est pas public. Les raisons restent consignées dans le journal de démarrage.

## Délais d'expiration et limites de débit

Deux plafonds s'appliquent à `/api/functions/*` :

- **Délai d'expiration de la requête (Request timeout)** — 30 secondes par défaut, répondant par `504` avec le code `FUNCTION_TIMEOUT`. Configurable avec `functionsTimeoutMs` (ou `REBASE_FUNCTIONS_TIMEOUT_MS`) ; `0` le désactive. Le gestionnaire ne peut pas être interrompu depuis l'extérieur, mais il est notifié : `getSignal(c)` issu de `@rebasepro/server/functions` est annulé au moment du 504, transmettez-le donc à `fetch` et à tout élément acceptant un signal (`fetch(url, { signal: getSignal(c) })`). Le travail auquel le signal n'a pas été transmis continue de s'exécuter — le délai d'expiration libère le client et le socket, pas le travail en cours. Le fait que le gestionnaire *continue de tourner* après le 504 est une propriété d'un processus Node persistant, pas une garantie contractuelle ; toute opération devant impérativement se terminer a sa place dans [`waitUntil`](#tâches-de-fond).
- **Limite de débit (Rate limit)** — Les clés d'API et les appelants connectés partagent les quotas de l'API de données. Les appelants anonymes bénéficient de leur propre quota, beaucoup plus généreux (3 000 par fenêtre), car ce routeur est public par défaut pour les récepteurs de webhooks. Modifiez cette valeur avec `rateLimit.anonymousFunctions` ; `null` la désactive.

Les rejets de promesse non gérés (unhandled rejections) sont consignés dans les logs plutôt que d'être fatals : dans le cas contraire, un appel fire-and-forget dans une fonction mettrait fin à l'ensemble du processus. Définissez `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` pour retrouver le comportement par défaut de Node.

Sur Rebase Cloud, l'edge placé devant vos fonctions a ses propres limites, et l'état au niveau du module, le système de fichiers et les ports sortants se comportent d'une manière qu'il est utile de connaître avant de concevoir votre architecture. Consultez [Runtime backend managé](/docs/deployment/managed-runtime/).

## Prochaines étapes

- **[Vue d'ensemble du backend](/docs/backend)** — Référence complète de la configuration backend
- **[Hooks de table](/docs/collections/callbacks)** — Exécuter de la logique lors de modifications de données
- **[Tâches cron](/docs/backend/cron-jobs)** — Tâches de fond planifiées
