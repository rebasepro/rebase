---
sourceHash: 6d40635c3d2f94ea
title: Interrogazione dei dati
sidebar_label: Interrogazione dei dati
description: Operazioni CRUD, fluent query builder, operatori di filtro, ordinamento, selezione delle colonne e aggregazioni con l'SDK Client di Rebase.
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

> **Modalità strict (SDK generato):** Quando passi il `collectionsDictionary` generato a `createRebaseClient`, il data proxy convalida gli accessi alle proprietà al momento dell'accesso. Un errore di battitura come `client.data.prodcuts` genererà immediatamente un'eccezione con un errore utile e un suggerimento per la corrispondenza più vicina, invece di produrre un fuorviante errore 404 in seguito. Usa `client.data.collection<Record<string, unknown>>("slug")` per bypassare la convalida per gli slug dinamici o determinati a runtime.

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

### Lettura di un elemento per ID

Due metodi, perché ci sono due situazioni diverse che richiedono codice differente.

`get` serve per una riga che prevedi esista: l'ID proviene da un link, da un parametro di route o da un'altra riga. Restituisce la riga, evitando così controlli di tipo a valle, e una riga mancante genera un'eccezione su cui puoi gestire i rami logici:

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

`findById` serve per una riga che potrebbe legittimamente non esistere: una ricerca tramite un ID digitato dall'utente, una verifica in cache:

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

:::note
La sicurezza a livello di riga (Row-level security) fa sì che "riga inesistente" e "non autorizzato alla lettura" diano deliberatamente la stessa risposta: un 404 che le distinguesse confermerebbe l'esistenza della riga.
:::

### Scrittura

`create`, `upsert`, `update`, `delete` e le relative forme batch sono descritti in **[Scrittura dei dati](/docs/sdk/writing/)**, insieme alle operazioni sui campi, alle scritture condizionali e alle chiavi di idempotenza.

