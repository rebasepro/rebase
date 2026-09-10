---
sourceHash: c7ecc940df2e4680
title: Interrogare le relazioni
sidebar_label: Relazioni
description: "Includi entità correlate in una query e leggi una collezione figlia tramite il genitore con gli accessor di relazione dell'SDK."
---

## Caricare righe correlate

Le relazioni possono essere incluse in modo che le entità correlate vengano restituite insieme ai dati primari, invece dei soli ID delle chiavi esterne.

### Utilizzo di `include()` (Fluent)

```typescript
// Include specific relations
const { data } = await client.data.posts
    .include("author", "categories")
    .find();

// Include all defined relations, one hop deep
const { data } = await client.data.posts
    .include("*")
    .find();
```

Le chiamate ripetute si **sommano** a vicenda invece di sovrascriversi, quindi `.include("author").include("categories")` richiede entrambi.

### Utilizzo di `find({ include })` (Params)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Annidamento: relazioni di relazioni

Un percorso con notazione a punti carica una relazione di una relazione, fino a **tre hop**:

```typescript
// Each post's comments, and each comment's author.
const { data } = await client.data
    .collection<{ id: string; comments?: { author?: { name: string } }[] }>("posts")
    .include("comments.author")
    .find();

console.log(data[0].comments?.[0].author?.name);
```

Specificare l'hop intermedio è opzionale — `comments.author` implica già `comments` — e inviarli entrambi equivale alla stessa richiesta due volte.

Ogni hop è una query raggruppata per l'intera pagina, non una per riga: una pagina di 50 post con `comments.author` corrisponde a tre query, qualunque sia il numero di commenti. Il limite di profondità è ciò che impedisce a una relazione autoreferenziale di scorrere all'infinito; oltre tale limite la richiesta restituisce un errore 400 `INCLUDE_TOO_DEEP`.

### Limitare ciò che carica una relazione

La sintassi a elenco non permette di specificare un `limit` per singola relazione, quindi una relazione che necessita di restrizioni accetta invece un oggetto di opzioni:

```typescript
const { data } = await client.data.posts.include({
    comments: {
        limit: 5,
        where: { published: ["==", true] },
        orderBy: ["createdAt", "desc"],
        fields: ["id", "body"],
        include: { author: true }
    }
}).find();
```

