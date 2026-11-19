---
sourceHash: 54382ae26efa26ea
title: Deployment
sidebar_label: Deployment
description: Bereitstellung Ihres Rebase-Projekts für die Produktion mit Docker, Cloud-Plattformen oder manuellen Setups.
---

## Was ein Deployment bereitstellt

Ein Rebase-Projekt wird als **ein einzelner Server** bereitgestellt (auf Rebase Cloud: `https://<project>.rebase.website`). Dieser Server verarbeitet:

- **`/api/*`** — die Daten-API, Authentifizierung, Realtime und Speicher
- **alles andere** — Ihr gebautes `frontend/` als statische SPA

Es gibt keinen separaten Admin-Dienst: Das Admin-Panel ist Teil eines Frontends. Wo es erscheint, hängt also davon ab, worum es sich bei Ihrem Frontend handelt und ob Sie ihm einen eigenen Hostnamen zuweisen.

| Projekttyp | Root-URL zeigt | Admin-Panel befindet sich unter |
|------------|----------------|---------------------------------|
| Standard-Gerüst (`rebase init`) | Das Admin-Panel | `/` — das Frontend **ist** der Admin |
| Benutzerdefiniertes Produkt-Frontend | Ihre App | Wo immer Sie es einbinden, üblicherweise `/admin` — siehe [Basis-URL ändern](#basis-url-ändern) |
| Admin als App auf eigenem Hostnamen | Ihre App | `https://admin.example.com/`, bereitgestellt vom selben Server — siehe [Basis-URL ändern](#basis-url-ändern) |
| Reine Backend-Projekte | Nichts (nur API) | Nicht bereitgestellt |

:::note[Erster Besuch]
Ein frisches **Produktions**-Deployment bietet keinen Bootstrap-Bildschirm, und die erste Registrierung ist ein gewöhnliches Konto. Benennen Sie stattdessen den Administrator vor dem ersten Start — siehe [Ihr erster Administrator](#ihr-erster-administrator).
:::

## Docker Compose (Empfohlen)

Das generierte Projekt enthält bereits eine funktionierende `docker-compose.yml` — **diese Datei sollte für ein scaffolded Projekt verwendet werden**, und zwar unverändert, anstatt handgeschrieben oder von woanders kopiert. `rebase init` hat ihre Secrets, das erste Admin-Konto und die festgelegte Runtime-Version ausgefüllt, und sie wird bei jedem Push durch das eigene Acceptance-Gate des Frameworks gestartet. Sie führt **zwei** Container aus: Postgres und die veröffentlichte Rebase-Runtime, in die Ihr erstelltes Bundle gemountet ist. Es muss kein Anwendungs-Image gebaut werden.

[Self-Hosting](/docs/deployment/self-hosting) behandelt dasselbe Deployment ohne ein Scaffold dahinter unter Verwendung von [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml) aus dem Rebase-Repository — sowie die beiden Dinge, die diese Datei bewusst auslässt: einen Connection-Pooler und das Ausführen von Funktionen und dem Job-Worker als eigene Prozesse.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

Führen Sie immer zuerst `rebase build` aus: Der `api`-Dienst mountet `./dist-bundle`, und ohne diesen Schritt startet der Container mit einem leeren Verzeichnis.

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

Siehe [Ihr erster Administrator](#ihr-erster-administrator) unten für die drei Zeilen zu `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION`.

Das Bundle wird schreibgeschützt gemountet. `rebase build` installiert die deklarierten Abhängigkeiten des Projekts in `dist-bundle`, es sei denn, Sie übergeben `--no-vendor`. In diesem Fall installiert die Runtime sie bei jedem Start und der Mount muss beschreibbar sein — entfernen Sie das `:ro`. Siehe [Self-hosting](/docs/deployment/self-hosting/#dependencies).

`rebase init` schreibt all dies für Sie in die Datei `.env`, einschließlich eines generierten Admin-Passworts. Jeder Wert wird mit `${VAR:?…}` deklariert; ein fehlender Wert stoppt den Stack mit einer Meldung, die ihn benennt, anstatt etwas halb Konfiguriertes zu starten — und Compose interpoliert die gesamte Datei vor der Auswahl von Diensten, sodass ein fehlender Wert auch `docker compose up -d db` stoppt.

Ändern Sie die Admin-E-Mail in Ihre eigene, melden Sie sich an und ändern Sie das Passwort. Siehe [Ihr erster Administrator](#ihr-erster-administrator).

### Das Schema

Die Runtime erstellt beim Booten fehlende Tabellen, **einschließlich derer, die `backend/schema` deklariert** — `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv ist und Row-Level Security (RLS) mit anwendet. Ein erstes `docker compose up` auf einer leeren Datenbank stellt direkt Ihre Tabellen bereit.

Was der Boot-Vorgang niemals tut, ist das Ändern bestehender Elemente: Er ändert keinen Spaltentyp, löscht nichts und bearbeitet keine Labels bestehender Enums, da ein Container-Neustart ein Schema nicht als Nebeneffekt eines Deployments umstrukturieren darf. Solche Änderungen erfolgen über die CLI, aus einem Checkout oder einem CI-Job, der auf die Produktionsdatenbank verweist:

```bash
pnpm run db:push
```

Führen Sie dies für jede Änderung aus, die nicht rein additiv ist — eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Für einen **versionierten Team-Workflow** committen Sie stattdessen Migrationsdateien mit `pnpm run db:generate` und führen `pnpm run db:migrate` als Release-Schritt aus. In beiden Fällen läuft dies über ein Projekt-Checkout, nicht innerhalb des laufenden Containers — das Runtime-Image wird ohne die CLI ausgeliefert.

## Ihr erster Administrator

**Setzen Sie `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` vor dem ersten Start.**
Jede Plattform-Anleitung auf dieser Website weist darauf hin, da dies der einzige Schritt ist, der von außen nicht wiederhergestellt werden kann.

Auf Rebase Cloud muss nichts festgelegt werden: Die Eigentümer und Administratoren der Organisation, der das Projekt gehört, öffnen dessen Admin-Panel über die Projektseite in der Konsole (**Open CMS** oder **Continue with Rebase Cloud** auf dem Anmeldebildschirm des Admins) und sind als Administratoren angemeldet. Dieser Abschnitt gilt für jeden anderen Ort, an dem Sie Rebase ausführen.

Eine frische Datenbank hat keine Benutzer, und außerhalb der Produktion lässt die Registrierungsrichtlinie die erste Anmeldung zu und befördert sie zum Administrator. Das muss so sein: Das Bootstrapping eines Administrators erfordert einen Aufrufer, der bereits angemeldet ist. Eine leere Datenbank ohne eine solche Regel wäre also eine Sackgasse. Auf einem Laptop ist die Person an der Tastatur der Betreiber, was dort genau richtig ist.

Auf einem Host mit öffentlichem Namen ist es genau falsch. Die ausgelieferten Artefakte richten DNS und TLS ein, bevor der Betreiber überhaupt etwas eingegeben hat, sodass das Zeitfenster von der ersten Sekunde an für das Internet offen steht — und wer auch immer das Registrierungsformular zuerst erreicht, besitzt das Deployment.

Unter `NODE_ENV=production` ist dieses Fenster daher geschlossen. Eine leere Benutzertabelle verweigert die Bootstrap-Registrierung mit `SETUP_REQUIRED`, ein über die offene Registrierung erstelltes Konto ist ein normales Konto, `GET /api/auth/config` gibt niemals `needsSetup` zurück und `POST /api/admin/bootstrap` verweigert den Dienst.

`rebase dev` liest dieselbe `.env`-Datei und ignoriert beide Variablen bewusst, worauf es beim Start hinweist: Lokal ist die erste Registrierung weiterhin der Zugangsweg. Die Werte, die `rebase init` geschrieben hat, gehören zum Produktionsstart. Ein Seeding auf beiden Seiten würde das Fenster schließen, bevor der Entwickler die App geöffnet hat, was im ersten Schritt des Quickstarts zu einem rollenlosen Konto führen würde.

Das lässt zwei Wege offen, von denen keiner ein Wettlauf ist:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

Die Runtime erstellt dieses Konto einmalig, solange die Benutzertabelle leer ist, und tut dies bei jedem weiteren Start nicht mehr. Alternativ weisen Sie die Rolle mit dem Service-Key einem bestehenden Benutzer zu, falls Sie Konten außerhalb des Systems bereitstellen.

Zwei Regeln setzt die Runtime beim Booten durch, die beide zu einem unbrauchbaren Konto führen, wenn Sie sie falsch handhaben:

- Das Passwort muss **mindestens 12 Zeichen** lang sein, andernfalls wird es abgelehnt und kein Konto erstellt.
- Die Adresse muss eine sein, die `POST /api/auth/login` akzeptiert — der Body wird mit `z.string().email()` geparst. Eine Domain ohne Punkt (`admin@localhost`) wird zwar geseedet, antwortet dann aber bei jeder Anmeldung mit 400. Der Boot-Prozess verweigert auch diese Adresse.

Setzen Sie entweder beide oder keine: Eine halbe Anmeldeinformation ist ein Tippfehler, und das daraus resultierende Deployment — Selbstregistrierung aus, kein Admin — erfordert einen `psql`-Prompt zur Wiederherstellung. Der Boot-Vorgang warnt, wenn die Tabelle in der Produktion leer ist und kein Admin benannt wurde.

Melden Sie sich an und ändern Sie das Passwort. Es liegt im Klartext an dem Ort, an dem Sie Ihre Umgebungsvariablen hinterlegt haben.

## Checkliste für die Produktion

Stellen Sie vor dem Deployment in die Produktion Folgendes sicher:

| Element | Details |
|---------|---------|
| **Erster Administrator** | Setzen Sie `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` **vor dem ersten Start** sowie `DISABLE_SELF_REGISTRATION=true`. In der Produktion wird das erste registrierte Konto nicht befördert — siehe [Ihr erster Administrator](#ihr-erster-administrator). |
| **NODE_ENV** | `NODE_ENV=production`. Dies schließt das Bootstrap-Fenster, verweigert lokalen Dateispeicher, erfordert `CORS_ORIGINS` und schaltet die OpenAPI-Dokumentation ab. Ein Deployment, das auf dem Standardwert belassen wird, läuft im Entwicklungsmodus. |
| **Datenbankschema** | Der Boot-Vorgang erstellt Ihre deklarierten Tabellen und deren RLS additiv. Führen Sie `pnpm run db:push` (oder `pnpm run db:migrate`) für alle Änderungen aus, die nicht rein additiv sind. |
| **JWT_SECRET** | Verwenden Sie eine kryptografisch starke Zufallszeichenkette (≥ 32 Zeichen). Niemals über Umgebungen hinweg wiederverwenden. |
| **DATABASE_URL** | Verwenden Sie eine verwaltete Postgres-Instanz (Neon, Supabase, RDS) mit aktiviertem TLS. |
| **CORS_ORIGINS** | Immer erforderlich, nicht nur wenn das Frontend auf einer anderen Domain liegt. Die Runtime verweigert den Start in der Produktion ohne `CORS_ORIGINS` oder `FRONTEND_URL`, da eine API, die ihre erlaubten Origins errät, letztendlich die falsche erlaubt. |
| **Zugriffskontrolle für Speicher** | Ein konfigurierter Bucket **verweigert den Start in der Produktion** ohne ein Zugriffskontrollmodell. Speicher unterliegt nicht der Row-Level Security und seine Schlüssel teilen sich einen flachen Namensraum. Eine Standardeinstellung, die alles erlaubt, ermöglicht jedem angemeldeten Benutzer das Auflisten (`GET /storage/list?prefix=`) und anschließende Lesen, Überschreiben oder Löschen der Dateien jedes anderen Benutzers. Erfüllen Sie dies mit einem `storageAuthorize`-Hook oder `storagePolicies` (das Gerüst liefert einen Hook in `backend/storage.ts`) oder deklarieren Sie die Absicht mit `STORAGE_PUBLIC_READ` für ein echtes öffentliches CDN oder `STORAGE_ALLOW_ANY_AUTHENTICATED` für eine Single-Tenant-App, bei der jedem Konto für jede Datei vertraut wird. |
| **Speicher-Backend** | `STORAGE_TYPE=local` wird in der Produktion **verworfen**, und Uploads antworten mit `501 STORAGE_NOT_CONFIGURED` — das Dateisystem des Containers wird beim nächsten Neustart zerstört, sodass ein lokales Backend zu stillem Datenverlust führt. Verwenden Sie `s3` oder `gcs`, oder setzen Sie `FORCE_LOCAL_STORAGE=true`, wenn der Pfad wirklich ein persistentes Volume ist. |
| **MFA_ENCRYPTION_KEY** | Setzen Sie diesen (32+ Zufallszeichen), wenn Sie TOTP verwenden. Nicht gesetzt werden gespeicherte Secrets mit `JWT_SECRET` verschlüsselt — eine Rotation meldet also alle Benutzer ab *und* macht jeden registrierten Authenticator unentschlüsselbar. |
| **HTTPS** | Terminieren Sie TLS an Ihrem Reverse-Proxy (nginx, Cloudflare, Load Balancer). |
| **Öffentliches Lesen erfordert weiterhin einen Aufrufer** | `access: "public"` erweitert, welche *Zeilen* ein Aufrufer sieht, nicht wer aufrufen darf: Eine anonyme Anfrage an `/api/data/*` antwortet mit 401, solange `AUTH_REQUIRE` aktiviert ist. Setzen Sie `AUTH_REQUIRE=false` für eine öffentliche Website, die ihr eigenes Backend liest, und überlassen Sie die Entscheidung allein RLS. Es handelt sich um eine Umgebungsvariable, daher wird eine lokale `.env`, die sie setzt, **nicht** mit Ihrem Deployment übertragen. |

## Native Module auf der verwalteten Runtime

Die verwaltete Runtime von Rebase Cloud führt Ihr Bundle innerhalb eines gemeinsam genutzten Images aus. Sie verfügt über keinen Compiler und keine Möglichkeit, ein **natives Modul** zu laden — also alles, was ein vorgefertigtes `.node`-Binary ausliefert. Das mit Abstand häufigste ist `sharp`, welches gleichzeitig die naheliegende Abhängigkeit für alles ist, was Bilder bereitstellt.

`rebase cloud deploy` verweigert dies vor dem Upload statt danach:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Drei Lösungswege, in der Reihenfolge ihrer üblichen Eignung:

1. **Verschieben Sie die Arbeit in die Build-Zeit.** Ändern Sie die Größe und kodieren Sie Bilder in Ihrem Build-Schritt neu und stellen Sie die Ergebnisse bereit. Im Request-Pfad läuft nichts Natives.
2. **Verwenden Sie einen Dienst.** Ein Bild-CDN oder eine Transformations-API erledigt dieselbe Arbeit hinter einer URL.
3. **Führen Sie Ihren eigenen Container aus.** Ein selbst gehostetes Deployment (Docker, Kubernetes, jede der [Plattform-Anleitungen](/docs/deployment/self-hosting)) ist Ihr eigenes Image und kann daher alles enthalten, was Sie möchten.

Funktionen, die lediglich Node statt eines nativen Binaries benötigen, sind in Ordnung — das Deployment meldet diese separat (`1 of 3 function(s) depend on Node`) und führt sie aus. [Managed backend runtime](/docs/deployment/managed-runtime/) deckt den Rest dessen ab, was die verwaltete Runtime erlaubt: Binärdateien, Arbeitsspeicher, Timeouts, das Dateisystem, Secrets, Speicher und ausgehenden Netzwerkverkehr.

## Bereitstellung des Frontends

In der Produktion kann das Backend das Frontend als statische SPA bereitstellen:

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

Auf diese Weise müssen Sie nur einen Server bereitstellen, der sowohl die SPA als auch die API bedient.

## Plattform-Deployment-Anleitungen

Detaillierte Schritt-für-Schritt-Anleitungen für jede Plattform:

| Plattform | Typ | Anleitung |
|-----------|-----|-----------|
| **AWS** | App Runner / ECS + RDS | [Auf AWS bereitstellen →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Auf GCP bereitstellen →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Auf Azure bereitstellen →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Auf Hetzner bereitstellen →](/docs/deployment/hetzner) |
| **Scaleway** | Serverless Containers | [Auf Scaleway bereitstellen →](/docs/deployment/scaleway) |
| **Railway** | PaaS (automatische Dockerfile-Erkennung) | [Auf Railway bereitstellen →](/docs/deployment/railway) |
| **Fly.io** | Container-Runtime | [Auf Fly.io bereitstellen →](/docs/deployment/flyio) |
| **InstaPods** | Node + PostgreSQL in einem Pod, ohne Docker | [Auf InstaPods bereitstellen →](/docs/deployment/instapods) |
| **Hostman** | App-Plattform + Managed PostgreSQL oder ein VPS | [Auf Hostman bereitstellen →](/docs/deployment/hostman) |

:::caution
Cloud Run und andere serverlose Plattformen sind zustandslos (stateless). Verwenden Sie **S3-Speicher** anstelle des lokalen Dateisystems für Datei-Uploads und setzen Sie `--min-instances 1`, wenn Sie Rebase-Realtime-Funktionen verwenden (WebSocket-Verbindungen werden beendet, wenn Instanzen herunterskalieren).
:::

## Basis-URL ändern

Wenn Sie möchten, dass der Admin unter einem Unterpfad (z. B. `/admin`) läuft, ändern Sie den `path` der App in `rebase.json` und entsprechend deren `cms`:

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

`cms` bezeichnet den Ort des CMS, auf den Rebase Cloud verlinkt, und muss innerhalb des `path` der App liegen. Das Gerüst setzt beide auf `/`, sodass das Verschieben von `path` allein verweigert wird — das CMS läge sonst bei `/`, außerhalb einer App, die nun bei `/admin` beginnt.

Um dem Admin einen eigenen Hostnamen anstelle eines Unterpfads zu geben, machen Sie `path` zu einer vollständigen URL — `"path": "https://admin.example.com"` — und belassen `cms` bei `"/"`. Der Admin antwortet dann nur auf diesem Hostnamen und nicht auf der Adresse des Projekts selbst, sodass er unerreichbar ist, bis das DNS des Hostnamens verifiziert ist. Die API verbleibt auf diesem Hostnamen ebenfalls unter `/api`. Siehe [Eine App auf eigenem Hostnamen](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname) dafür, wie Anfragen abgeglichen werden und was ein Rebase Cloud Deployment mit dem Hostnamen tut.

`rebase build` übergibt `path` als `base` an Vite (über `REBASE_APP_BASE`), Vite gibt ihn als `import.meta.env.BASE_URL` zurück, und das `main.tsx` des Gerüsts übergibt ihn bereits an den Router — so stimmen Assets, Routen und Server überein, ohne dass das Präfix dreimal manuell angegeben werden muss:

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

Belassen Sie den Admin auf einem **Data Router** — `createBrowserRouter` mit `<RouterProvider>`, wie es das Scaffold vorgibt. Darunter stoppt ein Datensatz mit ungespeicherten Änderungen auch die Navigation innerhalb der App (ein Link in der Seitenleiste, die Zurück-Schaltfläche des Browsers) und fragt zuerst über `useBlocker` nach, was nur ein Data Router bietet.

Der Admin läuft auch unter einem einfachen `<BrowserRouter>`. Dort greift der Schutz vor ungespeicherten Änderungen auf die browserinterne Aufforderung zum Verlassen der Seite zurück, was das Neuladen, das Schließen des Tabs oder das Eintippen einer URL abdeckt; die Navigation innerhalb der App wird ohne Nachfrage fortgesetzt.

**Backend** — wenn Sie auch die API verschieben, aktualisieren Sie deren Basispfad:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Einbinden ohne ein Router-`basename`]
Der obige `basename`-Ansatz ist der empfohlene — react-router entfernt das Präfix aus der Location, sodass der Admin unverändert funktioniert. Wenn Sie den Admin stattdessen innerhalb einer **pfad-präfixierten Route** einer größeren App einbetten (z. B. `<Route path="/admin/*">`) ohne `basename`, behält der aktuelle Pfad sein `/admin`-Präfix. Teilen Sie dies dem CMS mit, damit die Auflösung URL⇄Tabelle das Präfix berücksichtigt — andernfalls bleiben Ansichten auf einem Ladeindikator ohne Datenabruf hängen:

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} basePath="/admin" />
```

Setzen Sie **entweder** das Router-`basename` **oder** `RebaseCMS basePath` — nicht beides, da das Präfix sonst doppelt angewendet wird.
:::

### Produkt-App + Admin in einem Deployment

Der häufigste Grund, den Admin nach `/admin` zu verschieben, ist die Bereitstellung Ihrer **eigenen Produkt-App** im Root desselben Deployments. Ein einzelner Vite-Einstiegspunkt kann beide bedienen, aufgeteilt nach URL, sodass jede App per Lazy Loading geladen wird und Besucher des Produkts niemals das Admin-Bundle herunterladen:

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

Ein Router für beide Hälften: Der Admin ist auf einem Data Router besser aufgehoben, wodurch ungespeicherte Änderungen die App-interne Navigation stoppen können, und es gibt keinen Grund, die Produkt-App auf einem anderen laufen zu lassen.

Das Backend benötigt für dieses Muster keine Änderungen — die API bleibt bei `/api` und der SPA-Catch-All liefert `index.html` sowohl für `/` als auch für `/admin/*` aus.

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** — Vollständige Backend-Konfiguration
- **[Speicherkonfiguration](/docs/backend/storage)** — S3-Einrichtung für die Produktion
