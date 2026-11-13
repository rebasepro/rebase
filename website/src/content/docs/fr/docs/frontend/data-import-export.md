---
sourceHash: 66fc9b42bef4d463
title: Importation et exportation de données
sidebar_label: Importation et exportation de données
description: Importez des données depuis des fichiers CSV, JSON et Excel dans vos collections, et exportez les données de vos collections au format CSV ou JSON avec des champs calculés optionnels.
---

## Vue d'ensemble

Rebase intègre des outils d'importation et d'exportation de données accessibles directement depuis le panneau d'administration. L'importation prend en charge les fichiers CSV, JSON et Excel avec un assistant de mappage de colonnes. L'exportation prend en charge les formats CSV et JSON avec des champs calculés optionnels.

Les deux fonctionnalités sont disponibles sur chaque collection. L'exportation peut être configurée par collection avec des champs calculés, ou désactivée avec `exportable: false` ; l'importation ne peut pas être désactivée par collection.

## Importer des données

### Comment importer

1. Ouvrez une collection dans le panneau d'administration
2. Cliquez sur le bouton **Import** dans la barre d'outils
3. Sélectionnez ou glissez-déposez votre fichier
4. Mappez les colonnes du fichier aux propriétés de la collection
5. Prévisualisez les données, y compris les valeurs qui ne peuvent pas être converties
6. Cliquez sur **Save data** pour enregistrer les lignes

### Formats pris en charge

| Format | Extensions | Remarques |
|--------|-----------|-------|
| CSV | `.csv` | Détecte automatiquement les délimiteurs |
| JSON | `.json` | Attend un tableau d'objets |
| Excel | `.xlsx` | Lit la première feuille |

### Mappage des colonnes

L'assistant d'importation tente automatiquement de faire correspondre les colonnes du fichier aux propriétés de la collection par leur nom. Vous pouvez ajuster manuellement les correspondances avant l'importation :

- Les **correspondances exactes** sont associées automatiquement (ex. `name` → `name`)
- Les **colonnes non associées** peuvent être mappées manuellement ou ignorées
- La **conversion de type** transforme chaque cellule dans le type de la propriété à laquelle elle est associée, mais uniquement lorsque rien n'est perdu (voir ci-dessous)

### Conversion de type

Une cellule n'est convertie que si le type de la propriété peut contenir exactement ce qu'elle indique :

| Type de propriété | Convertit | Ne convertit pas |
|---|---|---|
| Number | `12`, `-3.5`, `10.00`, `1e3` | `02134` (un zéro initial serait perdu), les nombres comportant plus de 15 chiffres significatifs, `1,234`, `$5.00`, `12%`, `N/A` |
| Boolean | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, quelle que soit la casse | toute autre valeur |
| Date | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), dates écrites en toutes lettres (`5 Jan 2024`), `05/01/2024`, secondes ou millisecondes epoch | texte qui ne correspond à aucune date |
| Geopoint | l'objet généré par l'exportation, `{"latitude": 41.9, "longitude": 12.5}`, ou son format JSON dans une cellule CSV | toute autre valeur, ou une coordonnée hors limites |
| Map sans champs déclarés | un objet, ou son format JSON dans une cellule CSV | toute autre valeur |
| Vector | une liste de nombres (`[0.1, 0.2]`, `0.1, 0.2`), ou le format d'exportation `{"value": [0.1, 0.2]}` | une liste contenant tout élément qui n'est pas un nombre |

Une date sans heure correspond à ce jour en UTC. Pour les dates écrites sous la forme `05/01/2024`, la colonne détermine l'ordre : un premier nombre supérieur à 12 indique que le jour est en premier, un second nombre supérieur à 12 indique que le mois est en premier. Si la colonne ne permet pas de trancher, les paramètres régionaux du navigateur décident ; lorsqu'elle contient les deux ordres, une date qui pourrait être lue dans l'un ou l'autre ordre n'est pas convertie.

Une cellule vide équivaut à aucune valeur : elle ne définit rien, et la valeur par défaut choisie pour cette propriété s'applique.

Un fichier exporté depuis une collection se réimporte avec les mêmes valeurs, qu'il s'agisse d'un CSV ou d'un JSON. Une map avec des champs déclarés est lue à raison d'une colonne par champ (`address.street`), telle que générée par l'exportation ; toute autre valeur, y compris un geopoint ou une map clé-valeur, correspond à une seule colonne. Un nombre epoch compris entre -100 000 000 000 et 100 000 000 000 est lu comme des secondes, de sorte qu'une date comprise entre le 31 octobre 1966 et le 3 mars 1973 exportée sous forme d'horodatage ne revient pas à l'identique : exportez ces dates sous forme de texte. Un champ d'heure de la journée lit un nombre inférieur à un jour (86 400 000) comme le nombre de millisecondes depuis minuit tel qu'écrit par l'exportation.

### Valeurs ne pouvant pas être importées

L'aperçu liste chaque cellule non convertie, par colonne, en indiquant leur nombre total ainsi que les premières par ligne et par motif. Ces cellules sont laissées vides dans les lignes importées ; rien n'est transformé en `0`, `false` ou valeur vide sans être répertorié. Revenez en arrière pour associer la colonne à une autre propriété, ou corrigez le fichier et téléversez-le à nouveau.

