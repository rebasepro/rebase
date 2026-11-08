---
sourceHash: f17c7d88a5f91dd1
title: Surcharges de composants (Swizzling)
sidebar_label: Surcharges de composants
description: Remplacez les composants d'interface par défaut par des implémentations personnalisées au niveau de l'application ou de la collection.
---

## Aperçu

Rebase vous permet de surcharger les composants d'interface par défaut avec vos propres implémentations personnalisées. Cela implémente un modèle de « swizzling » de composants de style Docusaurus prenant en charge deux modèles de personnalisation :
- **Mode Eject** (par défaut) : votre composant remplace intégralement le composant natif.
- **Mode Wrap** (`wrap: true`) : votre composant enveloppe l'original. L'élément qu'il enveloppe (généralement le composant natif) est transmis via la prop `OriginalComponent` afin que vous puissiez l'afficher au sein de votre mise en page ou de votre logique personnalisée.

Les surcharges de composants peuvent être appliquées **globalement** au niveau de l'application (sur le fournisseur `<Rebase>`) ou **localement** au niveau de la collection (au sein des définitions de collections individuelles).

---

## Surcharges globales de composants

Pour surcharger des composants globalement sur l'ensemble de votre application, transmettez un objet `components` au fournisseur racine `<Rebase>`.

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

## Surcharges de composants au niveau de la collection

Pour surcharger des composants uniquement pour une collection spécifique, ajoutez un objet `components` sous son bloc `admin`. Cela est utile pour personnaliser les états vides, les cartes ou les vues de détail pour des modèles particuliers.

Dans le scaffold par défaut, `config/collections/` est chargé **à la fois** par le panneau d'administration et par le backend, qui lit les mêmes fichiers pour déduire le schéma et l'API. Pointez donc vers chaque composant par son **chemin de module** plutôt qu'en l'important. `Component` accepte les mêmes formes que `admin.Field` et `entityViews[].Builder` : un chemin, un `import()` dynamique, ou le composant lui-même.

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

Le composant enveloppant réside avec le reste de votre code frontend et reçoit ce qu'il enveloppe en tant que `OriginalComponent` — le composant natif, sauf si votre application le surcharge également (voir [Lorsque les deux portées surchargent un composant](#lorsque-les-deux-portées-surchargent-un-composant)) :

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

Chaque module doit avoir un **export par défaut**. Le plugin Vite des collections réécrit un chemin en import dynamique afin que le composant dispose de son propre chunk et se charge la première fois que la surcharge est affichée. Cette réécriture concerne les fichiers situés à l'intérieur du `collectionsDir` configuré. Un chemin dans un fichier situé en dehors parvient à l'admin sous la forme d'une simple chaîne : la console le signale, et le composant natif est affiché à sa place. En dehors de `collectionsDir`, écrivez vous-même l'import dynamique : `Component: () => import("../../frontend/src/ProductCustomForm")`.

Une référence directe (`Component: ProductCustomForm`) fonctionne également, mais uniquement dans un fichier de collection que rien ne charge sur le serveur, car importer le composant importe également React et l'ensemble de ses dépendances.

### Lorsque les deux portées surchargent un composant

En 0.24, le wrapper d'une collection reçoit toujours le composant natif, et la surcharge au niveau de l'application est ignorée au sein de cette collection.

Les deux portées se composent. La surcharge au niveau de l'application (`<Rebase components>`) est d'abord appliquée au composant natif, et celle de la collection (`admin.components`) est appliquée au résultat :

| Niveau application | Niveau collection | Ce qui est affiché au sein de cette collection |
|---|---|---|
| any | none | ce qui est affiché partout ailleurs : la surcharge au niveau de l'application, ou le composant natif |
| none | wrap | le wrapper de la collection autour du composant natif |
| replace ou wrap | wrap | le wrapper de la collection autour de la surcharge au niveau application, transmis en tant que `OriginalComponent` |
| any | replace | le composant de la collection seul ; il remplace les deux |

Ainsi, une collection peut ajouter des éléments autour d'un composant que votre application personnalise déjà sans perdre cette personnalisation. Pour retirer la version au niveau applicatif pour une collection donnée, effectuez un remplacement (replace) au lieu d'envelopper (wrap).

---

## Portées des composants surchargeables

### Composants de portée applicative (`AppComponentName`)

Ces composants ne peuvent être surchargés qu'au niveau du fournisseur racine `<Rebase>`, car ils représentent la structure globale du shell.

| Clé de composant | Description |
|---|---|
| `"Shell.AppBar"` | La barre d'en-tête en haut de la page |
| `"Shell.Drawer"` | Le volet de navigation latéral principal repliable |
| `"Shell.DrawerNavigationItem"` | Les liens individuels dans la barre latérale |
| `"Shell.DrawerNavigationGroup"` | Les en-têtes de groupes de navigation repliables dans la barre latérale |
| `"HomePage"` | La page d'accueil par défaut en mode contenu |
| `"HomePage.CollectionCard"` | Les cartes de collection individuelles sur la page d'accueil |
| `"Auth.LoginView"` | La vue superposée affichée lors d'une demande d'authentification |

