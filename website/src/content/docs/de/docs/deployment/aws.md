---
sourceHash: 2228ab84c888b578
title: Rebase auf AWS bereitstellen
description: Stellen Sie Ihre Rebase-Instanz sicher auf Amazon Web Services bereit, unter Verwendung von RDS und AWS App Runner mit starkem Fokus auf Europa.
sidebar_label: AWS
---

Amazon Web Services (AWS) bietet enorme Skalierbarkeit und Sicherheit auf Enterprise-Niveau. Für ein produktives Rebase-Deployment empfehlen wir, die Architektur zu entkoppeln, indem Sie **Amazon RDS** für die PostgreSQL-Datenbank und **AWS App Runner** (oder ECS Fargate) für die Ausführung der Runtime verwenden.

Um strenge europäische Datenschutzauflagen zu erfüllen, stellen Sie sicher, dass Sie vollständig innerhalb einer EU-Region arbeiten, wie z. B. **eu-central-1 (Frankfurt)**, **eu-west-1 (Irland)** oder **eu-west-3 (Paris)**.

Nichts auf dieser Seite ist anwendungsspezifisch für AWS. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und hier. Der Wechsel zwischen ihnen ist eine Änderung der Infrastruktur, nicht der Anwendung.

## 1. Amazon RDS (PostgreSQL) bereitstellen

1. Navigieren Sie in Ihrer ausgewählten EU-Region zur **RDS**-Konsole.
2. Klicken Sie auf **Create database** und wählen Sie **Standard create**.
3. Wählen Sie die Engine **PostgreSQL** aus.
4. Wählen Sie unter Templates je nach Auslastung **Production** oder **Free tier/Dev**.
5. Erstellen Sie einen Master-Benutzernamen (z. B. `rebase_admin`) und generieren Sie ein sicheres Master-Passwort.
6. Stellen Sie unter Connectivity sicher, dass sich die Datenbank in einer **VPC** befindet, auf die Ihre zukünftige App Runner-Instanz sicher zugreifen kann (oder machen Sie sie öffentlich zugänglich, falls Sie Ingress-IP-Bereiche streng kontrollieren).
7. Notieren Sie sich nach der Bereitstellung die **Endpoint-Adresse** und setzen Sie Ihre URI zusammen:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Wenn Ihre Collections eine `vector`-Eigenschaft deklarieren, benötigt die Instanz die `pgvector`-Erweiterung – RDS bringt diese mit, sie muss jedoch einmalig für die Datenbank aktiviert werden: `CREATE EXTENSION vector;`.

## 2. Das Bundle bauen und in ein Image integrieren

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Functions, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend. Das veröffentlichte Runtime-Image führt dieses aus:

```bash
rebase build
```

Für App Runner, das Images aus einer Registry bezieht, betten Sie das Bundle in ein abgeleitetes Image ein. Das sind drei Zeilen und legt exakt fest, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

1. Navigieren Sie zu **Elastic Container Registry** und erstellen Sie ein privates Repository namens `rebase-backend`.
2. Übernehmen Sie die Push-Befehle, die AWS in der Konsole anzeigt – diese übernehmen die Docker-Authentifizierung.
3. Führen Sie im Projektstammverzeichnis den Build- und Push-Vorgang durch:
   ```bash
   docker build -t rebase-backend .
   ```
4. Versehen Sie das Image mit einem Tag und pushen Sie es in Ihr ECR-Repository.

Ein späteres Upgrade von Rebase ist lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt, und an Ihrem Projekt muss nichts neu gebaut werden.

## 3. Bereitstellung über AWS App Runner

App Runner ist der einfachste Weg, Container auf AWS auszuführen, ohne Orchestratoren verwalten zu müssen.

