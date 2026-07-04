---
title: Sammlungen
sidebar_label: Sammlungen
description: Sammlungen sind der zentrale Baustein von Rebase – jede Sammlung bildet eine Datenbanktabelle ab und definiert deren Schema, Relationen, Sicherheit und UI-Verhalten.
---

## Was ist eine Sammlung?

Eine **Sammlung** ist ein TypeScript-Objekt, das eine Datenbanktabelle beschreibt und wie diese in der Admin-Benutzeroberfläche erscheinen soll. Sie definiert:

- **Schema** – Eigenschaften (Spalten), deren Typen und Validierungsregeln
- **Relationen** – Fremdschlüssel, Verknüpfungstabellen und Join-Pfade
- **Sicherheit** – Row Level Security-Richtlinien
- **UI-Verhalten** – Ansichtsmodi, Inline-Bearbeitung, Entitätsansichten, Aktionen
- **Lebenszyklus-Hooks** – Callbacks für Erstellungs-, Aktualisierungs- und Löschvorgänge

```typescript
import { CollectionConfig } from "@rebasepro/types";

export const productsCollection: CollectionConfig = {
    slug: "products",              // URL path and API endpoint
    name: "Products",              // Display name (plural)
    singularName: "Product",       // Display name (singular)
    table: "products",            // PostgreSQL table name
    icon: "inventory_2",           // Material icon key

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
                { id: "electronics", label: "Electronics", color: "blueDark" },
                { id: "clothing", label: "Clothing", color: "pinkLight" },
                { id: "books", label: "Books", color: "orangeDark" }
            ]
        },
        description: {
            type: "string",
            name: "Description",
            multiline: true
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        created_at: {
            type: "date",
            name: "Created At",
            autoValue: "on_create",
            readOnly: true
        }
    }
};
```

## Haupteigenschaften

