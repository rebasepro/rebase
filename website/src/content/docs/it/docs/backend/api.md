---
sourceHash: b480967e0adbfeed
title: API REST
sidebar_label: API REST
description: Endpoint API REST generati automaticamente per ogni collection, con filtri, ordinamento, paginazione e inclusione delle relazioni.
---

## Panoramica

Rebase genera automaticamente un'API completa a partire dalle definizioni delle tue collection:

- **API REST** — Endpoint CRUD per ogni collection su `/api/data/:slug`
- **Specifica OpenAPI** — Specifica leggibile da macchina su `/api/docs`
- **Swagger UI** — Explorer interattivo delle API su `/api/swagger` (solo in modalità di sviluppo)

Non è richiesto alcun codice: definisci le tue collection e l'API apparirà automaticamente.

## Endpoint REST

Per ciascuna collection, vengono generati i seguenti endpoint. Tutte le altre route montate dal backend — autenticazione, archiviazione, amministrazione, metadati — sono indicate nell'[indice degli endpoint](/docs/backend/endpoints/).

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Elenca le entità |
| `GET` | `/api/data/:slug/count` | Conta le entità |
| `GET` | `/api/data/:slug/aggregate` | `count()`, `sum()`, `avg()`, `min()`, `max()`, opzionalmente raggruppati. Accetta gli stessi filtri dell'endpoint di elenco e le regole RLS si applicano alle righe aggregate — vedi [Querying](/docs/sdk/querying/) |
| `GET` | `/api/data/:slug/:id` | Recupera una singola entità |
| `POST` | `/api/data/:slug` | Crea un record |
| `PATCH` | `/api/data/:slug/:id` | Aggiorna un record (parziale — vengono scritte solo le proprietà inviate) |
| `DELETE` | `/api/data/:slug/:id` | Elimina un record |
| `POST` | `/api/data/:slug/bulk` | Crea più entità in una singola transazione |
| `PATCH` | `/api/data/:slug/bulk` | Aggiorna più entità in una singola transazione |
| `POST` | `/api/data/:slug/bulk/delete` | Elimina più entità in una singola transazione |
| `POST` | `/api/data/_batch` | Scrittura **tra più** collection in una singola transazione |

### Route di subcollection

Le relazioni nidificate sono accessibili tramite percorsi URL:

```
GET    /api/data/authors/42/posts         → list author's posts
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Meccaniche di routing e analisi dei segmenti

Per gestire livelli arbitrari di annidamento delle subcollection, Rebase instrada le richieste in entrata utilizzando la regex del parametro `:rest{.+}` di Hono. Il motore interno di analisi dei segmenti analizza i percorsi contando i segmenti separati da barre:
- Un **conteggio dispari dei segmenti** (es. `authors/42/posts` -> 3 segmenti) rappresenta una richiesta di elenco di una collection.
- Un **conteggio pari dei segmenti** (es. `authors/42/posts/7` -> 4 segmenti) rappresenta un'operazione su un ID di entità specifico. L'ultimo segmento viene estratto come `entityId` di destinazione.

Il motore esclude i namespace di sistema riservati (es. `history`) dall'analisi dei segmenti del percorso per prevenire collisioni con gli endpoint integrati.

## Autenticazione

Tutti gli endpoint di dati richiedono l'autenticazione per impostazione predefinita. Includi un token Bearer nell'header `Authorization`:

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

Per le chiamate server-to-server, usa la service key:

```bash
curl -H "Authorization: Bearer <service-key>" \
     https://api.example.com/api/data/products
