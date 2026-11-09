---
sourceHash: 6517ed25b1776f7e
title: Rebase erweitern
sidebar_label: Rebase erweitern
description: Ein Entscheidungsleitfaden zur Auswahl des richtigen Erweiterungsmechanismus – Plugins, Slots, Komponenten-Overrides, Entity-Views, Aktionen und mehr.
---

## Übersicht

Rebase bietet rund ein Dutzend Erweiterungsmechanismen – Plugins, Slots, Komponenten-Overrides, Entity-Views, Aktionen, benutzerdefinierte Felder und mehr. Jeder davon zielt auf einen anderen Geltungsbereich (anwendungsweit, pro Collection, pro Entity, pro Property) und einen anderen Teil der Benutzeroberfläche ab.

Dieser Leitfaden hilft Ihnen dabei, den richtigen Mechanismus für Ihren Anwendungsfall auszuwählen, und verlinkt anschließend auf die detaillierte Referenz des jeweiligen Mechanismus.

:::tip[Beginnen Sie mit dem Modell, nicht mit der Liste]
Jeder der unten aufgeführten Mechanismen ist im Grunde dasselbe: eine React-Komponente, die an einer bestimmten Stelle platziert wird. [Admin-Panel anpassen](/docs/frontend/customizing) erklärt dieses Modell auf einer einzigen Seite – Bausteine, Hooks, Orte – mit getesteten Vorlagen für ein Einstellungs-Singleton, benutzerspezifische Einstellungen, eine Massenaktion, eine Kalenderansicht, ein Dashboard und einen benutzerdefinierten Login-Bildschirm. Lesen Sie dies zuerst; kehren Sie anschließend hierher zurück, um die passende Stelle auszuwählen.
:::

Alles hier bezieht sich auf das **Admin-Panel**. Für den Server – das Einschränken eines Lesevorgangs,
das Hinzufügen einer Route, das Einbetten des Treibers in Ihren eigenen Prozess, `rebase eject` – siehe
[Rebase kann X nicht](/docs/backend/extending), was die entsprechende Übersicht
für das Backend darstellt.

## Entscheidungstabelle

