---
sourceHash: 3e8accd144f401d4
title: Remplacement de composants (Swizzling)
sidebar_label: Remplacement de composants
description: Remplacez les composants d'interface utilisateur par défaut par des implémentations personnalisées au niveau de l'application ou de la collection.
---

## Aperçu

Rebase vous permet de remplacer les composants d'interface utilisateur par défaut par vos propres implémentations personnalisées. Cela met en œuvre un modèle de « swizzling » de composants similaire à celui de Docusaurus qui prend en charge deux approches de personnalisation :
- **Mode Eject** (par défaut) : votre composant remplace entièrement le composant intégré.
- **Mode Wrap** (`wrap: true`) : votre composant enveloppe l'original. Le composant intégré est transmis via la prop `OriginalComponent` afin que vous puissiez l'afficher à l'intérieur de votre disposition ou logique personnalisée.

Les remplacements de composants peuvent être appliqués **globalement** au niveau de l'application (sur le fournisseur `<Rebase>`) ou **localement** au niveau de la collection (au sein des définitions individuelles de collections).

---

## Remplacements de composants globaux

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

Pour remplacer des composants uniquement pour une collection spécifique, ajoutez un objet `components` à sa définition. Cela est utile pour personnaliser les états vides, les cartes ou les vues de détail pour des modèles particuliers.

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

## Portées des composants remplaçables

### Composants à portée applicative (`AppComponentName`)

Ces composants ne peuvent être remplacés qu'au niveau du fournisseur racine `<Rebase>` puisqu'ils représentent la structure du shell applicatif.

| Clé du composant | Description |
|---|---|
| `"Shell.AppBar"` | La barre d'en-tête en haut de la page |
| `"Shell.Drawer"` | Le volet de navigation latéral principal rétractable |
| `"Shell.DrawerNavigationItem"` | Liens individuels dans la barre latérale |
| `"Shell.DrawerNavigationGroup"` | En-têtes de groupes de navigation rétractables dans la barre latérale |
| `"HomePage"` | La page d'accueil par défaut en mode contenu |
| `"HomePage.CollectionCard"` | Cartes de collection individuelles sur la page d'accueil |
| `"Auth.LoginView"` | La vue superposée affichée lors d'une demande d'authentification |

### Composants à portée de collection (`CollectionComponentName`)

Ces composants peuvent être remplacés globalement (servant de valeurs par défaut pour toutes les collections) ou sur des collections individuelles.

| Clé du composant | Description |
|---|---|
| `"Collection.View"` | La page principale complète de la collection |
| `"Collection.Table"` | La vue tabulaire de type feuille de calcul par défaut |
| `"Collection.Card"` | Le conteneur d'élément en vue carte |
| `"Collection.EmptyState"` | Vue affichée lorsqu'une collection est vide |
| `"Collection.Actions"` | Boutons de la barre d'outils au-dessus du tableau/des cartes |
| `"Collection.FilterField"` | Champ de filtre personnalisé pour une colonne |
| `"Entity.Form"` | Le formulaire de détail pour la création/mise à jour |
| `"EditView.FormActions"` | Barre de boutons de soumission/annulation du formulaire |
| `"DetailView"` | Vue détaillée en lecture seule |
| `"Entity.SidePanel"` | Le conteneur du panneau latéral pour le formulaire/détail |
| `"EntityPreview"` | Aperçu inline sous forme de pastille pour une référence/relation |
| `"Entity.MissingReference"` | Affiché lorsqu'une entité référencée est manquante |

:::note[Trois clés dérogent au modèle `Entity.`]
`"DetailView"`, `"EntityPreview"` et `"EditView.FormActions"` ne comportent pas de préfixe `Entity.`. `"Entity.DetailView"`, `"Entity.Preview"` et `"Entity.FormActions"` ne font pas partie de l'union — ils provoquent une erreur de type et, en JavaScript pur, le remplacement ne s'appliquera tout simplement jamais.
:::

Votre composant de remplacement reçoit les mêmes props que celles transmises au composant intégré. Le mapping de remplacement ne spécifie pas de type de props par clé — `ComponentOverride<P>` applique par défaut `Record<string, unknown>` à `P` — typez donc vous-même le paramètre, ou passez un argument de type, lorsque vous souhaitez valider les types des props. Certains composants intégrés exportent un type de props que vous pouvez importer et réutiliser : `CollectionViewProps` (`@rebasepro/ui`) ; `CollectionEmptyStateProps`, `CollectionActionsProps` et `FilterFieldBindingProps` (`@rebasepro/cms-types`) ; `EntityFormProps` et `EntityFormActionsProps` (`@rebasepro/cms`). Les autres ne disposent d'aucun type de props exporté — écrivez la structure que vous utilisez réellement.

## Voir aussi

- [Étendre Rebase](/docs/frontend/extending/) — les points d'extension qui ne nécessitent pas de remplacement
- [Champs personnalisés](/docs/frontend/custom-fields/) — remplacer l'éditeur d'une propriété plutôt qu'un composant entier
- [Slots](/docs/frontend/slots/) — ajouter du contenu à un composant au lieu de le remplacer
