---
sourceHash: 263c0ae6a0fac44f
title: Deployare Rebase su Fly.io
description: Scopri come distribuire Rebase a livello globale o limitarlo ai data center europei utilizzando Fly.io.
sidebar_label: Fly.io
---

Fly.io esegue container Docker vicino ai tuoi utenti su una rete anycast globale, ed è altamente configurabile per quanto riguarda la posizione dei dati: un'ottima soluzione per un deployment di Rebase con un focus europeo rigoroso. Fly dispone di data center ad **Amsterdam (ams)**, **Francoforte (fra)**, **Madrid (mad)** e **Parigi (cdg)**.

Nulla in questa pagina è specifico di Fly per quanto riguarda il tuo progetto. Un deployment di Rebase è composto da due parti separabili — l'immagine runtime pubblicata e il **bundle** prodotto da `rebase build` — e lo stesso bundle viene eseguito con Docker Compose su un computer portatile, su Rebase Cloud, tramite il [chart Helm](/docs/deployment/kubernetes) e qui.

## 1. Inizializza l'app Fly

Con `flyctl` installato, esegui dal tuo progetto:

```bash
fly launch --no-deploy
```

1. **Nome dell'app:** `my-rebase-app`
2. **Organizzazione:** personale, o la tua organizzazione aziendale.
3. **Regione:** scegli un data center europeo — Francoforte (`fra`) o Parigi (`cdg`).
4. **Database:** rispondi **Sì** per un cluster Postgres. Fly lo creerà nella stessa regione e inietterà `DATABASE_URL`.
5. **Redis:** rispondi **No**.

`--no-deploy` perché i secret e il bundle devono essere configurati prima del deploy.

Se le tue collezioni dichiarano una proprietà `vector`, abilita l'estensione una volta sul database: `CREATE EXTENSION vector;`.

## 2. Genera il bundle e punta fly.toml all'immagine runtime

Non c'è **alcuna immagine dell'applicazione da compilare dal tuo codice sorgente**. `rebase build` produce una directory `dist-bundle` contenente le tue collezioni compilate, funzioni, cron job e — se il tuo progetto dichiara un'app statica — il tuo frontend compilato:

```bash
rebase build
```

Esegui il commit di un `Dockerfile` di tre righe nella root del progetto:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
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

`/livez` anziché `/health`: il secondo esegue un round-trip con il database, quindi un liveness check su di esso riavvierebbe una macchina integra durante una breve interruzione temporanea del database.

`DISABLE_SELF_REGISTRATION` è nuovo: sulla versione 0.17.3 non esiste tale
opzione, e il primo account registrato diventa l'amministratore.

L'aggiornamento futuro di Rebase consisterà semplicemente nella modifica di quella riga `FROM`. Il tuo bundle rimarrà intatto.

## 3. Imposta i secret di produzione

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

Gli ultimi due sono nuovi, e rappresentano il modo in cui questa applicazione ottiene un amministratore: in produzione, il primo account a registrarsi non viene promosso, quindi nient'altro genera il primo chiamante autenticato. Impostali prima che il primo deployment gestisca il traffico — consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin). `fly secrets list` mostra solo i digest, quindi conserva la password generata da questo comando; non c'è modo di recuperarla in seguito.

## 4. Deploy

```bash
fly deploy
```

Poi esegui `fly open`.

## 5. Lo schema

**Il runtime crea le tabelle mancanti all'avvio, comprese quelle delle tue collezioni.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che ha un comportamento additivo sull'intero schema — crea tabelle, colonne e tipi enum mancanti e applica la loro row-level security — in questo modo il primo avvio su un database vuoto inizia subito a servire le tue collezioni.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non modifica il tipo di una colonna, non elimina nulla e non modifica i valori di un enum esistente, poiché il riavvio di una macchina non deve rimodellare uno schema come effetto collaterale di un deployment.

Due operazioni richiedono quindi ancora l'uso della CLI, eseguita da un checkout locale o da un job CI:

```bash
rebase db push
```

- **RLS sulle tabelle ponte (junction table)** per le relazioni molti-a-molti.
- **Qualsiasi modifica che non sia puramente additiva** — una colonna rinominata, un tipo ristretto, un campo rimosso.

Per un'istanza privata di Fly Postgres, apri un tunnel con `fly proxy 5432 -a <your-db-app>` e punta `DATABASE_URL` a `localhost:5432`. L'immagine runtime viene distribuita senza la CLI, quindi questo comando non viene mai eseguito all'interno della macchina e nemmeno un `release_command` può richiamarlo. Per migrazioni con controllo di versione, fai il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di rilascio.

## Archiviazione dei file

Il filesystem di una macchina Fly non sopravvive a un deployment, quindi lo storage locale dei file comporterebbe una perdita silenziosa di dati e il runtime lo rifiuta in produzione. Collega un bucket compatibile con S3 — Tigris è quello fornito da Fly — con `STORAGE_TYPE=s3`. Consulta [Storage](/docs/backend/storage).

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist di produzione e le regole del primo amministratore comuni a tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.

---
