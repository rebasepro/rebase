---
sourceHash: 4afe718897048683
title: Référence CLI
sidebar_label: CLI
description: Commandes de la CLI Rebase pour l'initialisation de projet, la génération de schéma, les migrations de base de données et la génération de SDK.
---

## Vue d'ensemble

La CLI Rebase (`rebase`) gère votre projet, de l'échafaudage au déploiement.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Ou exécutez n'importe quelle commande sans l'installer : `pnpm dlx @rebasepro/cli <command>`.

## Sortie lisible par une machine

`--json` est l'option dédiée, et en dehors de la famille `cloud`, c'est la seule : `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` et `rebase verify` envoient alors une valeur JSON unique sur stdout — le résultat, ou une enveloppe `{"error": {"message", "code", "hint", "issues"}}` avec un code de sortie non nul — à **chaque** sortie de la commande, afin qu'un appelant puisse analyser stdout de manière inconditionnelle. Sans cette option, elles écrivent du texte lisible par un humain et les erreurs vont sur stderr. `rebase cloud` utilise la même enveloppe et constitue la seule exception à cette option : elle active également le JSON d'elle-même lorsque stdout n'est pas un TTY, ou lorsque `REBASE_JSON=1` est défini. Ainsi, `rebase cloud status | cat` produit du JSON tandis que `rebase status | cat` n'en produit pas — dans un script, passez explicitement `--json` plutôt que de vous fier à l'une ou l'autre de ces règles.

## Commandes

### `rebase init`

Initialiser un nouveau projet Rebase :

```bash
rebase init [directory]
```

