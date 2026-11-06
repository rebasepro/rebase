---
sourceHash: 784025478be49fb3
title: rebase cloud
sidebar_label: rebase cloud
description: I gruppi di comandi per Rebase Cloud nella CLI — autenticazione, collegamento del progetto, deploy, notifiche, configurazione, organizzazioni, database, risorse, compute, storage, cluster, fatturazione e utilizzo.
---

Tutto ciò che riguarda Rebase Cloud, attualmente in beta privata. Consulta la
[guida a Rebase Cloud](/docs/deployment/cloud/) per scoprire di cosa si tratta e cosa non include
la beta.

Ogni gruppo risponde a `--help`, e `--help` non esegue mai il comando. La maggior parte dei comandi
agisce sul progetto collegato in `.rebase/cloud.json`; `--project <id>` opera su
uno specifico progetto senza collegarlo.

Tre opzioni si applicano ovunque: `--json` per un output leggibile da macchina (anche il
default quando usato in una pipe, tranne per `deploy`, o con `REBASE_JSON=1`), `--url <origin>` per indirizzarsi a
uno specifico control plane (o `REBASE_CLOUD_URL`), e `--project, -p <id>`.

## Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud access-token   # the bearer the CLI would send now, refreshed first; for scripts and the MCP server
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` accetta `deploy`, `logs`, `env`, `database` e `backups` su un progetto
(`--project`, o quello collegato), e `billing`, `audit` e
`notifications` su un'organizzazione: `--org`, altrimenti l'organizzazione del progetto,
altrimenti quella selezionata. Un token può contenere solo capability a livello di organizzazione.
`logs` copre anche `usage`. Ciò a cui ciascuna ha accesso è descritto in
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Quando il control
plane contrassegna una risposta a un token come deprecata (un token creato prima di `billing`
che legge la fatturazione), la CLI stampa l'avviso una sola volta su stderr, mai nel
valore `--json`.

In un terminale senza password fornita, `login` chiede se usare la password
o un codice inviato via email dal control plane. Con l'autenticazione a due fattori abilitata,
richiede poi il codice dell'autenticatore (o un codice di recupero). Senza un terminale
nessuno dei due può essere digitato: imposta `REBASE_TOKEN` su un token di accesso creato nella console
sotto Settings → Access tokens. Consulta [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Project link

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

Il [connector di Rebase](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
la raggiunge quindi insieme ai tuoi progetti Cloud. `connect` stampa
`REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE`; impostali sul
server e riavvialo. Nella cartella del progetto propone di scriverli in
`.env`. Eseguirlo nuovamente è sicuro. `--name` assegna un nome all'istanza, `--org` seleziona
l'organizzazione, `--no-wait` restituisce il controllo senza attendere. Solo owner e admin.

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
directory, e il tempo rimanente prima che venga eliminato se non riscattato (`Unclaimed: deleted
in 41h`). `--open` lo apre anche in un browser. Il link viene conservato solo sulla
macchina che ha eseguito `init --claim`, in `~/.rebase/credentials.json`; il control
plane ne memorizza un hash e non può stamparlo di nuovo. Prima di rispondere, `claim`
chiede al control plane se il token del progetto è ancora valido. Il riscatto
revoca tale token, quindi una volta che qualcuno ha riscattato il progetto, `claim` rifiuta l'operazione
con `already_claimed` invece di stampare un link non più valido. Rifiuta inoltre una volta scaduta
la finestra temporale (`claim_expired`), e in una directory priva di link di riscatto
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` mostrano lo stesso
link finché il progetto non è stato riscattato.

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
rebase cloud metrics                     # live CPU / memory / disk, realtime per instance
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` senza alcun nome di app esegue il deploy del backend. Il deploy del bundle
di un backend carica anche i sorgenti del progetto — ciò che git traccia, mai un `.env` — in modo
che un aggiornamento della piattaforma possa ricompilarlo; `--no-source` salta questa operazione una volta, e `cloud settings set
--platform-rebuilds off` la disattiva ed elimina la copia archiviata. `--allow-downgrade` esegue il deploy di una release precedente.

Un `deploy` seguito (followed) termina con un riepilogo: ciascuna app distribuita con il rispettivo URL,
l'ID di deployment, il tempo impiegato e se la nuova versione risponde a quell'indirizzo.
Attende fino a `--live-timeout` secondi (predefinito 60; `0` salta il controllo) che
l'endpoint `/health` del backend e l'indirizzo di ogni app statica rispondano. Un deploy fallito
termina con una sola riga che indica l'app e il motivo, uscendo con codice diverso da zero. Il riepilogo
viene stampato anche se reindirizzato in una pipe; `--json` (o `REBASE_JSON=1`) stampa invece un singolo oggetto,
con `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

