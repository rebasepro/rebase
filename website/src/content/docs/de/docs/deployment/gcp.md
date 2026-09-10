---
sourceHash: 0633ef5ec34074cf
title: Rebase auf der Google Cloud Platform bereitstellen
description: Stellen Sie Ihre Rebase-Instanz sicher auf GCP mit Cloud SQL und Cloud Run bereit, mit Fokus auf EU-Rechenzentrumsregionen.
sidebar_label: Google Cloud
---

Die Google Cloud Platform (GCP) bietet eine nahtlose Developer Experience für containerisierte Anwendungen. Verwenden Sie für ein robustes Produktions-Setup **Cloud SQL** als Datenbank und **Cloud Run** für die Runtime.

Um strenge europäische Datenschutzvorgaben einzuhalten, betreiben Sie alles vollständig innerhalb einer EU-Region wie **europe-west3 (Frankfurt)**, **europe-west9 (Paris)** oder **europe-west1 (Belgien)**.

Nichts auf dieser Seite ist für Ihr Projekt GCP-spezifisch. Ein Rebase-Deployment besteht aus zwei trennbaren Teilen – dem veröffentlichten Runtime-Image und dem **Bundle**, das `rebase build` erzeugt – und dasselbe Bundle läuft unter Docker Compose auf einem Laptop, auf Rebase Cloud, unter dem [Helm chart](/docs/deployment/kubernetes) sowie hier.

## 1. Cloud SQL (PostgreSQL) bereitstellen

1. Navigieren Sie in Ihrer bevorzugten EU-Region zur **Cloud SQL**-Konsole.
2. Klicken Sie auf **Instanz erstellen** und wählen Sie **PostgreSQL**.
3. Legen Sie Ihre Instanz-ID fest und generieren Sie ein sicheres Passwort für den `postgres`-Benutzer.
4. Erweitern Sie die **Konfigurationsoptionen**, um einen Maschinentyp auszuwählen (zwei vCPUs sind ein guter Anfang).
5. Konfigurieren Sie eine private IP oder ein autorisiertes öffentliches Netzwerk, je nachdem, wie Cloud Run darauf zugreift.
6. Stellen Sie Ihre Verbindungs-URI zusammen:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Wenn Ihre Collections eine `vector`-Eigenschaft deklarieren, aktivieren Sie die Extension einmalig in der Datenbank: `CREATE EXTENSION vector;`.

## 2. Bundle bauen und in ein Image einbetten

Es gibt **kein Anwendungs-Image, das aus Ihrem Quellcode gebaut werden muss**. `rebase build` erzeugt ein `dist-bundle`-Verzeichnis mit Ihren kompilierten Collections, Functions, Crons und – falls Ihr Projekt eine statische App deklariert – Ihrem gebauten Frontend. Das veröffentlichte Runtime-Image führt dieses aus:

```bash
rebase build
```

Cloud Run bezieht Images aus einer Registry, betten Sie das Bundle daher in ein abgeleitetes Image ein. Drei Zeilen, und es legt exakt fest, was ausgeführt wird:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
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

Cloud Run injiziert `PORT` und die Runtime bindet sich daran, sodass kein Port konfiguriert werden muss. Richten Sie den Startup-Probe auf `/livez` statt auf `/health` aus: Letzterer führt einen Datenbank-Roundtrip durch, weshalb ein Liveness-Probe darauf eine fehlerfreie Revision bei einem kurzen Schluckauf der Datenbank neu starten würde.

`REBASE_ADMIN_EMAIL` und `REBASE_ADMIN_PASSWORD` sind der Weg, wie dieser Dienst überhaupt einen Administrator erhält: In der Produktion wird das erste registrierte Konto nicht hochgestuft, sodass sonst nichts den ersten angemeldeten Aufrufer erzeugt. Setzen Sie diese, bevor die erste Revision Traffic verarbeitet – siehe [Ihr erster Admin](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` ersetzt bei jedem Deploy den **gesamten** Umgebungsblock, sodass ein späteres Deploy, das eine Variable weglässt, diese stillschweigend zurücksetzt. Behalten Sie die vollständige Liste in Ihrem Deploy-Skript bei.

Für den Zugriff auf eine private Cloud SQL-Instanz sind `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` und eine `DATABASE_URL` im Socket-Stil erforderlich; eine öffentliche Instanz mit einem autorisierten Netzwerk benötigt keines von beidem.

## 4. Das Schema

**Die Runtime erstellt beim Start fehlende Tabellen, einschließlich der Ihrer Collections.** `REBASE_MIGRATE_ON_BOOT` ist standardmäßig auf `ensure` gesetzt, was über das gesamte Schema hinweg additiv ist – es erstellt fehlende Tabellen, Spalten und Enum-Typen und wendet deren Row-Level-Security an –, sodass der erste Start mit einer leeren Instanz sofort Ihre Collections bereitstellt.

Was `ensure` niemals tut, ist das Ändern bereits vorhandener Elemente: Es verändert weder Spaltentypen, noch löscht es etwas oder bearbeitet Labels eines bestehenden Enums, da der Start einer Revision ein Schema niemals als Nebeneffekt eines Deploys umstrukturieren darf.

Zwei Dinge erfordern daher weiterhin die CLI, ausgeführt aus einem Checkout oder einem CI-Job:

```bash
rebase db push
```

- **Junction-Table-RLS** für Many-to-Many-Relationen.
- **Jede Änderung, die nicht rein additiv ist** – eine umbenannte Spalte, ein eingeschränkter Typ, ein entferntes Feld.

Verbinden Sie sich von Ihrem Rechner aus über den [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) und lassen Sie `DATABASE_URL` auf `localhost` zeigen. Das Runtime-Image wird ohne die CLI ausgeliefert, sodass dies niemals innerhalb des Cloud Run-Containers ausgeführt wird. Für versionierte Migrationen committen Sie Migrationsdateien mit `rebase db generate` und führen stattdessen `rebase db migrate` als Release-Schritt aus.

## Dateispeicher

Cloud Run-Instanzen sind zustandslos und flüchtig (ephemeral), daher führt lokaler Dateispeicher zu stillem Datenverlust, und die Runtime verweigert diesen im Produktionsbetrieb.

1. Erstellen Sie einen privaten Google Cloud Storage Bucket in Ihrer gewählten EU-Region.
2. Setzen Sie `STORAGE_TYPE=gcs` und den zugehörigen Bucket – siehe [Storage](/docs/backend/storage). Auf Cloud Run stellt das umgebende Service-Konto die Zugangsdaten bereit, sodass nichts weiter konfiguriert werden muss.

:::caution
Cloud Run skaliert auf null. Wenn Ihr Projekt Realtime-Subscriptions verwendet, setzen Sie `--min-instances 1` – WebSocket-Verbindungen werden beendet, wenn eine Instanz herunterskaliert wird.
:::

## Nächste Schritte

- [Deployment](/docs/getting-started/deployment) – die Produktions-Checkliste und die Regeln für den ersten Administrator, die für jede Plattform gelten.
- [Konfiguration](/docs/getting-started/configuration) – jede Umgebungsvariable, die von der Runtime gelesen wird.
