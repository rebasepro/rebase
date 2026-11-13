---
sourceHash: 1b875d11f8a07037
title: Sincronizzazione offline e local-first
sidebar_label: Offline
description: "Abilita il motore di sincronizzazione local-first dell'SDK tipizzato di Rebase: un database locale di righe, scritture offline istantanee con rollback e live query reattive."
---

## Panoramica

Il supporto offline trasforma il data layer dell'SDK in un **motore di sincronizzazione local-first**. Invece di una cache che memorizza le risposte, il client mantiene un piccolo database locale di righe, risponde alle query tramite di esso e tratta la rete come qualcosa che lo popola e infine accetta le tue scritture.

Da questo derivano tre conseguenze:

- **Le letture sopravvivono alla perdita di connessione.** Una query che il client può valutare localmente viene valutata localmente (inclusi filtri, ordinamento e paginazione), quindi un elenco continua a essere renderizzato anche senza connessione.
- **Le scritture vengono decise localmente.** Una scrittura eseguita offline viene applicata immediatamente, accodata e rieseguita in ordine quando la connessione si ripristina. Se il server la rifiuta, la modifica locale viene annullata (rollback).
- **Le letture sono reattive.** `observe()` emette prima dal database locale e riemette ogni volta che qualcosa modifica le righe coperte: le tue scritture, una scrittura in coda che va a buon fine, un rollback, un'altra scheda del browser o un evento realtime.

È disattivato per impostazione predefinita. Si attiva con una sola opzione:

```typescript
const client = createRebaseClient({
    baseUrl: "https://api.example.com",
    offline: true
});
```

Nel browser tutto persiste in IndexedDB, quindi un ricaricamento mantiene sia le righe locali sia le scritture non inviate. Altrove (Node, test) ricorre alla memoria; altri runtime possono fornire il proprio archivio.

## Cosa cambia

Nulla nelle API che già utilizzi cambia forma. `find()`, `findById()`, `create()`, `update()`, `delete()` e il fluent builder mantengono le proprie firme e i propri tipi di ritorno: semplicemente smettono di fallire quando la rete smette di funzionare.

### Letture

Una lettura riuscita unisce le sue righe nel database locale e memorizza quali ID sono stati restituiti dal server per quella query. Quando una lettura non riesce a raggiungere il server, la risposta viene fornita localmente:

```typescript
const drafts = await client.data.posts
    .where("status", "==", "draft")
    .orderBy("updatedAt", "desc")
    .find();
```

Offline, questo filtra e ordina le righe conservate dal client. Ciò include le righe recuperate da *altre* query (il database è normalizzato, quindi una riga viene memorizzata una sola volta, indipendentemente da quanti elenchi la contenessero) e le righe create offline.

Se non c'è davvero nulla con cui rispondere (una tabella che l'app non ha mai letto), la lettura genera un errore riconoscibile anziché un semplice `TypeError`:

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

Quando è noto che la connessione è assente, una scrittura non viene nemmeno tentata: viene applicata localmente e accodata, senza alcun costo anziché causare un timeout:

```typescript
// While offline, returns at once with the locally applied row.
const post = await client.data.posts.create({ title: "Draft", status: "draft" });

// Shows up in every matching list, right away.
const drafts = await client.data.posts.where("status", "==", "draft").find();
```

Le righe create offline ricevono un ID generato dal client, dello stesso tipo già usato dagli ID della tabella: un **intero negativo** se sono numerici, una stringa UUID se sono stringhe. Il segno è il segno distintivo (una chiave reale non è mai negativa), quindi una riga che non ha ancora raggiunto il server è riconoscibile senza alcuna ricerca, e il controllo dei tipi per `id` continua a convalidarsi secondo quanto definito dal tipo `Row` generato. In una tabella che questo dispositivo non ha mai letto non c'è nulla a livello locale da cui ricavare il tipo, e l'ID sarà un UUID.

