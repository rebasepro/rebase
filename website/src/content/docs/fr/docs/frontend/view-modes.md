---
title: Modes d'affichage
sidebar_label: Modes d'affichage
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
import { defineCollection } from "@rebasepro/admin-types";
const productsCollection = defineCollection({
    slug: "products",
    properties: { /* … */ },
    name: "Products",
    table: "products",
    // ...
    admin: {
        defaultViewMode: "table",            // Default view
        enabledViews: ["list", "table", "kanban"],    // Available views
        kanban: {
            columnProperty: "status",        // Enum property for columns
            orderProperty: "sortOrder"      // Property for drag-and-drop ordering
        }
    }
});

```

## Vue Liste

![Espace réservé pour capture d'écran de vue en liste](/img/features/list-view.png)

La vue liste est le mode d'affichage par défaut classique et épuré des CMS, présentant les entités sous forme de liste directe, sans la densité d'une feuille de calcul.

## Vue Tableau

![Espace réservé pour capture d'écran de vue en tableau](/img/features/table-view.png)

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

![Espace réservé pour capture d'écran de vue Kanban](/img/features/kanban-view.png)

Configurez un tableau Kanban en spécifiant la propriété d'énumération à utiliser comme colonnes :

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const tasksCollection = defineCollection({
    slug: "tasks",
    name: "Tasks",
    table: "tasks",
    properties: {
        title: { type: "string", name: "Title" },
        status: {
            type: "string",
            name: "Status",
            enum: [
                { id: "backlog", label: "Backlog", color: "gray" },
                { id: "in_progress", label: "In Progress", color: "blue" },
                { id: "review", label: "Review", color: "orange" },
                { id: "done", label: "Done", color: "green" }
            ]
        },
        sortOrder: { type: "number", name: "Sort Order" }
    },
    admin: {
        defaultViewMode: "kanban",
        kanban: {
            columnProperty: "status",
            orderProperty: "sortOrder"
        }
    }
});

```

Le glisser-déposer entre les colonnes met automatiquement à jour le champ d'énumération et l'ordre de tri.

## Vue Cartes

![Espace réservé pour capture d'écran de vue en cartes](/img/features/cards-view.png)

Les cartes affichent les entités sous forme de cartes visuelles — utile pour le contenu riche en images :

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { type: "string", name: "Title" },
        cover: {
            type: "string",
            name: "Cover Image",
            storage: { storagePath: "covers", acceptedFiles: ["image/*"] }
        }
    },
    admin: {
        defaultViewMode: "cards"
    }
});

```

## Prochaines étapes

- **[Vues d'entités](/docs/frontend/entity-views)** — Onglets personnalisés sur les formulaires d'entités
- **[Actions d'entités](/docs/frontend/entity-actions)** — Actions d'entités personnalisées

---
