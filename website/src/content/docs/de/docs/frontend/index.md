---
sourceHash: 03d03e9fa055a194
title: Frontend-Übersicht
sidebar_label: Frontend
description: Erstellen und anpassen Sie das Rebase-Admin-Panel mit React — Controller, Scaffold, Routing und Ansichten.
---

## Übersicht

Das Rebase-Frontend ist ein **React-Framework**, das Ihr Admin-Panel rendert. Es liest Ihre Sammlungsdefinitionen und generiert automatisch Tabellen, Formulare, Navigation und Routing.

Im Standard-Scaffold **ist** das Admin-Panel das Frontend: Es wird im Root Ihrer bereitgestellten URL ausgeliefert. Wenn Sie stattdessen Ihre eigene Produkt-App bauen, können Sie den Admin unter einem Präfix wie `/admin` in derselben Bereitstellung einbinden — siehe [Basis-URL ändern](/docs/getting-started/deployment#changing-the-base-url).

Die Schlüsselkomponenten, aus denen ein Rebase-Frontend besteht:

```tsx
<Rebase
    client={rebaseClient}
    collectionRegistryController={collectionRegistryController}
    urlController={urlController}
    navigationStateController={navigationStateController}
    authController={authController}
>
    {({ loading }) => (
        <Scaffold>
            <AppBar />
            <Drawer title="My App" />
            <Outlet />
            <SideDialogs />
        </Scaffold>
    )}
</Rebase>
```

## Der Rebase-Provider

`<Rebase>` ist der Root-Provider, der alle Rebase-Funktionalitäten für untergeordnete Komponenten über den Kontext verfügbar macht. Er akzeptiert:

| Prop | Beschreibung |
|------|-------------|
| `client` | `RebaseClient`-Instanz für Daten, Authentifizierung und Speicher |
| `collectionRegistryController` | Löst Sammlungspfade und -konfigurationen auf |
| `urlController` | Erstellt URLs und handhabt das Routing |
| `navigationStateController` | Verwaltet Navigationszustand, Ansichten und Plugins |
| `authController` | Authentifizierungszustand und -methoden |
| `storageSource` | Dateispeicheroperationen |
| `userConfigPersistence` | Lokale UI-Einstellungen (Spaltenbreiten usw.) |
| `entityViews` | Globale benutzerdefinierte Entitätsansichts-Tabs |
| `entityActions` | Globale Entitätsaktionen |
| `plugins` | Plugin-Instanzen (veraltete Prop – bevorzugt über Navigations-Controller übergeben) |

## Controller

Controller sind React-Hooks, die spezifische Aspekte des Frameworks konfigurieren:

### `useBuildNavigationStateController`

Der Haupt-Controller, der alles miteinander verbindet:

```typescript
const data = useData();

const navigationStateController = useBuildNavigationStateController({
    collections: () => [...collections],  // Collection definitions
    views: customViews,                   // Custom navigation views
    plugins,                              // Plugin instances
    authController,
    data,
    collectionRegistryController,
    urlController,
    adminMode: adminModeController.mode
});
```

### `useBuildCollectionRegistryController`

Verwaltet, wie Sammlungen aus URL-Pfaden aufgelöst werden:

```typescript
const collectionRegistryController = useBuildCollectionRegistryController({
    userConfigPersistence
});
```

### `useBuildUrlController`

Konfiguriert die URL-Generierung:

```typescript
const urlController = useBuildUrlController({
    basePath: "/",
    baseCollectionPath: "/c",
    collectionRegistryController
});
```

### `useBuildModeController`

Verwaltet das helle/dunkle Thema:

```typescript
const modeController = useBuildModeController();
// Provides: modeController.mode ("light" | "dark"), modeController.toggleMode()
```

### `useBuildAdminModeController`

Schaltet zwischen Studio- und Inhaltsmodi um:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("studio" | "content")
```

## Scaffold-Komponenten

| Komponente | Beschreibung |
|-----------|-------------|
| `<Scaffold>` | Haupt-Layout-Container mit responsiver Seitenleiste |
| `<AppBar>` | Obere Navigationsleiste mit Suche, Modus-Umschalter, Benutzermenü |
| `<Drawer>` | Seiten-Navigation mit Sammlungsliste und Ansichtslinks |
| `<SideDialogs>` | Container für Entitäts-Editoren im Seitenpanel |
| `<RebaseRoutes>` | Routen-Container, der mit React Router integriert ist |
| `<RebaseRoute>` | Handhabt Sammlungsrouten (`/c/*`) |
| `<ContentHomePage>` | Standard-Startseite mit Sammlungs-Karten |
| `<StudioHomePage>` | Studio-Modus-Startseite mit Entwicklertools |

## Benutzerdefinierte Ansichten

Fügen Sie übergeordnete Navigationsansichten für Dashboards, Tools oder benutzerdefinierte Seiten hinzu:

```tsx
const views: AppView[] = [
    {
        slug: "dashboard",
        name: "Dashboard",
        view: <MyDashboard />
    },
    {
        slug: "settings",
        name: "App Settings",
        view: <AppSettings />,
        nestedRoutes: true  // Support sub-paths,
        admin: {
            icon: "dashboard",
            group: "Analytics",
            icon: "settings"
        }
    }
];

```

## Styling

Rebase verwendet **Tailwind CSS v4** und unterstützt helle/dunkle Modi. Anpassung über:

- **CSS-Benutzereigenschaften** — Design-Tokens überschreiben
- **`ModeControllerProvider`** — Steuerung des hellen/dunklen Modus
- **Tailwind-Konfiguration** — Standard-Tailwind-Anpassung

```css
/* Override design tokens */
:root {
    --font-sans: "Inter", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

## Nächste Schritte

- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Erstellen Sie benutzerdefinierte Formularfelder
- **[Entitätsansichten](/docs/frontend/entity-views)** — Fügen Sie Tabs zu Entitäts-Editoren hinzu
- **[Ansichtsmodi](/docs/frontend/view-modes)** — Liste, Tabelle, Karten, Kanban
- **[Plugins](/docs/plugins)** — Erweitern Sie das Framework
---
