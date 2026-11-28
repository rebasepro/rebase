---
sourceHash: ea9a6d9deb4ba31b
title: rebase cloud
sidebar_label: rebase cloud
description: I gruppi di comandi per Rebase Cloud nella CLI — autenticazione, collegamento del progetto, deploy, notifiche, configurazione, organizzazioni, database, risorse, compute, storage, cluster, fatturazione e utilizzo.
---

Tutto ciò che riguarda Rebase Cloud, attualmente in versione beta privata. Consulta la
[guida a Rebase Cloud](/docs/deployment/cloud/) per scoprire di cosa si tratta e cosa non include
la versione beta.

Ogni gruppo risponde a `--help`, e `--help` non esegue mai il comando. La maggior parte dei comandi
agisce sul progetto collegato in `.rebase/cloud.json`; `--project <id>` opera su
uno specifico senza effettuare il collegamento.

Tre opzioni si applicano ovunque: `--json` per un output leggibile da macchina (anche il
comportamento predefinito quando utilizzato in pipe, tranne per `deploy`, o con `REBASE_JSON=1`), `--url <origin>` per indirizzarsi a un
piano di controllo specifico (o `REBASE_CLOUD_URL`), e `--project, -p <id>`.

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
altrimenti quella selezionata. Un token può contenere solo funzionalità di organizzazione.
`logs` copre anche `usage`. Ciò a cui ciascuna ha accesso è descritto in
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Quando il piano di controllo
contrassegna una risposta a un token come deprecata (un token creato prima di `billing`
che legge la fatturazione), la CLI stampa l'avviso una volta su stderr, mai nel
valore di `--json`.

Senza flag, `login` effettua l'accesso tramite browser. Stampa un codice breve e
un link alla console, apre il browser e attende che tu approvi l'accesso
lì. Se hai già effettuato l'accesso alla console, o accedi con
qualsiasi metodo disponibile (password, Google, GitHub, LinkedIn). Verifica che il
browser mostri lo stesso codice prima di approvarlo. Il link scade dopo dieci
minuti ed è valido una sola volta. Senza un terminale, o con `--json`, il link e il codice
vengono inviati a stderr e `login` continua ad attendere, così che un agente possa fornirti il link. Un
accesso negato esce con `access_denied`, uno scaduto con `expired_token`.

