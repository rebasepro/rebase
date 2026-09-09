---
sourceHash: 72b63305690d555c
title: Interrogazione dei Dati
sidebar_label: Interrogazione dei Dati
description: Operazioni CRUD, fluent query builder, operatori di filtro, ordinamento, selezione delle colonne e aggregati con l'SDK Client di Rebase.
---

## Accesso alle Collection

Accedi a qualsiasi collection tramite `client.data.<collectionName>` (camelCase, convertito automaticamente in snake_case) o `client.data.collection<Record<string, unknown>>("slug")` (slug esplicito):

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Modalità strict (SDK generato):** Quando passi il `collectionsDictionary` generato a `createRebaseClient`, il data proxy convalida gli accessi alle proprietà al momento della chiamata. Un errore di battitura come `client.data.prodcuts` genererà immediatamente un errore utile con un suggerimento di corrispondenza più vicina, invece di produrre un 404 fuorviante in seguito. Usa `client.data.collection<Record<string, unknown>>("slug")` per bypassare la convalida per slug dinamici o determinati a runtime.

## Operazioni CRUD

### Find (Elenco)

```typescript
// All products (default limit: 50)
const { data, meta } = await client.data.products.find();

// With pagination, filtering, and sorting
const { data, meta } = await client.data.products.find({
    where: { active: ["==", true], price: [">=", 100] },
    orderBy: ["createdAt", "desc"],
    limit: 25,
    offset: 0
});

// data is Row[] — flat rows, with the id at the top level
// meta has { total, limit, offset, hasMore }
```

### Lettura di un singolo elemento per ID

Esistono due metodi, poiché rispondono a due situazioni distinte che richiedono codice differente.

`get` è pensato per una riga di cui prevedi l'esistenza: l'ID proviene da un link, da un parametro di route o da un'altra riga. Restituisce direttamente la riga, evitando type narrowing a valle, e l'assenza della riga genera un'eccezione gestibile:

```typescript
const product = await client.data.products.get(42);
product.name;    // Row, not Row | undefined
```

```typescript
import { RebaseApiError } from "@rebasepro/client";

async function loadProduct(id: string) {
    try {
        return await client.data.products.get(id);
    } catch (e) {
        if (e instanceof RebaseApiError && e.code === "NOT_FOUND") return null;
        throw e;
    }
}
```

`findById` è destinato a una riga che potrebbe legittimamente non esistere: una ricerca tramite un ID inserito da un utente o un controllo nella cache:

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

:::note
La sicurezza a livello di riga (Row-level security) fa sì che "riga inesistente" e "non autorizzato alla lettura" diano deliberatamente la stessa risposta: un errore 404 che facesse distinzione confermerebbe l'esistenza della riga.
:::

### Scrittura

`create`, `upsert`, `update`, `delete` e le relative operazioni in batch sono trattate in **[Scrittura dei dati](/docs/sdk/writing/)**, insieme alle operazioni sui campi, scritture condizionali e chiavi di idempotenza.

### Count (Conteggio)

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Fluent Query Builder

