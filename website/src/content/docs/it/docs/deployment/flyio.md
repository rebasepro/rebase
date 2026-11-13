---
sourceHash: 10c8baa5ed2e63bf
title: Deploy di Rebase su Fly.io
description: Scopri come distribuire Rebase a livello globale o limitarlo ai data center europei utilizzando Fly.io.
sidebar_label: Fly.io
---

Fly.io esegue container Docker vicino ai tuoi utenti su una rete anycast globale, ed è altamente configurabile riguardo a dove risiedono i dati: un'ottima soluzione per un deployment di Rebase con un focus rigorosamente europeo. Fly dispone di data center ad **Amsterdam (ams)**, **Francoforte (fra)**, **Madrid (mad)** e **Parigi (cdg)**.

Nulla in questa pagina è specifico di Fly per quanto riguarda il tuo progetto. Un deployment di Rebase è costituito da due parti separabili: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build`; lo stesso bundle può essere eseguito con Docker Compose su un portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Inizializzare l'app Fly

Con `flyctl` installato, dal tuo progetto:

```bash
fly launch --no-deploy
```

1. **Nome dell'app:** `my-rebase-app`
2. **Organizzazione:** personale, o la tua organizzazione aziendale.
3. **Regione:** scegli un data center europeo — Francoforte (`fra`) o Parigi (`cdg`).
4. **Database:** rispondi **Sì** per un cluster Postgres. Fly lo crea nella stessa regione e inietta `DATABASE_URL`.
5. **Redis:** rispondi **No**.

`--no-deploy` perché i secret e il bundle devono essere configurati prima.

Se le tue tabelle dichiarano una colonna `col.vector()`, abilita l'estensione una volta sul database: `CREATE EXTENSION vector;`.

## 2. Compilare il bundle e puntare fly.toml all'immagine di runtime

Non c'è **alcuna immagine applicativa da compilare dal tuo codice sorgente**. `rebase build` produce una directory `dist-bundle` contenente le tabelle compilate, le funzioni, i cron job e — se il tuo progetto dichiara un'app statica — il frontend compilato:

```bash
rebase build
```

Esegui il commit di un `Dockerfile` di tre righe nella root del progetto:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

E punta `fly.toml` verso di esso:

```toml title="fly.toml"
app = "my-rebase-app"
primary_region = "fra"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  DISABLE_SELF_REGISTRATION = "true"

[http_service]
  internal_port = 8080          # the port the runtime image listens on
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1      # realtime subscriptions need a machine to stay up

[[http_service.checks]]
  path = "/livez"
```

`/livez` invece di `/health`: il secondo esegue un round-trip verso il database, quindi un liveness check su di esso riavvierebbe una macchina integra durante un breve intoppo del database.

Aggiornare Rebase in seguito richiederà solo una modifica a quella riga `FROM`. Il tuo bundle rimane invariato.

## 3. Impostare i secret di produzione

```bash
fly secrets set \
  JWT_SECRET=your_super_long_randomly_generated_secure_string \
  REBASE_SERVICE_KEY=another_super_long_randomly_generated_secure_string \
  CORS_ORIGINS=https://my-rebase-app.fly.dev \
  FRONTEND_URL=https://my-rebase-app.fly.dev \
  REBASE_ADMIN_EMAIL=you@example.com \
  REBASE_ADMIN_PASSWORD=$(openssl rand -hex 12) \
  -a my-rebase-app
```

Gli ultimi due sono nuovi e sono il modo in cui questa app ottiene un amministratore: in produzione il primo account che si registra non viene promosso, quindi nessun altro meccanismo crea il primo chiamante autenticato. Impostali prima che il primo deploy inizi a gestire il traffico — vedi [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin). `fly secrets list` mostra solo i digest, quindi conserva la password generata da questo comando; non c'è modo di rileggerla in seguito.

## 4. Deploy

```bash
fly deploy
```

Poi `fly open`.

## 5. Lo schema

<span class="since-badge" data-since="0.31">Da 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate da `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che è additivo sull'intero schema: crea tabelle, colonne e tipi enum mancanti e applica la loro row-level security, consentendo al primo avvio su un database vuoto di iniziare subito a servire le tue collezioni.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non modifica il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di una macchina non deve rimodellare uno schema come effetto collaterale di un deploy.

Una cosa richiede quindi ancora l'uso della CLI, eseguita da un checkout locale o da un job di CI:

```bash
rebase db push
```

Qualsiasi modifica che non sia puramente additiva: una colonna rinominata, un tipo ristretto, un campo rimosso.

Per un'istanza privata di Fly Postgres, apri un tunnel con `fly proxy 5432 -a <your-db-app>` e punta `DATABASE_URL` su `localhost:5432`. L'immagine di runtime viene fornita senza la CLI, quindi questo comando non viene mai eseguito all'interno della macchina e nemmeno un `release_command` può invocarlo. Per le migrazioni con controllo di versione, esegui il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di rilascio.

## Archiviazione file

Il filesystem di una macchina Fly non sopravvive a un deploy, quindi lo storage di file locale comporterebbe una perdita invisibile di dati e il runtime lo rifiuta in produzione. Collega un bucket compatibile con S3 — Tigris è quello fornito da Fly — con `STORAGE_TYPE=s3`. Vedi [Storage](/docs/backend/storage).

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist di produzione e le regole per il primo amministratore comuni a tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
