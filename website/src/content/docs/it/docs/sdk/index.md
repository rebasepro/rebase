---
sourceHash: a1afbafa7c27ef28
title: SDK tipizzato — Guida introduttiva
sidebar_label: Guida introduttiva
description: Installa e configura l'SDK tipizzato di Rebase per interagire con il tuo backend da qualsiasi applicazione JavaScript o TypeScript.
---

## Panoramica

Il pacchetto `@rebasepro/client` fornisce un SDK JavaScript type-safe per interagire con il tuo backend Rebase. Gestisce:

- **Operazioni sui dati** — CRUD con filtri, ordinamento e paginazione
- **Recupero delle relazioni** — Includi entità correlate con `.include()`
- **Sottoscrizioni in tempo reale** — Aggiornamenti live basati su WebSocket
- **Sincronizzazione offline & local-first** — Database locale delle righe opzionale, scritture offline istantanee, query live
- **Autenticazione** — Gestione dei token, login, registrazione, OAuth
- **Storage** — Caricamento, download e gestione dei file
- **Funzioni personalizzate** — Chiamata a endpoint server personalizzati

## Installazione

```bash
pnpm add @rebasepro/client
```

## Creazione di un client

`rebase dev` ricava una porta libera dal percorso del progetto invece di utilizzarne una fissa, quindi **leggi `baseUrl` dall'URL stampato** — non c'è una porta comune a tutti i progetti. In un frontend Vite, questa corrisponde al `VITE_API_URL` che lo scaffold scrive in `.env`; in uno script, a una variabile d'ambiente definita da te.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
});
```

Il `websocketUrl` viene derivato automaticamente da `baseUrl` (`http → ws`, `https → wss`). Se necessario, puoi sovrascriverlo esplicitamente:

```typescript
const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    websocketUrl: import.meta.env.VITE_WS_URL,
});
```

### Opzioni di configurazione

| Opzione | Tipo | Descrizione |
|---------|------|-------------|
| `baseUrl` | `string` | URL del backend. Leggilo da quanto stampato da `rebase dev`, oppure dal tuo deployment |
| `websocketUrl` | `string` | URL del WebSocket — derivato automaticamente da `baseUrl` se omesso |
| `token` | `string` | Token JWT statico per chiamate server-to-server |
| `apiPath` | `string` | Prefisso API (predefinito: `"/api"`) |
| `fetch` | `typeof fetch` | Implementazione fetch personalizzata (es. per SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Gestore 401 personalizzato — restituisce `true` per riprovare |
| `realtime` | `boolean \| RealtimeClientOptions` | Apre il WebSocket (predefinito `true`) — imposta su `false` negli script one-shot. `{ affinity }` [definisce il gruppo a cui appartiene il socket](/docs/sdk/realtime#keeping-a-group-on-one-instance) |
| `collections` | `Record<string, string>` | Mappa i nomi degli accessor agli slug delle collection |
| `offline` | `boolean \| OfflineConfig` | [Sincronizzazione local-first](/docs/sdk/offline) — disabilitata per impostazione predefinita |
| `impersonate` | `string` | Esegue ogni richiesta impersonando questo utente, tramite uid, per verificare cosa può vedere un determinato utente. Consentito solo a una sessione di amministratore: le API dati, le funzioni e il realtime vengono eseguiti come quell'utente, mentre ogni altra route viene rifiutata |
| `debug` | `boolean` | Registra l'avanzamento della connessione realtime con `console.debug` (predefinito `false`) — vedi [Logging della connessione](#logging-della-connessione) |

### Logging della connessione

Per impostazione predefinita, il client non stampa nulla sulla propria connessione realtime, quindi una pagina pubblica non mostra alcuna informazione sul backend nella console del visitatore. Avvisi ed errori vengono sempre stampati. Per vedere la connessione aprirsi, autenticarsi, cadere e riconnettersi, passa `debug: true`, oppure attivalo in un singolo browser senza modificare il sito eseguendo questo comando nella console:

```js
localStorage.setItem("rebase_debug", "1"); // localStorage.removeItem("rebase_debug") to stop
```

Si applica a partire dalla riga successiva registrata dal client, quindi una pagina già connessa non necessita di ricaricamento. Al di fuori del browser, imposta `globalThis.__REBASE_DEBUG__ = true`. I browser mostrano `console.debug` solo al livello Dettagliato (Verbose).

## Generazione dell'SDK tipizzato

Genera un client completamente tipizzato a partire dalle definizioni delle tue collection:

```bash
rebase generate-sdk
```

Mentre `rebase dev` è in esecuzione non è necessario farlo: rigenera i tipi in `generated/sdk/` all'avvio e a ogni salvataggio all'interno di `config/collections/`. Esegui il comando manualmente in CI, in un repository frontend privo di collection (`rebase generate-sdk --from link`), o ovunque `rebase dev` non sia in esecuzione. Nella versione 0.23, `rebase dev` non tocca i tipi dell'SDK, quindi esegui il comando dopo ogni modifica a una collection.

Passa quindi il parametro di tipo `Database` a `createRebaseClient` per ottenere l'autocompletamento completo:

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { collectionsDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    collections: collectionsDictionary,
});

// Full autocomplete on collection names and field types
const { data } = await client.data.products.find();
```

