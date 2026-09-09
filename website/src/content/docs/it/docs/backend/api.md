---
sourceHash: 10463431afdfaea5
title: API REST
sidebar_label: API REST
description: Endpoint API REST generati automaticamente per ogni collection, con filtraggio, ordinamento, paginazione e inclusione di relazioni.
---

## Panoramica

Rebase genera automaticamente un'API completa a partire dalle definizioni delle tue collection:

- **API REST** — Endpoint CRUD per ogni collection su `/api/data/:slug`
- **Specifica OpenAPI** — Specifica machine-readable su `/api/docs`
- **Swagger UI** — Explorer interattivo dell'API su `/api/swagger` (solo in modalità di sviluppo)

Nessun codice richiesto: definisci le tue collection e l'API apparirà automaticamente.

## Endpoint REST

Per ogni collection, vengono generati i seguenti endpoint. Tutte le altre route montate dal backend — auth, storage, admin, meta — si trovano nell'[indice degli endpoint](/docs/backend/endpoints/).

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Elenca le entità |
| `GET` | `/api/data/:slug/count` | Conta le entità |
| `GET` | `/api/data/:slug/aggregate` | `count()`, `sum()`, `avg()`, `min()`, `max()`, opzionalmente raggruppati. Accetta gli stessi filtri dell'endpoint di elenco e l'RLS si applica alle righe aggregate — vedi [Querying](/docs/sdk/querying/) |
| `GET` | `/api/data/:slug/:id` | Recupera una singola entità |
| `POST` | `/api/data/:slug` | Crea un record |
| `PATCH` | `/api/data/:slug/:id` | Aggiorna un record (parziale — vengono scritte solo le proprietà inviate) |
| `DELETE` | `/api/data/:slug/:id` | Elimina un record |
| `POST` | `/api/data/:slug/bulk` | Crea più entità in un'unica transazione |
| `PATCH` | `/api/data/:slug/bulk` | Aggiorna più entità in un'unica transazione |
| `POST` | `/api/data/:slug/bulk/delete` | Elimina più entità in un'unica transazione |
| `POST` | `/api/data/_batch` | Scrivi **tra diverse** collection in un'unica transazione |

### Route delle subcollection

Le relazioni nidificate sono accessibili tramite percorsi URL:

