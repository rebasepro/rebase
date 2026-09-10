---
sourceHash: 263c0ae6a0fac44f
title: Bereitstellung von Rebase auf Fly.io
description: Erfahren Sie, wie Sie Rebase global bereitstellen oder mithilfe von Fly.io auf europäische Rechenzentren beschränken.
sidebar_label: Fly.io
---

Fly.io führt Docker-Container in der Nähe Ihrer Benutzer auf einem globalen Anycast-Netzwerk aus und ist hochgradig konfigurierbar in Bezug auf den Speicherort von Daten – ideal für ein Rebase-Deployment mit strengem europäischem Fokus. Fly verfügt über Rechenzentren in **Amsterdam (ams)**, **Frankfurt (fra)**, **Madrid (mad)** und **Paris (cdg)**.

Nichts auf dieser Seite bezüglich Ihres Projekts ist Fly-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, auf Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und hier.

## 1. Fly-App initialisieren

Führen Sie bei installiertem `flyctl` in Ihrem Projekt Folgendes aus:

```bash
fly launch --no-deploy
```

1. **App-Name:** `my-rebase-app`
2. **Organisation:** persönlich („personal“) oder Ihre Unternehmensorganisation.
3. **Region:** Wählen Sie ein europäisches Rechenzentrum – Frankfurt (`fra`) oder Paris (`cdg`).
4. **Datenbank:** Wählen Sie **Yes** für einen Postgres-Cluster. Fly erstellt diesen in derselben Region und injiziert `DATABASE_URL`.
5. **Redis:** Wählen Sie **No**.

`--no-deploy`, weil die Secrets und das Bundle zuerst vorhanden sein müssen.

Wenn Ihre Collections eine `vector`-Eigenschaft deklarieren, aktivieren Sie die Extension einmalig in dieser Datenbank: `CREATE EXTENSION vector;`.

## 2. Bundle bauen und fly.toml auf das Runtime-Image verweisen

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Functions, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend:

```bash
rebase build
```

Committen Sie ein dreizeiliges `Dockerfile` im Root-Verzeichnis des Projekts:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
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

Verwenden Sie `/livez` anstelle von `/health`: Letzteres führt einen Datenbank-Roundtrip durch, sodass ein Liveness-Check bei einem kurzen Schluckauf der Datenbank eine ansonsten fehlerfreie Machine neu starten würde.

`DISABLE_SELF_REGISTRATION` ist neu: In 0.17.3 gibt es keinen solchen Schalter, und der erste registrierte Account wird zum Administrator.

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

Die letzten beiden sind neu und sorgen dafür, dass diese App überhaupt einen Administrator erhält: In der Produktion wird der erste registrierte Account nicht automatisch hochgestuft, sodass andernfalls kein erster angemeldeter Aufrufer existiert. Setzen Sie diese, bevor das erste Deployment Traffic bedient – siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin). `fly secrets list` zeigt nur Hashes an; bewahren Sie daher das von diesem Befehl generierte Passwort auf – es gibt keine Möglichkeit, es später wieder auszulesen.

## 4. Bereitstellen

```bash
fly deploy
```

Anschließend `fly open`.

## 5. Das Schema

**Die Runtime erstellt fehlende Tabellen beim Start, einschließlich derjenigen Ihrer Collections.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg rein additiv arbeitet – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an – sodass der erste Start mit einer leeren Datenbank direkt bereit ist, Ihre Collections bereitzustellen.

Was `ensure` niemals tut, ist das Ändern bereits vorhandener Elemente: Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine bestehenden Enum-Werte, da eine neu startende Machine ein Schema nicht als Nebeneffekt eines Deployments umgestalten darf.

Zwei Dinge erfordern daher weiterhin die CLI, ausgeführt aus einem Checkout oder einem CI-Job:

```bash
rebase db push
```

- **Junction-Table-RLS** für Many-to-Many-Beziehungen.
- **Jede Änderung, die nicht rein additiv ist** – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Öffnen Sie für eine private Fly-Postgres-Instanz einen Tunnel mit `fly proxy 5432 -a <your-db-app>` und verweisen Sie mit `DATABASE_URL` auf `localhost:5432`. Das Runtime-Image wird ohne die CLI ausgeliefert, sodass dies niemals innerhalb der Machine ausgeführt wird und auch ein `release_command` dies nicht aufrufen kann. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen Sie stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Das Dateisystem einer Fly-Machine übersteht ein Deployment nicht; lokaler Dateispeicher führt daher zu unbemerktem Datenverlust und wird von der Runtime in der Produktion verweigert. Binden Sie einen S3-kompatiblen Bucket an – Tigris wird von Fly bereitgestellt – mit `STORAGE_TYPE=s3`. Siehe [Storage](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Checkliste für die Produktion und die Regeln für den ersten Admin, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) – jede Umgebungsvariable, die die Runtime liest.

---
