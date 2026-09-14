---
sourceHash: 24ecb93e6262aeca
title: Slots
sidebar_label: Slots
description: Référence pour tous les points d'extension d'interface utilisateur (slots) disponibles dans Rebase — emplacements nommés où vous pouvez injecter des composants personnalisés.
---

## Vue d'ensemble

Les slots sont des points d'extension d'interface utilisateur nommés où vous pouvez injecter des composants React personnalisés. Chaque slot dispose de props typées spécifiques à son emplacement dans l'interface utilisateur. Rebase est livré avec 29 slots intégrés couvrant la page d'accueil, la navigation, les vues de collection, les formulaires d'entités, les tableaux de bord et bien plus encore.

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

| Slot | Type de props | Description |
|------|--------------|-------------|
| `home.actions` | `PluginGenericProps` | Actions dans l'en-tête de la page d'accueil |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Cartes supplémentaires sur la page d'accueil |
| `home.children.start` | `PluginGenericProps` | Contenu au début de la page d'accueil |
| `home.children.end` | `PluginGenericProps` | Contenu à la fin de la page d'accueil |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Widget compact à l'intérieur d'une carte de collection de la page d'accueil |
| `home.collection.actions` | `PluginHomePageActionsProps` | Actions sur les cartes de collection de la page d'accueil |

#### Navigation

| Slot | Type de props | Description |
|------|--------------|-------------|
| `navigation.header` | `NavigationSlotProps` | Sous le logo dans le tiroir latéral (sidebar) |
| `navigation.footer` | `NavigationSlotProps` | Au-dessus du bouton de réduction en bas du tiroir |

#### Vue de collection

| Slot | Type de props | Description |
|------|--------------|-------------|
| `collection.actions` | `CollectionActionsProps` | Actions de barre d'outils côté fin (après les `Actions` de collection) |
| `collection.actions.start` | `CollectionActionsProps` | Actions de barre d'outils côté début (aux côtés des filtres) |
| `collection.header.action` | `CollectionHeaderActionProps` | Boutons d'action dans l'en-tête de colonne |
| `collection.add-column` | `CollectionAddColumnProps` | Zone « Ajouter une colonne » dans l'en-tête du tableau |
| `collection.error` | `CollectionErrorProps` | Affichage de l'état d'erreur pour une collection |
| `collection.toolbar` | `CollectionToolbarProps` | Widgets supplémentaires à l'intérieur de la ligne de barre d'outils de collection |
| `collection.empty-state` | `CollectionEmptyStateProps` | État vide personnalisé lorsqu'une collection n'a pas de données |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets au-dessus du tableau de collection |
| `collection.filter-panel` | `CollectionFilterPanelProps` | Barre latérale de filtres personnalisée à côté du tableau. **Pas encore rendu** — déclaré, mais rien dans l'admin ne le rend actuellement. |

#### Entité / Formulaire

| Slot | Type de props | Description |
|------|--------------|-------------|
| `form.actions` | `PluginFormActionProps` | Actions dans la barre d'actions du formulaire d'entité |
| `form.actions.top` | `PluginFormActionProps` | Actions au-dessus de la barre d'actions du formulaire |
| `form.before` | `PluginFormActionProps` | Contenu avant le titre du formulaire / la liste des champs |
| `form.after` | `PluginFormActionProps` | Contenu après la liste des champs du formulaire |
| `entity.row.actions` | `EntityRowActionsProps` | Actions par ligne dans les tableaux d'entités. **Pas encore rendu** — déclaré, mais rien dans l'admin ne le rend actuellement. |
| `entity.field.before` | `EntityFieldSlotProps` | UI injectée avant un champ de formulaire individuel. **Pas encore rendu** — déclaré, mais rien dans l'admin ne le rend actuellement. |
| `entity.field.after` | `EntityFieldSlotProps` | UI injectée après un champ de formulaire individuel. **Pas encore rendu** — déclaré, mais rien dans l'admin ne le rend actuellement. |

#### Tableau de bord

| Slot | Type de props | Description |
|------|--------------|-------------|
| `dashboard.widget` | `DashboardWidgetProps` | Widgets sur le tableau de bord / la page d'accueil. **Pas encore rendu** — déclaré, mais rien dans l'admin ne le rend actuellement. |

#### Global

| Slot | Type de props | Description |
|------|--------------|-------------|
| `global.search` | `GlobalSearchProps` | Composant de barre de recherche multi-collections. **Pas encore rendu** — déclaré, mais rien dans l'admin ne le rend actuellement. |
| `shell.toolbar` | `ShellToolbarProps` | Actions de barre d'outils de premier niveau dans la barre d'application. **Pas encore rendu** — déclaré, mais rien dans l'admin ne le rend actuellement. |

#### Kanban

| Slot | Type de props | Description |
|------|--------------|-------------|
| `kanban.setup` | `KanbanSetupProps` | UI de configuration du tableau Kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | « Ajouter une colonne » dans la vue Kanban |

## Référence des props de slot

Tous les types de props de slot sont exportés depuis `@rebasepro/types` et peuvent être importés pour des composants de slot sécurisés par le typage :

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Chaque type de props donne accès au contexte pertinent pour l'emplacement du slot — métadonnées de collection, données d'entité, état de navigation, et plus encore. Consultez les définitions de types individuelles pour obtenir tous les détails sur les propriétés.

## Voir aussi

- [Remplacement de composants (Swizzling)](/docs/frontend/component-overrides/) — quand un slot ne suffit pas
- [Étendre Rebase](/docs/frontend/extending/) — le reste de la surface d'extension
- [Plugins](/docs/plugins/) — distribuer du contenu de slots sous forme de plugin
