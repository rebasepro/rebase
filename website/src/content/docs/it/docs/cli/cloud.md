---
sourceHash: 7af948cdf55f4822
title: rebase cloud
sidebar_label: rebase cloud
description: I gruppi di comandi di rebase cloud — autenticazione, collegamento del progetto, deploy, configurazione, organizzazioni, database, risorse, compute, storage, webhook, cluster e fatturazione.
---

Tutte le funzionalità correlate a Rebase Cloud, attualmente disponibile in beta privata. Per maggiori dettagli sulla piattaforma e sulle funzionalità escluse dalla beta, consulta la [guida a Rebase Cloud](/docs/deployment/cloud/).

Ogni gruppo accetta il flag `--help`, il quale si limita a descrivere la sintassi senza eseguire il comando. La maggior parte dei comandi agisce sul progetto collegato in `.rebase/cloud.json`; il flag `--project <id>` consente di operare su uno specifico progetto senza doverlo collegare.

Tre opzioni risultano applicabili a livello globale: `--json` per produrre output interpretabile da macchina (attivo di default in caso di pipe, tranne che per `deploy`, o definendo `REBASE_JSON=1`), `--url <origin>` per indirizzare un control plane specifico (in alternativa a `REBASE_CLOUD_URL`) e `--project, -p <id>`.

## Autenticazione (Auth)

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
```

## Collegamento del progetto (Project link)

```bash
rebase cloud link         # collega questa directory a un progetto cloud
rebase cloud link [url]   # o direttamente a un backend: esclude control plane e login, inibendo il resto del gruppo fino al successivo unlink
rebase cloud unlink       # rimuove il collegamento
rebase cloud use [org]    # seleziona l'organizzazione attiva
rebase cloud open         # apre la dashboard nel browser
```

## Progetti (Projects)

```bash
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

## Deploy e monitoraggio (Deploy and observe)

```bash
rebase cloud deploy [app] [--source .]   # esegue il deploy di un'app e trasmette i log di compilazione
rebase cloud logs [--runtime] [-f]       # log di compilazione o del processo in esecuzione
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # ripristina un deploy precedente andato a buon fine
rebase cloud cancel [-y]                 # annulla la compilazione in corso
rebase cloud start | stop | restart [-y] # stop e restart richiedono -y
rebase cloud status                      # stato sintetico del progetto
rebase cloud metrics                     # metriche in tempo reale di CPU / memoria / disco
rebase cloud debug [health|logs|…]       # diagnosi di un deployment, in sola lettura
```

Il comando `deploy` invocato senza specificare alcuna app distribuisce il backend. Il deploy del bundle di backend carica contestualmente anche il sorgente del progetto — quanto tracciato da git, escludendo rigorosamente il file `.env` — per consentire a un aggiornamento della piattaforma di ricompilarlo; `--no-source` evita tale operazione per la singola istanza, mentre `cloud settings set --platform-rebuilds off` la disattiva permanentemente eliminando la copia salvata. `--allow-downgrade` consente il deployment di una versione precedente.

Un `deploy` seguito termina con un riepilogo: ogni app distribuita con il suo URL, l'id del deployment, quanto è durato e se la nuova versione risponde. Attende fino a `--live-timeout` secondi (60 di default; `0` salta il controllo) che rispondano `/api/health` del backend e l'indirizzo di ogni app statica. Un deploy fallito termina con una riga che indica l'app e il motivo, ed esce con un codice diverso da zero. Il riepilogo viene stampato anche in pipe; `--json` (o `REBASE_JSON=1`) stampa invece un oggetto con `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

## Configurazione (Config)

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
```

## Organizzazioni (Organizations)

```bash
rebase cloud orgs list | create | members
```

## Database

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` apre una porta locale corrispondente al database gestito (privo di endpoint pubblico) mantenendola attiva fino all'interruzione con Ctrl-C; `--reveal` mostra anche la password. Riservato a ruoli owner o admin.

## Risorse (Resources)

Riepilogo delle risorse allocate dalla piattaforma per il progetto a fronte delle dichiarazioni contenute nel codice.

```bash
rebase cloud resources                       # ogni database e bucket: dichiarato? allocato?
rebase cloud resources prune database <key>  # rimuove una risorsa non più dichiarata nel codice
```

La procedura di deploy non elimina mai un database allocato a fronte della rimozione della sua dichiarazione — tale operazione comporterebbe la cancellazione di dati in seguito a un push. Il database viene conservato, associato e fatturato fino a esplicita rimozione nominativa tramite prune.

## Calcolo (Compute)

Risorse di calcolo allocate per il progetto e relativi costi associati.

```bash
rebase cloud compute            # allocazione corrente e costo mensile associato
rebase cloud compute set        # modifica l'allocazione
```

`compute set` supporta i flag `--cpu`, `--memory`, `--replicas`, `--spot`, `--scale-to-zero`, `--db-instances`, `--db-cpu`, `--db-memory`, `--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`. Non sono previsti piani tariffari a livelli: ciascun elemento viene fatturato in base alle singole risorse impiegate. Per maggiori dettagli consulta [Rebase Cloud](/docs/deployment/cloud/).

## Storage, webhook, cluster e fatturazione

```bash
rebase cloud storage             # elenca i bucket di archiviazione
rebase cloud storage create      # alloca storage gestito dalla piattaforma
rebase cloud storage attach      # collega un bucket compatibile S3 personalizzato
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # i cluster su cui vengono eseguiti i tenant; `add` ne registra uno da un kubeconfig
rebase cloud billing             # account di fatturazione e carta associata
rebase cloud billing setup       # procedura una tantum per associare una carta, apre il browser
rebase cloud billing checkout    # sessione Stripe per un singolo progetto
```
