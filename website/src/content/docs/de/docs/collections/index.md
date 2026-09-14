---
sourceHash: 8bade8e09da44b98
title: Collections
sidebar_label: Collections
description: Collections sind der zentrale Baustein von Rebase – jede Collection wird auf eine Datenbanktabelle abgebildet und definiert deren Schema, Relationen, Sicherheit und UI-Verhalten.
---

## Was ist eine Collection?

Eine **Collection** ist ein TypeScript-Objekt, das eine Datenbanktabelle beschreibt und festlegt, wie sie im Rebase CMS dargestellt werden soll. Sie definiert:

- **Schema** — Properties (Spalten), deren Typen und Validierungsregeln
- **Relationen** — Fremdschlüssel, Junction-Tabellen und Join-Pfade
- **Sicherheit** — Row-Level-Security-Richtlinien (RLS)
- **Lifecycle-Hooks** — Callbacks für Erstell-, Aktualisierungs- und Löschoperationen (Create, Update, Delete)
- **CMS-Verhalten** — Ansichtsmodi, Inline-Bearbeitung, Entity-Ansichten, Aktionen – alles unter `admin`

## Deklarieren einer Collection: `defineCollection`

Hüllen Sie das Literal in `defineCollection` ein. Zur Laufzeit ist dies die Identitätsfunktion – sie
gibt das Objekt unverändert zurück – sie kostet also nichts. Was man gewinnt, ist Typinferenz: Ein `const`-Typparameter
erfasst Ihre `properties`-Schlüssel als Literal-Typen, und die schlüsselförmigen
Felder des `admin`-Blocks werden anschließend dagegen geprüft. Ein Name, der keine
Ihrer Properties ist, führt zu einem **Kompilierfehler** und nicht nur zu einem fehlenden Vorschlag.

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

Die geprüften Felder sind `display`, `sort`, `propertiesOrder` und `listProperties`.
Neben einem einfachen Property-Schlüssel werden drei Formen akzeptiert:

| Form | Beispiel | Hinweise |
| --- | --- | --- |
| Pfad mit Punktnotation in eine `map` | `"profile.displayName"` | Die **Root** muss eine echte Property sein; der darunter liegende Pfad wird nicht geprüft. |
| Spalte einer Child-Collection | `"subcollection:orders"` | Nur `propertiesOrder` / `listProperties`. |
| Ein `additionalFields`-Schlüssel | `"score" as AdditionalFieldKey` | Erfordert den Cast – siehe unten. |

`AdditionalFieldDelegate.key` ist ein einfacher `string`, daher kann das Typsystem nicht wissen,
welche zusätzlichen Schlüssel eine Collection deklariert. Anstatt diese Felder für jeden beliebigen String zu öffnen,
macht der Cast die Ausnahme explizit:

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Importieren Sie es in einem Projekt mit Admin-Panel aus `@rebasepro/cms-types` – dies ist
die Version, die auch den `admin`-Block typprüft. Ein Headless-BaaS-Projekt, das keinen
Admin-Block hat, importiert dieselbe Funktion stattdessen aus `@rebasepro/common`.

Die direkte Typannotation funktioniert weiterhin und wird auch weiterhin geprüft:

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

aber eine Typannotation *validiert nur die Form* – sie kann Ihre Property-Namen nicht sehen, sodass die
Schlüsselfelder in `admin` darauf zurückfallen, jeden beliebigen String zu akzeptieren. Bevorzugen Sie `defineCollection`, es sei denn,
Sie müssen den Typ explizit benennen.

:::note
`buildCollection` und `buildProperty` existieren nicht mehr. `buildCollection` ist
`defineCollection` ohne die Typinferenz; `buildProperty` hüllte eine Property in einen Typ ein, den sie
bereits hatte. Siehe [Changelog](/docs/changelog) für die einzeilige Migration.
:::

## Anatomie: Der Vertrag und das Panel

Eine Datei, zwei Zielgruppen. Alles, was für die *Datenbank und die API* relevant ist, befindet sich auf der
obersten Ebene; alles, was das *Admin-Panel* rendert, liegt innerhalb von `admin`.

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

Die Aufteilung ist nicht nur kosmetischer Natur. Sie ermöglicht es Rebase, eigenständig als Backend zu fungieren:

- Ein **BaaS- oder Headless**-Projekt schreibt niemals einen `admin`-Block. Seine Collections – oder überhaupt keine
  Collections, da der BaaS-Modus die Datenbank per Introspektion erfasst – beschreiben Daten und
  Autorisierung, sonst nichts. `@rebasepro/types` enthält keinen UI-Code, sodass der Abhängigkeitsbaum eines
  Headless-Projekts rein serverseitig bleibt.
