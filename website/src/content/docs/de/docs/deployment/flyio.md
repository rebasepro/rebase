---
sourceHash: d53d77c2683bb3d3
title: Rebase auf Fly.io bereitstellen
description: Erfahren Sie, wie Sie Rebase global bereitstellen oder mithilfe von Fly.io auf europäische Rechenzentren beschränken.
sidebar_label: Fly.io
---

Fly.io führt Docker-Container nah an Ihren Benutzern in einem globalen Anycast-Netzwerk aus und lässt sich hochgradig konfigurieren, wo Daten gespeichert werden – ideal für ein Rebase-Deployment mit striktem europäischem Fokus. Fly verfügt über Rechenzentren in **Amsterdam (ams)**, **Frankfurt (fra)**, **Madrid (mad)** und **Paris (cdg)**.

Nichts auf dieser Seite bezüglich Ihres Projekts ist Fly-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm chart](/docs/deployment/kubernetes) sowie hier.

## 1. Die Fly-App initialisieren

Führen Sie bei installiertem `flyctl` in Ihrem Projekt folgenden Befehl aus:

```bash
fly launch --no-deploy
```

1. **App-Name:** `my-rebase-app`
2. **Organisation:** persönlich („personal“) oder Ihre Unternehmens-Organisation.
3. **Region:** Wählen Sie ein europäisches Rechenzentrum – Frankfurt (`fra`) oder Paris (`cdg`).
4. **Datenbank:** Antworten Sie mit **Yes** für einen Postgres-Cluster. Fly erstellt ihn in derselben Region und fügt `DATABASE_URL` ein.
5. **Redis:** Antworten Sie mit **No**.

`--no-deploy`, da die Secrets und das Bundle zuerst vorhanden sein müssen.

Falls Ihre Collections eine `vector`-Eigenschaft deklarieren, aktivieren Sie die Extension einmalig in dieser Datenbank: `CREATE EXTENSION vector;`.

## 2. Das Bundle bauen und fly.toml auf das Runtime-Image verweisen lassen

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Functions, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend:

```bash
rebase build
```

Committen Sie ein dreizeiliges `Dockerfile` im Root-Verzeichnis Ihres Projekts:

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

Lieber `/livez` statt `/health`: Letzteres führt einen Datenbank-Roundtrip durch, sodass ein Liveness-Check bei einem kurzen Datenbank-Schluckauf eine ansonsten gesunde Machine neu starten würde.

`DISABLE_SELF_REGISTRATION` ist neu: In 0.17.3 gibt es keinen solchen Schalter, und das erste registrierte Konto wird zum Administrator.

Ein späteres Upgrade von Rebase erfordert lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

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

Die letzten beiden sind neu und sorgen dafür, dass diese App überhaupt einen Administrator erhält: In der Produktion wird das erste registrierte Konto nicht befördert, sodass sonst kein erster angemeldeter Benutzer existiert. Setzen Sie diese, bevor das erste Deployment Traffic verarbeitet – siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin). `fly secrets list` zeigt nur Hashes an, bewahren Sie also das mit diesem Befehl generierte Passwort auf; es gibt keine Möglichkeit, es später wieder auszulesen.

## 4. Bereitstellen

```bash
fly deploy
```

Danach `fly open`.

## 5. Das Schema

**Die Runtime erstellt beim Start fehlende Tabellen, einschließlich derer Ihrer Collections.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv arbeitet – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an – sodass der erste Start gegen eine leere Datenbank direkt Ihre Collections bereitstellt.

Was `ensure` niemals tut, ist etwas zu ändern, das bereits existiert: Es ändert keine Spaltentypen, löscht nichts und bearbeitet keine Labels vorhandener Enums, da eine neu startende Machine ein Schema niemals als Nebeneffekt eines Deployments umstrukturieren darf.

Zwei Dinge erfordern daher weiterhin die CLI, ausgeführt aus einem Checkout oder einem CI-Job:

```bash
rebase db push
```

- **Junction-Table-RLS** für Many-to-Many-Relationen.
- **Jede Änderung, die nicht rein additiv ist** – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Öffnen Sie für ein privates Fly Postgres einen Tunnel mit `fly proxy 5432 -a <your-db-app>` und lassen Sie `DATABASE_URL` auf `localhost:5432` zeigen. Das Runtime-Image wird ohne die CLI ausgeliefert, sodass dies niemals innerhalb der Machine läuft und auch ein `release_command` dies nicht aufrufen kann. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Das Dateisystem einer Fly Machine übersteht kein Deployment; lokaler Dateispeicher führt daher zu unbemerktem Datenverlust, weshalb die Runtime ihn in der Produktion verweigert. Binden Sie einen S3-kompatiblen Bucket an – Tigris ist derjenige, den Fly bereitstellt – mit `STORAGE_TYPE=s3`. Siehe [Storage](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Produktions-Checkliste und die First-Admin-Regeln, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) – jede Umgebungsvariable, die die Runtime liest.

---
