---
sourceHash: c63661257e39dcba
title: Rebase erweitern
sidebar_label: Rebase erweitern
description: Ein Entscheidungsleitfaden zur Auswahl des richtigen Erweiterungsmechanismus – Plugins, Slots, Komponenten-Overrides, Entity-Views, Aktionen und mehr.
---

## Übersicht

Rebase bietet rund ein Dutzend Erweiterungsmechanismen – Plugins, Slots, Komponenten-Overrides, Entity-Views, Aktionen, benutzerdefinierte Felder und mehr. Jeder zielt auf einen anderen Scope ab (anwendungsweit, pro Collection, pro Entity, pro Eigenschaft) und betrifft einen anderen Teil der Benutzeroberfläche.

Dieser Leitfaden hilft Ihnen bei der Auswahl des richtigen Mechanismus für Ihren Anwendungsfall und verlinkt anschließend auf die detaillierte Referenz zu jedem Thema.

Alles hier bezieht sich auf das **Admin-Panel**. Für den Server – das Einschränken eines Lesevorgangs, das Hinzufügen einer Route, das Einbetten des Treibers in Ihren eigenen Prozess, `rebase eject` – siehe [Rebase unterstützt kein X](/docs/backend/extending), was eine vergleichbare Übersicht für das Backend bietet.

## Entscheidungstabelle

