---
sourceHash: 7a427ea4f8f8b272
title: Panels auf einer eigenen Seite
sidebar_label: Panels auf eigenen Seiten
description: "Zeigen Sie eine Tabelle, das Formular eines Datensatzes, einen Datensatz oder einen Wert auf einer eigenen Seite an: CollectionPanel, RecordForm, RecordDetail, FieldValue und CollectionsProvider, ganz ohne Admin-Shell drumherum."
---

Sie benötigen nicht das gesamte Admin-Panel, um eine Tabelle anzuzeigen. `<CollectionPanel>` übernimmt
eine Tabelle anhand ihres Slugs und funktioniert überall unter `<Rebase>` und einem React-Router-Router –
ganz ohne `<RebaseCMS>`, `<RebaseNavigation>` oder `<RebaseShell>`:

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { CollectionPanel } from "@rebasepro/cms";
// Plus BrowserRouter, or any other router, from "react-router".

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            <BrowserRouter>
                <MyPageLayout>
                    <CollectionPanel collection="posts"/>
                </MyPageLayout>
            </BrowserRouter>
        </Rebase>
    );
}
```

Ein Datensatz öffnet sich über Ihrer Seite, in einem Side-Panel oder einem Dialog, und niemals per URL:
Da keine Admin-Route die Seite bedient, öffnen sich `full_screen` und `split` als Side-Panel,
und `useUrlController().routesMounted` ist für Ihre eigenen Komponenten dort `false`. Jeder Router
funktioniert: ein einfacher `<BrowserRouter>`, ein `<MemoryRouter>` oder ein Data-Router. Ein Router
ist dennoch erforderlich. Ein Data-Router ermöglicht es zudem, dass ein Datensatz mit ungespeicherten
Änderungen die In-App-Navigation stoppt; bei den anderen schützt ihn lediglich die Browser-Aufforderung
zum Verlassen der Seite. Hüllen Sie das Panel in `<RebaseAuthGate>` ein, wenn die Seite zuerst den Rebase-Login
anzeigen soll.

## Was ein Panel anzeigt

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein Panel stellt die Tabelle so dar, wie es das Admin-Panel tut – anhand des vom Server bereitgestellten
Deskriptors samt aller registrierten `customizeTable`-Anpassungen. Diese Props schränken die Ansicht auf das
ein, was Ihre Seite benötigt; keine davon ändert die seiteigene Tabelle im Admin-Panel.

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

`collection` akzeptiert den Slug der Tabelle, wie hier gezeigt, oder eine externe Collection
(`defineFirestoreCollection`) als Wert; `path` benennt sie ebenfalls und adressiert eine
verschachtelte Collection über ihren vollständigen Pfad.

- `fields` — die Eigenschaften, die angezeigt werden, in genau dieser Reihenfolge und sonst nichts. In der
  Tabelle sind dies die Spalten. In der Liste, auf einer Karte und auf einer Kanban-Karte bestimmen sie, woraus
  die Positionen der Zeile gefüllt werden – Titel, Bild, Untertitel, Status, Datum, Relations-Chips, die Spalten
  der Liste –, wobei frühere zuerst verwendet werden; ein Platz, den keines davon füllt, bleibt leer. Bei diesem
  Panel hat dies Vorrang vor `propertiesOrder`, der von einem Benutzer gespeicherten Spaltenreihenfolge und
  `listProperties`. Vom Benutzer verschobene Spaltenbreiten bleiben weiterhin persistent; die Reihenfolge wird
  von Ihnen vorgegeben, daher können Spalten nicht per Drag-and-Drop verschoben werden.
- `toolbar` — `"full"`, der Standardwert; `"compact"`, was Suche, Ansichtsmodus-Umschalter und „Neu“ (sofern
  die Person Datensätze erstellen darf) umfasst; `"none"` (oder `null`) für keine Toolbar; oder eine aus ihren
  Bestandteilen zusammengesetzte: `CollectionToolbar` (mit `start` und `end`), `CollectionSearchBar`,
  `CollectionFiltersButton`, `CollectionViewModeToggle` und `CollectionAddButton`. Diese lesen das Panel aus,
  in dem sie gerendert werden, und werfen an anderer Stelle einen Fehler. Plugin-Slots und das
  `Collection.Actions`-Override befinden sich in der Standard-Toolbar.
- `onRowClick` — wird mit der angeklickten Zeile und ihrer ID aufgerufen, anstatt dass das Panel sie öffnet,
  und zwar von einer Zeile, einer Karte, einer Kanban-Karte und der Bearbeiten-Aktion aus. Die Zeile entspricht
  derjenigen, die der Server sendet, in der Form, wie sie `useRows`, `useRow` und `<FieldValue>` annehmen:
  exakt ihre Spalten, ISO-Datumszeichenfolgen (`YYYY-MM-DD` für eine reine Datumsspalte) und eine belongsTo-Relation
  als Fremdschlüssel (`customerId`). Eine Relation, deren Ziel das Panel geladen hat, kommt verschachtelt unter
  ihrem Namen an, so wie RESTs `include` sie zurückgibt (`order.customer` ist die Zeile des Kunden); ihr
  Fremdschlüssel ist ebenfalls vorhanden. Die ID ist der String, mit dem das Admin-Panel den Datensatz
  adressiert – sein Primärschlüssel, wobei die Teile eines zusammengesetzten Schlüssels mit `:::` verknüpft sind –,
  den `highlightedIds` und `useSidePanel().open` annehmen. `row.id` ist die `id`-Spalte des Datensatzes, sofern
  die Tabelle eine hat, mit dem Typ dieser Spalte: `5` für einen Integer-Schlüssel, dessen ID `"5"` ist.
- `rowActions` — Ihr eigenes JSX in jeder Zeile, Karte und Kanban-Karte, dem die Zeile und ihre ID übergeben
  werden: z. B. ein „Approve“, ein „Ship“. In der Tabelle ist dies die letzte Spalte, immer sichtbar; in einer
  Listenansicht, auf einer Karte und einer Kanban-Karte befindet es sich neben den Aktionen der Collection
  selbst. Ein Klick darauf öffnet den Datensatz nicht, und es wird mit dem Status Ihrer Komponente neu gerendert,
  sodass ein `saving`-Flag es deaktivieren kann.
- `orderBy` — die Reihenfolge, in der die Zeilen geöffnet werden, `"placed_at:desc"` oder
  `["placed_at", "desc"]`. Der Benutzer kann weiterhin nach einer anderen Spalte sortieren.
- `highlightedIds` — die IDs der Zeilen, die als ausgewählt dargestellt werden, beispielsweise jene, die eine
  Seite neben der Liste anzeigt: `highlightedIds={selected ? [selected] : []}`. `[]` markiert keine. Ohne diese
  Eigenschaft hebt das Panel die zuletzt geöffnete Zeile hervor. IDs werden als Strings verglichen, sodass bei
  einem Integer-Schlüssel `5` und `"5"` dieselbe Zeile referenzieren.
- `where` — welche Zeilen enthalten sind, im selben Format wie für `useRows`:
  `where={{ status: ["==", "pending"] }}`. Filter, die der Benutzer für andere Felder setzt, werden damit
  kombiniert, und die eigenen Felder können über die Toolbar weder geändert noch gelöscht werden. Die
  Eigenschaft reagiert reaktiv, sodass eine Tab-Leiste oder ein angeklickter Balken in einem Diagramm sie über
  den State steuern kann. Sie überschreibt den `fixedFilter` der Collection Feld für Feld.
- `viewMode` — der Modus, in dem geöffnet wird, vorrangig gegenüber dem in der URL und dem, den die Person
  zuletzt ausgewählt hat. Die Ansicht kann dennoch gewechselt werden.
- `title={false}` — kein Titel über dem Panel und auch keine eigene Überschrift der Listenansicht.
- `updateUrl` — standardmäßig deaktiviert: Das Panel liest oder schreibt weder die `__view`-, Filter- noch
  Sortierparameter der Seite.

Die `entityActions` der Collection werden auf jeder Zeile, Karte und Kanban-Karte gerendert – als Buttons,
wenn `collapsed: false` deklariert ist, und ansonsten im Menü der Zeile; ein „Genehmigen“ auf jeder Karte
ist eine solche Aktion.

Ein Panel passt seine Größe an seine Zeilen an. Ohne Höhenvorgabe des Elternelements oder nur mit einem
`max-height` rendert eine kurze Collection ihre Toolbar sowie Zeilen, und eine lange scrollt innerhalb des
verfügbaren Platzes bis zur Fensterhöhe. Weisen Sie ihm eine Höhe zu, damit es diesen Platz ausfüllt. Das
Layout orientiert sich an seiner eigenen Breite, nicht an der des Fensters: In einer schmalen Spalte nutzt
es unabhängig vom Bildschirm sein kompaktes Layout.

`fieldOrder` in `customizeTable` der Tabelle ordnet nur um und blendet niemals aus: Ein Feld, das ausgelassen
wird, wird nach den benannten Feldern dargestellt. Um ein Feld überall aus der Liste herauszuhalten, setzen Sie
`hidden: true` in dessen Feld-Optionen; um an einer Stelle nur bestimmte Felder anzuzeigen, übergeben Sie `fields`.

## Das Formular eines einzelnen Datensatzes

`<RecordForm>` tut dasselbe für das Formular eines einzelnen Datensatzes (vor 0.29 hieß es `EntityFormPanel`;
dieser Name funktioniert weiterhin und gibt eine einmalige Warnung aus). Es lädt den Datensatz anhand der
`id`, speichert ihn über die Datenschicht von `<Rebase>` wie das Formular des Admin-Panels selbst und ruft
nach jedem Speichern `onSaved` mit dem gespeicherten Datensatz so auf, wie der Server die Zeile sendet:
`row` und seine `id`. Lassen Sie `id` weg, um einen Datensatz zu erstellen. `onClose` wird aufgerufen, wenn
das Formular verlassen werden soll, beispielsweise nachdem der Datensatz gelöscht wurde:

```tsx
<RecordForm
    collection="posts"
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Wie `CollectionPanel` akzeptieren das Formular und `RecordDetail` eine Tabelle anhand ihres Slugs
(`path="posts"` funktioniert ebenfalls). Jede vom Server bereitgestellte Tabelle ist ihnen bekannt – unter
`<RebaseCMS>`, unter einem `CollectionsProvider` oder ganz ohne übergeordneten Scope; in diesem Fall bringt das
Panel seinen eigenen mit. Eine externe Collection wird als Wert übergeben. Wird ein Pfad angegeben, der von
nichts bedient wird, meldet die Komponente, dass der Datensatz nicht gefunden wurde.

