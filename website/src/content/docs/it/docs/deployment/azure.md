---
sourceHash: 1fdfb40ed3615bbd
title: Distribuzione di Rebase su Microsoft Azure
description: Distribuisci la tua istanza Rebase in modo sicuro su Azure utilizzando Azure Database for PostgreSQL e Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure offre integrazioni avanzate e conformità aziendale di livello enterprise. L'architettura ottimale per l'esecuzione di Rebase su Azure utilizza **Azure Database for PostgreSQL – Flexible Server** per il livello dati e **Azure Container Apps** per il runtime.

Per rispettare la conformità europea sui dati e garantire tempi di risposta locali rapidi, esegui il provisioning delle risorse in regioni come **West Europe (Amsterdam)**, **North Europe (Ireland)** o **France Central (Paris)**.

Nulla in questa pagina riguarda nello specifico Azure per quanto concerne il tuo progetto. Un deployment di Rebase è composto da due parti separabili — l'immagine di runtime pubblicata e il **bundle** generato da `rebase build` — e lo stesso bundle può essere eseguito con Docker Compose su un portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) o qui.

## 1. Effettua il provisioning di PostgreSQL Flexible Server

1. Dal portale Azure, cerca e seleziona **Azure Database for PostgreSQL servers**.
2. Fai clic su **Create** e seleziona **Flexible Server**.
3. Scegli il tuo Gruppo di risorse (Resource Group) e imposta la tua area geografica europea (EU Region) preferita.
4. Seleziona le dimensioni di calcolo (Compute size, es. General Purpose o Burstable `B2s` per distribuzioni più piccole).
5. Configura la scheda **Authentication** con un nome utente amministratore e una password sicura.
6. Nella sezione **Networking**, assicurati che l'opzione "Allow public access from any Azure service within Azure to this server" sia selezionata affinché la tua Container App possa connettersi, oppure configura una VNet sicura.
7. Prendi nota del nome del server e componi l'URI di connessione:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Se le tue tabelle dichiarano una colonna `col.vector()`, abilita l'estensione una sola volta: Azure la vincola al parametro del server `azure.extensions`, quindi esegui `CREATE EXTENSION vector;`.

## 2. Crea il bundle e integralo in un'immagine

Non c'è **alcuna immagine dell'applicazione da compilare a partire dal tuo codice sorgente**. `rebase build` genera una directory `dist-bundle` contenente tabelle, funzioni, cron compilati e — se il tuo progetto dichiara un'app statica — il frontend compilato. L'immagine di runtime pubblicata la eseguirà:

```bash
rebase build
```

Container Apps esegue il pull da un registry, quindi integra il bundle in un'immagine derivata. Tre righe, e definisce esattamente cosa viene eseguito:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Crea un **Container Registry** nella regione UE prescelta.
2. Esegui il login dalla CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Esegui il build e il push, dalla directory radice del progetto:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

L'aggiornamento futuro di Rebase richiede solo la modifica di quella riga `FROM`. Il tuo bundle rimane invariato.

## 3. Distribuisci la Container App

Azure Container Apps fornisce un ambiente per container serverless con ingress HTTPS integrato.

1. Cerca **Container Apps** nel portale e fai clic su **Create**.
2. Crea un nuovo Container Apps Environment nella tua regione UE.
3. Nella scheda **Container**, punta al tuo registry ACR e seleziona l'immagine `rebase-backend:latest`.
4. Imposta le **Variabili di ambiente** (Environment variables):

| Name | Value |
|------|-------|
| `DATABASE_URL` | La stringa di connessione ad Azure Postgres |
| `JWT_SECRET` | Una stringa casuale e sicura di oltre 32 caratteri |
| `REBASE_SERVICE_KEY` | Una stringa casuale e sicura di oltre 32 caratteri |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Il dominio del tuo frontend (es. `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL del tuo frontend (utilizzato per i link nelle email e come fallback CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'indirizzo del primo amministratore, impostato **prima del primo avvio** |
| `REBASE_ADMIN_PASSWORD` | Almeno 12 caratteri |

Le ultime tre variabili definiscono il modo in cui questo deployment ottiene un amministratore iniziale: in produzione il primo account che si registra non viene promosso, pertanto nient'altro genererà il primo utente autenticato. Consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin). Salva i segreti come secret di Container Apps e referenziali, anziché inserirli come valori di ambiente in chiaro.

5. Nella scheda **Ingress**, abilita l'ingress.
6. Imposta la Target Port su **8080** — la porta su cui l'immagine di runtime è in ascolto, a meno che non sia specificato diversamente da `PORT`.
7. Fai puntare l'health probe a `/livez`. Non a `/health`: quest'ultimo esegue un round-trip verso il database, quindi una liveness probe su di esso riavvierebbe un container altrimenti integro durante un breve singhiozzo del database.
8. Completa la creazione. Azure effettuerà il provisioning del container e ti fornirà un Application URL protetto con TLS.

## 4. Lo schema

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate in `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che è additivo per l'intero schema — crea tabelle, colonne e tipi enum mancanti e applica la loro row-level security — in modo che il primo avvio su un server vuoto sia subito pronto a gestire le tue tabelle.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy.

Un'operazione richiede quindi ancora la CLI, eseguita da un checkout locale o da un job CI con `DATABASE_URL` puntato al tuo Flexible Server (se necessario, aggiungi una regola firewall che consenta il tuo IP client):

```bash
rebase db push
```

Qualsiasi modifica che non sia puramente additiva — una colonna rinominata, un tipo ristretto, un campo rimosso.

L'immagine di runtime viene distribuita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container. Per migrazioni con controllo di versione, esegui il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio della release.

## Archiviazione file

Le repliche di Container Apps non dispongono di un disco permanente, pertanto l'archiviazione locale dei file comporterebbe una perdita silenziosa dei dati e il runtime la rifiuta in produzione. Azure Blob Storage non supporta l'API S3, quindi utilizza un bucket compatibile con S3 nella stessa regione con `STORAGE_TYPE=s3` e il relativo `S3_ENDPOINT` — consulta [Storage](/docs/backend/storage).

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore condivise da tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili di ambiente lette dal runtime.
