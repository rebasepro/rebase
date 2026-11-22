---
sourceHash: c5b8a13884254638
title: Référence de la CLI
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

`--json` est le modificateur, et en dehors de la famille `cloud`, c'est le seul : `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` et `rebase verify` écrivent alors une valeur JSON unique sur stdout — le résultat, ou une enveloppe `{"error": {"message", "code", "hint", "issues"}}` avec un code de sortie non nul — à **chaque** sortie de la commande, de sorte qu'un appelant puisse analyser stdout sans condition. Sans cette option, elles affichent du texte lisible par un humain et les erreurs vont vers stderr. `rebase cloud` utilise la même enveloppe et constitue la seule exception au modificateur : elle active également le JSON d'elle-même lorsque stdout n'est pas un TTY, ou lorsque `REBASE_JSON=1` est défini. Ainsi, `rebase cloud status | cat` produit du JSON tandis que `rebase status | cat` non — dans un script, passez explicitement `--json` plutôt que de vous fier à l'une ou l'autre règle.

## Commandes

### `rebase init`

Initialiser un nouveau projet Rebase :

```bash
rebase init [directory]
```

Configure un répertoire `backend/` (les tables dans `backend/schema/`) et un répertoire `frontend/` (le panneau d'administration, avec ses personnalisations de tables dans `frontend/src/cms/`) ; `--headless` génère uniquement le `backend/`, sans `backend/schema/`. La [Structure du projet](/docs/getting-started/project-structure/) présente les deux arborescences.

| Option | Rôle |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Par défaut `blog` |
| `--headless` | Backend uniquement — pas de panneau d'administration ni de `backend/schema/` : le serveur dessert directement les tables de la base de données. `--template` n'a aucun effet, car il n'y a pas de tables à initialiser |
| `-y, --yes` | Ne jamais demander de confirmation. **Requis chaque fois qu'aucun terminal n'est disponible pour répondre**, comme dans un environnement CI. Cela ignore l'initialisation de git et l'installation des dépendances — les invites interactives répondent oui par défaut aux deux, passez donc `--git` / `--install` si vous les souhaitez |
| `-i, --install` | Installer les dépendances après l'échafaudage. Sans cette option, init pose la question (oui par défaut) ; sous `--yes`, rien n'est installé |
| `--no-install` | Ne rien installer et ne pas poser la question |
| `-g, --git` | Initialiser un dépôt et effectuer le premier commit. Sans cette option, init pose la question (oui par défaut) ; sous `--yes`, aucun dépôt n'est créé |
| `--database-url <url>` | Utiliser une base de données existante au lieu de la base gérée. Il doit s'agir d'une URL `postgres://` ou `postgresql://` : toute autre valeur est refusée avant qu'un fichier ne soit écrit, et l'invite interactive repose la question |
| `--introspect` | Générer `backend/schema` à partir de cette base de données. Implique `--template blank` et nécessite `--install` |
| `--project <slug>` | Lier l'échafaudage à un projet Rebase Cloud |
| `--setup-key <key>` | La clé à usage unique authentifiant cette liaison |
| `-a, --agent <name>` | Configurer les agents de codage IA : les [compétences](/docs/ai/skills) et le [serveur MCP](/docs/ai/mcp). Répétable ou séparé par des virgules — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sans cette option, `init` pose la question et pré-coche les agents installés sur la machine ; sous `--yes`, aucun |

### `rebase dev`

Démarrer le serveur de développement :

```bash
rebase dev
```

Démarre à la fois le frontend et le backend avec rechargement à chaud (hot reloading), et régénère le schéma Drizzle ainsi que les types du SDK (`generated/sdk/`) au démarrage et à chaque enregistrement sous `backend/schema/`.

Les deux ports sont dérivés du chemin du projet, ce qui permet à plusieurs projets Rebase de tourner côte à côte. Utilisez les URL affichées par `rebase dev`. Fixez-en un avec `rebase dev --port 3001`.

Une application statique dans `rebase.json` sans étape de build (pas de `build`, et `output` correspond à son `root`, comme un site HTML brut) est servie par le backend depuis ce répertoire, à son `path`, tout comme `rebase start` la sert depuis le bundle, et `FRONTEND_URL` est configurée vers celle-ci (sur le port du backend) afin que les liens envoyés par e-mail y mènent. <span class="since-badge" data-since="0.35">Depuis 0.35</span> Ses [`redirects` et `cleanUrls`](/docs/architecture/redirects-and-clean-urls/) sont également pris en charge, et une application déclarant des redirections n'a pas besoin de `index.html`. Une application avec build s'exécute dans Vite sur son propre port, et `FRONTEND_URL` est celui de Vite.

Une modification de `.env` redémarre le backend, qui relit le fichier, tout comme le panneau d'administration. Ce que `rebase dev` configure lui-même est conservé jusqu'à son redémarrage : `PORT`, et `DATABASE_URL` lorsqu'il utilise la base de données gérée ou Docker.

Avec `--database-url`, `rebase dev` vérifie d'abord que quelque chose répond à cet hôte et ce port. Si rien ne répond, il le signale en mentionnant l'option et quitte avec le code `1` sans rien démarrer ; il laisse également intactes les variables `.env` de la base de données, sans jamais lancer son conteneur compose.

### `rebase build`

Compiler le projet dans un bundle déployable dans `dist-bundle/` :

```bash
rebase build
```

Le bundle est l'artefact que vous déployez — l'image du runtime le charge, il n'y a donc aucune image applicative à construire vous-même. Options utiles :

| Option | Effet |
|------|--------|
| `--output <dir>` (ou `--out`) | Écrire le bundle ailleurs que dans `dist-bundle/` (une application à la fois) |
| `--vendor` | Toujours installer et intégrer les dépendances au bundle |
| `--no-vendor` | Ne jamais intégrer les dépendances ; le pod les installe à chaque démarrage |
| `--skip-type-check` | Ignorer la vérification de types (plus rapide, moins sûr) |
| `--no-static` | Ne pas regrouper le frontend dans le bundle du backend (chaque application statique reçoit toujours son propre bundle) |
| `--skip-static-build` | Intégrer le frontend tel que déjà compilé, sans exécuter sa commande de build |

Un frontend — toute application statique de `rebase.json` dotée d'une configuration Vite — dont la configuration n'utilise pas `rebaseBackendGuard()` (provenant de `@rebasepro/app/vitePlugin`) est refusé : c'est ce qui empêche le code serveur de se retrouver dans le bundle navigateur, et empêche Vite d'intégrer un fichier backend en tant qu'URL `data:` (le build échoue, en s'identifiant, lorsqu'un autre plugin remplace son `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` est inclus dans le bundle en tant que `entry.uiConfig`, la présentation de l'espace de travail servie par un backend déployé.

Les dépendances sont intégrées (vendored) par défaut afin qu'une nouvelle instance ne subisse pas un délai d'installation de 35 à 55 secondes. Une arborescence qui dépasse 2 Go sur le disque est rejetée, la limite de téléversement étant de 1 Go compressé.

Chaque application statique transportée par le bundle reçoit une copie brotli (`.br`) et une copie gzip (`.gz`) à côté de chaque asset d'au moins 1 Ko doté d'un hash de contenu — les fichiers mis en cache par un navigateur pendant un an. Le runtime envoie celle que le navigateur accepte, de sorte que ces fichiers n'entraînent aucun travail de compression par requête, y compris lors de la première visite suivant un déploiement, et les navigateurs acceptant brotli le reçoivent (environ 11 % plus compact que gzip pour le JavaScript de l'administration). La sortie de compilation propre à votre frontend est laissée telle quelle ; seule la copie dans le bundle change. Sur l'application d'exemple, cela ajoute moins d'une seconde au build et environ 2,4 Mo au bundle.

