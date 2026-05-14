---
title: Propriétés
sidebar_label: Propriétés
description: Les types de propriétés définissent le type de données, la validation et le rendu de l'interface utilisateur pour chaque champ d'une collection. Rebase prend en charge les types chaîne de caractères, nombre, booléen, date, tableau, carte (map), référence, relation et géopoint.
---

## Vue d'ensemble

Les propriétés définissent les colonnes de votre table de base de données et la manière dont elles sont affichées dans l'interface utilisateur d'administration. Chaque propriété a un `type` qui détermine :

- Le **type de colonne de base de données** (via la génération de schéma Drizzle)
- Le composant de **champ de formulaire**
- Le rendu de la **cellule de tableau**
- Les règles de **validation**

## Types de propriétés

| Type | Description | Colonne PostgreSQL |
|------|-------------|-------------------|
| `string` | Texte, sélection, markdown, téléchargement de fichier, URL, e-mail | `varchar`, `text`, `jsonb` |
| `number` | Entier, décimal, devise | `integer`, `numeric`, `bigint`, `serial` |
| `boolean` | Interrupteur vrai/faux | `boolean` |
| `date` | Date, date et heure, horodatage | `timestamp`, `date` |
| `array` | Liste ordonnée de valeurs | `jsonb` |
| `map` | Objet clé-valeur | `jsonb` |
| `geopoint` | Paire latitude/longitude | `jsonb` |
| `reference` | Référence intégrée à une autre entité | `varchar` (stocke l'ID) |
| `relation` | Relation de clé étrangère SQL | Utilise le tableau `relations` |

## Propriétés communes

Tous les types de propriétés partagent ces options :

| Propriété | Type | Description |
|----------|------|-------------|
| `type` | `string` | **Obligatoire.** Type de données (voir ci-dessus) |
| `name` | `string` | **Obligatoire.** Étiquette d'affichage |
| `description` | `string` | Texte d'aide affiché sous le champ |
| `columnWidth` | `number` | Largeur de colonne en pixels (vue tableau) |
| `readOnly` | `boolean` | Empêche l'édition |
| `disabled` | `boolean \| PropertyDisabledConfig` | Désactiver avec info-bulle optionnelle |
| `hideFromCollection` | `boolean` | Masquer de la vue tableau |
| `defaultValue` | `any` | Valeur par défaut pour les nouvelles entités |
| `validation` | `object` | Règles de validation |
| `Field` | `React.ComponentType` | Composant de champ personnalisé |
| `Preview` | `React.ComponentType` | Composant de cellule de tableau personnalisé |
| `propertyConfig` | `string` | Clé de configuration de propriété enregistrée |
| `editable` | `boolean` | Activer l'édition en ligne dans le tableau (par défaut : true) |

## Propriétés de type chaîne de caractères

```typescript
name: {
    type: "string",
    name: "Name",
    validation: { required: true, min: 2, max: 200 }
}

description: {
    type: "string",
    name: "Description",
    multiline: true,       // Textarea
    markdown: true         // Markdown editor
}

category: {
    type: "string",
    name: "Category",
    enum: [
        { id: "electronics", label: "Electronics", color: "blueDark" },
        { id: "clothing", label: "Clothing", color: "pinkLight" },
    ]
}

email: {
    type: "string",
    name: "Email",
    email: true,           // Email validation
    validation: { required: true }
}

website: {
    type: "string",
    name: "Website",
    url: true              // URL validation
}

avatar: {
    type: "string",
    name: "Avatar",
    storage: {             // File upload
        storagePath: "avatars",
        acceptedFiles: ["image/*"],
        maxSize: 2 * 1024 * 1024
    }
}
```

### Options de chaîne de caractères

| Propriété | Type | Description |
|----------|------|-------------|
| `multiline` | `boolean` | Rendu en tant que zone de texte (textarea) |
| `markdown` | `boolean` | Rendu en tant qu'éditeur Markdown |
| `email` | `boolean` | Validation du format e-mail |
| `url` | `boolean` | Validation du format URL |
| `storage` | `StorageConfig` | Activer le téléchargement de fichiers |
| `enum` | `EnumValues` | Rendu en tant que liste déroulante (select) |
| `multiSelect` | `boolean` | Autoriser plusieurs sélections d'énumérations |
| `columnType` | `string` | Colonne de base de données : `"varchar"`, `"text"` |
| `isId` | `string` | Génération d'ID : `"uuid"`, `"cuid"`, `"increment"`, `"manual"` |
| `userSelect` | `boolean` | Rendu en tant que sélecteur d'utilisateur |
| `previewAsTag` | `boolean` | Afficher cette chaîne comme une étiquette dans les aperçus |
| `clearable` | `boolean` | Ajouter une icône pour effacer la valeur (définir à null) |

## Propriétés de type nombre

```typescript
price: {
    type: "number",
    name: "Price",
    validation: { required: true, min: 0 }
}

quantity: {
    type: "number",
    name: "Quantity",
    columnType: "integer"  // Store as integer
}
```

### Options de nombre

| Propriété | Type | Description |
|----------|------|-------------|
| `enum` | `EnumValues` | Rendu en tant que liste déroulante avec des valeurs numériques |
| `columnType` | `string` | `"integer"`, `"bigint"`, `"numeric"`, `"serial"`, `"smallint"` |
| `isId` | `string` | Stratégie de génération d'ID |
| `clearable` | `boolean` | Ajouter une icône pour effacer la valeur (définir à null) |

## Propriétés de type booléen

```typescript
active: {
    type: "boolean",
    name: "Active",
    defaultValue: true
}
```

![Champ Interrupteur](/img/fields/Switch.png)

## Propriétés de type date

```typescript
created_at: {
    type: "date",
    name: "Created At",
    autoValue: "on_create",   // Set automatically on creation
    readOnly: true
}

updated_at: {
    type: "date",
    name: "Updated At",
    autoValue: "on_update"    // Set automatically on every save
}

event_date: {
    type: "date",
    name: "Event Date",
    mode: "date"              // Date only (no time)
}
```

![Champ Date](/img/fields/Date.png)

### Options de date

| Propriété | Type | Description |
|----------|------|-------------|
| `mode` | `"date" \| "date_time"` | Date seule ou date + heure (par défaut : `"date_time"`) |
| `autoValue` | `"on_create" \| "on_update"` | Horodatages définis automatiquement |
| `columnType` | `string` | `"timestamp"`, `"date"` |
| `timezone` | `string` | Chaîne de fuseau horaire pour évaluer la date |
| `clearable` | `boolean` | Ajouter une icône pour effacer la valeur (définir à null) |

## Propriétés de type tableau

```typescript
tags: {
    type: "array",
    name: "Tags",
    of: { type: "string" }    // Array of strings
}

images: {
    type: "array",
    name: "Images",
    of: {
        type: "string",
        storage: { storagePath: "images", acceptedFiles: ["image/*"] }
    }
}

// Block editor (multiple types)
content: {
    type: "array",
    name: "Content Blocks",
    oneOf: {
        properties: {
            text: {
                type: "map",
                properties: {
                    body: { type: "string", name: "Body", markdown: true }
                }
            },
            image: {
                type: "map",
                properties: {
                    src: { type: "string", name: "Image", storage: { ... } },
                    caption: { type: "string", name: "Caption" }
                }
            }
        }
    }
}
```

![Champ Bloc](/img/fields/Block.png)

### Options de tableau

| Propriété | Type | Description |
|----------|------|-------------|
| `of` | `Property \| Property[]` | Schéma de propriété pour les éléments du tableau |
| `oneOf` | `object` | Tableau d'objets typés avec plusieurs types de discriminateurs |
| `expanded` | `boolean` | Le champ doit-être initialement développé (par défaut : true) |
| `minimalistView` | `boolean` | Afficher les propriétés enfants directement sans panneau extensible |
| `sortable` | `boolean` | Les éléments peuvent-ils être réordonnés (par défaut : true) |
| `canAddElements` | `boolean` | De nouveaux éléments peuvent-ils être ajoutés (par défaut : true) |

## Propriétés de type carte (Map)

```typescript
address: {
    type: "map",
    name: "Address",
    properties: {
        street: { type: "string", name: "Street" },
        city: { type: "string", name: "City" },
        zip: { type: "string", name: "ZIP Code" },
        country: { type: "string", name: "Country" }
    }
}

metadata: {
    type: "map",
    name: "Metadata",
    keyValue: true    // Free-form key-value editor
}
```

![Champ Groupe](/img/fields/Group.png)

### Options de carte (Map)

| Propriété | Type | Description |
|----------|------|-------------|
| `properties` | `Properties` | Enregistrement des propriétés incluses dans la carte |
| `propertiesOrder` | `string[]` | Clés ordonnées pour le rendu |
| `previewProperties` | `string[]` | Propriétés à afficher dans l'aperçu du tableau |
| `pickOnlySomeKeys` | `boolean` | Permettre à l'utilisateur d'ajouter sélectivement des clés dans l'interface utilisateur |
| `spreadChildren` | `boolean` | Afficher les propriétés enfants comme des colonnes séparées dans la vue tableau |
| `minimalistView` | `boolean` | Afficher les propriétés sans panneau d'encapsulation |
| `expanded` | `boolean` | Le champ doit-être initialement développé (par défaut : true) |
| `keyValue` | `boolean` | Rendu en tant qu'éditeur de paires clé-valeur arbitraires |

## Valeurs d'énumération

Utilisé avec les propriétés de type chaîne de caractères ou nombre pour afficher les listes déroulantes :

```typescript
// Simple array
enum: ["draft", "published", "archived"]

// With labels
enum: [
    { id: "draft", label: "Draft" },
    { id: "published", label: "Published" },
    { id: "archived", label: "Archived" }
]

// With colors (for Kanban columns and chips)
enum: [
    { id: "draft", label: "Draft", color: "grayDark" },
    { id: "published", label: "Published", color: "greenDark" },
    { id: "archived", label: "Archived", color: "orangeDark" }
]
```

![Champ Sélection](/img/fields/Select.png)

## Validation

```typescript
validation: {
    required: true,             // Field is required
    unique: true,               // Must be unique in the table
    requiredMessage: "Custom error message",

    // String-specific
    min: 2,                     // Minimum length
    max: 200,                   // Maximum length
    matches: /^[a-z]+$/,       // Regex pattern
    email: true,                // Email format
    url: true,                  // URL format

    // Number-specific
    min: 0,                     // Minimum value
    max: 1000,                  // Maximum value
    integer: true,              // Must be integer

    // Array-specific
    min: 1,                     // Minimum items
    max: 10,                    // Maximum items
}
```

## Champs conditionnels

Vous pouvez rendre les champs dynamiques afin qu'ils réagissent aux valeurs de l'entité. Il existe deux façons de procéder :

### 1. Conditions JSON Logic (Déclaratives)

Vous pouvez utiliser la propriété `conditions` pour définir des règles JSON Logic déclaratives qui peuvent être sérialisées et modifiées visuellement dans l'éditeur de collection.

```typescript
price: {
    type: "number",
    name: "Price",
    conditions: {
        disabled: { "==": [{ "var": "values.is_free" }, true] },
        required: { "!=": [{ "var": "values.is_free" }, true] },
        min: 0,
        clearOnDisabled: true // Set to null if field gets disabled
    }
}
```

L'objet conditions vous donne accès à :
- `disabled`, `hidden`, `readOnly`
- `required`, `min`, `max`
- `defaultValue`
- `enumConditions`, `allowedEnumValues`, `excludedEnumValues`
- `referencePath`, `referenceFilter`
- `canAddElements`, `sortable` (pour les tableaux)

### 2. Constructeurs de propriétés (Programmatiques)

Pour un comportement complexe qui ne peut pas être exprimé via JSON Logic, vous pouvez utiliser `dynamicProps` qui évalue une fonction Javascript.

```typescript
price: {
    type: "number",
    name: "Price",
    dynamicProps: ({ values, user }) => ({
        disabled: values.is_free === true || !user.roles.includes("admin"),
        validation: values.is_free ? {} : { required: true, min: 0 }
    })
}
```

## Prochaines étapes

- **[Relations](/docs/collections/relations)** — Clés étrangères et jointures
- **[Règles de sécurité](/docs/collections/security-rules)** — Sécurité au niveau des lignes
- **[Champs personnalisés](/docs/frontend/custom-fields)** — Créer des composants de champs personnalisés
