---
sourceHash: a3fccf5118b08dd0
title: Référence de la CLI
sidebar_label: CLI
description: Commandes de la CLI Rebase pour l'initialisation de projet, la génération de schéma, les migrations de base de données et la génération du SDK.
---

## Aperçu

La CLI Rebase (`rebase`) gère votre projet, de l'échafaudage au déploiement.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Ou utilisez-la via `pnpm dlx` :

```bash
pnpm dlx @rebasepro/cli <command>
```

## Sortie exploitable par une machine

<span class="since-badge" data-since="0.18">Since 0.18</span>

`--json` est l'interrupteur, et en dehors de la famille `cloud` c'est le seul :
`rebase status`, `rebase resources` et `rebase apps list` écrivent alors une
unique valeur JSON sur stdout — le résultat, ou une enveloppe
`{"error": {"message", "code", "hint", "issues"}}` avec un code de sortie non nul
— à **chaque** sortie de la commande, si bien qu'un appelant peut parser stdout
sans condition. Sans lui, elles écrivent du texte humain et les échecs partent
sur stderr. `rebase cloud` utilise la même enveloppe et constitue la seule
exception à l'interrupteur : elle active aussi le JSON d'elle-même quand stdout
n'est pas un TTY, ou quand `REBASE_JSON=1` est défini. Ainsi
`rebase cloud status | cat` est du JSON alors que `rebase status | cat` n'en est
pas — dans un script, passez `--json` explicitement plutôt que de vous fier à
l'une ou l'autre règle.

## Commandes

### `rebase init`

Initialisez un nouveau projet Rebase :

```bash
rebase init [directory]
```

Met en place la structure du projet avec les paquets frontend, backend et partagés.

| Flag | Effet |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Par défaut `blog` |
| `--headless` | Backend seul — pas de panneau d'administration ni de fichiers de collections. `--template` reste sans effet, car il n'y a aucune collection à semer |
| `-y, --yes` | N'affiche jamais d'invite. **Obligatoire partout où aucun terminal ne peut répondre**, comme en CI. Il saute `git init` et l'installation des dépendances — les valeurs interactives par défaut disent oui aux deux, passez donc `--git` / `--install` si vous les voulez |
| `-i, --install` | Installer les dépendances après l'échafaudage |
| `-g, --git` | Initialiser un dépôt et faire le premier commit |
| `--database-url <url>` | Utiliser une base existante plutôt que la base gérée |
| `--introspect` | Générer les collections à partir de cette base. Implique `--template blank` et exige `--install` |
| `--project <slug>` | Lier l'échafaudage à un projet Rebase Cloud |
| `--setup-key <key>` | La clé à usage unique qui authentifie ce lien |

### `rebase dev`

Démarrez le serveur de développement :

```bash
rebase dev
```

Démarre à la fois le frontend et le backend avec rechargement à chaud.

Les deux ports sont dérivés du chemin du projet, si bien que plusieurs projets
Rebase peuvent tourner côte à côte. Utilisez les URL qu'affiche `rebase dev`.
Fixez-en un avec `rebase dev --port 3001`.

### `rebase build`

Compilez le projet en un bundle déployable dans `dist-bundle/` :

```bash
rebase build
```

Le bundle est l'artefact que vous déployez — l'image du runtime le charge, il n'y
a donc aucune image applicative à construire vous-même. Flags utiles :

| Flag | Effet |
|------|--------|
| `--out <dir>` | Écrire le bundle ailleurs que dans `dist-bundle/` |
| `--vendor` | Toujours installer et embarquer les dépendances du bundle |
| `--no-vendor` | Ne jamais les embarquer ; le pod installe au premier démarrage |
| `--skip-type-check` | Sauter la vérification de types (plus rapide, moins sûr) |
| `--no-static` | Sauter la construction du frontend |

Les dépendances sont embarquées par défaut, pour qu'un redémarrage de pod ne paie
pas 35 à 55 secondes d'installation. Une arborescence qui dépasse 200 Mo sur
disque est abandonnée à la place, car la limite d'envoi est de 100 Mo compressés
— le raisonnement figure dans le changelog.

