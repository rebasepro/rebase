---
sourceHash: 67566dbd11f6e659
title: Runtime und Bundles
sidebar_label: Runtime & Bundles
description: Wie ein Rebase-Projekt in ein Projekt-Bundle und eine versionierte Runtime aufgeteilt wird und warum genau diese Trennung Upgrades, Multi-Repo-Apps und Managed Hosting ermöglicht.
---

## Die zwei Hälften eines Deployments

Ein Rebase-Deployment besteht aus zwei Dingen, nicht nur einem:

- **Das Bundle** — Ihr Projekt. Kompilierte Collections, Hooks, Functions und Cron-Jobs sowie ein generiertes Manifest, das beschreibt, was diese benötigen.
- **Die Runtime** — die Engine. `@rebasepro/server`, ausgeliefert als das veröffentlichte `rebasepro/server`-Container-Image.

Sie werden separat gebaut, versioniert und ausgeliefert. Genau aus dieser Entscheidung ergibt sich alles Weitere auf dieser Seite: Da die Engine nicht fest in Ihr Anwendungs-Image integriert ist, kann sie unterhalb Ihres Projekts ausgetauscht werden – für einen Sicherheitsfix, eine Leistungsverbesserung oder ein neues Feature –, ohne dass irgendetwas von dem, was Sie geschrieben haben, neu gebaut werden muss.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

Die Runtime, die Sie selbst hosten, ist dieselbe Runtime, die Rebase Cloud ausführt. Es gibt keinen separaten „Plattform“-Build, und nichts am Managed-Tier ist für jemanden unerreichbar, der `docker compose up` ausführt.

## Ein Bundle bauen

```bash
rebase build
```

Dies generiert das Datenbankschema aus Ihren Collections neu, prüft die Typen, kompiliert sie, löst Import-Specifier auf, damit Node die Ausgabe direkt laden kann, und schreibt `dist-bundle/` mit folgendem Inhalt:

| Pfad | Beschreibung |
| --- | --- |
| `manifest.json` | Generiert. Der Contract, den dieses Bundle zu erfüllen vorgibt. |
| `package.json` | Generiert. Die Runtime-Abhängigkeiten Ihres Projekts. |
| `config/` | Kompilierte Collections. |
| `backend/functions/` | Kompilierte Server-Functions. |
| `backend/crons/` | Kompilierte Cron-Jobs. |
| `backend/src/schema.generated.js` | Kompiliertes Datenbankschema. |

Es lohnt sich, das Manifest zu verstehen, da die Runtime genau dieses validiert, bevor sie dem Starten zustimmt:

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.21.1", "contract": 1 },
  "schemaVersion": "v1:c5d97d0f96b7f87a",
  "kind": "backend",
  "entry": {
    "config": "config",
    "functions": "backend/functions",
    "static": [{ "path": "/", "dir": "static/admin", "spa": true }]
  },
  "hooks": { "native": false },
  "deps": { "declared": { "zod": "^4.4.3" } }
}
```

`kind` ist entweder `backend` – startet den Server sowie alle statischen Apps in `entry.static` – oder `static`, was diese Assets und sonst nichts ausliefert: keine Datenbank, keine Authentifizierung. Ob ein Backend seine Collections im Code deklariert oder per Introspektion aus der Live-Datenbank ermittelt, ist keine dritte Art; es hängt schlicht davon ab, ob `entry.config` vorhanden ist.

## Ein Bundle ausführen

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` lädt das Bundle in-process, sodass Signale und Stacktraces Sie direkt erreichen. Lokal verlinkt es Ihre bereits installierten Abhängigkeiten in das Bundle, sodass keine zweite Installation nötig ist; ein Deployment installiert stattdessen die bundlespezifische `package.json`.

## Kompatibilität

Zwei Versionsnummern bestimmen, ob ein Bundle und eine Runtime zusammenarbeiten können, und dabei handelt es sich bewusst nicht um die Paketversion.

