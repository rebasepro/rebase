---
sourceHash: 42c888cb0d0b2a71
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Cos'è, come collegare ed eseguire il deploy di un progetto e cosa non include ancora la beta privata.
---

Rebase Cloud esegue lo stesso Rebase open source che ospiteresti in self-hosting — la stessa
immagine `rebasepro/server` pubblicata, lo stesso bundle, lo stesso Postgres. La
differenza sta in chi lo gestisce.

:::note[Beta privata]
Rebase Cloud è in **beta privata**. Gestisce tenant reali già oggi e apre a
scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi seguenti richiedono un account a cui è stato concesso l'accesso.
Tutto il resto su questo sito funziona senza di esso.
:::

## Cos'è

Un **progetto** Cloud è costituito da tre elementi che la piattaforma gestisce per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine di runtime pubblicata. I deploy consistono nel caricamento di un bundle, non nella compilazione di un container |
| **Database** | Un PostgreSQL gestito, con backup automatici e point-in-time recovery |
| **Storage** | Un bucket dedicato, se il tuo progetto utilizza lo storage di file |

Ognuno di essi viene sottoposto a provisioning al primo deploy e viene fatturato in base a ciò che
riserva anziché per utente (per seat).

**Nulla del tuo progetto cambia per poter essere eseguito lì.** Lo stesso repository
può essere ospitato in self-hosting con `docker compose`, e la via d'uscita è concreta: `rebase build`
produce un bundle avviabile ovunque venga eseguita l'immagine di runtime.

## Collegare un progetto

Dalla directory di un progetto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono
flag ed entrambi sono obbligatori — su un terminale vengono richiesti in modo interattivo, e
un'esecuzione headless che omette uno dei due termina con `input_required` anziché inventarne
uno. **Il sottodominio non è modificabile in seguito:** è l'host
`<slug>.rebase.website` su cui risponde il progetto, quindi sceglilo con attenzione.

`--link` associa questa directory al progetto nella stessa chiamata, quindi non c'è una
fase di `link` separata. Scrive `.rebase/cloud.json`, che registra l'ID
e lo slug del progetto. Quel file non è un segreto e non contiene le tue credenziali — queste
ultime risiedono in `~/.rebase/credentials.json`, scritto da `login`.

Viene comunque committato con il codice, quindi un repository clonato può specificare qualsiasi
control plane. Quando l'host proviene solo da quel file e non è né quello
della piattaforma né uno a cui hai effettuato l'accesso in precedenza, `login` ne mostra il nome e chiede
conferma prima di inviarvi email e password. Senza un terminale, o con
`--json`, rifiuta l'operazione con `unknown_control_plane`; passa `--url <host>` (o imposta
`REBASE_CLOUD_URL`) per effettuare l'accesso intenzionalmente lì.

**Ti sei registrato con Google, GitHub o LinkedIn?** Il tuo account non ha una password, quindi
accedi con un codice:

```bash
rebase cloud login --code --email me@example.com
```

Il control plane ti invierà via email un codice a 6 cifre, valido per dieci minuti, da digitare
al prompt. Eseguito normalmente su un terminale, `rebase cloud login` chiede se
utilizzare la password o un codice. I codici richiedono che il control plane sia in grado di inviare
email; se non può, `--code` lo segnala ed esce con `otp_unavailable`.

