---
sourceHash: 15a0356fd585a797
title: Rebase auf Fly.io bereitstellen
description: Erfahren Sie, wie Sie Rebase mit Fly.io weltweit bereitstellen oder auf europäische Rechenzentren beschränken.
sidebar_label: Fly.io
---

Fly.io führt Docker-Container über ein globales Anycast-Netzwerk nah an Ihren Benutzern aus und lässt sich hochgradig konfigurieren, wo Daten gespeichert werden – ideal für ein Rebase-Deployment mit streng europäischem Fokus. Fly verfügt über Rechenzentren in **Amsterdam (ams)**, **Frankfurt (fra)**, **Madrid (mad)** und **Paris (cdg)**.

Nichts auf dieser Seite ist für Ihr Projekt Fly-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und hier.

## 1. Fly-App initialisieren

Führen Sie bei installiertem `flyctl` aus Ihrem Projekt heraus Folgendes aus:

```bash
fly launch --no-deploy
```

1. **App-Name:** `my-rebase-app`
2. **Organisation:** persönlich oder die Organisation Ihres Unternehmens.
3. **Region:** Wählen Sie ein europäisches Rechenzentrum – Frankfurt (`fra`) oder Paris (`cdg`).
4. **Datenbank:** Wählen Sie **Yes** für einen Postgres-Cluster. Fly erstellt diesen in derselben Region und injiziert `DATABASE_URL`.
5. **Redis:** Wählen Sie **No**.

`--no-deploy`, da Secrets und das Bundle zuerst vorhanden sein müssen.

Wenn Ihre Tabellen eine `col.vector()`-Spalte deklarieren, aktivieren Sie die Extension einmalig in dieser Datenbank: `CREATE EXTENSION vector;`.

## 2. Bundle erstellen und fly.toml auf das Runtime-Image verweisen

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Tabellen, Funktionen, Cronjobs und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend:

```bash
rebase build
```

Committed Sie ein dreizeiliges `Dockerfile` im Projekt-Root:

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

`/livez` statt `/health`: Letzteres führt einen Datenbank-Roundtrip durch, sodass ein Liveness-Check darauf eine funktionierende Machine bei einem kurzen Datenbank-Schluckauf neu starten würde.

Ein späteres Rebase-Upgrade erfordert lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

## 3. Produktions-Secrets setzen

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

Die letzten beiden sind neu und ermöglichen es der App überhaupt, einen Administrator zu erhalten: In der Produktionsumgebung wird der erste registrierte Account nicht heraufgestuft, sodass sonst kein erster authentifizierter Benutzer zustande kommt. Setzen Sie diese, bevor das erste Deploy Traffic bedient – siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin). `fly secrets list` zeigt nur Prüfsummen (Digests) an, bewahren Sie das generierte Passwort aus diesem Befehl also gut auf; es kann nachträglich nicht wieder ausgelesen werden.

## 4. Bereitstellen

```bash
fly deploy
```

Anschließend `fly open`.

## 5. Das Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Runtime erstellt beim Booten fehlende Tabellen, einschließlich derjenigen, die `backend/schema` deklariert.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv ist – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an –, sodass der erste Start gegen eine leere Datenbank direkt Ihre Tabellen bereitstellt.

Was `ensure` niemals tut, ist das Ändern bereits existierender Elemente: Es ändert weder Spaltentypen, löscht nichts, noch bearbeitet es Labels bestehender Enums, da der Neustart einer Machine das Schema nicht als Nebeneffekt eines Deploys umformen darf.

Eine Sache erfordert daher weiterhin die CLI, ausgeführt aus einem Checkout oder CI-Job:

```bash
rebase db push
```

Jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeengter Typ, ein entferntes Feld.

Für ein privates Fly Postgres öffnen Sie einen Tunnel mit `fly proxy 5432 -a <your-db-app>` und lassen `DATABASE_URL` auf `localhost:5432` zeigen. Das Runtime-Image wird ohne die CLI ausgeliefert, daher läuft dies niemals innerhalb der Machine und ein `release_command` kann es ebenfalls nicht aufrufen. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Das Dateisystem einer Fly-Machine übersteht kein Deploy; lokaler Dateispeicher bedeutet daher stillen Datenverlust und wird von der Runtime in der Produktionsumgebung verweigert. Binden Sie einen S3-kompatiblen Bucket ein – Fly stellt hierfür Tigris bereit – mit `STORAGE_TYPE=s3`. Siehe [Speicher](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Produktions-Checkliste und die Regeln für den ersten Admin, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) – alle Umgebungsvariablen, die die Runtime einliest.