- Das **Backend liest niemals innerhalb des Blocks**. Er wird verworfen, bevor eine Collection an
  den Contract-Endpunkt oder in ein Build-Bundle serialisiert wird, und er ist von der
  Schema-Versionierung ausgeschlossen – das Ändern eines Icons führt also nicht dazu, dass jedes generierte SDK als
  veraltet gemeldet wird.

### Der `admin`-Block existiert nur, wenn Sie die Admin-Typen installieren

`@rebasepro/types` deklariert kein `admin`-Feld – weder für eine Collection noch für eine Property. In
einem BaaS-Projekt ist das Schreiben eines solchen Feldes ein **Typfehler**. `@rebasepro/cms-types` fügt es mittels
Declaration Merging wieder hinzu, sodass eine einzige Zeile pro Projekt ausreicht, um es zu aktivieren:

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Danach enthalten einfache Core-Typen einen vollständig typisierten Block – ein Tippfehler wie `icoon` führt zu einem Fehler,
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
Eine Typ-Augmentation gilt für das gesamte TypeScript-*Programm*, und `config/` sowie `frontend/`
sind separate Programme – weshalb die Referenz in das Config-Paket gehört. Es gibt
keinen `AdminCollectionConfig`-Wrapper-Typ: Mit dem zusammengeführten Feld ist `CollectionConfig`
der Authoring-Typ.

:::note[Warum ein BaaS-Projekt keinen Overhead hat]
Ein Property-Typ in einer BaaS-Installation besitzt kein `Field`, kein `columnWidth`, kein
`hideFromCollection` – diese befinden sich in `AdminPropertyOptions` im Admin-Paket. Die
Garantie wird nicht nur behauptet, sondern überprüft: `e2e/baas-typecheck/src/admin_absent.ts` verwendet
`@ts-expect-error` auf `admin`, sodass der Build fehlschlägt, falls das Feld im
Core jemals wieder beschreibbar werden sollte.
:::

### Migration von einer flachen Collection

Vor Version 0.11 befanden sich diese Felder auf der obersten Ebene. Um sie zu verschieben:

```bash
node scripts/codemod/collections-admin-block.mjs config/collections
```

Es meldet alles, was nicht sicher verschoben werden kann – insbesondere Darstellungsoptionen innerhalb von
`relations[].overrides`, die manuell auf `overrides: { admin: { … } }` angepasst werden müssen.

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
        icon: "inventory_2"           // Material icon key
    }
});