Prima del caricamento, `deploy` analizza il JavaScript di ogni app statica distribuita:
i file `.js`/`.mjs`/`.cjs` nella cartella `output` e i blocchi `<script>` inline
nell'HTML. Un errore di sintassi interrompe il deploy con `file:line:column` (codice
`syntax_error` con `--json`), mentre `--no-verify` salta la verifica. Un deploy
riuscito si conclude indicando come ripristinare la versione precedente, `rebase cloud rollback`. Un'app statica distribuita
singolarmente non può ancora essere ripristinata; consulta
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` serve la build su `https://<project>--<name>.rebase.website` e
lascia intatta la produzione. Una preview del backend esegue un proprio backend, su un
database dedicato vuoto, integrando le sue app statiche. Un'app statica non può ancora essere
visualizzata in anteprima da sola su Rebase Cloud: `rebase cloud deploy <app> --preview`
viene rifiutato con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Una preview
del backend viene fatturata come un'ulteriore unità app con le dimensioni predefinite per tutta la sua durata, e
il deploy indica a quanto ammonta il costo mensile, in base alla stima del control plane stesso
(`cost` con `--json`; solo la regola e questo link qualora il control plane non possa
quantificarlo); `rebase cloud previews delete <name>` la arresta. `rebase cloud previews`
mostra una preview sospesa dalla piattaforma (il suo database ha superato il limite consentito per le preview) come
`paused`, indicandone il motivo (`statusMessage` con `--json`). Un nuovo indirizzo di preview
può essere rifiutato con `preview_cert_budget` quando il budget settimanale di certificati di preview
della piattaforma è esaurito; il messaggio indica fino a quando.
Consulta [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` stampa il log dell'ultima build, e `-f` segue in tempo reale (tail) una build che è
ancora in corso. `--runtime` legge invece ciò che l'app stampa, da ogni pod
sottostante, con ogni riga contrassegnata dal relativo pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` accetta una durata (`30s`, `5m`, `1h`) o un timestamp RFC3339.
- `--tail <n>` indica il numero di righe per pod da cui iniziare (il control plane le limita a un massimo di 2000).
- `--grep` mantiene le righe contenenti il testo, senza distinzione tra maiuscole e minuscole; usa `/re/flags` per
  un'espressione regolare.
- `--level error|warn|info|debug` mantiene le righe con tale gravità o superiore. Legge
  il campo strutturato `severity` registrato da un backend Rebase, la parola indicante il livello all'inizio di una
  riga di testo semplice, o una struttura di errore come `TypeError:`. Le righe che non contengono nessuno di questi elementi vengono escluse.

Il comando di follow esegue un polling ogni due secondi e stampa ogni riga una sola volta. Segnala i pod
che si avviano, si arrestano o si riavviano. Quando un container si riavvia, stampa anche le ultime
righe dell'istanza terminata, dove solitamente risiede il motivo dell'interruzione. Attende finché nessun
pod è in esecuzione e, in caso di connessione interrotta, ritenta con backoff
riprendendo dal punto in cui si era interrotto. Con `--json`, il follow stampa un oggetto JSON per
riga (NDJSON): `{"type":"line","ts","pod","text"}` per ogni riga di log, e
`{"type":"event","event":…}` per il resto.

`--preview <name>` legge una preview anziché la produzione. Usa il nome della
preview o l'ID di deployment stampato da un deploy di preview. Usato da solo, `--preview`
legge l'unica preview del progetto. Una preview statica ha un log di build ma nessun
log di runtime, poiché non esegue alcun server.

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
chiave creata da `rebase cloud init --claim` sull'app e scritta in `.env` come
`REBASE_API_TOKEN`, mostrandone il prefisso e mai il valore. Il riscatto del progetto
trasferisce tale chiave, che cessa di scadere. `app-key rotate` ne genera una nuova e
revoca contemporaneamente tutte le chiavi agent precedenti. Scrive la nuova chiave in un file `.env`
che imposta già `REBASE_API_TOKEN`, escludendola da `--json` in quel contesto. In
qualunque altra directory stampa la chiave una sola volta. Le chiavi create nel pannello di amministrazione
dell'app non vengono modificate. Viene eseguito con la tua sessione di login: nessuna capability del token può concederlo.

`service-key`
stampa la generazione della chiave `REBASE_SERVICE_KEY` del progetto, la data dell'ultima
rotazione e se l'app è ancora in fase di riavvio sulla chiave più recente. Non
stampa mai la chiave stessa: per quello si usa `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emette una nuova chiave e riavvia l'app utilizzandola. La vecchia chiave rimane valida finché il
riavvio non è completato, e non oltre. Il comando viene rifiutato mentre è in corso un deploy
ed è eseguito con la tua sessione di login. Anche il riscatto di un progetto ruota la relativa
service key.

Una preview del backend eredita le variabili della produzione, incluse le chiavi attive.
`env set KEY=VALUE --preview` assegna alle preview un valore dedicato, `env unset KEY
--preview` esclude la variabile dalle preview, `env reset KEY --preview` ripristina
il valore di produzione e `env list --preview` mostra le differenze.
Nessuna di queste operazioni modifica mai l'ambiente di produzione.

`env set KEY --stdin` legge il valore dallo standard input anziché dalla
riga di comando, dove `ps` e la cronologia della shell lo renderebbero visibile:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Un singolo carattere di nuova riga finale viene rimosso. Il comando `rebase_cloud_env_set` del server
MCP imposta i valori in questo modo.

## Organizzazioni

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` crea un invito e ne stampa il link: monouso,
valido per 7 giorni, accettabile solo da un account che ha verificato tale indirizzo email.
Nessuno entra a far parte dell'organizzazione finché non accetta, nemmeno chi possiede già un account Rebase.
L'output (e `emailDelivery` in `--json`) indica se l'invito è stato inviato via email; in caso
contrario, un avviso suggerisce di inviare il link manualmente. `--role` può essere `admin` o
`member` (predefinito). Nessuno può essere invitato come `owner`: invitalo come admin, e
un owner potrà promuoverlo con `members role <email> owner` una volta completata l'iscrizione.
`invites resend` genera un nuovo link rendendo inattivo quello precedente.
Le operazioni di invito e i comandi `invites` richiedono una sessione `rebase cloud login`; `REBASE_TOKEN` viene
rifiutato. Invitare, elencare, reinviare e revocare richiedono il ruolo di owner o admin;
a un member viene segnalata l'assenza dei permessi necessari.
`members remove` richiede conferma (`--yes` la ignora); per rimuovere o retrocedere un owner
è necessario essere un owner, e l'ultimo owner non può essere rimosso. `--org <id>` seleziona un'organizzazione
diversa da quella attiva.

`activity` è l'audit log dell'organizzazione selezionata, ordinato dal più
recente: chi ha eseguito il deploy, il rollback, ha impostato, eliminato o mostrato una variabile d'ambiente (per
nome, mai per valore), modificato un dominio, creato, ripristinato o scaricato un
backup, modificato il compute di un progetto, arrestato o eliminato un progetto, cambiato il
ruolo di un membro, oppure creato o revocato un token di accesso. `--action` accetta un'area
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o un'azione completa
come `env.set`. Una pagina contiene fino a 100 voci (`--limit`, predefinito 50); l'output
stampa il cursore `--before` per la successiva. `--json` restituisce un singolo valore,
`{ org, events, nextCursor }`. Richiede il ruolo di owner o admin dell'organizzazione.
Un token può leggerlo solo disponendo della capability `audit` sull'organizzazione
(`rebase cloud tokens create --can audit`). La pagina **Activity** della console
mostra lo stesso registro.

