---
sourceHash: 92f11ec9a842b6d9
title: Collections
sidebar_label: Collections
description: Les collections sont la brique fondamentale de Rebase — chaque collection correspond à une table de base de données et définit son schéma, ses relations, sa sécurité et son comportement d'interface utilisateur.
---

## Qu'est-ce qu'une collection ?

Une **collection** est un objet TypeScript qui décrit une table de base de données et la façon dont elle doit apparaître dans Rebase CMS. Elle définit :

- **Schéma** — Propriétés (colonnes), leurs types et règles de validation
- **Relations** — Clés étrangères, tables de jonction et chemins de jointure
- **Sécurité** — Politiques de sécurité au niveau des lignes (Row Level Security)
- **Hooks de cycle de vie** — Callbacks pour les opérations de création, mise à jour et suppression
- **Comportement du CMS** — Modes de vue, édition en ligne, vues d'entité, actions — le tout sous `admin`

## En déclarer une : `defineCollection`

Enveloppez le littéral dans `defineCollection`. À l'exécution, il s'agit de la fonction identité — elle renvoie l'objet sans le modifier — son coût est donc nul. Ce qu'elle apporte, c'est l'inférence : un paramètre de type `const` capture les clés de vos `properties` en tant que types littéraux, et les champs de clés du bloc `admin` sont ensuite vérifiés par rapport à celles-ci. Un nom qui ne fait pas partie de vos propriétés constitue une **erreur de compilation**, et pas seulement une suggestion manquante.

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

Les champs vérifiés sont `display`, `sort`, `propertiesOrder`, `listProperties`,
`previewProperties`, `orderProperty` ainsi que les filtres `defaultFilter`, `fixedFilter`
et `filterPresets`. Trois formes sont acceptées en plus d'une simple clé de propriété :

| Forme | Exemple | Remarques |
| --- | --- | --- |
| Chemin avec points dans un `map` | `"profile.displayName"` | La **racine** doit être une vraie propriété ; le chemin en dessous n'est pas vérifié. Ne s'applique pas à `previewProperties` / `orderProperty`, qui prennent une clé de premier niveau. |
| Colonne de sous-collection | `"subcollection:orders"` | `propertiesOrder` / `listProperties` uniquement. |
| Une clé `additionalFields` | `"score" as AdditionalFieldKey` | `propertiesOrder` / `listProperties` uniquement. Nécessite le transtypage — voir ci-dessous. |

`AdditionalFieldDelegate.key` est une simple `string`, de sorte que le système de types n'a aucun moyen de savoir quelles clés supplémentaires une collection déclare. Plutôt que de rouvrir ces champs à n'importe quelle chaîne, le transtypage rend l'exception explicite :

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Importez-le depuis `@rebasepro/cms-types` dans un projet doté d'un panneau d'administration — c'est cette version qui vérifie également les types du bloc `admin`. Un projet BaaS headless, qui ne possède pas de bloc admin, importe la même fonction depuis `@rebasepro/common` à la place.

Annoter directement le type fonctionne toujours et reste vérifié :

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

mais une annotation ne fait que *valider la forme* — elle ne peut pas voir les noms de vos propriétés, de sorte que les champs de clés de `admin` se rabattent sur l'acceptation de n'importe quelle chaîne. Privilégiez `defineCollection` sauf si vous avez besoin de nommer le type.

:::note
`buildCollection` et `buildProperty` n'existent plus. `buildCollection` est `defineCollection` sans l'inférence ; `buildProperty` enveloppait une propriété dans un type qu'elle possédait déjà. Consultez le [journal des modifications](/docs/changelog) pour la migration en une ligne.
:::

## Anatomie : le contrat et le panneau

Un seul fichier, deux publics. Tout ce qui concerne la *base de données et l'API* se trouve au premier niveau ; tout ce que le *panneau d'administration* affiche se trouve dans `admin`.

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

