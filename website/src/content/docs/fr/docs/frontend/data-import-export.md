---
sourceHash: 3c4991a6d78c115c
title: Import & Export de données
sidebar_label: Import & Export de données
description: Importez des données depuis des fichiers CSV, JSON et Excel dans vos collections, et exportez les données de collections en CSV ou JSON avec des champs calculés optionnels.
---

## Vue d'ensemble

Rebase intègre des outils d'importation et d'exportation de données accessibles directement depuis le panneau d'administration. L'importation prend en charge les fichiers CSV, JSON et Excel avec un assistant de mappage de colonnes. L'exportation prend en charge le CSV et le JSON avec des champs calculés optionnels.

Les deux sont disponibles sur chaque collection. L'exportation peut être configurée par collection avec des champs calculés, ou désactivée avec `exportable: false` ; l'importation ne peut pas être désactivée par collection.

## Importer des données

### Comment importer

1. Ouvrez une collection dans le panneau d'administration
2. Cliquez sur le bouton **Import** dans la barre d'outils
3. Sélectionnez ou glissez-déposez votre fichier
4. Mappez les colonnes du fichier aux propriétés de la collection
5. Prévisualisez les données, y compris les valeurs qui ne peuvent pas être converties
6. Cliquez sur **Save data** pour enregistrer les lignes

### Formats pris en charge

| Format | Extensions | Notes |
|--------|-----------|-------|
| CSV | `.csv` | Détection automatique des délimiteurs |
| JSON | `.json` | Attend un tableau d'objets |
| Excel | `.xlsx` | Lit la première feuille |

### Mappage des colonnes

L'assistant d'importation tente automatiquement de faire correspondre les colonnes du fichier aux propriétés de la collection par leur nom. Vous pouvez ajuster manuellement les mappages avant d'importer :

- Les **correspondances exactes** sont mappées automatiquement (par ex. `name` → `name`)
- Les **colonnes sans correspondance** peuvent être mappées manuellement ou ignorées
- La **conversion de type** transforme chaque cellule dans le type de la propriété à laquelle elle correspond, mais uniquement lorsque rien n'est perdu (voir ci-dessous)

### Conversion de type

Une cellule n'est convertie que lorsque le type de la propriété peut contenir exactement ce qu'elle indique :

| Type de propriété | Convertit | Ne convertit pas |
|---|---|---|
| Number | `12`, `-3.5`, `10.00`, `1e3` | `02134` (un zéro initial serait perdu), nombres de plus de 15 chiffres significatifs, `1,234`, `$5.00`, `12%`, `N/A` |
| Boolean | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, quelle que soit la casse | tout le reste |
| Date | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), dates écrites en toutes lettres (`5 Jan 2024`), `05/01/2024`, secondes ou millisecondes epoch | texte qui ne désigne aucune date |
| Geopoint | l'objet écrit par l'export, `{"latitude": 41.9, "longitude": 12.5}`, ou son JSON dans une cellule CSV | tout le reste, ou une coordonnée hors limites |
| Map sans champs déclarés | un objet, ou son JSON dans une cellule CSV | tout le reste |
| Vector | une liste de nombres (`[0.1, 0.2]`, `0.1, 0.2`), ou le `{"value": [0.1, 0.2]}` de l'export | une liste contenant tout élément qui n'est pas un nombre |

Une date sans heure correspond à ce jour en UTC. Pour les dates écrites sous la forme `05/01/2024`, la colonne détermine l'ordre : un premier nombre supérieur à 12 impose le jour en premier, un second nombre supérieur à 12 impose le mois en premier. Lorsqu'une colonne ne permet pas de trancher, les paramètres régionaux du navigateur décident, et lorsqu'elle contient les deux ordres, une date qui pourrait être lue selon l'un ou l'autre n'est pas convertie.

Une cellule vide n'a pas de valeur : elle ne définit rien, et la valeur par défaut choisie pour cette propriété s'applique.

Un fichier exporté depuis une collection se réimporte avec les mêmes valeurs, qu'il soit en CSV ou en JSON. Une map avec des champs déclarés est lue à raison d'une colonne par champ (`address.street`), telle qu'écrite par l'export ; toute autre valeur, y compris un geopoint ou une map clé-valeur, correspond à une seule colonne. Un nombre epoch compris entre -100 000 000 000 et 100 000 000 000 est interprété comme des secondes, de sorte qu'une date comprise entre le 31 octobre 1966 et le 3 mars 1973 exportée sous forme de timestamp ne sera pas restituée à l'identique : exportez ces dates sous forme de texte. Un champ heure de la journée (time-of-day) interprète un nombre inférieur à un jour (86 400 000) comme le nombre de millisecondes depuis minuit généré par l'export.

### Valeurs qui ne peuvent pas être importées

L'aperçu liste chaque cellule qui ne peut pas être convertie, par colonne, en indiquant leur nombre ainsi que les premières occurrences par ligne et par motif. Ces cellules sont laissées vides dans les lignes importées ; rien n'est transformé en `0`, `false` ou valeur vide sans être listé. Revenez en arrière pour mapper la colonne à une autre propriété, ou corrigez le fichier et téléversez-le à nouveau.

Les règles propres à la collection — champs obligatoires, options d'enum, valeurs uniques — sont vérifiées par le serveur lors de l'écriture des lignes, par lots pouvant aller jusqu'à 500 lignes (moins si les lignes sont volumineuses, afin qu'une requête reste sous environ 1 Mo). Un lot est enregistré en totalité ou pas du tout. Si une ligne est refusée, l'importation s'arrête et la signale ; les lots précédents sont déjà enregistrés, et **Retry** reprend à partir de la première ligne du lot de la ligne refusée.

