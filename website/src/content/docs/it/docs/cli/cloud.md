---
sourceHash: b5c0e7ccbbb0b521
title: rebase cloud
sidebar_label: rebase cloud
description: I gruppi di comandi per Rebase Cloud nella CLI — autenticazione, collegamento del progetto, deploy, notifiche, configurazione, organizzazioni, database, risorse, elaborazione, archiviazione, cluster, fatturazione e utilizzo.
---

Tutto ciò che riguarda Rebase Cloud, attualmente in beta privata. Consulta la
[guida a Rebase Cloud](/docs/deployment/cloud/) per scoprire di cosa si tratta e cosa non è
incluso nella beta.

Ogni gruppo risponde a `--help`, e `--help` non esegue mai il comando. La maggior parte dei comandi
agisce sul progetto collegato in `.rebase/cloud.json`; `--project <id>` opera su
uno senza necessità di collegamento.

Tre opzioni si applicano ovunque: `--json` per un output leggibile da macchina (anche
l'impostazione predefinita quando è presente una pipe, tranne per `deploy`, o con `REBASE_JSON=1`), `--url <origin>` per indirizzare un
control plane specifico (o `REBASE_CLOUD_URL`), e `--project, -p <id>`.

## Auth

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
`notifications` su un'organizzazione: `--org`, altrimenti l'organizzazione del progetto,
altrimenti quella selezionata. Un token può contenere solo capability a livello di organizzazione.
`logs` copre anche `usage`. Ciò a cui ciascuno ha accesso è descritto in
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Quando il control
plane contrassegna una risposta a un token come deprecata (un token creato prima di `billing`
che legge la fatturazione), la CLI stampa l'avviso una volta su stderr, mai nel
valore `--json`.

Senza flag, `login` effettua l'accesso tramite browser. Stampa un codice breve e
un link alla console, apre il browser e attende l'approvazione dell'accesso
da parte dell'utente. Se hai già effettuato l'accesso alla console, o accedi con
uno qualsiasi dei metodi offerti (password, Google, GitHub, LinkedIn). Verifica che il
browser mostri lo stesso codice prima di approvarlo. Il link scade dopo dieci
minuti ed è monouso. Senza un terminale, o con `--json`, il link e il codice
vengono inviati a stderr e `login` continua ad attendere, consentendo a un agente di passarti il link. Un
accesso negato termina con `access_denied`, uno scaduto con `expired_token`.

Con `--email`, `login` chiede se utilizzare la password o un codice inviato via email dal control
plane. Con l'autenticazione a due fattori attiva, richiede poi il codice
dell'autenticatore (o un codice di ripristino); tramite browser, approva da una
sessione della console che l'ha utilizzato. Senza un terminale nessuno dei due codici può essere digitato: imposta
`REBASE_TOKEN` su un token di accesso creato nella console sotto Settings → Access
tokens. Consulta [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Project link

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

### Connect a self-hosted instance to Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

Il [Rebase connector](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
lo raggiunge poi insieme ai tuoi progetti Cloud. `connect` stampa
`REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE`; impostali sul
server e riavvialo. Nella cartella del progetto propone di scriverli in
`.env`. Eseguirlo nuovamente è sicuro. `--name` assegna un nome all'istanza, `--org` seleziona
l'organizzazione, `--no-wait` restituisce il controllo senza attendere. Solo per owner e admin.

## Projects

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
verifica con il control plane se il token del progetto è ancora valido. Il riscatto
revoca tale token, quindi una volta che qualcuno ha riscattato il progetto, `claim` rifiuta
l'operazione con `already_claimed` invece di stampare un link non più valido. Rifiuta inoltre una volta scaduta la
finestra temporale (`claim_expired`), e in una directory priva di link di riscatto
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` mostrano lo stesso
link finché il progetto non è stato riscattato.

## Deploy and observe

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
backend carica anche i sorgenti del progetto — ciò che git traccia, mai un `.env` — in
modo che un aggiornamento della piattaforma possa ricompilarlo; `--no-source` lo salta per una volta, e `cloud settings set
--platform-rebuilds off` lo disattiva ed elimina la copia archiviata. `--allow-downgrade` esegue il deploy di una release precedente.

Un comando `deploy` seguito fino al completamento si conclude con un riepilogo: ogni app distribuita con il rispettivo URL,
l'ID del deployment, il tempo impiegato e se la nuova versione risponde all'indirizzo. Attende
fino a `--live-timeout` secondi (valore predefinito: 60; `0` salta il controllo) che il
`/health` del backend e l'indirizzo di ogni app statica rispondano. Un deploy non riuscito
si conclude con una riga che indica l'app e il motivo, e termina con codice diverso da zero. Il riepilogo
viene stampato anche quando rediretto tramite pipe; `--json` (o `REBASE_JSON=1`) stampa invece un unico oggetto,
contenente `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

Prima del caricamento, `deploy` analizza il codice JavaScript di ogni app statica distribuita:
i file `.js`/`.mjs`/`.cjs` nel relativo `output` e i blocchi `<script>` inline
nel relativo HTML. Un errore di sintassi interrompe il deploy con `file:line:column` (codice
`syntax_error` con `--json`), mentre `--no-verify` salta questo controllo. Un deploy completato con successo
indica la procedura per ripristinare la versione precedente, `rebase cloud rollback`. Un'app statica distribuita
singolarmente non può ancora essere ripristinata tramite rollback; vedi
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` serve la build su `https://<project>--<name>.rebase.website` e
lascia inalterata la produzione. Una preview del backend esegue un'istanza separata di backend, su un
database vuoto dedicato, con le app statiche incorporate. Un'app statica non può ancora essere
visualizzata in preview singolarmente su Rebase Cloud: `rebase cloud deploy <app> --preview`
viene rifiutato con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Una preview di backend
viene fatturata come un'ulteriore unità applicativa con dimensioni predefinite per tutta la sua durata;
il deploy specifica a quanto ammonta il costo mensile in base alla stima del control plane
(`cost` con `--json`; solo la regola e questo link qualora il control plane non possa
calcolarne il prezzo); `rebase cloud previews delete <name>` la arresta. `rebase cloud previews`
mostra una preview sospesa dalla piattaforma (il database ha superato il limite previsto per le preview) come
`paused`, con la motivazione (`statusMessage` con `--json`). Un nuovo indirizzo di preview
può essere rifiutato con `preview_cert_budget` qualora il budget settimanale della piattaforma per i
certificati di preview sia esaurito; il messaggio specifica fino a quando.
Consulta [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` stampa il log dell'ultima build, e `-f` segue in tempo reale (tail) una build che è
ancora in corso. `--runtime` legge invece l'output stampato dall'applicazione, da ogni pod
sottostante, con ogni riga associata al rispettivo pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` accetta una durata (`30s`, `5m`, `1h`) o un timestamp RFC3339.
- `--tail <n>` indica il numero di righe per pod da cui iniziare (il control plane le limita a un massimo di 2000).
- `--grep` mantiene le righe contenenti il testo indicato, senza distinzione tra maiuscole e minuscole; usa `/re/flags` per
  un'espressione regolare.
- Con `--grep` o `--level`, il filtro ricerca in ogni riga restituita dal control plane
  per l'intervallo temporale (le 2000 più recenti di ciascun pod), e `--tail` conta le righe
  corrispondenti: le `n` corrispondenze più recenti per pod, 500 per impostazione predefinita. Quando un pod ha registrato più
  righe nell'intervallo rispetto a tale limite, l'output segnala che le righe più vecchie non sono state
  analizzate (`filter.scanCapped` con `--json`).
- `--level error|warn|info|debug` mantiene le righe di pari gravità o superiore. Interpreta
  il campo strutturato `severity` registrato da un backend Rebase, la parola che definisce il livello all'inizio di
  una riga di testo normale o un formato di errore come `TypeError:`. Le righe che non contengono queste informazioni vengono omesse.

La modalità follow effettua il polling ogni due secondi e stampa ogni riga una sola volta. Segnala i pod
che si avviano, si arrestano o si riavviano. Quando un container si riavvia, stampa anche le ultime
righe dell'istanza terminata, dove solitamente è indicata la causa. Rimane in attesa se nessun
pod è in esecuzione e, in caso di caduta della connessione, ritenta con backoff progressivo e
riprende da dove si era interrotto. Con `--json`, il follow stampa un oggetto JSON per
riga (NDJSON): `{"type":"line","ts","pod","text"}` per ogni riga di log, e
`{"type":"event","event":…}` per il resto.

`--preview <name>` legge una preview anziché la produzione. Usa il nome della
preview o l'ID di deployment stampato dal deploy della preview. Da solo, `--preview`
legge l'unica preview del progetto. Una preview statica ha un log di build ma nessun
log di runtime, poiché non esegue alcun server.

## Config

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
```

`app-key` elenca la
chiave che `rebase cloud init --claim` ha generato nell'app e scritto in `.env` come
`REBASE_API_TOKEN`, indicandone solo il prefisso e mai il valore intero. Il riscatto del progetto
trasferisce la proprietà di tale chiave, impedendone la scadenza. `app-key rotate` ne genera una nuova e
revoca simultaneamente tutte le chiavi agent precedenti. Scrive la nuova chiave in un file `.env`
che imposta già `REBASE_API_TOKEN`, escludendola dall'output `--json` in tale contesto. In
qualsiasi altra directory stampa la chiave una volta sola. Le chiavi create nel pannello di amministrazione
dell'app non vengono modificate. Viene eseguito con la tua sessione di login: nessuna capability di token può concederlo.

`service-key`
stampa la generazione della `REBASE_SERVICE_KEY` del progetto, la data dell'ultima
rotazione e se l'app è ancora in fase di riavvio verso la versione più recente. Non
stampa mai la chiave: a tale scopo si usa `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emette una nuova chiave e riavvia l'app su di essa. La vecchia chiave rimane valida fino al completamento
del riavvio, dopodiché cessa di funzionare. L'operazione viene rifiutata durante l'esecuzione di un deploy
e richiede il tuo login. Il riscatto di un progetto ruota anch'esso la relativa chiave di servizio.

Una preview di backend eredita le variabili della produzione, chiavi live incluse.
`env set KEY=VALUE --preview` assegna alle preview un valore dedicato, `env unset KEY
--preview` esclude la variabile dalle preview, `env reset KEY --preview` ripristina
il valore di produzione ed `env list --preview` mostra le differenze.
La produzione non viene mai modificata da nessuna di queste operazioni.

`env set KEY --stdin` legge il valore dallo standard input anziché dalla
riga di comando, dove `ps` e la cronologia della shell lo renderebbero visibile:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

L'eventuale carattere di nuova riga finale viene rimosso. Il comando `rebase_cloud_env_set`
del server MCP imposta i valori con questa modalità.

## Organizations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` crea un invito e ne stampa il link: monouso,
valido per 7 giorni, accettabile solo da un account che ha verificato tale indirizzo email.
Nessuno entra a far parte dell'organizzazione prima di aver accettato, anche se dispone già di un account Rebase.
L'output (e il campo `emailDelivery` in `--json`) indica se l'invito è stato inviato via email; in caso
contrario, un avviso segnala di inoltrare il link manualmente. `--role` può essere `admin` o
`member` (predefinito). Nessuno può essere invitato direttamente come `owner`: invitalo come admin, dopodiché
un owner potrà promuoverlo con `members role <email> owner` una volta completata l'adesione.
`invites resend` genera un nuovo link rendendo non valido il precedente.
L'invio e la gestione degli inviti richiedono una sessione `rebase cloud login`; `REBASE_TOKEN` viene
rifiutato. Inviti, visualizzazione, reinvio e revoca richiedono il ruolo owner o admin;
un member riceverà una notifica a riguardo.
`members remove` richiede conferma (`--yes` la ignora); la rimozione o il declassamento di un owner
richiede il ruolo di owner, e l'ultimo owner rimasto non può essere rimosso. `--org <id>` seleziona un'organizzazione
diversa da quella attiva.

`activity` rappresenta l'audit log dell'organizzazione selezionata, dal più recente al meno recente: chi ha
effettuato deploy, rollback, impostato, eliminato o visualizzato una variabile d'ambiente (per
nome, mai per valore), modificato un dominio, creato, ripristinato o scaricato un
backup, modificato il compute di un progetto, arrestato o eliminato un progetto, modificato il
ruolo di un membro, oppure creato o revocato un token di accesso. `--action` accetta un'area
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o un'azione completa
come `env.set`. Una pagina contiene fino a 100 voci (`--limit`, predefinito 50); l'output
stampa il cursore `--before` per la pagina successiva. `--json` restituisce un unico valore,
`{ org, events, nextCursor }`. Richiede il ruolo di owner o admin dell'organizzazione.
Un token può leggerlo solo se dispone della capability `audit` sull'organizzazione
(`rebase cloud tokens create --can audit`). La pagina **Activity** della console
mostra lo stesso log.

## Databases

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` apre una porta locale che funge da connessione diretta al database gestito (nessun
endpoint pubblico) fino alla pressione di Ctrl-C; `--reveal` include la password. Riservato a owner o admin.

## Guests

Ogni chiamata a `signInAnonymously()` eseguita durante un test, da un bot o in una visita abbandonata lascia una riga
nella tabella utenti del progetto. Questi comandi contano tali righe e le rimuovono, evitando
di doverle scorrere una per una.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` accetta un intervallo temporale con unità di misura: `45m`, `12h`, `30d` o `2w`. Senza `--yes` si
limita a contare senza eliminare nulla. Elabora progetti di qualsiasi dimensione a piccoli
lotti.

Solo gli account guest possono essere eliminati. Un guest è una riga con `is_anonymous` impostato, nessuna password e nessuna
identità collegata; l'app applica questa regola direttamente nell'istruzione di eliminazione della
riga, impedendo al comando di toccare account reali, anche qualora si siano registrati un istante
dopo l'elencazione. `delete` rifiuta un account non anonimo con l'errore `NOT_ANONYMOUS`.

**Last seen** indica il momento in cui la sessione del guest è stata emessa o aggiornata l'ultima volta, o quando
il guest è stato creato se non ha più refresh token attivi. Un guest che continua ad accedere
non è considerato obsoleto, indipendentemente dalla data di creazione. I refresh token e qualsiasi
altra riga di autenticazione associata a un guest eliminato vengono rimossi insieme ad esso.

Le righe nelle tue tabelle seguono i vincoli delle rispettive foreign key:

| Colonna | Cosa accade alla riga |
|---|---|
| Collegamento facoltativo (`ON DELETE SET NULL`, predefinito) | Mantenuta, con il collegamento impostato su null |
| Collegamento obbligatorio (`ON DELETE RESTRICT`, predefinito) | Mantenuta insieme al guest: il guest viene segnalato come saltato con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Eliminata insieme al guest |
| Nessuna foreign key (un campo `userSelect`, un semplice id) | Mantenuta, con un id che non esiste più |

Verifica quali collegamenti hanno l'eliminazione a catena (cascade) prima di passare `--yes`: l'operazione non può essere annullata.

Il comando passa attraverso il proxy Studio della console, che custodisce la chiave dell'app, evitando che quest'ultima raggiunga la tua
macchina. Richiede il ruolo di owner o admin dell'organizzazione, su un progetto con accesso a Studio attivo
(`rebase cloud settings set --studio on`). Un progetto basato su un runtime obsoleto riceverà la notifica di aggiornamento a una versione più recente.
`rebase users guests --project <slug>` è il comando equivalente nella famiglia di comandi del progetto.

## Resources

Cosa la piattaforma gestisce per il progetto, a confronto con quanto dichiarato dal codice.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un deploy non rimuove mai un database di cui è stato effettuato il provisioning se la relativa dichiarazione scompare:
equivarrebbe a cancellare dati a seguito di un push. La piattaforma continua a mantenerlo, associarlo e fatturarlo finché
non viene rimosso esplicitamente per nome tramite prune.

## Compute

Le risorse riservate dal progetto e i relativi costi.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accetta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
`--scale-to-zero` è deprecato: ogni backend esegue almeno un'istanza, pertanto
`true` viene rifiutato e `false` viene ignorato con un avviso. Non sono previsti livelli
di piano: ogni risorsa ha una tariffazione specifica. Consulta
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, notifications, clusters, billing and usage

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
accetta un elenco separato da virgole tra `deploy.failed` (predefinito),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` e `preview.paused`. `--format slack` invia
solo `{ "text" }` anziché il JSON dell'evento, che include a sua volta una proprietà `text`. L'URL
è un argomento posizionale poiché `--url` specifica il control plane. `add` stampa
il segreto di firma una sola volta; `--json` restituisce `{ projectId, webhook, secret }`.
`test <id>` termina con codice 1 ed errore `delivery_failed` se il destinatario non ha accettato
l'evento di test. La visualizzazione dell'elenco è aperta a qualsiasi membro dell'organizzazione; `add`, `test`
e `remove` richiedono il ruolo owner o admin. Un token può gestirli se dispone della
capability `notifications` sull'organizzazione, nel rispetto della stessa regola sui ruoli. Consulta
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` assegna al cluster
proprietario del cliente un proprio registro di immagini, utilizzato esclusivamente per quel cluster. Senza di
questo, il cluster utilizza il registro condiviso della piattaforma, e ogni deploy lo
segnala nel relativo log. Con un registro dedicato, le build eseguono il push su quel repository con un token per
tale account, i pod effettuano il pull solo con quella chiave, e un eventuale rollback accetta le
immagini del progetto archiviate lì. Le immagini
create in precedenza dal progetto nel repository condiviso rimangono disponibili per il pull e utilizzabili
per il rollback. I tre valori devono essere forniti insieme; `--clear` li rimuove. La chiave
viene cifrata al momento della scrittura e non viene mai riletta. Come per il resto dei comandi di `clusters`,
è richiesto il ruolo platform-admin. L'operatore crea il repository ed entrambi
gli account tramite Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` e `billing upcoming` leggono gli stessi dati Stripe mostrati nella
pagina Billing della console, e sono accessibili esclusivamente agli owner e admin
dell'organizzazione. Un token può accedervi, così come al resto di `billing`, tramite la capability
`billing` sull'organizzazione; un token creato prima dell'introduzione di tale capability continua a funzionare
per una release, mostrando un avviso a ogni risposta. Gli importi in `--json` sono espressi nell'unità minima della valuta (centesimi), esattamente come
inviati da Stripe. Le fatture in bozza non sono elencate; la preview è calcolata da
Stripe e le relative voci a consumo continuano ad accumularsi fino alla chiusura del periodo di fatturazione.

`usage` legge il consumo del progetto collegato (o `--project`) in un mese solare,
in formato UTC: richieste rispetto alla soglia inclusa, errori 5xx, il consumo extra
finora in euro e, per il mese in corso, la stima dell'andamento a questo
ritmo. L'eccedenza è calcolata dal report sull'overage,
lo stesso che indica a Stripe l'importo da fatturare, addebitato nella fattura del mese successivo.
`usage org` elenca ogni progetto dell'organizzazione selezionata con `rebase cloud
use`, insieme al totale complessivo. Qualsiasi membro dell'organizzazione può visualizzarlo. Un token lo legge
con la capability `logs` sul progetto; `usage org` elenca i progetti su cui il
token dispone di tale permesso.
`--month` accetta un mese passato. La risposta include dei `caveats`, ciascuno contrassegnato da un `code`: `storage_not_measured`
(l'object storage restituisce 0), `multi_pod_undercount` (le richieste gestite quando sono attivi due o
più pod applicativi non vengono conteggiate), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
progetto riscattato da un agente conteggia solo i giorni a partire dal riscatto) e
`autoscale_not_charged` (i pod sono stati eseguiti oltre `--replicas` e questa piattaforma non
applica ancora costi aggiuntivi). La risposta per un progetto con scalabilità automatica include anche `autoscale`:
`extraPodSeconds` al di sopra della base, `amountEur` secondo le relative tariffe e `charged`.

## Deploy hooks, alerts and the rest

```bash
rebase cloud deploy-hooks [list] | create [--name <name>] [--branch <branch>] | revoke <id>   # secret URLs a git host or CI calls to deploy
rebase cloud alerts [list] [--all] | ack <id> | snooze <id> --hours <1-168>   # the project's incidents
rebase cloud deploy --git [<branch>]     # build on the control plane from the connected repository
rebase cloud metrics --runtime           # requests, errors and latency, per surface
rebase cloud metrics --history [--series cpu_millicores|memory_bytes|event_loop_delay_ms] [--minutes <n>]
rebase cloud domains primary <domain>    # make a verified domain the canonical one
rebase cloud domains redirect <domain> [--off]   # answer it with a 308 to the primary, path and query kept
rebase cloud settings set --studio on|off
rebase cloud orgs rename <name> [--slug <slug>]
rebase cloud orgs delete                 # refused while the organization has projects
rebase cloud billing email <address>     # where invoices go
rebase cloud clusters baseline <id> [--install]   # platform admins
```

`domains redirect` è configurato per singolo dominio ed è disattivato per impostazione predefinita, consentendo a un progetto che gestisce un host `api.` accanto al sito principale di mantenerli entrambi; ha effetto quando il dominio è verificato e un altro è impostato come primario, e non si applica mai a un dominio su cui è servita un'app. `deploy-hooks create` stampa l'URL dell'hook una sola volta. `deploy --git` non può essere combinato con i flag di una build locale e, sul runtime gestito, richiede `--eject`, poiché il control plane compila a partire dai sorgenti. `settings set --studio` è l'opzione che i comandi del progetto (`rebase data`, `rebase users`, …) richiedono attiva per `--project`: questi infatti raggiungono l'app tramite il proxy Studio della console. Un comando la cui route del control plane non è ancora distribuita risponde con `not_served` specificandone il nome. I comandi distruttivi richiedono prima conferma e rifiutano l'esecuzione con `confirmation_required` in assenza di interazione: specifica `--yes`.
