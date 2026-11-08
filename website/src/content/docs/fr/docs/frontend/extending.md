---
sourceHash: ec086b9ec3b281fc
title: Étendre Rebase
sidebar_label: Étendre Rebase
description: Un guide de décision pour choisir le bon mécanisme d'extension — plugins, slots, remplacements de composants, vues d'entités, actions et plus encore.
---

## Vue d'ensemble

Rebase propose une dizaine de mécanismes d'extension — plugins, slots, remplacements de composants, vues d'entités, actions, champs personnalisés, et bien plus. Chacun cible une portée différente (à l'échelle de l'application, par collection, par entité, par propriété) et une partie différente de l'interface utilisateur.

Ce guide vous aide à choisir le bon mécanisme pour votre cas d'usage, puis renvoie à la documentation détaillée de chacun.

:::tip[Commencez par le modèle, pas par la liste]
Chaque mécanisme ci-dessous repose sur la même base : un composant React placé à un endroit précis. [Personnaliser l'administration](/docs/frontend/customizing) explique ce modèle sur une seule page — composants de base, hooks, emplacements — avec des recettes testées pour un singleton de configuration, des paramètres par utilisateur, une action groupée, une vue calendrier, un tableau de bord et un écran de connexion personnalisé. Lisez-le d'abord, puis revenez ici pour choisir l'emplacement.
:::

Tout ce qui se trouve ici concerne le **panneau d'administration**. Pour le serveur — restreindre une lecture, ajouter une route, intégrer le driver dans votre propre processus, `rebase eject` — consultez [Rebase ne gère pas X](/docs/backend/extending), qui propose un tableau équivalent pour le backend.

## Tableau de décision

| Je souhaite… | Mécanisme | Portée | Référence |
|---|---|---|---|
| Remplacer la barre d'application | `components` (`Shell.AppBar`) | app | [Remplacements de composants](/docs/frontend/component-overrides) |
| Remplacer la page de connexion | `components` (`Auth.LoginView`) | app | [Remplacements de composants](/docs/frontend/component-overrides) |
| Remplacer la page d'accueil | `components` (`HomePage`) | app | [Remplacements de composants](/docs/frontend/component-overrides) |
| Modifier entièrement l'apparence du formulaire d'une collection | `formView` | collection | [ci-dessous](#formview) |
| Remplacer un composant au sein d'une seule collection | `admin.components` | collection | [Remplacements de composants](/docs/frontend/component-overrides) |
| Définir des remplacements de composants par défaut pour toutes les collections | `components` (noms ciblés par collection) | app | [Remplacements de composants](/docs/frontend/component-overrides) |
| Ajouter un bouton à la barre d'outils d'une collection | `Actions` de collection | collection | [Actions d'entité](/docs/frontend/entity-actions#collection-actions) |
| Injecter de l'UI dans un slot de la barre d'outils de collection | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Ajouter une colonne calculée à un tableau | `additionalFields` | collection | [Colonnes additionnelles](/docs/frontend/additional-columns) |
| Ajouter un widget de champ personnalisé pour un type de propriété | `propertyConfigs` | type de propriété | [Champs personnalisés](/docs/frontend/custom-fields) |
| Ajouter un onglet d'entité | `entityViews` | entité | [Vues d'entités](/docs/frontend/entity-views) |
| Rendre les lignes d'une collection d'une manière différente | `admin.customViews` | collection | [ci-dessous](#modes-de-vue-personnalisés-custom-view-modes) |
| Ajouter une action contextuelle/de ligne ou un bouton d'entité | `entityActions` | entité | [Actions d'entité](/docs/frontend/entity-actions) |
| Afficher une métrique sur la carte de page d'accueil d'une collection | slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Injecter de l'UI à un emplacement précis du cadre (chrome) | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuer plusieurs extensions sous la forme d'un ensemble installable | `plugins` | app | [Plugins](/docs/plugins) |
| Styliser l'élément que je viens de créer | `@rebasepro/ui` + tokens de thème | n'importe laquelle | [Styliser l'UI personnalisée](/docs/frontend/styling) |

:::tip[Quel que soit votre choix, construisez-le à partir du kit]
Chaque mécanisme ci-dessous vous fournit un composant React sans rien imposer quant à son contenu. Utilisez les composants `@rebasepro/ui` et les jetons de couleur du thème plutôt que du CSS écrit à la main — une vue personnalisée reste une vue d'administration, et une couleur codée en dur sera invisible dans l'un des deux thèmes. Consultez [Styliser l'UI personnalisée](/docs/frontend/styling).
:::

## Les mécanismes en détail

### Plugins

**Portée :** app.

Un plugin regroupe des collections injectées ou modifiées, des vues, des contributions de slots, des wrappers de champs, des providers, des hooks et des callbacks de cycle de vie en une seule unité installable. Les remplacements de composants, les vues d'entités, les actions d'entités et `propertyConfigs` ne sont pas des champs de plugin : ils se placent sur `<Rebase>` ou sur la collection.

→ [Référence des plugins](/docs/plugins)

### Slots

**Portée :** app (contribué par slot).

Les slots sont des points d'extension d'interface nommés, répartis dans tout le cadre (chrome) du CMS. Vous enregistrez un composant React ciblant le nom d'un slot, et il s'affiche à cet emplacement. Il existe 27 slots couvrant la page d'accueil, la navigation, les vues de collection, les formulaires, les lignes d'entités, les champs de formulaire et la barre d'application — et chacun d'entre eux est rendu.

→ [Référence des slots](/docs/frontend/slots)

### Remplacements de composants (Swizzling)

**Portée :** valeurs par défaut au niveau de l'application ou par collection.

Deux modes : **Eject** (remplacement complet) ou **Wrap** (enrichissement de l'original).

19 noms de composants surchargeables répartis en deux niveaux :

**Réservés à l'application (7) :**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Ciblés par collection (12) :**
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

**Ordre de priorité :** Les `components` définis au niveau de la collection s'appliquent par-dessus les valeurs par défaut de l'application pour le même nom de composant : un remplacement au niveau de la collection remplace les deux, et une surcharge avec `wrap: true` au niveau de la collection enveloppe celle du niveau applicatif. Les noms de composants réservés à l'application (`Shell.*`, `HomePage`, `Auth.*`) ne peuvent être surchargés qu'au niveau `<Rebase>`.

→ [Remplacements de composants](/docs/frontend/component-overrides)

### Vues d'entités (Entity Views)

**Portée :** entité (ajoute des onglets).

Vues personnalisées qui apparaissent sous forme d'onglets dans la page de détail de l'entité. Définies par collection, ou enregistrées une seule fois sur `<Rebase entityViews>` (ou `<RebaseCMS entityViews>`) et désignées par leur `key` dans le `admin.entityViews` d'une collection.

→ [Vues d'entités](/docs/frontend/entity-views)

### Actions d'entités (Entity Actions)

**Portée :** entité.

Boutons d'action personnalisés sur des entités individuelles (publier, archiver, cloner, etc.). Définis par collection, ou enregistrés une seule fois sur `<Rebase entityActions>` (ou `<RebaseCMS entityActions>`) et désignés par leur `key` dans le `admin.entityActions` d'une collection.

→ [Actions d'entité](/docs/frontend/entity-actions)

### `Actions` de collection

**Portée :** collection.

Composants React au niveau de la barre d'outils recevant `CollectionActionsProps` (entités sélectionnées, contrôleur de table, contexte de collection). Rendus dans la barre d'outils de la collection aux côtés des actions intégrées.

**Relation avec le slot `collection.actions` :** Les deux sont additifs — les composants `Actions` sont rendus en premier dans la barre d'outils, suivis des contributions du slot `collection.actions`. Ils ne se remplacent pas mutuellement.

→ [Actions d'entité — Actions de collection](/docs/frontend/entity-actions#collection-actions)

### Modes de vue personnalisés (Custom view modes)
**Portée :** collection (ajoute un mode de vue).

Une carte, un calendrier, une galerie, une chronologie — un autre rendu *des mêmes lignes*, proposé dans le sélecteur de vue de la collection aux côtés de Liste, Tableau, Cartes et Kanban.

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

Ou enregistrez le composant une seule fois et référencez-le par sa clé, ce qui permet également de le sélectionner depuis l'éditeur de collection :

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

`Builder` reçoit le `tableController` en temps réel, de sorte que la vue hérite des filtres de la collection, du champ de recherche, du tri, de la pagination, des vérifications de permissions et du panneau latéral de l'entité — c'est tout l'intérêt d'en déclarer un plutôt que de construire une `AppView` :

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

Les lignes proviennent du serveur, avec la structure retournée par `useRows` : les dates sous forme de chaînes ISO, une relation belongsTo sous la forme de sa colonne de clé étrangère, et une relation chargée par la vue imbriquée sous son nom. `highlightedIds` contient les identifiants des lignes affichées comme sélectionnées par la vue, et `selectionController` manipule également les identifiants et les lignes.

Le choix de la vue met à jour `?__view=`, persiste après un rechargement et est conservé par utilisateur. Le simple fait d'en déclarer une suffit à la proposer — `enabledViews` ne doit être configuré que lorsque vous souhaitez *retirer des vues intégrées*. Avec une seule entrée, le sélecteur est masqué.

**Il ne s'agit pas d'un moyen de construire une vue couvrant plusieurs collections.** Un mode de vue est un autre rendu de la requête d'une collection. Si votre composant ignore `tableController` et charge quatre tables de son côté, il devrait plutôt s'agir d'une [`AppView`](/docs/frontend#custom-views) — la barre d'outils située au-dessus, avec son champ de recherche et son compteur d'enregistrements, décrirait une requête qu'il n'affiche pas.

### `formView`
**Portée :** collection.

Remplace l'intégralité du formulaire d'entité par défaut par un composant personnalisé. Défini sur la déclaration d'une collection :

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // Enregistrer et Abandonner dans la barre (par défaut : true)
        }
    }
};

```

À utiliser lorsque vous avez besoin d'une disposition entièrement sur mesure pour l'expérience d'édition d'entité d'une collection. Pour des ajustements plus légers, privilégiez `admin.components` avec un remplacement de `Entity.Form`.

Le Builder est rendu à l'intérieur du formulaire de l'enregistrement et reçoit son `formContext` en direct : écrivez avec `formContext.setFieldValue`, et le bouton Enregistrer de la barre enregistre l'enregistrement. Lorsque l'enregistrement ne peut pas être modifié — en vue détaillée en lecture seule, ou pour un utilisateur sans permission de modification — `formContext.disabled` vaut `true` et les écritures lèvent une erreur. Définissez `includeActions: false` si votre Builder gère l'enregistrement de manière autonome via `formContext.submit()`.

### `additionalFields`

**Portée :** collection.

Colonnes calculées/virtuelles affichées dans la table de la collection. Elles ne correspondent pas à des propriétés stockées — elles sont calculées au moment du rendu.

→ [Colonnes additionnelles](/docs/frontend/additional-columns)

### `propertyConfigs`

**Portée :** type de propriété.

Widgets de champs personnalisés pour des types de propriétés spécifiques, fournissant des champs de formulaire et des composants de prévisualisation sur mesure.

→ [Champs personnalisés](/docs/frontend/custom-fields)

## Hors du panneau d'administration

Si ce que vous souhaitez modifier concerne le comportement du serveur plutôt que ce qu'affiche le panneau, vous n'êtes pas sur la bonne page. Le serveur dispose de sa propre hiérarchie :

| Je souhaite… | Échelon | Référence |
|---|---|---|
| Restreindre les lignes renvoyées par une lecture | Callback `beforeQuery` | [Étendre le serveur](/docs/backend/extending#2-collection-callbacks) |
| Masquer/expurger une valeur à la sortie | Callback `afterRead` | [Callbacks](/docs/collections/callbacks) |
| Ajouter mon propre endpoint | Fonction personnalisée | [Fonctions personnalisées](/docs/backend/custom-functions) |
| Permettre à la recherche de trouver des sous-chaînes *et* d'ignorer les accents | `search.mode: "hybrid"` | [Recherche](/docs/backend/search) |
| Avoir le contrôle total sur le processus serveur | Serveur personnalisé, puis `rebase eject` | [Étendre le serveur](/docs/backend/extending) |

→ [Rebase ne gère pas X](/docs/backend/extending)

## Résumé de la priorité

- **Le paramètre `admin.components` d'une collection prévaut sur les `components` globaux** au sein de cette collection. Un remplacement au niveau de la collection remplace les deux ; une surcharge de collection avec `wrap: true` enveloppe la surcharge globale lorsqu'elle existe (en 0.24, elle enveloppe le composant intégré et la surcharge globale est ignorée). Voir [Remplacements de composants](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Les `Actions` de collection et le slot `collection.actions` sont additifs** — les `Actions` sont rendues en premier, suivies des contributions des slots.
- **Les `entityActions` et `entityViews` au niveau applicatif constituent un registre, pas des valeurs par défaut :** une collection n'en affiche un que lorsque son propre `admin.entityActions` / `admin.entityViews` spécifie sa `key`.
- **Les plugins s'appliquent dans l'ordre du tableau `plugins`**, et non par `key`. Les contributions aux slots sont rendues selon leur `order` (les valeurs les plus basses en premier, 50 par défaut), et les égalités conservent cet ordre. Les wrappers de champs issus de plusieurs plugins se composent dans cet ordre, le premier plugin étant le plus imbriqué ; en 0.24, seul le dernier wrapper était rendu. Voir [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
