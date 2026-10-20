---
sourceHash: a874bc209f13c746
title: Rebase erweitern
sidebar_label: Rebase erweitern
description: Ein Entscheidungsleitfaden für die Wahl des richtigen Erweiterungsmechanismus — Plugins, Slots, Komponenten-Overrides, Entity-Views, Aktionen und mehr.
---

## Übersicht

Rebase bietet rund ein Dutzend Erweiterungsmechanismen — Plugins, Slots, Komponenten-Overrides, Entity-Views, Aktionen, benutzerdefinierte Felder und mehr. Jeder davon zielt auf einen anderen Gültigkeitsbereich (Scope: anwendungsweit, pro Collection, pro Entity, pro Property) und einen anderen Teil der Benutzeroberfläche ab.

Dieser Leitfaden hilft Ihnen, den richtigen Mechanismus für Ihren Anwendungsfall auszuwählen, und verlinkt anschließend auf die detaillierte Referenz des jeweiligen Mechanismus.

:::tip[Starten Sie mit dem Modell, nicht mit der Liste]
Jeder unten aufgeführte Mechanismus basiert im Kern auf demselben Prinzip: eine React-Komponente, die an einer bestimmten Stelle platziert wird. [Admin anpassen](/docs/frontend/customizing) erklärt dieses Modell auf einer einzigen Seite — Bausteine, Hooks, Platzierungsorte — mit erprobten Rezepten für ein Einstellungs-Singleton, Einstellungen pro Benutzer, eine Bulk-Aktion, eine Kalenderansicht, ein Dashboard und einen benutzerdefinierten Login-Bildschirm. Lesen Sie dies zuerst; kehren Sie hierher zurück, um den passenden Ort auszuwählen.
:::

Alles hier bezieht sich auf das **Admin-Panel**. Für den Server — Einschränken eines Lesezugriffs,
Hinzufügen einer Route, Einbetten des Treibers in Ihren eigenen Prozess, `rebase eject` — siehe
[Rebase kann X nicht](/docs/backend/extending), was eine vergleichbare Übersicht
für das Backend darstellt.

## Entscheidungstabelle

