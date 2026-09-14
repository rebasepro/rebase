---
sourceHash: 387b83637f6dc883
title: Rebase erweitern
sidebar_label: Rebase erweitern
description: Ein Entscheidungsleitfaden zur Auswahl des richtigen Erweiterungsmechanismus – Plugins, Slots, Komponenten-Overrides, Entity-Views, Aktionen und mehr.
---

## Übersicht

Rebase bietet rund ein Dutzend Erweiterungsmechanismen – Plugins, Slots, Komponenten-Overrides, Entity-Views, Aktionen, benutzerdefinierte Felder und mehr. Jeder zielt auf einen anderen Scope ab (anwendungsweit, pro Collection, pro Entity, pro Property) und betrifft einen anderen Teil der Benutzeroberfläche.

Dieser Leitfaden hilft Ihnen, den richtigen Mechanismus für Ihren Anwendungsfall auszuwählen, und verlinkt anschließend auf die detaillierte Referenz des jeweiligen Mechanismus.

## Entscheidungstabelle

| Ich möchte… | Mechanismus | Scope | Referenz |
|---|---|---|---|
| Die App-Leiste ersetzen | `components` (`Shell.AppBar`) | App | [Component Overrides](/docs/frontend/component-overrides) |
| Die Login-Seite ersetzen | `components` (`Auth.LoginView`) | App | [Component Overrides](/docs/frontend/component-overrides) |
| Die Startseite ersetzen | `components` (`HomePage`) | App | [Component Overrides](/docs/frontend/component-overrides) |
| Das Aussehen des Formulars einer Collection komplett ändern | `formView` | Collection | [unten](#formview) |
| Eine Komponente innerhalb einer Collection austauschen | `collection.components` | Collection | [Component Overrides](/docs/frontend/component-overrides) |
| Standard-Komponenten-Overrides für alle Collections festlegen | `components` (Collection-bezogene Namen) | App | [Component Overrides](/docs/frontend/component-overrides) |
| Eine Schaltfläche zur Collection-Toolbar hinzufügen | Collection-`Actions` | Collection | [Entity Actions](/docs/frontend/entity-actions#collection-actions) |
| UI an einem Toolbar-Slot einer Collection einfügen | `collection.actions`-Slot | App/Plugin | [Slots](/docs/frontend/slots) |
| Einer Tabelle eine berechnete Spalte hinzufügen | `additionalFields` | Collection | [Additional Columns](/docs/frontend/additional-columns) |
| Ein benutzerdefiniertes Feld-Widget für einen Eigenschaftstyp hinzufügen | `propertyConfigs` | Property-Typ | [Custom Fields](/docs/frontend/custom-fields) |
| Einen Entity-Tab hinzufügen | `entityViews` | Entity | [Entity Views](/docs/frontend/entity-views) |
| Die Zeilen einer Collection auf andere Weise darstellen | `admin.customViews` | Collection | [unten](#customviews) |
| Eine Zeilen-/Kontextaktion oder einen Entity-Button hinzufügen | `entityActions` | Entity | [Entity Actions](/docs/frontend/entity-actions) |
| Eine Kennzahl auf der Startseitenkarte einer Collection platzieren | `home.card.widget`-Slot | App/Plugin | [Slots](/docs/frontend/slots) |
| UI an einer bestimmten Stelle im CMS-Chrome einfügen | `slots` | App/Plugin | [Slots](/docs/frontend/slots) |
| Mehrere Erweiterungen als eine installierbare Einheit bereitstellen | `plugins` | App | [Plugins](/docs/plugins) |
| Das soeben erstellte Element stylen | `@rebasepro/ui` + Theme-Tokens | beliebig | [Styling Custom UI](/docs/frontend/styling) |

:::tip[Was auch immer Sie wählen: Bauen Sie es aus dem Kit]
Jeder der unten aufgeführten Mechanismen übergibt Ihnen eine React-Komponente, macht aber keine Vorgaben dazu, womit sie gefüllt werden soll. Verwenden Sie Komponenten von `@rebasepro/ui` und die Farb-Tokens des Themes anstelle von selbstgeschriebenem CSS – eine benutzerdefinierte Ansicht ist immer noch eine Admin-Ansicht, und eine fest codierte Farbe ist in einem der beiden Themes unsichtbar. Siehe [Styling Custom UI](/docs/frontend/styling).
:::

## Mechanismen im Detail

### Plugins

**Scope:** App.

Ein Plugin bündelt Collections, Views, Komponenten-Overrides, Slot-Beiträge, Authentifizierung, Datenquellen, Provider, Hooks und Lifecycle-Callbacks in einer einzigen installierbaren Einheit. Alle anderen hier aufgeführten Mechanismen können über die Schnittstelle eines Plugins beigesteuert werden.

→ [Plugins-Referenz](/docs/plugins)

### Slots

**Scope:** App (wird pro Slot beigesteuert).

Slots sind benannte UI-Erweiterungspunkte, die über das gesamte CMS-Chrome verteilt sind. Sie registrieren eine React-Komponente für einen bestimmten Slot-Namen, und diese wird an dieser Stelle gerendert. Es gibt 29 Slots, die die Startseite, Navigation, Collection-Views, Formulare, Entity-Zeilen, Dashboards und mehr abdecken.

→ [Slots-Referenz](/docs/frontend/slots)

### Component Overrides (Swizzling)

**Scope:** App-weite Standards oder pro Collection.

Zwei Modi: **Eject** (vollständiger Ersatz) oder **Wrap** (Erweiterung des Originals).

19 überschreibbare Komponentennamen in zwei Stufen:

**Nur App-weit (7):**
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

**Rangfolge:** `components` auf Collection-Ebene überschreiben die App-weiten Standardwerte für denselben Komponentennamen (einfacher Object-Spread – Collection-Werte überschreiben globale Werte). Reine App-Komponentennamen (`Shell.*`, `HomePage`, `Auth.*`) können nur auf Ebene von `<Rebase>` überschrieben werden.

→ [Component Overrides](/docs/frontend/component-overrides)

### Entity Views

**Scope:** Entity (fügt Tabs hinzu).

Benutzerdefinierte Ansichten, die als Tabs auf der Detailseite der Entity erscheinen. Können global in `<Rebase>` oder pro Collection definiert werden.

→ [Entity Views](/docs/frontend/entity-views)

### Entity Actions

**Scope:** Entity.

Benutzerdefinierte Aktionsschaltflächen für einzelne Entities (Veröffentlichen, Archivieren, Klonen usw.). Können global oder pro Collection definiert werden.

→ [Entity Actions](/docs/frontend/entity-actions)

### Collection `Actions`

**Scope:** Collection.

React-Komponenten auf Toolbar-Ebene, die `CollectionActionsProps` empfangen (ausgewählte Entities, Table-Controller, Collection-Kontext). Werden in der Collection-Toolbar neben den integrierten Aktionen gerendert.

**Beziehung zum `collection.actions`-Slot:** Beide verhalten sich additiv – `Actions`-Komponenten werden in der Toolbar zuerst gerendert, gefolgt von Slot-Beiträgen aus `collection.actions`. Sie ersetzen einander nicht.

→ [Entity Actions — Collection Actions](/docs/frontend/entity-actions#collection-actions)

### Benutzerdefinierte Ansichtsmodi {#customviews}

**Scope:** Collection (fügt einen Ansichtsmodus hinzu).

Eine Karte, ein Kalender, eine Galerie, eine Zeitleiste – eine andere Darstellung *derselben Zeilen*, angeboten im Ansichtsumschalter der Collection neben Liste, Tabelle, Karten und Board.

```ts
// collection config
admin: {
    customViews: [
        { key: "map", name: "Map", icon: "Map", Builder: MapView }
    ],
    enabledViews: ["table", "map"],
    defaultViewMode: "map"
}
```

Or register the component once and name it by key, which is also what makes it
selectable from the collection editor:

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

`Builder` empfängt den aktiven `tableController`, sodass die Ansicht die Filter der Collection, das Suchfeld, Sortierung, Paginierung, Berechtigungsprüfungen und das Entity-Seitenpanel erbt – genau das ist der Grund, einen solchen Modus zu deklarieren, anstatt eine `AppView` zu bauen:

```tsx
function MapView({ tableController, onEntityClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.data.map(e => e.values.location)}
        onMarkerClick={i => onEntityClick?.(tableController.data[i])}
    />;
}
```

Die Auswahl der Ansicht aktualisiert `?__view=`, übersteht ein Neuladen der Seite und bleibt pro Benutzer erhalten. Das Deklarieren reicht bereits aus, um sie anzubieten – `enabledViews` muss nur gesetzt werden, wenn Sie *integrierte Ansichten entfernen* möchten. Bei einem einzelnen Eintrag wird der Umschalter ausgeblendet.

**Dies ist nicht dafür gedacht, eine Ansicht zu erstellen, die mehrere Collections umfasst.** Ein Ansichtsmodus ist lediglich eine andere Darstellung der Abfrage einer einzelnen Collection. Wenn Ihre Komponente den `tableController` ignoriert und vier eigene Tabellen abruft, sollte sie stattdessen eine [`AppView`](/docs/frontend#custom-views) sein – die Toolbar darüber mit ihrem Suchfeld und der Datensatzanzahl würde sonst eine Abfrage beschreiben, die sie gar nicht rendert.

### `formView` {#formview}

**Scope:** Collection.

Ersetzt das gesamte Standard-Entity-Formular durch eine benutzerdefinierte Komponente. Wird in einer Collection-Definition festgelegt:

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // Save and Discard in the bar (default: true)
        }
    }
};

```

Verwenden Sie dies, wenn Sie ein vollständig individuelles Layout für das Bearbeiten von Entities einer bestimmten Collection benötigen. Für kleinere Anpassungen empfiehlt sich stattdessen `collection.components` mit einem Override für `Entity.Form`.

Der Builder wird innerhalb des Formulars des Datensatzes gerendert und empfängt dessen aktiven `formContext`: Schreiben Sie mit `formContext.setFieldValue`, und die Schaltfläche „Speichern“ in der Leiste speichert den Datensatz. Wenn der Datensatz nicht bearbeitet werden kann – etwa in der schreibgeschützten Detailansicht oder bei Benutzern ohne Bearbeitungsberechtigung –, ist `formContext.disabled` auf `true` gesetzt und Schreibversuche werfen einen Fehler. Setzen Sie `includeActions: false`, wenn Ihr Builder eigenständig über `formContext.submit()` speichert.

### `additionalFields`

**Scope:** Collection.

Berechnete/virtuelle Spalten, die in der Collection-Tabelle angezeigt werden. Diese entsprechen keinen gespeicherten Eigenschaften – sie werden zur Renderzeit berechnet.

→ [Additional Columns](/docs/frontend/additional-columns)

### `propertyConfigs`

**Scope:** Property-Typ.

Benutzerdefinierte Feld-Widgets für bestimmte Property-Typen, die individuelle Formularfelder und Vorschaukomponenten bereitstellen.

→ [Custom Fields](/docs/frontend/custom-fields)

## Zusammenfassung der Rangfolge

- **`collection.components` hat Vorrang vor globalen `components`** innerhalb dieser Collection (einfacher Spread-Merge in `DataCollectionView`).
- **Collection-`Actions` und der Slot `collection.actions` sind additiv** – `Actions` werden zuerst gerendert, gefolgt von Beiträgen des Slots.
- **`entityActions` und `entityViews` auf Collection-Ebene erweitern globale Einträge (sie ersetzen sie nicht).**
- **Plugin-Beiträge werden in Reihenfolge ihrer `key`-Werte zusammengeführt.**
