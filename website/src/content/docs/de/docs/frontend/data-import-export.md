---
sourceHash: d8dc261c256b2bc3
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
5. Zeigen Sie die Daten in der Vorschau an, einschließlich aller Werte, die nicht umgewandelt werden können
6. Klicken Sie auf **Save data**, um die Zeilen zu schreiben

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
- **Typumwandlung** wandelt jede Zelle in den Typ der Eigenschaft um, der sie zugeordnet ist, aber nur, wenn dabei nichts verloren geht (siehe unten)

### Typumwandlung

Eine Zelle wird nur umgewandelt, wenn der Typ der Eigenschaft exakt das aufnehmen kann, was sie angibt:

| Eigenschaftstyp | Wird umgewandelt | Wird nicht umgewandelt |
|---|---|---|
| Number | `12`, `-3.5`, `10.00`, `1e3` | `02134` (eine führende Null würde verloren gehen), Zahlen mit mehr als 15 signifikanten Stellen, `1,234`, `$5.00`, `12%`, `N/A` |
| Boolean | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, in beliebiger Schreibweise | alles andere |
| Date | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), ausgeschriebene Daten (`5 Jan 2024`), `05/01/2024`, Epoch-Sekunden oder -Millisekunden | Text, der kein Datum benennt |
| Geopoint | das Objekt, das der Export schreibt, `{"latitude": 41.9, "longitude": 12.5}`, oder sein JSON in einer CSV-Zelle | alles andere, oder eine Koordinate außerhalb des Wertebereichs |
| Map ohne deklarierte Felder | ein Objekt, oder sein JSON in einer CSV-Zelle | alles andere |
| Vector | eine Liste von Zahlen (`[0.1, 0.2]`, `0.1, 0.2`), oder das `{"value": [0.1, 0.2]}` des Exports | eine Liste, die etwas enthält, das keine Zahl ist |

Ein Datum ohne Uhrzeit ist dieser Tag in UTC. Bei Daten in der Form `05/01/2024` entscheidet die
Spalte über die Reihenfolge: Eine erste Zahl über 12 macht die Spalte tagzuerst, eine zweite Zahl
über 12 macht sie monatzuerst. Wenn eine Spalte dies nie verrät, entscheidet die Locale des
Browsers, und wenn sie beide Reihenfolgen enthält, wird ein Datum, das beide Lesarten zulässt,
nicht umgewandelt.

Eine leere Zelle ist kein Wert: Sie setzt nichts, und der Default, den Sie für diese Eigenschaft
gewählt haben, greift.

Eine aus einer Collection exportierte Datei wird mit denselben Werten wieder importiert, ob CSV oder JSON.
Eine Map mit deklarierten Feldern wird mit einer Spalte pro Feld gelesen (`address.street`), so wie der
Export sie schreibt; jeder andere Wert, auch ein Geopoint oder eine Key-Value-Map, ist eine Spalte. Eine
Epoch-Zahl zwischen -100,000,000,000 und 100,000,000,000 wird als Sekunden gelesen, daher kommt ein Datum
zwischen dem 31. Oktober 1966 und dem 3. März 1973, das als Timestamp exportiert wurde, nicht unverändert
zurück: Exportieren Sie solche Daten als Text. Ein Uhrzeit-Feld liest eine Zahl unter einem Tag
(86,400,000) als die Millisekunden seit Mitternacht, die der Export schreibt.

### Werte, die nicht importiert werden können

Die Vorschau listet jede Zelle auf, die nicht umgewandelt wird, pro Spalte, mit der Anzahl und den
ersten paar nach Zeile und Grund. Diese Zellen bleiben in den importierten Zeilen leer; nichts wird
zu `0`, `false` oder einem leeren Wert, ohne aufgelistet zu werden. Gehen Sie zurück, um die Spalte
einer anderen Eigenschaft zuzuordnen, oder korrigieren Sie die Datei und laden Sie sie erneut hoch.

Die eigenen Regeln der Collection — Pflichtfelder, Enum-Optionen, eindeutige Werte — werden vom
Server beim Schreiben der Zeilen geprüft, 25 Zeilen auf einmal. Wird eine Zeile abgelehnt, stoppt
der Import und benennt sie; die Zeilen davor sind bereits gespeichert, und **Retry** setzt ab der
abgelehnten Zeile fort.

### Eine Collection aus einer Datei erstellen

Wenn Sie eine Collection aus einer Datei erstellen, wird der Typ jeder Spalte aus ihren Werten
abgeleitet. Eine Spalte ist nur dann eine Zahl, wenn jeder Wert darin eine Zahl oder Text ist, der
sich exakt in eine umwandeln lässt; eine Spalte mit Postleitzahlen, Produktcodes mit führenden
Nullen, langen SKUs oder Telefonnummern bleibt daher Text. Eine Spalte, die Typen mischt (Zahlen
und Wörter, Booleans und Zahlen), ist Text. Leere Zellen zählen nicht, sodass eine größtenteils
leere Spalte nicht als erforderlich markiert wird.

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
- **[Typisiertes SDK](/docs/sdk)** — Programmatischer Datenzugriff
