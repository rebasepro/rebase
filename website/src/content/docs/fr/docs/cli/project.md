---
sourceHash: f6e7c705c409b9aa
title: Une application en cours d'exécution
sidebar_label: Une application en cours d'exécution
description: Commandes CLI qui interagissent avec une application Rebase en cours d'exécution via son API — lignes, utilisateurs, tâches cron, journaux, fonctions, fichiers, le simulateur RLS — sur rebase dev, un serveur spécifié ou un projet Rebase Cloud.
---

Ces commandes communiquent avec une application en cours d'exécution via sa propre API ; la sécurité au niveau des lignes (RLS), l'accès aux champs, les hooks et les règles de stockage déterminent donc ce qu'elles peuvent faire, tout comme pour le SDK. Elles ciblent le `rebase dev` local, un serveur que vous spécifiez ou un projet Rebase Cloud, avec les mêmes options partout.

## Choisir le serveur et les identifiants

| Option | Destination des requêtes et identité |
|---|---|
| *(aucune)* | `REBASE_BASE_URL` (shell, puis `.env`), sinon le `rebase dev` exécuté par cette extraction de code ; avec la clé de service issue de `.env` |
| `--url <server>` | Ce serveur, avec la clé de service issue de `.env` |
| `--project <slug>` | Un projet Rebase Cloud, via le proxy Studio de la console : vous vous connectez avec `rebase cloud login`, et le plan de contrôle attache la clé de l'application de son côté, de sorte qu'aucune clé n'atteint votre machine. Propriétaires et administrateurs d'organisation, sur un projet dont l'accès Studio est activé (`rebase cloud settings set --studio on`) |
| `--cloud` | Le projet Rebase Cloud auquel ce répertoire est lié |
| `--token <bearer>` | Envoyer ce bearer à la place : une clé `rk_` ou un jeton d'accès utilisateur. Sur un projet Cloud, la requête est envoyée directement à l'adresse de l'application |
| `--session` | Envoyer la session utilisateur enregistrée par `rebase auth login` pour ce serveur |
| `--anon` | N'envoyer rien : ce qu'obtient un visiteur |

