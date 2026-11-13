---
sourceHash: 9cda7971a27b0475
title: Backend uniquement (headless)
sidebar_label: Backend uniquement
description: Exécutez Rebase en tant que Backend-as-a-Service headless sur votre propre base PostgreSQL — une API REST, l'authentification, le stockage et le temps réel, sans panneau d'administration ni backend/schema.
---

Rebase a deux formes, et cette page traite de celle qui n'ouvre jamais de navigateur : une
API REST, l'authentification, le stockage, le temps réel et les sauvegardes sur une base de données PostgreSQL que
vous possédez déjà. Pas de panneau d'administration, pas de `backend/schema/`. Si vous vous
orientiez vers Supabase ou PostgREST, c'est l'équivalent direct.

Tout ce qui se trouve sur cette page fonctionne également dans le projet complet — il s'agit du même serveur.
Ce que `--headless` retire, c'est le package frontend et les fichiers de tables, pas
une fonctionnalité.

## Initialiser le projet

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Un seul workspace, pas de `frontend/` :

| Dossier | Contenu |
|---|---|
| `backend/` | `storage.ts` (`storageAuthorize`), vos fonctions personnalisées et tâches cron, ainsi que le `backend/schema/` généré par `--introspect` lorsque vous le demandez. Il n'y a aucun fichier serveur — le runtime publié démarre le projet |

`--template` n'a aucun effet ici : un preset initialise des tables, et cette variante
n'en a aucune. Node 22.22+, le même prérequis minimal que pour le projet complet — le `package.json`
de la couche headless déclare `"node": ">=22.22.0"` et remplace celui situé
en dessous.

## Connecter votre base de données

`init` génère un fichier `.env` prêt à l'emploi. Pour utiliser une base de données que vous exploitez déjà, transmettez
son URL lors de l'initialisation :

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Ou définissez `DATABASE_URL` dans le fichier `.env` par la suite — cela revient au même. Sans
`DATABASE_URL`, `rebase dev` démarre un PostgreSQL géré (PGlite) dans le répertoire
du projet, ce qui est pratique pour tester l'API mais n'est pas la finalité de cette variante.

Ensuite :

```bash
pnpm install
pnpm run dev
```

**Consultez l'URL dans la sortie de commande.** `rebase dev` dérive un port disponible à partir du
chemin du projet plutôt que d'utiliser un port fixe ; il varie donc d'un projet à l'autre et
d'une machine à l'autre.

## D'où viennent les tables

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Il n'y en a aucune dans le code : sans `backend/schema/index.ts`, le backend ne déclare aucune table. Le serveur lit le schéma de votre base de données au démarrage et expose
les tables qu'il trouve, de sorte que l'API suit vos migrations : modifiez le schéma, et
les points de terminaison changent avec lui.

Une table est exposée dès lors que la sécurité au niveau des lignes (Row-Level Security / RLS) est activée sur celle-ci. Sans stratégie,
elle est exposée mais ne renvoie aucune ligne, et un avertissement est émis au démarrage ; une stratégie permet de l'ouvrir :

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` et `rebase.jwt()` sont installés par Rebase et
lisent l'identité de la requête authentifiée. Consultez
[Row-level security](/docs/collections/security-rules/) pour le vocabulaire des stratégies,
et [rls-check](/docs/rls-check/) pour un audit de ce que vos stratégies autorisent
réellement.

Une table sans RLS est **ignorée**, délibérément : chaque requête authentifiée
s'exécute en tant que `rebase_user`, de sorte qu'exposer une table non protégée par la sécurité au niveau des lignes
donnerait accès à toutes les lignes à n'importe quel appelant connecté. Chaque table ignorée est listée au démarrage avec le code SQL
permettant de la protéger.

Une table de jointure n'est exposée dans aucun des cas : elle est interprétée comme la liaison entre les deux
tables qu'elle associe. Une table de jointure dont la RLS est désactivée est également signalée au démarrage.

La vérification a lieu au démarrage. Si la RLS est désactivée ultérieurement sur une table exposée, celle-ci reste
exposée jusqu'à ce que le prochain démarrage l'ignore. L'[audit planifié](/docs/rls-check/)
la signale plus tôt et est désactivé par défaut.

:::note
`baas: { unprotectedTables: "serve" }` les expose tout de même. C'est une
option de `initializeRebaseBackend`, elle n'est donc accessible qu'après un `rebase eject` —
le runtime managé ne la lit depuis aucun fichier ni depuis l'environnement. Cela n'est judicieux que si chaque appelant est déjà de confiance.
:::

### Générer plutôt les fichiers de tables

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Si vous préférez que les tables soient déclarées en TypeScript — pour le typage, pour
les hooks, pour la relecture — procédez à leur introspection :

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` implique `--template blank` et requiert `--install`, car la commande s'exécute
avec la CLI installée. Dans un projet existant, la commande équivalente est :

