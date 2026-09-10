---
sourceHash: 97dd0e836d51f599
title: Référence de la CLI
sidebar_label: CLI
description: Commandes de la CLI Rebase pour l'initialisation de projet, la génération de schémas, les migrations de base de données et la génération de SDK.
---

## Vue d'ensemble

La CLI Rebase (`rebase`) gère votre projet depuis l'échafaudage (scaffolding) initial jusqu'au déploiement.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Ou utilisez-la via `pnpm dlx` :

```bash
pnpm dlx @rebasepro/cli <command>
```

## Sortie lisible par une machine

`--json` est le modificateur, et en dehors de la famille `cloud`, c'est le seul : `rebase status`, `rebase resources` et `rebase apps list` écrivent alors une seule valeur JSON sur stdout — le résultat, ou une enveloppe `{"error": {"message", "code", "hint", "issues"}}` avec un code de sortie non nul — à **chaque** sortie de la commande, de sorte qu'un appelant puisse analyser stdout sans condition. Sans cette option, elles écrivent du texte lisible par un humain et les erreurs vont vers stderr. `rebase cloud` utilise la même enveloppe et constitue la seule exception : il active également automatiquement le JSON lorsque stdout n'est pas un TTY, ou lorsque `REBASE_JSON=1` est défini. Ainsi, `rebase cloud status | cat` renvoie du JSON alors que `rebase status | cat` n'en renvoie pas — dans un script, passez explicitement `--json` plutôt que de vous fier à l'une de ces règles.

## Commandes

### `rebase init`

Initialiser un nouveau projet Rebase :

```bash
rebase init [directory]
```

Met en place la structure du projet avec le frontend, le backend et les packages partagés.

| Option | Description |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Par défaut `blog` |
| `--headless` | Backend uniquement — aucun panneau d'administration et aucun fichier de collection. `--template` n'a aucun effet, car il n'y a aucune collection à initialiser |
| `-y, --yes` | Ne jamais demander de confirmation. **Requis chaque fois qu'aucun terminal n'est disponible pour répondre**, comme en CI. Ignore git init et l'installation des dépendances — les valeurs par défaut en mode interactif acceptent les deux, passez donc `--git` / `--install` si vous les souhaitez |
| `-i, --install` | Installer les dépendances après l'échafaudage |
| `-g, --git` | Initialiser un dépôt et créer le premier commit |
| `--database-url <url>` | Utiliser une base de données existante au lieu de la base gérée |
| `--introspect` | Générer des collections à partir de cette base de données. Implique `--template blank` et nécessite `--install` |
| `--project <slug>` | Lier le squelette généré à un projet Rebase Cloud |
| `--setup-key <key>` | La clé à usage unique authentifiant ce lien |

### `rebase dev`

Démarrer le serveur de développement :

```bash
rebase dev
```

Démarre à la fois le frontend et le backend avec rechargement à chaud (hot reloading).

Les deux ports sont dérivés du chemin du projet afin que plusieurs projets Rebase puissent s'exécuter côte à côte. Utilisez les URL affichées par `rebase dev`. Fixez-en un avec `rebase dev --port 3001`.

### `rebase build`

Compiler le projet sous la forme d'un bundle déployable dans `dist-bundle/` :

```bash
rebase build
```

Le bundle est l'artefact que vous déployez — l'image du runtime le charge, vous n'avez donc pas d'image applicative à construire vous-même. Options utiles :

| Option | Effet |
|------|--------|
| `--out <dir>` | Écrire le bundle à un autre emplacement que `dist-bundle/` |
| `--vendor` | Toujours installer et inclure les dépendances du bundle (vendoring) |
| `--no-vendor` | Ne jamais inclure les dépendances ; le pod les installe au premier démarrage |
| `--skip-type-check` | Ignorer la vérification des types (plus rapide, moins sûr) |
| `--no-static` | Ignorer la compilation du frontend |

