---
sourceHash: 3daf2012ee7cd662
title: Funzioni SQL come RPC
sidebar_label: Funzioni SQL (RPC)
description: "Esponi una funzione Postgres su POST /api/rpc/<name> con defineRpc: dichiarata per funzione, argomenti convalidati, eseguita come chiamante sotto row-level security, funzioni pubbliche con rate limiting."
---

<span class="since-badge" data-since="0.35">Da 0.35</span>

Una funzione SQL dichiarata con `defineRpc` viene servita su `POST /api/rpc/<name>`,
con i suoi argomenti con nome come corpo JSON. Viene eseguita con l'identità del chiamante,
allo stesso modo di `getSql(c)`: un chiamante anonimo come identità anonima, uno autenticato
come se stesso, in modo che la row-level security delle tabelle sia applicata all'interno della funzione,
e una funzione `SECURITY DEFINER` viene eseguita come il suo proprietario. Questo è ciò che
fa `supabase.rpc('fn', args)`, senza dover scrivere un handler per ogni funzione.

Solo le funzioni dichiarate sono invocabili. Una funzione presente nel database ma che nessuno
ha dichiarato risponde con `404 RPC_NOT_FOUND`.

## Dichiararne una

<span class="since-badge" data-since="0.35">Da 0.35</span>

Le dichiarazioni risiedono accanto alle tabelle, in `backend/schema/`, e l'indice dello schema
le esporta:

```typescript
// backend/schema/rpc.ts
import { defineRpc, json } from "@rebasepro/server/schema";

export const getPublicProposal = defineRpc("get_public_proposal", {
    access: "public",
    args: { token: json.string().required() }
});

export const myTrips = defineRpc("my_trips", {
    access: "authenticated",
    args: { from: json.date(), limit: json.number().validate({ integer: true, max: 100 }) }
});

export const bookTrip = defineRpc("book_trip", {
    access: "authenticated",
    write: true,
    args: { trip_id: json.number().required() }
});
```

```typescript
// backend/schema/index.ts
export * from "./rpc";
```

La funzione stessa è codice SQL creato nel database, ad esempio da un file
all'interno di `backend/sql/`:

```sql
CREATE OR REPLACE FUNCTION public.get_public_proposal(token text)
RETURNS public.proposals
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM public.proposals p WHERE p.share_token = get_public_proposal.token $$;
```

Il nome corrisponde al nome della funzione così come memorizzato da Postgres (un
`CREATE FUNCTION getProposal` non tra virgolette viene memorizzato come `getproposal`), ed è anche il
segmento dell'URL. Il valore predefinito di `schema` è `"public"`. Come per una tabella, una RPC definita in un file
sotto `backend/schema/` che l'indice non esporta blocca l'avvio, così come
un nome dichiarato due volte.

| Opzione | Significato |
|---|---|
| `access` | Obbligatorio. `"public"`: chiunque, autenticato o meno, sempre soggetto a rate limiting. `"authenticated"`: qualsiasi chiamante con un'identità (una sessione, una sessione guest, una chiave API, la service key); un chiamante anonimo riceve `401` |
| `args` | Gli argomenti con nome, un campo `json.*` per ogni parametro SQL. Se assente: la funzione non accetta parametri |
| `schema` | Lo schema Postgres in cui si trova la funzione. Predefinito: `"public"` |
| `write` | Esegue la chiamata in lettura-scrittura. Disattivato per impostazione predefinita: la chiamata è di sola lettura e può essere servita da una read replica |
| `rateLimit` | `{ limit, windowMs }` per chiamante per questa funzione. Una RPC pubblica senza questa opzione è limitata a 120 chiamate al minuto |
| `description` | Cosa fa, a beneficio di chi legge le dichiarazioni |

## Chiamarne una

Dall'SDK:

```typescript
const proposal = await rebase.rpc<Proposal | null>("get_public_proposal", { token });
const trips = await rebase.rpc<Trip[]>("my_trips", { limit: 20 });
```

Tramite HTTP:

```bash
curl -X POST https://your-app.example.com/api/rpc/get_public_proposal \
  -H "content-type: application/json" \
  -d '{"token": "f1c2…"}'
```

Una chiamata autenticata invia il proprio token come su ogni altra route. Gli argomenti possono essere
tipizzati a partire dalla dichiarazione, che il frontend importa unicamente come tipo:

```typescript
import type { RpcArgs } from "@rebasepro/server/schema";
import type { myTrips } from "../../backend/schema/rpc";

const args: RpcArgs<typeof myTrips> = { limit: 20 };
const trips = await rebase.rpc<Trip[]>("my_trips", args);
```

## Argomenti

Il corpo della richiesta viene confrontato con `args` prima che qualsiasi dato raggiunga il database. Una chiave
non nominata in `args`, un argomento `.required()` mancante e un valore
del tipo errato (un numero per `json.string()`, una stringa che non è una data per
`json.date()`) vengono rifiutati insieme a `400 VALIDATION_CONSTRAINT`, con ogni
violazione che indica il relativo campo (`filters.from`, `tags[2]`). Si applicano anche
le regole supportate da una colonna JSON: `.validate({ min, max, pattern, … })`, `.oneOf([...])`.

