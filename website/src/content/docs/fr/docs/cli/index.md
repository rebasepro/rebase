---
sourceHash: 27723fe81b7fd939
title: Référence CLI
sidebar_label: CLI
description: Commandes de la CLI Rebase pour l'initialisation de projet, la génération de schéma, les migrations de base de données et la génération de SDK.
---

## Vue d'ensemble

La CLI Rebase (`rebase`) gère votre projet depuis l'échafaudage (scaffolding) jusqu'au déploiement.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Ou utilisez-la via `pnpm dlx` :

```bash
pnpm dlx @rebasepro/cli <command>
```

## Sortie lisible par une machine

`--json` est le modificateur, et en dehors de la famille `cloud`, c'est le seul : `rebase status`, `rebase resources` et `rebase apps list` écrivent alors une valeur JSON unique sur stdout — le résultat, ou une enveloppe `{"error": {"message", "code", "hint", "issues"}}` avec un code de sortie différent de zéro — à **chaque** sortie de commande, permettant ainsi à un appelant de parser stdout inconditionnellement. Sans cette option, ils écrivent du texte lisible par un humain et les erreurs vont vers stderr. `rebase cloud` utilise la même enveloppe et constitue la seule exception au modificateur : il active également le JSON de lui-même lorsque stdout n'est pas un TTY, ou lorsque `REBASE_JSON=1` est défini. Ainsi, `rebase cloud status | cat` produit du JSON tandis que `rebase status | cat` n'en produit pas — dans un script, passez explicitement `--json` plutôt que de vous fier à l'une ou l'autre règle.

## Commandes

### `rebase init`

Initialise un nouveau projet Rebase :

```bash
rebase init [directory]
```

Configure la structure du projet avec le frontend, le backend et les packages partagés.

| Option (Flag) | Description |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` ou `blank`. Par défaut `blog` |
| `--headless` | Backend uniquement — aucun panneau d'administration ni fichier de collections. `--template` n'a aucun effet, car il n'y a aucune collection à initialiser |
| `-y, --yes` | Ne jamais demander confirmation. **Requis partout où aucun terminal ne peut répondre**, comme en CI. Cela ignore l'initialisation de git et l'installation des dépendances — les valeurs par défaut interactives répondent oui aux deux, passez donc `--git` / `--install` si vous les souhaitez |
| `-i, --install` | Installe les dépendances après l'échafaudage |
| `-g, --git` | Initialise un dépôt et effectue le premier commit |
| `--database-url <url>` | Utilise une base de données existante au lieu de la base gérée |
| `--introspect` | Génère les collections à partir de cette base de données. Implique `--template blank` et nécessite `--install` |
| `--project <slug>` | Lie l'échafaudage à un projet Rebase Cloud |
| `--setup-key <key>` | La clé à usage unique authentifiant cette liaison |

### `rebase dev`

Démarre le serveur de développement :

```bash
rebase dev
```

Démarre à la fois le frontend et le backend avec rechargement à chaud (hot reloading).

Les deux ports sont dérivés du chemin du projet afin que plusieurs projets Rebase puissent s'exécuter côte à côte. Utilisez les URLs affichées par `rebase dev`. Figez-en un avec `rebase dev --port 3001`.

### `rebase build`

Compile le projet dans un bundle déployable dans `dist-bundle/` :

```bash
rebase build
```

Le bundle est l'artefact que vous déployez — l'image du runtime le charge, il n'y a donc pas d'image applicative à construire vous-même. Options utiles :

| Option (Flag) | Effet |
|------|--------|
| `--out <dir>` | Écrit le bundle ailleurs que dans `dist-bundle/` |
| `--vendor` | Installe et embarque toujours les dépendances du bundle |
| `--no-vendor` | N'embarque jamais les dépendances ; le pod les installe au premier démarrage |
| `--skip-type-check` | Ignore la vérification des types (plus rapide, moins sûr) |
| `--no-static` | Ignore la compilation du frontend |

Les dépendances sont embarquées par défaut afin d'éviter qu'un redémarrage de pod ne subisse une installation de 35 à 55 secondes. Une arborescence qui dépasse 200 Mo sur le disque est abandonnée à la place, car la limite de téléversement est de 100 Mo compressés — consultez le changelog pour en connaître la raison.

### `rebase start`

Exécute le bundle compilé en tant que serveur de production :

```bash
rebase start
```

Lit `PORT` et le reste du fichier `.env`, contrairement à `rebase dev`. Pointez-le vers un bundle situé ailleurs avec `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Affiche les applications déclarées par ce dépôt :

