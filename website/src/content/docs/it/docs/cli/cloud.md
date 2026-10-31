---
sourceHash: 4b7b199f1aa18e8d
title: rebase cloud
sidebar_label: rebase cloud
description: I gruppi di comandi per Rebase Cloud nella CLI — autenticazione, collegamento del progetto, deploy, notifiche, configurazione, organizzazioni, database, risorse, calcolo, archiviazione, cluster, fatturazione e utilizzo.
---

Tutto ciò che riguarda Rebase Cloud, che è attualmente in beta privata. Consulta la
[guida a Rebase Cloud](/docs/deployment/cloud/) per scoprire di cosa si tratta e cosa
non è incluso nella beta.

Ogni gruppo risponde a `--help`, e `--help` non esegue mai il comando. La maggior parte dei comandi
agisce sul progetto collegato in `.rebase/cloud.json`; `--project <id>` opera su
un progetto senza collegarlo.

Tre opzioni sono valide ovunque: `--json` per un output leggibile da una macchina (è anche il
valore predefinito quando viene inviato tramite pipe, tranne per `deploy`, o con `REBASE_JSON=1`), `--url <origin>` per indirizzarsi a un
control plane specifico (o `REBASE_CLOUD_URL`), e `--project, -p <id>`.

## Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` accetta `deploy`, `logs`, `env`, `database` e `backups` su un singolo progetto
(`--project`, o quello collegato), e `billing`, `audit` e
`notifications` su un'organizzazione: `--org`, altrimenti l'organizzazione del progetto,
altrimenti quella selezionata. Un token può contenere solo funzionalità di organizzazione.
`logs` copre anche `usage`. Ciò a cui ciascuno di essi ha accesso è descritto in
[CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents). Quando il control
plane contrassegna una risposta a un token come deprecata (un token creato prima di `billing`
che legge la fatturazione), la CLI stampa l'avviso una volta su stderr, mai nel
valore `--json`.

