---
sourceHash: 9d048d537401732a
title: rebase cloud
sidebar_label: rebase cloud
description: I gruppi di comandi per Rebase Cloud nella CLI — autenticazione, collegamento del progetto, deploy, notifiche, configurazione, organizzazioni, database, risorse, calcolo, storage, cluster, fatturazione e utilizzo.
---

Tutto ciò che riguarda Rebase Cloud, attualmente in versione beta privata. Consulta la
[guida a Rebase Cloud](/docs/deployment/cloud/) per scoprire di cosa si tratta e cosa non è
incluso nella beta.

Ogni gruppo risponde a `--help`, e `--help` non esegue mai il comando. La maggior parte dei comandi
agisce sul progetto collegato in `.rebase/cloud.json`; `--project <id>` opera su
un progetto senza collegarlo.

Tre opzioni si applicano ovunque: `--json` per un output leggibile da macchina (anche l'opzione
predefinita quando viene usato in pipe, ad eccezione di `deploy`, o con `REBASE_JSON=1`), `--url <origin>` per indirizzarsi a un
control plane specifico (o `REBASE_CLOUD_URL`), e `--project, -p <id>`.

## Autenticazione

```bash
rebase cloud login      # sign in through the browser: a link and a code, approved in the console
rebase cloud login --no-browser   # print the link instead of opening it, e.g. over SSH
rebase cloud login --email me@example.com   # with your password instead
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud access-token   # the bearer the CLI would send now, refreshed first; for scripts and the MCP server
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` accetta `deploy`, `logs`, `env`, `database` e `backups` su un singolo progetto
(`--project`, o quello collegato), e `billing`, `audit` e
`notifications` su una singola organizzazione: `--org`, altrimenti l'organizzazione del progetto,
altrimenti quella selezionata. Un token può contenere solo capability a livello di organizzazione.
`logs` copre anche `usage`. L'ambito di azione di ciascuna di esse è descritto in
[CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents). Quando il control
plane contrassegna una risposta a un token come deprecata (un token precedente all'introduzione di `billing`
che legge la fatturazione), la CLI stampa l'avviso una sola volta su stderr, mai nel
valore `--json`.

Senza flag, `login` effettua l'accesso tramite il browser. Stampa un codice breve e
un link alla console, apre il browser e attende che tu approvi l'accesso
lì. Se hai già effettuato l'accesso alla console, o accedi con
qualsiasi metodo disponibile (password, Google, GitHub, LinkedIn). Verifica che il
browser mostri lo stesso codice prima di approvarlo. Il link scade dopo dieci
minuti e funziona una sola volta. Senza un terminale, o con `--json`, il link e il codice
vengono inviati a stderr e `login` continua ad attendere, consentendo a un agente di passarti il link. Un
accesso rifiutato termina con `access_denied`, uno scaduto con `expired_token`.