Concatena i metodi per comporre query più espressive:

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();
```

### Metodi Disponibili

| Metodo | Descrizione | Esempio |
|--------|-------------|---------|
| `.where(field, op, value)` | Aggiunge una condizione di filtro | `.where("age", ">=", 18)` |
| `.where(path, op, value)` | Filtra su un percorso di [relazione](#querying-through-a-relation) o [JSON](#filtering-inside-json) | `.where("author.name", "==", "bob")` |
| `.where(group)` | Aggiunge un [gruppo OR/AND](#logical-conditions-or--and) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Ordina i risultati | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Ordina in base a un [aggregato su una relazione](#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limita il numero di risultati | `.limit(25)` |
| `.offset(n)` | Salta i primi N risultati | `.offset(50)` |
| `.after(cursor)` | Continua dopo un [cursore](#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Restituisce [solo queste colonne](#returning-fewer-columns) | `.fields("id", "title")` |
| `.distinct()` | Raggruppa le righe identiche su tali colonne | `.fields("status").distinct()` |
| `.search(text)` | Ricerca di testo — vedi [Ricerca](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Ricerca nearest-neighbour su una proprietà `vector` | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Carica le righe correlate](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Esegue la query | Restituisce `FindResult<M>` |
| `.aggregate(params)` | [Esegue una riduzione anziché restituire le righe](#aggregates) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Restituisce in streaming ogni riga corrispondente](#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Raccoglie ogni riga corrispondente](#reading-everything-iterate-and-findall) | Restituisce `M[]` |
| `.count()` | Conta le righe corrispondenti | Restituisce `number` |
| `.listen(onUpdate, onError?)` | Iscriviti agli aggiornamenti in tempo reale | Restituisce `unsubscribe()` |

### Operatori di Filtro

| Operatore | Alias | Descrizione |
|-----------|-------|-------------|
| `"=="` | `"eq"` | Uguale |
| `"!="` | `"neq"` | Diverso |
| `">"` | `"gt"` | Maggiore di |
| `">="` | `"gte"` | Maggiore o uguale a |
| `"<"` | `"lt"` | Minore di |
| `"<="` | `"lte"` | Minore o uguale a |
| `"in"` | | Valore presente nell'array |
| `"not-in"` | `"nin"` | Valore non presente nell'array |
| `"array-contains"` | `"cs"` | Il campo array contiene il valore |
| `"array-contains-any"` | `"csa"` | Il campo array contiene uno qualsiasi dei valori |
| `"like"` | `"like"` | Corrispondenza di pattern **case-sensitive**; `%` e `_` sono caratteri jolly |
| `"ilike"` | `"ilike"` | Corrispondenza di pattern case-insensitive |
| `"not-like"` | `"nlike"` | Non corrisponde al pattern |
| `"not-ilike"` | `"nilike"` | Non corrisponde al pattern, in modo case-insensitive |
| `"is-null"` | `"isnull"` | La colonna è `NULL`. Non accetta valori: qualsiasi valore passato viene ignorato |
| `"is-not-null"` | `"notnull"` | La colonna non è `NULL`. Non accetta valori |

La colonna degli alias rappresenta la sintassi di rete (**wire format**), utilizzata nelle query string REST. Non compare mai nel codice applicativo: sia l'SDK che il pannello di amministrazione utilizzano l'operatore canonico a sinistra.

### Sintassi della Clausola Where

Il parametro `where` in `find()` supporta due formati:

```typescript no-verify
// 1. Tuple syntax — [operator, value] (recommended)
await client.data.products.find({
    where: {
        status: ["==", "active"],
        featured: ["==", true],
        price: [">=", 100],
        category: ["in", ["electronics", "gadgets"]],
        deleted_at: ["!=", null]
    }
});

// 2. Pre-serialized PostgREST string syntax (advanced)
await client.data.products.find({
    where: { status: "eq.published", price: "gte.100" }
});
```

> **Nota:** Le stringhe PostgREST pre-serializzate (formato 2) sono una soluzione di emergenza per passare valori di filtro già in formato wire. È preferibile utilizzare la sintassi a tuple per motivi di type safety e leggibilità.

## Condizioni Logiche (OR / AND / NOT)

Tutti i campi in `where` vengono combinati con AND. Per unire le condizioni con OR, o per negare un gruppo, costruisci una **condizione logica** tramite gli helper `or`, `and`, `not` e `cond` esportati dall'SDK:

```typescript
import { or, and, not, cond } from "@rebasepro/client";

const { data } = await client.data.products.find({
    logical: or(
        cond("status", "==", "active"),
        and(
            cond("status", "==", "draft"),
            cond("authorId", "==", currentUserId)
        )
    )
});
```

Il fluent builder accetta la stessa struttura ad albero:

```typescript
const { data } = await client.data.products
    .where(or(cond("status", "==", "active"), cond("featured", "==", true)))
    .orderBy("createdAt", "desc")
    .find();
```

`cond` accetta l'operatore canonico — la colonna di sinistra della tabella degli [Operatori di Filtro](#filter-operators). L'utilizzo di un operatore non previsto dal dialetto genera un `TypeError` in fase di serializzazione della query, anziché produrre silenziosamente una query diversa.

### Negazione

`not` nega la **congiunzione** delle sue condizioni: `not(a)` equivale a `NOT a`, e `not(a, b)` a `NOT (a AND b)`. I gruppi possono essere annidati, quindi la controparte della legge di De Morgan è `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Viene compilato in un vero `NOT (...)` SQL, non in operatori invertiti. Questa distinzione non è superficiale: la logica di SQL è a tre valori, pertanto `NOT (a AND b)` e `(NOT a) OR (NOT b)` cessano di coincidere non appena entra in gioco un valore `NULL`, e solo una delle due opzioni corrisponde alla query scritta.

