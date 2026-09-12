---
sourceHash: 7fbdafd20900a251
title: Référence CLI
sidebar_label: CLI
description: Commandes de la CLI Rebase pour l'initialisation de projet, la génération de schéma, les migrations de base de données et la génération de SDK.
---

## Aperçu

La CLI Rebase (`rebase`) gère votre projet de l'échafaudage au déploiement.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Ou utilisez-la via `pnpm dlx` :

```bash
pnpm dlx @rebasepro/cli <command>
```

## Sortie lisible par une machine

`--json` est le commutateur, et en dehors de la famille `cloud`, c'est le seul : `rebase status`, `rebase resources` et `rebase apps list` placent alors une valeur JSON sur stdout — le résultat, ou une enveloppe `{"error": {"message", "code", "hint", "issues"}}` avec un code de sortie non nul — à **chaque** sortie de la commande, afin qu'un appelant puisse analyser stdout de manière inconditionnelle. Sans cela, elles écrivent du texte lisible par l'humain et les échecs vont vers stderr. `rebase cloud` utilise la même enveloppe et constitue la seule exception au commutateur : elle active également le JSON d'elle-même lorsque stdout n'est pas un TTY, ou lorsque `REBASE_JSON=1` est défini. Ainsi, `rebase cloud status | cat` produit du JSON tandis que `rebase status | cat` n'en produit pas — dans un script, passez explicitement `--json` plutôt que de vous fier à l'une de ces règles.

## Commandes

### `rebase init`

Initialiser un nouveau projet Rebase :

```bash
rebase init [directory]
```

Configure la structure du projet avec le frontend, le backend et les packages partagés.

| Option | Description |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Par défaut `blog` |
| `--headless` | Backend uniquement — aucun panneau d'administration ni fichiers de collections. `--template` n'a aucun effet, car il n'y a aucune collection à initialiser |
| `-y, --yes` | Ne jamais demander de confirmation. **Requis chaque fois qu'aucun terminal n'est disponible pour répondre**, comme en CI. Ignore git init et l'installation des dépendances — les valeurs interactives par défaut répondent oui aux deux, passez donc `--git` / `--install` si vous les souhaitez |
| `-i, --install` | Installer les dépendances après l'échafaudage |
| `-g, --git` | Initialiser un dépôt et créer le premier commit |
| `--database-url <url>` | Utiliser une base de données existante plutôt que la base gérée |
| `--introspect` | Générer des collections à partir de cette base de données. Implique `--template blank` et requiert `--install` |
| `--project <slug>` | Associer l'échafaudage à un projet Rebase Cloud |
| `--setup-key <key>` | Clé à usage unique authentifiant cette association |

### `rebase dev`

Démarrer le serveur de développement :

```bash
rebase dev
```

Démarre à la fois le frontend et le backend avec rechargement à chaud.

Les deux ports sont dérivés du chemin du projet afin que plusieurs projets Rebase puissent s'exécuter côte à côte. Utilisez les URL affichées par `rebase dev`. Fixez-en un avec `rebase dev --port 3001`.

### `rebase build`

Compiler le projet en un bundle déployable dans `dist-bundle/` :

```bash
rebase build
```

Le bundle est l'artefact que vous déployez — l'image du runtime le charge, il n'y a donc pas d'image applicative à construire vous-même. Options utiles :

| Option | Effet |
|------|--------|
| `--out <dir>` | Écrire le bundle ailleurs que dans `dist-bundle/` |
| `--vendor` | Toujours installer et embarquer les dépendances du bundle |
| `--no-vendor` | Ne jamais embarquer les dépendances ; le pod les installe au premier démarrage |
| `--skip-type-check` | Ignorer la vérification de type (plus rapide, moins sûr) |
| `--no-static` | Ignorer la compilation du frontend |

Les dépendances sont embarquées par défaut afin qu'un redémarrage de pod ne subisse pas une installation de 35 à 55 secondes. Une arborescence qui dépasse 200 Mo sur le disque est abandonnée à la place, car la limite de téléversement est de 100 Mo compressés — consultez le changelog pour en connaître les raisons.

