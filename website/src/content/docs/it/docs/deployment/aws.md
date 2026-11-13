---
sourceHash: 93b3163dd1b482fd
title: Deploy di Rebase su AWS
description: Esegui il deploy della tua istanza Rebase in modo sicuro su Amazon Web Services utilizzando RDS e AWS App Runner con una forte attenzione alla conformità europea.
sidebar_label: AWS
---

Amazon Web Services (AWS) offre una scalabilità straordinaria e una sicurezza di livello enterprise. Per un deploy di Rebase in produzione, consigliamo di disaccoppiare l'architettura utilizzando **Amazon RDS** per il database PostgreSQL e **AWS App Runner** (o ECS Fargate) per eseguire il runtime.

Per garantire una rigorosa conformità ai requisiti europei sui dati, assicurati di operare interamente all'interno di una regione UE, come **eu-central-1 (Francoforte)**, **eu-west-1 (Irlanda)** o **eu-west-3 (Parigi)**.

Nessun elemento in questa pagina è strettamente specifico di AWS per quanto riguarda il tuo progetto. Un deploy di Rebase è composto da due parti separabili: l'immagine runtime pubblicata e il **bundle** prodotto da `rebase build`. Lo stesso bundle può essere eseguito con Docker Compose su un computer portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui. Passare da una soluzione all'altra rappresenta una modifica all'infrastruttura, non all'applicazione.

## 1. Provisioning di Amazon RDS (PostgreSQL)

1. Vai alla console **RDS** nella regione UE selezionata.
2. Fai clic su **Create database** (Crea database) e seleziona **Standard create** (Creazione standard).
3. Scegli il motore **PostgreSQL**.
4. Nella sezione Templates (Modelli), scegli **Production** (Produzione) o **Free tier/Dev** (Livello gratuito/Sviluppo) a seconda del tuo carico di lavoro.
5. Crea un Master Username (es. `rebase_admin`) e genera una Master Password sicura.
6. Nella sezione Connectivity (Connettività), assicurati che il database si trovi all'interno di un **VPC** a cui la tua futura istanza App Runner possa accedere in modo sicuro (oppure rendilo accessibile pubblicamente limitando rigorosamente gli intervalli IP di ingresso).
7. Una volta completato il provisioning, prendi nota dell'**Endpoint address** (Indirizzo endpoint) e componi il tuo URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Se le tue tabelle dichiarano una colonna `col.vector()`, l'istanza necessita dell'estensione `pgvector` — RDS la include già, ma deve essere abilitata eseguendo una volta `CREATE EXTENSION vector;` sul database.

## 2. Compilare il bundle e integrarlo in un'immagine

Non c'è **alcuna immagine applicativa da compilare a partire dal codice sorgente**. Il comando `rebase build` genera una directory `dist-bundle` contenente tabelle compilate, funzioni, cron job e — se il progetto dichiara un'app statica — il frontend compilato. L'immagine runtime pubblicata si occuperà di eseguirlo:

```bash
rebase build
```

Per App Runner, che scarica le immagini da un registro, integra il bundle all'interno di un'immagine derivata. Si tratta di tre righe che vincolano esattamente ciò che viene eseguito:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Vai su **Elastic Container Registry** e crea un repository privato chiamato `rebase-backend`.
2. Prendi i comandi di push mostrati dalla console AWS — gestiscono l'autenticazione Docker.
3. Esegui la build e il push dalla radice del progetto:
   ```bash
   docker build -t rebase-backend .
   ```
4. Assegna il tag ed effettua il push sul tuo repository ECR.

L'aggiornamento futuro di Rebase consisterà unicamente nella modifica di quella riga `FROM`. Il tuo bundle rimarrà invariato e non sarà necessario ricompilare nulla del tuo progetto.

## 3. Deploy tramite AWS App Runner

App Runner è il modo più semplice per eseguire container su AWS senza dover gestire orchestratori.

1. Vai su **AWS App Runner** e fai clic su **Create service** (Crea servizio).
2. Seleziona **Container registry** e scegli **Amazon ECR**.
3. Sfoglia e seleziona la tua immagine `rebase-backend`.
4. Nella sezione **Service settings** (Impostazioni del servizio), imposta la porta su **8080** — la porta su cui l'immagine runtime rimane in ascolto, a meno che non sia specificato diversamente tramite `PORT`.
5. Imposta il percorso di **health check** su `/livez`. Non `/health`: quest'ultimo esegue un round-trip con il database, quindi una liveness probe su di esso riavvierebbe un servizio perfettamente integro durante un momentaneo problema del database.
6. Aggiungi le variabili d'ambiente:

| Chiave | Valore |
|-----|-------|
| `DATABASE_URL` | La stringa di connessione a RDS |
| `JWT_SECRET` | Una stringa sicura generata casualmente (32+ caratteri) |
| `REBASE_SERVICE_KEY` | Una stringa sicura generata casualmente (32+ caratteri) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Il dominio del tuo frontend (es. `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL del tuo frontend (usato per i link nelle email e come fallback per CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'indirizzo del primo amministratore, impostato **prima del primo avvio** |
| `REBASE_ADMIN_PASSWORD` | Almeno 12 caratteri |

Le ultime tre variabili rappresentano il modo in cui questo deploy ottiene un amministratore: in produzione, il primo account a registrarsi non viene promosso ad admin, quindi nient'altro genererà il primo utente autenticato. Consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin). Inserisci i secret in AWS Secrets Manager e fai riferimento a essi invece di digitarli nel modulo della console.

7. (Opzionale) Se l'istanza RDS è strettamente privata, configura la rete **Custom VPC** in App Runner in modo che il container possa raggiungere il database.
8. Fai clic su **Create & deploy** (Crea e distribuisci).

AWS gestisce la terminazione TLS, fornendo un URL `https` pronto all'uso.

## 4. Lo schema

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate da `backend/schema`.** Il valore predefinito di `REBASE_MIGRATE_ON_BOOT` è `ensure`, che applica modifiche di tipo additivo all'intero schema — crea tabelle, colonne e tipi enum mancanti e ne applica la row-level security — in modo che il primo avvio su un'istanza RDS vuota sia subito pronto a servire le tue collezioni.

Ciò che `ensure` non fa mai è modificare elementi già esistenti: non altera il tipo di una colonna, non rimuove elementi e non modifica i valori di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy.

Una cosa richiede quindi ancora l'uso della CLI, eseguita da un checkout locale o da un job di CI con `DATABASE_URL` puntato su RDS:

```bash
rebase db push
```

Qualsiasi modifica che non sia puramente additiva — una colonna rinominata, un tipo ristretto, un campo rimosso.

Se l'istanza è privata, eseguila dalla CI o da un bastion host all'interno dello stesso VPC. L'immagine runtime viene distribuita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container App Runner. Per migrazioni versionate, esegui il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di rilascio.

## Archiviazione dei file

Le istanze App Runner non dispongono di dischi persistenti, pertanto lo storage locale comporterebbe una perdita invisibile di dati e il runtime lo rifiuta in produzione. Crea un bucket S3 nella stessa regione e imposta `STORAGE_TYPE=s3` con il relativo bucket e le credenziali — consulta [Storage](/docs/backend/storage).

## Passaggi successivi

- [Deploy](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore comuni a ogni piattaforma.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
