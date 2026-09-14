---
sourceHash: 3830846c0457a79f
title: Disposition du formulaire
sidebar_label: Disposition du formulaire
description: Contrôlez la disposition du formulaire d'entité — largeurs de colonnes, sections et rail de métadonnées.
---

## Vue d'ensemble

Le formulaire d'entité est généré à partir de vos propriétés. Par défaut, il déduit une disposition sur deux colonnes d'après les types de propriétés, de sorte qu'une collection qui ne spécifie rien au sujet de la disposition obtient tout de même un formulaire lisible plutôt qu'une longue suite de champs occupant toute la largeur :

- l'id et les horodatages `createdAt` / `updatedAt` sont placés dans un rail de métadonnées, en lecture seule
- les énumérations courtes, les booléens, les dates et les nombres occupent une largeur réduite
- le texte long, le markdown, les tableaux, les maps et les champs de stockage prennent toute la largeur
- tout le reste occupe la moitié

Utilisez `admin.form` lorsque le comportement déduit ne convient pas à votre domaine.

## Largeur de champ

La largeur d'un champ est un **span** sur une grille de quatre colonnes. `4` correspond à la pleine largeur de la colonne principale.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

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

Les spans s'alignent sur une grille partagée, ce qui permet à deux champs de s'aligner quel que soit l'ordre dans lequel ils ont été déclarés. Ils remplacent `admin.widthPercentage`, dont les pourcentages bruts ne pouvaient s'aligner sur rien ; une collection qui en utilise encore devrait choisir le span le plus proche (≤30 → `1`, ≤55 → `2`, ≤80 → `3`, sinon `4`).

Sur les mises en page trop étroites pour deux colonnes — le panneau latéral, le volet partagé, un téléphone — la grille se réduit à une seule colonne et les spans sont ignorés.

## Sections

`sections` regroupe la colonne principale sous des en-têtes. Une section dotée d'un titre peut être repliée ; une section sans titre ne le peut pas.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

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

Une propriété qui n'apparaît dans aucune section n'est jamais supprimée : elle atterrit dans la dernière section sans titre, ou dans un groupe final sans titre s'il n'en existe aucune. L'ajout d'une colonne à la base de données ne peut donc pas faire disparaître discrètement un champ du formulaire.

Une erreur de validation au sein d'une section repliée provoque son déploiement, de sorte qu'une erreur ne puisse jamais rester masquée derrière un en-tête fermé.

## Le rail de métadonnées

`sidebar` déplace les champs hors de la colonne principale vers un rail étroit situé à côté — statut, propriétaire, dates de publication, indicateurs.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const postsCollection = defineCollection({
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        title: { name: "Title", type: "string" },
        body: { name: "Body", type: "string", admin: { markdown: true } },
        status: { name: "Status", type: "string" },
        publishedAt: { name: "Published at", type: "date" },
        author: { name: "Author", type: "string" }
    },
    admin: {
        form: {
            sidebar: ["status", "publishedAt", "author"],
            showRecordMeta: true
        }
    }
});
```

Le rail n'utilise pas la grille, donc `span` est ignoré pour les champs qui y figurent. Lorsqu'il n'y a pas assez d'espace pour un rail, il s'affiche comme une section initiale ordinaire, de sorte que rien n'est perdu sur un téléphone ou dans le panneau latéral.

`showRecordMeta` place le bloc d'enregistrement en lecture seule — id, créé, mis à jour — au bas du rail. Sa valeur par défaut est `true` dès qu'un rail est affiché, et il remplace `hideIdFromForm` pour la plupart des collections : l'id cesse d'être un champ au milieu du formulaire pour devenir une ligne de métadonnées que l'on peut copier.

Définissez `sidebar: []` pour supprimer complètement le rail déduit et conserver tous les champs dans la colonne principale.

## Référence

| Propriété | Type | Description |
|-----------|------|-------------|
| `admin.span` | `1 \| 2 \| 3 \| 4` | Largeur du champ sur la grille de formulaire à quatre colonnes |
| `admin.form.sidebar` | `string[]` | Clés des propriétés affichées dans le rail de métadonnées |
| `admin.form.sections` | `FormSection[]` | Groupes avec titre pour la colonne principale |
| `admin.form.showRecordMeta` | `boolean` | Afficher id/créé/mis à jour au bas du rail |

`FormSection` correspond à `{ key, title?, properties, collapsed?, collapsible? }`.

## Voir aussi

- [Custom Fields](/docs/frontend/custom-fields/) — le champ qu'une disposition organise
- [Entity Views](/docs/frontend/entity-views/) — un onglet personnalisé complet à côté du formulaire
- [Properties](/docs/collections/properties/) — les options de propriété lues par une disposition
