---
sourceHash: 8186aa37929028e4
title: Apps und Repositories
sidebar_label: Apps & Repositories
description: Ein Projekt besteht aus einem Backend und den Apps, die damit kommunizieren, welche jeweils in ihrem eigenen Repository liegen können.
---

## Projekte und Apps

Ein **Projekt** ist das Backend: die Datenbank, Auth, Storage, Realtime und
Funktionen. Eine **App** ist etwas, das damit kommuniziert.

| Typ | Beschreibung |
| --- | --- |
| `backend` | Die Collections, Hooks und Funktionen, die die API definieren. Genau eine pro Projekt. |
| `static` | Ein gebautes Client-Bundle – eine SPA oder statische Website, ausgeliefert unter einem eigenen Pfad oder auf einem eigenen Hostnamen. |

Das ist die gesamte Liste. Das Admin-Panel ist eine `static`-App wie jede andere: Es
wird in Ihrem Repository auf Basis Ihrer Collections gebaut, weshalb benutzerdefinierte
Felder und benutzerdefinierte Ansichten ab dem ersten Tag darin funktionieren.

Wer den Serverprozess besitzt, ist eine Eigenschaft des Backends, kein separater
App-Typ:

| `runtime` | Bedeutung |
| --- | --- |
| `managed` | Das Runtime-Image der Plattform führt Ihr Bundle aus. Sie stellen Collections, Funktionen, Crons und Schema bereit. |
| `custom` | Sie stellen den Server bereit: Ihr eigenes Dockerfile und Ihren eigenen Entrypoint. `rebase eject` richtet dies ein. |

Dies ist unabhängig davon, *wo* es läuft. Beide laufen auf Rebase Cloud und beide
unterstützen Self-Hosting – das Ziel liegt in `.rebase/cloud.json`, nicht im Manifest.

Der entscheidende Punkt ist, wer die Liste *besitzt*. Ein Repository deklariert nur
die Apps, die es enthält; das Projekt besitzt die Menge der existierenden Apps. Zwei
Repositories müssen nie voneinander wissen – sie müssen nur das Projekt kennen. Das
macht ein separates Frontend-Repository oder eine mobile App ganz ohne Repository-Beziehung
zu einem Regelfall statt zu einem Sonderfall.

## `rebase.json`

Das Manifest deklariert die Topologie und sonst nichts. Schema, Sicherheitsregeln, Hooks
und Funktionen verbleiben in TypeScript, wo ein Typsystem sie überprüfen kann.

```jsonc
{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "site": {
      "type": "static",
      "root": "frontend",
      "build": "npm run build --workspace frontend",
      "output": "frontend/dist",
      "path": "/"
    },
    "admin": {
      "type": "static",
      "root": "admin",
      "build": "npm run build --workspace admin",
      "output": "admin/dist",
      "path": "/admin",
      "cms": "/admin"
    }
  }
}
```

Ein einziger Prozess liefert alles aus: die API unter `/api`, die Website unter `/`
und das Admin-Panel unter `/admin`. Das ist der Ansatz für Self-Hosting und ein absolut
solider kleiner Tier auf Rebase Cloud.

## Festlegen, wo sich das CMS befindet

`cms` ist der URL-Pfad, unter dem eine App `<RebaseCMS>` mountet. Es ist optional,
es ist das einzige Feld hier, das beschreibt, was sich *innerhalb* einer App befindet,
anstatt wo die App liegt, und es existiert, weil nichts anderes dies herausfinden kann.

Das CMS ist eine React-Komponente in Ihrem eigenen Frontend, seine Adresse ist also
eine clientseitige Route. Es ist keine Server-Route, keine Datei im Build und nicht von
jedem anderen nicht übereinstimmenden Pfad unter einer SPA zu unterscheiden – eine Anfrage
an `/admin` erhält dasselbe `index.html` wie eine Anfrage an `/anything-else`. Weder
ein Deployment noch ein laufender Server noch beliebig viele Analysen können also erkennen,
wo sich Ihr Admin-Panel befindet. Wenn Sie es nicht explizit angeben, weiß es niemand.

Wer diese Information hat, nutzt sie:

- **Rebase Cloud** platziert einen *Open CMS*-Link im Projekt-Header und führt die
  Adresse in der Projektübersicht auf – auf dem eigenen Hostnamen der App, wenn
  sie einen hat. Ohne `cms` kann die Konsole nur den
  Projekt-Host anbieten – wodurch das CMS nur erreicht wird, wenn es zufällig im
  Root-Verzeichnis liegt.
- **`rebase dev`** gibt die CMS-URL im Start-Banner aus, wenn es sich nicht
  einfach um die Startseite des Frontends handelt.
