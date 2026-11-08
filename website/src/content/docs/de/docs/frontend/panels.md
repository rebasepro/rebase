---
sourceHash: 095805c8d62157c4
title: Panels auf einer eigenen Seite
sidebar_label: Panels auf eigenen Seiten
description: "Zeigen Sie eine Collection, das Formular eines Datensatzes, einen Datensatz oder einen einzelnen Wert auf einer eigenen Seite an: CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue und CollectionsProvider, ganz ohne Admin-Shell darum herum."
---

In 0.24 akzeptiert `CollectionPanel` nur einen registrierten `path` und rendert außerhalb des vollständigen Admin-Baums „Collection not found“, und `EntityFormPanel` sowie `CollectionsProvider` existieren nicht.

Sie benötigen nicht den gesamten Admin-Bereich, um eine einzelne Tabelle anzuzeigen. `<CollectionPanel>` übernimmt die Collection als Wert und funktioniert überall unter `<Rebase>` und einem React-Router-Router, ganz ohne `<RebaseCMS>`, `<RebaseNavigation>` oder `<RebaseShell>`:

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

Ein Datensatz öffnet sich über Ihrer Seite, in einem Side-Panel oder einem Dialog, und niemals per URL: Da keine Admin-Route die Seite bedient, öffnen sich `full_screen` und `split` als Side-Panel, und `useUrlController().routesMounted` ist für Ihre eigenen Komponenten dort `false`. Jeder Router funktioniert: ein einfacher `<BrowserRouter>`, ein `<MemoryRouter>` oder ein Data Router. Ein Router ist weiterhin erforderlich. Ein Data Router ermöglicht es zudem, dass ein Datensatz mit nicht gespeicherten Änderungen die In-App-Navigation stoppt; bei den anderen schützt lediglich der Standard-Browser-Dialog beim Verlassen der Seite. Hüllen Sie das Panel in `<RebaseAuthGate>` ein, wenn die Seite zuerst den Login von Rebase anzeigen soll.

## Was ein Panel anzeigt

<span class="since-badge" data-since="0.29">Seit 0.29</span>
Ein Panel stellt die Collection genauso dar wie der Admin-Bereich. Diese Props schränken sie auf das ein, was Ihre Seite benötigt; keine davon verändert die eigentliche Seite der Collection.

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

- `fields` — die Eigenschaften, die es anzeigt, in genau dieser Reihenfolge und sonst nichts. In der Tabelle sind dies die Spalten. In der Liste, auf einer Karte und auf einer Kanban-Karte sind sie das, womit die Plätze der Zeile — Titel, Bild, Untertitel, Status, Datum, Relations-Chips, die Spalten der Liste — befüllt werden, frühere zuerst; ein Platz, den keines davon ausfüllt, bleibt leer. Bei diesem Panel hat dies Vorrang vor `propertiesOrder`, der von einem Benutzer gespeicherten Spaltenreihenfolge und `listProperties`. Vom Benutzer per Drag-and-Drop geänderte Spaltenbreiten bleiben weiterhin erhalten; die Reihenfolge wird von Ihnen vorgegeben, daher können Spalten nicht verschoben werden.
- `toolbar` — standardmäßig die vollständige Toolbar, `null` für keine, oder eine aus ihren Einzelteilen zusammengesetzte: `CollectionToolbar` (mit `start` und `end`), `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle` und `CollectionAddButton`. Sie lesen das Panel aus, in dem sie gerendert werden, und werfen andernorts einen Fehler. Plugin-Slots und der `Collection.Actions`-Override befinden sich in der Standard-Toolbar.
- `onRowClick` — wird mit der angeklickten Zeile und deren ID aufgerufen, anstatt dass das Panel sie öffnet; ausgelöst durch eine Zeile, eine Karte, eine Kanban-Karte oder die Bearbeiten-Aktion. Die Zeile entspricht der vom Server gesendeten Struktur, die auch `useRows`, `useRow` und `<FieldValue>` erwarten: exakt ihre Spalten, ISO-Datumsstrings (`YYYY-MM-DD` für eine reine Datumsspalte) und eine belongsTo-Relation als Fremdschlüssel (`customerId`). Eine Relation, deren Ziel das Panel geladen hat, wird verschachtelt unter ihrem Namen übergeben, so wie RESTs `include` sie zurückgibt (`order.customer` ist die Zeile des Kunden); ihr Fremdschlüssel ist ebenfalls vorhanden. Die ID ist der String, über den der Admin-Bereich den Datensatz adressiert — sein Primärschlüssel bzw. bei einem zusammengesetzten Schlüssel die mit `:::` verbundenen Teile —, den `highlightedIds` und `useSidePanel().open` annehmen. `row.id` ist die `id`-Spalte des Datensatzes, sofern die Tabelle eine hat, mit dem Typ dieser Spalte: `5` für einen Integer-Schlüssel, dessen ID `"5"` lautet.
- `highlightedIds` — die IDs der Zeilen, die als ausgewählt dargestellt werden, beispielsweise diejenige, die eine Seite neben der Liste anzeigt: `highlightedIds={selected ? [selected] : []}`. `[]` hebt keine hervor. Ohne diesen Prop hebt das Panel die zuletzt geöffnete Zeile hervor. IDs werden als Strings verglichen, sodass `5` und `"5"` eines Integer-Schlüssels dieselbe Zeile bezeichnen.
- `where` — welche Zeilen enthalten sind, genau wie von `useRows` erwartet: `where={{ status: ["==", "pending"] }}`. Filter, die vom Benutzer für andere Felder gesetzt werden, werden damit kombiniert, und die im Prop definierten Felder können über die Toolbar weder geändert noch gelöscht werden. Da es sich nach dem Prop richtet, kann es über den State von einer Tab-Leiste oder einem angeklickten Diagrammbalken gesteuert werden. Es überschreibt den `fixedFilter` der Collection Feld für Feld.
- `viewMode` — der Modus, in dem es geöffnet wird; hat Vorrang vor dem Wert in der URL und dem vom Benutzer zuletzt gewählten Modus. Benutzer können den Modus dennoch weiterhin wechseln.
- `title={false}` — kein Titel über dem Panel und auch keine eigene Überschrift der Listenansicht.
- `updateUrl` — standardmäßig deaktiviert: Das Panel liest und schreibt weder die `__view`-, Filter- noch Sortierparameter der Seite.