### `rebase start`

Exécuter le bundle compilé en tant que serveur de production :

```bash
rebase start
```

Lit `PORT` et le reste du fichier `.env`, contrairement à `rebase dev`. Pointez-le vers un bundle situé ailleurs avec `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Afficher les applications déclarées par ce dépôt :

```bash
rebase apps list
```

Un dépôt peut déclarer plusieurs applications déployables — par exemple, un backend et un site marketing. C'est ainsi que vous voyez ce sur quoi `rebase build` et le déploiement vont agir.

### `rebase eject`

Prendre le contrôle du processus serveur et de son image :

```bash
rebase eject
```

Écrit le point d'entrée du backend et un `Dockerfile` dans le projet et bascule son backend, de sorte que le dépôt construit sa propre image au lieu d'exécuter le runtime publié. À partir de ce moment, **les mises à niveau du runtime de la plateforme ne l'affectent plus**, et la configuration des CORS, de l'authentification, du stockage et de l'arrêt vous revient.

Prévisualisez cela avec `rebase eject --dry-run`, qui liste ce qui changerait sans rien modifier. `--force` remplace un `backend/src/index.ts` ou un `env.ts` existant, en conservant le fichier actuel sous le nom `<name>.bak`.

### `rebase schema generate`

Générer le schéma Drizzle ORM à partir de vos collections TypeScript :

```bash
rebase schema generate
```

Cela lit vos collections depuis `config/collections/` et génère `backend/src/schema.generated.ts` avec les définitions de tables, enums et relations Drizzle.

### `rebase db push`

Pousser les modifications de schéma directement vers la base de données (développement uniquement) :

```bash
rebase db push
```

:::caution
`db push` modifie la base de données directement sans fichiers de migration. Utilisez `db generate` + `db migrate` pour la production.
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
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` exécute `pg_dump` ; `restore` exécute `pg_restore` et est destructif, il nécessite donc `--yes`. `--out` accepte un chemin local ou une URL de stockage objet, et a pour valeur par défaut `$BACKUP_DESTINATION` ou `./backups`.

### `rebase db pull`

