---
sourceHash: 35d04e650c33c5cb
title: Client-SDK
sidebar_label: Client-SDK
description: Verwenden Sie das Rebase Client SDK, um von jeder JavaScript-Anwendung aus mit Ihrem Backend zu interagieren – Datenoperationen, Authentifizierung, Speicherung und Echtzeit-Abonnements.
---

## Übersicht

Das Paket `@rebasepro/client` bietet ein typsicheres JavaScript SDK für die Interaktion mit Ihrem Rebase-Backend. Es umfasst:

- **Datenoperationen** — CRUD mit Filterung, Sortierung und Paginierung
- **Abrufen von Relationen** — Verwandte Entitäten mit `.include()` einbeziehen
- **Echtzeit-Abonnements** — WebSocket-basierte Live-Updates
- **Authentifizierung** — Token-Verwaltung, Anmeldung, Registrierung
- **Speicherung** — Datei-Upload und -Download

## Installation

```bash
pnpm add @rebasepro/client
```

## Einrichtung

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL
});
```

Der Client verwaltet Authentifizierungs-Tokens automatisch — sobald sich ein Benutzer anmeldet, enthalten alle nachfolgenden Anfragen das JWT.

## Datenoperationen

Greifen Sie auf jede Sammlung über `client.data.<collectionName>` (camelCase) oder `client.data.collection<Record<string, unknown>>("slug")` (kebab-case) zu:

```typescript
// Property-style access (auto-converts to kebab-case)
client.data.blogPosts    // → "blog-posts"
client.data.users        // → "users"

// Dynamic access by slug
client.data.collection("blog-posts")
```

### Suchen (Liste)

```typescript
// Alle Produkte (Standardlimit: 20)
const { data, meta } = await client.data.products.find();

// Mit Paginierung, Filterung und Sortierung
const { data, meta } = await client.data.products.find({
    where: { active: ["==", true], price: [">=", 100] },
    orderBy: ["createdAt", "desc"],
    limit: 25,
    offset: 0
});

// data ist Entity<M>[] — jedes Element hat { id, values, path }
// meta hat { total, limit, offset, hasMore }
```

### Nach ID suchen

```typescript
const product = await client.data.products.findById(42);
// Entität<M> | undefiniert
```

### Erstellen

```typescript
const newProduct = await client.data.products.create({
    name: "New Product",
    price: 29.99,
    active: true
});

// Mit einer spezifischen ID
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
| `.orderBy(field, dir)` | Sortiert Ergebnisse | `.orderBy("name", "asc")` |
| `.limit(n)` | Begrenzt die Ergebnisanzahl | `.limit(25)` |
| `.offset(n)` | Überspringt die ersten N Ergebnisse | `.offset(50)` |
| `.search(text)` | Volltextsuche | `.search("laptop")` |
| `.include(...relations)` | Bezieht verwandte Entitäten ein | `.include("author", "tags")` |
| `.find()` | Führt die Abfrage aus | Gibt `FindResult<M>` zurück |
| `.listen(onUpdate)` | Abonniert Echtzeit-Updates | Gibt `unsubscribe()` zurück |

### Filteroperatoren

| Operator | Alias | Beschreibung |
|----------|-------|-------------|
| `"=="` | `"eq"` | Gleich |
| `"!="` | `"neq"` | Ungleich |
| `">"` | `"gt"` | Größer als |
| `">="` | `"gte"` | Größer als oder gleich |
| `"<"` | `"lt"` | Kleiner als |
| `"<="` | `"lte"` | Kleiner als oder gleich |
| `"in"` | | Wert im Array |
| `"not-in"` | `"nin"` | Wert nicht im Array |
| `"array-contains"` | `"cs"` | Array-Feld enthält Wert |
| `"array-contains-any"` | `"csa"` | Array-Feld enthält einen der Werte |

## Abrufen von Relationen

Relationen können in Abfrageergebnissen enthalten sein, sodass verwandte Entitäten zusammen mit den primären Daten zurückgegeben werden, anstatt nur deren Fremdschlüssel-IDs.

### Verwendung von `include()` (Fluent)