### `rebase start`

Exécutez le bundle compilé comme serveur de production :

```bash
rebase start
```

Lit `PORT` et le reste de `.env`, contrairement à `rebase dev`. Pointez-le vers un
bundle ailleurs avec `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Affichez les apps que ce dépôt déclare :

```bash
rebase apps list
```

Un dépôt peut déclarer plus d'une app déployable — un backend et un site vitrine,
par exemple. C'est ainsi que vous voyez sur quoi `rebase build` et le déploiement
vont agir.

### `rebase eject`

Prenez la main sur le processus serveur et sur son image :

```bash
rebase eject
```

Écrit le point d'entrée du backend et un `Dockerfile` dans le projet et bascule
son backend, de sorte que le dépôt construise sa propre image au lieu d'exécuter
le runtime publié. À partir de là, **les mises à niveau du runtime de la
plateforme ne l'atteignent plus**, et CORS, le câblage de l'authentification, le
stockage et l'arrêt deviennent à votre charge.

Prévisualisez-le avec `rebase eject --dry-run`, qui liste ce qui changerait sans
rien changer. `--force` remplace un `backend/src/index.ts` ou `env.ts` existant,
en conservant le fichier actuel sous `<name>.bak`.

### `rebase schema generate`

Générez le schéma Drizzle ORM à partir de vos collections TypeScript :

```bash
rebase schema generate
```

Cela lit vos collections depuis `config/collections/` et génère `backend/src/schema.generated.ts` avec les définitions de tables, les enums et les relations Drizzle.

### `rebase db push`

Poussez les changements de schéma directement vers la base (développement uniquement) :

```bash
rebase db push
```

:::caution
`db push` modifie la base directement, sans fichiers de migration. Utilisez `db generate` + `db migrate` en production.
:::

### `rebase db generate`

Générez des fichiers de migration SQL à partir des changements de schéma :

```bash
rebase db generate
```

Crée dans `drizzle/` des fichiers de migration horodatés, qui peuvent être relus et commités.

### `rebase db migrate`

Exécutez les migrations de base en attente :

```bash
rebase db migrate
```

Applique à la base toutes les migrations non appliquées.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` exécute `pg_dump` ; `restore` exécute `pg_restore` et est destructif, il
exige donc `--yes`. `--out` accepte un chemin local ou une URL de stockage objet,
et vaut par défaut `$BACKUP_DESTINATION` ou `./backups`.

### `rebase db pull`

