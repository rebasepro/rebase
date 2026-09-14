---
sourceHash: 52e547096e56dc7e
title: Rebase auf AWS bereitstellen
description: Stellen Sie Ihre Rebase-Instanz sicher auf Amazon Web Services unter Verwendung von RDS und AWS App Runner mit starkem europäischem Fokus bereit.
sidebar_label: AWS
---

Amazon Web Services (AWS) bietet herausragende Skalierbarkeit und Sicherheit auf Enterprise-Niveau. Für ein produktives Rebase-Deployment empfehlen wir, die Architektur zu entkoppeln, indem Sie **Amazon RDS** für die PostgreSQL-Datenbank und **AWS App Runner** (oder ECS Fargate) für die Bereitstellung der Runtime nutzen.

Um strenge europäische Datenschutzauflagen einzuhalten, stellen Sie sicher, dass Sie vollständig innerhalb einer EU-Region agieren, wie etwa **eu-central-1 (Frankfurt)**, **eu-west-1 (Irland)** oder **eu-west-3 (Paris)**.

Nichts auf dieser Seite ist an Ihrem Projekt AWS-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm chart](/docs/deployment/kubernetes) und hier. Der Wechsel zwischen ihnen ist eine Änderung der Infrastruktur, nicht der Anwendung.

## 1. Amazon RDS (PostgreSQL) bereitstellen

1. Navigieren Sie zur **RDS**-Konsole in Ihrer ausgewählten EU-Region.
2. Klicken Sie auf **Create database** und wählen Sie **Standard create**.
3. Wählen Sie die Engine **PostgreSQL** aus.
4. Wählen Sie unter „Templates“ je nach Last **Production** oder **Free tier/Dev** aus.
5. Erstellen Sie einen Master-Benutzernamen (z. B. `rebase_admin`) und generieren Sie ein sicheres Master-Passwort.
6. Stellen Sie unter „Connectivity“ sicher, dass die Datenbank in einer **VPC** platziert ist, auf die Ihre zukünftige App-Runner-Instanz sicher zugreifen kann (oder machen Sie sie öffentlich zugänglich, wenn Sie die Ingress-IP-Bereiche streng kontrollieren).
7. Sobald sie bereitgestellt ist, notieren Sie sich die **Endpoint address** und erstellen Sie Ihre URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Wenn Ihre Collections eine `vector`-Eigenschaft deklarieren, benötigt die Instanz die Erweiterung `pgvector` – RDS liefert diese mit, sie muss jedoch einmalig für die Datenbank aktiviert werden: `CREATE EXTENSION vector;`.

## 2. Das Bundle erstellen und in ein Image einbetten

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Functions, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend. Das veröffentlichte Runtime-Image führt dieses aus:

```bash
rebase build
```

