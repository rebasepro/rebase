---
sourceHash: 6ad8431f3a96e286
title: Admin anpassen
sidebar_label: Admin anpassen
description: So passen Sie den Rebase-Admin an – Bausteine, Hooks und Orte, mit getesteten Rezepten für Singletons, benutzerspezifische Einstellungen, Bulk-Aktionen, Kalenderansichten, Dashboards und benutzerdefinierte Login-Bildschirme.
---

Der Admin ist aus Teilen aufgebaut, die Sie selbst verwenden können. Um ihn anzupassen,
schreiben Sie eine gewöhnliche React-Komponente und platzieren sie an einem Ort.
Das ist das gesamte Modell:

- **Bausteine**, die Sie rendern – die Tabelle einer Collection, das Formular eines einzelnen Datensatzes, das UI-Kit.
- **Hooks** für Daten, den angemeldeten Benutzer, Toasts und die Navigation.
- **Orte**, an denen Sie eine Komponente platzieren können – eine Seite, ein Collection-Ansichtsmodus, eine Toolbar-Schaltfläche, ein Datensatz-Tab, ein Feld, ein Slot neben einem integrierten Teil oder ein Override, der diesen ersetzt.

Wenn ein Baustein nicht das tut, was Sie benötigen, kopieren Sie dessen Quellcode
in Ihr Projekt und passen ihn an – siehe [Kopieren eines integrierten Teils](#kopieren-eines-integrierten-teils).
Nichts davon erfordert, dass zuvor eine Konfigurationsoption existiert.

## Rezepte

Funktionsfähige, getestete Beispiele sind in `@rebasepro/cms` enthalten, sodass die
Beispiele in `node_modules/@rebasepro/cms/recipes` immer genau zu Ihrer installierten
Version passen. Sie importieren ausschließlich öffentliche Packages: Kopieren Sie
sie einfach unverändert in Ihr Projekt.

| Rezept | Was es zeigt |
|---|---|
| `site-settings.tsx` | Ein Singleton: ein einzelner Einstellungsdatensatz auf einer eigenen Seite, der beim ersten Speichern erstellt wird. |
| `my-preferences.tsx` | Benutzerspezifische Einstellungen: Jeder Benutzer bearbeitet den Datensatz, der über seine uid bestimmt wird. |
| `bulk-set-status.tsx` | Eine Toolbar-Schaltfläche, die jede ausgewählte Zeile aktualisiert. |
| `calendar-view.tsx` | Ein neuer Ansichtsmodus: die Zeilen einer Collection in einem Monatsraster. |
| `orders-dashboard.tsx` | Eine Seite, die Daten liest, ein Diagramm zeichnet und in den Admin verlinkt. |
| `custom-login.tsx` | Ersetzen des Login-Bildschirms. |

Die danebenliegende `README.md` ist die vollständige Referenz für Bausteine, Hooks und Orte.

## Beispiel: ein Singleton

Ein Singleton ist kein spezieller Collection-Typ. Es handelt sich um eine gewöhnliche
Tabelle, deren Seite immer dieselbe Zeile öffnet. Wird `EntityFormPanel` eine ID
übergeben, bearbeitet es diesen Datensatz und erstellt ihn beim ersten Mal unter
dieser ID – ein Seeding ist daher nicht erforderlich.

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

Dasselbe Schema mit `id={user.uid}` (von `useAuthController()`) dient als
benutzerspezifische Einstellungsseite.

<span class="since-badge" data-since="0.29">Seit 0.29</span> Um nur einige der
Felder anzuzeigen, übergeben Sie `fields={["siteName"]}`. Um sie selbst anzuordnen,
übergeben Sie `layout` mit `<FormField name="…"/>` in Ihrem eigenen JSX. In beiden
Fällen validiert das Formular nur das, was es anzeigt – siehe
[Panels auf einer eigenen Seite](/docs/frontend/panels).

## Orte

| Um Folgendes hinzuzufügen … | Platzieren Sie eine Komponente in |
|---|---|
| Eine Seite | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Einen Ansichtsmodus für eine Collection | `collectionViews={[{ key, name, Builder }]}` und `admin.customViews: ["key"]` – siehe [View Modes](/docs/frontend/view-modes) |
| Eine Schaltfläche in der Toolbar einer Collection | `admin.Actions: [Component]` |
| Eine Schaltfläche für einen Datensatz | `admin.entityActions` – siehe [Entity Actions](/docs/frontend/entity-actions) |
| Einen Tab für einen Datensatz | `admin.entityViews` – siehe [Entity Views](/docs/frontend/entity-views) |
| Wie ein Feld bearbeitet oder angezeigt wird | `admin.Field` / `admin.Preview` – siehe [Custom Fields](/docs/frontend/custom-fields) |
| Etwas neben einem integrierten Teil | `<Rebase slots>` – siehe [Slots](/docs/frontend/slots) |
| Einen Ersatz für einen integrierten Teil | `<Rebase components>` – siehe [Component Overrides](/docs/frontend/component-overrides) |

## Was jeder Ort an Ihre Komponente übergibt

| Ort | Ihre Komponente empfängt |
|---|---|
| Eine Seite (`views`) | Nichts: Lesen Sie das, was Sie benötigen, über die Hooks aus. Sie wird innerhalb des Admin-Routers gerendert, sodass `useUrlController().navigate(…)` (oder `react-router`) funktioniert. |
| Ein Ansichtsmodus-`Builder` | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (dessen `rows` die Zeilen sind, die durch die Suche und Filter der Toolbar ausgewählt werden, so wie der Server sie sendet; `loading`, `error`, …), `onRowClick(row)`, um eine Zeile so zu öffnen, wie die Collection Zeilen öffnet, `selectionController`, `highlightedIds` (IDs als Strings), `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `isSelected(id)`, `clearSelection()`), `tableController` (`rows` und deren `ids`), `openNewDocument(defaults?)`, `context`. Wandeln Sie `selection` mit `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })` in Zeilen und deren IDs um – dies kann für „jede Zeile, die dem Filter entspricht“ stehen, nicht nur für die angehakten. |
| `admin.entityViews` `Builder` | `EntityCustomViewParams`: `collection`, der gespeicherte Datensatz (`row`) und dessen ID (`id`), beide nicht vorhanden, während er erstellt wird, seine ungespeicherten Werte (`modifiedValues`) und das Formular (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Anmeldung mit `authController.emailPasswordLogin?.(email, password)` (optional: vorhanden, wenn die E-Mail-Anmeldung aktiviert ist); ein Fehler löst eine Exception aus und ist auch unter `authController.authProviderError` verfügbar. Sobald `authController.user` gesetzt ist, ersetzt der Admin Ihren Bildschirm automatisch. |
| Jeder andere Override | Die Props des Teils, den er ersetzt; bei `wrap: true` diese zusätzlich zu `OriginalComponent`. |

## Hooks

| Hook | Package | Bietet Ihnen |
|---|---|---|
| `useRows` / `useRow` | `@rebasepro/app` | Eine Live-Liste von Zeilen / eine einzelne Live-Zeile, wie vom Server gesendet. |
| `useRowWrites` | `@rebasepro/app` | `create / update / remove` über den Server, sodass Callbacks und Sicherheitsregeln angewendet werden. |
| `useRebaseContext` | `@rebasepro/app` | `context.data.collection("orders").find / findById / create / update / delete`, für Code außerhalb des React-State; dieselben Zeilen und Schreiboperationen, die dieselben Callbacks ausführen. |
| `useAuthController` | `@rebasepro/app` | Der angemeldete Benutzer (`user`, uid, Rollen), Anmeldung und Abmeldung. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` für einen Toast. |
| `useSidePanel` | `@rebasepro/cms` | Beliebigen Datensatz im Seitenpanel öffnen. |
| `useUrlController` | `@rebasepro/cms` | Admin-URLs und Navigation. |
| `resolveSelection` | `@rebasepro/cms` | Eine Tabellenauswahl – angehakte Zeilen oder „alle passenden“ – als Zeilen und deren IDs: `const { rows, ids } = await resolveSelection({ selection, data: context.data, collection })`. |

