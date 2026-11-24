---
sourceHash: 3e9a0fde0de12d46
title: Une application en cours d'exécution
sidebar_label: Une application en cours d'exécution
description: Commandes CLI qui interagissent avec une application Rebase en cours d'exécution via son API — lignes, utilisateurs, tâches cron, journaux, fonctions, fichiers, le simulateur RLS — sur rebase dev, un serveur spécifique ou un projet Rebase Cloud.
---

Ces commandes communiquent avec une application en cours d'exécution via sa propre API, ainsi la sécurité au niveau des lignes (RLS), l'accès aux champs, les hooks et les stratégies de stockage déterminent ce qu'elles peuvent faire, tout comme pour le SDK. Elles s'adressent au `rebase dev` local, à un serveur que vous spécifiez, ou à un projet Rebase Cloud, avec les mêmes options partout.

## Choisir le serveur et l'identifiant

| Option | Où vont les requêtes, et en tant que qui |
|---|---|
| *(aucun)* | `REBASE_BASE_URL` (shell, puis `.env`), sinon le `rebase dev` exécuté par cette copie locale ; avec la clé de service issue de `.env` |
| `--url <server>` | Ce serveur, avec la clé de service issue de `.env` |
| `--project <slug>` | Un projet Rebase Cloud, via le proxy Studio de la console : vous vous connectez avec `rebase cloud login`, et le plan de contrôle attache la clé de l'application de son côté, de sorte qu'aucune clé n'arrive sur votre machine. Propriétaires et administrateurs d'organisation, sur un projet dont l'accès Studio est activé (`rebase cloud settings set --studio on`) |
| `--cloud` | Le projet Rebase Cloud auquel ce répertoire est lié |
| `--token <bearer>` | Envoyer ce bearer à la place : une clé `rk_` ou le jeton d'accès d'un utilisateur. Sur un projet Cloud, cela est envoyé à l'adresse propre de l'application |
| `--session` | Envoyer la session utilisateur enregistrée par `rebase auth login` pour ce serveur |
| `--anon` | Ne rien envoyer : ce qu'obtient un visiteur |

Rien d'autre n'est deviné : sans `REBASE_BASE_URL` et sans `rebase dev` en cours d'exécution, une commande refuse d'agir plutôt que d'envoyer la clé de service à n'importe quel service à l'écoute d'un port. Le `rebase dev` en cours d'exécution est celui dont le processus est actif, sur le port annoncé par son backend (`.rebase/dev.json`, sinon le fichier propre au backend `.rebase/state.json`) ; `.rebase-dev-url` est destiné à vos scripts, et une exécution interrompue le laisse derrière elle, donc aucune commande ne le lit. Chaque commande accepte `--json` (et produit du JSON dès lors que stdout n'est pas un terminal, tout comme `rebase cloud`) et `--yes`, qui valide la confirmation demandée par toute action destructive ; en l'absence de terminal, elle refuse avec `confirmation_required` au lieu d'afficher une invite.

`rebase api-keys`, `rebase storage orphans|move` et `rebase schema reconcile` acceptent les mêmes options.

## `rebase api`

N'importe quelle route desservie par l'application, avec les identifiants du projet — la longue traîne qui ne dispose pas de sa propre commande : le rafraîchissement d'une vue matérialisée, l'audit RLS, `/api/meta/contract`, une route ajoutée par un plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Un chemin sans `/` initial se situe sous `/api`. `-f key=value` correspond à un champ chaîne de caractères et `-F` à un champ typé (`true`, `false`, `null`, nombres, JSON, `@file`) ; les champs constituent la chaîne de requête (query string) pour un GET, HEAD ou DELETE, et un corps JSON pour le reste. Contrairement à `gh api`, un champ seul ne transforme jamais la requête en POST : une écriture spécifie sa méthode ou comporte `--input`. La réponse est affichée telle qu'elle a été reçue — avec un formatage JSON indenté — et une réponse non-2xx est affichée et se termine avec le code de sortie 1. Un en-tête `Authorization` est refusé ; les options de cible sélectionnent l'identifiant.

## `rebase data`