- **`rebase apps list`** zeigt sie neben der App an, die sie bereitstellt.

Drei Varianten, und alle sind üblich. <span class="since-badge" data-since="0.24">Seit 0.24</span> für die dritte: Unter 0.23
kann der `path` einer App keine URL sein, sodass das CMS den Hostnamen des Projekts teilt.

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }

// The CMS is an app of its own, on a hostname of its own — see the next section.
"admin": { "type": "static", "root": "admin", "output": "admin/dist", "path": "https://admin.example.com", "cms": "/" }
```

Der Wert ist der Pfad, den Sie nach dem Hostnamen eingeben würden, kein relativer
Pfad zu `path`, und er muss innerhalb der deklarierenden App liegen – der
SPA-Fallback dieser App liefert die Antwort. Er ist immer ein Pfad, auch wenn der
`path` der App eine URL ist: Das CMS liegt dann unter diesem Pfad auf dem Hostnamen
der App, `"cms": "/"` oben bedeutet also `https://admin.example.com/`. Ein Projekt
hat ein CMS; ein zweites zu deklarieren ist ein Fehler und kein
Münzwurf darüber, worauf die Konsole verlinkt.

`path` ist sowohl ein Input zur **Build-Zeit** als auch zur Auslieferung. Eine unter
`/admin` gemountete App muss für `/admin` *gebaut* werden, andernfalls lädt zwar die
`index.html`, aber jedes Asset liefert einen 404-Fehler – eine weiße Seite ohne sichtbaren
Fehler. `rebase build` übergibt den Wert als `REBASE_APP_BASE`, was Ihr Bundler als
seinen Basis-Pfad liest:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

und weigert sich, einen Build auszuliefern, der diesen ignoriert hat.

Ein bestehendes Projekt benötigt dies nicht zwingend. Das CLI leitet dasselbe Layout
aus der Verzeichnisstruktur ab, und `rebase apps init` schreibt es fest, wenn Sie es
explizit wünschen:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

## Eine App auf einem eigenen Hostnamen

`path` kann auch eine vollständige `https://`-URL sein, was der App einen
eigenen Hostnamen gibt:

```jsonc
{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "web": {
      "type": "static",
      "root": "frontend",
      "build": "npm run build --workspace frontend",
      "output": "frontend/dist",
      "path": "/"
    },
    "admin": {
      "type": "static",
      "root": "admin",
      "build": "npm run build --workspace admin",
      "output": "admin/dist",
      "path": "https://admin.example.com",
      "cms": "/"
    }
  }
}
```

`https://admin.example.com` liefert `admin` aus. Jeder andere Hostname, auf dem
das Projekt antwortet – `example.com` oder die eigene Adresse des Projekts auf
Rebase Cloud –, liefert `web` aus, und `admin` ist dort überhaupt nicht
erreichbar. Es bleibt ein einziger Prozess und ein einziges Deployment; der
Hostname entscheidet nur, welche App eine Anfrage beantwortet.

Zwei Regeln entscheiden das:

- Eine App mit Hostnamen antwortet nur auf diesem Hostnamen. Eine App ohne
  antwortet auf jedem Hostnamen.
- Von den verbleibenden Apps gewinnt die mit dem längsten Pfad, wie bisher. Bei
  gleichem Pfad gewinnt die App, die den Hostnamen nennt, gegen die, die es
  nicht tut.

Im Beispiel liegen beide Apps unter `/`, also wählt die zweite Regel auf
`admin.example.com` die App `admin`. Deklarieren Sie das Admin-Panel stattdessen
unter `"https://admin.example.com/cms"`, antwortet es auf diesem Hostnamen nur
unter `/cms`: `admin.example.com/pricing` geht an `web`. Ein Hostname grenzt
ein, wo eine App antwortet; er übergibt ihr nicht alles auf diesem Hostnamen.
Zwei Apps dürfen sich nicht zugleich Hostnamen und Pfad teilen.

Das Backend ist keine App, und ein Hostname verschiebt es nicht. `/api`,
`/health` und die anderen Pfade, die das Backend reserviert, werden auf jedem
Hostnamen beantwortet, bevor irgendeine App an die Reihe kommt – also ist
`https://admin.example.com/api` dieselbe API wie `https://example.com/api`. Eine
App, die ihren eigenen Origin aufruft – die leere `VITE_API_URL` des Scaffolds –,
braucht weder eine eigene API-URL noch eine CORS-Einstellung. Aus demselben Grund
werden diese Pfade nach einem Hostnamen genauso abgelehnt wie allein:
`https://admin.example.com/api` ist nicht gültiger als `/api`.

