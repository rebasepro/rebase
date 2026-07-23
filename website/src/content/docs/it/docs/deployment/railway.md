---
title: Distribuzione di Rebase su Railway
description: Distribuisci Rebase senza sforzo con il parsing del Dockerfile supportato nativamente da Railway. Mantenere l'attenzione sull'UE.
sidebar_label: Railway
---

Railway è un PaaS (Platform as a Service) moderno incredibilmente popolare che elimina le complessità del DevOps. Rileverà automaticamente il framework Rebase Node e lo costruirà senza problemi.

Inoltre, Railway supporta pienamente le regioni di deployment europee (Amsterdam), il che significa che potrai comunque beneficiare di una rigorosa conformità all'hosting regionale.

## 1. Creare un Progetto e una Regione UE
1. Accedi al tuo [Account Railway](https://railway.app/).
2. Clicca su **Nuovo Progetto**.
3. Vai su **Impostazioni -> Regione predefinita** e impostala esplicitamente su **Europa (Amsterdam)**. (Se lo fai *dopo* aver creato i servizi, potrebbe essere necessario migrarli manualmente).

## 2. Effettuare il Provisioning di PostgreSQL
1. All'interno del tuo progetto, clicca su **Nuovo** -> **Database** -> **Aggiungi PostgreSQL**.
2. Attendi qualche secondo per il provisioning del database.
3. Per impostazione predefinita, Railway fornisce una variabile interna `DATABASE_URL`. Clicca sul widget Postgres -> **Variabili** per individuare questa stringa di connessione.

## 3. Distribuire il Codice Rebase
1. Clicca su **Nuovo** -> **GitHub Repo**.
2. Seleziona il tuo repository Rebase.
3. Railway rileverà immediatamente il repository e cercherà un `Dockerfile`. Attendi l'inizio della build iniziale.

:::caution
Railway per impostazione predefinita cerca un `Dockerfile` nella radice del repository, ma il Dockerfile del backend di Rebase si trova in `backend/`. Vai su **Settings → Build** e imposta **Dockerfile Path** su `backend/Dockerfile`, lasciando la **Root Directory** alla radice del repository. Il Dockerfile del backend ha bisogno dell'intero workspace come contesto di build (copia `pnpm-workspace.yaml`, `backend/` e `config/`), quindi la Root Directory non deve essere impostata su `backend`.
:::

## 4. Impostare le Variabili d'Ambiente
La build iniziale potrebbe fallire perché manca completamente la configurazione. Risolviamo il problema.

1. Clicca sulla nuova scheda del servizio Rebase GitHub.
2. Vai alla scheda **Variabili**.
3. Clicca su **Nuova Variabile** e aggiungi:
   - `JWT_SECRET`: Genera una stringa casuale sicura di 32+ caratteri.
   - `NODE_ENV`: Imposta su `production`
4. Clicca su **Riferisci Variabile** e seleziona `DATABASE_URL` dal servizio PostgreSQL che hai provisionato. Railway inietterà in modo sicuro l'URL interno di Postgres in fase di esecuzione.

## 5. Esporre il Dominio
1. Nella scheda del servizio Rebase, vai alla scheda **Impostazioni**.
2. Scorri fino a **Networking**.
3. Sotto **Public Networking**, clicca su **Genera Dominio**. Railway fornirà un URL di testing `.up.railway.app`. Qui puoi anche allegare in modo sicuro un Dominio Personalizzato.

Railway ricostruirà automaticamente in modo sicuro. La tua piattaforma ospitata nell'UE è ora completamente attiva!

## 6. Crea lo Schema del Database

All'avvio Rebase crea automaticamente **solo le tabelle di autenticazione**. Le tabelle per le tue collezioni **non** vengono create automaticamente: l'app si avvia comunque e il login funziona, quindi è facile non accorgersene, finché ogni collezione non restituisce un errore "missing table".

Esegui la sincronizzazione dello schema una volta contro il database di produzione:

```bash
pnpm run db:push
```

Eseguilo da un checkout del progetto o dalla CI con `DATABASE_URL` che punta alla produzione, **non** dall'interno del container: l'immagine di produzione non include la CLI. Railway espone una stringa di connessione pubblica per il database Postgres (nella scheda **Variabili** del servizio Postgres): usala come `DATABASE_URL` quando esegui il comando dalla tua macchina locale o dalla CI.

Se preferisci migrazioni versionate a una sincronizzazione diretta, usa invece `pnpm run db:generate` seguito da `pnpm run db:migrate`.

---
