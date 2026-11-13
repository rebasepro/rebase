---
sourceHash: 27f3eaf8b78d59e8
title: Eseguire il deploy di Rebase su Railway
description: Esegui il deploy di Rebase su Railway a partire dall'immagine runtime pubblicata e dal bundle del tuo progetto. Mantieni la conformità europea.
sidebar_label: Railway
---

Railway è un PaaS moderno che elimina le complessità del DevOps e supporta le regioni di deploy europee (Amsterdam), consentendoti di mantenere la conformità con l'hosting regionale.

Nulla in questa pagina riguarda il tuo progetto in modo specifico per Railway. Un deploy di Rebase è composto da due parti separabili: l'immagine runtime pubblicata e il **bundle** prodotto da `rebase build` — e lo stesso bundle viene eseguito con Docker Compose su un laptop, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Creare un progetto e una regione UE

1. Accedi al tuo [account Railway](https://railway.app/).
2. Fai clic su **New Project**.
3. Vai su **Settings → Default Region** e impostala su **Europe (Amsterdam)**. Se lo fai *dopo* aver creato i servizi, dovrai migrarli manualmente.

## 2. Effettuare il provisioning di PostgreSQL

1. All'interno del tuo progetto, fai clic su **New → Database → Add PostgreSQL**.
2. Attendi il completamento del provisioning.
3. Railway espone una variabile interna `DATABASE_URL` nella scheda **Variables** del widget Postgres.

Se le tue tabelle dichiarano una colonna `col.vector()`, abilita l'estensione una sola volta su quel database: `CREATE EXTENSION vector;`.

## 3. Creare il bundle e integrarlo in un'immagine

Non c'è **alcuna immagine dell'applicazione da compilare dal tuo codice sorgente**. `rebase build` produce una directory `dist-bundle` con le tabelle compilate, funzioni, cron job e — se il tuo progetto dichiara un'app statica — il frontend compilato. L'immagine runtime pubblicata lo esegue:

```bash
rebase build
```

Effettua il commit di un `Dockerfile` di tre righe nella root del repository, in modo che il passaggio di build di Railway sia una semplice copia anziché una compilazione:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

Compila il bundle nella CI ed effettua il commit o caricalo come parte della release, oppure esegui `rebase build` prima di effettuare il push. In entrambi i casi, l'immagine creata da Railway non contiene alcuna toolchain né codice sorgente: aggiornare Rebase in futuro consisterà solo nel modificare quella riga `FROM`, lasciando intatto il bundle.

Quindi: **New → GitHub Repo**, seleziona il tuo repository e lascia che Railway rilevi il Dockerfile nella root.

## 4. Impostare le variabili d'ambiente

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

   Le ultime tre servono a fornire un amministratore al servizio: in produzione il primo account a registrarsi non viene promosso, quindi nessun altro meccanismo crea il primo chiamante autenticato. Impostale prima che il servizio inizi a gestire il traffico — vedi [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin).

4. Fai clic su **Reference Variable** e seleziona `DATABASE_URL` dal servizio PostgreSQL. Railway inietterà l'URL interno di Postgres a runtime.

Railway imposta `PORT` e il runtime vi si associa, quindi non c'è alcuna porta da configurare. Indirizza l'health check verso `/livez` anziché `/health`: il secondo effettua un round-trip con il database, quindi una liveness probe su di esso riavvierebbe un container altrimenti sano durante un breve rallentamento del database.

## 5. Esporre il dominio

1. Nella scheda del servizio, vai su **Settings → Networking**.
2. Sotto **Public Networking**, fai clic su **Generate Domain** per un URL `.up.railway.app`, oppure collega un dominio personalizzato.

## 6. Lo schema

<span class="since-badge" data-since="0.31">Da 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate da `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` ha come valore predefinito `ensure`, che è additivo sull'intero schema: crea tabelle, colonne e tipi enum mancanti e applica la relativa row-level security, consentendo al primo avvio su un database vuoto di iniziare subito a gestire le tue tabelle.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non altera il tipo di una colonna, non elimina nulla e non modifica i valori di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy.

Un aspetto richiede quindi ancora l'uso della CLI, eseguita da un checkout locale o da un job CI:

```bash
rebase db push
```

Qualsiasi modifica che non sia puramente additiva: una colonna rinominata, un tipo ristretto, un campo rimosso.

Punta `DATABASE_URL` alla stringa di connessione **pubblica** del tuo servizio Postgres (widget Postgres → **Connect**); l'URL interno di riferimento è raggiungibile solo dall'interno di Railway. L'immagine runtime viene fornita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container. Per le migrazioni con controllo di versione, effettua il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di release.

## Storage dei file

I container di Railway vengono sostituiti a ogni deploy, pertanto lo storage di file locale comporterebbe una perdita invisibile di dati e il runtime lo rifiuta in produzione. Collega un bucket compatibile con S3 impostando `STORAGE_TYPE=s3` — vedi [Storage](/docs/backend/storage).

## Prossimi passi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore condivise da tutte le piattaforme.
- [Configuration](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