```
GET    /api/data/authors/42/posts         → list author's posts
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Meccanica di routing e analisi dei segmenti

Per gestire profondità arbitrarie di subcollection nidificate, Rebase instrada le richieste in arrivo utilizzando la regex del parametro `:rest{.+}` di Hono. Il motore interno di analisi dei segmenti analizza i percorsi contando i segmenti separati da barre:
- **Numero dispari di segmenti** (es. `authors/42/posts` -> 3 segmenti) rappresenta una richiesta di elenco di collection.
- **Numero pari di segmenti** (es. `authors/42/posts/7` -> 4 segmenti) rappresenta un'operazione su un ID entità specifico. L'ultimo segmento viene estratto come `entityId` di destinazione.

Il motore esclude i namespace di sistema riservati (es. `history`) dall'analisi dei segmenti di percorso per evitare collisioni con gli endpoint integrati.

## Autenticazione

Tutti gli endpoint di dati richiedono l'autenticazione per impostazione predefinita. Includi un token Bearer nell'header `Authorization`:

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

Per le chiamate server-to-server, utilizza la service key:

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
|----------|---------|---------|
| `eq` | Uguale a (`==`) | `?active=eq.true` |
| `neq` | Diverso da (`!=`) | `?status=neq.draft` |
| `gt` | Maggiore di (`>`) | `?price=gt.100` |
| `gte` | Maggiore o uguale a (`>=`) | `?price=gte.100` |
| `lt` | Minore di (`<`) | `?price=lt.50` |
| `lte` | Minore o uguale a (`<=`) | `?price=lte.50` |
| `in` | Nell'array | `?status=in.(a,b,c)` |
| `nin` | Non nell'array | `?status=nin.(a,b)` |
| `cs` | L'array contiene | `?tags=cs.value` |
| `csa` | L'array contiene qualsiasi valore | `?tags=csa.(a,b)` |
| `like` | Corrispondenza di pattern, case-sensitive (`like`) | `?sku=like.AB-%` |
| `ilike` | Corrispondenza di pattern, case-insensitive (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | Non corrisponde al pattern (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | Non corrisponde al pattern, case-insensitive (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | La colonna è `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | La colonna non è `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

`isnull` e `notnull` ignorano il proprio valore — l'operatore costituisce l'intera condizione e qualsiasi cosa dopo il punto viene scartata. L'SDK scrive `.null`, quindi questa è la forma che vedrai passare sulla rete.

:::caution[`eq.null` è la stringa di quattro caratteri, non `IS NULL`]
`?deleted_at=eq.null` cerca il testo letterale `null`. In SQL `= NULL` non è mai vero, quindi non esiste alcuna interpretazione di `eq.null` che possa equivalere al test per null — usa `isnull` a tale scopo. L'SDK serializza `.where("deleted_at", "==", null)` come `isnull.null` proprio per questa ragione.
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

`not` nega la **congiunzione** delle sue condizioni: `not(a)` è `NOT a`, e `not(a,b)` è `NOT (a AND b)`. Viene compilato in un vero `NOT (...)` SQL anziché in operatori invertiti — l'SQL è a logica ternaria (three-valued), quindi `NOT (a AND b)` e `(NOT a) OR (NOT b)` smettono di coincidere non appena è coinvolto un NULL. Una negazione quindi **include le righe la cui colonna è NULL**, che è il significato di `NOT`; aggiungi un `notnull` in AND se questo non è ciò che desideri.

**Un gruppo per richiesta: `or` ha la precedenza su `and`, ed entrambi su `not`.** Sono tre varianti sintattiche dello stesso slot, non tre filtri distinti. Usa invece l'annidamento:

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

I gruppi possono essere annidati fino a 32 livelli di profondità; oltre questo limite la richiesta viene rifiutata con `INVALID_LOGICAL_GROUP`.

Un gruppo **restringe** i risultati insieme ai filtri di campo anziché sostituirli — vedi [Come si combinano i filtri](#how-the-filters-combine).

### Il dialetto JSON `where`

I filtri di campo sopra descritti sono uno dei due modi per inviare un filtro. L'altro è un singolo oggetto JSON, che è ciò che il documento OpenAPI pubblica su ogni `GET /api/data/{slug}` e ciò che accettano le route delle subcollection nidificate:

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Ogni chiave è un campo, ogni valore è una tupla canonica `[operatore, valore]` — le stesse tuple scritte dall'SDK. Un valore può anche essere una stringa con punto pre-serializzata (`{"status":"eq.active"}`) o uno scalare semplice (`{"status":"active"}`); tutte e tre le forme compilano nella stessa condizione.

La differenza importante da conoscere: **il JSON mantiene i tipi.** `?price=gte.100` invia la stringa `"100"` e il driver ne esegue il cast in base al tipo di colonna, mentre `?where={"price":[">=",100]}` invia un numero. Per una colonna le cui interpretazioni testuali e numeriche differiscono — una stringa di versione, un codice con zeri iniziali — questo è il parametro da utilizzare.

Un parametro `where` non valido restituisce un errore 400 `INVALID_WHERE`, senza ignorare silenziosamente il filtro: ignorarlo eseguirebbe la lettura senza filtri restituendo tutto ciò che la row-level security consente.

### Come si combinano i filtri

`?field=op.value`, `?where=`, `?or=`/`?and=` e `?searchString=` sono indipendenti e ciascuno di essi, se presente, deve essere soddisfatto:

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

Non è possibile applicare un OR tra questi gruppi. Tutto ciò che non è un semplice AND di questi elementi deve essere inserito all'interno di un unico albero `or=`/`and=`.

## Ordinamento

Usa `orderBy` con il formato `field:direction`:

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

Una direzione omessa è considerata `asc`. Una direzione che non è né `asc` né `desc`, oppure un campo non presente nella collection, restituisce un errore **400** — non un 200 con le righe nell'ordine casuale scelto dal database, che sarebbe indistinguibile da un ordinamento riuscito.

### Più chiavi

La forma abbreviata accetta una sola chiave. Per usarne più di una, passa un array JSON — la seconda chiave discrimina le righe per cui la prima risulta uguale:

```bash
# By category, and newest first within each category
GET /api/data/products?orderBy=[{"field":"category"},{"field":"createdAt","direction":"desc"}]
```

Entrambe le sintassi sono supportate su tutte le route che elencano righe, incluse quelle nidificate (`/api/data/authors/:id/posts`). Ogni ordinamento termina con l'id di riga decrescente, indipendentemente dal fatto che sia stato richiesto o meno: questo è ciò che rende l'ordinamento totale, e la paginazione su un ordine non totale causerebbe duplicati o salti di righe.

Un parametro `?orderBy=` ripetuto non costituisce un ordinamento a più chiavi: l'ultimo prevale, come accade per qualsiasi altro parametro di query. Usa l'array.

### Dove vengono posizionati i valori NULL

Per impostazione predefinita, i valori NULL vengono ordinati **per ultimi in ordine crescente e per primi in ordine decrescente**, secondo la convenzione nativa di Postgres. Un terzo segmento separato da due punti permette di specificare diversamente:

```bash
# Newest first, with the undated rows at the end rather than the top
GET /api/data/posts?orderBy=publishedAt:desc:last
```

La forma in array JSON accetta una chiave `"nulls"` per ottenere lo stesso risultato:

```bash
GET /api/data/posts?orderBy=[{"field":"publishedAt","direction":"desc","nulls":"last"}]
```

Qualsiasi valore diverso da `first` o `last` restituisce un 400, anziché applicare un ordine silenziosamente diverso. Il cursore descritto di seguito rispetta quanto dichiarato dall'ordinamento, garantendo che la paginazione su una chiave nullable rimanga corretta con entrambe le disposizioni.

## Paginazione

Usa `limit` e `offset`, oppure `page`:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

Il limite predefinito è **50**, il massimo è **1000**. Entrambi derivano da `DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, riportati anche dalla specifica OpenAPI generata — un valore di `limit` superiore al massimo viene rifiutato anziché ridotto al limite.