- Un projet **BaaS ou headless** n'écrit jamais de bloc `admin`. Ses collections — ou aucune collection du tout, puisque le mode BaaS introspecte la base de données — décrivent les données et l'autorisation, rien d'autre. `@rebasepro/types` ne comporte aucun code d'interface utilisateur, l'arbre de dépendances d'un projet headless reste donc exclusivement côté serveur.
- Le **backend ne lit jamais à l'intérieur du bloc**. Celui-ci est retiré avant qu'une collection ne soit sérialisée vers le point de terminaison de contrat ou dans un bundle de build, et il est exclu de la version de schéma — ainsi, modifier une icône ne signale pas chaque SDK généré comme obsolète.

### Le bloc `admin` n'existe que si vous installez les types admin

`@rebasepro/types` ne déclare aucun champ `admin` — ni sur une collection, ni sur une propriété. Dans un projet BaaS, en écrire un constitue une **erreur de type**. `@rebasepro/cms-types` le réintroduit par fusion de déclarations (declaration merging), une seule ligne par projet suffit donc à l'activer :

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Après cela, les types du cœur portent un bloc entièrement typé — une coquille telle que `icoon` est une erreur, et vous bénéficiez de l'autocomplétion :

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
Une augmentation s'applique à l'ensemble du *programme* TypeScript, et `config/` ainsi que `frontend/` sont des programmes distincts — c'est pourquoi la référence doit se trouver dans le paquet de configuration. Il n'existe pas de type wrapper `AdminCollectionConfig` : avec le champ fusionné, `CollectionConfig` est le type de création.

:::note[Pourquoi un projet BaaS ne paie aucun surcoût]
Un type de propriété dans une installation BaaS n'a pas de `Field`, pas de `columnWidth`, pas de `hideFromCollection` — ceux-ci résident dans `AdminPropertyOptions` au sein du paquet admin. Cette garantie est testée et validée, pas simplement promise : `tests/e2e/baas-typecheck/src/admin_absent.ts` utilise `@ts-expect-error` sur `admin`, de sorte que le build échoue si le champ redevient modifiable dans le cœur.
:::

### Migrer depuis une collection plate

Avant la version 0.11, ces champs se trouvaient au premier niveau. Pour les déplacer :

```bash
node tooling/scripts/codemod/collections-admin-block.mjs config/collections
```

L'outil signale tout ce qu'il ne peut pas déplacer en toute sécurité — notamment les éléments de présentation dans `relations[].overrides`, qui nécessitent `overrides: { admin: { … } }` manuellement.

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
        icon: "Package"               // Lucide icon name
    }
});

