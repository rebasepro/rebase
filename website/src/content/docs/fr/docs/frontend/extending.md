---
sourceHash: 3317ba94279d0cb8
title: Étendre Rebase
sidebar_label: Étendre Rebase
description: Un guide de décision pour choisir le bon mécanisme d'extension — plugins, slots, surcharges de composants, vues d'entités, actions, et plus encore.
---

## Vue d'ensemble

Rebase propose une douzaine de mécanismes d'extension — plugins, slots, surcharges de composants, vues d'entités, actions, champs personnalisés, et bien plus encore. Chacun cible une portée différente (à l'échelle de l'application, par collection, par entité, par propriété) et une partie différente de l'interface utilisateur.

Ce guide vous aide à choisir le bon mécanisme pour votre cas d'usage, puis renvoie à la documentation de référence détaillée pour chacun d'entre eux.

:::tip[Commencez par le modèle, pas par la liste]
Chaque mécanisme ci-dessous repose sur le même principe fondamental : un composant React placé à un endroit donné. [Personnaliser l'administration](/docs/frontend/customizing) explique ce modèle en une page — blocs de construction, hooks, emplacements — avec des recettes testées pour un singleton de paramètres, des paramètres par utilisateur, une action groupée, une vue calendrier, un tableau de bord et un écran de connexion personnalisé. Lisez-le d'abord ; revenez ici pour choisir l'emplacement.
:::

Tout ce qui est décrit ici concerne le **panneau d'administration**. Pour le serveur — restreindre une lecture, ajouter une route, intégrer le pilote dans votre propre processus, `rebase eject` — consultez [Rebase ne gère pas X](/docs/backend/extending), qui présente un tableau similaire pour le backend.

## Tableau de décision

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| Je souhaite… | Mécanisme | Portée | Référence |
|---|---|---|---|
| Remplacer la barre d'application | `components` (`Shell.AppBar`) | app | [Surcharges de composants](/docs/frontend/component-overrides) |
| Remplacer la page de connexion | `components` (`Auth.LoginView`) | app | [Surcharges de composants](/docs/frontend/component-overrides) |
| Remplacer la page d'accueil | `components` (`HomePage`) | app | [Surcharges de composants](/docs/frontend/component-overrides) |
| Modifier entièrement l'apparence du formulaire d'une table | `formView` dans `customizeTable` | table | [ci-dessous](#formview) |
| Remplacer un composant au sein de la collection d'une table | `components` dans `customizeTable` | table | [Surcharges de composants](/docs/frontend/component-overrides#collection-level-component-overrides) |
| Définir des surcharges de composants par défaut pour toutes les collections | `components` (noms avec portée de collection) | app | [Surcharges de composants](/docs/frontend/component-overrides) |
| Ajouter un bouton à la barre d'outils d'une collection | `Actions` dans `customizeTable` | table | [Actions d'entité](/docs/frontend/entity-actions#collection-actions) |
| Injecter de l'interface utilisateur dans un slot de barre d'outils de collection | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Ajouter une colonne calculée à une table | `additionalFields` dans `customizeTable` | table | [Colonnes additionnelles](/docs/frontend/additional-columns) |
| Remplacer le contrôle d'un champ | `Field` dans `customizeTable` | field | [Champs personnalisés](/docs/frontend/custom-fields) |
| Enregistrer un type de champ réutilisable | `propertyConfigs` | app | [Champs personnalisés](/docs/frontend/custom-fields#a-reusable-field-type) |
| Ajouter un onglet d'entité | `entityViews` dans `customizeTable` | entity | [Vues d'entités](/docs/frontend/entity-views) |
| Rendre les lignes d'une table d'une manière différente | `customViews` dans `customizeTable` | table | [ci-dessous](#modes-de-vue-personnalisés) |
| Ajouter une action de ligne/contexte ou un bouton d'entité | `entityActions` dans `customizeTable` | entity | [Actions d'entité](/docs/frontend/entity-actions) |
| Placer un indicateur chiffré sur la carte d'une collection de la page d'accueil | slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Injecter de l'interface utilisateur à un emplacement spécifique du chrome | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuer plusieurs extensions sous forme d'une unité installable unique | `plugins` | app | [Plugins](/docs/plugins) |
| Styliser l'élément que je viens de créer | `@rebasepro/ui` + jetons de thème | any | [Styliser l'interface personnalisée](/docs/frontend/styling) |

:::tip[Quel que soit votre choix, construisez-le à partir du kit]
Chaque mécanisme ci-dessous vous fournit un composant React sans imposer son contenu. Utilisez les composants `@rebasepro/ui` et les jetons de couleur du thème plutôt que du CSS écrit à la main — une vue personnalisée reste une vue d'administration, et une couleur codée en dur devient invisible dans l'un des deux thèmes. Consultez [Styliser l'interface personnalisée](/docs/frontend/styling).
:::

## Les mécanismes en détail

### Plugins

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

**Portée :** app.

Un plugin regroupe des collections injectées ou modifiées, des vues, des contributions aux slots, des wrappers de champs, des providers, des hooks et des callbacks de cycle de vie en une seule unité installable. Les surcharges de composants, les vues d'entités, les actions d'entité et `propertyConfigs` ne sont pas des champs de plugin : ils se placent sur `<Rebase>` ou dans le `customizeTable` d'une table.

→ [Référence des plugins](/docs/plugins)

### Slots

**Portée :** app (contribué par slot).

Les slots sont des points d'extension d'interface utilisateur nommés, répartis dans tout le chrome du CMS. Vous enregistrez un composant React ciblant un nom de slot, et il s'affiche à cet emplacement. Il existe 27 slots couvrant la page d'accueil, la navigation, les vues de collection, les formulaires, les lignes d'entités, les champs de formulaire et la barre d'application — et chacun d'entre eux est rendu.

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

**Ordre de priorité :** Les `components` d'une table s'appliquent par-dessus les valeurs par défaut au niveau de l'application pour le même nom de composant : un remplacement de collection remplace les deux, et une surcharge de collection avec `wrap: true` enveloppe celle au niveau de l'application. Les noms de composants réservés à l'application (`Shell.*`, `HomePage`, `Auth.*`) ne peuvent être surchargés qu'au niveau `<Rebase>`.

→ [Surcharges de composants](/docs/frontend/component-overrides)

### Vues d'entités

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

**Portée :** entity (ajoute des onglets).

Vues personnalisées qui apparaissent sous forme d'onglets dans la page de détail d'une entité. Définies par table dans `customizeTable`, ou enregistrées une seule fois sur `<Rebase entityViews>` (ou `<RebaseCMS entityViews>`) et référencées par leur `key` dans le `entityViews` d'une table.

→ [Vues d'entités](/docs/frontend/entity-views)

### Actions d'entité

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

**Portée :** entity.

Boutons d'action personnalisés sur des entités individuelles (publier, archiver, dupliquer, etc.). Définis par table dans `customizeTable`, ou enregistrés une seule fois sur `<Rebase entityActions>` (ou `<RebaseCMS entityActions>`) et référencés par leur `key` dans le `entityActions` d'une table.

→ [Actions d'entité](/docs/frontend/entity-actions)

### `Actions` de collection

**Portée :** collection.

Composants React au niveau de la barre d'outils recevant les `CollectionActionsProps` (entités sélectionnées, contrôleur de table, contexte de collection). Rendus dans la barre d'outils de la collection aux côtés des actions intégrées.

**Relation avec le slot `collection.actions` :** Les deux sont cumulatifs — les composants `Actions` sont rendus en premier dans la barre d'outils, puis viennent les contributions du slot `collection.actions`. Ils ne se remplacent pas mutuellement.

→ [Actions d'entité — Actions de collection](/docs/frontend/entity-actions#collection-actions)

### Modes de vue personnalisés

<span class="since-badge" data-since="0.31">Depuis 0.31</span>
**Portée :** collection (ajoute un mode de vue).

Une carte, un calendrier, une galerie, une chronologie — un autre rendu *des mêmes lignes*, proposé dans le sélecteur de vue de la collection aux côtés de Liste, Table, Cartes et Kanban.

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

Vous pouvez également enregistrer le composant une seule fois et le référencer par sa clé, ce qui le rend également sélectionnable depuis l'éditeur de collection :

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

`Builder` reçoit le `tableController` actif, ainsi la vue hérite des filtres de la collection, du champ de recherche, du tri, de la pagination, des vérifications de permissions et du panneau latéral de l'entité — c'est tout l'intérêt d'en déclarer une au lieu de créer une `AppView` :

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

Les lignes sont celles renvoyées par le serveur, selon la structure retournée par `useRows` : les dates sous forme de chaînes ISO, un belongsTo sous forme de colonne de clé étrangère, et une relation chargée par la vue imbriquée sous son nom. Une ligne ne possède une colonne `id` que si sa table en possède une ; son identifiant est disponible à côté, via `tableController.ids[i]` pour `tableController.rows[i]`. `highlightedIds` contient les identifiants des lignes que la vue affiche comme sélectionnées, et `selectionController` manipule également les identifiants et les lignes :

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

Choisir la vue met à jour `?__view=`, persiste après un rechargement et est conservé par utilisateur. Déclarer une vue suffit pour la proposer — `enabledViews` n'a besoin d'être défini que si vous souhaitez *masquer des vues intégrées*. Avec une seule entrée, le sélecteur de vue est masqué.

**Il ne s'agit pas d'un moyen de construire une vue englobant plusieurs collections.** Un mode de vue est un autre rendu de la requête d'une seule collection. Si votre composant ignore `tableController` et récupère lui-même les données de quatre tables, il s'agit plutôt d'une [`AppView`](/docs/frontend#custom-views) — la barre d'outils située au-dessus, avec son champ de recherche et son compteur d'enregistrements, décrirait une requête qu'il n'affiche pas.

### `formView`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>
**Portée :** collection.

Remplace l'intégralité du formulaire d'entité par défaut par un composant personnalisé, défini avec `formView: { Builder, includeActions }` dans `customizeTable` ; voir [Remplacer le formulaire](/docs/frontend/form-layout/#replacing-the-form). `includeActions` (`true` par défaut) conserve les boutons Enregistrer et Abandonner dans la barre.

À utiliser lorsque vous avez besoin d'une disposition entièrement personnalisée pour l'édition des enregistrements d'une table spécifique. Pour des ajustements plus légers, préférez plutôt la surcharge `Entity.Form` dans `components`.

Le Builder est rendu à l'intérieur du formulaire de l'enregistrement et reçoit son `formContext` actif : écrivez avec `formContext.setFieldValue`, et le bouton Enregistrer de la barre stocke l'enregistrement. Lorsque l'enregistrement ne peut pas être modifié — la vue détaillée en lecture seule, ou un utilisateur sans permission de modification — `formContext.disabled` vaut `true` et les écritures lèvent une exception. Définissez `includeActions: false` si votre Builder gère l'enregistrement de manière autonome via `formContext.submit()`.

### `additionalFields`

**Portée :** collection.

Colonnes calculées affichées dans la table de la collection. Elles ne correspondent pas à des colonnes stockées en base : elles sont calculées au moment du rendu.

→ [Colonnes additionnelles](/docs/frontend/additional-columns)

### `propertyConfigs`

**Portée :** type de propriété.

Types de champs réutilisables, enregistrés une seule fois sur `<Rebase propertyConfigs>` et référencés par le `propertyConfig` d'un champ.

→ [Champs personnalisés](/docs/frontend/custom-fields)

## Hors du panneau d'administration

Si ce que vous souhaitez modifier concerne le comportement du serveur plutôt que l'affichage du panneau, vous n'êtes pas sur la bonne page. Le serveur possède son propre éventail de solutions :

| Je souhaite… | Échelon | Référence |
|---|---|---|
| Restreindre les lignes retournées par une lecture | hook `beforeQuery` | [Étendre le serveur](/docs/backend/extending#2-table-hooks) |
| Masquer/Caviarer une valeur à l'envoi | hook `afterRead` | [Hooks de table](/docs/collections/callbacks) |
| Ajouter mon propre endpoint | fonction personnalisée | [Fonctions personnalisées](/docs/backend/custom-functions) |
| Permettre à la recherche de trouver des sous-chaînes *et* d'ignorer les accents | `search.mode: "hybrid"` | [Recherche](/docs/backend/search) |
| Prendre le contrôle total du processus serveur | serveur personnalisé, puis `rebase eject` | [Étendre le serveur](/docs/backend/extending) |

→ [Rebase ne gère pas X](/docs/backend/extending)

## Résumé de l'ordre de priorité

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- **Les `components` d'une table prévalent sur les `components` globaux** au sein de sa collection. Un remplacement au niveau de la collection remplace les deux ; une surcharge de collection avec `wrap: true` enveloppe la surcharge globale lorsqu'elle existe. Voir [Surcharges de composants](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Les `Actions` de collection et le slot `collection.actions` sont cumulatifs** — les `Actions` sont rendues en premier, suivies des contributions du slot.
- **Les `entityActions` et `entityViews` au niveau de l'application forment un registre, pas des valeurs par défaut :** une table n'affiche un élément que lorsque sa propre configuration `entityActions` / `entityViews` dans `customizeTable` mentionne sa `key`.
- **Les plugins s'appliquent dans l'ordre du tableau `plugins`**, et non par `key`. Les contributions aux slots sont rendues selon leur propriété `order` (les valeurs les plus basses en premier, 50 par défaut), et l'ordre d'insertion départage les égalités. Les wrappers de champs issus de plusieurs plugins se composent dans cet ordre, le premier plugin étant le plus imbriqué. Voir [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
