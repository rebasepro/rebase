---
sourceHash: 2499dc27f2076f94
title: API REST
sidebar_label: API REST
description: Endpoint API REST generati automaticamente per ogni collection, con filtraggio, ordinamento, paginazione e inclusione delle relazioni.
---

## Panoramica

Rebase genera automaticamente un'API completa dalle definizioni delle tue collection:

- **API REST** — Endpoint CRUD per ogni collection su `/api/data/:slug`
- **Specifica OpenAPI** — Specifica leggibile da macchina su `/api/docs`
- **Swagger UI** — Explorer API interattivo su `/api/swagger` (solo in modalità di sviluppo)

Non è richiesto alcun codice — definisci le tue collection e l'API apparirà automaticamente.

## Endpoint REST

Per ogni collection vengono generati i seguenti endpoint. Tutte le altre route montate dal backend — auth, storage, admin, meta — si trovano nell'[endpoint index](/docs/backend/endpoints/).

| Metodo | Percorso | Descrizione |
|--------|----------|-------------|
| `GET` | `/api/data/:slug` | Elenca le entità |
| `GET` | `/api/data/:slug/count` | Conta le entità |
| `GET` | `/api/data/:slug/aggregate` | `count()`, `sum()`, `avg()`, `min()`, `max()`, opzionalmente raggruppati. Accetta gli stessi filtri dell'endpoint di elenco e la RLS si applica alle righe aggregate — vedi [Querying](/docs/sdk/querying/) |
| `GET` | `/api/data/:slug/:id` | Recupera una singola entità |
| `POST` | `/api/data/:slug` | Crea un record |
| `PATCH` | `/api/data/:slug/:id` | Aggiorna un record (parziale — vengono scritte solo le proprietà inviate) |
| `DELETE` | `/api/data/:slug/:id` | Elimina un record |
| `POST` | `/api/data/:slug/bulk` | Crea molteplici entità in un'unica transazione |
| `PATCH` | `/api/data/:slug/bulk` | Aggiorna molteplici entità in un'unica transazione |
| `POST` | `/api/data/:slug/bulk/delete` | Elimina molteplici entità in un'unica transazione |
| `POST` | `/api/data/_batch` | Scrive **tra** collection diverse in un'unica transazione |

### Route di subcollection

Le relazioni annidate sono accessibili tramite percorsi URL:

```
GET    /api/data/authors/42/posts         → list author's posts
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Meccanica di routing e parsing dei segmenti

Per gestire livelli arbitrari di annidamento delle subcollection, Rebase instrada le richieste in arrivo utilizzando la regex del parametro `:rest{.+}` di Hono. Il motore interno di parsing dei segmenti analizza i percorsi contando i segmenti separati da slash:
- **Conteggio segmenti dispari** (es. `authors/42/posts` -> 3 segmenti) rappresenta una richiesta di elenco di una collection.
- **Conteggio segmenti pari** (es. `authors/42/posts/7` -> 4 segmenti) rappresenta un'operazione su un ID di entità specifico. L'ultimo segmento viene estratto come `entityId` di destinazione.

Il motore esclude i namespace di sistema riservati (es. `history`) dall'analisi dei segmenti di percorso per evitare collisioni con gli endpoint predefiniti.

## Autenticazione

Tutti gli endpoint dei dati richiedono l'autenticazione per impostazione predefinita. Includi un token Bearer nell'header `Authorization`:

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

Per le chiamate server-to-server, utilizza la chiave di servizio (service key):

```bash
curl -H "Authorization: Bearer <service-key>" \
     https://api.example.com/api/data/products
```

## Filtraggio

Utilizza i parametri di query in stile PostgREST per filtrare i risultati. Il formato è `?field=operator.value`:

```bash
# Exact match
GET /api/data/products?active=eq.true

# Comparison operators
GET /api/data/products?price=gt.100
GET /api/data/products?price=lte.50

# Multiple filters (AND)
GET /api/data/products?active=eq.true&price=gt.10

# IN operator — match any value in a set
GET /api/data/products?status=in.(draft,published)

# NOT IN
GET /api/data/products?status=nin.(archived,deleted)

# Array contains
GET /api/data/products?tags=cs.electronics

