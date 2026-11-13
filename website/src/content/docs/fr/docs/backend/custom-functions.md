---
sourceHash: bc87b4afd43a6b60
title: Fonctions personnalisées
sidebar_label: Fonctions personnalisées
description: Ajoutez des points de terminaison d'API Hono personnalisés aux côtés de vos routes CRUD Rebase. Découverte automatique depuis un répertoire, avec un accès complet à l'instance backend.
---

## Vue d'ensemble

Les fonctions personnalisées vous permettent d'ajouter des **routes d'API Hono arbitraires** aux côtés des points de terminaison CRUD générés automatiquement par Rebase. Elles suivent le même modèle de **découverte basée sur les fichiers** que les collections et les tâches cron : déposez un fichier TypeScript dans votre répertoire `functions/`, et Rebase le monte automatiquement.

Utilisez les fonctions personnalisées pour :

- **Les points de terminaison de logique métier** — validations, promotions, flux de travail personnalisés
- **Les intégrations tierces** — webhooks Stripe, commandes Slack, proxys d'API externes
- **Les points de terminaison publics** — formulaires de contact, capture de prospects, vérifications d'état (health checks)
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

`POST`, car c'est ce que le SDK envoie par défaut — voir [Appel depuis le client](#appel-depuis-le-client). Une route `GET` est tout aussi valide ; l'appelant doit alors spécifier `{ method: "GET" }`.

`rebase dev` surveille le répertoire des fonctions, de sorte qu'un fichier ajouté pendant son exécution est monté au rechargement suivant — sans redémarrage. (Il doit être prévenu : le répertoire est scanné plutôt qu'importé, le surveillant ne peut donc pas le déduire.)

## Appel depuis le client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // le nom du fichier, sans extension — un seul segment de chemin
    { name: "Ada" }          // corps JSON ; omis pour un GET
);
```

`invoke` construit l'URL, attache le jeton de l'appelant et lève une `RebaseApiError` en cas de réponse non-2xx — ainsi, la structure d'erreur propre à la fonction parvient à l'appelant au lieu d'un simple rejet de `fetch`.

Quatre éléments supplémentaires qu'il accepte en plus du nom :

```typescript
// Une méthode différente. La charge utile est ignorée pour GET, car GET n'a pas de corps.
await client.functions.invoke("hello", undefined, { method: "GET" });

// Un sous-chemin — `/api/functions/hello/stats`. Il se place ici, jamais dans le nom :
// un nom contenant "/" est refusé plutôt qu'encodé en pourcent dans une 404.
await client.functions.invoke("hello", undefined, { method: "GET", path: "stats" });

// Une chaîne de requête (query string). Passée dans `path`, sans séparateur inséré avant `?`.
await client.functions.invoke("reports", undefined, { method: "GET", path: "?days=30" });

// Une fonction qui répond du texte ou un fichier (`c.text(csv)`, `c.body(pdf)`).
// La réponse est lue comme du JSON sauf indication contraire : "text" donne une chaîne,
// "blob" un Blob, "response" la Response elle-même avec son corps non lu.
const csv = await client.functions.invoke<string>("export-orders", undefined, { method: "GET", responseType: "text" });
```

:::note
`client.call("functions/hello", payload)` permet également d'atteindre une fonction. Il effectue toujours un `POST`, et comme `invoke`, il renvoie le corps textuellement — aucun des deux ne va chercher une clé `data`. Préférez `functions.invoke`, qui prend une méthode, un sous-chemin et un `responseType` ; `call` existe pour les routes montées en dehors de `/api/functions`, ce que `invoke` ne peut pas exprimer.
:::

:::important
Importez depuis **`@rebasepro/server/functions`**, et non depuis `@rebasepro/server`.

Les deux fonctionnent. Le sous-chemin est la surface de développement *portable* : il n'importe rien qui nécessite Node, donc une fonction écrite avec celui-ci peut s'exécuter sur n'importe quel environnement d'exécution JavaScript. La racine du paquet accède à l'ensemble du framework — la séquence de démarrage, les chargeurs de fichiers, la couche WebSocket — ce qui est adapté à un point d'entrée de serveur et dépasse les besoins d'un gestionnaire de route. Elle vous fournit également des accesseurs de contexte typés (`getUser`, `getDriver`) au lieu de transtyper manuellement `c.get("user")`.

Voir [Portabilité de l'environnement d'exécution](#portabilité-de-lenvironnement-dexécution) pour le contrat complet.
:::

## Configuration

:::note[Emplacement de cette configuration]
**Environnement managé :** rien à configurer — l'environnement découvre `backend/functions/` par lui-même (`functions` dans l'entrée `rebase.json` de l'application backend si vous l'avez déplacée). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` restreignent celles qu'un processus `REBASE_ROLE=functions` dessert ; tout autre rôle refuse de démarrer si elles sont définies.
**Éjecté :** `initializeRebaseBackend({ functionsDir })`, ou `functions` (ci-dessous), dans `backend/src/index.ts`.
:::

