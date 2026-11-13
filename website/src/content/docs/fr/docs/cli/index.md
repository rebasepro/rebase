---
sourceHash: 4281e973dcdf0b86
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

`--json` est le sélecteur, et en dehors de la famille `cloud`, c'est le seul : `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` et `rebase verify` placent alors une valeur JSON sur stdout — le résultat, ou une enveloppe `{"error": {"message", "code", "hint", "issues"}}` avec un code de sortie non nul — à **chaque** sortie de la commande, de sorte qu'un appelant puisse analyser stdout sans condition. Sans cela, elles affichent du texte lisible par un humain et les échecs vont vers stderr. `rebase cloud` utilise la même enveloppe et constitue la seule exception au sélecteur : elle active également le JSON d'elle-même lorsque stdout n'est pas un TTY, ou lorsque `REBASE_JSON=1` est défini. Ainsi, `rebase cloud status | cat` produit du JSON tandis que `rebase status | cat` n'en produit pas — dans un script, passez explicitement `--json` plutôt que de vous fier à l'une ou l'autre de ces règles.

## Commandes

### `rebase init`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Initialiser un nouveau projet Rebase :

```bash
rebase init [directory]
```

Configure un `backend/` (les tables dans `backend/schema/`) et un `frontend/` (le panneau d'administration, avec ses personnalisations de table dans `frontend/src/cms/`) ; `--headless` échafaude le `backend/` seul, sans `backend/schema/`. La [Structure du projet](/docs/getting-started/project-structure/) présente les deux arborescences.

| Option | Ce qu'elle fait |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Par défaut `blog` |
| `--headless` | Backend seul — aucun panneau d'administration et pas de `backend/schema/` : le serveur dessert les propres tables de la base de données. `--template` n'a aucun effet, car il n'y a pas de tables à initialiser |
| `-y, --yes` | Ne jamais demander de confirmation. **Requis chaque fois qu'il n'y a pas de terminal pour répondre**, comme en CI. Cela ignore l'initialisation de git et l'installation des dépendances — les valeurs interactives par défaut acceptent les deux, passez donc `--git` / `--install` si vous les souhaitez |
| `-i, --install` | Installer les dépendances après l'échafaudage. Sans cela, init demande confirmation (oui par défaut) ; avec `--yes`, rien n'est installé |
| `--no-install` | N'installer rien et ne pas demander |
| `-g, --git` | Initialiser un dépôt et créer le premier commit. Sans cela, init demande confirmation (oui par défaut) ; avec `--yes`, aucun dépôt |
| `--database-url <url>` | Utiliser une base de données existante au lieu de la base gérée. Il doit s'agir d'une URL `postgres://` ou `postgresql://` : toute autre valeur est refusée avant qu'un fichier ne soit écrit, et l'invite interactive repose la question |
| `--introspect` | Générer `backend/schema` à partir de cette base de données. Implique `--template blank` et nécessite `--install` |
| `--project <slug>` | Lier l'échafaudage à un projet Rebase Cloud |
| `--setup-key <key>` | La clé à usage unique authentifiant cette liaison |
| `-a, --agent <name>` | Configurer les agents de codage IA : les [skills](/docs/ai/skills) et le [serveur MCP](/docs/ai/mcp). Répétable ou séparé par des virgules — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sans cela, `init` pose la question et pré-coche les agents installés sur la machine ; avec `--yes`, aucun |

### `rebase dev`

Démarrer le serveur de développement :

```bash
rebase dev
```

Démarre à la fois le frontend et le backend avec rechargement à chaud (hot reloading), et régénère le schéma Drizzle ainsi que les types du SDK (`generated/sdk/`) au démarrage et à chaque sauvegarde sous `backend/schema/`.

Les deux ports sont dérivés du chemin du projet afin que plusieurs projets Rebase puissent s'exécuter côte à côte. Utilisez les URL affichées par `rebase dev`. Figez-en un avec `rebase dev --port 3001`.

Une modification de `.env` redémarre le backend, qui relit le fichier, tout comme le panneau d'administration. Ce que `rebase dev` définit lui-même est conservé jusqu'à ce que vous le redémarriez : `PORT`, et `DATABASE_URL` lorsqu'il est sur la base de données gérée ou sur Docker.

Avec `--database-url`, `rebase dev` vérifie d'abord que quelque chose répond à cet hôte et ce port. Si rien ne répond, il le signale en nommant l'option, et quitte avec le code `1` sans rien avoir démarré ; il ne touche pas non plus aux noms de variables de base de données dans `.env`, ne démarrant jamais son conteneur compose.

### `rebase build`

Compiler le projet en un bundle déployable dans `dist-bundle/` :

```bash
rebase build
```

Le bundle est l'artefact que vous déployez — l'image du runtime le charge, il n'y a donc aucune image d'application à construire vous-même. Options utiles :

| Option | Effet |
|------|--------|
| `--output <dir>` (ou `--out`) | Écrire le bundle ailleurs que dans `dist-bundle/` (une application à la fois) |
| `--vendor` | Toujours installer et inclure les dépendances du bundle |
| `--no-vendor` | Ne jamais inclure les dépendances (vendor) ; le pod les installe à chaque démarrage |
| `--skip-type-check` | Ignorer la vérification de type (plus rapide, moins sûr) |
| `--no-static` | Ne pas intégrer le frontend dans le bundle backend (chaque application statique conserve son propre bundle) |
| `--skip-static-build` | Intégrer le frontend tel que déjà compilé, sans exécuter sa commande de build |

<span class="since-badge" data-since="0.31">Depuis 0.31</span> Un frontend — chaque application statique de `rebase.json` avec une configuration Vite — dont la configuration n'utilise pas `rebaseBackendGuard()` (de `@rebasepro/app/vitePlugin`) est refusé : c'est ce qui empêche le code serveur d'entrer dans le bundle du navigateur, et empêche Vite d'intégrer un fichier backend sous forme d'URL `data:` (le build échoue, en se nommant, lorsqu'un autre plugin remplace son `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` est transporté dans le bundle sous la forme `entry.uiConfig`, la présentation de l'espace de travail desservie par un backend déployé.

Les dépendances sont incluses (vendored) par défaut afin qu'une nouvelle instance n'ait pas à subir une installation de 35 à 55 secondes. Une arborescence qui dépasse 2 Go sur le disque est abandonnée à la place, car la limite de téléversement est de 1 Go compressé.

Chaque application statique transportée par le bundle reçoit une copie brotli (`.br`) et une copie gzip (`.gz`) à côté de chaque asset haché par son contenu de 1 Ko ou plus — les fichiers qu'un navigateur met en cache pendant un an. Le runtime envoie celle que le navigateur accepte, de sorte que ces fichiers ne coûtent aucun travail de compression par requête, y compris lors de la première visite après un déploiement, et les navigateurs acceptant brotli le reçoivent (environ 11 % plus petit que gzip sur le JavaScript de l'administration). La sortie de compilation propre à votre frontend reste inchangée ; seule la copie dans le bundle change. Sur l'application d'exemple, cela ajoute moins d'une seconde au build et environ 2,4 Mo au bundle.

