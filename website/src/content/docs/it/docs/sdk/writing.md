---
sourceHash: dc2857e881f65bd3
title: Scrittura dei dati
sidebar_label: Scrittura dei dati
description: create, upsert, update e delete con l'SDK — operazioni sui campi, scritture condizionali, chiavi di idempotenza, scritture batch e scrittura tra tabelle in un'unica transazione.
---

Le letture sono descritte in [Querying data](/docs/sdk/querying/). Questa pagina rappresenta l'altra metà:
tutto ciò che modifica una riga.

Ogni metodo descritto qui attraversa la stessa pipeline di una scrittura proveniente da qualsiasi altra parte — [hook](/docs/collections/callbacks/),
[relazioni](/docs/collections/relations/) e
[sicurezza a livello di riga](/docs/collections/security-rules/) continuano a essere applicati. Nessuno di
essi rappresenta una scorciatoia per aggirare le tue regole; ciò che queste opzioni offrono è un round trip, una
transazione o una race condition che non dovrai più perdere.

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

Inserisce la riga, oppure aggiorna quella che ne occupa già la chiave:

```typescript
await client.data.products.upsert(
    { sku: "LAMP-01", name: "Desk lamp", price: 39 },
    { onConflict: ["sku"] }
);
```

Il server decide quale operazione eseguire all'interno di una singola transazione e ricorre a
`INSERT … ON CONFLICT DO UPDATE`. Pertanto, a differenza di un `findById` seguito da
`create` o `update`, non può perdere la race condition tra i due e, a differenza di
`create`, non fallisce quando la riga è già presente.

Quando la riga è presente, l'upsert è un aggiornamento della stessa. I campi inviati vengono
scritti e quelli tralasciati mantengono i valori memorizzati — non vengono reimpostati
al loro `defaultValue`. `beforeSave` e `afterSave` ricevono `status: "existing"`
con i valori precedenti e la cronologia registra un aggiornamento. Una chiave che identifica una riga
al di fuori dell'ambito `beforeQuery` del chiamante genera un errore 404.

`onConflict` ha come valore predefinito la chiave primaria, che è la destinazione errata per la maggior parte
delle scritture per cui si ricorre all'upsert: se basata su un ID seriale si tratterebbe di un semplice
inserimento, poiché il chiamante non conosce l'ID — di conseguenza un'importazione rieseguibile
duplicherebbe ogni riga alla seconda esecuzione. Indica invece la chiave naturale. Essa deve
garantire l'univocità su cui il database può fare riscontro — `validation: { unique:
true }` sulla proprietà, o le colonne di un [indice](/docs/backend/indexes/) `unique: true` —
e qualsiasi altra cosa restituirà un errore 400 che elenca le destinazioni valide esistenti,
anziché un errore sollevato dall'interno di una transazione.

Il timestamp `on_create` e il creatore `user_on_create` di una riga già
esistente non vengono toccati: un conflitto significa che la sua creazione è un fatto avvenuto nel passato.

#### Mantenere la riga memorizzata: `where` e `ignoreDuplicates`

`where` sostituisce la riga memorizzata solo quando c'è una corrispondenza — un filtro sulle
colonne della riga memorizzata, scritto come si scriverebbe per `find()`. `ignoreDuplicates` non la
sostituisce mai. In entrambi i casi la chiamata restituisce `undefined` quando la riga memorizzata viene
lasciata invariata, e il controllo è proprio dell'istruzione SQL (`ON CONFLICT … DO UPDATE
… WHERE`, `ON CONFLICT DO NOTHING`), quindi nessun'altra scrittura può inserirsi tra una lettura
e la decisione:

```typescript
// Keep the best score of the day: written only when it beats the stored one.
const kept = await client.data.scores.upsert(
    { day, player, score },
    { where: { score: ["<", score] } }
);

