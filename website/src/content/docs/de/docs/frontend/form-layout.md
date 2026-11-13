---
sourceHash: 93694433369991ae
title: Formular-Layout
sidebar_label: Formular-Layout
description: "Gestalten Sie das Formular eines Datensatzes: Feldbreiten in einem vierspaltigen Raster, betitelte und einklappbare Abschnitte, die Metadaten-Leiste und eine Komponente, die das generierte Formular ersetzt."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

Das Datensatzformular wird aus den Spalten und Relationen der Tabelle generiert:

- Die ID sowie die Erstellungs- und Aktualisierungszeitstempel werden in einer schreibgeschützten Metadaten-Leiste platziert;
- jedes andere Feld nimmt die volle Breite der Hauptspalte ein, mit der Ausnahme, dass sich zwei
  benachbarte Felder mit demselben kleinen Editor (zwei Zahlen, zwei Schalter,
  zwei Datumsangaben desselben Modus, zwei Auswahllisten mit kurzen Optionen) eine Zeile teilen.

Ein Feld mit einer langen Beschriftung, einem Hilfetext mit mehr als 60 Zeichen, `conditions`, einer
[Zugriffsregel](/docs/collections/field-access/) auf Spaltenebene oder einem benutzerdefinierten `Field`
wird niemals gepaart, ebenso wenig wie Freitextfelder: Anhand eines Schemas lässt sich kein kurzer
Branch-Name von einer langen URL unterscheiden. Alles Weitere wird in `customizeTable` festgelegt –
Feld für Feld mit `span` und für das gesamte Formular mit `form`.

```ts
// backend/schema/orders.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id:             col.uuid().primaryKey().defaultRandom(),
        reference:      col.text().notNull(),
        sku:            col.text(),
        status:         col.enum(["placed", "shipped", "delivered"]).notNull().default("placed"),
        placedAt:       col.timestamp({ withTimezone: true }),
        address:        col.text(),
        carrier:        col.text(),
        trackingNumber: col.text(),
        notes:          col.text(),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/orders.tsx
import { customizeTable } from "@rebasepro/cms";
import type { orders } from "../../../backend/schema/orders";

export const ordersCms = customizeTable<typeof orders>("orders", {
    form: {
        sidebar: ["status", "placedAt"],
        sections: [
            { key: "identity", fields: ["reference", "sku"] },
            { key: "shipping", title: "Shipping", fields: ["address", "carrier", "trackingNumber"] },
            { key: "internal", title: "Internal notes", fields: ["notes"], collapsed: true },
        ],
    },
    fields: {
        reference: { span: 3 },
        sku:       { name: "SKU", span: 1 },
        carrier:   { span: 2 },
        trackingNumber: { span: 2 },
        notes:     { multiline: true },
    },
});
```

## Feldbreite

<span class="since-badge" data-since="0.31">Since 0.31</span>

Die Breite eines Feldes ist eine Spannenangabe (**span**) über ein vierspaltiges Raster; `4` entspricht der vollen Breite
der Hauptspalte. Spans rasten im Raster ein, wodurch zwei Felder unabhängig von ihrer
Deklarationsreihenfolge bündig ausgerichtet werden.

Wählen Sie eine Spanne basierend auf dem Inhalt des Feldes, nicht basierend auf seinem Typ. Zwei kurze Werte,
die zusammengehören, teilen sich eine Zeile: Start- und Enddatum, Ort und Land, Versanddienstleister
und Sendungsnummer mit jeweils `2`, oder ein Wert und dessen Qualifizierer mit `3` + `1`.
Zahlen, Booleans und kurze Codes können neben ihren Nachbarn den Wert `1` einnehmen. Alles,
was länger zu lesen ist (Namen, URLs, E-Mails, IDs, Beschreibungen, Markdown, Dateien), behält
`4`. Zeilen werden in Feldreihenfolge gefüllt und kein Feld wird verbreitert, um eine Lücke zu schließen;
platzieren Sie Paare daher nebeneinander und achten Sie darauf, dass jede Zeile in der Summe 4 ergibt.

Bei Layouts, die zu schmal für zwei Spalten sind (das Seitenpanel, der Split-Pane, ein Smartphone),
bricht das Raster auf eine einzelne Spalte um und Spans werden ignoriert.

## Abschnitte

<span class="since-badge" data-since="0.31">Since 0.31</span>

