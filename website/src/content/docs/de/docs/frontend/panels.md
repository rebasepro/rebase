---
sourceHash: a33ca593ee016656
title: Panels auf einer eigenen Seite
sidebar_label: Panels auf eigenen Seiten
description: "Zeigen Sie eine Collection, das Formular eines Datensatzes, einen Datensatz oder einen einzelnen Wert auf einer eigenen Seite an: CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue und CollectionsProvider, ganz ohne Admin-Shell darum herum."
---

Unter 0.24
akzeptiert `CollectionPanel` nur einen registrierten `path` und rendert außerhalb des vollständigen Admin-Baums „Collection not found“, und `EntityFormPanel` sowie `CollectionsProvider` existieren nicht.

Sie benötigen nicht den gesamten Admin-Bereich, um eine Tabelle anzuzeigen. `<CollectionPanel>` nimmt die Collection als Wert entgegen und funktioniert überall unter `<Rebase>` und einem React-Router-Router, ganz ohne `<RebaseCMS>`, `<RebaseNavigation>` oder `<RebaseShell>`:

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { CollectionPanel } from "@rebasepro/cms";
import { postsCollection } from "../config/collections/posts";
// Plus BrowserRouter, or any other router, from "react-router".

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            <BrowserRouter>
                <MyPageLayout>
                    <CollectionPanel collection={postsCollection}/>
                </MyPageLayout>
            </BrowserRouter>
        </Rebase>
    );
}
```

Ein Datensatz öffnet sich über Ihrer Seite, in einem Seitenpanel oder einem Dialog, und niemals per URL: Da keine Admin-Route die Seite bedient, öffnen sich `full_screen` und `split` als Seitenpanel, und `useUrlController().routesMounted` ist für Ihre eigenen Komponenten dort `false`. Jeder Router funktioniert: ein einfacher `<BrowserRouter>`, ein `<MemoryRouter>` oder ein Data Router. Ein Router ist dennoch erforderlich. Ein Data Router ermöglicht es einem Datensatz mit ungespeicherten Änderungen zudem, die In-App-Navigation zu stoppen; bei den anderen schützt lediglich die Verlassen-Warnung des Browsers davor. Umschließen Sie das Panel mit `<RebaseAuthGate>`, wenn die Seite zuerst die Rebase-Anmeldung anzeigen soll.

## Was ein Panel anzeigt

<span class="since-badge" data-since="0.29">Seit 0.29</span>
Ein Panel stellt die Collection genauso dar wie der Admin-Bereich. Diese Props schränken sie auf das ein, was Ihre Seite benötigt; keine davon verändert die eigene Seite der Collection.

```tsx
import {
    CollectionAddButton,
    CollectionFiltersButton,
    CollectionPanel,
    CollectionSearchBar,
    CollectionToolbar
} from "@rebasepro/cms";

<CollectionPanel
    collection={ordersCollection}
    viewMode="cards"
    fields={["number", "status", "total"]}
    toolbar={<CollectionToolbar
        start={<CollectionFiltersButton/>}
        end={<><CollectionSearchBar/><CollectionAddButton/></>}/>}
    onRowClick={(order, id) => setSelected(id)}
    className="max-h-[480px]"/>