| Opzione | Cosa fa |
|---------|---------|
| `limit` | Righe **per elemento genitore**, non su tutta la pagina — cinque commenti su ogni post, non cinque in totale. |
| `where` | Lo stesso dialetto di filtri utilizzato dal `where` di primo livello. Applicato direttamente alla query, quindi il `limit` si applica alle righe corrispondenti. |
| `logical` | Un gruppo `or`/`and`/`not` sulle righe correlate. |
| `orderBy` | La stessa sintassi di ordinamento, incluso il [posizionamento di NULL](/docs/sdk/querying#where-nulls-sort). |
| `fields` | Colonne della riga *correlata*. La sua chiave viene sempre preservata, in modo che la riga rimanga indirizzabile. |
| `include` | Relazioni della riga correlata, a loro volta — è così che l'albero si annida. |

`true` è la forma abbreviata per "carica tutto": `{ author: true }` e `["author"]` rappresentano la stessa richiesta.

### I nomi di relazione sconosciuti vengono rifiutati

Un nome che non corrisponde a una relazione della collezione restituisce un errore **400 `UNKNOWN_RELATION`**, a ogni livello dell'albero — anche all'interno di un `include` annidato. In passato veniva ignorato, rispondendo con un 200 con il campo semplicemente mancante, ma un campo di relazione assente è indistinguibile da una riga che effettivamente non ha alcuna riga correlata. Un errore di battitura appariva quindi esattamente come dati vuoti.

Con un tipo `Database` generato, non si arriva a questo punto: le chiavi di `include` vengono verificate a livello di compilazione rispetto alle relazioni reali della collezione, in modo ricorsivo. Consulta [Include tipizzati](#typed-includes).

### Sulla rete

`include` è un singolo parametro di query con due formati, distinti da una parentesi graffa iniziale:

```
GET /api/data/posts?include=author,comments.author
GET /api/data/posts?include={"comments":{"limit":5,"include":{"author":true}}}
```

La forma lineare è ciò che un essere umano digita e ciò di cui la maggior parte delle richieste ha bisogno; la forma JSON esiste perché quella lineare non può contenere opzioni per singola relazione, e inventare una sintassi apposita (`comments(limit:5)`) avrebbe introdotto una terza grammatica da imparare oltre alle due già presenti in questa API. Entrambe sono accettate su ogni route di tipo list e get-by-id, e l'SDK seleziona automaticamente quella necessaria alla query.

### Combinazione con i filtri

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Lettura dei dati della relazione

Quando le relazioni sono incluse, la risposta contiene **sia** la chiave esterna scalare sia l'oggetto di relazione idratato:

```typescript
const { data } = await client.data
    .collection<{ authorId: string; author?: { name: string } }>("posts")
    .include("author")
    .find();

for (const post of data) {
    // Scalar foreign key — always present
    console.log(post.authorId);    // "uuid-1234"

    // Hydrated relation — present when included
    console.log(post.author?.name); // "Jane Doe"
}
```

> **Nota:** Senza `.include("author")`, viene restituito solo il campo scalare `authorId`. L'oggetto idratato `author` sarà `undefined`.

### Una relazione `belongsTo` ha tre forme

Una relazione, tre punti in cui compare — e il protocollo non è volutamente simmetrico al riguardo, quindi vale la pena conoscerli tutti e tre:

| Dove | Forma | Perché |
|------|-------|--------|
| **Scrittura** | `{ author: id }` **oppure** `{ authorId: id }` | Entrambi sono accettati. Il trasformatore di scrittura mappa la proprietà della relazione sulla colonna della chiave esterna, rendendo le due scritture equivalenti. |
| **Lettura** | `authorId` | È una colonna. Ogni lettura la restituisce. |
| **Lettura con `include`** | `author`, la riga vera e propria del target | Viene caricata solo quando la query la richiede esplicitamente, quindi è assente in tutte le altre letture. |

```typescript
type Post = { id: string; title: string; authorId: string; author?: { name: string } };
const posts = client.data.collection<Post>("posts");

// Write: either spelling.
await posts.create({ title: "Hello", author: authorId } as Partial<Post>);
await posts.create({ title: "Hello", authorId });

// Read: the key.
const post = await posts.get(id);
post.authorId;          // "uuid-1234"
post.author;            // undefined — nothing asked for it

// Read with include: the row.
const { data } = await posts.include("author").find();
data[0].authorId;       // "uuid-1234" — still there
data[0].author?.name;   // "Jane Doe"
```

Un tipo `Database` generato tipizza tutti e tre con precisione: `Insert` e `Update` accettano entrambe le sintassi di scrittura, `Row` contiene `authorId` incondizionatamente, mentre `author` è facoltativo su `Row` e **obbligatorio** sulla riga restituita da una lettura con `include` — consulta [Include tipizzati](#typed-includes).

L'unico caso in cui i tre collassano è una relazione con lo stesso identico nome della propria chiave esterna. In quel caso la riga inclusa viene servita *al posto della* colonna, e il tipo generato lo riflette tipizzando quella chiave per entrambi i casi.

### Include tipizzati

`rebase generate-sdk` scrive il grafo delle relazioni nel tuo tipo `Database`, insieme a due helper basati su di esso:

```typescript no-verify
import type { IncludeFor, RowWith } from "./database.types";

const ok: IncludeFor<"posts"> = { comments: { limit: 5, include: { author: true } } };

// @ts-expect-error — 'authr' is not a relation of 'comments'
const typo: IncludeFor<"posts"> = { comments: { include: { authr: true } } };
```

`IncludeFor<A>` vincola le chiavi di un include alle relazioni esistenti, a qualsiasi livello. `RowWith<A, I>` è la riga restituita dalla lettura, in cui ogni relazione inclusa viene resa **obbligatoria** — pertanto, dopo aver richiesto l'autore, `row.author.name` non richiede `?.`.

Senza un `Database` generato, `include` rimane un semplice `string[]` o albero: un tipo di riga scritto a mano non contiene relazioni da verificare e l'errore 400 del server funge da protezione finale.

### Nomi delle relazioni

I nomi delle relazioni passati a `include()` devono corrispondere al `relationName` definito nell'array `relations` della collezione:

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Interrogare tramite una relazione

`include()` recupera le righe correlate *dopo* che la pagina è stata selezionata. Le due funzionalità seguenti scelgono la pagina **insieme** a esse: vengono compilate in SQL, quindi vengono eseguite prima di `limit` e `offset` anziché dopo.

Questo è ciò che serve per una schermata di coda — *chi sta aspettando, dal più vecchio al più recente* — in cui entrambe le parti della domanda trovano risposta in una tabella correlata anziché nella riga elencata.

### Filtrare per una colonna della riga correlata

Una chiave con notazione a punti attraversa una relazione per raggiungere una delle colonne del target:

```typescript
// Candidates with at least one application still open.
const { data } = await client.data.talents.find({
    where: {
        "applications.status": ["in", ["applied", "reviewing", "interview"]]
    }
});
```

Viene compilata in una clausola `EXISTS` sulla tabella correlata, correlata alla riga elencata — non una join, che moltiplicherebbe le righe compromettendo silenziosamente il `limit`.

Tutti gli operatori funzionano, poiché l'elemento confrontato è una colonna ordinaria:

```typescript
where: {
    "applications.createdAt": ["<", "2026-01-01"],   // waiting since before…
    "agency.name": ["ilike", "%staffing%"]            // through a belongsTo
}
```

Gli operatori negativi — `!=`, `not-in`, `not-like`, `not-ilike` — significano **"nessuna riga correlata corrisponde"**, non "qualche riga correlata è diversa":

```typescript
// Candidates with no hired application.
where: { "applications.status": ["!=", "hired"] }
```

Questa è l'interpretazione desiderata, e l'unica che fa sì che `==` e `!=` partizionino le righe. L'altra interpretazione — "qualche candidatura non è 'hired'" — è vera per quasi ogni candidato con più di una candidatura e non risponde a nessuna esigenza reale.

`is-null` e `is-not-null` sono deliberatamente **non** una coppia complementare in questo contesto. Significano "ha una riga correlata la cui colonna non è impostata" e "ne ha una in cui è impostata" — entrambe vere per un candidato con due candidature, una per tipo.

Un nome di relazione inesistente, o una colonna che il target non possiede, restituisce un errore 400 che elenca le colonne reali del target. Non si tratta mai di una condizione ignorata: ignorare una chiave di filtro *allargherebbe* la lettura a ogni riga.

### Ordinare in base a un'aggregazione su una relazione

```typescript
// Candidates, whoever has been waiting longest first.
const { data } = await client.data.talents.find({
    where: { "applications.status": ["in", ["applied", "reviewing"]] },
    orderBy: [[{ relation: "applications", field: "createdAt", agg: "min" }, "asc"]]
});

// Clients, busiest first.
orderBy: [[{ relation: "orders", agg: "count" }, "desc"]]
```

Il fluent builder accetta la stessa chiave:

```typescript
const { data } = await client.data.clients
    .orderBy({ relation: "orders", agg: "count" }, "desc")
    .find();
```

`min`, `max`, `count`, `sum` e `avg`. `field` è richiesto da tutti tranne che da `count`, che conta le righe correlate se omesso e conta le righe con una colonna non-null se specificato.

Questa è la parte di gestione di una coda che non si può aggirare sul client. Un filtro può essere approssimato denormalizzando un flag sulla riga; un ordinamento non può essere approssimato in alcun modo quando il set di risultati è impaginato, poiché il client riceve solo una pagina alla volta e tale pagina è già stata selezionata secondo l'ordine errato.

Le righe per cui la relazione non trova alcuna corrispondenza finiscono a un'estremità definita — **ultime in ordine crescente, prime in ordine decrescente**, la stessa posizione che Postgres riserva a `NULL`. Un `count` di zero elementi è `0` invece di null, quindi tali righe vengono ordinate come zero.

Su HTTP la chiave è una singola stringa, quindi si adatta direttamente a `?orderBy=`:

```bash
GET /api/data/talents?orderBy=min(applications.createdAt):asc
```

La paginazione basata su cursore supporta questa funzionalità. Non essendoci alcun aggregato memorizzato sulla riga del cursore con cui effettuare il confronto, il driver ricalcola il valore della riga del cursore in SQL a partire dall'id disponibile.

### Row-level security

Entrambi vengono compilati in una sottoquery eseguita con l'identità del lettore, quindi una riga correlata nascosta dalle policy non corrisponde a un filtro e non contribuisce a un aggregato.

Un'avvertenza, valida solo per la direzione **negativa**: "nessuna riga correlata corrisponde" e "nessuna riga correlata *visibile a questo lettore* corrisponde" sono la stessa frase. Una tabella di destinazione con row-level security e nessuna policy `SELECT` per `rebase_user` risulta opaca, quindi ogni riga appare priva di corrispondenze e un filtro `!=` / `not-in` produrrà un numero eccessivo di risultati. Nessun dato trapela — le policy della tabella elencata continuano a determinare l'esistenza stessa delle righe, e la direzione positiva restituisce correttamente un insieme vuoto. La soluzione consiste in una policy `SELECT` sulla tabella di destinazione. Rebase ne genera automaticamente una per le relazioni molti-a-molti dichiarate; uno schema scritto manualmente deve invece fornirla.

### Supporto dei motori di database

Solo Postgres. Firestore e MongoDB dichiarano `filterableRelationKinds: []` e non offrono nessuna delle due funzionalità — un document store si collega tramite riferimenti e non dispone di sottoquery in cui compilare queste operazioni. Consulta le [funzionalità delle origini dati](/docs/backend/multiple-sources).

### Perché non `additionalFields`?

`AdditionalFieldDelegate.value()` è asincrono e riceve l'intero contesto, quindi *può* leggere un'altra collezione — ma non è comunque d'aiuto in questo caso. Viene eseguito nel browser, una volta per riga, **dopo** che la pagina è stata recuperata e ordinata. Un valore calcolato in questo modo può essere visualizzato, ma non potrà mai essere filtrato, ordinato o impaginato.

Se un valore derivato non è un aggregato su una relazione, inseriscilo nel database — come colonna generata o gestita da trigger — e diventerà una proprietà ordinaria.

## Prossimi passi

- [Querying Data](/docs/sdk/querying/) — il query builder restituito da questi accessor
- [Relations](/docs/collections/relations/) — dichiarare i collegamenti letti da questa pagina
- [REST API](/docs/backend/api/) — lo stesso `include` su HTTP

---