Ciò significa inoltre che una negazione **include le righe la cui colonna è NULL** — `not(cond("status", "==", "draft"))` restituisce le righe che non hanno alcuno stato impostato. È questo il significato di `NOT` ed è generalmente ciò che ci si aspetta; in caso contrario, aggiungi una condizione `is-not-null` in AND al suo fianco.

### Composizione con il resto della query

`where`, `logical` e `search` sono tre gruppi indipendenti, combinati tra loro con AND:

```
(campi where, in AND)  AND  (gruppo logico)  AND  (search)
```

Non è possibile applicare un OR tra `where` e `logical`. Qualsiasi combinazione che non sia un semplice AND tra i tre deve essere espressa all'interno di un unico albero `logical` — sposta al suo interno i campi che necessitano dell'OR.

### Formato di rete (On the wire)

Un gruppo logico viaggia come un singolo parametro di query `or=`, `and=` o `not=`, adottando la stessa sintassi con il punto impiegata dai filtri di campo:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Viene applicato un solo operatore dei tre per richiesta — `or` ha la precedenza su `and`, ed entrambi su `not`. Annida un gruppo dentro l'altro per combinarli.

Esistono tre codifiche rilevanti da conoscere, poiché sono quelle in cui è facile commettere errori scrivendo a mano una query string:

| Condizione | Formato wire | Nota |
|------------|--------------|------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` ricerca la stringa di quattro caratteri `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` è una lista contenente una singola stringa vuota, il che produce una query diversa |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | un [percorso di relazione](#querying-through-a-relation) mantiene il suo punto |

Virgole, parentesi e barre rovesciate all'interno di un valore vengono precedute da un carattere di escape backslash; pertanto `cond("name", "==", "Doe, John")` viaggia come `name.eq.Doe\, John` e non spezza il gruppo.

I gruppi possono essere annidati fino a 32 livelli di profondità. Oltre tale soglia, la richiesta viene respinta con `INVALID_LOGICAL_GROUP` — in tal caso appiattiscila, poiché `or(a,or(b,c))` equivale a `or(a,b,c)`.

## Paginazione

Offset, numeri di pagina e cursori keyset sono trattati nella pagina dedicata:
[Paginazione](/docs/sdk/pagination/).

## Ordinamento

```typescript
// Sort by field (format: ["field", "direction"])
const { data } = await client.data.products.find({
    orderBy: ["createdAt", "desc"]
});

// Fluent style
const { data } = await client.data.products
    .orderBy("price", "asc")
    .find();
```

Se la direzione viene omessa, il valore predefinito è `"asc"` — esattamente come `?orderBy=name` su HTTP, a prescindere dal database utilizzato.

### Ordinamento per più colonne

L'ordinamento è un'*elenco* di chiavi. La seconda risolve le parità tra righe che la prima considera uguali, la terza tra quelle identiche per le prime due — pertanto `orderBy` accetta un elenco di coppie `[field, direction]` con la stessa naturalezza di una singola coppia:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

Nel fluent builder si ottiene lo stesso risultato concatenando ulteriori chiamate a `.orderBy()`. Ogni chiamata **aggiunge** una chiave subordinata a quelle precedenti anziché sostituirle:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Ogni ordinamento termina con l'ID di riga decrescente, che sia stato esplicitamente richiesto o meno. È questo a rendere l'ordinamento *totale*: senza di esso due righe con lo stesso valore verrebbero restituite nell'ordine arbitrario scelto dal database, e paginare su un ordinamento suscettibile di variazioni tra due esecuzioni della stessa query finirebbe per duplicare alcune righe e saltarne altre.

Un ordinamento a più colonne pagina correttamente tramite [cursore](#cursor-pagination): il confronto viene costruito su ciascuna chiave, in sequenza. L'unico criterio di ordinamento non descrivibile da un cursore è **`_score`** — vedi [Ricerca](/docs/backend/search). La rilevanza viene calcolata per ogni singola query anziché salvata, quindi non vi è alcun valore sulla riga del cursore su cui confrontare la pagina successiva, e tale elenco non produrrà alcun `nextCursor`.

### Posizionamento dei valori NULL nell'ordinamento

Per impostazione predefinita i valori NULL vengono posizionati **per ultimi in ordine crescente e per primi in ordine decrescente** — convenzione tipica di Postgres. Questo comportamento predefinito posiziona ogni riga sprovvista di data in cima a un elenco ordinato "dal più recente", prima di qualsiasi dato valido; in passato l'unica via d'uscita era un filtro `is-not-null` che rimuoveva del tutto tali righe.

Un terzo elemento nella chiave consente di specificarne il posizionamento alternativo:

```typescript
// Newest first, and the ones with no date at the end where they belong.
const { data } = await client.data.posts.find({
    orderBy: [["publishedAt", "desc", "last"]]
});
```

```typescript
const { data } = await client.data.posts
    .orderBy("publishedAt", "desc", "last")
    .find();
