---
sourceHash: a248bbda3da934a0
title: Relazioni
sidebar_label: Relazioni
description: Definisci relazioni SQL uno-a-uno, uno-a-molti e molti-a-molti tra collection con chiavi esterne, tabelle di giunzione e join multi-hop.
---

## Panoramica

Le relazioni definiscono il modo in cui le collection sono collegate a livello di database. Consentono a Rebase di:

- Eseguire il rendering dei **campi di selezione delle relazioni** nei moduli delle entità
- Risolvere le **entità correlate** durante la visualizzazione delle anteprime
- Generare **vincoli di chiave esterna (foreign key)** nello schema Drizzle
- Supportare i comportamenti di **cascade delete/update**

Le relazioni possono essere definite inline all'interno della proprietà oppure esplicitamente nell'array `relations` di una collection:

### 1. Relazioni inline (consigliate)

Dichiara il collegamento sulla proprietà, annidato sotto `relation`. Scegli il `kind` e il tipo offrirà esattamente i campi richiesti da quel tipo di relazione.

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { type: "string", name: "Title" },
        content: { type: "string", name: "Content", admin: { multiline: true } },
        author: {
            type: "relation",
            name: "Author",
            relation: {
                kind: "belongsTo",
                target: () => usersCollection
            }
        }
    }
});
```

### 2. Array di relazioni esplicito

Per un collegamento privo di una proprietà dedicata — niente che lo identifichi nel form o nella colonna di una tabella — dichiaralo in `relations`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    properties: {
        name: { type: "string", name: "Name" }
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "posts",
            target: () => postsCollection
        }
    ]
});
```

## I cinque tipi

Una relazione appartiene a uno di cinque tipi (`kind`). Il tipo stabilisce dove risiede la chiave, se viene restituita una sola riga o molte, e cosa può essere modificato da una scrittura che lo attraversa.

| Tipo | Dove risiede la chiave | Restituisce | Note |
|---|---|---|---|
| `belongsTo` | su **questa** tabella | uno | `localKey`, il valore predefinito è `<relationName>_id` |
| `hasOne` | sulla tabella di **destinazione** | uno | `foreignKeyOnTarget`, il valore predefinito è il singolare di questa collection seguito da `_id` (`users` → `user_id`) |
| `hasMany` | sulla tabella di **destinazione** | molti | i figli appartengono esclusivamente a questo genitore |
| `manyToMany` | in una **tabella di giunzione** | molti | le righe sono condivise; possiedi il collegamento |
| `via` | un `joinPath` esplicito | uno o molti | scrivibile se a singolo hop (single-hop), altrimenti in sola lettura; definisci tu stesso la `cardinality` |

Tutti i campi sono opzionali tranne `kind` e `target` (e, per `via`, `cardinality` e `joinPath`) — il resto viene derivato.

### belongsTo — la chiave si trova su questa tabella

```typescript
author: {
    type: "relation",
    name: "Author",
    relation: { kind: "belongsTo", target: () => usersCollection }
}
// → posts.author_id
```

