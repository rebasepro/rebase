---
sourceHash: 3317ba94279d0cb8
title: Rebase erweitern
sidebar_label: Rebase erweitern
description: Ein Leitfaden zur Auswahl des richtigen Erweiterungsmechanismus – Plugins, Slots, Komponenten-Overrides, Entity-Views, Aktionen und mehr.
---

## Übersicht

Rebase bietet rund ein Dutzend Erweiterungsmechanismen – Plugins, Slots, Komponenten-Overrides, Entity-Views, Aktionen, benutzerdefinierte Felder und mehr. Jeder zielt auf einen anderen Scope (anwendungsweit, pro Collection, pro Entity, pro Property) und einen anderen Teil der UI ab.

Dieser Leitfaden hilft Ihnen, den richtigen Mechanismus für Ihren Anwendungsfall auszuwählen, und verlinkt anschließend auf die detaillierte Referenz des jeweiligen Mechanismus.

:::tip[Mit dem Modell beginnen, nicht mit der Liste]
Jeder der folgenden Mechanismen ist im Kern dasselbe: eine React-Komponente, die an einer bestimmten Stelle platziert wird. [Customizing the Admin](/docs/frontend/customizing) erklärt dieses Modell auf einer einzigen Seite – Bausteine, Hooks, Orte – mit erprobten Rezepten für ein Einstellungs-Singleton, Einstellungen pro Benutzer, eine Bulk-Aktion, eine Kalenderansicht, ein Dashboard und einen benutzerdefinierten Login-Bildschirm. Lesen Sie dies zuerst; kehren Sie hierher zurück, um den passenden Ort auszuwählen.
:::

