---
sourceHash: 6f0489ae490ff4b1
title: Collections
sidebar_label: Collections
description: Collections sind der zentrale Baustein von Rebase – jede Collection wird einer Datenbanktabelle zugeordnet und definiert deren Schema, Relationen, Sicherheit und UI-Verhalten.
---

## Was ist eine Collection?

Eine **Collection** ist ein TypeScript-Objekt, das eine Datenbanktabelle beschreibt und festlegt, wie sie im Rebase CMS dargestellt werden soll. Sie definiert:

- **Schema** — Eigenschaften (Properties/Spalten), deren Typen und Validierungsregeln
- **Relationen** — Fremdschlüssel, Junction-Tabellen und Join-Pfade
- **Sicherheit** — Row-Level-Security-Policies (RLS)
- **Lifecycle-Hooks** — Callbacks für Create-, Update- und Delete-Operationen
- **CMS-Verhalten** — Ansichtsmodi, Inline-Bearbeitung, Entity-Views, Aktionen – alles unter `admin`

## Eine Collection deklarieren: `defineCollection`

Umschließen Sie das Literal mit `defineCollection`. Zur Laufzeit ist dies eine Identitätsfunktion – sie gibt das Objekt unverändert zurück – und verursacht somit keinerlei Overhead. Ihr Vorteil liegt in der Typinferenz: Ein `const`-Typparameter erfasst Ihre `properties`-Schlüssel als Literal-Typen, und die schlüsselförmigen Felder des `admin`-Blocks werden anschließend dagegen geprüft. Ein Name, der nicht zu Ihren Properties gehört, ist ein **Kompilierfehler**, nicht nur ein fehlender Autocomplete-Vorschlag.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const products = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" },
        price: { name: "Price", type: "number" }
    },
    admin: {
        display: { title: "name" },  // completion: "name" | "price"
        sort: ["price", "asc"],      // completion on the first element
        propertiesOrder: ["name", "price"]
    }
});
```

```typescript
    admin: {
        display: { title: "nmae" }
        //                ~~~~~~ Type '"nmae"' is not assignable to type
        //                       'PropertyPath<…>'. Did you mean '"name"'?
    }
```

Die geprüften Felder sind `display`, `sort`, `propertiesOrder`, `listProperties`,
`previewProperties`, `orderProperty` sowie die Filter `defaultFilter`, `fixedFilter`
und `filterPresets`. Neben einem einfachen Property-Schlüssel werden drei Formen akzeptiert:

| Form | Beispiel | Hinweise |
| --- | --- | --- |
| Punkt-Pfad in eine `map` | `"profile.displayName"` | Die **Wurzel** (Root) muss eine echte Property sein; der Pfad darunter wird nicht geprüft. Nicht verfügbar für `previewProperties` / `orderProperty`, die einen Top-Level-Schlüssel erwarten. |
| Spalte einer Unter-Collection | `"subcollection:orders"` | Nur für `propertiesOrder` / `listProperties`. |
| Ein `additionalFields`-Schlüssel | `"score" as AdditionalFieldKey` | Nur für `propertiesOrder` / `listProperties`. Erfordert den Type-Cast – siehe unten. |

`AdditionalFieldDelegate.key` ist ein einfacher `string`, weshalb das Typsystem nicht wissen
kann, welche zusätzlichen Schlüssel eine Collection deklariert. Anstatt diese Felder wieder für
jeden beliebigen String zu öffnen, macht der Type-Cast die Ausnahme explizit:

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Importieren Sie dies in einem Projekt mit Admin-Panel aus `@rebasepro/cms-types` – das ist
die Version, die auch den `admin`-Block typprüft. Ein Headless-BaaS-Projekt, das keinen
Admin-Block hat, importiert dieselbe Funktion stattdessen aus `@rebasepro/common`.

Das direkte Annotieren des Typs funktioniert weiterhin und wird ebenfalls geprüft:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const products: PostgresCollectionConfig = {
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" }
    }
};
```

eine Typannotation *validiert jedoch nur die Struktur* – sie kann Ihre Property-Namen nicht
einsehen, sodass die Schlüsselfelder in `admin` wieder jeden beliebigen String akzeptieren.
Bevorzugen Sie `defineCollection`, es sei denn, Sie müssen den Typ explizit benennen.

