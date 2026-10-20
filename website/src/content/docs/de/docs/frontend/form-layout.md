---
sourceHash: fef2eb56c7043526
title: Formular-Layout
sidebar_label: Formular-Layout
description: Steuern Sie die Anordnung des Entitätsformulars – Spaltenbreiten, Abschnitte und die Metadaten-Leiste.
---

## Übersicht

<span class="since-badge" data-since="0.26">Seit 0.26</span>

Das Entitätsformular wird aus Ihren Eigenschaften generiert:

- Die ID und die Zeitstempel `createdAt` / `updatedAt` wandern schreibgeschützt in eine Metadaten-Leiste
- Jedes andere Feld nimmt die volle Breite der Hauptspalte ein, außer dass zwei
  benachbarte Felder mit demselben kleinen Editor – zwei Zahlen, zwei Schalter,
  zwei Daten desselben Modus, zwei Auswahllisten mit kurzen Optionen – sich eine Zeile teilen

Ein Feld mit einer langen Beschriftung, einem Hilfetext mit mehr als 60 Zeichen, `conditions` oder einem
benutzerdefinierten `Field` wird nie gepaart, ebenso wenig wie ein Freitext-String: Nichts in
einem Schema unterscheidet einen kurzen Branch-Namen von einer langen URL. Das Formular prüft nie,
welche Eigenschaft der Titel ist. Alle anderen Spalten werden von der Collection
Feld für Feld über `admin.span` angefordert – festgelegt anhand des Inhalts jedes Feldes, wie
unten beschrieben. Verwenden Sie `admin.form`, um
Felder in Abschnitte zu gruppieren und in die Leiste zu verschieben.

## Feldbreite

Die Breite eines Feldes ist ein **Span** über ein vier-spaltiges Raster. `4` entspricht der vollen Breite
der Hauptspalte.

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

Spans rasten in einem gemeinsamen Raster ein, wodurch zwei Felder unabhängig von
ihrer Deklarationsreihenfolge bündig ausgerichtet werden. Sie haben `admin.widthPercentage` ersetzt,
dessen bloße Prozentangaben an nichts ausgerichtet werden konnten; eine Collection, die
dies noch verwendet, sollte den nächstgelegenen Span wählen (≤30 → `1`, ≤55 → `2`, ≤80 → `3`,
ansonsten `4`).

Wählen Sie einen Span basierend auf dem Inhalt des Feldes, nicht auf dessen Typ. Zwei kurze Werte,
die zusammengehören, teilen sich eine Zeile – Start- und Enddatum, Stadt und Land,
Anbieter und Region mit jeweils `2`, oder ein Wert und sein Qualifier mit `3` + `1`.
Zahlen, boolesche Werte und kurze Codes können neben ihren Geschwisterfeldern `1` einnehmen. Alles,
was länger zu lesen ist – Namen, URLs, E-Mails, IDs, Beschreibungen, Markdown, Dateien –
behält `4`. Zeilen werden in der Reihenfolge der Deklaration gefüllt, und nichts verbreitert ein Feld, um eine
Lücke zu schließen. Deklarieren Sie Paare daher nebeneinander und achten Sie darauf, dass jede Zeile in der Summe 4 ergibt.

Bei Layouts, die zu schmal für zwei Spalten sind – dem Seitenpanel, dem Split-Pane oder einem Smartphone –,
klappt das Raster auf eine einzelne Spalte zusammen und Spans werden ignoriert.

## Abschnitte

`sections` gruppiert die Hauptspalte unter Überschriften. Ein Abschnitt mit Titel kann
eingeklappt werden; ein unbetitelter nicht.

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

Eine Eigenschaft, die in keinem Abschnitt genannt wird, geht niemals verloren: Sie landet im letzten unbetitelten
Abschnitt oder in einer unbetitelten Gruppe am Ende, falls keiner vorhanden ist. Das Hinzufügen einer Spalte zur
Datenbank kann daher nicht dazu führen, dass ein Feld stillschweigend aus dem Formular verschwindet.

Ein Validierungsfehler innerhalb eines eingeklappten Abschnitts klappt diesen aus, sodass sich ein Fehler niemals
hinter einer geschlossenen Überschrift verbergen kann.

## Die Metadaten-Leiste

`sidebar` verschiebt Felder aus der Hauptspalte in eine schmale Leiste daneben –
Status, Zuständigkeit, Veröffentlichungsdaten, Flags.

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

Die Leiste verwendet das Raster nicht, daher wird `span` für die darin enthaltenen Felder ignoriert. Wo
kein Platz für eine Leiste ist, wird sie als normaler vorangestellter Abschnitt gerendert, sodass
auf einem Smartphone oder im Seitenpanel nichts verloren geht.

`showRecordMeta` platziert den schreibgeschützten Datensatz-Block – ID, erstellt, aktualisiert – am
Ende der Leiste. Der Standardwert ist `true`, wann immer eine Leiste angezeigt wird, und ersetzt
`hideIdFromForm` für die meisten Collections: Die ID ist nicht länger ein Feld in
der Mitte des Formulars, sondern wird zu einer kopierbaren Metadatenzeile.

Setzen Sie `sidebar: []`, um die abgeleitete Leiste vollständig zu unterdrücken und jedes Feld in
der Hauptspalte zu belassen.

## Referenz

<span class="since-badge" data-since="0.26">Seit 0.26</span>

| Eigenschaft | Typ | Beschreibung |
|-------------|-----|--------------|
| `admin.span` | `1 \| 2 \| 3 \| 4` | Feldbreite im vierspaltigen Formularraster |
| `admin.form.sidebar` | `string[]` | Eigenschaftsschlüssel, die in der Metadaten-Leiste angezeigt werden |
| `admin.form.sections` | `FormSection[]` | Betitelte Gruppen für die Hauptspalte |
| `admin.form.showRecordMeta` | `boolean` | ID/Erstellt/Aktualisiert am Ende der Leiste anzeigen |

`FormSection` ist `{ key, title?, properties, collapsed?, collapsible? }`.

## Verwandte Themen

- [Custom Fields](/docs/frontend/custom-fields/) — die Felder, die ein Layout anordnet
- [Entity Views](/docs/frontend/entity-views/) — ein eigener Tab neben dem Formular
- [Properties](/docs/collections/properties/) — die Eigenschaften-Optionen, die ein Layout liest