Activez les fonctions personnalisées en ajoutant `functionsDir` à votre configuration backend :

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... autre configuration
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase va :

1. Scanner le répertoire à la recherche de fichiers `.ts` / `.js`
2. Valider que chaque export par défaut est une application Hono (vérification par duck-typing via `.fetch()` + `.routes`)
3. Monter chaque application sur `/api/functions/<filename>`
4. Appliquer le middleware d'authentification (voir [Authentification](#authentification-et-propagation-du-contexte) ci-dessous)

### Fonctions en tant que valeurs

Un répertoire est une manière de produire ce que le serveur dessert : un registre associant un segment d'URL à une application Hono. Passez ce registre vous-même sous forme de `functions`, ou lisez un répertoire pour le générer avec `loadFunctions` :

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// équivalent à functionsDir :
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Fournissez `functions` ou `functionsDir`, mais pas les deux : le démarrage refuse la combinaison. `loadFunctions(dir, { onSkip })` vous transmet chaque fichier ignoré, avec la raison. `loadFunctionsFromDirectory` et `loadFunctionsWithDiagnostics` fonctionnent toujours, sont dépréciés et émettent un avertissement unique. De manière autonome, le groupe de fonctions se monte sur n'importe quel chemin avec `app.route("/hooks", backend.routes.functions())`, et `getUser(c)` ainsi que `getDriver(c)` fonctionnent à l'intérieur ; voir [Intégration d'un serveur personnalisé](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Nommage des fichiers et mappage des routes

| Fichier | Chemin de montage |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Les fonctions sont découvertes au **premier niveau du répertoire uniquement** — il n'y a pas de récursivité. `functions/admin/users.ts` est compilé par `rebase build` mais jamais monté ; aplatissez plutôt le nom (`functions/admin-users.ts`). Un sous-répertoire est signalé au démarrage et comptabilisé sur le point de terminaison de liste plutôt qu'ignoré silencieusement.

Fichiers qui sont **ignorés** :

- `index.ts` / `index.js` — réservés
- `*.test.ts` / `*.test.js` — fichiers de test
- `*.d.ts` — déclarations de types
- Les sous-répertoires, et les fichiers `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — signalés comme des anomalies, car le build compile plus d'éléments que l'environnement d'exécution n'en charge

Le nom constitue l'identité de la fonction partout ailleurs également : c'est le segment d'URL, la cible de la portée `functions:invoke:<name>` dont une clé a besoin pour l'appeler, et la valeur sélectionnée par `REBASE_FUNCTIONS_ONLY` lorsque vous attribuez à une fonction son propre processus.

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

## Sous le capot : Le chargeur par Duck-Typing

Dans un monorepo, vos fonctions peuvent résoudre une copie de Hono différente de celle utilisée par Rebase, et dans ce cas `exported instanceof Hono` sera faux pour un routeur pourtant fonctionnel. Le chargeur vérifie donc la structure à la place (`isHonoLike`) : un objet non nul doté d'une méthode `.fetch` et d'un tableau `.routes`.

### Échappement du compilateur de modules ES

Le chargeur transforme chaque chemin de fichier en une URL de fichier (`pathToFileURL(filePath).href`), afin qu'il s'importe aussi bien sous Windows que sous POSIX, et appelle `import(url)` via `new Function("url", "return import(url)")`, empêchant ainsi un build TypeScript de le réécrire en un `require()` qui échouerait sous ESM.

---

## Authentification et propagation du contexte

Les fonctions personnalisées sont montées avec le **même middleware d'authentification** que les routes de données, mais avec `requireAuth: false`. Cela signifie que :

- Le JWT de l'utilisateur est **analysé et injecté** dans le contexte s'il est présent
- Mais les requêtes ne sont **pas rejetées** si aucun JWT n'est fourni
- Vous devez **protéger explicitement** les routes qui nécessitent une authentification

Un appelant qui présente un jeton *invalide* n'atteint jamais votre gestionnaire : un jeton invérifiable ou expiré est rejeté avec une erreur 401 par le middleware lui-même, de sorte qu'une session expirée n'est jamais rétrogradée silencieusement en session anonyme.

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

`getUser` renvoie un objet restreint : `uid` est une chaîne et `roles` est toujours un tableau, quelle que soit la méthode d'authentification utilisée par l'appelant. `getUserId(c)` et `getRoles(c)` sont des raccourcis. `getScopes(c)` correspond à tout ce que l'appelant est autorisé à faire, sous forme de chaînes de [portée (scope)](/docs/backend/roles-and-scopes/) : pour un utilisateur, le plan de données, les portées propres à l'application et celles de ses rôles ; pour une clé d'API, exactement ce que détient la clé.

### Le compte de l'appelant

`getUser(c)` lit le jeton d'accès, et le jeton contient l'identifiant, les rôles et l'adresse de l'appelant. Il ne précise pas comment le compte se connecte ni quel est son nom d'affichage. `getUserProfile(c)` lit ces informations depuis le magasin d'authentification :

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

`providers` liste les manières dont le compte peut se connecter : `"password"` lorsqu'il en possède un, puis chaque fournisseur lié (`"google"`, `"apple"`, …) dans l'ordre où il a été associé. Un compte invité, ou un compte qui se connecte uniquement avec un code à usage unique, a une liste vide.

La lecture est actualisée à chaque requête : un fournisseur lié il y a un instant par l'appelant apparaît lors de sa prochaine requête, sans attendre le rafraîchissement du jeton. Le premier appel au sein d'une requête coûte deux recherches par clé, effectuées conjointement. Les appels suivants dans la même requête réutilisent le résultat, et une requête qui ne l'appelle jamais ne coûte rien.

Elle renvoie `undefined` pour un appelant anonyme, pour un appelant par clé de service ou clé d'API n'agissant en tant qu'aucun compte, et pour un compte qui n'existe plus. Elle renvoie également `undefined` sur un backend dont les comptes résident chez un [adaptateur d'authentification](/docs/backend/auth-adapters/) externe : interrogez plutôt ce fournisseur. Lorsqu'un administrateur envoie `x-rebase-impersonate`, elle renvoie le compte usurpé.

### Protection des routes

```typescript
import { defineFunction, requireAuth, requireAdmin, requireRole, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // Point de terminaison public — aucun garde, n'importe qui peut l'appeler.
    app.get("/public", (c) => c.json({ message: "Anyone can access this" }));

    // 401 pour les appelants anonymes.
    app.post("/protected", requireAuth, (c) => c.json({ message: `Hello, ${getUserId(c)}` }));

    // 401 si anonyme, 403 sans le rôle admin. L'ordre compte.
    app.post("/admin-only", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

    // N'importe lequel des rôles spécifiés.
    app.post("/publish", requireAuth, requireRole("editor", "admin"), (c) => c.json({ ok: true }));
});
```

Placez les gardes dans le **slot middleware propre à la route**, comme ci-dessus, plutôt que dans `app.use("/*", requireAuth)`. `use()` ne couvre que les routes déclarées *en dessous* de lui, de sorte qu'une route ajoutée plus tard — tout en bas du fichier, dans plusieurs mois — se retrouverait silencieusement non protégée.

:::important
Lire `getUser(c)` ne constitue **pas** un garde. Un appelant anonyme reçoit `undefined` et votre gestionnaire s'exécute quand même. Seul un garde, ou un `if (!user) return 401` explicite, interrompt la requête.
:::

### Portées (scopes) et portées d'application

`requireAdmin` autorise le rôle `admin` et personne d'autre. Pour une action qu'un rôle plus restreint ou une clé d'API devrait pouvoir atteindre, protégez la route avec `requireScope`. Elle accepte une [portée](/docs/backend/roles-and-scopes/) intégrée, ou une portée déclarée par l'application sous `auth.scopes` sur la collection des utilisateurs, telle que `"project:deploy": { label: "Deploy projects", target: "project" }` :

```typescript
import { defineFunction, requireAuth, requireScope, hasScope } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // 403 SCOPE_MISSING sauf si l'appelant possède project:deploy, ou project:deploy:<ce projet>.
    app.post("/:project", requireAuth, requireScope("project:deploy", c => c.req.param("project")), (c) => {
        return c.json({ deploying: c.req.param("project") });
    });

    // La même vérification à l'intérieur d'un gestionnaire.
    app.get("/:project/can-deploy", requireAuth, (c) => c.json({ allowed: hasScope(c, "project:deploy", c.req.param("project")) }));
});
```

Chaque personne connectée détient toutes les portées de l'application, donc pour un utilisateur humain `requireScope` ne décide de rien : vérifiez dans le gestionnaire si cette personne a le droit de déployer ce projet. Ce que la portée apporte, c'est un moyen de **restreindre une clé** : une clé détenant `project:deploy:p1` ne passera que pour `p1`. Une clé a également besoin de `functions:invoke`, ou `functions:invoke:<name>`, avant même de pouvoir atteindre la fonction. Voir [Portées d'application](/docs/backend/roles-and-scopes/#app-scopes).

### Authentification par clé de service

Rebase prend en charge une clé statique `REBASE_SERVICE_KEY` définie dans votre `.env` pour les scripts ou les appels de serveur à serveur.

Lorsqu'une requête externe transmet la clé de service via l'en-tête Authorization (`Authorization: Bearer <service_key>`), le middleware d'authentification effectue automatiquement les opérations suivantes :
1. Valide la clé à l'aide d'une comparaison en temps constant pour empêcher les attaques temporelles.
2. Accorde un accès de niveau administrateur, en définissant l'appelant sur `{ uid: "service", roles: ["admin"] }`.
3. Injecte un `DataDriver` restreint à cette même identité de service. La sécurité au niveau des lignes (RLS) s'applique toujours — elle est évaluée sous `{ uid: "service", roles: ["admin"] }`, et non ignorée.

### Auto-authentification interne

Si vous n'avez pas configuré de `REBASE_SERVICE_KEY`, Rebase génère une **clé interne aléatoire par démarrage**. Le singleton `rebase` utilise automatiquement cette clé lors des appels aux API du plan de contrôle du serveur lui-même (comme `rebase.auth` ou `rebase.storage`). Cela signifie que votre logique côté serveur peut toujours effectuer des tâches administratives, même sans clé de service configurée manuellement.

## Accéder à la base de données et aux services

### 1. Le driver limité à l'utilisateur — pour tout ce qui répond à une requête

`getDriver(c)` renvoie le driver **associé au contexte de l'appelant**, de sorte que chaque lecture et écriture est évaluée par rapport à vos politiques de sécurité au niveau des lignes (RLS) en tant que cet utilisateur :

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

`requireDriver(c)` est identique à `getDriver(c)` sans le `!` — il lève une exception indiquant le problème de configuration au lieu d'échouer vingt lignes plus bas sur un `undefined`.

<span class="since-badge" data-since="0.31">Depuis 0.31</span> `fetchCollection` et `fetchOne` renvoient les lignes que renvoie `GET /api/data/<table>` : les dates sous forme de chaînes RFC 3339, un `belongsTo` sous forme de sa clé étrangère (`authorId`), et une ligne liée uniquement lorsque `include` la mentionne — `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

