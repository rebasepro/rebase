---
sourceHash: cf8b6ef73e2189bf
title: Deploy di Rebase su Fly.io
description: Scopri come eseguire il deploy di Rebase a livello globale o limitarlo ai data center europei utilizzando Fly.io.
sidebar_label: Fly.io
---

Fly.io esegue container Docker vicino ai tuoi utenti su una rete anycast globale ed è altamente configurabile riguardo a dove risiedono i dati: una soluzione ideale per un deploy di Rebase con un focus rigorosamente europeo. Fly dispone di data center ad **Amsterdam (ams)**, **Francoforte (fra)**, **Madrid (mad)** e **Parigi (cdg)**.

Nulla in questa pagina è specifico di Fly per quanto riguarda il tuo progetto. Un deploy di Rebase è composto da due parti separabili: l'immagine runtime pubblicata e il **bundle** prodotto da `rebase build` — e lo stesso bundle funziona con Docker Compose su un laptop, su Rebase Cloud, con l'[Helm chart](/docs/deployment/kubernetes) e qui.

## 1. Inizializza l'app Fly

Con `flyctl` installato, dal tuo progetto:

```bash
fly launch --no-deploy
```

1. **Nome dell'app:** `my-rebase-app`
2. **Organizzazione:** personale, o la tua organizzazione aziendale.
3. **Regione:** scegli un data center europeo — Francoforte (`fra`) o Parigi (`cdg`).
4. **Database:** rispondi **Yes** per un cluster Postgres. Fly lo creerà nella stessa regione e inietterà `DATABASE_URL`.
5. **Redis:** rispondi **No**.

`--no-deploy` perché i secret e il bundle devono essere predisposti prima.

Se le tue collection dichiarano una proprietà `vector`, abilita l'estensione una volta su quel database: `CREATE EXTENSION vector;`.

## 2. Crea il bundle e punta fly.toml all'immagine runtime

Non c'è **alcuna immagine dell'applicazione da compilare dal tuo codice sorgente**. `rebase build` produce una directory `dist-bundle` con le tue collection, funzioni, cron compilati e — se il tuo progetto dichiara un'app statica — il tuo frontend compilato:

```bash
rebase build
```

Esegui il commit di un `Dockerfile` di tre righe nella root del progetto:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.21.1
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

`/livez` piuttosto che `/health`: il secondo esegue un round-trip sul database, quindi un liveness check su di esso riavvierebbe una macchina integra durante un breve singhiozzo temporaneo del database.

`DISABLE_SELF_REGISTRATION` è nuovo: nella 0.17.3 non è presente questa opzione e il primo account che si registra diventa l'amministratore.

Aggiornare Rebase in futuro richiederà solo una modifica a quella riga `FROM`. Il tuo bundle rimarrà intatto.

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

Gli ultimi due sono nuovi, e rappresentano il modo in cui questa app ottiene un amministratore: in produzione il primo account che si registra non viene promosso, quindi nient'altro genererà il primo utente autenticato. Impostali prima che il primo deploy inizi a servire traffico — vedi [Il tuo primo admin](/docs/getting-started/deployment/#your-first-admin). `fly secrets list` mostra solo i digest, quindi conserva la password generata da questo comando; non c'è modo di recuperarla in seguito.

## 4. Esegui il deploy

```bash
fly deploy
```

Poi `fly open`.

## 5. Lo schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collection.** Il valore predefinito di `REBASE_MIGRATE_ON_BOOT` è `ensure`, che opera in modo additivo sull'intero schema — crea tabelle, colonne e tipi enum mancanti e applica la loro row-level security — in modo che il primo avvio su un database vuoto sia subito pronto a gestire le tue collection.

Ciò che `ensure` non fa mai è modificare qualcosa che esiste già: non altera il tipo di una colonna, non elimina nulla e non modifica le etichette di un enum esistente, poiché il riavvio di una macchina non deve rimodellare uno schema come effetto collaterale di un deploy.

Due operazioni richiedono quindi ancora la CLI, eseguita da un checkout o da un job di CI:

```bash
rebase db push
```

- **RLS sulle junction table** per le relazioni molti-a-molti.
- **Qualsiasi modifica che non sia puramente additiva** — una colonna rinominata, un tipo ristretto, un campo rimosso.

Per un Fly Postgres privato, apri un tunnel con `fly proxy 5432 -a <your-db-app>` e fai puntare `DATABASE_URL` a `localhost:5432`. L'immagine runtime viene fornita senza la CLI, quindi questo comando non viene mai eseguito all'interno della macchina e nemmeno un `release_command` può richiamarlo. Per migrazioni con controllo di versione, esegui il commit dei file di migrazione con `rebase db generate` ed esegui invece `rebase db migrate` come passaggio di rilascio.

## Archiviazione file

Il filesystem di una macchina Fly non sopravvive a un deploy, quindi lo storage locale dei file comporterebbe una perdita invisibile di dati e il runtime lo rifiuta in produzione. Collega un bucket compatibile con S3 — Tigris è quello fornito da Fly — con `STORAGE_TYPE=s3`. Vedi [Storage](/docs/backend/storage).

## Prossimi passi

- [Deployment](/docs/getting-started/deployment) — la checklist di produzione e le regole per il primo admin comuni a ogni piattaforma.
- [Configurazione](/docs/getting-started/configuration) — tutte le variabili d'ambiente lette dal runtime.
