---
sourceHash: a255412fa1737b59
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
| `-i, --install` | Installer les dépendances après l'échafaudage |
| `-g, --git` | Initialiser un dépôt et créer le premier commit |
| `--database-url <url>` | Utiliser une base de données existante au lieu de la base gérée |
| `--introspect` | Générer les collections à partir de cette base de données. Implique `--template blank` et requiert `--install` |
| `--project <slug>` | Lier le projet généré à un projet Rebase Cloud |
| `--setup-key <key>` | La clé à usage unique authentifiant cette liaison |
| `-a, --agent <name>` | Configurer les agents de codage IA : les [skills](/docs/ai/skills) et le [serveur MCP](/docs/ai/mcp). Répétable ou séparé par des virgules — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` ou `all`. Sans cette option, `init` demande et pré-coche les agents installés sur la machine ; avec `--yes`, aucun |

### `rebase dev`

Démarrer le serveur de développement :

```bash
rebase dev
```

Démarre à la fois le frontend et le backend avec le rechargement à chaud (hot reloading), et régénère le schéma Drizzle ainsi que les types du SDK (`generated/sdk/`) au démarrage et à chaque enregistrement d'une collection. pour les types du SDK — sur la 0.23 elle ne régénère que le schéma, et `rebase generate-sdk` est à votre charge.

Les deux ports sont dérivés du chemin du projet afin que plusieurs projets Rebase puissent s'exécuter côte à côte. Utilisez les URL affichées par `rebase dev`. Fixez-en un avec `rebase dev --port 3001`.

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

### `rebase schema generate`

Générer le schéma Drizzle ORM à partir de vos collections TypeScript :

```bash
rebase schema generate
```

Cela lit vos collections depuis `config/collections/` et génère `backend/src/schema.generated.ts` avec les définitions de tables Drizzle, les énumérations et les relations.

### `rebase db push`

Pousser directement les modifications de schéma vers la base de données (développement uniquement) :

```bash
rebase db push
```

:::caution
`db push` modifie directement la base de données sans fichiers de migration. Utilisez `db generate` + `db migrate` pour la production.
:::

### `rebase db generate`

Générer des fichiers de migration SQL à partir des modifications de schéma :

```bash
rebase db generate
```

Crée des fichiers de migration horodatés dans `drizzle/migrations/` qui peuvent être vérifiés et commités.

### `rebase db migrate`

Exécuter les migrations de base de données en attente :

```bash
rebase db migrate
```

Applique toutes les migrations non appliquées à la base de données.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` exécute `pg_dump` ; `restore` exécute `pg_restore` et, étant destructeur, nécessite `--yes`.
La planification, le fichier des rôles qui accompagne chaque sauvegarde, et la procédure de
restauration sont décrits dans [Sauvegardes et restauration](/docs/deployment/backups/).

### `rebase db pull`

