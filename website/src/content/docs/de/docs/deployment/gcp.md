---
sourceHash: 8d400239df61cbd4
title: Rebase auf der Google Cloud Platform bereitstellen
description: Stellen Sie Ihre Rebase-Instanz sicher auf der GCP mit Cloud SQL und Cloud Run bereit, mit Fokus auf EU-Rechenzentrumsregionen.
sidebar_label: Google Cloud
---

Die Google Cloud Platform (GCP) bietet eine nahtlose Developer Experience für containerisierte Anwendungen. Für ein robustes Produktions-Setup nutzen Sie **Cloud SQL** für die Datenbank und **Cloud Run** für die Runtime.

Um strenge europäische Datenschutzvorgaben einzuhalten, betreiben Sie alles vollständig in einer EU-Region wie **europe-west3 (Frankfurt)**, **europe-west9 (Paris)** oder **europe-west1 (Belgien)**.

Nichts auf dieser Seite bezüglich Ihres Projekts ist GCP-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm-Chart](/docs/deployment/kubernetes) und hier.

## 1. Cloud SQL (PostgreSQL) bereitstellen

1. Navigieren Sie in Ihrer bevorzugten EU-Region zur **Cloud SQL**-Konsole.
2. Klicken Sie auf **Instanz erstellen** und wählen Sie **PostgreSQL**.
3. Legen Sie Ihre Instanz-ID fest und generieren Sie ein sicheres Passwort für den Benutzer `postgres`.
4. Erweitern Sie die **Konfigurationsoptionen**, um einen Maschinentyp auszuwählen (zwei vCPUs sind ein guter Anfang).
5. Konfigurieren Sie eine private IP-Adresse oder ein autorisiertes öffentliches Netzwerk, je nachdem, wie Cloud Run darauf zugreifen soll.
6. Stellen Sie Ihre Verbindungs-URI zusammen:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Wenn Ihre Tabellen eine `col.vector()`-Spalte deklarieren, aktivieren Sie die Extension einmalig: `CREATE EXTENSION vector;` auf der Datenbank.

## 2. Bundle erstellen und in ein Image einbetten

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Tabellen, Funktionen, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend. Das veröffentlichte Runtime-Image führt es aus:

```bash
rebase build
```

Cloud Run bezieht Images aus einer Registry, betten Sie das Bundle also in ein abgeleitetes Image ein. Drei Zeilen, und es legt exakt fest, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
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

## 3. Auf Cloud Run bereitstellen

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

Cloud Run injiziert `PORT` und die Runtime bindet daran, sodass kein Port konfiguriert werden muss. Richten Sie den Startup-Probe auf `/livez` statt auf `/health` aus: Letzterer führt einen Roundtrip zur Datenbank durch, weshalb ein Liveness-Probe darauf eine fehlerfreie Revision bei einem kurzen Schluckauf der Datenbank neu starten würde.

Über `REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` erhält dieser Dienst überhaupt erst einen Administrator: In der Produktion wird das erste registrierte Konto nicht hochgestuft, sodass nichts anderes den ersten angemeldeten Benutzer erzeugt. Setzen Sie diese, bevor die erste Revision Traffic bedient – siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` ersetzt bei jedem Deploy den **gesamten** Umgebungsblock, sodass ein späterer Deploy, der eine Variable weglässt, diese stillschweigend entfernt. Behalten Sie die vollständige Liste in Ihrem Deploy-Skript bei.

Um eine private Cloud SQL-Instanz zu erreichen, sind `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` und eine Socket-basierte `DATABASE_URL` erforderlich; eine öffentliche Instanz mit einem autorisierten Netzwerk benötigt keines von beidem.

## 4. Das Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Runtime erstellt beim Start fehlende Tabellen, einschließlich derjenigen, die in `backend/schema` deklariert sind.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt – es erstellt fehlende Tabellen, Spalten sowie Enum-Typen und wendet deren Row-Level Security an – sodass der erste Start mit einer leeren Instanz direkt Ihre Tabellen bereitstellt.

Was `ensure` niemals tut, ist das Ändern von etwas, das bereits existiert: Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine Labels vorhandener Enums, da eine startende Revision ein Schema nicht als Nebeneffekt eines Deploys umgestalten darf.

Eine Sache erfordert daher nach wie vor das CLI, ausgeführt aus einem Checkout oder einem CI-Job:

```bash
rebase db push
```

Jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Verbinden Sie sich von Ihrem Rechner aus über den [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) und lassen Sie `DATABASE_URL` auf `localhost` zeigen. Das Runtime-Image wird ohne das CLI ausgeliefert, daher wird dies niemals innerhalb des Cloud Run-Containers ausgeführt. Für versionierte Migrationen committen Sie stattdessen Migrationsdateien mit `rebase db generate` und führen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Cloud Run-Instanzen sind zustandslos und flüchtig, daher bedeutet lokaler Dateispeicher stillen Datenverlust und die Runtime verweigert dies in der Produktion.

1. Erstellen Sie ein privates Google Cloud Storage-Bucket in Ihrer gewählten EU-Region.
2. Erstellen Sie einen HMAC-Schlüssel für ein Dienstkonto, das das Bucket nutzen kann (**Cloud Storage → Einstellungen → Interoperabilität**), und greifen Sie über dessen S3-kompatiblen Endpunkt auf das Bucket zu: `STORAGE_TYPE=s3`, `S3_BUCKET`, `S3_ENDPOINT=https://storage.googleapis.com`, `S3_REGION=auto` sowie der Schlüssel als `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` – siehe [Storage](/docs/backend/storage). `STORAGE_TYPE=gcs` lädt `@google-cloud/storage`, was im Runtime-Image nicht enthalten ist, und eine Kopie in Ihrem Bundle befindet sich nicht auf dessen Resolution-Pfad.

:::caution
Cloud Run skaliert auf null. Wenn Ihr Projekt Echtzeit-Abonnements verwendet, setzen Sie `--min-instances 1` – WebSocket-Verbindungen werden beendet, wenn eine Instanz herunterskaliert wird.
:::

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Produktions-Checkliste und die Regeln für den ersten Administrator, die für jede Plattform gelten.
- [Konfiguration](/docs/getting-started/configuration) – alle Umgebungsvariablen, die die Runtime liest.
