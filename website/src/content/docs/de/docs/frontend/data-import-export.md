---
sourceHash: 2e2dfa451a30f422
title: Datenimport & -export
sidebar_label: Datenimport & -export
description: Importieren Sie Daten aus CSV-, JSON- und Excel-Dateien in Ihre Collections und exportieren Sie Collection-Daten nach CSV oder JSON mit optionalen berechneten Feldern.
---

## Übersicht

Rebase enthält integrierte Tools für den Datenimport und -export, auf die direkt über das Admin-Panel zugegriffen werden kann. Der Import unterstützt CSV-, JSON- und Excel-Dateien mit einem Assistenten für das Spalten-Mapping. Der Export unterstützt CSV und JSON mit optionalen berechneten Feldern.

Beide Funktionen sind für jede Collection verfügbar. Der Export kann pro Collection mit berechneten Feldern konfiguriert werden; keine von beiden kann pro Collection deaktiviert werden.

## Daten importieren

### So importieren Sie Daten

1. Öffnen Sie eine Collection im Admin-Panel
2. Klicken Sie in der Symbolleiste auf die Schaltfläche **Import**
3. Wählen Sie Ihre Datei aus oder ziehen Sie sie per Drag-and-Drop hinein
4. Weisen Sie die Dateispalten den Collection-Eigenschaften zu
5. Überprüfen Sie die Daten in der Vorschau und beheben Sie etwaige Validierungsfehler
6. Klicken Sie auf **Import**, um alle Entitäten zu speichern

### Unterstützte Formate

| Format | Erweiterungen | Hinweise |
|--------|---------------|----------|
| CSV | `.csv` | Erkennt Trennzeichen automatisch |
| JSON | `.json` | Erwartet ein Array von Objekten |
| Excel | `.xlsx` | Liest das erste Tabellenblatt |

### Spalten-Mapping

Der Import-Assistent versucht automatisch, Dateispalten anhand des Namens mit Collection-Eigenschaften abzugleichen. Sie können die Zuordnungen vor dem Import manuell anpassen:

- **Exakte Übereinstimmungen** werden automatisch zugeordnet (z. B. `name` → `name`)
- **Nicht zugeordnete Spalten** können manuell zugeordnet oder übersprungen werden
- **Typumwandlung (Type Coercion)** übernimmt String-zu-Zahl, String-zu-Boolean und das Parsen von Datumsangaben

### Validierung

Vor dem Import validiert der Assistent alle Zeilen anhand der Eigenschaftsdefinitionen Ihrer Collection:

- Erforderliche Felder müssen vorhanden sein
- Enum-Werte müssen mit den definierten Optionen übereinstimmen
- Datentypen müssen kompatibel sein (z. B. wird ein Textwert für ein Zahlenfeld markiert)
- Validierungsfehler werden pro Zeile angezeigt, sodass Sie diese vor dem Import beheben können

### Import-Konfiguration

Der Import ist für jede Collection verfügbar. Es gibt keine Einstellung pro Collection, um ihn zu deaktivieren.

## Daten exportieren

### So exportieren Sie Daten

1. Öffnen Sie eine Collection im Admin-Panel
2. Wenden Sie optional Filter an, um eine Teilmenge der Daten zu exportieren
3. Klicken Sie in der Symbolleiste auf die Schaltfläche **Export**
4. Wählen Sie das Format: **CSV** oder **JSON**
5. Die Datei wird sofort heruntergeladen

### Exportformate

| Format | Beschreibung |
|--------|--------------|
| CSV | Kommagetrennte Werte, kompatibel mit Excel und Google Sheets |
| JSON | Array von Objekten, nützlich für die programmatische Weiterverarbeitung |

### Filtern vor dem Export

Alle aktiven Filter in der Collection-Ansicht werden auf den Export angewendet. So können Sie gezielt eine Teilmenge Ihrer Daten exportieren:

- Wenden Sie Spaltenfilter oder Suchbegriffe in der Collection-Ansicht an
- Klicken Sie auf **Export** – es werden nur die gefilterten Zeilen einbezogen

### Export-Konfiguration

Der Export ist für jede Collection verfügbar. Er wird über `admin.exportable` konfiguriert: Übergeben Sie ein `ExportConfig`-Objekt, um berechnete Spalten hinzuzufügen (siehe unten). Der Typ akzeptiert auch einen booleschen Wert, dieser wird jedoch nicht ausgewertet – `exportable: false` entfernt die Schaltfläche **Export** nicht.

### Berechnete Felder hinzufügen

Verwenden Sie das `ExportConfig`-Objekt, um Ihren Exporten benutzerdefinierte, berechnete Spalten hinzuzufügen. Diese Spalten existieren nicht in der Datenbank – sie werden zum Zeitpunkt des Exports berechnet:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

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

Jeder Eintrag in `additionalFields` hat:

| Eigenschaft | Typ | Beschreibung |
|-------------|-----|--------------|
| `key` | `string` | Spaltenname im Export |
| `builder` | `({ entity, context }) => string \| Promise<string>` | Funktion, die den Wert berechnet |

Die `builder`-Funktion empfängt die aktuelle `entity` und den `RebaseContext` (welcher den authentifizierten Benutzer enthält), sodass Sie Werte sowohl basierend auf Daten als auch auf Berechtigungen berechnen können.

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
- **[Frontend-Übersicht](/docs/frontend)** — Admin-Panel und UI-Komponenten
- **[Client SDK](/docs/sdk)** — Programmatischer Datenzugriff
