---
sourceHash: faf8f760aabce923
title: Vues d'entités
sidebar_label: Vues d'entités
description: Ajoutez des onglets et des vues personnalisés aux pages de détail des entités pour des prévisualisations, des analyses, des données associées ou une interface utilisateur personnalisée.
---

## Aperçu

Les vues d'entités vous permettent d'ajouter des **onglets** personnalisés à la page de détail de l'entité, aux côtés du formulaire par défaut. Utilisez-les pour :

- Des **prévisualisations** en direct (aperçu du site web, contenu rendu)
- Des vues de **données associées** (articles d'une commande, entités enfants)
- Des **analyses** ou des graphiques
- Des **éditeurs personnalisés** (texte enrichi, éditeurs de carte)

## Ajouter des vues d'entités

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";
import { ArticlePreview } from "../../../../../components/ArticlePreview";

export const productsCms = customizeTable<typeof products>("products", {
    entityViews: [
        { key: "preview", name: "Preview", Builder: ArticlePreview, position: "start" },
        "related",   // registered once on <RebaseCMS entityViews>
    ],
});
```

Une entrée est une vue, ou la `key` d'une vue enregistrée une seule fois sur
`<RebaseCMS entityViews>` (ou `<Rebase entityViews>`), pour les onglets partagés par
plusieurs tables. Une vue enregistrée s'affiche uniquement sur les tables qui spécifient sa clé.
`position: "start"` place l'onglet avant celui du formulaire ; sinon, il est placé après.

## Créer une vue d'entité

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`Builder` est le composant lui-même, importé par valeur :

```tsx
// frontend/src/components/ArticlePreview.tsx
import React from "react";
import type { EntityCustomViewParams } from "@rebasepro/cms-types";

export function ArticlePreview({ row, modifiedValues }: EntityCustomViewParams) {
    // modifiedValues has the unsaved, live form values; row is the saved
    // record. Both are open records, so narrow before rendering.
    const title = String(modifiedValues?.title ?? row?.title ?? "");
    const content = String(modifiedValues?.content ?? row?.content ?? "");

    return (
        <div className="p-8 max-w-2xl mx-auto">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
            <div dangerouslySetInnerHTML={{ __html: content }} />
        </div>
    );
}
```

### EntityCustomViewParams

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| Prop | Type | Description |
|------|------|-------------|
| `row` | `Record<string, unknown>` | L'enregistrement sauvegardé tel que le serveur renvoie la ligne : les dates sous forme de chaînes ISO, une relation belongsTo sous forme de sa colonne de clé étrangère, `id` uniquement lorsque la table possède cette colonne. Absent lors de la création d'un nouvel enregistrement |
| `id` | `string` | L'identifiant de l'enregistrement sauvegardé, aux côtés de `row` : sa clé primaire sous forme de chaîne de caractères, les parties d'une clé composite étant jointes par `:::`. Ce que prennent `useSidePanel().open` et `useRowWrites().update`. Absent lors de la création d'un nouvel enregistrement |
| `modifiedValues` | `EntityValues` | Les valeurs actuelles du formulaire, modifications non enregistrées incluses (en direct au fur et à mesure de la saisie), typées pour l'éditeur : une date est un objet `Date` |
| `formContext` | `FormContext` | Contexte complet du formulaire |
| `collection` | `AdminCollection` | La collection telle qu'elle a été résolue par le CMS |

![Vue d'entité avec formulaire secondaire](/img/entity_view_secondary_form.png)

Les relations to-many d'une table constituent également des onglets de l'enregistrement, sans rien nécessiter de tout cela ;
voir [Relations dans le panneau](/docs/collections/relations-in-the-admin-panel/).
`defaultSelectedView` dans `customizeTable` définit l'onglet sur lequel un enregistrement s'ouvre par défaut.

## Prochaines étapes

- **[Champs personnalisés](/docs/frontend/custom-fields)** — Créer des champs de formulaire personnalisés
- **[Actions d'entité](/docs/frontend/entity-actions)** — Boutons d'action personnalisés
