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
    image: pgvector/pgvector:pg18
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

## Ihr erster Administrator

<span class="since-badge" data-since="0.18">Since 0.18</span>

**Setzen Sie `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` vor dem ersten Start.** Dies ist der eine Schritt, für den es von außen keine Reparatur gibt.

Eine frische Datenbank hat keine Benutzer, und außerhalb der Produktion lässt die Registrierungsrichtlinie die erste Anmeldung zu und macht sie zum Administrator. Das muss so sein: Um einen Administrator zu ernennen, braucht es einen bereits angemeldeten Aufrufer — eine leere Datenbank ohne diese Regel ist eine Sackgasse. Auf einem Laptop ist die Person an der Tastatur der Betreiber, und genau das ist richtig so.

Auf einem Host mit öffentlichem Namen ist es genau falsch. Die ausgelieferten Artefakte bringen DNS und TLS hoch, bevor der Betreiber irgendetwas getippt hat — das Fenster steht also ab der ersten Sekunde im Internet offen, und wer das Registrierungsformular zuerst erreicht, besitzt die Bereitstellung.

Unter `NODE_ENV=production` ist dieses Fenster daher geschlossen. Eine leere Benutzertabelle weist die Bootstrap-Registrierung mit `SETUP_REQUIRED` ab, ein über offene Registrierung angelegtes Konto ist ein gewöhnliches Konto, `GET /api/auth/config` meldet nie `needsSetup`, und `POST /api/admin/bootstrap` verweigert. In 0.17.3 und früher war das Fenster auch in der Produktion offen — aktualisieren Sie, bevor Sie eine frische Bereitstellung öffentlich machen.

`rebase dev` liest dieselbe `.env`, ignoriert beide Variablen aber bewusst und sagt es beim Start: lokal bleibt die erste Registrierung der Weg hinein. Die Werte, die `rebase init` geschrieben hat, gehören dem Produktionsstart.

Damit bleiben zwei Wege hinein, von denen keiner ein Wettlauf ist:

```bash
REBASE_ADMIN_EMAIL=sie@example.com
REBASE_ADMIN_PASSWORD=<mindestens 12 Zeichen>
DISABLE_SELF_REGISTRATION=true
```

Die Laufzeitumgebung legt dieses Konto einmal an, solange die Benutzertabelle leer ist, und tut bei jedem weiteren Start nichts. Oder weisen Sie einem bestehenden Benutzer die Rolle mit dem Service-Key zu, wenn Sie Konten außerhalb der Anwendung bereitstellen.

Zwei Regeln erzwingt die Laufzeitumgebung beim Start, und beide erzeugen sonst ein Konto, das niemand benutzen kann:

- Das Passwort muss **mindestens 12 Zeichen** haben, sonst wird es abgelehnt und kein Konto angelegt.
- Die Adresse muss eine sein, die `POST /api/auth/login` akzeptiert — die Route prüft ihren Body mit `z.string().email()`, sodass eine Domain ohne Punkt (`admin@localhost`) sauber angelegt wird und danach bei jeder Anmeldung mit 400 antwortet. Auch diese Adresse verweigert der Start.

Setzen Sie beide oder keine: eine halbe Zugangsdatenangabe ist ein Tippfehler, und die daraus entstehende Bereitstellung — Selbstregistrierung aus, kein Administrator — lässt sich nur an einer `psql`-Konsole retten. Der Start warnt, wenn die Tabelle in der Produktion leer ist und kein Administrator benannt wurde.

Melden Sie sich an und ändern Sie das Passwort. Es liegt im Klartext dort, wo Sie Ihre Umgebungsvariablen abgelegt haben.

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
| **Erster Administrator** | Setzen Sie `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` **vor dem ersten Start**, dazu `DISABLE_SELF_REGISTRATION=true`. In der Produktion wird das erste registrierte Konto nicht befördert — siehe [Ihr erster Administrator](#ihr-erster-administrator). |

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
