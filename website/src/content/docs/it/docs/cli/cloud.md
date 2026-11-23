---
sourceHash: 21c6a414fb5571e4
title: rebase cloud
sidebar_label: rebase cloud
description: I gruppi di comandi per Rebase Cloud nella CLI — autenticazione, collegamento del progetto, deploy, notifiche, configurazione, organizzazioni, database, risorse, calcolo, storage, cluster, fatturazione e utilizzo.
---

Tutto ciò che riguarda Rebase Cloud, attualmente in beta privata. Consulta la
[guida di Rebase Cloud](/docs/deployment/cloud/) per scoprire di cosa si tratta e cosa la beta
non include.

Ogni gruppo risponde a `--help`, e `--help` non esegue mai il comando. La maggior parte dei comandi
opera sul progetto collegato in `.rebase/cloud.json`; `--project <id>` opera su
uno specifico senza effettuare il collegamento.

Tre opzioni si applicano ovunque: `--json` per l'output leggibile da macchina (anche
l'impostazione predefinita quando reindirizzato tramite pipe, eccetto per `deploy`, o con `REBASE_JSON=1`), `--url <origin>` per indirizzare uno
specifico piano di controllo (o `REBASE_CLOUD_URL`), e `--project, -p <id>`.

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

`--can` accetta `deploy`, `logs`, `env`, `database` e `backups` su un progetto
(`--project`, o quello collegato), e `billing`, `audit` e
`notifications` su un'organizzazione: `--org`, altrimenti l'organizzazione del progetto,
altrimenti quella selezionata. Un token può contenere solo funzionalità a livello di organizzazione.
`logs` include anche `usage`. L'ambito di ciascuna funzionalità è descritto in
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Quando il piano di controllo
contrassegna una risposta a un token come deprecata (un token creato prima di `billing`
che legge la fatturazione), la CLI stampa l'avviso una sola volta su stderr, mai nel
valore `--json`.

Senza flag, `login` effettua l'accesso tramite browser. Stampa un codice breve e
un link alla console, apre il browser e attende mentre approvi
l'accesso da lì. Se hai già effettuato l'accesso alla console, o accedi con
qualsiasi metodo disponibile (password, Google, GitHub, LinkedIn). Verifica che il
browser mostri lo stesso codice prima di approvarlo. Il link scade dopo dieci
minuti e funziona una sola volta. Senza un terminale, o con `--json`, il link e il codice
vengono inviati a stderr e `login` continua ad attendere, consentendo a un agente di passarti il link. Un
accesso negato termina con `access_denied`, uno scaduto con `expired_token`.

Con `--email`, `login` chiede se utilizzare la password o un codice inviato via email
dal piano di controllo. Con l'autenticazione a due fattori abilitata, richiede successivamente il codice
dell'autenticatore (o un codice di ripristino); tramite browser, approva da una
sessione della console in cui è stata utilizzata. Senza un terminale nessuno dei due codici può essere digitato: imposta
`REBASE_TOKEN` su un token di accesso creato nella console sotto Settings → Access
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
quest'ultimo caso indicano quale è stata utilizzata. `orgs delete` non la ricava mai
dal collegamento: richiede `--org` o un'organizzazione selezionata.

### Connettere un'istanza self-hosted a Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

