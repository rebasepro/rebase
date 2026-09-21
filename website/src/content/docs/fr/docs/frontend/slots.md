---
sourceHash: f3f10a71f8d6c351
title: Slots
sidebar_label: Slots
description: Référence de tous les slots de points d'extension d'interface utilisateur disponibles dans Rebase — des emplacements nommés où vous pouvez injecter des composants personnalisés.
---

## Vue d'ensemble

Les slots sont des points d'extension d'interface utilisateur nommés où vous pouvez injecter des composants React personnalisés. Chaque slot dispose de props typées spécifiques à son emplacement dans l'interface utilisateur. Rebase est livré avec 27 slots intégrés couvrant la page d'accueil, la navigation, les vues de collection, les formulaires d'entités, la barre d'application, et bien plus encore.

Chaque slot du tableau ci-dessous est rendu. Si vous enregistrez un composant pour l'un d'eux et que rien ne s'affiche, l'erreur vient de votre composant ou de ses props, et non du slot — `UNRENDERED_SLOTS` dans `@rebasepro/cms-types` est vide, et un test génère cette liste en analysant les points de rendu, de sorte qu'un slot ne peut pas être déclaré ici sans en avoir un.

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
`order` contrôle l'ordre de rendu — les valeurs les plus basses sont rendues en premier. La valeur par défaut est `50`.
:::

## Slots disponibles

#### Page d'accueil

| Slot | Type de Props | Description |
|------|--------------|-------------|
| `home.actions` | `PluginGenericProps` | Actions dans l'en-tête de la page d'accueil |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Cartes supplémentaires sur la page d'accueil |
| `home.children.start` | `PluginGenericProps` | Contenu au début de la page d'accueil |
| `home.children.end` | `PluginGenericProps` | Contenu à la fin de la page d'accueil |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Widget compact à l'intérieur d'une carte de collection sur la page d'accueil |
| `home.collection.actions` | `PluginHomePageActionsProps` | Actions sur les cartes de collection de la page d'accueil |

#### Navigation

| Slot | Type de Props | Description |
|------|--------------|-------------|
| `navigation.header` | `NavigationSlotProps` | Sous le logo dans le volet latéral |
| `navigation.footer` | `NavigationSlotProps` | Au-dessus du bouton de réduction en bas du volet |

#### Vue de collection

| Slot | Type de Props | Description |
|------|--------------|-------------|
| `collection.actions` | `CollectionActionsProps` | Actions de la barre d'outils côté fin (après les `Actions` de collection) |
| `collection.actions.start` | `CollectionActionsProps` | Actions de la barre d'outils côté début (aux côtés des filtres) |
| `collection.header.action` | `CollectionHeaderActionProps` | Boutons d'action dans l'en-tête de colonne |
| `collection.add-column` | `CollectionAddColumnProps` | Zone « Ajouter une colonne » dans l'en-tête du tableau |
| `collection.error` | `CollectionErrorProps` | Affichage de l'état d'erreur pour une collection |
| `collection.toolbar` | `CollectionToolbarProps` | Widgets supplémentaires dans la ligne de la barre d'outils de collection |
| `collection.empty-state` | `CollectionEmptyStateProps` | État vide personnalisé lorsque la collection ne contient aucune donnée |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets au-dessus du tableau de la collection |

#### Entité / Formulaire

| Slot | Type de Props | Description |
|------|--------------|-------------|
| `form.actions` | `PluginFormActionProps` | Actions dans la barre d'actions du formulaire d'entité |
| `form.actions.top` | `PluginFormActionProps` | Actions au-dessus de la barre d'actions du formulaire |
| `form.before` | `PluginFormActionProps` | Contenu avant le titre du formulaire / la liste des champs |
| `form.after` | `PluginFormActionProps` | Contenu après la liste des champs du formulaire |
| `entity.row.actions` | `EntityRowActionsProps` | <span class="since-badge" data-since="0.22">Depuis 0.22</span> Actions par ligne dans les tableaux de collection, à côté des outils de ligne intégrés |
| `entity.field.before` | `EntityFieldSlotProps` | <span class="since-badge" data-since="0.22">Depuis 0.22</span> Interface utilisateur injectée avant un champ de formulaire individuel |
| `entity.field.after` | `EntityFieldSlotProps` | <span class="since-badge" data-since="0.22">Depuis 0.22</span> Interface utilisateur injectée après un champ de formulaire individuel |

#### Global / Shell

| Slot | Type de Props | Description |
|------|--------------|-------------|
| `global.search` | `GlobalSearchProps` | <span class="since-badge" data-since="0.22">Depuis 0.22</span> Recherche multi-collections, dans la barre d'application à côté du fil d'Ariane |
| `shell.toolbar` | `ShellToolbarProps` | <span class="since-badge" data-since="0.22">Depuis 0.22</span> Actions de niveau supérieur, à la fin de la barre d'application |

:::note
Pour un widget sur la page d'accueil, utilisez `home.children.start`, `home.children.end`,
`home.cards` ou `home.card.widget` — ce sont les quatre positions de la page d'accueil.
Il n'y a pas de `dashboard.widget` : il ne prenait que le contexte et ne désignait donc
aucune position sur une page qui en comptait déjà quatre.

Pour une interface de filtrage à côté d'un tableau, utilisez `collection.toolbar` ou
`collection.widgets`. Il n'y a pas de `collection.filter-panel` : l'interface d'administration
ne dispose pas d'une barre latérale de filtres dans laquelle il pourrait être rendu.
:::

#### Kanban

| Slot | Type de Props | Description |
|------|--------------|-------------|
| `kanban.setup` | `KanbanSetupProps` | Interface utilisateur de configuration du tableau Kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | « Ajouter une colonne » dans la vue Kanban |

## Référence des props des slots

Tous les types de props de slots sont exportés depuis `@rebasepro/types` et peuvent être importés pour des composants de slot sécurisés au niveau des types :

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Chaque type de props donne accès au contexte pertinent pour l'emplacement du slot — métadonnées de collection, données d'entité, état de navigation, et plus encore. Reportez-vous aux définitions de types individuelles pour connaître tous les détails des propriétés.

## Voir aussi

- [Surcharges de composants (Swizzling)](/docs/frontend/component-overrides/) — lorsqu'un slot ne suffit pas
- [Étendre Rebase](/docs/frontend/extending/) — le reste de la surface d'extension
- [Plugins](/docs/plugins/) — distribuer le contenu d'un slot sous forme de plugin
