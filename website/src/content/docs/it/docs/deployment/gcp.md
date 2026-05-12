---
title: Distribuzione di Rebase su Google Cloud Platform
description: Distribuisci la tua istanza Rebase in modo sicuro su GCP utilizzando Cloud SQL e Cloud Run, concentrandoti sulle regioni dei data center dell'UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) offre un'esperienza di sviluppo incredibilmente fluida per le applicazioni containerizzate. Per una configurazione di produzione robusta, utilizziamo **Cloud SQL** per il database e **Cloud Run** come spina dorsale del container serverless.

Per mantenere una rigorosa conformità ai dati europei, assicurati di operare interamente all'interno di una regione dell'UE, come **europe-west3 (Francoforte)**, **europe-west9 (Parigi)** o **europe-west1 (Belgio)**.

## 1. Provisioning di Cloud SQL (PostgreSQL)

1.  Vai alla console di **Cloud SQL** nella regione UE preferita.
2.  Clicca su **Crea istanza** e seleziona **PostgreSQL**.
3.  Imposta l'ID dell'istanza e genera una password sicura integrata per l'utente `postgres`.
4.  Espandi le **Opzioni di configurazione** per allocare il Tipo di macchina corretto (una macchina standard da 2 vCPU è un ottimo punto di partenza).
5.  Assicurati che il database sia configurato per IP privati o reti IP pubbliche autorizzate, a seconda della configurazione VCP con Cloud Run.
6.  Componi la tua URI di connessione:
    `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

## 2. Costruire e Distribuire su Cloud Run

Cloud Run scala il backend Node.js di Rebase automaticamente fino a zero (se desiderato) e gestisce il TLS out-of-the-box. Puoi costruire e distribuire l'applicazione con un'unica operazione CLI dal tuo spazio di lavoro locale utilizzando Google Cloud Build.

Assicurati di avere la CLI `gcloud` installata e autenticata:

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

## 3. Gestione dello Storage dei File

Poiché le istanze di Cloud Run sono strettamente stateless ed effimere, non è possibile utilizzare lo storage su disco locale per gli upload di file di Rebase.

1.  Vai a **Google Cloud Storage** e crea un nuovo bucket privato nella regione UE scelta.
2.  Segui la [Documentazione di Rebase Storage](/docs/storage) per configurare Rebase in modo che utilizzi l'API compatibile con S3 fornita da Google Cloud Storage invece del filesystem locale.

La tua istanza Rebase è ora completamente serverless e altamente scalabile nativamente all'interno dell'UE!
---