```bash
rebase apps list
```

Un dépôt peut déclarer plus d'une application déployable — un backend et un site marketing, par exemple. C'est ainsi que vous pouvez voir sur quoi `rebase build` et le déploiement agiront.

### `rebase eject`

Prenez le contrôle total du processus serveur et de son image :

```bash
rebase eject
```

Écrit le point d'entrée du backend et un `Dockerfile` dans le projet et bascule son backend, de sorte que le dépôt construise sa propre image au lieu d'exécuter le runtime publié. Dès lors, **les mises à niveau du runtime de la plateforme ne l'atteignent plus**, et la configuration des CORS, de l'authentification, du stockage et de l'arrêt du serveur vous incombe entièrement.

Prévisualisez les changements avec `rebase eject --dry-run`, qui liste ce qui changerait sans rien modifier. `--force` remplace un fichier `backend/src/index.ts` ou `env.ts` existant, en conservant le fichier actuel sous la forme `<nom>.bak`.

### `rebase schema generate`

Génère le schéma Drizzle ORM à partir de vos collections TypeScript :

```bash
rebase schema generate
```

Cette commande lit vos collections dans `config/collections/` et génère `backend/src/schema.generated.ts` avec les définitions de tables Drizzle, les énumérations et les relations.

### `rebase db push`

Pousse les modifications de schéma directement vers la base de données (développement uniquement) :

```bash
rebase db push
```

:::caution
`db push` modifie directement la base de données sans fichiers de migration. Utilisez `db generate` + `db migrate` pour la production.
:::

### `rebase db generate`

Génère des fichiers de migration SQL à partir des modifications de schéma :

```bash
rebase db generate
```

Crée des fichiers de migration horodatés dans `drizzle/` qui peuvent être revus et commités.

### `rebase db migrate`

Exécute les migrations de base de données en attente :

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

`backup` exécute `pg_dump` ; `restore` exécute `pg_restore` et est destructeur, il requiert donc `--yes`. `--out` accepte un chemin local ou une URL de stockage objet (object storage), et utilise par défaut `$BACKUP_DESTINATION` ou `./backups`.

### `rebase db pull`

