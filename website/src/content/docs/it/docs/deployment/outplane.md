---
sourceHash: c2b849bb2b75d3c4
title: Deploy di Rebase su Out Plane
description: Distribuisci un progetto rebase init su Out Plane — un'app compilata dal tuo repository, il PostgreSQL gestito di Out Plane e il caricamento di file in un bucket Out Plane.
sidebar_label: Out Plane
---

[Out Plane](https://outplane.com) compila ed esegue applicazioni a partire da un repository GitHub, con PostgreSQL gestito e bucket compatibili con S3 nella stessa console, in Germania. Un backend Rebase è composto da un singolo container e un'istanza Postgres, quindi si mappa su tre risorse di Out Plane: un'**app**, un **database** e un **bucket**.

Questa pagina guida un progetto appena creato con `rebase init` fino a un URL live, su una singola istanza.

**Scritto per Rebase 0.32.0.** La versione è fissata nel Dockerfile al passaggio 3; aggiornarla in seguito richiede solo la modifica di quella singola riga.

**I caricamenti di file vanno su un bucket fin dal primo giorno.** Il filesystem di un'app Out Plane viene ripristinato a ogni nuovo deploy, quindi i file salvati sul suo disco andrebbero persi al push successivo. Consulta [Archiviazione file](#archiviazione-file).

## Di cosa hai bisogno

- Un account Out Plane. Il piano **Starter** copre quanto descritto in questa pagina: un'app, un database gestito e un bucket.
- Un repository GitHub per il progetto.
- Facoltativamente, la [`outplane` CLI](https://docs.outplane.com). Ogni passaggio indicato di seguito può essere eseguito nella console; gli equivalenti da CLI sono forniti nei casi in cui fanno risparmiare tempo.

## 1. Crea il progetto ed esegui il push

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
```

Esegui il commit e fai il push su un repository GitHub. `.env` è presente nel `.gitignore` e deve rimanere tale: l'app riceverà i propri valori al passaggio 5.

## 2. Crea il database

Nella console, seleziona **Create → Database**:

- **Version:** 17 (quella predefinita) o 16. Qualsiasi versione a partire dalla 16 è supportata.
- **Region:** Frankfurt, accanto alla tua app.

```bash
outplane db create my-app-db --region aws-eu-central-1
```

Dal pannello **Connection** del database, copia la stringa di connessione (nel formato `psql`), oppure visualizzala con `outplane db url my-app-db`. Out Plane richiede SSL su ogni connessione. Il tuo `DATABASE_URL` è quella stringa con `sslmode=no-verify` alla fine, al posto di qualsiasi `sslmode` già presente:

```
postgresql://<user>:<password>@<host>:5432/<database>?sslmode=no-verify
```

**Usa `no-verify`, non `require`.** Entrambi cifrano la connessione. Per `psql`, `require` significa anche "non verificare il certificato rispetto a un'autorità pubblica", ma il driver Postgres su cui gira Rebase lo interpreta come "verificalo", e un certificato del database non firmato pubblicamente fallisce quindi alla prima connessione con `self-signed certificate`. `no-verify` è il modo in cui il driver esprime ciò che `require` significa ovunque. La guida ufficiale di Node.js di Out Plane disattiva la verifica per lo stesso motivo. Lo stesso URL funziona per `rebase db push` dalla tua macchina: la CLI lo passa all'engine di schema Atlas come `sslmode=require`.

### Il ruolo a cui Rebase passa

Rebase applica la row-level security passando ciascuna richiesta autenticata a un ruolo con restrizioni, `rebase_user`. Al primo avvio, il runtime crea tale ruolo, assegna al ruolo indicato nella stringa di connessione il permesso di passare a esso e verifica che il passaggio funzioni prima di gestire qualsiasi richiesta. Non è necessario eseguire nulla manualmente.

Se il primo avvio si interrompe con un errore `AppRoleSetupError` che menziona `rebase_user`, il ruolo specificato nella stringa di connessione non ha i permessi per creare ruoli o per assegnarsi il cambio di ruolo. L'errore mostrerà l'istruzione SQL da eseguire: eseguila una volta sola con un ruolo del database autorizzato a creare ruoli, quindi effettua nuovamente il deploy.

Se le tue tabelle dichiarano una colonna `col.vector()`, il database richiede l'estensione pgvector. Lo scaffold iniziale non ne dichiara alcuna.

## 3. Crea un bucket

In **Buckets → Create bucket**, creane uno e mantienilo **private** (l'impostazione predefinita). Rebase gestisce ogni download tramite le proprie API, e `storageAuthorize` in `backend/storage.ts` stabilisce chi può leggere, scrivere ed elencare i file.

Out Plane aggiunge un suffisso casuale al nome. Usa il nome **completo** visualizzato, non quello abbreviato digitato inizialmente.

Nella scheda **Access** del bucket, crea una chiave con autorizzazione **Read and write**. Il segreto viene mostrato una sola volta: copialo subito.

```bash
outplane bucket create my-app-uploads
outplane bucket key create my-app-uploads
```

Le note di Out Plane relative al fatto che i caricamenti da browser necessitino di una regola CORS non si applicano in questo caso: il pannello di amministrazione e l'SDK di Rebase effettuano l'upload tramite le API, e il runtime scrive nel bucket direttamente dal server.

## 4. Aggiungi un Dockerfile

Out Plane supporta la compilazione sia da Dockerfile sia tramite Buildpacks. Usa un Dockerfile: il progetto viene installato con pnpm e l'immagine compila autonomamente il bundle, per poi passarlo al runtime pubblicato. Esegui il commit di questo file nella root del progetto:

```dockerfile title="Dockerfile"
# Build the bundle from your source
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npx -y pnpm@11 install --frozen-lockfile && npx -y pnpm@11 run build

# The published runtime, with nothing added but the bundle
FROM rebasepro/server:0.33.2
COPY --from=build --chown=node:node /app/dist-bundle /bundle
```

Tre dettagli sono importanti:

- **`node:22`, non `node:22-slim`.** L'installazione della CLI scarica l'engine di schema Atlas, che richiede `curl` e i certificati CA. L'immagine slim è priva di entrambi e l'installazione fallisce.
- **`--chown=node:node`.** Il runtime viene eseguito come utente `node` e collega i propri pacchetti nel bundle all'avvio. Un bundle di proprietà di root viene comunque servito, ma registra un avviso per ogni pacchetto che non è riuscito a collegare.
- **Nessun sorgente nell'immagine finale.** Contiene solo il runtime e il bundle compilato, e `dist-bundle/` rimane nel gitignore.

L'immagine del runtime resta in ascolto sulla porta **8080** e la dichiara con `EXPOSE`, pertanto Out Plane precompila automaticamente la porta quando analizza il Dockerfile.

## 5. Crea l'app

Crea un'applicazione dalla console, collega il repository e il branch, quindi imposta:

| Campo | Valore |
| --- | --- |
| Build method | **Dockerfile** |
| Root directory | `/` |
| Port | `8080`, **HTTP**, **public** |
| Start command | *(lascia vuoto — verrà usato quello dell'immagine)* |

```bash
outplane app create my-app --repo <owner>/<repo> --branch main --port 8080:http:public
```

In **Settings → Environment**, scegli **Edit as .env** e incolla:

```env
NODE_ENV=production
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<database>?sslmode=no-verify
JWT_SECRET=<openssl rand -hex 32>
REBASE_SERVICE_KEY=<openssl rand -hex 32, a second one>
CORS_ORIGINS=https://<your-app>.outplane.app
FRONTEND_URL=https://<your-app>.outplane.app
DISABLE_SELF_REGISTRATION=true
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
STORAGE_TYPE=s3
S3_BUCKET=<full bucket name, with its suffix>
S3_REGION=auto
S3_ENDPOINT=https://obj.outplane.dev
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret>
S3_FORCE_PATH_STYLE=false
```

Quindi fai clic su **Save & deploy**. Out Plane applica le modifiche alle variabili di ambiente solo al deployment successivo. Con la CLI, inserisci le stesse righe in un file ed esegui `outplane env push --app my-app --deploy`.

A cosa servono le righe meno evidenti:

- **`NODE_ENV=production`.** Out Plane non la imposta automaticamente. Senza di essa, il runtime si avvia in modalità di sviluppo, in cui il primo utente sconosciuto che si registra diventa amministratore.
- **`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`.** In produzione il primo account che si registra non viene promosso ad amministratore; queste variabili definiscono quindi il primo amministratore. Il runtime crea l'account una sola volta, finché la tabella degli utenti è vuota. Consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin).
- **`S3_FORCE_PATH_STYLE=false`.** Per impostazione predefinita, Rebase invia richieste path-style a un endpoint S3 personalizzato, poiché MinIO e la maggior parte degli storage self-hosted lo richiedono. I bucket di Out Plane accettano esclusivamente richieste di tipo virtual-hosted (`https://<bucket>.obj.outplane.dev/…`), e le richieste path-style falliscono. Questa riga è obbligatoria.
- **`S3_REGION=auto`.** I bucket Out Plane sono globali e i client firmano le richieste con `auto`.

L'indirizzo `outplane.app` dell'applicazione viene mostrato una volta creata l'app. Se differisce da quello previsto, correggi `CORS_ORIGINS` e `FRONTEND_URL` e seleziona nuovamente **Save & deploy**.

## 6. Aprila

Apri l'URL dell'app. Un unico container serve il pannello di amministrazione su `/` e le API su `/api`. Accedi con `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`, quindi modifica la password.

Al primo avvio vengono create tutte le tabelle necessarie, comprese le tue, insieme alle relative policy di row-level security. Non c'è alcuna migrazione da eseguire prima. Carica un file dal pannello di amministrazione per verificare le impostazioni del bucket: un eventuale errore in questa fase indica quasi sempre che nel nome del bucket manca il suffisso oppure che manca `S3_FORCE_PATH_STYLE=false`.

Ogni push sul branch attiva un nuovo deploy. Per usare un dominio personalizzato, aggiungilo in **Domains**, collegalo alla porta 8080 dell'app e crea il record CNAME (o, per un dominio root, il record A) indicato nella console. Il certificato HTTPS viene rilasciato non appena il record si risolve. Successivamente, aggiungi la nuova origine a `CORS_ORIGINS` e `FRONTEND_URL`.

## Singola istanza

Questa pagina configura **una singola istanza**, che rappresenta l'impostazione predefinita di Out Plane e il limite del piano Starter. Un solo container serve le API, il pannello di amministrazione, le funzionalità realtime, i cron job e la coda dei job.

I job pianificati continuerebbero a funzionare correttamente anche con più istanze: ogni esecuzione di cron viene acquisita in Postgres prima di avviarsi, perciò uno slot viene eseguito una sola volta indipendentemente dal numero di istanze che tentano di avviarlo. Altre funzionalità sono invece legate alla singola istanza — rate limiter, cache di trasformazione delle immagini, upload ripristinabili in corso — quindi leggi [Più di un'istanza](/docs/deployment/multiple-instances/) prima di aumentare il conteggio in **Settings → Scale**.

## Archiviazione file

I file caricati risiedono nel bucket Out Plane creato al passaggio 3, sopravvivendo quindi ai nuovi deploy, mentre il disco locale dell'app non contiene dati rilevanti.

Per effettuare la rotazione delle chiavi: creane una nuova nella scheda **Access** del bucket, impostala come `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY`, fai clic su **Save & deploy**, quindi elimina la vecchia chiave. Out Plane segnala che una chiave eliminata può continuare a funzionare per un massimo di 15 minuti.

I permessi di lettura, scrittura ed elenco dei file sono gestiti da `storageAuthorize` in `backend/storage.ts`, indipendentemente dal bucket in cui si trovano. Consulta [Storage](/docs/backend/storage).

## Lo schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate in `backend/schema`.** Il valore predefinito di `REBASE_MIGRATE_ON_BOOT` è `ensure`, che ha un comportamento additivo sull'intero schema. Crea tabelle, colonne e tipi enum mancanti e applica la loro row-level security, rendendo disponibile una nuova tabella già al deploy successivo.

`ensure` non modifica mai elementi già esistenti. Non altera il tipo di una colonna, non rimuove nulla né modifica i valori di un enum esistente, poiché un deploy non deve rimodellare uno schema come effetto collaterale.

Qualsiasi modifica che non sia puramente additiva — una colonna rinominata, un tipo reso più restrittivo, un campo rimosso — richiede l'esecuzione di `rebase db push` da una copia locale del repository:

```bash
pnpm exec rebase db push --dry-run --database-url '<your DATABASE_URL>'
```

Esamina l'output SQL prodotto dal dry run, quindi eseguilo nuovamente senza `--dry-run`. Una modifica che comporta la perdita di dati richiede anche il flag `--allow-destructive`.

`db push` pianifica ogni modifica in una copia temporanea dello schema, all'interno di un database che ha lo stesso nome del tuo con il suffisso `_dev_diff`. Crealo una tantum nella scheda **Access** del database, assegnandogli come proprietario lo stesso ruolo del tuo database.

Per le migrazioni con versionamento, esegui il commit dei file di migrazione con `rebase db generate` ed esegui `pnpm exec rebase db migrate --database-url '<your DATABASE_URL>'` da una copia locale prima di effettuare il push. Out Plane non prevede uno step di release prima del deploy.

## Prossimi passaggi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole relative al primo amministratore comuni a tutte le piattaforme.
- [Configuration](/docs/getting-started/configuration) — tutte le variabili di ambiente lette dal runtime.
- [Storage](/docs/backend/storage) — bucket, regole di accesso e gestione di più sorgenti di archiviazione contemporaneamente.
