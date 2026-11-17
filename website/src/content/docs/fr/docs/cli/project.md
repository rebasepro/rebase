---
sourceHash: ba06503a40ad1397
title: Une application en cours d'exécution
sidebar_label: Une application en cours d'exécution
description: Commandes CLI qui agissent sur une application Rebase en cours d'exécution via son API — lignes, utilisateurs, tâches cron, journaux, fonctions, fichiers, simulateur RLS — sur rebase dev, un serveur spécifique ou un projet Rebase Cloud.
---

Ces commandes communiquent avec une application en cours d'exécution via sa propre API ; ainsi, la sécurité au niveau des lignes (RLS), l'accès aux champs, les hooks et les stratégies de stockage déterminent ce qu'elles peuvent faire, tout comme pour le SDK. Elles s'adressent à l'instance locale `rebase dev`, à un serveur que vous spécifiez ou à un projet Rebase Cloud, avec les mêmes options partout.

## Choisir le serveur et les identifiants

| Option | Destination des requêtes et identité utilisée |
|---|---|
| *(aucune)* | `REBASE_BASE_URL` (dans le shell, puis dans `.env`), sinon le `rebase dev` exécuté depuis cet espace de travail ; avec la clé de service issue de `.env` |
| `--url <server>` | Ce serveur, avec la clé de service issue de `.env` |
| `--project <slug>` | Un projet Rebase Cloud, via le proxy Studio de la console : vous vous connectez avec `rebase cloud login`, et le plan de contrôle attache la clé de l'application de son côté, de sorte qu'aucune clé n'atteint votre machine. Réservé aux propriétaires et administrateurs d'organisation, sur un projet dont l'accès Studio est activé (`rebase cloud settings set --studio on`) |
| `--cloud` | Le projet Rebase Cloud auquel ce répertoire est lié |
| `--token <bearer>` | Envoie ce bearer à la place : une clé `rk_` ou le jeton d'accès d'un utilisateur. Sur un projet Cloud, la requête est envoyée à l'adresse propre de l'application |
| `--session` | Envoie la session utilisateur stockée par `rebase auth login` pour ce serveur |
| `--anon` | N'envoie rien : ce qu'obtient un simple visiteur |

Rien d'autre n'est déduit : sans `REBASE_BASE_URL` et sans `rebase dev` en cours d'exécution, une commande refuse de s'exécuter plutôt que d'envoyer la clé de service à n'importe quel processus écoutant sur un port. Chaque commande accepte `--json` (et produit du JSON dès que stdout n'est pas un terminal, à l'instar de `rebase cloud`) ainsi que `--yes`, qui valide la confirmation demandée par chaque opération destructrice ; en l'absence de terminal, elle échoue avec l'erreur `confirmation_required` au lieu d'afficher une invite.

`rebase api-keys`, `rebase storage orphans|move` et `rebase schema reconcile` acceptent les mêmes options.

## `rebase api`

N'importe quelle route desservie par l'application, avec les identifiants du projet — tout ce qui ne dispose pas de sa propre commande dédiée : le rafraîchissement d'une vue matérialisée, l'audit RLS, `/api/meta/contract`, ou une route ajoutée par un plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Un chemin sans `/` initial est résolu sous `/api`. `-f key=value` définit un champ de type chaîne et `-F` un champ typé (`true`, `false`, `null`, nombres, JSON, `@file`) ; les champs constituent la chaîne de requête (query string) pour un GET, HEAD ou DELETE, et un corps JSON sinon. Contrairement à `gh api`, un simple champ ne transforme jamais la requête en POST : une écriture doit préciser sa méthode ou inclure `--input`. La réponse est affichée telle quelle — le JSON étant formaté — et une réponse non-2xx est affichée et renvoie un code de sortie 1. L'en-tête `Authorization` est refusé ; les options de ciblage déterminent les identifiants utilisés.

## `rebase data`

