---
sourceHash: 279e0eca02e1be02
title: rebase cloud
sidebar_label: rebase cloud
description: I gruppi di comandi per Rebase Cloud nella CLI — auth, collegamento al progetto, deploy, notifiche, configurazione, organizzazioni, database, risorse, compute, archiviazione, cluster, fatturazione e utilizzo.
---

Tutto ciò che riguarda Rebase Cloud, attualmente in beta privata. Consulta la
[guida a Rebase Cloud](/docs/deployment/cloud/) per scoprire di cosa si tratta e cosa non
è incluso nella beta.

Ogni gruppo risponde a `--help`, e `--help` non esegue mai il comando. La maggior parte dei comandi
agisce sul progetto collegato in `.rebase/cloud.json`; `--project <id>` opera su
uno specifico progetto senza collegarlo.

Tre opzioni sono valide ovunque: `--json` per l'output leggibile da macchina (anche il
valore predefinito se reindirizzato tramite pipe, tranne per `deploy`, o con `REBASE_JSON=1`), `--url <origin>` per indirizzare un
control plane specifico (oppure `REBASE_CLOUD_URL`), e `--project, -p <id>`.

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

`--can` accetta `deploy`, `logs`, `env`, `database` e `backups` su un singolo progetto
(`--project`, o quello collegato), e `billing`, `audit` e
`notifications` su un'organizzazione: `--org`, altrimenti l'organizzazione del progetto,
altrimenti quella selezionata. Un token può contenere solo funzionalità legate all'organizzazione.
`logs` copre anche `usage`. L'ambito di ciascuna funzionalità è descritto in
[CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents). Quando il control
plane contrassegna una risposta a un token come deprecata (un token creato prima dell'introduzione di `billing`
che legge i dati di fatturazione), la CLI stampa l'avviso una volta su stderr, mai nel
valore `--json`.