Copier une autre base de données dans la base de développement locale :

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` remplace les champs personnels à l'importation, de sorte qu'une copie de production peut être manipulée localement sans transférer de véritables données clients sur un ordinateur portable.

`pg_dump` supprime les privilèges, de sorte que la copie arriverait avec les politiques RLS de la source et aucun des droits (grants) sous-jacents — chaque lecture en tant que `rebase_user` échouant avec `permission denied`. Le pull réattribue ensuite le rôle de l'application, en utilisant la même routine que le démarrage et `rebase db push`, afin que les tables internes de Rebase restent révoquées comme il se doit.

La cible est toujours la base de données de développement locale de ce projet et ne peut pas être choisie : `--database-url` est refusée plutôt qu'acceptée, il n'y a donc aucun moyen de demander un « pull en production ». `--from` est la seule direction.

### `rebase db url`

Afficher la chaîne de connexion utilisée par ce projet, et rien d'autre, pour faciliter le piping :

```bash
rebase db url
psql "$(rebase db url)"
```

La base de données de développement gérée est le cas qui en a besoin : `.env` laisse `DATABASE_URL` commentée à dessein, et le port est dérivé du chemin du projet, donc rien sur le disque ne la nomme. Lorsque vous avez défini votre propre `DATABASE_URL`, c'est ce qui s'affiche — l'ordre de résolution est le même que celui suivi par toutes les autres commandes. La commande démarre la base de données gérée si elle n'est pas déjà en cours d'exécution.

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

PostgreSQL ne copiera ni ne supprimera une base de données si quelque chose d'autre y est connecté, et ce « quelque chose d'autre » est généralement votre propre `rebase dev`. `create` et `delete` indiquent ce qui maintient la base de données ouverte ; `--force` déconnecte d'abord ces sessions.

Chaque branche est une copie complète sur le disque, elles doivent donc être nettoyées. `prune` supprime trois éléments : une entrée dont la base de données a été supprimée en dehors de Rebase, une base de données de branche dont l'entrée n'a jamais été écrite, et — uniquement avec `--older-than` — les branches ayant dépassé l'âge spécifié. La commande demande confirmation avant de supprimer quoi que ce soit, sauf si vous passez `--yes`.

`switch` enregistre la branche dans `.rebase/branch.json` et ne modifie jamais `.env`. Elle a priorité sur `DATABASE_URL` dans `.env` et s'efface devant `--database-url` ou une `DATABASE_URL` dans le shell, de sorte qu'une option sur la ligne de commande prévaut toujours sur un basculement précédent. Supprimer la branche sur laquelle vous vous trouvez vous ramène à la base de données principale plutôt que de laisser l'environnement pointer vers une base de données qui n'existe plus.

:::note[Pas sur la base de données de développement gérée]
`push`, `generate` et `migrate` planifient leur travail avec Atlas, qui a besoin d'une seconde base de données vide pour effectuer la comparaison — et l'instance gérée PGlite n'en fournit qu'une seule. Les exécuter dessus s'arrête avec un message explicatif. Pointez `DATABASE_URL` vers une véritable instance PostgreSQL pour le flux de travail de migration ; `rebase dev` crée déjà les tables manquantes de manière additive sur l'instance gérée.

`branch` y est refusé pour une raison similaire. `CREATE DATABASE ... TEMPLATE` sur PGlite écrit une entrée de catalogue et ne copie rien, la branche résoudrait donc vers la base de données dont elle a été clonée — chaque écriture que vous souhaitiez isoler atterrirait dans votre base de données de développement. `rebase dev --docker` vous fournit un véritable serveur compatible avec les branches.
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

Trois fichiers déterminent ce à quoi un backend peut accéder, et cette commande affiche les trois ensemble : `rebase.json` indique où se trouve votre code et qui exécute le serveur, `config/resources.ts` indique ce dont le projet a besoin, et l'environnement indique comment accéder à chaque élément. Tout le reste — `rebase.resources.json`, le manifeste du bundle — est généré à partir du deuxième fichier pour les outils qui ne peuvent pas exécuter votre code, et vous ne l'écrivez jamais à la main.

Un `○` représente l'état qu'il est utile de connaître avant un déploiement plutôt qu'après : déclaré, non configuré. Un `✗` signifie que l'environnement configure quelque chose de *manière incorrecte*, ce qui empêche le démarrage plutôt que de fonctionner en mode dégradé.

### `rebase resources`

Ce dont ce projet déclare avoir besoin — les bases de données, buckets, topics et files d'attente demandés par son code de configuration, ainsi que les crons et fonctions définis par ses fichiers :

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` est nouveau — l'option qu'un job CI utilise pour échouer si un fichier `rebase.resources.json` ne correspond plus au code de configuration.

Une ressource est déclarée dans le code de configuration — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou est un fichier sous `backend/crons` ou `backend/functions`, et n'est jamais écrite à la main dans `rebase.resources.json`, qui est généré à partir de ces déclarations afin qu'un hébergeur puisse lire ce dont un projet a besoin sans avoir à le construire. Chaque entrée enregistre qui l'utilise (`collection:events`, `property:posts.cover`, `function:report`).

Un backend possède également une base de données par défaut et une source de stockage par défaut que personne ne déclare. Les deux sont listées ici avec la mention `implicit`, et aucune n'est écrite dans `rebase.resources.json` — l'hébergeur les fournit, donc les enregistrer reviendrait à demander le provisionnement de quelque chose que personne n'a demandé.

Pour voir ce que la plateforme détient pour un projet par rapport à ce que son code déclare, et pour supprimer une base de données provisionnée que le code ne mentionne plus, consultez `rebase cloud resources` ci-dessous.

### `rebase cloud`

