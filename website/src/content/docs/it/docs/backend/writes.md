---
sourceHash: 9c622813c5a4eca9
title: Scrittura tramite REST
sidebar_label: Scrittura tramite REST
description: Chiavi di idempotenza, scritture condizionali con ETag e If-Match, operazioni sui campi, upsert su chiave naturale, return=minimal e batch tra collezioni.
---

I verbi sono descritti nella pagina [REST API](/docs/backend/api/). Questa pagina
riguarda le cinque cose che una scrittura può *richiedere* oltre al proprio verbo,
e l'endpoint che scrive su più collezioni contemporaneamente. Tutte queste opzioni
sono attivabili per singola richiesta: una scrittura che non ne fa richiesta si
comporta esattamente come ha sempre fatto.

## Scrittura

Oltre ai verbi, le rotte di scrittura accettano cinque parametri che modificano
il comportamento di una scrittura. Tutti e cinque sono facoltativi su base
richiesta, quindi nulla di quanto descritto qui altera il comportamento di una
richiesta che non ne fa uso.

### Idempotenza

`Idempotency-Key: <uuid>` su qualsiasi scrittura significa "se hai già risposto a
questa identica richiesta, rispondi di nuovo invece di eseguirla due volte".

```bash
curl -X POST /api/data/orders \
     -H "Idempotency-Key: 1f0f…" \
     -d '{"total": 40}'
```

Un client che non riceve risposta non può sapere se la scrittura sia stata confermata
o meno, quindi ritenta — e senza una chiave il server non può distinguere quel
tentativo da una seconda scrittura autentica. Su una tabella con ID assegnato dal
server, ciò genera una riga duplicata, poiché l'ID generato dal client non è mai
stato utilizzato.

Una chiave identifica **una sola richiesta**: registra il metodo, il percorso e il
corpo per cui è stata dichiarata. Inviando nuovamente la stessa identica richiesta,
la risposta viene riprodotta; inviando una richiesta diversa con la stessa chiave,
questa verrà rifiutata con `IDEMPOTENCY_KEY_REUSED` (422) anziché rispondere con il
risultato della prima. Un nuovo tentativo che arriva mentre la prima richiesta è
ancora in corso riceve `IDEMPOTENCY_KEY_IN_PROGRESS` (409) — invialo di nuovo una
volta completata la prima.

È supportata su `POST`, `PATCH`, `DELETE`, su tutte e tre le rotte `/bulk` e su
`/_batch`. Le chiavi rimangono valide per 24 ore e sono associate al chiamante
autenticato; una richiesta non autenticata non ha un'identità a cui essere associata,
quindi in tal caso l'intestazione viene ignorata. Un backend che non può memorizzare
le chiavi ignora l'intestazione anziché rifiutare la scrittura.

`DELETE` è il caso che merita particolare attenzione. Se ritentato senza una chiave,
il secondo tentativo trova la riga già eliminata e risponde con `404` — cosa che un
client in fase di retry interpreta come un errore permanente per un'eliminazione che
in realtà è andata a buon fine. Con una chiave, viene invece restituito nuovamente
il `204`.

### Concorrenza ottimistica: `ETag` e `If-Match`

`GET /api/data/:slug/:id` restituisce un `ETag`. Inviandolo nuovamente come
`If-Match` in una successiva richiesta `PATCH` o `DELETE`, la scrittura viene
rifiutata con `412` se la riga è stata modificata nel frattempo.

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

Senza di esso, il pattern read-modify-write segue la logica last-writer-wins per
tutto ciò che la seconda scrittura non ha inviato: due modifiche a un secondo di
distanza hanno entrambe successo e la modifica della prima viene persa senza alcun
messaggio di errore.

Il tag deriva da una proprietà `date` con `autoValue: "on_update"` quando la
collezione ne dichiara una — quella colonna già *è* una versione — e da un hash
stabile della riga in caso contrario. `If-Match: *` verifica solo che la riga
esista. Se la precondizione fallisce, non viene scritto nulla.

### Operazioni sui campi

