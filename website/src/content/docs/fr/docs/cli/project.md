---
sourceHash: 6cce3d2ac14320cc
title: Une application en cours d'exécution
sidebar_label: Une application en cours d'exécution
description: Commandes CLI qui agissent sur une application Rebase en cours d'exécution via son API — lignes, utilisateurs, cron, journaux, fonctions, fichiers, simulateur RLS — sur rebase dev, un serveur spécifique ou un projet Rebase Cloud.
---

Ces commandes communiquent avec une application en cours d'exécution via sa propre API, de sorte que la sécurité au niveau des lignes (RLS), les accès aux champs, les hooks et les stratégies de stockage déterminent ce qu'elles peuvent faire, tout comme pour le SDK. Elles ciblent le `rebase dev` local, un serveur que vous spécifiez, ou un projet Rebase Cloud, avec les mêmes flags partout.

## Choisir le serveur et l'identifiant d'authentification

| Flag | Destination des requêtes et identité |
|---|---|
| *(aucun)* | `REBASE_BASE_URL` (shell, puis `.env`), sinon le `rebase dev` exécuté par cette copie locale ; avec la clé de service issue de `.env` |
| `--url <serveur>` | Ce serveur, avec la clé de service issue de `.env` |
| `--project <slug>` | Un projet Rebase Cloud, via le proxy Studio de la console : vous vous connectez avec `rebase cloud login`, et le plan de contrôle attache la clé de l'application de son côté, de sorte qu'aucune clé n'atteint votre machine. Propriétaires et administrateurs d'organisation, sur un projet dont l'accès Studio est activé (`rebase cloud settings set --studio on`) |
| `--cloud` | Le projet Rebase Cloud auquel ce répertoire est lié |
| `--token <bearer>` | Envoyer ce bearer à la place : une clé `rk_` ou le jeton d'accès d'un utilisateur. Sur un projet Cloud, il est envoyé directement à l'adresse de l'application |
| `--session` | Envoyer la session utilisateur stockée par `rebase auth login` pour ce serveur |
| `--anon` | Ne rien envoyer : ce qu'un visiteur anonyme reçoit |