```

## Wichtigste Properties

### Identifikation

| Property | Typ | Beschreibung |
|----------|------|-------------|
| `slug` | `string` | **Erforderlich.** URL-sicherer Bezeichner. Wird in der Admin-UI-URL und im REST-API-Pfad (`/api/data/{slug}`) verwendet. |
| `name` | `string` | **Erforderlich.** Anzeigename (Plural). Wird in der Navigation und in Seitenüberschriften angezeigt. |
| `singularName` | `string` | Anzeigename für eine einzelne Entity. Wird in „Neues Produkt“, „Produkt bearbeiten“ usw. verwendet. |
| `description` | `string` | Ein Satz darüber, was diese Collection enthält; wird über der Liste angezeigt. Markdown. |
| `table` | `string` | Name der PostgreSQL-Tabelle. Standardmäßig `toSnakeCase(slug)` – nur angeben, um die URL von der Tabelle zu entkoppeln, z. B. eine bestehende Tabelle `blog_posts`, die unter `/posts` bereitgestellt wird. |
| `admin.icon` | `string` | Ein [Lucide](https://lucide.dev/icons)-Icon-Name, z. B. `"FileText"`, `"ShoppingCart"`. Ein gerendertes Element funktioniert ebenfalls, aber der Name übersteht die Serialisierung, weshalb der Schema-Editor diesen zurückschreibt. |

### Schema

| Property | Typ | Beschreibung |
|----------|------|-------------|
| `properties` | `Properties` | **Erforderlich.** Map aus Property-Schlüssel → Property-Definition. Jeder Schlüssel wird zu einer Datenbankspalte. |
| `relations` | `Relation[]` | SQL-Relationen – Fremdschlüssel, Junction-Tabellen. Siehe [Relationen](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Row-Level-Security-Richtlinien. Siehe [Sicherheitsregeln](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Postgres-Indizes, die diese Tabelle benötigt. Siehe [Indizes](/docs/backend/indexes). |
| `search` | `SearchConfig` | Gerankte Volltextsuche über die von Ihnen benannten Felder, einschließlich JSONB- und Array-Inhalten. Nur Postgres. Siehe [Suche](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Collection als Authentifizierungs-Collection markieren (Benutzerverwaltung, Passwort-Reset etc.) |
| `schema` | `string` | Postgres-Schema, in dem die Tabelle liegt – `"public"`, `"rebase"`, `"auth"`. Standardmäßig `"public"`. |
| `disableDefaultPolicies` | `boolean` | Entfernt die vom Generator injizierten Standard-Richtlinien – ein Admin-/Server-SELECT und bei einer Auth-Collection ein Self-Read plus ein Admin-only Write-Gate – und übernimmt die volle Verantwortung für das RLS dieser Collection. Standardmäßig `false`. Siehe [Sicherheitsregeln](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Wandelt `delete` in einen Zeitstempel um und blendet mit einem Zeitstempel versehene Zeilen bei jedem Lesevorgang aus. `true` verwendet `deletedAt`; die Objektform benennt das Feld um. Die Collection muss diese `date`-Property selbst deklarieren. Nur Postgres – siehe [Soft Delete](/docs/collections/soft-delete). |
| `strictWrites` | `boolean` | Weist Schreibvorgänge, die ein nicht von dieser Collection deklariertes Feld angeben, mit einem 400-Fehler ab. Standardmäßig `true`. Setzen Sie dies nur dann auf `false`, wenn die Spalte tatsächlich existiert und nicht deklariert ist – etwa durch einen Trigger befüllt oder per Introspektion ermittelt, anstatt explizit definiert. |

### UI-Konfiguration

Alle folgenden Optionen gehören in `admin`.

| Property | Typ | Standard | Beschreibung |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Standard-Ansichtsmodus |
| `enabledViews` | `ViewMode[]` | Alle vier | Welche Ansichtsmodi verfügbar sind |
| `kanban` | `KanbanConfig` | — | Kanban-Konfiguration (Spalten-Property). Immer zusammen mit `orderProperty` verwenden – siehe [Ansichtsmodi](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Schlüssel der **String**-Property, die den Drag-and-Drop-Reihenfolgeschlüssel enthält. Erforderlich für ein funktionierendes Kanban-Board |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | `"full_screen"` | Wie Entities zur Bearbeitung geöffnet werden |
| `sideDialogWidth` | `number \| string` | — | Breite des seitlichen Dialogs |
| `inlineEditing` | `boolean` | `true` | Inline-Bearbeitung in der Tabellenansicht aktivieren |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Standard-Zeilenhöhe in der Tabelle |
| `pagination` | `boolean \| number` | `true` (50) | Paginierung aktivieren und/oder Seitengröße festlegen |
| `listProperties` | `string[]` | — | Properties, die in der Listenansicht angezeigt werden sollen |
| `propertiesOrder` | `string[]` | — | Spaltenreihenfolge in der Tabellenansicht |
| `selectionEnabled` | `boolean` | `true` | Zeilenauswahl aktivieren |
| `hideFromNavigation` | `boolean` | `false` | In der Sidebar-Navigation ausblenden |
| `defaultSelectedView` | `string \| function` | — | Standardmäßig zu öffnende Ansicht oder Subcollection |

### Entity-Optionen

Innerhalb von `admin`, außer `history`, welches ein Backend-Feature ist und auf der obersten Ebene verbleibt.

| Property | Typ | Standard | Beschreibung |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Automatisches Speichern bei Feldänderungen |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Nicht gespeicherte Änderungen sichern |
| `hideIdFromForm` | `boolean` | `false` | Entity-ID im Formular ausblenden |
| `hideIdFromCollection` | `boolean` | `false` | ID-Spalte in der Tabelle ausblenden |
| `includeJsonView` | `boolean` | `true` | Die Rohwerte im Record-Inspector anbieten |
| `history` | `boolean` | `false` | Änderungen in der Entity-Historie nachverfolgen |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Standardwerte bei jedem Speichervorgang anwenden |
| `previewProperties` | `string[]` | — | Properties, die in Referenz-Vorschauen angezeigt werden sollen |
| `display` | `EntityDisplay` | — | Was jede Anzeige-Rolle ausfüllt – siehe [Entity-Darstellung](#entity-darstellung) |

### Erweitert

Auf der obersten Ebene, da das Backend sie liest:

| Property | Typ | Beschreibung |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Lifecycle-Hooks (`beforeSave`, `afterSave`, `beforeDelete` etc.) |
| `childCollections` | `() => CollectionConfig[]` | Die unter einer Entity dieser Collection geschachtelten Collections. Wird während der Normalisierung aus dem befüllt, womit der Treiber sie ausdrückt – ein Firestore-`subcollections`, eine Postgres-`hasMany`-Relation – daher ist ein benutzerdefinierter Treiber der einzige Grund, dies manuell festzulegen |
| `dataSource` | `string` | Welche registrierte Datenquelle diese Collection stützt (Standard: die unbenannte Datenquelle) |
| `engine` | `string` | Die dahinterliegende Engine – `"postgres"`, `"firestore"`, `"mongodb"`. Wird aus `dataSource` aufgelöst; nur angeben, um es zu überschreiben |
| `databaseId` | `string` | Datenbank oder Schema innerhalb der Engine |
| `metadata` | `Record<string, unknown>` | Alles, was Ihr eigener Code an einer Collection anheften muss. Rebase liest dies nicht; es übersteht die Serialisierung unverändert |
| `ownerId` | `string` | **Nur Admin-Formular – wird weder von der API noch von der Datenbank erzwungen.** Die Benutzer-ID, die der Collection-Editor einer von ihm erstellten Collection zuweist und neben ihrem Namen anzeigt. Nichts im Request-Pfad greift darauf zu |

`subcollections` und `path` gibt es nur bei Konfigurationen für **Dokumentendatenbanken** –
`FirebaseCollectionConfig` und, für `path`, `MongoDBCollectionConfig`:

| Property | Typ | Beschreibung |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Nur Firestore.** Unter jedem Dokument geschachtelte Collections. Eine Postgres-Collection drückt dasselbe mit einer `hasMany`-[Relation](/docs/collections/relations) aus, wodurch `childCollections` befüllt wird |
| `path` | `string` | **Nur Firestore und MongoDB.** Der Pfad oder Collection-Name in der Engine, wenn er sich vom Slug unterscheidet |

Und innerhalb von `admin`, da nur das Panel sie darstellt:

| Property | Typ | Beschreibung |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Benutzerdefinierte Aktionen auf Entities (Archivieren, Veröffentlichen etc.) |
| `admin.Actions` | `React.ComponentType` | Benutzerdefinierte Komponente für Toolbar-Aktionen |
| `admin.entityViews` | `EntityCustomView[]` | Benutzerdefinierte Tabs in der Entity-Detailansicht |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Berechnete/virtuelle Spalten |
| `admin.exportable` | `boolean \| ExportConfig` | Datenexport aktivieren |
| `admin.components` | `CollectionComponentOverrideMap` | Collection-spezifische UI-Komponenten-Overrides |

Das Definieren eines dieser sechs Felder auf der obersten Ebene führt zu einem Fehler beim Start (Boot-Time Error)
mit einer Meldung, die den Schlüssel nennt und angibt, wohin er verschoben wurde.

## Entity-Darstellung

Jede Oberfläche, die einen Datensatz darstellt, zeichnet eine Untermenge von sechs Rollen: **title**,
**subtitle**, **image**, **status**, **date** und **tags**. Eine Listenzeile besteht aus image +
title + subtitle + status + date, eine Karte ist dasselbe mit dem Bild oben, ein
Referenz-Picker besteht aus title + subtitle und eine Seitenüberschrift zeigt nur den Titel.

Jede Rolle wird aus Ihren Properties abgeleitet und jede kann stattdessen explizit angegeben werden – als
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
            subtitle: ({ entity }) => `in ${entity.values.city}`   // computed
        }
    }
});
```