Tutti e tre i parametri di intervallo vengono rifiutati anziché corretti automaticamente, e ciascuno restituisce il proprio errore specifico: `INVALID_LIMIT`, `INVALID_OFFSET` (un numero intero maggiore o uguale a 0) e `INVALID_PAGE` (un numero intero maggiore o uguale a 1). Un intervallo silenziosamente diverso da quello richiesto non potrebbe essere distinto dal raggiungimento della fine della collection, motivo per cui nessuno di essi viene modificato o ignorato.

### Paginazione basata su cursore

`offset` riconta le righe a ogni richiesta; pertanto, una riga inserita o eliminata tra due pagine sposta l'intervallo e la navigazione salta o ripete silenziosamente delle righe. `?after=` esegue invece una ricerca diretta: la pagina successiva inizia tassativamente dopo l'ultima riga restituita.

Ogni risposta di elenco include `meta.nextCursor` finché è presente una pagina successiva. Invialo nuovamente invariato:

```bash
GET /api/data/orders?orderBy=createdAt:desc&limit=100
# → meta.nextCursor = "eyJrIjpbWyJjcmVhdGVkX2F0Iiw…"

GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJjcmVhdGVkX2F0Iiw…
```

Il cursore è **opaco** — codifica le chiavi di ordinamento *e* i valori dell'ultima riga per tali chiavi — di conseguenza valgono tre regole, ciascuna delle quali restituisce un 400 anziché una pagina errata:

| Situazione | Codice |
|-----------|------|
| `after` con `offset` o `page` | `CURSOR_WITH_OFFSET` — entrambi specificano dove inizia la pagina |
| `after` con un `orderBy` diverso da quello con cui è stato emesso | `CURSOR_ORDER_MISMATCH` |
| Un cursore non emesso da questa API | `INVALID_CURSOR` |

Una richiesta che non specifica `orderBy` **adotta quello del cursore**, pertanto passare nuovamente `meta.nextCursor` senza ridefinire l'ordinamento funziona correttamente.

Gli ordinamenti a più chiavi e le chiavi nullable gestiscono entrambi la paginazione correttamente: il confronto viene costruito su ciascuna chiave in ordine, rispettando il posizionamento dei NULL dichiarato nell'ordinamento. L'unico ordinamento che nessun cursore può descrivere è la rilevanza (`_score`) — calcolata per query e non memorizzata — e tale elenco semplicemente non conterrà alcun `nextCursor`.

## Selezione delle colonne

`?fields=` limita la lettura alle colonne specificate. Si tratta di una proiezione integrata direttamente nella query, non di un semplice ritaglio della risposta:

```bash
GET /api/data/posts?fields=id,title&limit=50
```

La chiave primaria viene sempre restituita (una riga non indirizzabile non può essere aggiornata, eliminata o superata con la paginazione — e il cursore viene derivato da essa), e le colonne `excludeFromApi` rimangono nascoste indipendentemente dal fatto che vengano specificate o meno. Una colonna sconosciuta restituisce un 400 `UNKNOWN_FIELD` anziché una riga priva del campo in modo silenzioso.

`?distinct=true` raggruppa le righe identiche rispetto a tali colonne:

```bash
# The statuses actually in use
GET /api/data/posts?fields=status&distinct=true
```

Viene rifiutato (400) se combinato con una `searchString` ordinata per rilevanza o con una ricerca vettoriale, che associano un punteggio per riga rendendo ogni riga distinta per definizione, e quando `orderBy` include una colonna non restituita da `fields` (`DISTINCT_ORDER_BY_NOT_SELECTED`) — Postgres non può ordinare una lettura DISTINCT in base a un'espressione esterna alla lista di selezione.

`?fields=` e `?distinct=` funzionano anche sulla route get-by-id e sulle route delle subcollection nidificate.

### Formato della risposta

Le risposte per gli elenchi includono i metadati di paginazione:

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

Le risposte per singole entità restituiscono un oggetto semplice:

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "createdAt": "2026-01-15T10:30:00Z"
}
```

## Errori

Ogni errore, da qualsiasi route, viene restituito in una struttura standard:

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

`message` e `code` sono sempre presenti. `details` compare quando il rifiuto riguarda un elemento specifico — il campo non valido, i percorsi falliti. `requestId` compare quando la richiesta conteneva un header `X-Request-ID` o ne è stato assegnato uno; viene riportato anche nell'header di risposta ed è l'elemento da citare nelle segnalazioni di bug.

**Effettua i controlli condizionali su `code`, mai su `message` o solo sullo status HTTP.** I codici sono in `SCREAMING_SNAKE_CASE` e stabili; i messaggi sono scritti per una persona che legge una console e possono cambiare. Lo status HTTP si trova nella risposta, non nel corpo.

| Stato | Codice tipico | Significato |
|--------|--------------|-------|
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR`, `INVALID_LIMIT`, `INVALID_OFFSET`, `INVALID_PAGE` | La richiesta è malformata o richiede un'operazione impossibile |
| 401 | `UNAUTHORIZED` | Nessuna credenziale fornita o credenziale non identificabile |
| 403 | `FORBIDDEN`, `DB_PERMISSION_DENIED` | Credenziale valida ma priva dei permessi necessari |
| 404 | `NOT_FOUND` | La risorsa richiesta non esiste |
| 409 | `CONFLICT` | Conflitto di stato — chiave duplicata, albero modificato |
| 501 | varia | La funzionalità esiste ma **non è configurata** in questo deployment |
| 503 | `SERVICE_UNAVAILABLE` | Una dipendenza non è disponibile; la richiesta non l'ha mai raggiunta |

