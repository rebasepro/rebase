---
sourceHash: a9be6e44e281baff
title: Panels auf einer eigenen Seite
sidebar_label: Panels auf eigenen Seiten
description: "Zeigen Sie eine Collection, das Formular eines Datensatzes, einen Datensatz oder einen Wert auf einer eigenen Seite an: CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue und CollectionsProvider, ganz ohne Admin-Shell darum herum."
---

Unter 0.24
akzeptiert `CollectionPanel` nur einen registrierten `path` und rendert außerhalb des vollständigen Admin-Baums „Collection not found“, während `EntityFormPanel` und
`CollectionsProvider` nicht existieren.

Sie benötigen nicht die gesamte Admin-Oberfläche, um eine einzelne Tabelle anzuzeigen. `<CollectionPanel>` nimmt
die Collection als Wert entgegen und funktioniert überall unter `<Rebase>` und einem Router von React
Router, ganz ohne `<RebaseCMS>`, `<RebaseNavigation>` oder `<RebaseShell>`:

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

Ein Datensatz öffnet sich über Ihrer Seite, in einem Side-Panel oder einem Dialog, und niemals über eine URL:
Keine Admin-Route bedient die Seite, sodass `full_screen` und `split` als Side-Panel
geöffnet werden und `useUrlController().routesMounted` für Ihre eigenen
Komponenten dort `false` ist. Jeder Router funktioniert: ein einfacher `<BrowserRouter>`, ein
`<MemoryRouter>` oder ein Data Router. Ein Router ist weiterhin erforderlich. Ein Data Router
ermöglicht es zudem einem Datensatz mit ungespeicherten Änderungen, die In-App-Navigation zu stoppen; unter den
anderen schützt ihn lediglich die Seite-Verlassen-Aufforderung des Browsers. Umschließen Sie das Panel mit `<RebaseAuthGate>`, wenn die Seite
zuerst die Rebase-Anmeldung anzeigen soll.

## Was ein Panel anzeigt

<span class="since-badge" data-since="0.29">Seit 0.29</span>
Ein Panel stellt die Collection so dar wie die Admin-Oberfläche. Diese Props schränken sie auf das ein, was
Ihre Seite benötigt; keine davon ändert die eigentliche Seite der Collection.

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

- `fields` — die Eigenschaften, die es anzeigt, in genau dieser Reihenfolge und sonst nichts. In der
  Tabelle sind dies die Spalten. In der Liste, auf einer Karte und auf einer Kanban-Karte sind
  sie das, womit die Plätze der Zeile — Titel, Bild, Untertitel, Status, Datum, Relations-Chips,
  die Spalten der Liste — befüllt werden, frühere zuerst; ein Platz, den keines
  davon ausfüllt, bleibt leer. Bei diesem Panel hat dies Vorrang vor `propertiesOrder`, der
  von einem Benutzer gespeicherten Spaltenreihenfolge und `listProperties`. Vom Benutzer gezogene Spaltenbreiten
  bleiben weiterhin bestehen; die Reihenfolge wird von Ihnen vorgegeben, daher können Spalten nicht verschoben werden.