Il [connettore Rebase](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
la raggiunge quindi accanto ai tuoi progetti Cloud. `connect` stampa
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

`claim` stampa il link di rivendicazione del progetto di cui `init --claim` ha effettuato il provisioning in questa
directory, e il tempo rimanente prima che venga eliminato se non rivendicato (`Unclaimed: deleted
in 41h`). `--open` lo apre anche in un browser. Il link è memorizzato solo sulla
macchina che ha eseguito `init --claim`, in `~/.rebase/credentials.json`; il piano di controllo
ne memorizza un hash e non può stamparlo di nuovo. Prima di rispondere, `claim`
chiede al piano di controllo se il token del progetto è ancora valido. La rivendicazione
revoca tale token, quindi una volta che qualcuno ha rivendicato il progetto, `claim` rifiuta l'operazione
con `already_claimed` invece di stampare un link non valido. Rifiuta inoltre una volta scaduta
la finestra temporale (`claim_expired`), e in una directory priva di link di rivendicazione
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` mostrano lo stesso
link finché il progetto non viene rivendicato.

`projects transfer` sposta un progetto in un'altra organizzazione, lasciandolo invariato:
stessi id, indirizzo, domini personalizzati, database, storage, variabili d'ambiente e
deployment. Cambiano solo la proprietà, la visibilità e chi ne sostiene i costi.
È necessario essere proprietario o amministratore di entrambe le organizzazioni e aver effettuato l'accesso con `rebase cloud login`;
un token di accesso non può spostare un progetto. La destinazione riceverà la fatturazione da quel momento in poi,
quindi un'organizzazione priva di una carta registrata (e non fatturata internamente) rifiuterà il trasferimento e
nulla verrà modificato. Un progetto ancora in attesa di essere rivendicato si sposta invece tramite il suo link di rivendicazione.
La console offre la stessa azione nelle Impostazioni (Settings) del progetto, nella danger zone.

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

`deploy` senza specificare il nome dell'app esegue il deploy del backend. Il deploy di un bundle
backend carica anche il codice sorgente del progetto — ciò che git traccia, mai un file `.env` — in modo che un
aggiornamento della piattaforma possa ricompilarlo; `--no-source` salta questa operazione per una volta, e `cloud settings set
--platform-rebuilds off` la disattiva ed elimina la copia archiviata. `--allow-downgrade` esegue il deploy di una release precedente.

Un aggiornamento della piattaforma può ricompilare un'app gestita su una versione di `@rebasepro` più recente
rispetto a quella bloccata nel tuo checkout. Un deploy da quel checkout ripristinerebbe la versione precedente
del pannello di amministrazione e del driver, pertanto viene rifiutato prima che venga compilato alcunché,
indicando il comando per risolvere il problema (`rebase upgrade --to <version>`). `rebase cloud status`
segnala anticipatamente la stessa situazione: una riga `Rebuilt on` e, in `--json`,
`runtime.platformRebuiltVersion` e `frameworkDrift`.

Un `deploy` seguito termina con un riepilogo: ogni app distribuita con il rispettivo URL,
l'id del deployment, il tempo impiegato e se la nuova versione risponde a quell'indirizzo.
Attende fino a `--live-timeout` secondi (default 60; `0` salta il controllo) che il
`/health` di un backend e l'indirizzo di ciascuna app statica rispondano. Un deploy fallito
termina con una sola riga che indica l'app e la causa, uscendo con codice diverso da zero. Il riepilogo
viene stampato anche se reindirizzato tramite pipe; `--json` (o `REBASE_JSON=1`) stampa invece un unico oggetto,
contenente `apps`, `hosts`, `live`, `liveChecks` e `durationMs`. Un host il cui
certificato HTTPS non è ancora stato emesso viene segnalato come non live, specificandone il motivo.

Prima del caricamento, `deploy` analizza il codice JavaScript di ogni app statica distribuita:
i file `.js`/`.mjs`/`.cjs` nel suo `output` e i blocchi `<script>` inline nel
suo HTML. Un errore di sintassi interrompe il deploy indicando `file:line:column` (codice
`syntax_error` sotto `--json`), e `--no-verify` salta la verifica. Un deploy
riuscito termina mostrando come tornare indietro, `rebase cloud rollback`. Un'app statica distribuita
singolarmente non può ancora essere ripristinata con un rollback; consulta
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` rende disponibile la build all'indirizzo `https://<project>--<name>.rebase.website` e
lascia intatta la produzione. Una preview del backend esegue una propria istanza di backend, su un
database vuoto dedicato, integrando le sue app statiche. Un'app statica non può ancora essere visualizzata in
preview da sola su Rebase Cloud: `rebase cloud deploy <app> --preview`
viene rifiutato con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Una preview del backend
viene fatturata come un'unità applicativa aggiuntiva di dimensione predefinita per l'intera durata della sua esistenza, e
il deploy indica il costo mensile stimato dal piano di controllo
(`cost` sotto `--json`; solo la regola e questo link quando il piano di controllo non è in grado di
calcolarne il prezzo); `rebase cloud previews delete <name>` la arresta. `rebase cloud previews`
mostra una preview sospesa dalla piattaforma (il cui database ha superato il limite di preview) con lo stato
`paused`, indicandone il motivo (`statusMessage` sotto `--json`). Un nuovo indirizzo di preview
può essere rifiutato con `preview_cert_budget` qualora il budget settimanale di certificati di preview
della piattaforma sia esaurito; il messaggio specifica fino a quando.
Consulta [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Log

`rebase cloud logs` stampa il log di build più recente, e `-f` segue in tempo reale (tail) una build che
è ancora in esecuzione. `--runtime` legge invece ciò che l'app stampa, da ogni pod
sottostante, con ciascuna riga etichettata con il relativo pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` accetta una durata (`30s`, `5m`, `1h`) o un orario RFC3339.
- `--tail <n>` indica il numero di righe per pod da cui iniziare (il piano di controllo lo limita a 2000).
- `--grep` mantiene le righe che contengono il testo specificato, senza distinzione tra maiuscole e minuscole; usa `/re/flags` per
  un'espressione regolare.
- Con `--grep` o `--level`, il filtro esamina ogni riga restituita dal piano di controllo
  per l'intervallo temporale (le 2000 più recenti di ciascun pod), e `--tail` conta le righe corrispondenti:
  le `n` corrispondenze più recenti per pod, 500 per impostazione predefinita. Quando un pod presenta più
  righe nell'intervallo rispetto a tale limite, l'output segnala che le righe meno recenti non sono
  state cercate (`filter.scanCapped` sotto `--json`).
- `--level error|warn|info|debug` mantiene le righe con tale gravità o superiore. Riconosce
  la `severity` strutturata registrata da un backend Rebase, una parola che indica il livello all'inizio di
  una riga di testo normale o un pattern di errore come `TypeError:`. Le righe prive di tali indicazioni vengono escluse.

La modalità follow esegue un polling ogni due secondi e stampa ciascuna riga una sola volta. Segnala i pod
che si avviano, si arrestano o si riavviano. Quando un container si riavvia, stampa anche le ultime
righe dell'istanza terminata, dove solitamente risiede la causa. Attende quando nessun
pod è in esecuzione e, in caso di caduta della connessione, ritenta con backoff
riprendendo da dove si era interrotta. Con `--json`, il follow stampa un oggetto JSON per
riga (NDJSON): `{"type":"line","ts","pod","text"}` per ciascuna riga di log e
`{"type":"event","event":…}` per il resto.

`--preview <name>` legge una preview anziché la produzione. Usa il nome della
preview o l'id di deployment stampato dal deploy della preview. Da solo, `--preview`
legge l'unica preview del progetto. Una preview statica include un log di build ma nessun
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
a partire da `rebase.json`, stampa i record DNS e lo stato dell'host come per una
nuova aggiunta; `--json` aggiunge `alreadyRegistered: true`. Un host verificato viene
servito su HTTPS non appena il relativo certificato viene emesso, pochi minuti dopo la
verifica. Fino ad allora l'ingress risponde con un certificato segnaposto,
e `domains list`, `domains verify` e `status` indicano
`verified, certificate pending` anziché live. La CLI rileva questo stato con
un handshake TLS verso ciascun host verificato; `--json` lo riporta come `certificate`
(`ready`, `pending` o `unreachable`, con un `reason`).

`app-key` elenca la
chiave che `rebase cloud init --claim` ha generato nell'app e scritto in `.env` come
`REBASE_API_TOKEN`, mostrandone il prefisso e mai il valore intero. Rivendicare il progetto
trasferisce la chiave, che cessa così di scadere. `app-key rotate` ne genera una nuova e
revoca contemporaneamente tutte le chiavi agente precedenti. Scrive la nuova chiave in un file `.env`
che definisce già `REBASE_API_TOKEN`, escludendola da `--json` in tale contesto. In
qualsiasi altra directory stampa la chiave una sola volta. Le chiavi create nel pannello di amministrazione dell'app
non vengono toccate. Viene eseguito con la tua sessione di accesso: nessuna funzionalità di token può concedere questo permesso.

`service-key`
stampa la generazione della `REBASE_SERVICE_KEY` del progetto, la data dell'ultima
rotazione e se l'app si sta ancora riavviando per adottare la versione più recente. Non
stampa mai la chiave: per farlo si usa `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
genera una nuova chiave e riavvia l'app con essa. La vecchia chiave rimane valida fino al completamento
del riavvio e non oltre. Il comando viene rifiutato mentre è in corso un deploy
e richiede il tuo accesso. La rivendicazione di un progetto comporta anche la rotazione della sua service key.

Una preview del backend dispone di una propria service key. Il primo deploy la genera,
i successivi la mantengono, e la chiave di produzione risponde con 401 sulla preview.
`service-key --preview <name>` la stampa, così come `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
ne genera una nuova e riavvia solo il pod di quella preview; la vecchia chiave rimane valida fino a quando
il nuovo pod non è pronto. Richiede una conferma preventiva, e `--yes` ignora la richiesta. Entrambi
richiedono i requisiti di `env reveal`: il ruolo di owner o admin dell'organizzazione e, nel caso di un
access token, la funzionalità `env` su un progetto rivendicato. La chiave e il
pod di produzione rimangono intatti.

Una preview del backend inizia con le variabili di produzione, incluse le chiavi live.
`env set KEY=VALUE --preview` assegna alle preview un valore specifico, `env unset KEY
--preview` esclude la variabile dalle preview, `env reset KEY --preview` ripristina
il valore di produzione e `env list --preview` mostra le differenze.
La produzione non viene mai modificata da nessuno di questi comandi.

`env set KEY --stdin` legge il valore dallo standard input invece che dalla
riga di comando, dove `ps` e la cronologia della shell lo esporrebbero:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

L'eventuale carattere di nuova riga finale viene rimosso. Il comando `rebase_cloud_env_set` del
server MCP imposta i valori con questa modalità.

`env set KEY --prompt` richiede il valore tramite un prompt nascosto nel terminale.
Nulla viene visualizzato a schermo e il valore viene memorizzato come secret, come con `--stdin
--secret`. Un agente può fornirti il comando da eseguire, evitando così che il valore transiti
nella chat. Senza un terminale l'operazione viene rifiutata (`input_required`), indicando
di usare `--stdin`.

## Organizzazioni

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite <email>` aggiunge un utente che possiede già un account Rebase con un
indirizzo email verificato, esattamente come la funzione Add member della console. L'utente ottiene immediatamente
l'accesso e non viene inviata alcuna email. Rebase Cloud non supporta ancora l'invio diretto di inviti,
pertanto una persona priva di account non riceve alcun link: il comando viene rifiutato con `no_account` e
chiede di farla registrare prima di riprovare. Un piano di controllo configurato per gestire
gli inviti ne crea invece uno e ne stampa il link (monouso, valido 7 giorni, accettabile solo da un account che ha verificato tale indirizzo); `invites`
elenca, revoca e reinvia tali inviti, rispondendo `not_served` in caso contrario.
`--role` può essere `admin` o `member` (default). Nessuno può essere aggiunto come `owner`: aggiungilo
come admin, e un owner potrà promuoverlo con `members role <email> owner`.
L'aggiunta di membri e la gestione di `invites` richiedono una sessione `rebase cloud login`;
l'uso di `REBASE_TOKEN` viene rifiutato. Entrambe le operazioni richiedono il ruolo di owner o admin; un member viene informato
del rifiuto.
`members remove` richiede conferma (`--yes` la salta); rimuovere o retrocedere un owner richiede
i permessi di owner, e l'ultimo owner non può essere rimosso. `--org <id>` seleziona un'organizzazione
diversa da quella attualmente attiva.

### Accesso al progetto

```bash
rebase cloud access [list]
rebase cloud access invite <email> [--role admin|developer|viewer]
rebase cloud access role <email|uid> <admin|developer|viewer>
rebase cloud access remove <email|uid>
rebase cloud access invites [list] | revoke <id|email> | resend <id|email>
```

`access` gestisce chi può accedere a un singolo progetto, quello collegato o indicato tramite `--project`. Gli
owner e gli admin di un'organizzazione sono `admin` su ogni progetto di sua proprietà e i relativi member sono `developer`; `access`
assegna a un utente un ruolo specifico esclusivamente per questo progetto, a prescindere dalla sua appartenenza all'organizzazione. Il suo ruolo
effettivo sarà il più elevato tra i due, e `access` lo mostra specificandone l'origine. `admin` garantisce
il controllo completo, inclusi accessi e impostazioni; `developer` consente di effettuare deploy e utilizzare Studio,
log e variabili d'ambiente; `viewer` garantisce l'accesso in sola lettura.

`invite` crea un invito per il progetto (`--role` predefinito su `developer`)
e ne stampa il link: monouso, valido 7 giorni, accettabile solo da un account
che ha verificato tale indirizzo. `role` e `remove` modificano o revocano il
ruolo specifico per il progetto e richiedono conferma (`--yes` la salta); un utente che accede al
progetto tramite l'organizzazione deve essere rimosso con `orgs members remove`.
La perdita del ruolo di `admin` su un progetto revoca anche il ruolo di `admin` assegnato a tale
persona dall'opzione **Open admin panel** all'interno dell'app e ne termina le relative sessioni. Qualsiasi
modifica richiede una sessione `rebase cloud login` e il ruolo di `admin` sul progetto; un
piano di controllo privo del supporto all'accesso per progetto risponde con `not_served`.

`activity` è l'audit log dell'organizzazione selezionata, ordinato dal più recente: chi
ha effettuato un deploy, un rollback, impostato, eliminato o visualizzato una variabile d'ambiente (per
nome, mai per valore), modificato un dominio, creato, ripristinato o scaricato un
backup, modificato le risorse di calcolo di un progetto, arrestato o eliminato un progetto, modificato il ruolo di un
membro, oppure creato o revocato un token di accesso. `--action` accetta un'area
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o un'azione completa
come `env.set`. Una pagina contiene fino a 100 voci (`--limit`, default 50); l'output
stampa il cursore `--before` per la pagina successiva. `--json` restituisce un unico valore,
`{ org, events, nextCursor }`. Richiede il ruolo di owner o admin dell'organizzazione.
Un token può leggerlo solo se provvisto della funzionalità `audit` sull'organizzazione
(`rebase cloud tokens create --can audit`). La pagina **Activity** della console
mostra lo stesso log.

## Database

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` apre una porta locale che *rappresenta* il database gestito (nessun
endpoint pubblico) fino a Ctrl-C; `--reveal` include la password. Riservato a owner o admin.

## Ospiti

Ogni chiamata a `signInAnonymously()` in un test, un bot o una visita abbandonata lascia una riga
tra gli utenti del progetto. Questi comandi contano tali righe e le rimuovono, evitando
di doverle scorrere una per una.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` accetta un valore temporale con unità di misura: `45m`, `12h`, `30d` o `2w`. Senza `--yes` si
limita a contare e non elimina nulla. Elabora progetti di qualsiasi dimensione a piccoli
lotti.

Possono essere rimossi solo gli utenti guest. Un guest è una riga con `is_anonymous` impostato, senza password e senza
identità collegate; l'applicazione applica questa regola nell'istruzione che cancella la
riga, quindi il comando non può intaccare un account reale, nemmeno se registrato un istante
dopo essere stato elencato. `delete` rifiuta un account registrato restituendo `NOT_ANONYMOUS`.

**Last seen** (ultimo accesso) indica quando la sessione del guest è stata emessa o aggiornata per l'ultima volta, o quando
il guest è stato creato qualora non disponga più di un refresh token. Un guest che continua a tornare
non è considerato obsoleto, a prescindere da quanto tempo fa sia stato creato. I refresh token di un guest eliminato
e qualsiasi altra riga di autenticazione correlata vengono eliminati contestualmente.

Le righe nelle tue tabelle seguono la propria foreign key:

| Colonna | Cosa accade alla riga |
|---|---|
| Collegamento opzionale (`ON DELETE SET NULL`, default) | Mantenuta, con il collegamento svuotato |
| Collegamento obbligatorio (`ON DELETE RESTRICT`, default) | Mantenuta, e il guest con essa: il guest viene segnalato come ignorato, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Eliminata insieme al guest |
| Nessuna foreign key (un campo `userSelect`, un semplice id) | Mantenuta, contenente un id non più esistente |

Verifica quali delle tue relazioni sono impostate a cascata prima di passare `--yes`: l'operazione non può essere annullata.

Il comando passa attraverso il proxy di Studio della console, che detiene la chiave dell'app, impedendo che la chiave raggiunga la tua
macchina. Richiede un owner o admin dell'organizzazione, su un progetto con l'accesso a Studio attivo
(`rebase cloud settings set --studio on`). Un progetto su un runtime precedente riceverà una notifica che richiede una versione più recente.
`rebase users guests --project <slug>` è lo stesso comando all'interno della famiglia di comandi del progetto.

## Risorse

Cosa la piattaforma gestisce per il progetto rispetto a quanto dichiarato nel codice.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un deploy non rimuove mai un database sottoposto a provisioning quando la sua dichiarazione viene rimossa:
equivarrebbe a cancellare dati con un semplice push. Lo mantiene, lo associa e lo fattura finché qualcuno non ne
effettua il prune specificandone il nome.

## Risorse di calcolo

Cosa riserva il progetto e quanto costa.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accetta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
`--scale-to-zero` è dismesso: ogni backend esegue almeno un'istanza, pertanto
`true` viene rifiutato e `false` viene ignorato con un avviso. Non sono previsti
livelli di piano (tier): ogni elemento ha un prezzo per risorsa. Consulta
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
accetta un elenco separato da virgole di `deploy.failed` (impostazione predefinita),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` e `preview.paused`. `--format slack` invia
solo `{ "text" }` anziché il JSON dell'evento, che contiene anch'esso un campo `text`. L'URL
è un argomento posizionale poiché `--url` specifica il piano di controllo. `add` stampa
il segreto di firma una sola volta; `--json` restituisce `{ projectId, webhook, secret }`.
`test <id>` termina con codice 1 e codice di errore `delivery_failed` se il destinatario non ha accettato
l'evento di test. La visualizzazione dell'elenco è aperta a qualsiasi membro dell'organizzazione; `add`, `test`
e `remove` richiedono il ruolo di owner o admin. Un token può gestirli tramite la
funzionalità `notifications` sull'organizzazione, nel rispetto della stessa regola sui ruoli. Consulta
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` assegna al cluster dedicato
di un cliente un proprio registro di immagini, utilizzato esclusivamente per quel cluster. In assenza di questo,
tale cluster utilizza il registro condiviso della piattaforma e ogni deploy verso di esso
lo segnala nel proprio log. Con un registro configurato, le build eseguono il push su quel repository con un token per
quell'account, i pod effettuano il pull solo con quella chiave e un rollback accetta le
immagini del progetto ivi residenti. Le immagini
che il progetto ha compilato in precedenza nel repository condiviso rimangono scaricabili e continuano a essere
target validi per il rollback. I tre valori devono essere forniti insieme; `--clear` li rimuove. La chiave
viene cifrata al momento della scrittura e non viene mai riletta. Come per il resto dei comandi `clusters`,
richiede il ruolo di platform-admin. L'operatore crea il repository ed entrambi
gli account tramite Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`clusters add --platform-capacity` registra capacità gestita da Rebase: i progetti
allocati nella sua regione eseguono il deploy lì non appena la configurazione di base (baseline) è pronta. Non rende
la regione disponibile ai clienti. `--open-to-customers` la rende disponibile, al momento della registrazione o
successivamente tramite `clusters open <id-or-name>`; `clusters close <id-or-name>` cessa di offrirla.
Gli operatori possono eseguire il deploy su un cluster chiuso. Mantieni un cluster chiuso mentre il suo
dominio di base è condiviso con un altro cluster: fino allo spostamento del record wildcard, i suoi
hostname si risolvono solo tramite record espliciti (`ingress.<baseDomain>`,
`s3.<baseDomain>` e uno per progetto), e `clusters add` stampa quali record
aggiungere. Quando il dominio è condiviso, `open` avverte che il record wildcard deve
già puntare al cluster. Il comando non richiede conferma interattiva, quindi è utilizzabile all'interno di script.

`billing invoices` e `billing upcoming` leggono gli stessi dati Stripe mostrati nella
pagina Billing della console, e sono accessibili solo a owner e admin dell'organizzazione.
Un token può accedervi, così come al resto di `billing`, con la funzionalità `billing`
sull'organizzazione; un token creato prima dell'introduzione di tale funzionalità continuerà a funzionare per una release, con un avviso a ogni risposta. Gli importi in `--json` sono espressi nell'unità minima della valuta (centesimi), esattamente come
inviati da Stripe. Le fatture in bozza non sono elencate; l'anteprima viene calcolata da
Stripe e le relative voci a consumo continuano ad accumularsi fino alla chiusura del periodo.

`usage` rileva quanto utilizzato dal progetto collegato (o `--project`) in un mese solare,
in formato UTC: richieste rispetto alla soglia inclusa, errori 5xx, l'eccedenza
maturata finora in euro e, per il mese in corso, la proiezione a questo
ritmo (una stima). L'eccedenza corrisponde al calcolo effettivo del report di overage,
quello che comunica a Stripe l'importo da fatturare, e compare nella fattura del mese successivo.
`usage org` elenca ogni progetto dell'organizzazione selezionata con `rebase cloud
use`, insieme al totale. Qualsiasi membro dell'organizzazione può visualizzarlo. Un token lo legge
se dispone della funzionalità `logs` sul progetto; `usage org` elenca i progetti su cui il
token possiede tale autorizzazione.
`--month` accetta un mese passato. La risposta include `caveats`, ciascuno con un `code`: `storage_not_measured`
(l'object storage restituisce 0), `multi_pod_undercount` (le richieste gestite durante l'esecuzione di due o
più pod dell'app non vengono conteggiate), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
progetto rivendicato da un agente conteggia solo i giorni a partire dalla rivendicazione) e
`autoscale_not_charged` (i pod sono stati eseguiti oltre `--replicas` e questa piattaforma non li
addebita ancora). La risposta per un progetto con scalabilità automatica include anche `autoscale`:
`extraPodSeconds` oltre la soglia minima, `amountEur` alle relative tariffe e `charged`.

## Deploy hook, alert e altre funzionalità

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

`domains redirect` è configurato per dominio ed è disattivato per impostazione predefinita, consentendo a un progetto che gestisce un host `api.` accanto al proprio sito di mantenerli entrambi; ha effetto quando il dominio è verificato e un altro dominio è primario, e non si applica mai a un dominio su cui viene eseguita un'app. `deploy-hooks create` stampa l'URL dell'hook una sola volta. `deploy --git` non può essere combinato con i flag di una build locale e, sul runtime gestito, richiede `--eject`, poiché il piano di controllo compila dal codice sorgente. `settings set --studio` è l'opzione che i comandi del progetto (`rebase data`, `rebase users`, …) richiedono attiva per `--project`: essi raggiungono l'app tramite il proxy di Studio della console. Un comando la cui route sul piano di controllo non è ancora stata distribuita risponde con `not_served`, specificandola. I comandi distruttivi richiedono prima una conferma e falliscono con `confirmation_required` se nessuno può rispondere: passa l'opzione `--yes`.
