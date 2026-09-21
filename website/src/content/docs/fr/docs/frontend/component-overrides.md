---
sourceHash: 973d76b134971c29
title: Surcharges de composants (Swizzling)
sidebar_label: Surcharges de composants
description: Remplacez les composants d'interface utilisateur par défaut par des implémentations personnalisées au niveau de l'application ou de la collection.
---

## Vue d'ensemble

Rebase vous permet de surcharger les composants d'interface utilisateur (UI) par défaut avec vos propres implémentations personnalisées. Cela implémente un modèle de swizzling de composants inspiré de Docusaurus qui prend en charge deux modèles de personnalisation :
- **Mode Eject** (par défaut) : Votre composant remplace intégralement le composant intégré.
- **Mode Wrap** (`wrap: true`) : Votre composant enveloppe l'original. Le composant intégré est transmis sous forme de prop `OriginalComponent`, ce qui vous permet de l'afficher au sein de votre disposition ou logique personnalisée.

Les surcharges de composants peuvent être appliquées **globalement** au niveau de l'application (sur le fournisseur `<Rebase>`) ou **localement** au niveau de la collection (dans les définitions individuelles de collections).

---

## Surcharges globales de composants

Pour surcharger des composants de manière globale dans l'ensemble de votre application, passez un objet `components` au fournisseur racine `<Rebase>`.

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

<span class="since-badge" data-since="0.22">Depuis la version 0.22</span> Dans la structure par défaut, `config/collections/` est chargé **à la fois** par le panneau d'administration et par le backend, qui lit les mêmes fichiers pour dériver le schéma et l'API. Référencez donc chaque composant par son **chemin de module** plutôt qu'en l'important. `Component` accepte les mêmes formes que `admin.Field` et `entityViews[].Builder` : un chemin, un `import()` paresseux (lazy), ou le composant lui-même.

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

Le composant enveloppant réside avec le reste de votre code frontend et reçoit le composant intégré sous le nom `OriginalComponent` :

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

Chaque module a besoin d'un **export par défaut** (`default export`). Le plugin Vite des collections réécrit un chemin en un import paresseux, de sorte que le composant constitue son propre bloc (chunk) et se charge la première fois que la surcharge est rendue. Cette réécriture concerne les fichiers situés dans le `collectionsDir` configuré. Un chemin dans un fichier en dehors de celui-ci parvient à l'interface d'administration sous la forme d'une chaîne brute : la console le signale, et le composant intégré s'affiche à sa place. En dehors de `collectionsDir`, écrivez vous-même l'import paresseux : `Component: () => import("../../frontend/src/ProductCustomForm")`.

Une référence directe (`Component: ProductCustomForm`) fonctionne également, mais uniquement dans un fichier de collection que le serveur ne charge pas, car importer le composant importe également React ainsi que toutes ses dépendances.

---

## Portées des composants surchargeables

### Composants à portée applicative (`AppComponentName`)

Ces composants ne peuvent être surchargés qu'au niveau du fournisseur racine `<Rebase>` car ils représentent la structure globale de l'interface (shell).

| Clé de composant | Description |
|---|---|
| `"Shell.AppBar"` | La barre d'en-tête en haut de la page |
| `"Shell.Drawer"` | Le volet de navigation latéral principal repliable |
| `"Shell.DrawerNavigationItem"` | Liens individuels à l'intérieur du volet latéral |
| `"Shell.DrawerNavigationGroup"` | En-têtes de groupes de navigation repliables dans le volet latéral |
| `"HomePage"` | La page d'accueil par défaut en mode contenu |
| `"HomePage.CollectionCard"` | Cartes de collection individuelles sur la page d'accueil |
| `"Auth.LoginView"` | La fenêtre modale/superposition affichée lors d'une demande d'authentification |

### Composants à portée de collection (`CollectionComponentName`)

Ces composants peuvent être surchargés globalement (faisant office de valeurs par défaut pour toutes les collections) ou sur des collections individuelles.

| Clé de composant | Description |
|---|---|
| `"Collection.View"` | La page d'accueil complète de la collection |
| `"Collection.Table"` | La vue tabulaire de type feuille de calcul par défaut |
| `"Collection.Card"` | Le conteneur d'élément pour la vue en cartes |
| `"Collection.EmptyState"` | Vue affichée lorsqu'une collection est vide |
| `"Collection.Actions"` | Boutons de la barre d'outils au-dessus du tableau/des cartes |
| `"Collection.FilterField"` | Champ de saisie de filtre personnalisé pour une colonne |
| `"Entity.Form"` | Le formulaire de détail pour la création/mise à jour |
| `"EditView.FormActions"` | Barre de boutons de soumission/annulation de formulaire |
| `"DetailView"` | Vue détaillée en lecture seule |
| `"Entity.SidePanel"` | Le conteneur du panneau latéral pour le formulaire/détail |
| `"EntityPreview"` | Aperçu intégré sous forme de puce (chip) de référence/relation |
| `"Entity.MissingReference"` | Affiché lorsqu'une entité référencée est introuvable |

:::note[Trois clés ne respectent pas le motif `Entity.`]
`"DetailView"`, `"EntityPreview"` et `"EditView.FormActions"` ne comportent pas
le préfixe `Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` et `"Entity.FormActions"`
ne font pas partie de l'union — ils génèrent une erreur de type, et en JavaScript pur,
la surcharge ne s'applique tout simplement jamais.
:::

Votre composant de remplacement reçoit les mêmes props que celles fournies au composant intégré.
La table des surcharges ne définit pas un type de props par clé — `ComponentOverride<P>` définit
par défaut `P` sur `Record<string, unknown>` — vous devez donc typer le paramètre vous-même,
ou passer un argument de type, lorsque vous souhaitez que les props soient vérifiées.
Quelques-uns des composants intégrés exportent un type de props que vous pouvez importer et réutiliser :
`CollectionViewProps` (`@rebasepro/ui`) ; `CollectionEmptyStateProps`, `CollectionActionsProps` et
`FilterFieldBindingProps` (`@rebasepro/cms-types`) ; `EntityFormProps` et `EntityFormActionsProps`
(`@rebasepro/cms`). Les autres ne disposent pas d'un type de props exporté — écrivez la structure que
vous utilisez réellement.

## En savoir plus

- [Étendre Rebase](/docs/frontend/extending/) — les points d'extension qui ne nécessitent pas de surcharge
- [Champs personnalisés](/docs/frontend/custom-fields/) — remplacer l'éditeur d'une propriété plutôt qu'un composant entier
- [Slots](/docs/frontend/slots/) — ajouter du contenu à un composant plutôt que de le remplacer