### `rebase upgrade`

Faire basculer chaque paquet `@rebasepro/*` verrouillé par le projet vers une version unique, puis installer avec le gestionnaire de paquets indiqué par son fichier lockfile. `rebase upgrade` prend la dernière version (`latest`) ; `--to 0.21.0` une version exacte, sans recherche dans le registre ; `--to canary` un dist-tag. Chaque version verrouillée dans `dependencies`, `devDependencies` et `optionalDependencies`, dans chaque `package.json` du projet, conserve son `^` ou `~`, et rien d'autre dans le fichier n'est modifié. `peerDependencies` ainsi que les spécifications `workspace:`, `link:`, `file:`, git et par tag sont répertoriées et laissées intactes. Les substitutions (overrides) dans `pnpm-workspace.yaml` et `package.json` sont également déplacées, mais une substitution `link:` ou `file:` l'emporte sur tout verrouillage : elle est signalée, et `--drop-local-overrides` la supprime. `--dry-run` n'écrit rien, `--no-install` ignore l'installation et `--json` affiche un document unique.

Un projet sur une préversion, telle qu'une version canary, reste sur son canal à moins que `latest` ne soit plus récent. Un dist-tag qui déplacerait un paquet vers une version antérieure est refusé (`downgrade_refused` sous `--json`), sauf si vous spécifiez `--allow-downgrade` ; un `--to` exact est appliqué et signalé comme une rétrogradation. Un `--dry-run` d'une mise à niveau qu'une exécution réelle refuserait indique ce qui changerait et se termine avec le code 0, et sous `--json`, son document contient le refus sous `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Exécuter le bundle compilé de la même manière qu'un déploiement l'exécute :

