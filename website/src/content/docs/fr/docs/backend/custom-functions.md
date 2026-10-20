---
sourceHash: 49840b693028a89f
title: Fonctions personnalisées
sidebar_label: Fonctions personnalisées
description: Ajoutez des points de terminaison d'API Hono personnalisés aux côtés de vos routes CRUD Rebase. Détectés automatiquement depuis un répertoire, avec un accès complet à l'instance backend.
---

## Vue d'ensemble

Les fonctions personnalisées vous permettent d'ajouter des **routes d'API Hono arbitraires** aux côtés des points de terminaison CRUD générés automatiquement par Rebase. Elles suivent le même modèle de **détection basée sur les fichiers** que les collections et les tâches cron : déposez un fichier TypeScript dans votre répertoire `functions/`, et Rebase le monte automatiquement.

Utilisez les fonctions personnalisées pour :

- **Les points de terminaison de logique métier** — approbations, promotions, flux de travail personnalisés
- **Les intégrations tierces** — webhooks Stripe, commandes Slack, proxys d'API externes
- **Les points de terminaison publics** — formulaires de contact, capture de leads, vérifications de santé (health checks)
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
[Appeler depuis le client](#appeler-depuis-le-client). Une route `GET` est tout
aussi valide ; l'appelant doit alors spécifier `{ method: "GET" }`.

`rebase dev` surveille le répertoire des fonctions, ainsi un fichier ajouté pendant
son exécution est monté au rechargement suivant — sans redémarrage. (Il doit en
être informé : le répertoire est scanné plutôt qu'importé, le watcher ne peut donc pas le déduire.)

## Appeler depuis le client

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // le nom du fichier, sans extension — un seul segment de chemin
    { name: "Ada" }          // corps JSON ; omis pour un GET
);
```

`invoke` construit l'URL, joint le jeton de l'appelant et lève une
erreur `RebaseApiError` en cas de code non-2xx — ainsi, la structure d'erreur propre à la
fonction parvient à l'appelant au lieu d'un simple rejet de `fetch`.

Quatre paramètres supplémentaires au-delà du nom :

```typescript
// Une méthode différente. La charge utile est ignorée pour GET, car GET n'a pas de corps.
await client.functions.invoke("hello", undefined, { method: "GET" });

// Un sous-chemin — `/api/functions/hello/stats`. Il se place ici, jamais dans le nom :
// un nom contenant "/" est refusé plutôt qu'encodé en pourcent dans un 404.
await client.functions.invoke("hello", undefined, { method: "GET", path: "stats" });

// Une chaîne de requête (query string). Passée comme `path`, sans séparateur inséré avant `?`.
await client.functions.invoke("reports", undefined, { method: "GET", path: "?days=30" });

// Une fonction qui répond avec du texte ou un fichier (`c.text(csv)`, `c.body(pdf)`).
// La réponse est lue sous forme de JSON sauf indication contraire : "text" donne une chaîne,
// "blob" un Blob, "response" la Response elle-même avec son corps non lu.
const csv = await client.functions.invoke<string>("export-orders", undefined, { method: "GET", responseType: "text" });
```

:::note
`client.call("functions/hello", payload)` permet également d'atteindre une fonction. Il effectue
toujours un `POST` et, comme `invoke`, il renvoie le corps tel quel — aucun des deux ne cherche à extraire
une clé `data`. Préférez `functions.invoke`, qui accepte une méthode, un sous-chemin et un
`responseType` ; `call` existe pour les routes montées en dehors de `/api/functions`, ce que
`invoke` ne peut pas exprimer.
:::

:::important
Importez depuis **`@rebasepro/server/functions`**, et non depuis `@rebasepro/server`.

Les deux fonctionnent. Le sous-chemin est la surface de développement *portable* : il n'importe rien qui nécessite Node, ainsi une fonction écrite avec celui-ci peut s'exécuter sur n'importe quel environnement d'exécution (runtime) JavaScript. La racine du paquet accède à l'ensemble du framework — la séquence de démarrage, les chargeurs de fichiers, la couche WebSocket — ce qui est adapté pour un point d'entrée de serveur et bien plus que ce dont un gestionnaire de route a besoin. Cela vous fournit également des accesseurs de contexte typés (`getUser`, `getDriver`) au lieu de devoir transtyper manuellement `c.get("user")`.

Voir [Portabilité du runtime](#portabilité-du-runtime) pour le contrat complet.
:::

## Configuration

:::note[Où placer ceci]
**Runtime managé :** rien à configurer — le runtime découvre `backend/functions/` de lui-même (`entry.functions` dans `rebase.json` si vous l'avez déplacé). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` permettent de restreindre celles qu'un processus dessert.
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
2. Valider que chaque export par défaut est une application Hono (duck-typing via `.fetch()` + `.routes`)
3. Monter chaque application sur `/api/functions/<filename>`
4. Appliquer le middleware d'authentification (voir [Authentification](#authentification-et-propagation-du-contexte) ci-dessous)

### Fonctions en tant que valeurs

Sur la version 0.24, les fonctions proviennent uniquement d'un répertoire.

Un répertoire est une manière de produire ce que le serveur dessert : un enregistrement faisant correspondre un segment d'URL à une application Hono. Transmettez cet enregistrement vous-même sous forme de `functions`, ou lisez un répertoire pour le générer avec `loadFunctions` :

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// équivalent à functionsDir :
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Fournissez `functions` ou `functionsDir`, mais pas les deux : le processus de démarrage refuse la présence des deux. `loadFunctions(dir, { onSkip })` vous transmet chaque fichier ignoré, avec la raison associée. `loadFunctionsFromDirectory` et `loadFunctionsWithDiagnostics` fonctionnent toujours, sont dépréciés, et émettent un avertissement unique. De manière autonome, le groupe de fonctions se monte sur n'importe quel chemin avec `app.route("/hooks", backend.routes.functions())`, et `getUser(c)` ainsi que `getDriver(c)` fonctionnent à l'intérieur ; voir [Intégration de serveur personnalisé](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Nommage des fichiers et correspondance des routes

| Fichier | Chemin de montage |
|---------|-------------------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Les fonctions sont découvertes au **premier niveau du répertoire uniquement** — il n'y a pas de récursivité. `functions/admin/users.ts` est compilé par `rebase build` mais n'est jamais monté ; aplatissez plutôt le nom (`functions/admin-users.ts`). Un sous-répertoire est signalé au démarrage et comptabilisé sur le point de terminaison de listage plutôt que d'être ignoré silencieusement.

Fichiers qui sont **ignorés** :

- `index.ts` / `index.js` — réservés
- `*.test.ts` / `*.test.js` — fichiers de test
- `*.d.ts` — déclarations de types
- Les sous-répertoires, et les fichiers `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — signalés comme des problèmes, car le build compile plus de fichiers que le runtime n'en charge

Le nom constitue également l'identité de la fonction partout ailleurs : c'est le segment d'URL, la cible de la portée (scope) `functions:invoke:<name>` dont une clé a besoin pour l'appeler, et la valeur sélectionnée par `REBASE_FUNCTIONS_ONLY` lorsque vous dédiez son propre processus à une fonction.

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

`defineFunction` renvoie exactement l'application Hono que ces exemples construisent manuellement, les trois sont donc interchangeables. Elle vous évite de déclarer `Hono<HonoEnv>` et vous fournit le singleton `rebase` dans le callback.

---

## Sous le capot : le chargeur par duck-typing

Dans un monorepo, vos fonctions peuvent résoudre une copie de Hono différente de celle utilisée par Rebase, et dans ce cas `exported instanceof Hono` sera faux pour un routeur pourtant fonctionnel. Le chargeur vérifie donc la structure à la place (`isHonoLike`) : un objet non nul doté d'une méthode `.fetch` et d'un tableau `.routes`.

### Échappement du compilateur de modules ES

Le chargeur transforme chaque chemin de fichier en URL de fichier (`pathToFileURL(filePath).href`), afin qu'il s'importe de la même manière sous Windows et POSIX, et appelle `import(url)` via `new Function("url", "return import(url)")`, de sorte qu'une compilation TypeScript ne puisse pas le réécrire en un `require()` qui échouerait sous ESM.

---

## Authentification et propagation du contexte

Les fonctions personnalisées sont montées avec le **même middleware d'authentification** que les routes de données, mais avec `requireAuth: false`. Cela signifie que :

- Le JWT de l'utilisateur est **analysé et injecté** dans le contexte s'il est présent
- Mais les requêtes ne sont **pas rejetées** si aucun JWT n'est fourni
- Vous devez **explicitement protéger** les routes nécessitant une authentification

Un appelant qui présente un *mauvais* jeton n'atteint jamais votre gestionnaire : un jeton invérifiable ou expiré est rejeté avec une 401 par le middleware lui-même, garantissant qu'une session expirée ne soit jamais rétrogradée silencieusement en session anonyme.

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

`getUser` renvoie un objet restreint : `uid` est une chaîne de caractères et `roles` est toujours un tableau, quelle que soit la méthode d'authentification utilisée par l'appelant. `getUserId(c)` et `getRoles(c)` sont des raccourcis. `getScopes(c)` correspond à tout ce que l'appelant a le droit de faire, sous la forme de chaînes de [portées (scopes)](/docs/backend/roles-and-scopes/) : pour un utilisateur, le plan de données, les portées propres à l'application et les portées associées à ses rôles ; pour une clé d'API, exactement ce que la clé détient.

### Protéger les routes

```typescript
import { defineFunction, requireAuth, requireAdmin, requireRole, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // Point de terminaison public — aucun garde, tout le monde peut y accéder.
    app.get("/public", (c) => c.json({ message: "Anyone can access this" }));

    // 401 pour les appelants anonymes.
    app.post("/protected", requireAuth, (c) => c.json({ message: `Hello, ${getUserId(c)}` }));

    // 401 anonyme, 403 sans le rôle admin. L'ordre compte.
    app.post("/admin-only", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

    // N'importe lequel des rôles spécifiés.
    app.post("/publish", requireAuth, requireRole("editor", "admin"), (c) => c.json({ ok: true }));
});
```

Placez les gardes dans le **propre slot de middleware de la route**, comme illustré ci-dessus, plutôt que d'utiliser `app.use("/*", requireAuth)`. `use()` ne couvre que les routes déclarées *en dessous* de lui, de sorte qu'une route ajoutée plus tard — tout en bas du fichier, des mois après — se retrouverait silencieusement non protégée.

:::important
Lire `getUser(c)` ne constitue **pas** une protection. Un appelant anonyme reçoit `undefined` et votre gestionnaire s'exécute quand même. Seul un garde, ou un `if (!user) return 401` explicite, bloque la requête.
:::

### Portées et portées d'application

`requireAdmin` autorise le rôle `admin` et personne d'autre. Pour une action qu'un rôle plus restreint ou une clé d'API doit pouvoir atteindre, protégez la route avec `requireScope`. Elle accepte une [portée](/docs/backend/roles-and-scopes/) intégrée, ou une portée déclarée par l'application sous `auth.scopes` dans la collection des utilisateurs, par exemple `"project:deploy": { label: "Deploy projects", target: "project" }` :

```typescript
import { defineFunction, requireAuth, requireScope, hasScope } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // 403 SCOPE_MISSING sauf si l'appelant détient project:deploy, ou project:deploy:<ce projet>.
    app.post("/:project", requireAuth, requireScope("project:deploy", c => c.req.param("project")), (c) => {
        return c.json({ deploying: c.req.param("project") });
    });

    // La même vérification à l'intérieur d'un gestionnaire.
    app.get("/:project/can-deploy", requireAuth, (c) => c.json({ allowed: hasScope(c, "project:deploy", c.req.param("project")) }));
});
```

Chaque personne connectée détient toutes les portées d'application, ainsi, pour une personne, `requireScope` ne décide de rien : vérifiez dans le gestionnaire si cette personne peut déployer ce projet. Ce que la portée apporte, c'est un moyen de **restreindre une clé** : une clé détenant `project:deploy:p1` ne passera que pour `p1`. Une clé a également besoin de `functions:invoke`, ou `functions:invoke:<name>`, avant même de pouvoir atteindre la fonction. Voir [Portées d'application](/docs/backend/roles-and-scopes/#app-scopes).

### Authentification par clé de service

Rebase prend en charge une clé statique `REBASE_SERVICE_KEY` définie dans votre `.env` pour les appels de scripts ou de serveur à serveur.

Lorsqu'une requête externe transmet la clé de service via l'en-tête Authorization (`Authorization: Bearer <service_key>`), le middleware d'authentification effectue automatiquement ce qui suit :
1. Valide la clé en utilisant une comparaison en temps constant afin d'éviter les attaques temporelles.
2. Accorde un accès de niveau administrateur, en définissant l'appelant sur `{ uid: "service", roles: ["admin"] }`.
3. Injecte un `DataDriver` scopé avec cette même identité de service. La sécurité au niveau des lignes (RLS) s'applique toujours — elle est évaluée comme étant `{ uid: "service", roles: ["admin"] }`, elle n'est pas ignorée.

### Auto-authentification interne

Si vous n'avez pas configuré de `REBASE_SERVICE_KEY`, Rebase génère une **clé interne aléatoire par démarrage**. Le singleton `rebase` utilise automatiquement cette clé lors des appels aux propres API du plan de contrôle du serveur (comme `rebase.auth` ou `rebase.storage`). Cela signifie que votre logique côté serveur peut toujours effectuer des tâches administratives, même sans clé de service configurée manuellement.

## Accéder à la base de données et aux services

### 1. Le driver scopé à l'utilisateur — pour tout ce qui répond à une requête

`getDriver(c)` renvoie le driver **scopé à l'appelant**, de sorte que chaque lecture et écriture est évaluée par rapport à vos politiques de sécurité au niveau des lignes (RLS) en tant que cet utilisateur :

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

`requireDriver(c)` est identique à `getDriver(c)` sans le `!` — il lève une erreur explicite nommant le problème de configuration au lieu d'échouer vingt lignes plus bas sur `undefined`.

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

### Driver scopé RLS vs Singleton Rebase

|                     | `getDriver(c)` (scopé à la requête)           | `rebase.dataAsAdmin` (identité de service)                       |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **S'exécute en tant que** | L'appelant (`uid`, ses rôles)            | `{ uid: "service", roles: ["admin"] }`                            |
| **Application RLS** | ✅ Oui (évaluée par rapport à l'appelant)      | ✅ Oui (évaluée par rapport à l'identité de service)              |
| **Idéal pour...**   | CRUD utilisateur général, recherche et requêtes | Tâches de fond, déclencheurs système, webhooks                   |
| **Style d'API**     | Méthodes niveau driver (`fetchCollection`, `save`) | Accesseurs de collection fluents (`rebase.dataAsAdmin.jobs.find`) |

#### Ce qu'est précisément `dataAsAdmin`

`rebase.dataAsAdmin` est **scopé administrateur, il ne contourne pas le RLS**. Le driver est scopé une fois, au démarrage, avec `withAuth({ uid: "service", roles: ["admin"] })`, ainsi chaque lecture et écriture s'exécute au sein d'une transaction ayant basculé vers le rôle restreint `rebase_user` avec `app.uid = 'service'`. Vos politiques sont évaluées — par rapport à cette identité.

Pour la plupart des projets, la distinction n'apparaît jamais, car les politiques par défaut que Rebase injecte sur chaque collection acceptent `serverContext() OR rolesOverlap(['admin'])`, et l'identité de service remplit la seconde condition. Elle apparaît dès lors que vous écrivez vos propres politiques :

- **`policy.serverContext()` est faux pour lui.** Cet helper compile en `rebase.uid() IS NULL`, or le `uid` de cet accesseur est `'service'`. Une collection avec `disableDefaultPolicies: true` dont la seule règle d'écriture est `serverContext()` refusera une écriture via `dataAsAdmin` avec l'erreur Postgres `42501`, et une lecture sur une telle collection renverra **zéro ligne avec un HTTP 200** — le cas silencieux. Écrivez `rolesOverlap(["admin"])` (ou ajoutez-le en parallèle) lorsque vous voulez dire "mon backend".
- **Sa portée est égale à celle d'un utilisateur `admin`.** Accorder le rôle `admin` à un utilisateur de l'application lui donne accès exactement aux mêmes lignes que celles vues par cet accesseur. Il ne s'agit pas d'un canal privé.

### 3. `rebase.sql()` — SQL brut, et le seul accesseur réservé à Node

Si vous avez véritablement besoin d'un contournement inconditionnel, `rebase.sql()` est fait pour cela : du SQL brut sur la connexion propriétaire, aucune politique, toutes les lignes. C'est l'élément le plus privilégié dans le contexte d'une fonction — encore plus que l'accesseur comportant "admin" dans son nom.

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

Il s'exécute sur une connexion TCP vers votre base de données, ce qui en fait le seul accesseur lié à un processus Node. Cela ne coûte rien sur les déploiements existant aujourd'hui — c'est simplement l'élément à garder à l'esprit si une fonction doit être migrée ultérieurement. Voir [Portabilité du runtime](#portabilité-du-runtime).

:::caution[L'accès direct à Drizzle est réservé à Node]
Vous pouvez également importer votre propre instance de Drizzle et l'interroger directement (`db.execute(sql\`…\`)`). Cela fonctionne, et sur un déploiement Node auto-hébergé ou managé, cela ne pose pas de problème.