### Count

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
| `.where(path, op, value)` | Filtra su una [relazione](#querying-through-a-relation) o su un percorso [JSON](#filtering-inside-json) | `.where("author.name", "==", "bob")` |
| `.where(group)` | Aggiunge un [gruppo OR/AND](#logical-conditions-or--and) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Ordina i risultati | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Ordina in base a un'[aggregazione su una relazione](#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limita il numero di risultati | `.limit(25)` |
| `.offset(n)` | Salta i primi N risultati | `.offset(50)` |
| `.after(cursor)` | Continua dopo un [cursore](#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Restituisce [solo queste colonne](#returning-fewer-columns) | `.fields("id", "title")` |
| `.distinct()` | Raggruppa le righe identiche su tali colonne | `.fields("status").distinct()` |
| `.search(text)` | Ricerca testuale — consulta [Search](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Ricerca dei vicini più prossimi (nearest-neighbour) su una proprietà `vector` | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Carica le righe correlate](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Esegue la query | Restituisce `FindResult<M>` |
| `.aggregate(params)` | [Esegue un'aggregazione invece di restituire righe](#aggregates) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Esegue lo streaming di ogni riga corrispondente](#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Raccoglie ogni riga corrispondente](#reading-everything-iterate-and-findall) | Restituisce `M[]` |
| `.count()` | Conta le righe corrispondenti | Restituisce `number` |
| `.listen(onUpdate, onError?)` | Sottoscrive gli aggiornamenti in tempo reale | Restituisce `unsubscribe()` |

### Operatori di filtro

| Operatore | Alias | Descrizione |
|-----------|-------|-------------|
| `"=="` | `"eq"` | Uguale |
| `"!="` | `"neq"` | Diverso da |
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
| `"is-null"` | `"isnull"` | La colonna è `NULL`. Non accetta valori: qualsiasi cosa venga passata viene rimossa durante la normalizzazione |
| `"is-not-null"` | `"notnull"` | La colonna non è `NULL`. Non accetta valori |

La colonna degli alias rappresenta la grafia utilizzata a livello di **protocollo (wire)** nelle stringhe di query REST. Non compare mai nel codice dell'applicazione: sia l'SDK che il pannello di amministrazione utilizzano l'operatore canonico a sinistra.

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

> **Nota:** Le stringhe PostgREST pre-serializzate (formato 2) sono una via di fuga per passare valori di filtro che si trovano già in formato wire. Preferisci la sintassi a tupla per la type safety e la leggibilità.

## Condizioni logiche (OR / AND / NOT)

Ogni campo in `where` viene combinato con AND. Per combinare condizioni con OR, o per negare un gruppo, crea una **condizione logica** con gli helper `or`, `and`, `not` e `cond` esportati dall'SDK:

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

Il fluent builder accetta lo stesso albero:

```typescript
const { data } = await client.data.products
    .where(or(cond("status", "==", "active"), cond("featured", "==", true)))
    .orderBy("createdAt", "desc")
    .find();
```

`cond` accetta l'operatore canonico, ovvero quello nella colonna sinistra della tabella degli [Operatori di filtro](#filter-operators). Un operatore non supportato dal dialetto genera un `TypeError` al momento della serializzazione della query, anziché produrre silenziosamente una query diversa.

### Negazione

`not` nega la **congiunzione** delle sue condizioni: `not(a)` corrisponde a `NOT a`, e `not(a, b)` corrisponde a `NOT (a AND b)`. I gruppi possono essere annidati, quindi l'altra legge di De Morgan si ottiene con `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Viene compilato in un vero e proprio `NOT (...)` SQL, non in operatori invertiti. Tale distinzione non è cosmetica: SQL adotta una logica a tre valori, quindi `NOT (a AND b)` e `(NOT a) OR (NOT b)` smettono di coincidere non appena entra in gioco un `NULL`, e solo una delle due espressioni corrisponde alla query scritta.

Ciò significa anche che una negazione **include le righe in cui la colonna è NULL**: `not(cond("status", "==", "draft"))` restituisce anche le righe prive di qualsiasi status. È proprio questo il significato di `NOT`, ed è solitamente ciò che si desidera; in caso contrario, aggiungi un `is-not-null` in AND.

### Come si compone con il resto della query

`where`, `logical` e `search` sono tre gruppi indipendenti, combinati tra loro con AND:

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

Non è possibile combinare in OR `where` con `logical`. Tutto ciò che non è un semplice AND tra i tre elementi deve essere espresso all'interno di un unico albero `logical`: sposta al suo interno i campi che necessitano di OR.

### A livello di protocollo (on the wire)

Un gruppo logico viaggia come singolo parametro di query `or=`, `and=` o `not=`, utilizzando la stessa sintassi con punto usata dai filtri di campo:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Solo uno dei tre si applica per richiesta: `or` ha la precedenza su `and`, ed entrambi prevalgono su `not`. Annida un gruppo dentro un altro per combinarli.

Ci sono tre codifiche utili da conoscere, poiché sono quelle in cui è facile sbagliare scrivendo a mano una query string:

| Condizione | Formato wire | Nota |
|-----------|--------------|------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` è una ricerca per la stringa di quattro caratteri `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` è un elenco contenente una singola stringa vuota, che corrisponde a una query differente |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | un [percorso di relazione](#querying-through-a-relation) mantiene il suo punto |

Virgole, parentesi e barre rovesciate (backslash) all'interno di un valore vengono sottoposte a escape con backslash; pertanto, `cond("name", "==", "Doe, John")` viaggia come `name.eq.Doe\, John` e non divide il gruppo.

I gruppi possono essere annidati fino a 32 livelli di profondità. Oltre questo limite la richiesta viene rifiutata con `INVALID_LOGICAL_GROUP`: in tal caso appiattiscila, dato che `or(a,or(b,c))` equivale a `or(a,b,c)`.

## Paginazione

Offset, numeri di pagina e cursori keyset hanno una pagina dedicata: [Paginazione](/docs/sdk/pagination/).

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

Se la direzione viene omessa, il valore predefinito è `"asc"`, che equivale a `?orderBy=name` via HTTP, indipendentemente dal database sottostante.

### Ordinamento su più colonne

Un ordinamento è un'*elenco* di chiavi. La seconda stabilisce l'ordine tra righe ritenute uguali dalla prima, la terza tra quelle ritenute uguali dalle prime due; pertanto, `orderBy` accetta un elenco di coppie `[campo, direzione]` esattamente come ne accetta una singola:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

Il fluent builder esprime la stessa cosa chiamando nuovamente `.orderBy()`. Ogni chiamata **aggiunge** una chiave dopo le precedenti anziché sostituirle:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Ogni ordinamento termina con l'ID di riga, in ordine decrescente, a prescindere dal fatto che sia stato richiesto o meno. È questo a rendere l'ordinamento *totale*: senza di esso, due righe con lo stesso valore verrebbero restituite nell'ordine arbitrario scelto dal database, e la paginazione su un ordine che può variare tra due esecuzioni della stessa query finirebbe per ripetere alcune righe e saltarne altre.

Un ordinamento a più colonne pagina correttamente tramite un [cursore](#cursor-pagination): il confronto viene eseguito su ciascuna chiave, in ordine. L'unico ordinamento che un cursore non può descrivere è **`_score`** — vedi [Ricerca](/docs/backend/search). La rilevanza viene calcolata per ogni query invece di essere memorizzata, quindi non esiste alcun valore sulla riga del cursore rispetto a cui confrontare la pagina successiva, e un tale elenco non restituirà alcun `nextCursor`.

### Posizione dei valori NULL nell'ordinamento

Per impostazione predefinita, i valori NULL vengono ordinati **per ultimi in ordine crescente e per primi in ordine decrescente** — secondo la convenzione propria di Postgres. Tale comportamento predefinito posiziona ogni riga priva di data in cima a un elenco "dal più recente", prima di tutti i dati effettivi, e in passato l'unica soluzione consisteva nell'applicare un filtro `is-not-null` per escludere del tutto tali righe.

Un terzo elemento sulla chiave consente di specificare dove collocarli:

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

Via HTTP viene espresso con un terzo segmento separato da due punti, `?orderBy=publishedAt:desc:last`, oppure con una chiave `"nulls"` nel formato array JSON. Qualsiasi valore diverso da `first`/`last` genera un errore 400 anziché un ordinamento silenziosamente errato.

Il [cursore](#cursor-pagination) rispetta qualsiasi configurazione dichiarata per l'ordinamento, garantendo così che la paginazione su una chiave che ammette valori null rimanga corretta in entrambe le posizioni.

## Restituzione di un numero inferiore di colonne

`fields` limita la lettura alle sole colonne indicate. Si tratta di una proiezione a livello di database: quelle sono le colonne effettivamente *lette*, non quelle che sopravvivono a un ritaglio della risposta. Di conseguenza, una query che richiede solo due campi di una riga estesa non paga il costo di tutti gli altri:

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Due principi sono sempre validi, indipendentemente dai campi specificati:

- **La chiave primaria viene sempre restituita.** Una riga non indirizzabile non può essere aggiornata, eliminata o superata con la paginazione; inoltre, `meta.nextCursor` viene ricavato da essa, quindi una proiezione priva della chiave disabiliterebbe silenziosamente la navigazione.
- **Le colonne `excludeFromApi` rimangono nascoste.** Specificare il loro nome non le rende visibili.

Una colonna sconosciuta genera un errore 400 `UNKNOWN_FIELD`. Se venisse interpretata come "ometterla", un refuso come `fields: ["titel"]` restituirebbe righe senza titoli senza alcun indizio sul motivo.

Una relazione specificata in `include` viene caricata a prescindere che compaia o meno in `fields`; per limitare le colonne *all'interno* di una relazione, consulta le [opzioni per singola relazione](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

`distinct` unifica le righe che risultano identiche rispetto alle colonne restituite. Ha senso solo se utilizzato insieme a `fields`, poiché la chiave primaria è sempre inclusa nella proiezione e ogni riga risulterebbe altrimenti già distinta:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

Anche `meta.total` calcola il conteggio delle righe distinte, pertanto `hasMore` descrive l'insieme oggetto di paginazione. Due combinazioni vengono rifiutate anziché restituire un risultato inutile:

- **Una query che attribuisce un punteggio a ciascuna riga** — una query classificata con `search()` o un `vectorSearch()` assegna un `_score`/`_distance` per ogni riga, quindi due righe non risulteranno mai uguali e `DISTINCT` non produrrebbe alcun effetto. (Una semplice ricerca di sottostringhe non assegna nulla ed è supportata.)
- **L'ordinamento in base a una colonna non restituita.** Postgres non può ordinare una lettura `DISTINCT` in base a un'espressione non inclusa nell'elenco di selezione; la richiesta genera un errore 400 `DISTINCT_ORDER_BY_NOT_SELECTED` anziché un errore 500 che cita query SQL mai scritte.

Via HTTP: `?fields=status&distinct=true`.

## Aggregazioni

`aggregate()` riduce le righe corrispondenti invece di restituirle — `count`, `sum`, `avg`, `min`, `max`, con raggruppamento opzionale:

```typescript
const rows = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }, { fn: "count" }],
    groupBy: ["status"],
    where: { createdAt: [">=", startOfMonth] }
});
// [{ status: "paid", sum_total: 41822.5, count: 317 }, …]
```

I filtri del builder vengono mantenuti al suo interno, offrendo solitamente una sintassi più concisa:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

Le chiavi dei risultati sono **derivate**, non arbitrarie: `sum(total)` viene restituito come `sum_total`, un semplice `count()` come `count`. Consentire di personalizzarne il nome comporterebbe la necessità di verificare che tale nome non coincida con un campo di `groupBy` — una regola non intuitiva che, se non verificata, sovrascriverebbe silenziosamente un valore.

`limit` delimita il numero di **gruppi** (il raggruppamento su una colonna ad alta cardinalità restituirebbe l'equivalente di un'intera tabella di righe in una singola risposta) e viene ignorato in assenza di un `groupBy`, poiché un'aggregazione non raggruppata produce una sola riga. `orderBy`, `include` e la paginazione non sono applicabili: un'aggregazione non ha righe da ordinare, relazioni da caricare o pagine da scorrere.

L'intero obiettivo è evitare di recuperare righe al solo scopo di aggregarle. Il calcolo delle "entrate per stato" su un milione di ordini corrisponde qui a una singola query e a una sola riga per stato, mentre altrove richiederebbe un `findAll()` abbinato a un ciclo — approccio errato se sottoposto a `limit` e insostenibile senza di esso. L'operazione viene eseguita tramite lo stesso handle associato alla richiesta di ogni altra lettura, per cui la sicurezza a livello di riga (row-level security) si applica anche alle righe aggregate.

Via HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

Il filtraggio JSON, la ricerca full-text e la ricerca vettoriale hanno una pagina dedicata: [Aggregazioni e ricerca](/docs/sdk/aggregates-and-search/).

La lettura delle entità correlate — `include` e i metodi di accesso per interrogare tramite una relazione — ha una pagina dedicata: [Interrogazione delle relazioni](/docs/sdk/relations/).

## Endpoint personalizzati

Esegui chiamate a endpoint server personalizzati registrati tramite il sistema delle funzioni:

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

Entrambi restituiscono **il corpo della risposta della funzione, testuale**. Nessuno dei due estrae automaticamente una chiave `data`, pertanto una funzione che risponde con `{ data: [...] }` restituirà quell'oggetto e spetterà a te leggere `.data`.

`call()` accetta un percorso completo ed esegue sempre una chiamata POST; `invoke()` accetta il nome di una funzione e può accogliere un metodo, un sottopercorso e intestazioni (headers). Usa `invoke()` a meno che tu non stia chiamando qualcosa che non sia una funzione.

## Passaggi successivi

- **[Autenticazione](/docs/sdk/authentication)** — Accesso, registrazione, OAuth, sessioni
- **[Sottoscrizioni in tempo reale](/docs/sdk/realtime)** — Dati in tempo reale con WebSockets
- **[Archiviazione e file](/docs/sdk/storage)** — Caricamento, download e gestione dei file
- **[Relazioni](/docs/collections/relations)** — Definizione delle relazioni tra collection

---