```bash
rebase start
```

Lit `PORT` et le reste de `.env`, contrairement à `rebase dev`, dans le `NODE_ENV` qu'ils définissent. Un `.env` généré indique `development`, de sorte que le premier compte enregistré devient toujours l'administrateur, et `rebase start` l'indique en tête de sortie ; définissez `NODE_ENV=production` pour un serveur de production. `rebase start --bundle ./dist-bundle` exécute un bundle situé ailleurs.

`rebase start` ne démarre aucune base de données, et le `.env` de l'échafaudage ne contient aucun `DATABASE_URL`. Une exécution locale sur la base de données utilisée par `rebase dev` s'effectue donc avec `DATABASE_URL="$(rebase db url)" rebase start`. Sans celle-ci, la commande affiche cette ligne avant de démarrer.

### `rebase apps list`

Afficher les applications déclarées par ce dépôt :

```bash
rebase apps list
```

Un dépôt peut déclarer plusieurs applications déployables — par exemple un backend et un site marketing. C'est ainsi que vous pouvez voir sur quoi `rebase build` et le déploiement vont agir.

### `rebase eject`

Prendre le contrôle total du processus serveur et de son image :

```bash
rebase eject
```

Écrit le point d'entrée du backend et un `Dockerfile` dans le projet et bascule son backend, afin que le dépôt construise sa propre image au lieu d'exécuter le runtime publié. À partir de ce moment, **les mises à niveau du runtime de la plateforme ne s'appliquent plus**, et la configuration de CORS, de l'authentification, du stockage et de l'arrêt du serveur devient votre responsabilité.

Prévisualisez les changements avec `rebase eject --dry-run`, qui liste ce qui changerait sans rien modifier. `--force` remplace un fichier existant `backend/src/index.ts` ou `env.ts`, en conservant le fichier actuel sous la forme `<name>.bak`.

Le serveur éjecté conserve les téléversements locaux dans le dossier `uploads/` du projet, exécuté depuis les sources ou compilé, tout comme `rebase dev`. Il s'exécute dans `backend/`, de sorte qu'un `STORAGE_PATH` relatif y est lu depuis `backend/`.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # liste les différences avec les tables, quitte avec 1 si différent
rebase schema stale --fix    # régénère le fichier à la place
```

Chaque commande qui lit le schéma accepte `--schema-dir <dir>` pour les projets qui le conservent ailleurs ; `--collections` a été supprimé. `rebase dev` maintient le fichier à jour, de sorte que `stale` est la vérification recommandée pour un build ou en CI. Voir [Génération de schéma](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # appliquer les tables à la base de données (développement)
rebase db generate             # écrire un fichier de migration SQL
rebase db migrate              # appliquer les migrations en attente
rebase db url                  # afficher la chaîne de connexion utilisée par ce projet
rebase db pull --from <url>    # copier une autre base de données dans la base locale
rebase db backup               # pg_dump ; db backups list et db restore sont également disponibles
rebase db branch create <name> # une copie de travail ; permuter, lister et élaguer également
rebase db stop                 # arrêter la base de données de développement gérée
rebase db reset                # la supprimer et repartir de zéro
rebase db request-role migrate --to <role> # transférer les requêtes vers un autre rôle Postgres
rebase db provision --print    # le SQL configurant le rôle de requête, pour un DBA
```

Chacune est détaillée dans les [Commandes de base de données](/docs/cli/database/), avec l'ordre de priorité selon lequel une commande sélectionne sa base de données ; `push`, `generate` et `migrate` sont traitées en détail dans la section [Génération de schéma](/docs/cli/schema/).

### `rebase console`

Un REPL Node avec les données du projet accessibles, ou un extrait de code exécuté avec `-e` :

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) et `tables` (les tables du projet, chargées depuis `backend/schema`) sont dans la portée, et le mot-clé `await` au niveau supérieur fonctionne. La base de données est résolue de la même façon que pour `rebase db push`, et son ouverture n'y modifie rien. Avec `-e`, le résultat résolu est affiché au format JSON sur stdout et une exception entraîne une sortie avec le code `1`. Options : `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Voir [Scripts et la Console](/docs/backend/scripts/).