// Claim a slot once; a second claim changes nothing.
const claim = await client.data.claims.upsert({ slot, owner }, { ignoreDuplicates: true });
if (!claim) throw new Error("taken");
```

`createMany(rows, { upsert: true, where })` e `{ upsert: true, ignoreDuplicates: true }`
fanno lo stesso per riga e restituiscono solo le righe che hanno scritto. Entrambi richiedono `upsert`, e
le due opzioni non possono essere combinate (`INVALID_CONFLICT_RULE`).

#### Non sulla tabella di autenticazione

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

`upsert()` sulla tabella di autenticazione (quella dichiarata con `defineAuthTable`) viene rifiutato
con un 400 (`INVALID_CONFLICT_TARGET`), così come `createMany` con `upsert`
su di essa. La creazione di un utente e la sua modifica seguono regole diverse — una creazione
esegue l'hashing della password e invia l'invito, un aggiornamento non può revocare l'ultimo
amministratore — e un upsert scopre di quale delle due si tratti solo all'interno della scrittura. Chiama
invece `create` o `update`.

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
| `$inc` | `number` | aggiunge (negativo per sottrarre) |
| `$push` | `array` | accoda un valore, o ciascun elemento di un array di valori |
| `$pull` | `array` | rimuove ogni occorrenza di un valore |
| `$merge` | `map` | esegue un merge superficiale (shallow-merge) di un oggetto |

Il motivo per utilizzarle è la lettura che non è più necessario effettuare, e la race condition che
tale lettura aprirebbe. `views = current + 1` implica prima il recupero di `current`, e due
richieste che leggono entrambe `4` scriveranno entrambe `5` — un incremento va perso e nessuna delle
due risposte lo segnala. Compilata all'interno dell'istruzione, l'aritmetica viene eseguita all'interno del
blocco (row lock) della riga.

Esattamente un operatore per campo, e solo in un aggiornamento: su una riga che non
esiste ancora non c'è nulla su cui operare, quindi un'operazione in un `create`,
`createMany` o `upsert` genera un errore 400. Un operatore applicato al tipo di proprietà sbagliato, o un
`$operator` scritto male, restituisce un errore 400 che specifica il campo — mai un documento JSON
scritto nella colonna.

Un'operazione rispetta la `validation` della proprietà esattamente come un valore normale, e ciò
include il valore che produce. `{ stock: { $inc: -1 } }` su un campo `stock` con
`validation: { min: 0 }` ha successo finché lo stock è almeno 1 e viene rifiutata a 0 con lo stesso
errore 400 (`VALIDATION_CONSTRAINT`) restituito da `{ stock: -1 }`. Lo stesso vale per `max`,
`moreThan`, `lessThan`, `positive` e `negative`, e per gli elementi `min` e `max` di un array dopo
un `$push` o `$pull`. La verifica fa parte dell'istruzione di aggiornamento, quindi due decrementi concorrenti
di uno stock pari a 1 non possono riuscire entrambi, e un aggiornamento rifiutato non scrive nulla.

In modalità offline vengono rifiutate anziché accodate: un'operazione viene valutata
rispetto a un valore memorizzato di cui il dispositivo non possiede una copia aggiornata, e una riga
ottimistica potrebbe mostrare solo il marcatore stesso fino allo svuotamento della coda.

### Delete

```typescript
await client.data.products.delete(42);
```

Su una tabella con [soft delete](/docs/collections/soft-delete), questa operazione contrassegna la
riga invece di rimuoverla. `client.data.products.trash` elenca, conta, ripristina
ed elimina definitivamente le righe contrassegnate.

### Scritture condizionali

`update` e `delete` accettano un `ifMatch`, consentendo di rifiutare la scrittura se la riga
è cambiata da quando l'hai letta:

```typescript
import { etagOf } from "@rebasepro/client";

const post = await client.data.posts.get(1);
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(post) });
// → RebaseApiError, status 412, if somebody edited it in between
```

Senza di esso, il pattern lettura-modifica-scrittura segue la logica "last-writer-wins" su tutto ciò che non
hai inviato: due editor a un secondo di distanza hanno entrambi successo, e la modifica del primo scompare
senza alcun errore.

`etagOf(row)` legge la versione da una riga restituita da `findById`/`get`. Risiede
su una chiave non enumerabile, quindi non entra mai nel tipo `Row` generato, in un
`JSON.stringify`, o in uno spread all'interno del body di aggiornamento successivo. È `undefined` per una
riga proveniente da `find()`, dalla cache offline, o da un server che non invia alcun
`ETag` — e passare `undefined` non invia alcuna precondizione, degradando la chiamata sopra
a un normale aggiornamento anziché sollevare un'eccezione.

Una riga restituita da `update()` contiene la versione prodotta da tale scrittura, consentendo
di concatenare modifiche condizionali senza una lettura intermedia. Una riga ricevuta da un callback
di `listenById()` contiene la versione mostrata da quel frame:

```typescript
import { etagOf } from "@rebasepro/client";

