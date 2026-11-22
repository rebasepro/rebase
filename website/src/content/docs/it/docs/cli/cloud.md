---
sourceHash: 8ba7c94e0a895b48
title: rebase cloud
sidebar_label: rebase cloud
description: I gruppi di comandi per Rebase Cloud nella CLI — autenticazione, collegamento del progetto, deploy, notifiche, configurazione, organizzazioni, database, risorse, compute, storage, cluster, fatturazione e utilizzo.
---

Tutto ciò che riguarda Rebase Cloud, attualmente in versione beta privata. Consulta la
[guida di Rebase Cloud](/docs/deployment/cloud/) per scoprire di cosa si tratta e cosa la
versione beta non include.

Ogni gruppo risponde a `--help`, e `--help` non esegue mai il comando. La maggior parte dei comandi
agisce sul progetto collegato in `.rebase/cloud.json`; `--project <id>` interviene su un
progetto senza collegarlo.

Tre opzioni si applicano ovunque: `--json` per un output leggibile dalla macchina (anche impostazione
predefinita quando incanalato in una pipe, eccetto per `deploy`, o con `REBASE_JSON=1`), `--url <origin>` per indirizzare un
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
altrimenti quella selezionata. Un token può contenere solo funzionalità a livello di organizzazione.
`logs` copre anche `usage`. L'ambito a cui ciascuna ha accesso è descritto in
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Quando il control
plane contrassegna una risposta a un token come deprecata (un token creato prima di `billing`
che legge la fatturazione), la CLI stampa l'avviso una sola volta su stderr, mai nel
valore di `--json`.

Senza flag, `login` effettua l'accesso tramite il browser. Stampa un codice breve e
un link alla console, apre il browser e attende mentre approvi
l'accesso da lì. Se hai già effettuato l'accesso alla console, o accedi con
qualsiasi metodo disponibile (password, Google, GitHub, LinkedIn). Verifica che il
browser mostri lo stesso codice prima di approvarlo. Il link scade dopo dieci
minuti ed è monouso. Senza terminale, o con `--json`, il link e il codice
vengono inviati a stderr e `login` rimane in attesa, consentendo a un agent di fornirti il link. Un
accesso negato termina con `access_denied`, uno scaduto con `expired_token`.