Les dépendances sont incluses par défaut afin qu'un redémarrage de pod n'ait pas à subir une installation de 35 à 55 secondes. Une arborescence qui dépasse 200 Mo sur le disque est abandonnée à la place, car la limite de téléversement est de 100 Mo compressés — consultez le changelog pour en connaître la raison.

### `rebase start`

Exécuter le bundle compilé en tant que serveur de production :

```bash
rebase start
```

Lit `PORT` et le reste du fichier `.env`, contrairement à `rebase dev`. Pointez vers un bundle situé ailleurs avec `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Afficher les applications déclarées par ce dépôt :

```bash
rebase apps list
```

Un dépôt peut déclarer plusieurs applications déployables — par exemple, un backend et un site marketing. C'est ainsi que vous pouvez voir sur quoi `rebase build` et le déploiement vont agir.

### `rebase eject`

Prendre le contrôle du processus serveur et de son image :

```bash
rebase eject
```

Écrit le point d'entrée du backend et un `Dockerfile` dans le projet et bascule son backend, afin que le dépôt construise sa propre image au lieu d'exécuter le runtime publié. À partir de ce moment, **les mises à niveau du runtime de la plateforme ne lui sont plus appliquées**, et la gestion des CORS, de l'authentification, du stockage et de l'arrêt du serveur vous incombe entièrement.

Prévisualisez les changements avec `rebase eject --dry-run`, qui liste ce qui changerait sans rien modifier. `--force` remplace un fichier `backend/src/index.ts` ou `env.ts` existant, en conservant le fichier actuel sous le nom `<name>.bak`.

### `rebase schema generate`

Générer le schéma Drizzle ORM à partir de vos collections TypeScript :

```bash
rebase schema generate
```

Cette commande lit vos collections dans `config/collections/` et génère `backend/src/schema.generated.ts` avec les définitions de tables, les énumérations et les relations Drizzle.

### `rebase db push`

Pousser les modifications de schéma directement vers la base de données (développement uniquement) :

```bash
rebase db push
```

:::caution
`db push` modifie directement la base de données sans générer de fichiers de migration. Utilisez `db generate` + `db migrate` pour la production.
:::

### `rebase db generate`

Générer des fichiers de migration SQL à partir des modifications de schéma :

```bash
rebase db generate
```

Crée des fichiers de migration horodatés dans `drizzle/` qui peuvent être examinés et commités.

### `rebase db migrate`

Exécuter les migrations de base de données en attente :

```bash
rebase db migrate
```

Applique toutes les migrations non appliquées à la base de données.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # ou s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # lister ce qui est stocké
rebase db restore ./backups/<file>.dump --yes
```

`backup` exécute `pg_dump` ; `restore` exécute `pg_restore` et est destructeur, il nécessite donc `--yes`. `--out` accepte un chemin local ou une URL de stockage objet, et utilise par défaut `$BACKUP_DESTINATION` ou `./backups`.

### `rebase db pull`

