---
sourceHash: bd97024430acdcb1
title: rebase cloud
sidebar_label: rebase cloud
description: I gruppi di comandi per Rebase Cloud nella CLI — auth, collegamento del progetto, deploy, notifiche, configurazione, organizzazioni, database, risorse, calcolo, archiviazione, cluster, fatturazione e utilizzo.
---

Tutto ciò che riguarda Rebase Cloud, attualmente in beta privata. Consulta la
[guida a Rebase Cloud](/docs/deployment/cloud/) per scoprire di cosa si tratta e cosa la beta
non include.

Ogni gruppo risponde a `--help`, e `--help` non esegue mai il comando. La maggior parte dei comandi
agisce sul progetto collegato in `.rebase/cloud.json`; `--project <id>` opera su
un progetto senza collegarlo.

Tre opzioni si applicano ovunque: `--json` per l'output leggibile da macchina (anche il
default quando reindirizzato tramite pipe, ad eccezione di `deploy`, o con `REBASE_JSON=1`), `--url <origin>` per indirizzarsi a un
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
`notifications` su una singola organizzazione: `--org`, altrimenti l'organizzazione del progetto,
altrimenti quella selezionata. Un token può contenere solo capability a livello di organizzazione.
`logs` copre anche `usage`. Ciò a cui ciascuna ha accesso è descritto in
[CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents). Quando il control
plane contrassegna una risposta a un token come deprecata (un token precedente all'introduzione di `billing`
che legge la fatturazione), la CLI stampa l'avviso una sola volta su stderr, mai nel
valore `--json`.

Senza flag, `login` effettua l'accesso tramite il browser. Stampa un codice breve e
un link alla console, apre il browser e attende mentre approvi l'accesso
lì. Se hai già effettuato l'accesso alla console, o accedi con
qualsiasi metodo disponibile (password, Google, GitHub, LinkedIn). Verifica che il
browser mostri lo stesso codice prima di approvarlo. Il link scade dopo dieci
minuti e funziona una sola volta. Senza un terminale, o con `--json`, il link e il codice
vengono inviati a stderr e `login` continua ad attendere, in modo che un agente possa passarti il link. Un
accesso rifiutato termina con `access_denied`, uno scaduto con `expired_token`.

Con `--email`, `login` chiede se utilizzare la password o un codice inviato via email dal
control plane. Con l'autenticazione a due fattori abilitata, chiede poi il codice
dell'app di autenticazione (o un codice di recupero); tramite browser, approva da una
sessione della console in cui è stata utilizzata. Senza un terminale nessuno dei due codici può essere digitato: imposta
`REBASE_TOKEN` con un access token generato nella console in Settings → Access
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
`.env`. Eseguirlo nuovamente è sicuro. `--name` assegna un nome all'istanza, `--org` seleziona
l'organizzazione, `--no-wait` ritorna senza attendere. Riservato a owner e admin.

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
in 41h`). `--open` lo apre anche in un browser. Il link è conservato solo sulla
macchina che ha eseguito `init --claim`, in `~/.rebase/credentials.json`; il control
plane ne memorizza un hash e non può stamparlo di nuovo. Prima di rispondere, `claim`
chiede al control plane se il token del progetto è ancora valido. Il riscatto
revoca tale token, quindi una volta che qualcuno ha riscattato il progetto, `claim` rifiuta
l'operazione con `already_claimed` invece di stampare un link non più valido. Rifiuta inoltre una volta terminata la
finestra temporale (`claim_expired`), e in una directory priva di un link di riscatto
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

`deploy` senza il nome di un'app esegue il deploy del backend. Il deploy di un
bundle di backend carica anche il codice sorgente del progetto — ciò che git traccia, mai un file `.env` — affinché un
aggiornamento della piattaforma possa ricompilarlo; `--no-source` salta questa operazione per una volta, e `cloud settings set
--platform-rebuilds off` la disattiva ed elimina la copia archiviata. `--allow-downgrade` esegue il deploy di una release precedente.

Un `deploy` seguito termina con un riepilogo: ogni app distribuita con il rispettivo URL, l'ID
del deployment, il tempo impiegato e se la nuova versione risponde a quell'indirizzo.
Attende fino a `--live-timeout` secondi (default 60; `0` salta il controllo) che l'endpoint
`/health` del backend e l'indirizzo di ciascuna app statica rispondano. Un deploy non riuscito
termina con una singola riga che indica l'app e il motivo, ed esce con codice diverso da zero. Il riepilogo
viene stampato anche tramite pipe; `--json` (o `REBASE_JSON=1`) stampa invece un singolo oggetto,
con `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

