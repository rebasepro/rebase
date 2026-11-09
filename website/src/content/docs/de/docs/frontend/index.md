---
sourceHash: b42c1d93bc690ca0
title: Frontend-Übersicht
sidebar_label: Frontend
description: "Erstellen und passen Sie das Panel an – Rebase CMS und Rebase Studio – mit React: Controller, Scaffold, Routing und Ansichten."
---

## Übersicht

Das Rebase-Frontend ist ein **React-Framework**, das Ihr Admin-Panel rendert. Es liest Ihre Collection-Definitionen und generiert Tabellen, Formulare, Navigation und Routing automatisch.

Im Standard-Scaffold **ist** das Admin-Panel das Frontend: Es wird am Root Ihrer bereitgestellten URL ausgeliefert. Wenn Sie stattdessen Ihre eigene Produkt-App erstellen, können Sie das Admin-Panel unter einem Präfix wie `/admin` im selben Deployment mounten – siehe [Ändern der Basis-URL](/docs/getting-started/deployment#changing-the-base-url).

Dies ist `frontend/src/App.tsx`, wie `rebase init` es schreibt, ohne seine Schriftart-Importe, Error Boundary und Google-Client-ID – das gesamte Admin-Panel, vier Deklarationen innerhalb eines Providers:

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

Die ersten drei rendern nichts: Sie *registrieren* Konfiguration im Provider. `<RebaseShell>` übernimmt das Zeichnen – es liest diese Registry und baut daraus die Navigation, Routen und das Layout auf. Die Reihenfolge, in der sie erscheinen, spielt daher keine Rolle, und das Hinzufügen einer Funktion bedeutet das Hinzufügen einer Komponente, nicht das Umverdrahten eines Komponentenbaums.

| Komponente | Paket | Registriert |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | den Anmeldebildschirm (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | Collections, benutzerdefinierte Ansichten, die Startseite, den Collection-Editor |
| `<RebaseStudio>` | `@rebasepro/studio` | die Entwicklertools (SQL, RLS, Logs, Backups …) |
| `<RebaseShell>` | `@rebasepro/cms` | nichts – es rendert das Admin-Panel aus allem Obigen |

Lassen Sie `<RebaseStudio>` weg und Sie haben ein reines Content-CMS; lassen Sie `<RebaseCMS>` weg und Sie erhalten nur die Entwicklertools. Um die Shell stattdessen manuell zu gestalten, siehe [Fortgeschritten: Manuelles Layout](#fortgeschritten-manuelles-layout).

## Der Rebase-Provider

`<Rebase>` ist der Root-Provider, der alle Rebase-Funktionen für untergeordnete Komponenten über den Context verfügbar macht. Er akzeptiert:

Alle dreiundzwanzig vollständig – die Tabelle listete früher zehn auf, und zwei davon waren Props, die die Komponente nie gelesen hat:

<!-- rebase-props:start -->
| Prop | Beschreibung |
|------|-------------|
| `children` | Die Root-Komponenten des Admin-Panels – `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Eine Render-Funktion dient als Ausweichmöglichkeit für manuelles Layout. |
| `apiUrl` | Basis-URL der Backend-API, die jedem Hook über `useApiConfig()` zur Verfügung gestellt wird |
| `dateTimeFormat` | Wie Datumsangaben ausgegeben werden. Standardmäßig `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Anfängliche Sprache des Admin-Panels und das Gebietsschema (Locale), in dem Datumsangaben formatiert werden – siehe [Übersetzungen](/docs/frontend/i18n) |
| `client` | `RebaseClient`-Instanz: die Standardquelle für Daten, Authentifizierung und Speicher |
| `dataSources` | Zusätzliche Datenquellen für Collections, die eine solche angeben – siehe [Mehrere Quellen](/docs/backend/multiple-sources) |
| `authController` | Authentifizierungsstatus und -methoden. Ersetzt das `client.auth`-Abonnement vollständig |
| `storageSource` | Die Standard-Speicherquelle, überschreibt `client.storage` |
| `storageSources` | Benannte Speicherquellen über den Standard hinaus |
| `databaseAdmin` | Administrative Datenbankoperationen (SQL, Schema-Discovery). Wird nur von Studio benötigt |
| `userConfigPersistence` | Lokale UI-Einstellungen – Spaltenbreiten, eingeklappte Gruppen |
| `onAnalyticsEvent` | Wird für jedes Analytics-Ereignis aufgerufen, das das Admin-Panel ausgibt |
| `entityLinkBuilder` | `({ row, id, path }) => string`: Die URL für die Schaltfläche „In Ihrer App öffnen“ auf einem Datensatz, basierend auf dem Datensatz, wie der Server die Zeile sendet |
| `plugins` | Plugin-Instanzen – siehe [Plugins](/docs/plugins) |
| `slots` | Direkt deklarierte Slot-Beiträge ohne Plugin |
| `propertyConfigs` | Benutzerdefinierte Feld-Widgets, indiziert nach dem Namen, den eine Eigenschaft in `propertyConfig` angibt |
| `entityViews` | Benutzerdefinierte Entity-Ansichts-Tabs, verfügbar für jede Collection, die ihren `key` in `admin.entityViews` angibt |
| `collectionViews` | Benutzerdefinierte Collection-Ansichtsmodi, verfügbar für jede Collection über `key` |
| `entityActions` | Entity-Aktionen, verfügbar für jede Collection, die ihren `key` in `admin.entityActions` angibt |
| `effectiveRoleController` | Simuliert eine andere Rolle, während der Entwicklungsmodus aktiv ist |
| `modeController` | Übergibt Rebase den Hell-/Dunkelmodus der Host-App; Rebase berührt dann niemals `<html>`, `prefers-color-scheme` oder localStorage – siehe [Styling](#styling) |
| `translations` | Überschreibt oder erweitert beliebige UI-Strings, indiziert nach Locale – siehe [Übersetzungen](/docs/frontend/i18n) |
| `components` | Ersetzt integrierte Komponenten – siehe [Komponenten-Überschreibungen](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Die Controller für Navigation, URL und Collection-Registry sind **keine** Props von `<Rebase>` – sie werden durch die untenstehenden Hooks erstellt und innerhalb des Admin-Baums verwendet (`<RebaseShell>` verdrahtet sie im Standard-Scaffold für Sie).

Ebenso wenig das URL-Präfix. Wenn das Admin-Panel unter einem Pfad gemountet wird, gehört dies zu `<RebaseCMS basePath="/admin">`, welches URLs zu Collections auflöst – und das nur, wenn der Router keinen eigenen `basename` hat. Siehe [Ändern der Basis-URL](/docs/getting-started/deployment#changing-the-base-url).

## Ein einheitliches Datenformat

Ihr Code erhält Zeilen (Rows) so, wie der Server sie sendet, egal wo er sie anfordert: `client.data`, `context.data` (sowohl in einem Backend-Callback als auch im Browser), `useRows`, `useRow` und `useRowWrites`, `data` der Collection- und View-Builder sowie das, was den `browserCallbacks` einer Collection übergeben wird. Eine Zeile ist ein flaches Objekt: `row.title`, ein Datum als ISO-String, eine belongsTo-Beziehung als Fremdschlüssel-Spalte.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

Das Admin-Panel selbst rendert ein `Entity`-View-Model – der `id`- / `path`- / `values`-Wrapper, aus dem seine Collection-Ansichten und -Formulare schöpfen, mit Datumsangaben als `Date`s und einer Relation als `EntityRelation`. Diese Schicht ist dem Admin-Panel eigen und nicht Teil der öffentlichen Oberfläche: Einer Entity-Aktion, einem Display-Resolver, `tableController.rows` eines Ansichtsmodus-`Builder`s, der Auswahl einer Collection-Aktion und einem Slot werden alle Zeilen übergeben, wobei die ID jedes Datensatzes neben seiner Zeile steht. Sie begegnen `Entity` nur in einer Kopie eines der admin-eigenen Teile (`Collection.Table`, einer Karte), der der Datensatz so übergeben wird, wie das Admin-Panel ihn darstellt. Die Werte eines Formulars sind die des Editors: `Date`s und Relationen, so wie ein Feld sie bearbeitet.

## Eine Collection oder ein Datensatz auf einer eigenen Seite

Sie benötigen nicht das gesamte Admin-Panel, um eine einzelne Tabelle anzuzeigen. `<CollectionPanel>`, `<RecordForm>`, `<RecordDetail>` und `<FieldValue>` funktionieren überall unter `<Rebase>` und einem React Router-Router, ganz ohne `<RebaseCMS>`, `<RebaseNavigation>` oder `<RebaseShell>`: eine Collection mit den von Ihnen ausgewählten Spalten und der Toolbar, das Formular eines Datensatzes mit nur einigen Feldern oder Ihrem eigenen Layout, ein Datensatz schreibgeschützt oder ein einzelner Wert, der so dargestellt wird, wie das Admin-Panel ihn darstellt. Siehe [Panels auf einer eigenen Seite](/docs/frontend/panels).

## Fortgeschritten: Manuelles Layout

Alles Folgende ersetzt `<RebaseShell>`. Sie benötigen dies nur, wenn das Standard-Layout im Weg ist – ein anderes Chrome (Rahmen) um das Admin-Panel, ein eigener Routing-Baum, eine App, in der das Admin-Panel eine Seite unter vielen ist. Wenn Sie das Layout nicht ersetzen, können Sie direkt zu [Benutzerdefinierte Ansichten](#benutzerdefinierte-ansichten) springen.

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

Die Reihenfolge ist festgelegt: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` zeigt die Login-Ansicht an, bis ein Benutzer vorhanden ist, sodass für einen abgemeldeten Besucher darunter nichts gerendert wird; `RebaseNavigation` erstellt die Controller für Navigation, URL und Collection-Registry, die von `RebaseRouteDefs` und jeder Collection-Ansicht gelesen werden, weshalb `RebaseRouteDefs` außerhalb davon einen Fehler auslöst. Um eine Collection-Ansicht oder ein Datensatz-Formular auf einer eigenen Seite ohne die Routen des Admin-Panels einzubetten, erstellt der schlankere `CollectionsProvider` diese Controller stattdessen – siehe [Panels auf einer eigenen Seite](/docs/frontend/panels).

Jede Schicht kann separat verwendet werden. `<RebaseAuthGate>` allein sichert Ihre eigene App hinter dem Login von Rebase ab. Tauschen Sie `<RebaseLayout>` gegen Ihre eigene Komponente aus, um das Routing beizubehalten und das Chrome zu entfernen; lassen Sie auch `<RebaseRouteDefs>` weg, und Sie bauen die Routen selbst aus den Komponenten in [Scaffold-Komponenten](#scaffold-komponenten) auf.

Darüber hinaus akzeptiert `<Rebase>` auch eine **Render-Prop** anstelle von Children, die Ihnen den Context und das Loading-Flag übergibt und den gesamten Baum Ihnen überlässt:

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

Zu diesem Zeitpunkt ist nichts für Sie vorkonfiguriert: Sie erstellen die folgenden Controller manuell und rendern die Routen selbst.

### Controller

Controller sind React-Hooks, die bestimmte Aspekte des Frameworks konfigurieren. `<RebaseNavigation>` ruft alle davon für Sie auf – greifen Sie nur innerhalb einer Render-Prop darauf zurück.

#### `useBuildNavigationStateController`

Der Haupt-Controller, der alles miteinander verbindet:

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

Verwaltet das Hell-/Dunkel-Theme. Wenn es aktiviert ist, steuert es das Theme der Seite: Es fügt `<html>` die Klasse `dark` hinzu, folgt `prefers-color-scheme`, bis der Benutzer einen Modus wählt, und merkt sich diese Auswahl im localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` erstellt selbst einen solchen Controller.

Wenn die Komponente, die ihn verwendet, unmountet, entfernt sie die hinzugefügte `dark`-Klasse; eine `dark`-Klasse, die die Seite bereits hatte, bleibt bestehen. Erstellen Sie Ihren eigenen Controller oberhalb von `<Rebase>` nur dann, wenn Komponenten außerhalb davon den Modus ebenfalls benötigen, und übergeben Sie ihn mit der [`modeController`-Prop](#styling), sodass es nur einen Controller gibt und nicht zwei. `useBuildModeController({ enabled: false })` erstellt einen inaktiven Controller: Er behält `mode` im React-State und fasst weder Klassen noch Media-Queries oder den localStorage an. Wenn Ihre App das Theme bereits selbst steuert, benötigen Sie diesen Hook überhaupt nicht: Übergeben Sie Ihren eigenen Controller als `modeController`.

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
| `<Drawer>` | Seitennavigation mit Collection-Liste und Ansichts-Links |
| `<SideDialogs>` | Container für Entity-Editoren im Seitenpanel |
| `<RebaseRoutes>` | Routen-Container, der sich in React Router integriert |
| `<RebaseRoute>` | Verarbeitet Collection-Routen (`/c/*`) |
| `<ContentHomePage>` | Standard-Startseite, die Collection-Karten anzeigt |
| `<StudioHomePage>` | Startseite des Studio-Modus mit Entwicklertools |

## Benutzerdefinierte Ansichten

Fügen Sie Navigationansichten auf oberster Ebene für Dashboards, Tools oder benutzerdefinierte Seiten hinzu. Ein `AppView` ist ein flaches Objekt – alles Nachfolgende befindet sich auf oberster Ebene, es gibt keinen verschachtelten `admin`-Block:

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
| `slug` | der Pfad, unter dem die Ansicht unterhalb des Admin-Roots erreichbar ist |
| `name` | die Beschriftung im Drawer und auf der Startseite |
| `view` | das zu rendernde Element oder ein `ComponentType`, um es lazy zu rendern |
| `icon` | ein [Lucide](https://lucide.dev/icons/)-Icon-Name, z. B. `"ShoppingCart"` – oder ein beliebiger Node |
| `group` | gruppiert Ansichten im Drawer zusammen; `"Admin"` und `"Settings"` wandern nach ganz unten |
| `pinToBottom` | setzt die Gruppe unter beliebigem Namen nach unten – bevorzugen Sie dies gegenüber den beiden magischen Strings |
| `nestedRoutes` | registriert auch `slug/*` für eine Ansicht mit eigenen Routen |
| `hideFromNavigation` | behält die Route bei, entfernt den Navigationseintrag |
| `roles` | nur Benutzer mit einer dieser Rollen sehen die Ansicht oder können sie aufrufen |
| `description` | Markdown, dargestellt auf der Startseiten-Karte |

Um eine Ansicht unter **Studio** statt unter dem CMS zu platzieren, übergeben Sie sie an [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styling

Rebase verwendet **Tailwind CSS v4** und unterstützt Hell-/Dunkelmodi. Passen Sie es an über:

- **CSS Custom Properties** – Design-Tokens überschreiben
- **`<Rebase modeController>`** – Rebase den Hell-/Dunkelmodus Ihrer App übergeben
- **Tailwind-Konfiguration** – Standardmäßige Tailwind-Anpassung

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

### Hell- und Dunkelmodus

Standardmäßig steuert `<Rebase>` das Theme der Seite: Es weist `<html>` die Klasse `dark` zu, folgt `prefers-color-scheme`, bis der Benutzer einen Modus im Admin-Panel auswählt, und merkt sich diese Auswahl im localStorage.

Wenn `<Rebase>` unmountet, entfernt es die hinzugefügte `dark`-Klasse; eine Klasse, die die Seite bereits hatte, bleibt bestehen. In Version 0.24 bleibt die Klasse zurück.

Wenn Ihre App bereits über ein Theme verfügt, übergeben Sie es als `modeController`. Rebase liest `mode` daraus aus, ruft dessen `setMode` über seinen eigenen Theme-Umschalter auf und berührt niemals `<html>`, `prefers-color-scheme` oder den localStorage:

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

Das CSS des Scaffolds stylt den Dunkelmodus unter jedem Element mit der Klasse `dark` (`@custom-variant dark (&:where(.dark, .dark *))`). Seitenpanels, Dialoge und Menüs rendern in einem Portal auf `<body>`, setzen Sie die Klasse daher auf `<html>` oder `<body>` statt auf ein Wrapper-Element um `<Rebase>`.

Das Einschließen von `<Rebase>` in einen `ModeControllerProvider` bewirkt dies nicht: `<Rebase>` stellt intern einen eigenen Controller bereit. In Version 0.24 existiert die Prop nicht und es gibt keine Möglichkeit, Rebase den Modus Ihrer App zu übergeben.

## Nächste Schritte

- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Benutzerdefinierte Formularfelder erstellen
- **[Entity-Ansichten](/docs/frontend/entity-views)** — Tabs zu Entity-Editoren hinzufügen
- **[Ansichtsmodi](/docs/frontend/view-modes)** — Liste, Tabelle, Karten, Kanban
- **[Übersetzungen](/docs/frontend/i18n)** — Beliebige Strings ändern oder eine Sprache hinzufügen
- **[Plugins](/docs/plugins)** — Das Framework erweitern
