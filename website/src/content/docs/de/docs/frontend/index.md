---
sourceHash: 15779772a2359662
title: Frontend-Übersicht
sidebar_label: Frontend
description: "Erstellen und passen Sie das Panel an — Rebase CMS und Rebase Studio — mit React: Controller, Scaffold, Routing und Ansichten."
---

## Übersicht

Das Rebase-Frontend ist ein **React-Framework**, das Ihr Admin-Panel rendert. Es
liest die vom Backend bereitgestellten Tabellen und generiert daraus ohne
Konfiguration Navigation, Tabellen, Formulare und Routen (siehe
[Tabellen im CMS](/docs/collections/)). Was Sie hinzufügen, macht den Unterschied aus.

Im Standard-Scaffold **ist** das Admin-Panel das Frontend: Es wird unter der Root-URL Ihres Deployments bereitgestellt. Wenn Sie stattdessen eine eigene Produkt-App erstellen, können Sie das Admin-Panel unter einem Präfix wie `/admin` im selben Deployment einbinden — siehe [Ändern der Basis-URL](/docs/getting-started/deployment#changing-the-base-url).

Dies ist eine `frontend/src/App.tsx` ohne Schriftarten-Imports, Error-Boundary und
Google-Client-ID — das gesamte Admin-Panel, vier Deklarationen innerhalb eines
Providers:

```tsx
import React from "react";
import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { tableCustomizations } from "./cms";

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
            {/* Every table the backend serves, plus your customizations. */}
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Die ersten drei rendern nichts: Sie *registrieren* die Konfiguration im
Provider. `<RebaseShell>` übernimmt das Zeichnen — es liest diese Registrierung und baut daraus
die Navigation, Routen und das Layout auf. Die Reihenfolge, in der sie erscheinen, spielt
also keine Rolle, und das Hinzufügen eines Features bedeutet das Hinzufügen einer Komponente, nicht das Umverdrahten eines Baums.

| Komponente | Paket | Registriert |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | den Anmeldebildschirm (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | die bereitgestellten Tabellen mit ihren Anpassungen, externe Collections, benutzerdefinierte Ansichten, die Startseite, den Collection-Editor |
| `<RebaseStudio>` | `@rebasepro/studio` | die Entwickler-Tools (SQL, RLS, Logs, Backups…) |
| `<RebaseShell>` | `@rebasepro/cms` | nichts — es rendert das Admin-Panel aus all dem oben Genannten |

Entfernen Sie `<RebaseStudio>`, erhalten Sie ein reines Content-CMS; entfernen Sie `<RebaseCMS>`,
haben Sie ausschließlich die Entwickler-Tools. Wie Sie die Shell stattdessen manuell layouten, erfahren Sie unter
[Erweitert: Manuelles Layout](#erweitert-manuelles-layout).

## Wo die CMS-Dateien liegen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```text
frontend/src/
├── App.tsx
└── cms/
    ├── index.ts      # export const tableCustomizations = [postsCms, …]
    ├── posts.tsx     # customizeTable("posts", { … })
    └── events.ts     # defineFirestoreCollection({ … })
```

`frontend/src/cms/` enthält das, was das Panel nicht selbst ableiten kann: ein
[`customizeTable`](/docs/frontend/customize-table/) pro Tabelle, die Sie anders
darstellen möchten, sowie die [Firestore-Collections](/docs/frontend/firebase/),
die der Browser direkt liest. Diese Dateien werden ausschließlich im Browser ausgeführt, ein benutzerdefiniertes
Feld ist also eine Komponente, die Sie by Value importieren.

Das Frontend importiert den **Typ** einer Tabelle aus `backend/schema`, niemals einen Wert:
`import type { posts } from "../../../backend/schema/posts"`. Ein Typ-Import wird
beim Bundling entfernt, sodass die Hooks und der Servercode des Backends den
Browser nie erreichen. Das Backend importiert nichts aus dem Frontend.

## RebaseCMS-Props

<span class="since-badge" data-since="0.31">Seit 0.31</span>

<!-- rebase-cms-props:start -->
| Prop | Beschreibung |
|------|-------------|
| `tableCustomizations` | Ergebnisse von `customizeTable(...)`, maximal eines pro Tabelle. Zwei für dieselbe Tabelle werfen einen Fehler; eines für eine Tabelle, die dem Aufrufer nicht bereitgestellt wird, wird mit einer Warnung in der Entwicklungsumgebung ignoriert |
| `externalCollections` | Collections, deren Zeilen auf einer anderen Datenquelle liegen, wie etwa Ergebnisse von `defineFirestoreCollection`; werden neben den Tabellen in derselben Navigation, Suche und in Referenzauswahlen angezeigt |
| `uiConfig` | Die UI-Einstellungen des Workspace, wie in der Entwicklung definiert: `import uiConfig from "./cms/ui-config.json"`. Werden über `tableCustomizations` und unter den individuellen Einstellungen jedes Benutzers angewendet |
| `tables` | Für Einbettungen und Tests: die Tabellen, die anstelle der vom Server bereitgestellten gerendert werden sollen (`compileTables([...])`). Wenn angegeben, werden vom Server keine angefordert |
| `views` | Top-Level-Seiten in der Navigation oder ein Builder dafür — siehe [Benutzerdefinierte Ansichten](#benutzerdefinierte-ansichten) |
| `homePage` | Ersetzt die Standard-Startseite für Inhalte |
| `entityViews` | Datensatz-Tabs, die jede Tabelle über `key` in ihren `entityViews` benennen kann |
| `collectionViews` | Ansichtsmodi, die jede Tabelle über `key` in ihren `customViews` benennen kann |
| `entityActions` | Datensatz-Aktionen, die jede Tabelle über `key` in ihren `entityActions` benennen kann |
| `collectionEditor` | `true` oder Optionen für den visuellen Schema-Editor |
| `navigationGroupMappings` | Benannte Gruppen sowie die darin enthaltenen Collections und Ansichten in entsprechender Reihenfolge |
| `basePath` | Das URL-Präfix, unter dem das Admin-Panel eingebunden ist, wenn der Router keinen `basename` hat |
<!-- rebase-cms-props:end -->

Die Collections des Panels werden in dieser Reihenfolge zusammengestellt, die auch der
Navigation entspricht: jede bereitgestellte Tabelle (wobei zuerst deren Anpassung, dann die UI-Einstellungen
des Workspace und des Benutzers angewendet werden), danach die `externalCollections`. Ein Slug
darf nur genau eine Collection bezeichnen:

| Kollision | Was passiert |
|---|---|
| Zwei `customizeTable`-Ergebnisse für denselben Slug | Fehler wird geworfen: Führen Sie sie zu einem zusammen |
| Eine externe Collection und eine bereitgestellte Tabelle oder eine weitere externe Collection | Das Panel zeigt einen Ladefehler an, der beide benennt; weisen Sie einer einen anderen Slug zu |

Wie das Panel auf die Tabellen wartet und was es anzeigt, wenn sie nicht
geladen werden können, wird unter [Tabellen im CMS](/docs/collections/#loading-and-errors) beschrieben.

## Der Rebase-Provider

`<Rebase>` ist der Root-Provider, der alle Rebase-Funktionen für untergeordnete Komponenten über den Context verfügbar macht. Er akzeptiert:

Alle dreiundzwanzig Props vollständig — die Tabelle enthielt früher zehn, wovon zwei
von der Komponente nie gelesen wurden:

<!-- rebase-props:start -->
| Prop | Beschreibung |
|------|-------------|
| `children` | Die Root-Komponenten des Admin-Panels — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Eine Render-Funktion dient als Ausweichlösung für manuelle Layouts. |
| `apiUrl` | Basis-URL der Backend-API, die jedem Hook über `useApiConfig()` zur Verfügung gestellt wird |
| `dateTimeFormat` | Wie Datumsangaben ausgegeben werden. Standardmäßig `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Ausgangssprache des Admin-Panels und das Gebietsschema (Locale), in dem Daten formatiert werden — siehe [Übersetzungen](/docs/frontend/i18n) |
| `client` | `RebaseClient`-Instanz: die Standardquelle für Daten, Authentifizierung und Speicher |
| `dataSources` | Zusätzliche Datenquellen für Collections, die eine solche angeben — siehe [Mehrere Datenquellen](/docs/backend/multiple-sources) |
| `authController` | Authentifizierungsstatus und -methoden. Ersetzt die Subscription von `client.auth` vollständig |
| `storageSource` | Die Standard-Speicherquelle, überschreibt `client.storage` |
| `storageSources` | Benannte Speicherquellen über den Standard hinaus |
| `databaseAdmin` | Administrative Datenbankoperationen (SQL, Schema-Discovery). Wird nur von Studio benötigt |
| `userConfigPersistence` | Lokale UI-Einstellungen — Spaltenbreiten, eingeklappte Gruppen |
| `onAnalyticsEvent` | Wird für jedes vom Admin-Panel ausgelöste Analyse-Event aufgerufen |
| `entityLinkBuilder` | `({ row, id, path }) => string`: die URL für die Schaltfläche „In Ihrer App öffnen“ auf einem Datensatz, basierend auf dem Datensatz, wie der Server die Zeile sendet |
| `plugins` | Plugin-Instanzen — siehe [Plugins](/docs/plugins) |
| `slots` | Direkt deklarierte Slot-Beiträge ohne separates Plugin |
| `propertyConfigs` | Benutzerdefinierte Feld-Widgets, indiziert nach dem Namen, den ein Feld in `propertyConfig` angibt |
| `entityViews` | Benutzerdefinierte Datensatzansichts-Tabs, verfügbar für jede Tabelle, die deren `key` in ihren `entityViews` angibt |
| `collectionViews` | Benutzerdefinierte Collection-Ansichtsmodi, verfügbar für jede Collection über `key` |
| `entityActions` | Datensatz-Aktionen, verfügbar für jede Tabelle, die deren `key` in ihren `entityActions` angibt |
| `effectiveRoleController` | Simuliert eine andere Rolle, während der Dev-Modus aktiv ist |
| `modeController` | Übergibt Rebase den Light-/Dark-Mode der Host-App; Rebase fasst dann weder `<html>`, `prefers-color-scheme` noch localStorage an — siehe [Styling](#styling) |
| `translations` | Überschreibt oder erweitert beliebige UI-Texte, nach Locale aufgeschlüsselt — siehe [Übersetzungen](/docs/frontend/i18n) |
| `components` | Ersetzt integrierte Komponenten — siehe [Komponenten-Overrides](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Die Controller für Navigation, URLs und die Collection-Registrierung sind **keine**
`<Rebase>`-Props — sie werden von den unten aufgeführten Hooks erstellt und innerhalb des Admin-Baums
verwendet (`<RebaseShell>` verknüpft sie im Standard-Scaffold automatisch für Sie).

Dasselbe gilt für das URL-Präfix. Wenn das Admin-Panel unter einem Pfad eingebunden wird, gehört dies
zu `<RebaseCMS basePath="/admin">`, welches URLs zu Collections auflöst —
und das auch nur dann, wenn der Router keinen eigenen `basename` besitzt. Siehe
[Ändern der Basis-URL](/docs/getting-started/deployment#changing-the-base-url).

## Ein einheitliches Datenformat

Ihr Code erhält Zeilen genau so, wie der Server sie sendet, egal wo sie angefragt werden: `client.data`,
`context.data` (in einem Backend-Callback ebenso wie im Browser), `useRows`,
`useRow` und `useRowWrites`, über das `data`-Objekt der Collection- und Ansichts-Builder sowie in den
Übergabewerten der `browserCallbacks` einer Tabelle. Eine Zeile ist ein flaches Objekt: `row.title`,
ein Datum als ISO-String, eine belongsTo-Relation als Fremdschlüsselspalte.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

Das Admin-Panel selbst rendert ein `Entity`-View-Model — der `id` / `path` / `values`-Wrapper,
aus dem seine Collection-Ansichten und Formulare schöpfen, mit Daten als `Date`-Objekten und einer
Relation als `EntityRelation` (die Werteklassen `EntityRelation`, `EntityReference`,
`GeoPoint` und `Vector` stammen aus `@rebasepro/cms-types`). Vor jedem Schreibvorgang und
jedem Filter konvertiert das Admin-Panel dies im Browser in Wire-Werte — Relationen als
Schlüssel, Vektoren als Zahlenlisten, Punkte als `{ latitude, longitude }`, Datumsangaben als ISO-Text —,
sodass der Server dasselbe sieht, was jeder andere Client sendet. Diese Schicht ist intern im Admin-Panel und gehört nicht
zur öffentlichen API: Datensatz-Aktionen, Display-Resolver, `tableController.rows` eines
Ansichtsmodus-`Builder`s, die Auswahl einer Collection-Aktion sowie Slots
erhalten alle Zeilen (Rows), wobei die ID jedes Datensatzes neben seiner Zeile bereitsteht. Auf `Entity` stoßen Sie nur in einer Kopie von Teilen des Admin-Panels
selbst (`Collection.Table`, eine Karte), der der Datensatz so übergeben wird, wie das Admin-Panel
ihn darstellt. Die Werte eines Formulars entsprechen denen des Editors: `Date`-Objekte und Relationen, so wie ein Feld
sie bearbeitet.

## Eine Collection oder ein Datensatz in einer eigenen Seite

Sie benötigen nicht das gesamte Admin-Panel, um eine einzelne Tabelle anzuzeigen. `<CollectionPanel>`,
`<RecordForm>`, `<RecordDetail>` und `<FieldValue>` funktionieren überall unter
`<Rebase>` und einem React-Router-Router ganz ohne `<RebaseCMS>`,
`<RebaseNavigation>` oder `<RebaseShell>`: eine Collection mit den von Ihnen ausgewählten Spalten und
Symbolleisten, das Formular eines einzelnen Datensatzes mit nur bestimmten Feldern oder Ihrem eigenen
Layout, ein schreibgeschützter Datensatz oder ein einzelner Wert, dargestellt wie im Admin-Panel. Siehe
[Panels in einer eigenen Seite](/docs/frontend/panels).

## Erweitert: Manuelles Layout

Alles Folgende ersetzt `<RebaseShell>`. Sie benötigen dies nur, wenn das Standard-Layout
im Weg ist — ein abweichendes Chrome (UI-Rahmen) um das Admin-Panel, ein eigener Routenbaum
oder eine App, in der das Admin-Panel nur eine von vielen Seiten darstellt. Wenn Sie das
Layout nicht ersetzen möchten, können Sie bei [Benutzerdefinierte Ansichten](#benutzerdefinierte-ansichten) aufhören.

`<RebaseShell>` ist syntaktischer Zucker für vier Schichten, die Sie auch einzeln verwenden können:

```tsx
<Rebase client={client} authController={authController}>
    <RebaseCMS tableCustomizations={tableCustomizations}/>
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

Die Reihenfolge ist festgelegt: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs →
RebaseLayout`. `RebaseAuthGate` zeigt die Login-Ansicht an, bis ein Benutzer angemeldet ist, sodass
für abgemeldete Besucher nichts darunter gerendert wird; `RebaseNavigation` baut
die Controller für Navigation, URLs und die Collection-Registrierung auf, die von `RebaseRouteDefs`
und jeder Collection-Ansicht gelesen werden – `RebaseRouteDefs` außerhalb davon wirft daher einen Fehler.
Um eine Collection-Ansicht oder ein Datensatz-Formular ohne die Routen des Admin-Panels in eine eigene Seite einzubetten,
baut der schlankere `CollectionsProvider` diese Controller stattdessen auf — siehe
[Panels in einer eigenen Seite](/docs/frontend/panels).

Jede Schicht ist für sich verwendbar. `<RebaseAuthGate>` allein schützt Ihre eigene App
hinter dem Login von Rebase. Tauschen Sie `<RebaseLayout>` gegen eine eigene Komponente aus, um das
Routing beizubehalten, aber das Standard-Chrome zu entfernen; lassen Sie auch `<RebaseRouteDefs>` weg, und Sie bauen
die Routen selbst aus den Komponenten unter
[Scaffold-Komponenten](#scaffold-komponenten) auf.

Darüber hinaus akzeptiert `<Rebase>` anstelle von Children auch ein **Render-Prop**,
das Ihnen den Context und das Loading-Flag übergibt und den gesamten Baum
Ihnen überlässt:

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

An diesem Punkt wird nichts mehr automatisch verdrahtet: Sie erstellen die folgenden Controller manuell
und rendern die Routen selbst.

### Controller

Controller sind React-Hooks, die bestimmte Aspekte des Frameworks konfigurieren.
`<RebaseNavigation>` ruft alle davon für Sie auf — greifen Sie nur innerhalb eines
Render-Props direkt darauf zu.

#### `useBuildNavigationStateController`

Der Haupt-Controller, der alles miteinander verknüpft:

Sein `data`-Objekt ist das, was den Collection- und Ansichts-Buildern übergeben wird: das flache
`context.data` des umschließenden `<Rebase>` (siehe [Ein einheitliches Datenformat](#ein-einheitliches-datenformat)),
daher muss dieser Hook innerhalb des `<Rebase>`-Baums aufgerufen werden.

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

Verwaltet das Light-/Dark-Theme. Solange es aktiviert ist, steuert es das Theme der Seite: Es setzt
die `dark`-Klasse auf `<html>`, folgt `prefers-color-scheme`, bis der Benutzer
einen Modus wählt, und merkt sich diese Auswahl im localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` erstellt standardmäßig selbst einen solchen Controller.

Wird die
Komponente, die ihn nutzt, unmounted, entfernt sie die hinzugefügte `dark`-Klasse wieder; eine
bereits vorhandene `dark`-Klasse der Seite bleibt bestehen. Erstellen Sie Ihren eigenen Controller
oberhalb von `<Rebase>` nur dann, wenn auch Komponenten außerhalb den Modus benötigen, und übergeben
Sie ihn über das [`modeController`-Prop](#styling), damit nur ein Controller
statt zweier existiert. `useBuildModeController({ enabled: false })` erstellt einen inaktiven
Controller: Er behält `mode` im React-State und nimmt keine Änderungen an CSS-Klassen, Media Queries
oder dem localStorage vor. Wenn Ihre App das Theme bereits selbst verwaltet, benötigen Sie diesen
Hook überhaupt nicht: Übergeben Sie einfach Ihren eigenen Controller als `modeController`.

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
| `<AppBar>` | Obere Navigationsleiste mit Suche, Modus-Umschalter und Benutzermenü |
| `<Drawer>` | Seitliche Navigation mit Collection-Liste und Ansichts-Links |
| `<SideDialogs>` | Container für die seitlichen Datensatz-Editoren (Side Panels) |
| `<RebaseRoutes>` | Routen-Container, der sich in React Router integriert |
| `<RebaseRoute>` | Verarbeitet Collection-Routen (`/c/*`) |
| `<ContentHomePage>` | Standard-Startseite mit Collection-Karten |
| `<StudioHomePage>` | Startseite im Studio-Modus mit Entwickler-Tools |

## Benutzerdefinierte Ansichten

Fügen Sie Top-Level-Navigationsansichten für Dashboards, Tools oder benutzerdefinierte Seiten hinzu. Ein
`AppView` ist ein flaches Objekt — alles unten Aufgeführte befindet sich auf oberster Ebene, es gibt keinen
verschachtelten `admin`-Block:

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

Übergeben Sie sie an `<RebaseCMS>`, direkt neben Ihren Anpassungen — dies ist die
Komponente, welche die Navigation registriert:

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} views={views}/>
```

| Feld | |
|---|---|
| `slug` | der Pfad, unter dem die Ansicht unterhalb der Admin-Root erreichbar ist |
| `name` | die Beschriftung in der Seitenleiste (Drawer) und auf der Startseite |
| `view` | das zu rendernde Element oder ein `ComponentType`, um es lazy zu laden |
| `icon` | ein [Lucide](https://lucide.dev/icons/)-Icon-Name, z. B. `"ShoppingCart"` — oder ein beliebiger React-Node |
| `group` | gruppiert Ansichten in der Seitenleiste; `"Admin"` und `"Settings"` wandern nach ganz unten |
| `pinToBottom` | fixiert die Gruppe unter beliebigem Namen am unteren Rand — bevorzugen Sie dies gegenüber den beiden magischen Strings |
| `nestedRoutes` | registriert zusätzlich `slug/*` für Ansichten mit eigenen internen Routen |
| `hideFromNavigation` | behält die Route bei, entfernt jedoch den Eintrag aus der Navigation |
| `roles` | nur Benutzer mit einer dieser Rollen können die Ansicht sehen oder aufrufen |
| `description` | Markdown, wird auf der Karte der Startseite angezeigt |

Um eine Ansicht unter **Studio** statt unter dem CMS abzulegen, übergeben Sie sie an
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styling

Rebase verwendet **Tailwind CSS v4** und unterstützt Light- und Dark-Modes. Die Anpassung erfolgt über:

- **Benutzerdefinierte CSS-Properties** — Design-Tokens überschreiben
- **`<Rebase modeController>`** — Den Light-/Dark-Mode Ihrer App an Rebase übergeben
- **Tailwind-Konfiguration** — Standardmäßige Tailwind-Anpassung

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

### Light- und Dark-Mode

Standardmäßig steuert `<Rebase>` das Theme der Seite: Es setzt die `dark`-Klasse auf
`<html>`, folgt `prefers-color-scheme`, bis der Benutzer im Admin-Panel einen Modus wählt,
und speichert diese Auswahl im localStorage.

Wenn `<Rebase>`
unmounted wird, entfernt es die hinzugefügte `dark`-Klasse; eine bereits zuvor vorhandene Klasse der Seite
bleibt bestehen.

Wenn Ihre App
bereits ein Theme verwaltet, übergeben Sie dieses als `modeController`. Rebase liest `mode` daraus aus,
ruft dessen `setMode` über den eigenen Theme-Umschalter auf und fasst weder `<html>`,
`prefers-color-scheme` noch localStorage an:

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

Das CSS des Scaffolds wendet Dark-Mode-Styles unter jedem Element mit der `dark`-Klasse
an (`@custom-variant dark (&:where(.dark, .dark *))`). Da Side-Panels, Dialoge und
Menüs über ein Portal direkt auf `<body>` gerendert werden, sollten Sie die Klasse auf `<html>` oder `<body>`
anwenden, anstatt auf ein umschließendes Wrapper-Element um `<Rebase>`.

Das Umschließen von `<Rebase>` mit einem `ModeControllerProvider` erzielt diesen Effekt nicht:
`<Rebase>` stellt intern einen eigenen Controller bereit.

## Nächste Schritte

- **[customizeTable](/docs/frontend/customize-table)** — Alle Optionen für die Collection einer Tabelle
- **[Custom Fields](/docs/frontend/custom-fields)** — Eigene Formularfelder erstellen
- **[Entity Views](/docs/frontend/entity-views)** — Tabs zu Datensatz-Editoren hinzufügen
- **[View Modes](/docs/frontend/view-modes)** — Liste, Tabelle, Karten, Kanban
- **[Translations](/docs/frontend/i18n)** — Beliebige Zeichenketten anpassen oder eine Sprache hinzufügen
- **[Plugins](/docs/plugins)** — Das Framework erweitern