Rien d'autre n'est deviné : sans `REBASE_BASE_URL` et sans instance de `rebase dev` en cours d'exécution, une commande refuse de s'exécuter plutôt que d'envoyer la clé de service à n'importe quel processus écoutant sur un port. Chaque commande accepte `--json` (et produit du JSON dès que stdout n'est pas un terminal, tout comme `rebase cloud`) et `--yes`, qui répond à la confirmation demandée par chaque commande destructive ; en l'absence de terminal, elle refuse de s'exécuter avec l'erreur `confirmation_required` au lieu d'afficher une invite interactive.

`rebase api-keys`, `rebase storage orphans|move` et `rebase schema reconcile` acceptent les mêmes flags.

## `rebase api`

N'importe quelle route desservie par l'application, avec les identifiants du projet — la longue traîne qui ne dispose pas de commande dédiée : le rafraîchissement d'une vue matérialisée, l'audit RLS, `/api/meta/contract`, une route ajoutée par un plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Un chemin sans `/` initial se trouve sous `/api`. `-f clé=valeur` représente un champ texte (string) et `-F` un champ typé (`true`, `false`, `null`, nombres, JSON, `@fichier`) ; les champs constituent la chaîne de requête (query string) pour un GET, HEAD ou DELETE, et un corps JSON pour les autres méthodes. Contrairement à `gh api`, un champ seul ne transforme jamais la requête en POST : une écriture doit préciser sa méthode ou comporter `--input`. La réponse est affichée telle qu'elle a été reçue — le JSON étant formaté avec indentation — et une réponse non-2xx est affichée et provoque une sortie avec le code 1. Un en-tête `Authorization` est refusé ; ce sont les flags de cible qui sélectionnent l'identifiant d'authentification.

## `rebase data`

Les lignes d'une table, via `/api/data`. Les filtres sont ceux de l'API (`?status=eq.published`), transmis tels quels : `--where status=eq.published`, `--where price=gte.10`, et une syntaxe simple `--where status=draft` pour l'égalité.

```bash
rebase data query posts --where status=eq.published --order-by created_at:desc -n 10
rebase data query orders --all --format csv > orders.csv
rebase data get posts 42 --include author
rebase data count posts --where status=eq.draft
rebase data aggregate orders --select "count(),sum(total)" --group-by status
rebase data insert posts --data '{"title":"Hello"}'
rebase data update posts 42 --data '{"title":"Renamed"}'
rebase data delete posts --where status=eq.draft --yes
rebase data import posts --file seed.csv --upsert slug
rebase data history posts 42 && rebase data revert posts 42 <historyId>
rebase data watch posts --where status=eq.published
```

| Action | Notes |
|---|---|
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (répétable), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only` ; `--all` parcourt chaque page ; `--format table\|json\|ndjson\|csv` (csv et ndjson sont transmis en flux continu avec `--all`) |
| `get <table> <id>` | Une seule ligne, avec `--fields` et `--include` |
| `count <table>` | Les lignes correspondant à `--where` |
| `aggregate <table>` | `--select` et `--group-by`, ceux de l'API |
| `insert <table>` | `--data <json>` ou `--file <chemin\|->` ; un tableau insère plusieurs lignes en une seule opération groupée ; `--upsert <colonne>` |
| `update <table> [<id>]` | Une seule ligne, ou chaque ligne correspondant à `--where` après un décompte et une confirmation ; `--if-match <etag>` |
| `delete <table> [<id>]` | Demande confirmation d'abord ; `--hard` pour une table avec suppression réversible (soft-delete) |
| `import <table>` | `--file` (tableau JSON, NDJSON ou CSV selon l'extension, ou `--format`), par lots (`--batch`) ; `--upsert`, `--ignore-duplicates`. Ce que `query --format json` génère peut être réimporté directement |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tables avec historique activé |
| `watch <table>` | Les lignes correspondantes à chaque modification, via le socket temps réel. Ne passe pas par le proxy Studio : sur un projet Cloud, passez `--token` ou `--session` |

La clé de service possède le rôle `admin` : la sécurité au niveau des lignes s'applique toujours, avec ce rôle. Passez `--token`, `--session` ou `--anon` pour visualiser la table comme un autre utilisateur.

## `rebase schema show`

Les tables, ou les colonnes, relations et règles de sécurité au niveau des lignes d'une table — depuis `backend/schema` par défaut, ou avec `--remote` (ou tout flag de cible) telles que le serveur en cours d'exécution les décrit pour cet identifiant. Un identifiant sans droit `schema:read` ne verra aucune règle de sécurité, et une table qu'il ne peut pas lire ne sera pas listée.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

Les comptes utilisateurs, via `/api/admin/users`, `/roles` et `/guests`. Un compte est désigné par son uid ou son adresse e-mail (correspondance exacte, jamais le premier résultat approximatif).

```bash
rebase users list --search ada
rebase users create ada@example.com --role admin
rebase users update bob@example.com --add-role editor
rebase users update bob@example.com --disable
rebase users reset-password bob@example.com
rebase users mfa-reset bob@example.com
rebase users roles
rebase users guests prune --older-than 30d --yes
```

`create` envoie une invitation par e-mail, ou renvoie un mot de passe temporaire unique si aucun e-mail ne peut être envoyé. `--no-invite` crée le compte sans mot de passe et n'envoie rien, pratique pour une application dont la connexion s'effectue par lien magique (magic link), code par e-mail ou fournisseur tiers (`POST /api/admin/users` avec `invite: false`). L'attribution d'un rôle, `--disable`, `delete` et `mfa-reset` demandent d'abord confirmation. Aucun appelant ne peut attribuer un rôle supérieur au sien, ni agir sur un compte dont le rang est plus élevé. `rebase auth reset-password` est l'ancienne syntaxe, et bascule toujours sur la base de données lorsque le serveur n'est pas en cours d'exécution.

## `rebase cron`

Les tâches planifiées de l'application (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` et `disable` surchargent le code de la tâche sur chaque processus, y compris à travers les redéploiements ; `run` demande d'abord confirmation, et `--async` répond dès que l'exécution a débuté. Sur un projet Cloud, `rebase cron` ne nécessite pas d'accès Studio pour les lectures : il demande au plan de contrôle un jeton de plateforme `cron:read` temporaire, détenu par tout membre ayant accès aux journaux. `run`, `enable`, `disable` et `reset` requièrent `cron:write`, qu'un propriétaire ou administrateur d'organisation détient sur un projet avec Studio activé. `rebase cloud cron` est l'ancienne commande en lecture seule.

## `rebase logs`

Le journal des requêtes et de l'application du serveur — le tampon lu par l'Explorateur de journaux de Studio — une seule fois, ou suivi en direct avec `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

Le tampon correspond à celui d'un seul processus. Avec `--project` ou `--cloud`, cela équivaut à `rebase cloud logs --runtime` : la sortie de chaque réplica, via le plan de contrôle.

## `rebase functions`

Les routes propres à l'application, une par fichier dans `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` accepte les champs, corps et en-têtes acceptés par `rebase api`, et affiche la réponse telle qu'elle a été reçue. Les fonctions déterminent leurs propres accès, donc l'identifiant est important : `--anon` montre ce qu'un visiteur obtient.

## `rebase storage`

Les fichiers stockés, soumis aux stratégies de stockage. L'identifiant côté stockage commence par deux-points : `:avatars/me.png` dans la source par défaut, `media:avatars/me.png` dans la source nommée `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` téléverse sous le préfixe public (une URL permanente sans jeton), `--content-type` définit le type MIME, et `--force` écrase un fichier local lors du téléchargement. `orphans` et `move` constituent le volet maintenance de l'ensemble du stockage.

## `rebase rls simulate`

Ce qu'une autre identité verrait, d'après le simulateur RLS de l'application — celui utilisé par la fonctionnalité "afficher en tant que" de Studio : par table, les lignes qu'elle lit comparées à celles que vous lisez, les tables dont ses portées (scopes) l'excluent, et les colonnes qu'elle ne peut pas lire. En lecture seule.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

Le simulateur ne répond qu'à la propre session d'un administrateur et jamais à une clé ; cette commande envoie donc la session stockée par `rebase auth login`. `rebase verify --live` vérifie les stratégies elles-mêmes, indépendamment de toute identité spécifique.

## `rebase auth login`, `emails` et `keys`

Certaines routes ne répondent qu'à un utilisateur humain et jamais à une machine : le simulateur RLS, les clés personnelles, l'application de schéma en direct. `rebase auth login` permet de s'authentifier auprès d'une application en cours d'exécution — via le navigateur lorsque le serveur propose l'authentification par appareil (device sign-in), sinon avec `--email` et un mot de passe (`--code` pour un deuxième facteur) — et conserve la session dans `~/.rebase/sessions.json`, par serveur, jamais dans le projet. `auth whoami` indique l'identité sous laquelle le serveur vous reconnaît ainsi que les portées (scopes) dont vous disposez ; `auth logout` met également fin à la session sur le serveur.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` lit la boîte aux lettres de développement qu'un serveur sans `SMTP_HOST` conserve au lieu d'envoyer les e-mails ; `--clear` la vide. `auth keys` gère vos propres clés `rk_`, qui agissent en votre nom tout en étant restreintes aux portées spécifiées ; le serveur n'y répond que si la table auth définit `auth.personalKeys: true`. Les clés de service se gèrent via `rebase api-keys`, qui propose également `update <id>`.

## Prochaines étapes

- [Index des points de terminaison](/docs/backend/endpoints/) — chaque route ciblée par ces commandes et les portées requises par chacune
- [API REST](/docs/backend/api/) — la syntaxe de filtrage, de tri et de pagination relayée par `rebase data`
- [rebase cloud](/docs/cli/cloud/) — le projet lui-même sur Rebase Cloud : déploiements, environnement, sauvegardes, accès Studio
- [Référence CLI](/docs/cli/) — toutes les autres commandes
