---
sourceHash: d0327f13212ae542
title: Référence de la CLI
sidebar_label: CLI
description: Commandes de la CLI Rebase pour l'initialisation de projet, la génération de schéma, les migrations de base de données et la génération de SDK.
---

## Vue d'ensemble

La CLI Rebase (`rebase`) gère votre projet de l'échafaudage (scaffolding) jusqu'au déploiement.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Ou exécutez n'importe quelle commande sans l'installer : `pnpm dlx @rebasepro/cli <command>`.

## Sortie lisible par une machine

`--json` est l'option dédiée, et en dehors de la famille `cloud`, c'est la seule : `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` et `rebase verify` placent alors une valeur JSON unique sur stdout — le résultat, ou une enveloppe `{"error": {"message", "code", "hint", "issues"}}` avec un code de sortie non nul — à **chaque** sortie de la commande, afin qu'un appelant puisse analyser stdout de manière inconditionnelle. Sans cette option, elles écrivent du texte lisible par l'humain et les échecs vont vers stderr. `rebase cloud` utilise la même enveloppe et constitue la seule exception à cette option : elle active également le JSON d'elle-même lorsque stdout n'est pas un TTY, ou lorsque `REBASE_JSON=1` est défini. Ainsi, `rebase cloud status | cat` produit du JSON tandis que `rebase status | cat` n'en produit pas — dans un script, passez explicitement `--json` plutôt que de vous fier à l'une de ces règles.

## Commandes

### `rebase init`

Initialise un nouveau projet Rebase :

```bash
rebase init [directory]
```

