---
sourceHash: 80f640adab500773
title: Distribuire Rebase su Microsoft Azure
description: Distribuisci la tua istanza Rebase in modo sicuro su Azure utilizzando Azure Database for PostgreSQL e Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure offre integrazioni avanzate e conformità di livello enterprise. L'architettura ottimale per eseguire Rebase su Azure utilizza **Azure Database for PostgreSQL – Flexible Server** per il livello dati e **Azure Container Apps** per il runtime.

Per garantire la conformità con le normative europee sui dati e tempi di risposta locali rapidi, effettua il provisioning delle tue risorse in regioni come **West Europe (Amsterdam)**, **North Europe (Ireland)** o **France Central (Paris)**.

Nulla in questa pagina è specifico di Azure per quanto riguarda il tuo progetto. Un deployment di Rebase è composto da due parti separabili: l'immagine runtime pubblicata e il **bundle** prodotto da `rebase build`; lo stesso bundle può essere eseguito con Docker Compose su un portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Provisioning di PostgreSQL Flexible Server

1. Dal portale Azure, cerca e seleziona **Azure Database for PostgreSQL servers**.
2. Fai clic su **Crea** e seleziona **Flexible Server**.
3. Scegli il tuo Gruppo di risorse (Resource Group) e imposta la tua regione UE preferita.
4. Seleziona la dimensione di calcolo (Compute size) (es. General Purpose o Burstable `B2s` per deployment più piccoli).
5. Configura la scheda **Autenticazione** con un nome utente amministratore e una password sicura.
6. Sotto **Rete**, assicurati che l'opzione "Consenti l'accesso pubblico da qualsiasi servizio Azure all'interno di Azure a questo server" sia selezionata affinché la tua Container App possa connettersi, oppure configura una VNet sicura.
7. Annota il nome del server e componi l'URI di connessione:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Se le tue tabelle dichiarano una colonna `col.vector()`, abilita l'estensione una sola volta: Azure la vincola dietro il parametro del server `azure.extensions`, quindi esegui `CREATE EXTENSION vector;`.

## 2. Creare il bundle e integrarlo in un'immagine

Non c'è **nessuna immagine dell'applicazione da compilare dal tuo codice sorgente**. `rebase build` genera una directory `dist-bundle` con le tabelle compilate, le funzioni, i cron job e, se il tuo progetto dichiara un'app statica, il frontend compilato. L'immagine di runtime pubblicata lo esegue:

```bash
rebase build
```

Container Apps effettua il pull da un registry, quindi incorpora il bundle in un'immagine derivata. Tre righe, e fissa esattamente ciò che viene eseguito:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Crea un **Container Registry** nella regione UE scelta.
2. Esegui il login dalla tua CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Esegui il build e il push dalla radice del progetto:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

L'aggiornamento futuro di Rebase richiederà solo la modifica di quella riga `FROM`. Il tuo bundle rimane invariato.

## 3. Distribuire la Container App

Azure Container Apps fornisce un ambiente per container serverless con ingress HTTPS integrato.

1. Cerca **Container Apps** nel portale e fai clic su **Crea**.
2. Crea un nuovo Container Apps Environment nella tua regione UE.
3. Nella scheda **Container**, punta al tuo registry ACR e seleziona l'immagine `rebase-backend:latest`.
4. Imposta le **Variabili d'ambiente**:

| Nome | Valore |
|------|-------|
| `DATABASE_URL` | La tua stringa di connessione ad Azure Postgres |
| `JWT_SECRET` | Una stringa casuale e sicura di almeno 32 caratteri |
| `REBASE_SERVICE_KEY` | Una stringa casuale e sicura di almeno 32 caratteri |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Il dominio del tuo frontend (es. `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL del tuo frontend (utilizzato per i link nelle email e come fallback per CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'indirizzo del primo amministratore, impostato **prima del primo avvio** |
| `REBASE_ADMIN_PASSWORD` | Almeno 12 caratteri |

Le ultime tre consentono al deployment di avere un amministratore: in produzione il primo account che si registra non viene promosso, quindi nient'altro genera il primo chiamante autenticato. Consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin). Archivia i secret come secret di Container Apps e fai riferimento ad essi, anziché inserirli come semplici valori di ambiente.

5. Nella scheda **Ingress**, abilita l'ingress.
6. Imposta la porta di destinazione su **8080** — la porta su cui l'immagine di runtime è in ascolto a meno che `PORT` non indichi diversamente.
7. Fai puntare l'health probe a `/livez`. Non a `/health`: quest'ultimo esegue un round-trip con il database, quindi una liveness probe su di esso riavvierebbe un container sano durante un breve disservizio del database.
8. Completa la creazione. Azure effettuerà il provisioning del container fornendoti un URL dell'applicazione protetto da TLS.

## 4. Lo schema

<span class="since-badge" data-since="0.31">Da 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate da `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che opera in modo additivo sull'intero schema: crea le tabelle, le colonne e i tipi enum mancanti e applica la loro row-level security, consentendo al primo avvio su un server vuoto di iniziare subito a servire le tue collezioni.

Ciò che `ensure` non fa mai è modificare qualcosa di già esistente: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy.

Un'operazione richiede quindi ancora l'uso della CLI, eseguita da un checkout locale o da un job di CI con `DATABASE_URL` puntato al tuo Flexible Server (se necessario, aggiungi una regola firewall che consenta l'IP del tuo client):

```bash
rebase db push
```

Qualsiasi modifica che non sia puramente additiva: una colonna rinominata, un tipo ristretto, un campo rimosso.

L'immagine di runtime viene fornita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container. Per le migrazioni con controllo di versione, effettua il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di rilascio.

## Archiviazione dei file

Le repliche di Container Apps non dispongono di un disco permanente; pertanto, l'archiviazione locale dei file comporterebbe una perdita silenziosa di dati e il runtime la rifiuta in produzione. Poiché Azure Blob Storage non supporta l'API S3, utilizza un bucket compatibile con S3 nella stessa regione con `STORAGE_TYPE=s3` e il rispettivo `S3_ENDPOINT` — consulta [Storage](/docs/backend/storage).

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore condivise da tutte le piattaforme.
- [Configuration](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