### `rebase upgrade`

Fait passer chaque paquet `@rebasepro/*` verrouillé par le projet à une seule version, puis installe avec le gestionnaire de paquets indiqué par son lockfile. `rebase upgrade` prend la dernière version (`latest`) ; `--to 0.21.0` une version exacte, sans recherche dans le registre ; `--to canary` un dist-tag. Chaque version fixée dans `dependencies`, `devDependencies` et `optionalDependencies`, dans chaque `package.json` du projet, conserve son `^` ou `~`, et rien d'autre dans le fichier ne change. Les `peerDependencies` et les spécifications `workspace:`, `link:`, `file:`, git et de balises sont listées et laissées intactes. Les overrides dans `pnpm-workspace.yaml` et `package.json` changent également, mais un override `link:` ou `file:` l'emporte sur toute version fixée : il est signalé, et `--drop-local-overrides` le supprime. `--dry-run` n'écrit rien, `--no-install` ignore l'installation, et `--json` affiche un document unique.

Un projet sur une préversion, comme une canary, reste sur son canal à moins que `latest` ne soit plus récent. Un dist-tag qui ferait rétrograder une version est refusé (`downgrade_refused` avec `--json`) sauf si vous passez `--allow-downgrade` ; un `--to` exact est appliqué et marqué comme rétrogradation. Un `--dry-run` d'une mise à niveau qu'une exécution réelle refuserait montre ce qui changerait et se termine avec le code 0, et avec `--json`, son document contient le refus sous la forme `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Exécuter le bundle compilé de la même manière qu'un déploiement l'exécute :

```bash
rebase start
```

Lit `PORT` et le reste de `.env`, contrairement à `rebase dev`, dans le `NODE_ENV` qu'ils définissent. Un `.env` échafaudé indique `development`, ainsi le premier compte enregistré devient toujours l'administrateur, et `rebase start` l'indique en haut ; définissez `NODE_ENV=production` pour un serveur de production. `rebase start --bundle ./dist-bundle` exécute un bundle situé ailleurs.

`rebase start` ne démarre aucune base de données, et le `.env` de l'échafaudage n'a pas de `DATABASE_URL`, donc une exécution locale sur la base de données utilisée par `rebase dev` se fait via `DATABASE_URL="$(rebase db url)" rebase start`. Sans cela, il affiche cette ligne avant de démarrer.

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

Écrit le point d'entrée du backend et un `Dockerfile` dans le projet et bascule son backend, de sorte que le dépôt construit sa propre image au lieu d'exécuter le runtime publié. À partir de ce moment, **les mises à niveau du runtime de la plateforme ne l'affectent plus**, et la configuration de CORS, du câblage d'authentification, du stockage et de l'arrêt vous incombe.

Prévisualisez-le avec `rebase eject --dry-run`, qui liste les modifications sans rien changer. `--force` remplace un fichier `backend/src/index.ts` ou `env.ts` existant, en conservant le fichier actuel sous le nom `<name>.bak`.

Le serveur éjecté conserve les téléversements locaux dans le dossier `uploads/` du projet, qu'il soit exécuté depuis les sources ou compilé, tout comme `rebase dev`. Il s'exécute dans `backend/`, donc un `STORAGE_PATH` relatif y est lu à partir de `backend/`.

### `rebase schema generate` / `rebase schema stale`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Chaque commande qui lit le schéma accepte `--schema-dir <dir>` pour un projet qui le conserve ailleurs ; `--collections` a été supprimé. `rebase dev` maintient le fichier à jour, `stale` est donc la vérification appropriée pour un build ou la CI. Voir [Génération de schéma](/docs/cli/schema/).

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

Chacune de ces commandes est détaillée dans [Commandes de base de données](/docs/cli/database/), avec l'ordre dans lequel une commande choisit sa base de données ; `push`, `generate` et `migrate` sont traitées en détail dans [Génération de schéma](/docs/cli/schema/).

### `rebase console`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un REPL Node ouvert avec les données du projet, ou un extrait de code exécuté avec `-e` :

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) et `collections` (les tables du projet, chargées depuis `backend/schema`) sont dans la portée (in scope), et le `await` de premier niveau fonctionne. La base de données est résolue de la même manière que `rebase db push` la résout, et son ouverture n'y modifie rien. Avec `-e`, le résultat attendu est affiché au format JSON sur stdout et une exception se termine avec le code `1`. Options : `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Voir [Scripts et console](/docs/backend/scripts/).