Configure un dossier `backend/` (les tables dans `backend/schema/`) et un `frontend/` (le panneau d'administration, avec ses personnalisations de tables dans `frontend/src/cms/`) ; `--headless` échafaude le `backend/` seul, sans `backend/schema/`. La [Structure du projet](/docs/getting-started/project-structure/) montre les deux arborescences.

| Option | Description |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Par défaut `blog` |
| `--headless` | Backend uniquement — pas de panneau d'administration et pas de `backend/schema/` : le serveur sert directement les tables de la base de données. `--template` n'a aucun effet car il n'y a aucune table à initialiser |
| `-y, --yes` | Ne jamais demander de confirmation. **Requis dès lors qu'il n'y a pas de terminal pour répondre**, comme en CI. Ignore l'initialisation de git et l'installation des dépendances — les valeurs par défaut interactives répondent oui aux deux, passez donc `--git` / `--install` si vous les souhaitez |
| `-i, --install` | Installe les dépendances après l'échafaudage. Sans cette option, init demande (oui par défaut) ; avec `--yes`, rien n'est installé |
| `--no-install` | N'installe rien et ne pose pas de question |
| `-g, --git` | Initialise un dépôt et effectue le premier commit. Sans cette option, init demande (oui par défaut) ; avec `--yes`, aucun dépôt |
| `--database-url <url>` | Utilise une base de données existante au lieu de la base gérée. Il doit s'agir d'une URL `postgres://` ou `postgresql://` : toute autre valeur est refusée avant qu'un fichier ne soit écrit, et l'invite interactive vous redemande |
| `--introspect` | Génère `backend/schema` à partir de cette base de données. Implique `--template blank` et requiert `--install` |
| `--project <slug>` | Lie le projet échafaudé à un projet Rebase Cloud |
| `--setup-key <key>` | La clé à usage unique authentifiant cette liaison |
| `-a, --agent <name>` | Configure les agents de code IA : les [compétences (skills)](/docs/ai/skills) et le [serveur MCP](/docs/ai/mcp). Répétable ou séparé par des virgules — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sans cette option, `init` demande et pré-coche les agents installés sur la machine ; avec `--yes`, aucun |

### `rebase dev`

Démarre le serveur de développement :

```bash
rebase dev
```

Démarre à la fois le frontend et le backend avec rechargement à chaud (hot reloading), et régénère le schéma Drizzle ainsi que les types du SDK (`generated/sdk/`) au démarrage et à chaque sauvegarde sous `backend/schema/`.

Les deux ports sont dérivés du chemin du projet afin que plusieurs projets Rebase puissent s'exécuter côte à côte. Utilisez les URL affichées par `rebase dev`. Fixez-en un avec `rebase dev --port 3001`.

Une modification de `.env` redémarre le backend, qui relit le fichier, tout comme le panneau d'administration. Ce que `rebase dev` définit lui-même est conservé jusqu'à ce que vous le redémarriez : `PORT`, et `DATABASE_URL` lorsqu'il se trouve sur la base de données gérée ou sur Docker.

Avec `--database-url`, `rebase dev` vérifie d'abord que quelque chose répond à cet hôte et ce port. Si rien ne répond, il l'indique en mentionnant l'option, et quitte avec le code `1` sans rien démarrer ; il ne touche pas non plus aux noms de base de données dans `.env`, sans jamais démarrer son conteneur compose.

### `rebase build`

Compile le projet dans un bundle déployable dans `dist-bundle/` :

```bash
rebase build
```

Le bundle est l'artefact que vous déployez — l'image du runtime le charge, il n'y a donc pas d'image d'application à construire vous-même. Options utiles :

| Option | Effet |
|------|--------|
| `--output <dir>` (ou `--out`) | Écrit le bundle ailleurs que dans `dist-bundle/` (une application à la fois) |
| `--vendor` | Installe et embarque toujours les dépendances du bundle |
| `--no-vendor` | N'embarque jamais les dépendances (vendor) ; le pod les installe à chaque démarrage |
| `--skip-type-check` | Ignore la vérification des types (plus rapide, moins sûr) |
| `--no-static` | N'intègre pas le frontend dans le bundle du backend (chaque application statique a toujours son propre bundle) |
| `--skip-static-build` | Intègre le frontend tel qu'il a déjà été compilé, sans exécuter sa commande de build |

Un frontend — toute application statique de `rebase.json` avec une configuration Vite — dont la configuration n'utilise pas `rebaseBackendGuard()` (depuis `@rebasepro/app/vitePlugin`) est refusé : c'est ce qui empêche le code serveur d'entrer dans le bundle du navigateur, et cela empêche Vite d'intégrer un fichier backend en ligne sous forme d'URL `data:` (il fait échouer la compilation, en se nommant, lorsqu'un autre plugin remplace son `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` est transporté dans le bundle en tant que `entry.uiConfig`, la présentation de l'espace de travail servie par un backend déployé.

Les dépendances sont embarquées (vendored) par défaut afin qu'une nouvelle instance n'ait pas à subir une installation de 35 à 55 secondes. Une arborescence qui dépasse 2 Go sur le disque est abandonnée à la place, car la limite de téléversement est de 1 Go compressé.

Chaque application statique transportée par le bundle reçoit une copie brotli (`.br`) et gzip (`.gz`) à côté de chaque asset dont le nom contient un hash de contenu de 1 Ko ou plus — les fichiers qu'un navigateur met en cache pendant un an. Le runtime envoie celle que le navigateur accepte, de sorte que ces fichiers ne coûtent aucun travail de compression par requête, y compris lors de la première visite après un déploiement, et les navigateurs qui acceptent brotli en bénéficient (environ 11 % plus petit que gzip sur le JavaScript d'administration). La sortie de compilation propre à votre frontend est laissée telle quelle ; seule la copie dans le bundle change. Sur l'application d'exemple, cela ajoute moins d'une seconde au build et environ 2,4 Mo au bundle.

### `rebase upgrade`

Met à niveau chaque paquet `@rebasepro/*` épinglé par le projet vers une version unique, puis installe avec le gestionnaire de paquets indiqué par son fichier lockfile. `rebase upgrade` prend la version la plus récente (`latest`) ; `--to 0.21.0` une version exacte, sans recherche dans le registre ; `--to canary` un dist-tag. Chaque version épinglée dans `dependencies`, `devDependencies` et `optionalDependencies`, dans chaque `package.json` du projet, conserve son `^` ou `~`, et rien d'autre ne change dans le fichier. Les `peerDependencies` ainsi que les spécifications `workspace:`, `link:`, `file:`, git et tags sont listées et laissées intactes. Les surcharges (overrides) dans `pnpm-workspace.yaml` et `package.json` sont également mises à jour, mais une surcharge `link:` ou `file:` l'emporte sur toute version épinglée : elle est signalée, et `--drop-local-overrides` la supprime. `--dry-run` n'écrit rien, `--no-install` ignore l'installation, et `--json` affiche un document unique.

