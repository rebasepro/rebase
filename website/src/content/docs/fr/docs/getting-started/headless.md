---
sourceHash: 8e1555899998c46c
title: Backend uniquement (headless)
sidebar_label: Backend uniquement
description: Exécutez Rebase en tant que Backend-as-a-Service headless sur votre propre base de données PostgreSQL — une API REST, l'authentification, le stockage et le temps réel, sans panneau d'administration ni fichiers de collection.
---

Rebase se présente sous deux formes, et cette page concerne celle qui n'ouvre jamais de navigateur : une API REST, l'authentification, le stockage, le temps réel et les sauvegardes sur une base de données PostgreSQL que vous possédez déjà. Aucun panneau d'administration, aucun fichier de collection. Si vous envisagiez d'utiliser Supabase ou PostgREST, c'est l'équivalent direct.

Tout ce qui se trouve sur cette page fonctionne également dans le projet complet — il s'agit du même serveur. Ce que `--headless` retire, c'est le package frontend et les fichiers de collection, pas une fonctionnalité.

## Générer le projet (Scaffold)

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Deux espaces de travail (workspaces), aucun `frontend/` :

| Dossier | Ce qu'il contient |
|---------|-------------------|
| `backend/` | Vos fonctions personnalisées et tâches cron. Il n'y a aucun fichier serveur — le runtime publié démarre le projet |
| `config/` | `storageAuthorize`, et toutes les collections générées par `--introspect` |

`--template` n'a aucun effet ici : un preset injecte des fichiers de collection, et cette déclinaison n'en a pas. Node 22.22+, le même prérequis minimal que le projet complet — le `package.json` de la couche headless déclare `"node": ">=22.22.0"` et remplace celui situé en dessous.

## Pointer vers votre base de données

`init` génère un fichier `.env` prêt à l'emploi. Pour utiliser une base de données que vous exploitez déjà, transmettez son URL lors de l'initialisation :

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Ou définissez `DATABASE_URL` dans le fichier `.env` après coup — cela revient au même. Sans `DATABASE_URL`, `rebase dev` démarre un PostgreSQL géré (PGlite) dans le répertoire du projet, ce qui est utile pour tester l'API mais ne correspond pas à l'objectif de cette déclinaison.

Ensuite :

```bash
pnpm install
pnpm run dev
```

**Lisez l'URL dans la sortie du terminal.** `rebase dev` déduit un port libre à partir du chemin du projet plutôt que d'en utiliser un fixe, de sorte qu'il diffère d'un projet à l'autre et d'une machine à l'autre.

## D'où viennent les collections

Il n'y en a aucune dans le code. Le serveur lit le schéma de votre base de données au démarrage et expose les tables qu'il trouve, de sorte que l'API suit vos migrations : modifiez le schéma, et les points de terminaison changent avec lui.

Une table est exposée dès lors que la sécurité au niveau des lignes (Row-Level Security ou RLS) y est activée. Sans politique, elle est exposée mais ne renvoie aucune ligne, et le démarrage émet un avertissement ; une politique l'ouvre :

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` et `rebase.jwt()` sont installés par Rebase et lisent l'identité de la requête authentifiée. Consultez [Règles de sécurité](/docs/collections/security-rules/) pour le vocabulaire des politiques, et [rls-check](/docs/rls-check/) pour un audit de ce que vos politiques autorisent réellement.

Une table sans RLS est **ignorée**, délibérément : chaque requête authentifiée s'exécute en tant que `rebase_user`, donc exposer une table que la sécurité au niveau des lignes ne protège pas reviendrait à livrer chaque ligne à n'importe quel appelant connecté. Chaque table ignorée est listée au démarrage accompagnée du code SQL qui permettrait de la protéger.

Une table de jointure n'est exposée dans aucun des cas, car elle ne devient jamais une collection. Une table de jointure avec RLS désactivé est également mentionnée au démarrage.

La vérification s'exécute au démarrage. Si RLS est désactivé ultérieurement sur une table exposée, elle reste exposée jusqu'à ce que le prochain démarrage l'ignore. L'[audit planifié](/docs/rls-check/) le signale plus rapidement, et est désactivé par défaut.

:::note
`baas: { unprotectedTables: "serve" }` les expose malgré tout. C'est une option de `initializeRebaseBackend`, elle n'est donc accessible qu'après avoir exécuté `rebase eject` — le runtime géré ne la lit pas depuis `config/index.ts` ni depuis l'environnement. Cela n'a de sens que lorsque chaque appelant est déjà de confiance.
:::

### Générer des fichiers de collection à la place

Si vous préférez que les tables soient écrites en TypeScript — pour les types, pour les callbacks, pour la revue de code — introspectez-les :

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` implique `--template blank` et requiert `--install`, car il s'exécute avec la CLI installée. Dans un projet existant, l'équivalent est :