```bash
pnpm rebase schema introspect
```

Les fichiers sont créés dans `backend/schema/` : un `defineTable` par table, avec ses colonnes,
ses relations et ses stratégies sous forme de `rls`, ainsi qu'un fichier `index.ts` qui les exporte. Dès
lors, le projet dispose de tables dans le code et l'introspection au démarrage cesse
d'être ce qui définit l'API.

Le squelette
headless installe Atlas dans `backend/`, donc `rebase db push`, `rebase db generate`
et `pnpm run db:migrate` fonctionnent sur ces tables comme dans n'importe quel projet.

## L'utiliser

Via HTTP :

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

Ou avec le client typé, qui fait déjà partie des dépendances du squelette
headless :

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

- [API REST](/docs/backend/api/) — la structure des endpoints, les filtres et les erreurs
- [SDK typé](/docs/sdk/) — requêtes, authentification, temps réel, stockage
- `/api/docs` — le document OpenAPI, servi par le backend en cours d'exécution dès lors qu'il
  expose une table, à destination d'un appelant authentifié (les tables qu'il est autorisé à voir). Définissez
  `REBASE_ENABLE_SWAGGER=true` pour le rendre accessible à tous, avec l'interface Swagger UI
  sur `/api/swagger` hors production. Un projet sans table ne sert
  ni l'un ni l'autre : le document est généré à partir des tables

## `404 NO_TABLES`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Si chaque requête de données renvoie ceci :

```json
{
  "error": {
    "message": "This project serves no tables yet. …",
    "code": "NO_TABLES"
  }
}
```

cela signifie que le projet ne déclare aucune table dans le code *et* que la base de données ne lui a
rien fourni à exposer. Avant la version 0.31, le code était `NO_COLLECTIONS`. C'est la première réponse attendue d'un
projet headless pointant vers une base de données vide, et il s'agit d'une 404 plutôt que d'une 500 car
rien n'est défectueux — il n'y a tout simplement encore rien à servir.

Trois points permettent de résoudre cela, par ordre de vérification :

1. **La base de données ne contient aucune table.** Créez-les — via une migration, du SQL pur, ou un
   fichier `defineTable` associé à `rebase db push` — et redémarrez.
2. **La sécurité au niveau des lignes (RLS) n'est pas activée sur les tables**, elles ont donc été
   ignorées au démarrage. Le journal de démarrage liste chacune d'elles, avec le SQL nécessaire. Activez-la et ajoutez une stratégie,
   comme indiqué ci-dessus. La
   réponse le précise également : son message nomme les tables et fournit le
   `ALTER TABLE … ENABLE ROW LEVEL SECURITY` correspondant, et
   `details.unprotectedTables` en dresse la liste.
3. **`DATABASE_URL` pointe ailleurs** que là où vous le pensez. `rebase status`
   affiche les trois fichiers qui déterminent la cible atteinte par le backend.

## Ajouter un panneau d'administration ultérieurement

Rien ici ne vous empêche de le faire. Ajoutez un dossier `frontend/` qui monte `<RebaseCMS />` :
il restitue chaque table exposée par le backend, à partir de `GET /api/schema/tables`,
sans nécessiter un fichier par table. Rédigez `backend/schema/` — manuellement ou avec
`rebase schema introspect` — lorsque vous souhaitez avoir les tables dans le code ; les personnalisations propres
au panneau s'effectuent dans `frontend/src/cms/`. Consultez [Frontend Setup](/docs/frontend/) pour démarrer.

## Prochaines étapes

- [Authentication](/docs/backend/authentication/) — fournisseurs, jetons, clés d'API
- [Row-level security](/docs/collections/security-rules/) — le modèle d'accès
- [Custom Functions](/docs/backend/custom-functions/) — vos propres routes
- [Deployment](/docs/getting-started/deployment/) — mise en production