### 2. `rebase.dataAsAdmin` — pour les tâches d'arrière-plan de confiance

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

### Driver avec portée RLS vs. Singleton Rebase

|                     | `getDriver(c)` (portée de requête)             | `rebase.dataAsAdmin` (identité de service)                       |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **S'exécute en tant que** | L'appelant (`uid`, ses rôles)            | `{ uid: "service", roles: ["admin"] }`                            |
| **Application RLS** | ✅ Oui (évaluée par rapport à l'appelant)      | ✅ Oui (évaluée par rapport à l'identité de service)             |
| **Idéal pour...**   | CRUD utilisateur classique, recherche, requêtes| Tâches d'arrière-plan, déclencheurs système, webhooks            |
| **Style d'API**     | Méthodes de niveau driver (`fetchCollection`, `save`) | Accesseurs fluides de collections (`rebase.dataAsAdmin.jobs.find`) |

#### Ce qu'est précisément `dataAsAdmin`

`rebase.dataAsAdmin` est **restreint au rôle admin, il ne contourne pas RLS**. Le driver est initialisé une fois, au démarrage, avec `withAuth({ uid: "service", roles: ["admin"] })`, de sorte que chaque lecture et écriture s'exécute au sein d'une transaction ayant basculé sur le rôle restreint `rebase_user` avec `app.uid = 'service'`. Vos politiques sont évaluées — par rapport à cette identité.

