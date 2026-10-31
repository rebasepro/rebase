---
sourceHash: 3f0338ecb589f00b
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Di cosa si tratta, come collegare e distribuire un progetto, e cosa la beta privata non include ancora.
---

Rebase Cloud esegue lo stesso Rebase open source che ospiteresti in self-hosting — la stessa
immagine pubblicata `rebasepro/server`, lo stesso bundle, lo stesso Postgres. La
differenza sta in chi lo gestisce.

:::note[Beta privata]
Rebase Cloud è in **beta privata**. Attualmente esegue tenant reali e apre gli accessi a
scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi seguenti richiedono un account abilitato.
Tutto il resto su questo sito funziona senza bisogno di un account.
:::

## Di cosa si tratta

Un **progetto** Cloud è costituito da tre elementi che la piattaforma gestisce per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine runtime pubblicata. I deploy consistono nel caricamento di un bundle, non nella compilazione di un container |
| **Database** | Un PostgreSQL gestito, con backup automatizzati e point-in-time recovery |
| **Storage** | Un bucket dedicato, se il tuo progetto utilizza l'archiviazione di file |

Ciascun elemento viene eseguito al primo deploy ed è fatturato in base a quanto
riserva anziché per utente (seat).

**Nel tuo progetto non cambia nulla per essere eseguito lì.** Lo stesso repository
può essere ospitato in self-hosting con `docker compose`, e la via d'uscita è concreta: `rebase build`
produce un bundle avviabile ovunque venga eseguita l'immagine runtime.

## Collegare un progetto

Dalla directory di un progetto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono
flag ed entrambi sono obbligatori — su un terminale vengono richiesti in modo interattivo, mentre
un'esecuzione headless che ne ometta uno termina con `input_required` anziché inventarne
uno. **Il sottodominio non è modificabile in seguito:** è l'host
`<slug>.rebase.website` su cui risponde il progetto, quindi sceglilo con attenzione.

`--link` associa questa directory al progetto nella stessa chiamata, evitando un
passaggio di `link` separato. Scrive `.rebase/cloud.json`, che registra l'ID del progetto
e lo slug. Quel file non è un segreto e non contiene le tue credenziali — queste ultime si trovano
in `~/.rebase/credentials.json`, generato da `login`.

Viene tuttavia sottoposto a commit con il codice, consentendo a un repository clonato di indicare qualsiasi
control plane. Quando l'host proviene solo da quel file e non è né quello ufficiale
della piattaforma né uno a cui hai già effettuato l'accesso, `login` ne mostra il nome e chiede
conferma prima di inviarvi email e password. Senza terminale, o con
`--json`, rifiuta l'operazione con `unknown_control_plane`; passa `--url <host>` (oppure imposta
`REBASE_CLOUD_URL`) per accedere intenzionalmente a quell'endpoint.

**Ti sei registrato con Google, GitHub o LinkedIn?** Il tuo account non ha una password, quindi
accedi con un codice:

```bash
rebase cloud login --code --email me@example.com
```

Il control plane ti invia via email un codice di 6 cifre, valido dieci minuti, che digiti
al prompt. Eseguito semplicemente in un terminale, `rebase cloud login` chiede se
usare la password o un codice. I codici richiedono che il control plane sia in grado di inviare
email; se non può, `--code` lo segnala e termina con `otp_unavailable`.

