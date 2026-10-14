---
sourceHash: b806e08525154a2e
title: Script e console
sidebar_label: Script e console
description: Apri i dati di un progetto da uno script, da un test o da un REPL con openRebase, oppure dal terminale con rebase console. Nessun server, nessuna modifica allo schema.
---

## Panoramica

<span class="since-badge" data-since="0.25">Da 0.25</span> Su 0.24 non esistono
né `openRebase` né `rebase console`: uno script deve costruire un backend, oppure
chiamare l'API REST di un server in esecuzione.

Per dare un'occhiata ad alcune righe, correggerne una, provare un filtro o verificare
cosa una policy consente di vedere a un utente, non dovresti dover avviare un server.
Rebase ti dà i dati del progetto come oggetto, in due posti:

- **`rebase console`**, un REPL Node nel tuo terminale con il progetto aperto;
- **`openRebase`**, lo stesso oggetto in uno script o in un test tuo.

Entrambi aprono il database senza modificarlo: non viene creata alcuna tabella, ruolo,
trigger o funzione. Il `close()` di uno script termina ciò che `openRebase` ha aperto.
Sul database di sviluppo gestito, `rebase console` avvia quel database quando non è in
esecuzione e lo lascia in esecuzione al termine, come fanno i comandi `rebase db`;
`rebase db stop` lo ferma. L'oggetto ha il vocabolario che una
[funzione personalizzata](/docs/backend/custom-functions/) riceve dal server,
`dataAsAdmin` e `sql`, quindi uno snippet passa da una funzione a uno script e alla
console senza modifiche.

## `rebase console`

<span class="since-badge" data-since="0.25">Da 0.25</span>

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

Sono disponibili due nomi, e l'`await` di primo livello funziona:

| Nome | Cos'è |
|---|---|
| `rebase` | Ciò che restituisce [`openRebase`](#openrebase): `dataAsAdmin`, `sql`, `withAuth(user)` e `close()` |
| `collections` | Le collection del progetto, caricate come le carica `rebase db push` |

La console apre il progetto come fa `rebase db push`: lo stesso `.env`, lo stesso
database e le stesse collection. Se il progetto usa il database di sviluppo gestito,
questo viene prima avviato. La cronologia di ciò che hai digitato è conservata in
`.rebase/console_history`, che il `.gitignore` dello scaffold già esclude.

L'input in pipe viene eseguito una riga alla volta, ciascuna dopo che l'`await` della riga
precedente si è concluso, quindi la trascrizione qui sopra funziona come
`printf '…\n…\n' | rebase console`. Tutto ciò che segue `.exit` viene ignorato, e i
valori sono colorati solo su un terminale. Tutto ciò che la console registra va su stderr.

### Un solo snippet: `--eval`

<span class="since-badge" data-since="0.25">Da 0.25</span>

`rebase console -e "<code>"` esegue un solo pezzo di codice al posto del REPL. Il valore
di un'espressione, o il `return` del corpo di una funzione, viene atteso (await) e
stampato come JSON su stdout, così l'output può essere inviato in pipe:

```bash
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
rebase console -e "rebase.sql('select count(*) from posts')" | jq .
rebase console -e "const u = await rebase.withAuth({ uid: 'u1', roles: ['user'] }); return (await u.data.posts.find()).data"
```

Tutto ciò che la console registra, qualunque cosa dica `LOG_LEVEL`, va su stderr, così
stdout contiene il risultato e nient'altro. Uno snippet che lancia un errore stampa
l'errore su stderr e termina con `1`.

<span class="since-badge" data-since="0.25">Da 0.25</span> Un database che la
console non riesce ad aprire viene segnalato una sola volta, e la console termina con `1`:
il banner "Cannot connect to PostgreSQL" che stampano i comandi `db` oppure, sul database
di sviluppo gestito, il fatto che non ha connessioni libere. Quel database accetta solo
poche connessioni alla volta e un `rebase dev` in esecuzione ne occupa alcune, quindi
chiudi un altro client o arresta `rebase dev` e riesegui il comando. Su 0.24 il banner
compariva due volte, sotto una riga `❌ [ERROR]` vuota, e un database gestito pieno
stampava `read ECONNRESET` con il suo stack come un'unica riga di JSON.

### Opzioni

| Flag | Cosa fa |
|---|---|
| `--eval`, `-e` | Esegue questo codice al posto del REPL, ne stampa il risultato atteso come JSON e termina con 1 se lancia un errore |
| `--collections`, `-c` | Percorso della directory delle collection, se diversa da quella del progetto |
| `--database-url` | Apre questo database invece di quello del progetto |
| `--docker` | Usa il database di docker compose, avviandolo se necessario |

## `openRebase`

<span class="since-badge" data-since="0.25">Da 0.25</span>

`openRebase` da `@rebasepro/server-postgres` è ciò che chiama la console. Usalo in uno
script, in un seed, in una correzione dei dati o in un test. In un progetto generato con lo
scaffold, metti lo script sotto `backend/`, per esempio `backend/scripts/publish-drafts.ts`:
il workspace backend è quello che dipende da `@rebasepro/server-postgres`, e uno script
nella cartella `scripts/` alla radice non può importarlo.

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, collections });