```typescript
// Spezifische Relationen einbeziehen
const { data } = await client.data.posts
    .include("author", "categories")
    .find();

// Alle definierten Relationen einbeziehen
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

### Kombinieren mit Filtern

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Lesen von Relationsdaten

Wenn Relationen enthalten sind, enthält die Antwort **sowohl** den skalaren Fremdschlüssel als auch das hydrierte Relations-Objekt:

```typescript
const { data } = await client.data.posts
    .include("author")
    .find();

for (const post of data) {
    // Skalarer Fremdschlüssel — immer vorhanden
    console.log(post.values.authorId);    // "uuid-1234"

    // Hydrierte Relation — vorhanden, wenn enthalten
    console.log(post.values.author?.name); // "Jane Doe"
}
```

> **Hinweis:** Ohne `.include("author")` wird nur das skalare Feld `authorId` zurückgegeben. Das hydrierte `author`-Objekt ist `undefined`.

### Relationsnamen

Die Relationsnamen, die Sie an `include()` übergeben, müssen dem `relationName` entsprechen, der im `relations`-Array der Sammlung definiert ist. Zum Beispiel:

```typescript
// Sammlungsdefinition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK-Nutzung — Namen müssen übereinstimmen
client.data.articles.include("author", "categories").find()
```

## Echtzeit-Abonnements

Abonnieren Sie Sammlungsänderungen über WebSocket:

```typescript
// Alle aktiven Produkte abonnieren
const unsubscribe = client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (response) => {
        console.log("Products updated:", response.data);
    }
);

// Abonnement beenden, wenn fertig
unsubscribe();
```

Eine einzelne Entität abonnieren:

```typescript
const unsubscribe = client.data.products.listenById(
    42,
    (entity) => {
        console.log("Product changed:", entity);
    }
);
```

Sie können auch über den Fluent Query Builder abonnieren:

```typescript
const unsubscribe = client.data.products
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(20)
    .listen(
        (response) => console.log("Updated:", response.data),
        (error) => console.error("Error:", error)
    );
```

Der WebSocket-Client verwaltet die Wiederverbindung automatisch.

## Authentifizierung

```typescript
// Anmelden
const session = await client.auth.signIn("user@example.com", "password");

// Registrieren
const session = await client.auth.signUp("user@example.com", "password");

// Google OAuth
const session = await client.auth.signInWithGoogle(googleIdToken);

// Token aktualisieren
await client.auth.refreshToken();

// Abmelden
await client.auth.signOut();

// Aktuellen Benutzer abrufen
const user = client.auth.getUser();
```

## Speicherung

```typescript
// Hochladen
const result = await client.storage.uploadFile(file, "products/image.jpg");

// URL abrufen
const url = await client.storage.getDownloadURL("products/image.jpg");

// Löschen
await client.storage.deleteFile("products/image.jpg");
```

## Benutzerdefinierte Endpunkte

Rufen Sie benutzerdefinierte Server-Endpunkte auf (Cloud Functions, benutzerdefinierte Routen usw.):

```typescript
const result = await client.call<{ summary: string }>("functions/generate-summary", {
    articleId: 42
});
```

## Verwendung mit React

In einem Rebase-Frontend wird der Client typischerweise einmal erstellt und über einen Kontext geteilt:

```tsx
const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

// Pass to Rebase provider
<Rebase client={client} ...>
```

Zugriff von jeder Komponente aus:

```tsx
import { useRebaseClient } from "@rebasepro/app";

function MyComponent() {
    const client = useRebaseClient();
    // Verwenden Sie client.data, client.auth, client.storage
}
```

## SDK-Generator

Generieren Sie ein vollständig typisiertes Client-SDK aus Ihren Sammlungsdefinitionen:

```bash
rebase generate-sdk
```

Dies erstellt TypeScript-Typen für alle Ihre Entitäten, sodass Sie beim Verwenden des Clients Autovervollständigung und Typüberprüfung erhalten. Sowohl skalare Fremdschlüssel als auch Relations-Objekte sind in den generierten `Database`-Typen enthalten.

## Nächste Schritte

- **[Relationen](/docs/collections/relations)** — Definieren Sie Relationen zwischen Sammlungen
- **[Frontend-Übersicht](/docs/frontend)** — React-Framework und Komponenten
- **[Backend-Übersicht](/docs/backend)** — Serverkonfiguration
---
