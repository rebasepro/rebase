---
sourceHash: b8fb2609d1a27893
title: Relazioni
sidebar_label: Relazioni
description: Definisci relazioni SQL uno-a-uno, uno-a-molti e molti-a-molti tra collezioni con chiavi esterne, tabelle di giunzione e join multi-hop.
---

## Panoramica

Le relazioni definiscono come le collezioni sono connesse a livello di database. Consentono a Rebase di:

- Renderizzare **campi di selezione relazione** nei form delle entità
- Risolvere **entità correlate** quando si mostrano le anteprime
- Generare **vincoli di chiave esterna** nello schema Drizzle
- Supportare comportamenti di **eliminazione/aggiornamento a cascata**

Le relazioni possono essere definite in linea all'interno della proprietà, o esplicitamente nell'array `relations` di una collezione:

### 1. Relazioni Inline (Consigliato)

Dichiara il collegamento sulla proprietà, annidato sotto `relation`. Scegli il
`kind` e il tipo offre esattamente i campi di cui quel kind ha bisogno.

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

### 2. Array di Relazioni Esplicite

Per un collegamento senza una proprietà propria — nulla con cui nominarlo nel
form o in una colonna di tabella — dichiaralo in `relations`:

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

## I cinque kind

Una relazione è di uno dei cinque kind. Il kind decide dove vive la chiave, se
torna una riga o molte, e cosa può toccare una scrittura che vi passa
attraverso.

| Kind | La chiave vive | Restituisce | Note |
|---|---|---|---|
| `belongsTo` | su **questa** tabella | una | `localKey`, predefinito `<relationName>_id` |
| `hasOne` | sulla tabella della **destinazione** | una | `foreignKeyOnTarget`, predefinito `<thisCollection>_id` |
| `hasMany` | sulla tabella della **destinazione** | molte | i figli appartengono a questo solo padre |
| `manyToMany` | in una **tabella di giunzione** | molte | le righe sono condivise; il collegamento è tuo |
| `via` | un `joinPath` esplicito | l'una o l'altra | in sola lettura; la `cardinality` la dichiari tu |

Ogni campo è opzionale tranne `kind` e `target` — il resto è derivato.

### belongsTo — la chiave è su questa tabella

```typescript
author: {
    type: "relation",
    name: "Author",
    relation: { kind: "belongsTo", target: () => usersCollection }
}
// → posts.author_id
```

### hasMany / hasOne — la chiave è sulla loro

```typescript
relations: [
    { kind: "hasMany", relationName: "posts", target: () => postsCollection }
]
// → reads posts.user_id
```

`hasOne` è lo stesso collegamento con al massimo una riga dall'altra parte.

#### Join su una chiave naturale

Per impostazione predefinita la chiave esterna della destinazione contiene l'**id**
della riga di origine. Quando i due lati sono uniti su qualcos'altro — un id di
identità esterna, uno SKU, uno slug di tenant — nomina quella colonna con
`sourceKey`:

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

