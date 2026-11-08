---
sourceHash: 99297021573eef28
title: Panels auf einer eigenen Seite
sidebar_label: Panels auf eigenen Seiten
description: "Zeigen Sie eine Collection, das Formular eines Datensatzes, einen Datensatz oder einen einzelnen Wert auf einer eigenen Seite an: CollectionPanel, EntityFormPanel, RecordDetail, FieldValue und CollectionsProvider, ganz ohne Admin-Shell darum herum."
---

Auf 0.24
akzeptiert `CollectionPanel` nur einen registrierten `path` und rendert außerhalb des vollständigen Admin-Baums „Collection not found“, und `EntityFormPanel` sowie `CollectionsProvider` existieren nicht.

Sie benötigen nicht das gesamte Admin-Interface, um eine einzelne Tabelle anzuzeigen. `<CollectionPanel>` übernimmt die Collection als Wert und funktioniert überall unter `<Rebase>` und einem React-Router-Router, ganz ohne `<RebaseCMS>`, `<RebaseNavigation>` oder `<RebaseShell>`:

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

Ein Datensatz öffnet sich über Ihrer Seite, in einem Side-Panel oder einem Dialog, und niemals per URL: Da keine Admin-Route die Seite bereitstellt, öffnen sich `full_screen` und `split` als Side-Panel, und `useUrlController().routesMounted` ist für Ihre eigenen Komponenten dort `false`. Jeder Router funktioniert: ein einfacher `<BrowserRouter>`, ein `<MemoryRouter>` oder ein Data-Router. Ein Router ist dennoch erforderlich. Ein Data-Router ermöglicht es zudem, dass ein Datensatz mit ungespeicherten Änderungen die In-App-Navigation stoppt; bei den anderen greift nur der Leave-Page-Dialog des Browsers. Umschließen Sie das Panel mit `<RebaseAuthGate>`, falls die Seite zuerst den Rebase-Login anzeigen soll.

## Was ein Panel anzeigt

<span class="since-badge" data-since="0.29">Seit 0.29</span>
Ein Panel stellt die Collection so dar wie das Admin-Interface. Diese Props schränken sie auf das ein, was Ihre Seite benötigt; keine davon verändert die eigene Seite der Collection.

```tsx
import { CollectionPanel } from "@rebasepro/cms";
import { Button } from "@rebasepro/ui";

<CollectionPanel
    collection="orders"
    viewMode="table"
    fields={["number", "customer", "status", "total"]}
    where={{ status: ["==", "pending"] }}
    orderBy="placed_at:desc"
    toolbar="compact"
    rowActions={(order, id) => (
        <Button size="small" onClick={() => update("orders", id, { status: "shipped" })}>Ship</Button>
    )}
    onRowClick={(order, id) => setSelected(id)}
    className="max-h-[480px]"/>
```

`collection` nimmt den Namen der Collection entgegen, wie hier gezeigt, oder die Collection selbst als Wert (`collection={ordersCollection}`); `path` benennt sie ebenfalls und spricht eine Subcollection über ihren vollständigen Pfad an.

