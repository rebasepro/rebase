---
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

Puoi definire la relazione direttamente sulla proprietà. Il framework le estrae automaticamente nell'array `relations[]` della collezione al momento della normalizzazione, quindi non hai più bisogno di una voce `relations[]` separata per le proprietà.

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
                target: () => usersCollection,
                localKey: "author_id"
            }
        }
    }
});
```

### 2. Array di Relazioni Esplicite

Per casi d'uso avanzati o quando una relazione non mappa direttamente a un campo del form, puoi definirla nell'array `relations`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { type: "string", name: "Title" },
        content: { type: "string", name: "Content", admin: { multiline: true } },
        author: { type: "relation", name: "Author", relationName: "author" }
    },
    relations: [
        {
            kind: "belongsTo",
            relationName: "author",
            target: () => usersCollection,
            localKey: "author_id"
        }
    ]
});
```

## Tipi di Relazione

### Uno-a-Uno / Molti-a-Uno

Una chiave esterna su **questa** tabella punta alla chiave primaria di un'altra tabella.

```typescript
relations: [
    {
        kind: "belongsTo",           // The FK is on THIS table
        relationName: "author",
        target: () => usersCollection,
        localKey: "author_id"        // Column on the posts table
    }
]
```

Questo crea: `posts.authorId → users.id`

### Uno-a-Molti (Inverso)

La chiave esterna si trova sulla tabella **target**, puntando a questa entità.

```typescript
// On the Users collection:
relations: [
    {
        kind: "hasMany",                 // The FK is on the TARGET table
        relationName: "posts",
        target: () => postsCollection,
        foreignKeyOnTarget: "authorId"  // Column on the posts table
    }
]
```

### Molti-a-Molti (Tabella di Giunzione)

Due collezioni connesse tramite una tabella di giunzione intermedia.

```typescript
// On the Users collection:
relations: [
    {
        kind: "manyToMany",
        relationName: "roles",
        target: () => rolesCollection,
        through: {
            table: "user_roles",         // Junction table name
            sourceColumn: "userId",     // FK to this collection
            targetColumn: "role_id"      // FK to target collection
        }
    }
]
```

Questo crea:
```sql
CREATE TABLE user_roles (
    userId INTEGER REFERENCES users(id),
    role_id INTEGER REFERENCES roles(id),
    PRIMARY KEY (userId, role_id)
);
```

## Proprietà delle Relazioni

Per renderizzare un campo di relazione in un form, aggiungi una proprietà con `type: "relation"`:

```typescript
properties: {
    author: {
        type: "relation",
        name: "Author",
        target: () => usersCollection, // Target collection
        widget: "select"           // "select" (dropdown) or "dialog" (full picker)
    }
}
```

Quando si renderizza un'anteprima (come in una cella di tabella o un chip di riferimento), Rebase gestisce automaticamente l'idratazione.

## Join Multi-Salto

Per relazioni complesse che attraversano più tabelle, usa `joinPath`:

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
                on: { from: "id", to: "userId" }
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
const { data } = await client.data.articles
    .include("author")
    .find();

for (const article of data) {
    // Scalar FK — always present
    article.values.authorId;     // "uuid-1234"

    // Hydrated relation — only present when included
    article.values.author?.name;  // "Jane Doe"
}
```

> I nomi delle relazioni passati a `include()` devono corrispondere al `relationName` definito nell'array `relations` della collezione.

Per la documentazione completa del query builder (filtro, ordinamento, paginazione, real-time), consulta la [documentazione dell'SDK Client](/docs/sdk).

## Interfaccia Completa della Relazione

```typescript
type Relation =
    | BelongsToRelation
    | HasOneRelation
    | HasManyRelation
    | ManyToManyRelation
    | ViaRelation;

// Every kind carries these:
interface RelationBase {
    relationName?: string;
    target: () => CollectionConfig;
    inverseRelationName?: string;
    onUpdate?: "cascade" | "restrict" | "no action" | "set null" | "set default";
    onDelete?: "cascade" | "restrict" | "no action" | "set null" | "set default";
    overrides?: Partial<CollectionConfig>;
}

// ...and only the fields its own kind uses:
interface BelongsToRelation extends RelationBase {
    kind: "belongsTo";
    localKey?: string;              // column on THIS table
}

interface HasOneRelation extends RelationBase {
    kind: "hasOne";
    foreignKeyOnTarget?: string;    // column on the TARGET table
}

interface HasManyRelation extends RelationBase {
    kind: "hasMany";
    foreignKeyOnTarget?: string;    // column on the TARGET table
}

interface ManyToManyRelation extends RelationBase {
    kind: "manyToMany";
    through?: {
        table?: string;
        sourceColumn?: string;      // FK naming THIS collection
        targetColumn?: string;
    };
}

interface ViaRelation extends RelationBase {
    kind: "via";
    cardinality: "one" | "many";    // a join chain cannot imply it
    joinPath: JoinStep[];           // read-only
}
```

## Passi Successivi

- **[Regole di Sicurezza](/docs/collections/security-rules)** — Sicurezza a Livello di Riga
- **[Proprietà](/docs/collections/properties)** — Riferimento ai tipi di proprietà
