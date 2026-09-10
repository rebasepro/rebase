---
sourceHash: f90b94eda083f704
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
| `static` | Ein gebautes Client-Bundle – eine SPA oder statische Website, ausgeliefert unter einem eigenen Pfad. |

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
  Adresse in der Projektübersicht auf. Ohne `cms` kann die Konsole nur den
  Projekt-Host anbieten – wodurch das CMS nur erreicht wird, wenn es zufällig im
  Root-Verzeichnis liegt.
- **`rebase dev`** gibt die CMS-URL im Start-Banner aus, wenn es sich nicht
  einfach um die Startseite des Frontends handelt.
- **`rebase apps list`** zeigt sie neben der App an, die sie bereitstellt.

Zwei Varianten, und beide sind üblich:

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }
```

Der Wert ist die Adresse, die Sie eingeben würden, kein relativer Pfad zu `path`, und
er muss innerhalb der deklarierenden App liegen – der SPA-Fallback dieser App liefert
die Antwort. Ein Projekt hat ein CMS; ein zweites zu deklarieren ist ein Fehler und kein
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

Der Contract-Endpunkt ist nur für Admins zugänglich. Collection-Definitionen beschreiben
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

---
