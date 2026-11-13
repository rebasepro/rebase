---
sourceHash: 690eccad01963163
title: Distribuire Rebase su Hostman
description: Distribuisci un progetto rebase init su Hostman — App Platform con Managed PostgreSQL e storage S3, oppure un unico server cloud con il file Compose del tuo progetto.
sidebar_label: Hostman
---

[Hostman](https://hostman.com) offre due soluzioni adatte a un backend Rebase, con data center in Europa e negli Stati Uniti:

- **App Platform con Managed PostgreSQL.** Hostman compila ed esegue la tua applicazione da un repository GitHub e gestisce il database. I suoi container ripartono da zero a ogni deploy, quindi **i caricamenti di file richiedono un bucket compatibile con S3 fin dal primo giorno**.
- **Un unico server cloud.** Postgres e il runtime su un VPS, gestiti tramite il file `docker-compose.yml` già presente nel tuo progetto. **I caricamenti possono rimanere sul disco del server.**

Nulla in questa pagina è specifico di Hostman per quanto riguarda il tuo progetto. Un deployment di Rebase è composto da due parti separabili: l'immagine runtime pubblicata e il **bundle** prodotto da `rebase build` — e lo stesso bundle può essere eseguito su un computer portatile, su Rebase Cloud e qui.

## App Platform

### 1. Creare il database

Nel pannello di Hostman, crea un cluster **Managed PostgreSQL**:

- **Versione:** 16 o più recente.
- **Regione:** la stessa in cui eseguirai l'applicazione.
- **Rete:** una rete privata. Inserisci l'applicazione nella stessa rete al passaggio 4. La rete di un'applicazione viene scelta al momento della sua creazione e non può essere modificata successivamente.

Il cluster include un utente, `gen_user`, e un database, `default_db`. Dalla scheda **Connection**, copia la stringa di connessione per l'**IP privato**. Corrisponde al tuo `DATABASE_URL`:

```
postgresql://gen_user:<password>@<private-ip>:5432/default_db
```

Se il cluster richiede TLS, aggiungi `?sslmode=require` alla fine.

#### Creare il ruolo a cui Rebase passa

Rebase applica la sicurezza a livello di riga (row-level security) passando, per ogni richiesta autenticata, a un ruolo con restrizioni, `rebase_user`. `gen_user` deve avere i permessi per creare tale ruolo e per passare a esso.

1. Nella scheda **Users** del cluster, assegna a `gen_user` il privilegio **CREATE ROLE**. La configurazione più piccola di Hostman (1 CPU, 1 GB RAM, 20 GB) non consente di aggiungere utenti o database. Se non ti permette di concedere il privilegio, passa alla configurazione successiva.
2. Collegati una volta come `gen_user` con `psql`, prima del primo deploy, ed esegui:

   ```sql
   CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
   GRANT rebase_user TO gen_user WITH SET TRUE, INHERIT FALSE;
   ```

   Il database si trova su una rete privata, quindi esegui questo comando da un server cloud nella stessa rete, oppure abilita temporaneamente l'accesso pubblico.

La seconda istruzione è quella fondamentale. Su PostgreSQL 16 e successivi, un utente che crea un ruolo senza essere un superuser ne diventa membro, ma non un membro autorizzato a passare a esso. Se il runtime crea il ruolo da solo, l'avvio ha successo, ma ogni richiesta autenticata fallisce con l'errore `DB_PERMISSION_DENIED`. Se ciò è già accaduto, esegui la riga con `GRANT` e riavvia l'applicazione.

Se le tue tabelle dichiarano una colonna `col.vector()`, abilita **pgvector** sotto **Configuration → Extensions**. Lo scaffold iniziale non ne dichiara alcuna.

### 2. Creare un bucket

Crea un bucket compatibile con S3: lo storage S3 offerto da Hostman o qualsiasi altro provider. Dalle impostazioni del bucket, annota l'endpoint, la regione, l'access key e la secret key. Mantieni il bucket **privato**: Rebase firma ogni download, e la funzione `storageAuthorize` in `backend/storage.ts` stabilisce chi può leggere, scrivere ed elencare i file.

### 3. Aggiungere un Dockerfile

App Platform compila l'applicazione a partire dal tuo repository e, poiché `dist-bundle/` è ignorato da git, l'immagine compila il bundle direttamente, per poi passarlo al runtime pubblicato. Esegui il commit di questo file nella root del progetto:

```dockerfile title="Dockerfile"
# Build the bundle from your source
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npx -y pnpm@11 install --frozen-lockfile && npx -y pnpm@11 run build

# The published runtime, with nothing added but the bundle
FROM rebasepro/server:0.30.1
COPY --from=build --chown=node:node /app/dist-bundle /bundle
```

Tre dettagli sono importanti qui:

- **`node:22`, non `node:22-slim`.** L'installazione della CLI scarica il motore di schema Atlas, che richiede `curl` e i certificati CA. L'immagine slim non include nessuno dei due, e l'installazione fallirebbe.
- **`--chown=node:node`.** Il runtime viene eseguito come utente `node` e collega (linka) i propri pacchetti nel bundle all'avvio. Un bundle di proprietà di root viene comunque servito, ma registra un avviso per ogni pacchetto che non è riuscito a collegare.
- **Nessun codice sorgente nell'immagine finale.** L'immagine finale contiene solo il runtime e il tuo bundle compilato. Per aggiornare Rebase in futuro, basterà modificare la seconda riga `FROM`.

L'immagine runtime è in ascolto sulla porta 8080 e la dichiara con `EXPOSE`, che è la porta verso cui App Platform instrada il traffico.

### 4. Creare l'applicazione

In **App Platform**, crea un'applicazione **Backend**:

1. Collega il repository GitHub e il branch.
2. Imposta **Framework** su **Dockerfile**.
3. Scegli la stessa regione del database e la **rete privata** del database.
4. Scegli una configurazione con **2 GB di RAM**. Il bundle viene compilato durante la creazione dell'immagine e la fase di build raggiunge picchi di circa 1 GB, pertanto una configurazione da 1 GB potrebbe esaurire la memoria.
5. Imposta l'**health check path** su `/livez`. Anche il valore predefinito, `/`, funziona, ma `/livez` risponde senza interrogare il database, evitando che un temporaneo problema del database provochi il riavvio di un'applicazione altrimenti sana.

Sotto **Advanced settings**, aggiungi le variabili d'ambiente:

```env
NODE_ENV=production
DATABASE_URL=postgresql://gen_user:<password>@<private-ip>:5432/default_db
JWT_SECRET=<openssl rand -hex 32>
REBASE_SERVICE_KEY=<openssl rand -hex 32, a second one>
CORS_ORIGINS=https://<your-app-domain>
FRONTEND_URL=https://<your-app-domain>
DISABLE_SELF_REGISTRATION=true
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
STORAGE_TYPE=s3
S3_BUCKET=<bucket>
S3_REGION=<region>
S3_ENDPOINT=<endpoint>
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret key>
S3_FORCE_PATH_STYLE=true
```

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` specificano il primo amministratore. In produzione, il primo account a registrarsi non riceve privilegi di amministratore in automatico, quindi nessun'altra procedura ne crea uno. Il runtime crea l'account una sola volta, quando la tabella degli utenti è ancora vuota. Consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin).

L'indirizzo dell'applicazione non è noto finché essa non viene creata. Crea l'applicazione, recupera il suo dominio tecnico dalla scheda **Dashboard**, quindi imposta `CORS_ORIGINS` e `FRONTEND_URL` con quel valore. Il salvataggio delle impostazioni avvierà un nuovo deploy dell'applicazione.

### 5. Aprire l'applicazione

Apri il dominio dell'applicazione. Un unico container serve il pannello di amministrazione su `/` e le API su `/api`. Accedi con `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`, quindi modifica la password.

Ogni push sul branch avvia un nuovo deploy. Per aggiungere un dominio personalizzato, usa **Settings → Domains**. Hostman rilascerà il certificato. Aggiungi la nuova origine a `CORS_ORIGINS` e `FRONTEND_URL`.

## Un unico server cloud

Un server cloud di Hostman esegue lo stesso stack di qualsiasi VPS: Postgres e il runtime sotto il file `docker-compose.yml` del tuo progetto, con Caddy a monte per la gestione di HTTPS. Un server con 2 vCPU e 2 GB di RAM è sufficiente per iniziare.

Crealo con **Ubuntu 24.04** e la tua chiave SSH, quindi segui i [passaggi per un singolo server illustrati nella pagina di Hetzner](/docs/deployment/hetzner/#one-server-from-your-project). Nessuno di essi dipende strettamente da Hetzner.

Su un server, i caricamenti rimangono sul suo disco locale: il file Compose li conserva su un volume con nome e imposta `FORCE_LOCAL_STORAGE=true`. Sopravvivono a riavvii e nuovi deploy, ma non alla perdita del server; attiva quindi i backup del server di Hostman o spostali su un bucket non appena iniziano a essere critici.

## Lo schema

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate da `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, un'operazione additiva sull'intero schema. Crea tabelle, colonne e tipi enum mancanti applicando la relativa sicurezza a livello di riga, in modo che una nuova tabella sia attiva già al deploy successivo.

`ensure` non modifica mai elementi già esistenti. Non altera il tipo di una colonna, non rimuove nulla e non modifica le etichette di un enum esistente, poiché un deploy non deve rimodellare uno schema come effetto collaterale.

Qualsiasi modifica che non sia puramente additiva — una colonna rinominata, un tipo reso più restrittivo, un campo rimosso — richiede l'uso di `rebase db push`, eseguito dal codice locale:

```bash
pnpm exec rebase db push --dry-run --database-url '<connection string>'
```

Controlla l'SQL stampato dall'esecuzione di prova (dry run), quindi esegui nuovamente il comando senza `--dry-run`. Due accorgimenti preliminari da predisporre su Managed PostgreSQL:

- **Raggiungibilità.** Un database su una rete privata non è raggiungibile dal tuo computer. Abilita temporaneamente l'accesso pubblico oppure esegui il comando da un server situato nella stessa rete.
- **Il database temporaneo (scratch).** `db push` pianifica ogni modifica su una copia temporanea dello schema, in un database con lo stesso nome del tuo seguito da `_dev_diff`. Assegna a `gen_user` il privilegio **CREATEDB**, oppure crea `default_db_dev_diff` una volta sola dal pannello. Nessuna delle due opzioni è possibile sulla configurazione più piccola.

Per migrazioni con versionamento, genera i file di migrazione con `rebase db generate` e includili nel repository, eseguendo poi `rebase db migrate` come passaggio della procedura di rilascio.

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist per la produzione e le regole per il primo amministratore comuni a tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
- [Storage](/docs/backend/storage) — bucket, regole di accesso e utilizzo contemporaneo di più sorgenti di storage.