## Database

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` apre una porta locale che *è* il database gestito (nessun endpoint
pubblico) fino alla pressione di Ctrl-C; `--reveal` aggiunge la password. Solo per owner o admin.

## Guest

Ogni chiamata a `signInAnonymously()` durante un test, da parte di un bot o di una visita abbandonata lascia una riga
tra gli utenti del progetto. Questi comandi contano tali righe e le rimuovono, evitando di
doverle scorrere una per una.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` accetta un intervallo temporale con un'unità di misura: `45m`, `12h`, `30d` o `2w`. Senza `--yes` si
limita a contare e non elimina nulla. Elabora progetti di qualsiasi dimensione suddividendo il lavoro
in piccoli batch.

Solo gli utenti guest possono essere rimossi. Un guest è una riga con `is_anonymous` impostato, nessuna password e nessuna
identità collegata; l'app applica questa regola nello statement che elimina la
riga, impedendo al comando di toccare un account reale, anche se registrato un istante
dopo essere stato elencato. `delete` rifiuta un account registrato restituendo `NOT_ANONYMOUS`.

**Last seen** corrisponde all'ultimo momento in cui la sessione del guest è stata emessa o aggiornata, oppure a quando
il guest è stato creato se non è rimasto alcun refresh token. Un guest che continua a
tornare non è considerato obsoleto, indipendentemente da quanto tempo fa sia stato creato. I refresh token di un guest eliminato
e qualsiasi altra riga di autenticazione collegata vengono rimossi insieme ad esso.