Un projet sur une version préliminaire (prerelease), telle qu'une canary, reste sur son canal à moins que `latest` ne soit plus récent. Un dist-tag qui ferait reculer une version est refusé (`downgrade_refused` avec `--json`), sauf si vous passez `--allow-downgrade` ; un `--to` exact est appliqué et signalé comme une rétrogradation (downgrade). Un `--dry-run` d'une mise à niveau que l'exécution réelle refuserait montre ce qui changerait et se termine avec le code 0, et avec `--json`, son document contient le refus sous le champ `wouldRefuse` (`{ code, message, hint }`).

#### Mettre à niveau un projet PostgreSQL vers Rebase 0.34

Exécutez la CLI de Rebase 0.34 à la racine du projet sous Linux, macOS ou Windows.
Elle remplace `@ariga/atlas` par `@stokaro/ptah-compat` dans le backend PostgreSQL.
Les fichiers de migration, `atlas.sum` et les révisions enregistrées sont
conservés.

```bash
pnpm dlx @rebasepro/cli@0.34.0 upgrade --to 0.34.0 # version-pin: ignore
```

### `rebase start`

Exécute le bundle compilé de la même manière qu'un déploiement l'exécute :

```bash
rebase start
```

Lit `PORT` et le reste de `.env`, contrairement à `rebase dev`, dans le `NODE_ENV` qu'ils définissent. Un fichier `.env` échafaudé indique `development`, donc le premier compte enregistré devient toujours l'administrateur, et `rebase start` l'indique en haut ; définissez `NODE_ENV=production` pour un serveur de production. `rebase start --bundle ./dist-bundle` exécute un bundle situé ailleurs.

`rebase start` ne démarre aucune base de données, et le `.env` de l'échafaudage n'a pas de `DATABASE_URL`, donc une exécution locale sur la base de données utilisée par `rebase dev` se fait via `DATABASE_URL="$(rebase db url)" rebase start`. Sans celle-ci, il affiche cette ligne avant de démarrer.

### `rebase apps list`

Affiche les applications déclarées par ce dépôt :

```bash
rebase apps list
```

Un dépôt peut déclarer plusieurs applications déployables — par exemple un backend et un site marketing. C'est ainsi que vous pouvez voir sur quoi agiront `rebase build` et le déploiement.

### `rebase eject`

Prenez le contrôle du processus serveur et de son image :

```bash
rebase eject
```

Écrit le point d'entrée du backend et un `Dockerfile` dans le projet et bascule son backend, de sorte que le dépôt construise sa propre image au lieu d'exécuter le runtime publié. Dès lors, **les mises à niveau du runtime de la plateforme ne l'affectent plus**, et la configuration des CORS, de l'authentification, du stockage et de l'arrêt vous incombe.

Prévisualisez l'opération avec `rebase eject --dry-run`, qui liste les modifications potentielles sans rien modifier. `--force` remplace un fichier `backend/src/index.ts` ou `env.ts` existant, en conservant le fichier actuel sous la forme `<name>.bak`.

Le serveur éjecté conserve les téléversements locaux dans le dossier `uploads/` du projet, qu'il soit exécuté depuis les sources ou compilé, tout comme `rebase dev`. Il s'exécute dans `backend/`, donc un `STORAGE_PATH` relatif y est lu depuis `backend/`.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # liste les différences avec les tables, termine avec le code 1 si des différences existent
rebase schema stale --fix    # régénère le fichier à la place
```

Chaque commande qui lit le schéma accepte `--schema-dir <dir>` pour un projet qui le conserve ailleurs ; `--collections` a été supprimé. `rebase dev` maintient le fichier à jour, `stale` est donc la vérification idéale pour un build ou en CI. Voir [Génération de schéma](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # applique les tables à la base de données (développement)
rebase db generate             # écrit un fichier de migration SQL
rebase db migrate              # applique les migrations en attente
rebase db url                  # affiche la chaîne de connexion utilisée par ce projet
rebase db pull --from <url>    # copie une autre base de données dans la base locale
rebase db backup               # pg_dump ; db backups list et db restore également disponibles
rebase db branch create <name> # une copie de travail ; switch, list et prune également disponibles
rebase db stop                 # arrête la base de données de développement gérée
rebase db reset                # la supprime et repart de zéro
rebase db request-role migrate --to <role> # déplace les requêtes vers un autre rôle Postgres
rebase db provision --print    # le SQL configurant le rôle de requête, pour un administrateur de base de données (DBA)
```

Chacune est détaillée dans [Commandes de base de données](/docs/cli/database/), avec l'ordre dans lequel une commande choisit sa base de données ; `push`, `generate` et `migrate` sont traitées en détail dans [Génération de schéma](/docs/cli/schema/).

