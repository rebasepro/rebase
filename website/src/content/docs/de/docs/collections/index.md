---
sourceHash: 7bd4e27e22c6c53b
title: Collections
sidebar_label: Collections
description: Collections sind der zentrale Baustein von Rebase – jede Collection wird auf eine Datenbanktabelle abgebildet und definiert deren Schema, Relationen, Sicherheit und UI-Verhalten.
---

## Was ist eine Collection?

Eine **Collection** ist ein TypeScript-Objekt, das eine Datenbanktabelle und deren Darstellung in der Admin-UI beschreibt. Sie definiert:

- **Schema** — Eigenschaften (Spalten), ihre Typen und Validierungsregeln
- **Relationen** — Fremdschlüssel, Junction-Tabellen und Join-Pfade
- **Sicherheit** — Row Level Security-Richtlinien (RLS-Policies)
- **Lifecycle-Hooks** — Callbacks für Erstell-, Aktualisierungs- und Löschoperationen
- **Admin-UI-Verhalten** — Ansichtsmodi, Inline-Bearbeitung, Entitätsansichten, Aktionen – alles unter `admin`

## Deklaration: `defineCollection`

Ummanteln Sie das Literal mit `defineCollection`. Zur Laufzeit ist es die Identitätsfunktion – sie gibt das Objekt unverändert zurück – und verursacht somit keinen Overhead. Der Vorteil liegt in der Typinferenz: Ein `const`-Typparameter erfasst Ihre `properties`-Schlüssel als Literal-Typen, und die schlüsselförmigen Felder des `admin`-Blocks werden anschließend gegen diese geprüft. Ein Name, der nicht zu Ihren Properties gehört, führt zu einem **Kompilierfehler** (Compile Error) und nicht nur zu einem fehlenden Vorschlag bei der Autovervollständigung.

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

Die überprüften Felder sind `display`, `sort`, `propertiesOrder` und `listProperties`.
Neben einem einfachen Property-Schlüssel werden drei Formen akzeptiert:

| Form | Beispiel | Hinweise |
| --- | --- | --- |
| Punktierter Pfad in eine `map` | `"profile.displayName"` | Die **Wurzel (Root)** muss eine echte Property sein; der Pfad darunter wird nicht überprüft. |
| Spalte einer untergeordneten Collection | `"subcollection:orders"` | Nur für `propertiesOrder` / `listProperties`. |
| Ein `additionalFields`-Schlüssel | `"score" as AdditionalFieldKey` | Erfordert den Typecast – siehe unten. |

`AdditionalFieldDelegate.key` ist ein einfacher `string`, sodass das Typsystem keine Möglichkeit hat zu wissen, welche zusätzlichen Schlüssel eine Collection deklariert. Anstatt diese Felder wieder für jeden beliebigen String zu öffnen, macht der Typecast die Ausnahme explizit:

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Importieren Sie dies aus `@rebasepro/cms-types` in einem Projekt, das über ein Admin-Panel verfügt – dies ist die Version, die auch den `admin`-Block typprüft. Ein Headless-BaaS-Projekt, das keinen Admin-Block hat, importiert dieselbe Funktion stattdessen aus `@rebasepro/common`.

Das direkte Annotieren des Typs funktioniert weiterhin und wird ebenfalls überprüft:

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

aber eine Annotation *validiert lediglich die Struktur* – sie kann Ihre Property-Namen nicht einsehen, sodass die Schlüsselfelder in `admin` darauf zurückfallen, jeden beliebigen String zu akzeptieren. Bevorzugen Sie `defineCollection`, es sei denn, Sie müssen den Typ explizit benennen.

:::note
`buildCollection` und `buildProperty` existieren nicht mehr. `buildCollection` ist `defineCollection` ohne Typinferenz; `buildProperty` hat eine Property lediglich in einen Typ gewickelt, den sie ohnehin schon hatte. Siehe [Changelog](/docs/changelog) für die Einzeilen-Migration.
:::

## Anatomie: Der Vertrag und das Panel

Eine Datei, zwei Zielgruppen. Alles, was für die *Datenbank und die API* relevant ist, befindet sich auf oberster Ebene; alles, was das *Admin-Panel* rendert, liegt innerhalb von `admin`.

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

Die Trennung ist nicht nur kosmetischer Natur. Sie ermöglicht es Rebase, als eigenständiges Backend zu fungieren:

- Ein **BaaS- oder Headless**-Projekt definiert niemals einen `admin`-Block. Seine Collections – oder gar keine Collections, da der BaaS-Modus die Datenbank introspektiert – beschreiben Daten und Autorisierung, sonst nichts. `@rebasepro/types` enthält keinerlei UI-Code, sodass der Abhängigkeitsbaum eines Headless-Projekts rein serverseitig bleibt.
- Das **Backend liest niemals innerhalb des Blocks**. Er wird verworfen, bevor eine Collection an den Contract-Endpunkt oder in ein Build-Bundle serialisiert wird, und ist von der Schema-Versionierung ausgeschlossen – die Änderung eines Icons führt also nicht dazu, dass jedes generierte SDK als veraltet gemeldet wird.

### Der `admin`-Block existiert nur, wenn Sie die Admin-Typen installieren

`@rebasepro/types` deklariert kein `admin`-Feld – weder auf einer Collection noch auf einer Property. In einem BaaS-Projekt ist das Hinzufügen ein **Typfehler**. `@rebasepro/cms-types` fügt es mittels Declaration Merging wieder hinzu, sodass eine einzige Zeile pro Projekt ausreicht, um es zu aktivieren:

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Danach verfügen die reinen Core-Typen über einen vollständig typisierten Block – ein Tippfehler wie `icoon` führt zu einem Fehler, und Sie erhalten Autovervollständigung:

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
Eine Augmentation gilt für das gesamte TypeScript-*Programm*, und `config/` sowie `frontend/` sind separate Programme – weshalb die Referenz in das Config-Paket gehört. Es gibt keinen `AdminCollectionConfig`-Wrapper-Typ: Sobald das Feld hineingemergt ist, dient `CollectionConfig` als primärer Typ bei der Erstellung.

:::note[Warum ein BaaS-Projekt keinen Overhead hat]
Ein Property-Typ in einer BaaS-Installation enthält kein `Field`, kein `columnWidth`, kein `hideFromCollection` – diese befinden sich in `AdminPropertyOptions` im Admin-Paket. Diese Garantie wird aktiv überprüft und nicht nur behauptet: `e2e/baas-typecheck/src/admin_absent.ts` verwendet `@ts-expect-error` auf `admin`, sodass der Build fehlschlägt, falls das Feld im Core jemals wieder beschreibbar werden sollte.
:::

### Migration von einer flachen Collection

Vor Version 0.11 befanden sich diese Felder auf oberster Ebene. Um sie zu verschieben:

```bash
node scripts/codemod/collections-admin-block.mjs config/collections
```

Es meldet alles, was nicht sicher automatisch verschoben werden kann – insbesondere Darstellungsoptionen innerhalb von `relations[].overrides`, welche manuell zu `overrides: { admin: { … } }` angepasst werden müssen.

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

## Wichtige Eigenschaften

