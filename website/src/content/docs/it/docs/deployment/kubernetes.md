---
sourceHash: 51abd249a5639803
title: Kubernetes
sidebar_label: Kubernetes
description: Distribuisci Rebase su un cluster Kubernetes con il chart Helm ufficiale — un Deployment o più d'uno, un Job di migrazione che gestisce lo schema e app statiche sullo stesso host.
---

## Panoramica

Il chart ufficiale è l'equivalente Kubernetes della configurazione di self-hosting
con Docker Compose. Stessa idea, stessa immagine, stesso bundle: **il runtime è
l'immagine, il tuo progetto è il bundle e l'aggiornamento di Rebase è un semplice
cambio di tag.**

Viene pubblicato come artefatto OCI insieme all'immagine di runtime, ed entrambi
condividono la stessa versione — il chart che distribuisce il runtime `0.17.3`
*è* il chart `0.17.3`, quindi c'è un solo numero da monitorare. Senza `--version`
si ottiene la versione più recente; fissala per un deployment reale, esattamente
come faresti per `image.tag`:

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

Il chart viene fornito con l'auto-registrazione disabilitata, quindi una release
deve indicare l'account con cui l'operatore effettua l'accesso — altrimenti si
avvia con una tabella utenti vuota e nessun modo per generare il primo chiamante
autenticato. `config.adminPassword` deve contenere almeno 12 caratteri e
`config.adminEmail` richiede un punto nel dominio: la route di login analizza
il body con `z.string().email()`, quindi `admin@localhost` è un account con cui
nessuno potrebbe accedere e il runtime rifiuta di farne il seeding. Entrambi
sono rifiuti in fase di rendering piuttosto che sorprese a runtime — vedi
[cosa il chart rifiuta di renderizzare](#cosa-il-chart-rifiuta-di-renderizzare).
Accedi e cambia la password; questi valori finiscono in un Secret.

In alternativa, gestiscili out-of-band puntando `existingSecret` a un Secret
contenente `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` insieme a
`DATABASE_URL` e al resto.

Il chart distribuisce **solo il runtime**. Non distribuisce Postgres — usa
CloudNativePG, un database gestito o il tuo StatefulSet dedicato, e punta
`config.databaseUrl` verso di esso. Un chart che gestisse anche il tuo database
dovrebbe farsi carico dei tuoi backup e del failover, una responsabilità ben più
grande del semplice "eseguire l'applicazione".

> **Maturità.** In CI vengono verificate due cose distinte, mentre una terza no.
> Il chart viene sottoposto a lint e renderizzato con Helm v4.2.4 — per ogni
> topologia documentata in questa pagina, compreso il comando di installazione
> sopra riportato, e per ogni caso di rifiuto elencato di seguito. L'immagine di
> runtime distribuita dal chart viene compilata e avviata a fronte di un Postgres
> reale, per entrambe le modalità con cui può arrivare un bundle. Ciò che **non è
> mai stato eseguito è il chart su un cluster reale**: nulla ha ancora schedulato
> questi manifest, quindi i probe, l'ordinamento del Job di migrazione pre-install
> e l'ingress sono corretti come YAML ma non comprovati come deployment effettivo.
> Consideralo un punto di partenza ben collaudato piuttosto che un'opzione
> predefinita testata sul campo in produzione, e consulta
> [Self-Hosting](/docs/deployment/self-hosting) per il percorso che lo è.

Per lavorare invece da un checkout locale — un chart modificato o un'installazione
air-gapped — `helm install rebase ./infra/charts/rebase` accetta gli stessi valori.

## Inserire il proprio progetto nel pod

| `bundle.mode` | Come | Quando |
|---|---|---|
| `image` (predefinito) | Fai il build `FROM rebasepro/server` con `COPY dist-bundle /bundle`, quindi imposta `image.repository` | Quasi sempre. Un unico artefatto, immutabile, nessuna dipendenza a runtime dalla disponibilità continua di un URL |
| `url` | Immagine standard; il runtime scarica un tarball a ogni avvio del pod | Un piano di controllo (control plane) che rilascia i bundle out-of-band |

## Un processo, o più d'uno

L'impostazione predefinita è un singolo Deployment che gestisce tutto — la stessa
struttura eseguita dal file Compose. La separazione richiede solo un valore:

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

Questo crea un tier `api`, un tier `functions` e un `worker`, tutti a partire
dalla stessa immagine e dallo stesso bundle. Consulta [Processi separati](/docs/deployment/split-processes)
per comprendere il ruolo di ciascuno e i motivi per cui separarli.

Ciò che il chart aggiunge rispetto a una configurazione manuale è che **deriva le
impostazioni la cui modalità di fallimento è silenziosa**, basandosi sui valori
già forniti:

- `REBASE_ROLE` per unità — `all` su api quando non è presente alcuna unità functions, così che continui a servire le tue funzioni
- `REBASE_MIGRATE_ON_BOOT=none` ovunque, poiché il Job di migrazione è responsabile dello schema
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` su api non appena esiste un worker
- `TRUSTED_PROXY_HOPS` sull'unità functions
- `REBASE_RATE_LIMIT_STORE=sql` non appena un secondo processo serve traffico HTTP

Un `REBASE_ROLE` errato non serve traffico HTTP anche se `/health` risponde comunque,
quindi il readiness check passa ma ogni richiesta restituisce 404. L'omissione di
`REBASE_MIGRATE_ON_BOOT` causa un crash loop la cui motivazione rimane nascosta in
un log che nessuno sta guardando. Il chart li imposta tutti, e `config.env` non può
sovrascriverli.

### Separare cron dall'esecuzione dei job

Due worker con responsabilità opposte — nessun nuovo ruolo e nessun codice:

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## Il pannello di amministrazione e qualsiasi altro frontend

Un'app statica è la stessa immagine di runtime che avvia un bundle `kind: static`.
Questo percorso esegue un corto circuito prima che il runtime legga `DATABASE_URL`
o `JWT_SECRET`, quindi questi pod non contengono **alcun secret**.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

L'ingress instrada `/admin` verso di essa e `/` verso l'API, sullo **stesso host**.
È una scelta intenzionale: avere la stessa origine significa che l'autenticazione
tramite cookie e il CORS rimangono invariati, e la suddivisione resta una decisione
di topologia interna anziché una modifica alla superficie pubblica del prodotto.
Il prezzo da pagare è che gli asset devono essere *compilati* per quel percorso
specifico, cosa che il runtime verifica all'avvio.

La distribuzione dell'admin si riduce quindi all'aggiornamento del tag dell'immagine
su un unico Deployment. Il backend non si riavvia.

## Schema

`migrationJob.enabled` (impostazione predefinita) esegue un Job `pre-install,pre-upgrade`
che effettua il provisioning ed esce, e ogni pod si avvia con `REBASE_MIGRATE_ON_BOOT=none`.
Nulla nel percorso di gestione delle richieste gestisce lo schema delle tabelle,
rappresentando la soluzione più pulita per garantire che "esattamente un processo
effettui il provisioning dello schema" — smettendo di essere una regola che qualcuno
deve ricordarsi di seguire. I pod mantengono comunque aggiornate le tabelle interne
del framework (autenticazione, chiavi API, job, cron) all'avvio; `provision: false`
disattiva anche questo, non renderizza alcun Job e delega la gestione dello schema
a un'[esecuzione di provisioning](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database)
gestita secondo il tuo processo di change management.

`mode: ensure` crea ciò che manca, in modo additivo, ed è l'unica modalità accettata
dall'immagine di runtime. `push` viene rifiutata all'avvio: l'applicazione delle
modifiche allo schema delle tabelle è distruttiva, mentre `rebase db push` eseguito
da un checkout locale o da CI simula la modifica (dry-run), rifiuta quelle distruttive
senza conferma e può eseguire preventivamente un backup — tutte operazioni impossibili
per un pod avviato in modo non presidiato.

## Cosa il chart rifiuta di renderizzare

Ognuna di queste è una configurazione che non genera errori a runtime — il
deployment si avvia e qualcosa smette silenziosamente di funzionare come previsto.
`helm install` fallisce invece preventivamente, indicando il valore da modificare:

- più di un processo HTTP con `sharedState.rateLimitStore=memory`
- `functions.enabled` o `worker.enabled` quando `split=false`
- due app statiche che reclamano lo stesso percorso, o una che ne reclama uno sotto `/api`
- `bundle.mode=image` quando `image.repository` è ancora l'immagine di runtime standard
- `ingress.enabled` senza host, o `bundle.mode=url` senza URL
- un valore non riconosciuto per `migrationJob.mode` o `sharedState.rateLimitStore`
- l'assenza di `config.adminEmail` con l'auto-registrazione disabilitata — una release
  a cui nessuno può accedere. Configura i due valori di admin, oppure imposta
  `config.allowSelfRegistration=true` tenendo conto che la prima persona che accederà
  al modulo di registrazione ne diventerà l'amministratore
- un valore di `config.adminPassword` inferiore a 12 caratteri, o un `config.adminEmail`
  il cui dominio non contiene alcun punto. All'avvio, il runtime rifiuta di effettuare
  il seed di entrambi, determinando la stessa release inaccessibile

## Cosa il chart non può fare per te

**Broadcast e presenza Realtime tra le repliche.** Il channel bus predefinito
del runtime è in memoria, quindi con più repliche dell'API un subscriber su un
pod non riceverà un broadcast pubblicato su un altro pod. La correzione risiede
nella configurazione del tuo progetto, non nel chart:

```ts
realtime: { bus: { type: "postgres" } }
```

Imposta `sharedState.channelBusConfigured: true` per confermare di averlo fatto —
il chart lo utilizza esclusivamente per decidere se mostrare un avviso. Le normali
sottoscrizioni alle tabelle non sono impattate; queste viaggiano tramite il CDC
di Postgres.

Tutto il resto di ciò che un processo mantiene isolato per sé — file locali,
upload riprendibili, la cache di trasformazione delle immagini, la vista Logs di
Studio — è elencato con la relativa impostazione di condivisione in
[Esecuzione di più istanze](/docs/deployment/multiple-instances/).
