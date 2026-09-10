---
sourceHash: 7bd4e27e22c6c53b
title: Collections
sidebar_label: Collections
description: Les collections sont l'élément de base de Rebase — chaque collection correspond à une table de base de données et définit son schéma, ses relations, sa sécurité et son comportement d'interface utilisateur.
---

## Qu'est-ce qu'une collection ?

Une **collection** est un objet TypeScript qui décrit une table de base de données et la façon dont elle doit apparaître dans l'interface d'administration. Elle définit :

- **Schéma** — Les propriétés (colonnes), leurs types et leurs règles de validation
- **Relations** — Les clés étrangères, les tables de jonction et les chemins de jointure
- **Sécurité** — Les politiques de sécurité au niveau des lignes (Row Level Security)
- **Hooks de cycle de vie** — Les callbacks pour les opérations de création, de mise à jour et de suppression
- **Comportement de l'interface d'administration** — Modes d'affichage, édition en ligne, vues d'entités, actions — le tout sous `admin`

## En déclarer une : `defineCollection`

Enveloppez le littéral dans `defineCollection`. Au moment de l'exécution, il s'agit de la fonction identité — elle
retourne l'objet sans le modifier — son coût est donc nul. Ce qu'elle apporte, c'est l'inférence : un paramètre
de type `const` capture les clés de vos `properties` sous forme de types littéraux, et les champs de clés
du bloc `admin` sont ensuite vérifiés par rapport à celles-ci. Un nom qui ne fait pas partie
de vos propriétés constitue une **erreur de compilation**, et pas seulement une suggestion manquante.

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

Les champs vérifiés sont `display`, `sort`, `propertiesOrder` et `listProperties`.
Trois formes sont acceptées en plus d'une simple clé de propriété :

| Forme | Exemple | Notes |
| --- | --- | --- |
| Chemin pointé dans un `map` | `"profile.displayName"` | La **racine** doit être une vraie propriété ; le chemin situé en dessous n'est pas vérifié. |
| Colonne de sous-collection enfant | `"subcollection:orders"` | `propertiesOrder` / `listProperties` uniquement. |
| Une clé d'`additionalFields` | `"score" as AdditionalFieldKey` | Nécessite le transtypage (cast) — voir ci-dessous. |

`AdditionalFieldDelegate.key` étant un simple `string`, le système de types n'a aucun moyen de savoir
quelles clés supplémentaires une collection déclare. Plutôt que de réouvrir ces champs à n'importe quelle chaîne de caractères,
le transtypage rend l'exception explicite :

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Importez-le depuis `@rebasepro/cms-types` dans un projet qui possède un panneau d'administration — c'est
la copie qui vérifie également les types du bloc `admin`. Un projet BaaS headless, qui n'a pas de
bloc d'administration, importe plutôt la même fonction depuis `@rebasepro/common`.

L'annotation directe du type fonctionne toujours et est toujours vérifiée :

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

mais une annotation ne fait que *valider la forme* — elle ne peut pas voir le nom de vos propriétés, de sorte que les
champs de clés `admin` se rabattent sur l'acceptation de n'importe quelle chaîne. Privilégiez `defineCollection`, sauf si vous
avez besoin de nommer le type.

:::note
`buildCollection` et `buildProperty` n'existent plus. `buildCollection` est
`defineCollection` sans l'inférence ; `buildProperty` encapsulait une propriété dans un type qu'elle
possédait déjà. Consultez le [journal des modifications (changelog)](/docs/changelog) pour la migration en une seule ligne.
:::

## Anatomie : le contrat et le panneau

Un seul fichier, deux publics. Tout ce qui concerne la *base de données et l'API* se trouve au
niveau racine ; tout ce que le *panneau d'administration* restitue se trouve dans `admin`.

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

Cette séparation n'est pas cosmétique. C'est ce qui permet à Rebase d'être un backend à part entière :

