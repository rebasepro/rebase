---
sourceHash: 15a0356fd585a797
title: Distribuire Rebase su Fly.io
description: Scopri come distribuire Rebase a livello globale o limitarlo ai data center europei utilizzando Fly.io.
sidebar_label: Fly.io
---

Fly.io esegue container Docker vicino ai tuoi utenti su una rete anycast globale ed è altamente configurabile riguardo a dove risiedono i dati: un'ottima soluzione per un deployment di Rebase focalizzato rigorosamente sull'Europa. Fly dispone di data center ad **Amsterdam (ams)**, **Francoforte (fra)**, **Madrid (mad)** e **Parigi (cdg)**.

Nulla in questa pagina è specifico di Fly per quanto riguarda il tuo progetto. Un deployment di Rebase è costituito da due parti distinte: l'immagine di runtime pubblicata e il **bundle** prodotto da `rebase build`; lo stesso bundle può essere eseguito con Docker Compose su un computer portatile, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Inizializzare l'app Fly

Con `flyctl` installato, esegui dal tuo progetto:

```bash
fly launch --no-deploy
```

1. **Nome app:** `my-rebase-app`
2. **Organizzazione:** personale, o la tua organizzazione aziendale.
3. **Regione:** scegli un data center europeo — Francoforte (`fra`) o Parigi (`cdg`).
4. **Database:** rispondi **Yes** per un cluster Postgres. Fly lo creerà nella stessa regione e inietterà `DATABASE_URL`.
5. **Redis:** rispondi **No**.

`--no-deploy` perché i secret e il bundle devono essere configurati prima.

Se le tue tabelle dichiarano una colonna `col.vector()`, abilita l'estensione una volta sul database: `CREATE EXTENSION vector;`.

## 2. Compilare il bundle e puntare fly.toml all'immagine di runtime

Non c'è **alcuna immagine dell'applicazione da compilare dal tuo codice sorgente**. `rebase build` genera una directory `dist-bundle` con le tue tabelle compilate, funzioni, cron job e — se il tuo progetto dichiara un'app statica — il tuo frontend compilato:

```bash
rebase build
```

Esegui il commit di un `Dockerfile` di tre righe nella root del progetto:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

E punta `fly.toml` ad esso:

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

Usa `/livez` invece di `/health`: il secondo esegue un round-trip al database, quindi un controllo di liveness su di esso riavvierebbe una macchina integra durante una breve interruzione temporanea del database.

Aggiornare Rebase in seguito richiederà solo una modifica a quella riga `FROM`. Il tuo bundle rimarrà invariato.

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

Gli ultimi due sono nuovi e rappresentano il modo in cui questa app ottiene un amministratore: in produzione il primo account a registrarsi non viene promosso, quindi nessun altro meccanismo genera il primo chiamante autenticato. Impostali prima che il primo deploy inizi a gestire traffico — vedi [Il tuo primo admin](/docs/getting-started/deployment/#your-first-admin). `fly secrets list` mostra solo i digest, quindi conserva la password generata da questo comando; non c'è modo di rileggerla in seguito.

## 4. Deploy

```bash
fly deploy
```

Poi esegui `fly open`.

## 5. Lo schema

<span class="since-badge" data-since="0.31">Da 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate da `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che è un'operazione additiva sull'intero schema: crea le tabelle, le colonne e i tipi enum mancanti e applica la loro row-level security, consentendo al primo avvio su un database vuoto di essere già pronto a servire le tue tabelle.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non altera il tipo di una colonna, non elimina nulla né modifica le etichette di un enum esistente, poiché il riavvio di una macchina non deve rimodellare uno schema come effetto collaterale di un deploy.

Una cosa richiede quindi ancora l'uso della CLI, eseguita da un checkout locale o da un job di CI:

```bash
rebase db push
```

Qualsiasi modifica che non sia puramente additiva: una colonna rinominata, un tipo ristretto, un campo rimosso.

Per un Fly Postgres privato, apri un tunnel con `fly proxy 5432 -a <your-db-app>` e punta `DATABASE_URL` verso `localhost:5432`. L'immagine di runtime viene fornita senza la CLI, quindi questo comando non viene mai eseguito all'interno della macchina e nemmeno un `release_command` può invocarlo. Per migrazioni versionate, esegui invece il commit dei file di migrazione con `rebase db generate` ed esegui `rebase db migrate` come passaggio di rilascio.

## Archiviazione dei file

Il filesystem di una macchina Fly non sopravvive a un deploy, quindi lo storage locale dei file comporta una perdita silenziosa di dati e il runtime lo rifiuta in produzione. Collega un bucket compatibile con S3 (Tigris è quello fornito da Fly) con `STORAGE_TYPE=s3`. Vedi [Storage](/docs/backend/storage).

## Prossimi passi

- [Deployment](/docs/getting-started/deployment) — la checklist di produzione e le regole per il primo amministratore condivise da tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
