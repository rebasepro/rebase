---
sourceHash: 53e679722797e137
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

`--json` est l'option dédiée, et en dehors de la famille `cloud`, c'est la seule : `rebase status`, `rebase resources`, `rebase apps list` et `rebase upgrade` écrivent alors une valeur JSON unique sur stdout — le résultat, ou une enveloppe `{"error": {"message", "code", "hint", "issues"}}` avec un code de sortie non nul — à **chaque** sortie de la commande, de sorte qu'un appelant peut parser stdout sans condition. Sans cette option, elles affichent du texte lisible par un humain et les erreurs vont sur stderr. `rebase cloud` utilise la même enveloppe et constitue la seule exception à cette option : elle active également le JSON d'elle-même lorsque stdout n'est pas un TTY, ou lorsque `REBASE_JSON=1` est défini. Ainsi, `rebase cloud status | cat` produit du JSON tandis que `rebase status | cat` n'en produit pas — dans un script, passez explicitement `--json` plutôt que de vous fier à l'une ou l'autre règle.

## Commandes

### `rebase init`

Initialiser un nouveau projet Rebase :

```bash
rebase init [directory]
```

Configure la structure du projet avec le frontend, le backend et les packages partagés.

| Option | Description |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Valeur par défaut : `blog` |
| `--headless` | Backend uniquement — pas de panneau d'administration ni de fichiers de collections. `--template` n'a aucun effet, car il n'y a aucune collection à initialiser |
| `-y, --yes` | Ne jamais demander de confirmation. **Requis partout où aucun terminal ne peut répondre**, comme dans un environnement de CI. Cela ignore l'initialisation de git et l'installation des dépendances — les valeurs par défaut interactives répondent oui aux deux, passez donc `--git` / `--install` si vous souhaitez les exécuter |
| `-i, --install` | Installer les dépendances après l'échafaudage. Sans cette option, init demande (oui par défaut) ; avec `--yes`, rien n'est installé |
| `--no-install` | Ne rien installer, et ne pas demander |
| `-g, --git` | Initialiser un dépôt et créer le premier commit. Sans cette option, init demande (oui par défaut) ; avec `--yes`, aucun dépôt |
| `--database-url <url>` | Utiliser une base de données existante au lieu de la base gérée. <span class="since-badge" data-since="0.25">Depuis 0.25</span> Ce doit être une URL `postgres://` ou `postgresql://` : toute autre est refusée avant qu'un fichier soit écrit, et l'invite interactive redemande |
| `--introspect` | Générer les collections à partir de cette base de données. Implique `--template blank` et requiert `--install` |
| `--project <slug>` | Lier le projet généré à un projet Rebase Cloud |
| `--setup-key <key>` | La clé à usage unique authentifiant cette liaison |
| `-a, --agent <name>` | Configurer les agents de codage IA : les [skills](/docs/ai/skills) et le [serveur MCP](/docs/ai/mcp). Répétable ou séparé par des virgules — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sans cette option, `init` demande et pré-coche les agents installés sur la machine ; avec `--yes`, aucun |

### `rebase dev`

Démarrer le serveur de développement :

```bash
rebase dev
```

Démarre à la fois le frontend et le backend avec le rechargement à chaud (hot reloading), et régénère le schéma Drizzle ainsi que les types du SDK (`generated/sdk/`) au démarrage et à chaque enregistrement d'une collection. Sur la 0.23, elle ne régénère que le schéma, et `rebase generate-sdk` est à votre charge.

Les deux ports sont dérivés du chemin du projet afin que plusieurs projets Rebase puissent s'exécuter côte à côte. Utilisez les URL affichées par `rebase dev`. Fixez-en un avec `rebase dev --port 3001`.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Une modification de `.env` redémarre le backend, qui relit le fichier, comme le fait le panneau d'administration. Ce que `rebase dev` définit lui-même est conservé jusqu'à ce que vous le redémarriez : `PORT`, et `DATABASE_URL` lorsqu'elle pointe vers la base gérée ou vers Docker. En 0.24, une modification de `.env` n'atteignait le backend que lorsqu'un autre fichier surveillé changeait.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Avec `--database-url`, `rebase dev` vérifie d'abord que quelque chose répond à cet hôte et à ce port. Si rien ne répond, il le dit, en nommant l'option, et se termine avec le code `1` sans rien démarrer ; il laisse aussi de côté la base de données que nomme `.env`, sans jamais démarrer son conteneur compose. En 0.24, la bannière du backend disait de vérifier `DATABASE_URL` dans `.env`, et dev continuait de tourner avec le backend arrêté.