```

## Filtri

Usa i parametri di query in stile PostgREST per filtrare i risultati. Il formato è `?field=operator.value`:

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
| `eq` | Uguale (`==`) | `?active=eq.true` |
| `neq` | Diverso (`!=`) | `?status=neq.draft` |
| `gt` | Maggiore di (`>`) | `?price=gt.100` |
| `gte` | Maggiore o uguale (`>=`) | `?price=gte.100` |
| `lt` | Minore di (`<`) | `?price=lt.50` |
| `lte` | Minore o uguale (`<=`) | `?price=lte.50` |
| `in` | Presente nell'array | `?status=in.(a,b,c)` |
| `nin` | Non presente nell'array | `?status=nin.(a,b)` |
| `cs` | L'array contiene | `?tags=cs.value` |
| `csa` | L'array contiene almeno uno | `?tags=csa.(a,b)` |
| `like` | Corrispondenza di pattern, sensibile alle maiuscole (`like`) | `?sku=like.AB-%` |
| `ilike` | Corrispondenza di pattern, insensibile alle maiuscole (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | Non corrisponde al pattern (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | Non corrisponde al pattern, senza distinzione maiuscole/minuscole (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | La colonna è `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | La colonna non è `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

`isnull` e `notnull` ignorano il rispettivo valore: l'operatore costituisce l'intera condizione e qualsiasi elemento dopo il punto viene scartato. L'SDK scrive `.null`, ed è quindi questa la sintassi che vedrai transitare sulla rete.

:::caution[`eq.null` è la stringa di quattro caratteri, non `IS NULL`]
`?deleted_at=eq.null` cerca il testo letterale `null`. In SQL `= NULL` non è mai vero, quindi non esiste alcuna interpretazione di `eq.null` che possa equivalere a una verifica di nullità: usa `isnull` a tale scopo. L'SDK serializza `.where("deleted_at", "==", null)` come `isnull.null` proprio per questo motivo.
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

`not` nega la **congiunzione** delle sue condizioni: `not(a)` corrisponde a `NOT a`, e `not(a,b)` corrisponde a `NOT (a AND b)`. Viene compilato in un vero `NOT (...)` di SQL anziché in operatori invertiti; poiché la logica SQL è a tre valori, `NOT (a AND b)` e `(NOT a) OR (NOT b)` smettono di coincidere non appena è coinvolto un valore NULL. Di conseguenza, una negazione **include le righe in cui la colonna è NULL**, coerentemente con il significato di `NOT`; specifica un `notnull` in AND al suo fianco se non è questo il comportamento desiderato.

**Un gruppo per richiesta: `or` ha la precedenza su `and`, ed entrambi su `not`.** Si tratta di tre sintassi per lo stesso slot, non di tre filtri distinti. Utilizza invece l'annidamento:

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

I gruppi possono essere annidati fino a 32 livelli di profondità; superato tale limite la richiesta viene rifiutata con `INVALID_LOGICAL_GROUP`.

Un gruppo **restringe** i risultati insieme ai filtri di campo anziché sostituirli — vedi [Come si combinano i filtri](#how-the-filters-combine).

### Il dialetto JSON `where`

I filtri di campo visti in precedenza sono uno dei due metodi disponibili per inviare un filtro. L'altro è un singolo oggetto JSON, ovvero il formato pubblicato dal documento OpenAPI per ogni `GET /api/data/{slug}` e accettato dalle route di subcollection nidificate:

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Ogni chiave rappresenta un campo, ogni valore una tupla canonica `[operatore, valore]` — le stesse tuple scritte dall'SDK. Un valore può anche essere una stringa con notazione a punti pre-serializzata (`{"status":"eq.active"}`) o un valore scalare semplice (`{"status":"active"}`); tutte e tre le forme vengono compilate nella medesima condizione.

La differenza fondamentale da considerare: **il JSON conserva i tipi.** `?price=gte.100` invia la stringa `"100"` e il driver ne esegue il cast in base al tipo di colonna, mentre `?where={"price":[">=",100]}` invia un numero. Per le colonne in cui l'interpretazione testuale e quella numerica differiscono (ad esempio una stringa di versione o un codice con zeri iniziali), questo è il parametro consigliato.

Un parametro `where` malformato restituisce un errore 400 `INVALID_WHERE` anziché un filtro ignorato silenziosamente: ignorarlo eseguirebbe la lettura senza filtri, restituendo tutto ciò che le regole di sicurezza a livello di riga consentono di visualizzare.

### Come si combinano i filtri

`?field=op.value`, `?where=`, `?or=`/`?and=` e `?searchString=` sono indipendenti, e ciascuno di essi, se presente, deve essere soddisfatto:

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

Non è possibile mettere in OR uno di questi elementi rispetto a un altro. Qualsiasi logica diversa da un semplice AND tra questi gruppi deve essere inserita all'interno di un singolo albero `or=`/`and=`.

## Ordinamento

Usa `orderBy` nel formato `field:direction`:

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

Se la direzione viene omessa, il valore predefinito è `asc`. Una direzione diversa da `asc` o `desc`, oppure un campo non presente nella collection, restituisce un errore **400** — non un 200 con le righe disposte nell'ordine casuale stabilito dal database, che risulterebbe indistinguibile da un ordinamento eseguito correttamente.

### Più chiavi

La forma sintetica accetta una sola chiave. Per specificarne di più, passa un array JSON: la seconda chiave viene utilizzata per dirimere le righe considerate equivalenti dalla prima:

```bash
# By category, and newest first within each category
GET /api/data/products?orderBy=[{"field":"category"},{"field":"createdAt","direction":"desc"}]
```

Entrambe le sintassi sono supportate su tutte le route che elencano righe, comprese quelle nidificate (`/api/data/authors/:id/posts`). Ogni ordinamento termina sempre con l'ID di riga decrescente, anche se non richiesto esplicitamente: ciò garantisce un ordinamento totale, evitando che la paginazione su un ordine parziale ripeta o salti righe.

La ripetizione del parametro `?orderBy=` non definisce un ordinamento a più chiavi: prevale sempre l'ultimo parametro specificato, come avviene per qualsiasi altro parametro di query. Utilizza l'array.

### Collocazione dei valori NULL

Per impostazione predefinita, i valori NULL vengono ordinati **per ultimi in ordine crescente e per primi in ordine decrescente**, conformemente al comportamento predefinito di Postgres. Un terzo segmento separato da due punti permette di sovrascrivere tale comportamento:

```bash
# Newest first, with the undated rows at the end rather than the top
GET /api/data/posts?orderBy=publishedAt:desc:last
```

La forma con array JSON accetta la chiave `"nulls"` per ottenere lo stesso risultato:

```bash
GET /api/data/posts?orderBy=[{"field":"publishedAt","direction":"desc","nulls":"last"}]
```

Qualsiasi valore diverso da `first` o `last` restituisce un errore 400, anziché applicare silenziosamente un ordine differente. Il cursore descritto di seguito rispetta le impostazioni dichiarate per l'ordinamento, garantendo una paginazione corretta su chiavi nullable in entrambi i casi.

## Paginazione

Usa `limit` e `offset`, oppure `page`:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

Il limite predefinito è **50**, il limite massimo è **1000**. Entrambi derivano da `DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, valori riportati anche nella specifica OpenAPI generata: un valore di `limit` superiore al massimo viene rifiutato anziché ridotto al limite.

