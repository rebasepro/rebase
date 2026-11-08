---
sourceHash: 71362fa8c8eb7f20
title: Remplacement de composants (Swizzling)
sidebar_label: Remplacement de composants
description: Remplacez les composants d'interface par défaut par des implémentations personnalisées au niveau de l'application ou de la collection.
---

## Aperçu

Rebase vous permet de remplacer les composants d'interface utilisateur par défaut par vos propres implémentations personnalisées. Cela implémente un modèle de « swizzling » de composants de style Docusaurus prenant en charge deux modèles de personnalisation :
- **Mode Eject** (par défaut) : votre composant remplace intégralement le composant intégré.
- **Mode Wrap** (`wrap: true`) : votre composant enveloppe l'original. Ce qu'il enveloppe (généralement le composant intégré) est transmis via la prop `OriginalComponent` afin que vous puissiez l'afficher à l'intérieur de votre mise en page/logique personnalisée.

Les remplacements de composants peuvent être appliqués **globalement** au niveau de l'application (sur le fournisseur `<Rebase>`) ou **localement** au niveau de la collection (à l'intérieur des définitions de collections individuelles).

---

## Remplacements globaux de composants

Pour remplacer des composants globalement dans toute votre application, transmettez un objet `components` au fournisseur racine `<Rebase>`.

```tsx
import { Rebase } from "@rebasepro/app";
import { MyAppBar } from "./components/MyAppBar";

function App() {
    return (
        <Rebase
            client={rebaseClient}
            components={{
                // Eject Mode: Replace the default AppBar entirely
                "Shell.AppBar": { Component: MyAppBar },

                // Wrap Mode: Wrap the login view to insert branding
                "Auth.LoginView": {
                    // `OriginalComponent` is injected at runtime when `wrap: true`; the override
                    // slot's type does not model it, hence the annotation.
                    Component: (({ OriginalComponent, ...props }: {
                        OriginalComponent: React.ComponentType<Record<string, unknown>>
                    }) => (
                        <div className="login-branding-container">
                            <header className="branding-header">My Custom Brand</header>
                            <OriginalComponent {...props} />
                        </div>
                    )) as unknown as React.ComponentType<Record<string, unknown>>,
                    wrap: true
                }
            }}
        >
            {/* your app */}
            …
        </Rebase>
    );
}
```

---

## Remplacements de composants au niveau de la collection

Pour remplacer des composants uniquement pour une collection spécifique, ajoutez un objet `components` sous son bloc `admin`. Cela est utile pour personnaliser les états vides, les cartes ou les vues détaillées pour des modèles particuliers.

Dans l'échafaudage par défaut, `config/collections/` est chargé **à la fois** par le panneau d'administration et par le backend, qui lit les mêmes fichiers pour dériver le schéma et l'API. Pointez donc vers chaque composant par **chemin de module** plutôt qu'en l'important. `Component` accepte les mêmes formes que `admin.Field` et `entityViews[].Builder` : un chemin, un `import()` différé (lazy), ou le composant lui-même.

```ts
// config/collections/products.ts
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: { /* ... */ },
    admin: {
        components: {
            // Eject Mode: Replace the default entity form view
            "Entity.Form": { Component: "../../frontend/src/ProductCustomForm" },

            // Wrap Mode: Wrap the empty state to add quick links
            "Collection.EmptyState": {
                Component: "../../frontend/src/ProductsEmptyState",
                wrap: true
            }
        }
    }
});
```