- Un projet **BaaS ou headless** n'écrit jamais de bloc `admin`. Ses collections — ou aucune
  collection, puisque le mode BaaS introspecte la base de données — décrivent les données et
  l'autorisation, rien d'autre. `@rebasepro/types` ne comporte aucun code d'interface utilisateur, de sorte que l'arbre de dépendances
  d'un projet headless reste strictement côté serveur.
- Le **backend ne lit jamais l'intérieur de ce bloc**. Il est retiré avant qu'une collection ne soit
  sérialisée vers le point de terminaison du contrat ou dans un bundle de build, et il est exclu de
  la version du schéma — ainsi, changer une icône n'indique pas chaque SDK généré comme
  obsolète.

### Le bloc `admin` n'existe que si vous installez les types d'administration

`@rebasepro/types` ne déclare aucun champ `admin` — ni sur une collection, ni sur une propriété. Dans
un projet BaaS, en écrire un est une **erreur de type**. `@rebasepro/cms-types` le rajoute par
fusion de déclarations (declaration merging), de sorte qu'une seule ligne par projet l'active :

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Après cela, les types du cœur standards portent un bloc entièrement typé — une faute de frappe comme `icoon` devient une erreur,
et vous bénéficiez de l'autocomplétion :

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
Une augmentation s'applique à l'ensemble du *programme* TypeScript, et `config/` et `frontend/`
sont des programmes distincts — c'est pourquoi la référence appartient au package de configuration. Il
n'y a pas de type conteneur `AdminCollectionConfig` : avec le champ fusionné, `CollectionConfig`
est le type d'écriture.

:::note[Pourquoi un projet BaaS ne paie aucun surcoût]
Un type de propriété dans une installation BaaS n'a ni `Field`, ni `columnWidth`, ni
`hideFromCollection` — ceux-ci résident dans `AdminPropertyOptions` dans le package d'administration. Cette
garantie est appliquée par assertion, et non par simple déclaration : `e2e/baas-typecheck/src/admin_absent.ts` utilise
`@ts-expect-error` sur `admin`, de sorte que le build échoue si le champ redevient un jour accessible en écriture dans
le cœur.
:::

### Migrer depuis une collection plate

Avant la version 0.11, ces champs se trouvaient au niveau racine. Pour les déplacer :

```bash
node scripts/codemod/collections-admin-block.mjs config/collections
```

La commande signale tout ce qu'elle ne peut pas déplacer en toute sécurité — notamment la présentation à l'intérieur
de `relations[].overrides`, qui nécessite `overrides: { admin: { … } }` manuellement.

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

## Propriétés principales

### Identification

| Propriété | Type | Description |
|-----------|------|-------------|
| `slug` | `string` | **Requis.** Identifiant compatible avec les URL. Utilisé dans l'URL de l'interface d'administration et le chemin de l'API REST (`/api/data/{slug}`). |
| `name` | `string` | **Requis.** Nom d'affichage (pluriel). Affiché dans la navigation et les en-têtes de page. |
| `singularName` | `string` | Nom d'affichage pour une entité unique. Utilisé dans « Nouveau produit », « Modifier le produit », etc. |
| `description` | `string` | Une phrase décrivant ce que contient cette collection, affichée au-dessus de la liste. Markdown. |
| `table` | `string` | Nom de la table PostgreSQL. Par défaut à `toSnakeCase(slug)` — définissez-le uniquement pour découpler l'URL de la table, par exemple une table `blog_posts` existante exposée sur `/posts`. |
| `admin.icon` | `string` | Un nom d'icône [Lucide](https://lucide.dev/icons), par ex. `"FileText"`, `"ShoppingCart"`. Un élément déjà rendu fonctionne également, mais le nom survit à la sérialisation, c'est donc ce que l'éditeur de schéma réécrit. |

### Schéma

