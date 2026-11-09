---
sourceHash: 53beac2b1e144124
title: Panels in einer eigenen Seite
sidebar_label: Panels in eigenen Seiten
description: "Zeigen Sie eine Collection, das Formular eines Datensatzes, einen Datensatz oder einen Wert in einer eigenen Seite an: CollectionPanel, RecordForm, RecordDetail, FieldValue und CollectionsProvider, ohne Admin-Shell darum herum."
---

Sie benötigen nicht das gesamte Admin-Interface, um eine Tabelle anzuzeigen. `<CollectionPanel>` nimmt die Collection als Wert entgegen und funktioniert überall unter `<Rebase>` und einem React-Router-Router, ohne `<RebaseCMS>`, `<RebaseNavigation>` oder `<RebaseShell>`:

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

Ein Datensatz öffnet sich über Ihrer Seite in einem Side-Panel oder einem Dialog und niemals per URL: Keine Admin-Route stellt die Seite bereit, daher öffnen sich `full_screen` und `split` als Side-Panel, und `useUrlController().routesMounted` ist für Ihre eigenen Komponenten dort `false`. Jeder Router funktioniert: ein einfacher `<BrowserRouter>`, ein `<MemoryRouter>` oder ein Data-Router. Ein Router ist weiterhin erforderlich. Ein Data-Router ermöglicht es zudem einem Datensatz mit ungespeicherten Änderungen, die In-App-Navigation zu stoppen; bei den anderen schützt ihn lediglich die Browser-Eingabeaufforderung beim Verlassen der Seite. Hüllen Sie das Panel in `<RebaseAuthGate>` ein, wenn die Seite zuerst den Login von Rebase anzeigen soll.

## Was ein Panel anzeigt

Ein Panel stellt die Collection genauso dar wie der Admin. Diese Props schränken es auf das ein, was Ihre Seite benötigt; keine davon verändert die eigene Seite der Collection.

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

`collection` nimmt den Namen der Collection entgegen, wie hier, oder die Collection selbst als Wert (`collection={ordersCollection}`); `path` benennt sie ebenfalls und adressiert eine Subcollection über ihren vollständigen Pfad.

- `fields` – die Eigenschaften, die angezeigt werden, in dieser Reihenfolge und nichts weiter. In der Tabelle sind dies die Spalten. In der Liste, auf einer Karte und auf einer Kanban-Karte sind sie das, woraus die Plätze der Zeile – Titel, Bild, Untertitel, Status, Datum, Relations-Chips, die Spalten der Liste – befüllt werden, frühere zuerst; ein Platz, den keines davon füllt, bleibt leer. Bei diesem Panel hat dies Vorrang vor `propertiesOrder`, der von einem Benutzer gespeicherten Spaltenreihenfolge und `listProperties`. Vom Benutzer per Drag-and-Drop angepasste Spaltenbreiten bleiben weiterhin erhalten; die Reihenfolge wird von Ihnen vorgegeben, daher können Spalten nicht verschoben werden.
- `toolbar` – `"full"` (Standard); `"compact"`, was die Suche, den Ansichtsmodus-Umschalter und „Neu“ (sofern die Person Datensätze erstellen darf) umfasst; `"none"` (oder `null`) für keine; oder eine aus ihren Einzelteilen zusammengesetzte Toolbar: `CollectionToolbar` (mit `start` und `end`), `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle` und `CollectionAddButton`. Diese lesen das Panel aus, in dem sie gerendert werden, und werfen andernorts einen Fehler. Plugin-Slots und der `Collection.Actions`-Override befinden sich in der Standard-Toolbar.
- `onRowClick` – wird mit der angeklickten Zeile und ihrer ID aufgerufen, anstatt dass das Panel sie öffnet, ausgelöst durch eine Zeile, eine Karte, eine Kanban-Karte oder die Bearbeiten-Aktion. Die Zeile entspricht der vom Server gesendeten Struktur, die auch `useRows`, `useRow` und `<FieldValue>` annehmen: exakt deren Spalten, ISO-Datumszeichenfolgen (`YYYY-MM-DD` für eine reine Datumsspalte) und eine belongsTo-Relation als Fremdschlüssel (`customerId`). Eine Relation, deren Ziel das Panel geladen hat, wird verschachtelt unter ihrem Namen geliefert, so wie es `include` bei REST zurückgibt (`order.customer` ist die Zeile des Kunden); ihr Fremdschlüssel ist ebenfalls vorhanden. Die ID ist der String, mit dem der Admin den Datensatz adressiert – sein Primärschlüssel bzw. bei zusammengesetzten Schlüsseln die mit `:::` verbundenen Teile –, den `highlightedIds` und `useSidePanel().open` erwarten. `row.id` ist die `id`-Spalte des Datensatzes, sofern die Tabelle eine solche besitzt, mit dem Typ dieser Spalte: `5` bei einem Integer-Schlüssel, dessen ID `"5"` ist.
- `rowActions` – Ihr eigenes JSX in jeder Zeile, Karte und Kanban-Karte, dem die Zeile und ihre ID übergeben werden: z. B. ein „Freigeben“, ein „Versenden“. In der Tabelle ist dies die letzte Spalte, die immer sichtbar ist; bei einer Listenansichtszeile, einer Karte und einer Kanban-Karte befindet sie sich neben den Aktionen der Collection selbst. Ein Klick darauf öffnet den Datensatz nicht, und sie wird mit dem State Ihrer Komponente neu gerendert, sodass ein `saving`-Flag sie deaktivieren kann.
- `orderBy` – die Reihenfolge, in der die Zeilen geöffnet werden, `"placed_at:desc"` oder `["placed_at", "desc"]`. Der Benutzer kann weiterhin nach einer anderen Spalte sortieren.
- `highlightedIds` – die IDs der Zeilen, die als ausgewählt dargestellt werden, beispielsweise diejenige, die eine Seite neben der Liste anzeigt: `highlightedIds={selected ? [selected] : []}`. `[]` hebt keine hervor. Ohne diese Eigenschaft hebt das Panel die zuletzt geöffnete Zeile hervor. IDs werden als Strings verglichen, sodass `5` und `"5"` bei einem Integer-Schlüssel dieselbe Zeile referenzieren.
- `where` – welche Zeilen enthalten sind, im Format von `useRows`: `where={{ status: ["==", "pending"] }}`. Filter, die der Benutzer für andere Felder festlegt, werden damit kombiniert, und die eigenen Felder können über die Toolbar weder geändert noch gelöscht werden. Die Eigenschaft folgt der Prop, sodass eine Tab-Leiste oder ein angeklickter Diagrammbalken sie über den State steuern kann. Sie überschreibt den `fixedFilter` der Collection Feld für Feld.
- `viewMode` – der Modus, in dem geöffnet wird, vorrangig gegenüber dem in der URL und dem zuletzt vom Benutzer ausgewählten. Der Modus kann weiterhin gewechselt werden.
- `title={false}` – kein Titel über dem Panel und auch keine eigene Überschrift der Listenansicht.
- `updateUrl` – standardmäßig deaktiviert: Das Panel liest oder schreibt weder die `__view`-, Filter- noch Sortierparameter der Seite.

