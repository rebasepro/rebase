---
sourceHash: 35cdc0483d3f3fd4
title: Slots
sidebar_label: Slots
description: Referenz für alle in Rebase verfügbaren UI-Erweiterungspunkt-Slots – benannte Stellen, an denen Sie benutzerdefinierte Komponenten einfügen können.
---

## Übersicht

Slots sind benannte UI-Erweiterungspunkte, an denen Sie benutzerdefinierte React-Komponenten einfügen können. Jeder Slot verfügt über typisierte Props, die spezifisch für seine Position in der Benutzeroberfläche sind. Rebase wird mit 27 integrierten Slots ausgeliefert, die die Startseite, Navigation, Sammlungsansichten (Collection Views), Entitätsformulare, die App-Leiste und mehr abdecken.

Jeder Slot in der folgenden Tabelle wird gerendert. Wenn Sie eine Komponente für einen Slot registrieren und nichts sehen, liegt der Fehler in Ihrer Komponente oder ihren Props, nicht im Slot – `UNRENDERED_SLOTS` in `@rebasepro/cms-types` ist leer, und ein Test leitet diese Liste durch Scannen nach Render-Stellen ab, sodass ein Slot hier nicht mehr ohne eine solche deklariert werden kann.

## Verwendung

### Über `<Rebase>`-Prop

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

### Über Plugin

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
|------|-----------|--------------|
| `home.actions` | `PluginGenericProps` | Aktionen in der Kopfzeile der Startseite |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Zusätzliche Karten auf der Startseite |
| `home.children.start` | `PluginGenericProps` | Inhalt am Anfang der Startseite |
| `home.children.end` | `PluginGenericProps` | Inhalt am Ende der Startseite |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Kompaktes Widget innerhalb einer Sammlungskarte auf der Startseite |
| `home.collection.actions` | `PluginHomePageActionsProps` | Aktionen auf Sammlungskarten der Startseite |

#### Navigation

| Slot | Props-Typ | Beschreibung |
|------|-----------|--------------|
| `navigation.header` | `NavigationSlotProps` | Unterhalb des Logos im Seitenleisten-Drawer |
| `navigation.footer` | `NavigationSlotProps` | Oberhalb des Umschalt-Buttons zum Einklappen am unteren Rand des Drawers |

#### Sammlungsansicht

| Slot | Props-Typ | Beschreibung |
|------|-----------|--------------|
| `collection.actions` | `CollectionActionsProps` | Toolbar-Aktionen am Ende (nach Sammlungs-`Actions`) |
| `collection.actions.start` | `CollectionActionsProps` | Toolbar-Aktionen am Anfang (neben Filtern) |
| `collection.header.action` | `CollectionHeaderActionProps` | Aktionsschaltflächen in Spaltenköpfen |
| `collection.add-column` | `CollectionAddColumnProps` | „Spalte hinzufügen“-Bereich im Tabellenkopf |
| `collection.error` | `CollectionErrorProps` | Fehlerstatusanzeige für eine Sammlung |
| `collection.toolbar` | `CollectionToolbarProps` | Zusätzliche Widgets in der Sammlungs-Toolbar-Zeile |
| `collection.empty-state` | `CollectionEmptyStateProps` | Benutzerdefinierter Leerzustand (Empty-State), wenn die Sammlung keine Daten enthält |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets oberhalb der Sammlungstabelle |

Wenn einem Sammlungs-Slot der `tableController` oder `selectionController` der Ansicht übergeben wird, arbeiten diese mit Zeilen, wie der Server sie sendet: `tableController.rows` (mit `loading`, `error` sowie Filter, Suche und Sortierung der Toolbar) und einer Auswahl nach ID – `selection` ist `{ type: "rows", ids, rows }` oder `{ type: "query", query, excludedIds, count }`, und `isSelected(id)` prüft eine einzelne Zeile.

#### Entität / Formular

| Slot | Props-Typ | Beschreibung |
|------|-----------|--------------|
| `form.actions` | `PluginFormActionProps` | Aktionen in der Aktionsleiste des Entitätsformulars. Übergibt die `id` des Datensatzes (fehlt, solange er neu ist), `path`, `status`, `collection` und `formContext` |
| `form.actions.top` | `PluginFormActionProps` | Aktionen oberhalb der Formular-Aktionsleiste |
| `form.before` | `PluginFormActionProps` | Inhalt vor dem Formulartitel bzw. der Feldliste |
| `form.after` | `PluginFormActionProps` | Inhalt nach der Formularfeldliste |
| `entity.row.actions` | `EntityRowActionsProps` | Aktionen pro Zeile in Sammlungstabellen, neben den integrierten Zeilentools. Übergibt die Zeile, wie der Server sie sendet (`row`), ihre `id`, `path`, `collection`, den `selectionController` der Tabelle und den `context` |
| `entity.field.before` | `EntityFieldSlotProps` | Vor einem einzelnen Formularfeld eingefügte UI. Übergibt `propertyKey` und `property` des Felds sowie `path` und `id` des Datensatzes (fehlt, solange er neu ist) |
| `entity.field.after` | `EntityFieldSlotProps` | Nach einem einzelnen Formularfeld eingefügte UI |

#### Global / Shell

| Slot | Props-Typ | Beschreibung |
|------|-----------|--------------|
| `global.search` | `GlobalSearchProps` | Sammlungsübergreifende Suche in der App-Leiste neben den Breadcrumbs |
| `shell.toolbar` | `ShellToolbarProps` | Aktionen auf oberster Ebene am Ende der App-Leiste |

:::note
Verwenden Sie für ein Widget auf der Startseite `home.children.start`, `home.children.end`, `home.cards` oder `home.card.widget` – dies sind die vier Positionen der Startseite. Es gibt kein `dashboard.widget`: Es übernahm nur den Kontext und definierte daher keine Position auf einer Seite, die bereits vier besaß.

Verwenden Sie für eine Filter-UI neben einer Tabelle `collection.toolbar` oder `collection.widgets`. Es gibt kein `collection.filter-panel`: Das Admin-Panel verfügt über keine Filter-Seitenleiste, in die es gerendert werden könnte.
:::

#### Kanban

| Slot | Props-Typ | Beschreibung |
|------|-----------|--------------|
| `kanban.setup` | `KanbanSetupProps` | Setup-UI für das Kanban-Board |
| `kanban.add-column` | `KanbanAddColumnProps` | „Spalte hinzufügen“ in der Kanban-Ansicht |

## Slot-Props-Referenz

Alle Slot-Prop-Typen werden aus `@rebasepro/cms-types` exportiert und können für typsichere Slot-Komponenten importiert werden:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Jeder Props-Typ bietet Zugriff auf den Kontext, der für die jeweilige Position des Slots relevant ist – Sammlungs-Metadaten, Entitätsdaten, Navigationsstatus und mehr. Detaillierte Informationen zu den einzelnen Properties finden Sie in den entsprechenden Typdefinitionen.

## Verwandte Themen

- [Komponenten-Überschreibungen (Swizzling)](/docs/frontend/component-overrides/) – wenn ein Slot nicht ausreicht
- [Rebase erweitern](/docs/frontend/extending/) – die übrigen Erweiterungsmöglichkeiten
- [Plugins](/docs/plugins/) – Bereitstellen von Slot-Inhalten als Plugin
