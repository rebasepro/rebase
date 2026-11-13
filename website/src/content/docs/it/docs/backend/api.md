---
sourceHash: 4fc45b4d1d08afde
title: REST API
sidebar_label: REST API
description: Endpoint API REST generati automaticamente per ogni tabella, con filtri, ordinamento, paginazione e inclusione delle relazioni.
---

## Panoramica

Rebase genera automaticamente un'API completa a partire dalle tue tabelle:

- **API REST** — Endpoint CRUD per ogni tabella su `/api/data/:slug`
- **Specifica OpenAPI** — Specifica machine-readable su `/api/docs`, servita a ogni chiamante autenticato per le tabelle che è autorizzato a visualizzare
- **Swagger UI** — Explorer interattivo delle API su `/api/swagger`, quando il documento viene pubblicato (`REBASE_ENABLE_SWAGGER=true`, al di fuori della produzione)

Non è richiesto alcun codice — [dichiara le tue tabelle](/docs/schema/) e l'API comparirà automaticamente.

## Endpoint REST

Per ogni tabella vengono generati i seguenti endpoint. Tutte le altre route montate dal backend — auth, storage, admin, meta — si trovano nell'[indice degli endpoint](/docs/backend/endpoints/).

| Metodo | Percorso | Descrizione |
|--------|----------|-------------|
| `GET` | `/api/data/:slug` | Elenca le entità |
| `POST` | `/api/data/:slug/query` | Lo stesso elenco con i parametri di query in un corpo JSON — per query troppo lunghe per un URL. Vedi [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | Conta le entità |
| `GET` | `/api/data/:slug/aggregate` | `count()`, `sum()`, `avg()`, `min()`, `max()`, opzionalmente raggruppati. Accetta gli stessi filtri dell'endpoint di elenco e la RLS si applica alle righe aggregate — vedi [Querying](/docs/sdk/querying/) |
| `GET` | `/api/data/:slug/:id` | Ottiene una singola entità |
| `POST` | `/api/data/:slug` | Crea un record |
| `PATCH` | `/api/data/:slug/:id` | Aggiorna un record (parziale — vengono scritte solo le proprietà inviate) |
| `DELETE` | `/api/data/:slug/:id` | Elimina un record |
| `POST` | `/api/data/:slug/bulk` | Crea molteplici entità in un'unica transazione |
| `PATCH` | `/api/data/:slug/bulk` | Aggiorna molteplici entità in un'unica transazione |
| `POST` | `/api/data/:slug/bulk/delete` | Elimina molteplici entità in un'unica transazione |
| `POST` | `/api/data/_batch` | Scrittura **tra** più tabelle in un'unica transazione |

### Route annidate

Le relazioni sono accessibili tramite percorsi URL:

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

Per gestire livelli di annidamento arbitrari, Rebase instrada le richieste in arrivo utilizzando la regex del parametro `:rest{.+}` di Hono. Il motore interno di parsing dei segmenti analizza i percorsi contando i segmenti separati da barre (`/`):
- **Conteggio dispari dei segmenti** (es. `authors/42/posts` -> 3 segmenti): rappresenta una richiesta di elenco sulla tabella correlata.
- **Conteggio pari dei segmenti** (es. `authors/42/posts/7` -> 4 segmenti): rappresenta un'operazione su uno specifico ID di riga. L'ultimo segmento viene estratto come ID di destinazione.

Il motore esclude i namespace di sistema riservati (es. `history`) dall'analisi dei segmenti di percorso per evitare collisioni con gli endpoint predefiniti.

## Autenticazione

Tutti gli endpoint di dati richiedono l'autenticazione per impostazione predefinita. Includi un token Bearer nell'header `Authorization`:

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

Per le chiamate server-to-server, usa la chiave di servizio (service key):

```bash
curl -H "Authorization: Bearer <service-key>" \
     https://api.example.com/api/data/products
```

Il filtraggio di un elenco — operatori `?field=op.value`, gruppi `or`/`and`, il dialetto JSON `where` e come combinarli — ha [la sua pagina dedicata](/docs/backend/filtering).

## Ordinamento

Usa `orderBy` con il formato `field:direction`:

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

Se la direzione viene omessa, il valore predefinito è `asc`. Una direzione che non sia né `asc` né `desc`, oppure un campo non presente nella tabella, restituirà un errore **400** — non un 200 con le righe disposte nell'ordine casuale scelto dal database, che risulterebbe indistinguibile da un ordinamento riuscito.

### Più chiavi

La notazione sintetica accetta una sola chiave. Per utilizzarne più di una, passa un array JSON — la seconda chiave risolverà i pareggi tra le righe considerate uguali dalla prima:

```bash
# By category, and newest first within each category
GET /api/data/products?orderBy=[{"field":"category"},{"field":"createdAt","direction":"desc"}]
```

Entrambe le sintassi sono valide per ogni route che restituisce elenchi di righe, comprese quelle annidate (`/api/data/authors/:id/posts`). Ogni ordinamento termina con l'ID di riga decrescente (`id desc`), indipendentemente dal fatto che sia stato richiesto o meno: questo garantisce un ordinamento totale, evitando che la paginazione su un ordinamento parziale ripeta o salti delle righe.

Un parametro `?orderBy=` ripetuto non equivale a un ordinamento a più chiavi — l'ultimo sovrascrive i precedenti, come accade per qualsiasi altro parametro di query. Utilizza l'array.

### Ordinamento dei valori NULL

Per impostazione predefinita, i valori NULL vengono ordinati **per ultimi in ordine crescente e per primi in ordine decrescente**, seguendo la convenzione nativa di Postgres. Un terzo segmento separato da due punti permette di modificare questo comportamento:

```bash
# Newest first, with the undated rows at the end rather than the top
GET /api/data/posts?orderBy=publishedAt:desc:last
```

La forma con array JSON accetta una chiave `"nulls"` per ottenere lo stesso risultato:

```bash
GET /api/data/posts?orderBy=[{"field":"publishedAt","direction":"desc","nulls":"last"}]
```

Qualsiasi valore diverso da `first` o `last` restituisce un errore 400, anziché applicare un ordine imprevisto. Il cursore descritto di seguito rispetta le direttive impostate per l'ordinamento, garantendo una paginazione corretta su chiavi con valori nulli in entrambe le configurazioni.

## Paginazione

Usa `limit` e `offset`, oppure `page` — l'uno o l'altro:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

Il limite predefinito è **50**, il massimo è **1000**. Entrambi derivano da `DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, documentati anche nella specifica OpenAPI generata — un valore di `limit` superiore al massimo viene rifiutato anziché essere ridotto al limite consentito.

Tutti e tre i parametri di delimitazione vengono rifiutati anziché corretti automaticamente, restituendo codici specifici: `INVALID_LIMIT`, `INVALID_OFFSET` (un numero intero maggiore o uguale a 0) e `INVALID_PAGE` (un numero intero maggiore o uguale a 1). Una finestra alterata silenziosamente rispetto a quella richiesta non sarebbe distinguibile dal raggiungimento della fine della tabella; per questo motivo nessun valore viene troncato o ignorato.

Per lo stesso motivo, l'uso combinato di `page` e `offset` restituisce un errore 400 `PAGE_WITH_OFFSET`, anziché dare priorità silenziosa a uno dei due.

### Escludere il conteggio

`meta.total` è un `COUNT(*)` su tutte le righe corrispondenti — su tabelle di grandi dimensioni rappresenta gran parte del costo computazionale di una richiesta di elenco. `?count=none` (`GET /api/data/orders?count=none`) lo esclude: `meta.total` non sarà presente, mentre `meta.hasMore` rimarrà esatto (la query richiede una riga in più rispetto alla pagina). `?count=exact` è il valore predefinito; qualsiasi altro valore restituisce un errore 400 `INVALID_COUNT`. Una lettura con `?distinct=true` non viene mai conteggiata, così come una ricerca vettoriale con `vector_threshold` (vedi [Ricerca vettoriale](/docs/backend/vector-search/)).

### Paginazione basata su cursore

`offset` ricalcola le righe a ogni richiesta; pertanto, l'inserimento o l'eliminazione di una riga tra due pagine sposta la finestra, provocando il salto o la duplicazione silenziosa di elementi. `?after=` adotta invece una logica di ricerca posizionale (seek): la pagina successiva inizia tassativamente dopo l'ultima riga restituita.

Ogni risposta di elenco include `meta.nextCursor` finché è disponibile una pagina successiva. È sufficiente reinviarlo invariato:

```bash
GET /api/data/orders?orderBy=createdAt:desc&limit=100
# → meta.nextCursor = "eyJrIjpbWyJjcmVhdGVkX2F0Iiw…"

GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJjcmVhdGVkX2F0Iiw…
```

Il cursore è **opaco** — codifica le chiavi di ordinamento *e* i rispettivi valori dell'ultima riga — da cui derivano tre regole che restituiscono un errore 400 anziché una pagina errata:

| Situazione | Codice |
|------------|--------|
| `after` con `offset` o `page` | `CURSOR_WITH_OFFSET` — entrambi specificano da dove inizia la pagina |
| `after` con un `orderBy` diverso da quello con cui è stato generato | `CURSOR_ORDER_MISMATCH` |
| Un cursore non generato da questa API | `INVALID_CURSOR` |

Una richiesta che non specifica alcun `orderBy` **adotta quello del cursore**, per cui reinviare `meta.nextCursor` senza dover ridefinire l'ordinamento funziona correttamente.

Sia gli ordinamenti a più chiavi che le chiavi con valori nulli vengono paginati correttamente: il confronto viene costruito su ciascuna chiave in sequenza, rispettando il posizionamento dei valori NULL dichiarato nell'ordinamento. L'unico ordinamento non descrivibile da un cursore è la pertinenza (`_score`) — calcolata per singola query e non persistita — pertanto tale elenco non includerà `nextCursor`.

## Selezione delle colonne

`?fields=` limita la lettura alle sole colonne specificate. Si tratta di una proiezione eseguita a livello di query nel database, non di un semplice ritaglio della risposta:

```bash
GET /api/data/posts?fields=id,title&limit=50
```

La chiave primaria viene sempre restituita (una riga non indirizzabile non può essere aggiornata, eliminata o superata con la paginazione — e il cursore è derivato da essa), mentre le colonne contrassegnate come `.private()` rimangono nascoste anche se esplicitamente richieste. Una colonna sconosciuta restituisce un errore 400 `UNKNOWN_FIELD` anziché una riga priva silenziosamente del campo richiesto.

Una relazione specificata in `?include=` viene restituita a prescindere che sia presente o meno in `?fields=`: `?include=author&fields=title` restituisce `title`, la chiave e `author`. Includere il nome della relazione anche in `?fields=` è consentito e non produce variazioni.

`?distinct=true` comprime le righe identiche in base a tali colonne:

```bash
# The statuses actually in use
GET /api/data/posts?fields=status&distinct=true
```

Viene rifiutato (400) se associato a un `searchString` con punteggio di pertinenza o a una ricerca vettoriale, poiché entrambi associano a ogni riga un punteggio che la rende distinta per definizione, oppure quando `orderBy` include una colonna non presente in `fields` (`DISTINCT_ORDER_BY_NOT_SELECTED`) — Postgres non può ordinare una lettura DISTINCT in base a un'espressione non inclusa nell'elenco di selezione.

`?fields=` e `?distinct=` funzionano anche sulla route di recupero per ID e sulle route annidate.

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

`nextCursor` è presente quando `hasMore` è true e la pagina ha restituito almeno una riga; è assente nell'ultima pagina e con ordinamenti che un cursore non può descrivere.

Le risposte per una singola entità restituiscono un oggetto piatto:

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "createdAt": "2026-01-15T10:30:00Z"
}
```

## Errori

Tutti gli errori, provenienti da qualsiasi route, vengono restituiti in una struttura unificata:

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

`message` e `code` sono sempre presenti. `details` compare quando il rifiuto riguarda un elemento specifico — il campo non valido, i percorsi falliti. `requestId` compare quando la richiesta conteneva un header `X-Request-ID` o ne è stato assegnato uno; viene riportato anche nell'header della risposta ed è il dato da indicare nelle segnalazioni di bug.

**Gestisci i casi d'errore basandoti su `code`, mai su `message` o sul solo status HTTP.** I codici sono in `SCREAMING_SNAKE_CASE` e stabili; i messaggi sono scritti per gli sviluppatori che leggono una console e possono cambiare. Lo status HTTP è presente nell'intestazione della risposta, non nel corpo.

| Status | Codice tipico | Significato |
|--------|---------------|-------------|
| 400 | `BAD_REQUEST`, `INVALID_INPUT`, `INVALID_LIMIT`, `INVALID_OFFSET`, `INVALID_PAGE` | La richiesta non è valida o richiede un'operazione impossibile |
| 401 | `UNAUTHORIZED` | Nessuna credenziale fornita o credenziale non associata ad alcuna identità |
| 403 | `FORBIDDEN`, `SCOPE_MISSING`, `WRITE_DENIED` | Credenziale associata a un'identità priva delle autorizzazioni necessarie |
| 404 | `NOT_FOUND` | La risorsa richiesta non esiste |
| 409 | `CONFLICT` | Conflitto di stato — chiave duplicata, stato dell'albero non coerente |
| 501 | variabile | La funzionalità esiste ma **non è configurata** in questa installazione |
| 503 | `SERVICE_UNAVAILABLE` | Una dipendenza non è raggiungibile; la richiesta non è stata elaborata |

Una funzionalità non disponibile perché disabilitata in questa installazione risponde con 501 accompagnato da codice e motivazione, non con 404 — un 404 imprevisto su una route appena invocata dall'interfaccia utente farebbe pensare a un deploy non funzionante.

Le singole route aggiungono codici più specifici a questi (`EMAIL_EXISTS`, `TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, …), pertanto l'elenco dei codici è da considerarsi aperto. L'SDK tipizzato li converte tutti in un unico errore `RebaseApiError` contenente `status`, `code` e `details` — vedi [Gestione degli errori](/docs/backend#error-handling).

## Ricerca testuale

Usa `searchString` per la ricerca full-text nei campi di testo:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Ricerca vettoriale

Una tabella dotata di una colonna `col.vector()` supporta la ricerca dei nodi più vicini (nearest-neighbour) sull'elenco: `?vector_search=embedding&vector=[0.15,0.22,-0.05]`, con `vector_distance` e `vector_threshold` opzionali. I parametri, le soglie e il comportamento dei filtri sull'indice sono illustrati in [Ricerca vettoriale](/docs/backend/vector-search/).

## Query troppo lunghe per un URL

`POST /api/data/:slug/query` (questo elenco) e `POST /api/data/:slug/count` accettano i parametri di query all'interno di un corpo JSON, per query che supererebbero la lunghezza massima consentita per un URL — come un embedding o un lungo elenco `in`. Vedi [Query troppo lunghe per un URL](/docs/backend/vector-search/#queries-too-long-for-a-url).

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

Un nome che non corrisponde a una relazione della tabella restituisce un errore **400 `UNKNOWN_RELATION`**, a qualunque livello di annidamento. In passato veniva ignorato, restituendo uno status 200 con il campo semplicemente assente — comportamento indistinguibile da una riga priva di dati correlati, per cui un refuso appariva identico a un dato vuoto. Un percorso più profondo di tre passaggi restituisce `INCLUDE_TOO_DEEP`. Il nome deve corrispondere esattamente alla chiave della relazione specificata in `relations` nella tabella; le varianti slug e snake_case supportate nelle versioni precedenti non sono valide. Le righe correlate vengono restituite secondo l'[`orderBy`](/docs/collections/relations/) dichiarato per la relazione quando la richiesta non ne specifica uno, e una foreign key generata da una relazione su una colonna `bigint` o `numeric` viene restituita sotto forma di numero.

### Filtrare una singola relazione

La sintassi con valori separati da virgola non consente di definire un `limit` per singola relazione; pertanto, `include` accetta anche un formato JSON — riconoscibile dalla presenza di una parentesi graffa iniziale:

```bash
GET /api/data/posts?include={"comments":{"limit":5,"where":{"published":["==",true]},"orderBy":"createdAt:desc","fields":["id","body"],"include":{"author":true}}}
```

| Chiave | Significato |
|--------|-------------|
| `limit` | Righe **per riga padre**, non sull'intera pagina. Applicato a livello di query, impedendo che le righe eccedenti vengano lette dal database |
| `where` | Lo stesso dialetto di filtro utilizzato dal parametro `where` di primo livello |
| `logical` | Un gruppo logico `or`/`and`/`not` applicato alle righe correlate |
| `orderBy` | La stessa sintassi di ordinamento, inclusa la gestione dei valori NULL. I pareggi e le clausole `limit` prive di `orderBy` vengono ordinati in base alla chiave della riga correlata, in ordine crescente |
| `fields` | Colonne della riga *correlata*; la sua chiave primaria viene sempre preservata |
| `include` | Relazioni della riga correlata, a loro volta |
| `count` | Se impostato su `true`, restituisce anche il totale per ciascun elemento genitore nel campo `_count` (`"_count":{"comments":37}`), conteggiato nella medesima istruzione. Solo per relazioni to-many. Vedi [Conteggiare ciò che un limite esclude](/docs/sdk/relations#counting-what-a-limit-leaves-out) |

`true` indica "carica interamente", quindi `{"author":true}` e `author` rappresentano la stessa richiesta. Entrambe le formulazioni funzionano sulla route di elenco, sulla route di lettura per ID e sulle route annidate.

Ogni passaggio (hop) viene eseguito come singola query raggruppata (in batch) per l'intera pagina, mai come query singola per riga.

Le relazioni incluse sono incorporate direttamente nella risposta:

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

Una riga inclusa ha la stessa struttura restituita dalla route dedicata dell'entità di destinazione (`GET /api/data/authors/42`): le stesse colonne e codifiche, chiavi esterne come colonne, nessun oggetto di riferimento.

## Scrittura

Le chiavi di idempotenza, le scritture condizionali (`ETag` / `If-Match`), le operazioni sui campi (`$inc`, `$push`, `$pull`, `$merge`), gli upsert su chiave naturale, `Prefer: return=minimal` e l'endpoint su più tabelle `POST /api/data/_batch` sono trattati nella pagina dedicata: **[Scrittura tramite REST](/docs/backend/writes/)**.

## Pipeline degli hook del ciclo di vita

Su Postgres, ogni mutazione REST (`POST`, `PATCH`, `DELETE`) esegue gli hook della tabella in sequenza, all'interno dell'unica transazione che effettua la scrittura:

```
Request ──► BEGIN ──► beforeSave/beforeDelete ──► DB operation ──► afterSave/afterDelete ──► COMMIT ──► Response
```

Ogni hook viene atteso in modo asincrono (`await`), e qualsiasi eccezione generata annulla l'intera operazione di scrittura:

1. **`beforeSave`, `beforeDelete`** vengono eseguiti prima della scrittura. Possono modificare i valori in ingresso, convalidare o rifiutare la richiesta lanciando un'eccezione — il chiamante riceverà un errore **400 `CALLBACK_REJECTED`** e non verrà scritto nulla.
2. **`afterSave`, `afterDelete`** vengono eseguiti dopo la scrittura ma *prima* del commit. Il lancio di un'eccezione esegue il rollback della riga e restituisce lo stesso errore 400, con `details.stage` che indica l'hook interessato. Mantengono la transazione aperta durante l'esecuzione, il che li rende il luogo inadatto per invocare webhook o altre chiamate di rete — la sezione [Hook](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) spiega dove gestire queste operazioni.

## Endpoint di sistema

| Metodo | Percorso | Autenticazione | Descrizione |
|--------|----------|----------------|-------------|
| `GET` | `/health` e `/api/health` | nessuna | Verifica di liveness/readiness |
| `GET` | `/api/docs` | <span class="since-badge" data-since="0.31">Dalla versione 0.31</span> per impostazione predefinita, gli stessi chiamanti a cui `GET /api/schema/tables` descrive le tabelle (401 per anonimi a meno che `schemaTables.public` non sia attivo); nessuna se `enableSwagger` è `true`; autorizzazione admin se è `false` | La specifica JSON di OpenAPI 3.0 — per impostazione predefinita solo le tabelle, colonne e relazioni che l'endpoint di schema descrive a quel chiamante. `404 DOCS_UNAVAILABLE` se l'autenticazione non è configurata |
| `GET` | `/api/swagger` | nessuna | Swagger UI. Servita solo quando `enableSwagger` è `true` (`REBASE_ENABLE_SWAGGER=true`), e mai in produzione |
| `GET` | `/api/meta/schema-version` | nessuna | L'hash dello schema da cui è stato compilato il backend e la versione di runtime — volutamente non autenticato e privo di dettagli descrittivi dello schema |
| `GET` | `/api/meta/contract` | `schema:read`: un admin, la service key o una chiave API che possiede questo scope | La versione dello schema, il runtime e ogni tabella secondo la visibilità dell'amministratore, per `rebase generate-sdk --from`. Fail-closed: `404` se l'autenticazione non è configurata |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` se impostato | Metriche Prometheus, se `REBASE_METRICS=true` |

## OpenAPI / Swagger

La specifica OpenAPI viene generata automaticamente dalle tabelle: descrive gli endpoint di elenco, query, conteggio, aggregazione, lettura, creazione, aggiornamento, eliminazione e operazioni bulk per ogni tabella gestita dal backend, le relative route annidate e `_batch`, con i parametri di query e gli schemi di risposta associati. Non rappresenta una mappa esaustiva dell'intera superficie HTTP — le route di autenticazione, storage, funzioni e cron sono documentate esclusivamente su questo sito — e le colonne contrassegnate con `.private()` ne vengono escluse. Il campo `description` della tabella e il metodo `.describe()` della colonna ne costituiscono le descrizioni.

Per una tabella con [`softDelete`](/docs/collections/soft-delete/), la specifica indica che l'eliminazione, singola o massiva, sposta la riga nel cestino, e documenta `?hard=true` su entrambe le operazioni di eliminazione e `?deleted=include|only` per l'elenco, la lettura singola, il conteggio e l'aggregazione. L'API explorer di Studio invia esclusivamente i parametri dichiarati nella specifica: è questo meccanismo che gli consente di eliminare definitivamente una riga o visualizzare il cestino.

I client automatici (macchine) si autenticano tramite una chiave dotata di opportuni scope anziché mediante sessione: [Chiavi API](/docs/backend/api-keys/).

## Metadati dello schema

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Le tabelle servite dal backend sono descritte, per singolo chiamante, all'endpoint `GET /api/schema/tables` — i descrittori usati per il rendering da CMS e Studio. A ogni chiamante autenticato vengono mostrate le tabelle che ha il permesso di vedere, oscurando ciò che non può leggere; la matrice completa è disponibile in [Endpoint](/docs/backend/endpoints/#schema).

L'intero schema, come visibile da un amministratore, è accessibile su:

```bash
GET /api/meta/contract
```

```json
{ "schemaVersion": "v2:…", "runtime": { "version": "0.30.1", "contract": 2 }, "tables": [ … ] }
```

Richiede lo scope **`schema:read`**, posseduto dagli amministratori, e nelle installazioni prive di autenticazione configurata non viene fornito affatto (404 `CONTRACT_UNAVAILABLE`) per evitare di esporre lo schema pubblicamente. Dalla versione 0.31 le versioni dello schema iniziano con `v2:`: essendo calcolate a partire dalle tabelle compilate, la versione di ogni progetto è cambiata una volta. L'endpoint correlato restituisce una stringa di versione che identifica lo schema senza descriverlo, ed è accessibile senza alcuna credenziale — ideale per il polling da parte dei job di CI:

```bash
GET /api/meta/schema-version
```

Per esaminare la struttura degli endpoint anziché lo schema sottostante, il documento OpenAPI è disponibile su `GET /api/docs`: effettuando l'accesso, si ottiene il documento relativo alle tabelle visibili. Swagger UI su `/api/swagger` viene servita solo se il documento è pubblicato con `REBASE_ENABLE_SWAGGER=true`, al di fuori della produzione.

## Passaggi successivi

- **[SDK tipizzato](/docs/sdk)** — Client type-safe per l'API REST
- **[Tabelle](/docs/schema/)** — Definisci lo schema dei tuoi dati
- **[Regole di sicurezza (RLS)](/docs/collections/security-rules)** — Controlla l'accesso a livello di riga