Pour la plupart des projets, la distinction n'apparaît jamais, car les politiques par défaut que Rebase injecte sur chaque collection admettent `serverContext() OR rolesOverlap(['admin'])`, et l'identité de service valide la seconde condition. Elle apparaît dès lors que vous écrivez vos propres politiques :

- **`policy.serverContext()` est faux pour lui.** Cet utilitaire compile en `rebase.uid() IS NULL`, et l'`uid` de cet accesseur est `'service'`. Une collection avec `disableDefaultPolicies: true` dont la seule règle d'écriture est `serverContext()` refusera une écriture `dataAsAdmin` avec l'erreur Postgres `42501`, et une lecture sur une telle collection renverra **zéro ligne avec un HTTP 200** — le comportement silencieux. Écrivez `rolesOverlap(["admin"])` (ou ajoutez-le à côté) lorsque vous désignez "mon backend".
- **Sa portée équivaut à celle d'un utilisateur `admin`.** Accorder le rôle `admin` à un utilisateur de l'application lui donne accès exactement aux mêmes lignes que cet accesseur voit. Ce n'est pas un canal privé.

### 3. `getSql(c)` — le SQL en tant qu'appelant

Lorsque le SDK n'exprime pas une requête ou une écriture de manière élégante — un upsert conditionnel, un `UPDATE … WHERE rev = $3 RETURNING` de type compare-and-swap, `count(*) FILTER (…)`, une CTE — écrivez le SQL brut et exécutez-le en tant qu'appelant :

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

