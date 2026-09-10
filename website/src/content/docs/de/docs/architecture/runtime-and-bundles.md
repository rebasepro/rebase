---
sourceHash: 236f1a01516e7d29
title: Runtime und Bundles
sidebar_label: Runtime & Bundles
description: Wie sich ein Rebase-Projekt in ein Projekt-Bundle und eine versionierte Runtime aufteilt, und warum genau diese Trennung Upgrades, Multi-Repo-Apps und Managed Hosting ermöglicht.
---

## Die zwei Hälften eines Deployments

Ein Rebase-Deployment besteht aus zwei Dingen, nicht nur einem:

- **Das Bundle** — Ihr Projekt. Kompilierte Collections, Hooks, Functions und Cron-Jobs
  sowie ein generiertes Manifest, das beschreibt, was diese benötigen.
- **Die Runtime** — die Engine. `@rebasepro/server`, bereitgestellt als veröffentlichtes
  `rebasepro/server`-Container-Image.

Sie werden separat gebaut, versioniert und ausgeliefert. Genau aus dieser Entscheidung
ergibt sich alles Weitere auf dieser Seite: Da die Engine nicht fest in Ihr
Anwendungs-Image integriert ist, kann sie unterhalb Ihres Projekts ausgetauscht werden —
für einen Sicherheits-Fix, eine Leistungsverbesserung oder ein neues Feature —,
ohne dass irgendetwas von dem, was Sie geschrieben haben, neu gebaut werden muss.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

Die Runtime, die Sie selbst hosten, ist dieselbe Runtime, die Rebase Cloud ausführt. Es gibt
keinen separaten „Platform“-Build, und nichts von der Managed-Tier-Variante bleibt jemandem
vorenthalten, der `docker compose up` ausführt.

## Ein Bundle bauen

```bash
rebase build
```

Dies generiert das Datenbankschema aus Ihren Collections neu, prüft die Typen,
kompiliert sie, löst Import-Specifier auf, damit Node die Ausgabe direkt laden kann,
und schreibt `dist-bundle/` mit folgendem Inhalt:

| Pfad | Beschreibung |
| --- | --- |
| `manifest.json` | Generiert. Der Contract, den dieses Bundle zu erfüllen beansprucht. |
| `package.json` | Generiert. Die Runtime-Abhängigkeiten Ihres Projekts. |
| `config/` | Kompilierte Collections. |
| `backend/functions/` | Kompilierte Server-Functions. |
| `backend/crons/` | Kompilierte Cron-Jobs. |
| `backend/src/schema.generated.js` | Kompiliertes Datenbankschema. |

Es lohnt sich, das Manifest zu verstehen, denn es ist genau das, was eine Runtime
validiert, bevor sie dem Start zustimmt:

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.20.0", "contract": 1 },
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

`kind` ist entweder `backend` — startet den Server plus alle statischen Apps in
`entry.static` — oder `static`, was diese Assets und sonst nichts ausliefert: keine
Datenbank, keine Authentifizierung. Ob ein Backend seine Collections im Code deklariert oder
per Introspektion aus der Live-Datenbank ermittelt, ist keine dritte Art; es hängt lediglich
davon ab, ob `entry.config` vorhanden ist.

