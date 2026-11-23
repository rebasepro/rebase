---
sourceHash: 4acb34e54a96f397
title: "Ricetta: Migrazione da Supabase"
sidebar_label: Migrazione da Supabase
description: "Trasferisci un progetto Supabase su Rebase: esegui l'introspezione dello schema, applica gli oggetti SQL che non sono tabelle, copia i dati mantenendo gli ID utente, porta le edge function ed effettua il deploy, tutto dalla CLI."
---

## Panoramica

Questa guida sposta un progetto Supabase (tabelle, row-level security, funzioni SQL e trigger, utenti, un bucket di storage, edge function) su un progetto Rebase, prima localmente e poi su [Rebase Cloud](/docs/deployment/cloud/). Tutto viene gestito tramite comandi CLI. Per continuare a utilizzare il database Supabase invece di abbandonarlo, consulta [Supabase](/docs/deployment/existing-database/#supabase) nella pagina dei database esistenti.

L'ordine è importante: genera le tabelle dall'origine (**source**), quindi punta il progetto alla destinazione (**target**) prima di qualsiasi operazione di scrittura.

## 1. Genera le tabelle

Esegui l'introspezione del database Supabase, o di una sua copia locale. Di seguito `SUPABASE_DB_URL` rappresenta la sua stringa di connessione diretta, con il ruolo `postgres` (dashboard di Supabase: Connect → Direct connection); impostala prima nella tua shell:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
rebase schema introspect --database-url "$SUPABASE_DB_URL" --from supabase
```

`--from supabase` traduce ciò che un database Rebase non ha:

| In Supabase | Scritto come |
|---|---|
| `owner_id uuid default auth.uid()` | `col.text().onCreateUser().userId()`: il server scrive l'ID del chiamante |
| `owner_id uuid references auth.users(id)` | `col.text().userId()`, e la chiave esterna elencata sotto "Not carried over" |
| `auth.uid()` in una policy | `rebase.uid()` |
| `TO authenticated` / `TO anon` | il ruolo viene rimosso e la regola richiede un chiamante autenticato / non autenticato |
| una policy solo `TO service_role` | rimossa: il codice server viene eseguito nel contesto proprio del server |
| indici semplici | gli `indexes` della tabella |

Le colonne degli ID utente diventano `text` perché `rebase.users.id` e `rebase.uid()` sono di tipo text: il confronto tra una colonna `uuid` e `rebase.uid()` in una policy fallisce.

L'esecuzione termina con un elenco di ciò che **non** è stato trasferito (funzioni, trigger, estensioni, vincoli CHECK, altri indici, chiavi esterne composite) e scrive l'SQL corrispondente in `backend/sql/_introspected-left-behind.sql`, una bozza che `rebase db push` non applica finché non la rinomini.

## 2. Punta il progetto al nuovo database

Dopo il passaggio 1 `DATABASE_URL` punta ancora a Supabase, come indicato dall'output dell'introspezione. Modificala (oppure rimuovila, per utilizzare il database di sviluppo gestito) prima del primo push:

```bash
rebase db push
```

## 3. Applica gli oggetti SQL

Modifica `backend/sql/_introspected-left-behind.sql` nello stesso modo in cui sono state modificate le tabelle: `auth.uid()` → `rebase.uid()`, `auth.users` → `rebase.users`, nessun `GRANT … TO anon, authenticated`. Le funzioni che chiamavano `pg_net` funzionano meglio come [custom function](/docs/backend/custom-functions/). Rendi ogni istruzione rieseguibile senza danni (`DROP TRIGGER IF EXISTS` prima di ogni `CREATE TRIGGER`), poi rinomina il file senza il `_` iniziale ed esegui il push:

```bash
mv backend/sql/_introspected-left-behind.sql backend/sql/introspected.sql
rebase db push
```

`rebase db push` applica ogni file `.sql` in `backend/sql` in ordine alfabetico di nome, dopo le tabelle e prima delle policy, e registra ciascuno per hash in `rebase.sql_files`, così un file viene eseguito di nuovo solo quando cambia. Un deploy li applica allo stesso modo (passo 8).

Una funzione che il browser chiamava con `supabase.rpc('fn')` viene dichiarata con [`defineRpc`](/docs/backend/rpc/), accanto alle tabelle. Viene quindi servita all'indirizzo `POST /api/rpc/<name>` ed eseguita come il chiamante sotto row-level security, così una funzione `SECURITY DEFINER` si comporta come faceva su Supabase:

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

Solo le funzioni dichiarate sono chiamabili, e ognuna di quelle `public` è soggetta a rate limit. Una funzione che effettua scritture necessita di `write: true`.

## 4. Copia i dati, mantenendo gli ID utente

Mantieni gli ID utente di Supabase, in modo che ogni `owner_id` continui a puntare al proprio utente: importa prima gli utenti, con i loro ID, e poi le tabelle dell'applicazione. `rebase users import` crea gli account con gli ID che avevano, senza password e senza inviare email, e salta quelli il cui ID o email è già presente, quindi può essere rieseguito. Raggiunge Rebase Cloud come ogni altro comando `rebase users` (`--project <slug>`, o `--cloud` in una directory collegata).

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified from auth.users) to users.csv csv header"
rebase users import users.csv --dry-run
rebase users import users.csv
```

Riporta ogni account come creato, saltato o non riuscito specificandone il motivo, ed esce con codice 1 se uno qualsiasi fallisce. Consulta [Importazione degli account](/docs/cli/project/#importing-accounts) per le colonne che legge (anche `display_name` e `roles`).

Successivamente le tabelle dell'applicazione, usando `pg_dump` su origine e destinazione. `TARGET_URL` è la stringa di connessione del nuovo database: la tua `DATABASE_URL`, oppure su Rebase Cloud la `connectionString` stampata da `rebase cloud db connect --reveal` durante l'esecuzione.

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
TARGET_URL="postgresql://…"   # the new database: your DATABASE_URL, or the tunnel's URL on Rebase Cloud
pg_dump "$SUPABASE_DB_URL" --data-only --schema=public --no-owner > data.sql
psql "$TARGET_URL" -f data.sql
```

Le password non vengono trasferite. Un utente importato accede tramite un magic link, un codice via email o una reimpostazione della password, mantenendo lo stesso ID di prima.

## 5. Storage

Un bucket Supabase pubblico corrisponde a una sorgente [storage](/docs/backend/storage/) con percorsi sotto `public/`, che vengono serviti senza token. Copia gli oggetti con qualsiasi client S3, mantenendo le rispettive chiavi.

## 6. Edge function

Una edge function Deno diventa una [custom function](/docs/backend/custom-functions/) in `backend/functions/`. Le consuete sostituzioni:

| Supabase | Rebase |
|---|---|
| `Deno.serve(handler)` | `defineFunction((app) => app.post("/", handler))` |
| `Deno.env.get("X")` | `requireEnv(c, "X")` all'interno dell'handler |
| `createClient(url, serviceRoleKey)` | `rebase.dataAsAdmin` o `rebase.sql` sul server |
| un client con il JWT dell'utente | `getSql(c)`: SQL come il chiamante, sotto row-level security |
| `EdgeRuntime.waitUntil(p)` | `waitUntil(c, p)` ([attività in background](/docs/backend/background-work/)) |

Supabase consente a una edge function di essere eseguita per 150 s; il valore predefinito di Rebase è 30 s. Una funzione che chiama un LLM dichiara il proprio timeout, che il server limita a `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` (300 s per impostazione predefinita):

```ts
export default defineFunction((app) => {
    app.post("/", handler);
}, { timeoutMs: 150_000 });
```

Passa `getSignal(c)` alla `fetch` che chiama il modello, in modo che la chiamata si interrompa all'interruzione della richiesta. Consulta [il timeout specifico di una funzione](/docs/backend/custom-functions/#timeouts-and-rate-limits).

## 7. Email di accesso

L'accesso tramite magic link e codice via email richiede un servizio email. Imposta `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` (`rebase cloud env set` su Cloud). Senza queste variabili la route restituisce 503 e `rebase cloud status` segnala `blockedOn: email_not_configured`.

## 8. Deploy

```bash
rebase cloud projects create --name Triptelier --link
rebase cloud deploy
```

Il deploy applica `backend/sql` come fa `rebase db push`: il bundle include i file, e all'avvio la nuova revisione esegue una sola volta ciascun file nuovo o modificato, dopo le tabelle e prima delle policy. Un file che fallisce ferma l'avvio e ne indica il nome, così un errore in uno di essi emerge nel deploy e non in un'app già in esecuzione.