```bash
pnpm rebase schema introspect
```

Les fichiers arrivent dans `config/collections/`. À partir de ce moment, le projet possède des collections dans le code et l'introspection au démarrage cesse d'être ce qui définit l'API.

L'échafaudage headless installe Atlas dans `backend/`, donc `rebase db push`, `rebase db generate` et `pnpm run db:migrate` fonctionnent sur ces collections comme dans n'importe quel projet.

## Utilisation

Via HTTP :

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

Ou avec le client typé, qui est déjà une dépendance de l'échafaudage headless :

```typescript title="scripts/example.ts"
import { createRebaseClient } from "@rebasepro/client";

// The URL `rebase dev` printed, or your deployment's. `pnpm example` reads it
// from `.rebase-dev-url` when the variable is unset.
const rebase = createRebaseClient({ baseUrl: process.env.REBASE_URL! });

const { data: posts } = await rebase.data.collection("posts").find({
    where: { published: ["==", true] },
    limit: 10
});
```

- [API REST](/docs/backend/api/) — la structure des endpoints, les filtres et les erreurs
- [SDK typé](/docs/sdk/) — requêtage, authentification, temps réel, stockage
- `/api/docs` et `/api/swagger` — le document OpenAPI et son visualiseur, servis par le backend en cours d'exécution une fois qu'il a une collection. Un projet qui n'en a aucune ne sert ni l'un ni l'autre : le document est généré à partir des collections, il n'y a donc rien à décrire tant que l'étape de la section ci-dessus n'a pas été exécutée

## `404 NO_COLLECTIONS`

Si chaque requête de données répond par ceci :

```json
{
  "error": {
    "message": "This project serves no collections yet. …",
    "code": "NO_COLLECTIONS"
  }
}
```

alors le projet ne déclare aucune collection dans le code *et* la base de données ne lui a rien fourni pour en déduire. C'est la première réponse attendue d'un projet headless pointé vers une base de données vide, et il s'agit d'une erreur 404 plutôt que 500 car rien n'est cassé — il n'y a simplement encore rien à exposer.

Trois choses permettent de résoudre cela, dans l'ordre où il convient de les vérifier :

1. **La base de données n'a pas de tables.** Créez-les — via une migration, du SQL brut, ou un fichier de collection accompagné de `rebase db push` — puis redémarrez.
2. **La sécurité au niveau des lignes (RLS) n'est pas activée sur les tables**, le démarrage les a donc ignorées. Le journal de démarrage nomme chacune d'entre elles, avec le SQL correspondant. Activez-la et ajoutez une politique, comme décrit ci-dessus. La réponse l'indique également : son message nomme les tables et fournit la commande `ALTER TABLE … ENABLE ROW LEVEL SECURITY` appropriée, et `details.unprotectedTables` les liste.
3. **`DATABASE_URL` pointe vers un autre endroit** que celui que vous pensez. `rebase status` affiche les trois fichiers qui déterminent ce que le backend cible.

## Ajouter un panneau d'administration ultérieurement

Rien ici ne vous en empêche pour la suite. Ajoutez un répertoire `config/collections/` — manuellement ou avec `rebase schema introspect` — et un frontend qui les restitue ; le backend ne change pas. La [Configuration du frontend](/docs/frontend/) est le point de départ pour cela.

## Prochaines étapes

- [Authentification](/docs/backend/authentication/) — fournisseurs, jetons, clés d'API
- [Règles de sécurité (RLS)](/docs/collections/security-rules/) — le modèle d'accès
- [Fonctions personnalisées](/docs/backend/custom-functions/) — vos propres routes
- [Déploiement](/docs/getting-started/deployment/) — le passage en production
