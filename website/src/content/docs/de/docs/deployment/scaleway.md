---
sourceHash: 8065b392b2b6690b
title: Rebase auf Scaleway bereitstellen
description: Erfahren Sie, wie Sie Rebase auf Scaleway für eine sichere, in Frankreich ansässige Cloud-Infrastruktur mit Serverless Containers bereitstellen.
sidebar_label: Scaleway
---

Scaleway ist ein europäischer Cloud-Anbieter mit Sitz in Frankreich und Rechenzentren in Paris, Amsterdam und Warschau – eine ausgezeichnete Wahl für Organisationen, die Wert auf EU-Datensouveränität legen.

Verwenden Sie Scaleways **Managed Database** für Postgres und **Serverless Containers** für die Runtime.

Nichts auf dieser Seite ist an Ihrem Projekt Scaleway-spezifisch. Ein Rebase-Deployment besteht aus zwei getrennten Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und hier.

## 1. Eine Managed-Postgres-Datenbank erstellen

1. Gehen Sie in der Scaleway-Konsole zu **PostgreSQL**.
2. Klicken Sie auf **Create a Database Instance**.
3. Wählen Sie eine Region (z. B. Paris – `PAR1`).
4. Wählen Sie einen Node-Typ aus (**Play2-Pico** oder **Pro2-XXS** eignen sich gut).
5. Vergeben Sie einen Datenbanknamen (`rebase_db`) und ein sicheres Benutzerpasswort.
6. Notieren Sie sich nach der Bereitstellung den **Connection string** (URI) aus dem Dashboard:
   `postgres://user:password@ip:port/rebase_db`

Wenn Ihre Collections eine `vector`-Eigenschaft deklarieren, aktivieren Sie die Extension einmalig in der Datenbank: `CREATE EXTENSION vector;`.

## 2. Das Bundle bauen und in ein Image integrieren

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Functions, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem gebauten Frontend. Das veröffentlichte Runtime-Image führt dieses aus:

```bash
rebase build
```

Serverless Containers pullt aus einer Registry, betten Sie das Bundle daher in ein abgeleitetes Image ein. Drei Zeilen, und es legt genau fest, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

1. Gehen Sie in der Scaleway-Konsole zu **Container Registry** und erstellen Sie einen Namespace (z. B. `rebase-apps`).
2. Melden Sie sich anhand der dort angezeigten Anweisungen über Ihr Terminal bei der Registry an.
3. Bauen und pushen Sie aus dem Projekt-Root:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Ein späteres Upgrade von Rebase erfordert lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

## 3. Den Serverless Container bereitstellen

1. Navigieren Sie zu **Serverless Containers**.
2. Klicken Sie auf **Create a Container**.
3. Wählen Sie das Image aus, das Sie gerade gepusht haben.
4. Setzen Sie den Port auf **8080** – der Port, auf dem das Runtime-Image lauscht, sofern durch `PORT` nichts anderes angegeben ist.
5. Fügen Sie unter Environment Variables Folgendes hinzu:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Die URI aus dem Schritt „Managed Postgres“ |
| `JWT_SECRET` | Ein sicherer Zufallsstring mit mindestens 32 Zeichen zum Signieren von Auth-Tokens |
| `REBASE_SERVICE_KEY` | Ein sicherer Zufallsstring mit mindestens 32 Zeichen |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Ihre Frontend-Domain (z. B. `https://yourdomain.com`) |
| `FRONTEND_URL` | Ihre Frontend-URL (verwendet für E-Mail-Links und CORS-Fallback) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | Die Adresse des ersten Administrators, festgelegt **vor dem ersten Start** |
| `REBASE_ADMIN_PASSWORD` | Mindestens 12 Zeichen |

Die letzten drei Variablen sorgen dafür, dass dieses Deployment überhaupt einen Administrator erhält: Im Produktionsbetrieb wird der erste registrierte Account nicht automatisch hochgestuft, sodass es sonst keine Möglichkeit gibt, den ersten angemeldeten Benutzer zu erstellen. Siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin). Markieren Sie die Secrets als geheime Umgebungsvariablen (Secret Environment Variables) statt als reine Textvariablen.

6. Richten Sie den Health Check auf `/livez` aus. Nicht auf `/health`: Letzterer führt einen Datenbank-Roundtrip durch, weshalb ein Liveness Probe darauf einen ansonsten gesunden Container bei einem kurzen Schluckauf der Datenbank neu starten würde.
7. Klicken Sie auf **Deploy Container**.

Scaleway stellt den Container bereit und stellt Ihnen einen öffentlichen Endpunkt zur Verfügung (z. B. `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Überprüfen Sie für eine strikte Daten-Compliance, ob die Angaben zu Ihrer Scaleway-Organisation Ihre europäische Unternehmenseinheit widerspiegeln.*

## 4. Das Schema

**Die Runtime erstellt beim Start fehlende Tabellen, einschließlich derer Ihrer Collections.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was additiv auf das gesamte Schema wirkt – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an –, sodass der erste Start mit einer leeren Datenbank direkt bereit ist, Ihre Collections bereitzustellen.

Was `ensure` niemals tut, ist das Ändern bereits vorhandener Strukturen: Es ändert keine Spaltentypen, löscht nichts und bearbeitet keine Labels vorhandener Enums, da ein Container-Neustart das Schema nicht als Nebeneffekt eines Deploys verändern darf.

Zwei Dinge erfordern daher weiterhin die CLI, ausgeführt aus einem Checkout oder einem CI-Job mit `DATABASE_URL`, die auf Ihre Managed Database zeigt:

```bash
rebase db push
```

- **Junction-Table-RLS** für Many-to-Many-Relationen.
- **Jede Änderung, die nicht rein additiv ist** – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Das Runtime-Image wird ohne die CLI ausgeliefert, sodass dies niemals innerhalb des Containers ausgeführt wird. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Serverless Containers verfügen über keinen persistenten Speicher; eine lokale Dateispeicherung führt daher zu unbemerktem Datenverlust und wird von der Runtime in der Produktionsumgebung verweigert. Scaleway Object Storage ist S3-kompatibel und befindet sich in denselben Rechenzentren:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Siehe [Storage](/docs/backend/storage) für den vollständigen Überblick.

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Checkliste für die Produktion und die First-Admin-Regeln, die für jede Plattform gelten.
- [Configuration](/docs/getting-started/configuration) – jede Umgebungsvariable, die von der Runtime gelesen wird.
