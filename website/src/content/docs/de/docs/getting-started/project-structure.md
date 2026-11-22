---
sourceHash: 157b3967e59bc849
title: Projektstruktur
sidebar_label: Projektstruktur
description: "Der Aufbau eines Rebase-Projekts – die Tabellen in backend/schema, die vom Backend gelesenen Module und die Anpassungen des Admin-Panels in frontend/src/cms – mit und ohne Panel."
---

:::note[Sechs Begriffe, die auf dieser Seite verwendet werden]
Jeder dieser Begriffe hat hier eine ganz spezifische Bedeutung, und die meisten von ihnen bedeuten an anderer Stelle in der Branche etwas anderes.

- **Table** — eine Postgres-Tabelle, deklariert in TypeScript mit `defineTable` in
  `backend/schema/`. Das SQL, die Row-Level-Security-Policies, die API, die
  SDK-Typen und die Standardeinstellungen des Admin-Panels stammen alle davon ab.
- **Collection** — was das Admin-Panel anzeigt: eine als Liste und Formular
  gerenderte Tabelle, angepasst in `frontend/src/cms/`, oder eine Firestore-Collection,
  die das Panel direkt liest.
- **Studio** — die Entwicklerhälfte des Admin-Panels: SQL-Konsole, RLS-Policies,
  Schemadiagramm, Branches, Logs. Dieselbe App, die Ihr Content-Team verwendet,
  hinter einem Umschalter.
- **Managed runtime** — das veröffentlichte `rebasepro/server`-Image startet Ihr
  Projekt. Sie schreiben keine Server-Datei und erhalten Runtime-Upgrades ohne
  Rebuild. Die Alternative ist `rebase eject`, siehe unten.
- **Bundle** — was `rebase build` erzeugt: Ihre Tabellen, Funktionen und Crons,
  kompiliert mit einem Manifest, das angibt, wo sich was befindet. Es ist das,
  was die Managed Runtime startet.
- **Resource** — etwas, das das Projekt von dort benötigt, wo es ausgeführt wird:
  eine Datenbank, ein Bucket, ein Topic. Deklariert in `backend/resources.ts`,
  gebunden über Umgebungsvariablen.
:::

`rebase init` erstellt eines von zwei Layouts. Beide besitzen dasselbe `backend/`;
der Unterschied besteht darin, ob das Projekt das Admin-Panel enthält.

**Mit Admin-Panel** (Standard):

```
my-app/
├── .env                    # Generated for you: JWT_SECRET, a database password, a free port
├── rebase.json             # Which apps this repository contains, and how each is built
├── package.json            # Root workspace config
├── tsconfig.json           # Typechecks scripts/; each workspace typechecks on its own
├── docker-compose.yml      # Self-hosting: Postgres + the published runtime image
├── scripts/
│   └── example.ts          # Lists the tables and reads a few rows: `pnpm example`
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
`frontend/` – und auch ohne `backend/schema/`. Der Server liest die eigenen
Tabellen der Datenbank beim Start aus und stellt jede bereit, für die
Row-Level-Security aktiviert ist. Siehe [Nur Backend](/docs/getting-started/headless/).

```
my-api/
├── .env
├── rebase.json
├── package.json
└── backend/
    ├── storage.ts
    └── functions/