- `toolbar` — standardmäßig die vollständige Toolbar, `null` für keine oder eine, die aus ihren Einzelteilen zusammengesetzt ist:
  `CollectionToolbar` (mit `start` und `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  und `CollectionAddButton`. Sie lesen das Panel aus, in dem sie gezeichnet werden, und werfen
  andernorts einen Fehler. Plugin-Slots und der `Collection.Actions`-Override befinden sich in der
  Standard-Toolbar.
- `onRowClick` — wird mit der angeklickten Zeile aufgerufen, anstatt dass das Panel sie öffnet;
  ausgelöst durch eine Zeile, eine Karte, eine Kanban-Karte und die Bearbeiten-Aktion. Die Zeile entspricht der vom
  Server gesendeten Form, die auch `useRows`, `useRow` und `<FieldValue>` annehmen: `id`,
  ISO-Datumsstrings (`YYYY-MM-DD` für eine reine Datumsspalte) und eine belongsTo-Relation
  als Fremdschlüssel (`customerId`). Eine Relation, deren Ziel vom Panel geladen wurde,
  kommt verschachtelt unter ihrem Namen an, so wie RESTs `include` sie zurückgibt
  (`order.customer` ist die Zeile des Kunden); ihr Fremdschlüssel ist ebenfalls dort vorhanden.
- `highlightedIds` — die IDs der Zeilen, die als ausgewählt dargestellt werden, beispielsweise diejenige, die eine Seite
  neben der Liste anzeigt: `highlightedIds={selected ? [selected] : []}`.
  `[]` hebt keine hervor. Ohne diese Angabe hebt das Panel die zuletzt geöffnete Zeile hervor.
- `viewMode` — der Modus, in dem es geöffnet wird, vorrangig gegenüber dem in der URL und dem, den die
  Person zuletzt ausgewählt hat. Ein Wechsel ist weiterhin möglich.
- `title={false}` — kein Titel über dem Panel und auch keine eigene Überschrift der Listenansicht.
- `updateUrl` — standardmäßig deaktiviert: Das Panel liest und schreibt weder die `__view`-,
  Filter- noch Sortierparameter der Seite.

Die `entityActions` der Collection werden auf jeder Zeile, Karte und Kanban-Karte dargestellt –
als Buttons, wenn `collapsed: false` deklariert ist, und andernfalls im Menü der Zeile;
ein „Freigeben“ auf jeder Karte ist eine solche Aktion.

Ein Panel passt seine Größe an seine Zeilen an. Ohne Höhenangabe vom übergeordneten Element oder nur mit
einem `max-height` zeichnet eine kurze Collection ihre Toolbar und Zeilen, und eine lange
scrollt innerhalb des verfügbaren Raums bis zur Höhe des Fensters. Weisen Sie ihm eine Höhe zu, damit
es diesen Raum ausfüllt. Es richtet sein Layout nach seiner eigenen Breite aus, nicht nach der des Fensters: In einer schmalen
Spalte verwendet es sein kompaktes Layout, unabhängig vom Bildschirm.

`propertiesOrder` sortiert um und blendet niemals aus: Eine Eigenschaft, die ausgelassen wird, wird
nach den benannten dargestellt. Um eine Eigenschaft überall auszublenden, setzen Sie `admin.hideFromCollection`
darauf; um nur bestimmte an einer Stelle anzuzeigen, übergeben Sie `fields`.

## Das Formular eines einzelnen Datensatzes

`<EntityFormPanel>` macht dasselbe für das Formular eines einzelnen Datensatzes. Es lädt den Datensatz
anhand der `id`, speichert ihn über die Datenschicht von `<Rebase>`, genau wie das Formular der Admin-Oberfläche
selbst, und ruft nach jedem Speichern `onSaved` mit dem gespeicherten Datensatz in der Form auf, wie der
Server die Zeile sendet (`row`), sowie dessen `id`. Lassen Sie `id` weg, um einen
Datensatz zu erstellen. `onClose` wird aufgerufen, wenn das Formular verlassen werden soll, beispielsweise nachdem
sein Datensatz gelöscht wurde:

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Wenn jemand anderes den Datensatz löscht, während das Formular geöffnet ist, behält das Formular
die eingegebenen Daten bei und meldet, dass der Datensatz an anderer Stelle gelöscht wurde. Die Aktion „Als neu speichern“
wandelt es in ein Formular um, das einen neuen Datensatz mit diesen Werten erstellt;
`onSaved` meldet dann den neuen Datensatz.

<span class="since-badge" data-since="0.29">Seit 0.29</span> Das Formular kann
einen Teil eines Datensatzes anzeigen oder ihn nach Ihren Wünschen anordnen. `fields` zeigt nur die genannten
Felder in dieser Reihenfolge an; Abschnitte und die Seitenleiste (Rail) behalten ihre Gruppierung. `layout`
ersetzt die generierten Felder durch Ihr eigenes JSX, in dem
`<FormField name="…"/>` ein einzelnes Feld mit der Beschriftung, Größe und den Regeln darstellt, die das
generierte Formular vorsieht:

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

In beiden Fällen validiert das Formular nur die angezeigten Felder; der Server prüft
weiterhin den gesamten Datensatz. Ein Formular, das einen Datensatz erstellt und ein
Pflichtfeld ohne Standardwert auslässt, meldet dies beim Öffnen: Ein Fehler benennt das
Feld, und das Speichern bleibt blockiert, bis das Feld angezeigt wird oder einen Standardwert erhält.
`collectionOverrides` ändert die Collection nur für dieses Formular, genau wie bei
`CollectionPanel`.

Jedes Formular begrenzt den Gültigkeitsbereich seiner DOM-IDs, sodass sich zwei Formulare eine Seite teilen können. Um ein Feld
aus einem Test heraus zu finden, selektieren Sie `[data-form-field="title"]` innerhalb des
`[data-form-path="posts"]` des Formulars.

<span class="since-badge" data-since="0.29">Seit 0.29</span>
`<EntityViewPanel>` ist das schreibgeschützte Gegenstück zu `EntityFormPanel`. Es lädt den
Datensatz anhand der `id` und stellt ihn so dar wie die Datensatzseite der Admin-Oberfläche: dieselben
Abschnitte und Beschriftungen, wobei jeder Wert als Vorschau angezeigt wird – ein Enum erscheint als
Chip, ein Datum in seiner Zeitzone und eine Relation als Titel des Ziels. Es akzeptiert
`fields` und `collectionOverrides` wie das Formular und lässt dieselben Felder aus wie dieses:
solche, die eine `conditions.hidden`-Regel für diesen Datensatz verbirgt, und
solche, die der angemeldete Benutzer nicht lesen darf.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` stellt einen einzelnen Wert auf die gleiche Weise innerhalb Ihres eigenen JSX dar. Es nimmt die
gesamte Zeile entgegen, wie sie von `useRows`, `useRow` und `client.data` zurückgegeben wird, da eine
belongsTo-Relation unter ihrer Fremdschlüsselspalte (`customerId`) ankommt und nicht
unter dem Eigenschaftsnamen; `field="customer"` findet sie dort. Die Collection muss
darüber registriert sein, entweder durch `<RebaseCMS>` oder einen `CollectionsProvider`.
Eine unbekannte Collection oder ein unbekanntes Feld löst einen Fehler aus, der die entsprechende Bezeichnung nennt.

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

Die drei Panels bringen ihren eigenen `CollectionsProvider` mit, wenn sich keiner über ihnen befindet. Das ist
die darunterliegende Ebene, und Sie können ihn selbst einhängen, um einen gemeinsamen Scope für
mehrere Panels zu nutzen oder die tiefer liegenden Bausteine (`CollectionViewBinding`,
`useSidePanel`) darunter zu verwenden. Innerhalb dieses Scopes kann ein Panel seine Collection über `path` benennen:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` verwaltet eine Registry der übergebenen Collections, wobei
`modifyCollection` und `injectCollections` Ihrer Plugins wie im Admin angewendet werden,
zuzüglich der Side-Panels und Dialoge, in denen Datensätze geöffnet werden, sowie dem
Schutz vor ungespeicherten Änderungen. Halten Sie das `collections`-Array stabil: als Modulkonstante
oder via `useMemo`.

## Nächste Schritte

- [Admin anpassen](/docs/frontend/customizing): Wo eigene Komponenten
  platziert werden können und Rezepte, die auf diesen Panels aufbauen.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` und
  `useRowWrites` – die Zeilen, die diese Panels und `FieldValue` lesen.
- [Komponenten-Overrides](/docs/frontend/component-overrides): Ersetzen Sie die Ansicht
  oder das Formular, das ein Panel darstellt.
