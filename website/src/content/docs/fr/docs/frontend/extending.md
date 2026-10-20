---
sourceHash: a874bc209f13c746
title: Étendre Rebase
sidebar_label: Étendre Rebase
description: Un guide de décision pour choisir le bon mécanisme d'extension — plugins, slots, substitutions de composants, vues d'entités, actions, et plus encore.
---

## Vue d'ensemble

Rebase propose une douzaine de mécanismes d'extension — plugins, slots, substitutions de composants, vues d'entités, actions, champs personnalisés, et plus encore. Chacun cible une portée différente (à l'échelle de l'application, par collection, par entité, par propriété) et une partie différente de l'interface utilisateur.

Ce guide vous aide à choisir le bon mécanisme pour votre cas d'usage, puis renvoie à la documentation de référence détaillée pour chacun d'eux.

:::tip[Commencez par le modèle, pas par la liste]
Chaque mécanisme ci-dessous repose sur la même base : un composant React placé à un endroit spécifique. [Personnaliser l'administration](/docs/frontend/customizing) explique ce modèle en une seule page — blocs de construction, hooks, emplacements — avec des recettes testées pour un singleton de paramètres, des paramètres par utilisateur, une action groupée, une vue calendrier, un tableau de bord et un écran de connexion personnalisé. Lisez-le d'abord ; revenez ici pour choisir l'emplacement.
:::

Tout ce qui est abordé ici concerne le **panneau d'administration**. Pour le serveur — restreindre une lecture,
ajouter une route, intégrer le pilote dans votre propre processus, `rebase eject` — consultez
[Rebase ne fait pas X](/docs/backend/extending), qui présente le même type de tableau
pour le backend.

## Tableau de décision

| Je souhaite… | Mécanisme | Portée | Référence |
|---|---|---|---|
| Remplacer la barre d'application | `components` (`Shell.AppBar`) | app | [Substitutions de composants](/docs/frontend/component-overrides) |
| Remplacer la page de connexion | `components` (`Auth.LoginView`) | app | [Substitutions de composants](/docs/frontend/component-overrides) |
| Remplacer la page d'accueil | `components` (`HomePage`) | app | [Substitutions de composants](/docs/frontend/component-overrides) |
| Modifier entièrement l'apparence du formulaire d'une collection | `formView` | collection | [ci-dessous](#formview) |
| Échanger un composant au sein d'une collection | `collection.components` | collection | [Substitutions de composants](/docs/frontend/component-overrides) |
| Définir des substitutions de composants par défaut pour toutes les collections | `components` (noms à portée de collection) | app | [Substitutions de composants](/docs/frontend/component-overrides) |
| Ajouter un bouton à la barre d'outils d'une collection | `Actions` de collection | collection | [Actions d'entités](/docs/frontend/entity-actions#collection-actions) |
| Injecter de l'interface utilisateur dans un slot de barre d'outils de collection | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Ajouter une colonne calculée à un tableau | `additionalFields` | collection | [Colonnes additionnelles](/docs/frontend/additional-columns) |
| Ajouter un widget de champ personnalisé pour un type de propriété | `propertyConfigs` | type de propriété | [Champs personnalisés](/docs/frontend/custom-fields) |
| Ajouter un onglet d'entité | `entityViews` | entité | [Vues d'entités](/docs/frontend/entity-views) |
| Afficher les lignes d'une collection d'une manière différente | `admin.customViews` | collection | [ci-dessous](#modes-de-vue-personnalisés) |
| Ajouter une action de ligne/contexte ou un bouton d'entité | `entityActions` | entité | [Actions d'entités](/docs/frontend/entity-actions) |
| Afficher une métrique sur la carte de page d'accueil d'une collection | slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Injecter de l'interface utilisateur à un endroit spécifique du chrome | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuer plusieurs extensions sous forme d'une unité installable unique | `plugins` | app | [Plugins](/docs/plugins) |
| Styliser l'élément que je viens de créer | `@rebasepro/ui` + tokens de thème | tout | [Styliser l'UI personnalisée](/docs/frontend/styling) |

:::tip[Quel que soit votre choix, construisez-le à partir du kit]
Chaque mécanisme ci-dessous vous fournit un composant React et ne présume rien de
ce que vous devez y mettre. Utilisez les composants `@rebasepro/ui` et les tokens de couleur du thème plutôt
que du CSS écrit à la main — une vue personnalisée reste une vue d'administration, et une couleur
codée en dur sera invisible dans l'un des deux thèmes. Consultez
[Styliser l'UI personnalisée](/docs/frontend/styling).
:::

## Les mécanismes en détail

### Plugins

**Portée :** app.

Un plugin regroupe des collections, des vues, des substitutions de composants, des contributions aux slots, l'authentification, des sources de données, des providers, des hooks et des rappels de cycle de vie au sein d'une seule unité installable. Tous les autres mécanismes répertoriés ici peuvent être injectés via l'interface d'un plugin.

→ [Référence des plugins](/docs/plugins)

### Slots

**Portée :** app (contribué par slot).

Les slots sont des points d'extension d'interface utilisateur nommés, répartis dans tout le chrome du CMS. Vous enregistrez un composant React ciblant le nom d'un slot, et il s'affiche à cet emplacement. Il existe 27 slots couvrant la page d'accueil, la navigation, les vues de collection, les formulaires, les lignes d'entités, les champs de formulaire et la barre d'application — et chacun d'eux est rendu.

→ [Référence des slots](/docs/frontend/slots)

### Substitutions de composants (Swizzling)

**Portée :** valeurs par défaut au niveau de l'application ou par collection.

Deux modes : **Eject** (remplacement complet) ou **Wrap** (enrichissement de l'original).

19 noms de composants substituables répartis en deux niveaux :

**Réservés à l'application (7) :**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**À portée de collection (12) :**
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

**Ordre de priorité :** Les `components` au niveau de la collection prévalent sur les valeurs par défaut au niveau de l'application pour le même nom de composant (décomposition d'objet simple — les valeurs de la collection écrasent les valeurs globales). Les noms de composants réservés à l'application (`Shell.*`, `HomePage`, `Auth.*`) ne peuvent être substitués qu'au niveau `<Rebase>`.

→ [Substitutions de composants](/docs/frontend/component-overrides)

### Vues d'entités

**Portée :** entité (ajoute des onglets).

Vues personnalisées qui apparaissent sous forme d'onglets sur la page de détail de l'entité. Peuvent être définies globalement sur `<Rebase>` ou par collection.

→ [Vues d'entités](/docs/frontend/entity-views)

### Actions d'entités

**Portée :** entité.

Boutons d'action personnalisés sur des entités individuelles (publier, archiver, cloner, etc.). Peuvent être définis globalement ou par collection.

→ [Actions d'entités](/docs/frontend/entity-actions)

### `Actions` de collection

**Portée :** collection.

Composants React au niveau de la barre d'outils qui reçoivent `CollectionActionsProps` (entités sélectionnées, contrôleur de table, contexte de collection). Rendus dans la barre d'outils de la collection aux côtés des actions intégrées.

**Relation avec le slot `collection.actions` :** Les deux sont cumulatifs — les composants `Actions` sont rendus en premier dans la barre d'outils, suivis des contributions du slot `collection.actions`. Ils ne se remplacent pas mutuellement.

→ [Actions d'entités — Actions de collection](/docs/frontend/entity-actions#collection-actions)

### Modes de vue personnalisés
**Portée :** collection (ajoute un mode de vue).

Une carte, un calendrier, une galerie, une chronologie — un autre rendu *des mêmes lignes*,
proposé dans le sélecteur de vue de la collection aux côtés de Liste, Tableau, Cartes et Tableau Kanban.

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

Ou enregistrez le composant une seule fois et nommez-le par sa clé, ce qui permet également
de le sélectionner depuis l'éditeur de collection :

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

`Builder` reçoit le `tableController` dynamique, de sorte que la vue hérite des filtres
de la collection, du champ de recherche, du tri, de la pagination, des vérifications de permissions
et du panneau latéral de l'entité — c'est tout l'intérêt d'en déclarer une au lieu
de construire une `AppView` :

```tsx
function MapView({ tableController, onEntityClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.data.map(e => e.values.location)}
        onMarkerClick={i => onEntityClick?.(tableController.data[i])}
    />;
}
```

Le choix de la vue met à jour `?__view=`, survit à un rechargement de page et persiste par utilisateur.
En déclarer une suffit pour la proposer — `enabledViews` n'a besoin d'être défini que si vous
souhaitez *retirer des vues intégrées*. Avec une seule entrée, le sélecteur est masqué.

**Il ne s'agit pas d'un moyen de créer une vue s'étendant sur plusieurs collections.** Un mode de vue
est un autre rendu de la requête d'une collection. Si votre composant ignore
`tableController` et récupère quatre tables par lui-même, il devrait être une
[`AppView`](/docs/frontend#custom-views) — la barre d'outils située au-dessus, avec son champ de recherche
et son nombre d'enregistrements, décrirait une requête qu'il n'affiche pas.

### `formView`
**Portée :** collection.

Remplace l'intégralité du formulaire d'entité par défaut par un composant personnalisé. Se configure sur la définition d'une collection :

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // Enregistrer et Ignorer dans la barre (par défaut : true)
        }
    }
};

```

À utiliser lorsque vous avez besoin d'une disposition entièrement personnalisée pour l'expérience d'édition d'entités d'une collection. Pour des ajustements plus modestes, préférez `collection.components` avec une substitution de `Entity.Form`.

Le Builder est rendu à l'intérieur du formulaire de l'enregistrement et reçoit son `formContext` dynamique : écrivez avec `formContext.setFieldValue`, et le bouton Enregistrer de la barre stocke l'enregistrement. Lorsque l'enregistrement ne peut pas être modifié — la vue détaillée en lecture seule, ou un utilisateur sans permission de modification — `formContext.disabled` vaut `true` et les écritures lèvent une erreur. Définissez `includeActions: false` si votre Builder enregistre lui-même via `formContext.submit()`.

### `additionalFields`

**Portée :** collection.

Colonnes calculées/virtuelles affichées dans le tableau de la collection. Elles ne correspondent pas à des propriétés stockées — elles sont calculées au moment du rendu.

→ [Colonnes additionnelles](/docs/frontend/additional-columns)

### `propertyConfigs`

**Portée :** type de propriété.

Widgets de champs personnalisés pour des types de propriétés spécifiques, fournissant des champs de formulaire et des composants d'aperçu personnalisés.

→ [Champs personnalisés](/docs/frontend/custom-fields)

## Ce qui ne concerne pas le panneau d'administration

Si ce que vous souhaitez modifier concerne le comportement du serveur plutôt que ce que le
panneau affiche, vous n'êtes pas sur la bonne page. Le serveur possède sa propre échelle :

| Je souhaite… | Échelon | Référence |
|---|---|---|
| Restreindre les lignes renvoyées par une lecture | callback `beforeQuery` | [Étendre le serveur](/docs/backend/extending#2-collection-callbacks) |
| Masquer/Caviarder une valeur à la sortie | callback `afterRead` | [Callbacks](/docs/collections/callbacks) |
| Ajouter un endpoint personnalisé | fonction personnalisée | [Fonctions personnalisées](/docs/backend/custom-functions) |
| Permettre à la recherche de trouver des sous-chaînes *et* d'ignorer les accents | `search.mode: "hybrid"` | [Recherche](/docs/backend/search) |
| Prendre le contrôle du processus serveur | serveur personnalisé, puis `rebase eject` | [Étendre le serveur](/docs/backend/extending) |

→ [Rebase ne fait pas X](/docs/backend/extending)

## Résumé de la précédence

- **`collection.components` prévaut sur les `components` globaux** au sein de cette collection. Un remplacement au niveau collection remplace les deux ; une substitution avec `wrap: true` au niveau collection enveloppe la substitution globale lorsqu'elle existe (en 0.24, elle enveloppe le composant intégré et la substitution globale est ignorée). Consultez [Substitutions de composants](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Les `Actions` de collection et le slot `collection.actions` sont cumulatifs** — les `Actions` sont rendues en premier, puis les contributions du slot.
- **Les `entityActions` et `entityViews` au niveau de la collection étendent (ne remplacent pas) les éléments globaux.**
- **Les plugins s'appliquent dans l'ordre du tableau `plugins`**, et non par `key`. Les contributions aux slots sont rendues selon leur propriété `order` (les valeurs les plus basses en premier, 50 par défaut), et les égalités conservent cet ordre. Les wrappers de champs provenant de plusieurs plugins se composent dans cet ordre, celui du premier plugin étant le plus interne ; en 0.24, seul le dernier wrapper était rendu. Consultez [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
