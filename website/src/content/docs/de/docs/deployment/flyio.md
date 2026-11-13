---
sourceHash: 10c8baa5ed2e63bf
title: Bereitstellung von Rebase auf Fly.io
description: Erfahren Sie, wie Sie Rebase global bereitstellen oder mithilfe von Fly.io auf europäische Rechenzentren beschränken.
sidebar_label: Fly.io
---

Fly.io führt Docker-Container nah an Ihren Benutzern in einem globalen Anycast-Netzwerk aus und lässt sich flexibel so konfigurieren, wo Daten gespeichert werden – ideal für ein Rebase-Deployment mit strikt europäischem Fokus. Fly verfügt über Rechenzentren in **Amsterdam (ams)**, **Frankfurt (fra)**, **Madrid (mad)** und **Paris (cdg)**.

Nichts auf dieser Seite bezüglich Ihres Projekts ist spezifisch für Fly. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und hier.

## 1. Fly-App initialisieren

Führen Sie bei installiertem `flyctl` aus Ihrem Projekt Folgendes aus:

```bash
fly launch --no-deploy
```

1. **App-Name:** `my-rebase-app`
2. **Organisation:** persönlich oder Ihre Unternehmens-Organisation.
3. **Region:** Wählen Sie ein europäisches Rechenzentrum – Frankfurt (`fra`) oder Paris (`cdg`).
4. **Datenbank:** Wählen Sie **Yes** für ein Postgres-Cluster. Fly erstellt es in derselben Region und fügt `DATABASE_URL` ein.
5. **Redis:** Wählen Sie **No**.

`--no-deploy`, weil die Secrets und das Bundle zuerst vorhanden sein müssen.

Wenn Ihre Tabellen eine `col.vector()`-Spalte deklarieren, aktivieren Sie die Extension einmalig in dieser Datenbank: `CREATE EXTENSION vector;`.

## 2. Bundle erstellen und fly.toml auf das Runtime-Image verweisen

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Tabellen, Funktionen, Cronjobs und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend:

```bash
rebase build
```

Erstellen und committen Sie ein dreizeiliges `Dockerfile` im Projektstammverzeichnis:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

Und verweisen Sie in `fly.toml` darauf:

```toml title="fly.toml"
app = "my-rebase-app"
primary_region = "fra"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  DISABLE_SELF_REGISTRATION = "true"

[http_service]
  internal_port = 8080          # the port the runtime image listens on
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1      # realtime subscriptions need a machine to stay up

[[http_service.checks]]
  path = "/livez"
```

Verwenden Sie `/livez` statt `/health`: Letzteres führt einen Datenbank-Roundtrip durch, sodass ein Liveness-Check bei einer kurzen Datenbankverzögerung eine ansonsten gesunde Machine neu starten würde.

Ein späteres Upgrade von Rebase erfordert lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

## 3. Produktions-Secrets festlegen

```bash
fly secrets set \
  JWT_SECRET=your_super_long_randomly_generated_secure_string \
  REBASE_SERVICE_KEY=another_super_long_randomly_generated_secure_string \
  CORS_ORIGINS=https://my-rebase-app.fly.dev \
  FRONTEND_URL=https://my-rebase-app.fly.dev \
  REBASE_ADMIN_EMAIL=you@example.com \
  REBASE_ADMIN_PASSWORD=$(openssl rand -hex 12) \
  -a my-rebase-app
```

Die letzten beiden sind neu und bestimmen, wie diese App überhaupt einen Administrator erhält: In der Produktion wird das erste registrierte Konto nicht hochgestuft, sodass auf andere Weise kein erster angemeldeter Aufrufer entsteht. Setzen Sie diese, bevor das erste Deployment Traffic empfängt – siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin). `fly secrets list` zeigt nur Hashes/Digests an; bewahren Sie das mit diesem Befehl generierte Passwort daher gut auf, da es nicht wieder ausgelesen werden kann.

## 4. Bereitstellen

```bash
fly deploy
```

Anschließend `fly open`.

## 5. Das Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Runtime erstellt beim Start fehlende Tabellen, einschließlich der in `backend/schema` deklarierten.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was additiv für das gesamte Schema wirkt – es erstellt fehlende Tabellen, Spalten sowie Enum-Typen und wendet deren Row-Level Security an –, sodass der erste Start mit einer leeren Datenbank direkt Ihre Collections bereitstellt.

Was `ensure` niemals tut, ist etwas zu ändern, das bereits existiert: Es ändert weder einen Spaltentyp, noch löscht es etwas oder bearbeitet die Labels eines vorhandenen Enums, da der Neustart einer Machine das Schema nicht als Nebeneffekt eines Deployments umstrukturieren darf.

Für eines wird daher weiterhin die CLI benötigt, ausgeführt aus einem Checkout oder einem CI-Job:

```bash
rebase db push
```

Jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeengter Typ, ein entferntes Feld.

Öffnen Sie für ein privates Fly Postgres einen Tunnel mit `fly proxy 5432 -a <your-db-app>` und lassen Sie `DATABASE_URL` auf `localhost:5432` verweisen. Das Runtime-Image wird ohne die CLI ausgeliefert, daher wird dies nie innerhalb der Machine ausgeführt und kann auch nicht von einem `release_command` aufgerufen werden. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Das Dateisystem einer Fly-Machine übersteht ein Deployment nicht, daher bedeutet lokaler Dateispeicher stillen Datenverlust und wird von der Runtime in der Produktion verweigert. Binden Sie einen S3-kompatiblen Bucket an – Tigris ist derjenige, den Fly bereitstellt – mit `STORAGE_TYPE=s3`. Siehe [Speicher](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Produktions-Checkliste und die Regeln für den ersten Admin, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) – alle Umgebungsvariablen, die die Runtime liest.
