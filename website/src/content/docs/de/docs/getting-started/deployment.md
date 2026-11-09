---
sourceHash: d1e6d42ab673666c
title: Deployment
sidebar_label: Deployment
description: Stellen Sie Ihr Rebase-Projekt mithilfe von Docker, Cloud-Plattformen oder manuellen Setups in der Produktion bereit.
---

## Was ein Deployment ausliefert

Ein Rebase-Projekt wird als **ein einzelner Server** bereitgestellt (auf Rebase Cloud: `https://<project>.rebase.website`). Dieser Server verarbeitet:

- **`/api/*`** — die Daten-API, Authentifizierung, Realtime und Storage
- **alles andere** — Ihr gebautes `frontend/` als statische SPA

Es gibt keinen separaten Admin-Dienst: Das Admin-Panel ist Teil eines Frontends; wo es erscheint, hängt also davon ab, woraus Ihr Frontend besteht und ob Sie ihm einen eigenen Hostnamen zuweisen.

| Projekttyp | Root-URL zeigt | Admin-Panel befindet sich unter |
|--------------|----------------|-------------------|
| Standard-Scaffold (`rebase init`) | Das Admin-Panel | `/` — das Frontend **ist** das Admin-Panel |
| Eigenes Produkt-Frontend | Ihre App | Wo immer Sie es mounten, üblicherweise `/admin` — siehe [Basis-URL ändern](#basis-url-ändern) |
| Admin als App auf eigenem Hostnamen | Ihre App | `https://admin.example.com/`, bereitgestellt vom selben Server — siehe [Basis-URL ändern](#basis-url-ändern) |
| Reine Backend-Projekte | Nichts (nur API) | Nicht bereitgestellt |

:::note[Erster Aufruf]
Ein frisches **Produktions**-Deployment bietet keinen Bootstrap-Bildschirm, und die erste Registrierung ist ein normales Benutzerkonto. Benennen Sie den Administrator stattdessen vor dem ersten Start — siehe [Ihr erster Admin](#ihr-erster-admin).
:::

## Docker Compose (Empfohlen)

Das generierte Projekt enthält bereits eine funktionierende `docker-compose.yml` — **genau diese Datei sollte für ein per Scaffold erstelltes Projekt verwendet werden**, und zwar unverändert, anstatt sie manuell zu schreiben oder von woanders zu kopieren. `rebase init` hat die Secrets, das erste Admin-Konto und die festgelegte (pinned) Laufzeitversion bereits eingetragen, und sie wird bei jedem Push durch das frameworkeigene Acceptance Gate gestartet. Sie führt **zwei** Container aus: Postgres und die veröffentlichte Rebase-Laufzeitumgebung, in die Ihr erstelltes Bundle gemountet ist. Es muss kein Anwendungs-Image gebaut werden.

[Self-Hosting](/docs/deployment/self-hosting) behandelt dasselbe Deployment ohne ein Scaffold dahinter unter Verwendung von [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml) aus dem Rebase-Repository — sowie die zwei Dinge, die diese Datei bewusst auslässt: einen Connection-Pooler und die Ausführung von Funktionen und dem Job-Worker als eigene Prozesse.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

Immer zuerst `rebase build`: Der `api`-Dienst mountet `./dist-bundle`, und ohne diesen Schritt startet der Container mit einem leeren Verzeichnis.

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

Siehe [Ihr erster Admin](#ihr-erster-admin) unten zu den drei `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION`-Zeilen.

Das Bundle wird schreibgeschützt (read-only) gemountet. `rebase build` installiert die deklarierten Abhängigkeiten des Projekts in `dist-bundle`, es sei denn, Sie übergeben `--no-vendor`. In diesem Fall installiert die Runtime sie bei jedem Start und der Mount muss beschreibbar sein — entfernen Sie dann das `:ro`. Siehe [Self-Hosting](/docs/deployment/self-hosting/#dependencies).

`rebase init` trägt all dies für Sie in die `.env` ein, einschließlich eines generierten Admin-Passworts. Jede Variable ist mit `${VAR:?…}` deklariert, sodass eine fehlende Variable den Stack mit einer entsprechenden Fehlermeldung stoppt, anstatt ein halb konfiguriertes System zu starten — und da Compose die gesamte Datei vor der Dienstauswahl interpoliert, stoppt eine fehlende Variable auch `docker compose up -d db`.

Ändern Sie die Admin-E-Mail auf Ihre eigene, melden Sie sich an und ändern Sie das Passwort. Siehe [Ihr erster Admin](#ihr-erster-admin).

### Das Schema

Die Runtime erstellt beim Start fehlende Tabellen, **einschließlich derer Ihrer Collections** — `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt und Row-Level Security gleich mit anwendet. Ein erstes `docker compose up` auf einer leeren Datenbank startet direkt und liefert Ihre Collections aus.

Was beim Start jedoch niemals geschieht, ist das Ändern bereits vorhandener Strukturen: Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine Labels vorhandener Enums, da ein Container-Neustart das Schema nicht als Nebeneffekt eines Deployments umstrukturieren darf. Solche Änderungen erfolgen über das CLI, aus einem Checkout oder einem CI-Job, der auf die Produktionsdatenbank verweist:

```bash
pnpm run db:push
```

Führen Sie dies für jede Änderung aus, die nicht rein additiv ist — eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Für einen **versionierten Team-Workflow** committen Sie stattdessen Migrationsdateien mit `pnpm run db:generate` und führen `pnpm run db:migrate` als Release-Schritt aus. In beiden Fällen läuft dies über einen Projekt-Checkout und nicht innerhalb des laufenden Containers — das Runtime-Image wird ohne das CLI ausgeliefert.

## Ihr erster Admin

**Setzen Sie `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` vor dem ersten Start.** Jeder Plattform-Leitfaden auf dieser Website verweist hierauf, da dies der einzige Schritt ist, der sich von außen nicht wieder rückgängig machen oder beheben lässt.

Eine frische Datenbank enthält keine Benutzer, und außerhalb der Produktion erlaubt die Registrierungsrichtlinie die erste Registrierung und befördert diesen Benutzer zum Admin. Das muss so sein: Das Bootstrapping eines Admins erfordert einen Aufrufer, der bereits angemeldet ist, sodass eine leere Datenbank ohne eine solche Regel eine Sackgasse wäre. Auf einem Laptop ist die Person an der Tastatur der Betreiber, und genau so soll es sein.

Auf einem Host mit öffentlichem Namen ist dies jedoch fatal. Die ausgelieferten Artefakte stellen DNS und TLS bereit, noch bevor der Operator etwas eingetippt hat, sodass das Zeitfenster ab der ersten Sekunde für das Internet offen steht — und wer auch immer das Registrierungsformular zuerst erreicht, übernimmt das gesamte Deployment.

Unter `NODE_ENV=production` ist dieses Fenster daher geschlossen. Eine leere Benutzertabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`, ein über die offene Registrierung erstelltes Konto ist ein normales Benutzerkonto, `GET /api/auth/config` meldet niemals `needsSetup`, und `POST /api/admin/bootstrap` verweigert den Dienst.

`rebase dev` liest dieselbe `.env` und ignoriert beide Variablen bewusst, worauf beim Start auch hingewiesen wird: Lokal bleibt die erste Registrierung der Weg hinein. Die von `rebase init` geschriebenen Werte gehören zum Produktionsstart. Ein Seeding auf beiden Seiten würde das Zeitfenster verbrauchen, bevor der Entwickler die App geöffnet hat, was dazu führte, dass der erste Schritt des Quickstarts früher ein rollenloses Konto erzeugte.

Damit bleiben zwei Wege, von denen keiner eine Race Condition darstellt:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

Die Runtime erstellt dieses Konto einmalig, solange die Benutzertabelle leer ist, und unternimmt bei jedem nachfolgenden Start nichts weiter. Alternativ können Sie die Rolle einem bestehenden Benutzer mit dem Service-Key zuweisen, falls Sie Konten Out-of-Band bereitstellen.

Zwei Regeln, die die Runtime beim Start erzwingt und die beide zu einem unbrauchbaren Konto führen, wenn man sie missachtet:

- Das Passwort muss **mindestens 12 Zeichen** lang sein, andernfalls wird es abgelehnt und kein Konto erstellt.
- Die Adresse muss ein Format haben, das `POST /api/auth/login` akzeptiert — der Request-Body wird mit `z.string().email()` geparst, sodass eine Domain ohne Punkt (`admin@localhost`) zwar erfolgreich geseedet wird, dann aber bei jedem Login mit 400 fehlschlägt. Der Boot-Vorgang verweigert eine solche Adresse daher ebenfalls.

Setzen Sie entweder beide Variablen oder keine: Halbe Anmeldedaten sind ein Tippfehler, und das daraus resultierende Deployment — Selbstregistrierung deaktiviert, kein Admin — erfordert eine `psql`-Konsole zur Wiederherstellung. Der Boot-Prozess warnt, wenn die Tabelle in der Produktion leer ist und kein Admin benannt wurde.

Melden Sie sich an und ändern Sie das Passwort. Es liegt im Klartext überall dort, wo Sie Ihre Umgebungsvariablen hinterlegt haben.

## Produktions-Checkliste

Stellen Sie vor dem Deployment in die Produktion Folgendes sicher:

| Punkt | Details |
|------|---------|
| **Erster Admin** | Setzen Sie `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` **vor dem ersten Start** sowie `DISABLE_SELF_REGISTRATION=true`. In der Produktion wird das erste registrierte Konto nicht befördert — siehe [Ihr erster Admin](#ihr-erster-admin). |
| **NODE_ENV** | `NODE_ENV=production`. Dies schließt das Bootstrap-Fenster, verweigert lokalen Dateispeicher, erfordert `CORS_ORIGINS` und schaltet die OpenAPI-Dokumentation ab. Ein Deployment, das beim Standardwert belassen wird, läuft im Entwicklungsmodus. |
| **Datenbankschema** | Der Boot-Vorgang erstellt Ihre Collection-Tabellen und deren RLS additiv. Führen Sie `pnpm run db:push` (oder `pnpm run db:migrate`) für alle Änderungen aus, die nicht rein additiv sind. |
| **JWT_SECRET** | Verwenden Sie eine kryptografisch starke Zufallszeichenfolge (≥ 32 Zeichen). Niemals über verschiedene Umgebungen hinweg wiederverwenden. |
| **DATABASE_URL** | Verwenden Sie eine Managed-Postgres-Instanz (Neon, Supabase, RDS) mit aktiviertem TLS |
| **CORS_ORIGINS** | Immer erforderlich, nicht nur wenn das Frontend auf einer anderen Domain liegt. Die Runtime verweigert in der Produktion den Start, wenn weder `CORS_ORIGINS` noch `FRONTEND_URL` gesetzt sind, da eine API, die ihre erlaubten Origins errät, irgendwann die falschen zulässt. |
| **Storage-Zugriffskontrolle** | Ein konfigurierter Bucket **verweigert in der Produktion den Start** ohne ein Zugriffskontrollmodell. Storage unterliegt nicht der Row-Level Security und seine Keys teilen sich einen flachen Namespace. Ein Standardwert, der alles erlaubt, würde es jedem angemeldeten Benutzer gestatten, Dateien aufzulisten (`GET /storage/list?prefix=`) und anschließend die Dateien aller anderen Benutzer zu lesen, zu überschreiben oder zu löschen. Lösen Sie dies mit einem `storageAuthorize`-Hook oder `storagePolicies` (das Scaffold enthält einen Hook in `config/storage.ts`), oder deklarieren Sie die Absicht mit `STORAGE_PUBLIC_READ` für ein echtes öffentliches CDN bzw. `STORAGE_ALLOW_ANY_AUTHENTICATED` für eine Single-Tenant-App, bei der jedem Konto für jede Datei vertraut wird. |
| **Storage-Backend** | `STORAGE_TYPE=local` wird in der Produktion **verworfen**, und Uploads antworten mit `501 STORAGE_NOT_CONFIGURED` — das Dateisystem des Containers wird beim nächsten Neustart zerstört, sodass ein lokales Backend zu lautlosem Datenverlust führt. Verwenden Sie `s3` oder `gcs`, oder setzen Sie `FORCE_LOCAL_STORAGE=true`, falls der Pfad tatsächlich ein persistentes Volume ist. |
| **MFA_ENCRYPTION_KEY** | Setzen Sie diesen (32+ Zufallszeichen), wenn Sie TOTP nutzen. Ist er nicht gesetzt, werden gespeicherte Secrets mit `JWT_SECRET` verschlüsselt — eine Rotation dessen meldet dann alle Benutzer ab *und* macht jeden registrierten Authenticator unentschlüsselbar. |
| **HTTPS** | Terminieren Sie TLS an Ihrem Reverse Proxy (nginx, Cloudflare, Load Balancer) |
| **Öffentliche Lesezugriffe benötigen weiterhin einen Aufrufer** | `access: "public"` erweitert, welche *Zeilen* ein Aufrufer sieht, nicht wer anfragen darf: Ein anonymer Request an `/api/data/*` antwortet mit 401, solange `AUTH_REQUIRE` aktiv ist. Setzen Sie `AUTH_REQUIRE=false` für eine öffentliche Website, die ihr eigenes Backend abfragt, und überlassen Sie die Entscheidung allein RLS. Da es sich um eine Umgebungsvariable handelt, wird eine lokale `.env`, die dies setzt, **nicht** mit Ihrem Deployment übertragen. |

## Native Module auf der Managed Runtime

Die Managed Runtime von Rebase Cloud führt Ihr Bundle innerhalb eines gemeinsam genutzten Images aus. Sie besitzt keinen Compiler und keine Möglichkeit, ein **natives Modul** zu laden — also alles, was ein vorgefertigtes `.node`-Binary mitliefert. Das mit Abstand häufigste ist `sharp`, welches auch die naheliegende Abhängigkeit für alles ist, was Bilder ausliefert.

`rebase cloud deploy` verweigert dies vor dem Upload statt danach:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Drei Lösungswege, in der Reihenfolge, in der sie üblicherweise sinnvoll sind:

1. **Verlagern Sie die Arbeit in den Build-Schritt.** Skalieren und encodieren Sie Bilder während Ihres Builds und deployen Sie die Ergebnisse. So läuft nichts Natives im Request-Pfad.
2. **Nutzen Sie einen Dienst.** Ein Bild-CDN oder eine Transformations-API erledigt dieselbe Aufgabe hinter einer URL.
3. **Betreiben Sie Ihren eigenen Container.** Bei einem selbst gehosteten Deployment (Docker, Kubernetes, beliebige der [Plattform-Leitfäden](/docs/deployment/self-hosting)) handelt es sich um Ihr eigenes Image, sodass es beliebige Abhängigkeiten enthalten kann.

Funktionen, die lediglich Node statt eines nativen Binaries benötigen, funktionieren problemlos — das Deployment meldet diese separat (`1 of 3 function(s) depend on Node`) und führt sie aus. [Managed Backend Runtime](/docs/deployment/managed-runtime/) behandelt die weiteren Aspekte dessen, was die Managed Runtime zulässt: Binaries, Speicher, Timeouts, das Dateisystem, Secrets, Storage und ausgehenden Netzwerkverkehr.

## Ausliefern des Frontends

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

Auf diese Weise müssen Sie nur einen einzigen Server deployen, der sowohl die SPA als auch die API bedient.

## Plattform-Deployment-Leitfäden

Detaillierte Schritt-für-Schritt-Anleitungen für jede Plattform:

| Plattform | Typ | Leitfaden |
|----------|------|-------|
| **AWS** | App Runner / ECS + RDS | [Auf AWS deployen →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Auf GCP deployen →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Auf Azure deployen →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Auf Hetzner deployen →](/docs/deployment/hetzner) |
| **Scaleway** | Serverless Containers | [Auf Scaleway deployen →](/docs/deployment/scaleway) |
| **Railway** | PaaS (automatische Dockerfile-Erkennung) | [Auf Railway deployen →](/docs/deployment/railway) |
| **Fly.io** | Container-Runtime | [Auf Fly.io deployen →](/docs/deployment/flyio) |
| **InstaPods** | Node + PostgreSQL in einem Pod, kein Docker | [Auf InstaPods deployen →](/docs/deployment/instapods) |
| **Hostman** | App-Plattform + Managed PostgreSQL oder ein VPS | [Auf Hostman deployen →](/docs/deployment/hostman) |

:::caution
Cloud Run und andere serverlose Plattformen sind zustandslos. Verwenden Sie **S3-Storage** anstelle des lokalen Dateisystems für Datei-Uploads und setzen Sie `--min-instances 1`, falls Sie Rebase-Realtime-Funktionen nutzen (WebSocket-Verbindungen werden beendet, wenn Instanzen herunterskaliert werden).
:::


## Basis-URL ändern

Wenn das Admin-Panel unter einem Unterpfad laufen soll (z. B. `/admin`), ändern Sie das `path`-Feld der App in `rebase.json` und entsprechend auch `cms`:

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

`cms` gibt an, wo sich das CMS befindet, auf das Rebase Cloud verlinkt, und muss innerhalb des `path` der App liegen. Das Scaffold setzt beide auf `/`, sodass das alleinige Verschieben von `path` abgelehnt wird — das CMS läge sonst unter `/`, außerhalb einer App, die nun unter `/admin` beginnt.

Um dem Admin-Panel einen eigenen Hostnamen anstelle eines Unterpfads zuzuweisen, geben Sie für `path` eine vollständige URL an — `"path": "https://admin.example.com"` — und belassen `cms` bei `"/"`. Das Admin-Panel antwortet dann nur auf diesem Hostnamen und nicht auf der eigentlichen Adresse des Projekts; es ist somit nicht erreichbar, bis das DNS des Hostnamens verifiziert ist. Die API verbleibt auch auf diesem Hostnamen unter `/api`. Siehe [Eine App auf einem eigenen Hostnamen](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname) dafür, wie Anfragen zugeordnet werden und was ein Rebase Cloud Deploy mit dem Hostnamen macht.

`rebase build` übergibt `path` als `base` an Vite (über `REBASE_APP_BASE`), Vite gibt diesen Wert als `import.meta.env.BASE_URL` zurück, und `main.tsx` des Scaffolds übergibt ihn bereits an den Router — Assets, Routen und Server stimmen also überein, ohne dass das Präfix dreimal manuell angegeben werden muss:

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

Belassen Sie das Admin-Panel auf einem **Data-Router** — `createBrowserRouter` mit `<RouterProvider>`, wie es das Scaffold vorgibt. Dadurch stoppt ein Datensatz mit ungespeicherten Änderungen auch die Navigation innerhalb der App (ein Link in der Seitenleiste, die Zurück-Taste des Browsers) und fragt über `useBlocker` vorher nach, was nur ein Data-Router unterstützt.

Das Admin-Panel läuft auch unter einem einfachen `<BrowserRouter>`. Dort greift der Schutz vor ungespeicherten Änderungen auf den browsereigenen Dialog beim Verlassen der Seite zurück, welcher das Neuladen, das Schließen des Tabs oder die Eingabe einer URL abdeckt; die Navigation innerhalb der App wird jedoch ohne Nachfrage fortgesetzt.

**Backend** — wenn Sie auch die API verschieben, aktualisieren Sie deren Basispfad:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Einbinden ohne Router-`basename`]
Der oben beschriebene Ansatz mit `basename` wird empfohlen — react-router entfernt das Präfix aus der Location, sodass das Admin-Panel unverändert funktioniert. Wenn Sie das Admin-Panel stattdessen innerhalb einer **Route mit Pfadpräfix** einer größeren App einbetten (z. B. `<Route path="/admin/*">`) und kein `basename` nutzen, behält der aktuelle Pfad sein `/admin`-Präfix. Teilen Sie dies dem CMS mit, damit die Auflösung von URL ⇄ Collection das Präfix berücksichtigt — andernfalls bleiben Ansichten bei einem Lade-Spinner hängen, ohne dass Daten abgerufen werden:

```tsx
<RebaseCMS collections={collections} basePath="/admin" />
```

Setzen Sie **entweder** den `basename` des Routers **oder** `RebaseCMS basePath` — nicht beides, da das Präfix sonst doppelt angewendet wird.
:::

### Produkt-App + Admin in einem Deployment

Der häufigste Grund, das Admin-Panel nach `/admin` zu verschieben, ist die Bereitstellung der **eigenen Produkt-App** im Root desselben Deployments. Ein einziger Vite-Einstiegspunkt kann beide bedienen, aufgeteilt nach URL, sodass jede App lazy-geladen wird und reguläre Besucher Ihrer Produkt-App das Admin-Bundle niemals herunterladen müssen:

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

Ein Router für beide Teile: Das Admin-Panel ist auf einem Data-Router besser aufgehoben, da ungespeicherte Änderungen so die In-App-Navigation stoppen können, und es gibt keinen Grund, die Produkt-App auf einem anderen Router laufen zu lassen.

Das Backend benötigt für dieses Muster keine Änderungen — die API bleibt unter `/api` und der SPA-Catch-All liefert `index.html` sowohl für `/` als auch für `/admin/*` aus.

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** — Vollständige Backend-Konfiguration
- **[Storage-Konfiguration](/docs/backend/storage)** — S3-Einrichtung für die Produktion
