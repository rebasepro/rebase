---
sourceHash: 3cba57377cf922df
title: Interrogare i dati
sidebar_label: Interrogare i dati
description: Operazioni CRUD, fluent query builder, operatori di filtro, ordinamento, selezione delle colonne e aggregazioni con l'SDK client Rebase.
---

## Accesso alle collezioni

Accedi a qualsiasi collezione tramite `client.data.<collectionName>` (camelCase, convertito automaticamente in snake_case) o `client.data.collection<Record<string, unknown>>("slug")` (slug esplicito):

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Strict mode (SDK generato):** Quando passi il `collectionsDictionary` generato a `createRebaseClient`, il proxy dei dati convalida gli accessi alle proprietà al momento dell'accesso. Un errore di battitura come `client.data.prodcuts` genererà immediatamente un errore utile con un suggerimento della corrispondenza più vicina, invece di produrre un fuorviante 404 in seguito. Usa `client.data.collection<Record<string, unknown>>("slug")` per ignorare la convalida nel caso di slug dinamici o determinati a runtime.

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

### Lettura singola per ID

Sono disponibili due metodi, poiché rispondono a due esigenze diverse che richiedono codice differente.

`get` serve per una riga di cui si prevede l'esistenza: l'ID proviene da un link, da un parametro di route o da un'altra riga. Restituisce la riga, evitando la necessità di verifiche di tipo a valle; una riga mancante genera un'eccezione su cui è possibile gestire le diramazioni:

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

`findById` serve per una riga che potrebbe legittimamente non esistere: una ricerca tramite un ID digitato da un utente o un controllo nella cache:

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

:::note
La sicurezza a livello di riga (Row-level security) fa sì che "riga inesistente" e "non hai i permessi di lettura" restituiscano deliberatamente la stessa risposta: un 404 che facesse distinzione tra i due casi confermerebbe l'esistenza della riga.
:::

### Scrittura

`create`, `upsert`, `update`, `delete` e le relative varianti batch sono descritte in **[Scrittura dei dati](/docs/sdk/writing/)**, insieme alle operazioni sui campi, alle scritture condizionali e alle chiavi di idempotenza.

### Count

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Fluent Query Builder