### Identifikation

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `slug` | `string` | **Erforderlich.** URL-sicherer Bezeichner. Wird in der Admin-UI-URL und im REST-API-Pfad (`/api/data/{slug}`) verwendet. |
| `name` | `string` | **Erforderlich.** Anzeigename (Plural). Wird in der Navigation und in Seitenüberschriften angezeigt. |
| `singularName` | `string` | Anzeigename für eine einzelne Entität. Wird in „Neues Produkt“, „Produkt bearbeiten“ usw. verwendet. |
| `table` | `string` | **Erforderlich.** PostgreSQL-Tabellenname. Wenn er sich vom `slug` unterscheidet, können URLs von Tabellennamen entkoppelt werden. |
| `icon` | `string` | Material-Icon-Schlüssel. Siehe [Google Fonts Icons](https://fonts.google.com/icons). |

### Schema

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `properties` | `Properties` | **Erforderlich.** Abbildung von Eigenschaftsschlüssel → Eigenschaftsdefinition. Jeder Schlüssel wird zu einer Datenbankspalte. |
| `relations` | `Relation[]` | SQL-Relationen – Fremdschlüssel, Verknüpfungstabellen. Siehe [Relationen](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Row Level Security-Richtlinien. Siehe [Sicherheitsregeln](/docs/collections/security-rules). |

### UI-Konfiguration

| Eigenschaft | Typ | Standard | Beschreibung |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"table"` | Standardansichtsmodus |
| `enabledViews` | `ViewMode[]` | Alle vier | Welche Ansichtsmodi verfügbar sind |
| `kanban` | `KanbanConfig` | — | Kanban-Konfiguration (Spalteneigenschaft) |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split"` | `"full_screen"` | Wie Entitäten zur Bearbeitung geöffnet werden |
| `sideDialogWidth` | `number \| string` | — | Breite des Seitendialogs |
| `inlineEditing` | `boolean` | `true` | Inline-Bearbeitung in der Tabellenansicht aktivieren |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Standardzeilenhöhe in der Tabelle |
| `pagination` | `boolean \| number` | `true` (50) | Paginierung aktivieren und/oder Seitengröße festlegen |
| `listProperties` | `string[]` | — | Eigenschaften, die in der Listenansicht angezeigt werden sollen |
| `propertiesOrder` | `string[]` | — | Spaltenreihenfolge in der Tabellenansicht |
| `selectionEnabled` | `boolean` | `true` | Zeilenauswahl aktivieren |
| `hideFromNavigation` | `boolean` | `false` | Aus der Sidebar-Navigation ausblenden |
| `defaultSelectedView` | `string \| function` | — | Standardansicht oder Unterkollektion, die geöffnet werden soll |

### Entitätsoptionen

| Eigenschaft | Typ | Standard | Beschreibung |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Automatisches Speichern bei Feldänderung |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Ungespeicherte Änderungen sichern |
| `hideIdFromForm` | `boolean` | `false` | Die Entitäts-ID aus dem Formular ausblenden |
| `hideIdFromCollection` | `boolean` | `false` | Die ID-Spalte aus der Tabelle ausblenden |
| `includeJsonView` | `boolean` | `false` | Einen JSON-Tab in der Entitätsansicht anzeigen |
| `history` | `boolean` | `false` | Änderungen in der Entitätshistorie verfolgen |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Standardwerte bei jedem Speichern anwenden |
| `previewProperties` | `string[]` | — | Eigenschaften, die in Referenzvorschauen angezeigt werden sollen |
| `titleProperty` | `string` | — | Eigenschaft, die als Entitätstitel verwendet werden soll |

### Erweitert

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Lebenszyklus-Hooks (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `entityActions` | `EntityAction[]` | Benutzerdefinierte Aktionen für Entitäten (archivieren, veröffentlichen usw.) |
| `Actions` | `React.ComponentType` | Benutzerdefinierte Symbolleisten-Aktionskomponente |
| `entityViews` | `EntityCustomView[]` | Benutzerdefinierte Tabs in der Entitätsdetailansicht |
| `additionalFields` | `AdditionalFieldDelegate[]` | Berechnete/virtuelle Spalten |
| `childCollections` | `() => CollectionConfig[]` | Verschachtelte Kindersammlungen |
| `subcollections` | `() => CollectionConfig[]` | Verschachtelte Sammlungen (z.B. Bestellung → Posten) |
| `exportable` | `boolean \| ExportConfig` | Datenexport aktivieren |
| `ownerId` | `string` | Besitzer-Benutzer-ID (von Plugins/benutzerdefiniertem Code verwendet) |
| `overrides` | `EntityOverrides` | Overrides für die Entitätsansicht |
| `driver` | `string` | Zu verwendender Datenbanktreiber (Standard: `"(default)"`) |
| `databaseId` | `string` | Datenbank-/Schema-ID innerhalb des Treibers |

## Sammlungs-Builder

Für dynamische Sammlungen, die sich basierend auf dem Benutzer oder externen Daten ändern, verwenden Sie eine Builder-Funktion:

```typescript
const collectionsBuilder: CollectionConfigsBuilder = ({ user, authController }) => {
    const collections = [productsCollection];

    if (authController.extra?.role === "admin") {
        collections.push(adminSettingsCollection);
    }

    return collections;
};
```

## Filtern und Sortieren

Sie können Standard- oder erzwungene Filter festlegen:

```typescript
{
    // Default filter — users can change it
    filter: { active: ["==", true] },

    // Forced filter — cannot be changed
    forceFilter: { tenant_id: ["==", currentTenantId] },

    // Default sort
    sort: ["created_at", "desc"]
}
```

## Nächste Schritte

- **[Entitäts-Callbacks](/docs/collections/callbacks)** – Lebenszyklus-Hooks zum Synchronisieren von Daten zwischen Sammlungen, Validierung, Nebenwirkungen
- **[Eigenschaften](/docs/collections/properties)** – Alle Eigenschaftstypen und Optionen
- **[Relationen](/docs/collections/relations)** – Fremdschlüssel, Verknüpfungstabellen, Joins
- **[Sicherheitsregeln](/docs/collections/security-rules)** – Row Level Security
- **[Ansichtsmodi](/docs/frontend/view-modes)** – Liste, Tabelle, Karten, Kanban
