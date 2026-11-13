---
sourceHash: 87e4ee6ea63add18
title: Script e la console
sidebar_label: Script e la console
description: Apri i dati di un progetto da uno script, un test o un REPL con openRebase, oppure dal terminale con rebase console. Nessun server, nessuna modifica allo schema.
---

## Panoramica

Per esaminare alcune righe, correggerne una, provare un filtro o verificare cosa una policy consente di vedere a un utente, non dovresti dover avviare un server. Rebase ti mette a disposizione i dati del progetto sotto forma di oggetto, in due punti:

- **`rebase console`**, un REPL Node nel tuo terminale con il progetto aperto;
- **`openRebase`**, lo stesso oggetto in un tuo script o test.

Entrambi aprono il database senzaチェーンmodificarlo: non viene creata alcuna tabella, ruolo, trigger o funzione. Il metodo `close()` di uno script termina ciò che `openRebase` ha aperto. Sul database di sviluppo gestito, `rebase console` avvia il database se non è in esecuzione e lo lascia attivo al termine, come fanno i comandi `rebase db`; `rebase db stop` lo arresta. L'oggetto dispone del vocabolario che una [funzione personalizzata](/docs/backend/custom-functions/) riceve dal server, `dataAsAdmin` e `sql`, quindi uno snippet può passare da una funzione a uno script e alla console senza alcuna modifica.

## `rebase console`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Eseguilo nel tuo progetto:

```bash
rebase console
```

```text
> const { data } = await rebase.dataAsAdmin.posts.find({ limit: 3 })
> data.map(p => p.title)
[ 'Draft', 'Second post', 'Hello' ]
> const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] })
> (await ada.data.posts.find({ limit: 3 })).data.length
3
```

Due nomi sono nello scope e l'`await` di primo livello è supportato:

| Nome | Descrizione |
|---|---|
| `rebase` | Ciò che restituisce [`openRebase`](#openrebase): `dataAsAdmin`, `sql`, `withAuth(user)` e `close()` |
| `tables` | I descrittori delle tabelle servite dal progetto, caricati da `backend/schema` nello stesso modo in cui li carica `rebase db push` (`rebase.tables`) |

La console apre il progetto esattamente come fa `rebase db push`: lo stesso `.env`, lo stesso database e le stesse tabelle da `backend/schema`. Carica inoltre gli `hooks` globali da `backend/hooks.ts`, quindi le sue operazioni di scrittura eseguono gli stessi hook di una scrittura sul server. Per un progetto sul database di sviluppo gestito, questo viene prima avviato. La cronologia di ciò che hai digitato viene conservata in `.rebase/console_history`, che è già escluso dal file `.gitignore` dello scaffold.

L'input passato tramite pipe viene eseguito una riga alla volta, ciascuna dopo che l'`await` della riga precedente si è risolto, pertanto la trascrizione riportata sopra funziona anche come `printf '…\n…\n' | rebase console`. Tutto ciò che segue `.exit` viene ignorato e i valori sono colorati solo su un terminale. Tutto ciò che la console registra nei log viene inviato a stderr.

### Un singolo snippet: `--eval`

`rebase console -e "<code>"` esegue un singolo frammento di codice invece del REPL. Il valore di un'espressione, o il `return` del corpo di una funzione, viene atteso e stampato come JSON su stdout, consentendo di inoltrare l'output tramite pipe:

```bash
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
rebase console -e "rebase.sql('select count(*) from posts')" | jq .
rebase console -e "const u = await rebase.withAuth({ uid: 'u1', roles: ['user'] }); return (await u.data.posts.find()).data"
```

Tutto ciò che la console registra nei log, indipendentemente da quanto impostato in `LOG_LEVEL`, viene inviato a stderr, in modo che stdout contenga esclusivamente il risultato. Uno snippet che genera un'eccezione stampa l'errore su stderr ed esce con codice `1`.

Un database che la console non riesce ad aprire viene segnalato una sola volta ed esce con codice `1`: tramite il banner "Cannot connect to PostgreSQL" stampato dai comandi `db` oppure, sul database di sviluppo gestito, segnalando che non ci sono connessioni libere. Quel database accetta solo poche connessioni alla volta e un'istanza di `rebase dev` in esecuzione ne occupa alcune, quindi chiudi un altro client oppure arresta `rebase dev` e avvialo nuovamente.

### Opzioni

<span class="since-badge" data-since="0.31">Da 0.31</span>

| Flag | Descrizione |
|---|---|
| `--eval`, `-e` | Esegue questo codice invece del REPL, stampa il risultato atteso come JSON ed esce con 1 in caso di errore |
| `--schema-dir` | La directory dello schema, se diversa da quella del progetto (`backend/schema`, o la chiave `tables` di `rebase.json`) |
| `--database-url` | Apre questo database invece di quello del progetto |
| `--docker` | Usa il database da docker compose, avviandolo se necessario |

## `openRebase`

<span class="since-badge" data-since="0.31">Da 0.31</span>

`openRebase` del pacchetto `@rebasepro/server-postgres` è ciò che la console richiama. Usalo in uno script, in un seed, in una correzione di dati o in un test. In un progetto generato tramite scaffold, posiziona lo script all'interno di `backend/`, ad esempio `backend/scripts/publish-drafts.ts`: il workspace del backend è infatti quello che dipende da `@rebasepro/server-postgres`, e uno script nella cartella root `scripts/` non potrebbe importarlo.

`openRebase` accetta le tabelle compilate del progetto: `compileSchema` di `@rebasepro/common` converte i risultati di `defineTable` nelle tabelle su cui opera il driver, hook inclusi. Inseriscilo in un modulo condiviso dagli script, `backend/scripts/tables.ts`, dopo aver aggiunto `@rebasepro/common` a `backend/package.json`:

```typescript no-verify
import { compileSchema } from "@rebasepro/common";
import * as schema from "../schema";

// Every table the index exports, and the defaultRls its "inherit" tables take.
export const tables = compileSchema(
    [schema.users, schema.posts, schema.authors, schema.tags],
    { defaultRls: schema.defaultRls }
);
```

Passa come `hooks` gli hook globali esportati da `backend/hooks.ts`, e le scritture dello script li eseguiranno esattamente come una scrittura del server; senza di essi, un `beforeSave` globale che assegna un tenant o scrive una riga di audit non verrebbe eseguito su alcuna scrittura dello script. Omettendo `tables`, `openRebase` leggerà le tabelle dal database, come farebbe un server privo di `backend/schema`. `rebase console` carica entrambi automaticamente per te.

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { tables } from "./tables";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, tables });

