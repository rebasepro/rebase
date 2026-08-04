---
title: Collections
sidebar_label: Collections
description: Les collections sont le bloc de construction fondamental de Rebase — chaque collection est mappée à une table de base de données et définit son schéma, ses relations, sa sécurité et son comportement d'interface utilisateur.
---

## Qu'est-ce qu'une collection ?

Une **collection** est un objet TypeScript qui décrit une table de base de données et la manière dont elle doit apparaître dans l'interface d'administration. Elle définit :

- **Schéma** — Propriétés (colonnes), leurs types et règles de validation
- **Relations** — Clés étrangères, tables de jonction et chemins de jointure
- **Sécurité** — Politiques de sécurité au niveau des lignes (Row Level Security)
- **Comportement de l'interface utilisateur** — Modes d'affichage, édition en ligne, vues d'entité, actions
- **Hooks de cycle de vie** — Fonctions de rappel pour les opérations de création, mise à jour, suppression

```typescript
import { defineCollection } from "@rebasepro/admin-types";

export const productsCollection = defineCollection({
    slug: "products",              // URL path and API endpoint
    name: "Products",              // Display name (plural)
    singularName: "Product",       // Display name (singular)
    table: "products",            // PostgreSQL table name

    properties: {
        name: {
            type: "string",
            name: "Product Name",
            validation: { required: true }
        },
        price: {
            type: "number",
            name: "Price",
            validation: { required: true, min: 0 }
        },
        category: {
            type: "string",
            name: "Category",
            enum: [
                { id: "electronics", label: "Electronics", color: "blue" },
                { id: "clothing", label: "Clothing", color: "pink" },
                { id: "books", label: "Books", color: "orange" }
            ]
        },
        description: {
            type: "string",
            name: "Description",
            admin: { multiline: true }
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        created_at: {
            type: "date",
            name: "Created At",
            autoValue: "on_create",
            readOnly: true
        }
    },
    admin: {
        icon: "inventory_2"           // Material icon key
    }
});

```

## En déclarer une : `defineCollection`

Enveloppez le littéral dans `defineCollection`. À l'exécution, c'est la fonction identité — elle renvoie l'objet inchangé — donc son coût est nul. Ce qu'elle apporte, c'est l'inférence : un paramètre de type `const` capture les clés de `properties` comme types littéraux, ce qui les fait apparaître dans la complétion de l'éditeur pour `admin.display`, `admin.sort` et `admin.propertiesOrder`.

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const products = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" },
        price: { name: "Price", type: "number" }
    },
    admin: {
        display: { title: "name" },   // complétion : "name" | "price"
        sort: ["price", "asc"]   // complétion sur le premier élément
    }
});
```

Importez-la depuis `@rebasepro/admin-types` dans un projet doté d'un panneau d'administration — c'est la copie qui vérifie aussi le bloc `admin`. Un projet BaaS headless, sans bloc `admin` ni React, importe la même fonction depuis `@rebasepro/common`.

Annoter le type directement fonctionne toujours et reste vérifié :

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const products: PostgresCollectionConfig = {
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" }
    }
};
```

Mais une annotation ne fait que *valider* l'objet — elle ne voit pas les noms de vos propriétés, vous n'avez donc aucune complétion. Préférez `defineCollection`, sauf si vous devez nommer le type.

:::note
`buildCollection` et `buildProperty` n'existent plus. `buildCollection` est `defineCollection` sans l'inférence ; `buildProperty` enveloppait une propriété dans un type qu'elle avait déjà. Voir le [changelog](/docs/changelog) pour la migration en une ligne.
:::

## Propriétés clés

### Identification

| Propriété | Type | Description |
|----------|------|-------------|
| `slug` | `string` | **Obligatoire.** Identifiant sécurisé pour les URL. Utilisé dans l'URL de l'interface d'administration et le chemin de l'API REST (`/api/data/{slug}`). |
| `name` | `string` | **Obligatoire.** Nom d'affichage (pluriel). Affiché dans la navigation et les en-têtes de page. |
| `singularName` | `string` | Nom d'affichage pour une entité unique. Utilisé dans "Nouveau Produit", "Modifier Produit", etc. |
| `table` | `string` | **Obligatoire.** Nom de la table PostgreSQL. S'il est différent du `slug`, il permet de découpler les URL des noms de table. |
| `admin.icon` | `string` | Clé d'icône Material Design. Voir [Google Fonts Icons](https://fonts.google.com/icons). |

### Schéma

