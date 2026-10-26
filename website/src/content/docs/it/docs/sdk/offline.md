---
sourceHash: 4cc7758ee53e304b
title: Offline e sincronizzazione local-first
sidebar_label: Offline
description: Attiva il motore di sincronizzazione local-first dell'SDK tipizzato di Rebase — un database locale di righe, scritture offline istantanee con rollback e query live reattive.
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
// While offline, returns at once with the locally applied row.
const post = await client.data.posts.create({ title: "Draft", status: "draft" });

// Shows up in every matching list, right away.
const drafts = await client.data.posts.where("status", "==", "draft").find();
```

Le righe create offline ricevono un id generato dal client, nel tipo che gli id della collezione hanno già: un **intero negativo** dove sono numeri, una stringa UUID dove sono stringhe. Il segno è l'indizio — una chiave reale non è mai negativa —, così una riga che non ha ancora raggiunto il server si riconosce senza consultare nulla, e `id` resta ciò che dichiara il tipo `Row` generato. Su una collezione che questo dispositivo non ha mai letto non c'è nulla in locale da cui dedurre il tipo, e l'id è un UUID.

Se il server ne assegna uno proprio in fase di ritrasmissione, la riga locale e tutte le scritture in coda che puntano ancora all'id temporaneo vengono spostate su quello reale, in ogni collezione: un post in coda con `author_id` impostato su un autore creato offline viene inviato con l'id che il server ha dato all'autore. Se invece il server rifiuta l'autore, le scritture che lo referenziano vengono scartate insieme a esso e segnalate come `DEPENDENCY_REJECTED` (vedi [Quando il server dice di no](#quando-il-server-dice-di-no)). Fino ad allora, non conservare un id temporaneo fuori dal database offline: una chiave esterna o un URL salvato che ne contenga uno punta a una riga che sta per essere rinumerata.

Le scritture vengono ritrasmesse nell'ordine in cui le hai eseguite, attraverso le collezioni — così una create in una collezione arriva comunque prima della riga in un'altra che vi fa riferimento.

Per impostazione predefinita ogni scrittura in coda è una richiesta, quindi 500 righe digitate offline richiedono 500 round trip per essere smaltite. Con `replayBatchSize` impostato (fino a 1 000), una serie di create offline consecutive in una collezione viene ritrasmessa invece come un unico `createMany`. Vengono raggruppate solo le create con un id stringa generato dall'SDK, e mai una che fa riferimento a un'altra riga della stessa serie. Se il server rifiuta o rimanda la serie per qualsiasi motivo diverso da una connessione persa, non viene scritto nulla (una scrittura bulk è una transazione), e la serie viene ritrasmessa una scrittura alla volta, come avverrebbe per impostazione predefinita.

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

`observeById()` fa lo stesso per una singola riga e passa `undefined` quando viene eliminata. Accetta `include` come `findById()`, e ogni emissione porta con sé quelle relazioni:

```typescript
const stop = client.data.posts.observeById(postId, (post) => render(post), undefined, {
    include: ["tags"]
});
```

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
| `status()` | Connettività attuale, profondità della coda, attività di sincronizzazione, ultimo errore, e `persisted`: se il browser ha accettato di conservare il database offline (richiesto quando viene messa in coda la prima scrittura; `false` significa che può essere eliminato in caso di scarsità di spazio, comprese le scritture non inviate). `unverifiedUser` è `true` mentre un ricaricamento offline mostra i dati dell'ultimo utente senza una sessione confermata (vedi [`keepLastUser`](#ricaricamenti-offline-in-modalità-cookie)) |
| `onStatusChange(fn)` | Sottoscrivi a quanto sopra |
| `onQueueChange(fn)` | Solo il numero di scritture non inviate, per un badge |
| `pending()` | Le mutazioni in coda stesse, dalla più vecchia. `pending({ orphaned: true })`: quelle messe in coda senza un accesso — vedi [Utenti](#utenti) |
| `sync()` | Ritrasmetti ora — si risolve con `{ flushed, remaining }` |
| `clear()` | Scarta le scritture in coda dell'utente corrente **e** le righe locali. `clear({ orphaned: true })`: invece quelle messe in coda senza un accesso |

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

Una riga che qualcun altro ha eliminato è l'unico caso che non viene annullato. Un `delete` in coda di essa ha fatto ciò per cui era stato scritto, quindi conta come sincronizzato e non viene segnalato. Una modifica in coda di essa viene segnalata, e la riga viene rimossa dal database locale invece di essere ripristinata, perché il server non la ha più.

La cascata è ristretta: un `update` viene scartato insieme alla scrittura che modificava, perché può fallire solo allo stesso modo. Un `create` o un `delete` successivo per la stessa riga sta in piedi da solo e viene mantenuto. Un `create` rifiutato di una riga creata offline porta con sé anche ogni scrittura in coda, in qualsiasi collezione, i cui valori referenziano l'id temporaneo della riga. Una scrittura scartata non è mai stata inviata. Viene segnalata con un `RebaseApiError` il cui `code` è `DEPENDENCY_REJECTED` e il cui `cause` è il rifiuto che l'ha condannata, così puoi distinguerla dalla scrittura che il server ha effettivamente rifiutato. Sulla 0.23 porta invece l'errore della scrittura rifiutata stessa.

Modifiche consecutive a una stessa riga mentre si è offline vengono unite in un'unica scrittura in coda, così un form in cui si sta digitando non fa crescere la coda. In una scrittura che la coda ha iniziato a inviare non si fonde nulla: una modifica fatta dopo un tentativo di ritrasmissione la cui risposta è andata persa viene messa in coda come un update a sé, e l'eliminazione di una riga creata offline viene inviata invece di essere annullata contro la sua creazione, dato che il server potrebbe già avere la riga. Se il server rifiuta la scrittura unita per il suo contenuto (un 400, 403 o 422 — ad esempio un campo rimosso da una modifica dello schema mentre l'utente era offline), il motore la scompone di nuovo nelle modifiche separate e le riapplica una per una. Viene annullata e segnalata solo la modifica che il server rifiuta; le altre vengono mantenute.

### Conflitti

Per impostazione predefinita una modifica messa in coda offline sovrascrive ciò che il server ha per i campi che ha cambiato, anche se qualcun altro li ha cambiati nel frattempo. Per scoprirlo, passa `onConflict`. Un `update` in coda viene allora ritrasmesso con `If-Match`, la versione della riga su cui è stato fatto, e quando la riga è cambiata nel frattempo, il server lo rifiuta con un 412 e `onConflict` decide:

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    offline: {
        onConflict: async (error, mutation) =>
            (await askUser(`${mutation.collection} changed while you were offline. Keep your edit?`))
                ? "overwrite"
                : "discard"
    }
});
```

