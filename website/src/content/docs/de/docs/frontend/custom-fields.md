---
sourceHash: adec4552f7386908
title: Benutzerdefinierte Felder
sidebar_label: Benutzerdefinierte Felder
description: Erstellen Sie benutzerdefinierte Formularfelder für die Bearbeitung von Entitäten mit vollständigem Zugriff auf den Formularkontext, Entitätswerte und Rebase-Hooks.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Übersicht

Rebase generiert Formularfelder automatisch basierend auf Eigenschaftstypen. Für benutzerdefiniertes Verhalten können Sie eigene Felder erstellen.

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
| `showError` | `boolean` | Gibt an, ob der Fehler angezeigt werden soll |
| `isSubmitting` | `boolean` | Formular wird gespeichert |
| `property` | `Property` | Die Eigenschaftskonfiguration |
| `context` | `FormContext` | Das Formular: dessen `values` (einschließlich ungespeicherter Änderungen), `setFieldValue`, `id` und `row`, der gespeicherte Datensatz, wie er vom Server gesendet wird (fehlt bei einem neuen Datensatz) |
| `disabled` | `boolean` | Feld ist schreibgeschützt |
| `minimalistView` | `boolean` | Rendering im Popup-Zelleneditor der Tabelle (Kompaktmodus) |

## Registrieren eines benutzerdefinierten Feldes

### Pro Eigenschaft

Auf einer einzelnen Eigenschaft registrieren:

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

### Wenn die Sammlungsdatei auch vom Server gelesen wird

Im Standard-Scaffold wird `config/collections/` sowohl vom Admin-Panel als auch vom Backend geladen – das Backend liest dieselben Dateien, um das Schema und die API abzuleiten. Eine direkte Komponentenreferenz ist nur dann sicher, wenn nichts auf dem Server diese Datei lädt, da der Import von `ColorPickerField` auch React, Ihr CSS und alles andere, was die Komponente einbindet, in den Modulgraphen des Servers importiert.

Verweisen Sie stattdessen mit einem Lazy-Import auf die Komponente. Die Typüberprüfung erfolgt auf genau dieselbe Weise, und das Backend ruft sie niemals auf:

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

Das Modul muss einen **default export** haben – der Thunk löst zu `default` auf, und ein rein benannter Export rendert nichts. Der Admin kapselt ihn beim ersten Rendern in `React.lazy`, sodass die Komponente auch als separater Chunk und nicht als Teil des anfänglichen Bundles geladen wird.

### Globale Eigenschaftskonfiguration

Einen wiederverwendbaren Feldtyp registrieren:

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

Verwenden Sie ihn dann in einer beliebigen Sammlung:

```typescript
properties: {
    color: {
        type: "string",
        name: "Color",
        propertyConfig: "color_picker"
    }
}
```

## Zugriff auf den Formularkontext

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

Ein benutzerdefiniertes Feld wird nicht innerhalb einer Tabellenzelle gezeichnet: Die Zelle zeigt den Wert (oder Ihre `Preview`), und bei der Bearbeitung öffnet sich das Feld in einem Popup mit gesetztem `minimalistView`. Halten Sie es dort kompakt:

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

## Benutzerdefinierte Vorschauen

Verwenden Sie für ein benutzerdefiniertes Rendering in der Tabelle (Nicht-Bearbeitungsmodus) die `Preview`-Komponente:

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

## Nächste Schritte

- **[Entity Views](/docs/frontend/entity-views)** — Benutzerdefinierte Tabs im Entitätseditor
- **[Entity Actions](/docs/frontend/entity-actions)** — Benutzerdefinierte Aktionsschaltflächen
- **[Additional Columns](/docs/frontend/additional-columns)** — Berechnete Tabellenspalten
