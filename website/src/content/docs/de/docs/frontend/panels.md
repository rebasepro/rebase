---
sourceHash: 29030083cf83fb27
title: Panels in einer eigenen Seite
sidebar_label: Panels in eigenen Seiten
description: "Zeigen Sie eine Collection, das Formular eines Datensatzes, einen Datensatz oder einen einzelnen Wert in einer eigenen Seite an: CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue und CollectionsProvider, ganz ohne Admin-Shell darum herum."
---

Unter 0.24
akzeptiert `CollectionPanel` nur einen registrierten `path` und rendert außerhalb des vollständigen Admin-Baums „Collection not found“, und `EntityFormPanel` sowie `CollectionsProvider` existieren nicht.

Sie benötigen nicht den gesamten Admin-Bereich, um eine einzelne Tabelle anzuzeigen. `<CollectionPanel>` akzeptiert die Collection als Wert und funktioniert überall unter `<Rebase>` und einem React-Router-Router, ganz ohne `<RebaseCMS>`, `<RebaseNavigation>` oder `<RebaseShell>`:

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

Ein Datensatz öffnet sich über Ihrer Seite, in einem Seiten-Panel oder einem Dialog, und niemals per URL: Da keine Admin-Route die Seite bedient, öffnen sich `full_screen` und `split` als Seiten-Panel, und `useUrlController().routesMounted` ist für Ihre eigenen Komponenten dort `false`. Jeder Router funktioniert: ein einfacher `<BrowserRouter>`, ein `<MemoryRouter>` oder ein Daten-Router. Ein Router ist dennoch erforderlich. Ein Daten-Router ermöglicht es zudem, dass ein Datensatz mit ungespeicherten Änderungen die In-App-Navigation stoppt; bei den anderen schützt davor nur der Standard-Verlassen-Dialog des Browsers. Umschließen Sie das Panel mit `<RebaseAuthGate>`, falls die Seite zuerst den Login-Bildschirm von Rebase anzeigen soll.

## Was ein Panel anzeigt

<span class="since-badge" data-since="0.29">Seit 0.29</span>
Ein Panel stellt die Collection so dar, wie es auch der Admin-Bereich tut. Diese Props schränken die Anzeige auf das ein, was Ihre Seite benötigt; keine davon verändert die eigene Seite der Collection.

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
    onRowClick={(order) => setSelected(order.id)}
    className="max-h-[480px]"/>