Löscht jemand anderes den Datensatz, während das Formular geöffnet ist, behält das Formular die eingegebenen
Daten bei und meldet, dass der Datensatz an anderer Stelle gelöscht wurde. Die Aktion „Als neu speichern“
wandelt es in ein Formular um, das mit diesen Werten einen neuen Datensatz erstellt; `onSaved` meldet
anschließend den neuen Datensatz.

Das Formular kann einen Teil eines Datensatzes anzeigen oder ihn nach Ihren Wünschen anordnen. `fields` zeigt
nur die angegebenen Felder in genau dieser Reihenfolge an; Abschnitte und die Seitenleiste (Rail) behalten
ihre Gruppierung bei. Children ersetzen die generierten Felder durch Ihr eigenes JSX, in dem
`<FormField name="…"/>` ein einzelnes Feld mit der Beschriftung, Größe und den Regeln rendert, die das
generierte Formular dafür vorsieht:

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

`compact` ist die kompakte Form für eine seitliche Karte oder ein 350–700px breites Panel: keine Seitenleiste
(Rail) neben den Feldern (ihr Inhalt wird in die Spalte eingefügt), keine Metadaten des Datensatzes,
Steuerelemente mittlerer Höhe und engere Abstände:
`<RecordForm collection="orders" id={orderId} fields={["status", "notes"]} compact/>`.