const { data: drafts } = await rebase.dataAsAdmin.posts.find({ where: { status: ["==", "draft"] } });
console.log(`${drafts.length} drafts`);
for (const draft of drafts) {
    await rebase.dataAsAdmin.posts.update(String(draft.id), { status: "published" });
}

await rebase.close();
```

Eseguilo da `backend/`. `rebase db url` stampa l'URL del database utilizzato dal progetto, compreso quello di sviluppo gestito:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/publish-drafts.ts
```

| Membro | Descrizione |
|---|---|
| `dataAsAdmin` | Tutte le tabelle, lette e scritte con l'identità di servizio del server (`{ uid: "service", roles: ["admin"] }`): privilegi di admin, pur continuando a essere valutate dalle policy RLS, esattamente come `rebase.dataAsAdmin` all'interno di una funzione |
| `sql(query, { params })` | SQL raw sulla connessione proprietaria (owner), con la stessa convenzione di chiamata di `rebase.sql` in una funzione. Viene eseguito sull'unica origine dati aperta: qualsiasi valore di `{ database }` che indichi un'altra origine viene rifiutato |
| `withAuth(user)` | Si risolve in `{ data }`: le tabelle così come le vede quell'utente. Ogni lettura e scrittura viene eseguita con la sua identità, filtrata dalla sicurezza a livello di riga (RLS), esattamente come avverrebbe per una richiesta HTTP proveniente da quell'utente |
| `tables` | I descrittori delle tabelle servite: quelle fornite in input oppure quelle descritte dal database |
| `close()` | Chiude il connection pool creato da `openRebase`. Può essere chiamato due volte in sicurezza |

Le sue opzioni:

| Opzione | Descrizione |
|---|---|
| `databaseUrl` | Il database da aprire. `openRebase` crea il pool e `close()` lo chiude |
| `connection` | Una connessione Drizzle già esistente (`createPostgresDatabaseConnection(url).db`), anziché `databaseUrl`. Rimane gestita da te: `close()` la lascerà aperta |
| `tables` | Le tabelle del progetto, compilate con `compileSchema` (vedi sopra). Se assente o vuoto, le legge dal database, come farebbe un server senza `backend/schema`, e le rende disponibili in sola lettura |
| `pool` | Impostazioni del pool, insieme a `databaseUrl` |
| `dataSourceKey` | Il database da cui vengono servite queste tabelle. Valore predefinito: `(default)` |
| `hooks` | Gli hook globali del progetto: gli `hooks` esportati da `backend/hooks.ts`, che il server esegue prima di quelli specifici di ciascuna tabella. Passandoli qui, anche le scritture dello script li eseguiranno. `rebase console` lo fa automaticamente per te |

`openRebase` non legge alcuna variabile d'ambiente. La variabile `DATABASE_URL` sopra indicata viene letta dal tuo script e le impostazioni come `REBASE_DB_POOL_MAX` o `REALTIME_CDC` qui non hanno alcun effetto.

L'apertura non registra alcun log a livello `info`, pertanto lo stdout di uno script contiene unicamente ciò che lo script stampa, e `tsx scripts/report.ts > report.json` scrive solo il suo JSON. Gli avvisi e gli errori vengono inviati a stderr in ambiente di sviluppo. La nota su come le richieste vengono isolate (`RLS enforcement active`) viene registrata a livello `debug`; l'avvio di un server la stampa invece a livello `info`. Un database non raggiungibile rifiuta l'apertura con un singolo errore, `Cannot connect to PostgreSQL at <host>:<port>: <reason>.`, senza registrare alcun log: la decisione su cosa stampare spetta allo script.

I suoi accessor sono tipizzati dal `Database` registrato da `rebase generate-sdk --register`, esattamente come il `rebase` di una funzione; pertanto, un nome errato di tabella, campo o valore enum in uno script costituisce un errore di tipo. Il file `backend/tsconfig.json` dello scaffold include `scripts/`, quindi `tsc --noEmit` in `backend/` lo segnala. Senza registrazione, specificalo per ogni chiamata con `openRebase<Database>({ … })`; `OpenedRebase<Database>` è il tipo da assegnare a un helper che ne accetta uno. In assenza di entrambi, le righe non sono tipizzate, motivo per cui il primo esempio converte `draft.id` con `String()`.

### Verificare cosa può vedere un utente

`withAuth` è il modo più rapido per testare una regola di sicurezza su dati reali. Lo scaffold del blog, il default di `rebase init`, dichiara le regole direttamente su `posts`: un utente autenticato senza ruoli legge i post pubblicati e nessuna bozza, e solo un admin può scriverne uno. (Le altre tabelle impostano `rls: "inherit"` e adottano il `defaultRls` in `backend/schema/index.ts`.) Questo esempio verifica entrambe le parti, come `backend/scripts/ada-check.ts`:

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { tables } from "./tables";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, tables });
const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });

// A signed-in user reads published posts, and no drafts…
const { data: seen } = await ada.data.posts.find();
console.log(seen.every(post => post.status === "published"));

// …and writing one is refused: only an admin may.
const refused = await ada.data.posts.create({ title: "Not an admin" }).then(() => false, () => true);
console.log(refused);

// SQL as Ada runs under the same policies: her rows, read-only unless { write: true }.
const counted = await ada.sql("SELECT count(*)::int AS n FROM posts");
console.log(Number(counted[0]?.n) === seen.length);

await rebase.close();
```

Eseguilo nello stesso modo del primo script e stamperà `true` tre volte:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/ada-check.ts
```

Una regola che filtra le righe in base al proprietario si verifica allo stesso modo: confronta il campo proprietario di ciascuna riga con l'`uid` passato. Nello scaffold del blog nessuna regola lo fa, e `authorId` su un post è l'ID di una riga autore, non di un utente.

Un utente ha la struttura `{ uid, roles?, isAnonymous?, claims? }`; i `claims` sono ciò che `rebase.jwt()` legge all'interno di una policy.

`withAuth` viene eseguito con il ruolo ristretto creato all'avvio del server (`rebase_user`). Su un database su cui nessun server Rebase è mai stato avviato, tale ruolo non esiste e le richieste di `withAuth` falliscono con l'errore di Postgres per ruolo sconosciuto anziché essere eseguite senza filtri. Esegui prima `rebase db push` o avvia il server almeno una volta.

### In un test

