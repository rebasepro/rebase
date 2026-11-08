---
sourceHash: 92f11ec9a842b6d9
title: Collections
sidebar_label: Collections
description: Collections sind der zentrale Baustein von Rebase – jede Collection wird einer Datenbanktabelle zugeordnet und definiert deren Schema, Relationen, Sicherheit und UI-Verhalten.
---

## Was ist eine Collection?

Eine **Collection** ist ein TypeScript-Objekt, das eine Datenbanktabelle beschreibt und festlegt, wie sie im Rebase CMS dargestellt werden soll. Sie definiert:

- **Schema** – Eigenschaften (Spalten), deren Typen und Validierungsregeln
- **Relationen** – Fremdschlüssel, Junction-Tabellen und Join-Pfade
- **Sicherheit** – Row-Level-Security-Richtlinien
- **Lifecycle-Hooks** – Callbacks für Erstell-, Aktualisierungs- und Löschoperationen
- **CMS-Verhalten** – Ansichtsmodi, Inline-Bearbeitung, Entitätsansichten, Aktionen – alles unter `admin`

## Deklaration: `defineCollection`

Umschließen Sie das Literal mit `defineCollection`. Zur Laufzeit ist dies die Identitätsfunktion – sie gibt das Objekt unverändert zurück – verursacht also keinen Overhead. Der Vorteil liegt in der Typinferenz: Ein `const`-Typparameter erfasst Ihre `properties`-Schlüssel als Literal-Typen, und die schlüsselförmigen Felder des `admin`-Blocks werden anschließend dagegen geprüft. Ein Name, der nicht zu Ihren Eigenschaften gehört, führt zu einem **Kompilierfehler** und nicht bloß zu einem fehlenden Vorschlag bei der Autovervollständigung.

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

Die überprüften Felder sind `display`, `sort`, `propertiesOrder`, `listProperties`,
`previewProperties`, `orderProperty` sowie die Filter `defaultFilter`, `fixedFilter`
und `filterPresets`. Neben einem einfachen Eigenschaftsschlüssel werden drei Formen akzeptiert:

| Form | Beispiel | Hinweise |
| --- | --- | --- |
| Punktierter Pfad in eine `map` | `"profile.displayName"` | Die **Wurzel** (Root) muss eine echte Eigenschaft sein; der Pfad darunter wird nicht geprüft. Gilt nicht für `previewProperties` / `orderProperty`, die einen Schlüssel auf oberster Ebene erfordern. |
| Spalte einer untergeordneten Collection | `"subcollection:orders"` | Nur für `propertiesOrder` / `listProperties`. |
| Ein `additionalFields`-Schlüssel | `"score" as AdditionalFieldKey` | Nur für `propertiesOrder` / `listProperties`. Erfordert den Type-Cast – siehe unten. |

`AdditionalFieldDelegate.key` ist ein einfacher `string`, sodass das Typsystem keine Möglichkeit hat zu wissen, welche zusätzlichen Schlüssel eine Collection deklariert. Anstatt diese Felder wieder für beliebige Strings zu öffnen, macht der Cast die Ausnahme explizit:

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Importieren Sie es in einem Projekt mit Admin-Panel aus `@rebasepro/cms-types` – das ist
die Variante, die auch den `admin`-Block typprüft. Ein Headless-BaaS-Projekt, das keinen
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

Eine Typannotation *validiert jedoch nur die Struktur* – sie kann Ihre Eigenschaftsnamen nicht erfassen, weshalb die Schlüsselfelder in `admin` darauf zurückfallen, jeden beliebigen String zu akzeptieren. Bevorzugen Sie `defineCollection`, es sei denn, Sie müssen den Typ explizit benennen.

:::note
`buildCollection` und `buildProperty` existieren nicht mehr. `buildCollection` entspricht
`defineCollection` ohne Typinferenz; `buildProperty` wickelte eine Eigenschaft in einen Typ ein, den sie
bereits besaß. Siehe das [Changelog](/docs/changelog) für die einzeilige Migration.
:::

## Anatomie: Der Vertrag und das Panel

Eine Datei, zwei Zielgruppen. Alles, was für die *Datenbank und die API* relevant ist, befindet sich auf
oberster Ebene; alles, was das *Admin-Panel* rendert, liegt innerhalb von `admin`.

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

Diese Trennung ist nicht nur kosmetischer Natur. Sie ermöglicht es Rebase, als eigenständiges Backend zu fungieren:

- Ein **BaaS- oder Headless-Projekt** schreibt niemals einen `admin`-Block. Seine Collections – oder gar
  keine Collections, da der BaaS-Modus die Datenbank per Introspektion erfasst – beschreiben
  ausschließlich Daten und Autorisierung. `@rebasepro/types` enthält keinen UI-Code, sodass der Abhängigkeitsbaum
  eines Headless-Projekts rein serverseitig bleibt.
- Das **Backend liest niemals innerhalb des Blocks**. Er wird entfernt, bevor eine Collection an den
  Vertrags-Endpunkt serialisiert oder in ein Build-Bundle gepackt wird, und er wird von der
  Schema-Versionierung ausgeschlossen – eine Änderung eines Icons führt also nicht dazu, dass jedes generierte SDK als
  veraltet gemeldet wird.

### Der `admin`-Block existiert nur, wenn Sie die Admin-Typen installieren

`@rebasepro/types` deklariert kein `admin`-Feld – weder für eine Collection noch für eine Eigenschaft. In
einem BaaS-Projekt ist das Hinzufügen ein **Typfehler**. `@rebasepro/cms-types` fügt es über
Declaration Merging wieder hinzu, sodass eine einzige Zeile pro Projekt ausreicht, um es zu aktivieren:

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Danach verfügen einfache Core-Typen über einen vollständig typisierten Block – ein Tippfehler wie `icoon` ist ein Fehler,
und Sie erhalten Autovervollständigung:

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
Eine Type-Augmentation gilt für das gesamte TypeScript-*Programm*, und `config/` und `frontend/`
sind separate Programme – weshalb die Referenz in das Config-Paket gehört. Es
gibt keinen `AdminCollectionConfig`-Wrapper-Typ: Da das Feld zusammengeführt ist,
dient `CollectionConfig` als Erstellungstyp.

:::note[Warum ein BaaS-Projekt keinen Overhead hat]
Ein Eigenschaftstyp in einer BaaS-Installation besitzt kein `Field`, kein `columnWidth`, kein
`hideFromCollection` – diese befinden sich in `AdminPropertyOptions` im Admin-Paket. Diese
Garantie wird explizit getestet statt nur behauptet: `tests/e2e/baas-typecheck/src/admin_absent.ts` verwendet
`@ts-expect-error` auf `admin`, sodass der Build fehlschlägt, falls das Feld im Core jemals wieder schreibbar werden sollte.
:::

### Migration von einer flachen Collection

Vor Version 0.11 befanden sich diese Felder auf der obersten Ebene. Um sie zu verschieben:

```bash
node tooling/scripts/codemod/collections-admin-block.mjs config/collections
```

