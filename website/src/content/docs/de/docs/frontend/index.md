---
sourceHash: 758100d13ca5c533
title: Frontend-Übersicht
sidebar_label: Frontend
description: "Erstellen und passen Sie das Panel an — Rebase CMS und Rebase Studio — mit React: Controller, Scaffold, Routing und Views."
---

## Übersicht

Das Rebase-Frontend ist ein **React-Framework**, das Ihr Admin-Panel rendert. Es liest Ihre Collection-Definitionen und generiert automatisch Tabellen, Formulare, Navigation und Routing.

Im Standard-Scaffold **ist** das Admin-Panel das Frontend: Es wird im Root Ihrer bereitgestellten URL ausgeliefert. Wenn Sie stattdessen Ihre eigene Produkt-App erstellen, können Sie den Admin unter einem Präfix wie `/admin` im selben Deployment mounten – siehe [Ändern der Basis-URL](/docs/getting-started/deployment#changing-the-base-url).

Dies ist `frontend/src/App.tsx`, wie es von `rebase init` generiert wird, ohne dessen Schriftart-Importe, Error Boundary und Google-Client-ID – das gesamte Admin-Panel, vier Deklarationen innerhalb eines Providers:

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

Die ersten drei rendern nichts: Sie *registrieren* Konfigurationen im Provider. `<RebaseShell>` übernimmt das Rendern – es liest diese Registry aus und baut daraus die Navigation, Routen und das Layout. Die Reihenfolge, in der sie erscheinen, spielt daher keine Rolle, und das Hinzufügen eines Features bedeutet das Hinzufügen einer Komponente, nicht das Umbauen eines Komponentenbaums.

| Komponente | Paket | Registriert |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | den Anmeldebildschirm (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | Collections, benutzerdefinierte Views, die Startseite, den Collection-Editor |
| `<RebaseStudio>` | `@rebasepro/studio` | die Entwicklertools (SQL, RLS, Logs, Backups …) |
| `<RebaseShell>` | `@rebasepro/cms` | nichts – es rendert den Admin aus allem Vorherigen |

Entfernen Sie `<RebaseStudio>`, und Sie haben ein reines Content-CMS; entfernen Sie `<RebaseCMS>`, und Sie erhalten nur die Entwicklertools. Wie Sie die Shell stattdessen manuell layouten, erfahren Sie unter [Fortgeschritten: Manuelles Layout](#fortgeschritten-manuelles-layout).

## Der Rebase-Provider

`<Rebase>` ist der Root-Provider, der alle Rebase-Funktionalitäten für untergeordnete Komponenten über den Kontext bereitstellt. Er akzeptiert:

Alle dreiundzwanzig Props vollständig – zuvor listete die Tabelle zehn auf, und zwei davon waren Props, die die Komponente nie gelesen hat:

<!-- rebase-props:start -->
| Prop | Beschreibung |
|------|-------------|
| `children` | Die Root-Komponenten des Admins – `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Eine Render-Funktion dient als Escape-Hatch für manuelles Layout. |
| `apiUrl` | Basis-URL der Backend-API, die jedem Hook über `useApiConfig()` zur Verfügung gestellt wird |
| `dateTimeFormat` | Formatierung von Datumsangaben. Standardwert ist `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Ausgangssprache des Admins und das Gebietsschema (Locale), in dem Datumsangaben formatiert werden – siehe [Übersetzungen](/docs/frontend/i18n) |
| `client` | `RebaseClient`-Instanz: die Standardquelle für Daten, Authentifizierung und Speicher |
| `dataSources` | Zusätzliche Datenquellen für Collections, die eine solche angeben – siehe [Mehrere Datenquellen](/docs/backend/multiple-sources) |
| `authController` | Authentifizierungsstatus und -methoden. Ersetzt das `client.auth`-Abonnement vollständig |
| `storageSource` | Die Standard-Speicherquelle, die `client.storage` überschreibt |
| `storageSources` | Benannte Speicherquellen über die Standardquelle hinaus |
| `databaseAdmin` | Administrative Datenbankoperationen (SQL, Schema-Erkennung). Wird nur von Studio benötigt |
| `userConfigPersistence` | Lokale UI-Einstellungen – Spaltenbreiten, eingeklappte Gruppen |
| `onAnalyticsEvent` | Wird bei jedem vom Admin ausgelösten Analytics-Event aufgerufen |
| `entityLinkBuilder` | `({ row, id, path }) => string`: Die URL für die "In App öffnen"-Schaltfläche eines Datensatzes, basierend auf dem Datensatz, wie ihn der Server als Zeile sendet |
| `plugins` | Plugin-Instanzen – siehe [Plugins](/docs/plugins) |
| `slots` | Slot-Beiträge, die direkt ohne Plugin deklariert werden |
| `propertyConfigs` | Benutzerdefinierte Feld-Widgets, indexiert nach dem Namen, den eine Eigenschaft in `propertyConfig` angibt |
| `entityViews` | Benutzerdefinierte Tabs für Entity-Views, verfügbar für jede Collection, die deren `key` in `admin.entityViews` benennt |
| `collectionViews` | Benutzerdefinierte Collection-Ansichtsmodi, verfügbar für jede Collection per `key` |
| `entityActions` | Entity-Aktionen, verfügbar für jede Collection, die deren `key` in `admin.entityActions` benennt |
| `effectiveRoleController` | Simulieren einer anderen Rolle bei aktivem Entwicklungsmodus |
| `modeController` | Übergibt Rebase den Light-/Dark-Mode der Host-App; Rebase fasst dann `<html>`, `prefers-color-scheme` oder localStorage nicht an – siehe [Styling](#styling) |
| `translations` | Überschreiben oder Erweitern beliebiger UI-Strings, indexiert nach Locale – siehe [Übersetzungen](/docs/frontend/i18n) |
| `components` | Ersetzen integrierter Komponenten – siehe [Komponenten-Overrides](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Die Controller für Navigation, URL und Collection-Registry sind **keine** `<Rebase>`-Props – sie werden von den unten aufgeführten Hooks erstellt und innerhalb des Admin-Baums konsumiert (`<RebaseShell>` verdrahtet diese im Standard-Scaffold automatisch für Sie).

Das gilt auch für das URL-Präfix. Wenn der Admin unter einem Pfad gemountet wird, gehört dies zu `<RebaseCMS basePath="/admin">`, welches URLs zu Collections auflöst – und das auch nur dann, wenn der Router keinen eigenen `basename` besitzt. Siehe [Ändern der Basis-URL](/docs/getting-started/deployment#changing-the-base-url).

## Eine einheitliche Datenstruktur

Ihr Code erhält Zeilen (Rows) genau so, wie der Server sie sendet, egal wo sie angefragt werden: `client.data`, `context.data` (sowohl in einem Backend-Callback als auch im Browser), `useRows`, `useRow` und `useRowWrites`, das `data` der Collection- und View-Builder und das, was an die `browserCallbacks` einer Collection übergeben wird. Eine Zeile ist ein flaches Objekt: `row.title`, ein Datum als ISO-String, eine belongsTo-Relation als Fremdschlüsselspalte.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

Der Admin selbst rendert ein `Entity`-View-Model – den `id` / `path` / `values`-Wrapper, aus dem seine Collection-Views und -Formulare schöpfen, mit Datumsangaben als `Date`-Objekten und Relationen als `EntityRelation`. Diese Schicht ist admin-intern und nicht Teil der öffentlichen Schnittstelle: Einer Entity-Aktion, einem Display-Resolver, dem `tableController.rows` eines View-Modus-`Builder`s, der Selektion einer Collection-Aktion und einem Slot werden jeweils Zeilen (Rows) übergeben. Sie begegnen `Entity` nur in einer Kopie eines der admin-eigenen Bausteine (`Collection.Table`, einer Karte), der der Datensatz so übergeben wird, wie der Admin ihn darstellt. Die Werte eines Formulars entsprechen denen des Editors: `Date`-Objekte und Relationen, so wie ein Feld sie bearbeitet.

## Eine Collection oder ein Datensatz in einer eigenen Seite

Sie benötigen nicht den gesamten Admin, um eine einzelne Tabelle anzuzeigen. `<CollectionPanel>`, `<EntityFormPanel>`, `<EntityViewPanel>` und `<FieldValue>` funktionieren überall unter `<Rebase>` und einem React-Router-Router, ganz ohne `<RebaseCMS>`, `<RebaseNavigation>` oder `<RebaseShell>`: eine Collection mit den von Ihnen gewählten Spalten und Werkzeugleisten, das Formular eines Datensatzes mit nur bestimmten Feldern oder einem eigenen Layout, ein einzelner schreibgeschützter Datensatz oder ein einzelner Wert, dargestellt wie im Admin. Siehe [Panels in einer eigenen Seite](/docs/frontend/panels).

## Fortgeschritten: Manuelles Layout

Alles Folgende ersetzt `<RebaseShell>`. Sie benötigen dies nur, wenn das Standard-Layout im Weg ist – ein anderer Rahmen (Chrome) um den Admin, ein eigener Routenbaum, eine App, in der der Admin nur eine Seite unter vielen ist. Wenn Sie das Layout nicht ersetzen möchten, springen Sie direkt zu [Benutzerdefinierte Views](#benutzerdefinierte-views).

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

Die Reihenfolge ist festgelegt: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` zeigt die Login-Ansicht an, bis ein Benutzer angemeldet ist, sodass für nicht angemeldete Besucher nichts darunter gerendert wird; `RebaseNavigation` erstellt die Controller für Navigation, URL und Collection-Registry, die von `RebaseRouteDefs` und jeder Collection-View gelesen werden – ein Aufruf von `RebaseRouteDefs` außerhalb wirft daher einen Fehler. Um eine Collection-View oder ein Datensatz-Formular in eine eigene Seite ohne die Routen des Admins einzubetten, erstellt der schlankere `CollectionsProvider` stattdessen diese Controller – siehe [Panels in einer eigenen Seite](/docs/frontend/panels).

Jede Schicht kann eigenständig verwendet werden. `<RebaseAuthGate>` allein schützt Ihre eigene App hinter dem Login von Rebase. Tauschen Sie `<RebaseLayout>` gegen eine eigene Komponente aus, um das Routing beizubehalten und den Rahmen zu entfernen; lassen Sie auch `<RebaseRouteDefs>` weg, und Sie bauen die Routen selbst aus den Komponenten unter [Scaffold-Komponenten](#scaffold-komponenten) auf.

Darunter akzeptiert `<Rebase>` anstelle von Children auch ein **Render-Prop**, das Ihnen den Kontext und das Loading-Flag übergibt und den gesamten Baum Ihnen überlässt:

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

An diesem Punkt ist nichts mehr automatisch vorkonfiguriert: Sie erstellen die unten genannten Controller manuell und rendern die Routen selbst.

### Controller

Controller sind React-Hooks, die bestimmte Aspekte des Frameworks konfigurieren. `<RebaseNavigation>` ruft alle davon für Sie auf – greifen Sie nur innerhalb eines Render-Props auf diese zurück.

#### `useBuildNavigationStateController`

Der Hauptcontroller, der alles miteinander verbindet:

Sein `data` ist das, was den Collection- und View-Buildern übergeben wird: das flache `context.data` des umschließenden `<Rebase>` (siehe [Eine einheitliche Datenstruktur](#eine-einheitliche-datenstruktur)), daher muss dieser Hook innerhalb des `<Rebase>`-Baums aufgerufen werden.

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

Verwaltet das Light-/Dark-Theme. Solange aktiviert, steuert er das Theme der Seite: Er setzt die `dark`-Klasse auf `<html>`, folgt `prefers-color-scheme`, bis der Benutzer einen Modus auswählt, und speichert diese Auswahl im localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` erstellt einen solchen Controller standardmäßig selbst.

Wenn die Komponente, die ihn verwendet, unmounted wird, entfernt sie die hinzugefügte `dark`-Klasse wieder; eine bereits vorhandene `dark`-Klasse der Seite bleibt bestehen. Erstellen Sie einen eigenen Controller oberhalb von `<Rebase>` nur dann, wenn auch Komponenten außerhalb den Modus benötigen, und übergeben Sie ihn mit der [`modeController`-Prop](#styling), damit es nur einen und nicht zwei Controller gibt. `useBuildModeController({ enabled: false })` erstellt einen inaktiven Controller: Er hält `mode` im React-State und nimmt keine Änderungen an Klassen, Media Queries oder dem localStorage vor. Wenn Ihre App das Theme bereits selbst verwaltet, benötigen Sie diesen Hook überhaupt nicht: Übergeben Sie einfach Ihren eigenen Controller als `modeController`.

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
| `<Drawer>` | Seitliche Navigation mit Collection-Liste und View-Links |
| `<SideDialogs>` | Container für Entity-Editoren im Seitenpanel |
| `<RebaseRoutes>` | Routen-Container, der sich in React Router integriert |
| `<RebaseRoute>` | Verarbeitet Collection-Routen (`/c/*`) |
| `<ContentHomePage>` | Standard-Startseite mit Collection-Karten |
| `<StudioHomePage>` | Studio-Startseite mit Entwicklertools |

## Benutzerdefinierte Views

Fügen Sie Top-Level-Navigations-Views für Dashboards, Tools oder benutzerdefinierte Seiten hinzu. Ein `AppView` ist ein flaches Objekt – alles Nachfolgende befindet sich auf oberster Ebene, es gibt keinen verschachtelten `admin`-Block:

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
| `icon` | ein [Lucide](https://lucide.dev/icons/)-Icon-Name, z. B. `"ShoppingCart"` – oder ein beliebiger React-Node |
| `group` | gruppiert Views im Drawer; `"Admin"` und `"Settings"` werden nach unten verschoben |
| `pinToBottom` | verschiebt die Gruppe unter beliebigem Namen nach unten – bevorzugen Sie dies gegenüber den beiden magischen Strings |
| `nestedRoutes` | registriert zusätzlich `slug/*` für eine View mit eigenen Routen |
| `hideFromNavigation` | behält die Route bei, entfernt den Navigationseintrag |
| `roles` | nur Benutzer mit einer dieser Rollen sehen die View oder können darauf zugreifen |
| `description` | Markdown, wird auf der Karte der Startseite angezeigt |

Um eine View unter **Studio** statt unter dem CMS zu platzieren, übergeben Sie sie an [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styling

Rebase verwendet **Tailwind CSS v4** und unterstützt Light- und Dark-Modi. Anpassungen erfolgen über:

- **CSS Custom Properties** — Design-Tokens überschreiben
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

Standardmäßig steuert `<Rebase>` das Theme der Seite: Es setzt die `dark`-Klasse auf `<html>`, folgt `prefers-color-scheme`, bis der Benutzer im Admin einen Modus auswählt, und speichert diese Auswahl im localStorage.

Wenn `<Rebase>` unmounted wird, entfernt es die hinzugefügte `dark`-Klasse; eine Klasse, die die Seite bereits hatte, bleibt bestehen. In Version 0.24 bleibt die Klasse noch erhalten.

Wenn Ihre App bereits über ein Theme verfügt, übergeben Sie dieses als `modeController`. Rebase liest `mode` daraus aus, ruft dessen `setMode` über den eigenen Theme-Toggle auf und fasst `<html>`, `prefers-color-scheme` oder localStorage nicht an:

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

Das CSS des Scaffolds formatiert den Dark-Mode unter jedem Element mit der `dark`-Klasse (`@custom-variant dark (&:where(.dark, .dark *))`). Seitenpanels, Dialoge und Menüs rendern in einem Portal auf `<body>`, setzen Sie die Klasse daher auf `<html>` oder `<body>` und nicht auf ein Wrapper-Element um `<Rebase>`.

Das Umschließen von `<Rebase>` mit einem `ModeControllerProvider` bewirkt dies nicht: `<Rebase>` stellt intern einen eigenen Controller bereit. In Version 0.24 existiert die Prop noch nicht, und es gibt keine Möglichkeit, `<Rebase>` den Modus Ihrer App zu übergeben.

## Nächste Schritte

- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Eigene Formularfelder erstellen
- **[Entity-Views](/docs/frontend/entity-views)** — Tabs zu Entity-Editoren hinzufügen
- **[Ansichtsmodi](/docs/frontend/view-modes)** — Liste, Tabelle, Karten, Kanban
- **[Übersetzungen](/docs/frontend/i18n)** — Beliebige Texte anpassen oder eine Sprache hinzufügen
- **[Plugins](/docs/plugins)** — Das Framework erweitern
