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
const postsCollection: EntityCollection = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { type: "string", name: "Title" },
        content: { type: "string", name: "Content", multiline: true },
        author: { 
            type: "relation", 
            name: "Author", 
            target: () => usersCollection,
            cardinality: "one",
            direction: "owning",
            localKey: "author_id"
        }
    }
};
```

### 2. Array di Relazioni Esplicite

Per casi d'uso avanzati o quando una relazione non mappa direttamente a un campo del form, puoi definirla nell'array `relations`:

```typescript
const postsCollection: EntityCollection = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { type: "string", name: "Title" },
        content: { type: "string", name: "Content", multiline: true },
        author: { type: "relation", name: "Author", relationName: "author" }
    },
    relations: [
        {
            relationName: "author",
            target: () => usersCollection,
            cardinality: "one",
            localKey: "author_id"
        }
    ]
};
```

## Tipi di Relazione

### Uno-a-Uno / Molti-a-Uno

Una chiave esterna su **questa** tabella punta alla chiave primaria di un'altra tabella.

```typescript
relations: [
    {
        relationName: "author",
        target: () => usersCollection,
        cardinality: "one",          // This entity has ONE author
        direction: "owning",         // The FK is on THIS table
        localKey: "author_id"        // Column on the posts table
    }
]
```

Questo crea: `posts.author_id → users.id`

### Uno-a-Molti (Inverso)

La chiave esterna si trova sulla tabella **target**, puntando a questa entità.

```typescript
// On the Users collection:
relations: [
    {
        relationName: "posts",
        target: () => postsCollection,
        cardinality: "many",          // This user has MANY posts
        direction: "inverse",         // The FK is on the TARGET table
        foreignKeyOnTarget: "author_id"  // Column on the posts table
    }
]
```

### Molti-a-Molti (Tabella di Giunzione)

Due collezioni connesse tramite una tabella di giunzione intermedia.

```typescript
// On the Users collection:
relations: [
    {
        relationName: "roles",
        target: () => rolesCollection,
        cardinality: "many",
        direction: "owning",
        through: {
            table: "user_roles",         // Junction table name
            sourceColumn: "user_id",     // FK to this collection
            targetColumn: "role_id"      // FK to target collection
        }
    }
]
```

Questo crea:
```sql
CREATE TABLE user_roles (
    user_id INTEGER REFERENCES users(id),
    role_id INTEGER REFERENCES roles(id),
    PRIMARY KEY (user_id, role_id)
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

![Relation field in form](/img/features/relation-form-field.png)

Quando si renderizza un'anteprima (come in una cella di tabella o un chip di riferimento), Rebase gestisce automaticamente l'idratazione:

![Relation preview in table](/img/features/relation-table-preview.png)

## Join Multi-Salto

Per relazioni complesse che attraversano più tabelle, usa `joinPath`:

```typescript
// Users → Permissions through Roles
relations: [
    {
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
        relationName: "author",
        target: () => usersCollection,
        cardinality: "one",
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
    article.values.author_id;     // "uuid-1234"

    // Hydrated relation — only present when included
    article.values.author?.name;  // "Jane Doe"
}
```

> I nomi delle relazioni passati a `include()` devono corrispondere al `relationName` definito nell'array `relations` della collezione.

Per la documentazione completa del query builder (filtro, ordinamento, paginazione, real-time), consulta la [documentazione dell'SDK Client](/docs/sdk).

## Interfaccia Completa della Relazione

```typescript
interface Relation {
    relationName?: string;
    target: () => EntityCollection;
    cardinality: "one" | "many";
    direction?: "owning" | "inverse";
    inverseRelationName?: string;
    localKey?: string;
    foreignKeyOnTarget?: string;
    through?: {
        table: string;
        sourceColumn: string;
        targetColumn: string;
    };
    joinPath?: JoinStep[];
    onUpdate?: "cascade" | "restrict" | "no action" | "set null" | "set default";
    onDelete?: "cascade" | "restrict" | "no action" | "set null" | "set default";
    overrides?: Partial<EntityCollection>;
    validation?: { required?: boolean };
}
```

## Passi Successivi

- **[Regole di Sicurezza](/docs/collections/security-rules)** — Sicurezza a Livello di Riga
- **[Proprietà](/docs/collections/properties)** — Riferimento ai tipi di proprietà