:::note
`buildCollection` und `buildProperty` existieren nicht mehr. `buildCollection` ist
`defineCollection` ohne Typinferenz; `buildProperty` umschloss eine Property lediglich
mit einem Typ, den sie ohnehin bereits hatte. Siehe das [Changelog](/docs/changelog) für
die einzeilige Migration.
:::

## Anatomie: Der Vertrag und das Panel

Eine Datei, zwei Zielgruppen. Alles, was für die *Datenbank und die API* relevant ist,
befindet sich auf oberster Ebene; alles, was das *Admin-Panel* rendert, liegt innerhalb von `admin`.

```typescript
const posts = {
    // ── The backend reads these ──────────────────────────────
    slug: "posts",
    table: "posts",
    properties: { /* … */ },
    relations: [ /* … */ ],
    securityRules: [ /* … */ ],
    callbacks: { /* … */ },
    history: true,

    // ── The admin panel reads these ──────────────────────────
    admin: {
        icon: "FileText",
        listProperties: ["title", "status"],
        defaultViewMode: "table",
        entityViews: ["preview"]
    }
};
```

Diese Trennung ist nicht nur kosmetischer Natur. Sie ermöglicht es Rebase, als eigenständiges Backend zu agieren:

- Ein **BaaS- oder Headless-Projekt** schreibt niemals einen `admin`-Block. Seine Collections –
  oder gar keine Collections, da der BaaS-Modus die Datenbank introspektiv erfasst – beschreiben
  ausschließlich Daten und Autorisierung, sonst nichts. `@rebasepro/types` enthält keinen UI-Code,
  sodass der Abhängigkeitsbaum eines Headless-Projekts rein serverseitig bleibt.
- Das **Backend liest niemals innerhalb dieses Blocks**. Er wird entfernt, bevor eine Collection
  an den Contract-Endpunkt oder in ein Build-Bundle serialisiert wird, und ist von der
  Schema-Versionierung ausgeschlossen – die Änderung eines Icons führt also nicht dazu, dass
  jedes generierte SDK als veraltet gemeldet wird.

### Der `admin`-Block existiert nur, wenn Sie die Admin-Typen installieren

`@rebasepro/types` deklariert kein `admin`-Feld – weder für eine Collection noch für eine
Property. In einem BaaS-Projekt ist das Hinzufügen dieses Feldes ein **Typfehler**.
`@rebasepro/cms-types` fügt es per Declaration Merging wieder hinzu, sodass eine einzige
Zeile pro Projekt genügt, um es zu aktivieren:

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Danach verfügen die einfachen Core-Typen über einen vollständig typisierten Block – ein
Tippfehler wie `icoon` führt zu einem Fehler, und Sie erhalten Autovervollständigung:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const posts = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string", admin: { multiline: true } }
    },
    admin: { icon: "FileText" }
});
```

<!-- docs-verify: ignore -->
Eine Declaration Augmentation gilt für das gesamte TypeScript-*Programm*, und `config/` sowie
`frontend/` sind separate Programme – weshalb die Referenz in das Config-Paket gehört. Es gibt
keinen Wrapper-Typ `AdminCollectionConfig`: Sobald das Feld hinein gemergt ist, ist
`CollectionConfig` der zu verwendende Typ beim Erstellen.

:::note[Warum ein BaaS-Projekt keinen Overhead hat]
Ein Property-Typ in einer BaaS-Installation enthält kein `Field`, kein `columnWidth`, kein
`hideFromCollection` – diese befinden sich in `AdminPropertyOptions` im Admin-Paket. Diese
Garantie wird aktiv per Test sichergestellt: `tests/e2e/baas-typecheck/src/admin_absent.ts`
verwendet `@ts-expect-error` auf `admin`, sodass der Build fehlschlägt, falls das Feld im Core
jemals wieder beschreibbar werden sollte.
:::

### Migration von einer flachen Collection

Vor Version 0.11 befanden sich diese Felder auf der obersten Ebene. Um sie zu verschieben:

```bash
node tooling/scripts/codemod/collections-admin-block.mjs config/collections
```

Das Skript meldet alles, was es nicht sicher verschieben kann – insbesondere Darstellungsoptionen
innerhalb von `relations[].overrides`, die manuell als `overrides: { admin: { … } }` angepasst
werden müssen.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    slug: "products",              // URL path and API endpoint
    name: "Products",              // Display name (plural)
    singularName: "Product",       // Display name (singular)
    table: "products",            // PostgreSQL table name

    properties: {
        name: {
            type: "string",
            name: "Product Name",
            validation: { required: true }
        },
        price: {
            type: "number",
            name: "Price",
            validation: { required: true, min: 0 }
        },
        category: {
            type: "string",
            name: "Category",
            enum: [
                { id: "electronics", label: "Electronics", color: "blue" },
                { id: "clothing", label: "Clothing", color: "pink" },
                { id: "books", label: "Books", color: "orange" }
            ]
        },
        description: {
            type: "string",
            name: "Description",
            admin: { multiline: true }
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        createdAt: {
            type: "date",
            name: "Created At",
            autoValue: "on_create",
            admin: { readOnly: true }
        }
    },
    admin: {
        icon: "Package"               // Lucide icon name
    }
});

```

