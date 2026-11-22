---
sourceHash: 8d5e791f9d3e039e
title: Une application en cours d'exécution
sidebar_label: Une application en cours d'exécution
description: Commandes CLI qui agissent sur une application Rebase en cours d'exécution via son API — lignes, utilisateurs, cron, journaux, fonctions, fichiers, le simulateur RLS — sur rebase dev, un serveur désigné ou un projet Rebase Cloud.
---

Ces commandes communiquent avec une application en cours d'exécution via sa propre API, de sorte que la sécurité au niveau des lignes (RLS), l'accès aux champs, les hooks et les stratégies de stockage déterminent ce qu'elles peuvent faire, tout comme pour le SDK. Elles ciblent le `rebase dev` local, un serveur que vous spécifiez ou un projet Rebase Cloud, avec les mêmes options partout.

## Choisir le serveur et les identifiants

| Option | Où vont les requêtes et sous quelle identité |
|---|---|
| *(aucun)* | `REBASE_BASE_URL` (shell, puis `.env`), sinon le `rebase dev` exécuté par ce checkout ; avec la clé de service de `.env` |
| `--url <server>` | Ce serveur, avec la clé de service de `.env` |
| `--project <slug>` | Un projet Rebase Cloud, via le proxy Studio de la console : vous vous connectez avec `rebase cloud login`, et le plan de contrôle attache la clé de l'application de son côté, de sorte qu'aucune clé n'atteint votre machine. Propriétaires et administrateurs d'organisation, sur un projet dont l'accès Studio est activé (`rebase cloud settings set --studio on`) |
| `--cloud` | Le projet Rebase Cloud auquel ce répertoire est lié |
| `--token <bearer>` | Envoyer ce bearer à la place : une clé `rk_` ou un jeton d'accès utilisateur. Sur un projet Cloud, il est envoyé à l'adresse propre de l'application |
| `--session` | Envoyer la session utilisateur enregistrée par `rebase auth login` pour ce serveur |
| `--anon` | N'envoyer rien : ce qu'obtient un visiteur |

Rien d'autre n'est deviné : sans `REBASE_BASE_URL` ni `rebase dev` en cours d'exécution, une commande refuse d'agir plutôt que d'envoyer la clé de service à n'importe quoi qui écoute sur un port. Le `rebase dev` en cours d'exécution est celui dont le processus est actif, sur le port annoncé par son backend (`.rebase/dev.json`, sinon le fichier propre au backend `.rebase/state.json`) ; `.rebase-dev-url` est destiné à vos scripts, et une exécution interrompue le laisse derrière elle, donc aucune commande ne le lit. Chaque commande accepte `--json` (et produit du JSON dès lors que stdout n'est pas un terminal, comme le fait `rebase cloud`) et `--yes`, qui valide la confirmation demandée par toute action destructive ; en l'absence de terminal, elle refuse avec `confirmation_required` au lieu d'inviter à confirmer.

`rebase api-keys`, `rebase storage orphans|move` et `rebase schema reconcile` acceptent les mêmes options.

## `rebase api`

N'importe quelle route servie par l'application, avec les identifiants du projet — la longue traîne qui ne dispose pas de commande dédiée : le rafraîchissement d'une vue matérialisée, l'audit RLS, `/api/meta/contract`, une route ajoutée par un plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Un chemin sans `/` initial se trouve sous `/api`. `-f key=value` représente un champ textuel et `-F` un champ typé (`true`, `false`, `null`, nombres, JSON, `@file`) ; les champs constituent la query string pour GET, HEAD ou DELETE, et un corps JSON sinon. Contrairement à `gh api`, un champ seul ne transforme jamais la requête en POST : une écriture spécifie sa méthode ou inclut `--input`. La réponse est affichée telle quelle — JSON formaté (pretty-printed) — et toute réponse non-2xx est affichée avec un code de sortie 1. L'en-tête `Authorization` est refusé ; les options de cible sélectionnent les identifiants.

## `rebase data`

