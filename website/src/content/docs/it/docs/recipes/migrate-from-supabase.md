---
sourceHash: 76cb1578ad9289ff
title: "Guida: Migrazione da Supabase"
sidebar_label: Migrazione da Supabase
description: "Sposta un progetto Supabase su Rebase: effettua l'introspezione dello schema, applica gli oggetti SQL che non sono tabelle, copia i dati mantenendo gli ID utente, porta le edge function ed effettua il deployment, tutto da CLI."
---

## Panoramica

Questa guida sposta un progetto Supabase (tabelle, row-level security, funzioni e
trigger SQL, utenti, un bucket di storage, edge function) su un progetto Rebase,
prima in locale e poi su [Rebase Cloud](/docs/deployment/cloud/). Ogni operazione
è un comando CLI. Per continuare a utilizzare il database Supabase invece di
abbandonarlo, consulta [Supabase](/docs/deployment/existing-database/#supabase) nella
pagina relativa ai database esistenti.

L'ordine è fondamentale: genera le tabelle dall'origine (**source**), quindi punta il
progetto alla destinazione (**target**) prima di qualsiasi operazione di scrittura.

## 1. Genera le tabelle

Effettua l'introspezione del database Supabase, o di una sua copia locale. `SUPABASE_DB_URL`
qui sotto è la relativa stringa di connessione diretta, con il ruolo `postgres` (dashboard
di Supabase: Connect → Direct connection); impostala prima nella tua shell:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
rebase schema introspect --database-url "$SUPABASE_DB_URL" --from supabase
```

`--from supabase` converte ciò che un database Rebase non include:

| In Supabase | Scritto come |
|---|---|
| `owner_id uuid default auth.uid()` | `col.text().onCreateUser().userId()`: il server scrive l'ID del chiamante |
| `owner_id uuid references auth.users(id)` | `col.text().userId()`, e la chiave esterna elencata sotto "Not carried over" |
| `auth.uid()` in a policy | `rebase.uid()` |
| `TO authenticated` / `TO anon` | il ruolo viene rimosso e la regola richiede un chiamante autenticato / non autenticato |
| a policy only `TO service_role` | rimossa: il codice lato server viene eseguito nel contesto del server stesso |
| plain indexes | gli `indexes` della tabella |

Le colonne degli ID utente diventano `text` perché `rebase.users.id` e `rebase.uid()` sono
di tipo text: il confronto tra una colonna `uuid` e `rebase.uid()` in una policy fallirebbe.

L'esecuzione termina con un elenco di ciò che **non** è stato trasferito (funzioni,
trigger, estensioni, vincoli CHECK, altri indici, chiavi esterne composite)
e scrive il relativo codice SQL per ciascuno in `backend/sql/_introspected-left-behind.sql`, una
bozza che `rebase db push` non applica finché non viene rinominata.

## 2. Punta il progetto al nuovo database

`DATABASE_URL` fa ancora riferimento a Supabase dopo il passaggio 1, come indicato dall'output
di introspezione. Modificalo (oppure rimuovilo, per usare il database di sviluppo gestito)
prima del primo push:

```bash
rebase db push
```

## 3. Applica gli oggetti SQL

Modifica `backend/sql/_introspected-left-behind.sql` nello stesso modo in cui sono state
modificate le tabelle: `auth.uid()` → `rebase.uid()`, `auth.users` → `rebase.users`, niente
`GRANT … TO anon, authenticated`. Le funzioni che chiamavano `pg_net` sono più indicate come
[custom function](/docs/backend/custom-functions/). Rendi ogni istruzione sicura da
eseguire nuovamente (`DROP TRIGGER IF EXISTS` prima di ciascun `CREATE TRIGGER`), quindi rinomina
il file rimuovendo il carattere `_` iniziale ed effettua il push:

```bash
mv backend/sql/_introspected-left-behind.sql backend/sql/introspected.sql
rebase db push
```

`rebase db push` applica tutti i file `.sql` in `backend/sql` in ordine alfabetico, dopo
le tabelle e prima delle policy, e ne registra ciascuno tramite hash in
`rebase.sql_files`, così che un file venga eseguito nuovamente solo se modificato. Un deploy li
applica allo stesso modo (passaggio 8).

Una funzione che il browser richiamava con `supabase.rpc('fn')` viene dichiarata con
[`defineRpc`](/docs/backend/rpc/), accanto alle tabelle. Viene quindi esposta all'endpoint
`POST /api/rpc/<name>` ed eseguita con l'identità del chiamante sotto row-level security, quindi una
funzione `SECURITY DEFINER` si comporta esattamente come su Supabase:

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

Solo le funzioni dichiarate sono invocabili, e ciascuna funzione `public` è soggetta a rate limit.
Una funzione che esegue scritture richiede `write: true`.

## 4. Copia i dati, mantenendo gli ID utente

Mantieni gli ID utente di Supabase, in modo che ogni `owner_id` continui a puntare al relativo utente:
importa prima gli utenti, con i loro ID, e successivamente le tabelle dell'applicazione.
`rebase users import` crea gli account con gli ID che avevano in precedenza, con i relativi
hash delle password di Supabase quando passi `--password-hashes bcrypt`, non invia
email e salta gli account il cui ID o la cui email sono già presenti, permettendo quindi di rieseguire
il comando. Raggiunge Rebase Cloud come ogni altro comando `rebase users`
(`--project <slug>`, oppure `--cloud` in una directory collegata).

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified, encrypted_password from auth.users) to users.csv csv header"
rebase users import users.csv --password-hashes bcrypt --dry-run
rebase users import users.csv --password-hashes bcrypt
rm users.csv
```

Segnala ciascun account come creato, saltato o non riuscito con la relativa motivazione, ed
esce con codice 1 se uno qualsiasi fallisce. Consulta [Importing accounts](/docs/cli/project/#importing-accounts)
per le colonne che legge (anche `display_name` e `roles`).

Quindi le tabelle dell'applicazione, usando `pg_dump` verso la sorgente e la
destinazione. `TARGET_URL` è la stringa di connessione del nuovo database: la tua
`DATABASE_URL`, oppure su Rebase Cloud la `connectionString` che
`rebase cloud db connect --reveal` stampa durante l'esecuzione.

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
TARGET_URL="postgresql://…"   # the new database: your DATABASE_URL, or the tunnel's URL on Rebase Cloud
pg_dump "$SUPABASE_DB_URL" --data-only --schema=public --no-owner > data.sql
psql "$TARGET_URL" -f data.sql
```

Le password vengono trasferite sotto forma di hash. Supabase memorizza bcrypt in
`auth.users.encrypted_password`, quindi ogni utente accede con la password già
in suo possesso, con lo stesso ID di prima, e il primo accesso sostituisce
l'hash con quello proprietario di Rebase. Un account che non aveva password (magic link, un
provider) ha un `encrypted_password` vuoto e accede nello stesso modo di prima. Escludi
la colonna e il flag per importare senza password: quegli utenti accederanno
con magic link, codice email o reimpostazione della password.

## 5. Storage

Un bucket pubblico di Supabase corrisponde a una sorgente di [storage](/docs/backend/storage/)
con percorsi sotto `public/`, che vengono serviti senza token. Copia gli oggetti
con un qualsiasi client S3, mantenendo le rispettive chiavi.

## 6. Edge function

Una edge function Deno diventa una [custom function](/docs/backend/custom-functions/)
in `backend/functions/`. Le sostituzioni consuete:

| Supabase | Rebase |
|---|---|
| `Deno.serve(handler)` | `defineFunction((app) => app.post("/", handler))` |
| `Deno.env.get("X")` | `requireEnv(c, "X")` all'interno dell'handler |
| `createClient(url, serviceRoleKey)` | `rebase.dataAsAdmin` o `rebase.sql` sul server |
| a client with the user's JWT | `getSql(c)`: SQL come chiamante, sotto row-level security |
| `EdgeRuntime.waitUntil(p)` | `waitUntil(c, p)` ([operazioni in background](/docs/backend/background-work/)) |

Supabase consente l'esecuzione di una edge function per 150 s; il valore predefinito di Rebase è 30 s. Una
funzione che chiama un LLM dichiara il proprio timeout, che il server limita a
`REBASE_FUNCTIONS_MAX_TIMEOUT_MS` (300 s per impostazione predefinita):

```ts
export default defineFunction((app) => {
    app.post("/", handler);
}, { timeoutMs: 150_000 });
```

Passa `getSignal(c)` alla `fetch` che chiama il modello, in modo che la chiamata si interrompa
quando termina la richiesta. Consulta [il timeout specifico di una funzione](/docs/backend/custom-functions/#timeouts-and-rate-limits).

## 7. Email di accesso

L'accesso tramite magic link e codice email richiede un servizio email. Imposta `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` (`rebase cloud env set`
su Cloud). Senza queste variabili, la route risponde 503 e `rebase cloud status`
segnala `blockedOn: email_not_configured`.

## 8. Deploy

```bash
rebase cloud projects create --name Triptelier --link
rebase cloud deploy
```

Il deploy applica `backend/sql` esattamente come fa `rebase db push`: il bundle include
i file, e l'avvio della nuova revisione esegue ogni file nuovo o modificato una sola volta, dopo
le tabelle e prima delle policy. Se un file fallisce, blocca l'avvio e indica
il nome del file, così che un errore si manifesti durante il deploy e non in un'app già in esecuzione.
