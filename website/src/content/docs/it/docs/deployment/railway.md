---
sourceHash: 1a4842113508b8e2
title: Deploy di Rebase su Railway
description: Esegui il deploy di Rebase su Railway a partire dall'immagine runtime pubblicata e dal bundle del tuo progetto. Mantieni l'attenzione sulla conformità UE.
sidebar_label: Railway
---

Railway è un PaaS moderno che elimina le complessità del DevOps e supporta regioni di deploy europee (Amsterdam), consentendoti di mantenere la conformità per l'hosting regionale.

Nulla in questa pagina riguarda il tuo progetto in modo specifico per Railway. Un deploy di Rebase è composto da due parti separabili: l'immagine runtime pubblicata e il **bundle** prodotto da `rebase build` — e lo stesso bundle viene eseguito con Docker Compose su un computer portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Crea un progetto e seleziona una regione UE

1. Accedi al tuo [account Railway](https://railway.app/).
2. Fai clic su **New Project**.
3. Vai su **Settings → Default Region** e impostala su **Europe (Amsterdam)**. Farlo *dopo* aver creato i servizi comporterebbe doverli migrare manualmente.

## 2. Effettua il provisioning di PostgreSQL

1. All'interno del tuo progetto, fai clic su **New → Database → Add PostgreSQL**.
2. Attendi il completamento del provisioning.
3. Railway espone una variabile interna `DATABASE_URL` nella scheda **Variables** del widget Postgres.

Se le tue collection dichiarano una proprietà `vector`, abilita l'estensione una tantum sul database: `CREATE EXTENSION vector;`.

## 3. Compila il bundle e integralo in un'immagine

Non c'è **alcuna immagine dell'applicazione da compilare a partire dal codice sorgente**. `rebase build` genera una directory `dist-bundle` contenente le collection compilate, le funzioni, i cron job e — se il tuo progetto dichiara un'app statica — il frontend compilato. L'immagine runtime pubblicata lo esegue:

```bash
rebase build
```

Esegui il commit di un `Dockerfile` di tre righe nella root del repository, in modo che la fase di build di Railway sia una semplice copia anziché una compilazione:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.21.0
COPY dist-bundle /bundle
```

Compila il bundle nella CI ed effettua il commit o caricalo come parte della tua release, oppure esegui `rebase build` prima di effettuare il push. In entrambi i casi, l'immagine creata da Railway non contiene toolchain né codice sorgente: l'aggiornamento futuro di Rebase consisterà semplicemente nel modificare quella riga `FROM`, lasciando intatto il tuo bundle.

Successivamente: **New → GitHub Repo**, seleziona il tuo repository e lascia che Railway rilevi il Dockerfile nella root.

## 4. Imposta le variabili d'ambiente

1. Fai clic sulla scheda del servizio.
2. Vai alla scheda **Variables**.
3. Aggiungi:
   - `JWT_SECRET`: una stringa casuale sicura di oltre 32 caratteri.
   - `REBASE_SERVICE_KEY`: un'altra stringa casuale sicura di oltre 32 caratteri.
   - `NODE_ENV`: `production`
   - `CORS_ORIGINS`: il dominio del tuo frontend (es. `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: lo stesso di `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: l'indirizzo del primo amministratore
   - `REBASE_ADMIN_PASSWORD`: almeno 12 caratteri

   Le ultime tre servono proprio a creare l'amministratore del servizio: in produzione, il primo account che si registra non viene promosso automaticamente, quindi nessun altro meccanismo crea il primo utente autenticato. Configurale prima che il servizio inizi a gestire il traffico — consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin).

4. Fai clic su **Reference Variable** e seleziona `DATABASE_URL` dal servizio PostgreSQL. Railway inietterà l'URL interno di Postgres a runtime.

Railway imposta `PORT` e il runtime si collega a essa, quindi non c'è alcuna porta da configurare. Indirizza l'health check verso `/livez` anziché `/health`: quest'ultimo esegue un round-trip verso il database, quindi una liveness probe su di esso riavvierebbe un container altrimenti sano durante un momentaneo problema di connessione al database.

## 5. Esponi il dominio

1. Nella scheda del servizio, vai su **Settings → Networking**.
2. Sotto **Public Networking**, fai clic su **Generate Domain** per ottenere un URL `.up.railway.app`, oppure collega un dominio personalizzato.

## 6. Lo schema

**Il runtime crea le tabelle mancanti all'avvio, comprese quelle delle tue collection.** Il valore predefinito di `REBASE_MIGRATE_ON_BOOT` è `ensure`, che opera in modo additivo sull'intero schema — crea tabelle, colonne e tipi enum mancanti e applica la relativa row-level security — così che al primo avvio su un database vuoto il servizio è subito pronto per gestire le tue collection.

Ciò che `ensure` non fa mai è modificare elementi già esistenti: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy.

Di conseguenza, due operazioni richiedono ancora la CLI, eseguita da un checkout locale o da un job di CI:

```bash
rebase db push
```

- **RLS per junction table** per le relazioni molti-a-molti.
- **Qualsiasi modifica non puramente additiva** — una colonna rinominata, un tipo reso più restrittivo, un campo rimosso.

Fai puntare `DATABASE_URL` alla stringa di connessione **pubblica** del tuo servizio Postgres (widget Postgres → **Connect**); l'URL interno referenziato è accessibile solo dall'interno di Railway. L'immagine runtime viene fornita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container. Per le migrazioni con controllo di versione, effettua il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio della release.

## Archiviazione file

I container di Railway vengono sostituiti a ogni deploy, quindi l'archiviazione locale dei file comporta una perdita invisibile di dati e il runtime la rifiuta in produzione. Collega un bucket compatibile con S3 impostando `STORAGE_TYPE=s3` — vedi [Storage](/docs/backend/storage).

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore comuni a ogni piattaforma.
- [Configuration](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
