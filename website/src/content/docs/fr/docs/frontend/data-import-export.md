---
sourceHash: a0b64d909e3d8229
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
5. Prévisualisez les données, y compris les valeurs qui ne peuvent pas être converties
6. Cliquez sur **Save data** pour écrire les lignes

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
- La **conversion de type** transforme chaque cellule dans le type de la propriété à laquelle elle est associée, mais uniquement lorsque rien n'est perdu (voir ci-dessous)

### Conversion de type

Une cellule n'est convertie que lorsque le type de la propriété peut contenir exactement ce qu'elle indique :

| Type de propriété | Convertit | Ne convertit pas |
|---|---|---|
| Nombre | `12`, `-3.5`, `10.00`, `1e3` | `02134` (un zéro initial serait perdu), les nombres de plus de 15 chiffres significatifs, `1,234`, `$5.00`, `12%`, `N/A` |
| Booléen | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, quelle que soit la casse | tout le reste |
| Date | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), dates en toutes lettres (`5 Jan 2024`), `05/01/2024`, secondes ou millisecondes epoch | un texte qui ne désigne aucune date |

Une date sans heure correspond à ce jour-là en UTC. Pour les dates écrites `05/01/2024`, c'est la colonne qui décide de l'ordre : un premier nombre supérieur à 12 fait de la colonne un format jour-mois, un second nombre supérieur à 12 en fait un format mois-jour. Quand une colonne ne le précise jamais, c'est la locale du navigateur qui décide, et quand elle contient les deux ordres, une date que l'un ou l'autre ordre pourrait lire n'est pas convertie.

Une cellule vide n'est pas une valeur : elle ne définit rien, et la valeur par défaut choisie pour cette propriété s'applique.

### Valeurs qui ne peuvent pas être importées

L'aperçu liste chaque cellule qui ne se convertit pas, par colonne, avec leur nombre et les premières d'entre elles par ligne et par raison. Ces cellules sont laissées vides dans les lignes importées ; rien n'est transformé en `0`, `false` ou une valeur vide sans être listé. Revenez en arrière pour associer la colonne à une autre propriété, ou corrigez le fichier et téléchargez-le à nouveau.

Les propres règles de la collection — champs obligatoires, options d'énumération, valeurs uniques — sont vérifiées par le serveur au fur et à mesure que les lignes sont écrites, par lots de 25. Si une ligne est refusée, l'importation s'arrête et la désigne ; les lignes qui la précèdent sont déjà enregistrées, et **Retry** reprend à partir de la ligne refusée.

### Créer une collection à partir d'un fichier

Lorsque vous créez une collection à partir d'un fichier, le type de chaque colonne est déduit de ses valeurs. Une colonne n'est un nombre que si chacune de ses valeurs est un nombre, ou un texte qui se convertit en un nombre exactement, si bien qu'une colonne de codes postaux, de codes produits à zéros initiaux, de longs SKU ou de numéros de téléphone reste du texte. Une colonne qui mélange les types (nombres et mots, booléens et nombres) est du texte. Les cellules vides ne comptent pas, si bien qu'une colonne majoritairement vide n'est pas marquée comme obligatoire.

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
- **[SDK typé](/docs/sdk)** — Accès programmatique aux données