Les lignes d'une table, via `/api/data`. Les filtres sont ceux propres à l'API (`?status=eq.published`), transmis tels quels : `--where status=eq.published`, `--where price=gte.10`, et simplement `--where status=draft` pour une égalité.

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
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (répétable), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only` ; `--all` parcourt chaque page ; `--format table\|json\|ndjson\|csv` (csv et ndjson sont diffusés en flux avec `--all`) |
| `get <table> <id>` | Une seule ligne, avec `--fields` et `--include` |
| `count <table>` | Les lignes correspondant à `--where` |
| `aggregate <table>` | `--select` et `--group-by`, propres à l'API |
| `insert <table>` | `--data <json>` ou `--file <path\|->` ; un tableau représente plusieurs lignes dans une seule écriture groupée ; `--upsert <column>` |
| `update <table> [<id>]` | Une seule ligne, ou chaque ligne correspondant à `--where` après un décompte et une confirmation ; `--if-match <etag>` |
| `delete <table> [<id>]` | Demande confirmation d'abord ; `--hard` sur une table avec suppression réversible (soft-delete) |
| `import <table>` | `--file` (tableau JSON, NDJSON ou CSV selon l'extension, ou `--format`), par lots (`--batch`) ; `--upsert`, `--ignore-duplicates`. Ce que `query --format json` écrit peut être relu |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tables dont l'historique est activé |
| `watch <table>` | Les lignes correspondantes à chaque modification, via le socket temps réel. Ne passe pas par le proxy Studio : sur un projet Cloud, passez `--token` ou `--session` |

La clé de service correspond au rôle `admin` : la sécurité au niveau des lignes s'exécute toujours, sous ce rôle. Passez `--token`, `--session` ou `--anon` pour voir la table comme quelqu'un d'autre la verrait.

## `rebase schema show`

Les tables, ou les colonnes, relations et la sécurité au niveau des lignes d'une table — depuis `backend/schema` par défaut, ou avec `--remote` (ou toute option de cible) tel que le serveur en cours d'exécution les décrit pour cet identifiant. Un identifiant sans `schema:read` ne voit aucune stratégie (policy), et une table qu'il ne peut pas lire n'est pas listée.

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

`create` envoie une invitation par e-mail, ou renvoie une fois un mot de passe temporaire lorsqu'aucun e-mail ne peut être envoyé. `--no-invite` crée le compte sans mot de passe et n'envoie rien, pour une application où la connexion s'effectue par lien magique, code par e-mail ou fournisseur d'authentification (`POST /api/admin/users` avec `invite: false`). L'attribution d'un rôle, `--disable`, `delete` et `mfa-reset` demandent une confirmation au préalable. Aucun appelant ne peut attribuer un rôle supérieur au sien, ni agir sur un compte de rang supérieur. `rebase auth reset-password` est l'ancienne syntaxe et bascule toujours directement sur la base de données lorsque le serveur n'est pas en cours d'exécution.

### Importer des comptes

`import` importe des comptes depuis un autre système et conserve leurs identifiants, afin que les lignes pointant vers un utilisateur continuent de pointer vers le même. La commande accepte un fichier CSV, un tableau JSON ou du NDJSON (`--format`, sinon selon l'extension), avec les colonnes suivantes :

| Colonne | |
|---|---|
| `id` | Conservé comme identifiant du compte. Facultatif : sans lui, la table des utilisateurs en génère un. Un UUID est le cas d'usage courant ; les lettres, chiffres et `_ - . : \|` jusqu'à 128 caractères sont également acceptés, bien qu'une colonne d'identifiant de type `uuid` n'accepte que des UUID |
| `email` | Obligatoire |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Date de création du compte dans l'autre système. Facultatif : maintenant |
| `email_verified` / `emailVerified` | `true`/`t`/`1` ou `false`/`f`/`0`. Facultatif : `false`, et le premier lien magique ou lien de réinitialisation suivi par le compte le confirmera |
| `roles` | `editor;viewer`, entre guillemets `"editor,viewer"`, ou un tableau Postgres `{editor,viewer}` |
| `password_hash` / `encrypted_password` | Le hash enregistré par l'autre système. Lu uniquement avec `--password-hashes bcrypt` ; sans cette option, un fichier comportant cette colonne est refusé avant tout envoi |

Aucun e-mail n'est envoyé. Avec `--password-hashes bcrypt`, un compte dont la ligne contient un hash se connecte avec le mot de passe qu'il avait, et sa première connexion remplace le hash par celui propre à Rebase. Tout autre compte importé se connecte par lien magique, code par e-mail, fournisseur d'authentification ou réinitialisation de mot de passe. Un mot de passe en clair n'est jamais importé. Un compte dont l'identifiant ou l'e-mail est déjà utilisé est signalé comme ignoré (skipped) et laissé tel quel, jamais mis à jour, ce qui permet de réexécuter un fichier. Chaque compte est signalé comme créé, ignoré ou échoué avec la raison associée ; la commande se termine avec le code 1 si l'un d'eux a échoué. `--dry-run` vérifie chaque compte sans rien écrire. La CLI envoie 100 comptes par requête (`POST /api/admin/users/import`), que ce soit sur `rebase dev`, sur un serveur ou sur un projet Rebase Cloud.

Depuis Supabase :

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified, encrypted_password from auth.users) to users.csv csv header"
rebase users import users.csv --password-hashes bcrypt --dry-run
rebase users import users.csv --password-hashes bcrypt --project my-app
```

