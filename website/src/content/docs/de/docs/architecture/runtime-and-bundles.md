---
sourceHash: 046a65dbfb662f07
title: Runtime und Bundles
sidebar_label: Runtime & Bundles
description: Wie sich ein Rebase-Projekt in ein Projekt-Bundle und eine versionierte Runtime aufteilt und warum diese Trennung Upgrades, Multi-Repo-Apps und verwaltetes Hosting ermöglicht.
---

## Die zwei Hälften eines Deployments

Ein Rebase-Deployment besteht aus zwei Dingen, nicht aus einem:

- **Das Bundle** — Ihr Projekt. Kompilierte Collections, Hooks, Funktionen und Cron-Jobs sowie ein generiertes Manifest, das beschreibt, was diese benötigen.
- **Die Runtime** — die Engine. `@rebasepro/server`, geliefert als das veröffentlichte Container-Image `rebasepro/server`.

Sie werden separat gebaut, versioniert und ausgeliefert. Genau aus dieser Entscheidung ergibt sich alles Weitere auf dieser Seite: Da die Engine nicht fest in Ihr Anwendungs-Image integriert ist, kann sie unterhalb Ihres Projekts ausgetauscht werden — für einen Sicherheits-Fix, eine Leistungsverbesserung oder ein neues Feature —, ohne dass etwas von dem neu gebaut werden muss, was Sie geschrieben haben.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

Die Runtime, die Sie selbst hosten, ist dieselbe Runtime, die auf Rebase Cloud läuft. Es gibt keinen separaten „Platform“-Build, und nichts vom verwalteten Angebot (Managed Tier) ist für jemanden unerreichbar, der `docker compose up` ausführt.

## Ein Bundle bauen

```bash
rebase build
```

Dies generiert das Datenbankschema aus Ihren Collections neu, führt Typprüfungen durch, kompiliert sie, löst Import-Spezifizierer auf, damit Node die Ausgabe direkt laden kann, und schreibt `dist-bundle/` mit folgendem Inhalt:

| Pfad | Beschreibung |
| --- | --- |
| `manifest.json` | Generiert. Der Vertrag, den dieses Bundle zu erfüllen vorgibt. |
| `package.json` | Generiert. Die Runtime-Abhängigkeiten Ihres Projekts. |
| `config/` | Kompilierte Collections. |
| `backend/functions/` | Kompilierte Serverfunktionen. |
| `backend/crons/` | Kompilierte Cron-Jobs. |
| `backend/src/schema.generated.js` | Kompiliertes Datenbankschema. |

Es lohnt sich, das Manifest zu verstehen, da die Runtime genau dieses validiert, bevor sie dem Start zustimmt:

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.17.3", "contract": 1 },
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

`kind` ist entweder `backend` — startet den Server plus alle statischen Apps in `entry.static` — oder `static`, was ausschließlich diese Assets ausliefert: keine Datenbank, keine Authentifizierung. Ob ein Backend seine Collections im Code deklariert oder per Introspektion aus der Live-Datenbank liest, ist kein dritter Typ; es hängt lediglich davon ab, ob `entry.config` vorhanden ist.