1. Navigieren Sie zu **AWS App Runner** und klicken Sie auf **Create service**.
2. Wählen Sie **Container registry** und entscheiden Sie sich für **Amazon ECR**.
3. Suchen und wählen Sie Ihr `rebase-backend`-Image aus.
4. Setzen Sie unter **Service settings** den Port auf **8080** – der Port, auf dem das Runtime-Image standardmäßig lauscht, sofern `PORT` nichts anderes vorgibt.
5. Setzen Sie den Pfad für den **Health-Check** auf `/livez`. Nicht auf `/health`: Letzterer führt einen Datenbank-Roundtrip durch, sodass ein Liveness-Probe den Dienst bei einem kurzen Schluckauf der Datenbank neu starten würde, obwohl der Dienst vollkommen funktionstüchtig ist.
6. Fügen Sie die Umgebungsvariablen hinzu:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Ihr RDS-Verbindungs-String |
| `JWT_SECRET` | Eine sichere, zufällig generierte Zeichenkette (32+ Zeichen) |
| `REBASE_SERVICE_KEY` | Eine sichere, zufällig generierte Zeichenkette (32+ Zeichen) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Ihre Frontend-Domain (z. B. `https://yourdomain.com`) |
| `FRONTEND_URL` | Ihre Frontend-URL (verwendet für E-Mail-Links und CORS-Fallback) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | Die Adresse des ersten Administrators, festgelegt **vor dem ersten Start** |
| `REBASE_ADMIN_PASSWORD` | Mindestens 12 Zeichen |

Über die letzten drei Variablen erhält dieses Deployment überhaupt erst einen Administrator: Im Produktionsbetrieb wird das erste registrierte Konto nicht automatisch hochgestuft, sodass es sonst keine Möglichkeit gäbe, den ersten angemeldeten Aufrufer zu erzeugen. Siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin). Hinterlegen Sie die Secrets in AWS Secrets Manager und referenzieren Sie sie, anstatt sie direkt in das Konsolenformular einzugeben.

7. (Optional) Wenn Ihre RDS-Instanz streng privat ist, konfigurieren Sie das **Custom VPC**-Netzwerk in App Runner, damit der Container die Datenbank erreichen kann.
8. Klicken Sie auf **Create & deploy**.

AWS übernimmt die TLS-Terminierung und stellt Ihnen direkt eine `https`-URL zur Verfügung.

## 4. Das Schema

**Die Runtime erstellt fehlende Tabellen beim Start, einschließlich der Tabellen Ihrer Collections.** Standardmäßig ist `REBASE_MIGRATE_ON_BOOT` auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security (RLS) an –, sodass die Instanz bereits beim ersten Start gegen eine leere RDS-Datenbank Ihre Collections bereitstellt.

Was `ensure` niemals tut, ist das Ändern bereits vorhandener Elemente: Es ändert weder Spaltentypen noch löscht es etwas oder bearbeitet die Bezeichner eines bestehenden Enums, da ein Neustart des Containers das Schema niemals als Seiteneffekt eines Deployments umgestalten darf.

Für zwei Dinge wird daher weiterhin die CLI benötigt, ausgeführt aus einem Checkout oder einem CI-Job, bei dem `DATABASE_URL` auf RDS zeigt:

```bash
rebase db push
```

- **Junction-Table-RLS** für Many-to-Many-Beziehungen.
- **Jede Änderung, die nicht rein additiv ist** – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Wenn die Instanz privat ist, führen Sie dies über CI oder einen Bastion-Host innerhalb derselben VPC aus. Das Runtime-Image wird ohne CLI ausgeliefert, sodass dies niemals innerhalb des App Runner-Containers ausgeführt wird. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

App Runner-Instanzen verfügen über keinen persistenten Speicher; lokaler Dateispeicher führt daher zu unbemerktem Datenverlust, weshalb die Runtime dies in der Produktion verweigert. Erstellen Sie einen S3-Bucket in derselben Region und setzen Sie `STORAGE_TYPE=s3` zusammen mit den entsprechenden Bucket- und Zugangsdaten – siehe [Storage](/docs/backend/storage).

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Checkliste für den Produktivbetrieb und die First-Admin-Regeln, die für jede Plattform gelten.
- [Konfiguration](/docs/getting-started/configuration) – alle Umgebungsvariablen, die die Runtime einliest.

---
