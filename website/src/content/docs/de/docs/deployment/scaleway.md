---
sourceHash: 9674258588f75748
title: Rebase auf Scaleway bereitstellen
description: Erfahren Sie, wie Sie Rebase auf Scaleway für eine sichere, in Frankreich ansässige Cloud-Infrastruktur mit Serverless Containers bereitstellen.
sidebar_label: Scaleway
---

Scaleway ist ein europäischer Cloud-Anbieter mit Sitz in Frankreich und Rechenzentren in Paris, Amsterdam und Warschau – eine hervorragende Wahl für Organisationen, die Wert auf EU-Datensouveränität legen.

Verwenden Sie Scaleways **Managed Database** für Postgres und **Serverless Containers** für die Runtime.

Nichts auf dieser Seite ist für Ihr Projekt Scaleway-spezifisch. Ein Rebase-Deployment besteht aus zwei voneinander trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und hier.

## 1. Eine Managed Postgres-Datenbank erstellen

1. Gehen Sie in der Scaleway-Konsole zu **PostgreSQL**.
2. Klicken Sie auf **Create a Database Instance**.
3. Wählen Sie eine Region (z. B. Paris – `PAR1`).
4. Wählen Sie einen Node-Typ (**Play2-Pico** oder **Pro2-XXS** eignet sich gut).
5. Geben Sie einen Datenbanknamen (`rebase_db`) und ein sicheres Benutzerpasswort ein.
6. Notieren Sie sich nach der Bereitstellung die **Connection string** (URI) aus dem Dashboard:
   `postgres://user:password@ip:port/rebase_db`

Wenn Ihre Collections eine `vector`-Eigenschaft deklarieren, aktivieren Sie die Extension einmalig in der Datenbank: `CREATE EXTENSION vector;`.

## 2. Das Bundle erstellen und in ein Image integrieren

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Functions, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend. Das veröffentlichte Runtime-Image führt es aus:

```bash
rebase build
```

Serverless Containers pullt aus einer Registry, betten Sie das Bundle also in ein abgeleitetes Image ein. Drei Zeilen, und es legt genau fest, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.22.0
COPY dist-bundle /bundle
```

1. Gehen Sie in der Scaleway-Konsole zu **Container Registry** und erstellen Sie einen Namespace (z. B. `rebase-apps`).
2. Melden Sie sich anhand der angezeigten Anweisungen über Ihr Terminal bei der Registry an.
3. Bauen und pushen Sie aus dem Projekt-Root-Verzeichnis:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Ein späteres Upgrade von Rebase erfordert lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

## 3. Den Serverless Container bereitstellen

1. Navigieren Sie zu **Serverless Containers**.
2. Klicken Sie auf **Create a Container**.
3. Wählen Sie das Image aus, das Sie gerade gepusht haben.
4. Setzen Sie den Port auf **8080** – der Port, auf dem das Runtime-Image lauscht, sofern `PORT` nichts anderes festlegt.
5. Fügen Sie unter Environment Variables Folgendes hinzu:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Die URI aus dem Schritt zur Managed Postgres-Datenbank |
| `JWT_SECRET` | Eine sichere, zufällige Zeichenfolge mit mindestens 32 Zeichen zum Signieren von Auth-Tokens |
| `REBASE_SERVICE_KEY` | Eine sichere, zufällige Zeichenfolge mit mindestens 32 Zeichen |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Ihre Frontend-Domain (z. B. `https://yourdomain.com`) |
| `FRONTEND_URL` | Ihre Frontend-URL (wird für E-Mail-Links und als CORS-Fallback verwendet) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | Die Adresse des ersten Administrators, gesetzt **vor dem ersten Start** |
| `REBASE_ADMIN_PASSWORD` | Mindestens 12 Zeichen |

Über die letzten drei erhält dieses Deployment überhaupt erst einen Administrator: In der Produktionsumgebung wird das erste registrierte Konto nicht hochgestuft, sodass auf andere Weise kein erster authentifizierter Aufrufer entsteht. Siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin). Markieren Sie die Secrets als geheime Umgebungsvariablen statt als Klartext-Variablen.

6. Richten Sie den Health-Check auf `/livez` aus. Nicht auf `/health`: Dieser führt einen Datenbank-Roundtrip aus, weshalb ein Liveness-Probe darauf einen fehlerfreien Container bei einem kurzen Schluckauf der Datenbank neu starten würde.
7. Klicken Sie auf **Deploy Container**.

Scaleway stellt den Container bereit und liefert Ihnen einen öffentlichen Endpunkt (z. B. `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Für eine strikte Daten-Compliance sollten Sie sicherstellen, dass die Angaben zu Ihrer Scaleway-Organisation Ihre europäische Unternehmenseinheit widerspiegeln.*

## 4. Das Schema

**Die Runtime erstellt fehlende Tabellen beim Start, einschließlich der Tabellen Ihrer Collections.** Standardmäßig steht `REBASE_MIGRATE_ON_BOOT` auf `ensure`, was im gesamten Schema additiv arbeitet – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an –, sodass beim ersten Start mit einer leeren Datenbank sofort Ihre Collections bereitstehen.

Was `ensure` niemals tut, ist etwas bereits Vorhandenes zu ändern: Es ändert weder einen Spaltentyp, noch löscht es etwas oder bearbeitet die Labels eines bestehenden Enums, da ein Container-Neustart ein Schema nicht als Nebeneffekt eines Deployments umstrukturieren darf.

Für zwei Dinge ist daher weiterhin die CLI erforderlich, die aus einem lokalen Checkout oder einem CI-Job ausgeführt wird, wobei `DATABASE_URL` auf Ihre Managed Database verweist:

```bash
rebase db push
```

- **RLS für Verknüpfungstabellen (Junction Tables)** bei Many-to-Many-Relationen.
- **Jede Änderung, die nicht rein additiv ist** – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Das Runtime-Image wird ohne die CLI ausgeliefert, daher wird dies niemals innerhalb des Containers ausgeführt. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Serverless Containers besitzen keinen persistenten Speicherplatz, daher führt lokaler Dateispeicher zu unbemerktem Datenverlust, und die Runtime verweigert dies in der Produktionsumgebung. Scaleway Object Storage ist S3-kompatibel und befindet sich in denselben Rechenzentren:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Siehe [Storage](/docs/backend/storage) für alle Details.

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Produktions-Checkliste und die Regeln für den ersten Admin, die für alle Plattformen gelten.
- [Configuration](/docs/getting-started/configuration) – jede Umgebungsvariable, die die Runtime einliest.
