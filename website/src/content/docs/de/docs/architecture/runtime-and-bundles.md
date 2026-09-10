---
sourceHash: a4b27cb5ae61a96e
title: Runtime und Bundles
sidebar_label: Runtime & Bundles
description: Wie ein Rebase-Projekt in ein Projekt-Bundle und eine versionierte Runtime aufgeteilt wird und warum diese Trennung Upgrades, Multi-Repo-Apps und Managed Hosting ermöglicht.
---

## Die zwei Hälften eines Deployments

Ein Rebase-Deployment besteht aus zwei Teilen, nicht nur einem:

- **Das Bundle** — Ihr Projekt. Kompilierte Collections, Hooks, Functions und Cron-Jobs sowie ein generiertes Manifest, das beschreibt, was diese benötigen.
- **Die Runtime** — die Engine. `@rebasepro/server`, ausgeliefert als das veröffentlichte `rebasepro/server`-Container-Image.

Sie werden separat gebaut, versioniert und ausgeliefert. Genau aus dieser Entscheidung ergibt sich alles Weitere auf dieser Seite: Da die Engine nicht fest in Ihr Anwendungs-Image integriert ist, kann sie unterhalb Ihres Projekts ausgetauscht werden – für einen Sicherheitsfix, eine Leistungsverbesserung oder ein neues Feature –, ohne dass irgendetwas von Ihrem geschriebenen Code neu gebaut werden muss.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

Die Runtime, die Sie selbst hosten, ist dieselbe Runtime, die auch in der Rebase Cloud läuft. Es gibt keinen separaten „Platform“-Build, und nichts am Managed-Angebot ist für jemanden unerreichbar, der `docker compose up` ausführt.

## Ein Bundle erstellen

```bash
rebase build
```

Dies generiert das Datenbankschema aus Ihren Collections neu, führt eine Typprüfung durch, kompiliert sie, löst Import-Spezifizierer auf, damit Node die Ausgabe direkt laden kann, und schreibt `dist-bundle/` mit folgendem Inhalt:

| Pfad | Beschreibung |
| --- | --- |
| `manifest.json` | Generiert. Der Contract, den dieses Bundle zu erfüllen beansprucht. |
| `package.json` | Generiert. Die Runtime-Abhängigkeiten Ihres Projekts. |
| `config/` | Kompilierte Collections. |
| `backend/functions/` | Kompilierte Server-Funktionen. |
| `backend/crons/` | Kompilierte Cron-Jobs. |
| `backend/src/schema.generated.js` | Kompiliertes Datenbankschema. |

Es lohnt sich, das Manifest zu verstehen, denn genau dieses validiert die Runtime, bevor sie dem Start zustimmt:

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

`kind` ist entweder `backend` – startet den Server plus alle statischen Apps in `entry.static` – oder `static`, was diese Assets und nichts anderes ausliefert: keine Datenbank, keine Authentifizierung. Ob ein Backend seine Collections im Code deklariert oder sie aus der Live-Datenbank introspektiert, ist keine dritte Art; es hängt schlicht davon ab, ob `entry.config` vorhanden ist.

