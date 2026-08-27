---
title: Sicherheitsregeln (RLS)
sidebar_label: Sicherheitsregeln
description: Definieren Sie Row Level Security (RLS)-Richtlinien für Ihre Sammlungen mithilfe von praktischen Shortcuts oder rohen SQL-Ausdrücken.
---

## Übersicht

Sicherheitsregeln ermöglichen es Ihnen, **Row Level Security (RLS)**-Richtlinien für Ihre PostgreSQL-Tabellen direkt in Ihren Sammlungsdefinitionen zu definieren. Wenn das Drizzle-Schema generiert wird, erstellt Rebase die entsprechenden `CREATE POLICY`-Anweisungen.

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { /* ... */ },
    securityRules: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], ownerField: "authorId" }
    ]
});
```

## Funktionsweise

1. Sie definieren `securityRules` für eine Sammlung
2. `rebase schema generate` erstellt ein Drizzle-Schema mit aktivierter RLS
3. `rebase db push` oder `rebase db migrate` wendet die Richtlinien auf PostgreSQL an
4. Jede Abfrage wird automatisch nach dem Kontext des aktuellen Benutzers gefiltert

Die Identität des authentifizierten Benutzers ist in SQL verfügbar über:

| Funktion | Rückgabewert |
|----------|---------|
| `rebase.uid()` | Die ID des aktuellen Benutzers |
| `rebase.roles()` | Kommagetrennte App-Rollen-IDs |
| `rebase.jwt()` | Vollständige JWT-Claims als JSONB |

Diese werden vom Rebase-Backend automatisch pro Transaktion gesetzt.

## Praktische Shortcuts

### Eigentümerbasierter Zugriff

Das einfachste Muster — Benutzer können nur auf Zeilen zugreifen, die sie besitzen:

```typescript
securityRules: [
    { operation: "all", ownerField: "userId" }
]
```

Dies erzeugt: `USING (user_id = rebase.uid())`

### Öffentlicher Zugriff

Jedem (einschließlich nicht authentifizierten Benutzern) das Lesen erlauben:

```typescript
securityRules: [
    { operation: "select", access: "public" }
]
```

Dies erzeugt: `USING (true)`

### Authentifizierter Zugriff

Jedem authentifizierten Benutzer erlauben:

```typescript
securityRules: [
    { operation: "select", access: "authenticated" }
]
```

### Rollenbasierter Zugriff

Operationen auf bestimmte Rollen beschränken:

```typescript
securityRules: [
    { operation: "all", roles: ["admin"] },
    { operation: "select", roles: ["editor", "viewer"] }
]
```

## Rohe SQL-Ausdrücke

Für komplexe Logik verwenden Sie `using` und `withCheck`:

```typescript
securityRules: [
    {
        operation: "select",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

- **`using`** — Filtert, welche bestehenden Zeilen sichtbar sind (gilt für SELECT, UPDATE, DELETE)
- **`withCheck`** — Validiert neue Zeilenwerte (gilt für INSERT, UPDATE)

Spaltenreferenzen verwenden die `{column_name}`-Syntax, die zu der vollständig tabellenqualifizierten Spalte aufgelöst wird.

## Kombination von Shortcuts und SQL

Mischen Sie praktische Shortcuts mit rohem SQL:

```typescript
securityRules: [
    // Admins können alles tun
    { operation: "all", roles: ["admin"], using: "true" },
    // Reguläre Benutzer können nur ihre eigenen Zeilen sehen
    { operation: "select", ownerField: "userId" },
    // Benutzer können einfügen, aber nur für sich selbst
    { operation: "insert", withCheck: "{userId} = rebase.uid()" },
    // Gesperrte Zeilen können nicht aktualisiert werden
    { operation: "update", mode: "restrictive", using: "{is_locked} = false" }
]
```

## Permissiv vs. Restriktiv

PostgreSQL hat zwei Richtlinienmodi:

- **Permissiv** (Standard) — Mehrere permissive Richtlinien werden miteinander **verknüpft (OR)**. Wenn eine davon erfolgreich ist, wird der Zugriff gewährt.
- **Restriktiv** — Restriktive Richtlinien werden miteinander **verknüpft (AND)**. Alle müssen erfolgreich sein.

```typescript
securityRules: [
    // Permissiv: Eigentümer können auf ihre Zeilen zugreifen
    { operation: "all", ownerField: "userId" },
    // Restriktiv: aber gesperrte Zeilen können nicht aktualisiert werden
    { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" }
]
```

## Operationen

| Operation | SQL-Äquivalent | Beschreibung |
|-----------|---------------|-------------|
| `"select"` | `SELECT` | Zeilen lesen |
| `"insert"` | `INSERT` | Neue Zeilen erstellen |
| `"update"` | `UPDATE` | Bestehende Zeilen ändern |
| `"delete"` | `DELETE` | Zeilen entfernen |
| `"all"` | Alle oben genannten | Abkürzung für alle Operationen |

Sie können auch `operations` (Plural) verwenden, um eine Regel auf mehrere Operationen anzuwenden:

```typescript
{ operations: ["insert", "update", "delete"], ownerField: "authorId" }
```

## Vollständiges SecurityRule-Interface

```typescript
interface SecurityRule {
    name?: string;              // Menschlich lesbarer Richtlinienname
    operation?: SecurityOperation;   // Einzelne Operation
    operations?: SecurityOperation[]; // Mehrere Operationen
    mode?: "permissive" | "restrictive"; // Standard: "permissive"
    access?: "public" | "authenticated";
    ownerField?: string;        // Spalte, die die Benutzer-ID des Eigentümers enthält
    roles?: string[];           // App-Rollen, für die diese Richtlinie gilt
    using?: string;             // Roher SQL USING-Ausdruck
    withCheck?: string;         // Roher SQL WITH CHECK-Ausdruck
}
```

## Beispiele

### Blog-Plattform

```typescript
securityRules: [
    // Jeder kann veröffentlichte Beiträge lesen
    { operation: "select", using: "{status} = 'published'" },
    // Autoren können ihre eigenen Entwürfe sehen
    { operation: "select", ownerField: "authorId" },
    // Autoren können ihre eigenen Beiträge erstellen und bearbeiten
    { operations: ["insert", "update"], ownerField: "authorId" },
    // Nur Admins können löschen
    { operation: "delete", roles: ["admin"] }
]
```

### Mandantenfähiges SaaS

```typescript
securityRules: [
    {
        operation: "all",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

## Anonymer Zugriff (Öffentliche Einfügungen)

Ein häufiges Bedürfnis ist es, **nicht authentifizierten Benutzern** das Übermitteln von Daten zu ermöglichen — Kontaktformulare, Newsletter-Anmeldungen, öffentliche Anwendungen. Rebase bietet hierfür ein klares Muster.

### Empfohlen: `access: "public"` mit `withCheck`

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const contactMessagesCollection: PostgresCollectionConfig = {
    slug: "contact_messages",
    name: "Contact Messages",
    table: "contact_messages",
    securityRules: [
        // Jeder kann eine Kontaktanfrage senden
        {
            operation: "insert",
            // A raw rule carries `using` (which rows are visible) and `withCheck`
            // (what a write must satisfy); an insert only exercises the latter.
            using: "true",
            withCheck: "true"
        },
        // Nur Admins können Nachrichten lesen, aktualisieren oder löschen
        { operations: ["select", "update", "delete"], roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
};
```

Der `access: "public"`-Shortcut generiert eine Richtlinie, die die Operation ohne Authentifizierung ermöglicht.

### Für Lead-Generierung / Anmeldungen

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const leadSignupsCollection: PostgresCollectionConfig = {
    slug: "lead_magnet_signups",
    name: "Lead Magnet Signups",
    table: "lead_magnet_signups",
    securityRules: [
        // Anonyme Einfügungen erlauben
        { operation: "insert", using: "true", withCheck: "true" },
        // Admins können alle Anmeldungen einsehen
        { operation: "select", roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
};
```

### Wie anonyme Anfragen funktionieren

Wenn eine Anfrage ohne JWT-Token eingeht, setzt das Rebase-Backend die PostgreSQL-Sitzungsvariablen auf:

| Variable | Wert |
|----------|-------|
| `app.userId` | `'anonymous'` |
| `app.user_roles` | `''` (leer) |

Das bedeutet:

- `rebase.uid()` gibt `'anonymous'` zurück
- `rebase.roles()` gibt eine leere Zeichenkette zurück
- `access: "public"`-Richtlinien werden erfolgreich ausgeführt, da sie `USING (true)` / `WITH CHECK (true)` generieren
- `access: "authenticated"`-Richtlinien schlagen fehl, da sie eine echte Benutzer-ID prüfen
- `ownerField`-Richtlinien schlagen fehl, da keine Zeile `userId = 'anonymous'` haben wird (es sei denn, dies ist explizit festgelegt)

### Fortgeschritten: Rohes SQL für Anonyme

Wenn Sie eine feinere Kontrolle benötigen, verwenden Sie rohes SQL:

```typescript
securityRules: [
    {
        operation: "insert",
        withCheck: "rebase.uid() = 'anonymous' OR rebase.uid() IS NOT NULL"
    }
]
```

:::tip
Vermeiden Sie das ältere Muster, `string_to_array(rebase.roles(), ',')` für anonymen Zugriff zu prüfen. Der `access: "public"`-Shortcut ist einfacher und generiert die korrekte Richtlinie automatisch.
:::

## Nächste Schritte

- **[Beziehungen](/docs/collections/relations)** — Fremdschlüssel und Joins
- **[Entitäts-Callbacks](/docs/collections/callbacks)** — Lifecycle-Hooks
- **[Benutzerdefinierte Funktionen](/docs/backend/custom-functions)** — Benutzerdefinierte API-Endpunkte
---