### `rebase build`

Compiler le projet dans un bundle déployable dans `dist-bundle/` :

```bash
rebase build
```

Le bundle est l'artefact que vous déployez — l'image du runtime le charge, il n'y a donc pas d'image applicative à construire vous-même. Options utiles :

| Option | Effet |
|------|--------|
| `--output <dir>` (ou `--out`) | Écrire le bundle ailleurs que dans `dist-bundle/` (une application à la fois) |
| `--vendor` | Toujours installer et inclure les dépendances du bundle |
| `--no-vendor` | Ne jamais inclure les dépendances ; le pod les installe au premier démarrage |
| `--skip-type-check` | Ignorer la vérification de types (plus rapide, moins sûr) |
| `--no-static` | Ne pas intégrer le frontend dans le bundle backend (chaque application statique obtient tout de même son propre bundle) |
| `--skip-static-build` | Intégrer le frontend comme déjà compilé, sans exécuter sa commande de build |

Les dépendances sont incluses (vendored) par défaut afin qu'un redémarrage de pod ne subisse pas une installation de 35 à 55 secondes. Une arborescence qui dépasse 200 Mo sur le disque est ignorée à la place, car la limite de téléversement est de 100 Mo compressés — consultez le changelog pour en connaître la raison.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Chaque application statique que contient le bundle reçoit une copie brotli (`.br`) et une copie gzip (`.gz`) à
côté de chaque ressource à hachage de contenu de 1 Ko ou plus — les fichiers qu'un navigateur met en cache
pendant un an. Le runtime envoie celle que le navigateur accepte : ces fichiers ne coûtent donc aucun travail
de compression par requête, y compris lors de la première visite après un déploiement, et les navigateurs
qui acceptent brotli l'obtiennent (environ 11 % plus petit que gzip sur le JavaScript de l'admin). Le résultat
de build de votre propre frontend reste tel quel ; seule la copie dans le bundle change. Sur l'application
d'exemple, cela ajoute moins d'une seconde au build et environ 2,4 Mo au bundle.

### `rebase upgrade`

Mettre à jour chaque package `@rebasepro/*` épinglé par le projet vers une version donnée, puis installer avec le gestionnaire de paquets indiqué par son lockfile. `rebase upgrade` prend la version la plus récente ; `--to 0.21.0` une version exacte, sans recherche dans le registre ; `--to canary` un dist-tag. Chaque version épinglée dans `dependencies`, `devDependencies` et `optionalDependencies`, dans chaque `package.json` du projet, conserve son `^` ou `~`, et rien d'autre ne change dans le fichier. Les `peerDependencies` ainsi que les spécifications `workspace:`, `link:`, `file:`, git et par tag sont listées et laissées intactes. Les substitutions (overrides) dans `pnpm-workspace.yaml` et `package.json` sont également déplacées, mais une substitution `link:` ou `file:` l'emporte sur toutes les versions épinglées : elle est signalée, et `--drop-local-overrides` la supprime. `--dry-run` n'écrit rien, `--no-install` ignore l'installation et `--json` affiche un document unique.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Un projet sur une
préversion, comme une canary, reste sur son canal à moins que `latest` ne soit plus récent. Un
dist-tag qui ferait reculer une version épinglée est refusé (`downgrade_refused` avec
`--json`) à moins que vous ne passiez `--allow-downgrade` ; un `--to` exact est appliqué, et
signalé comme un retour en arrière. Un `--dry-run` d'une mise à jour que l'exécution réelle
refuserait montre ce qui changerait et se termine avec le code 0, et avec `--json` son document
porte le refus sous `wouldRefuse` (`{ code, message, hint }`). En 0.24, `rebase upgrade`
prend `latest` sans condition.

### `rebase start`

Exécuter le bundle compilé de la même façon qu'un déploiement l'exécute :

```bash
rebase start
```

Lit `PORT` et le reste du fichier `.env`, contrairement à `rebase dev`, dans le `NODE_ENV`
qu'ils définissent. Un fichier `.env` issu du scaffold indique `development`, si bien que la
première personne à s'inscrire devient quand même administrateur, et `rebase start` le signale
en haut de sa sortie ; définissez `NODE_ENV=production` pour un serveur de production.
`rebase start --bundle ./dist-bundle` exécute un bundle situé ailleurs.

