---
sourceHash: db22b88374775aed
title: Anpassen des Admin-Bereichs
sidebar_label: Anpassen des Admin-Bereichs
description: Wie Sie den Rebase-Admin anpassen – Bausteine, Hooks und Stellen (Places), mit getesteten Recipes für Singletons, benutzerspezifische Einstellungen, Massenaktionen, Kalenderansichten, Dashboards und benutzerdefinierte Login-Bildschirme.
---

Der Admin-Bereich ist aus Komponenten aufgebaut, die Sie selbst verwenden können. Um ihn anzupassen, schreiben Sie eine ganz normale React-Komponente und platzieren sie an der gewünschten Stelle. Das ist das gesamte Modell:

- **Bausteine (Building blocks)**, die Sie rendern – die Tabelle einer Collection, das Formular eines Datensatzes, das UI-Kit.
- **Hooks** für Daten, den angemeldeten Benutzer, Toasts und die Navigation.
- **Stellen (Places)**, an denen eine Komponente platziert werden kann – eine Seite, ein View-Modus für eine Collection, eine Schaltfläche in der Symbolleiste, ein Datensatz-Tab, ein Feld, ein Slot neben einer integrierten Komponente oder ein Override, der eine solche ersetzt.

Wenn ein Baustein nicht genau das tut, was Sie benötigen, kopieren Sie dessen Quellcode in Ihr Projekt und passen ihn an – siehe [Kopieren einer integrierten Komponente](#kopieren-einer-integrierten-komponente). Nichts davon erfordert, dass zuvor eine Konfigurationsoption existiert.

## Recipes

Funktionsfähige, getestete Beispiele sind direkt in `@rebasepro/cms` enthalten, sodass die Beispiele in `node_modules/@rebasepro/cms/recipes` immer genau zu Ihrer installierten Version passen. Sie importieren ausschließlich öffentliche Pakete: Kopieren Sie einfach eines unverändert in Ihr Projekt.

| Recipe | Was es zeigt |
|---|---|
| `site-settings.tsx` | Ein Singleton: ein einzelner Einstellungsdatensatz auf einer eigenen Seite, der beim ersten Speichern erstellt wird. |
| `my-preferences.tsx` | Benutzerspezifische Einstellungen: Jeder Benutzer bearbeitet den Datensatz mit seiner `uid` als Schlüssel. |
| `bulk-set-status.tsx` | Eine Schaltfläche in der Symbolleiste, die jede ausgewählte Zeile aktualisiert. |
| `calendar-view.tsx` | Ein neuer View-Modus: die Zeilen einer Collection in einem Monatsraster. |
| `orders-dashboard.tsx` | Eine Seite, die Daten ausliest, ein Diagramm zeichnet und Links in den Admin-Bereich bereitstellt. |
| `custom-login.tsx` | Ersetzen des Login-Bildschirms. |

Die dazugehörige `README.md` ist die vollständige Referenz aller Bausteine, Hooks und Stellen.

## Beispiel: Ein Singleton

Ein Singleton ist kein spezieller Collection-Typ. Es ist eine gewöhnliche Tabelle, deren Seite immer dieselbe Zeile öffnet. Wird `EntityFormPanel` eine ID übergeben, bearbeitet es diesen Datensatz und erstellt ihn beim ersten Mal unter dieser ID – ein Seeding ist also nicht erforderlich.

```tsx
import React from "react";
import { defineCollection } from "@rebasepro/cms-types";
import type { AppView } from "@rebasepro/cms-types";
import { EntityFormPanel } from "@rebasepro/cms";
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
            <EntityFormPanel collection={siteSettingsCollection} id={"site"}/>
        </Container>
    )
};
```

Derselbe Aufbau mit `id={user.uid}` (aus `useAuthController()`) ergibt eine Seite für benutzerspezifische Einstellungen.

<span class="since-badge" data-since="0.29">Seit 0.29</span> Um nur einen Teil der Felder anzuzeigen, übergeben Sie `fields={["siteName"]}`. Um sie selbst anzuordnen, übergeben Sie `layout` mit `<FormField name="…"/>`-Elementen in Ihrem eigenen JSX. In beiden Fällen validiert das Formular nur das, was es auch anzeigt – siehe [Panels in a page of your own](/docs/frontend/panels).

## Stellen (Places)

| Um Folgendes hinzuzufügen… | Platzieren Sie eine Komponente in |
|---|---|
| Eine Seite | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Einen View-Modus für eine Collection | `collectionViews={[{ key, name, Builder }]}` und `admin.customViews: ["key"]` – siehe [View Modes](/docs/frontend/view-modes) |
| Eine Schaltfläche in der Symbolleiste einer Collection | `admin.Actions: [Component]` |
| Eine Schaltfläche auf einem Datensatz | `admin.entityActions` – siehe [Entity Actions](/docs/frontend/entity-actions) |
| Einen Tab auf einem Datensatz | `admin.entityViews` – siehe [Entity Views](/docs/frontend/entity-views) |
| Die Art und Weise, wie ein Feld bearbeitet oder angezeigt wird | `admin.Field` / `admin.Preview` – siehe [Custom Fields](/docs/frontend/custom-fields) |
| Etwas neben einer integrierten Komponente | `<Rebase slots>` – siehe [Slots](/docs/frontend/slots) |
| Einen Ersatz für eine integrierte Komponente | `<Rebase components>` – siehe [Component Overrides](/docs/frontend/component-overrides) |

## Was die jeweilige Stelle an Ihre Komponente übergibt

| Stelle | Ihre Komponente erhält |
|---|---|
| Eine Seite (`views`) | Nichts: Lesen Sie das aus, was Sie benötigen, mithilfe der Hooks. Sie wird innerhalb des Admin-Routers gerendert, daher funktioniert `useUrlController().navigate(…)` (oder `react-router`). |
| Ein View-Modus-`Builder` | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (dessen `rows` die Zeilen sind, die durch Suche und Filter der Symbolleiste ausgewählt werden, wie vom Server gesendet; `loading`, `error`, …), `onRowClick(row)`, um eine Zeile so zu öffnen, wie die Collection Zeilen öffnet, `selectionController`, `highlightedIds`, `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows`), `openNewDocument(defaults?)`, `context`. Wandeln Sie `selection` in Zeilen um mit `resolveSelection({ selection, data: context.data, collection })` – dies kann für „alle Zeilen, die dem Filter entsprechen“ stehen, nicht nur für die angehakten. |
| `admin.entityViews` `Builder` | `EntityCustomViewParams`: `collection`, den Datensatz (`entity`, nicht vorhanden, während er neu erstellt wird), seine ungespeicherten Werte (`modifiedValues`) und das Formular (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Melden Sie sich mit `authController.emailPasswordLogin?.(email, password)` an (optional: vorhanden, wenn E-Mail-Login aktiviert ist); ein Fehler löst eine Exception aus und liegt zudem unter `authController.authProviderError`. Sobald `authController.user` gesetzt ist, ersetzt der Admin Ihren Bildschirm automatisch. |
| Jeder andere Override | Die Props der Komponente, die er ersetzt; mit `wrap: true` zusätzlich noch `OriginalComponent`. |

## Hooks

| Hook | Paket | Bietet Ihnen |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Eine Live-Liste von Zeilen / eine einzelne Live-Zeile, wie vom Server gesendet. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove`, über den Server, sodass Callbacks und Sicherheitsregeln greifen. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.collection("orders").find / findById / create / update / delete`, für Code außerhalb des React-State; dieselben Zeilen und Schreiboperationen, die dieselben Callbacks ausführen. |
| `useAuthController` | `@rebasepro/app` | Der angemeldete `user` (UID, Rollen), Login und Logout. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` für einen Toast. |
| `useSidePanel` | `@rebasepro/cms` | Öffnet beliebige Datensätze im Seitenpanel. |
| `useUrlController` | `@rebasepro/cms` | Admin-URLs und Navigation. |
| `resolveSelection` | `@rebasepro/cms` | Eine Tabellenauswahl – angehakte Zeilen oder „alle passenden“ – als Zeilen: `resolveSelection({ selection, data: context.data, collection })`. |

## Kopieren einer integrierten Komponente

Wenn eine integrierte Komponente fast dem entspricht, was Sie benötigen, kopieren Sie deren Quellcode aus dem `@rebasepro/cms`- (oder `@rebasepro/app`-) Repository in Ihr Projekt, passen Sie die relativen Imports auf die Pakete an, ändern Sie die Komponente und registrieren Sie sie unter ihrem Namen in `<Rebase components>`. Alles, was eine Komponente importiert, ist ein öffentlicher Export, sodass die Kopie kompiliert werden kann – bis auf drei Komponenten, und diese drei sind eine bewusste Ausnahme:

- **`Collection.View`** ist die Komposition aller View-Modi – Liste, Tabelle, Karten, Board, Split – samt Inline-Editing, dem Popup-Feld-Editor, dem Löschdialog und dem URL-Status des View-Modus. Was sie importiert, sind die Interna dieser Modi. Ersetzen Sie stattdessen einen Teil davon (`Collection.Table`, `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, die sich alle kopieren lassen), fügen Sie einen eigenen [View-Modus](/docs/frontend/view-modes) hinzu oder wrappen Sie die Komponente mit `wrap: true`.
- **`DetailView`** ist die Komposition der Datensatzansicht: Identity-Bar, Tabs, Inspector und die Schaltflächen der geteilten Liste rund um Tab-IDs, die URL-Werte darstellen. Passen Sie einen Datensatz über [Entity Views](/docs/frontend/entity-views), [Entity Actions](/docs/frontend/entity-actions), die `form.*`-[Slots](/docs/frontend/slots) oder die Overrides `Entity.Form` und `EditView.FormActions` an, die kopiert werden können.
- **`HomePage`** lässt sich bis auf das Drag-and-Drop-Reordering von Karten und Gruppen kopieren, welches keine eigene API zum Exportieren bereitstellt. Eine eigene Startseite setzt sich aus `NavigationGroup`, `NavigationCardBinding` und `FavouritesView` über `useNavigationStateController().topLevelNavigation` zusammen; um die Standardseite zu erweitern, verwenden Sie den Slot `home.cards`.