Tutti e tre i parametri di intervallo vengono rifiutati anziché corretti automaticamente, e ciascuno specifica il proprio codice di errore: `INVALID_LIMIT`, `INVALID_OFFSET` (un numero intero maggiore o uguale a 0) e `INVALID_PAGE` (un numero intero maggiore o uguale a 1). Un intervallo silenziosamente diverso da quello richiesto sarebbe indistinguibile dal raggiungimento della fine della collection; per questo motivo nessuno di essi viene corretto o ignorato.

### Paginazione tramite cursore

`offset` riesegue il conteggio delle righe a ogni richiesta; pertanto, l'inserimento o l'eliminazione di una riga tra due richieste di pagina sposta la finestra di lettura, facendo saltare o ripetere silenziosamente delle righe. Al contrario, `?after=` esegue una ricerca indicizzata (seek): la pagina successiva inizia tassativamente dopo l'ultima riga restituita.

Ogni risposta di elenco contiene `meta.nextCursor` finché è presente una pagina successiva. È sufficiente reinviarlo invariato:

```bash
GET /api/data/orders?orderBy=createdAt:desc&limit=100
# → meta.nextCursor = "eyJrIjpbWyJjcmVhdGVkX2F0Iiw…"

GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJjcmVhdGVkX2F0Iiw…
```

Il cursore è **opaco** — codifica le chiavi di ordinamento *e* i valori corrispondenti dell'ultima riga — pertanto si applicano tre regole, ciascuna delle quali restituisce un errore 400 anziché una pagina non corretta:

| Situazione | Codice |
|-----------|------|
| `after` combinato con `offset` o `page` | `CURSOR_WITH_OFFSET` — entrambi definiscono il punto di inizio della pagina |
| `after` con un `orderBy` diverso da quello con cui è stato generato | `CURSOR_ORDER_MISMATCH` |
| Un cursore non generato da questa API | `INVALID_CURSOR` |

Una richiesta che non specifica `orderBy` **eredita quello del cursore**, per cui è possibile rinviare `meta.nextCursor` senza dover specificare nuovamente l'ordinamento.

Gli ordinamenti a più chiavi e su campi nullable vengono paginati correttamente: il confronto viene costruito su ciascuna chiave nell'ordine stabilito, rispettando la collocazione dei NULL dichiarata. L'unico tipo di ordinamento che nessun cursore può descrivere è quello per rilevanza (`_score`) — calcolato per singola query e non persistito — pertanto tali elenchi non forniscono alcun `nextCursor`.

## Selezione delle colonne

<span class="since-badge" data-since="0.20">Since 0.20</span>

`?fields=` limita la lettura alle sole colonne indicate. Si tratta di una proiezione applicata direttamente alla query, non di un semplice filtro sul payload di risposta:

```bash
GET /api/data/posts?fields=id,title&limit=50
```

La chiave primaria viene sempre restituita (una riga priva di identificatore non può essere aggiornata, eliminata o superata con la paginazione, ed è necessaria per ricavare il cursore), e le colonne con `excludeFromApi` rimangono escluse indipendentemente dal fatto che vengano richieste esplicitamente. Una colonna inesistente restituisce un errore 400 `UNKNOWN_FIELD` anziché una riga silenziosamente priva del campo.

`?distinct=true` raggruppa le righe identiche rispetto alle colonne selezionate:

```bash
# The statuses actually in use
GET /api/data/posts?fields=status&distinct=true
```

Viene rifiutato (400) se combinato con un `searchString` ordinato per rilevanza o con una ricerca vettoriale (i quali associano a ogni riga un punteggio che la rende intrinsecamente distinta), oppure quando `orderBy` include una colonna non presente in `fields` (`DISTINCT_ORDER_BY_NOT_SELECTED`) — Postgres non può infatti ordinare una lettura DISTINCT tramite un'espressione esclusa dalla clausola select.

`?fields=` e `?distinct=` sono supportati anche sulla route di lettura per ID e sulle route di subcollection nidificate.

### Formato della risposta

Le risposte agli elenchi includono i metadati di paginazione:

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

`nextCursor` è presente finché `hasMore` è true e la pagina ha restituito almeno una riga; è assente nell'ultima pagina e con tipologie di ordinamento non rappresentabili da un cursore.

Le risposte relative a una singola entità restituiscono un oggetto diretto:

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "createdAt": "2026-01-15T10:30:00Z"
}
```

## Errori

Tutti gli errori, provenienti da qualunque route, vengono restituiti all'interno di una struttura uniforme:

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

`message` e `code` sono sempre presenti. `details` compare quando l'errore è relativo a un contesto specifico (il campo errato, i percorsi non validi). `requestId` compare quando la richiesta conteneva l'header `X-Request-ID` o ne è stato generato uno; viene riportato anche nell'header della risposta ed è l'identificatore da fornire in caso di segnalazione di bug.

**Gestisci la logica dell'applicazione basandoti su `code`, mai su `message` o sul solo codice di stato HTTP.** I codici sono stabili e formattati in `SCREAMING_SNAKE_CASE`; i messaggi sono destinati alla lettura nei log di console e possono variare nel tempo. Lo status HTTP è specificato nell'header della risposta, non nel corpo.

| Stato | Codice tipico | Significato |
|--------|--------------|-------|
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR`, `INVALID_LIMIT`, `INVALID_OFFSET`, `INVALID_PAGE` | La richiesta è malformata o richiede un'operazione non valida |
| 401 | `UNAUTHORIZED` | Nessuna credenziale fornita o credenziale non valida |
| 403 | `FORBIDDEN`, `DB_PERMISSION_DENIED` | Credenziale valida ma priva dei permessi necessari |
| 404 | `NOT_FOUND` | La risorsa richiesta non esiste |
| 409 | `CONFLICT` | Conflitto di stato (chiave duplicata, stato non allineato) |
| 501 | variabile | La funzionalità esiste ma **non è configurata** in questa istanza |
| 503 | `SERVICE_UNAVAILABLE` | Una dipendenza non è raggiungibile; la richiesta non è stata elaborata |