`users.csv` contient alors le hash de mot de passe de chaque compte : supprimez-le une fois l'importation terminée.

## `rebase cron`

Les tâches planifiées de l'application (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` et `disable` remplacent la configuration du code de la tâche sur chaque processus, à travers les redéploiements ; `run` demande confirmation d'abord, et `--async` répond dès que l'exécution a débuté. Sur un projet Cloud, `rebase cron` ne requiert pas d'accès Studio pour les lectures : il demande au plan de contrôle un jeton de plateforme `cron:read` éphémère, dont dispose tout membre ayant accès aux journaux. `run`, `enable`, `disable` et `reset` requièrent `cron:write`, qu'un propriétaire ou administrateur d'organisation détient sur un projet où Studio est activé. `rebase cloud cron` est l'ancienne syntaxe, en lecture seule.

## `rebase logs`

Le journal des requêtes et de l'application du serveur — le tampon que lit la vue Logs de Studio — ponctuellement, ou suivi en continu avec `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

Le tampon est propre à un processus. Avec `--project` ou `--cloud`, cela correspond à `rebase cloud logs --runtime` : la sortie de chaque réplica, via le plan de contrôle.

## `rebase functions`

Les routes propres à l'application, une par fichier dans `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` accepte les champs, le corps et les en-têtes acceptés par `rebase api`, et affiche la réponse telle qu'elle a été reçue. Les fonctions décident de leur propre contrôle d'accès, l'identifiant utilisé a donc son importance : `--anon` montre ce qu'obtient un visiteur.

## `rebase storage`

Fichiers stockés, via les stratégies de stockage. La cible stockée commence par deux-points : `:avatars/me.png` dans la source par défaut, `media:avatars/me.png` dans la source nommée `media`.

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

Ce qu'une autre identité verrait, depuis le simulateur RLS de l'application — celui qu'utilise la fonction "voir en tant que" (view as) de Studio : par table, les lignes qu'elle lit par rapport à celles que vous lisez, les tables dont ses portées (scopes) l'excluent, et les colonnes qu'elle ne peut pas lire. En lecture seule.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

Le simulateur ne répond qu'à la session propre d'un administrateur et jamais à une clé ; cette commande envoie donc la session enregistrée par `rebase auth login`. `rebase verify --live` vérifie les stratégies elles-mêmes, indépendamment de toute identité.

## `rebase auth login`, `emails` et `keys`

Certaines routes ne répondent qu'à une personne physique et jamais à une machine : le simulateur RLS, les clés personnelles, l'application de schéma en direct (live schema apply). `rebase auth login` permet de se connecter à une application en cours d'exécution — via le navigateur lorsque le serveur propose la connexion par appareil, sinon avec `--email` et un mot de passe (`--code` pour un second facteur) — et conserve la session dans `~/.rebase/sessions.json`, par serveur, jamais dans le projet. `auth whoami` indique qui le serveur pense que vous êtes ainsi que les portées que vous détenez ; `auth logout` met également fin à la session à cet endroit.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` lit la boîte aux lettres de développement qu'un serveur sans `SMTP_HOST` conserve au lieu d'envoyer les e-mails ; `--clear` la vide. Une boîte aux lettres vide renvoie l'indication du serveur interrogé (`The development mailbox at http://localhost:3082 (rebase dev) is empty.`, et `server` dans le JSON), car une réponse vide d'un autre backend ressemble exactement à un e-mail qui n'aurait jamais été envoyé. `auth keys` gère vos propres clés `rk_`, qui agissent en votre nom, restreintes aux portées indiquées ; le serveur n'y répond que lorsque la table d'authentification définit `auth.personalKeys: true`. Les clés de service sont gérées par `rebase api-keys`, qui prend désormais également en charge `update <id>`.

## Prochaines étapes

- [Index des endpoints](/docs/backend/endpoints/) — chaque route accessible par ces commandes, et la portée requise par chacune
- [API REST](/docs/backend/api/) — la syntaxe de filtrage, de tri et de pagination transmise par `rebase data`
- [rebase cloud](/docs/cli/cloud/) — le projet lui-même sur Rebase Cloud : déploiements, environnement, sauvegardes, accès Studio
- [Référence de la CLI](/docs/cli/) — toutes les autres commandes