Copiez une autre base dans la base de développement locale :

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` remplace les champs personnels au passage, de sorte qu'une copie de
production peut être travaillée en local sans emporter de vraies données clients
sur un portable.

`pg_dump` retire les privilèges : la copie arriverait donc avec les politiques
RLS de la source et sans aucun des grants qui les soutiennent — chaque lecture en
tant que `rebase_user` échouant sur `permission denied`. Le pull re-provisionne
ensuite le rôle applicatif, avec la routine qu'utilisent le démarrage et
`rebase db push`, de sorte que les tables internes de Rebase restent révoquées
comme il se doit.

La cible est toujours la base de développement locale de ce projet et ne peut pas
être choisie : `--database-url` est refusé plutôt qu'accepté, il n'y a donc aucun
moyen d'écrire « tirer vers la production ». `--from` est la seule direction.

### `rebase db url`

Affiche la chaîne de connexion qu'utilise ce projet, et rien d'autre, pour
qu'elle se prête aux tubes :

```bash
rebase db url
psql "$(rebase db url)"
```

La base de développement gérée est le cas qui en a besoin : `.env` laisse
`DATABASE_URL` commentée exprès, et le port est dérivé du chemin du projet, si
bien que rien sur disque ne le nomme. Lorsque vous avez défini votre propre
`DATABASE_URL`, c'est elle qui est affichée — l'ordre de résolution est celui que
suit toute autre commande. Elle démarre la base gérée si celle-ci ne tourne pas
déjà.

### `rebase db stop` / `rebase db reset`

Pour la base de développement gérée uniquement :

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

PostgreSQL ne copie ni ne supprime une base à laquelle quelque chose d'autre est
connecté, et ce « quelque chose d'autre » est d'ordinaire votre propre
`rebase dev`. `create` et `delete` nomment ce qui maintient la base ouverte ;
`--force` déconnecte d'abord ces sessions.

<span class="since-badge" data-since="0.18">Since 0.18</span> Chaque branche est une copie complète sur disque : il faut donc faire le ménage.
`prune` supprime trois choses : une entrée dont la base a été supprimée en dehors
de Rebase, une base de branche dont l'entrée n'a jamais été écrite, et — seulement
avec `--older-than` — les branches plus anciennes que l'âge que vous indiquez.
Elle demande confirmation avant toute suppression, sauf si vous passez `--yes`.

<span class="since-badge" data-since="0.18">Since 0.18</span> `switch` consigne la branche dans `.rebase/branch.json` et ne modifie jamais
`.env`. Elle l'emporte sur `DATABASE_URL` dans `.env` et cède devant
`--database-url` ou une `DATABASE_URL` du shell, si bien qu'un flag en ligne de
commande prime toujours sur un switch effectué plus tôt. Supprimer la branche sur
laquelle vous êtes vous ramène à la base principale, plutôt que de laisser le
checkout pointer vers une base qui n'existe plus.

:::note[Pas sur la base de développement gérée]
`push`, `generate` et `migrate` planifient leur travail avec Atlas, qui a besoin
d'une seconde base vide pour comparer — et le PGlite géré en sert exactement une.
Les lancer là s'arrête sur un message qui le dit. Pointez `DATABASE_URL` vers un
vrai PostgreSQL pour le flux de migrations ; `rebase dev` crée déjà les tables
manquantes de façon additive sur la base gérée.

`branch` y est refusé pour une raison voisine.
`CREATE DATABASE ... TEMPLATE` contre PGlite écrit une entrée de catalogue et ne
copie rien : la branche se résoudrait donc vers la base dont elle a été clonée —
chaque écriture que vous vouliez isoler atterrirait dans votre base de
développement. `rebase dev --docker` vous donne un vrai serveur contre lequel les
branches fonctionnent.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init <name>      # register a new app in rebase.json
rebase apps config <app>     # what one app resolves to
```

### `rebase status`

<span class="since-badge" data-since="0.18">Since 0.18</span>

Tout ce que ce projet déclare, et si l'environnement le relie réellement :

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

Trois fichiers décident de ce qu'un backend peut atteindre, et ceci les affiche
tous les trois ensemble : `rebase.json` dit où se trouve votre code et qui
exécute le serveur, `config/resources.ts` dit ce dont le projet a besoin, et
l'environnement dit comment atteindre chaque chose. Tout le reste —
`rebase.resources.json`, le manifeste du bundle — est généré à partir du fichier
du milieu pour des lecteurs qui ne peuvent pas exécuter votre code, et vous ne
l'écrivez jamais.

Un `○` est l'état qu'il vaut mieux connaître avant un déploiement qu'après :
déclaré, non configuré. Un `✗` signifie que l'environnement définit quelque chose
*de travers*, ce qui refuse le démarrage au lieu de se dégrader.

### `rebase resources`

