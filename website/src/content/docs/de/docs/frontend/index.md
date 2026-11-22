---
sourceHash: 3d9958fb7e16f02e
title: Frontend-Übersicht
sidebar_label: Frontend
description: "Erstellen und passen Sie das Panel an — Rebase CMS und Rebase Studio — mit React: Controller, Scaffold, Routing und Ansichten."
---

## Übersicht

Das Rebase-Frontend ist ein **React-Framework**, das Ihr Admin-Panel rendert. Es
liest die Tabellen aus, die das Backend bereitstellt, und generiert daraus
ohne Konfiguration die Navigation, Tabellen, Formulare und Routen (siehe
[Tables in the CMS](/docs/collections/)). Was Sie hinzufügen, ist das, was sich unterscheidet.

Im Standard-Scaffold **ist** das Admin-Panel das Frontend: Es wird an der Root-URL Ihres Deployments ausgeliefert. Wenn Sie stattdessen Ihre eigene Produkt-App erstellen, können Sie das Admin-Panel im selben Deployment unter einem Präfix wie `/admin` mounten — siehe [Changing the Base URL](/docs/getting-started/deployment#changing-the-base-url).

Dies ist eine `frontend/src/App.tsx` ohne ihre Schriftarten-Imports, Error-Boundary und
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

Die ersten drei rendern nichts: Sie *registrieren* Konfigurationen im
Provider. `<RebaseShell>` ist das, was zeichnet — es liest diese Registrierung aus und baut daraus die
Navigation, Routen und das Layout auf. Die Reihenfolge, in der sie erscheinen, spielt daher
keine Rolle, und das Hinzufügen eines Features bedeutet das Hinzufügen einer Komponente, nicht das Umstrukturieren eines Baums.

| Komponente | Paket | Registriert |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | den Anmeldebildschirm (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | die bereitgestellten Tabellen mit ihren Anpassungen, externe Collections, benutzerdefinierte Ansichten, die Startseite |
| `<RebaseStudio>` | `@rebasepro/studio` | die Entwicklerwerkzeuge (SQL, RLS, Logs, Backups …) |
| `<RebaseShell>` | `@rebasepro/cms` | nichts — es rendert das Admin-Panel aus allem Obigen |

Lassen Sie `<RebaseStudio>` weg, und Sie haben ein reines Content-CMS; lassen Sie `<RebaseCMS>` weg, und
Sie haben nur die Entwicklerwerkzeuge. Wie Sie die Shell stattdessen von Hand anordnen, erfahren Sie unter
[Advanced: manual layout](#advanced-manual-layout).

## Wo die CMS-Dateien liegen

```text
frontend/src/
├── App.tsx
└── cms/
    ├── index.ts      # export const tableCustomizations = [postsCms, …]
    ├── posts.tsx     # customizeTable("posts", { … })
    └── events.ts     # defineFirestoreCollection({ … })
```

`frontend/src/cms/` enthält das, was das Panel nicht ableiten kann: ein
[`customizeTable`](/docs/frontend/customize-table/) pro Tabelle, die Sie anders
darstellen möchten, und die [Firestore-Collections](/docs/frontend/firebase/),
die der Browser direkt liest. Diese Dateien laufen ausschließlich im Browser, daher ist ein benutzerdefiniertes
Feld eine Komponente, die Sie als Wert importieren.

Das Frontend importiert den **Typ** einer Tabelle aus `backend/schema`, niemals einen Wert:
`import type { posts } from "../../../backend/schema/posts"`. Ein Typ-Import wird
beim Bundling entfernt, sodass die Hooks und der Server-Code des Backends niemals den
Browser erreichen. Das Backend importiert nichts aus dem Frontend.

## RebaseCMS props

<!-- rebase-cms-props:start -->
| Prop | Beschreibung |
|------|-------------|
| `tableCustomizations` | `customizeTable(...)`-Ergebnisse, maximal eines pro Tabelle. Zwei für dieselbe Tabelle werfen einen Fehler; eines für eine Tabelle, die dem Aufrufer nicht bereitgestellt wird, wird ignoriert, mit einer Warnung in der Entwicklung |
| `externalCollections` | Collections, deren Zeilen auf einer anderen Datenquelle liegen, wie z. B. `defineFirestoreCollection`-Ergebnisse, dargestellt neben den Tabellen in derselben Navigation, Suche und denselben Referenz-Pickern |
| `uiConfig` | Die UI-Einstellungen des Workspaces wie in der Entwicklung geschrieben: `import uiConfig from "./cms/ui-config.json"`. Über `tableCustomizations` gelegt, unter den eigenen Einstellungen jedes Benutzers |
| `tables` | Für Einbettungen und Tests: die Tabellen, die gerendert werden sollen, anstelle der vom Server bereitgestellten (`compileTables([...])`). Wenn angegeben, werden vom Server keine angefordert |
| `views` | Top-Level-Seiten in der Navigation oder ein Builder dafür — siehe [Custom Views](#custom-views) |
| `homePage` | Ersetzt die Content-Startseite |
| `entityViews` | Datensatz-Tabs, die jede Tabelle über `key` in ihren `entityViews` angeben kann |
| `collectionViews` | Ansichtsmodi, die jede Tabelle über `key` in ihren `customViews` angeben kann |
| `entityActions` | Datensatz-Aktionen, die jede Tabelle über `key` in ihren `entityActions` angeben kann |
| `collectionEditor` | Optionen für den Schema-Controller, über den der RLS-Editor von Studio speichert (`readOnly`, `getAuthToken`) |
| `navigationGroupMappings` | Benannte Gruppen und die darin enthaltenen Collections und Ansichten in entsprechender Reihenfolge |
| `basePath` | Das URL-Präfix, unter dem das Admin-Panel gemountet wird, wenn der Router keinen `basename` hat |
<!-- rebase-cms-props:end -->

Die Collections des Panels werden in dieser Reihenfolge zusammengestellt, die auch der
Navigation entspricht: jede bereitgestellte Tabelle (mit angewendeter Anpassung, danach den UI-Einstellungen
des Workspaces und des Benutzers), gefolgt von den `externalCollections`. Ein Slug
bezeichnet immer nur eine einzige Collection:

| Kollision | Was passiert |
|---|---|
| zwei `customizeTable`-Ergebnisse für einen Slug | wirft einen Fehler: führen Sie sie zu einem zusammen |
| eine externe Collection und eine bereitgestellte Tabelle oder eine weitere externe Collection | das Panel zeigt einen Ladefehler an, der beide benennt; weisen Sie einer davon einen anderen Slug zu |

Wie das Panel auf die Tabellen wartet und was es anzeigt, wenn sie nicht
geladen werden können, finden Sie unter [Tables in the CMS](/docs/collections/#loading-and-errors).

## Der Rebase-Provider

`<Rebase>` ist der Root-Provider, der alle Rebase-Funktionen für Kindkomponenten über den Kontext verfügbar macht. Er akzeptiert:

Alle dreiundzwanzig Props im Detail — die Tabelle listete zuvor zehn auf, und zwei davon
waren Props, die die Komponente nie gelesen hat:

<!-- rebase-props:start -->
| Prop | Beschreibung |
|------|-------------|
| `children` | Die Root-Komponenten des Admins — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Eine Render-Funktion dient als Ausstiegspunkt für manuelles Layout. |
| `apiUrl` | Basis-URL der Backend-API, die jedem Hook über `useApiConfig()` zur Verfügung gestellt wird |
| `dateTimeFormat` | Wie Datumsangaben ausgegeben werden. Standardmäßig `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Ausgangssprache des Admins und das Locale, in dem Datumsangaben formatiert werden — siehe [Translations](/docs/frontend/i18n) |
| `client` | `RebaseClient`-Instanz: die Standardquelle für Daten, Authentifizierung und Speicher |
| `dataSources` | Zusätzliche Datenquellen für Collections, die eine solche angeben — siehe [Multiple sources](/docs/backend/multiple-sources) |
| `authController` | Authentifizierungsstatus und -methoden. Ersetzt das `client.auth`-Abonnement vollständig |
| `storageSource` | Die Standard-Speicherquelle, die `client.storage` überschreibt |
| `storageSources` | Benannte Speicherquellen über den Standard hinaus |
| `databaseAdmin` | Administrative Datenbankoperationen (SQL, Schema-Discovery). Wird nur von Studio benötigt |
| `userConfigPersistence` | Lokale UI-Einstellungen — Spaltenbreiten, eingeklappte Gruppen |
| `onAnalyticsEvent` | Wird für jedes Analytics-Event aufgerufen, das das Admin-Panel ausgibt |
| `entityLinkBuilder` | `({ row, id, path }) => string`: die URL für den Button „In Ihrer App öffnen“ an einem Datensatz, basierend auf dem Datensatz, wie der Server die Zeile sendet |
| `plugins` | Plugin-Instanzen — siehe [Plugins](/docs/plugins) |
| `slots` | Direkt deklarierte Slot-Beiträge ohne Plugin |
| `propertyConfigs` | Benutzerdefinierte Feld-Widgets, zugeordnet nach dem Namen, den ein Feld in `propertyConfig` angibt |
| `entityViews` | Benutzerdefinierte Entity-Ansichts-Tabs, verfügbar für jede Tabelle, die deren `key` in ihren `entityViews` angibt |
| `collectionViews` | Benutzerdefinierte Collection-Ansichtsmodi, verfügbar für jede Collection über `key` |
| `entityActions` | Entity-Aktionen, verfügbar für jede Tabelle, die deren `key` in ihren `entityActions` angibt |
| `effectiveRoleController` | Simuliert eine andere Rolle, während der Entwicklungsmodus aktiv ist |
| `simulateAccess` | Zeigt „Zugriff simulieren“, das Administrator-Steuerelement, das jede Datenansicht als Rolle, Benutzer oder Dienstschlüssel schreibgeschützt gegen die echten Row-Level-Security-Richtlinien ausführt. Deaktiviert, sofern nicht `true` |
| `modeController` | Übergibt Rebase den Hell-/Dunkelmodus der Host-App; Rebase fasst dann `<html>`, `prefers-color-scheme` oder localStorage niemals an — siehe [Styling](#styling) |
| `translations` | Überschreibt oder erweitert beliebige UI-Strings, zugeordnet nach Locale — siehe [Translations](/docs/frontend/i18n) |
| `components` | Ersetzt integrierte Komponenten — siehe [Component Overrides](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Die Controller für Navigation, URL und Collection-Registry sind **keine** `<Rebase>`-Props —
sie werden von den folgenden Hooks erstellt und innerhalb des Admin-Baums verwendet
(`<RebaseShell>` verdrahtet sie im Standard-Scaffold für Sie).

Dasselbe gilt für das URL-Präfix. Wenn das Admin-Panel unter einem Pfad gemountet wird, gehört dies
zu `<RebaseCMS basePath="/admin">`, das URLs zu Collections auflöst —
und auch nur dann, wenn der Router keinen eigenen `basename` hat. Siehe
[Changing the Base URL](/docs/getting-started/deployment#changing-the-base-url).

## Eine einheitliche Datenform

Ihr Code erhält Zeilen so, wie der Server sie sendet, wo immer er sie anfordert: `client.data`,
`context.data` (in einem Backend-Callback ebenso wie im Browser), `useRows`,
`useRow` und `useRowWrites`, das `data` der Collection- und View-Builder sowie das,
was den `browserCallbacks` einer Tabelle übergeben wird. Eine Zeile ist ein flaches Objekt: `row.title`,
ein Datum als sein ISO-String, ein belongsTo als seine Fremdschlüsselspalte.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

Das Admin-Panel selbst rendert ein `Entity`-View-Model — der `id`- / `path`- / `values`-Wrapper,
aus dem seine Collection-Ansichten und Formulare schöpfen, mit Datumsangaben als `Date`-Objekten und einer
Relation als `EntityRelation` (die Werteklassen `EntityRelation`, `EntityReference`,
`GeoPoint` und `Vector` stammen aus `@rebasepro/cms-types`). Vor jedem Schreibvorgang und
jedem Filter konvertiert das Admin-Panel dies im Browser in Übertragungswerte (Wire-Werte) — Relationen als
Schlüssel, Vektoren als Zahlenlisten, Punkte als `{ latitude, longitude }`, Datumsangaben als ISO-Text —,
sodass der Server das sieht, was jeder andere Client sendet. Diese Schicht ist dem Admin-Panel eigen und nicht Teil
der öffentlichen Schnittstelle: Einer Entity-Aktion, einem Display-Resolver, dem `tableController.rows` eines
Ansichtsmodus-`Builder`s, der Auswahl einer Collection-Aktion und einem Slot
werden allesamt Zeilen übergeben, wobei die ID jedes Datensatzes neben seiner Zeile steht. Mit `Entity` kommen Sie nur in Berührung, wenn Sie eine Kopie eines
der panel-eigenen Teile verwenden (`Collection.Table`, eine Karte), der der Datensatz so übergeben wird, wie das Admin-Panel
ihn zeichnet. Die Werte eines Formulars sind die des Editors: `Date`-Objekte und Relationen, so wie ein Feld
sie bearbeitet.

## Eine Collection oder ein Datensatz auf einer eigenen Seite

Sie benötigen nicht das gesamte Admin-Panel, um eine einzelne Tabelle anzuzeigen. `<CollectionPanel>`,
`<RecordForm>`, `<RecordDetail>` und `<FieldValue>` funktionieren überall unter
`<Rebase>` und einem React-Router-Router, ohne `<RebaseCMS>`,
`<RebaseNavigation>` oder `<RebaseShell>`: eine Collection mit den von Ihnen gewählten Spalten und
Symbolleisten, das Formular eines Datensatzes mit nur ausgewählten Feldern oder Ihrem eigenen
Layout, ein Datensatz als schreibgeschützte Ansicht oder ein einzelner Wert, dargestellt so, wie das Admin-Panel ihn zeichnet. Siehe
[Panels in a page of your own](/docs/frontend/panels).

## Advanced: manual layout

Alles Folgende ersetzt `<RebaseShell>`. Sie benötigen dies nur, wenn das
Standard-Layout im Weg ist — ein anderes Rahmendesign (Chrome) um das Admin-Panel, ein eigener Routenbaum
Ihrer Wahl oder eine App, in der das Admin-Panel nur eine Seite unter vielen ist. Wenn Sie das Layout nicht
ersetzen möchten, können Sie bei [Custom Views](#custom-views) aufhören.

`<RebaseShell>` ist syntaktischer Zucker für vier Schichten, und Sie können diese einzeln verwenden:

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

Die Reihenfolge ist fest vorgegeben: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs →
RebaseLayout`. `RebaseAuthGate` zeigt die Login-Ansicht an, bis ein Benutzer vorhanden ist,
sodass darunter für einen abgemeldeten Besucher nichts gerendert wird; `RebaseNavigation` erstellt
die Controller für Navigation, URL und Collection-Registry, die `RebaseRouteDefs`
und jede Collection-Ansicht auslesen, sodass `RebaseRouteDefs` außerhalb davon einen Fehler auslöst.
Um eine Collection-Ansicht oder ein Datensatzformular auf einer eigenen Seite ohne die
Routen des Admins einzubetten, erstellt der leichtere `CollectionsProvider` stattdessen diese Controller — siehe
[Panels in a page of your own](/docs/frontend/panels).

Jede Schicht kann für sich allein verwendet werden. `<RebaseAuthGate>` allein schützt Ihre eigene App
hinter dem Login von Rebase. Tauschen Sie `<RebaseLayout>` gegen Ihre eigene Komponente aus, um das
Routing beizubehalten und das Chrome-Design zu entfernen; lassen Sie auch `<RebaseRouteDefs>` weg, und Sie bauen
die Routen selbst aus den Komponenten in
[Scaffold Components](#scaffold-components) auf.

Unterhalb dieser Ebene akzeptiert `<Rebase>` anstelle von Children auch eine **Render-Prop**,
die Ihnen den Kontext und das Loading-Flag übergibt und Ihnen den gesamten Baum
überlässt:

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

An diesem Punkt ist nichts für Sie vorverdrahtet: Sie erstellen die unten stehenden Controller von
Hand und rendern die Routen selbst.

### Controller

Controller sind React-Hooks, die bestimmte Aspekte des Frameworks konfigurieren.
`<RebaseNavigation>` ruft alle für Sie auf — greifen Sie auf diese nur innerhalb einer
Render-Prop zurück.

#### `useBuildNavigationStateController`

Der Hauptcontroller, der alles miteinander verbindet:

Sein `data` ist das, was den Collection- und View-Buildern übergeben wird: das flache
`context.data` des umschließenden `<Rebase>` (siehe [One data shape](#eine-einheitliche-datenform)),
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

Verwaltet das Light-/Dark-Theme. Solange aktiviert, steuert er das Theme der Seite: Er setzt
die Klasse `dark` auf `<html>`, folgt `prefers-color-scheme`, bis der Benutzer
einen Modus wählt, und speichert diese Auswahl in localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` erstellt selbst eine Instanz davon.

Wird die
Komponente, die ihn verwendet, unmounted, entfernt sie die hinzugefügte `dark`-Klasse wieder; eine `dark`-Klasse,
die die Seite bereits hatte, bleibt bestehen. Erstellen Sie Ihren eigenen Controller
oberhalb von `<Rebase>` nur dann, wenn Komponenten außerhalb davon den Modus ebenfalls benötigen, und übergeben
Sie ihn mit der [`modeController`-Prop](#styling), sodass es genau einen Controller gibt
und nicht zwei. `useBuildModeController({ enabled: false })` erstellt einen inaktiven
Controller: Er hält `mode` im React-State und fasst weder CSS-Klassen, Media-Queries
noch localStorage an. Wenn Ihre App das Theme bereits selbst verwaltet, benötigen Sie diesen
Hook überhaupt nicht: Übergeben Sie Ihren eigenen Controller als `modeController`.

#### `useBuildAdminModeController`

Schaltet zwischen Studio- und Content-Modus um:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Scaffold Components

| Komponente | Beschreibung |
|-----------|-------------|
| `<Scaffold>` | Haupt-Layout-Container mit responsiver Seitenleiste |
| `<AppBar>` | Obere Navigationsleiste mit Suche, Modus-Umschalter, Benutzermenü |
| `<Drawer>` | Seitennavigation mit Collection-Liste und Links zu Ansichten |
| `<SideDialogs>` | Container für Entity-Editoren im Seitenpanel |
| `<RebaseRoutes>` | Routen-Container, der sich in React Router integriert |
| `<RebaseRoute>` | Verarbeitet Collection-Routen (`/c/*`) |
| `<ContentHomePage>` | Standard-Startseite, die Collection-Karten anzeigt |
| `<StudioHomePage>` | Startseite im Studio-Modus mit Entwicklertools |

## Custom Views

Fügen Sie Navigationsansichten auf oberster Ebene für Dashboards, Tools oder benutzerdefinierte Seiten hinzu. Ein
`AppView` ist ein flaches Objekt — alles Folgende befindet sich auf der obersten Ebene, es gibt keinen
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

Übergeben Sie diese an `<RebaseCMS>`, direkt neben Ihren Anpassungen — das ist die
Komponente, die die Navigation registriert:

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} views={views}/>
```

| Feld | |
|---|---|
| `slug` | der Pfad, unter dem sie erreichbar ist, unterhalb des Admin-Roots |
| `name` | die Beschriftung in der Navigation (Drawer) und auf der Startseite |
| `view` | das zu rendernde Element oder ein `ComponentType`, um es lazy zu rendern |
| `icon` | ein [Lucide](https://lucide.dev/icons/)-Icon-Name, z. B. `"ShoppingCart"` — oder ein beliebiger Node |
| `group` | gruppiert Ansichten in der Navigation; `"Admin"` und `"Settings"` werden ganz nach unten verschoben |
| `pinToBottom` | verschiebt die Gruppe unter beliebigem Namen nach unten — bevorzugen Sie dies gegenüber den beiden magischen Strings |
| `nestedRoutes` | registriert auch `slug/*` für eine Ansicht mit eigenen Routen |
| `hideFromNavigation` | behält die Route bei, entfernt aber den Navigationseintrag |
| `roles` | nur Benutzer mit einer dieser Rollen sehen die Ansicht oder können sie erreichen |
| `description` | Markdown, dargestellt auf der Karte der Startseite |

Um eine Ansicht unter **Studio** statt im CMS zu platzieren, übergeben Sie sie an
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styling

Rebase verwendet **Tailwind CSS v4** und unterstützt Hell-/Dunkelmodi. Passen Sie das Styling an über:

- **Benutzerdefinierte CSS-Properties** — Design-Tokens überschreiben
- **`<Rebase modeController>`** — Rebase den Hell-/Dunkelmodus Ihrer App übergeben
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

Standardmäßig steuert `<Rebase>` das Theme der Seite: Es weist `<html>` die Klasse
`dark` zu, folgt `prefers-color-scheme`, bis der Benutzer einen Modus im
Admin-Panel auswählt, und speichert diese Auswahl in localStorage.

Wenn `<Rebase>`
unmountet, entfernt es die hinzugefügte `dark`-Klasse wieder; eine Klasse, die die Seite bereits hatte,
bleibt bestehen.

Wenn Ihre App
bereits über ein Theme verfügt, übergeben Sie es als `modeController`. Rebase liest `mode` daraus,
ruft dessen `setMode` über seinen eigenen Theme-Umschalter auf und fasst `<html>`,
`prefers-color-scheme` oder localStorage niemals an:

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

Das CSS des Scaffolds formatiert den Dark-Mode unter jedem Element mit der Klasse `dark`
(`@custom-variant dark (&:where(.dark, .dark *))`). Seitenpanels, Dialoge und
Menüs werden in einem Portal auf `<body>` gerendert; setzen Sie die Klasse daher auf `<html>` oder `<body>`
statt auf einen Wrapper um `<Rebase>`.

Das Einpacken von `<Rebase>` in einen `ModeControllerProvider` bewirkt dies nicht:
`<Rebase>` stellt intern einen eigenen Controller bereit.

## Nächste Schritte

- **[customizeTable](/docs/frontend/customize-table)** — Alle Optionen der Collection einer Tabelle
- **[Custom Fields](/docs/frontend/custom-fields)** — Eigene Formularfelder erstellen
- **[Entity Views](/docs/frontend/entity-views)** — Tabs zu Entity-Editoren hinzufügen
- **[View Modes](/docs/frontend/view-modes)** — Liste, Tabelle, Karten, Kanban
- **[Translations](/docs/frontend/i18n)** — Beliebige Zeichenfolgen anpassen oder eine Sprache hinzufügen
- **[Plugins](/docs/plugins)** — Das Framework erweitern