Die `entityActions` der Collection werden in jeder Zeile, auf jeder Karte und auf jeder Kanban-Karte dargestellt: als Schaltflächen, wenn sie als `collapsed: false` deklariert sind, und ansonsten im Kontextmenü der Zeile — ein „Approve“ auf jeder Karte ist eine solche Aktion.

Ein Panel passt seine Größe an seine Zeilen an. Ohne Höhenvorgabe des übergeordneten Elements oder nur mit einer `max-height` zeichnet eine kurze Collection ihre Toolbar sowie Zeilen, während eine lange innerhalb des verfügbaren Raums bis zur Fensterhöhe scrollt. Weisen Sie ihm eine Höhe zu, um den Raum auszufüllen. Das Layout richtet sich nach der eigenen Breite, nicht nach der des Fensters: In einer schmalen Spalte nutzt es sein kompaktes Layout, unabhängig vom Bildschirm.

`propertiesOrder` sortiert lediglich um und blendet niemals aus: Eine Eigenschaft, die ausgelassen wird, wird nach den benannten dargestellt. Um eine Eigenschaft überall auszublenden, setzen Sie `admin.hideFromCollection` darauf; um an einer Stelle nur bestimmte anzuzeigen, übergeben Sie `fields`.

## Das Formular eines einzelnen Datensatzes

`<EntityFormPanel>` tut dasselbe für das Formular eines einzelnen Datensatzes. Es lädt den Datensatz anhand der `id`, speichert ihn über die Datenschicht von `<Rebase>` wie das Formular des Admin-Bereichs selbst und ruft nach jedem Speichern `onSaved` mit dem gespeicherten Datensatz (wie der Server die Zeile liefert, `row`) und dessen `id` auf. Lassen Sie `id` weg, um einen Datensatz zu erstellen. `onClose` wird aufgerufen, wenn das Formular verlassen werden soll, beispielsweise nachdem der Datensatz gelöscht wurde:

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Wie `CollectionPanel` akzeptieren das Formular und `EntityViewPanel` eine registrierte Collection über `path`, ohne dass ein Konfigurationsobjekt vorliegen muss: `<EntityFormPanel path="posts" id={postId}/>`. Unter `<RebaseCMS>` oder einem `CollectionsProvider`, der sie registriert, ist das alles, was sie benötigen. Wenn darüber kein Scope existiert, übergeben Sie die Collection wie hier als Wert, und das Panel stellt seinen eigenen bereit; wird ein Pfad angegeben, den nichts registriert, meldet es, dass der Datensatz nicht gefunden wurde.

Wenn jemand anderes den Datensatz löscht, während das Formular geöffnet ist, behält das Formular die eingegebenen Daten und weist darauf hin, dass der Datensatz an anderer Stelle gelöscht wurde. Die Aktion „Als neu speichern“ wandelt es in ein Formular um, das einen neuen Datensatz mit diesen Werten erstellt; `onSaved` meldet anschließend den neuen Datensatz.