## Kopieren eines integrierten Teils

Wenn ein integrierter Teil dem nahekommt, was Sie möchten, kopieren Sie dessen
Quellcode aus dem Repository `@rebasepro/cms` (oder `@rebasepro/app`) in Ihr Projekt,
passen Sie dessen relative Imports so an, dass sie auf die Packages verweisen,
ändern Sie ihn und registrieren Sie ihn unter seinem Namen in `<Rebase components>`.
Alles, was ein Teil importiert, ist ein öffentlicher Export, sodass die Kopie
kompiliert – für jeden Teil mit Ausnahme von dreien, und diese drei Ausnahmen sind
beabsichtigt:

- **`Collection.View`** ist die Komposition aller Ansichtsmodi – Liste, Tabelle,
  Karten, Board, Split – mit Inline-Bearbeitung, dem Popup-Feld-Editor, dem
  Löschdialog und dem URL-Status des Ansichtsmodus. Was es importiert, sind die
  Interna dieser Modi. Ersetzen Sie stattdessen einen Teil davon (`Collection.Table`,
  `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, die sich alle
  kopieren lassen), fügen Sie einen eigenen [Ansichtsmodus](/docs/frontend/view-modes)
  hinzu oder wrappen Sie es mit `wrap: true`.
- **`DetailView`** ist die Komposition der Datensatzansicht: Identitätsleiste, Tabs,
  Inspector und die Schaltflächen der geteilten Liste, aufgebaut um Tab-IDs, die
  URL-Werte darstellen. Passen Sie einen Datensatz mit [Entity Views](/docs/frontend/entity-views),
  [Entity Actions](/docs/frontend/entity-actions), den `form.*`-[Slots](/docs/frontend/slots)
  oder den Overrides `Entity.Form` und `EditView.FormActions` an, welche sich kopieren lassen.
- **`HomePage`** lässt sich kopieren, mit Ausnahme der Drag-and-Drop-Neuordnung von
  Karten und Gruppen, für die es keine eigene zu exportierende API gibt. Eine eigene
  Startseite setzt sich aus `NavigationGroup`, `NavigationCardBinding` und
  `FavouritesView` über `useNavigationStateController().topLevelNavigation` zusammen;
  um die Standardseite zu erweitern, verwenden Sie den Slot `home.cards`.