Se hai attivato l'autenticazione a due fattori, `login` richiederà quindi il codice dalla
tua app di autenticazione o uno dei tuoi codici di recupero, indipendentemente dal metodo con cui hai effettuato l'accesso.
Né un codice di accesso né un secondo fattore possono essere digitati senza un terminale.
Per uno script, crea un token di accesso nella console (**Settings → Access
tokens**) e imposta `REBASE_TOKEN`; vedi [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

Una password errata restituisce `invalid_credentials` con le stesse due modalità di accesso,
poiché la causa comune è un account che non ne ha mai avuta una.

`billing setup` collega una carta all'organizzazione, una sola volta. È all'inizio
della sequenza appositamente: il primo deploy di un progetto viene rifiutato senza di essa,
e scoprirlo dopo che il bundle ha terminato il caricamento è l'ordine peggiore.

Dopodiché, la pagina **Billing** della console elenca le fatture dell'organizzazione,
ciascuna con la pagina ospitata e il PDF di Stripe, e mostra un'anteprima della fattura successiva di ogni
progetto. `rebase cloud billing invoices` e `rebase cloud billing upcoming`
mostrano le stesse informazioni. Entrambi sono riservati ai proprietari (owner) e amministratori dell'organizzazione. Dove
la piattaforma lo prevede, **Manage billing** apre il portale clienti di Stripe per gestire la
carta, i dati di fatturazione e le fatture passate.

Con una carta già registrata, la creazione di un altro progetto nella console non richiede
un secondo pagamento: il progetto viene fatturato su quella carta e deployato. Se la carta
viene rifiutata, o la banca richiede la conferma del pagamento, la console ti reindirizza a
**Billing**, dove **Fix your card** permette di salvare un'altra carta e **Complete the
payment** apre la fattura di Stripe.

Ciò che un progetto ha consumato compare nella sua panoramica, sotto **Usage this month**, e
per tutti i progetti contemporaneamente nella pagina **Billing**: richieste rispetto alla
quota inclusa (la barra diventa arancione all'80%), errori 5xx, l'eccedenza (overage) finora
e la proiezione di fine mese a questo ritmo. L'eccedenza viene calcolata dallo
stesso codice che la segnala a Stripe, quindi corrisponde a quanto sarà addebitato;
compare nella fattura del mese successivo. `rebase cloud usage` mostra le
stesse informazioni, e `rebase cloud usage org` per l'intera organizzazione. Qualsiasi membro può visualizzarlo.
I dati indicano chiaramente cosa non possono ancora rilevare: l'object storage non viene misurato,
quindi non viene fatturata alcuna eccedenza di archiviazione; finché un progetto esegue due o più pod dell'app,
le sue richieste non vengono conteggiate; e una giornata con campionamenti mancati comporta un conteggio per difetto. Un
progetto con scalabilità automatica mostra anche i pod eseguiti oltre `--replicas`, in ore-pod,
il loro costo in base alle tariffe dedicate e se questa piattaforma li addebita già. Un
progetto riscattato da un agente conteggia solo i giorni a partire dal riscatto: prima di
allora, il progetto apparteneva alla piattaforma.

Un progetto esistente può essere collegato senza crearne uno nuovo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Un solo comando, e nessun flag da ricordare. Il file `rebase.json` di uno scaffold dichiara
`runtime: "managed"` per il suo backend, e `deploy` legge tale dichiarazione — lo
segnala durante l'esecuzione (`rebase.json declares runtime: managed — deploying a
bundle`), compila l'applicazione in `dist-bundle`, carica il bundle, lo esegue sull'immagine
di runtime pubblicata e segue il deployment fino a uno stato terminale. Il codice di uscita
rappresenta l'esito finale, quindi la stessa riga funziona in modo non presidiato nella CI.

Termina indicando dove risponde ciascuna app e se la nuova versione è attiva (live) lì:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa che l'indirizzo ha risposto dopo la compilazione: l'endpoint `/health` di un backend
ha restituito `ok`, e la pagina di un'app statica è stata caricata (da questo deployment, quando
la piattaforma la distribuisce). Il controllo attende fino a `--live-timeout` secondi, 60 per
impostazione predefinita; `0` lo salta. Se un'app non risponde in tempo, il deploy restituisce comunque un codice
di uscita pari a zero perché il deployment è andato a buon fine, e l'ultima riga indica quale app non ha risposto
e perché. Un deploy fallito termina invece su una sola riga, indicando l'app e il
motivo, rimandando a `rebase cloud logs` per il registro di compilazione completo.

Gli script possono passare `--json` per ottenere un unico oggetto contenente gli stessi dati — `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` e l'ID del deployment. A differenza del resto di
`rebase cloud`, `deploy` non passa automaticamente a JSON quando viene inviato tramite pipe.

Cosa consente quel runtime — pacchetti e moduli nativi, memoria e istanze,
timeout e dimensioni del corpo della richiesta, filesystem, secret, storage e rete in
uscita — è descritto nella relativa pagina:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Per distribuire un artefatto compilato in precedenza — ad esempio, un job di CI che compila una volta
ed esegue il deploy due volte — specifica la directory invece di ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

L'uscita dal runtime gestito richiede un flag dedicato, `--eject`, e nient'altro lo
richiederà: una compilazione che sposterebbe un progetto gestito su un'immagine container proprietaria
viene rifiutata finché non lo specifichi esplicitamente. In precedenza si usava `--force` per questo, associando
l'operazione meno reversibile che la CLI possa compiere alla stessa parola usata per "sovrascrivi questo
file"; ora è un'opzione sconosciuta anziché un alias, quindi uno script che la contiene
si interromperà.

### Il controllo sintattico prima del caricamento

I file di un'app statica vengono distribuiti esattamente così come sono. Quando la sua fase di `build`
si limita a copiare script scritti a mano in `output`, nessun parser li ha analizzati, e un file
contenente un errore di battitura va in produzione impedendo il caricamento della pagina. Pertanto, prima che
venga caricato qualsiasi elemento, `deploy` analizza sintatticamente ogni file `.js`, `.mjs` e `.cjs` nell'`output`
di ciascuna app statica, insieme a ogni tag `<script>` inline nei suoi file `.html`. Questo
copre sia un'app statica deployata da sola sia le app statiche incorporate nel
bundle del backend. Un errore di sintassi blocca il deploy indicando file, riga e colonna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json`, il `code` dell'errore è `syntax_error`. Gli script inline che un browser
non esegue come JavaScript vengono ignorati: JSON, import map, template e qualsiasi
altro `type` non JavaScript, un tag `<script src>` e uno script che contiene ancora
markup di template non renderizzato come `{{ }}`. Un file `.js` supera il controllo se viene analizzato
validamente sia come script classico sia come modulo, poiché è la pagina a deciderlo. Non viene letto nulla
all'interno di `node_modules`, né in un `--bundle-dir` precompilato.
`--no-verify` salta il controllo per un singolo deploy.

Monitora l'esecuzione:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` riporta `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la
piattaforma sta effettivamente lavorando e fare polling è la cosa giusta; quando
indica qualcosa, significa che quel qualcosa è in attesa di una tua azione.

## Anteprima di una modifica

```bash
rebase cloud deploy --preview
```

Questo compila e carica esattamente ciò che farebbe `deploy`, ma lo rende disponibile a un indirizzo
dedicato, come `https://shop--k3x9ab.rebase.website`. La produzione continua a
servire ciò che serviva prima. Il deploy stampa l'indirizzo dell'anteprima al termine
della compilazione.

Per mantenere lo stesso indirizzo attraverso più deploy, assegna un nome all'anteprima. Eseguire
nuovamente il deploy con lo stesso nome la aggiorna:

```bash
rebase cloud deploy --preview-name new-checkout
```

Le risorse con cui comunica un'anteprima dipendono da ciò che hai deployato:

- **`rebase cloud deploy --preview`** genera un'anteprima del backend, con le sue app statiche
  incorporate, nello stesso modo in cui vengono eseguite in produzione. Riceve un backend dedicato su
  un **database vuoto dedicato**, mai quello di produzione. L'avvio sul database
  di produzione applicherebbe ad esso lo schema e le regole di accesso dell'anteprima.
- **`rebase cloud deploy web --preview`** genererebbe un'anteprima di una singola app statica da
  sola, con le sue pagine che richiamano il backend di **produzione**. Questo richiede un control plane
  in grado di distribuire siti statici autonomamente, cosa che Rebase Cloud non fa ancora:
  rifiuta l'operazione con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Genera invece un'anteprima
  del backend, che distribuisce le app statiche incorporate al suo interno; non è ancora possibile
  generare l'anteprima di un progetto privo di backend gestito.

Un'anteprima non carica codice sorgente e non registra app o hostname, poiché ciascuna
di queste azioni modificherebbe il progetto di produzione. `--source` ed `--eject` non possono essere
combinati con `--preview`. Ognuno di essi compila un'immagine container per la produzione.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` senza `--preview` si riferisce sempre alla produzione.

La pagina **Deployments** della console elenca le stesse anteprime, consentendo di aprirle, visualizzarne
il log di compilazione o eliminarle. La creazione rimane un passaggio tramite CLI.

Un'anteprima scade una settimana dopo l'ultimo deploy.

Al termine, il deploy verifica che l'indirizzo dell'anteprima risponda, esattamente come fa
un deploy di produzione (`--live-timeout <seconds>`, `0` per saltare). Il certificato di una nuova
anteprima può richiedere un minuto o due, quindi un deploy completato con successo potrebbe
segnalare che l'indirizzo non risponde ancora.

Un'anteprima del backend viene fatturata come un'unità di app alla dimensione predefinita (100m di CPU
e 384 MiB di memoria, alla tariffa della tua app per la sua regione e capacità),
ripartita proporzionalmente per la sua durata, e compare nel preventivo mensile
del progetto nella console. `rebase cloud deploy --preview` stampa lo stesso preventivo mensile
(`cost` con `--json`). L'avvio di un'anteprima richiede una carta registrata, come per un deploy di produzione.
Un primo deploy che fallisce prima che qualsiasi elemento venga eseguito viene rimosso
anziché fatturato. Un progetto può eseguire fino a tre anteprime di backend contemporaneamente.

Ogni nuovo indirizzo di anteprima riceve un certificato TLS dedicato da Let's Encrypt,
che consente a un dominio 50 nuovi certificati a settimana, condivisi con ogni sito di produzione su di esso.
Le anteprime possono utilizzarne fino a 20 nell'arco di 7 giorni, a livello di piattaforma. Superata
tale soglia, una nuova anteprima viene rifiutata (`429`, `preview_cert_budget`) indicando quando potrà
essere deployata; il redeploy di un'anteprima già esistente non viene mai conteggiato.

Il database di un'anteprima backend è un secondo database sul Postgres di **produzione**:
dati dedicati, ma sulla stessa istanza e sullo stesso disco. È limitato a 10
connessioni, in modo che le anteprime non esauriscano quelle di produzione, e a 2 GB: un'anteprima
il cui database supera tale dimensione viene messa in pausa. Il suo backend si arresta, il suo indirizzo smette
di rispondere, `rebase cloud previews` e la console la mostrano come `paused` indicandone il
motivo, e i proprietari e amministratori del progetto ricevono una notifica (`preview.paused`). I relativi
dati vengono conservati fino alla scadenza. Esegui nuovamente il deploy per avviarla (verrà nuovamente messa in pausa
finché il database rimane troppo grande), oppure eliminala. Un'anteprima in pausa continua a essere
fatturata finché non viene eliminata o non scade. Elimina le anteprime non più necessarie. Le estensioni installate in produzione non vengono
installate nel database di un'anteprima.

Le anteprime sono in fase di rilascio graduale. Un control plane che non le supporta ancora
rifiuterà `--preview` con `previews_unavailable` e non eseguirà alcun deploy.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback reindirizza il progetto a ciò che un precedente deployment riuscito
ha distribuito, senza mai ricompilare — il vantaggio di un rollback è che distribuisce un
artefatto che è già stato eseguito.

I deployment idonei dipendono dalla modalità di deploy del progetto, ed entrambi i tipi
funzionano:

| Come è stato eseguito il deploy | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (compilazione dai sorgenti) | L'immagine pubblicata da quella compilazione |
| `rebase cloud deploy --bundle` (il runtime della piattaforma) | Il bundle distribuito da quel deploy, sulla versione di runtime attualmente in esecuzione nel progetto |

Le app statiche incorporate nel bundle del backend (un semplice `rebase cloud deploy` su
un progetto con backend) fanno parte di quel bundle, quindi vengono ripristinate insieme ad esso.

Un'app statica deployata da sola (`rebase cloud deploy <app>`) non può ancora essere
ripristinata tramite rollback. Il suo deployment registra quale app è stata pubblicata, ma nessun bundle, quindi il
control plane non ha nulla da cui ripristinarla. La soluzione consiste nel deployare nuovamente l'ultima
versione funzionante, ad esempio dal commit precedente a quello problematico. Dopo un deploy
di questo tipo, `deploy` segnala questa circostanza anziché suggerire `rollback`, e `rollback`
senza un ID rifiuta l'operazione anziché ri-deployare il backend attualmente attivo.

Pertanto, un rollback richiede un deployment che abbia registrato uno dei due elementi, il che implica un
progetto che sia stato deployato con successo almeno due volte. `rebase cloud deployments`
contrassegna quelli idonei, e `--json` riporta `rollbackable` per ogni riga insieme
all'`image` o al `bundle` che verrebbe ripristinato.

Due tipi di deployment vengono rifiutati, e la CLI specifica quale: uno che non è andato a buon fine
e uno precedente a quando la piattaforma ha iniziato a registrare l'artefatto. In entrambi i casi non c'è nulla da
ipotizzare — tirare a indovinare comporterebbe la distribuzione di ciò che è stato compilato o caricato più di
recente pretendendo di ripristinare questo — quindi esegui invece il deploy della versione desiderata.

Ogni deploy riuscito si conclude indicando la procedura di ripristino (`rebase cloud rollback`),
rendendola visibile nel momento in cui viene rilevato un rilascio problematico.

Un rollback aggiunge un nuovo deployment anziché riscrivere la cronologia, e attende che
la versione ripristinata sia attiva e funzionante prima di confermare il successo. Seguilo con
`rebase cloud logs -f`.

## Ripristinare il database a un momento specifico (Point-in-Time Recovery)

Un database gestito può essere ripristinato a qualsiasi minuto all'interno della sua finestra di ripristino,
da **Database → Backups** nella console o tramite CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
L'operazione richiede due passaggi. Innanzitutto, viene predisposta (staged) una copia ripristinata accanto al database attivo;
la tua app continua a funzionare su quello attivo e lo storage della copia viene fatturato finché
non esegui il cutover o lo scarti.
Poi, una volta pronta la copia, il cutover reindirizza l'app verso di essa e la riavvia.
Tutto ciò che è stato scritto dopo l'orario di destinazione non sarà presente nella copia. Il database
originale viene conservato come punto di ripristino e continua a fatturare lo storage; tornare indietro,
rimuoverlo o eseguire un secondo ripristino richiede il supporto tecnico. Solo un proprietario (owner) o un amministratore
può predisporre, eseguire il cutover o scartare, e la console richiede il nome del progetto prima di completare il cutover.

## Proteggi il tuo account

Il tuo account della console può accedere ai database di produzione, ai secret e alla fatturazione,
quindi proteggilo adeguatamente. Apri **Account security** dal menu sotto il tuo avatar
nella console (o vai su `/account`). La pagina è personale, non legata a un'organizzazione:
le impostazioni configurate lì si applicano a tutte le organizzazioni a cui appartieni.

- **Verifica in due passaggi.** Attivala con qualsiasi app di autenticazione (1Password,
  Google Authenticator, Authy). La pagina mostra una chiave di configurazione da aggiungere all'app, o un
  link che apre l'app con la chiave precompilata su uno smartphone, per poi richiedere il
  codice a 6 cifre mostrato dall'app. Da quel momento in poi, ogni accesso richiederà un codice,
  sia che accedi con password, Google o GitHub.
- **Codici di recupero.** L'attivazione genera dieci codici monouso, mostrati una sola volta.
  Ciascuno di essi consente di accedere al posto del codice dell'authenticator in caso di smarrimento del
  telefono, quindi salvali prima di chiudere la finestra di dialogo. **New recovery codes**
  li sostituisce, invalidando i precedenti. Sia la disattivazione della verifica in due passaggi
  sia la generazione di nuovi codici richiedono prima l'inserimento di un codice.
- **Password.** La sua modifica disconnette tutti gli altri dispositivi. Un account
  creato con Google, GitHub o LinkedIn non ha una password; la pagina consente di
  ricevere un link via email per impostarne una.
- **Dispositivi connessi.** Ogni browser e terminale connesso al tuo account,
  con il relativo indirizzo e data/ora di accesso. Disconnetti qualsiasi dispositivo non
  riconosciuto, o tutti contemporaneamente.

I [token di accesso](/docs/deployment/cloud-agents/#ci-and-agents) non sono sessioni e non richiedono un secondo
fattore, quindi la CI continuerà a eseguire il deploy dopo l'attivazione. Revoca un token di cui non ti fidi
più in **Settings → Access tokens**.

## Invita il tuo team

**Members → Invite member** fornisce un link da copiare (inviato via email quando questo control plane
supporta l'invio di email) valido una sola volta, per 7 giorni, per un account che ha verificato quell'indirizzo;
nessuno entra finché non accetta. Invita un admin o un membro, e promuovilo a
owner una volta entrato. Gli owner e gli admin possono visualizzarlo, reinviarlo o revocarlo in
**Pending invitations**; da terminale, [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Scopri chi ha fatto cosa

La pagina **Activity** della console e `rebase cloud activity` mostrano agli
owner e admin dell'organizzazione chi ha eseguito un deploy, impostato o mostrato una variabile
d'ambiente (per nome, mai per valore), modificato un dominio, ripristinato un backup,
ridimensionato, arrestato o eliminato un progetto, modificato il ruolo di un membro o creato un
token, e quando. La sezione **Settings** di un progetto rimanda alle proprie voci; un'entry
relativa a un progetto eliminato viene conservata. Uno script può leggerle tramite un token creato con
`--can audit` sull'organizzazione. Le registrazioni vengono conservate per un anno. I filtri sono documentati in
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agenti

Un job di CI o un agente non dovrebbero utilizzare la tua password. Assegna loro un token limitato a
poche azioni su un singolo progetto, creato da un terminale autenticato con
`rebase cloud tokens create --project shop --can deploy,logs`, e impostalo come
`REBASE_TOKEN`. La fatturazione, il log delle attività e le impostazioni di notifica
di un'organizzazione sono permessi (capability) specifici (`--can billing`, `audit`,
`notifications`) che un token possiede solo se richiesti espressamente. Le capability, un
workflow di GitHub Actions e ciò che rimane associato a una persona autenticata sono descritti in
[CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend senza account

`rebase cloud init --claim` assegna a un'app un backend attivo prima ancora che qualcuno si sia
registrato, e stampa un URL di riscatto (claim) affinché la persona possa mantenerlo; un progetto che nessuno
riscatta entro 72 ore viene eliminato. Le azioni consentite al token di un progetto non riscattato, il
token `REBASE_API_TOKEN` che viene scritto e cosa cambia con il riscatto sono descritti in
[Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Compute e costi

Il prezzo di un progetto si basa su ciò che riserva, non su un piano tariffario (tier). `compute` mostra
ogni parametro e il preventivo dettagliato del control plane per ciascuno di essi. (`rebase cloud
resources` è una cosa diversa: i database e i bucket dichiarati dal codice,
e se per ciascuno è stato eseguito il provisioning — vedi il [riferimento CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Request dell'app per istanza, ad es. `500m` e `2Gi`. Vuoto indica il valore predefinito della piattaforma — `100m` e `384Mi`, con burst fino a 2 CPU e `2Gi` |
| `--replicas` | Istanze sempre attive: il limite minimo dell'autoscaler e ciò che l'abbonamento del progetto fattura mensilmente |
| `--autoscale-max` | 1–16. Il tetto massimo raggiungibile. Le istanze aggiunte dall'autoscaler oltre `--replicas` sono misurate al pod-secondo alle stesse tariffe e addebitate solo dove la piattaforma ha abilitato tale opzione; **Usage this month** specifica dove. `--no-autoscale` lo disattiva |
| `--autoscale-cpu-target` | 10–95. L'utilizzo della CPU che l'autoscaler mantiene, calcolato sulla request anziché sul limit. Vuoto significa 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica e riavviata senza preavviso |
| `--db-instances` | 1–3. `1` è una singola istanza senza failover; `2` aggiunge uno standby automatico |
| `--db-cpu`, `--db-memory` | Per istanza di database. Vuoto significa `160m` e `1Gi` |

Un parametro vuoto non equivale a uno impostato sullo stesso numero: un parametro vuoto
segue il valore predefinito della piattaforma e si aggiorna quando questo cambia.

La CLI non esegue alcuna convalida, di proposito — i limiti dipendono dal cluster su cui
viene eseguito un progetto e variano a seconda dei provider. Il control plane rifiuta qualsiasi
valore che non può soddisfare indicando il campo relativo. Esegui `rebase cloud compute` per vedere
il costo in €/mese prima e dopo; una modifica viene applicata immediatamente, ripartita proporzionalmente da oggi,
tranne quella che comporta il riavvio del database, che attende una finestra di manutenzione.

## Il resto delle funzionalità

| Gruppo di comandi | Cosa copre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | La tua sessione; `access-token` stampa il token bearer che la CLI invierebbe ora, per script e per il server MCP |
| `tokens` | Token per CI e agenti, ciascuno limitato a un singolo progetto. Vedi [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Associazione di questa directory a un progetto, selezione di un'organizzazione, apertura della console |
| `init`, `claim` | Con `--claim`: un backend attivo senza account e un link per riscattarlo; `claim` stampa nuovamente quel link. Vedi [Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Creazione, visualizzazione elenco, ispezione, eliminazione |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Rilascio e monitoraggio |
| `previews` | Build servite su un indirizzo dedicato tramite `deploy --preview`, e la loro eliminazione. Vedi [Anteprima di una modifica](#anteprima-di-una-modifica) |
| `start`, `stop`, `restart` | Messa in pausa di un progetto e suo ripristino. Un progetto arrestato mantiene la sua sottoscrizione, a meno che la piattaforma non fatturi per i progetti arrestati solo lo storage e il canone di piattaforma; la riga **Billing** della console lo specifica quando applicabile |
| `status`, `metrics`, `debug` | Cosa sta facendo e perché non funziona |
| `cron` | I cron job dell'app deployata e le loro esecuzioni registrate, letti con il tuo accesso `rebase cloud`. Sola lettura |
| `env` | Variabili d'ambiente. `list` non stampa mai i valori; `--secret` è di sola scrittura |
| `app-key` | La chiave scritta da `init --claim` in `.env` come `REBASE_API_TOKEN`, trasferita al riscatto; `rotate` la sostituisce revocando la precedente. Owner e admin |
| `service-key` | `REBASE_SERVICE_KEY`, con privilegi di amministratore sull'API dell'app: data dell'ultima rotazione; `rotate` ne assegna una nuova all'app. Owner e admin |
| `domains` | Domini personalizzati, record DNS da aggiungere e verifica. Un progetto può rispondere su più domini, ciascuno verificato autonomamente; `verify` e `remove` richiedono il dominio su cui intervenire, che può essere omesso solo quando ce n'è uno solo (per `verify`, uno ancora in sospeso). `list --json` restituisce `{ projectId, tenantHost, domains: [...] }` |
| `db` | Collegamento o creazione di un database, connessione da locale, backup, restore e point-in-time recovery |
| `guests` | Gli utenti guest lasciati dall'accesso anonimo: conteggiali, eliminane uno, ripulisci quelli non attivi da tempo. Vedi [Ospiti](/docs/cli/cloud/#guests). Owner e admin |
| `extensions` | La allowlist delle estensioni di Postgres |
| `storage` | Il bucket del progetto |
| `resources` | Quali database e bucket la piattaforma gestisce, a confronto con quanto dichiarato dal codice |
| `compute` | Cosa riserva questo progetto, quanto costa e come modificarlo |
| `usage` | Richieste utilizzate questo mese rispetto alla quota inclusa, e l'eccedenza maturata finora, come conteggiata in fattura. `usage org` elenca ogni progetto dell'organizzazione |
| `clusters` | I cluster su cui vengono eseguiti i tenant. Riservato agli amministratori della piattaforma |
| `settings`, `orgs`, `billing` | Impostazioni del progetto, organizzazioni con i relativi membri e inviti, pagamenti |
| `activity` | L'audit log dell'organizzazione: chi ha deployato, modificato una variabile d'ambiente (per nome), un dominio, un backup, un membro o un token. Owner e admin. Vedi [Scopri chi ha fatto cosa](#scopri-chi-ha-fatto-cosa) |
| `notifications`, `webhooks` | Dove vengono inviati tramite POST gli eventi del progetto: Slack, Discord o qualsiasi URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)). `webhooks` è deprecato ed esce con stato 1 e codice `command_retired` |

Ogni gruppo in quella tabella risponde a `--help` con una pagina dedicata — una riga di utilizzo,
i relativi flag ed esempi — e `--help` non esegue mai il comando. Un test controlla
l'indice delle pagine, quindi un gruppo aggiunto senza una pagina fa fallire la build anziché
rispondere con il sommario. `verify:docs` vincola la tabella stessa a
tale indice: ogni gruppo gestito dalla CLI compare qui esattamente una volta, quindi anche un gruppo
aggiunto senza una riga corrispondente farà fallire la build.

Se inviato tramite pipe, `--help` risponde invece in JSON: la stessa riga di utilizzo, flag ed esempi
strutturati per la lettura anziché sessanta righe di sequenze di escape da terminale.

## Cosa non include la beta

Detto chiaramente, perché scoprirlo dopo è peggio:

- **Nessuna scelta della regione.** Attualmente tutto viene eseguito in un'unica regione. Il modello di posizionamento
  esiste nella piattaforma, ma un progetto non può scegliere una regione.
  I parametri `projects create --provider` e `--region` non costituiscono l'eccezione che sembrano:
  registrano a quale dei target di deploy registrati del control plane appartiene un
  progetto, e ce n'è uno solo, quindi entrambi usano il valore predefinito e nessuno dei due sposta un
  progetto altrove. `rebase cloud projects create --help` riporta la stessa cosa.
- **Non self-service.** L'accesso viene concesso a scaglioni; non esiste una modalità di registrazione e pagamento immediato.
- **Nessun SLA pubblicato** e nessuna conformità SOC 2. Se hai bisogno di uno di essi, indicalo al momento della richiesta
  di accesso anziché darlo per scontato.
- **Nessun deploy per branch** e nessuna GitHub App proprietaria. I deploy hook — URL segreti
  a cui puntare un webhook del repository — sono l'automazione supportata. I [deploy di
  anteprima](#anteprima-di-una-modifica) sono in fase di rilascio e vengono avviati dalla CLI.
- **I token agiscono per conto di una persona.** Un [token](/docs/deployment/cloud-agents/#ci-and-agents) viene generato da un account
  e agisce a suo nome; non esiste ancora un'identità macchina di proprietà dell'organizzazione. Se
  invece effettui l'accesso dalla CI, passa `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD`
  da un archivio di secret — `--password` inserisce la password nella cronologia della shell e
  nella tabella dei processi, segnalandolo prima di effettuare l'accesso. Se il file
  `.rebase/cloud.json` del repository specifica un control plane diverso da quello della piattaforma, passalo
  anche come `--url`: senza un terminale, `login` rifiuta di inviare una password a
  un host indicato unicamente dal file scaricato dal repository.
- **Nessun endpoint pubblico per il database.** Un database gestito non è esposto a
  Internet, quindi l'host mostrato dalla console è l'indirizzo usato dal tuo backend e
  non si risolve a nulla sul tuo computer locale. `rebase cloud db connect` apre una porta locale
  collegata a quel database tramite tunnel attraverso il control plane per tutto il tempo
  in cui viene lasciato in esecuzione — ma non esiste un hostname permanente a cui un servizio
  di terze parti possa connettersi. Quel tunnel e la password dietro
  `rebase cloud db info --reveal` richiedono entrambi il ruolo di owner o admin
  dell'organizzazione: lo stesso richiesto dall'editor SQL di Studio, poiché tutti e tre consentono l'accesso
  a una sessione sui dati di produzione.
- **Eseguire il deploy equivale a eseguire codice con i secret di produzione.** L'ambiente
  dell'app contiene `REBASE_SERVICE_KEY` (admin sulla propria API),
  `DATABASE_URL` e `JWT_SECRET`, pertanto il codice deployato da un membro può leggerli,
  anche se solo owner e admin possono visualizzarli nella console. Invita
  come membro solo persone a cui affideresti tali valori.
- **La service key può essere sostituita.** Le impostazioni del progetto (**Settings**,
  o `rebase cloud service-key rotate`) generano una nuova `REBASE_SERVICE_KEY`
  e riavviano l'app con essa. La vecchia chiave rimane valida fino al completamento del riavvio
  e non oltre, quindi qualsiasi servizio che ne conservasse una copia verrà rifiutato da
  quel momento in poi. Il riscatto (claim) di un progetto esegue la stessa operazione.

## Eseguire invece in self-hosting

Nulla qui costituisce un vincolo di vendor lock-in. La [guida al self-hosting](/docs/deployment/self-hosting/)
esegue la medesima immagine e bundle con `docker compose`, e la
[guida a Kubernetes](/docs/deployment/kubernetes/) riproduce la stessa topologia a partire
dall'Helm chart.