## Ein Bundle ausführen

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` lädt das Bundle im selben Prozess (in-process), sodass Signale und Stacktraces Sie direkt erreichen. Lokale Ausführungen verknüpfen Ihre bereits installierten Abhängigkeiten mit dem Bundle, sodass keine zweite Installation erforderlich ist; ein Deployment installiert stattdessen die eigene `package.json` des Bundles.

## Kompatibilität

Zwei Versionsnummern bestimmen, ob ein Bundle und eine Runtime zusammenarbeiten können, und diese entsprechen bewusst nicht der Paketversion.

**`bundleFormat`** ist das Dateisystem-Layout (On-Disk-Layout). Eine Runtime akzeptiert jedes Bundle, dessen Format kleiner oder gleich ihrem eigenen ist, und lehnt ein neueres ab, anstatt es unvollständig zu laden. Ein älteres Bundle auf einer neueren Runtime muss weiterhin funktionieren — das ist der eigentliche Sinn der Trennung. Daher liest eine Runtime jedes Format, das jemals ausgeliefert wurde. Bundles vom Format 1, die dieses Feld noch `mode` nannten und ein einzelnes statisches Verzeichnis enthielten, starten weiterhin unverändert.

**`runtime.contract`** ist die Schnittstelle zwischen einem Bundle und der Engine. Innerhalb derselben Major-Version des Contracts bleibt jedes Bundle, das einmal validiert wurde, weiterhin gültig. Patch- und Minor-Updates sind abwärtskompatibel (Drop-in); eine Major-Version ist es nicht, und eine Runtime wird ein Bundle aus einer anderen Major-Version ablehnen, anstatt zu starten und sich später fehlerhaft zu verhalten.

Aus diesem Grund ist die Aktualisierung von Rebase in einem selbstgehosteten Deployment lediglich eine Änderung des Tags:

```yaml
image: rebasepro/server:0.17.3   # a newer tag — your bundle is untouched
```

## Die Entwicklung nutzt denselben Pfad

`rebase dev` startet dieselbe Runtime direkt über Ihrem TypeScript-Quellcode anstelle eines kompilierten Bundles. Hot Reload funktioniert weiterhin, und die Entwicklung entspricht der Produktion, da beide denselben Startpfad durchlaufen, anstatt zwei unterschiedliche Implementierungen zu nutzen, die voneinander abweichen könnten.

Ein Projekt, das Funktionen benötigt, die die Standard-Runtime nicht bietet, kann weiterhin eine eigene `backend/src/index.ts` schreiben und den Server als Bibliothek importieren. `rebase dev` erkennt und führt dies aus. Siehe [Eigener Server](/docs/backend/custom-server/) — Sie verlieren lediglich die Standard-Runtime, nicht die API-Oberfläche.

## Was die Runtime aus der Umgebung liest

Die Runtime wird vollständig über Umgebungsvariablen konfiguriert, da dies der kleinste gemeinsame Nenner aller Deployment-Ziele ist.

| Variable | Bedeutung |
| --- | --- |
| `DATABASE_URL` | Verbindungszeichenfolge für die Standarddatenbank. Erforderlich. |
| `JWT_SECRET` | Signierungs-Geheimnis (Secret), mindestens 32 Zeichen. In der Produktion erforderlich. |
| `CORS_ORIGINS` | Kommagetrennte Ursprünge (Origins), die die API aufrufen dürfen. In der Produktion erforderlich. |
| `PORT` | Zuzuweisender Port (Port to bind). Standardmäßig `3001` lokal, `8080` im Image. |
| `REBASE_SERVICE_KEY` | Server-zu-Server-Schlüssel, der Admin-Zugriff gewährt. |
| `REBASE_METRICS` | `true`, um Prometheus-Metriken unter `/metrics` bereitzustellen. |
| `REBASE_MIGRATE_ON_BOOT` | `ensure` (Standard, auch in der Produktion) führt den **additiven** Durchlauf aus: fehlende Tabellen, Spalten und Enum-Typen anlegen, nie eine löschen oder umschreiben. `none` fasst nichts an. Das veröffentlichte Image akzeptiert nur diese beiden und **verweigert den Start bei `push`**. |
| `REBASE_SERVE_STATIC` | Liefert die statischen Assets des Bundles aus diesem Prozess aus. Standardmäßig aktiviert. |

Mehrere Datenbanken und mehrere Buckets werden konfiguriert, indem der Variable der Quellschlüssel (Source Key) als Suffix angehängt wird — siehe [Mehrere Datenbanken und Buckets](/docs/backend/multiple-sources/).

## Endpunkte, die die Runtime immer bereitstellt

| Pfad | Zweck |
| --- | --- |
| `GET /health` | Readiness (Betriebsbereitschaft). Führt eine Testanfrage an die Datenbank durch. |
| `GET /livez` | Liveness (Lebendigkeit). Greift bewusst *nicht* auf die Datenbank zu, damit ein kurzer Datenbankausfall nicht dazu führt, dass ein Orchestrator einen gesunden Prozess beendet. |
| `GET /api/meta/schema-version` | Die aktuelle Schema-Version. Ohne Authentifizierung — es ist ein Versionsstempel, kein Schema. |
| `GET /api/meta/contract` | Der vollständige Collection-Contract. Nur für Admins. |
| `GET /metrics` | Prometheus-Metriken, wenn `REBASE_METRICS=true`. |

---