Il est important de savoir ce que cela implique : une fonction qui importe `drizzle-orm` et un pool `pg` est définitivement une fonction dépendante de Node, elle contourne les callbacks de vos collections (que `rebase.data` exécute — aucun des deux ne vérifie `validation`, qui s'applique aux [requêtes d'API](/docs/collections/validation-and-conditions/#where-validation-runs)), et elle tire sa connexion d'ailleurs que de la requête. `rebase.sql()` vous offre le même SQL brut à travers la propre connexion du framework. Privilégiez-le.
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

Pourquoi cela importe sur **n'importe quel** runtime, y compris Node :

```typescript no-verify
// À ne pas faire. Si STRIPE_SECRET_KEY n'est pas définie, cela lève une erreur pendant
// l'importation du fichier — et le chargeur signale cela comme une *fonction ignorée*.
// La route renvoie une 404, avec la raison perdue au milieu des logs de démarrage.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Une lecture au niveau du module est évaluée lors de l'importation du fichier, avant même qu'une requête n'existe. Sur Node, cela signifie qu'une seule variable manquante bloque l'ensemble du fichier et toutes les routes qu'il contient. Sur un hébergeur qui rattache la configuration à la requête plutôt qu'au processus, il n'y a tout simplement rien à lire au moment de l'import.

- `getEnv(c)` — toutes les variables visibles pour cette requête
- `env(c, "NAME")` — une variable, nettoyée des espaces ; vide équivaut à non définie
- `requireEnv(c, "NAME")` — identique, mais lève un message nommant la variable manquante
- `lazyResource(factory)` — instancie un client coûteux une seule fois, lors de sa première utilisation

`rebase doctor` signale les lectures de `process.env` situées au niveau du module dans votre répertoire de fonctions.

## Travail en arrière-plan

Le travail qui doit se poursuivre après l'envoi de la réponse doit être placé dans `waitUntil` :

```typescript
import { defineFunction, requireAuth, waitUntil } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/orders", requireAuth, async (c) => {
        const order = await c.req.json();
        // L'appelant n'attend pas cela, mais l'arrêt du serveur (shutdown) l'attendra.
        waitUntil(c, rebase.email.send({
            to: "warehouse@example.com",
            subject: "New order",
            html: "<p>Pick and pack</p>"
        }));
        return c.json({ received: true });
    });
});
```

Une promesse non attendue (sans await) semble équivalente, mais ne l'est pas. `waitUntil` apporte deux avantages :

- **Sur Node**, la promesse est suivie, ainsi un arrêt gracieux l'attendra au lieu que le processus ne se termine brutalement au milieu de l'envoi d'un webhook. Une promesse flottante lors d'un `SIGTERM` est purement et simplement perdue.
- **Sur un hébergeur basé sur des isolats (isolates)**, l'hébergeur est notifié de maintenir l'isolat actif jusqu'à ce que la promesse soit résolue. Sans cela, le travail est interrompu dès que la réponse est envoyée — silencieusement, avec un code 200 impeccable dans les logs.

Un rejet de promesse est journalisé plutôt que d'être laissé au gestionnaire général des rejets non gérés, ce qui permet à l'erreur de nommer la route dont elle provient.

## Portabilité du runtime

Une fonction personnalisée est une application Hono, et Hono fonctionne sur tous les runtimes de serveurs JavaScript. La possibilité pour *votre* fonction de s'exécuter ailleurs que sur un processus Node dépend donc de ce que son propre fichier importe et manipule.

Rien de ce qui est mentionné ici ne constitue une restriction sur ce que vous pouvez écrire aujourd'hui. Chaque déploiement Rebase est un processus Node, une fonction qui lit un fichier ou ouvre un socket est tout à fait valable, et aucun build ni déploiement n'échouera à cause de cela. Ces éléments sont documentés afin que vous ayez la visibilité dès maintenant plutôt que de la découvrir fichier par fichier plus tard.

**Portable — fonctionne sur tous les runtimes :**

- Tout ce qui est exporté depuis `@rebasepro/server/functions`
- `getDriver(c)` et `rebase.dataAsAdmin` — les deux utilisent le même canal de communication où qu'ils s'exécutent
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — la plateforme web standard
- Toute dépendance qui n'a pas besoin de Node

**Réservé à Node :**

- `rebase.sql()` — la connexion propriétaire à la base de données est un socket TCP
- Un client Drizzle/`pg`/`mongodb` directement importé, pour la même raison
- Les modules intégrés de Node : `fs`, `path`, `crypto` (le module Node — `globalThis.crypto` est portable), `child_process`, …
- Les paquets construits sur ceux-ci : `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bugs latents sur tous les runtimes** — il est fortement recommandé de les corriger dans tous les cas :