- `"overwrite"` invia di nuovo la modifica senza la precondizione: vince l'ultimo che scrive, come senza `onConflict`.
- `"discard"` scarta la modifica. La riga torna a ciò che era prima di essa, come per un rifiuto, e viene riletta dal server. Non viene segnalata a `onSyncError`; le scritture messe in coda sopra di essa lo sono, come `DEPENDENCY_REJECTED`.

La coda attende mentre `onConflict` è in esecuzione, quindi può interrogare l'utente. Se lancia un'eccezione, la modifica viene sovrascritta.

La versione su cui viene fatta una modifica è quella riportata dall'ultima lettura della riga: `findById()`, un frame di `listenById()`, o la risposta di un precedente `update()`. Una riga letta per ultima in un elenco di `find()` o `listen()` non ha versione, e nemmeno una modifica fatta sopra un'altra scrittura in coda sulla stessa riga. Queste vengono ritrasmesse senza precondizione. Un `ifMatch` che passi tu stesso a `update()` o `delete()` viene mantenuto quando la scrittura viene messa in coda, con o senza `onConflict`, e `findById()` su un client con offline abilitato restituisce la riga con la sua versione, quindi `etagOf(row)` funziona come online. Senza `onConflict`, una scrittura in coda rifiutata a causa del tuo stesso `ifMatch` viene annullata e segnalata a `onSyncError` con un 412 `PRECONDITION_FAILED`.

Un fallimento che è soltanto temporaneo — un 429, un 503, una connessione caduta — non è un rifiuto. Questi restano in coda e vengono ritentati; solo dopo `maxRetries` rinvii una scrittura viene annullata con un rollback.

## Schede multiple

Le schede della stessa app condividono un unico database IndexedDB, quindi condividono le righe locali e l'outbox. Una scrittura in una compare nelle altre, e una sola scheda alla volta ritrasmette la coda. Non c'è nulla da configurare.

Quest'ultima garanzia viene dalla [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) del browser, che esiste solo in un contesto sicuro (HTTPS, o `localhost`) e non in Safari prima della 15.4 né in alcune webview incorporate. Senza di essa, ogni scheda aperta ritrasmette la coda quando sincronizza. Create, scritture bulk, aggiornamenti ed eliminazioni vengono tutti ritrasmessi con una chiave di idempotenza, quindi un server che memorizza le chiavi applica ciascuno di essi una sola volta; ciò che puoi vedere è la stessa scrittura inviata da due schede.

## Utenti