L'instruction s'exécute dans la transaction propre à l'appelant, sous le rôle restreint `rebase_user` avec son identité — la transaction que le driver restreint à l'utilisateur ouvre — de sorte que les règles de sécurité de vos collections déterminent chaque ligne, exactement comme pour le SDK. Une requête qui demande toutes les lignes n'obtient que celles de l'appelant.

- **En lecture seule par défaut.** Passez `{ write: true }` pour insérer, mettre à jour ou supprimer ; les politiques d'insertion et de mise à jour s'appliquent toujours.
- **Le texte de la requête vous appartient ; les valeurs vont dans `params`** (`$1`, `$2`, …). L'identité de l'appelant réside dans les paramètres de transaction, que le SQL peut modifier ; une instruction susceptible de le faire — `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, instructions multiples — est refusée avec `400 SQL_NOT_ALLOWED` avant son exécution. Concaténer les entrées utilisateur dans le texte est la façon dont ce garde serait mis à l'épreuve ; ne le faites pas.
- **Ce qu'il partage avec le SDK.** Les politiques, ainsi que trois règles appliquées par Postgres pour les deux : une [vue matérialisée](/docs/collections/views/#materialized-views) ne sert ses lignes qu'à ses `roles`, une ligne d'une table déclarant `tenant` ne peut pas être déplacée vers un autre tenant sauf par un appelant `bypassRoles` (`TENANT_IMMUTABLE`), et les fonctions propres au serveur (`rebase.record_history`, `rebase.enqueue_job`) sont refusées. Une colonne que l'appelant n'a pas le droit de lire — `.private()`, ou un `.access({ read })` dont il ne dispose pas — est retirée des lignes, de la même manière que l'API la retire, lorsqu'il s'agit d'une référence directe à la colonne (`SELECT *`, `password_hash AS h`) ; une valeur *calculée* à partir de celle-ci (`md5(password_hash)`) n'est pas reconnue, ne faites donc pas de calcul à partir d'elle.
- **Ce qu'il ne partage pas.** `beforeQuery` et `afterRead`, la validation, les hooks d'enregistrement et l'historique résident dans Node et ne s'exécutent pas.

Depuis un script, [`openRebase`](/docs/backend/embedding-postgres-driver/) vous offre la même chose : `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` — le SQL en tant qu'identité de service

Une fonction qui applique ses propres règles (un ticket par jour, une vérification temporelle) sur des tables que seuls les administrateurs peuvent lire ne peut pas utiliser `getSql(c)` : l'appelant aurait besoin de politiques qui l'autorisent, et ces mêmes politiques ouvriraient également les tables sur l'API de données publique. `rebase.sqlAsAdmin` exécute l'instruction en tant que `{ uid: "service", roles: ["admin"] }`, l'identité utilisée par `rebase.dataAsAdmin`, sous la même sécurité au niveau des lignes :

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

Il s'agit de `getSql(c)` avec une identité différente : le rôle de requête restreint, la branche administrateur de vos politiques, en lecture seule sauf si `{ write: true }`, et le même garde `SQL_NOT_ALLOWED`. Contrairement au `rebase.sql()` du propriétaire, il ne peut pas exécuter de DDL, et concernant le magasin d'authentification, il n'accède qu'à ce qu'un administrateur atteint via la collection des utilisateurs : les sessions, les clés et les secrets MFA sont masqués au rôle de requête, et le hash de mot de passe est retiré des lignes. Une instruction isolée coûte un aller-retour réseau, tout comme `rebase.sql()`. Depuis un script, `openRebase()` le propose également.

### 4. `rebase.sql()` — le SQL propriétaire, et le seul accesseur réservé à Node

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Si vous avez véritablement besoin d'un contournement inconditionnel, `rebase.sql()` est fait pour cela : du SQL brut sur la connexion propriétaire, sans politiques, accédant à chaque ligne. C'est l'élément le plus privilégié dans le contexte d'une fonction — davantage encore que l'accesseur portant "admin" dans son nom.

Il n'est pas conçu pour créer des tables. Une table est [déclarée](/docs/schema/) avec `defineTable` dans `backend/schema/` et créée au démarrage ; une table créée avec `CREATE TABLE` dans une fonction n'a pas de validation, de hooks, de configuration de sécurité au niveau des lignes, de vue d'administration ou de type SDK. `rebase.sql()` exécutera une telle instruction, mais enregistrera un avertissement indiquant la table à déclarer à la place.

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

Il s'exécute sur une connexion TCP vers votre base de données, ce qui en fait le seul accesseur lié à un processus Node. Cela ne coûte rien sur aucun déploiement existant aujourd'hui — c'est simplement l'élément unique à garder en tête si une fonction doit être déplacée ultérieurement. Voir [Portabilité de l'environnement d'exécution](#portabilité-de-lenvironnement-dexécution).

:::caution[L'accès direct à Drizzle est réservé à Node]
Vous pouvez également importer votre propre instance Drizzle et l'interroger directement (`db.execute(sql\`…\`)`). Cela fonctionne, et sur un déploiement Node auto-hébergé ou managé, cela ne pose pas de problème.