Una funzionalità assente perché non abilitata nell'istanza corrente restituisce 501 con codice e motivazione, non 404: un errore 404 privo di spiegazioni su una route appena invocata dall'interfaccia utente risulterebbe fuorviante, suggerendo un problema di deployment.

Le singole route aggiungono codici più specifici a questi (`EMAIL_EXISTS`, `TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, ecc.), pertanto l'elenco dei codici è da considerarsi aperto. L'SDK client li converte in un unico errore `RebaseApiError` che espone `status`, `code` e `details` — vedi [Gestione degli errori](/docs/backend#error-handling).

## Ricerca testuale

Usa `searchString` per eseguire ricerche full-text sui campi di tipo stringa:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Ricerca vettoriale

Se una collection definisce una proprietà di tipo `vector`, puoi eseguire ricerche per similarità ad alte prestazioni utilizzando le operazioni di distanza di pgvector elaborate direttamente nella query del database.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

### Parametri di query vettoriale

| Parametro | Tipo | Descrizione |
|-----------|------|-------------|
| `vector_search` | `string` | Il nome della proprietà vettoriale su cui eseguire la query. |
| `vector` | `string` | Un array JSON serializzato di numeri decimali (float) che rappresenta il vettore di ricerca. |
| `vector_distance` | `string` | La metrica di distanza da calcolare. Valori supportati: `cosine` (predefinito, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
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

Un nome che non corrisponde a una relazione valida della collection restituisce un errore **400 `UNKNOWN_RELATION`** a qualsiasi livello di nidificazione. In passato tali valori venivano ignorati, restituendo un codice 200 privo del campo richiesto: questo comportamento rendeva un refuso indistinguibile da un record privo di relazioni associate. I percorsi che superano i tre livelli di nidificazione restituiscono `INCLUDE_TOO_DEEP`.

### Restringere una relazione

Il formato con valori separati da virgola non consente di specificare un `limit` per singola relazione; per questo motivo `include` accetta anche una struttura JSON, identificata dalla presenza della parentesi graffa iniziale:

```bash
GET /api/data/posts?include={"comments":{"limit":5,"where":{"published":["==",true]},"orderBy":"createdAt:desc","fields":["id","body"],"include":{"author":true}}}
```

| Chiave | Significato |
|-----|---------|
| `limit` | Righe **per ciascuna riga genitore**, non sul totale della pagina |
| `where` | Lo stesso dialetto di filtro utilizzato dal parametro `where` principale |
| `logical` | Un gruppo logico `or`/`and`/`not` applicato alle righe correlate |
| `orderBy` | La stessa sintassi di ordinamento, inclusa la collocazione dei valori NULL |
| `fields` | Colonne della riga *correlata*; la relativa chiave identificativa viene sempre inclusa |
| `include` | Ulteriori relazioni della riga correlata |

Il valore `true` indica di caricare la relazione per intero; pertanto `{"author":true}` e `author` producono la medesima richiesta. Entrambe le modalità sono supportate sulle route di elenco, sulle route di lettura per ID e sulle route di subcollection nidificate.

Ogni livello di relazione corrisponde a una singola query in batch per l'intera pagina, mai a una query per ciascuna riga.

Le relazioni incluse vengono incorporate direttamente all'interno della risposta:

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

Idempotency key, scritture condizionali (`ETag` / `If-Match`), operazioni sui campi (`$inc`, `$push`, `$pull`, `$merge`), operazioni di upsert su chiave naturale, l'header `Prefer: return=minimal` e l'endpoint per operazioni multi-collection `POST /api/data/_batch` sono documentati nella pagina dedicata: **[Scrittura tramite REST](/docs/backend/writes/)**.

## Pipeline degli hook del ciclo di vita

Tutte le operazioni REST di mutazione (`POST`, `PATCH`, `DELETE`) vengono elaborate attraverso una pipeline di esecuzione sequenziale e rigorosa degli hook:

```
Request ──► beforeSave/beforeDelete (blocking) ──► DB Operation ──► afterSave/afterDelete (deferred) ──► Response
```

### Hook bloccanti e hook differiti

1. **Hook bloccanti (`beforeSave`, `beforeDelete`)**
   Questi hook vengono eseguiti in maniera sincrona durante il ciclo principale della richiesta, *prima* dell'invio della transazione al database. Possono modificare i payload in entrata, eseguire logiche di convalida personalizzate o interrompere l'elaborazione della richiesta generando un errore.

2. **Hook differiti (`afterSave`, `afterDelete`)**
   Questi hook vengono eseguiti in modo asincrono una volta completata con successo la transazione sul database. Utilizzano promise differite (modalità fire-and-forget), vengono elaborati in background e non bloccano l'invio della risposta HTTP al client. Sono ideali per l'invio di webhook, la generazione di notifiche push o l'accodamento di processi verso servizi esterni.

## Endpoint di sistema

| Metodo | Percorso | Autenticazione | Descrizione |
|--------|------|------|-------------|
| `GET` | `/health` e `/api/health` | nessuna | Verifica dello stato del servizio (liveness/readiness check) |
| `GET` | `/api/docs` | nessuna | Specifica JSON OpenAPI 3.0 |
| `GET` | `/api/swagger` | nessuna | Swagger UI. Attiva in ambiente di sviluppo, disattivata in produzione; modificabile tramite `REBASE_ENABLE_SWAGGER` |
| `GET` | `/api/meta/schema-version` | nessuna | L'hash dello schema utilizzato per compilare questo backend — deliberatamente privo di autenticazione, restituisce esclusivamente tale hash |
| `GET` | `/api/meta/contract` | admin, service key o admin API key | La definizione completa dei contratti delle collection, utilizzata da `rebase generate-sdk --from`. Comportamento fail-closed: restituisce `404` quando non è configurata alcuna autenticazione |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` se definito | Metriche in formato Prometheus, abilitate se `REBASE_METRICS=true` |

## OpenAPI / Swagger

La specifica OpenAPI viene generata automaticamente a partire dalle definizioni delle tue collection: documenta gli endpoint di elenco, lettura, creazione, aggiornamento, eliminazione e operazioni bulk per ogni collection gestita dal backend, indicando i rispettivi parametri di query e gli schemi di risposta. Non costituisce una mappatura esaustiva dell'intera superficie HTTP — le route dedicate ad autenticazione, archiviazione, funzioni e cron job sono documentate esclusivamente su questo sito — e le colonne contrassegnate con `excludeFromApi` non vi vengono incluse.

I client automatizzati si autenticano tramite chiavi API dedicate con permessi specifici (scoped) anziché tramite sessioni:
[Chiavi API](/docs/backend/api-keys/).

## Metadati dello schema

Lo schema completo delle collection del progetto — comprendente ogni collection, proprietà e relazione — è accessibile per gli utenti amministratori autenticati:

```bash
GET /api/meta/contract
```

L'accesso è **riservato esclusivamente agli amministratori**; nei deployment in cui non è configurato alcun sistema di autenticazione l'endpoint non risponde (404 `CONTRACT_UNAVAILABLE`) per evitare l'esposizione non protetta dello schema. L'endpoint complementare restituisce invece una stringa di versione che identifica univocamente lo schema senza rivelarne la struttura, ed è liberamente accessibile senza credenziali — risultando ideale per verifiche automatizzate nelle pipeline di CI:

```bash
GET /api/meta/schema-version
```

Per consultare la struttura degli endpoint anziché lo schema dei dati sottostante, il documento OpenAPI è disponibile all'indirizzo `GET /api/docs`, mentre l'interfaccia Swagger UI è raggiungibile su `/api/swagger` qualora l'opzione `enableSwagger` sia abilitata.

## Passaggi successivi

- **[Client SDK](/docs/sdk)** — Client type-safe per l'API REST
- **[Collection](/docs/collections)** — Definisci lo schema dei tuoi dati
- **[Regole di sicurezza (RLS)](/docs/collections/security-rules)** — Configura il controllo degli accessi a livello di riga

---
