---
sourceHash: 93b3163dd1b482fd
title: Bereitstellung von Rebase auf AWS
description: Stellen Sie Ihre Rebase-Instanz sicher auf Amazon Web Services unter Verwendung von RDS und AWS App Runner mit starkem europäischem Fokus bereit.
sidebar_label: AWS
---

Amazon Web Services (AWS) bietet enorme Skalierbarkeit und Sicherheit auf Enterprise-Niveau. Für ein produktives Rebase-Deployment empfehlen wir, die Architektur zu entkoppeln, indem Sie **Amazon RDS** für die PostgreSQL-Datenbank und **AWS App Runner** (oder ECS Fargate) für die Bereitstellung der Runtime nutzen.

Um strenge europäische Datenschutzvorgaben einzuhalten, stellen Sie sicher, dass Sie vollständig innerhalb einer EU-Region agieren, wie beispielsweise **eu-central-1 (Frankfurt)**, **eu-west-1 (Irland)** oder **eu-west-3 (Paris)**.

Nichts auf dieser Seite ist für Ihr Projekt AWS-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, mit dem [Helm-Chart](/docs/deployment/kubernetes) und hier. Der Wechsel zwischen ihnen ist eine Änderung der Infrastruktur, nicht der Anwendung.

## 1. Amazon RDS (PostgreSQL) bereitstellen

1. Navigieren Sie in Ihrer ausgewählten EU-Region zur **RDS**-Konsole.
2. Klicken Sie auf **Create database** und wählen Sie **Standard create**.
3. Wählen Sie die **PostgreSQL**-Engine.
4. Wählen Sie unter Templates je nach Last **Production** oder **Free tier/Dev**.
5. Erstellen Sie einen Master-Benutzernamen (z. B. `rebase_admin`) und generieren Sie ein sicheres Master-Passwort.
6. Stellen Sie unter Connectivity sicher, dass sich die Datenbank innerhalb einer **VPC** befindet, auf die Ihre zukünftige App Runner-Instanz sicher zugreifen kann (oder machen Sie sie öffentlich zugänglich, wenn Sie die Ingress-IP-Bereiche strikt kontrollieren).
7. Notieren Sie sich nach der Bereitstellung die **Endpoint address** und stellen Sie Ihre URI zusammen:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Wenn Ihre Tabellen eine `col.vector()`-Spalte deklarieren, benötigt die Instanz die `pgvector`-Erweiterung – RDS liefert diese mit, sie muss jedoch einmalig für die Datenbank aktiviert werden: `CREATE EXTENSION vector;`.

## 2. Das Bundle bauen und in ein Image integrieren

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Tabellen, Funktionen, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend. Das veröffentlichte Runtime-Image führt dieses aus:

```bash
rebase build
```

Für App Runner, das Images aus einer Registry bezieht, betten Sie das Bundle in ein abgeleitetes Image ein. Das sind lediglich drei Zeilen und legt exakt fest, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Navigieren Sie zu **Elastic Container Registry** und erstellen Sie ein privates Repository namens `rebase-backend`.
2. Übernehmen Sie die Push-Befehle, die AWS in der Konsole anzeigt – diese übernehmen die Docker-Authentifizierung.
3. Bauen und pushen Sie aus dem Projekt-Root-Verzeichnis:
   ```bash
   docker build -t rebase-backend .
   ```
4. Versehen Sie es mit einem Tag und übertragen Sie es per Push in Ihr ECR-Repository.

Ein späteres Upgrade von Rebase erfordert lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt, und nichts an Ihrem Projekt muss neu gebaut werden.

## 3. Bereitstellung über AWS App Runner

App Runner ist der einfachste Weg, Container auf AWS auszuführen, ohne Orchestratoren verwalten zu müssen.

1. Navigieren Sie zu **AWS App Runner** und klicken Sie auf **Create service**.
2. Wählen Sie **Container registry** und anschließend **Amazon ECR**.
3. Suchen und wählen Sie Ihr `rebase-backend`-Image aus.
4. Setzen Sie unter **Service settings** den Port auf **8080** – der Port, auf dem das Runtime-Image standardmäßig lauscht, sofern `PORT` nichts anderes vorgibt.
5. Setzen Sie den Pfad für den **Health-Check** auf `/livez`. Nicht `/health`: Letzterer führt einen Datenbank-Roundtrip durch, sodass ein Liveness-Probe darauf einen vollkommen gesunden Dienst bei einem kurzen Schluckauf der Datenbank neu starten würde.
6. Fügen Sie die Umgebungsvariablen hinzu:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Ihre RDS-Verbindungszeichenfolge |
| `JWT_SECRET` | Eine sichere, zufällig generierte Zeichenfolge (32+ Zeichen) |
| `REBASE_SERVICE_KEY` | Eine sichere, zufällig generierte Zeichenfolge (32+ Zeichen) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Ihre Frontend-Domain (z. B. `https://yourdomain.com`) |
| `FRONTEND_URL` | Ihre Frontend-URL (wird für E-Mail-Links und als CORS-Fallback verwendet) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | Die Adresse des ersten Administrators, festgelegt **vor dem ersten Start** |
| `REBASE_ADMIN_PASSWORD` | Mindestens 12 Zeichen |

Über die letzten drei Einstellungen erhält dieses Deployment überhaupt erst einen Administrator: In der Produktion wird das erste registrierte Konto nicht automatisch hochgestuft, sodass sonst kein erster angemeldeter Aufrufer entsteht. Siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin). Hinterlegen Sie die Secrets im AWS Secrets Manager und referenzieren Sie diese, anstatt sie direkt in das Konsolenformular einzutippen.

7. (Optional) Wenn Ihre RDS-Instanz strikt privat ist, konfigurieren Sie das **Custom VPC**-Networking in App Runner, damit der Container die Datenbank erreichen kann.
8. Klicken Sie auf **Create & deploy**.

AWS übernimmt die TLS-Terminierung und stellt Ihnen direkt eine `https`-URL zur Verfügung.

## 4. Das Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Runtime erstellt beim Start fehlende Tabellen, einschließlich derjenigen, die von `backend/schema` deklariert werden.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was additiv über das gesamte Schema hinweg wirkt – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an –, sodass der erste Start mit einer leeren RDS-Instanz direkt bereit ist, Ihre Collections bereitzustellen.

Was `ensure` niemals tut, ist etwas zu ändern, das bereits existiert: Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine bestehenden Enum-Werte, da ein Container-Neustart das Schema nicht als Nebeneffekt eines Deployments umgestalten darf.

Für eine Sache wird daher weiterhin die CLI benötigt, ausgeführt aus einem Checkout oder einem CI-Job mit auf RDS ausgerichteter `DATABASE_URL`:

```bash
rebase db push
```

Jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Wenn die Instanz privat ist, führen Sie dies über CI oder einen Bastion-Host innerhalb derselben VPC aus. Das Runtime-Image wird ohne die CLI ausgeliefert, sodass dies niemals innerhalb des App Runner-Containers ausgeführt wird. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

App Runner-Instanzen verfügen über keinen persistenten Speicher (durable disk). Lokale Dateispeicherung führt daher zu unbemerktem Datenverlust, weshalb die Runtime dies in der Produktion verweigert. Erstellen Sie einen S3-Bucket in derselben Region und setzen Sie `STORAGE_TYPE=s3` zusammen mit dem Bucket-Namen und den Zugangsdaten – siehe [Speicher](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Checkliste für den Produktivbetrieb und die Regeln für den ersten Administrator, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) – jede Umgebungsvariable, die von der Runtime gelesen wird.
