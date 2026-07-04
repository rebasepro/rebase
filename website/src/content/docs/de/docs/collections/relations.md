---
title: Beziehungen
sidebar_label: Beziehungen
description: Definieren Sie Eins-zu-Eins-, Eins-zu-Viele- und Viele-zu-Viele-SQL-Beziehungen zwischen Sammlungen mit Fremdschlüsseln, Verbindungstabellen und Multi-Hop-Joins.
---

## Übersicht

Beziehungen definieren, wie Sammlungen auf Datenbankebene miteinander verbunden sind. Sie ermöglichen Rebase, Folgendes zu tun:

- **Beziehungsauswahlfelder** in Entitätsformularen rendern
- **Verwandte Entitäten** beim Anzeigen von Vorschauen auflösen
- **Fremdschlüsselbeschränkungen** im Drizzle-Schema generieren
- **Kaskadierendes Löschen/Aktualisieren** unterstützen

Beziehungen können entweder inline innerhalb der Eigenschaft oder explizit im `relations`-Array einer Sammlung definiert werden:

### 1. Inline-Beziehungen (Empfohlen)

Sie können die Beziehung direkt in der Eigenschaft definieren. Das Framework extrahiert diese zur Normalisierungszeit automatisch in das `relations[]` der Sammlung, sodass Sie keinen separaten `relations[]`-Eintrag mehr für Eigenschaften benötigen.

```typescript
const postsCollection: CollectionConfig = {
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

### 2. Explizites Beziehungen-Array

Für fortgeschrittene Anwendungsfälle oder wenn eine Beziehung nicht direkt einem Formularfeld zugeordnet werden kann, können Sie sie im `relations`-Array definieren:

```typescript
const postsCollection: CollectionConfig = {
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

## Beziehungstypen

### Eins-zu-Eins / Viele-zu-Eins

Ein Fremdschlüssel in **dieser** Tabelle verweist auf den Primärschlüssel einer anderen Tabelle.

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

Dies erzeugt: `posts.author_id → users.id`

### Eins-zu-Viele (Invers)

Der Fremdschlüssel befindet sich in der **Ziel**tabelle und verweist zurück auf diese Entität.

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

### Viele-zu-Viele (Verbindungstabelle)

Zwei Sammlungen, die über eine zwischengeschaltete Verbindungstabelle verbunden sind.

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

Dies erzeugt:
```sql
CREATE TABLE user_roles (
    user_id INTEGER REFERENCES users(id),
    role_id INTEGER REFERENCES roles(id),
    PRIMARY KEY (user_id, role_id)
);
```

## Beziehungseigenschaften

Um ein Beziehungsfeld in einem Formular zu rendern, fügen Sie eine Eigenschaft mit `type: "relation"` hinzu:

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

![Relationsfeld im Formular](/img/features/relation-form-field.png)

Beim Rendern einer Vorschau (z. B. in einer Tabellenzelle oder einem Referenz-Chip) übernimmt Rebase die Hydration automatisch:

![Relationsvorschau in Tabelle](/img/features/relation-table-preview.png)

## Multi-Hop-Joins

Für komplexe Beziehungen, die mehrere Tabellen durchqueren, verwenden Sie `joinPath`:

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

### Joins mit zusammengesetztem Schlüssel

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

## Kaskadenregeln

Steuern Sie, was passiert, wenn verwandte Entitäten aktualisiert oder gelöscht werden:

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

| Aktion | Verhalten |
|--------|----------|
| `"cascade"` | Die Änderung auf verwandte Zeilen übertragen |
| `"restrict"` | Den Vorgang verhindern, wenn verwandte Zeilen existieren |
| `"no action"` | Gleich wie restrict (Aufschub bis zur Beschränkungsprüfung) |
| `"set null"` | Die FK-Spalte auf NULL setzen |
| `"set default"` | Die FK-Spalte auf ihren Standardwert setzen |

## Beziehungen im SDK abrufen

Beim Abfragen von Daten über das Rebase Client SDK sind Beziehungen standardmäßig **nicht** enthalten. Verwenden Sie die Methode `include()`, um verwandte Entitäten zusammen mit den primären Daten anzufordern.

### Spezifische Beziehungen einschließen

```typescript
const { data } = await client.data.articles
    .include("author", "categories")
    .find();
```

### Alle Beziehungen einschließen

```typescript
const { data } = await client.data.articles
    .include("*")
    .find();
```

### Verwendung der params-Syntax

```typescript
const { data } = await client.data.articles.find({
    include: ["author", "categories"]
});
```

### Antwortstruktur

Wenn enthalten, enthält die Antwort sowohl den **skalaren Fremdschlüssel** als auch das **hydrierte Beziehungsobjekt**:

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

> Die an `include()` übergebenen Beziehungsnamen müssen mit dem `relationName` übereinstimmen, der im `relations`-Array der Sammlung definiert ist.

Für die vollständige Referenz zum Query Builder (Filtern, Sortieren, Paginierung, Echtzeit) siehe die [Client SDK-Dokumentation](/docs/sdk).

## Vollständige Beziehungsschnittstelle

```typescript
interface Relation {
    relationName?: string;
    target: () => CollectionConfig;
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
    overrides?: Partial<CollectionConfig>;
    validation?: { required?: boolean };
}
```

## Nächste Schritte

- **[Sicherheitsregeln](/docs/collections/security-rules)** — Zeilenebenen-Sicherheit
- **[Eigenschaften](/docs/collections/properties)** — Referenz der Eigenschaftstypen

---
