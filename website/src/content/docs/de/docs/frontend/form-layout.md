---
sourceHash: 3830846c0457a79f
title: Formular-Layout
sidebar_label: Formular-Layout
description: Steuern Sie die Anordnung des Entitätsformulars – Spaltenbreiten (Spans), Abschnitte und die Metadaten-Leiste.
---

## Übersicht

Das Entitätsformular wird aus Ihren Eigenschaften generiert. Standardmäßig leitet es ein zweispaltiges Layout aus den Eigenschaftstypen ab. Eine Collection ohne explizite Layout-Angaben erhält so dennoch ein Formular, das sich wie ein echtes Formular anfühlt, anstatt wie eine lange Abfolge von Eingabefeldern in voller Breite:

- die ID und die `createdAt`- / `updatedAt`-Zeitstempel werden schreibgeschützt in eine Metadaten-Leiste ausgelagert
- kurze Enums, Booleans, Datumsangaben und Zahlen belegen einen schmalen Bereich
- langer Text, Markdown, Arrays, Maps und Speicherfelder (Storage Fields) belegen die volle Breite
- alles andere belegt die halbe Breite

Verwenden Sie `admin.form`, wenn das abgeleitete Ergebnis nicht zu Ihrem Anwendungsfall passt.

## Feldbreite

Die Breite eines Feldes ist ein **Span** (eine Spaltenbreite) über ein vier-spaltiges Raster. `4` entspricht der vollen Breite der Hauptspalte.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: {
        sku: {
            name: "SKU",
            type: "string",
            admin: { span: 1 }
        },
        name: {
            name: "Product name",
            type: "string",
            admin: { span: 3 }
        },
        description: {
            name: "Description",
            type: "string",
            admin: { markdown: true, span: 4 }
        }
    }
});
```

Spans docken an ein gemeinsames Raster an, wodurch zwei Felder unabhängig von ihrer Deklarationsreihenfolge bündig ausgerichtet werden. Sie ersetzen `admin.widthPercentage`, dessen reine Prozentwerte sich nicht sauber ausrichten ließen. Collections, die dies noch nutzen, sollten den nächstliegenden Span wählen (≤30 → `1`, ≤55 → `2`, ≤80 → `3`, sonst `4`).

Bei Layouts, die zu schmal für zwei Spalten sind – etwa im Seitenpanel, der geteilten Ansicht (Split Pane) oder auf Smartphones –, fällt das Raster auf eine einzelne Spalte zusammen und Spans werden ignoriert.

## Abschnitte

`sections` gruppiert die Hauptspalte unter Überschriften. Ein Abschnitt mit Titel kann eingeklappt werden; ein unbetitelter Abschnitt nicht.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const ordersCollection = defineCollection({
    slug: "orders",
    table: "orders",
    name: "Orders",
    properties: {
        reference: { name: "Reference", type: "string" },
        placed_at: { name: "Placed at", type: "date" },
        address: { name: "Address", type: "string" },
        carrier: { name: "Carrier", type: "string" },
        tracking_number: { name: "Tracking number", type: "string" },
        notes: { name: "Notes", type: "string" }
    },
    admin: {
        form: {
            sections: [
                { key: "identity", properties: ["reference", "placed_at"] },
                {
                    key: "shipping",
                    title: "Shipping",
                    properties: ["address", "carrier", "tracking_number"]
                },
                {
                    key: "internal",
                    title: "Internal notes",
                    properties: ["notes"],
                    collapsed: true
                }
            ]
        }
    }
});
```

Eine Eigenschaft, die in keinem Abschnitt genannt wird, geht niemals verloren: Sie landet im letzten unbetitelten Abschnitt oder in einer unbetitelten Gruppe am Ende, falls keiner vorhanden ist. Das Hinzufügen einer Spalte zur Datenbank kann daher nicht dazu führen, dass ein Feld unbemerkt aus dem Formular verschwindet.

Ein Validierungsfehler innerhalb eines eingeklappten Abschnitts klappt diesen automatisch auf, sodass sich ein Fehler niemals hinter einer geschlossenen Überschrift verbergen kann.

## Die Metadaten-Leiste

`sidebar` verschiebt Felder aus der Hauptspalte in eine schmale Leiste daneben – Status, Zuständigkeit, Veröffentlichungsdaten, Flags.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const postsCollection = defineCollection({
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        title: { name: "Title", type: "string" },
        body: { name: "Body", type: "string", admin: { markdown: true } },
        status: { name: "Status", type: "string" },
        publishedAt: { name: "Published at", type: "date" },
        author: { name: "Author", type: "string" }
    },
    admin: {
        form: {
            sidebar: ["status", "publishedAt", "author"],
            showRecordMeta: true
        }
    }
});
```

Die Leiste verwendet das Raster nicht, daher wird `span` für Felder darin ignoriert. Wenn kein Platz für eine Leiste vorhanden ist, wird sie als regulärer vorangestellter Abschnitt gerendert, sodass auf einem Smartphone oder im Seitenpanel nichts verloren geht.

`showRecordMeta` platziert den schreibgeschützten Datensatz-Block – ID, Erstellungs- und Aktualisierungsdatum – am Ende der Leiste. Der Standardwert ist `true`, sobald eine Leiste angezeigt wird, und ersetzt `hideIdFromForm` für die meisten Collections: Die ID ist damit kein Feld mehr mitten im Formular, sondern eine kopierbare Metadatenzeile.

Setzen Sie `sidebar: []`, um die abgeleitete Leiste vollständig zu unterdrücken und alle Felder in der Hauptspalte zu belassen.

## Referenz

| Eigenschaft | Typ | Beschreibung |
|---|---|---|
| `admin.span` | `1 \| 2 \| 3 \| 4` | Feldbreite im vierspaltigen Formularraster |
| `admin.form.sidebar` | `string[]` | In der Metadaten-Leiste angezeigte Eigenschaftsschlüssel |
| `admin.form.sections` | `FormSection[]` | Betitelte Gruppen für die Hauptspalte |
| `admin.form.showRecordMeta` | `boolean` | ID/Erstellt/Aktualisiert am Ende der Leiste anzeigen |

`FormSection` ist `{ key, title?, properties, collapsed?, collapsible? }`.

## Verwandte Themen

- [Custom Fields](/docs/frontend/custom-fields/) — das Feld, das durch ein Layout angeordnet wird
- [Entity Views](/docs/frontend/entity-views/) — ein eigener Tab neben dem Formular
- [Properties](/docs/collections/properties/) — die Eigenschaftsoptionen, die ein Layout ausliest
