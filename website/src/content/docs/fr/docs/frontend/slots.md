---
title: Slots
sidebar_label: Slots
description: Référence de tous les slots de points d'extension d'UI disponibles dans Rebase — emplacements nommés où vous pouvez injecter des composants personnalisés.
---

## Vue d'ensemble

Les slots sont des points d'extension d'UI nommés où vous pouvez injecter des composants React personnalisés. Chaque slot a des props typées spécifiques à son emplacement dans l'UI. Rebase est livré avec 29 slots intégrés couvrant la page d'accueil, la navigation, les vues de collection, les formulaires d'entité, les tableaux de bord et plus.

## Utilisation

### Via la prop `<Rebase>`

```tsx
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
|------|-----------|-------------|
| `home.actions` | `PluginGenericProps` | Actions dans l'en-tête de la page d'accueil |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Cartes supplémentaires sur la page d'accueil |
| `home.children.start` | `PluginGenericProps` | Contenu au début de la page d'accueil |
| `home.children.end` | `PluginGenericProps` | Contenu à la fin de la page d'accueil |
| `home.card.insight` | `HomeCardInsightSlotProps` | Widget d'insight compact à l'intérieur d'une carte de collection de la page d'accueil |
| `home.collection.actions` | `PluginHomePageActionsProps` | Actions sur les cartes de collection de la page d'accueil |

#### Navigation

| Slot | Type de props | Description |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Sous le logo dans le tiroir de la barre latérale |
| `navigation.footer` | `NavigationSlotProps` | Au-dessus du bouton de repli en bas du tiroir |

#### Vue de collection

| Slot | Type de props | Description |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Actions de la barre d'outils côté fin (après les `Actions` de collection) |
| `collection.actions.start` | `CollectionActionsProps` | Actions de la barre d'outils côté début (à côté des filtres) |
| `collection.header.action` | `CollectionHeaderActionProps` | Boutons d'action des en-têtes de colonne |
| `collection.add-column` | `CollectionAddColumnProps` | Zone « Ajouter une colonne » dans l'en-tête du tableau |
| `collection.error` | `CollectionErrorProps` | Affichage de l'état d'erreur d'une collection |
| `collection.toolbar` | `CollectionToolbarProps` | Widgets supplémentaires dans la rangée de la barre d'outils de la collection |
| `collection.empty-state` | `CollectionEmptyStateProps` | État vide personnalisé lorsque la collection n'a pas de données |
| `collection.insights` | `CollectionInsightsSlotProps` | Widgets d'insight au-dessus du tableau de la collection |
| `collection.filter-panel` | `CollectionFilterPanelProps` | Barre latérale de filtres personnalisée à côté du tableau. **Pas encore rendu** — déclaré, mais rien dans l'admin ne le rend aujourd'hui. |

#### Entité / Formulaire

| Slot | Type de props | Description |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Actions dans la barre d'actions du formulaire d'entité |
| `form.actions.top` | `PluginFormActionProps` | Actions au-dessus de la barre d'actions du formulaire |
| `form.before` | `PluginFormActionProps` | Contenu avant le titre/la liste des champs du formulaire |
| `form.after` | `PluginFormActionProps` | Contenu après la liste des champs du formulaire |
| `entity.row.actions` | `EntityRowActionsProps` | Actions par ligne dans les tables d'entités. **Pas encore rendu** — déclaré, mais rien dans l'admin ne le rend aujourd'hui. |
| `entity.field.before` | `EntityFieldSlotProps` | UI injectée avant un champ de formulaire individuel. **Pas encore rendu** — déclaré, mais rien dans l'admin ne le rend aujourd'hui. |
| `entity.field.after` | `EntityFieldSlotProps` | UI injectée après un champ de formulaire individuel. **Pas encore rendu** — déclaré, mais rien dans l'admin ne le rend aujourd'hui. |

#### Tableau de bord

| Slot | Type de props | Description |
|------|-----------|-------------|
| `dashboard.widget` | `DashboardWidgetProps` | Widgets sur le tableau de bord/la page d'accueil. **Pas encore rendu** — déclaré, mais rien dans l'admin ne le rend aujourd'hui. |

#### Global

| Slot | Type de props | Description |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Composant de barre de recherche inter-collections. **Pas encore rendu** — déclaré, mais rien dans l'admin ne le rend aujourd'hui. |
| `shell.toolbar` | `ShellToolbarProps` | Actions de la barre d'outils de premier niveau dans la barre d'app. **Pas encore rendu** — déclaré, mais rien dans l'admin ne le rend aujourd'hui. |

#### Kanban

| Slot | Type de props | Description |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | UI de configuration du tableau Kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | « Ajouter une colonne » dans la vue kanban |

## Référence des props des slots

Tous les types de props des slots sont exportés depuis `@rebasepro/types` et peuvent être importés pour des composants de slot typés :

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/admin-types";
```

Chaque type de props donne accès au contexte pertinent pour l'emplacement du slot — métadonnées de collection, données d'entité, état de navigation et plus. Reportez-vous aux définitions de types individuelles pour tous les détails des propriétés.
