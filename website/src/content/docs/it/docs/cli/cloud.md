---
sourceHash: 729b9c62d06bd093
title: rebase cloud
sidebar_label: rebase cloud
description: I gruppi di comandi per Rebase Cloud nella CLI — autenticazione, collegamento del progetto, deploy, configurazione, organizzazioni, database, risorse, calcolo, storage, webhook, cluster e fatturazione.
---

Tutto ciò che riguarda Rebase Cloud, attualmente in beta privata. Consulta la
[guida a Rebase Cloud](/docs/deployment/cloud/) per scoprire di cosa si tratta e cosa
non include la beta.

Ogni gruppo risponde a `--help`, e `--help` non esegue mai il comando. La maggior parte dei comandi
agisce sul progetto collegato in `.rebase/cloud.json`; `--project <id>` opera su
un progetto senza collegarlo.

Tre opzioni risultano applicabili a livello globale: `--json` per produrre output interpretabile da macchina (attivo di default in caso di pipe, tranne che per `deploy`, o definendo `REBASE_JSON=1`), `--url <origin>` per indirizzare un control plane specifico (in alternativa a `REBASE_CLOUD_URL`) e `--project, -p <id>`.

## Autenticazione

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
```

## Collegamento del progetto

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

## Progetti

```bash
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

## Deploy e osservabilità

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud logs [--runtime] [-f]       # build logs, or the running process's
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` senza il nome dell'app esegue il deploy del backend. Il deploy di un bundle
di backend carica anche il sorgente del progetto — ciò che git traccia, mai un `.env` — in modo
che un aggiornamento della piattaforma possa ricompilarlo; `--no-source` salta questo passaggio per una volta, mentre `cloud settings set
--platform-rebuilds off` lo disattiva ed elimina la copia archiviata. `--allow-downgrade` distribuisce una versione precedente.

Un `deploy` seguito termina con un riepilogo: ogni app distribuita con il suo URL, l'id del deployment, quanto è durato e se la nuova versione risponde. Attende fino a `--live-timeout` secondi (60 di default; `0` salta il controllo) che rispondano `/api/health` del backend e l'indirizzo di ogni app statica. Un deploy fallito termina con una riga che indica l'app e il motivo, ed esce con un codice diverso da zero. Il riepilogo viene stampato anche in pipe; `--json` (o `REBASE_JSON=1`) stampa invece un oggetto con `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

Prima dell'upload, `deploy` analizza il JavaScript di ogni app statica che distribuisce: i file `.js`/`.mjs`/`.cjs` nel suo `output` e i blocchi `<script>` inline del suo HTML. Un errore di sintassi interrompe il deploy con `file:line:column` (codice `syntax_error` con `--json`), e `--no-verify` salta il controllo. Un deploy riuscito si conclude con la via del ritorno, `rebase cloud rollback`. Un'app statica distribuita da sola non supporta ancora il rollback; vedi [Rollback](/docs/deployment/cloud#roll-back).

## Configurazione (Config)

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
```

## Organizzazioni

```bash
rebase cloud orgs list | create | members
```

## Database

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` apre una porta locale che *è* il database gestito (nessun endpoint
pubblico) fino a Ctrl-C; `--reveal` aggiunge la password. Riservato solo a owner o admin.

## Risorse

Ciò che la piattaforma gestisce per il progetto, a fronte di quanto dichiarato nel codice.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un deploy non rimuove mai un database sottoposto a provisioning quando la sua dichiarazione scompare — si
tratterebbe di dati eliminati da un push. La piattaforma lo conserva, lo associa e lo fattura finché qualcuno
non ne esegue il prune indicandone il nome.

## Risorse di calcolo

Ciò che il progetto riserva e i relativi costi.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accetta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
`--scale-to-zero` è deprecato: ogni backend esegue almeno un'istanza, per cui
`true` viene rifiutato e `false` viene ignorato con un avviso. Non ci sono scaglioni
di piano: ogni risorsa ha un prezzo specifico. Consulta
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, webhook, cluster e fatturazione

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
```
