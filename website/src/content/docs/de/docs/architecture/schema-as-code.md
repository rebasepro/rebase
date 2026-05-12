---
title: Schema als Code
sidebar_label: Schema als Code
slug: docs/architecture/schema-as-code
description: Wie Rebase TypeScript-Sammlungen als einzige Quelle der Wahrheit für Ihr Datenbankschema, Ihre Benutzeroberfläche und Ihre API verwendet.
---

## Die Kernidee

In Rebase sind Ihre **TypeScript-Sammlungsdefinitionen die einzige Quelle der Wahrheit**. Aus einem Satz von TypeScript-Objekten generiert Rebase:

- **PostgreSQL-Tabellen** über die Drizzle ORM-Schemaerzeugung
- **CRUD-Benutzeroberfläche** — Formulare, Tabellen, Validierung, Feldtypen
- **REST-API**-Endpunkte mit Filterung, Sortierung und Paginierung
- **Client-SDK** — typsichere Datenoperationen
- **RLS-Richtlinien** — Zeilenebenen-Sicherheit in Postgres

Das bedeutet, Ihr Schema ist:
- **Versionskontrolliert** — jede Änderung ist ein Git-Commit
- **Typsicher** — TypeScript fängt Fehler zur Kompilierzeit ab
- **Überprüfbar** — Schemaänderungen durchlaufen Pull-Requests
- **Portabel** — dieselbe Definition funktioniert über Frontend, Backend und CLI hinweg

## Visuelle Bearbeitung mit AST-Manipulation

Rebase bietet auch einen **visuellen Sammlungseditor** im Studio-Modus. Wenn ein Nicht-Entwickler den visuellen Editor verwendet, um ein Feld hinzuzufügen:

1. Das Studio modifiziert die Datenbank **nicht** direkt
2. Stattdessen verwendet es [ts-morph](https://ts-morph.com/), um Ihre TypeScript-Quelldatei als AST zu parsen
3. Es fügt die neue Eigenschaftsdefinition präzise in den `properties`-Block ein
4. **Alle vorhandenen Code, Callbacks und benutzerdefinierte Logik bleiben unberührt erhalten**
5. Die Datei wird gespeichert, wodurch ein Hot-Reload ausgelöst wird

Dieser Ansatz „UI als Code-Generator“ bedeutet, dass visuelle Bearbeitungen dasselbe saubere TypeScript erzeugen, das ein Entwickler von Hand schreiben würde.

## Schema-Generierungs-Pipeline

```
TypeScript Collections
        │
        ▼
  rebase schema generate
        │
        ▼
  Drizzle Schema (schema.generated.ts)
        │
        ▼
  rebase db generate
        │
        ▼
  SQL Migration Files
        │
        ▼
  rebase db migrate
        │
        ▼
  PostgreSQL Tables
```

### Beispiel

Gegeben diese Sammlung:

```typescript
const productsCollection: EntityCollection = {
    slug: "products",
    table: "products",
    properties: {
        name: { type: "string", name: "Name", validation: { required: true } },
        price: { type: "number", name: "Price", columnType: "numeric" },
        active: { type: "boolean", name: "Active", defaultValue: true },
        created_at: { type: "date", name: "Created", autoValue: "on_create" }
    }
};
```

Rebase generiert dieses Drizzle-Schema:

```typescript
// schema.generated.ts
import { pgTable, varchar, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

export const products = pgTable("products", {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull(),
    price: numeric("price"),
    active: boolean("active").default(true),
    created_at: timestamp("created_at").defaultNow()
});
```

Das ergibt diese SQL:

```sql
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL,
    price NUMERIC,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## Nächste Schritte

- **[Sammlungen](/docs/collections)** — Vollständige Referenz zur Sammlungs-Konfiguration
- **[Eigenschaften](/docs/collections/properties)** — Detaillierte Spaltentyp-Zuordnungen
---