Copie une autre base de données dans la base de données de développement locale :

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` remplace les champs personnels lors de l'import, de sorte qu'une copie de production puisse être manipulée localement sans transférer de réelles données clients sur un ordinateur portable.

`pg_dump` supprime les privilèges ; la copie arriverait donc avec les politiques RLS de la source sans aucun des droits (grants) sous-jacents — chaque lecture en tant que `rebase_user` échouant avec l'erreur `permission denied`. L'opération de pull reprovisionne le rôle applicatif par la suite, en utilisant la même routine que le démarrage et `rebase db push`, afin que les tables internes de Rebase restent révoquées comme il se doit.

La cible est toujours la base de données de développement locale de ce projet et ne peut pas être choisie : `--database-url` est refusé plutôt qu'accepté, il n'y a donc aucun moyen de demander un "pull vers la production". `--from` est la seule direction possible.

### `rebase db url`

Affiche la chaîne de connexion utilisée par ce projet, et rien d'autre, pour permettre l'utilisation de pipes :

```bash
rebase db url
psql "$(rebase db url)"
```

La base de données de développement gérée est le cas qui nécessite cela : `.env` laisse `DATABASE_URL` commenté à dessein, et le port est dérivé du chemin du projet, de sorte que rien sur le disque ne la nomme. Lorsque vous avez défini votre propre `DATABASE_URL`, c'est ce qui s'affiche — l'ordre de résolution est le même que pour toutes les autres commandes. La commande démarre la base de données gérée si elle n'est pas déjà en cours d'exécution.

### `rebase db stop` / `rebase db reset`

Pour la base de données de développement gérée uniquement :

```bash
rebase db stop     # l'arrête ; les données sont conservées
rebase db reset    # la supprime et repart de zéro
```

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # travailler dessus ; toutes les commandes suivantes la suivront
rebase db branch switch            # indique sur quelle branche vous vous trouvez
rebase db branch switch --off      # retour à la base de données principale
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL ne copiera ni ne supprimera une base de données à laquelle quelque chose d'autre est connecté, et ce « quelque chose d'autre » est généralement votre propre commande `rebase dev`. `create` et `delete` indiquent ce qui maintient la base de données ouverte ; `--force` déconnecte ces sessions au préalable.

Chaque branche est une copie complète sur le disque, elles doivent donc être nettoyées. `prune` supprime trois éléments : une entrée dont la base de données a été supprimée en dehors de Rebase, une base de données de branche dont l'entrée n'a jamais été écrite, et — uniquement avec `--older-than` — les branches ayant dépassé l'âge spécifié. La commande demande confirmation avant de supprimer quoi que ce soit, sauf si vous passez `--yes`.

`switch` enregistre la branche dans `.rebase/branch.json` et ne modifie jamais `.env`. Elle prévaut sur `DATABASE_URL` dans `.env` et s'efface devant `--database-url` ou un `DATABASE_URL` dans le shell ; ainsi, une option sur la ligne de commande surpasse toujours un basculement effectué précédemment. La suppression de la branche sur laquelle vous vous trouvez vous ramène à la base de données principale plutôt que de laisser l'espace de travail pointé vers une base de données inexistante.

:::note[Non disponible sur la base de données de développement gérée]
`push`, `generate` et `migrate` planifient leur travail avec Atlas, qui a besoin d'une seconde base de données vide pour effectuer la comparaison — et le PGlite géré n'en dessert qu'une seule. Les exécuter à cet endroit s'interrompt avec un message d'explication. Pointez `DATABASE_URL` vers un véritable PostgreSQL pour le workflow de migration ; `rebase dev` crée déjà les tables manquantes de manière incrémentielle sur la base gérée.

`branch` y est refusée pour une raison similaire. `CREATE DATABASE ... TEMPLATE` sur PGlite écrit une entrée de catalogue et ne copie rien, donc la branche pointerait vers la base de données dont elle a été clonée — chaque écriture censée être isolée atterrirait dans votre base de données de développement. `rebase dev --docker` vous fournit un véritable serveur sur lequel les branches fonctionnent.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # les applications déclarées par ce projet
rebase apps init <name>      # enregistrer une nouvelle application dans rebase.json
rebase apps config <app>     # ce vers quoi résout une application
```

### `rebase status`

Tout ce que ce projet déclare, et si l'environnement s'y associe réellement :

