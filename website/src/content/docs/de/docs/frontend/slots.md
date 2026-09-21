---
sourceHash: e229c0d2b62d6bee
title: Slots
sidebar_label: Slots
description: Referenz für alle in Rebase verfügbaren UI-Erweiterungspunkt-Slots – benannte Positionen, an denen Sie benutzerdefinierte Komponenten einfügen können.
---

## Übersicht

Slots sind benannte UI-Erweiterungspunkte, an denen Sie benutzerdefinierte React-Komponenten einfügen können. Jeder Slot verfügt über typisierte Props, die für seine Position in der Benutzeroberfläche spezifisch sind. Rebase enthält 27 integrierte Slots, die die Startseite, die Navigation, Sammlungsansichten (Collection Views), Entitätsformulare, die App-Leiste und mehr abdecken.

Jeder Slot in der folgenden Tabelle wird gerendert. Wenn Sie eine Komponente für einen Slot registrieren und nichts sehen, liegt der Fehler an Ihrer Komponente oder deren Props, nicht am Slot – `UNRENDERED_SLOTS` in `@rebasepro/cms-types` ist leer, und ein automatisierter Test ermittelt diese Liste durch das Scannen nach Render-Stellen, sodass ein Slot hier nicht deklariert sein kann, ohne gerendert zu werden.

## Verwendung

### Über die `<Rebase>`-Prop

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
`order` steuert die Render-Reihenfolge – niedrigere Werte werden zuerst gerendert. Der Standardwert ist `50`.
:::

## Verfügbare Slots

#### Startseite

| Slot | Props-Typ | Beschreibung |
|------|-----------|--------------|
| `home.actions` | `PluginGenericProps` | Aktionen in der Kopfzeile der Startseite |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Zusätzliche Karten auf der Startseite |
| `home.children.start` | `PluginGenericProps` | Inhalt am Anfang der Startseite |
| `home.children.end` | `PluginGenericProps` | Inhalt am Ende der Startseite |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Kompaktes Widget innerhalb einer Collection-Karte auf der Startseite |
| `home.collection.actions` | `PluginHomePageActionsProps` | Aktionen auf Collection-Karten der Startseite |

#### Navigation

| Slot | Props-Typ | Beschreibung |
|------|-----------|--------------|
| `navigation.header` | `NavigationSlotProps` | Unterhalb des Logos in der Sidebar-Leiste |
| `navigation.footer` | `NavigationSlotProps` | Oberhalb des Einklapp-Schalters am unteren Rand der Leiste |

#### Collection-Ansicht

| Slot | Props-Typ | Beschreibung |
|------|-----------|--------------|
| `collection.actions` | `CollectionActionsProps` | Toolbar-Aktionen am Ende (nach den Collection-`Actions`) |
| `collection.actions.start` | `CollectionActionsProps` | Toolbar-Aktionen am Anfang (neben den Filtern) |
| `collection.header.action` | `CollectionHeaderActionProps` | Aktionsschaltflächen in Spaltenüberschriften |
| `collection.add-column` | `CollectionAddColumnProps` | „Spalte hinzufügen“-Bereich im Tabellenkopf |
| `collection.error` | `CollectionErrorProps` | Fehlerzustandsanzeige für eine Collection |
| `collection.toolbar` | `CollectionToolbarProps` | Zusätzliche Widgets in der Collection-Toolbar-Zeile |
| `collection.empty-state` | `CollectionEmptyStateProps` | Benutzerdefinierter Leerzustand, wenn eine Collection keine Daten enthält |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets oberhalb der Collection-Tabelle |

#### Entität / Formular

| Slot | Props-Typ | Beschreibung |
|------|-----------|--------------|
| `form.actions` | `PluginFormActionProps` | Aktionen in der Aktionsleiste des Entitätsformulars |
| `form.actions.top` | `PluginFormActionProps` | Aktionen oberhalb der Formular-Aktionsleiste |
| `form.before` | `PluginFormActionProps` | Inhalt vor dem Formulartitel / der Feldliste |
| `form.after` | `PluginFormActionProps` | Inhalt nach der Formularfeldliste |
| `entity.row.actions` | `EntityRowActionsProps` | Zeilenbezogene Aktionen in Collection-Tabellen, neben den integrierten Zeilenwerkzeugen |
| `entity.field.before` | `EntityFieldSlotProps` | Vor einem einzelnen Formularfeld eingefügte Benutzeroberfläche |
| `entity.field.after` | `EntityFieldSlotProps` | Nach einem einzelnen Formularfeld eingefügte Benutzeroberfläche |

#### Global / Shell

| Slot | Props-Typ | Beschreibung |
|------|-----------|--------------|
| `global.search` | `GlobalSearchProps` | Sammlungsübergreifende Suche, in der App-Leiste neben den Breadcrumbs |
| `shell.toolbar` | `ShellToolbarProps` | Aktionen auf oberster Ebene, am Ende der App-Leiste |

:::note
Für ein Widget auf der Startseite verwenden Sie `home.children.start`, `home.children.end`,
`home.cards` oder `home.card.widget` – dies sind die vier Positionen der Startseite.
Es gibt kein `dashboard.widget`: Es akzeptierte lediglich den Kontext und benannte daher keine
Position auf einer Seite, die bereits über vier verfügt.

Für eine Filter-UI neben einer Tabelle verwenden Sie `collection.toolbar` oder
`collection.widgets`. Es gibt kein `collection.filter-panel`: Der Admin-Bereich bietet keine
Filter-Sidebar, in die es gerendert werden könnte.
:::

#### Kanban

| Slot | Props-Typ | Beschreibung |
|------|-----------|--------------|
| `kanban.setup` | `KanbanSetupProps` | Setup-UI für Kanban-Boards |
| `kanban.add-column` | `KanbanAddColumnProps` | „Spalte hinzufügen“ in der Kanban-Ansicht |

## Referenz der Slot-Props

Alle Slot-Prop-Typen werden aus `@rebasepro/types` exportiert und können für typsichere Slot-Komponenten importiert werden:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Jeder Props-Typ bietet Zugriff auf den Kontext, der für die jeweilige Position des Slots relevant ist – Collection-Metadaten, Entitätsdaten, Navigationsstatus und mehr. Vollständige Eigenschaftsdetails finden Sie in den jeweiligen Typdefinitionen.

## Verwandte Themen

- [Komponenten-Overrides (Swizzling)](/docs/frontend/component-overrides/) — wenn ein Slot nicht ausreicht
- [Rebase erweitern](/docs/frontend/extending/) — die restlichen Erweiterungsmöglichkeiten
- [Plugins](/docs/plugins/) — Slot-Inhalte als Plugin bereitstellen
