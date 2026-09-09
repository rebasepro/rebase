---
sourceHash: 2228ab84c888b578
title: Deploy di Rebase su AWS
description: Esegui il deploy della tua istanza Rebase in modo sicuro su Amazon Web Services utilizzando RDS e AWS App Runner con un forte focus europeo.
sidebar_label: AWS
---

Amazon Web Services (AWS) offre una scalabilità incredibile e una sicurezza di livello enterprise. Per un deploy di produzione di Rebase, consigliamo di disaccoppiare l'architettura utilizzando **Amazon RDS** per il database PostgreSQL e **AWS App Runner** (o ECS Fargate) per servire il runtime.

Per mantenere una rigorosa conformità dei dati a livello europeo, assicurati di operare interamente all'interno di una regione UE, come **eu-central-1 (Francoforte)**, **eu-west-1 (Irlanda)** o **eu-west-3 (Parigi)**.

Nulla in questa pagina è specifico di AWS riguardo al tuo progetto. Un deploy di Rebase è composto da due parti separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build` — e lo stesso bundle viene eseguito con Docker Compose su un portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui. Il passaggio da uno all'altro è una modifica dell'infrastruttura, non dell'applicazione.

## 1. Effettuare il provisioning di Amazon RDS (PostgreSQL)

1. Vai alla console di **RDS** nella regione UE selezionata.
2. Fai clic su **Create database** e seleziona **Standard create**.
3. Scegli il motore **PostgreSQL**.
4. Sotto Templates, scegli **Production** o **Free tier/Dev** a seconda del carico previsto.
5. Crea un Master Username (ad es. `rebase_admin`) e genera una Master Password sicura.
6. Sotto Connectivity, assicurati che il database sia collocato all'interno di un **VPC** a cui la tua futura istanza App Runner possa accedere in sicurezza (oppure rendilo accessibile pubblicamente se controlli rigorosamente gli intervalli IP in ingresso).
7. Una volta completato il provisioning, prendi nota dell'**Endpoint address** e componi il tuo URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Se le tue collection dichiarano una proprietà `vector`, l'istanza richiede l'estensione `pgvector` — RDS la include, ma deve essere abilitata eseguendo `CREATE EXTENSION vector;` sul database, una sola volta.

## 2. Compilare il bundle e inserirlo in un'immagine

Non c'è **alcuna immagine dell'applicazione da compilare dal tuo codice sorgente**. `rebase build` produce una directory `dist-bundle` con le tue collection compilate, funzioni, cron e — se il tuo progetto dichiara una static app — il tuo frontend compilato. L'immagine di runtime pubblicata lo esegue:

```bash
rebase build
```

Per App Runner, che scarica da un registry, inserisci il bundle in un'immagine derivata. Si tratta di tre righe e definisce esattamente cosa viene eseguito:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.19.1
COPY dist-bundle /bundle
```

1. Vai su **Elastic Container Registry** e crea un repository privato chiamato `rebase-backend`.
2. Prendi i comandi di push che AWS mostra nella console: gestiscono l'autenticazione Docker.
3. Esegui la build e il push dalla root del progetto:
   ```bash
   docker build -t rebase-backend .
   ```
4. Tagga ed esegui il push verso il tuo repository ECR.

L'aggiornamento di Rebase in futuro consisterà semplicemente nella modifica di quella riga `FROM`. Il tuo bundle rimane intatto e nulla del tuo progetto viene ricompilato.

## 3. Deploy tramite AWS App Runner

App Runner è il modo più semplice per eseguire container su AWS senza dover gestire orchestratori.

1. Vai su **AWS App Runner** e fai clic su **Create service**.
2. Seleziona **Container registry** e scegli **Amazon ECR**.
3. Sfoglia e seleziona la tua immagine `rebase-backend`.
4. Sotto **Service settings**, imposta la porta su **8080** — la porta su cui l'immagine di runtime è in ascolto, a meno che `PORT` non indichi diversamente.
5. Imposta il percorso dell'**health check** su `/livez`. Non su `/health`: quest'ultimo esegue un round-trip sul database, quindi una liveness probe su di esso riavvierebbe un servizio perfettamente integro durante un momentaneo problema del database.
6. Aggiungi le variabili d'ambiente:

| Chiave | Valore |
|-----|-------|
| `DATABASE_URL` | La tua stringa di connessione RDS |
| `JWT_SECRET` | Una stringa sicura generata casualmente (32+ caratteri) |
| `REBASE_SERVICE_KEY` | Una stringa sicura generata casualmente (32+ caratteri) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Il dominio del tuo frontend (ad es., `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL del tuo frontend (utilizzato per i link nelle email e come fallback per CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'indirizzo del primo amministratore, impostato **prima del primo avvio** |
| `REBASE_ADMIN_PASSWORD` | Almeno 12 caratteri |

Le ultime tre sono necessarie affinché questo deploy possa avere un amministratore: in produzione il primo account che si registra non viene promosso, quindi nient'altro genererà il primo utente autenticato. Consulta [Il tuo primo admin](/docs/getting-started/deployment/#your-first-admin). Inserisci i secret in AWS Secrets Manager e fai riferimento ad essi anziché digitarli nel modulo della console.

7. (Opzionale) Se la tua istanza RDS è strettamente privata, configura il networking **Custom VPC** in App Runner in modo che il container possa raggiungere il database.
8. Fai clic su **Create & deploy**.

AWS gestisce la terminazione TLS, fornendoti un URL `https` pronto all'uso.

## 4. Lo schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collection.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che è additivo su tutto lo schema — crea tabelle, colonne e tipi enum mancanti e applica la loro row-level security — quindi il primo avvio su un'istanza RDS vuota inizia subito a servire le tue collection.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non modifica il tipo di una colonna, non elimina nulla e non modifica i valori di un enum esistente, poiché un riavvio del container non deve rimodellare uno schema come effetto collaterale di un deploy.

Due cose richiedono quindi ancora la CLI, eseguita da un checkout locale o da un job di CI con `DATABASE_URL` puntato a RDS:

```bash
rebase db push
```

- **RLS sulle tabelle di giunzione (junction-table)** per le relazioni molti-a-molti.
- **Qualsiasi modifica che non sia puramente additiva** — una colonna rinominata, un tipo ristretto, un campo rimosso.

Se l'istanza è privata, eseguila dalla CI o da un bastion host all'interno dello stesso VPC. L'immagine di runtime viene distribuita senza la CLI, quindi questo non viene mai eseguito all'interno del container di App Runner. Per migrazioni versionate, fai il commit dei file di migrazione con `rebase db generate` ed esegui `rebase db migrate` come passaggio di rilascio.

## File storage

Le istanze di App Runner non dispongono di un disco persistente, pertanto lo storage di file locale comporterebbe una perdita invisibile di dati e il runtime lo rifiuta in produzione. Crea un bucket S3 nella stessa regione e imposta `STORAGE_TYPE=s3` con il relativo bucket e le credenziali — consulta [Storage](/docs/backend/storage).

## Passaggi successivi

- [Deploy](/docs/getting-started/deployment) — la checklist di produzione e le regole per il primo admin condivise da ogni piattaforma.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.

---