| Propriété | Type | Description |
|-----------|------|-------------|
| `properties` | `Properties` | **Requis.** Mappage clé de propriété → définition de la propriété. Chaque clé devient une colonne de base de données. |
| `relations` | `Relation[]` | Relations SQL — clés étrangères, tables de jonction. Voir [Relations](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Politiques de sécurité au niveau des lignes (RLS). Voir [Règles de sécurité](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Index Postgres requis par cette table. Voir [Index](/docs/backend/indexes). |
| `search` | `SearchConfig` | Recherche en texte intégral classée sur les champs que vous nommez, y compris le contenu JSONB et de tableaux. Postgres uniquement. Voir [Recherche](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Marque la collection comme collection d'authentification (gestion des utilisateurs, réinitialisation du mot de passe, etc.) |
| `schema` | `string` | Schéma Postgres dans lequel réside la table — `"public"`, `"rebase"`, `"auth"`. La valeur par défaut est `"public"`. |
| `disableDefaultPolicies` | `boolean` | Supprime les politiques de base injectées par le générateur — un SELECT administrateur/serveur, et sur une collection d'authentification une lecture personnelle ainsi qu'une barrière d'écriture réservée aux administrateurs — et assume l'entière responsabilité de la RLS de cette collection. `false` par défaut. Voir [Règles de sécurité](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Transforme `delete` en horodatage et masque les lignes horodatées de toute lecture. `true` utilise `deletedAt` ; la forme objet renomme le champ. La collection doit déclarer elle-même cette propriété de type `date`. Postgres uniquement — voir [Suppression réversible](/docs/collections/soft-delete). |
| `strictWrites` | `boolean` | Rejette toute écriture mentionnant un champ non déclaré par cette collection avec une erreur 400. `true` par défaut. Définissez-le à `false` uniquement lorsque la colonne existe réellement mais n'est pas déclarée — remplie par un déclencheur (trigger), ou introspectée plutôt qu'explicitement écrite. |

### Configuration de l'interface utilisateur

Tous les éléments suivants vont à l'intérieur de `admin`.

| Propriété | Type | Par défaut | Description |
|-----------|------|------------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Mode d'affichage par défaut |
| `enabledViews` | `ViewMode[]` | Les quatre | Quels modes d'affichage sont activés |
| `kanban` | `KanbanConfig` | — | Configuration Kanban (propriété de colonne). Toujours associer à `orderProperty` — voir [Modes d'affichage](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Clé de la propriété **string** contenant la clé d'ordre pour le glisser-déposer. Requis pour un tableau Kanban opérationnel |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | `"full_screen"` | Manière dont les entités s'ouvrent pour l'édition |
| `sideDialogWidth` | `number \| string` | — | Largeur de la boîte de dialogue latérale |
| `inlineEditing` | `boolean` | `true` | Active l'édition en ligne dans la vue tableur |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Hauteur de ligne par défaut dans le tableau |
| `pagination` | `boolean \| number` | `true` (50) | Active la pagination et/ou définit la taille de page |
| `listProperties` | `string[]` | — | Propriétés à afficher dans la vue en liste |
| `propertiesOrder` | `string[]` | — | Ordre des colonnes dans la vue en tableau |
| `selectionEnabled` | `boolean` | `true` | Active la sélection de lignes |
| `hideFromNavigation` | `boolean` | `false` | Masque de la navigation dans la barre latérale |
| `defaultSelectedView` | `string \| function` | — | Vue par défaut ou sous-collection à ouvrir |

### Options d'entité

À l'intérieur de `admin`, à l'exception de `history`, qui est une fonctionnalité backend et reste au niveau racine.

| Propriété | Type | Par défaut | Description |
|-----------|------|------------|-------------|
| `formAutoSave` | `boolean` | `false` | Enregistrement automatique lors de la modification d'un champ |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Sauvegarde des modifications non enregistrées |
| `hideIdFromForm` | `boolean` | `false` | Masque l'identifiant de l'entité du formulaire |
| `hideIdFromCollection` | `boolean` | `false` | Masque la colonne d'identifiant du tableau |
| `includeJsonView` | `boolean` | `true` | Propose les valeurs brutes dans l'inspecteur d'enregistrements |
| `history` | `boolean` | `false` | Suit les modifications dans l'historique de l'entité |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Applique les valeurs par défaut à chaque sauvegarde |
| `previewProperties` | `string[]` | — | Propriétés à afficher dans les aperçus de référence |
| `display` | `EntityDisplay` | — | Ce qui remplit chaque rôle d'affichage — voir [Affichage d'entité](#entity-display) |

### Avancé

Au niveau racine, car le backend les lit :

| Propriété | Type | Description |
|-----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Hooks de cycle de vie (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `childCollections` | `() => CollectionConfig[]` | Les collections imbriquées sous une entité de celle-ci. Renseigné pendant la normalisation à partir de ce avec quoi le pilote les exprime — un `subcollections` de Firestore, une relation `hasMany` de Postgres — un pilote personnalisé est donc la seule raison de le définir manuellement |
| `dataSource` | `string` | Quelle source de données enregistrée soutient cette collection (par défaut : celle sans nom) |
| `engine` | `string` | Le moteur sous-jacent — `"postgres"`, `"firestore"`, `"mongodb"`. Résolu à partir de `dataSource` ; à définir uniquement pour surcharger |
| `databaseId` | `string` | Base de données ou schéma au sein du moteur |
| `metadata` | `Record<string, unknown>` | Tout ce que votre propre code doit associer à une collection. Rebase ne le lit pas ; il survit à la sérialisation sans modification |
| `ownerId` | `string` | **Formulaire d'administration uniquement — non appliqué par l'API ou la base de données.** L'identifiant utilisateur que l'éditeur de collections attribue à une collection qu'il crée, et affiche à côté de son nom. Aucun élément sur le parcours de la requête ne le consulte |

`subcollections` et `path` se trouvent uniquement sur les configurations de **bases de données orientées documents** —
`FirebaseCollectionConfig` et, pour `path`, `MongoDBCollectionConfig` :

| Propriété | Type | Description |
|-----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Firestore uniquement.** Collections imbriquées sous chaque document. Une collection Postgres exprime la même chose avec une [relation](/docs/collections/relations) `hasMany`, qui est ce qui renseigne `childCollections` |
| `path` | `string` | **Firestore et MongoDB uniquement.** Le chemin ou le nom de la collection au niveau du moteur, lorsqu'il diffère du slug |

Et à l'intérieur de `admin`, car seul le panneau les dessine :

| Propriété | Type | Description |
|-----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Actions personnalisées sur les entités (archiver, publier, etc.) |
| `admin.Actions` | `React.ComponentType` | Composant d'actions de barre d'outils personnalisé |
| `admin.entityViews` | `EntityCustomView[]` | Onglets personnalisés dans la vue détaillée de l'entité |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Colonnes calculées/virtuelles |
| `admin.exportable` | `boolean \| ExportConfig` | Active l'exportation de données |
| `admin.components` | `CollectionComponentOverrideMap` | Remplacements de composants d'interface au niveau de la collection |

Écrire l'un de ces six éléments au niveau racine constitue une erreur au démarrage, accompagnée d'un message
indiquant la clé et l'endroit où elle a été déplacée.

## Affichage d'entité

Chaque surface affichant un enregistrement utilise un sous-ensemble de six rôles : **title**,
**subtitle**, **image**, **status**, **date** et **tags**. Une ligne de liste correspond à image +
title + subtitle + status + date, une carte correspond à la même chose avec l'image au-dessus, un
sélecteur de référence est title + subtitle, et un en-tête de page correspond au titre seul.

Chaque rôle est dérivé de vos propriétés, et chacun peut être explicitement défini — sous forme de
chemin de propriété, ou sous forme de fonction :

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

Tout élément omis conserve sa valeur dérivée ; définir un rôle ne signifie
donc pas devoir spécifier les six.

### Rôles calculés et asynchrones

Un résolveur peut être `async`, ce qui permet à un rôle de lire une valeur que l'enregistrement
ne contient pas — un document dans une sous-collection, une valeur issue d'une API :

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

Pendant que la promesse est en cours, la surface affiche la valeur dérivée et bascule sur
la valeur résolue une fois celle-ci obtenue — un titre n'affiche jamais d'indicateur de chargement. Les résultats sont mis en cache
par enregistrement et par rôle, et les requêtes concurrentes pour une même paire partagent un seul appel, de sorte
qu'une liste de cinquante lignes ne résout chaque ligne qu'une seule fois plutôt qu'à chaque rendu.

Renvoyez `undefined` lorsqu'un enregistrement n'a rien pour ce rôle ; la valeur de repli par défaut de la
surface gère mieux ce qui doit figurer à la place (un en-tête utilise le
nom singulier de la collection, un lien utilise l'id). Un résolveur qui lève une exception est traité
comme `undefined` et consigné une seule fois dans les journaux — un titre impossible à récupérer ne doit pas
bloquer l'affichage de la ligne qui le présente.

Préférez un chemin dès que la valeur se trouve sur l'enregistrement : un chemin préserve le
rendu propre à la propriété, de sorte qu'un statut enum reste une puce colorée et qu'une date reste
formatée, ce qu'un résolveur renvoyant une simple chaîne de caractères ne peut pas exprimer.

:::note[`titleProperty` remplacé]
`admin.titleProperty` a été supprimé au profit de `admin.display.title`. La même
chaîne de caractères y fonctionne, et le nouveau champ accepte également un résolveur. Une collection
portant encore l'ancienne clé est rejetée par `defineCollection` avec l'erreur habituelle
de clé inconnue.
:::

### Sélection de la propriété titre
Lorsque `display.title` n'est pas défini, la propriété utilisée comme titre d'affichage de l'entité (aperçus, en-têtes) est résolue automatiquement :
1. Si `propertiesOrder` est explicitement défini, la première propriété autre que l'identifiant (ID) qui est de type `relation` ou `string` est choisie comme titre.
2. Si aucun `propertiesOrder` n'est défini, le framework parcourt les propriétés dans l'ordre et sélectionne la première propriété de type chaîne de caractères (`string`).

### Aperçus des relations dans les tableaux
Lorsque `propertiesOrder` est explicitement défini, les propriétés de type relation ne sont **pas** automatiquement exclues des colonnes d'aperçu par défaut (alors qu'elles sont exclues des configurations par défaut sans ordre pour éviter les opérations de jointure lentes).

### Rendu d'une valeur de titre
Quel que soit le contenu de la propriété titre, le panneau affiche une chaîne de caractères. Une date est formatée, un tableau est joint, et une relation — qui est fournie sous la forme `{ id, data: { values } }` plutôt que sous forme de texte — est parcourue pour trouver le premier élément parmi `name`, `title`, `label` ou `displayName` sur la ligne associée, en se rabattant sur son id. Ainsi, un titre peut désigner une propriété `relation` tout en s'affichant sous forme de nom plutôt que de simple UUID.

Il ne s'agit pas d'un helper exporté : c'est le comportement appliqué d'office par chaque surface affichant un enregistrement. Il n'y a rien à appeler, ni rien à importer.

## Collection Builder

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

Vous pouvez définir des filtres par défaut ou forcés. Tous les trois relèvent de la présentation — ce sur quoi
le panneau s'ouvre — et se trouvent donc dans `admin` :

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

Un `fixedFilter` restreint ce que le panneau *demande* ; il ne constitue pas une barrière absolue. Ce qu'un
appelant a le droit de lire relève d'une [règle de sécurité](/docs/collections/security-rules),
que la base de données applique à tout appelant, qu'il s'agisse du panneau ou non.

## Prochaines étapes

- **[Callbacks d'entité](/docs/collections/callbacks)** — Hooks de cycle de vie pour la synchronisation de données entre collections, validation, effets secondaires
- **[Propriétés](/docs/collections/properties)** — Tous les types de propriétés et leurs options
- **[Relations](/docs/collections/relations)** — Clés étrangères, tables de jonction, jointures
- **[Règles de sécurité](/docs/collections/security-rules)** — Sécurité au niveau des lignes (RLS)
- **[Modes d'affichage](/docs/frontend/view-modes)** — Liste, Tableau, Cartes, Kanban

---