Il database locale e l'outbox sono partizionati per utente autenticato. Le righe in cache sono quelle che la sicurezza a livello di riga ha permesso a quell'utente di vedere, e una scrittura in coda deve essere ritrasmessa come il suo autore — così disconnettersi e riaccedere come qualcun altro non mescola mai le due cose. La disconnessione non ha bisogno di ripulire nulla.

### Mentre la sessione viene ripristinata

Finché il client non sa chi ha effettuato l'accesso, non sa quale database locale e quale outbox usare, quindi le letture e le scritture offline aspettano. È il tempo che impiega `auth.isInitialized()`: nessuno per una sessione salvata ancora valida, e una richiesta di refresh quando la sessione deve tornare dal server — in modalità cookie, dove sul dispositivo non viene salvato nulla, succede a ogni caricamento di pagina. Una scrittura fatta in quell'intervallo viene messa in coda per l'utente che la sessione risulta essere, e una lettura risponde dal suo database locale. Un evento realtime che arriva nel frattempo viene passato alla tua callback così come l'ha inviato il server, e non viene conservato da nessuna parte.

Se la sessione non può essere ripristinata — il refresh viene rifiutato o, in modalità cookie, non raggiunge il server — il client risulta disconnesso, e le letture e le scritture offline sono quelle dell'utente disconnesso. Sulla 0.23 la modalità cookie trattava tutto quell'intervallo come disconnesso, quindi una scrittura fatta in quel momento veniva messa in coda per l'utente disconnesso.

### Scritture fatte senza un accesso

Le scritture messe in coda mentre nessuno aveva effettuato l'accesso non vengono ritrasmesse quando qualcuno accede. Quell'utente non le ha fatte, e ritrasmetterle con le sue credenziali metterebbe le modifiche di una persona a nome di un'altra — su un dispositivo condiviso, le scritture di un visitatore nell'account dell'utente successivo. Non vengono nemmeno spostate nell'outbox dell'utente che ha effettuato l'accesso. Vengono conservate ed elencate a parte, così l'app può decidere cosa farne:

```typescript
client.auth.onAuthStateChange(async (event) => {
    if (event !== "SIGNED_IN") return;
    const orphaned = await client.offline!.pending({ orphaned: true });
    if (orphaned.length === 0) return;
    if (await askToKeep(orphaned.length)) {
        // Re-issue each one yourself, now as the signed-in user.
        for (const write of orphaned) await reissue(write);
    }
    await client.offline!.clear({ orphaned: true });
});
```

`clear({ orphaned: true })` le scarta, insieme alle righe locali a cui erano state applicate; l'outbox dell'utente che ha effettuato l'accesso non viene toccata. Se le si lascia stare, vengono ritrasmesse la prossima volta che nessuno ha effettuato l'accesso. Finché nessuno ha effettuato l'accesso sono semplicemente l'outbox corrente, e `pending({ orphaned: true })` non elenca nulla.

### Ricaricamenti offline in modalità cookie

In modalità cookie nulla della sessione viene memorizzato sul dispositivo, quindi un ricaricamento
che non può raggiungere il server non ha utente. Per impostazione predefinita viene trattato come
disconnesso: le righe locali dell'utente sono nascoste, e le scritture fatte in quel momento vengono messe in coda
come quelle dell'utente disconnesso.

`keepLastUser: true` cambia questo comportamento. Il client ricorda l'ultimo utente che
ha effettuato l'accesso sul dispositivo (solo il suo id), e un ricaricamento offline apre invece il
database locale di quell'utente. Le scritture fatte allora vengono messe in coda come sue, ma nessuna
viene ritrasmessa finché la sessione non è confermata: quando la connessione torna, il
client aggiorna la sessione, e anche un accesso la conferma. Se il server
rifiuta la sessione, o qualcun altro accede, il dispositivo cambia utente, e le
scritture in coda restano al loro autore finché non accede di nuovo. Nel frattempo
`status().unverifiedUser` è `true`, e questo vale anche online: finché il
refresh non risponde, le scritture vengono messe in coda invece di partire senza
credenziali, e le letture ricevono risposta dalle righe locali dell'utente. Ciò
che il server invia a una richiesta senza sessione è ciò che un chiamante
disconnesso può vedere, quindi non viene conservato.

```typescript
createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" },
    offline: { keepLastUser: true }
});
```