- `fields` — die Eigenschaften, die angezeigt werden, in dieser Reihenfolge und nichts anderes. In der Tabelle sind dies die Spalten. In der Liste, auf einer Karte und auf einer Kanban-Karte sind sie das, woraus die Positionen der Zeile – Titel, Bild, Untertitel, Status, Datum, Relations-Chips, die Spalten der Liste – gefüllt werden, frühere zuerst; eine Position, die von keinem davon ausgefüllt wird, bleibt leer. Für dieses Panel hat dies Vorrang vor `propertiesOrder`, der von einem Benutzer gespeicherten Spaltenreihenfolge und `listProperties`. Spaltenbreiten, die ein Benutzer per Drag & Drop anpasst, bleiben weiterhin erhalten; die Reihenfolge wird von Ihnen vorgegeben, daher können Spalten nicht verschoben werden.
- `toolbar` — `"full"`, der Standardwert; `"compact"`, was die Suche, den Ansichtsmodus-Umschalter und „Neu“ (sofern die Person Datensätze anlegen darf) umfasst; `"none"` (oder `null`) für keine Symbolleiste; oder eine Toolbar, die aus ihren Einzelteilen zusammengesetzt ist: `CollectionToolbar` (mit `start` und `end`), `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle` und `CollectionAddButton`. Diese greifen auf das Panel zu, in dem sie gerendert werden, und werfen andernorts einen Fehler. Plugin-Slots und der `Collection.Actions`-Override befinden sich in der Standard-Toolbar.
- `onRowClick` — wird mit der angeklickten Zeile und deren ID aufgerufen, anstatt dass das Panel sie öffnet – ausgelöst von einer Zeile, einer Karte, einer Kanban-Karte und der Bearbeitungsaktion. Die Zeile entspricht der vom Server gesendeten Struktur, dem Format, das `useRows`, `useRow` und `<FieldValue>` erwarten: exakt deren Spalten, ISO-Datumszeichenfolgen (`YYYY-MM-DD` für eine reine Datumsspalte) und eine belongsTo-Relation als Fremdschlüssel (`customerId`). Eine Relation, deren Ziel vom Panel geladen wurde, wird verschachtelt unter ihrem Namen übergeben, so wie es RESTs `include` zurückgibt (`order.customer` ist die Zeile des Kunden); ihr Fremdschlüssel ist dort ebenfalls vorhanden. Die ID ist der String, mit dem das Admin-Interface den Datensatz adressiert – sein Primärschlüssel, bei zusammengesetzten Schlüsseln werden die Teile mit `:::` verbunden –, welchen `highlightedIds` und `useSidePanel().open` erwarten. `row.id` ist die `id`-Spalte des Datensatzes, sofern die Tabelle eine hat, mit dem Typ dieser Spalte: `5` für einen Integer-Schlüssel, dessen ID `"5"` lautet.
- `rowActions` — Ihr eigenes JSX in jeder Zeile, Karte und Kanban-Karte, dem die Zeile und deren ID übergeben werden: etwa ein „Approve“ oder ein „Ship“. In der Tabelle ist dies die letzte, stets sichtbare Spalte; in einer Listenansicht, auf einer Karte und einer Kanban-Karte befindet es sich neben den Aktionen der Collection selbst. Ein Klick darauf öffnet den Datensatz nicht, und es wird mit dem Zustand Ihrer Komponente neu gerendert, sodass ein `saving`-Flag es deaktivieren kann.
- `orderBy` — die Reihenfolge, in der die Zeilen geöffnet werden, `"placed_at:desc"` oder `["placed_at", "desc"]`. Benutzer können dennoch nach einer anderen Spalte sortieren.
- `highlightedIds` — die IDs der als ausgewählt dargestellten Zeilen, beispielsweise diejenige, die eine Seite neben der Liste anzeigt: `highlightedIds={selected ? [selected] : []}`. `[]` hebt keine hervor. Ohne diesen Prop hebt das Panel die zuletzt geöffnete Zeile hervor. IDs werden als Strings verglichen, sodass ein Integer-Schlüssel `5` und `"5"` dieselbe Zeile bezeichnen.
- `where` — welche Zeilen enthalten sind, so wie `useRows` es entgegennimmt: `where={{ status: ["==", "pending"] }}`. Filter, die Benutzer für andere Felder festlegen, werden damit kombiniert, und die eigenen Felder können über die Toolbar weder geändert noch gelöscht werden. Da es dem Prop folgt, kann es über den State von einer Tab-Leiste oder einem angeklickten Diagrammbalken gesteuert werden. Es überschreibt das `fixedFilter` der Collection Feld für Feld.
- `viewMode` — der Modus, in dem das Panel geöffnet wird, mit Vorrang vor dem Wert in der URL und dem Modus, den der Benutzer zuletzt gewählt hat. Benutzer können weiterhin umschalten.
- `title={false}` — kein Titel über dem Panel und auch keine eigene Überschrift der Listenansicht.
- `updateUrl` — standardmäßig deaktiviert: Das Panel liest oder schreibt die Parameter `__view`, Filter und Sortierung der Seite nicht.

Die `entityActions` der Collection werden auf jeder Zeile, Karte und Kanban-Karte dargestellt: als Schaltflächen, wenn sie als `collapsed: false` deklariert sind, andernfalls im Menü der Zeile – ein „Approve“ auf jeder Karte ist eine solche Aktion.

