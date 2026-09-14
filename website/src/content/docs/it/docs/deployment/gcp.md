---
sourceHash: bfd17423672137c9
title: Deploy di Rebase su Google Cloud Platform
description: Distribuisci la tua istanza Rebase in modo sicuro su GCP utilizzando Cloud SQL e Cloud Run, con particolare attenzione alle regioni dei data center UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) offre un'esperienza di sviluppo fluida per le applicazioni containerizzate. Per una configurazione di produzione solida, usa **Cloud SQL** per il database e **Cloud Run** per il runtime.

Per garantire una rigorosa conformità ai dati a livello europeo, opera interamente all'interno di una regione UE come **europe-west3 (Frankfurt)**, **europe-west9 (Paris)** o **europe-west1 (Belgium)**.

Nulla in questa pagina è specifico di GCP per quanto riguarda il tuo progetto. Un deployment di Rebase è composto da due parti separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build` — e lo stesso bundle viene eseguito con Docker Compose su un computer portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Eseguire il provisioning di Cloud SQL (PostgreSQL)

1. Accedi alla console di **Cloud SQL** nella tua regione UE preferita.
2. Fai clic su **Create Instance** e seleziona **PostgreSQL**.
3. Imposta l'ID istanza e genera una password sicura per l'utente `postgres`.
4. Espandi **Configuration Options** per scegliere un tipo di macchina (due vCPU sono un buon punto di partenza).
5. Configura un IP privato o una rete pubblica autorizzata, a seconda di come Cloud Run vi accederà.
6. Componi il tuo URI di connessione:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Se le tue collezioni dichiarano una proprietà `vector`, abilita l'estensione una sola volta eseguendo `CREATE EXTENSION vector;` sul database.

## 2. Creare il bundle e integrarlo in un'immagine

Non c'è **alcuna immagine dell'applicazione da compilare dal tuo codice sorgente**. `rebase build` genera una directory `dist-bundle` con le tue collezioni compilate, funzioni, cron e — se il tuo progetto dichiara un'app statica — il tuo frontend compilato. L'immagine di runtime pubblicata la esegue:

```bash
rebase build
```

Cloud Run effettua il pull da un registry, quindi incorpora il bundle in un'immagine derivata. Tre righe, e fissa esattamente ciò che viene eseguito:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.21.0
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

L'aggiornamento futuro di Rebase richiede solo la modifica di quella riga `FROM`. Il tuo bundle rimane intatto.

## 3. Eseguire il deploy su Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

Cloud Run inserisce `PORT` e il runtime vi si associa, quindi non c'è alcuna porta da configurare. Punta la startup probe a `/livez` anziché a `/health`: la seconda esegue un round-trip al database, pertanto una liveness probe su di essa riavvierebbe una revisione integra durante un breve singhiozzo del database.

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` sono il modo in cui questo servizio ottiene un amministratore: in produzione il primo account a registrarsi non viene promosso, quindi nient'altro genererà il primo utente autenticato. Impostali prima che la prima revisione gestisca il traffico — consulta [Your first admin](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` sostituisce l'**intero** blocco delle variabili d'ambiente a ogni deploy, quindi un deploy successivo che omette una variabile la rimuoverà silenziosamente. Mantieni l'elenco completo nel tuo script di deploy.

La connessione a un'istanza Cloud SQL privata richiede `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` e un `DATABASE_URL` in formato socket; un'istanza pubblica con una rete autorizzata non richiede alcuno dei due.

## 4. Lo schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collezioni.** `REBASE_MIGRATE_ON_BOOT` ha come valore predefinito `ensure`, che è additivo su tutto lo schema: crea tabelle, colonne e tipi enum mancanti e applica la loro row-level security, consentendo al primo avvio su un'istanza vuota di essere subito pronto a gestire le tue collezioni.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché l'avvio di una revisione non deve rimodellare uno schema come effetto collaterale di un deploy.

Due aspetti richiedono quindi ancora l'uso della CLI, eseguita da un checkout locale o da un job di CI:

```bash
rebase db push
```

- **RLS per le tabelle di giunzione (junction table)** per le relazioni molti-a-molti.
- **Qualsiasi modifica non puramente additiva** — una colonna rinominata, un tipo ristretto, un campo rimosso.

Dalla tua macchina, connettiti tramite il [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) e punta `DATABASE_URL` su `localhost`. L'immagine di runtime viene fornita senza la CLI, quindi questa operazione non viene mai eseguita all'interno del container Cloud Run. Per le migrazioni con controllo di versione, esegui il commit dei file di migrazione con `rebase db generate` ed esegui `rebase db migrate` come passaggio di rilascio.

## Archiviazione dei file

Le istanze di Cloud Run sono stateless ed effimere, pertanto l'archiviazione locale dei file comporta una perdita silenziosa di dati e il runtime la rifiuta in produzione.

1. Crea un bucket privato di Google Cloud Storage nella regione UE che hai scelto.
2. Imposta `STORAGE_TYPE=gcs` e il rispettivo bucket — consulta [Storage](/docs/backend/storage). Su Cloud Run, il service account dell'ambiente fornisce le credenziali, quindi non c'è nient'altro da configurare.

:::caution
Cloud Run scala a zero. Se il tuo progetto utilizza sottoscrizioni in tempo reale, imposta `--min-instances 1`: le connessioni WebSocket vengono terminate quando un'istanza viene ridotta a zero.
:::

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore comuni a tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
