---
sourceHash: afe3986ede62abca
title: customizeTable
sidebar_label: customizeTable
description: "customizeTable gibt an, wie sich die Collection einer Tabelle von dem unterscheidet, was das CMS ableitet: Labels, Icon, Ansichten, Kanban, Display-Slots, Formular-Layout, Aktionen und feldbezogene Optionen mit React-Komponenten, die als Wert importiert werden. Jede Option mit Typ und Auswirkung."
---

Wenn Sie das CMS verwenden, besitzt jede vom Backend bereitgestellte Tabelle bereits
eine Collection im Panel, die aus der Tabelle selbst abgeleitet wird (siehe
[Wie Tabellen zu Collections werden](/docs/collections/)). `customizeTable` legt
ausschließlich fest, was davon abweichen soll. Es befindet sich im Frontend neben dem
übrigen React-Code, sodass ein benutzerdefiniertes Feld eine Komponente ist, die wie
jede andere importiert wird.

```tsx
// frontend/src/cms/posts.tsx
import { customizeTable, updateRecord } from "@rebasepro/cms";
import type { posts } from "../../../backend/schema/posts";
import { CustomMarkdownEditor } from "../../../../../components/CustomMarkdownEditor";

export const postsCms = customizeTable<typeof posts>("posts", {
    name: "Blog Posts",
    singularName: "Blog Post",
    icon: "FileText",
    group: "Content",

    defaultViewMode: "cards",
    enabledViews: ["table", "cards", "kanban"],
    kanban: { columnField: "status", orderField: "__order" },

    display: {
        title: "title",
        image: "heroImage",
        status: "status",
        date: "publishDate",
    },

    fields: {
        status: {
            enumLabels: {
                draft:        { label: "Draft", color: "gray" },
                needs_review: { label: "Needs Review", color: "orange" },
                published:    { label: "Published", color: "green" },
                archived:     { label: "Archived", color: "red" },
            },
        },
        title:   { multiline: true },
        content: { Field: CustomMarkdownEditor },
        orgId:   { hidden: true },
    },

    entityActions: [
        {
            key: "publish",
            name: "Publish",
            icon: "Send",
            collapsed: false,
            isEnabled: ({ row }) => row?.status !== "published",
            onClick: ({ id, context }) =>
                updateRecord(context, "posts", id, { status: "published", publishDate: new Date().toISOString() }, "Published"),
        },
    ],
});
```