| Ich möchte… | Mechanismus | Scope | Referenz |
|---|---|---|---|
| Die App-Leiste ersetzen | `components` (`Shell.AppBar`) | App | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Die Login-Seite ersetzen | `components` (`Auth.LoginView`) | App | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Die Startseite ersetzen | `components` (`HomePage`) | App | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Das Aussehen des Formulars einer Collection komplett ändern | `formView` | Collection | [unten](#formview) |
| Eine einzelne Komponente innerhalb einer Collection austauschen | `collection.components` | Collection | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Standard-Komponenten-Overrides für alle Collections festlegen | `components` (Collection-spezifische Namen) | App | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Eine Schaltfläche zur Collection-Toolbar hinzufügen | Collection `Actions` | Collection | [Entity-Aktionen](/docs/frontend/entity-actions#collection-actions) |
| UI in einen Collection-Toolbar-Slot injizieren | `collection.actions`-Slot | App/Plugin | [Slots](/docs/frontend/slots) |
| Einer Tabelle eine berechnete Spalte hinzufügen | `additionalFields` | Collection | [Zusätzliche Spalten](/docs/frontend/additional-columns) |
| Ein benutzerdefiniertes Feld-Widget für einen Eigenschaftstyp hinzufügen | `propertyConfigs` | Property-Typ | [Benutzerdefinierte Felder](/docs/frontend/custom-fields) |
| Einen Entity-Tab hinzufügen | `entityViews` | Entity | [Entity-Views](/docs/frontend/entity-views) |
| Die Zeilen einer Collection auf andere Weise rendern | `admin.customViews` | Collection | [unten](#benutzerdefinierte-ansichtsmodi-custom-view-modes) |
| Eine Zeilen-/Kontextaktion oder Entity-Schaltfläche hinzufügen | `entityActions` | Entity | [Entity-Aktionen](/docs/frontend/entity-actions) |
| Eine Kennzahl/Grafik auf der Startseitenkarte einer Collection platzieren | `home.card.widget`-Slot | App/Plugin | [Slots](/docs/frontend/slots) |
| UI an einer bestimmten Stelle des Chrome injizieren | `slots` | App/Plugin | [Slots](/docs/frontend/slots) |
| Mehrere Erweiterungen als eine installierbare Einheit bereitstellen | `plugins` | App | [Plugins](/docs/plugins) |
| Das stylen, was ich gerade gebaut habe | `@rebasepro/ui` + Theme-Tokens | beliebig | [Custom-UI stylen](/docs/frontend/styling) |

:::tip[Egal, wofür Sie sich entscheiden: Bauen Sie es mit dem Kit]
Jeder unten genannte Mechanismus stellt Ihnen eine React-Komponente bereit und macht
keine Vorgaben bezüglich des Inhalts. Verwenden Sie Komponenten aus `@rebasepro/ui` und die
Farb-Tokens des Themes statt handgeschriebenem CSS — eine benutzerdefinierte Ansicht ist immer noch
eine Admin-Ansicht, und eine fest verdrahtete Farbe ist in einem der beiden Themes unsichtbar. Siehe
[Custom-UI stylen](/docs/frontend/styling).
:::

## Die Mechanismen im Detail

### Plugins

**Scope:** App.

Ein Plugin bündelt Collections, Ansichten, Komponenten-Overrides, Slot-Beiträge, Authentifizierung, Datenquellen, Provider, Hooks und Lifecycle-Callbacks in einer einzigen installierbaren Einheit. Alle anderen hier aufgeführten Mechanismen können über die Schnittstelle eines Plugins bereitgestellt werden.

→ [Plugin-Referenz](/docs/plugins)

### Slots

**Scope:** App (wird pro Slot beigesteuert).

Slots sind benannte UI-Erweiterungspunkte, die über das gesamte CMS-Chrome verteilt sind. Sie registrieren eine React-Komponente, die auf einen Slot-Namen verweist, und diese wird an dieser Stelle gerendert. Es gibt 27 Slots für die Startseite, Navigation, Collection-Ansichten, Formulare, Entity-Zeilen, Formularfelder und die App-Leiste — und jeder einzelne davon wird gerendert.

→ [Slot-Referenz](/docs/frontend/slots)

### Komponenten-Overrides (Swizzling)

**Scope:** Standardwerte auf App-Ebene oder pro Collection.

Zwei Modi: **Eject** (vollständiger Ersatz) oder **Wrap** (das Original erweitern).

19 überschreibbare Komponentennamen in zwei Ebenen:

**Nur auf App-Ebene (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Collection-spezifisch (12):**
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

**Rangfolge:** `components` auf Collection-Ebene überschreiben die Standardwerte auf App-Ebene für denselben Komponentennamen (einfacher Object Spread — Collection-Werte überschreiben globale Werte). Reine App-Komponentennamen (`Shell.*`, `HomePage`, `Auth.*`) können nur auf der `<Rebase>`-Ebene überschrieben werden.

→ [Komponenten-Overrides](/docs/frontend/component-overrides)

### Entity-Views

**Scope:** Entity (fügt Tabs hinzu).

Benutzerdefinierte Ansichten, die als Tabs auf der Entity-Detailseite erscheinen. Können global auf `<Rebase>` oder pro Collection definiert werden.

→ [Entity-Views](/docs/frontend/entity-views)

### Entity-Aktionen

**Scope:** Entity.

Benutzerdefinierte Aktionsschaltflächen für einzelne Entities (Veröffentlichen, Archivieren, Klonen usw.). Können global oder pro Collection definiert werden.

→ [Entity-Aktionen](/docs/frontend/entity-actions)

### Collection `Actions`

**Scope:** Collection.

React-Komponenten auf Toolbar-Ebene, die `CollectionActionsProps` empfangen (ausgewählte Entities, Tabellen-Controller, Collection-Kontext). Werden in der Collection-Toolbar neben den integrierten Aktionen gerendert.

**Beziehung zum Slot `collection.actions`:** Beide ergänzen sich additiv — `Actions`-Komponenten werden zuerst in der Toolbar gerendert, gefolgt von den Slot-Beiträgen aus `collection.actions`. Sie ersetzen einander nicht.

→ [Entity-Aktionen — Collection-Aktionen](/docs/frontend/entity-actions#collection-actions)

### Benutzerdefinierte Ansichtsmodi (Custom View Modes)
**Scope:** Collection (fügt einen Ansichtsmodus hinzu).

Eine Karte, ein Kalender, eine Galerie, eine Zeitleiste — eine andere Darstellung *derselben Zeilen*,
die im Ansichtsumschalter der Collection neben Liste, Tabelle, Karten und Board angeboten wird.

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

Oder registrieren Sie die Komponente einmal und benennen Sie sie per Schlüssel, wodurch sie auch
über den Collection-Editor auswählbar wird:

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

Der `Builder` empfängt den aktiven `tableController`, sodass die Ansicht die Filter
der Collection, das Suchfeld, die Sortierung, die Paginierung, die Berechtigungsprüfungen
und das Entity-Seitenpanel erbt — das ist der eigentliche Grund, einen solchen Modus zu deklarieren,
anstatt eine `AppView` zu bauen:

```tsx
function MapView({ tableController, onEntityClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.data.map(e => e.values.location)}
        onMarkerClick={i => onEntityClick?.(tableController.data[i])}
    />;
}
```

Die Auswahl der Ansicht aktualisiert `?__view=`, übersteht ein Neuladen der Seite und bleibt pro Benutzer persistent.
Das reine Deklarieren reicht aus, um sie anzubieten — `enabledViews` muss nur gesetzt werden, wenn Sie
*integrierte Ansichten entfernen* möchten. Bei einem einzelnen Eintrag wird der Umschalter ausgeblendet.

**Dies ist nicht dafür gedacht, eine Ansicht über mehrere Collections hinweg zu erstellen.** Ein Ansichtsmodus
ist eine alternative Darstellung der Abfrage einer einzelnen Collection. Wenn Ihre Komponente den
`tableController` ignoriert und stattdessen vier eigene Tabellen abruft, sollte sie als
[`AppView`](/docs/frontend#custom-views) umgesetzt werden — die Toolbar darüber mit ihrem Suchfeld
und der Datensatzanzahl würde sonst eine Abfrage beschreiben, die gar nicht gerendert wird.

### `formView`
**Scope:** Collection.

Ersetzt das gesamte Standard-Entity-Formular durch eine benutzerdefinierte Komponente. Wird in der Collection-Definition festgelegt:

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // Speichern und Verwerfen in der Leiste (Standard: true)
        }
    }
};

```

Verwenden Sie dies, wenn Sie ein vollständig individuelles Layout für die Bearbeitung von Entities einer Collection benötigen. Für kleinere Anpassungen empfiehlt sich stattdessen `collection.components` mit einem `Entity.Form`-Override.

Der Builder wird innerhalb des Datensatzformulars gerendert und empfängt dessen aktiven `formContext`: Schreiben Sie mit `formContext.setFieldValue`, und die Schaltfläche „Speichern“ der Leiste sichert den Datensatz. Wenn der Datensatz nicht bearbeitet werden kann — in der schreibgeschützten Detailansicht oder für einen Benutzer ohne Bearbeitungsrechte — ist `formContext.disabled` gleich `true`, und Schreibvorgänge werfen einen Fehler. Setzen Sie `includeActions: false`, wenn Ihr Builder selbstständig über `formContext.submit()` speichert.

### `additionalFields`

**Scope:** Collection.

Berechnete/virtuelle Spalten, die in der Collection-Tabelle angezeigt werden. Diese entsprechen keinen gespeicherten Eigenschaften — sie werden zur Renderzeit berechnet.

→ [Zusätzliche Spalten](/docs/frontend/additional-columns)

### `propertyConfigs`

**Scope:** Property-Typ.

Benutzerdefinierte Feld-Widgets für bestimmte Eigenschaftstypen, die eigene Formularfelder und Vorschaukomponenten bereitstellen.

→ [Benutzerdefinierte Felder](/docs/frontend/custom-fields)

## Nicht das Admin-Panel

Wenn Sie das Verhalten des Servers und nicht die Anzeige des Panels anpassen
möchten, sind Sie auf dieser Seite falsch. Für den Server gibt es eine eigene Abstufung:

| Ich möchte… | Stufe | Referenz |
|---|---|---|
| Einschränken, welche Zeilen ein Lesezugriff zurückgibt | `beforeQuery`-Callback | [Server erweitern](/docs/backend/extending#2-collection-callbacks) |
| Einen Wert bei der Ausgabe unkenntlich machen/entfernen | `afterRead`-Callback | [Callbacks](/docs/collections/callbacks) |
| Einen eigenen Endpunkt hinzufügen | Benutzerdefinierte Funktion | [Benutzerdefinierte Funktionen](/docs/backend/custom-functions) |
| Teilstrings finden *und* Akzente/Umlaute ignorieren | `search.mode: "hybrid"` | [Suche](/docs/backend/search) |
| Die vollständige Kontrolle über den Server-Prozess übernehmen | Eigener Server, dann `rebase eject` | [Server erweitern](/docs/backend/extending) |

→ [Rebase kann X nicht](/docs/backend/extending)

## Zusammenfassung der Rangfolge

- **`collection.components` hat Vorrang vor globalen `components`** innerhalb dieser Collection. Ein Ersatz auf Collection-Ebene ersetzt beides; ein Collection-Override mit `wrap: true` umschließt den globalen Override, sofern vorhanden (in Version 0.24 umschließt er die integrierte Komponente und der globale Override wird übersprungen). Siehe [Komponenten-Overrides](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Collection `Actions` und der Slot `collection.actions` verhalten sich additiv** — `Actions` werden zuerst gerendert, danach die Slot-Beiträge.
- **`entityActions` und `entityViews` auf Collection-Ebene erweitern globale Einträge (sie ersetzen sie nicht).**
- **Plugins werden in der Reihenfolge des `plugins`-Arrays angewendet**, nicht nach `key`. Slot-Beiträge werden anhand ihres `order`-Werts gerendert (niedrigere Werte zuerst, standardmäßig 50), und bei Gleichstand bleibt diese Reihenfolge erhalten. Feld-Wrapper aus mehreren Plugins greifen in dieser Reihenfolge ineinander, wobei das erste Plugin am weitesten innen liegt; in Version 0.24 wurde nur der letzte Wrapper gerendert. Siehe [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
