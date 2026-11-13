---
sourceHash: 0664758f56d33104
title: Rebase auf Scaleway bereitstellen
description: Erfahren Sie, wie Sie Rebase auf Scaleway für eine sichere Cloud-Infrastruktur mit Sitz in Frankreich mithilfe von Serverless Containers bereitstellen.
sidebar_label: Scaleway
---

Scaleway ist ein europäischer Cloud-Anbieter mit Sitz in Frankreich und Rechenzentren in Paris, Amsterdam und Warschau – eine ausgezeichnete Wahl für Unternehmen und Organisationen, die Wert auf Datensouveränität in der EU legen.

Verwenden Sie Scaleways **Managed Database** für Postgres und **Serverless Containers** für die Runtime.

Nichts auf dieser Seite bezüglich Ihres Projekts ist Scaleway-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm chart](/docs/deployment/kubernetes) und hier.

## 1. Erstellen einer Managed Postgres Database

1. Gehen Sie in der Scaleway-Konsole zu **PostgreSQL**.
2. Klicken Sie auf **Create a Database Instance**.
3. Wählen Sie eine Region (z. B. Paris – `PAR1`).
4. Wählen Sie einen Node-Typ (**Play2-Pico** oder **Pro2-XXS** eignen sich gut).
5. Geben Sie einen Datenbanknamen (`rebase_db`) und ein starkes Benutzerpasswort ein.
6. Notieren Sie sich nach der Bereitstellung den **Connection string** (URI) aus dem Dashboard:
   `postgres://user:password@ip:port/rebase_db`

Wenn Ihre Tabellen eine `col.vector()`-Spalte deklarieren, aktivieren Sie die Extension einmalig in der Datenbank: `CREATE EXTENSION vector;`.

## 2. Das Bundle erstellen und in ein Image einbinden

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Tabellen, Funktionen, Cron-Jobs und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend. Das veröffentlichte Runtime-Image führt es aus:

```bash
rebase build
```

Serverless Containers zieht Images aus einer Registry, betten Sie das Bundle also in ein abgeleitetes Image ein. Drei Zeilen, und es legt genau fest, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Gehen Sie in der Scaleway-Konsole zu **Container Registry** und erstellen Sie einen Namespace (z. B. `rebase-apps`).
2. Melden Sie sich anhand der angezeigten Anweisungen über Ihr Terminal bei der Registry an.
3. Bauen und pushen Sie das Image aus dem Projekt-Root-Verzeichnis:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Ein späteres Upgrade von Rebase erfordert lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

## 3. Serverless Container bereitstellen

1. Navigieren Sie zu **Serverless Containers**.
2. Klicken Sie auf **Create a Container**.
3. Wählen Sie das Image aus, das Sie gerade gepusht haben.
4. Setzen Sie den Port auf **8080** – der Port, auf dem das Runtime-Image lauscht, sofern `PORT` nichts anderes festlegt.
5. Fügen Sie unter Environment Variables Folgendes hinzu:

| Key | Wert |
|-----|-------|
| `DATABASE_URL` | Die URI aus dem Schritt „Managed Postgres“ |
| `JWT_SECRET` | Eine sichere Zufallszeichenfolge mit mindestens 32 Zeichen zum Signieren von Auth-Tokens |
| `REBASE_SERVICE_KEY` | Eine sichere Zufallszeichenfolge mit mindestens 32 Zeichen |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Ihre Frontend-Domain (z. B. `https://yourdomain.com`) |
| `FRONTEND_URL` | Ihre Frontend-URL (wird für E-Mail-Links und den CORS-Fallback verwendet) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | Die Adresse des ersten Administrators, festgelegt **vor dem ersten Start** |
| `REBASE_ADMIN_PASSWORD` | Mindestens 12 Zeichen |

Über die letzten drei Variablen erhält dieses Deployment überhaupt erst einen Administrator: In der Produktion wird das erste registrierte Konto nicht automatisch heraufgestuft, sodass auf keinem anderen Weg der erste authentifizierte Aufrufer entsteht. Siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin). Markieren Sie Secrets als geheime Umgebungsvariablen und nicht als Klartextvariablen.

6. Richten Sie den Health Check auf `/livez` aus. Nicht auf `/health`: Letzterer führt einen Datenbank-Roundtrip durch, sodass ein Liveness-Probe darauf einen fehlerfreien Container bei einem kurzen Schluckauf der Datenbank neu starten würde.
7. Klicken Sie auf **Deploy Container**.

Scaleway stellt den Container bereit und stellt einen öffentlichen Endpunkt zur Verfügung (z. B. `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Überprüfen Sie für eine strikte Daten-Compliance, ob die Angaben zu Ihrer Scaleway-Organisation Ihre europäische Unternehmenseinheit widerspiegeln.*

## 4. Das Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Runtime erstellt fehlende Tabellen beim Start, einschließlich derjenigen, die in `backend/schema` deklariert sind.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt – es erstellt fehlende Tabellen, Spalten sowie Enum-Typen und wendet deren Row-Level Security an –, sodass beim ersten Start mit einer leeren Datenbank Ihre Tabellen sofort bereitstehen.

Was `ensure` niemals tut, ist etwas zu ändern, das bereits existiert: Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine Labels vorhandener Enums, da ein Neustart des Containers das Schema nicht als Nebeneffekt eines Deployments umgestalten darf.

Für eines wird daher weiterhin die CLI benötigt, ausgeführt aus einem Checkout oder einem CI-Job, bei dem `DATABASE_URL` auf Ihre Managed Database verweist:

```bash
rebase db push
```

Jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Das Runtime-Image wird ohne die CLI ausgeliefert, sodass dies niemals innerhalb des Containers ausgeführt wird. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen Sie stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Serverless Containers verfügen über keinen persistenten Speicher (Durable Disk), daher bedeutet lokaler Dateispeicher stillen Datenverlust und die Runtime verweigert diesen in der Produktion. Scaleway Object Storage ist S3-kompatibel und befindet sich in denselben Rechenzentren:

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
- [Konfiguration](/docs/getting-started/configuration) – jede Umgebungsvariable, die von der Runtime gelesen wird.