| Propriété | Type | Description |
|----------|------|-------------|
| `properties` | `Properties` | **Obligatoire.** Mappage clé de propriété → définition de propriété. Chaque clé devient une colonne de base de données. |
| `relations` | `Relation[]` | Relations SQL — clés étrangères, tables de jonction. Voir [Relations](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Politiques de sécurité au niveau des lignes (Row Level Security). Voir [Règles de sécurité](/docs/collections/security-rules). |

### Configuration de l'interface utilisateur

Tous les champs suivants vont dans `admin`.

| Propriété | Type | Défaut | Description |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"table"` | Mode d'affichage par défaut |
| `enabledViews` | `ViewMode[]` | All four | Quels modes d'affichage sont disponibles |
| `kanban` | `KanbanConfig` | — | Configuration Kanban (propriété de colonne) |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split"` | `"full_screen"` | Comment les entités s'ouvrent pour l'édition |
| `sideDialogWidth` | `number \| string` | — | Largeur du dialogue latéral |
| `inlineEditing` | `boolean` | `true` | Activer l'édition en ligne dans la vue feuille de calcul |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Hauteur de ligne par défaut dans le tableau |
| `pagination` | `boolean \| number` | `true` (50) | Activer la pagination et/ou définir la taille de la page |
| `listProperties` | `string[]` | — | Propriétés à afficher dans la vue liste |
| `propertiesOrder` | `string[]` | — | Ordre des colonnes dans la vue tableau |
| `selectionEnabled` | `boolean` | `true` | Activer la sélection de lignes |
| `hideFromNavigation` | `boolean` | `false` | Masquer de la navigation latérale |
| `defaultSelectedView` | `string \| function` | — | Vue ou sous-collection par défaut à ouvrir |

### Options d'entité

Dans `admin`, sauf `history`, qui est une fonctionnalité du backend et reste au niveau supérieur.

| Propriété | Type | Défaut | Description |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Sauvegarde automatique lors de la modification d'un champ |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Sauvegarder les modifications non enregistrées |
| `hideIdFromForm` | `boolean` | `false` | Masquer l'ID de l'entité du formulaire |
| `hideIdFromCollection` | `boolean` | `false` | Masquer la colonne ID du tableau |
| `includeJsonView` | `boolean` | `true` | Proposer les valeurs brutes dans l'inspecteur de l'enregistrement |
| `history` | `boolean` | `false` | Suivre les modifications dans l'historique de l'entité |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Appliquer les valeurs par défaut à chaque sauvegarde |
| `previewProperties` | `string[]` | — | Propriétés à afficher dans les aperçus de référence |
| `display` | `EntityDisplay` | — | Ce qui remplit chaque rôle d'affichage — `title`, `subtitle`, `image`, `status`, `date`, `tags` |

### Avancé

| Propriété | Type | Description |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Hooks de cycle de vie (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `entityActions` | `EntityAction[]` | Actions personnalisées sur les entités (archiver, publier, etc.) |
| `Actions` | `React.ComponentType` | Composant d'actions de barre d'outils personnalisé |
| `entityViews` | `EntityCustomView[]` | Onglets personnalisés dans la vue détaillée de l'entité |
| `additionalFields` | `AdditionalFieldDelegate[]` | Colonnes calculées/virtuelles |
| `childCollections` | `() => CollectionConfig[]` | Collections enfants imbriquées |
| `subcollections` | `() => CollectionConfig[]` | Collections imbriquées (par exemple, commande → articles de ligne) |
| `exportable` | `boolean \| ExportConfig` | Activer l'exportation de données |
| `ownerId` | `string` | ID de l'utilisateur propriétaire (utilisé par les plugins/code personnalisé) |
| `overrides` | `EntityOverrides` | Surcharges pour la vue d'entité |
| `driver` | `string` | Pilote de base de données à utiliser (par défaut : `"(default)"`) |
| `databaseId` | `string` | ID de la base de données/schéma dans le pilote |

## Générateur de collections

Pour les collections dynamiques qui changent en fonction de l'utilisateur ou des données externes, utilisez une fonction de construction :

```typescript
const collectionsBuilder: CollectionConfigsBuilder = ({ user, authController }) => {
    const collections = [productsCollection];

    if (authController.extra?.role === "admin") {
        collections.push(adminSettingsCollection);
    }

    return collections;
};
```

## Filtrage et tri

Vous pouvez définir des filtres par défaut ou forcés :

```typescript
{
    // Filtre par défaut — les utilisateurs peuvent le modifier
    filter: { active: ["==", true] },

    // Filtre forcé — ne peut pas être modifié
    forceFilter: { tenant_id: ["==", currentTenantId] },

    // Tri par défaut
    sort: ["created_at", "desc"]
}
```

## Étapes suivantes

- **[Entity Callbacks](/docs/collections/callbacks)** — Hooks de cycle de vie pour la synchronisation des données entre collections, la validation, les effets secondaires
- **[Properties](/docs/collections/properties)** — Tous les types de propriétés et options
- **[Relations](/docs/collections/relations)** — Clés étrangères, tables de jonction, jointures
- **[Security Rules](/docs/collections/security-rules)** — Sécurité au niveau des lignes (Row Level Security)
- **[View Modes](/docs/frontend/view-modes)** — Liste, Tableau, Cartes, Kanban
---