Configure un `backend/` (les tables dans `backend/schema/`) et un `frontend/` (le panneau d'administration, avec les personnalisations de ses tables dans `frontend/src/cms/`) ; `--headless` échafaude le `backend/` seul, sans `backend/schema/`. [Structure du projet](/docs/getting-started/project-structure/) présente les deux arborescences.

| Option | Description |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Par défaut `blog` |
| `--headless` | Backend uniquement — pas de panneau d'administration et pas de `backend/schema/` : le serveur dessert directement les tables de la base de données. `--template` n'a aucun effet, car il n'y a pas de tables à initialiser (seed) |
| `-y, --yes` | Ne jamais demander de confirmation. **Requis lorsqu'aucun terminal n'est disponible pour répondre**, par exemple en CI. Ignore git init et l'installation des dépendances — les valeurs par défaut en mode interactif étant oui aux deux, passez `--git` / `--install` si vous les souhaitez |
| `-i, --install` | Installer les dépendances après l'échafaudage. Sans cette option, init pose la question (oui par défaut) ; avec `--yes`, rien n'est installé |
| `--no-install` | Ne rien installer, et ne pas demander |
| `-g, --git` | Initialiser un dépôt et créer le premier commit. Sans cette option, init pose la question (oui par défaut) ; avec `--yes`, pas de dépôt |
| `--database-url <url>` | Utiliser une base de données existante au lieu de la base gérée. Il doit s'agir d'une URL `postgres://` ou `postgresql://` : toute autre valeur est refusée avant qu'un fichier ne soit écrit, et l'invite interactive repose la question |
| `--introspect` | Générer `backend/schema` à partir de cette base de données. Implique `--template blank` et nécessite `--install` |
| `--project <slug>` | Lier l'échafaudage à un projet Rebase Cloud |
| `--setup-key <key>` | La clé à usage unique authentifiant cette liaison |
| `-a, --agent <name>` | Configurer les agents de codage IA : les [compétences (skills)](/docs/ai/skills) et le [serveur MCP](/docs/ai/mcp). Répétable ou séparé par des virgules — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sans cette option, `init` demande et pré-coche les agents installés sur la machine ; avec `--yes`, aucun |

### `rebase dev`

Démarrer le serveur de développement :

```bash
rebase dev
```

Démarre à la fois le frontend et le backend avec le rechargement à chaud (hot reload), et régénère le schéma Drizzle et les types du SDK (`generated/sdk/`) au démarrage et à chaque enregistrement sous `backend/schema/`.

Les deux ports sont dérivés du chemin du projet afin que plusieurs projets Rebase puissent s'exécuter côte à côte. Utilisez les URL affichées par `rebase dev`. Figez un port avec `rebase dev --port 3001`.

Une application statique dans `rebase.json` sans étape de build (pas de `build`, et `output` correspond à sa `root`, comme un simple site HTML) est servie par le backend depuis ce répertoire, à son `path`, de la même manière que `rebase start` la sert depuis le bundle, et `FRONTEND_URL` est configuré vers elle (sur le port du backend) pour que les liens envoyés par e-mail y mènent. Ses [`redirects` et `cleanUrls`](/docs/architecture/redirects-and-clean-urls/) sont également servis, et une application qui déclare des redirections n'a pas besoin de fichier `index.html`. Une application avec un build s'exécute dans Vite sur son propre port, et `FRONTEND_URL` prend celui de Vite.

Une modification de `.env` redémarre le backend, qui relit le fichier, tout comme le panneau d'administration. Ce que `rebase dev` définit lui-même est conservé jusqu'à ce que vous le redémarriez : `PORT`, et `DATABASE_URL` lorsqu'il utilise la base de données gérée ou Docker.

Avec `--database-url`, `rebase dev` vérifie d'abord que quelque chose répond à cet hôte et à ce port. Si rien ne répond, il l'indique en citant l'option, et quitte avec le code `1` sans rien démarrer ; il laisse également intacts les noms de la base de données dans `.env`, sans jamais démarrer son conteneur compose.

### `rebase build`

Compiler le projet dans un bundle déployable dans `dist-bundle/` :

```bash
rebase build
```

Le bundle est l'artefact que vous déployez — l'image du runtime le charge, il n'y a donc aucune image d'application à construire vous-même. Options utiles :

| Option | Effet |
|------|--------|
| `--output <dir>` (ou `--out`) | Écrire le bundle ailleurs que dans `dist-bundle/` (une application à la fois) |
| `--vendor` | Toujours installer et intégrer (vendor) les dépendances du bundle |
| `--no-vendor` | Ne jamais intégrer les dépendances ; le pod les installe à chaque démarrage |
| `--skip-type-check` | Ignorer la vérification des types (plus rapide, moins sûr) |
| `--no-static` | Ne pas incorporer le frontend dans le bundle backend (chaque application statique conserve son propre bundle) |
| `--skip-static-build` | Incorporer le frontend tel que déjà compilé, sans exécuter sa commande de build |

Un frontend — chaque application statique de `rebase.json` avec une configuration Vite — dont la configuration n'utilise pas `rebaseBackendGuard()` (de `@rebasepro/app/vitePlugin`) est refusé : c'est ce qui empêche le code serveur de se retrouver dans le bundle du navigateur, et empêche Vite d'intégrer en ligne un fichier backend sous la forme d'une URL `data:` (le build échoue en mentionnant ce plugin si un autre plugin remplace son `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` est importé dans le bundle en tant que `entry.uiConfig`, la présentation de l'espace de travail servie par un backend déployé.

Les dépendances sont intégrées (vendored) par défaut afin qu'une nouvelle instance ne subisse pas une installation de 35 à 55 secondes. Une arborescence qui dépasse 2 Go sur le disque est abandonnée à la place, car la limite de téléversement est de 1 Go compressé.

Chaque application statique contenue dans le bundle reçoit une copie brotli (`.br`) et gzip (`.gz`) à côté de chaque ressource d'1 Ko ou plus portant un hash de contenu — les fichiers mis en cache pendant un an par un navigateur. Le runtime envoie celle que le navigateur accepte, de sorte que ces fichiers n'exigent aucun travail de compression par requête, y compris lors de la première visite suivant un déploiement, et les navigateurs acceptant brotli le reçoivent (environ 11 % plus compact que gzip sur le JavaScript de l'administration). La sortie de build de votre frontend reste inchangée ; seule la copie dans le bundle change. Sur l'application d'exemple, cela ajoute moins d'une seconde au build et environ 2,4 Mo au bundle.

### `rebase upgrade`

Passe tous les packages `@rebasepro/*` fixés par le projet à une version donnée, puis les installe avec le gestionnaire de packages spécifié par son lockfile. `rebase upgrade` prend la dernière version ; `--to 0.21.0` une version exacte, sans interrogation du registre ; `--to canary` un dist-tag. Chaque version fixée dans `dependencies`, `devDependencies` et `optionalDependencies`, dans chaque `package.json` du projet, conserve son `^` ou son `~`, et rien d'autre ne change dans le fichier. Les `peerDependencies` ainsi que les spécifications `workspace:`, `link:`, `file:`, git et tags sont listées et laissées intactes. Les overrides dans `pnpm-workspace.yaml` et `package.json` sont également mis à jour, mais un override `link:` ou `file:` prévaut sur toute version fixée : il est signalé, et `--drop-local-overrides` le supprime. `--dry-run` n'écrit rien, `--no-install` saute l'installation et `--json` affiche un document unique.

Un projet sur une version préliminaire (prerelease), telle qu'une version canary, reste sur son canal à moins que `latest` ne soit plus récent. Un dist-tag qui rétrograderait une version fixée est refusé (`downgrade_refused` sous `--json`), sauf si vous passez `--allow-downgrade` ; un `--to` exact est appliqué et marqué comme rétrogradation. Un `--dry-run` d'une mise à niveau que l'exécution réelle refuserait affiche ce qui changerait et se termine avec le code 0, et sous `--json`, son document contient le refus sous la clé `wouldRefuse` (`{ code, message, hint }`). Une fois installée, la commande actualise également les [compétences d'agent (agent skills)](/docs/ai/skills/#updating-the-skills) du projet à partir de la nouvelle CLI (`skills` dans le document `--json`). D'autres commandes se terminent par une ligne sur stderr lorsqu'une version plus récente est disponible ; [`REBASE_NO_UPDATE_CHECK=1`](/docs/getting-started/configuration/) permet de la masquer.

### `rebase start`

Exécuter le bundle compilé de la même façon qu'un déploiement l'exécute :

```bash
rebase start
```

Lit `PORT` et le reste du fichier `.env`, contrairement à `rebase dev`, avec le `NODE_ENV` qu'ils définissent. Un fichier `.env` échafaudé indique `development`, ainsi le premier compte enregistré devient toujours l'administrateur, et `rebase start` l'indique au début ; définissez `NODE_ENV=production` pour un serveur de production. `rebase start --bundle ./dist-bundle` exécute un bundle situé ailleurs.

`rebase start` ne démarre aucune base de données, et le `.env` de l'échafaudage ne contient aucun `DATABASE_URL`, donc une exécution locale sur la base de données utilisée par `rebase dev` s'effectue avec `DATABASE_URL="$(rebase db url)" rebase start`. Sans cela, la commande affiche cette ligne avant de démarrer.

### `rebase apps list`

Afficher les applications déclarées par ce dépôt :

```bash
rebase apps list
```

Un dépôt peut déclarer plusieurs applications déployables — par exemple un backend et un site marketing. C'est ainsi que vous pouvez voir sur quoi `rebase build` et le déploiement vont agir.

### `rebase eject`

Prendre le contrôle du processus serveur et de son image :

```bash
rebase eject
```

Écrit le point d'entrée du backend et un `Dockerfile` dans le projet et bascule son backend, afin que le dépôt construise sa propre image au lieu d'exécuter le runtime publié. Dès lors, **les mises à jour du runtime de la plateforme ne s'appliquent plus**, et la configuration de CORS, de l'authentification, du stockage et de l'arrêt du serveur vous incombe entièrement.

Prévisualisez l'opération avec `rebase eject --dry-run`, qui liste ce qui changerait sans rien modifier. `--force` remplace un fichier `backend/src/index.ts` ou `env.ts` existant, en conservant le fichier actuel sous le nom `<nom>.bak`.

Le serveur éjecté conserve les téléversements locaux dans le dossier `uploads/` du projet, qu'il soit exécuté depuis les sources ou compilé, tout comme le fait `rebase dev`. Il s'exécute dans `backend/`, donc un `STORAGE_PATH` relatif y est lu depuis `backend/`.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Chaque commande lisant le schéma accepte `--schema-dir <dir>` pour un projet qui le conserve ailleurs ; `--collections` a été supprimé. `rebase dev` maintient le fichier à jour, `stale` constitue donc la vérification idéale pour un build ou une CI. Voir [Génération de schéma](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # apply the tables to the database (development)
rebase db generate             # write a SQL migration file
rebase db migrate              # apply the pending migrations
rebase db url                  # print the connection string this project uses
rebase db pull --from <url>    # copy another database into the local one
rebase db backup               # pg_dump; db backups list and db restore beside it
rebase db branch create <name> # a copy to work on; switch, list and prune it too
rebase db stop                 # stop the managed development database
rebase db reset                # delete it and start over
rebase db request-role migrate --to <role> # move requests to another Postgres role
rebase db provision --print    # the SQL that sets up the request role, for a DBA
```

Chacune est détaillée dans [Commandes de base de données](/docs/cli/database/), avec l'ordre de priorité dans lequel une commande sélectionne sa base de données ; `push`, `generate` et `migrate` sont traitées en détail dans [Génération de schéma](/docs/cli/schema/).

### `rebase console`

Un REPL Node avec les données du projet accessibles, ou l'exécution d'un extrait de code avec `-e` :

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) et `tables` (les tables du projet, chargées depuis `backend/schema`) sont dans la portée, et l'`await` de premier niveau fonctionne. La base de données est résolue de la même façon que `rebase db push` la résout, et son ouverture n'y modifie rien. Avec `-e`, le résultat attendu est affiché au format JSON sur stdout et une exception levée quitte avec le code `1`. Options : `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Voir [Scripts et la Console](/docs/backend/scripts/).

### `rebase migrate`

Migrations à sens unique depuis une disposition que cette version ne lit plus : `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` et `frontend/src/cms`) et `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` dans votre propre code). Leurs options, ce qu'elles écrivent et la section « À vérifier avant de déployer » sont détaillées dans [Génération de schéma](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` ne prend aucun nom : elle déduit chaque application du projet et écrit l'intégralité de `rebase.json`, et refuse de remplacer un fichier existant à moins de passer `--force`.

Un argument de nom est refusé. `--force` conserve ce que l'inférence ne peut pas deviner à partir du fichier qu'elle remplace : le nom de chaque application, son `path` et sa route `cms`. Tout le reste est ré-inféré, et une application déclarée qu'elle ne trouve plus est marquée comme supprimée ; ainsi, sur un échafaudage, la commande réécrit le `rebase.json` fourni à l'origine. La commande de build de l'application statique utilise le gestionnaire de packages du projet.

Pour un projet local non lié à un projet Cloud, `apps config` indique qu'il n'est pas lié, que `rebase dev` soit en cours d'exécution ou non, et fournit l'URL du backend telle qu'elle est servie par `rebase dev`.

### `rebase apps add admin`

```bash
rebase apps add admin                  # at /, or at /admin when another app is at /
rebase apps add admin --path /console  # anywhere else, or an https URL of its own
```

Ajoute le panneau d'administration à un projet headless ou porté, tel que `rebase init` l'aurait généré. Ce qu'elle écrit, quelle version elle fixe et les cas de refus : [Ajouter un panneau d'administration ultérieurement](/docs/getting-started/headless/#adding-an-admin-panel-later).

### `rebase status`

Tout ce que ce projet déclare, et si l'environnement y est effectivement lié :

```bash
rebase status               # every resource, and the variables it reads
rebase status --json        # machine-readable
```

```
  backend  ·  managed  Rebase's runtime boots your bundle
  declared in  backend/resources.ts
  configured by  .env

  buckets
  ✓ media  s3 · account:minio
      ✓ S3_BUCKET__MEDIA
      ✓ S3_ACCESS_KEY_ID__MINIO (shared, for S3_ACCESS_KEY_ID__MEDIA)
  ○ exports  s3
      · S3_BUCKET__EXPORTS not set
      └ declared, not configured — uploads here answer 501 STORAGE_SOURCE_NOT_CONFIGURED
```

Trois fichiers déterminent ce à quoi un backend peut accéder, et cette commande affiche les trois ensemble : `rebase.json` indique où se trouve votre code et qui exécute le serveur, `backend/resources.ts` indique ce dont le projet a besoin, et l'environnement précise comment accéder à chaque élément. Tout le reste — `rebase.resources.json`, le manifeste du bundle — est généré à partir du second pour les lecteurs ne pouvant pas exécuter votre code, et vous ne l'écrivez jamais à la main.

Un `○` représente l'état qu'il vaut mieux connaître avant un déploiement qu'après : déclaré, mais non configuré. Un `✗` signifie que l'environnement configure quelque chose de façon *incorrecte*, ce qui entraîne un refus de démarrage plutôt qu'un mode dégradé.

Un fichier `rebase.resources.json` qui ne correspond plus aux déclarations reçoit une ligne `○`. Un fichier qui n'a pas encore été écrit n'en reçoit pas : `rebase build` l'écrit à chaque build, donc un projet qui n'a jamais été compilé, comme un échafaudage tout juste créé, n'a rien à corriger.

### `rebase resources`

Ce dont ce projet déclare avoir besoin — les bases de données, buckets, topics et files d'attente (queues) demandés par `backend/resources.ts`, ainsi que les crons et fonctions définis par ses fichiers :

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` est l'option qu'un job CI utilise pour échouer face à un `rebase.resources.json` qui ne correspond plus à `backend/resources.ts`. `--json` se combine avec elle : en cas de dérive, `rebase resources --check --json` quitte avec le code 1 et une enveloppe d'erreur (`resource_graph_missing` ou `resource_graph_stale`), et en cas de succès, le graphe inclut `check.status`. `--write --json` écrit le fichier et renvoie `written.changed`.

Une ressource est déclarée dans `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou correspond à un fichier sous `backend/crons` ou `backend/functions`, et n'est jamais écrite à la main dans `rebase.resources.json`, qui est généré à partir de ces déclarations afin qu'un hébergeur puisse lire les besoins d'un projet sans le compiler. Chaque entrée enregistre qui l'utilise (`table:events`, `column:posts.cover`, `function:report`).

Un backend dispose également d'une base de données par défaut et d'une source de stockage par défaut que personne ne déclare. Les deux sont listées ici avec la mention `implicit`, et aucune n'est écrite dans `rebase.resources.json` — l'hébergeur les fournit, donc les consigner reviendrait à demander le provisionnement de ressources non requises. Déclarer une ressource nommée, comme `bucket("media")`, laisse celle par défaut en place, les deux sont donc listées. Seule la déclaration explicite de la ressource par défaut, ou le marquage d'un bucket avec `default: true`, la remplace.

Pour voir ce que la plateforme détient pour un projet par rapport à ce que son code déclare, et pour supprimer une base de données provisionnée que le code ne nomme plus, consultez [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — toutes les commandes pour Rebase Cloud : authentification, liaison de projet, déploiements, configuration, bases de données, ressources, calcul (compute) et plus encore — dispose de [sa propre page](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Génère un client typé pour les tables exportées par `backend/schema/index.ts` dans `generated/sdk/`, avec `TableName` et `tablesDictionary` ; `--from <link|url>` lit à la place le contrat d'un backend en cours d'exécution. `--register` type également les données côté serveur : il écrit les types et la déclaration `Register` dans `backend/generated/` et l'enregistre dans `rebase.json` (`registerDatabase`). Voir [Données typées côté serveur](/docs/backend/typed-server-data) et [Génération de schéma](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

La commande à exécuter lorsque quelque chose ne va pas et que vous n'en connaissez pas encore la cause. Elle produit un rapport et ne modifie jamais rien, elle est donc sans danger pour toute base de données accessible.

**Sans base de données.** Ces vérifications s'exécutent en premier, car tout ce qui empêche un projet de fonctionner se produit avant même qu'une table puisse être comparée :

| Vérification | Raison |
| --- | --- |
| Version de Node | Par rapport à la plage déclarée par la CLI. Une version trop ancienne n'est pas signalée comme « Node non supporté » — c'est une erreur de syntaxe au sein d'une dépendance. |
| Gestionnaires de packages | Deux lockfiles dans un même projet. Un `npm install` dans un workspace pnpm réorganise `node_modules` selon une structure que pnpm ne gère pas, ce qui se traduit par des erreurs `Cannot find module` quelques heures plus tard. |
| Slugs en double | Deux tables déclarant le même slug. Le schéma refuse de compiler dans ce cas, et cette vérification nomme les deux. |
| Validité du fichier `.env` | Un `JWT_SECRET` de moins de 32 caractères (qui empêche tout démarrage en production), et `NODE_ENV=production` sans `CORS_ORIGINS` ni `FRONTEND_URL`. Les valeurs ne sont jamais affichées. |
| Écart de versions `@rebasepro/*` | Le même package fixé à des versions différentes dans les fichiers `package.json` du projet. Avoir deux copies casse le fonctionnement d'`instanceof` entre elles, ce qui provoque l'échec d'un guard de type rejetant son propre type. |
| Chaînes de connexion | Un `=` non encodé dans un paramètre d'URL, que les outils propres à PostgreSQL refusent d'analyser — ce qui fait échouer les sauvegardes et `psql` alors que l'application continue de fonctionner. |
| Fonctions personnalisées | Ce dont chaque fonction a besoin de la part de son hôte, et lesquelles ne s'exécuteraient pas sur un runtime edge. |

**Sur la base de données** — celle du projet, résolue de la même façon que `rebase db url` la résout, donc sur un échafaudage récent, il s'agit de la base de données gérée, que `doctor` démarre :

| Vérification | Raison |
| --- | --- |
| Tables → schéma généré | Indique si `schema.generated.ts` est obsolète. |
| Tables → base de données | Tables, colonnes, énumérations, clés étrangères et tables de jonction manquantes. |
| Extensions requises | Une colonne `col.vector()` nécessite pgvector, que Rebase n'installe que là où un projet l'a déclaré. |
| Empreinte du schéma | Indique si cette base de données a été provisionnée à partir de ces tables. Il s'agit d'un hash, pouvant indiquer un désaccord sans jamais préciser lequel est en avance. Une empreinte `v1:` provenant d'un runtime antérieur à 0.31 est signalée une fois, avec la commande pour réappliquer l'empreinte : `rebase db push`. |
| Tables → types du SDK | Indique si le SDK typé généré est obsolète. |
| Politiques RLS | Indique si les politiques de la base de données correspondent au `rls` que vous avez déclaré, et si une politique fait référence à un rôle que ce serveur ne peut pas utiliser. |

Si la base de données n'est pas joignable, ses phases sont signalées comme ignorées avec la raison correspondante, et le reste continue de s'exécuter — voir [Dépannage](/docs/troubleshooting/).

Renvoie un code de sortie non nul lorsqu'une vérification détecte une erreur, ou lorsqu'une phase n'a pas pu s'exécuter parce que la base de données fournie refuse les connexions. Une phase ignorée parce qu'aucune base de données n'a pu être résolue n'est pas considérée comme un échec.

`rebase doctor --policies` exécute uniquement les vérifications RLS — pas de diff de schéma, pas de types SDK — et adopte une politique de rejet par défaut (fail-closed), ce qui en fait la commande idéale comme garde-fou en CI face à une base de données déployée.

`rebase doctor --database` exécute uniquement la vérification préalable de la base de données : vérifie si le rôle sous lequel s'exécutent les requêtes authentifiées existe, s'il est restreint et si l'on peut basculer vers lui, quels autres identifiants peuvent basculer vers lui, si chaque rôle a l'autorisation de se connecter, et quelles tables, permissions (grants) et politiques Rebase partagerait avec d'autres rôles. Chaque résultat indique le SQL à exécuter en tant qu'administrateur, le paramètre `rls` adaptant Rebase à la base de données, ou les deux. Elle lit le catalogue système sans rien modifier et quitte avec le code 1 si une anomalie constitue un échec. Fonctionne également sur un projet headless. Voir [Exécuter sur une base de données existante ou partagée](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Vérifie si les tables sont prêtes pour la production, en une commande rapide conçue pour la CI et pour les hooks d'agents IA. Fonctionne hors ligne par défaut et ne modifie jamais rien.

| Étape | Causes d'échec |
| --- | --- |
| Définitions de tables (`schema`) | `backend/schema` ne se charge pas ou ne compile pas via le chargeur utilisé par le backend au démarrage : une relation vers une table que l'index n'exporte pas, `rls: "inherit"` sans `defaultRls`, une table sans clé primaire — un problème signalé par anomalie. Une table sans `rls` en fait partie. |
| Couverture RLS (`rls`) | Une table comportant une colonne `user_id`, `owner_id`, `organization_id` ou `tenant_id` dont les règles — les siennes ou le `defaultRls` dont elle hérite — permettent à un rôle de lire toutes les lignes sans restriction. Avertissement. `rls-policy-recursion` : une règle lisant sa propre table dans une sous-requête, ou deux tables dont les règles se lisent mutuellement, ce que Postgres refuse de développer, provoquant l'échec de toute instruction protégée avec `42P17 infinite recursion detected in policy` ; le résultat indique la table lue et la solution, consistant à déplacer la lecture dans une fonction `SECURITY DEFINER`. Une erreur, ou un avertissement lorsque la boucle n'est pas certaine. |
| Fraîcheur des migrations (`migrations`) | Une table ou colonne déclarée par les tables qu'aucun fichier dans `backend/drizzle/migrations` ne crée, ou une table/colonne supprimée qu'une migration crée encore. Ignorée pour un projet sans migrations pour le moment. |
| Personnalisations du CMS (`cms`) | Un `customizeTable(...)` dans `frontend/src/cms` (ou dans le `src/cms` d'une application statique dans `rebase.json`) qui ne correspond pas aux tables, analysé de manière statique — les modules ne sont pas exécutés. `cms-unknown-table` : le slug ne correspond à aucune table, le panneau l'ignore donc (le slug le plus proche est suggéré). `cms-unknown-field` : une clé sous `fields` n'est ni une colonne ni une relation (le nom SQL d'une colonne est retourné avec sa clé). `cms-hidden-required` : un champ masqué du formulaire (`hiddenInForm`, `readOnly`, `disabled`) dont la colonne est `NOT NULL` sans valeur par défaut et sans remplissage côté serveur, provoquant systématiquement l'échec de création d'un enregistrement depuis le panneau ; un avertissement lorsqu'un hook `beforeSave` ou une transformation peut le remplir, et ignoré avec `filledByServer`. `cms-duplicate-customization` : un même slug personnalisé deux fois. `cms-not-static` (un avertissement) : un appel dont le slug, les options ou `fields` ne sont pas des littéraux ou des `const` du même fichier, empêchant toute vérification de son contenu. `cms-ui-config-not-mounted` (un avertissement) : `frontend/src/cms/ui-config.json` existe mais n'est pas passé à `<RebaseCMS>` via `uiConfig`. `cms-backend-guard-missing` : la configuration Vite du frontend n'utilise pas `rebaseBackendGuard()`, ce qui conduirait `rebase build` à la refuser. Un projet headless ne possède pas de `frontend/src/cms` et ignore cette étape. |
| Audit RLS en direct (`live`) | Avec `--live` : exécute le catalogue [`rls-check`](/docs/rls-check) sur la base de données du projet, et vérifie si chaque migration a été appliquée. La base de données est résolue comme le font les commandes `db` — `--database-url`, `DATABASE_URL`, `--docker`, sinon la base de développement gérée. Une base de données non configurée ou qui ne répond pas constitue une erreur et non une étape ignorée : l'audit a été expressément demandé. Une politique de lecture `USING (true)` compilée à partir d'une règle `access: "public"` constitue un avertissement tant que l'API exige un token (`AUTH_REQUIRE`, activé par défaut) — chaque utilisateur authentifié lit toutes les lignes — et une erreur avec `AUTH_REQUIRE=false`, où les lignes deviennent accessibles de manière anonyme. |

`--json` affiche un objet unique, `{ ok, schemaDir, steps, findings, summary }` : chaque étape est un objet `{ id, title, status, detail? }` (`status` valant `passed`, `failed`, `warnings` ou `skipped`), et chaque anomalie (finding) contient `step`, `check` (un type stable en kebab-case), `severity`, `message`, et le cas échéant `fix`, `table`, `file`, `line` ainsi que le `path` pointé dans la table (`posts.rls[0]`) — permettant à un agent de corriger ce qu'il a cassé. `summary` compte les `errors` et `warnings`. `--quiet` n'affiche rien lorsque tout est validé. Quitte avec un code non nul en cas d'erreur ; les avertissements n'entraînent pas d'échec.

Un projet échafaudé l'exécute pour Claude Code après chaque modification sous `backend/schema/` : voir [`rebase skills install`](#rebase-skills-install).

### Commandes pour une application en cours d'exécution

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` et `rebase storage ls|cp|rm|url|stat` interagissent avec une application en cours d'exécution via son API : l'instance locale `rebase dev`, un serveur spécifié avec `--url`, ou un projet Rebase Cloud avec `--project`. Voir [Une application en cours d'exécution](/docs/cli/project/).

### `rebase auth`

Commandes de gestion de l'authentification :

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gérer les clés d'API de service du projet — les identifiants qu'un agent, un script ou un autre service utilise, par opposition à la session d'un utilisateur final :

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` définit les permissions de la clé, séparées par des virgules ou répétées ; `--full-access` lui attribue toutes les portées détenues par la clé de service à l'exception de `keys:*`. `--roles` ajoute des rôles RLS en plus de `service`, `--expires-in` prend une durée en jours et `--expires-at` une date ISO. `rebase api-keys scopes` liste toutes les portées connues par le backend. Une clé n'est affichée qu'une seule fois. Les portées de la clé ainsi que la sécurité au niveau des lignes (RLS) de l'identité sous laquelle elle opère s'appliquent toutes les deux. Voir [Clés d'API](/docs/backend/api-keys/).

### `rebase storage`

Maintenance globale des fichiers stockés, via le backend en cours d'exécution avec `REBASE_SERVICE_KEY` depuis `.env` :

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lit chaque ligne de chaque table telle qu'elle est stockée (lignes supprimées de manière réversible / soft-deleted incluses, en passant outre chaque hook `beforeQuery` et `afterRead`) ainsi que chaque entrée d'[historique](/docs/backend/history/), car un retour arrière restaure ce qu'elle contient. Elle liste les fichiers d'une source (`--source`, la source par défaut si omise) qu'aucune chaîne de caractères ne référence dans ces tables : une clé, une URL, une référence `rebase-storage:` dans un texte. Les fichiers plus récents que `--older-than` heures (24 par défaut) sont exclus, car le panneau d'administration téléverse un fichier avant que la ligne qui le mentionne ne soit enregistrée. L'analyse s'exécute sur le backend en arrière-plan, de sorte qu'un projet trop volumineux pour être analysé en une seule requête (derrière un ingress causant un timeout) puisse aller à son terme. La CLI lance l'analyse, puis affiche sa progression (fichiers listés, lignes lues, tables traitées, et celles n'ayant pu être lues) jusqu'à la fin. Lorsque la [file de tâches (job queue)](/docs/backend/jobs/) est activée, l'analyse est un job `storage.orphans` exécuté par les workers de tâches. Sans elle, l'analyse s'exécute dans le processus serveur sollicité, et la CLI le signale : redémarrer ce processus interrompt l'analyse. Une analyse correspond à une tentative de job, limitée par `jobs.timeoutMs` (15 minutes par défaut). Augmentez cette valeur, ou définissez-la à 0, pour une source nécessitant plus de temps. `--json` affiche le même rapport que précédemment, ainsi que son `scanId`.

`--delete` demande confirmation avant de supprimer (`--yes` ignore la question et est requis en l'absence de terminal). Elle ne supprime que des fichiers issus de l'analyse qui vient d'être affichée, et uniquement dans les 15 minutes suivant l'achèvement de cette analyse. Rien n'est supprimé tant qu'une table ne peut pas être lue : une table comportant des hooks de lecture sur une base de données dont le pilote ne peut pas les outrepasser est considérée comme non lue. Avant de supprimer quoi que ce soit, le serveur relit chaque ligne et chaque entrée d'historique en les comparant aux fichiers listés. Puis il re-vérifie chaque fichier juste avant de le supprimer. Un fichier désormais référencé par une ligne, téléversé à nouveau depuis l'analyse ou disparu est conservé, et la CLI le liste comme conservé. Les fichiers référencés uniquement par des tables que Rebase ne dessert pas sembleront inutilisés : vérifiez avant de supprimer. Face à un backend en version 0.25.1 ou antérieure, la CLI effectue l'analyse à l'ancienne, au cours d'une seule requête.

`move` copie les fichiers sous `--prefix` vers une autre source sous les mêmes clés, page par page. Un fichier déjà présent sur la cible avec la même taille est ignoré, de sorte qu'un déplacement interrompu reprend simplement en réexécutant la commande ; `--delete-source` supprime chaque fichier de la source une fois que la cible le contient, et est refusé lorsque les deux sources pointent vers le même bucket ou répertoire. Une fois le déplacement terminé, la CLI parcourt de nouveau la source et nomme chaque fichier que le déplacement n'a pas transféré : avec `--delete-source`, tout fichier encore présent dans la source ; sans cette option, tout fichier pour lequel la cible ne possède pas de copie de taille identique. Elle quitte avec le code 1 si de tels fichiers existent, et exécuter à nouveau le même déplacement permet de les traiter. `--json` les affiche sous `notMoved`. La lecture du rapport d'une analyse nécessite `database:read`. Lancer une analyse, supprimer et déplacer nécessitent `database:write`, que possède la clé de service.

### `rebase skills install`

Installer les compétences (skills) de référence Rebase pour vos assistants de codage IA — chaque `--agent` ci-dessus :

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Voir [Compétences d'agent](/docs/ai/skills) pour la liste complète et l'emplacement où les fichiers sont écrits.

`--hooks` installe le garde-fou Claude Code que `rebase init` intègre à chaque projet : `.claude/hooks/post-edit-collection.sh`, enregistré en tant que hook `PostToolUse` dans `.claude/settings.json`, qui exécute `rebase verify --quiet` après chaque modification sous `backend/schema/` ou `frontend/src/cms/` et signale tout problème à l'agent. Les paramètres et hooks existants sont conservés. `rebase skills --hooks` installe ce hook uniquement.

### `rebase telemetry`

Partage anonyme de données d'utilisation, désactivé tant que vous n'avez pas accepté. Une exécution interactive de `rebase init` pose la question à la fin, l'invite étant configurée sur « non » par défaut ; rien n'est donc partagé à moins que vous ne répondiez « oui ». La réponse est enregistrée par machine (`~/.rebase/telemetry.json`) : après un oui, `init` ne redemande plus jamais, et après un non, le prochain `init` reposera la question. Chaque copie locale du projet reçoit un identifiant aléatoire conservé dans son fichier ignoré par git `.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` affiche la configuration actuelle, `show` affiche exactement ce qui serait envoyé — que le partage soit activé ou non, afin que vous puissiez lire la charge utile avant de décider — et les deux autres permettent de modifier ce réglage. Si vous n'avez jamais exécuté `init`, aucune donnée n'a jamais été collectée.

## Prochaines étapes

- **[Génération de schéma](/docs/cli/schema/#production-workflow)** — Le flux de migration, de la modification d'une table à la production
- **[Le schéma en tant que code](/docs/architecture/schema-as-code)** — Comment fonctionne la génération de schéma
- **[Démarrage rapide](/docs/getting-started/quickstart)** — Premiers pas
