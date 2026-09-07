---
sourceHash: 6bc50ef7860bac7d
title: Offline e sincronizzazione local-first
sidebar_label: Offline
description: Attiva il motore di sincronizzazione local-first dell'SDK Client di Rebase — un database locale di righe, scritture offline istantanee con rollback e query live reattive.
---

## Panoramica

Il supporto offline trasforma il livello dati dell'SDK in un **motore di sincronizzazione local-first**. Invece di una cache che ricorda le risposte, il client mantiene un piccolo database locale di righe, risponde alle query interrogandolo e tratta la rete come qualcosa che lo riempie e prima o poi accetta le tue scritture.

Ne conseguono tre cose:

- **Le letture sopravvivono alla scomparsa della rete.** Una query che il client può valutare localmente viene valutata localmente — filtri, ordinamento e paginazione inclusi — così un elenco continua a essere renderizzato anche con la connessione morta.
- **Le scritture vengono decise localmente.** Una scrittura effettuata offline si applica immediatamente, va in coda e viene ritrasmessa in ordine quando la connessione torna. Se il server la rifiuta, la modifica locale viene annullata con un rollback.
- **Le letture sono reattive.** `observe()` emette prima dal database locale e riemette ogni volta che qualcosa cambia le righe che copre — le tue stesse scritture, una scrittura in coda che va a buon fine, un rollback, un'altra scheda del browser o un evento in tempo reale.

È disattivato per impostazione predefinita. Attivalo con una sola opzione:

```typescript
const client = createRebaseClient({
    baseUrl: "https://api.example.com",
    offline: true
});
```

Nel browser tutto viene persistito su IndexedDB, quindi un ricaricamento conserva sia le righe locali sia le scritture non inviate. Altrove (Node, test) ripiega sulla memoria; altri runtime possono fornire il proprio store.

## Cosa cambia

Nulla dell'API che già usi cambia forma. `find()`, `findById()`, `create()`, `update()`, `delete()` e il builder fluido mantengono le loro firme e i loro tipi di ritorno — semplicemente smettono di fallire quando fallisce la rete.

### Letture

Una lettura riuscita unisce le sue righe nel database locale e ricorda quali id il server ha restituito per quella query. Quando una lettura non riesce a raggiungere il server, riceve una risposta locale:

```typescript
const drafts = await client.data.posts
    .where("status", "==", "draft")
    .orderBy("updatedAt", "desc")
    .find();
```

Offline, questo filtra e ordina le righe che il client possiede. Sono incluse le righe recuperate da *altre* query — il database è normalizzato, quindi una riga viene memorizzata una sola volta indipendentemente dal numero di elenchi in cui è comparsa — e le righe che hai creato offline.

Se davvero non c'è nulla con cui rispondere (una collezione che l'app non ha mai letto), la lettura lancia un errore riconoscibile invece di un semplice `TypeError`:

```typescript
import { isOfflineError } from "@rebasepro/client";

try {
    await client.data.posts.find();
} catch (error) {
    if (isOfflineError(error)) showOfflinePlaceholder();
    else throw error;
}
```

### Scritture

Finché si sa che la connessione è caduta, una scrittura non viene nemmeno tentata — si applica localmente e va in coda, così non costa nulla invece di un timeout:

```typescript
// Returns immediately, offline or not.
const post = await client.data.posts.create({ title: "Draft", status: "draft" });

// Shows up in every matching list, right away.
const drafts = await client.data.posts.where("status", "==", "draft").find();
```

Le righe create offline ricevono un id generato dal client, nel tipo che gli id della collezione hanno già: un **intero negativo** dove sono numeri, una stringa UUID dove sono stringhe. Il segno è l'indizio — una chiave reale non è mai negativa —, così una riga che non ha ancora raggiunto il server si riconosce senza consultare nulla, e `id` resta ciò che dichiara il tipo `Row` generato. Su una collezione che questo dispositivo non ha mai letto non c'è nulla in locale da cui dedurre il tipo, e l'id è un UUID.

Se il server ne assegna uno proprio in fase di ritrasmissione, la riga locale e tutte le scritture in coda che puntano ancora all'id temporaneo vengono spostate su quello reale. Fino ad allora, non conservare un id temporaneo fuori dal database offline: una chiave esterna o un URL salvato che ne contenga uno punta a una riga che sta per essere rinumerata.

