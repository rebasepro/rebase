---
sourceHash: d9b167443cc3fd35
title: Bereitstellung von Rebase auf AWS
description: Stellen Sie Ihre Rebase-Instanz sicher auf Amazon Web Services bereit, indem Sie RDS und AWS App Runner mit einem starken europäischen Fokus nutzen.
sidebar_label: AWS
---

Amazon Web Services (AWS) bietet enorme Skalierbarkeit und Sicherheit auf Enterprise-Niveau. Für ein produktives Rebase-Deployment empfehlen wir die Entkopplung der Architektur durch den Einsatz von **Amazon RDS** für die PostgreSQL-Datenbank und **AWS App Runner** (oder ECS Fargate) für die Bereitstellung der Runtime.

Um strenge europäische Datenschutzvorgaben einzuhalten, stellen Sie sicher, dass Sie vollständig innerhalb einer EU-Region arbeiten, wie etwa **eu-central-1 (Frankfurt)**, **eu-west-1 (Irland)** oder **eu-west-3 (Paris)**.

Nichts auf dieser Seite ist für Ihr Projekt AWS-spezifisch. Ein Rebase-Deployment besteht aus zwei voneinander trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, auf Rebase Cloud, unter dem [Helm chart](/docs/deployment/kubernetes) und hier. Der Wechsel zwischen ihnen ist eine Änderung der Infrastruktur, nicht der Anwendung.

## 1. Amazon RDS (PostgreSQL) bereitstellen

1. Navigieren Sie in Ihrer ausgewählten EU-Region zur **RDS**-Konsole.
2. Klicken Sie auf **Create database** und wählen Sie **Standard create**.
3. Wählen Sie die **PostgreSQL**-Engine.
4. Wählen Sie unter Templates je nach Auslastung **Production** oder **Free tier/Dev**.
5. Erstellen Sie einen Master-Benutzernamen (z. B. `rebase_admin`) und generieren Sie ein sicheres Master-Passwort.
6. Stellen Sie unter Connectivity sicher, dass die Datenbank in einer **VPC** platziert wird, auf die Ihre zukünftige App Runner-Instanz sicher zugreifen kann (oder machen Sie sie öffentlich zugänglich, wenn Sie Ingress-IP-Bereiche streng kontrollieren).
7. Notieren Sie sich nach der Bereitstellung die **Endpoint address** und setzen Sie Ihre URI zusammen:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Wenn Ihre Tabellen eine `col.vector()`-Spalte deklarieren, benötigt die Instanz die `pgvector`-Erweiterung – RDS bringt sie mit, sie muss jedoch einmalig für die Datenbank aktiviert werden: `CREATE EXTENSION vector;`.

## 2. Das Bundle bauen und in ein Image einbinden

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Tabellen, Funktionen, Cronjobs und – falls Ihr Projekt eine statische App deklariert – Ihrem gebauten Frontend. Das veröffentlichte Runtime-Image führt dies aus:

```bash
rebase build
```

Für App Runner, das Images aus einer Registry bezieht, binden Sie das Bundle in ein abgeleitetes Image ein. Das sind lediglich drei Zeilen und legt exakt fest, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Navigieren Sie zu **Elastic Container Registry** und erstellen Sie ein privates Repository namens `rebase-backend`.
2. Übernehmen Sie die Push-Befehle, die AWS in der Konsole anzeigt – diese verwalten die Docker-Authentifizierung.
3. Bauen und pushen Sie das Image aus dem Projektstammverzeichnis:
   ```bash
   docker build -t rebase-backend .
   ```
4. Versehen Sie es mit einem Tag und pushen Sie es in Ihr ECR-Repository.

Ein späteres Upgrade von Rebase ist lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt, und an Ihrem Projekt wird nichts neu gebaut.

## 3. Über AWS App Runner bereitstellen

App Runner ist der einfachste Weg, Container auf AWS auszuführen, ohne Orchestratoren verwalten zu müssen.