Les règles propres à la collection — champs obligatoires, options d'énumération, valeurs uniques — sont vérifiées par le serveur lors de l'écriture des lignes, par lots pouvant atteindre 500 lignes (moins si les lignes sont volumineuses, afin qu'une requête reste sous environ 1 Mo). Un lot est enregistré en totalité ou pas du tout. Si une ligne est rejetée, l'importation s'arrête et la nomme ; les lots précédents sont déjà enregistrés, et **Retry** reprend à partir de la première ligne du lot rejeté.

Une ligne dont l'id existe déjà dans la collection met à jour cet enregistrement : les colonnes présentes dans le fichier sont écrites, et les autres conservent leurs valeurs stockées, de sorte qu'un fichier contenant `id,price` met à jour le prix de produits existants sans répéter leurs champs obligatoires. Une nouvelle ligne nécessite toujours tous les champs obligatoires. Un lot mélangeant des mises à jour et de nouvelles lignes est écrit en deux requêtes, de sorte qu'une nouvelle ligne rejetée peut laisser les mises à jour de ce lot enregistrées ; **Retry** les réécrit avec les mêmes valeurs.

### Importer des utilisateurs

Une nouvelle ligne dans la table des utilisateurs constitue une création d'utilisateur : la colonne `password` est hachée, jamais stockée telle quelle, et une ligne sans mot de passe reçoit un mot de passe généré ou une invitation, comme lorsqu'un administrateur ajoute un utilisateur. Les mots de passe d'un tel fichier ayant généralement été définis selon les règles d'un autre système, l'importation demande au serveur d'ignorer la [politique de mots de passe](/docs/backend/auth-endpoints/#password-policy) pour ces lignes. Le serveur n'accepte que si vous êtes administrateur ; toute autre personne important des utilisateurs est soumise à la politique, et un mot de passe faible interrompt l'importation avec l'erreur `WEAK_PASSWORD`.

### Créer une collection à partir d'un fichier

Lorsque vous créez une collection à partir d'un fichier, le type de chaque colonne est déduit de ses valeurs. Une colonne n'est un nombre que si chaque valeur qu'elle contient est un nombre ou un texte qui se convertit exactement en nombre ; ainsi, une colonne de codes postaux, de codes produits avec des zéros initiaux, de SKU longs ou de numéros de téléphone reste du texte. Une colonne qui mélange les types (nombres et mots, booléens et nombres) reste du texte. Les cellules vides ne comptent pas, de sorte qu'une colonne en grande partie vide n'est pas marquée comme obligatoire. Une colonne de nombres entiers dont le nom se termine par un mot indiquant un instant (`created_at`, `updatedAt`, `signup_date`, `timestamp`) devient une date lorsque chaque valeur est un horodatage epoch compris entre 2001 et 2103, en secondes ou en millisecondes ; sous tout autre nom, ou avec toute autre valeur, elle reste un nombre.

### Configuration de l'importation

L'importation est disponible sur chaque collection. Il n'existe aucun paramètre par collection permettant de la désactiver.

## Exporter des données

### Comment exporter

1. Ouvrez une collection dans le panneau d'administration
2. Si besoin, appliquez des filtres pour exporter un sous-ensemble de données
3. Cliquez sur le bouton **Export** dans la barre d'outils
4. Choisissez le format : **CSV** ou **JSON**
5. Le fichier se télécharge immédiatement

### Formats d'exportation

| Format | Description |
|--------|-------------|
| CSV | Valeurs séparées par des virgules, compatibles avec Excel et Google Sheets |
| JSON | Tableau d'objets, utile pour une utilisation programmatique |

### Filtrer avant l'exportation

Tous les filtres actifs dans la vue de la collection sont appliqués à l'exportation. Cela vous permet d'exporter uniquement un sous-ensemble de vos données :

- Appliquez des filtres de colonnes ou des termes de recherche dans la vue de la collection
- Cliquez sur **Export** — seules les lignes filtrées sont incluses

### Configuration de l'exportation

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

L'exportation est disponible sur chaque collection, sauf si vous la désactivez. La propriété `exportable` dans `customizeTable` permet de la configurer : `exportable: false` supprime le bouton **Export**, tandis qu'un objet `ExportConfig` le conserve et ajoute des colonnes calculées.

### Ajouter des champs calculés

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`additionalFields` ajoute des colonnes qui n'existent pas dans la table ; chacune est calculée au moment de l'exportation et peut être asynchrone :

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";

export const productsCms = customizeTable<typeof products>("products", {
    exportable: {
        additionalFields: [
            {
                key: "computed_margin",
                builder: ({ row }) => String(Number(row.price ?? 0) - Number(row.cost ?? 0))
            },
            {
                key: "full_url",
                builder: ({ id }) => `https://mystore.com/products/${id}`
            },
            {
                key: "author_name",
                builder: async ({ row, context }) => {
                    const author = await context.data.users.findById(String(row.authorId));
                    // `context.data` returns the row itself: its columns are on it.
                    return String(author?.displayName ?? "Unknown");
                }
            }
        ]
    },
});
```

Chaque entrée de `additionalFields` comprend :

| Propriété | Type | Description |
|-----------|------|-------------|
| `key` | `string` | Nom de la colonne dans l'exportation |
| `builder` | `({ row, id, context }) => string \| Promise<string>` | Fonction qui calcule la valeur |

La fonction `builder` reçoit chaque enregistrement exporté sous la forme `row`, selon la structure envoyée par le serveur (les dates sous forme de chaînes ISO, une relation belongsTo sous forme de sa colonne de clé étrangère), l'`id` de l'enregistrement à côté (sa clé primaire sous forme de chaîne de caractères, les éléments d'une clé composite étant joints par `:::`), ainsi que le `RebaseContext` (qui inclut l'utilisateur authentifié), vous permettant ainsi de calculer des valeurs basées à la fois sur les données et les permissions.

## Prochaines étapes

- **[Tables dans le CMS](/docs/collections)** — Ce que le panneau affiche pour chaque table
- **[Vue d'ensemble du frontend](/docs/frontend)** — Panneau d'administration et composants d'interface utilisateur
- **[SDK typé](/docs/sdk)** — Accès programmatique aux données