```typescript
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openRebase, type OpenedRebase } from "@rebasepro/server-postgres";
import { tables } from "./tables";

let rebase: OpenedRebase;
before(async () => {
    rebase = await openRebase({ databaseUrl: process.env.TEST_DATABASE_URL!, tables });
});
after(() => rebase.close());

test("a signed-in user reads published posts only and writes none", async () => {
    const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
    const { data: seen } = await ada.data.posts.find();
    assert.ok(seen.every(post => post.status === "published"));
    await assert.rejects(ada.data.posts.create({ title: "Not an admin" }));
});
```

Salvalo come `backend/scripts/posts.test.ts` ed eseguilo da `backend/` con il test runner di Node, puntando `TEST_DATABASE_URL` a un database su cui è stato avviato un server Rebase:

```bash
TEST_DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx --test scripts/posts.test.ts
```

La stessa procedura funziona con Vitest o Jest.

### Tabelle con cronologia

Una scrittura su una tabella con [`history: true`](/docs/backend/history/) registra la relativa voce nello stesso modo in cui farebbe una scrittura del server. La voce viene scritta nella transazione stessa della riga, quindi una scrittura per cui viene eseguito il rollback non lascia alcuna voce. Viene registrata con l'identità con cui è stata eseguita la scrittura: `service` per `dataAsAdmin`, l'`uid` dell'utente con `withAuth`. Le scritture da `rebase console` vengono registrate nello stesso modo.

`openRebase` non crea alcuna struttura su cui registrare. Se sul database non è mai stato avviato alcun backend con la cronologia abilitata, la tabella `rebase.entity_history` risulterà mancante. Una scrittura su una tabella con cronologia verrà quindi rifiutata con [`HISTORY_UNAVAILABLE`](/docs/backend/errors/#data-queries-and-writes) prima ancora che vengano eseguiti i suoi hook, e il messaggio indicherà ciò che manca. Le letture funzionano normalmente. Avvia il backend una volta con la cronologia attiva (cosa che `rebase dev` fa) e le scritture andranno a buon fine.

Le voci vengono registrate e mai eliminate automaticamente dallo script. La retention è un'impostazione del server che uno script non può vedere, quindi è il server a occuparsi della pulizia come di consueto: alla successiva scrittura dell'entità e durante la pulizia periodica oraria.

### Cosa viene escluso

`openRebase` apre il livello dati e nient'altro. Non avvia alcun meccanismo realtime autonomo, ma le sue scritture raggiungono comunque le query live: i trigger di change-capture del database notificano ogni scrittura, indipendentemente da chi l'abbia effettuata, consentendo ai subscriber su un server in esecuzione di effettuare nuovamente il fetch anche dopo un backfill. Non vengono notificate solo se su quel server è impostato `REALTIME_CDC=off`. Consulta [Database change capture](/docs/backend/realtime-cdc/). Lo storage, le email, l'amministrazione dell'autenticazione e le tue funzioni non sono inclusi.

Gli hook specifici di ciascuna tabella vengono eseguiti a ogni scrittura, come sul server. Gli hook globali del progetto vengono eseguiti solo se li passi tramite l'opzione `callbacks`. `rebase console` li passa automaticamente per te: legge gli `hooks` esportati dal tuo `backend/hooks.ts`, quindi un `beforeSave` globale viene eseguito anche sulle sue scritture. Se tale file non può essere importato (ad esempio, necessita di una variabile d'ambiente non fornita alla console), la console stampa una riga indicando che gli hook globali sono disattivati per la sessione e si apre senza di essi.

Quando uno script ha bisogno anche di queste funzionalità, compila il backend senza servirlo: `createRebaseBackend({ …, provision: false })` ti fornisce `backend.rebase`, il client in-process completo, senza nulla di montato e nulla di avviato. Consulta [il backend senza server](/docs/backend/custom-server/#the-backend-without-a-server). Per testare un hook di tabella senza alcun database, chiamalo con [`createCallContext`](/docs/collections/callbacks/#testing-a-hook).

## Correlati

- [Integrazione server personalizzato](/docs/backend/custom-server/) — il backend suddiviso in componenti pubblici
- [Riferimento CLI](/docs/cli/) — tutti i comandi `rebase`
- [Regole di sicurezza](/docs/collections/security-rules/) — i criteri di filtro usati da `withAuth`