Nel corpo di una richiesta `PATCH`, il valore di una proprietà può essere
un'operazione sul valore memorizzato anziché un valore statico:

```bash
curl -X PATCH /api/data/posts/p1 -d '{
  "views": { "$inc": 1 },
  "tags":  { "$push": "featured" },
  "meta":  { "$merge": { "seen": true } }
}'
```

| Operatore | Tipo di proprietà | Diventa |
|-----------|-------------------|---------|
| `$inc` | `number` | `SET col = COALESCE(col, 0) + n` |
| `$push` | `array` | `array_append(col, …)`, o una concatenazione jsonb |
| `$pull` | `array` | `array_remove(col, …)`, o una riaggregazione jsonb |
| `$merge` | `map` | `col || '…'::jsonb` (un merge **shallow**) |

Il vantaggio principale è la lettura che il chiamante non deve più effettuare.
Esprimere `views + 1` come valore statico comporta doverlo prima leggere, e due
richieste che leggono ciascuna `4`, incrementano di uno e scrivono `5` finiranno
per impostare `5` — senza che nessuna delle due risposte segnali che un incremento
è andato perso. Compilata direttamente nell'istruzione, l'operazione aritmetica
avviene all'interno del lock di riga e non può fallire.

È consentito esattamente un solo operatore per campo. Un operatore applicato a un
tipo di proprietà non supportato, un `$operator` sconosciuto o un operando con una
struttura errata restituisce un `400` (`INVALID_FIELD_OPERATION`) che indica il
campo: un errore di battitura non viene mai salvato nella colonna come documento
JSON. Le operazioni si applicano solo agli aggiornamenti: su una riga che non
esiste ancora non c'è nulla su cui operare, pertanto vengono rifiutate su `POST`,
sulle creazioni con `/bulk` e sugli upsert.

### Upsert su una chiave naturale

`POST /api/data/:slug?on_conflict=email` esegue
`INSERT … ON CONFLICT (email) DO UPDATE` invece di un semplice inserimento. La
rotta bulk accetta lo stesso target come `onConflict` insieme a `upsert: true`,
e lo stesso vale per ogni operazione di `upsert` all'interno di un batch.

```bash
curl -X POST '/api/data/users?on_conflict=email' \
     -d '{"email": "ada@example.com", "name": "Ada"}'

curl -X POST /api/data/users/bulk -d '{
  "rows": [ … ],
  "upsert": true,
  "onConflict": ["tenant_id", "slug"]
}'
```

Il target deve disporre di un vincolo di unicità su cui il database possa
effettuare la corrispondenza: la chiave primaria (il valore predefinito se non ne
viene specificato alcuno), una proprietà con `validation: { unique: true }`,
oppure le colonne di un [indice](/docs/backend/indexes/) `unique: true`.
Qualsiasi altra indicazione restituisce un `400` (`INVALID_CONFLICT_TARGET`) che
elenca i target effettivamente disponibili — in caso contrario, Postgres
risponderebbe con *there is no unique or exclusion constraint matching the ON
CONFLICT specification* dall'interno di una transazione che ha già eseguito
delle operazioni.

Anche specificare un target senza `upsert: true` in una scrittura bulk genera un
`400`: ignorarlo silenziosamente trasformerebbe un'importazione rieseguibile in una
che genera duplicati.

Una riga già esistente mantiene il proprio timestamp `on_create`. Un conflitto
implica che la creazione della riga sia un evento passato, e una reimportazione
notturna che reimpostasse `createdAt` su ogni record toccato comprometterebbe
qualsiasi query basata su "nuovi di questa settimana".

### `Prefer: return=minimal`

Ogni scrittura risponde per impostazione predefinita con la riga completa, che
include i valori determinati dal server — un ID seriale, un timestamp generato
da `autoValue` o qualsiasi cosa riscritta da `beforeSave`. Invia
`Prefer: return=minimal` quando questi dati non sono necessari:

```bash
curl -X POST /api/data/events \
     -H "Prefer: return=minimal" \
     -d '{"kind": "page_view"}'
# → 204 No Content, Preference-Applied: return=minimal
```

Una singola scrittura risponde con `204`. Una scrittura `/bulk` o `/_batch`
risponde con `200` restituendo gli **id** invece delle intere righe — in una
creazione, l'ID è l'unico dato che il chiamante non può calcolare, quindi
scartarlo significherebbe dover rileggere la tabella tramite una chiave naturale
per scoprire cosa è stato appena scritto. Una chiave a colonna singola viene
restituita come valore scalare; una chiave composita come oggetto contenente le
relative colonne.

## Batch tra collezioni

`POST /api/data/_batch` esegue scritture su più collezioni in un'unica transazione,
con il ruolo del chiamante, applicando le stesse validazioni, callback e sicurezza
a livello di riga (row-level security) previste per le singole rotte.

```json
POST /api/data/_batch
{
  "operations": [
    { "op": "create", "collection": "orders",
      "values": { "total": 40 }, "ref": "order" },
    { "op": "create", "collection": "order_items",
      "values": { "order_id": { "$ref": "order.id" }, "sku": "A-1" } },
    { "op": "update", "collection": "stock",
      "id": "A-1", "values": { "count": { "$inc": -1 } } },
    { "op": "delete", "collection": "carts", "id": "c-9" }
  ]
}
```

```json
{
  "data": [ { "id": 31, "total": 40 }, { "id": 88, … }, { … }, null ],
  "meta": { "operations": 4 }
}
```

`op` può essere `create`, `update`, `upsert` o `delete`. `update` e `delete`
richiedono un `id`; `create`, `update` e `upsert` richiedono `values`; `upsert`
può specificare un target `onConflict` alle stesse condizioni descritte sopra.
L'array `data` corrisponde a `operations` — contenendo la riga scritta per
`create`, `update` o `upsert`, e `null` per `delete` — di conseguenza, un indice
nell'uno corrisponde allo stesso indice nell'altro.

### `$ref`: fare riferimento a una riga creata nello stesso batch

Un'operazione può assegnarsi un identificativo con `ref`, e qualsiasi operazione
successiva può inserire `{ "$ref": "<name>.<field>" }` al posto di un valore — in
`values` a qualsiasi livello di annidamento, o come `id`. Questo verrà risolto con
il valore di quel campo nella riga scritta dall'operazione a cui fa riferimento.

Questo è il motivo principale per cui l'endpoint esiste invece di essere un semplice
ciclo: la chiave esterna (foreign key) di un record figlio non è nota finché il
genitore non è stato inserito; senza questo meccanismo, genitore e figli dovrebbero
essere richieste separate — esattamente la sequenza che rischia di avere successo
solo a metà. Vengono risolti solo i riferimenti **all'indietro** (backward); un
riferimento in avanti viene rifiutato prima ancora che la transazione venga avviata.

### Cosa viene verificato prima di scrivere qualsiasi dato

Formato, collezioni sconosciute, campi sconosciuti, vincoli sui valori, operazioni
sui campi, target di conflitto e raggiungibilità di `$ref` vengono tutti convalidati
prima che la transazione abbia inizio. Un batch è "tutto o niente", e trovare un
errore di battitura all'operazione 40 comporterebbe altrimenti il rollback delle
39 scritture precedenti.

Il limite massimo di operazioni è lo stesso di una scrittura bulk (1000 per
impostazione predefinita), poiché un batch mantiene attivi i propri lock per
l'intera durata della transazione. Un driver che non può rendere il batch atomico
risponde con `BATCH_UNSUPPORTED` invece di ricorrere a un ciclo di scritture singole
— il che non garantirebbe né l'atomicità né il singolo round-trip per cui si
utilizza un batch.

Un'operazione di `update` o `delete` che fa riferimento a una riga inesistente fa
fallire l'intero batch con un `404`, per lo stesso motivo per cui una scrittura
parziale viene rifiutata ovunque: uno stato applicato solo a metà non consente un
ripristino agevole.

---