Copier une autre base de données dans la base de données de développement locale :

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` remplace les champs personnels lors de l'import, afin qu'une copie de production puisse être exploitée localement sans transférer les vraies données clients sur un ordinateur portable.

`pg_dump` supprimant les privilèges, la copie arriverait avec les politiques RLS de la source sans les autorisations sous-jacentes — chaque lecture en tant que `rebase_user` échouerait avec une erreur `permission denied`. Le pull réassigne ensuite le rôle de l'application en utilisant la même routine que le démarrage et `rebase db push`, afin que les tables internes de Rebase restent révoquées comme prévu.

La cible est toujours la base de données de développement locale de ce projet et ne peut pas être choisie : `--database-url` est refusé au lieu d'être accepté, il n'y a donc aucun moyen de formuler un « pull vers la production ». `--from` est la seule direction possible.

### `rebase db url`

Afficher la chaîne de connexion utilisée par ce projet, et rien d'autre, afin de pouvoir la rediriger dans un pipe :

```bash
rebase db url
psql "$(rebase db url)"
```

La base de données de développement gérée est le cas qui nécessite cela : `.env` laisse `DATABASE_URL` commenté volontairement, et le port est dérivé du chemin du projet, de sorte que rien sur le disque ne la nomme explicitement. Lorsque vous avez configuré votre propre `DATABASE_URL`, c'est cette dernière qui est affichée — l'ordre de résolution est le même que celui suivi par toutes les autres commandes. La commande démarre la base de données gérée si elle n'est pas déjà en cours d'exécution.

### `rebase db stop` / `rebase db reset`

Pour la base de données de développement gérée uniquement :

```bash
rebase db stop     # l'arrêter ; les données sont conservées
rebase db reset    # la supprimer et repartir de zéro
```

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # travailler dessus ; toutes les commandes suivantes la ciblent
rebase db branch switch            # afficher la branche sur laquelle vous êtes
rebase db branch switch --off      # revenir à la base de données principale
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL ne copiera ni ne supprimera une base de données à laquelle un autre processus est connecté, et cet « autre processus » habituel est votre propre `rebase dev`. `create` et `delete` indiquent ce qui maintient la base de données ouverte ; `--force` déconnecte ces sessions au préalable.

Chaque branche est une copie complète sur le disque, elles doivent donc être nettoyées. `prune` supprime trois choses : une entrée dont la base de données a été supprimée en dehors de Rebase, une base de données de branche dont l'entrée n'a jamais été écrite, et — uniquement avec `--older-than` — les branches ayant dépassé un âge défini. La commande demande confirmation avant de supprimer quoi que ce soit, sauf si vous passez `--yes`.

`switch` enregistre la branche dans `.rebase/branch.json` et ne modifie jamais `.env`. Elle prévaut sur `DATABASE_URL` dans `.env` et s'efface devant `--database-url` ou un `DATABASE_URL` défini dans le shell, de sorte qu'une option en ligne de commande l'emporte toujours sur un basculement antérieur. La suppression de la branche active vous ramène à la base de données principale plutôt que de laisser l'environnement pointer vers une base de données disparue.

:::note[Non disponible sur la base de données de développement gérée]
`push`, `generate` et `migrate` planifient leur travail avec Atlas, qui a besoin d'une seconde base de données vide pour effectuer des comparaisons — or la base gérée PGlite n'en dessert qu'une seule. Les exécuter à cet endroit s'arrête avec un message explicatif. Pointez `DATABASE_URL` vers un vrai serveur PostgreSQL pour le flux de travail des migrations ; `rebase dev` crée déjà les tables manquantes de manière incrémentielle sur la base gérée.

`branch` est refusé ici pour une raison similaire. `CREATE DATABASE ... TEMPLATE` sur PGlite écrit une entrée de catalogue sans rien copier, de sorte que la branche se résoudrait vers la base dont elle a été clonée — chaque écriture censée être isolée atterrirait dans votre base de données de développement. `rebase dev --docker` vous fournit un véritable serveur compatible avec les branches.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # les applications déclarées par ce projet
rebase apps init <name>      # enregistrer une nouvelle application dans rebase.json
rebase apps config <app>     # ce vers quoi résout une application donnée
```

### `rebase status`

Tout ce que ce projet déclare, et si l'environnement le lie effectivement :

