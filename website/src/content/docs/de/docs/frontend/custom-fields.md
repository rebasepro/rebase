---
sourceHash: d337d344b88534c8
title: Benutzerdefinierte Felder
sidebar_label: Benutzerdefinierte Felder
description: Erstellen Sie benutzerdefinierte Formularfelder für die Entitätsbearbeitung mit vollem Zugriff auf den Formularkontext, Entitätswerte und Rebase-Hooks.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Übersicht

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Das CMS rendert für jede Spalte basierend auf ihrem Typ ein Feld (siehe
[Felder](/docs/collections/properties/)). Wenn dies nicht Ihren Anforderungen
entspricht, können Sie dem Feld in `customizeTable` eine eigene Komponente
zuweisen: `Field` ersetzt das Steuerelement im Formular, `Preview` ersetzt die
Darstellung des Werts an allen anderen Stellen (einer Tabellenzelle, einer Karte,
einem Referenz-Chip) und `Filter` ersetzt dessen Filter-Steuerelement.

Eine Komponente ist ein Wert. `customizeTable` wird ausschließlich im
Browser-Bundle ausgeführt, sodass Sie die Komponente wie an jeder anderen Stelle
in Ihrem Frontend importieren und direkt übergeben. Ein Pfad als Zeichenkette
(String) oder ein Lazy-Thunk `() => import(…)` wirft einen Fehler mit Hinweisen
dazu, was stattdessen zu schreiben ist.

## Erstellen eines benutzerdefinierten Felds

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein benutzerdefiniertes Feld ist eine React-Komponente, die `FieldProps` empfängt:

```tsx
// frontend/src/fields/ColorPickerField.tsx
import React from "react";
import type { FieldProps } from "@rebasepro/cms";
import type { StringProperty } from "@rebasepro/cms-types";

export function ColorPickerField({ value, setValue, error, showError, minimalistView }: FieldProps<StringProperty>) {
    return (
        <div>
            <input
                type="color"
                value={value ?? "#000000"}
                onChange={(e) => setValue(e.target.value)}
            />
            {!minimalistView && <span>{value}</span>}
            {showError && error && <span className="text-red-500">{error}</span>}
        </div>
    );
}
```

### FieldProps

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Prop | Typ | Beschreibung |
|------|------|-------------|
| `value` | `T` | Aktueller Feldwert |
| `setValue` | `(value: T) => void` | Feldwert aktualisieren |
| `error` | `string` | Validierungsfehlermeldung |
| `showError` | `boolean` | Ob der Fehler angezeigt werden soll |
| `isSubmitting` | `boolean` | Formular wird gerade gespeichert |
| `property` | `Property` | Das Feld, wie es vom CMS aufgelöst wurde: Label, Validierung, Optionen |
| `context` | `FormContext` | Das Formular: seine `values` (einschließlich ungespeicherter Änderungen), `setFieldValue`, `id` und `row`, der gespeicherte Datensatz, wie er vom Server gesendet wird (fehlt bei einem neuen Datensatz) |
| `disabled` | `boolean` | Feld ist schreibgeschützt |
| `minimalistView` | `boolean` | Rendering im Popup-Zelleneditor der Tabelle (Kompaktmodus) |
| `customProps` | `unknown` | Die `customProps` des Felds aus `customizeTable`, unverändert |

## Verwendung

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```tsx
// frontend/src/cms/brands.tsx
import { customizeTable } from "@rebasepro/cms";
import type { brands } from "../../../backend/schema/brands";
import { ColorPickerField } from "../fields/ColorPickerField";
import { ColorPreview } from "../fields/ColorPreview";

export const brandsCms = customizeTable<typeof brands>("brands", {
    fields: {
        brandColor: { Field: ColorPickerField, Preview: ColorPreview },
    },
});
```

`brandColor` ist im Backend ein `col.varchar({ length: 7 })`. Das Backend bekommt
die Komponente nie zu Gesicht, und das Frontend importiert lediglich den Typ der
Tabelle aus `backend/schema`.

## Ein wiederverwendbarer Feldtyp

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein Feld, das Sie über mehrere Tabellen hinweg verwenden, kann einmalig in
`<Rebase propertyConfigs>` registriert werden, mit dem Namen als Schlüssel, und
auf jedem Feld über `propertyConfig: "color_picker"` angegeben werden.

## Zugriff auf den Formularkontext

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein benutzerdefiniertes Feld kann den gesamten Datensatz lesen, während er
bearbeitet wird:

```tsx
import React from "react";
import type { FieldProps } from "@rebasepro/cms";
import type { NumberProperty } from "@rebasepro/cms-types";

export function PriceWithTaxField({ value, setValue, context }: FieldProps<NumberProperty>) {
    const taxRate = Number(context.values.taxRate ?? 0.1);
    const priceWithTax = value ? value * (1 + taxRate) : 0;

    return (
        <div>
            <input
                type="number"
                value={value ?? 0}
                onChange={(e) => setValue(Number(e.target.value))}
            />
            <p>With tax: {priceWithTax.toFixed(2)}</p>
        </div>
    );
}
```

## Tabellenmodus

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein benutzerdefiniertes Feld wird nicht innerhalb einer Tabellenzelle dargestellt:
Die Zelle zeigt den Wert (oder Ihre `Preview`), und beim Bearbeiten wird das Feld in
einem Popup geöffnet, bei dem `minimalistView` gesetzt ist. Halten Sie es dort
kompakt, wie es oben bei `ColorPickerField` der Fall ist.

## Benutzerdefinierte Vorschauen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`Preview` stellt den Wert außerhalb des Formulars dar. Es empfängt
`FieldPreviewProps`: `value`, die aufgelöste `property`, die `size`, die die
Oberfläche vorgibt (`"small"`, `"medium"` oder `"large"`), und die `customProps`
des Felds.

```tsx
// frontend/src/fields/ColorPreview.tsx
import React from "react";
import type { FieldPreviewProps } from "@rebasepro/cms-types";

export function ColorPreview({ value }: FieldPreviewProps) {
    const color = typeof value === "string" ? value : "transparent";
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: color }}/>
            {typeof value === "string" ? value : ""}
        </span>
    );
}
```

## Benutzerdefinierte Filter

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`Filter` ersetzt das Filter-Steuerelement eines einzelnen Felds. Es hat Vorrang
vor einem sammlungsweiten `Collection.FilterField`-Override sowie dem integrierten
Steuerelement für diesen Typ. Um lediglich die angebotenen Operatoren einzuschränken,
verwenden Sie stattdessen `filterOperators`.

## Nächste Schritte

- **[customizeTable](/docs/frontend/customize-table)** — Alle Feldoptionen
- **[Entity Views](/docs/frontend/entity-views)** — Benutzerdefinierte Tabs im Entitätseditor
- **[Entity Actions](/docs/frontend/entity-actions)** — Benutzerdefinierte Aktionsschaltflächen
- **[Additional Columns](/docs/frontend/additional-columns)** — Berechnete Tabellenspalten
