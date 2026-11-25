---
sourceHash: 77a241c623129aa8
title: Deploy di Rebase su Hostman
description: Distribuisci un progetto rebase init su Hostman — App Platform con Managed PostgreSQL e storage S3, oppure un singolo server cloud con il file Compose del tuo progetto.
sidebar_label: Hostman
---

[Hostman](https://hostman.com) offre due configurazioni adatte a un backend Rebase, con data center in Europa e negli Stati Uniti:

- **App Platform con Managed PostgreSQL.** Hostman compila ed esegue la tua app da un repository GitHub e gestisce il database. I suoi container si avviano puliti a ogni deploy, quindi **i caricamenti di file necessitano di un bucket compatibile con S3 fin dal primo giorno**.
- **Un singolo server cloud.** Postgres e il runtime su una VPS, gestiti dal file `docker-compose.yml` già presente nel tuo progetto. **I caricamenti possono rimanere sul disco del server.**

Nulla in questa pagina è specifico di Hostman per quanto riguarda il tuo progetto. Un deploy di Rebase è composto da due parti separabili: l'immagine runtime pubblicata e il **bundle** generato da `rebase build` — e lo stesso bundle può essere eseguito su un laptop, su Rebase Cloud e qui.

## App Platform

### 1. Crea il database

Nel pannello di Hostman, crea un cluster **Managed PostgreSQL**:

- **Versione:** 16 o successiva.
- **Regione:** quella in cui eseguirai l'app.
- **Rete:** una rete privata. Inserisci l'app nella stessa rete al passaggio 4. La rete di un'app viene scelta al momento della creazione e non può essere modificata in seguito.

Il cluster include un utente, `gen_user`, e un database, `default_db`. Dalla scheda **Connection**, copia la stringa di connessione per l'**IP privato**. Corrisponde al tuo `DATABASE_URL`:

```
postgresql://gen_user:<password>@<private-ip>:5432/default_db
```

Se il cluster richiede TLS, aggiungi `?sslmode=no-verify` alla fine: crittografato, senza verificare il certificato tramite una public authority. Un semplice `sslmode=require` viene interpretato come "verifica" dal driver Node su cui gira Rebase, e fallisce in presenza di un certificato non firmato da una public authority. Consulta [Configurazione](/docs/getting-started/configuration/#required).

#### Crea il ruolo a cui passa Rebase

Rebase applica la row-level security passando ogni richiesta autenticata a un ruolo con permessi limitati, `rebase_user`. `gen_user` deve avere il permesso di creare quel ruolo e di assumerlo.

1. Nella scheda **Users** del cluster, assegna a `gen_user` il privilegio **CREATE ROLE**. La configurazione più piccola di Hostman (1 CPU, 1 GB RAM, 20 GB) non consente di aggiungere utenti o database. Se non ti permette di concedere il privilegio, scegli la configurazione immediatamente successiva.
2. Connettiti una volta come `gen_user` con `psql`, prima del primo deploy, ed esegui:

   ```sql
   CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
   GRANT rebase_user TO gen_user WITH SET TRUE, INHERIT FALSE;
   ```

   Il database si trova su una rete privata, quindi esegui questo comando da un server cloud nella stessa rete oppure abilita l'accesso pubblico per la durata dell'operazione.

La seconda istruzione è quella fondamentale. Su PostgreSQL 16 e versioni successive, un utente che crea un ruolo senza essere un superuser ne diventa membro, ma non può assumerlo (switch). Se il runtime crea il ruolo autonomamente, l'avvio ha successo ma ogni richiesta autenticata fallisce con `DB_PERMISSION_DENIED`. Se ciò è già accaduto, esegui l'istruzione `GRANT` e riavvia l'app.

Se le tue tabelle dichiarano una colonna `col.vector()`, abilita **pgvector** in **Configuration → Extensions**. Lo scaffold iniziale non ne dichiara alcuna.

### 2. Crea un bucket

Crea un bucket compatibile con S3 — lo storage S3 proprietario di Hostman o qualsiasi altro provider. Nelle impostazioni del bucket, annota l'endpoint, la regione, l'access key e la secret key. Mantieni il bucket **privato**: Rebase firma ogni download e `storageAuthorize` in `backend/storage.ts` determina chi può leggere, scrivere ed elencare i file.

### 3. Aggiungi un Dockerfile

App Platform esegue la compilazione a partire dal tuo repository e, poiché `dist-bundle/` è ignorato da Git, l'immagine compila direttamente il bundle per poi passarlo al runtime pubblicato. Esegui il commit di questo file nella root del progetto:

```dockerfile title="Dockerfile"
# Build the bundle from your source
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npx -y pnpm@11 install --frozen-lockfile && npx -y pnpm@11 run build

# The published runtime, with nothing added but the bundle
FROM rebasepro/server:0.37.0
COPY --from=build --chown=node:node /app/dist-bundle /bundle
```

Tre dettagli sono importanti qui:

- **`node:22`, non `node:22-slim`.** L'installazione della CLI scarica il motore di schema Atlas, che richiede `curl` e certificati CA. L'immagine slim non dispone di nessuno dei due e l'installazione fallisce.
- **`--chown=node:node`.** Il runtime viene eseguito come utente `node` e collega i propri pacchetti nel bundle all'avvio. Un bundle di proprietà di root funziona comunque, ma registra un avviso per ogni pacchetto che non è stato in grado di collegare.
- **Nessun codice sorgente nell'immagine finale.** Contiene solo il runtime e il tuo bundle compilato. L'aggiornamento futuro di Rebase richiede solo la modifica della seconda riga `FROM`.

L'immagine del runtime ascolta sulla porta 8080 e la dichiara con `EXPOSE`, che è la porta verso cui App Platform instrada il traffico.

### 4. Crea l'app

In **App Platform**, crea un'app di tipo **Backend**:

1. Collega il repository GitHub e il branch.
2. Imposta **Framework** su **Dockerfile**.
3. Scegli la stessa regione del database e la **rete privata** del database.
4. Scegli una configurazione con **2 GB di RAM**. Il bundle viene compilato come parte dell'immagine e la build ha picchi di circa 1 GB, quindi una configurazione da 1 GB potrebbe esaurire la memoria.
5. Imposta il **percorso dell'health check** su `/livez`. Anche il valore predefinito, `/`, funziona, ma `/livez` risponde senza interrogare il database, evitando che un breve disservizio temporaneo del database riavvii un'app altrimenti sana.

In **Advanced settings**, aggiungi le variabili d'ambiente:

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

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` definiscono il primo amministratore. In produzione, il primo account registrato non viene promosso automaticamente, quindi nessun altro meccanismo ne crea uno. Il runtime crea l'account una sola volta, quando la tabella degli utenti è vuota. Consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin).

L'indirizzo dell'app non è noto finché non viene creata. Crea l'app, rileva il suo dominio tecnico dalla scheda **Dashboard**, quindi imposta `CORS_ORIGINS` e `FRONTEND_URL` con quel valore. Il salvataggio delle impostazioni rieseguirà il deploy dell'app.

### 5. Apri l'applicazione

Apri il dominio dell'app. Un singolo container serve il pannello di amministrazione su `/` e l'API su `/api`. Accedi con `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`, quindi modifica la password.

Ogni push sul branch avvia un nuovo deploy. Per aggiungere un dominio personalizzato, vai su **Settings → Domains**. Hostman emette il certificato. Aggiungi la nuova origine a `CORS_ORIGINS` e `FRONTEND_URL`.

## Un singolo server cloud

Un server cloud Hostman esegue lo stesso stack di qualsiasi VPS: Postgres e il runtime sotto il file `docker-compose.yml` del tuo progetto, con Caddy come reverse proxy per HTTPS. Un server con 2 vCPU e 2 GB di RAM è sufficiente per iniziare.

Crealo con **Ubuntu 24.04** e la tua chiave SSH, quindi segui i [passaggi per un singolo server nella pagina Hetzner](/docs/deployment/hetzner/#one-server-from-your-project). Nessuno di essi dipende specificamente da Hetzner.

Su un server, i caricamenti rimangono sul suo disco: il file Compose li conserva su un volume con nome e imposta `FORCE_LOCAL_STORAGE=true`. Sopravvivono a riavvii e nuovi deploy, ma non alla perdita del server, quindi attiva i backup del server di Hostman o spostali su un bucket quando iniziano a diventare importanti.

## Lo schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate da `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che opera in modalità additiva sull'intero schema. Crea tabelle, colonne e tipi enum mancanti e applica la loro row-level security, rendendo disponibile una nuova tabella già al deploy successivo.

`ensure` non modifica mai ciò che già esiste. Non altera il tipo di una colonna, non elimina nulla né modifica le etichette di un enum esistente, poiché un deploy non deve alterare la struttura di uno schema come effetto collaterale.

Qualsiasi modifica che non sia puramente additiva — una colonna rinominata, un tipo ristretto, un campo rimosso — richiede l'esecuzione di `rebase db push` da un checkout locale:

```bash
pnpm exec rebase db push --dry-run --database-url '<connection string>'
```

Esamina l'SQL generato dal dry run, quindi eseguilo di nuovo senza `--dry-run`. Ci sono due elementi da predisporre preventivamente su Managed PostgreSQL:

- **Raggiungibilità.** Un database su una rete privata non è raggiungibile dal tuo computer portatile. Abilita l'accesso pubblico per la durata dell'operazione, oppure esegui il comando da un server nella stessa rete.
- **Il database temporaneo (scratch database).** `db push` pianifica ogni modifica in una copia temporanea dello schema, all'interno di un database che prende il nome del tuo con il suffisso `_dev_diff`. Assegna a `gen_user` il privilegio **CREATEDB**, oppure crea `default_db_dev_diff` una tantum dal pannello. Nessuna delle due opzioni è possibile sulla configurazione più piccola.

Per le migrazioni versionate, esegui il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio della release.

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist di produzione e le regole per il primo amministratore comuni a tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
- [Storage](/docs/backend/storage) — bucket, regole di accesso e sorgenti di archiviazione multiple contemporaneamente.
