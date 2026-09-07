---
sourceHash: b4130f0ffba10745
title: Distribuire Rebase su Fly.io
description: Scopri come distribuire Rebase globalmente o limitarlo ai data center europei usando Fly.io.
sidebar_label: Fly.io
---

Fly.io ti permette di ospitare container Docker vicino ai tuoi utenti tramite la sua rete anycast globale. Fly è altamente configurabile per quanto riguarda il routing dei dati, il che lo rende un'ottima scelta per la distribuzione di applicazioni Rebase con un rigoroso focus sui dati europei.

Fly.io dispone di data center ad **Amsterdam (ams)**, **Francoforte (fra)**, **Madrid (mad)** e **Parigi (cdg)**.

## 1. Inizializzare l'App Fly
Dal tuo repository Rebase locale, dopo esserti assicurato che la CLI di Fly (`flyctl`) sia installata, esegui:

```bash
fly launch
```

1.  **Nome App:** `my-rebase-app`
2.  **Organizzazione:** Personale o la tua Org aziendale.
3.  **Regione:** Quando ti viene richiesta una regione, scegli esplicitamente un data center europeo come **Francoforte (fra)** o **Parigi (cdg)**.
4.  **Database:** Quando ti viene richiesto di configurare un database Postgres, rispondi **Sì**. Fly creerà automaticamente un cluster Postgres nella *stessa regione* e inietterà in modo sicuro la `DATABASE_URL` nella tua app.
5.  **Redis:** Rispondi **No**.

*Non effettuare ancora il deploy quando richiesto.* Dobbiamo prima impostare una variabile d'ambiente critica.

## 2. Impostare il Segreto JWT
Prima che la tua applicazione entri in produzione, devi iniettare il Segreto JWT in modo che Rebase possa firmare in modo sicuro le operazioni dei token di autenticazione.

Esegui il seguente comando localmente:
```bash
fly secrets set JWT_SECRET=your_super_long_randomly_generated_secure_string -a my-rebase-app
```

## 3. Convalidare la Configurazione Interna
Fly avrà generato un file `fly.toml` nella root del tuo progetto. Verifica che la porta interna si allinei esplicitamente con la configurazione predefinita di Rebase (`3001`):

**Non c'è nessuna immagine applicativa da costruire dal tuo sorgente**. `rebase build` produce una directory `dist-bundle` con le tue collezioni, funzioni e cron compilati — e, se il progetto dichiara un'app statica, il frontend costruito. L'immagine di runtime pubblicata la esegue:

```bash
rebase build
```

Fly.io preleva da un registry, quindi incorpora il bundle in un'immagine derivata. Tre righe, e fissa esattamente ciò che gira:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Aggiornare Rebase in seguito è una modifica a quella riga `FROM`. Il tuo bundle resta intatto.

```toml
# fly.toml
app = "my-rebase-app"
primary_region = "fra"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3001 # Assicurati che questo corrisponda alla porta della tua app Hono
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1
```

## 4. Effettuare il Deploy

I tuoi dati sono localizzati, il tuo database è stato predisposto e i tuoi segreti sono stati iniettati. Avvia il deploy:

```bash
fly deploy
```

Una volta completati il parsing e l'upload, la tua applicazione sarà online automaticamente. Esegui `fly open` per visualizzare la tua app deployata nel browser!

## 5. Crea lo Schema del Database

All'avvio Rebase crea automaticamente **solo le tabelle di autenticazione**. Le tabelle per le tue collezioni **non** vengono create automaticamente: l'app si avvia comunque e il login funziona, quindi è facile non accorgersene, finché ogni collezione non restituisce un errore "missing table".

Esegui la sincronizzazione dello schema una volta contro il database di produzione:

```bash
pnpm run db:push
```

Eseguilo da un checkout del progetto o dalla CI con `DATABASE_URL` che punta alla produzione, **non** dall'interno del container: l'immagine di produzione non include la CLI. Il database Fly Postgres non è esposto pubblicamente: apri un tunnel locale con `fly proxy 5432 -a my-rebase-app-db` e imposta `DATABASE_URL` in modo che punti a `localhost:5432` mentre esegui il comando.

Se preferisci migrazioni versionate a una sincronizzazione diretta, usa invece `pnpm run db:generate` seguito da `pnpm run db:migrate`.

---