Con `--email`, `login` chiede se utilizzare la password o un codice inviato via email dal
piano di controllo. Se l'autenticazione a due fattori è attiva, richiede poi il codice
dell'authenticator (o un codice di recupero); tramite browser, approva da una
sessione della console che l'ha utilizzata. Senza un terminale non è possibile digitare nessuno dei due codici: imposta
`REBASE_TOKEN` su un token di accesso creato nella console sotto Impostazioni → Access tokens.
Vedi [Rebase Cloud](/docs/deployment/cloud#link-a-project).

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
sull'organizzazione selezionata da `cloud use`, altrimenti sull'organizzazione del progetto collegato. In
quest'ultimo caso indicano quale è stata utilizzata. `orgs delete` non la ricava mai
dal collegamento: richiede `--org` o un'organizzazione selezionata.

### Connettere un'istanza self-hosted a Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

Il [Rebase connector](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
può quindi raggiungerla accanto ai tuoi progetti Cloud. `connect` stampa
`REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE`; impostali sul
server e riavvialo. Nella cartella del progetto propone di scriverli in
`.env`. È sicuro eseguirlo nuovamente. `--name` assegna un nome all'istanza, `--org` seleziona
l'organizzazione, `--no-wait` termina senza attendere. Proprietari e amministratori.

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
directory, e il tempo rimanente prima che venga eliminato se non riscattato (`Unclaimed: deleted
in 41h`). `--open` lo apre anche in un browser. Il link viene conservato solo sulla
macchina che ha eseguito `init --claim`, in `~/.rebase/credentials.json`; il piano di controllo
memorizza un hash dello stesso e non può stamparlo di nuovo. Prima di rispondere, `claim`
chiede al piano di controllo se il token del progetto stesso è ancora valido. Un riscatto (claim)
revoca quel token, quindi una volta che qualcuno ha riscattato il progetto, `claim` rifiuta
con `already_claimed` invece di stampare un link inattivo. Rifiuta inoltre una volta trascorsa la
finestra temporale (`claim_expired`), e in una directory priva di link di riscatto
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` mostrano lo stesso
link finché il progetto non viene riscattato.

`projects transfer` sposta un progetto in un'altra organizzazione, invariato: lo
stesso id, indirizzo, domini personalizzati, database, storage, variabili d'ambiente e
deploy. Cambiano solo chi ne è proprietario, chi può vederlo e chi paga per esso. Devi
essere proprietario o amministratore di entrambe le organizzazioni e aver effettuato l'accesso con `rebase cloud login`;
un token di accesso non può spostare un progetto. La destinazione riceverà la fatturazione da quel momento in poi,
quindi un'organizzazione senza carta registrata (e non fatturata internamente) rifiuterà il trasferimento e
non cambierà nulla. Un progetto ancora in attesa di riscatto viene invece spostato tramite il relativo link di riscatto.
La console offre la stessa azione nelle Impostazioni del progetto, nella danger zone.

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
rebase cloud sleep [status|on|off|wake]  # sleep when idle; `on --after 15m|30m|1h|4h`
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk, realtime per instance
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` senza il nome di un'applicazione distribuisce il backend. Il deploy di un bundle
di backend carica anche il codice sorgente del progetto — ciò che git traccia, mai un `.env` — in modo che un
aggiornamento della piattaforma possa ricompilarlo; `--no-source` lo salta per una volta, e `cloud settings set
--platform-rebuilds off` lo disabilita ed elimina la copia archiviata. `--allow-downgrade` distribuisce una release precedente.

Un aggiornamento della piattaforma può ricompilare un'app gestita su una release di `@rebasepro` più recente
rispetto a quella bloccata nel tuo checkout locale. Un deploy da quel checkout ripristinerebbe il vecchio pannello
di amministrazione e il driver, pertanto viene rifiutato prima di compilare qualsiasi cosa, indicando il
comando per risolvere il problema (`rebase upgrade --to <version>`). `rebase cloud status`
segnala la stessa cosa anticipatamente: con una riga `Rebuilt on` e, in `--json`, con
`runtime.platformRebuiltVersion` e `frameworkDrift`.

Un comando `deploy` seguito termina con un riepilogo: ogni app distribuita con il rispettivo URL, l'id
di deployment, il tempo impiegato e se la nuova versione risponde a quell'indirizzo. Attende
fino a `--live-timeout` secondi (impostazione predefinita 60; `0` salta il controllo) che l'endpoint
`/health` del backend e l'indirizzo di ogni app statica rispondano. Un deploy non riuscito
termina con una singola riga che specifica l'app e il motivo, uscendo con codice diverso da zero. Il riepilogo
viene stampato anche se usato in pipe; `--json` (o `REBASE_JSON=1`) stampa invece un singolo oggetto,
con `apps`, `hosts`, `live`, `liveChecks` e `durationMs`. Un host il cui certificato HTTPS
non è stato ancora emesso viene segnalato come non attivo (not live), con il relativo motivo.

Prima del caricamento, `deploy` analizza il codice JavaScript di ogni app statica distribuita:
i file `.js`/`.mjs`/`.cjs` nel suo `output` e i blocchi `<script>` inline nel
suo HTML. Un errore di sintassi interrompe il deploy con `file:line:column` (codice
`syntax_error` con `--json`), mentre `--no-verify` salta la verifica. Un deploy completato con
successo si conclude indicando la procedura di ripristino, `rebase cloud rollback`. Un'app statica distribuita
singolarmente non può ancora essere ripristinata; consulta
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` serve la build all'indirizzo `https://<project>--<name>.rebase.website` e
lascia inalterata la produzione. Una preview del backend esegue un backend dedicato, su un
database vuoto indipendente, integrando le sue app statiche. Un'app statica non può essere
visualizzata in anteprima da sola su Rebase Cloud per ora: `rebase cloud deploy <app> --preview`
viene rifiutato con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Una preview
del backend viene fatturata come un'ulteriore unità applicativa alla dimensione predefinita per tutta la sua durata, e
il deploy specifica a quanto ammonta al mese, in base al preventivo fornito dal piano di controllo stesso
(`cost` con `--json`; solo la regola e questo link se il piano di controllo non è in grado di
calcolarne il prezzo); `rebase cloud previews delete <name>` la arresta. `rebase cloud previews`
mostra una preview messa in pausa dalla piattaforma (il database ha superato il limite previsto per le preview) come
`paused`, indicando il motivo (`statusMessage` con `--json`). Un nuovo indirizzo di preview
può essere rifiutato con `preview_cert_budget` quando il budget settimanale di certificati
di preview della piattaforma è esaurito; il messaggio specifica fino a quando.
Consulta [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Log

`rebase cloud logs` stampa il log dell'ultima build, e `-f` segue in tempo reale (tail) una build ancora
in esecuzione. `--runtime` legge invece ciò che l'app stampa, da ogni pod
sottostante, specificando per ogni riga il relativo pod quando più di uno ha prodotto output:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
rebase cloud logs --runtime --raw                 # the lines exactly as the pods wrote them
```

- `--since` accetta una durata (`30s`, `5m`, `1h`) o un orario in formato RFC3339.
- `--tail <n>` indica il numero di righe per pod da cui iniziare (il piano di controllo impone un limite massimo di 2000).
- `--grep` mantiene le righe contenenti il testo, senza distinzione tra maiuscole e minuscole; usa `/re/flags` per un'espressione regolare.
- Con `--grep` o `--level`, il filtro esamina ogni riga restituita dal piano di controllo per l'intervallo specificato (le 2000 più recenti di ciascun pod), e `--tail` conta le righe corrispondenti: le `n` corrispondenze più recenti per pod, 500 per impostazione predefinita. Se un pod presenta più righe nell'intervallo rispetto a tale limite, l'output segnala che le righe meno recenti non sono state esaminate (`filter.scanCapped` sotto `--json`).
- `--level error|warn|info|debug` mantiene le righe con quel livello di gravità o superiore. Legge il valore strutturato `severity` registrato da un backend Rebase, una parola indicante il livello all'inizio di una riga di testo semplice, o una struttura di errore come `TypeError:`. Le righe che non contengono nulla di tutto ciò vengono escluse.
- Una riga strutturata viene stampata in modo leggibile: `14:30:32.126 WARN  [boot] Driver version skew …  fix="bump …"`, e una richiesta come `GET /api/data/rooms/RCTF 404 16ms  requestId=…`. `--raw` stampa invece ogni riga esattamente come scritta dal pod; le righe in testo normale vengono stampate invariate in entrambi i casi, e `--json` include sempre le righe originali.

Il monitoraggio continuo (follow) esegue il polling ogni due secondi e stampa ogni riga una sola volta. Notifica i pod
che si avviano, si arrestano o si riavviano. Quando un container si riavvia, stampa anche le ultime
righe dell'istanza terminata, dove solitamente è indicata la causa. Rimane in attesa finché nessun
pod è in esecuzione e, in caso di caduta della connessione, ritenta con backoff
riprendendo dal punto in cui si era interrotto. Con `--json`, il follow stampa un oggetto JSON per
riga (NDJSON): `{"type":"line","ts","pod","text"}` per ciascuna riga di log, e
`{"type":"event","event":…}` per il resto.

`--preview <name>` legge una preview anziché la produzione. Usa il nome
della preview, oppure l'id di deployment stampato dal deploy di preview. Usato da solo, `--preview`
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
da `rebase.json`, stampa i record DNS e lo stato di quell'host esattamente come per una nuova
aggiunta; `--json` include `alreadyRegistered: true`. Un host verificato viene
servito tramite HTTPS una volta emesso il relativo certificato, pochi minuti dopo
la verifica. Fino a quel momento l'ingress risponde con un certificato segnaposto,
e `domains list`, `domains verify` e `status` indicano
`verified, certificate pending` invece di live. La CLI rileva questa informazione eseguendo
un handshake TLS verso ciascun host verificato; `--json` la restituisce come `certificate`
(`ready`, `pending` o `unreachable`, con un valore `reason`).

`app-key` elenca la chiave creata da `rebase cloud init --claim` per l'applicazione
e scritta nel file `.env` come `REBASE_API_TOKEN`, mostrandone solo il prefisso e mai il valore intero. Il riscatto
del progetto assegna definitivamente tale chiave, che cessa di avere una scadenza. `app-key rotate` ne genera una nuova e
revoca contestualmente tutte le precedenti chiavi dell'agente. Scrive la nuova chiave in un file `.env`
in cui `REBASE_API_TOKEN` sia già presente, escludendola da `--json` in tale contesto. In
qualsiasi altra directory stampa la chiave una sola volta. Le chiavi create nel pannello di amministrazione dell'applicazione
non vengono modificate. Viene eseguito con la tua sessione di login: nessuna capability di token lo consente.

`service-key` stampa la generazione della chiave `REBASE_SERVICE_KEY` del progetto, la data dell'ultima
rotazione e se l'app è ancora in fase di riavvio sulla chiave più recente. Non stampa
mai la chiave: per farlo usa `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emette una nuova chiave e riavvia l'app applicandola. La vecchia chiave rimane valida fino al
termine del riavvio, dopodiché cessa di funzionare. L'operazione viene rifiutata durante l'esecuzione
di un deploy e viene eseguita con la tua sessione di login. Anche il riscatto di un progetto comporta la rotazione
della sua service key.

Una preview del backend dispone di una propria service key. Viene generata al suo primo deploy,
mantenuta nei deploy successivi, mentre la chiave di produzione restituisce 401 sulla preview.
`service-key --preview <name>` la stampa, così come `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
ne scrive una nuova e riavvia esclusivamente il pod di quella preview; la vecchia chiave rimane valida fino a quando
il nuovo pod non è pronto. Richiede una conferma preventiva, e `--yes` la ignora. Entrambi richiedono
gli stessi requisiti di `env reveal`: il ruolo di owner o admin dell'organizzazione e, nel caso di un
token di accesso, la capability `env` su un progetto riscattato. La chiave e il
pod di produzione non vengono toccati.

Una preview del backend eredita inizialmente le variabili di produzione, incluse le chiavi live.
`env set KEY=VALUE --preview` assegna alle preview un valore dedicato, `env unset KEY
--preview` esclude la variabile dalle preview, `env reset KEY --preview` ripristina
il valore di produzione e `env list --preview` mostra le differenze.
La produzione non viene mai modificata da nessuna di queste operazioni.

`env set KEY --stdin` legge il valore dallo standard input anziché dalla
riga di comando, dove `ps` e la cronologia della shell lo renderebbero visibile:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Un eventuale carattere di nuova riga finale viene rimosso. La funzione `rebase_cloud_env_set` del server MCP imposta
i valori in questo modo.

`env set KEY --prompt` richiede il valore tramite un prompt nascosto nel terminale.
Non viene mostrato alcun output a schermo e il valore viene memorizzato come secret, analogamente a quanto avviene con `--stdin
--secret`. Un agente può fornirti il comando da eseguire, evitando che il valore
transiti nella chat. In assenza di un terminale il comando fallisce (`input_required`) suggerendo
l'uso di `--stdin`.

## Organizzazioni

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite <email>` aggiunge un utente che possiede già un account Rebase con un
indirizzo email verificato, esattamente come la funzione Add member della console. L'utente ottiene l'accesso
immediatamente e non viene inviata alcuna email. Rebase Cloud non invia ancora inviti via email, pertanto una
persona priva di account non riceve alcun link: il comando rifiuta l'operazione con `no_account` e
richiede che l'utente si registri prima di eseguirlo nuovamente. Un piano di controllo predisposto per
la gestione degli inviti ne crea invece uno e ne stampa il link (monouso, valido 7
giorni, accettabile solo da un account che abbia verificato tale indirizzo); `invites`
elenca, revoca e reinvia tali inviti, restituendo `not_served` negli altri casi.
`--role` può essere `admin` o `member` (predefinito). Nessun utente viene aggiunto direttamente come `owner`: aggiungilo
come admin, dopodiché un owner potrà promuoverlo con `members role <email> owner`.
L'aggiunta di membri e `invites` richiedono una sessione `rebase cloud login`;
`REBASE_TOKEN` viene rifiutato. Entrambi richiedono il ruolo di owner o admin; un utente con ruolo member riceverà un
avviso in merito.
`members remove` richiede conferma (`--yes` la ignora); la rimozione o il declassamento di un owner
può essere effettuata solo da un owner, e l'ultimo owner non può essere rimosso. `--org <id>` seleziona un'organizzazione
diversa da quella attiva.

### Accesso al progetto

```bash
rebase cloud access [list]
rebase cloud access invite <email> [--role admin|developer|viewer]
rebase cloud access role <email|uid> <admin|developer|viewer>
rebase cloud access remove <email|uid>
rebase cloud access invites [list] | revoke <id|email> | resend <id|email>
```

`access` gestisce chi può accedere a un determinato progetto, a quello collegato o a quello indicato con `--project`. I
proprietari e gli amministratori di un'organizzazione hanno ruolo `admin` su ogni progetto di sua proprietà e i relativi
membri hanno ruolo `developer`; `access` attribuisce a un utente un ruolo specifico esclusivamente per questo progetto,
a prescindere dalla sua appartenenza all'organizzazione. Il suo ruolo effettivo corrisponde al più elevato
tra i due, e `access` lo visualizza specificandone la provenienza. `admin` garantisce accesso completo, inclusi
permessi di accesso e impostazioni; `developer` consente di distribuire (deploy) e usare Studio,
i log e l'ambiente; `viewer` consente solo la lettura.

`invite` genera un invito per il progetto (`--role` è impostato in modo predefinito su `developer`)
e ne stampa il relativo link: monouso, valido per 7 giorni, accettabile solo da un account
che abbia verificato tale indirizzo email. `role` e `remove` modificano o revocano il
ruolo specifico del progetto e richiedono una conferma preventiva (`--yes` la ignora); un utente che accede al
progetto tramite l'organizzazione deve essere rimosso con `orgs members remove`.
La perdita del ruolo `admin` su un progetto comporta anche la revoca del ruolo `admin`
conferito all'utente all'interno dell'app tramite **Open admin panel**, terminando le sue sessioni attive. Ogni
modifica richiede una sessione `rebase cloud login` e il ruolo `admin` sul progetto; un
piano di controllo privo del supporto per l'accesso ai progetti risponde con `not_served`.

`activity` è l'audit log dell'organizzazione selezionata, ordinato dal più recente: chi
ha effettuato deploy o rollback, impostato, eliminato o mostrato una variabile d'ambiente (per
nome, mai per valore), modificato un dominio, creato, ripristinato o scaricato un
backup, modificato le risorse di compute di un progetto, arrestato o eliminato un progetto, modificato il ruolo
di un membro, oppure creato o revocato un token di accesso. `--action` accetta un'area
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o un'azione completa
come `env.set`. Una pagina contiene fino a 100 voci (`--limit`, predefinito 50);
l'output stampa il cursore `--before` per la pagina successiva. `--json` restituisce un singolo valore,
`{ org, events, nextCursor }`. Richiede il ruolo di owner o admin dell'organizzazione.
Un token può leggerlo solo se provvisto della capability `audit` sull'organizzazione
(`rebase cloud tokens create --can audit`). La pagina **Activity** della console
mostra lo stesso log.

## Database

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db query [sql] [--file <path>]
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` apre una porta locale che funge direttamente da database gestito (senza endpoint
pubblico) fino a Ctrl-C; `--reveal` mostra la password. Riservato a owner o admin.

`db query` esegue comandi SQL sul database gestito e stampa il risultato di ciascuna istruzione,
senza necessità di un client `psql` locale: apre lo stesso tunnel per la durata di una
singola query. Un file contenente più istruzioni viene eseguito come un unico script e si interrompe al primo
errore; non viene creata alcuna transazione automatica, pertanto racchiudi il contenuto del file tra `BEGIN`/`COMMIT`
per garantirne l'atomicità (tutto o niente). `COPY … FROM STDIN` viene rifiutato. Riservato a owner o admin. Con
`--json` stampa `{ projectId, results: [{ command, rowCount, rows }] }`.

`db connect`, `db query` e `db backup` accettano l'opzione `--database <key>` per uno degli
[altri database](/docs/backend/multiple-sources/) del progetto, corrispondente alla `key` di
una dichiarazione `database("<key>")`. In sua assenza, agiscono su quello predefinito.

## Ospiti

Ogni `signInAnonymously()` in un test, bot o visita abbandonata lascia una riga
tra gli utenti del progetto. Questi comandi contano tali righe e le rimuovono, evitando
di doverle scorrere una per una.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` accetta un valore temporale con relativa unità di misura: `45m`, `12h`, `30d` o `2w`. Senza `--yes`
si limita a contare senza eliminare nulla. Elabora progetti di qualsiasi dimensione procedendo
a piccoli lotti.

Possono essere rimossi solo gli utenti guest. Un guest è una riga con `is_anonymous` impostato, nessuna password e nessuna
identità associata; l'applicazione applica questa regola nell'istruzione che cancella la
riga, impedendo al comando di toccare un normale account, anche qualora si sia registrato un istante
dopo essere stato elencato. `delete` rifiuta un account registrato con `NOT_ANONYMOUS`.

**Last seen** indica la data in cui la sessione del guest è stata emessa o aggiornata per l'ultima volta, oppure la data
di creazione del guest qualora non rimanga alcun refresh token. Un guest che continua a tornare
non viene considerato obsoleto, a prescindere da quanto tempo prima sia stato creato. L'eliminazione di un guest comporta
anche la rimozione dei suoi refresh token e di qualsiasi altra riga di autenticazione correlata.

Le righe nelle tue tabelle seguono la relativa chiave esterna:

| Colonna | Cosa accade alla riga |
|---|---|
| Collegamento opzionale (`ON DELETE SET NULL`, predefinito) | Mantenuta, con il collegamento svuotato |
| Collegamento obbligatorio (`ON DELETE RESTRICT`, predefinito) | Mantenuta, insieme al guest: il guest viene segnalato come saltato, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Eliminata insieme al guest |
| Nessuna chiave esterna (un campo `userSelect`, un semplice id) | Mantenuta, contenente un id non più esistente |

Verifica quali dei tuoi collegamenti sono impostati su cascade prima di passare `--yes`: l'operazione non può essere annullata.

Il comando passa attraverso il proxy Studio della console, che detiene la chiave dell'app, in modo che la chiave non raggiunga mai la tua
macchina. Richiede un owner o admin dell'organizzazione, su un progetto con l'accesso a Studio abilitato
(`rebase cloud settings set --studio on`). Un progetto basato su un runtime precedente viene avvisato della necessità di una versione più recente.
`rebase users guests --project <slug>` è lo stesso comando disponibile nella famiglia di comandi del progetto.

## Risorse

Cosa la piattaforma alloca per il progetto, a fronte di quanto dichiarato nel codice.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un deploy non rimuove mai un database allocato quando la sua dichiarazione scompare dal codice: ciò
comporterebbe l'eliminazione di dati a seguito di un push. La piattaforma lo mantiene, lo associa e continua a fatturarlo finché qualcuno
non lo elimina esplicitamente per nome.

## Compute

Ciò che il progetto riserva in termini di risorse e i relativi costi.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accetta i parametri `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
`--scale-to-zero` è deprecato: ogni backend esegue almeno un'istanza, pertanto
il valore `true` viene rifiutato e `false` viene ignorato con un avviso. Non esistono
piani a livelli: il prezzo è calcolato singolarmente per risorsa. Consulta
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
accetta un elenco separato da virgole tra `deploy.failed` (predefinito),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` e `preview.paused`. `--format slack` invia
soltanto `{ "text" }` anziché il JSON dell'evento, che contiene anch'esso un campo `text`. L'URL
è un argomento posizionale perché `--url` specifica l'indirizzo del piano di controllo. `add` stampa
il secret di firma una sola volta; `--json` restituisce `{ projectId, webhook, secret }`.
`test <id>` esce con codice 1 ed errore `delivery_failed` qualora il destinatario non abbia accettato
l'evento di test. La visualizzazione dell'elenco è consentita a qualsiasi membro dell'organizzazione; `add`, `test`
e `remove` richiedono il ruolo di owner o admin. Un token può gestirli con la
capability `notifications` sull'organizzazione, nel rispetto delle stesse regole di ruolo. Consulta
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` assegna al cluster
di un cliente un proprio registro di immagini, utilizzato esclusivamente per quel cluster. In assenza di
tale configurazione, il cluster utilizza il registro condiviso della piattaforma, e ogni deploy eseguito su di esso
lo segnala nel log. Configurandolo, le build effettuano il push verso quel repository con un token per
quell'account, i pod eseguono il pull esclusivamente con quella chiave, e un rollback accetta le
immagini del progetto ivi residenti. Le immagini
compilate in precedenza dal progetto nel repository condiviso rimangono disponibili per il pull e utilizzabili
per i rollback. I tre valori devono essere indicati congiuntamente; `--clear` li rimuove. La chiave
viene memorizzata in forma protetta al momento della scrittura e non può più essere letta. Come il resto dei comandi `clusters`,
richiede il ruolo platform-admin. L'operatore crea il repository ed entrambi
gli account con Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`clusters add --platform-capacity` registra capacità gestita direttamente da Rebase: i progetti
assegnati a tale regione vi vengono distribuiti una volta pronta la relativa baseline. La regione non viene
automaticamente proposta ai clienti. Per renderla disponibile ai clienti, specifica `--open-to-customers` in fase di registrazione, oppure usa
successivamente `clusters open <id-or-name>`; `clusters close <id-or-name>` ne interrompe la disponibilità.
Gli operatori possono comunque effettuare deploy su un cluster chiuso. È opportuno mantenere un cluster chiuso finché il relativo
dominio di base è condiviso con un altro cluster: finché il record wildcard non viene spostato, i suoi
nomi host si risolvono unicamente tramite record espliciti (`ingress.<baseDomain>`,
`s3.<baseDomain>` e uno per ciascun progetto), e `clusters add` indica quali record
aggiungere. Quando il dominio è condiviso, `open` avvisa che il record wildcard deve
già puntare al cluster. Il comando non richiede conferme interattive, funzionando correttamente all'interno di script.

`billing invoices` e `billing upcoming` leggono gli stessi dati Stripe mostrati nella
pagina Billing della console, e sono accessibili unicamente agli owner e admin dell'organizzazione.
Un token può accedervi, così come al resto dei comandi `billing`, con la
capability `billing` sull'organizzazione; un token generato prima dell'introduzione di tale capability continua
a funzionare per una release, visualizzando un avviso in ogni risposta. Gli importi in `--json` sono espressi nell'unità minima della valuta (centesimi), esattamente come
inviati da Stripe. Le fatture in bozza non vengono elencate; la preview è calcolata da
Stripe e le relative voci a consumo continuano ad accumularsi fino alla chiusura del periodo di fatturazione.

`usage` rileva quanto utilizzato dal progetto collegato (o da `--project`) in un mese
solare, in formato UTC: richieste rispetto alla soglia inclusa, errori 5xx, l'eccedenza maturata
finora in euro e, per il mese in corso, la stima proiettata a fine mese a questo
ritmo. L'eccedenza corrisponde al calcolo del report di overage, lo stesso
che comunica a Stripe l'importo da fatturare, e compare nella fattura del mese successivo.
`usage org` elenca ciascun progetto dell'organizzazione selezionata con `rebase cloud
use`, unitamente al totale. Qualsiasi membro dell'organizzazione può visualizzarlo. Un token può leggerlo
con la capability `logs` sul progetto; `usage org` elenca i progetti per cui il
token dispone di tale permesso.
`--month` accetta un mese passato. La risposta include un array `caveats`, ciascuno con un `code`: `storage_not_measured`
(l'object storage indica 0), `multi_pod_undercount` (le richieste gestite mentre sono in esecuzione due o
più pod applicativi non vengono conteggiate), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
progetto riscattato da un agente conteggia solo i giorni successivi al riscatto) e
`autoscale_not_charged` (i pod sono stati eseguiti oltre la soglia `--replicas` e la piattaforma non li
fattura ancora). La risposta di un progetto scalato automaticamente include anche la sezione `autoscale`:
`extraPodSeconds` oltre la soglia base, `amountEur` in base alle relative tariffe, e `charged`.

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

`domains redirect` si applica per singolo dominio ed è disattivato per impostazione predefinita, consentendo a un progetto che gestisce un host `api.` accanto al sito principale di mantenerli entrambi; ha effetto quando il dominio è verificato e un altro dominio è impostato come primario, e non si applica mai a un dominio su cui è servita un'applicazione. `deploy-hooks create` stampa l'URL dell'hook una sola volta. `deploy --git` non può essere combinato con i flag di una build locale e, sul runtime gestito, richiede `--eject`, poiché il piano di controllo compila a partire dal codice sorgente. `settings set --studio` è l'opzione che i comandi del progetto (`rebase data`, `rebase users`, …) richiedono abilitata per `--project`: essi raggiungono infatti l'app tramite il proxy Studio della console. Un comando la cui route del piano di controllo non è ancora stata distribuita restituisce `not_served` indicandone il nome. I comandi distruttivi richiedono prima una conferma e falliscono con `confirmation_required` se l'ambiente non consente una risposta interattiva: passa il flag `--yes`.
