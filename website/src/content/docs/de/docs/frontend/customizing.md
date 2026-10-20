---
sourceHash: cfdbc982479ba3b1
title: Admin anpassen
sidebar_label: Admin anpassen
description: So passen Sie den Rebase-Admin an – Bausteine, Hooks und Orte, mit getesteten Rezepten für Singletons, benutzerspezifische Einstellungen, Massenaktionen, Kalenderansichten, Dashboards und benutzerdefinierte Login-Masken.
---

Der Admin ist aus Bausteinen aufgebaut, die Sie selbst verwenden können. Um ihn anzupassen, schreiben Sie eine gewöhnliche React-Komponente und platzieren sie an der gewünschten Stelle. Das ist das gesamte Modell:

- **Bausteine**, die Sie rendern – die Tabelle einer Collection, das Formular eines Datensatzes, das UI-Kit.
- **Hooks** für Daten, den angemeldeten Benutzer, Toasts und Navigation.
- **Orte**, an denen eine Komponente platziert werden kann – eine Seite, ein Ansichtsmodus für eine Collection, eine Schaltfläche in der Toolbar, ein Datensatz-Tab, ein Feld, ein Slot neben einem integrierten Bestandteil oder ein Override, der einen solchen ersetzt.

Wenn ein Baustein nicht das tut, was Sie benötigen, kopieren Sie dessen Quellcode in Ihr Projekt und passen ihn an. Nichts davon erfordert, dass zuvor eine Konfigurationsoption existiert.

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