1. Navigieren Sie zu **AWS App Runner** und klicken Sie auf **Create service**.
2. Wählen Sie **Container registry** und danach **Amazon ECR**.
3. Suchen und wählen Sie Ihr `rebase-backend`-Image aus.
4. Setzen Sie unter **Service settings** den Port auf **8080** – der Port, auf dem das Runtime-Image standardmäßig lauscht, sofern `PORT` nichts anderes festlegt.
5. Setzen Sie den Pfad für den **Health Check** auf `/livez`. Nicht `/health`: Letzterer führt einen Datenbank-Roundtrip durch, sodass ein Liveness-Probe darauf einen völlig gesunden Dienst bei einem kurzen Schluckauf der Datenbank neu starten würde.
6. Fügen Sie die Umgebungsvariablen hinzu:

| Schlüssel | Wert |
|-----|-------|
| `DATABASE_URL` | Ihr RDS-Verbindungs-String |
| `JWT_SECRET` | Ein sicherer, zufällig generierter String (32+ Zeichen) |
| `REBASE_SERVICE_KEY` | Ein sicherer, zufällig generierter String (32+ Zeichen) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Ihre Frontend-Domain (z. B. `https://yourdomain.com`) |
| `FRONTEND_URL` | Ihre Frontend-URL (für E-Mail-Links und als CORS-Fallback verwendet) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | Die Adresse des ersten Administrators, festgelegt **vor dem ersten Start** |
| `REBASE_ADMIN_PASSWORD` | Mindestens 12 Zeichen |

Über die letzten drei Variablen erhält dieses Deployment überhaupt erst einen Administrator: In der Produktion wird das erste registrierte Konto nicht automatisch hochgestuft, sodass andernfalls kein erster authentifizierter Benutzer zustande kommt. Siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin). Hinterlegen Sie die Secrets im AWS Secrets Manager und referenzieren Sie diese, anstatt sie direkt in das Formular der Konsole einzugeben.

7. (Optional) Wenn Ihre RDS-Instanz rein privat ist, konfigurieren Sie das **Custom VPC**-Networking in App Runner, damit der Container die Datenbank erreichen kann.
8. Klicken Sie auf **Create & deploy**.

AWS übernimmt die TLS-Terminierung, sodass Sie direkt eine `https`-URL erhalten.

## 4. Das Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Runtime erstellt fehlende Tabellen beim Start automatisch, einschließlich derer, die `backend/schema` deklariert.** `REBASE_MIGRATE_ON_BOOT` steht standardmäßig auf `ensure`, was sich im gesamten Schema additiv verhält – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an –, sodass der erste Start gegen eine leere RDS-Instanz direkt Ihre Tabellen bereitstellt.

Was `ensure` niemals tut, ist das Ändern bereits vorhandener Elemente: Es ändert keine Spaltentypen, löscht nichts und bearbeitet keine bestehenden Enum-Werte, da ein Container-Neustart ein Schema niemals als Nebeneffekt eines Deployments umstrukturieren darf.

Für einen Fall wird daher weiterhin das CLI benötigt, ausgeführt aus einem Checkout oder einem CI-Job mit auf RDS ausgerichteter `DATABASE_URL`:

```bash
rebase db push
```

Jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Datentyp, ein entferntes Feld.

Wenn die Instanz privat ist, führen Sie dies über CI oder einen Bastion-Host innerhalb derselben VPC aus. Das Runtime-Image wird ohne das CLI ausgeliefert, sodass dies niemals innerhalb des App Runner-Containers ausgeführt wird. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

App Runner-Instanzen besitzen keinen persistenten Festplattenspeicher; lokaler Dateispeicher führt daher zu unbemerktem Datenverlust, weshalb die Runtime ihn in der Produktion verweigert. Erstellen Sie einen S3-Bucket in derselben Region und setzen Sie `STORAGE_TYPE=s3` zusammen mit dem Bucket-Namen und den Zugangsdaten – siehe [Speicher](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Checkliste für den Produktivbetrieb und die Regeln für den ersten Administrator, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) – jede Umgebungsvariable, die von der Runtime gelesen wird.