Ce que ce projet déclare nécessiter — les bases, buckets, topics et files que son
code de configuration demande, et les crons et fonctions que ses fichiers
définissent :

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` est nouveau <span class="since-badge" data-since="0.18">Since 0.18</span> — le flag qu'un job de CI utilise pour échouer sur un `rebase.resources.json` qui
ne correspond plus au code de configuration.

Une ressource est déclarée dans le code de configuration —
`database("analytics")`, `bucket("media")`, `topic("signups")`,
`queue("thumbnails")` — ou bien c'est un fichier sous `backend/crons` ou
`backend/functions`, et elle n'est jamais écrite à la main dans
`rebase.resources.json`, qui est généré à partir de ces déclarations pour qu'un
hôte puisse lire ce dont un projet a besoin sans le construire. Chaque entrée
consigne qui l'utilise (`collection:events`, `property:posts.cover`,
`function:report`).

Un backend possède en outre une base par défaut et une source de stockage par
défaut que personne ne déclare. Toutes deux sont listées ici, marquées
`implicit`, et aucune n'est écrite dans `rebase.resources.json` — l'hôte les
fournit, donc les consigner reviendrait à demander le provisionnement de quelque
chose que personne n'a demandé.

Pour voir ce que la plateforme détient pour un projet face à ce que son code
déclare, et pour supprimer une base provisionnée que le code ne nomme plus, voir
`rebase cloud resources` ci-dessous.

### `rebase cloud`

Tout ce qui touche à Rebase Cloud, actuellement en bêta privée. Voir le
[guide Rebase Cloud](/docs/deployment/cloud/) pour savoir ce que c'est et ce que
la bêta n'inclut pas.

Chaque groupe répond à `--help`, et `--help` n'exécute jamais la commande. La
plupart des commandes agissent sur le projet lié dans `.rebase/cloud.json` ;
`--project <id>` agit sur un projet sans le lier.

Trois options s'appliquent partout : `--json` pour une sortie exploitable par une
machine (également la valeur par défaut dans un tube, ou avec `REBASE_JSON=1`),
`--url <origin>` pour viser un plan de contrôle précis (ou `REBASE_CLOUD_URL`),
et `--project, -p <id>`.

#### Authentification

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # show the current session
```

#### Lien du projet

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

#### Déployer et observer

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

`deploy` sans nom d'app déploie le backend.

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
rebase cloud db list | create | info | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

#### Ressources

Ce que la plateforme détient pour le projet, face à ce que son code déclare.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un déploiement ne supprime jamais une base provisionnée lorsque sa déclaration
disparaît — ce seraient des données effacées par un push. Elle est conservée,
reliée et facturée jusqu'à ce que quelqu'un la supprime nommément.

#### Compute

Ce que le projet réserve, et ce que cela coûte.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accepte `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` et `--no-autoscale`. Il
n'y a pas de paliers d'abonnement : tout est facturé à la ressource. Voir
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

Générez un SDK client typé à partir de vos définitions de collections :

```bash
rebase generate-sdk
```

Crée des types TypeScript et un client typé pour toutes vos collections.

### `rebase doctor`

```bash
rebase doctor
```

La commande à lancer quand quelque chose ne va pas et que vous ne savez pas
encore quoi. Elle rapporte et ne change jamais rien : elle est donc sans danger
sur n'importe quelle base que vous pouvez atteindre.

**Sans base de données.** Celles-ci passent en premier, parce que tout ce qui
empêche un projet de fonctionner du tout survient avant qu'une table puisse être
comparée :

| Vérification | Pourquoi |
| --- | --- |
| Version de Node | Face à la plage que déclare la CLI. Une version trop ancienne n'est pas signalée comme « Node non pris en charge » — c'est une erreur de syntaxe dans une dépendance. |
| Gestionnaires de paquets | Deux lockfiles dans un même projet. `npm install` dans un workspace pnpm réécrit `node_modules` selon une disposition que pnpm désapprouve, et le symptôme est un `Cannot find module` des heures plus tard. |
| Slugs en double | Le registre conserve la dernière collection enregistrée : l'autre n'est donc pas signalée manquante — elle est servie comme la gagnante, sous son propre nom. |
| Cohérence de `.env` | Un `JWT_SECRET` de moins de 32 caractères (sur lequel la production refuse de démarrer), et `NODE_ENV=production` sans `CORS_ORIGINS` ni `FRONTEND_URL`. Les valeurs ne sont jamais affichées. |
| Écart de versions `@rebasepro/*` | Le même paquet épinglé à des versions différentes entre les `package.json` du projet. Deux copies cassent `instanceof` entre elles, ce qui échoue comme un type guard rejetant son propre type. |
| Chaînes de connexion | Un `=` non encodé dans un paramètre d'URL, que les propres outils de PostgreSQL refusent de parser — les sauvegardes et `psql` cassent tandis que l'application continue de fonctionner. |
| Fonctions personnalisées | Ce dont chaque fonction a besoin de son hôte, et lesquelles ne tourneraient pas sur un runtime edge. |

