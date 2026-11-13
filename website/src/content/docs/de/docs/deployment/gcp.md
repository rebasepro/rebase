---
sourceHash: 0632063aadcff623
title: Bereitstellung von Rebase auf der Google Cloud Platform
description: Stellen Sie Ihre Rebase-Instanz sicher auf GCP mit Cloud SQL und Cloud Run bereit, mit Fokus auf EU-Rechenzentrumsregionen.
sidebar_label: Google Cloud
---

Die Google Cloud Platform (GCP) bietet eine nahtlose Developer Experience für containerisierte Anwendungen. Für ein robustes Produktions-Setup nutzen Sie **Cloud SQL** für die Datenbank und **Cloud Run** für die Runtime.

Um eine strikte europäische Daten-Compliance zu gewährleisten, betreiben Sie alles vollständig innerhalb einer EU-Region wie **europe-west3 (Frankfurt)**, **europe-west9 (Paris)** oder **europe-west1 (Belgien)**.

Nichts auf dieser Seite an Ihrem Projekt ist GCP-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, in der Rebase Cloud, unter dem [Helm chart](/docs/deployment/kubernetes) und hier.

## 1. Cloud SQL (PostgreSQL) bereitstellen

1. Navigieren Sie zur **Cloud SQL**-Konsole in Ihrer bevorzugten EU-Region.
2. Klicken Sie auf **Instanz erstellen** und wählen Sie **PostgreSQL**.
3. Legen Sie Ihre Instanz-ID fest und generieren Sie ein sicheres Passwort für den Benutzer `postgres`.
4. Erweitern Sie die **Konfigurationsoptionen**, um einen Maschinentyp auszuwählen (zwei vCPUs sind ein guter Anfang).
5. Konfigurieren Sie eine private IP oder ein autorisiertes öffentliches Netzwerk, je nachdem, wie Cloud Run die Instanz erreichen wird.
6. Setzen Sie Ihre Verbindungs-URI zusammen:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Wenn Ihre Tabellen eine `col.vector()`-Spalte deklarieren, aktivieren Sie die Extension einmalig in der Datenbank: `CREATE EXTENSION vector;`.

## 2. Das Bundle bauen und in ein Image einbinden

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Tabellen, Funktionen, Cronjobs und – falls Ihr Projekt eine statische App deklariert – Ihrem erstellten Frontend. Das veröffentlichte Runtime-Image führt dieses aus:

```bash
rebase build
```

Cloud Run zieht Images aus einer Registry, betten Sie das Bundle daher in ein abgeleitetes Image ein. Drei Zeilen, und es legt genau fest, was ausgeführt wird:

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

## 3. Auf Cloud Run deployen

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

Cloud Run injiziert `PORT` und die Runtime bindet sich daran, sodass kein Port konfiguriert werden muss. Richten Sie den Startup-Probe auf `/livez` statt auf `/health` aus: Letzterer führt einen Datenbank-Roundtrip durch, sodass ein Liveness-Probe darauf eine fehlerfreie Revision bei einem kurzen Schluckauf der Datenbank neu starten würde.

`REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` sind die Art und Weise, wie dieser Dienst überhaupt einen Administrator erhält: In der Produktion wird das erste registrierte Konto nicht hochgestuft, sodass nichts anderes den ersten angemeldeten Aufrufer erzeugt. Setzen Sie diese, bevor die erste Revision Traffic verarbeitet – siehe [Ihr erster Administrator](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` ersetzt bei jedem Deploy den **gesamten** Umgebungsblock, sodass ein späterer Deploy, der eine Variable auslässt, diese stillschweigend entfernt. Behalten Sie die vollständige Liste in Ihrem Deploy-Skript bei.

Um eine private Cloud SQL-Instanz zu erreichen, sind `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` und eine Socket-basierte `DATABASE_URL` erforderlich; eine öffentliche Instanz mit einem autorisierten Netzwerk benötigt keines von beiden.

## 4. Das Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Die Runtime erstellt fehlende Tabellen beim Booten, einschließlich derer, die `backend/schema` deklariert.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv wirkt – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level Security an –, sodass der erste Start mit einer leeren Instanz direkt bereit ist, Ihre Collections bereitzustellen.

Was `ensure` niemals tut, ist etwas zu ändern, das bereits existiert: Es ändert keinen Spaltentyp, löscht nichts und bearbeitet keine bestehenden Enum-Werte, da eine startende Revision ein Schema nicht als Nebeneffekt eines Deploys umgestalten darf.

Eine Sache erfordert daher weiterhin die CLI, ausgeführt aus einem Checkout oder einem CI-Job:

```bash
rebase db push
```

Jede Änderung, die nicht rein additiv ist – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Verbinden Sie sich von Ihrem Rechner aus über den [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) und lassen Sie `DATABASE_URL` auf `localhost` zeigen. Das Runtime-Image wird ohne die CLI ausgeliefert, daher wird dies niemals innerhalb des Cloud Run-Containers ausgeführt. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Cloud Run-Instanzen sind zustandslos und flüchtig, daher bedeutet lokaler Dateispeicher stillschweigenden Datenverlust, und die Runtime verweigert diesen in der Produktion.

1. Erstellen Sie einen privaten Google Cloud Storage Bucket in Ihrer gewählten EU-Region.
2. Erstellen Sie einen HMAC-Schlüssel für ein Dienstkonto, das den Bucket verwenden kann (**Cloud Storage → Einstellungen → Interoperabilität**), und greifen Sie über dessen S3-kompatiblen Endpunkt auf den Bucket zu: `STORAGE_TYPE=s3`, `S3_BUCKET`, `S3_ENDPOINT=https://storage.googleapis.com`, `S3_REGION=auto`, und der Schlüssel als `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` – siehe [Storage](/docs/backend/storage). `STORAGE_TYPE=gcs` lädt `@google-cloud/storage`, was im Runtime-Image nicht enthalten ist, und eine Kopie in Ihrem Bundle liegt nicht in dessen Resolution-Pfad.

:::caution
Cloud Run skaliert auf null. Wenn Ihr Projekt Realtime-Subscriptions verwendet, setzen Sie `--min-instances 1` – WebSocket-Verbindungen werden beendet, wenn eine Instanz herunterskaliert wird.
:::

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Produktions-Checkliste und die Regeln für den ersten Administrator, die für alle Plattformen gelten.
- [Konfiguration](/docs/getting-started/configuration) – alle Umgebungsvariablen, die die Runtime liest.