Les lignes d'une table, via `/api/data`. Les filtres sont ceux de l'API (`?status=eq.published`), transmis tels quels : `--where status=eq.published`, `--where price=gte.10`, et simplement `--where status=draft` pour une égalité.

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
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (répétable), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only` ; `--all` parcourt toutes les pages ; `--format table\|json\|ndjson\|csv` (csv et ndjson sont diffusés en flux avec `--all`) |
| `get <table> <id>` | Une seule ligne, avec `--fields` et `--include` |
| `count <table>` | Le nombre de lignes correspondant à `--where` |
| `aggregate <table>` | `--select` et `--group-by`, propres à l'API |
| `insert <table>` | `--data <json>` ou `--file <path\|->` ; un tableau représente plusieurs lignes dans une seule écriture groupée ; `--upsert <column>` |
| `update <table> [<id>]` | Une ligne, ou chaque ligne correspondant à `--where` après un comptage et une confirmation ; `--if-match <etag>` |
| `delete <table> [<id>]` | Demande confirmation d'abord ; `--hard` pour une table avec suppression réversible (soft-delete) |
| `import <table>` | `--file` (tableau JSON, NDJSON ou CSV selon l'extension, ou `--format`), par lots (`--batch`) ; `--upsert`, `--ignore-duplicates`. Ce que `query --format json` génère peut être relu |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tables dont l'historique est activé |
| `watch <table>` | Les lignes correspondantes à chaque modification, via la websocket temps réel. Ne passe pas par le proxy Studio : sur un projet Cloud, passez `--token` ou `--session` |

La clé de service correspond au rôle `admin` : la sécurité au niveau des lignes (RLS) s'applique toujours, avec ce rôle. Passez `--token`, `--session` ou `--anon` pour visualiser la table comme le ferait un autre utilisateur.

## `rebase schema show`

Les tables, ou les colonnes, relations et règles RLS d'une table — issues de `backend/schema` par défaut, ou avec `--remote` (ou toute option de ciblage) telles que le serveur en cours d'exécution les décrit pour ces identifiants. Des identifiants sans `schema:read` ne voient aucune stratégie, et une table impossible à lire n'est pas listée.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

Les comptes, via `/api/admin/users`, `/roles` et `/guests`. Un compte est désigné par son uid ou son adresse e-mail (correspondance exacte, jamais le premier résultat approximatif).

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

`create` envoie une invitation par e-mail, ou renvoie un mot de passe temporaire unique si aucun e-mail ne peut être envoyé. L'attribution d'un rôle, `--disable`, `delete` et `mfa-reset` demandent d'abord confirmation. Aucun appelant ne peut attribuer un rôle supérieur au sien, ni agir sur un compte qui lui est supérieur dans la hiérarchie. `rebase auth reset-password` est l'ancienne syntaxe et bascule toujours sur la base de données lorsque le serveur n'est pas en cours d'exécution.

## `rebase cron`

Les tâches planifiées de l'application (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` et `disable` remplacent le comportement défini dans le code de la tâche sur chaque processus, y compris entre les redéploiements ; `run` demande d'abord confirmation, et `--async` renvoie la main dès que l'exécution a débuté. Sur un projet Cloud, `rebase cron` ne nécessite pas d'accès Studio pour les lectures : la commande demande au plan de contrôle un jeton de plateforme court `cron:read`, détenu par tout membre ayant accès aux journaux. `run`, `enable`, `disable` et `reset` nécessitent `cron:write`, détenu par un propriétaire ou un administrateur d'organisation sur un projet avec Studio activé. `rebase cloud cron` est l'ancienne syntaxe en lecture seule.

## `rebase logs`

Le journal des requêtes et de l'application du serveur — le tampon lu par l'explorateur de journaux de Studio — affiché une fois, ou suivi en continu avec `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

Ce tampon correspond à un seul processus. Avec `--project` ou `--cloud`, cela équivaut à `rebase cloud logs --runtime` : la sortie de chaque réplica, via le plan de contrôle.

## `rebase functions`

Les routes propres à l'application, à raison d'une par fichier dans `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` accepte les champs, le corps et les en-têtes acceptés par `rebase api`, et affiche la réponse telle quelle. Les fonctions définissent leurs propres règles d'accès, les identifiants ont donc toute leur importance : `--anon` montre ce qu'obtient un visiteur.

## `rebase storage`

Les fichiers stockés, soumis aux politiques de stockage. La référence distante commence par deux-points : `:avatars/me.png` dans la source par défaut, `media:avatars/me.png` dans la source identifiée par `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` téléverse sous le préfixe public (une URL permanente, sans jeton), `--content-type` définit le type MIME, et `--force` écrase un fichier local lors du téléchargement. `orphans` et `move` constituent la partie maintenance globale du stockage.

## `rebase rls simulate`

Ce qu'une autre identité verrait, calculé par le simulateur RLS de l'application — celui utilisé par la fonction « afficher en tant que » de Studio : par table, les lignes qu'elle lit par rapport aux lignes que vous lisez, les tables dont ses portées l'excluent, et les colonnes qu'elle ne peut pas lire. En lecture seule.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

Le simulateur ne répond qu'à la session d'un administrateur et jamais à une clé ; cette commande transmet donc la session stockée par `rebase auth login`. `rebase verify --live` vérifie les stratégies elles-mêmes, indépendamment de toute identité.

## `rebase auth login`, `emails` et `keys`

Certaines routes répondent à une personne et jamais à une machine : le simulateur RLS, les clés personnelles, l'application de schéma en direct. `rebase auth login` permet de s'authentifier auprès d'une application en cours d'exécution — via le navigateur lorsque le serveur propose l'authentification par appareil, sinon avec `--email` et un mot de passe (`--code` pour un second facteur) — et conserve la session dans `~/.rebase/sessions.json`, par serveur, jamais au sein du projet. `auth whoami` indique sous quelle identité le serveur vous reconnaît et les portées que vous détenez ; `auth logout` met également fin à la session côté serveur.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` consulte la boîte aux lettres de développement qu'un serveur sans `SMTP_HOST` conserve au lieu d'envoyer des e-mails ; `--clear` la vide. `auth keys` gère vos propres clés `rk_`, qui agissent en votre nom, restreintes aux portées spécifiées ; le serveur ne répond à cette commande que si la table d'authentification configure `auth.personalKeys: true`. Les clés de service se gèrent via `rebase api-keys`, qui intègre également `update <id>`.

## Étapes suivantes

- [Index des points de terminaison](/docs/backend/endpoints/) — chaque route accessible par ces commandes et les portées nécessaires
- [API REST](/docs/backend/api/) — la syntaxe de filtrage, de tri et de pagination relayée par `rebase data`
- [rebase cloud](/docs/cli/cloud/) — le projet lui-même sur Rebase Cloud : déploiements, environnement, sauvegardes, accès Studio
- [Référence de la CLI](/docs/cli/) — toutes les autres commandes