# Array contains any
GET /api/data/products?tags=csa.(electronics,books)
```

### Operatori di filtro

| Operatore | Significato | Esempio |
|-----------|-------------|---------|
| `eq` | Uguale a (`==`) | `?active=eq.true` |
| `neq` | Diverso da (`!=`) | `?status=neq.draft` |
| `gt` | Maggiore di (`>`) | `?price=gt.100` |
| `gte` | Maggiore o uguale a (`>=`) | `?price=gte.100` |
| `lt` | Minore di (`<`) | `?price=lt.50` |
| `lte` | Minore o uguale a (`<=`) | `?price=lte.50` |
| `in` | Nell'array | `?status=in.(a,b,c)` |
| `nin` | Non nell'array | `?status=nin.(a,b)` |
| `cs` | L'array contiene | `?tags=cs.value` |
| `csa` | L'array contiene almeno uno | `?tags=csa.(a,b)` |
| `like` | Corrispondenza di pattern, con distinzione tra maiuscole e minuscole (`like`) | `?sku=like.AB-%` |
| `ilike` | Corrispondenza di pattern, senza distinzione tra maiuscole e minuscole (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | Non corrisponde al pattern (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | Non corrisponde, senza distinzione tra maiuscole e minuscole (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | La colonna è `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | La colonna non è `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

`isnull` e `notnull` ignorano il rispettivo valore — l'operatore costituisce l'intera condizione e qualsiasi cosa dopo il punto viene scartata. L'SDK scrive `.null`, quindi è questa la dicitura che vedrai transitare in rete.

:::caution[`eq.null` è la stringa di quattro caratteri, non `IS NULL`]
`?deleted_at=eq.null` cerca il testo letterale `null`. In SQL `= NULL` non è mai vero, quindi nessuna interpretazione di `eq.null` può indicare il test di nullità — usa `isnull` per quello scopo. L'SDK serializza `.where("deleted_at", "==", null)` come `isnull.null` esattamente per questo motivo.
:::

### Operatori logici

Usa `or`, `and` e `not` per condizioni complesse:

```bash
# OR: match products that are either cheap or on sale
GET /api/data/products?or=(price.lt.10,on_sale.eq.true)

# AND: explicit conjunction
GET /api/data/products?and=(active.eq.true,price.gt.0)

