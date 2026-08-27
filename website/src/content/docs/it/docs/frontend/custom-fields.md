---
title: Campi Personalizzati
sidebar_label: Campi Personalizzati
description: Crea campi modulo personalizzati per la modifica delle entità con pieno accesso al contesto del modulo, ai valori dell'entità e agli hook di Rebase.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Panoramica

Rebase genera campi modulo automaticamente in base ai tipi di proprietà. Per un comportamento personalizzato, puoi costruire i tuoi campi.

## Creare un Campo Personalizzato

Un campo personalizzato è un componente React che riceve `FieldProps`:

```tsx
import type { FieldProps } from "@rebasepro/cms";
import type { StringProperty, NumberProperty } from "@rebasepro/types";

function ColorPickerField({ value, setValue, error, showError }: FieldProps<StringProperty>) {
    return (
        <div>
            <input
                type="color"
                value={value ?? "#000000"}
                onChange={(e) => setValue(e.target.value)}
            />
            {showError && error && <span className="text-red-500">{error}</span>}
        </div>
    );
}
```

### FieldProps

| Prop | Type | Description |
|------|------|-------------|
| `value` | `T` | Valore attuale del campo |
| `setValue` | `(value: T) => void` | Aggiorna il valore del campo |
| `error` | `string` | Messaggio di errore di validazione |
| `showError` | `boolean` | Se visualizzare l'errore |
| `isSubmitting` | `boolean` | Il modulo è in fase di salvataggio |
| `property` | `Property` | La configurazione della proprietà |
| `context` | `FormContext` | Contesto completo del modulo con tutti i valori dell'entità |
| `disabled` | `boolean` | Il campo è di sola lettura |
| `tableMode` | `boolean` | Rendering all'interno del foglio di calcolo (modalità compatta) |

## Registrare un Campo Personalizzato

### Per Proprietà

Registra su una singola proprietà:

```typescript
properties: {
    brand_color: {
        type: "string",
        name: "Brand Color",
        admin: {
            Field: ColorPickerField
        }
    }
}
```

### Quando il file della collection è letto anche dal server

Nello scaffold predefinito, `config/collections/` viene caricato **sia** dal pannello di amministrazione **sia** dal backend — il backend legge gli stessi file per ricavare schema e API. Un riferimento diretto al componente è sicuro solo se nessuna parte del server carica quel file, perché importare `ColorPickerField` importa anche React, il tuo CSS e tutto ciò che il componente porta con sé nel grafo dei moduli del server.

Indica invece il componente con un import lazy. Viene controllato dai tipi allo stesso modo e il backend non lo invoca mai:

```ts no-verify
// config/collections/products.ts
properties: {
    brand_color: {
        type: "string",
        name: "Brand Color",
        admin: {
            Field: () => import("../../frontend/src/ColorPickerField"),
            Preview: () => import("../../frontend/src/ColorPreview")
        }
    }
}
```

Il modulo deve avere un **export default** — il thunk risolve `default`, e un export solo con nome non renderizza nulla. Il pannello lo avvolge in `React.lazy` al primo render, quindi il componente diventa un chunk separato anziché parte del bundle iniziale.

### Configurazione Globale delle Proprietà

Registra un tipo di campo riutilizzabile:

```tsx
const colorPropertyConfig: PropertyConfig = {
    key: "color_picker",
    name: "Color Picker",
    property: {
        type: "string",
        admin: {
            Field: ColorPickerField
        }
    }
};

// Register globally — keyed by the config's `key`
<Rebase propertyConfigs={{ color_picker: colorPropertyConfig }}>…</Rebase>
```

Quindi usalo in qualsiasi collezione:

```typescript
properties: {
    color: {
        type: "string",
        name: "Color",
        propertyConfig: "color_picker"
    }
}
```

## Accesso al Contesto del Modulo

I campi personalizzati possono accedere a tutti i valori dell'entità:

```tsx
function PriceWithTaxField({ value, setValue, context }: FieldProps<NumberProperty>) {
    const taxRate = Number(context.values.tax_rate ?? 0.1);
    const priceWithTax = value ? value * (1 + taxRate) : 0;

    return (
        <div>
            <input
                type="number"
                value={value ?? 0}
                onChange={(e) => setValue(Number(e.target.value))}
            />
            <p>With tax: ${priceWithTax.toFixed(2)}</p>
        </div>
    );
}
```

## Modalità Tabella

Quando si effettua il rendering all'interno della vista foglio di calcolo, i campi dovrebbero essere compatti. Controlla `tableMode`:

```tsx
function MyField({ value, setValue, minimalistView }: FieldProps<StringProperty>) {
    if (minimalistView) {
        return <span onClick={() => { /* open editor */ }}>{value}</span>;
    }

    return (
        <div>
            <label>Full Editor</label>
            <textarea value={value ?? ""} onChange={(e) => setValue(e.target.value)} />
        </div>
    );
}
```

## Anteprime Personalizzate

Per il rendering personalizzato nella tabella (modalità non di modifica), usa il componente `Preview`:

```tsx
function ColorPreview({ value }: { value: string }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
                width: 24, height: 24,
                borderRadius: 4,
                backgroundColor: value
            }} />
            <span>{value}</span>
        </div>
    );
}

// Register it
properties: {
    color: {
        type: "string",
        name: "Color",
        admin: {
            Field: ColorPickerField,
            Preview: ColorPreview
        }
    }
}
```

## Passi Successivi

- **[Visualizzazioni Entità](/docs/frontend/entity-views)** — Schede personalizzate nell'editor di entità
- **[Azioni Entità](/docs/frontend/entity-actions)** — Pulsanti di azione personalizzati
- **[Colonne Aggiuntive](/docs/frontend/additional-columns)** — Colonne di tabella calcolate
