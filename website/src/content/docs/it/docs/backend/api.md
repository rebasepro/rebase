---
title: API REST
sidebar_label: API REST
description: Endpoint API REST generati automaticamente per ogni collezione, con filtraggio, ordinamento, paginazione e inclusione delle relazioni.
---

## Panoramica

Rebase genera automaticamente un'API completa dalle definizioni delle tue collezioni:

- **API REST** — Endpoint CRUD per ogni collezione su `/api/data/:slug`
- **Specifica OpenAPI** — Specifica leggibile dalla macchina su `/api/docs`
- **Swagger UI** — Esploratore API interattivo su `/api/swagger` (solo in modalità sviluppo)

Non è richiesto alcun codice — definisci le tue collezioni e l'API appare automaticamente.

## Endpoint REST

Per ogni collezione vengono generati i seguenti endpoint:

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Elencare le entità |
| `GET` | `/api/data/:slug/count` | Contare le entità |
| `GET` | `/api/data/:slug/:id` | Ottenere una singola entità |
| `POST` | `/api/data/:slug` | Creare un'entità |
| `PATCH` | `/api/data/:slug/:id` | Aggiornare un'entità |
| `DELETE` | `/api/data/:slug/:id` | Eliminare un'entità |
| `POST` | `/api/data/:slug/bulk` | Create many entities in one transaction |
| `PATCH` | `/api/data/:slug/bulk` | Update many entities in one transaction |
| `POST` | `/api/data/:slug/bulk/delete` | Delete many entities in one transaction |

### Route delle Sottocollezioni

Le relazioni annidate sono accessibili tramite percorsi URL:

```
GET    /api/data/authors/42/posts         → list author's posts
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Meccanica di Routing & Analisi dei Segmenti

Per gestire profondità arbitrarie di sottocollezioni annidate, Rebase instrada le richieste in arrivo usando la regex del parametro `:rest{.+}` di Hono. Il motore interno di analisi dei segmenti analizza i percorsi contando i segmenti separati da slash:
- **Numero dispari di segmenti** (ad es. `authors/42/posts` -> 3 segmenti) rappresenta una richiesta di elenco di collezione.
- **Numero pari di segmenti** (ad es. `authors/42/posts/7` -> 4 segmenti) rappresenta un'operazione su un ID di entità specifico. L'ultimo segmento viene estratto come `entityId` target.

Il motore filtra i namespace di sistema riservati (ad es. `history`) dall'analisi dei segmenti del percorso per prevenire collisioni con gli endpoint integrati.

## Autenticazione

Tutti gli endpoint dei dati richiedono l'autenticazione per impostazione predefinita. Includi un token Bearer nell'header `Authorization`:

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

Per le chiamate server-to-server, usa la chiave di servizio:

```bash
curl -H "Authorization: Bearer <service-key>" \
     https://api.example.com/api/data/products
```

## Filtraggio

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

### Operatori di Filtro

| Operatore | Significato | Esempio |
|----------|---------|---------|
| `eq` | Uguale (`==`) | `?active=eq.true` |
| `neq` | Diverso (`!=`) | `?status=neq.draft` |
| `gt` | Maggiore di (`>`) | `?price=gt.100` |
| `gte` | Maggiore o uguale (`>=`) | `?price=gte.100` |
| `lt` | Minore di (`<`) | `?price=lt.50` |
| `lte` | Minore o uguale (`<=`) | `?price=lte.50` |
| `in` | In array | `?status=in.(a,b,c)` |
| `nin` | Non in array | `?status=nin.(a,b)` |
| `cs` | L'array contiene | `?tags=cs.value` |
| `csa` | L'array contiene uno | `?tags=csa.(a,b)` |

### Operatori Logici

Usa `or` e `and` per condizioni complesse:

```bash
# OR: match products that are either cheap or on sale
GET /api/data/products?or=(price.lt.10,on_sale.eq.true)

# AND: explicit conjunction
GET /api/data/products?and=(active.eq.true,price.gt.0)
```

## Ordinamento

Usa `orderBy` con il formato `field:direction`:

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

## Paginazione

Usa `limit` e `offset`, oppure `page`:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses default limit of 20)
GET /api/data/products?page=3
```

Il limite predefinito è **20**, il massimo è **100**.

### Formato della Risposta

Le risposte di elenco includono metadati di paginazione:

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
        "hasMore": true
    }
}
```

Le risposte per una singola entità restituiscono un oggetto piatto:

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "createdAt": "2026-01-15T10:30:00Z"
}
```

## Ricerca Testuale

Usa `searchString` per la ricerca full-text sui campi di tipo stringa:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Ricerca Vettoriale

Se una collezione definisce una proprietà di tipo `vector`, puoi eseguire ricerche di similarità ad alta velocità usando operazioni di distanza pgvector compilate direttamente nella query del database.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

### Parametri di Query Vettoriale

