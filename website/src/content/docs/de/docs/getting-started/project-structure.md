---
sourceHash: 10e6c0404ca260a3
title: Projektstruktur
sidebar_label: Projektstruktur
description: "Der Aufbau eines Rebase-Projekts – die Tabellen in backend/schema, die Backend-Module, die die Laufzeitumgebung liest, und die Anpassungen des Admin-Panels in frontend/src/cms – mit und ohne Panel."
---

:::note[Sechs Begriffe, die auf dieser Seite verwendet werden]
Jeder dieser Begriffe hat hier eine ganz bestimmte Bedeutung, und die meisten davon bedeuten an anderer Stelle in der Branche etwas anderes.

- **Table** — eine Postgres-Tabelle, deklariert in TypeScript mit `defineTable` in
  `backend/schema/`. Das SQL, die Row-Level-Security-Policies, die API, die
  SDK-Typen und die Standardeinstellungen des Admin-Panels stammen alle daraus ab.
- **Collection** — was das Admin-Panel anzeigt: eine als Liste und Formular
  gerenderte Tabelle, angepasst in `frontend/src/cms/`, oder eine Firestore-Collection,
  die das Panel direkt liest.
- **Studio** — der Entwickler-Teil des Admin-Panels: Schema-Editor, SQL-Konsole,
  Policy-Browser. Dieselbe App, die Ihr Content-Team verwendet, hinter einem Umschalter (Toggle).
- **Managed runtime** — das veröffentlichte `rebasepro/server`-Image startet Ihr
  Projekt. Sie schreiben keine Server-Datei und erhalten Runtime-Upgrades ohne einen
  Rebuild. Die Alternative ist `rebase eject`, siehe unten.
- **Bundle** — was `rebase build` erzeugt: Ihre Tabellen, Funktionen und Crons,
  kompiliert, mit einem Manifest, das angibt, wo sich die einzelnen Elemente befinden. Es ist das,
  was die Managed Runtime startet.
- **Resource** — etwas, das das Projekt von dort benötigt, wo es ausgeführt wird: eine Datenbank,
  ein Bucket, ein Topic. Deklariert in `backend/resources.ts`, gebunden über
  Umgebungsvariablen.
:::

`rebase init` initialisiert eines von zwei Layouts. Beide besitzen dasselbe `backend/`; der
Unterschied besteht darin, ob das Projekt das Admin-Panel enthält.

**Mit dem Admin-Panel** (Standard):

```
my-app/
├── .env                    # Generated for you: JWT_SECRET, a database password, a free port
├── rebase.json             # Which apps this repository contains, and how each is built
├── package.json            # Root workspace config
├── tsconfig.json           # Typechecks scripts/; each workspace typechecks on its own
├── docker-compose.yml      # Self-hosting: Postgres + the published runtime image
├── scripts/
│   └── example.ts          # A health check and an SDK call to uncomment: `pnpm example`
│
├── backend/
│   ├── schema/             # Your tables
│   │   ├── index.ts        # Exports every table, and the optional defaultRls
│   │   ├── posts.ts        # defineTable("posts", …)
│   │   └── users.ts        # defineAuthTable("users", …)
│   ├── resources.ts        # What this project needs from wherever it runs
│   ├── storage.ts          # Who may read, write and list files (storageAuthorize)
│   ├── functions/          # Custom API routes, auto-mounted at /api/functions/<name>
│   │   └── hello.ts
│   └── src/
│       └── schema.generated.ts   # Drizzle schema, regenerated from your tables
│
└── frontend/               # The admin panel (React + Vite)
    ├── src/
    │   ├── App.tsx
    │   ├── main.tsx
    │   └── cms/            # How tables look in the panel: customizeTable(...)
    │       └── posts.tsx
    └── vite.config.ts
```

**Nur Backend** (`rebase init --headless`): dasselbe `backend/`, ohne
`frontend/` – und auch ohne `backend/schema/`. Der Server liest beim Start die
datenbankeigenen Tabellen aus und stellt jede bereit, für die Row-Level Security
aktiviert ist. Siehe [Nur Backend](/docs/getting-started/headless/).

