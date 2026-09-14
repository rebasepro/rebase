---
sourceHash: 8bade8e09da44b98
title: Collections
sidebar_label: Collections
description: Les collections sont la brique de base de Rebase — chaque collection correspond à une table de base de données et définit son schéma, ses relations, sa sécurité et son comportement d'interface utilisateur.
---

## Qu'est-ce qu'une collection ?

Une **collection** est un objet TypeScript qui décrit une table de base de données et la façon dont elle doit apparaître dans Rebase CMS. Elle définit :

- **Schéma** — Propriétés (colonnes), leurs types et règles de validation
- **Relations** — Clés étrangères, tables de jonction et chemins de jointure
- **Sécurité** — Politiques de sécurité au niveau des lignes (Row Level Security)
- **Hooks de cycle de vie** — Fonctions de rappel (callbacks) pour les opérations de création, mise à jour et suppression
- **Comportement du CMS** — Modes d'affichage, édition en ligne, vues d'entités, actions — le tout sous `admin`

## En déclarer une : `defineCollection`

Enveloppez le littéral dans `defineCollection`. À l'exécution, il s'agit d'une fonction d'identité — elle renvoie l'objet sans le modifier — son coût est donc nul. Son avantage réside dans l'inférence : un paramètre de type `const` capture les clés de vos `properties` en tant que types littéraux, et les champs représentant des clés dans le bloc `admin` sont ensuite vérifiés par rapport à celles-ci. Un nom qui ne fait pas partie de vos propriétés entraîne une **erreur de compilation**, et pas seulement une suggestion manquante.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const products = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" },
        price: { name: "Price", type: "number" }
    },
    admin: {
        display: { title: "name" },  // completion: "name" | "price"
        sort: ["price", "asc"],      // completion on the first element
        propertiesOrder: ["name", "price"]
    }
});
```

```typescript
    admin: {
        display: { title: "nmae" }
        //                ~~~~~~ Type '"nmae"' is not assignable to type
        //                       'PropertyPath<…>'. Did you mean '"name"'?
    }
```

Les champs vérifiés sont `display`, `sort`, `propertiesOrder` et `listProperties`. Trois formes sont acceptées en plus d'une simple clé de propriété :

| Forme | Exemple | Notes |
| --- | --- | --- |
| Chemin pointé dans un `map` | `"profile.displayName"` | La **racine** doit être une vraie propriété ; le chemin sous-jacent n'est pas vérifié. |
| Colonne de sous-collection enfant | `"subcollection:orders"` | `propertiesOrder` / `listProperties` uniquement. |
| Une clé de `additionalFields` | `"score" as AdditionalFieldKey` | Nécessite le cast — voir ci-dessous. |

`AdditionalFieldDelegate.key` est une simple `string`, le système de types n'a donc aucun moyen de savoir quelles clés supplémentaires une collection déclare. Plutôt que de rouvrir ces champs à n'importe quelle chaîne, le cast rend l'exception explicite :

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Importez-le depuis `@rebasepro/cms-types` dans un projet qui comporte un panneau d'administration — c'est cette version qui vérifie également les types du bloc `admin`. Un projet BaaS headless, qui ne comporte aucun bloc admin, importe plutôt la même fonction depuis `@rebasepro/common`.

L'annotation directe du type fonctionne toujours et reste vérifiée :

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

mais une annotation ne fait que *valider la forme* — elle ne peut pas voir vos noms de propriétés, donc les champs de clés de `admin` se rabattent sur l'acceptation de n'importe quelle chaîne. Privilégiez `defineCollection` à moins que vous n'ayez besoin de nommer le type.

:::note
`buildCollection` et `buildProperty` n'existent plus. `buildCollection` est `defineCollection` sans l'inférence ; `buildProperty` enveloppait une propriété dans un type qu'elle avait déjà. Consultez le [journal des modifications](/docs/changelog) pour la migration en une ligne.
:::

## Anatomie : le contrat et le panneau

Un seul fichier, deux publics. Tout ce qui concerne la *base de données et l'API* se trouve au niveau racine ; tout ce que le *panneau d'administration* affiche se trouve dans `admin`.

```typescript
const posts = {
    // ── The backend reads these ──────────────────────────────
    slug: "posts",
    table: "posts",
    properties: { /* … */ },
    relations: [ /* … */ ],
    securityRules: [ /* … */ ],
    callbacks: { /* … */ },
    history: true,

    // ── The admin panel reads these ──────────────────────────
    admin: {
        icon: "FileText",
        listProperties: ["title", "status"],
        defaultViewMode: "table",
        entityViews: ["preview"]
    }
};
```

Cette séparation n'est pas cosmétique. C'est ce qui permet à Rebase d'être un backend autonome :

- Un projet **BaaS ou headless** n'écrit jamais de bloc `admin`. Ses collections — ou aucune collection, puisque le mode BaaS introspecte la base de données — décrivent les données et l'autorisation, rien d'autre. `@rebasepro/types` ne contient aucun code d'interface utilisateur, ainsi l'arbre de dépendances d'un projet headless reste réservé au serveur.
- Le **backend ne lit jamais l'intérieur du bloc**. Il est retiré avant qu'une collection ne soit sérialisée vers le point de terminaison du contrat ou dans un bundle de build, et il est exclu de la version de schéma — ainsi, modifier une icône n'invalide pas tous les SDK générés.

### Le bloc `admin` n'existe que si vous installez les types admin

`@rebasepro/types` ne déclare aucun champ `admin` — ni sur une collection, ni sur une propriété. Dans un projet BaaS, en écrire un constitue une **erreur de type**. `@rebasepro/cms-types` l'ajoute par fusion de déclarations (declaration merging), ainsi une seule ligne par projet suffit à l'activer :

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Après cela, les types de base standard intègrent un bloc entièrement typé — une coquille comme `icoon` est une erreur, et vous bénéficiez de l'autocomplétion :

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const posts = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string", admin: { multiline: true } }
    },
    admin: { icon: "FileText" }
});
```

