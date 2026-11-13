---
sourceHash: ed5be063323e7f6a
title: Référence de la CLI
sidebar_label: CLI
description: Commandes de la CLI Rebase pour l'initialisation de projet, la génération de schéma, les migrations de base de données et la génération de SDK.
---

## Aperçu

La CLI Rebase (`rebase`) gère votre projet de l'échafaudage au déploiement.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Ou exécutez n'importe quelle commande sans l'installer : `pnpm dlx @rebasepro/cli <command>`.

## Sortie lisible par machine

`--json` est le paramètre dédié, et en dehors de la famille `cloud`, c'est le seul : `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` et `rebase verify` émettent alors une valeur JSON unique sur stdout — le résultat, ou une enveloppe `{"error": {"message", "code", "hint", "issues"}}` avec un code de sortie non nul — à **chaque** terminaison de la commande, afin qu'un appelant puisse analyser stdout de manière inconditionnelle. Sans ce flag, elles affichent du texte lisible par un humain et les erreurs vont vers stderr. `rebase cloud` utilise la même enveloppe et constitue la seule exception : elle active également le JSON d'elle-même lorsque stdout n'est pas un TTY, ou lorsque `REBASE_JSON=1` est défini. Ainsi, `rebase cloud status | cat` produit du JSON tandis que `rebase status | cat` n'en produit pas — dans un script, passez explicitement `--json` plutôt que de vous fier à l'une de ces règles.

## Commandes

### `rebase init`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Initialise un nouveau projet Rebase :

```bash
rebase init [directory]
```

