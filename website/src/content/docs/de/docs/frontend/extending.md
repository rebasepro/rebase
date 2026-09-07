---
sourceHash: 5de2aebf9af99221
title: Rebase erweitern
sidebar_label: Rebase erweitern
description: Ein Entscheidungsleitfaden zur Wahl des richtigen Erweiterungsmechanismus — Plugins, Slots, Komponenten-Overrides, Entity-Views, Aktionen und mehr.
---

## Überblick

Rebase bietet etwa ein Dutzend Erweiterungsmechanismen — Plugins, Slots, Komponenten-Overrides, Entity-Views, Aktionen, benutzerdefinierte Felder und mehr. Jeder zielt auf einen anderen Bereich (app-weit, pro Collection, pro Entität, pro Property) und einen anderen Teil der UI ab.

Dieser Leitfaden hilft Ihnen, den richtigen Mechanismus für Ihren Anwendungsfall auszuwählen, und verlinkt dann auf die detaillierte Referenz zu jedem.

## Entscheidungstabelle

| Ich möchte… | Mechanismus | Bereich | Referenz |
|---|---|---|---|
| Die App-Bar ersetzen | `components` (`Shell.AppBar`) | app | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Die Login-Seite ersetzen | `components` (`Auth.LoginView`) | app | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Die Startseite ersetzen | `components` (`HomePage`) | app | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Das Aussehen des Formulars einer Collection vollständig ändern | `formView` | collection | [unten](#formview) |
| Eine Komponente innerhalb einer Collection austauschen | `collection.components` | collection | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Standard-Komponenten-Overrides für alle Collections festlegen | `components` (Collection-bezogene Namen) | app | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Eine Schaltfläche zur Collection-Toolbar hinzufügen | Collection-`Actions` | collection | [Entity-Aktionen](/docs/frontend/entity-actions#collection-actions) |
| UI an einem Collection-Toolbar-Slot einfügen | `collection.actions`-Slot | app/plugin | [Slots](/docs/frontend/slots) |
| Eine berechnete Spalte zu einer Tabelle hinzufügen | `additionalFields` | collection | [Zusätzliche Spalten](/docs/frontend/additional-columns) |
| Ein benutzerdefiniertes Feld-Widget für einen Property-Typ hinzufügen | `propertyConfigs` | property type | [Benutzerdefinierte Felder](/docs/frontend/custom-fields) |
| Einen Entity-Tab hinzufügen | `entityViews` | entity | [Entity-Views](/docs/frontend/entity-views) |
| Eine Zeilen-/Kontextaktion oder eine Entity-Schaltfläche hinzufügen | `entityActions` | entity | [Entity-Aktionen](/docs/frontend/entity-actions) |
| UI an einer bestimmten Chrome-Stelle einfügen | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Mehrere Erweiterungen als eine installierbare Einheit ausliefern | `plugins` | app | [Plugins](/docs/plugins) |

## Mechanismen im Detail

### Plugins

**Bereich:** app.

Ein Plugin bündelt Collections, Views, Komponenten-Overrides, Slot-Beiträge, Auth, Datenquellen, Provider, Hooks und Lifecycle-Callbacks in einer einzigen installierbaren Einheit. Alle anderen hier aufgeführten Mechanismen können über die Schnittstelle eines Plugins beigetragen werden.

→ [Plugins-Referenz](/docs/plugins)

### Slots

**Bereich:** app (pro Slot beigetragen).

Slots sind benannte UI-Erweiterungspunkte, die über das gesamte CMS-Chrome verteilt sind. Sie registrieren eine React-Komponente, die auf einen Slot-Namen abzielt, und sie wird an dieser Stelle gerendert. Es gibt 29 Slots, die die Startseite, Navigation, Collection-Views, Formulare, Entity-Zeilen, Dashboards und mehr abdecken.

→ [Slots-Referenz](/docs/frontend/slots)

### Komponenten-Overrides (Swizzling)

**Bereich:** App-Level-Standards oder pro Collection.

Zwei Modi: **Eject** (vollständiger Ersatz) oder **Wrap** (das Original erweitern).

19 überschreibbare Komponentennamen in zwei Ebenen:

**Nur App (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Collection-bezogen (12):**
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

**Vorrang:** `components` auf Collection-Ebene überschreiben App-Level-Standards für denselben Komponentennamen (einfacher Object-Spread — Collection-Werte überschreiben globale Werte). Nur-App-Komponentennamen (`Shell.*`, `HomePage`, `Auth.*`) können nur auf `<Rebase>`-Ebene überschrieben werden.

→ [Komponenten-Overrides](/docs/frontend/component-overrides)

### Entity-Views

**Bereich:** entity (fügt Tabs hinzu).

Benutzerdefinierte Views, die als Tabs auf der Entity-Detailseite erscheinen. Können global auf `<Rebase>` oder pro Collection definiert werden.

→ [Entity-Views](/docs/frontend/entity-views)

### Entity-Aktionen

**Bereich:** entity.

Benutzerdefinierte Aktionsschaltflächen auf einzelnen Entitäten (veröffentlichen, archivieren, klonen usw.). Können global oder pro Collection definiert werden.

→ [Entity-Aktionen](/docs/frontend/entity-actions)

### Collection-`Actions`

**Bereich:** collection.

React-Komponenten auf Toolbar-Ebene, die `CollectionActionsProps` erhalten (ausgewählte Entitäten, Tabellen-Controller, Collection-Kontext). Sie werden in der Collection-Toolbar neben den integrierten Aktionen gerendert.

**Beziehung zum `collection.actions`-Slot:** Beide sind additiv — `Actions`-Komponenten werden zuerst in der Toolbar gerendert, dann die Slot-Beiträge aus `collection.actions`. Sie ersetzen einander nicht.

→ [Entity-Aktionen — Collection-Aktionen](/docs/frontend/entity-actions#collection-actions)

### `formView` {#formview}

**Bereich:** collection.

Ersetzt das gesamte Standard-Entity-Formular durch eine benutzerdefinierte Komponente. Wird auf einer Collection-Definition festgelegt:

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // show save/delete bar (default: true)
        }
    }
};

```

Verwenden Sie dies, wenn Sie ein vollständig benutzerdefiniertes Layout für die Entity-Bearbeitung einer Collection benötigen. Für kleinere Anpassungen bevorzugen Sie stattdessen `collection.components` mit dem `Entity.Form`-Override.

### `additionalFields`

**Bereich:** collection.

Berechnete/virtuelle Spalten, die in der Collection-Tabelle angezeigt werden. Diese entsprechen keinen gespeicherten Properties — sie werden zur Renderzeit berechnet.

→ [Zusätzliche Spalten](/docs/frontend/additional-columns)

### `propertyConfigs`

**Bereich:** property type.

Benutzerdefinierte Feld-Widgets für bestimmte Property-Typen, die benutzerdefinierte Formularfelder und Vorschaukomponenten bereitstellen.

→ [Benutzerdefinierte Felder](/docs/frontend/custom-fields)

## Vorrang-Zusammenfassung

- **`collection.components` schlägt globale `components`** innerhalb dieser Collection (einfache Spread-Zusammenführung in `DataCollectionView`).
- **Collection-`Actions` und `collection.actions`-Slot sind additiv** — `Actions` werden zuerst gerendert, dann die Slot-Beiträge.
- **`entityActions` und `entityViews` auf Collection-Ebene erweitern (ersetzen nicht) die globalen.**
- **Plugin-Beiträge werden in `key`-Reihenfolge zusammengeführt.**