### Composants de portée collection (`CollectionComponentName`)

Ces composants peuvent être surchargés globalement (faisant office de valeurs par défaut pour toutes les collections) ou sur des collections individuelles.

| Clé de composant | Description |
|---|---|
| `"Collection.View"` | La page d'accueil complète de la collection |
| `"Collection.Table"` | La vue tabulaire de type feuille de calcul par défaut |
| `"Collection.Card"` | Le wrapper d'élément pour la vue en cartes |
| `"Collection.EmptyState"` | La vue affichée lorsqu'une collection est vide |
| `"Collection.Actions"` | Les boutons de la barre d'outils au-dessus de la table/des cartes |
| `"Collection.FilterField"` | Le champ de filtre personnalisé pour une colonne |
| `"Entity.Form"` | Le formulaire de détail pour la création/mise à jour |
| `"EditView.FormActions"` | La barre de boutons de soumission/annulation du formulaire |
| `"DetailView"` | La vue de détail en lecture seule |
| `"Entity.SidePanel"` | Le conteneur du panneau latéral pour le formulaire/détail |
| `"EntityPreview"` | L'aperçu intégré sous forme de pastille (chip) pour une référence/relation |
| `"Entity.MissingReference"` | Affiché lorsqu'une entité référencée est manquante |

:::note[Trois clés ne suivent pas le modèle `Entity.`]
`"DetailView"`, `"EntityPreview"` et `"EditView.FormActions"` ne comportent pas de
préfixe `Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` et `"Entity.FormActions"` ne
font pas partie de l'union — ils provoquent une erreur de type et, en JavaScript pur, la
surcharge ne s'applique tout simplement jamais.
:::

Votre composant de remplacement reçoit les mêmes props que celles transmises au composant natif. La
carte des surcharges n'indique pas de type de props par clé — `ComponentOverride<P>` applique par défaut
`Record<string, unknown>` à `P` — typez donc le paramètre vous-même, ou passez un argument de type,
lorsque vous souhaitez que les props soient vérifiées. Quelques composants natifs exportent
un type de props que vous pouvez importer et réutiliser : `CollectionViewProps` (`@rebasepro/ui`) ;
`CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps`
et `FilterFieldBindingProps` (`@rebasepro/cms-types`) ; `EntityFormProps`,
`EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`,
`DetailViewBindingProps`, `DrawerNavigationItemProps` et
`DrawerNavigationGroupProps` (`@rebasepro/cms`) ; `LoginViewProps`
(`@rebasepro/app`). Les autres ne disposent pas de type de props exporté — écrivez la structure que
vous lisez réellement.

### Ce qu'une surcharge de `Collection.View` doit respecter

`Collection.View` correspond à ce qu'un `CollectionPanel` affiche ; ainsi, les props du panneau parviennent à
votre surcharge sous la forme de `CollectionViewBindingProps` (`@rebasepro/cms`), réparties (spread) par-dessus
celles de la collection. Un composant de remplacement qui les ignore casse chaque page intégrant
la collection. Respectez au minimum les suivantes :

| Prop | Ce que l'appelant attend |
|---|---|
| `collectionOverrides` | Ce que l'appelant modifie concernant la collection (un filtre fixe, un tri, le mode de vue), appliqué par-dessus la collection enregistrée |
| `fields` | Uniquement ces propriétés, dans cet ordre : les colonnes, ainsi que ce à partir de quoi les lignes de liste et les cartes sont renseignées |
| `highlightedIds` | Les identifiants des lignes affichées comme sélectionnées ; `[]` pour aucune |
| `onRowClick` | Appelé avec la ligne cliquée, telle que le serveur l'envoie, au lieu de l'ouvrir. Le propre `onRowClick` du panneau |

Le panneau transmet également `viewMode` (le mode dans lequel s'ouvrir), `toolbar` (la barre d'outils
à afficher, `null` pour aucune) et `title` (`false` pour ne pas afficher de titre), lorsque son
appelant les a définis. Le composant natif `CollectionViewBinding` les gère tous ; une
surcharge qui l'enveloppe plutôt que de le remplacer peut simplement les lui transmettre directement.

Pour partir de l'élément natif plutôt que de zéro, copiez son code source dans
votre projet et enregistrez la copie ici : chaque élément, à l'exception de `Collection.View`,
`DetailView` et du glisser-déposer de la page d'accueil, se compile avec des imports de paquets.
Consultez [Copier un composant natif](/docs/frontend/customizing#copying-a-built-in-part).

## Ressources connexes

- [Étendre Rebase](/docs/frontend/extending/) — les points d'extension qui ne nécessitent pas de surcharge
- [Champs personnalisés](/docs/frontend/custom-fields/) — remplacer l'éditeur d'une propriété plutôt qu'un composant
- [Slots](/docs/frontend/slots/) — ajouter à un composant au lieu de le remplacer
