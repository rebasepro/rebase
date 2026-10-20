---
sourceHash: 608b8f9f3290a362
title: Modes de vue
sidebar_label: Modes de vue
description: Configurez les vues en tableau, cartes et tableau Kanban pour vos collections.
---

## Vue d'ensemble

Chaque collection peut être affichée dans quatre modes de vue :

- **Liste** — Vue en liste simple et épurée (le choix classique par défaut des CMS)
- **Tableau** — Grille de type feuille de calcul avec édition en ligne, tri et filtrage
- **Cartes** — Grille de cartes pour le contenu visuel (images, aperçus)
- **Kanban** — Tableau avec glisser-déposer regroupé par une propriété d'énumération (enum)

Ce sont les modes intégrés. Une collection peut également proposer des modes de vue que vous écrivez vous-même — un calendrier, une carte, une galerie — dans le même sélecteur, pilotés par la même barre d'outils : consultez [Modes de vue personnalisés](/docs/frontend/extending#custom-view-modes) et la recette de calendrier dans [Personnalisation de l'administration](/docs/frontend/customizing).

## Configuration

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    // `orderProperty` and `kanban.columnProperty` are checked against these
    // keys — with an empty `properties` block they narrow to `never`.
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        status: { name: "Status", type: "string" },
        // The order key. A *string*, never a number — see "Ordering" below.
        __order: {
            name: "Order",
            type: "string",
            admin: { disabled: true, hideFromCollection: true }
        }
    },
    name: "Products",
    table: "products",
    admin: {
        defaultViewMode: "table",            // Default view
        enabledViews: ["list", "table", "kanban"],    // Available views
        orderProperty: "__order",           // Property for drag-and-drop ordering
        kanban: {
            columnProperty: "status"         // Enum property for columns
        }
    }
});

```

## Vue en liste

La vue en liste est le mode de vue par défaut classique et épuré d'un CMS, affichant les entités sous un format de liste simple, sans la densité d'une feuille de calcul.

## Vue en tableau

La vue en tableau est une feuille de calcul virtualisée haute performance offrant :

- **Édition en ligne** — Cliquez sur n'importe quelle cellule pour la modifier directement
- **Redimensionnement des colonnes** — Faites glisser les en-têtes de colonnes
- **Réorganisation des colonnes** — Faites glisser pour réorganiser
- **Tri** — Cliquez sur les en-têtes de colonnes
- **Recherche textuelle** — Recherche plein texte sur les champs de type chaîne
- **Filtrage** — Filtres par colonne
- **Sélection multiple** — Sélectionnez des entités pour effectuer des actions groupées

### Hauteur des lignes

Contrôlez la hauteur des lignes avec `defaultSize` :

| Taille | Pixels | Idéal pour |
|------|--------|----------|
| `"xs"` | 36 | Tableaux de données denses |
| `"s"` | 42 | Lignes de texte compactes |
| `"m"` | 48 | Par défaut |
| `"l"` | 96 | Miniatures d'images moyennes |
| `"xl"` | 160 | Grandes miniatures d'images |

## Vue Kanban

Configurez un tableau Kanban en spécifiant quelle propriété d'énumération (enum) utiliser pour les colonnes :

```typescript
import { defineCollection } from "@rebasepro/cms-types";
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
        __order: {
            type: "string",
            name: "Order",
            admin: { disabled: true, hideFromCollection: true }
        }
    },
    admin: {
        defaultViewMode: "kanban",
        orderProperty: "__order",
        kanban: {
            columnProperty: "status"
        }
    }
});

```

Le glisser-déposer entre les colonnes met automatiquement à jour le champ enum et l'ordre de tri.

### Ordonnancement

`kanban` et `orderProperty` sont les deux moitiés d'une même fonctionnalité. Déclarez les deux, systématiquement — trois erreurs courantes ici produisent un tableau qui semble configuré mais ne l'est pas.

**`orderProperty` n'est pas facultatif.** Sans cette propriété, une carte peut toujours être glissée d'une colonne à l'autre car cela écrit dans `columnProperty`. En revanche, sa position *au sein* d'une colonne ne peut être stockée nulle part ; elle se réinitialise donc à la lecture suivante, et le tableau affiche une barre orange indiquant que l'ordonnancement n'est pas configuré.

**La propriété doit être de type `string`.** Le réordonnancement écrit une clé [fractional-indexing](https://github.com/rocicorp/fractional-indexing) — `"i0"`, `"i1"`, `"i0i"` — et non un index numérique. Une propriété de type `number` ne pourra jamais la stocker : un `sortOrder` numérique fera donc en sorte que le tableau demande indéfiniment à être initialisé, et l'initialisation elle-même échouera sur une colonne numérique. Déclarez-la masquée ; il s'agit de plomberie interne, pas de contenu :

```typescript
__order: {
    type: "string",
    name: "Order",
    admin: { disabled: true, hideFromCollection: true }
}
```

**Les lignes créées en dehors de l'interface d'administration arrivent sans clé.** Rien n'en attribue une à l'insertion. Une ligne écrite par un cron, un script de seed, une migration ou l'API REST arrive avec `__order` à null, et le tableau affiche *"Some items don't have order values"* avec un bouton **Initialize** — un clic remplit la première page, puis la prochaine exécution du cron fait réapparaître la barre aussitôt. Si un backend crée des lignes pour un tableau, il doit lui-même attribuer la clé. Utilisez le même alphabet que celui utilisé par l'admin :

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, lower case. Postgres does the sorting and its default collation is
// not byte ordering, so the library's default base62 alphabet — which mixes
// cases — sorts differently in the database than in the key. Omitting this
// third argument produces keys like "a0" that the board rejects.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

const tasks = client.data.collection("tasks");

// The last key currently in use. `is-not-null` is not optional: a descending
// sort is NULLS FIRST, so without it this reads back one of the very rows that
// has no key and every insert lands on the same "i0".
const { data: last } = await tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await tasks.create({
    title,
    status,
    __order: generateKeyBetween(
        (last[0]?.__order as string | undefined) ?? null,
        null,
        ORDER_KEY_DIGITS
    )
});
```

Les lignes créées via le formulaire d'administration arrivent également sans clé — la seule différence est que vous voyez la barre dès que vous en ajoutez une. **Initialize** permet de corriger le problème dans ce cas ; en revanche, sur un tableau alimenté par un backend, c'est une solution temporaire qui s'annule à chaque exécution.

## Vue en cartes

Les cartes affichent les entités sous forme de cartes visuelles — très utile pour le contenu riche en images :

```typescript
import { defineCollection } from "@rebasepro/cms-types";
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

- **[Personnalisation de l'administration](/docs/frontend/customizing)** — Vos propres modes de vue, pages et actions
- **[Vues d'entités](/docs/frontend/entity-views)** — Onglets personnalisés sur les formulaires d'entité
- **[Actions sur les entités](/docs/frontend/entity-actions)** — Actions d'entité personnalisées
