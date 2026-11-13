---
sourceHash: 3db2d10879df1c44
title: Interrogare le relazioni
sidebar_label: Relazioni
description: "Includi entità correlate in una query e leggi una tabella figlia tramite il genitore con gli accessor di relazione dell'SDK."
---

## Caricare le righe correlate

Le relazioni possono essere incluse in modo che le entità correlate vengano restituite insieme ai dati primari, anziché solo con i relativi ID di chiave esterna.

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

Le chiamate ripetute si **sommano** tra loro invece di sostituirsi, quindi
`.include("author").include("categories")` le richiede entrambe.

### Utilizzo di `find({ include })` (Parametri)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Annidamento: relazioni di relazioni

Un percorso con notazione a punti carica una relazione di una relazione, fino a **tre salti**:

```typescript
// Each post's comments, and each comment's author.
const { data } = await client.data
    .table<{ id: string; comments?: { author?: { name: string } }[] }>("posts")
    .include("comments.author")
    .find();

console.log(data[0].comments?.[0].author?.name);
```

Specificare il salto intermedio è facoltativo — `comments.author` implica già
`comments` — e inviare entrambi corrisponde alla stessa richiesta due volte.

Ogni salto corrisponde a una query in batch per l'intera pagina, non una per riga: una pagina di 50
post con `comments.author` genera tre query, indipendentemente dal numero di commenti.
Il limite di profondità è ciò che impedisce a una relazione autoreferenziale di scorrere all'infinito;
oltre tale limite, la richiesta genera un errore 400 `INCLUDE_TOO_DEEP`.

### Limitare ciò che carica una relazione

