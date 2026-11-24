---
sourceHash: 76cb1578ad9289ff
title: "Recette : Migrer depuis Supabase"
sidebar_label: Migrer depuis Supabase
description: "Transférez un projet Supabase vers Rebase : introspectez le schéma, appliquez les objets SQL qui ne sont pas des tables, copiez les données en conservant les identifiants d'utilisateurs, portez les edge functions et déployez, le tout depuis le CLI."
---

## Vue d'ensemble

Ce guide permet de migrer un projet Supabase (tables, sécurité au niveau des lignes (row-level security), fonctions et déclencheurs SQL, utilisateurs, bucket de stockage, edge functions) vers un projet Rebase, d'abord en local puis sur [Rebase Cloud](/docs/deployment/cloud/). Tout s'effectue via des commandes CLI. Pour continuer à fonctionner sur la base de données Supabase au lieu de la quitter, consultez [Supabase](/docs/deployment/existing-database/#supabase) sur la page consacrée aux bases de données existantes.

L'ordre des opérations est important : générez les tables depuis la **source**, puis faites pointer le projet vers la **cible** avant toute écriture.

## 1. Générer les tables

Introspectez la base de données Supabase, ou une copie locale de celle-ci. `SUPABASE_DB_URL` ci-dessous représente sa chaîne de connexion directe, avec le rôle `postgres` (tableau de bord de Supabase : Connect → Direct connection) ; définissez-la d'abord dans votre shell :

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
rebase schema introspect --database-url "$SUPABASE_DB_URL" --from supabase
```

`--from supabase` traduit ce qu'une base de données Rebase ne possède pas :

| Dans Supabase | Écrit sous la forme |
|---|---|
| `owner_id uuid default auth.uid()` | `col.text().onCreateUser().userId()` : le serveur écrit l'identifiant de l'appelant |
| `owner_id uuid references auth.users(id)` | `col.text().userId()`, et la clé étrangère listée sous « Non reporté » |
| `auth.uid()` dans une politique | `rebase.uid()` |
| `TO authenticated` / `TO anon` | le rôle est supprimé et la règle exige un appelant connecté / déconnecté |
| une politique uniquement `TO service_role` | supprimée : le code serveur s'exécute dans le propre contexte du serveur |
| index simples | les `indexes` de la table |

Les colonnes d'identifiant utilisateur deviennent `text` car `rebase.users.id` et `rebase.uid()` sont de type text : une colonne `uuid` comparée à `rebase.uid()` dans une politique échoue.

L'exécution se termine par une liste de ce qui n'a **pas** été reporté (fonctions, déclencheurs, extensions, contraintes CHECK, autres index, clés étrangères composites) et écrit le code SQL correspondant dans `backend/sql/_introspected-left-behind.sql`, un brouillon que `rebase db push` n'applique pas tant que vous ne l'avez pas renommé.

## 2. Pointer le projet vers la nouvelle base de données

`DATABASE_URL` désigne toujours Supabase après l'étape 1, et la sortie de l'introspection le signale. Modifiez-la (ou supprimez-la pour utiliser la base de données de développement gérée) avant le premier push :

```bash
rebase db push
```

## 3. Appliquer les objets SQL

Modifiez `backend/sql/_introspected-left-behind.sql` de la même manière que les tables ont été adaptées : `auth.uid()` → `rebase.uid()`, `auth.users` → `rebase.users`, aucun `GRANT … TO anon, authenticated`. Les fonctions qui appelaient `pg_net` sont plus adaptées sous la forme d'une [fonction personnalisée](/docs/backend/custom-functions/). Rendez chaque instruction réexécutable en toute sécurité (`DROP TRIGGER IF EXISTS` avant chaque `CREATE TRIGGER`), puis renommez le fichier en supprimant le `_` initial et poussez :

```bash
mv backend/sql/_introspected-left-behind.sql backend/sql/introspected.sql
rebase db push
```

`rebase db push` applique chaque fichier `.sql` dans `backend/sql` par ordre alphabétique, après les tables et avant les politiques, et enregistre chacun d'eux par son hachage dans `rebase.sql_files`, afin qu'un fichier ne soit réexécuté que lorsqu'il change. Un déploiement les applique de la même manière (étape 8).

Une fonction que le navigateur appelait avec `supabase.rpc('fn')` est déclarée avec [`defineRpc`](/docs/backend/rpc/), aux côtés des tables. Elle est ensuite servie sur `POST /api/rpc/<name>` et s'exécute en tant qu'appelant sous la sécurité au niveau des lignes, de sorte qu'une fonction `SECURITY DEFINER` se comporte comme elle le faisait sur Supabase :

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

Seules les fonctions déclarées peuvent être appelées, et chaque fonction `public` fait l'objet d'une limitation de débit. Celles qui effectuent des écritures nécessitent `write: true`.

## 4. Copier les données en conservant les identifiants d'utilisateurs

Conservez les identifiants d'utilisateurs Supabase afin que chaque `owner_id` pointe toujours vers son utilisateur : importez d'abord les utilisateurs avec leurs identifiants, puis les tables applicatives. `rebase users import` crée les comptes sous les identifiants qu'ils avaient, avec leurs hachages de mot de passe Supabase lorsque vous transmettez `--password-hashes bcrypt`, n'envoie aucun e-mail et ignore les comptes dont l'identifiant ou l'e-mail est déjà présent, ce qui permet de réexécuter la commande. Elle contacte Rebase Cloud comme toute autre commande `rebase users` (`--project <slug>`, ou `--cloud` dans un répertoire lié).

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified, encrypted_password from auth.users) to users.csv csv header"
rebase users import users.csv --password-hashes bcrypt --dry-run
rebase users import users.csv --password-hashes bcrypt
rm users.csv
```

La commande indique pour chaque compte s'il a été créé, ignoré ou s'il a échoué avec la raison associée, et renvoie le code de sortie 1 en cas d'échec. Consultez [Importation de comptes](/docs/cli/project/#importing-accounts) pour connaître les colonnes prises en charge (`display_name` et `roles` également).

Ensuite, importez les tables applicatives à l'aide de `pg_dump` entre la source et la cible. `TARGET_URL` est la chaîne de connexion de la nouvelle base de données : votre `DATABASE_URL`, ou sur Rebase Cloud la valeur `connectionString` affichée par `rebase cloud db connect --reveal` pendant son exécution.

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
TARGET_URL="postgresql://…"   # the new database: your DATABASE_URL, or the tunnel's URL on Rebase Cloud
pg_dump "$SUPABASE_DB_URL" --data-only --schema=public --no-owner > data.sql
psql "$TARGET_URL" -f data.sql
```

Les mots de passe sont transférés sous forme de hachages. Supabase stocke bcrypt dans `auth.users.encrypted_password`, ainsi chaque utilisateur se connecte avec son mot de passe existant, sous le même identifiant qu'auparavant, et sa première connexion remplace le hachage par celui de Rebase. Un compte sans mot de passe (magic link, fournisseur tiers) possède un champ `encrypted_password` vide et se connecte de la même manière qu'auparavant. Omettez la colonne et l'option pour importer sans mots de passe : ces utilisateurs se connecteront alors par magic link, code par e-mail ou réinitialisation de mot de passe.

## 5. Stockage

Un bucket Supabase public correspond à une source de [stockage](/docs/backend/storage/) dont les chemins sont situés sous `public/`, qui sont servis sans jeton. Copiez les objets à l'aide de n'importe quel client S3, en conservant leurs clés.

## 6. Edge functions

Une edge function Deno devient une [fonction personnalisée](/docs/backend/custom-functions/) dans `backend/functions/`. Voici les équivalences habituelles :

| Supabase | Rebase |
|---|---|
| `Deno.serve(handler)` | `defineFunction((app) => app.post("/", handler))` |
| `Deno.env.get("X")` | `requireEnv(c, "X")` à l'intérieur du gestionnaire |
| `createClient(url, serviceRoleKey)` | `rebase.dataAsAdmin` ou `rebase.sql` sur le serveur |
| un client avec le JWT de l'utilisateur | `getSql(c)` : SQL en tant qu'appelant, sous la sécurité au niveau des lignes |
| `EdgeRuntime.waitUntil(p)` | `waitUntil(c, p)` ([tâches d'arrière-plan](/docs/backend/background-work/)) |

Supabase autorise une durée d'exécution de 150 s pour une edge function ; la valeur par défaut de Rebase est de 30 s. Une fonction qui appelle un LLM déclare son propre délai d'expiration (timeout), plafonné par le serveur à `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` (300 s par défaut) :

```ts
export default defineFunction((app) => {
    app.post("/", handler);
}, { timeoutMs: 150_000 });
```

Transmettez `getSignal(c)` au `fetch` qui appelle le modèle, afin que l'appel s'interrompe lorsque la requête s'arrête. Consultez [le timeout propre d'une fonction](/docs/backend/custom-functions/#timeouts-and-rate-limits).

## 7. E-mail de connexion

La connexion par magic link et par code envoyé par e-mail nécessite un service de messagerie. Définissez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` et `SMTP_FROM` (`rebase cloud env set` sur le Cloud). Sans ces variables, la route renvoie un code 503, et `rebase cloud status` indique `blockedOn: email_not_configured`.

## 8. Déploiement

```bash
rebase cloud projects create --name Triptelier --link
rebase cloud deploy
```

Le déploiement applique `backend/sql` de la même manière que `rebase db push` : le bundle inclut les fichiers, et le démarrage de la nouvelle révision exécute chaque fichier nouveau ou modifié une seule fois, après les tables et avant les politiques. Un fichier qui échoue interrompt le démarrage et est explicitement nommé, ce qui permet de détecter une erreur dès le déploiement plutôt que sur une application en production.