### `rebase migrate`

Migrations unidirectionnelles depuis une structure que cette version ne lit plus :
`rebase migrate collections-to-tables` (`config/collections` → `backend/schema` et `frontend/src/cms`) et `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` dans votre propre code). Leurs options, ce qu'elles écrivent et la section « Review before deploying » sont décrits dans [Génération de schéma](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # les applications déclarées par ce projet
rebase apps init             # écrire un rebase.json déduit de ce projet
rebase apps config <app>     # la configuration client pour une application
```

`apps init` ne prend aucun nom : elle déduit chaque application du projet et écrit l'intégralité de `rebase.json`, et refuse de remplacer un fichier existant sauf si vous passez `--force`.

Un argument de nom est refusé. `--force` conserve ce que l'inférence ne peut pas deviner du fichier qu'elle remplace : le nom de chaque application, son `path` et sa route `cms`. Tout le reste est déduit à nouveau, et une application déclarée qu'elle ne trouve plus est marquée comme supprimée ; ainsi, sur un échafaudage, elle réécrit le `rebase.json` d'origine. La commande de build de l'application statique utilise le gestionnaire de paquets du projet.

Pour une copie de travail non liée à un projet Cloud, `apps config` indique qu'elle n'est pas liée, que `rebase dev` soit en cours d'exécution ou non, et fournit l'URL du backend telle que servie par `rebase dev`.

### `rebase apps add admin`

```bash
rebase apps add admin                  # à la racine /, ou sur /admin lorsqu'une autre application est sur /
rebase apps add admin --path /console  # n'importe où ailleurs, ou sa propre URL https
```

Ajoute le panneau d'administration à un projet headless ou porté, tel que `rebase init` l'aurait généré. Ce qu'elle écrit, la version qu'elle verrouille et les cas de refus sont décrits dans [Ajout ultérieur d'un panneau d'administration](/docs/getting-started/headless/#adding-an-admin-panel-later).

### `rebase status`

Tout ce que ce projet déclare, et si l'environnement y est réellement lié :

```bash
rebase status               # chaque ressource et les variables qu'elle lit
rebase status --json        # lisible par une machine
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

Trois fichiers déterminent ce à quoi un backend peut accéder, et cette commande affiche les trois réunis : `rebase.json` indique où se trouve votre code et qui exécute le serveur, `backend/resources.ts` indique les besoins du projet, et l'environnement indique comment accéder à chaque élément. Tout le reste — `rebase.resources.json`, le manifeste du bundle — est généré à partir de ce dernier pour les outils qui ne peuvent pas exécuter votre code, et vous ne l'écrivez jamais directement.

Un `○` représente l'état qu'il vaut mieux connaître avant un déploiement plutôt qu'après : déclaré, mais non configuré. Un `✗` signifie que l'environnement configure quelque chose d'*incorrect*, ce qui empêche le démarrage plutôt que de fonctionner en mode dégradé.

Un fichier `rebase.resources.json` qui ne correspond plus aux déclarations reçoit une ligne `○`. Un fichier qui n'a pas encore été généré n'en reçoit pas : `rebase build` l'écrit à chaque compilation, donc un projet qui n'a jamais été compilé, tel qu'un nouvel échafaudage, n'a rien à corriger.

### `rebase resources`

Ce que ce projet déclare comme prérequis — les bases de données, buckets, topics et files d'attente (queues) demandés par `backend/resources.ts`, ainsi que les tâches cron et fonctions définies par ses fichiers :

```bash
rebase resources            # les lister
rebase resources --write    # régénérer rebase.resources.json
rebase resources --check    # échouer si le graphe versionné n'est pas à jour
rebase resources --json     # lisible par une machine
```

`rebase resources --check` est l'option utilisée par un job CI pour échouer si `rebase.resources.json` ne correspond plus à `backend/resources.ts`. `--json` peut être combiné avec celle-ci : en cas de dérive, `rebase resources --check --json` quitte avec le code 1 et une enveloppe d'erreur (`resource_graph_missing` ou `resource_graph_stale`), et en cas de succès, le graphe porte `check.status`. `--write --json` écrit le fichier et indique `written.changed`.

