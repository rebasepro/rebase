---
sourceHash: 45064786f1785a65
title: Interrogazione dei dati
sidebar_label: Interrogazione dei dati
description: Operazioni CRUD, fluent query builder, operatori di filtro, ordinamento, selezione delle colonne e aggregazioni con l'SDK tipizzato di Rebase.
---

## Accesso alle tabelle

<span class="since-badge" data-since="0.31">Da 0.31</span>

Accedi a qualsiasi tabella tramite `client.data.<tableName>` (camelCase, convertito automaticamente in snake_case) o `client.data.table<Record<string, unknown>>("slug")` (slug esplicito):

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.table<Record<string, unknown>>("blog_posts")
```

> **Modalità strict (SDK generato):** Quando passi il `tablesDictionary` generato a `createRebaseClient` come `tables`, il data proxy convalida l'accesso alle proprietà al momento dell'accesso. Un refuso come `client.data.prodcuts` lancia immediatamente `UNKNOWN_TABLE` con un suggerimento della corrispondenza più vicina invece di produrre in seguito un 404 ambiguo. Usa `client.data.table<Record<string, unknown>>("slug")` per ignorare la convalida per slug dinamici o determinati a runtime.

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

### Lettura di un singolo record per ID

Due metodi, perché ci sono due situazioni diverse che richiedono codice differente.

`get` è pensato per una riga che ci si aspetta esista — l'id proviene da un link, da un parametro di route o da un'altra riga. Restituisce la riga, evitando che a valle si debba restringere il tipo (narrowing), e una riga mancante genera un'eccezione su cui è possibile diramare il flusso:

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

`findById` è pensato per una riga che potrebbe legittimamente non esistere — una ricerca tramite un id digitato da un utente, un controllo in cache:

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

`findById` accetta le relazioni da caricare, esattamente come `find`:
`findById(1, { include: ["tags"] })`.

:::note
La sicurezza a livello di riga (Row-level security) rende volutamente identiche le risposte "riga inesistente" e "accesso in lettura non consentito": un 404 che facesse distinzione tra le due confermerebbe l'esistenza della riga.
:::

### Scrittura

`create`, `upsert`, `update`, `delete` e le relative varianti batch sono descritte in
**[Scrittura dei dati](/docs/sdk/writing/)**, insieme alle operazioni sui campi, scritture
condizionali e chiavi di idempotenza.

### Conteggio (Count)

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Fluent Query Builder

Concatena i metodi per query più espressive:

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();
```

### Metodi disponibili