`sourceKey` è lo specchio di `localKey` su `belongsTo`: quello nomina la colonna
da cui questo lato legge, questo nomina la colonna a cui punta l'altro lato.
Senza di esso un collegamento come quello sopra non è affatto esprimibile come
`hasMany` e deve ripiegare su [`via`](#via--una-catena-di-join-esplicita), che è
in sola lettura.

La colonna deve essere univoca. Un collegamento che indirizza più di una riga di
origine non può dire a quale appartiene una riga correlata, e nemmeno Postgres
accetta una chiave esterna verso una colonna non univoca. Rebase lo controlla in
lettura e rifiuta invece di sceglierne una.

Un padre il cui `sourceKey` è `NULL` non raggiunge alcuna riga, e scrivere
attraverso la relazione è un errore — non c'è nulla a cui le righe correlate
possano puntare.

### manyToMany — attraverso una giunzione

```typescript
tags: {
    type: "relation",
    name: "Tags",
    relation: { kind: "manyToMany", target: () => tagsCollection }
}
// → junction `posts_tags` (both table names, sorted), columns post_id / tag_id
```

Entrambi i lati dichiarano il proprio, e ciascuno scrive `through` **dal proprio
punto di vista** — `sourceColumn` nomina sempre *questa* collezione:

```typescript
// on posts
{ kind: "manyToMany", relationName: "tags", target: () => tagsCollection,
  through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } }

// on tags
{ kind: "manyToMany", relationName: "posts", target: () => postsCollection,
  through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" } }
```

### via — una catena di join esplicita

Per collegamenti che le quattro forme precedenti non riescono a esprimere:
percorsi multi-hop, chiavi composite, o un join la cui condizione non è una
semplice chiave esterna. In sola lettura — Rebase non dedurrà come scrivere
attraverso una catena arbitraria.

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

## Proprietà delle Relazioni

Per renderizzare un campo di relazione in un form, aggiungi una proprietà con `type: "relation"`:

```typescript
properties: {
    author: {
        type: "relation",
        name: "Author",
        relation: { kind: "belongsTo", target: () => usersCollection },
        widget: "select"           // "select" (dropdown) or "dialog" (full picker)
    }
}
```

Quando si renderizza un'anteprima (come in una cella di tabella o un chip di riferimento), Rebase gestisce automaticamente l'idratazione.

### A-uno ottiene un selettore, a-molti una scheda

La cardinalità decide la superficie, e ne viene usata una sola:

- **`belongsTo` / `hasOne`** — una riga, quindi la proprietà è una chiave esterna
  che l'autore modifica. Viene resa come il selettore qui sopra.
- **`hasMany` / `manyToMany`** — molte righe, quindi la vista dell'entità le
  elenca in una **scheda** a parte. La proprietà non viene resa nel form: i figli
  di una collezione sono un elenco, non un valore che il record contiene, e
  sceglierli da un menu a discesa non è qualcosa che il form possa offrire in
  modo sensato.

Dichiarare comunque una relazione a-molti come proprietà conviene: è ciò che dà
il nome alla scheda, e ciò che dà alla relazione una colonna nella tabella della
collezione, che il caricamento dell'elenco idrata così che le righe figlie
compaiano come chip sulla riga. Viene abbandonato solo il campo del form.

Nella tabella, una relazione con una proprietà propria ottiene **una** colonna:
la sua. Ogni scheda ha anche una colonna con un pulsante di salto alla scheda,
ma per una relazione dichiarata come proprietà quel pulsante ripeteva la stessa
intestazione accanto a una colonna che già mostrava i figli, quindi viene
eliminato. Nascondi la colonna della relazione
(`admin: { hideFromCollection: true }`) e il pulsante torna, così la relazione
non esce mai del tutto dalla tabella.

Se vuoi comunque il selettore in linea, chiedilo:

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

## Join Multi-Salto

Per relazioni che attraversano più tabelle, usa `kind: "via"` con un `joinPath`.
Sono in sola lettura: Rebase non dedurrà come scrivere attraverso una catena
arbitraria.

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

### Join con Chiave Composita

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

## Regole a Cascata

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
|--------|----------|
| `"cascade"` | Propaga la modifica alle righe correlate |
| `"restrict"` | Impedisce l'operazione se esistono righe correlate |
| `"no action"` | Uguale a restrict (rinvia al controllo del vincolo) |
| `"set null"` | Imposta la colonna FK a NULL |
| `"set default"` | Imposta la colonna FK al suo valore predefinito |

### Cosa ottieni se non dici nulla

<span class="since-badge" data-since="0.18">Since 0.18</span>

Il valore predefinito per un `belongsTo` **obbligatorio** è cambiato. In 0.17.3 è
`ON DELETE CASCADE` — eliminare un padre elimina i suoi figli — e da 0.18 è
`RESTRICT`: l'eliminazione fallisce e nomina il vincolo. Tutto il resto di questa
sezione è invariato, e `db push` pianifica la riscrittura del vincolo
all'aggiornamento.

`onDelete` è opzionale, quindi la maggior parte delle relazioni non lo nomina
mai. Il valore predefinito dipende dal fatto che la relazione sia obbligatoria:

| Relazione | `onDelete` predefinito |
|--------|----------|
| `belongsTo`, opzionale | `"set null"` — il puntatore viene svuotato |
| `belongsTo`, `validation: { required: true }` | `"restrict"` — l'eliminazione del padre fallisce |
| `manyToMany` (righe di giunzione) | `"cascade"` — sparisce il collegamento, la riga di destinazione resta |

Una relazione obbligatoria **non** è una cascata. `required` dice che un figlio
non può esistere senza un padre; non dice che eliminare il padre debba
distruggere il figlio. Sono affermazioni diverse, e solo una delle due rimuove
righe che non hai nominato. Per questo il valore predefinito fa fallire
l'eliminazione e nomina il vincolo, e `"cascade"` è qualcosa che chiedi
esplicitamente:

```typescript
{
    kind: "belongsTo",
    relationName: "order",
    target: () => ordersCollection,
    // Una riga d'ordine non ha senso senza il suo ordine: dillo.
    onDelete: "cascade"
}
```

`onUpdate` non ha un valore predefinito: senza nulla di impostato, Postgres
applica `NO ACTION`. Usa `"cascade"` quando la chiave della destinazione è
qualcosa che una persona può modificare — uno slug, uno SKU — così che i
puntatori la seguano.

## Recupero delle Relazioni nell'SDK

Quando si interrogano i dati tramite l'SDK Rebase Client, le relazioni **non** sono incluse di default. Usa il metodo `include()` per richiedere le entità correlate insieme ai dati primari.

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

### Utilizzo della sintassi dei parametri

```typescript
const { data } = await client.data.articles.find({
    include: ["author", "categories"]
});
```

### Struttura della risposta

Quando incluse, la risposta contiene sia la **chiave esterna scalare** che l'**oggetto relazione idratato**:

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

> I nomi delle relazioni passati a `include()` devono corrispondere al `relationName` definito nell'array `relations` della collezione.

Per la documentazione completa del query builder (filtro, ordinamento, paginazione, real-time), consulta la [documentazione dell'SDK Client](/docs/sdk).

## Relazioni nel pannello di amministrazione

Ogni relazione a-molti — `hasMany`, `manyToMany` o un `via` a-molti — diventa una
**scheda** sotto un record nel pannello di amministrazione, che elenca le righe
che quel record raggiunge.

### Il segmento di percorso è il nome della relazione

Un elenco di figli si indirizza come `parent/parentId/relationName`:

```
/c/authors/a-1/posts          the posts of author a-1
/c/posts/p-1/tags             the tags of post p-1
```

L'ultimo segmento è il **nome della relazione**, non lo slug della collezione di
destinazione. Spesso coincidono, perché una relazione senza nome prende lo slug
della sua destinazione — ma una proprietà di relazione inline prende la *chiave
della proprietà*:

```typescript
properties: {
    featuredTags: {
        type: "relation",
        relation: { kind: "manyToMany", target: () => tagsCollection }
    }
}
// tab and path segment: featuredTags   (not "tags")
```

È anche ciò che fa funzionare due relazioni verso la stessa collezione: ognuna ha
il proprio nome, quindi ognuna ha la propria scheda e il proprio percorso.

### Righe possedute contro righe condivise

Ciò che una scheda ti permette di fare dipende da come la relazione è
memorizzata, perché i due casi significano cose diverse:

| | Uno-a-molti (`foreignKeyOnTarget`) | Molti-a-molti (`through`) |
|---|---|---|
| Il figlio appartiene a | questo solo padre | ogni padre che lo collega |
| Creare | crea la riga sotto questo padre | crea la riga e la collega |
| Aggiungi esistente | — | collega una riga esistente |
| Rimuovi | **elimina** la riga | **scollega**; la riga resta intatta |

Il pannello di amministrazione rende ciascun caso di conseguenza: una scheda
molti-a-molti offre **Aggiungi esistente** e **Rimuovi da questo record**, e mai
un'eliminazione che toglierebbe la riga agli altri padri.

### Le stesse regole via REST

Gli elenchi di figli sono normali query di collezione ristrette a un padre,
quindi accettano tutto ciò che accetta un elenco radice — filtri, `orderBy`,
`limit`, `offset`, `include` — e `meta.total` conta le righe filtrate. Filtra per
campo (`?field=op.value`) oppure con un oggetto intero
`?where={"field":["op","value"]}`; entrambi raggiungono la stessa query:

```
GET    /api/data/authors/a-1/posts?status=eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts?where={"status":["==","published"]}&orderBy=title
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PATCH  /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

Il segmento del padre è imposto, non decorativo. Indirizzare una riga che non sta
sotto quel padre restituisce `404`, e `PATCH` non sposta mai una riga da un padre
a un altro — imposta esplicitamente la chiave esterna se è quello che vuoi.

Per un molti-a-molti, `PATCH parent/id/child/childId` è *appartenenza
all'insieme*: collega la riga se non è ancora collegata, ed è idempotente. È così
che alleghi una riga che esiste già.

### Cosa non diventa una scheda

- **Relazioni a-uno** — sono un campo del record, non un elenco. Scrivere
  attraverso un percorso a-uno viene rifiutato: la chiave esterna vive sulla
  tabella del padre.
- **Relazioni dichiarate dentro una `map`** — sono un campo di quella map.

## Interfaccia Completa della Relazione

`Relation` è un'unione chiusa — un membro per kind, ognuno con i soli campi che
quel kind possiede. Non esiste combinazione di campi che descriva due
collegamenti diversi, né un campo che tu possa impostare e che il kind non usi.

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
    through?: { table?: string; sourceColumn?: string; targetColumn?: string };
}

interface ViaRelation extends RelationBase {
    kind: "via";
    cardinality: "one" | "many";    // a join chain cannot imply it
    joinPath: JoinStep[];
}
```

### La forma risolta

Quello che scrivi sopra è la forma di *autore*. Internamente Rebase lavora con
`ResolvedRelation`: lo stesso collegamento con ogni valore predefinito riempito e
niente di opzionale, più `cardinality`, `targetSlug` e due flag — `writable`
(falso solo per `via`) e `shared` (vero quando le righe di destinazione
appartengono anche ad altri padri, così che una rimozione scolleghi invece di
eliminare).

`sourceKey` è l'unica eccezione a «niente di opzionale»: il suo valore
predefinito è la chiave primaria dell'origine, e risolverla richiede lo schema
del driver, che la risoluzione non ha. Lì `undefined` significa «la chiave
primaria» e nient'altro.

Non scrivi mai una `ResolvedRelation`. Su una proprietà di relazione, `relation`
è la tua e `resolvedRelation` è quella riempita, timbrata durante la
normalizzazione.

## Passi Successivi

- **[Regole di Sicurezza](/docs/collections/security-rules)** — Sicurezza a Livello di Riga
- **[Proprietà](/docs/collections/properties)** — Riferimento ai tipi di proprietà