Le scritture vengono ritrasmesse nell'ordine in cui le hai eseguite, attraverso le collezioni — così una create in una collezione arriva comunque prima della riga in un'altra che vi fa riferimento.

## Query live

`observe()` è la lettura reattiva, quella a cui ricorrere in un'interfaccia:

```typescript
const unsubscribe = client.data.posts.observe(
    { where: { status: ["==", "draft"] }, orderBy: ["updatedAt", "desc"] },
    (result) => {
        render(result.data);
        setBadge(result.hasPendingWrites ? "saving…" : null);
    }
);
```

La prima emissione arriva dal database locale senza alcuna richiesta di mezzo; una rivalidazione segue in background. Dopodiché riemette a ogni modifica delle righe che copre. Le emissioni sono deduplicate — un aggiornamento che non cambia nulla non richiama il callback — quindi è sicuro renderizzare direttamente da esso.

Ogni risultato porta con sé ciò che serve a un'interfaccia per descriversi:

| Campo | Significato |
|-------|---------|
| `data`, `meta` | La stessa forma restituita da `find()` |
| `fromCache` | Le righe provengono dal database locale, non da una richiesta completata |
| `hasPendingWrites` | Almeno una riga qui porta una scrittura che il server non ha accettato |
| `partial` | Il database locale potrebbe non contenere tutte le righe corrispondenti — trattalo come un risultato best-effort |
| `error` | L'ultima rivalidazione è fallita |

`observeById()` fa lo stesso per una singola riga e passa `undefined` quando viene eliminata.

Entrambi collegano la sottoscrizione in tempo reale quando il client ne ha una, così arrivano in streaming anche le modifiche fatte da altri utenti. Passa `{ realtime: false }` per una sottoscrizione che riflette solo lo stato locale e gli aggiornamenti espliciti.

Senza `offline` abilitato, `observe()` esiste comunque: recupera i dati una volta e resta live grazie al tempo reale, con tutti e tre i flag a `false`.

## Stato della sincronizzazione

`client.offline` espone il motore, ed è ciò su cui si costruisce un indicatore di sincronizzazione:

```typescript
const unsubscribe = client.offline!.onStatusChange((status) => {
    setOnline(status.online);
    setPending(status.pending);
    setSyncing(status.syncing);
});

// Or read it once
const { online, pending, syncing, lastSyncedAt, lastError } = client.offline!.status();
```

| Metodo | Scopo |
|--------|-------|
| `status()` | Connettività attuale, profondità della coda, attività di sincronizzazione, ultimo errore |
| `onStatusChange(fn)` | Sottoscrivi a quanto sopra |
| `onQueueChange(fn)` | Solo il numero di scritture non inviate, per un badge |
| `pending()` | Le mutazioni in coda stesse, dalla più vecchia |
| `sync()` | Ritrasmetti ora — si risolve con `{ flushed, remaining }` |
| `clear()` | Scarta le scritture in coda dell'utente corrente **e** le righe locali |

La ritrasmissione avviene da sé: quando il browser emette `online`, quando l'utente effettua l'accesso e con un backoff esponenziale (un secondo, che raddoppia fino a un minuto) finché c'è qualcosa in coda. `sync()` serve per un pulsante «riprova ora».

## Quando il server dice di no