Configure un dossier `backend/` (les tables dans `backend/schema/`) et un dossier `frontend/` (le panneau d'administration, avec les personnalisations de tables dans `frontend/src/cms/`) ; `--headless` génère le `backend/` seul, sans `backend/schema/`. La page [Structure du projet](/docs/getting-started/project-structure/) montre les deux arborescences.

| Option | Description |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Par défaut `blog` |
| `--headless` | Backend uniquement — pas de panneau d'administration ni de `backend/schema/` : le serveur sert directement les tables de la base de données. `--template` n'a aucun effet, car il n'y a pas de tables à initialiser |
| `-y, --yes` | Ne jamais demander de confirmation. **Requis lorsqu'aucun terminal n'est disponible pour répondre**, comme en CI. Cela ignore l'initialisation de git et l'installation des dépendances — les valeurs par défaut en mode interactif étant « oui » pour les deux, passez `--git` / `--install` si vous les souhaitez |
| `-i, --install` | Installer les dépendances après la génération de l'échafaudage. Sans cette option, init pose la question (oui par défaut) ; avec `--yes`, rien n'est installé |
| `--no-install` | N'installer aucune dépendance et ne pas poser la question |
| `-g, --git` | Initialiser un dépôt et créer le premier commit. Sans cette option, init pose la question (oui par défaut) ; avec `--yes`, aucun dépôt n'est créé |
| `--database-url <url>` | Utiliser une base de données existante au lieu de la base gérée. Il doit s'agir d'une URL `postgres://` ou `postgresql://` : toute autre valeur est refusée avant qu'un fichier ne soit écrit, et l'invite interactive repose la question |
| `--introspect` | Générer `backend/schema` à partir de cette base de données. Implique `--template blank` et requiert `--install` |
| `--project <slug>` | Associer le projet généré à un projet Rebase Cloud |
| `--setup-key <key>` | La clé à usage unique authentifiant cette liaison |
| `-a, --agent <name>` | Configurer les agents de codage IA : les [compétences (skills)](/docs/ai/skills) et le [serveur MCP](/docs/ai/mcp). Répétable ou séparé par des virgules — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sans cette option, `init` demande et pré-coche les agents installés sur la machine ; avec `--yes`, aucun |

### `rebase dev`

Démarre le serveur de développement :

```bash
rebase dev
```

Démarre à la fois le frontend et le backend avec rechargement à chaud (hot reload), et régénère le schéma Drizzle ainsi que les types du SDK (`generated/sdk/`) au démarrage et à chaque sauvegarde dans `backend/schema/`.

Les deux ports sont dérivés du chemin du projet afin que plusieurs projets Rebase puissent s'exécuter côte à côte. Utilisez les URL affichées par `rebase dev`. Fixez-en un avec `rebase dev --port 3001`.

Une modification apportée à `.env` redémarre le backend, qui relit le fichier, tout comme le panneau d'administration. Ce que `rebase dev` définit lui-même est conservé jusqu'à ce que vous le redémarriez : `PORT`, et `DATABASE_URL` lorsqu'il s'agit de la base de données gérée ou de Docker.

Avec `--database-url`, `rebase dev` vérifie d'abord que quelque chose répond sur cet hôte et ce port. Si rien ne répond, il l'indique en mentionnant l'option, et quitte avec le code `1` sans rien démarrer ; il laisse également intacts les noms de variables d'environnement de la base de données dans `.env`, sans jamais démarrer son conteneur compose.

### `rebase build`

Compile le projet dans un bundle déployable dans `dist-bundle/` :

```bash
rebase build
```

Le bundle est l'artefact que vous déployez — l'image du runtime le charge, il n'y a donc aucune image d'application à construire vous-même. Options utiles :

| Option | Effet |
|------|--------|
| `--output <dir>` (ou `--out`) | Écrire le bundle ailleurs que dans `dist-bundle/` (une application à la fois) |
| `--vendor` | Toujours installer et intégrer (vendor) les dépendances du bundle |
| `--no-vendor` | Ne jamais intégrer (vendor) ; le pod les installe à chaque démarrage |
| `--skip-type-check` | Ignorer la vérification des types (plus rapide, moins sûr) |
| `--no-static` | Ne pas intégrer le frontend dans le bundle backend (chaque application statique conserve son propre bundle) |
| `--skip-static-build` | Intégrer le frontend tel que déjà compilé, sans exécuter sa commande de build |

<span class="since-badge" data-since="0.31">Depuis 0.31</span> Un frontend dont la configuration Vite n'utilise pas `rebaseBackendGuard()` (provenant de `@rebasepro/app/vitePlugin`) est refusé : c'est ce qui empêche le code serveur de se retrouver dans le bundle du navigateur. `frontend/src/cms/ui-config.json` est importé dans le bundle en tant que `entry.uiConfig`, la présentation de l'espace de travail servie par un backend déployé.

Les dépendances sont intégrées (vendored) par défaut afin qu'une nouvelle instance ne subisse pas un temps d'installation de 35 à 55 secondes. Une arborescence qui dépasse 2 Go sur le disque est abandonnée, car la limite de téléversement est de 1 Go compressé.

Chaque application statique incluse dans le bundle reçoit une copie brotli (`.br`) et gzip (`.gz`) à côté de chaque asset haché par son contenu de 1 Ko ou plus — les fichiers qu'un navigateur met en cache pendant un an. Le runtime envoie celle que le navigateur accepte, de sorte que ces fichiers n'entraînent aucun travail de compression par requête, y compris lors de la première visite après un déploiement, et les navigateurs qui acceptent brotli en bénéficient (environ 11 % plus compact que gzip pour le JavaScript de l'administration). Le dossier de build original de votre frontend reste inchangé ; seule la copie dans le bundle est modifiée. Sur l'application d'exemple, cela ajoute moins d'une seconde au build et environ 2,4 Mo au bundle.

### `rebase upgrade`

Met à jour chaque package `@rebasepro/*` verrouillé par le projet vers une version donnée, puis installe avec le gestionnaire de paquets indiqué par son lockfile. `rebase upgrade` prend la dernière version (`latest`) ; `--to 0.21.0` une version exacte, sans recherche dans le registre ; `--to canary` un dist-tag. Chaque version fixée dans `dependencies`, `devDependencies` et `optionalDependencies`, dans chaque `package.json` du projet, conserve son `^` ou `~`, et rien d'autre ne change dans le fichier. `peerDependencies` ainsi que les spécifications `workspace:`, `link:`, `file:`, git et de tags sont listées et laissées intactes. Les surcharges (overrides) dans `pnpm-workspace.yaml` et `package.json` sont également déplacées, mais une surcharge `link:` ou `file:` l'emporte sur toutes les versions fixées : elle est signalée, et `--drop-local-overrides` la supprime. `--dry-run` n'écrit rien, `--no-install` ignore l'installation, et `--json` affiche un document unique.

Un projet sur une préversion, comme un canary, reste sur son canal à moins que `latest` ne soit plus récent. Un dist-tag qui ferait rétrograder une version est refusé (`downgrade_refused` avec `--json`), à moins de passer `--allow-downgrade` ; un `--to` exact est appliqué et marqué comme rétrogradation. Un `--dry-run` d'une mise à jour que l'exécution réelle refuserait montre ce qui changerait et se termine avec le code 0, et sous `--json` son document inclut le refus sous la forme `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Exécute le bundle compilé de la même manière qu'un déploiement :

```bash
rebase start
```

Lit `PORT` et le reste de `.env`, contrairement à `rebase dev`, dans le `NODE_ENV` qu'ils définissent. Un `.env` généré indique `development`, de sorte que le premier compte à s'inscrire devient toujours l'administrateur, et `rebase start` l'indique en tête ; définissez `NODE_ENV=production` pour un serveur de production. `rebase start --bundle ./dist-bundle` exécute un bundle situé ailleurs.

`rebase start` ne démarre aucune base de données, et le `.env` initial n'a pas de `DATABASE_URL`, donc une exécution locale sur la base de données utilisée par `rebase dev` se fait avec `DATABASE_URL="$(rebase db url)" rebase start`. En l'absence de base de données, il affiche cette ligne avant de démarrer.

### `rebase apps list`

Affiche les applications déclarées par ce dépôt :

```bash
rebase apps list
```

Un dépôt peut déclarer plusieurs applications déployables — par exemple un backend et un site marketing. C'est ainsi que vous pouvez voir sur quoi `rebase build` et le déploiement vont agir.

### `rebase eject`

Prenez le contrôle total du processus serveur et de son image :

```bash
rebase eject
```

Écrit le point d'entrée du backend et un `Dockerfile` dans le projet et bascule son backend, de sorte que le dépôt construit sa propre image au lieu d'exécuter le runtime publié. Dès lors, **les mises à jour du runtime de la plateforme ne s'appliquent plus à lui**, et la configuration des CORS, de l'authentification, du stockage et de l'arrêt vous incombe entièrement.

Prévisualisez l'opération avec `rebase eject --dry-run`, qui liste ce qui changerait sans rien modifier. `--force` remplace un fichier `backend/src/index.ts` ou `env.ts` existant, en conservant le fichier actuel sous la forme `<name>.bak`.

Le serveur éjecté conserve les téléversements locaux dans le dossier `uploads/` du projet, qu'il soit exécuté depuis les sources ou compilé, tout comme `rebase dev`. Il s'exécute dans `backend/`, donc un `STORAGE_PATH` relatif y est lu depuis `backend/`.

### `rebase schema generate` / `rebase schema stale`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Chaque commande qui lit le schéma accepte `--schema-dir <dir>` pour un projet qui le conserve ailleurs ; `--collections` a été supprimé. `rebase dev` maintient le fichier à jour, donc `stale` est la vérification à utiliser pour un build ou en CI. Voir [Génération de schéma](/docs/cli/schema/).

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

Chacune est détaillée sur la page [Commandes de base de données](/docs/cli/database/), avec l'ordre dans lequel une commande sélectionne sa base de données ; `push`, `generate` et `migrate` sont traitées en détail dans [Génération de schéma](/docs/cli/schema/).

### `rebase console`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un REPL Node avec les données du projet accessibles, ou un extrait de code exécuté avec `-e` :

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) et `collections` (les tables du projet, chargées depuis `backend/schema`) sont à portée, et le `await` de premier niveau fonctionne. La base de données est résolue de la même manière que `rebase db push` la résout, et son ouverture n'y modifie rien. Avec `-e`, le résultat attendu est affiché sous forme de JSON sur stdout et une exception levée quitte avec le code `1`. Options : `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Voir [Scripts et la Console](/docs/backend/scripts/).

### `rebase migrate`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Migrations à sens unique depuis une structure que cette version ne lit plus : `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` et `frontend/src/cms`) et `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` dans votre propre code). Leurs options, ce qu'elles écrivent et la section « Vérifier avant de déployer » sont présentés dans [Génération de schéma](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` ne prend aucun nom : il déduit chaque application du projet et écrit l'intégralité de `rebase.json`, et refuse de remplacer un fichier existant à moins de passer `--force`.

Un argument de nom est refusé. `--force` conserve ce que l'inférence ne peut pas déduire du fichier qu'elle remplace : le nom de chaque application, son `path` et sa route `cms`. Tout le reste est déduit à nouveau, et une application déclarée qu'elle ne trouve plus est indiquée comme supprimée ; ainsi, sur un projet généré, elle réécrit le `rebase.json` initialement fourni. La commande de build de l'application statique utilise le gestionnaire de paquets du projet.

Pour une copie locale non liée à un projet Cloud, `apps config` indique qu'elle n'est pas liée, que `rebase dev` soit en cours d'exécution ou non, et fournit l'URL du backend telle qu'elle est servie par `rebase dev`.

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

Trois fichiers déterminent ce à quoi un backend peut accéder, et cette commande affiche les trois ensemble : `rebase.json` indique où se trouve votre code et qui exécute le serveur, `backend/resources.ts` indique ce dont le projet a besoin, et l'environnement indique comment joindre chaque élément. Tout le reste — `rebase.resources.json`, le manifeste du bundle — est généré à partir de ce dernier pour les outils qui ne peuvent pas exécuter votre code, et vous n'avez jamais à l'écrire.

Un `○` représente l'état qu'il vaut mieux connaître avant un déploiement plutôt qu'après : déclaré, non configuré. Un `✗` signifie que l'environnement définit quelque chose de manière *incorrecte*, ce qui empêche le démarrage au lieu de fonctionner en mode dégradé.

Un fichier `rebase.resources.json` qui ne correspond plus aux déclarations obtient une ligne `○`. Un fichier qui n'a pas encore été écrit n'en a pas : `rebase build` l'écrit à chaque build, donc un projet qui n'a jamais été compilé, tel qu'un projet nouvellement généré, n'a rien à corriger.

### `rebase resources`

Ce dont ce projet déclare avoir besoin — les bases de données, buckets, topics et files d'attente demandés par `backend/resources.ts`, ainsi que les crons et fonctions définis par ses fichiers :

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` est l'option qu'un job CI utilise pour échouer sur un `rebase.resources.json` qui ne correspond plus à `backend/resources.ts`. `--json` s'y associe : en cas de divergence, `rebase resources --check --json` quitte avec le code 1 et une enveloppe d'erreur (`resource_graph_missing` ou `resource_graph_stale`), et en cas de succès, le graphe inclut `check.status`. `--write --json` écrit le fichier et renvoie `written.changed`.

Une ressource est déclarée dans `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou est un fichier sous `backend/crons` ou `backend/functions`, et n'est jamais écrite à la main dans `rebase.resources.json`, qui est généré à partir de ces déclarations afin qu'un hôte puisse lire ce dont un projet a besoin sans avoir à le compiler. Chaque entrée enregistre qui l'utilise (`table:events`, `column:posts.cover`, `function:report`).

Un backend dispose également d'une base de données par défaut et d'une source de stockage par défaut que personne ne déclare. Les deux sont listées ici avec la mention `implicit`, et aucune n'est inscrite dans `rebase.resources.json` — l'hôte les fournit, donc les consigner demanderait le provisionnement de quelque chose que personne n'a demandé. En déclarer une nommée, comme `bucket("media")`, laisse celle par défaut en place, les deux sont donc listées. Seule la déclaration explicite de la ressource par défaut, ou le marquage d'un bucket avec `default: true`, la remplace.

Pour voir ce que la plateforme détient pour un projet par rapport à ce que son code déclare, et pour supprimer une base de données provisionnée que le code ne mentionne plus, voir [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — toutes les commandes pour Rebase Cloud : authentification, liaison de projet, déploiements, configuration, bases de données, ressources, calcul (compute) et plus encore — a [sa propre page](/docs/cli/cloud).

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```bash
rebase generate-sdk
```

Écrit un client typé pour les tables exportées par `backend/schema/index.ts` dans `generated/sdk/`, avec `TableName` et `tablesDictionary` ; `--from <link|url>` lit à la place le contrat d'un backend en cours d'exécution. `--register` type également les données côté serveur : il écrit les types et la déclaration `Register` dans `backend/generated/` et l'enregistre dans `rebase.json` (`registerDatabase`). Voir [Données typées côté serveur](/docs/backend/typed-server-data) et [Génération de schéma](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

La commande à exécuter lorsque quelque chose ne va pas et que vous ne savez pas encore quoi. Elle génère un rapport et ne modifie jamais rien, elle est donc sans danger pour toute base de données accessible.

**Sans base de données.** Celles-ci s'exécutent en premier, car tout ce qui empêche totalement un projet de fonctionner survient avant même qu'une table ne puisse être comparée :

| Vérification | Raison |
| --- | --- |
| Version de Node | Par rapport à la plage déclarée par la CLI. Une version trop ancienne n'est pas signalée comme « Node non pris en charge » — elle se manifeste par une erreur de syntaxe au sein d'une dépendance. |
| Gestionnaires de paquets | Deux lockfiles dans un même projet. Un `npm install` dans un workspace pnpm réorganise `node_modules` selon une structure incompatible avec pnpm, et le symptôme est une erreur `Cannot find module` quelques heures plus tard. |
| Slugs en double | Deux tables déclarant le même slug. Le schéma refuse de compiler dans ce cas, et cette vérification nomme les deux. |
| Cohérence du `.env` | Un `JWT_SECRET` de moins de 32 caractères (qui empêche le démarrage en production), et `NODE_ENV=production` sans `CORS_ORIGINS` ni `FRONTEND_URL`. Les valeurs ne sont jamais affichées. |
| Discordance de versions `@rebasepro/*` | Le même paquet fixé à des versions différentes dans les fichiers `package.json` du projet. Deux copies brisent le `instanceof` entre elles, provoquant l'échec d'un type guard rejetant son propre type. |
| Chaînes de connexion | Un `=` non encodé dans un paramètre d'URL, que les outils PostgreSQL refusent d'analyser — ce qui casse les sauvegardes et `psql` alors que l'application continue de fonctionner. |
| Fonctions personnalisées | Ce dont chaque fonction a besoin de la part de son hôte, et lesquelles ne s'exécuteraient pas sur un runtime edge. |

**Sur la base de données** — celle du projet, résolue de la même façon que `rebase db url` la résout, donc sur un projet nouvellement créé, il s'agit de la base gérée, que `doctor` démarre :

| Vérification | Raison |
| --- | --- |
| Tables → schéma généré | Vérifie si `schema.generated.ts` est obsolète. |
| Tables → base de données | Tables, colonnes, énumérations, clés étrangères et tables de jonction manquantes. |
| Extensions requises | Une colonne `col.vector()` nécessite pgvector, que Rebase n'installe que lorsqu'un projet l'a déclaré. |
| Empreinte du schéma (Schema stamp) | Vérifie si cette base de données a été provisionnée à partir de ces tables. Il s'agit d'un hash, permettant d'indiquer si les deux diffèrent, sans pouvoir dire lequel est en avance. Une empreinte `v1:` issue d'un runtime antérieur à 0.31 est signalée une fois, avec la commande pour la réappliquer : `rebase db push`. |
| Tables → types SDK | Vérifie si le SDK typé généré est obsolète. |
| Politiques RLS | Vérifie si les politiques de la base de données correspondent au `rls` que vous avez déclaré, et si une politique fait référence à un rôle que ce serveur ne peut pas utiliser. |

Si la base de données est inaccessible, ses étapes sont signalées comme ignorées avec la raison correspondante et le reste continue de s'exécuter — voir [Dépannage](/docs/troubleshooting/).

Se termine avec un code non nul lorsqu'une vérification trouve une erreur, ou lorsqu'une étape n'a pas pu s'exécuter parce que la base de données fournie refuse les connexions. Une étape ignorée car aucune base de données n'a pu être résolue n'est pas considérée comme un échec.

`rebase doctor --policies` n'exécute que les vérifications RLS — pas de diff de schéma, pas de types SDK — et adopte une politique restrictive (fail closed), ce qui en fait la commande idéale à utiliser comme barrière de validation en CI contre une base de données déployée.

`rebase doctor --database` n'exécute que la vérification préliminaire de la base de données : vérifie si le rôle utilisé par les requêtes authentifiées existe, s'il est restreint et si l'on peut basculer vers lui, quels autres identifiants peuvent basculer vers lui, si tous les rôles peuvent se connecter, et quelles tables, privilèges et politiques Rebase partagerait avec d'autres rôles. Chaque constatation indique le SQL à exécuter en tant qu'administrateur, le paramètre `rls` permettant plutôt d'adapter Rebase à la base de données, ou les deux. Elle lit le catalogue et ne modifie rien, et quitte avec le code 1 lorsqu'un problème bloquant est détecté. Cela fonctionne également sur un projet headless. Voir [Exécution sur une base de données existante ou partagée](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Vérifie si les tables sont prêtes pour la production, en une commande rapide pour la CI et pour les hooks d'agents IA. Fonctionne hors ligne par défaut, et ne modifie jamais rien.

| Étape | Ce qui provoque un échec |
| --- | --- |
| Définitions de tables (`schema`) | `backend/schema` ne se charge pas ou ne compile pas avec le chargeur utilisé par le backend au démarrage : une relation vers une table que l'index n'exporte pas, `rls: "inherit"` sans `defaultRls`, une table sans clé primaire — une constatation par problème. Une table sans `rls` en fait partie. |
| Couverture RLS (`rls`) | Une table comportant une colonne `user_id`, `owner_id`, `organization_id` ou `tenant_id` dont les règles — les siennes ou le `defaultRls` dont elle hérite — autorisent un rôle à lire chaque ligne sans tenir compte de cette colonne. Un avertissement. |
| Fraîcheur des migrations (`migrations`) | Une table ou une colonne déclarée dans les tables qu'aucun fichier dans `backend/drizzle/migrations` ne crée, ou une colonne/table supprimée qu'une migration continue de créer. Ignoré pour un projet n'ayant pas encore de migrations. |
| Personnalisations CMS (`cms`) | Un `customizeTable(...)` dans `frontend/src/cms` (ou dans le `src/cms` d'une application statique dans `rebase.json`) qui ne correspond pas aux tables, analysé statiquement — les modules ne sont pas exécutés. `cms-unknown-table` : le slug ne correspond à aucune table, le panneau l'ignore donc (le slug le plus proche est suggéré). `cms-unknown-field` : une clé sous `fields` n'est ni une colonne ni une relation (le nom SQL d'une colonne est associé à sa clé). `cms-hidden-required` : un champ masqué du formulaire (`hiddenInForm`, `readOnly`, `disabled`) dont la colonne est `NOT NULL` sans valeur par défaut et sans valeur fournie par le serveur, ce qui fait que la création d'un enregistrement depuis le panneau échoue systématiquement ; avertissement si un hook `beforeSave` ou une transformation peut le renseigner, masqué par `filledByServer`. `cms-duplicate-customization` : un même slug personnalisé deux fois. `cms-not-static` (un avertissement) : un appel dont le slug, les options ou `fields` ne sont pas des littéraux ou des `const` du même fichier, donc aucun élément n'a été vérifié. `cms-ui-config-not-mounted` (un avertissement) : `frontend/src/cms/ui-config.json` existe mais n'est pas transmis à `<RebaseCMS>` en tant que `uiConfig`. `cms-backend-guard-missing` : la configuration Vite du frontend n'utilise pas `rebaseBackendGuard()`, donc `rebase build` la refuserait. Un projet headless n'a pas de `frontend/src/cms` et ignore cette étape. |
| Audit RLS en direct (`live`) | Avec `--live` : le catalogue [`rls-check`](/docs/rls-check) exécuté sur la base de données du projet, et vérification que chaque migration a été appliquée. La base de données est résolue comme le font les commandes `db` — `--database-url`, `DATABASE_URL`, `--docker`, sinon la base de développement gérée. Une base non configurée ou qui ne répond pas constitue une erreur, pas une étape ignorée : l'audit a été explicitement demandé. Une politique de lecture `USING (true)` compilée à partir d'une règle `access: "public"` est un avertissement tant que l'API requiert un token (`AUTH_REQUIRE`, activé par défaut) — chaque utilisateur authentifié lit toutes les lignes — et une erreur avec `AUTH_REQUIRE=false`, où les lignes sont accessibles de manière anonyme. |

`--json` affiche un objet unique, `{ ok, schemaDir, steps, findings, summary }` : chaque étape est au format `{ id, title, status, detail? }` (`status` vaut `passed`, `failed`, `warnings` ou `skipped`), et chaque constatation comporte `step`, `check` (un type stable en kebab-case), `severity`, `message`, et le cas échéant `fix`, `table`, `file`, `line` ainsi que le `path` avec notation pointée dans la table (`posts.rls[0]`) — afin qu'un agent puisse réparer ce qu'il a cassé. `summary` comptabilise `errors` et `warnings`. `--quiet` n'affiche rien lorsque tout est validé. Quitte avec un code non nul en cas d'erreur ; les avertissements ne provoquent pas d'échec.

Un projet généré l'exécute pour Claude Code après chaque modification dans `backend/schema/` : voir [`rebase skills install`](#rebase-skills-install).

### `rebase auth`

Commandes de gestion de l'authentification :

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gère les clés d'API de service du projet — les identifiants utilisés par un agent, un script ou un autre service, par opposition à la session d'un utilisateur final :

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` spécifie ce que la clé peut faire, séparé par des virgules ou répété ; `--full-access` lui donne tous les scopes que possède la clé de service sauf `keys:*`. `--roles` ajoute des rôles RLS en plus de `service`, `--expires-in` s'exprime en jours et `--expires-at` avec une date ISO. `rebase api-keys scopes` liste tous les scopes connus du backend. Une clé n'est affichée qu'une seule fois. Les scopes de la clé et la sécurité au niveau des lignes (RLS) de l'identité sous laquelle elle agit s'appliquent tous les deux. Voir [Clés d'API](/docs/backend/api-keys/).

### `rebase storage`

Maintenance globale des fichiers stockés, via le backend en cours d'exécution avec `REBASE_SERVICE_KEY` depuis `.env` :

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lit chaque ligne de chaque table telle qu'elle est stockée (y compris les lignes supprimées logiciellement (soft-deleted), en contournant chaque hook `beforeQuery` et `afterRead`) ainsi que chaque entrée d'[historique](/docs/backend/history/), car une restauration réactive ce qu'elle contient. La commande liste les fichiers d'une source (`--source`, la source par défaut si omise) qu'aucune chaîne de caractères parmi ces lignes ne mentionne : une clé, une URL, une référence `rebase-storage:` dans un texte. Les fichiers plus récents que `--older-than` heures (24 par défaut) sont exclus, car le panneau d'administration téléverse un fichier avant que la ligne qui le référence ne soit enregistrée. L'analyse s'exécute sur le backend en arrière-plan, de sorte qu'un projet trop volumineux pour être analysé au cours d'une seule requête (derrière un ingress qui pourrait dépasser le délai d'expiration) puisse quand même se terminer. La CLI la démarre, puis affiche sa progression (fichiers listés, lignes lues, tables traitées, et celles qui n'ont pas pu être lues) jusqu'à ce qu'elle soit terminée. Lorsque la [file de tâches](/docs/backend/jobs/) est activée, l'analyse est un job `storage.orphans` exécuté par les workers de jobs. Sans elle, l'analyse s'exécute au sein du processus serveur sollicité, et la CLI le signale : redémarrer ce processus interrompt l'analyse. Une analyse correspond à une tentative de job, limitée par `jobs.timeoutMs` (15 minutes par défaut). Augmentez cette valeur, ou définissez-la sur 0, pour une source qui nécessite plus de temps. `--json` affiche le même rapport qu'auparavant, accompagné de son `scanId`.

`--delete` demande confirmation avant de supprimer (`--yes` ignore la question et est requis en l'absence de terminal). La suppression ne s'applique qu'à partir de l'analyse qui vient d'être affichée, et seulement dans les 15 minutes suivant la fin de cette analyse. Rien n'est supprimé si une table ne peut pas être lue : une table comportant des hooks de lecture sur une base de données dont le pilote ne peut pas les contourner est considérée comme non lue. Avant de supprimer quoi que ce soit, le serveur relit chaque ligne et entrée d'historique par rapport aux fichiers listés. Ensuite, il vérifie à nouveau chaque fichier juste avant de le supprimer. Un fichier qu'une ligne référence désormais, qui a été téléversé à nouveau depuis l'analyse ou qui n'existe plus est conservé, et la CLI le signale comme conservé. Les fichiers qui ne sont référencés que par des tables non gérées par Rebase sembleront inutilisés : vérifiez avant de supprimer. Face à un backend en version 0.25.1 ou antérieure, la CLI effectue l'analyse à l'ancienne, au sein d'une seule requête.

`move` copie les fichiers sous `--prefix` vers une autre source sous les mêmes clés, page par page. Un fichier que la cible possède déjà à la même taille est ignoré, de sorte qu'un déplacement interrompu peut être repris en le réexécutant ; `--delete-source` supprime chaque fichier de la source une fois que la cible le contient, et est refusé lorsque les deux sources stockent dans le même bucket ou répertoire. Une fois le déplacement terminé, la CLI liste à nouveau la source avec un nouveau parcours et nomme chaque fichier que le déplacement n'a pas transféré : avec `--delete-source`, tout fichier encore présent dans la source ; sans cette option, tout fichier dont la cible ne possède pas de copie de taille identique. La commande quitte avec le code 1 si de tels fichiers existent, et relancer le même déplacement les prendra en charge. `--json` les affiche sous la clé `notMoved`. La lecture du rapport d'une analyse nécessite `database:read`. Démarrer une analyse, supprimer et déplacer nécessitent `database:write`, privilège que détient la clé de service.

### `rebase skills install`

Installe les compétences (skills) de référence Rebase pour vos assistants de codage IA — chaque agent mentionné ci-dessus avec `--agent` :

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Voir [Compétences des agents](/docs/ai/skills) pour la liste complète et l'emplacement où les fichiers sont écrits.

`--hooks` installe le garde-fou Claude Code que `rebase init` fournit avec chaque projet : `.claude/hooks/post-edit-collection.sh`, enregistré comme hook `PostToolUse` dans `.claude/settings.json`, qui exécute `rebase verify --quiet` après chaque modification sous `backend/schema/` ou `frontend/src/cms/` et transmet tout problème à l'agent. Les paramètres et hooks existants sont conservés. `rebase skills --hooks` installe le hook seul.

### `rebase telemetry`

Partage anonyme des données d'utilisation, désactivé jusqu'à ce que vous acceptiez. Une commande `rebase init` interactive pose la question à la fin, et l'invite est réglée sur « non » par défaut ; rien n'est donc partagé à moins que vous ne répondiez « oui ». La réponse est conservée par machine (`~/.rebase/telemetry.json`) : après un « oui », `init` ne redemande plus jamais, et après un « non », le prochain `init` posera à nouveau la question. Chaque copie locale du projet reçoit un identifiant de projet aléatoire, conservé dans son fichier `.rebase/telemetry-project.json` ignoré par git.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` affiche le paramètre actuel, `show` affiche exactement ce qui serait envoyé — que le partage soit activé ou non, afin que vous puissiez examiner le contenu avant de décider — et les deux autres le modifient. Si vous n'avez jamais exécuté `init`, rien n'a jamais été collecté.

## Prochaines étapes

- **[Génération de schéma](/docs/cli/schema/#production-workflow)** — Le flux de migration, de la modification d'une table à la production
- **[Le schéma comme code](/docs/architecture/schema-as-code)** — Comment fonctionne la génération de schéma
- **[Démarrage rapide](/docs/getting-started/quickstart)** — Premiers pas