| Ich möchte… | Mechanismus | Scope | Referenz |
|---|---|---|---|
| Die App-Leiste ersetzen | `components` (`Shell.AppBar`) | App | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Die Login-Seite ersetzen | `components` (`Auth.LoginView`) | App | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Die Startseite ersetzen | `components` (`HomePage`) | App | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Das Erscheinungsbild des Formulars einer Collection komplett ändern | `formView` | Collection | [unten](#formview) |
| Eine einzelne Komponente innerhalb einer Collection austauschen | `collection.components` | Collection | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Standard-Komponenten-Overrides für alle Collections festlegen | `components` (Collection-bezogene Namen) | App | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Einen Button zur Collection-Symbolleiste hinzufügen | Collection-`Actions` | Collection | [Entity-Aktionen](/docs/frontend/entity-actions#collection-actions) |
| UI an einem Slot der Collection-Symbolleiste einfügen | `collection.actions`-Slot | App/Plugin | [Slots](/docs/frontend/slots) |
| Eine berechnete Spalte zu einer Tabelle hinzufügen | `additionalFields` | Collection | [Zusätzliche Spalten](/docs/frontend/additional-columns) |
| Ein benutzerdefiniertes Feld-Widget für einen Eigenschaftstyp hinzufügen | `propertyConfigs` | Eigenschaftstyp | [Benutzerdefinierte Felder](/docs/frontend/custom-fields) |
| Einen Entity-Tab hinzufügen | `entityViews` | Entity | [Entity-Views](/docs/frontend/entity-views) |
| Die Zeilen einer Collection auf andere Weise rendern | `admin.customViews` | Collection | [unten](#customviews) |
| Eine Zeilen-/Kontextaktion oder einen Entity-Button hinzufügen | `entityActions` | Entity | [Entity-Aktionen](/docs/frontend/entity-actions) |
| Eine Kennzahl auf der Startseitenkarte einer Collection platzieren | `home.card.widget`-Slot | App/Plugin | [Slots](/docs/frontend/slots) |
| UI an einer bestimmten Chrome-Position einfügen | `slots` | App/Plugin | [Slots](/docs/frontend/slots) |
| Mehrere Erweiterungen als eine installierbare Einheit ausliefern | `plugins` | App | [Plugins](/docs/plugins) |
| Das gerade Erstellte stylen | `@rebasepro/ui` + Theme-Tokens | Beliebig | [Benutzerdefinierte UI stylen](/docs/frontend/styling) |

:::tip[Was auch immer Sie wählen: Bauen Sie es mit dem UI-Kit]
Jeder der folgenden Mechanismen übergibt Ihnen eine React-Komponente und macht keine Vorgaben darüber, womit Sie sie füllen. Verwenden Sie Komponenten von `@rebasepro/ui` und die Farb-Tokens des Themes anstelle von selbstgeschriebenem CSS – ein benutzerdefinierter View ist immer noch ein Admin-View, und eine fest programmierte Farbe ist in einem der beiden Themes unsichtbar. Siehe [Benutzerdefinierte UI stylen](/docs/frontend/styling).
:::

## Mechanismen im Detail

### Plugins

**Scope:** App.

Ein Plugin bündelt Collections, Views, Komponenten-Overrides, Slot-Beiträge, Authentifizierung, Datenquellen, Provider, Hooks und Lifecycle-Callbacks in einer einzigen installierbaren Einheit. Alle anderen hier aufgeführten Mechanismen können über die Schnittstelle eines Plugins bereitgestellt werden.

→ [Plugin-Referenz](/docs/plugins)

### Slots

**Scope:** App (wird pro Slot bereitgestellt).

Slots sind benannte UI-Erweiterungspunkte, die über den gesamten CMS-Chrome verteilt sind. Sie registrieren eine React-Komponente für einen Slot-Namen, und sie wird an dieser Stelle gerendert. Es gibt 27 Slots für die Startseite, die Navigation, Collection-Views, Formulare, Entity-Zeilen, Formularfelder und die App-Leiste – und jeder einzelne davon wird gerendert.

→ [Slot-Referenz](/docs/frontend/slots)

### Komponenten-Overrides (Swizzling)

**Scope:** App-weite Standardwerte oder pro Collection.

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

**Rangfolge:** `components` auf Collection-Ebene überschreiben App-weite Standardwerte für denselben Komponentennamen (einfacher Object-Spread – Collection-Werte überschreiben globale Werte). Komponentennamen, die nur für die App gelten (`Shell.*`, `HomePage`, `Auth.*`), können nur auf der Ebene von `<Rebase>` überschrieben werden.

→ [Komponenten-Overrides](/docs/frontend/component-overrides)

### Entity-Views

**Scope:** Entity (fügt Tabs hinzu).

Benutzerdefinierte Views, die als Tabs auf der Entity-Detailseite erscheinen. Können global auf `<Rebase>` oder pro Collection definiert werden.

→ [Entity-Views](/docs/frontend/entity-views)

### Entity-Aktionen

**Scope:** Entity.

Benutzerdefinierte Aktions-Buttons für einzelne Entities (Veröffentlichen, Archivieren, Klonen usw.). Können global oder pro Collection definiert werden.

→ [Entity-Aktionen](/docs/frontend/entity-actions)

### Collection-`Actions`

**Scope:** Collection.

React-Komponenten auf Symbolleistenebene, die `CollectionActionsProps` erhalten (ausgewählte Entities, Table Controller, Collection-Kontext). Werden in der Symbolleiste der Collection neben den integrierten Aktionen gerendert.

**Verhältnis zum `collection.actions`-Slot:** Beide ergänzen sich gegenseitig – `Actions`-Komponenten werden zuerst in der Symbolleiste gerendert, gefolgt von Beiträgen aus dem `collection.actions`-Slot. Sie ersetzen sich nicht gegenseitig.

→ [Entity-Aktionen – Collection-Aktionen](/docs/frontend/entity-actions#collection-actions)

### Benutzerdefinierte View-Modi {#customviews}

**Scope:** Collection (fügt einen View-Modus hinzu).

Eine Karte, ein Kalender, eine Galerie, eine Zeitleiste – eine andere Darstellung *derselben Zeilen*, die im View-Umschalter der Collection neben Liste, Tabelle, Karten und Board angeboten wird.

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

Oder registrieren Sie die Komponente einmal und benennen Sie sie per Schlüssel, wodurch sie auch im Collection-Editor auswählbar wird:

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

`Builder` erhält den aktiven `tableController`, sodass der View die Filter der Collection, das Suchfeld, die Sortierung, die Paginierung, die Berechtigungsprüfungen und das Entity-Seitenpanel übernimmt – genau das ist der Grund, einen solchen View zu deklarieren, anstatt einen `AppView` zu erstellen:

```tsx
function MapView({ tableController, onEntityClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.data.map(e => e.values.location)}
        onMarkerClick={i => onEntityClick?.(tableController.data[i])}
    />;
}
```

Das Auswählen des Views aktualisiert `?__view=`, bleibt nach einem Neuladen erhalten und wird pro Benutzer gespeichert. Das reine Deklarieren genügt bereits, um ihn anzubieten – `enabledViews` muss nur festgelegt werden, wenn Sie *integrierte Views entfernen* möchten. Bei einem einzelnen Eintrag wird der Umschalter ausgeblendet.

**Dies ist keine Möglichkeit, einen View über mehrere Collections hinweg zu erstellen.** Ein View-Modus ist eine andere Darstellung der Abfrage einer einzelnen Collection. Wenn Ihre Komponente den `tableController` ignoriert und stattdessen vier eigene Tabellen abruft, sollte sie ein [`AppView`](/docs/frontend#custom-views) sein – die Symbolleiste darüber mit ihrem Suchfeld und der Datensatzanzahl würde sonst eine Abfrage beschreiben, die gar nicht gerendert wird.

### `formView` {#formview}

**Scope:** Collection.

Ersetzt das gesamte Standard-Entity-Formular durch eine benutzerdefinierte Komponente. Wird in der Collection-Definition festgelegt:

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

Verwenden Sie dies, wenn Sie ein komplett individuelles Layout für das Bearbeiten von Entities einer Collection benötigen. Für kleinere Anpassungen empfiehlt sich stattdessen `collection.components` mit einem `Entity.Form`-Override.

Der Builder wird innerhalb des Formulars des Datensatzes gerendert und erhält dessen aktiven `formContext`: Schreiben Sie mit `formContext.setFieldValue`, und „Speichern“ in der Leiste sichert den Datensatz. Wenn der Datensatz nicht bearbeitet werden kann – in der schreibgeschützten Detailansicht oder bei einem Benutzer ohne Bearbeitungsberechtigung –, ist `formContext.disabled` gleich `true` und Schreibversuche werfen einen Fehler. Setzen Sie `includeActions: false`, falls Ihr Builder selbstständig über `formContext.submit()` speichert.

### `additionalFields`

**Scope:** Collection.

Berechnete/virtuelle Spalten, die in der Collection-Tabelle angezeigt werden. Diese entsprechen keinen gespeicherten Eigenschaften – sie werden zur Renderzeit berechnet.

→ [Zusätzliche Spalten](/docs/frontend/additional-columns)

### `propertyConfigs`

**Scope:** Eigenschaftstyp.

Benutzerdefinierte Feld-Widgets für bestimmte Eigenschaftstypen, die individuelle Formularfelder und Vorschau-Komponenten bereitstellen.

→ [Benutzerdefinierte Felder](/docs/frontend/custom-fields)

## Nicht das Admin-Panel

Wenn Sie das Verhalten des Servers ändern möchten und nicht die Darstellung des Panels, sind Sie hier auf der falschen Seite. Der Server hat seine eigene Abstufung:

| Ich möchte… | Stufe | Referenz |
|---|---|---|
| Einschränken, welche Zeilen ein Lesevorgang zurückgibt | `beforeQuery`-Callback | [Server erweitern](/docs/backend/extending#2-collection-callbacks) |
| Einen Wert bei der Ausgabe maskieren | `afterRead`-Callback | [Callbacks](/docs/collections/callbacks) |
| Einen eigenen Endpunkt hinzufügen | Benutzerdefinierte Funktion | [Benutzerdefinierte Funktionen](/docs/backend/custom-functions) |
| Sicherstellen, dass die Suche Teilstrings findet *und* Akzente ignoriert | `search.mode: "hybrid"` | [Suche](/docs/backend/search) |
| Die volle Kontrolle über den Serverprozess haben | Eigener Server, dann `rebase eject` | [Server erweitern](/docs/backend/extending) |

→ [Rebase unterstützt kein X](/docs/backend/extending)

## Zusammenfassung der Rangfolge

- **`collection.components` hat Vorrang vor globalen `components`** innerhalb dieser Collection (einfacher Spread-Merge in `DataCollectionView`).
- **Collection-`Actions` und der `collection.actions`-Slot ergänzen sich** – `Actions` werden zuerst gerendert, danach die Slot-Beiträge.
- **`entityActions` und `entityViews` auf Collection-Ebene erweitern die globalen (anstatt sie zu ersetzen).**
- **Plugin-Beiträge werden in der Reihenfolge ihres `key` zusammengeführt.**