Una scrittura in coda può essere rifiutata — validazione, sicurezza a livello di riga, una riga che qualcun altro ha eliminato. Questi casi non si risolvono mai da soli, quindi il motore riporta le righe locali a com'erano prima della scrittura, scarta le modifiche in coda che vi erano state costruite sopra e te lo comunica:

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    offline: {
        onSyncError: (error, mutation) => {
            toast(`Couldn't save your change to ${mutation.collection}: ${error.message}`);
        }
    }
});
```

La cascata è ristretta: un `update` viene scartato insieme alla scrittura che modificava, perché può fallire solo allo stesso modo. Un `create` o un `delete` successivo per la stessa riga sta in piedi da solo e viene mantenuto.

Un fallimento che è soltanto temporaneo — un 429, un 503, una connessione caduta — non è un rifiuto. Questi restano in coda e vengono ritentati; solo dopo `maxRetries` rinvii una scrittura viene annullata con un rollback.

## Schede multiple

Le schede della stessa app condividono un unico database IndexedDB, quindi condividono le righe locali e l'outbox. Una scrittura in una compare nelle altre, e una sola scheda alla volta ritrasmette la coda. Non c'è nulla da configurare.

## Utenti

Il database locale e l'outbox sono partizionati per utente autenticato. Le righe in cache sono quelle che la sicurezza a livello di riga ha permesso a quell'utente di vedere, e una scrittura in coda deve essere ritrasmessa come il suo autore — così disconnettersi e riaccedere come qualcun altro non mescola mai le due cose. La disconnessione non ha bisogno di ripulire nulla.

## Configurazione

```typescript
createRebaseClient({
    baseUrl: API_URL,
    offline: {
        store: myCustomStore,                 // default: IndexedDB in the browser, memory elsewhere
        maxCachedRowsPerCollection: 5000,     // rows with unsent writes are never evicted
        maxCachedQueriesPerCollection: 50,    // remembered server page compositions
        syncIntervalMs: 60_000,               // ceiling for the retry backoff; 0 disables auto-retry
        maxRetries: 5,                        // deferrals before a write is given up on
        crossTab: true,                       // default: on for IndexedDB, off for memory
        onSyncError: (error, mutation) => {}
    }
});
```

### Uno store personalizzato

Qualsiasi ambiente può persistere il database locale implementando `OfflineStore` — una superficie chiave/valore con spazio dei nomi, dotata di un'area per la cache di lettura e di un'area per la coda. È così che lo appoggi ad AsyncStorage in React Native, o al filesystem in Electron:

```typescript no-verify
import type { OfflineStore } from "@rebasepro/client";

class AsyncStorageOfflineStore implements OfflineStore {
    // Read cache: getCache, setCache, setCacheMany, deleteCache,
    //             listCache, listCacheEntries
    // Outbox:     enqueue, dequeue, listQueue
    // Both:       clear
}
```

L'unico contratto oltre all'ovvio è che gli elenchi per prefisso tornano in ordine lessicografico di chiave — è questo che rende l'outbox una FIFO.

## Limiti

Il client non è una replica del tuo database, e non finge di esserlo:

- **Sono locali solo le righe che l'app ha letto o scritto.** A una query che il client non ha mai inviato si può comunque rispondere con ciò che possiede, ma la risposta potrebbe non contenere righe che il server avrebbe restituito. I risultati live lo dichiarano tramite `partial`.
- **`searchString` è approssimato** come una scansione di sottostringhe senza distinzione tra maiuscole e minuscole sui campi stringa in cache. Il server esegue una vera ricerca full-text sulle colonne configurate della collezione.
- **Le relazioni caricate con `include` non possono essere valutate localmente** — le righe correlate vivono in collezioni che la query non ha mai caricato. Una query di questo tipo è sempre contrassegnata come `partial` quando riceve risposta dalla cache.
- **La ritrasmissione è at-least-once.** Una scrittura che raggiunge il server ma la cui risposta va persa può essere inviata di nuovo. Preferisci scritture idempotenti (`createMany` con `upsert`) dove i duplicati sarebbero un problema.
- **Le letture locali applicano la semantica di Postgres, non i dati del database.** I filtri vengono valutati come farebbe SQL — i confronti con `NULL` sono ignoti, `ORDER BY` mette i null per ultimi in ordine crescente — ma sulla copia delle righe che ha il client, che può essere obsoleta.

## Ricetta: un indicatore offline

```tsx
import React from "react";
import type { CreateRebaseClientResult } from "@rebasepro/client";

export function SyncIndicator({ client }: { client: CreateRebaseClientResult }) {
    const offline = client.offline!;
    const [status, setStatus] = React.useState(offline.status());
    React.useEffect(() => offline.onStatusChange(setStatus), [offline]);

    if (!status.online) {
        return <span className="badge warning">
            Offline{status.pending ? ` · ${status.pending} unsaved` : ""}
        </span>;
    }
    if (status.syncing) return <span className="badge">Syncing…</span>;
    if (status.pending) return <span className="badge">{status.pending} unsaved</span>;
    return null;
}
```

## Vedi anche

- [Interrogare i dati](/docs/sdk/querying) — la superficie di query che `observe()` condivide con `find()`
- [Sottoscrizioni in tempo reale](/docs/sdk/realtime) — aggiornamenti inviati dal server, su cui si basano le query live
