---
sourceHash: adec4552f7386908
title: Campi Personalizzati
sidebar_label: Campi Personalizzati
description: Crea campi modulo personalizzati per la modifica delle entità con accesso completo al contesto del modulo, ai valori delle entità e agli hook di Rebase.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Panoramica

Rebase genera automaticamente i campi del modulo in base ai tipi di proprietà. Per comportamenti personalizzati, puoi creare i tuoi campi.

## Creazione di un Campo Personalizzato

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

| Prop | Tipo | Descrizione |
|------|------|-------------|
| `value` | `T` | Valore corrente del campo |
| `setValue` | `(value: T) => void` | Aggiorna il valore del campo |
| `error` | `string` | Messaggio di errore di validazione |
| `showError` | `boolean` | Indica se mostrare l'errore |
| `isSubmitting` | `boolean` | Il modulo è in fase di salvataggio |
| `property` | `Property` | La configurazione della proprietà |
| `context` | `FormContext` | Il modulo: i suoi `values` (incluse le modifiche non salvate), `setFieldValue`, `id`, e `row`, il record salvato così come inviato dal server (assente per un nuovo record) |
| `disabled` | `boolean` | Il campo è in sola lettura |
| `minimalistView` | `boolean` | Rendering nell'editor a comparsa della cella della tabella (modalità compatta) |

## Registrazione di un Campo Personalizzato

### Per Singola Proprietà

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

### Quando il file della collezione è letto anche dal server

Nello scaffold predefinito, `config/collections/` viene caricato **sia** dal pannello di amministrazione sia dal backend: il backend legge gli stessi file per ricavare lo schema e l'API. Un riferimento diretto al componente è sicuro solo quando nessun elemento sul server carica quel file, poiché importare `ColorPickerField` importa anche React, il tuo CSS e tutto ciò che il componente include, nel grafo dei moduli del server.

Fai invece riferimento al componente tramite un import dinamico (lazy). Viene sottoposto a type-check esattamente allo stesso modo e il backend non lo chiama mai:

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

Il modulo deve avere un **export predefinito** (`default export`) — il thunk si risolve su `default`, e un export con solo nome non renderizza nulla. L'admin lo avvolge in `React.lazy` al primo rendering, quindi il componente costituisce anche un chunk separato anziché essere parte del bundle iniziale.

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

Quindi utilizzalo in qualsiasi collezione:

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

Un campo personalizzato non viene disegnato all'interno di una cella della tabella: la cella mostra il valore (o la tua `Preview`), e la sua modifica apre il campo in un popup con `minimalistView` impostato. Mantienilo compatto in quel contesto:

```tsx
function MyField({ value, setValue, minimalistView }: FieldProps<StringProperty>) {
    if (minimalistView) {
        return <input value={value ?? ""} onChange={(e) => setValue(e.target.value)}/>;
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

Per una visualizzazione personalizzata nella tabella (modalità non di modifica), usa il componente `Preview`:

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

## Passaggi Successivi

- **[Entity Views](/docs/frontend/entity-views)** — Schede personalizzate nell'editor di entità
- **[Entity Actions](/docs/frontend/entity-actions)** — Pulsanti di azione personalizzati
- **[Additional Columns](/docs/frontend/additional-columns)** — Colonne calcolate della tabella
