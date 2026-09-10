---
sourceHash: a31d37ab40b701e5
title: Scrittura dei dati
sidebar_label: Scrittura dei dati
description: create, upsert, update e delete con l'SDK — operazioni sui campi, scritture condizionali, chiavi di idempotenza, scritture batch e scrittura tra collezioni in una singola transazione.
---

Le operazioni di lettura si trovano in [Interrogazione dei dati](/docs/sdk/querying/). Questa pagina rappresenta l'altra metà:
tutto ciò che modifica una riga.

Ogni metodo qui descritto attraversa la stessa pipeline di una scrittura proveniente da qualsiasi altra parte — [callback](/docs/collections/callbacks/),
[relazioni](/docs/collections/relations/) e
[sicurezza a livello di riga](/docs/collections/security-rules/) continuano ad applicarsi. Niente di
tutto questo è una scorciatoia per aggirare le tue regole; ciò che queste opzioni ti fanno guadagnare è un round trip,
una transazione o una race condition che non devi più rischiare di perdere.

## Scritture a riga singola

### Create

```typescript
const newProduct = await client.data.products.create({
    name: "New Product",
    price: 29.99,
    active: true
});

// With a specific ID
const newProduct = await client.data.products.create(
    { name: "Custom ID Product" },
    "my-custom-id"
);
```

### Upsert

Inserisce la riga, oppure sostituisce quella che ne occupa già la chiave:

```typescript
await client.data.users.upsert(
    { email: "ada@example.com", name: "Ada" },
    { onConflict: ["email"] }
);
```

Si tratta di una singola istruzione lato server (`INSERT … ON CONFLICT DO UPDATE`), quindi, a differenza di un
`findById` seguito da `create` o `update`, non può perdere la race condition tra le
due operazioni e, a differenza di `create`, non fallisce se la riga esiste già.

`onConflict` è impostato di default sulla chiave primaria, che è il target errato per la maggior parte
delle scritture per cui si sceglie un upsert: basato su un ID seriale diventa un semplice
inserimento, poiché il chiamante non conosce l'ID — di conseguenza, un'importazione rieseguibile
duplicherebbe ogni riga alla seconda esecuzione. Specifica invece la chiave naturale. Essa deve
garantire l'unicità su cui il database può verificare la corrispondenza — `validation: { unique:
true }` sulla proprietà, oppure le colonne di un [indice](/docs/backend/indexes/)
`unique: true` — qualsiasi altra cosa restituirà un errore 400 con l'elenco dei target
effettivamente esistenti, anziché un errore generato dall'interno di una transazione.

Il timestamp `on_create` di una riga già esistente non viene toccato: un
conflitto indica che la sua creazione appartiene al passato.

### Update

```typescript
const updated = await client.data.products.update(42, {
    name: "Updated Name",
    price: 39.99
});
```

#### Operazioni sui campi

Un valore può invece essere un'operazione sul valore *memorizzato*:

```typescript
await client.data.posts.update(postId, {
    views: { $inc: 1 },
    tags:  { $push: "featured" },
    meta:  { $merge: { lastSeen: Date.now() } }
});
```

| Operatore | Tipo di proprietà | Significato |
|-----------|-------------------|-------------|
| `$inc` | `number` | aggiunge (valore negativo per sottrarre) |
| `$push` | `array` | accoda un valore, o ciascun elemento di un array di valori |
| `$pull` | `array` | rimuove ogni occorrenza di un valore |
| `$merge` | `map` | unisce un oggetto tramite shallow merge |

Il motivo per cui utilizzarle è la lettura che non si deve più effettuare e la race condition
che tale lettura aprirebbe. `views = current + 1` implica il dover recuperare prima `current`, e due
richieste che leggono entrambe `4` scriveranno entrambe `5` — un incremento va perduto e nessuna delle due
risposte lo segnala. Compilata all'interno dell'istruzione, l'operazione aritmetica avviene all'interno
del lock sulla riga.

È consentito esattamente un operatore per campo, e solo su un update: su una riga che non
esiste ancora non c'è nulla su cui operare, quindi un'operazione in un `create`,
`createMany` o `upsert` restituisce un errore 400. Un operatore applicato al tipo di proprietà errato, o un
`$operator` con errore di digitazione, restituisce un 400 che specifica il campo — mai un documento JSON
scritto all'interno della colonna.

In modalità offline vengono rifiutate anziché accodate: un'operazione viene valutata
rispetto a un valore memorizzato di cui il dispositivo non possiede una copia aggiornata, e una riga ottimistica
potrebbe mostrare solo il marcatore stesso finché la coda non viene smaltita.

### Delete

```typescript
await client.data.products.delete(42);
```

### Scritture condizionali

`update` e `delete` accettano un parametro `ifMatch`, in modo che la scrittura venga rifiutata se la riga è
cambiata rispetto a quando è stata letta:

```typescript
import { etagOf } from "@rebasepro/client";

