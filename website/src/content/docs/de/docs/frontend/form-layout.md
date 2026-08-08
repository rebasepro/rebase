---
title: Formular-Layout
sidebar_label: Formular-Layout
description: Steuern Sie die Anordnung des Entitätsformulars — Spaltenbreiten, Abschnitte und die Metadaten-Leiste.
---

## Übersicht

Das Entitätsformular wird aus Ihren Eigenschaften generiert. Standardmäßig leitet es ein zweispaltiges Layout aus den Eigenschaftstypen ab, sodass eine Collection ohne explizite Layout-Angaben dennoch ein übersichtliches Formular erhält und nicht eine lange Abfolge von Eingabefeldern in voller Breite:

- Die ID und die `createdAt` / `updatedAt`-Zeitstempel wandern schreibgeschützt in eine Metadaten-Leiste
- Kurze Enums, Booleans, Datumsangaben und Zahlen belegen eine schmale Breite
- Langer Text, Markdown, Arrays, Maps und Speicherfelder belegen die volle Breite
- Alles andere belegt die Hälfte

Verwenden Sie `admin.form`, wenn das abgeleitete Layout nicht zu Ihren Anforderungen passt.

## Feldbreite

Die Breite eines Feldes ist ein **Span** (Spaltenbereich) über ein vierspaltiges Raster. `4` entspricht der vollen Breite der Hauptspalte.

```typescript
import { defineCollection } from "@rebasepro/admin-types";

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

Spans richten sich an einem gemeinsamen Raster aus. Dadurch werden zwei Felder unabhängig von ihrer Deklarationsreihenfolge korrekt aneinander ausgerichtet. Sie ersetzen `admin.widthPercentage`, dessen reine Prozentwerte sich nicht sauber ausrichten ließen. Wenn eine Collection dieses noch verwendet, sollte der nächstgelegene Span gewählt werden (≤30 → `1`, ≤55 → `2`, ≤80 → `3`, ansonsten `4`).

Bei Layouts, die zu schmal für zwei Spalten sind — das Seitenpanel, der Split-Pane-Bereich, ein Smartphone — kollabiert das Raster zu einer einzelnen Spalte und Spans werden ignoriert.

## Abschnitte

`sections` gruppiert die Hauptspalte unter Überschriften. Ein Abschnitt mit Titel kann einklappbar sein; ein unbenannter Abschnitt nicht.

```typescript
import { defineCollection } from "@rebasepro/admin-types";

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

Eine Eigenschaft, die von keinem Abschnitt benannt wird, geht niemals verloren: Sie landet im letzten unbenannten Abschnitt oder in einer unbenannten nachstehenden Gruppe, falls keiner vorhanden ist. Das Hinzufügen einer Spalte zur Datenbank führt daher nicht dazu, dass ein Feld stillschweigend aus dem Formular verschwindet.

Ein Validierungsfehler innerhalb eines eingeklappten Abschnitts klappt diesen automatisch aus, sodass sich ein Fehler niemals hinter einer geschlossenen Überschrift verbergen kann.

## Die Metadaten-Leiste

`sidebar` verschiebt Felder aus der Hauptspalte in eine schmale Leiste daneben — Status, Eigentümerschaft, Veröffentlichungsdaten, Flags.

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const postsCollection = defineCollection({
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        title: { name: "Title", type: "string" },
        body: { name: "Body", type: "string", admin: { markdown: true } },
        status: { name: "Status", type: "string" },
        published_at: { name: "Published at", type: "date" },
        author: { name: "Author", type: "string" }
    },
    admin: {
        form: {
            sidebar: ["status", "published_at", "author"],
            showRecordMeta: true
        }
    }
});
```

Die Leiste nutzt das Raster nicht, daher wird `span` für die darin enthaltenen Felder ignoriert. Wenn kein Platz für eine Leiste vorhanden ist, wird sie als gewöhnlicher vorangestellter Abschnitt gerendert, sodass auf einem Smartphone oder im Seitenpanel nichts verloren geht.

`showRecordMeta` platziert den schreibgeschützten Datensatz-Block — id, created, updated — am Ende der Leiste. Der Standardwert ist `true`, wann immer eine Leiste angezeigt wird. Dies ersetzt `hideIdFromForm` für die meisten Collections: Die ID ist kein Feld mehr in der Mitte des Formulars, sondern wird zu einer kopierbaren Metadatenzeile.

Setzen Sie `sidebar: []`, um die abgeleitete Leiste vollständig zu unterdrücken und jedes Feld in der Hauptspalte zu belassen.

## Referenz

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `admin.span` | `1 \| 2 \| 3 \| 4` | Feldbreite über das vierspaltige Formularraster |
| `admin.form.sidebar` | `string[]` | Eigenschaftsschlüssel, die in der Metadaten-Leiste angezeigt werden |
| `admin.form.sections` | `FormSection[]` | Benannte Gruppen für die Hauptspalte |
| `admin.form.showRecordMeta` | `boolean` | Zeigt id/created/updated am Ende der Leiste an |

`FormSection` ist `{ key, title?, properties, collapsed?, collapsible? }`.
