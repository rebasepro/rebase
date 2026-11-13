---
sourceHash: d337d344b88534c8
title: Campi personalizzati
sidebar_label: Campi personalizzati
description: Crea campi modulo personalizzati per la modifica delle entità con accesso completo al contesto del modulo, ai valori dell'entità e agli hook di Rebase.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Panoramica

<span class="since-badge" data-since="0.31">Da 0.31</span>

Il CMS disegna un campo per ogni colonna in base al suo tipo (vedi
[Fields](/docs/collections/properties/)). Quando non è ciò che desideri, assegna
al campo un tuo componente in `customizeTable`: `Field` sostituisce il
controllo nel modulo, `Preview` sostituisce il modo in cui il valore viene visualizzato ovunque
(una cella di tabella, una scheda, un chip di riferimento) e `Filter` sostituisce il relativo
controllo del filtro.

Un componente è un valore. `customizeTable` viene eseguito solo nel bundle del browser, quindi
importi il componente come faresti ovunque nel tuo frontend e lo passi
direttamente. Un percorso stringa o un thunk lazy `() => import(…)` generano un errore, indicando
cosa scrivere al suo posto.

## Creazione di un campo personalizzato

<span class="since-badge" data-since="0.31">Da 0.31</span>

Un campo personalizzato è un componente React che riceve `FieldProps`:

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

<span class="since-badge" data-since="0.31">Da 0.31</span>

| Prop | Tipo | Descrizione |
|------|------|-------------|
| `value` | `T` | Valore corrente del campo |
| `setValue` | `(value: T) => void` | Aggiorna il valore del campo |
| `error` | `string` | Messaggio di errore di validazione |
| `showError` | `boolean` | Se visualizzare l'errore |
| `isSubmitting` | `boolean` | Il modulo è in fase di salvataggio |
| `property` | `Property` | Il campo come risolto dal CMS: etichetta, validazione, opzioni |
| `context` | `FormContext` | Il modulo: i suoi `values` (comprese le modifiche non salvate), `setFieldValue`, `id` e `row`, il record salvato inviato dal server (assente per un nuovo record) |
| `disabled` | `boolean` | Il campo è di sola lettura |
| `minimalistView` | `boolean` | Rendering nell'editor a comparsa della cella della tabella (modalità compatta) |
| `customProps` | `unknown` | I `customProps` del campo da `customizeTable`, senza modifiche |

## Utilizzo

<span class="since-badge" data-since="0.31">Da 0.31</span>

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

`brandColor` è un `col.varchar({ length: 7 })` sul backend. Il backend non vede mai il
componente e il frontend importa solo il tipo della tabella da
`backend/schema`.

## Un tipo di campo riutilizzabile

<span class="since-badge" data-since="0.31">Da 0.31</span>

Un campo utilizzato in molte tabelle può essere registrato una sola volta su
`<Rebase propertyConfigs>`, indicizzato per nome, e indicato su ciascun campo con
`propertyConfig: "color_picker"`.

## Accesso al contesto del modulo

<span class="since-badge" data-since="0.31">Da 0.31</span>

Un campo personalizzato può leggere l'intero record durante la modifica:

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

## Modalità tabella

<span class="since-badge" data-since="0.31">Da 0.31</span>

Un campo personalizzato non viene disegnato all'interno di una cella di tabella: la cella mostra il valore (o
la tua `Preview`) e la sua modifica apre il campo in un popup con `minimalistView`
impostato. Mantienilo compatto in quel contesto, come fa `ColorPickerField` qui sopra.

## Anteprime personalizzate

<span class="since-badge" data-since="0.31">Da 0.31</span>

`Preview` visualizza il valore all'esterno del modulo. Riceve `FieldPreviewProps`:
`value`, la `property` risolta, la dimensione `size` assegnata dalla superficie (`"small"`,
`"medium"` o `"large"`) e i `customProps` del campo.

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

## Filtri personalizzati

<span class="since-badge" data-since="0.31">Da 0.31</span>

`Filter` sostituisce il controllo del filtro di un singolo campo. Ha la precedenza su un
override `Collection.FilterField` a livello di collezione e sul controllo integrato per
quel tipo. Per limitare semplicemente gli operatori disponibili, usa invece `filterOperators`.

## Passaggi successivi

- **[customizeTable](/docs/frontend/customize-table)** — Tutte le opzioni dei campi
- **[Entity Views](/docs/frontend/entity-views)** — Schede personalizzate nell'editor di entità
- **[Entity Actions](/docs/frontend/entity-actions)** — Pulsanti di azione personalizzati
- **[Additional Columns](/docs/frontend/additional-columns)** — Colonne calcolate della tabella
