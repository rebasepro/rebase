---
sourceHash: 3e8accd144f401d4
title: Surcharges de composants (Swizzling)
sidebar_label: Surcharges de composants
description: Remplacez les composants d'UI par défaut par des implémentations personnalisées au niveau de l'application ou de la collection.
---

## Vue d'ensemble

Rebase vous permet de remplacer les composants d'UI par défaut par vos propres implémentations personnalisées. Cela implémente un modèle de swizzling de composants de style Docusaurus qui prend en charge deux modèles de personnalisation :
- **Mode eject** (par défaut) : Votre composant remplace entièrement celui intégré.
- **Mode wrap** (`wrap: true`) : Votre composant enveloppe l'original. Le composant intégré est passé en tant que prop `OriginalComponent` afin que vous puissiez le rendre à l'intérieur de votre mise en page/logique personnalisée.

Les surcharges de composants peuvent être appliquées **globalement** au niveau de l'application (sur le provider `<Rebase>`) ou **localement** au niveau de la collection (à l'intérieur des définitions de collections individuelles).

---

## Surcharges globales de composants

Pour surcharger des composants globalement dans toute votre application, passez un objet `components` au provider racine `<Rebase>`.

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

Pour surcharger des composants uniquement pour une collection spécifique, ajoutez un objet `components` à sa définition. C'est utile pour personnaliser les états vides, les cartes ou les vues de détail pour des modèles particuliers.

```tsx
import { defineCollection } from "@rebasepro/cms-types";
import { ProductCustomForm } from "./components/ProductCustomForm";

const productsCollection = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: { /* ... */ },
    admin: {
        components: {
            // Eject Mode: Replace the default entity form view
            "Entity.Form": { Component: ProductCustomForm },

            // Wrap Mode: Wrap the empty state to add quick links
            "Collection.EmptyState": {
                // `OriginalComponent` is injected at runtime when `wrap: true`; the override
                    // slot's type does not model it, hence the annotation.
                    Component: (({ OriginalComponent, ...props }: {
                        OriginalComponent: React.ComponentType<Record<string, unknown>>
                    }) => (
                    <div className="empty-state-wrapper">
                        <OriginalComponent {...props} />
                        <button onClick={() => importDemoProducts()}>
                            Load Demo Products
                        </button>
                    </div>
                )) as unknown as React.ComponentType<Record<string, unknown>>,
                wrap: true
            }
        }
    }
});

```

---

## Portées des composants surchargeables

### Composants à portée application (`AppComponentName`)

Ces composants ne peuvent être surchargés qu'au niveau du provider racine `<Rebase>`, car ils représentent la structure au niveau du shell.

| Clé du composant | Description |
|---|---|
| `"Shell.AppBar"` | La barre d'en-tête en haut de la page |
| `"Shell.Drawer"` | Le tiroir de navigation latéral principal repliable |
| `"Shell.DrawerNavigationItem"` | Liens individuels à l'intérieur de la barre latérale |
| `"Shell.DrawerNavigationGroup"` | En-têtes de groupes de navigation repliables dans la barre latérale |
| `"HomePage"` | La page d'accueil par défaut en mode contenu |
| `"HomePage.CollectionCard"` | Cartes de collection individuelles sur la page d'accueil |
| `"Auth.LoginView"` | La superposition affichée lors de la demande d'authentification |

### Composants à portée collection (`CollectionComponentName`)

Ces composants peuvent être surchargés globalement (agissant comme valeurs par défaut pour toutes les collections) ou sur des collections individuelles.

| Clé du composant | Description |
|---|---|
| `"Collection.View"` | La page d'accueil complète de la collection |
| `"Collection.Table"` | La vue tabulaire de type tableur par défaut |
| `"Collection.Card"` | L'enveloppe de l'élément de la vue en cartes |
| `"Collection.EmptyState"` | Vue affichée lorsqu'une collection est vide |
| `"Collection.Actions"` | Boutons de barre d'outils au-dessus du tableau/des cartes |
| `"Collection.FilterField"` | Champ de filtre personnalisé pour une colonne |
| `"Entity.Form"` | Le formulaire de détail pour créer/mettre à jour |
| `"EditView.FormActions"` | Barre de boutons de soumission/annulation du formulaire |
| `"DetailView"` | Vue de détail en lecture seule |
| `"Entity.SidePanel"` | Le conteneur du panneau latéral pour formulaire/détail |
| `"EntityPreview"` | Aperçu en ligne de la puce de référence/relation |
| `"Entity.MissingReference"` | Rendu lorsqu'une entité référencée est manquante |
