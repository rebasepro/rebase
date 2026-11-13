---
sourceHash: d0b65c1ecccde6ba
title: Référence de la CLI
sidebar_label: CLI
description: Commandes de la CLI Rebase pour l'initialisation de projet, la génération de schéma, les migrations de base de données et la génération de SDK.
---

## Vue d'ensemble

La CLI Rebase (`rebase`) gère votre projet, de l'échafaudage initial jusqu'au déploiement.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Ou exécutez n'importe quelle commande sans l'installer : `pnpm dlx @rebasepro/cli <command>`.

## Sortie lisible par une machine

`--json` est le modificateur, et en dehors de la famille `cloud`, c'est le seul : `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` et `rebase verify` envoient alors une valeur JSON sur stdout — le résultat, ou une enveloppe `{"error": {"message", "code", "hint", "issues"}}` avec un code de sortie non nul — à **chaque** sortie de la commande, afin qu'un appelant puisse analyser stdout sans condition. Sans cette option, ils écrivent du texte lisible par un humain et les erreurs vont sur stderr. `rebase cloud` utilise la même enveloppe et constitue la seule exception au modificateur : il active également le JSON de lui-même lorsque stdout n'est pas un TTY, ou lorsque `REBASE_JSON=1` est défini. Ainsi, `rebase cloud status | cat` produit du JSON tandis que `rebase status | cat` n'en produit pas — dans un script, passez explicitement `--json` plutôt que de vous fier à l'une de ces règles.

## Commandes

### `rebase init`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Initialiser un nouveau projet Rebase :

```bash
rebase init [directory]
```