`rebase start` ne démarre aucune base de données, et le `.env` du scaffold n'a pas de
`DATABASE_URL` : un lancement local sur la base de données qu'utilise `rebase dev` s'écrit donc
`DATABASE_URL="$(rebase db url)" rebase start`. <span class="since-badge" data-since="0.25">Depuis 0.25</span>
Sans `DATABASE_URL`, la commande affiche cette ligne avant de démarrer ; en 0.24, le runtime s'arrête sur
« DATABASE_URL: is required ».

### `rebase apps list`

Afficher les applications déclarées par ce dépôt :

```bash
rebase apps list
```

Un dépôt peut déclarer plusieurs applications déployables — par exemple, un backend et un site marketing. C'est ainsi que vous voyez sur quoi `rebase build` et le déploiement vont agir.

### `rebase eject`

Prendre le contrôle du processus serveur et de son image :

```bash
rebase eject
```

Écrit le point d'entrée du backend et un `Dockerfile` dans le projet et bascule son backend, de sorte que le dépôt construit sa propre image au lieu d'exécuter le runtime publié. À partir de ce moment, **les mises à niveau du runtime de la plateforme ne l'atteignent plus**, et CORS, la configuration de l'authentification, le stockage et l'arrêt deviennent entièrement sous votre responsabilité.

Prévisualisez les modifications avec `rebase eject --dry-run`, qui liste ce qui changerait sans rien modifier. `--force` remplace un fichier `backend/src/index.ts` ou `env.ts` existant, en conservant le fichier actuel sous le nom `<name>.bak`.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Le serveur éjecté
conserve les téléversements locaux dans le dossier `uploads/` du projet, qu'il soit lancé depuis les sources ou compilé, comme
le fait `rebase dev`. Il s'exécute dans `backend/`, de sorte qu'un `STORAGE_PATH` relatif y
est lu depuis `backend/`. En 0.24, le serveur compilé utilise `backend/dist/uploads`,
que le build suivant supprime.

### `rebase schema generate`

Générer le schéma Drizzle ORM à partir de vos collections TypeScript :

```bash
rebase schema generate
```

Cela lit vos collections depuis `config/collections/` et génère `backend/src/schema.generated.ts` avec les définitions de tables Drizzle, les énumérations et les relations.

### `rebase schema stale`

```bash
rebase schema stale          # name what differs from the collections, exit 1 if anything does
rebase schema stale --fix    # regenerate backend/src/schema.generated.ts instead
```

`rebase dev` tient le fichier à jour tout seul : c'est donc la vérification pour un build
ou une étape de CI. Voir [Génération de schéma](/docs/cli/schema/#rebase-schema-stale).

### `rebase db`

```bash
rebase db push                 # apply the collections to the database (development)
rebase db generate             # write a SQL migration file
rebase db migrate              # apply the pending migrations
rebase db url                  # print the connection string this project uses
rebase db pull --from <url>    # copy another database into the local one
rebase db backup               # pg_dump; db backups list and db restore beside it
rebase db branch create <name> # a copy to work on; switch, list and prune it too
rebase db stop                 # stop the managed development database
rebase db reset                # delete it and start over
```

Chacune est décrite dans [Commandes de base de données](/docs/cli/database/), avec l'ordre dans lequel une
commande choisit sa base de données ; `push`, `generate` et `migrate` sont traitées
en détail dans [Génération de schéma](/docs/cli/schema/).

### `rebase console`

<span class="since-badge" data-since="0.25">Depuis 0.25</span>

Un REPL Node avec les données du projet ouvertes, ou un seul extrait exécuté avec `-e` :

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) et `collections` sont dans la
portée, et l'`await` de premier niveau fonctionne. La base de données est résolue comme la résout `rebase db push`,
et l'ouvrir n'y change rien. Avec `-e`, le résultat attendu (awaited)
est affiché en JSON sur stdout et une exception termine la commande avec le code `1`. Options : `--eval`/`-e`,
`--collections`/`-c`, `--database-url`, `--docker`. Voir
[Scripts et console](/docs/backend/scripts/).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` ne prend aucun nom : elle déduit chaque application du projet et écrit le
`rebase.json` entier, et refuse d'en remplacer un qui existe à moins que vous ne passiez
`--force`.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Un argument de nom est
refusé. `--force` conserve ce que l'inférence ne peut pas connaître depuis le fichier qu'elle remplace :
le nom de chaque application, son `path` et sa route `cms`. Tout le reste est
déduit à nouveau, et une application déclarée qu'elle ne retrouve plus est nommée comme retirée ; sur un
scaffold, elle réécrit donc le `rebase.json` que le scaffold fournissait. La commande de build de l'application
statique utilise le gestionnaire de paquets du projet. En 0.24, le nom est
ignoré, et `--force` écrit la simple inférence : l'application statique devient `web`,
compilée avec `npm run build --workspace frontend`.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Pour un
checkout non lié à un projet Cloud, `apps config` dit qu'il n'est pas lié,
que `rebase dev` tourne ou non, et donne l'URL du backend
telle que la sert `rebase dev`. En 0.24, elle affiche `http://localhost:3001`.