## Ein Bundle ausführen

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` lädt das Bundle im selben Prozess (in-process), sodass Signale und Stack-Traces Sie direkt erreichen. Lokal verknüpft es Ihre bereits installierten Abhängigkeiten mit dem Bundle, sodass keine zweite Installation erforderlich ist; ein Deployment installiert stattdessen die eigene `package.json` des Bundles.

## Kompatibilität

Zwei Versionsnummern bestimmen, ob ein Bundle und eine Runtime zusammenarbeiten können – und dabei handelt es sich bewusst nicht um die Paketversion.

**`bundleFormat`** ist das On-Disk-Layout. Eine Runtime akzeptiert jedes Bundle, dessen Format kleiner oder gleich ihrem eigenen ist, und verweigert ein neueres, anstatt es nur unvollständig zu laden. Ein älteres Bundle auf einer neueren Runtime muss weiterhin funktionieren – das ist der eigentliche Sinn der Trennung –, daher liest eine Runtime jedes Format, das jemals ausgeliefert wurde. Format-1-Bundles, die dieses Feld `mode` nannten und ein einzelnes statisches Verzeichnis enthielten, starten nach wie vor unverändert.

**`runtime.contract`** ist die Schnittstelle zwischen einem Bundle und der Engine. Innerhalb einer Major-Version des Contracts bleibt jedes Bundle, das validiert wurde, weiterhin gültig. Patch- und Minor-Versionen sind Drop-in-kompatibel; ein Major-Release ist es nicht, und eine Runtime verweigert ein Bundle einer anderen Major-Version, anstatt zu starten und sich später fehlerhaft zu verhalten.

Aus diesem Grund ist das Upgrade von Rebase in einem selbst gehosteten Deployment lediglich eine Änderung des Image-Tags:

```yaml
image: rebasepro/server:0.20.0   # a newer tag — your bundle is untouched
```

## Die Entwicklung nutzt denselben Pfad

`rebase dev` startet dieselbe Runtime über Ihrem TypeScript-Quellcode anstelle eines kompilierten Bundles. Hot-Reloading funktioniert weiterhin, und die Entwicklung spiegelt die Produktion wider, da beide denselben Boot-Pfad durchlaufen, statt zwei Implementierungen, die voneinander abweichen könnten.

Ein Projekt, das Funktionen benötigt, die die Standard-Runtime nicht bietet, kann dennoch ein eigenes `backend/src/index.ts` schreiben und den Server als Bibliothek importieren. `rebase dev` erkennt dies und führt es aus. Siehe [Custom Server](/docs/backend/custom-server/) – Sie verlieren dabei die Standard-Runtime, nicht aber die API-Oberfläche.

## Was die Runtime aus der Umgebung liest

Die Runtime wird vollständig über Umgebungsvariablen konfiguriert, da dies der gemeinsame Nenner aller Deployment-Ziele ist.

| Variable | Bedeutung |
| --- | --- |
| `DATABASE_URL` | Connection-String für die Standarddatenbank. Erforderlich. |
| `JWT_SECRET` | Signing-Secret, mindestens 32 Zeichen. In der Produktion erforderlich. |
| `CORS_ORIGINS` | Kommagetrennte Liste von Origins, die die API aufrufen dürfen. In der Produktion erforderlich. |
| `PORT` | Zu bindender Port. Standardmäßig lokal `3001`, im Image `8080`. |
| `REBASE_SERVICE_KEY` | Server-to-Server-Schlüssel, der Administratorzugriff gewährt. |
| `REBASE_METRICS` | `true`, um Prometheus-Metriken unter `/metrics` bereitzustellen. |
| `REBASE_MIGRATE_ON_BOOT` | `none` lässt das Schema unverändert; jeder andere Wert – einschließlich nicht gesetzt – führt den additiven Bereitstellungsschritt (Provisioning) aus. Standardmäßig überall `ensure`, auch in der Produktion. |
| `REBASE_SERVE_STATIC` | Statische Assets des Bundles aus diesem Prozess ausliefern. Standardmäßig aktiviert. |

Mehrere Datenbanken und mehrere Buckets werden konfiguriert, indem der Variablenname um den Source-Key als Suffix erweitert wird – siehe [Mehrere Datenbanken und Buckets](/docs/backend/multiple-sources/).

## Endpunkte, die die Runtime immer bereitstellt

| Pfad | Zweck |
| --- | --- |
| `GET /health` | Readiness. Führt einen Datenbank-Roundtrip durch. |
| `GET /livez` | Liveness. Berührt die Datenbank bewusst *nicht*, damit ein kurzer Datenbankaussetzer einen Orchestrator nicht dazu veranlasst, einen gesunden Prozess zu beenden. |
| `GET /api/meta/schema-version` | Die aktuelle Schema-Version. Ohne Authentifizierung – es handelt sich um einen Versionsstempel, nicht um das Schema selbst. |
| `GET /api/meta/contract` | Der vollständige Collection-Contract. Nur für Administratoren. |
| `GET /metrics` | Prometheus-Metriken, wenn `REBASE_METRICS=true`. |

---