```

## Propriétés clés

### Identification

| Propriété | Type | Description |
|----------|------|-------------|
| `slug` | `string` | **Requis.** Identifiant compatible avec les URL. Utilisé dans l'URL de l'interface d'administration et le chemin de l'API REST (`/api/data/{slug}`). |
| `name` | `string` | **Requis.** Nom d'affichage (pluriel). Affiché dans la navigation et les en-têtes de page. |
| `singularName` | `string` | Nom d'affichage pour une entité unique. Utilisé dans « New Product », « Edit Product », etc. |
| `description` | `string` | Une phrase décrivant le contenu de cette collection, affichée au-dessus de la liste. Markdown. |
| `table` | `string` | Nom de la table PostgreSQL. Par défaut à `toSnakeCase(slug)` — ne le définissez que pour découpler l'URL de la table, par exemple une table existante `blog_posts` exposée sur `/posts`. |
| `admin.icon` | `string` | Nom d'icône [Lucide](https://lucide.dev/icons), par exemple `"FileText"`, `"ShoppingCart"`. Un élément rendu fonctionne également, mais le nom résiste à la sérialisation, c'est donc ce que l'éditeur de schéma réécrit. |

### Schéma

| Propriété | Type | Description |
|----------|------|-------------|
| `properties` | `Properties` | **Requis.** Mappage clé de propriété → définition de propriété. Chaque clé devient une colonne de base de données. |
| `relations` | `Relation[]` | Relations SQL — clés étrangères, tables de jonction. Voir [Relations](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Politiques de sécurité au niveau des lignes (Row Level Security). Voir [Règles de sécurité](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Index Postgres nécessaires à cette table. Voir [Index](/docs/backend/indexes). |
| `search` | `SearchConfig` | Recherche plein texte pondérée sur les champs que vous nommez, y compris le contenu JSONB et de tableau. Postgres uniquement. Voir [Recherche](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Marque la collection comme collection d'authentification (gestion des utilisateurs, réinitialisation du mot de passe, etc.) |
| `schema` | `string` | Schéma Postgres dans lequel réside la table — `"public"`, `"rebase"`, `"auth"`. Par défaut `"public"`. |
| `disableDefaultPolicies` | `boolean` | Supprime les politiques de base injectées par le générateur — un SELECT admin/serveur, et sur une collection d'authentification une lecture de soi-même plus un contrôle d'écriture réservé aux admins — et assume l'entière responsabilité du RLS de cette collection. `false` par défaut. Voir [Règles de sécurité](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Transforme la suppression (`delete`) en un horodatage et masque les lignes horodatées de toutes les lectures. `true` utilise `deletedAt` ; la forme objet renomme le champ. La collection doit déclarer elle-même cette propriété `date`. Postgres uniquement — voir [Suppression réversible](/docs/collections/soft-delete) |
| `strictWrites` | `boolean` | Rejette avec une erreur 400 toute écriture qui nomme un champ que cette collection ne déclare pas. `true` par défaut. Ne le définissez sur `false` que lorsque la colonne existe réellement et n'est pas déclarée — remplie par un déclencheur (trigger), ou introspectée plutôt qu'écrite explicitement. |

### Configuration de l'interface utilisateur

Tous les éléments suivants se placent dans `admin`.

| Propriété | Type | Par défaut | Description |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Mode de vue par défaut |
| `enabledViews` | `ViewMode[]` | Les quatre vues intégrées plus chaque vue personnalisée déclarée (kanban uniquement lorsqu'une propriété `enum` existe) | Modes de vue disponibles |
| `kanban` | `KanbanConfig` | — | Configuration du Kanban (propriété de colonne). À toujours associer avec `orderProperty` — voir [Modes de vue](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Clé de la propriété **string** contenant la clé d'ordonnancement en glisser-déposer. Requis pour le bon fonctionnement d'un tableau Kanban |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | D'après la vue : `"split"` pour la liste, `"full_screen"` pour la table et les cartes, `"side_panel"` pour le kanban et les vues personnalisées | Manière dont les entités s'ouvrent pour modification |
| `sideDialogWidth` | `number \| string` | — | Largeur de la boîte de dialogue latérale |
| `inlineEditing` | `boolean` | `true` | Activer l'édition en ligne dans la vue feuille de calcul |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Densité par défaut des vues liste, table et cartes (hauteur des lignes du tableau) |
| `pagination` | `boolean \| number` | `true` (50) | Activer la pagination et/ou définir la taille de la page. `false` charge toutes les lignes ; en développement, la console affiche un avertissement unique lorsque cela dépasse 10 000 lignes |
| `listProperties` | `string[]` | — | Propriétés à afficher dans la vue en liste |
| `propertiesOrder` | `string[]` | — | Ordre des colonnes dans la vue en tableau |
| `selectionEnabled` | `boolean` | `true` | Activer la sélection de lignes |
| `hideFromNavigation` | `boolean` | `false` | Masquer de la navigation de la barre latérale |
| `defaultSelectedView` | `string \| function` | — | Vue ou sous-collection par défaut à ouvrir |

### Options des entités

Dans `admin`, sauf `history`, qui est une fonctionnalité backend et reste au premier niveau.

| Propriété | Type | Par défaut | Description |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Sauvegarde automatique deux secondes après une modification, une fois le formulaire validé. Un nouveau formulaire n'est pas enregistré tant que rien n'y a été saisi. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Sauvegarde des modifications non enregistrées |
| `hideIdFromForm` | `boolean` | `false` | Masquer l'ID de l'entité du formulaire |
| `hideIdFromCollection` | `boolean` | `false` | Masquer la colonne de l'ID du tableau |
| `includeJsonView` | `boolean` | `true` | Proposer les valeurs brutes dans l'inspecteur d'enregistrement |
| `history` | `boolean` | `false` | Suivre les modifications dans l'historique de l'entité |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Lorsqu'un enregistrement existant s'ouvre dans le formulaire, renseigne la valeur `defaultValue` déclarée de chaque propriété dans une valeur que l'enregistrement laisse vide (`null` ou absente), de sorte que le prochain enregistrement l'écrive |
| `previewProperties` | `string[]` | — | Propriétés à afficher dans les aperçus de référence |
| `display` | `EntityDisplay` | — | Ce qui remplit chaque rôle d'affichage — voir [Affichage des entités](#affichage-des-entités) |

### Avancé

Au premier niveau, car le backend les lit :

| Propriété | Type | Description |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Hooks de cycle de vie (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `childCollections` | `() => CollectionConfig[]` | Les collections imbriquées sous une entité de celle-ci. Rempli pendant la normalisation à partir de ce avec quoi le pilote les exprime — des `subcollections` Firestore, une relation `hasMany` Postgres — un pilote personnalisé est donc la seule raison de le définir manuellement |
| `dataSource` | `string` | Source de données enregistrée qui soutient cette collection (par défaut : la source non nommée) |
| `engine` | `string` | Le moteur sous-jacent — `"postgres"`, `"firestore"`, `"mongodb"`. Résolu à partir de `dataSource` ; à ne définir que pour le surcharger |
| `databaseId` | `string` | Base de données ou schéma au sein du moteur |
| `metadata` | `Record<string, unknown>` | Tout ce que votre propre code doit associer à une collection. Rebase ne le lit pas ; il est conservé intact lors de la sérialisation |
| `ownerId` | `string` | **Formulaire d'administration uniquement — non appliqué par l'API ou la base de données.** L'identifiant utilisateur que l'éditeur de collection appose sur une collection qu'il crée, et affiche à côté de son nom. Rien sur le chemin de requête ne le consulte |

`subcollections` et `path` ne sont présents que sur les configurations de **bases de données orientées documents** —
`FirebaseCollectionConfig` et, pour `path`, `MongoDBCollectionConfig` :

| Propriété | Type | Description |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Firestore uniquement.** Collections imbriquées sous chaque document. Une collection Postgres exprime la même chose avec une [relation](/docs/collections/relations) `hasMany`, ce qui remplit `childCollections` |
| `path` | `string` | **Firestore et MongoDB uniquement.** Le chemin ou le nom de collection au niveau du moteur, lorsqu'il diffère du slug |

Et à l'intérieur de `admin`, car seul le panneau les affiche :

| Propriété | Type | Description |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Actions personnalisées sur les entités (archiver, publier, etc.) |
| `admin.Actions` | `ComponentRef<CollectionActionsProps>[]` | Composants personnalisés d'actions dans la barre d'outils |
| `admin.entityViews` | `EntityCustomView[]` | Onglets personnalisés dans la vue détaillée de l'entité |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Colonnes calculées/virtuelles |
| `admin.exportable` | `boolean \| ExportConfig` | Activer l'export de données |
| `admin.components` | `CollectionComponentOverrideMap` | Surcharges de composants d'interface utilisateur au niveau de la collection |

Écrire l'une de ces six propriétés au premier niveau génère une erreur au démarrage, accompagnée d'un message indiquant la clé et son nouvel emplacement.

## Affichage des entités

Chaque surface qui affiche un enregistrement présente un sous-ensemble de six rôles : **title**, **subtitle**, **image**, **status**, **date** et **tags**. Une ligne de liste correspond à image + titre + sous-titre + statut + date, une carte est identique avec l'image sur le dessus, un sélecteur de référence correspond à titre + sous-titre, et un en-tête de page correspond au titre seul.

Chaque rôle est dérivé de vos propriétés, et chacun peut être défini explicitement — sous forme de chemin de propriété ou de fonction :

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
            subtitle: ({ row }) => `in ${String(row.city)}`        // computed
        }
    }
});
```

