---
sourceHash: 26f6f53fc55b88dc
title: Rebase erweitern
sidebar_label: Rebase erweitern
description: Ein Entscheidungsleitfaden zur Auswahl des richtigen Erweiterungsmechanismus – Plugins, Slots, Komponenten-Overrides, Entity Views, Aktionen und mehr.
---

## Übersicht

Rebase bietet rund ein Dutzend Erweiterungsmechanismen – Plugins, Slots, Komponenten-Overrides, Entity Views, Aktionen, benutzerdefinierte Felder und mehr. Jeder zielt auf einen anderen Scope ab (anwendungsweit, pro Collection, pro Entity, pro Property) und auf einen anderen Teil der Benutzeroberfläche.

Dieser Leitfaden hilft Ihnen, den richtigen Mechanismus für Ihren Anwendungsfall auszuwählen, und verlinkt anschließend auf die jeweilige detaillierte Referenz.

:::tip[Beim Modell beginnen, nicht bei der Liste]
Hinter jedem der folgenden Mechanismen steckt im Grunde dasselbe: eine React-Komponente, die an einer bestimmten Stelle platziert wird. [Customizing the Admin](/docs/frontend/customizing) erklärt dieses Modell auf einer einzigen Seite – Bausteine, Hooks, Platzierungsorte – mit erprobten Rezepten für ein Einstellungen-Singleton, benutzerspezifische Einstellungen, eine Bulk-Aktion, eine Kalenderansicht, ein Dashboard und einen benutzerdefinierten Login-Bildschirm. Lesen Sie dies zuerst; kommen Sie hierher zurück, um den Ort auszuwählen.
:::

