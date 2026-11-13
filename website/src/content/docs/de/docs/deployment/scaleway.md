---
sourceHash: 663fa0179ad2c716
title: Bereitstellung von Rebase auf Scaleway
description: Erfahren Sie, wie Sie Rebase auf Scaleway für eine sichere, in Frankreich ansässige Cloud-Infrastruktur mithilfe von Serverless Containers bereitstellen.
sidebar_label: Scaleway
---

Scaleway ist ein europäischer Cloud-Anbieter mit Sitz in Frankreich und Rechenzentren in Paris, Amsterdam und Warschau – eine hervorragende Wahl für Organisationen, die Wert auf Datensouveränität in der EU legen.

Verwenden Sie Scaleways **Managed Database** für Postgres und **Serverless Containers** für die Laufzeitumgebung.

Nichts auf dieser Seite bezüglich Ihres Projekts ist Scaleway-spezifisch. Ein Rebase-Deployment besteht aus zwei voneinander trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, auf Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und hier.

## 1. Erstellen Sie eine Managed Postgres-Datenbank

1. Gehen Sie in der Scaleway-Konsole zu **PostgreSQL**.
2. Klicken Sie auf **Create a Database Instance**.
3. Wählen Sie eine Region (z. B. Paris – `PAR1`).
4. Wählen Sie einen Node-Typ (**Play2-Pico** oder **Pro2-XXS** eignen sich gut).
5. Fügen Sie einen Datenbanknamen (`rebase_db`) und ein starkes Benutzerpasswort hinzu.
6. Notieren Sie sich nach der Bereitstellung den **Connection string** (URI) aus dem Dashboard:
   `postgres://user:password@ip:port/rebase_db`

Wenn Ihre Tabellen eine `col.vector()`-Spalte deklarieren, aktivieren Sie die Erweiterung einmalig: `CREATE EXTENSION vector;` in der Datenbank.

## 2. Bauen Sie das Bundle und integrieren Sie es in ein Image

Es muss **kein Anwendungs-Image aus Ihrem Quellcode gebaut werden**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Tabellen, Funktionen, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend. Das veröffentlichte Runtime-Image führt dieses aus:

```bash
rebase build
```

Serverless Containers bezieht Images aus einer Registry, betten Sie das Bundle daher in ein abgeleitetes Image ein. Drei Zeilen, und es legt genau fest, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Gehen Sie in der Scaleway-Konsole zu **Container Registry** und erstellen Sie einen Namespace (z. B. `rebase-apps`).
2. Melden Sie sich von Ihrem Terminal aus bei der Registry an, indem Sie den dort angezeigten Anweisungen folgen.
3. Bauen und pushen Sie das Image aus dem Projekt-Stammverzeichnis:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Ein späteres Upgrade von Rebase ist lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

## 3. Bereitstellen des Serverless Containers

1. Navigieren Sie zu **Serverless Containers**.
2. Klicken Sie auf **Create a Container**.
3. Wählen Sie das Image aus, das Sie gerade gepusht haben.
4. Setzen Sie den Port auf **8080** – der Port, auf dem das Runtime-Image standardmäßig lauscht, sofern `PORT` nichts anderes vorgibt.
5. Fügen Sie unter Environment Variables Folgendes hinzu:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Die URI aus Ihrem Managed Postgres-Schritt |
| `JWT_SECRET` | Eine sichere, zufällige Zeichenfolge mit mindestens 32 Zeichen zum Signieren von Authentifizierungs-Tokens |
| `REBASE_SERVICE_KEY` | Eine sichere, zufällige Zeichenfolge mit mindestens 32 Zeichen |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Ihre Frontend-Domain (z. B. `https://yourdomain.com`) |
| `FRONTEND_URL` | Ihre Frontend-URL (wird für E-Mail-Links und als CORS-Fallback verwendet) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | Die Adresse des ersten Administrators, festgelegt **vor dem ersten Start** |
| `REBASE_ADMIN_PASSWORD` | Mindestens 12 Zeichen |

Die letzten drei Variablen sind der Weg, wie dieses Deployment überhaupt einen Administrator erhält: In der Produktion wird das erste registrierte Konto nicht automatisch heraufgestuft, sodass auf anderem Wege kein erster authentifizierter Benutzer zustande kommt. Siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin). Markieren Sie die Secrets als geheime Umgebungsvariablen und nicht als Klartext.

6. Richten Sie den Health-Check auf `/livez` aus. Nicht auf `/health`: Letzterer führt einen Datenbank-Roundtrip aus, sodass ein Liveness-Probe darauf einen an sich gesunden Container während eines kurzen Datenbankaussetzers neu starten würde.
7. Klicken Sie auf **Deploy Container**.

Scaleway stellt den Container bereit und liefert Ihnen einen öffentlichen Endpunkt (z. B. `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Für eine strikte Daten-Compliance stellen Sie sicher, dass Ihre Scaleway-Organisationsdetails Ihr europäisches Unternehmensunternehmen widerspiegeln.*

## 4. Das Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Runtime erstellt fehlende Tabellen beim Systemstart, einschließlich der von `backend/schema` deklarierten.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` eingestellt, was additiv über das gesamte Schema hinweg agiert – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an –, sodass der erste Start gegen eine leere Datenbank sofort bereit ist, Ihre Collections bereitzustellen.

Was `ensure` niemals tut, ist das Ändern von etwas, das bereits existiert: Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine Bezeichnungen eines bestehenden Enums, da ein Container-Neustart das Schema nicht als Nebeneffekt eines Deployments umgestalten darf.

Eine Sache erfordert daher weiterhin die CLI, ausgeführt aus einem Checkout oder einem CI-Job, bei dem `DATABASE_URL` auf Ihre Managed Database zeigt:

```bash
rebase db push
```

Jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Datentyp, ein entferntes Feld.

Das Runtime-Image wird ohne die CLI ausgeliefert, sodass dies niemals innerhalb des Containers ausgeführt wird. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen Sie stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicherung

Serverless Containers haben keinen persistenten Datenträger, sodass lokale Dateispeicherung zu unbemerktem Datenverlust führt und von der Runtime in der Produktion verweigert wird. Scaleway Object Storage ist S3-kompatibel und befindet sich in denselben Rechenzentren:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Siehe [Speicher](/docs/backend/storage) für die vollständige Übersicht.

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Checkliste für den Produktivbetrieb und die Regeln für den ersten Admin, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) – alle Umgebungsvariablen, die die Runtime liest.
