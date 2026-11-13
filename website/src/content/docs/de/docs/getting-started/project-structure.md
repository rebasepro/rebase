---
sourceHash: c6b361597710219f
title: Projektstruktur
sidebar_label: Projektstruktur
description: "Der Aufbau eines Rebase-Projekts — die Tabellen in backend/schema, die Backend-Module, die die Runtime liest, und die Anpassungen des Admin-Panels in frontend/src/cms — mit und ohne Panel."
---

:::note[Sechs Begriffe, die diese Seite verwendet]
Jeder von ihnen hat hier eine spezifische Bedeutung, und die meisten bedeuten anderswo
in der Branche etwas anderes.

- **Table** — eine Postgres-Tabelle, in TypeScript mit `defineTable` in
  `backend/schema/` deklariert. Das SQL, die Row-Level-Security-Policies, die API, die
  SDK-Typen und die Standardeinstellungen des Admin-Panels stammen alle davon ab.
- **Collection** — was das Admin-Panel anzeigt: eine Tabelle, die als Liste und
  Formular dargestellt wird, angepasst in `frontend/src/cms/`, oder eine Firestore-Collection,
  die das Panel direkt liest.
- **Studio** — die Entwickler-Hälfte des Admin-Panels: Schema-Editor, SQL-Konsole,
  Policy-Browser. Dieselbe App, die Ihr Content-Team verwendet, hinter einem Umschalter (Toggle).
- **Managed Runtime** — das veröffentlichte `rebasepro/server`-Image startet Ihr
  Projekt. Sie schreiben keine Server-Datei und erhalten Runtime-Upgrades ohne einen
  Rebuild. Die Alternative ist `rebase eject` weiter unten.
- **Bundle** — was `rebase build` erzeugt: Ihre Tabellen, Funktionen und Crons,
  kompiliert, mit einem Manifest, das angibt, wo sich jedes Element befindet. Es ist das,
  was die Managed Runtime startet.
- **Resource** — etwas, das das Projekt von dort benötigt, wo es ausgeführt wird: eine
  Datenbank, ein Bucket, ein Topic. Deklariert in `backend/resources.ts`, gebunden über
  Umgebungsvariablen.
:::

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`rebase init` erstellt eines von zwei Layouts als Gerüst. Beide haben dasselbe `backend/`;
der Unterschied besteht darin, ob das Projekt das Admin-Panel enthält.

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
`frontend/` — und auch ohne `backend/schema/`. Der Server liest die datenbankeigenen
Tabellen beim Booten und stellt jede bereit, für die Row-Level-Security aktiviert ist. Siehe
[Nur Backend](/docs/getting-started/headless/).

```
my-api/
├── .env
├── rebase.json
├── package.json
└── backend/
    ├── storage.ts
    └── functions/
```

Zwei weitere Dateien erscheinen, wenn Sie diese benötigen, und die Runtime liest beide:
`backend/hooks.ts`, dessen `hooks`-Export für jede Tabelle ausgeführt wird
([Globale Hooks](/docs/backend/hooks/)), und `backend/crons/` für geplante
Jobs. `rebase generate-sdk --register` fügt `backend/generated/` hinzu.

`tsc --noEmit` im Root prüft `scripts/`; in `backend/` oder `frontend/` prüft
es den jeweiligen Workspace. Es gibt kein separates `config/`-Paket: Das Frontend
importiert eine Tabelle aus `backend/schema` ausschließlich als Typ (`import type`). Ein
Wert-Import (Value Import) von irgendetwas unter `backend/` würde Servercode — Hooks und
die von ihnen gelesenen Secrets — an den Browser ausliefern. Daher lässt `rebaseBackendGuard()`
aus `@rebasepro/app/vitePlugin` im `frontend/vite.config.ts` des Scaffolds
`vite build` und `vite dev` fehlschlagen, wenn etwas zu `backend/` aufgelöst wird, wobei der
Importer, der Import und die Datei benannt werden. `rebase build` verweigert ein Frontend
ohne dieses Plugin. Um es zu einem bestehenden Projekt hinzuzufügen, importieren Sie es und
fügen Sie `rebaseBackendGuard()` zu `plugins` in `frontend/vite.config.ts` hinzu.

