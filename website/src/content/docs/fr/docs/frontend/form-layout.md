---
sourceHash: 93694433369991ae
title: Disposition du formulaire
sidebar_label: Disposition du formulaire
description: "Organisez le formulaire d'un enregistrement : largeurs de champs sur une grille à quatre colonnes, sections titrées et repliables, rail de métadonnées et composant remplaçant le formulaire généré."
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Le formulaire d'enregistrement est généré à partir des colonnes et des relations de la table :

- l'identifiant ainsi que les horodatages de création et de mise à jour sont placés dans un rail de métadonnées en lecture seule ;
- tous les autres champs occupent toute la largeur de la colonne principale, sauf si deux champs voisins disposent du même petit éditeur (deux nombres, deux interrupteurs, deux dates du même mode, deux sélecteurs avec des options courtes), auquel cas ils partagent une même ligne.

Un champ ayant un libellé long, un texte d'aide de plus de 60 caractères, des `conditions`, une [règle d'accès](/docs/collections/field-access/) au niveau de la colonne ou un `Field` personnalisé n'est jamais combiné avec un autre, de même qu'aucun texte libre : rien dans un schéma ne permet de distinguer un nom de branche court d'une URL longue. Tout le reste se configure dans `customizeTable`, champ par champ avec `span`, et pour l'ensemble du formulaire avec `form`.

```ts
// backend/schema/orders.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id:             col.uuid().primaryKey().defaultRandom(),
        reference:      col.text().notNull(),
        sku:            col.text(),
        status:         col.enum(["placed", "shipped", "delivered"]).notNull().default("placed"),
        placedAt:       col.timestamp({ withTimezone: true }),
        address:        col.text(),
        carrier:        col.text(),
        trackingNumber: col.text(),
        notes:          col.text(),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/orders.tsx
import { customizeTable } from "@rebasepro/cms";
import type { orders } from "../../../backend/schema/orders";

export const ordersCms = customizeTable<typeof orders>("orders", {
    form: {
        sidebar: ["status", "placedAt"],
        sections: [
            { key: "identity", fields: ["reference", "sku"] },
            { key: "shipping", title: "Shipping", fields: ["address", "carrier", "trackingNumber"] },
            { key: "internal", title: "Internal notes", fields: ["notes"], collapsed: true },
        ],
    },
    fields: {
        reference: { span: 3 },
        sku:       { name: "SKU", span: 1 },
        carrier:   { span: 2 },
        trackingNumber: { span: 2 },
        notes:     { multiline: true },
    },
});
```

## Largeur des champs

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

La largeur d'un champ est définie par un **span** sur une grille à quatre colonnes ; `4` représente la pleine largeur de la colonne principale. Les spans s'alignent automatiquement sur la grille, ce qui permet à deux champs de s'aligner quel que soit l'ordre dans lequel ils ont été déclarés.

Choisissez un span en fonction de ce que contient le champ, et non de son type. Deux valeurs courtes qui vont ensemble partagent une ligne : date de début et de fin, ville et pays, transporteur et numéro de suivi à `2` chacun, ou une valeur et son qualificatif à `3` + `1`. Les nombres, les booléens et les codes courts peuvent occuper `1` à côté de leurs semblables. Tout ce qui est long à lire (noms, URL, e-mails, identifiants, descriptions, markdown, fichiers) conserve `4`. Les lignes se remplissent dans l'ordre des champs et rien n'élargit un champ pour combler un espace vide ; placez donc les paires côte à côte et faites en sorte que chaque ligne totalise 4.

Sur les affichages trop étroits pour deux colonnes (le panneau latéral, le volet scindé, un smartphone), la grille se réduit à une seule colonne et les spans sont ignorés.

## Sections

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`form.sections` regroupe la colonne principale sous des titres. Chaque section est un objet `{ key, title?, fields, collapsed?, collapsible?, readVariant? }`. Une section avec un titre peut être repliée ; une section sans titre ne le peut pas. `readVariant: "summary"` empile les champs de la section sous forme de lignes de libellé et valeur dans la vue en lecture seule de l'enregistrement ; la valeur par défaut, `"grid"`, utilise la grille du formulaire.

Un champ mentionné dans aucune section n'est jamais ignoré : il se retrouve dans la dernière section sans titre, ou dans un groupe final sans titre s'il n'en existe aucune. L'ajout d'une colonne à la table ne peut pas faire disparaître silencieusement un champ du formulaire. Une erreur de validation dans une section repliée provoque son déploiement.

Chaque entrée est vérifiée par rapport à la table. Une entrée que le serveur ne transmet pas à cet appelant, parce qu'il n'a pas le droit de lire cette colonne, est ignorée.

## Le rail de métadonnées

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`form.sidebar` déplace les champs hors de la colonne principale vers un rail étroit situé à côté : statut, propriété, dates de publication, indicateurs. Le rail n'utilise pas la grille, donc `span` y est ignoré. Lorsqu'il n'y a pas assez de place pour un rail, il s'affiche comme une section de tête ordinaire.

`form.showRecordMeta` place le bloc d'enregistrement en lecture seule (id, created, updated) en bas du rail. Il vaut `true` dès qu'un rail est affiché. `sidebar: []` désactive le rail dérivé et conserve tous les champs dans la colonne principale. `hideIdFromForm` masque complètement l'identifiant du formulaire.

## Remplacer le formulaire

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`formView` remplace le formulaire généré par votre propre composant, importé par valeur. Il reçoit les mêmes `EntityCustomViewParams` qu'une [vue d'entité](/docs/frontend/entity-views/). `includeActions: true` conserve Enregistrer et Abandonner dans la barre de l'enregistrement tant qu'il est à l'écran.

```tsx
import React from "react";
import { customizeTable } from "@rebasepro/cms";
import type { EntityCustomViewParams } from "@rebasepro/cms-types";
import type { orders } from "../../../backend/schema/orders";

function OrderForm({ row, modifiedValues }: EntityCustomViewParams) {
    return <h2>{String(modifiedValues?.reference ?? row?.reference ?? "New order")}</h2>;
}

export const ordersCms = customizeTable<typeof orders>("orders", {
    formView: { Builder: OrderForm, includeActions: true },
});
```

Pour une modification plus ponctuelle, surchargez plutôt une partie du formulaire (`Entity.Form`, voir [Surcharges de composants](/docs/frontend/component-overrides/)), ou disposez vous-même certains champs avec `<RecordForm>` et `<FormField>` dans votre propre page (voir [Panneaux](/docs/frontend/panels/)).

## Autres options de formulaire

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| Option | Effet |
|---|---|
| `formAutoSave` | Sauvegarder au fur et à mesure que le visiteur saisit. |
| `alwaysApplyDefaultValues` | Remplir les champs vides d'un enregistrement stocké avec les valeurs par défaut déclarées lors de son ouverture. |
| `includeJsonView` | Ajouter un onglet présentant l'enregistrement au format JSON. |
| `localChangesBackup` | Conserver les modifications non enregistrées dans le stockage local : `"manual_apply"`, `"auto_apply"` ou `false`. |

## Voir aussi

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- [Champs personnalisés](/docs/frontend/custom-fields/) : les champs organisés par une disposition
- [Vues d'entités](/docs/frontend/entity-views/) : un onglet complet dédié à côté du formulaire
- [customizeTable](/docs/frontend/customize-table/#form) : les options de formulaire dans la référence