### `rebase status`

Tout ce que ce projet déclare, et si l'environnement le lie effectivement :

```bash
rebase status               # every resource, and the variables it reads
rebase status --json        # machine-readable
```

```
  backend  ·  managed  Rebase's runtime boots your bundle
  declared in  config/resources.ts
  configured by  .env

  buckets
  ✓ media  s3 · account:minio
      ✓ S3_BUCKET__MEDIA
      ✓ S3_ACCESS_KEY_ID__MINIO (shared, for S3_ACCESS_KEY_ID__MEDIA)
  ○ exports  s3
      · S3_BUCKET__EXPORTS not set
      └ declared, not configured — uploads here answer 501 STORAGE_SOURCE_NOT_CONFIGURED
```

Trois fichiers déterminent ce à quoi un backend peut accéder, et cette commande affiche les trois ensemble : `rebase.json` indique où se trouve votre code et qui exécute le serveur, `config/resources.ts` indique ce dont le projet a besoin, et l'environnement indique comment joindre chaque élément. Tout le reste — `rebase.resources.json`, le manifeste du bundle — est généré à partir de ce dernier pour les outils qui ne peuvent pas exécuter votre code, et vous ne l'écrivez jamais à la main.

Un `○` représente l'état qu'il vaut mieux connaître avant un déploiement plutôt qu'après : déclaré, non configuré. Un `✗` signifie que l'environnement configure quelque chose d'*incorrectement*, ce qui bloque le démarrage plutôt que de fonctionner en mode dégradé.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Un
`rebase.resources.json` qui ne correspond plus aux déclarations reçoit une ligne `○`.
Un fichier qui n'a pas encore été écrit n'en reçoit pas : `rebase build` l'écrit à chaque
exécution, si bien qu'un projet qui n'a jamais été compilé, comme un scaffold tout neuf, n'a
rien à corriger. En 0.24, le `status` de chaque nouveau projet se terminait par « is missing ».

### `rebase resources`

