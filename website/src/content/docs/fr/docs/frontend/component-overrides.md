---
sourceHash: 5ceaf45e05dbf2b8
title: Remplacement de composants (Swizzling)
sidebar_label: Remplacement de composants
description: Remplacez les composants d'interface utilisateur par défaut par des implémentations personnalisées au niveau de l'application ou de la collection.
---

## Vue d'ensemble

Rebase vous permet de remplacer les composants d'interface utilisateur par défaut par vos propres implémentations personnalisées. Cela implémente un modèle de swizzling de composants de style Docusaurus prenant en charge deux modèles de personnalisation :
- **Mode Eject** (par défaut) : Votre composant remplace intégralement le composant intégré.
- **Mode Wrap** (`wrap: true`) : Votre composant enveloppe l'original. Ce qu'il enveloppe (généralement le composant intégré) est transmis via la prop `OriginalComponent` afin que vous puissiez le restituer au sein de votre mise en page/logique personnalisée.

Les remplacements de composants peuvent être appliqués **globalement** au niveau de l'application (sur le provider `<Rebase>`) ou **localement** au niveau de la collection (dans les définitions individuelles de collection).

---

## Remplacements globaux de composants

Pour remplacer des composants globalement dans toute votre application, transmettez un objet `components` au provider racine `<Rebase>`.

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

Pour remplacer des composants uniquement pour une collection spécifique, ajoutez un objet `components` sous son bloc `admin`. C'est utile pour personnaliser les états vides, les cartes ou les vues détaillées de modèles particuliers.

Dans la structure par défaut, `config/collections/` est chargé **à la fois** par le panneau d'administration et le backend, qui lit les mêmes fichiers pour dériver le schéma et l'API. Référencez donc chaque composant par son **chemin de module** plutôt que de l'importer. `Component` accepte les mêmes formes que `admin.Field` et `entityViews[].Builder` : un chemin, un `import()` paresseux (lazy), ou le composant lui-même.

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

Le composant enveloppant réside avec le reste de votre code frontend et reçoit ce qu'il enveloppe sous le nom de `OriginalComponent` — le composant intégré, à moins que votre application ne le remplace également (voir [Lorsque les deux portées remplacent un composant](#when-both-scopes-override-a-component)) :

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

Chaque module nécessite un **export par défaut** (`default export`). Le plugin Vite des collections réécrit le chemin en un import paresseux (lazy import), de sorte que le composant constitue son propre chunk et se charge lors du premier rendu du remplacement. Cette réécriture couvre les fichiers situés dans le dossier `collectionsDir` configuré. Un chemin dans un fichier situé en dehors parvient à l'admin sous la forme d'une simple chaîne brute : la console le signale et le composant intégré est rendu à sa place. En dehors de `collectionsDir`, écrivez vous-même l'import paresseux : `Component: () => import("../../frontend/src/ProductCustomForm")`.

Une référence directe (`Component: ProductCustomForm`) fonctionne également, mais uniquement dans un fichier de collection que le serveur ne charge pas, car importer le composant importe également React et tout ce qui l'accompagne.

### Lorsque les deux portées remplacent un composant

Sur la version 0.24, le wrapper d'une collection reçoit toujours le composant intégré, et le remplacement au niveau de l'application est ignoré au sein de cette collection.

Les deux portées se composent. Le remplacement au niveau de l'application (`<Rebase components>`) est d'abord appliqué au composant intégré, puis celui de la collection (`admin.components`) est appliqué au résultat :

| Niveau application | Niveau collection | Ce qui est rendu dans cette collection |
|---|---|---|
| quelconque | aucun | ce qui est rendu partout ailleurs : le remplacement au niveau application, ou le composant intégré |
| aucun | wrap | le wrapper de la collection autour du composant intégré |
| replace ou wrap | wrap | le wrapper de la collection autour du remplacement au niveau application, transmis en tant que `OriginalComponent` |
| quelconque | replace | le composant de la collection seul ; il remplace les deux |

Une collection peut donc ajouter un élément autour d'un composant que votre application personnalise déjà sans perdre cette personnalisation. Pour abandonner la version au niveau de l'application pour une collection donnée, utilisez un remplacement (`replace`) plutôt qu'un emballage (`wrap`).

---

## Portées des composants remplaçables

### Composants à portée applicative (`AppComponentName`)

Ces composants ne peuvent être remplacés qu'au niveau du provider racine `<Rebase>`, car ils représentent la structure globale du shell.

| Clé du composant | Description |
|---|---|
| `"Shell.AppBar"` | La barre d'en-tête en haut de la page |
| `"Shell.Drawer"` | Le volet de navigation latéral principal rétractable |
| `"Shell.DrawerNavigationItem"` | Liens individuels dans la barre latérale |
| `"Shell.DrawerNavigationGroup"` | En-têtes de groupes de navigation repliables dans la barre latérale |
| `"HomePage"` | La page d'accueil par défaut en mode contenu |
| `"HomePage.CollectionCard"` | Cartes de collection individuelles sur la page d'accueil |
| `"Auth.LoginView"` | La vue superposée affichée lors d'une demande d'authentification |