Tout ce qui concerne Rebase Cloud, actuellement en bêta privée. Consultez le [guide Rebase Cloud](/docs/deployment/cloud/) pour savoir de quoi il s'agit et ce que la bêta n'inclut pas.

Chaque groupe répond à `--help`, et `--help` n'exécute jamais la commande. La plupart des commandes agissent sur le projet lié dans `.rebase/cloud.json` ; `--project <id>` opère sur un projet sans liaison.

Trois options s'appliquent partout : `--json` pour une sortie lisible par une machine (également par défaut lors d'un pipe, ou avec `REBASE_JSON=1`), `--url <origin>` pour cibler un plan de contrôle spécifique (ou `REBASE_CLOUD_URL`), et `--project, -p <id>`.

#### Authentification

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # show the current session
```

#### Liaison de projet

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

#### Projets

```bash
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

#### Déploiement et observabilité

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud logs [--runtime] [-f]       # build logs, or the running process's
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` sans nom d'application déploie le backend.

#### Configuration

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add | verify | remove
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain
```

#### Organisations

```bash
rebase cloud orgs list | create | members
```

#### Bases de données

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` ouvre un port local qui *est* la base de données gérée (aucun point de terminaison public) jusqu'à Ctrl-C ; `--reveal` ajoute le mot de passe. Propriétaire ou administrateur uniquement.

#### Ressources

Ce que la plateforme détient pour le projet, par rapport à ce que son code déclare.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un déploiement ne supprime jamais une base de données provisionnée lorsque sa déclaration disparaît — ce serait des données supprimées par un push. Il la conserve, la lie et la facture jusqu'à ce que quelqu'un la nettoie explicitement par son nom.

#### Calcul (Compute)

Ce que le projet réserve, et ce que cela coûte.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` prend en charge `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` et `--no-autoscale`.
Il n'y a pas de niveaux de forfait : tout est facturé par ressource. Consultez
[Rebase Cloud](/docs/deployment/cloud/).

