---
sourceHash: 6517ed25b1776f7e
title: Étendre Rebase
sidebar_label: Étendre Rebase
description: Un guide décisionnel pour choisir le bon mécanisme d'extension — plugins, slots, substitutions de composants, vues d'entités, actions, et plus encore.
---

## Vue d'ensemble

Rebase propose une douzaine de mécanismes d'extension — plugins, slots, substitutions de composants, vues d'entités, actions, champs personnalisés, et plus encore. Chacun cible une portée différente (au niveau de l'application, par collection, par entité, par propriété) et une partie distincte de l'interface utilisateur.

Ce guide vous aide à choisir le bon mécanisme pour votre cas d'usage, puis renvoie à la documentation détaillée de chacun d'eux.

:::tip[Commencez par le modèle, pas par la liste]
Chaque mécanisme ci-dessous repose sur la même base : un composant React placé à un endroit spécifique. [Personnaliser l'administration](/docs/frontend/customizing) explique ce modèle sur une seule page — blocs de construction, hooks, emplacements — avec des recettes éprouvées pour un singleton de paramètres, des paramètres par utilisateur, une action groupée, une vue calendrier, un tableau de bord et un écran de connexion personnalisé. Lisez-le d'abord ; revenez ici pour choisir l'emplacement.
:::

Tout ce qui est décrit ici concerne le **panneau d'administration**. Pour le serveur — restreindre une lecture, ajouter une route, intégrer le pilote dans votre propre processus, `rebase eject` — consultez [Rebase ne fait pas X](/docs/backend/extending), qui propose un tableau équivalent pour le backend.

## Tableau de décision

| Je souhaite… | Mécanisme | Portée | Référence |
|---|---|---|---|
| Remplacer la barre d'application | `components` (`Shell.AppBar`) | application | [Substitutions de composants](/docs/frontend/component-overrides) |
| Remplacer la page de connexion | `components` (`Auth.LoginView`) | application | [Substitutions de composants](/docs/frontend/component-overrides) |
| Remplacer la page d'accueil | `components` (`HomePage`) | application | [Substitutions de composants](/docs/frontend/component-overrides) |
| Modifier entièrement l'apparence du formulaire d'une collection | `formView` | collection | [ci-dessous](#formview) |
| Remplacer un seul composant au sein d'une collection | `admin.components` | collection | [Substitutions de composants](/docs/frontend/component-overrides) |
| Définir des substitutions de composants par défaut pour toutes les collections | `components` (noms à portée de collection) | application | [Substitutions de composants](/docs/frontend/component-overrides) |
| Ajouter un bouton à la barre d'outils d'une collection | collection `Actions` | collection | [Actions d'entités](/docs/frontend/entity-actions#collection-actions) |
| Injecter de l'interface utilisateur dans un slot de barre d'outils de collection | slot `collection.actions` | application/plugin | [Slots](/docs/frontend/slots) |
| Ajouter une colonne calculée à un tableau | `additionalFields` | collection | [Colonnes additionnelles](/docs/frontend/additional-columns) |
| Ajouter un widget de champ personnalisé pour un type de propriété | `propertyConfigs` | type de propriété | [Champs personnalisés](/docs/frontend/custom-fields) |
| Ajouter un onglet d'entité | `entityViews` | entité | [Vues d'entités](/docs/frontend/entity-views) |
| Afficher les lignes d'une collection différemment | `admin.customViews` | collection | [ci-dessous](#modes-de-vue-personnalisés) |
| Ajouter une action contextuelle/de ligne ou un bouton d'entité | `entityActions` | entité | [Actions d'entités](/docs/frontend/entity-actions) |
| Afficher une métrique sur la carte de la page d'accueil d'une collection | slot `home.card.widget` | application/plugin | [Slots](/docs/frontend/slots) |
| Injecter de l'interface utilisateur à un emplacement spécifique de l'habillage | `slots` | application/plugin | [Slots](/docs/frontend/slots) |
| Livrer plusieurs extensions sous forme d'une seule unité installable | `plugins` | application | [Plugins](/docs/plugins) |
| Styliser l'élément que je viens de créer | `@rebasepro/ui` + jetons de thème | tous | [Styliser l'UI personnalisée](/docs/frontend/styling) |

:::tip[Quel que soit votre choix, utilisez les composants du kit]
Chaque mécanisme ci-dessous vous fournit un composant React sans contrainte sur la façon de le remplir. Utilisez les composants `@rebasepro/ui` et les jetons de couleur du thème plutôt que du CSS écrit à la main — une vue personnalisée reste une vue d'administration, et une couleur codée en dur risque d'être invisible dans l'un des deux thèmes. Voir [Styliser l'UI personnalisée](/docs/frontend/styling).
:::

## Détail des mécanismes

### Plugins

**Portée :** application.