In beiden Fällen validiert das Formular nur die angezeigten Felder; der Server prüft weiterhin den gesamten
Datensatz. Ein Formular, das einen Datensatz erstellt und ein Pflichtfeld ohne Standardwert auslässt, weist
beim Öffnen darauf hin: Ein Fehler benennt das Feld, und das Speichern bleibt gesperrt, bis das Feld angezeigt
wird oder einen Standardwert erhält. `collectionOverrides` ändert die Darstellung nur für dieses Formular,
genau wie bei `CollectionPanel`.

Jedes Formular begrenzt den Gültigkeitsbereich seiner DOM-IDs, sodass sich zwei Formulare eine Seite teilen
können. Um ein Feld aus einem Test heraus zu finden, wählen Sie `[data-form-field="title"]` innerhalb von
`[data-form-path="posts"]` des Formulars aus.

`<RecordDetail>` ist das schreibgeschützte Gegenstück zu `RecordForm`. Es lädt den Datensatz anhand der `id`
und stellt ihn so dar, wie es die Datensatzseite des Admin-Panels tut: dieselben Abschnitte und Beschriftungen,
wobei jeder Wert als Vorschau dargestellt wird – ein Enum also als Chip, ein Datum in seiner Zeitzone und
eine Relation als Titel ihres Ziels. Es akzeptiert `fields` und `collectionOverrides` wie das Formular und
lässt dieselben Felder aus wie dieses: Felder, die eine `conditions.hidden`-Regel für diesen Datensatz
ausblendet, sowie solche, die der angemeldete Benutzer nicht lesen darf.