Les lignes d'une table, via `/api/data`. Les filtres sont ceux propres à l'API (`?status=eq.published`), transmis tels quels : `--where status=eq.published`, `--where price=gte.10`, et simplement `--where status=draft` pour l'égalité.

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
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (répétable), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only` ; `--all` parcourt chaque page ; `--format table\|json\|ndjson\|csv` (csv et ndjson sont diffusés en streaming avec `--all`) |
| `get <table> <id>` | Une seule ligne, avec `--fields` et `--include` |
| `count <table>` | Le nombre de lignes correspondant à `--where` |
| `aggregate <table>` | `--select` et `--group-by`, ceux propres à l'API |
| `insert <table>` | `--data <json>` ou `--file <path\|->` ; un tableau représente plusieurs lignes en une seule écriture groupée ; `--upsert <column>` |
| `update <table> [<id>]` | Une ligne, ou chaque ligne correspondant à `--where` après un comptage et une confirmation ; `--if-match <etag>` |
| `delete <table> [<id>]` | Demande confirmation d'abord ; `--hard` sur une table avec suppression réversible (soft-delete) |
| `import <table>` | `--file` (tableau JSON, NDJSON ou CSV selon l'extension, ou `--format`), par lots (`--batch`) ; `--upsert`, `--ignore-duplicates`. Relit ce que produit `query --format json` |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tables avec l'historique activé |
| `watch <table>` | Les lignes correspondantes à chaque modification, via la socket temps réel. Ne passe pas par le proxy Studio : sur un projet Cloud, passez `--token` ou `--session` |

La clé de service correspond au rôle `admin` : la sécurité au niveau des lignes s'applique toujours, sous ce rôle. Passez `--token`, `--session` ou `--anon` pour visualiser la table comme quelqu'un d'autre.

## `rebase schema show`

Les tables, ou les colonnes, relations et la sécurité au niveau des lignes d'une table — depuis `backend/schema` par défaut, ou avec `--remote` (ou toute option de cible) telles que le serveur en cours d'exécution les décrit pour ces identifiants. Un identifiant sans `schema:read` ne voit aucune stratégie, et une table qu'il ne peut pas lire n'est pas répertoriée.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

Les comptes, via `/api/admin/users`, `/roles` et `/guests`. Un compte est désigné par son uid ou son e-mail (correspondance exacte, jamais le premier résultat approximatif).

```bash
rebase users list --search ada
rebase users create ada@example.com --role admin
rebase users import users.csv --dry-run
rebase users update bob@example.com --add-role editor
rebase users update bob@example.com --disable
rebase users reset-password bob@example.com
rebase users mfa-reset bob@example.com
rebase users roles
rebase users guests prune --older-than 30d --yes
```

`create` envoie une invitation par e-mail, ou renvoie un mot de passe temporaire unique si aucun e-mail ne peut être envoyé. `--no-invite` crée le compte sans mot de passe et n'envoie rien, pour une application avec connexion par lien magique (magic link), code par e-mail ou fournisseur d'identité (`POST /api/admin/users` avec `invite: false`). L'attribution d'un rôle, `--disable`, `delete` et `mfa-reset` demandent d'abord confirmation. Aucun appelant ne peut attribuer un rôle supérieur au sien, ni agir sur un compte d'un rang supérieur. `rebase auth reset-password` est l'ancienne syntaxe, et bascule toujours sur la base de données lorsque le serveur n'est pas en cours d'exécution.

### Importer des comptes

<span class="since-badge" data-since="0.35">Depuis 0.35</span> `import` importe des comptes depuis un autre système et conserve leurs identifiants, afin que les lignes pointant vers un utilisateur continuent de pointer vers le même. La commande accepte un fichier CSV, un tableau JSON ou du NDJSON (`--format`, sinon déterminé par l'extension), avec les colonnes suivantes :

| Colonne | |
|---|---|
| `id` | Conservé comme identifiant du compte. Facultatif : en son absence, la table des utilisateurs en génère un. Le format uuid est le cas classique ; les lettres, chiffres et `_ - . : \|` jusqu'à 128 caractères sont également acceptés, bien qu'une colonne id de type `uuid` n'accepte que des uuid |
| `email` | Obligatoire |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Date de création du compte dans le système d'origine. Facultatif : date actuelle |
| `email_verified` / `emailVerified` | `true`/`t`/`1` ou `false`/`f`/`0`. Facultatif : `false`, et le premier lien magique ou lien de réinitialisation suivi par le compte le confirme |
| `roles` | `editor;viewer`, `"editor,viewer"` entre guillemets, ou un tableau Postgres `{editor,viewer}` |

Aucun mot de passe ni empreinte (hash) n'est importé, et aucun e-mail n'est envoyé : un compte importé se connecte par lien magique, code par e-mail, fournisseur d'identité ou réinitialisation de mot de passe. Un compte dont l'id ou l'e-mail est déjà pris est signalé comme ignoré et laissé tel quel, jamais mis à jour, ce qui permet de réexécuter le fichier. Chaque compte est rapporté comme créé, ignoré ou échoué avec le motif associé ; la commande se termine avec le code 1 en cas d'échec. `--dry-run` vérifie chaque compte et n'écrit rien. Le CLI envoie 100 comptes par requête (`POST /api/admin/users/import`), que ce soit sur `rebase dev`, un serveur ou un projet Rebase Cloud.

Depuis Supabase :

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified from auth.users) to users.csv csv header"
rebase users import users.csv --dry-run
rebase users import users.csv --project my-app
```

