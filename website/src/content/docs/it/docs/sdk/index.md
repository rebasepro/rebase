---
sourceHash: d3b3f413d231c3d0
title: Typed SDK — Per iniziare
sidebar_label: Per iniziare
description: Installa e configura l'SDK tipizzato di Rebase per interagire con il tuo backend da qualsiasi applicazione JavaScript o TypeScript.
---

## Panoramica

Il pacchetto `@rebasepro/client` fornisce un SDK JavaScript type-safe per interagire con il tuo backend Rebase. Gestisce:

- **Operazioni sui dati** — CRUD con filtri, ordinamento e paginazione
- **Recupero delle relazioni** — Includi le entità correlate con `.include()`
- **Sottoscrizioni in tempo reale** — Aggiornamenti live basati su WebSocket
- **Sincronizzazione offline e local-first** — Database locale opzionale a livello di riga, scritture offline istantanee, query live
- **Autenticazione** — Gestione dei token, login, registrazione, OAuth
- **Storage** — Caricamento, download e gestione dei file
- **Funzioni personalizzate** — Chiamata di endpoint personalizzati del server

## Installazione

```bash
pnpm add @rebasepro/client
```

## Creazione di un client

`rebase dev` ricava una porta libera dal percorso del progetto invece di usarne una fissa, quindi **leggi `baseUrl` dall'URL che ha stampato** — non c'è una porta comune a tutti i progetti. In un frontend Vite, questa corrisponde alla variabile `VITE_API_URL` che lo scaffold scrive in `.env`; in uno script, a una tua variabile d'ambiente.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
});
```

Il valore di `websocketUrl` viene ricavato automaticamente da `baseUrl` (`http → ws`, `https → wss`). Se necessario, puoi sovrascriverlo esplicitamente:

```typescript
const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    websocketUrl: import.meta.env.VITE_WS_URL,
});
```

### Opzioni di configurazione

| Opzione | Tipo | Descrizione |
|--------|------|-------------|
| `baseUrl` | `string` | URL del backend. Leggilo da ciò che `rebase dev` ha stampato, o dal tuo deployment |
| `websocketUrl` | `string` | URL del WebSocket — ricavato automaticamente da `baseUrl` se omesso |
| `token` | `string` | Token JWT statico per chiamate server-to-server |
| `apiPath` | `string` | Prefisso dell'API (predefinito: `"/api"`) |
| `fetch` | `typeof fetch` | Implementazione personalizzata di fetch (ad es. per SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Gestore 401 personalizzato — restituisce `true` per riprovare |
| `realtime` | `boolean \| RealtimeClientOptions` | Apre il WebSocket (predefinito `true`) — imposta a `false` negli script one-shot. `{ affinity }` [definisce il gruppo a cui appartiene il socket](/docs/sdk/realtime#keeping-a-group-on-one-instance) |
| `tables` | `Record<string, string>` | <span class="since-badge" data-since="0.31">Dalla versione 0.31</span> Mappa i nomi degli accessor agli slug delle tabelle — il `tablesDictionary` generato |
| `offline` | `boolean \| OfflineConfig` | [Sincronizzazione local-first](/docs/sdk/offline) — disattivata per impostazione predefinita |
| `impersonate` | `string` | Esegue ogni richiesta come questo utente, tramite uid, per verificare cosa può vedere un utente. Consentito solo per la sessione di un amministratore: l'API dei dati, le funzioni e il realtime vengono eseguiti come quell'utente, mentre ogni altra route rifiuta la richiesta |
| `debug` | `boolean` | Registra l'avanzamento della connessione realtime con `console.debug` (predefinito `false`) — vedi [Logging della connessione](#logging-della-connessione) |

### Logging della connessione

Per impostazione predefinita, il client non stampa nulla sulla sua connessione realtime, quindi una pagina pubblica non mostra alcuna informazione sul suo backend nella console di un visitatore. Avvisi ed errori vengono sempre stampati. Per vedere la connessione aprirsi, autenticarsi, cadere e riconnettersi, passa `debug: true`, oppure attivalo in un browser senza modificare il sito eseguendo questo comando nella sua console:

```js
localStorage.setItem("rebase_debug", "1"); // localStorage.removeItem("rebase_debug") to stop
```

Si applica a partire dalla riga successiva registrata dal client, quindi una pagina già connessa non necessita di essere ricaricata. Al di fuori del browser, imposta `globalThis.__REBASE_DEBUG__ = true`. I browser mostrano `console.debug` solo al livello Dettagliato (Verbose).

## Generazione dell'SDK tipizzato

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Genera un client completamente tipizzato a partire dalle tue tabelle:

```bash
rebase generate-sdk
```

Finché `rebase dev` è in esecuzione non è necessario farlo: rigenera i tipi in `generated/sdk/` all'avvio e a ogni salvataggio all'interno di `backend/schema/`. Esegui il comando manualmente in CI, in un repository frontend privo di tabelle proprie (`rebase generate-sdk --from link`), o ovunque `rebase dev` non sia in esecuzione. `generate-sdk` legge le tabelle esportate da `backend/schema/index.ts`, attraverso lo stesso loader utilizzato dal backend per avviarsi; `--from` legge invece le `tables` dell'endpoint `/api/meta/contract` di un backend in esecuzione.

Passa quindi il parametro di tipo `Database` a `createRebaseClient` per ottenere l'autocompletamento completo:

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Full autocomplete on table names and field types
const { data } = await client.data.products.find();
```