**`bundleFormat`** ist das On-Disk-Layout. Eine Runtime akzeptiert jedes Bundle, dessen Format kleiner oder gleich ihrem eigenen ist, und verweigert ein neueres, anstatt es unvollständig zu laden. Ein älteres Bundle auf einer neueren Runtime muss weiterhin funktionieren – das ist der eigentliche Sinn dieser Trennung. Daher liest eine Runtime jedes Format, das jemals ausgeliefert wurde. Format-1-Bundles, die dieses Feld `mode` nannten und ein einzelnes statisches Verzeichnis enthielten, starten weiterhin unverändert.

**`runtime.contract`** ist die Schnittstelle zwischen einem Bundle und der Engine. Innerhalb einer Major-Version des Contracts bleibt jedes zuvor validierte Bundle weiterhin gültig. Patches und Minor-Versionen sind Drop-in-kompatibel; ein Major-Release ist es nicht, und eine Runtime verweigert ein Bundle einer anderen Major-Version, anstatt zu starten und sich später fehlerhaft zu verhalten.

Deshalb ist das Upgrade von Rebase in einem selbst gehosteten Deployment lediglich eine Änderung des Tags:

```yaml
image: rebasepro/server:0.21.1   # a newer tag — your bundle is untouched
```

## Die Entwicklung nutzt denselben Pfad

`rebase dev` startet dieselbe Runtime direkt über Ihrem TypeScript-Quellcode anstelle eines kompilierten Bundles. Hot-Reloading funktioniert weiterhin, und die Entwicklung spiegelt die Produktion exakt wider, da beide denselben Boot-Pfad durchlaufen, statt zwei Implementierungen, die auseinanderdriften könnten.

Ein Projekt, das etwas benötigt, was die Standard-Runtime nicht bietet, kann dennoch eine eigene `backend/src/index.ts` schreiben und den Server als Bibliothek importieren. `rebase dev` erkennt und führt dies aus. Siehe [Custom server](/docs/backend/custom-server/) – Sie verlieren dabei die Standard-Runtime, nicht jedoch die API-Oberfläche.

## Was die Runtime aus der Umgebung liest

Die Runtime wird vollständig über Umgebungsvariablen konfiguriert, da dies der gemeinsame Nenner aller Deployment-Ziele ist.

| Variable | Bedeutung |
| --- | --- |
| `DATABASE_URL` | Connection-String für die Standarddatenbank. Erforderlich. |
| `JWT_SECRET` | Signiergeheimnis (Secret), mindestens 32 Zeichen. In Produktion erforderlich. |
| `CORS_ORIGINS` | Kommagetrennte Origins, die die API aufrufen dürfen. In Produktion erforderlich. |
| `PORT` | Zu bindender Port. Standardmäßig lokal `3001`, im Image `8080`. |
| `REBASE_SERVICE_KEY` | Server-to-Server-Schlüssel, der Administratorzugriff gewährt. |
| `REBASE_METRICS` | `true`, um Prometheus-Metriken unter `/metrics` bereitzustellen. |
| `REBASE_MIGRATE_ON_BOOT` | `none` belässt das Schema unverändert; jeder andere Wert – einschließlich nicht gesetzt – führt den additiven Bereitstellungsschritt aus. Standardmäßig überall `ensure`, auch in Produktion. |
| `REBASE_SERVE_STATIC` | Statische Assets des Bundles über diesen Prozess ausliefern. Standardmäßig aktiviert. |

Mehrere Datenbanken und Buckets werden konfiguriert, indem der Source-Key als Suffix an die Variable angehängt wird – siehe [Mehrere Datenbanken und Buckets](/docs/backend/multiple-sources/).

## Endpunkte, die die Runtime immer bereitstellt

| Pfad | Zweck |
| --- | --- |
| `GET /health` | Readiness (Bereitschaft). Führt einen Round-Trip zur Datenbank durch. |
| `GET /livez` | Liveness (Lebendigkeit). Berührt bewusst *nicht* die Datenbank, damit ein kurzer Datenbankaussetzer den Orchestrator nicht dazu veranlasst, einen gesunden Prozess zu beenden. |
| `GET /api/meta/schema-version` | Die aktuelle Schema-Version. Nicht authentifiziert – es handelt sich um einen Versionsstempel, nicht um ein Schema. |
| `GET /api/meta/contract` | Der vollständige Collection-Contract. Nur für Administratoren. |
| `GET /metrics` | Prometheus-Metriken, wenn `REBASE_METRICS=true`. |
