---
sourceHash: 26f6f53fc55b88dc
title: Étendre Rebase
sidebar_label: Étendre Rebase
description: Un guide de décision pour choisir le bon mécanisme d'extension — plugins, slots, surcharges de composants, vues d'entités, actions, et plus encore.
---

## Vue d'ensemble

Rebase propose une douzaine de mécanismes d'extension — plugins, slots, surcharges de composants, vues d'entités, actions, champs personnalisés, et bien plus. Chacun cible une portée différente (à l'échelle de l'application, par collection, par entité, par propriété) et une partie distincte de l'interface utilisateur.

Ce guide vous aide à choisir le bon mécanisme pour votre cas d'usage, puis renvoie vers la référence détaillée de chacun.

:::tip[Commencez par le modèle, pas par la liste]
Sous le capot, chaque mécanisme ci-dessous repose sur le même principe : un composant React placé à un endroit précis. [Personnaliser l'administration](/docs/frontend/customizing) explique ce modèle en une page — blocs de construction, hooks, emplacements — avec des recettes éprouvées pour un singleton de paramètres, des paramètres par utilisateur, une action groupée, une vue calendrier, un tableau de bord et un écran de connexion personnalisé. Lisez-le d'abord, puis revenez ici pour choisir l'emplacement.
:::

Tout ce qui est décrit ici concerne le **panneau d'administration**. Pour le serveur — restreindre une lecture, ajouter une route, intégrer le driver dans votre propre processus, `rebase eject` — consultez [Rebase ne fait pas X](/docs/backend/extending), qui propose le même type de tableau pour le backend.

## Tableau de décision

| Je souhaite… | Mécanisme | Portée | Référence |
|---|---|---|---|
| Remplacer la barre d'application | `components` (`Shell.AppBar`) | app | [Surcharges de composants](/docs/frontend/component-overrides) |
| Remplacer la page de connexion | `components` (`Auth.LoginView`) | app | [Surcharges de composants](/docs/frontend/component-overrides) |
| Remplacer la page d'accueil | `components` (`HomePage`) | app | [Surcharges de composants](/docs/frontend/component-overrides) |
| Modifier entièrement l'apparence du formulaire d'une table | `formView` dans `customizeTable` | table | [ci-dessous](#formview) |
| Remplacer un composant au sein de la collection d'une table | `components` dans `customizeTable` | table | [Surcharges de composants](/docs/frontend/component-overrides#collection-level-component-overrides) |
| Définir des surcharges de composants par défaut pour toutes les collections | `components` (noms de portée collection) | app | [Surcharges de composants](/docs/frontend/component-overrides) |
| Ajouter un bouton à la barre d'outils de collection | `Actions` dans `customizeTable` | table | [Actions d'entités](/docs/frontend/entity-actions#collection-actions) |
| Injecter de l'UI au niveau d'un slot de la barre d'outils de collection | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Ajouter une colonne calculée à une table | `additionalFields` dans `customizeTable` | table | [Colonnes additionnelles](/docs/frontend/additional-columns) |
| Remplacer le contrôle d'un champ | `Field` dans `customizeTable` | champ | [Champs personnalisés](/docs/frontend/custom-fields) |
| Enregistrer un type de champ réutilisable | `propertyConfigs` | app | [Champs personnalisés](/docs/frontend/custom-fields#a-reusable-field-type) |
| Ajouter un onglet d'entité | `entityViews` dans `customizeTable` | entité | [Vues d'entités](/docs/frontend/entity-views) |
| Afficher les lignes d'une table d'une manière différente | `customViews` dans `customizeTable` | table | [ci-dessous](#modes-de-vue-personnalisés-custom-view-modes) |
| Ajouter une action de ligne/contexte ou un bouton d'entité | `entityActions` dans `customizeTable` | entité | [Actions d'entités](/docs/frontend/entity-actions) |
| Afficher un indicateur sur la carte d'une collection de la page d'accueil | slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Injecter de l'UI à un emplacement spécifique du chrome | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuer plusieurs extensions sous la forme d'une unité installable | `plugins` | app | [Plugins](/docs/plugins) |
| Styliser l'élément que je viens de créer | `@rebasepro/ui` + jetons de thème | tous | [Styliser l'UI personnalisée](/docs/frontend/styling) |

:::tip[Quel que soit votre choix, construisez-le à partir du kit]
Chaque mécanisme ci-dessous vous fournit un composant React sans rien imposer quant à son contenu. Utilisez les composants `@rebasepro/ui` et les jetons de couleur du thème plutôt que du CSS écrit à la main — une vue personnalisée reste une vue d'administration, et une couleur codée en dur deviendra invisible dans l'un des deux thèmes. Consultez [Styliser l'UI personnalisée](/docs/frontend/styling).
:::

## Mécanismes en détail

### Plugins

**Portée :** application.

Un plugin regroupe des collections injectées ou modifiées, des vues, des contributions de slots, des wrappers de champs, des providers, des hooks et des callbacks de cycle de vie en une seule unité installable. Les surcharges de composants, les vues d'entités, les actions d'entités et `propertyConfigs` ne sont pas des champs de plugin : ils se placent sur `<Rebase>` ou dans le `customizeTable` d'une table.

→ [Référence des plugins](/docs/plugins)

### Slots

**Portée :** application (contribué par slot).

Les slots sont des points d'extension d'interface utilisateur nommés, répartis dans tout le chrome du CMS. Vous enregistrez un composant React ciblant un nom de slot, et il s'affiche à cet emplacement. Il existe 27 slots couvrant la page d'accueil, la navigation, les vues de collection, les formulaires, les lignes d'entités, les champs de formulaires et la barre d'application — et chacun d'entre eux est rendu.

→ [Référence des slots](/docs/frontend/slots)

### Surcharges de composants (Swizzling)

**Portée :** valeurs par défaut au niveau de l'application ou par collection.

Deux modes : **Eject** (remplacement total) ou **Wrap** (enrichissement de l'original).

19 noms de composants surchargeables répartis en deux niveaux :

**Spécifiques à l'application (7) :**
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

**Priorité :** Les `components` d'une table s'appliquent par-dessus les valeurs par défaut au niveau de l'application pour le même nom de composant : un remplacement au niveau de la collection remplace les deux, et une surcharge de collection avec `wrap: true` enveloppe celle du niveau de l'application. Les noms de composants spécifiques à l'application (`Shell.*`, `HomePage`, `Auth.*`) ne peuvent être surchargés qu'au niveau de `<Rebase>`.

→ [Surcharges de composants](/docs/frontend/component-overrides)

### Vues d'entités

**Portée :** entité (ajoute des onglets).

Des vues personnalisées qui apparaissent sous forme d'onglets sur la page de détail de l'entité. Définies par table dans `customizeTable`, ou enregistrées une seule fois sur `<Rebase entityViews>` (ou `<RebaseCMS entityViews>`) et référencées par leur `key` dans le `entityViews` d'une table.

→ [Vues d'entités](/docs/frontend/entity-views)

### Actions d'entités

**Portée :** entité.

Boutons d'action personnalisés sur des entités individuelles (publier, archiver, cloner, etc.). Définis par table dans `customizeTable`, ou enregistrés une seule fois sur `<Rebase entityActions>` (ou `<RebaseCMS entityActions>`) et référencés par leur `key` dans le `entityActions` d'une table.

→ [Actions d'entités](/docs/frontend/entity-actions)

### `Actions` de collection

**Portée :** collection.

Composants React au niveau de la barre d'outils qui reçoivent `CollectionActionsProps` (entités sélectionnées, contrôleur de table, contexte de collection). Rendus dans la barre d'outils de collection aux côtés des actions intégrées.

**Relation avec le slot `collection.actions` :** Les deux sont cumulatifs — les composants `Actions` sont rendus en premier dans la barre d'outils, suivis des contributions du slot `collection.actions`. Ils ne se remplacent pas mutuellement.

→ [Actions d'entités — Actions de collection](/docs/frontend/entity-actions#collection-actions)

### Modes de vue personnalisés {#custom-view-modes}

**Portée :** collection (ajoute un mode de vue).

Une carte, un calendrier, une galerie, une frise chronologique — un autre rendu *des mêmes lignes*, proposé dans le sélecteur de vue de la collection aux côtés de Liste, Table, Cartes et Tableau.

```tsx
// frontend/src/cms/tasks.tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";
import { MapView } from "../../../../../components/MapView";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    customViews: [
        { key: "map", name: "Map", icon: "Map", Builder: MapView },
    ],
    enabledViews: ["table", "map"],
    defaultViewMode: "map",
});
```

Ou enregistrez le composant une seule fois et référencez-le par sa clé :

```tsx
<RebaseCMS
    tableCustomizations={tableCustomizations}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    customViews: ["map"],
});
```

`Builder` reçoit l'instance en direct de `tableController`, de sorte que la vue hérite des filtres de la collection, de la zone de recherche, du tri, de la pagination, des vérifications de permissions et du panneau latéral d'entité — c'est précisément la raison d'en déclarer un plutôt que de construire une `AppView` :

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

Les lignes proviennent du serveur, selon la structure renvoyée par `useRows` : les dates sous forme de chaînes ISO, une relation belongsTo sous forme de colonne de clé étrangère, et une relation chargée par la vue imbriquée sous son nom. Une ligne ne possède une colonne `id` que si sa table en a une ; son identifiant est disponible à côté, `tableController.ids[i]` correspondant à `tableController.rows[i]`. `highlightedIds` contient les identifiants des lignes que la vue affiche comme sélectionnées, et `selectionController` manipule également les identifiants et les lignes :

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

Sélectionner la vue met à jour `?__view=`, persiste après un rechargement et est conservé par utilisateur. En déclarer une suffit pour la proposer — `enabledViews` n'a besoin d'être défini que si vous souhaitez *retirer les vues intégrées*. Avec une seule entrée, le sélecteur est masqué.

**Ce n'est pas un moyen de construire une vue couvrant plusieurs collections.** Un mode de vue est un autre rendu de la requête d'une seule collection. Si votre composant ignore `tableController` et charge quatre tables de son côté, il devrait plutôt être une [`AppView`](/docs/frontend#custom-views) — la barre d'outils située au-dessus, avec sa boîte de recherche et son compteur d'enregistrements, décrirait une requête qu'il ne restitue pas.

### `formView`

**Portée :** collection.

Remplace l'intégralité du formulaire d'entité par défaut par un composant personnalisé, configuré via `formView: { Builder, includeActions }` dans `customizeTable` ; voir [Remplacer le formulaire](/docs/frontend/form-layout/#replacing-the-form). `includeActions` (`true` par défaut) conserve Enregistrer et Abandonner dans la barre.

À utiliser lorsque vous avez besoin d'une disposition entièrement personnalisée pour l'édition des enregistrements d'une table. Pour des ajustements plus légers, préférez plutôt la surcharge de `Entity.Form` dans `components`.

Le Builder est rendu à l'intérieur du formulaire de l'enregistrement et reçoit son `formContext` en direct : écrivez avec `formContext.setFieldValue`, et le bouton Enregistrer de la barre sauvegarde l'enregistrement. Lorsque l'enregistrement ne peut pas être modifié — vue détaillée en lecture seule, ou utilisateur sans permission de modification — `formContext.disabled` vaut `true` et les écritures lèvent une exception. Définissez `includeActions: false` si votre Builder gère lui-même la sauvegarde via `formContext.submit()`.

### `additionalFields`

**Portée :** collection.

Colonnes calculées affichées dans la table de la collection. Elles ne correspondent pas à des colonnes stockées : elles sont calculées au moment du rendu.

→ [Colonnes additionnelles](/docs/frontend/additional-columns)

### `propertyConfigs`

**Portée :** type de propriété.

Types de champs réutilisables, enregistrés une seule fois sur `<Rebase propertyConfigs>` et référencés par le `propertyConfig` d'un champ.

→ [Champs personnalisés](/docs/frontend/custom-fields)

## Hors du panneau d'administration

Si ce que vous souhaitez modifier concerne le comportement du serveur plutôt que l'affichage du panneau, vous n'êtes pas sur la bonne page. Le serveur a sa propre échelle :

| Je souhaite… | Échelon | Référence |
|---|---|---|
| Restreindre les lignes renvoyées par une lecture | Hook `beforeQuery` | [Étendre le serveur](/docs/backend/extending#2-table-hooks) |
| Masquer une valeur lors de la sortie | Hook `afterRead` | [Hooks de table](/docs/collections/callbacks) |
| Ajouter un endpoint personnalisé | Fonction personnalisée | [Fonctions personnalisées](/docs/backend/custom-functions) |
| Permettre à la recherche de trouver des sous-chaînes *et* d'ignorer les accents | `search.mode: "hybrid"` | [Recherche](/docs/backend/search) |
| Prendre le contrôle du processus serveur | Serveur personnalisé, puis `rebase eject` | [Étendre le serveur](/docs/backend/extending) |

→ [Rebase ne fait pas X](/docs/backend/extending)

## Résumé des priorités

- **Les `components` d'une table prévalent sur les `components` globaux** au sein de sa collection. Un remplacement de collection remplace les deux ; une surcharge de collection avec `wrap: true` enveloppe la surcharge globale lorsqu'elle existe. Voir [Surcharges de composants](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Les `Actions` de collection et le slot `collection.actions` sont cumulatifs** — les `Actions` sont rendues en premier, suivies des contributions du slot.
- **Les `entityActions` et `entityViews` au niveau applicatif constituent un registre, pas des valeurs par défaut :** une table n'en affiche un que si son propre `entityActions` / `entityViews` dans `customizeTable` mentionne sa `key`.
- **Les plugins s'appliquent dans l'ordre du tableau `plugins`**, et non par `key`. Les contributions de slots s'affichent selon leur `order` (le plus bas en premier, 50 par défaut), et les ex æquo conservent cet ordre. Les wrappers de champs issus de plusieurs plugins se composent dans cet ordre, le premier plugin étant le plus interne. Voir [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
