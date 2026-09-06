---
sourceHash: db02ecc36f64f46c
title: Benutzerdefinierte Felder
sidebar_label: Benutzerdefinierte Felder
description: Erstellen Sie benutzerdefinierte Formularfelder für die Entitätsbearbeitung mit vollem Zugriff auf den Formular-Kontext, Entitätswerte und Rebase-Hooks.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Übersicht

Rebase generiert Formularfelder automatisch basierend auf Eigenschaftstypen. Für benutzerdefiniertes Verhalten können Sie Ihre eigenen Felder erstellen.

## Erstellen eines benutzerdefinierten Feldes

Ein benutzerdefiniertes Feld ist eine React-Komponente, die `FieldProps` empfängt:

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

| Prop | Typ | Beschreibung |
|------|------|-------------|
| `value` | `T` | Aktueller Feldwert |
| `setValue` | `(value: T) => void` | Feldwert aktualisieren |
| `error` | `string` | Validierungsfehlermeldung |
| `showError` | `boolean` | Ob der Fehler angezeigt werden soll |
| `isSubmitting` | `boolean` | Formular wird gespeichert |
| `property` | `Property` | Die Eigenschaftskonfiguration |
| `context` | `FormContext` | Voller Formular-Kontext mit allen Entitätswerten |
| `disabled` | `boolean` | Feld ist schreibgeschützt |
| `tableMode` | `boolean` | Rendern innerhalb der Tabelle (kompakter Modus) |

## Registrieren eines benutzerdefinierten Feldes

### Pro-Eigenschaft

Registrierung für eine einzelne Eigenschaft:

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

### Wenn die Collection-Datei auch vom Server gelesen wird

Im Standard-Scaffold wird `config/collections/` **sowohl** vom Admin-Panel als auch vom Backend geladen — das Backend liest dieselben Dateien, um Schema und API abzuleiten. Eine direkte Komponenten-Referenz ist nur dann unbedenklich, wenn keine Server-Seite diese Datei lädt: Der Import von `ColorPickerField` zieht React, dein CSS und alles Weitere, was die Komponente mitbringt, in den Modulgraphen des Servers.

Verweise stattdessen per Lazy-Import auf die Komponente. Sie wird genauso typgeprüft, und das Backend ruft sie nie auf:

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

Das Modul braucht einen **Default-Export** — der Thunk löst auf `default` auf, ein rein benannter Export rendert nichts. Das Admin-Panel umhüllt die Komponente beim ersten Rendern mit `React.lazy`, sie landet also in einem eigenen Chunk statt im initialen Bundle.

### Globale Eigenschaftskonfiguration

Registrieren Sie einen wiederverwendbaren Feldtyp:

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

Verwenden Sie es dann in jeder Sammlung:

```typescript
properties: {
    color: {
        type: "string",
        name: "Color",
        propertyConfig: "color_picker"
    }
}
```

## Zugriff auf den Formular-Kontext

Benutzerdefinierte Felder können auf die vollständigen Entitätswerte zugreifen:

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

## Tabellenmodus

Beim Rendern in der Tabellenansicht sollten Felder kompakt sein. Überprüfen Sie `tableMode`:

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

## Benutzerdefinierte Vorschauen

Für benutzerdefiniertes Rendern in der Tabelle (Nicht-Bearbeitungsmodus) verwenden Sie die `Preview`-Komponente:

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

// Registrieren Sie es
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

## Nächste Schritte

- **[Entitätsansichten](/docs/frontend/entity-views)** — Benutzerdefinierte Tabs im Entitäts-Editor
- **[Entitätsaktionen](/docs/frontend/entity-actions)** — Benutzerdefinierte Aktionsschaltflächen
- **[Zusätzliche Spalten](/docs/frontend/additional-columns)** — Berechnete Tabellenspalten
---
