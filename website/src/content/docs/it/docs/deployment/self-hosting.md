---
title: Self-Hosting
sidebar_label: Self-Hosting
description: Esegui Rebase ovunque con l'immagine di runtime ufficiale e il bundle del tuo progetto — Docker Compose, Fly, Railway o un VPS classico.
---

## Overview

Fare il self-hosting di Rebase significa eseguire due cose: un database Postgres e l'immagine ufficiale `rebasepro/server` con il bundle del tuo progetto montato al suo interno.

Non c'è **nessuna immagine dell'applicazione da compilare**. Il tuo progetto viaggia come un bundle, il runtime è pubblicato e l'aggiornamento di Rebase consiste nel cambiare un tag piuttosto che ricompilare. Consulta [Runtime e bundle](/docs/architecture/runtime-and-bundles/) per capire perché è suddiviso in questo modo.

## Docker Compose

Il file compose vive nel repository, in
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Usa quello invece di copiare uno snippet da questa pagina: è il file che
l'acceptance gate del progetto avvia a ogni push, quindi non può divergere da ciò
che funziona davvero.

```bash
rebase build                    # produce ./dist-bundle
./infra/docker/quickstart.sh    # scrive infra/docker/.env se manca, poi avvia
```

`quickstart.sh` è un solo comando che fa due cose ovvie e le stampa entrambe. La
forma lunga, se preferisci controllare ogni passaggio:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Non serve avviare il database separatamente: `api` attende il suo healthcheck.

### I quattro valori richiesti

`quickstart.sh` li genera per te. Per scrivere il `.env` a mano:

```bash
cat > infra/docker/.env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
REBASE_SERVICE_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://app.example.com
EOF
```

Tre segreti e un dato:

- **`POSTGRES_PASSWORD`** — la password del database. Cambiarla in seguito
  significa cambiarla anche nel volume: sceglila una volta sola.
- **`JWT_SECRET`** — firma ogni sessione. Ruotarlo disconnette tutti.
- **`REBASE_SERVICE_KEY`** — la credenziale che aggira la row-level security per
  le chiamate server-to-server. Trattala come una password di root: chi la
  possiede può leggere ogni riga.
- **`CORS_ORIGINS`** — le origini da cui viene servito il tuo frontend, separate
  da virgole. Non è un segreto, e non è nemmeno opzionale: in produzione il
  runtime si rifiuta di avviarsi invece di indovinare, perché un'API che indovina
  le proprie origini consentite prima o poi consente quella sbagliata.

Ognuno dei tre segreti deve essere lungo almeno 32 caratteri. Il file compose li
dichiara con `${VAR:?…}`, così un valore mancante ferma lo stack con un messaggio
che lo nomina, invece di avviare qualcosa configurato a metà.

## Dipendenze

`rebase build` **installa le dipendenze del progetto dentro il bundle** per
impostazione predefinita, quindi `dist-bundle` arriva già con un `node_modules` e
un `package-lock.json` accanto al suo `package.json`. Un bundle così si avvia in
circa cinque secondi.

Poiché ci sono già, puoi montare il bundle in sola lettura — cosa che conviene,
perché un hook compromesso non può allora riscrivere il codice che verrà eseguito
dopo il riavvio successivo:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` vi rinuncia e produce un bundle che installa le
dipendenze al primo avvio, con 40–60 secondi per avvio e la necessità di un mount
scrivibile.

Per un deployment reale conviene includere entrambi in un'immagine, il che fissa
anche esattamente ciò che viene eseguito:

```dockerfile
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

## Creazione dello schema

**Il runtime crea le tabelle mancanti all'avvio, comprese quelle delle tue
collection.** `REBASE_MIGRATE_ON_BOOT` vale `ensure` di default, che è additivo
su tutto lo schema: crea tabelle, colonne e tipi enum mancanti e applica la loro
row-level security. Un primo avvio su un database vuoto parte servendo le tue
collection, senza alcun passaggio separato.

Ciò che `ensure` non fa mai, deliberatamente, è modificare quanto già esiste. Non
altera il tipo di una colonna, non elimina tabelle o colonne e non modifica le
etichette di un enum esistente — perché il riavvio di un container non deve poter
rimodellare uno schema come effetto collaterale di un deploy.

Per questo `rebase db push` resta utile, per le due cose che l'avvio lascia
stare:

```bash
rebase db push
```

- **La RLS delle tabelle di join** per le relazioni molti-a-molti.
- **Qualsiasi modifica non puramente additiva**: una colonna rinominata, un tipo
  ristretto, un campo rimosso.

Eseguilo da un checkout o da un job di CI, puntato al database del deployment.
Prima simula la modifica, rifiuta quelle distruttive senza conferma esplicita e
può fare un backup prima di applicare. Nel file compose il database pubblica una
porta perché questo comando possa raggiungerlo dall'host; rimuovi quella mappatura
una volta sistemato lo schema, se il database non deve essere raggiungibile
dall'esterno.

`REBASE_MIGRATE_ON_BOOT` accetta `ensure` e `none`, e nient'altro: l'immagine **si
rifiuta di avviarsi** con `push`, per il motivo sopra.

## Archiviazione dei file

L'archiviazione è **disattivata** finché non è configurato un bucket, ed è
deliberato: l'alternativa predefinita sarebbe il filesystem del container, che
perde silenziosamente ogni file caricato al riavvio successivo. Gli upload sono
rifiutati con `501 STORAGE_NOT_CONFIGURED` finché non ne configuri uno.

Per un bucket, imposta `STORAGE_TYPE=s3` (o `gcs`) più bucket e credenziali: il
file compose elenca le variabili, commentate.

Per il disco locale, appropriato solo quando il percorso è un volume reale che
sopravvive al container:

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
    volumes:
      - uploads:/data/uploads
```

## Altre piattaforme

Il runtime è un normale container in ascolto su `$PORT`, quindi qualsiasi sistema in grado di eseguire container funzionerà. Due cose da configurare correttamente ovunque:

1. Il bundle deve essere presente in `/bundle` (o dove punta `REBASE_BUNDLE`), con le sue dipendenze installate al suo fianco — vedi [Dipendenze](#dipendenze).
2. Imposta `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. In produzione, il runtime rifiuta di avviarsi senza di essi anziché fare supposizioni.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.17.3"

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

## Eseguire le funzioni in un processo dedicato

Tutto quanto sopra è un solo container che serve l'intero progetto, la forma
giusta per quasi ogni deployment. Quando una funzione personalizzata deve
smettere di competere con l'API dei dati per l'event loop — o deve scalare,
riavviarsi e fallire per conto proprio — la stessa immagine e lo stesso bundle
possono essere avviati come più processi che cooperano. Vedi
[Processi separati](/docs/deployment/split-processes/).

## Aggiornamento

```yaml
image: rebasepro/server:0.17.3
```

Riavvia. Il tuo bundle rimane invariato. All'interno della stessa major version del contratto di runtime, un bundle validato continuerà a funzionare — consulta [Compatibilità](/docs/architecture/runtime-and-bundles/#compatibility).