Alles andere an `path` gilt für den Teil nach dem Hostnamen. Die App wird
weiterhin dafür gebaut: `https://admin.example.com` wird mit `REBASE_APP_BASE`
gleich `/` gebaut, `https://admin.example.com/cms` mit `/cms`, und ein Bundler,
der das ignoriert, liefert weiterhin eine weiße Seite. `cms` ist ein Pfad auf dem
Hostnamen der App, innerhalb dieses Pfadteils. Die URL muss mit `https://`
beginnen und einen Hostnamen und einen Pfad enthalten, sonst nichts – keinen
Port, keine Query und kein Fragment. Ein bloßes `admin.example.com` wird
abgelehnt, zusammen mit der URL, die gemeint war.

Unter `rebase dev` wird nichts nach Hostnamen geroutet. Es startet die App in
`frontend/` an der Wurzel eines localhost-Ports, wie bisher, und für eine App
mit Hostnamen gibt sein Banner zusätzlich die `https://`-Adresse aus, die sie
nach dem Deployment haben wird.

`rebase start` ist anders, da es das gebaute Bundle durch dieselbe Runtime
laufen lässt wie ein Deployment — Hostname-Routing eingeschlossen. Eine App mit
Hostnamen antwortet nur auf Anfragen, deren `Host` dieser Hostname ist, sodass
`http://localhost:3001/` die App ohne einen zeigt, und ein Bundle, dessen
einzige App einen Hostnamen nennt, dort mit 404 antwortet. Um sie lokal zu
erreichen, senden Sie den Header selbst:

```bash
curl -H "Host: admin.example.com" http://localhost:3001/
```

oder zeigen Sie den Hostnamen in `/etc/hosts` auf `127.0.0.1` und öffnen Sie
`http://admin.example.com:3001/`. Es gibt absichtlich keinen Query-Parameter
und keinen Header, der das Routing überschreibt: Einer, der lokal funktionierte,
würde auch gegen ein Deployment funktionieren, und die App anhand von irgendetwas
außer dem echten `Host` auszuwählen, ist genau das, was das Routing verhindern soll.

Beim Self-Hosting trifft der Prozess dieselbe Wahl anhand des `Host`-Headers
jeder Anfrage. Den Hostnamen auf den Server zeigen zu lassen und ihm ein
Zertifikat zu geben, ist Ihre Sache, wie beim Haupt-Hostnamen des Projekts, und
ein vorgeschalteter Reverse Proxy muss den ursprünglichen `Host` durchreichen –
Caddy tut das standardmäßig, nginx braucht `proxy_set_header Host $host;`.
`X-Forwarded-Host` wird nicht gelesen, weil jeder Client einen senden kann.

### Auf Rebase Cloud

`rebase cloud deploy` registriert den Hostnamen im Projekt – dasselbe, was
`rebase cloud domains add` tut –, es gibt also keinen separaten Schritt, den man
vergessen könnte. Was danach passiert, hängt vom DNS ab:

- **Die Records existieren bereits.** Das Deployment verifiziert den Hostnamen,
  und er ist live, wenn das Deployment abgeschlossen ist.
- **Sie existieren nicht.** Das Deployment läuft trotzdem durch und gibt die
  zwei anzulegenden Records aus: einen TXT-Record, der belegt, dass der Name
  Ihnen gehört, und einen CNAME, der ihn auf das Projekt zeigen lässt (einen
  A-Record, wenn der Hostname der Apex der Domain ist).

Sobald die Records veröffentlicht sind:

```bash
rebase cloud domains verify admin.example.com
```

`rebase cloud domains list` gibt die Records erneut aus, falls sie Ihnen
abhandenkommen. Sobald die Verifizierung erfolgreich ist, stellt die Plattform
das HTTPS-Zertifikat für den Hostnamen aus; es gibt nichts hochzuladen. Bis
dahin antwortet `admin` nirgends, weil der einzige Hostname, auf dem es
antwortet, das Projekt noch nicht erreicht – der Rest des Projekts ist so oder
so live.

Die Konsole folgt der App auf ihren Hostnamen: Der *Open CMS*-Link und die
CMS-Adresse in der Projektübersicht lauten `https://admin.example.com/`, nicht
der Projekt-Host.

Ein Hostname, den bereits ein anderes Projekt hält, lässt das Deployment
fehlschlagen, bevor irgendetwas ausgerollt wird, ebenso einer unter der eigenen
Domain der Plattform. Wird die App aus `rebase.json` entfernt, bleibt der
Hostname im Projekt registriert; entfernen Sie ihn mit
`rebase cloud domains remove admin.example.com`.

### Ein Hostname gehört zu einer App, nicht zu einer Route