# NOT: everything that is not a discontinued in-stock item
GET /api/data/products?not=(discontinued.eq.true,stock.gt.0)
```

`not` nega la **congiunzione** delle sue condizioni: `not(a)` equivale a `NOT a`, e `not(a,b)` a `NOT (a AND b)`. Viene compilato in un vero `NOT (...)` SQL anziché in operatori invertiti — la logica SQL è a tre valori, quindi `NOT (a AND b)` e `(NOT a) OR (NOT b)` smettono di coincidere non appena entra in gioco un NULL. Una negazione quindi **include le righe la cui colonna è NULL**, che è ciò che significa `NOT`; aggiungi un `notnull` in AND se non è questo il comportamento desiderato.

**Un solo gruppo per richiesta: `or` prevale su `and`, ed entrambi prevalgono su `not`.** Sono tre formulazioni dello stesso slot, non tre filtri separati. Usa invece l'annidamento:

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

I gruppi possono essere annidati fino a 32 livelli di profondità; oltre questo limite la richiesta viene rifiutata con `INVALID_LOGICAL_GROUP`.

Un gruppo **restringe** i risultati insieme ai filtri di campo anziché sostituirli — vedi [Come si combinano i filtri](#how-the-filters-combine).

### Il dialetto JSON `where`

I filtri di campo sopra descritti sono uno dei due modi per inviare un filtro. L'altro consiste in un singolo oggetto JSON, che è ciò che il documento OpenAPI pubblica su ogni `GET /api/data/{slug}` e ciò che accettano le route di subcollection annidate:

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Ogni chiave è un campo, ogni valore è una tupla canonica `[operator, value]` — le stesse tuple scritte dall'SDK. Un valore può anche essere una stringa con notazione a punto pre-serializzata (`{"status":"eq.active"}`) o uno scalare semplice (`{"status":"active"}`); tutte e tre le varianti compilano nella stessa condizione.

La differenza fondamentale da conoscere: **JSON trasporta i tipi.** `?price=gte.100` invia la stringa `"100"` e il driver ne effettua il cast in base al tipo di colonna, mentre `?where={"price":[">=",100]}` invia un numero. Per una colonna la cui interpretazione testuale e numerica differisce — una stringa di versione, un codice con padding di zeri — questo è il parametro a cui affidarsi.

Un `where` malformato restituisce un errore 400 `INVALID_WHERE`, e non un filtro ignorato silenziosamente: scartarlo significherebbe eseguire la lettura senza filtri e restituire tutto ciò che la row-level security consente di leggere.

### Come si combinano i filtri

`?field=op.value`, `?where=`, `?or=`/`?and=` e `?searchString=` sono indipendenti, e ciascuno di essi presente deve corrispondere:

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

Non c'è modo di applicare l'operatore OR tra questi gruppi. Qualsiasi condizione che non sia un semplice AND di questi gruppi deve essere inserita all'interno di un unico albero `or=`/`and=`.

## Ordinamento

Usa `orderBy` con il formato `field:direction`:

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

Una direzione mancante equivale a `asc`. Una direzione che non sia né `asc` né `desc`, oppure un campo non presente nella collection, restituisce un errore **400** — non un 200 con le righe ordinate arbitrariamente dal database, il che sarebbe indistinguibile da un ordinamento riuscito.

### Più chiavi di ordinamento

La sintassi abbreviata supporta una sola chiave. Per utilizzarne più di una, passa un array JSON — la seconda chiave discrimina tra le righe considerate uguali dalla prima:

```bash
# By category, and newest first within each category
GET /api/data/products?orderBy=[{"field":"category"},{"field":"createdAt","direction":"desc"}]
```

Entrambe le formulazioni sono supportate da tutte le route che elencano righe, incluse quelle annidate (`/api/data/authors/:id/posts`). Ogni ordinamento termina sull'id di riga decrescente, sia che venga richiesto o meno: questo è ciò che rende l'ordinamento totale, e la paginazione su un ordinamento non totale ripete e salta righe.

Un parametro `?orderBy=` ripetuto non costituisce un ordinamento a più chiavi — l'ultimo specificato prevale, come accade per ogni altro parametro di query. Usa l'array.

### Posizionamento dei valori NULL nell'ordinamento

Per impostazione predefinita, i valori NULL vengono ordinati **per ultimi in ordine crescente e per primi in ordine decrescente**, seguendo la convenzione nativa di Postgres. Un terzo segmento separato da due punti permette di specificare diversamente:

```bash
# Newest first, with the undated rows at the end rather than the top
GET /api/data/posts?orderBy=publishedAt:desc:last
```

Il formato ad array JSON accetta una chiave `"nulls"` per la stessa funzionalità:

```bash
GET /api/data/posts?orderBy=[{"field":"publishedAt","direction":"desc","nulls":"last"}]
```

Qualsiasi valore diverso da `first` o `last` genera un 400, e non un ordine silenziosamente differente. Il cursore descritto di seguito rispetta quanto dichiarato dall'ordinamento, garantendo che la paginazione su una chiave che ammette valori null rimanga corretta con entrambe le impostazioni.

## Paginazione

Usa `limit` e `offset`, oppure `page`:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

Il limite predefinito è **50**, il massimo è **1000**. Entrambi provengono da `DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, valori riportati anche nella specifica OpenAPI generata — un `limit` superiore al massimo viene rifiutato anziché ridotto al limite (clamped).

Tutti e tre i parametri della finestra vengono rifiutati anziché corretti automaticamente, e ciascuno specifica il proprio codice: `INVALID_LIMIT`, `INVALID_OFFSET` (un numero intero maggiore o uguale a 0) e `INVALID_PAGE` (un numero intero maggiore o uguale a 1). Una finestra silenziosamente diversa da quella richiesta non potrebbe essere distinta dal raggiungimento della fine della collection, motivo per cui nessuno di essi viene limitato o ignorato.

### Paginazione tramite cursore

`offset` riconta le righe a ogni richiesta; pertanto, una riga inserita o eliminata tra due pagine sposta la finestra e la scansione salta o ripete silenziosamente delle righe. `?after=` esegue invece una ricerca diretta (seek): la pagina successiva inizia tassativamente dopo l'ultima riga restituita.

Ogni risposta di elenco include `meta.nextCursor` finché è disponibile un'altra pagina. Rinvialo invariato:

```bash
GET /api/data/orders?orderBy=createdAt:desc&limit=100
# → meta.nextCursor = "eyJrIjpbWyJjcmVhdGVkX2F0Iiw…"

GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJjcmVhdGVkX2F0Iiw…
```

Il cursore è **opaco** — codifica le chiavi di ordinamento *e* i valori dell'ultima riga per tali chiavi — da cui derivano tre regole, ciascuna delle quali genera un errore 400 anziché restituire una pagina errata:

| Situazione | Codice |
|------------|--------|
| `after` con `offset` o `page` | `CURSOR_WITH_OFFSET` — entrambi specificano l'inizio della pagina |
| `after` con un `orderBy` diverso da quello con cui è stato emesso | `CURSOR_ORDER_MISMATCH` |
| Un cursore non emesso da questa API | `INVALID_CURSOR` |

Una richiesta che non specifica alcun `orderBy` **adotta quello del cursore**, pertanto rinviare `meta.nextCursor` senza ripetere l'ordinamento funziona correttamente.

Gli ordinamenti a più chiavi e le chiavi con valori null paginano entrambi correttamente: il confronto viene costruito su ciascuna chiave in sequenza, rispettando il posizionamento dei valori NULL dichiarato nell'ordinamento. L'unico ordinamento che nessun cursore può descrivere è la pertinenza (`_score`) — calcolata per ogni query e non memorizzata da nessuna parte — e tale elenco semplicemente non include alcun `nextCursor`.

## Selezione delle colonne

`?fields=` restringe la lettura alle sole colonne indicate. Si tratta di una proiezione inserita direttamente nella query, non di un ritaglio della risposta:

```bash
GET /api/data/posts?fields=id,title&limit=50
```

La chiave primaria viene sempre restituita (una riga che non può essere indirizzata non può essere aggiornata, eliminata o superata con la paginazione — e il cursore è derivato da essa), e le colonne con `excludeFromApi` rimangono nascoste indipendentemente dal fatto che vengano specificate o meno. Una colonna sconosciuta restituisce un 400 `UNKNOWN_FIELD` anziché una riga priva silenziosamente del campo.

`?distinct=true` raggruppa le righe identiche rispetto a tali colonne:

```bash
# The statuses actually in use
GET /api/data/posts?fields=status&distinct=true
```

Viene rifiutato (400) in combinazione con un `searchString` con punteggio di pertinenza o con una ricerca vettoriale, che associano un punteggio per ciascuna riga rendendo ogni riga distinta per definizione, e quando `orderBy` indica una colonna non restituita da `fields` (`DISTINCT_ORDER_BY_NOT_SELECTED`) — Postgres non può ordinare una lettura DISTINCT tramite un'espressione esclusa dalla propria clausola select.

`?fields=` e `?distinct=` funzionano anche sulla route get-by-id e sulle route di subcollection annidate.

### Formato della risposta

Le risposte di elenco includono i metadati di paginazione:

```json
{
    "data": [
        { "id": 1, "name": "Widget", "price": 29.99 },
        { "id": 2, "name": "Gadget", "price": 49.99 }
    ],
    "meta": {
        "total": 150,
        "limit": 20,
        "offset": 0,
        "hasMore": true,
        "nextCursor": "eyJrIjpbWyJpZCIsImRlc2MiXV0sInYiOnsiaWQiOjJ9LCJpIjoyfQ"
    }
}
```

`nextCursor` è presente finché `hasMore` è true e la pagina ha restituito almeno una riga; è assente nell'ultima pagina e con ordinamenti che nessun cursore può descrivere.