```

- `fields` — die Eigenschaften, die es anzeigt, in genau dieser Reihenfolge und sonst nichts. In der Tabelle sind dies die Spalten. In der Liste, auf einer Karte und auf einer Kanban-Karte sind sie das, woraus die Positionen der Zeile — Titel, Bild, Untertitel, Status, Datum, Relations-Chips, die Spalten der Liste — gefüllt werden, frühere zuerst; ein Platz, den keine davon füllt, bleibt leer. Für dieses Panel hat dies Vorrang vor `propertiesOrder`, der von einem Benutzer gespeicherten Spaltenreihenfolge und `listProperties`. Vom Benutzer geänderte Spaltenbreiten bleiben weiterhin persistent; die Reihenfolge wird von Ihnen vorgegeben, daher können Spalten nicht per Drag-and-Drop verschoben werden.
- `toolbar` — standardmäßig die vollständige Toolbar, `null` für keine oder eine, die aus ihren Bestandteilen zusammengesetzt ist: `CollectionToolbar` (mit `start` und `end`), `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle` und `CollectionAddButton`. Sie greifen auf das Panel zu, in dem sie gerendert werden, und werfen an anderer Stelle einen Fehler. Plugin-Slots und der `Collection.Actions`-Override befinden sich in der Standard-Toolbar.
- `onRowClick` — wird mit der angeklickten Zeile und deren ID aufgerufen, anstatt dass das Panel sie öffnet; ausgelöst über eine Zeile, eine Karte, eine Kanban-Karte und die Bearbeitungsaktion. Die Zeile entspricht der vom Server gesendeten Struktur, die auch `useRows`, `useRow` und `<FieldValue>` annehmen: exakt deren Spalten, ISO-Datumsstrings (`YYYY-MM-DD` für eine reine Datumsspalte) und eine belongsTo-Relation als deren Fremdschlüssel (`customerId`). Eine Relation, deren Ziel das Panel geladen hat, wird verschachtelt unter ihrem Namen übergeben, so wie es RESTs `include` zurückgibt (`order.customer` ist die Zeile des Kunden); ihr Fremdschlüssel ist ebenfalls dort vorhanden. Die ID ist der String, über den der Admin den Datensatz adressiert — sein Primärschlüssel, bei einem zusammengesetzten Schlüssel die Teile mit `:::` verknüpft —, den `highlightedIds` und `useSidePanel().open` entgegennehmen. `row.id` ist die `id`-Spalte des Datensatzes, sofern die Tabelle eine hat, mit dem Typ dieser Spalte: `5` für einen Integer-Schlüssel, dessen ID `"5"` lautet.
- `highlightedIds` — die IDs der Zeilen, die als ausgewählt dargestellt werden, beispielsweise die Zeile, die eine Seite neben der Liste anzeigt: `highlightedIds={selected ? [selected] : []}`. `[]` hebt keine hervor. Ohne diese Angabe hebt das Panel die zuletzt geöffnete Zeile hervor. IDs werden als Strings verglichen, sodass `5` und `"5"` bei einem Integer-Schlüssel dieselbe Zeile bezeichnen.
- `viewMode` — der Modus, in dem es geöffnet wird, mit Vorrang vor dem in der URL und dem, den die Person zuletzt ausgewählt hat. Ein Umschalten ist weiterhin möglich.
- `title={false}` — kein Titel über dem Panel und auch keine eigene Überschrift der Listenansicht.
- `updateUrl` — standardmäßig deaktiviert: Das Panel liest und schreibt weder die `__view`-, Filter- noch die Sortierparameter der Seite.

Die `entityActions` der Collection werden auf jeder Zeile, Karte und Kanban-Karte gerendert – als Buttons, wenn `collapsed: false` deklariert ist, und ansonsten im Zeilenmenü; ein „Genehmigen“ auf jeder Karte ist eine solche Aktion.

Ein Panel passt seine Größe an seine Zeilen an. Wenn vom Elternelement keine Höhe oder nur eine `max-height` vorgegeben ist, rendert eine kurze Collection ihre Toolbar sowie Zeilen, und eine lange scrollt innerhalb des verfügbaren Platzes, maximal bis zur Fensterhöhe. Weisen Sie ihm eine Höhe zu, um den Raum auszufüllen. Das Layout richtet sich nach seiner eigenen Breite, nicht nach der des Fensters: In einer schmalen Spalte verwendet es sein kompaktes Layout, unabhängig vom Bildschirm.

`propertiesOrder` ändert lediglich die Reihenfolge und blendet niemals aus: Eine Eigenschaft, die ausgelassen wird, wird nach den benannten Eigenschaften gerendert. Um eine Eigenschaft überall auszublenden, setzen Sie `admin.hideFromCollection` darauf; um an einer Stelle nur ausgewählte anzuzeigen, übergeben Sie `fields`.

## Formular eines einzelnen Datensatzes

`<EntityFormPanel>` macht dasselbe für das Formular eines einzelnen Datensatzes. Es lädt den Datensatz anhand der `id`, speichert ihn über die Datenebene von `<Rebase>`, genau wie es das eigene Formular des Admin-Bereichs tut, und ruft `onSaved` nach jedem Speichern mit dem gespeicherten Datensatz auf, wie der Server die Zeile sendet: `row` und deren `id`. Lassen Sie `id` weg, um einen Datensatz zu erstellen. `onClose` wird aufgerufen, wenn das Formular verlassen werden soll, beispielsweise nachdem der Datensatz gelöscht wurde:

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Wenn jemand anderes den Datensatz löscht, während das Formular geöffnet ist, behält das Formular die eingegebenen Daten und weist darauf hin, dass der Datensatz an anderer Stelle gelöscht wurde. Die Aktion „Als neu speichern“ wandelt es in ein Formular um, das einen neuen Datensatz mit diesen Werten erstellt; `onSaved` meldet anschließend den neuen Datensatz.

<span class="since-badge" data-since="0.29">Seit 0.29</span> Das Formular kann einen Teil eines Datensatzes anzeigen oder nach Ihren Wünschen angeordnet werden. `fields` zeigt nur die genannten Felder in dieser Reihenfolge an; Abschnitte und die Seitenleiste (Rail) behalten ihre Gruppierung bei. `layout` ersetzt die generierten Felder durch Ihr eigenes JSX, in dem `<FormField name="…"/>` ein Feld mit der Beschriftung, Größe und den Regeln darstellt, die das generierte Formular vorsieht:

```tsx
import { EntityFormPanel, FormField } from "@rebasepro/cms";