Quando viene fornito `Database`, `createRebaseClient` restituisce un'istanza di `CreateRebaseClientResult<DB>`. Questa mappa gli accessor delle collection in camelCase direttamente su `client.data` ai tipi corrispondenti, offrendo l'autocompletamento completo sulle operazioni e sui tipi delle collection (es. `client.data.products.find()`).

`collectionsDictionary` mappa ogni accessor allo slug utilizzato via rete. **`collections` è obbligatorio per un client tipizzato.** I tipi mettono a disposizione ogni accessor indipendentemente dal fatto che venga passato o meno, ma senza di esso `client.data.myNotes` viene inviato a `/data/my_notes`, ossia l'accessor in snake_case; di conseguenza uno slug come `my-notes` o un accessor rinominato restituirà un 404. Il client emette un avviso una sola volta, indicando l'accessor e la soluzione. Una versione futura renderà `collections` obbligatorio nei tipi quando viene fornito `Database`.

Alcuni nomi su `client.data` sono riservati: `collection` è la funzione dinamica `collection(slug)`, mentre `then`, `toJSON` e `$$typeof` vengono preservati per i controlli di promise e serializzazione. Una collection il cui accessor coinciderebbe con uno di questi viene generata come `<name>Collection` — lo slug `collection` diventa `client.data.collectionCollection` — e `generate-sdk` stampa un avviso indicandoli entrambi. È comunque possibile accedervi anche tramite `client.data.collection("collection")`.

### Nomi dei campi

**Il nome di un campo trasmesso via rete è la chiave della sua proprietà**, e l'API utilizza interamente il camelCase. Una proprietà `createdAt` memorizzata in una colonna `created_at` diventa `row.createdAt`, e la chiave esterna di una relazione è `authorId` anche se la colonna rimane `author_id`. `where` e `orderBy` sono basati sullo stesso tipo `Row`, quindi ciò che compila corrisponde esattamente a ciò a cui risponde il backend.

Una chiave di proprietà definita da *te* rimane la tua chiave, indipendentemente dalla sua forma — nulla rinomina un nome da te scelto. Le due chiavi che vengono derivate anziché dichiarate, ovvero la chiave esterna di una relazione e una colonna recuperata tramite introspezione, sono in camelCase.

`Row` descrive una lettura, `Insert` un `create()` e `Update` un `update()` — non hanno la stessa forma. Una colonna non obbligatoria è `T | null` in tutti e tre i casi, consentendo a una scrittura di annullarla; la chiave primaria è sempre presente in lettura e non è mai impostabile in un aggiornamento; la destinazione di una relazione `belongsTo` può essere scritta sia come relazione (`{ author: 5 }`) sia come relativa chiave esterna (`{ authorId: 5 }`), e se obbligatoria viene soddisfatta da entrambe; una `hasOne` si scrive specificando la riga di destinazione (`{ profile: 9 }`), oppure `null` per scollegarla; una `via` a singolo hop viene scritta in base al tipo che rappresenta (to-one: l'id di destinazione o `null`; to-many: un elenco di id), mentre una multi-hop è di sola lettura e non è presente in nessuno dei due; infine, l'associazione di una `hasMany` o `manyToMany` si scrive come un elenco di id di destinazione o di oggetti `{ id }` (`{ tags: ["t-1"] }`), ciascuno con un `_pivot` quando la tabella di giunzione dichiara colonne di payload. Un campo che nessuno ha il permesso di scrivere (`access: { write: [] }`) non compare né in `Insert` né in `Update`. Una colonna `date` viene letta come stringa ISO, e in scrittura accetta sia tale stringa sia un oggetto `Date`.

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
- **[Sottoscrizioni realtime](/docs/sdk/realtime)** — Dati in tempo reale con WebSocket
- **[Sincronizzazione offline e local-first](/docs/sdk/offline)** — Lavora senza connessione e sincronizza al ripristino
- **[Storage e file](/docs/sdk/storage)** — Carica, scarica e gestisci file
