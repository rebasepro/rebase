---
sourceHash: 3c4991a6d78c115c
title: Datenimport & -export
sidebar_label: Datenimport & -export
description: Importieren Sie Daten aus CSV-, JSON- und Excel-Dateien in Ihre Collections und exportieren Sie Collection-Daten als CSV oder JSON mit optionalen berechneten Feldern.
---

## Übersicht

Rebase enthält integrierte Werkzeuge für den Datenimport und -export, die direkt über das Admin-Panel zugänglich sind. Der Import unterstützt CSV-, JSON- und Excel-Dateien mit einem Assistenten für das Spalten-Mapping. Der Export unterstützt CSV und JSON mit optionalen berechneten Feldern.

Beide sind für jede Collection verfügbar. Der Export kann pro Collection mit berechneten Feldern konfiguriert oder mit `exportable: false` deaktiviert werden; der Import kann nicht pro Collection deaktiviert werden.

## Daten importieren

### So funktioniert der Import

1. Öffnen Sie eine Collection im Admin-Panel
2. Klicken Sie in der Symbolleiste auf die Schaltfläche **Import**
3. Wählen Sie Ihre Datei aus oder ziehen Sie sie per Drag-and-Drop hinein
4. Weisen Sie die Dateispalten den Collection-Eigenschaften zu
5. Prüfen Sie die Vorschau der Daten, einschließlich aller Werte, die nicht konvertiert werden können
6. Klicken Sie auf **Save data**, um die Zeilen zu schreiben

### Unterstützte Formate

| Format | Dateiendungen | Hinweise |
|--------|---------------|----------|
| CSV | `.csv` | Erkennt Trennzeichen automatisch |
| JSON | `.json` | Erwartet ein Array von Objekten |
| Excel | `.xlsx` | Liest das erste Tabellenblatt |

### Spalten-Mapping

Der Import-Assistent versucht automatisch, Dateispalten anhand des Namens mit Collection-Eigenschaften abzugleichen. Sie können die Zuordnungen vor dem Import manuell anpassen:

- **Exakte Übereinstimmungen** werden automatisch zugeordnet (z. B. `name` → `name`)
- **Nicht zugeordnete Spalten** können manuell zugeordnet oder übersprungen werden
- **Typkonvertierung** wandelt jede Zelle in den Typ der Eigenschaft um, der sie zugeordnet ist, jedoch nur, wenn dabei nichts verloren geht (siehe unten)

### Typkonvertierung

Eine Zelle wird nur konvertiert, wenn der Typ der Eigenschaft genau das aufnehmen kann, was in ihr steht:

| Eigenschaftstyp | Wird konvertiert | Wird nicht konvertiert |
|---|---|---|
| Number | `12`, `-3.5`, `10.00`, `1e3` | `02134` (eine führende Null würde verloren gehen), Zahlen mit mehr als 15 signifikanten Stellen, `1,234`, `$5.00`, `12%`, `N/A` |
| Boolean | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, unabhängig von Groß-/Kleinschreibung | alles andere |
| Date | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), ausgeschriebene Datumsangaben (`5 Jan 2024`), `05/01/2024`, Epoch-Sekunden oder -Millisekunden | Text, der kein Datum benennt |
| Geopoint | das Objekt, das der Export schreibt, `{"latitude": 41.9, "longitude": 12.5}`, oder dessen JSON in einer CSV-Zelle | alles andere oder eine Koordinate außerhalb des gültigen Bereichs |
| Map ohne deklarierte Felder | ein Objekt oder dessen JSON in einer CSV-Zelle | alles andere |
| Vector | eine Liste von Zahlen (`[0.1, 0.2]`, `0.1, 0.2`) oder das `{"value": [0.1, 0.2]}` des Exports | eine Liste, die etwas enthält, das keine Zahl ist |

Ein Datum ohne Uhrzeit entspricht diesem Tag in UTC. Bei Datumsangaben im Format `05/01/2024` bestimmt die Spalte die Reihenfolge: Eine erste Zahl über 12 legt fest, dass der Tag an erster Stelle steht; eine zweite Zahl über 12 legt fest, dass der Monat an erster Stelle steht. Wenn eine Spalte dies nicht eindeutig vorgibt, entscheidet das Gebietsschema (Locale) des Browsers, und wenn sie beide Reihenfolgen enthält, wird ein Datum, das nach beiden Reihenfolgen gelesen werden könnte, nicht konvertiert.

