---
title: Modes d'affichage
sidebar_label: Modes d'affichage
slug: fr/docs/frontend/view-modes
description: Configurez les vues tableau, cartes et Kanban pour vos collections.
---

## Aperçu

Chaque collection peut être affichée selon quatre modes d'affichage :

- **Liste** — Vue en liste simple et épurée (le mode par défaut classique des CMS)
- **Tableau** — Grille de type feuille de calcul avec édition en ligne, tri, filtrage
- **Cartes** — Grille de cartes pour le contenu visuel (images, aperçus)
- **Kanban** — Tableau glisser-déposer groupé par une propriété d'énumération

## Configuration

```typescript
const productsCollection: EntityCollection = {
    slug: "products",
    defaultViewMode: "table",            // Default view
    enabledViews: ["list", "table", "kanban"],    // Available views
    kanban: {
        columnProperty: "status",        // Enum property for columns
        orderProperty: "sort_order"      // Property for drag-and-drop ordering
    },
    // ...
};
```

## Vue Liste

![List View screenshot placeholder](/img/features/list-view.png)

La vue liste est le mode d'affichage par défaut classique et épuré des CMS, présentant les entités sous forme de liste directe, sans la densité d'une feuille de calcul.

## Vue Tableau

![Table View screenshot placeholder](/img/features/table-view.png)

La vue par défaut est une feuille de calcul virtualisée haute performance avec :

- **Édition en ligne** — Cliquez sur n'importe quelle cellule pour modifier sur place
- **Redimensionnement des colonnes** — Faites glisser les en-têtes de colonne
- **Réorganisation des colonnes** — Faites glisser pour réorganiser
- **Tri** — Cliquez sur les en-têtes de colonne
- **Recherche textuelle** — Recherche plein texte dans les champs de type chaîne de caractères
- **Filtrage** — Filtres par colonne
- **Sélection multiple** — Sélectionnez des entités pour des actions groupées

### Hauteur des lignes

Contrôlez la hauteur des lignes avec `defaultSize` :

| Taille | Pixels | Idéal pour |
|--------|--------|------------|
| `"xs"` | 40 | Tableaux de données denses |
| `"s"` | 54 | Par défaut |
| `"m"` | 80 | Avec des vignettes d'image |
| `"l"` | 120 | Cartes avec aperçus |
| `"xl"` | 260 | Aperçus de contenu riche |

## Vue Kanban

![Kanban View screenshot placeholder](/img/features/kanban-view.png)

Configurez un tableau Kanban en spécifiant la propriété d'énumération à utiliser comme colonnes :

```typescript
const tasksCollection: EntityCollection = {
    slug: "tasks",
    defaultViewMode: "kanban",
    kanban: {
        columnProperty: "status",
        orderProperty: "sort_order"
    },
    properties: {
        title: { type: "string", name: "Title" },
        status: {
            type: "string",
            name: "Status",
            enum: [
                { id: "backlog", label: "Backlog", color: "grayDark" },
                { id: "in_progress", label: "In Progress", color: "blueDark" },
                { id: "review", label: "Review", color: "orangeDark" },
                { id: "done", label: "Done", color: "greenDark" }
            ]
        },
        sort_order: { type: "number", name: "Sort Order" }
    }
};
```

Le glisser-déposer entre les colonnes met automatiquement à jour le champ d'énumération et l'ordre de tri.

## Vue Cartes

![Cards View screenshot placeholder](/img/features/cards-view.png)

Les cartes affichent les entités sous forme de cartes visuelles — utile pour le contenu riche en images :

```typescript
const articlesCollection: EntityCollection = {
    slug: "articles",
    defaultViewMode: "cards",
    properties: {
        title: { type: "string", name: "Title" },
        cover: {
            type: "string",
            name: "Cover Image",
            storage: { storagePath: "covers", acceptedFiles: ["image/*"] }
        }
    }
};
```

## Prochaines étapes

- **[Vues d'entités](/docs/frontend/entity-views)** — Onglets personnalisés sur les formulaires d'entités
- **[Actions d'entités](/docs/frontend/entity-actions)** — Actions d'entités personnalisées

---