Da un terminale senza password fornita, `login` chiede se utilizzare la password
o un codice inviato via email dal control plane. Con l'autenticazione a due fattori attiva,
chiede poi il codice dell'autenticatore (o un codice di recupero). Senza un terminale
nessuno dei due può essere digitato: imposta `REBASE_TOKEN` su un token di accesso creato nella console
in Impostazioni → Token di accesso. Consulta [Rebase Cloud](/docs/deployment/cloud#link-a-project).

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

`claim` stampa il link di riscatto del progetto sottoposto a provisioning da `init --claim` in questa
directory e il tempo rimanente prima che venga eliminato se non riscattato (`Unclaimed: deleted
in 41h`). `--open` lo apre anche in un browser. Il link viene conservato solo sulla
macchina che ha eseguito `init --claim`, in `~/.rebase/credentials.json`; il control
plane memorizza un hash di tale link e non può stamparlo di nuovo. Prima di rispondere, `claim`
chiede al control plane se il token del progetto funziona ancora. Un riscatto
revoca quel token, quindi una volta che qualcuno ha riscattato il progetto, `claim` rifiuta
l'operazione con `already_claimed` invece di stampare un link non più valido. Rifiuta l'operazione anche quando la
finestra di tempo è scaduta (`claim_expired`), e in una directory priva di link di riscatto
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

`deploy` senza il nome di un'app esegue il deploy del backend. Il deploy di un bundle
di backend carica anche il codice sorgente del progetto — ciò che git traccia, mai un file `.env` — in modo che un
aggiornamento della piattaforma possa ricompilarlo; `--no-source` salta questo passaggio per una volta, e `cloud settings set
--platform-rebuilds off` lo disattiva ed elimina la copia archiviata. `--allow-downgrade` esegue il deploy di una versione precedente.

Un `deploy` seguito termina con un riepilogo: ogni app distribuita con il rispettivo URL, l'id
del deployment, il tempo impiegato e se la nuova versione risponde a tale indirizzo.
Attende fino a `--live-timeout` secondi (il valore predefinito è 60; `0` salta il controllo) che
il percorso `/health` del backend e l'indirizzo di ogni app statica rispondano. Un deploy non riuscito
termina con una riga contenente il nome dell'app e il motivo, e si chiude con un codice di uscita diverso da zero. Il riepilogo
viene stampato anche quando l'output è reindirizzato tramite pipe; `--json` (o `REBASE_JSON=1`) stampa invece un singolo oggetto,
con `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

Prima del caricamento, `deploy` analizza il codice JavaScript di ogni app statica distribuita:
i file `.js`/`.mjs`/`.cjs` nella cartella `output` e i blocchi `<script>` inline
nel relativo HTML. Un errore di sintassi interrompe il deploy indicando `file:line:column` (codice
`syntax_error` in modalità `--json`), mentre `--no-verify` salta il controllo. Un deploy
completato con successo termina indicando la procedura di ripristino, `rebase cloud rollback`. Non è ancora possibile
eseguire il rollback di un'app statica distribuita singolarmente; consulta
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` serve la build all'indirizzo `https://<project>--<name>.rebase.website` e
non modifica l'ambiente di produzione. L'anteprima del backend esegue una propria istanza di backend, su un
database vuoto dedicato, integrando le sue app statiche. Un'app statica non può ancora
essere visualizzata in anteprima da sola su Rebase Cloud: `rebase cloud deploy <app> --preview`
viene rifiutato con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Un'anteprima
del backend viene fatturata come un'ulteriore unità app alla dimensione predefinita finché rimane attiva, e
il comando di deploy indica a quanto ammonta il costo mensile, in base alla stima fornita dal control plane stesso
(`cost` sotto `--json`; mostra solo la regola e questo link quando il control plane non è in grado di
calcolarne il prezzo); `rebase cloud previews delete <name>` la arresta. `rebase cloud previews`
mostra come `paused` un'anteprima messa in pausa dalla piattaforma (il cui database ha superato il limite previsto per le anteprime),
riportandone il motivo (`statusMessage` sotto `--json`). Una nuova richiesta di indirizzo di anteprima
può essere rifiutata con l'errore `preview_cert_budget` se il budget settimanale della piattaforma per i
certificati di anteprima è esaurito; il messaggio indicherà fino a quando.
Consulta [Anteprima di una modifica](/docs/deployment/cloud/#preview-a-change).

### Log

`rebase cloud logs` stampa il log dell'ultima build, e `-f` segue in tempo reale una build
ancora in esecuzione. `--runtime` legge invece l'output stampato dall'applicazione da ogni pod
sottostante, con ogni riga contrassegnata dal relativo pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` accetta una durata (`30s`, `5m`, `1h`) o un timestamp RFC3339.
- `--tail <n>` indica il numero di righe per pod da cui iniziare (il control plane impone un limite massimo di 2000).
- `--grep` filtra le righe che contengono il testo specificato, senza distinzione tra maiuscole e minuscole; usa `/re/flags` per
  un'espressione regolare.
- `--level error|warn|info|debug` filtra le righe con tale livello di gravità o superiore. Riconosce
  il campo strutturato `severity` registrato da un backend Rebase, una parola di livello all'inizio di una
  riga di testo normale o una struttura di errore come `TypeError:`. Le righe prive di questi elementi vengono escluse.

La modalità follow effettua il polling ogni due secondi e stampa ogni riga una sola volta. Segnala i pod
che si avviano, si arrestano o si riavviano. Quando un container si riavvia, stampa anche le ultime
righe dell'istanza terminata, dove solitamente è indicata la causa. Rimane in attesa se nessun
pod è in esecuzione e, in caso di perdita di connessione, ritenta con backoff
riprendendo dal punto in cui si era interrotto. Con `--json`, il follow stampa un oggetto JSON per
riga (NDJSON): `{"type":"line","ts","pod","text"}` per ogni riga di log, e
`{"type":"event","event":…}` per il resto.

`--preview <name>` legge un'anteprima anziché l'ambiente di produzione. Usa il nome
dell'anteprima o l'id del deployment stampato al momento del deploy dell'anteprima. Utilizzato da solo, `--preview`
legge l'unica anteprima del progetto. Un'anteprima statica include un log di build ma nessun
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
chiave creata da `rebase cloud init --claim` sull'app e salvata nel file `.env` come
`REBASE_API_TOKEN`, mostrandone il prefisso e mai il valore intero. Riscattare il progetto
trasferisce la proprietà di tale chiave, che cesserà di avere una scadenza. `app-key rotate` genera una nuova chiave e
revoca istantaneamente tutte le precedenti chiavi agente. Scrive la nuova chiave all'interno di un file `.env`
in cui sia già presente `REBASE_API_TOKEN`, escludendola dall'output `--json`. In
qualsiasi altra directory, il comando stampa la chiave una sola volta. Le chiavi create nel pannello di amministrazione
dell'app non vengono modificate. Il comando viene eseguito con la tua sessione di accesso: nessuna capacità di token ne concede l'uso.

`service-key`
stampa la generazione del valore `REBASE_SERVICE_KEY` del progetto, la data dell'ultima
rotazione e se l'app è ancora in fase di riavvio con la chiave più recente. Non stampa
mai la chiave: per farlo si usa `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emette una nuova chiave e riavvia l'app caricandola. La vecchia chiave rimane valida fino al
termine del riavvio, dopodiché cessa di funzionare. Il comando viene rifiutato se è in corso un deploy
ed è eseguibile solo tramite la tua sessione di accesso. Riscattare un progetto comporta anche la rotazione della
relativa service key.

Un'anteprima di backend eredita inizialmente le variabili dell'ambiente di produzione, incluse le chiavi live.
`env set KEY=VALUE --preview` assegna alle anteprime un valore dedicato, `env unset KEY --preview`
esclude la variabile dalle anteprime, `env reset KEY --preview` ripristina
il valore presente in produzione, e `env list --preview` mostra le differenze.
L'ambiente di produzione non viene mai modificato da nessuno di questi comandi.

`env set KEY --stdin` legge il valore dallo standard input anziché dalla
riga di comando, evitando che compaia nell'output di `ps` o nella cronologia della shell:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

L'eventuale carattere di nuova riga finale viene rimosso. Il comando del server MCP `rebase_cloud_env_set` imposta
i valori secondo questa modalità.

## Organizzazioni

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` genera un invito e ne stampa il link: monouso,
valido per 7 giorni, accettabile solo da un account che abbia verificato quell'indirizzo email.
Nessun utente viene aggiunto fino all'accettazione, anche se dispone già di un account Rebase.
L'output (e il campo `emailDelivery` in `--json`) indica se l'invito è stato recapitato via email; in
caso negativo, un avviso suggerisce di inviare il link manualmente. L'opzione `--role` accetta `admin` o
`member` (predefinito). Non è possibile invitare un utente direttamente con il ruolo di `owner`: occorre invitarlo come admin, e
un owner potrà poi promuoverlo tramite il comando `members role <email> owner` dopo che l'utente avrà aderito.
`invites resend` genera un nuovo link rendendo nullo il precedente.
L'invio e la gestione con `invites` richiedono una sessione autenticata con `rebase cloud login`; l'uso di `REBASE_TOKEN` viene
rifiutato. Le operazioni di invito, visualizzazione, reinvio e revoca richiedono il ruolo
di owner o di admin; agli utenti con ruolo member viene mostrato un avviso di errore.
`members remove` richiede una conferma prima di procedere (`--yes` salta la richiesta); la rimozione o il declassamento di un owner
possono essere eseguiti solo da un owner, e l'ultimo owner non può essere rimosso. `--org <id>` specifica un'organizzazione
diversa da quella attualmente selezionata.

`activity` mostra l'audit log dell'organizzazione selezionata, a partire dall'evento più recente: chi ha
eseguito un deploy, un rollback, impostato, eliminato o visualizzato una variabile d'ambiente (per
nome, mai per valore), modificato un dominio, creato, ripristinato o scaricato un
backup, modificato le risorse di calcolo di un progetto, arrestato o eliminato un progetto, modificato il
ruolo di un membro, oppure creato o revocato un token di accesso. `--action` accetta un ambito
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) oppure un'azione completa
come `env.set`. Una singola pagina contiene fino a 100 voci (`--limit`, predefinito 50); l'output
mostra il cursore `--before` per accedere alla successiva. Con `--json` viene restituito un singolo valore,
`{ org, events, nextCursor }`. Richiede il ruolo di owner o admin dell'organizzazione.
Un token può leggerlo solo se dispone della funzionalità `audit` per l'organizzazione
(`rebase cloud tokens create --can audit`). La pagina **Activity** della console
mostra il medesimo log.

## Database

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` apre una porta locale che funge da interfaccia diretta con il database gestito (senza endpoint
pubblico) fino alla pressione di Ctrl-C; l'opzione `--reveal` include la password. Riservato a owner o admin.

## Ospiti

<span class="since-badge" data-since="0.27">Dalla versione 0.27</span>

Ogni invocazione di `signInAnonymously()` eseguita durante un test, da un bot o in una sessione abbandonata lascia una riga
nella tabella degli utenti del progetto. Questi comandi consentono di conteggiare tali record e rimuoverli, evitando
di doverli eliminare manualmente uno a uno.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` accetta un intervallo temporale comprensivo di unità di misura: `45m`, `12h`, `30d` o `2w`. In assenza di `--yes`,
esegue un conteggio senza eliminare alcun dato. L'operazione elabora progetti di qualsiasi dimensione procedendo
per piccoli lotti.

È possibile eliminare esclusivamente gli utenti ospiti. Un ospite è definito come una riga con il flag `is_anonymous` attivo,
senza password e senza alcuna identità associata; l'applicazione applica questa regola direttamente nell'istruzione SQL
che esegue la cancellazione, impedendo al comando di intaccare un account reale, anche nel caso in cui la registrazione
avvenga un istante dopo l'elencazione. `delete` rifiuta qualsiasi account con il codice `NOT_ANONYMOUS`.

Il valore **Last seen** indica il momento in cui la sessione dell'ospite è stata creata o rinnovata per l'ultima volta, oppure
la data di creazione dell'ospite qualora non sia rimasto alcun refresh token attivo. Un utente ospite che continua ad accedere
non viene considerato inattivo, indipendentemente da quanto tempo prima sia stato creato. L'eliminazione di un ospite
comporta la cancellazione automatica dei relativi refresh token e di qualsiasi altro record di autenticazione correlato.

I record presenti nelle tabelle create dall'utente si comportano secondo le impostazioni delle rispettive chiavi esterne:

| Colonna | Comportamento del record |
|---|---|
| Vincolo facoltativo (`ON DELETE SET NULL`, predefinito) | Mantenuto, con la chiave esterna impostata a null |
| Vincolo obbligatorio (`ON DELETE RESTRICT`, predefinito) | Mantenuto, e l'ospite non viene rimosso: l'ospite viene segnalato come saltato con l'errore `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Eliminato contestualmente all'ospite |
| Nessuna chiave esterna (un campo `userSelect`, un semplice id) | Mantenuto, contenente un identificativo non più esistente |

Prima di specificare il flag `--yes`, verifica quali relazioni sono impostate su cascade: l'operazione non può essere annullata.

Il comando accede a `REBASE_SERVICE_KEY` con le stesse modalità di `env reveal`, richiedendo pertanto
i privilegi di owner o admin (oppure un token associato a tale ruolo e dotato del permesso `env`). La
chiave viene gestita unicamente in memoria e trasmessa esclusivamente all'endpoint del progetto. Se il progetto è configurato
con una versione di runtime obsoleta, verrà richiesto di aggiornarla a una release più recente.

## Risorse

Lo stato delle risorse allocate sulla piattaforma per il progetto a confronto con quanto dichiarato nel codice sorgente.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un'operazione di deploy non cancella mai un database allocato qualora la sua dichiarazione venga rimossa dal codice,
poiché ciò comporterebbe la perdita accidentale di dati a seguito di un push. La risorsa viene mantenuta,
collegata e regolarmente fatturata finché non viene esplicitamente eliminata indicandone il nome.

## Risorse di calcolo

La capacità di calcolo riservata per il progetto e i relativi costi associati.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accetta le opzioni `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
L'opzione `--scale-to-zero` è stata ritirata: ogni backend deve eseguire almeno un'istanza, per cui
il valore `true` viene rifiutato e `false` viene ignorato restituendo un avviso. Non sono previsti piani
a scaglioni: ogni risorsa viene tariffata a consumo effettivo. Consulta la
[guida a Rebase Cloud](/docs/deployment/cloud/).

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

`notifications add <url>` inoltra gli eventi del progetto collegato a un endpoint URL. L'opzione `--events`
accetta un elenco separato da virgole contenente `deploy.failed` (predefinito),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` e `preview.paused`. `--format slack` invia
esclusivamente la struttura `{ "text" }` anziché l'intero payload JSON dell'evento (che include comunque un campo `text`). L'URL
è un argomento posizionale poiché il flag `--url` serve a specificare il control plane. `add` stampa
il segreto di firma una sola volta; con `--json` viene restituito `{ projectId, webhook, secret }`.
`test <id>` termina con codice di uscita 1 e segnala l'errore `delivery_failed` se l'endpoint di destinazione non accetta
l'evento di test. La visualizzazione dell'elenco è consentita a qualsiasi membro dell'organizzazione; le operazioni `add`, `test`
e `remove` richiedono il ruolo di owner o admin. È possibile gestirle tramite token disponendo del
permesso `notifications` assegnato all'organizzazione, nel rispetto delle medesime regole di ruolo. Consulta
[Notifiche Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo> --push-service-account <email> --pull-key-file <key.json>` assegna a un
cluster dedicato del cliente un container registry esclusivo, riservato all'uso di quel solo cluster. In
assenza di questa configurazione, il cluster utilizza il registry condiviso della piattaforma, evidenziando
questa condizione nel log di ogni operazione di deploy. Quando configurato, le procedure di build inviano le immagini al
repository specificato tramite il token dell'account indicato, i pod eseguono il pull esclusivamente con tale chiave e le operazioni di rollback
accettano le immagini del progetto ivi residenti. Le immagini
create in precedenza nel registry condiviso rimangono comunque accessibili per il pull e utilizzabili
come destinazioni per il rollback. I tre parametri devono essere forniti contestualmente; `--clear` ne rimuove l'impostazione. La chiave
viene protetta in scrittura e non potrà più essere consultata. Come per gli altri comandi del gruppo `clusters`,
è richiesto il ruolo di platform-admin. L'amministratore dell'infrastruttura crea il repository ed entrambi gli
account mediante Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` e `billing upcoming` leggono i medesimi dati Stripe mostrati nella
sezione Fatturazione della console e sono accessibili unicamente a owner e admin dell'organizzazione.
I token possono accedervi, così come al resto dei comandi `billing`, purché dispongano dell'autorizzazione
`billing` sull'organizzazione; i token creati prima dell'introduzione di tale funzionalità continueranno a
funzionare per una sola release successiva, riportando un messaggio di avviso per ogni operazione. Gli importi indicati sotto `--json` sono espressi nell'unità minima della valuta (centesimi), esattamente come
trasmessi da Stripe. Le bozze di fattura non vengono incluse nell'elenco; l'anteprima viene calcolata
da Stripe e le voci a consumo continuano a incrementare fino al termine del ciclo di fatturazione.

`usage` riporta i consumi del progetto collegato (o di quello specificato con `--project`) nel corso di un mese
solare, calcolati in orario UTC: il volume delle richieste a fronte della soglia inclusa nel piano, il conteggio degli errori 5xx, l'importo dell'eccedenza
maturato fino a quel momento in euro e, per il mese in corso, la proiezione stimata dell'andamento
in base al ritmo attuale. L'eccedenza corrisponde al calcolo formale generato dal report dei consumi,
lo stesso trasmesso a Stripe per la fatturazione, che verrà addebitato nella fattura del mese successivo.
`usage org` elenca i dati di tutti i progetti appartenenti all'organizzazione selezionata con `rebase cloud use`,
unitamente al conteggio totale complessivo. Qualsiasi membro dell'organizzazione ha accesso a queste metriche. Un token può visualizzarle
se dotato del permesso `logs` sul progetto; `usage org` mostrerà esclusivamente i progetti sui quali il
token detiene tale autorizzazione.
L'opzione `--month` accetta un mese pregresso. L'output include la voce `caveats`, contenente una serie di codici di stato: `storage_not_measured`
(lo storage a oggetti riporta un valore pari a 0), `multi_pod_undercount` (le richieste gestite in presenza di due o
più pod attivi non vengono conteggiate), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (per un
progetto riscattato da un agente vengono conteggiati solo i giorni successivi al riscatto) e
`autoscale_not_charged` (i pod sono stati eseguiti oltre la soglia definita da `--replicas` e l'infrastruttura attuale non
applica ancora i relativi costi). In presenza di scalabilità automatica, la risposta include anche la voce `autoscale`:
il totale `extraPodSeconds` eccedente la capacità base, il controvalore `amountEur` calcolato secondo le tariffe in vigore e l'indicatore `charged`.