Copier une autre base de données dans la base de développement locale :

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` remplace les champs personnels lors de l'import, afin qu'une copie de production puisse être exploitée localement sans transférer de réelles données client sur un ordinateur portable.

`pg_dump` supprime les privilèges, de sorte que la copie arriverait avec les politiques RLS de la source et aucun des droits d'accès (grants) sous-jacents — chaque lecture en tant que `rebase_user` échouant avec `permission denied`. Le pull réattribue ensuite le rôle de l'application, en utilisant la même routine que le démarrage et `rebase db push`, afin que les tables internes de Rebase restent révoquées comme il se doit.

La cible est toujours la base de données de développement locale de ce projet et ne peut pas être choisie : `--database-url` est refusé plutôt qu'accepté, il n'y a donc aucun moyen de spécifier "pull vers la production". `--from` est la seule direction possible.

### `rebase db url`

Afficher la chaîne de connexion utilisée par ce projet, et rien d'autre, pour pouvoir l'utiliser dans un pipe :

```bash
rebase db url
psql "$(rebase db url)"
```

La base de données de développement gérée est le cas d'usage qui nécessite cela : `.env` laisse volontairement `DATABASE_URL` commentée, et le port est dérivé du chemin du projet, de sorte que rien sur le disque ne la mentionne. Lorsque vous avez défini votre propre `DATABASE_URL`, c'est ce qui s'affiche — l'ordre de résolution est le même que celui suivi par toutes les autres commandes. La commande démarre la base de données gérée si elle n'est pas déjà en cours d'exécution.

### `rebase db stop` / `rebase db reset`

Pour la base de données de développement gérée uniquement :

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # work on it; every later command follows
rebase db branch switch            # say which branch you are on
rebase db branch switch --off      # back to the main database
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL ne copiera ni ne supprimera une base de données à laquelle d'autres processus sont connectés, et cet « autre processus » est généralement votre propre `rebase dev`. `create` et `delete` indiquent ce qui maintient la base de données ouverte ; `--force` déconnecte ces sessions au préalable.

Chaque branche est une copie complète sur le disque, elles doivent donc être nettoyées. `prune` supprime trois éléments : une entrée dont la base de données a été supprimée en dehors de Rebase, une base de données de branche dont l'entrée n'a jamais été écrite, et — uniquement avec `--older-than` — les branches ayant dépassé l'ancienneté indiquée. La commande demande confirmation avant de supprimer quoi que ce soit, sauf si vous passez `--yes`.

`switch` enregistre la branche dans `.rebase/branch.json` et ne modifie jamais `.env`. Elle a la priorité sur `DATABASE_URL` dans `.env` et s'efface devant `--database-url` ou un `DATABASE_URL` dans le shell, de sorte qu'une option sur la ligne de commande prévaut toujours sur un basculement effectué précédemment. La suppression de la branche sur laquelle vous vous trouvez vous ramène à la base de données principale plutôt que de laisser le projet pointé sur une base de données disparue.

:::note[Sur la base de données de développement gérée]
<span class="since-badge" data-since="0.25">Depuis 0.25</span> `push`, `generate` et `migrate` planifient leur travail avec Atlas, qui a besoin d'une seconde base de données vide pour effectuer la comparaison — et l'instance PGlite gérée n'en fournit qu'une seule. Sur la base gérée, chacune d'elles démarre donc, pour Atlas, un second PGlite jetable en mémoire, et l'arrête à la fin de la commande. C'est ainsi qu'une colonne y est supprimée, renommée ou rétrécie : `rebase dev` ne fait qu'ajouter. Le garde-fou destructif est le même qu'ailleurs. Pour qu'Atlas planifie plutôt contre une base vide qui est la vôtre, définissez `REBASE_ATLAS_DEV_URL` sur celle-ci ; Rebase ne crée ni ne supprime une base de données nommée de cette façon.

`branch` y est refusé. `CREATE DATABASE ... TEMPLATE` avec PGlite écrit une entrée dans le catalogue et ne copie rien, de sorte que la branche pointerait vers la base de données dont elle a été clonée — chaque écriture que vous souhaitiez isoler atterrirait dans votre base de données de développement. `rebase dev --docker` vous fournit un véritable serveur avec lequel les branches fonctionnent.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init <name>      # register a new app in rebase.json
rebase apps config <app>     # what one app resolves to
```

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

### `rebase resources`

Ce dont ce projet déclare avoir besoin — les bases de données, buckets, topics et files d'attente demandés par son code de configuration, ainsi que les crons et fonctions définis par ses fichiers :

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` est nouveau — l'option utilisée par un job de CI pour échouer si `rebase.resources.json` ne correspond plus au code de configuration.

Une ressource est déclarée dans le code de configuration — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou correspond à un fichier situé sous `backend/crons` ou `backend/functions`, et n'est jamais écrite à la main dans `rebase.resources.json`, qui est généré à partir de ces déclarations afin qu'un hôte puisse lire ce dont un projet a besoin sans avoir à le compiler. Chaque entrée enregistre qui l'utilise (`collection:events`, `property:posts.cover`, `function:report`).

Un backend dispose également d'une base de données par défaut et d'une source de stockage par défaut que personne ne déclare. Toutes deux sont répertoriées ici avec la mention `implicit`, et aucune n'est écrite dans `rebase.resources.json` — l'hôte les fournit, donc les consigner reviendrait à demander le provisionnement de ressources que personne n'a sollicitées.

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

Partage anonyme des données d'utilisation. **`rebase init` pose la question une fois par projet, et l'invite répond oui par défaut — rien n'est envoyé tant que vous n'y avez pas répondu :**

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