Prima del caricamento, `deploy` analizza il JavaScript di ogni app statica che distribuisce:
i file `.js`/`.mjs`/`.cjs` nel suo `output` e i blocchi `<script>` inline nel
suo HTML. Un errore di sintassi interrompe il deploy indicando `file:line:column` (codice
`syntax_error` con `--json`), mentre `--no-verify` salta la verifica. Un deploy
completato con successo indica la procedura di ripristino, `rebase cloud rollback`. Un'app statica distribuita
singolarmente non può ancora essere ripristinata; consulta
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` rende disponibile la build all'indirizzo `https://<project>--<name>.rebase.website` e
non tocca la produzione. Una preview del backend esegue una propria istanza di backend, su un
proprio database vuoto, integrando le sue app statiche. Un'app statica non può ancora
essere visualizzata in anteprima singolarmente su Rebase Cloud: `rebase cloud deploy <app> --preview`
viene rifiutato con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Una preview
del backend viene fatturata come un'unità applicativa aggiuntiva di dimensioni predefinite per tutta la sua durata, e
il deploy indica a quanto ammonta al mese in base al preventivo del control plane
(`cost` con `--json`; solo la regola e questo link quando il control plane non è in grado di
calcolarne il prezzo); `rebase cloud previews delete <name>` la arresta. `rebase cloud previews`
mostra una preview che la piattaforma ha sospeso (il relativo database ha superato il limite previsto per le preview) come
`paused`, specificandone il motivo (`statusMessage` con `--json`). Un nuovo indirizzo di preview
può essere rifiutato con `preview_cert_budget` quando il budget settimanale di certificati di preview della
piattaforma è esaurito; il messaggio specifica fino a quando.
Consulta [Anteprima di una modifica](/docs/deployment/cloud/#preview-a-change).

### Log

`rebase cloud logs` stampa il log di build più recente, mentre `-f` segue in tempo reale una build
ancora in esecuzione. `--runtime` legge invece l'output stampato dall'applicazione, da ciascun pod
sottostante, con ogni riga associata al rispettivo pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` accetta una durata (`30s`, `5m`, `1h`) o un timestamp RFC3339.
- `--tail <n>` indica il numero di righe per pod da cui iniziare (il control plane le limita a un massimo di 2000).
- `--grep` mantiene le righe che contengono il testo specificato, senza distinzione tra maiuscole e minuscole; usa `/re/flags` per un'espressione regolare.
- Con `--grep` o `--level`, il filtro esamina ogni riga restituita dal control plane
  per la finestra temporale (le 2000 più recenti per ciascun pod), e `--tail` conta le righe
  corrispondenti: le `n` corrispondenze più recenti per pod, 500 per impostazione predefinita. Quando un pod presenta più
  righe nella finestra rispetto a tale soglia, l'output segnala che le più vecchie non sono state
  esaminate (`filter.scanCapped` con `--json`).
- `--level error|warn|info|debug` mantiene le righe con tale gravità o superiore. Legge
  il campo strutturato `severity` registrato da un backend Rebase, una parola che indica il livello all'inizio di una
  riga di testo normale o un formato di errore come `TypeError:`. Le righe che non ne contengono alcuno vengono escluse.

Il comando in modalità follow esegue il polling ogni due secondi e stampa ciascuna riga una sola volta. Segnala i pod
che si avviano, si arrestano o si riavviano. Quando un container si riavvia, stampa anche le ultime
righe dell'istanza terminata, dove solitamente si trova la causa del problema. Rimane in attesa quando non vi è alcun
pod in esecuzione e, in caso di connessione interrotta, tenta nuovamente con backoff
riprendendo da dove si era interrotto. Con `--json`, il follow stampa un oggetto JSON per
riga (NDJSON): `{"type":"line","ts","pod","text"}` per ciascuna riga di log, e
`{"type":"event","event":…}` per il resto.

`--preview <name>` legge i log di una preview anziché della produzione. Usa il nome
della preview o l'ID di deployment stampato dal deploy di preview. Da solo, `--preview`
legge l'unica preview del progetto. Una preview statica dispone di un log di build ma non
di un log di runtime, poiché non esegue alcun server.

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
`REBASE_API_TOKEN`, mostrandone il prefisso e mai il valore intero. Il riscatto del progetto
trasferisce tale chiave, che cessa di avere una scadenza. `app-key rotate` ne genera una nuova e
revoca contemporaneamente tutte le chiavi degli agenti precedenti. Scrive la nuova chiave in un file `.env`
che contiene già `REBASE_API_TOKEN`, escludendola dall'output `--json` in quel contesto. In
qualsiasi altra directory stampa la chiave una sola volta. Le chiavi create nel pannello di amministrazione dell'app
non vengono toccate. Viene eseguito con le tue credenziali di accesso: nessuna capability del token consente di concederlo.

`service-key`
stampa la generazione di `REBASE_SERVICE_KEY` del progetto, la data dell'ultima
rotazione e se l'app è ancora in fase di riavvio sulla chiave più recente. Non stampa
mai la chiave: per farlo si usa `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emette una nuova chiave e riavvia l'app su di essa. La vecchia chiave rimane valida fino al
termine del riavvio, dopodiché cessa di funzionare. L'operazione viene rifiutata durante un deploy
in corso e viene eseguita con le tue credenziali di accesso. Anche il riscatto di un progetto ruota la sua service
key.

Una preview del backend eredita le variabili della produzione, incluse le chiavi di produzione.
`env set KEY=VALUE --preview` assegna alle preview un valore dedicato, `env unset KEY
--preview` esclude la variabile da esse, `env reset KEY --preview` ripristina
il valore di produzione, e `env list --preview` mostra le differenze.
La produzione non viene mai modificata da nessuno di questi comandi.

`env set KEY --stdin` legge il valore dallo standard input anziché dalla
riga di comando, dove `ps` e la cronologia della shell lo renderebbero visibile:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

L'eventuale newline finale viene rimosso. Lo strumento `rebase_cloud_env_set` del server MCP imposta
i valori con questa modalità.

## Organizzazioni

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` crea un invito e ne stampa il relativo link: monouso,
valido per 7 giorni, accettabile solo da un account che ha verificato quell'indirizzo email.
Nessuno entra a far parte dell'organizzazione finché non accetta, compresi gli utenti che possiedono già un account Rebase.
L'output (e `emailDelivery` in `--json`) indica se l'invito è stato inviato via email; in caso
contrario, un avviso suggerisce di inviare il link manualmente. `--role` può essere `admin` o
`member` (default). Nessuno può essere invitato come `owner`: invitalo come admin, e
un owner potrà promuoverlo con `members role <email> owner` una volta completata l'adesione.
`invites resend` genera un nuovo link e rende non valido quello precedente.
L'invio di inviti e i comandi `invites` richiedono una sessione `rebase cloud login`; `REBASE_TOKEN` viene
rifiutato. L'invito, l'elenco, il reinvio e la revoca richiedono il ruolo di
owner o admin; in caso contrario, ai membri viene segnalata l'assenza dei permessi necessari.
`members remove` chiede conferma prima di procedere (`--yes` la ignora); la rimozione o il declassamento di un owner
richiede il ruolo di owner, e l'ultimo owner rimasto non può essere rimosso. `--org <id>` seleziona un'organizzazione
diversa da quella attiva.

`activity` è l'audit log dell'organizzazione selezionata, ordinato dal più recente: chi
ha eseguito un deploy, un rollback, impostato, eliminato o visualizzato una variabile d'ambiente (per
nome, mai per valore), modificato un dominio, creato, ripristinato o scaricato un
backup, modificato le risorse di calcolo di un progetto, arrestato o eliminato un progetto, modificato il
ruolo di un membro, o creato o revocato un access token. `--action` accetta un'area
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o un'azione completa
come `env.set`. Una pagina contiene fino a 100 voci (`--limit`, default 50);
l'output stampa il cursore `--before` per la pagina successiva. `--json` restituisce un singolo valore,
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

`db connect` apre una porta locale che *rappresenta* il database gestito (nessun endpoint
pubblico) fino alla pressione di Ctrl-C; `--reveal` aggiunge la password. Solo per owner o admin.

## Ospiti

Ogni chiamata a `signInAnonymously()` effettuata durante un test, da un bot o in una sessione abbandonata lascia una riga
tra gli utenti del progetto. Questi comandi contano tali righe e le rimuovono, evitando
di doverle eliminare manualmente una per una.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` accetta un intervallo di tempo con unità di misura: `45m`, `12h`, `30d` o `2w`. Senza `--yes` si limita
a contare senza eliminare nulla. Elabora progetti di qualsiasi dimensione suddividendo l'operazione in piccoli
batch.

Possono essere rimossi soltanto gli ospiti. Un ospite è una riga con `is_anonymous` impostato, senza password e senza
identità collegata; l'applicazione applica questa regola nell'istruzione di eliminazione della
riga, pertanto il comando non può interessare un account reale, nemmeno se registrato un istante
dopo essere stato elencato. `delete` rifiuta un account restituendo `NOT_ANONYMOUS`.

**Last seen** indica l'ultimo momento in cui la sessione dell'ospite è stata emessa o aggiornata, oppure quando
l'ospite è stato creato se non ha più alcun refresh token. Un ospite che continua ad accedere
non viene considerato obsoleto, indipendentemente dalla data di creazione. I refresh token di un
ospite eliminato e qualsiasi altra riga di autenticazione collegata vengono eliminati insieme ad esso.

Le righe nelle tue tabelle seguono la rispettiva foreign key:

| Colonna | Cosa accade alla riga |
|---|---|
| Collegamento opzionale (`ON DELETE SET NULL`, predefinito) | Mantenuta, con il collegamento azzerato |
| Collegamento obbligatorio (`ON DELETE RESTRICT`, predefinito) | Mantenuta, insieme all'ospite: l'ospite viene segnalato come ignorato, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Eliminata insieme all'ospite |
| Nessuna foreign key (un campo `userSelect`, un semplice id) | Mantenuta, contenente un ID non più esistente |

Verifica quali collegamenti applicano l'eliminazione a cascata prima di specificare `--yes`: l'operazione non può essere annullata.

Il comando passa attraverso il proxy Studio della console, che custodisce la chiave dell'app, evitando che quest'ultima raggiunga la tua
macchina. Richiede il ruolo di owner o admin dell'organizzazione, su un progetto con accesso Studio abilitato
(`rebase cloud settings set --studio on`). Ai progetti che utilizzano un runtime obsoleto viene segnalata la necessità di un aggiornamento.
`rebase users guests --project <slug>` è il comando equivalente nella famiglia dei progetti.

## Risorse

Ciò che la piattaforma gestisce per il progetto, a confronto con quanto dichiarato nel codice.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un deploy non rimuove mai un database sottoposto a provisioning quando la sua dichiarazione viene rimossa: ciò
comporterebbe l'eliminazione di dati a seguito di un push. Il database viene mantenuto, collegato e fatturato fino a quando
qualcuno non lo elimina esplicitamente specificandone il nome.

## Calcolo

Ciò che il progetto riserva e i relativi costi.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accetta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
`--scale-to-zero` è deprecato: ogni backend esegue almeno un'istanza, pertanto
`true` viene rifiutato e `false` viene ignorato con un avviso. Non sono previsti piani
a livelli: ogni elemento viene tariffato in base alle risorse utilizzate. Consulta
[Rebase Cloud](/docs/deployment/cloud/).

## Archiviazione, notifiche, cluster, fatturazione e utilizzo

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
accetta un elenco separato da virgole di `deploy.failed` (default),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` e `preview.paused`. `--format slack` invia
solo `{ "text" }` invece del JSON dell'evento, che contiene anch'esso un campo `text`. L'URL
è un argomento posizionale poiché `--url` fa riferimento al control plane. `add` stampa
il segreto di firma una sola volta; `--json` restituisce `{ projectId, webhook, secret }`.
`test <id>` esce con codice 1 e stato `delivery_failed` se il destinatario non ha accettato
l'evento di test. La visualizzazione dell'elenco è accessibile a qualsiasi membro dell'organizzazione; `add`, `test`
e `remove` richiedono il ruolo di owner o admin. Un token può gestirli tramite la
capability `notifications` sull'organizzazione, nel rispetto delle medesime regole sui ruoli. Consulta
[Notifiche Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` assegna al cluster
di un cliente un proprio registro di immagini, utilizzato esclusivamente per quel cluster. In assenza
di esso, il cluster si appoggia al registro condiviso della piattaforma, e ogni deploy eseguito su di esso
lo segnala nel log. Configurandone uno, le build eseguono il push su quel repository mediante un token per
tale account, i pod effettuano il pull esclusivamente con quella chiave e un rollback accetta le
immagini del progetto presenti lì. Le immagini
create in precedenza dal progetto nel registro condiviso restano disponibili per il pull e
come target di rollback. I tre valori devono essere indicati insieme; `--clear` li rimuove. La chiave
viene protetta (sealed) al momento della scrittura e non viene mai riletta. Come per il resto dei comandi di `clusters`,
è richiesto il ruolo di platform-admin. L'operatore crea il repository ed entrambi
gli account tramite Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` e `billing upcoming` leggono gli stessi dati Stripe disponibili nella pagina
Billing della console e sono accessibili esclusivamente agli owner e agli admin dell'organizzazione.
Un token può accedervi, così come al resto di `billing`, mediante la capability `billing`
sull'organizzazione; un token creato prima dell'introduzione di tale capability continua a
funzionare per una release, mostrando un avviso a ogni risposta. Gli importi in `--json` sono espressi nell'unità frazionaria della valuta (centesimi), esattamente come
inviati da Stripe. Le fatture in bozza non vengono elencate; la preview viene calcolata da
Stripe e le voci a consumo continuano a incrementarsi fino alla chiusura del periodo di fatturazione.

`usage` rileva quanto consumato dal progetto collegato (o indicato con `--project`) in un mese
solare, in formato UTC: richieste rispetto alla soglia inclusa, errori 5xx, l'eccedenza
maturata finora in euro e, per il mese in corso, la stima dell'andamento a questo
ritmo. L'eccedenza corrisponde al calcolo effettuato dal report di consumo, lo stesso
che indica a Stripe l'importo da fatturare e che verrà addebitato nella fattura del mese successivo.
`usage org` elenca ciascun progetto dell'organizzazione selezionata con `rebase cloud
use`, con il totale complessivo. Qualsiasi membro dell'organizzazione può visualizzarlo. Un token può leggerlo
con la capability `logs` sul progetto; `usage org` elenca i progetti per i quali il
token dispone di tale permesso.
`--month` accetta un mese trascorso. La risposta include una serie di `caveats`, ciascuno con un `code`: `storage_not_measured`
(l'object storage restituisce 0), `multi_pod_undercount` (le richieste gestite durante l'esecuzione di due o
più pod dell'app non vengono conteggiate), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (per un
progetto riscattato da un agente vengono conteggiati solo i giorni successivi al riscatto) e
`autoscale_not_charged` (i pod sono stati eseguiti oltre `--replicas` e la piattaforma non
li fattura ancora). La risposta relativa a un progetto con autoscaling include inoltre il campo `autoscale`:
`extraPodSeconds` oltre la soglia base, `amountEur` in base alle tariffe applicate e `charged`.

## Deploy hook, avvisi e altri comandi

<span class="since-badge" data-since="0.32">Dalla versione 0.32</span>

```bash
rebase cloud deploy-hooks [list] | create [--name <name>] [--branch <branch>] | revoke <id>   # secret URLs a git host or CI calls to deploy
rebase cloud alerts [list] [--all] | ack <id> | snooze <id> --hours <1-168>   # the project's incidents
rebase cloud deploy --git [<branch>]     # build on the control plane from the connected repository
rebase cloud metrics --runtime           # requests, errors and latency, per surface
rebase cloud metrics --history [--series cpu_millicores|memory_bytes|event_loop_delay_ms] [--minutes <n>]
rebase cloud domains primary <domain>    # make a verified domain the canonical one
rebase cloud settings set --studio on|off
rebase cloud orgs rename <name> [--slug <slug>]
rebase cloud orgs delete                 # refused while the organization has projects
rebase cloud billing email <address>     # where invoices go
rebase cloud clusters baseline <id> [--install]   # platform admins
```

`deploy-hooks create` stampa l'URL dell'hook una sola volta. `deploy --git` non può essere combinato con i flag di una build locale e, sul runtime gestito, richiede `--eject`, poiché il control plane compila dal codice sorgente. `settings set --studio` è l'impostazione che i comandi di progetto (`rebase data`, `rebase users`, …) richiedono abilitata per `--project`: essi raggiungono l'app tramite il proxy Studio della console. Un comando la cui route del control plane non è ancora disponibile risponde con `not_served` indicandone il nome. I comandi distruttivi chiedono prima conferma e rifiutano l'esecuzione con `confirmation_required` in assenza di interazione: specifica `--yes`.
