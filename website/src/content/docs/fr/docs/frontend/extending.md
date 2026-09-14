---
sourceHash: 387b83637f6dc883
title: Étendre Rebase
sidebar_label: Étendre Rebase
description: Un guide de décision pour choisir le bon mécanisme d'extension — plugins, slots, surcharges de composants, vues d'entités, actions et plus encore.
---

## Vue d'ensemble

Rebase propose une douzaine de mécanismes d'extension — plugins, slots, surcharges de composants, vues d'entités, actions, champs personnalisés, et bien plus. Chacun cible une portée différente (à l'échelle de l'application, par collection, par entité, par propriété) et une partie distincte de l'interface utilisateur.

Ce guide vous aide à choisir le mécanisme adapté à votre cas d'usage, puis renvoie vers la référence détaillée de chacun.

## Tableau de décision

| Je souhaite… | Mécanisme | Portée | Référence |
|---|---|---|---|
| Remplacer la barre d'application | `components` (`Shell.AppBar`) | application | [Surcharges de composants](/docs/frontend/component-overrides) |
| Remplacer la page de connexion | `components` (`Auth.LoginView`) | application | [Surcharges de composants](/docs/frontend/component-overrides) |
| Remplacer la page d'accueil | `components` (`HomePage`) | application | [Surcharges de composants](/docs/frontend/component-overrides) |
| Modifier entièrement l'apparence du formulaire d'une collection | `formView` | collection | [ci-dessous](#formview) |
| Remplacer un composant au sein d'une collection | `collection.components` | collection | [Surcharges de composants](/docs/frontend/component-overrides) |
| Définir des surcharges de composants par défaut pour toutes les collections | `components` (noms de portée collection) | application | [Surcharges de composants](/docs/frontend/component-overrides) |
| Ajouter un bouton à la barre d'outils de la collection | `Actions` de collection | collection | [Actions d'entité](/docs/frontend/entity-actions#collection-actions) |
| Injecter de l'interface dans un slot de barre d'outils de collection | Slot `collection.actions` | application/plugin | [Slots](/docs/frontend/slots) |
| Ajouter une colonne calculée à un tableau | `additionalFields` | collection | [Colonnes supplémentaires](/docs/frontend/additional-columns) |
| Ajouter un widget de champ personnalisé pour un type de propriété | `propertyConfigs` | type de propriété | [Champs personnalisés](/docs/frontend/custom-fields) |
| Ajouter un onglet d'entité | `entityViews` | entité | [Vues d'entités](/docs/frontend/entity-views) |
| Rendre les lignes d'une collection d'une manière différente | `admin.customViews` | collection | [ci-dessous](#customviews) |
| Ajouter une action de ligne/contexte ou un bouton d'entité | `entityActions` | entité | [Actions d'entité](/docs/frontend/entity-actions) |
| Afficher un chiffre sur la carte d'une collection sur la page d'accueil | Slot `home.card.widget` | application/plugin | [Slots](/docs/frontend/slots) |
| Injecter de l'interface à un endroit précis du chrome | `slots` | application/plugin | [Slots](/docs/frontend/slots) |
| Livrer plusieurs extensions sous forme d'une unité installable unique | `plugins` | application | [Plugins](/docs/plugins) |
| Styliser ce que je viens de créer | `@rebasepro/ui` + jetons de thème | tout | [Styliser une interface personnalisée](/docs/frontend/styling) |

:::tip[Quel que soit votre choix, construisez-le à partir du kit]
Chaque mécanisme ci-dessous vous fournit un composant React sans rien imposer quant à son contenu. Utilisez les composants `@rebasepro/ui` et les jetons de couleur du thème plutôt que du CSS écrit à la main — une vue personnalisée reste une vue d'administration, et une couleur codée en dur devient invisible dans l'un des deux thèmes. Consultez [Styliser une interface personnalisée](/docs/frontend/styling).
:::

## Les mécanismes en détail

### Plugins

**Portée :** application.

Un plugin regroupe des collections, des vues, des surcharges de composants, des contributions de slots, de l'authentification, des sources de données, des providers, des hooks et des callbacks de cycle de vie dans une seule unité installable. Tous les autres mécanismes listés ici peuvent être apportés via l'interface d'un plugin.

→ [Référence des plugins](/docs/plugins)

### Slots

**Portée :** application (contribué par slot).

Les slots sont des points d'extension d'interface nommés, répartis à travers le chrome du CMS. Vous enregistrez un composant React ciblant un nom de slot, et il est rendu à cet emplacement. Il existe 29 slots couvrant la page d'accueil, la navigation, les vues de collection, les formulaires, les lignes d'entités, les tableaux de bord et plus encore.

→ [Référence des slots](/docs/frontend/slots)

### Surcharges de composants (Swizzling)

**Portée :** valeurs par défaut au niveau de l'application ou par collection.

Deux modes : **Eject** (remplacement complet) ou **Wrap** (enrichissement de l'original).

19 noms de composants surchargeables répartis en deux niveaux :

**Niveau application uniquement (7) :**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**De portée collection (12) :**
- `Collection.View`
- `Collection.Table`
- `Collection.Card`
- `Collection.EmptyState`
- `Collection.Actions`
- `Collection.FilterField`
- `Entity.Form`
- `EditView.FormActions`
- `DetailView`
- `Entity.SidePanel`
- `EntityPreview`
- `Entity.MissingReference`

**Priorité :** Les `components` définis au niveau de la collection prévalent sur les valeurs par défaut au niveau de l'application pour le même nom de composant (simple fusion d'objet — les valeurs de la collection écrasent les valeurs globales). Les composants limités à l'application (`Shell.*`, `HomePage`, `Auth.*`) ne peuvent être surchargés qu'au niveau `<Rebase>`.