```
my-api/
├── .env
├── rebase.json
├── package.json
└── backend/
    ├── storage.ts
    └── functions/
```

Zwei weitere Dateien erscheinen, wenn Sie sie benötigen, und die Laufzeitumgebung liest beide:
`backend/hooks.ts`, dessen `hooks`-Export für jede Tabelle ausgeführt wird
([Globale Hooks](/docs/backend/hooks/)), und `backend/crons/` für geplante
Aufgaben. `rebase generate-sdk --register` fügt `backend/generated/` hinzu.

`tsc --noEmit` im Root-Verzeichnis überprüft `scripts/`; in `backend/` oder `frontend/`
überprüft es den jeweiligen Workspace. Es gibt kein separates `config/`-Paket: Das Frontend
importiert eine Tabelle aus `backend/schema` ausschließlich als Typ (`import type`). Ein
Import von Werten aus `backend/` würde Servercode – Hooks und die
von ihnen gelesenen Secrets – an den Browser ausliefern. Daher lässt `rebaseBackendGuard()` aus
`@rebasepro/app/vitePlugin` im `frontend/vite.config.ts` des Scaffolds `vite build`
und `vite dev` fehlschlagen, wenn etwas nach `backend/` aufgelöst wird, und nennt dabei den
Importer, den Import und die Datei. `rebase build` verweigert ein Frontend ohne
diesen Guard. Um ihn zu einem bestehenden Projekt hinzuzufügen, importieren Sie ihn und fügen Sie
`rebaseBackendGuard()` zu `plugins` in `frontend/vite.config.ts` hinzu.

:::note[Es gibt kein `backend/src/index.ts`]
Und kein `Dockerfile`. Ein per Scaffold erstelltes Projekt deklariert `runtime: "managed"` in
`rebase.json`, was bedeutet, dass das **veröffentlichte `rebasepro/server`-Image Ihr
Projekt als Bundle startet** – dasselbe Artefakt, egal ob Sie es selbst hosten oder
in Rebase Cloud deployen. Sie konfigurieren den Server über `rebase.json`, die Dateien in
`backend/` und Umgebungsvariablen, anstatt einen Einstiegspunkt zu schreiben.

Wenn Sie die volle Kontrolle über den Prozess haben möchten – Ihre eigene Middleware, Ihre eigenen Routen,
Ihre eigene Auth-Verdrahtung –, schreibt `rebase eject` den Einstiegspunkt, ein Dockerfile und eine Compose-Datei,
die diese erstellt. Siehe [Eigene Server-Integration](/docs/backend/custom-server).
:::

## Tabellen (`backend/schema/`)

Tabellen sind die **Single Source of Truth** für Ihr Datenmodell:

```typescript title="backend/schema/products.ts"
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        name:  col.text().notNull(),
        price: col.numeric(),
    },
    rls: "admin-only",
});
```

Der Name wird zum REST-Endpunkt (`/api/data/products`), zum Tabellennamen in
Postgres und zur Route des Panels; `table` und `slug` überschreiben diese. `rls` ist
erforderlich. Eine Tabelle wird berücksichtigt, sobald `backend/schema/index.ts` sie exportiert – ein
`defineTable`, das im Index ausgelassen wird, führt dazu, dass der Start verweigert wird. [Tabellen](/docs/schema/)
deckt alle Optionen ab.

## Frontend (`frontend/`)

Das Frontend ist eine standardmäßige **Vite + React + TypeScript**-Anwendung. Die zentrale Datei ist `App.tsx`, die alle Rebase-Controller miteinander verbindet:

```tsx title="frontend/src/App.tsx"
import "@fontsource/jetbrains-mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";

import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { ErrorBoundary } from "@rebasepro/ui";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { postsCms } from "./cms/posts";
import { authorsCms } from "./cms/authors";
import { tagsCms } from "./cms/tags";
import { usersCms } from "./cms/users";
// The admin panel's shared layout for each table (labels, columns, views).
import uiConfig from "./cms/ui-config.json";

// `rebase dev` injects VITE_API_URL with the port it actually bound, and that
// port is derived from this project's path rather than fixed — so a
// `http://localhost:3001` fallback here names a port nothing is listening on.
// A deployed build serves the admin from the same origin as the API, where an
// empty value is exactly what you want.
const API_URL = import.meta.env.VITE_API_URL;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// One client for the page, created when this module loads. Inside a component,
// even in a `useMemo`, `<React.StrictMode>` builds a second one in development,
// and both restore the session and open their own connections.
const rebaseClient = createRebaseClient({
    baseUrl: API_URL,
    // Store the refresh token in an httpOnly cookie (XSS-safe) rather than
    // localStorage. The backend issues it via `auth.cookieAuth`.
    auth: { authFlowMode: "cookie" }
});

export function App() {
    const authController = useRebaseAuthController({
        client: rebaseClient,
        googleClientId: GOOGLE_CLIENT_ID
    });

    return (
        <ErrorBoundary fullPage>
            <Rebase
                client={rebaseClient}
                authController={authController}
            >
                {/* The sign-in screen. On its own this changes nothing —
                    it is where you pass `loginView` to replace it. */}
                <RebaseAuth />
                {/* Every table the backend serves gets an admin view with no
                    code. A file in ./cms changes how one of them looks:
                    labels, icons, enum colours, custom fields and actions. */}
                <RebaseCMS tableCustomizations={[postsCms, authorsCms, tagsCms, usersCms]} uiConfig={uiConfig} />
                <RebaseStudio/>
                <RebaseShell title="Rebase"/>
            </Rebase>
        </ErrorBoundary>
    );
}
```

`main.tsx` mountet sie unter einem `basename` für `react-router`, der aus
`import.meta.env.BASE_URL` übernommen wird. Diesen setzt `rebase build` anhand des `path`, den diese App
in `rebase.json` deklariert – so stimmen die Assets, der Router und der Server auf
denselben Wert überein, ohne dass er dreimal manuell angegeben werden muss.

### Kernkonzepte

- **`createRebaseClient`** — Erstellt den SDK-Client, der HTTP-Anfragen, WebSocket-Verbindungen und das Auth-Token-Management handhabt. Rufen Sie ihn einmalig auf Modulebene auf: Innerhalb einer Komponente, selbst in einem `useMemo`, erstellt `<React.StrictMode>` in der Entwicklungsumgebung einen zweiten Client
- **`<RebaseCMS tableCustomizations>`** — Das Panel rendert jede Tabelle, die das Backend unter `GET /api/schema/tables` bereitstellt; die `customizeTable`-Objekte aus `frontend/src/cms/` ändern das Aussehen bestimmter Tabellen, und `uiConfig` übernimmt das gemeinsame Layout aus `frontend/src/cms/ui-config.json`. Siehe [Tabelle anpassen](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences)
- **`useRebaseAuthController`** — Verwaltet den angemeldeten Benutzer sowie den Token-Lebenszyklus und wird von `<Rebase>` an alle untergeordneten Elemente verteilt

## Backend (`backend/`)

Es gibt keine Server-Datei, die man lesen müsste, und genau das ist beabsichtigt: Ein per Scaffold
erstelltes Projekt deklariert `runtime: "managed"`, sodass das veröffentlichte `rebasepro/server`-Image
Ihr Projekt startet. Was `backend/` enthält, ist der Code, den die Laufzeitumgebung lädt:

| Pfad | Beschreibung |
|---|---|
| `backend/schema/` | Die Tabellen und die `defaultRls`, die deren Index exportiert |
| `backend/resources.ts`, `backend/storage.ts`, `backend/hooks.ts` | Deklarierte Ressourcen, `storageAuthorize` und globale Tabellen-Hooks |
| `backend/functions/` | Eigene Routen, automatisch gemountet unter `/api/functions/<filename>` |
| `backend/crons/` | Geplante Aufgaben, die auf dieselbe Weise erkannt werden (erstellen Sie das Verzeichnis, wenn Sie einen benötigen) |
| `backend/src/schema.generated.ts` | Das Drizzle-Schema Ihrer Tabellen: geschrieben von `rebase init` und bei jedem `rebase dev` sowie `rebase build` neu generiert |

Die Laufzeitumgebung richtet Folgendes ein:

- **REST-API** unter `/api/data/*` – generierte CRUD-Operationen für jede Tabelle
- **Auth** unter `/api/auth/*` – Registrierung, Login, Refresh, OAuth
- **Storage** unter `/api/storage/*` – Upload und Download
- **WebSocket** – Echtzeit-Synchronisierung über Postgres LISTEN/NOTIFY
- **Ihre Funktionen und Crons** aus den oben genannten Verzeichnissen

Die Konfiguration erfolgt über `rebase.json`, die Dateien in `backend/` und Umgebungsvariablen.
Siehe [Umgebung & Konfiguration](/docs/getting-started/configuration).

`rebase build` wandelt all das in ein **Bundle** um – die kompilierten Tabellen,
Funktionen und Crons samt einem Manifest –, das die Managed Runtime startet. Nichts
an dem Bundle wird manuell geschrieben; wenn Sie sehen möchten, wie eines aussieht,
erfahren Sie in [Laufzeitumgebung & Bundles](/docs/architecture/runtime-and-bundles/), was darin enthalten ist.

Das vom Frontend bereitgestellte Panel besteht aus zwei Teilen. **Studio** ist der Entwicklerbereich –
der Schema-Editor, die SQL-Konsole, der RLS-Policy-Browser – und befindet sich
hinter dem Umschalter im Drawer, nicht in einem separaten Deployment. Siehe [Studio](/docs/studio/).

Um stattdessen die volle Kontrolle über den Prozess zu übernehmen – eigene Middleware, Routen und Auth-Verdrahtung –,
führen Sie `rebase eject` aus. **Alles unterhalb dieses Absatzes gilt nur für ausgeklinkte (ejected) Projekte**:
Ein per Scaffold erstelltes Projekt enthält keine dieser Dateien, und nichts darin ruft
`initializeRebaseBackend` auf. Der Befehl schreibt einen Einstiegspunkt, der
`initializeRebaseBackend` direkt aufruft, sowie ein Dockerfile und eine Compose-Datei,
die diese erstellen; ab diesem Zeitpunkt warten Sie den Server selbst, und Plattform-Runtime-Upgrades
erreichen das Projekt nicht mehr. Diese Schnittstelle ist in
[Eigene Server-Integration](/docs/backend/custom-server) dokumentiert.

## Wie alles zusammenhängt

1. **Sie deklarieren** Tabellen in `backend/schema/`
2. **Das Backend** kompiliert sie, erstellt die Tabellen sowie Policies und mountet REST-, Echtzeit- und MCP-Routen
3. **Das Admin-Panel** liest sie über `GET /api/schema/tables` aus und rendert für jede Tabelle eine Ansicht, angepasst durch die Dateien in `frontend/src/cms/`
4. **Das CLI** liest sie aus, um das Drizzle-Schema (`rebase schema generate`), die SDK-Typen (`rebase generate-sdk`) und anhand dieses Schemas Migrationsdateien (`rebase db generate`) zu generieren

Während `rebase dev` läuft, führt das Speichern einer Datei unter `backend/schema/`
dazu, dass `backend/src/schema.generated.ts` sowie die SDK-Typen in
`generated/sdk/` neu generiert werden, das Backend neu gestartet wird und beim Start die
fehlenden Tabellen und Spalten erstellt werden. Außerhalb von `rebase dev` entsprechen denselben
Schritten die Befehle `rebase schema generate` und `rebase generate-sdk`.

Ein Projekt aus Versionen vor 0.31 besitzt stattdessen ein `config/collections/`-Verzeichnis. Jeder
Befehl verweigert die Ausführung und verweist auf `rebase migrate collections-to-tables`, wodurch
es migriert wird – siehe [den Upgrade-Leitfaden](/docs/upgrading/0-30-to-0-31/).

## Nächste Schritte

- **[Schnellstart](/docs/getting-started/quickstart)** — Starten Sie mit einem neuen Rebase-Projekt
- **[Tabellen](/docs/schema/)** — Deklarieren Sie Ihr Datenmodell
- **[Konfiguration](/docs/getting-started/configuration)** — Alle Umgebungsvariablen und Optionen