## Wichtige Eigenschaften

### Identifikation

| Property | Type | Description |
|----------|------|-------------|
| `slug` | `string` | **Erforderlich.** URL-sicherer Bezeichner. Wird in der Admin-UI-URL und im REST-API-Pfad (`/api/data/{slug}`) verwendet. |
| `name` | `string` | **Erforderlich.** Anzeigename (Plural). Wird in der Navigation und in Seitenüberschriften angezeigt. |
| `singularName` | `string` | Anzeigename für eine einzelne Entity. Wird in „Neues Produkt“, „Produkt bearbeiten“ usw. verwendet. |
| `description` | `string` | Ein Satz darüber, was diese Collection enthält, dargestellt über der Liste. Markdown. |
| `table` | `string` | PostgreSQL-Tabellenname. Standardmäßig `toSnakeCase(slug)` – definieren Sie dies nur, um die URL von der Tabelle zu entkoppeln, z. B. bei einer bestehenden Tabelle `blog_posts`, die unter `/posts` bereitgestellt wird. |
| `admin.icon` | `string` | Ein [Lucide](https://lucide.dev/icons)-Icon-Name, z. B. `"FileText"`, `"ShoppingCart"`. Ein gerendertes Element funktioniert ebenfalls, aber der Name übersteht die Serialisierung, weshalb der Schema-Editor diesen zurückschreibt. |

### Schema

| Property | Type | Description |
|----------|------|-------------|
| `properties` | `Properties` | **Erforderlich.** Map von Property-Schlüssel → Property-Definition. Jeder Schlüssel wird zu einer Datenbankspalte. |
| `relations` | `Relation[]` | SQL-Relationen – Fremdschlüssel, Junction-Tabellen. Siehe [Relationen](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Row-Level-Security-Policies. Siehe [Sicherheitsregeln](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Postgres-Indizes, die diese Tabelle benötigt. Siehe [Indizes](/docs/backend/indexes). |
| `search` | `SearchConfig` | Gerankte Volltextsuche über die angegebenen Felder, einschließlich JSONB- und Array-Inhalten. Nur Postgres. Siehe [Suche](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Markiert die Collection als Authentifizierungs-Collection (Benutzerverwaltung, Passwort zurücksetzen usw.) |
| `schema` | `string` | Postgres-Schema, in dem sich die Tabelle befindet – `"public"`, `"rebase"`, `"auth"`. Standardmäßig `"public"`. |
| `disableDefaultPolicies` | `boolean` | Entfernt die vom Generator standardmäßig injizierten Richtlinien – ein Admin-/Server-SELECT sowie bei einer Auth-Collection ein Self-Read plus ein Admin-Only-Schreibfilter – und übernimmt die volle Verantwortung für das RLS dieser Collection. Standardmäßig `false`. Siehe [Sicherheitsregeln](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Wandelt `delete` in einen Zeitstempel um und blendet mit einem Zeitstempel versehene Zeilen bei jedem Lesevorgang aus. `true` verwendet `deletedAt`; die Objektform benennt das Feld um. Die Collection muss diese `date`-Property selbst deklarieren. Nur Postgres – siehe [Soft Delete](/docs/collections/soft-delete). |
| `strictWrites` | `boolean` | Weist Schreibvorgänge, die ein nicht deklariertes Feld enthalten, mit einem 400-Fehler ab. Standardmäßig `true`. Setzen Sie dies nur auf `false`, wenn die Spalte tatsächlich existiert und nicht deklariert ist – z. B. durch einen Trigger befüllt oder introspektiv ermittelt statt explizit notiert. |

### UI-Konfiguration

Alle folgenden Optionen gehören in den `admin`-Block.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Standard-Ansichtsmodus |
| `enabledViews` | `ViewMode[]` | Die vier integrierten plus jede deklarierte benutzerdefinierte Ansicht (Kanban nur, wenn eine `enum`-Property existiert) | Welche Ansichtsmodi verfügbar sind |
| `kanban` | `KanbanConfig` | — | Kanban-Konfiguration (Spalten-Property). Immer zusammen mit `orderProperty` verwenden – siehe [Ansichtsmodi](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Schlüssel der **String**-Property, die den Drag-and-Drop-Sortierschlüssel enthält. Erforderlich für ein funktionierendes Kanban-Board |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | Abhängig von der Ansicht: `"split"` für List, `"full_screen"` für Table und Cards, `"side_panel"` für Kanban und benutzerdefinierte Ansichten | Wie Entities zur Bearbeitung geöffnet werden |
| `sideDialogWidth` | `number \| string` | — | Breite des Seitendialogs |
| `inlineEditing` | `boolean` | `true` | Inline-Bearbeitung in der Tabellenansicht (Spreadsheet) aktivieren |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Standard-Dichte der Listen-, Tabellen- und Kartenansichten (Zeilenhöhe der Tabelle) |
| `pagination` | `boolean \| number` | `true` (50) | Paginierung aktivieren und/oder Seitengröße festlegen. `false` lädt jede Zeile; in der Entwicklung warnt die Konsole einmalig, wenn dies mehr als 10.000 Zeilen betrifft |
| `listProperties` | `string[]` | — | In der Listenansicht anzuzeigende Properties |
| `propertiesOrder` | `string[]` | — | Spaltenreihenfolge in der Tabellenansicht |
| `selectionEnabled` | `boolean` | `true` | Zeilenauswahl aktivieren |
| `hideFromNavigation` | `boolean` | `false` | In der Sidebar-Navigation ausblenden |
| `defaultSelectedView` | `string \| function` | — | Standardmäßig zu öffnende Ansicht oder Unter-Collection |

### Entity-Optionen

Befinden sich in `admin`, mit Ausnahme von `history`, welches ein Backend-Feature ist und auf oberster Ebene verbleibt.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Automatisches Speichern zwei Sekunden nach einer Bearbeitung, sobald das Formular valide ist. Ein Formular für einen neuen Datensatz wird erst gespeichert, wenn etwas eingegeben wurde. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Ungespeicherte Änderungen sichern |
| `hideIdFromForm` | `boolean` | `false` | Entity-ID im Formular ausblenden |
| `hideIdFromCollection` | `boolean` | `false` | ID-Spalte in der Tabelle ausblenden |
| `includeJsonView` | `boolean` | `true` | Rohwerte im Datensatz-Inspektor anbieten |
| `history` | `boolean` | `false` | Änderungen im Entity-Verlauf (History) nachverfolgen |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Wenn ein vorhandener Datensatz im Formular geöffnet wird, den deklarierten `defaultValue` jeder Property in Werte einfügen, die der Datensatz leer lässt (`null` oder fehlend), sodass der nächste Speichervorgang diesen festschreibt |
| `previewProperties` | `string[]` | — | In Referenz-Vorschauen anzuzeigende Properties |
| `display` | `EntityDisplay` | — | Bestimmt die Belegung der Anzeige-Rollen – siehe [Entity-Anzeige](#entity-anzeige) |

### Erweitert

Auf oberster Ebene, da das Backend sie liest:

| Property | Type | Description |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Lifecycle-Hooks (`beforeSave`, `afterSave`, `beforeDelete` usw.) |
| `childCollections` | `() => CollectionConfig[]` | Die unter einer Entity dieser Collection verschachtelten Collections. Wird während der Normalisierung aus dem befüllt, wie der Treiber sie ausdrückt – bei Firestore `subcollections`, bei Postgres eine `hasMany`-Relation. Ein benutzerdefinierter Treiber ist der einzige Grund, dies manuell zu setzen |
| `dataSource` | `string` | Welche registrierte Datenquelle diese Collection unterstützt (Standard: die unbenannte Datenquelle) |
| `engine` | `string` | Die dahinterstehende Engine – `"postgres"`, `"firestore"`, `"mongodb"`. Wird aus `dataSource` aufgelöst; nur setzen, um dies zu überschreiben |
| `databaseId` | `string` | Datenbank oder Schema innerhalb der Engine |
| `metadata` | `Record<string, unknown>` | Beliebige Daten, die Ihr eigener Code an eine Collection anhängen muss. Rebase liest dies nicht; es übersteht die Serialisierung unverändert |
| `ownerId` | `string` | **Nur im Admin-Formular – wird weder von der API noch von der Datenbank erzwungen.** Die Benutzer-ID, die der Collection-Editor einer neu erstellten Collection zuweist und neben ihrem Namen anzeigt. Nichts im Request-Pfad greift darauf zu |

`subcollections` und `path` existieren nur in Konfigurationen für **Dokumentendatenbanken** –
`FirebaseCollectionConfig` und, für `path`, `MongoDBCollectionConfig`:

| Property | Type | Description |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Nur Firestore.** Unter jedem Dokument verschachtelte Collections. Eine Postgres-Collection drückt dasselbe über eine `hasMany`-[Relation](/docs/collections/relations) aus, wodurch `childCollections` befüllt wird |
| `path` | `string` | **Nur Firestore und MongoDB.** Der Pfad oder Collection-Name in der Engine, falls dieser vom Slug abweicht |

Und innerhalb von `admin`, da nur das Panel sie darstellt:

| Property | Type | Description |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Benutzerdefinierte Aktionen für Entities (archivieren, veröffentlichen usw.) |
| `admin.Actions` | `ComponentRef<CollectionActionsProps>[]` | Benutzerdefinierte Toolbar-Aktionskomponenten |
| `admin.entityViews` | `EntityCustomView[]` | Benutzerdefinierte Tabs in der Entity-Detailansicht |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Berechnete/virtuelle Spalten |
| `admin.exportable` | `boolean \| ExportConfig` | Datenexport aktivieren |
| `admin.components` | `CollectionComponentOverrideMap` | Auf die Collection beschränkte UI-Komponenten-Overrides |

Jedes dieser sechs Felder auf der obersten Ebene anzugeben, führt zu einem Fehler beim Systemstart
mit einer Meldung, die den Schlüssel und seinen neuen Speicherort nennt.

## Entity-Anzeige

Jede Oberfläche, die einen Datensatz darstellt, rendert eine Teilmenge von sechs Rollen: **title**,
**subtitle**, **image**, **status**, **date** und **tags**. Eine Zeile in einer Liste besteht aus Image +
Title + Subtitle + Status + Date, eine Karte aus denselben Elementen mit dem Bild oben, eine
Referenzauswahl aus Title + Subtitle und eine Seitenüberschrift aus dem Titel allein.

Jede Rolle wird aus Ihren Properties abgeleitet und kann alternativ explizit definiert werden – als
Property-Pfad oder als Funktion:

```typescript
const exercises = defineCollection({
    name: "Exercises",
    slug: "exercises",
    table: "exercises",
    properties: {
        name: { name: "Name", type: "string" },
        cover: { name: "Cover", type: "string", storage: { storagePath: "covers/" } },
        city: { name: "City", type: "string" }
    },
    admin: {
        display: {
            title: "name",                                  // a property path
            image: "cover",
            subtitle: ({ row }) => `in ${String(row.city)}`        // computed
        }
    }
});
```

Alles, was Sie weglassen, behält seinen abgeleiteten Wert; die Angabe einer einzelnen Rolle
erfordert also nicht die Definition aller sechs.

Einem Resolver wird `{ row, context }` übergeben. `row` ist der Datensatz, wie ihn der Server
sendet, in der Struktur, die `useRows` und `context.data` zurückgeben: Datumsangaben als ISO-Strings,
ein belongsTo als Fremdschlüsselspalte (`authorId`) und inklusive `id`. Eine vom Admin geladene
Relation wird unter ihrem Namen verschachtelt bereitgestellt, genau wie es RESTs `include`
zurückgibt – `row.author` ist die Zeile des Autors neben `authorId` –, sodass ein
Resolver das Feld eines verknüpften Datensatzes ohne eigenen Request auslesen kann:

```typescript
admin: {
    display: {
        // Undefined where the row holds only the author's id.
        subtitle: ({ row }) => typeof row.author === "object" && row.author !== null && "name" in row.author
            ? String(row.author.name)
            : undefined
    }
}
```

### Berechnete und asynchrone Rollen

Ein Resolver darf `async` sein, wodurch eine Rolle auch Daten auslesen kann, die der Datensatz
selbst nicht enthält – ein Dokument in einer Unter-Collection oder einen Wert hinter einer API:

```typescript
admin: {
    display: {
        // The exercise's name lives one document down, per locale.
        title: async ({ row, context }) => {
            const locale = await context.data.exercise_locales.findById(`${String(row.id)}/de-DE`);
            return locale?.exercise_title;
        }
    }
}
```

Während das Promise aussteht, zeigt die Oberfläche den abgeleiteten Wert an und ersetzt ihn durch
den aufgelösten Wert, sobald dieser vorliegt – ein Titel ist niemals ein Ladeindikator (Spinner).
Die Ergebnisse werden pro Datensatz und Rolle zwischengespeichert, und gleichzeitige Abfragen
desselben Paares teilen sich einen Aufruf, sodass eine Liste von fünfzig Zeilen jede Zeile nur
einmal statt bei jedem Render-Vorgang auflöst.

Geben Sie `undefined` zurück, wenn ein Datensatz keinen Wert für die Rolle hat; der eigene
Fallback der Oberfläche weiß besser, was stattdessen dorthin gehört (eine Überschrift verwendet
den Singular-Namen der Collection, ein Link die ID). Ein Resolver, der einen Fehler wirft, wird
wie `undefined` behandelt und einmalig protokolliert – ein Titel, der nicht abgerufen werden
kann, darf nicht die gesamte Zeile zum Absturz bringen.

Bevorzugen Sie einen Pfad, wann immer der Wert im Datensatz vorhanden ist: Ein Pfad behält das
spezifische Rendering der Property bei, sodass ein Enum-Status ein farbiger Chip und ein Datum
formatiert bleibt – was ein Resolver, der einen einfachen String zurückgibt, nicht darstellen kann.

:::note[`titleProperty` ersetzt]
`admin.titleProperty` wurde zugunsten von `admin.display.title` entfernt. Derselbe
String funktioniert dort weiterhin, und das neue Feld akzeptiert auch einen Resolver. Eine Collection,
die noch den alten Schlüssel verwendet, wird von `defineCollection` mit dem üblichen
Fehler für unbekannte Schlüssel abgewiesen.
:::

### Auswahl der Titel-Property
Wenn `display.title` nicht festgelegt ist, wird die Property, die als Anzeigetitel der Entity (Vorschauen, Kopfzeilen) dient, automatisch bestimmt:
1. Wenn `propertiesOrder` explizit definiert ist, wird die erste Property in dieser Reihenfolge ausgewählt, die als Titel infrage kommt: ein `string`, eine `relation` mit einfacher Kardinalität oder eine `reference`. Bezeichner (Primär- und Fremdschlüssel, `uuid`-Spalten, `isId`), Datei-Upload-Felder und ausgeblendete Properties qualifizieren sich grundsätzlich nicht.
2. Wenn keine `propertiesOrder` definiert ist, werden dieselben Kandidaten nach Priorität geordnet: Zuerst ein String, dessen Schlüssel eine Bezeichnung darstellt (`name`, `title`, `label`, …), dann einfacher kurzer Text, eine E-Mail, ein Enum, langer Text, eine Relation oder ein User-Picker und zuletzt eine Referenz. Bei Gleichstand entscheidet die Deklarationsreihenfolge.

### Relations-Vorschauen in Tabellen
Wenn `propertiesOrder` explizit gesetzt ist, werden Relations-Properties **nicht** automatisch aus den standardmäßigen Vorschau-Spalten herausgefiltert (während sie bei ungeordneten Standardeinstellungen ausgeschlossen werden, um langsame Join-Operationen zu vermeiden).

### Wie ein Titel-Wert gerendert wird
Unabhängig davon, was die Titel-Property enthält, rendert das Panel einen String. Ein Datum wird formatiert, ein Array zusammengefügt und eine Relation – die als `{ id, data: { values } }` statt als Text eintrifft – wird nach dem ersten Vorkommen von `name`, `title`, `label` oder `displayName` in der verknüpften Zeile durchsucht, danach nach ihrem ersten kurzen String-Wert und greift andernfalls auf ihre ID zurück. Ein Titel kann also eine `relation`-Property referenzieren und dennoch als Name statt als UUID dargestellt werden.

Dies ist kein exportierter Helper: Es ist genau das, was jede Oberfläche, die einen Datensatz darstellt, ohnehin tut. Es muss nichts aufgerufen und nichts importiert werden.

## Collection-Builder

Verwenden Sie für dynamische Collections, die sich basierend auf dem Benutzer oder externen Daten ändern, eine Builder-Funktion:

```typescript
const collectionsBuilder: CollectionConfigsBuilder = ({ user, authController }) => {
    const collections = [productsCollection];

    // `extra` is whatever your auth provider put there, so name its shape here.
    const extra = authController.extra as { role?: string };
    if (extra.role === "admin") {
        collections.push(adminSettingsCollection);
    }

    return collections;
};
```

Der Builder empfängt auch `data`, welches Zeilen so liest, wie der Server sie sendet – analog
zu `context.data`: `await data.collection("tenants").find()` löst zu
`{ data: rows, meta }` auf.

## Filtern und Sortieren

Sie können Standardfilter oder erzwungene Filter festlegen. Alle drei betreffen die
Darstellung – womit das Panel geöffnet wird – und liegen daher in `admin`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const invoices = defineCollection({
    slug: "invoices",
    name: "Invoices",
    table: "invoices",
    properties: {
        active: { name: "Active", type: "boolean" },
        tenantId: { name: "Tenant", type: "string" },
        createdAt: { name: "Created", type: "date" }
    },
    admin: {
        // Default filter — users can change it
        defaultFilter: { active: ["==", true] },

        // Fixed filter — cannot be changed; filters the user applies
        // on other fields combine with it
        fixedFilter: { tenantId: ["==", currentTenantId] },

        // Default sort
        sort: ["createdAt", "desc"]
    }
});
```

Benutzer können eine Collection mit einem `fixedFilter` weiterhin filtern: Alles, was sie auf
andere Felder anwenden, wird damit kombiniert (AND), und die festen Felder bleiben gesperrt.

Ein `fixedFilter` schränkt lediglich ein, was das Panel *anfordert*; er stellt keine Sicherheitsgrenze dar.
Was ein Aufrufer lesen darf, regelt eine [Sicherheitsregel](/docs/collections/security-rules),
die von der Datenbank für jeden Aufrufer durchgesetzt wird – unabhängig davon, ob der Zugriff über das Panel erfolgt oder nicht.

## Viele Collections

Nichts in Rebase begrenzt die Anzahl der Collections, aber zwei Faktoren steigen damit an:

- **Der initiale Download des Admin-Panels.** Das Panel benötigt seine Navigation in dem
  Moment, in dem sich jemand anmeldet. Daher wird die Konfiguration jeder Collection in das
  gebündelt, was der Browser für den Login-Bildschirm abruft – jeweils ca. 2,4 KB minifiziert,
  sodass 200 Collections ungefähr 480 KB (ca. 80 KB gzipped) hinzufügen. Was zum Öffnen
  einer Collection benötigt wird (die Tabelle, die Datensatzansichten, das Formular), wird erst
  bei Bedarf geladen.
- **`rebase db push`.** Atlas plant einen Push, indem das gesamte Schema abgeglichen wird, und
  dieser Aufwand wächst schneller als die Anzahl der Tabellen: Bei 400 oder mehr Tabellen dauert
  ein Push mehrere Dutzend Sekunden – siehe [Dauer eines Pushs](/docs/cli/schema#rebase-db-push).

## Nächste Schritte

- **[Entity-Callbacks](/docs/collections/callbacks)** — Lifecycle-Hooks zur Datensynchronisation zwischen Collections, Validierung, Side-Effects
- **[Properties](/docs/collections/properties)** — Alle Property-Typen und Optionen
- **[Relationen](/docs/collections/relations)** — Fremdschlüssel, Junction-Tabellen, Joins
- **[Sicherheitsregeln](/docs/collections/security-rules)** — Row-Level-Security (RLS)
- **[Ansichtsmodi](/docs/frontend/view-modes)** — Liste, Tabelle, Karten, Kanban