- Lecture de `process.env` au niveau du module (voir [Configuration et secrets](#configuration-et-secrets))
- Promesses de type "fire-and-forget" sans passer par [`waitUntil`](#travail-en-arrière-plan)
- Compter sur le fait qu'un gestionnaire continue de tourner après l'expiration du délai de sa requête (timeout). Sur Node, c'est le cas ; c'est une propriété inhérente au processus, pas une garantie offerte par le framework

### Vérifier vos propres fonctions

`rebase build` affiche une ligne par élément d'action détecté et consigne le verdict par fonction dans le manifeste du bundle :

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

### Si vous avez besoin d'une branche spécifique au runtime

`runtimeKey()` renvoie `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` ou `"other"` ; `isNodeRuntime()` est la vérification la plus courante. Utilisez-les pour dégrader gracieusement le service, et non pour dupliquer une implémentation — une fonction nécessitant deux implémentations distinctes correspond en réalité à deux fonctions.

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

Les fonctions personnalisées sont chargées et montées **après** que `initializeRebaseBackend()` a terminé la configuration de base. L'ordre d'initialisation est le suivant :

1. **Amorceurs (Bootstrappers)** — Connexions à la base de données, tables d'authentification, services temps réel
2. **Routes d'authentification** — `/api/auth/*`, `/api/admin/*`
3. **Routes de stockage** — `/api/storage/*`
4. **Routes de données** — `/api/data/*` (CRUD pour les collections)
5. **Fonctions personnalisées** ← `/api/functions/*`
6. **Tâches cron** — `/api/admin/cron/*`
7. **WebSocket** — Abonnements temps réel

Cela signifie que vos fonctions personnalisées ont accès à tous les services initialisés. Enregistrez les routes qui doivent s'exécuter **avant** Rebase directement sur l'application Hono, avant d'appeler `initializeRebaseBackend()` :

```typescript no-verify
const app = new Hono<HonoEnv>();

// Ceci s'exécute AVANT les routes de Rebase
app.get("/health", (c) => c.json({ status: "ok" }));

// Initialisation de Rebase — enregistre toutes les routes /api/*
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Les routes que vous ajoutez de cette manière à votre propre application sont **en dehors** de tout routeur Rebase ; aucun middleware d'authentification n'a donc été exécuté sur elles et `getDriver(c)` n'est pas défini. Protégez-les avec `requireAuth` / `requireAdmin` importés depuis **`@rebasepro/server`** — la racine du paquet — qui vérifient le jeton eux-mêmes. Les gardes présents sur le sous-chemin `/functions` lisent une identité qu'un routeur Rebase a déjà résolue, et répondront par une 500 plutôt que de feindre qu'une identité existe.
:::

## Exemple : Gestionnaire de webhook

```typescript
import { defineFunction, requireEnv, waitUntil, lazyResource } from "@rebasepro/server/functions";

/** Construit lors de la première requête, à partir de la configuration de celle-ci. */
const secret = lazyResource((env) => env.STRIPE_WEBHOOK_SECRET ?? "");

export default defineFunction((app, { rebase }) => {
    // Délibérément public : Stripe n'a pas de jeton à envoyer. La signature fait office
    // d'authentification, vérifiez-la donc avant toute autre opération.
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
            // Le traitement peut se poursuivre après la réponse ; le code 200 indique à Stripe de ne pas réessayer.
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

Le routeur est monté pour le **répertoire**, et non pour les fonctions individuelles qui s'y trouvent. Si chaque fichier échoue à l'import — une seule variable d'environnement manquante à la racine d'un module suffit à tous les faire échouer — `GET /api/functions` répondra tout de même par un `200` avec une liste vide accompagnée du nombre d'éléments ignorés (`skipped`). Ainsi, l'état "rien n'a pu être chargé" peut être distingué de "ce build ne comportait aucune fonction". Le listage lui-même nécessite un appelant connecté, une clé d'API détenant la simple portée `functions:invoke`, ou la clé de service — les fonctions restent appelables par quiconque y est autorisé, mais l'inventaire de celles-ci n'est pas public. Les motifs d'échec restent quant à eux visibles dans les logs de démarrage.

## Délais d'expiration et limites de débit (Timeouts & Rate Limits)

Deux limites s'appliquent à `/api/functions/*` :

- **Délai d'expiration de requête (Timeout)** — 30 secondes par défaut, répondant par une `504` avec le code `FUNCTION_TIMEOUT`. Se configure via `functionsTimeoutMs` (ou `REBASE_FUNCTIONS_TIMEOUT_MS`) ; `0` le désactive. L'exécution du gestionnaire ne peut pas être stoppée depuis l'extérieur, mais elle en est notifiée : `getSignal(c)` de `@rebasepro/server/functions` est annulé au moment de la 504. Transmettez-le donc à `fetch` et à tout élément acceptant un signal (`fetch(url, { signal: getSignal(c) })`). Les tâches auxquelles le signal n'a pas été transmis continuent de s'exécuter — le timeout libère le client et le socket, pas le traitement. Le fait que le gestionnaire *continue de tourner* après la 504 est une propriété propre aux processus Node durables, et non une garantie contractuelle ; toute opération devant impérativement se terminer doit être placée dans [`waitUntil`](#travail-en-arrière-plan).
- **Limite de débit (Rate limit)** — Les appelants avec clé d'API ou connectés partagent les quotas de l'API de données. Les appelants anonymes bénéficient de leur propre quota, bien plus souple (3000 par fenêtre), car ce routeur est public par défaut pour la réception de webhooks. Modifiez ce comportement avec `rateLimit.anonymousFunctions` ; `null` le désactive.

Les rejets de promesses non gérés sont journalisés plutôt que d'être fatals : un appel "fire-and-forget" non intercepté dans une fonction mettrait autrement fin à tout le processus. Définissez `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` pour retrouver le comportement par défaut de Node.

Sur Rebase Cloud, la couche réseau en amont (edge) de vos fonctions applique ses propres limites, et l'état au niveau des modules, le système de fichiers ainsi que les ports sortants se comportent de manières qu'il est bon de connaître avant de concevoir votre architecture. Voir [Runtime backend managé](/docs/deployment/managed-runtime/).

## Prochaines étapes

- **[Vue d'ensemble du backend](/docs/backend)** — Référence complète de la configuration du backend
- **[Callbacks d'entités](/docs/collections/callbacks)** — Exécutez de la logique lors des modifications de données
- **[Tâches Cron](/docs/backend/cron-jobs)** — Tâches d'arrière-plan planifiées