Le righe nelle tue tabelle seguono la rispettiva foreign key:

| Colonna | Cosa succede alla riga |
|---|---|
| Collegamento opzionale (`ON DELETE SET NULL`, predefinito) | Mantenuta, con il collegamento svuotato |
| Collegamento obbligatorio (`ON DELETE RESTRICT`, predefinito) | Mantenuta, e il guest insieme ad essa: il guest viene segnalato come ignorato, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Eliminata insieme al guest |
| Nessuna foreign key (un campo `userSelect`, un semplice ID) | Mantenuta, contenente un ID non più esistente |

Verifica quali dei tuoi collegamenti sono impostati su cascade prima di specificare `--yes`: l'operazione non può essere annullata.

Il comando legge `REBASE_SERVICE_KEY` esattamente come fa `env reveal`, quindi richiede un
owner o admin (o un token con la capability `env` appartenente a uno di essi). La
chiave rimane in memoria e viene inviata esclusivamente all'indirizzo del progetto stesso. A un progetto che esegue
un runtime precedente viene segnalata la necessità di aggiornarlo.

## Risorse

Ciò che la piattaforma gestisce per il progetto, a confronto con quanto dichiarato nel codice.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un deploy non rimuove mai un database sottoposto a provisioning quando viene eliminata la sua dichiarazione — ciò
comporterebbe la perdita di dati a seguito di un push. Lo mantiene attivo, associato e fatturato finché qualcuno
non ne esegue il prune indicandone il nome.

## Compute