```

Su HTTP corrisponde a un terzo elemento separato da due punti, `?orderBy=publishedAt:desc:last`, oppure alla proprietà `"nulls"` nel formato array JSON. Qualsiasi valore diverso da `first`/`last` produce un errore 400 anziché un ordinamento silenziosamente errato.

Il [cursore](#cursor-pagination) tiene conto delle impostazioni di ordinamento indicate, garantendo che la paginazione su una chiave nullable rimanga accurata con entrambi i posizionamenti.

## Restituire meno colonne

`fields` circoscrive la lettura alle sole colonne indicate. Si tratta di una proiezione a livello di database — sono le colonne effettivamente *lette*, non quelle superstiti dopo un troncamento della risposta — quindi una query che necessita di due campi su una riga estesa non pagherà l'elaborazione del resto:

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Due principi rimangono sempre validi, a prescindere dalle colonne indicate:

- **La chiave primaria viene sempre inclusa.** Una riga priva di identificatore non può essere aggiornata, eliminata o oltrepassata tramite paginazione — e `meta.nextCursor` viene ricavato da essa, quindi una proiezione priva della chiave disabiliterebbe silenziosamente la navigazione per cursore.
- **Le colonne con `excludeFromApi` restano nascoste.** Specificare il loro nome non ne annulla l'esclusione.

Una colonna inesistente genera un errore 400 `UNKNOWN_FIELD`. Se venisse semplicemente ignorata ("omettila"), un errore di battitura come `fields: ["titel"]` restituirebbe righe prive di titoli senza alcuna spiegazione.

Una relazione specificata in `include` viene caricata a prescindere dalla sua presenza in `fields`; per circoscrivere le colonne *interne* a una relazione, consulta le [opzioni per relazione](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

<span class="since-badge" data-since="0.20">Da 0.20</span>

`distinct` raggruppa le righe identiche rispetto alle colonne restituite, e una lettura con distinct restituisce **unicamente** le colonne indicate — la chiave primaria viene esclusa dalla proiezione, a differenza di quanto avviene in tutte le altre letture. Deve essere così: una chiave surrogata differisce in ogni riga, quindi mantenerla renderebbe ogni riga univoca per definizione e la query restituirebbe uno stato 200 senza aver raggruppato nulla.

Per questo motivo il metodo ha senso solo se associato a `fields`. Senza di esso verrebbe richiesta ogni colonna visibile, chiave inclusa, e nessuna riga verrebbe accorpata:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

Una lettura distinct non fa riferimento a righe specifiche — mancando una chiave primaria tramite cui indirizzarle — restituendo di fatto un insieme di valori anziché un insieme di righe da aggiornare o eliminare, e non include alcun `nextCursor`. Inoltre, **non restituisce `meta.total`**: il conteggio richiederebbe una query `COUNT(DISTINCT …)` non eseguita dal driver, e riportare il semplice conteggio delle righe descriverebbe un insieme differente da quello servito — un risultato completo di due righe verrebbe restituito come `total: 8, hasMore: true`, inducendo il client a paginare indefinitamente. `hasMore` viene invece ricavato direttamente dalla pagina stessa.

Due combinazioni vengono respinte con errore anziché restituire un risultato privo di senso:

- **Una query che assegna un punteggio a ciascuna riga** — una `search()` classificata o una `vectorSearch()` associa uno `_score` o una `_distance` a ogni riga, rendendo le righe mai identiche tra loro e rendendo `DISTINCT` inefficace. (Una ricerca standard per sottostringa non associa punteggi ed è pertanto consentita.)
- **L'ordinamento per una colonna non inclusa tra quelle restituite.** Postgres non consente di ordinare una query `DISTINCT` in base a un'espressione esclusa dalla select list; la richiesta restituisce un errore 400 `DISTINCT_ORDER_BY_NOT_SELECTED` invece di un errore 500 che riporta codice SQL mai scritto direttamente.

Su HTTP: `?fields=status&distinct=true`.

## Aggregati

`aggregate()` riduce l'insieme delle righe corrispondenti anziché restituirle — `count`, `sum`, `avg`, `min`, `max`, con raggruppamento opzionale:

```typescript
const rows = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }, { fn: "count" }],
    groupBy: ["status"],
    where: { createdAt: [">=", startOfMonth] }
});
// [{ status: "paid", sum_total: 41822.5, count: 317 }, …]
```

I filtri impostati sul query builder vengono mantenuti, rappresentando di solito la sintassi più sintetica:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

Le chiavi nei risultati sono **derivate**, non definibili: `sum(total)` viene restituito come `sum_total`, un semplice `count()` come `count`. Consentire di personalizzarne il nome comporterebbe dover verificare che esso non coincida con un campo presente in `groupBy` — un vincolo inaspettato, che in assenza di controlli causerebbe sovrascritture silenziose.

`limit` definisce la soglia massima per il numero di **gruppi** (il raggruppamento su una colonna ad alta cardinalità può equivalere all'invio di un'intera tabella in un'unica risposta) e viene ignorato in assenza di `groupBy`, poiché un'aggregazione non raggruppata produce una sola riga. `orderBy`, `include` e la paginazione non sono applicabili: un aggregato non ha righe da ordinare, relazioni da caricare né pagine su cui proseguire.

Lo scopo principale è evitare di recuperare singole righe al solo fine di ridurle. Ottenere il "fatturato per stato" su un milione di ordini si traduce qui in un'unica query e in una riga per stato, a differenza di una `findAll()` associata a un ciclo applicativo — approccio errato se sottoposto a `limit` e ingestibile senza di esso. L'operazione viene eseguita attraverso lo stesso handle con ambito di richiesta (request-scoped) di qualsiasi altra lettura, garantendo l'applicazione della sicurezza a livello di riga a tutte le righe aggregate.

Su HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

Il filtraggio su JSON, la ricerca full-text e la ricerca vettoriale sono trattati in una pagina dedicata:
[Aggregati e ricerca](/docs/sdk/aggregates-and-search/).

La lettura di entità correlate — tramite `include` e gli accessor per interrogare attraverso una relazione — è descritta in: [Interrogazione delle relazioni](/docs/sdk/relations/).

## Endpoint Personalizzati

Chiama gli endpoint server personalizzati registrati tramite il sistema delle funzioni:

```typescript
// Using client.functions.invoke()
const result = await client.functions.invoke<{ summary: string }>(
    "generate-summary",
    { articleId: 42 }
);