Alles, was Sie weglassen, behält seinen abgeleiteten Wert. Das Festlegen einer Rolle bedeutet
also nicht, dass alle sechs definiert werden müssen.

### Berechnete und asynchrone Rollen

Ein Resolver kann `async` sein, wodurch eine Rolle Daten lesen kann, die der Datensatz
selbst nicht enthält – etwa ein Dokument in einer Subcollection oder einen Wert hinter einer API:

```typescript
admin: {
    display: {
        // The exercise's name lives one document down, per locale.
        title: async ({ entity, context }) => {
            const locale = await context.data.exercise_locales.get(`${entity.id}/de-DE`);
            return locale?.exercise_title;
        }
    }
}
```

Während das Promise ausgeführt wird, zeigt die Oberfläche den abgeleiteten Wert an und ersetzt ihn durch den
aufgelösten Wert, sobald dieser eintrifft – ein Titel ist niemals ein Lade-Spinner. Die Ergebnisse werden
pro Datensatz und pro Rolle zwischengespeichert, und gleichzeitige Abfragen für dasselbe Paar teilen sich einen einzigen Aufruf. So
löst eine Liste von fünfzig Zeilen jede Zeile einmal auf, anstatt einmal pro Render-Vorgang.

Geben Sie `undefined` zurück, wenn ein Datensatz keinen Wert für die Rolle hat; der eigene
Fallback der Oberfläche weiß besser, was stattdessen dorthin gehört (eine Überschrift verwendet den
Singular-Namen der Collection, ein Link verwendet die ID). Ein Resolver, der einen Fehler wirft, wird
wie `undefined` behandelt und einmal protokolliert – ein Titel, der nicht abgerufen werden kann, darf nicht
die gesamte Zeile zum Absturz bringen, die ihn anzeigt.