<!-- docs-verify: ignore -->
Une augmentation s'applique à l'ensemble du *programme* TypeScript, et `config/` et `frontend/` sont des programmes distincts — c'est pourquoi la référence a sa place dans le package config. Il n'existe pas de type wrapper `AdminCollectionConfig` : une fois le champ fusionné, `CollectionConfig` constitue le type de rédaction principal.

:::note[Pourquoi un projet BaaS n'a aucun surcoût]
Un type de propriété dans une installation BaaS ne contient ni `Field`, ni `columnWidth`, ni `hideFromCollection` — ceux-ci résident dans `AdminPropertyOptions` au sein du package admin. Cette garantie est vérifiée de manière stricte : `e2e/baas-typecheck/src/admin_absent.ts` utilise `@ts-expect-error` sur `admin`, de sorte que le build échoue si jamais ce champ redevient modifiable dans le core.
:::

### Migration depuis une collection plate

Avant la version 0.11, ces champs se trouvaient au niveau racine. Pour les déplacer :

```bash
node scripts/codemod/collections-admin-block.mjs config/collections
```

L'outil signale tout ce qu'il ne peut pas déplacer en toute sécurité — notamment la présentation dans `relations[].overrides`, qui requiert `overrides: { admin: { … } }` manuellement.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

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
        createdAt: {
            type: "date",
            name: "Created At",
            autoValue: "on_create",
            admin: { readOnly: true }
        }
    },
    admin: {
        icon: "inventory_2"           // Material icon key
    }
});