Une ressource est déclarée dans `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou correspond à un fichier sous `backend/crons` ou `backend/functions`, et n'est jamais écrite à la main dans `rebase.resources.json`, qui est généré à partir de ces déclarations afin qu'un hébergeur puisse lire les besoins d'un projet sans le compiler. Chaque entrée consigne qui l'utilise (`table:events`, `column:posts.cover`, `function:report`).

Un backend possède également une base de données par défaut et une source de stockage par défaut que personne ne déclare. Les deux sont répertoriées ici avec la mention `implicit`, et aucune n'est écrite dans `rebase.resources.json` — l'hébergeur les fournit, les consigner demanderait donc le provisionnement de ressources que personne n'a sollicitées. Déclarer une ressource nommée, comme `bucket("media")`, laisse la ressource par défaut en place, de sorte que les deux sont listées. Seule la déclaration explicite de la ressource par défaut, ou le marquage d'un bucket avec `default: true`, la remplace.

Pour comparer ce que la plateforme détient pour un projet par rapport à ce que son code déclare, et pour supprimer une base de données provisionnée que le code ne mentionne plus, consultez [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — toutes les commandes pour Rebase Cloud : authentification, liaison de projet, déploiements, configuration, bases de données, ressources, calcul et plus — dispose de [sa propre page](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Génère un client typé pour les tables exportées par `backend/schema/index.ts` dans `generated/sdk/`, avec `TableName` et `tablesDictionary` ; `--from <link|url>` lit à la place le contrat d'un backend en cours d'exécution. `--register` type également les données côté serveur : elle écrit les types et la déclaration `Register` dans `backend/generated/` et l'enregistre dans `rebase.json` (`registerDatabase`). Voir [Données typées côté serveur](/docs/backend/typed-server-data) et [Génération de schéma](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

La commande à exécuter quand quelque chose ne va pas et que vous ne savez pas encore quoi. Elle se contente de rapporter des informations sans jamais rien modifier, elle peut donc être exécutée sans risque sur toute base de données accessible.

**Sans base de données.** Ces vérifications s'exécutent en premier, car tout ce qui empêche un projet de fonctionner survient avant même qu'une table puisse être comparée :

| Vérification | Motif |
| --- | --- |
| Version de Node | Par rapport à la plage déclarée par la CLI. Une version trop ancienne n'est pas signalée comme « Node non supporté » — c'est une erreur de syntaxe à l'intérieur d'une dépendance. |
| Gestionnaires de paquets | Deux lockfiles dans un même projet. `npm install` dans un workspace pnpm réorganise `node_modules` d'une manière incompatible avec pnpm, et le symptôme est une erreur `Cannot find module` quelques heures plus tard. |
| Slugs en double | Deux tables déclarant le même slug. Le schéma refuse de compiler dans ce cas, et cette vérification nomme les deux tables. |
| Cohérence du `.env` | Un `JWT_SECRET` de moins de 32 caractères (sur lequel la production refuse de démarrer), et `NODE_ENV=production` sans `CORS_ORIGINS` ni `FRONTEND_URL`. Les valeurs ne sont jamais affichées. |
| Divergence de versions `@rebasepro/*` | Le même paquet verrouillé sur des versions différentes dans les fichiers `package.json` du projet. Deux copies brisent le fonctionnement de `instanceof` entre elles, ce qui échoue en tant que type guard rejetant son propre type. |
| Chaînes de connexion | Un caractère `=` non encodé dans un paramètre d'URL, que les outils propres à PostgreSQL refusent d'analyser — ainsi les sauvegardes et `psql` échouent alors que l'application continue de fonctionner. |
| Fonctions personnalisées | Ce dont chaque fonction a besoin de la part de son hôte, et lesquelles ne s'exécuteraient pas sur un runtime edge. |

**Sur la base de données** — celle du projet, résolue comme `rebase db url` la résout ; sur un projet fraîchement échafaudé, il s'agit donc de la base gérée, que `doctor` démarre :

| Vérification | Motif |
| --- | --- |
| Tables → schéma généré | Indique si `schema.generated.ts` est obsolète. |
| Tables → base de données | Tables, colonnes, enums, clés étrangères et tables de jonction manquantes. |
| Extensions requises | Une colonne `col.vector()` nécessite pgvector, que Rebase n'installe que là où un projet l'a déclaré. |
| Empreinte du schéma (schema stamp) | Indique si cette base de données a été provisionnée à partir de ces tables. Il s'agit d'un hash, ce qui permet de dire que les deux divergent, sans jamais savoir laquelle est en avance. Une empreinte `v1:` issue d'un runtime antérieur à 0.31 est signalée une fois, avec la commande de mise à jour : `rebase db push`. |
| Tables → types SDK | Indique si le SDK typé généré est obsolète. |
| Politiques RLS | Indique si les politiques de la base de données correspondent au `rls` déclaré, et si une politique fait référence à un rôle que ce serveur ne peut pas utiliser. |

Si la base de données est inaccessible, ses phases sont signalées comme ignorées avec le motif correspondant et le reste s'exécute quand même — voir [Dépannage](/docs/troubleshooting/).

Quitte avec un code non nul lorsqu'une vérification détecte une erreur, ou lorsqu'une phase n'a pas pu s'exécuter parce que la base de données fournie refuse les connexions. Une phase ignorée parce qu'aucune base de données n'a pu être résolue n'est pas considérée comme un échec.

`rebase doctor --policies` exécute uniquement les vérifications RLS — aucune comparaison de schéma ni de types SDK — et adopte une politique de rejet par défaut (fail closed), ce qui en fait la commande idéale comme étape de validation en CI face à une base de données déployée.

`rebase doctor --database` exécute uniquement le contrôle préalable de la base de données : si le rôle sous lequel s'exécutent les requêtes authentifiées existe, est restreint et peut être endossé, quels autres comptes peuvent l'endosser, si chaque rôle est autorisé à se connecter, et quelles tables, autorisations et politiques Rebase partagerait avec d'autres rôles. Chaque résultat mentionne le SQL à exécuter en tant qu'administrateur, le paramètre `rls` qui adapte plutôt Rebase à la base de données, ou les deux. Elle lit le catalogue et ne modifie rien, puis quitte avec le code 1 lorsqu'un résultat est en échec. Cela fonctionne également sur un projet headless. Voir [Exécution sur une base de données existante ou partagée](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Vérifier si les tables sont prêtes pour la production, en une seule commande rapide pour la CI et pour les hooks d'un agent IA. Hors ligne par défaut, et ne modifie jamais rien.

| Étape | Ce qui provoque un échec |
| --- | --- |
| Définitions de tables (`schema`) | `backend/schema` ne se charge pas ou ne compile pas via le chargeur avec lequel le backend démarre : une relation vers une table que l'index n'exporte pas, `rls: "inherit"` sans `defaultRls`, une table sans clé primaire — un problème signalé par anomalie. Une table sans `rls` en fait partie. |
| Couverture RLS (`rls`) | Une table comportant une colonne `user_id`, `owner_id`, `organization_id` ou `tenant_id` dont les règles — les siennes ou le `defaultRls` dont elle hérite — permettent à un rôle de lire chaque ligne sans tenir compte de cette colonne. Un avertissement. `rls-policy-recursion` : une règle qui lit sa propre table dans une sous-requête, ou deux tables dont les règles se lisent mutuellement, ce que Postgres refuse de développer, de sorte que chaque instruction protégée échoue avec `42P17 infinite recursion detected in policy` ; le résultat mentionne la table lue et le correctif, déplaçant la lecture dans une fonction `SECURITY DEFINER`. Une erreur, ou un avertissement lorsque la boucle n'est pas certaine. |
| Fraîcheur des migrations (`migrations`) | Une table ou colonne déclarée par les tables qu'aucun fichier dans `backend/drizzle/migrations` ne crée, ou une table/colonne qu'elles ont supprimée mais qu'une migration continue de créer. Ignoré pour un projet ne disposant pas encore de migrations. |
| Personnalisations CMS (`cms`) | Un appel `customizeTable(...)` dans `frontend/src/cms` (ou le `src/cms` d'une application statique dans `rebase.json`) qui ne correspond pas aux tables, lu de manière statique — les modules ne sont pas exécutés. `cms-unknown-table` : le slug ne correspond à aucune table, le panneau l'ignore donc (le slug le plus proche est suggéré). `cms-unknown-field` : une clé sous `fields` n'est ni une colonne ni une relation (le nom SQL d'une colonne est retourné avec sa clé). `cms-hidden-required` : un champ exclu du formulaire (`hiddenInForm`, `readOnly`, `disabled`) dont la colonne est `NOT NULL` sans valeur par défaut et sans élément rempli par le serveur, de sorte que la création d'un enregistrement depuis le panneau échoue toujours ; un avertissement lorsqu'un hook `beforeSave` ou une transformation peut le renseigner, et masqué par `filledByServer`. `cms-duplicate-customization` : un même slug personnalisé deux fois. `cms-not-static` (un avertissement) : un appel dont le slug, les options ou les `fields` ne sont pas des valeurs littérales ou une constante `const` dans le même fichier, donc aucun élément n'a pu être vérifié. `cms-ui-config-not-mounted` (un avertissement) : `frontend/src/cms/ui-config.json` existe mais n'est pas fourni à `<RebaseCMS>` sous `uiConfig`. `cms-backend-guard-missing` : la configuration Vite du frontend n'utilise pas `rebaseBackendGuard()`, `rebase build` la refuserait donc. Un projet headless ne possède pas de répertoire `frontend/src/cms` et ignore cette étape. |
| Audit RLS en direct (`live`) | Avec `--live` : le catalogue [`rls-check`](/docs/rls-check) par rapport à la base de données du projet, et la vérification de l'application de chaque migration. La base de données est résolue de la même manière que pour les commandes `db` — `--database-url`, `DATABASE_URL`, `--docker`, sinon la base de développement gérée. Une base de données non configurée ou qui ne répond pas génère une erreur et n'est pas ignorée : l'audit a été explicitement demandé. Une politique de lecture `USING (true)` compilée à partir d'une règle `access: "public"` constitue un avertissement tant que l'API exige un jeton (`AUTH_REQUIRE`, activé par défaut) — chaque utilisateur authentifié lit chaque ligne — et une erreur avec `AUTH_REQUIRE=false`, où les lignes sont accessibles de manière anonyme. |

`--json` affiche un objet unique, `{ ok, schemaDir, steps, findings, summary }` : chaque étape contient `{ id, title, status, detail? }` (`status` valant `passed`, `failed`, `warnings` ou `skipped`), et chaque résultat inclut `step`, `check` (un type stable en kebab-case), `severity`, `message`, et le cas échéant `fix`, `table`, `file`, `line` et le chemin pointé (`path`) dans la table (`posts.rls[0]`) — afin qu'un agent puisse réparer ce qu'il a cassé. `summary` comptabilise `errors` et `warnings`. `--quiet` n'affiche rien lorsque tout réussit. Quitte avec un code non nul en cas d'erreur ; les avertissements n'entraînent pas d'échec.

Un projet échafaudé l'exécute pour Claude Code après chaque modification sous `backend/schema/` : voir [`rebase skills install`](#rebase-skills-install).

### Commandes pour une application en cours d'exécution

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` et `rebase storage ls|cp|rm|url|stat` agissent sur une application en cours d'exécution par le biais de son API : le `rebase dev` local, un serveur spécifié avec `--url`, ou un projet Rebase Cloud avec `--project`. Voir [Une application en cours d'exécution](/docs/cli/project/).

### `rebase auth`

Commandes de gestion de l'authentification :

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gérer les clés d'API de service du projet — les identifiants utilisés par un agent, un script ou un autre service, par opposition à la session d'un utilisateur final :

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` liste ce que la clé peut effectuer, séparé par des virgules ou répété ; `--full-access` lui attribue tous les scopes détenus par la clé de service, sauf `keys:*`. `--roles` ajoute des rôles RLS en plus de `service`, `--expires-in` prend un nombre de jours et `--expires-at` une date ISO. `rebase api-keys scopes` répertorie tous les scopes reconnus par le backend. Une clé n'est affichée qu'une seule fois. Les scopes de la clé et la sécurité au niveau des lignes (RLS) de l'identité qu'elle endosse s'appliquent tous deux. Voir [Clés d'API](/docs/backend/api-keys/).

### `rebase storage`

Maintenance globale des fichiers stockés, via le backend en cours d'exécution avec `REBASE_SERVICE_KEY` depuis `.env` :

```bash
rebase storage orphans                         # fichiers référencés par aucune ligne
rebase storage orphans --source media --delete # et les supprimer, après confirmation
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lit chaque ligne de chaque table telle que stockée (lignes supprimées de façon logique incluses, au-delà de chaque hook `beforeQuery` et `afterRead`) et chaque entrée de l'[historique](/docs/backend/history/), puisqu'une restauration rétablit son contenu. Elle liste les fichiers d'une source (`--source`, la source par défaut en cas d'omission) qu'aucune chaîne de caractères ne référence parmi eux : une clé, une URL, une référence `rebase-storage:` dans un texte. Les fichiers plus récents que `--older-than` heures (24 par défaut) sont exclus, car le panneau d'administration téléverse un fichier avant que la ligne qui le mentionne ne soit enregistrée. L'analyse s'exécute sur le backend en arrière-plan, de sorte qu'un projet trop volumineux pour être analysé dans une seule requête (derrière un ingress qui déclencherait un timeout) arrive quand même à terme. La CLI la démarre, puis affiche sa progression (fichiers listés, lignes lues, tables terminées et celles qui n'ont pas pu être lues) jusqu'à ce qu'elle soit achevée. Lorsque la [file de tâches](/docs/backend/jobs/) est activée, l'analyse est un job `storage.orphans` exécuté par les workers de jobs. Sans elle, l'analyse s'exécute à l'intérieur du processus serveur sollicité, et la CLI le signale : redémarrer ce processus interrompt l'analyse. Une analyse représente une tentative de tâche, limitée par `jobs.timeoutMs` (15 minutes par défaut). Augmentez-la, ou réglez-la sur 0, pour une source qui nécessite plus de temps. `--json` affiche le même rapport qu'auparavant, en y ajoutant son `scanId`.

`--delete` demande confirmation avant de supprimer (`--yes` ignore la question et est requis en l'absence de terminal). La commande ne supprime que des éléments issus de l'analyse qui vient d'être affichée, et seulement dans les 15 minutes suivant l'achèvement de cette analyse. Rien n'est supprimé tant qu'une table ne peut pas être lue : une table comportant des hooks de lecture sur une base de données dont le pilote ne peut pas passer outre est considérée comme non lue. Avant de supprimer quoi que ce soit, le serveur relit chaque ligne et chaque entrée d'historique par rapport aux fichiers listés. Puis il vérifie à nouveau chaque fichier juste avant de le supprimer. Un fichier désormais référencé par une ligne, qui a été téléversé à nouveau depuis l'analyse, ou qui a disparu, est conservé, et la CLI l'indique comme conservé. Les fichiers référencés uniquement par des tables non gérées par Rebase apparaissent comme inutilisés : vérifiez avant de supprimer. Face à un backend en version 0.25.1 ou antérieure, la CLI effectue l'analyse à l'ancienne, au sein d'une seule requête.

`move` copie les fichiers situés sous `--prefix` vers une autre source sous les mêmes clés, page par page. Un fichier déjà présent dans la cible avec la même taille est ignoré, de sorte qu'un déplacement interrompu peut être repris en réexécutant la commande ; `--delete-source` supprime chaque fichier de la source dès que la cible le détient, et est refusé lorsque les deux sources stockent dans le même bucket ou répertoire. Une fois le déplacement terminé, la CLI liste à nouveau la source avec un nouveau parcours et nomme chaque fichier que le déplacement n'a pas transféré : avec `--delete-source`, tout fichier encore présent dans la source ; sans cette option, tout fichier dont la cible ne détient pas de copie de taille identique. Elle se termine avec le code 1 s'il en existe, et réexécuter le même déplacement le prendra en charge. `--json` les affiche sous `notMoved`. La lecture du rapport d'une analyse nécessite `database:read`. Lancer une analyse, supprimer et déplacer nécessitent `database:write`, que la clé de service détient.

### `rebase skills install`

Installer les compétences de référence Rebase pour vos assistants de codage IA — tous les `--agent` mentionnés ci-dessus :

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Voir les [Compétences d'agent](/docs/ai/skills) pour la liste complète et l'emplacement où les fichiers sont écrits.

`--hooks` installe le garde-fou Claude Code que `rebase init` fournit avec chaque projet : `.claude/hooks/post-edit-collection.sh`, enregistré en tant que hook `PostToolUse` dans `.claude/settings.json`, qui exécute `rebase verify --quiet` après chaque modification sous `backend/schema/` ou `frontend/src/cms/` et transmet tout problème à l'agent. Les paramètres et hooks existants sont conservés. `rebase skills --hooks` installe le hook seul.

### `rebase telemetry`

Partage anonyme des données d'utilisation, désactivé tant que vous n'avez pas donné votre accord. Une exécution interactive de `rebase init` pose la question à la fin, et l'invite répond non par défaut, de sorte que rien n'est partagé à moins que vous ne répondiez oui. La réponse est propre à chaque machine (`~/.rebase/telemetry.json`) : après un oui, `init` ne redemande plus jamais, et après un non, le prochain `init` posera à nouveau la question. Chaque copie locale reçoit un identifiant de projet aléatoire, conservé dans son fichier ignoré par git `.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` affiche le réglage actuel, `show` affiche exactement ce qui serait envoyé — que le partage soit activé ou non, afin que vous puissiez examiner les données avant de décider — et les deux autres le modifient. Si vous n'avez jamais exécuté `init`, aucune donnée n'a jamais été collectée.

## Étapes suivantes

- **[Génération de schéma](/docs/cli/schema/#production-workflow)** — Le flux de travail de migration, de l'édition d'une table jusqu'à la production
- **[Schema as Code](/docs/architecture/schema-as-code)** — Comment fonctionne la génération de schéma
- **[Démarrage rapide](/docs/getting-started/quickstart)** — Pour commencer
