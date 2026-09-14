---
sourceHash: 24ecb93e6262aeca
title: Slots
sidebar_label: Slots
description: Referenz für alle in Rebase verfügbaren UI-Erweiterungspunkt-Slots – benannte Stellen, an denen Sie benutzerdefinierte Komponenten einfügen können.
---

## Übersicht

Slots sind benannte UI-Erweiterungspunkte, an denen Sie benutzerdefinierte React-Komponenten einfügen können. Jeder Slot verfügt über typisierte Props, die für seine Position in der Benutzeroberfläche spezifisch sind. Rebase wird mit 29 integrierten Slots ausgeliefert, die die Startseite, die Navigation, Collection-Ansichten, Entity-Formulare, Dashboards und mehr abdecken.

## Verwendung

### Über den `<Rebase>`-Prop

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
`order` steuert die Rendering-Reihenfolge – niedrigere Werte werden zuerst gerendert. Der Standardwert ist `50`.
:::

## Verfügbare Slots

#### Startseite

| Slot | Props-Typ | Beschreibung |
|------|-----------|-------------|
| `home.actions` | `PluginGenericProps` | Aktionen in der Kopfzeile der Startseite |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Zusätzliche Karten auf der Startseite |
| `home.children.start` | `PluginGenericProps` | Inhalt am Anfang der Startseite |
| `home.children.end` | `PluginGenericProps` | Inhalt am Ende der Startseite |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Kompaktes Widget innerhalb einer Collection-Karte auf der Startseite |
| `home.collection.actions` | `PluginHomePageActionsProps` | Aktionen auf Collection-Karten der Startseite |

#### Navigation

| Slot | Props-Typ | Beschreibung |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Unterhalb des Logos im Drawer der Seitenleiste |
| `navigation.footer` | `NavigationSlotProps` | Oberhalb des Einklapp-Umschalters am unteren Rand des Drawers |

#### Collection-Ansicht

| Slot | Props-Typ | Beschreibung |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Toolbar-Aktionen am Ende (nach Collection-`Actions`) |
| `collection.actions.start` | `CollectionActionsProps` | Toolbar-Aktionen am Anfang (neben Filtern) |
| `collection.header.action` | `CollectionHeaderActionProps` | Aktionsschaltflächen im Spaltenkopf |
| `collection.add-column` | `CollectionAddColumnProps` | Bereich „Spalte hinzufügen“ im Tabellenkopf |
| `collection.error` | `CollectionErrorProps` | Anzeige des Fehlerzustands für eine Collection |
| `collection.toolbar` | `CollectionToolbarProps` | Zusätzliche Widgets innerhalb der Collection-Toolbar-Zeile |
| `collection.empty-state` | `CollectionEmptyStateProps` | Benutzerdefinierter Leerzustand, wenn die Collection keine Daten enthält |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets oberhalb der Collection-Tabelle |
| `collection.filter-panel` | `CollectionFilterPanelProps` | Benutzerdefinierte Filter-Seitenleiste neben der Tabelle. **Wird noch nicht gerendert** – deklariert, wird jedoch derzeit noch an keiner Stelle im Admin gerendert. |

#### Entity / Formular

| Slot | Props-Typ | Beschreibung |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Aktionen in der Aktionsleiste des Entity-Formulars |
| `form.actions.top` | `PluginFormActionProps` | Aktionen oberhalb der Formular-Aktionsleiste |
| `form.before` | `PluginFormActionProps` | Inhalt vor dem Formulartitel bzw. der Feldliste |
| `form.after` | `PluginFormActionProps` | Inhalt nach der Formular-Feldliste |
| `entity.row.actions` | `EntityRowActionsProps` | Zeilenweise Aktionen in Entity-Tabellen. **Wird noch nicht gerendert** – deklariert, wird jedoch derzeit noch an keiner Stelle im Admin gerendert. |
| `entity.field.before` | `EntityFieldSlotProps` | UI, die vor einem einzelnen Formularfeld eingefügt wird. **Wird noch nicht gerendert** – deklariert, wird jedoch derzeit noch an keiner Stelle im Admin gerendert. |
| `entity.field.after` | `EntityFieldSlotProps` | UI, die nach einem einzelnen Formularfeld eingefügt wird. **Wird noch nicht gerendert** – deklariert, wird jedoch derzeit noch an keiner Stelle im Admin gerendert. |

#### Dashboard

| Slot | Props-Typ | Beschreibung |
|------|-----------|-------------|
| `dashboard.widget` | `DashboardWidgetProps` | Widgets auf dem Dashboard bzw. der Startseite. **Wird noch nicht gerendert** – deklariert, wird jedoch derzeit noch an keiner Stelle im Admin gerendert. |

#### Global

| Slot | Props-Typ | Beschreibung |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Collection-übergreifende Suchleisten-Komponente. **Wird noch nicht gerendert** – deklariert, wird jedoch derzeit noch an keiner Stelle im Admin gerendert. |
| `shell.toolbar` | `ShellToolbarProps` | Aktionen in der Top-Level-Toolbar der App-Leiste. **Wird noch nicht gerendert** – deklariert, wird jedoch derzeit noch an keiner Stelle im Admin gerendert. |

#### Kanban

| Slot | Props-Typ | Beschreibung |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | UI zur Einrichtung des Kanban-Boards |
| `kanban.add-column` | `KanbanAddColumnProps` | „Spalte hinzufügen“ in der Kanban-Ansicht |

## Referenz der Slot-Props

Alle Slot-Prop-Typen werden aus `@rebasepro/types` exportiert und können für typsichere Slot-Komponenten importiert werden:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Jeder Props-Typ bietet Zugriff auf den Kontext, der für die Position des jeweiligen Slots relevant ist – Collection-Metadaten, Entity-Daten, Navigationsstatus und mehr. Vollständige Eigenschaftsdetails finden Sie in den einzelnen Typdefinitionen.

## Verwandte Themen

- [Komponenten-Überschreibungen (Swizzling)](/docs/frontend/component-overrides/) – wenn ein Slot nicht ausreicht
- [Rebase erweitern](/docs/frontend/extending/) – die restliche Erweiterungsfläche
- [Plugins](/docs/plugins/) – Slot-Inhalte als Plugin bereitstellen