Met en place un `backend/` (les tables dans `backend/schema/`) et un `frontend/` (le panneau d'administration, avec ses personnalisations de tables dans `frontend/src/cms/`) ; `--headless` échafaude uniquement le `backend/`, sans `backend/schema/`. La [structure du projet](/docs/getting-started/project-structure/) montre les deux arborescences.

| Option | Action |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Par défaut `blog` |
| `--headless` | Backend uniquement — pas de panneau d'administration et pas de `backend/schema/` : le serveur expose directement les tables de la base de données. `--template` n'a aucun effet, car il n'y a pas de tables à initialiser |
| `-y, --yes` | Ne jamais demander de confirmation. **Requis dès lors qu'il n'y a pas de terminal pour répondre**, comme dans un environnement de CI. Ignore l'initialisation de git et l'installation des dépendances — les valeurs interactives par défaut répondent oui aux deux, passez donc `--git` / `--install` si vous les souhaitez |
| `-i, --install` | Installer les dépendances après l'échafaudage. Sans cette option, init pose la question (oui par défaut) ; sous `--yes`, rien n'est installé |
| `--no-install` | N'installer rien et ne pas demander |
| `-g, --git` | Initialiser un dépôt et effectuer le premier commit. Sans cette option, init pose la question (oui par défaut) ; sous `--yes`, aucun dépôt n'est créé |
| `--database-url <url>` | Utiliser une base de données existante au lieu de la base gérée. Il doit s'agir d'une URL `postgres://` ou `postgresql://` : toute autre valeur est refusée avant qu'un fichier ne soit écrit, et l'invite interactive repose la question |
| `--introspect` | Générer `backend/schema` à partir de cette base de données. Implique `--template blank` et requiert `--install` |
| `--project <slug>` | Lier l'échafaudage à un projet Rebase Cloud |
| `--setup-key <key>` | La clé à usage unique authentifiant cette liaison |
| `-a, --agent <name>` | Configurer les agents de codage IA : les [compétences](/docs/ai/skills) et le [serveur MCP](/docs/ai/mcp). Répétable ou séparé par des virgules — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sans cette option, `init` demande et pré-coche les agents installés sur la machine ; sous `--yes`, aucun |

### `rebase dev`

Démarrer le serveur de développement :

```bash
rebase dev
```

Démarre à la fois le frontend et le backend avec le rechargement à chaud (hot reloading), et régénère le schéma Drizzle ainsi que les types du SDK (`generated/sdk/`) au démarrage et à chaque sauvegarde sous `backend/schema/`.

Les deux ports sont dérivés du chemin du projet afin que plusieurs projets Rebase puissent s'exécuter
côte à côte. Utilisez les URL affichées par `rebase dev`. Fixez-en un avec `rebase dev --port 3001`.

Une modification de `.env`
redémarre le backend, qui lit à nouveau le fichier, tout comme le fait le panneau d'administration. Les variables définies
par `rebase dev` lui-même sont conservées jusqu'à son redémarrage : `PORT`, et
`DATABASE_URL` lorsqu'il utilise la base de données gérée ou Docker.

Avec
`--database-url`, `rebase dev` vérifie d'abord que quelque chose répond à cet hôte
et à ce port. Si rien ne répond, il l'indique en nommant l'option, et quitte avec le code `1`
sans rien avoir démarré ; il laisse également intacts les noms de la base de données dans `.env`,
sans jamais démarrer son conteneur compose.

### `rebase build`

Compiler le projet sous la forme d'un bundle déployable dans `dist-bundle/` :

```bash
rebase build
```

Le bundle est l'artefact que vous déployez — l'image du runtime le charge, vous n'avez donc aucune
image d'application à construire vous-même. Options utiles :

| Option | Effet |
|------|--------|
| `--output <dir>` (ou `--out`) | Écrire le bundle à un autre endroit que `dist-bundle/` (une application à la fois) |
| `--vendor` | Toujours installer et inclure (« vendor ») les dépendances du bundle |
| `--no-vendor` | Ne jamais inclure les dépendances ; le pod les installe à chaque démarrage |
| `--skip-type-check` | Ignorer la vérification de types (plus rapide, moins sûr) |
| `--no-static` | Ne pas intégrer le frontend dans le bundle backend (chaque application statique conserve son propre bundle) |
| `--skip-static-build` | Intégrer le frontend tel qu'il a déjà été compilé, sans exécuter sa commande de build |

<span class="since-badge" data-since="0.31">Depuis 0.31</span> Un frontend — toute application statique de `rebase.json` dotée d'une configuration Vite — dont la configuration n'utilise pas `rebaseBackendGuard()` (issu de
`@rebasepro/app/vitePlugin`) est refusé : c'est ce qui empêche le code serveur d'atterrir dans le
bundle du navigateur, et empêche Vite d'intégrer un fichier backend en tant qu'URL `data:`
(le build échoue, en se nommant, lorsqu'un autre plugin remplace son
`build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` est inclus dans le bundle sous le nom
`entry.uiConfig`, la présentation de l'espace de travail servie par un backend déployé.

Les dépendances sont incluses (« vendored ») par défaut afin qu'une nouvelle instance n'ait pas à subir une
installation de 35 à 55 secondes. Une arborescence qui dépasse 2 Go sur le disque est abandonnée à la place,
car la limite de téléversement est de 1 Go compressé.

Chaque application statique que le
bundle transporte reçoit une copie brotli (`.br`) et gzip (`.gz`) à côté de chaque
ressource hachée par contenu de 1 Ko ou plus — les fichiers qu'un navigateur met en cache pendant un an.
Le runtime envoie celle que le navigateur accepte, de sorte que ces fichiers ne coûtent aucun
travail de compression par requête, y compris lors de la première visite après un déploiement, et
les navigateurs qui acceptent brotli le reçoivent (environ 11 % plus léger que gzip sur le JavaScript
de l'administration). La sortie de compilation propre à votre frontend reste inchangée ; seule la copie
dans le bundle est modifiée. Sur l'application d'exemple, cela ajoute moins d'une seconde au build
et environ 2,4 Mo au bundle.

### `rebase upgrade`

Met à niveau chaque package `@rebasepro/*` épinglé par le projet vers une version donnée, puis
lance l'installation avec le gestionnaire de paquets indiqué par son fichier lockfile. `rebase upgrade` prend la
version la plus récente ; `--to 0.21.0` une version exacte, sans recherche dans le registre ; `--to canary` un
dist-tag. Chaque version épinglée dans `dependencies`, `devDependencies` et
`optionalDependencies`, dans chaque `package.json` du projet, conserve son `^`
ou `~`, et rien d'autre ne change dans le fichier. Les `peerDependencies` et
les spécifications `workspace:`, `link:`, `file:`, git et tags sont listées et laissées intactes.
Les remplacements (overrides) dans `pnpm-workspace.yaml` et `package.json` sont également mis à jour, mais un remplacement `link:` ou
`file:` l'emporte sur toute version épinglée : il est signalé, et
`--drop-local-overrides` le supprime. `--dry-run` n'écrit rien, `--no-install`
ignore l'installation, et `--json` affiche un document unique.

Un projet utilisant une
version préliminaire, comme un canary, reste sur son canal à moins que `latest` ne soit plus récent. Un
dist-tag qui ferait rétrograder une version épinglée est refusé (`downgrade_refused` sous
`--json`) à moins que vous ne passiez `--allow-downgrade` ; un `--to` exact est appliqué et
signalé comme une rétrogradation. Un `--dry-run` d'une mise à niveau que l'exécution réelle refuserait
affiche ce qui changerait et se termine avec le code 0, et sous `--json`, son document contient le
refus sous la clé `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Exécuter le bundle compilé de la même manière qu'un déploiement l'exécute :

```bash
rebase start
```

Lit `PORT` et le reste du fichier `.env`, contrairement à `rebase dev`, dans le `NODE_ENV` qu'ils
définissent. Un `.env` échafaudé indique `development`, de sorte que le premier compte enregistré
devient toujours l'administrateur, et `rebase start` l'indique tout en haut ; définissez `NODE_ENV=production`
pour un serveur de production. `rebase start --bundle ./dist-bundle` exécute un bundle situé ailleurs.

`rebase start` ne démarre aucune base de données, et le `.env` de l'échafaudage ne contient aucun
`DATABASE_URL` ; ainsi, une exécution locale sur la base de données utilisée par `rebase dev` correspond à
`DATABASE_URL="$(rebase db url)" rebase start`.
S'il en manque une, cette ligne est affichée avant le démarrage.

### `rebase apps list`

Afficher les applications déclarées par ce dépôt :

```bash
rebase apps list
```

Un dépôt peut déclarer plusieurs applications déployables — un backend et un site
marketing, par exemple. C'est ainsi que vous pouvez voir sur quoi `rebase build` et le déploiement vont agir.

### `rebase eject`

Prendre le contrôle du processus serveur et de son image :

```bash
rebase eject
```

Écrit le point d'entrée du backend et un `Dockerfile` dans le projet et bascule son
backend, de sorte que le dépôt construise sa propre image au lieu d'exécuter le
runtime publié. À partir de ce moment, **les mises à jour du runtime de la plateforme ne lui parviennent plus**,
et la configuration de CORS, de l'authentification, du stockage et de l'arrêt vous incombe.

Prévisualisez les changements avec `rebase eject --dry-run`, qui liste ce qui changerait et
ne modifie rien. `--force` remplace un fichier `backend/src/index.ts` ou
`env.ts` existant, en conservant le fichier actuel sous le nom `<name>.bak`.

Le serveur éjecté
conserve les téléversements locaux dans le dossier `uploads/` du projet, qu'il soit exécuté depuis les sources ou compilé, tout comme
le fait `rebase dev`. Il s'exécute dans `backend/`, donc un `STORAGE_PATH` relatif y est
lu à partir de `backend/`.

### `rebase schema generate` / `rebase schema stale`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # nomme ce qui diffère des tables, quitte avec 1 si c'est le cas
rebase schema stale --fix    # régénère le fichier à la place
```

Chaque commande qui lit le schéma accepte `--schema-dir <dir>` pour un projet
qui le conserve ailleurs ; `--collections` a été supprimé. `rebase dev` maintient le
fichier à jour, `stale` sert donc de vérification pour un build ou en CI. Voir
[Génération de schéma](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # appliquer les tables à la base de données (développement)
rebase db generate             # écrire un fichier de migration SQL
rebase db migrate              # appliquer les migrations en attente
rebase db url                  # afficher la chaîne de connexion utilisée par ce projet
rebase db pull --from <url>    # copier une autre base de données dans la base locale
rebase db backup               # pg_dump ; db backups list et db restore à côté
rebase db branch create <name> # une copie de travail ; switch, list et prune également disponibles
rebase db stop                 # arrêter la base de données de développement gérée
rebase db reset                # la supprimer et repartir de zéro
rebase db request-role migrate --to <role> # déplacer les requêtes vers un autre rôle Postgres
rebase db provision --print    # le SQL qui configure le rôle de requête, pour un DBA
```

Chacune de ces commandes est détaillée dans [Commandes de base de données](/docs/cli/database/), avec l'ordre dans lequel une
commande sélectionne sa base de données ; `push`, `generate` et `migrate` sont traitées en
détail dans [Génération de schéma](/docs/cli/schema/).

### `rebase console`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un REPL Node avec les données du projet accessibles, ou un extrait de code exécuté avec `-e` :

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) et `tables` (les
tables du projet, chargées depuis `backend/schema`) sont dans la portée, et l'instruction `await`
de premier niveau fonctionne. La base de données est résolue de la même façon que `rebase db push`
la résout, et son ouverture n'y modifie rien. Avec `-e`, le résultat attendu
est affiché au format JSON sur stdout et une exception entraîne une sortie avec le code `1`. Options : `--eval`/`-e`,
`--schema-dir`, `--database-url`, `--docker`. Voir
[Scripts et console](/docs/backend/scripts/).

### `rebase migrate`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Transitions à sens unique depuis une disposition que cette version ne lit plus :
`rebase migrate collections-to-tables` (`config/collections` → `backend/schema`
et `frontend/src/cms`) et `rebase migrate sdk-calls` (`data.collection("x")`
→ `data.table("x")` dans votre propre code). Leurs options, ce qu'elles écrivent et la
section « À vérifier avant de déployer » se trouvent sur la page
[Génération de schéma](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # les applications déclarées par ce projet
rebase apps init             # écrire un rebase.json déduit de ce projet
rebase apps config <app>     # la configuration client pour une application
```

`apps init` ne prend aucun nom : il déduit chaque application à partir du projet et écrit
l'intégralité du fichier `rebase.json`, et refuse de remplacer un fichier existant à moins de passer
l'option `--force`.

L'argument de nom est
refusé. `--force` conserve ce que l'inférence ne peut pas deviner à partir du fichier qu'elle remplace :
le nom de chaque application, son `path` et sa route `cms`. Tout le reste est déduit
à nouveau, et une application déclarée qu'il ne trouve plus est indiquée comme supprimée ; ainsi, sur un
échafaudage, il réécrit le `rebase.json` d'origine. La commande de build de l'application statique
utilise le gestionnaire de paquets du projet.

Pour une
copie de travail non liée à un projet Cloud, `apps config` indique qu'elle n'est pas liée,
que `rebase dev` soit en cours d'exécution ou non, et fournit l'URL du backend telle que
servie par `rebase dev`.

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
`rebase.json` indique où se trouve votre code et qui exécute le serveur,
`backend/resources.ts` indique les besoins du projet, et l'environnement précise comment
joindre chaque élément. Tout le reste — `rebase.resources.json`, le manifeste
du bundle — est généré à partir du deuxième fichier pour les outils qui ne peuvent pas exécuter votre
code, et vous n'avez jamais à l'écrire.

Un `○` représente l'état qu'il vaut mieux connaître avant un déploiement plutôt qu'après :
déclaré, mais non configuré. Un `✗` signifie que l'environnement définit un élément de manière *incorrecte*,
ce qui empêche le démarrage au lieu de fonctionner en mode dégradé.

Un fichier
`rebase.resources.json` qui ne correspond plus aux déclarations se voit attribuer une ligne `○`.
Un fichier qui n'a pas encore été écrit n'en reçoit pas : `rebase build` l'écrit à chaque
compilation, donc un projet qui n'a jamais été compilé, comme un nouvel échafaudage, n'a
rien à corriger.

### `rebase resources`

Ce que ce projet déclare comme prérequis — les bases de données, buckets, topics et
files d'attente demandés par `backend/resources.ts`, ainsi que les crons et fonctions définis par ses fichiers :

```bash
rebase resources            # les lister
rebase resources --write    # régénérer rebase.resources.json
rebase resources --check    # échouer si le graphe versionné n'est plus à jour
rebase resources --json     # format lisible par une machine
```

`rebase resources --check` est l'option qu'un job de CI utilise pour échouer en présence d'un
fichier `rebase.resources.json` qui ne correspond plus à `backend/resources.ts`.
`--json` se combine
avec elle : en cas d'écart, `rebase resources --check --json` quitte avec le code 1 et une enveloppe
d'erreur (`resource_graph_missing` ou `resource_graph_stale`), et en cas de succès,
le graphe contient `check.status`. `--write --json` écrit le fichier et renvoie
`written.changed`.

Une ressource est déclarée dans `backend/resources.ts` — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou correspond à un fichier
sous `backend/crons` ou `backend/functions`, et n'est jamais écrite à la main dans
`rebase.resources.json`, qui est généré à partir de ces déclarations afin qu'un hôte puisse
connaître les besoins d'un projet sans avoir à le compiler. Chaque entrée enregistre qui l'utilise
(`table:events`, `column:posts.cover`, `function:report`).

Un backend possède également une base de données par défaut et une source de stockage par défaut que personne
ne déclare. Les deux sont listées ici avec la mention `implicit`, et aucune n'est écrite dans
`rebase.resources.json` — l'hôte les fournit, les enregistrer reviendrait donc à demander
le provisionnement d'un élément que personne n'a sollicité.
En déclarer une
nommée, telle que `bucket("media")`, laisse celle par défaut à sa place, de sorte que les deux sont
listées. Seule la déclaration explicite de la ressource par défaut, ou le marquage d'un bucket avec
`default: true`, la remplace.

Pour voir ce que la plateforme détient pour un projet par rapport à ce que son code déclare,
et pour supprimer une base de données provisionnée que le code ne mentionne plus, consultez
[`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — toutes les commandes relatives à Rebase Cloud : authentification, liaison de projet, déploiements, configuration, bases de données, ressources, calcul et plus encore — dispose de [sa propre page](/docs/cli/cloud).

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```bash
rebase generate-sdk
```

Génère un client typé pour les tables exportées par `backend/schema/index.ts` dans
`generated/sdk/`, avec `TableName` et `tablesDictionary` ; `--from <link|url>`
lit à la place le contrat d'un backend en cours d'exécution. `--register` type également
les données côté serveur : il écrit les types et la déclaration `Register` dans
`backend/generated/` et l'enregistre dans `rebase.json` (`registerDatabase`).
Voir [Données typées côté serveur](/docs/backend/typed-server-data) et
[Génération de schéma](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

La commande à exécuter quand quelque chose ne va pas et que vous ne savez pas encore quoi. Elle
établit un diagnostic sans jamais rien modifier, elle est donc sans danger pour n'importe quelle base de données
accessible.

**Sans base de données.** Ces vérifications s'exécutent en premier, car tout ce qui empêche un projet
de fonctionner se produit avant même qu'une table puisse être comparée :

| Vérification | Pourquoi |
| --- | --- |
| Version de Node | Par rapport à la plage déclarée par la CLI. Une version trop ancienne n'est pas signalée comme « Node non supporté » — il s'agit d'une erreur de syntaxe à l'intérieur d'une dépendance. |
| Gestionnaires de paquets | Deux lockfiles dans un même projet. Un `npm install` dans un workspace pnpm réorganise `node_modules` dans une structure incompatible avec pnpm, et le symptôme est une erreur `Cannot find module` quelques heures plus tard. |
| Slugs en double | Deux tables déclarant le même slug. Le schéma refuse de compiler dans ce cas, et cette vérification nomme les deux. |
| Validité du fichier `.env` | Un `JWT_SECRET` de moins de 32 caractères (sur lequel la production refuse de démarrer), et `NODE_ENV=production` sans `CORS_ORIGINS` ni `FRONTEND_URL`. Les valeurs ne sont jamais affichées. |
| Décalage de version `@rebasepro/*` | Le même package épinglé à des versions différentes d'un fichier `package.json` à l'autre dans le projet. Deux copies brisent le fonctionnement d'`instanceof` entre elles, ce qui se traduit par un garde de type rejetant son propre type. |
| Chaînes de connexion | Un caractère `=` non encodé dans un paramètre d'URL, que les outils propres à PostgreSQL refusent d'analyser — ce qui casse les sauvegardes et `psql` alors que l'application continue de fonctionner. |
| Fonctions personnalisées | Les besoins de chaque fonction vis-à-vis de son hôte, et celles qui ne pourraient pas s'exécuter sur un runtime edge. |

**Sur la base de données** — celle du projet, résolue de la manière dont `rebase db url`
la résout ; sur un nouvel échafaudage, il s'agit donc de la base gérée, que `doctor`
démarre :

| Vérification | Pourquoi |
| --- | --- |
| Tables → schéma généré | Indique si `schema.generated.ts` est obsolète. |
| Tables → base de données | Tables, colonnes, enums, clés étrangères et tables de jonction manquantes. |
| Extensions requises | Une colonne `col.vector()` nécessite pgvector, que Rebase n'installe que lorsqu'un projet l'a déclaré. |
| Empreinte du schéma (Schema stamp) | Indique si cette base de données a été provisionnée à partir de ces tables. Il s'agit d'un hash, ce qui permet d'indiquer que les deux divergent sans jamais préciser lequel est en avance. Une empreinte `v1:` issue d'un runtime antérieur à la version 0.31 est signalée une seule fois, accompagnée de la commande de mise à jour : `rebase db push`. |
| Tables → types du SDK | Indique si le SDK typé généré est obsolète. |
| Stratégies RLS | Indique si les stratégies de la base de données correspondent au `rls` déclaré, et si une stratégie mentionne un rôle que ce serveur ne peut pas utiliser. |

Si la base de données est inaccessible, ses étapes sont signalées comme ignorées avec la
raison associée et le reste continue de s'exécuter — voir [Dépannage](/docs/troubleshooting/).

Quitte avec un code non nul lorsqu'une vérification trouve une erreur, ou lorsqu'une étape n'a pas pu s'exécuter
parce que la base de données fournie refuse les connexions. Une étape ignorée parce
qu'aucune base de données n'a pu être résolue n'est pas considérée comme un échec.

`rebase doctor --policies` exécute uniquement les vérifications RLS — pas de comparaison de schéma, pas de
types de SDK — et échoue par défaut (fail closed), ce qui en fait la variante idéale à utiliser comme barrière de contrôle CI vis-à-vis d'une
base de données déployée.

`rebase doctor --database`
exécute uniquement la vérification préalable de la base de données : si le rôle utilisé par les requêtes authentifiées
existe, s'il est restreint et si l'on peut basculer vers lui, quels autres comptes peuvent basculer
vers lui, si chaque rôle peut se connecter, et quelles tables, autorisations (grants) et stratégies
Rebase partagerait avec d'autres rôles. Chaque résultat indique le SQL à exécuter en tant
qu'administrateur, le paramètre `rls` qui adapte plutôt Rebase à la base de données, ou
les deux. Il lit le catalogue et ne modifie rien, et quitte avec le code 1 lorsqu'un résultat est
en échec. Il fonctionne également sur un projet headless. Voir
[Exécution sur une base de données existante ou partagée](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Vérifier si les tables sont prêtes pour la production, en une seule commande rapide pour la CI et pour les
hooks d'un agent IA. Hors ligne par défaut, et ne modifie jamais rien.

| Étape | Ce qui la fait échouer |
| --- | --- |
| Définitions des tables (`schema`) | `backend/schema` ne se charge pas ou ne compile pas avec le chargeur utilisé au démarrage du backend : une relation vers une table non exportée par l'index, `rls: "inherit"` sans `defaultRls`, une table sans clé primaire — une anomalie par problème. Une table sans `rls` en fait partie. |
| Couverture RLS (`rls`) | Une table dotée d'une colonne `user_id`, `owner_id`, `organization_id` ou `tenant_id` dont les règles — les siennes, ou le `defaultRls` dont elle hérite — permettent à un rôle de lire chaque ligne sans tenir compte de cette colonne. Un avertissement. |
| Fraîcheur des migrations (`migrations`) | Une table ou colonne déclarée par les tables qu'aucun fichier dans `backend/drizzle/migrations` ne crée, ou une qu'elles ont supprimée mais qu'une migration crée toujours. Ignoré pour un projet n'ayant pas encore de migrations. |
| Personnalisations CMS (`cms`) | Un `customizeTable(...)` dans `frontend/src/cms` (ou le `src/cms` d'une application statique dans `rebase.json`) qui ne correspond pas aux tables, analysé statiquement — les modules ne sont pas exécutés. `cms-unknown-table` : le slug ne correspond à aucune table, le panneau l'ignore donc (le slug le plus proche est suggéré). `cms-unknown-field` : une clé sous `fields` n'est ni une colonne ni une relation (le nom SQL d'une colonne est retourné avec sa clé). `cms-hidden-required` : un champ masqué du formulaire (`hiddenInForm`, `readOnly`, `disabled`) dont la colonne est `NOT NULL` sans valeur par défaut et que le serveur ne remplit pas, de sorte que la création d'un enregistrement depuis le panneau échoue toujours ; un avertissement lorsqu'un hook ou transform `beforeSave` peut le remplir, et neutralisé par `filledByServer`. `cms-duplicate-customization` : un même slug personnalisé deux fois. `cms-not-static` (un avertissement) : un appel dont le slug, les options ou les `fields` ne sont pas des littéraux ou une constante issue du même fichier, de sorte que rien n'a pu y être vérifié. `cms-ui-config-not-mounted` (un avertissement) : `frontend/src/cms/ui-config.json` existe mais `<RebaseCMS>` ne le reçoit pas en tant que `uiConfig`. `cms-backend-guard-missing` : la configuration Vite du frontend n'utilise pas `rebaseBackendGuard()`, `rebase build` la refuserait donc. Un projet headless n'a pas de `frontend/src/cms` et ignore cette étape. |
| Audit RLS en direct (`live`) | Avec `--live` : le catalogue [`rls-check`](/docs/rls-check) confronté à la base de données du projet, et la vérification que chaque migration a été appliquée. La base de données est résolue comme le font les commandes `db` — `--database-url`, `DATABASE_URL`, `--docker`, sinon la base de développement gérée. Une base de données non configurée ou qui ne répond pas constitue une erreur, pas une étape ignorée : l'audit a été explicitement demandé. Une stratégie de lecture `USING (true)` compilée à partir d'une règle `access: "public"` est un avertissement tant que l'API exige un jeton (`AUTH_REQUIRE`, activé par défaut) — chaque utilisateur authentifié lit chaque ligne — et une erreur avec `AUTH_REQUIRE=false`, où les lignes sont anonymes. |

`--json` affiche un objet unique, `{ ok, schemaDir, steps, findings, summary }` :
chaque étape est `{ id, title, status, detail? }` (`status` valant `passed`, `failed`,
`warnings` ou `skipped`), et chaque constat (`finding`) comporte `step`, `check` (un identifiant stable
en kebab-case), `severity`, `message`, et le cas échéant `fix`, `table`,
`file`, `line` ainsi que le chemin pointé (`path`) dans la table (`posts.rls[0]`) — afin qu'un agent puisse
corriger ce qu'il a cassé. `summary` comptabilise `errors` et `warnings`. `--quiet` n'affiche rien lorsque tout réussit. Quitte avec un code non nul en cas
d'erreur ; les avertissements ne font pas échouer la commande.

Un projet échafaudé l'exécute pour Claude Code après chaque modification sous `backend/schema/` : voir
[`rebase skills install`](#rebase-skills-install).

### `rebase auth`

Commandes de gestion de l'authentification :

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gérer les clés d'API de service du projet — l'identifiant qu'un agent, un script ou
un autre service utilise, par opposition à la session d'un utilisateur final :

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` spécifie ce que la clé est autorisée à faire, séparé par des virgules ou répété ; `--full-access`
lui attribue l'ensemble des portées (scopes) détenues par la clé de service à l'exception de `keys:*`. `--roles` ajoute des rôles
RLS à côté de `service`, `--expires-in` s'exprime en jours et `--expires-at` prend une date au format ISO.
`rebase api-keys scopes` liste toutes les portées connues du backend. Une clé n'est affichée qu'une seule fois.
Les portées de la clé et la sécurité au niveau des lignes (RLS) de l'identité sous laquelle elle agit s'appliquent toutes les deux.
Voir [Clés d'API](/docs/backend/api-keys/).

### `rebase storage`

Maintenance
globale des fichiers stockés, via le backend en cours d'exécution avec
`REBASE_SERVICE_KEY` issu de `.env` :

```bash
rebase storage orphans                         # fichiers qu'aucune ligne ne référence
rebase storage orphans --source media --delete # et les supprimer, après confirmation
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lit chaque ligne de chaque table telle qu'elle est stockée (les lignes
supprimées de manière logique incluses, au-delà de chaque hook `beforeQuery` et `afterRead`) ainsi que chaque
entrée d'[historique](/docs/backend/history/), puisqu'une restauration réactive ce qu'elle contient.
Il liste les fichiers d'une source donnée (`--source`, la source par défaut si non spécifiée)
qu'aucune chaîne de caractères dans ces données ne référence : une clé, une URL, une
référence `rebase-storage:` dans un texte. Les fichiers plus récents que `--older-than` heures (24 par défaut) sont exclus,
car le panneau d'administration téléverse un fichier avant que la ligne qui le référence ne soit enregistrée.
L'analyse s'exécute sur le backend en arrière-plan, de sorte qu'un projet trop volumineux pour être analysé
au cours d'une seule requête (derrière un ingress susceptible d'expirer) puisse tout de même se terminer. La
CLI la démarre, puis affiche sa progression (fichiers listés, lignes lues, tables
traitées, et celles qui n'ont pas pu être lues) jusqu'à ce qu'elle soit terminée. Lorsque la
[file d'attente de jobs](/docs/backend/jobs/) est activée, l'analyse est un job `storage.orphans` que
les workers de jobs exécutent. Sans elle, l'analyse s'exécute au sein du processus serveur qui a été
sollicité, et la CLI le signale : redémarrer ce processus interrompt l'analyse. Une analyse
représente une tentative de job, limitée par `jobs.timeoutMs` (15 minutes par défaut). Augmentez
cette valeur, ou définissez-la sur 0, pour une source qui nécessite plus de temps. `--json` affiche le même
rapport qu'auparavant, en y ajoutant son `scanId`.

`--delete` demande confirmation avant de supprimer (`--yes` ignore la question, et est obligatoire
en l'absence de terminal). Il ne supprime que des éléments issus de l'analyse qui vient d'être affichée, et uniquement dans un délai de
15 minutes après l'achèvement de cette analyse. Rien n'est supprimé tant qu'une table
ne peut pas être lue : une table dotée de hooks de lecture sur une base de données dont le pilote
ne peut pas passer outre est considérée comme non lue. Avant de supprimer quoi que ce soit, le serveur
lit à nouveau chaque ligne et entrée d'historique par rapport aux fichiers listés. Puis il redemande
l'état de chaque fichier juste avant de le supprimer. Un fichier désormais référencé par une ligne,
qui a été téléversé à nouveau depuis l'analyse, ou qui a disparu, est conservé, et la CLI
le liste comme conservé. Les fichiers qui ne sont référencés que par des tables que Rebase ne dessert pas semblent
inutilisés : vérifiez avant de supprimer. Face à un backend en version 0.25.1 ou antérieure, la
CLI effectue l'analyse à l'ancienne, au sein d'une seule requête.

`move` copie les fichiers situés sous `--prefix` vers une autre source avec les mêmes clés,
page par page. Un fichier que la cible contient déjà avec une taille identique est ignoré,
ce qui permet à un déplacement interrompu de reprendre en relançant la commande ; `--delete-source` supprime chaque
fichier de la source une fois que la cible le contient, et est refusé lorsque les deux
sources stockent dans le même bucket ou répertoire. Une fois le déplacement terminé, la CLI
liste à nouveau la source avec un parcours complet et indique chaque fichier que l'opération n'a pas
déplacé : avec `--delete-source`, tout fichier encore présent dans la source ; sans cette option, tout fichier
dont la cible ne possède pas de copie de taille identique. La commande quitte avec le code 1 s'il en existe un, et
relancer le même déplacement le prendra en charge. `--json` les affiche sous la clé `notMoved`. La lecture du rapport d'une
analyse requiert `database:read`. Démarrer une analyse, supprimer et déplacer nécessitent
`database:write`, que possède la clé de service.

### `rebase skills install`

Installer les compétences (skills) de référence Rebase pour vos assistants de codage IA — tous les `--agent` mentionnés plus haut :

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consultez [Compétences d'agent](/docs/ai/skills) pour la liste complète et l'emplacement où les fichiers sont écrits.

`--hooks` installe le garde-fou Claude Code que `rebase init` fournit avec chaque
projet : `.claude/hooks/post-edit-collection.sh`, enregistré en tant que hook
`PostToolUse` dans `.claude/settings.json`, qui exécute `rebase verify --quiet` après chaque modification
sous `backend/schema/` ou `frontend/src/cms/` et renvoie tout problème à l'agent. Les
paramètres et hooks existants sont conservés. `rebase skills --hooks` installe uniquement le hook.

### `rebase telemetry`

Partage anonyme des données d'utilisation, désactivé tant que vous n'avez pas accepté. Un `rebase init` interactif
pose la question à la fin, et l'invite répond non par défaut ; rien n'est donc partagé à moins que vous
ne répondiez oui. La réponse s'applique par machine (`~/.rebase/telemetry.json`) : après un oui,
`init` ne pose plus jamais la question, et après un non, le prochain `init` la reposera. Chaque
dépôt local reçoit un identifiant de projet aléatoire, conservé dans son fichier gitignoré
`.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` affiche la configuration actuelle, `show` affiche exactement ce qui serait envoyé —
que le partage soit activé ou non, afin que vous puissiez lire la charge utile avant de décider — et
les deux autres permettent de la modifier. Si vous n'avez jamais exécuté `init`, rien n'a jamais été collecté.

## Prochaines étapes

- **[Génération de schéma](/docs/cli/schema/#production-workflow)** — Le flux de travail de migration, de la modification d'une table jusqu'à la production
- **[Le schéma en tant que code](/docs/architecture/schema-as-code)** — Comment fonctionne la génération de schéma
- **[Démarrage rapide](/docs/getting-started/quickstart)** — Pour bien commencer
