---
sourceHash: 63a33a92e55310ba
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
| `POST` | `/api/data/:slug/query` | <span class="since-badge" data-since="0.25">Da 0.25</span> Lo stesso elenco, con i parametri di query in un body JSON — per una query troppo lunga per un URL. Vedi [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
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
POST   /api/data/authors/42/posts/query   → the same listing, parameters in the body (0.24+)
POST   /api/data/authors/42/posts/count   → the same count, parameters in the body (0.24+)
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

Il filtraggio di una lista — operatori `?field=op.value`, gruppi `or`/`and`, il dialetto JSON `where` e come si combinano — ha [una pagina dedicata](/docs/backend/filtering).

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

Usa `limit` e `offset`, oppure `page` — l'uno o l'altro:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

Il limite predefinito è **50**, il massimo è **1000**. Entrambi provengono da `DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, valori riportati anche nella specifica OpenAPI generata — un `limit` superiore al massimo viene rifiutato anziché ridotto al limite (clamped).

Tutti e tre i parametri della finestra vengono rifiutati anziché corretti automaticamente, e ciascuno specifica il proprio codice: `INVALID_LIMIT`, `INVALID_OFFSET` (un numero intero maggiore o uguale a 0) e `INVALID_PAGE` (un numero intero maggiore o uguale a 1). Una finestra silenziosamente diversa da quella richiesta non potrebbe essere distinta dal raggiungimento della fine della collection, motivo per cui nessuno di essi viene limitato o ignorato.

<span class="since-badge" data-since="0.25">Da 0.25</span> Per lo stesso motivo `page` e `offset` insieme sono un 400
`PAGE_WITH_OFFSET`, anziché lasciare che uno dei due prevalga in silenzio.

### Saltare il conteggio

<span class="since-badge" data-since="0.25">Da 0.25</span> `meta.total` è un `COUNT(*)` su ogni riga corrispondente — su una tabella grande, la maggior parte di
ciò che costa una richiesta di elenco. `?count=none` (`GET /api/data/orders?count=none`) lo salta:
niente `meta.total`, mentre `meta.hasMore` resta esatto (la lettura chiede una riga oltre la pagina).
`?count=exact` è il valore predefinito; qualsiasi altro valore è un 400 `INVALID_COUNT`. Una lettura
con `?distinct=true` non viene mai conteggiata, e nemmeno una ricerca vettoriale con
un `vector_threshold` (vedi [Ricerca vettoriale](/docs/backend/vector-search/)).

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

Una relazione indicata in `?include=` viene restituita indipendentemente dal fatto che sia indicata anche in `?fields=`: `?include=author&fields=title` restituisce `title`, la chiave e `author`. Indicare la relazione anche in `?fields=` è consentito e non cambia nulla.

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

Le route aggiungono i propri codici più specifici oltre a questi (`EMAIL_EXISTS`, `TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, …), quindi considera l'elenco dei codici come aperto. L'SDK tipizzato converte tutti gli errori in un unico `RebaseApiError` contenente `status`, `code` e `details` — vedi [Error handling](/docs/backend#error-handling).

## Ricerca testuale

Usa `searchString` per la ricerca full-text nei campi stringa:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Ricerca vettoriale

Una collection con una proprietà `vector` accetta una ricerca del vicino più prossimo
sull'elenco: `?vector_search=embedding&vector=[0.15,0.22,-0.05]`, con `vector_distance`
e `vector_threshold` opzionali. I parametri, le soglie e il comportamento dei filtri
sull'indice sono in [Ricerca vettoriale](/docs/backend/vector-search/).

## Query troppo lunghe per un URL

<span class="since-badge" data-since="0.25">Da 0.25</span> `POST /api/data/:slug/query` (questo elenco) e `POST /api/data/:slug/count`
accettano i parametri di query in un body JSON, per una query il cui URL non ci starebbe — un embedding, una lunga lista `in`.
Vedi [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url).

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
| `limit` | Righe **per riga genitore**, non sull'intera pagina. Applicato dalla query, quindi le righe oltre il limite non vengono mai lette dal database |
| `where` | Lo stesso dialetto di filtro utilizzato dal `where` di primo livello |
| `logical` | Un gruppo `or`/`and`/`not` sulle righe correlate |
| `orderBy` | La stessa sintassi di ordinamento, inclusa la posizione dei valori NULL. Gli ex aequo, e un `limit` senza `orderBy`, seguono la chiave della riga correlata, in ordine crescente |
| `fields` | Colonne della riga *correlata*; la sua chiave viene sempre preservata |
| `include` | A sua volta, relazioni della riga correlata |
| `count` | <span class="since-badge" data-since="0.25">Da 0.25</span> `true` restituisce anche il totale di ciascun genitore sotto `_count` (`"_count":{"comments":37}`), contato dalla stessa istruzione. Solo relazioni to-many. Vedi [Contare ciò che un limite lascia fuori](/docs/sdk/relations#counting-what-a-limit-leaves-out) |

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
        "email": "jane@example.com",
        "companyId": 7
    }
}
```

Una riga inclusa è ciò che serve la route del suo target (`GET /api/data/authors/42`): le stesse colonne e le
stesse codifiche, chiavi esterne come colonne, nessun oggetto di riferimento.

## Scrittura

Chiavi di idempotenza, scritture condizionali (`ETag` / `If-Match`), operazioni sui campi (`$inc`, `$push`, `$pull`, `$merge`), upsert su chiave naturale, `Prefer: return=minimal` e l'endpoint multi-collection `POST /api/data/_batch` sono tutti trattati in una pagina dedicata: **[Writing over REST](/docs/backend/writes/)**.

## Pipeline degli hook del ciclo di vita

Su Postgres, ogni mutazione REST (`POST`, `PATCH`, `DELETE`) esegue in ordine i callback della sua collezione, dentro l'unica transazione che porta la scrittura:

```
Request ──► BEGIN ──► beforeSave/beforeDelete ──► DB operation ──► afterSave/afterDelete ──► COMMIT ──► Response
```

Ogni hook viene atteso, e un errore lanciato da uno qualsiasi di essi annulla l'intera scrittura:

1. **`beforeSave`, `beforeDelete`** vengono eseguiti prima della scrittura. Possono modificare i valori in ingresso, validare o rifiutare la richiesta lanciando un errore: il chiamante riceve **400 `CALLBACK_REJECTED`** e non viene scritto nulla.
2. **`afterSave`, `afterDelete`** vengono eseguiti dopo la scrittura ma *prima* del commit. Un errore annulla la riga e risponde con lo stesso 400, con `details.stage` che indica l'hook. Tengono aperta la transazione mentre sono in esecuzione, quindi non sono il posto per un webhook o per qualsiasi altra chiamata di rete: [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) spiega dove va quel lavoro.

## Endpoint di sistema

| Metodo | Percorso | Autenticazione | Descrizione |
|--------|----------|----------------|-------------|
| `GET` | `/health` and `/api/health` | nessuna | Verifica di liveness/readiness |
| `GET` | `/api/docs` | nessuna | La specifica JSON di OpenAPI 3.0 |
| `GET` | `/api/swagger` | nessuna | Swagger UI. Attivo in fase di sviluppo, disattivato in produzione; `REBASE_ENABLE_SWAGGER` ne sovrascrive lo stato in entrambi i casi |
| `GET` | `/api/meta/schema-version` | nessuna | L'hash dello schema da cui è stato compilato questo backend — deliberatamente non autenticato, restituisce solo tale hash |
| `GET` | `/api/meta/contract` | `schema:read`: un admin, la service key o una API key che lo possiede | Il contratto completo delle collection, per `rebase generate-sdk --from`. Fail-closed: `404` se non è configurata alcuna autenticazione |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` quando impostato | Metriche di Prometheus, se `REBASE_METRICS=true` |