```bash
rebase status               # chaque ressource et les variables qu'elle lit
rebase status --json        # lisible par une machine
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

Trois fichiers déterminent ce qu'un backend peut atteindre, et cette commande affiche les trois ensemble :
`rebase.json` indique où se trouve votre code et qui exécute le serveur,
`config/resources.ts` précise ce dont le projet a besoin, et l'environnement indique comment
accéder à chaque élément. Tout le reste — `rebase.resources.json`, le manifeste du bundle — est généré à partir du fichier intermédiaire pour les systèmes qui ne peuvent pas exécuter votre code, et vous ne l'écrivez jamais à la main.

Un état `○` correspond à la situation qu'il vaut mieux connaître avant un déploiement plutôt qu'après :
déclaré, mais non configuré. Un `✗` signifie que l'environnement configure quelque chose *incorrectement*,
ce qui empêche le démarrage plutôt que de fonctionner en mode dégradé.

### `rebase resources`

Ce que ce projet déclare comme prérequis — les bases de données, buckets, topics et
queues demandés par son code de configuration, ainsi que les tâches cron et fonctions définies par ses fichiers :

```bash
rebase resources            # les lister
rebase resources --write    # régénérer rebase.resources.json
rebase resources --check    # échouer si le graphe commité est obsolète
rebase resources --json     # lisible par une machine
```

`rebase resources --check` est nouveau — c'est l'option qu'utilise un job de CI pour échouer
face à un fichier `rebase.resources.json` qui ne correspond plus au code de configuration.

Une ressource est déclarée dans le code de configuration — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — ou est un fichier
situé sous `backend/crons` ou `backend/functions`. Elle n'est jamais écrite à la main dans
`rebase.resources.json`, qui est généré à partir de ces déclarations afin qu'un hôte puisse
lire les besoins d'un projet sans avoir à le compiler. Chaque entrée indique qui l'utilise
(`collection:events`, `property:posts.cover`, `function:report`).

Un backend possède également une base de données par défaut et une source de stockage par défaut que personne
ne déclare. Les deux sont listées ici, marquées comme `implicit`, et aucune n'est écrite dans
`rebase.resources.json` — l'hôte les fournit, les enregistrer reviendrait donc à demander
le provisionnement de quelque chose que personne n'a demandé.

Pour voir ce que la plateforme détient pour un projet par rapport à ce que son code déclare,
et pour supprimer une base de données provisionnée que le code ne mentionne plus, consultez
`rebase cloud resources` ci-dessous.

### `rebase cloud`

Tout ce qui concerne Rebase Cloud, actuellement en version bêta privée. Consultez le
[guide Rebase Cloud](/docs/deployment/cloud/) pour savoir en quoi il consiste et ce que la version bêta
n'inclut pas.

Chaque groupe répond à `--help`, et `--help` n'exécute jamais la commande. La plupart des commandes
agissent sur le projet lié dans `.rebase/cloud.json` ; `--project <id>` permet d'opérer sur
un projet sans le lier.

Trois options s'appliquent partout : `--json` pour une sortie lisible par une machine (également la
valeur par défaut via un pipe, ou avec `REBASE_JSON=1`), `--url <origin>` pour cibler un plan de contrôle
spécifique (ou `REBASE_CLOUD_URL`), et `--project, -p <id>`.

#### Authentification

```bash
rebase cloud login      # se connecter au plan de contrôle
rebase cloud logout     # se déconnecter
rebase cloud whoami     # afficher la session actuelle
```

#### Liaison de projet

```bash
rebase cloud link         # lier ce répertoire à un projet cloud
rebase cloud link [url]   # ou directement vers un backend : pas de plan de contrôle, pas de connexion, et le reste de la famille refuse jusqu'au unlink
rebase cloud unlink       # supprimer la liaison
rebase cloud use [org]    # sélectionner l'organisation active
rebase cloud open         # ouvrir le tableau de bord dans un navigateur
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
rebase cloud deploy [app] [--source .]   # déployer une app et diffuser les logs de build
rebase cloud logs [--runtime] [-f]       # logs de build, ou ceux du processus en cours d'exécution
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # revenir à un déploiement réussi
rebase cloud cancel [-y]                 # annuler le build en cours
rebase cloud start | stop | restart [-y] # stop et restart nécessitent -y
rebase cloud status                      # état du projet en un coup d'œil
rebase cloud metrics                     # métriques en direct : CPU / mémoire / disque
rebase cloud debug [health|logs|…]       # diagnostiquer un déploiement, en lecture seule
```

`deploy` sans nom d'application déploie le backend.

#### Configuration

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add | verify | remove
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # nom, branche, dépôt, sous-domaine
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

`db connect` ouvre un port local qui *est* la base de données gérée — laquelle n'a pas
de point de terminaison public — et le maintient ouvert jusqu'à Ctrl-C. `--reveal` inclut le mot de passe.

#### Ressources

Ce que la plateforme détient pour le projet, par rapport à ce que son code déclare.

```bash
rebase cloud resources                       # chaque base de données et bucket : déclaré ? provisionné ?
rebase cloud resources prune database <key>  # supprimer une ressource que le code ne déclare plus
```

Un déploiement ne supprime jamais une base de données provisionnée lorsque sa déclaration disparaît — cela
reviendrait à supprimer des données lors d'un push. Elle est conservée, liée et facturée jusqu'à ce que
quelqu'un la supprime explicitement par son nom.

#### Calcul (Compute)

Ce que le projet réserve, et ce que cela coûte.

```bash
rebase cloud compute            # la réservation actuelle et son coût mensuel
rebase cloud compute set        # la modifier
```

`compute set` accepte `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` et `--no-autoscale`.
Il n'y a pas de niveaux de forfaits : tout est facturé par ressource. Consultez
[Rebase Cloud](/docs/deployment/cloud/).

#### Stockage, webhooks, clusters et facturation

```bash
rebase cloud storage             # lister les buckets de stockage
rebase cloud storage create      # provisionner un stockage géré par la plateforme
rebase cloud storage attach      # attacher votre propre bucket compatible S3
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # les clusters sur lesquels tournent les locataires (tenants) ; `add` en enregistre un depuis un kubeconfig
rebase cloud billing             # compte de facturation et carte enregistrée
rebase cloud billing setup       # associer une carte, usage unique, ouvre un navigateur
rebase cloud billing checkout    # une session Stripe pour un projet
```

### `rebase generate-sdk`

Génère un SDK client typé à partir de vos définitions de collections :

```bash
rebase generate-sdk
```

Crée les types TypeScript et un client type-safe pour l'ensemble de vos collections.

### `rebase doctor`

```bash
rebase doctor
```

La commande à exécuter lorsque quelque chose ne va pas et que vous ne savez pas encore quoi. Elle
rapporte les anomalies et ne modifie jamais rien, elle est donc sans risque sur n'importe quelle base de données
accessible.

**Sans base de données.** Ces vérifications s'exécutent d'abord, car tout ce qui empêche totalement un projet
de fonctionner survient avant même qu'une table puisse être comparée :

| Vérification | Pourquoi |
| --- | --- |
| Version de Node | Par rapport à la plage déclarée par la CLI. Une version trop ancienne n'est pas signalée comme "Node non supporté" — il s'agit d'une erreur de syntaxe au sein d'une dépendance. |
| Gestionnaires de paquets | Deux lockfiles dans un même projet. Un `npm install` dans un workspace pnpm réorganise `node_modules` selon une structure rejetée par pnpm, avec pour symptôme `Cannot find module` quelques heures plus tard. |
| Slugs en double | Le registre conserve la dernière collection enregistrée, la précédente n'est donc pas signalée comme manquante — elle est servie comme gagnante, sous son propre nom. |
| Cohérence du `.env` | Un `JWT_SECRET` inférieur à 32 caractères (sur lequel la production refuse de démarrer), et `NODE_ENV=production` sans `CORS_ORIGINS` ni `FRONTEND_URL`. Les valeurs ne sont jamais affichées. |
| Décalage de version `@rebasepro/*` | Le même package fixé à des versions différentes dans les fichiers `package.json` du projet. Avoir deux copies casse le fonctionnement de `instanceof` entre elles, qui échoue sous la forme d'un type guard rejetant son propre type. |
| Chaînes de connexion | Un caractère `=` non encodé dans un paramètre d'URL, que les outils de PostgreSQL refusent de parser — ainsi les sauvegardes et `psql` échouent alors que l'application continue de fonctionner. |
| Fonctions personnalisées | Ce dont chaque fonction a besoin de la part de son hôte, et lesquelles ne s'exécuteraient pas sur un runtime edge. |

**Avec la base de données**, lorsque `DATABASE_URL` est défini :

| Vérification | Pourquoi |
| --- | --- |
| Collections → schéma généré | Indique si `schema.generated.ts` est obsolète. |
| Collections → base de données | Tables, colonnes, énumérations, clés étrangères et tables de jonction manquantes. |
| Extensions requises | Une propriété `{ type: "vector" }` nécessite pgvector, que Rebase installe uniquement là où un projet l'a déclaré. |
| Empreinte du schéma (Schema stamp) | Indique si cette base de données a été provisionnée à partir de ces collections. Il s'agit d'un hash, signalant ainsi un désaccord entre les deux sans jamais indiquer lequel est en avance. |
| Collections → types du SDK | Indique si le SDK typé généré est obsolète. |
| Politiques RLS | Indique si les politiques de la base de données correspondent aux `securityRules` que vous avez déclarées, et si une politique nomme un rôle que ce serveur ne peut pas utiliser. |

Si la base de données est inaccessible, ses étapes sont signalées comme ignorées avec la
raison associée et le reste continue de s'exécuter — voir [Dépannage](/docs/troubleshooting/).

Renvoie un code de sortie différent de zéro lorsqu'une vérification détecte une erreur, ou lorsqu'une étape n'a pas pu
s'exécuter parce que la base de données fournie refuse les connexions. Une étape ignorée parce
qu'aucune variable `DATABASE_URL` n'a été définie n'est pas considérée comme un échec.

`rebase doctor --policies` exécute uniquement les vérifications RLS — pas de diff de schéma, pas de
types de SDK — et échoue par défaut (fail closed), ce qui en fait la variante idéale pour servir de barrière de contrôle CI face à
une base de données déployée.

### `rebase auth`

Commandes de gestion de l'authentification :

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gère les clés d'API de service à portée restreinte — les identifiants utilisés par un agent, un script ou un autre
service, par opposition à la session d'un utilisateur final :

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` prend un tableau JSON d'objets `{ collection, operations }`, ou utilisez
`--full-access` pour les droits lecture/écriture/suppression sur chaque collection et fonction. `--expires`
accepte `7d`, `30d`, `90d`, `1y` ou une date ISO, et `--rate-limit` définit les requêtes autorisées
par fenêtre de 15 minutes. Une clé n'est affichée qu'une seule fois, lors de sa création.

Les clés sont soumises à une double validation : les autorisations propres à la clé et la sécurité au niveau des lignes (RLS)
de l'identité sous laquelle elle opère s'appliquent toutes deux, de sorte qu'une clé ne peut jamais lire plus que ce que cette identité autorise.

### `rebase skills install`

Installe les compétences de référence (skills) Rebase pour votre assistant de programmation IA. Prend en charge
Cursor, Claude Code, Windsurf, Gemini CLI et Antigravity :

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consultez [Compétences d'agent](/docs/ai/skills) pour la liste complète et l'emplacement des fichiers générés.

### `rebase telemetry`

Partage anonyme des données d'utilisation. **`rebase init` pose la question une fois par projet, et l'invite
répond par défaut par l'affirmative — rien n'est envoyé tant que vous n'y avez pas répondu :**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` affiche le paramétrage actuel, `show` affiche exactement ce qui serait envoyé —
que le partage soit activé ou non, afin que vous puissiez examiner le contenu avant de vous décider — et
les deux autres options permettent de le modifier. Si vous n'avez jamais exécuté `init`, aucune donnée n'a jamais été collectée.

## Workflow de migration

Le workflow classique pour les modifications de schéma :

```bash
# 1. Modifiez votre collection dans config/collections/
# 2. Générez le schéma Drizzle
rebase schema generate

# 3. Générez la migration SQL
rebase db generate

# 4. Examinez le SQL généré dans drizzle/

# 5. Appliquez la migration
rebase db migrate
```

## Étapes suivantes

- **[Schéma en tant que code](/docs/architecture/schema-as-code)** — Comment fonctionne la génération de schéma
- **[Démarrage rapide](/docs/getting-started/quickstart)** — Lancez-vous

---
