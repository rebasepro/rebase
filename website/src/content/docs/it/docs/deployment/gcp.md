---
sourceHash: 0632063aadcff623
title: Distribuzione di Rebase su Google Cloud Platform
description: Distribuisci la tua istanza Rebase in modo sicuro su GCP utilizzando Cloud SQL e Cloud Run, concentrandoti sulle regioni dei data center dell'UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) offre un'esperienza di sviluppo fluida per le applicazioni containerizzate. Per una configurazione di produzione solida, usa **Cloud SQL** per il database e **Cloud Run** per il runtime.

Per garantire una rigorosa conformità ai dati europei, opera interamente all'interno di una regione UE come **europe-west3 (Francoforte)**, **europe-west9 (Parigi)** o **europe-west1 (Belgio)**.

Nulla in questa pagina riguarda il tuo progetto in modo specifico per GCP. Una distribuzione di Rebase è composta da due elementi separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build`; lo stesso bundle viene eseguito con Docker Compose su un laptop, su Rebase Cloud, tramite il [chart Helm](/docs/deployment/kubernetes) e qui.

## 1. Provisioning di Cloud SQL (PostgreSQL)

1. Accedi alla console di **Cloud SQL** nella tua regione UE preferita.
2. Fai clic su **Crea istanza** e seleziona **PostgreSQL**.
3. Imposta l'ID della tua istanza e genera una password sicura per l'utente `postgres`.
4. Espandi **Opzioni di configurazione** per scegliere un tipo di macchina (due vCPU sono un buon punto di partenza).
5. Configura un IP privato o una rete pubblica autorizzata, a seconda di come Cloud Run vi accederà.
6. Componi il tuo URI di connessione:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Se le tue tabelle dichiarano una colonna `col.vector()`, abilita l'estensione una sola volta eseguendo: `CREATE EXTENSION vector;` sul database.

## 2. Compilare il bundle e integrarlo in un'immagine

Non c'è **alcuna immagine dell'applicazione da compilare dal codice sorgente**. `rebase build` genera una directory `dist-bundle` con tabelle compilate, funzioni, cron job e, se il tuo progetto dichiara un'app statica, il frontend compilato. L'immagine di runtime pubblicata lo esegue:

```bash
rebase build
```

Cloud Run esegue il pull da un registry, quindi integra il bundle in un'immagine derivata. Tre righe, e fissa esattamente ciò che viene eseguito:

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

L'aggiornamento futuro di Rebase richiede solo la modifica di quella riga `FROM`. Il bundle rimane invariato.

## 3. Distribuire su Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

Cloud Run inserisce la variabile `PORT` a cui il runtime si associa, quindi non c'è alcuna porta da configurare. Punta il probe di avvio su `/livez` anziché su `/health`: quest'ultimo esegue un round-trip con il database, quindi un liveness probe su di esso riavvierebbe una revisione funzionante durante un temporaneo problema del database.

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` sono il modo in cui questo servizio ottiene un amministratore: in produzione il primo account a registrarsi non viene promosso, quindi nient'altro genererà il primo utente autenticato. Impostali prima che la prima revisione gestisca il traffico — vedi [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` sostituisce l'**intero** blocco di variabili d'ambiente a ogni deploy, quindi una distribuzione successiva che omette una variabile la annullerà silenziosamente. Mantieni l'elenco completo nel tuo script di deploy.

Per raggiungere un'istanza Cloud SQL privata sono necessari `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` e un `DATABASE_URL` di tipo socket; per un'istanza pubblica con una rete autorizzata non è necessario alcuno dei due.

## 4. Lo schema

<span class="since-badge" data-since="0.31">Da 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, comprese quelle dichiarate da `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` è impostato per impostazione predefinita su `ensure`, che è additivo per l'intero schema: crea tabelle, colonne e tipi enum mancanti e applica la loro row-level security, consentendo al primo avvio su un'istanza vuota di gestire immediatamente le tue collezioni.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non altera il tipo di una colonna, non elimina nulla e non modifica i valori di un enum esistente, poiché l'avvio di una revisione non deve rimodellare uno schema come effetto collaterale di un deploy.

Per una cosa, quindi, è ancora necessaria la CLI, eseguita da un checkout locale o da un job CI:

```bash
rebase db push
```

Qualsiasi modifica che non sia puramente additiva: una colonna rinominata, un tipo ristretto, un campo rimosso.

Dalla tua macchina, connettiti tramite il [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) e punta `DATABASE_URL` su `localhost`. L'immagine di runtime viene fornita senza la CLI, quindi questo non viene mai eseguito all'interno del container Cloud Run. Per le migrazioni con controllo di versione, esegui il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di rilascio.

## Archiviazione dei file

Le istanze di Cloud Run sono stateless ed effimere, quindi l'archiviazione di file in locale comporterebbe una perdita silenziosa di dati e il runtime la rifiuta in produzione.

1. Crea un bucket Google Cloud Storage privato nella regione UE prescelta.
2. Crea una chiave HMAC per un account di servizio autorizzato a utilizzare il bucket (**Cloud Storage → Impostazioni → Interoperabilità**), e raggiungi il bucket tramite il suo endpoint compatibile con S3: `STORAGE_TYPE=s3`, `S3_BUCKET`, `S3_ENDPOINT=https://storage.googleapis.com`, `S3_REGION=auto`, e la chiave come `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` — vedi [Archiviazione](/docs/backend/storage). `STORAGE_TYPE=gcs` carica `@google-cloud/storage`, che non è incluso nell'immagine di runtime, e un'eventuale copia nel bundle non si trova nel suo percorso di risoluzione.

:::caution
Cloud Run scala a zero. Se il tuo progetto utilizza sottoscrizioni in tempo reale, imposta `--min-instances 1`: le connessioni WebSocket vengono terminate quando un'istanza viene ridimensionata.
:::

## Passaggi successivi

- [Distribuzione](/docs/getting-started/deployment) — la checklist di produzione e le regole per il primo amministratore comuni a ogni piattaforma.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