```bash
rebase status               # chaque ressource et les variables qu'elle lit
rebase status --json        # format lisible par une machine
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

Trois fichiers déterminent ce qu'un backend peut atteindre, et cette commande les affiche tous les trois ensemble :
`rebase.json` indique où se trouve votre code et qui exécute le serveur,
`config/resources.ts` indique ce dont le projet a besoin, et l'environnement indique comment
accéder à chaque élément. Tout le reste — `rebase.resources.json`, le manifeste
du bundle — est généré à partir du deuxième fichier pour les outils qui ne peuvent pas exécuter votre
code, et vous n'avez jamais à l'écrire à la main.

Un `○` représente l'état qu'il vaut mieux connaître avant un déploiement plutôt qu'après :
déclaré, non configuré. Un `✗` signifie que l'environnement configure quelque chose de *manière incorrecte*,
ce qui empêche le démarrage plutôt que de fonctionner en mode dégradé.

### `rebase resources`

Ce que ce projet déclare comme prérequis — les bases de données, buckets, topics et
files d'attente requis par sa configuration, ainsi que les tâches cron et fonctions définies par ses fichiers :

```bash
rebase resources            # les lister
rebase resources --write    # régénérer rebase.resources.json
rebase resources --check    # échouer si le graphe commité est obsolète
rebase resources --json     # format lisible par une machine
```

`rebase resources --check` est nouveau — c'est l'option qu'utilise un job de CI pour échouer
si `rebase.resources.json` ne correspond plus au code de configuration.

Une ressource est déclarée dans le code de configuration — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou correspond à un fichier
sous `backend/crons` ou `backend/functions`, et n'est jamais écrite à la main dans
`rebase.resources.json`. Ce dernier est généré à partir de ces déclarations afin qu'un hôte puisse
connaître les besoins du projet sans avoir à le compiler. Chaque entrée indique qui l'utilise
(`collection:events`, `property:posts.cover`, `function:report`).

Un backend possède également une base de données par défaut et une source de stockage par défaut que personne
ne déclare. Les deux sont listées ici avec la mention `implicit`, et aucune n'est écrite dans
`rebase.resources.json` — l'hôte les fournissant déjà, les consigner reviendrait à demander
le provisionnement d'un élément que personne n'a sollicité.

Pour comparer ce que la plateforme réserve pour un projet avec ce que son code déclare,
et pour supprimer une base de données provisionnée que le code ne mentionne plus, consultez
`rebase cloud resources` ci-dessous.

### `rebase cloud`

Tout ce qui concerne Rebase Cloud, qui est en version bêta privée. Consultez le
[guide Rebase Cloud](/docs/deployment/cloud/) pour savoir ce que c'est et ce que la version bêta
n'inclut pas.

Chaque groupe accepte `--help`, et `--help` n'exécute jamais la commande. La plupart des commandes
agissent sur le projet lié dans `.rebase/cloud.json` ; `--project <id>` opère sur
un projet spécifique sans liaison préalable.

Trois options s'appliquent partout : `--json` pour une sortie lisible par une machine (également
par défaut lors d'une redirection par pipe ou avec `REBASE_JSON=1`), `--url <origin>` pour cibler un
plan de contrôle spécifique (ou `REBASE_CLOUD_URL`), et `--project, -p <id>`.

#### Auth

```bash
rebase cloud login      # se connecter au plan de contrôle
rebase cloud logout     # se déconnecter
rebase cloud whoami     # afficher la session actuelle
```

#### Project link

```bash
rebase cloud link         # lier ce répertoire à un projet cloud
rebase cloud link [url]   # ou directement vers un backend : sans plan de contrôle, sans authentification, et le reste des commandes cloud sera refusé jusqu'à ce que vous déliiez
rebase cloud unlink       # supprimer le lien
rebase cloud use [org]    # sélectionner l'organisation active
rebase cloud open         # ouvrir le tableau de bord dans un navigateur
```

#### Projects

```bash
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

#### Deploy and observe

```bash
rebase cloud deploy [app] [--source .]   # déployer une application et diffuser les logs de build
rebase cloud logs [--runtime] [-f]       # logs de build, ou ceux du processus en cours d'exécution
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # revenir à un déploiement réussi
rebase cloud cancel [-y]                 # annuler le build en cours
rebase cloud start | stop | restart [-y] # stop et restart nécessitent -y
rebase cloud status                      # statut du projet en un coup d'œil
rebase cloud metrics                     # métriques en direct : CPU / mémoire / disque
rebase cloud debug [health|logs|…]       # diagnostiquer un déploiement, en lecture seule
```

`deploy` sans nom d'application déploie le backend.

#### Config

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add | verify | remove
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # nom, branche, dépôt, sous-domaine
```

#### Organizations

```bash
rebase cloud orgs list | create | members
```

#### Databases

```bash
rebase cloud db list | create | info | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

