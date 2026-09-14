---
sourceHash: 8fb63312e30e41a2
title: Projektstruktur
sidebar_label: Projektstruktur
description: Verstehen Sie die Struktur eines Rebase-Projekts – Frontend, Backend und Collections-Konfiguration.
---

:::note[Fünf Begriffe, die diese Seite verwendet]
Jeder davon hat hier eine ganz spezifische Bedeutung, und vier davon bedeuten anderswo in der Branche etwas anderes.

- **Collection** — eine Tabelle, beschrieben in TypeScript. Das Schema, die API und
  die Admin-Oberfläche stammen alle aus derselben Datei.
- **Studio** — der Entwicklerbereich des Admin-Panels: Schema-Editor, SQL-Konsole,
  Policy-Browser. Dieselbe App, die Ihr Content-Team verwendet, umschaltbar per Toggle.
- **Managed runtime** — das veröffentlichte `rebasepro/server`-Image startet Ihr
  Projekt. Sie schreiben keine Server-Datei und erhalten Runtime-Upgrades ohne
  Rebuild. Die Alternative ist `rebase eject`, weiter unten.
- **Bundle** — das, was `rebase build` erzeugt: Ihre Collections, Functions und
  Crons, kompiliert, mit einem Manifest, das angibt, wo sich jedes Element befindet.
  Es ist das, was die Managed Runtime startet.
- **Resource** — etwas, das das Projekt von seiner Laufzeitumgebung benötigt: eine Datenbank,
  ein Bucket, ein Topic. Deklariert in `config/resources.ts`, angebunden über
  Umgebungsvariablen.
:::

Ein Rebase-Starterprojekt besteht aus drei miteinander verbundenen Packages:

```
my-app/
├── .env                    # Generated for you: JWT_SECRET, a database password, a free port
├── rebase.json             # Which apps this repository contains, and how each is built
├── package.json            # Root workspace config
├── docker-compose.yml      # Self-hosting: Postgres + the published runtime image
│
├── config/                 # Shared by the backend and the admin panel
│   ├── index.ts            # Re-exports what the runtime reads (collections, storageAuthorize)
│   ├── collections/        # Your data model
│   │   ├── index.ts        # Exports `collections` and the default security rules
│   │   ├── posts.ts        # Example collections
│   │   └── users.ts        # The auth collection
│   ├── resources.ts        # What this project needs from wherever it runs
│   ├── storage.ts          # Who may read, write and list files
│   └── cms.d.ts            # One line that makes the `admin` block legal here
│
├── backend/
│   ├── functions/          # Custom API routes, auto-mounted at /api/functions/<name>
│   │   └── hello.ts
│   └── src/
│       └── schema.generated.ts   # Drizzle schema, regenerated from your collections
│
└── frontend/               # The admin panel (React + Vite)
    ├── src/App.tsx
    ├── src/main.tsx
    └── vite.config.ts
```

:::note[Es gibt kein `backend/src/index.ts`]
Und kein `Dockerfile`. Ein neu erstelltes Projekt deklariert `runtime: "managed"` in
`rebase.json`, was bedeutet, dass das **veröffentlichte `rebasepro/server`-Image Ihr
Projekt als Bundle startet** — dasselbe Artefakt, unabhängig davon, ob Sie es selbst
hosten oder in Rebase Cloud deployen. Sie konfigurieren den Server über `rebase.json`,
`config/` und Umgebungsvariablen, anstatt einen Einstiegspunkt zu schreiben.

Wenn Sie die volle Kontrolle über den Prozess haben möchten — eigene Middleware,
eigene Routen, eigene Auth-Anbindung —, erstellt `rebase eject` den Einstiegspunkt,
ein Dockerfile und eine Compose-Datei, die diese baut. Siehe
[Custom Server Integration](/docs/backend/custom-server).
:::

## Frontend (`frontend/`)

Das Frontend ist eine standardmäßige **Vite + React + TypeScript**-Anwendung. Die wichtigste Datei ist `App.tsx`, die alle Rebase-Controller miteinander verknüpft:

```typescript title="frontend/src/App.tsx"
import React from "react";

import "@fontsource/jetbrains-mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";

import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { ErrorBoundary } from "@rebasepro/ui";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

// `rebase dev` injects VITE_API_URL with the port it actually bound, and that
// port is derived from this project's path rather than fixed — so a
// `http://localhost:3001` fallback here names a port nothing is listening on.
// A deployed build serves the admin from the same origin as the API, where an
// empty value is exactly what you want.
const API_URL = import.meta.env.VITE_API_URL;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export function App() {
    const rebaseClient = React.useMemo(() => createRebaseClient({
        baseUrl: API_URL,
        // Store the refresh token in an httpOnly cookie (XSS-safe) rather than
        // localStorage. The backend issues it via `auth.cookieAuth`.
        auth: { authFlowMode: "cookie" }
    }), []);

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
                <RebaseCMS
                    collections={collections}
                />
                <RebaseStudio/>
                <RebaseShell title="Rebase"/>
            </Rebase>
        </ErrorBoundary>
    );
}
```

`main.tsx` bindet es unter einem `react-router`-`basename` ein, der aus
`import.meta.env.BASE_URL` übernommen wird. Diesen setzt `rebase build` anhand des
`path`, den diese App in `rebase.json` deklariert — so stimmen die Assets, der
Router und der Server bei einem einzigen Wert überein, ohne dass er dreimal manuell
angegeben werden muss.

### Wichtige Konzepte

- **`createRebaseClient`** — Erstellt den SDK-Client, der HTTP-Anfragen, WebSocket-Verbindungen und die Verwaltung von Authentifizierungstoken übernimmt
- **`virtual:rebase-collections`** — Ein Vite-Plugin, das Ihre geteilten Collections zur Build-Zeit automatisch importiert
- **`useRebaseAuthController`** — Verwaltet den angemeldeten Benutzer sowie den Token-Lebenszyklus und wird von `<Rebase>` an alle untergeordneten Komponenten weitergegeben

## Backend (`backend/`)

Es gibt keine Server-Datei zu lesen, und das ist beabsichtigt: Ein neu erstelltes
Projekt deklariert `runtime: "managed"`, sodass das veröffentlichte
`rebasepro/server`-Image Ihr Projekt startet. `backend/` enthält den Code, den
die Runtime einliest:

| Pfad | Beschreibung |
|---|---|
| `backend/functions/` | Eigene Routen, automatisch unter `/api/functions/<filename>` gemountet |
| `backend/crons/` | Zeitgesteuerte Jobs (Cronjobs), die auf dieselbe Weise erkannt werden (erstellen Sie das Verzeichnis bei Bedarf) |
| `backend/src/schema.generated.ts` | Das Drizzle-Schema, das bei jedem `rebase dev` und `rebase build` aus Ihren Collections neu generiert wird |

Die Runtime richtet Folgendes ein:

- **REST-API** unter `/api/data/*` — generierte CRUD-Operationen für jede Collection
- **Auth** unter `/api/auth/*` — Registrierung, Login, Refresh, OAuth
- **Storage** unter `/api/storage/*` — Upload und Download
- **WebSocket** — Echtzeitsynchronisierung über Postgres LISTEN/NOTIFY
- **Ihre Functions und Crons** aus den oben genannten Verzeichnissen

Die Konfiguration erfolgt über `rebase.json`, das `config/`-Verzeichnis und
Umgebungsvariablen. Siehe [Environment & Configuration](/docs/getting-started/configuration).

`rebase build` wandelt all dies in ein **Bundle** um — die kompilierten
Collections, Functions und Crons samt einem Manifest —, das die Managed Runtime
bootet. Nichts an diesem Bundle wird von Hand geschrieben; wenn Sie sehen möchten,
wie eines aufgebaut ist, finden Sie die Details unter
[Runtime & Bundles](/docs/architecture/runtime-and-bundles/).

Das vom Frontend bereitgestellte Panel besteht aus zwei Hälften. **Studio** ist
der Entwicklerbereich — der Schema-Editor, die SQL-Konsole, der RLS-Policy-Browser —
und befindet sich hinter dem Umschalter im Drawer, kein separates Deployment. Siehe
[Studio](/docs/studio/).

Um stattdessen die Kontrolle über den Prozess zu übernehmen — eigene Middleware,
Routen und Auth-Verdrahtung —, führen Sie `rebase eject` aus. **Alles unterhalb dieses
Absatzes gilt nur für ausgeworfene (ejected) Projekte**: Ein neu erstelltes Projekt
besitzt keine dieser Dateien, und nichts darin ruft `initializeRebaseBackend` auf.
Der Befehl schreibt einen Einstiegspunkt, der `initializeRebaseBackend` direkt aufruft,
sowie ein Dockerfile und eine Compose-Datei, die dieses baut; von da an warten Sie
den Server selbst, und Plattform-Runtime-Upgrades werden nicht mehr auf das Projekt
angewendet. Diese Schnittstelle ist in [Custom Server Integration](/docs/backend/custom-server)
dokumentiert.

## Collections (`config/collections/`)

Collections sind die **Single Source of Truth** für Ihr Datenmodell. Sie werden in TypeScript definiert und sowohl vom Frontend (zur UI-Generierung) als auch vom Backend (zur Schema-Generierung und für das API-Routing) verwendet.

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    properties: {
        name: { type: "string", name: "Name" },
        price: { type: "number", name: "Price" }
    }
});

// The default export is what the registry picks up — every collection in the
// scaffold is written this way.
export default productsCollection;
```

Der `slug` wird zum URL-Pfad in der Admin-UI und zum REST-API-Endpunkt (`/api/data/products`), und der PostgreSQL-Tabellenname entspricht standardmäßig diesem Wert. Geben Sie `table` nur an, wenn sich beide voneinander unterscheiden.

## Wie alles zusammenhängt

1. **Sie definieren** Collections in `config/collections/`
2. **Das Backend** liest sie ein, um Drizzle-Schemas zu generieren und REST-Routen einzubinden
3. **Das Frontend** liest sie ein (über ein Vite-Plugin), um Tabellen, Formulare und die Navigation zu rendern
4. **Die CLI** liest sie ein, um mit `rebase schema generate` Migrationsdateien zu erzeugen

Während `rebase dev` läuft, wird beim Speichern einer Datei unter `config/collections/`
die Datei `backend/src/schema.generated.ts` neu generiert und das Backend neu
gestartet; beim Hochfahren werden fehlende Tabellen und Spalten automatisch erstellt.
Außerhalb von `rebase dev` entspricht dieser Schritt `rebase schema generate`.

## Nächste Schritte

- **[Quickstart](/docs/getting-started/quickstart)** — Starten Sie mit einem neuen Rebase-Projekt
- **[Configuration](/docs/getting-started/configuration)** — Alle Umgebungsvariablen und Optionen