## Ein Bundle ausführen

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` lädt das Bundle In-Process, sodass Signale und Stack-Traces Sie
direkt erreichen. Lokal verlinkt es Ihre bereits installierten Abhängigkeiten in
das Bundle, sodass keine zweite Installation erforderlich ist; ein Deployment
installiert stattdessen die `package.json` des Bundles selbst.

## Kompatibilität

Zwei Versionsnummern bestimmen, ob ein Bundle und eine Runtime zusammenarbeiten
können – und das ist bewusst nicht die Paketversion.

**`bundleFormat`** ist das Layout auf der Festplatte. Eine Runtime akzeptiert jedes
Bundle, dessen Format kleiner oder gleich ihrem eigenen ist, und verweigert ein
neueres, anstatt es nur unvollständig zu laden. Ein älteres Bundle auf einer
neueren Runtime muss weiterhin funktionieren — genau das ist der Sinn dieser
Trennung. Daher liest eine Runtime jedes Format, das jemals veröffentlicht wurde.
Bundles mit Format 1, die dieses Feld `mode` nannten und ein einzelnes statisches
Verzeichnis enthielten, starten weiterhin unverändert.

**`runtime.contract`** ist die Schnittstelle zwischen einem Bundle und der Engine.
Innerhalb einer Major-Version des Contracts bleibt jedes Bundle, das einmal validiert
wurde, gültig. Patches und Minor-Versionen sind Drop-in-kompatibel; ein Major-Release
ist es nicht, und eine Runtime verweigert ein Bundle aus einer anderen Major-Version,
anstatt zu starten und sich später fehlerhaft zu verhalten.

Aus diesem Grund ist das Upgrade von Rebase in einem selbst gehosteten Deployment
lediglich eine Änderung des Image-Tags:

```yaml
image: rebasepro/server:0.20.0   # a newer tag — your bundle is untouched
```

## Die Entwicklung nutzt denselben Pfad

`rebase dev` startet dieselbe Runtime über Ihrem TypeScript-Quellcode anstelle
eines kompilierten Bundles. Hot-Reloading funktioniert weiterhin, und die
Entwicklungsumgebung entspricht zuverlässig der Produktion, da beide denselben
Boot-Pfad durchlaufen, anstatt zweier Implementierungen, die voneinander abweichen.

Ein Projekt, das Funktionen benötigt, die die Standard-Runtime nicht bietet,
kann dennoch eine eigene `backend/src/index.ts` schreiben und den Server als
Bibliothek importieren. `rebase dev` erkennt dies und führt es aus. Siehe
[Custom server](/docs/backend/custom-server/) — Sie verlieren dadurch die
Standard-Runtime, nicht aber die API-Oberfläche.

## Was die Runtime aus der Umgebung liest

Die Runtime wird vollständig über Umgebungsvariablen konfiguriert, da dies der
gemeinsame Nenner aller Deployment-Ziele ist.

| Variable | Bedeutung |
| --- | --- |
| `DATABASE_URL` | Verbindungszeichenfolge für die Standarddatenbank. Erforderlich. |
| `JWT_SECRET` | Signing-Secret, mindestens 32 Zeichen lang. In der Produktion erforderlich. |
| `CORS_ORIGINS` | Kommagetrennte Origins, die die API aufrufen dürfen. In der Produktion erforderlich. |
| `PORT` | Zu bindender Port. Standardmäßig `3001` lokal, `8080` im Image. |
| `REBASE_SERVICE_KEY` | Server-zu-Server-Schlüssel, der Administratorzugriff gewährt. |
| `REBASE_METRICS` | `true`, um Prometheus-Metriken unter `/metrics` bereitzustellen. |
| `REBASE_MIGRATE_ON_BOOT` | `none` lässt das Schema unberührt; jeder andere Wert — einschließlich nicht gesetzt — führt den additiven Bereitstellungsschritt aus. Standardmäßig überall `ensure`, auch in der Produktion. |
| `REBASE_SERVE_STATIC` | Statische Assets des Bundles aus diesem Prozess bereitstellen. Standardmäßig aktiviert. |

Mehrere Datenbanken und mehrere Buckets werden konfiguriert, indem die Variable mit dem
Source-Key als Suffix versehen wird — siehe [Multiple databases and
buckets](/docs/backend/multiple-sources/).

## Endpunkte, die die Runtime immer bereitstellt

| Pfad | Zweck |
| --- | --- |
| `GET /health` | Readiness. Führt einen Datenbank-Roundtrip durch. |
| `GET /livez` | Liveness. Berührt die Datenbank bewusst *nicht*, damit ein kurzer Datenbankausfall nicht dazu führt, dass ein Orchestrator einen fehlerfreien Prozess beendet. |
| `GET /api/meta/schema-version` | Die aktuelle Schema-Version. Nicht authentifiziert — es handelt sich um einen Versionsstempel, kein Schema. |
| `GET /api/meta/contract` | Der vollständige Collection-Contract. Nur für Administratoren. |
| `GET /metrics` | Prometheus-Metriken, wenn `REBASE_METRICS=true` gesetzt ist. |

---
