---
sourceHash: d4f01e8b2b1972c4
title: rebase cloud
sidebar_label: rebase cloud
description: I gruppi di comandi per Rebase Cloud nella CLI — autenticazione, collegamento del progetto, deploy, notifiche, configurazione, organizzazioni, database, risorse, calcolo, storage, cluster, fatturazione e utilizzo.
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
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` accetta `deploy`, `logs`, `env`, `database` e `backups` su un progetto
(`--project`, oppure quello collegato), e `billing`, `audit` e
`notifications` su un'organizzazione: `--org`, altrimenti l'organizzazione del progetto,
altrimenti quella selezionata. Un token può possedere solo capacità a livello di organizzazione.
`logs` copre anche `usage`. Ciò che ciascuna raggiunge è descritto in
[CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents). Quando il control
plane contrassegna come deprecata una risposta a un token (un token precedente a `billing`
che legge la fatturazione), la CLI stampa l'avviso una sola volta su stderr, mai nel
valore di `--json`.

In un terminale, senza password indicata, `login` chiede se usare la password
o un codice che il control plane ti invia via email. Con l'autenticazione a due fattori attiva,
chiede poi il codice della tua app di autenticazione (o un codice di recupero). Senza un terminale
nessuno dei due può essere digitato: imposta `REBASE_TOKEN` con un token di accesso creato nella console
in Settings → Access tokens. Vedi [Rebase Cloud](/docs/deployment/cloud#link-a-project).

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
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

`claim` stampa il link di rivendicazione del progetto di cui `init --claim` ha effettuato il provisioning in questa
directory, e il tempo rimasto prima che venga eliminato se non rivendicato (`Unclaimed: deleted
in 41h`). `--open` lo apre anche in un browser. Il link è conservato solo sulla
macchina che ha eseguito `init --claim`, in `~/.rebase/credentials.json`; il control
plane ne memorizza un hash e non può stamparlo di nuovo. Prima di rispondere, `claim`
chiede al control plane se il token del progetto funziona ancora. Una rivendicazione
revoca quel token, quindi una volta che qualcuno ha rivendicato il progetto, `claim` rifiuta
con `already_claimed` invece di stampare un link ormai inutile. Rifiuta anche quando la
finestra è terminata (`claim_expired`), e in una directory senza link di rivendicazione
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` mostrano lo stesso
link finché il progetto non è rivendicato.

## Deploy e osservabilità

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud deploy [app] --preview [--preview-name <name>]  # its own address; production untouched
rebase cloud previews [list|delete <name>]
rebase cloud logs [--runtime] [-f] [--preview [name]]  # build log, or what the app prints
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

Un `deploy` seguito termina con un riepilogo: ogni app distribuita con il suo URL, l'id del deployment, quanto è durato e se la nuova versione risponde. Attende fino a `--live-timeout` secondi (60 di default; `0` salta il controllo) che rispondano `/health` del backend e l'indirizzo di ogni app statica. Un deploy fallito termina con una riga che indica l'app e il motivo, ed esce con un codice diverso da zero. Il riepilogo viene stampato anche in pipe; `--json` (o `REBASE_JSON=1`) stampa invece un oggetto con `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

