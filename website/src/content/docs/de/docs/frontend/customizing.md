---
sourceHash: fb65c481c6cbc87a
title: Admin anpassen
sidebar_label: Admin anpassen
description: So passen Sie den Rebase-Admin an – Bausteine, Hooks und Orte, mit getesteten Rezepten für Singletons, benutzerspezifische Einstellungen, Massenaktionen, Kalenderansichten, Dashboards und benutzerdefinierte Login-Masken.
---

Der Admin ist aus Bausteinen aufgebaut, die Sie selbst verwenden können. Um ihn anzupassen, schreiben Sie eine gewöhnliche React-Komponente und platzieren sie an der gewünschten Stelle. Das ist das gesamte Modell:

- **Bausteine**, die Sie rendern – die Tabelle einer Collection, das Formular eines Datensatzes, das UI-Kit.
- **Hooks** für Daten, den angemeldeten Benutzer, Toasts und Navigation.
- **Orte**, an denen eine Komponente platziert werden kann – eine Seite, ein Ansichtsmodus für eine Collection, eine Schaltfläche in der Toolbar, ein Datensatz-Tab, ein Feld, ein Slot neben einem integrierten Bestandteil oder ein Override, der einen solchen ersetzt.

Wenn ein Baustein nicht das tut, was Sie benötigen, kopieren Sie dessen Quellcode in Ihr Projekt und passen ihn an. Nichts davon erfordert, dass zuvor eine Konfigurationsoption existiert. Siehe [Einen eingebauten Teil kopieren](#einen-eingebauten-teil-kopieren).

## Rezepte

Funktionsfähige, getestete Beispiele sind direkt in `@rebasepro/cms` enthalten, sodass die Beispiele in `node_modules/@rebasepro/cms/recipes` immer zu Ihrer installierten Version passen. Sie importieren ausschließlich öffentliche Packages: Kopieren Sie einfach eines unverändert in Ihr Projekt.

| Rezept | Was es zeigt |
|---|---|
| `site-settings.tsx` | Ein Singleton: ein einzelner Einstellungsdatensatz auf einer eigenen Seite, der beim ersten Speichern erstellt wird. |
| `my-preferences.tsx` | Benutzerspezifische Einstellungen: Jeder Benutzer bearbeitet den Datensatz mit seiner UID als Schlüssel. |
| `bulk-set-status.tsx` | Eine Toolbar-Schaltfläche, die jede ausgewählte Zeile aktualisiert. |
| `calendar-view.tsx` | Ein neuer Ansichtsmodus: Zeilen einer Collection in einem Monatsraster. |
| `orders-dashboard.tsx` | Eine Seite, die Daten liest, ein Diagramm zeichnet und in den Admin verlinkt. |
| `custom-login.tsx` | Ersetzen des Anmeldebildschirms. |

Die `README.md` daneben ist die vollständige Referenz aller Bausteine, Hooks und Orte.

## Beispiel: ein Singleton

Ein Singleton ist kein spezieller Collection-Typ. Es ist eine gewöhnliche Tabelle, deren Seite immer dieselbe Zeile öffnet. Wird `EntityFormPanel` eine ID übergeben, bearbeitet es diesen Datensatz und erstellt ihn beim ersten Mal unter dieser ID, sodass kein Seeding erforderlich ist.

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

Dasselbe Schema mit `entityId={user.uid}` (aus `useAuthController()`) ergibt eine Seite für benutzerspezifische Einstellungen.

## Orte

| Um Folgendes hinzuzufügen… | Platzieren Sie eine Komponente in |
|---|---|
| Eine Seite | `<RebaseCMS views={[{ slug, name, icon, view }]}>` |
| Einen Ansichtsmodus für eine Collection | `collectionViews={[{ key, name, Builder }]}` und `admin.customViews: ["key"]` – siehe [View Modes](/docs/frontend/view-modes) |
| Eine Schaltfläche in der Toolbar einer Collection | `admin.Actions: [Component]` |
| Eine Schaltfläche bei einem Datensatz | `admin.entityActions` – siehe [Entity Actions](/docs/frontend/entity-actions) |
| Einen Tab bei einem Datensatz | `admin.entityViews` – siehe [Entity Views](/docs/frontend/entity-views) |
| Die Bearbeitung oder Anzeige eines Felds anpassen | `admin.Field` / `admin.Preview` – siehe [Custom Fields](/docs/frontend/custom-fields) |
| Ein Element neben einem integrierten Bestandteil | `<Rebase slots>` – siehe [Slots](/docs/frontend/slots) |
| Einen Ersatz für einen integrierten Bestandteil | `<Rebase components>` – siehe [Component Overrides](/docs/frontend/component-overrides) |

## Was jeder Ort Ihrer Komponente übergibt

| Ort | Ihre Komponente erhält |
|---|---|
| Eine Seite (`views`) | Nichts: Lesen Sie, was Sie brauchen, mit den Hooks. Sie wird im Router des Admins gerendert, daher funktioniert `useUrlController().navigate(…)` (oder `react-router`). |
| Ein Ansichtsmodus-`Builder` | `CollectionCustomViewParams`: `collection`, `path`, `tableController` (sein `data` sind die Zeilen, die Suche und Filter der Toolbar auswählen, `dataLoading`, …), `onEntityClick(entity)`, um eine Zeile so zu öffnen, wie die Collection Zeilen öffnet, `selectionController`, `emptyComponent`. |
| `admin.Actions` | `CollectionActionsProps`: `path`, `collection`, `selectionController` (`hasSelection`, `selection`, `clearSelection()`), `tableController`, `openNewDocument(defaults?)`. Wandeln Sie `selection` mit `resolveSelection({ selection, accessor: useData().collection(path) })` in Zeilen um – sie kann für „alle Zeilen, die dem Filter entsprechen“ stehen, nicht nur für die markierten. |
| `admin.entityViews`-`Builder` | `EntityCustomViewParams`: `collection`, den Datensatz (`entity`, fehlt, solange er erstellt wird), seine ungespeicherten Werte (`modifiedValues`) und das Formular (`formContext`). |
| `"Auth.LoginView"` | `{ authController }`. Melden Sie sich mit `authController.emailPasswordLogin?.(email, password)` an (optional: vorhanden, wenn die E-Mail-Anmeldung aktiviert ist); ein Fehler wird geworfen und steht auch in `authController.authProviderError`. Sobald `authController.user` gesetzt ist, ersetzt der Admin Ihren Bildschirm von selbst. |
| Jeder andere Override | Die Props des Teils, den er ersetzt; mit `wrap: true` zusätzlich `OriginalComponent`. |

## Hooks

| Hook | Package | Bietet Ihnen |
|---|---|---|
| `useData` | `@rebasepro/app` | `useData().collection("orders").find / findById / create / update / delete`, über den Server, sodass Callbacks und Sicherheitsregeln greifen. |
| `useCollection` / `useFetch` | `@rebasepro/app` | Eine Live-Liste von Zeilen / ein einzelner Live-Datensatz. |
| `useAuthController` | `@rebasepro/app` | Den angemeldeten `user` (uid, roles), Anmeldung und Abmeldung. |
| `useSnackbarController` | `@rebasepro/app` | `open({ type, message })` für einen Toast. |
| `useSidePanel` | `@rebasepro/cms` | Öffnet jeden beliebigen Datensatz im Seitenpanel. |
| `useUrlController` | `@rebasepro/cms` | Admin-URLs und Navigation. |
| `resolveSelection` | `@rebasepro/cms` | Eine Tabellenauswahl – markierte Zeilen oder „alle passenden“ – als Zeilen. |

## Einen eingebauten Teil kopieren

Wenn ein eingebauter Teil fast dem entspricht, was Sie wollen, kopieren Sie seinen Quellcode aus dem Repository von `@rebasepro/cms` (oder `@rebasepro/app`) in Ihr Projekt, richten seine relativen Importe auf die Pakete aus, ändern ihn und registrieren ihn unter seinem Namen in `<Rebase components>`. Alles, was ein Teil importiert, ist ein öffentlicher Export, daher kompiliert die Kopie – bei jedem Teil außer dreien, und diese drei sind Absicht:

- **`Collection.View`** setzt alle Ansichtsmodi zusammen – Liste, Tabelle, Karten, Board, Split – mit Inline-Bearbeitung, dem Popup-Feldeditor, dem Löschdialog und dem URL-Zustand des Ansichtsmodus. Was sie importiert, sind die Interna dieser Modi. Ersetzen Sie stattdessen einen ihrer Teile (`Collection.Table`, `Collection.Card`, `Collection.Actions`, `Collection.EmptyState`, die sich alle kopieren lassen), fügen Sie einen eigenen [Ansichtsmodus](/docs/frontend/view-modes) hinzu oder umschließen Sie sie mit `wrap: true`.
- **`DetailView`** setzt die Ansicht eines Datensatzes zusammen: Identitätsleiste, Tabs, Inspektor und die Schaltflächen der geteilten Liste, rund um Tab-IDs, die URL-Werte sind. Passen Sie einen Datensatz mit [Entity Views](/docs/frontend/entity-views), [Entity Actions](/docs/frontend/entity-actions), den `form.*`-[Slots](/docs/frontend/slots) oder den Overrides `Entity.Form` und `EditView.FormActions` an, die sich kopieren lassen.
- **`HomePage`** lässt sich kopieren, bis auf das Umsortieren von Karten und Gruppen per Drag-and-drop, das keine eigene API zum Exportieren hat. Eine eigene Startseite setzt `NavigationGroup`, `NavigationCardBinding` und `FavouritesView` über `useNavigationStateController().topLevelNavigation` zusammen; um der Standardseite etwas hinzuzufügen, verwenden Sie den Slot `home.cards`.