Eine leere Zelle ist kein Wert: Sie setzt nichts, und der Standardwert, den Sie für diese Eigenschaft gewählt haben, wird angewendet.

Eine aus einer Collection exportierte Datei wird wieder in dieselben Werte importiert, sei es CSV oder JSON. Eine Map mit deklarierten Feldern wird mit einer Spalte pro Feld (`address.street`) eingelesen, so wie der Export sie schreibt; jeder andere Wert, einschließlich eines Geopoints oder einer Key-Value-Map, belegt eine Spalte. Eine Epoch-Zahl zwischen -100.000.000.000 und 100.000.000.000 wird als Sekunden interpretiert, sodass ein Datum zwischen dem 31. Oktober 1966 und dem 3. März 1973, das als Zeitstempel exportiert wurde, nicht wiederhergestellt werden kann: Exportieren Sie solche Daten als Text. Ein Uhrzeit-Feld liest eine Zahl von weniger als einem Tag (86.400.000) als die Millisekunden seit Mitternacht, die der Export schreibt.

### Werte, die nicht importiert werden können

Die Vorschau listet pro Spalte jede Zelle auf, die nicht konvertiert werden kann, zusammen mit der Gesamtanzahl sowie den ersten Zeilen samt Grund. Diese Zellen bleiben in den importierten Zeilen leer; nichts wird in `0`, `false` oder einen leeren Wert umgewandelt, ohne aufgeführt zu werden. Gehen Sie zurück, um die Spalte einer anderen Eigenschaft zuzuweisen, oder korrigieren Sie die Datei und laden Sie sie erneut hoch.

Die collections-eigenen Regeln – Pflichtfelder, Enum-Optionen, eindeutige Werte – werden vom Server beim Schreiben der Zeilen in Batches von bis zu 500 Zeilen geprüft (weniger, wenn die Zeilen breit sind, damit eine Anfrage unter etwa 1 MB bleibt). Ein Batch wird entweder vollständig oder gar nicht gespeichert. Wird eine Zeile abgelehnt, stoppt der Import und benennt sie; die vorherigen Batches sind bereits gespeichert, und **Retry** setzt ab der ersten Zeile des Batches der abgelehnten Zeile fort.

Eine Zeile, deren ID bereits in der Collection vorhanden ist, aktualisiert diesen Datensatz: Die in der Datei enthaltenen Spalten werden geschrieben, und die übrigen behalten ihre gespeicherten Werte. So aktualisiert eine Datei mit `id,price` die Preise bestehender Produkte, ohne deren Pflichtfelder wiederholen zu müssen. Eine neue Zeile benötigt weiterhin jedes Pflichtfeld. Ein Batch, der Aktualisierungen und neue Zeilen mischt, wird in zwei Anfragen geschrieben, sodass eine abgelehnte neue Zeile die Aktualisierungen dieses Batches gespeichert lassen kann; **Retry** schreibt sie erneut mit denselben Werten.

### Benutzer importieren

