---
sourceHash: 62f27c4cab31e65a
title: Daten abfragen
sidebar_label: Daten abfragen
description: CRUD-Operationen, Fluent-Query-Builder, Filteroperatoren, Paginierung, Sortierung und das Laden von Relationen mit dem Rebase Client SDK.
---

## Zugriff auf Collections

Greifen Sie auf jede Collection über `client.data.<collectionName>` (camelCase, automatisch in snake_case umgewandelt) oder `client.data.collection<Record<string, unknown>>("slug")` (expliziter Slug) zu:

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Strict Mode (generiertes SDK):** Wenn Sie das generierte `collectionsDictionary` an `createRebaseClient` übergeben, validiert der Daten-Proxy Property-Zugriffe zum Zeitpunkt des Zugriffs. Ein Tippfehler wie `client.data.prodcuts` wirft sofort einen Fehler mit einer hilfreichen Meldung und einem Vorschlag für die nächstgelegene Übereinstimmung, anstatt später einen verwirrenden 404 zu erzeugen. Verwenden Sie `client.data.collection<Record<string, unknown>>("slug")`, um die Validierung für dynamische oder zur Laufzeit bestimmte Slugs zu umgehen.

## CRUD-Operationen

### Find (Auflisten)

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

// data is Entity<M>[]  — each item has { id, values, path }
// meta has { total, limit, offset, hasMore }
```

### Nach ID suchen

```typescript
const product = await client.data.products.findById(42);
// Returns Entity<M> | undefined
```

### Erstellen

```typescript
const newProduct = await client.data.products.create({
    name: "New Product",
    price: 29.99,
    active: true
});

// With a specific ID
const newProduct = await client.data.products.create(
    { name: "Custom ID Product" },
    "my-custom-id"
);
```

### Aktualisieren

```typescript
const updated = await client.data.products.update(42, {
    name: "Updated Name",
    price: 39.99
});
```

### Löschen

```typescript
await client.data.products.delete(42);
```

### Zählen

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Fluent-Query-Builder

Verketten Sie Methoden für ausdrucksstärkere Abfragen:

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();
```

### Verfügbare Methoden

| Methode | Beschreibung | Beispiel |
|--------|-------------|---------|
| `.where(field, op, value)` | Fügt eine Filterbedingung hinzu | `.where("age", ">=", 18)` |
| `.orderBy(field, dir)` | Sortiert die Ergebnisse | `.orderBy("name", "asc")` |
| `.limit(n)` | Begrenzt die Anzahl der Ergebnisse | `.limit(25)` |
| `.offset(n)` | Überspringt die ersten N Ergebnisse | `.offset(50)` |
| `.search(text)` | Volltextsuche | `.search("laptop")` |
| `.include(...relations)` | Bindet verwandte Entitäten ein | `.include("author", "tags")` |
| `.find()` | Führt die Abfrage aus | Gibt `FindResult<M>` zurück |
| `.listen(onUpdate, onError?)` | Abonniert Echtzeit-Updates | Gibt `unsubscribe()` zurück |

### Filteroperatoren

| Operator | Alias | Beschreibung |
|----------|-------|-------------|
| `"=="` | `"eq"` | Gleich |
| `"!="` | `"neq"` | Ungleich |
| `">"` | `"gt"` | Größer als |
| `">="` | `"gte"` | Größer oder gleich |
| `"<"` | `"lt"` | Kleiner als |
| `"<="` | `"lte"` | Kleiner oder gleich |
| `"in"` | | Wert in einem Array |
| `"not-in"` | `"nin"` | Wert nicht in einem Array |
| `"array-contains"` | `"cs"` | Array-Feld enthält den Wert |
| `"array-contains-any"` | `"csa"` | Array-Feld enthält einen der Werte |

### Syntaxvarianten der Where-Klausel

Der Parameter `where` in `find()` unterstützt zwei Formate:

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

> **Hinweis:** Vorserialisierte PostgREST-Strings (Format 2) sind ein Notausgang, um Filterwerte zu übergeben, die bereits im Wire-Format vorliegen. Bevorzugen Sie die Tuple-Syntax für Typsicherheit und Lesbarkeit.

## Paginierung

```typescript
// Offset-based pagination
const page1 = await client.data.products.find({ limit: 20, offset: 0 });
const page2 = await client.data.products.find({ limit: 20, offset: 20 });

// Check if more pages exist
if (page1.meta.hasMore) {
    // fetch next page
}

// Page-number pagination (1-indexed)
const page = await client.data.products.find({ page: 2, limit: 20 });
```

`limit` muss eine ganze Zahl zwischen 1 und 1000 sein. Ein größerer Wert — oder
eine Null, eine negative Zahl oder ein Bruch — wird mit einem 400
`INVALID_LIMIT` abgelehnt statt beschnitten, denn eine stillschweigend kleinere
Seite lässt sich nicht von der letzten unterscheiden. Um über diese Obergrenze
hinaus zu lesen, durchlaufen Sie die Seiten mit `iterate()` oder `findAll()`.

## Sortierung

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

## Volltextsuche

```typescript
// Via find params
const { data } = await client.data.products.find({
    searchString: "wireless headphones"
});

// Fluent style
const { data } = await client.data.products
    .search("wireless headphones")
    .limit(10)
    .find();
```

## Relationen laden

Relationen können eingebunden werden, sodass verwandte Entitäten zusammen mit den Primärdaten zurückgegeben werden, statt nur ihrer Fremdschlüssel-IDs.

### Verwendung von `include()` (Fluent)

```typescript
// Include specific relations
const { data } = await client.data.posts
    .include("author", "categories")
    .find();

// Include all defined relations
const { data } = await client.data.posts
    .include("*")
    .find();
```

### Verwendung von `find({ include })` (Parameter)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Kombination mit Filtern

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Relationsdaten lesen

Wenn Relationen eingebunden sind, enthält die Antwort **sowohl** den skalaren Fremdschlüssel als auch das hydrierte Relationsobjekt:

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

> **Hinweis:** Ohne `.include("author")` wird nur das skalare Feld `authorId` zurückgegeben. Das hydrierte `author`-Objekt ist `undefined`.

### Relationsnamen

Die Relationsnamen, die Sie an `include()` übergeben, müssen mit dem `relationName` übereinstimmen, der im `relations`-Array der Collection definiert ist:

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Benutzerdefinierte Endpunkte

Rufen Sie benutzerdefinierte Server-Endpunkte auf, die über das Functions-System registriert wurden:

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

## Nächste Schritte

- **[Authentifizierung](/docs/sdk/authentication)** — Anmelden, Registrieren, OAuth, Sessions
- **[Echtzeit-Abonnements](/docs/sdk/realtime)** — Live-Daten mit WebSockets
- **[Speicher & Dateien](/docs/sdk/storage)** — Dateien hochladen, herunterladen und verwalten
- **[Relationen](/docs/collections/relations)** — Relationen zwischen Collections definieren