### Composants à portée collection (`CollectionComponentName`)

Ces composants peuvent être remplacés globalement (faisant office de valeurs par défaut pour toutes les collections) ou sur des collections individuelles.

| Clé du composant | Description |
|---|---|
| `"Collection.View"` | La page de collection complète |
| `"Collection.Table"` | La vue tabulaire par défaut de type feuille de calcul |
| `"Collection.Card"` | Le conteneur d'élément en vue carte |
| `"Collection.EmptyState"` | Vue affichée lorsqu'une collection est vide |
| `"Collection.Actions"` | Boutons de la barre d'outils au-dessus de la table/des cartes |
| `"Collection.FilterField"` | Champ de filtre personnalisé pour une colonne |
| `"Entity.Form"` | Le formulaire de détail pour la création/mise à jour |
| `"EditView.FormActions"` | Barre de boutons de soumission/annulation de formulaire |
| `"DetailView"` | Vue détaillée en lecture seule |
| `"Entity.SidePanel"` | Le conteneur du panneau latéral pour formulaire/détail |
| `"EntityPreview"` | Aperçu inline sous forme de badge pour référence/relation |
| `"Entity.MissingReference"` | Affiché lorsqu'une entité référencée est manquante |

:::note[Trois clés ne respectent pas le motif `Entity.`]
`"DetailView"`, `"EntityPreview"` et `"EditView.FormActions"` ne comportent pas le préfixe `Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` et `"Entity.FormActions"` ne font pas partie de l'union — ils déclenchent une erreur de typage et, en JavaScript pur, le remplacement ne s'applique tout simplement jamais.
:::

Votre composant de remplacement reçoit les mêmes props que le composant intégré. Le mapping de remplacement ne définit pas de type de props par clé — `ComponentOverride<P>` définit par défaut `P` comme `Record<string, unknown>` — vous devez donc typer le paramètre vous-même, ou passer un argument de type, si vous souhaitez que les props soient vérifiées. Quelques-uns des composants intégrés exportent un type de props que vous pouvez importer et réutiliser : `CollectionViewProps` (`@rebasepro/ui`) ; `CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps` et `FilterFieldBindingProps` (`@rebasepro/cms-types`) ; `EntityFormProps`, `EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`, `DetailViewBindingProps`, `DrawerNavigationItemProps` et `DrawerNavigationGroupProps` (`@rebasepro/cms`) ; `LoginViewProps` (`@rebasepro/app`). Les autres n'ont pas de type de props exporté — définissez vous-même la structure que vous lisez réellement.

### Ce qu'un remplacement de `Collection.View` doit respecter

`Collection.View` correspond à ce qu'un `CollectionPanel` restitue, donc les props du panneau parviennent à votre remplacement sous forme de `CollectionViewBindingProps` (`@rebasepro/cms`), combinées à celles de la collection. Un composant de remplacement qui les ignorerait casserait chaque page intégrant la collection. Respectez au minimum les éléments suivants :

| Prop | Ce qu'attend l'appelant |
|---|---|
| `collectionOverrides` | Les modifications apportées par l'appelant à la collection (un filtre fixe, un tri, le mode de vue), appliquées par-dessus la collection enregistrée |
| `fields` | Uniquement ces propriétés, dans cet ordre : les colonnes, et ce avec quoi les lignes de liste et les cartes sont alimentées |
| `highlightedEntityId` | La ligne affichée comme sélectionnée ; `null` pour aucune |
| `onEntityClick` | Appelé avec la ligne cliquée (une `Entity`) au lieu de l'ouvrir. Le `onRowClick` du panneau arrive sous cette forme |

Le panneau transmet également `viewMode` (le mode d'ouverture), `toolbar` (la barre d'outils à afficher, `null` pour aucune) et `title` (`false` pour ne pas afficher de titre), lorsque son appelant les a définis. Le composant intégré `CollectionViewBinding` gère l'ensemble de ces options ; un remplacement qui l'enveloppe plutôt que de le substituer peut simplement les lui transmettre directement.

Pour démarrer à partir du composant intégré plutôt que de zéro, copiez son code source dans votre projet et enregistrez la copie ici : chaque partie, à l'exception de `Collection.View`, `DetailView` et du drag-and-drop de la page d'accueil, compile avec les imports de packages. Consultez [Copier un composant intégré](/docs/frontend/customizing#copying-a-built-in-part).

## Voir aussi

- [Étendre Rebase](/docs/frontend/extending/) — les points d'extension qui ne nécessitent pas de remplacement
- [Champs personnalisés](/docs/frontend/custom-fields/) — remplacer l'éditeur d'une seule propriété plutôt qu'un composant
- [Slots](/docs/frontend/slots/) — enrichir un composant au lieu de le remplacer