Concatena i metodi per creare query più espressive:

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
| `.where(path, op, value)` | Filtra su una [relazione](#querying-through-a-relation) o su un percorso [JSON](#filtering-inside-json) | `.where("author.name", "==", "bob")` |
| `.where(group)` | Aggiunge un [gruppo OR/AND](#logical-conditions-or--and) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Ordina i risultati | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Ordina in base a un'[aggregazione su una relazione](#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limita il numero di risultati | `.limit(25)` |
| `.offset(n)` | Salta i primi N risultati | `.offset(50)` |
| `.after(cursor)` | Continua dopo un [cursore](#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Restituisce [solo queste colonne](#returning-fewer-columns) | `.fields("id", "title")` |
| `.distinct()` | Raggruppa le righe identiche rispetto a tali colonne | `.fields("status").distinct()` |
| `.search(text)` | Ricerca testuale — vedi [Ricerca](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Ricerca dei vicini più prossimi (nearest-neighbour) su una proprietà `vector` | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Carica le righe correlate](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Esegue la query | Restituisce `FindResult<M>` |
| `.aggregate(params)` | [Esegue un'aggregazione invece di restituire le righe](#aggregates) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Esegue lo streaming di ogni riga corrispondente](#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Raccoglie ogni riga corrispondente](#reading-everything-iterate-and-findall) | Restituisce `M[]` |
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
| `"like"` | `"like"` | Corrispondenza di pattern **case-sensitive**; `%` e `_` sono i caratteri jolly |
| `"ilike"` | `"ilike"` | Corrispondenza di pattern case-insensitive |
| `"not-like"` | `"nlike"` | Non corrisponde al pattern |
| `"not-ilike"` | `"nilike"` | Non corrisponde al pattern, in modo case-insensitive |
| `"is-null"` | `"isnull"` | La colonna è `NULL`. Non accetta valori — qualsiasi valore passato viene normalizzato e ignorato |
| `"is-not-null"` | `"notnull"` | La colonna non è `NULL`. Non accetta valori |

La colonna alias indica la grafia utilizzata a livello di **trasmissione (wire)**, impiegata nelle query string REST. Non compare mai nel codice dell'applicazione: sia l'SDK che il pannello di amministrazione utilizzano l'operatore canonico a sinistra.

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

> **Nota:** Le stringhe PostgREST pre-serializzate (formato 2) sono una via di fuga (escape hatch) per passare valori di filtro già nel formato wire. È preferibile utilizzare la sintassi a tuple per motivi di type safety e leggibilità.

## Condizioni logiche (OR / AND / NOT)

Ogni campo presente in `where` viene combinato con un AND. Per combinare condizioni con OR, o per negare un gruppo, costruisci una **condizione logica** con gli helper `or`, `and`, `not` e `cond` esportati dall'SDK:

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

`cond` accetta l'operatore canonico — la colonna di sinistra della tabella degli [Operatori di filtro](#filter-operators). Un operatore non supportato dal dialetto genera un `TypeError` durante la serializzazione della query, invece di produrre silenziosamente una query diversa.

### Negazione

`not` nega la **congiunzione** delle sue condizioni: `not(a)` equivale a `NOT a`, e `not(a, b)` a `NOT (a AND b)`. I gruppi possono essere annidati, quindi l'altra legge di De Morgan è `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Viene compilato in un vero `NOT (...)` SQL, non in operatori invertiti. Questa distinzione non è cosmetica: SQL adotta una logica a tre valori, quindi `NOT (a AND b)` e `(NOT a) OR (NOT b)` smettono di coincidere non appena entra in gioco un valore `NULL`, e solo una delle due rappresenta la query che hai effettivamente scritto.

Ciò significa anche che una negazione **include le righe la cui colonna è NULL** — `not(cond("status", "==", "draft"))` restituisce le righe prive di alcuno stato. Questo è il significato di `NOT`, ed è solitamente ciò che si desidera; in caso contrario, aggiungi un `is-not-null` con AND.

### Come si compone con il resto della query

`where`, `logical` e `search` sono tre gruppi indipendenti, combinati tra loro con AND:

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

Non è possibile combinare con un OR `where` e `logical`. Tutto ciò che non è un semplice AND tra i tre elementi deve essere espresso all'interno di un unico albero `logical`: sposta al suo interno i campi che desideri combinare con OR.

### A livello di trasmissione (On the wire)

Un gruppo logico viaggia come singolo parametro di query `or=`, `and=` o `not=`, con la stessa sintassi a punti utilizzata dai filtri di campo:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Per ciascuna richiesta si applica solo uno dei tre: `or` ha la precedenza su `and`, ed entrambi su `not`. Annida un gruppo dentro un altro per combinarli.

Vale la pena conoscere tre codifiche, poiché sono quelle in cui una query string scritta a mano rischia più facilmente di sbagliare:

| Condizione | Formato wire | Nota |
|------------|--------------|------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` cerca la stringa di quattro caratteri `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` è una lista contenente una singola stringa vuota, che corrisponde a una query diversa |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | un [percorso di relazione](#querying-through-a-relation) mantiene il proprio punto |

Virgole, parentesi e barre rovesciate all'interno di un valore vengono precedute da un backslash di escape: di conseguenza `cond("name", "==", "Doe, John")` viaggia come `name.eq.Doe\, John` senza frammentare il gruppo.

I gruppi possono essere annidati fino a un massimo di 32 livelli. Superata tale soglia, la richiesta viene rifiutata con l'errore `INVALID_LOGICAL_GROUP` — in tal caso è consigliabile appiattirla, dato che `or(a,or(b,c))` equivale a `or(a,b,c)`.

## Paginazione

Offset, numeri di pagina e cursori keyset sono trattati in una pagina dedicata:
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

Se la direzione viene omessa, assume come valore predefinito `"asc"` — lo stesso significato di `?orderBy=name` su HTTP, indipendentemente dal database sottostante.

### Ordinamento su più colonne

Un ordinamento è un'*elenco* di chiavi. La seconda dirime i casi di parità tra le righe considerate uguali dalla prima, la terza tra quelle considerate uguali dalle prime due — di conseguenza `orderBy` accetta un elenco di coppie `[campo, direzione]` con la stessa naturalezza di una coppia singola:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

Nel fluent builder si ottiene lo stesso risultato richiamando `.orderBy()`. Ciascuna chiamata **aggiunge** una chiave a valle delle precedenti anziché sostituirle:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Ogni ordinamento termina con l'ID della riga in ordine decrescente, indipendentemente dal fatto che sia stato richiesto o meno. È questo che rende l'ordinamento *totale*: senza questo criterio, due righe che condividono lo stesso valore verrebbero restituite nell'ordine arbitrario scelto dal database, e la paginazione su un ordinamento che può variare tra due esecuzioni della stessa query comporterebbe la ripetizione di alcune righe e l'omissione di altre.

Un ordinamento a più colonne funziona regolarmente con un [cursore](#cursor-pagination): il confronto viene costruito su ciascuna chiave, in ordine. L'unico ordinamento che un cursore non può descrivere è **`_score`** — vedi [Ricerca](/docs/backend/search). La rilevanza viene calcolata per ciascuna query anziché essere memorizzata, pertanto non esiste alcun valore sulla riga del cursore rispetto al quale confrontare la pagina successiva, e un tale elenco non include alcun `nextCursor`.

### Posizione dei valori NULL nell'ordinamento

Per impostazione predefinita, i valori NULL vengono posizionati **per ultimi in ordine crescente e per primi in ordine decrescente** — secondo la convenzione adottata da Postgres. Questo comportamento predefinito posiziona ogni riga priva di data in cima a un elenco ordinato per "più recenti", davanti a tutti i dati validi; in precedenza, l'unico modo per evitarlo era utilizzare un filtro `is-not-null` che escludeva completamente tali righe.

Un terzo elemento nella chiave consente di specificarne la collocazione alternativa:

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

Su HTTP si utilizza un terzo segmento separato da due punti, `?orderBy=publishedAt:desc:last`, oppure una chiave `"nulls"` nel formato array JSON. Qualsiasi valore diverso da `first`/`last` restituisce un errore 400 anziché applicare un ordinamento silenziosamente diverso.

Il [cursore](#cursor-pagination) rispetta qualsiasi impostazione definita per l'ordinamento, garantendo che la paginazione su una chiave nullable rimanga coerente con entrambe le collocazioni.

## Restituire meno colonne

`fields` restringe la lettura alle sole colonne indicate. Si tratta di una proiezione eseguita direttamente dal database — sono le colonne effettivamente *lette*, non quelle superstiti dopo un troncamento della risposta — per cui una query che richiede due soli campi di una riga molto ampia non paga il costo di lettura degli altri:

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Valgono sempre due principi invariabili, indipendentemente dai campi specificati:

- **La chiave primaria viene sempre restituita.** Una riga non indirizzabile non può essere aggiornata, eliminata o superata con la paginazione — inoltre `meta.nextCursor` deriva da essa, quindi una proiezione priva della chiave disabiliterebbe silenziosamente la navigazione per cursore (seeking).
- **Le colonne con `excludeFromApi` rimangono nascoste.** Specificare il loro nome non le rende visibili.

Una colonna sconosciuta genera un errore 400 `UNKNOWN_FIELD`. Se venisse interpretata come "omettila", un errore di battitura come `fields: ["titel"]` restituirebbe righe prive di titoli senza alcun indizio sul motivo.

Una relazione indicata in `include` viene caricata a prescindere dal fatto che compaia o meno in `fields`; per limitare le colonne *all'interno* di una relazione, consulta le [opzioni per relazione](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

`distinct` raggruppa le righe identiche rispetto alle colonne restituite, e una lettura distinct restituisce **solo** le colonne specificate — la chiave primaria viene esclusa dalla proiezione, a differenza di qualsiasi altra lettura. È necessario che sia così: una chiave surrogata differisce su ogni riga, quindi mantenerla renderebbe ogni riga univoca per definizione e la query risponderebbe 200 senza aver applicato alcun raggruppamento.

Ciò lo rende significativo solo in abbinamento a `fields`. Senza di esso verrebbe richiesta ogni colonna visibile, chiave inclusa, e non si verificherebbe alcun raggruppamento:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

Una lettura distinct non fa riferimento a righe specifiche — non essendoci una chiave tramite cui indirizzarle — pertanto restituisce un insieme di valori anziché un insieme di righe da aggiornare o eliminare, e non include alcun `nextCursor`. Inoltre non riporta **alcun `meta.total`**: il conteggio richiederebbe un `COUNT(DISTINCT …)` che il driver non esegue, e riportare il semplice numero di righe descriverebbe un insieme diverso da quello servito — un risultato completo di due righe tornerebbe come `total: 8, hasMore: true`, inducendo il client a paginare all'infinito. `hasMore` viene ricavato dalla pagina stessa.

Due combinazioni vengono rifiutate anziché produrre un risultato privo di utilità:

- **Una query che assegna un punteggio a ogni riga** — una `search()` ordinata per rilevanza o una `vectorSearch()` associa uno `_score`/`_distance` a ogni riga, per cui due righe non risulterebbero mai identiche e `DISTINCT` non avrebbe alcun effetto. (Una semplice ricerca per sottostringa non associa nulla ed è consentita.)
- **L'ordinamento in base a una colonna non restituita.** Postgres non può ordinare una lettura `DISTINCT` tramite un'espressione esclusa dalla clausola select; la richiesta restituisce un errore 400 `DISTINCT_ORDER_BY_NOT_SELECTED` invece di un errore 500 che cita codice SQL mai scritto.

Su HTTP: `?fields=status&distinct=true`.

## Aggregazioni

`aggregate()` riduce le righe corrispondenti anziché restituirle — `count`, `sum`, `avg`, `min`, `max`, opzionalmente raggruppate:

```typescript
const rows = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }, { fn: "count" }],
    groupBy: ["status"],
    where: { createdAt: [">=", startOfMonth] }
});
// [{ status: "paid", sum_total: 41822.5, count: 317 }, …]
```

I filtri impostati sul builder vengono ereditati dall'aggregazione, il che rappresenta solitamente la forma più concisa:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

Le chiavi dei risultati sono **derivate**, non personalizzabili: `sum(total)` viene restituito come `sum_total`, un semplice `count()` come `count`. Consentire di rinominarle comporterebbe dover verificare che il nome scelto non coincida con un campo presente in `groupBy` — una regola controintuitiva che, se ignorata, porterebbe a sovrascrivere silenziosamente dei valori.

`limit` vincola il numero di **gruppi** (il raggruppamento su una colonna ad alta cardinalità potrebbe restituire l'equivalente di un'intera tabella di righe in un'unica risposta) e viene ignorato in assenza di `groupBy`, poiché un'aggregazione non raggruppata produce una sola riga. `orderBy`, `include` e la paginazione non si applicano: un'aggregazione non ha righe da ordinare, relazioni da caricare né pagine da continuare.

Il vantaggio fondamentale consiste nell'evitare di scaricare le righe solo per aggregarle. Il "fatturato per stato" su un milione di ordini corrisponde in questo modo a un'unica query e a una sola riga per stato, mentre altrove richiederebbe una `findAll()` seguita da un ciclo — approccio non corretto in presenza di un `limit` e insostenibile senza di esso. L'operazione viene eseguita attraverso lo stesso handle contestuale alla richiesta usato da ogni altra lettura, per cui la sicurezza a livello di riga (RLS) si applica anche alle righe aggregate.

Su HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

I filtri JSON, la ricerca full-text e la ricerca vettoriale sono descritti in una pagina dedicata:
[Aggregazioni e ricerca](/docs/sdk/aggregates-and-search/).

La lettura di entità correlate — `include` e gli accessor per interrogare attraverso una relazione — ha una pagina dedicata: [Interrogazione delle relazioni](/docs/sdk/relations/).

## Endpoint personalizzati

Chiama gli endpoint server personalizzati registrati tramite il sistema di funzioni:

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

Entrambi i metodi restituiscono **il corpo della risposta della funzione, tale e quale (verbatim)**. Nessuno dei due estrae automaticamente una chiave `data`, per cui una funzione che risponde con `{ data: [...] }` restituisce direttamente quell'oggetto e spetta all'utente accedere a `.data`.

`call()` accetta un percorso completo ed effettua sempre una richiesta POST; `invoke()` accetta il nome di una funzione e può ricevere un metodo HTTP, un sotto-percorso e intestazioni. Usa `invoke()` a meno che non si stia chiamando qualcosa che non sia una funzione.

## Passaggi successivi

- **[Autenticazione](/docs/sdk/authentication)** — Accesso, registrazione, OAuth, sessioni
- **[Sottoscrizioni Realtime](/docs/sdk/realtime)** — Dati in tempo reale con i WebSocket
- **[Storage & File](/docs/sdk/storage)** — Carica, scarica e gestisci file
- **[Relazioni](/docs/collections/relations)** — Definisci relazioni tra collezioni

---
