---
sourceHash: e902dc7a4aad0fa2
title: Bereitstellung von Rebase auf der Google Cloud Platform
description: Stellen Sie Ihre Rebase-Instanz sicher auf GCP mithilfe von Cloud SQL und Cloud Run bereit, mit Fokus auf EU-Rechenzentrumsregionen.
sidebar_label: Google Cloud
---

Die Google Cloud Platform (GCP) bietet eine nahtlose Developer Experience für containerisierte Anwendungen. Verwenden Sie für ein robustes Produktions-Setup **Cloud SQL** für die Datenbank und **Cloud Run** für die Runtime.

Um strenge europäische Datenschutzvorgaben einzuhalten, betreiben Sie alles vollständig innerhalb einer EU-Region wie **europe-west3 (Frankfurt)**, **europe-west9 (Paris)** oder **europe-west1 (Belgien)**.

Nichts auf dieser Seite ist für Ihr Projekt GCP-spezifisch. Ein Rebase-Deployment besteht aus zwei voneinander trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und hier.

## 1. Cloud SQL (PostgreSQL) bereitstellen

1. Navigieren Sie in Ihrer bevorzugten EU-Region zur **Cloud SQL**-Konsole.
2. Klicken Sie auf **Create Instance** und wählen Sie **PostgreSQL**.
3. Legen Sie Ihre Instanz-ID fest und generieren Sie ein sicheres Passwort für den Benutzer `postgres`.
4. Erweitern Sie die **Configuration Options**, um einen Maschinentyp auszuwählen (zwei vCPUs sind ein guter Anfang).
5. Konfigurieren Sie eine private IP oder ein autorisiertes öffentliches Netzwerk, je nachdem, wie Cloud Run darauf zugreifen soll.
6. Setzen Sie Ihre Verbindungs-URI zusammen:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Wenn Ihre Collections eine `vector`-Eigenschaft deklarieren, aktivieren Sie die Extension einmalig in der Datenbank: `CREATE EXTENSION vector;`.

## 2. Das Bundle bauen und in ein Image integrieren

Es muss **kein Anwendungs-Image aus Ihrem Quellcode gebaut werden**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Functions, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem gebauten Frontend. Das veröffentlichte Runtime-Image führt dies aus:

```bash
rebase build
```

Cloud Run pullt aus einer Registry. Betten Sie das Bundle daher in ein abgeleitetes Image ein. Drei Zeilen genügen, um exakt festzulegen, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.19.1
COPY dist-bundle /bundle
```

```bash
# Set your active GCP project
gcloud config set project YOUR_PROJECT_ID

# Create an Artifact Registry repository (one-time)
gcloud artifacts repositories create rebase --repository-format=docker --location=europe-west3

# Authenticate Docker to Artifact Registry (one-time)
gcloud auth configure-docker europe-west3-docker.pkg.dev

# Build from the project root and push
docker build -t europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest .
docker push europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest
```

Ein späteres Upgrade von Rebase erfordert lediglich eine Änderung dieser `FROM`-Zeile. Ihr Bundle bleibt unberührt.

## 3. Auf Cloud Run deployen

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

Cloud Run injiziert `PORT` und die Runtime bindet sich daran, sodass kein Port konfiguriert werden muss. Richten Sie die Startup Probe auf `/livez` statt auf `/health` aus: Letzteres führt einen Datenbank-Roundtrip durch, weshalb eine Liveness Probe darauf eine ansonsten intakte Revision bei einem kurzen Datenbankaussetzer neu starten würde.

Über `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` erhält dieser Dienst überhaupt erst einen Administrator: In der Produktion wird das erste registrierte Konto nicht automatisch hochgestuft, sodass es sonst keine Möglichkeit gibt, den ersten angemeldeten Aufrufer zu erstellen. Setzen Sie diese Variablen, bevor die erste Revision Traffic verarbeitet – siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` ersetzt bei jedem Deploy den **gesamten** Block der Umgebungsvariablen. Ein späteres Deployment, das eine Variable weglässt, entfernt diese also stillschweigend. Behalten Sie die vollständige Liste in Ihrem Deploy-Skript bei.

Um eine private Cloud SQL-Instanz zu erreichen, sind `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` und eine Socket-basierte `DATABASE_URL` erforderlich; eine öffentliche Instanz mit einem autorisierten Netzwerk benötigt keines von beidem.

## 4. Das Schema

**Die Runtime erstellt fehlende Tabellen beim Booten, einschließlich derer Ihrer Collections.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt – es erstellt fehlende Tabellen, Spalten sowie Enum-Typen und wendet deren Row-Level Security an –, sodass der erste Start mit einer leeren Instanz direkt bereit ist, Ihre Collections bereitzustellen.

Was `ensure` niemals tut, ist das Ändern bereits vorhandener Elemente: Es verändert weder Spaltentypen noch löscht es irgendetwas oder bearbeitet bestehende Enum-Labels, da eine startende Revision das Schema nicht als Nebeneffekt eines Deploys umstrukturieren darf.

Zwei Dinge erfordern daher weiterhin das CLI, ausgeführt aus einem Checkout oder einem CI-Job:

```bash
rebase db push
```

- **Junction-Table-RLS** für Many-to-Many-Relationen.
- **Jede Änderung, die nicht rein additiv ist** – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Verbinden Sie sich von Ihrem Rechner aus über den [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) und richten Sie `DATABASE_URL` auf `localhost`. Das Runtime-Image wird ohne das CLI ausgeliefert, sodass dies niemals innerhalb des Cloud Run-Containers ausgeführt wird. Für versionierte Migrationen committen Sie stattdessen Migrationsdateien mit `rebase db generate` und führen Sie `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Cloud Run-Instanzen sind zustandslos und flüchtig. Lokale Dateispeicherung führt daher zu unbemerktem Datenverlust, weshalb die Runtime dies in der Produktion verweigert.

1. Erstellen Sie einen privaten Google Cloud Storage Bucket in Ihrer gewählten EU-Region.
2. Setzen Sie `STORAGE_TYPE=gcs` und den dazugehörigen Bucket – siehe [Storage](/docs/backend/storage). Auf Cloud Run stellt das standardmäßige Dienstkonto (Service Account) die Anmeldedaten bereit, sodass nichts weiter konfiguriert werden muss.

:::caution
Cloud Run skaliert auf null. Wenn Ihr Projekt Realtime-Subscriptions nutzt, setzen Sie `--min-instances 1` – WebSocket-Verbindungen werden getrennt, wenn eine Instanz herunterskaliert wird.
:::

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Produktions-Checkliste und die First-Admin-Regeln, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) – jede Umgebungsvariable, die die Runtime einliest.