Eine neue Zeile in der Users-Collection entspricht einer Benutzererstellung: Eine `password`-Spalte wird gehasht und niemals im Klartext gespeichert. Eine Zeile ohne Passwort erhält ein generiertes Passwort oder eine Einladung, so wie wenn ein Administrator einen Benutzer hinzufügt. Die Passwörter in einer solchen Datei wurden üblicherweise nach den Regeln eines anderen Systems festgelegt, daher fordert der Import den Server auf, die [Passwortrichtlinie](/docs/backend/auth-endpoints/#password-policy) für diese Zeilen zu überspringen. Der Server stimmt dem nur zu, wenn Sie Administrator sind; alle anderen, die Benutzer importieren, sind an die Richtlinie gebunden, und ein schwaches Passwort stoppt den Import mit `WEAK_PASSWORD`.

### Eine Collection aus einer Datei erstellen

Wenn Sie eine Collection aus einer Datei erstellen, wird der Typ jeder Spalte aus ihren Werten abgeleitet. Eine Spalte wird nur dann als Zahl typisiert, wenn jeder Wert darin eine Zahl oder Text ist, der sich exakt in eine Zahl umwandeln lässt. Daher bleibt eine Spalte mit Postleitzahlen, Produktcodes mit führenden Nullen, langen SKUs oder Telefonnummern Text. Eine Spalte mit gemischten Typen (Zahlen und Wörter, Booleans und Zahlen) bleibt Text. Leere Zellen zählen nicht, sodass eine größtenteils leere Spalte nicht als erforderlich markiert wird. Eine Spalte mit ganzen Zahlen, deren Name auf ein Wort endet, das auf einen Zeitpunkt hinweist (`created_at`, `updatedAt`, `signup_date`, `timestamp`), wird zu einem Datum, wenn jeder Wert ein Epoch-Zeitstempel zwischen 2001 und 2103 in Sekunden oder Millisekunden ist; unter jedem anderen Namen oder mit einem anderen Wert bleibt sie eine Zahl.

### Import-Konfiguration

Der Import ist für jede Collection verfügbar. Es gibt keine Einstellung auf Collection-Ebene, um ihn zu deaktivieren.

## Daten exportieren

### So funktioniert der Export

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

Alle aktiven Filter in der Collection-Ansicht werden auf den Export angewendet. Dadurch können Sie gezielt eine Teilmenge Ihrer Daten exportieren:

- Wenden Sie Spaltenfilter oder Suchbegriffe in der Collection-Ansicht an
- Klicken Sie auf **Export** – nur die gefilterten Zeilen werden exportiert

### Export-Konfiguration

Der Export ist für jede Collection verfügbar, es sei denn, Sie deaktivieren ihn. `admin.exportable` konfiguriert dies: `exportable: false` entfernt die Schaltfläche **Export**, und eine `ExportConfig` behält sie bei und fügt berechnete Spalten hinzu (siehe unten).

### Berechnete Felder hinzufügen

Verwenden Sie das `ExportConfig`-Objekt, um benutzerdefinierte, berechnete Spalten zu Ihren Exporten hinzuzufügen. Diese Spalten existieren nicht in der Datenbank – sie werden zum Zeitpunkt des Exports berechnet:

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
                    builder: ({ row }) => {
                        const price = Number(row.price ?? 0);
                        const cost = Number(row.cost ?? 0);
                        return String(price - cost);
                    }
                },
                {
                    key: "full_url",
                    builder: ({ row }) => {
                        return `https://mystore.com/products/${String(row.id)}`;
                    }
                }
            ]
        }
    }
});

```

Jeder Eintrag in `additionalFields` umfasst:

| Eigenschaft | Typ | Beschreibung |
|-------------|-----|--------------|
| `key` | `string` | Spaltenname im Export |
| `builder` | `({ row, context }) => string \| Promise<string>` | Funktion, die den Wert berechnet |

Die `builder`-Funktion empfängt jeden exportierten Datensatz als `row` in der vom Server gesendeten Struktur (Datumsangaben als ISO-Strings, ein belongsTo als Fremdschlüsselspalte, einschließlich `id`) sowie den `RebaseContext` (der den authentifizierten Benutzer enthält), sodass Sie Werte basierend auf Daten und Berechtigungen berechnen können.

### Asynchrone berechnete Felder

Die `builder`-Funktion kann asynchron (`async`) sein, was nützlich ist, wenn der berechnete Wert eine Datenbankabfrage oder einen API-Aufruf erfordert:

```typescript
exportable: {
    additionalFields: [
        {
            key: "author_name",
            builder: async ({ row, context }) => {
                const author = await context.data.users.findById(String(row.authorId));
                // `context.data` returns the row itself: its columns are on it.
                return String(author?.displayName ?? "Unknown");
            }
        }
    ]
}
```

## Nächste Schritte

- **[Collections](/docs/collections)** — Definieren Sie Ihr Datenmodell
- **[Frontend-Übersicht](/docs/frontend)** — Admin-Panel und UI-Komponenten
- **[Typisiertes SDK](/docs/sdk)** — Programmatischer Datenzugriff