Die `entityActions` der Collection werden auf jeder Zeile, Karte und Kanban-Karte gerendert: als Buttons, wenn `collapsed: false` deklariert ist, und andernfalls im Menü der Zeile – ein „Freigeben“ auf jeder Karte ist eine solche Aktion.

Ein Panel passt seine Größe an seine Zeilen an. Ohne Höhenangabe des übergeordneten Elements oder nur mit einer `max-height` rendert eine kurze Collection ihre Toolbar und Zeilen, während eine lange innerhalb des verfügbaren Raums scrollt, bis zur Höhe des Fensters. Weisen Sie ihm eine Höhe zu, um den Raum auszufüllen. Das Layout richtet sich nach der eigenen Breite, nicht nach der des Fensters: In einer schmalen Spalte verwendet es sein kompaktes Layout, unabhängig vom Bildschirm.

`propertiesOrder` ändert die Reihenfolge und blendet niemals aus: Eine Eigenschaft, die nicht aufgeführt ist, wird nach den genannten gerendert. Um eine Eigenschaft überall auszublenden, setzen Sie `admin.hideFromCollection` für diese; um nur bestimmte an einer Stelle anzuzeigen, übergeben Sie `fields`.

## Das Formular eines einzelnen Datensatzes

`<RecordForm>` tut dasselbe für das Formular eines einzelnen Datensatzes (vor Version 0.29 hieß es `EntityFormPanel`; dieser Name funktioniert weiterhin und gibt eine einmalige Warnung aus). Es lädt den Datensatz anhand der `id`, speichert ihn über die Datenschicht von `<Rebase>`, genau wie das Formular des Admins selbst, und ruft `onSaved` nach jedem Speichern mit dem gespeicherten Datensatz auf, so wie der Server die Zeile übermittelt, `row`, sowie dessen `id`. Lassen Sie `id` weg, um einen Datensatz zu erstellen. `onClose` wird aufgerufen, wenn das Formular verlassen werden soll, beispielsweise nachdem der Datensatz gelöscht wurde:

```tsx
<RecordForm
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Wie `CollectionPanel` akzeptieren das Formular und `RecordDetail` eine registrierte Collection über ihren Namen, ohne dass ein Konfigurationsobjekt vorliegen muss: `<RecordForm collection="posts" id={postId}/>` (`path="posts"` funktioniert ebenfalls). Unter `<RebaseCMS>` oder einem `CollectionsProvider`, der sie registriert, ist das alles, was sie benötigen. Wenn darüber kein Scope existiert, übergeben Sie die Collection als Wert, wie hier gezeigt, und das Panel stellt seinen eigenen Scope bereit; eine Collection, die über einen Pfad benannt wird, der nirgends registriert ist, meldet, dass der Datensatz nicht gefunden wurde.

Löscht jemand anderes den Datensatz, während das Formular geöffnet ist, behält das Formular die eingegebenen Daten und meldet, dass der Datensatz an anderer Stelle gelöscht wurde. Die Aktion „Als neu speichern“ wandelt es in ein Formular um, das einen neuen Datensatz mit diesen Werten erstellt; `onSaved` meldet anschließend den neuen Datensatz.

Das Formular kann einen Teil eines Datensatzes anzeigen oder nach Ihren Wünschen strukturiert werden. `fields` zeigt nur die angegebenen Felder in dieser Reihenfolge; Sektionen und die Rail behalten ihre Gruppierung bei. Untergeordnete Elemente (Children) ersetzen die generierten Felder durch Ihr eigenes JSX, in dem `<FormField name="…"/>` ein einzelnes Feld mit der Beschriftung, Größe und den Regeln rendert, die das generierte Formular dafür vorgibt:

```tsx
import { RecordForm, FormField } from "@rebasepro/cms";

