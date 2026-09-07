---
sourceHash: 5de2aebf9af99221
title: Étendre Rebase
sidebar_label: Étendre Rebase
description: Un guide de décision pour choisir le bon mécanisme d'extension — plugins, slots, surcharges de composants, vues d'entité, actions et plus.
---

## Vue d'ensemble

Rebase offre environ une douzaine de mécanismes d'extension — plugins, slots, surcharges de composants, vues d'entité, actions, champs personnalisés et plus. Chacun cible une portée différente (à l'échelle de l'app, par collection, par entité, par propriété) et une partie différente de l'UI.

Ce guide vous aide à choisir le bon mécanisme pour votre cas d'usage, puis renvoie vers la référence détaillée de chacun.

## Table de décision

| Je veux… | Mécanisme | Portée | Référence |
|---|---|---|---|
| Remplacer la barre d'app | `components` (`Shell.AppBar`) | app | [Surcharges de composants](/docs/frontend/component-overrides) |
| Remplacer la page de connexion | `components` (`Auth.LoginView`) | app | [Surcharges de composants](/docs/frontend/component-overrides) |
| Remplacer la page d'accueil | `components` (`HomePage`) | app | [Surcharges de composants](/docs/frontend/component-overrides) |
| Changer entièrement l'apparence du formulaire d'une collection | `formView` | collection | [ci-dessous](#formview) |
| Échanger un composant dans une collection | `collection.components` | collection | [Surcharges de composants](/docs/frontend/component-overrides) |
| Définir des surcharges de composants par défaut pour toutes les collections | `components` (noms à portée collection) | app | [Surcharges de composants](/docs/frontend/component-overrides) |
| Ajouter un bouton à la barre d'outils de la collection | `Actions` de collection | collection | [Actions d'entité](/docs/frontend/entity-actions#collection-actions) |
| Injecter de l'UI à un slot de la barre d'outils de la collection | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Ajouter une colonne calculée à un tableau | `additionalFields` | collection | [Colonnes supplémentaires](/docs/frontend/additional-columns) |
| Ajouter un widget de champ personnalisé pour un type de propriété | `propertyConfigs` | type de propriété | [Champs personnalisés](/docs/frontend/custom-fields) |
| Ajouter un onglet d'entité | `entityViews` | entité | [Vues d'entité](/docs/frontend/entity-views) |
| Ajouter une action de ligne/contexte ou un bouton d'entité | `entityActions` | entité | [Actions d'entité](/docs/frontend/entity-actions) |
| Injecter de l'UI à un emplacement spécifique du chrome | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Livrer plusieurs extensions en une seule unité installable | `plugins` | app | [Plugins](/docs/plugins) |

## Mécanismes en détail

### Plugins

**Portée :** app.

Un plugin regroupe des collections, des vues, des surcharges de composants, des contributions de slots, l'authentification, des sources de données, des providers, des hooks et des callbacks de cycle de vie en une seule unité installable. Tous les autres mécanismes listés ici peuvent être contribués via l'interface d'un plugin.

→ [Référence Plugins](/docs/plugins)

### Slots

**Portée :** app (contribué par slot).

Les slots sont des points d'extension d'UI nommés répartis dans tout le chrome du CMS. Vous enregistrez un composant React ciblant un nom de slot, et il est rendu à cet emplacement. Il y a 29 slots couvrant la page d'accueil, la navigation, les vues de collection, les formulaires, les lignes d'entité, les tableaux de bord et plus.

→ [Référence Slots](/docs/frontend/slots)

### Surcharges de composants (Swizzling)

**Portée :** valeurs par défaut au niveau app ou par collection.

Deux modes : **Eject** (remplacement complet) ou **Wrap** (augmenter l'original).

19 noms de composants surchargeables en deux niveaux :

**App uniquement (7) :**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Portée collection (12) :**
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

**Priorité :** Les `components` au niveau de la collection surchargent les valeurs par défaut au niveau de l'app pour le même nom de composant (spread d'objet simple — les valeurs de la collection écrasent les valeurs globales). Les noms de composants app-uniquement (`Shell.*`, `HomePage`, `Auth.*`) ne peuvent être surchargés qu'au niveau de `<Rebase>`.

→ [Surcharges de composants](/docs/frontend/component-overrides)

### Vues d'entité

**Portée :** entité (ajoute des onglets).

Vues personnalisées qui apparaissent sous forme d'onglets sur la page de détail de l'entité. Peuvent être définies globalement sur `<Rebase>` ou par collection.

→ [Vues d'entité](/docs/frontend/entity-views)

### Actions d'entité

**Portée :** entité.

Boutons d'action personnalisés sur des entités individuelles (publier, archiver, cloner, etc.). Peuvent être définis globalement ou par collection.

→ [Actions d'entité](/docs/frontend/entity-actions)

### `Actions` de collection

**Portée :** collection.

Composants React au niveau de la barre d'outils qui reçoivent `CollectionActionsProps` (entités sélectionnées, contrôleur de tableau, contexte de collection). Rendus dans la barre d'outils de la collection aux côtés des actions intégrées.

**Relation avec le slot `collection.actions` :** Les deux sont additifs — les composants `Actions` sont rendus en premier dans la barre d'outils, puis les contributions de slot de `collection.actions`. Ils ne se remplacent pas mutuellement.

→ [Actions d'entité — Actions de collection](/docs/frontend/entity-actions#collection-actions)

### `formView` {#formview}

**Portée :** collection.

Remplace l'intégralité du formulaire d'entité par défaut par un composant personnalisé. Défini sur une définition de collection :

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // show save/delete bar (default: true)
        }
    }
};

```

Utilisez-le lorsque vous avez besoin d'une mise en page entièrement personnalisée pour l'expérience d'édition d'entités d'une collection. Pour des ajustements plus petits, préférez plutôt `collection.components` avec la surcharge `Entity.Form`.

### `additionalFields`

**Portée :** collection.

Colonnes calculées/virtuelles affichées dans le tableau de la collection. Elles ne correspondent pas à des propriétés stockées — elles sont calculées au moment du rendu.

→ [Colonnes supplémentaires](/docs/frontend/additional-columns)

### `propertyConfigs`

**Portée :** type de propriété.

Widgets de champ personnalisés pour des types de propriété spécifiques, fournissant des champs de formulaire et des composants d'aperçu personnalisés.

→ [Champs personnalisés](/docs/frontend/custom-fields)

## Résumé de priorité

- **`collection.components` l'emporte sur les `components` globaux** à l'intérieur de cette collection (fusion par spread simple dans `DataCollectionView`).
- **Les `Actions` de collection et le slot `collection.actions` sont additifs** — les `Actions` sont rendues en premier, puis les contributions de slot.
- **Les `entityActions` et `entityViews` au niveau de la collection étendent (ne remplacent pas) les globaux.**
- **Les contributions de plugin sont fusionnées dans l'ordre des `key`.**