let shown: Record<string, unknown> | undefined;
client.data.posts.listenById(1, (post) => {
    shown = post; // etagOf(shown) is the version this frame shows
});

// On save: refused with 412 if the row has moved on since that frame
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(shown) });
```

Da un browser su un'altra origine — un frontend Vite sulla propria porta, un host `app.`
che chiama un host `api.` — l'`ETag` è leggibile solo se il server lo include
in `Access-Control-Expose-Headers`. Il runtime di Rebase lo fa, insieme a
`Retry-After`, `X-Request-ID`, agli header `X-RateLimit-*` e a `Preference-Applied`.
Un backend che configura il proprio `cors()` deve esporre la stessa lista, altrimenti `etagOf`
sarà sempre `undefined` in quel contesto e ogni scrittura condizionale verrà inviata come non condizionale.

### Omettere la risposta

Ogni scrittura restituisce la riga che ha scritto. Passa `{ returning: false }` quando
non ne hai bisogno:

```typescript
await client.data.events.create({ kind: "page_view" }, undefined, { returning: false });
```

Questo invia l'header `Prefer: return=minimal`; il server risponde con `204` per una scrittura singola
e solo con gli ID per un batch. Il metodo quindi restituisce `undefined` (o `[]`),
evitando che si possa usare accidentalmente una riga che il server non ha mai inviato. È utile per importazioni
e scritture di tipo fire-and-forget — il comportamento predefinito restituisce la riga perché contiene ciò che il
*server* ha stabilito.

## Scritture batch

Tre operazioni scrivono molte righe in una **singola richiesta e una singola
transazione**. Ogni riga esegue comunque la normale pipeline — hook, relazioni,
sicurezza a livello di riga — quindi un batch non è una scorciatoia per aggirare le tue regole; il vantaggio
è ottenere un solo round trip e una sola transazione invece di N per ciascuno.

Tutte e tre seguono la logica **tutto o niente**. Se una qualsiasi riga viene rifiutata, nessuna viene applicata
e l'errore indica l'indice incriminato.

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

### Quante istruzioni compongono un batch

Su una tabella senza hook `beforeSave`, `afterSave` o `afterSaveError`,
senza `history` e senza `tenant`, un batch è composto da una manciata di istruzioni anziché
una per riga: `createMany` invia istruzioni `INSERT … RETURNING` multi-riga (con
`upsert`, `INSERT … ON CONFLICT … DO UPDATE`), e `updateMany` invia un'istruzione
`UPDATE … FROM (VALUES …) RETURNING` per ciascun gruppo di elementi che impostano gli stessi
campi. I valori predefiniti dichiarati, i timestamp `.onCreateNow()` / `.onUpdateNow()`, `afterRead` e gli eventi realtime
si applicano a ogni riga come avverrebbe singolarmente. Se il database rifiuta il
batch, questo viene annullato e rieseguito riga per riga affinché l'errore indichi comunque la voce
che ha fallito. Una tabella che dichiara uno di questi hook mantiene la pipeline riga per riga,
poiché ciascun hook viene eseguito una volta per riga tra le scritture di quella riga.

Allo stesso modo, un singolo `update` non legge nulla quando nulla richiede la riga memorizzata:
l'istruzione `UPDATE … RETURNING` funge sia da 404 per una riga mancante sia da riga con cui
risponde. Anche un `delete` che non deve gestire hook, cronologia o cestino non effettua
alcuna lettura.

### Quanti round trip richiede una scrittura

Una scrittura su una tabella di questo tipo richiede un solo round trip verso il database: il
`BEGIN` della transazione, l'identità del chiamante, l'istruzione e il `COMMIT` viaggiano
in un unico batch. Ciò vale per `create`, `update`, `upsert`, `delete`,
`updateWhere`, `deleteWhere` e per un `createMany` eseguiti congiuntamente. Un'istruzione
rifiutata dal database salta il `COMMIT` successivo, e la scrittura esegue il rollback come
per qualsiasi operazione non riuscita. Una scrittura che esegue un hook o registra la cronologia invia il
proprio `COMMIT` dopo di essi, in un secondo round trip.

### Perché `{ id, data }` anziché righe piatte

`createMany` accetta righe piatte perché una riga in fase di creazione *è* l'insieme delle sue colonne.
`updateMany` specifica l'indirizzo separatamente poiché, su una tabella la cui chiave è diversa
da `id` — uno `sku`, una chiave composita — una riga piatta non può determinare se
una colonna rappresenti l'indirizzo o un valore da scrivere. Questo rispecchia esattamente
la firma di `update(id, data)` a riga singola.

## Scrittura tramite filtro

`updateWhere` e `deleteWhere` modificano ogni riga che corrisponde a un filtro, in un'unica
istruzione — `UPDATE … WHERE … RETURNING` e `DELETE … WHERE`. Il filtro è composto dai parametri
`where` e `logical` accettati da `find()`:

```typescript
// Every expired session, gone; resolves to how many.
const removed = await client.data.sessions.deleteWhere({ where: { expiresAt: ["<", cutoff] } });

