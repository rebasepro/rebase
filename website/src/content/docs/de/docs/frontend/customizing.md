---
sourceHash: 31ccfe9d60f8eafe
title: Admin anpassen
sidebar_label: Admin anpassen
description: So passen Sie den Rebase-Admin an – Bausteine, Hooks und Places, mit getesteten Recipes für Singletons, benutzerspezifische Einstellungen, Massenaktionen, Kalenderansichten, Dashboards und benutzerdefinierte Login-Bildschirme.
---

Der Admin besteht aus Teilen, die Sie selbst verwenden können. Um ihn anzupassen,
schreiben Sie eine gewöhnliche React-Komponente und platzieren sie an einem Ort.
Das ist das gesamte Modell:

- **Bausteine (Building blocks)**, die Sie rendern – die Tabelle einer Collection, das Formular eines einzelnen Datensatzes, das UI-Kit.
- **Hooks** für Daten, den angemeldeten Benutzer, Toasts und Navigation.
- **Places** zum Platzieren einer Komponente – eine Seite, ein Collection-Ansichtsmodus, eine Toolbar-Schaltfläche, ein Datensatz-Tab, ein Feld, ein Slot neben einem integrierten Teil oder ein Override, der einen solchen ersetzt.

Wenn ein Baustein nicht das tut, was Sie benötigen, kopieren Sie dessen Quellcode
in Ihr Projekt und passen Sie ihn an – siehe [Kopieren eines integrierten Teils](#copying-a-built-in-part).
Nichts davon setzt voraus, dass zuerst eine Konfigurationsoption existieren muss.

## Recipes

Funktionsfähige, getestete Beispiele werden in `@rebasepro/cms` mitgeliefert,
sodass die Beispiele in `node_modules/@rebasepro/cms/recipes` immer zu Ihrer
installierten Version passen. Sie importieren ausschließlich öffentliche Pakete:
Kopieren Sie einfach eines unverändert in Ihr Projekt.

| Recipe | Was es zeigt |
|---|---|
| `site-settings.tsx` | Ein Singleton: ein einzelner Einstellungsdatensatz auf einer eigenen Seite, der beim ersten Speichern erstellt wird. |
| `my-preferences.tsx` | Benutzerspezifische Einstellungen: Jeder Benutzer bearbeitet den Datensatz mit seiner UID als Schlüssel. |
| `bulk-set-status.tsx` | Eine Toolbar-Schaltfläche, die jede ausgewählte Zeile aktualisiert. |
| `calendar-view.tsx` | Ein neuer Ansichtsmodus: Die Zeilen einer Collection in einem Monatsraster. |
| `orders-dashboard.tsx` | Eine Seite, die Daten liest, ein Diagramm zeichnet und in den Admin verlinkt. |
| `custom-login.tsx` | Ersetzen des Login-Bildschirms. |

Die `README.md` daneben ist die vollständige Referenz für Bausteine, Hooks und Places.

## Beispiel: Ein Singleton

Ein Singleton ist kein spezieller Collection-Typ. Es ist eine gewöhnliche Tabelle,
deren Seite immer dieselbe Zeile öffnet. Wird `EntityFormPanel` eine ID übergeben,
bearbeitet es diesen Datensatz und erstellt ihn beim ersten Mal unter dieser ID,
sodass kein Seeding erforderlich ist.

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
            <EntityFormPanel collection={siteSettingsCollection} entityId={"site"}/>
        </Container>
    )
};
```

Die gleiche Struktur mit `entityId={user.uid}` (aus `useAuthController()`) ergibt
eine Seite für benutzerspezifische Einstellungen.

<span class="since-badge" data-since="0.29">Seit 0.29</span> Um nur einige der
Felder anzuzeigen, übergeben Sie `fields={["siteName"]}`. Um sie selbst anzuordnen,
übergeben Sie `layout` mit `<FormField name="…"/>` in Ihrem eigenen JSX. In beiden
Fällen validiert das Formular nur das, was es anzeigt – siehe
[Panels auf einer eigenen Seite](/docs/frontend/panels).

## Places

| Um … hinzuzufügen | Platzieren Sie eine Komponente in |
|---|---|
| Eine Seite | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Einen Ansichtsmodus für eine Collection | `collectionViews={[{ key, name, Builder }]}` und `admin.customViews: ["key"]` – siehe [View Modes](/docs/frontend/view-modes) |
| Eine Schaltfläche in der Toolbar einer Collection | `admin.Actions: [Component]` |
| Eine Schaltfläche für einen Datensatz | `admin.entityActions` – siehe [Entity Actions](/docs/frontend/entity-actions) |
| Einen Tab für einen Datensatz | `admin.entityViews` – siehe [Entity Views](/docs/frontend/entity-views) |
| Wie ein Feld bearbeitet oder dargestellt wird | `admin.Field` / `admin.Preview` – siehe [Custom Fields](/docs/frontend/custom-fields) |
| Etwas neben einem integrierten Teil | `<Rebase slots>` – siehe [Slots](/docs/frontend/slots) |
| Einen Ersatz für einen integrierten Teil | `<Rebase components>` – siehe [Component Overrides](/docs/frontend/component-overrides) |

## Was jeder Place an Ihre Komponente übergibt

| Place | Ihre Komponente erhält |
|---|---|
| Eine Seite (`views`) | Nichts: Lesen Sie das aus, was Sie benötigen, mithilfe der Hooks. Sie wird innerhalb des Admin-Routers gerendert, daher funktioniert `useUrlController().navigate(…)` (oder `react-router`). |
| Ein Ansichtsmodus-`Builder` | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (dessen `data` sind die Zeilen, die durch die Suche und Filter der Toolbar ausgewählt werden, `dataLoading`, …), `onEntityClick(entity)` zum Öffnen einer Zeile so, wie die Collection Zeilen öffnet, `selectionController`, `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `clearSelection()`), `tableController`, `openNewDocument(defaults?)`. Wandeln Sie `selection` mit `resolveSelection({ selection, accessor: useData().collection(path) })` in Zeilen um – dies kann für „jede Zeile, die dem Filter entspricht“ stehen, nicht nur für die angehakten. |
| `admin.entityViews` `Builder` | `EntityCustomViewParams`: `collection`, der Datensatz (`entity`, nicht vorhanden, während er erstellt wird), seine ungespeicherten Werte (`modifiedValues`) und das Formular (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Melden Sie sich mit `authController.emailPasswordLogin?.(email, password)` an (optional: vorhanden, wenn die E-Mail-Anmeldung aktiviert ist); ein Fehlschlag löst einen Fehler aus und befindet sich auch in `authController.authProviderError`. Sobald `authController.user` gesetzt ist, ersetzt der Admin Ihren Bildschirm automatisch. |
| Jeder andere Override | Die Props des Teils, den er ersetzt; bei `wrap: true` diese plus `OriginalComponent`. |

## Hooks

| Hook | Paket | Liefert Ihnen |
|---|---|---|
| `useData` | `@rebasepro/app` | `useData().collection("orders").find / findById / create / update / delete`, über den Server, sodass Callbacks und Sicherheitsregeln angewendet werden. |
| `useCollection` / `useFetch` | `@rebasepro/app` | Eine Live-Liste von Zeilen / ein einzelner Live-Datensatz. |
| `useAuthController` | `@rebasepro/app` | Der angemeldete `user` (UID, Rollen), An- und Abmeldung. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` für einen Toast. |
| `useSidePanel` | `@rebasepro/cms` | Beliebigen Datensatz im Seitenpanel öffnen. |
| `useUrlController` | `@rebasepro/cms` | Admin-URLs und Navigation. |
| `resolveSelection` | `@rebasepro/cms` | Eine Tabellenauswahl – angehakte Zeilen oder „alle übereinstimmenden“ – als Zeilen. |

## Kopieren eines integrierten Teils

Wenn ein integrierter Teil dem nahe kommt, was Sie benötigen, kopieren Sie dessen
Quellcode aus dem Repository `@rebasepro/cms` (oder `@rebasepro/app`) in Ihr Projekt,
passen Sie die relativen Imports auf die Pakete an, ändern Sie ihn und registrieren
Sie ihn unter seinem Namen in `<Rebase components>`. Alles, was ein Teil importiert,
ist ein öffentlicher Export, sodass die Kopie kompiliert – für jeden Teil mit
Ausnahme von dreien, und diese drei sind Absicht:

- **`Collection.View`** ist die Komposition aller Ansichtsmodi – Liste, Tabelle,
  Cards, Board, Split – mit Inline-Bearbeitung, dem Popup-Feld-Editor, dem
  Löschdialog und dem URL-Status des Ansichtsmodus. Was es importiert, sind die
  Interna dieser Modi. Ersetzen Sie stattdessen einen Teil davon (`Collection.Table`,
  `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, die sich alle
  kopieren lassen), fügen Sie einen eigenen [Ansichtsmodus](/docs/frontend/view-modes)
  hinzu oder wrappen Sie es mit `wrap: true`.
- **`DetailView`** ist die Komposition der Datensatzansicht: Identity-Leiste, Tabs,
  Inspector und die Schaltflächen der Split-Liste, rund um Tab-IDs, die URL-Werte sind.
  Passen Sie einen Datensatz mit [Entity Views](/docs/frontend/entity-views),
  [Entity Actions](/docs/frontend/entity-actions), den `form.*`-
  [Slots](/docs/frontend/slots) oder den Overrides `Entity.Form` und
  `EditView.FormActions` an, die sich kopieren lassen.
- **`HomePage`** lässt sich kopieren, mit Ausnahme der Drag-and-Drop-Neuordnung von
  Cards und Gruppen, für die es keine eigene zu exportierende API gibt. Eine eigene
  Startseite setzt sich aus `NavigationGroup`, `NavigationCardBinding` und
  `FavouritesView` über `useNavigationStateController().topLevelNavigation` zusammen;
  um die Standard-Startseite zu erweitern, verwenden Sie den Slot `home.cards`.
