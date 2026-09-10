---
sourceHash: d1312f112637705d
title: Rebase auf AWS bereitstellen
description: Stellen Sie Ihre Rebase-Instanz sicher auf Amazon Web Services unter Verwendung von RDS und AWS App Runner mit einem starken europäischen Fokus bereit.
sidebar_label: AWS
---

Amazon Web Services (AWS) bietet enorme Skalierbarkeit und Sicherheit auf Enterprise-Niveau. Für ein produktives Rebase-Deployment empfehlen wir die Entkopplung der Architektur, indem **Amazon RDS** für die PostgreSQL-Datenbank und **AWS App Runner** (oder ECS Fargate) für die Bereitstellung der Runtime verwendet werden.

Um strikte europäische Datenschutzvorgaben einzuhalten, stellen Sie sicher, dass Sie vollständig innerhalb einer EU-Region agieren, wie etwa **eu-central-1 (Frankfurt)**, **eu-west-1 (Irland)** oder **eu-west-3 (Paris)**.

Nichts auf dieser Seite bezüglich Ihres Projekts ist AWS-spezifisch. Ein Rebase-Deployment besteht aus zwei voneinander trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt. Dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und hier. Der Wechsel dazwischen ist eine Änderung der Infrastruktur, nicht der Anwendung.

## 1. Amazon RDS (PostgreSQL) bereitstellen

1. Navigieren Sie zur **RDS**-Konsole in Ihrer ausgewählten EU-Region.
2. Klicken Sie auf **Create database** und wählen Sie **Standard create**.
3. Wählen Sie die **PostgreSQL**-Engine.
4. Wählen Sie unter „Templates“ je nach Auslastung **Production** oder **Free tier/Dev**.
5. Erstellen Sie einen Master Username (z. B. `rebase_admin`) und generieren Sie ein sicheres Master Password.
6. Stellen Sie unter „Connectivity“ sicher, dass sich die Datenbank in einer **VPC** befindet, auf die Ihre zukünftige App Runner-Instanz sicher zugreifen kann (oder machen Sie sie öffentlich zugänglich, wenn Sie die Ingress-IP-Bereiche streng kontrollieren).
7. Sobald die Datenbank bereitgestellt ist, notieren Sie die **Endpoint address** und setzen Sie Ihren URI zusammen:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Wenn Ihre Collections eine `vector`-Eigenschaft deklarieren, benötigt die Instanz die `pgvector`-Erweiterung – RDS liefert diese mit, sie muss jedoch einmalig für die Datenbank aktiviert werden: `CREATE EXTENSION vector;`.

## 2. Bundle erstellen und in ein Image einbetten

Es muss **kein Anwendungs-Image aus Ihrem Quellcode gebaut werden**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Functions, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem gebauten Frontend. Das veröffentlichte Runtime-Image führt dies aus:

```bash
rebase build
```

Für App Runner, das Images aus einer Registry bezieht, betten Sie das Bundle in ein abgeleitetes Image ein. Das sind drei Zeilen und legt exakt fest, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

1. Navigieren Sie zu **Elastic Container Registry** und erstellen Sie ein privates Repository namens `rebase-backend`.
2. Nutzen Sie die Push-Befehle, die AWS in der Konsole anzeigt – diese übernehmen die Docker-Authentifizierung.
3. Bauen und pushen Sie das Image vom Projekt-Root aus:
   ```bash
   docker build -t rebase-backend .
   ```
4. Taggen und pushen Sie es in Ihr ECR-Repository.

Ein späteres Upgrade von Rebase ist lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt, und nichts an Ihrem Projekt wird neu gebaut.

## 3. Bereitstellung über AWS App Runner

App Runner ist der einfachste Weg, Container auf AWS auszuführen, ohne Orchestratoren verwalten zu müssen.

