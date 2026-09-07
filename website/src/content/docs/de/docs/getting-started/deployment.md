---
sourceHash: b48cc9bf8ad4dcf3
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
| Benutzerdefiniertes Produkt-Frontend | Ihre App | Wo Sie es einbinden, üblicherweise `/admin` — siehe [Basis-URL ändern](#basis-url-ändern) |
| Reines Backend-Projekt | Nichts (nur API) | Nicht bereitgestellt |

:::note[Erster Besuch]
Eine frische **Produktions**-Bereitstellung bietet keinen Bootstrap-Bildschirm an, und ihre erste Registrierung ist ein gewöhnliches Konto. Benennen Sie den Administrator stattdessen vor dem ersten Start — siehe [Ihr erster Administrator](#ihr-erster-administrator).
:::

## Docker Compose (Empfohlen)

Das generierte Projekt enthält bereits eine funktionierende `docker-compose.yml`
— **diese Datei ist die, die man für ein gescaffoldetes Projekt nimmt**, so wie
sie ist, statt sie von Hand zu schreiben oder anderswo zu kopieren. `rebase
init` hat ihre Secrets, ihr erstes Admin-Konto und ihre fixierte Runtime-Version
eingetragen, und das Akzeptanz-Gate des Frameworks startet sie bei jedem Push.
Sie betreibt **zwei** Container: Postgres und die veröffentlichte
Rebase-Runtime, in die Ihr gebautes Bundle eingehängt wird. Es gibt kein
Anwendungs-Image zu bauen.

[Self-Hosting](/docs/deployment/self-hosting) behandelt dieselbe Bereitstellung
ohne Scaffold dahinter, mit
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml)
aus dem Rebase-Repository — und die zwei Dinge, die diese Datei bewusst
weglässt: einen Connection Pooler und den Betrieb von Functions und Job-Worker
als eigene Prozesse.

```bash
rebase build          # erzeugt ./dist-bundle
docker compose up -d
```

Immer zuerst `rebase build`: Der `api`-Dienst hängt `./dist-bundle` ein, und
ohne das startet der Container gegen ein leeres Verzeichnis.

Die Form der generierten Datei:

```yaml title="docker-compose.yml (generated — abridged)"
services:
  db:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:-changeme}
      POSTGRES_DB: rebase
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rebase_app -d rebase"]

  api:
    # The published runtime. Upgrading Rebase is a tag change, not a rebuild.
    image: rebasepro/server:${REBASE_VERSION:-latest}
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "${PORT:-3001}:3001"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://rebase_app:${DATABASE_PASSWORD:-changeme}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in .env}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY:?set REBASE_SERVICE_KEY in .env}
      CORS_ORIGINS: ${CORS_ORIGINS:?set CORS_ORIGINS in .env}
      # This service runs in production, where the first account to register is
      # not promoted to admin. So the admin is named instead.
      REBASE_ADMIN_EMAIL: ${REBASE_ADMIN_EMAIL:?set REBASE_ADMIN_EMAIL in .env}
      REBASE_ADMIN_PASSWORD: ${REBASE_ADMIN_PASSWORD:?set REBASE_ADMIN_PASSWORD in .env}
      DISABLE_SELF_REGISTRATION: ${DISABLE_SELF_REGISTRATION:-true}
    volumes:
      # Your built project, from `rebase build`. Read-only: the build vendors
      # the bundle's dependencies by default, so nothing has to write here.
      - ./dist-bundle:/bundle:ro

volumes:
  postgres_data:
```

Die drei `REBASE_ADMIN_*`- / `DISABLE_SELF_REGISTRATION`-Zeilen sind neu <span class="since-badge" data-since="0.18">Since 0.18</span>
— in 0.17.3 wird das erste registrierte Konto zum Administrator, auch in der
Produktion. Siehe [Ihr erster Administrator](#ihr-erster-administrator) weiter
unten.

Das Bundle wird schreibgeschützt eingehängt. `rebase build` installiert die
deklarierten Abhängigkeiten des Projekts in `dist-bundle`, sofern Sie nicht
`--no-vendor` übergeben — in dem Fall installiert die Runtime sie bei jedem Start
und die Einhängung muss beschreibbar sein: lassen Sie dann das `:ro` weg. Siehe
[Self-Hosting](/docs/deployment/self-hosting/#dependencies).

`rebase init` schreibt all das für Sie in die `.env`, einschließlich eines
generierten Admin-Passworts. Jede Variable ist mit `${VAR:?…}` deklariert, sodass
eine fehlende den Stack mit einer Meldung anhält, die sie benennt, statt etwas
halb Konfiguriertes zu starten — und Compose interpoliert die ganze Datei, bevor
es Dienste auswählt, sodass eine fehlende auch `docker compose up -d db` anhält.

Ändern Sie die Admin-E-Mail auf Ihre, melden Sie sich an und ändern Sie das
Passwort. Siehe [Ihr erster Administrator](#ihr-erster-administrator).

### Das Schema

Die Laufzeitumgebung legt beim Start fehlende Tabellen an, **auch die Ihrer
Collections** — `REBASE_MIGRATE_ON_BOOT` steht standardmäßig auf `ensure`, was
über das gesamte Schema additiv ist und die Row-Level-Security gleich mit
anwendet. Ein erstes `docker compose up` gegen eine leere Datenbank kommt hoch
und bedient Ihre Collections.

Was der Start nie tut, ist etwas zu ändern, das bereits existiert: Er ändert
keinen Spaltentyp, verwirft nichts und bearbeitet die Labels eines bestehenden
Enums nicht, denn ein Container-Neustart darf ein Schema nicht als Nebeneffekt
eines Deploys umformen. Das läuft über die CLI, aus einem Checkout oder einem
CI-Job, der auf die Produktionsdatenbank zeigt:

```bash
pnpm run db:push
```

Führen Sie das für die RLS von Verbindungstabellen bei
Viele-zu-viele-Beziehungen aus, und für jede Änderung, die nicht rein additiv
ist — eine umbenannte Spalte, ein verengter Typ, ein entferntes Feld.

Für einen **versionierten Team-Workflow** committen Sie stattdessen
Migrationsdateien mit `pnpm run db:generate` und führen `pnpm run db:migrate` als
Release-Schritt aus. So oder so läuft es aus einem Projekt-Checkout, nicht im
laufenden Container — das Runtime-Image wird ohne die CLI ausgeliefert.

## Ihr erster Administrator

<span class="since-badge" data-since="0.18">Since 0.18</span>

**Setzen Sie `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` vor dem ersten Start.** Jede Plattformanleitung auf dieser Seite verweist hierher, denn dies ist der eine Schritt, für den es von außen keine Reparatur gibt.

Eine frische Datenbank hat keine Benutzer, und außerhalb der Produktion lässt die Registrierungsrichtlinie die erste Anmeldung zu und macht sie zum Administrator. Das muss so sein: Um einen Administrator zu ernennen, braucht es einen bereits angemeldeten Aufrufer — eine leere Datenbank ohne diese Regel ist eine Sackgasse. Auf einem Laptop ist die Person an der Tastatur der Betreiber, und genau das ist richtig so.

Auf einem Host mit öffentlichem Namen ist es genau falsch. Die ausgelieferten Artefakte bringen DNS und TLS hoch, bevor der Betreiber irgendetwas getippt hat — das Fenster steht also ab der ersten Sekunde im Internet offen, und wer das Registrierungsformular zuerst erreicht, besitzt die Bereitstellung.

Unter `NODE_ENV=production` ist dieses Fenster daher geschlossen. Eine leere Benutzertabelle weist die Bootstrap-Registrierung mit `SETUP_REQUIRED` ab, ein über offene Registrierung angelegtes Konto ist ein gewöhnliches Konto, `GET /api/auth/config` meldet nie `needsSetup`, und `POST /api/admin/bootstrap` verweigert. In 0.17.3 und früher war das Fenster auch in der Produktion offen — aktualisieren Sie, bevor Sie eine frische Bereitstellung öffentlich machen.

`rebase dev` liest dieselbe `.env`, ignoriert beide Variablen aber bewusst und sagt es beim Start: lokal bleibt die erste Registrierung der Weg hinein. Die Werte, die `rebase init` geschrieben hat, gehören dem Produktionsstart. Auf beiden Seiten zu seeden würde das Fenster verbrauchen, bevor die Entwicklerin die App überhaupt geöffnet hat — genau das hat den ersten Schritt des Quickstarts ein Konto ohne Rolle erzeugen lassen.

Damit bleiben zwei Wege hinein, von denen keiner ein Wettlauf ist:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

Die Laufzeitumgebung legt dieses Konto einmal an, solange die Benutzertabelle leer ist, und tut bei jedem weiteren Start nichts. Oder weisen Sie einem bestehenden Benutzer die Rolle mit dem Service-Key zu, wenn Sie Konten außerhalb der Anwendung bereitstellen.

Zwei Regeln erzwingt die Laufzeitumgebung beim Start, und beide erzeugen sonst ein Konto, das niemand benutzen kann:

- Das Passwort muss **mindestens 12 Zeichen** haben, sonst wird es abgelehnt und kein Konto angelegt.
- Die Adresse muss eine sein, die `POST /api/auth/login` akzeptiert — die Route prüft ihren Body mit `z.string().email()`, sodass eine Domain ohne Punkt (`admin@localhost`) sauber angelegt wird und danach bei jeder Anmeldung mit 400 antwortet. Auch diese Adresse verweigert der Start.

Setzen Sie beide oder keine: eine halbe Zugangsdatenangabe ist ein Tippfehler, und die daraus entstehende Bereitstellung — Selbstregistrierung aus, kein Administrator — lässt sich nur an einer `psql`-Konsole retten. Der Start warnt, wenn die Tabelle in der Produktion leer ist und kein Administrator benannt wurde.

Melden Sie sich an und ändern Sie das Passwort. Es liegt im Klartext dort, wo Sie Ihre Umgebungsvariablen abgelegt haben.

## Produktions-Checkliste

<span class="since-badge" data-since="0.18">Since 0.18</span>

Bevor Sie in die Produktion bereitstellen, stellen Sie sicher:

| Punkt | Details |
|------|---------|
| **Erster Administrator** | Setzen Sie `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` **vor dem ersten Start**, dazu `DISABLE_SELF_REGISTRATION=true`. In der Produktion wird das erste registrierte Konto nicht befördert — siehe [Ihr erster Administrator](#ihr-erster-administrator). |
| **NODE_ENV** | `NODE_ENV=production`. Das ist es, was das Bootstrap-Fenster schließt, lokalen Dateispeicher ablehnt, `CORS_ORIGINS` verlangt und die OpenAPI-Doku abschaltet. Eine Bereitstellung, die auf dem Standardwert bleibt, läuft im Entwicklungsmodus. |
| **Datenbankschema** | Der Start legt Ihre Collection-Tabellen additiv an. Führen Sie `pnpm run db:push` (oder `pnpm run db:migrate`) für die RLS von Verbindungstabellen aus und für alles, was nicht rein additiv ist. |
| **JWT_SECRET** | Verwenden Sie eine kryptografisch starke Zufallszeichenkette (≥ 32 Zeichen). Niemals über Umgebungen hinweg wiederverwenden. |
| **DATABASE_URL** | Verwenden Sie eine verwaltete Postgres-Instanz (Neon, Supabase, RDS) mit aktiviertem TLS |
| **CORS_ORIGINS** | Immer, nicht nur wenn das Frontend auf einer anderen Domain liegt. Die Laufzeitumgebung verweigert den Start in der Produktion, wenn weder `CORS_ORIGINS` noch `FRONTEND_URL` gesetzt ist, denn eine API, die ihre erlaubten Origins errät, erlaubt irgendwann die falsche. |
| **Zugriffskontrolle für Storage** | Ein konfigurierter Bucket **verweigert in der Produktion den Start** ohne ein Zugriffskontrollmodell. Storage unterliegt keiner Row-Level-Security und seine Schlüssel teilen sich einen flachen Namensraum, sodass ein Alles-erlauben-Standard jedem angemeldeten Benutzer erlaubt aufzulisten (`GET /storage/list?prefix=`) und danach die Dateien aller anderen zu lesen, zu überschreiben oder zu löschen. Erfüllen Sie es mit einem `storageAuthorize`-Hook oder mit `storagePolicies` (das Scaffold liefert einen Hook in `config/storage.ts` mit), oder erklären Sie die Absicht mit `STORAGE_PUBLIC_READ` für ein echtes öffentliches CDN oder `STORAGE_ALLOW_ANY_AUTHENTICATED` für eine Single-Tenant-App, in der jedem Konto jede Datei anvertraut wird. |
| **Storage-Backend** | `STORAGE_TYPE=local` wird in der Produktion **fallen gelassen**, und Uploads antworten mit `501 STORAGE_NOT_CONFIGURED` — das Container-Dateisystem wird beim nächsten Neustart zerstört, ein lokales Backend ist also stiller Datenverlust. Verwenden Sie `s3` oder `gcs`, oder setzen Sie `FORCE_LOCAL_STORAGE=true`, wenn der Pfad wirklich ein dauerhaftes Volume ist. |
| **MFA_ENCRYPTION_KEY** | Setzen Sie ihn (32+ zufällige Zeichen), wenn Sie TOTP verwenden. Ohne ihn werden gespeicherte Secrets mit `JWT_SECRET` verschlüsselt — dessen Rotation meldet also alle ab *und* macht jeden eingerichteten Authenticator unentschlüsselbar. |
| **HTTPS** | Terminieren Sie TLS an Ihrem Reverse-Proxy (nginx, Cloudflare, Load Balancer) |
| **Öffentliche Lesezugriffe brauchen trotzdem einen Aufrufer** | `access: "public"` erweitert, welche *Zeilen* ein Aufrufer sieht, nicht wer aufrufen darf: Eine anonyme Anfrage an `/api/data/*` antwortet mit 401, solange `AUTH_REQUIRE` aktiv ist. Setzen Sie `AUTH_REQUIRE=false` für eine öffentliche Website, die ihr eigenes Backend liest, und überlassen Sie die Entscheidung allein RLS. Es ist eine Umgebungsvariable — eine lokale `.env`, die sie setzt, reist also **nicht** mit Ihrer Bereitstellung mit. |

## Native Module in der verwalteten Laufzeitumgebung

Die verwaltete Laufzeitumgebung von Rebase Cloud führt Ihr Bundle in einem
gemeinsam genutzten Image aus. Dort gibt es keinen Compiler und keine
Möglichkeit, ein **natives Modul** zu laden — also alles, was eine
vorkompilierte `.node`-Binärdatei mitbringt. Das mit Abstand häufigste ist
`sharp`, zugleich die naheliegende Abhängigkeit für alles, was Bilder
ausliefert.

`rebase cloud deploy` lehnt das vor dem Upload ab, nicht danach:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Drei Wege hindurch, in der Reihenfolge, in der sie meist richtig sind:

1. **Verlagern Sie die Arbeit in den Build.** Skalieren und kodieren Sie Bilder
   in Ihrem Build-Schritt und stellen Sie die Ergebnisse bereit. Im
   Anfrage-Pfad läuft dann nichts Natives.
2. **Nutzen Sie einen Dienst.** Ein Bild-CDN oder eine Transform-API erledigt
   dieselbe Arbeit hinter einer URL.
3. **Betreiben Sie Ihren eigenen Container.** Eine selbst gehostete
   Bereitstellung (Docker, Kubernetes, jede der
   [Plattformanleitungen](/docs/deployment/self-hosting)) ist Ihr Image und darf
   deshalb mitbringen, was sie will.

Funktionen, die lediglich Node brauchen und keine native Binärdatei, sind
unproblematisch — die Bereitstellung meldet diese getrennt (`1 of 3 function(s)
depend on Node`) und führt sie aus.

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

Wenn die Administration unter einem Unterpfad laufen soll (z. B. `/admin`), ändern Sie eine Zeile — den `path` der App in `rebase.json`:

```json title="rebase.json"
"admin": {
    "type": "static",
    "root": "frontend",
    "build": "npm run build --workspace frontend",
    "output": "frontend/dist",
    "path": "/admin"
}
```

`rebase build` übergibt ihn Vite als `base` (über `REBASE_APP_BASE`), Vite gibt ihn als `import.meta.env.BASE_URL` zurück, und die `main.tsx` des Scaffolds reicht ihn bereits an den Router weiter — so stimmen Assets, Routen und Server überein, ohne dass das Präfix an drei Stellen steht:

```tsx title="frontend/src/main.tsx"
// At "/" this is "".
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

const router = createBrowserRouter([
    {
        path: "/*",
        element: <App/>
    }
], { basename });
```

Die Administration braucht einen **Data Router** — `createBrowserRouter`, nicht der einfache `BrowserRouter` — weil das Blockieren ungespeicherter Änderungen `useBlocker` verwendet, das nur der Data Router bereitstellt.

**Backend** — wenn Sie auch die API verschieben, passen Sie deren Basispfad an:

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
<RebaseCMS collections={collections} basePath="/admin" />
```

Setzen Sie **entweder** den Router-`basename` **oder** `RebaseCMS basePath` — nicht beides, sonst wird das
Präfix zweimal angewendet.
:::

### Produkt-App + Admin in einer Bereitstellung

Der häufige Grund, den Admin nach `/admin` zu verschieben, ist die Auslieferung Ihrer **eigenen Produkt-App**
im Root derselben Bereitstellung. Ein einziger Vite-Einstiegspunkt kann beide ausliefern, nach URL aufgeteilt,
sodass jede App lazy geladen wird und Produktbesucher niemals das Admin-Bundle herunterladen:

```tsx title="frontend/src/main.tsx"
const isAdmin = window.location.pathname.startsWith("/admin");

const ProductApp = lazy(() => import("./App"));
const AdminApp = lazy(() => import("./AdminApp"));

const router = isAdmin
    // The admin lives under /admin, and `basename` is how the router is told.
    ? createBrowserRouter([{ path: "/*", element: <AdminApp/> }], { basename: "/admin" })
    : createBrowserRouter([{ path: "/*", element: <ProductApp/> }]);

root.render(<RouterProvider router={router}/>);
```

Ein Router für beide Hälften: die Administration braucht den Data Router ohnehin, und es gibt keinen Grund, die Produkt-App auf einen anderen zu setzen.

Das Backend benötigt für dieses Muster keine Änderungen — die API bleibt unter `/api` und der SPA-
Catch-all liefert `index.html` sowohl für `/` als auch für `/admin/*`.

## Nächste Schritte

- **[Backend-Überblick](/docs/backend)** — Vollständige Backend-Konfiguration
- **[Speicherkonfiguration](/docs/backend/storage)** — S3-Einrichtung für die Produktion