Un argomento omesso non viene passato, pertanto viene applicato il `DEFAULT`
della funzione SQL stessa; un `.default(value)` sul campo lo sostituisce con tale valore. Un argomento inviato come
`null` viene passato come `NULL`.

I valori raggiungono la funzione sotto forma di un unico parametro associato (bound parameter), un oggetto JSON che
Postgres converte nei tipi di parametro della funzione (`json_to_record`), trasformando quindi
un array in un `integer[]`, un oggetto in un `jsonb`, una stringa ISO in un
`timestamptz`. Non vengono mai inseriti direttamente nel testo dell'istruzione SQL. Un valore che
Postgres non riesce a interpretare come tipo di parametro restituisce `400 RPC_INVALID_ARGUMENT`.

## Cosa restituisce

La risposta segue il tipo di ritorno della funzione, come in PostgREST:

| La funzione restituisce | La risposta |
|---|---|
| `SETOF <table>`, `TABLE (…)` | un array di righe |
| `SETOF integer` (qualsiasi valore singolo) | un array di valori |
| un tipo di riga, o parametri `OUT` | la riga, o `null` se è `NULL` |
| un valore singolo (`bigint`, `text`, `jsonb`, …) | il valore |
| `void` | `null` |

I valori sono formattati come in `/api/data`: un `timestamptz` in RFC 3339, un
`bigint` come numero quando la dimensione lo consente.

## Con quale identità viene eseguita

Ciascuna chiamata apre una transazione con l'identità del chiamante, la stessa utilizzata
dall'API dati; quindi una funzione `SECURITY INVOKER` (predefinita) vede esattamente le righe
consentite dalle policy del chiamante, e `rebase.uid()` al suo interno corrisponde al chiamante.
Un chiamante anonimo di una RPC pubblica viene eseguito con l'identità anonima: una policy
che richiede un utente gli nasconderà ogni riga. Una funzione `SECURITY DEFINER`
viene eseguita con il ruolo proprietario, consentendo a una funzione di restituire a un
chiamante anonimo una singola riga tramite token senza dovergli aprire l'intera tabella.

Una chiave API con permessi limitati necessita di `data:read` per chiamare una RPC, o di
`data:write` per una dichiarata con `write: true`, senza distinzioni di tabella: una funzione legge
qualsiasi tabella a cui accede.

## Operazioni di scrittura (Writes)

Una chiamata viene eseguita in sola lettura a meno che la RPC non specifichi `write: true`. Una funzione che
esegue inserimenti, aggiornamenti o eliminazioni senza questo flag fallisce con `500 RPC_READ_ONLY`. Una scrittura
deve comunque superare le policy di inserimento e aggiornamento delle tabelle per il chiamante.

## Rate limit

Ogni RPC `public` ha un rate limit per chiamante (per ID utente se autenticato, altrimenti
per indirizzo): 120 chiamate al minuto a meno che non dichiari `rateLimit`. Il conteggio risiede
dove il backend conserva i propri [rate limit delle funzioni](/docs/backend/function-rate-limits/),
quindi `REBASE_RATE_LIMIT_STORE=sql` lo condivide tra le repliche. Superato il limite, la chiamata
risponde con `429 RATE_LIMITED` e l'header `Retry-After`. Le chiamate consumano anche il budget
dell'API dati del chiamante. Una RPC `authenticated` è limitata solo quando dichiara
`rateLimit`.

## Errori dalla funzione

`RAISE EXCEPTION 'This proposal has expired'` risponde con `400 RPC_EXCEPTION`
riportando quel messaggio, insieme a `details.sqlState`, `detail` e `hint`.
`RAISE SQLSTATE 'PT404'` risponde con lo stato successivo a `PT`, come in PostgREST.
Tutti i codici RPC sono elencati nella sezione [Errori](/docs/backend/errors/#sql-functions-as-rpc).

## Sul runtime gestito e Rebase Cloud

Non c'è nulla da configurare: le dichiarazioni fanno parte di `backend/schema`, che
`rebase build` include nel bundle, e il runtime le legge dove legge
le tabelle. La funzione stessa deve esistere nel database utilizzato dal deployment.

Un backend estratto (ejected) che passa `schemaDir` le legge dallo stesso indice; uno
che passa le proprie tabelle come valori passa le proprie RPC nello stesso modo:

```typescript
await initializeRebaseBackend({ app, server, tables, rpc: [getPublicProposal, myTrips], /* … */ });
```

Le RPC fanno parte della superficie dei dati: un processo che non serve `/api/data`
(`REBASE_ROLE=functions`) non serve `/api/rpc`, ed esse vengono eseguite sul
database predefinito.

## Cosa non supporta

- Le chiamate sono solo `POST`; una richiesta `GET` su un nome dichiarato risponde con `405`.
- Possono essere passati solo parametri con nome. Una funzione i cui parametri non hanno
  nome, o che restituisce `SETOF record` senza parametri `OUT`, non può essere
  chiamata in questo modo.
- Tra gli overload di uno stesso nome, la chiamata raggiunge quello i cui parametri con nome
  corrispondono esattamente agli argomenti inviati; due overload che corrispondono entrambi restituiscono `500 RPC_AMBIGUOUS`.

Per logiche che non corrispondono a una singola funzione SQL, scrivi una [funzione personalizzata](/docs/backend/custom-functions/)
ed esegui codice SQL al suo interno tramite `getSql(c)`.