1. Navigieren Sie zu **AWS App Runner** und klicken Sie auf **Create service**.
2. Wählen Sie **Container registry** und entscheiden Sie sich für **Amazon ECR**.
3. Suchen und wählen Sie Ihr `rebase-backend`-Image aus.
4. Setzen Sie unter **Service settings** den Port auf **8080** – der Port, auf dem das Runtime-Image lauscht, sofern `PORT` nichts anderes vorgibt.
5. Setzen Sie den Pfad für den **Health Check** auf `/livez`. Nicht `/health`: dieser führt einen Datenbank-Roundtrip durch, sodass ein Liveness Probe darauf einen vollkommen gesunden Service während eines kurzen Datenbank-Schluckaufs neu starten würde.
6. Fügen Sie die Umgebungsvariablen hinzu:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Ihr RDS-Verbindungsstring |
| `JWT_SECRET` | Ein sicherer, zufällig generierter String (32+ Zeichen) |
| `REBASE_SERVICE_KEY` | Ein sicherer, zufällig generierter String (32+ Zeichen) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Ihre Frontend-Domain (z. B. `https://yourdomain.com`) |
| `FRONTEND_URL` | Ihre Frontend-URL (verwendet für E-Mail-Links und CORS-Fallback) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | Die Adresse des ersten Administrators, festgelegt **vor dem ersten Start** |
| `REBASE_ADMIN_PASSWORD` | Mindestens 12 Zeichen |

Die letzten drei Variablen bestimmen, wie dieses Deployment überhaupt einen Administrator erhält: Im Produktivbetrieb wird der erste registrierte Account nicht befördert, sodass auf anderem Weg kein erster angemeldeter Aufrufer entsteht. Siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin). Hinterlegen Sie die Secrets im AWS Secrets Manager und referenzieren Sie diese, anstatt sie direkt in das Konsolenformular einzutragen.

7. (Optional) Wenn Ihre RDS-Instanz strikt privat ist, konfigurieren Sie das **Custom VPC**-Networking in App Runner, damit der Container die Datenbank erreichen kann.
8. Klicken Sie auf **Create & deploy**.

AWS übernimmt die TLS-Terminierung und stellt Ihnen direkt eine `https`-URL bereit.

## 4. Das Schema

**Die Runtime erstellt fehlende Tabellen beim Start, einschließlich derer Ihrer Collections.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt – es erstellt fehlende Tabellen, Spalten sowie Enum-Typen und wendet deren Row-Level Security an –, sodass der erste Start gegen eine leere RDS-Instanz direkt mit Ihren Collections einsatzbereit ist.

Was `ensure` niemals tut, ist bestehende Strukturen zu verändern: Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine Labels bestehender Enums, da ein Container-Neustart das Schema niemals als Nebeneffekt eines Deployments umformen darf.

Zwei Dinge erfordern daher weiterhin die CLI, ausgeführt aus einem Checkout oder einem CI-Job mit auf RDS ausgerichteter `DATABASE_URL`:

```bash
rebase db push
```

- **Junction-Table-RLS** für Many-to-Many-Relationen.
- **Jede Änderung, die nicht rein additiv ist** – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Wenn die Instanz privat ist, führen Sie dies über CI oder einen Bastion-Host innerhalb derselben VPC aus. Das Runtime-Image wird ohne CLI ausgeliefert, weshalb dies niemals innerhalb des App Runner-Containers läuft. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen `rebase db migrate` stattdessen als Release-Schritt aus.

## Dateispeicher

App Runner-Instanzen verfügen über keinen persistenten Speicher, weshalb lokaler Dateispeicher zu schleichendem Datenverlust führt und von der Runtime in der Produktion verweigert wird. Erstellen Sie einen S3-Bucket in derselben Region und setzen Sie `STORAGE_TYPE=s3` mit dem entsprechenden Bucket und den Anmeldedaten – siehe [Speicher](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Produktions-Checkliste und die Regeln für den ersten Admin, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) – alle Umgebungsvariablen, die von der Runtime gelesen werden.

---
