---
sourceHash: 38a7979a6ca8b028
title: Référence de la CLI
sidebar_label: CLI
description: Commandes de la CLI Rebase pour l'initialisation de projet, la génération de schéma, les migrations de base de données et la génération de SDK.
---

## Vue d'ensemble

La CLI Rebase (`rebase`) gère votre projet depuis l'échafaudage jusqu'au déploiement.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Ou exécutez n'importe quelle commande sans l'installer : `pnpm dlx @rebasepro/cli <command>`.

## Sortie lisible par une machine

`--json` est le commutateur, et en dehors de la famille `cloud`, c'est le seul : `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` et `rebase verify` écrivent alors une valeur JSON unique sur stdout — le résultat, ou une enveloppe `{"error": {"message", "code", "hint", "issues"}}` avec un code de sortie non nul — à **chaque** sortie de la commande, afin qu'un appelant puisse analyser stdout sans condition. Sans cette option, elles affichent du texte lisible par l'humain et les erreurs vont sur stderr. `rebase cloud` utilise la même enveloppe et constitue la seule exception au commutateur : elle active également le JSON d'elle-même lorsque stdout n'est pas un TTY, ou lorsque `REBASE_JSON=1` est défini. Ainsi, `rebase cloud status | cat` produit du JSON tandis que `rebase status | cat` non — dans un script, passez explicitement `--json` plutôt que de vous fier à l'une ou l'autre règle.

## Commandes

### `rebase init`

Initialiser un nouveau projet Rebase :

```bash
rebase init [directory]
```