→ [Surcharges de composants](/docs/frontend/component-overrides)

### Vues d'entités

**Portée :** entité (ajoute des onglets).

Des vues personnalisées qui apparaissent sous forme d'onglets sur la page de détail d'une entité. Peuvent être définies globalement sur `<Rebase>` ou par collection.

→ [Vues d'entités](/docs/frontend/entity-views)

### Actions d'entité

**Portée :** entité.

Boutons d'action personnalisés sur des entités individuelles (publier, archiver, cloner, etc.). Peuvent être définis globalement ou par collection.

→ [Actions d'entité](/docs/frontend/entity-actions)

### `Actions` de collection

**Portée :** collection.

Composants React au niveau de la barre d'outils qui reçoivent `CollectionActionsProps` (entités sélectionnées, contrôleur de tableau, contexte de la collection). Rendus dans la barre d'outils de la collection aux côtés des actions intégrées.

**Relation avec le slot `collection.actions` :** Les deux s'additionnent — les composants `Actions` sont rendus en premier dans la barre d'outils, suivis des contributions du slot `collection.actions`. Ils ne se remplacent pas mutuellement.

→ [Actions d'entité — Actions de collection](/docs/frontend/entity-actions#collection-actions)

### Modes de vue personnalisés {#customviews}

**Portée :** collection (ajoute un mode de vue).

Une carte, un calendrier, une galerie, une chronologie — un autre rendu *des mêmes lignes*, proposé dans le sélecteur de vue de la collection aux côtés de Liste, Tableau, Cartes et Board.

```ts
// collection config
admin: {
    customViews: [
        { key: "map", name: "Map", icon: "Map", Builder: MapView }
    ],
    enabledViews: ["table", "map"],
    defaultViewMode: "map"
}
```

Ou enregistrez le composant une fois et nommez-le par sa clé, ce qui permet également de le sélectionner depuis l'éditeur de collection :

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

Le `Builder` reçoit le `tableController` actif, de sorte que la vue hérite des filtres de la collection, de la barre de recherche, du tri, de la pagination, des vérifications d'autorisations et du panneau latéral d'entité — c'est toute la raison d'en déclarer un plutôt que de construire une `AppView` :

```tsx
function MapView({ tableController, onEntityClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.data.map(e => e.values.location)}
        onMarkerClick={i => onEntityClick?.(tableController.data[i])}
    />;
}
```

Choisir la vue met à jour `?__view=`, persiste après un rechargement et est mémorisé par utilisateur. En déclarer une suffit à la proposer — `enabledViews` n'a besoin d'être configuré que lorsque vous souhaitez *retirer les vues intégrées*. Avec une seule entrée, le sélecteur est masqué.

**Ce n'est pas un moyen de créer une vue couvrant plusieurs collections.** Un mode de vue est un autre rendu de la requête d'une collection. Si votre composant ignore `tableController` et récupère lui-même quatre tables, il devrait plutôt être une [`AppView`](/docs/frontend#custom-views) — la barre d'outils située au-dessus, avec sa barre de recherche et son nombre d'enregistrements, décrirait alors une requête qu'il ne restitue pas.

### `formView` {#formview}

**Portée :** collection.

Remplace l'intégralité du formulaire d'entité par défaut par un composant personnalisé. Se définit sur la définition d'une collection :

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // Save and Discard in the bar (default: true)
        }
    }
};

```

À utiliser lorsque vous avez besoin d'une mise en page entièrement personnalisée pour l'expérience d'édition d'entités d'une collection. Pour des ajustements plus modestes, préférez `collection.components` avec une surcharge de `Entity.Form`.

Le Builder est rendu au sein du formulaire de l'enregistrement et reçoit son `formContext` actif : écrivez avec `formContext.setFieldValue`, et le bouton Enregistrer de la barre sauvegarde l'enregistrement. Lorsque l'enregistrement ne peut pas être modifié — vue détaillée en lecture seule ou utilisateur sans droits d'édition — `formContext.disabled` vaut `true` et les écritures lèvent une erreur. Définissez `includeActions: false` si votre Builder gère la sauvegarde de manière autonome via `formContext.submit()`.

### `additionalFields`

**Portée :** collection.

Colonnes calculées/virtuelles affichées dans le tableau de la collection. Elles ne correspondent pas à des propriétés stockées — elles sont calculées au moment du rendu.

→ [Colonnes supplémentaires](/docs/frontend/additional-columns)

### `propertyConfigs`

**Portée :** type de propriété.

Widgets de champs personnalisés pour des types de propriétés spécifiques, fournissant des champs de formulaire et des composants de prévisualisation personnalisés.

→ [Champs personnalisés](/docs/frontend/custom-fields)

## Résumé des priorités

- **`collection.components` l'emporte sur les `components` globaux** au sein de cette collection (fusion simple par décomposition d'objet dans `DataCollectionView`).
- **Les `Actions` de collection et le slot `collection.actions` s'additionnent** — les `Actions` sont rendues en premier, suivies des contributions de slots.
- **Les `entityActions` et `entityViews` au niveau de la collection étendent (et ne remplacent pas) les éléments globaux.**
- **Les contributions des plugins sont fusionnées selon l'ordre des clés (`key`).**
