---
sourceHash: 43be070662fffefd
title: customizeTable
sidebar_label: customizeTable
description: "customizeTable gibt an, wie sich die Collection einer Tabelle von dem unterscheidet, was das CMS ableitet: Labels, Icon, Ansichten, Kanban, Anzeige-Slots, Formular-Layout, Aktionen und feldbezogene Optionen mit per Wert importierten React-Komponenten. Jede Option mit Typ und Auswirkung."
---

Wenn Sie das CMS verwenden, verfügt jede vom Backend bereitgestellte Tabelle bereits über eine Collection im
Panel, die aus der Tabelle selbst abgeleitet wird (siehe
[Wie Tabellen zu Collections werden](/docs/collections/)). `customizeTable` gibt lediglich an,
was davon abweichen soll. Es befindet sich im Frontend neben dem restlichen
React-Code, sodass ein benutzerdefiniertes Feld eine Komponente ist, die Sie wie jede andere importieren.

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

Übergeben Sie das Ergebnis an `<RebaseCMS tableCustomizations={[postsCms]}/>`; siehe
[die Frontend-Übersicht](/docs/frontend/#rebasecms-props).

:::note[Kommen Sie von Collections?]
Dies sind die Darstellungsoptionen des alten `admin`-Blocks auf oberster Ebene
und unter einigen neuen Namen (`fieldOrder`, `listFields`, `previewFields`,
`fields`, `kanban.columnField`, `kanban.orderField`). Die Verwendung eines alten Namens löst einen
Fehler aus, der auf den neuen Namen hinweist.
:::

## Wo die Dateien liegen

```text
frontend/src/cms/
├── index.ts        # export const tableCustomizations = [postsCms, …]
├── posts.tsx       # customizeTable("posts", …)
└── events.ts       # defineFirestoreCollection(…), for Firestore
```

Die Namen sind eine Konvention. Wichtig ist nur, dass die Ergebnisse
`<RebaseCMS tableCustomizations>` erreichen. Eine Tabelle ohne Datei wird wie abgeleitet dargestellt.

Das Frontend importiert ausschließlich den **Typ** der Tabelle: `import type { posts }`. Ein Typ-Import
wird beim Erstellen des Bundles entfernt, sodass Hooks und Server-Code in
`backend/schema` niemals den Browser erreichen. Ein Wert-Import aus `backend/` im
Frontend-Code ist das Einzige, was Sie unbedingt vermeiden müssen. Das Backend importiert niemals etwas
aus dem Frontend.

## Der Slug und der Typ

Das erste Argument ist der Slug der Tabelle: der Name, unter dem sie definiert wurde, oder der
`slug`, der ihr zugewiesen wurde. Mit der Tabelle als Typargument werden der Slug, jeder Schlüssel,
der ein Feld benennt, und jeder Enum-Wert mit der Tabelle abgeglichen:

| Geprüft gegen `typeof posts` | Ein Fehler ist |
|---|---|
| das erste Argument | ein Typfehler, es sei denn, es handelt sich um den Slug der Tabelle |
| `fields`-Schlüssel | ein Spaltenschlüssel oder ein Relationsname |
| Einträge in `fieldOrder`, `listFields`, `form` | ein Feld, ein punktierter Pfad in eines (`"seo.title"`), `subcollection:<relation>` oder der Schlüssel eines zusätzlichen Feldes |
| `display`, `sort`, `fixedFilter`, `defaultFilter`, `filterPresets` | ein Feld oder ein Pfad in eines hinein |
| `kanban.columnField` | eine Spalte mit einer geschlossenen Menge von Strings (`col.enum([...])` oder `.oneOf([...])`) |
| `kanban.orderField` | eine Textspalte |
| `enumLabels`, `enumOrder` | Werte, die die Spalte enthalten kann; eine Spalte ohne geschlossene Menge akzeptiert keines von beiden |
| Feldoptionen | Optionen des Spaltentyps: `multiline` bei einer Textspalte, `format` bei einer Zahl |
| `entityActions[].onClick` und Ähnliches | `row` entspricht dem `InferRow` der Tabelle |

`defineTable("blog_posts", { slug: "posts", … })` wird angepasst als
`customizeTable<typeof posts>("posts", …)`: weiterhin ein einziges Typargument. Ohne das
Typargument akzeptiert `customizeTable("posts", { … })` dieselben Optionen,
jedoch schwach typisiert.

## Was abgelehnt und was übersprungen wird

`customizeTable` überprüft beim Laden des Moduls, was der Compiler nicht erkennen kann, und
wirft einen Fehler mit Hinweisen, was stattdessen zu schreiben ist:

- eine unbekannte Option, mit der am nächsten liegenden bekannten Option oder dem neuen Namen einer alten
  `admin`-Option;
- eine Komponente, die als String-Pfad, als Lazy-Thunk `() => import(…)` oder als etwas angegeben ist,
  das keine React-Komponente ist;
- eine Entity Action ohne `name` oder `onClick`, eine benutzerdefinierte Ansicht ohne
  `Builder`, ein `kanban` ohne `columnField`, ein `referenceTo`, das kein Slug ist;
- `fields` innerhalb der `overrides` einer Relation: Passen Sie die Zieltabelle mit deren
  eigenem `customizeTable` an.

```text
customizeTable("posts"): unknown options:
  - `propertiesOrder` — it is `fieldOrder` now
  - `iconn` — did you mean `icon`?
```

Das Ergebnis ist eingefroren (frozen). Die Übergabe von zwei Anpassungen für denselben Slug an
`<RebaseCMS>` wirft einen Fehler: Welche Anpassung gewinnen würde, hinge von der Import-Reihenfolge ab.

Was der Server ausliefert, kann von dem abweichen, wogegen Sie den Code geschrieben haben. Eine Spalte kann
für diesen Aufrufer vorenthalten werden (siehe [Feldzugriff](/docs/collections/field-access/)),
oder die Tabelle hat sich seither geändert. Dies ist zur Laufzeit kein Fehler. In
der Entwicklungsumgebung gibt das Panel eine Warnung pro Abweichung aus und überspringt diese:

- eine Anpassung, deren Slug mit keiner bereitgestellten Tabelle übereinstimmt, wird ignoriert;
- ein Feld, ein Spalteneintrag, ein Anzeige-Slot, ein Formulareintrag oder ein Kanban-Feld, das die Tabelle
  nicht bereitstellt, wird verworfen;
- eine Option, die nicht für den Typ des Feldes gilt (`format` bei einer Textspalte,
  `enumLabels` bei einem Feld ohne geschlossene Wertemenge), wird ignoriert.

Der Rest der Anpassung bleibt weiterhin wirksam.

## Tabellenoptionen

Jeder Schlüssel ist optional. Ein weggelassener Schlüssel behält bei, was das Panel abgeleitet hat.

### Identität und Navigation

| Option | Typ | Auswirkung |
|---|---|---|
| `name` | `string` | Die Pluralbezeichnung: Drawer, Seitenüberschrift. Andernfalls vom Tabellennamen abgeleitet. |
| `singularName` | `string` | Die Bezeichnung eines einzelnen Datensatzes. |
| `description` | `string` | Wird unter der Überschrift und auf der Startkarte angezeigt. |
| `metadata` | `Record<string, unknown>` | Ihre eigenen Daten, zusammengeführt mit den `metadata` der Tabelle. |
| `icon` | `string \| ReactNode` | Ein Lucide-Icon-Name (`"FileText"`) oder ein Element. |
| `group` | `string` | Die Navigationsgruppe. |
| `hideFromNavigation` | `boolean` | Nicht im Drawer enthalten. Weiterhin per URL und als Referenzziel erreichbar. |
| `hideFromEntityViews` | `boolean` | Wird nicht als Tab bei Datensätzen von Tabellen angeboten, die sich darauf beziehen. |

### Ansichten

| Option | Typ | Auswirkung |
|---|---|---|
| `defaultViewMode` | `ViewMode` | Die Ansicht, auf der ein Besucher landet: `"list"`, `"table"`, `"cards"`, `"kanban"` oder der Schlüssel einer benutzerdefinierten Ansicht. Standardmäßig `"list"`. |
| `enabledViews` | `ViewMode[]` | Die im Umschalter angebotenen Ansichten. |
| `kanban` | `{ columnField, orderField? }` | Das Board: die Spalte, nach der gruppiert wird, und die Textspalte, in der Sortierschlüssel gespeichert werden. Siehe [Ansichtsmodi](/docs/frontend/view-modes/#kanban). |
| `customViews` | `(string \| TableCustomView)[]` | Weitere Möglichkeiten zum Rendern der Zeilen: `{ key, name, Builder }` oder der Schlüssel einer unter `<RebaseCMS collectionViews>` registrierten Ansicht. |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | Die standardmäßige Zeilenhöhe. |

`kanban` akzeptiert zwei Schlüssel:

| Schlüssel | Typ | Auswirkung |
|---|---|---|
| `columnField` | Spaltenschlüssel | Die Spalte, aus der die Spalten des Boards stammen: ein `col.enum([...])` oder `.oneOf([...])` von Strings. |
| `orderField` | Textspaltenschlüssel | Wo die Position einer Karte innerhalb ihrer Spalte gespeichert wird (als fraktionaler Sortierschlüssel). Ohne diesen wird die Reihenfolge bei jedem Lesevorgang zurückgesetzt. |

### Spalten und Slots

| Option | Typ | Auswirkung |
|---|---|---|
| `fieldOrder` | `TableColumnId[]` | Die Reihenfolge, in der Felder dargestellt werden. Ausgelassene Felder folgen danach, sodass nichts verschwindet. |
| `listFields` | `TableColumnId[]` | Die Spalten der Tabellen- und Listenansicht: die Felder, die gerendert werden, und keine anderen. Die Tabelle ordnet sie nach `fieldOrder` (oder der Reihenfolge, in die ein Besucher sie zieht), falls vorhanden, andernfalls nach `listFields`. Ausgelassene Felder sind weiterhin im Datensatz vorhanden. |
| `previewFields` | `TableFieldKey[]` | Die Felder, die angezeigt werden, wenn ein Datensatz dieser Tabelle von einer anderen referenziert wird. |
| `display` | `TableDisplay` | Was die Eigenschaften `title`, `subtitle`, `image`, `status`, `date` und `tags` eines Datensatzes füllt: ein Feldpfad oder ein Resolver. Siehe [Anzeige-Slots](/docs/frontend/view-modes/#display-slots). |
| `additionalFields` | `TableAdditionalField[]` | Berechnete Spalten der Tabelle. Nicht im Datensatz enthalten, es sei denn, `form.sections` oder `form.sidebar` benennt eine. Siehe [Zusätzliche Spalten](/docs/frontend/additional-columns/). |
| `hideIdFromCollection` | `boolean` | Blendet die ID-Spalte aus. |

Eine berechnete Spalte akzeptiert:

| Schlüssel | Typ | Auswirkung |
|---|---|---|
| `key` | `string` | Identifiziert die Spalte. Wird in `fieldOrder` als `"total" as AdditionalFieldKey` angegeben. |
| `name` | `string` | Die Kopfzeilenbeschriftung. |
| `width` | `number` | Die Breite in Pixeln. |
| `Builder` | `(props) => ReactNode` | Rendert die Zelle aus `{ row, id, context }`. |
| `dependencies` | Feldpfad oder Pfade | Die Felder, deren Änderung ein Neu-Rendern der Zelle auslöst. |
| `value` | `(props) => string \| number` | Der Wert der Zelle für den Export. Kann asynchron sein. |

### Abfragestandards (Query Defaults)

| Option | Typ | Auswirkung |
|---|---|---|
| `sort` | `OrderBySpec` | Die Standardsortierung: `["publishDate", "desc"]` oder mehrere Schlüssel in Reihenfolge. |
| `fixedFilter` | `FilterValues` | Ein Filter, den der Besucher nicht ändern kann. |
| `defaultFilter` | `FilterValues` | Der Filter, mit dem ein Besucher startet. |
| `filterPresets` | `FilterPreset[]` | Ein-Klick-Filter in der Toolbar: `{ label?, filterValues, sort? }`. |
| `pagination` | `boolean \| number` | Seitenweises Laden (`true` oder die Seitengröße) oder alles auf einmal (`false`). |

Siehe [Filter und Sortierung](/docs/frontend/view-modes/#filters-presets-and-sort).

### Verhalten

| Option | Typ | Auswirkung |
|---|---|---|
| `inlineEditing` | `boolean` | Zellen direkt in der Tabelle bearbeiten. |
| `selectionEnabled` | `boolean` | Zeilen können ausgewählt werden. |
| `selectionController` | `SelectionController` | Eine Auswahl, die Sie außerhalb der Ansicht verwalten (`useSelectionController`). |
| `exportable` | `boolean \| ExportConfig` | Ob die Toolbar den Export anbietet, sowie zusätzliche Spalten dafür. Siehe [Import und Export](/docs/frontend/data-import-export/). |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | Wie ein Datensatz geöffnet wird. |
| `defaultEntityAction` | `"view" \| "edit"` | Ob das Anklicken eines Datensatzes diesen zum Lesen oder zum Bearbeiten öffnet. |
| `sideDialogWidth` | `number \| string` | Die Breite des Seitenpanels, in dem sich ein Datensatz öffnet. |
| `defaultSelectedView` | `string \| DefaultSelectedViewBuilder` | Der Tab, auf dem sich ein Datensatz standardmäßig öffnet. |

### Formular

| Option | Typ | Auswirkung |
|---|---|---|
| `form` | `{ sidebar?, sections?, showRecordMeta? }` | Abschnitte und die Seitenleiste neben dem Formular. Siehe [Formular-Layout](/docs/frontend/form-layout/). |
| `formView` | `{ Builder, includeActions? }` | Eine Komponente, die das generierte Formular ersetzt. `includeActions` belässt Speichern und Verwerfen in der Leiste des Datensatzes. |
| `formAutoSave` | `boolean` | Speichern während der Eingabe. |
| `alwaysApplyDefaultValues` | `boolean` | Deklarierte Standardwerte beim Öffnen in leere Felder eines gespeicherten Datensatzes einfügen. |
| `includeJsonView` | `boolean` | Fügt einen Tab mit dem Datensatz als JSON hinzu. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | Nicht gespeicherte Änderungen im lokalen Speicher (Local Storage) behalten. |
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
| `key` | `string` | Identifiziert den Abschnitt; dient auch als `id` seines Ankers. |
| `title` | `string` | Die Überschrift. Keine, wenn weggelassen. |
| `fields` | Feld-IDs | Die Felder im Abschnitt in vorgegebener Reihenfolge. |
| `collapsed` | `boolean` | Beginnt eingeklappt. |
| `collapsible` | `boolean` | Kann eingeklappt werden. |
| `readVariant` | `"grid" \| "summary"` | Wie der Abschnitt dargestellt wird, wenn der Datensatz angezeigt statt bearbeitet wird. |

### Aktionen, Ansichten und Überschreibungen

| Option | Typ | Auswirkung |
|---|---|---|
| `entityActions` | `(string \| TableEntityAction)[]` | Aktionen für einen Datensatz. Ein Objekt oder der Schlüssel einer unter `<RebaseCMS entityActions>` registrierten Aktion. Siehe [Entity Actions](/docs/frontend/entity-actions/). |
| `disableDefaultActions` | `("edit" \| "copy" \| "delete")[]` | Integrierte Aktionen, die diese Tabelle nicht anbieten soll. |
| `resetPasswordAction` | `false \| TableEntityAction` | Nur Auth-Tabelle (`defineAuthTable`): `false` entfernt die integrierte Aktion zum Zurücksetzen des Passworts; eine Aktion ersetzt sie (unabhängig davon angeboten, was der Auth-Adapter unterstützt: das Backend liegt bei Ihnen). Bei jeder anderen Tabelle mit einer Warnung ignoriert. |
| `entityViews` | `(string \| TableEntityView)[]` | Zusätzliche Tabs auf einem Datensatz. Siehe [Entity Views](/docs/frontend/entity-views/). |
| `Actions` | `Component[]` | Komponenten, die in der Toolbar der Collection gerendert werden. |
| `components` | `TableComponentOverrides` | Komponenten-Überschreibungen auf Collection-Ebene, jeweils `{ Component, wrap? }`. Siehe [Komponenten-Überschreibungen](/docs/frontend/component-overrides/#collection-level-component-overrides). |
| `browserCallbacks` | `CollectionCallbacks` | Callbacks, die im Panel nach den Server-Hooks ausgeführt werden. Reine Darstellung: Sie werden an jeden Besucher ausgeliefert und bieten keine Sicherheit. Siehe [React Hooks](/docs/hooks/). |
| `fields` | `TableFields` | Feldbezogene Optionen, geschlüsselt nach Spalte oder Relation (siehe unten). |

## Feldoptionen

`fields.<key>` akzeptiert die Optionen, die jedes Feld unterstützt, plus die Optionen seines jeweiligen
Spaltentyps. [Felder](/docs/collections/properties/) zeigt jede Option zusammen mit dem Widget,
das sie verändert.

### Jedes Feld

| Option | Typ | Auswirkung |
|---|---|---|
| `name` | `string` | Die Bezeichnung. Andernfalls vom Schlüssel abgeleitet (`publishDate` → "Publish Date"). |
| `description` | `string` | Hilfetext unter dem Feld. |
| `hidden` | `boolean` | Wird aus Tabellen-, Listen- und Kartenansichten sowie vom Datensatz selbst (Formular und Leseansicht) ferngehalten. Wird weiterhin von der API gelesen und geschrieben. |
| `hiddenInForm` | `boolean` | Wird vom Datensatz ferngehalten (Formular und Leseansicht). Bleibt in den Ansichten sichtbar. |
| `disabled` | `boolean \| { disabledMessage?, clearOnDisabled? }` | Das Steuerelement ist ausgegraut. `disabledMessage` gibt daneben den Grund an; `clearOnDisabled` leert den Wert, sobald er deaktiviert wird. |
| `readOnly` | `boolean` | Der Wert wird als reiner Text ohne Steuerelement dargestellt. |
| `Field` | `Component` | Ersetzt das Formularsteuerelement. Die Komponente selbst. Siehe [Benutzerdefinierte Felder](/docs/frontend/custom-fields/). |
| `Preview` | `Component` | Ersetzt die Darstellung des Werts außerhalb des Formulars. |
| `Filter` | `Component` | Ersetzt das Filter-Steuerelement für dieses Feld. |
| `columnWidth` | `number` | Die Spaltenbreite in der Tabelle in Pixeln. |
| `filledByServer` | `boolean` | Ein Server-Hook füllt das Feld beim Erstellen: Das Formular erlaubt die Erstellung eines Datensatzes ohne dieses Feld. |
| `span` | `1 \| 2 \| 3 \| 4` | Über wie viele der vier Spalten des Formularrasters sich das Feld erstreckt. |
| `customProps` | `unknown` | Wird unverändert an Ihre `Field`- und `Preview`-Komponenten weitergegeben. |
| `filterOperators` | `WhereFilterOp[]` | Schränkt die angebotenen Filteroperatoren ein. `[]` deaktiviert das Filtern dafür vollständig. |
| `propertyConfig` | `string` | Der Schlüssel eines Feldtyps, der unter `<Rebase propertyConfigs>` registriert ist. |
| `conditions` | `PropertyConditions` | JSON-Logic-Regeln, die das Feld basierend auf den Werten des Datensatzes ausblenden, deaktivieren oder als erforderlich markieren. Nur im Formular. Siehe [Bedingungen](/docs/collections/validation-and-conditions/#conditional-fields). |
| `dynamicProps` | `(props) => options \| undefined` | Gibt die aktuell geltenden Feldoptionen basierend auf dem bearbeiteten Datensatz zurück. Nur im Formular. |
| `metadata` | `Record<string, unknown>` | Ihre eigenen Daten. |

### Text- und UUID-Spalten

| Option | Typ | Auswirkung |
|---|---|---|
| `multiline` | `boolean` | Ein mehrzeiliges Eingabefeld, das mit seinem Inhalt wächst. |
| `markdown` | `boolean` | Ein Markdown-Editor mit Vorschau. |
| `previewAsTag` | `boolean` | Wird als Chip statt als Text dargestellt. |
| `clearable` | `boolean` | Fügt ein Steuerelement hinzu, das den Wert auf `null` setzt. |
| `urlPreview` | `PreviewType \| boolean` | Wie eine URL im Wert in der Vorschau angezeigt wird: `"image"`, `"video"`, `"audio"`, `"file"` oder `true` für einen Link. |
| `referenceTo` | `string` | Die Spalte enthält den Schlüssel eines Datensatzes in einer anderen Collection auf einer beliebigen Datenquelle: Sie wird als Referenz auf den Slug dieser Collection gerendert und ausgewählt. Siehe [Firestore](/docs/frontend/firebase/#from-a-table-to-firestore). |

### Spalten mit einer geschlossenen Wertemenge

Ein `col.enum([...])`, ein `.oneOf([...])` oder ein Array von beiden:

| Option | Typ | Auswirkung |
|---|---|---|
| `enumLabels` | `{ [value]?: string \| EnumLabel }` | Bezeichnungen für einige der Werte. Nicht aufgeführte Werte behalten ihr abgeleitetes Label und ihre Farbe. |
| `enumOrder` | `value[]` | Die Reihenfolge, in der Werte angeboten und Kanban-Spalten gerendert werden. Andernfalls die spalteneigene Reihenfolge. |
| `previewAsTag` | `boolean` | Bei einem `col.enum()`: als Chip dargestellt. |
| `clearable` | `boolean` | Bei einem `col.enum()`: fügt ein Steuerelement hinzu, das den Wert auf `null` setzt. |

Ein `EnumLabel` akzeptiert:

| Schlüssel | Typ | Auswirkung |
|---|---|---|
| `label` | `string` | Der Text auf dem Chip und in der Auswahlliste. |
| `color` | `ColorKey \| ColorScheme` | Ein Chip-Farbschlüssel (`"green"`, `"orangeDark"`) oder ein `{ color, text }`-Schema. Ein Wert ohne Angabe behält seine voreingestellte Farbe. |
| `disabled` | `boolean` | Wird angezeigt, aber nicht zur Auswahl angeboten. |

### Zahlenspalten

| Option | Typ | Auswirkung |
|---|---|---|
| `clearable` | `boolean` | Fügt ein Steuerelement hinzu, das den Wert auf `null` setzt. |
| `format` | `NumberFormatOptions` | Schreibt die Zahl als Währung, Prozentsatz oder mit fester Anzahl an Dezimalstellen. |

`format` akzeptiert `style` (`"decimal"`, `"currency"`, `"percent"`), `currency` (ein
ISO-Code, erforderlich bei `"currency"`), `locale` (andernfalls die des Betrachters),
`minimumFractionDigits`, `maximumFractionDigits` und `notation`
(`"standard"` oder `"compact"`, was `12000` als `12K` darstellt). Es ändert ausschließlich, was
angezeigt wird, niemals was gespeichert ist.

### Datums-, Zeitstempel- und Zeitspalten

| Option | Typ | Auswirkung |
|---|---|---|
| `clearable` | `boolean` | Fügt ein Steuerelement hinzu, das den Wert auf `null` setzt. |
| `mode` | `"date" \| "date_time"` | Nur einen Tag oder einen Tag und eine Uhrzeit auswählen und anzeigen. Andernfalls vom Spaltentyp abgeleitet. |
| `timezone` | `string` | Die IANA-Zeitzone, in der der Wert angezeigt und ausgewählt wird (`"Europe/Madrid"`). Andernfalls die des Betrachters. |

### Vektorspalten

| Option | Typ | Auswirkung |
|---|---|---|
| `clearable` | `boolean` | Fügt ein Steuerelement hinzu, das den Wert auf `null` setzt. |

### Storage-Spalten

| Option | Typ | Auswirkung |
|---|---|---|
| `storage` | `StorageCustomization` | Die Upload-Funktionen, die im Browser ausgeführt werden. |
| `clearable` | `boolean` | Fügt ein Steuerelement hinzu, das den Wert auf `null` setzt. |
| `urlPreview` | `PreviewType \| boolean` | Wie die gespeicherte URL in der Vorschau angezeigt wird. |

`storage` nimmt ausschließlich Funktionen entgegen; die serialisierbaren Optionen verbleiben auf
`col.storage({ … })` (siehe [Datei-Uploads](/docs/collections/file-uploads/)):

| Schlüssel | Signatur | Auswirkung |
|---|---|---|
| `path` | `(context) => string` | Der Ordner, in den eine Datei hochgeladen wird, ersetzt die `path`-Vorlage der Spalte. |
| `fileName` | `(context) => string \| Promise<string>` | Der gespeicherte Dateiname, ersetzt die `fileName`-Vorlage der Spalte. |
| `processFile` | `(file) => Promise<File>` | Transformiert eine Datei vor dem Hochladen. |
| `postProcess` | `(pathOrUrl) => Promise<string>` | Transformiert den gespeicherten Pfad oder die URL vor dem Schreiben in die Spalte. |
| `previewUrl` | `(fileName) => string` | Die URL zur Vorschau einer gespeicherten Datei. |

### Array-Spalten

| Option | Typ | Auswirkung |
|---|---|---|
| `expanded` | `boolean` | Jedes Element ist beim Laden geöffnet. |
| `minimalistView` | `boolean` | Elemente ohne ihren Rahmen und Header. |
| `sortable` | `boolean` | Elemente können per Drag-and-Drop neu angeordnet werden. |
| `canAddElements` | `boolean` | Elemente können hinzugefügt werden. |
| `of` | Feldoptionen | Die Optionen jedes einzelnen Elements. |
| `storage` | `StorageCustomization` | Die Upload-Funktionen für `col.storage().multiple()`. |

Auf einem Array definierte `enumLabels` und `enumOrder` gelten für dessen Elemente.

### JSON-Spalten

| Option | Typ | Auswirkung |
|---|---|---|
| `expanded` | `boolean` | Die Felder des Dokuments sind beim Laden geöffnet. |
| `minimalistView` | `boolean` | Die Felder des Dokuments ohne ihren Rahmen. |
| `spreadChildren` | `boolean` | Die Felder des Dokuments werden so dargestellt, als wären es eigene Felder des Datensatzes. |
| `keyValue` | `boolean` | Werden als freie Schlüssel/Wert-Paare bearbeitet. |
| `previewFields` | `string[]` | Die Schlüssel des Dokuments, die in dessen einzeiliger Zusammenfassung in dieser Reihenfolge aufgeführt werden. |
| `fields` | `{ [key]: field options }` | Die Optionen jedes Schlüssels des Dokuments. |
| `fieldOrder` | `string[]` | Die Reihenfolge, in der die Schlüssel des Dokuments angezeigt werden. |
| `of` | Feldoptionen | Die Optionen jedes Eintrags, falls das Dokument eine Liste ist. |
| `oneOf` | `{ [variant]: field options }` | Die Optionen jeder Variante eines typisierten Blocks (`json.oneOf`). |

Mit `col.jsonb().$type<T>()` oder einer `json.object({…})`-Struktur werden `fields` und `fieldOrder`
durch die Schlüssel des Dokuments typisiert. Siehe [Arrays und JSON](/docs/collections/arrays-and-maps/).

In einer Tabellenzelle, einer Listenzeile oder einer Karte ist ein JSON-Dokument eine einzelne Zeile: seine ersten
vier Top-Level-Schlüssel (oder seine `previewFields`), beschriftet mit ihrem `name`, jeweils
mit ihrem Wert, wenn dieser ein kurzer Text, eine Zahl oder ein Ja/Nein-Wert ist, `3 items` für eine
Liste und `4 fields` für ein verschachteltes Objekt, das nicht geöffnet wird. Eine Liste von
Dokumenten entspricht ihrer Anzahl. Das gesamte Dokument befindet sich auf dem Datensatz und im
Detail-Editor der Zelle. Für eine aussagekräftigere Zeile benennen Sie die relevanten Schlüssel in
`previewFields` oder weisen Sie dem Feld eine `Preview`-Komponente zu.

### Relationen

| Option | Typ | Auswirkung |
|---|---|---|
| `previewFields` | `string[]` | Die Felder des Zieldatensatzes, die im Chip für eine verknüpfte Zeile angezeigt werden. Es passen maximal drei hinein. |
| `defaultValue` | `EntityRelation \| EntityRelation[]` | Die verknüpfte(n) Zeile(n), mit denen das Formular eines neuen Datensatzes startet: `new EntityRelation(id, "<target slug>")` (`EntityRelation` aus `@rebasepro/cms-types`) oder eine Liste für eine To-Many-Relation. Wird erst beim Speichern des Formulars geschrieben. Der spalteneigene Standardwert lautet `.default()` auf der Spalte. |
| `widget` | `"select" \| "dialog"` | Wie eine verknüpfte Zeile ausgewählt wird. |
| `fixedFilter` | `FilterValues` | Bietet nur Zeilen an, die diesen Filter erfüllen. |
| `includeId` | `boolean` | Zeigt die ID der verknüpften Zeile in Vorschauen an. |
| `includeEntityLink` | `boolean` | Zeigt einen Link an, der die verknüpfte Zeile öffnet. |
| `renderInForm` | `boolean` | Zeichnet eine To-Many-Relation zusätzlich als Auswahlfeld im Formular neben ihrem Tab. |
| `overrides` | Tabellenoptionen ohne `fields` | Wie das Ziel im Tab dieser Relation dargestellt wird. |

Siehe [Relationen im Panel](/docs/collections/relations-in-the-admin-panel/).

## Anpassungen, `ui-config.json` und Einstellungen

Was das Panel für eine Tabelle anzeigt, wird in einer festen Reihenfolge zusammengestellt, wobei jede Ebene
die vorherige überschreibt:

1. **Die abgeleitete Collection**: was das Panel aus der vom Server
   bereitgestellten Tabelle liest.
2. **Code**: die `customizeTable`-Ergebnisse, die Sie als `tableCustomizations` übergeben.
3. **`frontend/src/cms/ui-config.json`**: die Darstellung des Workspaces,
   übergeben als `uiConfig`. Es ist eine Datei im Frontend, die manuell (oder durch
   Ihren Agenten) bearbeitet wird, sodass sie zusammen mit diesem überprüft und bereitgestellt wird.
4. **Workspace-Einstellungen**: was ein Administrator in einem Deployment speichert, in der
   Tabelle `rebase.ui_preferences` über
   [`/api/admin/ui-config`](/docs/backend/endpoints/). Das Schreiben erfordert
   `schema:write`.
5. **Benutzereinstellungen**: die individuellen Spaltenbreiten, Ansichtsumschaltungen und
   ausgeblendeten Spalten einer einzelnen Person. Werden im Browser vorgehalten, solange man abgemeldet ist.

Eine standardmäßig generierte `App.tsx` bindet die Datei bereits ein:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { tableCustomizations } from "./cms";
import uiConfig from "./cms/ui-config.json";

export const Admin = () => <RebaseCMS tableCustomizations={tableCustomizations} uiConfig={uiConfig} />;
```

Einstellungen enthalten ausschließlich Darstellungsdaten: Labels, Icon, Ansichtsmodi, Spaltenreihenfolge,
ausgeblendete Spalten, Enum-Labels und -Farben, Kanban und Query-Defaults. Eine Schema-Tatsache
landet dort niemals; diese befinden sich in `backend/schema`.

`rebase build` übernimmt `frontend/src/cms/ui-config.json` in das Bundle
(`entry.uiConfig`), sodass ein bereitgestelltes Backend diese ebenfalls kennt: `GET /api/admin/ui-config`
liefert sie als `shipped` neben der Workspace- und Benutzerebene aus, und die MCP-Ansichten
sowie `describe_table` führen dieselben drei Ebenen zusammen – die Datei, den Workspace und
die des Aufrufers selbst (keine bei einem API-Key) –, sodass ein Agent genau die Labels, Reihenfolgen,
ausgeblendeten Spalten und Enum-Labels sieht, die auch ein Mensch im Panel sieht.

`rebase verify` prüft jeden `customizeTable`-Aufruf in `frontend/src/cms` gegen
die Tabellen, ohne den Code auszuführen: Es erkennt Anpassungen für Tabellen oder
Felder, die nicht existieren, erforderliche Spalten, die das Formular ausblendet, Tabellen,
die doppelt angepasst wurden, eine `ui-config.json`, die an kein `<RebaseCMS>` übergeben wird, sowie eine
Vite-Konfiguration ohne `rebaseBackendGuard()`. Siehe [`rebase verify`](/docs/cli/#rebase-verify).

## Nächste Schritte

- [Wie Tabellen zu Collections werden](/docs/collections/): Was das Panel vor alledem ableitet
- [Felder](/docs/collections/properties/): Widgets und Optionen für jeden Spaltentyp
- [Ansichtsmodi](/docs/frontend/view-modes/): Tabelle, Karten, Kanban, Anzeige-Slots, Filter
- [Entity Actions](/docs/frontend/entity-actions/): `entityActions` und `updateRecord`
- [Firestore neben Postgres](/docs/frontend/firebase/): `externalCollections` und Referenzen über Engines hinweg