### `rebase console`

Un REPL Node avec les données du projet ouvertes, ou un extrait de code exécuté avec `-e` :

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) et `tables` (les tables du projet, chargées depuis `backend/schema`) sont dans la portée (scope), et le `await` de premier niveau fonctionne. La base de données est résolue de la même manière que `rebase db push` la résout, et son ouverture n'y modifie rien. Avec `-e`, le résultat attendu est affiché au format JSON sur stdout et une exception levée termine le processus avec le code `1`. Options : `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Voir [Scripts et la Console](/docs/backend/scripts/).

### `rebase migrate`

Migrations unidirectionnelles depuis une structure que cette version ne lit plus : `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` et `frontend/src/cms`) et `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` dans votre propre code). Leurs options, ce qu'elles écrivent et la section « Review before deploying » se trouvent dans [Génération de schéma](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # les applications déclarées par ce projet
rebase apps init             # écrit un rebase.json déduit à partir de ce projet
rebase apps config <app>     # la configuration client pour une application
```

`apps init` ne prend aucun nom : elle déduit chaque application du projet et écrit l'intégralité de `rebase.json`, et refuse d'en remplacer un existant sauf si vous passez `--force`.

Un argument de nom est refusé. `--force` conserve ce que l'inférence ne peut pas deviner à partir du fichier qu'elle remplace : le nom de chaque application, son `path` et sa route `cms`. Tout le reste est déduit à nouveau, et une application déclarée qu'elle ne trouve plus est indiquée comme supprimée ; ainsi, sur un projet échafaudé, elle réécrit le `rebase.json` fourni à l'origine. La commande de build de l'application statique utilise le gestionnaire de paquets du projet.

Pour un clone non lié à un projet Cloud, `apps config` indique qu'il n'est pas lié, que `rebase dev` soit en cours d'exécution ou non, et fournit l'URL du backend telle que servie par `rebase dev`.

### `rebase status`

Tout ce que ce projet déclare, et si l'environnement s'y associe effectivement :

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

Trois fichiers déterminent ce qu'un backend peut atteindre, et cette commande affiche les trois ensemble : `rebase.json` indique où se trouve votre code et qui exécute le serveur, `backend/resources.ts` indique ce dont le projet a besoin, et l'environnement indique comment accéder à chaque élément. Tout le reste — `rebase.resources.json`, le manifeste du bundle — est généré à partir du deuxième fichier pour les lecteurs qui ne peuvent pas exécuter votre code, et vous ne l'écrivez jamais à la main.

Un `○` représente l'état qu'il vaut mieux connaître avant un déploiement plutôt qu'après : déclaré, non configuré. Un `✗` signifie que l'environnement définit quelque chose de *manière incorrecte*, ce qui refuse le démarrage plutôt que de fonctionner en mode dégradé.

Un fichier `rebase.resources.json` qui ne correspond plus aux déclarations reçoit une ligne `○`. Un fichier qui n'a pas encore été écrit n'en reçoit pas : `rebase build` l'écrit à chaque build, donc un projet qui n'a jamais été compilé, tel qu'un projet nouvellement échafaudé, n'a rien à corriger.

### `rebase resources`

Ce que ce projet déclare avoir besoin — les bases de données, buckets, topics et files d'attente (queues) demandés par `backend/resources.ts`, ainsi que les crons et fonctions définis par ses fichiers :

```bash
rebase resources            # les lister
rebase resources --write    # régénérer rebase.resources.json
rebase resources --check    # échouer si le graphe versionné est obsolète
rebase resources --json     # lisible par une machine
```

`rebase resources --check` est l'option utilisée par un job de CI pour échouer si `rebase.resources.json` ne correspond plus à `backend/resources.ts`. `--json` se combine avec elle : en cas de dérive (drift), `rebase resources --check --json` se termine avec le code 1 et une enveloppe d'erreur (`resource_graph_missing` ou `resource_graph_stale`), et en cas de succès, le graphe inclut `check.status`. `--write --json` écrit le fichier et renvoie `written.changed`.

Une ressource est déclarée dans `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou correspond à un fichier sous `backend/crons` ou `backend/functions`, et n'est jamais écrite à la main dans `rebase.resources.json`, qui est généré à partir de ces déclarations afin qu'un hôte puisse lire ce dont un projet a besoin sans avoir à le compiler. Chaque entrée enregistre qui l'utilise (`table:events`, `column:posts.cover`, `function:report`).