Alles hier betrifft das **Admin-Panel**. Für den Server – Einschränken eines Lesevorgangs, Hinzufügen einer Route, Einbetten des Treibers in Ihren eigenen Prozess, `rebase eject` – siehe [Rebase doesn't do X](/docs/backend/extending), was die entsprechende Übersichtstabelle für das Backend darstellt.

## Entscheidungstabelle

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Ich möchte… | Mechanismus | Scope | Referenz |
|---|---|---|---|
| Die App-Leiste ersetzen | `components` (`Shell.AppBar`) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Die Login-Seite ersetzen | `components` (`Auth.LoginView`) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Die Startseite ersetzen | `components` (`HomePage`) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Das Erscheinungsbild des Formulars einer Tabelle vollständig ändern | `formView` in `customizeTable` | table | [unten](#formview) |
| Eine Komponente innerhalb der Collection einer Tabelle austauschen | `components` in `customizeTable` | table | [Component Overrides](/docs/frontend/component-overrides#collection-level-component-overrides) |
| Standard-Komponenten-Overrides für alle Collections festlegen | `components` (Collection-bezogene Namen) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Einen Button zur Collection-Symbolleiste hinzufügen | `Actions` in `customizeTable` | table | [Entity Actions](/docs/frontend/entity-actions#collection-actions) |
| UI an einem Slot der Collection-Symbolleiste einfügen | `collection.actions` slot | app/plugin | [Slots](/docs/frontend/slots) |
| Einer Tabelle eine berechnete Spalte hinzufügen | `additionalFields` in `customizeTable` | table | [Additional Columns](/docs/frontend/additional-columns) |
| Das Steuerelement eines Feldes ersetzen | `Field` in `customizeTable` | field | [Custom Fields](/docs/frontend/custom-fields) |
| Einen wiederverwendbaren Feldtyp registrieren | `propertyConfigs` | app | [Custom Fields](/docs/frontend/custom-fields#a-reusable-field-type) |
| Einen Entity-Tab hinzufügen | `entityViews` in `customizeTable` | entity | [Entity Views](/docs/frontend/entity-views) |
| Die Zeilen einer Tabelle auf andere Weise rendern | `customViews` in `customizeTable` | table | [unten](#benutzerdefinierte-ansichtsmodi) |
| Eine Zeilen-/Kontextaktion oder einen Entity-Button hinzufügen | `entityActions` in `customizeTable` | entity | [Entity Actions](/docs/frontend/entity-actions) |
| Eine Kennzahl auf der Startseitenkarte einer Collection platzieren | `home.card.widget` slot | app/plugin | [Slots](/docs/frontend/slots) |
| UI an einer bestimmten Position des UI-Rahmens (Chrome) einfügen | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Mehrere Erweiterungen als eine installierbare Einheit bereitstellen | `plugins` | app | [Plugins](/docs/plugins) |
| Das soeben Erstellte stylen | `@rebasepro/ui` + Theme-Tokens | any | [Styling Custom UI](/docs/frontend/styling) |

:::tip[Was auch immer Sie wählen: Bauen Sie es aus dem Kit]
Jeder der folgenden Mechanismen stellt Ihnen eine React-Komponente bereit und macht keine Vorgaben darüber, womit Sie sie füllen. Verwenden Sie `@rebasepro/ui`-Komponenten und die Farb-Tokens des Themes statt selbstgeschriebenem CSS – eine benutzerdefinierte Ansicht ist immer noch eine Admin-Ansicht, und eine fest verdrahtete Farbe ist in einem der beiden Themes unsichtbar. Siehe [Styling Custom UI](/docs/frontend/styling).
:::

## Mechanismen im Detail

### Plugins

<span class="since-badge" data-since="0.31">Since 0.31</span>

**Scope:** app.

Ein Plugin bündelt injizierte oder modifizierte Collections, Views, Slot-Beiträge, Feld-Wrapper, Provider, Hooks und Lifecycle-Callbacks in einer einzigen installierbaren Einheit. Komponenten-Overrides, Entity-Views, Entity-Aktionen und `propertyConfigs` sind keine Plugin-Felder: Sie werden an `<Rebase>` oder im `customizeTable` einer Tabelle übergeben.

→ [Plugins-Referenz](/docs/plugins)

### Slots

**Scope:** app (pro Slot beigetragen).

Slots sind benannte UI-Erweiterungspunkte, die über die gesamte CMS-Oberfläche (Chrome) verteilt sind. Sie registrieren eine React-Komponente für einen Slot-Namen, und diese wird an dieser Stelle gerendert. Es gibt 27 Slots, die die Startseite, die Navigation, Collection-Views, Formulare, Entity-Zeilen, Formularfelder und die App-Leiste abdecken – und jeder einzelne davon wird gerendert.

→ [Slots-Referenz](/docs/frontend/slots)

### Komponenten-Overrides (Swizzling)

**Scope:** Defaults auf App-Ebene oder pro Collection.

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

**Rangfolge:** Die `components` einer Tabelle werden auf die Standardwerte auf App-Ebene für denselben Komponentennamen angewendet: Ein Ersatz auf Collection-Ebene ersetzt beide, und ein Collection-Override mit `wrap: true` umschließt den Override auf App-Ebene. Nur auf App-Ebene verfügbare Komponentennamen (`Shell.*`, `HomePage`, `Auth.*`) können nur auf Ebene von `<Rebase>` überschrieben werden.

→ [Component Overrides](/docs/frontend/component-overrides)

### Entity Views

<span class="since-badge" data-since="0.31">Since 0.31</span>

**Scope:** entity (fügt Tabs hinzu).

Benutzerdefinierte Ansichten, die als Tabs auf der Entity-Detailseite erscheinen. Definiert pro Tabelle in `customizeTable` oder einmalig unter `<Rebase entityViews>` (oder `<RebaseCMS entityViews>`) registriert und über den `key` in den `entityViews` einer Tabelle referenziert.

→ [Entity Views](/docs/frontend/entity-views)

### Entity Actions

<span class="since-badge" data-since="0.31">Since 0.31</span>

**Scope:** entity.

Benutzerdefinierte Aktions-Buttons für einzelne Entities (Veröffentlichen, Archivieren, Klonen usw.). Definiert pro Tabelle in `customizeTable` oder einmalig unter `<Rebase entityActions>` (oder `<RebaseCMS entityActions>`) registriert und über den `key` in den `entityActions` einer Tabelle referenziert.

→ [Entity Actions](/docs/frontend/entity-actions)

### Collection `Actions`

**Scope:** collection.

React-Komponenten auf Symbolleistenebene, die `CollectionActionsProps` empfangen (ausgewählte Entities, Table-Controller, Collection-Kontext). Werden in der Collection-Symbolleiste neben den integrierten Aktionen gerendert.

**Verhältnis zum Slot `collection.actions`:** Beide sind additiv – `Actions`-Komponenten werden zuerst in der Symbolleiste gerendert, gefolgt von Slot-Beiträgen aus `collection.actions`. Sie ersetzen einander nicht.

→ [Entity Actions — Collection Actions](/docs/frontend/entity-actions#collection-actions)

### Benutzerdefinierte Ansichtsmodi

<span class="since-badge" data-since="0.31">Since 0.31</span>
**Scope:** collection (fügt einen Ansichtsmodus hinzu).

Eine Karte, ein Kalender, eine Galerie, eine Zeitleiste – eine alternative Darstellung *derselben Zeilen*, angeboten im Ansichtsumschalter der Collection neben Liste, Tabelle, Karten und Board.

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

Oder registrieren Sie die Komponente einmalig und benennen Sie sie per Schlüssel, wodurch sie auch im Collection-Editor auswählbar wird:

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

`Builder` erhält den aktiven `tableController`, sodass die Ansicht die Filter der Collection, das Suchfeld, Sortierung, Paginierung, Berechtigungsprüfungen und das Entity-Seitenpanel erbt – genau das ist der Grund, einen solchen Ansichtsmodus zu deklarieren, anstatt eine `AppView` zu erstellen:

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

Die Zeilen stammen vom Server und haben die von `useRows` zurückgegebene Struktur: Daten als ISO-Strings, ein `belongsTo` als Fremdschlüsselspalte und eine von der Ansicht geladene Relation, die unter ihrem Namen verschachtelt ist. Eine Zeile hat nur dann eine `id`-Spalte, wenn ihre Tabelle eine besitzt; ihre ID steht daneben, `tableController.ids[i]` für `tableController.rows[i]`. `highlightedIds` sind die IDs der Zeilen, die die Ansicht als ausgewählt darstellt, und `selectionController` arbeitet ebenfalls mit IDs und Zeilen:

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

Das Auswählen der Ansicht aktualisiert `?__view=`, bleibt bei einem Neuladen erhalten und wird pro Benutzer gespeichert. Die Deklaration reicht aus, um sie anzubieten – `enabledViews` muss nur gesetzt werden, wenn Sie *integrierte Ansichten entfernen* möchten. Bei einem einzelnen Eintrag wird der Umschalter ausgeblendet.

**Dies ist keine Möglichkeit, eine sammlungsübergreifende Ansicht zu erstellen.** Ein Ansichtsmodus ist eine weitere Darstellung der Abfrage einer einzelnen Collection. Wenn Ihre Komponente den `tableController` ignoriert und selbst vier Tabellen abfragt, sollte sie eine [`AppView`](/docs/frontend#custom-views) sein – die Symbolleiste darüber mit ihrem Suchfeld und der Datensatzanzahl würde eine Abfrage beschreiben, die sie gar nicht rendert.

### `formView`

<span class="since-badge" data-since="0.31">Since 0.31</span>
**Scope:** collection.

Ersetzt das gesamte Standard-Entity-Formular durch eine benutzerdefinierte Komponente, festgelegt mit `formView: { Builder, includeActions }` in `customizeTable`; siehe [Replacing the form](/docs/frontend/form-layout/#replacing-the-form). `includeActions` (Standardwert `true`) behält Speichern und Verwerfen in der Leiste bei.

Verwenden Sie dies, wenn Sie ein vollständig benutzerdefiniertes Layout für die Bearbeitung der Datensätze einer Tabelle benötigen. Für kleinere Anpassungen sollten Sie stattdessen den `Entity.Form`-Override in `components` bevorzugen.

Der Builder wird innerhalb des Formulars des Datensatzes gerendert und erhält dessen aktiven `formContext`: Schreiben Sie mit `formContext.setFieldValue`, und die Speichern-Schaltfläche der Leiste speichert den Datensatz. Wenn der Datensatz nicht bearbeitet werden kann – in der schreibgeschützten Detailansicht oder bei einem Benutzer ohne Bearbeitungsberechtigung –, ist `formContext.disabled` gleich `true` und Schreibvorgänge werfen Fehler. Setzen Sie `includeActions: false`, wenn Ihr Builder selbst über `formContext.submit()` speichert.

### `additionalFields`

**Scope:** collection.

Berechnete Spalten, die in der Collection-Tabelle angezeigt werden. Sie entsprechen keinen gespeicherten Spalten, sondern werden zur Renderzeit berechnet.

→ [Additional Columns](/docs/frontend/additional-columns)

### `propertyConfigs`

**Scope:** Property-Typ.

Wiederverwendbare Feldtypen, die einmalig unter `<Rebase propertyConfigs>` registriert und über die `propertyConfig` eines Feldes referenziert werden.

→ [Custom Fields](/docs/frontend/custom-fields)

## Nicht das Admin-Panel

Wenn das, was Sie ändern möchten, das Serververhalten betrifft und nicht das, was das Panel anzeigt, sind Sie hier auf der falschen Seite. Der Server hat seine eigene Staffelung:

| Ich möchte… | Stufe | Referenz |
|---|---|---|
| Einschränken, welche Zeilen ein Lesevorgang zurückgibt | `beforeQuery`-Hook | [Extending the server](/docs/backend/extending#2-table-hooks) |
| Einen Wert bei der Ausgabe schwärzen/entfernen | `afterRead`-Hook | [Table hooks](/docs/collections/callbacks) |
| Einen eigenen Endpunkt hinzufügen | Eigene Funktion | [Custom Functions](/docs/backend/custom-functions) |
| Dafür sorgen, dass die Suche Teilstrings findet *und* Akzente ignoriert | `search.mode: "hybrid"` | [Search](/docs/backend/search) |
| Die volle Kontrolle über den Serverprozess übernehmen | Eigener Server, dann `rebase eject` | [Extending the server](/docs/backend/extending) |

→ [Rebase doesn't do X](/docs/backend/extending)

## Zusammenfassung der Rangfolge

<span class="since-badge" data-since="0.31">Since 0.31</span>

- **Die `components` einer Tabelle haben Vorrang vor globalen `components`** innerhalb ihrer Collection. Ein Ersatz auf Collection-Ebene ersetzt beide; ein Override mit `wrap: true` auf Collection-Ebene umschließt den globalen Override, falls vorhanden. Siehe [Component Overrides](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Collection-`Actions` und der `collection.actions`-Slot sind additiv** – `Actions` werden zuerst gerendert, danach die Slot-Beiträge.
- **`entityActions` und `entityViews` auf App-Ebene sind eine Registry, keine Standardwerte:** Eine Tabelle zeigt ein Element nur an, wenn ihre eigenen `entityActions` / `entityViews` in `customizeTable` dessen `key` benennen.
- **Plugins werden in der Reihenfolge des `plugins`-Arrays angewendet**, nicht nach `key`. Slot-Beiträge werden nach ihrer `order` gerendert (niedrigere zuerst, standardmäßig 50), und bei Gleichstand bleibt diese Reihenfolge erhalten. Feld-Wrapper aus mehreren Plugins komponieren sich in dieser Reihenfolge, wobei der des ersten Plugins der innerste ist. Siehe [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