Il est important de savoir ce que cela implique : une fonction qui importe `drizzle-orm` et un pool `pg` est définitivement une fonction Node, elle contourne les hooks de vos tables exécutés par `rebase.data` (aucun des deux ne vérifie `.validate()`, qui s'applique aux [requêtes d'API](/docs/collections/validation-and-conditions/#where-validation-runs)), et elle tire sa connexion d'ailleurs que de la requête. `rebase.sql()` vous fournit le même SQL brut via la propre connexion du framework, et `getSql(c)` vous le fournit sous les politiques de l'appelant. Privilégiez ces derniers.
:::

## Configuration et secrets

Lisez la configuration **à l'intérieur** du gestionnaire, jamais à la racine du module :

```typescript
import { defineFunction, requireEnv, lazyResource } from "@rebasepro/server/functions";

// Construit une seule fois, lors de la première requête qui en a besoin — pas au moment de l'import.
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

Pourquoi cela a de l'importance sur **n'importe quel** environnement d'exécution, y compris Node :

```typescript no-verify
// À ne pas faire. Si STRIPE_SECRET_KEY n'est pas définie, cela lève une erreur pendant
// l'import du fichier — et le chargeur le signale comme une *fonction ignorée*. La route
// renvoie une 404, avec la raison perdue dans une ligne de log au démarrage.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Une lecture au niveau du module est évaluée lorsque le fichier est importé, avant qu'aucune requête n'existe. Sur Node, cela signifie qu'une seule variable manquante fait échouer le fichier entier et toutes les routes qu'il contient. Sur un hébergeur qui rattache la configuration à la requête plutôt qu'au processus, il n'y a absolument rien à lire au moment de l'import.

- `getEnv(c)` — chaque variable visible pour cette requête
- `env(c, "NAME")` — une variable, nettoyée des espaces ; une valeur vide est considérée comme non définie
- `requireEnv(c, "NAME")` — identique, mais lève une exception indiquant le nom de la variable
- `lazyResource(factory)` — instancie un client coûteux une seule fois, à la première utilisation

`rebase doctor` signale les lectures de `process.env` effectuées au niveau du module dans votre répertoire de fonctions.

## Tâches d'arrière-plan

Déplacé vers sa propre page : [Tâches d'arrière-plan](/docs/backend/background-work/).

## Portabilité de l'environnement d'exécution

Une fonction personnalisée est une application Hono ; ainsi, la possibilité de l'exécuter ailleurs que dans un processus Node dépend de ce que son propre fichier importe. `rebase.sql()`, un client de base de données directement importé et les modules intégrés de Node la lient à Node ; le reste de `rebase` et la plateforme web ne le font pas, et rien n'échoue aujourd'hui à cause de l'un ou de l'autre. La page [Portabilité de l'environnement d'exécution](/docs/backend/runtime-portability/) détaille ce qui est portable, comment `rebase build` et `rebase doctor` le signalent, et comment adapter votre code selon l'environnement.

## Ordre d'enregistrement des routes

Les fonctions personnalisées sont chargées et montées **après** que `initializeRebaseBackend()` a terminé la configuration de base. L'ordre d'initialisation est le suivant :

1. **Bootstrappers** — Connexions à la base de données, tables d'authentification, services temps réel
2. **Routes d'authentification** — `/api/auth/*`, `/api/admin/*`
3. **Routes de stockage** — `/api/storage/*`
4. **Routes de données** — `/api/data/*` (CRUD pour les collections)
5. **Fonctions personnalisées** ← `/api/functions/*`
6. **Tâches cron** — `/api/admin/cron/*`
7. **WebSocket** — Abonnements en temps réel

Cela signifie que vos fonctions personnalisées ont accès à tous les services initialisés. Enregistrez directement sur l'application Hono toutes les routes qui doivent s'exécuter **avant** Rebase, préalablement à l'appel de `initializeRebaseBackend()` :

```typescript no-verify
const app = new Hono<HonoEnv>();

// Ceci s'exécute AVANT les routes Rebase
app.get("/health", (c) => c.json({ status: "ok" }));

// Initialisation de Rebase — enregistre toutes les routes /api/*
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Les routes que vous ajoutez ainsi à votre propre application sont **en dehors** de chaque routeur Rebase, aucun middleware d'authentification ne s'est donc exécuté sur elles et `getDriver(c)` n'est pas défini. Protégez-les avec `requireAuth` / `requireAdmin` importés depuis **`@rebasepro/server`** — la racine du paquet — qui vérifient le jeton eux-mêmes. Les gardes du sous-chemin `/functions` lisent une identité qu'un routeur Rebase a déjà résolue, et répondront 500 plutôt que de feindre qu'il en existe une.
:::

## Exemple : Gestionnaire de webhook

```typescript
import { defineFunction, requireEnv, waitUntil, lazyResource } from "@rebasepro/server/functions";

/** Construit lors de la première requête, à partir de la configuration de cette requête. */
const secret = lazyResource((env) => env.STRIPE_WEBHOOK_SECRET ?? "");

export default defineFunction((app, { rebase }) => {
    // Délibérément public : Stripe n'a pas de jeton à envoyer. La signature constitue
    // l'authentification, il faut donc la vérifier avant de faire quoi que ce soit d'autre.
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
            // Le traitement peut se poursuivre après la réponse ; le 200 indique à Stripe de ne pas réessayer.
            waitUntil(c, notifyFulfilment(requireEnv(c, "FULFILMENT_URL"), session));
        }

        return c.json({ received: true });
    });
});

