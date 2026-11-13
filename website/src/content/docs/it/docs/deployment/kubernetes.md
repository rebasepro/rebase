---
sourceHash: 00bc3369d6f3db69
title: Kubernetes
sidebar_label: Kubernetes
description: Esegui il deployment di Rebase su un cluster Kubernetes con l'Helm chart ufficiale — un solo Deployment o più, un Job di migrazione che gestisce lo schema e app statiche sullo stesso host.
---

## Panoramica

Il chart ufficiale è la controparte Kubernetes della configurazione self-hosting
con Docker Compose. Stessa idea, stessa immagine, stesso bundle: **il runtime è
l'immagine, il tuo progetto è il bundle e l'aggiornamento di Rebase è un semplice
cambio di tag.**

È pubblicato come artefatto OCI accanto all'immagine di runtime, ed entrambi
condividono la stessa versione — il chart che distribuisce il runtime `0.17.3`
*è* il chart `0.17.3`, quindi c'è un solo numero da monitorare. Senza `--version`
si ottiene la versione più recente; fissala per un deployment effettivo, allo
stesso modo in cui fisseresti `image.tag`:

```bash
helm install rebase oci://registry-1.docker.io/rebasepro/rebase \
  --set config.databaseUrl='postgres://user:pass@host:5432/db' \
  --set config.jwtSecret="$(openssl rand -hex 32)" \
  --set config.serviceKey="$(openssl rand -hex 32)" \
  --set config.adminEmail=you@example.com \
  --set config.adminPassword="$(openssl rand -hex 16)" \
  --set ingress.host=api.example.com \
  --set image.repository=my-registry/my-app
```

