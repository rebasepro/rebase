---
sourceHash: 5e278801233fce19
title: rebase cloud
sidebar_label: rebase cloud
description: I gruppi di comandi per Rebase Cloud nella CLI — auth, project link, deploy, notifiche, configurazione, organizzazioni, database, risorse, calcolo, storage, cluster, fatturazione e utilizzo.
---

Tutto ciò che riguarda Rebase Cloud, attualmente in beta privata. Consulta la
[guida a Rebase Cloud](/docs/deployment/cloud/) per scoprire di cosa si tratta e cosa non è incluso
nella beta.

Ogni gruppo risponde a `--help`, e `--help` non esegue mai il comando. La maggior parte dei comandi
agisce sul progetto collegato in `.rebase/cloud.json`; `--project <id>` opera su
un progetto senza collegarlo.

Tre opzioni si applicano ovunque: `--json` per output machine-readable (anche il
valore predefinito quando reindirizzato tramite pipe, ad eccezione di `deploy`, o con `REBASE_JSON=1`), `--url <origin>` per indirizzare un
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
plane contrassegna una risposta a un token come deprecata (un token precedente a `billing`
che legge la fatturazione), la CLI stampa l'avviso una sola volta su stderr, mai nel
valore `--json`.

Senza flag, `login` effettua l'accesso tramite il browser. Stampa un codice breve e
un link alla console, apre il browser e attende mentre approvi
l'accesso lì. Se hai già effettuato l'accesso alla console, o accedi con
qualsiasi metodo disponibile (password, Google, GitHub, LinkedIn). Verifica che il
browser mostri lo stesso codice prima di approvarlo. Il link scade dopo dieci
minuti e funziona una sola volta. Senza un terminale, o con `--json`, il link e il codice
vengono inviati a stderr e `login` continua ad attendere, consentendo a un agente di passarti il link. Un
accesso rifiutato termina con `access_denied`, uno scaduto con `expired_token`.