Una funzionalità non disponibile perché non abilitata in questo deployment restituisce 501 con un codice e una motivazione, non 404 — un 404 inspiegato su una route appena invocata dall'interfaccia utente verrebbe interpretato come un deploy non funzionante.

Le route aggiungono codici più specifici a questi (`EMAIL_EXISTS`, `TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, …), quindi considera l'elenco dei codici come aperto. L'SDK client converte tutti gli errori in un unico `RebaseApiError` contenente `status`, `code` e `details` — vedi [Gestione degli errori](/docs/backend#error-handling).

## Ricerca testuale

Usa `searchString` per la ricerca full-text nei campi stringa:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Ricerca vettoriale

Se una collection definisce una proprietà di tipo `vector`, puoi eseguire ricerche di similarità ad alta velocità utilizzando le operazioni di distanza pgvector compilate direttamente nella query del database.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

### Parametri di query vettoriale

| Parametro | Tipo | Descrizione |
|-----------|------|-------------|
| `vector_search` | `string` | Il nome della proprietà vettoriale su cui eseguire la query. |
| `vector` | `string` | Un array serializzato in JSON di numeri a virgola mobile che rappresenta il vettore di query. |
| `vector_distance` | `string` | La metrica di distanza da valutare. Valori supportati: `cosine` (predefinito, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Soglia di distanza massima. Vengono restituiti solo i record con distanza inferiore a questa soglia. |

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

Un nome che non corrisponde a una relazione della collection restituisce un errore **400 `UNKNOWN_RELATION`**, a qualsiasi livello. In precedenza veniva ignorato restituendo 200 con il campo semplicemente mancante — indistinguibile da una riga che non ha realmente alcuna riga correlata, facendo sembrare un refuso un semplice dato vuoto. Un percorso più profondo di tre passaggi restituisce `INCLUDE_TOO_DEEP`.

### Limitare una relazione

La forma separata da virgole non consente di specificare un `limit` per singola relazione, pertanto `include` accetta anche JSON — distinguibile dalla parentesi graffa iniziale:

```bash
GET /api/data/posts?include={"comments":{"limit":5,"where":{"published":["==",true]},"orderBy":"createdAt:desc","fields":["id","body"],"include":{"author":true}}}
```

| Chiave | Significato |
|-----|---------|
| `limit` | Righe **per riga genitore**, non per l'intera pagina |
| `where` | Lo stesso dialetto di filtro utilizzato dal parametro `where` di primo livello |
| `logical` | Un gruppo `or`/`and`/`not` sulle righe correlate |
| `orderBy` | La stessa sintassi di ordinamento, inclusa la gestione dei NULL |
| `fields` | Colonne della riga *correlata*; la sua chiave viene sempre mantenuta |
| `include` | Relazioni della riga correlata, a loro volta |

`true` significa "caricala per intero", quindi `{"author":true}` e `author` rappresentano la stessa richiesta. Entrambe le sintassi funzionano sulla route di elenco, sulla route get-by-id e sulle route delle subcollection nidificate.

Ogni passaggio corrisponde a un'unica query in batch per l'intera pagina, mai una per riga.

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

Chiavi di idempotenza, scritture condizionali (`ETag` / `If-Match`), operazioni sui campi (`$inc`, `$push`, `$pull`, `$merge`), upsert su una chiave naturale, `Prefer: return=minimal` e l'endpoint cross-collection `POST /api/data/_batch` sono trattati in una pagina dedicata: **[Scrittura tramite REST](/docs/backend/writes/)**.

## Pipeline degli hook del ciclo di vita

Ogni operazione di mutazione REST (`POST`, `PATCH`, `DELETE`) attraversa una pipeline di esecuzione degli hook rigorosa e sequenziale:

```
Request ──► beforeSave/beforeDelete (blocking) ──► DB Operation ──► afterSave/afterDelete (deferred) ──► Response
```

### Hook bloccanti vs. differiti

1. **Hook bloccanti (`beforeSave`, `beforeDelete`)**
   Questi hook vengono eseguiti in modo sincrono nel ciclo principale della richiesta *prima* di effettuare il commit della transazione nel database. Possono modificare i payload in ingresso, eseguire validazioni personalizzate o interrompere completamente la richiesta generando un errore.

2. **Hook differiti (`afterSave`, `afterDelete`)**
   Questi hook vengono eseguiti in modo asincrono dopo che la transazione nel database è stata completata con successo. Utilizzano promise differite (fire-and-forget), il che significa che vengono eseguiti in background e non bloccano la risposta HTTP del client. Ideali per l'invio di webhook, l'attivazione di notifiche push o l'accodamento di task esterni.


## Endpoint di sistema

| Metodo | Percorso | Autenticazione | Descrizione |
|--------|------|------|-------------|
| `GET` | `/health` and `/api/health` | nessuna | Controllo di liveness/readiness |
| `GET` | `/api/docs` | nessuna | Specifica JSON OpenAPI 3.0 |
| `GET` | `/api/swagger` | nessuna | Swagger UI. Attivo in sviluppo, disattivato in produzione; `REBASE_ENABLE_SWAGGER` sovrascrive l'impostazione in entrambi i casi |
| `GET` | `/api/meta/schema-version` | nessuna | L'hash dello schema da cui è stato compilato questo backend — deliberatamente non autenticato, restituisce solo tale hash |
| `GET` | `/api/meta/contract` | admin, service key o API key admin | Il contratto completo delle collection, per `rebase generate-sdk --from`. Fail-closed: `404` quando non è configurata alcuna autenticazione |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` se impostato | Metriche di Prometheus, quando `REBASE_METRICS=true` |

## OpenAPI / Swagger

La specifica OpenAPI viene generata automaticamente dalle definizioni delle collection: descrive gli endpoint di elenco, lettura, creazione, aggiornamento, eliminazione e bulk di ogni collection servita dal backend, con i relativi parametri di query e schemi di risposta. Non costituisce una mappa completa dell'intera superficie HTTP — le route di auth, storage, functions e cron sono documentate esclusivamente su questo sito — e le colonne contrassegnate con `excludeFromApi` ne vengono escluse.

I client automatizzati si autenticano con una chiave con ambito limitato anziché con una sessione: [Chiavi API](/docs/backend/api-keys/).

## Metadati dello schema

Lo schema completo delle collection del progetto — ogni collection, proprietà e relazione — viene fornito a un amministratore autenticato:

```bash
GET /api/meta/contract
```

È **riservato agli amministratori** e in un deployment senza autenticazione configurata non viene fornito affatto (404 `CONTRACT_UNAVAILABLE`) per evitare di esporre lo schema pubblicamente. L'endpoint correlato restituisce una stringa di versione che rappresenta lo schema senza descriverlo, ed è deliberatamente accessibile senza credenziali — ed è ciò che viene interrogato da un job di CI:

```bash
GET /api/meta/schema-version
```

Per la struttura degli endpoint anziché per lo schema sottostante, il documento OpenAPI è disponibile su `GET /api/docs`, con la Swagger UI su `/api/swagger` quando `enableSwagger` è abilitato.

## Passaggi successivi

- **[Client SDK](/docs/sdk)** — Client con tipizzazione statica per l'API REST
- **[Collection](/docs/collections)** — Definisci lo schema dei tuoi dati
- **[Regole di sicurezza (RLS)](/docs/collections/security-rules)** — Controlla l'accesso a livello di riga

---
