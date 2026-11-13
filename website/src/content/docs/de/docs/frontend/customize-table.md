---
sourceHash: 749d3a5f47923f4d
title: customizeTable
sidebar_label: customizeTable
description: "customizeTable gibt an, wie sich die Collection einer Tabelle von dem unterscheidet, was das CMS ableitet: Labels, Icon, Ansichten, Kanban, Anzeige-Slots, Formular-Layout, Aktionen und Optionen pro Feld mit nach Wert importierten React-Komponenten. Jede Option mit Typ und Auswirkung."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wenn Sie das CMS verwenden, verfügt jede vom Backend bereitgestellte Tabelle
bereits über eine Collection im Panel, die aus der Tabelle selbst abgeleitet wird
(siehe [Wie Tabellen zu Collections werden](/docs/collections/)). `customizeTable`
gibt lediglich an, was sich davon unterscheiden soll. Es befindet sich im Frontend,
direkt neben Ihrem übrigen React-Code, sodass ein benutzerdefiniertes Feld eine
Komponente ist, die Sie wie jede andere importieren.

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
        __order: { hidden: true, disabled: true },
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

Übergeben Sie das Ergebnis an `<RebaseCMS tableCustomizations={[postsCms]}/>`;
siehe [die Frontend-Übersicht](/docs/frontend/#rebasecms-props).

:::note[Umstieg von Collections?]
Dies sind die Darstellungsoptionen des alten `admin`-Blocks, auf oberster Ebene
und unter einigen neuen Namen (`fieldOrder`, `listFields`, `previewFields`,
`fields`, `kanban.columnField`, `kanban.orderField`). Die Verwendung eines alten
Namens löst einen Fehler mit dem Hinweis auf den neuen Namen aus.
:::

## Speicherort der Dateien

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```text
frontend/src/cms/
├── index.ts        # export const tableCustomizations = [postsCms, …]
├── posts.tsx       # customizeTable("posts", …)
└── events.ts       # defineFirestoreCollection(…), for Firestore
```

Die Namen sind eine Konvention. Entscheidend ist, dass die Ergebnisse
`<RebaseCMS tableCustomizations>` erreichen. Eine Tabelle ohne entsprechende Datei
wird wie abgeleitet dargestellt.

Das Frontend importiert ausschließlich den **Typ** der Tabelle: `import type { posts }`.
Ein Typ-Import wird beim Erstellen des Bundles entfernt, sodass Hooks und Server-Code
in `backend/schema` niemals den Browser erreichen. Ein Wert-Import aus `backend/` im
Frontend-Code ist das Einzige, was vermieden werden muss. Das Backend importiert niemals
etwas aus dem Frontend.

## Der Slug und der Typ

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Das erste Argument ist der Slug der Tabelle: der Name, unter dem sie definiert wurde,
oder der zugewiesene `slug`. Wird die Tabelle als Typargument übergeben, werden der
Slug, jeder Schlüssel, der ein Feld benennt, und jeder Enum-Wert gegen die Tabelle geprüft:

| Gegen `typeof posts` geprüft | Ein Fehler ist |
|---|---|
| das erste Argument | ein Typfehler, es sei denn, es ist der Slug der Tabelle |
| `fields`-Schlüssel | ein Spaltenschlüssel oder ein Relationsname |
| `fieldOrder`-, `listFields`-, `form`-Einträge | ein Feld, ein punktierter Pfad in eines hinein (`"seo.title"`), `subcollection:<relation>` oder der Schlüssel eines zusätzlichen Feldes |
| `display`, `sort`, `fixedFilter`, `defaultFilter`, `filterPresets` | ein Feld oder ein Pfad in ein Feld hinein |
| `kanban.columnField` | eine Spalte, die eine geschlossene Menge von Strings enthält (`col.enum([...])` oder `.oneOf([...])`) |
| `kanban.orderField` | eine Textspalte |
| `enumLabels`, `enumOrder` | Werte, die die Spalte annehmen kann; eine Spalte ohne geschlossene Menge akzeptiert keines von beiden |
| Feldoptionen | Optionen des Spaltentyps: `multiline` bei einer Textspalte, `format` bei einer Zahl |
| `entityActions[].onClick` und ähnliche | `row` ist das `InferRow` der Tabelle |

`defineTable("blog_posts", { slug: "posts", … })` wird als
`customizeTable<typeof posts>("posts", …)` angepasst: weiterhin ein einziges Typargument.
Ohne das Typargument akzeptiert `customizeTable("posts", { … })` dieselben Optionen
in schwach typisierter Form.

## Was abgelehnt und was übersprungen wird

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`customizeTable` prüft beim Laden des Moduls, was der Compiler nicht erkennen kann,
und wirft einen Fehler mit Hinweisen zur Korrektur aus:

- eine unbekannte Option, zusammen mit der ähnlichsten bekannten Option oder dem neuen
  Namen einer alten `admin`-Option;
- eine Komponente, die als String-Pfad, als Lazy-Thunk `() => import(…)` oder als
  etwas übergeben wurde, das keine React-Komponente ist;
- eine Entity Action ohne `name` oder `onClick`, eine benutzerdefinierte Ansicht ohne
  `Builder`, ein `kanban` ohne `columnField`, ein `referenceTo`, das kein Slug ist;
- `fields` innerhalb der `overrides` einer Relation: Passen Sie die Zieltabelle stattdessen
  mit ihrem eigenen `customizeTable` an.

```text
customizeTable("posts"): unknown options:
  - `propertiesOrder` — it is `fieldOrder` now
  - `iconn` — did you mean `icon`?
```

Das Ergebnis ist unveränderlich (frozen). Die Übergabe von zwei Anpassungen desselben
Slugs an `<RebaseCMS>` löst einen Fehler aus: Welche davon Vorrang hätte, hinge von der
Importreihenfolge ab.

Was der Server bereitstellt, kann von dem abweichen, wogegen Sie den Code geschrieben
haben. Eine Spalte kann für diesen Aufrufer vorenthalten werden (siehe
[Feldzugriff](/docs/collections/field-access/)), oder die Tabelle hat sich seither
geändert. Dies ist kein Laufzeitfehler. In der Entwicklungsumgebung gibt das Panel
eine Warnung pro Abweichung aus und überspringt diese:

- eine Anpassung, deren Slug mit keiner bereitgestellten Tabelle übereinstimmt, wird ignoriert;
- ein Feld, ein Spalteneintrag, ein Display-Slot, ein Formulareintrag oder ein Kanban-Feld,
  das die Tabelle nicht bereitstellt, wird verworfen;
- eine Option, die nicht auf den Typ des Feldes zutrifft (`format` bei einer Textspalte,
  `enumLabels` bei einem Feld ohne geschlossene Menge), wird ignoriert.

Der Rest der Anpassung bleibt weiterhin wirksam.

## Tabellenoptionen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Jeder Schlüssel ist optional. Ein ausgelassener Schlüssel behält den vom Panel
abgeleiteten Wert bei.

### Identität und Navigation

| Option | Typ | Auswirkung |
|---|---|---|
| `name` | `string` | Die Bezeichnung im Plural: Drawer, Seitenüberschrift. Andernfalls aus dem Tabellennamen abgeleitet. |
| `singularName` | `string` | Die Bezeichnung für einen einzelnen Datensatz. |
| `description` | `string` | Wird unter der Überschrift und auf der Startkachel angezeigt. |
| `metadata` | `Record<string, unknown>` | Eigene Daten, die mit den `metadata` der Tabelle zusammengeführt werden. |
| `icon` | `string \| ReactNode` | Ein Lucide-Icon-Name (`"FileText"`) oder ein Element. |
| `group` | `string` | Die Navigationsgruppe. |
| `hideFromNavigation` | `boolean` | Nicht im Drawer enthalten. Weiterhin per URL und als Referenzziel erreichbar. |
| `hideFromEntityViews` | `boolean` | Wird nicht als Tab bei Datensätzen von Tabellen angeboten, die sich darauf beziehen. |

### Ansichten

| Option | Typ | Auswirkung |
|---|---|---|
| `defaultViewMode` | `ViewMode` | Die Standardansicht beim Öffnen: `"list"`, `"table"`, `"cards"`, `"kanban"` oder der Schlüssel einer benutzerdefinierten Ansicht. Andernfalls `"list"`. |
| `enabledViews` | `ViewMode[]` | Die im Umschalter angebotenen Ansichten. |
| `kanban` | `{ columnField, orderField? }` | Das Board: die Spalte, nach der gruppiert wird, und die Textspalte, in der Sortierschlüssel gespeichert werden. Siehe [Ansichtsmodi](/docs/frontend/view-modes/#kanban). |
| `customViews` | `(string \| TableCustomView)[]` | Weitere Arten, die Zeilen darzustellen: `{ key, name, Builder }` oder der Schlüssel einer auf `<RebaseCMS collectionViews>` registrierten Ansicht. |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | Die standardmäßige Zeilenhöhe. |

`kanban` akzeptiert zwei Schlüssel:

| Schlüssel | Typ | Auswirkung |
|---|---|---|
| `columnField` | Spaltenschlüssel | Die Spalte, aus der die Spalten des Boards hervorgehen: ein `col.enum([...])` oder `.oneOf([...])` von Strings. |
| `orderField` | Textspaltenschlüssel | Wo die Position einer Karte innerhalb ihrer Spalte als fraktionaler Sortierschlüssel gespeichert wird. Ohne diesen wird die Reihenfolge bei jedem Lesevorgang zurückgesetzt. |

### Spalten und Slots

| Option | Typ | Auswirkung |
|---|---|---|
| `fieldOrder` | `TableColumnId[]` | Die Reihenfolge, in der Felder dargestellt werden. Nicht aufgeführte Felder folgen danach, sodass nichts verschwindet. |
| `listFields` | `TableColumnId[]` | Die Spalten der Listenansicht. |
| `previewFields` | `TableFieldKey[]` | Die angezeigten Felder, wenn ein Datensatz dieser Tabelle von einer anderen referenziert wird. |
| `display` | `TableDisplay` | Was `title`, `subtitle`, `image`, `status`, `date` und `tags` eines Datensatzes befüllt: ein Feldpfad oder ein Resolver. Siehe [Display-Slots](/docs/frontend/view-modes/#display-slots). |
| `additionalFields` | `TableAdditionalField[]` | Berechnete Spalten. Siehe [Zusätzliche Spalten](/docs/frontend/additional-columns/). |
| `hideIdFromCollection` | `boolean` | Blendet die ID-Spalte aus. |

Eine berechnete Spalte akzeptiert:

| Schlüssel | Typ | Auswirkung |
|---|---|---|
| `key` | `string` | Identifiziert die Spalte. In `fieldOrder` als `"total" as AdditionalFieldKey` angeben. |
| `name` | `string` | Die Spaltenüberschrift. |
| `width` | `number` | Die Breite in Pixeln. |
| `Builder` | `(props) => ReactNode` | Rendert die Zelle aus `{ row, id, context }`. |
| `dependencies` | Feldpfad oder Pfade | Die Felder, deren Änderung ein Neu-Rendern der Zelle auslöst. |
| `value` | `(props) => string \| number` | Der Wert der Zelle für den Export. Kann asynchron sein. |

### Abfrage-Standardwerte

| Option | Typ | Auswirkung |
|---|---|---|
| `sort` | `OrderBySpec` | Die Standardsortierung: `["publishDate", "desc"]` oder mehrere Schlüssel in Reihenfolge. |
| `fixedFilter` | `FilterValues` | Ein Filter, den der Besucher nicht ändern kann. |
| `defaultFilter` | `FilterValues` | Der Ausgangsfilter für Besucher. |
| `filterPresets` | `FilterPreset[]` | 1-Klick-Filter in der Toolbar: `{ label?, filterValues, sort? }`. |
| `pagination` | `boolean \| number` | Seitenweises Laden (`true` oder die Seitengröße) oder alles auf einmal (`false`). |

Siehe [Filter und Sortierung](/docs/frontend/view-modes/#filters-presets-and-sort).

### Verhalten

| Option | Typ | Auswirkung |
|---|---|---|
| `inlineEditing` | `boolean` | Zellen direkt in der Tabelle bearbeiten. |
| `selectionEnabled` | `boolean` | Zeilen können ausgewählt werden. |
| `selectionController` | `SelectionController` | Eine Auswahl, die außerhalb der Ansicht verwaltet wird (`useSelectionController`). |
| `exportable` | `boolean \| ExportConfig` | Ob die Toolbar den Export anbietet und zusätzliche Spalten dafür. Siehe [Import und Export](/docs/frontend/data-import-export/). |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | Wie ein Datensatz geöffnet wird. |
| `defaultEntityAction` | `"view" \| "edit"` | Ob das Anklicken eines Datensatzes diesen zur Ansicht oder Bearbeitung öffnet. |
| `sideDialogWidth` | `number \| string` | Die Breite des Seitenpanels, in dem ein Datensatz geöffnet wird. |
| `defaultSelectedView` | `string \| DefaultSelectedViewBuilder` | Der Tab, mit dem sich ein Datensatz standardmäßig öffnet. |

### Formular

| Option | Typ | Auswirkung |
|---|---|---|
| `form` | `{ sidebar?, sections?, showRecordMeta? }` | Abschnitte und die Leiste (Rail) neben dem Formular. Siehe [Formular-Layout](/docs/frontend/form-layout/). |
| `formView` | `{ Builder, includeActions? }` | Eine Komponente, die das generierte Formular ersetzt. `includeActions` behält „Speichern“ und „Verwerfen“ in der Leiste des Datensatzes bei. |
| `formAutoSave` | `boolean` | Speichern während der Eingabe. |
| `alwaysApplyDefaultValues` | `boolean` | Trägt deklarierte Standardwerte in leere Felder eines gespeicherten Datensatzes ein, sobald dieser geöffnet wird. |
| `includeJsonView` | `boolean` | Fügt einen Tab mit dem Datensatz als JSON hinzu. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | Behält nicht gespeicherte Änderungen im Local Storage. |
| `hideIdFromForm` | `boolean` | Blendet die ID im Formular aus. |

`form` akzeptiert:

| Schlüssel | Typ | Auswirkung |
|---|---|---|
| `sidebar` | Feld-IDs | Die Felder, die in die Leiste neben dem Formular ausgelagert werden. |
| `sections` | Abschnitte | Die Abschnitte der Hauptspalte (siehe unten). |
| `showRecordMeta` | `boolean` | Zeigt ID und Zeitstempel des Datensatzes in der Leiste an. |

Jeder Abschnitt akzeptiert:

| Schlüssel | Typ | Auswirkung |
|---|---|---|
| `key` | `string` | Identifiziert den Abschnitt; dient auch als `id` für dessen Anker. |
| `title` | `string` | Die Überschrift. Keine, wenn weggelassen. |
| `fields` | Feld-IDs | Die Felder im Abschnitt in geordneter Reihenfolge. |
| `collapsed` | `boolean` | Standardmäßig eingeklappt. |
| `collapsible` | `boolean` | Kann eingeklappt werden. |
| `readVariant` | `"grid" \| "summary"` | Wie der Abschnitt dargestellt wird, wenn der Datensatz angezeigt statt bearbeitet wird. |

### Aktionen, Ansichten und Overrides

| Option | Typ | Auswirkung |
|---|---|---|
| `entityActions` | `(string \| TableEntityAction)[]` | Aktionen für einen Datensatz. Ein Objekt oder der Schlüssel einer auf `<RebaseCMS entityActions>` registrierten Aktion. Siehe [Entity Actions](/docs/frontend/entity-actions/). |
| `disableDefaultActions` | `("edit" \| "copy" \| "delete")[]` | Integrierte Aktionen, die diese Tabelle nicht anbietet. |
| `resetPasswordAction` | `false \| TableEntityAction` | <span class="since-badge" data-since="0.31">Seit 0.31</span> Nur für die Auth-Tabelle (`defineAuthTable`): `false` entfernt die integrierte Aktion zum Zurücksetzen des Passworts; eine Aktion ersetzt sie (unabhängig davon angeboten, was der Auth-Adapter unterstützt: das Backend liegt bei Ihnen). Bei jeder anderen Tabelle mit einer Warnung ignoriert. |
| `entityViews` | `(string \| TableEntityView)[]` | Zusätzliche Tabs auf einem Datensatz. Siehe [Entity Views](/docs/frontend/entity-views/). |
| `Actions` | `Component[]` | Komponenten, die in der Toolbar der Collection gerendert werden. |
| `components` | `TableComponentOverrides` | Auf die Collection beschränkte Komponenten-Overrides, jeweils `{ Component, wrap? }`. Siehe [Komponenten-Overrides](/docs/frontend/component-overrides/#collection-level-component-overrides). |
| `browserCallbacks` | `CollectionCallbacks` | Callbacks, die im Panel nach den Hooks des Servers ausgeführt werden. Rein für die Darstellung: Sie werden an jeden Besucher ausgeliefert und bieten keine Sicherheit. Siehe [React-Hooks](/docs/hooks/). |
| `fields` | `TableFields` | Optionen pro Feld, geordnet nach Spalte oder Relation. Siehe unten. |

## Feldoptionen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`fields.<key>` akzeptiert die Optionen, die jedes Feld akzeptiert, sowie jene seines
Spaltentyps. [Felder](/docs/collections/properties/) zeigt jedes Feld mit dem Widget,
das dadurch verändert wird.

### Jedes Feld

| Option | Typ | Auswirkung |
|---|---|---|
| `name` | `string` | Die Beschriftung. Andernfalls aus dem Schlüssel abgeleitet (`publishDate` → „Publish Date“). |
| `description` | `string` | Hilfetext unter dem Feld. |
| `hidden` | `boolean` | Wird in der Tabellen- und Kartenansicht ausgeblendet. Bleibt im Formular erhalten und wird weiterhin von der API gelesen und geschrieben. |
| `hiddenInForm` | `boolean` | Wird im Formular ausgeblendet. Bleibt in den Ansichten sichtbar. |
| `disabled` | `boolean \| { disabledMessage?, clearOnDisabled? }` | Das Steuerelement ist ausgegraut. `disabledMessage` nennt daneben den Grund; `clearOnDisabled` leert den Wert, wenn das Feld deaktiviert wird. |
| `readOnly` | `boolean` | Der Wert wird als reiner Text ohne Steuerelement dargestellt. |
| `Field` | `Component` | Ersetzt das Formularsteuerelement durch die Komponente selbst. Siehe [Benutzerdefinierte Felder](/docs/frontend/custom-fields/). |
| `Preview` | `Component` | Ersetzt die Darstellung des Werts außerhalb des Formulars. |
| `Filter` | `Component` | Ersetzt das Filter-Steuerelement für dieses Feld. |
| `columnWidth` | `number` | Die Spaltenbreite in der Tabelle in Pixeln. |
| `filledByServer` | `boolean` | Ein Server-Hook befüllt das Feld beim Erstellen: Das Formular erlaubt das Erstellen eines Datensatzes ohne diesen Wert. |
| `span` | `1 \| 2 \| 3 \| 4` | Wie viele der vier Spalten des Formular-Rasters das Feld überspannt. |
| `customProps` | `unknown` | Wird unverändert an `Field` und `Preview` übergeben. |
| `filterOperators` | `WhereFilterOp[]` | Schränkt die angebotenen Filteroperatoren ein. `[]` deaktiviert das Filtern für dieses Feld. |
| `propertyConfig` | `string` | Der Schlüssel eines auf `<Rebase propertyConfigs>` registrierten Feldtyps. |
| `conditions` | `PropertyConditions` | JSON-Logic-Regeln, die das Feld anhand der Werte des Datensatzes ausblenden, deaktivieren oder als Pflichtfeld markieren. Nur im Formular. Siehe [Bedingungen](/docs/collections/validation-and-conditions/#conditional-fields). |
| `dynamicProps` | `(props) => options \| undefined` | Gibt die aktuell geltenden Feldoptionen basierend auf dem bearbeiteten Datensatz zurück. Nur im Formular. |
| `metadata` | `Record<string, unknown>` | Eigene Daten. |

### Text- und UUID-Spalten

| Option | Typ | Auswirkung |
|---|---|---|
| `multiline` | `boolean` | Ein mehrzeiliges Eingabefeld, das mit dem Inhalt wächst. |
| `markdown` | `boolean` | Ein Markdown-Editor mit Vorschau. |
| `previewAsTag` | `boolean` | Als Chip statt als normaler Text dargestellt. |
| `clearable` | `boolean` | Fügt ein Steuerelement hinzu, um den Wert auf `null` zu setzen. |
| `urlPreview` | `PreviewType \| boolean` | Wie eine URL im Wert in der Vorschau angezeigt wird: `"image"`, `"video"`, `"audio"`, `"file"` oder `true` für einen Link. |
| `referenceTo` | `string` | Die Spalte enthält den Schlüssel eines Datensatzes in einer anderen Collection beliebiger Datenquellen: Sie wird als Referenz auf den Slug dieser Collection dargestellt und ausgewählt. Siehe [Firestore](/docs/frontend/firebase/#from-a-table-to-firestore). |

### Spalten mit einer geschlossenen Wertemenge

Ein `col.enum([...])`, ein `.oneOf([...])` oder ein Array von beiden:

| Option | Typ | Auswirkung |
|---|---|---|
| `enumLabels` | `{ [value]?: string \| EnumLabel }` | Bezeichnungen für einzelne Werte. Ausgelassene Werte behalten ihr abgeleitetes Label und ihre Farbe. |
| `enumOrder` | `value[]` | Die Reihenfolge, in der Werte angeboten und Kanban-Spalten angeordnet werden. Andernfalls die spalteneigene Reihenfolge. |
| `previewAsTag` | `boolean` | Bei einem `col.enum()`: als Chip dargestellt. |
| `clearable` | `boolean` | Bei einem `col.enum()`: fügt ein Steuerelement hinzu, um den Wert auf `null` zu setzen. |

Ein `EnumLabel` akzeptiert:

| Schlüssel | Typ | Auswirkung |
|---|---|---|
| `label` | `string` | Der Text auf dem Chip und in der Auswahlliste. |
| `color` | `ColorKey \| ColorScheme` | Ein Chip-Farbschlüssel (`"green"`, `"orangeDark"`) oder ein `{ color, text }`-Schema. Ein Wert ohne Farbangabe behält seine ursprüngliche Farbe. |
| `disabled` | `boolean` | Wird angezeigt, steht aber nicht zur Auswahl bereit. |

### Zahlenspalten

| Option | Typ | Auswirkung |
|---|---|---|
| `clearable` | `boolean` | Fügt ein Steuerelement hinzu, um den Wert auf `null` zu setzen. |
| `format` | `NumberFormatOptions` | Gibt die Zahl als Währung, Prozentsatz oder mit fester Dezimalstellenanzahl aus. |

`format` akzeptiert `style` (`"decimal"`, `"currency"`, `"percent"`), `currency` (ein
ISO-Code, erforderlich bei `"currency"`), `locale` (andernfalls das des Betrachters),
`minimumFractionDigits`, `maximumFractionDigits` und `notation`
(`"standard"` oder `"compact"`, wodurch `12000` als `12K` dargestellt wird). Es verändert
ausschließlich die Darstellung, niemals den gespeicherten Wert.

### Datums-, Zeitstempel- und Zeitspalten

| Option | Typ | Auswirkung |
|---|---|---|
| `clearable` | `boolean` | Fügt ein Steuerelement hinzu, um den Wert auf `null` zu setzen. |
| `mode` | `"date" \| "date_time"` | Nur einen Tag auswählen und anzeigen, oder Tag und Uhrzeit. Andernfalls vom Spaltentyp abgeleitet. |
| `timezone` | `string` | Die IANA-Zeitzone, in der der Wert angezeigt und ausgewählt wird (`"Europe/Madrid"`). Andernfalls die des Betrachters. |

### Vektorspalten

| Option | Typ | Auswirkung |
|---|---|---|
| `clearable` | `boolean` | Fügt ein Steuerelement hinzu, um den Wert auf `null` zu setzen. |

### Storage-Spalten

| Option | Typ | Auswirkung |
|---|---|---|
| `storage` | `StorageCustomization` | Die Upload-Funktionen, die im Browser ausgeführt werden. |
| `clearable` | `boolean` | Fügt ein Steuerelement hinzu, um den Wert auf `null` zu setzen. |
| `urlPreview` | `PreviewType \| boolean` | Wie die gespeicherte URL in der Vorschau dargestellt wird. |

`storage` akzeptiert ausschließlich Funktionen; die serialisierbaren Optionen verbleiben
auf `col.storage({ … })` (siehe [Datei-Uploads](/docs/collections/file-uploads/)):

| Schlüssel | Signatur | Auswirkung |
|---|---|---|
| `path` | `(context) => string` | Der Ordner, in den eine Datei hochgeladen wird; ersetzt die `path`-Vorlage der Spalte. |
| `fileName` | `(context) => string \| Promise<string>` | Der gespeicherte Dateiname; ersetzt die `fileName`-Vorlage der Spalte. |
| `processFile` | `(file) => Promise<File>` | Transformiert eine Datei vor dem Upload. |
| `postProcess` | `(pathOrUrl) => Promise<string>` | Transformiert den gespeicherten Pfad oder die URL, bevor dieser in die Spalte geschrieben wird. |
| `previewUrl` | `(fileName) => string` | Die URL, unter der eine gespeicherte Datei in der Vorschau angezeigt wird. |

### Array-Spalten

| Option | Typ | Auswirkung |
|---|---|---|
| `expanded` | `boolean` | Alle Elemente sind beim Laden aufgeklappt. |
| `minimalistView` | `boolean` | Elemente werden ohne Rahmen und Kopfzeile dargestellt. |
| `sortable` | `boolean` | Elemente können per Drag-and-Drop neu angeordnet werden. |
| `canAddElements` | `boolean` | Neue Elemente können hinzugefügt werden. |
| `of` | Feldoptionen | Die Optionen jedes einzelnen Elements. |
| `storage` | `StorageCustomization` | Die Upload-Funktionen für `col.storage().multiple()`. |

`enumLabels` und `enumOrder`, die für ein Array definiert wurden, gelten für dessen Elemente.

### JSON-Spalten

| Option | Typ | Auswirkung |
|---|---|---|
| `expanded` | `boolean` | Die Felder des Dokuments sind beim Laden aufgeklappt. |
| `minimalistView` | `boolean` | Die Felder des Dokuments werden ohne Rahmen dargestellt. |
| `spreadChildren` | `boolean` | Die Felder des Dokuments werden so angeordnet, als gehörten sie direkt zum Datensatz. |
| `keyValue` | `boolean` | Wird als freie Schlüssel/Wert-Paare bearbeitet. |
| `previewFields` | `string[]` | Die Schlüssel des Dokuments, die in dessen Vorschau angezeigt werden. |
| `fields` | `{ [key]: field options }` | Die Optionen für die einzelnen Schlüssel des Dokuments. |
| `fieldOrder` | `string[]` | Die Reihenfolge, in der die Schlüssel des Dokuments angezeigt werden. |
| `of` | Feldoptionen | Die Optionen jedes Elements, falls das Dokument eine Liste ist. |
| `oneOf` | `{ [variant]: field options }` | Die Optionen jeder Variante eines typisierten Blocks (`json.oneOf`). |

Mit `col.jsonb().$type<T>()` oder einer `json.object({…})`-Struktur werden `fields` und
`fieldOrder` über die Schlüssel des Dokuments typisiert. Siehe [Arrays und JSON](/docs/collections/arrays-and-maps/).

### Relationen

| Option | Typ | Auswirkung |
|---|---|---|
| `previewFields` | `string[]` | Die Felder des Ziels, die im Chip für eine verknüpfte Zeile angezeigt werden. Es passen maximal drei Felder hinein. |
| `defaultValue` | `EntityRelation \| EntityRelation[]` | Die verknüpfte(n) Zeile(n), mit der/denen das Formular eines neuen Datensatzes initial befüllt wird: `new EntityRelation(id, "<target slug>")` (`EntityRelation` aus `@rebasepro/cms-types`) oder eine Liste für eine To-Many-Relation. Wird erst beim Speichern des Formulars geschrieben. Der Standardwert einer Spalte selbst ist `.default()` auf der Spalte. |
| `widget` | `"select" \| "dialog"` | Wie eine verknüpfte Zeile ausgewählt wird. |
| `fixedFilter` | `FilterValues` | Bietet nur Zeilen an, die diesen Filter erfüllen. |
| `includeId` | `boolean` | Zeigt die ID der verknüpften Zeile in Vorschauen an. |
| `includeEntityLink` | `boolean` | Zeigt einen Link an, der die verknüpfte Zeile öffnet. |
| `renderInForm` | `boolean` | Stellt eine To-Many-Relation zusätzlich als Picker im Formular neben ihrem Tab dar. |
| `overrides` | Tabellenoptionen ohne `fields` | Wie das Ziel im Tab dieser Relation dargestellt wird. |

Siehe [Relationen im Panel](/docs/collections/relations-in-the-admin-panel/).

## Anpassungen, `ui-config.json` und Einstellungen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Was das Panel für eine Tabelle anzeigt, wird in einer festen Reihenfolge zusammengestellt,
wobei jede Ebene die vorherige überlagert:

1. **Die abgeleitete Collection**: Was das Panel aus der vom Server bereitgestellten Tabelle ausliest.
2. **Code**: Die `customizeTable`-Ergebnisse, die Sie als `tableCustomizations` übergeben.
3. **`frontend/src/cms/ui-config.json`**: Die Darstellung des Arbeitsbereichs, wie sie der
   Collection-Editor in der Entwicklungsumgebung gespeichert hat, übergeben als `uiConfig`.
   Da es sich um eine Datei im Frontend handelt, wird sie zusammen mit diesem überprüft und bereitgestellt.
4. **Workspace-Einstellungen**: Was ein Administrator auf einem Deployment in der
   Tabelle `rebase.ui_preferences` über
   [`/api/admin/ui-config`](/docs/backend/endpoints/) speichert. Das Schreiben erfordert
   `schema:write`.
5. **Benutzereinstellungen**: Individuelle Spaltenbreiten, Ansichtsumschaltungen und
   ausgeblendete Spalten eines einzelnen Nutzers. Werden im Browser vorgehalten, solange
   der Nutzer abgemeldet ist.

Ein scaffoldetes `App.tsx` bindet die Datei bereits standardmäßig ein:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { tableCustomizations } from "./cms";
import uiConfig from "./cms/ui-config.json";

export const Admin = () => <RebaseCMS tableCustomizations={tableCustomizations} uiConfig={uiConfig} />;
```

Einstellungen enthalten ausschließlich Präsentationsdaten: Labels, Icon, Ansichtsmodi,
Spaltenreihenfolge, ausgeblendete Spalten, Enum-Labels und -Farben, Kanban- sowie
Abfrage-Standardwerte. Schema-Definitionen landen dort niemals; der
[Collection-Editor](/docs/studio/) schreibt diese stattdessen nach `backend/schema`.

`rebase build` übernimmt `frontend/src/cms/ui-config.json` in das Bundle
(`entry.uiConfig`), sodass ein bereitgestelltes Backend diese ebenfalls kennt:
`GET /api/admin/ui-config` liefert sie als `shipped` neben der Workspace- und Benutzerebene aus.
Die MCP-Ansichten und `describe_table` fassen dieselben drei Ebenen zusammen – die Datei,
den Workspace und die Ebene des Aufrufers selbst (keine bei einem API-Schlüssel) –, sodass
ein Agent dieselben Labels, Reihenfolgen, ausgeblendeten Spalten und Enum-Labels sieht wie
ein Benutzer im Panel.

`rebase verify` prüft jeden `customizeTable`-Aufruf in `frontend/src/cms` gegen
die Tabellen, ohne ihn auszuführen: Es erkennt Anpassungen für nicht existierende Tabellen
oder Felder, erforderliche Spalten, die das Formular ausblendet, mehrfach angepasste
Tabellen, eine `ui-config.json`, die an kein `<RebaseCMS>` übergeben wird, sowie eine
Vite-Konfiguration ohne `rebaseBackendGuard()`. Siehe [`rebase verify`](/docs/cli/#rebase-verify).

## Nächste Schritte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- [Wie Tabellen zu Collections werden](/docs/collections/): Was das Panel vor all diesen Schritten ableitet
- [Felder](/docs/collections/properties/): Widgets und Optionen der einzelnen Spaltentypen
- [Ansichtsmodi](/docs/frontend/view-modes/): Tabelle, Karten, Kanban, Display-Slots, Filter
- [Entity Actions](/docs/frontend/entity-actions/): `entityActions` und `updateRecord`
- [Firestore neben Postgres](/docs/frontend/firebase/): `externalCollections` und engine-übergreifende Referenzen