Rien d'autre n'est deviné : sans `REBASE_BASE_URL` ni `rebase dev` en cours d'exécution, une commande refuse d'agir plutôt que d'envoyer la clé de service à n'importe quel processus écoutant sur un port. Le `rebase dev` actif est celui dont le processus est vivant, sur le port annoncé par son backend (`.rebase/dev.json`, sinon le fichier propre au backend `.rebase/state.json`) ; `.rebase-dev-url` est réservé à vos scripts, et une exécution interrompue le laisse sur place, aucune commande ne le lit donc. Chaque commande accepte `--json` (et produit du JSON dès que stdout n'est pas un terminal, tout comme `rebase cloud`) ainsi que `--yes`, qui valide la confirmation demandée par toute action destructrice ; en l'absence de terminal, elle refuse d'agir avec `confirmation_required` au lieu d'afficher une invite.

`rebase api-keys`, `rebase storage orphans|move` et `rebase schema reconcile` acceptent les mêmes options.

## `rebase api`

Toute route desservie par l'application, avec les identifiants du projet — la longue traîne qui ne dispose pas de commande dédiée : le rafraîchissement d'une vue matérialisée, l'audit RLS, `/api/meta/contract`, une route ajoutée par un plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Un chemin sans `/` initial se trouve sous `/api`. `-f key=value` est un champ chaîne de caractères et `-F` un champ typé (`true`, `false`, `null`, nombres, JSON, `@file`) ; les champs constituent la chaîne de requête (query string) pour un GET, HEAD ou DELETE, et un corps JSON sinon. Contrairement à `gh api`, un champ seul ne transforme jamais la requête en POST : une écriture spécifie sa méthode ou comporte `--input`. La réponse est affichée telle qu'elle a été reçue — JSON formaté avec indentation — et toute réponse non-2xx est affichée et termine le processus avec un code de sortie 1. L'en-tête `Authorization` est refusé ; les options de cible sélectionnent les identifiants.

## `rebase data`

Les lignes d'une table, via `/api/data`. Les filtres sont ceux de l'API (`?status=eq.published`), transmis tels quels : `--where status=eq.published`, `--where price=gte.10`, ou simplement `--where status=draft` pour une égalité.

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
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (répétable), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only` ; `--all` parcourt toutes les pages ; `--format table\|json\|ndjson\|csv` (csv et ndjson sont diffusés en continu avec `--all`) |
| `get <table> <id>` | Une seule ligne, avec `--fields` et `--include` |
| `count <table>` | Le nombre de lignes correspondant à `--where` |
| `aggregate <table>` | `--select` et `--group-by`, ceux de l'API |
| `insert <table>` | `--data <json>` ou `--file <path\|->` ; un tableau représente plusieurs lignes en une seule écriture groupée ; `--upsert <column>` |
| `update <table> [<id>]` | Une seule ligne, ou chaque ligne correspondant à `--where` après un décompte et une confirmation ; `--if-match <etag>` |
| `delete <table> [<id>]` | Demande confirmation d'abord ; `--hard` sur une table avec suppression réversible (soft-delete) |
| `import <table>` | `--file` (tableau JSON, NDJSON ou CSV selon l'extension, ou `--format`), par lots (`--batch`) ; `--upsert`, `--ignore-duplicates`. Ce que `query --format json` écrit peut être relu tel quel |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tables dont l'historique est activé |
| `watch <table>` | Les lignes correspondantes à chaque modification, via le socket temps réel. Ne passe pas par le proxy Studio : sur un projet Cloud, transmettez `--token` ou `--session` |

La clé de service correspond au rôle `admin` : la sécurité au niveau des lignes s'applique toujours, sous ce rôle. Passez `--token`, `--session` ou `--anon` pour voir la table sous l'identité de quelqu'un d'autre.

## `rebase schema show`

Les tables, ou les colonnes, relations et la sécurité au niveau des lignes d'une table — depuis `backend/schema` par défaut, ou avec `--remote` (ou toute option de cible) telles que le serveur en cours d'exécution les décrit pour cet identifiant. Un identifiant sans `schema:read` ne voit aucune règle, et une table qu'il ne peut pas lire n'est pas listée.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

Les comptes, via `/api/admin/users`, `/roles` et `/guests`. Un compte est désigné par son uid ou son e-mail (correspondance exacte, jamais une correspondance approximative).

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

`create` envoie une invitation par e-mail ou renvoie une seule fois un mot de passe temporaire lorsqu'aucun e-mail ne peut être envoyé. `--no-invite` crée le compte sans mot de passe et n'envoie rien, pour une application qui s'authentifie par lien magique (magic link), code par e-mail ou fournisseur OAuth (`POST /api/admin/users` avec `invite: false`). L'attribution d'un rôle, `--disable`, `delete` et `mfa-reset` demandent d'abord confirmation. Aucun appelant ne peut attribuer un rôle supérieur au sien, ni agir sur un compte qui lui est supérieur en rang. `rebase auth reset-password` est l'ancienne syntaxe et bascule toujours directement sur la base de données lorsque le serveur n'est pas démarré.

### Importer des comptes

`import` importe des comptes depuis un autre système et conserve leurs identifiants (id), afin que les lignes faisant référence à un utilisateur continuent de pointer vers le même. La commande accepte un fichier CSV, un tableau JSON ou du NDJSON (`--format`, sinon l'extension), avec les colonnes suivantes :

| Colonne | |
|---|---|
| `id` | Conservé comme identifiant du compte. Facultatif : sans lui, la table des utilisateurs en génère un. Un uuid est le cas le plus courant ; les lettres, chiffres et `_ - . : \|` jusqu'à 128 caractères sont également acceptés, bien qu'une colonne id de type `uuid` n'accepte que des uuid |
| `email` | Obligatoire |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Date de création du compte dans le système d'origine. Facultatif : date actuelle |
| `email_verified` / `emailVerified` | `true`/`t`/`1` ou `false`/`f`/`0`. Facultatif : `false`, et le premier lien magique ou lien de réinitialisation suivi par le compte le confirme |
| `roles` | `editor;viewer`, entre guillemets `"editor,viewer"`, ou un tableau Postgres `{editor,viewer}` |
| `password_hash` / `encrypted_password` | Le hash stocké par l'autre système. Lu uniquement avec `--password-hashes bcrypt` ; sans cette option, un fichier comportant cette colonne est rejeté avant tout envoi |

Aucun e-mail n'est envoyé. Avec `--password-hashes bcrypt`, un compte dont la ligne contient un hash se connecte avec son mot de passe d'origine, et sa première connexion remplace le hash par celui propre à Rebase. Tout autre compte importé se connecte via lien magique, code par e-mail, fournisseur tiers ou réinitialisation de mot de passe. Un mot de passe en clair n'est jamais importé. Un compte dont l'id ou l'e-mail est déjà utilisé est marqué comme ignoré et laissé tel quel, jamais mis à jour, ce qui permet de réexécuter le fichier. Chaque compte est rapporté comme créé, ignoré ou échoué avec la raison associée ; la commande se termine par un code de sortie 1 si l'un d'eux a échoué. `--dry-run` vérifie chaque compte sans rien écrire. La CLI envoie 100 comptes par requête (`POST /api/admin/users/import`), aussi bien sur `rebase dev`, un serveur dédié ou un projet Rebase Cloud.

Depuis Supabase :

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified, encrypted_password from auth.users) to users.csv csv header"
rebase users import users.csv --password-hashes bcrypt --dry-run
rebase users import users.csv --password-hashes bcrypt --project my-app
```

`users.csv` contient alors le hash du mot de passe de chaque compte : supprimez-le une fois l'importation terminée.

## `rebase cron`

Les tâches planifiées de l'application (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` et `disable` surchargent le code de la tâche sur chaque processus, à travers les redéploiements ; `run` demande confirmation d'abord, et `--async` répond dès que l'exécution a commencé. Sur un projet Cloud, `rebase cron` ne nécessite aucun accès Studio pour les lectures : il demande au plan de contrôle un jeton de plateforme temporaire `cron:read`, détenu par tout membre ayant accès aux journaux. `run`, `enable`, `disable` et `reset` requièrent `cron:write`, que possède un propriétaire ou un administrateur d'organisation sur un projet dont Studio est activé. `rebase cloud cron` est l'ancienne syntaxe, en lecture seule.

## `rebase logs`

Le journal des requêtes et de l'application du serveur — le tampon lu par la vue Journaux (Logs) de Studio — en une fois, ou suivi en direct avec `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

Le tampon appartient à un seul processus. Avec `--project` ou `--cloud`, cela correspond à `rebase cloud logs --runtime` : la sortie de chaque réplica, via le plan de contrôle.

## `rebase functions`

Les routes propres à l'application, une par fichier dans `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` accepte les champs, corps et en-têtes acceptés par `rebase api`, et affiche la réponse telle qu'elle a été reçue. Les fonctions gèrent elles-mêmes leurs autorisations d'accès, le choix des identifiants a donc son importance : `--anon` montre ce qu'obtient un visiteur.

## `rebase storage`

Les fichiers stockés, soumis aux règles de stockage. Le chemin côté stockage commence par deux-points : `:avatars/me.png` dans la source par défaut, `media:avatars/me.png` dans la source nommée `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` téléverse sous le préfixe public (une URL permanente sans jeton), `--content-type` définit le type MIME, et `--force` écrase un fichier local lors d'un téléchargement. `orphans` et `move` constituent le volet de maintenance globale du stockage.

## `rebase rls simulate`

Ce qu'une autre identité verrait, via le simulateur RLS de l'application — celui utilisé par la fonction « view as » de Studio : par table, les lignes qu'elle lit par rapport à celles que vous lisez, les tables dont ses portées (scopes) l'excluent, et les colonnes qu'elle ne peut pas lire. En lecture seule.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

Le simulateur ne répond qu'à la session propre d'un administrateur et jamais à une clé ; cette commande envoie donc la session enregistrée par `rebase auth login`. `rebase verify --live` vérifie les règles elles-mêmes, sans identité particulière en tête.

## `rebase auth login`, `emails` et `keys`

Certaines routes ne répondent qu'à une personne et jamais à une machine : le simulateur RLS, les clés personnelles, l'application de schéma en direct. `rebase auth login` permet de se connecter à une application en cours d'exécution — via le navigateur lorsque le serveur propose l'authentification par appareil, sinon avec `--email` et un mot de passe (`--code` pour un second facteur) — et conserve la session dans `~/.rebase/sessions.json`, par serveur, jamais dans le projet. `auth whoami` indique l'identité sous laquelle le serveur vous reconnaît et les portées dont vous disposez ; `auth logout` met également fin à la session.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` lit la boîte de réception de développement qu'un serveur sans `SMTP_HOST` conserve au lieu d'envoyer les e-mails ; `--clear` la vide. Une boîte vide renvoie une réponse mentionnant le serveur interrogé (`The development mailbox at http://localhost:3082 (rebase dev) is empty.`, et `server` dans le JSON), car une réponse vide provenant d'un autre backend ressemblerait à un e-mail qui n'a jamais été envoyé. `auth keys` gère vos propres clés `rk_`, qui agissent en votre nom, restreintes aux portées spécifiées ; le serveur n'y répond que lorsque la table auth définit `auth.personalKeys: true`. Les clés de service se gèrent avec `rebase api-keys`, qui intègre également `update <id>`.

## `rebase mcp`

Connecter un client d'IA au propre point de terminaison MCP de l'application en cours d'exécution (`/mcp`), où un agent se connecte en tant que personne et est soumis à la sécurité au niveau des lignes de cette personne :

```bash
rebase mcp connect                        # pick the clients from a list
rebase mcp connect --client claude-code   # or name them: claude-code, cursor, vscode, claude, chatgpt, all
rebase mcp connect --print                # print every way to connect, change nothing
rebase mcp url                            # the endpoint's URL
```

| Option | Description |
|------|-------------|
| `--client <names>` | Ignorer le sélecteur. Séparés par des virgules, ou `all` |
| `--name <name>` | Le nom sous lequel enregistrer le serveur. Par défaut : le nom du projet, avec `-local` pour un serveur de dev |
| `--print` | Afficher l'URL, la commande Claude Code et les liens d'installation sans rien modifier |
| `--url <server>` | Le backend à cette adresse. Par défaut : `REBASE_BASE_URL`, sinon le `rebase dev` en cours d'exécution |
| `--cloud` | Le projet Rebase Cloud auquel ce répertoire est lié |
| `--json` | Sortie lisible par une machine |

`rebase mcp url` accepte `--url`, `--cloud` et `--json`. La manière dont chaque client utilise l'URL est décrite dans [Connecting a client](/docs/ai/remote-mcp/#connecting-a-client). Il ne s'agit pas du serveur MCP de développement situé dans `.mcp.json`, configuré par `rebase skills install --mcp`.

## Prochaines étapes

- [Index des points de terminaison](/docs/backend/endpoints/) — chaque route ciblée par ces commandes, et la portée requise par chacune
- [API REST](/docs/backend/api/) — la syntaxe de filtrage, de tri et de pagination relayée par `rebase data`
- [rebase cloud](/docs/cli/cloud/) — le projet lui-même sur Rebase Cloud : déploiements, environnement, sauvegardes, accès Studio
- [Référence de la CLI](/docs/cli/) — toutes les autres commandes
