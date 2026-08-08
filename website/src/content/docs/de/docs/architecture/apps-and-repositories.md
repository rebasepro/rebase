---
title: Apps und Repositories
sidebar_label: Apps & Repositories
description: Ein Projekt besteht aus einem Backend und den Apps, die damit kommunizieren. Diese können jeweils in einem eigenen Repository liegen.
---

## Projekte und Apps

Ein **Projekt** ist das Backend: Datenbank, Authentifizierung, Speicher, Echtzeit und Funktionen. Eine **App** ist etwas, das damit kommuniziert.

| Typ | Was es ist |
| --- | --- |
| `backend` | Die Collections, Hooks und Funktionen, die die API definieren. Genau eine pro Projekt. |
| `static` | Ein gebündeltes Client-Bundle – eine SPA oder eine statische Website, die unter ihrem eigenen Pfad bereitgestellt wird. |

Das ist bereits die vollständige Liste. Das Admin-Panel ist eine `static`-App wie jede andere auch: Es wird in Ihrem Repository auf Basis Ihrer Collections gebaut. Aus diesem Grund funktionieren benutzerdefinierte Felder und Ansichten darin von Tag eins an.

Wer den Serverprozess besitzt, ist eine Eigenschaft des Backends, kein eigener App-Typ:

| `runtime` | Was es bedeutet |
| --- | --- |
| `managed` | Das Runtime-Image der Plattform führt Ihr Bundle aus. Sie liefern Collections, Funktionen, Crons und Schema. |
| `custom` | Sie stellen den Server bereit: Ihr eigenes Dockerfile und Ihren eigenen Entrypoint. `rebase eject` richtet dies ein. |

Dies ist unabhängig davon, *wo* es läuft. Beide Optionen laufen auf der Rebase Cloud sowie als Self-Hosting – das Ziel befindet sich in `.rebase/cloud.json`, nicht im Manifest.

Der wichtige Teil ist, wer die Liste *besitzt*. Ein Repository deklariert nur die Apps, die es enthält; das Projekt besitzt die Gesamtheit aller existierenden Apps. Zwei Repositories müssen nie voneinander wissen – sie müssen nur das Projekt kennen. Das macht ein separates Frontend-Repository oder eine mobile App ohne jegliche Repository-Beziehung zu einem normalen Fall statt zu einer Ausnahme.

## `rebase.json`

Das Manifest deklariert die Topologie und sonst nichts. Schema, Sicherheitsregeln, Hooks und Funktionen verbleiben in TypeScript, wo ein Typsystem sie überprüfen kann.

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
      "path": "/admin"
    }
  }
}
```

Ein einziger Prozess stellt alles bereit: die API unter `/api`, die Website unter `/`, das Admin-Panel unter `/admin`. Das ist das Prinzip beim Self-Hosting und gleichzeitig ein hervorragender kleiner Tarif auf Rebase Cloud.

`path` ist sowohl eine Eingabe zur **Build-Zeit** als auch für die Auslieferung. Eine unter `/admin` gemountete App muss für `/admin` *gebaut* werden, da andernfalls zwar die `index.html` lädt, aber jedes Asset mit einem 404-Fehler fehlschlägt – eine weiße Seite ohne sichtbare Fehlermeldung. `rebase build` übergibt den Wert als `REBASE_APP_BASE`, was Ihr Bundler als Basis-Pfad liest:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

und verweigert die Auslieferung eines Builds, der diesen ignoriert hat.

Ein bestehendes Projekt benötigt kein Manifest. Die CLI leitet dasselbe Layout aus der Verzeichnisstruktur ab, und `rebase apps init` schreibt es auf, wenn Sie es explizit haben möchten:

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

Das Backend wird zuerst gebaut, da der Build einer Client-App ein SDK nutzen kann, das aus dessen Collections generiert wurde.

## Mehrere Repositories

Das Monorepo bleibt der Standard: Ein Repository mit einem Backend und einem Admin-Panel ist die einfachste funktionsfähige Lösung, und `rebase init` erstellt dieses Grundgerüst. Die Aufteilung in mehrere Repositories ist ein fortgeschrittener Schritt, keine Voraussetzung.

In einem separaten Frontend-Repository benötigen Sie zwei Dinge – ein Manifest, das deklariert, was dieses Repository beiträgt, und einen Link zum Projekt:

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

Der Link wird in `.rebase/cloud.json` geschrieben und wird **nicht committed** – er gilt pro Checkout, ähnlich wie ein Git-Remote. Das Manifest wird committed, der Link nicht.

## Typisierte Clients ohne die Collections

Das ist der Mechanismus, der Multi-Repo ermöglicht. Ein Repository, das keine Collections enthält, generiert sein typisiertes SDK direkt aus dem Projekt:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

Die CLI ruft `/api/meta/contract` ab, baut die Collection-Definitionen neu auf – einschließlich Relationszielen, die der Typgenerator benötigt, um zu entscheiden, ob ein Fremdschlüssel ein String oder eine Zahl ist – und gibt genau dieselbe Ausgabe aus, die sie aus lokaler Quelle erzeugt hätte.

Der Contract-Endpunkt ist nur für Admins zugänglich. Collection-Definitionen beschreiben jede Tabelle, Spalte und Relation im Projekt, einschließlich derer, die durch keine Sicherheitsregel jemals offengelegt würden; es handelt sich dabei um einen Bauplan der Datenbank, nicht um eine öffentliche API-Dokumentation.

## Abweichungen erkennen

Das Aufteilen von Repositories bringt einen nennenswerten Nachteil mit sich: Eine Schema-Änderung und das Frontend, das sie verwendet, landen nicht mehr im selben Commit. Das Backend kann eine Änderung deployen, die einen Client blockiert, der gegen die alte Struktur gebaut wurde.

Jedes generierte SDK zeichnet das Schema auf, aus dem es stammt:

```ts
// src/rebase/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

Und jedes Projekt veröffentlicht sein aktuelles Schema ohne Authentifizierung, da ein Versionsstempel nichts über das Schema verrät, für das er steht:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a"}
```

Der Vergleich der beiden in der CI verwandelt eine unbemerkte Unstimmigkeit in eine fehlgeschlagene Prüfung. Der Stempel ändert sich, wenn sich die generierten Typen ändern könnten – eine neue Eigenschaft, eine geänderte Relation – und bewusst *nicht*, wenn sich ein Hook, eine Sicherheitsregel oder ein Icon ändert, um falschen Alarm zu vermeiden.

## Client-Konfiguration

```bash
rebase apps config web
```

Gibt aus, was ein Client benötigt, um das Projekt zu erreichen. Es gibt niemals ein Secret aus: Die API-URL und die veröffentlichbare Identität einer App sind dafür gedacht, im Client-Bundle enthalten zu sein. Alles, was dort nicht sicher ist, gehört auch nicht in Ausgaben, die in einer committeten `.env` landen.

---