## `rebase cron`

Les tâches planifiées de l'application (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` et `disable` surchargent le code de la tâche sur tous les processus, d'un redéploiement à l'autre ; `run` demande confirmation d'abord, et `--async` répond dès que l'exécution a débuté. Sur un projet Cloud, `rebase cron` n'a pas besoin de l'accès Studio pour les lectures : il demande au plan de contrôle un jeton de plateforme `cron:read` de courte durée, que possède tout membre ayant accès aux journaux. `run`, `enable`, `disable` et `reset` requièrent `cron:write`, que détient un propriétaire ou administrateur d'organisation sur un projet avec Studio activé. `rebase cloud cron` est l'ancienne syntaxe en lecture seule.

## `rebase logs`

Le journal des requêtes et de l'application du serveur — le tampon lu par la vue Logs de Studio — ponctuellement, ou en continu avec `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

Le tampon est celui d'un seul processus. Avec `--project` ou `--cloud`, cela correspond à `rebase cloud logs --runtime` : la sortie de chaque réplica, via le plan de contrôle.

## `rebase functions`

Les routes personnalisées de l'application, une par fichier dans `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` accepte les champs, le corps et les en-têtes acceptés par `rebase api`, et affiche la réponse telle qu'elle a été reçue. Les fonctions déterminent leurs propres accès, le choix des identifiants est donc déterminant : `--anon` montre ce qu'obtient un visiteur.

## `rebase storage`

Les fichiers stockés, soumis aux stratégies de stockage. La cible stockée commence par deux-points : `:avatars/me.png` dans la source par défaut, `media:avatars/me.png` dans la source nommée `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` téléverse sous le préfixe public (une URL permanente sans jeton), `--content-type` définit le type MIME, et `--force` écrase un fichier local lors du téléchargement. `orphans` et `move` constituent le volet de maintenance globale du stockage.

## `rebase rls simulate`

Ce qu'une autre identité verrait, depuis le simulateur RLS de l'application — celui utilisé par la fonction « view as » de Studio : par table, les lignes qu'elle lit par rapport à celles que vous lisez, les tables dont ses portées (scopes) l'excluent, et les colonnes qu'elle ne peut pas lire. En lecture seule.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

Le simulateur répond à la propre session d'un administrateur et jamais à une clé ; cette commande envoie donc la session enregistrée par `rebase auth login`. `rebase verify --live` vérifie les stratégies elles-mêmes, indépendamment de toute identité.

## `rebase auth login`, `emails` et `keys`

Certaines routes répondent à une personne et jamais à une machine : le simulateur RLS, les clés personnelles, l'application de schéma en direct. `rebase auth login` permet de s'authentifier auprès d'une application en cours d'exécution — via le navigateur lorsque le serveur propose la connexion par appareil, sinon avec `--email` et un mot de passe (`--code` pour un second facteur) — et conserve la session dans `~/.rebase/sessions.json`, par serveur, jamais dans le projet. `auth whoami` indique qui le serveur considère que vous êtes ainsi que les portées que vous détenez ; `auth logout` met également fin à la session côté serveur.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` lit la boîte aux lettres de développement qu'un serveur sans `SMTP_HOST` conserve au lieu d'envoyer des e-mails ; `--clear` la vide. Une boîte aux lettres vide renvoie l'indication du serveur interrogé (`The development mailbox at http://localhost:3082 (rebase dev) is empty.`, et `server` dans le JSON), car une réponse vide provenant d'un autre backend ressemble exactement à un message qui n'a jamais été envoyé. `auth keys` gère vos propres clés `rk_`, qui agissent en votre nom, restreintes aux portées indiquées ; le serveur n'y répond que si la table auth définit `auth.personalKeys: true`. Les clés de service relèvent de `rebase api-keys`, qui a également reçu la commande `update <id>`.

## Prochaines étapes

- [Index des endpoints](/docs/backend/endpoints/) — chaque route atteinte par ces commandes et la portée nécessaire pour chacune
- [API REST](/docs/backend/api/) — la syntaxe de filtrage, de tri et de pagination relayée par `rebase data`
- [rebase cloud](/docs/cli/cloud/) — le projet lui-même sur Rebase Cloud : déploiements, environnement, sauvegardes, accès Studio
- [Référence CLI](/docs/cli/) — toutes les autres commandes