In un terminale senza password fornita, `login` chiede se usare la password
o un codice inviato via email dal control plane. Con l'autenticazione a due fattori attiva,
richiede successivamente il codice dell'autenticatore (o un codice di recupero). Senza un terminale
non è possibile digitare nessuno dei due: imposta `REBASE_TOKEN` con un token di accesso creato nella console
sotto Settings → Access tokens. Consulta [Rebase Cloud](/docs/deployment/cloud#link-a-project).

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
rebase cloud projects list --all-orgs   # every organization you belong to
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

`claim` stampa il link di riscatto (claim) del progetto effettuato con `init --claim` in questa
directory e il tempo rimanente prima che venga eliminato se non riscattato (`Unclaimed: deleted
in 41h`). `--open` lo apre anche in un browser. Il link viene conservato solo sulla
macchina che ha eseguito `init --claim`, in `~/.rebase/credentials.json`; il control
plane memorizza un hash del link e non può stamparlo di nuovo. Prima di rispondere, `claim`
chiede al control plane se il token del progetto è ancora valido. Un claim
revoca tale token, quindi una volta che qualcuno ha riscattato il progetto, `claim` rifiuta
la richiesta con `already_claimed` invece di stampare un link non più valido. Rifiuta inoltre una volta scaduta
la finestra temporale (`claim_expired`) e in una directory priva di link di claim
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` mostrano lo stesso
link finché il progetto non viene riscattato.

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

`deploy` senza alcun nome di app esegue il deploy del backend. Un deploy del bundle
di backend carica anche il codice sorgente del progetto — ciò che è tracciato da git, mai un `.env` — in modo che un
aggiornamento della piattaforma possa ricompilarlo; `--no-source` salta questo passaggio per una volta, e `cloud settings set
--platform-rebuilds off` lo disattiva ed elimina la copia archiviata. `--allow-downgrade` esegue il deploy di una versione precedente.

Un `deploy` seguito (followed) termina con un riepilogo: ciascuna app rilasciata con il relativo URL,
l'ID di deployment, il tempo impiegato e l'esito della risposta della nuova versione.
Attende fino a `--live-timeout` secondi (valore predefinito 60; `0` ignora il controllo) che l'endpoint
`/health` del backend e l'indirizzo di ciascuna app statica rispondano. Un deploy fallito
termina con una singola riga indicante l'app e il motivo, e termina con un codice di uscita diverso da zero. Il riepilogo
viene stampato anche se reindirizzato tramite pipe; `--json` (o `REBASE_JSON=1`) stampa invece un singolo oggetto,
contenente `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

Prima del caricamento, `deploy` esegue il parsing del codice JavaScript di ogni app statica rilasciata:
i file `.js`/`.mjs`/`.cjs` nella cartella `output` e i blocchi `<script>` inline
nel relativo HTML. Un errore di sintassi interrompe il deploy indicando `file:line:column` (codice
`syntax_error` con `--json`), mentre `--no-verify` ignora il controllo. Un deploy completato con
successo termina indicando la procedura di ripristino, `rebase cloud rollback`. Un'app statica distribuita
singolarmente non può ancora essere ripristinata; consulta
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` rende disponibile la build all'indirizzo `https://<project>--<name>.rebase.website` e
lascia invariato l'ambiente di produzione. Una preview del backend esegue un backend dedicato, su un
proprio database vuoto, integrando le relative app statiche. Un'app statica non può ancora essere
visualizzata in anteprima da sola su Rebase Cloud: `rebase cloud deploy <app> --preview`
viene rifiutato con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Una preview del backend
viene fatturata come un'unità di app aggiuntiva con dimensione predefinita per l'intera durata della sua esistenza, e
il deploy indica il relativo costo mensile stimato dal control plane
(`cost` con `--json`; solo la regola e questo link se il control plane non è in grado di
calcolarlo); `rebase cloud previews delete <name>` la arresta. `rebase cloud previews`
mostra una preview sospesa dalla piattaforma (il cui database ha superato il limite previsto per le preview) come
`paused`, specificandone il motivo (`statusMessage` con `--json`). La creazione di un nuovo indirizzo di preview
può essere rifiutata con `preview_cert_budget` se il budget settimanale di certificati di
preview della piattaforma è esaurito; il messaggio indica fino a quando.
Consulta [Visualizzare l'anteprima di una modifica](/docs/deployment/cloud/#preview-a-change).

### Log

`rebase cloud logs` stampa il log dell'ultima build, e `-f` segue in tempo reale (tail) una build ancora
in esecuzione. `--runtime` legge invece l'output stampato dall'applicazione, da ogni pod
sottostante, contrassegnando ciascuna riga con il relativo pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` accetta una durata (`30s`, `5m`, `1h`) o un timestamp in formato RFC3339.
- `--tail <n>` indica il numero di righe per pod da cui iniziare (il control plane le limita a 2000).
- `--grep` mantiene le righe che contengono il testo specificato (senza distinzione tra maiuscole e minuscole); usa `/re/flags` per
  un'espressione regolare.
- `--level error|warn|info|debug` filtra le righe mantenendo solo quelle con tale gravità o superiore. Legge
  il campo strutturato `severity` registrato da un backend Rebase, una parola indicante il livello all'inizio di una
  riga di testo normale o un formato di errore come `TypeError:`. Le righe che non contengono alcuno di questi elementi vengono escluse.

La modalità follow esegue un polling ogni due secondi e stampa ogni riga una sola volta. Segnala i pod
che si avviano, si arrestano o si riavviano. Quando un container si riavvia, stampa anche le ultime
righe dell'istanza terminata, dove di solito si trova la causa dell'errore. Rimane in attesa quando nessun
pod è in esecuzione e, in caso di disconnessione, riprova con backoff e
riprende dal punto in cui si era interrotto. Con `--json`, il follow stampa un oggetto JSON per
riga (NDJSON): `{"type":"line","ts","pod","text"}` per ciascuna riga di log e
`{"type":"event","event":…}` per il resto.

`--preview <name>` legge i log di una preview anziché dell'ambiente di produzione. Usa il nome
della preview o l'ID di deployment stampato dal deploy della preview. Da solo, `--preview`
legge l'unica preview del progetto. Una preview statica ha un log di compilazione ma nessun
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
chiave creata da `rebase cloud init --claim` per l'app e scritta in `.env` come
`REBASE_API_TOKEN`, mostrandone solo il prefisso e mai il valore intero. Il claim del progetto
trasferisce tale chiave, interrompendone la scadenza. `app-key rotate` ne genera una nuova e
revoca contemporaneamente tutte le chiavi agent precedenti. Scrive la nuova chiave in un `.env`
che definisce già `REBASE_API_TOKEN`, escludendola dall'output `--json` in quel contesto. In
qualunque altra directory stampa la chiave una sola volta. Le chiavi create nel pannello di amministrazione dell'app
non vengono modificate. Il comando viene eseguito con la tua sessione di login: nessuna capability del token può autorizzarlo.

`service-key`
stampa la generazione della chiave `REBASE_SERVICE_KEY` del progetto, la data dell'ultima
rotazione e se l'app è ancora in fase di riavvio sulla nuova chiave. Non stampa
mai la chiave: per farlo usa `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emette una nuova chiave e riavvia l'app applicandola. La vecchia chiave rimane valida fino al
completamento del riavvio, dopo il quale non funzionerà più. L'operazione viene rifiutata durante un deploy in
corso e viene eseguita con la tua sessione di login. Il claim di un progetto ruota anche la
relativa service key.

Una preview di backend eredita inizialmente le variabili di produzione, incluse le chiavi live.
`env set KEY=VALUE --preview` assegna alle preview un valore dedicato, `env unset KEY
--preview` esclude la variabile da esse, `env reset KEY --preview` ripristina
il valore di produzione ed `env list --preview` mostra le differenze.
L'ambiente di produzione non viene mai modificato da nessuno di questi comandi.

`env set KEY --stdin` legge il valore dallo standard input anziché dalla
riga di comando, dove `ps` e la cronologia della shell lo renderebbero visibile:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Viene eliminato un singolo carattere di nuova riga finale. Lo strumento `rebase_cloud_env_set` del server MCP imposta i
valori in questo modo.

## Organizzazioni

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` crea un invito e ne stampa il link: monouso,
valido per 7 giorni, accettabile solo da un account che ha verificato tale indirizzo email.
Nessuno entra a far parte dell'organizzazione finché non accetta l'invito, nemmeno chi possiede già un account Rebase.
L'output (e il campo `emailDelivery` in `--json`) specifica se l'invito è stato inviato via email; in caso
contrario, un avviso indica di inviare il link manualmente. `--role` può essere `admin` o
`member` (predefinito). Nessuno può essere invitato direttamente come `owner`: invitalo come admin, e
un owner potrà promuoverlo con `members role <email> owner` una volta effettuato l'accesso.
`invites resend` genera un nuovo link rendendo non più valido il precedente.
L'invio e la gestione degli inviti richiedono una sessione `rebase cloud login`; `REBASE_TOKEN` non è
consentito. L'invito, la visualizzazione, il reinvio e la revoca richiedono il ruolo di owner o admin;
un utente con ruolo member riceverà un avviso.
`members remove` richiede conferma (`--yes` la ignora); per rimuovere o retrocedere un owner
è necessario essere un owner, e l'ultimo owner non può essere rimosso. `--org <id>` seleziona un'organizzazione
diversa da quella attualmente attiva.

`activity` è l'audit log dell'organizzazione selezionata, ordinato dal più recente: chi ha
eseguito un deploy, un rollback, impostato, eliminato o visualizzato una variabile d'ambiente (per
nome, mai per valore), modificato un dominio, creato, ripristinato o scaricato un
backup, modificato il compute di un progetto, arrestato o eliminato un progetto, modificato il
ruolo di un membro oppure creato o revocato un token di accesso. `--action` accetta un'area
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o un'azione completa
come `env.set`. Una pagina contiene fino a 100 voci (`--limit`, predefinito 50);
l'output stampa il cursore `--before` per la pagina successiva. `--json` restituisce un singolo valore,
`{ org, events, nextCursor }`. Richiede il ruolo di owner o admin dell'organizzazione.
Un token può leggerlo solo se possiede la capability `audit` sull'organizzazione
(`rebase cloud tokens create --can audit`). La pagina **Activity** della console
mostra lo stesso log.

## Database

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` apre una porta locale che *rappresenta* il database gestito (nessun
endpoint pubblico) fino a Ctrl-C; `--reveal` aggiunge la password. Riservato a owner o admin.

## Ospiti

Ogni chiamata a `signInAnonymously()` effettuata durante un test, da un bot o in una visita abbandonata lascia una riga
nella tabella utenti del progetto. Questi comandi contano tali righe e le rimuovono, evitando
di doverle eliminare manualmente una per una.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` accetta un intervallo di tempo con unità di misura: `45m`, `12h`, `30d` o `2w`. Senza `--yes`,
conta le righe senza cancellare nulla. Elabora progetti di qualsiasi dimensione suddividendo il lavoro in piccoli
batch.

Possono essere rimossi solo gli utenti ospiti (guest). Un guest è una riga con `is_anonymous` impostato, senza password e senza
identità collegate; l'applicazione applica questa regola direttamente nell'istruzione di eliminazione della
riga, impedendo al comando di intaccare un account reale, anche se registrato un istante
dopo essere stato elencato. `delete` rifiuta un account non anonimo con l'errore `NOT_ANONYMOUS`.

**Ultimo accesso (Last seen)** indica il momento in cui la sessione del guest è stata emessa o aggiornata per l'ultima volta, oppure
la data di creazione se non dispone più di alcun token di refresh. Un guest che continua a tornare
non è considerato vecchio, indipendentemente da quando è stato creato. L'eliminazione di un guest comporta anche
la cancellazione dei relativi token di refresh e di tutte le altre righe di autenticazione associate.

Le righe nelle tue tabelle seguono le regole delle rispettive chiavi esterne (foreign key):

| Colonna | Cosa succede alla riga |
|---|---|
| Collegamento opzionale (`ON DELETE SET NULL`, valore predefinito) | Mantenuta, con il collegamento svuotato |
| Collegamento obbligatorio (`ON DELETE RESTRICT`, valore predefinito) | Mantenuta, e il guest insieme ad essa: il guest viene segnalato come ignorato con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Eliminata insieme al guest |
| Nessuna chiave esterna (un campo `userSelect`, un semplice ID) | Mantenuta, contenente un ID non più esistente |

Verifica quali delle tue relazioni sono configurate con eliminazione a cascata (cascade) prima di passare `--yes`: l'operazione non può essere annullata.

Il comando legge `REBASE_SERVICE_KEY` esattamente come `env reveal`, pertanto richiede il ruolo di
owner o admin (oppure un token con capability `env` appartenente a uno di essi).
La chiave rimane in memoria e viene inviata esclusivamente all'indirizzo del progetto stesso. Per un progetto che esegue
un runtime obsoleto verrà segnalata la necessità di un aggiornamento.

## Risorse

Le risorse allocate dalla piattaforma per il progetto, a fronte di quanto dichiarato nel codice.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un deploy non rimuove mai un database sottoposto a provisioning quando la sua dichiarazione viene rimossa dal codice — altrimenti
i dati verrebbero eliminati da un semplice push. La piattaforma continua a mantenerlo, associarlo e fatturarlo finché
non viene esplicitamente eliminato con prune specificandone il nome.

## Compute

Le risorse riservate dal progetto e i relativi costi.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accetta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
`--scale-to-zero` è stato ritirato: ogni backend esegue almeno un'istanza, pertanto
`true` viene rifiutato e `false` viene ignorato con un avviso. Non ci sono piani
a scaglioni (tier): ogni elemento ha un prezzo in base alle risorse allocate. Consulta
[Rebase Cloud](/docs/deployment/cloud/).

## Archiviazione, notifiche, cluster, fatturazione e utilizzo

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
accetta un elenco separato da virgole di `deploy.failed` (predefinito),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` e `preview.paused`. `--format slack` invia
unicamente `{ "text" }` anziché il JSON completo dell'evento, che include a sua volta un campo `text`. L'URL
è un argomento posizionale poiché `--url` identifica il control plane. `add` stampa
il segreto di firma una sola volta; `--json` restituisce `{ projectId, webhook, secret }`.
`test <id>` termina con codice 1 ed errore `delivery_failed` se il destinatario non ha accettato
l'evento di test. La visualizzazione è consentita a qualsiasi membro dell'organizzazione; `add`, `test`
e `remove` richiedono il ruolo di owner o admin. Un token può gestirli tramite la capability
`notifications` sull'organizzazione, nel rispetto della stessa regola sui ruoli. Consulta
[Notifiche Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` assegna al cluster del
cliente un registro immagini (image registry) dedicato, utilizzato esclusivamente per quel cluster. Senza di
questo, il cluster utilizzerà il registro condiviso della piattaforma, e ogni deploy lo
segnalerà nel relativo log. Configurandolo, le build eseguiranno il push su quel repository usando un token per
tale account, i pod effettueranno il pull unicamente con quella chiave, e un rollback accetterà le
immagini del progetto ivi residenti. Le immagini
precedentemente create dal progetto nel registro condiviso restano scaricabili e rimangono
utilizzabili per il rollback. I tre valori devono essere forniti congiuntamente; `--clear` li reimposta. La chiave
viene cifrata (sealed) al momento della scrittura e non viene mai riletta. Come il resto dei comandi `clusters`,
richiede il ruolo platform-admin. L'operatore crea il repository ed entrambi
gli account tramite Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` e `billing upcoming` leggono gli stessi dati Stripe della
pagina Billing della console, e sono accessibili esclusivamente agli owner e admin
dell'organizzazione. Un token può accedervi, così come al resto di `billing`, con la capability `billing`
sull'organizzazione; un token creato prima dell'introduzione di questa capability continua a
funzionare per una release, mostrando un avviso in ogni risposta. Gli importi in `--json` sono espressi nell'unità minima della valuta (centesimi), esattamente come
inviati da Stripe. Le fatture in bozza non sono elencate; la preview viene calcolata da
Stripe e le voci a consumo continuano ad accumularsi fino alla chiusura del periodo di fatturazione.

`usage` rileva l'utilizzo del progetto collegato (o specificato con `--project`) in un mese
solare, in UTC: richieste rispetto alla quota inclusa, errori 5xx, l'eccedenza maturata
finora in euro e, per il mese in corso, la stima dell'utilizzo finale a questo
ritmo. L'eccedenza (overage) corrisponde al calcolo effettivo del report di overage, quello che
indica a Stripe cosa fatturare e che compare nella fattura del mese successivo.
`usage org` elenca ogni progetto dell'organizzazione selezionata con `rebase cloud
use`, insieme al totale. Può essere consultato da qualsiasi membro dell'organizzazione. Un token può leggerlo
con la capability `logs` sul progetto; `usage org` elenca i progetti per cui il
token dispone di tale permesso.
`--month` accetta un mese passato. La risposta include un array `caveats`, ciascuno con un `code`: `storage_not_measured`
(lo storage a oggetti segna 0), `multi_pod_undercount` (le richieste gestite mentre sono in esecuzione due o
più pod dell'app non vengono conteggiate), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
progetto riscattato da un agente conteggia solo i giorni a partire dal claim) e
`autoscale_not_charged` (i pod sono stati eseguiti oltre la soglia `--replicas` e questa piattaforma non li
addebita ancora). La risposta per un progetto con scalabilità automatica include anche l'oggetto `autoscale`:
`extraPodSeconds` oltre la base minima, `amountEur` alle tariffe previste e `charged`.
