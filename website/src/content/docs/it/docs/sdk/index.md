---
sourceHash: d84680ca60bab8a4
title: SDK tipizzato — Primi passi
sidebar_label: Primi Passi
description: Installa e configura il Client SDK di Rebase per interagire con il tuo backend da qualsiasi applicazione JavaScript o TypeScript.
---

## Panoramica

Il pacchetto `@rebasepro/client` fornisce un SDK JavaScript type-safe per interagire con il tuo backend Rebase. Gestisce:

- **Operazioni sui dati** — CRUD con filtri, ordinamento e paginazione
- **Recupero delle relazioni** — Include entità correlate con `.include()`
- **Sottoscrizioni in tempo reale** — Aggiornamenti live basati su WebSocket
- **Sincronizzazione offline e local-first** — Database locale opzionale per le righe, scritture offline istantanee, query live
- **Autenticazione** — Gestione dei token, login, registrazione, OAuth
- **Storage** — Caricamento, download e gestione dei file
- **Funzioni personalizzate** — Chiamata a endpoint server personalizzati

## Installazione

```bash
pnpm add @rebasepro/client
```

## Creazione di un client

`rebase dev` ricava una porta libera dal percorso del progetto anziché usarne una fissa, quindi **leggi `baseUrl` dall'URL stampato a video** — non esiste una porta comune a tutti i progetti. In un frontend Vite, questa corrisponde a `VITE_API_URL` che lo scaffold scrive in `.env`; in uno script, puoi usare una tua variabile d'ambiente.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
});
```

`websocketUrl` viene ricavato automaticamente da `baseUrl` (`http → ws`, `https → wss`). Puoi sovrascriverlo esplicitamente se necessario:

```typescript
const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    websocketUrl: import.meta.env.VITE_WS_URL,
});
```

### Opzioni di configurazione

| Opzione | Tipo | Descrizione |
|--------|------|-------------|
| `baseUrl` | `string` | URL del backend. Leggilo dall'output di `rebase dev` o dal tuo deployment |
| `websocketUrl` | `string` | URL del WebSocket — ricavato automaticamente da `baseUrl` se omesso |
| `token` | `string` | Token JWT statico per chiamate server-to-server |
| `apiPath` | `string` | Prefisso delle API (predefinito: `"/api"`) |
| `fetch` | `typeof fetch` | Implementazione fetch personalizzata (es. per SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Gestore personalizzato per l'errore 401 — restituisci `true` per riprovare |
| `realtime` | `boolean` | Apre il WebSocket (predefinito `true`) — imposta su `false` in script one-shot |
| `collections` | `Record<string, string>` | Mappa i nomi degli accessor agli slug delle collection |
| `offline` | `boolean \| OfflineConfig` | [Sincronizzazione local-first](/docs/sdk/offline) — disattivata per impostazione predefinita |

## Generazione dell'SDK tipizzato

Genera un client completamente tipizzato a partire dalle definizioni delle tue collection:

```bash
rebase generate-sdk
```

Quindi passa il parametro di tipo `Database` a `createRebaseClient` per ottenere l'autocompletamento completo:

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

Quando viene fornito `Database`, `createRebaseClient` restituisce un'istanza di `CreateRebaseClientResult<DB>`. Questo mappa gli accessor delle collection in camelCase direttamente su `client.data` con i relativi tipi, fornendo l'autocompletamento completo su operazioni e tipi delle collection (es. `client.data.products.find()`).

`collectionsDictionary` mappa ciascun accessor sullo slug utilizzato a livello di rete (wire). Passalo ogni volta che uno slug non è già un nome di proprietà valido — `my-notes` è accessibile come `client.data.myNotes` solo perché il dizionario lo definisce.

### Nomi dei campi

**Il nome di un campo sulla rete è la sua chiave di proprietà**, e l'API utilizza ovunque il camelCase. Una proprietà `createdAt` memorizzata in una colonna `created_at` corrisponde a `row.createdAt`, e la foreign key di una relazione è `authorId` anche se la colonna rimane `author_id`. `where` e `orderBy` sono basati sullo stesso tipo `Row`, quindi ciò che compila è ciò a cui risponde il backend.

Una chiave di proprietà scritta da *te* rimane invariata, qualunque sia la sua forma — nulla rinomina un nome da te scelto. Le due chiavi che vengono derivate anziché dichiarate, ovvero la foreign key di una relazione e una colonna letta tramite introspezione, sono in camelCase.

`Row` descrive una lettura, `Insert` una `create()` e `Update` una `update()` — non hanno la stessa forma. Le colonne nullable sono `T | null` su `Row`, la primary key è sempre presente in lettura e non è mai impostabile in un aggiornamento, e il target di un `belongsTo` può essere scritto sia come relazione (`{ author: 5 }`) sia come foreign key (`{ authorId: 5 }`).

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
- **[Sincronizzazione offline e local-first](/docs/sdk/offline)** — Lavora senza connessione e sincronizza al suo ripristino
- **[Storage e file](/docs/sdk/storage)** — Carica, scarica e gestisci i file