Bevorzugen Sie einen Pfad, wann immer der Wert im Datensatz vorhanden ist: Ein Pfad behält das
eigene Rendering der Property bei, sodass ein Enum-Status ein farbiger Chip bleibt und ein Datum formatiert
wird – was ein Resolver, der einen reinen String zurückgibt, nicht ausdrücken kann.

:::note[`titleProperty` ersetzt]
`admin.titleProperty` wurde zugunsten von `admin.display.title` entfernt. Derselbe
String funktioniert dort, und das neue Feld akzeptiert auch einen Resolver. Eine Collection, die noch
den alten Schlüssel verwendet, wird von `defineCollection` mit dem üblichen
Fehler für unbekannte Schlüssel abgelehnt.
:::

### Auswahl der Titel-Property
Wenn `display.title` nicht festgelegt ist, wird die Property, die als Anzeige-Titel der Entity verwendet wird (Vorschauen, Überschriften), automatisch aufgelöst:
1. Wenn `propertiesOrder` explizit definiert ist, wird die erste Property (außer der ID), die entweder vom Typ `relation` oder `string` ist, als Titel ausgewählt.
2. Wenn keine `propertiesOrder` definiert ist, durchsucht das Framework die Properties der Reihe nach und wählt die erste Property vom Typ `string` aus.

### Relation-Vorschauen in Tabellen
Wenn `propertiesOrder` explizit gesetzt ist, werden Relation-Properties **nicht** automatisch aus den Standard-Vorschau-Spalten herausgefiltert (während sie bei ungeordneten Standardeinstellungen ausgeschlossen werden, um langsame Join-Operationen zu vermeiden).

### Wie ein Titelwert gerendert wird
Ganz gleich, was die Titel-Property enthält, das Panel rendert einen String. Ein Datum wird formatiert, ein Array zusammengefügt und eine Relation – die als `{ id, data: { values } }` anstelle von reinem Text ankommt – wird in der zugehörigen Zeile nach der ersten Übereinstimmung von `name`, `title`, `label` oder `displayName` durchsucht, mit Fallback auf deren ID. So kann ein Titel eine `relation`-Property referenzieren und dennoch als Name statt als UUID lesbar sein.

Dies ist kein exportierter Helper: Es ist genau das, was jede Oberfläche, die einen Datensatz anzeigt, bereits automatisch tut. Es muss nichts aufgerufen und nichts importiert werden.

## Collection Builder

Für dynamische Collections, die sich basierend auf dem Benutzer oder externen Daten ändern, verwenden Sie eine Builder-Funktion:

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

## Filtern und Sortieren

Sie können Standard- oder erzwungene Filter festlegen. Alle drei dienen der Darstellung – womit
das Panel geöffnet wird – und liegen daher in `admin`:

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

        // Fixed filter — cannot be changed
        fixedFilter: { tenantId: ["==", currentTenantId] },

        // Default sort
        sort: ["createdAt", "desc"]
    }
});
```

Ein `fixedFilter` schränkt lediglich ein, was das Panel *anfordert*; er ist keine Sicherheitsgrenze. Was
ein Aufrufer tatsächlich lesen darf, bestimmt eine [Sicherheitsregel](/docs/collections/security-rules),
die von der Datenbank für jeden Aufrufer durchgesetzt wird, unabhängig davon, ob es sich um das Panel handelt oder nicht.

## Nächste Schritte

- **[Entity-Callbacks](/docs/collections/callbacks)** — Lifecycle-Hooks zur Datensynchronisation zwischen Collections, Validierung und Seiteneffekten
- **[Properties](/docs/collections/properties)** — Alle Property-Typen und -Optionen
- **[Relationen](/docs/collections/relations)** — Fremdschlüssel, Junction-Tabellen, Joins
- **[Sicherheitsregeln](/docs/collections/security-rules)** — Row Level Security
- **[Ansichtsmodi](/docs/frontend/view-modes)** — Liste, Tabelle, Karten, Kanban
