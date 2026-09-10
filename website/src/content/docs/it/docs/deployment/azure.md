---
sourceHash: fcd75234f992e56c
title: Deploy di Rebase su Microsoft Azure
description: Distribuisci la tua istanza di Rebase in modo sicuro su Azure utilizzando Azure Database for PostgreSQL e Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure offre una stretta integrazione e conformità enterprise. L'architettura ottimale per l'esecuzione di Rebase su Azure prevede l'uso di **Azure Database for PostgreSQL – Flexible Server** per il livello dati e **Azure Container Apps** per il runtime.

Per garantire la conformità europea sui dati e tempi di risposta locali rapidi, effettua il provisioning delle risorse in aree geografiche come **West Europe (Amsterdam)**, **North Europe (Irlanda)** o **France Central (Parigi)**.

Niente in questa pagina è specifico di Azure per quanto riguarda il tuo progetto. Una distribuzione di Rebase è composta da due parti separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build`; lo stesso bundle può essere eseguito con Docker Compose su un laptop, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Provisioning di PostgreSQL Flexible Server

1. Dall'Azure Portal, cerca e seleziona **Azure Database for PostgreSQL servers**.
2. Fai clic su **Create** e seleziona **Flexible Server**.
3. Scegli il tuo Resource Group e imposta la regione UE preferita.
4. Seleziona la dimensione di calcolo (es. General Purpose, o Burstable `B2s` per distribuzioni più piccole).
5. Configura la scheda **Authentication** con un nome utente amministratore e una password sicura.
6. Sotto **Networking**, assicurati che l'opzione "Allow public access from any Azure service within Azure to this server" sia selezionata in modo che la tua Container App possa connettersi, oppure configura una VNet sicura.
7. Prendi nota del nome del tuo server e componi l'URI di connessione:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Se le tue collection dichiarano una proprietà `vector`, abilita l'estensione una tantum: Azure la vincola dietro il parametro server `azure.extensions`, poi esegui `CREATE EXTENSION vector;`.

## 2. Compila il bundle e integralo in un'immagine

Non c'è **alcuna immagine applicativa da compilare dal tuo codice sorgente**. `rebase build` produce una directory `dist-bundle` con le tue collection compilate, funzioni, cron e — se il tuo progetto dichiara un'app statica — il tuo frontend compilato. L'immagine di runtime pubblicata la esegue:

```bash
rebase build
```

Container Apps effettua il pull da un registro, quindi incorpora il bundle in un'immagine derivata. Tre righe, e definisce esattamente cosa viene eseguito:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

1. Crea un **Container Registry** nella regione UE prescelta.
2. Effettua il login dalla CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Esegui la build e il push dalla root del progetto:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

L'aggiornamento successivo di Rebase consiste solo nella modifica di quella riga `FROM`. Il tuo bundle rimane intatto.

## 3. Distribuisci la Container App

Azure Container Apps offre un ambiente container serverless con ingress HTTPS integrato.

1. Cerca **Container Apps** nel portale e fai clic su **Create**.
2. Crea un nuovo Container Apps Environment nella tua regione UE.
3. Nella scheda **Container**, punta al tuo registro ACR e seleziona l'immagine `rebase-backend:latest`.
4. Imposta le **Variabili d'ambiente**:

| Nome | Valore |
|------|-------|
| `DATABASE_URL` | La tua stringa di connessione ad Azure Postgres |
| `JWT_SECRET` | Una stringa casuale sicura di oltre 32 caratteri |
| `REBASE_SERVICE_KEY` | Una stringa casuale sicura di oltre 32 caratteri |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Il dominio del tuo frontend (es. `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL del tuo frontend (utilizzato per i link nelle email e come fallback per CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'indirizzo del primo amministratore, impostato **prima del primo avvio** |
| `REBASE_ADMIN_PASSWORD` | Almeno 12 caratteri |

Le ultime tre sono il modo in cui questo deployment ottiene un amministratore: in produzione il primo account a registrarsi non viene promosso automaticamente, quindi nient'altro genererà il primo utente autenticato. Consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin). Archivia i secret come Container Apps secret e fai riferimento ad essi, anziché inserirli come semplici valori di variabili d'ambiente.

5. Sotto la scheda **Ingress**, abilita l'ingress.
6. Imposta la porta di destinazione (Target Port) su **8080** — la porta su cui l'immagine di runtime è in ascolto, a meno che non sia specificato diversamente da `PORT`.
7. Punta l'health probe verso `/livez`. Non verso `/health`: quest'ultimo esegue un round-trip al database, quindi un liveness probe puntato lì riavvierebbe un container sano durante un momentaneo singhiozzo del database.
8. Completa la creazione. Azure eseguirà il provisioning del container fornendoti un URL dell'applicazione protetto da TLS.

## 4. Lo schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collection.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che ha un comportamento additivo sull'intero schema: crea le tabelle, le colonne e i tipi enum mancanti e applica la loro row-level security. In questo modo, il primo avvio su un server vuoto sarà già pronto a gestire le tue collection.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy.

Due operazioni richiedono quindi ancora la CLI, eseguita da un checkout locale o da un job di CI con `DATABASE_URL` puntato al tuo Flexible Server (se necessario, aggiungi una regola di firewall che consenta l'accesso al tuo IP client):

```bash
rebase db push
```

- **RLS per le tabelle di giunzione** per le relazioni molti-a-molti.
- **Qualsiasi modifica che non sia puramente additiva** — una colonna rinominata, un tipo ristretto, un campo rimosso.

L'immagine di runtime viene fornita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container. Per le migrazioni con controllo di versione, effettua invece il commit dei file di migrazione con `rebase db generate` ed esegui `rebase db migrate` come passaggio di rilascio.

## File storage

Le repliche di Container Apps non dispongono di un disco persistente, pertanto l'archiviazione locale dei file causerebbe una perdita silenziosa di dati e il runtime la rifiuta in produzione. Crea un account Azure Storage e utilizza la sua interfaccia compatibile con S3, oppure un bucket compatibile con S3 nella stessa regione, con `STORAGE_TYPE=s3` — consulta [Storage](/docs/backend/storage).

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore condivise da tutte le piattaforme.
- [Configuration](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.

---
