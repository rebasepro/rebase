---
sourceHash: 648bcb814d96b084
title: Frontend-Übersicht
sidebar_label: Frontend
description: "Erstellen und passen Sie das Panel an – Rebase CMS und Rebase Studio – mit React: Controller, Scaffold, Routing und Ansichten."
---

## Übersicht

Das Rebase-Frontend ist ein **React-Framework**, das Ihr Admin-Panel rendert. Es liest Ihre Collection-Definitionen aus und generiert automatisch Tabellen, Formulare, Navigation und Routing.

Im Standard-Scaffold **ist** das Admin-Panel das Frontend: Es wird im Root Ihrer bereitgestellten URL ausgeliefert. Wenn Sie stattdessen Ihre eigene Produkt-App erstellen, können Sie das Admin-Panel unter einem Präfix wie `/admin` im selben Deployment mounten – siehe [Ändern der Basis-URL](/docs/getting-started/deployment#changing-the-base-url).

Dies ist `frontend/src/App.tsx`, wie es von `rebase init` generiert wird, ohne Schriftarten-Imports, Error Boundary und Google Client-ID – das gesamte Admin-Panel, vier Deklarationen innerhalb eines Providers:

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

Die ersten drei rendern nichts: Sie *registrieren* Konfigurationen im Provider. `<RebaseShell>` ist das, was tatsächlich zeichnet – es liest diese Registrierung aus und baut daraus die Navigation, Routen und das Layout auf. Die Reihenfolge, in der sie erscheinen, spielt daher keine Rolle, und das Hinzufügen einer Funktion bedeutet das Hinzufügen einer Komponente, nicht das Umstrukturieren eines Komponentenbaums.

| Komponente | Paket | Registriert |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | den Anmeldebildschirm (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | Collections, benutzerdefinierte Ansichten, die Startseite, den Collection-Editor |
| `<RebaseStudio>` | `@rebasepro/studio` | die Entwickler-Tools (SQL, RLS, Logs, Backups …) |
| `<RebaseShell>` | `@rebasepro/cms` | nichts – rendert das Admin-Panel aus allem oben Genannten |

Entfernen Sie `<RebaseStudio>` und Sie erhalten ein reines Content-CMS; entfernen Sie `<RebaseCMS>` und Sie erhalten ausschließlich die Entwickler-Tools. Wie Sie die Shell stattdessen manuell aufbauen, erfahren Sie unter [Fortgeschritten: Manuelles Layout](#fortgeschritten-manuelles-layout).

## Der Rebase-Provider

`<Rebase>` ist der Root-Provider, der alle Rebase-Funktionalitäten für untergeordnete Komponenten über den React-Context bereitstellt. Er akzeptiert:

Alle dreiundzwanzig Props vollständig – die Tabelle listete früher zehn auf, von denen zwei Props waren, die die Komponente nie ausgewertet hat:

<!-- rebase-props:start -->
| Prop | Beschreibung |
|------|-------------|
| `children` | Die Root-Komponenten des Admin-Panels – `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Eine Render-Funktion dient als Ausweichmöglichkeit für ein manuelles Layout. |
| `apiUrl` | Basis-URL der Backend-API, die jedem Hook über `useApiConfig()` zur Verfügung gestellt wird |
| `dateTimeFormat` | Wie Datumsangaben ausgegeben werden. Standardmäßig `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Ausgangssprache des Admin-Panels und das Gebietsschema (Locale), in dem Datumsangaben formatiert werden – siehe [Übersetzungen](/docs/frontend/i18n) |
| `client` | `RebaseClient`-Instanz: die Standardquelle für Daten, Authentifizierung und Speicher |
| `dataSources` | Zusätzliche Datenquellen für Collections, die eine solche angeben – siehe [Mehrere Datenquellen](/docs/backend/multiple-sources) |
| `authController` | Authentifizierungsstatus und -methoden. Ersetzt das `client.auth`-Abonnement vollständig |
| `storageSource` | Die Standard-Speicherquelle, überschreibt `client.storage` |
| `storageSources` | Benannte Speicherquellen über den Standard hinaus |
| `databaseAdmin` | Administrative Datenbankoperationen (SQL, Schema-Erkennung). Wird nur von Studio benötigt |
| `userConfigPersistence` | Lokale UI-Einstellungen – Spaltenbreiten, eingeklappte Gruppen |
| `onAnalyticsEvent` | Wird für jedes Analyseereignis aufgerufen, das das Admin-Panel auslöst |
| `entityLinkBuilder` | `({ row, id, path }) => string`: die URL für die Schaltfläche "In Ihrer App öffnen" bei einem Datensatz, basierend auf dem Datensatz, wie der Server die Zeile sendet |
| `plugins` | Plugin-Instanzen – siehe [Plugins](/docs/plugins) |
| `slots` | Slot-Beiträge, die direkt und ohne Plugin deklariert werden |
| `propertyConfigs` | Benutzerdefinierte Feld-Widgets, indiziert nach dem Namen, den eine Eigenschaft in `propertyConfig` angibt |
| `entityViews` | Benutzerdefinierte Tabs für Entitätsansichten, verfügbar für jede Collection, die deren `key` in `admin.entityViews` angibt |
| `collectionViews` | Benutzerdefinierte Collection-Ansichtsmodi, verfügbar für jede Collection nach `key` |
| `entityActions` | Entitätsaktionen, verfügbar für jede Collection, die deren `key` in `admin.entityActions` angibt |
| `effectiveRoleController` | Simulieren einer anderen Rolle, während der Dev-Modus aktiv ist |
| `modeController` | Übergibt Rebase den Hell-/Dunkelmodus der Host-App; Rebase rührt `<html>`, `prefers-color-scheme` oder `localStorage` dann nicht an – siehe [Styling](#styling) |
| `translations` | Beliebige UI-Texte überschreiben oder erweitern, nach Locale geschlüsselt – siehe [Übersetzungen](/docs/frontend/i18n) |
| `components` | Integrierte Komponenten ersetzen – siehe [Komponentenüberschreibungen](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Die Controller für Navigation, URLs und die Collection-Registrierung sind **keine** Props von `<Rebase>` – sie werden von den unten aufgeführten Hooks erstellt und innerhalb des Admin-Baums verwendet (`<RebaseShell>` verdrahtet sie im Standard-Scaffold für Sie).

Gleiches gilt für das URL-Präfix. Wenn das Admin-Panel unter einem Pfad gemountet wird, gehört dies zu `<RebaseCMS basePath="/admin">`, welches URLs zu Collections auflöst – und das auch nur, wenn der Router keinen eigenen `basename` hat. Siehe [Ändern der Basis-URL](/docs/getting-started/deployment#changing-the-base-url).

## Ein einheitliches Datenformat

<span class="since-badge" data-since="0.29">Seit 0.29</span>
Ihr Code erhält Zeilen (Rows) so, wie der Server sie sendet, egal wo sie angefordert werden: `client.data`, `context.data` (sowohl in einem Backend-Callback als auch im Browser), `useRows`, `useRow` und `useRowWrites`, das `data` der Collection- und View-Builder sowie das, was an die `browserCallbacks` einer Collection übergeben wird. Eine Zeile ist ein flaches Objekt: `row.title`, ein Datum als ISO-String, eine belongsTo-Relation als Fremdschlüsselspalte.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

Das Admin-Panel selbst rendert ein `Entity`-View-Model – den `id` / `path` / `values`-Wrapper, aus dem seine Collection-Ansichten und Formulare schöpfen, mit Datumsangaben als `Date`-Objekten und Relationen als `EntityRelation`. Diese Schicht ist admin-eigen und nicht Teil der öffentlichen Schnittstelle: Einer Entitätsaktion, einem Display-Resolver, dem `tableController.rows` eines Ansichtsmodus-`Builder`s, der Auswahl einer Collection-Aktion und einem Slot werden alle Zeilen übergeben, jeweils mit der ID des Datensatzes neben der Zeile. Auf `Entity` stoßen Sie nur in einer Kopie eines der eigenen Teile des Admin-Panels (`Collection.Table`, eine Karte), der der Datensatz so übergeben wird, wie das Admin-Panel ihn darstellt. Die Werte eines Formulars sind die des Editors: `Date`-Objekte und Relationen, so wie ein Feld sie bearbeitet.

## Eine einzelne Collection oder ein Datensatz auf einer eigenen Seite

Sie benötigen nicht das gesamte Admin-Panel, um eine einzelne Tabelle anzuzeigen. `<CollectionPanel>`, `<EntityFormPanel>`, `<RecordDetail>` und `<FieldValue>` funktionieren überall unter `<Rebase>` und einem React Router-Router, ganz ohne `<RebaseCMS>`, `<RebaseNavigation>` oder `<RebaseShell>`: eine Collection mit den von Ihnen ausgewählten Spalten und der gewünschten Symbolleiste, das Formular eines Datensatzes mit nur einigen Feldern oder Ihrem eigenen Layout, ein schreibgeschützter Datensatz oder ein einzelner Wert, der so gerendert wird, wie das Admin-Panel ihn darstellt. Siehe [Panels auf einer eigenen Seite](/docs/frontend/panels).

## Fortgeschritten: Manuelles Layout

Alles Nachfolgende ersetzt `<RebaseShell>`. Sie benötigen dies nur, wenn das Standard-Layout im Weg ist – ein anderer Rahmen (Chrome) um das Admin-Panel, ein eigener Routenbaum, eine App, in der das Admin-Panel eine Seite unter vielen ist. Wenn Sie das Layout nicht ersetzen, können Sie direkt bei [Benutzerdefinierte Ansichten](#benutzerdefinierte-ansichten) weiterlesen.

`<RebaseShell>` ist syntaktischer Zucker für vier Schichten, und Sie können diese einzeln verwenden:

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

Die Reihenfolge ist festgelegt: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` zeigt die Login-Ansicht an, bis ein Benutzer vorhanden ist, sodass für einen abgemeldeten Besucher darunter nichts gerendert wird; `RebaseNavigation` erstellt die Controller für Navigation, URLs und die Collection-Registrierung, die `RebaseRouteDefs` und jede Collection-Ansicht auslesen, weshalb `RebaseRouteDefs` außerhalb davon einen Fehler wirft. Um eine Collection-Ansicht oder ein Datensatzformular ohne die Routen des Admin-Panels in eine eigene Seite einzubinden, erstellt der schlankere `CollectionsProvider` stattdessen diese Controller – siehe [Panels auf einer eigenen Seite](/docs/frontend/panels).

Jede Schicht kann für sich allein verwendet werden. `<RebaseAuthGate>` allein sichert Ihre eigene App hinter dem Login von Rebase ab. Tauschen Sie `<RebaseLayout>` gegen Ihre eigene Komponente aus, um das Routing beizubehalten und das Standard-Chrome zu entfernen; lassen Sie auch `<RebaseRouteDefs>` weg, und Sie bauen die Routen selbst aus den Komponenten unter [Scaffold-Komponenten](#scaffold-komponenten) auf.

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

An diesem Punkt ist nichts mehr für Sie voreingestellt: Sie erstellen die folgenden Controller manuell und rendern die Routen selbst.

### Controller

Controller sind React-Hooks, die bestimmte Aspekte des Frameworks konfigurieren. `<RebaseNavigation>` ruft alle davon für Sie auf – greifen Sie nur innerhalb einer Render-Prop darauf zurück.

#### `useBuildNavigationStateController`

Der Haupt-Controller, der alles miteinander verknüpft:

Sein `data` ist das, was den Collection- und View-Buildern übergeben wird: das flache `context.data` des umschließenden `<Rebase>` (siehe [Ein einheitliches Datenformat](#ein-einheitliches-datenformat)), daher muss dieser Hook innerhalb des `<Rebase>`-Baums aufgerufen werden.

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

Verwaltet das Hell-/Dunkel-Design (Theme). Wenn aktiviert, steuert er das Theme der Seite: Er setzt die `dark`-Klasse auf `<html>`, folgt `prefers-color-scheme`, bis der Benutzer einen Modus auswählt, und speichert diese Auswahl im `localStorage`.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` erstellt selbst eine Instanz davon.

Wenn die Komponente, die ihn verwendet, unmountet, entfernt sie die hinzugefügte `dark`-Klasse wieder; eine `dark`-Klasse, die die Seite bereits hatte, bleibt bestehen. Erstellen Sie eine eigene Instanz oberhalb von `<Rebase>` nur dann, wenn Komponenten außerhalb davon den Modus ebenfalls benötigen, und übergeben Sie sie mit der [`modeController`-Prop](#styling), damit es nur einen Controller und nicht zwei gibt. `useBuildModeController({ enabled: false })` erstellt einen inaktiven Controller: Er behält `mode` im React-State und verändert weder Klassen, Media Queries noch den `localStorage`. Wenn Ihre App das Theme bereits verwaltet, benötigen Sie diesen Hook überhaupt nicht: Übergeben Sie Ihren eigenen Controller als `modeController`.

#### `useBuildAdminModeController`

Wechselt zwischen Studio- und Content-Modus:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Scaffold-Komponenten

| Komponente | Beschreibung |
|-----------|-------------|
| `<Scaffold>` | Haupt-Layout-Container mit responsiver Seitenleiste |
| `<AppBar>` | Obere Navigationsleiste mit Suche, Modus-Umschalter, Benutzermenü |
| `<Drawer>` | Seitennavigation mit Collection-Liste und Ansichts-Links |
| `<SideDialogs>` | Container für die Entitäts-Editoren im Seitenpanel |
| `<RebaseRoutes>` | Routen-Container, der sich in React Router integriert |
| `<RebaseRoute>` | Behandelt Collection-Routen (`/c/*`) |
| `<ContentHomePage>` | Standard-Startseite, die Collection-Karten anzeigt |
| `<StudioHomePage>` | Startseite im Studio-Modus mit Entwickler-Tools |

## Benutzerdefinierte Ansichten

Fügen Sie Navigationsansichten auf oberster Ebene für Dashboards, Tools oder benutzerdefinierte Seiten hinzu. Ein `AppView` ist ein flaches Objekt – alles Nachfolgende befindet sich auf der obersten Ebene, es gibt keinen verschachtelten `admin`-Block:

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

Übergeben Sie sie an `<RebaseCMS>`, neben Ihren Collections – dies ist die Komponente, die die Navigation registriert:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Feld | |
|---|---|
| `slug` | der Pfad, unter dem die Ansicht erreichbar ist, unterhalb des Admin-Roots |
| `name` | die Beschriftung in der Drawer-Seitenleiste und auf der Startseite |
| `view` | das zu rendernde Element oder ein `ComponentType`, um es lazy zu rendern |
| `icon` | ein [Lucide](https://lucide.dev/icons/)-Icon-Name, z. B. `"ShoppingCart"` – oder ein beliebiger Node |
| `group` | gruppiert Ansichten in der Drawer-Leiste; `"Admin"` und `"Settings"` rutschen ganz nach unten |
| `pinToBottom` | verschiebt die Gruppe unter beliebigem Namen ganz nach unten – bevorzugen Sie dies gegenüber den beiden magischen Strings |
| `nestedRoutes` | registriert auch `slug/*` für eine Ansicht mit eigenen Routen |
| `hideFromNavigation` | behält die Route bei, entfernt jedoch den Navigationseintrag |
| `roles` | nur Benutzer mit einer dieser Rollen sehen die Ansicht oder können darauf zugreifen |
| `description` | Markdown, wird auf der Karte der Startseite angezeigt |

Um eine Ansicht unter **Studio** statt unter dem CMS zu platzieren, übergeben Sie sie an [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styling

Rebase verwendet **Tailwind CSS v4** und unterstützt Hell-/Dunkelmodi. Anpassungen erfolgen über:

- **Benutzerdefinierte CSS-Eigenschaften (Custom Properties)** — Design-Tokens überschreiben
- **`<Rebase modeController>`** — Den Hell-/Dunkelmodus Ihrer App an Rebase übergeben
- **Tailwind-Konfiguration** — Standardmäßige Tailwind-Anpassung

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

### Hell- und Dunkelmodus

Standardmäßig verwaltet `<Rebase>` das Theme der Seite: Es setzt die `dark`-Klasse auf `<html>`, folgt `prefers-color-scheme`, bis der Benutzer im Admin-Panel einen Modus auswählt, und speichert diese Auswahl im `localStorage`.

Wenn `<Rebase>` unmountet, entfernt es die hinzugefügte `dark`-Klasse; eine Klasse, die die Seite bereits hatte, bleibt bestehen. In Version 0.24 bleibt die Klasse erhalten.

Wenn Ihre App bereits über ein Theme verfügt, übergeben Sie dieses als `modeController`. Rebase liest `mode` daraus aus, ruft dessen `setMode` über den eigenen Theme-Umschalter auf und fasst `<html>`, `prefers-color-scheme` oder `localStorage` niemals an:

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

Das CSS des Scaffolds gestaltet den Dunkelmodus unter jedem Element mit der `dark`-Klasse (`@custom-variant dark (&:where(.dark, .dark *))`). Seitenpanels, Dialoge und Menüs rendern in einem Portal auf `<body>`, setzen Sie die Klasse daher auf `<html>` oder `<body>` und nicht auf einen Wrapper um `<Rebase>`.

Das Einschließen von `<Rebase>` in einen `ModeControllerProvider` reicht hierfür nicht aus: `<Rebase>` stellt intern einen eigenen Controller bereit. In Version 0.24 existiert die Prop nicht und es gibt keine Möglichkeit, `<Rebase>` den Modus Ihrer App zu übergeben.

## Nächste Schritte

- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Eigene Formularfelder erstellen
- **[Entitätsansichten](/docs/frontend/entity-views)** — Tabs zu Entitäts-Editoren hinzufügen
- **[Ansichtsmodi](/docs/frontend/view-modes)** — Liste, Tabelle, Karten, Kanban
- **[Übersetzungen](/docs/frontend/i18n)** — Beliebige Texte anpassen oder eine Sprache hinzufügen
- **[Plugins](/docs/plugins)** — Das Framework erweitern
