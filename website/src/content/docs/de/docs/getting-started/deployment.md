---
title: Bereitstellung
sidebar_label: Bereitstellung
description: Stellen Sie Ihr Rebase-Projekt mit Docker, Cloud-Plattformen oder manuellen Setups in der Produktion bereit.
---

## Was eine Bereitstellung ausliefert

Ein Rebase-Projekt wird als **ein Server unter einer URL** bereitgestellt (auf Rebase Cloud: `https://<project>.rebase.website`). Dieser Server übernimmt:

- **`/api/*`** — die Daten-API, Authentifizierung, Echtzeit und Speicher
- **alles andere** — Ihr gebautes `frontend/` als statische SPA

Es gibt keine separate Admin-URL: Das Admin-Panel ist Teil Ihres Frontends, daher hängt es davon ab, was Ihr Frontend ist, wo es erscheint.

| Projekttyp | Root-URL zeigt | Admin-Panel befindet sich unter |
|--------------|----------------|-------------------|
| Standard-Scaffold (`rebase init`) | Das Admin-Panel | `/` — das Frontend **ist** der Admin |
| Benutzerdefiniertes Produkt-Frontend | Ihre App | Wo Sie es einbinden, üblicherweise `/admin` — siehe [Basis-URL ändern](#changing-the-base-url) |
| Reines Backend-Projekt | Nichts (nur API) | Nicht bereitgestellt |

:::note[Erster Besuch]
Beim ersten Besuch des Admins einer neuen Bereitstellung zeigt Rebase einen Bootstrap-Bildschirm zum **Erstellen Ihres Admin-Kontos**. Das erste registrierte Konto erhält Admin-Rechte — beanspruchen Sie es direkt nach der Bereitstellung.
:::

## Docker Compose (Empfohlen)

Das generierte Projekt enthält ein `Dockerfile` und eine `docker-compose.yml`. Dies ist der einfachste Weg zur Bereitstellung:

```yaml title="docker-compose.yml"
services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: rebase
      POSTGRES_DB: rebase
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  app:
    build:
      context: .
      dockerfile: backend/Dockerfile
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://rebase_app:rebase@postgres:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    depends_on:
      - postgres
    volumes:
      - uploads:/app/uploads

volumes:
  pgdata:
  uploads:
```

```bash
docker compose up -d
```

Das oben gezeigte YAML ist illustrativ — die im Projekt generierte `docker-compose.yml` ist die maßgebliche Quelle und verwendet bereits `context: .` mit `dockerfile: backend/Dockerfile` (das Backend-`Dockerfile` benötigt den gesamten Workspace als Build-Kontext).

## Datenbankschema erstellen

Beim Start erstellt Rebase automatisch **nur die Auth-Tabellen**. Die Tabellen für Ihre eigenen Collections werden **nicht** automatisch angelegt. Führen Sie daher nach dem ersten Start einmalig gegen die Produktionsdatenbank aus:

```bash
pnpm run db:push
```

Andernfalls gibt jede Collection einen `missing table`-Fehler zurück — die Falle dabei: Die App startet trotzdem und die Anmeldung funktioniert (die Auth-Tabellen existieren), sodass die Bereitstellung zunächst gesund wirkt. Führen Sie den Befehl aus einem Projekt-Checkout oder aus CI aus, wobei `DATABASE_URL` auf die Produktionsdatenbank zeigt — **nicht** im Container, da das Produktions-Image ohne die CLI ausgeliefert wird. Für versionierte Migrationen verwenden Sie stattdessen `pnpm run db:generate` und `pnpm run db:migrate`.

## Produktions-Checkliste

Bevor Sie in die Produktion bereitstellen, stellen Sie sicher:

| Punkt | Details |
|------|---------|
| **JWT_SECRET** | Verwenden Sie eine kryptografisch starke Zufallszeichenkette (≥ 32 Zeichen). Niemals über Umgebungen hinweg wiederverwenden. |
| **DATABASE_URL** | Verwenden Sie eine verwaltete Postgres-Instanz (Neon, Supabase, RDS) mit aktiviertem TLS |
| **Datenbankschema** | Führen Sie `pnpm run db:push` einmal gegen die Produktionsdatenbank aus, damit die Tabellen Ihrer Collections angelegt werden — beim Start werden automatisch nur die Auth-Tabellen erstellt |
| **CORS** | Konfigurieren Sie erlaubte Origins auf Ihrem Backend, wenn Frontend und Backend auf verschiedenen Domains liegen |
| **Speicher-Volumes** | Binden Sie persistente Volumes für Datei-Uploads ein. Oder wechseln Sie für die Produktion zu S3. |
| **HTTPS** | Terminieren Sie TLS an Ihrem Reverse-Proxy (nginx, Cloudflare, Load Balancer) |
| **Registrierung** | Setzen Sie `ALLOW_REGISTRATION=false`, nachdem Sie Ihr Admin-Konto erstellt haben |

## Das Frontend ausliefern

In der Produktion kann das Backend das Frontend als statische SPA ausliefern:

```typescript
import { serveSPA } from "@rebasepro/server";
import path from "path";

// After initializeRebaseBackend()
serveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });
```

Bauen Sie zuerst das Frontend:

```bash
cd frontend && pnpm build
```

Auf diese Weise müssen Sie nur einen Server bereitstellen, der sowohl SPA als auch API übernimmt.

## Plattform-Bereitstellungsanleitungen

Detaillierte Schritt-für-Schritt-Anleitungen für jede Plattform:

| Plattform | Typ | Anleitung |
|----------|------|-------|
| **AWS** | App Runner / ECS + RDS | [Auf AWS bereitstellen →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Auf GCP bereitstellen →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Auf Azure bereitstellen →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Auf Hetzner bereitstellen →](/docs/deployment/hetzner) |
| **Scaleway** | Serverless-Container | [Auf Scaleway bereitstellen →](/docs/deployment/scaleway) |
| **Railway** | PaaS (Dockerfile automatisch erkannt) | [Auf Railway bereitstellen →](/docs/deployment/railway) |
| **Fly.io** | Container-Runtime | [Auf Fly.io bereitstellen →](/docs/deployment/flyio) |

:::caution
Cloud Run und andere serverlose Plattformen sind zustandslos. Verwenden Sie **S3-Speicher** anstelle des lokalen Dateisystems für Datei-Uploads und setzen Sie `--min-instances 1`, wenn Sie die Echtzeit-Funktionen von Rebase verwenden (WebSocket-Verbindungen werden beendet, wenn Instanzen herunterskaliert werden).
:::


## Basis-URL ändern

Wenn Sie möchten, dass Rebase unter einem Unterpfad läuft (z. B. `/admin`):

**Frontend** — Aktualisieren Sie den `basename` des `BrowserRouter`:

```tsx title="frontend/src/main.tsx"
<BrowserRouter basename="/admin">
    <App />
</BrowserRouter>
```

**Backend** — Aktualisieren Sie den Basispfad:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Einbinden ohne einen Router-`basename`]
Der obige `basename`-Ansatz ist der empfohlene — react-router entfernt das
Präfix aus der Location, sodass der Admin unverändert funktioniert. Wenn Sie den
Admin stattdessen in eine **pfadpräfixierte Route** einer größeren App einbetten (z. B. `<Route path="/admin/*">`)
ohne `basename`, behält der aktuelle Pfad sein `/admin`-Präfix. Teilen Sie dem CMS davon
mit, damit die URL⇄Collection-Auflösung das Präfix berücksichtigt — andernfalls hängen Views an einem
Spinner ohne Datenabruf:

```tsx
<RebaseAdmin collections={collections} basePath="/admin" />
```

Setzen Sie **entweder** den Router-`basename` **oder** `RebaseAdmin basePath` — nicht beides, sonst wird das
Präfix zweimal angewendet.
:::

### Produkt-App + Admin in einer Bereitstellung

Der häufige Grund, den Admin nach `/admin` zu verschieben, ist die Auslieferung Ihrer **eigenen Produkt-App**
im Root derselben Bereitstellung. Ein einziger Vite-Einstiegspunkt kann beide ausliefern, nach URL aufgeteilt,
sodass jede App lazy geladen wird und Produktbesucher niemals das Admin-Bundle herunterladen:

```tsx title="frontend/src/main.tsx"
const isAdmin = window.location.pathname.startsWith("/admin");

const ProductApp = lazy(() => import("./App"));
const AdminApp = lazy(() => import("./AdminApp")); // renders <RebaseAdmin basePath="/admin" />

if (isAdmin) {
    // The admin uses useBlocker → needs a data router
    const router = createBrowserRouter([{ path: "/admin/*", element: <AdminApp /> }]);
    root.render(<RouterProvider router={router} />);
} else {
    root.render(<BrowserRouter><ProductApp /></BrowserRouter>);
}
```

Das Backend benötigt für dieses Muster keine Änderungen — die API bleibt unter `/api` und der SPA-
Catch-all liefert `index.html` sowohl für `/` als auch für `/admin/*`.

## Nächste Schritte

- **[Backend-Überblick](/docs/backend)** — Vollständige Backend-Konfiguration
- **[Speicherkonfiguration](/docs/backend/storage)** — S3-Einrichtung für die Produktion