#### Resources

Ce que la plateforme détient pour le projet, par rapport à ce que son code déclare.

```bash
rebase cloud resources                       # chaque base de données et bucket : déclaré ? provisionné ?
rebase cloud resources prune database <key>  # supprimer une ressource que le code ne déclare plus
```

Un déploiement ne supprime jamais une base de données provisionnée lorsque sa déclaration disparaît — cela
reviendrait à supprimer des données lors d'un push. Elle est conservée, liée et facturée jusqu'à ce que
quelqu'un la purge explicitement par son nom.

#### Compute

Ce que le projet réserve, et ce que cela coûte.

```bash
rebase cloud compute            # la réservation actuelle et son coût mensuel
rebase cloud compute set        # modifier la réservation
```

`compute set` accepte `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` et `--no-autoscale`.
Il n'y a pas de niveaux d'abonnements : tout est tarifié par ressource. Consultez
[Rebase Cloud](/docs/deployment/cloud/).

#### Storage, webhooks, clusters and billing

```bash
rebase cloud storage             # lister les buckets de stockage
rebase cloud storage create      # provisionner un stockage géré par la plateforme
rebase cloud storage attach      # attacher votre propre bucket compatible S3
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # les clusters sur lesquels tournent les tenants ; `add` en enregistre un depuis un kubeconfig
rebase cloud billing             # le compte de facturation et la carte enregistrée
rebase cloud billing setup       # associer une carte, usage unique, ouvre un navigateur
rebase cloud billing checkout    # une session Stripe pour un projet
```

### `rebase generate-sdk`

Générer un SDK client typé à partir des définitions de vos collections :

```bash
rebase generate-sdk
```

Crée les types TypeScript et un client sécurisé au niveau du typage (type-safe) pour toutes vos collections.

### `rebase doctor`

```bash
rebase doctor
```

La commande à exécuter quand un dysfonctionnement survient et que vous n'en connaissez pas encore l'origine. Elle
signale les problèmes sans jamais rien modifier, ce qui la rend sûre pour n'importe quelle base de données
accessible.

**Sans base de données.** Ces vérifications s'exécutent en premier, car tout ce qui empêche totalement
un projet de fonctionner survient avant même qu'une table puisse être comparée :

| Vérification | Raison |
| --- | --- |
| Version de Node | Comparée à la plage déclarée par la CLI. Une version trop ancienne n'est pas signalée par « Node non supporté » — elle se manifeste par une erreur de syntaxe au sein d'une dépendance. |
| Gestionnaires de paquets | Deux lockfiles dans un même projet. Un `npm install` dans un workspace pnpm réorganise `node_modules` dans une structure incompatible avec pnpm, entraînant des erreurs `Cannot find module` des heures plus tard. |
| Slugs en double | Le registre ne conserve que la dernière collection enregistrée, la précédente n'est donc pas signalée manquante — c'est la gagnante qui est servie, sous son propre nom. |
| Cohérence du `.env` | Un `JWT_SECRET` de moins de 32 caractères (ce qui bloque le démarrage en production), et `NODE_ENV=production` sans `CORS_ORIGINS` ni `FRONTEND_URL`. Les valeurs ne sont jamais affichées. |
| Décalage de version `@rebasepro/*` | Le même package verrouillé sur des versions différentes à travers les fichiers `package.json` du projet. Deux copies brisent le fonctionnement de `instanceof` entre elles, agissant comme un type guard rejetant son propre type. |
| Chaînes de connexion | Un `=` non encodé dans un paramètre d'URL, que les outils de PostgreSQL refusent d'analyser — ce qui fait planter les sauvegardes et `psql` alors que l'application continue de fonctionner. |
| Fonctions personnalisées | Ce dont chaque fonction a besoin de son hôte, et lesquelles d'entre elles ne fonctionneraient pas sur un runtime edge. |

**Sur la base de données**, quand `DATABASE_URL` est défini :