// Field operations work as on update(); resolves to the rows updated.
const bumped = await client.data.songs.updateWhere(
    { where: { "lower(artist)": ["in", ["abba", "queen"]] } },
    { plays: { $inc: 1 } }
);
```

Un filtro che non produce alcuna corrispondenza non è un errore — restituisce `[]` o `0` — il che rende
`deleteWhere` l'eliminazione ideale per una riga che potrebbe essere già stata rimossa, dove `delete`
risponderebbe con 404. E poiché l'istruzione che scrive è la stessa che controlla il
filtro, si tratta di un'operazione atomica compare-and-set:

```typescript
// Save only over the revision this client read; [] means somebody else saved first.
const [saved] = await client.data.saves.updateWhere(
    { where: { player: ["==", player], rev: ["==", rev] } },
    { body, rev: { $inc: 1 } }
);
```

Un filtro senza alcuna condizione viene rifiutato con `FILTER_REQUIRED` anziché essere eseguito —
poiché modificherebbe ogni riga — e un campo che non corrisponde a una colonna viene rifiutato come avverrebbe
in lettura, senza mai essere ignorato. Un aggiornamento filtrato non può modificare una colonna chiave.

Su una tabella le cui scritture eseguono operazioni per singola riga — un hook di salvataggio o eliminazione,
cronologia, multi-tenancy, un `beforeQuery`, soft delete, autorizzazioni a livello di campo — le righe corrispondenti
vengono lette nell'ambito del chiamante e scritte una per una attraverso l'intera
pipeline, in un'unica transazione. Su HTTP queste corrispondono alle route bulk con un filtro
al posto degli ID: `PATCH /api/data/<slug>/bulk` con `{ where, logical, data }`
e `POST /api/data/<slug>/bulk/delete` con `{ where, logical }`. Non sono
disponibili sulla tabella di autenticazione, i cui aggiornamenti ed eliminazioni sono verificati utente
per utente (`FILTERED_USER_WRITE`); specifica gli utenti con `updateMany`/`deleteMany`.

### Retry e duplicati

Un client che non riceve mai la risposta non può sapere se il batch è stato confermato,
quindi riprova — e senza una chiave il server non può distinguere quel tentativo da
un secondo batch autentico. Passa una chiave di idempotenza su qualsiasi operazione che potrebbe essere reinviata:

```typescript
const attemptKey = crypto.randomUUID();
await client.data.products.createMany(rows, { idempotencyKey: attemptKey });
```

Una chiave identifica una singola richiesta, non un job: viene registrata associata al metodo, al percorso
e al body con cui è stata inviata. Reinviare quell'esatta richiesta restituisce nuovamente la stessa risposta;
la stessa chiave associata a una richiesta diversa viene rifiutata con `IDEMPOTENCY_KEY_REUSED`
(422). Pertanto, generane una per ciascuna chiamata invece di riutilizzare un ID di business — un `importId`
condiviso dal `createMany` e dal `deleteMany` di una stessa importazione lascerebbe
l'eliminazione silenziosamente ineseguita.

Un nuovo tentativo che arriva mentre la risposta al primo è ancora in elaborazione riceve
`IDEMPOTENCY_KEY_IN_PROGRESS` (409): reinvialo e riceverà come risposta il
risultato del primo tentativo non appena completato. Le chiavi rimangono valide per 24 ore e
solo per un chiamante autenticato — altrimenti non esisterebbe alcun principal a cui associarle.

La coda offline imposta automaticamente una chiave a ogni ripetizione.

### Limiti

I batch hanno un limite massimo lato server (1000 righe per impostazione predefinita), poiché un batch mantiene
i suoi lock per l'intera durata della transazione. Il superamento genera un errore `BULK_TOO_LARGE` che
indica sia il limite sia il numero di righe inviate; pertanto, suddividi i dati in blocchi:

```typescript
for (const chunk of chunks(rows, 1000)) {
    await client.data.products.createMany(chunk, { upsert: true });
}
```

Una sorgente dati che non supporta le scritture atomiche restituisce `BULK_UNSUPPORTED` anziché
eseguire silenziosamente un ciclo di singole scritture — il che non offrirebbe né l'atomicità
né il singolo round trip per cui si era scelto di utilizzare un batch.

## Scrittura tra tabelle

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

`createMany` e metodi analoghi operano su una tabella alla volta. `client.batch()` è la
forma per lavorare tra tabelle diverse: una richiesta, una transazione, tutto o niente.

```typescript
const result = await client.batch([
    { op: "create", table: "orders",
      values: { total: 40 }, ref: "order" },
    { op: "create", table: "orderItems",
      values: { orderId: { $ref: "order.id" }, sku: "A-1" } },
    { op: "update", table: "stock",
      id: "A-1", values: { count: { $inc: -1 } } },
    { op: "delete", table: "carts", id: "c-9" }
]);

