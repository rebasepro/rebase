---
sourceHash: 35cdc0483d3f3fd4
title: Slots
sidebar_label: Slots
description: Référence de tous les slots de points d'extension d'interface utilisateur disponibles dans Rebase — des emplacements nommés où vous pouvez injecter des composants personnalisés.
---

## Vue d'ensemble

Les slots sont des points d'extension d'interface utilisateur nommés où vous pouvez injecter des composants React personnalisés. Chaque slot dispose de props typées spécifiques à son emplacement dans l'interface utilisateur. Rebase intègre 27 slots prêts à l'emploi couvrant la page d'accueil, la navigation, les vues de collection, les formulaires d'entités, la barre d'application et bien plus encore.

Chaque slot du tableau ci-dessous est rendu. Si vous enregistrez un composant pour l'un d'eux et que rien ne s'affiche, le problème vient de votre composant ou de ses props, pas du slot — `UNRENDERED_SLOTS` dans `@rebasepro/cms-types` est vide, et un test génère cette liste en analysant les points de rendu, de sorte qu'un slot ne peut pas être déclaré ici sans être rendu.

## Utilisation

### Via la prop `<Rebase>`

```tsx no-verify
<Rebase
    client={client}
    slots={[
        {
            slot: "navigation.footer",
            Component: MyNavigationFooter,
            order: 10
        },
        {
            slot: "collection.actions",
            Component: BulkExportButton
        }
    ]}
>
```

### Via un plugin

```typescript
const myPlugin: RebasePlugin = {
    key: "my-plugin",
    slots: [
        {
            slot: "home.cards",
            Component: AnalyticsCard,
            order: 20
        }
    ]
};
```

:::note
`order` contrôle l'ordre de rendu — les valeurs les plus faibles sont rendues en premier. La valeur par défaut est `50`.
:::

## Slots disponibles

#### Page d'accueil

| Slot | Type de props | Description |
|------|-----------|-------------|
| `home.actions` | `PluginGenericProps` | Actions dans l'en-tête de la page d'accueil |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Cartes supplémentaires sur la page d'accueil |
| `home.children.start` | `PluginGenericProps` | Contenu au début de la page d'accueil |
| `home.children.end` | `PluginGenericProps` | Contenu à la fin de la page d'accueil |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Widget compact à l'intérieur d'une carte de collection de la page d'accueil |
| `home.collection.actions` | `PluginHomePageActionsProps` | Actions sur les cartes de collection de la page d'accueil |

#### Navigation

| Slot | Type de props | Description |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Sous le logo dans le tiroir de la barre latérale |
| `navigation.footer` | `NavigationSlotProps` | Au-dessus du bouton de repliement en bas du tiroir |

#### Vue de collection

| Slot | Type de props | Description |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Actions de barre d'outils côté fin (après les `Actions` de collection) |
| `collection.actions.start` | `CollectionActionsProps` | Actions de barre d'outils côté début (aux côtés des filtres) |
| `collection.header.action` | `CollectionHeaderActionProps` | Boutons d'action dans l'en-tête de colonne |
| `collection.add-column` | `CollectionAddColumnProps` | Zone « Ajouter une colonne » dans l'en-tête du tableau |
| `collection.error` | `CollectionErrorProps` | Affichage de l'état d'erreur pour une collection |
| `collection.toolbar` | `CollectionToolbarProps` | Widgets supplémentaires dans la ligne de la barre d'outils de collection |
| `collection.empty-state` | `CollectionEmptyStateProps` | État vide personnalisé lorsque la collection ne contient aucune donnée |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets au-dessus du tableau de collection |

Lorsqu'un slot de collection reçoit le `tableController` ou le `selectionController` de la vue, ceux-ci traitent les lignes telles que le serveur les envoie : `tableController.rows` (avec `loading`, `error` ainsi que le filtre, la recherche et le tri de la barre d'outils), et une sélection par identifiant — `selection` correspond à `{ type: "rows", ids, rows }` ou `{ type: "query", query, excludedIds, count }`, et `isSelected(id)` interroge une ligne spécifique.

#### Entité / Formulaire

| Slot | Type de props | Description |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Actions dans la barre d'actions du formulaire d'entité. Reçoit l'`id` de l'enregistrement (absent tant qu'il est nouveau), `path`, `status`, `collection` et `formContext` |
| `form.actions.top` | `PluginFormActionProps` | Actions au-dessus de la barre d'actions du formulaire |
| `form.before` | `PluginFormActionProps` | Contenu avant le titre du formulaire/la liste des champs |
| `form.after` | `PluginFormActionProps` | Contenu après la liste des champs du formulaire |
| `entity.row.actions` | `EntityRowActionsProps` | Actions par ligne dans les tableaux de collection, à côté des outils de ligne intégrés. Reçoit la ligne telle que le serveur l'envoie (`row`), son `id`, `path`, `collection`, le `selectionController` du tableau et `context` |
| `entity.field.before` | `EntityFieldSlotProps` | Interface injectée avant un champ de formulaire individuel. Reçoit la `propertyKey` et la `property` du champ, ainsi que le `path` et l'`id` de l'enregistrement (absent tant qu'il est nouveau) |
| `entity.field.after` | `EntityFieldSlotProps` | Interface injectée après un champ de formulaire individuel |

#### Global / Shell

| Slot | Type de props | Description |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Recherche multi-collections, dans la barre d'application à côté du fil d'Ariane |
| `shell.toolbar` | `ShellToolbarProps` | Actions de niveau supérieur, à la fin de la barre d'application |

:::note
Pour un widget sur la page d'accueil, utilisez `home.children.start`, `home.children.end`, `home.cards` ou `home.card.widget` — ce sont les quatre positions de la page d'accueil. Il n'existe pas de `dashboard.widget` : il ne prenait que le contexte, et ne désignait donc aucune position sur une page qui en comptait déjà quatre.

Pour une interface de filtrage à côté d'un tableau, utilisez `collection.toolbar` ou `collection.widgets`. Il n'existe pas de `collection.filter-panel` : l'interface d'administration ne comporte pas de panneau latéral de filtres dans lequel effectuer le rendu.
:::

#### Kanban

| Slot | Type de props | Description |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | Interface de configuration du tableau Kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | « Ajouter une colonne » dans la vue Kanban |

## Référence des props de slot

Tous les types de props de slot sont exportés depuis `@rebasepro/cms-types` et peuvent être importés pour des composants de slot sécurisés au niveau du typage :

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Chaque type de props donne accès au contexte pertinent pour l'emplacement du slot — métadonnées de collection, données d'entité, état de navigation, etc. Consultez les définitions de types individuelles pour connaître le détail complet des propriétés.

## Liens associés

- [Remplacement de composants (Swizzling)](/docs/frontend/component-overrides/) — lorsqu'un slot ne suffit pas
- [Étendre Rebase](/docs/frontend/extending/) — le reste de la surface d'extension
- [Plugins](/docs/plugins/) — distribuer le contenu d'un slot sous forme de plugin
