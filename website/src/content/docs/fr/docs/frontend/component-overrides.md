---
sourceHash: bad5fe6e295033b6
title: Surcharges de composants (Swizzling)
sidebar_label: Surcharges de composants
description: Remplacez les composants d'interface par défaut par des implémentations personnalisées au niveau de l'application ou de la collection.
---

## Vue d'ensemble

Rebase vous permet de surcharger les composants d'interface utilisateur par défaut avec vos propres implémentations personnalisées. Cela implémente un modèle de « swizzling » de composants inspiré de Docusaurus, prenant en charge deux modèles de personnalisation :
- **Mode Eject** (par défaut) : votre composant remplace intégralement le composant intégré.
- **Mode Wrap** (`wrap: true`) : votre composant enveloppe le composant original. Ce qu'il enveloppe (généralement le composant intégré) est transmis via la prop `OriginalComponent` afin que vous puissiez l'afficher au sein de votre disposition ou logique personnalisée.

Pour modifier uniquement l'apparence de l'interface d'administration — couleurs, polices, arrondis, logo — vous n'avez pas besoin d'une surcharge : consultez [Theming & Branding](/docs/frontend/theming).

Les surcharges de composants peuvent être appliquées **globalement** au niveau de l'application (sur le provider `<Rebase>`) ou **localement** au niveau de la collection (au sein des définitions individuelles de collections).

---

## Surcharges de composants globales

Pour surcharger des composants globalement sur l'ensemble de votre application, transmettez un objet `components` au provider racine `<Rebase>`.

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

Pour surcharger les composants d'une seule table, transmettez `components` dans son
`customizeTable`. Cela est utile pour l'état vide (empty state), les cartes ou le formulaire d'une
table en particulier. Chaque `Component` est le composant lui-même, importé par valeur :
le fichier s'exécute uniquement dans le navigateur.

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";
import { ProductCustomForm } from "../../../../../components/ProductCustomForm";
import { ProductsEmptyState } from "../../../../../components/ProductsEmptyState";

export const productsCms = customizeTable<typeof products>("products", {
    components: {
        // Replace: the product form is drawn by your component alone.
        "Entity.Form": { Component: ProductCustomForm },
        // Wrap: your component receives the original as `OriginalComponent`.
        "Collection.EmptyState": { Component: ProductsEmptyState, wrap: true },
    },
});
```

Un composant enveloppant reçoit ce qu'il enveloppe en tant que `OriginalComponent` : le
composant intégré, à moins que votre application ne le surcharge également (voir
[Lorsque les deux portées surchargent un composant](#lorsque-les-deux-portées-surchargent-un-composant)) :

```tsx
// frontend/src/components/ProductsEmptyState.tsx
import React from "react";