| Vérification | Raison |
| --- | --- |
| Collections → schéma généré | Vérifie si `schema.generated.ts` est obsolète. |
| Collections → base de données | Tables, colonnes, énumérations, clés étrangères et tables de jonction manquantes. |
| Extensions requises | Une propriété `{ type: "vector" }` nécessite pgvector, que Rebase installe uniquement là où un projet l'a déclaré. |
| Empreinte du schéma (Schema stamp) | Vérifie si cette base de données a été provisionnée à partir de ces collections. Un hash, qui permet d'indiquer si les deux diffèrent, sans pouvoir préciser laquelle est en avance. |
| Collections → types SDK | Vérifie si le SDK typé généré est obsolète. |
| Politiques RLS | Vérifie si les politiques de la base de données correspondent aux `securityRules` déclarées, et si une politique nomme un rôle que ce serveur ne peut pas utiliser. |

Si la base de données est inaccessible, ses étapes sont indiquées comme ignorées avec la
raison correspondante et le reste s'exécute quand même — voir [Dépannage](/docs/troubleshooting/).

Retourne un code de sortie non nul lorsqu'une vérification détecte une erreur, ou lorsqu'une étape n'a pas pu s'exécuter
parce que la base de données fournie refuse les connexions. Une étape ignorée parce que
vous n'avez défini aucune variable `DATABASE_URL` n'est pas considérée comme un échec.

`rebase doctor --policies` exécute uniquement les vérifications RLS — sans diff de schéma ni
types SDK — et adopte une politique de refus par défaut (fail-closed), ce qui en fait la variante idéale à utiliser comme validation en CI vis-à-vis d'une base de données déployée.

### `rebase auth`

Commandes de gestion de l'authentification :

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gérer les clés d'API de service restreintes — les identifiants utilisés par un agent, un script ou un autre
service, par opposition à la session d'un utilisateur final :

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` prend un tableau JSON d'objets `{ collection, operations }`, ou utilisez
`--full-access` pour un accès en lecture/écriture/suppression sur l'ensemble des collections et fonctions. `--expires`
accepte `7d`, `30d`, `90d`, `1y` ou une date ISO, et `--rate-limit` définit le nombre de requêtes
par fenêtre de 15 minutes. Une clé n'est affichée qu'une seule fois, au moment de sa création.

Les clés sont soumises à un double contrôle : les permissions propres à la clé et la sécurité au niveau des lignes (RLS) de l'identité
qu'elle incarne s'appliquent toutes les deux, garantissant qu'une clé ne peut jamais lire plus de données que cette identité n'y est autorisée.

### `rebase skills install`

Installer les compétences de référence Rebase pour votre assistant de programmation IA. Prend en charge
Cursor, Claude Code, Windsurf, Gemini CLI et Antigravity :

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consultez [Agent Skills](/docs/ai/skills) pour la liste complète et l'emplacement où les fichiers sont écrits.

### `rebase telemetry`

Partage anonyme des données d'utilisation. **`rebase init` pose la question une fois par projet, et l'invite
est acceptée par défaut — rien n'est envoyé à moins que vous ne validiez :**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` affiche la configuration actuelle, `show` détaille exactement ce qui serait envoyé —
que le partage soit activé ou non, afin que vous puissiez examiner le contenu des données avant de décider — et
les deux autres options permettent de modifier ce réglage. Si vous n'avez jamais exécuté `init`, aucune donnée n'a jamais été collectée.

## Flux de travail des migrations

Le cycle de travail classique pour les modifications de schéma :

```bash
# 1. Modifiez votre collection dans config/collections/
# 2. Générez le schéma Drizzle
rebase schema generate

# 3. Générez la migration SQL
rebase db generate

# 4. Examinez le code SQL généré dans drizzle/

# 5. Appliquez la migration
rebase db migrate
```

## Prochaines étapes

- **[Schéma as Code](/docs/architecture/schema-as-code)** — Fonctionnement de la génération de schémas
- **[Démarrage rapide](/docs/getting-started/quickstart)** — Premiers pas avec la plateforme

---
