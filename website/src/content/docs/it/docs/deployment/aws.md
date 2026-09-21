---
sourceHash: 62d3e254386426e3
title: Deploy di Rebase su AWS
description: Esegui il deploy della tua istanza Rebase in modo sicuro su Amazon Web Services utilizzando RDS e AWS App Runner con un forte focus europeo.
sidebar_label: AWS
---

Amazon Web Services (AWS) offre una scalabilità incredibile e una sicurezza di livello enterprise. Per un deployment di produzione di Rebase, consigliamo di disaccoppiare l'architettura utilizzando **Amazon RDS** per il database PostgreSQL e **AWS App Runner** (o ECS Fargate) per eseguire il runtime.

Per garantire una rigorosa conformità ai dati europei, assicurati di operare interamente all'interno di una regione UE, come **eu-central-1 (Frankfurt)**, **eu-west-1 (Ireland)** o **eu-west-3 (Paris)**.

Nulla in questa pagina è specifico di AWS per quanto riguarda il tuo progetto. Un deployment di Rebase è composto da due parti separabili: l'immagine di runtime pubblicata e il **bundle** generato da `rebase build`; lo stesso bundle può essere eseguito con Docker Compose su un computer portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui. Spostarsi da uno all'altro rappresenta un cambio di infrastruttura, non di applicazione.

## 1. Provisioning di Amazon RDS (PostgreSQL)

1. Accedi alla console **RDS** nella regione UE selezionata.
2. Fai clic su **Create database** e seleziona **Standard create**.
3. Scegli il motore **PostgreSQL**.
4. Nella sezione Templates, scegli **Production** o **Free tier/Dev** a seconda del carico di lavoro previsto.
5. Crea un Master Username (es. `rebase_admin`) e genera una Master Password sicura.
6. Nella sezione Connectivity, assicurati che il database sia collocato all'interno di un **VPC** a cui la tua futura istanza App Runner possa accedere in modo sicuro (oppure rendilo accessibile pubblicamente controllando rigorosamente gli intervalli di indirizzi IP in ingresso).
7. Una volta effettuato il provisioning, annota l'**Endpoint address** e componi il tuo URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Se le tue collezioni dichiarano una proprietà `vector`, l'istanza necessita dell'estensione `pgvector`: RDS la include già, ma deve essere abilitata eseguendo una tantum sul database: `CREATE EXTENSION vector;`.

## 2. Esegui la build del bundle e integralo in un'immagine

**Non è necessario compilare alcuna immagine dell'applicazione dal tuo codice sorgente**. `rebase build` genera una directory `dist-bundle` contenente le collezioni compilate, le funzioni, i cron e — se il progetto dichiara un'app statica — il frontend compilato. L'immagine di runtime ufficiale la esegue:

```bash
rebase build
```

Per App Runner, che esegue il pull da un registry, integra il bundle in un'immagine derivata. Si tratta di sole tre righe e definisce esattamente cosa viene eseguito:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.22.0
COPY dist-bundle /bundle
```

1. Vai su **Elastic Container Registry** e crea un repository privato denominato `rebase-backend`.
2. Recupera i comandi di push mostrati da AWS nella console: si occuperanno dell'autenticazione Docker.
3. Esegui la build e il push dalla root del progetto:
   ```bash
   docker build -t rebase-backend .
   ```
4. Aggiungi il tag ed esegui il push nel tuo repository ECR.

Aggiornare Rebase in seguito richiederà solo la modifica di quella riga `FROM`. Il tuo bundle rimarrà intatto e non sarà necessario ricompilare nulla del tuo progetto.

## 3. Deploy tramite AWS App Runner

App Runner è il modo più semplice per eseguire container su AWS senza dover gestire orchestratori.

1. Vai su **AWS App Runner** e fai clic su **Create service**.
2. Seleziona **Container registry** e scegli **Amazon ECR**.
3. Sfoglia e seleziona la tua immagine `rebase-backend`.
4. In **Service settings**, imposta la porta su **8080** — la porta su cui l'immagine di runtime è in ascolto, a meno che non sia specificato diversamente tramite `PORT`.
5. Imposta il percorso dell'**health check** su `/livez`. Non `/health`: quest'ultimo esegue un round-trip verso il database, quindi un probe di liveness su di esso riavvierebbe un servizio perfettamente funzionante durante una breve disconnessione o rallentamento del database.
6. Aggiungi le variabili d'ambiente:

| Chiave | Valore |
|-----|-------|
| `DATABASE_URL` | La tua stringa di connessione RDS |
| `JWT_SECRET` | Una stringa sicura generata casualmente (32+ caratteri) |
| `REBASE_SERVICE_KEY` | Una stringa sicura generata casualmente (32+ caratteri) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Il dominio del tuo frontend (es. `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL del tuo frontend (utilizzato per i link nelle email e come fallback CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'indirizzo del primo amministratore, impostato **prima del primo avvio** |
| `REBASE_ADMIN_PASSWORD` | Almeno 12 caratteri |

Le ultime tre servono a creare un amministratore per questo deployment: in produzione, il primo account che si registra non viene promosso automaticamente, quindi nessun altro meccanismo crea il primo utente autenticato. Consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin). Inserisci i secret in AWS Secrets Manager e referenziali invece di digitarli nel modulo della console.

7. (Facoltativo) Se la tua istanza RDS è strettamente privata, configura il networking con **Custom VPC** in App Runner in modo che il container possa raggiungere il database.
8. Fai clic su **Create & deploy**.

AWS gestisce la terminazione TLS, fornendoti subito un URL `https` pronto all'uso.

## 4. Lo schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collezioni.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che è un'operazione additiva sull'intero schema: crea le tabelle, le colonne e i tipi enum mancanti e applica la loro row-level security (RLS). In questo modo, il primo avvio su un'istanza RDS vuota inizierà subito a gestire le tue collezioni.

Ciò che `ensure` non fa mai è modificare elementi già esistenti: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di un container non deve rimodellare lo schema come effetto collaterale di un deploy.

Due operazioni richiedono quindi ancora la CLI, eseguita da una copia locale o da un job di CI con `DATABASE_URL` puntato a RDS:

```bash
rebase db push
```

- **RLS per junction table** (tabelle di giunzione) per relazioni molti-a-molti.
- **Qualsiasi modifica che non sia puramente additiva** — una colonna rinominata, un tipo ristretto, un campo rimosso.

Se l'istanza è privata, eseguila dalla CI o da un bastion host all'interno dello stesso VPC. L'immagine di runtime viene fornita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container App Runner. Per migrazioni con controllo di versione, effettua il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di release.

## Archiviazione dei file

Le istanze di App Runner non dispongono di un disco persistente, pertanto l'archiviazione locale dei file causerebbe una perdita silente di dati e il runtime la rifiuta in ambiente di produzione. Crea un bucket S3 nella stessa regione e imposta `STORAGE_TYPE=s3` con il relativo bucket e credenziali — vedi [Storage](/docs/backend/storage).

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist di produzione e le regole per il primo amministratore condivise da tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
