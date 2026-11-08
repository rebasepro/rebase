---
sourceHash: 6f0489ae490ff4b1
title: Collections
sidebar_label: Collections
description: Les collections sont l'élément constitutif fondamental de Rebase — chaque collection correspond à une table de base de données et définit son schéma, ses relations, sa sécurité et le comportement de son interface utilisateur.
---

## Qu'est-ce qu'une collection ?

Une **collection** est un objet TypeScript qui décrit une table de base de données et la manière dont elle doit apparaître dans Rebase CMS. Elle définit :

- **Schéma** — Propriétés (colonnes), leurs types et leurs règles de validation
- **Relations** — Clés étrangères, tables de jonction et chemins de jointure
- **Sécurité** — Politiques de sécurité au niveau des lignes (Row Level Security)
- **Hooks de cycle de vie** — Fonctions de rappel (callbacks) pour les opérations de création, mise à jour et suppression
- **Comportement du CMS** — Modes d'affichage, édition en ligne, vues d'entités, actions — le tout sous `admin`

## En déclarer une : `defineCollection`

Enveloppez le littéral dans `defineCollection`. Au moment de l'exécution, il s'agit de la fonction identité — elle renvoie l'objet sans modification — elle ne coûte donc rien. Ce qu'elle apporte, c'est l'inférence : un paramètre de type `const` capture les clés de vos `properties` sous forme de types littéraux, et les champs sous forme de clés du bloc `admin` sont ensuite vérifiés par rapport à celles-ci. Un nom qui ne fait pas partie de vos propriétés est une **erreur de compilation**, et pas seulement une suggestion manquante.

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

Les champs vérifiés sont `display`, `sort`, `propertiesOrder`, `listProperties`, `previewProperties`, `orderProperty` ainsi que les filtres `defaultFilter`, `fixedFilter` et `filterPresets`. Trois formes sont acceptées en dehors d'une simple clé de propriété :

| Forme | Exemple | Remarques |
| --- | --- | --- |
| Chemin avec points dans un `map` | `"profile.displayName"` | La **racine** doit être une vraie propriété ; le chemin en dessous n'est pas vérifié. Pas sur `previewProperties` / `orderProperty`, qui prennent une clé de premier niveau. |
| Colonne de collection enfant | `"subcollection:orders"` | `propertiesOrder` / `listProperties` uniquement. |
| Une clé de `additionalFields` | `"score" as AdditionalFieldKey` | `propertiesOrder` / `listProperties` uniquement. Nécessite le transtypage (cast) — voir ci-dessous. |

`AdditionalFieldDelegate.key` est une simple `string`, de sorte que le système de types n'a aucun moyen de savoir quelles clés supplémentaires une collection déclare. Plutôt que de rouvrir ces champs à n'importe quelle chaîne, le transtypage rend l'exception explicite :

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Importez-le depuis `@rebasepro/cms-types` dans un projet comportant un panneau d'administration — c'est cette copie qui vérifie également les types du bloc `admin`. Un projet BaaS headless, qui ne possède aucun bloc admin, importe la même fonction depuis `@rebasepro/common` à la place.

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

mais une annotation ne fait que *valider la structure (forme)* — elle ne peut pas voir les noms de vos propriétés, de sorte que les champs de clés d'`admin` se replient sur l'acceptation de n'importe quelle chaîne. Privilégiez `defineCollection` sauf si vous devez nommer le type.

:::note
`buildCollection` et `buildProperty` n'existent plus. `buildCollection` est `defineCollection` sans l'inférence ; `buildProperty` enveloppait une propriété dans un type qu'elle possédait déjà. Consultez le [journal des modifications](/docs/changelog) pour la migration en une seule ligne.
:::

## Anatomie : le contrat et le panneau

Un seul fichier, deux publics. Tout ce qui concerne la *base de données et l'API* se trouve au niveau racine ; tout ce que le *panneau d'administration* affiche se trouve à l'intérieur d'`admin`.

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

- Un projet **BaaS ou headless** n'écrit jamais de bloc `admin`. Ses collections — ou aucune collection du tout, puisque le mode BaaS introspecte la base de données — décrivent les données et les autorisations, rien d'autre. `@rebasepro/types` ne contient aucun code d'interface utilisateur, de sorte que l'arbre de dépendances d'un projet headless reste purement serveur.
- Le **backend ne lit jamais à l'intérieur de ce bloc**. Il est ignoré avant qu'une collection ne soit sérialisée vers le point de terminaison de contrat ou dans un bundle de build, et il est exclu de la version de schéma — ainsi, modifier une icône ne signale pas chaque SDK généré comme obsolète.

