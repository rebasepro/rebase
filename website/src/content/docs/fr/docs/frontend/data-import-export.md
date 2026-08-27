---
title: Import et export de données
sidebar_label: Import et export de données
description: Importez des données à partir de fichiers CSV, JSON et Excel dans vos collections, et exportez les données de collection vers CSV ou JSON avec des champs calculés optionnels.
---

## Vue d'ensemble

Rebase inclut des outils intégrés d'import et d'export de données accessibles directement depuis le panneau d'administration. L'import prend en charge les fichiers CSV, JSON et Excel avec un assistant de mappage de colonnes. L'export prend en charge CSV et JSON avec des champs calculés optionnels.

Les deux fonctionnalités sont activées par défaut sur toutes les collections et peuvent être configurées ou désactivées par collection.

## Importation de données

### Comment importer

1. Ouvrez une collection dans le panneau d'administration
2. Cliquez sur le bouton **Importer** dans la barre d'outils
3. Sélectionnez ou glissez-déposez votre fichier
4. Mappez les colonnes du fichier aux propriétés de la collection
5. Prévisualisez les données et résolvez les éventuelles erreurs de validation
6. Cliquez sur **Importer** pour enregistrer toutes les entités

### Formats pris en charge

| Format | Extensions | Notes |
|--------|-----------|-------|
| CSV | `.csv` | Détecte automatiquement les délimiteurs |
| JSON | `.json` | Attend un tableau d'objets |
| Excel | `.xlsx` | Lit la première feuille |

### Mappage de colonnes

L'assistant d'import tente automatiquement de faire correspondre les colonnes du fichier aux propriétés de la collection par nom. Vous pouvez ajuster les mappages manuellement avant l'import :

- Les **correspondances exactes** sont mappées automatiquement (par ex. `name` → `name`)
- Les **colonnes non appariées** peuvent être mappées manuellement ou ignorées
- La **coercition de type** gère la conversion chaîne-vers-nombre, chaîne-vers-booléen et l'analyse des dates

### Validation

Avant l'import, l'assistant valide toutes les lignes par rapport aux définitions de propriétés de votre collection :

- Les champs requis doivent être présents
- Les valeurs enum doivent correspondre aux options définies
- Les types de données doivent être compatibles (par ex. une valeur texte pour un champ numérique est signalée)
- Les erreurs de validation sont affichées par ligne afin que vous puissiez les corriger avant l'import

### Configuration de l'import

L'import est activé par défaut. Pour le désactiver sur une collection spécifique, utilisez le sous-objet `admin` :

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    // Import is enabled by default
});
```

## Exportation de données

### Comment exporter

1. Ouvrez une collection dans le panneau d'administration
2. Appliquez éventuellement des filtres pour exporter un sous-ensemble de données
3. Cliquez sur le bouton **Exporter** dans la barre d'outils
4. Choisissez le format : **CSV** ou **JSON**
5. Le fichier se télécharge immédiatement

### Formats d'export

| Format | Description |
|--------|-------------|
| CSV | Valeurs séparées par des virgules, compatible avec Excel et Google Sheets |
| JSON | Tableau d'objets, utile pour la consommation programmatique |

### Filtrage avant l'export

Tous les filtres actifs dans la vue de collection sont appliqués à l'export. Cela vous permet d'exporter uniquement un sous-ensemble de vos données :

- Appliquez des filtres de colonne ou des termes de recherche dans la vue de collection
- Cliquez sur **Exporter** — seules les lignes filtrées sont incluses

### Configuration de l'export

L'export est activé par défaut. Vous pouvez le configurer avec des champs calculés supplémentaires :

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: true            // Enable (default: true)
    }
});

```

Pour désactiver l'export :

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: false
    }
});

```

### Ajout de champs calculés

Utilisez l'objet `ExportConfig` pour ajouter des colonnes calculées personnalisées à vos exports. Ces colonnes n'existent pas dans la base de données — elles sont calculées au moment de l'export :

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: {
            additionalFields: [
                {
                    key: "computed_margin",
                    builder: ({ entity }) => {
                        const price = entity.values.price as number;
                        const cost = entity.values.cost as number;
                        return String(price - cost);
                    }
                },
                {
                    key: "full_url",
                    builder: ({ entity }) => {
                        return `https://mystore.com/products/${entity.id}`;
                    }
                }
            ]
        }
    }
});

```

Chaque entrée `additionalFields` a :

| Propriété | Type | Description |
|----------|------|-------------|
| `key` | `string` | Nom de la colonne dans l'export |
| `builder` | `({ entity, context }) => string \| Promise<string>` | Fonction qui calcule la valeur |

La fonction `builder` reçoit l'`entity` actuelle et le `RebaseContext` (qui inclut l'utilisateur authentifié), vous pouvez donc calculer des valeurs en fonction à la fois des données et des permissions.

### Champs calculés asynchrones

La fonction `builder` peut être asynchrone, ce qui est utile lorsque la valeur calculée nécessite une recherche en base de données ou un appel d'API :

```typescript
exportable: {
    additionalFields: [
        {
            key: "author_name",
            builder: async ({ entity, context }) => {
                const author = await context.data.users.findById(
                    entity.values.authorId as string
                );
                return author?.values.displayName ?? "Unknown";
            }
        }
    ]
}
```

## Étapes suivantes

- **[Collections](/docs/collections)** — Définissez votre modèle de données
- **[Aperçu du frontend](/docs/frontend)** — Panneau d'administration et composants d'UI
- **[SDK client](/docs/sdk)** — Accès programmatique aux données
