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

# Submit the build to Cloud Build, which automatically creates the container image and stores it in Google Container Registry (GCR)
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/rebase-backend ./backend

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
2. Befolgen Sie die [Rebase Speicher-Dokumentation](/docs/storage), um Rebase so zu konfigurieren, dass es die von Google Cloud Storage bereitgestellte S3-kompatible API anstelle des lokalen Dateisystems verwendet.

Ihre Rebase-Instanz ist jetzt vollständig serverlos und nativ in der EU hochskalierbar!

---
