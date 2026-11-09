---
sourceHash: f28407f4fb9eb7a2
title: Admin-Bereich anpassen
sidebar_label: Admin-Bereich anpassen
description: Wie Sie den Rebase-Admin anpassen — Bausteine, Hooks und Orte, mit getesteten Rezepten für Singletons, benutzerspezifische Einstellungen, Massenaktionen, Kalenderansichten, Dashboards und benutzerdefinierte Login-Bildschirme.
---

Der Admin-Bereich ist aus Teilen aufgebaut, die Sie selbst verwenden können. Um ihn anzupassen, schreiben Sie eine gewöhnliche React-Komponente und platzieren sie an einem Ort. Das ist das gesamte Modell:

- **Bausteine**, die Sie rendern — die Tabelle einer Collection, das Formular eines Datensatzes, das UI-Kit.
- **Hooks** für Daten, den angemeldeten Benutzer, Toasts und Navigation.
- **Orte**, an denen Sie eine Komponente platzieren — eine Seite, ein Ansichtsmodus für eine Collection, eine Toolbar-Schaltfläche, ein Datensatz-Tab, ein Feld, ein Slot neben einer integrierten Komponente oder ein Override, der eine solche ersetzt.

Wenn ein Baustein nicht das tut, was Sie benötigen, kopieren Sie seinen Quellcode in Ihr Projekt und ändern ihn — siehe [Kopieren einer integrierten Komponente](#kopieren-einer-integrierten-komponente). Nichts davon setzt voraus, dass zuerst eine Konfigurationsoption existiert.

## Rezepte

Funktionsfähige, getestete Beispiele werden direkt in `@rebasepro/cms` mitgeliefert, sodass die Beispiele in `node_modules/@rebasepro/cms/recipes` immer genau zu Ihrer installierten Version passen. Sie importieren ausschließlich öffentliche Pakete: Kopieren Sie einfach eines unverändert in Ihr Projekt.

| Rezept | Was es zeigt |
|---|---|
| `site-settings.tsx` | Ein Singleton: Ein einzelner Einstellungsdatensatz auf einer eigenen Seite, der beim ersten Speichern erstellt wird. |
| `my-preferences.tsx` | Benutzerspezifische Einstellungen: Jeder Benutzer bearbeitet den Datensatz, der über seine uid identifiziert wird. |
| `bulk-set-status.tsx` | Eine Toolbar-Schaltfläche, die jede ausgewählte Zeile aktualisiert. |
| `calendar-view.tsx` | Ein neuer Ansichtsmodus: Die Zeilen einer Collection in einem Monatsraster. |
| `orders-dashboard.tsx` | Eine Seite, die Daten liest, ein Diagramm zeichnet und in den Admin-Bereich verlinkt. |
| `custom-login.tsx` | Ersetzen des Login-Bildschirms. |

Die `README.md` daneben ist die vollständige Referenz aller Bausteine, Hooks und Orte.

## Beispiel: Ein Singleton

Ein Singleton ist kein spezieller Collection-Typ. Es handelt sich um eine gewöhnliche Tabelle, deren Seite immer dieselbe Zeile öffnet. Wird `RecordForm` eine ID übergeben, bearbeitet es diesen Datensatz und erstellt ihn beim ersten Mal unter dieser ID – ein Seeding ist daher nicht erforderlich.

```tsx
import React from "react";
import { defineCollection } from "@rebasepro/cms-types";
import type { AppView } from "@rebasepro/cms-types";
import { RecordForm } from "@rebasepro/cms";
import { Container, Typography } from "@rebasepro/ui";

// config/collections/site_settings.ts — `rebase db push` creates the table.
export const siteSettingsCollection = defineCollection({
    name: "Site settings",
    slug: "site_settings",
    table: "site_settings",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        siteName: { name: "Site name", type: "string", validation: { required: true } },
        maintenanceMode: { name: "Maintenance mode", type: "boolean" }
    },
    admin: { hideFromNavigation: true, hideIdFromForm: true }
});

// Add to <RebaseCMS views={[siteSettingsView]}>.
export const siteSettingsView: AppView = {
    slug: "settings/site",
    name: "Site settings",
    icon: "Settings",
    view: (
        <Container maxWidth={"3xl"} className={"py-8"}>
            <Typography variant={"h4"} gutterBottom>Site settings</Typography>
            <RecordForm collection={siteSettingsCollection} id={"site"}/>
        </Container>
    )
};
```

Die gleiche Struktur mit `id={user.uid}` (aus `useAuthController()`) ergibt eine Seite für benutzerspezifische Einstellungen.

Um nur einige der Felder anzuzeigen, übergeben Sie `fields={["siteName"]}`. Um sie selbst anzuordnen, übergeben Sie `layout` mit `<FormField name="…"/>`-Elementen in Ihrem eigenen JSX. In beiden Fällen validiert das Formular nur das, was es anzeigt — siehe [Panels in einer eigenen Seite](/docs/frontend/panels).

## Orte

| Um Folgendes hinzuzufügen… | Platzieren Sie eine Komponente in |
|---|---|
| Eine Seite | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Einen Ansichtsmodus für eine Collection | `collectionViews={[{ key, name, Builder }]}` und `admin.customViews: ["key"]` — siehe [View Modes](/docs/frontend/view-modes) |
| Eine Schaltfläche in der Toolbar einer Collection | `admin.Actions: [Component]` |
| Eine Schaltfläche auf einem Datensatz | `admin.entityActions` — siehe [Entity Actions](/docs/frontend/entity-actions) |
| Einen Tab auf einem Datensatz | `admin.entityViews` — siehe [Entity Views](/docs/frontend/entity-views) |
| Wie ein Feld bearbeitet oder angezeigt wird | `admin.Field` / `admin.Preview` — siehe [Custom Fields](/docs/frontend/custom-fields) |
| Etwas neben einer integrierten Komponente | `<Rebase slots>` — siehe [Slots](/docs/frontend/slots) |
| Einen Ersatz für eine integrierte Komponente | `<Rebase components>` — siehe [Component Overrides](/docs/frontend/component-overrides) |

## Was die einzelnen Orte an Ihre Komponente übergeben

| Ort | Ihre Komponente empfängt |
|---|---|
| Eine Seite (`views`) | Nichts: Lesen Sie das, was Sie benötigen, über die Hooks aus. Sie wird innerhalb des Admin-Routers gerendert, sodass `useUrlController().navigate(…)` (oder `react-router`) funktioniert. |
| Ein Ansichtsmodus-`Builder` | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (dessen `rows` die Zeilen sind, die durch Suche und Filter der Toolbar ausgewählt wurden, so wie der Server sie sendet; `loading`, `error`, …), `onRowClick(row)` zum Öffnen einer Zeile auf die gleiche Weise, wie die Collection Zeilen öffnet, `selectionController`, `highlightedIds` (IDs als Strings), `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows` und deren `ids`), `openNewDocument(defaults?)`, `context`. Wandeln Sie `selection` mit `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })` in Zeilen und deren IDs um — dies kann für „jede Zeile, die dem Filter entspricht“ stehen, nicht nur für die angehakten. |
| `admin.entityViews` `Builder` | `EntityCustomViewParams`: `collection`, der gespeicherte Datensatz (`row`) und dessen ID (`id`), beide fehlen während der Erstellung, seine ungespeicherten Werte (`modifiedValues`) und das Formular (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Anmelden mit `authController.emailPasswordLogin?.(email, password)` (optional: vorhanden, wenn E-Mail-Login aktiviert ist); ein Fehler wirft eine Exception und ist auch unter `authController.authProviderError` verfügbar. Sobald `authController.user` gesetzt ist, ersetzt der Admin Ihren Bildschirm automatisch. |
| Jeder andere Override | Die Props der Komponente, die ersetzt wird; mit `wrap: true` zusätzlich noch `OriginalComponent`. |

## Hooks

| Hook | Paket | Bietet Ihnen |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Eine Live-Liste von Zeilen / eine einzelne Live-Zeile, wie vom Server gesendet. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, über den Server, sodass Callbacks und Sicherheitsregeln greifen. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.collection("orders").find / findById / create / update / delete`, für Code außerhalb des React-States; dieselben Zeilen und Schreiboperationen, die dieselben Callbacks ausführen. |
| `useAuthController` | `@rebasepro/app` | Den angemeldeten `user` (uid, Rollen), Anmeldung und Abmeldung. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` für einen Toast. |
| `useSidePanel` | `@rebasepro/cms` | Öffnen eines beliebigen Datensatzes im Side-Panel. |
| `useUrlController` | `@rebasepro/cms` | Admin-URLs und Navigation. |
| `resolveSelection` | `@rebasepro/cms` | Eine Tabellenauswahl — angehakte Zeilen oder „alle übereinstimmenden“ — als Zeilen und deren IDs: `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`. |

## Kopieren einer integrierten Komponente

Wenn eine integrierte Komponente dem nahekommt, was Sie möchten, kopieren Sie ihren Quellcode aus dem Repository von `@rebasepro/cms` (oder `@rebasepro/app`) in Ihr Projekt, passen die relativen Importe so an, dass sie auf die Pakete verweisen, nehmen Ihre Änderungen vor und registrieren sie unter ihrem Namen in `<Rebase components>`. Alles, was eine Komponente importiert, ist ein öffentlicher Export, sodass die Kopie kompiliert — mit Ausnahme von drei Komponenten, und diese drei sind eine bewusste Entscheidung:

- **`Collection.View`** ist die Komposition aller Ansichtsmodi — Liste, Tabelle, Karten, Board, Split — samt Inline-Bearbeitung, dem Popup-Feld-Editor, dem Löschdialog und dem URL-Zustand des Ansichtsmodus. Was sie importiert, sind die Interna dieser Modi. Ersetzen Sie stattdessen einen Teil davon (`Collection.Table`, `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, die sich alle kopieren lassen), fügen Sie einen eigenen [View Mode](/docs/frontend/view-modes) hinzu oder wrappen Sie sie mit `wrap: true`.
- **`DetailView`** ist die Komposition der Datensatzansicht: Identitätsleiste, Tabs, Inspektor und die Schaltflächen der Split-Liste, rund um Tab-IDs, die URL-Werte sind. Passen Sie einen Datensatz mit [Entity Views](/docs/frontend/entity-views), [Entity Actions](/docs/frontend/entity-actions), den `form.*`-[Slots](/docs/frontend/slots) oder den Overrides `Entity.Form` und `EditView.FormActions` an, welche sich kopieren lassen.
- **`HomePage`** lässt sich bis auf das Drag-and-Drop-Neuordnen von Karten und Gruppen kopieren, welches keine eigene API zum Exportieren besitzt. Eine eigene Startseite setzt sich aus `NavigationGroup`, `NavigationCardBinding` und `FavouritesView` über `useNavigationStateController().topLevelNavigation` zusammen; um die Standard-Startseite zu erweitern, verwenden Sie den `home.cards`-Slot.