Quando viene fornito `Database`, `createRebaseClient` restituisce un'istanza di `CreateRebaseClientResult<DB>`. Questa mappa gli accessor delle tabelle in camelCase direttamente su `client.data` con i relativi tipi corrispondenti, offrendo l'autocompletamento completo sulle operazioni delle tabelle e sui tipi (ad es. `client.data.products.find()`).

`tablesDictionary` rimappa ciascun accessor allo slug utilizzato sulla rete. Il modulo generato esporta anche `TableName`, l'unione di tutti gli slug, e il tipo `TablesDictionary`. **`tables` è obbligatorio per un client tipizzato.** I tipi mettono a disposizione ogni accessor indipendentemente dal fatto che venga passato o meno, ma senza di esso `client.data.myNotes` viene inviato a `/data/my_notes`, ovvero l'accessor convertito in snake_case, pertanto uno slug come `my-notes` o un accessor rinominato restituirà 404. Il client emette un avviso una sola volta, indicando l'accessor e la soluzione. Con il dizionario, un accessor non presente al suo interno genera un errore `RebaseClientError` con codice `UNKNOWN_TABLE` e un suggerimento. Una versione futura renderà `tables` obbligatorio nei tipi quando viene specificato `Database`.

Alcuni nomi su `client.data` sono riservati: `table` è la funzione dinamica `table(slug)`, `batch` è [`client.batch`](/docs/sdk/writing/#writing-across-tables), e `then`, `toJSON` e `$$typeof` vengono lasciati invariati per i controlli sulle promise e sulla serializzazione. Una tabella il cui accessor corrisponderebbe a `table`, `then`, `toJSON` o `$$typeof` viene generata come `<name>Table` — lo slug `table` diventa `client.data.tableTable` — e `generate-sdk` stampa un avviso indicando entrambi i nomi. Anche `client.data.table("table")` consente di raggiungerla, ed è il modo in cui viene raggiunta una tabella il cui accessor sarebbe `batch`. `data.table(slug)` rifiuta con `INVALID_TABLE_PATH` qualsiasi slug contenente un segmento `.` o `..`, che uscirebbe da `/data`.

### Nomi dei campi

**Il nome di un campo sulla rete corrisponde alla sua chiave di colonna**, e l'API adotta interamente la convenzione camelCase. Una colonna `createdAt` memorizzata come `created_at` diventa `row.createdAt`, e la chiave esterna di una relazione è `authorId` anche se la colonna rimane `author_id`. `where` e `orderBy` sono basati sullo stesso tipo `Row`, quindi ciò che compila è esattamente ciò a cui il backend risponde.

Una chiave di colonna definita *da te* rimane la tua chiave, qualunque sia la sua forma — nulla rinomina un nome da te scelto. Le due chiavi derivate anziché dichiarate, ovvero la chiave esterna di una relazione e una colonna recuperata tramite introspezione, sono in camelCase.

`Row` descrive una lettura, `Insert` un `create()` e `Update` un `update()` — non hanno la stessa forma. Una colonna non obbligatoria è `T | null` in tutti e tre i casi, consentendo a una scrittura di azzerarla; la chiave primaria è sempre presente in lettura e mai modificabile in un aggiornamento; la destinazione di un `belongsTo` può essere specificata sia come relazione (`{ author: 5 }`) sia come sua chiave esterna (`{ authorId: 5 }`), e un campo obbligatorio viene soddisfatto da entrambe; una relazione `hasOne` si scrive specificando la riga di destinazione (`{ profile: 9 }`), oppure `null` per scollegarla; una `via` a passaggio singolo si scrive come il tipo per cui fa da tramite (to-one: l'id di destinazione o `null`; to-many: un elenco di id), mentre una a passaggi multipli è di sola lettura e non compare né in Insert né in Update; l'appartenenza a una relazione `hasMany` o `manyToMany` si scrive come un elenco di id di destinazione o di oggetti `{ id }` (`{ tags: ["t-1"] }`), ciascuno con un eventuale `_pivot` quando la tabella di giunzione dichiara colonne di payload. Un campo per cui nessuno dispone dei permessi di scrittura (`.access({ write: [] })`) non compare né in `Insert` né in `Update`. Una colonna di tipo `date` viene letta come stringa ISO, e in scrittura accetta sia tale stringa sia un oggetto `Date`.

## Esempio rapido

```typescript
// Create
const product = await client.data.products.create({
    name: "Camera",
    price: 299,
});

// Query with filters
const { data } = await client.data.products
    .where("price", ">=", 100)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();

// Real-time subscription
const unsubscribe = client.data.products.listen(
    { where: { active: ["==", true] } },
    (response) => console.log("Updated:", response.data)
);
```

## Utilizzo con React

In un frontend Rebase, il client viene creato una sola volta e condiviso tramite context:

```tsx no-verify
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL });

<Rebase client={client} ...>
```

Accedivi da qualsiasi componente:

```tsx
import { useRebaseClient } from "@rebasepro/app";

function MyComponent() {
    const client = useRebaseClient();
    // client.data, client.auth, client.storage, client.functions
}
```

## Passaggi successivi

- **[Interrogazione dei dati](/docs/sdk/querying)** — CRUD, filtri, paginazione e relazioni
- **[Autenticazione](/docs/sdk/authentication)** — Accesso, registrazione, OAuth, sessioni
- **[Sottoscrizioni in tempo reale](/docs/sdk/realtime)** — Dati in tempo reale con WebSocket
- **[Sincronizzazione offline e local-first](/docs/sdk/offline)** — Lavora senza connessione e sincronizza quando torna disponibile
- **[Storage e file](/docs/sdk/storage)** — Carica, scarica e gestisci i file
