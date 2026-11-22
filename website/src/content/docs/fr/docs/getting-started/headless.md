---
sourceHash: c423ff16c60af471
title: Backend uniquement (headless)
sidebar_label: Backend uniquement
description: Exécutez Rebase en tant que Backend-as-a-Service headless sur votre propre base PostgreSQL — une API REST, l'authentification, le stockage et le temps réel, sans panneau d'administration ni backend/schema.
---

Rebase a deux formes, et cette page présente celle qui n'ouvre jamais de
navigateur : une API REST, l'authentification, le stockage, le temps réel et les
sauvegardes sur une base de données PostgreSQL que vous possédez déjà. Pas de
panneau d'administration, pas de `backend/schema/`. Si vous envisagiez
d'utiliser Supabase ou PostgREST, c'est l'équivalent direct.

Tout ce qui se trouve sur cette page fonctionne également dans le projet complet —
il s'agit du même serveur. Ce que `--headless` retire, c'est le paquet frontend
et les fichiers de tables, pas une fonctionnalité.

## Initialiser le projet

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Un seul workspace, aucun `frontend/` :

| Dossier | Contenu |
|---------|---------|
| `backend/` | `storage.ts` (`storageAuthorize`), vos fonctions personnalisées et tâches cron, ainsi que le `backend/schema/` que `--introspect` écrit lorsque vous le demandez. Il n'y a aucun fichier serveur — le runtime publié démarre le projet |

`--template` n'a aucun effet ici : un preset alimente des tables, et cette
variante n'en a aucune. Node 22.22+, le même prérequis minimal que pour le projet
complet — le `package.json` de la couche headless déclare `"node": ">=22.22.0"` et
remplace celui situé en dessous.

## Pointer vers votre base de données

`init` génère un fichier `.env` prêt à l'emploi. Pour utiliser une base de
données que vous exploitez déjà, transmettez son URL lors de l'initialisation :

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Ou définissez `DATABASE_URL` dans le fichier `.env` après coup — cela revient au
même. Sans `DATABASE_URL`, `rebase dev` démarre un PostgreSQL géré (PGlite) dans le
répertoire du projet, ce qui est pratique pour tester l'API mais n'est pas le
but de cette variante.

Puis :

```bash
pnpm install
pnpm run dev
```

**Lisez l'URL dans la sortie.** `rebase dev` dérive un port disponible à partir du
chemin du projet plutôt que d'utiliser un port fixe, donc il diffère d'un projet
à l'autre et d'une machine à l'autre.

## D'où viennent les tables

Il n'y en a aucune dans le code : sans `backend/schema/index.ts`, le backend ne
déclare aucune table. Le serveur lit le schéma de votre base de données au
démarrage et expose les tables qu'il trouve, de sorte que l'API suit vos
migrations : modifiez le schéma, et les endpoints changent avec lui.

Une table est exposée dès lors que la sécurité au niveau des lignes (row-level
security / RLS) y est activée. Sans policy, elle est exposée et ne renvoie aucune
ligne, et un avertissement s'affiche au démarrage ; une policy permet d'y donner accès :

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` et `rebase.jwt()` sont installés par Rebase et
lisent l'identité de la requête authentifiée. Consultez
[Row-level security](/docs/collections/security-rules/) pour le vocabulaire des
policies, et [rls-check](/docs/rls-check/) pour un audit de ce que vos policies
autorisent réellement.

Une table sans RLS est **ignorée**, délibérément : chaque requête authentifiée
s'exécute en tant que `rebase_user`, ainsi exposer une table qui n'est pas
protégée par la sécurité au niveau des lignes livrerait chaque ligne à chaque
appelant connecté. Chaque table ignorée est listée au démarrage avec le SQL
permettant de la sécuriser.

Une table de jointure n'est exposée dans aucun des cas : elle est interprétée
comme le lien entre les deux tables qu'elle associe. Une table de jointure sans
RLS est également mentionnée au démarrage.

La vérification a lieu au démarrage. Si RLS est désactivé ultérieurement sur une
table exposée, celle-ci reste exposée jusqu'à ce que le prochain démarrage
l'ignore. L'[audit planifié](/docs/rls-check/) le signale plus rapidement, et est
désactivé par défaut.

:::note
`baas: { unprotectedTables: "serve" }` les expose tout de même. C'est une option
de `initializeRebaseBackend`, accessible uniquement après `rebase eject` — le
runtime managé ne la lit depuis aucun fichier ni depuis l'environnement. Cela
n'est judicieux que lorsque tous les appelants sont déjà de confiance.
:::

### Générer plutôt les fichiers de tables

Si vous préférez que les tables soient écrites en TypeScript — pour les types,
pour les hooks, ou pour la revue de code — introspectez-les :

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` implique `--template blank` et requiert `--install`, car il
s'exécute à l'aide de la CLI installée. Dans un projet existant, la commande
équivalente est :

```bash
pnpm rebase schema introspect
```

Les fichiers sont créés dans `backend/schema/` : un `defineTable` par table, avec
ses colonnes, ses relations et ses policies sous `rls`, ainsi qu'un `index.ts` qui
les exporte. À partir de ce moment, le projet possède des tables dans le code et
l'introspection au démarrage cesse d'être ce qui définit l'API.

L'initialisation headless installe Atlas dans `backend/`, ainsi `rebase db push`,
`rebase db generate` et `pnpm run db:migrate` fonctionnent sur ces tables comme
dans n'importe quel projet.