Con `--email`, `login` chiede se utilizzare la password o un codice inviato via email
dal control plane. Con l'autenticazione a due fattori attiva, richiede quindi il codice
dell'app di autenticazione (o un codice di recupero); tramite browser, approva da una
sessione della console che l'ha utilizzata. Senza un terminale nessuno dei due codici può essere digitato: imposta
`REBASE_TOKEN` su un token di accesso creato nella console in Settings → Access
tokens. Consulta [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Collegamento del progetto

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

### Connettere un'istanza self-hosted a Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

Il [connettore Rebase](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
può quindi raggiungerla insieme ai tuoi progetti Cloud. `connect` stampa
`REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE`; impostali sul
server e riavvialo. Nella cartella del progetto propone di scriverli in
`.env`. Rieseguire il comando è sicuro. `--name` assegna un nome all'istanza, `--org` seleziona
l'organizzazione, `--no-wait` termina senza attendere. Riservato a proprietari e amministratori.

## Progetti

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects list --all-orgs   # every organization you belong to
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

`claim` stampa il link di riscatto del progetto sottoposto a provisioning da `init --claim` in questa
directory e il tempo rimanente prima che venga eliminato se non riscattato (`Unclaimed: deleted
in 41h`). `--open` lo apre anche nel browser. Il link è conservato solo sulla
macchina che ha eseguito `init --claim`, in `~/.rebase/credentials.json`; il control
plane ne memorizza un hash e non può stamparlo di nuovo. Prima di rispondere, `claim`
chiede al control plane se il token stesso del progetto è ancora valido. Il riscatto
revoca tale token, quindi una volta che qualcuno ha riscattato il progetto, `claim` rifiuta
l'operazione con `already_claimed` invece di stampare un link non più valido. Rifiuta inoltre una volta terminata la
finestra temporale (`claim_expired`) e in una directory priva di link di riscatto
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` mostrano lo stesso
link finché il progetto non viene riscattato.

## Deploy e monitoraggio

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
rebase cloud metrics                     # live CPU / memory / disk, realtime per instance
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` senza il nome di un'app distribuisce il backend. Il deploy di un bundle
backend carica anche il codice sorgente del progetto — ciò che è tracciato da git, mai un `.env` — in modo che un
aggiornamento della piattaforma possa ricompilarlo; `--no-source` salta questo passaggio per una volta, mentre `cloud settings set
--platform-rebuilds off` lo disattiva ed elimina la copia archiviata. `--allow-downgrade` distribuisce una release precedente.

Un `deploy` seguito termina con un riepilogo: ogni app distribuita con il rispettivo URL, l'ID
del deployment, il tempo impiegato e se la nuova versione risponde a quell'indirizzo.
Attende fino a `--live-timeout` secondi (predefinito 60; `0` salta il controllo) che l'endpoint `/health`
del backend e l'indirizzo di ciascuna app statica rispondano. Un deploy non riuscito
termina con una sola riga che indica l'app e il motivo, uscendo con codice diverso da zero. Il riepilogo
viene stampato anche se usato in pipe; `--json` (o `REBASE_JSON=1`) stampa invece un singolo oggetto,
con `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

Prima dell'upload, `deploy` analizza il codice JavaScript di ogni app statica distribuita:
i file `.js`/`.mjs`/`.cjs` nel relativo `output` e i blocchi `<script>` inline nel
suo HTML. Un errore di sintassi interrompe il deploy con `file:line:column` (codice
`syntax_error` in `--json`), e `--no-verify` salta la verifica. Un deploy riuscito
si conclude indicando la modalità di ripristino, `rebase cloud rollback`. Un'app statica distribuita
singolarmente non può ancora essere ripristinata; consulta
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` distribuisce la build all'indirizzo `https://<project>--<name>.rebase.website` e
non tocca la produzione. Una preview del backend esegue una propria istanza di backend, su un
database vuoto dedicato, con le relative app statiche integrate. Un'app statica non può ancora
essere visualizzata in anteprima da sola su Rebase Cloud: `rebase cloud deploy <app> --preview`
viene rifiutato con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Una preview
del backend viene fatturata come un'unità applicativa aggiuntiva di dimensioni predefinite per tutta la sua durata, e
il deploy indica il costo mensile stimato dal preventivo fornito dal control plane
(`cost` sotto `--json`; solo la regola e questo link qualora il control plane non possa
calcolarne il prezzo); `rebase cloud previews delete <name>` la arresta. `rebase cloud previews`
mostra una preview messa in pausa dalla piattaforma (il database ha superato il limite previsto per la preview) come
`paused`, specificando il motivo (`statusMessage` sotto `--json`). Una nuova richiesta di indirizzo di preview
può essere rifiutata con `preview_cert_budget` se il budget settimanale di certificati di preview della
piattaforma è esaurito; il messaggio indicherà fino a quando.
Consulta [Anteprima di una modifica](/docs/deployment/cloud/#preview-a-change).

### Log

`rebase cloud logs` stampa l'ultimo log di build e `-f` segue in tempo reale una build
ancora in corso. `--runtime` legge invece ciò che l'app stampa, da ogni pod
sottostante, con ogni riga associata al relativo pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` accetta una durata (`30s`, `5m`, `1h`) o un orario RFC3339.
- `--tail <n>` indica il numero di righe per pod da cui partire (il control plane impone un limite massimo di 2000).
- `--grep` mantiene le righe contenenti il testo indicato, senza distinzione tra maiuscole e minuscole; usa `/re/flags` per una
  regex.
- `--level error|warn|info|debug` mantiene le righe con tale livello di gravità o superiore. Legge
  la proprietà strutturata `severity` registrata da un backend Rebase, la parola indicante il livello all'inizio di una
  riga di testo, oppure un formato di errore come `TypeError:`. Le righe che non ne contengono alcuno vengono omesse.

L'opzione follow esegue il polling ogni due secondi e stampa ciascuna riga una volta sola. Notifica i pod
che si avviano, si arrestano o si riavviano. Quando un container si riavvia, stampa anche le ultime
righe dell'istanza terminata, dove solitamente risiede la causa. Rimane in attesa quando nessun
pod è in esecuzione e, in caso di caduta della connessione, riprova con backoff e
riprende dal punto in cui si era interrotto. Con `--json`, il follow stampa un oggetto JSON per
riga (NDJSON): `{"type":"line","ts","pod","text"}` per ogni riga di log e
`{"type":"event","event":…}` per il resto.

`--preview <name>` legge i log di una preview anziché della produzione. Usa il nome
della preview o l'ID del deployment stampato dal deploy di preview. Usato da solo, `--preview`
legge l'unica preview del progetto. Una preview statica dispone di un log di build ma non di
un log di runtime, poiché non esegue alcun server.

## Configurazione

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
```

`app-key` elenca la
chiave generata da `rebase cloud init --claim` sull'app e scritta in `.env` come
`REBASE_API_TOKEN`, mostrandone il prefisso e mai il valore. Il riscatto del progetto
trasferisce tale chiave, che cessa di avere una scadenza. `app-key rotate` ne genera una nuova e
revoca istantaneamente tutte le chiavi agente precedenti. Scrive la nuova chiave in un file `.env`
che contiene già `REBASE_API_TOKEN`, escludendola dall'output `--json`. In
qualsiasi altra directory stampa la chiave una sola volta. Le chiavi create nel pannello di amministrazione dell'app
non vengono toccate. Viene eseguito con il tuo login: nessuna capability del token può concederlo.

`service-key`
stampa la generazione del `REBASE_SERVICE_KEY` del progetto, la data dell'ultima rotazione
e se l'app si sta ancora riavviando con la versione più recente. Non stampa
mai la chiave: per farlo si usa `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
genera una nuova chiave e riavvia l'app su di essa. La vecchia chiave rimane valida fino al completamento
del riavvio, e non oltre. Il comando viene rifiutato mentre è in corso un
deploy e viene eseguito con il tuo login. Anche il riscatto di un progetto ruota la relativa service key.

Una preview del backend parte dalle variabili di produzione, incluse le chiavi live.
`env set KEY=VALUE --preview` assegna alle preview un valore dedicato, `env unset KEY
--preview` esclude la variabile dalle preview, `env reset KEY --preview` ripristina
il valore di produzione ed `env list --preview` mostra le differenze.
La produzione non viene mai modificata da nessuno di questi comandi.

`env set KEY --stdin` legge il valore dallo standard input invece che dalla
riga di comando, dove `ps` e la cronologia della shell lo renderebbero visibile:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

L'eventuale carattere di nuova riga finale viene rimosso. Lo strumento `rebase_cloud_env_set` del server MCP imposta
i valori in questo modo.

## Organizzazioni

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` crea un invito e ne stampa il link: monouso,
valido per 7 giorni, accettabile solo da un account che ha verificato tale indirizzo email.
Nessuno entra a far parte dell'organizzazione finché non accetta, compresi gli utenti già registrati su Rebase.
L'output (e `emailDelivery` in `--json`) indica se è stato inviato via email; in caso
contrario, un avviso suggerisce di inviare il link manualmente. `--role` può essere `admin` o
`member` (predefinito). Nessuno può essere invitato come `owner`: invitalo come admin e
un owner potrà promuoverlo con `members role <email> owner` una volta completata l'adesione.
`invites resend` genera un nuovo link e disattiva quello precedente.
L'invito e il comando `invites` richiedono una sessione `rebase cloud login`; l'uso di `REBASE_TOKEN` viene
rifiutato. L'invito, l'elenco, il reinvio e la revoca richiedono il ruolo
owner o admin; in caso contrario, ai membri viene segnalata l'assenza di permessi.
`members remove` richiede conferma prima di procedere (`--yes` la ignora); la rimozione o il declassamento di un owner
richiede il ruolo di owner e l'ultimo owner rimasto non può essere rimosso. `--org <id>` consente di selezionare un'organizzazione
diversa da quella attiva.

`activity` è l'audit log dell'organizzazione selezionata, ordinato dal più recente: chi
ha eseguito un deploy, un rollback, impostato, eliminato o visualizzato una variabile d'ambiente (per
nome, mai per valore), modificato un dominio, creato, ripristinato o scaricato un
backup, modificato le risorse di calcolo di un progetto, arrestato o eliminato un progetto, modificato il
ruolo di un membro, oppure creato o revocato un token di accesso. `--action` accetta un'area
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o un'azione completa
come `env.set`. Una pagina contiene fino a 100 voci (`--limit`, predefinito 50);
l'output stampa il cursore `--before` per la pagina successiva. Con `--json` restituisce un singolo valore,
`{ org, events, nextCursor }`. Richiede il ruolo di owner o admin dell'organizzazione.
Un token può leggerlo solo con la capability `audit` sull'organizzazione
(`rebase cloud tokens create --can audit`). La pagina **Activity** della console
mostra lo stesso log.

## Database

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` apre una porta locale che *è* il database gestito (nessun endpoint
pubblico) fino a Ctrl-C; `--reveal` include la password. Riservato a owner o admin.

## Guest

Ogni `signInAnonymously()` in un test, bot o visita abbandonata lascia una riga
tra gli utenti del progetto. Questi comandi contano tali righe e le rimuovono, in modo
da non doverle passare in rassegna una per una.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` accetta un'anzianità con relativa unità di misura: `45m`, `12h`, `30d` o `2w`. Senza `--yes` si limita
a contare e non elimina nulla. Elabora progetti di qualsiasi dimensione suddividendo il carico in piccoli
batch.

Possono essere eliminati solo i guest. Un guest è una riga con `is_anonymous` impostato, nessuna password e nessuna
identità collegata; l'app applica questa regola nell'istruzione che cancella la
riga, impedendo al comando di toccare un account reale, perfino uno registratosi un istante
dopo essere stato elencato. `delete` rifiuta un account con `NOT_ANONYMOUS`.

**Last seen** (ultimo accesso) indica il momento in cui la sessione del guest è stata emessa o rinnovata per l'ultima volta, oppure
la data di creazione del guest se non gli è rimasto alcun refresh token. Un guest che continua a tornare
non viene considerato obsoleto, a prescindere da quando è stato creato. Insieme a un guest eliminato vengono rimossi
anche i relativi refresh token e qualsiasi altra riga di autenticazione associata.

Le righe nelle tue tabelle seguono la propria foreign key:

| La colonna | Cosa succede alla riga |
|---|---|
| Collegamento opzionale (`ON DELETE SET NULL`, impostazione predefinita) | Mantenuta, con il collegamento svuotato |
| Collegamento obbligatorio (`ON DELETE RESTRICT`, impostazione predefinita) | Mantenuta, e il guest insieme ad essa: il guest viene segnalato come ignorato, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Eliminata insieme al guest |
| Nessuna foreign key (un campo `userSelect`, un semplice id) | Mantenuta, contenente un ID non più esistente |

Verifica quali dei tuoi collegamenti sono configurati a cascata prima di passare `--yes`: l'operazione non può essere annullata.

Il comando legge `REBASE_SERVICE_KEY` esattamente come fa `env reveal`, quindi richiede il ruolo di
owner o admin (o un token con la capability `env` appartenente a uno di essi). La
chiave rimane in memoria e viene inviata esclusivamente all'indirizzo del progetto. Un progetto su un
runtime obsoleto riceverà un avviso che richiede l'aggiornamento a una versione più recente.

## Risorse

Cosa riserva la piattaforma per il progetto, a fronte di quanto dichiarato nel codice.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un deploy non rimuove mai un database sottoposto a provisioning quando la sua dichiarazione viene rimossa: equivarrebbe
a cancellare dati tramite un push. La piattaforma lo mantiene, lo associa e continua a fatturarlo finché qualcuno
non ne esegue il prune specificandone il nome.

## Compute

Le risorse riservate dal progetto e i relativi costi.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accetta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
`--scale-to-zero` è deprecato: ogni backend esegue almeno un'istanza, quindi
`true` viene rifiutato e `false` viene ignorato con un avviso. Non sono previsti piani
a scaglioni: ogni risorsa ha un prezzo specifico. Consulta
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
accetta un elenco separato da virgole tra `deploy.failed` (predefinito),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` e `preview.paused`. `--format slack` invia
solo `{ "text" }` invece del JSON dell'evento, che include a sua volta una proprietà `text`. L'URL
è un argomento posizionale poiché `--url` identifica il control plane. `add` stampa
il segreto di firma una sola volta; `--json` restituisce `{ projectId, webhook, secret }`.
`test <id>` termina con codice 1 e codice di errore `delivery_failed` quando il destinatario non ha accettato
l'evento di test. La visualizzazione dell'elenco è aperta a qualsiasi membro dell'organizzazione; `add`, `test`
e `remove` richiedono il ruolo di owner o admin. Un token può gestirli con la
capability `notifications` sull'organizzazione, nel rispetto delle medesime regole di ruolo. Consulta
[Notifiche Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` assegna al cluster
proprietario del cliente un registro di immagini dedicato, utilizzato esclusivamente per quel cluster. In
sua assenza, tale cluster utilizza il registro condiviso della piattaforma e ogni deploy verso di esso
lo segnala nei propri log. Con un registro configurato, le build inviano tramite push a tale repository con un token per
quell'account, i pod eseguono il pull esclusivamente con quella chiave e un rollback accetta le
immagini del progetto presenti lì. Le immagini
create in precedenza dal progetto nel repository condiviso rimangono disponibili per il pull e restano
destinazioni valide per il rollback. I tre valori vanno specificati insieme; `--clear` li rimuove. La chiave
viene protetta (sealed) al momento della scrittura e non viene mai riletta. Come il resto di `clusters`,
richiede il ruolo di platform-admin. L'operatore crea il repository ed entrambi
gli account tramite Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` e `billing upcoming` leggono gli stessi dati Stripe mostrati nella
pagina Billing della console e sono accessibili solo a owner e admin dell'organizzazione.
Un token può accedervi, così come al resto di `billing`, con la
capability `billing` sull'organizzazione; un token creato prima dell'introduzione di tale capability continua
a funzionare per una release, con un avviso su ciascuna risposta. Gli importi in `--json` sono espressi nell'unità minima della valuta (centesimi), esattamente come
inviati da Stripe. Le fatture in bozza non vengono elencate; l'anteprima viene calcolata da
Stripe e le voci a consumo continuano ad accumularsi fino alla chiusura del periodo.

`usage` legge i consumi del progetto collegato (o specificato con `--project`) in un mese
solare, in formato UTC: richieste rispetto alla soglia inclusa, errori 5xx, l'eccedenza
maturata finora in euro e, per il mese in corso, la proiezione a questo
ritmo (una stima). L'eccedenza corrisponde al calcolo effettuato dal report di consumo, lo
stesso che comunica a Stripe cosa fatturare e che verrà addebitato nella fattura del mese successivo.
`usage org` elenca ogni progetto dell'organizzazione selezionata con `rebase cloud
use`, unitamente al totale. Qualsiasi membro dell'organizzazione può leggerlo. Un token può leggerlo
con la capability `logs` sul progetto; `usage org` elenca i progetti sui quali il
token dispone di tale permesso.
`--month` accetta un mese passato. La risposta include un array `caveats`, ciascuno con un `code`: `storage_not_measured`
(l'object storage indica 0), `multi_pod_undercount` (le richieste gestite mentre sono in esecuzione due o
più pod dell'app non vengono conteggiate), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
progetto riscattato da un agente conteggia solo i giorni successivi al riscatto) e
`autoscale_not_charged` (i pod sono stati eseguiti oltre la soglia di `--replicas` e questa piattaforma non
li addebita ancora). La risposta per un progetto con scalabilità automatica include anche `autoscale`:
`extraPodSeconds` al di sopra della soglia base, `amountEur` alle tariffe previste e `charged`.
