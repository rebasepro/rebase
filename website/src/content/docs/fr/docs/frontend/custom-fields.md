---
sourceHash: d337d344b88534c8
title: Champs personnalisés
sidebar_label: Champs personnalisés
description: Créez des champs de formulaire personnalisés pour l'édition d'entités avec un accès complet au contexte du formulaire, aux valeurs de l'entité et aux hooks Rebase.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Vue d'ensemble

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Le CMS génère un champ pour chaque colonne à partir de son type (voir
[Champs](/docs/collections/properties/)). Lorsque cela ne correspond pas à vos
besoins, associez au champ votre propre composant dans `customizeTable` : `Field`
remplace le contrôle dans le formulaire, `Preview` remplace la façon dont la valeur
est affichée partout ailleurs (une cellule de tableau, une carte, une pastille de
référence), et `Filter` remplace son contrôle de filtre.

Un composant est une valeur. `customizeTable` s'exécute uniquement dans le bundle
du navigateur, vous importez donc le composant comme vous le feriez n'importe où
ailleurs dans votre frontend et le transmettez directement. Un chemin sous forme
de chaîne de caractères ou un thunk lazy `() => import(…)` lèvera une exception,
en indiquant quoi écrire à la place.

## Créer un champ personnalisé

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un champ personnalisé est un composant React qui reçoit `FieldProps` :

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

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| Prop | Type | Description |
|------|------|-------------|
| `value` | `T` | Valeur actuelle du champ |
| `setValue` | `(value: T) => void` | Met à jour la valeur du champ |
| `error` | `string` | Message d'erreur de validation |
| `showError` | `boolean` | Indique s'il faut afficher l'erreur |
| `isSubmitting` | `boolean` | Le formulaire est en cours d'enregistrement |
| `property` | `Property` | Le champ tel que résolu par le CMS : libellé, validation, options |
| `context` | `FormContext` | Le formulaire : ses `values` (modifications non enregistrées incluses), `setFieldValue`, `id`, et `row`, l'enregistrement sauvegardé tel qu'envoyé par le serveur (absent pour un nouvel enregistrement) |
| `disabled` | `boolean` | Le champ est en lecture seule |
| `minimalistView` | `boolean` | Rendu dans l'éditeur de cellule contextuel du tableau (mode compact) |
| `customProps` | `unknown` | Les `customProps` du champ définies dans `customizeTable`, intactes |

## Utilisation

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

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

`brandColor` est un `col.varchar({ length: 7 })` côté backend. Le backend ne voit
jamais le composant, et le frontend importe uniquement le type de la table depuis
`backend/schema`.

## Un type de champ réutilisable

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un champ utilisé sur plusieurs tables peut être enregistré une seule fois dans
`<Rebase propertyConfigs>`, indexé par son nom, et spécifié sur chaque champ avec
`propertyConfig: "color_picker"`.

## Accéder au contexte du formulaire

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un champ personnalisé peut lire l'intégralité de l'enregistrement en cours de
modification :

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

## Mode tableau

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un champ personnalisé n'est pas affiché directement dans une cellule de tableau :
la cellule affiche la valeur (ou votre `Preview`), et la modifier ouvre le champ
dans une fenêtre contextuelle avec `minimalistView` activé. Veillez à ce qu'il
reste compact dans ce contexte, comme le fait `ColorPickerField` ci-dessus.

## Aperçus personnalisés

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`Preview` affiche la valeur en dehors du formulaire. Il reçoit `FieldPreviewProps` :
`value`, la `property` résolue, la taille `size` attribuée par la surface (`"small"`,
`"medium"` ou `"large"`), ainsi que les `customProps` du champ.

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

## Filtres personnalisés

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`Filter` remplace le contrôle de filtre d'un champ. Il prend le pas sur une
surcharge globale à la collection `Collection.FilterField` ainsi que sur le
contrôle natif pour ce type. Pour restreindre uniquement les opérateurs proposés,
utilisez plutôt `filterOperators`.

## Étapes suivantes

- **[customizeTable](/docs/frontend/customize-table)** — Toutes les options de champ
- **[Entity Views](/docs/frontend/entity-views)** — Onglets personnalisés dans l'éditeur d'entités
- **[Entity Actions](/docs/frontend/entity-actions)** — Boutons d'action personnalisés
- **[Additional Columns](/docs/frontend/additional-columns)** — Colonnes calculées dans le tableau