```

## Propriétés clés

### Identification

| Propriété | Type | Description |
|----------|------|-------------|
| `slug` | `string` | **Requis.** Identifiant compatible URL. Utilisé dans l'URL de l'interface d'administration et le chemin de l'API REST (`/api/data/{slug}`). |
| `name` | `string` | **Requis.** Nom d'affichage (au pluriel). Affiché dans la navigation et les en-têtes de page. |
| `singularName` | `string` | Nom d'affichage pour une entité unique. Utilisé dans « Nouveau produit », « Modifier le produit », etc. |
| `description` | `string` | Une phrase décrivant le contenu de cette collection, affichée au-dessus de la liste. Markdown. |
| `table` | `string` | Nom de la table PostgreSQL. Vaut par défaut `toSnakeCase(slug)` — définissez-le uniquement pour dissocier l'URL de la table, par exemple une table `blog_posts` existante exposée sur `/posts`. |
| `admin.icon` | `string` | Un nom d'icône [Lucide](https://lucide.dev/icons), par exemple `"FileText"`, `"ShoppingCart"`. Un élément rendu fonctionne également, mais le nom survit à la sérialisation, c'est donc ce que l'éditeur de schéma réécrit. |

### Schéma

| Propriété | Type | Description |
|----------|------|-------------|
| `properties` | `Properties` | **Requis.** Correspondance clé de propriété → définition de propriété. Chaque clé devient une colonne de base de données. |
| `relations` | `Relation[]` | Relations SQL — clés étrangères, tables de jonction. Voir [Relations](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Politiques de sécurité au niveau des lignes (Row Level Security). Voir [Règles de sécurité](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Index Postgres nécessaires à cette table. Voir [Index](/docs/backend/indexes). |
| `search` | `SearchConfig` | Recherche plein texte classée sur les champs que vous nommez, y compris le contenu JSONB et les tableaux. Postgres uniquement. Voir [Recherche](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Marquer la collection comme collection d'authentification (gestion des utilisateurs, réinitialisation de mot de passe, etc.) |
| `schema` | `string` | Schéma Postgres dans lequel réside la table — `"public"`, `"rebase"`, `"auth"`. Vaut `"public"` par défaut. |
| `disableDefaultPolicies` | `boolean` | Supprimer les politiques de base injectées par le générateur — un SELECT admin/serveur, et sur une collection auth une lecture par soi-même plus un contrôle d'écriture réservé aux admins — et prendre l'entière responsabilité du RLS de cette collection. `false` par défaut. Voir [Règles de sécurité](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Transforme un `delete` en horodatage et masque les lignes horodatées de chaque lecture. `true` utilise `deletedAt` ; la forme objet permet de renommer le champ. La collection doit déclarer elle-même cette propriété `date`. Postgres uniquement — voir [Suppression réversible (Soft delete)](/docs/collections/soft-delete) |
| `strictWrites` | `boolean` | Rejette avec une erreur 400 toute écriture qui nomme un champ que cette collection ne déclare pas. `true` par défaut. Définissez-le à `false` uniquement lorsque la colonne existe réellement et n'est pas déclarée — renseignée par un déclencheur, ou introspectée plutôt que spécifiée. |

### Configuration de l'interface utilisateur (UI)

Tous les éléments suivants vont dans `admin`.

| Propriété | Type | Par défaut | Description |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Mode d'affichage par défaut |
| `enabledViews` | `ViewMode[]` | Les quatre | Modes d'affichage disponibles |
| `kanban` | `KanbanConfig` | — | Configuration Kanban (propriété de colonne). À toujours associer avec `orderProperty` — voir [Modes d'affichage](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Clé de la propriété de type **string** contenant la clé d'ordre de glisser-déposer. Requis pour un tableau Kanban fonctionnel |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | `"full_screen"` | Mode d'ouverture des entités pour modification |
| `sideDialogWidth` | `number \| string` | — | Largeur du panneau latéral (side dialog) |
| `inlineEditing` | `boolean` | `true` | Activer l'édition en ligne dans la vue feuille de calcul |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Hauteur de ligne par défaut dans le tableau |
| `pagination` | `boolean \| number` | `true` (50) | Activer la pagination et/ou définir la taille de la page |
| `listProperties` | `string[]` | — | Propriétés à afficher dans la vue en liste |
| `propertiesOrder` | `string[]` | — | Ordre des colonnes dans la vue tableau |
| `selectionEnabled` | `boolean` | `true` | Activer la sélection des lignes |
| `hideFromNavigation` | `boolean` | `false` | Masquer dans la navigation latérale |
| `defaultSelectedView` | `string \| function` | — | Vue ou sous-collection ouverte par défaut |

### Options des entités

Dans `admin`, à l'exception de `history`, qui est une fonctionnalité backend et reste au niveau racine.

| Propriété | Type | Par défaut | Description |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Sauvegarde automatique lors de la modification d'un champ |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Sauvegarde locale des modifications non enregistrées |
| `hideIdFromForm` | `boolean` | `false` | Masquer l'ID de l'entité dans le formulaire |
| `hideIdFromCollection` | `boolean` | `false` | Masquer la colonne ID dans le tableau |
| `includeJsonView` | `boolean` | `true` | Proposer les valeurs brutes dans l'inspecteur d'enregistrement |
| `history` | `boolean` | `false` | Suivre les modifications dans l'historique de l'entité |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Appliquer les valeurs par défaut à chaque enregistrement |
| `previewProperties` | `string[]` | — | Propriétés à afficher dans les aperçus de référence |
| `display` | `EntityDisplay` | — | Ce qui remplit chaque rôle d'affichage — voir [Affichage de l'entité](#affichage-de-lentité) |

### Avancé

Au niveau racine, car le backend les lit :

| Propriété | Type | Description |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Hooks de cycle de vie (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `childCollections` | `() => CollectionConfig[]` | Les collections imbriquées sous une entité de celle-ci. Rempli lors de la normalisation à partir de ce avec quoi le pilote les exprime — des `subcollections` Firestore, une relation `hasMany` Postgres — un pilote personnalisé est donc la seule raison de le définir manuellement |
| `dataSource` | `string` | Quelle source de données enregistrée soutient cette collection (par défaut : celle sans nom) |
| `engine` | `string` | Le moteur sous-jacent — `"postgres"`, `"firestore"`, `"mongodb"`. Résolu à partir de `dataSource` ; à définir uniquement pour surcharger |
| `databaseId` | `string` | Base de données ou schéma au sein du moteur |
| `metadata` | `Record<string, unknown>` | Tout ce dont votre propre code a besoin d'associer à une collection. Rebase ne le lit pas ; il survit sans modification à la sérialisation |
| `ownerId` | `string` | **Formulaire d'administration uniquement — non appliqué par l'API ou la base de données.** L'identifiant utilisateur que l'éditeur de collection attribue à une collection qu'il crée, et affiche à côté de son nom. Rien dans le traitement de la requête ne le consulte |

`subcollections` et `path` ne concernent que les configurations de **bases de données orientées documents** — `FirebaseCollectionConfig` et, pour `path`, `MongoDBCollectionConfig` :

| Propriété | Type | Description |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Firestore uniquement.** Collections imbriquées sous chaque document. Une collection Postgres exprime la même chose avec une [relation](/docs/collections/relations) `hasMany`, qui remplit `childCollections` |
| `path` | `string` | **Firestore et MongoDB uniquement.** Le chemin ou le nom de collection au niveau du moteur, lorsqu'il diffère du slug |

Et dans `admin`, car seul le panneau les affiche :

| Propriété | Type | Description |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Actions personnalisées sur les entités (archiver, publier, etc.) |
| `admin.Actions` | `React.ComponentType` | Composant d'actions de barre d'outils personnalisé |
| `admin.entityViews` | `EntityCustomView[]` | Onglets personnalisés dans la vue détaillée de l'entité |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Colonnes calculées/virtuelles |
| `admin.exportable` | `boolean \| ExportConfig` | Activer l'exportation de données |
| `admin.components` | `CollectionComponentOverrideMap` | Surcharges de composants d'interface utilisateur au niveau de la collection |

L'écriture de l'un de ces six éléments au niveau racine génère une erreur au démarrage, accompagnée d'un message indiquant la clé et son nouvel emplacement.

## Affichage de l'entité

Chaque surface qui affiche un enregistrement présente un sous-ensemble de six rôles : **title**, **subtitle**, **image**, **status**, **date** et **tags**. Une ligne de liste combine image + titre + sous-titre + statut + date, une carte est identique avec l'image au-dessus, un sélecteur de référence affiche titre + sous-titre, et un en-tête de page se limite au titre seul.

Chaque rôle est dérivé de vos propriétés, et chacun peut également être spécifié — sous la forme d'un chemin de propriété ou d'une fonction :

```typescript
const exercises = defineCollection({
    name: "Exercises",
    slug: "exercises",
    table: "exercises",
    properties: {
        name: { name: "Name", type: "string" },
        cover: { name: "Cover", type: "string", storage: { storagePath: "covers/" } },
        city: { name: "City", type: "string" }
    },
    admin: {
        display: {
            title: "name",                                  // a property path
            image: "cover",
            subtitle: ({ entity }) => `in ${entity.values.city}`   // computed
        }
    }
});
```

Tout ce que vous omettez conserve sa valeur dérivée ; spécifier un rôle n'implique donc pas de spécifier les six.

### Rôles calculés et asynchrones

Un résolveur peut être `async`, ce qui permet à un rôle de lire une information que l'enregistrement ne contient pas directement — un document dans une sous-collection, une valeur issue d'une API :

```typescript
admin: {
    display: {
        // The exercise's name lives one document down, per locale.
        title: async ({ entity, context }) => {
            const locale = await context.data.exercise_locales.get(`${entity.id}/de-DE`);
            return locale?.exercise_title;
        }
    }
}
```

Pendant que la promesse est en cours, la surface affiche la valeur dérivée et la remplace par la valeur résolue dès qu'elle est disponible — un titre n'affiche jamais d'indicateur de chargement. Les résultats sont mis en cache par enregistrement et par rôle, et les requêtes simultanées pour une même paire partagent un seul appel, de sorte qu'une liste de cinquante lignes ne résout chaque ligne qu'une seule fois plutôt qu'à chaque rendu.

Renvoyez `undefined` lorsqu'un enregistrement n'a rien pour ce rôle ; la solution de repli (fallback) propre à la surface est mieux informée de ce qui doit y figurer à la place (un titre de section utilise le nom singulier de la collection, un lien utilise l'id). Un résolveur qui lève une exception est traité comme `undefined` et consigné dans les logs une seule fois — un titre qui ne peut pas être récupéré ne doit pas faire planter la ligne qui l'affiche.

Privilégiez un chemin chaque fois que la valeur se trouve sur l'enregistrement : un chemin conserve le rendu propre à la propriété, ainsi un statut énuméré reste un badge coloré et une date reste formatée, ce qu'un résolveur renvoyant une simple chaîne ne peut pas reproduire.

:::note[Remplacement de `titleProperty`]
`admin.titleProperty` a été supprimé au profit de `admin.display.title`. La même chaîne de caractères fonctionne ici, et le nouveau champ accepte également un résolveur. Une collection qui utilise encore l'ancienne clé est rejetée par `defineCollection` avec l'erreur habituelle de clé inconnue.
:::

### Sélection de la propriété de titre
Lorsque `display.title` n'est pas défini, la propriété utilisée comme titre d'affichage de l'entité (aperçus, en-têtes) est résolue automatiquement :
1. Si `propertiesOrder` est explicitement défini, la première propriété non-ID qui est de type `relation` ou `string` est choisie comme titre.
2. Si aucun `propertiesOrder` n'est défini, le framework parcourt les propriétés dans l'ordre et sélectionne la première propriété de type string.

### Aperçus des relations dans les tableaux
Lorsque `propertiesOrder` est explicitement défini, les propriétés de relation ne sont **pas** automatiquement filtrées des colonnes d'aperçu par défaut (alors qu'elles sont exclues des valeurs par défaut non ordonnées pour éviter des opérations de jointure lentes).

### Rendu de la valeur du titre
Quel que soit le contenu de la propriété de titre, le panneau affiche une chaîne de caractères. Une date est formatée, un tableau est joint, et pour une relation — qui arrive sous la forme `{ id, data: { values } }` plutôt que sous forme de texte — le panneau recherche le premier champ parmi `name`, `title`, `label` ou `displayName` sur la ligne liée, en se rabattant sur son id à défaut. Ainsi, un titre peut désigner une propriété de type `relation` tout en s'affichant sous la forme d'un nom plutôt que d'un uuid.

Il ne s'agit pas d'un helper exporté : c'est le comportement standard de chaque surface affichant un enregistrement. Rien à appeler, et rien à importer.

## Générateur de collections (Collection Builder)

Pour les collections dynamiques qui changent en fonction de l'utilisateur ou de données externes, utilisez une fonction builder :

```typescript
const collectionsBuilder: CollectionConfigsBuilder = ({ user, authController }) => {
    const collections = [productsCollection];

    // `extra` is whatever your auth provider put there, so name its shape here.
    const extra = authController.extra as { role?: string };
    if (extra.role === "admin") {
        collections.push(adminSettingsCollection);
    }

    return collections;
};
```

## Filtrage et tri

Vous pouvez définir des filtres par défaut ou forcés. Tous trois relèvent de la présentation — ce avec quoi le panneau s'ouvre — ils résident donc dans `admin` :

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const invoices = defineCollection({
    slug: "invoices",
    name: "Invoices",
    table: "invoices",
    properties: {
        active: { name: "Active", type: "boolean" },
        tenantId: { name: "Tenant", type: "string" },
        createdAt: { name: "Created", type: "date" }
    },
    admin: {
        // Default filter — users can change it
        defaultFilter: { active: ["==", true] },

        // Fixed filter — cannot be changed
        fixedFilter: { tenantId: ["==", currentTenantId] },

        // Default sort
        sort: ["createdAt", "desc"]
    }
});
```

Un `fixedFilter` restreint ce que le panneau *demande* ; ce n'est pas une barrière de sécurité. Ce qu'un appelant est autorisé à lire est régi par une [règle de sécurité](/docs/collections/security-rules), que la base de données applique à chaque appelant, qu'il s'agisse du panneau ou non.

## Prochaines étapes

- **[Callbacks d'entités](/docs/collections/callbacks)** — Hooks de cycle de vie pour la synchronisation de données entre collections, validation, effets de bord
- **[Propriétés](/docs/collections/properties)** — Tous les types de propriétés et options
- **[Relations](/docs/collections/relations)** — Clés étrangères, tables de jonction, jointures
- **[Règles de sécurité](/docs/collections/security-rules)** — Sécurité au niveau des lignes (Row Level Security)
- **[Modes d'affichage](/docs/frontend/view-modes)** — Liste, Tableau, Cartes, Kanban