```tsx
import { RecordDetail } from "@rebasepro/cms";

<RecordDetail
    collection="orders"
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` stellt einen einzelnen Wert auf die gleiche Weise innerhalb Ihres eigenen JSX dar: Übergeben
Sie den Wert so, wie der Server ihn sendet. Ein belongsTo wird als Fremdschlüssel übergeben
(`order.customerId`), sodass `field="customer" value={order.customerId}` den Titel des verknüpften
Datensatzes darstellt; die direkte Angabe des Fremdschlüssels, `field="customerId"`, bewirkt dasselbe. Die
Tabelle muss der Komponente auf übergeordneter Ebene bekannt sein, entweder durch `<RebaseCMS>` oder einen
`CollectionsProvider`. Eine unbekannte Collection oder ein unbekanntes Feld löst einen Fehler aus, der den
Namen nennt.

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

## Mehrere Panels in einem gemeinsamen Scope

Die drei Panels bringen ihren eigenen `CollectionsProvider` mit, wenn ihnen keiner übergeordnet ist. Dies
ist die darunterliegende Ebene, und Sie können sie selbst mounten, um einen gemeinsamen Scope für mehrere
Panels zu nutzen oder die untergeordneten Bausteine (`CollectionViewBinding`, `useSidePanel`) darunter zu
verwenden. Er akzeptiert dieselben Eingaben wie `<RebaseCMS>`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";
import { postsCms } from "./cms/posts";

const tableCustomizations = [postsCms];

<CollectionsProvider tableCustomizations={tableCustomizations}>
    <CollectionPanel collection="posts"/>
    <CollectionPanel collection="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` enthält eine Registry der vom Server bereitgestellten Tabellen, wobei Ihre
`tableCustomizations` und etwaige `externalCollections` sowie `modifyCollection` und `injectCollections`
Ihrer Plugins wie im Admin-Panel angewendet werden, zuzüglich der Side-Panels und Dialoge, in denen Datensätze
geöffnet werden, sowie des Schutzes vor ungespeicherten Änderungen. Halten Sie die Arrays stabil: als
Modulkonstante oder via `useMemo`. `tables` ersetzt die bereitgestellten Tabellen durch von Ihnen übergebene
Deskriptoren, nützlich für Einbettungen und Tests.

## Nächste Schritte

- [Admin-Panel anpassen](/docs/frontend/customizing): Wo eigene Komponenten platziert werden können und
  Vorlagen auf Basis dieser Panels.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` und
  `useRowWrites`, die Zeilen, die diese Panels und `FieldValue` lesen.
- [Komponenten-Overrides](/docs/frontend/component-overrides): Ersetzen Sie die Ansicht
  oder das Formular, das ein Panel darstellt.
