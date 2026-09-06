---
sourceHash: 2cf8f0e1f2cb33d7
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
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    properties: { /* … */ },
    name: "Products",
    table: "products",
    // ...
    admin: {
        defaultViewMode: "table",            // Default view
        enabledViews: ["list", "table", "kanban"],    // Available views
        orderProperty: "__order",           // Propriété pour le réordonnancement par glisser-déposer
        kanban: {
            columnProperty: "status"         // Enum property for columns
        }
    }
});

```

## Vue Liste

La vue liste est le mode d'affichage par défaut classique et épuré des CMS, présentant les entités sous forme de liste directe, sans la densité d'une feuille de calcul.

## Vue Tableau

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

Configurez un tableau Kanban en spécifiant la propriété d'énumération à utiliser comme colonnes :

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

Le glisser-déposer entre les colonnes met automatiquement à jour le champ d'énumération et l'ordre de tri.

### Ordonnancement

`kanban` et `orderProperty` sont deux moitiés d'une même fonctionnalité.
Déclarez toujours les deux — trois erreurs ici produisent un tableau qui *semble*
configuré et ne l'est pas.

**`orderProperty` n'est pas facultatif.** Sans lui, une carte se déplace toujours
d'une colonne à l'autre, car ce geste écrit `columnProperty`. Sa position *au
sein* d'une colonne n'a nulle part où être stockée : elle revient en place à la
lecture suivante, et le tableau affiche un bandeau ambre signalant que
l'ordonnancement n'est pas configuré.

**La propriété doit être une `string`.** Le réordonnancement écrit une clé
[fractional-indexing](https://github.com/rocicorp/fractional-indexing) — `"i0"`,
`"i1"`, `"i0i"` — et non un index. Une propriété `number` ne peut jamais la
contenir : un `sortOrder` numérique laisse le tableau réclamer indéfiniment son
initialisation, et cette initialisation échoue elle-même contre une colonne
numérique. Déclarez-la masquée : c'est de la mécanique, pas du contenu.

```typescript
__order: {
    type: "string",
    name: "Order",
    admin: { disabled: true, hideFromCollection: true }
}
```

**Les lignes créées hors de l'admin arrivent sans clé.** Rien n'en attribue à
l'insertion. Une ligne écrite par un cron, un script de seed, une migration ou
l'API REST arrive avec `__order` à null, et le tableau affiche *"Some items don't
have order values"* avec un bouton **Initialize** — un clic remplit la première
page, et la prochaine exécution du cron ramène le bandeau. Si un backend crée des
lignes pour un tableau, c'est à lui d'attribuer la clé, avec l'alphabet qu'utilise
l'admin :

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, minuscules. C'est Postgres qui trie, et sa collation par défaut n'est
// pas l'ordre des octets : omettre ce troisième argument produit des clés base62
// comme "a0" que le tableau rejette.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

const tasks = client.data.collection("tasks");

// La dernière clé utilisée. `is-not-null` n'est pas facultatif : un tri
// descendant est NULLS FIRST, donc sans lui on relit une des lignes justement
// dépourvues de clé et chaque insertion retombe sur le même "i0".
const { data: last } = await tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await tasks.create({
    title,
    status,
    __order: generateKeyBetween(last[0]?.__order ?? null, null, ORDER_KEY_DIGITS)
});
```

## Vue Cartes

Les cartes affichent les entités sous forme de cartes visuelles — utile pour le contenu riche en images :

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

- **[Vues d'entités](/docs/frontend/entity-views)** — Onglets personnalisés sur les formulaires d'entités
- **[Actions d'entités](/docs/frontend/entity-actions)** — Actions d'entités personnalisées

---
