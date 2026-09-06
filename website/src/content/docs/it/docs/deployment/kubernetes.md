---
sourceHash: 1c7b378353d6058e
title: Kubernetes
sidebar_label: Kubernetes
description: Distribuisci Rebase su un cluster Kubernetes con il chart Helm ufficiale — un singolo Deployment o molteplici, un Job di migrazione che gestisce lo schema e app statiche sullo stesso host.
---

## Panoramica

Il chart ufficiale è l'equivalente per Kubernetes della configurazione di self-hosting con Docker Compose. Stessa idea, stessa immagine, stesso bundle: **il runtime è l'immagine, il tuo progetto è il bundle e l'aggiornamento di Rebase consiste nel cambiare un tag.**

Viene pubblicato come artefatto OCI insieme all'immagine di runtime, ed entrambi hanno la stessa versione: il chart che distribuisce il runtime `0.17.3` *è* il chart `0.17.3`, quindi c'è un solo numero da monitorare. Senza `--version` ottieni la versione più recente; fissala per una distribuzione reale, nello stesso modo in cui fisseresti `image.tag`:

```bash
helm install rebase oci://registry-1.docker.io/rebasepro/rebase \
  --set config.databaseUrl='postgres://user:pass@host:5432/db' \
  --set config.jwtSecret="$(openssl rand -hex 32)" \
  --set config.serviceKey="$(openssl rand -hex 32)" \
  --set ingress.host=api.example.com \
  --set image.repository=my-registry/my-app
```

Il chart distribuisce **solo il runtime**. Non distribuisce Postgres: usa CloudNativePG, un database gestito o il tuo StatefulSet e puntaci `config.databaseUrl`. Un chart che gestisse anche il database dovrebbe occuparsi dei backup e del failover, una responsabilità ben più grande del semplice "eseguire l'app".

> **Maturità.** Il chart viene sottoposto a linting e rendering in CI rispetto a Helm v4.2.4 — per ogni topologia documentata e per ogni caso di rifiuto elencato di seguito. **Non è ancora stato testato su un cluster reale in produzione**. Consideralo come un punto di partenza ben collaudato piuttosto che un'opzione predefinita comprovata per la produzione, e consulta [Self-Hosting](/docs/deployment/self-hosting) per la soluzione attualmente consigliata.

Per lavorare invece da un repository clonato — un chart modificato o un'installazione air-gapped — `helm install rebase ./charts/rebase` accetta gli stessi valori.

## Inserire il tuo progetto nel pod

| `bundle.mode` | Come | Quando |
|---|---|---|
| `image` (predefinito) | Esegui il build con `FROM rebasepro/server` e `COPY dist-bundle /bundle`, quindi imposta `image.repository` | Quasi sempre. Un unico artefatto, immutabile, nessuna dipendenza a runtime dalla disponibilità di un URL |
| `url` | Immagine standard; il runtime scarica un tarball a ogni avvio del pod | Un control plane che distribuisce i bundle out-of-band |

## Un processo o molteplici

L'impostazione predefinita prevede un singolo Deployment che serve tutto, la stessa struttura eseguita dal file Compose. La separazione richiede solo un valore:

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

Questo genera un tier `api`, un tier `functions` e un `worker`, tutti a partire dalla stessa immagine e dallo stesso bundle. Consulta [Processi separati](/docs/deployment/split-processes) per comprendere il ruolo di ciascuno e i motivi per cui separarli.

Ciò che il chart aggiunge rispetto a una configurazione manuale è che **deriva le impostazioni la cui modalità di errore è il fallimento silenzioso**, a partire dai valori già forniti:

- `REBASE_ROLE` per unità
- `REBASE_MIGRATE_ON_BOOT=none` ovunque, poiché il Job di migrazione gestisce lo schema
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` sull'api non appena esiste un worker
- `TRUSTED_PROXY_HOPS` sull'unità functions
- `REBASE_RATE_LIMIT_STORE=sql` non appena un secondo processo serve HTTP

Un `REBASE_ROLE` errato non serve traffico HTTP mentre `/health` risponde comunque, quindi il probe di readiness ha successo ma ogni richiesta restituisce 404. Un `REBASE_MIGRATE_ON_BOOT` mancante provoca un crash loop la cui causa finisce in un log che nessuno controlla. Il chart scrive tutte queste variabili e `config.env` non può sovrascriverle.

### Separare cron dall'esecuzione dei job

Due worker con responsabilità opposte — nessun nuovo ruolo e nessun codice:

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## Il pannello di amministrazione e qualsiasi altro frontend

Un'app statica utilizza la stessa immagine di runtime avviando un bundle `kind: static`. Questo percorso viene eseguito in corto circuito prima che il runtime legga `DATABASE_URL` o `JWT_SECRET`, quindi questi pod non contengono **alcun segreto**.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

L'ingress instrada `/admin` verso di esso e `/` verso l'API, sullo **stesso host**. Questo è intenzionale: la stessa origine implica che l'autenticazione tramite cookie e il CORS rimangono invariati, e la separazione rimane una decisione di topologia interna anziché una modifica alla superficie pubblica del prodotto. Il compromesso è che gli asset devono essere *compilati* per quel percorso, cosa che il runtime verifica all'avvio.

Il rilascio dell'admin diventa quindi un semplice aggiornamento del tag dell'immagine su un singolo Deployment. Il backend non si riavvia.

## Schema

`migrationJob.enabled` (predefinito) esegue un Job `pre-install,pre-upgrade` che effettua il provisioning ed esce, e ogni pod si avvia con `REBASE_MIGRATE_ON_BOOT=none`. Nessun elemento sul percorso delle richieste gestisce il DDL, rappresentando la soluzione più pulita possibile per il principio "un solo processo effettua il provisioning dello schema": non è più una regola che qualcuno deve ricordarsi di seguire.

`mode: ensure` crea ciò che manca. `mode: push` applica anche le modifiche allo schema delle collezioni ed **è distruttivo**; non è l'impostazione predefinita.

## Cosa il chart rifiuta di renderizzare

Ciascuna di queste è una configurazione che non genera errori a runtime: la distribuzione si avvia e qualcosa smette silenziosamente di funzionare come previsto. `helm install` fallisce invece preventivamente, indicando il valore da modificare:

- più di un processo HTTP con `sharedState.rateLimitStore=memory`
- `functions.enabled` o `worker.enabled` quando `split=false`
- due app statiche che richiedono lo stesso percorso, o una che richiede un percorso sotto `/api`
- `bundle.mode=image` quando `image.repository` è ancora l'immagine runtime predefinita
- `ingress.enabled` senza host, oppure `bundle.mode=url` senza URL
- un valore non riconosciuto per `migrationJob.mode` o `sharedState.rateLimitStore`

## Cosa il chart non può fare al posto tuo

**Broadcast realtime e presence tra repliche.** Il channel bus predefinito del runtime è in memoria, quindi con più di una replica API un sottoscrittore su un pod non vedrà un broadcast pubblicato su un altro. La soluzione risiede nella configurazione del tuo progetto, non nel chart:

```ts
realtime: { bus: { type: "postgres" } }
```

Imposta `sharedState.channelBusConfigured: true` per confermare di averlo fatto: il chart lo usa solo per decidere se mostrare un avviso. Le normali sottoscrizioni alle collezioni non sono interessate; queste passano attraverso il CDC di Postgres.