```

- `fields` — die Eigenschaften, die angezeigt werden, in dieser Reihenfolge und nichts anderes. In der Tabelle sind dies die Spalten. In der Liste, auf einer Karte und auf einer Kanban-Karte sind sie das, womit die Plätze der Zeile — Titel, Bild, Untertitel, Status, Datum, Relations-Chips, die Spalten der Liste — befüllt werden, frühere zuerst; ein Platz, den keines davon ausfüllt, bleibt leer. Bei diesem Panel hat dies Vorrang vor `propertiesOrder`, der von einem Benutzer gespeicherten Spaltenreihenfolge und `listProperties`. Von Benutzern per Drag-and-Drop veränderte Spaltenbreiten bleiben weiterhin erhalten; die Reihenfolge wird von Ihnen vorgegeben, daher können Spalten nicht verschoben werden.
- `toolbar` — standardmäßig die vollständige Toolbar, `null` für keine, oder eine aus ihren Einzelteilen zusammengestellte Toolbar: `CollectionToolbar` (mit `start` und `end`), `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle` und `CollectionAddButton`. Diese lesen das Panel aus, in dem sie gerendert werden, und werfen an anderer Stelle einen Fehler. Plugin-Slots und der `Collection.Actions`-Override befinden sich in der Standard-Toolbar.
- `onRowClick` — wird mit der angeklickten Zeile aufgerufen, anstatt dass das Panel sie öffnet; dies gilt für Zeilen, Karten, Kanban-Karten und die Bearbeiten-Aktion. Die Zeile entspricht dem Format, das der Server sendet, also der Struktur, die `useRows`, `useRow` und `<FieldValue>` annehmen: ISO-Datums-Strings (`YYYY-MM-DD` für eine reine Datumsspalte) und eine belongsTo-Relation als deren Fremdschlüssel (`customerId`), nicht unter dem Namen der Relation.
- `viewMode` — der Modus, in dem es geöffnet wird, mit Vorrang vor dem in der URL und dem, den die Person zuletzt ausgewählt hat. Ein Wechsel ist weiterhin möglich.
- `title={false}` — kein Titel über dem Panel und auch nicht die eigene Überschrift der Listenansicht.
- `updateUrl` — standardmäßig deaktiviert: Das Panel liest oder schreibt weder die `__view`-, Filter- noch die Sortierparameter der Seite.

Die `entityActions` der Collection werden auf jeder Zeile, Karte und Kanban-Karte gerendert: als Buttons, wenn sie als `collapsed: false` deklariert sind, und andernfalls im Menü der Zeile — ein „Approve“ auf jeder Karte ist eine Aktion.

Ein Panel passt seine Größe an seine Zeilen an. Ohne Höhenangabe des übergeordneten Elements oder nur mit einem `max-height` rendert eine kurze Collection ihre Toolbar sowie Zeilen, und eine lange scrollt innerhalb des verfügbaren Platzes, bis hin zur Fensterhöhe. Geben Sie ihm eine Höhe, um diesen Bereich auszufüllen. Es richtet sein Layout nach seiner eigenen Breite aus, nicht nach der des Fensters: In einer schmalen Spalte verwendet es sein kompaktes Layout, unabhängig vom Bildschirm.

`propertiesOrder` ändert die Reihenfolge und blendet niemals etwas aus: Eine Eigenschaft, die ausgelassen wird, wird nach den genannten gerendert. Um eine Eigenschaft überall auszublenden, setzen Sie `admin.hideFromCollection` darauf; um an einer Stelle nur bestimmte anzuzeigen, übergeben Sie `fields`.

## Das Formular eines einzelnen Datensatzes

`<EntityFormPanel>` tut dasselbe für das Formular eines einzelnen Datensatzes. Es lädt den Datensatz anhand der `entityId`, speichert ihn über die Datenschicht von `<Rebase>`, genau wie das eigene Formular des Admin-Bereichs, und ruft nach jedem Speichern `onSaved` auf. Lassen Sie `entityId` weg, um einen Datensatz zu erstellen. `onClose` wird aufgerufen, wenn das Formular signalisiert, verlassen zu werden, beispielsweise nachdem sein Datensatz gelöscht wurde:

```tsx
<EntityFormPanel
    collection={postsCollection}
    entityId={postId}
    onSaved={({ entity }) => console.log("saved", entity.id)}
    onClose={() => navigate("/posts")}/>
```

Wenn jemand anderes den Datensatz löscht, während das Formular geöffnet ist, behält das Formular die eingegebenen Daten bei und meldet, dass der Datensatz an anderer Stelle gelöscht wurde. Seine Aktion „Save as new“ verwandelt es in ein Formular, das einen neuen Datensatz mit diesen Werten erstellt; `onSaved` meldet anschließend den neuen Datensatz.

<span class="since-badge" data-since="0.29">Seit 0.29</span> Das Formular kann einen Teil eines Datensatzes anzeigen oder ihn nach Ihren Wünschen anordnen. `fields` zeigt nur die darin genannten Felder in dieser Reihenfolge an; Abschnitte und die Rail behalten ihre Gruppierung. `layout` ersetzt die generierten Felder durch Ihr eigenes JSX, in dem `<FormField name="…"/>` ein einzelnes Feld mit der Beschriftung, Größe und den Regeln rendert, die das generierte Formular dafür vorgibt:

```tsx
import { EntityFormPanel, FormField } from "@rebasepro/cms";