| Parametro | Tipo | Descrizione |
|-----------|------|-------------|
| `vector_search` | `string` | Il nome della proprietà vettoriale su cui eseguire la query. |
| `vector` | `string` | Un array di float serializzato in JSON che rappresenta il vettore di query. |
| `vector_distance` | `string` | La metrica di distanza da valutare. Valori supportati: `cosine` (predefinito, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Soglia massima di distanza. Vengono restituiti solo i record con una distanza inferiore a questa soglia. |

## Inclusione delle Relazioni

Usa il parametro `include` per incorporare le entità correlate:

```bash
# Include specific relations
GET /api/data/articles?include=author,categories

# Include all relations
GET /api/data/articles?include=*
```

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

## Selezione dei Campi

Usa `fields` per selezionare colonne specifiche:

```bash
GET /api/data/products?fields=id,name,price
```

## Pipeline degli Hook del Ciclo di Vita

Ogni operazione di mutazione REST (`POST`, `PATCH`, `DELETE`) attraversa una pipeline di esecuzione degli hook rigorosa e sequenziale:

```
Request ──► beforeSave/beforeDelete (blocking) ──► DB Operation ──► afterSave/afterDelete (deferred) ──► Response
```

### Hook Bloccanti vs. Differiti

1. **Hook bloccanti (`beforeSave`, `beforeDelete`)**
   Questi hook vengono eseguiti in modo sincrono nel ciclo principale della richiesta *prima* di confermare la transazione del database. Possono modificare i payload in arrivo, eseguire validazioni personalizzate o interrompere completamente la richiesta generando un errore.

2. **Hook differiti (`afterSave`, `afterDelete`)**
   Questi hook vengono eseguiti in modo asincrono dopo che la transazione del database è stata confermata con successo. Usano promise differite (fire-and-forget), il che significa che vengono eseguiti in background e non bloccano la risposta HTTP del client. Ideali per inviare webhook, attivare notifiche push o accodare attività esterne.


## OpenAPI / Swagger

- **Specifica OpenAPI**: `GET /api/docs` — Restituisce la specifica JSON OpenAPI 3.0 completa
- **Swagger UI**: `GET /api/swagger` — Esploratore API interattivo (solo in modalità sviluppo)

La specifica OpenAPI viene generata automaticamente dalle definizioni delle tue collezioni: descrive gli endpoint di elenco, lettura, creazione, aggiornamento, eliminazione e bulk di ogni collezione servita dal backend, con i relativi parametri di query e schemi di risposta. Non è una mappa completa della superficie HTTP — le route di auth, storage, functions e cron sono documentate solo su questo sito — e le colonne contrassegnate con `excludeFromApi` ne sono escluse.

## Chiavi API

Le chiavi API forniscono l'autenticazione machine-to-machine per agenti, server MCP, pipeline CI e integrazioni esterne. Supportano l'ambito dei permessi per collezione e l'accesso amministratore completo opzionale.

### Creare una Chiave API

```bash
# Via CLI
rebase api-keys create --name "My Integration" \
  --permissions '[{"collection":"orders","operations":["read","write"]}]'

# Via REST (requires admin auth)
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Integration",
    "permissions": [{ "collection": "orders", "operations": ["read", "write"] }]
  }'
```

La risposta include la chiave completa in testo semplice (`rk_live_...`) **esattamente una volta** — memorizzala immediatamente.

### Usare una Chiave API

```bash
curl http://localhost:3000/api/data/orders \
  -H "Authorization: Bearer rk_live_abc123..."
```

### Permessi e RLS: due barriere indipendenti

La richiesta di una chiave API attraversa **due** controlli di autorizzazione, ed entrambi devono consentirla:

1. **L'elenco dei permessi della chiave** — collezione × operazione, controllato a livello di route.
2. **Sicurezza a livello di riga** — le chiavi API *non* bypassano la RLS. Una chiave viene eseguita come
   `uid: "api-key:<id>"` con il ruolo `service` (più `admin` quando
   `admin: true`). Le chiavi admin passano tramite le politiche admin integrate; una
   chiave non-admin vede solo le righe che una regola di sicurezza concede esplicitamente al
   ruolo `service` o al pubblico. Le regole in stile proprietario
   (`owner_id = rebase.uid()`) non corrispondono mai a una chiave API.

Quindi una chiave non-admin con permessi `"*"` può comunque ottenere risultati vuoti — è
la RLS che funziona, non un bug. Concedi il ruolo `service` nelle regole di sicurezza delle
collezioni pertinenti, oppure usa una chiave admin.

### Funzioni Personalizzate

Le invocazioni di funzioni hanno un ambito come le collezioni, sotto il namespace `functions`:
`{"collection": "functions", "operations": ["write"]}` concede ogni
funzione, `"functions/<name>"` ne concede una, e il carattere jolly globale `"*"` le concede
tutte. Una chiave senza tale voce non può invocare funzioni affatto.

### Archiviazione

L'archiviazione funziona allo stesso modo, sotto il namespace `storage`:
`{"collection": "storage", "operations": ["read", "write"]}` consente alla chiave di
scaricare/elencare (`read`), caricare e creare cartelle (`write`), ed eliminare file
(`delete`). Il carattere jolly globale `"*"` concede anche l'archiviazione. Una chiave senza tale
voce non può toccare l'archiviazione. Le route di caricamento ripristinabile TUS contano come `write`
a ogni passaggio (incluso il controllo dell'offset e l'annullamento), così una chiave con ambito di scrittura
può completare un caricamento da sola.

### Agenti e Server MCP

Un agente ha bisogno della chiave *più ristretta* che svolga il suo compito, non
di una chiave admin. Parti da un ambito ristretto e dalle una scadenza:

```bash
rebase api-keys create -n "My Agent" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Le operazioni sono `read`, `write` e `delete`, derivate dal metodo HTTP:
`GET`/`HEAD`/`OPTIONS` → `read`, `POST`/`PUT`/`PATCH` → `write`, `DELETE` →
`delete`.

#### Una chiave con ambito ristretto legge zero righe finché una regola non concede `service`

È il passaggio che fa sembrare rotta una chiave correttamente ristretta. Una
chiave non-admin viene eseguita come `uid: "api-key:<id>"` con i ruoli
`["service"]`, e la politica RLS iniettata per impostazione predefinita in ogni
collezione viene compilata in:

```sql
rebase.uid() IS NULL OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])
```

— il contesto server, oppure un admin. Una chiave non-admin non corrisponde a
nessuno dei due rami, quindi su una collezione senza `securityRules` la
richiesta va a buon fine con un insieme di risultati vuoto e senza alcun errore
che ne spieghi il motivo. Concedi il ruolo esplicitamente:

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Poiché `rebase.uid()` contiene l'id della chiave, una regola può anche restringere
le righe a una chiave specifica:

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### Non usare `"*"` per una chiave in sola lettura

Il carattere jolly `"*"` non copre solo le collezioni — corrisponde anche al
namespace `functions` e a `storage`. Una `GET` conta come `read`, e l'handler di
una funzione personalizzata è codice arbitrario che può scrivere: una chiave
jolly apparentemente in sola lettura può quindi modificare i dati attraverso una
funzione. Nominare le collezioni esplicitamente non lascia alla chiave alcun
accesso alle funzioni.

#### `--admin --full-access`: CI, migrazioni e strumenti interni

`"admin": true` concede alla chiave il ruolo admin — le route `/api/admin/*` per
la gestione dello schema, la gestione degli utenti e altro ancora, più cron,
backup e log. Combinata con `--full-access` (`{"collection": "*", "operations":
["read", "write", "delete"]}`), la chiave detiene ogni collezione, più tutta
l'archiviazione e ogni funzione personalizzata. È la forma giusta per la CI, le
migrazioni e gli strumenti interni fidati — non per gli agenti.

```bash
# CLI
rebase api-keys create -n "CI" --admin --full-access

# REST
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI",
    "admin": true,
    "permissions": [{ "collection": "*", "operations": ["read", "write", "delete"] }]
  }'
```

#### Niente tempo reale con le chiavi API

Il WebSocket in tempo reale non interpreta i token `rk_` — accetta soltanto i
JWT utente e la chiave di servizio. Un agente autenticato con una chiave API fa
polling sugli endpoint REST invece di sottoscriversi.

### Opzioni della Chiave

| Campo | Tipo | Descrizione |
|---|---|---|
| `name` | `string` | Etichetta leggibile dall'uomo |
| `permissions` | `ApiKeyPermission[]` | Accesso per collezione (`"*"` = tutto; `"functions/<name>"` = una funzione; `"storage"` = archiviazione file) |
| `admin` | `boolean` | Concedere il ruolo admin — route admin + politiche admin RLS |
| `rate_limit` | `number \| null` | Richieste per finestra di 15 min (`null` = il valore predefinito del server, 1000) |
| `expiresAt` | `string \| null` | Timestamp di scadenza ISO-8601 |

La CLI richiede un ambito esplicito: passa `--permissions '<json>'` oppure scegli
`--full-access` — non esiste un valore predefinito silenzioso di accesso completo.

Le chiavi possono essere elencate, aggiornate e revocate tramite
`/api/admin/api-keys` o i comandi CLI `rebase api-keys` — ma non da una chiave
API. Qualsiasi richiesta a `/api/admin/api-keys` autenticata con una chiave
`rk_` viene rifiutata con `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`, qualunque sia
il suo flag `admin`. La gestione delle chiavi richiede la sessione di un utente
admin, oppure la chiave di servizio.

## Endpoint dei Metadati

Ottieni un elenco di tutte le collezioni disponibili e della loro struttura:

```bash
GET /api/collections
```

## Prossimi Passi

- **[SDK Client](/docs/sdk)** — Client type-safe per l'API REST
- **[Collezioni](/docs/collections)** — Definisci il tuo schema dei dati
- **[Regole di Sicurezza (RLS)](/docs/collections/security-rules)** — Controlla l'accesso per riga
