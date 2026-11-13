---
sourceHash: b1b5ef4227e130d2
title: Scrittura tramite REST
sidebar_label: Scrittura tramite REST
description: Chiavi di idempotenza, scritture condizionali con ETag e If-Match, operazioni sui campi, upsert su chiave naturale, return=minimal e batch cross-tabella.
---

I verbi si trovano nella pagina [REST API](/docs/backend/api/). Questa pagina riguarda le
cinque cose che una scrittura può *richiedere* oltre al suo verbo, e l'endpoint che scrive
su più tabelle contemporaneamente. Ognuna di esse è attivabile per singola richiesta (opt-in): una scrittura che
non richiede nulla di tutto questo si comporta esattamente come ha sempre fatto.

## Scrittura

Oltre ai verbi, le rotte di scrittura accettano cinque elementi che modificano il comportamento
di una scrittura. Tutti e cinque sono opt-in per richiesta, quindi nulla di quanto descritto qui modifica
il comportamento di una richiesta che non li richiede. Le rotte annidate
(`/api/data/authors/42/posts`) eseguono lo stesso codice di scrittura di quelle radice, quindi
tutto ciò che si trova in questa sezione si applica anche ad esse, ad eccezione di `?on_conflict=`.

Il corpo di una scrittura deve essere un oggetto JSON. `null`, un numero, una stringa o un array
restituiscono un errore `400 BAD_REQUEST`.

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span> Una scrittura accetta i valori documentati dall'API REST e nient'altro — la
stessa forma restituita da una lettura: una relazione to-one (`belongsTo`, `hasOne`, una to-one
`via`) come chiave della riga correlata o `null`, una relazione to-many come elenco di chiavi
o oggetti `{ id, _pivot? }`, una data come testo ISO, un vettore come elenco di numeri,
un geopoint come `{ latitude, longitude }`, un `bytea` come
URL `data:application/octet-stream;base64,`. Una relazione to-one scritta come
oggetto (`{ "author": { "id": 5 } }`) genera un `400 VALIDATION_INVALID_VALUE`
("'posts.author' links one 'authors' row: write that row's key …"), così come un
vettore scritto come `{ "value": [...] }`. Nel processo, `rebase.data` accetta anche un
`Date` e un `Buffer` / `Uint8Array`.