declare function verifySignature(body: string, signature: string, secret: string): boolean;
declare function notifyFulfilment(url: string, session: Record<string, string>): Promise<void>;
```

## Débogage

Lorsque les fonctions se chargent, le démarrage journalise `Loaded custom functions` avec leur nombre. La ligne propre à chaque fonction est journalisée au niveau `debug` (`LOG_LEVEL=debug`) :

```
⚡ Loaded function route: hello
```

Si le chargement échoue, le chargeur fournit un retour de diagnostic :

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

Le routeur est monté pour le **répertoire**, pas individuellement pour les fonctions qu'il contient. Si l'importation de chaque fichier échoue — une seule variable d'environnement manquante au niveau du module suffit à tous les faire échouer — `GET /api/functions` répond toujours `200` avec une liste vide accompagnée d'un décompte `skipped`, ce qui permet de distinguer "rien n'a pu être chargé" de "ce build ne comportait aucune fonction". La liste elle-même nécessite un appelant connecté, une clé d'API détenant la simple portée `functions:invoke`, ou la clé de service — les fonctions restent appelables par quiconque chacune autorise, mais leur inventaire n'est pas public. Les explications détaillées demeurent dans les journaux de démarrage.

## Délais d'expiration et limites de débit (Rate Limits)

Deux limites s'appliquent à `/api/functions/*` :

- **Délai d'expiration de la requête** — 30 secondes par défaut, répondant `504` avec le code `FUNCTION_TIMEOUT`. Configurable via `functionsTimeoutMs` (ou `REBASE_FUNCTIONS_TIMEOUT_MS`) ; `0` le désactive. Le gestionnaire ne peut pas être interrompu depuis l'extérieur, mais il en est informé : `getSignal(c)` de `@rebasepro/server/functions` est annulé au moment de l'erreur 504, vous pouvez donc le passer à `fetch` et à tout ce qui accepte un signal (`fetch(url, { signal: getSignal(c) })`). Les tâches auxquelles le signal n'a pas été transmis continuent — le timeout libère le client et le socket, pas le travail en cours. Le fait que le gestionnaire *continue de tourner* après le 504 est une propriété inhérente à un processus Node persistant, non une garantie du contrat ; tout ce qui doit impérativement aller à son terme a sa place dans [`waitUntil`](#tâches-darrière-plan).
- **Limite de débit (rate limit)** — Les appelants avec clé d'API et connectés partagent les quotas de l'API de données. Les appelants anonymes bénéficient de leur propre quota, bien plus souple (3000 par fenêtre), car ce routeur est public par défaut pour les récepteurs de webhooks. Modifiez-le avec `rateLimit.anonymousFunctions` ; `null` le désactive.

Les rejets de promesse non gérés sont journalisés plutôt que d'être fatals : un appel "fire-and-forget" dans une fonction interromprait sinon l'ensemble du processus. Définissez `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` pour retrouver le comportement par défaut de Node.

Sur Rebase Cloud, l'infrastructure edge placée devant vos fonctions possède ses propres limites, et l'état au niveau du module, le système de fichiers ainsi que les ports sortants se comportent de manières qu'il est bon de connaître avant de concevoir votre architecture. Voir [Environnement d'exécution backend managé](/docs/deployment/managed-runtime/).

## Étapes suivantes

- **[Vue d'ensemble du backend](/docs/backend)** — Référence complète de la configuration du backend
- **[Hooks de table](/docs/collections/callbacks)** — Exécuter de la logique sur les modifications de données
- **[Tâches Cron](/docs/backend/cron-jobs)** — Tâches d'arrière-plan planifiées