### Identifikation

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `slug` | `string` | **Erforderlich.** URL-sicherer Bezeichner. Wird in der Admin-UI-URL und im REST-API-Pfad (`/api/data/{slug}`) verwendet. |
| `name` | `string` | **Erforderlich.** Anzeigename (Plural). Wird in der Navigation und in Seitenüberschriften angezeigt. |
| `singularName` | `string` | Anzeigename für eine einzelne Entität. Wird in „Neues Produkt“, „Produkt bearbeiten“ usw. verwendet. |
| `description` | `string` | Ein Satz darüber, was diese Collection enthält, der über der Liste angezeigt wird. Markdown. |
| `table` | `string` | PostgreSQL-Tabellenname. Standardmäßig `toSnakeCase(slug)` – setzen Sie ihn nur, um die URL von der Tabelle zu entkoppeln, z. B. eine bestehende `blog_posts`-Tabelle, die unter `/posts` bereitgestellt wird. |
| `admin.icon` | `string` | Ein [Lucide](https://lucide.dev/icons)-Icon-Name, z. B. `"FileText"`, `"ShoppingCart"`. Ein gerendertes Element funktioniert ebenfalls, aber der Name übersteht die Serialisierung, weshalb der Schema-Editor diesen zurückschreibt. |

### Schema

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `properties` | `Properties` | **Erforderlich.** Map aus Property-Schlüssel → Property-Definition. Jeder Schlüssel wird zu einer Datenbankspalte. |
| `relations` | `Relation[]` | SQL-Relationen – Fremdschlüssel, Junction-Tabellen. Siehe [Relationen](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Row Level Security-Richtlinien. Siehe [Sicherheitsregeln](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Postgres-Indizes, die diese Tabelle benötigt. Siehe [Indizes](/docs/backend/indexes). |
| `search` | `SearchConfig` | Gewichtete Volltextsuche über die von Ihnen angegebenen Felder, einschließlich JSONB- und Array-Inhalten. Nur Postgres. Siehe [Suche](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Collection als Authentifizierungs-Collection markieren (Benutzerverwaltung, Passwort-Reset etc.) |
| `schema` | `string` | Postgres-Schema, in dem sich die Tabelle befindet – `"public"`, `"rebase"`, `"auth"`. Standard ist `"public"`. |
| `disableDefaultPolicies` | `boolean` | Entfernt die Basis-Policies, die der Generator einfügt – ein Admin/Server-SELECT und bei einer Auth-Collection ein Self-Read plus ein Admin-Only-Schreibgate – und übernimmt die volle Verantwortung für das RLS dieser Collection. Standardmäßig `false`. Siehe [Sicherheitsregeln](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Wandelt `delete` in einen Zeitstempel um und blendet markierte Zeilen bei jedem Lesezugriff aus. `true` verwendet `deletedAt`; die Objektform benennt das Feld um. Die Collection muss diese `date`-Property selbst deklarieren. Nur Postgres – siehe [Soft delete](/docs/collections/soft-delete). |
| `strictWrites` | `boolean` | Weist einen Schreibvorgang mit einem 400-Fehler ab, der ein Feld benennt, das diese Collection nicht deklariert. Standardmäßig `true`. Setzen Sie dies nur dann auf `false`, wenn die Spalte tatsächlich existiert und nicht deklariert ist – z. B. durch einen Trigger befüllt oder introspektiert statt manuell definiert. |

### UI-Konfiguration

Alle folgenden Optionen gehören in `admin`.

| Eigenschaft | Typ | Standard | Beschreibung |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Standard-Ansichtsmodus |
| `enabledViews` | `ViewMode[]` | Alle vier | Welche Ansichtsmodi verfügbar sind |
| `kanban` | `KanbanConfig` | — | Kanban-Konfiguration (Spalten-Property). Immer zusammen mit `orderProperty` verwenden – siehe [Ansichtsmodi](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Schlüssel der **String**-Property, die den Drag-and-Drop-Reihenfolgeschlüssel enthält. Erforderlich für ein funktionierendes Kanban-Board |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | `"full_screen"` | Wie Entitäten zur Bearbeitung geöffnet werden |
| `sideDialogWidth` | `number \| string` | — | Breite des Seitendialogs |
| `inlineEditing` | `boolean` | `true` | Inline-Bearbeitung in der Tabellenansicht aktivieren |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Standard-Zeilenhöhe in der Tabelle |
| `pagination` | `boolean \| number` | `true` (50) | Paginierung aktivieren und/oder Seitengröße festlegen |
| `listProperties` | `string[]` | — | Eigenschaften, die in der Listenansicht angezeigt werden sollen |
| `propertiesOrder` | `string[]` | — | Spaltenreihenfolge in der Tabellenansicht |
| `selectionEnabled` | `boolean` | `true` | Zeilenauswahl aktivieren |
| `hideFromNavigation` | `boolean` | `false` | In der Sidebar-Navigation ausblenden |
| `defaultSelectedView` | `string \| function` | — | Standardmäßig zu öffnende Ansicht oder Subcollection |

### Entitätsoptionen

Innerhalb von `admin`, mit Ausnahme von `history`, welches ein Backend-Feature ist und auf oberster Ebene verbleibt.

| Eigenschaft | Typ | Standard | Beschreibung |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Automatisches Speichern bei Feldänderung |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Nicht gespeicherte Änderungen sichern |
| `hideIdFromForm` | `boolean` | `false` | Entitäts-ID im Formular ausblenden |
| `hideIdFromCollection` | `boolean` | `false` | ID-Spalte in der Tabelle ausblenden |
| `includeJsonView` | `boolean` | `true` | Rohwerte im Datensatz-Inspektor anzeigen |
| `history` | `boolean` | `false` | Änderungen im Entitätsverlauf nachverfolgen |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Standardwerte bei jedem Speichern anwenden |
| `previewProperties` | `string[]` | — | Eigenschaften, die in Referenzvorschauen angezeigt werden sollen |
| `display` | `EntityDisplay` | — | Was die einzelnen Anzeigerollen befüllt – siehe [Entitätsanzeige](#entity-display) |

### Erweitert

Auf oberster Ebene, da das Backend diese liest:

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Lifecycle-Hooks (`beforeSave`, `afterSave`, `beforeDelete` usw.) |
| `childCollections` | `() => CollectionConfig[]` | Die Collections, die unter einer Entität dieser Collection verschachtelt sind. Wird während der Normalisierung anhand der jeweiligen Treiber-Ausdrücke befüllt – ein Firestore-`subcollections`, eine Postgres-`hasMany`-Relation – daher ist ein benutzerdefinierter Treiber der einzige Grund, dies manuell festzulegen |
| `dataSource` | `string` | Welche registrierte Datenquelle dieser Collection zugrunde liegt (Standard: die unbenannte Datenquelle) |
| `engine` | `string` | Die zugrunde liegende Engine – `"postgres"`, `"firestore"`, `"mongodb"`. Wird aus `dataSource` aufgelöst; nur zum Überschreiben angeben |
| `databaseId` | `string` | Datenbank oder Schema innerhalb der Engine |
| `metadata` | `Record<string, unknown>` | Beliebige Daten, die Ihr eigener Code an eine Collection anhängen muss. Rebase liest dies nicht; es übersteht die Serialisierung unverändert |
| `ownerId` | `string` | **Nur Admin-Formular – wird weder von der API noch von der Datenbank erzwungen.** Die Benutzer-ID, die der Collection-Editor einer erstellten Collection zuweist und neben ihrem Namen anzeigt. Nichts im Request-Pfad greift darauf zu |

`subcollections` und `path` existieren nur in den Konfigurationen für **Dokumentendatenbanken** – `FirebaseCollectionConfig` und, für `path`, `MongoDBCollectionConfig`:

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Nur Firestore.** Collections, die unter jedem Dokument verschachtelt sind. Eine Postgres-Collection drückt dasselbe mit einer `hasMany`-[Relation](/docs/collections/relations) aus, wodurch `childCollections` befüllt wird |
| `path` | `string` | **Nur Firestore und MongoDB.** Der Pfad oder Collection-Name auf Engine-Ebene, falls dieser vom Slug abweicht |

Und innerhalb von `admin`, da nur das Panel diese rendert:

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Benutzerdefinierte Aktionen auf Entitäten (Archivieren, Veröffentlichen usw.) |
| `admin.Actions` | `React.ComponentType` | Benutzerdefinierte Toolbar-Aktionskomponente |
| `admin.entityViews` | `EntityCustomView[]` | Benutzerdefinierte Tabs in der Entitäts-Detailansicht |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Berechnete/virtuelle Spalten |
| `admin.exportable` | `boolean \| ExportConfig` | Datenexport aktivieren |
| `admin.components` | `CollectionComponentOverrideMap` | UI-Komponenten-Overrides mit Collection-Gültigkeitsbereich |

Das Definieren eines dieser sechs Felder auf oberster Ebene führt zu einem Boot-Zeit-Fehler mit einer Meldung, die den Schlüssel und dessen neuen Ablageort nennt.

## Entitätsanzeige

Jede Oberfläche, die einen Datensatz darstellt, rendert eine Teilmenge von sechs Rollen: **title**, **subtitle**, **image**, **status**, **date** und **tags**. Eine Zeile in einer Liste besteht aus Bild + Titel + Untertitel + Status + Datum, eine Karte ist dasselbe mit dem Bild obenauf, ein Referenz-Picker besteht aus Titel + Untertitel und eine Seitenüberschrift zeigt nur den Titel.

Jede Rolle wird von Ihren Properties abgeleitet und kann stattdessen explizit definiert werden – als Property-Pfad oder als Funktion:

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

Alles, was Sie weglassen, behält seinen abgeleiteten Wert; das Angeben einer einzelnen Rolle verpflichtet Sie also nicht dazu, alle sechs anzugeben.

### Berechnete und asynchrone Rollen

Ein Resolver kann `async` sein, wodurch eine Rolle Werte lesen kann, die der Datensatz selbst nicht enthält – etwa ein Dokument in einer Subcollection oder einen Wert hinter einer API:

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

Während das Promise aussteht, zeigt die Oberfläche den abgeleiteten Wert an und ersetzt ihn durch den aufgelösten Wert, sobald er eintrifft – ein Titel wird niemals als Spinner dargestellt. Ergebnisse werden pro Datensatz und Rolle zwischengespeichert, und gleichzeitige Abfragen für dasselbe Paar teilen sich einen einzigen Aufruf. Eine Liste mit fünfzig Zeilen löst daher jede Zeile nur einmal auf, anstatt bei jedem Render-Vorgang erneut.

Geben Sie `undefined` zurück, wenn ein Datensatz keinen Wert für die Rolle aufweist; der eigene Fallback der Oberfläche weiß besser, was stattdessen dorthin gehört (eine Überschrift verwendet den Singular-Namen der Collection, ein Link die ID). Ein Resolver, der einen Fehler wirft, wird wie `undefined` behandelt und einmalig protokolliert – ein Titel, der nicht abgerufen werden kann, darf nicht die gesamte Zeile zum Absturz bringen.

Bevorzugen Sie einen Pfad, wann immer sich der Wert direkt im Datensatz befindet: Ein Pfad behält das eigene Rendering der Property bei, sodass ein Enum-Status ein farbiger Chip bleibt und ein Datum formatiert wird, was ein Resolver, der einen reinen String zurückgibt, nicht leisten kann.

:::note[`titleProperty` ersetzt]
`admin.titleProperty` wurde zugunsten von `admin.display.title` entfernt. Derselbe String funktioniert dort weiterhin, und das neue Feld akzeptiert auch einen Resolver. Eine Collection, die noch den alten Schlüssel verwendet, wird von `defineCollection` mit dem gewohnten Fehler für unbekannte Schlüssel abgewiesen.
:::

### Auswahl der Titel-Property
Wenn `display.title` nicht gesetzt ist, wird die als Anzeigetitel der Entität verwendete Property (Vorschauen, Header) automatisch ermittelt:
1. Wenn `propertiesOrder` explizit definiert ist, wird die erste Eigenschaft (außer ID) gewählt, die entweder vom Typ `relation` oder `string` ist.
2. Wenn kein `propertiesOrder` definiert ist, durchsucht das Framework die Properties der Reihe nach und wählt die erste Eigenschaft vom Typ `string`.

### Relationsvorschauen in Tabellen
Wenn `propertiesOrder` explizit gesetzt ist, werden Relations-Properties **nicht** automatisch aus den standardmäßigen Vorschau-Spalten herausgefiltert (wohingegen sie bei ungeordneten Standards ausgeschlossen werden, um langsame Join-Operationen zu vermeiden).

### Wie ein Titelwert gerendert wird
Was auch immer die Titel-Property enthält, das Panel rendert einen String. Ein Datum wird formatiert, ein Array zusammengefügt und eine Relation – die als `{ id, data: { values } }` anstelle von reinem Text ankommt – wird nach dem ersten vorkommenden Feld unter `name`, `title`, `label` oder `displayName` in der verknüpften Zeile durchsucht, mit Fallback auf ihre ID. Daher kann ein Titel eine `relation`-Property referenzieren und dennoch als Name statt als UUID dargestellt werden.

Dies ist kein exportierter Helper: Es ist das Standardverhalten jeder Oberfläche, die einen Datensatz darstellt. Es muss nichts aufgerufen oder importiert werden.

## Collection Builder

Verwenden Sie für dynamische Collections, die sich je nach Benutzer oder externen Daten ändern, eine Builder-Funktion:

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

Sie können Standardfilter oder erzwungene Filter festlegen. Da alle drei Optionen die Präsentation betreffen – also womit das Panel öffnet –, befinden sie sich in `admin`:

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

Ein `fixedFilter` schränkt ein, was das Panel *anfragt*; er stellt keine Sicherheitsgrenze dar. Was ein Aufrufer tatsächlich lesen darf, bestimmt eine [Sicherheitsregel](/docs/collections/security-rules), die von der Datenbank für jeden Aufrufer durchgesetzt wird, egal ob über das Panel oder nicht.

## Nächste Schritte

- **[Entitäts-Callbacks](/docs/collections/callbacks)** — Lifecycle-Hooks zur Datensynchronisation zwischen Collections, Validierung und Nebeneffekten
- **[Properties](/docs/collections/properties)** — Alle Property-Typen und Optionen
- **[Relationen](/docs/collections/relations)** — Fremdschlüssel, Junction-Tabellen, Joins
- **[Sicherheitsregeln](/docs/collections/security-rules)** — Row Level Security
- **[Ansichtsmodi](/docs/frontend/view-modes)** — Liste, Tabelle, Karten, Kanban

---
