---
sourceHash: ec086b9ec3b281fc
title: Rebase erweitern
sidebar_label: Rebase erweitern
description: Ein Entscheidungsleitfaden für die Wahl des richtigen Erweiterungsmechanismus – Plugins, Slots, Komponenten-Overrides, Entity-Views, Aktionen und mehr.
---

## Übersicht

Rebase bietet rund ein Dutzend Erweiterungsmechanismen – Plugins, Slots, Komponenten-Overrides, Entity-Views, Aktionen, benutzerdefinierte Felder und mehr. Jeder davon zielt auf einen anderen Gültigkeitsbereich (Scope: anwendungsweit, pro Collection, pro Entity, pro Eigenschaft) und einen anderen Teil der Benutzeroberfläche ab.

Dieser Leitfaden hilft Ihnen dabei, den richtigen Mechanismus für Ihren Anwendungsfall auszuwählen, und verlinkt anschließend auf die detaillierte Referenz für jeden einzelnen.

:::tip[Beginnen Sie mit dem Modell, nicht mit der Liste]
Jeder der folgenden Mechanismen ist im Grunde dasselbe: eine React-Komponente, die an einer bestimmten Stelle platziert wird. [Customizing the Admin](/docs/frontend/customizing) erklärt dieses Modell auf einer einzigen Seite – Bausteine, Hooks, Platzierungsorte – mit getesteten Rezepten für ein Einstellungen-Singleton, benutzerspezifische Einstellungen, eine Massenaktion (Bulk Action), eine Kalenderansicht, ein Dashboard und einen benutzerdefinierten Anmeldebildschirm. Lesen Sie dies zuerst; kehren Sie hierher zurück, um den passenden Ort auszuwählen.
:::