### `rebase migrate`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Des migrations à sens unique depuis une disposition que cette version ne lit plus : `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` et `frontend/src/cms`) et `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` dans votre propre code). Leurs options, ce qu'elles écrivent et la section « Review before deploying » se trouvent dans [Génération de schéma](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` ne prend aucun nom : elle déduit chaque application du projet et écrit l'intégralité de `rebase.json`, et refuse de remplacer un fichier existant à moins de passer `--force`.

Un argument de nom est refusé. `--force` conserve ce que l'inférence ne peut pas déduire du fichier qu'elle remplace : le nom de chaque application, son `path` et sa route `cms`. Tout le reste est déduit à nouveau, et une application déclarée qui n'est plus trouvée est indiquée comme supprimée ; ainsi, sur un échafaudage, elle réécrit le `rebase.json` d'origine. La commande de build de l'application statique utilise le gestionnaire de paquets du projet.

Pour un checkout non lié à un projet Cloud, `apps config` indique qu'il n'est pas lié, que `rebase dev` soit en cours d'exécution ou non, et fournit l'URL du backend telle que `rebase dev` la dessert.

### `rebase status`

Tout ce que ce projet déclare, et si l'environnement s'y lie réellement :

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

Trois fichiers déterminent ce qu'un backend peut atteindre, et cette commande affiche les trois ensemble : `rebase.json` indique où se trouve votre code et qui exécute le serveur, `backend/resources.ts` indique ce dont le projet a besoin, et l'environnement indique comment joindre chaque élément. Tout le reste — `rebase.resources.json`, le manifeste du bundle — est généré à partir du deuxième fichier pour les programmes de lecture qui ne peuvent pas exécuter votre code, et vous ne l'écrivez jamais à la main.

