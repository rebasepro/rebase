---
sourceHash: 10ade706e21556d1
title: Deploy di Rebase su Railway
description: Esegui il deploy di Rebase su Railway dall'immagine di runtime pubblicata e dal bundle del tuo progetto. Mantieni la conformità con l'UE.
sidebar_label: Railway
---

Railway è un PaaS moderno che semplifica il DevOps e supporta le regioni di distribuzione europee (Amsterdam), garantendo la conformità del hosting a livello regionale.

Nulla in questa pagina riguarda il tuo progetto in modo specifico per Railway. Un deploy di Rebase è composto da due parti separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build`; lo stesso bundle può essere eseguito con Docker Compose su un portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Crea un progetto e seleziona una regione UE

1. Accedi al tuo [account Railway](https://railway.app/).
2. Fai clic su **New Project**.
3. Vai su **Settings → Default Region** e impostala su **Europe (Amsterdam)**. Farlo *dopo* aver creato i servizi comporterà la loro migrazione manuale.

## 2. Esegui il provisioning di PostgreSQL

1. All'interno del tuo progetto, fai clic su **New → Database → Add PostgreSQL**.
2. Attendi il completamento del provisioning.
3. Railway espone una variabile interna `DATABASE_URL` nella scheda **Variables** del widget di Postgres.

Se le tue collezioni dichiarano una proprietà `vector`, abilita l'estensione una sola volta su quel database: `CREATE EXTENSION vector;`.

## 3. Crea il bundle e inseriscilo in un'immagine

Non c'è **alcuna immagine dell'applicazione da compilare dal tuo codice sorgente**. `rebase build` genera una directory `dist-bundle` contenente le tue collezioni compilate, funzioni, cron job e — se il tuo progetto dichiara un'app statica — il tuo frontend compilato. L'immagine di runtime pubblicata lo esegue:

```bash
rebase build
```

Esegui il commit di un `Dockerfile` di tre righe nella root del repository, in modo che la fase di build di Railway sia una semplice copia anziché una compilazione:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

Compila il bundle in CI ed esegui il commit o caricalo come parte della tua release, oppure esegui `rebase build` prima di effettuare il push. In entrambi i casi, l'immagine creata da Railway non contiene alcuna toolchain né codice sorgente: un futuro aggiornamento di Rebase richiederà solo la modifica di quella riga `FROM`, lasciando intatto il tuo bundle.

Quindi: **New → GitHub Repo**, seleziona il tuo repository e lascia che Railway rilevi il Dockerfile nella root.

## 4. Imposta le variabili d'ambiente

1. Fai clic sulla scheda del servizio.
2. Vai alla scheda **Variables**.
3. Aggiungi:
   - `JWT_SECRET`: una stringa casuale sicura di almeno 32 caratteri.
   - `REBASE_SERVICE_KEY`: un'altra stringa casuale sicura di almeno 32 caratteri.
   - `NODE_ENV`: `production`
   - `CORS_ORIGINS`: il dominio del tuo frontend (es. `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: uguale a `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: l'indirizzo del primo amministratore
   - `REBASE_ADMIN_PASSWORD`: almeno 12 caratteri

   Le ultime tre servono a creare l'amministratore iniziale di questo servizio: in produzione il primo account registrato non viene promosso automaticamente, quindi nessun altro meccanismo crea il primo utente autenticato. Configurale prima che il servizio inizi a gestire il traffico — consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin).

4. Fai clic su **Reference Variable** e seleziona `DATABASE_URL` dal servizio PostgreSQL. Railway inietterà l'URL interno di Postgres a runtime.

Railway imposta `PORT` e il runtime si associa a essa, quindi non c'è alcuna porta da configurare. Punta l'health check su `/livez` anziché su `/health`: quest'ultimo esegue un round-trip verso il database, pertanto una liveness probe su di esso riavvierebbe un container altrimenti sano durante un breve rallentamento del database.

## 5. Esponi il dominio

1. Nella scheda del servizio, vai su **Settings → Networking**.
2. Sotto **Public Networking**, fai clic su **Generate Domain** per ottenere un URL `.up.railway.app` oppure collega un dominio personalizzato.

## 6. Lo schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collezioni.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, un approccio di tipo additivo per l'intero schema: crea tabelle, colonne e tipi enum mancanti e applica la loro row-level security, consentendo al primo avvio su un database vuoto di essere subito pronto a servire le tue collezioni.

Ciò che `ensure` non fa mai è modificare elementi già esistenti: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy.

Due operazioni richiedono quindi ancora l'uso della CLI, eseguita da un checkout locale o da un job CI:

```bash
rebase db push
```

- **RLS per le tabelle di giunzione** per le relazioni molti-a-molti.
- **Qualsiasi modifica che non sia puramente additiva** — una colonna rinominata, un tipo di dato ristretto, un campo rimosso.

Punta `DATABASE_URL` alla stringa di connessione **pubblica** del tuo servizio Postgres (widget di Postgres → **Connect**); l'URL interno referenziato è accessibile solo dall'interno di Railway. L'immagine di runtime viene fornita senza la CLI, pertanto questo comando non viene mai eseguito all'interno del container. Per le migrazioni con controllo di versione, esegui il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio della release.

## Storage dei file

I container di Railway vengono sostituiti a ogni deploy, pertanto lo storage di file in locale comporta una perdita silenziosa di dati e il runtime lo rifiuta in produzione. Collega un bucket compatibile con S3 impostando `STORAGE_TYPE=s3` — consulta [Storage](/docs/backend/storage).

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore comuni a tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
