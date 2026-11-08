---
sourceHash: 0b034023f28eb28f
title: Frontend-Übersicht
sidebar_label: Frontend
description: "Erstellen und passen Sie das Panel an – Rebase CMS und Rebase Studio – mit React: Controller, Scaffold, Routing und Views."
---

## Übersicht

Das Rebase-Frontend ist ein **React-Framework**, das Ihr Admin-Panel rendert. Es liest Ihre Collection-Definitionen und generiert Tabellen, Formulare, Navigation und Routing automatisch.

Im Standard-Scaffold **ist** das Admin-Panel das Frontend: Es wird am Root Ihrer bereitgestellten URL ausgeliefert. Wenn Sie stattdessen eine eigene Produkt-App erstellen, können Sie das Admin-Panel unter einem Präfix wie `/admin` im selben Deployment mounten – siehe [Basis-URL ändern](/docs/getting-started/deployment#changing-the-base-url).

Dies ist `frontend/src/App.tsx`, wie `rebase init` es generiert, ohne seine Schriftarten-Imports, Error-Boundary und Google Client ID – das gesamte Admin-Panel, vier Deklarationen innerhalb eines Providers:

```tsx
import React from "react";
import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    auth: { authFlowMode: "cookie" }
});

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            {/* Sign-in screen. Pass `loginView` to replace it. */}
            <RebaseAuth/>
            <RebaseCMS collections={collections}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Die ersten drei rendern nichts: Sie *registrieren* Konfiguration im Provider. `<RebaseShell>` ist das, was zeichnet – es liest diese Registry aus und erstellt daraus Navigation, Routen und Layout. Die Reihenfolge, in der sie erscheinen, spielt also keine Rolle, und das Hinzufügen einer Funktion bedeutet das Hinzufügen einer Komponente, nicht das Neuverdrahten eines Komponentenbaums.

| Komponente | Paket | Registriert |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | den Anmeldebildschirm (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | Collections, benutzerdefinierte Views, die Startseite, den Collection-Editor |
| `<RebaseStudio>` | `@rebasepro/studio` | die Entwickler-Tools (SQL, RLS, Logs, Backups…) |
| `<RebaseShell>` | `@rebasepro/cms` | nichts – rendert das Admin-Panel aus allem oben Genannten |

Entfernen Sie `<RebaseStudio>`, und Sie haben ein reines Content-CMS; entfernen Sie `<RebaseCMS>`, und Sie haben nur die Entwickler-Tools. Um die Shell stattdessen manuell zu layouten, siehe [Erweitert: Manuelles Layout](#erweitert-manuelles-layout).

## Der Rebase-Provider

`<Rebase>` ist der Root-Provider, der alle Rebase-Funktionen für untergeordnete Komponenten über den Context verfügbar macht. Er akzeptiert:

Alle dreiundzwanzig Props vollständig – die Tabelle enthielt früher nur zehn, und zwei davon waren Props, die die Komponente nie gelesen hat:

<!-- rebase-props:start -->
| Prop | Beschreibung |
|------|-------------|
| `children` | Die Root-Komponenten des Admins – `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Eine Render-Funktion dient als Escape-Hatch für manuelles Layout. |
| `apiUrl` | Basis-URL der Backend-API, die jedem Hook über `useApiConfig()` zur Verfügung gestellt wird |
| `dateTimeFormat` | Wie Datumsangaben ausgegeben werden. Standardmäßig `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Standardsprache des Admins und das Locale, in dem Datumsangaben formatiert werden – siehe [Übersetzungen](/docs/frontend/i18n) |
| `client` | `RebaseClient`-Instanz: die Standardquelle für Daten, Auth und Storage |
| `dataSources` | Zusätzliche Datenquellen für Collections, die eine solche angeben – siehe [Mehrere Datenquellen](/docs/backend/multiple-sources) |
| `authController` | Authentifizierungsstatus und -methoden. Ersetzt das `client.auth`-Abonnement vollständig |
| `storageSource` | Die Standard-Storage-Quelle, die `client.storage` überschreibt |
| `storageSources` | Benannte Storage-Quellen über den Standard hinaus |
| `databaseAdmin` | Administrative Datenbankoperationen (SQL, Schema-Discovery). Wird nur von Studio benötigt |
| `userConfigPersistence` | Lokale UI-Einstellungen – Spaltenbreiten, eingeklappte Gruppen |
| `onAnalyticsEvent` | Wird für jedes vom Admin ausgelöste Analytics-Event aufgerufen |
| `entityLinkBuilder` | `({ row, id, path }) => string`: Die URL für den Button „In Ihrer App öffnen“ eines Datensatzes, basierend auf dem Datensatz, wie der Server die Zeile sendet |
| `plugins` | Plugin-Instanzen – siehe [Plugins](/docs/plugins) |
| `slots` | Direkt deklarierte Slot-Beiträge, ohne Plugin |
| `propertyConfigs` | Benutzerdefinierte Feld-Widgets, zugeordnet über den Namen, den eine Property in `propertyConfig` angibt |
| `entityViews` | Benutzerdefinierte Entity-View-Tabs, verfügbar für jede Collection, die deren `key` in `admin.entityViews` angibt |
| `collectionViews` | Benutzerdefinierte Collection-View-Modi, verfügbar für jede Collection über `key` |
| `entityActions` | Entity-Aktionen, verfügbar für jede Collection, die deren `key` in `admin.entityActions` angibt |
| `effectiveRoleController` | Simuliert eine andere Rolle, während der Dev-Modus aktiv ist |
| `modeController` | Übergibt Rebase den Light-/Dark-Modus der Host-App; Rebase fasst dann niemals `<html>`, `prefers-color-scheme` oder localStorage an – siehe [Styling](#styling) |
| `translations` | Überschreibt oder erweitert UI-Strings, zugeordnet nach Locale – siehe [Übersetzungen](/docs/frontend/i18n) |
| `components` | Ersetzt integrierte Komponenten – siehe [Komponenten-Overrides](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Die Controller für Navigation, URL und Collection-Registry sind **keine** Props von `<Rebase>` – sie werden von den unten aufgeführten Hooks erstellt und innerhalb des Admin-Baums konsumiert (`<RebaseShell>` verdrahtet sie im Standard-Scaffold automatisch für Sie).

Das Gleiche gilt für das URL-Präfix. Wenn das Admin-Panel unter einem Pfad gemountet wird, gehört dies zu `<RebaseCMS basePath="/admin">`, welches URLs zu Collections auflöst – und das auch nur, wenn der Router kein eigenes `basename` hat. Siehe [Basis-URL ändern](/docs/getting-started/deployment#changing-the-base-url).

## Eine einheitliche Datenstruktur

<span class="since-badge" data-since="0.29">Seit 0.29</span>
Ihr Code erhält Zeilen (Rows) so, wie der Server sie sendet, egal wo sie angefragt werden: `client.data`, `context.data` (in einem Backend-Callback ebenso wie im Browser), `useRows`, `useRow` und `useRowWrites`, das `data`-Objekt der Collection- und View-Builder sowie das, was den `browserCallbacks` einer Collection übergeben wird. Eine Zeile ist ein flaches Objekt: `row.title`, ein Datum als ISO-String, eine BelongsTo-Beziehung als Fremdschlüssel-Spalte.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

Das Admin-Panel selbst rendert ein `Entity`-View-Model – den `id` / `path` / `values`-Wrapper, aus dem seine Collection-Views und -Formulare schöpfen, mit Datumsangaben als `Date`-Objekten und Beziehungen als `EntityRelation`. Diese Schicht ist dem Admin eigen und nicht Teil der öffentlichen Schnittstelle: Einer Entity-Aktion, einem Display-Resolver, dem `tableController.rows` eines View-Mode-`Builder`s, der Selektion einer Collection-Aktion und einem Slot werden allen Zeilen übergeben, mit der ID jedes Datensatzes neben seiner Zeile. Sie begegnen `Entity` nur in einer Kopie eines der admin-eigenen Teile (`Collection.Table`, einer Karte), der der Datensatz so übergeben wird, wie der Admin ihn zeichnet. Die Werte eines Formulars sind die des Editors: `Date`-Objekte und Relationen, so wie ein Feld sie bearbeitet.

## Eine Collection oder ein einzelner Datensatz auf einer eigenen Seite

Sie benötigen nicht das gesamte Admin-Panel, um eine einzelne Tabelle anzuzeigen. `<CollectionPanel>`, `<EntityFormPanel>`, `<EntityViewPanel>` und `<FieldValue>` funktionieren überall unter `<Rebase>` und einem React-Router-Router, ganz ohne `<RebaseCMS>`, `<RebaseNavigation>` oder `<RebaseShell>`: eine Collection mit den Spalten und der Toolbar Ihrer Wahl, das Formular eines einzelnen Datensatzes mit nur ausgewählten Feldern oder Ihrem eigenen Layout, ein schreibgeschützter Datensatz oder ein einzelner Wert gerendert so, wie der Admin ihn zeichnet. Siehe [Panels auf einer eigenen Seite](/docs/frontend/panels).

## Erweitert: Manuelles Layout

Alles Folgende ersetzt `<RebaseShell>`. Sie benötigen dies nur, wenn das Standard-Layout im Weg ist – ein anderes Chrome (Rahmen) um den Admin, ein eigener Routenbaum, eine App, in der das Admin-Panel nur eine Seite unter vielen ist. Wenn Sie das Layout nicht ersetzen möchten, können Sie direkt bei [Benutzerdefinierte Views](#benutzerdefinierte-views) weiterlesen.

`<RebaseShell>` ist syntaktischer Zucker für vier Schichten, und Sie können diese einzeln nutzen:

```tsx
<Rebase client={client} authController={authController}>
    <RebaseCMS collections={collections}/>
    <RebaseStudio/>

    {/* login screen until there is a user */}
    <RebaseAuthGate>
        {/* builds the navigation, URL and collection-registry controllers */}
        <RebaseNavigation>
            {/* the admin's routes, drawn inside the layout you pass */}
            <RebaseRouteDefs layout={<RebaseLayout title="My App"/>}/>
        </RebaseNavigation>
    </RebaseAuthGate>
</Rebase>
```

Die Reihenfolge ist fest vorgegeben: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` zeigt die Login-Ansicht an, bis ein Benutzer vorhanden ist, sodass für abgemeldete Besucher nichts darunter gerendert wird; `RebaseNavigation` erstellt die Controller für Navigation, URL und Collection-Registry, die von `RebaseRouteDefs` und jeder Collection-View gelesen werden, weshalb `RebaseRouteDefs` außerhalb davon einen Fehler wirft. Um eine Collection-View oder ein Datensatzformular in eine eigene Seite ohne die Routen des Admins einzubetten, erstellt der schlankere `CollectionsProvider` stattdessen diese Controller – siehe [Panels auf einer eigenen Seite](/docs/frontend/panels).

Jede Schicht kann für sich allein verwendet werden. `<RebaseAuthGate>` allein schützt Ihre eigene App hinter dem Login von Rebase. Tauschen Sie `<RebaseLayout>` gegen Ihre eigene Komponente aus, um das Routing beizubehalten und das Chrome zu entfernen; lassen Sie auch `<RebaseRouteDefs>` weg, und Sie bauen die Routen selbst aus den Komponenten in [Scaffold-Komponenten](#scaffold-komponenten) auf.

Darunter akzeptiert `<Rebase>` anstelle von Children auch eine **Render-Prop**, die Ihnen den Context und das Loading-Flag übergibt und den gesamten Baum Ihnen überlässt:

```tsx
<Rebase client={rebaseClient} authController={authController}>
    {({ context, loading }) => (
        <Scaffold>
            <AppBar/>
            <Drawer title="My App"/>
            <Outlet/>
            <SideDialogs/>
        </Scaffold>
    )}
</Rebase>
```

An diesem Punkt ist nichts mehr automatisch für Sie verdrahtet: Sie erstellen die folgenden Controller von Hand und rendern die Routen selbst.

### Controller

Controller sind React-Hooks, die bestimmte Aspekte des Frameworks konfigurieren. `<RebaseNavigation>` ruft alle davon automatisch für Sie auf – greifen Sie nur innerhalb einer Render-Prop direkt darauf zu.

#### `useBuildNavigationStateController`

Der Haupt-Controller, der alles miteinander verdrahtet:

Sein `data`-Wert ist das, was den Collection- und View-Buildern übergeben wird: das flache `context.data` des umschließenden `<Rebase>` (siehe [Eine einheitliche Datenstruktur](#eine-einheitliche-datenstruktur)). Dieser Hook muss daher innerhalb des `<Rebase>`-Baums aufgerufen werden.

```typescript
const { data } = useRebaseContext();

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

#### `useBuildCollectionRegistryController`

Verwaltet, wie Collections aus URL-Pfaden aufgelöst werden:

```typescript
const collectionRegistryController = useBuildCollectionRegistryController({
    userConfigPersistence
});
```

#### `useBuildUrlController`

Konfiguriert die URL-Generierung:

```typescript
const urlController = useBuildUrlController({
    basePath: "/",
    baseCollectionPath: "/c",
    collectionRegistryController
});
```

#### `useBuildModeController`

Verwaltet das Light-/Dark-Theme. Solange es aktiviert ist, steuert es das Theme der Seite: Es setzt die `dark`-Klasse auf `<html>`, folgt `prefers-color-scheme`, bis der Benutzer einen Modus wählt, und speichert diese Auswahl im localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` erstellt selbst eine Instanz davon.

Wenn die Komponente, die ihn verwendet, unmountet wird, entfernt sie die hinzugefügte `dark`-Klasse; eine `dark`-Klasse, die die Seite bereits hatte, bleibt bestehen. Erstellen Sie Ihren eigenen Controller oberhalb von `<Rebase>` nur dann, wenn auch Komponenten außerhalb den Modus benötigen, und übergeben Sie ihn über die [`modeController`-Prop](#styling), damit es nur einen Controller gibt und nicht zwei. `useBuildModeController({ enabled: false })` erstellt einen inerten Controller: Er hält `mode` im React-State und fasst weder Klassen, Media-Queries noch localStorage an. Wenn Ihre App das Theme bereits selbst verwaltet, benötigen Sie diesen Hook überhaupt nicht: Übergeben Sie einfach Ihren eigenen Controller als `modeController`.

#### `useBuildAdminModeController`

Schaltet zwischen Studio- und Content-Modus um:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Scaffold-Komponenten

| Komponente | Beschreibung |
|-----------|-------------|
| `<Scaffold>` | Haupt-Layout-Container mit responsiver Seitenleiste |
| `<AppBar>` | Obere Navigationsleiste mit Suche, Modus-Umschalter, Benutzermenü |
| `<Drawer>` | Seitennavigation mit Collection-Liste und View-Links |
| `<SideDialogs>` | Container für Entity-Editoren im Seitenpanel |
| `<RebaseRoutes>` | Routen-Container, der sich in React Router integriert |
| `<RebaseRoute>` | Verarbeitet Collection-Routen (`/c/*`) |
| `<ContentHomePage>` | Standard-Startseite mit Collection-Karten |
| `<StudioHomePage>` | Startseite des Studio-Modus mit Entwickler-Tools |

## Benutzerdefinierte Views

Fügen Sie Navigation-Views auf oberster Ebene für Dashboards, Tools oder benutzerdefinierte Seiten hinzu. Ein `AppView` ist ein flaches Objekt – alles Nachfolgende befindet sich auf der obersten Ebene, es gibt keinen verschachtelten `admin`-Block:

```tsx
import type { AppView } from "@rebasepro/cms-types";

const views: AppView[] = [
    {
        slug: "dashboard",
        name: "Dashboard",
        icon: "LayoutDashboard",
        view: <MyDashboard/>
    },
    {
        slug: "settings",
        name: "App Settings",
        icon: "Settings",
        group: "Admin",
        // Register `settings/*` too, so the view can route inside itself.
        nestedRoutes: true,
        // Reachable by URL, but not listed in the drawer.
        hideFromNavigation: true,
        view: <AppSettings/>
    }
];
```

Übergeben Sie diese an `<RebaseCMS>`, neben Ihren Collections – dies ist die Komponente, die die Navigation registriert:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Feld | |
|---|---|
| `slug` | der Pfad, unter dem die View unterhalb des Admin-Roots erreichbar ist |
| `name` | die Beschriftung im Drawer und auf der Startseite |
| `view` | das zu rendernde Element oder ein `ComponentType`, um es lazy zu rendern |
| `icon` | ein [Lucide](https://lucide.dev/icons/)-Icon-Name, z. B. `"ShoppingCart"` – oder ein beliebiger Node |
| `group` | gruppiert Views im Drawer; `"Admin"` und `"Settings"` rutschen nach ganz unten |
| `pinToBottom` | platziert die Gruppe unter beliebigem Namen ganz unten – den beiden magischen Strings vorzuziehen |
| `nestedRoutes` | registriert auch `slug/*`, für eine View mit eigenen Routen |
| `hideFromNavigation` | behält die Route bei, entfernt den Navigationseintrag |
| `roles` | nur Benutzer mit einer dieser Rollen sehen die View oder können darauf zugreifen |
| `description` | Markdown, wird auf der Startseiten-Karte angezeigt |

Um eine View unter **Studio** statt unter dem CMS zu platzieren, übergeben Sie sie an [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styling

Rebase verwendet **Tailwind CSS v4** und unterstützt Light-/Dark-Modi. Anpassbar über:

- **CSS Custom Properties** – Design-Tokens überschreiben
- **`<Rebase modeController>`** – Rebase den Light-/Dark-Modus Ihrer App übergeben
- **Tailwind-Konfiguration** – Standardmäßige Tailwind-Anpassung

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

### Light- und Dark-Modus

Standardmäßig verwaltet `<Rebase>` das Theme der Seite: Es setzt die `dark`-Klasse auf `<html>`, folgt `prefers-color-scheme`, bis der Benutzer im Admin einen Modus auswählt, und speichert diese Auswahl im localStorage.

Wenn `<Rebase>` unmountet wird, entfernt es die hinzugefügte `dark`-Klasse; eine Klasse, die die Seite bereits hatte, bleibt bestehen. In Version 0.24 bleibt die Klasse zurück.

Wenn Ihre App bereits über ein Theme verfügt, übergeben Sie dieses als `modeController`. Rebase liest `mode` daraus aus, ruft dessen `setMode` über seinen eigenen Theme-Umschalter auf und fasst niemals `<html>`, `prefers-color-scheme` oder localStorage an:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Rebase, type ModeController } from "@rebasepro/app";

export function App() {
    const [mode, setMode] = useState<"light" | "dark">("light");
    const modeController = useMemo<ModeController>(() => ({
        mode,
        setMode: (next) => setMode(next === "dark" ? "dark" : "light")
    }), [mode]);

    // Your app applies the mode, as it does for the rest of the page.
    useEffect(() => {
        document.documentElement.classList.toggle("dark", mode === "dark");
    }, [mode]);

    return (
        <Rebase client={client} modeController={modeController}>
            <MyAdmin/>
        </Rebase>
    );
}
```

Das CSS des Scaffolds stylt den Dark-Modus unter jedem Element mit der `dark`-Klasse (`@custom-variant dark (&:where(.dark, .dark *))`). Seiten-Panels, Dialoge und Menüs rendern in einem Portal auf `<body>`. Platzieren Sie die Klasse daher auf `<html>` oder `<body>` anstatt auf einem Wrapper um `<Rebase>`.

Das Einschließen von `<Rebase>` in einen `ModeControllerProvider` bewirkt dies nicht: `<Rebase>` stellt intern einen eigenen Controller bereit. In Version 0.24 existiert die Prop nicht, und es gibt keine Möglichkeit, Rebase den Modus Ihrer App zu übergeben.

## Nächste Schritte

- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Erstellen Sie benutzerdefinierte Formularfelder
- **[Entity-Views](/docs/frontend/entity-views)** — Fügen Sie Tabs zu Entity-Editoren hinzu
- **[View-Modi](/docs/frontend/view-modes)** — Liste, Tabelle, Karten, Kanban
- **[Übersetzungen](/docs/frontend/i18n)** — Ändern Sie beliebige Texte oder fügen Sie eine Sprache hinzu
- **[Plugins](/docs/plugins)** — Erweitern Sie das Framework