### Le bloc `admin` n'existe que si vous installez les types admin

`@rebasepro/types` ne déclare aucun champ `admin` — ni sur une collection, ni sur une propriété. Dans un projet BaaS, en écrire un est une **erreur de type**. `@rebasepro/cms-types` le réintroduit par fusion de déclarations (declaration merging), une seule ligne par projet suffit donc à l'activer :

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Après cela, les types du cœur standard intègrent un bloc entièrement typé — une coquille telle que `icoon` produit une erreur, et vous bénéficiez de l'autocomplétion :

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
Une augmentation s'applique à l'ensemble du *programme* TypeScript, et `config/` et `frontend/` sont des programmes distincts — c'est pourquoi la référence appartient au package config. Il n'y a pas de type wrapper `AdminCollectionConfig` : le champ étant fusionné, `CollectionConfig` est le type de création.

:::note[Pourquoi un projet BaaS ne paie rien]
Un type de propriété dans une installation BaaS ne possède pas de `Field`, ni de `columnWidth`, ni de `hideFromCollection` — ceux-ci résident dans `AdminPropertyOptions` dans le package admin. La garantie est affirmée et vérifiée : `tests/e2e/baas-typecheck/src/admin_absent.ts` utilise `@ts-expect-error` sur `admin`, de sorte que le build échoue si le champ redevient modifiable dans le cœur.
:::

### Migration depuis une collection plate

Avant la version 0.11, ces champs se trouvaient au niveau racine. Pour les déplacer :

```bash
node tooling/scripts/codemod/collections-admin-block.mjs config/collections
```

Il signale tout ce qu'il ne peut pas déplacer en toute sécurité — notamment la présentation à l'intérieur de `relations[].overrides`, qui nécessite d'ajouter `overrides: { admin: { … } }` manuellement.

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
| `slug` | `string` | **Requis.** Identifiant sûr pour les URL. Utilisé dans l'URL de l'interface d'administration et dans le chemin de l'API REST (`/api/data/{slug}`). |
| `name` | `string` | **Requis.** Nom d'affichage (pluriel). Affiché dans la navigation et les en-têtes de page. |
| `singularName` | `string` | Nom d'affichage pour une entité unique. Utilisé dans « Nouveau produit », « Modifier le produit », etc. |
| `description` | `string` | Une phrase décrivant le contenu de cette collection, affichée au-dessus de la liste. Markdown. |
| `table` | `string` | Nom de la table PostgreSQL. Par défaut `toSnakeCase(slug)` — définissez-le uniquement pour dissocier l'URL de la table, par exemple une table existante `blog_posts` exposée sur `/posts`. |
| `admin.icon` | `string` | Un nom d'icône [Lucide](https://lucide.dev/icons), par ex. `"FileText"`, `"ShoppingCart"`. Un élément rendu fonctionne également, mais le nom survit à la sérialisation, c'est donc ce que l'éditeur de schéma réécrit. |

### Schéma