È disattivato per impostazione predefinita perché su un dispositivo condiviso permette di leggere offline, senza una sessione, le righe
in cache dell'utente precedente. Attivalo per installazioni che
appartengono a una sola persona. L'id viene dimenticato alla disconnessione e quando il server
rifiuta la sessione. Non viene mai usato quando il server risponde che non c'è alcuna
sessione.

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
        keepLastUser: false,                  // open the last user's data on an offline reload (cookie mode)
        replayBatchSize: 1,                   // queued creates sent per request on replay (max 1000)
        onConflict: (error, mutation) => "overwrite", // or "discard"; default: no conflict check
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
- **`findAll()` e `iterate()` leggono solo pagine a cui il server ha risposto su questo dispositivo.** Uno scorrimento prosegue finché ogni pagina dice che ce n'è altra, e solo il server può dirlo. Offline, uno scorrimento che ha bisogno di una pagina che questo dispositivo non ha mai recuperato fallisce con l'errore `OFFLINE` (`isOfflineError`) invece di restituire parte della collezione come se fosse tutta. Sulla 0.24 si fermava a quella pagina e restituiva ciò che aveva.
- **`count()` offline ha bisogno di un conteggio che il server ha dato a questo dispositivo per la stessa query.** Lo spostano le scritture messe in coda da allora: create, modifiche che portano una riga dentro o fuori dal filtro, ed eliminazioni. Senza di esso fallisce con l'errore `OFFLINE` invece di contare le righe che questo dispositivo si trova ad avere. Sulla 0.24 restituiva quel numero.
- **`searchString` è approssimato** come una scansione di sottostringhe senza distinzione tra maiuscole e minuscole sui campi stringa in cache. Il server esegue una vera ricerca full-text sulle colonne configurate della collezione.
- **Le relazioni caricate con `include` non possono essere valutate localmente** — le righe correlate vivono in collezioni che la query non ha mai caricato. Una query di questo tipo è sempre contrassegnata come `partial` quando riceve risposta dalla cache.
- **I conflitti sono last-writer-wins, per campo, a meno che tu non passi `onConflict`.** Un `update` ritrasmesso invia i campi che l'utente ha modificato e nient'altro, quindi i campi che non ha toccato mantengono ciò che ha il server. Per un campo che *ha* modificato, una modifica fatta da qualcun altro sul server mentre era offline viene sovrascritta quando la coda viene ritrasmessa, e nessuno dei due utenti ne viene informato. Con [`onConflict`](#conflitti), una modifica di cui è nota la versione della riga viene confrontata con quella del server, e decide l'app. Create, eliminazioni e scritture bulk non vengono mai controllate.
- **La ritrasmissione è at-least-once.** Una scrittura che raggiunge il server ma la cui risposta va persa può essere inviata di nuovo. Preferisci scritture idempotenti (`createMany` con `upsert`) dove i duplicati sarebbero un problema.
- **Il cestino ha bisogno del server.** Il database locale contiene solo righe attive, quindi `trash.find()`, `trash.count()`, `trash.restore()` e `trash.purge()` (vedi [soft delete](/docs/collections/soft-delete#from-the-sdk)) non ricevono mai risposta in locale né vengono messi in coda: offline falliscono con l'errore `OFFLINE`. Un ripristino o un'eliminazione definitiva di una riga con una scrittura ancora in coda sincronizza prima la coda, e viene rifiutato con `TRASH_PENDING_WRITE` se la scrittura non può ancora essere inviata.
- **Un upsert su una chiave naturale ha bisogno del server.** Quale riga indichi un target `onConflict` può scoprirlo solo il server, quindi `upsert()` su una chiave naturale (o senza l'id della riga), e un `createMany()` con `onConflict` mai inviato, vengono rifiutati offline con `OFFLINE_UPSERT_UNSUPPORTED`. Un upsert sulla chiave primaria, con la chiave in ogni riga, viene messo in coda.
- **Le letture locali applicano la semantica di Postgres, non i dati del database.** I filtri vengono valutati come farebbe SQL — i confronti con `NULL` sono ignoti, `ORDER BY` mette i null per ultimi in ordine crescente — ma sulla copia delle righe che ha il client, che può essere obsoleta.
- **Un ordinamento che il client non può riprodurre non viene applicato.** L'ordinamento del testo spetta al server: PostgreSQL lo ordina secondo la collation del *database*, che questo processo non conosce, e con la collation C `Banana` viene prima di `apple` mentre un collator JavaScript dice il contrario. Quando una colonna di ordinamento non può essere confrontata numericamente, le righe mantengono l'ordine inviato dal server e il risultato viene contrassegnato come `partial` anziché essere presentato come la pagina ordinata che era stata richiesta. Ogni chiave di un ordinamento su più colonne deve essere riproducibile, non solo la prima — un ordinamento su cui il lato locale concorda solo fino alla seconda colonna è un ordinamento su cui non concorda.

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
