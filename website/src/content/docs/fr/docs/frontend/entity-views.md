---
sourceHash: 0a2cae1ef41369b1
title: Vues d'entités
sidebar_label: Vues d'entités
description: Ajoutez des onglets et des vues personnalisés aux pages de détail des entités pour les aperçus, les analyses, les données associées ou une interface utilisateur personnalisée.
---

## Présentation

Les vues d'entités vous permettent d'ajouter des **onglets** personnalisés à la page de détail d'une entité aux côtés du formulaire par défaut. Utilisez-les pour :

- Des **aperçus** en direct (aperçu du site web, contenu rendu)
- Des vues de **données associées** (éléments d'une commande, entités enfants)
- Des **analyses** ou des graphiques
- Des **éditeurs personnalisés** (texte enrichi, éditeurs de carte)

## Ajouter des vues d'entités

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const articlesCollection = defineCollection({
    slug: "articles",
    table: "articles",
    name: "Articles",
    properties: { /* ... */ },
    admin: {
        entityViews: [
            {
                key: "preview",
                name: "Preview",
                Builder: ArticlePreview
            },
            {
                key: "related",
                name: "Related Articles",
                Builder: RelatedArticlesView
            }
        ]
    }
});

```

## Créer une vue d'entité

```tsx
import type { EntityCustomViewParams } from "@rebasepro/cms-types";

function ArticlePreview({
    row,
    modifiedValues,
    formContext
}: EntityCustomViewParams) {
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

| Propriété | Type | Description |
|------|------|-------------|
| `row` | `Record<string, unknown>` | L'enregistrement sauvegardé tel que le serveur renvoie la ligne : les dates sous forme de chaînes ISO, une relation belongsTo sous forme de sa colonne de clé étrangère, `id` inclus. Absent lors de la création d'un nouvel enregistrement |
| `modifiedValues` | `EntityValues` | Valeurs actuelles du formulaire, modifications non enregistrées incluses (en direct au cours de la saisie), typées pour l'éditeur : une date est un objet `Date` |
| `formContext` | `FormContext` | Contexte complet du formulaire |
| `collection` | `AdminCollection` | Définition de la collection |

![Vue d'entité avec formulaire secondaire](/img/entity_view_secondary_form.png)

## Contrôler la position

Les vues s'affichent sous forme d'onglets. Vous pouvez configurer leur position :

```typescript
entityViews: [
    {
        key: "preview",
        name: "Preview",
        Builder: ArticlePreview,
        position: "start"  // Appears before the default form tab
    }
]
```

## Étapes suivantes

- **[Champs personnalisés](/docs/frontend/custom-fields)** — Créer des champs de formulaire personnalisés
- **[Actions d'entité](/docs/frontend/entity-actions)** — Boutons d'action personnalisés