Le risposte per una singola entità restituiscono un oggetto semplice (flat):

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "createdAt": "2026-01-15T10:30:00Z"
}
```

## Errori

Ogni errore, proveniente da qualsiasi route, viene restituito in una struttura (envelope) unificata:

```json
{
    "error": {
        "message": "Unknown filter operator 'contains' on field 'title'.",
        "code": "UNKNOWN_FILTER_OPERATOR",
        "details": { "field": "title", "operator": "contains" },
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

`message` e `code` sono sempre presenti. `details` compare quando il rifiuto riguarda un elemento specifico — il campo non valido, i percorsi non riusciti. `requestId` compare quando la richiesta conteneva un header `X-Request-ID` o ne è stato assegnato uno; viene riportato anche nell'header della risposta ed è il riferimento da indicare nelle segnalazioni di bug.

**Crea ramificazioni condizionali su `code`, mai su `message` o sul solo status code.** I codici sono in `SCREAMING_SNAKE_CASE` e stabili; i messaggi sono pensati per una persona che legge una console e possono variare. Lo status HTTP si trova sulla risposta, non nel corpo.

| Stato | Codice tipico | Significato |
|-------|---------------|-------------|
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR`, `INVALID_LIMIT`, `INVALID_OFFSET`, `INVALID_PAGE` | La richiesta è malformata o richiede un'operazione impossibile |
| 401 | `UNAUTHORIZED` | Nessuna credenziale, o credenziale che non identifica nessuno |
| 403 | `FORBIDDEN`, `DB_PERMISSION_DENIED` | Credenziale che identifica un utente privo dei permessi necessari |
| 404 | `NOT_FOUND` | L'elemento indirizzato non esiste |
| 409 | `CONFLICT` | Conflitto di stato — una chiave duplicata, un albero dirty |
| 501 | varia | La funzionalità esiste ma **non è configurata** in questo deployment |
| 503 | `SERVICE_UNAVAILABLE` | Una dipendenza non è raggiungibile; la richiesta non l'ha mai raggiunta |

Una superficie/funzionalità assente perché non abilitata in questo deployment risponde con 501 accompagnato da un codice e da una motivazione, non con 404 — un 404 inspiegato su una route appena invocata dalla UI verrebbe interpretato come un deploy non funzionante.

Le route aggiungono i propri codici più specifici oltre a questi (`EMAIL_EXISTS`, `TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, …), quindi considera l'elenco dei codici come aperto. L'SDK client converte tutti gli errori in un unico `RebaseApiError` contenente `status`, `code` e `details` — vedi [Error handling](/docs/backend#error-handling).

## Ricerca testuale

Usa `searchString` per la ricerca full-text nei campi stringa:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Ricerca vettoriale

Se una collection definisce una proprietà di tipo `vector`, puoi eseguire ricerche per similarità ad alta velocità utilizzando le operazioni di distanza di pgvector compilate direttamente nella query del database.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

### Parametri di query vettoriale

| Parametro | Tipo | Descrizione |
|-----------|------|-------------|
| `vector_search` | `string` | Il nome della proprietà vettoriale su cui eseguire la query. |
| `vector` | `string` | Un array di float serializzato in JSON che rappresenta il vettore di query. |
| `vector_distance` | `string` | La metrica di distanza da valutare. Valori supportati: `cosine` (predefinito, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Soglia massima di distanza. Vengono restituiti solo i record con distanza inferiore a questa soglia. |

## Inclusione delle relazioni

Usa il parametro `include` per incorporare le entità correlate:

```bash
# Include specific relations
GET /api/data/articles?include=author,categories

# Include all relations, one hop deep
GET /api/data/articles?include=*

# A relation of a relation — up to three hops
GET /api/data/articles?include=comments.author
```

Un nome che non corrisponde a una relazione della collection genera un errore **400 `UNKNOWN_RELATION`**, a qualsiasi livello. In precedenza veniva ignorato, rispondendo con 200 e lasciando semplicemente mancante il campo — un comportamento indistinguibile da una riga priva di record correlati, facendo apparire un errore di battitura esattamente come dati vuoti. Un percorso con più di tre passaggi (hop) genera `INCLUDE_TOO_DEEP`.

### Limitare una relazione

Il formato separato da virgole non consente di specificare un `limit` per singola relazione; pertanto, `include` accetta anche JSON — riconoscibile dalla parentesi graffa iniziale:

```bash
GET /api/data/posts?include={"comments":{"limit":5,"where":{"published":["==",true]},"orderBy":"createdAt:desc","fields":["id","body"],"include":{"author":true}}}
```

| Chiave | Significato |
|--------|-------------|
| `limit` | Righe **per riga genitore**, non sull'intera pagina |
| `where` | Lo stesso dialetto di filtro utilizzato dal `where` di primo livello |
| `logical` | Un gruppo `or`/`and`/`not` sulle righe correlate |
| `orderBy` | La stessa sintassi di ordinamento, inclusa la posizione dei valori NULL |
| `fields` | Colonne della riga *correlata*; la sua chiave viene sempre preservata |
| `include` | A sua volta, relazioni della riga correlata |

`true` significa "carica l'entità per intero", quindi `{"author":true}` e `author` rappresentano la medesima richiesta. Entrambe le formulazioni funzionano sulla route di elenco, sulla route get-by-id e sulle route di subcollection annidate.

Ogni hop corrisponde a una query raggruppata (batched) per l'intera pagina, mai a una query per ciascuna riga.

Le relazioni incluse vengono incorporate direttamente nella risposta:

```json
{
    "id": 1,
    "title": "Getting Started",
    "authorId": 42,
    "author": {
        "id": 42,
        "name": "Jane Doe",
        "email": "jane@example.com"
    }
}
```

## Scrittura

Chiavi di idempotenza, scritture condizionali (`ETag` / `If-Match`), operazioni sui campi (`$inc`, `$push`, `$pull`, `$merge`), upsert su chiave naturale, `Prefer: return=minimal` e l'endpoint multi-collection `POST /api/data/_batch` sono tutti trattati in una pagina dedicata: **[Writing over REST](/docs/backend/writes/)**.

## Pipeline degli hook del ciclo di vita

Ogni operazione di mutazione REST (`POST`, `PATCH`, `DELETE`) attraversa una pipeline di esecuzione sequenziale e rigorosa degli hook:

```
Request ──► beforeSave/beforeDelete (blocking) ──► DB Operation ──► afterSave/afterDelete (deferred) ──► Response
```

### Hook bloccanti e differiti (deferred)

1. **Hook bloccanti (`beforeSave`, `beforeDelete`)**
   Questi hook vengono eseguiti in modo sincrono nel ciclo principale della richiesta *prima* di eseguire il commit della transazione del database. Possono modificare i payload in ingresso, eseguire validazioni personalizzate o interrompere completamente la richiesta generando un errore.

2. **Hook differiti (`afterSave`, `afterDelete`)**
   Questi hook vengono eseguiti in modo asincrono dopo che la transazione del database è stata confermata con successo (commit). Utilizzano promesse differite (fire-and-forget), il che significa che vengono eseguiti in background e non bloccano la risposta HTTP inviata al client. Ideali per l'invio di webhook, l'attivazione di notifiche push o l'accodamento di task esterni.

## Endpoint di sistema

| Metodo | Percorso | Autenticazione | Descrizione |
|--------|----------|----------------|-------------|
| `GET` | `/health` and `/api/health` | nessuna | Verifica di liveness/readiness |
| `GET` | `/api/docs` | nessuna | La specifica JSON di OpenAPI 3.0 |
| `GET` | `/api/swagger` | nessuna | Swagger UI. Attivo in fase di sviluppo, disattivato in produzione; `REBASE_ENABLE_SWAGGER` ne sovrascrive lo stato in entrambi i casi |
| `GET` | `/api/meta/schema-version` | nessuna | L'hash dello schema da cui è stato compilato questo backend — deliberatamente non autenticato, restituisce solo tale hash |
| `GET` | `/api/meta/contract` | admin, service key o admin API key | Il contratto completo delle collection, per `rebase generate-sdk --from`. Fail-closed: `404` se non è configurata alcuna autenticazione |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` quando impostato | Metriche di Prometheus, se `REBASE_METRICS=true` |

## OpenAPI / Swagger

La specifica OpenAPI viene generata automaticamente a partire dalle definizioni delle tue collection: descrive gli endpoint di elenco, lettura, creazione, aggiornamento, eliminazione e operazioni di massa (bulk) di ogni collection gestita dal backend, con i rispettivi parametri di query e schemi di risposta. Non costituisce una mappa completa dell'intera superficie HTTP — le route relative ad auth, storage, functions e cron sono documentate esclusivamente su questo sito — e le colonne contrassegnate con `excludeFromApi` ne vengono escluse.

I client automatizzati (machine callers) si autenticano mediante una chiave con permessi dedicati (scoped key) anziché tramite una sessione:
[API keys](/docs/backend/api-keys/).

## Metadati dello schema

Lo schema completo delle collection del progetto — ogni collection, proprietà e relazione — viene fornito a un amministratore autenticato:

```bash
GET /api/meta/contract
```

È accessibile **solo agli amministratori** e, su un deployment privo di autenticazione configurata, non viene restituito affatto (404 `CONTRACT_UNAVAILABLE`) anziché esporre lo schema pubblicamente. Il suo endpoint complementare restituisce una stringa di versione che identifica lo schema senza descriverlo ed è deliberatamente accessibile senza alcuna credenziale — ed è ciò su cui esegue il polling un job di CI:

```bash
GET /api/meta/schema-version
```

Per verificare la struttura degli endpoint anziché lo schema sottostante, il documento OpenAPI è disponibile su `GET /api/docs`, con la Swagger UI consultabile su `/api/swagger` quando `enableSwagger` è abilitato.

## Passaggi successivi

- **[Client SDK](/docs/sdk)** — Client con tipizzazione statica per l'API REST
- **[Collections](/docs/collections)** — Definisci lo schema dei tuoi dati
- **[Security Rules (RLS)](/docs/collections/security-rules)** — Controlla l'accesso per singola riga

---
