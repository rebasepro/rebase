---
sourceHash: 894fc95e8d4561d7
title: Deploy di Rebase su Microsoft Azure
description: Esegui il deploy della tua istanza Rebase in modo sicuro su Azure utilizzando Azure Database per PostgreSQL e Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure offre profonde integrazioni e conformità enterprise. L'architettura ottimale per eseguire Rebase su Azure utilizza **Azure Database for PostgreSQL – Flexible Server** per il livello dati e **Azure Container Apps** per il runtime.

Per rispettare la conformità europea sui dati e garantire tempi di risposta locali rapidi, effettua il provisioning delle risorse in aree geografiche come **West Europe (Amsterdam)**, **North Europe (Irlanda)** o **France Central (Parigi)**.

Nulla in questa pagina è specifico di Azure per quanto riguarda il tuo progetto. Un deployment di Rebase è composto da due parti separabili — l'immagine runtime pubblicata e il **bundle** prodotto da `rebase build` — e lo stesso bundle viene eseguito con Docker Compose su un laptop, su Rebase Cloud, tramite [Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Effettua il provisioning di PostgreSQL Flexible Server

1. Dal portale di Azure, cerca e seleziona **Azure Database for PostgreSQL servers**.
2. Fai clic su **Crea** e seleziona **Flexible Server**.
3. Scegli il tuo gruppo di risorse e imposta la tua area geografica UE preferita.
4. Seleziona le dimensioni di calcolo (es. General Purpose, o Burstable `B2s` per distribuzioni più piccole).
5. Configura la scheda **Authentication** con un nome utente amministratore e una password sicura.
6. In **Networking**, assicurati che l'opzione "Allow public access from any Azure service within Azure to this server" sia selezionata affinché la tua Container App possa connettersi, oppure configura una VNet sicura.
7. Prendi nota del nome del tuo server e componi l'URI di connessione:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Se le tue collection dichiarano una proprietà `vector`, abilita l'estensione una volta: Azure la vincola dietro il parametro del server `azure.extensions`, quindi esegui `CREATE EXTENSION vector;`.

## 2. Compila il bundle e integralo in un'immagine

**Non è richiesta alcuna immagine applicativa da compilare dal codice sorgente**. `rebase build` genera una directory `dist-bundle` contenente le collection compilate, le funzioni, i cron e — se il progetto dichiara un'app statica — il frontend compilato. L'immagine di runtime pubblicata la esegue:

```bash
rebase build
```

Container Apps effettua il pull da un registry, quindi incorpora il bundle in un'immagine derivata. Tre righe, e definisce esattamente ciò che viene eseguito:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.21.1
COPY dist-bundle /bundle
```

1. Crea un **Container Registry** nell'area geografica UE scelta.
2. Esegui l'accesso dalla tua CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Esegui il build e il push dalla radice del progetto:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

Aggiornare Rebase in seguito richiederà semplicemente una modifica a quella riga `FROM`. Il tuo bundle rimarrà invariato.

## 3. Effettua il deploy della Container App

Azure Container Apps fornisce un ambiente per container serverless con ingress HTTPS integrato.

1. Cerca **Container Apps** nel portale e fai clic su **Crea**.
2. Crea un nuovo ambiente Container Apps (Container Apps Environment) nella tua area geografica UE.
3. Nella scheda **Container**, punta al tuo registry ACR e seleziona l'immagine `rebase-backend:latest`.
4. Imposta le **Variabili d'ambiente**:

| Nome | Valore |
|------|-------|
| `DATABASE_URL` | La stringa di connessione ad Azure Postgres |
| `JWT_SECRET` | Una stringa casuale e sicura di oltre 32 caratteri |
| `REBASE_SERVICE_KEY` | Una stringa casuale e sicura di oltre 32 caratteri |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Il dominio del tuo frontend (es. `https://yourdomain.com`) |
| `FRONTEND_URL` | L'URL del tuo frontend (usato per i link nelle email e come fallback CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | L'indirizzo del primo amministratore, impostato **prima del primo avvio** |
| `REBASE_ADMIN_PASSWORD` | Almeno 12 caratteri |

Le ultime tre variabili sono ciò che consente a questo deployment di ottenere un amministratore: in produzione il primo account a registrarsi non viene promosso automaticamente, quindi nessun altro meccanismo crea il primo chiamante autenticato. Consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin). Memorizza i segreti come secret di Container Apps e fai riferimento ad essi, anziché usarli come valori d'ambiente in chiaro.

5. Nella scheda **Ingress**, abilita l'ingress.
6. Imposta la porta di destinazione su **8080** — la porta su cui l'immagine di runtime è in ascolto, a meno che `PORT` non indichi diversamente.
7. Punta la probe di integrità su `/livez`. Non su `/health`: quest'ultima esegue un round-trip con il database, quindi una liveness probe su di essa riavvierebbe un container altrimenti integro durante una breve interruzione temporanea del database.
8. Completa la creazione. Azure effettuerà il provisioning del container e fornirà un URL dell'applicazione protetto da TLS.

## 4. Lo schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collection.** `REBASE_MIGRATE_ON_BOOT` è impostato in modo predefinito su `ensure`, che opera in modo additivo sull'intero schema: crea le tabelle mancanti, le colonne e i tipi enum e applica la loro sicurezza a livello di riga (RLS) — in questo modo il primo avvio su un server vuoto inizia subito a servire le tue collection.

Ciò che `ensure` non fa mai è modificare elementi già esistenti: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy.

Due operazioni richiedono quindi ancora la CLI, eseguita da un checkout locale o da un job CI con `DATABASE_URL` puntato sul tuo Flexible Server (se necessario, aggiungi una regola del firewall che consenta il tuo IP client):

```bash
rebase db push
```

- **RLS delle tabelle di giunzione (junction-table)** per le relazioni molti-a-molti.
- **Qualsiasi modifica che non sia puramente additiva** — una colonna rinominata, un tipo con restrizioni maggiori, un campo rimosso.

L'immagine di runtime viene fornita senza la CLI, pertanto questo comando non viene mai eseguito all'interno del container. Per migrazioni con controllo di versione, esegui il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio della release.

## Storage dei file

Le repliche di Container Apps non dispongono di un disco permanente, pertanto l'archiviazione di file in locale comporta una perdita silenziosa di dati e il runtime la rifiuta in produzione. Crea un account Azure Storage e usa la sua interfaccia compatibile con S3, oppure un bucket compatibile con S3 nella stessa area geografica, specificando `STORAGE_TYPE=s3` — consulta [Storage](/docs/backend/storage).

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore comuni a tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