Un `○` représente l'état qu'il vaut mieux connaître avant un déploiement plutôt qu'après : déclaré, mais non configuré. Un `✗` signifie que l'environnement définit quelque chose d'*incorrect*, ce qui refuse le démarrage au lieu de fonctionner en mode dégradé.

Un `rebase.resources.json` qui ne correspond plus aux déclarations reçoit une ligne `○`. Un fichier qui n'a pas encore été écrit n'en reçoit pas : `rebase build` l'écrit à chaque build, donc un projet qui n'a jamais été compilé, tel qu'un nouvel échafaudage, n'a rien à corriger.

### `rebase resources`

Ce que ce projet déclare nécessiter — les bases de données, buckets, topics et files d'attente (queues) demandés par `backend/resources.ts`, ainsi que les crons et fonctions définis par ses fichiers :

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` est l'option utilisée par un job CI pour échouer sur un `rebase.resources.json` qui ne correspond plus à `backend/resources.ts`. `--json` se combine avec elle : en cas de dérive, `rebase resources --check --json` quitte avec le code 1 et une enveloppe d'erreur (`resource_graph_missing` ou `resource_graph_stale`), et en cas de succès, le graphe comporte `check.status`. `--write --json` écrit le fichier et renvoie `written.changed`.

Une ressource est déclarée dans `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou est un fichier sous `backend/crons` ou `backend/functions`, et n'est jamais écrite à la main dans `rebase.resources.json`, qui est généré à partir de ces déclarations afin qu'un hôte puisse lire les besoins d'un projet sans avoir à le compiler. Chaque entrée enregistre qui l'utilise (`table:events`, `column:posts.cover`, `function:report`).

Un backend possède également une base de données par défaut et une source de stockage par défaut que personne ne déclare. Les deux sont listées ici avec la mention `implicit`, et aucune n'est écrite dans `rebase.resources.json` — l'hôte les fournit, donc les consigner reviendrait à demander de provisionner quelque chose que personne n'a demandé. Déclarer une ressource nommée, telle que `bucket("media")`, laisse celle par défaut telle quelle, donc les deux sont listées. Seule la déclaration explicite de la ressource par défaut, ou le marquage d'un bucket avec `default: true`, la remplace.