Ein Panel passt seine Größe an seine Zeilen an. Ohne Höhenangabe des Elternelements oder nur mit einem `max-height` rendert eine kurze Collection ihre Toolbar sowie Zeilen, und eine lange scrollt innerhalb des verfügbaren Platzes, bis hin zur Höhe des Fensters. Geben Sie ihm eine Höhe, um den Raum vollständig auszufüllen. Das Layout richtet sich nach der eigenen Breite, nicht nach der des Fensters: In einer schmalen Spalte wird das kompakte Layout verwendet, unabhängig von der Bildschirmgröße.

`propertiesOrder` sortiert lediglich um und blendet niemals aus: Eine Eigenschaft, die darin nicht aufgeführt ist, wird nach den genannten dargestellt. Um eine Eigenschaft überall auszublenden, setzen Sie `admin.hideFromCollection` dafür; um an einer bestimmten Stelle nur ausgewählte anzuzeigen, übergeben Sie `fields`.

## Das Formular eines einzelnen Datensatzes

`<EntityFormPanel>` erfüllt dieselbe Funktion für das Formular eines einzelnen Datensatzes. Es lädt den Datensatz anhand der `id`, speichert ihn über die Datenschicht von `<Rebase>`, genau wie das eigene Formular des Admin-Interfaces, und ruft nach jedem Speichervorgang `onSaved` mit dem gespeicherten Datensatz auf, wie der Server die Zeile sendet: `row` und dessen `id`. Lassen Sie `id` weg, um einen Datensatz zu erstellen. `onClose` wird aufgerufen, wenn das Formular signalisiert, verlassen zu werden, beispielsweise nachdem sein Datensatz gelöscht wurde:

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Wie `CollectionPanel` akzeptieren auch das Formular und `RecordDetail` eine registrierte Collection über ihren Namen, ohne dass ein Konfigurationsobjekt vorliegen muss: `<EntityFormPanel collection="posts" id={postId}/>` (`path="posts"` funktioniert ebenfalls). Unter `<RebaseCMS>` oder einem `CollectionsProvider`, der sie registriert, ist das alles, was benötigt wird. Ohne übergeordneten Scope übergeben Sie die Collection als Wert, wie hier gezeigt, und das Panel bringt seinen eigenen mit; wird ein Pfad angegeben, den nichts registriert, meldet das Panel, dass der Datensatz nicht gefunden wurde.

Löscht jemand anderes den Datensatz, während das Formular geöffnet ist, behält das Formular die eingegebenen Daten und meldet, dass der Datensatz anderweitig gelöscht wurde. Über die Aktion „Save as new“ wird es in ein Formular umgewandelt, das mit diesen Werten einen neuen Datensatz erstellt; `onSaved` meldet anschließend den neuen Datensatz.

<span class="since-badge" data-since="0.29">Seit 0.29</span> Das Formular kann nur einen Teil eines Datensatzes anzeigen oder ihn nach Ihren Wünschen anordnen. `fields` zeigt nur die angegebenen Felder in genau dieser Reihenfolge an; Abschnitte und die Sidebar (Rail) behalten ihre Gruppierung bei. Über `children` können Sie die generierten Felder durch eigenes JSX ersetzen, in dem `<FormField name="…"/>` ein einzelnes Feld mit dem Label, der Größe und den Regeln rendert, die das generierte Formular vorsieht:

```tsx
import { EntityFormPanel, FormField } from "@rebasepro/cms";

<EntityFormPanel collection="orders" id={orderId}>
    <div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
    </div>
    <FormField name="notes"/>
</EntityFormPanel>
```

`compact` ist die dichte Formularvariante für eine Seitenkarte oder ein 350–700 px breites Panel: keine Sidebar neben den Feldern (ihr Inhalt wird in die Spalte integriert), keine Datensatz-Metadaten, Steuerelemente mittlerer Höhe und geringere Abstände (Padding):
`<EntityFormPanel collection="orders" id={orderId} fields={["status", "notes"]} compact/>`.