:::note[Es gibt kein `backend/src/index.ts`]
Und kein `Dockerfile`. Ein gescaffoldetes Projekt deklariert `runtime: "managed"` in
`rebase.json`, was bedeutet, dass das **veröffentlichte `rebasepro/server`-Image Ihr
Projekt als Bundle startet** — dasselbe Artefakt, unabhängig davon, ob Sie es selbst
hosten oder in Rebase Cloud deployen. Sie konfigurieren den Server über `rebase.json`,
die Dateien in `backend/` und Umgebungsvariablen, anstatt einen Einstiegspunkt zu schreiben.

Wenn Sie die volle Kontrolle über den Prozess übernehmen möchten — eigene Middleware, eigene
Routen, eigene Auth-Verdrahtung —, schreibt `rebase eject` den Einstiegspunkt, ein Dockerfile
und eine Compose-Datei, die diese baut. Siehe [Custom-Server-Integration](/docs/backend/custom-server).
:::

## Tabellen (`backend/schema/`)

<span class="since-badge" data-since="0.31">Seit 0.31</span>

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
erforderlich. Eine Tabelle zählt, sobald `backend/schema/index.ts` sie exportiert — ein
`defineTable`, das der Index auslässt, verweigert den Bootvorgang. [Tabellen](/docs/schema/)
deckt alle Optionen ab.

## Frontend (`frontend/`)

Das Frontend ist eine standardmäßige **Vite + React + TypeScript**-Anwendung. Die wichtigste Datei ist `App.tsx`, die alle Rebase-Controller miteinander verbindet:

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
// How the collection editor laid out the tables in development (labels, columns, views).
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

`main.tsx` bindet es unter einem `react-router`-`basename` ein, der aus
`import.meta.env.BASE_URL` übernommen wird. Diesen setzt `rebase build` anhand des `path`,
den diese App in `rebase.json` deklariert — so stimmen Assets, Router und Server in
einem Wert überein, ohne dass dieser dreimal angegeben werden muss.

### Wichtige Konzepte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- **`createRebaseClient`** — Erstellt den SDK-Client, der HTTP-Anfragen, WebSocket-Verbindungen und die Verwaltung von Auth-Tokens abwickelt. Rufen Sie ihn einmalig auf Modulebene auf: Innerhalb einer Komponente, selbst in einem `useMemo`, erstellt `<React.StrictMode>` in der Entwicklung einen zweiten Client
- **`<RebaseCMS tableCustomizations>`** — das Panel rendert jede Tabelle, die das Backend unter `GET /api/schema/tables` bereitstellt; die `customizeTable`-Objekte aus `frontend/src/cms/` verändern das Aussehen einiger von ihnen, und `uiConfig` enthält das, was der Collection-Editor während der Entwicklung gespeichert hat. Siehe [Anpassen einer Tabelle](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences)
- **`useRebaseAuthController`** — Hält den angemeldeten Benutzer und den Token-Lebenszyklus und wird von `<Rebase>` an alle darunterliegenden Komponenten weitergegeben

## Backend (`backend/`)

Es gibt keine Server-Datei, die gelesen werden müsste, und das ist genau so gewollt:
Ein scaffoldetes Projekt deklariert `runtime: "managed"`, sodass das veröffentlichte
`rebasepro/server`-Image Ihr Projekt startet. Was `backend/` enthält, ist der Code,
den die Runtime lädt:

| Pfad | Was es ist |
|---|---|
| `backend/schema/` | Die Tabellen und das `defaultRls`, das deren Index exportiert |
| `backend/resources.ts`, `backend/storage.ts`, `backend/hooks.ts` | Deklarierte Ressourcen, `storageAuthorize` und globale Tabellen-Hooks |
| `backend/functions/` | Eigene Routen, automatisch gemountet unter `/api/functions/<filename>` |
| `backend/crons/` | Geplante Jobs (Crons), auf die gleiche Weise erkannt (erstellen Sie das Verzeichnis, wenn Sie einen benötigen) |
| `backend/src/schema.generated.ts` | Das Drizzle-Schema Ihrer Tabellen: geschrieben von `rebase init` und bei jedem `rebase dev` und `rebase build` neu generiert |

