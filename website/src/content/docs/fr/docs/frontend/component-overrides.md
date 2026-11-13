---
sourceHash: b16bc057fd9a76c0
title: Surcharges de composants (Swizzling)
sidebar_label: Surcharges de composants
description: Remplacez les composants d'interface par défaut par des implémentations personnalisées au niveau de l'application ou de la collection.
---

## Vue d'ensemble

Rebase vous permet de surcharger les composants d'interface par défaut avec vos propres implémentations personnalisées. Cela implémente un modèle de « swizzling » de composants similaire à celui de Docusaurus, qui prend en charge deux approches de personnalisation :
- **Mode Eject** (par défaut) : Votre composant remplace intégralement le composant intégré.
- **Mode Wrap** (`wrap: true`) : Votre composant enveloppe l'original. Ce qu'il enveloppe (généralement le composant intégré) est transmis via la prop `OriginalComponent`, ce qui vous permet de le rendre à l'intérieur de votre mise en page ou logique personnalisée.

Les surcharges de composants peuvent être appliquées **globalement** au niveau de l'application (sur le fournisseur `<Rebase>`) ou **localement** au niveau de la collection (au sein des définitions individuelles de collections).

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

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Pour surcharger les composants d'une seule table, transmettez `components` dans son `customizeTable`. C'est utile pour l'état vide (empty state), les cartes ou le formulaire d'une table particulière. Chaque `Component` est le composant lui-même, importé par valeur : le fichier s'exécute uniquement dans le navigateur.

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

