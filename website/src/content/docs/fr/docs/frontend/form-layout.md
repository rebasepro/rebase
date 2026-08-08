---
title: Disposition du formulaire
sidebar_label: Disposition du formulaire
description: Contrôlez l'agencement du formulaire d'entité — largeur de colonnes, sections et volet de métadonnées.
---

## Aperçu

Le formulaire d'entité est généré à partir de vos propriétés. Par défaut, il déduit une disposition sur deux colonnes basée sur les types de propriétés, de sorte qu'une collection qui ne spécifie aucune disposition obtient tout de même un formulaire lisible plutôt qu'une longue suite de champs occupant toute la largeur :

- l'id et les horodatages `createdAt` / `updatedAt` vont dans un volet de métadonnées, en lecture seule
- les énumérations courtes, les booléens, les dates et les nombres occupent une largeur étroite
- le texte long, le markdown, les tableaux, les cartes (maps) et les champs de stockage prennent toute la largeur
- tout le reste prend la moitié

Utilisez `admin.form` lorsque le résultat déduit ne convient pas à votre domaine.

## Largeur des champs

La largeur d'un champ est une **étendue** (span) sur une grille de quatre colonnes. `4` correspond à la largeur totale de la colonne principale.

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: {
        sku: {
            name: "SKU",
            type: "string",
            admin: { span: 1 }
        },
        name: {
            name: "Product name",
            type: "string",
            admin: { span: 3 }
        },
        description: {
            name: "Description",
            type: "string",
            admin: { markdown: true, span: 4 }
        }
    }
});
```

Les étendues s'alignent sur une grille partagée, ce qui permet à deux champs de s'aligner quel que soit leur ordre de déclaration. Elles remplacent `admin.widthPercentage`, dont les pourcentages bruts ne pouvaient s'aligner sur rien ; une collection qui l'utilise encore doit choisir l'étendue la plus proche (≤30 → `1`, ≤55 → `2`, ≤80 → `3`, sinon `4`).

Sur les dispositions trop étroites pour deux colonnes — le panneau latéral, le volet divisé, un téléphone — la grille se réduit à une seule colonne et les étendues sont ignorées.

## Sections

`sections` regroupe la colonne principale sous des en-têtes. Une section intitulée peut être repliée ; une section sans titre ne le peut pas.

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const ordersCollection = defineCollection({
    slug: "orders",
    table: "orders",
    name: "Orders",
    properties: {
        reference: { name: "Reference", type: "string" },
        placed_at: { name: "Placed at", type: "date" },
        address: { name: "Address", type: "string" },
        carrier: { name: "Carrier", type: "string" },
        tracking_number: { name: "Tracking number", type: "string" },
        notes: { name: "Notes", type: "string" }
    },
    admin: {
        form: {
            sections: [
                { key: "identity", properties: ["reference", "placed_at"] },
                {
                    key: "shipping",
                    title: "Shipping",
                    properties: ["address", "carrier", "tracking_number"]
                },
                {
                    key: "internal",
                    title: "Internal notes",
                    properties: ["notes"],
                    collapsed: true
                }
            ]
        }
    }
});
```

Une propriété qu'aucune section ne nomme n'est jamais ignorée : elle atterrit dans la dernière section sans titre, ou dans un groupe final sans titre s'il n'y en a aucune. L'ajout d'une colonne à la base de données ne peut donc pas faire disparaître silencieusement un champ du formulaire.

Une erreur de validation à l'intérieur d'une section repliée la développe, de sorte qu'une erreur ne peut jamais se cacher derrière un en-tête fermé.

## Le volet de métadonnées

`sidebar` déplace les champs hors de la colonne principale vers un volet étroit à côté d'elle — statut, propriété, dates de publication, indicateurs (flags).

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const postsCollection = defineCollection({
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        title: { name: "Title", type: "string" },
        body: { name: "Body", type: "string", admin: { markdown: true } },
        status: { name: "Status", type: "string" },
        published_at: { name: "Published at", type: "date" },
        author: { name: "Author", type: "string" }
    },
    admin: {
        form: {
            sidebar: ["status", "published_at", "author"],
            showRecordMeta: true
        }
    }
});
```

Le volet n'utilise pas la grille, donc `span` est ignoré pour les champs qu'il contient. S'il n'y a pas assez de place pour un volet, il s'affiche comme une section initiale ordinaire, de sorte que rien ne soit perdu sur un téléphone ou dans le panneau latéral.

`showRecordMeta` place le bloc d'enregistrement en lecture seule — id, créé le, mis à jour le — au bas du volet. Il vaut `true` par défaut dès qu'un volet est affiché, et c'est ce qui remplace `hideIdFromForm` pour la plupart des collections : l'id cesse d'être un champ au milieu du formulaire et devient une ligne de métadonnées qu'on peut copier.

Définissez `sidebar: []` pour supprimer entièrement le volet déduit et conserver tous les champs dans la colonne principale.

## Référence

| Propriété | Type | Description |
|----------|------|-------------|
| `admin.span` | `1 \| 2 \| 3 \| 4` | Largeur du champ sur la grille de formulaire à quatre colonnes |
| `admin.form.sidebar` | `string[]` | Clés de propriétés affichées dans le volet de métadonnées |
| `admin.form.sections` | `FormSection[]` | Groupes intitulés pour la colonne principale |
| `admin.form.showRecordMeta` | `boolean` | Afficher id/created/updated au bas du volet |

`FormSection` est `{ key, title?, properties, collapsed?, collapsible? }`.