Pour voir ce que la plateforme détient pour un projet par rapport à ce que son code déclare, et pour supprimer une base de données provisionnée que le code ne mentionne plus, consultez [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — toutes les commandes pour Rebase Cloud : authentification, liaison de projet, déploiements, configuration, bases de données, ressources, calcul et plus encore — dispose de [sa propre page](/docs/cli/cloud).

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```bash
rebase generate-sdk
```

Écrit un client typé pour les tables exportées par `backend/schema/index.ts` dans `generated/sdk/`, avec `TableName` et `tablesDictionary` ; `--from <link|url>` lit à la place le contrat d'un backend en cours d'exécution. `--register` type également les données côté serveur : il écrit les types et la déclaration `Register` dans `backend/generated/` et s'en souvient dans `rebase.json` (`registerDatabase`). Voir [Données typées côté serveur](/docs/backend/typed-server-data) et [Génération de schéma](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

La commande à exécuter lorsque quelque chose ne va pas et que vous ne savez pas encore quoi. Elle génère un rapport sans jamais rien modifier, elle est donc sans danger vis-à-vis de toute base de données accessible.

**Sans base de données.** Ces vérifications s'exécutent en premier, car tout ce qui empêche totalement un projet de fonctionner survient avant même qu'une table ne puisse être comparée :

| Vérification | Raison |
| --- | --- |
| Version de Node | Par rapport à la plage déclarée par la CLI. Une version trop ancienne n'est pas signalée comme « Node non pris en charge » — il s'agit d'une erreur de syntaxe à l'intérieur d'une dépendance. |
| Gestionnaires de paquets | Deux lockfiles dans un même projet. Un `npm install` dans un workspace pnpm réécrit `node_modules` selon une structure incompatible avec pnpm, dont le symptôme est une erreur `Cannot find module` des heures plus tard. |
| Slugs en double | Deux tables déclarant le même slug. Le schéma refuse de compiler dans ce cas, et cette vérification nomme les deux. |
| Validité du `.env` | Un `JWT_SECRET` de moins de 32 caractères (sur lequel la production refuse de démarrer), et `NODE_ENV=production` sans `CORS_ORIGINS` ni `FRONTEND_URL`. Les valeurs ne sont jamais affichées. |
| Écart de version `@rebasepro/*` | Le même paquet fixé à des versions différentes dans les fichiers `package.json` du projet. Deux copies brisent le `instanceof` entre elles, ce qui échoue en tant que garde de type rejetant son propre type. |
| Chaînes de connexion | Un `=` non encodé dans un paramètre d'URL, que les outils propres à PostgreSQL refusent d'analyser — ce qui fait échouer les sauvegardes et `psql` pendant que l'application continue de fonctionner. |
| Fonctions personnalisées | Ce dont chaque fonction a besoin de la part de son hôte, et lesquelles ne s'exécuteraient pas sur un runtime edge. |

**Sur la base de données** — celle du projet, résolue de la manière dont `rebase db url` la résout, donc sur un échafaudage récent, il s'agit de la base de données gérée, que `doctor` démarre :

| Vérification | Raison |
| --- | --- |
| Tables → schéma généré | Indique si `schema.generated.ts` est obsolète. |
| Tables → base de données | Tables, colonnes, énumérations, clés étrangères et tables de jonction manquantes. |
| Extensions requises | Une colonne `col.vector()` nécessite pgvector, que Rebase n'installe que là où un projet l'a déclaré. |
| Empreinte du schéma | Indique si cette base de données a été provisionnée à partir de ces tables. Un hash, permettant de signaler un désaccord sans jamais préciser laquelle est en avance. Une empreinte `v1:` provenant d'un runtime antérieur à 0.31 est signalée une fois, avec la commande de ré-empreinte : `rebase db push`. |
| Tables → types du SDK | Indique si le SDK typé généré est obsolète. |
| Politiques RLS | Indique si les politiques de la base de données correspondent au `rls` que vous avez déclaré, et si une politique nomme un rôle que ce serveur ne peut pas utiliser. |

Si la base de données est inaccessible, ses phases sont signalées comme ignorées avec la raison correspondante et le reste s'exécute quand même — voir [Dépannage](/docs/troubleshooting/).

Se termine avec un code non nul lorsqu'une vérification détecte une erreur, ou lorsqu'une phase n'a pas pu s'exécuter parce que la base de données fournie refuse les connexions. Une phase ignorée parce qu'aucune base de données n'a pu être résolue n'est pas considérée comme un échec.

`rebase doctor --policies` exécute uniquement les vérifications RLS — aucun diff de schéma, aucun type SDK — et adopte une politique de refus par défaut (fails closed), ce qui en fait la forme à utiliser comme porte d'entrée CI contre une base de données déployée.

`rebase doctor --database` exécute uniquement le contrôle préalable de la base de données : vérifie si le rôle sous lequel s'exécutent les requêtes authentifiées existe, est restreint et peut être endossé, quels autres identifiants peuvent basculer vers lui, si chaque rôle peut se connecter, et quelles tables, privilèges (grants) et politiques Rebase partagerait avec d'autres rôles. Chaque constat indique le SQL à exécuter en tant qu'administrateur, le paramètre `rls` qui adapte plutôt Rebase à la base de données, ou les deux. Il lit le catalogue sans rien modifier et quitte avec le code 1 lorsqu'un constat constitue un échec. Il fonctionne également sur un projet headless. Voir [Exécution sur une base de données existante ou partagée](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Indique si les tables sont prêtes pour la production, en une commande rapide pour la CI et pour les hooks d'un agent IA. Hors ligne par défaut, et ne modifie jamais rien.

| Étape | Causes d'échec |
| --- | --- |
| Définitions de tables (`schema`) | `backend/schema` ne se charge pas ou ne compile pas via le chargeur depuis lequel le backend démarre : une relation vers une table que l'index n'exporte pas, `rls: "inherit"` sans `defaultRls`, une table sans clé primaire — un constat par problème. Une table sans `rls` en fait partie. |
| Couverture RLS (`rls`) | Une table avec une colonne `user_id`, `owner_id`, `organization_id` ou `tenant_id` dont les règles — les siennes, ou le `defaultRls` dont elle hérite — permettent à un rôle de lire chaque ligne sans tenir compte de cette colonne. Un avertissement. |
| Fraîcheur des migrations (`migrations`) | Une table ou colonne déclarée par les tables qu'aucun fichier dans `backend/drizzle/migrations` ne crée, ou une qu'elles ont supprimée mais qu'une migration crée toujours. Ignoré pour un projet sans migrations pour l'instant. |
| Personnalisations CMS (`cms`) | Un `customizeTable(...)` dans `frontend/src/cms` (ou le `src/cms` d'une application statique dans `rebase.json`) qui ne correspond pas aux tables, lu statiquement — les modules ne sont pas exécutés. `cms-unknown-table` : le slug ne nomme aucune table, donc le panneau l'ignore (le slug le plus proche est suggéré). `cms-unknown-field` : une clé sous `fields` n'est ni une colonne ni une relation (le nom SQL d'une colonne reçoit en réponse sa clé). `cms-hidden-required` : un champ exclu du formulaire (`hiddenInForm`, `readOnly`, `disabled`) dont la colonne est `NOT NULL` sans valeur par défaut et que le serveur ne remplit pas, de sorte que la création d'un enregistrement depuis le panneau échoue toujours ; un avertissement lorsqu'un hook `beforeSave` ou une transformation peut le remplir, désactivé par `filledByServer`. `cms-duplicate-customization` : un slug personnalisé deux fois. `cms-not-static` (un avertissement) : un appel dont le slug, les options ou `fields` ne sont pas des littéraux ou une constante `const` dans le même fichier, donc rien n'y a été vérifié. `cms-ui-config-not-mounted` (un avertissement) : `frontend/src/cms/ui-config.json` existe mais `<RebaseCMS>` ne le reçoit pas comme `uiConfig`. `cms-backend-guard-missing` : la configuration Vite du frontend n'utilise pas `rebaseBackendGuard()`, donc `rebase build` la refuserait. Un projet headless n'a pas de `frontend/src/cms` et ignore cette étape. |
| Audit RLS en direct (`live`) | Avec `--live` : le catalogue [`rls-check`](/docs/rls-check) sur la base de données du projet, et vérification que chaque migration a été appliquée. La base de données est résolue comme pour les commandes `db` — `--database-url`, `DATABASE_URL`, `--docker`, sinon la base de données de développement gérée. Une base de données non configurée ou qui ne répond pas constitue une erreur, pas une étape ignorée : l'audit a été explicitement demandé. Une politique de lecture `USING (true)` compilée à partir d'une règle `access: "public"` est un avertissement tant que l'API requiert un token (`AUTH_REQUIRE`, activé par défaut) — chaque utilisateur authentifié lit chaque ligne — et une erreur avec `AUTH_REQUIRE=false`, où les lignes sont anonymes. |

`--json` affiche un objet unique, `{ ok, schemaDir, steps, findings, summary }` : chaque étape est `{ id, title, status, detail? }` (`status` vaut `passed`, `failed`, `warnings` ou `skipped`), et chaque constat contient `step`, `check` (un type stable en kebab-case), `severity`, `message`, et le cas échéant `fix`, `table`, `file`, `line` ainsi que le `path` séparé par des points dans la table (`posts.rls[0]`) — permettant ainsi à un agent de corriger ce qu'il a cassé. `summary` compte les `errors` et `warnings`. `--quiet` n'affiche rien lorsque tout réussit. Quitte avec un code non nul en cas d'erreur ; les avertissements ne provoquent pas d'échec.

Un projet échafaudé l'exécute pour Claude Code après chaque modification sous `backend/schema/` : voir [`rebase skills install`](#rebase-skills-install).

### `rebase auth`

Commandes de gestion de l'authentification :

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gérer les clés d'API de service du projet — l'identifiant utilisé par un agent, un script ou un autre service, par opposition à la session d'un utilisateur final :

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` indique ce que la clé peut faire, séparé par des virgules ou répété ; `--full-access` lui donne toutes les portées (scopes) que détient la clé de service, sauf `keys:*`. `--roles` ajoute des rôles RLS en plus de `service`, `--expires-in` prend un nombre de jours et `--expires-at` une date ISO. `rebase api-keys scopes` liste chaque portée que le backend connaît. Une clé n'est affichée qu'une seule fois. Les portées de la clé et la sécurité au niveau des lignes (RLS) de l'identité qu'elle incarne s'appliquent toutes deux. Voir [Clés d'API](/docs/backend/api-keys/).

### `rebase storage`

Maintenance globale des fichiers stockés, via le backend en cours d'exécution avec `REBASE_SERVICE_KEY` issu de `.env` :

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lit chaque ligne de chaque table telle que stockée (lignes supprimées de manière réversible / soft-deleted incluses, au-delà de chaque hook `beforeQuery` et `afterRead`) et chaque entrée de l'[historique](/docs/backend/history/), puisqu'un rétablissement restaure ce qu'elle contient. Elle liste les fichiers d'une source (`--source`, la source par défaut si omise) qu'aucune chaîne de caractères dans aucune d'entre elles ne nomme : une clé, une URL, une référence `rebase-storage:` dans un texte. Les fichiers plus récents que `--older-than` heures (24 par défaut) sont exclus, car le panneau d'administration téléverse un fichier avant que la ligne qui le nomme ne soit enregistrée. L'analyse s'exécute en arrière-plan sur le backend, de sorte qu'un projet trop volumineux pour être analysé au sein d'une seule requête (derrière un ingress qui provoquerait un timeout) se termine quand même. La CLI la démarre, puis affiche sa progression (fichiers listés, lignes lues, tables traitées, et celles qui n'ont pas pu être lues) jusqu'à son achèvement. Avec la [file de tâches](/docs/backend/jobs/) activée, l'analyse est un job `storage.orphans` exécuté par les workers de jobs. Sans cela, l'analyse s'exécute dans le processus serveur interrogé, et la CLI le signale : redémarrer ce processus interrompt l'analyse. Une analyse représente une tentative de job, limitée par `jobs.timeoutMs` (15 minutes par défaut). Augmentez cette valeur, ou définissez-la à 0, pour une source nécessitant plus de temps. `--json` affiche le même rapport qu'auparavant, avec en plus son `scanId`.

`--delete` demande confirmation avant de supprimer (`--yes` saute la confirmation et est requis sans terminal). La suppression ne s'effectue qu'à partir de l'analyse qui vient d'être affichée, et uniquement dans les 15 minutes suivant la fin de cette analyse. Rien n'est supprimé tant qu'une table ne peut pas être lue : une table dotée de hooks de lecture sur une base de données dont le pilote ne peut pas passer outre compte comme non lue. Avant de supprimer quoi que ce soit, le serveur relit chaque ligne et entrée d'historique par rapport aux fichiers listés. Ensuite, il demande à nouveau confirmation pour chaque fichier juste avant de le supprimer. Un fichier qu'une ligne référence désormais, qui a été téléversé à nouveau depuis l'analyse, ou qui a disparu est conservé, et la CLI l'indique comme conservé. Les fichiers qui ne sont nommés que par des tables que Rebase ne dessert pas semblent inutilisés : vérifiez avant de supprimer. Face à un backend version 0.25.1 ou antérieure, la CLI effectue l'analyse à l'ancienne, au sein d'une seule requête.

`move` copie les fichiers situés sous `--prefix` vers une autre source sous les mêmes clés, page par page. Un fichier que la cible possède déjà à la même taille est ignoré, de sorte qu'un déplacement interrompu reprend en le réexécutant ; `--delete-source` supprime chaque fichier de la source une fois que la cible le possède, et est refusé lorsque les deux sources utilisent le même bucket ou répertoire. Une fois le déplacement terminé, la CLI parcourt à nouveau la source et nomme chaque fichier que le déplacement n'a pas transféré : avec `--delete-source`, tout fichier toujours présent dans la source ; sans cette option, tout fichier dont la cible ne détient pas de copie de taille identique. Elle se termine avec le code 1 s'il en existe un, et relancer le même déplacement le prendra en charge. `--json` les affiche sous forme de `notMoved`. La lecture du rapport d'une analyse nécessite `database:read`. Démarrer une analyse, supprimer et déplacer nécessitent `database:write`, que possède la clé de service.

### `rebase skills install`

Installer les compétences (skills) de référence Rebase pour vos assistants de codage IA — chaque `--agent` ci-dessus :

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Voir les [Compétences d'agent](/docs/ai/skills) pour la liste complète et l'emplacement où les fichiers sont écrits.

`--hooks` installe le garde-fou Claude Code que `rebase init` fournit avec chaque projet : `.claude/hooks/post-edit-collection.sh`, enregistré en tant que hook `PostToolUse` dans `.claude/settings.json`, qui exécute `rebase verify --quiet` après chaque modification sous `backend/schema/` ou `frontend/src/cms/` et renvoie tout problème à l'agent. Les paramètres et hooks existants sont conservés. `rebase skills --hooks` installe le hook seul.

### `rebase telemetry`

Partage d'utilisation anonyme, désactivé tant que vous n'avez pas accepté. Un `rebase init` interactif pose la question à la fin, et l'invite est réglée par défaut sur non, donc rien n'est partagé sauf si vous répondez oui. La réponse s'applique par machine (`~/.rebase/telemetry.json`) : après un oui, `init` ne redemande plus jamais, et après un non, le prochain `init` redemandera. Chaque checkout reçoit un identifiant de projet aléatoire, conservé dans son fichier ignoré par git `.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` affiche le paramètre actuel, `show` affiche exactement ce qui serait envoyé — que le partage soit activé ou non, afin que vous puissiez lire la charge utile avant de décider — et les deux autres le modifient. Si vous n'avez jamais exécuté `init`, rien n'a jamais été collecté.

## Prochaines étapes

- **[Génération de schéma](/docs/cli/schema/#production-workflow)** — Le flux de travail de migration, de la modification d'une table à la production
- **[Schéma as Code](/docs/architecture/schema-as-code)** — Comment fonctionne la génération de schéma
- **[Démarrage rapide](/docs/getting-started/quickstart)** — Lancez-vous
