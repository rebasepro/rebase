---
sourceHash: 47f5760918cfd724
title: Runtime und Bundles
sidebar_label: Runtime & Bundles
description: Wie ein Rebase-Projekt in ein Projekt-Bundle und eine versionierte Runtime aufgeteilt wird und warum diese Trennung Upgrades, Multi-Repo-Apps und Managed Hosting ermöglicht.
---

## Die zwei Hälften eines Deployments

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein Rebase-Deployment besteht aus zwei Dingen, nicht nur einem:

- **Das Bundle** — Ihr Projekt. Kompilierte Tabellen, Hooks, Funktionen und Cron-Jobs sowie ein generiertes Manifest, das beschreibt, was diese benötigen.
- **Die Runtime** — die Engine. `@rebasepro/server`, ausgeliefert als veröffentlichtes `rebasepro/server`-Container-Image.

Sie werden separat gebaut, versioniert und ausgeliefert. Genau aus dieser Entscheidung ergibt sich alles Weitere auf dieser Seite: Da die Engine nicht fest in Ihr Anwendungs-Image integriert ist, kann sie unter Ihrem Projekt ausgetauscht werden – für einen Sicherheits-Fix, eine Leistungsverbesserung oder ein neues Feature –, ohne dass von Ihnen geschriebener Code neu gebaut werden muss.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  backend/schema/*.ts       ──►   dist-bundle/backend/schema/  ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/             + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

Die Runtime, die Sie selbst hosten, ist dieselbe Runtime, die Rebase Cloud ausführt. Es gibt keinen separaten „Platform“-Build, und nichts aus dem Managed-Angebot bleibt jemandem vorenthalten, der `docker compose up` ausführt.

## Ein Bundle bauen

```bash
rebase build
```

Dies regeneriert das Datenbankschema aus Ihren Tabellen, führt eine Typprüfung durch, kompiliert sie, löst Import-Spezifizierer auf, sodass Node die Ausgabe direkt laden kann, und schreibt `dist-bundle/` mit folgendem Inhalt:

| Pfad | Beschreibung |
| --- | --- |
| `manifest.json` | Generiert. Der Vertrag (Contract), den dieses Bundle zu erfüllen vorgibt. |
| `package.json` | Generiert. Die Laufzeit-Abhängigkeiten Ihres Projekts. |
| `backend/schema/` | Kompilierte Tabellen: der `index`, der sie exportiert, und ein Modul pro Tabelle. |
| `backend/resources.js`, `backend/storage.js`, `backend/hooks.js` | Die kompilierten Module, die die Runtime neben den Tabellen liest, sofern das Projekt sie enthält. |
| `backend/functions/` | Kompilierte Server-Funktionen. |
| `backend/crons/` | Kompilierte Cron-Jobs. |
| `backend/src/schema.generated.js` | Kompiliertes Datenbankschema. |

Es lohnt sich, das Manifest zu verstehen, denn es ist genau das, was eine Runtime validiert, bevor sie dem Start zustimmt:

```jsonc
{
  "bundleFormat": 3,
  "runtime": { "range": "^1", "builtAgainst": "0.30.1", "contract": 2 },
  "schemaVersion": "v2:3f0c9a1e7d2b5c48",
  "kind": "backend",
  "entry": {
    "tables": "backend/schema",
    "resources": "backend/resources.js",
    "storage": "backend/storage.js",
    "functions": "backend/functions",
    "static": [{ "path": "/", "dir": "static/admin", "spa": true }]
  },
  "tables": ["authors", "posts", "tags", "users"],
  "hooks": { "native": false },
  "storage": { "authorize": true },
  "deps": { "declared": { "zod": "^4.4.3" } }
}
```

<span class="since-badge" data-since="0.31">Seit 0.31</span> `bundleFormat` 3 und Runtime-Vertrag (runtime contract) 2: Das Schema ist `entry.tables`, das kompilierte `backend/schema`-Verzeichnis, neben `entry.resources`, `entry.storage` und `entry.hooks`. `schemaVersion` beginnt mit `v2:` — sie wird aus den kompilierten Tabellen berechnet.

`kind` ist entweder `backend` — startet den Server plus alle statischen Apps in `entry.static` — oder `static`, was diese Assets und sonst nichts ausliefert: keine Datenbank, keine Authentifizierung. Ob ein Backend seine Tabellen im Code deklariert oder sie aus der Live-Datenbank introspektiert, ist keine dritte Art (`kind`); es hängt einfach davon ab, ob `entry.tables` vorhanden ist.

## Ein Bundle ausführen

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` lädt das Bundle im selben Prozess (in-process), sodass Signale und Stack-Traces Sie direkt erreichen. Lokal verlinkt es Ihre bereits installierten Abhängigkeiten in das Bundle, sodass keine zweite Installation nötig ist; ein Deployment installiert stattdessen die eigene `package.json` des Bundles.

## Kompatibilität

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Zwei Versionsnummern bestimmen, ob ein Bundle und eine Runtime zusammenarbeiten können, und es handelt sich dabei bewusst nicht um die Paketversion.

**`bundleFormat`** ist das On-Disk-Layout. Eine Runtime verweigert ein neueres Format, anstatt es nur teilweise zu laden. Ein älteres Bundle auf einer neueren Runtime funktioniert weiterhin, sofern das Layout dies zulässt — das ist der Zweck dieser Trennung — mit einer Ausnahme: **Ein Bundle im Format 1 oder Format 2 wird von einer 0.31-Runtime verweigert**. Diese Bundles enthalten `config/collections` — `defineCollection`-Objekte — und eine Runtime, die nur `backend/schema` liest, hat keine Möglichkeit, diese einzulesen; das Starten eines solchen Bundles würde die Datenbank introspektieren, anstatt die deklarierten Tabellen bereitzustellen. Die Fehlermeldung benennt die Lösung: Führen Sie [`rebase migrate collections-to-tables`](/docs/cli/schema/#rebase-migrate) auf dem Quellcode des Projekts aus und bauen Sie das Bundle anschließend neu.

**`runtime.contract`** ist die Schnittstelle zwischen einem Bundle und der Engine; mit Version 0.31 wurde diese auf `2` geändert. Innerhalb einer Major-Version des Contracts bleibt jedes Bundle, das validiert wurde, weiterhin gültig. Patches und Minor-Versionen sind Drop-in-kompatibel; eine Major-Version ist es nicht, und eine Runtime verweigert ein Bundle aus einer anderen Major-Version, anstatt zu starten und sich später fehlerhaft zu verhalten.

Aus diesem Grund ist ein Upgrade von Rebase in einem selbst gehosteten Deployment lediglich eine Änderung des Tags:

```yaml
image: rebasepro/server:0.30.1   # a newer tag — your bundle is untouched
```

## Die Entwicklung nutzt denselben Pfad

`rebase dev` startet dieselbe Runtime über Ihrem TypeScript-Quellcode anstelle eines kompilierten Bundles. Hot-Reload funktioniert weiterhin, und die Entwicklung spiegelt die Produktion zuverlässig wider, da beide denselben Boot-Pfad durchlaufen, anstatt zwei Implementierungen zu nutzen, die auseinanderdriften können.

Ein Projekt, das Funktionen benötigt, die die Standard-Runtime nicht bietet, kann dennoch eine eigene `backend/src/index.ts` schreiben und den Server als Bibliothek importieren. `rebase dev` erkennt dies und führt es aus. Siehe [Benutzerdefinierter Server](/docs/backend/custom-server/) — Sie verlieren dabei die Standard-Runtime, nicht jedoch die API-Oberfläche.

## Was die Runtime aus der Umgebung liest

Die Runtime wird vollständig über Umgebungsvariablen konfiguriert, da dies von jedem Deployment-Ziel unterstützt wird.

| Variable | Bedeutung |
| --- | --- |
| `DATABASE_URL` | Verbindungszeichenfolge für die Standard-Datenbank. Erforderlich. |
| `JWT_SECRET` | Signierungs-Secret, mindestens 32 Zeichen. In der Produktion erforderlich. |
| `CORS_ORIGINS` | Kommagetrennte Origins, die die API aufrufen dürfen. In der Produktion erforderlich. |
| `PORT` | Port, an den gebunden werden soll. Standardmäßig lokal `3001`, im Image `8080`. |
| `REBASE_SERVICE_KEY` | Server-zu-Server-Schlüssel, der Administratorzugriff gewährt. |
| `REBASE_METRICS` | `true`, um Prometheus-Metriken unter `/metrics` bereitzustellen. |
| `REBASE_MIGRATE_ON_BOOT` | `ensure` — überall der Standard, einschließlich Produktion — führt den additiven Bereitstellungslauf aus; `none` lässt das Schema unverändert. Jeder andere Wert verweigert das Booten, und das Runtime-Image verweigert auch `push`. |
| `REBASE_SERVE_STATIC` | Liefert die statischen Assets des Bundles aus diesem Prozess aus. Standardmäßig aktiviert. |

Mehrere Datenbanken und mehrere Buckets werden konfiguriert, indem der Source-Key als Suffix an die Variable angehängt wird — siehe [Mehrere Datenbanken und Buckets](/docs/backend/multiple-sources/).

## Endpunkte, die die Runtime immer bereitstellt

| Pfad | Zweck |
| --- | --- |
| `GET /health` | Readiness. Führt einen Datenbank-Roundtrip durch. |
| `GET /livez` | Liveness. Berührt die Datenbank bewusst *nicht*, damit ein kurzer Datenbankaussetzer nicht dazu führt, dass ein Orchestrator einen fehlerfreien Prozess beendet. |
| `GET /api/meta/schema-version` | Die aktuelle Schema-Version. Nicht authentifiziert — es ist ein Versionsstempel, kein Schema. |
| `GET /api/schema/tables` | Die Tabellen, wie der jeweilige Aufrufer sie sehen darf — die Grundlage für das Rendering des Admin-Panels. Siehe [Endpunkte](/docs/backend/endpoints/#schema). |
| `GET /api/meta/contract` | Die Schema-Version, die Runtime und jede Tabelle aus Administratorsicht. Erfordert `schema:read`. |
| `GET /metrics` | Prometheus-Metriken, wenn `REBASE_METRICS=true`. |