| Propriété | Type | Description |
|----------|------|-------------|
| `properties` | `Properties` | **Requis.** Mappage clé de propriété → définition de la propriété. Chaque clé devient une colonne de base de données. |
| `relations` | `Relation[]` | Relations SQL — clés étrangères, tables de jonction. Voir [Relations](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Politiques de sécurité au niveau des lignes (Row Level Security). Voir [Règles de sécurité](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Index Postgres requis par cette table. Voir [Index](/docs/backend/indexes). |
| `search` | `SearchConfig` | Recherche en texte intégral classée sur les champs indiqués, y compris le contenu JSONB et les tableaux. Postgres uniquement. Voir [Recherche](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Marquer la collection comme collection d'authentification (gestion des utilisateurs, réinitialisation de mot de passe, etc.) |
| `schema` | `string` | Schéma Postgres dans lequel réside la table — `"public"`, `"rebase"`, `"auth"`. Par défaut `"public"`. |
| `disableDefaultPolicies` | `boolean` | Supprimer les politiques de base injectées par le générateur — un SELECT admin/serveur, et sur une collection d'authentification une lecture personnelle ainsi qu'une barrière d'écriture réservée aux administrateurs — et assumer l'entière responsabilité du RLS de cette collection. `false` par défaut. Voir [Règles de sécurité](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Transformer `delete` en horodatage et masquer les lignes horodatées de chaque lecture. `true` utilise `deletedAt` ; la forme objet renomme le champ. La collection doit déclarer elle-même cette propriété `date`. Postgres uniquement — voir [Suppression réversible (Soft delete)](/docs/collections/soft-delete) |
| `strictWrites` | `boolean` | Rejeter avec une erreur 400 une écriture qui mentionne un champ non déclaré par cette collection. `true` par défaut. Définissez-le à `false` uniquement lorsque la colonne existe réellement sans être déclarée — remplie par un déclencheur (trigger), ou introspectée plutôt que spécifiée. |

### Configuration de l'interface utilisateur (UI)

Tout ce qui suit se place à l'intérieur d'`admin`.

| Propriété | Type | Par défaut | Description |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Mode d'affichage par défaut |
| `enabledViews` | `ViewMode[]` | Les quatre vues intégrées plus chaque vue personnalisée déclarée (kanban uniquement lorsqu'une propriété `enum` existe) | Quels modes d'affichage sont disponibles |
| `kanban` | `KanbanConfig` | — | Configuration Kanban (propriété de colonne). Toujours associer à `orderProperty` — voir [Modes d'affichage](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Clé de la propriété **string** contenant la clé d'ordonnancement par glisser-déposer. Requis pour un tableau Kanban fonctionnel |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | D'après la vue : `"split"` pour la liste, `"full_screen"` pour le tableau et les cartes, `"side_panel"` pour le kanban et les vues personnalisées | Manière dont les entités s'ouvrent pour l'édition |
| `sideDialogWidth` | `number \| string` | — | Largeur du panneau latéral (side dialog) |
| `inlineEditing` | `boolean` | `true` | Activer l'édition en ligne dans la vue feuille de calcul |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Densité par défaut des vues liste, tableau et cartes (la hauteur de ligne du tableau) |
| `pagination` | `boolean \| number` | `true` (50) | Activer la pagination et/ou définir la taille de la page. `false` charge toutes les lignes ; en développement, la console émet un avertissement si cela dépasse 10 000 lignes |
| `listProperties` | `string[]` | — | Propriétés à afficher dans la vue liste |
| `propertiesOrder` | `string[]` | — | Ordre des colonnes dans la vue tableau |
| `selectionEnabled` | `boolean` | `true` | Activer la sélection de lignes |
| `hideFromNavigation` | `boolean` | `false` | Masquer de la navigation de la barre latérale |
| `defaultSelectedView` | `string \| function` | — | Vue ou sous-collection par défaut à ouvrir |

### Options des entités

À l'intérieur d'`admin`, à l'exception de `history`, qui est une fonctionnalité backend et reste au niveau racine.

| Propriété | Type | Par défaut | Description |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Enregistrement automatique deux secondes après une modification, une fois le formulaire validé. Un nouveau formulaire n'est pas enregistré tant que rien n'est saisi. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Sauvegarder les modifications non enregistrées |
| `hideIdFromForm` | `boolean` | `false` | Masquer l'ID de l'entité du formulaire |
| `hideIdFromCollection` | `boolean` | `false` | Masquer la colonne ID du tableau |
| `includeJsonView` | `boolean` | `true` | Proposer les valeurs brutes dans l'inspecteur d'enregistrement |
| `history` | `boolean` | `false` | Suivre les modifications dans l'historique de l'entité |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Lorsqu'un enregistrement existant s'ouvre dans le formulaire, renseigner le `defaultValue` déclaré de chaque propriété pour toute valeur laissée vide (`null` ou absente) par l'enregistrement, afin que la prochaine sauvegarde l'enregistre |
| `previewProperties` | `string[]` | — | Propriétés à afficher dans les aperçus de référence |
| `display` | `EntityDisplay` | — | Ce qui remplit chaque rôle d'affichage — voir [Affichage de l'entité](#affichage-de-lentité) |

### Avancé

Au niveau racine, car le backend les lit :

| Propriété | Type | Description |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Hooks de cycle de vie (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `childCollections` | `() => CollectionConfig[]` | Les collections imbriquées sous une entité de celle-ci. Renseigné lors de la normalisation à partir de ce que le pilote exprime — un `subcollections` Firestore, une relation `hasMany` Postgres — un pilote personnalisé est donc la seule raison de le définir manuellement |
| `dataSource` | `string` | Quelle source de données enregistrée alimente cette collection (par défaut : celle sans nom) |
| `engine` | `string` | Le moteur sous-jacent — `"postgres"`, `"firestore"`, `"mongodb"`. Résolu à partir de `dataSource` ; à définir uniquement pour surcharger |
| `databaseId` | `string` | Base de données ou schéma au sein du moteur |
| `metadata` | `Record<string, unknown>` | Tout ce que votre propre code doit associer à une collection. Rebase ne le lit pas ; il survit à la sérialisation sans modification |
| `ownerId` | `string` | **Formulaire d'administration uniquement — non appliqué par l'API ou la base de données.** L'identifiant utilisateur que l'éditeur de collection appose sur une collection qu'il crée, et affiche à côté de son nom. Rien sur le chemin de la requête ne le consulte |

`subcollections` et `path` s'appliquent uniquement aux configurations de **bases de données orientées documents** — `FirebaseCollectionConfig` et, pour `path`, `MongoDBCollectionConfig` :

| Propriété | Type | Description |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Firestore uniquement.** Collections imbriquées sous chaque document. Une collection Postgres exprime la même chose avec une [relation](/docs/collections/relations) `hasMany`, qui remplit `childCollections` |
| `path` | `string` | **Firestore et MongoDB uniquement.** Le chemin ou nom de collection au niveau du moteur, lorsqu'il diffère du slug |

Et à l'intérieur d'`admin`, car seul le panneau les affiche :

| Propriété | Type | Description |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Actions personnalisées sur les entités (archiver, publier, etc.) |
| `admin.Actions` | `ComponentRef<CollectionActionsProps>[]` | Composants d'actions personnalisés de la barre d'outils |
| `admin.entityViews` | `EntityCustomView[]` | Onglets personnalisés dans la vue détaillée de l'entité |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Colonnes calculées/virtuelles |
| `admin.exportable` | `boolean \| ExportConfig` | Activer l'export de données |
| `admin.components` | `CollectionComponentOverrideMap` | Surcharges de composants d'interface utilisateur au niveau de la collection |

Écrire l'une de ces six propriétés au niveau racine est une erreur au démarrage, accompagnée d'un message indiquant la clé et son nouvel emplacement.

## Affichage de l'entité

Chaque surface affichant un enregistrement affiche un sous-ensemble de six rôles : **title** (titre), **subtitle** (sous-titre), **image**, **status** (statut), **date** et **tags** (étiquettes). Une ligne de liste correspond à image + titre + sous-titre + statut + date, une carte correspond à la même chose avec l'image au-dessus, un sélecteur de référence est titre + sous-titre, et un en-tête de page est le titre seul.

Chaque rôle est dérivé de vos propriétés, et chacun peut également être spécifié directement — sous la forme d'un chemin de propriété ou d'une fonction :

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

Tout ce que vous omettez conserve sa valeur dérivée, donc définir un rôle n'oblige pas à définir les six.

Un résolveur reçoit `{ row, context }`. `row` est l'enregistrement tel que le serveur l'envoie, la structure renvoyée par `useRows` et `context.data` : les dates sous forme de chaînes ISO, un belongsTo sous la forme de sa colonne de clé étrangère (`authorId`), et `id` inclus. Une relation chargée par l'admin arrive imbriquée sous son nom, telle que le `include` de REST la renvoie — `row.author` est la ligne de l'auteur, aux côtés de `authorId` — ainsi un résolveur lit le champ d'un enregistrement lié sans aucune requête supplémentaire :

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

Un résolveur peut être `async`, ce qui permet à un rôle de lire une information que l'enregistrement ne contient pas — un document dans une sous-collection, une valeur provenant d'une API :

```typescript
admin: {
    display: {
        // The exercise's name lives one document down, per locale.
        title: async ({ row, context }) => {
            const locale = await context.data.exercise_locales.findById(`${String(row.id)}/de-DE`);
            return locale?.exercise_title;
        }
    }
}
```

Pendant que la promesse est en attente, la surface affiche la valeur dérivée et la remplace par la valeur résolue dès qu'elle arrive — un titre n'affiche jamais d'indicateur de chargement (spinner). Les résultats sont mis en cache par enregistrement et par rôle, et les demandes simultanées pour une même paire partagent un seul appel, de sorte qu'une liste de cinquante lignes résout chaque ligne une seule fois plutôt qu'à chaque rendu.

Renvoyez `undefined` lorsqu'un enregistrement ne possède rien pour ce rôle ; la valeur de repli propre à la surface est mieux informée de ce qui doit y figurer à la place (un en-tête utilise le nom singulier de la collection, un lien utilise l'id). Un résolveur qui lève une exception est traité comme renvoyant `undefined` et journalisé une fois — un titre qui ne peut pas être récupéré ne doit pas faire planter la ligne qui l'affiche.

Préférez un chemin dès que la valeur se trouve sur l'enregistrement : un chemin conserve le rendu propre à la propriété, de sorte qu'un statut enum reste une pastille de couleur et qu'une date reste formatée, ce qu'un résolveur renvoyant une simple chaîne ne peut pas exprimer.

:::note[`titleProperty` remplacé]
`admin.titleProperty` a été supprimé au profit de `admin.display.title`. La même chaîne fonctionne ici, et le nouveau champ accepte également un résolveur. Une collection qui comporte encore l'ancienne clé est rejetée par `defineCollection` avec l'erreur habituelle de clé inconnue.
:::

### Sélection de la propriété de titre
Lorsque `display.title` n'est pas défini, la propriété utilisée comme titre d'affichage de l'entité (aperçus, en-têtes) est résolue automatiquement :
1. Si `propertiesOrder` est explicitement défini, la première propriété dans cet ordre pouvant servir de titre est choisie : une `string`, une `relation` de cardinalité simple ou une `reference`. Les identifiants (clés primaires et étrangères, colonnes `uuid`, `isId`), les champs d'envoi de fichiers et les propriétés masquées ne sont jamais éligibles.
2. Si aucun `propertiesOrder` n'est défini, les mêmes candidats sont classés : une chaîne dont la clé évoque un libellé (`name`, `title`, `label`, …) en premier, puis un texte court simple, une adresse e-mail, une énumération, un texte long, un sélecteur de relation ou d'utilisateur, et une référence en dernier. En cas d'égalité, l'ordre de déclaration s'applique.

### Aperçus des relations dans les tableaux
Lorsque `propertiesOrder` est explicitement défini, les propriétés de relation ne sont **pas** automatiquement exclues des colonnes d'aperçu par défaut (alors qu'elles sont exclues des colonnes par défaut non ordonnées pour éviter des opérations de jointure lentes).

### Rendu d'une valeur de titre
Quel que soit le contenu de la propriété de titre, le panneau affiche une chaîne de caractères. Une date est formatée, un tableau est joint, et une relation — qui arrive sous la forme `{ id, data: { values } }` plutôt que sous forme de texte — est parcourue à la recherche de la première valeur parmi `name`, `title`, `label` ou `displayName` sur la ligne liée, puis de sa première valeur textuelle courte, en se repliant sur son id. Ainsi, un titre peut désigner une propriété `relation` et continuer à s'afficher sous forme de nom plutôt que d'un uuid.

Il ne s'agit pas d'un helper exporté : c'est ce que chaque surface qui affiche un enregistrement effectue déjà. Rien à appeler et rien à importer.

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

Le builder reçoit également `data`, qui lit les lignes telles que le serveur les envoie, à l'instar de `context.data` : `await data.collection("tenants").find()` renvoie `{ data: rows, meta }`.

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

        // Fixed filter — cannot be changed; filters the user applies
        // on other fields combine with it
        fixedFilter: { tenantId: ["==", currentTenantId] },

        // Default sort
        sort: ["createdAt", "desc"]
    }
});
```

L'utilisateur peut toujours filtrer une collection comportant un `fixedFilter` : tout ce qu'il applique sur d'autres champs y est combiné (ET), et les champs fixes restent verrouillés.

Un `fixedFilter` restreint ce que le panneau *demande* ; il ne constitue pas une limite de sécurité. Ce qu'un appelant est autorisé à lire relève d'une [règle de sécurité](/docs/collections/security-rules), que la base de données applique à tout appelant, qu'il passe par le panneau ou non.

## Nombre élevé de collections

Rien dans Rebase ne limite le nombre de collections, mais deux coûts augmentent avec celui-ci :

- **Le premier téléchargement de l'admin.** Le panneau a besoin de sa navigation dès qu'un utilisateur se connecte, de sorte que la configuration de chaque collection est intégrée dans le bundle que le navigateur récupère pour l'écran de connexion — environ 2,4 Ko minifiés chacune, donc 200 collections ajoutent environ 480 Ko, soit près de 80 Ko compressés en gzip. Ce dont l'ouverture d'une collection a besoin (le tableau, les vues d'enregistrement, le formulaire) ne se charge qu'à ce moment-là.
- **`rebase db push`.** Atlas planifie un push en calculant le diff de l'ensemble du schéma, et ce temps augmente plus vite que le nombre de tables : à 400 tables ou plus, un push prend plusieurs dizaines de secondes — voir [combien de temps prend un push](/docs/cli/schema#rebase-db-push).

## Étapes suivantes

- **[Callbacks d'entités](/docs/collections/callbacks)** — Hooks de cycle de vie pour synchroniser des données entre collections, validation, effets secondaires
- **[Propriétés](/docs/collections/properties)** — Tous les types de propriétés et options
- **[Relations](/docs/collections/relations)** — Clés étrangères, tables de jonction, jointures
- **[Règles de sécurité](/docs/collections/security-rules)** — Sécurité au niveau des lignes (Row Level Security)
- **[Modes d'affichage](/docs/frontend/view-modes)** — Liste, Tableau, Cartes, Kanban