result.data;  // [ order, item, stock, null ] — aligned to the operations
result.meta;  // { operations: 4 }
```

`op` può essere `create`, `update`, `upsert` o `delete`, e `table` limita
`values` alla struttura tipizzata generata di `Insert` o `Update` di quella tabella — una colonna
che la tabella non possiede genera un errore di compilazione, così come una creazione a cui manca un campo
obbligatorio. `table` è l'accessor, il nome assunto da `client.data.<accessor>`
(`orderItems` per lo slug `order_items`); il client invia lo slug,
attraverso il dizionario `tables` con cui è stato inizializzato. Ogni
operazione esegue la stessa pipeline della sua controparte a riga singola — la stessa
convalida, gli stessi hook e la stessa sicurezza a livello di riga, agendo con le autorizzazioni del medesimo utente.

### `$ref`

Un'operazione può assegnarsi un nome con `ref`; un'operazione successiva può inserire
`{ $ref: "<name>.<field>" }` ovunque sia previsto un valore, compreso un `id` e a
qualsiasi livello di annidamento all'interno di `values`. Tale riferimento si risolve nel campo corrispondente della riga
scritta dall'operazione specificata.

Questo è il motivo per cui il metodo esiste anziché ricorrere a un ciclo di `createMany`: la
foreign key del record figlio non esiste finché il record genitore non viene inserito, costringendo altrimenti
a inviare due richieste separate — e le richieste separate possono riuscire solo a metà. La logica di ripristino
per gestire questo scenario (rileggere i dati, verificare quale metà sia andata a buon fine, annullarla) è codice che nessuno
vorrebbe mai scrivere.

Solo i riferimenti all'indietro vengono risolti. Un riferimento in avanti viene rifiutato prima
dell'apertura della transazione, insieme a tabelle sconosciute, campi sconosciuti, operazioni sui campi non
consentite e destinazioni di conflitto non valide — poiché rilevare un errore all'operazione 40
comporterebbe altrimenti il rollback delle 39 scritture precedenti.

### Limiti e fallimenti

Si applica lo stesso limite di 1000 operazioni delle scritture bulk, per la medesima ragione: un batch
mantiene i suoi lock per l'intera durata della transazione. Un `update` o `delete` che fa riferimento a una riga
inesistente fa fallire l'intero batch con un errore 404. Un backend il cui driver non è in grado di garantire
l'atomicità risponde con `BATCH_UNSUPPORTED` anziché procedere con un ciclo.

`idempotencyKey` e `returning` funzionano esattamente come in qualsiasi altra scrittura.

Lato server, `rebase.dataAsAdmin.batch([...])` e `context.data.batch([...])`
accettano le stesse operazioni e restituiscono lo stesso risultato, all'interno della transazione del chiamante.
`batch` è una parola riservata in tale contesto, così come `table`: una tabella il cui
accessor è `batch` viene raggiunta con `data.table("batch")`.
