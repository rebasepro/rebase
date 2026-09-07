---
sourceHash: 4d7e2205e3aed6fc
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
**Non c'è nessuna immagine applicativa da costruire dal tuo sorgente**. `rebase build` produce una directory `dist-bundle` con le tue collezioni, funzioni e cron compilati — e, se il progetto dichiara un'app statica, il frontend costruito. L'immagine di runtime pubblicata la esegue:

```bash
rebase build
```

Railway preleva da un registry, quindi incorpora il bundle in un'immagine derivata. Tre righe, e fissa esattamente ciò che gira:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Aggiornare Rebase in seguito è una modifica a quella riga `FROM`. Il tuo bundle resta intatto.
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