<span class="since-badge" data-since="0.29">Seit 0.29</span> Das Formular kann einen Teil eines Datensatzes anzeigen oder nach Ihren Wünschen angeordnet werden. `fields` zeigt nur die angegebenen Felder in genau dieser Reihenfolge an; Abschnitte und die Seitenleiste (Rail) behalten ihre Gruppierung bei. `layout` ersetzt die generierten Felder durch Ihr eigenes JSX, in dem `<FormField name="…"/>` ein einzelnes Feld mit dem Label, der Größe und den Regeln darstellt, die das generierte Formular dafür vorsieht:

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

In beiden Fällen validiert das Formular nur die angezeigten Felder; der Server prüft weiterhin den gesamten Datensatz. Ein Formular, das einen Datensatz erstellt und ein Pflichtfeld ohne Standardwert auslässt, weist beim Öffnen darauf hin: Ein Fehler nennt das Feld, und das Speichern bleibt blockiert, bis das Feld angezeigt wird oder einen Standardwert erhält. `collectionOverrides` ändert die Collection nur für dieses Formular, genau wie bei `CollectionPanel`.

Jedes Formular begrenzt seine DOM-IDs auf den eigenen Scope, sodass zwei Formulare auf derselben Seite koexistieren können. Um ein Feld aus einem Test heraus zu finden, selektieren Sie `[data-form-field="title"]` innerhalb von `[data-form-path="posts"]` des Formulars.

<span class="since-badge" data-since="0.29">Seit 0.29</span>
`<EntityViewPanel>` ist das schreibgeschützte Gegenstück zu `EntityFormPanel`. Es lädt den Datensatz anhand der `id` und stellt ihn so dar wie die Datensatzseite des Admin-Bereichs: mit denselben Abschnitten und Labels, wobei jeder Wert als Vorschau gerendert wird — ein Enum als Chip, ein Datum in seiner Zeitzone und eine Relation als Titel des Zielobjekts. Es akzeptiert `fields` und `collectionOverrides` wie das Formular und lässt genau die Felder aus, die auch das Formular auslässt: Felder, die eine `conditions.hidden`-Regel für diesen Datensatz verbirgt, sowie Felder, die der angemeldete Benutzer nicht lesen darf.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` stellt einen einzelnen Wert auf die gleiche Weise innerhalb Ihres eigenen JSX dar. Es nimmt die gesamte Zeile entgegen, wie sie von `useRows`, `useRow` und `client.data` zurückgegeben wird, da eine belongsTo-Relation unter ihrer Fremdschlüsselspalte (`customerId`) und nicht unter dem Namen der Eigenschaft übergeben wird; `field="customer"` findet sie dort. Es setzt voraus, dass die Collection darüber registriert ist, entweder über `<RebaseCMS>` oder einen `CollectionsProvider`. Eine unbekannte Collection oder ein unbekanntes Feld wirft einen Fehler, der den Namen nennt.

```tsx
import { useRows } from "@rebasepro/app";
import { FieldValue } from "@rebasepro/cms";

function OrderList() {
    const { rows } = useRows("orders", { limit: 20 });
    return rows.map(row => (
        <div key={String(row.id)} className="flex gap-4">
            <FieldValue row={row} path="orders" field="customer"/>
            <FieldValue row={row} path="orders" field="status"/>
            <FieldValue row={row} path="orders" field="placedAt"/>
        </div>
    ));
}
```

## Mehrere Panels in einem Scope

Die drei Panels bringen ihren eigenen `CollectionsProvider` mit, wenn sich kein übergeordneter im Baum befindet. Das ist die darunterliegende Ebene, und Sie können ihn selbst mounten, um einen gemeinsamen Scope für mehrere Panels zu nutzen oder die tiefer liegenden Bausteine (`CollectionViewBinding`, `useSidePanel`) darunter zu verwenden. Innerhalb dieses Scopes kann ein Panel seine Collection per `path` angeben:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` verwaltet eine Registry der übergebenen Collections, wobei `modifyCollection` und `injectCollections` Ihrer Plugins wie im Admin-Bereich angewendet werden, ergänzt um die Side-Panels und Dialoge, in denen sich Datensätze öffnen, sowie den Schutz vor ungespeicherten Änderungen. Halten Sie das `collections`-Array stabil: als Modulkonstante oder via `useMemo`.

## Nächste Schritte

- [Anpassen des Admin-Bereichs](/docs/frontend/customizing): Wo eigene Komponenten eingesetzt werden können und welche Rezepte auf diesen Panels aufbauen.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` und `useRowWrites` – die Zeilen, die diese Panels und `FieldValue` lesen.
- [Komponenten-Overrides](/docs/frontend/component-overrides): Ersetzen Sie die Ansicht oder das Formular, das ein Panel darstellt.
