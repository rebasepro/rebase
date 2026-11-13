---
sourceHash: ecae5803328dcd65
title: Deploy di Rebase su InstaPods
description: Porta un nuovo progetto rebase init a un URL HTTPS attivo su un singolo pod InstaPods — Node, PostgreSQL e caricamenti di file sulla stessa macchina, senza Docker.
sidebar_label: InstaPods
---

[InstaPods](https://instapods.com) esegue la tua applicazione in un container persistente — un *pod* — con Node.js, un servizio PostgreSQL opzionale su `localhost`, HTTPS automatico e deploy da un repository GitHub. Un backend Rebase è costituito da un singolo processo Node e un'istanza Postgres, quindi l'intera applicazione trova posto su un unico pod: API, autenticazione, realtime, cron, pannello di amministrazione e archiviazione file.

Questa pagina guida il passaggio da un progetto appena creato con `rebase init` a un URL attivo. Tutto viene eseguito direttamente sul pod; non ci sono immagini Docker né altre risorse da configurare.

**I caricamenti di file possono iniziare sul disco del pod stesso.** Il filesystem di un pod sopravvive a riavvii e nuovi deploy, quindi lo storage locale è sicuro su questa piattaforma, e potrai passare a un bucket compatibile con S3 in un secondo momento senza modificare il codice. Consulta [File storage](#file-storage).

## Requisiti necessari

- Il piano **Build** o superiore (7 $/mese: 2 vCPU, 2 GB di RAM, 25 GB di disco). Il piano Launch non può eseguire il servizio PostgreSQL.
- Un repository GitHub per il progetto.
- La [CLI di InstaPods](https://docs.instapods.com/), per i passaggi relativi al database e alle variabili di ambiente. La dashboard consente di eseguire le stesse operazioni.

## 1. Crea il progetto ed effettua il push

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
```

Esegui il commit e il push verso un repository GitHub. Il file `.env` è inserito nel gitignore e deve rimanere tale: il pod riceverà i propri valori nel passaggio 4.

## 2. Crea il pod

Nella dashboard di InstaPods, crea un pod con il preset **Node.js** sul piano **Build**.

Lo scaffold richiede Node `>=22.22.0` e rifiuta l'installazione su versioni precedenti. Verifica la versione del pod e passa a Node 24 se la versione di Node 22 non è aggiornata:

```bash
instapods exec my-app -- node -v
instapods pods node-version my-app 24 --wait
```

## 3. Aggiungi PostgreSQL

```bash
instapods services add my-app -s postgresql -w
instapods services creds my-app -s postgresql
```

Il secondo comando mostra le credenziali: host `localhost`, porta `5432`, utente e database `instapod`, e una password generata. La stringa di connessione è:

```
postgresql://instapod:<password>@localhost:5432/instapod
```

Successivamente, crea il ruolo con cui Rebase esegue le richieste autenticate. Rebase applica la row-level security passando per ciascuna richiesta a un ruolo con permessi limitati, `rebase_user`, e l'utente `instapod` necessita del permesso per passare a questo ruolo. Crealo una volta come superutente Postgres, prima del primo deploy:

```bash
instapods ssh my-app
sudo -u postgres psql -d instapod -c "CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;" -c "GRANT rebase_user TO instapod;"
exit
```

Il runtime si occuperà del resto al primo avvio: i grant e le policy sulle tue tabelle appartengono a `instapod`, che è il proprietario del proprio database.

Esegui questa operazione anche se il runtime potrebbe creare il ruolo autonomamente. Su PostgreSQL 16 e versioni successive, un utente autorizzato a creare ruoli ma che non è un superutente ottiene un'appartenenza al ruolo creato che non gli consente di assumerne l'identità. In tal caso l'avvio ha successo, ma ogni richiesta autenticata fallisce con `DB_PERMISSION_DENIED`. Se si è già verificato questo problema, esegui `GRANT rebase_user TO instapod WITH SET TRUE;` con la stessa modalità e riavvia l'applicazione.

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

Usa l'URL specifico del tuo pod per `CORS_ORIGINS` e `FRONTEND_URL`: è visibile nella dashboard ed è l'indirizzo da cui aprirai il pannello di amministrazione. In seguito potrai aggiungere un dominio personalizzato e inserirlo in entrambi.

A cosa servono le righe meno ovvie:

- **`ALLOW_LOCALHOST_IN_PRODUCTION=true`.** In produzione il runtime rifiuta una `DATABASE_URL` che punta a `localhost`, poiché all'interno di un container tale indirizzo è solitamente un errore. Su un pod il database si trova effettivamente sulla stessa macchina, e questa riga lo specifica.
- **`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`.** In produzione il primo account a registrarsi non diventa amministratore, quindi queste variabili specificano il primo amministratore. Il runtime crea l'account una sola volta, quando la tabella utenti è vuota. Accedi con queste credenziali e modifica la password. Consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin).
- **Le tre righe relative allo storage.** Spiegate nella sezione [File storage](#file-storage).

`instapods env set` scrive `/home/instapod/app/.env`, ovvero il file letto da `rebase start`. InstaPods imposta autonomamente `PORT`, e il runtime vi effettua il binding.

## 5. Collega il repository

Nella scheda **Git** del pod, collega il repository e il branch, quindi imposta i comandi:

| Campo | Valore |
| --- | --- |
| Install | `npx -y pnpm@11 install --frozen-lockfile --prod=false` |
| Build | `npx -y pnpm@11 run build` |
| Release | *(lasciare vuoto)* |
| Start | `env NODE_ENV=production node_modules/.bin/rebase start` |

Il motivo per cui ciascun comando è strutturato in questo modo:

- **Install** esegue pnpm tramite `npx`, poiché il progetto include un file `pnpm-lock.yaml` e il pod potrebbe non avere pnpm installato. `--prod=false` mantiene le dipendenze di sviluppo — la CLI di Rebase e TypeScript, necessarie per la build — anche se `NODE_ENV` è già impostato su `production` durante l'installazione.
- **Build** esegue `rebase build`. Compila tabelle, funzioni e cron in `dist-bundle/`, e compila il pannello di amministrazione nello stesso bundle. Raggiunge un picco di utilizzo della memoria di circa 1 GB.
- **Start** esegue il bundle compilato. `NODE_ENV=production` è impostato direttamente nel comando, in modo che il runtime non si avvii mai in modalità di sviluppo — nella quale il primo sconosciuto a registrarsi diventerebbe amministratore.

Esegui il deploy. Ogni successivo push sul branch attiverà un nuovo deploy.

## 6. Apri l'applicazione

Apri l'URL del pod. Un unico processo gestisce sia il pannello di amministrazione su `/` sia le API su `/api`. Accedi con `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`.

Il primo avvio crea tutte le tabelle necessarie, comprese le tue tabelle, insieme alle relative policy di row-level security. Non è necessario eseguire alcuna migrazione preliminare.

Se il log riporta `Failed to create the "rebase_user" role`, significa che il passaggio finale di [Aggiungi PostgreSQL](#3-aggiungi-postgresql) è stato saltato: eseguilo, quindi lancia `instapods pods restart my-app`.

## File storage

I file caricati vengono memorizzati sul disco del pod in `/home/instapod/app/uploads`, una directory già esclusa dal repository dal file `.gitignore` dello scaffold.

In produzione, il runtime rifiuta lo storage locale a meno che non si indichi esplicitamente che il disco è persistente, poiché sulla maggior parte delle piattaforme basate su container non lo è: il filesystem viene sostituito a ogni deploy, eliminando tutti i file caricati. Un pod funziona diversamente, poiché i suoi file persistono tra riavvii e deploy. `FORCE_LOCAL_STORAGE=true` comunica questo al runtime.

Mantenere la directory all'interno di `/home/instapod/app` consente inoltre di includerla nel backup giornaliero del pod di InstaPods, che esegue il backup di tale directory ed effettua contemporaneamente il dump del database.

Cosa non consente lo storage locale:

- **Servire i contenuti da più di una macchina.** I file risiedono esclusivamente su questo pod. Una seconda istanza, o una CDN a monte dei file, richiede un bucket.
- **Crescere oltre lo spazio su disco del piano.** I file caricati condividono i 25 GB con il database e l'applicazione.

Quando lo spazio non è più sufficiente, collega qualsiasi bucket compatibile con S3 e rimuovi le tre righe relative allo storage locale:

```bash
instapods env unset my-app STORAGE_PATH FORCE_LOCAL_STORAGE
instapods env set my-app STORAGE_TYPE=s3 S3_BUCKET=my-uploads S3_REGION=... \
  S3_ENDPOINT=https://... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
```

I file già presenti sul pod non vengono spostati automaticamente: copiali nel bucket, mantenendone le chiavi. I permessi di lettura, scrittura ed elencazione dei file sono stabiliti da `storageAuthorize` in `backend/storage.ts`, indipendentemente dal backend in cui risiedono. Consulta [Storage](/docs/backend/storage).

## Lo schema

<span class="since-badge" data-since="0.31">Da 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, comprese quelle dichiarate in `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che opera in modalità additiva sull'intero schema. Crea tabelle, colonne e tipi enum mancanti e ne applica la row-level security, rendendo disponibile una nuova collection già al deploy successivo.

`ensure` non modifica mai elementi già esistenti. Non altera il tipo di una colonna, non elimina nulla né modifica le etichette di un enum esistente, poiché un deploy non deve alterare uno schema come effetto collaterale.

Qualsiasi modifica che non sia puramente additiva — una colonna rinominata, un tipo di dato più restrittivo, un campo rimosso — richiede l'esecuzione di `rebase db push` dalla propria macchina locale.

`db push` pianifica ogni modifica in una copia temporanea dello schema, all'interno di un database che ha lo stesso nome del tuo con il suffisso `_dev_diff`, e l'utente `instapod` non è autorizzato a creare database. Crealo una volta come superutente:

```bash
instapods ssh my-app
sudo -u postgres psql -c "CREATE DATABASE instapod_dev_diff OWNER instapod;"
exit
```

L'istanza Postgres del pod è in ascolto solo su `localhost`, quindi è necessario accedervi tramite un tunnel SSH prima di eseguire il push:

```bash
ssh -N -L 5433:localhost:5432 instapod@<pod-host> -p <ssh-port>
pnpm exec rebase db push --dry-run --database-url 'postgresql://instapod:<password>@localhost:5433/instapod'
```

Verifica il codice SQL mostrato dall'esecuzione con dry-run, quindi eseguilo di nuovo senza `--dry-run`. Una modifica che comporta l'eliminazione di dati richiede anche il flag `--allow-destructive`.

Per le migrazioni con controllo di versione, esegui il commit dei file di migrazione con `rebase db generate` e inserisci `node_modules/.bin/rebase db migrate` nel campo **Release**, che InstaPods esegue a ogni deploy.

Se le tue tabelle dichiarano una colonna `col.vector()`, l'istanza Postgres del pod necessita dell'estensione pgvector: deve essere installata sul pod e successivamente creata dal superutente con `sudo -u postgres psql -d instapod -c "CREATE EXTENSION vector;"`. Lo scaffold non ne dichiara alcuna.

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore condivise da tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili di ambiente lette dal runtime.
- [Storage](/docs/backend/storage) — bucket, regole di accesso e utilizzo simultaneo di più sorgenti di storage.