Tout ce que vous omettez conserve sa valeur dérivée ; définir un rôle ne signifie donc pas devoir définir les six.

Un résolveur reçoit `{ row, id, context }`. `row` est l'enregistrement tel que le serveur l'envoie, la forme renvoyée par `useRows` et `context.data` : les dates sous forme de chaînes ISO, un belongsTo sous sa colonne de clé étrangère (`authorId`), et `id` uniquement là où la table possède cette colonne. `id` est l'identifiant de l'enregistrement à côté : sa clé primaire sous forme de chaîne de caractères, les parties d'une clé composite étant jointes par `:::`. Une relation chargée par l'admin arrive imbriquée sous son nom, telle que le paramètre `include` de REST la renvoie — `row.author` est la ligne de l'auteur, ses propres colonnes et rien de plus, aux côtés de `authorId` — ainsi, un résolveur lit un champ d'enregistrement lié sans effectuer de requête propre :

```typescript
admin: {
    display: {
        // Undefined where the row holds only the author's id.
        subtitle: ({ row }) => typeof row.author === "object" && row.author !== null && "name" in row.author
            ? String(row.author.name)
            : undefined
    }
}
```

### Rôles calculés et asynchrones

Un résolveur peut être `async`, ce qui permet à un rôle de lire une donnée que l'enregistrement ne contient pas — un document dans une sous-collection, une valeur issue d'une API :

