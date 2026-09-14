---
sourceHash: 6c59cbcf5c1ee91f
title: Frontend-Übersicht
sidebar_label: Frontend
description: "Erstellen und Anpassen des Panels — Rebase CMS und Rebase Studio — mit React: Controller, Scaffold, Routing und Views."
---

## Übersicht

Das Rebase-Frontend ist ein **React-Framework**, das Ihr Admin-Panel rendert. Es liest Ihre Collection-Definitionen ein und generiert automatisch Tabellen, Formulare, Navigation und Routing.

Im Standard-Scaffold **ist** das Admin-Panel das Frontend: Es wird am Root Ihrer bereitgestellten URL ausgeliefert. Wenn Sie stattdessen eine eigene Produkt-App erstellen, können Sie das Admin-Panel unter einem Präfix wie `/admin` im selben Deployment einbinden — siehe [Changing the Base URL](/docs/getting-started/deployment#changing-the-base-url).

So sieht `frontend/src/App.tsx` aus, wie es von `rebase init` generiert wird — das gesamte Admin-Panel, vier Deklarationen innerhalb eines Providers:

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

Die ersten drei Komponenten rendern nichts: Sie *registrieren* Konfigurationen im Provider. `<RebaseShell>` übernimmt das eigentliche Rendern — es liest diese Registrierungen und baut daraus die Navigation, Routen und das Layout auf. Die Reihenfolge, in der sie deklariert werden, spielt daher keine Rolle, und das Hinzufügen einer Funktion bedeutet lediglich das Hinzufügen einer Komponente, anstatt einen Komponentenbaum umzubauen.

| Komponente | Paket | Registriert |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | den Anmeldebildschirm (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | Collections, benutzerdefinierte Views, die Startseite, den Collection-Editor |
| `<RebaseStudio>` | `@rebasepro/studio` | die Entwickler-Tools (SQL, RLS, Logs, Backups…) |
| `<RebaseShell>` | `@rebasepro/cms` | nichts — rendert das Admin-Panel aus allem Obigen |

Entfernen Sie `<RebaseStudio>`, erhalten Sie ein reines Content-CMS; entfernen Sie `<RebaseCMS>`, verbleiben nur die Entwickler-Tools. Wie Sie die Shell stattdessen manuell anordnen, erfahren Sie unter [Erweitert: Manuelles Layout](#erweitert-manuelles-layout).

## Der Rebase-Provider

`<Rebase>` ist der Root-Provider, der alle Rebase-Funktionen für untergeordnete Komponenten über den Context verfügbar macht. Er akzeptiert:

Alle 22 Props im Detail — die Tabelle führte früher zehn auf, von denen zwei Props waren, die die Komponente nie ausgewertet hat:

<!-- rebase-props:start -->
| Prop | Beschreibung |
|------|-------------|
| `children` | Die Root-Komponenten des Admins — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Eine Render-Funktion dient als Ausweg für ein manuelles Layout. |
| `apiUrl` | Basis-URL der Backend-API, die jedem Hook über `useApiConfig()` zur Verfügung gestellt wird |
| `dateTimeFormat` | Bestimmt, wie Datumsangaben ausgegeben werden. Standardwert ist `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Ausgangssprache des Admins und das Locale, in dem Datumsangaben formatiert werden — siehe [Translations](/docs/frontend/i18n) |
| `client` | `RebaseClient`-Instanz: die Standardquelle für Daten, Authentifizierung und Storage |
| `dataSources` | Zusätzliche Datenquellen für Collections, die eine solche benennen — siehe [Multiple sources](/docs/backend/multiple-sources) |
| `authController` | Authentifizierungsstatus und -methoden. Ersetzt das `client.auth`-Abonnement vollständig |
| `storageSource` | Die Standard-Storage-Quelle, überschreibt `client.storage` |
| `storageSources` | Zusätzliche benannte Storage-Quellen über den Standard hinaus |
| `databaseAdmin` | Administrative Datenbankoperationen (SQL, Schema-Discovery). Wird nur von Studio benötigt |
| `userConfigPersistence` | Lokale UI-Einstellungen — Spaltenbreiten, eingeklappte Gruppen |
| `onAnalyticsEvent` | Wird für jedes Analytics-Event aufgerufen, das das Admin-Panel auslöst |
| `entityLinkBuilder` | Gibt eine URL für die Schaltfläche „In der App öffnen“ auf einem Entity-Formular zurück |
| `plugins` | Plugin-Instanzen — siehe [Plugins](/docs/plugins) |
| `slots` | Direkt deklarierte Slot-Erweiterungen, ohne Plugin |
| `propertyConfigs` | Benutzerdefinierte Feld-Widgets, zugeordnet über den Namen, den eine Eigenschaft in `propertyConfig` angibt |
| `entityViews` | Globale benutzerdefinierte Entity-View-Tabs |
| `collectionViews` | Benutzerdefinierte Collection-View-Modi, verfügbar für jede Collection über `key` |
| `entityActions` | Globale Entity-Aktionen |
| `effectiveRoleController` | Simuliert eine andere Rolle, während der Dev-Modus aktiv ist |
| `translations` | Überschreibt oder erweitert beliebige UI-Strings, zugeordnet nach Locale — siehe [Translations](/docs/frontend/i18n) |
| `components` | Ersetzt integrierte Komponenten — siehe [Component Overrides](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Die Controller für Navigation, URLs und die Collection-Registry sind **keine** Props von `<Rebase>` — sie werden von den unten stehenden Hooks erstellt und innerhalb des Admin-Baums verwendet (`<RebaseShell>` verdrahtet sie im Standard-Scaffold für Sie).

Dasselbe gilt für das URL-Präfix. Wenn das Admin-Panel unter einem Pfad eingebunden wird, gehört dies zu `<RebaseCMS basePath="/admin">`, welches URLs zu Collections auflöst — und das nur, wenn der Router keinen eigenen `basename` besitzt. Siehe [Changing the Base URL](/docs/getting-started/deployment#changing-the-base-url).

## Zwei Datenstrukturen

Es gibt zwei Datenebenen, und diese sind **nicht** austauschbar. Die eine zu übergeben, wo die andere erwartet wird, führt zu einem Typfehler. Es lohnt sich also, dies zu wissen, bevor Sie einen Controller manuell verdrahten.

| | Struktur | Woher Sie sie erhalten | Wie eine Zeile aussieht |
|---|---|---|---|
| **SDK** | `RebaseSdkData` — flache Zeilen | `client.data`, und `context.data` in Backend-Callbacks | `row.title` |
| **Admin** | `RebaseData` — `Entity`-View-Model | `useData()`, innerhalb des `<Rebase>`-Baums | `entity.values.title` |

Die SDK-Ebene ist die öffentliche, symmetrische Schnittstelle: identisch auf dem Frontend-Client und in Backend-Callbacks. Die `Entity`-Ebene ist das View-Model des Admins — sie fügt den Wrapper aus `id` / `path` / `values` hinzu, gegen den die Collection-Views und -Formulare rendern. `CollectionAccessor` und `FindResponse` gehören dazu und sind aus diesem Grund als `@internal` markiert.

`<Rebase>` bildet die Grenze zwischen beiden: Es nimmt Ihre flachen `client.data` und wrappt sie mit `wrapAsEntityData()`, bevor es sie als `RebaseData` des Admins bereitstellt. Sie rufen dies nie selbst auf — Sie beziehen einfach die benötigte Struktur von der richtigen Stelle:

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

## Erweitert: Manuelles Layout

Alles Folgende ersetzt `<RebaseShell>`. Sie benötigen dies nur, wenn das Standard-Layout im Weg ist — ein anderes Chrome rund um das Admin-Panel, ein eigener Routing-Baum oder eine App, in der das Admin-Panel nur eine von vielen Seiten darstellt. Wenn Sie das Layout nicht ersetzen, können Sie direkt zu [Benutzerdefinierte Views](#benutzerdefinierte-views) springen.

`<RebaseShell>` ist syntaktischer Zucker für vier Ebenen, die Sie auch einzeln verwenden können:

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

Die Reihenfolge ist festgelegt: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` zeigt die Login-Ansicht an, bis ein Benutzer angemeldet ist, sodass für nicht angemeldete Besucher nichts darunter gerendert wird; `RebaseNavigation` erstellt die Controller für Navigation, URLs und die Collection-Registry, die von `RebaseRouteDefs` und jeder Collection-View gelesen werden, weshalb `RebaseRouteDefs` außerhalb davon einen Fehler auslöst.

Jede Ebene kann für sich allein verwendet werden. `<RebaseAuthGate>` allein schützt Ihre eigene App hinter dem Login von Rebase. Ersetzen Sie `<RebaseLayout>` durch Ihre eigene Komponente, um das Routing beizubehalten und das Standard-Chrome zu entfernen; lassen Sie auch `<RebaseRouteDefs>` weg, bauen Sie die Routen selbst aus den Komponenten in [Scaffold-Komponenten](#scaffold-komponenten).

Darüber hinaus akzeptiert `<Rebase>` auch eine **Render-Prop** anstelle von Children, die Ihnen den Context sowie das Loading-Flag übergibt und den gesamten Baum Ihnen überlässt:

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

An diesem Punkt ist nichts mehr für Sie vorverdrahtet: Sie erstellen die folgenden Controller manuell und rendern die Routen selbst.

### Controller

Controller sind React-Hooks, die bestimmte Aspekte des Frameworks konfigurieren. `<RebaseNavigation>` ruft alle davon für Sie auf — greifen Sie nur innerhalb einer Render-Prop darauf zurück.

#### `useBuildNavigationStateController`

Der Haupt-Controller, der alles miteinander verdrahtet:

Sein `data`-Wert ist das **Entity-förmige** `RebaseData` und stammt daher von `useData()` — nicht von `rebaseClient.data`, der SDK-Ebene mit flachen Zeilen. `<Rebase>` wandelt das eine für Sie in das andere um (siehe [Zwei Datenstrukturen](#zwei-datenstrukturen)), daher muss dieser Hook innerhalb des `<Rebase>`-Baums aufgerufen werden.

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

Verwaltet das Light-/Dark-Theme:

```typescript
const modeController = useBuildModeController();
// Provides: modeController.mode ("light" | "dark"), modeController.toggleMode()
```

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
| `<Drawer>` | Seitliche Navigation mit Collection-Liste und View-Links |
| `<SideDialogs>` | Container für Entity-Editoren im Seitenpanel |
| `<RebaseRoutes>` | Routen-Container mit React-Router-Integration |
| `<RebaseRoute>` | Verarbeitet Collection-Routen (`/c/*`) |
| `<ContentHomePage>` | Standard-Startseite mit Collection-Karten |
| `<StudioHomePage>` | Startseite des Studio-Modus mit Entwickler-Tools |

## Benutzerdefinierte Views

Fügen Sie Navigationsansichten auf oberster Ebene für Dashboards, Tools oder benutzerdefinierte Seiten hinzu. Ein `AppView` ist ein flaches Objekt — alle Eigenschaften liegen auf oberster Ebene, es gibt keinen verschachtelten `admin`-Block:

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

Übergeben Sie diese an `<RebaseCMS>`, zusammen mit Ihren Collections — dies ist die Komponente, die die Navigation registriert:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Feld | |
|---|---|
| `slug` | Der Pfad unterhalb des Admin-Roots, unter dem der Eintrag erreichbar ist |
| `name` | Die Beschriftung im Drawer und auf der Startseite |
| `view` | Das zu rendernde Element oder ein `ComponentType`, um es lazy zu rendern |
| `icon` | Ein [Lucide](https://lucide.dev/icons/)-Icon-Name, z. B. `"ShoppingCart"` — oder ein beliebiger Node |
| `group` | Gruppiert Views im Drawer; `"Admin"` und `"Settings"` wandern nach ganz unten |
| `pinToBottom` | Platziert die Gruppe unter beliebigem Namen ganz unten — dies ist den beiden magischen Strings vorzuziehen |
| `nestedRoutes` | Registriert zusätzlich `slug/*` für eine View mit eigenen Routen |
| `hideFromNavigation` | Behält die Route bei, blendet den Eintrag jedoch in der Navigation aus |
| `roles` | Nur Benutzer mit mindestens einer dieser Rollen sehen die View bzw. können darauf zugreifen |
| `description` | Markdown, das auf der Karte der Startseite angezeigt wird |

Um eine View im **Studio** anstelle des CMS anzuzeigen, übergeben Sie sie an [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styling

Rebase verwendet **Tailwind CSS v4** und unterstützt Light-/Dark-Modi. Anpassungen sind möglich über:

- **CSS Custom Properties** — Überschreiben von Design-Tokens
- **`ModeControllerProvider`** — Steuerung des Light-/Dark-Modus
- **Tailwind-Konfiguration** — Standardmäßige Tailwind-Anpassungen

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

## Nächste Schritte

- **[Custom Fields](/docs/frontend/custom-fields)** — Erstellen Sie benutzerdefinierte Formularfelder
- **[Entity Views](/docs/frontend/entity-views)** — Fügen Sie Tabs zu Entity-Editoren hinzu
- **[View Modes](/docs/frontend/view-modes)** — Liste, Tabelle, Karten, Kanban
- **[Translations](/docs/frontend/i18n)** — Beliebige Strings anpassen oder eine neue Sprache hinzufügen
- **[Plugins](/docs/plugins)** — Das Framework erweitern
