---
sourceHash: 145ba18b6f108fbd
title: Deployment
sidebar_label: Deployment
description: Stellen Sie Ihr Rebase-Projekt mit Docker, Cloud-Plattformen oder manuellen Setups in der Produktion bereit.
---

## Was ein Deployment bereitstellt

Ein Rebase-Projekt wird als **ein einzelner Server** bereitgestellt (auf Rebase Cloud: `https://<project>.rebase.website`). Dieser Server verarbeitet:

- **`/api/*`** — die Daten-API, Authentifizierung, Realtime und Storage
- **alles andere** — Ihr gebautes `frontend/` als statische SPA

Es gibt keinen separaten Admin-Dienst: Das Admin-Panel ist Teil eines Frontends. Wo es erscheint, hängt also davon ab, woraus Ihr Frontend besteht und ob Sie ihm einen eigenen Hostnamen zuweisen.

| Projekttyp | Root-URL zeigt | Admin-Panel befindet sich unter |
|--------------|----------------|-------------------|
| Standard-Scaffold (`rebase init`) | Das Admin-Panel | `/` — das Frontend **ist** der Admin |
| Eigenes Produkt-Frontend | Ihre App | Wo immer Sie es mounten, üblicherweise `/admin` — siehe [Ändern der Basis-URL](#ändern-der-basis-url) |
| Admin als App auf eigenem Hostnamen | Ihre App | `https://admin.example.com/`, ausgeliefert vom selben Server — siehe [Ändern der Basis-URL](#ändern-der-basis-url) |
| Reine Backend-Projekte | Nichts (nur API) | Nicht bereitgestellt |

:::note[Erster Besuch]
Ein frisches **Produktions**-Deployment bietet keinen Bootstrap-Bildschirm, und die erste Registrierung ist ein gewöhnliches Benutzerkonto. Benennen Sie den Administrator stattdessen vor dem ersten Start — siehe [Ihr erster Administrator](#ihr-erster-administrator).
:::

## Docker Compose (Empfohlen)

Das generierte Projekt enthält bereits eine funktionierende `docker-compose.yml` — **diese Datei sollte für ein Scaffold-Projekt verwendet werden**, und zwar unverändert, anstatt sie manuell zu schreiben oder von woanders zu kopieren. `rebase init` hat die Secrets, das erste Admin-Konto und die festgelegte Runtime-Version eingetragen, und sie wird bei jedem Push durch das framework-eigene Acceptance-Gate gebootet. Sie führt **zwei** Container aus: Postgres und die veröffentlichte Rebase-Runtime, in die Ihr erstelltes Bundle gemountet wird. Es muss kein Anwendungs-Image gebaut werden.

[Self-Hosting](/docs/deployment/self-hosting) behandelt dasselbe Deployment ohne ein Scaffold dahinter unter Verwendung von [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml) aus dem Rebase-Repository — und die zwei Dinge, die diese Datei bewusst auslässt: einen Connection Pooler und die Ausführung von Funktionen sowie dem Job-Worker als eigene Prozesse.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

Immer zuerst `rebase build`: Der `api`-Dienst mountet `./dist-bundle`, und ohne diesen startet der Container mit einem leeren Verzeichnis.

Der Aufbau der generierten Datei:

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

Siehe [Ihr erster Administrator](#ihr-erster-administrator) weiter unten für die drei Zeilen `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION`.

Das Bundle wird schreibgeschützt (read-only) gemountet. `rebase build` installiert die deklarierten Abhängigkeiten des Projekts in `dist-bundle`, es sei denn, Sie übergeben `--no-vendor`. In diesem Fall installiert die Runtime sie bei jedem Start und der Mount muss beschreibbar sein — entfernen Sie `:ro`. Siehe [Self-hosting](/docs/deployment/self-hosting/#dependencies).

`rebase init` schreibt all dies für Sie in die `.env`, einschließlich eines generierten Admin-Passworts. Jede Variable ist mit `${VAR:?…}` deklariert, sodass eine fehlende Variable den Stack mit einer Fehlermeldung stoppt, die den Namen nennt, anstatt ein halb konfiguriertes System zu starten — und Compose interpoliert die gesamte Datei vor der Auswahl der Dienste, sodass eine fehlende Variable auch `docker compose up -d db` stoppt.

Ändern Sie die Admin-E-Mail auf Ihre eigene, melden Sie sich an und ändern Sie das Passwort. Siehe [Ihr erster Administrator](#ihr-erster-administrator).

### Das Schema

<span class="since-badge" data-since="0.31">Since 0.31</span>

Die Runtime erstellt fehlende Tabellen beim Start, **einschließlich der in `backend/schema` deklarierten** — `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was additiv auf das gesamte Schema wirkt und Row-Level Security gleich mit anwendet. Ein erstes `docker compose up` mit einer leeren Datenbank stellt Ihre Tabellen direkt bereit.

Was beim Booten niemals geschieht, ist das Ändern von bestehenden Elementen: Es ändert weder einen Spaltentyp, noch löscht es etwas oder bearbeitet die Labels eines bestehenden Enums, da ein Neustart des Containers das Schema nicht als Nebeneffekt eines Deployments umgestalten darf. Solche Änderungen erfolgen über die CLI, aus einem Repository-Checkout oder einem CI-Job, der auf die Produktionsdatenbank verweist:

```bash
pnpm run db:push
```

Führen Sie dies für jede Änderung aus, die nicht rein additiv ist — eine umbenannte Spalte, ein eingeengter Typ, ein entferntes Feld.

Für einen **versionierten Team-Workflow** committen Sie stattdessen Migrationsdateien mit `pnpm run db:generate` und führen `pnpm run db:migrate` als Release-Schritt aus. In beiden Fällen wird der Befehl aus einem Projekt-Checkout ausgeführt, nicht innerhalb des laufenden Containers — das Runtime-Image wird ohne CLI ausgeliefert.

## Ihr erster Administrator

**Setzen Sie `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` vor dem ersten Start.** Jeder Plattform-Leitfaden auf dieser Website verweist hierauf, da dies der einzige Schritt ist, der von außen nicht wiederhergestellt werden kann.

Eine frische Datenbank enthält keine Benutzer, und außerhalb der Produktion erlaubt die Registrierungsrichtlinie die erste Registrierung und befördert sie zum Admin. Das muss so sein: Das Bootstrapping eines Admins erfordert einen bereits angemeldeten Aufrufer, sodass eine leere Datenbank ohne eine solche Regel eine Sackgasse wäre. Auf einem Laptop ist die Person an der Tastatur der Betreiber, und genau das ist dort richtig.

Auf einem Host mit öffentlichem Namen ist es genau falsch. Die ausgelieferten Artefakte stellen DNS und TLS bereit, noch bevor der Operator etwas eingegeben hat. Das Zeitfenster ist also von der ersten Sekunde an für das Internet offen — und wer das Registrierungsformular zuerst erreicht, übernimmt das Deployment.

Unter `NODE_ENV=production` ist dieses Fenster daher geschlossen. Eine leere Benutzertabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`, ein über die offene Registrierung erstelltes Konto ist ein gewöhnliches Benutzerkonto, `GET /api/auth/config` meldet niemals `needsSetup` und `POST /api/admin/bootstrap` wird verweigert.

`rebase dev` liest dieselbe `.env` und ignoriert beide Variablen bewusst, worauf beim Start auch hingewiesen wird: Lokal ist die erste Registrierung weiterhin der vorgesehene Zugang. Die von `rebase init` geschriebenen Werte gehören zum Produktionsstart. Ein Seeding auf beiden Seiten würde das Zeitfenster aufbrauchen, bevor der Entwickler die App überhaupt geöffnet hat, was dazu führen würde, dass der erste Schritt des Quickstarts ein rollenloses Konto erzeugt.

Das lässt zwei Wege offen, von denen keiner eine Race Condition darstellt:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

Die Runtime erstellt dieses Konto einmalig, solange die Benutzertabelle leer ist, und tut bei jedem nachfolgenden Start nichts mehr. Alternativ können Sie die Rolle einem bestehenden Benutzer mit dem Service-Key zuweisen, wenn Sie Konten out-of-band bereitstellen.

Zwei Regeln, die die Runtime beim Start erzwingt, von denen jede ein unbrauchbares Konto erzeugt, wenn Sie sie falsch anwenden:

- Das Passwort muss **mindestens 12 Zeichen** lang sein, andernfalls wird es abgelehnt und kein Konto erstellt.
- Die E-Mail-Adresse muss eine sein, die `POST /api/auth/login` akzeptiert — der Body wird mit `z.string().email()` geparst, sodass eine Domain ohne Punkt (`admin@localhost`) zwar erfolgreich initialisiert wird, danach aber bei jedem Login mit 400 antwortet. Der Start verweigert eine solche Adresse ebenfalls.

Setzen Sie entweder beide oder keine: Ein halber Anmeldedaten-Satz ist ein Tippfehler, und das daraus resultierende Deployment — Selbstregistrierung deaktiviert, kein Admin — erfordert einen `psql`-Prompt zur Wiederherstellung. Beim Booten wird gewarnt, wenn die Tabelle in der Produktion leer ist und kein Admin angegeben wurde.

Melden Sie sich an und ändern Sie das Passwort. Es liegt im Klartext dort, wo Sie Ihre Umgebungsvariablen hinterlegt haben.

## Checkliste für die Produktion

Stellen Sie vor dem Deployment in die Produktion Folgendes sicher:

| Item | Details |
|------|---------|
| **Erster Administrator** | Setzen Sie `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` **vor dem ersten Start** sowie `DISABLE_SELF_REGISTRATION=true`. In der Produktion wird das erste registrierte Konto nicht befördert — siehe [Ihr erster Administrator](#ihr-erster-administrator). |
| **NODE_ENV** | `NODE_ENV=production`. Dies schließt das Bootstrap-Fenster, verweigert lokalen Dateispeicher, erfordert `CORS_ORIGINS` und schaltet die OpenAPI-Dokumentation ab. Ein Deployment, das beim Standardwert belassen wird, läuft im Entwicklungsmodus. |
| **Datenbankschema** | Der Start erstellt Ihre deklarierten Tabellen und deren RLS additiv. Führen Sie `pnpm run db:push` (oder `pnpm run db:migrate`) für alles aus, was nicht rein additiv ist. |
| **JWT_SECRET** | Verwenden Sie eine kryptografisch starke Zufallszeichenfolge (≥ 32 Zeichen). Niemals über Umgebungen hinweg wiederverwenden. |
| **DATABASE_URL** | Verwenden Sie eine verwaltete Postgres-Instanz (Neon, Supabase, RDS) mit aktiviertem TLS |
| **CORS_ORIGINS** | Immer erforderlich, nicht nur, wenn das Frontend auf einer anderen Domain liegt. Die Runtime weigert sich in der Produktion zu starten, wenn weder `CORS_ORIGINS` noch `FRONTEND_URL` gesetzt sind, da eine API, die ihre erlaubten Origins errät, letztlich die falsche erlaubt. |
| **Storage-Zugriffskontrolle** | Ein konfigurierter Bucket **verweigert den Start in der Produktion** ohne ein Zugriffskontrollmodell. Storage unterliegt nicht der Row-Level Security und seine Schlüssel teilen sich einen flachen Namespace. Ein standardmäßiges „Alles erlauben“ würde es jedem angemeldeten Benutzer gestatten, Dateien aufzulisten (`GET /storage/list?prefix=`) und anschließend die Dateien aller anderen Benutzer zu lesen, zu überschreiben oder zu löschen. Erfüllen Sie dies mit einem `storageAuthorize`-Hook oder `storagePolicies` (das Scaffold enthält einen Hook in `backend/storage.ts`) oder deklarieren Sie die Absicht mit `STORAGE_PUBLIC_READ` für ein echtes öffentliches CDN bzw. `STORAGE_ALLOW_ANY_AUTHENTICATED` für eine Single-Tenant-App, bei der jedem Konto für jede Datei vertraut wird. |
| **Storage-Backend** | `STORAGE_TYPE=local` wird in der Produktion **verworfen**, und Uploads antworten mit `501 STORAGE_NOT_CONFIGURED` — das Dateisystem des Containers wird beim nächsten Neustart zerstört, sodass ein lokales Backend zu stillem Datenverlust führt. Verwenden Sie `s3` oder `gcs`, oder setzen Sie `FORCE_LOCAL_STORAGE=true`, wenn der Pfad tatsächlich ein persistentes Volume ist. |
| **MFA_ENCRYPTION_KEY** | Setzen Sie dies (32+ Zufallszeichen), wenn Sie TOTP verwenden. Wenn nicht gesetzt, werden gespeicherte Secrets mit `JWT_SECRET` verschlüsselt — eine Rotation dessen meldet somit alle Benutzer ab *und* macht jeden registrierten Authenticator unentschlüsselbar. |
| **HTTPS** | Terminieren Sie TLS an Ihrem Reverse-Proxy (nginx, Cloudflare, Load Balancer) |
| **Öffentliche Lesezugriffe benötigen dennoch einen Aufrufer** | `access: "public"` erweitert, welche *Zeilen* ein Aufrufer sieht, nicht wer anfragen darf: Eine anonyme Anfrage an `/api/data/*` antwortet mit 401, solange `AUTH_REQUIRE` aktiv ist. Setzen Sie `AUTH_REQUIRE=false` für eine öffentliche Website, die ihr eigenes Backend liest, und überlassen Sie die Entscheidung allein RLS. Da es sich um eine Umgebungsvariable handelt, wandert eine lokale `.env`, die dies setzt, **nicht** mit Ihrem Deployment mit. |

## Native Module auf der Managed Runtime

Die Managed Runtime von Rebase Cloud führt Ihr Bundle innerhalb eines gemeinsam genutzten Images aus. Sie verfügt über keinen Compiler und keine Möglichkeit, ein **natives Modul** zu laden — also alles, was ein vorgebautes `.node`-Binary mitliefert. Das mit Abstand häufigste ist `sharp`, welches auch die naheliegende Abhängigkeit für das Ausliefern von Bildern ist.

`rebase cloud deploy` lehnt dies bereits vor dem Upload und nicht erst danach ab:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Drei Lösungsansätze, in der Reihenfolge ihrer typischen Eignung:

1. **Verlagern Sie die Arbeit in die Build-Phase.** Skalieren und encodieren Sie Bilder in Ihrem Build-Schritt neu und deployen Sie die Ergebnisse. Im Request-Pfad läuft nichts Natives.
2. **Nutzen Sie einen externen Dienst.** Ein Image-CDN oder eine Transformations-API erledigt dieselbe Arbeit hinter einer URL.
3. **Betreiben Sie Ihren eigenen Container.** Ein selbst gehostetes Deployment (Docker, Kubernetes, jeder der [Plattform-Leitfäden](/docs/deployment/self-hosting)) nutzt Ihr eigenes Image und kann daher beliebige Abhängigkeiten enthalten.

Funktionen, die lediglich Node statt eines nativen Binaries benötigen, sind unproblematisch — das Deployment meldet diese separat (`1 of 3 function(s) depend on Node`) und führt sie aus. [Managed Backend Runtime](/docs/deployment/managed-runtime/) behandelt die weiteren Aspekte der Managed Runtime: Binaries, Arbeitsspeicher, Timeouts, das Dateisystem, Secrets, Storage und ausgehender Netzwerkverkehr.

## Bereitstellung des Frontends

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

Auf diese Weise müssen Sie nur einen einzigen Server deployen, der sowohl die SPA als auch die API verarbeitet.

## Plattform-Deployment-Leitfäden

Detaillierte Schritt-für-Schritt-Anleitungen für jede Plattform:

| Plattform | Typ | Anleitung |
|-----------|-----|-----------|
| **AWS** | App Runner / ECS + RDS | [Auf AWS deployen →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Auf GCP deployen →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Auf Azure deployen →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Auf Hetzner deployen →](/docs/deployment/hetzner) |
| **Scaleway** | Serverless Containers | [Auf Scaleway deployen →](/docs/deployment/scaleway) |
| **Railway** | PaaS (auto-detect Dockerfile) | [Auf Railway deployen →](/docs/deployment/railway) |
| **Fly.io** | Container-Runtime | [Auf Fly.io deployen →](/docs/deployment/flyio) |
| **InstaPods** | Node + PostgreSQL in einem Pod, ohne Docker | [Auf InstaPods deployen →](/docs/deployment/instapods) |
| **Hostman** | App-Plattform + Managed PostgreSQL oder ein VPS | [Auf Hostman deployen →](/docs/deployment/hostman) |

:::caution
Cloud Run und andere serverlose Plattformen sind zustandslos (stateless). Verwenden Sie **S3-Speicher** anstelle des lokalen Dateisystems für Datei-Uploads und setzen Sie `--min-instances 1`, wenn Sie Rebase-Realtime-Funktionen nutzen (WebSocket-Verbindungen werden beendet, wenn Instanzen herunterskalieren).
:::


## Ändern der Basis-URL

Wenn Sie möchten, dass der Admin unter einem Unterpfad (z. B. `/admin`) läuft, ändern Sie den `path` der App in `rebase.json` und entsprechend auch `cms`:

```json title="rebase.json"
"admin": {
    "type": "static",
    "root": "frontend",
    "build": "npm run build --workspace frontend",
    "output": "frontend/dist",
    "path": "/admin",
    "cms": "/admin"
}
```

`cms` gibt an, wo sich das CMS befindet, auf das Rebase Cloud verlinkt, und muss innerhalb des `path` der App liegen. Das Scaffold setzt beides auf `/`, weshalb das alleinige Verschieben von `path` abgelehnt wird — das CMS läge sonst unter `/`, außerhalb einer App, die nun bei `/admin` beginnt.

Um dem Admin einen eigenen Hostnamen anstelle eines Unterpfads zu geben, machen Sie `path` zu einer vollständigen URL — `"path": "https://admin.example.com"` — und belassen `cms` bei `"/"`. Der Admin antwortet dann ausschließlich auf diesem Hostnamen und nicht auf der eigentlichen Adresse des Projekts, sodass er nicht erreichbar ist, bis das DNS des Hostnamens verifiziert ist. Die API bleibt auch auf diesem Hostnamen unter `/api`. Siehe [Eine App auf eigenem Hostnamen](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname) dafür, wie Requests zugeordnet werden und wie ein Rebase Cloud-Deploy mit dem Hostnamen umgeht.

`rebase build` übergibt `path` an Vite als `base` (über `REBASE_APP_BASE`), Vite gibt dies als `import.meta.env.BASE_URL` zurück, und `main.tsx` des Scaffolds übergibt es bereits an den Router — so stimmen Assets, Routen und Server überein, ohne dass das Präfix dreimal manuell angegeben werden muss:

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

Belassen Sie den Admin auf einem **Data Router** — `createBrowserRouter` mit `<RouterProvider>`, wie es das Scaffold vorgibt. Dadurch verhindert ein Datensatz mit nicht gespeicherten Änderungen auch die In-App-Navigation (ein Link in der Seitenleiste, die Zurück-Schaltfläche des Browsers) und fragt zunächst über `useBlocker` nach, was nur ein Data Router unterstützt.

Der Admin funktioniert auch unter einem einfachen `<BrowserRouter>`. Dort greift der Schutz vor ungespeicherten Änderungen auf den browsereigenen Dialog beim Verlassen der Seite zurück, was das Neuladen, das Schließen des Tabs oder das Eingeben einer URL abdeckt; das Navigieren innerhalb der App wird jedoch ohne Nachfrage fortgesetzt.

**Backend** — wenn Sie auch die API verschieben, aktualisieren Sie deren Basispfad:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Einbinden ohne Router-`basename`]
Der obige `basename`-Ansatz ist der empfohlene Weg — react-router entfernt das Präfix aus der Location, sodass der Admin unverändert funktioniert. Wenn Sie den Admin stattdessen in eine **Route mit Pfadpräfix** einer größeren App einbetten (z. B. `<Route path="/admin/*">`) ohne `basename`, behält der aktuelle Pfad sein `/admin`-Präfix. Teilen Sie dies dem CMS mit, damit die URL⇄Tabellen-Auflösung das Präfix berücksichtigt — andernfalls bleiben Ansichten bei einem Lade-Spinner hängen, ohne dass Daten abgerufen werden:

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} basePath="/admin" />
```

Setzen Sie **entweder** den Router-`basename` **oder** `RebaseCMS basePath` — nicht beides, da das Präfix sonst doppelt angewendet wird.
:::

### Produkt-App + Admin in einem einzigen Deployment

Der häufigste Grund, den Admin nach `/admin` zu verschieben, ist das Ausliefern Ihrer **eigenen Produkt-App** auf der Root-Ebene desselben Deployments. Ein einzelner Vite-Einstiegspunkt kann beides bedienen, aufgeteilt nach URL, sodass jede App per Lazy Loading geladen wird und Besucher des Produkts das Admin-Bundle niemals herunterladen:

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

Ein einziger Router für beide Hälften: Der Admin profitiert von einem Data Router, der es ermöglicht, dass ungespeicherte Änderungen die In-App-Navigation stoppen, und es gibt keinen Grund, warum die Produkt-App einen anderen Router verwenden sollte.

Das Backend erfordert für dieses Muster keine Änderungen — die API bleibt bei `/api` und der SPA-Catch-All liefert `index.html` sowohl für `/` als auch für `/admin/*` aus.

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** — Vollständige Backend-Konfiguration
- **[Storage-Konfiguration](/docs/backend/storage)** — S3-Einrichtung für die Produktion