Für App Runner, das Images aus einer Registry bezieht, betten Sie das Bundle in ein abgeleitetes Image ein. Das sind lediglich drei Zeilen und legt exakt fest, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.21.0
COPY dist-bundle /bundle
```

1. Navigieren Sie zu **Elastic Container Registry** und erstellen Sie ein privates Repository namens `rebase-backend`.
2. Nutzen Sie die Push-Befehle, die AWS in der Konsole anzeigt – diese übernehmen die Docker-Authentifizierung.
3. Erstellen und pushen Sie aus dem Projekt-Root-Verzeichnis:
   ```bash
   docker build -t rebase-backend .
   ```
4. Versehen Sie das Image mit einem Tag und pushen Sie es in Ihr ECR-Repository.

Ein späteres Upgrade von Rebase erfordert lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt, und nichts an Ihrem Projekt muss neu gebaut werden.

## 3. Über AWS App Runner bereitstellen

App Runner ist der einfachste Weg, Container auf AWS auszuführen, ohne Orchestratoren verwalten zu müssen.

1. Navigieren Sie zu **AWS App Runner** und klicken Sie auf **Create service**.
2. Wählen Sie **Container registry** und danach **Amazon ECR** aus.
3. Suchen und wählen Sie Ihr `rebase-backend`-Image aus.
4. Setzen Sie unter **Service settings** den Port auf **8080** – der Port, auf dem das Runtime-Image lauscht, sofern `PORT` nichts anderes vorgibt.
5. Setzen Sie den Pfad für den **Health Check** auf `/livez`. Nicht `/health`: dieser führt einen Datenbank-Roundtrip durch, sodass ein Liveness-Probe darauf bei einem kurzen Datenbankproblem einen völlig fehlerfreien Dienst neu starten würde.
6. Fügen Sie die Umgebungsvariablen hinzu:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Ihre RDS-Verbindungszeichenfolge |
| `JWT_SECRET` | Eine sichere zufällig generierte Zeichenkette (32+ Zeichen) |
| `REBASE_SERVICE_KEY` | Eine sichere zufällig generierte Zeichenkette (32+ Zeichen) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Ihre Frontend-Domain (z. B. `https://yourdomain.com`) |
| `FRONTEND_URL` | Ihre Frontend-URL (wird für E-Mail-Links und als CORS-Fallback verwendet) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | Die Adresse des ersten Administrators, festgelegt **vor dem ersten Start** |
| `REBASE_ADMIN_PASSWORD` | Mindestens 12 Zeichen |

Über die letzten drei Variablen erhält dieses Deployment überhaupt erst einen Administrator: In der Produktionsumgebung wird das erste registrierte Konto nicht automatisch hochgestuft, sodass andernfalls kein authentifizierter Erstbenutzer existiert. Siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin). Hinterlegen Sie die Secrets im AWS Secrets Manager und referenzieren Sie diese, anstatt sie direkt in das Konsolenformular einzutragen.

7. (Optional) Wenn Ihre RDS-Instanz strikt privat ist, konfigurieren Sie das **Custom VPC**-Netzwerk in App Runner, damit der Container die Datenbank erreichen kann.
8. Klicken Sie auf **Create & deploy**.

AWS übernimmt die TLS-Terminierung und stellt Ihnen direkt eine `https`-URL zur Verfügung.

## 4. Das Schema

**Die Runtime erstellt beim Start fehlende Tabellen, einschließlich derer Ihrer Collections.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was additiv auf das gesamte Schema wirkt – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an –, sodass der erste Start gegen eine leere RDS-Instanz direkt Ihre Collections bereitstellt.

Was `ensure` niemals tut, ist das Ändern bereits vorhandener Elemente: Es verändert weder Spaltentypen noch löscht es etwas oder bearbeitet die Labels eines bestehenden Enums, da ein Container-Neustart ein Schema niemals als Nebeneffekt eines Deployments umstrukturieren darf.

Zwei Dinge erfordern daher weiterhin die CLI, ausgeführt aus einem Checkout oder einem CI-Job mit `DATABASE_URL` auf RDS gerichtet:

```bash
rebase db push
```

- **Junction-Table-RLS** für Many-to-Many-Relationen.
- **Jede Änderung, die nicht rein additiv ist** – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Wenn die Instanz privat ist, führen Sie dies über CI oder einen Bastion-Host innerhalb derselben VPC aus. Das Runtime-Image wird ohne die CLI ausgeliefert, sodass dies niemals innerhalb des App-Runner-Containers ausgeführt wird. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

App-Runner-Instanzen besitzen keinen persistenten Speicherplatz, daher führt lokaler Dateispeicher zu stillem Datenverlust und wird von der Runtime in der Produktionsumgebung verweigert. Erstellen Sie einen S3-Bucket in derselben Region und setzen Sie `STORAGE_TYPE=s3` zusammen mit den entsprechenden Bucket- und Zugangsdaten – siehe [Storage](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Checkliste für die Produktion und die Regeln für den ersten Administrator, die für alle Plattformen gelten.
- [Configuration](/docs/getting-started/configuration) – alle Umgebungsvariablen, die die Runtime einliest.
