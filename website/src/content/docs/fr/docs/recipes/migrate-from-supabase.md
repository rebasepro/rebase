---
sourceHash: eda5c036273f52d9
title: "Recette : Migrer depuis Supabase"
sidebar_label: Migrer depuis Supabase
description: "Migrez un projet Supabase vers Rebase : introspectez le schéma, appliquez les objets SQL qui ne sont pas des tables, copiez les données en conservant les identifiants utilisateurs, portez les fonctions edge et déployez, le tout depuis la CLI."
---

## Vue d'ensemble

Ce guide permet de migrer un projet Supabase (tables, row-level security, fonctions et
déclencheurs SQL, utilisateurs, un bucket de stockage, edge functions) vers un projet Rebase,
d'abord en local puis sur [Rebase Cloud](/docs/deployment/cloud/). Tout
s'effectue via des commandes CLI. Pour continuer à fonctionner sur la base de données Supabase au lieu de
la quitter, consultez [Supabase](/docs/deployment/existing-database/#supabase) sur la
page des bases de données existantes.

L'ordre a son importance : générez les tables depuis la **source**, puis faites
pointer le projet vers la **cible** avant toute opération d'écriture.

## 1. Générer les tables

Introspectez la base de données Supabase, ou une copie locale de celle-ci. `SUPABASE_DB_URL`
ci-dessous est sa chaîne de connexion directe, avec le rôle `postgres` (tableau de bord de
Supabase : Connect → Direct connection) ; définissez-la d'abord dans votre shell :

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
rebase schema introspect --database-url "$SUPABASE_DB_URL" --from supabase
```

`--from supabase` traduit ce qu'une base de données Rebase ne possède pas :

| Dans Supabase | Écrit sous la forme |
|---|---|
| `owner_id uuid default auth.uid()` | `col.text().onCreateUser().userId()` : le serveur écrit l'id de l'appelant |
| `owner_id uuid references auth.users(id)` | `col.text().userId()`, et la clé étrangère listée sous « Not carried over » |
| `auth.uid()` dans une policy | `rebase.uid()` |
| `TO authenticated` / `TO anon` | le rôle est supprimé et la règle requiert un appelant connecté / non connecté |
| une policy uniquement `TO service_role` | supprimée : le code serveur s'exécute dans le propre contexte du serveur |
| index simples | les `indexes` de la table |

Les colonnes d'identifiant utilisateur deviennent `text` car `rebase.users.id` et `rebase.uid()` sont
de type text : comparer une colonne `uuid` avec `rebase.uid()` dans une policy échoue.

L'exécution se termine par la liste de ce qui n'a **pas** été reporté (fonctions,
déclencheurs, extensions, contraintes CHECK, autres index, clés étrangères composites)
et écrit le SQL correspondant dans `backend/sql/introspected-left-behind.sql`.

## 2. Pointer le projet vers la nouvelle base de données

`DATABASE_URL` pointe toujours vers Supabase après l'étape 1, et la sortie de l'introspection
l'indique. Modifiez-la (ou supprimez-la pour utiliser la base de données de développement gérée)
avant le premier push :

```bash
rebase db push
```

## 3. Appliquer les objets SQL

Modifiez `backend/sql/introspected-left-behind.sql` de la même manière que les tables ont été
modifiées : `auth.uid()` → `rebase.uid()`, `auth.users` → `rebase.users`, pas de
`GRANT … TO anon, authenticated`. Les fonctions qui faisaient appel à `pg_net` sont plus adaptées sous forme de
[fonction personnalisée](/docs/backend/custom-functions/). Appliquez-le ensuite :

```bash
psql "$DATABASE_URL" -f backend/sql/introspected-left-behind.sql
# on Rebase Cloud, with no local psql:
rebase cloud db query --file backend/sql/introspected-left-behind.sql
```

Une fonction appelée par le navigateur avec `supabase.rpc('fn')` est déclarée avec
<span class="since-badge" data-since="0.35">Depuis 0.35</span> [`defineRpc`](/docs/backend/rpc/), aux côtés des tables. Elle est ensuite servie sur
`POST /api/rpc/<name>` et s'exécute en tant qu'appelant sous row-level security, de sorte qu'une
fonction `SECURITY DEFINER` se comporte comme elle le faisait sur Supabase :

```ts
// backend/schema/rpc.ts, exported from backend/schema/index.ts
import { defineRpc, json } from "@rebasepro/server/schema";

export const getPublicProposal = defineRpc("get_public_proposal", {
    access: "public",                         // supabase's anon key; "authenticated" for signed-in only
    args: { token: json.string().required() } // validated before the function runs
});
```

```ts
// in the browser: supabase.rpc("get_public_proposal", { token })
const proposal = await rebase.rpc("get_public_proposal", { token });
```

Seules les fonctions déclarées peuvent être appelées, et chacune de celles qui sont `public` est soumise à un rate limiting.
Une fonction qui effectue des écritures requiert `write: true`.

## 4. Copier les données en conservant les identifiants utilisateurs

Conservez les identifiants utilisateurs de Supabase pour que chaque `owner_id` pointe toujours vers son utilisateur :
importez d'abord les utilisateurs avec leurs identifiants, puis les tables applicatives.
`rebase users import` crée les comptes sous les identifiants qu'ils avaient, sans
mot de passe et sans envoyer d'e-mail, et ignore ceux dont l'identifiant ou l'e-mail est déjà présent,
ce qui permet de la réexécuter. La commande communique avec Rebase Cloud comme toute autre
commande `rebase users` (`--project <slug>`, ou `--cloud` dans un répertoire lié).

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified from auth.users) to users.csv csv header"
rebase users import users.csv --dry-run
rebase users import users.csv
```

La commande indique pour chaque compte s'il a été créé, ignoré ou s'il a échoué avec la raison, et
renvoie le code 1 en cas d'échec. Consultez [Importer des comptes](/docs/cli/project/#importing-accounts)
pour connaître les colonnes lues (`display_name` et `roles` également).

Ensuite, transférez les tables applicatives à l'aide de `pg_dump` sur la source et la
cible. `TARGET_URL` est la chaîne de connexion de la nouvelle base de données : votre
`DATABASE_URL`, ou sur Rebase Cloud la valeur `connectionString` affichée par
`rebase cloud db connect --reveal` pendant son exécution.

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
TARGET_URL="postgresql://…"   # the new database: your DATABASE_URL, or the tunnel's URL on Rebase Cloud
pg_dump "$SUPABASE_DB_URL" --data-only --schema=public --no-owner > data.sql
psql "$TARGET_URL" -f data.sql
```

Les mots de passe ne sont pas transférés. Un utilisateur importé se connecte via un lien magique, un code
par e-mail ou une réinitialisation de mot de passe, avec le même identifiant qu'auparavant.

## 5. Stockage

Un bucket Supabase public correspond à une source de [stockage](/docs/backend/storage/)
avec des chemins sous `public/`, qui sont servis sans jeton. Copiez les objets
avec n'importe quel client S3, en conservant leurs clés.

## 6. Edge functions

Une edge function Deno devient une [fonction personnalisée](/docs/backend/custom-functions/)
dans `backend/functions/`. Les équivalences habituelles :

| Supabase | Rebase |
|---|---|
| `Deno.serve(handler)` | `defineFunction((app) => app.post("/", handler))` |
| `Deno.env.get("X")` | `requireEnv(c, "X")` dans le gestionnaire |
| `createClient(url, serviceRoleKey)` | `rebase.dataAsAdmin` ou `rebase.sql` sur le serveur |
| un client avec le JWT de l'utilisateur | `getSql(c)` : SQL en tant qu'appelant, sous row-level security |
| `EdgeRuntime.waitUntil(p)` | `waitUntil(c, p)` ([tâches en arrière-plan](/docs/backend/background-work/)) |

Supabase autorise une edge function à s'exécuter pendant 150 s ; la valeur par défaut de Rebase est de 30 s. Une
fonction appelant un LLM déclare son propre délai d'expiration (timeout), plafonné par le serveur à
`REBASE_FUNCTIONS_MAX_TIMEOUT_MS` (300 s par défaut) :

```ts
export default defineFunction((app) => {
    app.post("/", handler);
}, { timeoutMs: 150_000 });
```

Transmettez `getSignal(c)` au `fetch` qui appelle le modèle, de sorte que l'appel s'interrompe
lorsque la requête prend fin. Consultez [le timeout propre à une fonction](/docs/backend/custom-functions/#timeouts-and-rate-limits).

## 7. E-mail de connexion

La connexion par lien magique et par code envoyé par e-mail nécessite un service d'envoi d'e-mails. Définissez `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` et `SMTP_FROM` (`rebase cloud env set`
sur Cloud). Sans ces variables, la route répond 503, et `rebase cloud status`
indique `blockedOn: email_not_configured`.

## 8. Déployer

```bash
rebase cloud projects create --name Triptelier --link
rebase cloud deploy
rebase cloud db query --file backend/sql/introspected-left-behind.sql
```
