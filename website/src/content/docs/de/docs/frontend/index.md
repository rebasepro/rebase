---
sourceHash: f04fd00564e10891
title: Frontend-Übersicht
sidebar_label: Frontend
description: "Erstellen und passen Sie das Panel an — Rebase CMS und Rebase Studio — mit React: Controller, Scaffold, Routing und Ansichten."
---

## Übersicht

Das Rebase-Frontend ist ein **React-Framework**, das Ihr Admin-Panel rendert. Es liest Ihre Collection-Definitionen ein und generiert automatisch Tabellen, Formulare, Navigation und Routing.

Im Standard-Scaffold **ist** das Admin-Panel das Frontend: Es wird im Root Ihrer bereitgestellten URL ausgeliefert. Wenn Sie stattdessen Ihre eigene Produkt-App erstellen, können Sie das Admin-Panel unter einem Präfix wie `/admin` im selben Deployment einbinden — siehe [Basis-URL ändern](/docs/getting-started/deployment#changing-the-base-url).

Dies ist `frontend/src/App.tsx`, wie `rebase init` es schreibt, ohne dessen Schriftart-Imports, Error Boundary und Google-Client-ID — das gesamte Admin-Panel, vier Deklarationen innerhalb eines einzigen Providers:

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

Die ersten drei rendern nichts: Sie *registrieren* Konfiguration im Provider. `<RebaseShell>` ist das, was zeichnet — es liest diese Registry und baut daraus die Navigation, Routen und das Layout auf. Die Reihenfolge, in der sie erscheinen, spielt also keine Rolle, und das Hinzufügen eines Features bedeutet das Hinzufügen einer Komponente, nicht das Umverdrahten eines Baums.

| Komponente | Paket | Registriert |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | den Anmeldebildschirm (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | Collections, benutzerdefinierte Ansichten, die Startseite, den Collection-Editor |
| `<RebaseStudio>` | `@rebasepro/studio` | die Entwickler-Tools (SQL, RLS, Logs, Backups …) |
| `<RebaseShell>` | `@rebasepro/cms` | nichts — es rendert das Admin-Panel aus allem Obigen |

Entfernen Sie `<RebaseStudio>` und Sie erhalten ein reines Content-CMS; entfernen Sie `<RebaseCMS>` und Sie erhalten nur die Entwickler-Tools. Wie Sie die Shell stattdessen manuell anordnen, erfahren Sie unter [Fortgeschritten: Manuelles Layout](#fortgeschritten-manuelles-layout).

## Der Rebase-Provider

`<Rebase>` ist der Root-Provider, der alle Rebase-Funktionen über Context für untergeordnete Komponenten verfügbar macht. Er akzeptiert:

Alle dreiundzwanzig vollständig — früher listete die Tabelle zehn auf, und zwei davon waren Props, die die Komponente nie gelesen hat:

<!-- rebase-props:start -->
| Prop | Beschreibung |
|------|-------------|
| `children` | Die Root-Komponenten des Admins — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Eine Render-Funktion dient als Ausweichmöglichkeit für manuelles Layout. |
| `apiUrl` | Basis-URL der Backend-API, die jedem Hook über `useApiConfig()` zur Verfügung gestellt wird |
| `dateTimeFormat` | Wie Datumsangaben ausgegeben werden. Standardmäßig `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Ausgangssprache des Admins und das Gebietsschema (Locale), in dem Datumsangaben formatiert werden — siehe [Übersetzungen](/docs/frontend/i18n) |
| `client` | `RebaseClient`-Instanz: die Standardquelle für Daten, Authentifizierung und Speicher |
| `dataSources` | Zusätzliche Datenquellen für Collections, die eine solche angeben — siehe [Mehrere Datenquellen](/docs/backend/multiple-sources) |
| `authController` | Authentifizierungsstatus und -methoden. Ersetzt die Subscription von `client.auth` vollständig |
| `storageSource` | Die Standard-Speicherquelle, die `client.storage` überschreibt |
| `storageSources` | Benannte Speicherquellen neben dem Standard |
| `databaseAdmin` | Administrative Datenbankoperationen (SQL, Schema-Discovery). Wird nur von Studio benötigt |
| `userConfigPersistence` | Lokale UI-Einstellungen — Spaltenbreiten, eingeklappte Gruppen |
| `onAnalyticsEvent` | Wird für jedes Analyse-Event aufgerufen, das der Admin auslöst |
| `entityLinkBuilder` | Gibt eine URL für die Schaltfläche „In Ihrer App öffnen“ auf einem Entity-Formular zurück |
| `plugins` | Plugin-Instanzen — siehe [Plugins](/docs/plugins) |
| `slots` | Slot-Beiträge, die direkt ohne Plugin deklariert werden |
| `propertyConfigs` | Benutzerdefinierte Feld-Widgets, indiziert nach dem Namen, den eine Eigenschaft in `propertyConfig` angibt |
| `entityViews` | Benutzerdefinierte Entity-Ansichts-Tabs, verfügbar für jede Collection, die deren `key` in `admin.entityViews` angibt |
| `collectionViews` | Benutzerdefinierte Collection-Ansichtsmodi, verfügbar für jede Collection über `key` |
| `entityActions` | Entity-Aktionen, verfügbar für jede Collection, die deren `key` in `admin.entityActions` angibt |
| `effectiveRoleController` | Eine andere Rolle simulieren, während der Entwicklungsmodus aktiv ist |
| `modeController` | Übergibt Rebase den Hell-/Dunkelmodus der Host-App; Rebase berührt dann niemals `<html>`, `prefers-color-scheme` oder localStorage — siehe [Styling](#styling) |
| `translations` | Beliebige UI-Zeichenfolgen überschreiben oder erweitern, indiziert nach Locale — siehe [Übersetzungen](/docs/frontend/i18n) |
| `components` | Integrierte Komponenten ersetzen — siehe [Komponenten-Overrides](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Die Controller für Navigation, URL und Collection-Registry sind **keine** Props von `<Rebase>` — sie werden von den folgenden Hooks erstellt und innerhalb des Admin-Baums verwendet (`<RebaseShell>` verdrahtet sie im Standard-Scaffold für Sie).

Ebenso wenig das URL-Präfix. Wenn der Admin unter einem Pfad eingebunden wird, gehört dies zu `<RebaseCMS basePath="/admin">`, welches URLs zu Collections auflöst — und zwar nur dann, wenn der Router keinen eigenen `basename` hat. Siehe [Basis-URL ändern](/docs/getting-started/deployment#changing-the-base-url).

## Zwei Datenstrukturen

Es gibt zwei Datenebenen, und diese sind **nicht** austauschbar. Die Übergabe der einen, wo die andere erwartet wird, führt zu einem Typfehler. Daher sollte man dies wissen, bevor man einen Controller manuell verdrahtet.

| | Struktur | Wo Sie sie erhalten | Wie eine Zeile aussieht |
|---|---|---|---|
| **SDK** | `RebaseSdkData` — flache Zeilen | `client.data` und `context.data` in Backend-Callbacks | `row.title` |
| **Admin** | `RebaseData` — `Entity`-View-Model | `useData()`, innerhalb des `<Rebase>`-Baums | `entity.values.title` |

Die SDK-Ebene ist die öffentliche, symmetrische Oberfläche: identisch auf dem Frontend-Client und in Backend-Callbacks. Die `Entity`-Ebene ist das View-Model des Admins — sie fügt den `id` / `path` / `values`-Wrapper hinzu, gegen den die Collection-Ansichten und -Formulare rendern. `CollectionAccessor` und `FindResponse` gehören dazu und sind aus diesem Grund als `@internal` markiert.

`<Rebase>` bildet die Grenze zwischen beiden: Es nimmt Ihre flachen `client.data` und umschließt sie mit `wrapAsEntityData()`, bevor es sie als `RebaseData` des Admins bereitstellt. Sie rufen dies nie selbst auf — Sie nehmen einfach die Struktur, die Sie benötigen, von der richtigen Stelle:

```tsx
// Flat rows — anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Entity view-model — inside the <Rebase> tree only.
// `data.posts` also works at runtime; `collection()` is the typed accessor.
const data = useData();
const { data: entities } = await data.collection("posts").find();
entities[0].values.title;
```

## Eine Collection oder ein Datensatz auf einer eigenen Seite

Sie benötigen nicht das gesamte Admin-Panel, um eine einzelne Tabelle anzuzeigen. `<CollectionPanel>`, `<EntityFormPanel>`, `<EntityViewPanel>` und `<FieldValue>` funktionieren überall unter `<Rebase>` und einem Router von React Router, ganz ohne `<RebaseCMS>`, `<RebaseNavigation>` oder `<RebaseShell>`: eine Collection mit den von Ihnen gewählten Spalten und der gewünschten Toolbar, das Formular eines einzelnen Datensatzes mit nur einigen Feldern oder Ihrem eigenen Layout, ein schreibgeschützter Datensatz oder ein einzelner Wert, dargestellt wie im Admin-Panel. Siehe [Panels auf einer eigenen Seite](/docs/frontend/panels).

## Fortgeschritten: Manuelles Layout

Alles Nachfolgende ersetzt `<RebaseShell>`. Sie benötigen dies nur, wenn das Standard-Layout im Weg ist — ein anderes Rahmendesign (Chrome) um den Admin, ein eigener Routenbaum, eine App, in der das Admin-Panel nur eine Seite unter vielen ist. Wenn Sie das Layout nicht ersetzen, können Sie bei [Benutzerdefinierte Ansichten](#benutzerdefinierte-ansichten) aufhören.

`<RebaseShell>` ist syntaktischer Zucker für vier Ebenen, und Sie können diese einzeln verwenden:

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

Die Reihenfolge ist festgelegt: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` zeigt die Login-Ansicht an, bis ein Benutzer vorhanden ist, sodass für einen abgemeldeten Besucher nichts darunter gerendert wird; `RebaseNavigation` erstellt die Controller für Navigation, URL und Collection-Registry, die von `RebaseRouteDefs` und jeder Collection-Ansicht gelesen werden, sodass `RebaseRouteDefs` außerhalb davon einen Fehler auslöst.
Um eine Collection-Ansicht oder ein Datensatzformular ohne die Routen des Admins in eine eigene Seite einzubinden, erstellt der schlankere `CollectionsProvider` stattdessen diese Controller — siehe [Panels auf einer eigenen Seite](/docs/frontend/panels).

Jede Ebene kann für sich allein verwendet werden. `<RebaseAuthGate>` allein schützt Ihre eigene App hinter dem Login von Rebase. Tauschen Sie `<RebaseLayout>` gegen Ihre eigene Komponente aus, um das Routing beizubehalten und das Standard-Rahmendesign zu entfernen; lassen Sie auch `<RebaseRouteDefs>` weg, und Sie bauen die Routen selbst aus den Komponenten unter [Scaffold-Komponenten](#scaffold-komponenten) auf.

Darüber hinaus akzeptiert `<Rebase>` anstelle von Children auch eine **Render-Prop**, die Ihnen den Context und das Loading-Flag übergibt und den gesamten Baum Ihnen überlässt:

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

An diesem Punkt ist nichts mehr für Sie vorverdrahtet: Sie erstellen die nachfolgenden Controller von Hand und rendern die Routen selbst.

### Controller

Controller sind React-Hooks, die bestimmte Aspekte des Frameworks konfigurieren. `<RebaseNavigation>` ruft alle davon für Sie auf — greifen Sie nur innerhalb einer Render-Prop darauf zurück.

#### `useBuildNavigationStateController`

Der Haupt-Controller, der alles miteinander verbindet:

Sein `data`-Objekt ist das **Entity-strukturierte** `RebaseData`, stammt also aus `useData()` — nicht aus `rebaseClient.data`, was der flachen SDK-Ebene entspricht. `<Rebase>` konvertiert das eine für Sie in das andere (siehe [Zwei Datenstrukturen](#zwei-datenstrukturen) unten), daher muss dieser Hook innerhalb des `<Rebase>`-Baums aufgerufen werden.

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

Verwaltet das Hell-/Dunkel-Theme. Solange es aktiviert ist, verwaltet es das Theme der Seite: Es setzt die `dark`-Klasse auf `<html>`, folgt `prefers-color-scheme`, bis der Benutzer einen Modus auswählt, und speichert diese Auswahl im localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` erstellt selbst eine Instanz davon.

Wenn die Komponente, die ihn verwendet, unmountet, entfernt sie die hinzugefügte `dark`-Klasse wieder; eine `dark`-Klasse, die die Seite bereits hatte, bleibt bestehen. Erstellen Sie nur dann einen eigenen Controller oberhalb von `<Rebase>`, wenn auch Komponenten außerhalb davon den Modus benötigen, und übergeben Sie ihn mit der [Prop `modeController`](#styling), damit es nur einen Controller gibt und nicht zwei. `useBuildModeController({ enabled: false })` erstellt einen inaktiven Controller: Er behält `mode` im React-State und fasst weder Klassen noch Media Queries oder den localStorage an. Wenn Ihre App das Theme bereits selbst verwaltet, benötigen Sie diesen Hook überhaupt nicht: Übergeben Sie Ihren eigenen Controller als `modeController`.

#### `useBuildAdminModeController`

Schaltet zwischen Studio- und Content-Modus um:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Scaffold-Komponenten

| Komponente | Beschreibung |
|-----------|-------------|
| `<Scaffold>` | Haupt-Layout-Container mit responsiver Sidebar |
| `<AppBar>` | Obere Navigationsleiste mit Suche, Modus-Umschalter, Benutzermenü |
| `<Drawer>` | Seitennavigation mit Collection-Liste und Ansichts-Links |
| `<SideDialogs>` | Container für Side-Panel-Entity-Editoren |
| `<RebaseRoutes>` | Routen-Container, der in React Router integriert wird |
| `<RebaseRoute>` | Verarbeitet Collection-Routen (`/c/*`) |
| `<ContentHomePage>` | Standard-Startseite mit Collection-Karten |
| `<StudioHomePage>` | Studio-Modus-Startseite mit Entwickler-Tools |

## Benutzerdefinierte Ansichten

Fügen Sie Navigationsansichten auf oberster Ebene für Dashboards, Tools oder benutzerdefinierte Seiten hinzu. Eine `AppView` ist ein flaches Objekt — alles Nachfolgende befindet sich auf oberster Ebene, es gibt keinen verschachtelten `admin`-Block:

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

Übergeben Sie sie an `<RebaseCMS>`, neben Ihren Collections — das ist die Komponente, die die Navigation registriert:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Feld | |
|---|---|
| `slug` | der Pfad, unter dem die Ansicht unter dem Admin-Root erreichbar ist |
| `name` | die Bezeichnung im Drawer und auf der Startseite |
| `view` | das zu rendernde Element oder ein `ComponentType`, um es lazy zu rendern |
| `icon` | ein [Lucide](https://lucide.dev/icons/)-Icon-Name, z. B. `"ShoppingCart"` — oder ein beliebiger Node |
| `group` | gruppiert Ansichten im Drawer; `"Admin"` und `"Settings"` wandern nach ganz unten |
| `pinToBottom` | platziert die Gruppe unter einem beliebigen Namen ganz unten — bevorzugen Sie dies gegenüber den beiden Magic Strings |
| `nestedRoutes` | registriert auch `slug/*`, für eine Ansicht mit eigenen Routen |
| `hideFromNavigation` | behält die Route bei, entfernt jedoch den Navigationseintrag |
| `roles` | nur Benutzer mit einer dieser Rollen sehen die Ansicht oder können darauf zugreifen |
| `description` | Markdown, dargestellt auf der Startseiten-Karte |

Um eine Ansicht unter **Studio** statt unter dem CMS zu platzieren, übergeben Sie sie an [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styling

Rebase verwendet **Tailwind CSS v4** und unterstützt Hell-/Dunkelmodi. Passen Sie es an über:

- **CSS Custom Properties** — Design-Tokens überschreiben
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

Standardmäßig steuert `<Rebase>` das Theme der Seite: Es setzt die `dark`-Klasse auf `<html>`, folgt `prefers-color-scheme`, bis der Benutzer im Admin-Panel einen Modus auswählt, und speichert diese Auswahl im localStorage.

Wenn `<Rebase>` unmountet, entfernt es die hinzugefügte `dark`-Klasse wieder; eine Klasse, die die Seite bereits hatte, bleibt bestehen. In Version 0.24 bleibt die Klasse erhalten.

Wenn Ihre App bereits über ein Theme verfügt, übergeben Sie dieses als `modeController`. Rebase liest `mode` daraus aus, ruft dessen `setMode` über den eigenen Theme-Umschalter auf und fasst `<html>`, `prefers-color-scheme` oder den localStorage niemals an:

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

Das CSS des Scaffolds formatiert den Dark-Mode unter jedem Element mit der `dark`-Klasse (`@custom-variant dark (&:where(.dark, .dark *))`). Seiten-Panels, Dialoge und Menüs rendern in einem Portal auf `<body>`; setzen Sie die Klasse daher auf `<html>` oder `<body>` anstatt auf ein Wrapper-Element um `<Rebase>`.

Das Umschließen von `<Rebase>` mit einem `ModeControllerProvider` bewirkt dies nicht: `<Rebase>` stellt intern einen eigenen Controller bereit. In 0.24 existiert die Prop nicht, und es gibt keine Möglichkeit, Rebase den Modus Ihrer App zu übergeben.

## Nächste Schritte

- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Benutzerdefinierte Formularfelder erstellen
- **[Entity-Ansichten](/docs/frontend/entity-views)** — Tabs zu Entity-Editoren hinzufügen
- **[Ansichtsmodi](/docs/frontend/view-modes)** — Liste, Tabelle, Karten, Kanban
- **[Übersetzungen](/docs/frontend/i18n)** — Beliebige Zeichenfolgen ändern oder eine Sprache hinzufügen
- **[Plugins](/docs/plugins)** — Das Framework erweitern