export function ProductsEmptyState({ OriginalComponent, ...props }: {
    OriginalComponent: React.ComponentType<Record<string, unknown>>
}) {
    return (
        <div className="empty-state-wrapper">
            <OriginalComponent {...props} />
            <a href="/docs/import">Import your first products</a>
        </div>
    );
}
```

Un chemin sous forme de chaîne de caractères ou un thunk différé `() => import(…)` dans `Component` lèvera
une erreur lors du chargement du module, en précisant quoi écrire à la place.

### Lorsque les deux portées surchargent un composant

Les deux portées se composent. La surcharge au niveau de l'application (`<Rebase components>`) est d'abord appliquée au composant intégré, puis celle de la table (`components` dans `customizeTable`) est appliquée au résultat :

| Niveau application | Niveau collection | Ce qui s'affiche au sein de cette collection |
|---|---|---|
| n'importe lequel | aucun | ce qui s'affiche partout ailleurs : la surcharge au niveau de l'application, ou le composant intégré |
| aucun | wrap | le wrapper de la collection autour du composant intégré |
| replace ou wrap | wrap | le wrapper de la collection autour de la surcharge au niveau de l'application, transmis en tant que `OriginalComponent` |
| n'importe lequel | replace | le composant de la collection seul ; il remplace les deux |

Ainsi, une collection peut ajouter des éléments autour d'un composant que votre application personnalise déjà sans perdre cette personnalisation. Pour abandonner la version au niveau de l'application pour une collection spécifique, remplacez-la au lieu de l'envelopper.

---

## Portées des composants surchargeables

### Composants de portée applicative (`AppComponentName`)

Ces composants ne peuvent être surchargés qu'au niveau du provider racine `<Rebase>`, car ils représentent la structure globale du shell.

| Clé du composant | Description |
|---|---|
| `"Shell.AppBar"` | La barre d'en-tête en haut de la page |
| `"Shell.Drawer"` | Le volet de navigation latéral principal rétractable |
| `"Shell.DrawerNavigationItem"` | Liens individuels dans la barre latérale |
| `"Shell.DrawerNavigationGroup"` | En-têtes rétractables de groupes de navigation dans la barre latérale |
| `"HomePage"` | La page d'accueil par défaut en mode contenu |
| `"HomePage.CollectionCard"` | Cartes de collection individuelles sur la page d'accueil |
| `"Auth.LoginView"` | L'overlay affiché lors d'une demande d'authentification |

### Composants de portée collection (`CollectionComponentName`)

Ces composants peuvent être surchargés globalement (faisant office de valeurs par défaut pour toutes les collections) ou sur des collections individuelles.

| Clé du composant | Description |
|---|---|
| `"Collection.View"` | La page d'accueil complète de la collection |
| `"Collection.Table"` | La vue tabulaire par défaut de type feuille de calcul |
| `"Collection.Card"` | Le conteneur d'élément de la vue cartes |
| `"Collection.EmptyState"` | Vue affichée lorsqu'une collection est vide |
| `"Collection.Actions"` | Boutons de la barre d'outils au-dessus du tableau/des cartes |
| `"Collection.FilterField"` | Champ de filtre personnalisé pour une colonne |
| `"Entity.Form"` | Le formulaire détaillé pour la création/mise à jour |
| `"EditView.FormActions"` | Barre de boutons de soumission/annulation du formulaire |
| `"DetailView"` | Vue détaillée en lecture seule |
| `"Entity.SidePanel"` | Le conteneur du volet latéral pour le formulaire/détail |
| `"EntityPreview"` | Aperçu inline sous forme de puce pour une référence/relation |
| `"Entity.MissingReference"` | Affiché lorsqu'une entité référencée est manquante |

:::note[Trois clés ne respectent pas le motif `Entity.`]
`"DetailView"`, `"EntityPreview"` et `"EditView.FormActions"` ne portent aucun préfixe
`Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` et `"Entity.FormActions"` ne
font pas partie de l'union — ils déclenchent une erreur de type, et en JavaScript pur la surcharge ne s'applique
tout simplement jamais.
:::

Votre composant de remplacement reçoit les mêmes props que celles transmises au composant intégré. Le
dictionnaire de surcharges ne définit pas de type de props par clé — `ComponentOverride<P>` applique par défaut
`Record<string, unknown>` à `P` — typez donc vous-même le paramètre, ou fournissez un argument
de type, lorsque vous souhaitez vérifier les props. Quelques composants intégrés exportent un
type de props que vous pouvez importer et réutiliser : `CollectionViewProps` (`@rebasepro/ui`) ;
`CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps`
et `FilterFieldBindingProps` (`@rebasepro/cms-types`) ; `EntityFormProps`,
`EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`,
`DetailViewBindingProps`, `DrawerNavigationItemProps` et
`DrawerNavigationGroupProps` (`@rebasepro/cms`) ; `LoginViewProps`
(`@rebasepro/app`). Les autres n'ont aucun type de props exporté — écrivez la structure que
vous lisez réellement.

### Ce qu'une surcharge de `Collection.View` doit respecter

`Collection.View` correspond à ce que rend un `CollectionPanel`, les props du panneau parviennent donc
à votre surcharge sous la forme de `CollectionViewBindingProps` (`@rebasepro/cms`), combinées à celles
de la collection. Un composant de remplacement qui les ignorerait casserait chaque page qui intègre
la collection. Respectez au minimum les éléments suivants :

| Prop | Ce qu'attend l'appelant |
|---|---|
| `collectionOverrides` | Ce que l'appelant modifie dans la collection (un filtre fixe, un tri, le mode d'affichage), appliqué sur la collection enregistrée |
| `fields` | Uniquement ces propriétés, dans cet ordre : les colonnes, et ce à partir de quoi les lignes de liste et les cartes sont renseignées |
| `highlightedIds` | Les identifiants des lignes rendues comme sélectionnées ; `[]` pour aucune |
| `onRowClick` | Appelé avec la ligne cliquée, telle qu'envoyée par le serveur, et son identifiant, au lieu de l'ouvrir. Le propre `onRowClick` du panneau |

Le panneau transmet également `viewMode` (le mode dans lequel ouvrir), `toolbar` (la barre d'outils
à afficher, `null` pour aucune) et `title` (`false` pour n'afficher aucun titre), lorsque son
appelant les a définis. Le composant intégré `CollectionViewBinding` les gère tous ; une
surcharge qui l'enveloppe plutôt que de le remplacer peut simplement les transmettre directement.

Pour partir du composant intégré plutôt que de zéro, copiez son code source dans
votre projet et enregistrez la copie ici : chaque élément à l'exception de `Collection.View`,
`DetailView` et du glisser-déposer de la page d'accueil compile avec les imports de paquets.
Consultez [Copier un composant intégré](/docs/frontend/customizing#copying-a-built-in-part).

## Voir aussi

- [Theming & Branding](/docs/frontend/theming/) — restyler l'administration avec des tokens plutôt qu'avec des composants
- [Extension de Rebase](/docs/frontend/extending/) — les points d'extension qui ne nécessitent pas de surcharge
- [Champs personnalisés](/docs/frontend/custom-fields/) — remplacer l'éditeur d'une seule propriété plutôt qu'un composant
- [Slots](/docs/frontend/slots/) — ajouter du contenu à un composant au lieu de le remplacer
