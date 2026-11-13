---
sourceHash: 8d400239df61cbd4
title: Deploy di Rebase su Google Cloud Platform
description: Esegui il deploy della tua istanza Rebase in modo sicuro su GCP utilizzando Cloud SQL e Cloud Run, con particolare attenzione alle regioni dei data center dell'UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) offre un'esperienza di sviluppo fluida per le applicazioni containerizzate. Per una configurazione di produzione solida, utilizza **Cloud SQL** per il database e **Cloud Run** per il runtime.

Per mantenere una rigorosa conformità ai dati europei, opera interamente all'interno di una regione UE come **europe-west3 (Frankfurt)**, **europe-west9 (Paris)** o **europe-west1 (Belgium)**.

Nessun elemento in questa pagina è specifico di GCP per quanto riguarda il tuo progetto. Un deployment di Rebase è composto da due parti separabili: l'immagine runtime pubblicata e il **bundle** prodotto da `rebase build` — e lo stesso bundle può essere eseguito con Docker Compose su un laptop, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Provisioning di Cloud SQL (PostgreSQL)

1. Vai alla console di **Cloud SQL** nella tua regione UE preferita.
2. Fai clic su **Create Instance** e seleziona **PostgreSQL**.
3. Imposta il tuo Instance ID e genera una password sicura per l'utente `postgres`.
4. Espandi **Configuration Options** per scegliere il tipo di macchina (due vCPU rappresentano un buon punto di partenza).
5. Configura un IP privato o una rete pubblica autorizzata, a seconda di come Cloud Run vi accederà.
6. Componi l'URI di connessione:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Se le tue tabelle dichiarano una colonna `col.vector()`, abilita l'estensione una sola volta sul database: `CREATE EXTENSION vector;`.

## 2. Eseguire la build del bundle e incorporarlo in un'immagine

Non c'è **alcuna immagine dell'applicazione da compilare a partire dal tuo sorgente**. `rebase build` produce una directory `dist-bundle` con tabelle compilate, funzioni, cron job e — se il tuo progetto dichiara una static app — il frontend compilato. L'immagine di runtime pubblicata lo esegue:

```bash
rebase build
```

Cloud Run esegue il pull da un registry, quindi incorpora il bundle in un'immagine derivata. Tre righe per bloccare esattamente ciò che viene eseguito:

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

Aggiornare Rebase in futuro richiederà solo una modifica a quella riga `FROM`. Il tuo bundle rimarrà intatto.

## 3. Deploy su Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

Cloud Run inietta `PORT` e il runtime vi si associa, quindi non c'è alcuna porta da configurare. Punta la startup probe a `/livez` anziché a `/health`: quest'ultima esegue un round-trip con il database, quindi una liveness probe su di essa riavvierebbe una revisione funzionante durante un temporaneo singhiozzo del database.

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` servono a definire l'amministratore del servizio: in produzione il primo account registrato non viene promosso, quindi nessun altro meccanismo crea il primo chiamante autenticato. Impostali prima che la prima revisione gestisca il traffico — vedi [Il tuo primo admin](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` sostituisce l'**intero** blocco delle variabili d'ambiente a ogni deploy, quindi un deploy successivo che omette una variabile la rimuoverà senza preavviso. Mantieni l'elenco completo nel tuo script di deploy.

L'accesso a un'istanza Cloud SQL privata richiede `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` e una `DATABASE_URL` basata su socket; un'istanza pubblica con una rete autorizzata non necessita di nessuno dei due.

## 4. Lo schema

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate da `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che è additivo sull'intero schema: crea le tabelle, le colonne e i tipi enum mancanti e applica la loro row-level security, consentendo al primo avvio su un'istanza vuota di rendere subito disponibili le tue tabelle.

Ciò che `ensure` non fa mai è modificare elementi già esistenti: non altera il tipo di una colonna, non elimina nulla né modifica le etichette di un enum esistente, poiché l'avvio di una nuova revisione non deve rimodellare uno schema come effetto collaterale di un deploy.

C'è quindi una cosa che richiede ancora la CLI, eseguita da un checkout locale o da un job di CI:

```bash
rebase db push
```

Qualsiasi modifica che non sia puramente additiva: una colonna rinominata, un tipo ristretto, un campo rimosso.

Dal tuo computer, connettiti tramite [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) e punta `DATABASE_URL` a `localhost`. L'immagine di runtime viene fornita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container di Cloud Run. Per le migrazioni versionate, esegui invece il commit dei file di migrazione con `rebase db generate` ed esegui `rebase db migrate` come passaggio di rilascio.

## File storage

Le istanze di Cloud Run sono stateless ed effimere, quindi lo storage locale dei file comporterebbe una perdita invisibile di dati e il runtime lo rifiuta in produzione.

1. Crea un bucket privato di Google Cloud Storage nella regione UE che hai scelto.
2. Crea una chiave HMAC per un service account autorizzato a utilizzare il bucket (**Cloud Storage → Settings → Interoperability**), e accedi al bucket tramite il suo endpoint compatibile con S3: `STORAGE_TYPE=s3`, `S3_BUCKET`, `S3_ENDPOINT=https://storage.googleapis.com`, `S3_REGION=auto`, e la chiave come `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` — vedi [Storage](/docs/backend/storage). `STORAGE_TYPE=gcs` carica `@google-cloud/storage`, che non è incluso nell'immagine di runtime, e un'eventuale copia nel tuo bundle non si troverà nel percorso di risoluzione dei moduli.

:::caution
Cloud Run scala a zero. Se il tuo progetto utilizza sottoscrizioni in tempo reale, imposta `--min-instances 1` — le connessioni WebSocket vengono interrotte quando un'istanza viene ridimensionata verso il basso.
:::

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore comuni a tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — ogni variabile d'ambiente letta dal runtime.
