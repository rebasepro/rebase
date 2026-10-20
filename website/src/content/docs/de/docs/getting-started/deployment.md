---
sourceHash: 1fb30b9d3983d379
title: Deployment
sidebar_label: Deployment
description: Bereitstellung Ihres Rebase-Projekts in der Produktion mit Docker, Cloud-Plattformen oder manuellen Setups.
---

## Was ein Deployment bereitstellt

Ein Rebase-Projekt wird als **ein einzelner Server** bereitgestellt (auf Rebase Cloud: `https://<project>.rebase.website`). Dieser Server verarbeitet:

- **`/api/*`** — die Daten-API, Authentifizierung, Realtime und Speicher
- **alles andere** — Ihr gebautes `frontend/` als statische SPA

Es gibt keinen separaten Admin-Dienst: Das Admin-Panel ist Teil eines Frontends. Wo es erscheint, hängt also davon ab, was Ihr Frontend ist und ob Sie ihm einen eigenen Hostnamen zuweisen.

| Projekttyp | Root-URL zeigt | Admin-Panel befindet sich unter |
|--------------|----------------|-------------------|
| Standard-Gerüst (`rebase init`) | Das Admin-Panel | `/` — das Frontend **ist** der Admin |
| Benutzerdefiniertes Produkt-Frontend | Ihre App | Wo immer Sie es einbinden, üblicherweise `/admin` — siehe [Ändern der Basis-URL](#ändern-der-basis-url) |
| Admin als App auf eigenem Hostnamen | Ihre App | `https://admin.example.com/`, bereitgestellt vom selben Server — siehe [Ändern der Basis-URL](#ändern-der-basis-url) |
| Reine Backend-Projekte | Nichts (nur API) | Nicht bereitgestellt |

:::note[Erster Besuch]
Ein frisches **Produktions**-Deployment bietet keinen Bootstrap-Bildschirm, und die erste Registrierung ist ein gewöhnliches Konto. Benennen Sie den Administrator stattdessen vor dem ersten Start — siehe [Ihr erster Admin](#ihr-erster-admin).
:::

## Docker Compose (Empfohlen)

Das generierte Projekt enthält bereits eine funktionierende `docker-compose.yml` — **diese Datei sollte für ein per Gerüst erstelltes Projekt verwendet werden**, und zwar unverändert, anstatt sie manuell zu schreiben oder von woanders zu kopieren. `rebase init` hat die Secrets, das erste Admin-Konto und die festgelegte Laufzeitversion eingetragen, und sie wird bei jedem Push durch das eigene Acceptance-Gate des Frameworks gestartet. Es führt **zwei** Container aus: Postgres und die veröffentlichte Rebase-Laufzeitumgebung mit Ihrem gemounteten, gebauten Bundle. Es muss kein Anwendungs-Image gebaut werden.

[Self-Hosting](/docs/deployment/self-hosting) behandelt dasselbe Deployment ohne ein Gerüst dahinter, unter Verwendung von [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml) aus dem Rebase-Repository — sowie die zwei Dinge, die diese Datei bewusst auslässt: einen Connection-Pooler und das Ausführen von Funktionen und des Job-Workers als eigene Prozesse.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

Führen Sie immer zuerst `rebase build` aus: Der `api`-Dienst mountet `./dist-bundle`, und ohne diesen startet der Container mit einem leeren Verzeichnis.

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

Die drei Zeilen zu `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION` sind neu — unter 0.17.3 wird das erste registrierte Konto zum Administrator, auch in der Produktion. Siehe [Ihr erster Admin](#ihr-erster-admin) weiter unten.

Das Bundle wird schreibgeschützt (read-only) gemountet. `rebase build` installiert die deklarierten Abhängigkeiten des Projekts in `dist-bundle`, es sei denn, Sie übergeben `--no-vendor`. In diesem Fall installiert die Runtime sie bei jedem Start und der Mount muss beschreibbar sein — entfernen Sie das `:ro`. Siehe [Self-hosting](/docs/deployment/self-hosting/#dependencies).

`rebase init` schreibt all dies für Sie in die `.env`, einschließlich eines generierten Admin-Passworts. Jeder Wert wird mit `${VAR:?…}` deklariert, sodass eine fehlende Variable den Stack mit einer entsprechenden Fehlermeldung stoppt, anstatt ein halb konfiguriertes System zu starten — und Compose interpoliert die gesamte Datei vor der Auswahl von Diensten, sodass ein fehlender Wert auch `docker compose up -d db` stoppt.

Ändern Sie die Admin-E-Mail auf Ihre Adresse, melden Sie sich an und ändern Sie das Passwort. Siehe [Ihr erster Admin](#ihr-erster-admin).

### Das Schema

Die Laufzeitumgebung erstellt fehlende Tabellen beim Start, **einschließlich der Ihrer Collections** — `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt und damit auch Row-Level Security (RLS) anwendet. Ein erstes `docker compose up` auf einer leeren Datenbank startet direkt und stellt Ihre Collections bereit.

Was der Bootvorgang niemals tut, ist das Ändern von etwas, das bereits existiert: Er ändert keinen Spaltentyp, löscht nichts und bearbeitet keine Bezeichnungen eines bestehenden Enums, da ein Container-Neustart das Schema nicht als Nebeneffekt eines Deployments umstrukturieren darf. Diese Änderungen laufen über die CLI, aus einem Repository-Checkout oder einem CI-Job, der auf die Produktionsdatenbank verweist:

```bash
pnpm run db:push
```

Führen Sie dies für jede Änderung aus, die nicht rein additiv ist — eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Für einen **versionierten Team-Workflow** committen Sie stattdessen Migrationsdateien mit `pnpm run db:generate` und führen `pnpm run db:migrate` als Release-Schritt aus. In beiden Fällen erfolgt die Ausführung über einen Projekt-Checkout, nicht innerhalb des laufenden Containers — das Laufzeit-Image wird ohne die CLI ausgeliefert.

## Ihr erster Admin

**Setzen Sie `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` vor dem ersten Start.**
Jede Plattform-Anleitung auf dieser Website verweist hierauf, da dies der einzige Schritt ist, der von außen nicht wiederhergestellt werden kann.

Eine frische Datenbank enthält keine Benutzer, und außerhalb der Produktion erlaubt die Registrierungsrichtlinie die erste Registrierung und befördert sie zum Admin. Das muss so sein: Das Bootstrapping eines Admins erfordert einen Aufrufer, der bereits angemeldet ist; eine leere Datenbank ohne eine solche Regel wäre also eine Sackgasse. Auf einem Laptop ist die Person an der Tastatur der Betreiber, und genau das ist dort richtig.

Auf einem Host mit öffentlichem Namen ist es jedoch grundfalsch. Die bereitgestellten Artefakte schalten DNS und TLS auf, bevor der Betreiber überhaupt etwas eingetippt hat, sodass das Zeitfenster ab der ersten Sekunde für das Internet offen steht — und wer auch immer das Registrierungsformular zuerst erreicht, übernimmt das Deployment.

Unter `NODE_ENV=production` ist dieses Fenster daher geschlossen. Eine leere Benutzertabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`, ein über die offene Registrierung erstelltes Konto ist ein gewöhnliches Konto, `GET /api/auth/config` meldet niemals `needsSetup`, und `POST /api/admin/bootstrap` verweigert den Dienst. In 0.17.3 und früheren Versionen war das Fenster auch in der Produktion offen; führen Sie also ein Upgrade durch, bevor Sie ein neues Deployment öffentlich machen.

`rebase dev` liest dieselbe `.env` und ignoriert beide Variablen bewusst, worauf beim Start auch hingewiesen wird: Lokal ist die erste Registrierung weiterhin der Zugangsweg. Die von `rebase init` geschriebenen Werte gehören zum Produktionsstart. Ein Seeding auf beiden Seiten würde das Fenster schließen, bevor der Entwickler die App geöffnet hätte, was im ersten Schritt des Quickstarts dazu geführt hatte, dass ein rollenloses Konto erstellt wurde.

Das lässt zwei Zugangswege, von denen keiner ein Wettlauf ist:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

Die Laufzeitumgebung erstellt dieses Konto einmalig, solange die Benutzertabelle leer ist, und tut bei jedem späteren Start nichts weiter. Oder weisen Sie einem bestehenden Benutzer die Rolle mit dem Service-Key zu, falls Sie Konten außerhalb des Systems (out-of-band) bereitstellen.

Zwei Regeln setzt die Laufzeitumgebung beim Start durch, die beide zu einem unbrauchbaren Konto führen, wenn sie missachtet werden:

- Das Passwort muss **mindestens 12 Zeichen lang sein**, andernfalls wird es abgelehnt und kein Konto erstellt.
- Die Adresse muss eine sein, die `POST /api/auth/login` akzeptiert — der Body wird mit `z.string().email()` geparst. Eine Domain ohne Punkt (`admin@localhost`) wird also problemlos angelegt, antwortet dann aber bei jeder Anmeldung mit 400. Der Bootvorgang verweigert auch eine solche Adresse.

Setzen Sie entweder beide oder keine: Eine halbe Anmeldeinformation ist ein Tippfehler, und das daraus resultierende Deployment — Selbstregistrierung aus, kein Admin — erfordert eine `psql`-Eingabeaufforderung zur Wiederherstellung. Der Bootvorgang warnt, wenn die Tabelle in der Produktion leer ist und kein Admin benannt wurde.

Melden Sie sich an und ändern Sie das Passwort. Es liegt im Klartext dort, wo Sie Ihre Umgebungsvariablen hinterlegt haben.

## Checkliste für die Produktion

Stellen Sie vor dem Deployment in die Produktion Folgendes sicher:

| Punkt | Details |
|------|---------|
| **Erster Admin** | Setzen Sie `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` **vor dem ersten Start** sowie `DISABLE_SELF_REGISTRATION=true`. In der Produktion wird das erste registrierte Konto nicht befördert — siehe [Ihr erster Admin](#ihr-erster-admin). |
| **NODE_ENV** | `NODE_ENV=production`. Dies schließt das Bootstrap-Fenster, verweigert lokalen Dateispeicher, erfordert `CORS_ORIGINS` und schaltet die OpenAPI-Dokumentation ab. Ein Deployment mit dem Standardwert läuft im Entwicklungsmodus. |
| **Datenbankschema** | Der Bootvorgang erstellt Ihre Collection-Tabellen und deren RLS additiv. Führen Sie `pnpm run db:push` (oder `pnpm run db:migrate`) für alles aus, was nicht rein additiv ist. |
| **JWT_SECRET** | Verwenden Sie eine kryptografisch starke Zufallszeichenfolge (≥ 32 Zeichen). Niemals über Umgebungen hinweg wiederverwenden. |
| **DATABASE_URL** | Verwenden Sie eine verwaltete Postgres-Instanz (Neon, Supabase, RDS) mit aktiviertem TLS. |
| **CORS_ORIGINS** | Immer setzen, nicht nur, wenn das Frontend auf einer anderen Domain liegt. Die Laufzeitumgebung startet in der Produktion nicht ohne `CORS_ORIGINS` oder `FRONTEND_URL`, da eine API, die ihre erlaubten Origins errät, letztendlich die falsche erlaubt. |
| **Speicher-Zugriffskontrolle** | Ein konfigurierter Bucket **verweigert in der Produktion den Start** ohne ein Zugriffskontrollmodell. Der Speicher unterliegt nicht der Row-Level Security und seine Schlüssel teilen sich einen einzigen flachen Namensraum. Eine Standardeinstellung, die alles erlaubt, lässt jeden angemeldeten Benutzer auflisten (`GET /storage/list?prefix=`) und dann die Dateien aller anderen Benutzer lesen, überschreiben oder löschen. Erfüllen Sie dies mit einem `storageAuthorize`-Hook oder `storagePolicies` (das Gerüst liefert einen Hook in `config/storage.ts`), oder deklarieren Sie die Absicht mit `STORAGE_PUBLIC_READ` für ein echtes öffentliches CDN oder `STORAGE_ALLOW_ANY_AUTHENTICATED` für eine Single-Tenant-App, bei der jedem Konto bezüglich jeder Datei vertraut wird. |
| **Speicher-Backend** | `STORAGE_TYPE=local` wird in der Produktion **verworfen**, und Uploads antworten mit `501 STORAGE_NOT_CONFIGURED` — das Container-Dateisystem wird beim nächsten Neustart zerstört, sodass ein lokales Backend zu stillem Datenverlust führt. Verwenden Sie `s3` oder `gcs`, oder setzen Sie `FORCE_LOCAL_STORAGE=true`, wenn der Pfad wirklich ein dauerhaftes Volume ist. |
| **MFA_ENCRYPTION_KEY** | Setzen Sie diesen Wert (32+ Zufallszeichen), wenn Sie TOTP verwenden. Wenn nicht gesetzt, werden gespeicherte Secrets mit `JWT_SECRET` verschlüsselt — eine Rotation dessen meldet also alle Benutzer ab *und* macht jeden registrierten Authentifikator unentschlüsselbar. |
| **HTTPS** | Terminieren Sie TLS an Ihrem Reverse-Proxy (nginx, Cloudflare, Load Balancer). |
| **Öffentliche Lesezugriffe benötigen weiterhin einen Aufrufer** | `access: "public"` erweitert, welche *Zeilen* ein Aufrufer sieht, nicht wer aufrufen darf: Eine anonyme Anfrage an `/api/data/*` antwortet mit 401, solange `AUTH_REQUIRE` aktiviert ist. Setzen Sie `AUTH_REQUIRE=false` für eine öffentliche Website, die ihr eigenes Backend liest, und überlassen Sie die Entscheidung allein RLS. Da es sich um eine Umgebungsvariable handelt, wird eine lokale `.env`, die dies setzt, **nicht** mit Ihrem Deployment übertragen. |

## Native Module auf der verwalteten Laufzeitumgebung

Die verwaltete Laufzeitumgebung von Rebase Cloud führt Ihr Bundle innerhalb eines gemeinsam genutzten Images aus. Sie hat keinen Compiler und keine Möglichkeit, ein **natives Modul** zu laden — also alles, was ein vorgefertigtes `.node`-Binary mitliefert. Das mit Abstand häufigste ist `sharp`, welches auch die naheliegende Abhängigkeit für alles ist, was Bilder ausliefert.

`rebase cloud deploy` verweigert dies vor dem Upload statt danach:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Drei Lösungswege, in der Reihenfolge ihrer üblichen Eignung:

1. **Die Arbeit in die Build-Zeit verlagern.** Passen Sie die Größe an und kodieren Sie Bilder in Ihrem Build-Schritt neu und stellen Sie die Ergebnisse bereit. Im Request-Pfad läuft nichts Natives.
2. **Einen Dienst verwenden.** Ein Bild-CDN oder eine Transformations-API erledigt dieselbe Arbeit hinter einer URL.
3. **Einen eigenen Container betreiben.** Ein selbst gehostetes Deployment (Docker, Kubernetes, beliebige der [Plattform-Anleitungen](/docs/deployment/self-hosting)) ist Ihr eigenes Image und kann daher alles enthalten, was Sie möchten.

Funktionen, die lediglich Node und kein natives Binary benötigen, sind in Ordnung — das Deployment meldet diese separat (`1 of 3 function(s) depend on Node`) und führt sie aus. [Verwaltete Backend-Laufzeitumgebung](/docs/deployment/managed-runtime/) behandelt den Rest dessen, was die verwaltete Laufzeitumgebung erlaubt: Binärdateien, Speicher, Timeouts, das Dateisystem, Secrets, Speicher und ausgehenden Netzwerkverkehr.

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

Auf diese Weise müssen Sie nur einen Server bereitstellen, der sowohl die SPA als auch die API verarbeitet.

## Anleitungen für Cloud-Plattformen

Detaillierte Schritt-für-Schritt-Anleitungen für jede Plattform:

| Plattform | Typ | Anleitung |
|----------|------|-------|
| **AWS** | App Runner / ECS + RDS | [Auf AWS bereitstellen →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Auf GCP bereitstellen →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Auf Azure bereitstellen →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Auf Hetzner bereitstellen →](/docs/deployment/hetzner) |
| **Scaleway** | Serverless Containers | [Auf Scaleway bereitstellen →](/docs/deployment/scaleway) |
| **Railway** | PaaS (automatische Dockerfile-Erkennung) | [Auf Railway bereitstellen →](/docs/deployment/railway) |
| **Fly.io** | Container-Laufzeitumgebung | [Auf Fly.io bereitstellen →](/docs/deployment/flyio) |

:::caution
Cloud Run und andere serverlose Plattformen sind zustandslos (stateless). Verwenden Sie **S3-Speicher** anstelle des lokalen Dateisystems für Datei-Uploads und setzen Sie `--min-instances 1`, wenn Sie Rebase-Realtime-Funktionen nutzen (WebSocket-Verbindungen werden beendet, wenn Instanzen herunterskalieren).
:::

## Ändern der Basis-URL

Wenn Sie möchten, dass der Admin unter einem Sub-Pfad läuft (z. B. `/admin`), ändern Sie den `path` der App in `rebase.json` und deren `cms` entsprechend mit:

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

`cms` gibt an, wo sich das CMS befindet, auf das Rebase Cloud verlinkt, und es muss innerhalb des `path` der App liegen. Das Gerüst setzt beide auf `/`. Eine ausschließliche Änderung von `path` wird daher abgelehnt — das CMS läge dann bei `/`, außerhalb einer App, die nun bei `/admin` beginnt.

Um dem Admin anstelle eines Sub-Pfads einen eigenen Hostnamen zu geben, machen Sie `path` zu einer vollständigen URL — `"path": "https://admin.example.com"` — und lassen `cms` auf `"/"`. Der Admin antwortet dann nur auf diesem Hostnamen und nicht auf der Adresse des Projekts selbst, sodass er unerreichbar ist, bis das DNS des Hostnamens verifiziert ist. Die API bleibt auch auf diesem Hostnamen unter `/api`. Siehe [Eine App auf eigenem Hostnamen](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname) für Details dazu, wie Anfragen abgeglichen werden und wie ein Rebase Cloud-Deploy mit dem Hostnamen verfährt.

`rebase build` übergibt `path` als `base` an Vite (über `REBASE_APP_BASE`), Vite gibt es als `import.meta.env.BASE_URL` zurück, und das `main.tsx` des Gerüsts übergibt es bereits an den Router — so stimmen Assets, Routen und der Server überein, ohne dass das Präfix dreimal manuell angegeben werden muss:

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

Belassen Sie den Admin auf einem **Data-Router** — `createBrowserRouter` mit `<RouterProvider>`, wie es das Gerüst tut. Darunter stoppt ein Datensatz mit nicht gespeicherten Änderungen auch die Navigation innerhalb der App (ein Link in der Seitenleiste, die Zurück-Schaltfläche des Browsers) und fragt zuerst über `useBlocker` nach, was nur ein Data-Router bietet.

Der Admin läuft auch unter einem normalen `<BrowserRouter>`. Dort greift der Schutz vor ungespeicherten Änderungen auf die browser-eigene Aufforderung zum Verlassen der Seite zurück, was das Neuladen, Schließen des Tabs oder die Eingabe einer URL abdeckt; die Navigation innerhalb der App wird jedoch ohne Nachfrage fortgesetzt. Unter 0.24 wirft der Admin außerhalb eines Data-Routers einen Fehler.

**Backend** — wenn Sie die API ebenfalls verschieben, aktualisieren Sie deren Basispfad:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Einbinden ohne einen Router-`basename`]
Der obige `basename`-Ansatz ist der empfohlene Weg — react-router entfernt das Präfix aus der Location, sodass der Admin unverändert funktioniert. Wenn Sie den Admin stattdessen in eine **Route mit Pfad-Präfix** einer größeren App einbetten (z. B. `<Route path="/admin/*">`) ohne `basename`, behält der aktuelle Pfad sein `/admin`-Präfix. Teilen Sie dies dem CMS mit, damit die Auflösung URL⇄Collection das Präfix berücksichtigt — andernfalls bleiben Ansichten bei einem Ladeindikator hängen, ohne dass Daten abgerufen werden:

```tsx
<RebaseCMS collections={collections} basePath="/admin" />
```

Setzen Sie **entweder** den Router-`basename` **oder** `RebaseCMS basePath` — nicht beides, da das Präfix sonst doppelt angewendet wird.
:::

### Produkt-App + Admin in einem Deployment

Der häufige Grund, den Admin nach `/admin` zu verschieben, ist die Bereitstellung Ihrer **eigenen Produkt-App** im Root desselben Deployments. Ein einzelner Vite-Einstiegspunkt kann beide bedienen, aufgeteilt nach URL, sodass jede App per Lazy-Loading geladen wird und Besucher des Produkts niemals das Admin-Bundle herunterladen müssen:

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

Ein Router für beide Hälften: Der Admin ist auf einem Data-Router besser aufgehoben, da ungespeicherte Änderungen so die Navigation innerhalb der App stoppen können, und es gibt keinen Grund, die Produkt-App auf einem anderen Router zu betreiben.

Das Backend benötigt für dieses Muster keine Änderungen — die API bleibt unter `/api` und der SPA-Catch-All bedient `index.html` sowohl für `/` als auch für `/admin/*`.

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** — Vollständige Backend-Konfiguration
- **[Speicher-Konfiguration](/docs/backend/storage)** — S3-Einrichtung für die Produktion
