---
title: Self-Hosting
sidebar_label: Self-Hosting
description: Esegui Rebase ovunque con l'immagine di runtime ufficiale e il bundle del tuo progetto — Docker Compose, Fly, Railway o un VPS classico.
---

## Overview

Fare il self-hosting di Rebase significa eseguire due cose: un database Postgres e l'immagine ufficiale `rebasepro/server` con il bundle del tuo progetto montato al suo interno.

Non c'è **nessuna immagine dell'applicazione da compilare**. Il tuo progetto viaggia come un bundle, il runtime è pubblicato e l'aggiornamento di Rebase consiste nel cambiare un tag piuttosto che ricompilare. Consulta [Runtime e bundle](/docs/architecture/runtime-and-bundles/) per capire perché è suddiviso in questo modo.

## Docker Compose

```bash
rebase build                     # produces ./dist-bundle
docker compose up -d db          # start Postgres
rebase db push                   # create the collection tables, once
docker compose up                # start the runtime
```

Un `docker-compose.yml` minimo:

```yaml
services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: rebase
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rebase -d rebase"]
      interval: 5s
      retries: 12

  api:
    image: rebasepro/server:latest
    depends_on:
      db: { condition: service_healthy }
    environment:
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      # Writable: the container installs the bundle's declared dependencies into
      # it on first start. See "Dependencies" below for the read-only variant.
      - ./dist-bundle:/bundle
    ports:
      - "8080:8080"

volumes:
  db-data:
```

## Dipendenze

`rebase build` scrive un `package.json` accanto al tuo bundle elencando le dipendenze dichiarate dal tuo progetto. Il container le installa al primo avvio, motivo per cui il punto di montaggio sopra è in scrittura.

Per montarlo invece in sola lettura — un'operazione consigliata, poiché un hook compromesso non potrà così riscrivere il codice eseguito al riavvio successivo — installale prima:

```bash
npm install --omit=dev --prefix dist-bundle
```

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

Per un deployment reale, è preferibile includere entrambi direttamente in un'immagine (baking), il che fissa anche con precisione ciò che viene eseguito:

```dockerfile
FROM rebasepro/server:0.11.0
COPY dist-bundle /bundle
```

## Creazione dello schema

Il runtime crea le proprie tabelle di **auth** all'avvio. Le **tabelle di collection sono un passaggio separato e intenzionale**, e l'immagine di runtime non lo esegue — il riavvio di un container non deve poter modificare uno schema come effetto collaterale di un deploy.

```bash
rebase db push
```

Esegui il comando da un checkout o da un job di CI, puntandolo al database di deployment. Esegue prima una prova (dry-run) delle modifiche, rifiuta quelle distruttive senza conferma esplicita e può effettuare un backup prima dell'applicazione.

`REBASE_MIGRATE_ON_BOOT` accetta `ensure` (il valore predefinito — solo tabelle auth) e `none`.

## Altre piattaforme

Il runtime è un normale container in ascolto su `$PORT`, quindi qualsiasi sistema in grado di eseguire container funzionerà. Due cose da configurare correttamente ovunque:

1. Il bundle deve essere presente in `/bundle` (o dove punta `REBASE_BUNDLE`), con le sue dipendenze installate al suo fianco — vedi [Dipendenze](#dipendenze).
2. Imposta `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. In produzione, il runtime rifiuta di avviarsi senza di essi anziché fare supposizioni.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.11.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Usa la forma con immagine derivata descritta sopra, in modo che il bundle venga distribuito insieme all'app, quindi esegui `fly deploy`.

### Railway / Render

Punta il servizio all'immagine derivata, imposta le variabili d'ambiente e imposta il percorso di health check su `/livez`.

### Un VPS classico

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

Eseguilo sotto systemd, con righe `Environment=` per le variabili menzionate sopra.

## Health check

| Percorso | Utilizzo |
| --- | --- |
| `/livez` | Liveness. Risponde a "questo processo è attivo?" senza toccare il database. |
| `/health` | Readiness. Effettua un ciclo di andata e ritorno (round-trip) verso il database e riporta la latenza. |

Punta i probe di liveness su `/livez`. Un probe di liveness su `/health` riavvierebbe un processo perfettamente sano durante un breve inceppamento del database, che è l'opposto del suo scopo.

## Metriche

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Espone le metriche Prometheus su `/metrics`: conteggi delle richieste e istogrammi di latenza suddivisi per superficie API (data, auth, storage, funzioni) e collection, oltre agli indicatori (gauge) del processo. Senza un token l'endpoint è leggibile da chiunque possa raggiungere la porta, quindi impostane uno a meno che non si trovi su una rete privata.

## Aggiornamento

```yaml
image: rebasepro/server:0.12.0
```

Riavvia. Il tuo bundle rimane invariato. All'interno della stessa major version del contratto di runtime, un bundle validato continuerà a funzionare — consulta [Compatibilità](/docs/architecture/runtime-and-bundles/#compatibility).
