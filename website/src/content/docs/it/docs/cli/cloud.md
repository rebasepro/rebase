---
sourceHash: aae5af4b5b61ddcd
title: rebase cloud
sidebar_label: rebase cloud
description: I gruppi di comandi per Rebase Cloud nella CLI — autenticazione, collegamento del progetto, deploy, notifiche, configurazione, organizzazioni, database, risorse, calcolo, storage, cluster, fatturazione e utilizzo.
---

Tutto ciò che riguarda Rebase Cloud, attualmente in versione beta privata. Consulta la
[guida di Rebase Cloud](/docs/deployment/cloud/) per scoprire di cosa si tratta e cosa la beta
non include.

Ogni gruppo risponde a `--help`, e `--help` non esegue mai il comando. La maggior parte dei comandi
agisce sul progetto collegato in `.rebase/cloud.json`; `--project <id>` opera su
uno specifico progetto senza collegarlo.

Tre opzioni si applicano ovunque: `--json` per un output leggibile da macchina (anche
l'impostazione predefinita quando reindirizzato con pipe, eccetto per `deploy`, o con `REBASE_JSON=1`), `--url <origin>` per indirizzare uno
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

`--can` accetta `deploy`, `logs`, `env`, `database` e `backups` su un singolo progetto
(`--project`, o quello collegato), e `billing`, `audit` e
`notifications` su un'organizzazione: `--org`, altrimenti l'organizzazione del progetto,
altrimenti quella selezionata. Un token può contenere solo funzionalità a livello di organizzazione.
`logs` copre anche `usage`. Ciò a cui ciascuno di essi ha accesso è descritto in
[CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents). Quando il piano di controllo
contrassegna la risposta a un token come deprecata (un token creato prima di `billing`
che legge la fatturazione), la CLI stampa l'avviso una volta su stderr, mai nel
valore `--json`.

Senza flag, `login` effettua l'accesso tramite il browser. Stampa un breve codice e
un link alla console, apre il browser e attende che tu approvi l'accesso
lì. Se hai già effettuato l'accesso alla console, o accedi con
qualsiasi metodo offerto (password, Google, GitHub, LinkedIn). Verifica che il
browser mostri lo stesso codice prima di approvarlo. Il link scade dopo dieci
minuti e funziona una sola volta. Senza un terminale, o con `--json`, il link e il codice
vengono inviati a stderr e `login` continua ad attendere, in modo che un agente possa passarti il link. Un
accesso negato termina con `access_denied`, uno scaduto con `expired_token`.

Con `--email`, `login` chiede se utilizzare la password o un codice inviato via email
dal piano di controllo. Con l'autenticazione a due fattori attivata, chiede poi il codice
dell'autenticatore (o un codice di recupero); tramite il browser, approva da una
sessione della console in cui è stata utilizzata. Senza un terminale non è possibile digitare nessuno dei due codici:
imposta `REBASE_TOKEN` su un token di accesso creato nella console sotto Settings → Access
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
la raggiunge quindi accanto ai tuoi progetti Cloud. `connect` stampa
`REBASE_PLATFORM_TOKEN_KEY` e `REBASE_PLATFORM_TOKEN_AUDIENCE`; impostali sul
server e riavvialo. Nella cartella del progetto offre la possibilità di scriverli in
`.env`. Eseguirlo nuovamente è sicuro. `--name` assegna un nome all'istanza, `--org` seleziona
l'organizzazione, `--no-wait` restituisce il controllo senza attendere. Riservato a proprietari e amministratori.

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
directory e il tempo rimanente prima che venga eliminato se non rivendicato (`Unclaimed: deleted
in 41h`). `--open` lo apre anche in un browser. Il link viene conservato solo sulla
macchina che ha eseguito `init --claim`, in `~/.rebase/credentials.json`; il piano di controllo
ne memorizza un hash e non può stamparlo di nuovo. Prima di rispondere, `claim`
chiede al piano di controllo se il token del progetto è ancora valido. La rivendicazione
revoca tale token, quindi una volta che qualcuno ha rivendicato il progetto, `claim` rifiuta
l'operazione con `already_claimed` invece di stampare un link non più valido. Rifiuta l'operazione anche quando la
finestra temporale è scaduta (`claim_expired`) e in una directory priva di un link di rivendicazione
(`no_claim_link`). `rebase cloud status` e `rebase cloud whoami` mostrano lo stesso
link finché il progetto non viene rivendicato.

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

`deploy` senza alcun nome di app distribuisce il backend. Il deploy di un bundle
backend carica anche il codice sorgente del progetto — ciò che git traccia, mai un file `.env` — in modo che un
aggiornamento della piattaforma possa ricompilarlo; `--no-source` salta questo passaggio per una volta, e `cloud settings set
--platform-rebuilds off` lo disattiva ed elimina la copia archiviata. `--allow-downgrade` distribuisce una versione precedente.

Un comando `deploy` seguito termina con un riepilogo: ciascuna app rilasciata con il relativo URL,
l'ID del deployment, il tempo impiegato e se la nuova versione risponde a tale indirizzo. Attende
fino a `--live-timeout` secondi (predefinito 60; `0` salta il controllo) che l'endpoint
`/health` del backend e l'indirizzo di ciascuna app statica rispondano. Un deploy fallito
termina con una riga indicante l'app e il motivo, uscendo con un codice diverso da zero. Il riepilogo
viene stampato anche se reindirizzato con pipe; `--json` (o `REBASE_JSON=1`) stampa invece un singolo oggetto,
con `apps`, `hosts`, `live`, `liveChecks` e `durationMs`.

Prima del caricamento, `deploy` analizza il codice JavaScript di ogni app statica che distribuisce:
i file `.js`/`.mjs`/`.cjs` nel relativo `output` e i blocchi `<script>` inline
nel relativo codice HTML. Un errore di sintassi arresta il deploy indicando `file:line:column` (codice
`syntax_error` con `--json`), mentre `--no-verify` salta la verifica. Un deploy
riuscito termina indicando la procedura di ripristino, `rebase cloud rollback`. Un'app statica distribuita singolarmente
non può ancora essere ripristinata; consulta
[Eseguire il rollback](/docs/deployment/cloud#roll-back).

`--preview` rende disponibile la build all'indirizzo `https://<project>--<name>.rebase.website` e
non tocca la produzione. Una preview del backend esegue il proprio backend, su un
database vuoto dedicato, integrando le sue app statiche. Un'app statica non può essere
visualizzata in anteprima singolarmente su Rebase Cloud per il momento: `rebase cloud deploy <app> --preview`
viene rifiutato con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Una preview del backend
viene fatturata come un'unità applicativa aggiuntiva con dimensione predefinita per tutto il tempo in cui esiste, e
il deploy indica il costo mensile stimato dal preventivo del piano di controllo
(`cost` con `--json`; solo la regola e questo link qualora il piano di controllo non possa
calcolarne il prezzo); `rebase cloud previews delete <name>` la arresta. `rebase cloud previews`
mostra una preview sospesa dalla piattaforma (il cui database ha superato il limite previsto per le preview) come
`paused`, specificandone il motivo (`statusMessage` con `--json`). Un nuovo indirizzo di preview
può essere rifiutato con `preview_cert_budget` se il budget settimanale di
certificati di preview della piattaforma è esaurito; il messaggio indicherà fino a quando.
Consulta [Visualizzare in anteprima una modifica](/docs/deployment/cloud/#preview-a-change).

### Log

`rebase cloud logs` stampa il log di build più recente, e `-f` segue in tempo reale una build che è
ancora in esecuzione. `--runtime` legge invece ciò che l'app stampa, da ogni pod
sottostante, con ogni riga contrassegnata dal rispettivo pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` accetta una durata (`30s`, `5m`, `1h`) o un orario in formato RFC3339.
- `--tail <n>` indica il numero di righe per pod da cui iniziare (il piano di controllo fissa il limite massimo a 2000).
- `--grep` mantiene le righe contenenti il testo indicato, senza distinzione tra maiuscole e minuscole; specifica `/re/flags` per
  un'espressione regolare.
- Con `--grep` o `--level`, il filtro cerca in ogni riga restituita dal piano di controllo
  per l'intervallo temporale (le 2000 più recenti di ciascun pod), e `--tail` conta le righe corrispondenti:
  le `n` corrispondenze più recenti per pod, 500 per impostazione predefinita. Quando un pod ha prodotto più
  righe nell'intervallo considerato, l'output segnala che le più vecchie non sono state
  analizzate (`filter.scanCapped` con `--json`).
- `--level error|warn|info|debug` mantiene le righe pari o superiori a quel livello di gravità. Rileva
  la `severity` strutturata registrata da un backend Rebase, una parola indicante il livello all'inizio di
  una riga di testo normale o una struttura di errore come `TypeError:`. Le righe che non ne contengono alcuna vengono escluse.

L'opzione follow esegue il polling ogni due secondi e stampa ogni riga una sola volta. Notifica i pod
che si avviano, si arrestano o si riavviano. Quando un container si riavvia, stampa anche le ultime
righe dell'istanza terminata, dove di solito si trova la causa. Rimane in attesa se non ci sono
pod in esecuzione, e in caso di caduta della connessione effettua nuovi tentativi con backoff
riprendendo dal punto in cui si era interrotto. Con `--json`, il follow stampa un oggetto JSON per
riga (NDJSON): `{"type":"line","ts","pod","text"}` per ogni riga di log, e
`{"type":"event","event":…}` per il resto.

`--preview <name>` legge una preview anziché la produzione. Usa il nome della preview
o l'ID di deployment stampato dal deploy della preview. Da solo, `--preview`
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

`app-key` elenca la
chiave creata sull'app da `rebase cloud init --claim` e scritta in `.env` come
`REBASE_API_TOKEN`, mostrandone il prefisso e mai il valore completo. La rivendicazione del progetto
trasferisce tale chiave e ne interrompe la scadenza. `app-key rotate` ne genera una nuova e
revoca contemporaneamente tutte le chiavi agente precedenti. Scrive la nuova chiave in un file `.env`
che imposta già `REBASE_API_TOKEN`, escludendola da `--json` in quel contesto. In
qualsiasi altra directory stampa la chiave una sola volta. Le chiavi create nel pannello di amministrazione dell'app
non vengono modificate. Viene eseguito con la tua sessione di accesso: nessuna capability del token può concederlo.

`service-key`
stampa la generazione di `REBASE_SERVICE_KEY` del progetto, quando è stata ruotata l'ultima
volta e se l'app si sta ancora riavviando sulla versione più recente. Non
stampa mai la chiave: per farlo si usa `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
genera una nuova chiave e riavvia l'app con essa. La vecchia chiave rimane valida fino al completamento
del riavvio, dopodiché non funzionerà più. L'operazione viene rifiutata se è in corso un deploy,
e viene eseguita con la tua sessione di accesso. Anche la rivendicazione di un progetto comporta la rotazione della sua service key.

Una preview del backend dispone di una propria service key. Il suo primo deploy la genera,
i successivi la mantengono, e la chiave di produzione restituisce 401 sulla preview.
`service-key --preview <name>` la stampa, così come `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
ne genera una nuova e riavvia solo il pod di quella specifica preview; la vecchia chiave rimane valida fino a quando
il nuovo pod non è pronto. Il comando richiede prima conferma, e `--yes` salta la richiesta. Entrambi
richiedono gli stessi permessi di `env reveal`: il ruolo di owner o admin nell'organizzazione, e per un
token di accesso la capability `env` su un progetto rivendicato. La chiave e il
pod di produzione rimangono intatti.

Una preview del backend parte dalle variabili di produzione, incluse le chiavi attive.
`env set KEY=VALUE --preview` assegna alle preview un valore dedicato, `env unset KEY
--preview` esclude la variabile da esse, `env reset KEY --preview` ripristina
il valore di produzione, e `env list --preview` mostra le differenze.
Nessuna di queste operazioni modifica mai la produzione.

`env set KEY --stdin` legge il valore dallo standard input invece che dalla
riga di comando, dove `ps` e la cronologia della shell lo renderebbero visibile:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Viene rimosso un singolo carattere di fine riga finale. Lo strumento `rebase_cloud_env_set`
del server MCP imposta i valori in questo modo.

## Organizzazioni

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` crea un invito e stampa il relativo link: monouso,
valido 7 giorni, accettabile solo da un account che ha verificato tale indirizzo.
Nessuno entra a far parte dell'organizzazione finché non accetta, anche chi possiede già un account Rebase.
L'output (e `emailDelivery` in `--json`) indica se l'invito è stato inviato via email; in caso
contrario, un avviso segnala di inviare il link manualmente. `--role` può essere `admin` o
`member` (predefinito). Nessuno può essere invitato come `owner`: invitalo come admin e
un proprietario potrà promuoverlo con `members role <email> owner` dopo l'accesso.
`invites resend` genera un nuovo link rendendo inutilizzabile il precedente.
L'invio di inviti e il comando `invites` richiedono una sessione `rebase cloud login`; `REBASE_TOKEN` viene
rifiutato. Invitare, elencare, reinviare e revocare richiedono il ruolo di owner o admin;
un member riceverà un messaggio di errore.
`members remove` chiede prima conferma (`--yes` la ignora); la rimozione o il declassamento di un owner
richiede il ruolo di owner, e l'ultimo owner non può essere rimosso. `--org <id>` seleziona un'organizzazione
diversa da quella attualmente impostata.

`activity` è l'audit log dell'organizzazione selezionata, dal più recente al meno recente: chi
ha distribuito, eseguito un rollback, impostato, eliminato o mostrato una variabile d'ambiente (per
nome, mai per valore), modificato un dominio, creato, ripristinato o scaricato un
backup, modificato le risorse di calcolo di un progetto, arrestato o eliminato un progetto, modificato il
ruolo di un membro, oppure creato o revocato un token di accesso. `--action` accetta un'area
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o un'azione completa
come `env.set`. Una pagina contiene fino a 100 voci (`--limit`, valore predefinito 50);
l'output stampa il cursore `--before` per la pagina successiva. `--json` restituisce un unico valore,
`{ org, events, nextCursor }`. Richiede il ruolo di owner o admin nell'organizzazione.
Un token può leggerlo solo con la capability `audit` sull'organizzazione
(`rebase cloud tokens create --can audit`). La pagina **Activity** della console
mostra lo stesso log.

## Database

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` apre una porta locale che *è* il database gestito (nessun
endpoint pubblico) fino alla pressione di Ctrl-C; `--reveal` aggiunge la password. Riservato esclusivamente a owner o admin.

## Guest

Ogni `signInAnonymously()` eseguito in un test, da un bot o durante una visita abbandonata lascia una riga
tra gli utenti del progetto. Questi comandi contano tali righe e le rimuovono, evitando
di doverle scorrere una alla volta.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` accetta un'anzianità con relativa unità di misura: `45m`, `12h`, `30d` o `2w`. Senza `--yes` si
limita a contare senza eliminare nulla. Elabora progetti di qualsiasi dimensione procedendo
a piccoli batch.

Solo gli utenti guest possono essere rimossi. Un guest è una riga con `is_anonymous` impostato, nessuna password e nessuna
identità collegata; l'applicazione applica questa regola nell'istruzione che cancella
la riga, pertanto il comando non può colpire un account reale, nemmeno se registrato un istante
dopo l'elencazione. `delete` rifiuta un account registrato con `NOT_ANONYMOUS`.

**Ultimo accesso (Last seen)** indica il momento in cui la sessione del guest è stata emessa o aggiornata l'ultima volta, oppure quando
il guest è stato creato se non possiede più refresh token. Un guest che continua a tornare
non è considerato vecchio, a prescindere da quanto tempo prima sia stato creato. I refresh token di un guest eliminato
e qualsiasi altra riga di autenticazione vengono rimossi contestualmente.

Le righe nelle tue tabelle seguono la relativa chiave esterna:

| Colonna | Cosa accade alla riga |
|---|---|
| Collegamento opzionale (`ON DELETE SET NULL`, il valore predefinito) | Mantenuta, con il collegamento svuotato |
| Collegamento obbligatorio (`ON DELETE RESTRICT`, il valore predefinito) | Mantenuta, e il guest con essa: il guest viene segnalato come ignorato, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Eliminata insieme al guest |
| Nessuna chiave esterna (un campo `userSelect`, un semplice id) | Mantenuta, contenente un ID non più esistente |

Verifica quali dei tuoi collegamenti sono impostati a cascata prima di passare `--yes`: l'operazione non può essere annullata.

Il comando passa attraverso il proxy Studio della console, che conserva la chiave dell'app, in modo che la chiave non raggiunga mai la tua
macchina. Richiede un owner o admin dell'organizzazione, su un progetto con accesso a Studio abilitato
(`rebase cloud settings set --studio on`). Un progetto configurato su un runtime obsoleto riceverà la notifica che è necessario un aggiornamento.
`rebase users guests --project <slug>` è il comando equivalente nella famiglia di comandi del progetto.

## Risorse

Ciò che la piattaforma mantiene per il progetto, a fronte di quanto dichiarato nel suo codice.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un deploy non rimuove mai un database sottoposto a provisioning quando viene rimossa la sua dichiarazione — equivarrebbe
a cancellare dati con un push. Continua a mantenerlo, associarlo e fatturarlo finché qualcuno
non ne effettua il prune specificandone il nome.

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
`true` viene rifiutato e `false` viene ignorato con un avviso. Non esistono livelli
di piano: ogni risorsa ha un prezzo specifico. Consulta
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
accetta un elenco separato da virgole contenente `deploy.failed` (il valore predefinito),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` e `preview.paused`. `--format slack` invia
solo `{ "text" }` anziché il JSON dell'evento, che contiene anch'esso un campo `text`. L'URL
è un argomento posizionale poiché `--url` identifica il piano di controllo. `add` stampa
il segreto di firma una sola volta; `--json` restituisce `{ projectId, webhook, secret }`.
`test <id>` esce con codice 1 ed errore `delivery_failed` se il destinatario non ha accettato
l'evento di test. L'elenco è accessibile a qualsiasi membro dell'organizzazione; `add`, `test`
e `remove` richiedono il ruolo di owner o admin. Un token può gestirli con la
capability `notifications` sull'organizzazione, nel rispetto delle stesse regole di ruolo. Consulta
[Notifiche Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` assegna al cluster dedicato del
cliente un registry di immagini proprietario, utilizzato esclusivamente per quel cluster. Senza di
esso, tale cluster utilizza il registry condiviso della piattaforma, e ogni deploy lo segnalerà
nel proprio log. Con un registry configurato, le build eseguono il push su quel repository con un token per
quell'account, i pod effettuano il pull esclusivamente con quella chiave, e un rollback accetta le
immagini del progetto presenti in tale registry. Le immagini
create in precedenza dal progetto nel repository condiviso rimangono disponibili per il pull e utilizzabili per
il rollback. I tre valori devono essere forniti congiuntamente; `--clear` li rimuove. La chiave
viene cifrata al momento della scrittura e non viene mai letta nuovamente. Come per le altre opzioni di `clusters`,
richiede il ruolo di platform-admin. L'operatore crea il repository ed entrambi
gli account tramite Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` e `billing upcoming` leggono gli stessi dati Stripe mostrati nella pagina
Billing della console e sono accessibili esclusivamente ai proprietari (owner) e amministratori (admin)
dell'organizzazione. Un token può accedervi, così come al resto dei comandi `billing`, tramite la capability `billing`
sull'organizzazione; un token generato prima dell'introduzione di questa capability continuerà a funzionare
per una release, mostrando un avviso a ogni risposta. Gli importi in `--json` sono espressi nell'unità minima della valuta (centesimi), esattamente come
inviati da Stripe. Le bozze di fattura non vengono elencate; l'anteprima viene calcolata da
Stripe e le voci a consumo continuano a incrementarsi fino alla chiusura del periodo di fatturazione.

`usage` rileva le risorse utilizzate dal progetto collegato (o specificato con `--project`) in un mese solare,
in formato UTC: richieste rispetto alla soglia inclusa, errori 5xx, l'eccedenza
maturata finora in euro e, per il mese in corso, la stima a questo
ritmo. L'eccedenza corrisponde al calcolo effettuato dal report sui consumi in eccesso,
lo stesso che indica a Stripe l'importo da fatturare e che verrà inserito nella fattura del mese successivo.
`usage org` elenca ogni progetto dell'organizzazione selezionata con `rebase cloud
use`, insieme al totale complessivo. Qualsiasi membro dell'organizzazione può visualizzarlo. Un token lo legge
con la capability `logs` sul progetto; `usage org` elenca i progetti per i quali il
token possiede tale autorizzazione.
`--month` accetta un mese passato. La risposta include `caveats`, ciascuno con un `code`: `storage_not_measured`
(lo storage di oggetti riporta 0), `multi_pod_undercount` (le richieste gestite mentre sono in esecuzione due o
più pod applicativi non vengono conteggiate), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
progetto rivendicato da un agente conteggia solo i giorni a partire dalla rivendicazione) e
`autoscale_not_charged` (i pod sono stati eseguiti oltre `--replicas` e la piattaforma non li tariffa
ancora). La risposta per un progetto con scalabilità automatica include anche `autoscale`:
`extraPodSeconds` oltre la soglia base, `amountEur` in base alle tariffe applicate e `charged`.

## Deploy hook, avvisi e altro

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

`domains redirect` si applica per singolo dominio ed è disattivato per impostazione predefinita, consentendo a un progetto che gestisce un host `api.` insieme al sito principale di mantenerli entrambi; ha effetto se il dominio è verificato e un altro dominio è impostato come primario, e non si applica mai a un dominio su cui è distribuita un'app. `deploy-hooks create` stampa l'URL dell'hook una sola volta. `deploy --git` non può essere combinato con i flag di una build locale e, sul runtime gestito, richiede `--eject`, poiché il piano di controllo compila dal codice sorgente. `settings set --studio` è l'opzione che i comandi del progetto (`rebase data`, `rebase users`, …) richiedono attiva per `--project`: essi raggiungono l'app tramite il proxy Studio della console. Un comando la cui route del piano di controllo non è ancora implementata risponde con `not_served` e ne indica il nome. I comandi distruttivi chiedono conferma e rifiutano l'esecuzione con `confirmation_required` quando nessuno può rispondere: passa `--yes`.