`form.sections` gruppiert die Hauptspalte unter Überschriften. Jeder Abschnitt ist
`{ key, title?, fields, collapsed?, collapsible?, readVariant? }`. Ein betitelter
Abschnitt kann eingeklappt werden; ein unbetitelter nicht. `readVariant: "summary"`
stapelt die Felder des Abschnitts als Beschriftungs- und Wertezeilen in der schreibgeschützten
Ansicht des Datensatzes; der Standardwert `"grid"` verwendet das Raster des Formulars.

Ein Feld, das in keinem Abschnitt benannt wird, geht niemals verloren: Es landet im letzten unbetitelten
Abschnitt oder in einer unbetitelten abschließenden Gruppe, falls keiner vorhanden ist. Eine zur Tabelle
hinzugefügte Spalte kann nicht dazu führen, dass ein Feld stillschweigend aus dem Formular verschwindet. Ein Validierungsfehler
innerhalb eines eingeklappten Abschnitts klappt diesen automatisch auf.

Jeder Eintrag wird anhand der Tabelle geprüft. Ein Eintrag, den der Server für diesen
Aufrufer nicht bereitstellt, weil dieser die Spalte nicht lesen darf, wird übersprungen.

## Die Metadaten-Leiste

<span class="since-badge" data-since="0.31">Since 0.31</span>

`form.sidebar` verschiebt Felder aus der Hauptspalte in eine schmale Leiste daneben:
Status, Zuständigkeit, Veröffentlichungsdaten, Flags. Die Leiste verwendet kein Raster, daher
wird `span` dort ignoriert. Wenn kein Platz für eine Leiste vorhanden ist, wird sie als
gewöhnlicher vorangestellter Abschnitt dargestellt.

`form.showRecordMeta` platziert den schreibgeschützten Datensatz-Block (ID, erstellt, aktualisiert) am
Ende der Leiste. Dies ist immer `true`, wenn eine Leiste angezeigt wird. `sidebar: []` deaktiviert
die abgeleitete Leiste und behält jedes Feld in der Hauptspalte. `hideIdFromForm`
blendet die ID vollständig aus dem Formular aus.

## Ersetzen des Formulars

<span class="since-badge" data-since="0.31">Since 0.31</span>

`formView` tauscht das generierte Formular gegen eine eigene, als Wert importierte
Komponente aus. Sie empfängt dieselben `EntityCustomViewParams` wie eine
[Entity View](/docs/frontend/entity-views/). `includeActions: true` behält
Speichern und Verwerfen in der Leiste des Datensatzes bei, während dieser auf dem Bildschirm angezeigt wird.

```tsx
import React from "react";
import { customizeTable } from "@rebasepro/cms";
import type { EntityCustomViewParams } from "@rebasepro/cms-types";
import type { orders } from "../../../backend/schema/orders";

function OrderForm({ row, modifiedValues }: EntityCustomViewParams) {
    return <h2>{String(modifiedValues?.reference ?? row?.reference ?? "New order")}</h2>;
}

export const ordersCms = customizeTable<typeof orders>("orders", {
    formView: { Builder: OrderForm, includeActions: true },
});
```

Für kleinere Änderungen können Sie stattdessen nur einen Teil des Formulars überschreiben (`Entity.Form`, siehe
[Component Overrides](/docs/frontend/component-overrides/)) oder einige
Felder mit `<RecordForm>` und `<FormField>` auf einer eigenen Seite selbst anordnen
(siehe [Panels](/docs/frontend/panels/)).

## Weitere Formularoptionen

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Option | Wirkung |
|---|---|
| `formAutoSave` | Speichern während der Eingabe. |
| `alwaysApplyDefaultValues` | Deklarierte Standardwerte beim Öffnen in leere Felder eines gespeicherten Datensatzes einfügen. |
| `includeJsonView` | Einen Tab hinzufügen, der den Datensatz als JSON anzeigt. |
| `localChangesBackup` | Nicht gespeicherte Änderungen im lokalen Speicher behalten: `"manual_apply"`, `"auto_apply"` oder `false`. |

## Verwandte Themen

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [Benutzerdefinierte Felder](/docs/frontend/custom-fields/): die Felder, die ein Layout anordnet
- [Entity Views](/docs/frontend/entity-views/): ein kompletter eigener Tab neben dem Formular
- [customizeTable](/docs/frontend/customize-table/#form): die Formularoptionen in der Referenz