Configure un `backend/` (les tables dans `backend/schema/`) et un `frontend/` (le panneau d'administration, avec ses personnalisations de tables dans `frontend/src/cms/`) ; `--headless` échafaude uniquement le `backend/`, sans `backend/schema/`. La [Structure du projet](/docs/getting-started/project-structure/) présente les deux arborescences.

| Option | Ce qu'elle fait |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Par défaut `blog` |
| `--headless` | Backend uniquement — aucun panneau d'administration et aucun `backend/schema/` : le serveur dessert les tables propres à la base de données. `--template` n'a aucun effet, car il n'y a pas de tables à initialiser |
| `-y, --yes` | Ne jamais demander de confirmation. **Requis dès lors qu'il n'y a pas de terminal pour répondre**, comme dans un environnement CI. Cela ignore l'initialisation de Git et l'installation des dépendances — les valeurs interactives par défaut répondent oui aux deux, passez donc `--git` / `--install` si vous les souhaitez |
| `-i, --install` | Installer les dépendances après l'échafaudage. Sans cette option, init pose la question (oui par défaut) ; sous `--yes`, rien n'est installé |
| `--no-install` | Ne rien installer et ne pas demander |
| `-g, --git` | Initialiser un dépôt et effectuer le premier commit. Sans cette option, init pose la question (oui par défaut) ; sous `--yes`, pas de dépôt |
| `--database-url <url>` | Utiliser une base de données existante au lieu de la base gérée. Il doit s'agir d'une URL `postgres://` ou `postgresql://` : toute autre valeur est refusée avant qu'un fichier ne soit écrit, et l'invite interactive repose la question |
| `--introspect` | Générer `backend/schema` à partir de cette base de données. Implique `--template blank` et nécessite `--install` |
| `--project <slug>` | Lier l'échafaudage à un projet Rebase Cloud |
| `--setup-key <key>` | La clé à usage unique authentifiant cette liaison |
| `-a, --agent <name>` | Configurer des agents de code IA : les [skills](/docs/ai/skills) et le [serveur MCP](/docs/ai/mcp). Répétable ou séparé par des virgules — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sans cela, `init` demande et pré-coche les agents installés sur la machine ; sous `--yes`, aucun |

### `rebase dev`

Démarrer le serveur de développement :

```bash
rebase dev
```

Démarre à la fois le frontend et le backend avec rechargement à chaud (hot reloading), et régénère le schéma Drizzle ainsi que les types du SDK (`generated/sdk/`) au démarrage et à chaque sauvegarde sous `backend/schema/`. Le backend qu'il démarre sert également le [point de terminaison MCP distant](/docs/ai/remote-mcp/) sur `/mcp` sans rien à configurer, à moins qu'une ligne `REBASE_MCP_ENABLED` dans le shell ou dans `.env` n'en décide autrement ; la ligne `MCP:` de la bannière affiche son URL, et [`rebase mcp connect`](/docs/cli/project/#rebase-mcp) y connecte un client IA.

Les deux ports sont dérivés du chemin du projet afin que plusieurs projets Rebase puissent s'exécuter côte à côte. Utilisez les URL affichées par `rebase dev`. Fixez-en un avec `rebase dev --port 3001`.

Une application statique dans `rebase.json` sans étape de build (pas de `build`, et `output` correspond à sa racine `root`, comme un simple site HTML) est servie par le backend depuis ce répertoire, à son `path`, tout comme `rebase start` la sert depuis le bundle, et `FRONTEND_URL` est configurée pour pointer vers celle-ci (sur le port du backend) afin que les liens envoyés par e-mail y atterrissent. Ses [`redirects` et `cleanUrls`](/docs/architecture/redirects-and-clean-urls/) sont également pris en charge, et une application qui déclare des redirections n'a pas besoin de fichier `index.html`.
Une application avec une étape de build s'exécute dans Vite sur son propre port, et `FRONTEND_URL` correspond à celui de Vite.

Une modification de `.env` redémarre le backend, qui lit à nouveau le fichier, tout comme le fait le panneau d'administration. Ce que `rebase dev` configure lui-même est conservé jusqu'à ce que vous le redémarriez : `PORT`, et `DATABASE_URL` lorsqu'il se trouve sur la base de données gérée ou sur Docker.

Avec `--database-url`, `rebase dev` vérifie d'abord que quelque chose répond à cet hôte et ce port. Si rien ne répond, il le signale en nommant l'option, et quitte avec le code `1` sans rien avoir démarré ; il laisse également intacts les noms liés à la base de données dans `.env`, sans jamais démarrer son conteneur compose.

### `rebase build`

Compiler le projet en un bundle déployable dans `dist-bundle/` :

```bash
rebase build
```

Le bundle est l'artefact que vous déployez — l'image du runtime le charge, il n'y a donc aucune image d'application à construire vous-même. Options utiles :

| Option | Effet |
|------|--------|
| `--output <dir>` (ou `--out`) | Écrire le bundle ailleurs que dans `dist-bundle/` (une application à la fois) |
| `--vendor` | Toujours installer et intégrer les dépendances du bundle |
| `--no-vendor` | Ne jamais intégrer (vendor) ; le pod les installe à chaque démarrage |
| `--skip-type-check` | Ignorer la vérification des types (plus rapide, moins sûr) |
| `--no-static` | Ne pas intégrer le frontend dans le bundle du backend (chaque application statique conserve son propre bundle) |
| `--skip-static-build` | Intégrer le frontend tel que déjà compilé, sans exécuter sa commande de build |

Un frontend — chaque application statique de `rebase.json` possédant une configuration Vite — dont la configuration n'utilise pas `rebaseBackendGuard()` (provenant de `@rebasepro/app/vitePlugin`) est refusé : c'est ce qui empêche le code serveur de se retrouver dans le bundle du navigateur, et cela empêche Vite d'intégrer un fichier backend sous la forme d'une URL `data:` (le build échoue, en se nommant lui-même, lorsqu'un autre plugin remplace son `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` est inclus dans le bundle sous le nom `entry.uiConfig`, correspondant à la présentation de l'espace de travail qu'un backend déployé dessert.

Les dépendances sont intégrées (vendored) par défaut afin qu'une nouvelle instance n'ait pas à subir une installation de 35 à 55 secondes. Une arborescence qui dépasse 2 Go sur le disque est abandonnée, car la limite de téléversement est de 1 Go compressé.

Chaque application statique transportée par le bundle reçoit une copie brotli (`.br`) et une copie gzip (`.gz`) à côté de chaque asset avec hash de contenu d'au moins 1 Ko — les fichiers qu'un navigateur met en cache pendant un an. Le runtime envoie celle que le navigateur accepte, de sorte que ces fichiers ne coûtent aucun travail de compression par requête, y compris lors de la première visite suivant un déploiement, et les navigateurs acceptant brotli le reçoivent (environ 11 % plus compact que gzip sur le JavaScript de l'administration). La sortie de compilation propre à votre frontend reste inchangée ; seule la copie dans le bundle change. Sur l'application d'exemple, cela ajoute moins d'une seconde au build et environ 2,4 Mo au bundle.

### `rebase upgrade`

Mettre à niveau tous les paquets `@rebasepro/*` que le projet fige vers une même version, puis installer avec le gestionnaire de paquets indiqué par son fichier lockfile. `rebase upgrade` prend la dernière version ; `--to 0.21.0` une version exacte, sans consultation du registre ; `--to canary` un dist-tag. Chaque version figée dans `dependencies`, `devDependencies` et `optionalDependencies`, dans chaque `package.json` du projet, conserve son `^` ou `~`, et rien d'autre dans le fichier ne change. `peerDependencies` ainsi que les spécificateurs `workspace:`, `link:`, `file:`, git et tags sont listés et laissés intacts. Les surcharges dans `pnpm-workspace.yaml` et `package.json` sont également mises à jour, mais une surcharge `link:` ou `file:` l'emporte sur toutes les versions figées : elle est signalée, et `--drop-local-overrides` la supprime. `--dry-run` n'écrit rien, `--no-install` ignore l'installation, et `--json` affiche un document unique.

Un projet sur une pré-version, telle qu'une canary, reste sur son canal à moins que `latest` ne soit plus récent. Un dist-tag qui ferait rétrograder une version est refusé (`downgrade_refused` sous `--json`), sauf si vous passez `--allow-downgrade` ; un `--to` exact est appliqué et marqué comme rétrogradation. Un `--dry-run` d'une mise à niveau que l'exécution réelle refuserait montre ce qui changerait et se termine avec le code 0, et sous `--json`, son document contient le refus sous `wouldRefuse` (`{ code, message, hint }`).
Une fois installé, il actualise également les [agent skills](/docs/ai/skills/#updating-the-skills) du projet à partir de la nouvelle CLI (`skills` dans le document `--json`). D'autres commandes se terminent par une ligne sur stderr lorsqu'une version plus récente est disponible ; [`REBASE_NO_UPDATE_CHECK=1`](/docs/getting-started/configuration/) la masque.

### `rebase start`

Exécuter le bundle compilé de la même manière qu'un déploiement l'exécute :

```bash
rebase start
```

Lit `PORT` et le reste de `.env`, contrairement à `rebase dev`, dans le `NODE_ENV` défini. Un `.env` échafaudé indique `development`, de sorte que le premier compte à s'inscrire devient toujours l'administrateur, et `rebase start` l'indique en haut ; définissez `NODE_ENV=production` pour un serveur de production. `rebase start --bundle ./dist-bundle` exécute un bundle situé ailleurs.

`rebase start` ne démarre aucune base de données, et le fichier `.env` de l'échafaudage ne contient aucun `DATABASE_URL` ; par conséquent, une exécution locale sur la base de données utilisée par `rebase dev` se fait via `DATABASE_URL="$(rebase db url)" rebase start`.
Sans cela, il affiche cette ligne avant de démarrer.

### `rebase apps list`

Afficher les applications déclarées par ce dépôt :

```bash
rebase apps list
```

Un dépôt peut déclarer plusieurs applications déployables — par exemple, un backend et un site marketing. C'est ainsi que vous voyez sur quoi `rebase build` et le déploiement vont agir.

### `rebase eject`

Prendre le contrôle complet du processus serveur et de son image :

```bash
rebase eject
```

Écrit le point d'entrée du backend et un `Dockerfile` dans le projet et bascule son backend, afin que le dépôt construise sa propre image au lieu d'exécuter le runtime publié. À partir de ce moment, **les mises à jour du runtime de la plateforme ne lui parviennent plus**, et la configuration de CORS, de l'authentification, du stockage et de l'arrêt vous incombe.

Prévisualisez les changements avec `rebase eject --dry-run`, qui liste ce qui changerait sans rien modifier. `--force` remplace un `backend/src/index.ts` ou `env.ts` existant, en conservant le fichier actuel sous `<name>.bak`.

Le serveur éjecté conserve les téléversements locaux dans le répertoire `uploads/` du projet, exécuté depuis les sources ou compilé, tout comme le fait `rebase dev`. Il s'exécute dans `backend/`, de sorte qu'un `STORAGE_PATH` relatif y est lu depuis `backend/`.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # liste les différences avec les tables, quitte avec 1 si différent
rebase schema stale --fix    # régénère le fichier à la place
```

Toute commande qui lit le schéma accepte `--schema-dir <dir>` pour un projet qui le conserve ailleurs ; `--collections` a été supprimé. `rebase dev` maintient le fichier à jour, donc `stale` est la vérification à utiliser pour un build ou en CI. Voir [Génération de schéma](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # appliquer les tables à la base de données (développement)
rebase db generate             # écrire un fichier de migration SQL
rebase db migrate              # appliquer les migrations en attente
rebase db url                  # afficher la chaîne de connexion utilisée par ce projet
rebase db pull --from <url>    # copier une autre base de données dans la locale
rebase db backup               # pg_dump ; db backups list et db restore à ses côtés
rebase db branch create <name> # une copie de travail ; switch, list et prune également disponibles
rebase db stop                 # arrêter la base de données de développement gérée
rebase db reset                # la supprimer et repartir de zéro
rebase db request-role migrate --to <role> # basculer les requêtes vers un autre rôle Postgres
rebase db provision --print    # le SQL configurant le rôle de requête, pour un DBA
```

Chacune est détaillée sur [Commandes de base de données](/docs/cli/database/), avec l'ordre dans lequel une commande choisit sa base de données ; `push`, `generate` et `migrate` sont traités en profondeur sur [Génération de schéma](/docs/cli/schema/).

### `rebase console`

Un REPL Node avec les données du projet accessibles, ou un extrait de code exécuté avec `-e` :

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) et `tables` (les tables du projet, chargées depuis `backend/schema`) sont dans la portée, et l'`await` de premier niveau fonctionne. La base de données est résolue de la même manière que `rebase db push` la résout, et son ouverture n'y modifie rien. Avec `-e`, le résultat attendu est affiché sous forme de JSON sur stdout et une exception entraîne une sortie avec le code `1`. Options : `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Voir [Scripts et la Console](/docs/backend/scripts/).

### `rebase migrate`

Opérations à sens unique depuis une structure que cette version ne lit plus :
`rebase migrate collections-to-tables` (`config/collections` → `backend/schema` et `frontend/src/cms`) et `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` dans votre propre code). Leurs options, ce qu'elles écrivent et la section « Review before deploying » se trouvent sur [Génération de schéma](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # les applications déclarées par ce projet
rebase apps init             # écrire un rebase.json déduit de ce projet
rebase apps config <app>     # la configuration client pour une application
```

`apps init` ne prend aucun nom : elle déduit chaque application du projet, écrit l'intégralité de `rebase.json` et refuse de remplacer un fichier existant à moins de passer `--force`.

Un argument de nom est refusé. `--force` conserve ce que l'inférence ne peut pas deviner à partir du fichier qu'elle remplace : le nom de chaque application, son `path` et sa route `cms`. Tout le reste est de nouveau déduit, et une application déclarée qu'elle ne trouve plus est indiquée comme supprimée ; ainsi, sur un échafaudage, elle réécrit le `rebase.json` fourni à l'origine. La commande de build de l'application statique utilise le gestionnaire de paquets du projet.

Pour une copie locale non liée à un projet Cloud, `apps config` signale qu'elle n'est pas liée, que `rebase dev` soit en cours d'exécution ou non, et fournit l'URL du backend telle que `rebase dev` la sert.

### `rebase apps add admin`

```bash
rebase apps add admin                  # à /, ou à /admin lorsqu'une autre application est à /
rebase apps add admin --path /console  # n'importe où ailleurs, ou une URL https propre
```

Ajoute le panneau d'administration à un projet headless ou porté, tel que `rebase init` l'aurait écrit. Ce qu'elle écrit, quelle version elle fige et les cas de refus : [Ajouter un panneau d'administration ultérieurement](/docs/getting-started/headless/#adding-an-admin-panel-later).

### `rebase status`

Tout ce que ce projet déclare, et si l'environnement le lie effectivement :

```bash
rebase status               # chaque ressource et les variables qu'elle lit
rebase status --json        # format lisible par une machine
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

Trois fichiers déterminent ce qu'un backend peut atteindre, et cette commande affiche les trois ensemble :
`rebase.json` indique où se trouve votre code et qui exécute le serveur, `backend/resources.ts` précise ce dont le projet a besoin, et l'environnement définit comment atteindre chaque élément. Tout le reste — `rebase.resources.json`, le manifeste du bundle — est généré à partir du fichier intermédiaire pour les lecteurs incapables d'exécuter votre code, et vous ne l'écrivez jamais vous-même.

Un `○` représente l'état qu'il vaut mieux connaître avant un déploiement plutôt qu'après : déclaré, mais non configuré. Un `✗` signifie que l'environnement configure quelque chose de façon *incorrecte*, ce qui empêche le démarrage plutôt que de dégrader le fonctionnement.

Un fichier `rebase.resources.json` qui ne correspond plus aux déclarations obtient une ligne `○`. Un fichier qui n'a pas encore été écrit n'en reçoit pas : `rebase build` l'écrit à chaque compilation, donc un projet qui n'a jamais été compilé, tel qu'un échafaudage tout juste créé, n'a rien à corriger.

### `rebase resources`

Ce que ce projet déclare comme prérequis — les bases de données, buckets, topics et files d'attente demandés par `backend/resources.ts`, ainsi que les crons et fonctions définis par ses fichiers :

```bash
rebase resources            # les lister
rebase resources --write    # régénérer rebase.resources.json
rebase resources --check    # échouer si le graphe commité est obsolète
rebase resources --json     # lisible par une machine
```

`rebase resources --check` est l'option qu'un job CI utilise pour échouer face à un `rebase.resources.json` qui ne correspond plus à `backend/resources.ts`.
`--json` se combine avec elle : en cas de dérive, `rebase resources --check --json` quitte avec le code 1 et une enveloppe d'erreur (`resource_graph_missing` ou `resource_graph_stale`), et en cas de succès, le graphe inclut `check.status`. `--write --json` écrit le fichier et renvoie `written.changed`.

Une ressource est déclarée dans `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou correspond à un fichier sous `backend/crons` ou `backend/functions`, et n'est jamais écrite manuellement dans `rebase.resources.json`, qui est généré à partir de ces déclarations afin qu'un hôte puisse lire les besoins d'un projet sans avoir à le compiler. Chaque entrée consigne qui l'utilise (`table:events`, `column:posts.cover`, `function:report`).

Un backend possède également une base de données par défaut et une source de stockage par défaut que personne ne déclare. Les deux sont listées ici avec la mention `implicit`, et aucune n'est écrite dans `rebase.resources.json` — l'hôte les fournit, donc les consigner reviendrait à demander le provisionnement d'éléments que personne n'a sollicités.
Déclarer une ressource nommée, telle que `bucket("media")`, laisse la ressource par défaut à sa place, de sorte que les deux sont listées. Seule la déclaration explicite de la ressource par défaut, ou le marquage d'un bucket avec `default: true`, la remplace.

Pour voir ce que la plateforme détient pour un projet par rapport à ce que son code déclare, et pour supprimer une base de données provisionnée que le code ne mentionne plus, consultez [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — toutes les commandes pour Rebase Cloud : authentification, liaison de projet, déploiements, configuration, bases de données, ressources, calcul et plus encore — dispose de [sa propre page](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Génère un client typé pour les tables exportées par `backend/schema/index.ts` dans `generated/sdk/`, avec `TableName` et `tablesDictionary` ; `--from <link|url>` lit à la place le contrat d'un backend en cours d'exécution. `--register` type également les données côté serveur : il écrit les types et la déclaration `Register` dans `backend/generated/` et les mémorise dans `rebase.json` (`registerDatabase`).
Voir [Données typées côté serveur](/docs/backend/typed-server-data) et [Génération de schéma](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

La commande à exécuter lorsque quelque chose ne va pas et que vous n'en connaissez pas encore la cause. Elle fait un rapport sans jamais rien modifier, ce qui la rend sûre sur n'importe quelle base de données accessible.

**Sans base de données.** Ces vérifications s'exécutent en premier, car tout ce qui empêche totalement un projet de fonctionner se produit avant même qu'une table ne puisse être comparée :

| Vérification | Pourquoi |
| --- | --- |
| Version de Node | Comparée à la plage déclarée par la CLI. Une version trop ancienne n'est pas signalée comme "Node non supporté" — elle produit une erreur de syntaxe à l'intérieur d'une dépendance. |
| Gestionnaires de paquets | Deux lockfiles dans un même projet. `npm install` dans un workspace pnpm réorganise `node_modules` selon une structure que pnpm n'accepte pas, avec pour symptôme `Cannot find module` des heures plus tard. |
| Slugs en double | Deux tables déclarant le même slug. Le schéma refuse de compiler dans ce cas, et cette étape nomme les deux. |
| Cohérence du `.env` | Un `JWT_SECRET` de moins de 32 caractères (sur lequel la production refuse de démarrer), et `NODE_ENV=production` sans `CORS_ORIGINS` ni `FRONTEND_URL`. Les valeurs ne sont jamais affichées. |
| Écart de version `@rebasepro/*` | Le même paquet fixé à des versions différentes dans les fichiers `package.json` du projet. Deux copies brisent le fonctionnement de `instanceof` entre elles, ce qui échoue en tant que garde de type rejetant son propre type. |
| Chaînes de connexion | Un `=` non encodé dans un paramètre d'URL, que les outils propres à PostgreSQL refusent d'analyser — ainsi les sauvegardes et `psql` échouent alors que l'application continue de fonctionner. |
| Fonctions personnalisées | Ce dont chaque fonction a besoin de la part de son hôte, et lesquelles d'entre elles ne s'exécuteraient pas sur un runtime edge. |

**Sur la base de données** — celle du projet, résolue de la manière dont `rebase db url` la résout, donc sur un échafaudage tout juste créé, il s'agit de la base de données gérée, que `doctor` démarre :

| Vérification | Pourquoi |
| --- | --- |
| Tables → schéma généré | Vérifie si `schema.generated.ts` est obsolète. |
| Tables → base de données | Tables, colonnes, énumérations, clés étrangères et tables de jonction manquantes. |
| Extensions requises | Une colonne `col.vector()` nécessite pgvector, que Rebase n'installe que là où un projet l'a déclaré. |
| Empreinte du schéma (Schema stamp) | Vérifie si cette base de données a été provisionnée à partir de ces tables. Un hash, permettant d'indiquer que les deux divergent, sans jamais pouvoir préciser lequel est en avance. Une empreinte `v1:` issue d'un runtime antérieur à 0.31 est signalée une fois, avec la commande de ré-empreinte : `rebase db push`. |
| Tables → types SDK | Vérifie si le SDK typé généré est obsolète. |
| Politiques RLS | Vérifie si les politiques de la base de données correspondent au `rls` que vous avez déclaré, et si une politique nomme un rôle que ce serveur ne peut pas utiliser. |

Si la base de données est inaccessible, ses étapes sont signalées comme ignorées avec la raison correspondante et le reste s'exécute quand même — voir [Dépannage](/docs/troubleshooting/).

Quitte avec un code non nul lorsqu'une vérification trouve une erreur, ou lorsqu'une étape n'a pas pu s'exécuter parce que la base de données fournie refuse les connexions. Une étape ignorée parce qu'aucune base de données n'a pu être résolue n'est pas considérée comme un échec.

`rebase doctor --policies` exécute uniquement les vérifications RLS — aucun diff de schéma, aucun type SDK — et adopte une politique d'échec strict (fail closed), ce qui en fait la forme idéale à utiliser comme barrière CI face à une base de données déployée.

`rebase doctor --database` exécute uniquement la vérification préalable de la base de données : si le rôle sous lequel s'exécutent les requêtes authentifiées existe, s'il est restreint et si l'on peut basculer dessus, quels autres identifiants peuvent basculer vers lui, si chaque rôle a le droit de se connecter, et quelles tables, privilèges (grants) et politiques Rebase partagerait avec d'autres rôles. Chaque résultat indique le SQL à exécuter en tant qu'administrateur, le paramètre `rls` qui adapte Rebase à la base de données à la place, ou les deux. Elle lit le catalogue et ne modifie rien, et quitte avec le code 1 lorsqu'un élément est en échec. Cela fonctionne également sur un projet headless. Voir [Exécution sur une base de données existante ou partagée](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Vérifie si les tables sont prêtes pour la production, en une commande rapide conçue pour la CI et pour les hooks d'un agent IA. Hors ligne par défaut, elle ne modifie jamais rien.

| Étape | Ce qui la fait échouer |
| --- | --- |
| Définitions de tables (`schema`) | `backend/schema` ne se charge pas ou ne compile pas via le chargeur avec lequel le backend démarre : une relation vers une table que l'index n'exporte pas, `rls: "inherit"` sans `defaultRls`, une table sans clé primaire — un problème signalé par anomalie. Une table sans `rls` en fait partie. |
| Couverture RLS (`rls`) | Une table avec une colonne `user_id`, `owner_id`, `organization_id` ou `tenant_id` dont les règles — les siennes, ou le `defaultRls` dont elle hérite — permettent à un rôle de lire chaque ligne sans tenir compte de cette colonne. Un avertissement. `rls-policy-recursion` : une règle qui lit sa propre table dans une sous-requête, ou deux tables dont les règles se lisent mutuellement, ce que Postgres refuse de développer, provoquant l'échec de chaque instruction protégée avec `42P17 infinite recursion detected in policy` ; le constat indique la table lue et la correction, qui consiste à déplacer la lecture dans une fonction `SECURITY DEFINER`. Une erreur, ou un avertissement lorsque la boucle n'est pas certaine. |
| Fraîcheur des migrations (`migrations`) | Une table ou colonne déclarée par les tables qu'aucun fichier dans `backend/drizzle/migrations` ne crée, ou une qu'elles ont supprimée mais qu'une migration continue de créer. Ignoré pour un projet sans migrations pour le moment. |
| Personnalisations CMS (`cms`) | Un `customizeTable(...)` dans `frontend/src/cms` (ou le `src/cms` d'une application statique dans `rebase.json`) qui ne correspond pas aux tables, lu de manière statique — les modules ne sont pas exécutés. `cms-unknown-table` : le slug ne correspond à aucune table, donc le panneau l'ignore (le slug le plus proche est suggéré). `cms-unknown-field` : une clé sous `fields` n'est ni une colonne ni une relation (le nom SQL d'une colonne reçoit comme réponse sa clé). `cms-hidden-required` : un champ masqué du formulaire (`hiddenInForm`, `readOnly`, `disabled`) dont la colonne est `NOT NULL` sans valeur par défaut et sans élément rempli par le serveur, de sorte que créer un enregistrement depuis le panneau échoue toujours ; un avertissement lorsqu'un hook `beforeSave` ou une transformation peut le remplir, silencieux si `filledByServer` est présent. `cms-duplicate-customization` : un même slug personnalisé deux fois. `cms-not-static` (avertissement) : un appel dont le slug, les options ou les `fields` ne sont pas des valeurs littérales ou une `const` du même fichier, donc rien n'a pu y être vérifié. `cms-ui-config-not-mounted` (avertissement) : `frontend/src/cms/ui-config.json` existe mais n'est pas fourni à `<RebaseCMS>` sous la forme `uiConfig`. `cms-backend-guard-missing` : la configuration Vite du frontend n'utilise pas `rebaseBackendGuard()`, donc `rebase build` la refuserait. Un projet headless ne possède pas de `frontend/src/cms` et saute cette étape. |
| Audit RLS en direct (`live`) | Avec `--live` : le catalogue [`rls-check`](/docs/rls-check) exécuté contre la base de données du projet, et la vérification que chaque migration a été appliquée. La base de données est résolue comme le font les commandes `db` — `--database-url`, `DATABASE_URL`, `--docker`, ou sinon la base de développement gérée. Une base de données non configurée ou qui ne répond pas constitue une erreur, pas une étape ignorée : l'audit a été explicitement demandé. Une politique de lecture `USING (true)` compilée à partir d'une règle `access: "public"` est un avertissement tant que l'API exige un jeton (`AUTH_REQUIRE`, activé par défaut) — chaque utilisateur connecté pouvant lire chaque ligne — et une erreur avec `AUTH_REQUIRE=false`, où les lignes sont anonymes. |

`--json` affiche un objet unique, `{ ok, schemaDir, steps, findings, summary }` :
chaque étape est de la forme `{ id, title, status, detail? }` (`status` valant `passed`, `failed`, `warnings` ou `skipped`), et chaque constat contient `step`, `check` (un type stable en kebab-case), `severity`, `message`, et le cas échéant `fix`, `table`, `file`, `line` ainsi que le `path` pointé dans la table (`posts.rls[0]`) — pour qu'un agent puisse réparer ce qu'il a cassé. `summary` comptabilise `errors` et `warnings`. `--quiet` n'affiche rien lorsque tout passe avec succès. Quitte avec un code non nul en cas d'erreur ; les avertissements ne bloquent pas l'exécution.

Un projet échafaudé l'exécute pour Claude Code après chaque modification sous `backend/schema/` : voir [`rebase skills install`](#rebase-skills-install).

### Commandes pour une application en cours d'exécution

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` et `rebase storage ls|cp|rm|url|stat` agissent sur une application en cours d'exécution via son API : le `rebase dev` local, un serveur spécifié avec `--url`, ou un projet Rebase Cloud avec `--project`. Voir [Une application en cours d'exécution](/docs/cli/project/).

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

`--scopes` indique les autorisations accordées à la clé, séparées par des virgules ou répétées ; `--full-access` lui donne toutes les portées détenues par la clé de service à l'exception de `keys:*`. `--roles` ajoute des rôles RLS en plus de `service`, `--expires-in` accepte un nombre de jours et `--expires-at` une date ISO.
`rebase api-keys scopes` liste toutes les portées reconnues par le backend. Une clé n'est affichée qu'une seule fois.
Les portées de la clé et la sécurité au niveau des lignes (RLS) de l'identité sous laquelle elle agit s'appliquent toutes deux.
Voir [Clés d'API](/docs/backend/api-keys/).

### `rebase storage`

Maintenance globale des fichiers stockés, via le backend en cours d'exécution avec le `REBASE_SERVICE_KEY` issu du fichier `.env` :

```bash
rebase storage orphans                         # fichiers qu'aucune ligne ne mentionne
rebase storage orphans --source media --delete # et les supprimer, après confirmation
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lit chaque ligne de chaque table telle que stockée (lignes supprimées logiciellement incluses, en passant outre tous les hooks `beforeQuery` et `afterRead`) ainsi que chaque entrée d'[historique](/docs/backend/history/), dans la mesure où un rétablissement restaure ce qu'il contient.
La commande liste les fichiers d'une source (`--source`, la source par défaut si non précisée) qu'aucune chaîne de caractères ne référence : une clé, une URL, une référence `rebase-storage:` dans un texte. Les fichiers plus récents que `--older-than` heures (24 par défaut) sont exclus, car le panneau d'administration téléverse un fichier avant que la ligne qui le référence ne soit enregistrée.
L'analyse s'exécute sur le backend en arrière-plan, de sorte qu'un projet trop volumineux pour être analysé au cours d'une seule requête (derrière un ingress susceptible d'expirer) puisse quand même terminer le traitement. La CLI la lance, puis affiche sa progression (fichiers listés, lignes lues, tables traitées, et celles qui n'ont pas pu être lues) jusqu'à son achèvement. Avec la [file d'attente de tâches](/docs/backend/jobs/) activée, l'analyse est un job `storage.orphans` que les workers exécutent. Sans elle, l'analyse s'exécute au sein du processus serveur sollicité, et la CLI le signale : redémarrer ce processus interrompt l'analyse. Une analyse correspond à une tentative de tâche, limitée par `jobs.timeoutMs` (15 minutes par défaut). Augmentez cette valeur, ou définissez-la à 0, pour une source nécessitant plus de temps. `--json` affiche le même rapport qu'auparavant, accompagné de son `scanId`.

`--delete` demande confirmation avant de supprimer (`--yes` passe la question, et s'avère requis sans terminal). La suppression ne s'effectue qu'à partir de l'analyse qui vient d'être affichée, et uniquement dans les 15 minutes suivant l'achèvement de cette analyse. Rien n'est supprimé tant qu'une table ne peut pas être lue : une table comportant des hooks de lecture sur une base de données dont le pilote ne peut pas les outrepasser est considérée comme non lue. Avant de supprimer quoi que ce soit, le serveur relit chaque ligne et entrée d'historique en regard des fichiers listés. Puis il vérifie à nouveau chaque fichier juste avant de le supprimer. Un fichier désormais référencé par une ligne, qui a été de nouveau téléversé depuis l'analyse, ou qui a disparu, est conservé, et la CLI le liste comme conservé. Les fichiers référencés uniquement par des tables que Rebase ne gère pas semblent inutilisés : vérifiez avant de supprimer. Face à un backend en version 0.25.1 ou antérieure, la CLI effectue l'analyse à l'ancienne, au sein d'une unique requête.

`move` copie les fichiers situés sous `--prefix` vers une autre source sous les mêmes clés, une page à la fois. Un fichier que la cible détient déjà à l'identique en taille est ignoré, de sorte qu'un déplacement interrompu reprend en relançant simplement la commande ; `--delete-source` supprime chaque fichier de la source dès lors que la cible le détient, et est refusé lorsque les deux sources stockent dans le même bucket ou répertoire. Une fois le déplacement terminé, la CLI parcourt à nouveau la source lors d'un nouveau balayage et liste chaque fichier que l'opération n'a pas déplacé : avec `--delete-source`, tout fichier toujours présent dans la source ; sans cette option, tout fichier dont la cible ne détient pas une copie de taille identique. Elle quitte avec le code 1 s'il en existe, et relancer le même déplacement le prendra en charge. `--json` les affiche sous `notMoved`. La lecture du rapport d'une analyse nécessite `database:read`. Lancer une analyse, supprimer et déplacer nécessitent `database:write`, que détient la clé de service.

### `rebase skills install`

Installer les skills de référence Rebase pour vos assistants de code IA — chacun des `--agent` mentionnés ci-dessus :

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consultez [Agent Skills](/docs/ai/skills) pour la liste complète et l'emplacement où les fichiers sont écrits.

`--hooks` installe le garde-fou Claude Code que `rebase init` fournit avec chaque projet : `.claude/hooks/post-edit-collection.sh`, enregistré en tant que hook `PostToolUse` dans `.claude/settings.json`, qui exécute `rebase verify --quiet` après chaque modification sous `backend/schema/` ou `frontend/src/cms/` et renvoie tout problème à l'agent. Les paramètres et hooks existants sont conservés. `rebase skills --hooks` installe uniquement le hook.

### `rebase telemetry`

Partage anonyme de données d'utilisation, désactivé jusqu'à ce que vous donniez votre accord. Une exécution interactive de `rebase init` pose la question à la fin, et l'invite est réglée sur « non » par défaut, de sorte que rien n'est partagé à moins que vous ne répondiez « oui ». La réponse est conservée par machine (`~/.rebase/telemetry.json`) : après un oui, `init` ne redemande plus jamais, et après un non, le prochain `init` posera à nouveau la question. Chaque copie locale du projet reçoit un identifiant de projet aléatoire, conservé dans son fichier ignoré par git `.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` affiche le réglage actuel, `show` affiche exactement ce qui serait envoyé — que le partage soit activé ou non, afin que vous puissiez examiner les données avant de décider — et les deux autres commandes modifient ce paramètre. Si vous n'avez jamais exécuté `init`, rien n'a jamais été collecté.

## Prochaines étapes

- **[Génération de schéma](/docs/cli/schema/#production-workflow)** — Le flux de travail de migration, de la modification d'une table à la production
- **[Le schéma en tant que code](/docs/architecture/schema-as-code)** — Comment fonctionne la génération de schéma
- **[Démarrage rapide](/docs/getting-started/quickstart)** — Lancez-vous
