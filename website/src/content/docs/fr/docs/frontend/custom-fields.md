---
sourceHash: db02ecc36f64f46c
title: Champs personnalisés
sidebar_label: Champs personnalisés
description: Créez des champs de formulaire personnalisés pour l'édition d'entités avec un accès complet au contexte du formulaire, aux valeurs de l'entité et aux hooks Rebase.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Aperçu

Rebase génère automatiquement des champs de formulaire basés sur les types de propriétés. Pour un comportement personnalisé, vous pouvez créer vos propres champs.

## Créer un champ personnalisé

Un champ personnalisé est un composant React qui reçoit des `FieldProps` :

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

| Propriété | Type | Description |
|------|------|-------------|
| `value` | `T` | Valeur actuelle du champ |
| `setValue` | `(value: T) => void` | Mettre à jour la valeur du champ |
| `error` | `string` | Message d'erreur de validation |
| `showError` | `boolean` | Indique si l'erreur doit être affichée |
| `isSubmitting` | `boolean` | Le formulaire est en cours d'enregistrement |
| `property` | `Property` | La configuration de la propriété |
| `context` | `FormContext` | Contexte complet du formulaire avec toutes les valeurs de l'entité |
| `disabled` | `boolean` | Le champ est en lecture seule |
| `tableMode` | `boolean` | Rendu à l'intérieur de la feuille de calcul (mode compact) |

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

### Quand le fichier de collection est aussi lu par le serveur

Dans le scaffold par défaut, `config/collections/` est chargé **à la fois** par le panneau d'administration et par le backend — le backend lit les mêmes fichiers pour en déduire le schéma et l'API. Une référence directe au composant n'est sûre que si rien côté serveur ne charge ce fichier, car importer `ColorPickerField` importe aussi React, votre CSS et tout ce que le composant entraîne dans le graphe de modules du serveur.

Désignez plutôt le composant par un import différé. Il est typé de la même manière et le backend ne l'appelle jamais :

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

Le module doit avoir un **export par défaut** — le thunk résout `default`, et un export uniquement nommé n'affiche rien. Le panneau l'enveloppe dans `React.lazy` au premier rendu : le composant forme donc son propre chunk au lieu d'alourdir le bundle initial.

### Configuration globale des propriétés

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

Les champs personnalisés peuvent accéder à toutes les valeurs de l'entité :

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
            <p>Avec taxe : ${priceWithTax.toFixed(2)}</p>
        </div>
    );
}
```

## Mode Tableau

Lors du rendu dans la vue feuille de calcul, les champs doivent être compacts. Vérifiez `tableMode` :

```tsx
function MyField({ value, setValue, minimalistView }: FieldProps<StringProperty>) {
    if (minimalistView) {
        return <span onClick={() => { /* open editor */ }}>{value}</span>;
    }

    return (
        <div>
            <label>Éditeur complet</label>
            <textarea value={value ?? ""} onChange={(e) => setValue(e.target.value)} />
        </div>
    );
}
```

## Aperçus personnalisés

Pour un rendu personnalisé dans le tableau (mode non-édition), utilisez le composant `Preview` :

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

// Enregistrer le composant
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

## Prochaines étapes

- **[Vues d'entité](/docs/frontend/entity-views)** — Onglets personnalisés dans l'éditeur d'entité
- **[Actions d'entité](/docs/frontend/entity-actions)** — Boutons d'action personnalisés
- **[Colonnes supplémentaires](/docs/frontend/additional-columns)** — Colonnes de tableau calculées

---
