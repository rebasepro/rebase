---
sourceHash: 0633ef5ec34074cf
title: Distribuzione di Rebase su Google Cloud Platform
description: Distribuisci la tua istanza Rebase in modo sicuro su GCP utilizzando Cloud SQL e Cloud Run, con un focus sulle regioni dei data center nell'UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) offre un'esperienza di sviluppo fluida per le applicazioni containerizzate. Per una configurazione di produzione robusta, utilizza **Cloud SQL** per il database e **Cloud Run** per il runtime.

Per garantire una rigorosa conformità ai dati europei, opera interamente all'interno di una regione dell'UE come **europe-west3 (Francoforte)**, **europe-west9 (Parigi)** o **europe-west1 (Belgio)**.

Nulla in questa pagina è specifico di GCP per quanto riguarda il tuo progetto. Una distribuzione di Rebase è composta da due elementi separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build` — e lo stesso bundle può essere eseguito tramite Docker Compose su un laptop, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Provisioning di Cloud SQL (PostgreSQL)

1. Accedi alla console di **Cloud SQL** nella tua regione UE preferita.
2. Fai clic su **Create Instance** e seleziona **PostgreSQL**.
3. Imposta l'ID istanza e genera una password sicura per l'utente `postgres`.
4. Espandi **Configuration Options** per scegliere il tipo di macchina (due vCPU sono un buon punto di partenza).
5. Configura un IP privato o una rete pubblica autorizzata, a seconda di come Cloud Run dovrà raggiungerlo.
6. Componi il tuo URI di connessione:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Se le tue collezioni dichiarano una proprietà `vector`, abilita l'estensione una tantum sul database: `CREATE EXTENSION vector;`.

## 2. Compilare il bundle e incorporarlo in un'immagine

Non c'è **alcuna immagine dell'applicazione da compilare dal tuo codice sorgente**. Il comando `rebase build` genera una directory `dist-bundle` contenente le tue collezioni compilate, funzioni, cron e — se il tuo progetto dichiara un'app statica — il frontend compilato. L'immagine di runtime pubblicata si occupa di eseguirlo:

```bash
rebase build
```

Cloud Run effettua il pull da un registro, quindi incorpora il bundle in un'immagine derivata. Bastano tre righe per definire con precisione ciò che viene eseguito:

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

L'aggiornamento futuro di Rebase consisterà semplicemente nel modificare la riga `FROM`. Il tuo bundle rimarrà inalterato.

## 3. Distribuire su Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

Cloud Run inietta `PORT` e il runtime vi effettua il bind, quindi non c'è alcuna porta da configurare. Punta la startup probe verso `/livez` anziché `/health`: quest'ultimo esegue un round-trip sul database, quindi una liveness probe su di esso riavvierebbe una revisione altrimenti sana durante una breve interruzione momentanea del database.

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` sono i parametri tramite cui questo servizio ottiene un amministratore: in produzione il primo account che si registra non viene promosso automaticamente, quindi nient'altro genererà il primo utente autenticato. Configurali prima che la prima revisione inizi a gestire traffico — consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` sovrascrive l'**intero** blocco delle variabili d'ambiente a ogni deploy; di conseguenza, un deploy successivo che omette una variabile la rimuoverà silenziosamente. Mantieni l'elenco completo nel tuo script di distribuzione.

Per raggiungere un'istanza privata di Cloud SQL sono necessari il flag `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` e una stringa `DATABASE_URL` basata su socket; un'istanza pubblica con una rete autorizzata non necessita di nessuno dei due.

## 4. Lo schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collezioni.** Il valore predefinito di `REBASE_MIGRATE_ON_BOOT` è `ensure`, che applica modifiche puramente additive all'intero schema: crea le tabelle, le colonne e i tipi enum mancanti applicandone la sicurezza a livello di riga (RLS). In questo modo, il primo avvio su un'istanza vuota sarà subito in grado di servire le tue collezioni.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non altera il tipo di una colonna, non elimina nulla e non modifica i valori di un enum esistente, poiché l'avvio di una revisione non deve rimodellare uno schema come effetto collaterale di un deploy.

Due operazioni richiedono quindi ancora l'uso della CLI, eseguita da un checkout locale o da un job di CI:

```bash
rebase db push
```

- **RLS sulle tabelle di giunzione (junction tables)** per le relazioni molti-a-molti.
- **Qualsiasi modifica che non sia puramente additiva** — una colonna rinominata, un tipo di dato ristretto, un campo rimosso.

Dalla tua macchina, connettiti tramite il [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) e imposta `DATABASE_URL` su `localhost`. L'immagine di runtime è distribuita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container Cloud Run. Per le migrazioni versionate, esegui il commit dei file di migrazione con `rebase db generate` ed esegui `rebase db migrate` come passaggio di rilascio.

## Archiviazione file

Le istanze di Cloud Run sono stateless ed effimere: l'archiviazione locale dei file comporta quindi una perdita silenziosa di dati e il runtime la rifiuta in ambienti di produzione.

1. Crea un bucket Google Cloud Storage privato nella regione UE che hai selezionato.
2. Imposta `STORAGE_TYPE=gcs` e indica il bucket — consulta [Storage](/docs/backend/storage). Su Cloud Run, il service account predefinito dell'ambiente fornisce le credenziali, quindi non è necessario configurare altro.

:::caution
Cloud Run scala fino a zero istanze. Se il tuo progetto utilizza sottoscrizioni in tempo reale, imposta `--min-instances 1` — le connessioni WebSocket vengono interrotte quando un'istanza viene scalata verso il basso.
:::

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole comuni per il primo amministratore su qualsiasi piattaforma.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.

---
