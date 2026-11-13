---
sourceHash: 00f5a2af4d9eec17
title: Deploy di Rebase su InstaPods
description: Porta un nuovo progetto rebase init su un URL HTTPS attivo su un singolo pod InstaPods — Node, PostgreSQL e caricamento file sulla stessa macchina, senza Docker.
sidebar_label: InstaPods
---

[InstaPods](https://instapods.com) esegue la tua app in un container persistente — un *pod* — con Node.js, un servizio PostgreSQL opzionale su `localhost`, HTTPS automatico e deploy da un repository GitHub. Un backend Rebase è composto da un singolo processo Node e un Postgres, quindi l'intera applicazione può risiedere su un solo pod: API, autenticazione, realtime, cron, pannello di amministrazione e archiviazione file.

Questa pagina spiega come portare un progetto appena creato con `rebase init` su un URL attivo. Tutto viene eseguito sul pod stesso; non c'è alcuna immagine Docker né altro da configurare.

**I caricamenti dei file possono iniziare sul disco del pod stesso.** Il filesystem di un pod sopravvive a riavvii e nuovi deploy, quindi lo storage locale è sicuro al suo interno, e potrai passare a un bucket compatibile con S3 in un secondo momento senza modificare il codice. Consulta [Archiviazione file](#archiviazione-file).

## Cosa ti serve

- Il piano **Build** o superiore ($7/mese: 2 vCPU, 2 GB di RAM, 25 GB di disco). Il piano Launch non può eseguire il servizio PostgreSQL.
- Un repository GitHub per il progetto.
- La [CLI di InstaPods](https://docs.instapods.com/), per i passaggi relativi al database e alle variabili d'ambiente. La dashboard esegue le stesse operazioni.

## 1. Crea il progetto ed effettua il push

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
```

Esegui il commit e fai il push su un repository GitHub. Il file `.env` è incluso nel .gitignore e deve rimanerci: il pod riceverà i propri valori al passaggio 4.

## 2. Crea il pod

Nella dashboard di InstaPods, crea un pod con il preset **Node.js** sul piano **Build**.

Lo scaffold richiede Node `>=22.22.0` e rifiuta l'installazione su versioni precedenti. Verifica la versione del pod e aggiornala a Node 24 se la versione di Node 22 non è aggiornata:

```bash
instapods exec my-app -- node -v
instapods pods node-version my-app 24 --wait
```

## 3. Aggiungi PostgreSQL

```bash
instapods services add my-app -s postgresql -w
instapods services creds my-app -s postgresql
```

Il secondo comando stampa le credenziali: host `localhost`, porta `5432`, utente e database `instapod`, e una password generata. La tua stringa di connessione è:

```
postgresql://instapod:<password>@localhost:5432/instapod
```

Quindi crea il ruolo con cui Rebase esegue le richieste autenticate. Rebase applica la row-level security passando per ogni richiesta a un ruolo con restrizioni, `rebase_user`, e l'utente `instapod` necessita dei permessi per potervi passare. Crealo una volta sola come superuser di Postgres, prima del primo deploy:

```bash
instapods ssh my-app
sudo -u postgres psql -d instapod -c "CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;" -c "GRANT rebase_user TO instapod;"
exit
```

Il runtime si occuperà del resto al primo avvio: i permessi (grant) e le policy sulle tue tabelle apparterranno a `instapod`, proprietario del proprio database.

Esegui questa operazione anche se il runtime potrebbe creare il ruolo autonomamente. Su PostgreSQL 16 e versioni successive, un utente a cui è consentito creare ruoli ma che non è superuser riceve un'appartenenza al ruolo creato che non gli permette di assumerlo. L'avvio ha quindi successo, ma ogni richiesta autenticata fallisce con `DB_PERMISSION_DENIED`. Se si è già verificato, esegui `GRANT rebase_user TO instapod WITH SET TRUE;` nello stesso modo e riavvia l'app.

## 4. Configura l'ambiente

Genera i due secret con `openssl rand -hex 32` (uno per ciascuno), quindi imposta tutto con un'unica chiamata:

```bash
instapods env set my-app \
  DATABASE_URL='postgresql://instapod:<password>@localhost:5432/instapod' \
  ALLOW_LOCALHOST_IN_PRODUCTION=true \
  JWT_SECRET=<first-secret> \
  REBASE_SERVICE_KEY=<second-secret> \
  CORS_ORIGINS=https://my-app.nbg1-1.instapods.app \
  FRONTEND_URL=https://my-app.nbg1-1.instapods.app \
  DISABLE_SELF_REGISTRATION=true \
  REBASE_ADMIN_EMAIL=you@example.com \
  REBASE_ADMIN_PASSWORD=<at-least-12-characters> \
  STORAGE_TYPE=local \
  STORAGE_PATH=/home/instapod/app/uploads \
  FORCE_LOCAL_STORAGE=true
```

Usa l'URL del tuo pod per `CORS_ORIGINS` e `FRONTEND_URL`: la dashboard lo mostra ed è l'indirizzo a cui aprirai il pannello di amministrazione. In seguito potrai aggiungere un dominio personalizzato e inserirlo in entrambi.

A cosa servono le righe meno ovvie:

- **`ALLOW_LOCALHOST_IN_PRODUCTION=true`.** In produzione, il runtime rifiuta un `DATABASE_URL` che punta a `localhost`, poiché all'interno di un container tale indirizzo è solitamente un errore. Su un pod il database si trova effettivamente sulla stessa macchina, e questa riga lo specifica.
- **`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`.** In produzione, il primo account a registrarsi non viene reso amministratore, quindi queste variabili specificano il primo. Il runtime crea l'account una sola volta, quando la tabella degli utenti è vuota. Accedi con queste credenziali e modifica la password. Consulta [Il tuo primo admin](/docs/getting-started/deployment/#your-first-admin).
- **Le tre righe relative allo storage.** Spiegate nella sezione [Archiviazione file](#archiviazione-file).

`instapods env set` scrive in `/home/instapod/app/.env`, che è il file letto da `rebase start`. InstaPods imposta automaticamente `PORT`, e il runtime vi effettua il binding.

## 5. Collega il repository

Nella scheda **Git** del pod, collega il repository e il branch, quindi imposta i comandi:

| Campo | Valore |
| --- | --- |
| Install | `npx -y pnpm@11 install --frozen-lockfile --prod=false` |
| Build | `npx -y pnpm@11 run build` |
| Release | *(lascia vuoto)* |
| Start | `env NODE_ENV=production node_modules/.bin/rebase start` |

La motivazione per ciascun comando:

- **Install** esegue pnpm tramite `npx`, perché il progetto include un file `pnpm-lock.yaml` e il pod potrebbe non avere pnpm installato. `--prod=false` mantiene le dipendenze di sviluppo (la CLI di Rebase e TypeScript, necessarie per il build) anche se `NODE_ENV` è già impostato su `production` durante l'installazione.
- **Build** esegue `rebase build`. Compila tabelle, funzioni e cron in `dist-bundle/`, e crea il pannello di amministrazione nello stesso bundle. Raggiunge un picco di memoria di circa 1 GB.
- **Start** esegue il bundle compilato. `NODE_ENV=production` è impostato direttamente nel comando, in modo che il runtime non si avvii mai in modalità di sviluppo (dove il primo utente a registrarsi diventerebbe amministratore).

Esegui il deploy. Ogni successivo push sul branch avvierà un nuovo deploy.

## 6. Aprilo

Apri l'URL del pod. Un unico processo gestisce il pannello di amministrazione su `/` e l'API su `/api`. Accedi con `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`.

Il primo avvio crea tutte le tabelle necessarie, incluse le tue tabelle, insieme alle rispettive policy di row-level security. Non c'è alcuna migrazione da eseguire prima.

Se il log indica `Failed to create the "rebase_user" role`, il passaggio alla fine di [Aggiungi PostgreSQL](#3-aggiungi-postgresql) è stato saltato: eseguilo, quindi lancia `instapods pods restart my-app`.

## Archiviazione file

I file caricati vengono archiviati sul disco del pod in `/home/instapod/app/uploads`, una directory che il file `.gitignore` dello scaffold esclude già dal repository.

In produzione, il runtime rifiuta lo storage locale a meno che non si indichi esplicitamente che il disco è permanente, poiché sulla maggior parte delle piattaforme container non lo è: il filesystem viene sostituito a ogni deploy e ogni file caricato va perso. Un pod è diverso, perché i suoi file persistono tra riavvii e deploy. `FORCE_LOCAL_STORAGE=true` comunica questo al runtime.

Mantenere la directory all'interno di `/home/instapod/app` la include inoltre nel backup giornaliero del pod di InstaPods, che copre tale directory ed effettua parallelamente il dump del database.

Cosa non fa lo storage locale:

- **Servire i file da più di una macchina.** I file risiedono esclusivamente su questo pod. Una seconda istanza, o una CDN a monte dei file, richiede un bucket.
- **Espandersi oltre lo spazio su disco del piano.** I file caricati condividono i 25 GB con il database e l'applicazione.

Quando le tue esigenze aumenteranno, collega un qualsiasi bucket compatibile con S3 e rimuovi le tre righe relative allo storage locale:

```bash
instapods env unset my-app STORAGE_PATH FORCE_LOCAL_STORAGE
instapods env set my-app STORAGE_TYPE=s3 S3_BUCKET=my-uploads S3_REGION=... \
  S3_ENDPOINT=https://... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
```

I file già presenti sul pod non vengono spostati automaticamente: copiali nel bucket, mantenendo le rispettive chiavi. Chi può leggere, scrivere ed elencare i file viene stabilito da `storageAuthorize` in `backend/storage.ts`, indipendentemente dal backend in cui risiedono. Consulta [Storage](/docs/backend/storage).

## Lo schema

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate in `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` ha come valore predefinito `ensure`, che opera in modo additivo sull'intero schema. Crea tabelle, colonne e tipi enum mancanti e applica la relativa row-level security, rendendo disponibile una nuova tabella già al deploy successivo.

`ensure` non modifica mai elementi già esistenti. Non altera il tipo di una colonna, non elimina nulla e non modifica i valori di un enum esistente, poiché un deploy non deve alterare uno schema come effetto collaterale.

Qualsiasi modifica che non sia puramente additiva — una colonna rinominata, un tipo di dato ristretto, un campo rimosso — richiede `rebase db push`, eseguito dal tuo computer.

`db push` pianifica ogni modifica in una copia temporanea dello schema, all'interno di un database denominato come il tuo con il suffisso `_dev_diff`, e l'utente `instapod` non dispone dei permessi per creare database. Crealo una volta sola come superuser:

```bash
instapods ssh my-app
sudo -u postgres psql -c "CREATE DATABASE instapod_dev_diff OWNER instapod;"
exit
```

Il PostgreSQL del pod è in ascolto solo su `localhost`, quindi raggiungilo tramite un tunnel SSH prima di effettuare il push:

```bash
ssh -N -L 5433:localhost:5432 instapod@<pod-host> -p <ssh-port>
pnpm exec rebase db push --dry-run --database-url 'postgresql://instapod:<password>@localhost:5433/instapod'
```

Controlla l'SQL stampato dal dry run, quindi eseguilo nuovamente senza `--dry-run`. Una modifica che comporta la perdita di dati richiede anche il flag `--allow-destructive`.

Per le migrazioni con controllo di versione, esegui il commit dei file di migrazione con `rebase db generate` e inserisci `node_modules/.bin/rebase db migrate` nel campo **Release**, che InstaPods esegue a ogni deploy.

Se le tue tabelle dichiarano una colonna `col.vector()`, il Postgres del pod necessita dell'estensione pgvector: installata sul pod, quindi creata dal superuser con `sudo -u postgres psql -d instapod -c "CREATE EXTENSION vector;"`. Lo scaffold di base non ne dichiara alcuna.

## Prossimi passi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo admin comuni a tutte le piattaforme.
- [Configuration](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
- [Storage](/docs/backend/storage) — bucket, regole di accesso e gestione di più sorgenti di archiviazione contemporaneamente.