## Utilisation

Via HTTP :

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

Ou avec le client sécurisé au niveau des types, qui est déjà une dépendance du
squelette headless :

```typescript title="scripts/example.ts"
import { createRebaseClient } from "@rebasepro/client";

// The URL `rebase dev` printed, or your deployment's. `pnpm example` reads it
// from `.rebase-dev-url` when the variable is unset.
const rebase = createRebaseClient({ baseUrl: process.env.REBASE_URL! });

const { data: posts } = await rebase.data.table("posts").find({
    where: { published: ["==", true] },
    limit: 10
});
```

- [REST API](/docs/backend/api/) — la structure des endpoints, les filtres et les erreurs
- [Typed SDK](/docs/sdk/) — requêtes, authentification, temps réel, stockage
- `/api/docs` — le document OpenAPI, servi par le backend en cours d'exécution
  dès qu'il expose une table, à un appelant connecté (les tables qu'il est
  autorisé à voir). Définissez `REBASE_ENABLE_SWAGGER=true` pour le rendre accessible
  à tous, avec l'UI Swagger sur `/api/swagger` hors production. Un projet sans
  aucune table n'expose ni l'un ni l'autre : le document est généré à partir des tables

## `404 NO_TABLES`

Si chaque requête de données répond ceci :

```json
{
  "error": {
    "message": "This project serves no tables yet. …",
    "code": "NO_TABLES"
  }
}
```

alors le projet ne déclare aucune table dans le code *et* la base de données ne
lui a rien fourni à exposer. Avant la version 0.31, le code était `NO_COLLECTIONS`.
C'est la première réponse attendue d'un projet headless pointé vers une base de
données vide, et il s'agit d'une 404 plutôt que d'une 500 car rien n'est cassé —
il n'y a tout simplement encore rien à exposer.

Trois points permettent de le résoudre, dans l'ordre où il convient de les vérifier :

1. **La base de données n'a pas de tables.** Créez-les — via une migration, du
   SQL brut, ou un fichier `defineTable` associé à `rebase db push` — et
   redémarrez.
2. **Les tables n'ont pas la sécurité au niveau des lignes activée**, le
   démarrage les a donc ignorées. Le journal de démarrage nomme chacune d'elles,
   avec le SQL nécessaire. Activez-la et ajoutez une policy, comme indiqué
   ci-dessus. La réponse l'indique également : son message nomme les tables et
   fournit la commande `ALTER TABLE … ENABLE ROW LEVEL SECURITY` correspondante,
   et `details.unprotectedTables` les énumère.
3. **`DATABASE_URL` pointe ailleurs** que ce que vous pensez. `rebase status`
   affiche les trois fichiers qui déterminent ce que le backend cible.

## Ajouter un panneau d'administration plus tard

Rien ici ne vous empêche de le faire. Une seule commande permet d'ajouter le
répertoire `frontend/` que `rebase init` sans `--headless` aurait généré, avec son
workspace et son application dans `rebase.json` :

```bash
pnpm rebase apps add admin               # at /, or at /admin when another app is at /
pnpm rebase apps add admin --path /admin
pnpm install
pnpm run dev
```

Elle génère ce que `rebase init` sans `--headless` aurait produit, à partir des
mêmes modèles :

- `frontend/`, avec `rebaseBackendGuard()` dans sa configuration Vite. L'admin
  affiche chaque table exposée par le backend, via `GET /api/schema/tables`, sans
  aucun fichier par table ; la personnalisation de `users` n'est incluse que si
  `backend/schema/users.ts` déclare la table d'authentification comme le fait le
  template initial. Les personnalisations propres au panneau s'effectuent dans
  `frontend/src/cms/`.
- l'application `admin` dans `rebase.json`, avec `cms` sur son chemin et une
  commande de build dans le gestionnaire de paquets du projet. Un projet sans
  `rebase.json` en reçoit un.
- `frontend` dans les `workspaces` de `package.json` et dans `pnpm-workspace.yaml`.
- avec des tables dans le code (`backend/schema/index.ts`, manuellement ou depuis
  `rebase schema introspect`), les scripts `db:push`, `db:generate` et
  `schema:generate` du scaffold, le build du backend qui exécute d'abord
  `rebase schema generate`, et `ts-morph`. Un script que vous avez modifié est
  conservé et mentionné.

Chaque paquet `@rebasepro/*` est verrouillé sur la version que le projet utilise
déjà (en priorité celle de son `@rebasepro/server`), et non celle de la CLI. Un
projet qui n'utilise que des spécifications `link:` ou `workspace:` reçoit la
version de la CLI, et en est averti.

L'opération est refusée si `frontend/` existe déjà, si une application est déjà
nommée `admin` ou déclare le CMS, ou si `--path` est déjà pris ou n'est pas un
chemin sur lequel une application peut être servie. Un refus ne modifie rien, de
même qu'une écriture qui échoue en cours de route : chaque fichier est restauré.
Avec `--json`, la commande affiche ce qu'elle a écrit, ou l'enveloppe d'erreur.
Consultez [Frontend Setup](/docs/frontend/) pour la partie frontend elle-même.

## Prochaines étapes

- [Authentication](/docs/backend/authentication/) — fournisseurs, jetons, clés d'API
- [Row-level security](/docs/collections/security-rules/) — le modèle d'accès
- [Custom Functions](/docs/backend/custom-functions/) — vos propres routes
- [Deployment](/docs/getting-started/deployment/) — passage en production
