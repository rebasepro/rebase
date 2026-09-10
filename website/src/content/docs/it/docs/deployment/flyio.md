---
sourceHash: d53d77c2683bb3d3
title: Deploy di Rebase su Fly.io
description: Scopri come distribuire Rebase a livello globale o limitarlo ai data center europei utilizzando Fly.io.
sidebar_label: Fly.io
---

Fly.io esegue container Docker vicino ai tuoi utenti su una rete anycast globale ed è altamente configurabile per quanto riguarda la posizione dei dati: un'ottima soluzione per un deployment di Rebase con un focus prettamente europeo. Fly dispone di data center ad **Amsterdam (ams)**, **Francoforte (fra)**, **Madrid (mad)** e **Parigi (cdg)**.

Nulla in questa pagina è specifico di Fly riguardo al tuo progetto. Un deployment di Rebase è composto da due parti separabili: l'immagine runtime pubblicata e il **bundle** generato da `rebase build` — e lo stesso bundle viene eseguito con Docker Compose su un laptop, su Rebase Cloud, tramite l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Inizializzare l'app Fly

Con `flyctl` installato, esegui dal tuo progetto:

```bash
fly launch --no-deploy
```

1. **App name:** `my-rebase-app`
2. **Organization:** personale o la tua organizzazione aziendale.
3. **Region:** scegli un data center europeo — Francoforte (`fra`) o Parigi (`cdg`).
4. **Database:** rispondi **Sì** per un cluster Postgres. Fly lo creerà nella stessa regione e inietterà `DATABASE_URL`.
5. **Redis:** rispondi **No**.

`--no-deploy` perché i secret e il bundle devono essere predisposti prima.

Se le tue collezioni dichiarano una proprietà `vector`, abilita l'estensione una volta sul database: `CREATE EXTENSION vector;`.

## 2. Compilare il bundle e puntare fly.toml all'immagine runtime

Non c'è **alcuna immagine dell'applicazione da compilare dal tuo sorgente**. `rebase build` produce una directory `dist-bundle` con le tue collezioni compilate, funzioni, cron e — se il tuo progetto dichiara un'app statica — il tuo frontend compilato:

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

`/livez` piuttosto che `/health`: quest'ultimo esegue un round-trip al database, quindi un liveness check basato su di esso riavvierebbe una macchina integra durante un breve intoppo del database.

`DISABLE_SELF_REGISTRATION` è una novità: sulla 0.17.3 non esiste questo switch e il primo account registrato diventa l'amministratore.

L'aggiornamento futuro di Rebase richiede solo una modifica a quella riga `FROM`. Il tuo bundle rimane invariato.

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

Gli ultimi due sono nuovi, e rappresentano il modo in cui l'app ottiene effettivamente un amministratore: in produzione il primo account che si registra non viene promosso, quindi nient'altro genera il primo chiamante autenticato. Impostali prima che il primo deploy inizi a gestire il traffico — vedi [Il tuo primo admin](/docs/getting-started/deployment/#your-first-admin). `fly secrets list` mostra solo i digest, quindi conserva la password generata da questo comando; non sarà più possibile recuperarla.

## 4. Deploy

```bash
fly deploy
```

Poi `fly open`.

## 5. Lo schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collezioni.** `REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che è un'operazione additiva sull'intero schema — crea tabelle, colonne e tipi enum mancanti e applica la loro row-level security — in questo modo il primo avvio su un database vuoto è subito pronto a servire le tue collezioni.

Ciò che `ensure` non fa mai è modificare qualcosa che già esiste: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di una macchina non deve rimodellare uno schema come effetto collaterale di un deploy.

Due cose richiedono quindi ancora la CLI, eseguita da un checkout o da un job di CI:

```bash
rebase db push
```

- **RLS per junction table** per le relazioni molti-a-molti.
- **Qualsiasi modifica che non sia puramente additiva** — una colonna rinominata, un tipo ristretto, un campo rimosso.

Per un'istanza privata di Fly Postgres, apri un tunnel con `fly proxy 5432 -a <your-db-app>` e punta `DATABASE_URL` su `localhost:5432`. L'immagine runtime viene fornita senza la CLI, quindi questo comando non viene mai eseguito all'interno della macchina e nemmeno un `release_command` può richiamarlo. Per le migrazioni con controllo di versione, effettua il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di rilascio.

## File storage

Il filesystem di una macchina Fly non sopravvive a un deploy, quindi lo storage locale dei file comporta una perdita silenziosa di dati e il runtime lo rifiuta in produzione. Collega un bucket compatibile con S3 — Tigris è quello fornito da Fly — con `STORAGE_TYPE=s3`. Vedi [Storage](/docs/backend/storage).

## Passaggi successivi

- [Deployment](/docs/getting-started/deployment) — la checklist di produzione e le regole per il primo admin comuni a tutte le piattaforme.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