| Metodo | Descrizione | Esempio |
|--------|-------------|---------|
| `.where(field, op, value)` | Aggiunge una condizione di filtro | `.where("age", ">=", 18)` |
| `.where(path, op, value)` | Filtra su un percorso di [relazione](/docs/sdk/relations#querying-through-a-relation) o [JSON](/docs/sdk/aggregates-and-search#filtering-inside-json) | `.where("author.name", "==", "bob")` |
| `.where(group)` | Aggiunge un [gruppo OR/AND](#condizioni-logiche-or--and--not) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Ordina i risultati | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Ordina in base a un'[aggregazione su una relazione](/docs/sdk/relations#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limita il numero di risultati | `.limit(25)` |
| `.offset(n)` | Salta i primi N risultati | `.offset(50)` |
| `.after(cursor)` | Continua dopo un [cursore](/docs/sdk/pagination#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Restituisce [solo queste colonne](#restituzione-di-un-sottoinsieme-di-colonne) | `.fields("id", "title")` |
| `.distinct()` | Collassa le righe identiche su quelle colonne | `.fields("status").distinct()` |
| `.search(text)` | Ricerca di testo — vedi [Ricerca](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Ricerca dei vicini più prossimi (nearest-neighbour) su una proprietà `vector` | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Carica le righe correlate](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Esegue la query | Restituisce `FindResult<M>` |
| `.aggregate(params)` | [Applica una funzione di aggregazione anziché restituire le righe](#aggregazioni) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Esegue lo streaming di ogni riga corrispondente](/docs/sdk/pagination#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Raccoglie ogni riga corrispondente](/docs/sdk/pagination#reading-everything-iterate-and-findall) | Restituisce `M[]` |
| `.count()` | Conta le righe corrispondenti | Restituisce `number` |
| `.listen(onUpdate, onError?)` | Sottoscrive gli aggiornamenti in tempo reale | Restituisce `unsubscribe()` |

### Operatori di filtro

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
| `"array-contains-all"` | `"csall"` | Il campo array contiene tutti i valori |
| `"array-contained-by"` | `"cd"` | Il campo array contiene solo questi valori (incluso un array vuoto) |
| `"like"` | `"like"` | Corrispondenza di pattern **case-sensitive**; `%` e `_` sono i caratteri jolly |
| `"ilike"` | `"ilike"` | Corrispondenza di pattern case-insensitive |
| `"not-like"` | `"nlike"` | Non corrisponde al pattern |
| `"not-ilike"` | `"nilike"` | Non corrisponde al pattern, in modo case-insensitive |
| `"is-null"` | `"isnull"` | La colonna è `NULL`. Non accetta alcun valore — qualsiasi valore passato viene normalizzato |
| `"is-not-null"` | `"notnull"` | La colonna non è `NULL`. Non accetta alcun valore |

La colonna alias indica la grafia su **rete (wire)**, utilizzata nelle query string REST. Non compare
mai nel codice dell'applicazione: sia l'SDK che il pannello di amministrazione utilizzano l'operatore
canonico a sinistra.

I quattro operatori per array funzionano sia su colonne array native (`text[]`, `integer[]`,
…) che su array JSONB, e un indice GIN sulla colonna li gestisce tutti. Per elencare gli
elementi distinti di una colonna array, raggruppa un'aggregazione tramite
`unnest(<field>)` (vedi [Aggregazioni](/docs/sdk/aggregates-and-search/#grouping-by-an-expression)).

I quattro operatori di pattern confrontano testo. Un campo `enum` viene confrontato in base al suo valore,
quindi `{ status: ["like", "draft%"] }` funziona su uno stato memorizzato come enum di Postgres.
Su numeri, date o qualsiasi altro campo che non sia testo, vengono rifiutati con un errore
400 `INVALID_FILTER_OPERATOR`.

### Ignorare maiuscole e minuscole: `lower(field)`

Una chiave di filtro può convertire un campo di testo in un unico formato di maiuscole/minuscole — `lower(artist)` o
`upper(code)` — e qualsiasi operatore confronterà quindi il valore convertito, pertanto scrivi
i valori in quel formato:

```typescript
await client.data.songs.find({
    where: { "lower(artist)": ["in", ["abba", "queen"]] }
});
```

Viene compilato in `lower(artist) = ANY($1)`: un'unica lista vincolata di lunghezza arbitraria, supportata
da un indice su `lower(artist)`. Tramite HTTP la chiave viene scritta nello stesso modo:
`?lower(artist)=in.(abba,queen)`.

### Sintassi della clausola Where

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

> **Nota:** Le stringhe PostgREST pre-serializzate (formato 2) sono una via di fuga per passare valori di filtro già in formato wire. È preferibile utilizzare la sintassi a tuple per garantire la type safety e la leggibilità.

## Condizioni logiche (OR / AND / NOT)

Ogni campo in `where` viene combinato con AND. Per combinare condizioni con OR, o per negare un
gruppo, costruisci una **condizione logica** con gli helper `or`, `and`, `not` e `cond`
esportati dall'SDK:

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

`cond` accetta l'operatore canonico — la colonna di sinistra della tabella degli
[Operatori di filtro](#operatori-di-filtro). Un operatore non supportato dal dialetto genera un
`TypeError` durante la serializzazione della query, anziché eseguire silenziosamente una
query diversa.

Su un client con [tipi generati](/docs/sdk#typed-sdk-generation), `logical` e `.where(group)`
verificano ogni condizione dell'albero rispetto alla riga, esattamente come fa `where`: una
colonna non presente nella riga, o un valore del tipo errato per l'operatore
(`cond("views", "==", "many")` su una colonna numerica), generano un errore di compilazione. Un
percorso di relazione o JSON (`author.name`, `metadata->>tier`) non viene verificato.

### Negazione

`not` nega la **congiunzione** delle sue condizioni: `not(a)` equivale a `NOT a`, e
`not(a, b)` equivale a `NOT (a AND b)`. I gruppi possono essere annidati, quindi l'altra legge di De Morgan è
`not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Viene compilato in un vero `NOT (...)` SQL, non in operatori invertiti. Questa
distinzione non è puramente formale: la logica SQL è a tre valori, quindi `NOT (a AND b)` e
`(NOT a) OR (NOT b)` cessano di concordare non appena è coinvolto un `NULL`, e solo una
delle due corrisponde alla query effettivamente scritta.

Significa inoltre che una negazione **include le righe la cui colonna è NULL** —
`not(cond("status", "==", "draft"))` restituisce le righe che non hanno alcuno stato.
Questo è il reale significato di `NOT`, ed è solitamente ciò che si desidera; in caso contrario,
aggiungi una condizione `is-not-null` in AND.

### Come si compone con il resto della query

`where`, `logical` e `search` sono tre gruppi indipendenti, combinati tra loro con AND:

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

Non c'è modo di combinare `where` in OR con `logical`. Tutto ciò che non è un semplice
AND tra i tre deve essere espresso all'interno di un unico albero `logical` — sposta al
suo interno i campi che desideri combinare con OR.

### Su rete

Un gruppo logico viaggia come singolo parametro di query `or=`, `and=` o `not=`,
usando la stessa sintassi con il punto utilizzata dai filtri di campo:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Si applica solo uno dei tre per richiesta — `or` ha la precedenza su `and`, ed entrambi su
`not`. Annida un gruppo dentro l'altro per combinarli.

Tre codifiche meritano di essere conosciute, poiché sono quelle in cui è facile sbagliare
scrivendo a mano la query string:

| Condizione | Formato wire | Nota |
|------------|--------------|------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` cerca la stringa di quattro caratteri `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` è un elenco contenente una singola stringa vuota, che corrisponde a una query diversa |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | un [percorso di relazione](/docs/sdk/relations#querying-through-a-relation) mantiene il suo punto |

Virgole, parentesi e barre rovesciate all'interno di un valore vengono precedute da un backslash di escape, quindi
`cond("name", "==", "Doe, John")` viaggia come `name.eq.Doe\, John` senza spezzare
il gruppo.

I gruppi possono essere annidati fino a 32 livelli di profondità. Oltre questo limite la richiesta viene rifiutata con
`INVALID_LOGICAL_GROUP` — appiattiscila, dato che `or(a,or(b,c))` equivale a `or(a,b,c)`.

## Paginazione

Offset, numeri di pagina e cursori keyset hanno una pagina dedicata:
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

Se la direzione viene omessa, il valore predefinito è `"asc"` — lo stesso significato di `?orderBy=name` via
HTTP, qualunque sia il database sottostante.

### Ordinamento per più colonne

Un ordinamento è un'*elenco* di chiavi. La seconda stabilisce l'ordine tra righe considerate
uguali dalla prima, la terza tra righe considerate uguali dalle prime due — di conseguenza `orderBy` accetta un elenco di
coppie `[campo, direzione]` con la stessa facilità di una singola coppia:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

Nel fluent builder la stessa cosa si ottiene chiamando nuovamente `.orderBy()`. Ciascuna
chiamata **aggiunge** una chiave sotto quelle precedenti anziché sostituirle:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Ogni ordinamento termina con l'id di riga, decrescente, indipendentemente dal fatto che sia stato richiesto o meno.
È questo che rende l'ordinamento *totale*: in caso contrario, due righe con lo stesso valore verrebbero
restituite nell'ordine scelto arbitrariamente dal database, e paginare su un ordine che può variare tra due
esecuzioni della stessa query comporterebbe la ripetizione di alcune righe e il salto di altre.

L'ordinamento su più colonne funziona correttamente con un [cursore](/docs/sdk/pagination#cursor-pagination): il
confronto viene costruito su ciascuna chiave, in ordine. L'unico ordinamento che un cursore non può
descrivere è **`_score`** — vedi [Ricerca](/docs/backend/search). La rilevanza viene calcolata per ogni query anziché
memorizzata, pertanto non esiste alcun valore sulla riga del cursore con cui confrontare la pagina successiva,
e un tale elenco non include alcun `nextCursor`.

### Posizione dei valori NULL nell'ordinamento

Per impostazione predefinita, i valori NULL vengono ordinati **per ultimi in senso crescente e per primi in senso decrescente** —
la convenzione tipica di Postgres. Questo comportamento predefinito posiziona ogni riga senza data in cima a un
elenco "più recenti prima", precedendo tutti i record effettivi; in passato l'unica soluzione consisteva
nell'utilizzare un filtro `is-not-null` per escludere del tutto tali righe.

Un terzo elemento nella chiave specifica dove posizionarli:

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

Tramite HTTP si utilizza un terzo segmento separato da due punti, `?orderBy=publishedAt:desc:last`, oppure una
chiave `"nulls"` nella forma con array JSON. Qualsiasi valore diverso da `first`/`last` genera un errore
400 anziché un ordinamento silenziosamente errato.

Il [cursore](/docs/sdk/pagination#cursor-pagination) rispetta quanto dichiarato per l'ordinamento, per cui la paginazione
su una chiave nullable rimane corretta in entrambe le posizioni.

## Restituzione di un sottoinsieme di colonne

`fields` restringe la lettura alle colonne specificate. Si tratta di una proiezione a livello di database — sono
le colonne effettivamente *lette*, non quelle che sopravvivono a un ritaglio della risposta — quindi una query
che necessita di due soli campi di una riga estesa non paga il costo per il resto:

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Due regole valgono sempre, indipendentemente da cosa specifichi:

- **La chiave primaria viene sempre restituita.** Una riga che non può essere indirizzata non può essere
  aggiornata, eliminata o superata con la paginazione — e `meta.nextCursor` deriva da essa, quindi
  una proiezione priva di chiave primaria disabiliterebbe silenziosamente il posizionamento del cursore.
- **Le colonne `excludeFromApi` rimangono nascoste.** Specificare una di esse non la renderà visibile.

Una colonna sconosciuta restituisce un errore 400 `UNKNOWN_FIELD`. Se venisse interpretata come "ometterla", un refuso come
`fields: ["titel"]` restituirebbe righe prive di titoli senza alcun indizio sul motivo.

Una relazione indicata in `include` viene caricata indipendentemente dal fatto che compaia in `fields`;
per restringere le colonne *all'interno* di una relazione, consulta le
[opzioni per singola relazione](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

`distinct` collassa le righe identiche sulle colonne restituite, e una lettura con distinct restituisce
**solo** le colonne specificate — la chiave primaria viene esclusa dalla proiezione, a differenza di ogni
altra lettura. Deve essere così: una chiave surrogata differisce su ogni riga, pertanto mantenerla
renderebbe ogni riga unica per costruzione e la query risponderebbe 200 senza aver raggruppato nulla.

Ciò lo rende significativo solo se usato insieme a `fields`. Senza di esso verrebbe richiesta ogni
colonna visibile, chiave inclusa, e non verrebbe collassato nulla:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

Una lettura con distinct non indirizza alcuna riga specifica — non c'è una chiave con cui indirizzarle — quindi
restituisce un insieme di valori anziché un insieme di righe da aggiornare o eliminare, e non fornisce alcun `nextCursor`.
Inoltre, non riporta **alcun `meta.total`**: per il conteggio sarebbe necessario un `COUNT(DISTINCT …)` che il driver non esegue,
e riportare il conteggio delle righe descriverebbe un insieme diverso da quello restituito — un risultato completo
di due righe verrebbe restituito come `total: 8, hasMore: true`, causando una paginazione infinita nel client.
`hasMore` deriva dalla pagina stessa.

Due combinazioni vengono rifiutate anziché produrre risposte inutilizzabili:

- **Una query che assegna un punteggio a ciascuna riga** — una `search()` con ordinamento o una `vectorSearch()`
  associa un `_score`/`_distance` a ogni riga, rendendo le righe mai uguali tra loro e privando `DISTINCT`
  di qualsiasi effetto. (Una semplice ricerca di sottostringhe non associa nulla ed è consentita.)
- **Ordinamento per una colonna non restituita.** Postgres non può ordinare una lettura `DISTINCT`
  mediante un'espressione esterna all'elenco di select; la richiesta restituisce un errore 400
  `DISTINCT_ORDER_BY_NOT_SELECTED` anziché un 500 che cita query SQL mai scritte.

Via HTTP: `?fields=status&distinct=true`.

## Aggregazioni

`aggregate()` aggrega (riduce) le righe corrispondenti anziché restituirle — `count`,
`sum`, `avg`, `min`, `max`, opzionalmente raggruppate:

```typescript
const rows = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }, { fn: "count" }],
    groupBy: ["status"],
    where: { createdAt: [">=", startOfMonth] }
});
// [{ status: "paid", sum_total: 41822.5, count: 317 }, …]
```

I filtri del query builder vengono mantenuti, rappresentando di solito la sintassi più concisa:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

Le chiavi dei risultati sono **derivate**, non scelte arbitrariamente: `sum(total)` viene restituito come `sum_total`,
un semplice `count()` come `count`. Consentire di rinominarli richiederebbe di verificare che il nome non coincida
anche con un campo di `groupBy` — una regola controintuitiva, con il rischio di sovrascrivere valori in modo
silenzioso in assenza di controlli.

I gruppi vengono paginati come le righe di un elenco: `limit` ne delimita il numero e `offset` ne salta una parte (il
raggruppamento per una colonna ad alta cardinalità potrebbe restituire l'equivalente di un'intera tabella in una sola
risposta). Un'aggregazione raggruppata senza `limit` assume il valore predefinito degli elenchi —
**50 gruppi** via HTTP — perciò consulta `meta` nel risultato prima di considerarlo completo:

```typescript
const byCustomer = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }],
    groupBy: ["customerId"],
    limit: 200
});
byCustomer.meta; // { limit: 200, offset: 0, hasMore: true } — page on with offset: 200
```

Il risultato rimane un array di righe; `meta` è una proprietà non enumerabile, per cui uno spread operator
o `JSON.stringify` vedrà solo le righe. È presente ogni volta che i gruppi sono stati limitati da un `limit`.
Senza un `groupBy` è presente una sola riga, `limit` non ha effetto e `offset` viene rifiutato. In una server
function (`rebase.data`, `context.data`), un'aggregazione raggruppata senza `limit` restituisce tutti i gruppi.
`include` non viene inviato con un'aggregazione: non ci sono relazioni da caricare. I gruppi possono essere ordinati
con `orderBy`, tramite una colonna di `groupBy` o la chiave di un'aggregazione — vedi
[Aggregazioni e ricerca](/docs/sdk/aggregates-and-search/).

L'obiettivo fondamentale è evitare di recuperare le righe per poi aggregarle client-side. "Entrate per stato"
su un milione di ordini equivale a un'unica query e a una riga per ciascuno stato, mentre altrove richiederebbe
un `findAll()` più un ciclo — approccio errato in presenza di un `limit` e insostenibile senza di esso.
L'operazione viene eseguita tramite lo stesso handler con ambito di richiesta (request-scoped) di ogni altra
lettura, garantendo l'applicazione della row-level security alle righe aggregate.

Via HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

Il filtraggio JSON, la ricerca full-text e la ricerca vettoriale hanno una pagina dedicata:
[Aggregazioni e ricerca](/docs/sdk/aggregates-and-search/).

La lettura delle entità correlate — `include` e gli accessor per interrogare tramite relazioni — ha una pagina
dedicata: [Interrogazione delle relazioni](/docs/sdk/relations/).

## Endpoint personalizzati

Chiama endpoint server personalizzati registrati tramite il sistema delle funzioni:

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

Entrambi restituiscono **il corpo della risposta della funzione, testuale**. Nessuno dei due estrae una chiave
`data`, quindi una funzione che restituisce `{ data: [...] }` restituirà quell'oggetto e spetterà a te accedere
a `.data`.

`call()` accetta un percorso completo ed esegue sempre una POST; `invoke()` accetta il nome di una funzione
e può ricevere un metodo, un sotto-percorso e intestazioni (headers). Usa `invoke()` a meno che tu non stia
chiamando qualcosa che non è una funzione.

## Prossimi passi

- **[Autenticazione](/docs/sdk/authentication)** — Accesso, registrazione, OAuth, sessioni
- **[Sottoscrizioni Realtime](/docs/sdk/realtime)** — Dati in tempo reale con WebSocket
- **[Storage e File](/docs/sdk/storage)** — Caricamento, download e gestione dei file
- **[Relazioni](/docs/collections/relations)** — Definizione delle relazioni tra tabelle