La forma a elenco non offre un punto in cui inserire un `limit` per relazione, quindi una relazione che
necessita di essere ristretta accetta invece un oggetto di opzioni:

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
|--------|--------------|
| `limit` | Righe **per genitore**, non nell'intera pagina — cinque commenti su ogni post, non cinque in totale. Viene applicato dalla query, quindi le righe oltre questo limite non vengono mai lette dal database. |
| `where` | Lo stesso dialetto di filtro utilizzato dal `where` di livello superiore. Inserito direttamente nella query, quindi il `limit` si applica alle righe corrispondenti. |
| `logical` | Un gruppo `or`/`and`/`not` sulle righe correlate. |
| `orderBy` | La stessa sintassi di ordinamento, inclusa la [posizione dei NULL](/docs/sdk/querying#where-nulls-sort). I pareggi, e un `limit` senza `orderBy`, sono ordinati in base alla chiave della riga correlata, in ordine crescente. |
| `fields` | Colonne della riga *correlata*. La sua chiave viene sempre preservata, in modo che la riga rimanga indirizzabile. |
| `include` | Relazioni della riga correlata, a loro volta — è così che l'albero si annida. |
| `count` | Restituisce anche quante righe correlate sono presenti in totale, per genitore, sotto il campo `_count` della riga. Consulta [Conteggio di ciò che un limite esclude](#conteggio-di-ciò-che-un-limite-esclude). |

`true` è la scorciatoia per "carica per intero": `{ author: true }` e
`["author"]` rappresentano la stessa richiesta.

### Conteggio di ciò che un limite esclude

Un `limit` pone un tetto a
ciò che viene inviato, e `count: true` indica quanto è stato escluso. Questo è ciò di cui ha bisogno un elenco
per mostrare quattro tag e un "+33":

```typescript
const { data } = await client.data.posts.include({
    tags: { limit: 4, count: true }
}).find();

// data[0] → { id: 1, title: "…", tags: [ …4 rows ], _count: { tags: 37 } }
```

- `_count` è un oggetto per riga, indicizzato per nome di relazione. Il conteggio di due relazioni
  aggiunge due chiavi.
- Il totale viene conteggiato nella stessa istruzione SQL che legge le righe. Copre
  le stesse righe che restituirebbe una lettura senza il `limit`: il `where` dell'include,
  l'eliminazione logica (soft delete) e la sicurezza a livello di riga (row-level security) si applicano tutte. Richiederlo non aggiunge alcuna query.
- Senza un `limit`, il totale è il numero di righe restituite.
- `count` funziona solo sulle relazioni to-many. Su una relazione to-one, restituisce un
  400 `INVALID_INCLUDE`. Lo stesso vale per una tabella che ha una colonna denominata
  `_count`, poiché il totale la sovrascriverebbe.
- Una relazione che il chiamante non può leggere (accesso ai campi) viene esclusa da `_count`,
  esattamente come le sue righe.

### I nomi di relazione sconosciuti vengono rifiutati

Un nome che non è una relazione della tabella restituisce un **400
`UNKNOWN_RELATION`**, a ogni livello dell'albero — anche all'interno di un
`include` annidato. In passato veniva ignorato, rispondendo con un 200 con il campo semplicemente
mancante, e un campo di relazione mancante non è distinguibile da una riga che
effettivamente non ha alcuna riga correlata. Un refuso appariva quindi esattamente come dati vuoti.

Con un tipo `Database` generato, non si arriva a questo punto: le chiavi di `include` vengono
verificate rispetto alle relazioni reali della tabella in fase di compilazione, in modo ricorsivo.
Vedi [Include tipizzati](#include-tipizzati).

### Sulla rete

`include` è un singolo parametro di query con due sintassi, distinte da una parentesi graffa
iniziale:

```
GET /api/data/posts?include=author,comments.author
GET /api/data/posts?include={"comments":{"limit":5,"include":{"author":true}}}
```

La forma flat (lineare) è ciò che digita un essere umano e ciò di cui la maggior parte delle richieste ha bisogno; la forma JSON
esiste perché quella lineare non può trasportare opzioni per relazione, e inventare una
punteggiatura specifica (`comments(limit:5)`) costituirebbe una terza grammatica da apprendere
oltre alle due che questa API possiede già. Entrambe sono accettate su ogni rotta di elenco e
get-by-id, e l'SDK sceglie quella richiesta dalla query.

### Combinazione con i filtri

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Lettura dei dati di relazione

Quando le relazioni vengono incluse, la risposta contiene **sia** la chiave esterna scalare sia l'oggetto di relazione idratato:

```typescript
const { data } = await client.data
    .table<{ authorId: string; author?: { name: string } }>("posts")
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

Una relazione, tre punti in cui compare — e la rete non è deliberatamente
simmetrica al riguardo, quindi vale la pena conoscerli tutti e tre:

| Dove | Forma | Perché |
|-------|-------|-----|
| **Scrittura** | `{ author: id }` **oppure** `{ authorId: id }` | Entrambe sono accettate. Il trasformatore di scrittura mappa la proprietà della relazione sulla colonna della chiave esterna, quindi le due opzioni corrispondono alla stessa scrittura. Un oggetto (`{ author: { id } }`) genera un 400 che indica il nome della relazione: invia la chiave. |
| **Lettura** | `authorId` | È una colonna. Ogni lettura la restituisce. |
| **Lettura con `include`** | `author`, la riga vera e propria del target | Caricata solo quando la query la specifica, quindi è assente in tutte le altre letture. |

```typescript
type Post = { id: string; title: string; authorId: string; author?: { name: string } };
const posts = client.data.table<Post>("posts");

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

Un tipo `Database` generato tipizza tutti e tre con precisione: `Insert` e `Update` accettano
entrambe le forme di scrittura, `Row` include incondizionatamente `authorId`, e `author` è
facoltativo in `Row` — `RowWith<"posts", ["author"]>` è la riga con tale proprietà
**obbligatoria**, per una lettura che l'ha richiesta. Vedi [Include tipizzati](#include-tipizzati).

L'unico caso in cui i tre collassano è una relazione con un nome identico alla propria
chiave esterna. In quel caso la riga inclusa viene servita *al posto* della colonna, e il
tipo generato lo riflette tipizzando tale chiave come entrambi.

### Include tipizzati

`rebase generate-sdk` scrive il grafo delle relazioni nel tuo tipo `Database`, insieme a
due helper basati su di esso:

```typescript no-verify
import type { IncludeFor, RowWith } from "./database.types";

const ok: IncludeFor<"posts"> = { comments: { limit: 5, include: { author: true } } };

// @ts-expect-error — 'authr' is not a relation of 'comments'
const typo: IncludeFor<"posts"> = { comments: { include: { authr: true } } };
```

`IncludeFor<A>` vincola le chiavi di un include alle relazioni esistenti, a ogni
livello — e un client tipizzato controlla `include` nello stesso modo, in `find({ include })`
e in `.include(...)`, così che `posts.include("authr")` sia un errore di compilazione anziché
un 400 `UNKNOWN_RELATION`. Le righe restituite da una lettura continuano a tipizzare ogni relazione
come facoltativa; `RowWith<A, I>` è quella riga con ogni relazione inclusa resa
**obbligatoria**, utile per annotare ciò che leggi — in questo modo, dopo aver richiesto l'autore,
un `RowWith<"posts", ["author"]>` non necessita di `?.` su `row.author.name`.

Senza un `Database` generato, `include` rimane un semplice `string[]` o albero: un
tipo riga scritto a mano non contiene relazioni su cui eseguire controlli, e l'errore 400 del server
funge da linea di difesa.

### Nomi delle relazioni

<span class="since-badge" data-since="0.31">Since 0.31</span>

I nomi passati a `include()` sono le chiavi di `relations` della tabella:

```ts
// backend/schema/articles.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";
import { categories } from "./categories";

export const articles = defineTable("articles", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull()
    },
    relations: {
        author: rel.belongsTo(() => users),
        categories: rel.manyToMany(() => categories)
    },
    rls: "admin-only"
});
```

```typescript
// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Interrogare attraverso una relazione

`include()` recupera le righe correlate *dopo* che la pagina è stata selezionata. Le due
funzionalità seguenti selezionano la pagina **insieme** a esse: vengono compilate in SQL, quindi vengono eseguite
prima di `limit` e `offset` anziché dopo.

Questo è ciò di cui ha bisogno una schermata di coda — *chi è in attesa, a partire da chi aspetta da più tempo* — dove entrambe
le parti della domanda ricevono risposta da una tabella correlata anziché dalla riga
elencata.

### Filtrare in base a una colonna della riga correlata

Una chiave separata da punti accede, attraverso una relazione, a una delle colonne della tabella di destinazione:

```typescript
// Candidates with at least one application still open.
const { data } = await client.data.talents.find({
    where: {
        "applications.status": ["in", ["applied", "reviewing", "interview"]]
    }
});
```

Viene compilata in una clausola `EXISTS` sulla tabella correlata, correlata alla riga
elencata — non una join, che moltiplicherebbe le righe e comprometterebbe silenziosamente `limit`.

Tutti gli operatori funzionano, poiché l'elemento confrontato è una normale colonna:

```typescript
where: {
    "applications.createdAt": ["<", "2026-01-01"],   // waiting since before…
    "agency.name": ["ilike", "%staffing%"]            // through a belongsTo
}
```

Gli operatori negativi — `!=`, `not-in`, `not-like`, `not-ilike` — significano **"nessuna
riga correlata corrisponde"**, non "qualche riga correlata differisce":

```typescript
// Candidates with no hired application.
where: { "applications.status": ["!=", "hired"] }
```

Questa è l'interpretazione desiderata, e l'unica che fa sì che `==` e `!=`
partizionino le righe. L'altra interpretazione — "qualche candidatura non è 'hired'" — è
vera per quasi tutti i candidati con più di una candidatura, e non risponde a
nessuna reale esigenza.

`is-null` e `is-not-null` **non** formano deliberatamente una coppia complementare in questo caso.
Significano "ha una riga correlata la cui colonna non è impostata" e "ne ha una in cui è
impostata" — entrambe vere per un candidato con due candidature, una per tipo.

Un nome di relazione inesistente, o una colonna non presente nella destinazione, genera un
400 che elenca le colonne reali della destinazione. Non si tratta mai di una condizione ignorata: ignorare
una chiave di filtro *allargherebbe* la lettura a ogni riga.

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

`min`, `max`, `count`, `sum` e `avg`. `field` è richiesto da tutte,
tranne `count`, che conta le righe correlate se viene omesso e conta
le righe con una colonna non null se viene specificato.

Questa è la parte della gestione di una coda che non si può aggirare sul client. Un filtro può
essere approssimato denormalizzando un flag sulla riga; un ordinamento non può essere
approssimato in alcun modo una volta paginato il set di risultati, perché il client conserva
solo una pagina alla volta e tale pagina è stata selezionata con un ordine errato.

Le righe per cui la relazione non trova alcuna corrispondenza finiscono a un'estremità definita — **ultime
in ordine crescente, prime in ordine decrescente**, la stessa collocazione che Postgres assegna a un `NULL`. Un `count`
su un insieme vuoto è `0` anziché null, quindi tali righe vengono ordinate come zero.

Su HTTP la chiave è una singola stringa, quindi si adatta a `?orderBy=` invariata:

```bash
GET /api/data/talents?orderBy=min(applications.createdAt):asc
```

La paginazione basata su cursore funziona su di essa. Non vi è alcun valore aggregato memorizzato sulla riga del cursore
con cui effettuare il confronto, quindi il driver ricalcola il valore della riga del cursore in SQL a partire
dall'ID a sua disposizione.

### Row-level security

Entrambe compilano in una sottoquery eseguita come utente lettore, quindi una riga correlata nascosta dalle
tue policy non soddisfa un filtro e non contribuisce a un'aggregazione.

Un'avvertenza, valida solo per la direzione **negativa**: "nessuna riga correlata corrisponde" e "nessuna
riga correlata *visibile a questo lettore* corrisponde" sono la stessa frase. Una tabella di destinazione
con row-level security e nessuna policy `SELECT` per `rebase_user` è opaca, quindi
ogni riga appare non corrispondente e un filtro `!=` / `not-in` sovrastima i risultati. Nessun dato
viene divulgato — le policy della tabella elencata decidono comunque quali righe esistono,
e la direzione positiva restituisce correttamente nulla. La soluzione consiste nell'aggiungere una policy `SELECT`
sulla destinazione. Rebase ne deduce automaticamente una per una relazione molti-a-molti dichiarata; uno
schema scritto a mano deve invece fornirla.

### Supporto del motore

Solo Postgres. Una collezione Firestore nel CMS dichiara
`filterableRelationKinds: []` e non offre nessuna delle due funzionalità — un document store
collega tramite riferimento e non dispone di sottoquery in cui compilare queste istruzioni. Consulta
[Firebase](/docs/frontend/firebase/).

### Perché non `additionalFields`?

`AdditionalFieldDelegate.value()` è asincrono e riceve l'intero contesto, quindi
*può* leggere un'altra tabella — ma ciò nonostante non è d'aiuto in questo caso. Viene eseguito nel
browser, una volta per riga, **dopo** che la pagina è stata recuperata e ordinata. Un valore
calcolato in quel punto può essere visualizzato, ma non potrà mai essere filtrato, ordinato o impaginato.

Se un valore derivato non è un'aggregazione su una relazione, inseriscilo nel database —
come colonna generata o gestita tramite trigger — e diventerà una normale
proprietà.

## Passaggi successivi

- [Interrogazione dei dati](/docs/sdk/querying/) — il query builder restituito da questi accessor
- [Relazioni](/docs/collections/relations/) — dichiarare i collegamenti letti da questa pagina
- [API REST](/docs/backend/api/) — lo stesso `include` tramite HTTP
