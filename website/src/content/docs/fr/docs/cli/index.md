---
sourceHash: a4601e097ae5a5f6
title: Référence de la CLI
sidebar_label: CLI
description: Commandes de la CLI Rebase pour l'initialisation de projet, la génération de schémas, les migrations de base de données et la génération de SDK.
---

## Aperçu

La CLI Rebase (`rebase`) gère votre projet de l'échafaudage (scaffolding) au déploiement.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Ou exécutez n'importe quelle commande sans l'installer : `pnpm dlx @rebasepro/cli <command>`.

## Sortie lisible par une machine

`--json` est le modificateur, et en dehors de la famille `cloud`, c'est le seul : `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` et `rebase verify` écrivent alors une valeur JSON unique sur stdout — le résultat, ou une enveloppe `{"error": {"message", "code", "hint", "issues"}}` avec un code de sortie différent de zéro — à **chaque** sortie de la commande, de sorte qu'un appelant puisse analyser stdout sans condition. Sans cette option, les commandes écrivent du texte intelligible pour un humain et les erreurs sont envoyées vers stderr. `rebase cloud` utilise la même enveloppe et constitue la seule exception à ce modificateur : elle active également le format JSON d'elle-même lorsque stdout n'est pas un TTY, ou lorsque `REBASE_JSON=1` est défini. Ainsi, `rebase cloud status | cat` renvoie du JSON tandis que `rebase status | cat` n'en renvoie pas — dans un script, passez explicitement `--json` plutôt que de vous fier à l'une ou l'autre règle.

## Commandes

### `rebase init`

Initialiser un nouveau projet Rebase :

```bash
rebase init [directory]
```