Con `--email`, `login` chiede se utilizzare la password o un codice inviato via email dal control
plane. Con l'autenticazione a due fattori attiva, richiede quindi il codice
dell'authenticator (o un codice di recupero); tramite browser, approva da una
sessione della console che l'ha utilizzata. Senza un terminale non è possibile digitare alcun codice: imposta
`REBASE_TOKEN` su un token di accesso creato nella console in Settings → Access
tokens. Consulta [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Collegamento del progetto

```bash
rebase cloud link         # link this directory to a cloud project (picked from a list)
rebase cloud link <slug>  # link the project with that slug or id, as --project <slug> does
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

I comandi dell'organizzazione (`orgs`, `billing`, `usage org`, `activity`,
`projects create`, `tokens create --can billing`) agiscono su `--org <id>`, altrimenti
sull'organizzazione selezionata con `cloud use`, altrimenti sull'organizzazione del progetto collegato. In
quest'ultimo caso indicano quale hanno utilizzato. `orgs delete` non la rileva mai
dal collegamento: richiede `--org` o un'organizzazione selezionata.

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
l'organizzazione, `--no-wait` ritorna senza attendere. Proprietari e amministratori.

## Progetti

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects list --all-orgs   # every organization you belong to
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects transfer [id] --to-org <id|slug>
rebase cloud projects delete [id]
```

`claim` stampa il link di riscatto del progetto sottoposto a provisioning da `init --claim` in questa
directory, insieme al tempo rimanente prima che venga eliminato se non riscattato (`Unclaimed: deleted
in 41h`). `--open` lo apre anche in un browser. Il link è memorizzato solo sulla
macchina che ha eseguito `init --claim`, in `~/.rebase/credentials.json`; il control
plane ne memorizza un hash e non può stamparlo di nuovo. Prima di rispondere, `claim`
chiede al control plane se il token del progetto è ancora valido. Un riscatto
revoca tale token, quindi una volta che qualcuno ha riscattato il progetto, `claim` rifiuta
con `already_claimed` invece di stampare un link inattivo. Rifiuta inoltre una volta terminata la
finestra temporale (`claim_expired`), e in una directory priva di un link di riscatto
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` mostrano lo stesso
link finché il progetto non viene riscattato.

`projects transfer` sposta un progetto in un'altra organizzazione senza modifiche:
stesso id, indirizzo, domini personalizzati, database, storage, variabili d'ambiente e
deploy. Cambiano solo chi ne è proprietario, chi può vederlo e chi paga per esso. È
necessario essere proprietario o amministratore di entrambe le organizzazioni e aver effettuato l'accesso con `rebase cloud login`;
un token di accesso non può spostare un progetto. La destinazione verrà fatturata da quel momento in poi,
quindi una senza carta registrata (e non fatturata internamente) rifiuterà il trasferimento e
non cambierà nulla. Un progetto ancora in attesa di essere riscattato viene invece spostato tramite il suo link di riscatto.
La console dispone della stessa azione in Settings del progetto, nella
danger zone.

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

`deploy` senza nome dell'app distribuisce il backend. Un deploy del bundle
di backend carica anche il codice sorgente del progetto — ciò che git traccia, mai un file `.env` — in modo che un
aggiornamento della piattaforma possa ricompilarlo; `--no-source` salta questa operazione una volta, e `cloud settings set
--platform-rebuilds off` la interrompe ed elimina la copia memorizzata. `--allow-downgrade` distribuisce una release precedente.

Un aggiornamento della piattaforma può ricompilare un'app gestita su una release di `@rebasepro` più recente
rispetto a quella bloccata nel checkout. Un deploy da quel checkout ripristinerebbe il pannello di
amministrazione e il driver meno recenti, pertanto viene rifiutato prima di compilare qualsiasi cosa, indicando il
comando per risolvere il problema (`rebase upgrade --to <version>`). `rebase cloud status`
segnala la stessa cosa in anticipo: una riga `Rebuilt on` e, in `--json`,
`runtime.platformRebuiltVersion` e `frameworkDrift`.

Un `deploy` seguito termina con un riepilogo: ciascuna app rilasciata con il relativo URL, l'id
del deployment, il tempo impiegato e se la nuova versione risponde a quell'indirizzo. Attende
fino a `--live-timeout` secondi (impostazione predefinita 60; `0` salta il controllo) che l'endpoint `/health`
del backend e l'indirizzo di ciascuna app statica rispondano. Un deploy non riuscito
termina con una singola riga che indica l'app e il motivo, e restituisce un codice di uscita diverso da zero. Il riepilogo
viene stampato anche quando reindirizzato via pipe; `--json` (o `REBASE_JSON=1`) stampa invece un singolo oggetto,
con `apps`, `hosts`, `live`, `liveChecks` e `durationMs`. Un host il cui certificato HTTPS
non è ancora stato emesso viene segnalato come non live, con la relativa motivazione.

Prima dell'upload, `deploy` analizza il codice JavaScript di ogni app statica che distribuisce:
i file `.js`/`.mjs`/`.cjs` nel relativo `output` e i blocchi `<script>` inline
nel relativo codice HTML. Un errore di sintassi interrompe il deploy con `file:line:column` (codice
`syntax_error` sotto `--json`), e `--no-verify` ignora il controllo. Un deploy completato con successo
termina indicando la procedura di ripristino, `rebase cloud rollback`. Un'app statica distribuita
autonomamente non può ancora essere ripristinata; consulta
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` serve la build all'indirizzo `https://<project>--<name>.rebase.website` e
lascia inalterata la produzione. Una preview del backend esegue una propria istanza di backend, su un
proprio database vuoto, integrando le sue app statiche. Un'app statica non può ancora essere
visualizzata in anteprima da sola su Rebase Cloud: `rebase cloud deploy <app> --preview`
viene rifiutato con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Una preview
del backend viene fatturata come un'ulteriore unità app con dimensione predefinita per tutto il tempo in cui esiste, e
il deploy indica a quanto ammonta mensilmente in base alla quotazione del control plane
(`cost` sotto `--json`; solo la regola e questo link se il control plane non è in grado di
calcolarne il prezzo); `rebase cloud previews delete <name>` la arresta. `rebase cloud previews`
mostra una preview che la piattaforma ha sospeso (il database ha superato il limite previsto per le preview) come
`paused`, con la relativa motivazione (`statusMessage` sotto `--json`). Un nuovo indirizzo di preview
può essere rifiutato con `preview_cert_budget` quando il budget settimanale di certificati di
preview della piattaforma è esaurito; il messaggio indica fino a quando.
Consulta [Anteprima di una modifica](/docs/deployment/cloud/#preview-a-change).

### Log

`rebase cloud logs` stampa il log di build più recente, e `-f` segue in tempo reale una build
ancora in esecuzione. `--runtime` legge invece quanto stampato dall'app, da ciascun pod
sottostante, con ogni riga contrassegnata dal relativo pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` accetta una durata (`30s`, `5m`, `1h`) o un timestamp RFC3339.
- `--tail <n>` indica il numero di righe per pod da cui partire (il control plane le limita a 2000).
- `--grep` mantiene le righe contenenti il testo, senza distinzione tra maiuscole e minuscole; specifica `/re/flags` per un'espressione
  regolare.
- Con `--grep` o `--level`, il filtro esamina ogni riga restituita dal control plane
  nella finestra temporale (le 2000 più recenti di ciascun pod), e `--tail` conta le righe
  corrispondenti: le `n` corrispondenze più recenti per pod, 500 per impostazione predefinita. Quando un pod presenta più
  righe nella finestra rispetto a tale valore, l'output segnala che quelle meno recenti non sono state
  esaminate (`filter.scanCapped` sotto `--json`).
- `--level error|warn|info|debug` mantiene le righe con tale gravità o superiore. Legge
  il campo strutturato `severity` registrato da un backend Rebase, una parola indicante il livello all'inizio di una
  riga di testo normale o un pattern di errore come `TypeError:`. Le righe prive di questi elementi vengono escluse.

Un comando di follow esegue il polling ogni due secondi e stampa ciascuna riga una volta sola. Notifica i pod
che si avviano, si arrestano o si riavviano. Quando un container si riavvia, stampa anche le ultime
righe dell'istanza terminata, dove di solito si trova il motivo. Rimane in attesa se nessun
pod è in esecuzione, e dopo una disconnessione riprova con backoff e
riprende da dove si era interrotto. Con `--json`, il follow stampa un oggetto JSON per
riga (NDJSON): `{"type":"line","ts","pod","text"}` per ciascuna riga di log e
`{"type":"event","event":…}` per il resto.

`--preview <name>` legge una preview anziché la produzione. Usa il nome
della preview o l'id di deployment stampato dal deploy della preview. Da solo, `--preview`
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
rebase cloud service-key [rotate] --preview <name>  # a backend preview's own key
```

`domains add` per un host già presente nel progetto, come uno registrato da un deploy
a partire da `rebase.json`, stampa i record DNS e lo stato dell'host come farebbe una
nuova aggiunta; `--json` aggiunge `alreadyRegistered: true`. Un host verificato viene
servito tramite HTTPS una volta emesso il relativo certificato, pochi minuti dopo
la verifica. Fino ad allora l'ingress risponde con un certificato segnaposto,
e `domains list`, `domains verify` e `status` indicano
`verified, certificate pending` anziché live. La CLI rileva questo stato eseguendo
un handshake TLS verso ciascun host verificato; `--json` lo riporta come `certificate`
(`ready`, `pending` o `unreachable`, con un `reason`).

`app-key` elenca la
chiave generata da `rebase cloud init --claim` sull'app e salvata in `.env` come
`REBASE_API_TOKEN`, tramite il suo prefisso e mai tramite il suo valore. Il riscatto del progetto
trasferisce tale chiave, che cessa di avere una scadenza. `app-key rotate` ne genera una nuova e
revoca contemporaneamente tutte le chiavi agent precedenti. Scrive la nuova chiave in un file `.env`
che contiene già `REBASE_API_TOKEN`, escludendola da `--json` in quel contesto. In
qualsiasi altra directory stampa la chiave una sola volta. Le chiavi create nel pannello di amministrazione dell'app
non vengono modificate. Viene eseguito con la tua sessione di login: nessuna capability di token lo autorizza.

`service-key`
stampa la generazione di `REBASE_SERVICE_KEY` del progetto, quando è stata ruotata
l'ultima volta e se l'app è ancora in fase di riavvio verso quella più recente. Non stampa
mai la chiave: per farlo si usa `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emette una nuova chiave e riavvia l'app con essa. La vecchia chiave rimane valida fino al
termine del riavvio, dopodiché cessa di funzionare. L'operazione viene rifiutata durante un deploy in
corso e richiede la tua sessione di login. Anche riscattare un progetto comporta la rotazione della sua service
key.

Una preview del backend dispone di una propria service key. Il suo primo deploy la genera,
i successivi deploy la mantengono e la chiave di produzione restituisce 401 sulla preview.
`service-key --preview <name>` la stampa, così come `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
ne genera una nuova e riavvia solo il pod di quella preview; la vecchia chiave funziona fino a quando
il nuovo pod non è pronto. Richiede una conferma preventiva, e `--yes` salta la richiesta. Entrambi richiedono
gli stessi permessi di `env reveal`: il ruolo di owner o admin dell'organizzazione, e per un
token di accesso la capability `env` su un progetto riscattato. La chiave e il
pod di produzione non vengono toccati.

Una preview del backend parte dalle variabili di produzione, incluse le chiavi live.
`env set KEY=VALUE --preview` assegna alle preview un proprio valore, `env unset KEY
--preview` esclude la variabile da esse, `env reset KEY --preview` ripristina
il valore di produzione e `env list --preview` mostra le differenze.
Nessuno di questi comandi modifica mai l'ambiente di produzione.

`env set KEY --stdin` legge il valore dallo standard input anziché dalla
riga di comando, dove `ps` e la cronologia della shell lo renderebbero visibile:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

L'eventuale carattere di nuova riga finale viene rimosso. Il comando `rebase_cloud_env_set` del server MCP imposta
i valori in questo modo.

`env set KEY --prompt` richiede il valore tramite un prompt nascosto nel terminale.
Non viene mostrato nulla a schermo e il valore viene memorizzato come secret, come con `--stdin
--secret`. Un agente può fornirti il comando da eseguire, così il valore non passa
mai attraverso la chat. Senza un terminale l'operazione viene rifiutata (`input_required`), indicando
di usare `--stdin`.

## Organizzazioni

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite <email>` aggiunge un utente che possiede già un account Rebase con un
indirizzo email verificato, esattamente come l'opzione Add member della console. L'utente ottiene l'accesso
immediatamente e non viene inviata alcuna email. Rebase Cloud non supporta ancora l'invio di inviti, quindi una
persona sprovvista di account non riceve alcun link: il comando rifiuta l'operazione con `no_account` e
richiede di far registrare prima l'utente per poi eseguire nuovamente il comando. Un control plane che
gestisce gli inviti ne crea invece uno e ne stampa il link (monouso, valido per 7
giorni, accettabile solo da un account che ha verificato quell'indirizzo); `invites`
elenca, revoca e reinvia tali inviti, rispondendo con `not_served` negli altri casi.
`--role` può essere `admin` o `member` (predefinito). Nessuno viene aggiunto come `owner`: aggiungilo
come admin, e un owner potrà promuoverlo con `members role <email> owner`.
L'aggiunta di membri e `invites` richiedono una sessione `rebase cloud login`;
`REBASE_TOKEN` viene rifiutato. Entrambi richiedono il ruolo di owner o admin; un member riceve una
notifica in merito.
`members remove` richiede conferma preventiva (`--yes` salta la richiesta); la rimozione o il declassamento di un owner
richiede un owner, e l'ultimo owner non può essere rimosso. `--org <id>` consente di selezionare un'organizzazione
diversa da quella attualmente selezionata.

`activity` è l'audit log dell'organizzazione selezionata, in ordine dal più recente: chi
ha eseguito un deploy o un rollback, impostato, eliminato o visualizzato una variabile d'ambiente (per
nome, mai per valore), modificato un dominio, creato, ripristinato o scaricato un
backup, modificato le risorse di calcolo di un progetto, arrestato o eliminato un progetto, modificato il
ruolo di un membro, oppure creato o revocato un token di accesso. `--action` accetta un'area
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o un'azione completa
come `env.set`. Una pagina contiene fino a 100 voci (`--limit`, 50 per impostazione predefinita); l'output
stampa il cursore `--before` per la pagina successiva. `--json` restituisce un singolo valore,
`{ org, events, nextCursor }`. Richiede il ruolo di owner o admin dell'organizzazione.
Un token può leggerlo solo disponendo della capability `audit` sull'organizzazione
(`rebase cloud tokens create --can audit`). La pagina **Activity** della console
mostra lo stesso log.

## Database

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` apre una porta locale che *è* il database gestito (senza endpoint
pubblico) fino a Ctrl-C; `--reveal` include la password. Riservato a owner o admin.

## Guest

Ogni `signInAnonymously()` eseguito in un test, da un bot o in una visita abbandonata lascia una riga
tra gli utenti del progetto. Questi comandi contano tali righe e le rimuovono, evitando
di doverle scorrere una per una manualmente.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` accetta un valore temporale con unità di misura: `45m`, `12h`, `30d` o `2w`. Senza `--yes` si limita
a contare senza eliminare nulla. Elabora progetti di qualsiasi dimensione procedendo a piccoli
batch.

Possono essere rimossi solo i guest. Un guest è una riga con `is_anonymous` impostato, nessuna password e nessuna
identità collegata; l'app applica questa regola nell'istruzione di eliminazione della
riga, impedendo al comando di toccare un account reale, anche se registrato un istante
dopo essere stato elencato. `delete` rifiuta un account reale restituendo `NOT_ANONYMOUS`.

**Last seen** indica l'ultimo momento in cui la sessione del guest è stata emessa o aggiornata, oppure la data di
creazione del guest se non è rimasto alcun refresh token. Un guest che continua a ritornare
non è considerato obsoleto, a prescindere da quando è stato creato. I refresh token di un guest
eliminato e qualsiasi altra riga di autenticazione associata vengono rimossi insieme ad esso.

Le righe nelle tue tabelle seguono la propria foreign key:

| La colonna | Cosa succede alla riga |
|---|---|
| Collegamento opzionale (`ON DELETE SET NULL`, il default) | Mantenuta, con il collegamento svuotato |
| Collegamento obbligatorio (`ON DELETE RESTRICT`, il default) | Mantenuta, insieme al guest: il guest viene segnalato come ignorato con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Eliminata insieme al guest |
| Nessuna foreign key (un campo `userSelect`, un semplice id) | Mantenuta, con un id che non esiste più |

Verifica quali dei tuoi collegamenti sono in cascata prima di passare `--yes`: l'operazione non può essere annullata.

Il comando passa attraverso lo Studio proxy della console, che custodisce la chiave dell'app, evitando che arrivi sulla
tua macchina. Richiede un owner o admin dell'organizzazione, su un progetto con l'accesso a Studio attivo
(`rebase cloud settings set --studio on`). Un progetto con un runtime obsoleto riceverà la notifica che è necessario aggiornarlo.
`rebase users guests --project <slug>` è lo stesso comando nella famiglia di comandi del progetto.

## Risorse

Cosa riserva la piattaforma per il progetto, a fronte di quanto dichiarato nel suo codice.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un deploy non rimuove mai un database con provisioning attivo quando la sua dichiarazione viene rimossa: si
tratterebbe di dati cancellati da un push. Continua a mantenerlo, associarlo e fatturarlo finché qualcuno
non esegue il prune indicandone il nome.

## Calcolo (Compute)

Cosa riserva il progetto e quanto costa.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accetta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
`--scale-to-zero` è stato dismesso: ogni backend esegue almeno un'istanza, quindi
`true` viene rifiutato e `false` viene ignorato con un avviso. Non ci sono livelli
di piano: ogni risorsa ha un prezzo a consumo. Consulta
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, notifiche, cluster, fatturazione e utilizzo

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
rebase cloud clusters list | add | verify | registry | open | close   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
rebase cloud billing invoices [--limit N]   # issued invoices, newest first, with Stripe's hosted page
rebase cloud billing upcoming    # a preview of each subscription's next invoice
rebase cloud usage [--month YYYY-MM]   # requests used this month against the allowance, and the overage so far
rebase cloud usage org           # every project of the selected organization, with the total
```

`notifications add <url>` invia gli eventi del progetto collegato a un URL. `--events`
accetta un elenco separato da virgole di `deploy.failed` (il default),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` e `preview.paused`. `--format slack` invia
solo `{ "text" }` anziché il JSON dell'evento, che contiene anch'esso un campo `text`. L'URL
è un argomento posizionale poiché `--url` indica il control plane. `add` stampa
il secret di firma una sola volta; `--json` restituisce `{ projectId, webhook, secret }`.
`test <id>` termina con codice 1 e `delivery_failed` quando il destinatario non ha accettato
l'evento di test. La visualizzazione dell'elenco è aperta a qualsiasi membro dell'organizzazione; `add`, `test`
e `remove` richiedono il ruolo di owner o admin. Un token può gestirli con la
capability `notifications` sull'organizzazione, nel rispetto della stessa regola di ruolo. Consulta
[Notifiche Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` assegna al cluster di proprietà
del cliente un proprio registry di immagini, utilizzato esclusivamente per quel cluster. In assenza
di questo, tale cluster utilizza il registry condiviso della piattaforma e ogni deploy effettuato su di esso
lo segnala nel log. Configurandone uno, le build eseguono il push su quel repository con un token per
quell'account, i pod eseguono il pull esclusivamente con quella chiave e un rollback accetta le
immagini del progetto presenti lì. Le immagini
compilate in precedenza dal progetto nel repository condiviso rimangono disponibili per il pull e utilizzabili
come target di rollback. I tre valori devono essere specificati insieme; `--clear` li rimuove. La chiave
viene protetta al momento della scrittura e non viene mai letta nuovamente. Come il resto dei comandi `clusters`,
richiede il ruolo di platform-admin. L'operatore crea il repository ed entrambi
gli account con Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`clusters add --platform-capacity` registra capacità gestita da Rebase: i progetti
collocati nella sua regione vengono distribuiti lì non appena la relativa baseline è pronta. Non rende disponibile
la regione ai clienti. `--open-to-customers` la rende invece disponibile, alla registrazione, o successivamente tramite
`clusters open <id-or-name>`; `clusters close <id-or-name>` smette di renderla disponibile.
Gli operatori possono eseguire il deploy su un cluster chiuso. Mantieni un cluster chiuso finché il suo
dominio di base è condiviso con un altro cluster: finché il record wildcard non viene spostato, i suoi
nomi host si risolvono solo tramite record espliciti (`ingress.<baseDomain>`,
`s3.<baseDomain>` e uno per progetto), e `clusters add` stampa quali record
aggiungere. Quando il dominio è condiviso, `open` avvisa che il record wildcard deve
già puntare al cluster. Non richiede conferma, quindi funziona all'interno di uno script.

`billing invoices` e `billing upcoming` leggono gli stessi dati Stripe della
pagina Billing della console e sono accessibili esclusivamente a owner e admin dell'organizzazione.
Un token può accedervi, così come al resto di `billing`, con la capability `billing`
sull'organizzazione; un token creato prima dell'introduzione di tale capability continua
a funzionare per una release, con un avviso su ogni risposta. Gli importi in `--json` sono espressi nell'unità frazionaria della valuta (centesimi), esattamente come
inviati da Stripe. Le fatture in bozza non sono elencate; l'anteprima viene calcolata da
Stripe e le sue voci a consumo continuano ad accumularsi fino alla chiusura del periodo di fatturazione.

`usage` rileva quanto utilizzato dal progetto collegato (o `--project`) in un mese
solare, in formato UTC: richieste rispetto alla soglia inclusa, errori 5xx, l'overage
accumulato finora in euro e, per il mese in corso, la stima della proiezione a questo
ritmo. L'overage corrisponde al calcolo del report di overage,
quello che indica a Stripe cosa fatturare e che comparirà nella fattura del mese successivo.
`usage org` elenca ciascun progetto dell'organizzazione selezionata con `rebase cloud
use`, insieme al totale. Qualsiasi membro dell'organizzazione può leggerlo. Un token lo legge
con la capability `logs` sul progetto; `usage org` elenca i progetti su cui il
token possiede tale capability.
`--month` accetta un mese trascorso. La risposta include `caveats`, ciascuno con un `code`: `storage_not_measured`
(lo storage di oggetti riporta 0), `multi_pod_undercount` (le richieste servite mentre sono in esecuzione due o
più pod dell'app non vengono conteggiate), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
progetto riscattato da un agente conteggia solo i giorni a partire dal riscatto) e
`autoscale_not_charged` (i pod sono stati eseguiti oltre `--replicas` e questa piattaforma non
li addebita ancora). La risposta di un progetto autoscalato include anche `autoscale`:
`extraPodSeconds` al di sopra della soglia minima, `amountEur` secondo le relative tariffe e `charged`.

## Deploy hook, avvisi e altro

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

`domains redirect` si applica per singolo dominio ed è disattivato per impostazione predefinita, consentendo a un progetto che serve un host `api.` accanto al proprio sito di mantenerli entrambi; ha effetto quando il dominio è verificato e un altro dominio è impostato come primario, e non si applica mai a un dominio su cui è servita un'app. `deploy-hooks create` stampa l'URL dell'hook una sola volta. `deploy --git` non può essere combinato con i flag di una build locale e sul runtime gestito richiede `--eject`, poiché il control plane compila dal codice sorgente. `settings set --studio` è l'opzione che i comandi di progetto (`rebase data`, `rebase users`, …) richiedono attiva per `--project`: raggiungono l'app tramite lo Studio proxy della console. Un comando la cui route del control plane non è ancora distribuita risponde con `not_served` indicandone il nome. I comandi distruttivi chiedono conferma prima di procedere e rifiutano l'esecuzione con `confirmation_required` quando nessuno può rispondere: usa `--yes`.