const { data: drafts } = await rebase.dataAsAdmin.posts.find({ where: { status: ["==", "draft"] } });
console.log(`${drafts.length} drafts`);
for (const draft of drafts) {
    await rebase.dataAsAdmin.posts.update(String(draft.id), { status: "published" });
}

await rebase.close();
```

Eseguilo da `backend/`. `rebase db url` stampa l'URL del database che usa il progetto,
compreso quello di sviluppo gestito:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/publish-drafts.ts
```

| Membro | Cosa fa |
|---|---|
| `dataAsAdmin` | Ogni collection, letta e scritta con l'identità di servizio del server (`{ uid: "service", roles: ["admin"] }`): admin, e comunque valutata dalle tue policy RLS, esattamente come `rebase.dataAsAdmin` in una funzione |
| `sql(query, { params })` | SQL grezzo sulla connessione owner, con la stessa convenzione di chiamata di `rebase.sql` in una funzione |
| `withAuth(user)` | Si risolve in `{ data }`: le collection come le vede quell'utente. Ogni lettura e scrittura viene eseguita come lui, filtrata dalla row-level security, come una richiesta HTTP di quell'utente |
| `collections` | Le collection con cui è stato aperto |
| `close()` | Chiude il pool di connessioni creato da `openRebase`. Si può chiamare due volte senza rischi |

Le sue opzioni:

| Opzione | Cosa fa |
|---|---|
| `databaseUrl` | Il database da aprire. `openRebase` crea il pool e `close()` lo chiude |
| `connection` | Una connessione Drizzle che già possiedi (`createPostgresDatabaseConnection(url).db`), al posto di `databaseUrl`. Resta tua: `close()` la lascia aperta |
| `collections` | Le collection del progetto. Un array vuoto le legge invece dal database, come fa un server senza file di collection, e le serve in sola lettura |
| `pool` | Impostazioni del pool, insieme a `databaseUrl` |
| `dataSourceKey` | La sorgente dati da cui vengono servite queste collection. Predefinita `(default)` |

`openRebase` non legge alcuna variabile d'ambiente. La `DATABASE_URL` qui sopra è letta
dal tuo script, e impostazioni come `REBASE_DB_POOL_MAX` o `REALTIME_CDC` non cambiano
nulla in questo caso.

<span class="since-badge" data-since="0.25">Da 0.25</span> L'apertura non registra
nulla a livello `info`, così lo stdout di uno script contiene ciò che lo script stampa, e
`tsx scripts/report.ts > report.json` scrive solo il suo JSON. Avvisi ed errori vanno su
stderr in sviluppo. La nota su come vengono isolate le richieste (`RLS enforcement active`)
viene registrata a livello `debug`; l'avvio di un server la stampa ancora a livello `info`.
Un database che non riesce a raggiungere fa fallire l'apertura con un solo errore,
`Cannot connect to PostgreSQL at <host>:<port>: <reason>.`, e non registra nulla: che
cosa stampare lo decide lo script. Su 0.24 quella nota apriva lo stdout di uno script, e
un database irraggiungibile registrava un banner prima dell'errore.

I suoi accessor sono tipizzati dal `Database` che registra `rebase generate-sdk --register`,
come il `rebase` di una funzione, quindi in uno script una collection, un campo o un valore
di enum scritto male è un errore di tipo. Il `backend/tsconfig.json` dello scaffold include
`scripts/`, quindi `tsc --noEmit` in `backend/` lo segnala. Senza una registrazione, indicalo a ogni chiamata
con `openRebase<Database>({ … })`; `OpenedRebase<Database>` è il tipo da dare a un helper
che ne riceve uno. Con nessuna delle due, le righe non sono tipizzate, ed è per questo che il
primo esempio converte `draft.id` con `String()`.

### Verificare cosa può vedere un utente

<span class="since-badge" data-since="0.25">Da 0.25</span>

`withAuth` è il modo più rapido per testare una regola di sicurezza su dati reali. Lo
scaffold blog, quello predefinito di `rebase init`, dà a ogni collection le
`defaultSecurityRules` in `config/collections/index.ts`: ogni utente autenticato legge
ogni post, e solo un admin può scriverne uno. Questo script controlla entrambe le metà,
come `backend/scripts/ada-check.ts`:

```typescript
import { openRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, collections });
const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });

// A signed-in user reads every post…
const { data: seen } = await ada.data.posts.find();
const { data: all } = await rebase.dataAsAdmin.posts.find();
console.log(seen.length === all.length);

// …and writing one is refused: only an admin may.
const refused = await ada.data.posts.create({ title: "Not an admin" }).then(() => false, () => true);
console.log(refused);

await rebase.close();
```

Eseguilo come il primo script, e stampa `true` due volte:

```bash
cd backend
DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx scripts/ada-check.ts
```

Una regola che filtra le righe per proprietario si verifica allo stesso modo: confronta il
campo del proprietario di ogni riga con l'`uid` che hai passato. Sullo scaffold blog
nessuna regola lo fa, e `authorId` su un post è l'id di una riga degli autori, non di un
utente.

Un utente è `{ uid, roles?, isAnonymous?, claims? }`; i `claims` sono ciò che
`rebase.jwt()` legge in una policy.

`withAuth` viene eseguito con il ruolo ristretto che crea l'avvio di un server
(`rebase_user`). Su un database in cui nessun server Rebase è mai partito, quel ruolo
non esiste, e le richieste di `withAuth` falliscono con l'errore di ruolo sconosciuto di
Postgres anziché essere eseguite senza filtri. Esegui prima `rebase db push`, oppure
avvia una volta il server.

### In un test

<span class="since-badge" data-since="0.25">Da 0.25</span>

```typescript
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { openRebase, type OpenedRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

let rebase: OpenedRebase;
before(async () => {
    rebase = await openRebase({ databaseUrl: process.env.TEST_DATABASE_URL!, collections });
});
after(() => rebase.close());

test("a signed-in user reads every post and writes none", async () => {
    const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
    const { data: seen } = await ada.data.posts.find();
    const { data: all } = await rebase.dataAsAdmin.posts.find();
    assert.equal(seen.length, all.length);
    await assert.rejects(ada.data.posts.create({ title: "Not an admin" }));
});
```

Salvalo come `backend/scripts/posts.test.ts` ed eseguilo da `backend/` con il test runner
di Node, puntando `TEST_DATABASE_URL` a un database su cui un server Rebase è già partito:

```bash
TEST_DATABASE_URL="$(pnpm exec rebase db url)" pnpm exec tsx --test scripts/posts.test.ts
```

Lo stesso funziona con Vitest o Jest.

### Collection con cronologia

<span class="since-badge" data-since="0.25">Da 0.25</span>

Una scrittura su una collection con [`history: true`](/docs/backend/history/) registra
la sua voce come fa una scrittura del server. La voce viene scritta nella transazione
della riga stessa, quindi una scrittura che viene annullata non lascia alcuna voce. Viene
registrata con l'identità con cui la scrittura è stata eseguita: `service` per
`dataAsAdmin`, l'`uid` dell'utente con `withAuth`. Le scritture da `rebase console`
vengono registrate allo stesso modo.

`openRebase` non crea nulla in cui registrare. Se nessun backend con la cronologia si è
mai avviato su quel database, la tabella `rebase.entity_history` non esiste. Una
scrittura su una collection con cronologia viene allora rifiutata con
[`HISTORY_UNAVAILABLE`](/docs/backend/errors/#data-queries-and-writes) prima che venga
eseguito uno qualsiasi dei suoi callback, e il messaggio indica che cosa manca. Le
letture funzionano come al solito. Avvia il backend una volta con la cronologia attiva
(`rebase dev` lo fa), e le scritture passano.

Le voci vengono registrate, mai eliminate. La retention è un'impostazione del server che
uno script non vede, quindi è il server a eseguirne il pruning come di consueto: alla sua
prossima scrittura sull'entità, e nella sua pulizia oraria.

### Cosa lascia fuori

<span class="since-badge" data-since="0.25">Da 0.25</span>

`openRebase` apre il livello dei dati e nient'altro. Non avvia alcun realtime, quindi le
sue scritture non vengono annunciate alle query live. Storage, email, amministrazione
dell'autenticazione e le tue funzioni non ne fanno parte.

Quando uno script ha bisogno anche di quelli, costruisci il backend senza servirlo:
`createRebaseBackend({ …, provision: false })` ti dà `backend.rebase`, il client
in-process completo, senza nulla montato e nulla avviato. Vedi
[il backend senza un server](/docs/backend/custom-server/#the-backend-without-a-server).
Per testare un callback di collection senza alcun database, chiamalo con
[`createCallContext`](/docs/collections/callbacks/#testing-a-callback).

## Correlati

- [Integrazione Server Personalizzato](/docs/backend/custom-server/) — il backend come componenti pubblici
- [Riferimento CLI](/docs/cli/) — ogni comando `rebase`
- [Regole di sicurezza (RLS)](/docs/collections/security-rules/) — da cosa è filtrato `withAuth`