Con `--email`, `login` chiede se utilizzare la password o un codice inviato via email
dal control plane. Con l'autenticazione a due fattori abilitata, richiede successivamente il codice dell'autenticatore
(o un codice di recupero); tramite browser, approva da una sessione della console in cui è stata utilizzata.
Senza terminale nessuno dei due codici può essere digitato: imposta
`REBASE_TOKEN` su un token di accesso creato nella console in Settings → Access tokens.
Consulta [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Collegamento del progetto

```bash
rebase cloud link         # link this directory to a cloud project (picked from a list)
rebase cloud link <slug>  # link the project with that slug or id, as --project <slug> does
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

I comandi relativi all'organizzazione (`orgs`, `billing`, `usage org`, `activity`,
`projects create`, `tokens create --can billing`) agiscono su `--org <id>`, altrimenti
sull'organizzazione selezionata con `cloud use`, altrimenti sull'organizzazione del progetto collegato.
In quest'ultimo caso indicano quale è stata utilizzata. `orgs delete` non la rileva mai
dal collegamento: richiede `--org` o un'organizzazione selezionata.

### Connettere un'istanza self-hosted a Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

Il [Rebase connector](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
la rende quindi raggiungibile insieme ai tuoi progetti Cloud. `connect` stampa
`REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE`; impostali
sul server e riavvialo. Nella cartella del progetto propone di scriverli in
`.env`. Rieseguire il comando è sicuro. `--name` assegna un nome all'istanza, `--org` seleziona
l'organizzazione, `--no-wait` esce senza attendere. Solo per owner e admin.

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

`claim` stampa il link di rivendicazione del progetto di cui `init --claim` ha effettuato il provisioning in questa
directory, e il tempo rimanente prima che venga eliminato se non rivendicato (`Unclaimed: deleted
in 41h`). `--open` lo apre anche in un browser. Il link viene conservato solo sulla
macchina che ha eseguito `init --claim`, in `~/.rebase/credentials.json`; il control
plane ne memorizza un hash e non può stamparlo di nuovo. Prima di rispondere, `claim`
verifica presso il control plane se il token del progetto è ancora valido. La rivendicazione
revoca quel token, quindi una volta che qualcuno ha rivendicato il progetto, `claim` rifiuta
l'operazione con `already_claimed` invece di stampare un link inattivo. Rifiuta inoltre quando
il periodo utile è terminato (`claim_expired`), e in una directory priva di link di rivendicazione
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` mostrano lo stesso
link finché il progetto non è stato rivendicato.

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

`deploy` senza il nome di un'app esegue il deploy del backend. Il deploy di un bundle
di backend carica anche il codice sorgente del progetto — ciò che git traccia, mai un `.env` — in modo
che un aggiornamento della piattaforma possa ricompilarlo; `--no-source` ignora questo passaggio per una volta, e `cloud settings set
--platform-rebuilds off` lo disattiva ed elimina la copia archiviata. `--allow-downgrade` distribuisce una release precedente.

Un aggiornamento della piattaforma può ricompilare un'app gestita su una versione di `@rebasepro` più
recente di quella vincolata dal tuo checkout. Un deploy da quel checkout ripristinerebbe il pannello
di amministrazione e il driver meno recenti, pertanto viene rifiutato prima di compilare qualsiasi elemento,
indicando il comando per risolverlo (`rebase upgrade --to <version>`). `rebase cloud status`
notifica la stessa cosa preventivamente: una riga `Rebuilt on` e, in `--json`,
`runtime.platformRebuiltVersion` e `frameworkDrift`.

Un `deploy` seguito fino al completamento si conclude con un riepilogo: ogni app distribuita con il rispettivo URL,
l'ID del deployment, il tempo impiegato e se la nuova versione risponde all'indirizzo.
Attende fino a `--live-timeout` secondi (valore predefinito: 60; `0` ignora il controllo) affinché l'endpoint
`/health` del backend e l'indirizzo di ciascuna app statica rispondano. Un deploy non riuscito
termina con una sola riga che indica l'app e il motivo, uscendo con uno stato diverso da zero. Il riepilogo
viene stampato anche se incanalato in una pipe; `--json` (o `REBASE_JSON=1`) stampa invece un singolo oggetto,
con `apps`, `hosts`, `live`, `liveChecks` e `durationMs`. Un host il cui certificato
HTTPS non è stato ancora emesso viene segnalato come non live, indicando tale motivo.

Prima del caricamento, `deploy` analizza il codice JavaScript di ogni app statica distribuita:
i file `.js`/`.mjs`/`.cjs` nella cartella `output` e i blocchi `<script>` inline
nel relativo HTML. Un errore di sintassi interrompe il deploy indicando `file:line:column` (codice
`syntax_error` sotto `--json`), mentre `--no-verify` ignora la verifica. Un deploy completato con successo
si conclude indicando la procedura di ripristino, `rebase cloud rollback`. Un'app statica distribuita
singolarmente non può ancora essere ripristinata; consulta
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` rende disponibile la build all'indirizzo `https://<project>--<name>.rebase.website` e
lascia inalterata la produzione. Una preview del backend esegue un'istanza dedicata del backend, su un
proprio database vuoto, integrando le relative app statiche. Un'app statica non può essere
visualizzata in anteprima singolarmente su Rebase Cloud per il momento: `rebase cloud deploy <app> --preview`
viene rifiutato con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Una preview di backend
viene fatturata come un'ulteriore unità applicativa alla dimensione predefinita per tutta la sua durata, e
il deploy indica l'importo mensile corrispondente, in base al preventivo del control plane
(`cost` sotto `--json`; solo la regola e questo link qualora il control plane non possa
calcolarne il prezzo); `rebase cloud previews delete <name>` la arresta. `rebase cloud previews`
mostra lo stato di una preview messa in pausa dalla piattaforma (il cui database ha superato il limite consentito) come
`paused`, specificandone la ragione (`statusMessage` sotto `--json`). La generazione di un nuovo indirizzo di preview
può essere rifiutata con `preview_cert_budget` qualora il budget settimanale di certificati per preview della piattaforma
sia esaurito; il messaggio specifica fino a quando.
Consulta [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Log

`rebase cloud logs` stampa il log di build più recente, e `-f` segue una build che è
ancora in esecuzione. `--runtime` legge invece l'output stampato dall'applicazione, da ciascun pod
sottostante, associando a ogni riga il rispettivo pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` accetta una durata (`30s`, `5m`, `1h`) o un timestamp RFC3339.
- `--tail <n>` specifica il numero di righe per pod da cui iniziare (il control plane le limita a 2000).
- `--grep` mantiene le righe contenenti il testo, indipendentemente dalle maiuscole/minuscole; specifica `/re/flags` per
  un'espressione regolare.
- Con `--grep` o `--level`, il filtro esamina ogni riga restituita dal control plane
  per l'intervallo temporale (le 2000 più recenti di ciascun pod), e `--tail` conta le righe corrispondenti:
  le `n` corrispondenze più recenti per pod, 500 per impostazione predefinita. Quando un pod contiene più
  righe nell'intervallo specificato, l'output segnala che le più vecchie non sono state
  esaminate (`filter.scanCapped` sotto `--json`).
- `--level error|warn|info|debug` mantiene le righe con tale livello di gravità o superiore. Riconosce
  il campo strutturato `severity` registrato da un backend Rebase, l'indicazione del livello all'inizio di una
  riga di testo semplice o una struttura di errore come `TypeError:`. Le righe prive di questi elementi vengono escluse.

La modalità follow esegue il polling ogni due secondi e stampa ciascuna riga una volta sola. Notifica i pod
che si avviano, si arrestano o si riavviano. Al riavvio di un container stampa inoltre le ultime
righe dell'istanza terminata, dove solitamente è indicata la causa. Rimane in attesa finché nessun
pod è in esecuzione e, in caso di caduta di connessione, esegue nuovi tentativi con backoff
riprendendo dal punto interrotto. Con `--json`, il follow stampa un oggetto JSON per
riga (NDJSON): `{"type":"line","ts","pod","text"}` per ciascuna riga di log, e
`{"type":"event","event":…}` per il resto.

`--preview <name>` legge i log di una preview anziché dell'ambiente di produzione. Utilizza il
nome della preview o l'ID del deployment stampato dal deploy di preview. Usato singolarmente, `--preview`
legge l'unica preview del progetto. Una preview statica dispone di un log di build ma non di
runtime, poiché non esegue alcun server.

## Configurazione

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
rebase cloud service-key [rotate] --preview <name>  # a backend preview's own key
```

`domains add` per un host già associato al progetto, ad esempio uno registrato da un
deploy tramite `rebase.json`, stampa i record DNS e lo stato dell'host esattamente come avviene per una
nuova aggiunta; `--json` aggiunge `alreadyRegistered: true`. Un host verificato viene
servito su HTTPS una volta emesso il relativo certificato, pochi minuti dopo
la verifica. Fino a quel momento l'ingress risponde con un certificato segnaposto,
e `domains list`, `domains verify` e `status` indicano
`verified, certificate pending` anziché live. La CLI rileva questa condizione con
un handshake TLS verso ciascun host verificato; `--json` la riporta come `certificate`
(`ready`, `pending` o `unreachable`, con un `reason`).

`app-key` elenca la
chiave generata da `rebase cloud init --claim` sull'applicazione e inserita in `.env` come
`REBASE_API_TOKEN`, mostrandone il prefisso e mai il valore. La rivendicazione del progetto
trasferisce tale chiave e ne interrompe la scadenza. `app-key rotate` ne genera una nuova e
revoca contestualmente tutte le chiavi agent precedenti. Scrive la nuova chiave in un file `.env`
che contiene già `REBASE_API_TOKEN`, escludendola dall'output di `--json`. In
qualsiasi altra directory stampa la chiave una sola volta. Le chiavi generate nel pannello di amministrazione dell'app
non vengono toccate. Viene eseguito con la tua sessione di accesso: nessuna capability del token può autorizzarlo.

`service-key`
stampa la generazione della `REBASE_SERVICE_KEY` del progetto, la data dell'ultima
rotazione e indica se l'app è ancora in fase di riavvio sulla chiave più recente. Non
stampa mai la chiave: a tale scopo si utilizza `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emette una nuova chiave e riavvia l'app su di essa. La vecchia chiave rimane valida fino al completamento
del riavvio, e cessa di funzionare subito dopo. Viene rifiutato durante un deploy
in corso, e viene eseguito con la tua sessione di accesso. Anche la rivendicazione di un progetto esegue la rotazione
della relativa service key.

Una preview di backend dispone di una propria service key. Il primo deploy la genera,
i successivi deploy la mantengono, e la chiave di produzione restituisce 401 sulla preview.
`service-key --preview <name>` la stampa, così come `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
ne genera una nuova e riavvia unicamente il pod di quella specifica preview; la vecchia chiave rimane valida finché
il nuovo pod non è pronto. Richiede una conferma preventiva, ignorabile con `--yes`. Entrambi richiedono
gli stessi privilegi di `env reveal`: il ruolo di owner o admin dell'organizzazione e, per un
token di accesso, la capability `env` su un progetto rivendicato. La chiave e il pod
di produzione rimangono inalterati.

Una preview di backend eredita le variabili dell'ambiente di produzione, incluse le chiavi live.
`env set KEY=VALUE --preview` assegna alle preview un valore dedicato, `env unset KEY
--preview` esclude la variabile dalle preview, `env reset KEY --preview` ripristina
il valore di produzione ed `env list --preview` mostra le differenze.
Nessuno di questi comandi modifica mai l'ambiente di produzione.

`env set KEY --stdin` legge il valore dallo standard input invece che dalla
riga di comando, dove `ps` e la cronologia della shell lo renderebbero visibile:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Un eventuale carattere di a capo finale viene rimosso. Il comando `rebase_cloud_env_set`
del server MCP imposta i valori in questa modalità.

`env set KEY --prompt` richiede il valore tramite un prompt nascosto nel terminale.
Nessun carattere viene mostrato a schermo e il valore viene memorizzato come secret, analogamente a `--stdin
--secret`. Un agent può fornirti il comando da eseguire, evitando che il valore
transiti nella chat. Senza un terminale l'operazione viene rifiutata (`input_required`),
rimandando all'uso di `--stdin`.

## Organizzazioni

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite <email>` aggiunge un utente che possiede già un account Rebase con un
indirizzo email verificato, analogamente alla funzione Add member della console. L'utente ottiene l'accesso
immediatamente e non viene inviata alcuna email. Rebase Cloud non supporta ancora l'invio diretto di inviti,
pertanto una persona priva di account non riceverà alcun link: il comando viene rifiutato con `no_account` e
richiede che l'utente si registri prima di riprovare. Un control plane che
supporta gli inviti ne apre invece uno e ne stampa il relativo link (monouso, valido per 7
giorni, accettabile solo da un account che ha verificato tale indirizzo); `invites`
elenca, revoca e reinvia tali inviti, rispondendo `not_served` negli altri casi.
`--role` può essere `admin` o `member` (predefinito). Nessuno viene aggiunto direttamente come `owner`: aggiungilo
come admin, dopodiché un owner potrà promuoverlo con `members role <email> owner`.
L'aggiunta di membri e l'uso di `invites` richiedono una sessione `rebase cloud login`;
`REBASE_TOKEN` viene rifiutato. Entrambe le operazioni richiedono il ruolo di owner o admin; a un membro privo di tali permessi
viene segnalata l'incompatibilità.
`members remove` richiede conferma (`--yes` la ignora); per rimuovere o retrocedere un owner
è necessario essere owner, e l'ultimo owner non può essere rimosso. `--org <id>` seleziona un'organizzazione
diversa da quella attiva.

`activity` rappresenta l'audit log dell'organizzazione selezionata, ordinato dal più recente: chi ha
effettuato deploy, rollback, impostato, eliminato o visualizzato una variabile d'ambiente (per
nome, mai per valore), modificato un dominio, creato, ripristinato o scaricato un
backup, modificato le risorse compute di un progetto, arrestato o eliminato un progetto, modificato il ruolo
di un membro, oppure creato o revocato un token di accesso. `--action` accetta un ambito
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o un'azione completa
come `env.set`. Una pagina contiene fino a 100 elementi (`--limit`, valore predefinito: 50);
l'output stampa il cursore `--before` per la pagina successiva. `--json` restituisce un singolo valore,
`{ org, events, nextCursor }`. Richiede il ruolo di owner o admin dell'organizzazione.
Un token può leggerlo solo se provvisto della capability `audit` sull'organizzazione
(`rebase cloud tokens create --can audit`). La pagina **Activity** della console
mostra lo stesso log.

## Database

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` apre una porta locale che *è* a tutti gli effetti il database gestito (nessun endpoint
pubblico) fino a Ctrl-C; `--reveal` aggiunge la password. Riservato esclusivamente a owner o admin.

## Guest

Ogni chiamata a `signInAnonymously()` durante un test, da parte di un bot o in una sessione abbandonata lascia una riga
tra gli utenti del progetto. Questi comandi contano tali righe e le rimuovono, evitando
di doverle eliminare una per una dall'interfaccia.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` accetta un valore temporale corredato da unità: `45m`, `12h`, `30d` o `2w`. Senza `--yes` si limita
a contare gli elementi senza eliminare nulla. Elabora progetti di qualsiasi dimensione in piccoli
batch.

Possono essere rimossi solo i guest. Un guest è una riga con `is_anonymous` impostato, nessuna password e nessuna
identità collegata; l'app applica tale regola nell'istruzione SQL che elimina
la riga, impedendo al comando di toccare un account reale, anche qualora si sia registrato subito
dopo l'elencazione. `delete` rifiuta un account reale con `NOT_ANONYMOUS`.

**Last seen** corrisponde al momento in cui la sessione del guest è stata emessa o aggiornata per l'ultima volta, o alla data di creazione
del guest qualora non rimanga alcun refresh token. Un guest che continua ad accedere
non viene considerato obsoleto, a prescindere da quanto tempo prima sia stato creato. L'eliminazione di un guest comporta
anche la cancellazione dei suoi refresh token e di qualsiasi altra riga di autenticazione associata.

Le righe nelle tue tabelle si comportano in base alla rispettiva foreign key:

| Colonna | Cosa succede alla riga |
|---|---|
| Collegamento facoltativo (`ON DELETE SET NULL`, predefinito) | Mantenuta, con il collegamento svuotato |
| Collegamento obbligatorio (`ON DELETE RESTRICT`, predefinito) | Mantenuta, insieme al guest: il guest viene segnalato come ignorato, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Eliminata insieme al guest |
| Nessuna foreign key (un campo `userSelect`, un semplice ID) | Mantenuta, contenente un ID non più esistente |

Verifica quali dei tuoi collegamenti sono configurati con eliminazione a cascata (cascade) prima di passare `--yes`: l'operazione è irreversibile.

Il comando passa attraverso il proxy Studio della console, che custodisce la chiave dell'app, evitando che la chiave raggiunga
la tua macchina. Richiede un owner o un admin dell'organizzazione, su un progetto con accesso Studio attivo
(`rebase cloud settings set --studio on`). Un progetto configurato su un runtime precedente riceverà la notifica che è necessario aggiornarlo.
`rebase users guests --project <slug>` è il comando equivalente all'interno della famiglia di comandi del progetto.

## Risorse

Gli elementi allocati dalla piattaforma per il progetto, a fronte di quanto dichiarato nel codice.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un deploy non rimuove mai un database sottoposto a provisioning quando la sua dichiarazione viene eliminata:
ciò equivarrebbe alla cancellazione di dati causata da un semplice push. Lo mantiene attivo, associato e fatturato finché
qualcuno non lo elimina esplicitamente per nome con il comando prune.

## Compute

Le risorse riservate dal progetto e i relativi costi.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accetta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
`--scale-to-zero` è stato ritirato: ogni backend esegue almeno un'istanza, per cui
`true` viene rifiutato e `false` viene ignorato con un avviso. Non ci sono livelli
di piano tariffario: i prezzi sono interamente determinati dalle singole risorse. Consulta
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, notifiche, cluster, fatturazione e utilizzo

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
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
accetta un elenco separato da virgole di `deploy.failed` (valore predefinito),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` e `preview.paused`. `--format slack` invia
unicamente `{ "text" }` anziché il JSON dell'evento, che contiene anch'esso una proprietà `text`. L'URL
è un argomento posizionale poiché `--url` specifica il control plane. `add` stampa
il secret per la firma una sola volta; `--json` restituisce `{ projectId, webhook, secret }`.
`test <id>` esce con codice 1 ed errore `delivery_failed` se il ricevente non ha accettato
l'evento di test. L'elencazione è accessibile a qualsiasi membro dell'organizzazione; `add`, `test`
e `remove` richiedono il ruolo di owner o admin. Un token li gestisce tramite la
capability `notifications` sull'organizzazione, nel rispetto delle medesime regole sui ruoli. Consulta
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` assegna al cluster di proprietà
di un cliente un proprio registro di immagini dedicato, riservato a quello specifico cluster. Senza
di esso, il cluster si appoggia al registro condiviso della piattaforma, e ogni deploy effettuato
lo segnala nel rispettivo log. Con un registro configurato, le build eseguono il push su quel repository con un token per
quell'account, i pod effettuano il pull unicamente con quella chiave e le operazioni di rollback accettano le
immagini del progetto ivi residenti. Le immagini
compilate in precedenza dal progetto nel repository condiviso rimangono disponibili per il pull e utilizzabili
come target di rollback. I tre valori devono essere indicati congiuntamente; `--clear` li rimuove. La chiave
viene protetta in fase di scrittura e non viene mai esposta successivamente. Come le altre funzioni di `clusters`,
richiede il ruolo platform-admin. L'operatore crea il repository ed entrambi
gli account tramite Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` e `billing upcoming` consultano gli stessi dati Stripe della
pagina Billing della console, e sono accessibili esclusivamente a owner e admin dell'organizzazione.
Un token vi ha accesso, così come al resto di `billing`, mediante la capability
`billing` sull'organizzazione; un token generato antecedentemente all'introduzione di tale capability continuerà a
funzionare per una release, emettendo un avviso a ogni risposta. Gli importi in `--json` sono espressi nell'unità minima della valuta (centesimi), esattamente come
inviati da Stripe. Le fatture in stato di bozza non vengono mostrate; l'anteprima è elaborata da
Stripe e le relative voci a consumo continuano ad aggiornarsi fino al termine del periodo di riferimento.

`usage` legge i consumi del progetto collegato (o `--project`) in un mese
solare, in formato UTC: richieste rispetto alla soglia inclusa, errori 5xx, l'eccedenza
accumulata fino a quel momento in euro e, per il mese in corso, la stima proiettata
su tale andamento. L'eccedenza corrisponde al calcolo effettuato dal report consumi,
lo stesso trasmesso a Stripe per la fatturazione e riportato nella fattura del mese successivo.
`usage org` elenca ciascun progetto dell'organizzazione selezionata con `rebase cloud
use`, unitamente al totale complessivo. Qualsiasi membro dell'organizzazione può prenderne visione. Un token può leggerlo
tramite la capability `logs` sul progetto; `usage org` riporta l'elenco dei progetti per i quali
il token possiede tale autorizzazione.
`--month` accetta un mese trascorso. La risposta include dei `caveats`, ciascuno contrassegnato da un `code`: `storage_not_measured`
(lo storage di oggetti riporta 0), `multi_pod_undercount` (le richieste gestite durante l'esecuzione contemporanea di due o
più pod dell'app non vengono conteggiate), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
progetto rivendicato da un agent conteggia unicamente i giorni a partire dalla rivendicazione) e
`autoscale_not_charged` (i pod sono stati eseguiti al di sopra di `--replicas` e la piattaforma non li
fattura ancora). La risposta per un progetto con scalabilità automatica include inoltre la sezione `autoscale`:
`extraPodSeconds` oltre la soglia minima, `amountEur` secondo le relative tariffe, e `charged`.

## Deploy hook, alert e altre funzioni

```bash
rebase cloud deploy-hooks [list] | create [--name <name>] [--branch <branch>] | revoke <id>   # secret URLs a git host or CI calls to deploy
rebase cloud alerts [list] [--all] | ack <id> | snooze <id> --hours <1-168>   # the project's incidents
rebase cloud deploy --git [<branch>]     # build on the control plane from the connected repository
rebase cloud metrics --runtime           # requests, errors and latency, per surface
rebase cloud metrics --history [--series cpu_millicores|memory_bytes|event_loop_delay_ms|requests_<surface>|errors_<surface>] [--minutes <n>]
rebase cloud domains primary <domain>    # make a verified domain the canonical one
rebase cloud domains redirect <domain> [--off]   # answer it with a 308 to the primary, path and query kept
rebase cloud settings set --studio on|off
rebase cloud orgs rename <name> [--slug <slug>]
rebase cloud orgs delete                 # refused while the organization has projects
rebase cloud billing email <address>     # where invoices go
rebase cloud clusters baseline <id> [--install]   # platform admins
```

`domains redirect` è configurabile per singolo dominio ed è disattivato per impostazione predefinita, in modo che un progetto che serve un host `api.` parallelamente al proprio sito possa mantenerli entrambi; ha effetto se il dominio è verificato e ne esiste un altro primario, e non si applica mai a un dominio su cui è servita un'applicazione. `deploy-hooks create` stampa l'URL dell'hook una sola volta. `deploy --git` non può essere combinato con i flag previsti per una build locale e, sul runtime gestito, richiede `--eject`, poiché il control plane compila a partire dai sorgenti. `settings set --studio` è l'opzione che i comandi di progetto (`rebase data`, `rebase users`, …) richiedono abilitata per `--project`: questi ultimi raggiungono infatti l'app tramite il proxy Studio della console. Un comando la cui route sul control plane non è ancora stata distribuita restituisce `not_served` specificandone il nome. I comandi distruttivi richiedono conferma preventiva e vengono respinti con `confirmation_required` qualora non vi sia un terminale interattivo a rispondere: utilizza `--yes`.