Le composant d'enveloppement réside avec le reste de votre code frontend et reçoit ce qu'il enveloppe sous la forme de `OriginalComponent` — le composant intégré, à moins que votre application ne le remplace également (voir [Lorsque les deux portées remplacent un composant](#lorsque-les-deux-portées-remplacent-un-composant)) :

```tsx
// frontend/src/ProductsEmptyState.tsx
import type React from "react";

export default function ProductsEmptyState({ OriginalComponent, ...props }: {
    OriginalComponent: React.ComponentType<Record<string, unknown>>
}) {
    return (
        <div className="empty-state-wrapper">
            <OriginalComponent {...props} />
            <button onClick={() => importDemoProducts()}>
                Load Demo Products
            </button>
        </div>
    );
}
```

Chaque module nécessite un **export par défaut** (`default export`). Le plugin Vite pour les collections réécrit un chemin en un import différé (lazy import), de sorte que le composant constitue son propre chunk et se charge lors du premier rendu du remplacement. Cette réécriture couvre les fichiers situés dans le répertoire configuré `collectionsDir`. Un chemin situé dans un fichier en dehors de celui-ci parvient à l'administration sous forme de simple chaîne de caractères : la console l'indique, et le composant intégré s'affiche à sa place. En dehors de `collectionsDir`, écrivez vous-même l'import différé : `Component: () => import("../../frontend/src/ProductCustomForm")`.

Une référence directe (`Component: ProductCustomForm`) fonctionne également, mais uniquement dans un fichier de collection que le serveur ne charge pas, car importer le composant importe également React et tout ce dont il dépend.

### Lorsque les deux portées remplacent un composant

Sur la version 0.24, le wrapper d'une collection reçoit toujours le composant intégré, et le remplacement au niveau de l'application est ignoré dans cette collection.

Les deux portées se composent. Le remplacement au niveau de l'application (`<Rebase components>`) est d'abord appliqué au composant intégré, puis celui de la collection (`admin.components`) est appliqué au résultat :

| Niveau application | Niveau collection | Ce qui s'affiche dans cette collection |
|---|---|---|
| n'importe lequel | aucun | ce qui s'affiche partout ailleurs : le remplacement au niveau de l'application, ou le composant intégré |
| aucun | wrap | le wrapper de la collection autour du composant intégré |
| replace ou wrap | wrap | le wrapper de la collection autour du remplacement au niveau de l'application, transmis comme `OriginalComponent` |
| n'importe lequel | replace | le composant de la collection seul ; il remplace les deux |

Une collection peut donc ajouter un élément autour d'un composant que votre application personnalise déjà sans perdre cette personnalisation. Pour abandonner la version au niveau de l'application pour une collection donnée, utilisez le remplacement (replace) au lieu de l'enveloppement (wrap).

---

## Portées des composants remplaçables

### Composants à portée application (`AppComponentName`)

Ces composants ne peuvent être remplacés qu'au niveau du fournisseur racine `<Rebase>`, car ils représentent la structure globale de l'interface (shell).

| Clé du composant | Description |
|---|---|
| `"Shell.AppBar"` | La barre d'en-tête en haut de la page |
| `"Shell.Drawer"` | Le volet de navigation latéral principal repliable |
| `"Shell.DrawerNavigationItem"` | Liens individuels à l'intérieur de la barre latérale |
| `"Shell.DrawerNavigationGroup"` | En-têtes de groupes de navigation repliables dans la barre latérale |
| `"HomePage"` | La page d'accueil par défaut en mode contenu |
| `"HomePage.CollectionCard"` | Cartes de collection individuelles sur la page d'accueil |
| `"Auth.LoginView"` | La fenêtre modale/superposition affichée lors d'une demande d'authentification |

### Composants à portée collection (`CollectionComponentName`)

Ces composants peuvent être remplacés globalement (servant de valeurs par défaut pour toutes les collections) ou sur des collections individuelles.

| Clé du composant | Description |
|---|---|
| `"Collection.View"` | La page d'accueil complète de la collection |
| `"Collection.Table"` | La vue tabulaire sous forme de feuille de calcul par défaut |
| `"Collection.Card"` | Le conteneur d'élément de vue en carte |
| `"Collection.EmptyState"` | Vue affichée lorsqu'une collection est vide |
| `"Collection.Actions"` | Boutons de la barre d'outils au-dessus du tableau/des cartes |
| `"Collection.FilterField"` | Champ de filtre personnalisé pour une colonne |
| `"Entity.Form"` | Le formulaire détaillé pour la création/mise à jour |
| `"EditView.FormActions"` | Barre de boutons de soumission/annulation de formulaire |
| `"DetailView"` | Vue détaillée en lecture seule |
| `"Entity.SidePanel"` | Le conteneur du panneau latéral pour le formulaire/détail |
| `"EntityPreview"` | Prévisualisation inline sous forme de puce (chip) de référence/relation |
| `"Entity.MissingReference"` | Affiché lorsqu'une entité référencée est manquante |

:::note[Trois clés dérogent au motif `Entity.`]
`"DetailView"`, `"EntityPreview"` et `"EditView.FormActions"` ne comportent aucun préfixe `Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` et `"Entity.FormActions"` ne font pas partie de l'union — ils déclenchent une erreur de type, et en JavaScript pur, le remplacement ne s'applique tout simplement jamais.
:::

Votre composant de remplacement reçoit les mêmes props que celles transmises au composant intégré. Le mapping de remplacement ne spécifie pas de type de props par clé — `ComponentOverride<P>` définit par défaut `P` comme `Record<string, unknown>` — typez donc vous-même le paramètre ou passez un argument de type lorsque vous souhaitez vérifier les props. Certains composants intégrés exportent un type de props que vous pouvez importer et réutiliser : `CollectionViewProps` (`@rebasepro/ui`) ; `CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps` et `FilterFieldBindingProps` (`@rebasepro/cms-types`) ; `EntityFormProps`, `EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`, `DetailViewBindingProps`, `DrawerNavigationItemProps` et `DrawerNavigationGroupProps` (`@rebasepro/cms`) ; `LoginViewProps` (`@rebasepro/app`). Les autres n'ont pas de type de props exporté — écrivez la structure que vous lisez réellement.

### Ce qu'un remplacement de `Collection.View` doit respecter

`Collection.View` est ce qui est rendu par un `CollectionPanel`, ainsi les props du panneau parviennent à votre remplacement sous la forme de `CollectionViewBindingProps` (`@rebasepro/cms`), propagées avec celles de la collection. Un composant de remplacement qui les ignore casse chaque page intégrant la collection. Respectez au minimum les éléments suivants :

| Prop | Ce qu'attend l'appelant |
|---|---|
| `collectionOverrides` | Ce que l'appelant modifie à propos de la collection (un filtre fixe, un tri, le mode de vue), appliqué sur la collection enregistrée |
| `fields` | Uniquement ces propriétés, dans cet ordre : les colonnes, et ce à partir de quoi les lignes de liste et les cartes sont renseignées |
| `highlightedIds` | Les identifiants des lignes affichées comme sélectionnées ; `[]` pour aucune |
| `onRowClick` | Appelé avec la ligne cliquée, telle qu'envoyée par le serveur, et son identifiant, au lieu de l'ouvrir. Le propre `onRowClick` du panneau |

Le panneau transmet également `viewMode` (le mode dans lequel s'ouvrir), `toolbar` (la barre d'outils à afficher, `null` pour aucune) et `title` (`false` pour ne pas afficher de titre), là où son appelant les a définis. Le composant intégré `CollectionViewBinding` gère l'ensemble de ces éléments ; un remplacement qui l'enveloppe plutôt que de le remplacer peut simplement les transmettre directement.

Pour partir du composant intégré plutôt que de zéro, copiez son code source dans votre projet et enregistrez la copie ici : chaque partie à l'exception de `Collection.View`, `DetailView` et du glisser-déposer de la page d'accueil se compile avec les imports des packages. Voir [Copier une partie intégrée](/docs/frontend/customizing#copying-a-built-in-part).

## Voir aussi

- [Étendre Rebase](/docs/frontend/extending/) — les points d'extension qui ne nécessitent pas de remplacement
- [Champs personnalisés](/docs/frontend/custom-fields/) — remplacer l'éditeur d'une propriété plutôt qu'un composant
- [Slots](/docs/frontend/slots/) — ajouter à un composant au lieu de le remplacer
