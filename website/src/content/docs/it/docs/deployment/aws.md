---
sourceHash: d1312f112637705d
title: Distribuzione di Rebase su AWS
description: Distribuisci la tua istanza Rebase in modo sicuro su Amazon Web Services utilizzando RDS e AWS App Runner con una forte attenzione ai requisiti europei.
sidebar_label: AWS
---

Amazon Web Services (AWS) offre una scalabilità incredibile e sicurezza di livello enterprise. Per una distribuzione di Rebase in produzione, consigliamo di disaccoppiare l'architettura utilizzando **Amazon RDS** per il database PostgreSQL e **AWS App Runner** (o ECS Fargate) per eseguire il runtime.

Per garantire la rigorosa conformità europea in materia di dati, assicurati di operare interamente all'interno di una regione UE, come **eu-central-1 (Francoforte)**, **eu-west-1 (Irlanda)** o **eu-west-3 (Parigi)**.

Nulla in questa pagina riguarda il tuo progetto in modo specifico per AWS. Una distribuzione di Rebase è composta da due parti separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build`; e lo stesso bundle viene eseguito con Docker Compose su un laptop, su Rebase Cloud, con l'[Helm chart](/docs/deployment/kubernetes) e qui. Il passaggio tra queste opzioni è un cambio di infrastruttura, non di applicazione.

## 1. Eseguire il provisioning di Amazon RDS (PostgreSQL)

1. Accedi alla console **RDS** nella regione UE selezionata.
2. Fai clic su **Create database** e seleziona **Standard create**.
3. Scegli il motore **PostgreSQL**.
4. In Templates, scegli **Production** o **Free tier/Dev** in base al carico di lavoro previsto.
5. Crea un Master Username (es. `rebase_admin`) e genera una Master Password sicura.
6. In Connectivity, assicurati che il database si trovi all'interno di una **VPC** a cui la tua futura istanza di App Runner possa accedere in modo sicuro (oppure rendilo pubblicamente accessibile se controlli rigorosamente gli intervalli IP in entrata).
7. Una volta completato il provisioning, prendi nota dell'**Endpoint address** e componi il tuo URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Se le tue collection dichiarano una proprietà `vector`, l'istanza richiede l'estensione `pgvector` — RDS la include, ma deve essere abilitata eseguendo una volta `CREATE EXTENSION vector;` sul database.

## 2. Creare il bundle e incorporarlo in un'immagine

**Non c'è alcuna immagine applicativa da compilare dal tuo codice sorgente**. `rebase build` produce una directory `dist-bundle` contenente le tue collection compilate, funzioni, cron e — se il tuo progetto dichiara una static app — il tuo frontend compilato. L'immagine di runtime pubblicata la esegue:

```bash
rebase build
```

Per App Runner, che esegue il pull da un registro, incorpora il bundle in un'immagine derivata. Si tratta di tre righe e fissa esattamente ciò che viene eseguito:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

1. Accedi a **Elastic Container Registry** e crea un repository privato chiamato `rebase-backend`.
2. Copia i comandi di push mostrati da AWS nella console — gestiscono l'autenticazione Docker.
3. Esegui build e push dalla root del progetto:
   ```bash
   docker build -t rebase-backend .
   ```
4. Applica il tag ed effettua il push verso il tuo repository ECR.

Aggiornare Rebase in seguito richiederà solo la modifica di quella riga `FROM`. Il tuo bundle rimane intatto e nulla del tuo progetto viene ricompilato.

## 3. Distribuire tramite AWS App Runner

App Runner è il modo più semplice per eseguire container su AWS senza dover gestire orchestratori.

1. Accedi ad **AWS App Runner** e fai clic su **Create service**.
2. Seleziona **Container registry** e scegli **Amazon ECR**.
3. Sfoglia e seleziona la tua immagine `rebase-backend`.
4. In **Service settings**, imposta la porta su **8080** — la porta su cui l'immagine di runtime è in ascolto, a meno che `PORT` non indichi diversamente.
5. Imposta il percorso dell'**health check** su `/livez`. Non `/health`: questo effettua un round-trip verso il database, quindi una liveness probe su di esso riavvierebbe un servizio perfettamente integro durante una breve interruzione temporanea del database.
6. Aggiungi le variabili d'ambiente:

| Chiave | Valore |
|--------|--------|
| `DATABASE_URL` | La tua stringa di connessione a RDS |
| `JWT_SECRET` | Una stringa sicura generata casualmente (32+ caratteri) |
| `REBASE_SERVICE_KEY` | Una stringa sicura generata casualmente (32+ caratteri) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Il dominio del tuo frontend (es. `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL del tuo frontend (usato per i link nelle email e come fallback CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'indirizzo del primo amministratore, impostato **prima del primo avvio** |
| `REBASE_ADMIN_PASSWORD` | Almeno 12 caratteri |

Le ultime tre servono a fare in modo che la distribuzione abbia effettivamente un amministratore: in produzione il primo account che si registra non viene promosso a questo ruolo, quindi nient'altro genererebbe il primo utente autenticato. Consulta [Il tuo primo admin](/docs/getting-started/deployment/#your-first-admin). Inserisci i segreti in AWS Secrets Manager e referenziali invece di digitarli direttamente nel modulo della console.

7. (Facoltativo) Se la tua istanza RDS è strettamente privata, configura il networking **Custom VPC** in App Runner in modo che il container possa raggiungere il database.
8. Fai clic su **Create & deploy**.

AWS gestisce la terminazione TLS, fornendo direttamente un URL `https` pronto all'uso.

## 4. Lo schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collection.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che opera in modo additivo sull'intero schema — crea tabelle, colonne e tipi enum mancanti e applica la loro row-level security — così il primo avvio su un'istanza RDS vuota è subito in grado di gestire le tue collection.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy.

Due operazioni richiedono quindi ancora l'uso della CLI, eseguita da un checkout locale o da un job di CI con `DATABASE_URL` puntato a RDS:

```bash
rebase db push
```

- **RLS delle tabelle di giunzione (junction-table)** per le relazioni molti-a-molti.
- **Qualsiasi modifica non puramente additiva** — una colonna rinominata, un tipo con vincoli più restrittivi, un campo rimosso.

Se l'istanza è privata, eseguila dalla CI o da un bastion host all'interno della stessa VPC. L'immagine di runtime viene distribuita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container di App Runner. Per le migrazioni con controllo di versione, esegui il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di release.

## Archiviazione file

Le istanze di App Runner non dispongono di un disco persistente, pertanto lo storage locale dei file comporterebbe una perdita silenziosa di dati e il runtime lo rifiuta in produzione. Crea un bucket S3 nella stessa regione e imposta `STORAGE_TYPE=s3` specificando bucket e credenziali — vedi [Storage](/docs/backend/storage).

## Prossimi passi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore comuni a ogni piattaforma.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.

---