Prima dell'upload, `deploy` analizza il JavaScript di ogni app statica che distribuisce: i file `.js`/`.mjs`/`.cjs` nel suo `output` e i blocchi `<script>` inline del suo HTML. Un errore di sintassi interrompe il deploy con `file:line:column` (codice `syntax_error` con `--json`), e `--no-verify` salta il controllo. Un deploy riuscito si conclude con la via del ritorno, `rebase cloud rollback`. Un'app statica distribuita da sola non supporta ancora il rollback; vedi [Rollback](/docs/deployment/cloud#roll-back).

`--preview` serve la build su `https://<project>--<name>.rebase.website` e lascia intatta la produzione. Una preview del backend esegue un proprio backend, su un database vuoto tutto suo, con le sue app statiche incorporate. Un'app statica non può ancora avere una preview da sola su Rebase Cloud: `rebase cloud deploy <app> --preview` viene rifiutato con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Una preview del backend è fatturata come una unità app in più alla dimensione predefinita finché esiste, e il deploy indica a quanto ammonta al mese, in base al preventivo del control plane (`cost` con `--json`; solo la regola e questo link quando il control plane non è in grado di quotarla); `rebase cloud previews delete <name>` la ferma. `rebase cloud previews` mostra come `paused`, con il motivo (`statusMessage` con `--json`), una preview messa in pausa dalla piattaforma (il suo database ha superato il limite delle preview). Un nuovo indirizzo di preview può essere rifiutato con `preview_cert_budget` quando il budget settimanale di certificati per le preview della piattaforma è esaurito; il messaggio indica fino a quando. Vedi [Anteprima di una modifica](/docs/deployment/cloud/#preview-a-change).

### Log

`rebase cloud logs` stampa l'ultimo log di build, e `-f` segue una build ancora in
corso. `--runtime` legge invece ciò che l'app stampa, da ogni pod che la serve, con ogni riga
contrassegnata dal suo pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` accetta una durata (`30s`, `5m`, `1h`) o un orario RFC3339.
- `--tail <n>` è il numero di righe per pod da cui partire (il control plane lo limita a 2000).
- `--grep` mantiene le righe che contengono il testo, senza distinguere maiuscole e minuscole; scrivi `/re/flags` per un'espressione
  regolare.
- `--level error|warn|info|debug` mantiene le righe a quel livello di gravità o superiore. Legge
  il `severity` strutturato che registra un backend Rebase, una parola di livello all'inizio di una
  riga semplice, o una forma di errore come `TypeError:`. Le righe che non ne hanno nessuna vengono escluse.

Un follow esegue il polling ogni due secondi e stampa ogni riga una sola volta. Segnala i pod
che si avviano, si fermano o si riavviano. Quando un container si riavvia stampa anche le ultime
righe dell'istanza che è morta, dove di solito si trova il motivo. Attende finché nessun
pod è in esecuzione, e dopo una connessione interrotta riprova con backoff e
riprende da dove era rimasto. Con `--json`, un follow stampa un oggetto JSON per
riga (NDJSON): `{"type":"line","ts","pod","text"}` per ogni riga di log, e
`{"type":"event","event":…}` per il resto.

`--preview <name>` legge una preview invece della produzione. Usa il nome
della preview, o l'id del deployment stampato da un deploy di preview. Da solo, `--preview`
legge l'unica preview del progetto. Una preview statica ha un log di build ma nessun
log di runtime, perché non esegue alcun server.

## Configurazione (Config)

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
```

`app-key` elenca la
chiave che `rebase cloud init --claim` ha creato sull'app e scritto in `.env` come
`REBASE_API_TOKEN`, mostrandone il prefisso e mai il valore. La rivendicazione del progetto
consegna quella chiave e smette di scadere. `app-key rotate` ne crea una nuova e
revoca in un colpo solo ogni precedente chiave dell'agente. Scrive la nuova chiave in un `.env`
che imposta già `REBASE_API_TOKEN`, e la tiene fuori da `--json` in quel caso. In
qualsiasi altra directory stampa la chiave una sola volta. Le chiavi create nel pannello di amministrazione
dell'app non vengono toccate. Viene eseguito con il tuo login: nessuna capacità di token lo concede.

`service-key`
stampa la generazione di `REBASE_SERVICE_KEY` del progetto, quando è stata ruotata l'ultima
volta, e se l'app si sta ancora riavviando sulla più recente. Non stampa mai
la chiave: per quello c'è `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emette una nuova chiave e riavvia l'app su di essa. La vecchia chiave funziona fino al
termine del riavvio, e non dopo. Viene rifiutato mentre un deploy è
in corso, e viene eseguito con il tuo login. Anche la rivendicazione di un progetto ruota la sua service
key.

La preview di un backend parte dalle variabili della produzione, chiavi live comprese. `env set KEY=VALUE --preview` dà alle preview un valore proprio, `env unset KEY
--preview` esclude la variabile da esse, `env reset KEY --preview` restituisce il valore della produzione e `env list --preview` mostra le differenze. Nessuno di questi comandi modifica la produzione.

`env set KEY --stdin` legge il valore dallo standard input invece che dalla
riga di comando, dove `ps` e la cronologia della shell lo mostrerebbero:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Viene eliminato un solo newline finale. `rebase_cloud_env_set` del server MCP imposta
i valori in questo modo.

## Organizzazioni

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` apre un invito e ne stampa il link: monouso,
valido 7 giorni, accettabile solo da un account che ha verificato quell'indirizzo.
Nessuno entra finché non accetta, nemmeno chi ha già un account Rebase.
L'output (e `emailDelivery` in `--json`) indica se è stato inviato via email; quando
non lo è stato, un avviso dice di inviare tu stesso il link. `--role` è `admin` o
`member` (predefinito). Nessuno viene invitato come `owner`: invitalo come admin, e
un owner lo promuove con `members role <email> owner` dopo che è entrato.
`invites resend` dà un nuovo link e il vecchio smette di funzionare.
L'invito e `invites` richiedono una sessione di `rebase cloud login`; `REBASE_TOKEN` viene
rifiutato. Invitare, elencare, rinviare e revocare richiedono il ruolo di owner o admin;
a un membro viene detto che non basta.
`members remove` chiede prima conferma (`--yes` la salta); rimuovere o retrocedere un owner
richiede un owner, e l'ultimo owner resta. `--org <id>` sceglie un'organizzazione
diversa da quella selezionata.

`activity` è il registro di audit dell'organizzazione selezionata, dal più recente: chi ha
distribuito, eseguito un rollback, impostato, eliminato o rivelato una variabile d'ambiente (per
nome, mai per valore), modificato un dominio, creato, ripristinato o scaricato un
backup, modificato le risorse di calcolo di un progetto, fermato o eliminato un progetto, cambiato il ruolo di un
membro, o creato o revocato un token di accesso. `--action` accetta un'area
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o un'azione completa
come `env.set`. Una pagina contiene fino a 100 voci (`--limit`, predefinito 50); l'output
stampa il cursore `--before` per la successiva. `--json` è un unico valore,
`{ org, events, nextCursor }`. Richiede il ruolo di owner o admin dell'organizzazione.
Un token lo legge solo con la capacità `audit` sull'organizzazione
(`rebase cloud tokens create --can audit`). La pagina **Activity** della console
mostra lo stesso registro.

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

## Storage, notifiche, cluster, fatturazione e utilizzo

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
rebase cloud webhooks            # retired: exits 1 (`command_retired`) and names `notifications`
rebase cloud clusters list | add | verify | registry   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
rebase cloud billing invoices [--limit N]   # issued invoices, newest first, with Stripe's hosted page
rebase cloud billing upcoming    # a preview of each subscription's next invoice
rebase cloud usage [--month YYYY-MM]   # requests used this month against the allowance, and the overage so far
rebase cloud usage org           # every project of the selected organization, with the total
```

`notifications add <url>` invia gli eventi del progetto collegato a un URL. `--events`
accetta un elenco separato da virgole di `deploy.failed` (il predefinito),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` e `preview.paused`. `--format slack` invia
solo `{ "text" }` invece del JSON dell'evento, che contiene anch'esso un `text`. L'URL
è un argomento posizionale perché `--url` indica il control plane. `add` stampa
il secret di firma una sola volta; `--json` restituisce `{ projectId, webhook, secret }`.
`test <id>` termina con codice 1 e `delivery_failed` quando il destinatario non ha accettato
l'evento di test. L'elenco è aperto a qualsiasi membro dell'organizzazione; `add`, `test`
e `remove` richiedono il ruolo di owner o admin. Un token li gestisce con la capacità
`notifications` sull'organizzazione, con la stessa regola sui ruoli. Vedi
[Notifiche di Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` assegna al cluster di un cliente
un proprio registro di immagini, usato solo per quel cluster. Senza di esso,
un cluster simile usa il registro condiviso della piattaforma, e ogni deploy su di esso
lo segnala nel suo log. Con esso, le build fanno push su quel repository con un token per
quell'account, i pod fanno pull solo con quella chiave, e un rollback accetta le
immagini del progetto lì. Le immagini
che il progetto ha compilato in precedenza nel repository condiviso restano scaricabili e restano
target di rollback. I tre valori vanno insieme; `--clear` li dimentica. La chiave
viene sigillata quando è scritta e non viene mai riletta. Come il resto di `clusters`,
richiede il ruolo di platform-admin. L'operatore crea il repository e i due
account con Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` e `billing upcoming` leggono gli stessi dati Stripe della
pagina Billing della console, e sono aperti solo a owner e admin dell'organizzazione.
Un token le raggiunge, insieme al resto di `billing`, con la capacità `billing`
sull'organizzazione; un token creato prima di quella capacità continua a
funzionare per una release, con un avviso a ogni risposta. Gli importi in `--json` sono nell'unità minore della valuta (centesimi), esattamente come li
invia Stripe. Le fatture in bozza non sono elencate; l'anteprima è calcolata da
Stripe e le sue righe a consumo continuano a crescere fino alla chiusura del periodo.

`usage` legge ciò che il progetto collegato (o `--project`) ha usato in un mese
di calendario, in UTC: le richieste rispetto alla quota inclusa, gli errori 5xx, l'eccedenza
finora in euro e, per il mese in corso, dove sta andando a
questo ritmo (una stima). L'eccedenza è il calcolo del report di eccedenza stesso, quello
che dice a Stripe cosa fatturare, e confluisce nella fattura del mese successivo.
`usage org` elenca ogni progetto dell'organizzazione selezionata con `rebase cloud
use`, e il totale. Qualsiasi membro dell'organizzazione può leggerlo. Un token lo legge
con la capacità `logs` sul progetto; `usage org` elenca i progetti su cui il
token possiede quella capacità.
`--month` accetta un mese passato. La risposta contiene `caveats`, ciascuno con un `code`: `storage_not_measured`
(lo storage a oggetti risulta 0), `multi_pod_undercount` (le richieste servite mentre due o
più pod dell'app sono in esecuzione non vengono conteggiate), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
progetto rivendicato da un agente conta solo i giorni dalla rivendicazione in poi) e
`autoscale_not_charged` (i pod sono stati eseguiti oltre `--replicas` e questa piattaforma non
li addebita ancora). La risposta di un progetto con autoscaling contiene anche `autoscale`:
`extraPodSeconds` oltre il minimo, `amountEur` alle sue tariffe, e `charged`.