```

Zwei weitere Dateien erscheinen, wenn Sie sie benötigen, und die Runtime liest
beide: `backend/hooks.ts`, dessen `hooks`-Export für jede Tabelle ausgeführt wird
([Globale Hooks](/docs/backend/hooks/)), und `backend/crons/` für geplante Jobs.
`rebase generate-sdk --register` fügt `backend/generated/` hinzu.

`tsc --noEmit` im Root-Verzeichnis prüft `scripts/`; in `backend/` oder `frontend/`
prüft es den jeweiligen Workspace. Es gibt kein separates `config/`-Paket: Das
Frontend importiert eine Tabelle aus `backend/schema` ausschließlich als Typ
(`import type`). Ein Import von Werten aus `backend/` würde Server-Code – Hooks
und die von ihnen gelesenen Secrets – an den Browser ausliefern. Daher lässt
`rebaseBackendGuard()` aus `@rebasepro/app/vitePlugin`, das in der generierten
`frontend/vite.config.ts` enthalten ist, `vite build` und `vite dev` fehlschlagen,
wenn irgendetwas nach `backend/` aufgelöst wird, und nennt dabei den Importer,
den Import und die Datei. `rebase build` verweigert ein Frontend ohne diesen
Schutz. Um ihn zu einem bestehenden Projekt hinzuzufügen, importieren Sie ihn und
fügen Sie `rebaseBackendGuard()` zu `plugins` in `frontend/vite.config.ts` hinzu.

:::note[Es gibt kein `backend/src/index.ts`]
Und kein `Dockerfile`. Ein generiertes Projekt deklariert `runtime: "managed"` in
`rebase.json`, was bedeutet, dass das **veröffentlichte `rebasepro/server`-Image
Ihr Projekt als Bundle startet** – dasselbe Artefakt, unabhängig davon, ob Sie es
selbst hosten oder in Rebase Cloud deployen. Sie konfigurieren den Server über
`rebase.json`, die Dateien in `backend/` und Umgebungsvariablen, anstatt einen
Einstiegspunkt zu schreiben.

Wenn Sie die volle Kontrolle über den Prozess haben möchten – Ihre eigene
Middleware, eigene Routen, eigene Auth-Verdrahtung –, schreibt `rebase eject` den
Einstiegspunkt, ein Dockerfile und eine Compose-Datei, die diese baut. Siehe
[Benutzerdefinierte Server-Integration](/docs/backend/custom-server).
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
erforderlich. Eine Tabelle wird berücksichtigt, sobald `backend/schema/index.ts`
sie exportiert – ein `defineTable`, das im Index ausgelassen wird, verhindert den
Start. [Tabellen](/docs/schema/) deckt alle Optionen ab.

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

`main.tsx` bindet dies unter einem `react-router`-`basename` ein, der aus
`import.meta.env.BASE_URL` stammt. `rebase build` setzt diesen Wert anhand des
`path`, den diese App in `rebase.json` deklariert – sodass die Assets, der
Router und der Server übereinstimmen, ohne dass der Wert dreimal manuell angegeben
werden muss.

### Kernkonzepte

- **`createRebaseClient`** — Erstellt den SDK-Client, der HTTP-Anfragen, WebSocket-Verbindungen und die Verwaltung von Auth-Tokens übernimmt. Rufen Sie ihn einmal auf Modulebene auf: Innerhalb einer Komponente, selbst in einem `useMemo`, instanziiert `<React.StrictMode>` im Entwicklungsmodus einen zweiten Client.
- **`<RebaseCMS tableCustomizations>`** — Das Panel rendert jede Tabelle, die das Backend unter `GET /api/schema/tables` bereitstellt; die `customizeTable`-Objekte aus `frontend/src/cms/` verändern das Aussehen ausgewählter Tabellen, und `uiConfig` überträgt das gemeinsame Layout aus `frontend/src/cms/ui-config.json`. Siehe [Tabelle anpassen](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences).
- **`useRebaseAuthController`** — Hält den angemeldeten Benutzer sowie den Token-Lebenszyklus und wird über `<Rebase>` an alles darunter liegende verteilt.

## Backend (`backend/`)

Es gibt keine Server-Datei, die gelesen werden muss – das ist so gewollt: Ein per
Scaffold erstelltes Projekt deklariert `runtime: "managed"`, sodass das veröffentlichte
`rebasepro/server`-Image Ihr Projekt startet. `backend/` enthält den Code, den die
Runtime einliest:

| Pfad | Beschreibung |
|---|---|
| `backend/schema/` | Die Tabellen und die `defaultRls`, die ihr Index exportiert |
| `backend/resources.ts`, `backend/storage.ts`, `backend/hooks.ts` | Deklarierte Ressourcen, `storageAuthorize` und globale Tabellen-Hooks |
| `backend/functions/` | Benutzerdefinierte Routen, automatisch unter `/api/functions/<filename>` gemountet |
| `backend/crons/` | Geplante Jobs, die auf dieselbe Weise erkannt werden (erstellen Sie das Verzeichnis, wenn Sie sie benötigen) |
| `backend/src/schema.generated.ts` | Das Drizzle-Schema Ihrer Tabellen: von `rebase init` geschrieben und bei jedem `rebase dev` und `rebase build` neu generiert |

Die Runtime richtet Folgendes ein:

- **REST-API** unter `/api/data/*` — generiertes CRUD für jede Tabelle
- **Auth** unter `/api/auth/*` — Registrierung, Login, Refresh, OAuth
- **Storage** unter `/api/storage/*` — Upload und Download
- **WebSocket** — Echtzeit-Synchronisierung über Postgres LISTEN/NOTIFY
- **Ihre Funktionen und Crons** aus den oben genannten Verzeichnissen

Die Konfiguration stammt aus `rebase.json`, den Dateien in `backend/` und
Umgebungsvariablen. Siehe [Umgebung & Konfiguration](/docs/getting-started/configuration).

`rebase build` wandelt alles davon in ein **Bundle** um – die kompilierten Tabellen,
Funktionen und Crons plus ein Manifest –, welches die Managed Runtime startet. Nichts
an dem Bundle wird von Hand geschrieben; wenn Sie sehen möchten, wie eines aussieht,
beschreibt [Runtime & Bundles](/docs/architecture/runtime-and-bundles/), was darin enthalten ist.

Das vom Frontend bereitgestellte Panel hat zwei Hälften. **Studio** ist der
Entwicklerbereich – die SQL-Konsole, der RLS-Policy-Browser, das Schemadiagramm –
und befindet sich hinter dem Umschalter im Seitenmenü (Drawer), nicht in einem
separaten Deployment. Siehe [Studio](/docs/studio/).

Um stattdessen die volle Kontrolle über den Prozess zu übernehmen – Ihre eigene
Middleware, Routen und Auth-Verdrahtung –, führen Sie `rebase eject` aus. **Alles
unterhalb dieses Absatzes gilt nur nach einem Eject**: Ein per Scaffold erstelltes
Projekt enthält keine dieser Dateien, und nichts darin ruft `initializeRebaseBackend`
auf. Der Befehl erstellt einen Einstiegspunkt, der `initializeRebaseBackend` direkt
aufruft, sowie ein Dockerfile und eine Compose-Datei, die dieses baut; ab diesem
Zeitpunkt warten Sie den Server selbst und Plattform-Runtime-Upgrades erreichen
das Projekt nicht mehr. Diese Schnittstelle ist unter
[Benutzerdefinierte Server-Integration](/docs/backend/custom-server) dokumentiert.

## Wie alles zusammenhängt

1. **Sie deklarieren** Tabellen in `backend/schema/`
2. **Das Backend** kompiliert sie, erstellt die Tabellen sowie Policies und richtet REST-, Echtzeit- und MCP-Routen ein
3. **Das Admin-Panel** liest sie über `GET /api/schema/tables` ein und rendert eine Ansicht für jede Tabelle, angepasst durch die Dateien in `frontend/src/cms/`
4. **Die CLI** liest sie, um das Drizzle-Schema (`rebase schema generate`), die SDK-Typen (`rebase generate-sdk`) und aus diesem Schema die Migrationsdateien (`rebase db generate`) zu generieren

Während `rebase dev` läuft, führt das Speichern einer Datei unter `backend/schema/`
dazu, dass `backend/src/schema.generated.ts` und die SDK-Typen in `generated/sdk/`
neu generiert werden, das Backend neu gestartet wird und beim Start fehlende
Tabellen und Spalten erstellt werden. Außerhalb von `rebase dev` entsprechen diesen
Schritten `rebase schema generate` und `rebase generate-sdk`.

Ein Projekt aus Versionen vor 0.31 besitzt stattdessen ein `config/collections/`-Verzeichnis.
Jeder Befehl bricht in diesem Fall ab und verweist auf `rebase migrate collections-to-tables`,
wodurch die Umstellung vorgenommen wird – siehe [die Upgrade-Anleitung](/docs/upgrading/0-30-to-0-31/).

## Nächste Schritte

- **[Schnellstart](/docs/getting-started/quickstart)** — Erste Schritte mit einem neuen Rebase-Projekt
- **[Tabellen](/docs/schema/)** — Deklarieren Sie Ihr Datenmodell
- **[Konfiguration](/docs/getting-started/configuration)** — Alle Umgebungsvariablen und Optionen