```typescript
admin: {
    display: {
        // The exercise's name lives one document down, per locale.
        title: async ({ id, context }) => {
            const locale = await context.data.exercise_locales.findById(`${id}/de-DE`);
            return locale?.exercise_title;
        }
    }
}
```

Tant que la promesse est en cours, la surface affiche la valeur dérivée puis la remplace par la valeur résolue dès son arrivée — un titre n'affiche jamais d'indicateur de chargement (spinner). Les résultats sont mis en cache par enregistrement et par rôle, et les demandes simultanées pour une même paire partagent un seul appel, de sorte qu'une liste de cinquante lignes résout chaque ligne une seule fois plutôt qu'à chaque rendu.

Renvoyez `undefined` lorsqu'un enregistrement ne possède rien pour ce rôle ; la solution de repli de la surface elle-même sait mieux ce qui doit y figurer (un en-tête utilise le nom singulier de la collection, un lien utilise l'identifiant). Un résolveur qui lève une exception est traité comme `undefined` et consigné une seule fois dans les journaux — un titre qui ne peut pas être récupéré ne doit pas faire planter la ligne qui l'affiche.

Privilégiez un chemin dès lors que la valeur se trouve sur l'enregistrement : un chemin préserve le rendu propre à la propriété, ainsi un statut énuméré reste une puce colorée et une date reste formatée, ce qu'un résolveur renvoyant une simple chaîne ne peut pas exprimer.

:::note[Remplacement de `titleProperty`]
`admin.titleProperty` a été supprimé au profit de `admin.display.title`. La même chaîne y fonctionne, et le nouveau champ accepte également un résolveur. Une collection comportant encore l'ancienne clé est rejetée par `defineCollection` avec l'erreur habituelle de clé inconnue.
:::

### Sélection de la propriété de titre
Lorsque `display.title` n'est pas défini, la propriété utilisée comme titre d'affichage de l'entité (aperçus, en-têtes) est résolue automatiquement :
1. Si `propertiesOrder` est explicitement défini, la première propriété dans cet ordre pouvant servir de titre est choisie : une `string`, une `relation` à cardinalité simple ou une `reference`. Les identifiants (clés primaires et étrangères, colonnes `uuid`, `isId`), les champs de téléversement de fichiers et les propriétés masquées ne sont jamais admissibles.
2. Si aucun `propertiesOrder` n'est défini, les mêmes candidats sont classés : une chaîne dont la clé évoque un libellé (`name`, `title`, `label`, …) en premier, puis un texte court simple, un e-mail, un enum, un texte long, un sélecteur de relation ou d'utilisateur, et une référence en dernier. En cas d'égalité, l'ordre de déclaration prévaut.