Alles hier bezieht sich auf das **Admin-Panel**. Für den Server – das Einschränken von Lesezugriffen, das Hinzufügen einer Route, das Einbetten des Treibers in Ihren eigenen Prozess, `rebase eject` – siehe [Rebase doesn't do X](/docs/backend/extending), eine entsprechende Tabelle für das Backend.

## Entscheidungstabelle

| Ich möchte… | Mechanismus | Scope | Referenz |
|---|---|---|---|
| Die App-Leiste ersetzen | `components` (`Shell.AppBar`) | App | [Component Overrides](/docs/frontend/component-overrides) |
| Die Login-Seite ersetzen | `components` (`Auth.LoginView`) | App | [Component Overrides](/docs/frontend/component-overrides) |
| Die Startseite ersetzen | `components` (`HomePage`) | App | [Component Overrides](/docs/frontend/component-overrides) |
| Das Aussehen des Formulars einer Tabelle komplett ändern | `formView` in `customizeTable` | Tabelle | [unten](#formview) |
| Eine Komponente innerhalb der Collection einer Tabelle austauschen | `components` in `customizeTable` | Tabelle | [Component Overrides](/docs/frontend/component-overrides#collection-level-component-overrides) |
| Standard-Komponenten-Overrides für alle Collections festlegen | `components` (Collection-bezogene Namen) | App | [Component Overrides](/docs/frontend/component-overrides) |
| Eine Schaltfläche zur Collection-Toolbar hinzufügen | `Actions` in `customizeTable` | Tabelle | [Entity Actions](/docs/frontend/entity-actions#collection-actions) |
| UI an einem Collection-Toolbar-Slot einbinden | `collection.actions`-Slot | App/Plugin | [Slots](/docs/frontend/slots) |
| Einer Tabelle eine berechnete Spalte hinzufügen | `additionalFields` in `customizeTable` | Tabelle | [Additional Columns](/docs/frontend/additional-columns) |
| Das Steuerelement eines einzelnen Feldes ersetzen | `Field` in `customizeTable` | Feld | [Custom Fields](/docs/frontend/custom-fields) |
| Einen wiederverwendbaren Feldtyp registrieren | `propertyConfigs` | App | [Custom Fields](/docs/frontend/custom-fields#a-reusable-field-type) |
| Einen Entity-Tab hinzufügen | `entityViews` in `customizeTable` | Entity | [Entity Views](/docs/frontend/entity-views) |
| Die Zeilen einer Tabelle auf andere Weise rendern | `customViews` in `customizeTable` | Tabelle | [unten](#benutzerdefinierte-ansichtsmodi-custom-view-modes) |
| Eine Zeilen-/Kontextaktion oder einen Entity-Button hinzufügen | `entityActions` in `customizeTable` | Entity | [Entity Actions](/docs/frontend/entity-actions) |
| Eine Kennzahl auf der Startseitenkarte einer Collection platzieren | `home.card.widget`-Slot | App/Plugin | [Slots](/docs/frontend/slots) |
| UI an einer bestimmten Stelle der UI-Shell (Chrome) einbinden | `slots` | App/Plugin | [Slots](/docs/frontend/slots) |
| Mehrere Erweiterungen als eine installierbare Einheit bereitstellen | `plugins` | App | [Plugins](/docs/plugins) |
| Das gerade erstellte Element stylen | `@rebasepro/ui` + Theme-Tokens | Beliebig | [Styling Custom UI](/docs/frontend/styling) |

:::tip[Egal was Sie wählen, bauen Sie es mit dem Kit]
Jeder der folgenden Mechanismen übergibt Ihnen eine React-Komponente und macht keine Vorgaben darüber, womit sie gefüllt werden soll. Verwenden Sie `@rebasepro/ui`-Komponenten und die Farb-Tokens des Themes anstelle von selbst geschriebenem CSS – eine benutzerdefinierte Ansicht ist immer noch eine Admin-Ansicht, und eine fest verdrahtete Farbe ist in einem der beiden Themes unsichtbar. Siehe [Styling Custom UI](/docs/frontend/styling).
:::

## Mechanismen im Detail

### Plugins

**Scope:** App.

Ein Plugin bündelt injizierte oder modifizierte Collections, Ansichten, Slot-Beiträge, Field-Wrapper, Provider, Hooks und Lifecycle-Callbacks in einer einzigen installierbaren Einheit. Component Overrides, Entity Views, Entity Actions und `propertyConfigs` sind keine Plugin-Felder: Sie gehören zu `<Rebase>` oder in das `customizeTable` einer Tabelle.

→ [Plugin-Referenz](/docs/plugins)

### Slots

**Scope:** App (wird pro Slot bereitgestellt).

Slots sind benannte UI-Erweiterungspunkte, die über die gesamte CMS-Shell (Chrome) verteilt sind. Sie registrieren eine React-Komponente für einen bestimmten Slot-Namen, und sie wird an dieser Stelle gerendert. Es gibt 27 Slots, die die Startseite, die Navigation, Collection-Ansichten, Formulare, Entity-Zeilen, Formularfelder und die App-Leiste abdecken – und jeder einzelne davon wird gerendert.

→ [Slots-Referenz](/docs/frontend/slots)

### Component Overrides (Swizzling)

**Scope:** App-weite Standardwerte oder pro Collection.

Zwei Modi: **Eject** (vollständiger Ersatz) oder **Wrap** (Erweiterung des Originals).

19 überschreibbare Komponentennamen auf zwei Ebenen:

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

**Rangfolge:** Die `components` einer Tabelle greifen vor den app-weiten Standardwerten für denselben Komponentennamen: Ein Collection-Ersatz ersetzt beides, und ein Collection-Override mit `wrap: true` umschließt den Override auf App-Ebene. Komponentennamen, die nur für die App gelten (`Shell.*`, `HomePage`, `Auth.*`), können nur auf `<Rebase>`-Ebene überschrieben werden.

→ [Component Overrides](/docs/frontend/component-overrides)

### Entity Views

**Scope:** Entity (fügt Tabs hinzu).

Benutzerdefinierte Ansichten, die als Tabs auf der Entity-Detailseite erscheinen. Sie werden pro Tabelle in `customizeTable` definiert oder einmalig auf `<Rebase entityViews>` (oder `<RebaseCMS entityViews>`) registriert und über den `key` in den `entityViews` einer Tabelle referenziert.

→ [Entity Views](/docs/frontend/entity-views)

### Entity Actions

**Scope:** Entity.

Benutzerdefinierte Aktionsschaltflächen für einzelne Entities (veröffentlichen, archivieren, klonen usw.). Sie werden pro Tabelle in `customizeTable` definiert oder einmalig auf `<Rebase entityActions>` (oder `<RebaseCMS entityActions>`) registriert und über den `key` in den `entityActions` einer Tabelle referenziert.

→ [Entity Actions](/docs/frontend/entity-actions)

### Collection `Actions`

**Scope:** Collection.

React-Komponenten auf Toolbar-Ebene, die `CollectionActionsProps` erhalten (ausgewählte Entities, Table Controller, Collection-Kontext). Sie werden in der Collection-Toolbar neben den integrierten Aktionen gerendert.

**Verhältnis zum `collection.actions`-Slot:** Beide ergänzen sich – `Actions`-Komponenten werden zuerst in der Toolbar gerendert, gefolgt von den Slot-Beiträgen aus `collection.actions`. Sie ersetzen einander nicht.

→ [Entity Actions — Collection Actions](/docs/frontend/entity-actions#collection-actions)

### Benutzerdefinierte Ansichtsmodi {#custom-view-modes}

**Scope:** Collection (fügt einen Ansichtsmodus hinzu).

Eine Karte, ein Kalender, eine Galerie, eine Zeitleiste – eine andere Darstellung *derselben Zeilen*, die im Ansichtsumschalter der Collection neben Liste, Tabelle, Karten und Board angeboten wird.

```tsx
// frontend/src/cms/tasks.tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";
import { MapView } from "../../../../../components/MapView";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    customViews: [
        { key: "map", name: "Map", icon: "Map", Builder: MapView },
    ],
    enabledViews: ["table", "map"],
    defaultViewMode: "map",
});
```

Oder registrieren Sie die Komponente einmalig und referenzieren Sie sie über ihren Schlüssel:

```tsx
<RebaseCMS
    tableCustomizations={tableCustomizations}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    customViews: ["map"],
});
```

`Builder` empfängt den aktiven `tableController`, sodass die Ansicht die Filter der Collection, das Suchfeld, die Sortierung, die Paginierung, die Berechtigungsprüfungen und das Entity-Seitenpanel erbt – genau das ist der Grund, einen solchen zu deklarieren, anstatt eine `AppView` zu erstellen:

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

Die Zeilen stammen vom Server und haben die von `useRows` zurückgegebene Struktur: Daten als ISO-Strings, ein `belongsTo` als Fremdschlüssel-Spalte und eine Relation, die die Ansicht geladen hat, verschachtelt unter ihrem Namen. Eine Zeile enthält nur dann eine `id`-Spalte, wenn ihre Tabelle eine besitzt; ihre ID steht daneben, `tableController.ids[i]` für `tableController.rows[i]`. `highlightedIds` sind die IDs der Zeilen, die die Ansicht als ausgewählt darstellt, und der `selectionController` arbeitet ebenfalls mit IDs und Zeilen:

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

Die Auswahl der Ansicht aktualisiert `?__view=`, übersteht ein Neuladen der Seite und bleibt pro Benutzer persistent. Es reicht aus, eine Ansicht zu deklarieren, um sie anzubieten – `enabledViews` muss nur gesetzt werden, wenn Sie *integrierte Ansichten entfernen* möchten. Bei einem einzelnen Eintrag wird der Umschalter ausgeblendet.

**Dies ist kein Weg, um eine Ansicht zu erstellen, die sich über mehrere Collections erstreckt.** Ein Ansichtsmodus ist eine andere Darstellung der Abfrage einer einzelnen Collection. Wenn Ihre Komponente `tableController` ignoriert und selbst vier Tabellen abfragt, sollte sie eine [`AppView`](/docs/frontend#custom-views) sein – die Symbolleiste darüber mit ihrem Suchfeld und ihrer Datensatzanzahl würde eine Abfrage beschreiben, die sie gar nicht rendert.

### `formView`

**Scope:** Collection.

Ersetzt das gesamte Standard-Entity-Formular durch eine benutzerdefinierte Komponente, festgelegt mit `formView: { Builder, includeActions }` in `customizeTable`; siehe [Replacing the form](/docs/frontend/form-layout/#replacing-the-form). `includeActions` (Standard `true`) behält „Speichern“ und „Verwerfen“ in der Leiste bei.

Verwenden Sie dies, wenn Sie ein komplett benutzerdefiniertes Layout für die Datensatzbearbeitung einer Tabelle benötigen. Für kleinere Anpassungen empfiehlt sich stattdessen der `Entity.Form`-Override in `components`.

Der Builder wird innerhalb des Formulars des Datensatzes gerendert und empfängt dessen aktiven `formContext`: Schreiben Sie mit `formContext.setFieldValue`, und „Speichern“ in der Leiste sichert den Datensatz. Wo der Datensatz nicht bearbeitet werden kann – in der schreibgeschützten Detailansicht oder bei einem Benutzer ohne Bearbeitungsberechtigung – ist `formContext.disabled` auf `true` gesetzt und Schreibversuche werfen einen Fehler. Setzen Sie `includeActions: false`, wenn Ihr Builder selbst über `formContext.submit()` speichert.

### `additionalFields`

**Scope:** Collection.

Berechnete Spalten, die in der Collection-Tabelle angezeigt werden. Sie entsprechen keinen gespeicherten Spalten, sondern werden zur Render-Zeit berechnet.

→ [Additional Columns](/docs/frontend/additional-columns)

### `propertyConfigs`

**Scope:** Property-Typ.

Wiederverwendbare Feldtypen, die einmalig auf `<Rebase propertyConfigs>` registriert und über die `propertyConfig` eines Feldes referenziert werden.

→ [Custom Fields](/docs/frontend/custom-fields)

## Nicht das Admin-Panel

Wenn das, was Sie ändern möchten, das Verhalten des Servers betrifft und nicht das, was das Panel anzeigt, sind Sie auf dieser Seite falsch. Für den Server gibt es eine eigene Abstufung:

| Ich möchte… | Stufe | Referenz |
|---|---|---|
| Einschränken, welche Zeilen ein Lesezugriff zurückgibt | `beforeQuery`-Hook | [Extending the server](/docs/backend/extending#2-table-hooks) |
| Einen Wert bei der Ausgabe maskieren | `afterRead`-Hook | [Table hooks](/docs/collections/callbacks) |
| Einen eigenen Endpunkt hinzufügen | Benutzerdefinierte Funktion | [Custom Functions](/docs/backend/custom-functions) |
| Dafür sorgen, dass die Suche Teilstrings findet *und* Akzente ignoriert | `search.mode: "hybrid"` | [Search](/docs/backend/search) |
| Die vollständige Kontrolle über den Serverprozess übernehmen | Benutzerdefinierter Server, dann `rebase eject` | [Extending the server](/docs/backend/extending) |

→ [Rebase doesn't do X](/docs/backend/extending)

## Zusammenfassung der Rangfolge

- **Die `components` einer Tabelle haben Vorrang vor globalen `components`** innerhalb ihrer Collection. Ein Collection-Ersatz ersetzt beides; ein Collection-Override mit `wrap: true` umschließt den globalen Override, sofern vorhanden. Siehe [Component Overrides](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Collection `Actions` und der Slot `collection.actions` ergänzen sich additiv** – `Actions` werden zuerst gerendert, dann die Slot-Beiträge.
- **`entityActions` und `entityViews` auf App-Ebene fungieren als Registry, nicht als Standardwerte:** Eine Tabelle zeigt ein Element nur dann an, wenn dessen `key` in den eigenen `entityActions` / `entityViews` in `customizeTable` angegeben ist.
- **Plugins werden in der Reihenfolge des `plugins`-Arrays angewendet**, nicht nach `key`. Slot-Beiträge werden nach ihrer `order` gerendert (niedrigere Werte zuerst, standardmäßig 50), und bei Gleichstand bleibt die Reihenfolge erhalten. Field-Wrapper aus mehreren Plugins werden in dieser Reihenfolge zusammengesetzt, wobei der des ersten Plugins am weitesten innen liegt. Siehe [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
