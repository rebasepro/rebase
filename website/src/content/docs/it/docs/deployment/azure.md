---
sourceHash: 44b8d8c5aa0525b6
title: Distribuzione di Rebase su Microsoft Azure
description: Distribuisci la tua istanza Rebase in modo sicuro su Azure utilizzando Azure Database for PostgreSQL e Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure offre integrazioni strette e conformità aziendale. L'architettura ottimale per l'esecuzione di Rebase su Azure prevede l'utilizzo di **Azure Database for PostgreSQL - Flexible Server** per il livello dati e **Azure Container Apps** per l'hosting del container di backend.

Per aderire alla conformità dei dati europea e garantire tempi di risposta locali rapidi, effettua il provisioning delle tue risorse in regioni come **Europa Occidentale (Amsterdam)**, **Europa Settentrionale (Irlanda)** o **Francia Centrale (Parigi)**.

## 1. Provisioning di PostgreSQL Flexible Server

**Non c'è nessuna immagine applicativa da costruire dal tuo sorgente**. `rebase build` produce una directory `dist-bundle` con le tue collezioni, funzioni e cron compilati — e, se il progetto dichiara un'app statica, il frontend costruito. L'immagine di runtime pubblicata la esegue:

```bash
rebase build
```

Container Apps preleva da un registry, quindi incorpora il bundle in un'immagine derivata. Tre righe, e fissa esattamente ciò che gira:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Aggiornare Rebase in seguito è una modifica a quella riga `FROM`. Il tuo bundle resta intatto.

1. Dal Portale di Azure, cerca e seleziona **Server di Azure Database per PostgreSQL**.
2. Clicca su **Crea** e seleziona **Server Flessibile**.
3. Scegli il tuo Gruppo di Risorse e imposta la tua Regione UE preferita.
4. Seleziona la dimensione di Calcolo (es. Utilizzo Generico o Burstable `B2s` per distribuzioni più piccole).
5. Configura la scheda **Autenticazione** con un nome utente Amministratore e una password sicura.
6. Sotto **Rete**, assicurati che "Consenti l'accesso pubblico da qualsiasi servizio Azure all'interno di Azure a questo server" sia selezionato affinché la tua App Contenitore possa connettersi, oppure configura una VNet sicura.
7. Annota il nome del tuo server e assembla l'URI di connessione:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

## 2. Compila ed esegui il Push su Azure Container Registry (ACR)

Azure Container Apps estrarrà la tua immagine Docker da ACR.
1. Crea un nuovo **Registro Contenitori** nella tua regione UE scelta.
2. Accedi dalla tua CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Costruisci e carica dalla radice del progetto:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

## 3. Distribuisci l'App Contenitore di Azure

Azure Container Apps fornisce un ambiente container serverless con ingresso HTTPS integrato.

1. Cerca nel portale **App Contenitore** e clicca su **Crea**.
2. Crea un nuovo Ambiente per App Contenitore nella tua regione UE.
3. Nella scheda **Contenitore**, punta al tuo registro ACR e seleziona l'immagine `rebase-backend:latest`.
4. Imposta le **Variabili d'ambiente**:

| Nome | Valore |
|------|-------|
| `DATABASE_URL` | La tua stringa di connessione Azure Postgres |
| `JWT_SECRET` | Una stringa sicura di 32+ caratteri casuali |
| `NODE_ENV` | `production` |

5. Sotto la scheda **Ingresso**, abilita esplicitamente l'Ingresso.
6. Imposta la Porta Target su **3001**.
7. Completa la creazione. Azure effettuerà automaticamente il provisioning del container e ti fornirà un URL dell'applicazione protetto con TLS!

## 4. Crea lo Schema del Database

All'avvio Rebase crea automaticamente **solo le tabelle di autenticazione**. Le tabelle per le tue collezioni **non** vengono create automaticamente: l'app si avvia comunque e il login funziona, quindi è facile non accorgersene, finché ogni collezione non restituisce un errore "missing table".

Esegui la sincronizzazione dello schema una volta contro il database di produzione:

```bash
pnpm run db:push
```

Eseguilo da un checkout del progetto o dalla CI con `DATABASE_URL` che punta alla produzione, **non** dall'interno del container: l'immagine di produzione non include la CLI. Assicurati che una regola del firewall del Flexible Server consenta l'IP da cui esegui il comando (o che sia abilitata l'opzione "Consenti l'accesso pubblico dai servizi di Azure"), altrimenti la connessione verrà rifiutata.

Se preferisci migrazioni versionate a una sincronizzazione diretta, usa invece `pnpm run db:generate` seguito da `pnpm run db:migrate`.

---