Se il server ne assegna uno proprio durante la riesecuzione (replay), la riga locale ed eventuali scritture in coda che puntano ancora all'ID temporaneo vengono aggiornate con quello reale, in ogni tabella: un post in coda con `author_id` impostato su un autore creato offline viene inviato con l'ID assegnato dal server all'autore. Se invece il server rifiuta l'autore, le scritture che vi fanno riferimento vengono scartate insieme a esso e segnalate come `DEPENDENCY_REJECTED` (vedi [Quando il server dice di no](#quando-il-server-dice-di-no)). Fino ad allora, non persistere un ID temporaneo al di fuori del database offline: una foreign key o un URL salvato nei preferiti che ne contiene uno punterebbe a una riga che sta per essere rinumerata.

Le scritture vengono rieseguite nell'ordine in cui sono state effettuate, tra le diverse tabelle; pertanto, una creazione in una tabella viene comunque elaborata prima della riga in un'altra tabella che vi fa riferimento.

Ogni scrittura in coda corrisponde a una richiesta per impostazione predefinita, quindi 500 righe digitate offline richiedono 500 round trip per essere smaltite. Con `replayBatchSize` impostato (fino a 1 000), una serie di creazioni consecutive offline in una tabella viene rieseguita come un'unica `createMany`. Vengono raggruppate solo le creazioni con un ID generato dall'SDK come stringa, e mai quelle che fanno riferimento a un'altra riga della stessa sequenza. Se il server rifiuta o rimanda la serie per qualsiasi motivo diverso da una perdita di connessione, non viene scritto nulla (una scrittura massiva è un'unica transazione) e la sequenza viene rieseguita una scrittura alla volta, come avverrebbe per impostazione predefinita.

### Scritture accodate da una versione precedente

<span class="since-badge" data-since="0.31">Da 0.31</span>

La coda memorizza una scrittura sotto forma di valori inviati (chiavi per le relazioni, elenchi di numeri per i vettori, `{ latitude, longitude }` per i punti geografici, testo ISO per le date) e le righe memorizzate nella cache come righe del server. Una scrittura accodata offline dalla versione precedente dell'SDK, che le memorizzava come classi (`EntityRelation`, `GeoPoint`, `Vector`), viene convertita in tali valori quando viene riletta e rieseguita come di consueto: nulla di quanto accodato prima dell'aggiornamento va perso. Un SDK più vecchio che incontra una scrittura accodata da questa versione la lascia in coda.

## Live query

`observe()` è la lettura reattiva ed è quella da utilizzare in una UI:

```typescript
const unsubscribe = client.data.posts.observe(
    { where: { status: ["==", "draft"] }, orderBy: ["updatedAt", "desc"] },
    (result) => {
        render(result.data);
        setBadge(result.hasPendingWrites ? "saving…" : null);
    }
);
```

La prima emissione proviene dal database locale senza alcuna richiesta di mezzo; segue una riconvalida in background. Successivamente, riemette a ogni modifica delle righe coperte. Le emissioni vengono deduplicate (un aggiornamento che non cambia nulla non richiama il callback), quindi è sicuro effettuare il rendering direttamente da essa.

Ciascun risultato include ciò di cui una UI ha bisogno per descriversi:

| Campo | Significato |
|-------|-------------|
| `data`, `meta` | La stessa struttura restituita da `find()` |
| `fromCache` | Le righe provengono dal database locale, non da una richiesta completata |
| `hasPendingWrites` | Almeno una riga qui contiene una scrittura non ancora accettata dal server |
| `partial` | Il database locale potrebbe non contenere tutte le righe corrispondenti; da considerare come best-effort |
| `error` | L'ultima riconvalida è fallita |

`observeById()` fa lo stesso per una singola riga e passa `undefined` quando viene eliminata. Accetta `include` come fa `findById()`, e ogni emissione include tali relazioni:

```typescript
const stop = client.data.posts.observeById(postId, (post) => render(post), undefined, {
    include: ["tags"]
});
```

Entrambi collegano la sottoscrizione realtime quando il client ne ha una, consentendo così di ricevere in streaming anche le modifiche apportate da altri utenti. Passa `{ realtime: false }` per una sottoscrizione che rifletta solo lo stato locale e gli aggiornamenti espliciti.

Senza `offline` abilitato, `observe()` esiste comunque: recupera i dati una volta e rimane live tramite realtime, con tutti e tre i flag impostati su `false`.

## Stato di sincronizzazione

`client.offline` espone il motore, su cui si basa un indicatore di sincronizzazione:

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
| `status()` | Connettività corrente, profondità della coda, attività di sincronizzazione, ultimo errore e `persisted`: se il browser ha acconsentito a mantenere il database offline (richiesto quando viene accodata la prima scrittura; `false` indica che potrebbe essere rimosso in caso di memoria insufficiente, incluse le scritture non inviate). `unverifiedUser` è `true` quando un ricaricamento offline mostra i dati dell'ultimo utente senza una sessione confermata (vedi [`keepLastUser`](#ricaricamenti-offline-in-modalità-cookie)) |
| `onStatusChange(fn)` | Sottoscrive quanto sopra |
| `onQueueChange(fn)` | Solo il numero di scritture non inviate, utile per un badge |
| `pending()` | Le mutazioni in coda stesse, dalla più vecchia alla più recente. `pending({ orphaned: true })`: quelle accodate mentre non si era autenticati — vedi [Utenti](#utenti) |
| `sync()` | Riesegue ora la sincronizzazione — si risolve con `{ flushed, remaining }` |
| `clear()` | Elimina le scritture in coda dell'utente corrente **e** le righe locali. `clear({ orphaned: true })`: quelle accodate mentre non si era autenticati |

La riesecuzione (replay) avviene automaticamente: quando il browser genera l'evento `online`, quando l'utente effettua l'accesso e con un backoff esponenziale (un secondo, raddoppiando fino a un minuto) finché c'è qualcosa in coda. `sync()` è pensato per un pulsante "riprova ora".

## Quando il server dice di no

Una scrittura in coda può essere rifiutata: validazione, row-level security, una riga eliminata da qualcun altro. Questi casi non si risolvono mai da soli, quindi il motore ripristina le righe locali a come erano prima della scrittura, scarta le modifiche in coda costruite su di essa e ti avvisa:

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

Una riga eliminata da qualcun altro è l'unico caso che non viene sottoposto a rollback. Una `delete` in coda su di essa ha ottenuto lo scopo previsto, quindi viene considerata sincronizzata e non viene segnalata. Una modifica in coda su di essa viene segnalata e la riga viene rimossa dal database locale anziché ripristinata, poiché il server non la possiede più.

La propagazione a cascata è mirata: un'`update` viene scartata insieme alla scrittura che ha modificato, perché fallirebbe nello stesso modo. Una successiva `create` o `delete` per la stessa riga è indipendente e viene conservata. Il rifiuto di una `create` di una riga creata offline comporta anche l'eliminazione di ogni scrittura in coda, in qualsiasi tabella, i cui valori facciano riferimento all'ID temporaneo della riga. Una scrittura scartata non è mai stata inviata. Viene segnalata con un `RebaseApiError` il cui `code` è `DEPENDENCY_REJECTED` e la cui `cause` è il rifiuto che ne ha determinato l'annullamento, così da poterla distinguere dalla scrittura effettivamente rifiutata dal server.

Le modifiche consecutive a una stessa riga mentre si è offline vengono unite in una singola scrittura accodata, evitando che la compilazione progressiva di un modulo faccia crescere la coda a dismisura. Una scrittura che la coda ha già iniziato a inviare non viene unita: una modifica effettuata dopo un tentativo di riesecuzione la cui risposta è andata persa viene accodata come un aggiornamento a sé stante, e l'eliminazione di una riga creata offline viene inviata anziché annullata rispetto alla sua creazione, poiché il server potrebbe già contenere la riga. Se il server rifiuta la scrittura unita a causa dei suoi contenuti (un 400, 403 o 422 — ad esempio, un campo rimosso da una modifica allo schema mentre l'utente era offline), il motore la risuddivide nelle singole modifiche e le riesegue una per una. Solo la modifica rifiutata dal server viene annullata e segnalata; le altre vengono mantenute.

### Conflitti

Per impostazione predefinita, una modifica accodata offline sovrascrive ciò che il server contiene per i campi modificati, anche se qualcun altro li ha modificati nel frattempo. Per gestire diversamente questo scenario, passa `onConflict`. Un'`update` in coda viene quindi rieseguita con `If-Match`, la versione della riga rispetto alla quale è stata effettuata la modifica; se la riga è cambiata nel frattempo, il server la rifiuta con un errore 412 e `onConflict` decide l'azione:

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

- `"overwrite"` invia nuovamente la modifica senza la precondizione: vince l'ultima scrittura (last-writer-wins), come avverrebbe senza `onConflict`.
- `"discard"` annulla la modifica. La riga torna a come era prima di essa, come in caso di rifiuto, e viene riletta dal server. Non viene segnalata a `onSyncError`; le scritture accodate basate su di essa vengono invece segnalate come `DEPENDENCY_REJECTED`.

La coda attende durante l'esecuzione di `onConflict`, consentendo così di interpellare l'utente. Se genera un errore, la modifica viene sovrascritta.

La versione rispetto alla quale viene effettuata una modifica è quella riportata dall'ultima lettura della riga: `findById()`, un frame `listenById()` o la risposta a una precedente `update()`. Una riga letta per l'ultima volta in un elenco `find()` o `listen()` non ha alcuna versione, così come non ne ha una modifica effettuata sopra un'altra scrittura in coda per la stessa riga. Queste vengono rieseguite senza alcuna precondizione. Un `ifMatch` passato manualmente a `update()` o `delete()` viene mantenuto quando la scrittura viene accodata, con o senza `onConflict`, e `findById()` su un client con supporto offline abilitato restituisce la riga con la sua versione, per cui `etagOf(row)` funziona esattamente come online. Senza `onConflict`, una scrittura in coda rifiutata a causa del tuo `ifMatch` viene annullata tramite rollback e segnalata a `onSyncError` con un errore 412 `PRECONDITION_FAILED`.

Un errore puramente temporaneo (un 429, un 503, una connessione interrotta) non è un rifiuto. Queste operazioni rimangono in coda e vengono ritentate; solo dopo un numero di rinvii pari a `maxRetries` la scrittura viene annullata con un rollback.

## Schede multiple

Le schede della stessa applicazione condividono un unico database IndexedDB, condividendo quindi le righe locali e l'outbox. Una scrittura in una scheda appare nelle altre e una sola scheda alla volta riesegue la coda. Nessuna configurazione necessaria.

Quest'ultima garanzia deriva dalla [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) del browser, disponibile solo in un contesto sicuro (HTTPS o `localhost`) e assente in Safari prima della versione 15.4 o in alcune webview incorporate. Senza di essa, ogni scheda aperta riesegue la coda al momento della sincronizzazione. Creazioni, scritture massive, aggiornamenti ed eliminazioni vengono tutti rieseguiti con una chiave di idempotenza, quindi un server che memorizza le chiavi applicherà ciascuna operazione una sola volta; ciò che si può notare è la stessa scrittura inviata da due schede diverse.

## Utenti

Il database locale e l'outbox sono partizionati per ciascun utente autenticato. Le righe memorizzate nella cache sono quelle che la row-level security ha consentito a quell'utente di visualizzare, e una scrittura in coda deve essere rieseguita a nome del suo autore: pertanto, disconnettersi ed effettuare l'accesso con un altro account non mescola mai i dati. La disconnessione non richiede alcuna cancellazione.

### Durante il ripristino della sessione

Finché il client non sa chi è autenticato, non può determinare quale database locale e quale outbox utilizzare, quindi le letture e le scritture offline rimangono in attesa. Questo corrisponde al tempo richiesto da `auth.isInitialized()`: nullo per una sessione memorizzata ancora valida, e pari a una richiesta di refresh quando la sessione deve essere recuperata dal server (in modalità cookie, in cui nulla viene memorizzato sul dispositivo, ciò avviene a ogni caricamento della pagina). Una scrittura effettuata in tale intervallo viene accodata a nome dell'utente a cui la sessione risulterà appartenere, e una lettura risponde attingendo dal suo database locale. Un frame realtime che giunge nel frattempo viene inoltrato alla tua callback così come inviato dal server, senza essere memorizzato da nessuna parte.

Se la sessione non può essere ripristinata (il refresh viene rifiutato o, in modalità cookie, non riesce a raggiungere il server), il client passa allo stato non autenticato e le letture e le scritture offline vengono associate all'utente non autenticato.

### Scritture effettuate senza autenticazione

Le scritture accodate mentre nessun utente era autenticato non vengono rieseguite quando qualcuno effettua l'accesso. Quell'utente non le ha create e rieseguirle con le sue credenziali attribuirebbe le modifiche di una persona a un'altra (su un dispositivo condiviso, le scritture di un visitatore finirebbero nell'account dell'utente successivo). Non vengono nemmeno spostate nell'outbox dell'utente che ha effettuato l'accesso. Vengono invece conservate ed elencate separatamente, consentendo all'applicazione di decidere come gestirle:

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

`clear({ orphaned: true })` le elimina, insieme alle righe locali su cui erano state applicate; l'outbox dell'utente autenticato non viene toccato. Se l'app non intraprende alcuna azione, verranno rieseguite la volta successiva in cui nessun utente sarà autenticato. Quando nessun utente è connesso, esse costituiscono semplicemente l'outbox corrente e `pending({ orphaned: true })` non elenca nulla.

### Ricaricamenti offline in modalità cookie

In modalità cookie non viene memorizzato alcun dato sulla sessione sul dispositivo, pertanto un ricaricamento che non riesce a raggiungere il server non ha alcun utente associato. Per impostazione predefinita viene trattato come non autenticato: le righe locali dell'utente vengono nascoste e le scritture effettuate in quel momento vengono accodate come appartenenti all'utente non autenticato.

`keepLastUser: true` cambia questo comportamento. Il client ricorda l'ultimo utente che ha effettuato l'accesso sul dispositivo (solo il suo ID) e un ricaricamento offline apre invece il database locale di quell'utente. Le scritture effettuate in tale stato vengono accodate a suo nome, ma nessuna viene rieseguita finché la sessione non è confermata: quando la connessione viene ripristinata, il client aggiorna la sessione e anche un nuovo accesso la conferma. Se il server rifiuta la sessione, o se qualcun altro effettua l'accesso, il dispositivo cambia utente e le scritture in coda rimangono associate al rispettivo autore finché questi non effettua nuovamente l'accesso. Nel frattempo `status().unverifiedUser` è `true`, e questo vale anche online: fino alla risposta del refresh, le scritture vengono accodate anziché essere inviate senza credenziali, e le letture ricevono risposta dalle righe locali dell'utente. Ciò che il server restituisce a una richiesta priva di sessione è quanto un chiamante non autenticato può visualizzare, pertanto non viene conservato.

```typescript
createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" },
    offline: { keepLastUser: true }
});
```

È disattivato per impostazione predefinita perché su un dispositivo condiviso consente la lettura offline delle righe in cache dell'utente precedente senza una sessione attiva. Attivalo per le installazioni appartenenti a una sola persona. L'ID viene dimenticato al momento della disconnessione e quando il server rifiuta la sessione. Non viene mai utilizzato quando il server risponde indicando che non vi è alcuna sessione.

## Configurazione

<span class="since-badge" data-since="0.31">Da 0.31</span> `maxCachedRowsPerTable` e `maxCachedQueriesPerTable` erano precedentemente `…PerCollection`.

```typescript
createRebaseClient({
    baseUrl: API_URL,
    offline: {
        store: myCustomStore,                 // default: IndexedDB in the browser, memory elsewhere
        maxCachedRowsPerTable: 5000,          // rows with unsent writes are never evicted
        maxCachedQueriesPerTable: 50,         // remembered server page compositions
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

Qualsiasi ambiente può persistere il database locale implementando `OfflineStore`: una superficie chiave/valore con namespace dotata di un'area cache di lettura e di un'area di coda. Ecco come supportarla con AsyncStorage in React Native o con il file system in Electron:

```typescript no-verify
import type { OfflineStore } from "@rebasepro/client";

class AsyncStorageOfflineStore implements OfflineStore {
    // Read cache: getCache, setCache, setCacheMany, deleteCache,
    //             listCache, listCacheEntries
    // Outbox:     enqueue, dequeue, listQueue
    // Both:       clear
}
```

L'unico vincolo oltre a quelli ovvi è che gli elenchi con prefisso vengano restituiti in ordine lessicografico delle chiavi: è questo che rende l'outbox una FIFO.

## Limitazioni

Il client non è una replica del tuo database e non pretende di esserlo:

- **Solo le righe lette o scritte dall'app sono presenti localmente.** Una query che il client non ha mai inviato può comunque ricevere risposta da ciò che è presente in locale, ma la risposta potrebbe non includere righe che il server avrebbe restituito. I risultati live lo segnalano tramite `partial`.
- **`findAll()` e `iterate()` leggono solo le pagine che il server ha restituito su questo dispositivo.** L'iterazione prosegue finché ogni pagina indica che ce ne sono altre, e solo il server può determinarlo. Offline, un'iterazione che necessita di una pagina mai recuperata da questo dispositivo fallisce con l'errore `OFFLINE` (`isOfflineError`) anziché restituire una parte della tabella come se fosse completa.
- **`count()` offline necessita di un conteggio fornito dal server a questo dispositivo per la stessa query.** Le scritture accodate da quel momento in poi lo modificano: creazioni, modifiche che includono o escludono una riga dal filtro ed eliminazioni. Senza di esso, l'operazione fallisce con l'errore `OFFLINE` anziché limitarsi a contare le righe presenti per caso sul dispositivo.
- **`searchString` è approssimato** come una ricerca di sottostringhe case-insensitive sui campi di testo in cache. Il server esegue una vera ricerca full-text sulle colonne configurate della tabella.
- **Le relazioni in `include` non possono essere valutate localmente**: le righe correlate risiedono in tabelle mai caricate dalla query. Una query di questo tipo viene sempre contrassegnata come `partial` quando la risposta proviene dalla cache.
- **I conflitti seguono la logica last-writer-wins, per singolo campo, a meno che non si passi `onConflict`.** Un'`update` rieseguita invia solo i campi modificati dall'utente e nient'altro, quindi i campi non toccati mantengono qualsiasi valore presente sul server. Per un campo effettivamente modificato, un cambiamento apportato da qualcun altro sul server mentre l'utente era offline viene sovrascritto al momento della riesecuzione della coda, senza alcuna notifica a nessuno dei due utenti. Con [`onConflict`](#conflitti), una modifica di cui è nota la versione della riga viene confrontata con quella del server e l'app decide come procedere. Creazioni, eliminazioni e scritture massive non vengono mai verificate.
- **La riesecuzione è at-least-once.** Una scrittura che raggiunge il server ma la cui risposta va persa potrebbe essere inviata nuovamente. Preferisci scritture idempotenti (`createMany` con `upsert`) nei casi in cui i duplicati rappresenterebbero un problema.
- **Il cestino necessita del server.** Il database locale contiene solo righe attive, pertanto `trash.find()`, `trash.count()`, `trash.restore()` e `trash.purge()` (vedi [soft delete](/docs/collections/soft-delete#from-the-sdk)) non ricevono mai risposta localmente né vengono accodati: offline falliscono con l'errore `OFFLINE`. Il ripristino o l'eliminazione definitiva (purge) di una riga con una scrittura ancora in coda sincronizza prima la coda e viene rifiutata con `TRASH_PENDING_WRITE` se la scrittura non può ancora essere inviata.
- **Un upsert su una chiave naturale necessita del server.** Individuare a quale riga corrisponda la destinazione di `onConflict` spetta al server, pertanto `upsert()` su una chiave naturale (o senza l'ID della riga) e un `createMany()` con `onConflict` mai inviato vengono rifiutati offline con `OFFLINE_UPSERT_UNSUPPORTED`. Un upsert sulla chiave primaria, con la chiave specificata in ogni riga, viene invece accodato.
- **Le letture locali applicano la semantica di Postgres, non i dati del database.** I filtri vengono valutati come farebbe SQL: i confronti con `NULL` risultano sconosciuti (unknown), `ORDER BY` posiziona i valori nulli per ultimi in ordine crescente e risolve le parità rimanenti in base all'ID riga in ordine decrescente, esattamente come fa il server, ma sulla copia locale delle righe del client, che potrebbe non essere aggiornata.
- **Un ordinamento che il client non può riprodurre non viene applicato.** L'ordinamento del testo spetta al server: PostgreSQL lo ordina secondo la collation del *database*, di cui questo processo non è a conoscenza, e con la collation C `Banana` viene posizionato prima di `apple`, a differenza di quanto stabilirebbe un collator JavaScript. Quando una colonna di ordinamento non può essere confrontata numericamente, le righe mantengono l'ordine inviato dal server e il risultato viene contrassegnato come `partial` anziché essere presentato come la pagina ordinata richiesta. Ogni chiave di un ordinamento su più colonne deve essere riproducibile, non solo la prima: un ordinamento con cui il client può concordare solo fino alla seconda colonna è considerato non riproducibile.

## Esempio pratico: un indicatore offline

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

- [Interrogazione dei dati](/docs/sdk/querying) — la superficie di query che `observe()` condivide con `find()`
- [Sottoscrizioni realtime](/docs/sdk/realtime) — aggiornamenti inviati dal server (push), su cui si basano le live query