#### Stockage, webhooks, clusters et facturation

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
```

### `rebase generate-sdk`

Générer un SDK client typé à partir de vos définitions de collections :

```bash
rebase generate-sdk
```

Crée des types TypeScript et un client type-safe pour toutes vos collections.

### `rebase doctor`

```bash
rebase doctor
```

La commande à exécuter lorsque quelque chose ne va pas et que vous ne savez pas encore quoi. Elle génère un rapport et ne modifie jamais rien, elle peut donc être utilisée en toute sécurité sur n'importe quelle base de données accessible.

**Sans base de données.** Ces vérifications s'exécutent en premier, car tout ce qui empêche un projet de fonctionner se produit avant même qu'une table ne puisse être comparée :

| Vérification | Raison |
| --- | --- |
| Version de Node | Par rapport à la plage déclarée par la CLI. Une version trop ancienne n'est pas signalée comme « Node non pris en charge » — il s'agit d'une erreur de syntaxe à l'intérieur d'une dépendance. |
| Gestionnaires de paquets | Deux lockfiles dans un même projet. `npm install` dans un workspace pnpm réécrit `node_modules` selon une structure incompatible avec pnpm, et le symptôme est une erreur `Cannot find module` des heures plus tard. |
| Slugs en double | Le registre conserve la dernière collection enregistrée, l'autre n'est donc pas signalée comme manquante — elle est servie comme gagnante, sous son propre nom. |
| Validité de `.env` | Un `JWT_SECRET` de moins de 32 caractères (ce qui empêche le démarrage en production), et `NODE_ENV=production` sans `CORS_ORIGINS` ni `FRONTEND_URL`. Les valeurs ne sont jamais affichées. |
| Écart de versions `@rebasepro/*` | Le même package fixé à des versions différentes dans les fichiers `package.json` du projet. Deux copies brisent le `instanceof` entre elles, ce qui provoque l'échec d'un guard de type rejetant son propre type. |
| Chaînes de connexion | Un `=` non encodé dans un paramètre d'URL, que les outils propres à PostgreSQL refusent d'analyser — ainsi les sauvegardes et `psql` échouent tandis que l'application continue de fonctionner. |
| Fonctions personnalisées | Ce dont chaque fonction a besoin de son hébergeur, et lesquelles d'entre elles ne s'exécuteraient pas sur un runtime edge. |

**Sur la base de données**, lorsque `DATABASE_URL` est définie :

| Vérification | Raison |
| --- | --- |
| Collections → schéma généré | Indique si `schema.generated.ts` est obsolète. |
| Collections → base de données | Tables, colonnes, enums, clés étrangères et tables de jonction manquantes. |
| Extensions requises | Une propriété `{ type: "vector" }` nécessite pgvector, que Rebase n'installe que là où un projet l'a déclaré. |
| Empreinte du schéma | Indique si cette base de données a été provisionnée à partir de ces collections. Un hash, permettant d'indiquer si les deux diffèrent, sans jamais pouvoir préciser laquelle est en avance. |
| Collections → types du SDK | Indique si le SDK typé généré est obsolète. |
| Politiques RLS | Indique si les politiques de la base de données correspondent aux `securityRules` déclarées, et si une politique fait référence à un rôle que ce serveur ne peut pas utiliser. |

Si la base de données est inaccessible, ses phases sont signalées comme ignorées avec la raison correspondante et le reste s'exécute quand même — voir [Dépannage](/docs/troubleshooting/).

Se termine avec un code de sortie non nul lorsqu'une vérification détecte une erreur, ou lorsqu'une phase n'a pas pu s'exécuter parce que la base de données fournie refuse les connexions. Une phase ignorée parce que vous n'avez défini aucune `DATABASE_URL` n'est pas considérée comme un échec.

`rebase doctor --policies` n'exécute que les vérifications RLS — pas de diff de schéma, pas de types de SDK — et adopte une politique de rejet par défaut (fails closed), ce qui en fait la commande idéale à utiliser comme barrière CI sur une base de données déployée.

### `rebase auth`

Commandes de gestion de l'authentification :

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gérer les clés d'API de service délimitées — l'identifiant utilisé par un agent, un script ou un autre service, par opposition à la session d'un utilisateur final :

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` prend un tableau JSON d'objets `{ collection, operations }`, ou utilisez `--full-access` pour les droits lecture/écriture/suppression sur chaque collection et fonction. `--expires` accepte `7d`, `30d`, `90d`, `1y` ou une date ISO, et `--rate-limit` définit les requêtes par fenêtre de 15 minutes. Une clé n'est affichée qu'une seule fois, lors de sa création.

Les clés bénéficient d'un double contrôle : les autorisations propres à la clé et la sécurité au niveau des lignes de l'identité sous laquelle elle agit s'appliquent toutes deux, de sorte qu'une clé ne peut jamais lire plus que ce que cette identité autorise.

### `rebase skills install`

Installer les skills de référence Rebase pour votre assistant de code IA. Prend en charge Cursor, Claude Code, Windsurf, Gemini CLI et Antigravity :

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consultez [Agent Skills](/docs/ai/skills) pour la liste complète et l'emplacement où les fichiers sont écrits.

### `rebase telemetry`

Partage d'utilisation anonyme. **`rebase init` pose la question une fois par projet, et la confirmation répond oui par défaut — rien n'est envoyé tant que vous n'y avez pas répondu :**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` affiche la configuration actuelle, `show` affiche exactement ce qui serait envoyé — que le partage soit activé ou non, afin que vous puissiez lire la charge utile avant de décider — et les deux autres la modifient. Si vous n'avez jamais exécuté `init`, rien n'a jamais été collecté.

## Flux de travail des migrations

Le flux de travail type pour les modifications de schéma :

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration
rebase db generate

# 4. Review the generated SQL in drizzle/

# 5. Apply the migration
rebase db migrate
```

## Étapes suivantes

- **[Schema as Code](/docs/architecture/schema-as-code)** — Comment fonctionne la génération de schéma
- **[Quickstart](/docs/getting-started/quickstart)** — Démarrer

---