<EntityFormPanel
    collection={ordersCollection}
    id={orderId}
    layout={<div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
        <div className="col-span-2"><FormField name="notes"/></div>
    </div>}/>
```

In beiden Fällen validiert das Formular nur die angezeigten Felder; der Server prüft weiterhin den gesamten Datensatz. Ein Formular, das einen Datensatz erstellt und ein Pflichtfeld ohne Standardwert auslässt, weist beim Öffnen darauf hin: Eine Fehlermeldung nennt das Feld, und das Speichern bleibt blockiert, bis das Feld angezeigt oder mit einem Standardwert versehen wird. `collectionOverrides` ändert die Collection nur für dieses Formular, genau wie bei `CollectionPanel`.

Jedes Formular isoliert seine DOM-IDs (Scoped IDs), sodass sich zwei Formulare eine Seite teilen können. Um ein Feld aus einem Test heraus zu finden, wählen Sie `[data-form-field="title"]` innerhalb des Formulars `[data-form-path="posts"]` aus.

<span class="since-badge" data-since="0.29">Seit 0.29</span>
`<EntityViewPanel>` ist das schreibgeschützte Gegenstück zu `EntityFormPanel`. Es lädt den Datensatz anhand der `id` und stellt ihn so dar, wie es die Datensatzseite des Admin-Bereichs tut: mit denselben Abschnitten und Labels, wobei jeder Wert als Vorschau gerendert wird – ein Enum erscheint als Chip, ein Datum in seiner Zeitzone und eine Relation als Titel des Zielobjekts. Es nimmt `fields` und `collectionOverrides` wie das Formular entgegen und lässt die Felder aus, die auch das Formular auslässt: Felder, die eine `conditions.hidden`-Regel für diesen Datensatz verbirgt, sowie Felder, die der angemeldete Benutzer nicht lesen darf.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` stellt einen einzelnen Wert auf die gleiche Weise innerhalb Ihres eigenen JSX dar. Es übernimmt die gesamte Zeile, wie sie von `useRows`, `useRow` und `client.data` zurückgegeben wird, da eine belongsTo-Relation unter ihrer Fremdschlüsselspalte (`customerId`) und nicht unter dem Eigenschaftsnamen eintrifft; `field="customer"` findet sie dort. Die Collection muss darüber registriert sein, entweder über `<RebaseCMS>` oder einen `CollectionsProvider`. Eine unbekannte Collection oder ein unbekanntes Feld wirft einen Fehler, der den Namen angibt.

```tsx
import { useRows } from "@rebasepro/app";
import { FieldValue } from "@rebasepro/cms";

function OrderList() {
    const { rows } = useRows("orders", { limit: 20 });
    return rows.map(row => (
        <div key={String(row.id)} className="flex gap-4">
            <FieldValue row={row} collection="orders" field="customer"/>
            <FieldValue row={row} collection="orders" field="status"/>
            <FieldValue row={row} collection="orders" field="placedAt"/>
        </div>
    ));
}
```

## Mehrere Panels in einem Scope

Die drei Panels bringen ihren eigenen `CollectionsProvider` mit, wenn sich übergeordnet keiner befindet. Das ist die darunterliegende Ebene, und Sie können sie selbst mounten, um einen gemeinsamen Scope für mehrere Panels zu nutzen oder tieferliegende Bausteine (`CollectionViewBinding`, `useSidePanel`) darunter zu verwenden. Innerhalb dieses Scopes kann ein Panel seine Collection per `path` angeben:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` verwaltet eine Registry der übergebenen Collections, wobei `modifyCollection` und `injectCollections` Ihrer Plugins wie im Admin-Bereich angewendet werden, sowie die Seitenpanels und Dialoge, in denen Datensätze geöffnet werden, und den Schutz vor ungespeicherten Änderungen. Halten Sie das `collections`-Array stabil: als Modulkonstante oder via `useMemo`.

## Nächste Schritte

- [Den Admin-Bereich anpassen](/docs/frontend/customizing): Wo eigene Komponenten platziert werden können und Anleitungen, die auf diesen Panels basieren.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` und `useRowWrites`, die Zeilen, die diese Panels und `FieldValue` auslesen.
- [Komponenten-Overrides](/docs/frontend/component-overrides): Ersetzen Sie die Ansicht oder das Formular, das ein Panel darstellt.
