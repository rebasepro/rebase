---
title: Rebase auf Google Cloud Platform bereitstellen
description: Stellen Sie Ihre Rebase-Instanz sicher auf GCP bereit, indem Sie Cloud SQL und Cloud Run nutzen, mit Fokus auf EU-Rechenzentrumsregionen.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) bietet eine unglaublich nahtlose Entwicklererfahrung für containerisierte Anwendungen. Für ein robustes Produktions-Setup nutzen wir **Cloud SQL** für die Datenbank und **Cloud Run** als serverloses Container-Grundgerüst.

Um die strikte europäische Datenkonformität zu gewährleisten, stellen Sie sicher, dass Sie vollständig innerhalb einer EU-Region operieren, wie zum Beispiel **europe-west3 (Frankfurt)**, **europe-west9 (Paris)** oder **europe-west1 (Belgien)**.

## 1. Cloud SQL (PostgreSQL) bereitstellen

1. Navigieren Sie zur **Cloud SQL**-Konsole in Ihrer bevorzugten EU-Region.
2. Klicken Sie auf **Instanz erstellen** und wählen Sie **PostgreSQL** aus.
3. Legen Sie Ihre Instanz-ID fest und generieren Sie ein sicheres integriertes Passwort für den Benutzer `postgres`.
4. Erweitern Sie die **Konfigurationsoptionen**, um den korrekten Maschinentyp zuzuweisen (eine Standardmaschine mit 2 vCPUs ist ein guter Anfang).
5. Stellen Sie sicher, dass die Datenbank für private IP- oder autorisierte öffentliche IP-Netzwerke konfiguriert ist, abhängig von Ihrem VCP-Setup mit Cloud Run.
6. Stellen Sie Ihre Verbindungs-URI zusammen:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

## 2. Erstellen und Bereitstellen in Cloud Run

Cloud Run skaliert das Rebase Node.js-Backend bei Bedarf automatisch auf null herunter und übernimmt TLS sofort. Sie können die Anwendung in einem einzigen CLI-Schritt von Ihrem lokalen Arbeitsbereich aus mit Google Cloud Build erstellen und bereitstellen.

Stellen Sie sicher, dass die `gcloud`-CLI installiert und authentifiziert ist:

```bash
# Set your active GCP project
gcloud config set project YOUR_PROJECT_ID

# Authenticate Docker against the registry host (one-time)
gcloud auth configure-docker gcr.io

# Build from the project root — the backend Dockerfile needs the whole workspace
# as its build context (pnpm-workspace.yaml, backend/, config/)
docker build -f backend/Dockerfile -t gcr.io/YOUR_PROJECT_ID/rebase-backend .

# Push the image to the registry
docker push gcr.io/YOUR_PROJECT_ID/rebase-backend

# Deploy the newly built image to Cloud Run
gcloud run deploy rebase-backend \
  --image gcr.io/YOUR_PROJECT_ID/rebase-backend \
  --region europe-west3 \
  --port 3001 \
  --set-env-vars DATABASE_URL="postgresql://...",JWT_SECRET="YOUR_SECURE_RANDOM_STRING",NODE_ENV="production" \
  --allow-unauthenticated
```

## 3. Dateispeicher verwalten
Da Cloud Run-Instanzen streng zustandslos und kurzlebig sind, können Sie keinen lokalen Festplattenspeicher für Rebase-Datei-Uploads verwenden.

1. Navigieren Sie zu **Google Cloud Storage** und erstellen Sie einen neuen privaten Bucket in Ihrer gewählten EU-Region.
2. Befolgen Sie die [Rebase Speicher-Dokumentation](/docs/backend/storage), um Rebase so zu konfigurieren, dass es die von Google Cloud Storage bereitgestellte S3-kompatible API anstelle des lokalen Dateisystems verwendet.

Ihre Rebase-Instanz ist jetzt vollständig serverlos und nativ in der EU hochskalierbar!

## 4. Datenbankschema erstellen

Beim Start erstellt Rebase automatisch **nur die Auth-Tabellen**. Die Tabellen für Ihre eigenen Collections werden **nicht** automatisch angelegt — Sie müssen das Schema einmalig gegen die Produktionsdatenbank pushen:

```bash
pnpm run db:push
```

Ohne diesen Schritt gibt jede Collection einen `missing table`-Fehler zurück. Die Falle dabei: Die App startet trotzdem und die Anmeldung funktioniert (die Auth-Tabellen existieren), sodass die Bereitstellung zunächst gesund aussieht.

Führen Sie den Befehl aus einem Projekt-Checkout oder aus CI aus, wobei `DATABASE_URL` auf die Produktionsdatenbank zeigt — **nicht** im Container, da das Produktions-Image ohne die CLI ausgeliefert wird. Starten Sie den Cloud SQL Auth Proxy lokal und richten Sie `DATABASE_URL` auf `127.0.0.1`, um die Cloud SQL-Instanz sicher zu erreichen.

Für versionierte Migrationen verwenden Sie stattdessen `pnpm run db:generate` und `pnpm run db:migrate`.

---