Met en place un dossier `backend/` (les tables dans `backend/schema/`) et un dossier `frontend/` (le panneau d'administration, avec ses personnalisations de tables dans `frontend/src/cms/`) ; `--headless` génère l'échafaudage du `backend/` seul, sans `backend/schema/`. La [Structure du projet](/docs/getting-started/project-structure/) montre les deux arborescences.

| Option | Ce qu'elle fait |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Par défaut `blog` |
| `--headless` | Backend uniquement — pas de panneau d'administration et pas de `backend/schema/` : le serveur expose directement les propres tables de la base de données. `--template` n'a aucun effet, car il n'y a pas de tables à initialiser (seed) |
| `-y, --yes` | Ne jamais afficher d'invites. **Requis lorsqu'aucun terminal n'est disponible pour répondre**, comme dans un environnement de CI. Ignore l'initialisation de git et l'installation des dépendances — les valeurs interactives par défaut répondant oui aux deux, passez `--git` / `--install` si vous souhaitez les activer |
| `-i, --install` | Installer les dépendances après l'échafaudage. Sans cette option, init pose la question (oui par défaut) ; avec `--yes`, rien n'est installé |
| `--no-install` | N'installer aucune dépendance et ne pas poser la question |
| `-g, --git` | Initialiser un dépôt et créer le premier commit. Sans cette option, init pose la question (oui par défaut) ; avec `--yes`, aucun dépôt n'est créé |
| `--database-url <url>` | Utiliser une base de données existante au lieu de la base gérée. Il doit s'agir d'une URL `postgres://` ou `postgresql://` : toute autre valeur est refusée avant qu'un fichier ne soit écrit, et l'invite interactive repose la question |
| `--introspect` | Générer `backend/schema` à partir de cette base de données. Implique `--template blank` et requiert `--install` |
| `--project <slug>` | Lier l'échafaudage à un projet Rebase Cloud |
| `--setup-key <key>` | La clé à usage unique authentifiant cette liaison |
| `-a, --agent <name>` | Configurer les agents de codage IA : les [skills](/docs/ai/skills) et le [serveur MCP](/docs/ai/mcp). Répétable ou séparé par des virgules — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sans cette option, `init` demande et pré-coche les agents installés sur la machine ; avec `--yes`, aucun n'est configuré |

### `rebase dev`

Démarrer le serveur de développement :

```bash
rebase dev
```

Démarre à la fois le frontend et le backend avec rechargement à chaud (hot reload), et régénère le schéma Drizzle ainsi que les types du SDK (`generated/sdk/`) au démarrage et à chaque sauvegarde sous `backend/schema/`.

Les deux ports sont dérivés du chemin du projet afin que plusieurs projets Rebase puissent s'exécuter
côte à côte. Utilisez les URL affichées par `rebase dev`. Fixez-en un avec `rebase dev --port 3001`.

Une application statique définie dans `rebase.json` sans étape de build (pas de `build`, et `output` correspond à
sa racine `root`, comme un simple site HTML) est servie par le backend depuis ce
répertoire, à son `path`, tout comme `rebase start` la sert depuis le bundle, et
`FRONTEND_URL` est configuré vers celle-ci (sur le port du backend) afin que les liens envoyés par e-mail y mènent.
Une application avec une étape de build tourne sous Vite sur son propre port, et `FRONTEND_URL` est celui de Vite.

La modification de `.env`
redémarre le backend, qui relit le fichier, tout comme le panneau d'administration. Ce que
`rebase dev` définit lui-même est conservé jusqu'à ce que vous le redémarriez : `PORT`, et
`DATABASE_URL` lorsqu'il est sur la base de données gérée ou sur Docker.

Avec
`--database-url`, `rebase dev` vérifie d'abord que quelque chose répond à cet hôte
et à ce port. Si rien ne répond, il l'indique en mentionnant l'option et quitte avec le code `1` sans
rien démarrer ; il laisse également intacts les noms de variables `.env` de la base de données, sans jamais démarrer
son conteneur compose.

### `rebase build`

Compiler le projet sous la forme d'un bundle déployable dans `dist-bundle/` :

```bash
rebase build
```

Le bundle est l'artefact que vous déployez — l'image du runtime le charge, il n'y a donc pas
d'image applicative à construire vous-même. Options utiles :

| Option | Effet |
|------|--------|
| `--output <dir>` (ou `--out`) | Écrire le bundle ailleurs que dans `dist-bundle/` (une application à la fois) |
| `--vendor` | Toujours installer et intégrer (vendor) les dépendances du bundle |
| `--no-vendor` | Ne jamais intégrer en local (vendor) ; le pod les installe à chaque démarrage |
| `--skip-type-check` | Ignorer la vérification de types (plus rapide, moins sûr) |
| `--no-static` | Ne pas intégrer le frontend dans le bundle du backend (chaque application statique conserve son propre bundle) |
| `--skip-static-build` | Intégrer le frontend tel qu'il a déjà été compilé, sans exécuter sa commande de build |

Un frontend — toute application statique de `rebase.json` possédant une configuration Vite — dont la configuration n'utilise pas `rebaseBackendGuard()` (issu de
`@rebasepro/app/vitePlugin`) est refusé : c'est ce qui empêche le code serveur d'atterrir dans le
bundle du navigateur, et cela empêche Vite d'intégrer un fichier backend sous la forme d'une URL `data:`
(il fait échouer le build, en se nommant, lorsqu'un autre plugin remplace son
`build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` est transféré dans le bundle sous
`entry.uiConfig`, la présentation de l'espace de travail qu'un backend déployé dessert.

Les dépendances sont intégrées (vendored) par défaut afin qu'une nouvelle instance ne subisse pas un délai d'installation de 35 à 55
secondes. Une arborescence dépassant 2 Go sur le disque est ignorée à la place, car
la limite d'envoi est de 1 Go compressé.

Chaque application statique incluse dans le
bundle reçoit une copie compressée en brotli (`.br`) et en gzip (`.gz`) à côté de chaque
ressource hachée par son contenu de 1 Ko ou plus — les fichiers qu'un navigateur met en cache pendant un an.
Le runtime envoie le format accepté par le navigateur, de sorte que ces fichiers ne nécessitent aucun
travail de compression par requête, y compris lors de la première visite suivant un déploiement, et
les navigateurs prenant en charge brotli en bénéficient (environ 11 % plus compact que gzip pour le JavaScript
de l'interface d'administration). La sortie de compilation propre à votre frontend reste inchangée ; seule la copie
dans le bundle est modifiée. Sur l'application d'exemple, cela ajoute moins d'une seconde au build
et environ 2,4 Mo au bundle.

### `rebase upgrade`

Mettre à niveau chaque paquet `@rebasepro/*` fixé par le projet vers une même version, puis
installer avec le gestionnaire de paquets indiqué par son fichier lockfile. `rebase upgrade` sélectionne la
dernière version (`latest`) ; `--to 0.21.0` une version exacte, sans recherche dans le registre ; `--to canary` un
dist-tag. Chaque version fixée dans `dependencies`, `devDependencies` et
`optionalDependencies`, dans chaque fichier `package.json` du projet, conserve son `^`
ou `~`, et rien d'autre dans le fichier n'est modifié. `peerDependencies` ainsi que
les spécifications `workspace:`, `link:`, `file:`, git et par tag sont listées et laissées intactes.
Les surcharges (overrides) dans `pnpm-workspace.yaml` et `package.json` sont également mises à jour, mais une surcharge `link:` ou
`file:` prévaut sur toute version fixée : elle est signalée, et
`--drop-local-overrides` la supprime. `--dry-run` n'écrit rien, `--no-install`
ignore l'installation et `--json` affiche un document unique.

Un projet utilisant une
version préliminaire (prerelease), telle qu'une canary, reste sur son canal à moins que `latest` ne soit plus récent. Un
dist-tag qui ferait rétrograder une version fixée est refusé (`downgrade_refused` sous
`--json`), sauf si vous passez `--allow-downgrade` ; une version exacte passée via `--to` est appliquée et
marquée comme une rétrogradation. Une exécution `--dry-run` d'une mise à niveau que l'exécution réelle refuserait
affiche ce qui aurait changé et quitte avec le code 0, et sous `--json`, son document contient le
refus sous la clé `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Exécuter le bundle compilé de la même manière qu'un déploiement l'exécute :

```bash
rebase start
```

Lit `PORT` et le reste du fichier `.env`, contrairement à `rebase dev`, selon le `NODE_ENV`
défini. Un fichier `.env` issu de l'échafaudage indique `development`, ainsi le premier compte enregistré
devient toujours l'administrateur, et `rebase start` le signale au début ; définissez `NODE_ENV=production`
pour un serveur de production. `rebase start --bundle ./dist-bundle` exécute un bundle situé ailleurs.

`rebase start` ne démarre aucune base de données, et le `.env` de l'échafaudage n'a pas de
`DATABASE_URL`, donc une exécution locale sur la base de données utilisée par `rebase dev` s'effectue avec
`DATABASE_URL="$(rebase db url)" rebase start`.
En l'absence de variable, cette ligne est affichée avant le démarrage.

### `rebase apps list`

Afficher les applications déclarées par ce dépôt :

```bash
rebase apps list
```

Un dépôt peut déclarer plusieurs applications déployables — un backend et un site
marketing, par exemple. C'est ainsi que vous voyez sur quoi `rebase build` et le déploiement vont agir.

### `rebase eject`

Prendre le contrôle total du processus serveur et de son image :

```bash
rebase eject
```

Écrit le point d'entrée du backend et un `Dockerfile` dans le projet et bascule son
backend, de sorte que le dépôt compile sa propre image au lieu d'exécuter le
runtime publié. Dès lors, **les mises à niveau du runtime de la plateforme ne s'appliquent plus**,
et la configuration de CORS, l'authentification, le stockage et l'arrêt du serveur vous incombent.

Prévisualisez les changements avec `rebase eject --dry-run`, qui liste ce qui changerait sans
rien modifier. `--force` remplace un fichier `backend/src/index.ts` ou
`env.ts` existant, en conservant le fichier actuel sous le nom `<name>.bak`.

Le serveur éjecté
conserve les téléversements locaux dans le dossier `uploads/` du projet, qu'il soit exécuté depuis les sources ou compilé, tout comme
`rebase dev`. Il s'exécute dans `backend/`, donc un chemin relatif `STORAGE_PATH` y est
lu depuis `backend/`.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Toutes les commandes lisant le schéma acceptent `--schema-dir <dir>` pour les projets
qui le conservent ailleurs ; `--collections` a été supprimé. `rebase dev` maintient le
fichier à jour, `stale` sert donc de vérification pour un build ou un pipeline de CI. Voir
[Génération de schéma](/docs/cli/schema/).

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

Chacune est détaillée dans les [Commandes de base de données](/docs/cli/database/), avec l'ordre de priorité utilisé par une
commande pour choisir sa base de données ; `push`, `generate` et `migrate` sont traitées en
profondeur dans [Génération de schéma](/docs/cli/schema/).

### `rebase console`

Un REPL Node avec les données du projet accessibles, ou un extrait de code exécuté avec `-e` :

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) et `tables` (les
tables du projet, chargées depuis `backend/schema`) sont dans la portée, et l'`await` de premier niveau
fonctionne. La base de données est résolue de la même manière que `rebase db push`
la résout, et son ouverture n'y modifie rien. Avec `-e`, le résultat attendu
est affiché au format JSON sur stdout et une exception génère un code de sortie `1`. Options : `--eval`/`-e`,
`--schema-dir`, `--database-url`, `--docker`. Voir
[Scripts et Console](/docs/backend/scripts/).

### `rebase migrate`

Migrations unidirectionnelles depuis une structure que cette version ne prend plus en charge :
`rebase migrate collections-to-tables` (`config/collections` → `backend/schema`
et `frontend/src/cms`) et `rebase migrate sdk-calls` (`data.collection("x")`
→ `data.table("x")` dans votre propre code). Leurs options, ce qu'elles écrivent et la
section « À vérifier avant de déployer » sont décrits dans
[Génération de schéma](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` ne prend aucun nom : elle déduit chaque application à partir du projet et écrit
l'intégralité du fichier `rebase.json`, et refuse de remplacer un fichier existant à moins de passer
`--force`.

Un argument de nom est
refusé. `--force` conserve les éléments que l'inférence ne peut pas deviner à partir du fichier remplacé :
le nom de chaque application, son `path` et sa route `cms`. Tout le reste est déduit
à nouveau, et une application déclarée qui n'est plus trouvée est indiquée comme supprimée ; ainsi, sur un projet
nouvellement échafaudé, la commande réécrit le `rebase.json` d'origine. La commande de build de l'application
statique utilise le gestionnaire de paquets du projet.

Pour une
copie locale non liée à un projet Cloud, `apps config` indique qu'elle n'est pas liée,
que `rebase dev` soit en cours d'exécution ou non, et fournit l'URL du backend telle que
`rebase dev` la sert.

### `rebase status`

Tout ce que ce projet déclare, et si l'environnement y est actuellement relié :

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

Trois fichiers déterminent ce qu'un backend peut atteindre, et cette commande affiche les trois ensemble :
`rebase.json` indique où se trouve votre code et qui exécute le serveur,
`backend/resources.ts` indique les besoins du projet, et l'environnement précise comment
accéder à chaque élément. Tout le reste — `rebase.resources.json`, le manifeste
du bundle — est généré à partir de ce dernier pour les outils qui ne peuvent pas exécuter votre
code, et vous ne l'écrivez jamais manuellement.

Un symbole `○` indique l'état qu'il est utile de connaître avant un déploiement plutôt qu'après :
déclaré, mais non configuré. Un symbole `✗` signifie que l'environnement configure quelque chose de façon *incorrecte*,
ce qui empêche le démarrage au lieu d'une dégradation gracieuse.

Un fichier
`rebase.resources.json` qui ne correspond plus aux déclarations se voit attribuer une ligne `○`.
Un fichier qui n'a pas encore été généré n'en reçoit pas : `rebase build` l'écrit à chaque
compilation, donc un projet qui n'a jamais été compilé, tel qu'un projet venant d'être échafaudé, n'a
rien à corriger.

### `rebase resources`

Ce que ce projet déclare comme prérequis — les bases de données, buckets, topics et
files d'attente (queues) demandés par `backend/resources.ts`, ainsi que les crons et fonctions définis par ses fichiers :

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` est l'option utilisée par un job de CI pour échouer si un fichier
`rebase.resources.json` ne correspond plus à `backend/resources.ts`.
`--json` peut être combiné
avec cette option : en cas de divergence, `rebase resources --check --json` quitte avec le code 1 et une enveloppe
d'erreur (`resource_graph_missing` ou `resource_graph_stale`), et en cas de succès
le graphe contient `check.status`. `--write --json` écrit le fichier et retourne
`written.changed`.

Une ressource est déclarée dans `backend/resources.ts` — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou correspond à un fichier
sous `backend/crons` ou `backend/functions`, et n'est jamais écrite à la main dans
`rebase.resources.json`, qui est généré à partir de ces déclarations afin qu'un hébergeur puisse
lire les prérequis d'un projet sans avoir à le compiler. Chaque entrée indique qui l'utilise
(`table:events`, `column:posts.cover`, `function:report`).

Un backend possède également une base de données par défaut et une source de stockage par défaut que personne
ne déclare. Les deux sont listées ici avec la mention `implicit`, et aucune n'est écrite dans
`rebase.resources.json` — l'hébergeur les fournit, donc les consigner reviendrait à demander
le provisionnement de quelque chose que personne n'a explicitement requis.
Déclarer une ressource
nommée, telle que `bucket("media")`, laisse la ressource par défaut en place, les deux sont donc
listées. Seule la déclaration explicite de la ressource par défaut, ou le marquage d'un bucket avec
`default: true`, la remplace.

Pour comparer ce que la plateforme détient pour un projet par rapport à ce que son code déclare,
et pour supprimer une base de données provisionnée que le code ne mentionne plus, consultez
[`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — regroupant toutes les commandes pour Rebase Cloud : authentification, liaison de projet, déploiements, configuration, bases de données, ressources, calcul et plus — dispose de [sa propre page](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Génère un client typé pour les tables exportées par `backend/schema/index.ts` dans
`generated/sdk/`, avec `TableName` et `tablesDictionary` ; `--from <link|url>`
lit à la place le contrat d'un backend en cours d'exécution. `--register` type également les
données côté serveur : l'option écrit les types et la déclaration `Register` dans
`backend/generated/` et les consigne dans `rebase.json` (`registerDatabase`).
Voir [Données typées côté serveur](/docs/backend/typed-server-data) et
[Génération de schéma](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

La commande à exécuter quand un dysfonctionnement survient sans que vous en connaissiez encore la cause. Elle
établit un diagnostic sans jamais rien modifier, elle peut donc être exécutée sans danger sur n'importe quelle base de données
accessible.

**Sans base de données.** Ces vérifications s'exécutent en premier, car tout ce qui empêche un projet
de fonctionner se produit avant même qu'une table ne puisse être comparée :

| Vérification | Pourquoi |
| --- | --- |
| Version de Node | Comparée à la plage déclarée par la CLI. Une version trop ancienne ne produit pas un message « Node non supporté » — elle provoque une erreur de syntaxe au sein d'une dépendance. |
| Gestionnaires de paquets | Deux lockfiles dans un même projet. Un `npm install` dans un workspace pnpm réorganise `node_modules` selon une structure incompatible avec pnpm, causant des erreurs `Cannot find module` plusieurs heures après. |
| Slugs en double | Deux tables déclarant le même slug. Le schéma refuse de compiler dans ce cas, et cette étape signale les deux. |
| Validité de `.env` | Un `JWT_SECRET` inférieur à 32 caractères (avec lequel la production refuse de démarrer), et `NODE_ENV=production` sans `CORS_ORIGINS` ni `FRONTEND_URL`. Les valeurs ne sont jamais affichées. |
| Écart de version `@rebasepro/*` | Le même paquet fixé à des versions différentes dans les fichiers `package.json` du projet. Avoir deux copies casse l'opérateur `instanceof` entre elles, ce qui provoque l'échec d'un guard de type rejetant son propre type. |
| Chaînes de connexion | Un caractère `=` non encodé dans un paramètre d'URL, que les outils officiels de PostgreSQL refusent d'analyser — les sauvegardes et `psql` cessent alors de fonctionner tandis que l'application continue de tourner. |
| Fonctions personnalisées | Ce que chaque fonction requiert de son hébergeur, et lesquelles ne s'exécuteraient pas sur un runtime edge. |

**Sur la base de données** — celle du projet, résolue comme `rebase db url`
la résout, c'est-à-dire la base de données gérée sur un nouvel échafaudage, que `doctor`
démarre automatiquement :

| Vérification | Pourquoi |
| --- | --- |
| Tables → schéma généré | Indique si `schema.generated.ts` est obsolète. |
| Tables → base de données | Tables, colonnes, enums, clés étrangères et tables de jonction manquantes. |
| Extensions requises | Une colonne `col.vector()` nécessite pgvector, que Rebase n'installe que là où un projet l'a déclaré. |
| Empreinte (stamp) du schéma | Indique si cette base de données a bien été provisionnée à partir de ces tables. Il s'agit d'un hash, ce qui permet d'indiquer une divergence sans pouvoir déterminer laquelle est en avance. Une empreinte `v1:` issue d'un runtime antérieur à la version 0.31 est signalée une fois, avec la commande de mise à jour : `rebase db push`. |
| Tables → types du SDK | Indique si le SDK typé généré est obsolète. |
| Politiques RLS | Vérifie si les politiques de la base de données correspondent au `rls` que vous avez déclaré, et si une politique fait référence à un rôle que ce serveur ne peut pas utiliser. |

Si la base de données est inaccessible, ses étapes sont indiquées comme ignorées avec la
raison associée et le reste continue de s'exécuter — voir [Dépannage](/docs/troubleshooting/).

Quitte avec un code non nul lorsqu'une vérification trouve une erreur, ou lorsqu'une étape n'a pas pu s'exécuter
parce que la base de données fournie refuse les connexions. Une étape ignorée faute de
base de données pouvant être résolue n'est pas considérée comme un échec.

`rebase doctor --policies` exécute uniquement les vérifications RLS — sans diff de schéma ni
types SDK — et bloque en cas de problème (fail closed), ce qui en fait la commande idéale comme garde-fou CI face à
une base de données déployée.

`rebase doctor --database`
exécute uniquement la vérification préalable de la base de données : vérifie si le rôle utilisé par les requêtes authentifiées
existe, s'il est restreint et si l'on peut basculer vers lui, quels autres utilisateurs peuvent basculer
vers lui, si chaque rôle est autorisé à se connecter, et quelles tables, privilèges et politiques
Rebase partagerait avec d'autres rôles. Chaque résultat indique le SQL à exécuter en tant
qu'administrateur, le paramètre `rls` permettant d'adapter Rebase à la base de données, ou
les deux. L'analyse lit le catalogue et ne modifie rien, puis quitte avec le code 1 si une anomalie
bloquante est détectée. Cela fonctionne également sur un projet headless. Voir
[Exécution sur une base de données existante ou partagée](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Vérifie si les tables sont prêtes à être déployées, en une commande rapide pour la CI et pour
les hooks d'un agent IA. Fonctionne hors ligne par défaut et ne modifie jamais rien.

| Étape | Causes d'échec |
| --- | --- |
| Définitions des tables (`schema`) | `backend/schema` ne se charge pas ou ne compile pas via le chargeur utilisé par le backend : une relation vers une table non exportée par l'index, `rls: "inherit"` sans `defaultRls`, une table sans clé primaire — un signalement par problème. Une table sans `rls` en fait partie. |
| Couverture RLS (`rls`) | Une table avec une colonne `user_id`, `owner_id`, `organization_id` ou `tenant_id` dont les règles — les siennes ou le `defaultRls` hérité — permettent à un rôle de lire toutes les lignes sans tenir compte de cette colonne. Avertissement. `rls-policy-recursion` : une règle qui lit sa propre table dans une sous-requête, ou deux tables dont les règles se lisent mutuellement, ce que Postgres refuse de résoudre, provoquant l'échec de chaque instruction concernée avec `42P17 infinite recursion detected in policy` ; le problème signale la table lue et la correction, qui consiste à déplacer la lecture dans une fonction `SECURITY DEFINER`. Erreur, ou avertissement lorsque la boucle n'est pas certaine. |
| Fraîcheur des migrations (`migrations`) | Une table ou colonne déclarée dans les tables qu'aucun fichier de `backend/drizzle/migrations` ne crée, ou une ressource supprimée qu'une migration continue de créer. Ignoré pour un projet ne disposant pas encore de migrations. |
| Personnalisations CMS (`cms`) | Un appel `customizeTable(...)` dans `frontend/src/cms` (ou le `src/cms` d'une application statique dans `rebase.json`) qui ne correspond pas aux tables, lu de manière statique — les modules ne sont pas exécutés. `cms-unknown-table` : le slug ne correspond à aucune table, le panneau l'ignore (le slug le plus proche est suggéré). `cms-unknown-field` : une clé sous `fields` n'est ni une colonne ni une relation (le nom SQL d'une colonne est retourné avec sa clé). `cms-hidden-required` : un champ masqué du formulaire (`hiddenInForm`, `readOnly`, `disabled`) dont la colonne est `NOT NULL` sans valeur par défaut et que le serveur ne renseigne pas, ce qui fait systématiquement échouer la création d'un enregistrement depuis le panneau ; un avertissement est émis si un hook `beforeSave` ou une transformation peut le renseigner, et peut être masqué par `filledByServer`. `cms-duplicate-customization` : un même slug personnalisé deux fois. `cms-not-static` (avertissement) : un appel dont le slug, les options ou `fields` ne sont pas des littéraux ou une constante `const` dans le même fichier, empêchant toute vérification de son contenu. `cms-ui-config-not-mounted` (avertissement) : `frontend/src/cms/ui-config.json` existe mais n'est pas fourni à `<RebaseCMS>` sous la propriété `uiConfig`. `cms-backend-guard-missing` : la configuration Vite du frontend n'utilise pas `rebaseBackendGuard()`, ce qui conduirait `rebase build` à la rejeter. Un projet headless ne contient pas de dossier `frontend/src/cms` et ignore cette étape. |
| Audit RLS en direct (`live`) | Avec `--live` : le catalogue [`rls-check`](/docs/rls-check) appliqué à la base de données du projet, et la vérification que chaque migration a été exécutée. La base de données est résolue comme pour les commandes `db` — `--database-url`, `DATABASE_URL`, `--docker`, ou à défaut la base de données de développement gérée. Une base de données non configurée ou qui ne répond pas constitue une erreur et non une étape ignorée, l'audit ayant été expressément demandé. Une politique de lecture `USING (true)` compilée à partir d'une règle `access: "public"` génère un avertissement tant que l'API exige un jeton (`AUTH_REQUIRE`, activé par défaut) — chaque utilisateur connecté pouvant lire chaque ligne — et une erreur avec `AUTH_REQUIRE=false`, où les lignes sont alors accessibles aux utilisateurs anonymes. |

`--json` renvoie un objet unique, `{ ok, schemaDir, steps, findings, summary }` :
chaque étape est de la forme `{ id, title, status, detail? }` (`status` valant `passed`, `failed`,
`warnings` ou `skipped`), et chaque constatation fournit `step`, `check` (un identifiant stable
au format kebab-case), `severity`, `message`, et le cas échéant `fix`, `table`,
`file`, `line` et le chemin pointé dans la table (`posts.rls[0]`) — permettant à un agent de
corriger ce qu'il a rompu. `summary` comptabilise `errors` et `warnings`. `--quiet` n'affiche rien si tout réussit. Quitte avec un code non nul en cas
d'erreur ; les avertissements n'entraînent pas d'échec.

Un projet échafaudé l'exécute pour Claude Code après chaque modification sous `backend/schema/` : voir
[`rebase skills install`](#rebase-skills-install).

### Commandes pour une application en cours d'exécution

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` et `rebase storage ls|cp|rm|url|stat` interagissent avec une application en cours d'exécution via son API : le serveur local `rebase dev`, un serveur spécifié avec `--url`, ou un projet Rebase Cloud avec `--project`. Voir [Une application en cours d'exécution](/docs/cli/project/).

### `rebase auth`

Commandes de gestion de l'authentification :

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gérer les clés d'API de service du projet — les identifiants utilisés par un agent, un script ou
un autre service, par opposition à la session d'un utilisateur final :

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` indique ce que la clé est autorisée à faire, séparé par des virgules ou répété ; `--full-access`
lui attribue l'ensemble des portées (scopes) de la clé de service à l'exception de `keys:*`. `--roles` ajoute des rôles
RLS en plus de `service`, `--expires-in` accepte un nombre de jours et `--expires-at` une date ISO.
`rebase api-keys scopes` liste l'ensemble des portées connues du backend. Une clé n'est affichée qu'une seule fois.
Les portées de la clé et la sécurité au niveau des lignes (RLS) de l'identité sous laquelle elle agit s'appliquent toutes deux.
Voir [Clés d'API](/docs/backend/api-keys/).

### `rebase storage`

Maintenance globale
des fichiers stockés, via le backend en cours d'exécution avec
`REBASE_SERVICE_KEY` issu du fichier `.env` :

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` analyse chaque ligne de chaque table telle qu'elle est stockée (y compris
les lignes supprimées de manière réversible (soft-deleted), en contournant les hooks `beforeQuery` et `afterRead`) ainsi que chaque
entrée de l'[historique](/docs/backend/history/), dans la mesure où une restauration réintègre ce qu'elle contient.
La commande liste les fichiers d'une source (`--source`, la source par défaut si omise)
qu'aucune chaîne de caractères dans ces lignes ne mentionne : une clé, une URL ou une référence
`rebase-storage:` dans un texte. Les fichiers datant de moins de `--older-than` heures (24 par défaut) sont ignorés,
car le panneau d'administration téléverse un fichier avant que la ligne qui le référence ne soit enregistrée.
L'analyse s'exécute en arrière-plan sur le backend, de sorte qu'un projet trop volumineux pour être analysé
au cours d'une seule requête (derrière un ingress susceptible d'expirer) puisse tout de même se terminer. La
CLI déclenche l'opération, puis affiche sa progression (fichiers listés, lignes lues, tables
traitées, et celles n'ayant pu être lues) jusqu'à son terme. Lorsque la
[file d'attente de jobs](/docs/backend/jobs/) est active, l'analyse constitue un job `storage.orphans` que
les workers de jobs exécutent. Sans elle, l'analyse tourne au sein du processus serveur
interrogé, ce que signale la CLI : redémarrer ce processus interrompt l'analyse. Une analyse
représente une tentative de job, limitée par `jobs.timeoutMs` (15 minutes par défaut). Augmentez
cette valeur, ou fixez-la à 0, pour une source nécessitant davantage de temps. `--json` affiche le même
rapport qu'auparavant, en y ajoutant son identifiant `scanId`.

`--delete` demande confirmation avant la suppression (`--yes` ignore la question, et s'avère requis
en l'absence de terminal). La suppression ne s'applique qu'à partir de l'analyse qui vient d'être affichée, et uniquement dans les
15 minutes suivant l'achèvement de cette analyse. Rien n'est supprimé tant qu'une table
ne peut pas être lue : une table dotée de hooks de lecture sur une base de données dont le pilote
ne peut pas les outrepasser est considérée comme non lue. Avant de supprimer quoi que ce soit, le serveur
relit chaque ligne et chaque entrée d'historique en les comparant aux fichiers listés. Il vérifie
ensuite à nouveau chaque fichier juste avant de le supprimer. Un fichier désormais référencé par une ligne,
téléversé à nouveau depuis l'analyse, ou ayant disparu est conservé, et la CLI
le répertorie comme conservé. Les fichiers qui ne sont référencés que par des tables non gérées par Rebase sembleront
inutilisés : vérifiez avant de supprimer. Face à un backend en version 0.25.1 ou antérieure, la
CLI procède à l'analyse à l'ancienne, au sein d'une seule requête.

`move` copie les fichiers situés sous `--prefix` vers une autre source sous les mêmes clés,
une page à la fois. Un fichier déjà présent dans la cible à une taille identique est ignoré,
ce qui permet de reprendre un déplacement interrompu en relançant la commande ; `--delete-source` supprime chaque
fichier de la source une fois que la cible le contient, et se voit refusé si les deux
sources stockent leurs données dans le même bucket ou répertoire. Une fois le transfert terminé, la CLI
parcourt à nouveau la source lors d'un nouveau passage et liste chaque fichier qui n'a pas
été déplacé : avec `--delete-source`, tout fichier restant dans la source ; sans cette option, tout fichier
dont la cible ne possède pas de copie de taille identique. La commande quitte avec le code 1 si un tel fichier existe, et
relancer le même déplacement le prendra en charge. `--json` les affiche sous la clé `notMoved`. La lecture du rapport
d'une analyse nécessite `database:read`. Lancer une analyse, supprimer et déplacer nécessitent
`database:write`, privilège détenu par la clé de service.

### `rebase skills install`

Installer les skills Rebase de référence pour vos assistants de codage IA — chaque `--agent` mentionné ci-dessus :

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Voir [Agent Skills](/docs/ai/skills) pour la liste complète et l'emplacement où les fichiers sont écrits.

`--hooks` installe le garde-fou Claude Code fourni par `rebase init` avec chaque
projet : `.claude/hooks/post-edit-collection.sh`, configuré en tant que hook `PostToolUse`
dans `.claude/settings.json`, qui exécute `rebase verify --quiet` après chaque modification
sous `backend/schema/` ou `frontend/src/cms/` et transmet tout problème à l'agent. Les paramètres et hooks
existants sont conservés. `rebase skills --hooks` installe le hook seul.

### `rebase telemetry`

Partage anonyme de données d'utilisation, désactivé tant que vous n'avez pas donné votre accord. Une exécution interactive de `rebase init`
pose la question à la fin, le choix par défaut étant non : rien n'est donc partagé à moins que vous
ne répondiez par l'affirmative. La réponse est propre à chaque machine (`~/.rebase/telemetry.json`) : après un oui,
`init` ne pose plus jamais la question, et après un non, la prochaine exécution d'`init` la reposera. Chaque
copie locale reçoit un identifiant de projet aléatoire, conservé dans son fichier ignoré par git
`.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` affiche la configuration actuelle, `show` présente exactement ce qui serait envoyé —
que le partage soit activé ou non, afin que vous puissiez examiner le contenu avant de prendre une décision — et
les deux autres commandes permettent de le modifier. Si vous n'avez jamais exécuté `init`, aucune donnée n'a jamais été collectée.

## Prochaines étapes

- **[Génération de schéma](/docs/cli/schema/#production-workflow)** — Le flux de travail de migration, de la modification d'une table à la production
- **[Schema as Code](/docs/architecture/schema-as-code)** — Fonctionnement de la génération de schéma
- **[Démarrage rapide](/docs/getting-started/quickstart)** — Premiers pas