Il chart viene fornito con l'auto-registrazione disattivata, quindi una release
deve specificare l'account con cui l'operatore effettuerà l'accesso — altrimenti
si avvia con una tabella utenti vuota e nessun modo per generare il primo
chiamante autenticato. `config.adminPassword` deve contenere almeno 12 caratteri
e `config.adminEmail` richiede un punto nel dominio: la route di login analizza
il payload con `z.string().email()`, quindi `admin@localhost` è un account a
cui nessuno potrebbe accedere e il runtime si rifiuta di inizializzarlo. Entrambi
sono rifiuti in fase di rendering piuttosto che sorprese a runtime — vedi
[cosa il chart si rifiuta di renderizzare](#cosa-il-chart-si-rifiuta-di-renderizzare).
Effettua l'accesso e modifica la password; questi valori vengono salvati in un
Secret.

Gestiscili invece out-of-band puntando `existingSecret` a un Secret che
contiene `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` insieme a `DATABASE_URL`
e al resto.

Il chart distribuisce **esclusivamente il runtime**. Non distribuisce Postgres —
usa CloudNativePG, un database gestito o un tuo StatefulSet, e punta
`config.databaseUrl` verso di esso. Un chart che gestisse anche il tuo database
dovrebbe gestire anche i backup e il failover, che è una promessa molto più
impegnativa rispetto a "eseguire l'applicazione".

> **Maturità.** In CI vengono verificate due cose distinte, mentre una terza no.
> Il chart viene sottoposto a linting e renderizzato con Helm v4.2.4 — per ogni
> topologia documentata in questa pagina, compreso il comando di installazione
> sopra, e per ogni caso limite che attiva i rifiuti elencati di seguito.
> L'immagine di runtime distribuita dal chart viene compilata e avviata su
> un'istanza reale di Postgres, in entrambi i modi in cui un bundle può arrivare.
> Ciò che **non è mai stato eseguito è il chart su un cluster reale**: nessun
> scheduler ha mai applicato questi manifest, quindi i probe, l'ordinamento del
> Job di migrazione pre-install e l'ingress sono corretti come YAML ma non
> verificati sul campo come deployment. Consideralo come un punto di partenza
> ben testato piuttosto che uno standard collaudato per la produzione, e consulta
> [Self-Hosting](/docs/deployment/self-hosting) per il percorso di riferimento.

Per lavorare invece da un repository clonato — un chart modificato o
un'installazione air-gapped — `helm install rebase ./infra/charts/rebase` accetta
gli stessi valori.

## Portare il tuo progetto nel pod

| `bundle.mode` | Come | Quando |
|---|---|---|
| `image` (predefinito) | Esegui il build `FROM rebasepro/server` con `COPY dist-bundle /bundle`, quindi imposta `image.repository` | Quasi sempre. Un unico artefatto, immutabile, nessuna dipendenza a runtime da un URL che deve rimanere attivo |
| `url` | Immagine standard; il runtime scarica un archivio tarball a ogni avvio del pod | Un piano di controllo (control plane) che distribuisce i bundle out-of-band |

## Un solo processo, o più processi

L'impostazione predefinita è un singolo Deployment che gestisce tutto — la
stessa architettura eseguita dal file Compose. Per separare i processi basta un
solo valore:

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

Questo ti fornisce un tier `api`, un tier `functions` e un `worker`, tutti a
partire dalla stessa immagine e dallo stesso bundle. Consulta [Processi separati](/docs/deployment/split-processes)
per comprendere il ruolo di ciascuno e i motivi per cui separarli.

Ciò che il chart aggiunge rispetto a una configurazione manuale è che **deduce
le impostazioni la cui modalità di fallimento è silenziosa**, a partire dai
valori già forniti:

- `REBASE_ROLE` per unità — `all` sull'api quando non è presente un'unità functions, in modo che continui a servire le tue funzioni
- `REBASE_MIGRATE_ON_BOOT=none` ovunque, poiché il Job di migrazione è responsabile dello schema
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` sull'api non appena esiste un worker
- `TRUSTED_PROXY_HOPS` sull'unità functions
- `REBASE_RATE_LIMIT_STORE=sql` non appena un secondo processo serve traffico HTTP

Un valore errato di `REBASE_ROLE` non gestisce richieste HTTP mentre `/health`
continua a rispondere, facendo sì che il readiness probe passi ma ogni richiesta
restituisca 404. Un `REBASE_MIGRATE_ON_BOOT` mancante causa un crash loop la cui
causa finisce in un log che nessuno controlla. Il chart scrive tutti questi
parametri e `config.env` non può sovrascriverli.

### Separare cron dall'esecuzione dei job

Due worker con responsabilità opposte — nessun nuovo ruolo e nessun codice:

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## Il pannello di amministrazione e qualsiasi altro front-end

Un'applicazione statica è la stessa immagine di runtime che avvia un bundle
`kind: static`. Questo percorso esegue un corto circuito prima che il runtime
legga `DATABASE_URL` o `JWT_SECRET`, quindi questi pod non contengono **alcun
secret**.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

L'ingress instrada `/admin` verso di essa e `/` verso l'API, sullo **stesso host**.
Questo è intenzionale: avere la stessa origine significa che l'autenticazione
tramite cookie e il CORS rimangono invariati, e la suddivisione resta una scelta
topologica interna anziché una modifica alla superficie pubblica del prodotto.
La contropartita è che gli asset devono essere *compilati* per quel percorso
specifico, cosa che il runtime verifica all'avvio.

Il deployment dell'admin si riduce quindi all'aggiornamento del tag dell'immagine
su un singolo Deployment. Il backend non si riavvia.

## Schema

`migrationJob.enabled` (impostazione predefinita) esegue un Job di tipo
`pre-install,pre-upgrade` che effettua il provisioning ed esce, e ogni pod si
avvia con `REBASE_MIGRATE_ON_BOOT=none`. Nessun elemento sul percorso delle
richieste gestisce lo schema delle tabelle, rappresentando la soluzione più
pulita per garantire che "esattamente un processo effettui il provisioning dello
schema" — smettendo di essere una regola da dover ricordare. I pod continuano
comunque a mantenere aggiornate all'avvio le tabelle del framework stesso
(autenticazione, chiavi API, job, cron); `provision: false` blocca anche questo,
non renderizza alcun Job e demanda la gestione dello schema a un'[esecuzione di
provisioning](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database)
gestita dal proprio processo di change management.

`mode: ensure` crea ciò che manca in modo additivo ed è l'unica modalità
accettata dall'immagine di runtime. `push` viene rifiutato all'avvio:
l'applicazione delle modifiche allo schema delle tabelle è distruttiva, mentre
`rebase db push` da un checkout locale o da CI esegue una simulazione (dry-run)
della modifica, rifiuta le azioni distruttive in assenza di conferma e può
eseguire preventivamente un backup — tutte operazioni che un pod avviato senza
presidio non può compiere.

## Cosa il chart si rifiuta di renderizzare

Ognuna di queste è una configurazione che non genera alcun errore a runtime — il
deployment viene avviato e qualcosa smette silenziosamente di funzionare.
`helm install` invece fallisce, indicando il valore da correggere:

- più di un processo HTTP con `sharedState.rateLimitStore=memory`
- `functions.enabled` o `worker.enabled` impostati con `split=false`
- due app statiche che richiedono lo stesso percorso, o una che richiede un percorso sotto `/api`
- `bundle.mode=image` mentre `image.repository` è ancora l'immagine di runtime predefinita
- `ingress.enabled` senza alcun host, o `bundle.mode=url` senza alcun URL
- un valore non riconosciuto per `migrationJob.mode` o `sharedState.rateLimitStore`
- nessun `config.adminEmail` specificato con auto-registrazione disattivata — una
  release a cui nessuno potrebbe accedere. Imposta i due valori di amministrazione
  oppure `config.allowSelfRegistration=true`, tenendo presente che la prima
  persona che accederà al modulo di registrazione diventerà l'amministratore
- un valore di `config.adminPassword` inferiore a 12 caratteri, o un
  `config.adminEmail` il cui dominio non contiene un punto. Il runtime rifiuta di
  inizializzare entrambi all'avvio, lasciando la release inaccessibile

## Cosa il chart non può fare al posto tuo

**Broadcast Realtime e presenza tra le repliche.** Il channel bus predefinito del
runtime risiede in memoria, quindi con più di una replica API un sottoscrittore su
un pod non riceverà i broadcast pubblicati su un altro. La soluzione va applicata
nella configurazione del tuo progetto, non nel chart:

```ts
realtime: { bus: { type: "postgres" } }
```

Imposta `sharedState.channelBusConfigured: true` per confermare di averlo
configurato — il chart usa questo parametro solo per stabilire se mostrare un
avviso. Le normali sottoscrizioni alle tabelle non ne risentono; quelle
transitano tramite Postgres CDC.

Tutto il resto di ciò che un processo mantiene isolato — file locali, upload
riprendibili, cache di trasformazione delle immagini, Logs Explorer — è elencato
con la relativa impostazione di condivisione in [Esecuzione di più istanze](/docs/deployment/multiple-instances/).
