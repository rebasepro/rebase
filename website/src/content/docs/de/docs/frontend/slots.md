---
title: Slots
sidebar_label: Slots
description: Referenz für alle UI-Erweiterungspunkt-Slots, die in Rebase verfügbar sind — benannte Stellen, an denen Sie benutzerdefinierte Komponenten einfügen können.
---

## Überblick

Slots sind benannte UI-Erweiterungspunkte, an denen Sie benutzerdefinierte React-Komponenten einfügen können. Jeder Slot hat typisierte Props, die für seine Position in der UI spezifisch sind. Rebase liefert 29 integrierte Slots, die die Startseite, Navigation, Collection-Views, Entity-Formulare, Dashboards und mehr abdecken.

## Verwendung

### Über die `<Rebase>`-Prop

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

### Über ein Plugin

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
`order` steuert die Renderreihenfolge — niedrigere Werte werden zuerst gerendert. Der Standard ist `50`.
:::

## Verfügbare Slots

#### Startseite

| Slot | Props-Typ | Beschreibung |
|------|-----------|-------------|
| `home.actions` | `PluginGenericProps` | Aktionen im Header der Startseite |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Zusätzliche Karten auf der Startseite |
| `home.children.start` | `PluginGenericProps` | Inhalt am Anfang der Startseite |
| `home.children.end` | `PluginGenericProps` | Inhalt am Ende der Startseite |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Kompaktes Widget in einer Collection-Karte der Startseite |
| `home.collection.actions` | `PluginHomePageActionsProps` | Aktionen auf Collection-Karten der Startseite |

#### Navigation

| Slot | Props-Typ | Beschreibung |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Unter dem Logo in der Sidebar-Schublade |
| `navigation.footer` | `NavigationSlotProps` | Über dem Einklapp-Umschalter unten in der Schublade |

#### Collection-View

| Slot | Props-Typ | Beschreibung |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Toolbar-Aktionen am Ende (nach Collection-`Actions`) |
| `collection.actions.start` | `CollectionActionsProps` | Toolbar-Aktionen am Anfang (neben den Filtern) |
| `collection.header.action` | `CollectionHeaderActionProps` | Aktionsschaltflächen der Spaltenüberschriften |
| `collection.add-column` | `CollectionAddColumnProps` | „Spalte hinzufügen"-Bereich im Tabellenkopf |
| `collection.error` | `CollectionErrorProps` | Anzeige des Fehlerzustands einer Collection |
| `collection.toolbar` | `CollectionToolbarProps` | Zusätzliche Widgets in der Toolbar-Zeile der Collection |
| `collection.empty-state` | `CollectionEmptyStateProps` | Benutzerdefinierter Leerzustand, wenn die Collection keine Daten hat |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets über der Collection-Tabelle |
| `collection.filter-panel` | `CollectionFilterPanelProps` | Benutzerdefinierte Filter-Sidebar neben der Tabelle. **Noch nicht gerendert** — deklariert, aber derzeit rendert nichts im Admin diesen Slot. |

#### Entität / Formular

| Slot | Props-Typ | Beschreibung |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Aktionen in der Aktionsleiste des Entity-Formulars |
| `form.actions.top` | `PluginFormActionProps` | Aktionen über der Formular-Aktionsleiste |
| `form.before` | `PluginFormActionProps` | Inhalt vor dem Formulartitel/der Feldliste |
| `form.after` | `PluginFormActionProps` | Inhalt nach der Formular-Feldliste |
| `entity.row.actions` | `EntityRowActionsProps` | Aktionen pro Zeile in Entity-Tabellen. **Noch nicht gerendert** — deklariert, aber derzeit rendert nichts im Admin diesen Slot. |
| `entity.field.before` | `EntityFieldSlotProps` | UI, die vor einem einzelnen Formularfeld eingefügt wird. **Noch nicht gerendert** — deklariert, aber derzeit rendert nichts im Admin diesen Slot. |
| `entity.field.after` | `EntityFieldSlotProps` | UI, die nach einem einzelnen Formularfeld eingefügt wird. **Noch nicht gerendert** — deklariert, aber derzeit rendert nichts im Admin diesen Slot. |

#### Dashboard

| Slot | Props-Typ | Beschreibung |
|------|-----------|-------------|
| `dashboard.widget` | `DashboardWidgetProps` | Widgets auf dem Dashboard/der Startseite. **Noch nicht gerendert** — deklariert, aber derzeit rendert nichts im Admin diesen Slot. |

#### Global

| Slot | Props-Typ | Beschreibung |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Collection-übergreifende Suchleisten-Komponente. **Noch nicht gerendert** — deklariert, aber derzeit rendert nichts im Admin diesen Slot. |
| `shell.toolbar` | `ShellToolbarProps` | Toolbar-Aktionen auf oberster Ebene in der App-Bar. **Noch nicht gerendert** — deklariert, aber derzeit rendert nichts im Admin diesen Slot. |

#### Kanban

| Slot | Props-Typ | Beschreibung |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | Kanban-Board-Setup-UI |
| `kanban.add-column` | `KanbanAddColumnProps` | „Spalte hinzufügen" in der Kanban-Ansicht |

## Slot-Props-Referenz

Alle Slot-Prop-Typen werden aus `@rebasepro/types` exportiert und können für typsichere Slot-Komponenten importiert werden:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/admin-types";
```

Jeder Props-Typ bietet Zugriff auf den für die Position des Slots relevanten Kontext — Collection-Metadaten, Entity-Daten, Navigationszustand und mehr. Weitere Details zu den Eigenschaften finden Sie in den einzelnen Typdefinitionen.