Un composant d'enveloppement (wrapper) reçoit ce qu'il enveloppe sous le nom de `OriginalComponent` : le composant intégré, à moins que votre application ne le surcharge également (voir [Lorsque les deux portées surchargent un composant](#lorsque-les-deux-portées-surchargent-un-composant-when-both-scopes-override-a-component)) :

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

Un chemin sous forme de chaîne de caractères ou un thunk différé `() => import(…)` dans `Component` lèvera une erreur au chargement du module, en indiquant ce qu'il convient d'écrire à la place.

### Lorsque les deux portées surchargent un composant {#when-both-scopes-override-a-component}

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les deux portées se composent. La surcharge au niveau de l'application (`<Rebase components>`) est d'abord appliquée au composant intégré, puis celle de la table (`components` dans `customizeTable`) est appliquée au résultat :

| Niveau applicatif | Niveau collection | Ce qui est rendu au sein de cette collection |
|---|---|---|
| quelconque | aucun | ce qui est rendu partout ailleurs : la surcharge au niveau applicatif, ou le composant intégré |
| aucun | wrap | le wrapper de la collection autour du composant intégré |
| replace ou wrap | wrap | le wrapper de la collection autour de la surcharge au niveau applicatif, transmis en tant que `OriginalComponent` |
| quelconque | replace | le composant de la collection seul ; il remplace les deux |

Ainsi, une collection peut ajouter un habillage autour d'un composant que votre application personnalise déjà, sans perdre cette personnalisation. Pour abandonner la version au niveau applicatif pour une collection donnée, utilisez le remplacement (replace) au lieu de l'enveloppement (wrap).

---

## Portées des composants surchargeables

### Composants à portée applicative (`AppComponentName`)

Ces composants ne peuvent être surchargés qu'au niveau du fournisseur racine `<Rebase>`, car ils représentent la structure globale du shell.

| Clé du composant | Description |
|---|---|
| `"Shell.AppBar"` | La barre d'en-tête en haut de la page |
| `"Shell.Drawer"` | Le volet de navigation principal rétractable de la barre latérale |
| `"Shell.DrawerNavigationItem"` | Liens individuels à l'intérieur de la barre latérale |
| `"Shell.DrawerNavigationGroup"` | En-têtes de groupes de navigation rétractables dans la barre latérale |
| `"HomePage"` | La page d'accueil par défaut en mode contenu |
| `"HomePage.CollectionCard"` | Cartes de collection individuelles sur la page d'accueil |
| `"Auth.LoginView"` | La vue modale affichée lors d'une demande d'authentification |

### Composants à portée de collection (`CollectionComponentName`)

Ces composants peuvent être surchargés globalement (faisant office de valeurs par défaut pour toutes les collections) ou sur des collections individuelles.

| Clé du composant | Description |
|---|---|
| `"Collection.View"` | La page d'accueil entière de la collection |
| `"Collection.Table"` | La vue tabulaire de type tableur par défaut |
| `"Collection.Card"` | Le conteneur d'élément de la vue carte |
| `"Collection.EmptyState"` | Vue affichée lorsqu'une collection est vide |
| `"Collection.Actions"` | Boutons de la barre d'outils au-dessus de la table/des cartes |
| `"Collection.FilterField"` | Champ de saisie de filtre personnalisé pour une colonne |
| `"Entity.Form"` | Le formulaire de détail pour la création/mise à jour |
| `"EditView.FormActions"` | Barre de boutons d'action/annulation du formulaire |
| `"DetailView"` | Vue détaillée en lecture seule |
| `"Entity.SidePanel"` | Le conteneur du panneau latéral pour le formulaire/le détail |
| `"EntityPreview"` | Aperçu inline d'une référence/relation sous forme de puce (chip) |
| `"Entity.MissingReference"` | Rendu lorsqu'une entité référencée est manquante |

:::note[Trois clés dérogent au modèle `Entity.`]
`"DetailView"`, `"EntityPreview"` et `"EditView.FormActions"` ne portent aucun préfixe `Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` et `"Entity.FormActions"` ne font pas partie de l'union — ils déclenchent une erreur de typage, et en JavaScript pur, la surcharge ne s'applique tout simplement jamais.
:::

Votre composant de remplacement reçoit les mêmes props que celles transmises au composant intégré. La table de correspondance des surcharges ne définit pas de type de props par clé — `ComponentOverride<P>` utilise par défaut `Record<string, unknown>` pour `P` — typez donc le paramètre vous-même, ou passez un argument de type, lorsque vous souhaitez vérifier les props. Certains composants intégrés exportent un type de props que vous pouvez importer et réutiliser : `CollectionViewProps` (`@rebasepro/ui`) ; `CollectionEmptyStateProps`, `CollectionActionsProps`, `SidePanelBindingProps` et `FilterFieldBindingProps` (`@rebasepro/cms-types`) ; `EntityFormProps`, `EntityFormBindingProps`, `EntityFormActionsProps`, `CollectionTableBindingProps`, `DetailViewBindingProps`, `DrawerNavigationItemProps` et `DrawerNavigationGroupProps` (`@rebasepro/cms`) ; `LoginViewProps` (`@rebasepro/app`). Les autres n'ont pas de type de props exporté — écrivez la structure que vous utilisez réellement.

### Ce qu'une surcharge de `Collection.View` doit respecter

`Collection.View` correspond à ce qu'affiche un `CollectionPanel`, ainsi les props du panneau parviennent à votre surcharge sous forme de `CollectionViewBindingProps` (`@rebasepro/cms`), combinées avec celles propres à la collection. Un remplacement qui les ignore cassera toutes les pages qui intègrent la collection. Respectez au minimum les props suivantes :

| Prop | Ce qu'attend l'appelant |
|---|---|
| `collectionOverrides` | Les modifications apportées par l'appelant à la collection (un filtre fixe, un tri, le mode d'affichage), appliquées par-dessus la collection enregistrée |
| `fields` | Uniquement ces propriétés, dans cet ordre : les colonnes, et les éléments servant à alimenter les lignes de liste et les cartes |
| `highlightedIds` | Les identifiants des lignes affichées comme sélectionnées ; `[]` pour aucune |
| `onRowClick` | Appelé avec la ligne cliquée, telle qu'envoyée par le serveur, et son identifiant, au lieu de l'ouvrir. Correspond au propre `onRowClick` du panneau |

Le panneau transmet également `viewMode` (le mode dans lequel s'ouvrir), `toolbar` (la barre d'outils à afficher, `null` pour aucune) et `title` (`false` pour ne pas afficher de titre), lorsque son appelant les a définis. Le composant intégré `CollectionViewBinding` prend en charge l'ensemble de ces éléments ; une surcharge qui l'enveloppe plutôt que de le remplacer peut simplement les transmettre directement.

Pour partir de l'élément intégré plutôt que de zéro, copiez son code source dans votre projet et enregistrez la copie ici : chaque partie, à l'exception de `Collection.View`, `DetailView` et du glisser-déposer de la page d'accueil, se compile avec les imports de packages. Voir [Copier une partie intégrée](/docs/frontend/customizing#copying-a-built-in-part).

## Voir aussi

- [Étendre Rebase](/docs/frontend/extending/) — les points d'extension qui ne nécessitent pas de surcharge
- [Champs personnalisés](/docs/frontend/custom-fields/) — remplacer l'éditeur d'une seule propriété plutôt qu'un composant entier
- [Slots](/docs/frontend/slots/) — ajouter des éléments à un composant au lieu de le remplacer
