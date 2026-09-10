---
sourceHash: c543c4d920d4a2f9
title: Bereitstellung von Rebase auf Scaleway
description: Erfahren Sie, wie Sie Rebase auf Scaleway für eine sichere, in Frankreich basierte Cloud-Infrastruktur mithilfe von Serverless Containers bereitstellen.
sidebar_label: Scaleway
---

Scaleway ist ein europäischer Cloud-Anbieter mit Sitz in Frankreich und Rechenzentren in Paris, Amsterdam und Warschau – eine ausgezeichnete Wahl für Organisationen, die Wert auf EU-Datensouveränität legen.

Nutzen Sie Scaleways **Managed Database** für Postgres und **Serverless Containers** für die Laufzeitumgebung.

Nichts auf dieser Seite bezüglich Ihres Projekts ist Scaleway-spezifisch. Ein Rebase-Deployment besteht aus zwei voneinander trennbaren Teilen – dem veröffentlichten Laufzeit-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm chart](/docs/deployment/kubernetes) und hier.

## 1. Eine Managed Postgres Database erstellen

1. Gehen Sie in der Scaleway-Konsole zu **PostgreSQL**.
2. Klicken Sie auf **Create a Database Instance**.
3. Wählen Sie eine Region (z. B. Paris – `PAR1`).
4. Wählen Sie einen Node-Typ (**Play2-Pico** oder **Pro2-XXS** eignen sich gut).
5. Fügen Sie einen Datenbanknamen (`rebase_db`) und ein sicheres Benutzerpasswort hinzu.
6. Notieren Sie sich nach der Bereitstellung den **Connection string** (URI) aus dem Dashboard:
   `postgres://user:password@ip:port/rebase_db`

Wenn Ihre Collections eine `vector`-Eigenschaft deklarieren, aktivieren Sie die Extension einmalig in der Datenbank: `CREATE EXTENSION vector;`.

## 2. Das Bundle erstellen und in ein Image einbetten

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Functions, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend. Das veröffentlichte Laufzeit-Image führt dieses aus:

```bash
rebase build
```

Serverless Containers pullt aus einer Registry, betten Sie das Bundle also in ein abgeleitetes Image ein. Drei Zeilen, und es legt genau fest, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

1. Gehen Sie in der Scaleway-Konsole zu **Container Registry** und erstellen Sie einen Namespace (z. B. `rebase-apps`).
2. Melden Sie sich über Ihr Terminal gemäß den dort angezeigten Anweisungen bei der Registry an.
3. Erstellen und pushen Sie das Image aus dem Projekt-Root-Verzeichnis:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Ein späteres Upgrade von Rebase ist lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

## 3. Den Serverless Container bereitstellen

1. Navigieren Sie zu **Serverless Containers**.
2. Klicken Sie auf **Create a Container**.
3. Wählen Sie das Image aus, das Sie gerade gepusht haben.
4. Setzen Sie den Port auf **8080** – der Port, auf dem das Laufzeit-Image lauscht, sofern `PORT` nichts anderes angibt.
5. Fügen Sie unter Environment Variables Folgendes hinzu:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Der URI aus dem Schritt für Ihre Managed Postgres |
| `JWT_SECRET` | Eine sichere, mindestens 32 Zeichen lange Zufallszeichenkette zum Signieren von Auth-Tokens |
| `REBASE_SERVICE_KEY` | Eine sichere, mindestens 32 Zeichen lange Zufallszeichenkette |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Ihre Frontend-Domain (z. B. `https://yourdomain.com`) |
| `FRONTEND_URL` | Ihre Frontend-URL (verwendet für E-Mail-Links und CORS-Fallback) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | Die Adresse des ersten Administrators, festgelegt **vor dem ersten Start** |
| `REBASE_ADMIN_PASSWORD` | Mindestens 12 Zeichen |

Über die letzten drei Variablen erhält dieses Deployment überhaupt erst einen Administrator: In der Produktion wird der erste registrierte Account nicht automatisch hochgestuft, sodass nichts anderes den ersten authentifizierten Aufrufer erzeugt. Siehe [Your first admin](/docs/getting-started/deployment/#your-first-admin). Kennzeichnen Sie die Secrets als geheime Umgebungsvariablen anstelle von Klartext-Variablen.

6. Richten Sie den Health-Check auf `/livez` aus. Nicht auf `/health`: Letzterer führt einen Datenbank-Roundtrip durch, sodass eine Liveness-Probe darauf einen gesunden Container bei einem kurzen Schluckauf der Datenbank neu starten würde.
7. Klicken Sie auf **Deploy Container**.

Scaleway stellt den Container bereit und vergibt einen öffentlichen Endpunkt (z. B. `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Überprüfen Sie für eine strikte Daten-Compliance, ob die Details Ihrer Scaleway-Organisation Ihre europäische juristische Person widerspiegeln.*

## 4. Das Schema

**Die Laufzeitumgebung erstellt fehlende Tabellen beim Start, einschließlich derer Ihrer Collections.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an –, sodass der erste Start mit einer leeren Datenbank direkt bereit ist, Ihre Collections bereitzustellen.

Was `ensure` niemals tut, ist das Ändern bereits vorhandener Elemente: Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine bestehenden Enum-Labels, da ein Neustart des Containers das Schema nicht als Nebeneffekt eines Deployments umstrukturieren darf.

Zwei Dinge erfordern daher weiterhin die CLI, ausgeführt aus einem Checkout oder einem CI-Job mit `DATABASE_URL` gerichtet auf Ihre Managed Database:

```bash
rebase db push
```

- **Junction-Table-RLS** für Many-to-Many-Beziehungen.
- **Jede Änderung, die nicht rein additiv ist** – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Das Laufzeit-Image wird ohne die CLI ausgeliefert, sodass dies niemals innerhalb des Containers ausgeführt wird. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Serverless Containers verfügen über keinen dauerhaften Speicher, sodass lokaler Dateispeicher zu lautlosem Datenverlust führt und von der Laufzeitumgebung in der Produktion verweigert wird. Scaleway Object Storage ist S3-kompatibel und befindet sich in denselben Rechenzentren:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Siehe [Storage](/docs/backend/storage) für die vollständige Übersicht.

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – Die Produktions-Checkliste und die Regeln für den ersten Administrator, die für jede Plattform gelten.
- [Configuration](/docs/getting-started/configuration) – Jede Umgebungsvariable, die von der Laufzeitumgebung gelesen wird.

---