const post = await client.data.posts.get(1);
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(post) });
// → RebaseApiError, status 412, if somebody edited it in between
```

Senza di esso, il pattern read-modify-write segue la logica per cui l'ultima scrittura sovrascrive
tutto ciò che non è stato inviato: due modifiche a distanza di un secondo hanno entrambe successo, e la modifica
della prima va perduta senza che venga segnalato alcun errore.

`etagOf(row)` legge la versione da una riga restituita da `findById`/`get`. Essa
risiede su una chiave non enumerabile, quindi non entra mai nel tipo `Row` generato, in un
`JSON.stringify` o in uno spread all'interno del corpo dell'update successivo. È `undefined` per una
riga proveniente da `find()`, dalla cache offline o da un server che non invia alcun
`ETag` — e passare `undefined` non invia alcuna precondizione, degradando la chiamata precedente
a un normale update invece di generare un errore.

### Omettere la risposta

Ogni scrittura si risolve restituendo la riga che ha scritto. Passa `{ returning: false }` quando
non ne hai bisogno:

```typescript
await client.data.events.create({ kind: "page_view" }, undefined, { returning: false });
```

Questo invia l'header `Prefer: return=minimal`; il server risponde con `204` per una singola scrittura
e solo con gli ID per un batch. Il metodo si risolve quindi in `undefined` (o `[]`),
evitando di utilizzare accidentalmente una riga che il server non ha mai inviato. È molto utile nelle importazioni
e nelle scritture fire-and-forget — il comportamento predefinito restituisce la riga perché riporta ciò che il
*server* ha determinato.

## Scritture batch

Tre operazioni permettono di scrivere più righe in una **singola richiesta e una singola
transazione**. Ogni riga attraversa comunque la normale pipeline — callback, relazioni,
sicurezza a livello di riga — quindi un batch non è una scorciatoia per aggirare le tue regole; il vantaggio
consiste in un solo round trip e una sola transazione invece di N per ciascuno.

Tutte e tre sono di tipo **tutto o niente** (all-or-nothing). Se una qualsiasi riga viene rifiutata, nessuna di esse
viene applicata e l'errore indica l'indice incriminato.

```typescript
// Create
await client.data.products.createMany([
    { name: "Widget", price: 9.99 },
    { name: "Gadget", price: 19.99 }
]);

// Update — each entry names its row and the fields to change
await client.data.orders.updateMany([
    { id: "o-1", data: { status: "shipped" } },
    { id: "o-2", data: { status: "shipped" } }
]);

