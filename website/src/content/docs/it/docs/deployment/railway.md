---
sourceHash: 7ec305359558821f
title: Deploy di Rebase su Railway
description: Distribuisci Rebase su Railway a partire dall'immagine di runtime pubblicata e dal bundle del tuo progetto. Mantieni la conformità europea.
sidebar_label: Railway
---

Railway è un moderno PaaS che elimina le complessità del DevOps e supporta regioni di deployment europee (Amsterdam), consentendoti di mantenere la conformità per l'hosting regionale.

Nulla in questa pagina è specifico di Railway per quanto riguarda il tuo progetto. Un deployment di Rebase è composto da due parti separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build`; lo stesso bundle può essere eseguito con Docker Compose su un computer portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Crea un progetto e una regione UE

1. Accedi al tuo [account Railway](https://railway.app/).
2. Fai clic su **New Project**.
3. Vai su **Settings → Default Region** e impostala su **Europe (Amsterdam)**. Farlo *dopo* aver creato i servizi significa doverli migrare manualmente.

## 2. Esegui il provisioning di PostgreSQL

1. All'interno del tuo progetto, fai clic su **New → Database → Add PostgreSQL**.
2. Attendi il completamento del provisioning.
3. Railway espone una variabile interna `DATABASE_URL` nella scheda **Variables** del widget Postgres.

Se le tue tabelle dichiarano una colonna `col.vector()`, abilita l'estensione una sola volta su quel database: `CREATE EXTENSION vector;`.

## 3. Compila il bundle e integralo in un'immagine

Non c'è **alcuna immagine applicativa da compilare dal tuo codice sorgente**. `rebase build` produce una directory `dist-bundle` contenente le tabelle compilate, le funzioni, i cron job e — se il progetto dichiara un'app statica — il frontend compilato. L'immagine di runtime pubblicata lo esegue:

```bash
rebase build
```

Esegui il commit di un `Dockerfile` di tre righe nella root del repository, in modo che il passaggio di build di Railway sia una semplice copia anziché una compilazione:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

Compila il bundle nella CI ed effettua il commit o caricalo come parte della release, oppure esegui `rebase build` prima di effettuare il push. In entrambi i casi, l'immagine creata da Railway non contiene toolchain né codice sorgente: aggiornare Rebase in seguito richiederà solo una modifica alla riga `FROM`, lasciando intatto il bundle.

Quindi: **New → GitHub Repo**, seleziona il tuo repository e lascia che Railway rilevi il Dockerfile nella root.

## 4. Imposta le variabili d'ambiente

1. Fai clic sulla scheda del servizio.
2. Vai alla scheda **Variables**.
3. Aggiungi:
   - `JWT_SECRET`: una stringa casuale e sicura di almeno 32 caratteri.
   - `REBASE_SERVICE_KEY`: un'altra stringa casuale e sicura di almeno 32 caratteri.
   - `NODE_ENV`: `production`
   - `CORS_ORIGINS`: il dominio del tuo frontend (es. `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: lo stesso di `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: l'indirizzo del primo amministratore
   - `REBASE_ADMIN_PASSWORD`: almeno 12 caratteri

   Le ultime tre variabili sono il modo in cui questo servizio ottiene un amministratore: in produzione il primo account a registrarsi non viene promosso, quindi nient'altro genererà il primo utente autenticato. Configurale prima che il servizio inizi a gestire il traffico — vedi [Il tuo primo admin](/docs/getting-started/deployment/#your-first-admin).

4. Fai clic su **Reference Variable** e seleziona `DATABASE_URL` dal servizio PostgreSQL. Railway inietterà l'URL interno di Postgres a runtime.

Railway imposta `PORT` e il runtime si collega ad essa, quindi non c'è alcuna porta da configurare. Indirizza l'health check verso `/livez` anziché `/health`: quest'ultimo esegue un round-trip al database, quindi una liveness probe su di esso riavvierebbe un container sano durante un momentaneo singhiozzo del database.

## 5. Esponi il dominio

1. Nella scheda del servizio, vai su **Settings → Networking**.
2. Sotto **Public Networking**, fai clic su **Generate Domain** per ottenere un URL `.up.railway.app`, oppure collega un dominio personalizzato.

## 6. Lo schema

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate da `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che è additivo per l'intero schema: crea le tabelle, le colonne e i tipi enum mancanti e applica la loro sicurezza a livello di riga (row-level security), consentendo al primo avvio su un database vuoto di iniziare subito a gestire le tue collezioni.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di un container non deve rimodellare uno schema come effetto collaterale di un deploy.

Pertanto, una determinata tipologia di modifiche richiede ancora la CLI, eseguita da un checkout o da un job di CI:

```bash
rebase db push
```

Qualsiasi modifica che non sia puramente additiva: una colonna rinominata, un tipo ristretto, un campo rimosso.

Punta `DATABASE_URL` verso la stringa di connessione **pubblica** del tuo servizio Postgres (widget Postgres → **Connect**); l'URL interno referenziato è raggiungibile solo dall'interno di Railway. L'immagine di runtime viene fornita senza la CLI, quindi questo comando non viene mai eseguito all'interno del container. Per migrazioni con controllo di versione, effettua il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di release.

## Archiviazione file

I container di Railway vengono sostituiti a ogni deploy, pertanto l'archiviazione locale dei file comporta una perdita invisibile di dati e il runtime la rifiuta in produzione. Collega un bucket compatibile con S3 tramite `STORAGE_TYPE=s3` — vedi [Storage](/docs/backend/storage).

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore condivise da tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