Ciò che il progetto riserva e il relativo costo.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accetta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
`--scale-to-zero` è deprecato: ogni backend esegue almeno un'istanza, pertanto
`true` viene rifiutato e `false` viene ignorato con un avviso. Non ci sono livelli
di piano: tutto ha un prezzo per risorsa. Consulta
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
accetta un elenco separato da virgole contenente `deploy.failed` (predefinito),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` e `preview.paused`. `--format slack` invia
unicamente `{ "text" }` anziché il JSON dell'evento, che contiene anch'esso un campo `text`. L'URL
è un argomento posizionale poiché `--url` specifica il control plane. `add` stampa
il segreto di firma una sola volta; `--json` restituisce `{ projectId, webhook, secret }`.
`test <id>` esce con codice 1 ed errore `delivery_failed` qualora il destinatario non abbia accettato
l'evento di test. La visualizzazione dell'elenco è consentita a qualsiasi membro dell'organizzazione; `add`, `test`
e `remove` richiedono il ruolo di owner o admin. Un token può gestirli tramite la
capability `notifications` sull'organizzazione, nel rispetto delle medesime regole di ruolo. Consulta
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` assegna al cluster di un
cliente un proprio registro immagini dedicato, utilizzato esclusivamente per quel cluster. In assenza di
questo, tale cluster utilizza il registro condiviso della piattaforma, e ogni deploy lo
segnala nel proprio log. Configurandone uno, le build eseguono il push su tale repository con un token associato a
quell'account, i pod effettuano il pull esclusivamente con quella chiave e un eventuale rollback accetta le
immagini del progetto archiviate lì. Le immagini
create in precedenza dal progetto nel repository condiviso rimangono disponibili per il pull e utilizzabili come
target di rollback. I tre valori devono essere forniti insieme; `--clear` li rimuove. La chiave
viene cifrata al momento della scrittura e non viene mai letta nuovamente. Come il resto dei comandi in `clusters`,
richiede il ruolo di platform-admin. L'operatore crea il repository ed entrambi
gli account con Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` e `billing upcoming` leggono gli stessi dati Stripe mostrati nella
pagina Billing della console e sono accessibili unicamente agli owner e agli admin
dell'organizzazione. Un token vi può accedere, così come al resto di `billing`, con la capability
`billing` sull'organizzazione; un token creato prima dell'introduzione di tale capability continua a funzionare
per una release, mostrando un avviso a ogni risposta. Gli importi in `--json` sono espressi nell'unità minima della valuta (centesimi), esattamente come
inviati da Stripe. Le bozze di fattura non vengono elencate; la preview viene calcolata da
Stripe e le relative voci a consumo continuano ad aumentare fino alla chiusura del periodo.

`usage` rileva quanto utilizzato dal progetto collegato (o specificato con `--project`) in un mese
solare, in formato UTC: richieste rispetto alla soglia inclusa, errori 5xx, l'eccedenza
maturata finora in euro e, per il mese in corso, la proiezione a questo
ritmo (una stima). L'eccedenza corrisponde al calcolo effettivo del report sui consumi, quello
che indica a Stripe quanto fatturare, e viene addebitata sulla fattura del mese successivo.
`usage org` elenca ogni progetto dell'organizzazione selezionata con `rebase cloud
use`, insieme al totale complessivo. Qualsiasi membro dell'organizzazione può visualizzarlo. Un token lo legge
con la capability `logs` sul progetto; `usage org` elenca i progetti sui quali il
token dispone di tale permesso.
`--month` accetta un mese passato. La risposta contiene un campo `caveats`, ciascuno con un relativo `code`: `storage_not_measured`
(l'object storage indica 0), `multi_pod_undercount` (le richieste gestite mentre sono in esecuzione due o
più pod dell'app non vengono conteggiate), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
progetto riscattato da un agente conteggia solo i giorni successivi al riscatto) e
`autoscale_not_charged` (i pod sono stati eseguiti oltre la soglia di `--replicas` e la piattaforma non li
addebita ancora). La risposta di un progetto scalato automaticamente include anche la sezione `autoscale`:
`extraPodSeconds` al di sopra della base minima, `amountEur` in base alle relative tariffe e `charged`.