Un plugin regroupe des collections injectées ou modifiées, des vues, des contributions à des slots, des wrappers de champs, des providers, des hooks et des callbacks de cycle de vie en une seule unité installable. Les substitutions de composants, les vues d'entités, les actions d'entités et `propertyConfigs` ne sont pas des champs de plugin : ils se placent sur `<Rebase>` ou sur la collection.

→ [Référence des plugins](/docs/plugins)

### Slots

**Portée :** application (contribué par slot).

Les slots sont des points d'extension d'interface utilisateur nommés, répartis à travers l'habillage du CMS. Vous enregistrez un composant React ciblant le nom d'un slot, et il est rendu à cet emplacement. Il existe 27 slots couvrant la page d'accueil, la navigation, les vues de collection, les formulaires, les lignes d'entités, les champs de formulaire et la barre d'application — et chacun d'eux est pris en charge lors du rendu.

→ [Référence des slots](/docs/frontend/slots)

### Substitutions de composants (Swizzling)

**Portée :** valeurs par défaut au niveau de l'application ou par collection.

Deux modes : **Eject** (remplacement total) ou **Wrap** (augmentation de l'original).

19 noms de composants substituables répartis en deux niveaux :

**Au niveau de l'application uniquement (7) :**
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

**Ordre de priorité :** Les `components` définis au niveau d'une collection s'appliquent par-dessus les valeurs par défaut au niveau de l'application pour le même nom de composant : un remplacement de collection remplace les deux, et une substitution de collection avec `wrap: true` enveloppe celle définie au niveau de l'application. Les noms de composants réservés à l'application (`Shell.*`, `HomePage`, `Auth.*`) ne peuvent être substitués qu'au niveau `<Rebase>`.

→ [Substitutions de composants](/docs/frontend/component-overrides)

### Vues d'entités

**Portée :** entité (ajoute des onglets).

Vues personnalisées apparaissant sous forme d'onglets sur la page de détail d'une entité. Définies par collection, ou enregistrées une seule fois sur `<Rebase entityViews>` (ou `<RebaseCMS entityViews>`) et référencées par leur `key` dans le tableau `admin.entityViews` d'une collection.

→ [Vues d'entités](/docs/frontend/entity-views)

### Actions d'entités

**Portée :** entité.

Boutons d'action personnalisés sur des entités individuelles (publier, archiver, cloner, etc.). Définis par collection, ou enregistrés une seule fois sur `<Rebase entityActions>` (ou `<RebaseCMS entityActions>`) et référencés par leur `key` dans le tableau `admin.entityActions` d'une collection.

→ [Actions d'entités](/docs/frontend/entity-actions)

### Collection `Actions`

**Portée :** collection.

Composants React au niveau de la barre d'outils recevant les `CollectionActionsProps` (entités sélectionnées, contrôleur de tableau, contexte de la collection). Rendus dans la barre d'outils de la collection aux côtés des actions intégrées.

**Relation avec le slot `collection.actions` :** Les deux sont additifs — les composants `Actions` sont rendus en premier dans la barre d'outils, suivis des contributions du slot `collection.actions`. Ils ne se remplacent pas l'un l'autre.

→ [Actions d'entités — Actions de collection](/docs/frontend/entity-actions#collection-actions)

### Modes de vue personnalisés
**Portée :** collection (ajoute un mode de vue).

Une carte, un calendrier, une galerie, une chronologie — un autre rendu *des mêmes lignes*, proposé dans le sélecteur de vue de la collection aux côtés de Liste, Tableau, Cartes et Tableau Kanban (Board).

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

Vous pouvez également enregistrer le composant une seule fois et le désigner par sa clé, ce qui permet aussi de le sélectionner depuis l'éditeur de collection :

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

`Builder` reçoit l'instance en direct de `tableController`, ainsi la vue hérite des filtres de la collection, du champ de recherche, du tri, de la pagination, des vérifications de permissions et du panneau latéral de l'entité — c'est tout l'intérêt d'en déclarer une au lieu de concevoir une `AppView` :

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

Les lignes proviennent du serveur, avec la structure retournée par `useRows` : les dates sous forme de chaînes ISO, une relation belongsTo sous forme de colonne de clé étrangère, et une relation chargée par la vue imbriquée sous son nom. Une ligne n'a une colonne `id` que si sa table en possède une ; son identifiant se trouve à côté, `tableController.ids[i]` pour `tableController.rows[i]`. `highlightedIds` contient les identifiants des lignes que la vue affiche comme sélectionnées, et `selectionController` gère également les identifiants et les lignes :

```tsx
import type { CollectionCustomViewParams } from "@rebasepro/cms-types";
import { Card, Typography } from "@rebasepro/ui";

function CardsView({ tableController, highlightedIds, onRowClick }: CollectionCustomViewParams) {
    return <div className="grid grid-cols-3 gap-4 p-4">
        {tableController.rows.map((row, i) => {
            const id = tableController.ids[i];
            return <Card key={id}
                className={highlightedIds?.includes(id) ? "p-4 ring-2 ring-primary" : "p-4"}
                onClick={() => onRowClick?.(row)}>
                <Typography variant="subtitle2">{String(row.title ?? id)}</Typography>
            </Card>;
        })}
    </div>;
}
```

Le choix de la vue met à jour `?__view=`, persiste après un rafraîchissement et reste mémorisé par utilisateur. Le simple fait d'en déclarer une suffit à la proposer — `enabledViews` ne doit être configuré que lorsque vous souhaitez *retirer des vues intégrées*. Avec une seule entrée, le sélecteur est masqué.

**Ce n'est pas une méthode adaptée pour concevoir une vue englobant plusieurs collections.** Un mode de vue est un autre rendu de la requête d'une seule collection. Si votre composant ignore `tableController` et charge lui-même quatre tables, il devrait plutôt être une [`AppView`](/docs/frontend#custom-views) — la barre d'outils située au-dessus, avec son champ de recherche et son compteur d'enregistrements, décrirait alors une requête qu'il n'affiche pas.

### `formView`
**Portée :** collection.

Remplace l'ensemble du formulaire d'entité par défaut par un composant personnalisé. Se définit dans la configuration d'une collection :

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

À utiliser lorsque vous avez besoin d'une disposition entièrement personnalisée pour l'expérience d'édition d'entités d'une collection. Pour des ajustements plus légers, privilégiez `admin.components` avec une substitution de `Entity.Form`.

Le Builder est rendu à l'intérieur du formulaire de l'enregistrement et reçoit son `formContext` actif : écrivez avec `formContext.setFieldValue`, et le bouton Enregistrer de la barre sauvegardera l'enregistrement. Lorsque l'enregistrement ne peut pas être modifié — en vue détaillée en lecture seule, ou pour un utilisateur sans permission de modification — `formContext.disabled` est à `true` et les écritures lèvent une erreur. Définissez `includeActions: false` si votre Builder gère la sauvegarde de manière autonome via `formContext.submit()`.

### `additionalFields`

**Portée :** collection.

Colonnes calculées/virtuelles affichées dans le tableau de la collection. Elles ne correspondent pas à des propriétés stockées — elles sont calculées au moment du rendu.

→ [Colonnes additionnelles](/docs/frontend/additional-columns)

### `propertyConfigs`

**Portée :** type de propriété.

Widgets de champs personnalisés pour des types de propriétés spécifiques, fournissant des champs de formulaire et des composants d'aperçu personnalisés.

→ [Champs personnalisés](/docs/frontend/custom-fields)

## En dehors du panneau d'administration

Si vous souhaitez modifier le comportement du serveur plutôt que l'affichage du panneau, cette page ne s'applique pas. Le serveur possède sa propre hiérarchie :

| Je souhaite… | Niveau | Référence |
|---|---|---|
| Restreindre les lignes renvoyées par une lecture | callback `beforeQuery` | [Étendre le serveur](/docs/backend/extending#2-collection-callbacks) |
| Caviarder une valeur lors de sa sortie | callback `afterRead` | [Callbacks](/docs/collections/callbacks) |
| Ajouter un endpoint personnalisé | fonction personnalisée | [Fonctions personnalisées](/docs/backend/custom-functions) |
| Permettre à la recherche de trouver des sous-chaînes *et* d'ignorer les accents | `search.mode: "hybrid"` | [Recherche](/docs/backend/search) |
| Contrôler l'intégralité du processus serveur | serveur personnalisé, puis `rebase eject` | [Étendre le serveur](/docs/backend/extending) |

→ [Rebase ne fait pas X](/docs/backend/extending)

## Résumé de l'ordre de priorité

- **Les `admin.components` d'une collection prévalent sur les `components` globaux** au sein de cette collection. Un remplacement au niveau de la collection remplace les deux ; une substitution avec `wrap: true` au niveau de la collection enveloppe la substitution globale s'il en existe une. Voir [Substitutions de composants](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Les `Actions` de collection et le slot `collection.actions` s'additionnent** — les `Actions` sont rendues en premier, suivies des contributions au slot.
- **Les `entityActions` et `entityViews` au niveau de l'application constituent un registre, pas des valeurs par défaut :** une collection n'en affiche un que si sa propre configuration `admin.entityActions` / `admin.entityViews` spécifie sa `key`.
- **Les plugins s'appliquent selon l'ordre du tableau `plugins`**, et non par `key`. Les contributions aux slots sont ordonnées selon leur valeur `order` (les valeurs les plus basses en premier, 50 par défaut), et les égalités conservent cet ordre d'origine. Les wrappers de champs issus de plusieurs plugins se composent dans cet ordre, le premier plugin étant le plus interne . Voir [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