**Sur la base de données**, lorsque `DATABASE_URL` est défini :

| Vérification | Pourquoi |
| --- | --- |
| Collections → schéma généré | Si `schema.generated.ts` est périmé. |
| Collections → base de données | Tables, colonnes, enums, clés étrangères et tables de jonction manquantes. |
| Extensions requises | Une propriété `{ type: "vector" }` a besoin de pgvector, que Rebase n'installe que là où un projet l'a déclaré. |
| Empreinte du schéma | Si cette base a été provisionnée à partir de ces collections. C'est un hachage : il peut dire que les deux divergent, jamais lequel est en avance. |
| Collections → types du SDK | Si le SDK typé généré est périmé. |
| Politiques RLS | Si les politiques de la base correspondent aux `securityRules` que vous avez déclarées, et si une politique nomme un rôle que ce serveur ne peut pas utiliser. |

Si la base est injoignable, ses phases sont rapportées comme ignorées avec la
raison et le reste s'exécute quand même — voir
[Dépannage](/docs/troubleshooting/).

Sort avec un code non nul lorsqu'une vérification trouve une erreur, ou lorsqu'une
phase n'a pas pu s'exécuter parce que la base qu'on lui a donnée refuse les
connexions. Une phase ignorée parce que vous n'avez défini aucun `DATABASE_URL`
n'est pas un échec.

`rebase doctor --policies` n'exécute que les vérifications RLS — pas de diff de
schéma, pas de types du SDK — et échoue en mode fermé, ce qui en fait la forme à
utiliser comme garde-fou de CI sur une base déployée.

### `rebase auth`

Commandes de gestion de l'authentification :

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gérez des clés d'API de service à portée limitée — l'identifiant qu'utilise un
agent, un script ou un autre service, par opposition à la session d'un
utilisateur final :

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` prend un tableau JSON d'objets `{ collection, operations }`, ou
utilisez `--full-access` pour lecture/écriture/suppression sur toutes les
collections et fonctions. `--expires` accepte `7d`, `30d`, `90d`, `1y` ou une
date ISO, et `--rate-limit` fixe le nombre de requêtes par fenêtre de 15 minutes.
Une clé n'est affichée qu'une fois, à sa création.

Les clés passent deux portes : les permissions de la clé elle-même et la sécurité
au niveau des lignes de l'identité pour laquelle elle agit s'appliquent toutes
deux, de sorte qu'une clé ne peut jamais lire plus que cette identité.

### `rebase skills install`

Installez les skills de référence Rebase pour votre assistant de code IA. Prend en
charge Cursor, Claude Code, Windsurf, Gemini CLI et Antigravity :

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Voir [Agent Skills](/docs/ai/skills) pour la liste complète et l'emplacement des fichiers écrits.

### `rebase telemetry`

Partage anonyme d'usage. **Sur adhésion, et désactivé tant que vous ne l'avez pas activé :**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` affiche le réglage courant, `show` affiche exactement ce qui serait
envoyé, et les deux autres le modifient. `rebase init` pose la question une fois ;
si vous n'avez jamais lancé `init`, rien n'a jamais été collecté.

## Flux de travail de migration

Le flux de travail habituel pour les changements de schéma :

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

## Prochaines étapes

- **[Schéma en tant que code](/docs/architecture/schema-as-code)** — Comment fonctionne la génération de schéma
- **[Démarrage rapide](/docs/getting-started/quickstart)** — Pour commencer
