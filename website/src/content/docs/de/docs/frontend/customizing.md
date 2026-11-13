---
sourceHash: 362c7b70fede8ad5
title: Admin anpassen
sidebar_label: Admin anpassen
description: So passen Sie den Rebase-Admin an – Bausteine, Hooks und Orte, mit getesteten Rezepten für Singletons, benutzerspezifische Einstellungen, Massenaktionen, Kalenderansichten, Dashboards und eigene Login-Bildschirme.
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die Admin-Oberfläche ist aus Komponenten aufgebaut, die Sie selbst verwenden können. Um sie anzupassen, schreiben Sie eine gewöhnliche React-Komponente und platzieren sie an einem bestimmten Ort. Das ist das gesamte Modell:

- **Bausteine**, die Sie rendern – die Tabelle einer Collection, das Formular eines einzelnen Datensatzes, das UI-Kit.
- **Hooks** für Daten, den angemeldeten Benutzer, Toasts und Navigation.
- **Orte (Places)** für Komponenten – eine Seite, ein Ansichtsmodus, ein Toolbar-Button, ein Datensatz-Tab, ein Feld, ein Slot neben einer integrierten Komponente oder ein Override, der eine solche ersetzt.

Wenn ein Baustein nicht das tut, was Sie benötigen, kopieren Sie dessen Quellcode in Ihr Projekt und passen ihn an – siehe [Kopieren einer integrierten Komponente](#kopieren-einer-integrierten-komponente). Nichts davon erfordert, dass zuvor eine Konfigurationsoption existiert. Die tabelle-spezifischen Orte sind Optionen von [`customizeTable`](/docs/frontend/customize-table/).

## Rezepte

Funktionsfähige, getestete Beispiele werden direkt mit `@rebasepro/cms` ausgeliefert, sodass die Beispiele in `node_modules/@rebasepro/cms/recipes` immer genau zu Ihrer installierten Version passen. Sie importieren ausschließlich öffentliche Pakete: Kopieren Sie einfach eines unverändert in Ihr Projekt.

| Rezept | Was es zeigt |
|---|---|
| `site-settings.tsx` | Ein Singleton: ein einzelner Einstellungsdatensatz auf einer eigenen Seite, der beim ersten Speichern erstellt wird. |
| `my-preferences.tsx` | Benutzerspezifische Einstellungen: Jeder Benutzer bearbeitet den Datensatz, der durch seine uid identifiziert wird. |
| `bulk-set-status.tsx` | Ein Toolbar-Button, der jede ausgewählte Zeile aktualisiert. |
| `calendar-view.tsx` | Ein neuer Ansichtsmodus: Zeilen einer Collection in einer Monatsübersicht. |
| `orders-dashboard.tsx` | Eine Seite, die Daten liest, ein Diagramm zeichnet und in den Admin verlinkt. |
| `custom-login.tsx` | Ersetzen des Anmeldebildschirms. |

Die `README.md` daneben dient als vollständige Referenz für Bausteine, Hooks und Orte.

## Beispiel: Ein Singleton

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein Singleton ist keine spezielle Art von Tabelle. Es ist eine ganz normale Tabelle, deren Seite immer dieselbe Zeile öffnet. Wird `RecordForm` eine ID übergeben, bearbeitet es diesen Datensatz und erstellt ihn beim ersten Mal unter dieser ID, sodass kein Seeding erforderlich ist.

```ts
// backend/schema/site_settings.ts: `rebase db push` creates the table.
import { defineTable, col } from "@rebasepro/server/schema";

export const siteSettings = defineTable("site_settings", {
    columns: {
        id:              col.text().primaryKey(),
        siteName:        col.text().notNull(),
        maintenanceMode: col.boolean().notNull().default(false),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/site_settings.tsx
import React from "react";
import { customizeTable, RecordForm } from "@rebasepro/cms";
import type { AppView } from "@rebasepro/cms-types";
import { Container, Typography } from "@rebasepro/ui";
import type { siteSettings } from "../../../backend/schema/site_settings";

// Reachable only through the page below, not from the drawer.
export const siteSettingsCms = customizeTable<typeof siteSettings>("site_settings", {
    name: "Site settings",
    hideFromNavigation: true,
    hideIdFromForm: true,
});

// Add to <RebaseCMS views={[siteSettingsView]}>.
export const siteSettingsView: AppView = {
    slug: "settings/site",
    name: "Site settings",
    icon: "Settings",
    view: (
        <Container maxWidth={"3xl"} className={"py-8"}>
            <Typography variant={"h4"} gutterBottom>Site settings</Typography>
            <RecordForm collection={"site_settings"} id={"site"}/>
        </Container>
    )
};
```

Das gleiche Muster mit `id={user.uid}` (aus `useAuthController()`) ergibt eine Seite für benutzerspezifische Einstellungen.

Um nur einige der Felder anzuzeigen, übergeben Sie `fields={["siteName"]}`. Um sie selbst anzuordnen, übergeben Sie `layout` mit `<FormField name="…"/>` in Ihrem eigenen JSX. In beiden Fällen validiert das Formular nur das, was es anzeigt – siehe [Panels auf einer eigenen Seite](/docs/frontend/panels).

## Orte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Um Folgendes hinzuzufügen … | Platzieren Sie eine Komponente in |
|---|---|
| Eine Seite | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Einen Ansichtsmodus für eine Tabelle | `customViews` in dessen `customizeTable` oder `<RebaseCMS collectionViews>` und den Schlüssel – siehe [Benutzerdefinierte Ansichtsmodi](/docs/frontend/extending#custom-view-modes) |
| Einen Button in der Toolbar einer Collection | `Actions: [Component]` in `customizeTable` |
| Einen Button auf einem Datensatz | `entityActions` in `customizeTable` – siehe [Entity Actions](/docs/frontend/entity-actions) |
| Einen Tab auf einem Datensatz | `entityViews` in `customizeTable` – siehe [Entity Views](/docs/frontend/entity-views) |
| Wie ein Feld bearbeitet oder angezeigt wird | `Field` / `Preview` für das Feld in `customizeTable` – siehe [Benutzerdefinierte Felder](/docs/frontend/custom-fields) |
| Etwas neben einer integrierten Komponente | `<Rebase slots>` – siehe [Slots](/docs/frontend/slots) |
| Einen Ersatz für eine integrierte Komponente | `<Rebase components>` – siehe [Komponenten-Overrides](/docs/frontend/component-overrides) |

## Was jeder Ort an Ihre Komponente übergibt

| Ort | Ihre Komponente erhält |
|---|---|
| Eine Seite (`views`) | Nichts: Lesen Sie das, was Sie benötigen, über die Hooks aus. Sie wird innerhalb des Admin-Routers gerendert, daher funktioniert `useUrlController().navigate(…)` (oder `react-router`). |
| Ein Ansichtsmodus-`Builder` | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (dessen `rows` sind die Zeilen, die durch Suche und Filter der Toolbar ausgewählt wurden, wie vom Server gesendet; `loading`, `error`, …), `onRowClick(row)` zum Öffnen einer Zeile so, wie die Collection Zeilen öffnet, `selectionController`, `highlightedIds` (IDs als Strings), `emptyComponent`. |
| `Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows` und deren `ids`), `openNewDocument(defaults?)`, `context`. Wandeln Sie `selection` mit `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })` in Zeilen und deren IDs um – dies kann für „jede Zeile, die dem Filter entspricht“ stehen, nicht nur für die angehakten. |
| `entityViews`-`Builder` | `EntityCustomViewParams`: `collection`, der gespeicherte Datensatz (`row`) und dessen ID (`id`), beide abwesend während der Erstellung, seine ungespeicherten Werte (`modifiedValues`) und das Formular (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Anmelden mit `authController.emailPasswordLogin?.(email, password)` (optional: vorhanden, wenn die E-Mail-Anmeldung aktiviert ist); ein Fehler löst eine Exception aus und ist auch unter `authController.authProviderError` verfügbar. Sobald `authController.user` gesetzt ist, ersetzt der Admin den Bildschirm automatisch. |
| Jeder andere Override | Die Props der Komponente, die ersetzt wird; mit `wrap: true` diese zusätzlich zu `OriginalComponent`. |

## Hooks

| Hook | Paket | Bietet Ihnen |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Eine Live-Liste von Zeilen / eine einzelne Live-Zeile, so wie der Server sie sendet. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, über den Server, sodass Tabellen-Hooks und Row-Level Security greifen. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.orders.find / findById / create / update / delete`, für Code außerhalb des React-States; dieselben Zeilen und Schreiboperationen, die dieselben Hooks ausführen. |
| `useAuthController` | `@rebasepro/app` | Der angemeldete `user` (uid, Rollen), An- und Abmeldung. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` für einen Toast. |
| `useSidePanel` | `@rebasepro/cms` | Beliebige Datensätze im Seitenpanel öffnen. |
| `useUrlController` | `@rebasepro/cms` | Admin-URLs und Navigation. |
| `resolveSelection` | `@rebasepro/cms` | Eine Tabellenauswahl – angehakte Zeilen oder „alle passenden“ – als Zeilen und deren IDs: `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`. |

## Kopieren einer integrierten Komponente

Wenn eine integrierte Komponente dem nahekommt, was Sie möchten, kopieren Sie deren Quellcode aus dem Repository `@rebasepro/cms` (oder `@rebasepro/app`) in Ihr Projekt, passen Sie die relativen Importe auf die Pakete an, ändern Sie sie und registrieren Sie sie unter ihrem Namen in `<Rebase components>`. Alles, was eine Komponente importiert, ist ein öffentlicher Export, sodass die Kopie kompiliert – für jede Komponente außer dreien, und diese drei sind bewusst so gewählt:

- **`Collection.View`** ist die Komposition aller Ansichtsmodi – Liste, Tabelle, Karten, Board, Split – mit Inline-Bearbeitung, dem Popup-Feld-Editor, dem Löschdialog und dem URL-Status des Ansichtsmodus. Was sie importiert, sind die Interna dieser Modi. Ersetzen Sie stattdessen einen Teil davon (`Collection.Table`, `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, die sich alle kopieren lassen), fügen Sie einen eigenen [Ansichtsmodus](/docs/frontend/view-modes) hinzu oder umschließen Sie sie mit `wrap: true`.
- **`DetailView`** ist die Komposition der Datensatzansicht: Identitätsleiste, Tabs, Inspector und die Schaltflächen der geteilten Liste rund um Tab-IDs, die URL-Werte sind. Passen Sie einen Datensatz mit [Entity Views](/docs/frontend/entity-views), [Entity Actions](/docs/frontend/entity-actions), den `form.*`-[Slots](/docs/frontend/slots) oder den Overrides `Entity.Form` und `EditView.FormActions` an, die sich kopieren lassen.
- **`HomePage`** lässt sich kopieren, mit Ausnahme der Drag-and-Drop-Neuordnung von Karten und Gruppen, für die es keine eigene zu exportierende API gibt. Eine eigene Startseite setzt sich aus `NavigationGroup`, `NavigationCardBinding` und `FavouritesView` über `useNavigationStateController().topLevelNavigation` zusammen; um die Standard-Startseite zu erweitern, verwenden Sie den `home.cards`-Slot.