<EntityFormPanel
    collection={ordersCollection}
    entityId={orderId}
    layout={<div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
        <div className="col-span-2"><FormField name="notes"/></div>
    </div>}/>
```

In beiden Fällen validiert das Formular nur die Felder, die es anzeigt; der Server prüft weiterhin den gesamten Datensatz. Ein Formular, das einen Datensatz erstellt und ein Pflichtfeld ohne Standardwert auslässt, weist beim Öffnen darauf hin: Ein Fehler benennt das Feld, und das Speichern bleibt blockiert, bis das Feld angezeigt oder mit einem Standardwert versehen wird. `collectionOverrides` ändert die Collection nur für dieses Formular, genau wie bei `CollectionPanel`.

Jedes Formular isoliert seine DOM-IDs, sodass sich zwei Formulare eine Seite teilen können. Um ein Feld aus einem Test heraus zu finden, selektieren Sie `[data-form-field="title"]` innerhalb des `[data-form-path="posts"]` des Formulars.

<span class="since-badge" data-since="0.29">Seit 0.29</span>
`<EntityViewPanel>` ist das schreibgeschützte Gegenstück zu `EntityFormPanel`. Es lädt den Datensatz anhand der `entityId` und stellt ihn so dar, wie es die Datensatzseite des Admin-Bereichs tut: dieselben Abschnitte und Beschriftungen, wobei jeder Wert als Vorschau gerendert wird, sodass ein Enum als Chip, ein Datum in seiner Zeitzone und eine Relation als Titel des Ziels angezeigt wird. Es akzeptiert `fields` und `collectionOverrides` wie das Formular und lässt die Felder aus, die auch das Formular auslässt: solche, die eine `conditions.hidden`-Regel für diesen Datensatz verbirgt, und solche, die der angemeldete Benutzer nicht lesen darf.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    entityId={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` rendert einen einzelnen Wert auf die gleiche Weise innerhalb Ihres eigenen JSX. Es akzeptiert die gesamte Zeile, wie sie von `useRows`, `useRow` und `client.data` zurückgegeben wird, da eine belongsTo-Relation unter ihrer Fremdschlüsselspalte (`customerId`) ankommt, nicht unter dem Namen der Eigenschaft; `field="customer"` findet sie dort. Es erfordert, dass die Collection darüber registriert ist, entweder über `<RebaseCMS>` oder einen `CollectionsProvider`. Eine unbekannte Collection oder ein unbekanntes Feld wirft einen Fehler, der den Namen nennt.

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

Die drei Panels bringen ihren eigenen `CollectionsProvider` mit, wenn sich keiner über ihnen befindet. Das ist der darunterliegende Schritt, und Sie können ihn selbst einbinden, um einen Scope von mehreren Panels gemeinsam nutzen zu lassen oder um die tieferliegenden Bausteine (`CollectionViewBinding`, `useSidePanel`) darunter zu verwenden. Innerhalb dieses Scopes kann ein Panel seine Collection über `path` angeben:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` enthält eine Registry der Collections, die Sie ihm übergeben, wobei `modifyCollection` und `injectCollections` Ihrer Plugins wie im Admin-Bereich angewendet werden, zuzüglich der Seiten-Panels und Dialoge, in denen Datensätze geöffnet werden, sowie des Schutzes vor ungespeicherten Änderungen. Halten Sie das `collections`-Array stabil: als Modul-Konstante oder per `useMemo`.

## Weiterführendes

- [Admin anpassen](/docs/frontend/customizing): An welchen Stellen eine eigene Komponente platziert werden kann und die Rezepte, die auf diesen Panels aufbauen.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` und `useRowWrites` – die Zeilen, die diese Panels und `FieldValue` lesen.
- [Komponenten-Overrides](/docs/frontend/component-overrides): Ersetzen Sie die Ansicht oder das Formular, das ein Panel anzeigt.
