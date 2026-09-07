---
sourceHash: af85efb5a9d69006
title: Vues d'entité
sidebar_label: Vues d'entité
description: Ajoutez des onglets et des vues personnalisés aux pages de détails d'entité pour des aperçus, des analyses, des données connexes ou une interface utilisateur personnalisée.
---

## Aperçu

Les vues d'entité vous permettent d'ajouter des **onglets** personnalisés à la page de détails de l'entité, en plus du formulaire par défaut. Utilisez-les pour :

- Des **aperçus** en direct (aperçu de site web, contenu rendu)
- Des vues de **données connexes** (articles de commande, entités enfants)
- Des **analyses** ou des graphiques
- Des **éditeurs personnalisés** (texte enrichi, éditeurs de cartes)

## Ajout de vues d'entité

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

## Création d'une vue d'entité

```tsx
import type { EntityCustomViewParams } from "@rebasepro/cms-types";

function ArticlePreview({
    entity,
    modifiedValues,
    formContext
}: EntityCustomViewParams) {
    // modifiedValues has the unsaved, live form values
    const title = modifiedValues?.title ?? entity?.values?.title;
    const content = modifiedValues?.content ?? entity?.values?.content;

    return (
        <div className="p-8 max-w-2xl mx-auto">
            <h1 className="text-3xl font-semibold">{title}</h1>
            <div dangerouslySetInnerHTML={{ __html: content }} />
        </div>
    );
}
```

### EntityCustomViewParams

| Prop | Type | Description |
|------|------|-------------|
| `entity` | `Entity` | L'entité sauvegardée (null pour les nouvelles entités) |
| `modifiedValues` | `EntityValues` | Valeurs actuelles non sauvegardées du formulaire (mises à jour en direct pendant que l'utilisateur tape) |
| `formContext` | `FormContext` | Contexte complet du formulaire |
| `collection` | `CollectionConfig` | Définition de la collection |

![Vue d'entité avec formulaire secondaire](/img/entity_view_secondary_form.png)

## Contrôle de la position

Les vues apparaissent sous forme d'onglets. Vous pouvez configurer leur position :

```typescript
entityViews: [
    {
        key: "preview",
        name: "Preview",
        Builder: ArticlePreview,
        position: "start"  // Apparaît avant l'onglet du formulaire par défaut
    }
]
```

## Prochaines étapes

- **[Champs personnalisés](/docs/frontend/custom-fields)** — Créez des champs de formulaire personnalisés
- **[Actions d'entité](/docs/frontend/entity-actions)** — Boutons d'action personnalisés

---