// Delete — by id
await client.data.sessions.deleteMany(["s-1", "s-2"]);
```

### Perché `{ id, data }` anziché righe piatte

`createMany` accetta righe piatte perché una riga in fase di creazione *è* l'insieme delle sue colonne.
`updateMany` indica l'indirizzo separatamente, poiché in una tabella con una chiave diversa
da `id` — uno `sku`, una chiave composita — una riga piatta non può stabilire se una
colonna rappresenti l'indirizzo o un valore da scrivere. Questo rispecchia esattamente
la firma a riga singola `update(id, data)`.

### Perché `deleteMany` accetta ID e non un filtro

Un'eliminazione massiva basata su un filtro è un'operazione diversa e molto più pericolosa: il
rischio d'errore tipico è una condizione omessa o digitata male che svuota un'intera tabella, e non
può essere verificata a livello di chiamata nel modo in cui lo permette un elenco esplicito. Esegui prima una lettura, poi passa
gli ID desiderati:

```typescript
const stale = await client.data.sessions.findAll({
    where: { expiresAt: ["<", cutoff] }
});
await client.data.sessions.deleteMany(stale.map(s => s.id as string));
```

### Tentativi di ripetizione e duplicati

Un client che non riceve la risposta non può sapere se il batch sia stato confermato (committed),
quindi tenta nuovamente — e senza una chiave il server non può distinguere quel tentativo da
un secondo batch effettivo. Passa una chiave di idempotenza per qualsiasi richiesta che potrebbe essere reinviata:

```typescript
const attemptKey = crypto.randomUUID();
await client.data.products.createMany(rows, { idempotencyKey: attemptKey });
```

Una chiave identifica una singola richiesta, non un job: viene registrata insieme al metodo, al percorso
e al corpo con cui è stata inviata. Reinviare esattamente quella richiesta ne riproduce la risposta;
la stessa chiave su una richiesta diversa viene rifiutata con `IDEMPOTENCY_KEY_REUSED`
(422). Generane quindi una per ogni chiamata anziché riutilizzare un ID di business — un `importId`
condiviso tra il `createMany` e il `deleteMany` di una stessa importazione lascerebbe
l'eliminazione silenziosamente non eseguita.

Un tentativo di ripetizione che arriva mentre il primo tentativo è ancora in fase di elaborazione riceve
`IDEMPOTENCY_KEY_IN_PROGRESS` (409): invialo di nuovo e riceverà come risposta il risultato
del primo tentativo non appena completato. Le chiavi sono valide per 24 ore e
solo per un chiamante autenticato — altrimenti non esisterebbe alcun principal a cui associarle.

La coda offline imposta automaticamente una chiave a ogni ripetizione.

### Limiti

I batch hanno un limite massimo lato server (1000 righe per impostazione predefinita), poiché un batch trattiene
i propri lock per l'intera durata della transazione. Il superamento genera un errore `BULK_TOO_LARGE` che
indica sia il limite sia il numero di righe inviate; suddividi quindi le chiamate in blocchi:

```typescript
for (const chunk of chunks(rows, 1000)) {
    await client.data.products.createMany(chunk, { upsert: true });
}
```

Una sorgente di dati che non è in grado di scrivere in modo atomico segnala `BULK_UNSUPPORTED` anziché
eseguire silenziosamente un ciclo di scritture singole — il che non garantirebbe né l'atomicità
né il singolo round trip per cui si è scelto di usare un batch.

## Scrittura tra collezioni

`createMany` e i metodi affini operano su una sola collezione alla volta. `client.batch()` è la variante
per più collezioni: una sola richiesta, una sola transazione, tutto o niente.

```typescript
const result = await client.batch([
    { op: "create", collection: "orders",
      values: { total: 40 }, ref: "order" },
    { op: "create", collection: "order_items",
      values: { order_id: { $ref: "order.id" }, sku: "A-1" } },
    { op: "update", collection: "stock",
      id: "A-1", values: { count: { $inc: -1 } } },
    { op: "delete", collection: "carts", id: "c-9" }
]);

result.data;  // [ order, item, stock, null ] — aligned to the operations
result.meta;  // { operations: 4 }
```

`op` può essere `create`, `update`, `upsert` o `delete`, e `collection` restringe
`values` alla struttura tipizzata generata di `Insert` o `Update` di quella collezione. Ogni
operazione esegue la pipeline della sua equivalente a riga singola — la stessa
validazione, callback e sicurezza a livello di riga, con lo stesso utente.

### `$ref`

Un'operazione può assegnarsi un nome con `ref`; un'operazione successiva può inserire
`{ $ref: "<name>.<field>" }` ovunque sia ammesso un valore, anche come `id` e a
qualsiasi livello di annidamento all'interno di `values`. Si risolve in quel campo della riga scritta
dall'operazione indicata.

È questo il motivo per cui il metodo esiste anziché ricorrere a un ciclo su `createMany`: la
chiave esterna dell'elemento figlio non esiste finché l'elemento genitore non viene inserito, quindi le due operazioni
dovrebbero essere richieste separate — e richieste separate possono riuscire a metà. Il ripristino
da tale situazione (rileggere, determinare quale metà sia stata applicata, annullarla) è codice che nessuno
vuole scrivere.

Vengono risolti soltanto i riferimenti all'indietro. Un riferimento in avanti viene rifiutato prima che
la transazione si apra, insieme a collezioni sconosciute, campi sconosciuti, operazioni illegali
sui campi e target di conflitto non validi — poiché rilevare un errore all'operazione 40
comporterebbe altrimenti il rollback delle 39 scritture precedenti.

### Limiti e fallimenti

Si applica lo stesso limite di 1000 operazioni delle scritture bulk, per la medesima ragione: un batch
trattiene i propri lock per l'intera durata della transazione. Un `update` o `delete` che fa riferimento a una riga
inesistente fa fallire l'intero batch con un 404. Un backend il cui driver
non può garantire l'atomicità risponde con `BATCH_UNSUPPORTED` anziché iterare in loop.

`idempotencyKey` e `returning` funzionano esattamente come per qualsiasi altra operazione di scrittura.

---