### Aperçus des relations dans les tableaux
Lorsque `propertiesOrder` est explicitement défini, les propriétés de relation ne sont **pas** automatiquement exclues des colonnes d'aperçu par défaut (alors qu'elles sont exclues des valeurs par défaut non ordonnées pour éviter des opérations de jointure lentes).

### Rendu d'une valeur de titre
Quel que soit le contenu de la propriété de titre, le panneau affiche une chaîne. Une date est formatée, un tableau est joint, et une relation — qui arrive sous la forme `{ id, data: { values } }` plutôt que sous forme de texte — est inspectée pour trouver le premier champ parmi `name`, `title`, `label` ou `displayName` sur la ligne associée, puis sa première valeur de chaîne courte, en se rabattant sur son identifiant. Un titre peut donc désigner une propriété de type `relation` tout en s'affichant sous forme de nom plutôt que d'un uuid.

Il ne s'agit pas d'un helper exporté : c'est ce que fait déjà chaque surface affichant un enregistrement. Rien à appeler, et rien à importer.

## Générateur de collections (Collection Builder)

Pour les collections dynamiques qui changent selon l'utilisateur ou des données externes, utilisez une fonction builder :

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

Le builder reçoit également `data`, qui lit les lignes telles que le serveur les envoie, à l'identique de `context.data` : `await data.collection("tenants").find()` renvoie `{ data: rows, meta }`.

## Filtrage et tri

Vous pouvez définir des filtres par défaut ou forcés. Les trois relèvent de la présentation — ce avec quoi le panneau s'ouvre — ils résident donc dans `admin` :

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

        // Fixed filter — cannot be changed; filters the user applies
        // on other fields combine with it
        fixedFilter: { tenantId: ["==", currentTenantId] },

        // Default sort
        sort: ["createdAt", "desc"]
    }
});
```

L'utilisateur peut toujours filtrer une collection qui possède un `fixedFilter` : tout ce qu'il applique sur d'autres champs est combiné avec celui-ci (AND), et les champs fixes restent verrouillés.

Un `fixedFilter` restreint ce que le panneau *demande* ; il ne s'agit pas d'une limite de sécurité. Ce qu'un appelant est autorisé à lire relève d'une [règle de sécurité](/docs/collections/security-rules), que la base de données applique à chaque appelant, qu'il s'agisse du panneau ou non.

## Nombreuses collections

Rien dans Rebase ne limite le nombre de collections, mais deux coûts augmentent avec celui-ci :

- **Le premier téléchargement de l'admin.** Le panneau a besoin de sa navigation dès qu'un utilisateur se connecte, la configuration de chaque collection est donc regroupée dans ce que le navigateur récupère pour l'écran de connexion — environ 2,4 Ko minifiés chacune, ainsi 200 collections ajoutent environ 480 Ko, soit environ 80 Ko compressés avec gzip. Ce dont l'ouverture d'une collection a besoin (le tableau, les vues d'enregistrement, le formulaire) ne se charge qu'à ce moment-là.
- **`rebase db push`.** Atlas planifie un push en effectuant un diff de l'ensemble du schéma, et cela augmente plus vite que le nombre de tables : à partir de 400 tables ou plus, un push prend plusieurs dizaines de secondes — voir [combien de temps prend un push](/docs/cli/schema#rebase-db-push).

## Prochaines étapes

- **[Callbacks d'entité](/docs/collections/callbacks)** — Hooks de cycle de vie pour synchroniser les données entre collections, validation, effets secondaires
- **[Propriétés](/docs/collections/properties)** — Tous les types de propriétés et options
- **[Relations](/docs/collections/relations)** — Clés étrangères, tables de jonction, jointures
- **[Règles de sécurité](/docs/collections/security-rules)** — Sécurité au niveau des lignes (Row Level Security)
- **[Modes de vue](/docs/frontend/view-modes)** — Liste, Tableau, Cartes, Kanban