Ein Hostname wird einer ganzen App gegeben. Er kann nicht auf eine Route
innerhalb einer App zeigen. Wenn das CMS eine Route einer einzelnen SPA ist –
`web` unter `/` mit `"cms": "/admin"` –, liegt es unter `/admin`, auf jedem
Hostnamen, auf dem das Projekt antwortet. Gäben Sie dieser App
`https://admin.example.com`, würde die ganze SPA dorthin wandern, mit dem CMS
weiterhin unter `/admin` darin. Um dem CMS einen eigenen Hostnamen zu geben,
machen Sie es zu einer eigenen App mit eigenem Build, wie im Beispiel oben.

## Apps bauen und deployen

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

Das Backend wird zuerst gebaut, da der Build einer Client-App ein SDK verwenden kann,
das aus dessen Collections generiert wurde.

## Mehrere Repositories

Das Monorepo bleibt der Standard: Ein Repository mit einem Backend und einem Admin-Panel
ist der einfachste funktionierende Ansatz, und `rebase init` erstellt das Grundgerüst
dafür. Das Aufteilen ist der nächste Entwicklungsschritt, keine Voraussetzung.

In einem separaten Frontend-Repository benötigen Sie zwei Dinge – ein Manifest, das
deklariert, was dieses Repository beisteuert, und einen Link zum Projekt:

```jsonc
// rebase.json
{
  "rebase": "^1",
  "apps": {
    "marketing": {
      "type": "static",
      "root": ".",
      "build": "npm run build",
      "output": "dist"
    }
  }
}
```

```bash
rebase cloud link https://api.example.com   # a self-hosted project
rebase cloud link                           # or pick a Rebase Cloud project
```

Der Link wird in `.rebase/cloud.json` geschrieben und wird **nicht committet** – er
gilt pro Checkout, ähnlich wie ein Git-Remote. Das Manifest wird committet; der Link
nicht.

## Typisierte Clients ohne die Collections

Dies ist der Mechanismus, der Multi-Repo ermöglicht. Ein Repository, das keine
Collections enthält, generiert sein typisiertes SDK direkt aus dem Projekt:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

Das CLI ruft `/api/meta/contract` ab, baut die Collection-Definitionen neu auf –
einschließlich der Relationsziele, die der Typgenerator benötigt, um zu entscheiden,
ob ein Fremdschlüssel ein String oder eine Zahl ist – und gibt exakt dieselbe Ausgabe
aus, die es aus lokalen Quelldateien erzeugt hätte.

Der Contract-Endpunkt braucht den Scope `schema:read`, den ein Admin hält. Collection-Definitionen beschreiben
jede Tabelle, Spalte und Relation im Projekt, einschließlich derer, die keine
Sicherheitsregel jemals freigeben würde; das ist eine Bestandsaufnahme der Datenbank,
keine öffentliche API-Dokumentation.

## Drift erkennen

Das Aufteilen von Repositories hat einen nennenswerten Nachteil: Eine Schema-Änderung
und das Frontend, das sie verwendet, landen nicht mehr im selben Commit. Das Backend
kann eine Änderung deployen, die einen Client lahmlegt, der für die alte Struktur
gebaut wurde.

Jedes generierte SDK zeichnet das Schema auf, aus dem es stammt:

```ts
// src/rebase/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

Und jedes Projekt veröffentlicht sein aktuelles Schema ohne Authentifizierung, da
ein Versionsstempel nichts über das Schema preisgibt, für das er steht:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a"}
```

Der Vergleich der beiden in der CI macht aus einer unbemerkten Diskrepanz eine
fehlgeschlagene Prüfung. Der Stempel ändert sich, wenn sich die generierten Typen
ändern könnten – eine neue Eigenschaft, eine geänderte Relation – und ganz bewusst
*nicht*, wenn sich ein Hook, eine Sicherheitsregel oder ein Icon ändert, damit er
keinen Fehlalarm auslöst.

## Client-Konfiguration

```bash
rebase apps config web
```

Gibt aus, was ein Client benötigt, um das Projekt zu erreichen. Es gibt niemals
Secrets aus: Die API-URL und die veröffentlichbare Identität einer App sind dafür
gedacht, im Client-Bundle ausgeliefert zu werden, und alles, was dort nicht sicher
ist, gehört nicht in eine Ausgabe, die am Ende in einer committeten `.env` landet.

## Verwandte Themen

- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) – was `rebase build` erzeugt und was es startet
- [Split Processes](/docs/deployment/split-processes/) – ein Bundle als mehrere Prozesse ausführen
- [CLI Commands](/docs/cli/) – `rebase apps` und der Rest