La colonna viene indicizzata automaticamente: Postgres indicizza la chiave a cui punta una foreign key, mai la colonna che la contiene, quindi senza un indice ogni include `hasMany` ed elenco nidificato dall'altro lato eseguirà una scansione di questa tabella. `index: false` mantiene il vincolo ed elimina l'indice — consulta [Foreign keys are indexed for you](/docs/backend/indexes#foreign-keys-are-indexed-for-you) per capire quando ne vale la pena e quando Rebase lo salta autonomamente perché un altro indice copre già la colonna.

### hasMany / hasOne — la chiave si trova sulla tabella di destinazione

```typescript
relations: [
    { kind: "hasMany", relationName: "posts", target: () => postsCollection }
]
// → reads posts.user_id
```

`hasOne` è lo stesso collegamento, ma con al massimo una riga dal lato opposto.

#### Join su una chiave naturale

Per impostazione predefinita, la foreign key di destinazione contiene l'**id** della riga di origine. Quando le due parti sono unite tramite qualcos'altro — un ID di identità esterno, uno SKU, lo slug di un tenant — indica tale colonna con `sourceKey`:

```typescript
relations: [
    {
        kind: "hasMany",
        relationName: "applications",
        target: () => applicationsCollection,
        sourceKey: "auth_user_id",          // column on THIS table
        foreignKeyOnTarget: "auth_user_id"  // column on the TARGET's table
    }
]
// → reads applications.auth_user_id = talents.auth_user_id
```

`sourceKey` è il corrispettivo di `localKey` in `belongsTo`: quello indica la colonna *da* cui questo lato legge, questo indica la colonna *a* cui punta l'altro lato. Senza di esso, un collegamento come quello sopra non può essere espresso come `hasMany` e deve ricadere su [`via`](#via--una-catena-di-join-esplicita), che è di sola lettura per una catena di questo tipo.

La colonna deve essere univoca. Un collegamento che fa riferimento a più di una riga di origine non può determinare a quale di esse appartenga una riga correlata, e nemmeno Postgres accetterà una foreign key associata a una colonna non univoca. Rebase esegue questa verifica in fase di lettura e rifiuta l'operazione anziché sceglierne una arbitrariamente.

Un genitore il cui `sourceKey` è `NULL` non raggiunge alcuna riga, e tentare una scrittura attraverso la relazione genera un errore — le righe correlate non avrebbero nulla a cui puntare.

### manyToMany — tramite una tabella di giunzione

```typescript
tags: {
    type: "relation",
    name: "Tags",
    relation: { kind: "manyToMany", target: () => tagsCollection }
}
// → junction `posts_tags` (both table names, sorted), columns post_id / tag_id
```

Entrambi i lati dichiarano il proprio collegamento e ciascuno scrive `through` **dal proprio punto di vista** — `sourceColumn` fa sempre riferimento a *questa* collection:

```typescript
// on posts
{ kind: "manyToMany", relationName: "tags", target: () => tagsCollection,
  through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } }

// on tags
{ kind: "manyToMany", relationName: "posts", target: () => postsCollection,
  through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" } }
```

### via — una catena di join esplicita

Per collegamenti che le quattro configurazioni precedenti non possono esprimere: percorsi multi-hop, chiavi composite o un join la cui condizione non è una semplice foreign key.

Una catena a **singolo hop (single-hop)** è scrivibile tramite creazione o aggiornamento, nello stesso modo in cui viene scritto il tipo che sostituisce:

- una catena **to-one** di **un solo passaggio** — la riga di destinazione contiene la chiave, quindi `{ badge: "b-1" }` fa puntare la colonna di quella riga a questa, e `null` ne rimuove il collegamento, proprio come farebbe una scrittura `hasOne`;
- una catena **to-many** di **due passaggi attraverso una sola tabella** tra le estremità — tale tabella contiene i collegamenti, quindi `{ tags: ["t-1", "t-2"] }` li imposta come sue righe, proprio come farebbe una scrittura `manyToMany` (un `via` non include `_pivot`).

Qualsiasi catena più lunga è di **sola lettura**: Rebase non dedurrà come scrivere attraverso una catena arbitraria. Una creazione o un aggiornamento che ne specifichi una viene rifiutato con `400 RELATION_NOT_WRITABLE`, e il form di amministrazione mostra il campo senza selettore. Una scrittura nidificata (`PATCH users/1/permissions/3`) attraverso qualsiasi `via` viene rifiutata allo stesso modo.

```typescript
{
    kind: "via",
    relationName: "permissions",
    target: () => permissionsCollection,
    cardinality: "many",
    joinPath: [
        { table: "user_roles",       on: { from: "id",            to: "user_id" } },
        { table: "role_permissions", on: { from: "role_id",       to: "role_id" } },
        { table: "permissions",      on: { from: "permission_id", to: "id" } }
    ]
}
```

## Proprietà di relazione

Per visualizzare un campo di relazione in un modulo, aggiungi una proprietà con `type: "relation"`:

```typescript
properties: {
    author: {
        type: "relation",
        name: "Author",
        relation: { kind: "belongsTo", target: () => usersCollection },
        // Which control draws it is presentation, so it goes in the admin block:
        // "select" (dropdown) or "dialog" (full picker).
        admin: { widget: "select" }
    }
}
```

Durante il rendering di un'anteprima (come nella cella di una tabella o in un chip di riferimento), Rebase gestisce automaticamente l'idratazione dei dati.

### To-one ottiene un selettore, many ottiene una scheda

La cardinalità determina l'interfaccia utilizzata, e ne viene impiegata solo una:

- **`belongsTo` / `hasOne`** — una riga, quindi la proprietà è una foreign key modificabile dall'autore. Viene visualizzata con il selettore (picker) sopra indicato.
- **`hasMany` / `manyToMany`** — molte righe, quindi la vista dell'entità le elenca all'interno di una propria **scheda (tab)** dedicata. La proprietà non viene mostrata nel modulo: gli elementi figli di una collection sono un elenco, non un valore contenuto nel record, e selezionarli da un menu a discesa non è un'operazione sensata all'interno del form.

Dichiarare una relazione di tipo many come proprietà ha comunque senso: è ciò che assegna il nome alla scheda e che fornisce alla relazione una colonna nella tabella della collection, che la richiesta dell'elenco idrata affinché le righe figlie compaiano come chip nella riga. Viene omesso unicamente il campo nel modulo.

Nella tabella, una relazione con una propria proprietà ottiene **una** colonna: la sua. Ogni scheda dispone inoltre di una colonna con un pulsante per passare alla scheda, ma per una relazione dichiarata come proprietà quel pulsante ripeteva la stessa intestazione accanto a una colonna che mostrava già gli elementi figli, per cui viene rimosso. Nascondendo la colonna della relazione (`admin: { hideFromCollection: true }`), il pulsante ricompare, garantendo che la relazione non scompaia del tutto dalla tabella.

Nascondere la colonna non interrompe il recupero dei dati. La lettura dell'elenco della collection include ogni relazione dichiarata da una proprietà, nascosta o meno; di conseguenza, il codice che legge le righe dell'elenco — `additionalFields`, display resolver, azioni dell'entità, azioni della collection tramite `tableController.rows`, slot di plugin — vi trova le righe correlate, nidificate sotto il nome della relazione proprio come le restituisce l'`include` di REST, accanto alla colonna della foreign key. A `browserCallbacks.afterRead` viene passata la stessa riga. Una relazione dichiarata esclusivamente nell'array `relations` della collection, senza alcuna proprietà, non viene incorporata nell'elenco; le sue righe vengono caricate all'apertura della rispettiva scheda.

Se desideri comunque il selettore inline, puoi richiederlo esplicitamente:

```typescript
properties: {
    tags: {
        type: "relation",
        name: "Tags",
        relation: { kind: "manyToMany", target: () => tagsCollection },
        admin: { renderInForm: true }   // off by default; the tab is the default treatment
    }
}
```

## Join multi-hop

Per le relazioni che attraversano più tabelle, usa `kind: "via"` con un `joinPath`. Una catena più lunga di un singolo collegamento è di sola lettura: Rebase non dedurrà come scrivere attraverso una catena arbitraria (consulta [via](#via--una-catena-di-join-esplicita) per le catene a singolo hop su cui è consentita la scrittura).

```typescript
// Users → Permissions through Roles
relations: [
    {
        kind: "via",
        relationName: "permissions",
        target: () => permissionsCollection,
        cardinality: "many",
        joinPath: [
            {
                table: "user_roles",
                on: { from: "id", to: "user_id" }
            },
            {
                table: "roles",
                on: { from: "role_id", to: "id" }
            },
            {
                table: "role_permissions",
                on: { from: "id", to: "role_id" }
            },
            {
                table: "permissions",
                on: { from: "permission_id", to: "id" }
            }
        ]
    }
]
```

### Join con chiavi composite

```typescript
joinPath: [
    {
        table: "customers",
        on: {
            from: ["company_code", "region_id"],  // Multiple columns
            to: ["code", "region_id"]
        }
    }
]
```

### Corrispondenza su una di due colonne

Un elenco in `on` unisce una riga che soddisfa **una qualsiasi** delle condizioni — un collegamento conservato in `a` o `b`. È di **sola lettura**.

```typescript
joinPath: [{ table: "friendships", on: [{ from: "id", to: "a" }, { from: "id", to: "b" }] }]
```

L'aggiunta di un secondo passaggio a `people` (`on: [{ from: "a", to: "id" }, { from: "b", to: "id" }]`) soddisfa anche la colonna del genitore stesso, quindi ogni persona risulterà amica di se stessa: elenca le righe di amicizia oppure filtra la persona.

## Regole di cascade

Controlla cosa succede quando le entità correlate vengono aggiornate o eliminate:

```typescript
relations: [
    {
        kind: "belongsTo",
        relationName: "author",
        target: () => usersCollection,
        localKey: "author_id",
        onDelete: "cascade",    // Delete posts when user is deleted
        onUpdate: "cascade"     // Update FK when user ID changes
    }
]
```

| Azione | Comportamento |
|--------|---------------|
| `"cascade"` | Propaga la modifica alle righe correlate |
| `"restrict"` | Impedisce l'operazione se esistono righe correlate |
| `"no action"` | Uguale a restrict (rimanda al controllo del vincolo) |
| `"set null"` | Imposta la colonna della foreign key su NULL |
| `"set default"` | Imposta la colonna della foreign key sul suo valore predefinito |

### Cosa si ottiene se non si specifica nulla

Il comportamento predefinito per un `belongsTo` **obbligatorio (required)** è cambiato. Nella versione 0.17.3 è `ON DELETE CASCADE` — l'eliminazione di un genitore elimina anche i figli — mentre a partire dalla 0.18 è `RESTRICT`, per cui l'eliminazione fallisce segnalando il vincolo. Tutto il resto in questa sezione rimane invariato e `db push` pianifica la riscrittura del vincolo durante l'aggiornamento.

`onDelete` è opzionale, quindi la maggior parte delle relazioni non ne specifica alcuno. Il valore predefinito dipende dal fatto che la relazione sia obbligatoria o meno:

| Relazione | `onDelete` predefinito |
|--------|----------|
| `belongsTo`, opzionale | `"set null"` — il puntatore viene azzerato |
| `belongsTo`, `validation: { required: true }` | `"restrict"` — l'eliminazione del genitore fallisce |
| `manyToMany` (righe di giunzione) | `"cascade"` — il collegamento viene rimosso, la destinazione rimane |

Una relazione obbligatoria **non** implica una cancellazione a cascata (cascade). `required` indica che un elemento figlio non può esistere senza un genitore; non significa che l'eliminazione del genitore debba distruggere il figlio. Si tratta di asserzioni distinte, e solo una di esse comporta la rimozione di righe non esplicitamente indicate. Di conseguenza, il comportamento predefinito fa fallire l'eliminazione indicando il vincolo, mentre `"cascade"` è un'opzione da richiedere espressamente:

```typescript
{
    kind: "belongsTo",
    relationName: "order",
    target: () => ordersCollection,
    // A line item is meaningless without its order — say so.
    onDelete: "cascade"
}
```

`onUpdate` non ha alcun valore predefinito: se non viene impostato nulla, Postgres applica `NO ACTION`. Imposta `"cascade"` quando la chiave di destinazione è modificabile da un utente — ad esempio uno slug o uno SKU — in modo che i puntatori si aggiornino di conseguenza.

## Recupero delle relazioni nell'SDK

Quando si interrogano i dati tramite l'SDK tipizzato di Rebase, le relazioni **non** vengono incluse per impostazione predefinita. Usa il metodo `include()` per richiedere le entità correlate insieme ai dati primari.

### Includere relazioni specifiche

```typescript
const { data } = await client.data.articles
    .include("author", "categories")
    .find();
```

### Includere tutte le relazioni

```typescript
const { data } = await client.data.articles
    .include("*")
    .find();
```

### Utilizzo della sintassi con parametri

```typescript
const { data } = await client.data.articles.find({
    include: ["author", "categories"]
});
```

### Struttura della risposta

Quando incluse, la risposta contiene sia la **foreign key scalare** sia l'**oggetto della relazione idratato**:

```typescript
const { data } = await client.data
    .collection<{ id: string; authorId: string; author?: { name: string } }>("articles")
    .include("author")
    .find();

// The SDK returns flat rows — there is no `.values` wrapper. (`Entity`, with
// `id`/`path`/`values`, is an admin-UI view model, not what the client hands back.)
for (const article of data) {
    // Scalar FK — always present
    article.authorId;     // "uuid-1234"

    // Hydrated relation — only present when included
    article.author?.name;  // "Jane Doe"
}
```

> I nomi delle relazioni passati a `include()` devono corrispondere al nome della relazione: il `relationName` di una voce nell'array `relations` della collection, oppure la chiave della proprietà che la dichiara inline.

Per la documentazione completa sul query builder (filtri, ordinamento, paginazione, real-time), consulta la [documentazione dell'SDK tipizzato](/docs/sdk).

## Relazioni nel pannello di amministrazione

Ogni relazione to-many (`hasMany`, `manyToMany` o un `via` to-many) diventa una scheda sotto un record nel pannello di amministrazione, identificata dal nome della relazione. La sezione [Relazioni nel pannello di amministrazione](/docs/collections/relations-in-the-admin-panel/) illustra i percorsi, cosa viene creato, collegato, scollegato o eliminato da una scheda, le medesime regole via REST e cosa non diventa una scheda.

## Interfaccia Relation completa

`Relation` è una closed union (unione chiusa) — un membro per ciascun tipo, ognuno contenente solo i campi previsti da quel kind. Non esiste una combinazione di campi che descriva due collegamenti diversi, né un campo impostabile che il tipo non utilizzi.

```typescript
type Relation =
    | BelongsToRelation
    | HasOneRelation
    | HasManyRelation
    | ManyToManyRelation
    | ViaRelation;

interface RelationBase {
    relationName?: string;          // defaults to the property key, then the target's slug
    target: () => CollectionConfig;
    onUpdate?: OnAction;
    onDelete?: OnAction;
    overrides?: Partial<CollectionConfig>;   // applied when rendered as a tab
}
// `required` is not here. It is `validation: { required: true }` on the
// property that declares the relation, the same key every other field uses.

interface BelongsToRelation extends RelationBase {
    kind: "belongsTo";
    localKey?: string;              // column on THIS table
    index?: boolean;                // btree on localKey; defaults to true
}

interface HasOneRelation extends RelationBase {
    kind: "hasOne";
    foreignKeyOnTarget?: string;    // column on the TARGET's table
    sourceKey?: string;             // column on THIS table; defaults to the primary key
}

interface HasManyRelation extends RelationBase {
    kind: "hasMany";
    foreignKeyOnTarget?: string;    // column on the TARGET's table
    sourceKey?: string;             // column on THIS table; defaults to the primary key
}

interface ManyToManyRelation extends RelationBase {
    kind: "manyToMany";
    through?: {
        table?: string;
        sourceColumn?: string;
        targetColumn?: string;
        properties?: Properties;    // extra columns on the junction row, served under `_pivot`
    };
}

interface ViaRelation extends RelationBase {
    kind: "via";
    cardinality: "one" | "many";    // a join chain cannot imply it
    joinPath: JoinStep[];
}
```

### La forma risolta

Quella descritta sopra è la forma di *creazione (authoring)*. Internamente Rebase lavora con `ResolvedRelation`: lo stesso collegamento con tutti i valori predefiniti inseriti e nulla di opzionale, oltre a `cardinality`, `targetSlug` e due flag — `writable` (false solo per un `via` multi-hop o con un passaggio che soddisfa una qualsiasi tra diverse condizioni) e `shared` (true quando le righe di destinazione appartengono anche ad altri genitori, per cui una rimozione scollega anziché eliminare).

`sourceKey` è l'unica eccezione a "nulla di opzionale": il suo valore predefinito è la primary key dell'origine, e per risolverla è necessario lo schema del driver, che la risoluzione non possiede. `undefined` in quel campo significa "la chiave primaria" e nient'altro.

Non si scrive mai direttamente un `ResolvedRelation`. Su una proprietà di relazione, `relation` è quella specificata dallo sviluppatore e `resolvedRelation` è quella completata, assegnata durante la normalizzazione.

## Passaggi successivi

- **[Regole di sicurezza](/docs/collections/security-rules)** — Row Level Security
- **[Proprietà](/docs/collections/properties)** — Riferimento ai tipi di proprietà
