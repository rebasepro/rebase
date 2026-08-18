---
title: Datenimport & -export
sidebar_label: Datenimport & -export
description: Importieren Sie Daten aus CSV-, JSON- und Excel-Dateien in Ihre Collections und exportieren Sie Collection-Daten nach CSV oder JSON mit optionalen berechneten Feldern.
---

## Überblick

Rebase enthält integrierte Datenimport- und -exportwerkzeuge, die direkt über das Admin-Panel zugänglich sind. Der Import unterstützt CSV-, JSON- und Excel-Dateien mit einem Spalten-Mapping-Assistenten. Der Export unterstützt CSV und JSON mit optionalen berechneten Feldern.

Beide Funktionen sind standardmäßig auf allen Collections aktiviert und können pro Collection konfiguriert oder deaktiviert werden.

## Daten importieren

### Wie man importiert

1. Öffnen Sie eine Collection im Admin-Panel
2. Klicken Sie auf die Schaltfläche **Importieren** in der Toolbar
3. Wählen Sie Ihre Datei aus oder ziehen Sie sie per Drag & Drop
4. Ordnen Sie die Dateispalten den Collection-Properties zu
5. Sehen Sie sich die Daten in der Vorschau an und beheben Sie etwaige Validierungsfehler
6. Klicken Sie auf **Importieren**, um alle Entitäten zu speichern

### Unterstützte Formate

| Format | Erweiterungen | Hinweise |
|--------|-----------|-------|
| CSV | `.csv` | Erkennt Trennzeichen automatisch |
| JSON | `.json` | Erwartet ein Array von Objekten |
| Excel | `.xlsx` | Liest das erste Blatt |

### Spalten-Mapping

Der Import-Assistent versucht automatisch, die Dateispalten anhand des Namens den Collection-Properties zuzuordnen. Sie können die Zuordnungen vor dem Import manuell anpassen:

- **Exakte Übereinstimmungen** werden automatisch zugeordnet (z. B. `name` → `name`)
- **Nicht zugeordnete Spalten** können manuell zugeordnet oder übersprungen werden
- **Typ-Konvertierung** übernimmt String-zu-Zahl, String-zu-Boolean und das Parsen von Datumsangaben

### Validierung

Vor dem Import validiert der Assistent alle Zeilen gegen die Property-Definitionen Ihrer Collection:

- Pflichtfelder müssen vorhanden sein
- Enum-Werte müssen den definierten Optionen entsprechen
- Datentypen müssen kompatibel sein (z. B. wird ein Textwert für ein Zahlenfeld markiert)
- Validierungsfehler werden pro Zeile angezeigt, sodass Sie sie vor dem Import beheben können

### Import-Konfiguration

Der Import ist standardmäßig aktiviert. Um ihn für eine bestimmte Collection zu deaktivieren, verwenden Sie das Unterobjekt `admin`:

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    // Import is enabled by default
});
```

## Daten exportieren

### Wie man exportiert

1. Öffnen Sie eine Collection im Admin-Panel
2. Wenden Sie optional Filter an, um eine Teilmenge der Daten zu exportieren
3. Klicken Sie auf die Schaltfläche **Exportieren** in der Toolbar
4. Wählen Sie das Format: **CSV** oder **JSON**
5. Die Datei wird sofort heruntergeladen

### Exportformate

| Format | Beschreibung |
|--------|-------------|
| CSV | Kommagetrennte Werte, kompatibel mit Excel und Google Sheets |
| JSON | Array von Objekten, nützlich für die programmatische Verarbeitung |

### Filtern vor dem Export

Alle aktiven Filter in der Collection-Ansicht werden auf den Export angewendet. So können Sie nur eine Teilmenge Ihrer Daten exportieren:

- Wenden Sie Spaltenfilter oder Suchbegriffe in der Collection-Ansicht an
- Klicken Sie auf **Exportieren** — nur die gefilterten Zeilen werden einbezogen

### Export-Konfiguration

Der Export ist standardmäßig aktiviert. Sie können ihn mit zusätzlichen berechneten Feldern konfigurieren:

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: true            // Enable (default: true)
    }
});

```

Um den Export zu deaktivieren:

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: false
    }
});

```

### Berechnete Felder hinzufügen

Verwenden Sie das `ExportConfig`-Objekt, um Ihren Exporten benutzerdefinierte berechnete Spalten hinzuzufügen. Diese Spalten existieren nicht in der Datenbank — sie werden zur Exportzeit berechnet:

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: {
            additionalFields: [
                {
                    key: "computed_margin",
                    builder: ({ entity }) => {
                        const price = entity.values.price as number;
                        const cost = entity.values.cost as number;
                        return String(price - cost);
                    }
                },
                {
                    key: "full_url",
                    builder: ({ entity }) => {
                        return `https://mystore.com/products/${entity.id}`;
                    }
                }
            ]
        }
    }
});

```

Jeder `additionalFields`-Eintrag hat:

| Property | Typ | Beschreibung |
|----------|------|-------------|
| `key` | `string` | Spaltenname im Export |
| `builder` | `({ entity, context }) => string \| Promise<string>` | Funktion, die den Wert berechnet |

Die `builder`-Funktion erhält die aktuelle `entity` und den `RebaseContext` (der den authentifizierten Benutzer enthält), sodass Sie Werte sowohl auf Basis der Daten als auch der Berechtigungen berechnen können.

### Asynchrone berechnete Felder

Die `builder`-Funktion kann asynchron sein, was nützlich ist, wenn der berechnete Wert eine Datenbankabfrage oder einen API-Aufruf erfordert:

```typescript
exportable: {
    additionalFields: [
        {
            key: "author_name",
            builder: async ({ entity, context }) => {
                const author = await context.data.users.findById(
                    entity.values.authorId as string
                );
                return author?.values.displayName ?? "Unknown";
            }
        }
    ]
}
```

## Nächste Schritte

- **[Collections](/docs/collections)** — Definieren Sie Ihr Datenmodell
- **[Frontend-Überblick](/docs/frontend)** — Admin-Panel und UI-Komponenten
- **[Client-SDK](/docs/sdk)** — Programmatischer Datenzugriff