Die Runtime richtet Folgendes ein:

- **REST-API** unter `/api/data/*` — generiertes CRUD für jede Tabelle
- **Auth** unter `/api/auth/*` — Registrierung, Login, Refresh, OAuth
- **Storage** unter `/api/storage/*` — Upload und Download
- **WebSocket** — Echtzeit-Synchronisierung über Postgres LISTEN/NOTIFY
- **Ihre Funktionen und Crons** aus den oben genannten Verzeichnissen

Die Konfiguration erfolgt über `rebase.json`, die Dateien in `backend/` und
Umgebungsvariablen. Siehe [Umgebung & Konfiguration](/docs/getting-started/configuration).

`rebase build` verwandelt all dies in ein **Bundle** — die kompilierten Tabellen,
Funktionen und Crons samt einem Manifest —, das die Managed Runtime startet. Nichts
an dem Bundle wird von Hand geschrieben; wenn Sie sehen möchten, wie eines aufgebaut ist,
erklärt [Runtime & Bundles](/docs/architecture/runtime-and-bundles/), was darin enthalten ist.

Das vom Frontend bereitgestellte Panel hat zwei Hälften. **Studio** ist der Entwicklerteil —
der Schema-Editor, die SQL-Konsole, der RLS-Policy-Browser — und befindet sich hinter
dem Umschalter im Drawer, kein separates Deployment. Siehe [Studio](/docs/studio/).

Um stattdessen die volle Kontrolle über den Prozess zu übernehmen — eigene Middleware, Routen
und Auth-Verdrahtung —, führen Sie `rebase eject` aus. **Alles unterhalb dieses Absatzes gilt
nur für ausgecheckte (ejected) Projekte**: Ein scaffoldetes Projekt enthält keine dieser Dateien,
und nichts darin ruft `initializeRebaseBackend` auf. Der Befehl schreibt einen Einstiegspunkt,
der `initializeRebaseBackend` direkt aufruft, sowie ein Dockerfile und eine Compose-Datei,
die es baut; ab diesem Zeitpunkt warten Sie den Server selbst und Plattform-Runtime-Upgrades
erreichen das Projekt nicht mehr. Diese Schnittstelle ist in
[Custom-Server-Integration](/docs/backend/custom-server) dokumentiert.

## Wie sie zusammenhängen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

1. **Sie deklarieren** Tabellen in `backend/schema/`
2. **Das Backend** kompiliert sie, erstellt die Tabellen sowie Policies und bindet REST-, Echtzeit- und MCP-Routen ein
3. **Das Admin-Panel** liest sie von `GET /api/schema/tables` und rendert für jede eine Ansicht, angepasst durch die Dateien in `frontend/src/cms/`
4. **Die CLI** liest sie, um das Drizzle-Schema (`rebase schema generate`), die SDK-Typen (`rebase generate-sdk`) und aus diesem Schema Migrationsdateien (`rebase db generate`) zu generieren

Während `rebase dev` läuft, generiert das Speichern einer Datei unter `backend/schema/`
`backend/src/schema.generated.ts` und die SDK-Typen in `generated/sdk/` neu, startet das
Backend neu, und beim Booten werden die noch fehlenden Tabellen und Spalten erstellt. Außerhalb
von `rebase dev` entsprechen diese Schritte `rebase schema generate` und `rebase generate-sdk`.

Ein Projekt von vor Version 0.31 verfügt stattdessen über ein Verzeichnis `config/collections/`.
Jeder Befehl verweigert die Ausführung und verweist auf `rebase migrate collections-to-tables`,
was die Migration durchführt — siehe [die Upgrade-Anleitung](/docs/upgrading/0-30-to-0-31/).

## Nächste Schritte

- **[Schnellstart](/docs/getting-started/quickstart)** — Starten Sie mit einem neuen Rebase-Projekt
- **[Tabellen](/docs/schema/)** — Deklarieren Sie Ihr Datenmodell
- **[Konfiguration](/docs/getting-started/configuration)** — Alle Umgebungsvariablen und Optionen
