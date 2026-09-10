---
sourceHash: 32d97963eacb9f50
title: Deploy di Rebase su Railway
description: Esegui il deploy di Rebase su Railway a partire dall'immagine di runtime pubblicata e dal bundle del tuo progetto. Mantieni il focus sull'UE.
sidebar_label: Railway
---

Railway è un PaaS moderno che semplifica il DevOps e supporta le regioni di deployment europee (Amsterdam), consentendoti di mantenere la conformità con l'hosting regionale.

Nulla in questa pagina riguarda il tuo progetto in modo specifico per Railway. Un deploy di Rebase è composto da due parti separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build` — e lo stesso bundle viene eseguito con Docker Compose su un laptop, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Crea un progetto e una regione UE

1. Accedi al tuo [account Railway](https://railway.app/).
2. Fai clic su **New Project**.
3. Vai su **Settings → Default Region** e impostala su **Europe (Amsterdam)**. Farlo *dopo* aver creato i servizi comporterà doverli migrare manualmente.

## 2. Esegui il provisioning di PostgreSQL

1. All'interno del tuo progetto, fai clic su **New → Database → Add PostgreSQL**.
2. Attendi il completamento del provisioning.
3. Railway espone una variabile `DATABASE_URL` interna nella scheda **Variables** del widget Postgres.

Se le tue collezioni dichiarano una proprietà `vector`, abilita l'estensione una sola volta sul database: `CREATE EXTENSION vector;`.

## 3. Compila il bundle e integralo in un'immagine

Non c'è **nessuna immagine applicativa da compilare dal tuo codice sorgente**. `rebase build` produce una directory `dist-bundle` contenente collezioni compilate, funzioni, cron e — se il tuo progetto dichiara un'app statica — il frontend compilato. L'immagine di runtime pubblicata la esegue:

```bash
rebase build
```

Esegui il commit di un `Dockerfile` di tre righe nella root del repository, in modo che il passaggio di build di Railway sia una semplice copia piuttosto che una compilazione:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

Compila il bundle in CI ed effettua il commit o il caricamento come parte della tua release, oppure esegui `rebase build` prima di effettuare il push. In entrambi i casi, l'immagine creata da Railway non contiene toolchain né codice sorgente — l'aggiornamento futuro di Rebase consisterà semplicemente nella modifica di quella riga `FROM`, lasciando intatto il tuo bundle.

Quindi: **New → GitHub Repo**, seleziona il tuo repository e lascia che Railway rilevi il Dockerfile nella root.

## 4. Imposta le variabili d'ambiente

1. Fai clic sulla scheda del servizio.
2. Vai alla scheda **Variables**.
3. Aggiungi:
   - `JWT_SECRET`: una stringa casuale e sicura di oltre 32 caratteri.
   - `REBASE_SERVICE_KEY`: un'altra stringa casuale e sicura di oltre 32 caratteri.
   - `NODE_ENV`: `production`
   - `CORS_ORIGINS`: il dominio del tuo frontend (es. `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: uguale a `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: l'indirizzo del primo amministratore
   - `REBASE_ADMIN_PASSWORD`: almeno 12 caratteri

   Le ultime tre servono a dotare il servizio di un amministratore: in produzione il primo account registrato non viene promosso automaticamente, quindi nient'altro genererà il primo utente autenticato. Configurale prima che il servizio inizi a gestire traffico — vedi [Il tuo primo admin](/docs/getting-started/deployment/#your-first-admin).

4. Fai clic su **Reference Variable** e seleziona `DATABASE_URL` dal servizio PostgreSQL. Railway inietterà l'URL interno di Postgres a runtime.

Railway imposta `PORT` e il runtime vi si collega, quindi non c'è alcuna porta da configurare. Indirizza l'health check su `/livez` anziché su `/health`: quest'ultimo esegue un round-trip al database, quindi un liveness probe configurato su di esso riavvierebbe un container sano durante una breve interruzione del database.

## 5. Esponi il dominio

1. Nella scheda del servizio, vai su **Settings → Networking**.
2. Sotto **Public Networking**, fai clic su **Generate Domain** per ottenere un URL `.up.railway.app`, oppure collega un dominio personalizzato.

## 6. Lo schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collezioni.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che ha un comportamento additivo sull'intero schema: crea le tabelle, le colonne e i tipi enum mancanti e applica la loro row-level security, così il primo avvio su un database vuoto sarà già pronto a servire le tue collezioni.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy.

Di conseguenza, due operazioni richiedono ancora la CLI, eseguita da un checkout o da un job di CI:

```bash
rebase db push
```

- **RLS per tabelle di giunzione (junction table)** per le relazioni molti-a-molti.
- **Qualsiasi modifica che non sia puramente additiva** — una colonna rinominata, un tipo ristretto, un campo rimosso.

Punta `DATABASE_URL` alla stringa di connessione **pubblica** del tuo servizio Postgres (widget Postgres → **Connect**); l'URL interno referenziato è accessibile solo dall'interno di Railway. L'immagine di runtime viene fornita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container. Per le migrazioni con controllo di versione, committa i file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di rilascio.

## Archiviazione file

I container di Railway vengono sostituiti a ogni deploy, quindi lo storage locale di file comporterebbe una perdita silenziosa di dati e il runtime lo rifiuta in produzione. Collega un bucket compatibile con S3 impostando `STORAGE_TYPE=s3` — vedi [Storage](/docs/backend/storage).

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore condivise da tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