Es meldet alles, was nicht sicher verschoben werden kann – insbesondere Darstellungsoptionen innerhalb
von `relations[].overrides`, die manuell zu `overrides: { admin: { … } }` angepasst werden müssen.

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

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `slug` | `string` | **Erforderlich.** URL-sicherer Bezeichner. Wird in der Admin-UI-URL und im REST-API-Pfad (`/api/data/{slug}`) verwendet. |
| `name` | `string` | **Erforderlich.** Anzeigename (Plural). Wird in der Navigation und in Seiten-Headern angezeigt. |
| `singularName` | `string` | Anzeigename für eine einzelne Entität. Wird in „Neues Produkt“, „Produkt bearbeiten“ usw. verwendet. |
| `description` | `string` | Ein Satz darüber, was diese Collection enthält, der über der Liste angezeigt wird. Markdown. |
| `table` | `string` | Name der PostgreSQL-Tabelle. Standardmäßig `toSnakeCase(slug)` – setzen Sie diesen Wert nur, um die URL von der Tabelle zu entkoppeln, z. B. eine bestehende Tabelle `blog_posts`, die unter `/posts` bereitgestellt wird. |
| `admin.icon` | `string` | Ein [Lucide](https://lucide.dev/icons)-Icon-Name, z. B. `"FileText"`, `"ShoppingCart"`. Ein gerendertes Element funktioniert ebenfalls, aber der Name übersteht die Serialisierung, weshalb der Schema-Editor diesen zurückschreibt. |

### Schema

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `properties` | `Properties` | **Erforderlich.** Map von Eigenschaftsschlüssel → Eigenschaftsdefinition. Jeder Schlüssel wird zu einer Datenbankspalte. |
| `relations` | `Relation[]` | SQL-Relationen – Fremdschlüssel, Junction-Tabellen. Siehe [Relationen](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Row-Level-Security-Richtlinien. Siehe [Security Rules](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Postgres-Indizes, die diese Tabelle benötigt. Siehe [Indizes](/docs/backend/indexes). |
| `search` | `SearchConfig` | Gewichtete Volltextsuche über die von Ihnen benannten Felder, einschließlich JSONB- und Array-Inhalten. Nur Postgres. Siehe [Suche](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Kennzeichnet die Collection als Authentifizierungs-Collection (Benutzerverwaltung, Passwort zurücksetzen usw.) |
| `schema` | `string` | Postgres-Schema, in dem sich die Tabelle befindet – `"public"`, `"rebase"`, `"auth"`. Standardmäßig `"public"`. |
| `disableDefaultPolicies` | `boolean` | Entfernt die Standardrichtlinien, die der Generator einfügt – ein SELECT für Admin/Server und bei einer Auth-Collection ein Lesezugriff auf das eigene Profil plus eine Schreibbeschränkung nur für Admins – und übernimmt die volle Verantwortung für das RLS dieser Collection. Standardmäßig `false`. Siehe [Security Rules](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Wandelt `delete` in einen Zeitstempel um und blendet mit einem Zeitstempel versehene Zeilen bei jedem Lesezugriff aus. `true` verwendet `deletedAt`; die Objektform benennt das Feld um. Die Collection muss diese `date`-Eigenschaft selbst deklarieren. Nur Postgres – siehe [Soft Delete](/docs/collections/soft-delete). |
| `strictWrites` | `boolean` | Weist Schreibvorgänge, die ein nicht in dieser Collection deklariertes Feld angeben, mit einem 400-Fehler zurück. Standardmäßig `true`. Setzen Sie dies nur auf `false`, wenn die Spalte tatsächlich existiert und nicht deklariert ist – etwa durch einen Trigger befüllt oder per Introspektion ermittelt statt fest definiert. |

### UI-Konfiguration

Alle folgenden Optionen gehören in `admin`.

| Eigenschaft | Typ | Standard | Beschreibung |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Standard-Ansichtsmodus |
| `enabledViews` | `ViewMode[]` | Die vier integrierten Ansichten plus jede deklarierte benutzerdefinierte Ansicht (Kanban nur, wenn eine `enum`-Eigenschaft existiert) | Welche Ansichtsmodi verfügbar sind |
| `kanban` | `KanbanConfig` | — | Kanban-Konfiguration (Spalteneigenschaft). Immer zusammen mit `orderProperty` verwenden – siehe [Ansichtsmodi](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Schlüssel der **String**-Eigenschaft, die den Drag-and-Drop-Sortierschlüssel enthält. Erforderlich für ein funktionierendes Kanban-Board |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | Abhängig von der Ansicht: `"split"` für Liste, `"full_screen"` für Tabelle und Karten, `"side_panel"` für Kanban und benutzerdefinierte Ansichten | Wie Entitäten zur Bearbeitung geöffnet werden |
| `sideDialogWidth` | `number \| string` | — | Breite des Seitendialogs |
| `inlineEditing` | `boolean` | `true` | Inline-Bearbeitung in der Tabellenansicht aktivieren |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Standarddichte der Listen-, Tabellen- und Kartenansichten (Zeilenhöhe der Tabelle) |
| `pagination` | `boolean \| number` | `true` (50) | Paginierung aktivieren und/oder Seitengröße festlegen. `false` lädt alle Zeilen; in der Entwicklungsumgebung warnt die Konsole einmalig, wenn es mehr als 10.000 Zeilen sind |
| `listProperties` | `string[]` | — | In der Listenansicht anzuzeigende Eigenschaften |
| `propertiesOrder` | `string[]` | — | Spaltenreihenfolge in der Tabellenansicht |
| `selectionEnabled` | `boolean` | `true` | Zeilenauswahl aktivieren |
| `hideFromNavigation` | `boolean` | `false` | In der Sidebar-Navigation ausblenden |
| `defaultSelectedView` | `string \| function` | — | Standardmäßig zu öffnende Ansicht oder Subcollection |

### Entitätsoptionen

Innerhalb von `admin`, mit Ausnahme von `history`, bei dem es sich um ein Backend-Feature handelt, das auf oberster Ebene verbleibt.

| Eigenschaft | Typ | Standard | Beschreibung |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Automatisches Speichern zwei Sekunden nach einer Bearbeitung, sobald das Formular gültig ist. Ein neues Formular wird erst gespeichert, wenn eine Eingabe erfolgt ist. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Ungespeicherte Änderungen sichern |
| `hideIdFromForm` | `boolean` | `false` | Entitäts-ID im Formular ausblenden |
| `hideIdFromCollection` | `boolean` | `false` | ID-Spalte in der Tabelle ausblenden |
| `includeJsonView` | `boolean` | `true` | Rohwerte im Datensatz-Inspektor anbieten |
| `history` | `boolean` | `false` | Änderungen im Entitätsverlauf (History) nachverfolgen |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Wenn ein bestehender Datensatz im Formular geöffnet wird, den deklarierten `defaultValue` jeder Eigenschaft in leere Felder (`null` oder fehlend) eintragen, damit der Wert beim nächsten Speichern geschrieben wird |
| `previewProperties` | `string[]` | — | In Referenzvorschauen anzuzeigende Eigenschaften |
| `display` | `EntityDisplay` | — | Was jede Darstellungsrolle ausfüllt – siehe [Entitätsdarstellung](#entitätsdarstellung) |

### Erweitert

Auf oberster Ebene, da das Backend diese liest:

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Lifecycle-Hooks (`beforeSave`, `afterSave`, `beforeDelete` usw.) |
| `childCollections` | `() => CollectionConfig[]` | Die unter einer Entität dieser Collection verschachtelten Collections. Wird während der Normalisierung anhand der Angaben des Treibers befüllt – z. B. Firestore-`subcollections`, Postgres-`hasMany`-Relation – weshalb ein benutzerdefinierter Treiber der einzige Grund ist, dies manuell festzulegen |
| `dataSource` | `string` | Welche registrierte Datenquelle dieser Collection zugrunde liegt (Standard: die unbenannte) |
| `engine` | `string` | Die zugrundeliegende Engine – `"postgres"`, `"firestore"`, `"mongodb"`. Wird aus `dataSource` abgeleitet; nur zum Überschreiben festlegen |
| `databaseId` | `string` | Datenbank oder Schema innerhalb der Engine |
| `metadata` | `Record<string, unknown>` | Beliebige Daten, die Ihr eigener Code an eine Collection anhängen muss. Rebase liest dies nicht; es übersteht die Serialisierung unverändert |
| `ownerId` | `string` | **Nur im Admin-Formular – wird weder von der API noch von der Datenbank erzwungen.** Die Benutzer-ID, die der Collection-Editor einer neu erstellten Collection zuweist und neben ihrem Namen anzeigt. Nichts im Request-Pfad greift darauf zu |

`subcollections` und `path` existieren nur in Konfigurationen für **Dokumentendatenbanken** –
`FirebaseCollectionConfig` und, für `path`, `MongoDBCollectionConfig`:

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Nur Firestore.** Unter jedem Dokument verschachtelte Collections. Eine Postgres-Collection drückt dasselbe über eine `hasMany`-[Relation](/docs/collections/relations) aus, wodurch `childCollections` befüllt wird |
| `path` | `string` | **Nur Firestore und MongoDB.** Der Pfad oder Collection-Name in der Engine, sofern er vom Slug abweicht |

Und innerhalb von `admin`, da nur das Panel diese darstellt:

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Benutzerdefinierte Aktionen für Entitäten (Archivieren, Veröffentlichen usw.) |
| `admin.Actions` | `ComponentRef<CollectionActionsProps>[]` | Benutzerdefinierte Komponenten für Toolbar-Aktionen |
| `admin.entityViews` | `EntityCustomView[]` | Benutzerdefinierte Tabs in der Entitäts-Detailansicht |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Berechnete/virtuelle Spalten |
| `admin.exportable` | `boolean \| ExportConfig` | Datenexport aktivieren |
| `admin.components` | `CollectionComponentOverrideMap` | UI-Komponentenüberschreibungen auf Collection-Ebene |

Das Definieren einer dieser sechs Optionen auf oberster Ebene führt zu einem Fehler beim Systemstart mit einer Meldung, die den Schlüssel nennt und angibt, wohin er verschoben wurde.

## Entitätsdarstellung

Jede Oberfläche, die einen Datensatz anzeigt, stellt eine Teilmenge von sechs Rollen dar: **title**,
**subtitle**, **image**, **status**, **date** und **tags**. Eine Zeile in der Liste besteht aus Bild +
Titel + Untertitel + Status + Datum; eine Karte ist identisch aufgebaut, zeigt jedoch das Bild oben; eine
Referenzauswahl zeigt Titel + Untertitel und eine Seitenüberschrift nur den Titel.

Jede Rolle wird aus Ihren Eigenschaften abgeleitet und kann alternativ explizit angegeben werden – als
Eigenschaftspfad oder als Funktion:

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

Alles, was Sie weglassen, behält seinen abgeleiteten Wert, sodass die Angabe einer einzelnen Rolle
nicht bedeutet, dass alle sechs angegeben werden müssen.

Ein Resolver erhält `{ row, id, context }`. `row` ist der Datensatz, wie ihn der Server
sendet – in der Struktur, die von `useRows` und `context.data` zurückgegeben wird: Datumsangaben als ISO-Strings,
ein belongsTo als Fremdschlüsselspalte (`authorId`) und `id` nur dort, wo die Tabelle über diese Spalte verfügt. `id`
ist die ID des Datensatzes daneben: sein Primärschlüssel als String bzw. bei zusammengesetzten
Schlüsseln die durch `:::` verbundenen Teile. Eine vom Admin geladene Relation wird unter ihrem
Namen verschachtelt bereitgestellt, genau wie es RESTs `include` zurückgibt – `row.author` ist die Zeile des Autors (nur die
eigenen Spalten, nichts weiter) neben `authorId` –, sodass ein Resolver ein Feld eines
verknüpften Datensatzes ohne eigene Abfrage lesen kann:

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

Ein Resolver kann `async` sein, wodurch eine Rolle Werte lesen kann, die der Datensatz
selbst nicht enthält – etwa ein Dokument in einer Subcollection oder einen Wert hinter einer API:

```typescript
admin: {
    display: {
        // The exercise's name lives one document down, per locale.
        title: async ({ id, context }) => {
            const locale = await context.data.exercise_locales.findById(`${id}/de-DE`);
            return locale?.exercise_title;
        }
    }
}
```

Während das Promise ausgeführt wird, zeigt die Oberfläche den abgeleiteten Wert an und ersetzt ihn durch
den aufgelösten Wert, sobald dieser eintrifft – ein Titel zeigt niemals einen Lade-Spinner. Die Ergebnisse werden
pro Datensatz und pro Rolle zwischengespeichert, und gleichzeitige Anfragen für dasselbe Paar teilen sich einen einzigen Aufruf. So
löst eine Liste von fünfzig Zeilen jede Zeile nur einmal auf, anstatt bei jedem Rendervorgang neu.

Geben Sie `undefined` zurück, wenn ein Datensatz keinen Wert für die Rolle aufweist; der eigene
Fallback der Oberfläche weiß besser, was stattdessen dorthin gehört (eine Überschrift verwendet den
Singular-Namen der Collection, ein Link verwendet die ID). Ein Resolver, der einen Fehler auslöst (throws), wird wie
`undefined` behandelt und einmalig protokolliert – ein Titel, der nicht abgerufen werden kann, darf nicht die
gesamte Zeile zum Absturz bringen.

Bevorzugen Sie einen Pfad, wann immer sich der Wert direkt im Datensatz befindet: Ein Pfad behält das
spezifische Rendering der Eigenschaft bei, sodass ein Enum-Status ein farbiges Badge bleibt und ein Datum
formatiert dargestellt wird – was ein Resolver, der nur einen einfachen String zurückgibt, nicht leisten kann.

:::note[`titleProperty` abgelöst]
`admin.titleProperty` wurde zugunsten von `admin.display.title` entfernt. Derselbe
String funktioniert auch dort, und das neue Feld akzeptiert zusätzlich einen Resolver. Eine Collection, die noch
den alten Schlüssel verwendet, wird von `defineCollection` mit dem üblichen
Fehler für unbekannte Schlüssel abgelehnt.
:::

### Auswahl der Titel-Eigenschaft
Wenn `display.title` nicht festgelegt ist, wird die als Anzeigetitel der Entität (Vorschauen, Header) verwendete Eigenschaft automatisch bestimmt:
1. Wenn `propertiesOrder` explizit definiert ist, wird die erste Eigenschaft in dieser Reihenfolge gewählt, die als Titel fungieren kann: ein `string`, eine `relation` mit einfacher Kardinalität oder eine `reference`. Bezeichner (Primär- und Fremdschlüssel, `uuid`-Spalten, `isId`), Datei-Upload-Felder und ausgeblendete Eigenschaften qualifizieren sich niemals.
2. Wenn kein `propertiesOrder` definiert ist, werden dieselben Kandidaten priorisiert: Zuerst ein String, dessen Schlüssel auf eine Bezeichnung hinweist (`name`, `title`, `label`, …), gefolgt von einfachem kurzem Text, einer E-Mail, einem Enum, langem Text, einer Relation oder Benutzerauswahl und zuletzt einer Referenz. Bei Gleichstand entscheidet die Reihenfolge der Deklaration.

### Relationsvorschauen in Tabellen
Wenn `propertiesOrder` explizit festgelegt ist, werden Relations-Eigenschaften **nicht** automatisch aus den Standard-Vorschauspalten herausgefiltert (während sie aus ungeordneten Standardeinstellungen ausgeschlossen werden, um langsame Join-Operationen zu vermeiden).

### Wie ein Titelwert dargestellt wird
Unabhängig davon, was die Titel-Eigenschaft enthält, rendert das Panel einen String. Ein Datum wird formatiert, ein Array zusammengefügt und eine Relation – die als `{ id, data: { values } }` statt als Text eintrifft – wird in der verknüpften Zeile nach dem ersten Vorkommen von `name`, `title`, `label` oder `displayName` durchsucht, danach nach dem ersten kurzen String-Wert, mit Fallback auf deren ID. Ein Titel kann also eine `relation`-Eigenschaft referenzieren und dennoch als lesbarer Name statt als UUID dargestellt werden.

Dies ist kein exportierter Helper: Es ist das, was jede Oberfläche, die einen Datensatz anzeigt, ohnehin tut. Es muss nichts aufgerufen und nichts importiert werden.

## Collection Builder

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

Der Builder empfängt auch `data`, das Zeilen so liest, wie der Server sie sendet – analog zu
`context.data`: `await data.collection("tenants").find()` löst zu
`{ data: rows, meta }` auf.

## Filtern und Sortieren

Sie können standardmäßige oder erzwungene Filter festlegen. Alle drei betreffen die Darstellung – womit das
Panel öffnet – und liegen daher in `admin`:

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

Der Benutzer kann eine Collection, die einen `fixedFilter` besitzt, dennoch filtern: Alle Filter, die auf
andere Felder angewendet werden, werden damit kombiniert (AND), und die festgelegten Felder bleiben gesperrt.

Ein `fixedFilter` schränkt lediglich ein, was das Panel *anfordert*; er stellt keine Sicherheitsgrenze dar. Was ein
Aufrufer lesen darf, wird über eine [Security Rule](/docs/collections/security-rules) gesteuert,
welche die Datenbank für jeden Aufrufer durchsetzt – unabhängig davon, ob der Zugriff über das Panel erfolgt oder nicht.

## Viele Collections

Nichts in Rebase begrenzt die Anzahl der Collections, doch zwei Faktoren steigen mit der Menge:

- **Der initiale Download des Admin-Panels.** Das Panel benötigt seine Navigation in dem Moment,
  in dem sich jemand anmeldet. Daher wird die Konfiguration jeder Collection in das Paket gebündelt,
  das der Browser für den Login-Bildschirm abruft – jeweils etwa 2,4 KB minifiziert, sodass 200
  Collections ungefähr 480 KB (ca. 80 KB gzipped) hinzufügen. Was zum Öffnen einer
  Collection benötigt wird (die Tabelle, die Datensatzansichten, das Formular), wird erst dann geladen.
- **`rebase db push`.** Atlas plant einen Push durch einen Diff des gesamten Schemas, und dieser
  Aufwand wächst schneller als die Tabellenanzahl: Bei 400 oder mehr Tabellen dauert ein Push mehrere zehn
  Sekunden – siehe [Dauer eines Pushs](/docs/cli/schema#rebase-db-push).

## Nächste Schritte

- **[Entity Callbacks](/docs/collections/callbacks)** – Lifecycle-Hooks zur Datensynchronisierung zwischen Collections, Validierung und Nebeneffekten
- **[Properties](/docs/collections/properties)** – Alle Eigenschaftstypen und -optionen
- **[Relations](/docs/collections/relations)** – Fremdschlüssel, Junction-Tabellen, Joins
- **[Security Rules](/docs/collections/security-rules)** – Row Level Security
- **[View Modes](/docs/frontend/view-modes)** – Liste, Tabelle, Karten, Kanban
