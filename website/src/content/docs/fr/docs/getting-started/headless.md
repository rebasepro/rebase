---
sourceHash: 213cc853c469bd0c
title: Backend uniquement (headless)
sidebar_label: Backend uniquement
description: Exécutez Rebase en tant que Backend-as-a-Service headless sur votre propre PostgreSQL — une API REST, l'authentification, le stockage et le temps réel, sans panneau d'administration ni fichiers de collection.
---

Rebase se présente sous deux formes, et cette page concerne celle qui n'ouvre
jamais de navigateur : une API REST, l'authentification, le stockage, le temps
réel et les sauvegardes sur une base de données PostgreSQL que vous possédez
déjà. Pas de panneau d'administration, pas de fichiers de collection. Si vous
envisagiez d'utiliser Supabase ou PostgREST, c'est l'équivalent direct.

Tout ce qui se trouve sur cette page fonctionne également dans le projet complet
— il s'agit du même serveur. Ce que `--headless` supprime, c'est le package
frontend et les fichiers de collection, pas une fonctionnalité.

## Initialiser le projet

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Deux espaces de travail (workspaces), aucun `frontend/` :

| Dossier | Contenu |
|---------|---------|
| `backend/` | Vos fonctions personnalisées et crons. Il n'y a pas de fichier serveur — le runtime publié démarre le projet |
| `config/` | `storageAuthorize` et toutes les collections générées par `--introspect` |

`--template` n'a aucun effet ici : un preset initialise des fichiers de collection,
et cette variante n'en a aucun. Node 22.22+, le même prérequis minimal que le
projet complet — le `package.json` de la couche headless déclare
`"node": ">=22.22.0"` et remplace celui en dessous.

## Pointer vers votre base de données

`init` génère un `.env` prêt à l'emploi. Pour utiliser une base de données déjà
existante, transmettez son URL lors de l'initialisation :

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Ou définissez `DATABASE_URL` dans le fichier `.env` par la suite — cela revient
au même. Sans `DATABASE_URL`, `rebase dev` démarre un PostgreSQL géré (PGlite)
dans le répertoire du projet, ce qui est pratique pour tester l'API mais n'est
pas le but de cette variante.

Ensuite :

```bash
pnpm install
pnpm run dev
```

**Lisez l'URL dans la sortie.** `rebase dev` dérive un port libre à partir du
chemin du projet plutôt que d'utiliser un port fixe, ce qui signifie qu'il varie
d'un projet à l'autre et d'une machine à l'autre.

## D'où viennent les collections

Il n'y en a aucune dans le code. Le serveur lit le schéma de votre base de données
au démarrage et expose les tables qu'il trouve, de sorte que l'API s'adapte à vos
migrations : modifiez le schéma, et les endpoints changent avec lui.

Une table est exposée dès lors qu'elle dispose d'un modèle d'autorisation — la
sécurité au niveau des lignes (RLS) activée, plus au moins une politique :

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` et `rebase.jwt()` sont installés par Rebase et
lisent l'identité de la requête authentifiée. Consultez les
[Règles de sécurité](/docs/collections/security-rules/) pour le vocabulaire des
politiques, et [rls-check](/docs/rls-check/) pour auditer ce que vos politiques
autorisent réellement.

Une table sans RLS est **ignorée**, délibérément : chaque requête authentifiée
s'exécute en tant que `rebase_user`, de sorte qu'exposer une table sans politique
donnerait accès à chaque ligne à tous les utilisateurs connectés. Chaque table
ignorée est mentionnée au démarrage, accompagnée du SQL permettant de la protéger.

:::note
`baas: { unprotectedTables: "serve" }` les expose malgré tout. C'est une
option d'`initializeRebaseBackend`, elle n'est donc accessible qu'après un
`rebase eject` — le runtime managé ne la lit pas depuis `config/index.ts` ni
depuis l'environnement. Cela n'a de sens que si tous les appelants sont déjà de
confiance.
:::

### Générer plutôt des fichiers de collection

Si vous préférez définir les tables en TypeScript — pour les types, les
callbacks ou la révision de code — introspectez-les :

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` implique `--template blank` et requiert `--install`, car il
s'exécute avec la CLI installée. Dans un projet existant, la commande équivalente
est :

```bash
pnpm rebase schema introspect
```

Les fichiers sont placés dans `config/collections/`. À partir de ce moment, le
projet possède des collections dans le code et l'introspection au démarrage ne
définit plus l'API.

## Utilisation

Via HTTP :

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

Ou avec le client type-safe, qui fait déjà partie des dépendances du squelette
headless :

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
- [SDK Client](/docs/sdk/) — requêtes, authentification, temps réel, stockage
- `/api/docs` et `/api/swagger` — le document OpenAPI et son visualiseur, servis
  par le backend en cours d'exécution dès qu'il dispose d'une collection. Un
  projet qui n'en possède aucune ne sert ni l'un ni l'autre : le document étant
  généré à partir des collections, il n'y a rien à décrire tant que la section
  ci-dessus n'a pas été exécutée

## `404 NO_COLLECTIONS`

Si chaque requête de données renvoie ceci :

```json
{
  "error": {
    "message": "This project serves no collections yet. …",
    "code": "NO_COLLECTIONS"
  }
}
```

alors le projet ne déclare aucune collection dans le code *et* la base de
données ne lui a rien fourni pour en dériver. C'est la première réponse attendue
d'un projet headless pointant vers une base de données vide, et il s'agit d'une
erreur 404 plutôt que 500 car rien n'est cassé — il n'y a tout simplement encore
rien à exposer.

Trois points permettent de résoudre cela, dans l'ordre conseillé de vérification :

1. **La base de données n'a pas de tables.** Créez-les — via une migration, du
   SQL brut, ou un fichier de collection accompagné de `rebase db push` — puis
   redémarrez.
2. **Les tables n'ont pas de politique RLS**, le démarrage les a donc ignorées.
   Les logs de démarrage listent chacune d'elles. Ajoutez une politique, comme
   indiqué ci-dessus.
3. **`DATABASE_URL` pointe ailleurs** que là où vous le pensez. `rebase status`
   affiche les trois fichiers qui déterminent ce que le backend cible.

## Ajouter un panneau d'administration ultérieurement

Rien ici ne vous en empêche. Ajoutez un répertoire `config/collections/` —
manuellement ou avec `rebase schema introspect` — ainsi qu'un frontend qui les
affiche ; le backend ne change pas. C'est dans
[Configuration du frontend](/docs/frontend/) que cela commence.

## Prochaines étapes

- [Authentification](/docs/backend/authentication/) — fournisseurs, jetons, clés d'API
- [Règles de sécurité (RLS)](/docs/collections/security-rules/) — le modèle d'accès
- [Fonctions personnalisées](/docs/backend/custom-functions/) — vos propres routes
- [Déploiement](/docs/getting-started/deployment/) — passage en production

---
