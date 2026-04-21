---
title: Deploying Rebase on Google Cloud Platform
description: Deploy your Rebase instance securely on GCP using Cloud SQL and Cloud Run, focusing on EU data center regions.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) offers an incredibly seamless developer experience for containerized applications. For a robust production setup, we leverage **Cloud SQL** for the database and **Cloud Run** for the serverless container backbone.

To maintain strict European data compliance, ensure you operate entirely within an EU region, such as **europe-west3 (Frankfurt)**, **europe-west9 (Paris)**, or **europe-west1 (Belgium)**.

## 1. Provision Cloud SQL (PostgreSQL)

1. Navigate to the **Cloud SQL** console in your preferred EU region.
2. Click **Create Instance** and select **PostgreSQL**.
3. Set your Instance ID and generate a secure built-in password for the `postgres` user.
4. Expand the **Configuration Options** to allocate the correct Machine Type (a standard 2 vCPU machine is a great start).
5. Ensure the database is configured for Private IP or Authorized Public IP networks, depending on your VCP setup with Cloud Run.
6. Assemble your connection URI:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

## 2. Build and Deploy to Cloud Run

Cloud Run scales the Rebase Node.js backend automatically down to zero (if desired) and handles TLS out of the box. You can build and deploy the application in a single CLI motion from your local workspace using Google Cloud Build.

Ensure you have the `gcloud` CLI installed and authenticated:

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

## 3. Handle File Storage
Since Cloud Run instances are strictly stateless and ephemeral, you cannot use local disk storage for Rebase File Uploads.

1. Navigate to **Google Cloud Storage** and create a new private bucket in your chosen EU region.
2. Follow the [Rebase Storage Documentation](/docs/storage/configuration) to configure Rebase to use the S3-compatible API provided by Google Cloud Storage instead of the local filesystem.

Your Rebase instance is now fully serverless and highly scalable natively inside the EU!