La scrittura di una relazione `hasMany` o `hasOne` dal genitore (`{ "replies": [1, 2] }`
su un thread) imposta la foreign key sulle righe figlie, quindi è soggetta alle
regole di tale chiave: una colonna chiave contrassegnata come `.readOnly()`, `.private()` o limitata da
`access.write` la rifiuta (`400 VALIDATION_EXCLUDED_FIELDS` /
`FIELD_NOT_WRITABLE`, "Writing 'replies' on 'threads' sets 'threadId' on the
rows of 'replies'"), esattamente come farebbe una scrittura della chiave sul figlio.

Un aggiornamento non può modificare la chiave di una riga. Un corpo che specifica la chiave con un altro
valore genera un `400 KEY_IMMUTABLE`, prima dell'esecuzione di qualsiasi hook e senza scrivere nulla,
indipendentemente dalla modalità di arrivo dell'aggiornamento: REST, socket realtime, MCP o
`rebase.data` in-process. La chiave già posseduta dalla riga viene accettata, come avviene quando un form
invia nuovamente l'intera riga. Per spostare una riga su una nuova chiave, crearla
nella nuova posizione ed eliminare quella vecchia.

### Idempotenza

`Idempotency-Key: <uuid>` su qualsiasi scrittura significa "se hai già risposto a questa
identica richiesta, rispondi di nuovo invece di eseguirla due volte".

```bash
curl -X POST /api/data/orders \
     -H "Idempotency-Key: 1f0f…" \
     -d '{"total": 40}'
```

Un client che non riceve mai una risposta non può sapere se la scrittura è stata confermata (committed), quindi
ritenta — e senza una chiave il server non può distinguere quel tentativo da una seconda
scrittura autentica. Su una tabella con un id assegnato dal server, questo genera una riga duplicata,
perché l'id inventato dal client non è mai stato utilizzato.

Una chiave identifica **una sola richiesta**: registra il metodo, il percorso, la query string
e il corpo per cui è stata richiesta. Inviando nuovamente esattamente quella richiesta, la sua risposta verrà riproposta (replayed); inviandone una
diversa con la stessa chiave, questa verrà rifiutata con `IDEMPOTENCY_KEY_REUSED`
(422) anziché rispondere con il risultato della prima. Un nuovo tentativo che arriva
mentre la prima richiesta è ancora in elaborazione (in flight) riceve `IDEMPOTENCY_KEY_IN_PROGRESS` (409) —
invialo di nuovo quando la prima è andata a buon fine. La query string conta perché
modifica l'azione svolta da una richiesta: `DELETE /api/data/posts/5?hard=true` sotto la chiave di un
precedente soft delete è una richiesta diversa, non una replica. L'ordine dei suoi
parametri non ha importanza.

Supportata su `POST`, `PATCH`, `DELETE`, su tutte e tre le rotte `/bulk` e su `/_batch`.
Le chiavi durano 24 ore e sono limitate all'ambito (scoped) del chiamante autenticato; un'istanza
non autenticata non ha un'identità (principal) a cui associarla, quindi l'header viene
ignorato. Un backend che non può memorizzare le chiavi ignora l'header invece di
rifiutare la scrittura.

`DELETE` è il caso che merita particolare attenzione. Ripetuto senza una chiave, il secondo
tentativo rileva che la riga non c'è più e risponde `404` — che un client in fase di retry interpreta come
un fallimento definitivo per un'eliminazione che in realtà è andata a buon fine. Con una chiave, viene invece riproposto
il `204`.

### Concorrenza ottimistica: `ETag` e `If-Match`

`GET /api/data/:slug/:id` restituisce un `ETag`, e lo stesso fa la `GET` annidata
per singola riga. Reinviandolo come `If-Match` su una successiva `PATCH` o `DELETE`, la scrittura viene
rifiutata con `412` se la riga è stata modificata nel frattempo.

Una `PATCH` eseguita con successo risponde con l'`ETag` della versione scritta,
quindi la successiva scrittura condizionale non richiede una lettura preventiva. Il tag è incluso anche in un
`204` restituito per `Prefer: return=minimal`, e una risposta riproposta per una
`Idempotency-Key` trasporta lo stesso tag della prima. Una sottoscrizione live della riga
trasporta lo stesso tag su ogni frame (vedi [Realtime](/docs/backend/realtime/)).

```bash
# read
curl -i /api/data/docs/d1
# → ETag: "9f2c…"

# write, conditionally
curl -X PATCH /api/data/docs/d1 \
     -H 'If-Match: "9f2c…"' \
     -d '{"title": "Second draft"}'
# → 412 PRECONDITION_FAILED if somebody else edited it first
```

Senza di esso, il pattern read-modify-write segue la logica "last-writer-wins" (vince l'ultima scrittura) su tutto ciò che la seconda
scrittura non ha inviato: due utenti che modificano a distanza di un secondo hanno entrambi successo e la modifica del primo
va perduta senza alcun errore.

Il tag è ricavato da una colonna timestamp con `.onUpdateNow()` quando la
tabella ne dichiara una — tale colonna *è* già una versione — e altrimenti da un
hash stabile della riga. `If-Match: *` asserisce solo che la riga esista.
Non viene scritto nulla quando la precondizione fallisce.

Il modulo dei record del pannello admin salva con `If-Match`: un salvataggio effettuato a fronte di una versione
che nel frattempo qualcun altro ha sostituito viene rifiutato, il modulo lo segnala e la modifica rimane
nel modulo, ribasata (rebased) sulla nuova versione con i campi in conflitto evidenziati.

Il tag viene confrontato all'interno della transazione stessa della scrittura, dopo che la riga è stata
bloccata. Due scritture che presentano lo stesso tag non possono andare a buon fine entrambe: la seconda attende il commit
della prima, legge quanto ha scritto e viene rifiutata con `412`.

### Operazioni sui campi

Il valore di una proprietà nel corpo di una `PATCH` può essere un'operazione sul valore memorizzato
anziché un semplice valore:

```bash
curl -X PATCH /api/data/posts/p1 -d '{
  "views": { "$inc": 1 },
  "tags":  { "$push": "featured" },
  "meta":  { "$merge": { "seen": true } }
}'
```

| Operatore | Tipo di proprietà | Diventa |
|----------|---------------|---------|
| `$inc` | `number` | `SET col = COALESCE(col, 0) + n` |
| `$push` | `array` | `array_append(col, …)`, o una concatenazione jsonb |
| `$pull` | `array` | `array_remove(col, …)`, o una ri-aggregazione jsonb |
| `$merge` | `map` | `col || '…'::jsonb` (un merge **shallow**) |

Il vantaggio principale è la lettura che il chiamante non deve più effettuare. Esprimere `views + 1` come
valore significa leggerlo prima, e due richieste che leggono ciascuna `4`, aggiungono uno e
scrivono `5` finiscono con `5` — senza che nessuna delle due risposte segnali che un incremento è andato
perso. Compilata nell'istruzione, l'aritmetica viene eseguita all'interno del lock di riga
e non può fallire.

Esattamente un operatore per campo. Un operatore su un tipo di proprietà su cui non è definito,
un `$operator` sconosciuto o un operando con un formato errato generano un `400`
(`INVALID_FIELD_OPERATION`) che indica il campo — un errore di battitura non viene mai scritto nella
colonna come documento JSON.

La `map` fa eccezione, poiché il suo valore *è* un documento JSON e può contenere
chiavi `$` proprie — ad esempio `$schema` e `$id` di un JSON Schema, o un documento esportato da un altro database. Su una
`map`, solo un oggetto con esattamente una chiave che corrisponda a uno degli operatori sopra indicati è
considerato un'operazione; qualsiasi altro oggetto viene memorizzato così come inviato, chiavi `$` incluse. Quindi
`{ "meta": { "$merge": { … } } }` esegue il merge, mentre
`{ "meta": { "$schema": "https://json-schema.org/draft/2020-12/schema" } }` viene
memorizzato. Un operatore digitato male su una `map` viene di conseguenza memorizzato anch'esso; su ogni altro
tipo viene comunque rifiutato. Il client offline non ha uno schema per distinguere una `map` da
qualsiasi altra cosa, quindi quando è offline rifiuta tale valore considerandolo un'operazione sul campo;
invialo una volta ripristinata la connessione.

Le operazioni si applicano solo agli aggiornamenti: su una riga che
non esiste ancora non c'è nulla su cui operare, quindi vengono rifiutate su
`POST`, sulle creazioni `/bulk` e sugli upsert.

Un'operazione risponde alla `validation` della proprietà esattamente come un valore. Gli elementi aggiunti con push
sono valutati in base alle regole dell'elemento, le chiavi unite tramite merge in base alle proprietà della mappa,
e il valore che un'operazione *produce* in base ai limiti dichiarati: `min`,
`max`, `moreThan`, `lessThan`, `positive` e `negative` di un numero, elementi `min` e
`max` di un array. Quest'ultimo controllo è una condizione sulla stessa `UPDATE`, non una lettura
preventiva. Su `stock: { validation: { min: 0 } }`, `{ "stock": { "$inc": -1 } }`
ha successo finché la disponibilità è almeno 1 e viene rifiutato a 0 con l'errore `400`
(`VALIDATION_CONSTRAINT`) restituito anche da `{ "stock": -1 }`, indicando il campo e il
vincolo. Due decrementi concorrenti di uno stock pari a 1 non possono riuscire entrambi, poiché
il secondo viene valutato rispetto alla riga salvata dal primo. Un numero non impostato vale
come `0` e un array non impostato come vuoto. Un'operazione rifiutata non scrive nulla, nemmeno
i valori semplici che la affiancano nel corpo. Poiché il controllo fa parte dell'istruzione,
si applica anche alle scritture in-process tramite `rebase.data`, che ignorano
la validazione a livello di richiesta.

### Upsert su una chiave naturale

`POST /api/data/:slug?on_conflict=sku` inserisce la riga, oppure aggiorna quella
che contiene già tale SKU, invece di fallire. La rotta bulk accetta
lo stesso target come `onConflict` accanto a `upsert: true`, e lo stesso fa ogni operazione di `upsert`
di un batch.

```bash
curl -X POST '/api/data/products?on_conflict=sku' \
     -d '{"sku": "LAMP-01", "name": "Desk lamp", "price": 39}'

curl -X POST /api/data/products/bulk -d '{
  "rows": [ … ],
  "upsert": true,
  "onConflict": ["tenant_id", "sku"]
}'
```

Il target deve garantire l'univocità su cui il database può effettuare la corrispondenza: la
primary key (il valore predefinito quando non ne viene indicata nessuna), una colonna dichiarata
`.unique()`, o le colonne di un [indice](/docs/backend/indexes/) con `unique: true`.
Qualsiasi altra cosa genera un errore `400`
(`INVALID_CONFLICT_TARGET`) che elenca i target effettivamente esistenti — Postgres altrimenti
risponderebbe *there is no unique or exclusion constraint matching the ON
CONFLICT specification* dall'interno di una transazione che ha già svolto lavoro.

Specificare un target senza `upsert: true` su una scrittura bulk genera a sua volta un `400`: ignorarlo
silenziosamente trasformerebbe un'importazione rieseguibile in un'importazione che duplica i dati.

`?on_conflict=` viene rifiutato su una creazione annidata (`INVALID_CONFLICT_TARGET`). La
riga corrispondente potrebbe trovarsi sotto un altro genitore, e l'upsert la sposterebbe
sotto quello attuale. Invia l'upsert alla rotta specifica della tabella.

Un upsert che trova una riga già memorizzata si traduce in un aggiornamento di quest'ultima. Il server legge la riga
identificata dalla chiave, nell'ambito del chiamante e all'interno della transazione di scrittura, e
esegue il normale aggiornamento: i campi presenti nel corpo vengono scritti, quelli omessi
mantengono i valori memorizzati invece di essere reimpostati al loro valore `.default()`,
`beforeSave` e `afterSave` vedono `status: "existing"` con i valori precedenti,
e la cronologia registra un aggiornamento. Una riga che la lettura non ha potuto vedere, o una inserita
in modo concorrente, viene comunque intercettata da `ON CONFLICT … DO UPDATE`, che imposta solo quanto
scritto dal corpo e dagli hook, oltre ai timestamp `.onUpdateNow()`. Una chiave che fa riferimento a una riga
al di fuori dell'ambito `beforeQuery` del chiamante risponde con `404`. Una chiave che appartiene a una
riga nel [cestino](/docs/collections/soft-delete/) risponde con `409 ROW_IN_TRASH`
e non scrive nulla: ripristina prima la riga, oppure eliminala definitivamente (purge).

Una riga che esisteva già conserva il timestamp `.onCreateNow()` e il creatore
`.onCreateUser()`. Un conflitto significa che la creazione della riga appartiene al
passato, e una re-importazione notturna che azzerasse `createdAt` su tutto ciò che tocca
comprometterebbe qualsiasi query del tipo "novità di questa settimana".

#### Non sulla tabella auth

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

La tabella di autenticazione (quella dichiarata con `defineAuthTable`) rifiuta l'upsert da qualsiasi
punto di accesso — `?on_conflict=`, `/bulk` con `upsert: true`, un'operazione `upsert` in `_batch`,
l'`upsert()` dell'SDK e il socket realtime — con un `400`
(`INVALID_CONFLICT_TARGET`). Le sue righe sono gli utenti, e la creazione o la modifica di un utente
seguono regole diverse: una creazione esegue l'hashing della password, normalizza
l'email, esegue `onCreateUser` e invia l'invito, mentre un aggiornamento non può
revocare i permessi dell'ultimo amministratore. Un upsert determina quale delle due azioni intraprendere
solo all'interno della scrittura, troppo tardi per applicare l'una o l'altra logica. Crea gli utenti con una
semplice `POST` e modificali con `PATCH`.

### `Prefer: return=minimal`

Per impostazione predefinita, ogni scrittura risponde con la riga completa, che include gli
elementi definiti dal server — un id seriale, un timestamp `.onCreateNow()`, qualsiasi elemento
riscritto da `beforeSave`. Invia `Prefer: return=minimal` quando non hai bisogno di nulla di tutto ciò:

```bash
curl -X POST /api/data/events \
     -H "Prefer: return=minimal" \
     -d '{"kind": "page_view"}'
# → 204 No Content, Preference-Applied: return=minimal
```

Una scrittura singola risponde con `204`. Una scrittura `/bulk` o `/_batch` risponde con `200`
restituendo gli **id** invece delle righe — in una creazione l'id è l'unica cosa
che il chiamante non può calcolare, quindi scartarlo significherebbe dover rileggere la tabella in base
a una chiave naturale per scoprire cosa è stato appena scritto. Una chiave a colonna singola viene restituita
come scalare; una chiave composita come oggetto delle sue colonne.

## Batch cross-tabella

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span> Ogni operazione indica la propria tabella come `table` (in precedenza era `collection`).

`POST /api/data/_batch` scrive su più tabelle in un'unica transazione, con il
ruolo del chiamante, applicando le stesse validazioni, hook e row-level security
che applicherebbe la rotta a riga singola di ogni operazione.

```json
POST /api/data/_batch
{
  "operations": [
    { "op": "create", "table": "orders",
      "values": { "total": 40 }, "ref": "order" },
    { "op": "create", "table": "order_items",
      "values": { "order_id": { "$ref": "order.id" }, "sku": "A-1" } },
    { "op": "update", "table": "stock",
      "id": "A-1", "values": { "count": { "$inc": -1 } } },
    { "op": "delete", "table": "carts", "id": "c-9" }
  ]
}
```

```json
{
  "data": [ { "id": 31, "total": 40 }, { "id": 88, … }, { … }, null ],
  "meta": { "operations": 4 }
}
```

`op` può essere `create`, `update`, `upsert` o `delete`. `update` e `delete` richiedono un
`id`; `create`, `update` e `upsert` richiedono `values`; `upsert` può specificare un
target `onConflict` alle stesse condizioni descritte sopra. `data` è allineato a
`operations` — la riga scritta per create, update o upsert, e `null` per un
delete — quindi un indice in uno corrisponde all'indice nell'altro.

### `$ref`: puntare a una riga creata nello stesso batch

Un'operazione può assegnarsi un nome con `ref`, e qualsiasi operazione successiva può inserire
`{ "$ref": "<nome>.<campo>" }` al posto di un valore — all'interno di `values` a qualsiasi livello di annidamento, o
come `id`. Questo si risolve nel campo specificato della riga scritta dall'operazione indicata.

Questa è la ragione per cui l'endpoint esiste anziché essere un semplice ciclo: la
foreign key di un elemento figlio non può essere nota finché il genitore non è stato inserito, quindi senza questa funzionalità
il genitore e i figli dovrebbero essere richieste separate — precisamente
la sequenza che rischia di avere successo solo a metà. Si risolvono unicamente i riferimenti **all'indietro** (backward);
un riferimento in avanti viene rifiutato prima dell'apertura della transazione.

### Cosa viene verificato prima che venga scritto qualcosa

Formato (shape), tabelle sconosciute, campi sconosciuti, vincoli sui valori, operazioni sui campi,
target di conflitto e raggiungibilità di `$ref` vengono tutti determinati prima dell'apertura
della transazione. Un batch è del tipo "tutto o niente" (all-or-nothing), e rilevare un errore di battitura all'operazione 40
comporterebbe altrimenti il rollback delle 39 scritture precedenti.

Limitato allo stesso numero di operazioni di una scrittura bulk (1000 per impostazione predefinita), poiché
un batch mantiene i propri lock per l'intera durata della transazione. Gli hook di ogni operazione
vengono eseguiti al suo interno, uno dopo l'altro, quindi un hook lento si paga una volta per ogni riga
a transazione aperta: 100 righe il cui `beforeSave` attende 50 ms occupano una connessione,
e i lock di ogni riga scritta fino a quel momento, per 5,3 s. Lo stesso vale per
una scrittura `/bulk`. Vedi [Un hook occupa una connessione](/docs/collections/context-data-api/#a-hook-holds-a-connection). Un driver che non è in grado di
rendere il batch atomico risponde con `BATCH_UNSUPPORTED` anziché ricorrere a un ciclo
di scritture singole — il che non garantirebbe né l'atomicità né il singolo round-trip
per cui si utilizza un batch.

Un'`update` o una `delete` che specifica una riga inesistente fa fallire l'intero batch
con un `404`, per la stessa ragione per cui una scrittura parziale viene rifiutata ovunque:
uno stato applicato solo a metà non offre possibilità di ripristino affidabili.