Une ligne dont l'id existe déjà dans la collection met à jour cet enregistrement : les colonnes présentes dans le fichier sont écrites, et les autres conservent leurs valeurs enregistrées, ainsi un fichier contenant `id,price` permet de modifier le prix de produits existants sans répéter leurs champs obligatoires. Une nouvelle ligne nécessite toujours l'ensemble de ses champs obligatoires. Un lot qui mélange des mises à jour et de nouvelles lignes est écrit en deux requêtes, de sorte qu'une nouvelle ligne refusée peut laisser les mises à jour de ce lot enregistrées ; **Retry** les réécrit avec les mêmes valeurs.

### Importer des utilisateurs

Une nouvelle ligne dans la collection des utilisateurs équivaut à la création d'un utilisateur : une colonne `password` est hachée, jamais stockée en clair, et une ligne sans mot de passe reçoit un mot de passe généré ou une invitation, comme lorsqu'un administrateur ajoute un utilisateur. Les mots de passe d'un tel fichier ont généralement été définis selon les règles d'un autre système, de sorte que l'importation demande au serveur d'ignorer la [politique de mot de passe](/docs/backend/auth-endpoints/#password-policy) pour ces lignes. Le serveur n'accepte que si vous êtes administrateur ; toute autre personne important des utilisateurs est soumise à la politique, et un mot de passe faible interrompt l'importation avec l'erreur `WEAK_PASSWORD`.

### Créer une collection à partir d'un fichier

Lorsque vous créez une collection à partir d'un fichier, le type de chaque colonne est déduit de ses valeurs. Une colonne n'est de type number que si chaque valeur qu'elle contient est un nombre ou un texte qui se convertit exactement en nombre ; ainsi, une colonne de codes postaux, de codes produits avec des zéros initiaux, de longs SKU ou de numéros de téléphone reste au format text. Une colonne mélangeant les types (nombres et mots, booléens et nombres) reste du texte. Les cellules vides ne sont pas prises en compte, de sorte qu'une colonne principalement vide n'est pas marquée comme obligatoire. Une colonne d'entiers dont le nom se termine par un mot indiquant qu'elle contient une date ou un instant (`created_at`, `updatedAt`, `signup_date`, `timestamp`) devient une date lorsque chaque valeur est un horodatage epoch compris entre 2001 et 2103, en secondes ou en millisecondes ; sous tout autre nom, ou avec toute autre valeur, elle reste un nombre.

### Configuration de l'importation

L'importation est disponible sur chaque collection. Aucun paramètre par collection ne permet de la désactiver.

## Exporter des données

### Comment exporter

1. Ouvrez une collection dans le panneau d'administration
2. Vous pouvez éventuellement appliquer des filtres pour exporter un sous-ensemble de données
3. Cliquez sur le bouton **Export** dans la barre d'outils
4. Choisissez le format : **CSV** ou **JSON**
5. Le fichier est téléchargé immédiatement

### Formats d'exportation

| Format | Description |
|--------|-------------|
| CSV | Valeurs séparées par des virgules, compatibles avec Excel et Google Sheets |
| JSON | Tableau d'objets, utile pour une utilisation programmatique |

### Filtrage avant l'exportation

Tous les filtres actifs dans la vue de la collection sont appliqués à l'exportation. Cela vous permet d'exporter uniquement un sous-ensemble de vos données :

- Appliquez des filtres de colonnes ou des termes de recherche dans la vue de la collection
- Cliquez sur **Export** — seules les lignes filtrées sont incluses

### Configuration de l'exportation

L'exportation est disponible sur chaque collection, sauf si vous la désactivez. `admin.exportable` permet de la configurer : `exportable: false` supprime le bouton **Export**, et un objet `ExportConfig` le conserve tout en ajoutant des colonnes calculées, comme détaillé ci-dessous.

### Ajouter des champs calculés

Utilisez l'objet `ExportConfig` pour ajouter des colonnes calculées personnalisées à vos exports. Ces colonnes n'existent pas dans la base de données — elles sont calculées au moment de l'exportation :

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
                    builder: ({ row }) => {
                        const price = Number(row.price ?? 0);
                        const cost = Number(row.cost ?? 0);
                        return String(price - cost);
                    }
                },
                {
                    key: "full_url",
                    builder: ({ row }) => {
                        return `https://mystore.com/products/${String(row.id)}`;
                    }
                }
            ]
        }
    }
});

```

Chaque entrée de `additionalFields` comporte :

| Propriété | Type | Description |
|----------|------|-------------|
| `key` | `string` | Nom de la colonne dans l'export |
| `builder` | `({ row, context }) => string \| Promise<string>` | Fonction qui calcule la valeur |

La fonction `builder` reçoit chaque enregistrement exporté sous la forme `row`, tel qu'envoyé par le serveur (les dates sous forme de chaînes ISO, une relation belongsTo sous forme de sa colonne de clé étrangère, `id` inclus), ainsi que le `RebaseContext` (qui inclut l'utilisateur authentifié), vous permettant ainsi de calculer des valeurs basées à la fois sur les données et sur les autorisations.

### Champs calculés asynchrones

La fonction `builder` peut être asynchrone, ce qui est utile lorsque la valeur calculée nécessite une recherche en base de données ou un appel d'API :

```typescript
exportable: {
    additionalFields: [
        {
            key: "author_name",
            builder: async ({ row, context }) => {
                const author = await context.data.users.findById(String(row.authorId));
                // `context.data` returns the row itself: its columns are on it.
                return String(author?.displayName ?? "Unknown");
            }
        }
    ]
}
```

## Prochaines étapes

- **[Collections](/docs/collections)** — Définissez votre modèle de données
- **[Frontend Overview](/docs/frontend)** — Panneau d'administration et composants d'interface
- **[Typed SDK](/docs/sdk)** — Accès programmatique aux données