In beiden Fällen validiert das Formular nur die Felder, die es anzeigt; der Server prüft weiterhin den gesamten Datensatz. Ein Formular, das einen Datensatz erstellt und ein Pflichtfeld ohne Standardwert auslässt, weist beim Öffnen darauf hin: Eine Fehlermeldung nennt das Feld, und das Speichern bleibt blockiert, bis das Feld angezeigt oder mit einem Standardwert versehen wird.
`collectionOverrides` ändert die Collection nur für dieses Formular, genau wie bei `CollectionPanel`.

Jedes Formular kapselt seine DOM-IDs, sodass sich zwei Formulare dieselbe Seite teilen können. Um ein Feld aus einem Test heraus zu finden, wählen Sie `[data-form-field="title"]` innerhalb des `[data-form-path="posts"]` des Formulars aus.

<span class="since-badge" data-since="0.29">Seit 0.29</span>
`<RecordDetail>` ist das schreibgeschützte Pendant zu `EntityFormPanel`. Es lädt den Datensatz anhand der `id` und stellt ihn so dar wie die Datensatzseite des Admin-Interfaces: dieselben Abschnitte und Labels, wobei jeder Wert als Vorschau gerendert wird – ein Enum erscheint als Chip, ein Datum in seiner Zeitzone und eine Relation als Titel des Ziel-Datensatzes. Es unterstützt `fields` und `collectionOverrides` wie das Formular und blendet die Felder aus, die auch das Formular auslässt: Felder, die durch eine `conditions.hidden`-Regel für diesen Datensatz verborgen werden, sowie Felder, die der angemeldete Benutzer nicht lesen darf.

```tsx
import { RecordDetail } from "@rebasepro/cms";

<RecordDetail
    collection="orders"
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` rendert einen einzelnen Wert auf dieselbe Weise innerhalb Ihres eigenen JSX: Übergeben Sie ihm den Wert so, wie ihn der Server sendet. Eine belongsTo-Relation wird als Fremdschlüssel übermittelt (`order.customerId`), daher rendert `field="customer" value={order.customerId}` den Titel des verknüpften Datensatzes; die direkte Angabe des Fremdschlüssels über `field="customerId"` bewirkt dasselbe. Es erfordert, dass die Collection darüber registriert ist – entweder durch `<RebaseCMS>` oder einen `CollectionsProvider`. Eine unbekannte Collection oder ein unbekanntes Feld löst einen Fehler aus, der den Namen angibt.

```tsx
import { useRows } from "@rebasepro/app";
import { FieldValue } from "@rebasepro/cms";

function OrderList() {
    const { rows } = useRows("orders", { limit: 20 });
    return rows.map(order => (
        <div key={String(order.id)} className="flex gap-4">
            <FieldValue collection="orders" field="customer" value={order.customerId}/>
            <FieldValue collection="orders" field="status" value={order.status}/>
            <FieldValue collection="orders" field="placedAt" value={order.placedAt}/>
        </div>
    ));
}
```

## Mehrere Panels in einem Scope

Die drei Panels bringen ihren eigenen `CollectionsProvider` mit, wenn ihnen keiner übergeordnet ist. Dies ist der darunter liegende Schritt, und Sie können ihn selbst einbinden, um einen Scope für mehrere Panels gemeinsam zu nutzen oder um tiefer liegende Elemente (`CollectionViewBinding`, `useSidePanel`) darunter zu verwenden. Innerhalb dieses Scopes kann ein Panel seine Collection per `path` benennen:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel collection="posts"/>
    <CollectionPanel collection="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` verwaltet eine Registry der übergebenen Collections, wobei `modifyCollection` und `injectCollections` Ihrer Plugins wie im Admin-Interface angewendet werden, sowie die Side-Panels und Dialoge, in denen sich Datensätze öffnen, und den Schutz vor ungespeicherten Änderungen. Halten Sie das `collections`-Array stabil: als Modulkonstante oder mittels `useMemo`.

## Nächste Schritte

- [Admin-Interface anpassen](/docs/frontend/customizing): Stellen, an denen eigene Komponenten eingesetzt werden können, und Rezepte, die auf diesen Panels aufbauen.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` und `useRowWrites` – die Zeilen, die diese Panels und `FieldValue` abrufen.
- [Komponenten-Overrides](/docs/frontend/component-overrides): Ersetzen Sie die Ansicht oder das Formular, das ein Panel darstellt.
