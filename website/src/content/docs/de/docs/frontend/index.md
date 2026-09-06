---
sourceHash: 8e814603c912d2a1
title: Frontend-Übersicht
sidebar_label: Frontend
description: Erstellen und anpassen Sie das Rebase-Admin-Panel mit React — Controller, Scaffold, Routing und Ansichten.
---

## Übersicht

Das Rebase-Frontend ist ein **React-Framework**, das Ihr Admin-Panel rendert. Es liest Ihre Sammlungsdefinitionen und generiert automatisch Tabellen, Formulare, Navigation und Routing.

Im Standard-Scaffold **ist** das Admin-Panel das Frontend: Es wird im Root Ihrer bereitgestellten URL ausgeliefert. Wenn Sie stattdessen Ihre eigene Produkt-App bauen, können Sie den Admin unter einem Präfix wie `/admin` in derselben Bereitstellung einbinden — siehe [Basis-URL ändern](/docs/getting-started/deployment#changing-the-base-url).

Das hier ist `frontend/src/App.tsx`, so wie `rebase init` es schreibt — das
gesamte Admin-Panel, vier Deklarationen in einem Provider:

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

Die ersten drei rendern nichts: Sie *registrieren* Konfiguration im Provider.
`<RebaseShell>` ist das, was zeichnet — es liest diese Registry und baut daraus
Navigation, Routen und Layout. Die Reihenfolge, in der sie auftauchen, spielt
also keine Rolle, und ein Feature hinzuzufügen heißt, eine Komponente
hinzuzufügen, nicht einen Baum umzuverdrahten.

| Komponente | Paket | Registriert |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | den Anmeldebildschirm (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | Sammlungen, benutzerdefinierte Ansichten, die Startseite, den Sammlungs-Editor |
| `<RebaseStudio>` | `@rebasepro/studio` | die Entwickler-Tools (SQL, RLS, Logs, Backups …) |
| `<RebaseShell>` | `@rebasepro/cms` | nichts — es rendert den Admin aus allem darüber |

Lassen Sie `<RebaseStudio>` weg, haben Sie ein reines Content-CMS; lassen Sie
`<RebaseCMS>` weg, haben Sie allein die Entwickler-Tools. Um die Shell
stattdessen von Hand zu layouten, siehe
[Fortgeschritten: manuelles Layout](#fortgeschritten-manuelles-layout).

## Der Rebase-Provider

`<Rebase>` ist der Root-Provider, der alle Rebase-Funktionalitäten für untergeordnete Komponenten über den Kontext verfügbar macht. Er akzeptiert:

Alle zweiundzwanzig, vollständig — die Tabelle listete früher zehn, und zwei
davon waren Props, die die Komponente nie gelesen hat:

<!-- rebase-props:start -->
| Prop | Beschreibung |
|------|-------------|
| `children` | Die Root-Komponenten des Admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Eine Render-Funktion ist der Notausgang für manuelles Layout. |
| `apiUrl` | Basis-URL der Backend-API, jedem Hook über `useApiConfig()` zugänglich gemacht |
| `dateTimeFormat` | Wie Datumsangaben ausgegeben werden. Voreinstellung: `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Anfangssprache des Admin und Locale, in dem Datumsangaben formatiert werden — siehe [Übersetzungen](/docs/frontend/i18n) |
| `client` | `RebaseClient`-Instanz: die Standardquelle für Daten, Authentifizierung und Storage |
| `dataSources` | Zusätzliche Datenquellen für Sammlungen, die eine benennen — siehe [Mehrere Quellen](/docs/backend/multiple-sources) |
| `authController` | Authentifizierungszustand und -methoden. Ersetzt das `client.auth`-Abonnement vollständig |
| `storageSource` | Die Standard-Storage-Quelle, die `client.storage` überschreibt |
| `storageSources` | Benannte Storage-Quellen über die Standardquelle hinaus |
| `databaseAdmin` | Administrative Datenbankoperationen (SQL, Schema-Erkennung). Nur Studio braucht sie |
| `userConfigPersistence` | Lokale UI-Einstellungen — Spaltenbreiten, eingeklappte Gruppen |
| `onAnalyticsEvent` | Wird für jedes Analytics-Ereignis aufgerufen, das der Admin ausgibt |
| `entityLinkBuilder` | Liefert eine URL für die Schaltfläche „In Ihrer App öffnen“ auf einem Entitätsformular |
| `plugins` | Plugin-Instanzen — siehe [Plugins](/docs/plugins) |
| `slots` | Slot-Beiträge, direkt deklariert, ohne Plugin |
| `propertyConfigs` | Eigene Feld-Widgets, indiziert über den Namen, den eine Property in `propertyConfig` nennt |
| `entityViews` | Globale benutzerdefinierte Entitätsansichts-Tabs |
| `collectionViews` | Eigene Sammlungs-Ansichtsmodi, über `key` für jede Sammlung verfügbar |
| `entityActions` | Globale Entitätsaktionen |
| `effectiveRoleController` | Eine andere Rolle simulieren, solange der Dev-Modus an ist |
| `translations` | Beliebige UI-Zeichenkette überschreiben oder ergänzen, nach Locale indiziert — siehe [Übersetzungen](/docs/frontend/i18n) |
| `components` | Eingebaute Komponenten ersetzen — siehe [Komponenten-Überschreibungen](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Die Controller für Navigation, URL und Sammlungs-Registry sind **keine**
`<Rebase>`-Props — sie werden von den Hooks weiter unten gebaut und innerhalb des
Admin-Baums konsumiert (`<RebaseShell>` verdrahtet sie im Standard-Scaffold für
Sie).

Das Präfix der URL ebenso wenig. Wenn der Admin unter einem Pfad eingebunden ist,
gehört das an `<RebaseCMS basePath="/admin">`, denn diese Komponente löst URLs zu
Sammlungen auf — und nur dann, wenn der Router keinen eigenen `basename` hat.
Siehe [Basis-URL ändern](/docs/getting-started/deployment#changing-the-base-url).

## Zwei Datenformen

Es gibt zwei Datenschichten, und sie sind **nicht** austauschbar. Die eine dort
zu übergeben, wo die andere erwartet wird, ist ein Typfehler — es lohnt sich
also, das zu wissen, bevor Sie einen Controller von Hand verdrahten.

| | Form | Woher Sie sie bekommen | Wie eine Zeile aussieht |
|---|---|---|---|
| **SDK** | `RebaseSdkData` — flache Zeilen | `client.data` und `context.data` in Backend-Callbacks | `row.title` |
| **Admin** | `RebaseData` — `Entity`-View-Model | `useData()`, innerhalb des `<Rebase>`-Baums | `entity.values.title` |

Die SDK-Schicht ist die öffentliche, symmetrische Oberfläche: identisch im
Frontend-Client und in Backend-Callbacks. Die `Entity`-Schicht ist das
View-Model des Admin — sie ergänzt die Hülle aus `id` / `path` / `values`,
gegen die die Sammlungsansichten und Formulare rendern. `CollectionAccessor` und
`FindResponse` gehören zu ihr und sind genau deshalb als `@internal` markiert.

`<Rebase>` ist die Grenze zwischen beiden: Es nimmt Ihr flaches `client.data` und
verpackt es mit `wrapAsEntityData()`, bevor es das als `RebaseData` des Admin
bereitstellt. Sie rufen das nie selbst auf — Sie holen sich einfach die Form, die
Sie brauchen, von der richtigen Stelle:

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

## Fortgeschritten: manuelles Layout

Alles unterhalb ersetzt `<RebaseShell>`. Sie brauchen es nur, wenn das
Standard-Layout im Weg ist — ein anderer Rahmen um den Admin, ein eigener
Routenbaum, eine App, in der der Admin eine Seite unter vielen ist. Wenn Sie das
Layout nicht ersetzen, hören Sie bei
[Benutzerdefinierte Ansichten](#benutzerdefinierte-ansichten) auf.

`<RebaseShell>` ist syntaktischer Zucker für vier Schichten, und Sie können sie
einzeln übernehmen:

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

Die Reihenfolge steht fest: `RebaseAuthGate → RebaseNavigation →
RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` zeigt die Login-Ansicht,
solange es keinen Benutzer gibt, sodass für nicht angemeldete Besucher nichts
darunter rendert; `RebaseNavigation` baut die Controller für Navigation, URL und
Sammlungs-Registry, die `RebaseRouteDefs` und jede Sammlungsansicht lesen —
`RebaseRouteDefs` außerhalb davon wirft daher.

Jede Schicht ist für sich benutzbar. `<RebaseAuthGate>` allein stellt Ihre eigene
App hinter Rebases Login. Tauschen Sie `<RebaseLayout>` gegen Ihre eigene
Komponente, um das Routing zu behalten und den Rahmen loszuwerden; lassen Sie
`<RebaseRouteDefs>` ebenfalls weg, und Sie bauen die Routen selbst aus den
Komponenten unter [Scaffold-Komponenten](#scaffold-komponenten).

Noch unterhalb dieser Ebene akzeptiert `<Rebase>` auch eine **Render-Prop**
anstelle von Children, die Ihnen den Kontext und das Ladeflag übergibt und den
gesamten Baum Ihnen überlässt:

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

An diesem Punkt ist nichts mehr für Sie verdrahtet: Sie bauen die Controller
unten von Hand und rendern die Routen selbst.

### Controller

Controller sind React-Hooks, die spezifische Aspekte des Frameworks
konfigurieren. `<RebaseNavigation>` ruft sie alle für Sie auf — greifen Sie nur
innerhalb einer Render-Prop danach.

#### `useBuildNavigationStateController`

Der Haupt-Controller, der alles miteinander verbindet:

Sein `data` ist das **Entity-förmige** `RebaseData`, kommt also aus `useData()` —
nicht aus `rebaseClient.data`, der SDK-Schicht mit flachen Zeilen. `<Rebase>`
wandelt das eine für Sie in das andere um (siehe
[Zwei Datenformen](#zwei-datenformen) oben), dieser Hook muss also innerhalb des
`<Rebase>`-Baums aufgerufen werden.

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

Verwaltet, wie Sammlungen aus URL-Pfaden aufgelöst werden:

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

Verwaltet das helle/dunkle Thema:

```typescript
const modeController = useBuildModeController();
// Provides: modeController.mode ("light" | "dark"), modeController.toggleMode()
```

#### `useBuildAdminModeController`

Schaltet zwischen Studio- und Inhaltsmodus um:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Scaffold-Komponenten

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

Fügen Sie übergeordnete Navigationsansichten für Dashboards, Tools oder
benutzerdefinierte Seiten hinzu. Ein `AppView` ist ein flaches Objekt — alles
Folgende sitzt auf oberster Ebene, es gibt keinen verschachtelten
`admin`-Block:

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

Übergeben Sie sie an `<RebaseCMS>`, neben Ihre Sammlungen — das ist die
Komponente, die Navigation registriert:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Feld | |
|---|---|
| `slug` | der Pfad, unter dem sie erreichbar ist, unterhalb des Admin-Roots |
| `name` | die Beschriftung in der Schublade und auf der Startseite |
| `view` | das zu rendernde Element oder ein `ComponentType`, um es lazy zu rendern |
| `icon` | ein [Lucide](https://lucide.dev/icons/)-Icon-Name, z. B. `"ShoppingCart"` — oder ein beliebiger Node |
| `group` | gruppiert Ansichten in der Schublade; `"Admin"` und `"Settings"` sinken nach unten |
| `pinToBottom` | lässt die Gruppe unter jedem Namen nach unten sinken — dem sind die zwei magischen Strings vorzuziehen |
| `nestedRoutes` | registriert auch `slug/*`, für eine Ansicht mit eigenen Routen |
| `hideFromNavigation` | behält die Route, streicht den Navigationseintrag |
| `roles` | nur Benutzer mit einer dieser Rollen sehen die Ansicht oder erreichen sie |
| `description` | Markdown, auf der Karte der Startseite angezeigt |

Um eine Ansicht stattdessen unter **Studio** einzuhängen, übergeben Sie sie an
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styling

Rebase verwendet **Tailwind CSS v4** und unterstützt helle/dunkle Modi. Anpassung über:

- **CSS-Benutzereigenschaften** — Design-Tokens überschreiben
- **`ModeControllerProvider`** — Steuerung des hellen/dunklen Modus
- **Tailwind-Konfiguration** — Standard-Tailwind-Anpassung

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

## Nächste Schritte

- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Erstellen Sie benutzerdefinierte Formularfelder
- **[Entitätsansichten](/docs/frontend/entity-views)** — Fügen Sie Tabs zu Entitäts-Editoren hinzu
- **[Ansichtsmodi](/docs/frontend/view-modes)** — Liste, Tabelle, Karten, Kanban
- **[Übersetzungen](/docs/frontend/i18n)** — Ändern Sie jede Zeichenkette oder fügen Sie eine Sprache hinzu
- **[Plugins](/docs/plugins)** — Erweitern Sie das Framework
