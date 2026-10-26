---
sourceHash: 29363c3f0ab50d98
title: Disposition du formulaire
sidebar_label: Disposition du formulaire
description: Contrôlez l'agencement du formulaire d'entité — largeurs de colonnes, sections et rail de métadonnées.
---

## Vue d'ensemble

<span class="since-badge" data-since="0.26">Depuis 0.26</span>

Le formulaire d'entité est généré à partir de vos propriétés :

- l'identifiant (id) et les horodatages `createdAt` / `updatedAt` sont placés dans un rail de métadonnées, en lecture seule
- tous les autres champs occupent la pleine largeur de la colonne principale, sauf si deux champs adjacents partagent le même type de petit éditeur — deux nombres, deux interrupteurs, deux dates avec le même mode, deux sélecteurs aux options courtes — auquel cas ils partagent une même ligne

Un champ doté d'un libellé long, d'un texte d'aide de plus de 60 caractères, de `conditions`, d'une règle `access` au niveau du champ ou de `excludeFromApi` (le formulaire n'affiche rien pour un utilisateur qui n'a pas le droit de le lire), ou d'un composant `Field` personnalisé n'est jamais combiné avec un autre, de même que les chaînes de texte libre : rien dans un schéma ne permet de différencier un nom de branche court d'une longue URL. Le formulaire ne cherche jamais à savoir quelle propriété correspond au titre. Toutes les autres colonnes doivent être explicitement demandées par la collection, champ par champ, via `admin.span` — déterminé en fonction du contenu de chaque champ, comme indiqué ci-dessous. Utilisez `admin.form` pour regrouper les champs en sections et les déplacer vers le rail.

## Largeur des champs

La largeur d'un champ est un **span** défini sur une grille de quatre colonnes. La valeur `4` correspond à la pleine largeur de la colonne principale.

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

Les largeurs (spans) s'alignent sur une grille commune, ce qui permet à deux champs de s'aligner quel que soit l'ordre dans lequel ils ont été déclarés. Ils remplacent `admin.widthPercentage`, dont les pourcentages bruts ne s'alignaient sur rien ; une collection utilisant encore cette propriété devrait adopter le span le plus proche (≤30 → `1`, ≤55 → `2`, ≤80 → `3`, sinon `4`).

Déterminez un span en fonction du contenu du champ, et non de son type. Deux valeurs courtes associées se partagent une ligne — date de début et de fin, ville et pays, fournisseur et région avec un span de `2` chacun, ou une valeur et son qualificatif avec `3` + `1`. Les nombres, les booléens et les codes courts peuvent occuper `1` colonne à côté d'autres champs similaires. Tout élément plus long à la lecture — noms, URLs, e-mails, identifiants, descriptions, markdown, fichiers — conserve `4`. Les lignes se remplissent dans l'ordre de déclaration et rien n'élargit automatiquement un champ pour combler un vide ; déclarez donc les paires côte à côte et veillez à ce que le total de chaque ligne atteigne 4.

Sur les écrans trop étroits pour afficher deux colonnes — le volet latéral, le volet scindé, un smartphone — la grille se réduit à une seule colonne et les spans sont ignorés.

## Sections

`sections` permet de regrouper les éléments de la colonne principale sous des titres. Une section pourvue d'un titre peut être repliée ; une section sans titre ne peut pas l'être.

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

Une propriété qui n'est listée dans aucune section n'est jamais supprimée : elle est placée dans la dernière section sans titre, ou dans un groupe final sans titre s'il n'en existe aucune. Ainsi, l'ajout d'une colonne dans la base de données ne peut pas faire disparaître silencieusement un champ du formulaire.

Une erreur de validation survenant à l'intérieur d'une section repliée entraîne son ouverture, garantissant ainsi qu'aucune erreur ne reste dissimulée derrière un volet fermé.

## Le rail de métadonnées

`sidebar` permet d'extraire des champs de la colonne principale pour les placer dans un rail étroit à côté — statut, propriétaire, dates de publication, indicateurs.

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

Le rail n'utilise pas la grille ; `span` est donc ignoré pour les champs qu'il contient. Lorsqu'il n'y a pas assez d'espace pour afficher un rail, il s'affiche sous forme d'une section d'en-tête ordinaire, évitant ainsi toute perte d'information sur smartphone ou dans le volet latéral.

`showRecordMeta` place le bloc d'enregistrement en lecture seule — id, date de création, date de mise à jour — au bas du rail. Sa valeur par défaut est `true` dès lors qu'un rail est présent, et il remplace `hideIdFromForm` pour la plupart des collections : l'id n'est plus un champ au milieu du formulaire, mais devient une ligne de métadonnées que l'on peut copier.

Définissez `sidebar: []` pour désactiver complètement le rail généré et conserver l'intégralité des champs dans la colonne principale.

## Référence

<span class="since-badge" data-since="0.26">Depuis 0.26</span>

| Propriété | Type | Description |
|-----------|------|-------------|
| `admin.span` | `1 \| 2 \| 3 \| 4` | Largeur du champ sur la grille de formulaire à quatre colonnes |
| `admin.form.sidebar` | `string[]` | Clés des propriétés affichées dans le rail de métadonnées |
| `admin.form.sections` | `FormSection[]` | Groupes avec titre pour la colonne principale |
| `admin.form.showRecordMeta` | `boolean` | Affiche id/créé/mis à jour au bas du rail |

`FormSection` correspond à `{ key, title?, properties, collapsed?, collapsible?, readVariant? }`. `readVariant: "summary"` empile les champs de la section sous forme de lignes libellé/valeur dans la vue en lecture seule de l'enregistrement ; la valeur par défaut, `"grid"`, utilise la grille du formulaire.

## Liens associés

- [Custom Fields](/docs/frontend/custom-fields/) — les champs agencés par la disposition
- [Entity Views](/docs/frontend/entity-views/) — un onglet personnalisé dédié à côté du formulaire
- [Properties](/docs/collections/properties/) — les options de propriétés lues par la disposition
