---
sourceHash: 2e2dfa451a30f422
title: Import et export de données
sidebar_label: Import et export de données
description: Importez des données depuis des fichiers CSV, JSON et Excel dans vos collections, et exportez les données de vos collections au format CSV ou JSON avec des champs calculés optionnels.
---

## Vue d'ensemble

Rebase inclut des outils intégrés d'importation et d'exportation de données accessibles directement depuis le panneau d'administration. L'importation prend en charge les fichiers CSV, JSON et Excel avec un assistant de mappage de colonnes. L'exportation prend en charge les formats CSV et JSON avec des champs calculés optionnels.

Les deux fonctionnalités sont disponibles sur chaque collection. L'exportation peut être configurée par collection avec des champs calculés ; aucune des deux ne peut être désactivée par collection.

## Importer des données

### Comment importer

1. Ouvrez une collection dans le panneau d'administration
2. Cliquez sur le bouton **Import** dans la barre d'outils
3. Sélectionnez ou glissez-déposez votre fichier
4. Mappez les colonnes du fichier aux propriétés de la collection
5. Prévisualisez les données et corrigez les éventuelles erreurs de validation
6. Cliquez sur **Import** pour enregistrer toutes les entités

### Formats pris en charge

| Format | Extensions | Remarques |
|--------|-----------|-------|
| CSV | `.csv` | Détection automatique des délimiteurs |
| JSON | `.json` | Attend un tableau d'objets |
| Excel | `.xlsx` | Lit la première feuille |

### Mappage des colonnes

L'assistant d'importation tente automatiquement de faire correspondre les colonnes du fichier aux propriétés de la collection par leur nom. Vous pouvez ajuster manuellement les correspondances avant d'importer :

- Les **correspondances exactes** sont mappées automatiquement (par ex. `name` → `name`)
- Les **colonnes non reconnues** peuvent être mappées manuellement ou ignorées
- La **coercition de type** gère la conversion de chaîne en nombre, de chaîne en booléen ainsi que l'analyse des dates

### Validation

Avant l'importation, l'assistant valide toutes les lignes par rapport aux définitions de propriétés de votre collection :

- Les champs obligatoires doivent être présents
- Les valeurs énumérées doivent correspondre aux options définies
- Les types de données doivent être compatibles (par exemple, une valeur textuelle pour un champ numérique sera signalée)
- Les erreurs de validation sont affichées ligne par ligne afin que vous puissiez les corriger avant l'importation

### Configuration de l'importation

L'importation est disponible sur chaque collection. Il n'existe aucun paramètre par collection permettant de la désactiver.

## Exporter des données

### Comment exporter

1. Ouvrez une collection dans le panneau d'administration
2. Appliquez éventuellement des filtres pour exporter un sous-ensemble de données
3. Cliquez sur le bouton **Export** dans la barre d'outils
4. Choisissez le format : **CSV** ou **JSON**
5. Le fichier se télécharge immédiatement

### Formats d'exportation

| Format | Description |
|--------|-------------|
| CSV | Valeurs séparées par des virgules, compatible avec Excel et Google Sheets |
| JSON | Tableau d'objets, utile pour une utilisation programmatique |

### Filtrer avant l'exportation

Tous les filtres actifs dans la vue de la collection sont appliqués à l'exportation. Cela vous permet d'exporter uniquement un sous-ensemble de vos données :

- Appliquez des filtres de colonne ou des termes de recherche dans la vue de la collection
- Cliquez sur **Export** — seules les lignes filtrées seront incluses

### Configuration de l'exportation

L'exportation est disponible sur chaque collection. `admin.exportable` permet de la configurer : fournissez-lui un `ExportConfig` pour ajouter des colonnes calculées, comme indiqué ci-dessous. Le type accepte également un booléen, mais rien ne le lit — `exportable: false` ne supprime pas le bouton **Export**.

### Ajouter des champs calculés

Utilisez l'objet `ExportConfig` pour ajouter des colonnes calculées personnalisées à vos exportations. Ces colonnes n'existent pas dans la base de données — elles sont calculées au moment de l'exportation :

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

Chaque entrée d'`additionalFields` comporte :

| Propriété | Type | Description |
|----------|------|-------------|
| `key` | `string` | Nom de la colonne dans l'exportation |
| `builder` | `({ entity, context }) => string \| Promise<string>` | Fonction qui calcule la valeur |

La fonction `builder` reçoit l'`entity` actuelle et le `RebaseContext` (qui inclut l'utilisateur authentifié), ce qui vous permet de calculer des valeurs en vous basant à la fois sur les données et sur les permissions.

### Champs calculés asynchrones

La fonction `builder` peut être asynchrone, ce qui est pratique lorsque la valeur calculée nécessite une recherche dans la base de données ou un appel d'API :

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

## Prochaines étapes

- **[Collections](/docs/collections)** — Définissez votre modèle de données
- **[Frontend Overview](/docs/frontend)** — Panneau d'administration et composants d'interface utilisateur
- **[Client SDK](/docs/sdk)** — Accès programmatique aux données