Hier dreht sich alles um das **Admin-Panel**. Für den Server – das Einschränken eines Lesevorgangs, das Hinzufügen einer Route, das Einbetten des Treibers in Ihren eigenen Prozess, `rebase eject` – siehe [Rebase doesn't do X](/docs/backend/extending), eine ähnliche Tabelle für das Backend.

## Entscheidungsmatrix

| Ich möchte… | Mechanismus | Scope | Referenz |
|---|---|---|---|
| Die App-Leiste ersetzen | `components` (`Shell.AppBar`) | app | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Die Anmeldeseite ersetzen | `components` (`Auth.LoginView`) | app | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Die Startseite ersetzen | `components` (`HomePage`) | app | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Das Aussehen des Formulars einer Collection komplett ändern | `formView` | collection | [unten](#formview) |
| Eine Komponente innerhalb einer Collection austauschen | `admin.components` | collection | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Standard-Komponenten-Overrides für alle Collections festlegen | `components` (Collection-bezogene Namen) | app | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Eine Schaltfläche zur Collection-Symbolleiste hinzufügen | Collection-`Actions` | collection | [Entity-Aktionen](/docs/frontend/entity-actions#collection-actions) |
| UI in einen Collection-Symbolleisten-Slot einschleusen | `collection.actions`-Slot | app/plugin | [Slots](/docs/frontend/slots) |
| Einer Tabelle eine berechnete Spalte hinzufügen | `additionalFields` | collection | [Zusätzliche Spalten](/docs/frontend/additional-columns) |
| Ein benutzerdefiniertes Feld-Widget für einen Eigenschaftstyp hinzufügen | `propertyConfigs` | property type | [Benutzerdefinierte Felder](/docs/frontend/custom-fields) |
| Einen Entity-Tab hinzufügen | `entityViews` | entity | [Entity-Views](/docs/frontend/entity-views) |
| Die Zeilen einer Collection auf andere Weise rendern | `admin.customViews` | collection | [unten](#benutzerdefinierte-ansichtsmodi-custom-view-modes) |
| Eine Zeilen-/Kontextaktion oder eine Entity-Schaltfläche hinzufügen | `entityActions` | entity | [Entity-Aktionen](/docs/frontend/entity-actions) |
| Eine Kennzahl auf der Startseitenkarte einer Collection platzieren | `home.card.widget`-Slot | app/plugin | [Slots](/docs/frontend/slots) |
| UI an einer bestimmten Stelle im CMS-Chrome einschleusen | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Mehrere Erweiterungen als eine installierbare Einheit ausliefern | `plugins` | app | [Plugins](/docs/plugins) |
| Das soeben Erstellte gestalten | `@rebasepro/ui` + Theme-Tokens | any | [Custom UI gestalten](/docs/frontend/styling) |

:::tip[Was auch immer Sie wählen: Bauen Sie es mit dem Kit]
Jeder der folgenden Mechanismen stellt Ihnen eine React-Komponente bereit und macht keine Vorgaben darüber, womit Sie sie füllen. Verwenden Sie `@rebasepro/ui`-Komponenten und die Farb-Tokens des Themes statt selbstgeschriebenem CSS – eine benutzerdefinierte Ansicht ist immer noch eine Admin-Ansicht, und eine fest verdrahtete Farbe ist in einem der beiden Themes unsichtbar. Siehe [Custom UI gestalten](/docs/frontend/styling).
:::

## Mechanismen im Detail

### Plugins

**Scope:** App.

Ein Plugin bündelt eingeschleuste oder modifizierte Collections, Views, Slot-Beiträge, Field-Wrapper, Provider, Hooks und Lifecycle-Callbacks in einer einzigen installierbaren Einheit. Komponenten-Overrides, Entity-Views, Entity-Aktionen und `propertyConfigs` sind keine Plugin-Felder: Sie werden an `<Rebase>` oder an der Collection definiert.

→ [Plugin-Referenz](/docs/plugins)

### Slots

**Scope:** App (pro Slot beigesteuert).

Slots sind benannte UI-Erweiterungspunkte, die über das gesamte CMS-Chrome verteilt sind. Sie registrieren eine React-Komponente für einen Slot-Namen, und sie wird an dieser Stelle gerendert. Es gibt 27 Slots, die die Startseite, die Navigation, Collection-Ansichten, Formulare, Entity-Zeilen, Formularfelder und die App-Leiste abdecken – und jeder einzelne davon wird gerendert.

→ [Slots-Referenz](/docs/frontend/slots)

### Komponenten-Overrides (Swizzling)

**Scope:** Standardwerte auf App-Ebene oder pro Collection.

Zwei Modi: **Eject** (vollständiger Ersatz) oder **Wrap** (Erweiterung des Originals).

19 überschreibbare Komponentennamen in zwei Stufen:

**Nur App-Ebene (7):**
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

**Rangfolge:** `components` auf Collection-Ebene gelten vorrangig vor den Standardeinstellungen auf App-Ebene für denselben Komponentennamen: Ein Ersatz auf Collection-Ebene ersetzt beide, und ein Collection-Override mit `wrap: true` umschließt den auf App-Ebene. Komponentennamen, die nur auf App-Ebene existieren (`Shell.*`, `HomePage`, `Auth.*`), können nur auf `<Rebase>`-Ebene überschrieben werden.

→ [Komponenten-Overrides](/docs/frontend/component-overrides)

### Entity-Views

**Scope:** Entity (fügt Tabs hinzu).

Benutzerdefinierte Ansichten, die als Tabs auf der Entity-Detailseite erscheinen. Werden pro Collection definiert oder einmalig auf `<Rebase entityViews>` (oder `<RebaseCMS entityViews>`) registriert und per `key` in `admin.entityViews` einer Collection referenziert.

→ [Entity-Views](/docs/frontend/entity-views)

### Entity-Aktionen

**Scope:** Entity.

Benutzerdefinierte Aktionsschaltflächen für einzelne Entities (Veröffentlichen, Archivieren, Klonen usw.). Werden pro Collection definiert oder einmalig auf `<Rebase entityActions>` (oder `<RebaseCMS entityActions>`) registriert und per `key` in `admin.entityActions` einer Collection referenziert.

→ [Entity-Aktionen](/docs/frontend/entity-actions)

### Collection `Actions`

**Scope:** Collection.

React-Komponenten auf Symbolleistenebene, die `CollectionActionsProps` empfangen (ausgewählte Entities, Table-Controller, Collection-Kontext). Werden in der Collection-Symbolleiste neben den integrierten Aktionen gerendert.

**Beziehung zum `collection.actions`-Slot:** Beide verhalten sich additiv – `Actions`-Komponenten werden zuerst in der Symbolleiste gerendert, danach Slot-Beiträge aus `collection.actions`. Sie ersetzen einander nicht.

→ [Entity-Aktionen – Collection Actions](/docs/frontend/entity-actions#collection-actions)

### Benutzerdefinierte Ansichtsmodi (Custom View Modes)
**Scope:** Collection (fügt einen Ansichtsmodus hinzu).

Eine Karte, ein Kalender, eine Galerie, eine Zeitleiste – eine alternative Darstellung *derselben Zeilen*, angeboten im Ansichtsumschalter der Collection neben Liste, Tabelle, Karten und Board.

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

Oder registrieren Sie die Komponente einmalig und benennen Sie sie per Key, wodurch sie auch im Collection-Editor auswählbar wird:

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
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

Die Zeilen stammen vom Server in der Struktur, die `useRows` zurückgibt: Datumsangaben als ISO-Strings, ein `belongsTo` als Fremdschlüsselspalte und eine geladene Relation verschachtelt unter ihrem Namen. `highlightedIds` sind die IDs der Zeilen, die von der Ansicht als ausgewählt dargestellt werden, und auch der `selectionController` arbeitet mit IDs und Zeilen.

Das Auswählen der Ansicht aktualisiert `?__view=`, bleibt bei einem Neuladen erhalten und wird pro Benutzer gespeichert. Das Deklarieren reicht bereits aus, um sie anzubieten – `enabledViews` muss nur gesetzt werden, wenn Sie *integrierte Ansichten entfernen* möchten. Bei einem einzelnen Eintrag wird der Umschalter ausgeblendet.

**Dies ist kein Weg, um eine Ansicht über mehrere Collections hinweg zu erstellen.** Ein Ansichtsmodus ist lediglich eine andere Darstellung der Abfrage einer einzelnen Collection. Wenn Ihre Komponente den `tableController` ignoriert und selbst vier Tabellen abruft, sollte sie stattdessen eine [`AppView`](/docs/frontend#custom-views) sein – denn die Symbolleiste darüber mit ihrem Suchfeld und der Datensatzanzahl würde eine Abfrage beschreiben, die sie gar nicht rendert.

### `formView`
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

Verwenden Sie dies, wenn Sie ein komplett individuelles Layout für das Bearbeiten von Entities einer Collection benötigen. Für kleinere Anpassungen empfiehlt sich stattdessen `admin.components` mit einem `Entity.Form`-Override.

Der Builder wird innerhalb des Formulars des Datensatzes gerendert und empfängt dessen aktiven `formContext`: Schreiben Sie mit `formContext.setFieldValue`, und die Speichern-Schaltfläche in der Leiste speichert den Datensatz. Wenn der Datensatz nicht bearbeitet werden kann – in der schreibgeschützten Detailansicht oder bei Benutzern ohne Bearbeitungsberechtigung – ist `formContext.disabled` gleich `true`, und Schreibversuche werfen einen Fehler. Setzen Sie `includeActions: false`, falls Ihr Builder selbstständig über `formContext.submit()` speichert.

### `additionalFields`

**Scope:** Collection.

Berechnete/virtuelle Spalten, die in der Collection-Tabelle angezeigt werden. Diese entsprechen keinen gespeicherten Eigenschaften – sie werden zur Renderzeit berechnet.

→ [Zusätzliche Spalten](/docs/frontend/additional-columns)

### `propertyConfigs`

**Scope:** Eigenschaftstyp (Property Type).

Benutzerdefinierte Feld-Widgets für bestimmte Eigenschaftstypen, die individuelle Formularfelder und Vorschaukomponenten bereitstellen.

→ [Benutzerdefinierte Felder](/docs/frontend/custom-fields)

## Nicht das Admin-Panel

Wenn das, was Sie ändern möchten, das Verhalten des Servers betrifft und nicht das, was das Panel anzeigt, sind Sie auf der falschen Seite. Der Server besitzt seine eigene Stufenleiter:

| Ich möchte… | Stufe | Referenz |
|---|---|---|
| Einschränken, welche Zeilen ein Lesevorgang zurückgibt | `beforeQuery`-Callback | [Server erweitern](/docs/backend/extending#2-collection-callbacks) |
| Einen Wert bei der Ausgabe schwärzen/entfernen | `afterRead`-Callback | [Callbacks](/docs/collections/callbacks) |
| Einen eigenen Endpunkt hinzufügen | Eigene Funktion (Custom Function) | [Custom Functions](/docs/backend/custom-functions) |
| Die Suche Substrings finden *und* Akzente ignorieren lassen | `search.mode: "hybrid"` | [Suche](/docs/backend/search) |
| Den Serverprozess selbst verwalten | Eigener Server, dann `rebase eject` | [Server erweitern](/docs/backend/extending) |

→ [Rebase doesn't do X](/docs/backend/extending)

## Zusammenfassung der Rangfolge

- **Das `admin.components` einer Collection hat Vorrang vor globalen `components`** innerhalb dieser Collection. Ein Ersatz auf Collection-Ebene ersetzt beide; ein Collection-Override mit `wrap: true` umschließt den globalen Override, sofern vorhanden (in 0.24 umschließt er die integrierte Komponente, und der globale Override wird übersprungen). Siehe [Komponenten-Overrides](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Collection-`Actions` und der `collection.actions`-Slot sind additiv** – `Actions` werden zuerst gerendert, danach die Slot-Beiträge.
- **`entityActions` und `entityViews` auf App-Ebene fungieren als Registry, nicht als Standardwerte:** Eine Collection zeigt diese nur an, wenn ihr eigenes `admin.entityActions` / `admin.entityViews` den entsprechenden `key` angibt.
- **Plugins werden in der Reihenfolge des `plugins`-Arrays angewendet**, nicht nach `key`. Slot-Beiträge werden nach ihrer `order` gerendert (niedrigere zuerst, standardmäßig 50), und bei Gleichstand bleibt diese Reihenfolge erhalten. Field-Wrapper aus mehreren Plugins werden in dieser Reihenfolge zusammengesetzt, wobei der des ersten Plugins am weitesten innen liegt; in 0.24 wurde nur der letzte Wrapper gerendert. Siehe [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
