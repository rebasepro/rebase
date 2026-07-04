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
import { FieldProps } from "@rebasepro/core";

function ColorPickerField({ value, setValue, error, showError }: FieldProps<string>) {
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
        ui: {
            Field: ColorPickerField
        }
    }
}
```

### Configurazione Globale delle Proprietà

Registra un tipo di campo riutilizzabile:

```typescript
const colorPropertyConfig: PropertyConfig = {
    key: "color_picker",
    name: "Color Picker",
    property: {
        type: "string",
        ui: {
            Field: ColorPickerField
        }
    }
};

// Register globally
<Rebase propertyConfigs={[colorPropertyConfig]} ... />
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
function PriceWithTaxField({ value, setValue, context }: FieldProps<number>) {
    const taxRate = context.values.tax_rate ?? 0.1;
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
function MyField({ value, setValue, tableMode }: FieldProps<string>) {
    if (tableMode) {
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
        ui: {
            Field: ColorPickerField,
            Preview: ColorPreview
        }
    }
}
```

## Passi Successivi

- **[Visualizzazioni Entità](/docs/frontend/snapshot-views)** — Schede personalizzate nell'editor di entità
- **[Azioni Entità](/docs/frontend/snapshot-actions)** — Pulsanti di azione personalizzati
- **[Colonne Aggiuntive](/docs/frontend/additional-columns)** — Colonne di tabella calcolate