Übergeben Sie das Ergebnis an `<RebaseCMS tableCustomizations={[postsCms]}/>`; siehe
[Frontend-Übersicht](/docs/frontend/#rebasecms-props).

:::note[Umstieg von Collections?]
Dies sind die Darstellungsoptionen des alten `admin`-Blocks, auf oberster Ebene
und unter einigen neuen Namen (`fieldOrder`, `listFields`, `previewFields`,
`fields`, `kanban.columnField`, `kanban.orderField`). Die Verwendung eines alten
Namens wirft einen Fehler mit dem Verweis auf den neuen Namen.
:::

## Speicherort der Dateien

```text
frontend/src/cms/
├── index.ts        # export const tableCustomizations = [postsCms, …]
├── posts.tsx       # customizeTable("posts", …)
└── events.ts       # defineFirestoreCollection(…), for Firestore
```

Die Namen sind eine Konvention. Entscheidend ist, dass die Ergebnisse
`<RebaseCMS tableCustomizations>` erreichen. Eine Tabelle ohne Datei wird so
angezeigt, wie sie abgeleitet wurde.

Das Frontend importiert ausschließlich den **Typ** der Tabelle: `import type { posts }`.
Ein Typ-Import wird beim Erstellen des Bundles entfernt, sodass Hooks und Servercode
aus `backend/schema` niemals in den Browser gelangen. Ein Wert-Import aus `backend/`
in Frontend-Code ist das Einzige, was vermieden werden muss. Das Backend importiert
niemals etwas aus dem Frontend.

## Der Slug und der Typ

Das erste Argument ist der Slug der Tabelle: der Name, unter dem sie definiert wurde,
oder der zugewiesene `slug`. Mit der Tabelle als Typargument werden der Slug, jeder
Schlüssel eines Feldes und jeder Enum-Wert anhand der Tabelle überprüft:

| Geprüft gegen `typeof posts` | Ein Fehler ist |
|---|---|
| das erste Argument | ein Typfehler, sofern es nicht der Slug der Tabelle ist |
| `fields`-Schlüssel | ein Spaltenschlüssel oder ein Relationsname |
| `fieldOrder`-, `listFields`-, `form`-Einträge | ein Feld, ein Pfad mit Punktnotation (`"seo.title"`), `subcollection:<relation>` oder der Schlüssel eines zusätzlichen Feldes |
| `display`, `sort`, `fixedFilter`, `defaultFilter`, `filterPresets` | ein Feld oder ein Pfad in ein solches |
| `kanban.columnField` | eine Spalte mit einer geschlossenen Menge von Strings (`col.enum([...])` oder `.oneOf([...])`) |
| `kanban.orderField` | eine Textspalte |
| `enumLabels`, `enumOrder` | Werte, die die Spalte annehmen kann; eine Spalte ohne geschlossene Wertemenge akzeptiert keines von beiden |
| Feldoptionen | jene des Spaltentyps: `multiline` bei einer Textspalte, `format` bei einer Zahl |
| `entityActions[].onClick` und ähnliche | `row` entspricht dem `InferRow` der Tabelle |

`defineTable("blog_posts", { slug: "posts", … })` wird als
`customizeTable<typeof posts>("posts", …)` angepasst: weiterhin ein einziges Typargument.
Ohne Typargument akzeptiert `customizeTable("posts", { … })` dieselben Optionen mit
lockerer Typisierung.

## Was abgelehnt und was übersprungen wird

`customizeTable` überprüft beim Laden des Moduls Aspekte, die der Compiler nicht
erkennen kann, und bricht mit Hinweisen ab, was stattdessen zu verwenden ist:

- eine unbekannte Option, mit Vorschlag der ähnlichsten bekannten Option oder dem
  neuen Namen einer alten `admin`-Option;
- eine Komponente, die als String-Pfad, als Lazy-Thunk `() => import(…)` oder als
  etwas anderes übergeben wurde, das keine React-Komponente ist;
- eine Entity Action ohne `name` oder `onClick`, eine benutzerdefinierte Ansicht
  ohne `Builder`, ein `kanban` ohne `columnField`, ein `referenceTo`, das kein
  Slug ist;
- `fields` innerhalb der `overrides` einer Relation: Passen Sie die Zieltabelle
  über deren eigenes `customizeTable` an.

```text
customizeTable("posts"): unknown options:
  - `propertiesOrder` — it is `fieldOrder` now
  - `iconn` — did you mean `icon`?
```

Das Ergebnis ist unveränderlich (frozen). Die Übergabe von zwei Anpassungen desselben
Slugs an `<RebaseCMS>` wirft einen Fehler: Welches Ergebnis Vorrang hätte, hinge von
der Import-Reihenfolge ab.

Was der Server bereitstellt, kann von dem abweichen, wogegen entwickelt wurde. Eine
Spalte kann für den jeweiligen Aufrufer vorenthalten sein (siehe
[Feldzugriff](/docs/collections/field-access/)), oder die Tabelle hat sich inzwischen
geändert. Dies stellt zur Laufzeit keinen Fehler dar. In der Entwicklung gibt das
Panel pro Abweichung eine Warnung aus und überspringt den Eintrag:

- eine Anpassung, deren Slug mit keiner bereitgestellten Tabelle übereinstimmt, wird ignoriert;
- ein Feld, ein Spalteneintrag, ein Display-Slot, ein Formulareintrag oder ein Kanban-Feld,
  das von der Tabelle nicht bereitgestellt wird, wird verworfen;
- eine Option, die nicht für den Typ des Feldes gilt (`format` bei einer Textspalte,
  `enumLabels` bei einem Feld ohne geschlossene Wertemenge), wird ignoriert.

Der Rest der Anpassung bleibt weiterhin wirksam.

## Tabellenoptionen

Jeder Schlüssel ist optional. Ein weggelassener Schlüssel behält die vom Panel
abgeleiteten Werte bei.

### Identität und Navigation

| Option | Typ | Auswirkung |
|---|---|---|
| `name` | `string` | Die Pluralbezeichnung: Drawer, Seitenüberschrift. Andernfalls aus dem Tabellennamen abgeleitet. |
| `singularName` | `string` | Die Bezeichnung eines einzelnen Datensatzes. |
| `description` | `string` | Wird unter der Überschrift und auf der Startkachel angezeigt. |
| `metadata` | `Record<string, unknown>` | Eigene Daten, die mit den `metadata` der Tabelle zusammengeführt werden. |
| `icon` | `string \| ReactNode` | Ein Lucide-Icon-Name (`"FileText"`) oder ein Element. |
| `group` | `string` | Die Navigationsgruppe. |
| `hideFromNavigation` | `boolean` | Nicht im Drawer enthalten. Weiterhin per URL und als Referenzziel erreichbar. |
| `hideFromEntityViews` | `boolean` | Wird nicht als Tab bei Datensätzen von Tabellen angeboten, die sich darauf beziehen. |

### Ansichten

| Option | Typ | Auswirkung |
|---|---|---|
| `defaultViewMode` | `ViewMode` | Die Standardansicht für Besucher: `"list"`, `"table"`, `"cards"`, `"kanban"` oder der Schlüssel einer benutzerdefinierten Ansicht. Standardmäßig `"list"`. |
| `enabledViews` | `ViewMode[]` | Die im Ansichtswechsler verfügbaren Ansichten. |
| `kanban` | `{ columnField, orderField? }` | Das Board: die Spalte, nach der gruppiert wird, und die Textspalte zur Speicherung von Sortierschlüsseln. Siehe [Ansichtsmodi](/docs/frontend/view-modes/#kanban). |
| `customViews` | `(string \| TableCustomView)[]` | Zusätzliche Arten zur Darstellung der Zeilen: `{ key, name, Builder }` oder der Schlüssel einer unter `<RebaseCMS collectionViews>` registrierten Ansicht. |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | Die standardmäßige Zeilenhöhe. |

`kanban` nimmt zwei Schlüssel entgegen:

| Schlüssel | Typ | Auswirkung |
|---|---|---|
| `columnField` | Spaltenschlüssel | Die Spalte, aus der die Spalten des Boards hervorgehen: ein `col.enum([...])` oder `.oneOf([...])` von Strings. |
| `orderField` | Textspaltenschlüssel | Wo die Position einer Karte innerhalb ihrer Spalte als fraktionaler Sortierschlüssel gespeichert wird. Ohne diese Angabe wird die Reihenfolge bei jedem Lesevorgang zurückgesetzt. Die Spalte ist ausgeblendet und deaktiviert, sofern ihr `fields`-Eintrag nichts anderes festlegt. |

### Spalten und Slots

| Option | Typ | Auswirkung |
|---|---|---|
| `fieldOrder` | `TableColumnId[]` | Die Reihenfolge, in der Felder dargestellt werden. Nicht aufgeführte Felder folgen danach, sodass nichts verloren geht. |
| `listFields` | `TableColumnId[]` | Die Spalten der Tabellen- und Listenansicht: die dargestellten Felder und keine weiteren. Die Tabelle ordnet sie nach `fieldOrder` (oder der manuell gezogenen Reihenfolge), falls vorhanden, andernfalls nach `listFields`. Nicht aufgeführte Felder verbleiben auf dem Datensatz. |
| `previewFields` | `TableFieldKey[]` | Die Felder, die angezeigt werden, wenn ein Datensatz dieser Tabelle von einer anderen referenziert wird. |
| `display` | `TableDisplay` | Was die Felder `title`, `subtitle`, `image`, `status`, `date` und `tags` eines Datensatzes befüllt: ein Feldpfad oder ein Resolver. Siehe [Display-Slots](/docs/frontend/view-modes/#display-slots). |
| `additionalFields` | `TableAdditionalField[]` | Berechnete Spalten der Tabelle. Nicht Teil des Datensatzes, es sei denn, `form.sections` oder `form.sidebar` führt eine auf. Siehe [Zusätzliche Spalten](/docs/frontend/additional-columns/). |
| `hideIdFromCollection` | `boolean` | Blendet die ID-Spalte aus. |

Eine berechnete Spalte akzeptiert:

| Schlüssel | Typ | Auswirkung |
|---|---|---|
| `key` | `string` | Identifiziert die Spalte. In `fieldOrder` als `"total" as AdditionalFieldKey` angeben. |
| `name` | `string` | Die Kopfzeilenbeschriftung. |
| `width` | `number` | Die Breite in Pixeln. |
| `Builder` | `(props) => ReactNode` | Rendert die Zelle aus `{ row, id, context }`. |
| `dependencies` | Feldpfad oder Pfade | Felder, deren Änderung ein Neu-Rendern der Zelle auslöst. |
| `value` | `(props) => string \| number` | Der Wert der Zelle für den Export. Kann asynchron sein. |

### Abfragestandards

| Option | Typ | Auswirkung |
|---|---|---|
| `sort` | `OrderBySpec` | Die Standardsortierung: `["publishDate", "desc"]` oder mehrere Schlüssel nacheinander. |
| `fixedFilter` | `FilterValues` | Ein Filter, den der Besucher nicht ändern kann. |
| `defaultFilter` | `FilterValues` | Der anfängliche Filter für Besucher. |
| `filterPresets` | `FilterPreset[]` | 1-Klick-Filter in der Toolbar: `{ label?, filterValues, sort? }`. |
| `pagination` | `boolean \| number` | Seitenweises Laden (`true` oder die Seitengröße) oder alles auf einmal (`false`). |

Siehe [Filter und Sortierung](/docs/frontend/view-modes/#filters-presets-and-sort).

### Verhalten

| Option | Typ | Auswirkung |
|---|---|---|
| `inlineEditing` | `boolean` | Zellen direkt in der Tabelle bearbeiten. |
| `selectionEnabled` | `boolean` | Zeilen können ausgewählt werden. |
| `selectionController` | `SelectionController` | Eine Auswahl, die außerhalb der Ansicht verwaltet wird (`useSelectionController`). |
| `exportable` | `boolean \| ExportConfig` | Ob die Toolbar einen Export und zusätzliche Spalten dafür anbietet. Siehe [Import und Export](/docs/frontend/data-import-export/). |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | Art und Weise, wie ein Datensatz geöffnet wird. |
| `defaultEntityAction` | `"view" \| "edit"` | Ob das Anklicken eines Datensatzes diesen zur Ansicht oder Bearbeitung öffnet. |
| `sideDialogWidth` | `number \| string` | Die Breite des Seitenpanels, in dem sich ein Datensatz öffnet. |
| `defaultSelectedView` | `string \| DefaultSelectedViewBuilder` | Der Tab, auf dem sich ein Datensatz standardmäßig öffnet. |

### Formular

| Option | Typ | Auswirkung |
|---|---|---|
| `form` | `{ sidebar?, sections?, showRecordMeta? }` | Abschnitte und die Leiste neben dem Formular. Siehe [Formular-Layout](/docs/frontend/form-layout/). |
| `formView` | `{ Builder, includeActions? }` | Eine Komponente, die das generierte Formular ersetzt. `includeActions` behält „Speichern“ und „Verwerfen“ in der Leiste des Datensatzes bei. |
| `formAutoSave` | `boolean` | Speichern während der Eingabe. |
| `alwaysApplyDefaultValues` | `boolean` | Deklarierte Standardwerte beim Öffnen in leere Felder eines gespeicherten Datensatzes einfügen. |
| `includeJsonView` | `boolean` | Fügt einen Tab mit dem Datensatz als JSON hinzu. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | Ungespeicherte Änderungen im lokalen Speicher (LocalStorage) behalten. |
| `hideIdFromForm` | `boolean` | Blendet die ID im Formular aus. |

`form` akzeptiert:

| Schlüssel | Typ | Auswirkung |
|---|---|---|
| `sidebar` | Feld-IDs | Felder, die in die seitliche Leiste neben dem Formular ausgelagert werden. |
| `sections` | Abschnitte | Die Abschnitte der Hauptspalte (siehe unten). |
| `showRecordMeta` | `boolean` | Zeigt ID und Zeitstempel des Datensatzes in der Seitenleiste an. |

Jeder Abschnitt akzeptiert:

| Schlüssel | Typ | Auswirkung |
|---|---|---|
| `key` | `string` | Identifiziert den Abschnitt; zugleich die `id` seines Ankers. |
| `title` | `string` | Die Überschrift. Entfällt, wenn weggelassen. |
| `fields` | Feld-IDs | Die Felder im Abschnitt in entsprechender Reihenfolge. |
| `collapsed` | `boolean` | Standardmäßig eingeklappt. |
| `collapsible` | `boolean` | Kann eingeklappt werden. |
| `readVariant` | `"grid" \| "summary"` | Darstellungsform des Abschnitts, wenn der Datensatz angezeigt statt bearbeitet wird. |

### Aktionen, Ansichten und Overrides

| Option | Typ | Auswirkung |
|---|---|---|
| `entityActions` | `(string \| TableEntityAction)[]` | Aktionen auf einem Datensatz. Ein Objekt oder der Schlüssel einer unter `<RebaseCMS entityActions>` registrierten Aktion. Siehe [Entity Actions](/docs/frontend/entity-actions/). |
| `disableDefaultActions` | `("edit" \| "copy" \| "delete")[]` | Integrierte Aktionen, die diese Tabelle nicht anbieten soll. |
| `resetPasswordAction` | `false \| TableEntityAction` | Nur für die Auth-Tabelle (`defineAuthTable`): `false` entfernt die integrierte Aktion zum Zurücksetzen des Passworts; eine Aktion ersetzt sie (unabhängig davon, was der Auth-Adapter unterstützt: das Backend liegt bei Ihnen). Wird bei jeder anderen Tabelle mit einer Warnung ignoriert. |
| `entityViews` | `(string \| TableEntityView)[]` | Zusätzliche Tabs auf einem Datensatz. Siehe [Entity Views](/docs/frontend/entity-views/). |
| `Actions` | `Component[]` | Komponenten, die in der Toolbar der Collection gerendert werden. |
| `components` | `TableComponentOverrides` | Komponenten-Overrides auf Collection-Ebene, jeweils `{ Component, wrap? }`. Siehe [Komponenten-Overrides](/docs/frontend/component-overrides/#collection-level-component-overrides). |
| `browserCallbacks` | `CollectionCallbacks` | Callbacks, die im Panel nach den Server-Hooks ausgeführt werden. Reine Darstellungsebene: Werden an jeden Besucher ausgeliefert und bieten keine Sicherheit. Siehe [React-Hooks](/docs/hooks/). |
| `fields` | `TableFields` | Feldbezogene Optionen, zugeordnet nach Spalte oder Relation (siehe unten). |

## Feldoptionen

`fields.<key>` akzeptiert die allgemeinen Optionen aller Felder sowie jene des
jeweiligen Spaltentyps. [Felder](/docs/collections/properties/) zeigt jede Option
zusammen mit dem entsprechenden Widget.

### Jedes Feld

| Option | Typ | Auswirkung |
|---|---|---|
| `name` | `string` | Die Beschriftung. Andernfalls aus dem Schlüssel abgeleitet (`publishDate` → "Publish Date"). |
| `description` | `string` | Hilfetext unterhalb des Feldes. |
| `hidden` | `boolean` | Aus Tabellen-, Listen- und Kartenansichten sowie vom Datensatz (Formular und Leseansicht) ausgeschlossen. Über die API weiterhin les- und schreibbar. |
| `hiddenInForm` | `boolean` | Vom Datensatz ausgeschlossen (Formular und Leseansicht). In den Ansichten weiterhin vorhanden. |
| `disabled` | `boolean \| { disabledMessage?, clearOnDisabled? }` | Das Bedienelement wird ausgegraut. `disabledMessage` nennt die Begründung daneben; `clearOnDisabled` leert den Wert bei Deaktivierung. |
| `readOnly` | `boolean` | Der Wert wird als Text ohne Bedienelement gerendert. |
| `Field` | `Component` | Ersetzt das Formular-Bedienelement. Die Komponente selbst. Siehe [Benutzerdefinierte Felder](/docs/frontend/custom-fields/). |
| `Preview` | `Component` | Ersetzt die Darstellung des Werts außerhalb des Formulars. |
| `Filter` | `Component` | Ersetzt das Filter-Bedienelement für dieses Feld. |
| `columnWidth` | `number` | Die Spaltenbreite in der Tabelle in Pixeln. |
| `filledByServer` | `boolean` | Ein Server-Hook befüllt es beim Erstellen: Das Formular erlaubt das Anlegen ohne diesen Wert. Eine Spalte mit `.serverDefault()` in ihrem `defineTable` ist dies bereits; setzen Sie dies nur, um die Tabelle zu überschreiben (`false` macht es wieder erforderlich). |
| `span` | `1 \| 2 \| 3 \| 4` | Über wie viele der vier Spalten des Formular-Rasters sich das Feld erstreckt. |
| `customProps` | `unknown` | Wird unverändert an `Field` und `Preview` weitergereicht. |
| `filterOperators` | `WhereFilterOp[]` | Schränkt die angebotenen Filteroperatoren ein. `[]` deaktiviert das Filtern für dieses Feld. |
| `propertyConfig` | `string` | Der Schlüssel eines unter `<Rebase propertyConfigs>` registrierten Feldtyps. |
| `conditions` | `PropertyConditions` | JSON-Logic-Regeln, die das Feld anhand der Werte des Datensatzes ausblenden, deaktivieren oder verpflichtend machen. Nur im Formular. Siehe [Bedingungen](/docs/collections/validation-and-conditions/#conditional-fields). |
| `dynamicProps` | `(props) => options \| undefined` | Gibt die aktuell geltenden Feldoptionen basierend auf dem bearbeiteten Datensatz zurück. Nur im Formular. |
| `metadata` | `Record<string, unknown>` | Eigene Daten. |

### Text- und UUID-Spalten

| Option | Typ | Auswirkung |
|---|---|---|
| `multiline` | `boolean` | Ein mehrzeiliges Eingabefeld, das mit dem Inhalt wächst. |
| `markdown` | `boolean` | Ein Markdown-Editor mit Vorschau. |
| `previewAsTag` | `boolean` | Als Chip statt als Text dargestellt. |
| `clearable` | `boolean` | Fügt ein Steuerelement hinzu, das den Wert auf `null` setzt. |
| `urlPreview` | `PreviewType \| boolean` | Vorschau einer URL im Wert: `"image"`, `"video"`, `"audio"`, `"file"` oder `true` für einen Link. |
| `referenceTo` | `string` | Die Spalte enthält den Schlüssel eines Datensatzes einer anderen Collection einer beliebigen Datenquelle: Sie wird als Referenz auf den Slug dieser Collection dargestellt und ausgewählt. Siehe [Firestore](/docs/frontend/firebase/#from-a-table-to-firestore). |

### Spalten mit einer geschlossenen Wertemenge

Ein `col.enum([...])`, ein `.oneOf([...])` oder ein Array davon:

| Option | Typ | Auswirkung |
|---|---|---|
| `enumLabels` | `{ [value]?: string \| EnumLabel }` | Bezeichnungen für einzelne Werte. Nicht aufgeführte Werte behalten ihr abgeleitetes Label und ihre Farbe. |
| `enumOrder` | `value[]` | Reihenfolge, in der Werte angeboten und Kanban-Spalten angeordnet werden. Andernfalls die Reihenfolge der Spalte selbst. |
| `previewAsTag` | `boolean` | Bei einem `col.enum()`: als Chip dargestellt. |
| `clearable` | `boolean` | Bei einem `col.enum()`: fügt ein Steuerelement hinzu, das den Wert auf `null` setzt. |

Ein `EnumLabel` akzeptiert:

| Schlüssel | Typ | Auswirkung |
|---|---|---|
| `label` | `string` | Der Text auf dem Chip und im Auswahlmenü. |
| `color` | `ColorKey \| ColorScheme` | Ein Chip-Farbschlüssel (`"green"`, `"orangeDark"`) oder ein `{ color, text }`-Farbschema. Ein Wert ohne Farbangabe behält seine Standardfarbe. |
| `disabled` | `boolean` | Wird angezeigt, steht aber nicht zur Auswahl bereit. |

### Zahlenspalten

| Option | Typ | Auswirkung |
|---|---|---|
| `clearable` | `boolean` | Fügt ein Steuerelement hinzu, das den Wert auf `null` setzt. |
| `format` | `NumberFormatOptions` | Formatiert die Zahl als Währung, Prozentwert oder mit festen Dezimalstellen. |

`format` akzeptiert `style` (`"decimal"`, `"currency"`, `"percent"`), `currency` (ein
ISO-Code, erforderlich bei `"currency"`), `locale` (andernfalls das des Betrachters),
`minimumFractionDigits`, `maximumFractionDigits` und `notation`
(`"standard"` oder `"compact"`, wodurch `12000` als `12K` dargestellt wird). Es verändert
lediglich die Anzeige, niemals den gespeicherten Wert.

### Datums-, Zeitstempel- und Uhrzeitspalten

| Option | Typ | Auswirkung |
|---|---|---|
| `clearable` | `boolean` | Fügt ein Steuerelement hinzu, das den Wert auf `null` setzt. |
| `mode` | `"date" \| "date_time"` | Nur ein Datum oder Datum und Uhrzeit auswählen und anzeigen. Andernfalls vom Spaltentyp abgeleitet. |
| `timezone` | `string` | Die IANA-Zeitzone, in der der Wert angezeigt und ausgewählt wird (`"Europe/Madrid"`). Andernfalls die des Betrachters. |

### Vektorspalten

| Option | Typ | Auswirkung |
|---|---|---|
| `clearable` | `boolean` | Fügt ein Steuerelement hinzu, das den Wert auf `null` setzt. |

### Speicher-Spalten (Storage)

| Option | Typ | Auswirkung |
|---|---|---|
| `storage` | `StorageCustomization` | Die Upload-Funktionen, die im Browser ausgeführt werden. |
| `clearable` | `boolean` | Fügt ein Steuerelement hinzu, das den Wert auf `null` setzt. |
| `urlPreview` | `PreviewType \| boolean` | Vorschau der gespeicherten URL. |

`storage` nimmt ausschließlich Funktionen entgegen; die serialisierbaren Optionen
verbleiben auf `col.storage({ … })` (siehe [Datei-Uploads](/docs/collections/file-uploads/)):

| Schlüssel | Signatur | Auswirkung |
|---|---|---|
| `path` | `(context) => string` | Der Zielordner für Datei-Uploads; ersetzt das `path`-Template der Spalte. |
| `fileName` | `(context) => string \| Promise<string>` | Der gespeicherte Dateiname; ersetzt das `fileName`-Template der Spalte. |
| `processFile` | `(file) => Promise<File>` | Transformiert eine Datei vor dem Upload. |
| `postProcess` | `(pathOrUrl) => Promise<string>` | Transformiert den gespeicherten Pfad oder die URL vor dem Schreiben in die Spalte. |
| `previewUrl` | `(fileName) => string` | Die URL zur Vorschau einer gespeicherten Datei. |

### Array-Spalten

| Option | Typ | Auswirkung |
|---|---|---|
| `expanded` | `boolean` | Alle Elemente sind beim Laden ausgeklappt. |
| `minimalistView` | `boolean` | Elemente ohne Rahmen und Header. |
| `sortable` | `boolean` | Elemente können per Drag-and-Drop neu geordnet werden. |
| `canAddElements` | `boolean` | Neue Elemente können hinzugefügt werden. |
| `of` | Feldoptionen | Die Optionen für jedes einzelne Element. |
| `storage` | `StorageCustomization` | Die Upload-Funktionen für `col.storage().multiple()`. |

Auf einem Array definierte `enumLabels` und `enumOrder` gelten für dessen Elemente.

### JSON-Spalten

| Option | Typ | Auswirkung |
|---|---|---|
| `expanded` | `boolean` | Die Felder des Dokuments sind beim Laden ausgeklappt. |
| `minimalistView` | `boolean` | Die Felder des Dokuments ohne Rahmen. |
| `spreadChildren` | `boolean` | Felder des Dokuments werden so angeordnet, als gehörten sie direkt zum Datensatz. |
| `keyValue` | `boolean` | Als freie Schlüssel-Wert-Paare bearbeiten. |
| `previewFields` | `string[]` | Schlüssel des Dokuments, die in dieser Reihenfolge in der einzeiligen Zusammenfassung erscheinen. |
| `fields` | `{ [key]: field options }` | Die Optionen für jeden Schlüssel des Dokuments. |
| `fieldOrder` | `string[]` | Die Anzeigereihenfolge der Schlüssel des Dokuments. |
| `of` | Feldoptionen | Optionen jedes Eintrags, falls das Dokument eine Liste ist. |
| `oneOf` | `{ [variant]: field options }` | Optionen jeder Variante eines typisierten Blocks (`json.oneOf`). |

Mit `col.jsonb().$type<T>()` oder einer `json.object({…})`-Struktur werden `fields`
und `fieldOrder` über die Schlüssel des Dokuments typisiert. Siehe
[Arrays und JSON](/docs/collections/arrays-and-maps/).

In einer Tabellenzelle, einer Listenzeile oder einer Karte wird ein JSON-Dokument
einzeilig dargestellt: die ersten vier Top-Level-Schlüssel (oder die in `previewFields`),
versehen mit ihrem `name`, jeweils mit ihrem Wert (sofern es sich um kurzen Text, eine
Zahl oder einen Wahrheitswert handelt), `3 items` bei einer Liste und `4 fields` bei
einem verschachtelten Objekt, das nicht aufgeklappt wird. Eine Liste von Dokumenten
wird als Anzahl dargestellt. Das vollständige Dokument liegt auf dem Datensatz und im
Detail-Editor der Zelle. Für eine präzisere Zeile definieren Sie die relevanten
Schlüssel in `previewFields` oder weisen Sie dem Feld eine `Preview`-Komponente zu.

### Relationen

| Option | Typ | Auswirkung |
|---|---|---|
| `previewFields` | `string[]` | Felder des Ziels, die im Chip für eine verknüpfte Zeile angezeigt werden. Maximal drei finden Platz. |
| `defaultValue` | `EntityRelation \| EntityRelation[]` | Verknüpfte Zeile(n), mit denen das Formular eines neuen Datensatzes initial befüllt wird: `new EntityRelation(id, "<target slug>")` (`EntityRelation` aus `@rebasepro/cms-types`) oder eine Liste für To-Many-Relationen. Wird erst beim Speichern des Formulars geschrieben. Der spalteneigene Standardwert lautet `.default()` auf der Spalte. |
| `widget` | `"select" \| "dialog"` | Art und Weise, wie eine verknüpfte Zeile ausgewählt wird. |
| `fixedFilter` | `FilterValues` | Bietet nur Zeilen an, die diesen Filter erfüllen. |
| `includeId` | `boolean` | Zeigt die ID der verknüpften Zeile in Vorschauen an. |
| `includeEntityLink` | `boolean` | Zeigt einen Link zum Öffnen der verknüpften Zeile an. |
| `renderInForm` | `boolean` | Zeigt eine To-Many-Relation zusätzlich als Auswahlfeld im Formular neben ihrem Tab an. |
| `overrides` | Tabellenoptionen ohne `fields` | Darstellung des Ziels im Tab dieser Relation. |

Siehe [Relationen im Panel](/docs/collections/relations-in-the-admin-panel/).

## Anpassungen, `ui-config.json` und Einstellungen

Die Darstellung einer Tabelle im Panel wird in einer festen Reihenfolge Schicht
für Schicht zusammengesetzt:

1. **Die abgeleitete Collection**: Was das Panel aus der vom Server
   bereitgestellten Tabelle ausliest.
2. **Code**: Die `customizeTable`-Ergebnisse, die als `tableCustomizations` übergeben werden.
3. **`frontend/src/cms/ui-config.json`**: Die Darstellung des Workspace, übergeben
   als `uiConfig`. Dies ist eine Datei im Frontend, die manuell (oder durch Ihren Agenten)
   bearbeitet wird, sodass sie gemeinsam geprüft und bereitgestellt wird.
4. **Workspace-Einstellungen**: Was ein Administrator bei einem Deployment in der
   Tabelle `rebase.ui_preferences` über
   [`/api/admin/ui-config`](/docs/backend/endpoints/) speichert. Das Schreiben erfordert
   `schema:write`.
5. **Benutzer-Einstellungen**: Individuelle Spaltenbreiten, Ansichtswechsel und ausgeblendete
   Spalten eines Nutzers. Werden im Browser vorgehalten, solange dieser abgemeldet ist.

Eine standardmäßig generierte `App.tsx` bindet die Datei bereits ein:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { tableCustomizations } from "./cms";
import uiConfig from "./cms/ui-config.json";

export const Admin = () => <RebaseCMS tableCustomizations={tableCustomizations} uiConfig={uiConfig} />;
```

Einstellungen enthalten ausschließlich Darstellungsaspekte: Labels, Icons,
Ansichtsmodi, Spaltenreihenfolge, ausgeblendete Spalten, Enum-Labels und -Farben,
Kanban und Abfragestandards. Ein Schema-Fakt gelangt niemals dorthin; diese
befinden sich in `backend/schema`.

`rebase build` übernimmt `frontend/src/cms/ui-config.json` in das Bundle
(`entry.uiConfig`), sodass ein bereitgestelltes Backend diese ebenfalls kennt:
`GET /api/admin/ui-config` liefert sie als `shipped` neben den Workspace- und
Benutzerebenen aus. MCP-Ansichten und `describe_table` fassen dieselben drei
Ebenen zusammen – die Datei, den Workspace und die benutzereigene Ebene (keine bei
einem API-Schlüssel) –, sodass ein Agent genau die Labels, Reihenfolgen, ausgeblendeten
Spalten und Enum-Labels sieht wie ein Benutzer im Panel.

`rebase verify` prüft jeden `customizeTable`-Aufruf in `frontend/src/cms` gegen die
Tabellen, ohne ihn auszuführen: Es erkennt Anpassungen für Tabellen oder Felder, die
nicht existieren, erforderliche Spalten, die das Formular ausblendet, doppelt angepasste
Tabellen, eine `ui-config.json`, die an kein `<RebaseCMS>` übergeben wird, sowie
Vite-Konfigurationen ohne `rebaseBackendGuard()`. Siehe [`rebase verify`](/docs/cli/#rebase-verify).

## Nächste Schritte

- [Wie Tabellen zu Collections werden](/docs/collections/): Was das Panel vor allen Anpassungen ableitet
- [Felder](/docs/collections/properties/): Widgets und Optionen für jeden Spaltentyp
- [Ansichtsmodi](/docs/frontend/view-modes/): Tabelle, Karten, Kanban, Display-Slots, Filter
- [Entity Actions](/docs/frontend/entity-actions/): `entityActions` und `updateRecord`
- [Firestore neben Postgres](/docs/frontend/firebase/): `externalCollections` und datenbankübergreifende Referenzen