Se hai attivato l'autenticazione a due fattori, `login` chiede poi il codice della tua
app di autenticazione, oppure uno dei tuoi codici di recupero, in qualunque modo tu abbia
effettuato l'accesso. Né un codice di accesso né un secondo fattore possono essere digitati senza un terminale.
Per uno script, crea un token di accesso nella console (**Settings → Access
tokens**) e imposta `REBASE_TOKEN`; vedi [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

Una password errata risponde con `invalid_credentials` indicando le stesse due vie d'accesso, dato che
la causa più comune è un account che non ne ha mai avuta una.

`billing setup` associa una carta all'organizzazione, una sola volta. È posizionato intenzionalmente
all'inizio della sequenza: il primo deploy di un progetto viene rifiutato in assenza di essa, e
scoprirlo solo dopo aver completato l'upload di un bundle sarebbe l'ordine peggiore.

Dopodiché, la pagina **Billing** della console elenca le fatture dell'organizzazione,
ciascuna con la pagina ospitata da Stripe e il PDF, e mostra l'anteprima della prossima fattura di ogni
progetto. `rebase cloud billing invoices` e `rebase cloud billing upcoming`
stampano le stesse informazioni. Entrambe sono riservate a owner e admin dell'organizzazione. Dove la
piattaforma lo offre, **Manage billing** apre il portale clienti di Stripe per la
carta, i dati di fatturazione e le fatture passate.

Con una carta già registrata, creare un altro progetto nella console non richiede
un secondo pagamento: il progetto viene fatturato su quella carta e viene distribuito. Se la carta
viene rifiutata, o la banca richiede la conferma del pagamento, la console ti porta a
**Billing**, dove **Fix your card** salva un'altra carta e **Complete the
payment** apre la fattura di Stripe.

Ciò che un progetto ha consumato appare nella sua panoramica, sotto **Usage this month**, e
per tutti i progetti insieme nella pagina **Billing**: le richieste rispetto alla
quota inclusa (la barra diventa ambra all'80%), gli errori 5xx, l'eccedenza finora
e la proiezione del mese a questo ritmo. L'eccedenza è calcolata dallo
stesso codice che la comunica a Stripe, quindi è ciò che conterrà la fattura; compare
nella fattura del mese successivo. `rebase cloud usage` stampa le
stesse informazioni, e `rebase cloud usage org` l'intera organizzazione. Qualsiasi membro può
consultarle. I valori dicono ciò che non sono ancora in grado di vedere: lo storage a oggetti non è misurato,
quindi non viene fatturata alcuna eccedenza di storage; finché un progetto esegue due o più pod dell'app,
le sue richieste non vengono conteggiate; e un giorno con campioni mancanti viene sottostimato. Un
progetto con autoscaling mostra anche i pod eseguiti oltre `--replicas`, in ore-pod,
quanto costano alle sue tariffe e se questa piattaforma li addebita già. Un
progetto rivendicato da un agente conta solo i giorni dalla rivendicazione in poi: prima di
essa, il progetto era della piattaforma.

Un progetto esistente si collega senza crearne uno nuovo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Un unico comando, senza flag da ricordare. Il file `rebase.json` di uno scaffold dichiara
`runtime: "managed"` per il proprio backend, e `deploy` legge tale dichiarazione — lo
notifica durante l'esecuzione (`rebase.json declares runtime: managed — deploying a
bundle`), compila l'app in `dist-bundle`, carica il bundle, lo esegue sull'immagine
runtime pubblicata e segue il deployment fino a uno stato finale. Il codice di uscita
costituisce il verdetto, quindi la stessa riga funziona in modo non presidiato nella CI.

Termina indicando dove risponde ora ogni app e se la nuova versione è live:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa che l'indirizzo ha risposto dopo il build: `/health` del backend ha restituito `ok` e la pagina di un'app statica si è caricata (da questo deployment, quando è la piattaforma a servirla). Il controllo attende fino a `--live-timeout` secondi, 60 di default; `0` lo salta. Se un'app non risponde in tempo il deploy esce comunque con codice zero, perché il deployment è riuscito, e l'ultima riga dice quale app non ha risposto e perché. Un deploy fallito termina invece con una riga che indica l'app e il motivo, con `rebase cloud logs` per il log completo del build.

Gli script passano `--json` per ottenere un oggetto con gli stessi dati — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e l'id del deployment. A differenza del resto di `rebase cloud`, `deploy` non passa da solo a JSON in una pipe.

Ciò che tale runtime consente — pacchetti e moduli nativi, memoria e istanze, timeout e dimensioni del body, filesystem, secret, storage e rete in uscita — è descritto nella relativa pagina:
[Runtime backend gestito](/docs/deployment/managed-runtime/).

Per distribuire un artefatto compilato in precedenza — ad esempio, un job di CI che compila una volta
e distribuisce due volte — punta alla directory invece di ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

L'uscita dal runtime gestito avviene tramite un flag dedicato, `--eject`, e null'altro lo
richiede: una build che sposterebbe un progetto gestito su un'immagine container proprietaria
viene rifiutata finché non lo specifichi esplicitamente. In precedenza si usava `--force`, che associava
l'azione meno reversibile della CLI allo stesso termine usato per "sovrascrivi questo
file"; ora è un'opzione non riconosciuta anziché un alias, arrestando così gli script che
la utilizzavano.

### Il controllo della sintassi prima dell'upload

I file di un'app statica vengono serviti così come sono. Quando il suo `build` si limita a copiare script scritti a mano in `output`, nessuno li ha mai analizzati, e un file con un refuso va online e impedisce alla pagina di caricarsi. Per questo, prima di caricare qualsiasi cosa, `deploy` analizza ogni file `.js`, `.mjs` e `.cjs` nell'`output` di ogni app statica, insieme a ogni `<script>` inline nei suoi file `.html`. Vale sia per un'app statica distribuita da sola sia per le app statiche incorporate nel bundle del backend. Un errore di sintassi interrompe il deploy indicando file, riga e colonna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json` il `code` dell'errore è `syntax_error`. Gli script inline che un browser non esegue come JavaScript vengono saltati: JSON, import map, template e qualsiasi altro `type` non JavaScript, uno `<script src>` e uno script che contiene ancora markup di template non renderizzato come `{{ }}`. Un file `.js` passa se si può analizzare come script classico o come modulo, perché è la pagina a deciderlo. Nulla sotto `node_modules` viene letto, né un `--bundle-dir` già compilato. `--no-verify` salta il controllo per un singolo deploy.

Monitora l'avanzamento:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` riporta `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la
piattaforma sta lavorando regolarmente ed eseguire un polling è la procedura corretta; quando indica
un valore, significa che qualcosa è in attesa di un tuo intervento.

## Anteprima di una modifica

```bash
rebase cloud deploy --preview
```

Compila e carica esattamente ciò che farebbe `deploy`, ma lo serve a un indirizzo
tutto suo, come `https://shop--k3x9ab.rebase.website`. La produzione continua a servire
ciò che serviva prima. Il deploy stampa l'indirizzo dell'anteprima al termine della
build.

Per mantenere lo stesso indirizzo tra un deploy e l'altro, dai un nome all'anteprima.
Eseguire di nuovo il deploy con lo stesso nome la aggiorna:

```bash
rebase cloud deploy --preview-name new-checkout
```

Ciò con cui un'anteprima comunica dipende da ciò che hai distribuito:

- **`rebase cloud deploy --preview`** mostra l'anteprima del backend, con le sue app statiche
  incorporate, nello stesso modo in cui la produzione le esegue. Ottiene un backend proprio su
  un **database vuoto tutto suo**, mai quello di produzione. Avviarsi sul database di
  produzione applicherebbe a quest'ultimo lo schema e le regole di accesso dell'anteprima.
- **`rebase cloud deploy web --preview`** mostrerebbe l'anteprima di una singola app statica
  da sola, con le sue pagine che chiamano il backend di **produzione**. Per farlo serve un control plane
  che serva i siti statici da soli, cosa che Rebase Cloud non fa ancora: rifiuta
  l'operazione con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Mostra invece l'anteprima del
  backend, che serve le app statiche incorporate al suo interno; un progetto senza
  backend gestito non può ancora avere un'anteprima.

Un'anteprima non carica sorgenti e non registra app né hostname, perché ciascuna di
queste operazioni modificherebbe il progetto di produzione. `--source` e `--eject` non possono essere
combinati con `--preview`. Ciascuno compila un'immagine container per la produzione.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` senza `--preview` mostra sempre quelli di produzione.

La pagina **Deployments** della console elenca le stesse anteprime, e permette di aprire, di vedere il
log di build o di eliminare ciascuna di esse. Crearne una resta un passaggio da CLI.

Un'anteprima scade una settimana dopo l'ultimo deploy effettuato su di essa.

Al termine, il deploy verifica che l'indirizzo dell'anteprima risponda, come fa un
deploy di produzione (`--live-timeout <seconds>`, `0` per saltare il controllo). Il certificato
di una nuova anteprima può richiedere uno o due minuti, quindi un deploy riuscito può
segnalare che l'indirizzo non risponde ancora.

Un'anteprima del backend è fatturata come una unità app alla dimensione predefinita (100m di CPU
e 384 MiB di memoria, alla tariffa della tua app per la sua regione e capacità),
ripartita pro-rata per tutto il tempo in cui esiste, e compare nel preventivo mensile
del progetto nella console. `rebase cloud deploy --preview` ne stampa lo stesso preventivo,
al mese (`cost` con `--json`). Avviarne una richiede una carta registrata, come un deploy
di produzione. Un primo deploy che
fallisce prima che qualcosa venga eseguito viene rimosso anziché fatturato. Un progetto può eseguire
tre anteprime del backend alla volta.

Ogni nuovo indirizzo di anteprima ottiene un proprio certificato TLS da Let's Encrypt,
che consente a un dominio 50 nuovi certificati a settimana, condivisi con ogni sito di
produzione su di esso. Le anteprime possono usarne 20 in qualsiasi periodo di 7 giorni, su tutta la piattaforma. Oltre
questo limite, una nuova anteprima viene rifiutata (`429`, `preview_cert_budget`) indicando quando potrà
essere distribuita; ridistribuire un'anteprima già esistente non conta mai.

Il database di un'anteprima del backend è un secondo database sul Postgres **di produzione**:
dati propri, ma la stessa istanza e lo stesso disco. È limitato a 10
connessioni, così le anteprime non possono esaurire quelle di produzione, e a 2 GB: un'anteprima
il cui database supera tale soglia viene messa in pausa. Il suo backend si ferma, il suo indirizzo smette di
rispondere, `rebase cloud previews` e la console la mostrano come `paused` con il
motivo, e gli owner e gli admin del progetto ricevono una notifica (`preview.paused`). I suoi
dati vengono conservati fino alla scadenza. Distribuiscila di nuovo per riavviarla (viene messa di nuovo in pausa
finché il database è ancora troppo grande), oppure eliminala. Un'anteprima in pausa viene comunque
fatturata finché non viene eliminata o non scade. Elimina le anteprime che non ti servono più. Le estensioni installate in produzione non sono
installate nel database di un'anteprima.

Le anteprime sono in fase di rilascio. Un control plane che non le serve ancora rifiuta
`--preview` con `previews_unavailable` e non distribuisce nulla.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback reimposta il progetto su quanto distribuito da una precedente release
riuscita, senza mai ricompilare — l'utilità di un rollback sta nel distribuire un
artefatto che è già stato eseguito con successo.

I requisiti per i deployment idonei dipendono dal modo in cui il progetto è stato distribuito, ed entrambi
i tipi sono supportati:

| Come è stato distribuito | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (build dai sorgenti) | L'immagine pubblicata da quella build |
| `rebase cloud deploy --bundle` (runtime della piattaforma) | Il bundle distribuito da quel deploy, sulla versione di runtime attualmente in esecuzione nel progetto |

Le app statiche incorporate nel bundle del backend (un semplice `rebase cloud deploy` in un progetto con backend) fanno parte di quel bundle, quindi tornano indietro insieme a esso.

Un'app statica distribuita da sola (`rebase cloud deploy <app>`) non supporta ancora il rollback. Il suo deployment registra quale app ha pubblicato, ma nessun bundle, quindi il control plane non ha nulla da cui ripristinarla. La soluzione è distribuire di nuovo l'ultima versione funzionante, per esempio dal commit precedente a quello difettoso. Dopo un deploy di questo tipo, `deploy` lo segnala invece di rimandare a `rollback`, e `rollback`
senza un id rifiuta l'operazione invece di ridistribuire il backend che è già in servizio.

Quindi un rollback richiede un deployment che abbia registrato uno dei due elementi, il che significa un progetto che ha effettuato il deploy con successo almeno due volte. `rebase cloud deployments` contrassegna quelli idonei e `--json` riporta `rollbackable` per ogni riga insieme all'`image` o al `bundle` che verrebbe ripristinato.

Due categorie di deployment vengono rifiutate, e la CLI specifica quali: quelli non andati
a buon fine e quelli precedenti all'introduzione della registrazione degli artefatti sulla piattaforma. In
entrambi i casi non si effettuano ipotesi — fare ipotesi significherebbe distribuire l'ultimo elemento
compilato o caricato asserendo di ripristinare quello selezionato — pertanto distribuisci direttamente
la versione desiderata.

Ogni deploy riuscito si conclude indicando la via del ritorno (`rebase cloud rollback`), così è in vista nel momento in cui ci si accorge di un rilascio difettoso.

Un rollback aggiunge un nuovo deployment invece di riavvolgere la cronologia, e attende che la versione ripristinata sia operativa prima di segnalare l'esito positivo. Seguilo con `rebase cloud logs -f`.

## Ripristinare il database a un punto nel tempo

Un database gestito può essere ripristinato a qualsiasi minuto all'interno della sua finestra di recupero,
da **Database → Backups** nella console o con la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Si procede in due passaggi. Prima una copia ripristinata viene preparata accanto al database attivo;
la tua app continua a funzionare su quello attivo, e lo storage della copia viene fatturato finché
non esegui il cutover o la scarti.
Poi, quando la copia è pronta, il cutover reindirizza l'app verso di essa e la riavvia.
Ciò che è stato scritto dopo l'istante di destinazione non è nella copia. Il database originale
viene conservato come via di ritorno, e continua a fatturare lo storage; tornare indietro,
rimuoverlo o un secondo ripristino passano dal supporto. Solo un owner o un admin
può preparare, eseguire il cutover o scartare, e la console chiede il nome del progetto
prima di eseguire il cutover.

## Proteggere il tuo account

Il tuo account della console può raggiungere database di produzione, secret e fatturazione, quindi
proteggilo di conseguenza. Apri **Account security** dal menu sotto il tuo avatar
nella console (oppure vai a `/account`). La pagina è tua, non di
un'organizzazione: ciò che imposti lì vale in ogni organizzazione a cui appartieni.

- **Verifica in due passaggi.** Attivala con qualsiasi app di autenticazione (1Password,
  Google Authenticator, Authy). La pagina mostra una chiave di configurazione da aggiungere all'app, oppure un
  link che apre l'app con la chiave già inserita su un telefono, poi chiede il
  codice di 6 cifre che l'app mostra. Da quel momento, ogni accesso richiede un codice,
  che tu acceda con una password, con Google o con GitHub.
- **Codici di recupero.** Attivandola ricevi dieci codici monouso, mostrati una sola volta.
  Ciascuno ti fa accedere al posto del codice dell'app di autenticazione se perdi il
  telefono, quindi salvali prima di chiudere la finestra. **New recovery codes**
  li sostituisce, e i vecchi smettono di funzionare. Disattivare la verifica in due passaggi
  e ottenere nuovi codici richiedono entrambi un codice come primo passo.
- **Password.** Cambiarla ti disconnette da ogni altro dispositivo. Un account
  creato con Google, GitHub o LinkedIn non ha una password; la pagina offre di
  inviarti via email un link per impostarne una.
- **Dispositivi connessi.** Ogni browser e terminale che ha effettuato l'accesso al tuo account,
  con il suo indirizzo e il momento dell'accesso. Disconnetti qualsiasi dispositivo che non
  riconosci, oppure tutti insieme.

I [token di accesso](/docs/deployment/cloud-agents/#ci-and-agents) non sono sessioni e non richiedono un secondo
fattore, quindi la CI continua a distribuire dopo che lo hai attivato. Revoca un token di cui non ti
fidi più in **Settings → Access tokens**.

## Invitare il tuo team

**Members → Invite member** fornisce un link da copiare (inviato via email quando questo control plane
invia email) che funziona una sola volta, per 7 giorni, per un account che ha verificato quell'indirizzo;
nessuno entra finché non accetta. Invita un admin o un membro, e rendilo
owner dopo che è entrato. Owner e admin la vedono, la rinviano o la revocano in
**Pending invitations**; da un terminale, [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Vedere chi ha fatto cosa

La pagina **Activity** della console e `rebase cloud activity` mostrano a
owner e admin dell'organizzazione chi ha distribuito, impostato o rivelato una variabile
d'ambiente (per nome, mai per valore), modificato un dominio, ripristinato un backup,
ridimensionato, fermato o eliminato un progetto, cambiato il ruolo di un membro o creato un
token, e quando. Le **Settings** di un progetto rimandano alle sue voci; una voce
relativa a un progetto eliminato resta. Uno script la legge con un token creato con
`--can audit` sull'organizzazione. Le voci vengono conservate per un anno. I filtri sono in
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agenti

Un job di CI o un agente non dovrebbe utilizzare la tua password. Forniscigli un token limitato a
poche azioni su un singolo progetto, creato da un terminale autenticato con
`rebase cloud tokens create --project shop --can deploy,logs`, e impostalo come
`REBASE_TOKEN`. La fatturazione, il registro delle attività e le impostazioni di notifica
di un'organizzazione sono capacità a sé stanti (`--can billing`, `audit`,
`notifications`) che un token possiede solo se richieste. Le capacità, un
workflow di GitHub Actions e ciò che resta a uso esclusivo di un utente autenticato sono in
[CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend senza account

`rebase cloud init --claim` dà a un'app un backend attivo prima che chiunque si sia
registrato, e stampa un URL di rivendicazione per consentire alla persona di tenerlo; un progetto che nessuno rivendica
entro 72 ore viene eliminato. Ciò che il token del progetto non rivendicato può fare, il
`REBASE_API_TOKEN` che scrive e ciò che cambia con la rivendicazione sono in
[Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Risorse di calcolo e relativi costi

Il prezzo di un progetto viene calcolato in base alle risorse riservate, non in base a un piano (tier). `compute` mostra
ogni parametro e il preventivo dettagliato elaborato dal control plane. (`rebase cloud
resources` è un comando diverso: mostra i database e i bucket dichiarati dal codice
e se ciascuno di essi è stato allocato — consulta i [riferimenti della CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Risorse richieste dall'app per istanza, ad es. `500m` e `2Gi`. Vuoto indica il valore predefinito della piattaforma — `100m` e `384Mi`, con burst fino a 2 CPU e `2Gi` |
| `--replicas` | Istanze sempre attive: il limite minimo dell'autoscaler e ciò che l'abbonamento del progetto fattura mensilmente |
| `--autoscale-max` | 1–16. Il limite massimo raggiungibile. Le istanze che l'autoscaler aggiunge oltre `--replicas` sono misurate per pod-secondo alle stesse tariffe, e addebitate solo dove la piattaforma lo ha attivato; **Usage this month** indica quale caso si applica. `--no-autoscale` lo disattiva |
| `--autoscale-cpu-target` | 10–95. L'utilizzo di CPU mantenuto dall'autoscaler, calcolato sulla richiesta anziché sul limite. Vuoto indica 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica, ma soggetta a riavvio senza preavviso |
| `--db-instances` | 1–3. `1` corrisponde a un'istanza singola senza failover; `2` aggiunge uno standby automatico |
| `--db-cpu`, `--db-memory` | Per istanza di database. Vuoto corrisponde a `160m` e `1Gi` |

Un parametro lasciato vuoto non equivale a uno impostato sullo stesso valore numerico: un parametro
vuoto segue il valore predefinito della piattaforma e si aggiorna con esso.

La CLI non esegue alcuna convalida sui parametri, intenzionalmente — i vincoli appartengono al cluster
su cui viene eseguito il progetto e variano in base al provider. Il control plane rifiuta qualsiasi
valore che non può soddisfare indicando il campo interessato. Esegui `rebase cloud compute` per visualizzare
il costo in €/mese prima e dopo la modifica; le variazioni si applicano immediatamente, ripartite pro-rata a partire
da oggi, ad eccezione di quelle che comportano il riavvio del database, che attendono una finestra di manutenzione.

## Il resto dei comandi

| Gruppo di comandi | Cosa copre |
|---|---|
| `login`, `logout`, `whoami` | La tua sessione |
| `tokens` | Token per CI e agenti, ciascuno limitato a un singolo progetto. Vedi [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Associazione della directory a un progetto, selezione di un'organizzazione, apertura della console |
| `init`, `claim` | Con `--claim`: un backend attivo senza account e un link per rivendicarlo; `claim` stampa di nuovo quel link. Vedi [Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Creazione, elenco, ispezione, eliminazione |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Distribuzione e monitoraggio |
| `previews` | Build servite al proprio indirizzo da `deploy --preview`, e la loro eliminazione. Vedi [Anteprima di una modifica](#anteprima-di-una-modifica) |
| `start`, `stop`, `restart` | Sospensione di un progetto e ripristino. Un progetto fermato mantiene il suo abbonamento, a meno che la piattaforma non fatturi i progetti fermati solo per lo storage e la quota di piattaforma; la riga **Billing** della console lo indica quando accade |
| `status`, `metrics`, `debug` | Stato di esecuzione e diagnostica di eventuali errori |
| `cron` | Cron job dell'applicazione distribuita e relative esecuzioni registrate, consultati tramite l'account `rebase cloud`. Sola lettura |
| `env` | Variabili d'ambiente. `list` non mostra mai i valori; `--secret` è di sola scrittura |
| `app-key` | La chiave che `init --claim` ha scritto in `.env` come `REBASE_API_TOKEN`, consegnata con la rivendicazione; `rotate` la sostituisce e revoca la vecchia. Owner e admin |
| `service-key` | `REBASE_SERVICE_KEY`, admin sull'API dell'app stessa: quando è stata ruotata l'ultima volta; `rotate` assegna all'app una nuova chiave. Owner e admin |
| `domains` | Domini personalizzati, record DNS da configurare e verifica. Un progetto può rispondere su più domini, ciascuno verificato singolarmente; `verify` e `remove` richiedono il dominio su cui operare, che può essere omesso solo se ne è presente uno solo (per `verify`, solo se ancora in sospeso). `list --json` restituisce `{ projectId, tenantHost, domains: [...] }` |
| `db` | Collegamento o creazione di un database, connessione locale, backup, ripristino e point-in-time recovery |
| `guests` | <span class="since-badge" data-since="0.27">Da 0.27</span> Gli utenti ospite lasciati dall'accesso anonimo: contarli, eliminarne uno, rimuovere quelli non visti da una certa età. Vedi [Guests](/docs/cli/cloud/#guests). Owner e admin |
| `extensions` | Allowlist delle estensioni Postgres |
| `storage` | Il bucket del progetto |
| `resources` | Database e bucket gestiti dalla piattaforma, a fronte di quanto dichiarato nel codice |
| `compute` | Risorse riservate dal progetto, relativi costi e modalità di modifica |
| `usage` | Richieste usate questo mese rispetto alla quota inclusa, e l'eccedenza finora, come la conta la fattura. `usage org` elenca ogni progetto dell'organizzazione |
| `clusters` | I cluster su cui girano i tenant. Riservato agli amministratori della piattaforma |
| `settings`, `orgs`, `billing` | Impostazioni di progetto, organizzazioni con i loro membri e inviti, fatturazione |
| `activity` | Il registro di audit dell'organizzazione: chi ha distribuito, modificato una variabile d'ambiente (per nome), un dominio, un backup, un membro o un token. Owner e admin. Vedi [Vedere chi ha fatto cosa](#vedere-chi-ha-fatto-cosa) |
| `notifications`, `webhooks` | Dove vengono inviati in POST gli eventi del progetto: Slack, Discord o qualsiasi URL https ([Notifiche di Cloud](/docs/deployment/cloud-notifications/)). `webhooks` è stato dismesso e termina con codice 1 e `command_retired` |

Ogni gruppo presente nella tabella risponde a `--help` con una pagina dedicata — sintassi
d'uso, flag ed esempi — e `--help` non esegue mai il comando. Un test verifica
l'indice delle pagine, quindi l'aggiunta di un gruppo privo di pagina fa fallire la build anziché
mostrare il sommario. Il comando `verify:docs` vincola la tabella stessa a tale
indice: ogni gruppo gestito dalla CLI deve comparire qui esattamente una volta; in caso contrario,
la build fallirà.

Se reindirizzato in una pipe, `--help` restituisce una risposta in formato JSON: la stessa sintassi,
i flag e gli esempi strutturati per la lettura programmatica, anziché decine di righe di sequenze di escape da terminale.

## Cosa non include la beta

Chiarito in modo trasparente, per evitare sorprese successive:

- **Nessuna scelta della regione.** Al momento tutto viene eseguito in un'unica regione. Il modello di
  allocazione è predisposto nella piattaforma, ma i progetti non possono selezionare la regione.
  I parametri `projects create --provider` e `--region` non fanno eccezione:
  registrano a quale dei target di deploy registrati nel control plane appartiene il progetto;
  essendocene uno solo, entrambi assumono quel valore predefinito e nessuno dei due sposta il
  progetto altrove. `rebase cloud projects create --help` riporta la medesima indicazione.
- **Nessun self-service.** L'accesso viene accordato a scaglioni; non è possibile iscriversi e pagare autonomamente.
- **Nessun SLA pubblico** e nessuna certificazione SOC 2. Se hai bisogno di uno di questi requisiti,
  segnalalo nella richiesta di accesso anziché darlo per scontato.
- **Nessun deploy per branch**, e nessuna GitHub App proprietaria. I deploy hook —
  URL segreti a cui puntare un webhook del repository — rappresentano il metodo di automazione supportato. I [deploy
  di anteprima](#anteprima-di-una-modifica) sono in fase di rilascio e si avviano dalla CLI.
- **I token agiscono a nome di una persona.** Un [token](/docs/deployment/cloud-agents/#ci-and-agents) viene generato da un account
  e opera per suo conto; non esistono ancora identità macchina a livello di organizzazione. Se
  effettui l'accesso da CI, passa `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD`
  da un secret manager — `--password` inserisce la password nella cronologia della shell e
  nella tabella dei processi, avvisandoti prima di completare il login. Se il file
  `.rebase/cloud.json` del repository indica un control plane diverso da quello ufficiale della piattaforma,
  passalo anche come `--url`: in assenza di terminale, `login` si rifiuta di inviare le credenziali
  a un host indicato esclusivamente dal file clonato.
- **Nessun endpoint pubblico per il database.** Un database gestito non è esposto a
  Internet, pertanto l'host mostrato nella console è l'indirizzo interno del tuo backend e
  non è risolvibile dal tuo computer locale. Il comando `rebase cloud db connect` apre una porta
  locale verso quel database attraverso un tunnel gestito dal control plane per tutto
  il tempo in cui resta in esecuzione — ma non è disponibile alcun hostname permanente a cui un servizio
  terzo possa collegarsi. Tale tunnel, così come la password mostrata da
  `rebase cloud db info --reveal`, richiedono il ruolo di owner o admin dell'organizzazione:
  lo stesso richiesto dall'editor SQL di Studio, poiché in tutti e tre i casi si ottiene
  una sessione di accesso ai dati di produzione.
- **Distribuire significa eseguire codice con i secret di produzione.** L'ambiente
  dell'app contiene `REBASE_SERVICE_KEY` (admin sulla propria API),
  `DATABASE_URL` e `JWT_SECRET`, quindi il codice distribuito da un membro può leggerli,
  anche se solo owner e admin possono rivelarli nella console. Invita
  come membro solo qualcuno di cui ti fideresti con questi valori.
- **La service key può essere sostituita.** Le **Settings** del progetto
  (o `rebase cloud service-key rotate`) emettono una nuova `REBASE_SERVICE_KEY`
  e riavviano l'app su di essa. La vecchia chiave funziona fino al termine del riavvio,
  e non dopo, quindi qualsiasi cosa che l'abbia copiata viene rifiutata da
  quel momento. Rivendicare un progetto produce lo stesso effetto.

## Eseguire in self-hosting

L'utilizzo della piattaforma non comporta alcun vincolo (lock-in). La [guida al self-hosting](/docs/deployment/self-hosting/)
consente di eseguire la medesima immagine e bundle tramite `docker compose`, e la
[guida a Kubernetes](/docs/deployment/kubernetes/) riproduce la stessa topologia tramite
il relativo Helm chart.
