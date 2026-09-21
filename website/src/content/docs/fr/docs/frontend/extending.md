---
sourceHash: 026e97ba1b999743
title: Étendre Rebase
sidebar_label: Étendre Rebase
description: Un guide de décision pour choisir le bon mécanisme d'extension — plugins, slots, surcharges de composants, vues d'entités, actions, et plus encore.
---

## Vue d'ensemble

Rebase propose environ une douzaine de mécanismes d'extension — plugins, slots, surcharges de composants, vues d'entités, actions, champs personnalisés, et plus encore. Chacun cible une portée différente (à l'échelle de l'application, par collection, par entité, par propriété) et une zone distincte de l'interface utilisateur.

Ce guide vous aide à choisir le bon mécanisme selon votre cas d'usage, puis renvoie vers la référence détaillée de chacun.

Tout ce qui est décrit ici concerne le **panneau d'administration**. Pour le serveur — restreindre une lecture, ajouter une route, intégrer le pilote dans votre propre processus, `rebase eject` — consultez [Rebase ne fait pas X](/docs/backend/extending), qui propose le même type de tableau pour le backend.

## Tableau de décision

| Je souhaite… | Mécanisme | Portée | Référence |
|---|---|---|---|
| Remplacer la barre d'application | `components` (`Shell.AppBar`) | application | [Surcharges de composants](/docs/frontend/component-overrides) |
| Remplacer la page de connexion | `components` (`Auth.LoginView`) | application | [Surcharges de composants](/docs/frontend/component-overrides) |
| Remplacer la page d'accueil | `components` (`HomePage`) | application | [Surcharges de composants](/docs/frontend/component-overrides) |
| Modifier entièrement l'apparence du formulaire d'une collection | `formView` | collection | [ci-dessous](#formview) |
| Remplacer un composant au sein d'une collection | `collection.components` | collection | [Surcharges de composants](/docs/frontend/component-overrides) |
| Définir des surcharges de composants par défaut pour toutes les collections | `components` (noms à portée collection) | application | [Surcharges de composants](/docs/frontend/component-overrides) |
| Ajouter un bouton à la barre d'outils de la collection | `Actions` de collection | collection | [Actions d'entité](/docs/frontend/entity-actions#collection-actions) |
| Injecter de l'interface dans un slot de la barre d'outils de collection | slot `collection.actions` | application/plugin | [Slots](/docs/frontend/slots) |
| Ajouter une colonne calculée à un tableau | `additionalFields` | collection | [Colonnes supplémentaires](/docs/frontend/additional-columns) |
| Ajouter un widget de champ personnalisé pour un type de propriété | `propertyConfigs` | type de propriété | [Champs personnalisés](/docs/frontend/custom-fields) |
| Ajouter un onglet d'entité | `entityViews` | entité | [Vues d'entité](/docs/frontend/entity-views) |
| Restituer les lignes d'une collection d'une manière différente | `admin.customViews` | collection | [ci-dessous](#customviews) |
| Ajouter une action de ligne/contexte ou un bouton d'entité | `entityActions` | entité | [Actions d'entité](/docs/frontend/entity-actions) |
| Afficher un indicateur sur la carte de page d'accueil d'une collection | slot `home.card.widget` | application/plugin | [Slots](/docs/frontend/slots) |
| Injecter de l'interface à un emplacement précis du chrome | `slots` | application/plugin | [Slots](/docs/frontend/slots) |
| Livrer plusieurs extensions sous forme d'une seule unité installable | `plugins` | application | [Plugins](/docs/plugins) |
| Styliser ce que je viens de construire | `@rebasepro/ui` + tokens de thème | tout | [Styliser l'interface personnalisée](/docs/frontend/styling) |

:::tip[Quel que soit votre choix, construisez-le à partir du kit]
Chaque mécanisme ci-dessous vous transmet un composant React sans rien imposer sur la manière de le remplir. Utilisez les composants `@rebasepro/ui` et les tokens de couleur du thème plutôt que du CSS écrit à la main — une vue personnalisée reste une vue d'administration, et une couleur codée en dur devient invisible dans l'un des deux thèmes. Consultez [Styliser l'interface personnalisée](/docs/frontend/styling).
:::

## Mécanismes en détail

### Plugins

**Portée :** application.

Un plugin regroupe des collections, des vues, des surcharges de composants, des contributions de slots, l'authentification, des sources de données, des providers, des hooks et des callbacks de cycle de vie au sein d'une seule unité installable. Tous les autres mécanismes présentés ici peuvent être fournis via l'interface d'un plugin.

→ [Référence des plugins](/docs/plugins)

### Slots

**Portée :** application (contribué par slot).

Les slots sont des points d'extension d'interface utilisateur nommés, répartis dans tout le chrome du CMS. Vous enregistrez un composant React ciblant le nom d'un slot, et il s'affiche à cet emplacement. Il existe 27 slots couvrant la page d'accueil, la navigation, les vues de collection, les formulaires, les lignes d'entités, les champs de formulaire et la barre d'application — et chacun d'entre eux est rendu.

→ [Référence des slots](/docs/frontend/slots)

### Surcharges de composants (Swizzling)

**Portée :** valeurs par défaut au niveau de l'application ou par collection.

Deux modes : **Eject** (remplacement complet) ou **Wrap** (enrichissement de l'original).

19 noms de composants surchargeables répartis sur deux niveaux :

**Application uniquement (7) :**
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

**Priorité :** Les `components` au niveau de la collection prévalent sur les valeurs par défaut au niveau de l'application pour le même nom de composant (simple décomposition d'objet — les valeurs de la collection écrasent les valeurs globales). Les composants réservés à l'application (`Shell.*`, `HomePage`, `Auth.*`) ne peuvent être surchargés qu'au niveau `<Rebase>`.

→ [Surcharges de composants](/docs/frontend/component-overrides)

### Vues d'entité (Entity Views)

**Portée :** entité (ajoute des onglets).

Vues personnalisées qui apparaissent sous forme d'onglets dans la page de détail de l'entité. Peuvent être définies globalement sur `<Rebase>` ou par collection.

→ [Vues d'entité](/docs/frontend/entity-views)

### Actions d'entité (Entity Actions)

**Portée :** entité.

Boutons d'action personnalisés sur des entités individuelles (publier, archiver, cloner, etc.). Peuvent être définis globalement ou par collection.

→ [Actions d'entité](/docs/frontend/entity-actions)

### `Actions` de collection

**Portée :** collection.

Composants React au niveau de la barre d'outils qui reçoivent `CollectionActionsProps` (entités sélectionnées, contrôleur de tableau, contexte de la collection). Rendus dans la barre d'outils de la collection aux côtés des actions intégrées.

**Relation avec le slot `collection.actions` :** Les deux sont additifs — les composants `Actions` sont rendus en premier dans la barre d'outils, suivis des contributions du slot `collection.actions`. Ils ne se remplacent pas mutuellement.

→ [Actions d'entité — Actions de collection](/docs/frontend/entity-actions#collection-actions)

### Modes de vue personnalisés {#customviews}

**Portée :** collection (ajoute un mode de vue).

Une carte, un calendrier, une galerie, une frise chronologique — une autre restitution de *ces mêmes lignes*, proposée dans le sélecteur de vue de la collection à côté de Liste, Tableau, Cartes et Tableau Kanban (Board).

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

Ou enregistrez le composant une seule fois et référencez-le par sa clé, ce qui le rend également sélectionnable depuis l'éditeur de collection :

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

`Builder` reçoit le `tableController` en direct, de sorte que la vue hérite des filtres de la collection, du champ de recherche, du tri, de la pagination, des vérifications de permissions et du panneau latéral de l'entité — c'est la raison d'être de cette approche plutôt que de construire une `AppView` :

```tsx
function MapView({ tableController, onEntityClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.data.map(e => e.values.location)}
        onMarkerClick={i => onEntityClick?.(tableController.data[i])}
    />;
}
```

Choisir la vue met à jour `?__view=`, résiste au rechargement de la page et persiste par utilisateur. En déclarer une suffit à la proposer — `enabledViews` n'a besoin d'être configuré que si vous souhaitez *retirer les vues intégrées*. Avec une seule entrée, le sélecteur est masqué.

**Ce n'est pas un moyen de concevoir une vue couvrant plusieurs collections.** Un mode de vue est une autre restitution de la requête d'une seule collection. Si votre composant ignore `tableController` et va chercher quatre tables de son côté, il doit être une [`AppView`](/docs/frontend#custom-views) — la barre d'outils au-dessus, avec sa zone de recherche et son décompte d'enregistrements, décrirait une requête qu'il ne rend pas.

### `formView` {#formview}

**Portée :** collection.

Remplace l'intégralité du formulaire d'entité par défaut par un composant personnalisé. Se définit sur la configuration d'une collection :

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

À utiliser lorsque vous avez besoin d'une mise en page complètement sur mesure pour l'expérience d'édition des entités d'une collection. Pour des ajustements plus légers, préférez `collection.components` avec la surcharge de `Entity.Form`.

Le Builder est rendu au sein du formulaire de l'enregistrement et reçoit son `formContext` en direct : écrivez avec `formContext.setFieldValue`, et le bouton Enregistrer de la barre sauvegarde l'enregistrement. Lorsque l'enregistrement ne peut pas être modifié — la vue de détail en lecture seule, ou un utilisateur sans permission de modification — `formContext.disabled` vaut `true` et les écritures lèvent une exception. Définissez `includeActions: false` si votre Builder effectue lui-même la sauvegarde via `formContext.submit()`.

### `additionalFields`

**Portée :** collection.

Colonnes calculées/virtuelles affichées dans le tableau de la collection. Elles ne correspondent pas à des propriétés enregistrées — elles sont calculées lors du rendu.

→ [Colonnes supplémentaires](/docs/frontend/additional-columns)

### `propertyConfigs`

**Portée :** type de propriété.

Widgets de champs personnalisés pour des types de propriétés spécifiques, fournissant des composants de champs de formulaire et d'aperçu sur mesure.

→ [Champs personnalisés](/docs/frontend/custom-fields)

## Hors du panneau d'administration

Si ce que vous souhaitez modifier relève du comportement du serveur plutôt que de l'affichage du panneau, vous n'êtes pas sur la bonne page. Le serveur a sa propre grille de solutions :

| Je souhaite… | Échelon | Référence |
|---|---|---|
| Restreindre les lignes renvoyées par une lecture | callback `beforeQuery` <span class="since-badge" data-since="0.22">Depuis 0.22</span> | [Étendre le serveur](/docs/backend/extending#2-collection-callbacks) |
| Masquer une valeur lors de la sortie | callback `afterRead` | [Callbacks](/docs/collections/callbacks) |
| Ajouter mon propre endpoint | fonction personnalisée | [Fonctions personnalisées](/docs/backend/custom-functions) |
| Permettre à la recherche de trouver des sous-chaînes *et* d'ignorer les accents | `search.mode: "hybrid"` <span class="since-badge" data-since="0.22">Depuis 0.22</span> | [Recherche](/docs/backend/search) |
| Avoir le contrôle total du processus serveur | serveur personnalisé, puis `rebase eject` | [Étendre le serveur](/docs/backend/extending) |

→ [Rebase ne fait pas X](/docs/backend/extending)

## Résumé de l'ordre de priorité

- **`collection.components` prévaut sur les `components` globaux** à l'intérieur de cette collection (fusion simple par décomposition dans `DataCollectionView`).
- **Les `Actions` de collection et le slot `collection.actions` sont additifs** — les `Actions` sont rendues en premier, puis les contributions du slot.
- **Les `entityActions` et `entityViews` au niveau de la collection étendent (sans remplacer) les composants globaux.**
- **Les contributions des plugins sont fusionnées selon l'ordre des `key`.**