Un backend possède également une base de données par défaut et une source de stockage par défaut que personne ne déclare. Les deux sont listées ici, marquées comme `implicit`, et aucune n'est écrite dans `rebase.resources.json` — l'hôte les fournit, donc les enregistrer reviendrait à demander le provisionnement de quelque chose que personne n'a demandé. Déclarer une ressource nommée, telle que `bucket("media")`, laisse celle par défaut intacte, donc les deux sont listées. Seule la déclaration explicite de celle par défaut, ou le marquage d'un bucket avec `default: true`, la remplace.

Pour voir ce que la plateforme détient pour un projet par rapport à ce que son code déclare, et pour supprimer une base de données provisionnée que le code ne mentionne plus, voir [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — toutes les commandes pour Rebase Cloud : authentification, liaison de projet, déploiements, configuration, bases de données, ressources, calcul et plus encore — dispose de [sa propre page](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Écrit un client typé pour les tables exportées par `backend/schema/index.ts` dans `generated/sdk/`, avec `TableName` et `tablesDictionary` ; `--from <link|url>` lit à la place le contrat d'un backend en cours d'exécution. `--register` type également les données côté serveur : il écrit les types et la déclaration `Register` dans `backend/generated/` et les mémorise dans `rebase.json` (`registerDatabase`). Voir [Données typées côté serveur](/docs/backend/typed-server-data) et [Génération de schéma](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

La commande à exécuter lorsque quelque chose ne va pas et que vous ne savez pas encore quoi. Elle génère un rapport et ne modifie jamais rien, elle est donc sans danger pour toute base de données accessible.

**Sans base de données.** Ces vérifications s'exécutent en premier, car tout ce qui empêche un projet de fonctionner du tout se produit avant même qu'une table ne puisse être comparée :

| Vérification | Motif |
| --- | --- |
| Version de Node | Par rapport à la plage déclarée par la CLI. Une version trop ancienne n'est pas signalée comme « Node non pris en charge » — c'est une erreur de syntaxe au sein d'une dépendance. |
| Gestionnaires de paquets | Deux lockfiles dans un même projet. Un `npm install` dans un workspace pnpm réécrit `node_modules` dans une structure incompatible avec pnpm, et le symptôme est une erreur `Cannot find module` quelques heures plus tard. |
| Slugs en double | Deux tables déclarant le même slug. Le schéma refuse de compiler dans ce cas, et cette vérification nomme les deux. |
| Cohérence du `.env` | Un `JWT_SECRET` de moins de 32 caractères (sur lequel la production refuse de démarrer), et `NODE_ENV=production` sans `CORS_ORIGINS` ni `FRONTEND_URL`. Les valeurs ne sont jamais affichées. |
| Écart de versions `@rebasepro/*` | Le même paquet épinglé à des versions différentes dans les fichiers `package.json` du projet. Deux copies brisent l'`instanceof` entre elles, ce qui échoue en tant que garde de type rejetant son propre type. |
| Chaînes de connexion | Un `=` non encodé dans un paramètre d'URL, que les outils propres à PostgreSQL refusent d'analyser — ainsi les sauvegardes et `psql` échouent tandis que l'application continue de fonctionner. |
| Fonctions personnalisées | Ce dont chaque fonction a besoin de son hôte, et lesquelles d'entre elles ne s'exécuteraient pas sur un runtime edge. |

**Contre la base de données** — celle du projet, résolue de la même manière que `rebase db url` la résout, donc sur un projet fraîchement échafaudé il s'agit de la base de données gérée, que `doctor` démarre :

| Vérification | Motif |
| --- | --- |
| Tables → schéma généré | Si `schema.generated.ts` est obsolète. |
| Tables → base de données | Tables, colonnes, énumérations, clés étrangères et tables de jonction manquantes. |
| Extensions requises | Une colonne `col.vector()` nécessite pgvector, que Rebase n'installe que là où un projet l'a déclaré. |
| Empreinte de schéma (stamp) | Si cette base de données a été provisionnée à partir de ces tables. Il s'agit d'un hash, il peut donc indiquer que les deux ne concordent pas, mais jamais lequel est en avance. Une empreinte `v1:` provenant d'un runtime antérieur à 0.31 est signalée une fois, avec la commande de ré-estampillage : `rebase db push`. |
| Tables → types SDK | Si le SDK typé généré est obsolète. |
| Politiques RLS | Si les politiques de la base de données correspondent aux règles `rls` que vous avez déclarées, et si une politique nomme un rôle que ce serveur ne peut pas utiliser. |

Si la base de données est inaccessible, ses phases sont signalées comme ignorées avec le motif et le reste continue de s'exécuter — voir [Dépannage](/docs/troubleshooting/).

Renvoie un code de sortie non nul lorsqu'une vérification trouve une erreur, ou lorsqu'une phase n'a pas pu s'exécuter car la base de données fournie refuse les connexions. Une phase ignorée parce qu'aucune base de données n'a pu être résolue n'est pas considérée comme un échec.

`rebase doctor --policies` exécute uniquement les vérifications RLS — pas de diff de schéma, pas de types de SDK — et échoue de manière stricte (fail closed), ce qui en fait la forme à utiliser comme barrière de CI face à une base de données déployée.

`rebase doctor --database` exécute uniquement la vérification préalable de la base de données : si le rôle sous lequel s'exécutent les requêtes authentifiées existe, est restreint et peut être endossé, quels autres identifiants peuvent basculer vers lui, si chaque rôle peut se connecter, et quelles tables, permissions (grants) et politiques Rebase partagerait avec d'autres rôles. Chaque résultat indique le SQL à exécuter en tant qu'administrateur, le paramètre `rls` qui adapte Rebase à la base de données à la place, ou les deux. Il lit le catalogue et ne modifie rien, et quitte avec le code 1 lorsqu'un constat est un échec. Il fonctionne également sur un projet headless. Voir [Exécution sur une base de données existante ou partagée](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Vérifie si les tables sont prêtes pour la production, en une commande rapide pour la CI et pour les hooks d'un agent IA. Fonctionne hors ligne par défaut et ne modifie jamais rien.

| Étape | Ce qui la fait échouer |
| --- | --- |
| Définitions de tables (`schema`) | `backend/schema` ne se charge pas ou ne compile pas via le chargeur utilisé par le backend au démarrage : une relation vers une table que l'index n'exporte pas, `rls: "inherit"` sans `defaultRls`, une table sans clé primaire — un constat par problème. Une table sans `rls` en fait partie. |
| Couverture RLS (`rls`) | Une table avec une colonne `user_id`, `owner_id`, `organization_id` ou `tenant_id` dont les règles — les siennes ou le `defaultRls` dont elle hérite — permettent à un rôle de lire chaque ligne indépendamment de celle-ci. Un avertissement. `rls-policy-recursion` : une règle qui lit sa propre table dans une sous-requête, ou deux tables dont les règles se lisent mutuellement, ce que Postgres refuse de développer, de sorte que chaque instruction qu'elle protège échoue avec `42P17 infinite recursion detected in policy` ; le constat indique la table lue et le correctif, déplaçant la lecture dans une fonction `SECURITY DEFINER`. Une erreur, ou un avertissement lorsque la boucle n'est pas certaine. |
| Fraîcheur des migrations (`migrations`) | Une table ou une colonne déclarée par les tables qu'aucun fichier dans `backend/drizzle/migrations` ne crée, ou une table/colonne qu'elles ont supprimée mais qu'une migration continue de créer. Ignoré pour un projet sans migrations pour l'instant. |
| Personnalisations CMS (`cms`) | Un `customizeTable(...)` dans `frontend/src/cms` (ou le `src/cms` d'une application statique dans `rebase.json`) qui ne correspond pas aux tables, lu de manière statique — les modules ne sont pas exécutés. `cms-unknown-table` : le slug ne nomme aucune table, le panneau l'ignore donc (le slug le plus proche est suggéré). `cms-unknown-field` : une clé sous `fields` n'est ni une colonne ni une relation (le nom SQL d'une colonne est retourné avec sa clé). `cms-hidden-required` : un champ exclu du formulaire (`hiddenInForm`, `readOnly`, `disabled`) dont la colonne est `NOT NULL` sans valeur par défaut et sans élément renseigné par le serveur, de sorte que la création d'un enregistrement depuis le panneau échoue toujours ; un avertissement lorsqu'un hook `beforeSave` ou une transformation est susceptible de le remplir, et ignoré avec `filledByServer`. `cms-duplicate-customization` : un slug personnalisé deux fois. `cms-not-static` (avertissement) : un appel dont le slug, les options ou `fields` ne sont pas des littéraux ou une `const` dans le même fichier, donc aucun élément n'a été vérifié. `cms-ui-config-not-mounted` (avertissement) : `frontend/src/cms/ui-config.json` existe mais `<RebaseCMS>` ne le reçoit pas en tant que `uiConfig`. `cms-backend-guard-missing` : la configuration Vite du frontend n'utilise pas `rebaseBackendGuard()`, donc `rebase build` le refuserait. Un projet headless n'a pas de `frontend/src/cms` et ignore cette étape. |
| Audit RLS en direct (`live`) | Avec `--live` : le catalogue [`rls-check`](/docs/rls-check) par rapport à la base de données du projet, et si chaque migration a été appliquée. La base de données est résolue comme les commandes `db` la résolvent — `--database-url`, `DATABASE_URL`, `--docker`, sinon la base de données de développement gérée. Une base de données qui n'est pas configurée ou qui ne répond pas constitue une erreur, pas une étape ignorée : l'audit a été explicitement demandé. Une politique de lecture `USING (true)` compilée à partir d'une règle `access: "public"` est un avertissement tant que l'API requiert un token (`AUTH_REQUIRE`, activé par défaut) — chaque utilisateur connecté lit chaque ligne — et une erreur avec `AUTH_REQUIRE=false`, où les lignes sont anonymes. |

`--json` affiche un objet unique, `{ ok, schemaDir, steps, findings, summary }` : chaque étape est un `{ id, title, status, detail? }` (`status` étant `passed`, `failed`, `warnings` ou `skipped`), et chaque constat contient `step`, `check` (un type stable en kebab-case), `severity`, `message`, et le cas échéant `fix`, `table`, `file`, `line` et le `path` pointé dans la table (`posts.rls[0]`) — afin qu'un agent puisse réparer ce qu'il a cassé. `summary` compte les `errors` et `warnings`. `--quiet` n'affiche rien lorsque tout réussit. Renvoie un code de sortie non nul en cas d'erreur ; les avertissements n'entraînent pas d'échec.

Un projet échafaudé l'exécute pour Claude Code après chaque modification sous `backend/schema/` : voir [`rebase skills install`](#rebase-skills-install).

### Commandes pour une application en cours d'exécution

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` et `rebase storage ls|cp|rm|url|stat` agissent sur une application en cours d'exécution via son API : l'instance locale `rebase dev`, un serveur spécifié avec `--url`, ou un projet Rebase Cloud avec `--project`. Voir [Une application en cours d'exécution](/docs/cli/project/).

### `rebase auth`

Commandes de gestion de l'authentification :

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gère les clés d'API de service du projet — l'identifiant qu'un agent, un script ou un autre service utilise, par opposition à la session d'un utilisateur final :

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` indique ce que la clé est autorisée à faire, séparé par des virgules ou répété ; `--full-access` lui accorde chaque scope détenu par la clé de service à l'exception de `keys:*`. `--roles` ajoute des rôles RLS en plus de `service`, `--expires-in` prend un nombre de jours et `--expires-at` une date ISO. `rebase api-keys scopes` liste chaque scope connu du backend. Une clé n'est affichée qu'une seule fois. Les scopes de la clé et la sécurité au niveau des lignes (RLS) de l'identité sous laquelle elle agit s'appliquent tous deux. Voir [Clés d'API](/docs/backend/api-keys/).

### `rebase storage`

Maintenance globale des fichiers stockés, via le backend en cours d'exécution avec `REBASE_SERVICE_KEY` depuis `.env` :

```bash
rebase storage orphans                         # fichiers qu'aucune ligne ne référence
rebase storage orphans --source media --delete # et les supprimer, après confirmation
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lit chaque ligne de chaque table telle que stockée (lignes supprimées de manière réversible / soft-deleted incluses, en contournant chaque hook `beforeQuery` et `afterRead`) ainsi que chaque entrée d'[historique](/docs/backend/history/), puisqu'une restauration rétablit son contenu. Elle liste les fichiers d'une source (`--source`, la source par défaut si elle est omise) qu'aucune chaîne de caractères ne mentionne parmi eux : une clé, une URL, une référence `rebase-storage:` dans un texte. Les fichiers plus récents que le nombre d'heures défini par `--older-than` (24 par défaut) sont exclus, car le panneau d'administration téléverse un fichier avant que la ligne qui le référence ne soit enregistrée. L'analyse s'exécute sur le backend en arrière-plan, de sorte qu'un projet trop volumineux pour être analysé au sein d'une seule requête (derrière un ingress susceptible d'expirer) arrive tout de même à terme. La CLI la démarre, puis affiche sa progression (fichiers listés, lignes lues, tables traitées, et celles qui n'ont pas pu être lues) jusqu'à ce qu'elle soit terminée. Lorsque la [file d'attente de tâches (job queue)](/docs/backend/jobs/) est activée, l'analyse est un job `storage.orphans` exécuté par les workers de tâches. Sans elle, l'analyse s'exécute au sein du processus serveur sollicité, et la CLI le signale : redémarrer ce processus interrompt l'analyse. Une analyse correspond à une tentative de job, limitée par `jobs.timeoutMs` (15 minutes par défaut). Augmentez cette valeur, ou définissez-la à 0, pour une source nécessitant plus de temps. `--json` affiche le même rapport qu'auparavant, avec en plus son `scanId`.

`--delete` demande confirmation avant de supprimer (`--yes` ignore la question et est requis en l'absence de terminal). Elle ne supprime qu'à partir de l'analyse qui vient d'être affichée, et uniquement dans les 15 minutes suivant l'achèvement de cette analyse. Rien n'est supprimé tant qu'une table ne peut pas être lue : une table dotée de hooks de lecture sur une base de données dont le pilote ne peut pas les outrepasser est considérée comme non lue. Avant de supprimer quoi que ce soit, le serveur relit chaque ligne et chaque entrée d'historique par rapport aux fichiers listés. Ensuite, il redemande pour chaque fichier juste avant de le supprimer. Un fichier qu'une ligne référence désormais, qui a été téléversé à nouveau depuis l'analyse, ou qui a disparu, est conservé, et la CLI l'indique comme conservé. Les fichiers qui ne sont référencés que par des tables que Rebase ne sert pas apparaîtront comme inutilisés : vérifiez avant de supprimer. Face à un backend version 0.25.1 ou antérieure, la CLI analyse selon l'ancienne méthode, au sein d'une seule requête.

`move` copie les fichiers sous `--prefix` vers une autre source sous les mêmes clés, une page à la fois. Un fichier que la cible possède déjà à la même taille est ignoré, de sorte qu'un déplacement interrompu reprend en le réexécutant ; `--delete-source` supprime chaque fichier de la source une fois que la cible le possède, et est refusé lorsque les deux sources stockent dans le même bucket ou répertoire. Une fois le déplacement terminé, la CLI liste à nouveau la source avec un nouveau parcours et nomme chaque fichier que le déplacement n'a pas déplacé : avec `--delete-source`, tout fichier toujours présent dans la source ; sans cette option, tout fichier dont la cible ne détient pas de copie de même taille. Elle quitte avec le code 1 s'il en reste un, et réexécuter le même déplacement le prendra en charge. `--json` les affiche sous forme de `notMoved`. La lecture du rapport d'une analyse nécessite `database:read`. Le lancement d'une analyse, la suppression et le déplacement nécessitent `database:write`, dont dispose la clé de service.

### `rebase skills install`

Installe les compétences (skills) de référence Rebase pour vos assistants de code IA — chaque `--agent` mentionné ci-dessus :

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Voir [Compétences d'agent](/docs/ai/skills) pour la liste complète et l'emplacement où les fichiers sont écrits.

`--hooks` installe le garde-fou Claude Code que `rebase init` fournit avec chaque projet : `.claude/hooks/post-edit-collection.sh`, enregistré en tant que hook `PostToolUse` dans `.claude/settings.json`, qui exécute `rebase verify --quiet` après chaque modification sous `backend/schema/` ou `frontend/src/cms/` et renvoie tout problème à l'agent. Les paramètres et hooks existants sont conservés. `rebase skills --hooks` installe le hook seul.

### `rebase telemetry`

Partage d'utilisation anonyme, désactivé tant que vous ne donnez pas votre accord. Une exécution interactive de `rebase init` pose la question à la fin, et l'invite répond non par défaut, donc rien n'est partagé à moins que vous ne répondiez oui. La réponse s'applique par machine (`~/.rebase/telemetry.json`) : après un oui, `init` ne redemande plus jamais, et après un non, le prochain `init` reposera la question. Chaque copie locale reçoit un identifiant de projet aléatoire, conservé dans son fichier ignoré par git `.rebase/telemetry-project.json`.

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