## OpenAPI / Swagger

La specifica OpenAPI viene generata automaticamente a partire dalle definizioni delle tue collection: descrive gli endpoint di elenco, lettura, creazione, aggiornamento, eliminazione e operazioni di massa (bulk) di ogni collection gestita dal backend, con i rispettivi parametri di query e schemi di risposta. Non costituisce una mappa completa dell'intera superficie HTTP — le route relative ad auth, storage, functions e cron sono documentate esclusivamente su questo sito — e le colonne contrassegnate con `excludeFromApi` ne vengono escluse.

Per una collection con [`softDelete`](/docs/collections/soft-delete/) la specifica indica
che un'eliminazione, singola o di massa, sposta la riga nel cestino, e documenta
`?hard=true` su entrambe le eliminazioni e `?deleted=include|only` sull'elenco, sulla lettura
singola, sul conteggio e sull'aggregazione. L'explorer API di Studio invia solo i
parametri che la specifica nomina, quindi è questo che gli permette di eliminare definitivamente una riga o di elencare il cestino.

I client automatizzati (machine callers) si autenticano mediante una chiave con permessi dedicati (scoped key) anziché tramite una sessione:
[API keys](/docs/backend/api-keys/).

## Metadati dello schema

Lo schema completo delle collection del progetto — ogni collection, proprietà e relazione — viene fornito a un amministratore autenticato:

```bash
GET /api/meta/contract
```

Richiede lo scope **`schema:read`**, che un amministratore possiede, e, su un deployment privo di autenticazione configurata, non viene restituito affatto (404 `CONTRACT_UNAVAILABLE`) anziché esporre lo schema pubblicamente. Il suo endpoint complementare restituisce una stringa di versione che identifica lo schema senza descriverlo ed è deliberatamente accessibile senza alcuna credenziale — ed è ciò su cui esegue il polling un job di CI:

```bash
GET /api/meta/schema-version
```

Per verificare la struttura degli endpoint anziché lo schema sottostante, il documento OpenAPI è disponibile su `GET /api/docs`, con la Swagger UI consultabile su `/api/swagger` quando `enableSwagger` è abilitato.

## Passaggi successivi

- **[SDK tipizzato](/docs/sdk)** — Client con tipizzazione statica per l'API REST
- **[Collections](/docs/collections)** — Definisci lo schema dei tuoi dati
- **[Security Rules (RLS)](/docs/collections/security-rules)** — Controlla l'accesso per singola riga
