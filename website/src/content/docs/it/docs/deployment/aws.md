---
sourceHash: d9b167443cc3fd35
title: Distribuzione di Rebase su AWS
description: Distribuisci la tua istanza Rebase in modo sicuro su Amazon Web Services utilizzando RDS e AWS App Runner con una forte attenzione all'Europa.
sidebar_label: AWS
---

Amazon Web Services (AWS) offre una scalabilità straordinaria e una sicurezza di livello enterprise. Per una distribuzione di Rebase in produzione, consigliamo di disaccoppiare l'architettura utilizzando **Amazon RDS** per il database PostgreSQL e **AWS App Runner** (o ECS Fargate) per eseguire il runtime.

Per mantenere una rigorosa conformità dei dati a livello europeo, assicurati di operare interamente all'interno di una regione UE, come **eu-central-1 (Francoforte)**, **eu-west-1 (Irlanda)** o **eu-west-3 (Parigi)**.

Nulla in questa pagina è specifico di AWS per quanto riguarda il tuo progetto. Una distribuzione di Rebase è costituita da due parti separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build` — e lo stesso bundle viene eseguito con Docker Compose su un computer portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui. Il passaggio da uno all'altro è un cambiamento di infrastruttura, non di applicazione.

## 1. Provisioning di Amazon RDS (PostgreSQL)

1. Accedi alla console **RDS** nella regione UE selezionata.
2. Fai clic su **Create database** e seleziona **Standard create**.
3. Scegli il motore **PostgreSQL**.
4. In Templates, scegli **Production** o **Free tier/Dev** a seconda del tuo carico di lavoro.
5. Crea un Master Username (ad es. `rebase_admin`) e genera una Master Password sicura.
6. In Connectivity, assicurati che il database sia collocato all'interno di un **VPC** a cui la tua futura istanza di App Runner possa accedere in modo sicuro (oppure rendilo accessibile pubblicamente se controlli rigorosamente gli intervalli IP in ingresso).
7. Una volta eseguito il provisioning, annota l'**Endpoint address** e componi il tuo URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Se le tue tabelle dichiarano una colonna `col.vector()`, l'istanza richiede l'estensione `pgvector` — RDS la include, ma deve essere abilitata: `CREATE EXTENSION vector;` sul database, una sola volta.

## 2. Crea il bundle e integralo in un'immagine

Non c'è **nessuna immagine dell'applicazione da compilare dal tuo codice sorgente**. `rebase build` produce una directory `dist-bundle` con le tabelle compilate, funzioni, cron job e — se il tuo progetto dichiara un'app statica — il tuo frontend compilato. L'immagine di runtime pubblicata la esegue:

```bash
rebase build
```

Per App Runner, che effettua il pull da un registry, incorpora il bundle in un'immagine derivata. Si tratta di tre righe e fissa con precisione ciò che viene eseguito:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Accedi a **Elastic Container Registry** e crea un repository privato chiamato `rebase-backend`.
2. Recupera i comandi di push mostrati da AWS nella console — gestiscono l'autenticazione Docker.
3. Compila ed esegui il push, dalla root del progetto:
   ```bash
   docker build -t rebase-backend .
   ```
4. Applica il tag ed esegui il push nel tuo repository ECR.

L'aggiornamento futuro di Rebase richiede solo una modifica a quella riga `FROM`. Il tuo bundle rimane intatto e nulla del tuo progetto viene ricompilato.

## 3. Distribuzione tramite AWS App Runner

App Runner è il modo più semplice per eseguire container su AWS senza dover gestire orchestratori.

1. Accedi ad **AWS App Runner** e fai clic su **Create service**.
2. Seleziona **Container registry** e scegli **Amazon ECR**.
3. Sfoglia e seleziona la tua immagine `rebase-backend`.
4. In **Service settings**, imposta la porta su **8080** — la porta su cui l'immagine di runtime è in ascolto, a meno che `PORT` non indichi diversamente.
5. Imposta il percorso di **health check** su `/livez`. Non `/health`: quest'ultimo esegue un round-trip verso il database, quindi una liveness probe su di esso riavvierebbe un servizio perfettamente integro durante un breve singhiozzo del database.
6. Aggiungi le variabili d'ambiente:

| Chiave | Valore |
|-----|-------|
| `DATABASE_URL` | La tua stringa di connessione RDS |
| `JWT_SECRET` | Una stringa casuale sicura generata (32+ caratteri) |
| `REBASE_SERVICE_KEY` | Una stringa casuale sicura generata (32+ caratteri) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Il dominio del tuo frontend (ad es. `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL del tuo frontend (utilizzato per i link nelle email e come fallback CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'indirizzo del primo amministratore, impostato **prima del primo avvio** |
| `REBASE_ADMIN_PASSWORD` | Almeno 12 caratteri |

Le ultime tre variabili definiscono il modo in cui questa distribuzione ottiene un amministratore: in produzione il primo account che si registra non viene promosso, quindi nient'altro genererà il primo utente autenticato. Consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin). Inserisci i secret in AWS Secrets Manager e fai riferimento a essi invece di digitarli nel modulo della console.

7. (Facoltativo) Se la tua istanza RDS è strettamente privata, configura il networking **Custom VPC** in App Runner in modo che il container possa raggiungere il database.
8. Fai clic su **Create & deploy**.

AWS gestisce la terminazione TLS, fornendo un URL `https` pronto all'uso.

## 4. Lo schema

<span class="since-badge" data-since="0.31">Da 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate in `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` è impostato per impostazione predefinita su `ensure`, che ha un comportamento additivo sull'intero schema — crea tabelle, colonne e tipi enum mancanti e applica la relativa row-level security — in modo che il primo avvio su un'istanza RDS vuota sia subito pronto a gestire le tue tabelle.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non altera il tipo di una colonna, non elimina nulla né modifica le etichette di un enum esistente, poiché il riavvio di un container non deve rimodellare lo schema come effetto collaterale di un deploy.

Di conseguenza, una cosa richiede ancora l'uso della CLI, eseguita da un checkout locale o da un job di CI con `DATABASE_URL` puntato su RDS:

```bash
rebase db push
```

Qualsiasi modifica che non sia puramente additiva: una colonna rinominata, un tipo ristretto, un campo rimosso.

Se l'istanza è privata, eseguila dalla CI o da un bastion host all'interno dello stesso VPC. L'immagine di runtime viene fornita senza la CLI, pertanto questo comando non viene mai eseguito all'interno del container di App Runner. Per le migrazioni con controllo di versione, esegui il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di rilascio.

## Archiviazione dei file

Le istanze di App Runner non dispongono di un disco permanente, quindi l'archiviazione di file locali comporterebbe una perdita silenziosa di dati e il runtime la rifiuta in produzione. Crea un bucket S3 nella stessa regione e imposta `STORAGE_TYPE=s3` con il relativo bucket e le credenziali — consulta [Storage](/docs/backend/storage).

## Passaggi successivi

- [Distribuzione](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore condivise da tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