Ce dont ce projet déclare avoir besoin — les bases de données, buckets, topics et files d'attente demandés par son code de configuration, ainsi que les crons et fonctions définis par ses fichiers :

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` est l'option qu'utilise un job de CI pour échouer si `rebase.resources.json` ne correspond plus au code de configuration.
<span class="since-badge" data-since="0.25">Depuis 0.25</span> `--json` se combine
avec elle : en cas de dérive, `rebase resources --check --json` se termine avec le code 1 et une enveloppe
d'erreur (`resource_graph_missing` ou `resource_graph_stale`), et en cas de succès
le graphe porte `check.status`. `--write --json` écrit le fichier et signale
`written.changed`. En 0.24, `--json` affichait le graphe et ignorait ces deux options.

Une ressource est déclarée dans le code de configuration — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou correspond à un fichier situé sous `backend/crons` ou `backend/functions`, et n'est jamais écrite à la main dans `rebase.resources.json`, qui est généré à partir de ces déclarations afin qu'un hôte puisse lire ce dont un projet a besoin sans avoir à le compiler. Chaque entrée enregistre qui l'utilise (`collection:events`, `property:posts.cover`, `function:report`).

Un backend dispose également d'une base de données par défaut et d'une source de stockage par défaut que personne ne déclare. Toutes deux sont répertoriées ici avec la mention `implicit`, et aucune n'est écrite dans `rebase.resources.json` — l'hôte les fournit, donc les consigner reviendrait à demander le provisionnement de ressources que personne n'a sollicitées.
<span class="since-badge" data-since="0.25">Depuis 0.25</span> Déclarer une ressource nommée, comme `bucket("media")`, laisse la ressource par défaut en place : les deux sont donc listées. Seule la déclaration de la ressource par défaut elle-même, ou le marquage d'un bucket avec `default: true`, la remplace. En 0.24, la source de stockage par défaut disparaissait de `rebase status` et de `rebase resources` dès qu'un bucket était déclaré, alors que le serveur continuait de la servir.

Pour comparer ce que la plateforme détient pour un projet avec ce que son code déclare, et pour supprimer une base de données provisionnée que le code ne mentionne plus, consultez [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — toutes les commandes de Rebase Cloud : authentification, liaison de projet, déploiements, configuration, bases de données, ressources, calcul et plus — a [sa propre page](/docs/cli/cloud).

### `rebase generate-sdk`

Générer un SDK typé à partir de vos définitions de collections :

```bash
rebase generate-sdk
```

Crée les types TypeScript et un client sécurisé au niveau des types pour toutes vos collections.

`--register` type aussi les données côté serveur : il écrit les types et la déclaration `Register` dans `config/generated/`, et mémorise ce choix dans `rebase.json` (`registerDatabase`), de sorte que les exécutions suivantes, `rebase dev` et les nouveaux clones les maintiennent à jour. Voir [Données côté serveur typées](/docs/backend/typed-server-data).

### `rebase doctor`

```bash
rebase doctor
```

La commande à exécuter lorsque quelque chose ne va pas et que vous ne savez pas encore quoi. Elle génère un rapport et ne modifie jamais rien, elle est donc sans danger pour toute base de données accessible.

**Sans base de données.** Ces vérifications s'exécutent en premier, car tout ce qui empêche totalement un projet de fonctionner survient avant même qu'une table ne puisse être comparée :

| Vérification | Raison |
| --- | --- |
| Version de Node | Par rapport à la plage déclarée par la CLI. Une version trop ancienne n'est pas signalée comme "Node non pris en charge" — il s'agit d'une erreur de syntaxe au sein d'une dépendance. |
| Gestionnaires de paquets | Deux fichiers lockfile dans un même projet. Un `npm install` dans un workspace pnpm réorganise `node_modules` selon une structure incompatible avec pnpm, et le symptôme est un `Cannot find module` quelques heures plus tard. |
| Slugs en double | Le registre conserve la dernière collection enregistrée, l'autre n'est donc pas signalée comme manquante — c'est la dernière qui l'emporte et qui est servie, sous son propre nom. |
| Validité du `.env` | Un `JWT_SECRET` de moins de 32 caractères (avec lequel la production refuse de démarrer), et `NODE_ENV=production` sans `CORS_ORIGINS` ni `FRONTEND_URL`. Les valeurs ne sont jamais affichées. |
| Décalage de versions `@rebasepro/*` | Le même package fixé à des versions différentes dans les fichiers `package.json` du projet. Deux copies cassent les vérifications `instanceof` entre elles, ce qui provoque l'échec d'un garde de type rejetant son propre type. |
| Chaînes de connexion | Un `=` non encodé dans un paramètre d'URL, que les outils de PostgreSQL refusent de parser — ainsi, les sauvegardes et `psql` échouent alors que l'application continue de fonctionner. |
| Fonctions personnalisées | Ce dont chaque fonction a besoin de son hôte, et lesquelles ne s'exécuteraient pas sur un runtime edge. |

**Sur la base de données**, lorsque `DATABASE_URL` est définie :

| Vérification | Raison |
| --- | --- |
| Collections → schéma généré | Indique si `schema.generated.ts` est obsolète. |
| Collections → base de données | Tables, colonnes, énumérations, clés étrangères et tables de jonction manquantes. |
| Extensions requises | Une propriété `{ type: "vector" }` nécessite pgvector, que Rebase n'installe que lorsqu'un projet l'a déclaré. |
| Empreinte du schéma (Schema stamp) | Indique si cette base de données a été provisionnée à partir de ces collections. Il s'agit d'un hash, ce qui permet d'indiquer que les deux divergent, sans jamais pouvoir déterminer laquelle est en avance. |
| Collections → types du SDK | Indique si le SDK typé généré est obsolète. |
| Politiques RLS | Indique si les politiques de la base de données correspondent aux `securityRules` que vous avez déclarées, et si une politique fait référence à un rôle que ce serveur ne peut pas utiliser. |

Si la base de données est inaccessible, ses étapes sont signalées comme ignorées avec la raison correspondante et le reste s'exécute quand même — voir [Dépannage](/docs/troubleshooting/).

Renvoie un code de sortie non nul lorsqu'une vérification détecte une erreur, ou lorsqu'une étape n'a pas pu s'exécuter parce que la base de données fournie refuse les connexions. Une étape ignorée parce qu'aucune variable `DATABASE_URL` n'a été définie n'est pas considérée comme un échec.

`rebase doctor --policies` n'exécute que les vérifications RLS — pas de diff de schéma, pas de types de SDK — et échoue par défaut, ce qui en fait la forme idéale à utiliser comme barrière de contrôle en CI sur une base de données déployée.

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

`--scopes` nomme ce que la clé peut faire, séparé par des virgules ou répété ; `--full-access` lui donne toutes les portées que détient la clé de service sauf `keys:*`. `--roles` ajoute des rôles RLS à côté de `service`, `--expires-in` prend un nombre de jours et `--expires-at` une date ISO. `rebase api-keys scopes` liste toutes les portées que le backend connaît. Une clé n'est affichée qu'une seule fois.

Les clés ont une double barrière de contrôle : les portées de la clé ainsi que la sécurité au niveau des lignes (RLS) de l'identité sous laquelle elle agit s'appliquent toutes deux. Voir [Clés d'API](/docs/backend/api-keys/).

### `rebase storage`

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Maintenance de l'ensemble du stockage des fichiers, via le backend en cours d'exécution avec `REBASE_SERVICE_KEY` tirée de `.env` :

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lit chaque ligne de chaque collection, lignes supprimées logiquement comprises, et liste les fichiers d'une source (`--source`, la source par défaut si omis) qu'aucune chaîne d'aucune ligne ne nomme : une clé, une URL, une référence `rebase-storage:` dans un texte. Les fichiers plus récents que `--older-than` heures (24 par défaut) sont écartés, car le panneau d'administration téléverse un fichier avant d'enregistrer la ligne qui le nomme. `--delete` demande confirmation avant de supprimer (`--yes` passe la question, et est obligatoire sans terminal), le serveur retrouve d'abord les fichiers, et rien n'est supprimé tant qu'une collection ne peut pas être lue. Les fichiers que seules vos propres tables hors collections nomment paraissent inutilisés : vérifiez avant de supprimer.

`move` copie les fichiers placés sous `--prefix` vers une autre source sous les mêmes clés, une page à la fois. Un fichier que la cible détient déjà à la même taille est ignoré, si bien qu'un déplacement interrompu reprend en le relançant ; `--delete-source` supprime chaque fichier de la source dès que la cible le détient. Les deux exigent `database:read`, et la suppression ou le déplacement `database:write`, que détient la clé de service.

### `rebase skills install`

Installer les compétences (skills) de référence Rebase pour vos assistants de codage IA — chaque `--agent` mentionné ci-dessus :

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consultez [Compétences d'agent](/docs/ai/skills) pour la liste complète et l'emplacement où les fichiers sont écrits.

### `rebase telemetry`

Partage anonyme des données d'utilisation, désactivé tant que vous ne dites pas oui. Un `rebase init`
interactif pose la question à la fin, et l'invite répond non par défaut : rien n'est donc partagé à moins que vous ne
répondiez oui. La réponse vaut par machine (`~/.rebase/telemetry.json`) : après un oui,
`init` ne redemande plus jamais, et après un non, le prochain `init` redemande. Chaque
checkout reçoit un identifiant de projet aléatoire, conservé dans son
`.rebase/telemetry-project.json` ignoré par git. <span class="since-badge" data-since="0.25">Depuis 0.25</span>
En 0.24, l'invite répond oui par défaut, et l'identifiant de projet change à chaque redémarrage de
`rebase dev`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` affiche le paramètre actuel, `show` affiche exactement ce qui serait envoyé — que le partage soit activé ou non, afin que vous puissiez lire la charge utile (payload) avant de décider — et les deux autres permettent de le modifier. Si vous n'avez jamais exécuté `init`, rien n'a jamais été collecté.

## Prochaines étapes

- **[Génération de schéma](/docs/cli/schema/#production-workflow)** — Le workflow de migration, de la modification d'une collection à la production
- **[Le schéma en tant que code](/docs/architecture/schema-as-code)** — Comment fonctionne la génération de schéma
- **[Démarrage rapide](/docs/getting-started/quickstart)** — Pour bien commencer