| Ich möchte… | Mechanismus | Geltungsbereich | Referenz |
|---|---|---|---|
| Die App-Bar ersetzen | `components` (`Shell.AppBar`) | App | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Die Login-Seite ersetzen | `components` (`Auth.LoginView`) | App | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Die Startseite ersetzen | `components` (`HomePage`) | App | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Das Erscheinungsbild des Formulars einer Collection komplett ändern | `formView` | Collection | [unten](#formview) |
| Eine einzelne Komponente innerhalb einer Collection austauschen | `admin.components` | Collection | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Standard-Komponenten-Overrides für alle Collections festlegen | `components` (Collection-spezifische Namen) | App | [Komponenten-Overrides](/docs/frontend/component-overrides) |
| Eine Schaltfläche zur Collection-Toolbar hinzufügen | Collection `Actions` | Collection | [Entity-Aktionen](/docs/frontend/entity-actions#collection-actions) |
| UI in einen Collection-Toolbar-Slot einfügen | `collection.actions`-Slot | App/Plugin | [Slots](/docs/frontend/slots) |
| Einer Tabelle eine berechnete Spalte hinzufügen | `additionalFields` | Collection | [Zusätzliche Spalten](/docs/frontend/additional-columns) |
| Ein benutzerdefiniertes Feld-Widget für einen Property-Typ hinzufügen | `propertyConfigs` | Property-Typ | [Benutzerdefinierte Felder](/docs/frontend/custom-fields) |
| Einen Entity-Tab hinzufügen | `entityViews` | Entity | [Entity-Views](/docs/frontend/entity-views) |
| Die Zeilen einer Collection auf andere Art rendern | `admin.customViews` | Collection | [unten](#benutzerdefinierte-ansichtsmodi) |
| Eine Zeilen-/Kontextaktion oder Entity-Schaltfläche hinzufügen | `entityActions` | Entity | [Entity-Aktionen](/docs/frontend/entity-actions) |
| Eine Kennzahl auf der Startseitenkarte einer Collection platzieren | `home.card.widget`-Slot | App/Plugin | [Slots](/docs/frontend/slots) |
| UI an einer bestimmten Chrome-Position einfügen | `slots` | App/Plugin | [Slots](/docs/frontend/slots) |
| Mehrere Erweiterungen als eine installierbare Einheit bereitstellen | `plugins` | App | [Plugins](/docs/plugins) |
| Das soeben Erstellte stylen | `@rebasepro/ui` + Theme-Tokens | beliebig | [Styling benutzerdefinierter UI](/docs/frontend/styling) |

:::tip[Egal, wofür Sie sich entscheiden: Bauen Sie es mit dem Baukasten]
Jeder unten aufgeführte Mechanismus übergibt Ihnen eine React-Komponente und macht
keine Vorgaben bezüglich des Inhalts. Verwenden Sie Komponenten aus `@rebasepro/ui`
und die Farb-Tokens des Themes anstelle von handgeschriebenem CSS – eine benutzerdefinierte
Ansicht ist immer noch eine Admin-Ansicht, und eine fest verdrahtete Farbe ist in
einem der beiden Themes unsichtbar. Siehe
[Styling benutzerdefinierter UI](/docs/frontend/styling).
:::

## Mechanismen im Detail

### Plugins

**Geltungsbereich:** App.

Ein Plugin bündelt injizierte oder modifizierte Collections, Views, Slot-Beiträge, Field-Wrapper, Provider, Hooks und Lifecycle-Callbacks in einer einzigen installierbaren Einheit. Komponenten-Overrides, Entity-Views, Entity-Aktionen und `propertyConfigs` sind keine Plugin-Felder: Sie gehören auf `<Rebase>` oder auf die Collection.

→ [Plugin-Referenz](/docs/plugins)

### Slots

**Geltungsbereich:** App (pro Slot beigetragen).

Slots sind benannte UI-Erweiterungspunkte, die über das gesamte CMS-Chrome verteilt sind. Sie registrieren eine React-Komponente, die auf einen Slot-Namen verweist, und diese wird an dieser Position gerendert. Es gibt 27 Slots, die die Startseite, die Navigation, Collection-Ansichten, Formulare, Entity-Zeilen, Formularfelder und die App-Bar abdecken – und jeder einzelne davon wird gerendert.

→ [Slot-Referenz](/docs/frontend/slots)

### Komponenten-Overrides (Swizzling)

**Geltungsbereich:** Standardwerte auf App-Ebene oder pro Collection.

Zwei Modi: **Eject** (vollständiger Ersatz) oder **Wrap** (Erweiterung des Originals).

19 überschreibbare Komponentennamen in zwei Stufen:

**Nur App (7):**
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

**Rangfolge:** `components` auf Collection-Ebene gelten vorrangig gegenüber Standardwerten auf App-Ebene für denselben Komponentennamen: Ein Collection-Ersatz ersetzt beides, und ein Collection-Override mit `wrap: true` umschließt den Override auf App-Ebene. Komponentennamen, die nur auf App-Ebene existieren (`Shell.*`, `HomePage`, `Auth.*`), können nur auf `<Rebase>`-Ebene überschrieben werden.

→ [Komponenten-Overrides](/docs/frontend/component-overrides)

### Entity-Views

**Geltungsbereich:** Entity (fügt Tabs hinzu).

Benutzerdefinierte Ansichten, die als Tabs auf der Entity-Detailseite erscheinen. Definiert pro Collection oder einmalig auf `<Rebase entityViews>` (oder `<RebaseCMS entityViews>`) registriert und über den `key` in `admin.entityViews` einer Collection referenziert.

→ [Entity-Views](/docs/frontend/entity-views)

### Entity-Aktionen

**Geltungsbereich:** Entity.

Benutzerdefinierte Aktionsschaltflächen für einzelne Entities (Veröffentlichen, Archivieren, Klonen usw.). Definiert pro Collection oder einmalig auf `<Rebase entityActions>` (oder `<RebaseCMS entityActions>`) registriert und über den `key` in `admin.entityActions` einer Collection referenziert.

→ [Entity-Aktionen](/docs/frontend/entity-actions)

### Collection `Actions`

**Geltungsbereich:** Collection.

React-Komponenten auf Toolbar-Ebene, die `CollectionActionsProps` empfangen (ausgewählte Entities, Table-Controller, Collection-Kontext). Werden in der Collection-Toolbar neben den integrierten Aktionen gerendert.

**Beziehung zum `collection.actions`-Slot:** Beide sind additiv – `Actions`-Komponenten werden zuerst in der Toolbar gerendert, danach Slot-Beiträge von `collection.actions`. Sie ersetzen einander nicht.

→ [Entity-Aktionen — Collection-Aktionen](/docs/frontend/entity-actions#collection-actions)

### Benutzerdefinierte Ansichtsmodi
**Geltungsbereich:** Collection (fügt einen Ansichtsmodus hinzu).

Eine Karte, ein Kalender, eine Galerie, eine Zeitleiste – eine andere Darstellung *derselben Zeilen*,
angeboten im Ansichtsumschalter der Collection neben Liste, Tabelle, Karten und Board.

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

Oder registrieren Sie die Komponente einmalig und benennen Sie sie über den Key, wodurch sie auch
im Collection-Editor auswählbar wird:

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

`Builder` empfängt den aktiven `tableController`, sodass die Ansicht die Filter der
Collection, das Suchfeld, die Sortierung, die Paginierung, die Berechtigungsprüfungen
und das Entity-Seitenpanel erbt – genau das ist der Grund, einen solchen Ansichtsmodus
zu deklarieren, anstatt eine `AppView` zu bauen:

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

Die Zeilen stammen vom Server und haben die Struktur, die `useRows` zurückgibt: Datumsangaben als ISO-Strings,
ein belongsTo als Fremdschlüsselspalte und eine Relation, die die Ansicht geladen hat, verschachtelt
unter ihrem Namen. Eine Zeile hat nur dann eine `id`-Spalte, wenn ihre Tabelle eine besitzt; ihre ID steht
daneben, `tableController.ids[i]` für `tableController.rows[i]`.
`highlightedIds` sind die IDs der Zeilen, die die Ansicht als ausgewählt darstellt, und
`selectionController` arbeitet ebenfalls mit IDs und Zeilen:

```tsx
import type { CollectionCustomViewParams } from "@rebasepro/cms-types";
import { Card, Typography } from "@rebasepro/ui";

function CardsView({ tableController, highlightedIds, onRowClick }: CollectionCustomViewParams) {
    return <div className="grid grid-cols-3 gap-4 p-4">
        {tableController.rows.map((row, i) => {
            const id = tableController.ids[i];
            return <Card key={id}
                className={highlightedIds?.includes(id) ? "p-4 ring-2 ring-primary" : "p-4"}
                onClick={() => onRowClick?.(row)}>
                <Typography variant="subtitle2">{String(row.title ?? id)}</Typography>
            </Card>;
        })}
    </div>;
}
```

Die Auswahl der Ansicht aktualisiert `?__view=`, bleibt bei einem Neuladen erhalten und wird pro Benutzer gespeichert.
Die Deklaration reicht aus, um sie anzubieten – `enabledViews` muss nur gesetzt werden, wenn Sie
*integrierte Ansichten entfernen* möchten. Bei einem einzelnen Eintrag wird der Umschalter ausgeblendet.

**Dies ist kein Weg, um eine Ansicht über mehrere Collections hinweg zu erstellen.** Ein Ansichtsmodus
ist eine alternative Darstellung der Abfrage einer einzelnen Collection. Wenn Ihre Komponente den
`tableController` ignoriert und vier eigene Tabellen abruft, sollte sie als
[`AppView`](/docs/frontend#custom-views) implementiert werden – die Toolbar darüber mit ihrem
Suchfeld und der Datensatzanzahl würde andernfalls eine Abfrage beschreiben, die sie gar nicht rendert.

### `formView`
**Geltungsbereich:** Collection.

Ersetzt das gesamte standardmäßige Entity-Formular durch eine benutzerdefinierte Komponente. Wird in einer Collection-Definition festgelegt:

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

Verwenden Sie dies, wenn Sie ein vollständig individuelles Layout für die Bearbeitung von Entities einer Collection benötigen. Für kleinere Anpassungen sollten Sie stattdessen `admin.components` mit einem `Entity.Form`-Override vorziehen.

Der Builder wird innerhalb des Formulars des Datensatzes gerendert und empfängt dessen aktiven `formContext`: Schreiben Sie mit `formContext.setFieldValue`, und „Speichern“ in der Leiste speichert den Datensatz. Wenn der Datensatz nicht bearbeitet werden kann – in der schreibgeschützten Detailansicht oder bei einem Benutzer ohne Bearbeitungsberechtigung – ist `formContext.disabled` gleich `true` und Schreibvorgänge werfen Fehler. Setzen Sie `includeActions: false`, wenn Ihr Builder eigenständig über `formContext.submit()` speichert.

### `additionalFields`

**Geltungsbereich:** Collection.

Berechnete/virtuelle Spalten, die in der Collection-Tabelle angezeigt werden. Diese entsprechen keinen gespeicherten Properties – sie werden zur Renderzeit berechnet.

→ [Zusätzliche Spalten](/docs/frontend/additional-columns)

### `propertyConfigs`

**Geltungsbereich:** Property-Typ.

Benutzerdefinierte Feld-Widgets für bestimmte Property-Typen, die benutzerdefinierte Formularfelder und Vorschaukomponenten bereitstellen.

→ [Benutzerdefinierte Felder](/docs/frontend/custom-fields)

## Nicht das Admin-Panel

Wenn das, was Sie ändern möchten, das Verhalten des Servers betrifft und nicht das,
was das Panel anzeigt, ist dies die falsche Seite. Der Server hat seine eigene Stufenleiter:

| Ich möchte… | Stufe | Referenz |
|---|---|---|
| Einschränken, welche Zeilen ein Lesevorgang zurückgibt | `beforeQuery`-Callback | [Server erweitern](/docs/backend/extending#2-collection-callbacks) |
| Einen Wert bei der Ausgabe schwärzen/anpassen | `afterRead`-Callback | [Callbacks](/docs/collections/callbacks) |
| Einen eigenen Endpunkt hinzufügen | Benutzerdefinierte Funktion | [Benutzerdefinierte Funktionen](/docs/backend/custom-functions) |
| Dafür sorgen, dass die Suche Teilstrings findet *und* Akzente ignoriert | `search.mode: "hybrid"` | [Suche](/docs/backend/search) |
| Die vollständige Kontrolle über den Serverprozess übernehmen | Eigener Server, dann `rebase eject` | [Server erweitern](/docs/backend/extending) |

→ [Rebase kann X nicht](/docs/backend/extending)

## Zusammenfassung der Rangfolge

- **Das `admin.components` einer Collection hat Vorrang vor globalen `components`** innerhalb dieser Collection. Ein Collection-Ersatz ersetzt beides; ein Collection-Override mit `wrap: true` umschließt den globalen Override, sofern vorhanden. Siehe [Komponenten-Overrides](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Collection `Actions` und der `collection.actions`-Slot sind additiv** – `Actions` werden zuerst gerendert, danach Slot-Beiträge.
- **`entityActions` und `entityViews` auf App-Ebene sind eine Registry, keine Standardwerte:** Eine Collection zeigt diese nur an, wenn ihr eigenes `admin.entityActions` / `admin.entityViews` den entsprechenden `key` nennt.
- **Plugins werden in der Reihenfolge des `plugins`-Arrays angewendet**, nicht nach `key`. Slot-Beiträge werden nach ihrer `order` gerendert (niedrigere zuerst, standardmäßig 50), und bei Gleichstand bleibt diese Reihenfolge erhalten. Field-Wrapper aus mehreren Plugins setzen sich in dieser Reihenfolge zusammen, wobei das erste Plugin am weitesten innen liegt. Siehe [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