// With options
const result = await client.functions.invoke<{ status: string }>(
    "process-order",
    { orderId: 123 },
    { method: "POST", path: "status/check" }
);

// Shorthand via client.call()
const result = await client.call<{ summary: string }>(
    "functions/generate-summary",
    { articleId: 42 }
);
```

Entrambi restituiscono **il corpo della risposta della funzione, testualmente (verbatim)**. Nessuno dei due estrae preventivamente una chiave `data`: se una funzione risponde con `{ data: [...] }`, viene restituito l'intero oggetto e spetta a te accedere a `.data`.

`call()` accetta un percorso completo ed esegue sempre una richiesta POST; `invoke()` accetta il nome di una funzione e può accogliere un metodo HTTP, un sub-path e intestazioni. Utilizza `invoke()` a meno che la destinazione della chiamata non sia una risorsa differente da una funzione.

## Passaggi Successivi

- **[Autenticazione](/docs/sdk/authentication)** — Accesso, registrazione, OAuth, sessioni
- **[Sottoscrizioni Realtime](/docs/sdk/realtime)** — Dati in tempo reale tramite WebSocket
- **[Storage e File](/docs/sdk/storage)** — Caricamento, download e gestione dei file
- **[Relazioni](/docs/collections/relations)** — Definizione delle relazioni tra collection

---
