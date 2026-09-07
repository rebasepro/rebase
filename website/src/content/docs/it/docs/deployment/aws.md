---
sourceHash: 936afac32ad9dc9d
title: Implementazione di Rebase su AWS
description: Implementa la tua istanza Rebase in modo sicuro su Amazon Web Services utilizzando RDS e AWS App Runner con una forte attenzione all'Europa.
sidebar_label: AWS
---

Amazon Web Services (AWS) offre una scalabilità incredibile e una sicurezza di livello enterprise. Per un'implementazione di produzione di Rebase, raccomandiamo di disaccoppiare l'architettura utilizzando **Amazon RDS** per il database PostgreSQL e **AWS App Runner** (o ECS Fargate) per servire il backend Node.js.

Per mantenere una stretta conformità ai dati europei, assicurati di operare interamente all'interno di una regione UE, come **eu-central-1 (Francoforte)**, **eu-west-1 (Irlanda)** o **eu-west-3 (Parigi)**.

## 1. Provisioning di Amazon RDS (PostgreSQL)

1. Naviga alla console **RDS** nella regione UE selezionata.
2. Clicca su **Crea database** e seleziona **Creazione standard**.
3. Scegli il motore **PostgreSQL**.
4. Sotto Modelli, scegli **Produzione** o **Livello gratuito/Sviluppo** a seconda del tuo carico.
5. Crea un Nome utente principale (es. `rebase_admin`) e genera in modo sicuro una Password principale.
6. Sotto Connettività, assicurati che il database sia collocato all'interno di una **VPC** a cui la tua futura istanza App Runner possa accedere in modo sicuro (o rendilo pubblicamente accessibile se controlli rigorosamente gli intervalli IP di ingresso).
7. Una volta effettuato il provisioning, annota l'**indirizzo dell'endpoint** e assembla il tuo URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

## 2. Carica l'immagine su ECR (Elastic Container Registry)

AWS App Runner preleva direttamente da ECR.

**Non c'è nessuna immagine applicativa da costruire dal tuo sorgente**. `rebase build` produce una directory `dist-bundle` con le tue collezioni, funzioni e cron compilati — e, se il progetto dichiara un'app statica, il frontend costruito. L'immagine di runtime pubblicata la esegue:

```bash
rebase build
```

App Runner preleva da un registry, quindi incorpora il bundle in un'immagine derivata. Tre righe, e fissa esattamente ciò che gira:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Aggiornare Rebase in seguito è una modifica a quella riga `FROM`. Il tuo bundle resta intatto.

1. Naviga su **Elastic Container Registry** e crea un nuovo repository privato chiamato `rebase-backend`.
2. Recupera i comandi di push forniti da AWS nella console (che gestiscono l'autenticazione Docker).
3. Costruisci e carica dalla radice del progetto:
   ```bash
   docker build -t rebase-backend .
   ```
4. Tagga e caricala nel tuo repository ECR appena creato.

## 3. Implementazione tramite AWS App Runner

App Runner è il modo più semplice per eseguire container su AWS senza gestire orchestratori.

1. Naviga su **AWS App Runner** e clicca su **Crea servizio**.
2. Seleziona **Registro di container** e scegli **Amazon ECR**.
3. Sfoglia e seleziona la tua immagine `rebase-backend`.
4. Sotto **Impostazioni del servizio**, imposta la Porta su **3001**.
5. Aggiungi le Variabili d'ambiente necessarie nella scheda di configurazione:
   
| Chiave | Valore |
|-----|-------|
| `DATABASE_URL` | La tua stringa di connessione RDS |
| `JWT_SECRET` | Un hash sicuro generato casualmente (32+ caratteri) |
| `NODE_ENV` | `production` |

6. (Facoltativo) Se la tua istanza RDS è strettamente privata, configura la rete **VPC personalizzata** in App Runner in modo che il container possa comunicare in modo sicuro con il database.
7. Clicca su **Crea e implementa**.

AWS gestirà la terminazione TLS (fornendo un URL `https` pronto all'uso) e avvierà il server Rebase.

## 4. Crea lo Schema del Database

All'avvio Rebase crea automaticamente **solo le tabelle di autenticazione**. Le tabelle per le tue collezioni **non** vengono create automaticamente: l'app si avvia comunque e il login funziona, quindi è facile non accorgersene, finché ogni collezione non restituisce un errore "missing table".

Esegui la sincronizzazione dello schema una volta contro il database di produzione:

```bash
pnpm run db:push
```

Eseguilo da un checkout del progetto o dalla CI con `DATABASE_URL` che punta alla produzione, **non** dall'interno del container: l'immagine di produzione non include la CLI. Poiché l'istanza RDS di solito vive in una VPC privata, esegui il comando da un host che può raggiungerla — ad esempio un bastion nella stessa VPC o un job CI con accesso di rete al database.

Se preferisci migrazioni versionate a una sincronizzazione diretta, usa invece `pnpm run db:generate` seguito da `pnpm run db:migrate`.

---
