---
sourceHash: adec4552f7386908
title: Champs personnalisés
sidebar_label: Champs personnalisés
description: Créez des champs de formulaire personnalisés pour l'édition d'entités avec un accès complet au contexte du formulaire, aux valeurs de l'entité et aux hooks Rebase.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Vue d'ensemble

Rebase génère automatiquement les champs de formulaire en fonction des types de propriétés. Pour un comportement personnalisé, vous pouvez créer vos propres champs.

## Créer un champ personnalisé

Un champ personnalisé est un composant React qui reçoit `FieldProps` :

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
| `value` | `T` | Valeur actuelle du champ |
| `setValue` | `(value: T) => void` | Mettre à jour la valeur du champ |
| `error` | `string` | Message d'erreur de validation |
| `showError` | `boolean` | Indique s'il faut afficher l'erreur |
| `isSubmitting` | `boolean` | Le formulaire est en cours d'enregistrement |
| `property` | `Property` | La configuration de la propriété |
| `context` | `FormContext` | Le formulaire : ses `values` (modifications non enregistrées incluses), `setFieldValue`, `id` et `row`, l'enregistrement sauvegardé tel qu'envoyé par le serveur (absent pour un nouvel enregistrement) |
| `disabled` | `boolean` | Le champ est en lecture seule |
| `minimalistView` | `boolean` | Rendu dans l'éditeur de cellule contextuel du tableau (mode compact) |

## Enregistrer un champ personnalisé

### Par propriété

Enregistrer sur une seule propriété :

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

### Lorsque le fichier de collection est également lu par le serveur

Dans le scaffold par défaut, `config/collections/` est chargé à la fois par le panneau d'administration **et** le backend — le backend lit les mêmes fichiers pour dériver le schéma et l'API. Une référence directe au composant n'est sûre que si rien sur le serveur ne charge ce fichier, car importer `ColorPickerField` importe également React, votre CSS et tout ce que le composant intègre dans le graphe de modules du serveur.

Pointez plutôt vers le composant avec un import dynamique (lazy import). Le typage est vérifié exactement de la même manière, et le backend ne l'appelle jamais :

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

Le module doit avoir un **export par défaut** — le thunk se résout vers `default`, et un export nommé uniquement n'affichera rien. L'admin l'enveloppe dans `React.lazy` lors du premier rendu, de sorte que le composant constitue également un chunk distinct plutôt que de faire partie du bundle initial.

### Configuration globale de propriété

Enregistrer un type de champ réutilisable :

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

Utilisez-le ensuite dans n'importe quelle collection :

```typescript
properties: {
    color: {
        type: "string",
        name: "Color",
        propertyConfig: "color_picker"
    }
}
```

## Accéder au contexte du formulaire

Les champs personnalisés peuvent accéder à l'ensemble des valeurs de l'entité :

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

## Mode tableau

Un champ personnalisé n'est pas rendu à l'intérieur d'une cellule de tableau : la cellule affiche la valeur (ou votre `Preview`), et la modifier ouvre le champ dans une popup avec `minimalistView` activé. Gardez-le compact dans ce cas :

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

## Prévisualisations personnalisées

Pour un rendu personnalisé dans le tableau (mode hors édition), utilisez le composant `Preview` :

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

## Étapes suivantes

- **[Entity Views](/docs/frontend/entity-views)** — Onglets personnalisés dans l'éditeur d'entité
- **[Entity Actions](/docs/frontend/entity-actions)** — Boutons d'action personnalisés
- **[Additional Columns](/docs/frontend/additional-columns)** — Colonnes de tableau calculées