<RecordForm collection="orders" id={orderId}>
    <div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
    </div>
    <FormField name="notes"/>
</RecordForm>
```

`compact` ist die kompakte Form für eine Seitenkarte oder ein 350–700 px breites Panel: keine Rail neben den Feldern (ihre Inhalte werden in die Spalte eingeklappt), keine Datensatz-Metadaten, Steuerelemente mittlerer Höhe und geringere Abstände: `<RecordForm collection="orders" id={orderId} fields={["status", "notes"]} compact/>`.

In beiden Fällen validiert das Formular nur die angezeigten Felder; der Server prüft weiterhin den gesamten Datensatz. Ein Formular, das einen Datensatz erstellt und ein Pflichtfeld ohne Standardwert auslässt, weist beim Öffnen darauf hin: Eine Fehlermeldung benennt das Feld, und das Speichern bleibt blockiert, bis das Feld angezeigt oder mit einem Standardwert versehen wird. `collectionOverrides` ändert die Collection nur für dieses Formular, genau wie bei `CollectionPanel`.

Jedes Formular kapselt seine DOM-IDs, sodass sich zwei Formulare eine Seite teilen können. Um ein Feld aus einem Test heraus zu finden, selektieren Sie `[data-form-field="title"]` innerhalb des `[data-form-path="posts"]` des Formulars.

`<RecordDetail>` ist das schreibgeschützte Pendant zu `RecordForm`. Es lädt den Datensatz anhand der `id` und stellt ihn so dar, wie es die Datensatzseite des Admins tut: dieselben Abschnitte und Bezeichnungen, wobei jeder Wert als Vorschau angezeigt wird – ein Enum erscheint als Chip, ein Datum in seiner Zeitzone und eine Relation als Titel des Zielobjekts. Es unterstützt `fields` und `collectionOverrides` genau wie das Formular und lässt dieselben Felder aus wie dieses: Felder, die durch eine `conditions.hidden`-Regel für diesen Datensatz verborgen sind, sowie Felder, die der angemeldete Benutzer nicht lesen darf.

```tsx
import { RecordDetail } from "@rebasepro/cms";

<RecordDetail
    collection="orders"
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` stellt einen einzelnen Wert auf die gleiche Weise innerhalb Ihres eigenen JSX dar: Übergeben Sie den Wert so, wie der Server ihn sendet. Eine belongsTo-Relation wird als Fremdschlüssel geliefert (`order.customerId`), sodass `field="customer" value={order.customerId}` den Titel des verknüpften Datensatzes rendert; die Angabe des Fremdschlüssels selbst, `field="customerId"`, bewirkt dasselbe. Die Collection muss darüber durch `<RebaseCMS>` oder einen `CollectionsProvider` registriert sein. Eine unbekannte Collection oder ein unbekanntes Feld löst einen Fehler aus, der den Namen angibt.

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

Die drei Panels bringen ihren eigenen `CollectionsProvider` mit, wenn sich keiner über ihnen befindet. Das ist die zugrundeliegende Schicht, und Sie können sie selbst einbinden, um einen gemeinsamen Scope für mehrere Panels zu nutzen oder die tiefer liegenden Bausteine (`CollectionViewBinding`, `useSidePanel`) darunter zu verwenden. Darin kann ein Panel seine Collection über `path` benennen:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel collection="posts"/>
    <CollectionPanel collection="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` verwaltet eine Registry der übergebenen Collections, wobei `modifyCollection` und `injectCollections` Ihrer Plugins wie im Admin angewendet werden, zuzüglich der Side-Panels und Dialoge, in denen Datensätze geöffnet werden, sowie des Schutzes vor ungespeicherten Änderungen. Halten Sie das `collections`-Array stabil: als Modulkonstante oder mittels `useMemo`.

## Nächste Schritte

- [Anpassen des Admins](/docs/frontend/customizing): Orte, an denen eigene Komponenten platziert werden können, und Rezepte, die auf diesen Panels aufbauen.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` und `useRowWrites`, die Zeilen, die diese Panels und `FieldValue` lesen.
- [Komponenten-Overrides](/docs/frontend/component-overrides): Ersetzen Sie die Ansicht oder das Formular, das ein Panel anzeigt.
