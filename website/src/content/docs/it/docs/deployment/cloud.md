---
sourceHash: 325c29335f5ae263
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Cos'è, come si collega e si distribuisce un progetto, e cosa la beta privata non include ancora.
---

Rebase Cloud esegue lo stesso Rebase open source che ospiteresti in autonomia — la stessa
immagine `rebasepro/server` pubblicata, lo stesso bundle, lo stesso Postgres. La
differenza sta in chi lo gestisce.

:::note[Beta privata]
Rebase Cloud è in **beta privata**. Esegue tenant reali già oggi e apre l'accesso
a scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi seguenti richiedono un account a cui è stato concesso l'accesso.
Tutto il resto su questo sito funziona senza di esso.
:::

## Cos'è

Un **progetto** Cloud è composto da tre elementi che la piattaforma gestisce per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine di runtime pubblicata. I deploy consistono nel caricamento di un bundle, non nella build di un container |
| **Database** | Un PostgreSQL gestito, con backup automatici e point-in-time recovery |
| **Storage** | Un bucket dedicato, se il tuo progetto utilizza l'archiviazione di file |

Ciascuno viene eseguito con provisioning al tuo primo deploy, e ciascuno viene fatturato in base a ciò che
riserva piuttosto che per utente (per-seat).

**Non cambia nulla nel tuo progetto per essere eseguito lì.** Lo stesso repository
può essere self-hosted con `docker compose`, e la via d'uscita è reale: `rebase build`
produce un bundle che si avvia ovunque sia eseguibile l'immagine di runtime.

## Collegare un progetto

Dalla directory di un progetto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` apre la console nel tuo browser e stampa un codice breve. Verifica che
la console mostri lo stesso codice e approva l'accesso da lì: il terminale
acquisisce la sessione e la scrive in `~/.rebase/credentials.json`. Se non hai
effettuato l'accesso alla console, accedi prima lì con il metodo che preferisci,
inclusi Google e GitHub. Tramite SSH, `rebase cloud login --no-browser` stampa il link
da aprire sulla tua macchina locale.

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono
flag, ed entrambi sono obbligatori — su un terminale vengono richiesti in modo interattivo, e una
sessione headless che ometta uno dei due termina con `input_required` anziché inventarne
uno. **Il sottodominio non è modificabile in seguito:** è l'host
`<slug>.rebase.website` su cui risponde il progetto, quindi sceglilo con attenzione.

`--link` associa questa directory al progetto nella stessa chiamata, quindi non è
necessario un passaggio `link` separato. Questo scrive `.rebase/cloud.json`, che memorizza l'ID
e lo slug del progetto. Quel file non è un segreto e non rappresenta le tue credenziali — queste ultime risiedono
in `~/.rebase/credentials.json`, scritto da `login`.

Viene tuttavia committato con il codice, quindi un repository clonato può specificare qualsiasi
control plane. Quando l'host proviene solo da quel file e non è né quello
proprietario della piattaforma né uno a cui hai già effettuato l'accesso in precedenza, `login` ne indica il nome e chiede
conferma prima di inviare lì la tua email e la tua password. Senza un terminale, o con
`--json`, rifiuta l'operazione con `unknown_control_plane`; passa `--url <host>` (o imposta
`REBASE_CLOUD_URL`) per accedere intenzionalmente a quell'indirizzo.

Per accedere senza browser, passa la tua email: `rebase cloud login --email
me@example.com` richiede la password. **Ti sei registrato con Google, GitHub o
LinkedIn?** Il tuo account non ha una password, quindi usa un codice:

```bash
rebase cloud login --code --email me@example.com
```

Il control plane ti invierà via email un codice a 6 cifre, valido per dieci minuti, da digitare
al prompt. Con `--email` e senza password, `rebase cloud login` chiede
se utilizzare la password o un codice. I codici richiedono che il control plane sia in grado di inviare
email; in caso contrario, `--code` lo segnala ed esce con `otp_unavailable`.

Se hai abilitato l'autenticazione a due fattori, `login` richiede quindi il codice dalla
tua app di autenticazione o uno dei tuoi codici di recupero, a seconda del metodo di accesso
utilizzato. Tramite browser, la console lo richiede al momento del login. Né un codice di accesso né un secondo fattore possono essere digitati senza un terminale.
Per uno script, crea un access token nella console (**Settings → Access
tokens**) e imposta `REBASE_TOKEN`; consulta [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

Una password errata risponde con `invalid_credentials` offrendo gli stessi due metodi di accesso, poiché
la causa più comune è un account che non ne ha mai avuta una.

`billing setup` associa una carta all'organizzazione, una sola volta. È posizionato per primo nella
sequenza intenzionalmente: il primo deploy di un progetto viene rifiutato senza di essa, e
scoprirlo dopo il completamento del caricamento del bundle sarebbe l'ordine peggiore.

Successivamente, la pagina **Billing** della console elenca le fatture dell'organizzazione,
ciascuna con la pagina ospitata di Stripe e il relativo PDF, e mostra un'anteprima della fattura successiva per ciascun
progetto. `rebase cloud billing invoices` e `rebase cloud billing upcoming`
stampano le stesse informazioni. Entrambi sono riservati ai proprietari (owner) e agli amministratori (admin) dell'organizzazione. Laddove la
piattaforma lo offra, **Manage billing** apre il portale clienti di Stripe per la
carta, i dettagli di fatturazione e le fatture passate.

Con una carta già registrata, la creazione di un altro progetto nella console non richiede
alcun secondo pagamento: il progetto viene fatturato su quella carta e distribuito. Se la carta
viene rifiutata o la banca richiede la conferma del pagamento, la console ti reindirizza a
**Billing**, dove **Fix your card** consente di salvare un'altra carta e **Complete the
payment** apre la fattura di Stripe.

L'utilizzo di un progetto viene mostrato nella sua panoramica, sotto **Usage this month**, e
contemporaneamente per tutti i progetti nella pagina **Billing**: richieste rispetto alla
soglia inclusa (la barra diventa ambra all'80%), errori 5xx, l'overage finora accumulato
e l'andamento del mese a questo ritmo. L'overage viene calcolato dallo
stesso codice che lo trasmette a Stripe, pertanto corrisponde esattamente a ciò che sarà riportato in fattura;
comparirà nella fattura del mese successivo. `rebase cloud usage` stampa
gli stessi dati, e `rebase cloud usage org` quelli dell'intera organizzazione. Qualsiasi membro può visualizzarli.
I dati segnalano ciò che non possono ancora monitorare: l'object storage non viene misurato,
quindi non viene fatturato alcun overage di archiviazione; quando un progetto esegue due o più pod applicativi,
le relative richieste non vengono conteggiate; e un giorno con campionamenti mancati genera un sottoconteggio. Un
progetto con autoscaling mostra anche i pod eseguiti oltre `--replicas`, in ore-pod,
il loro costo alle tariffe dedicate e se questa piattaforma li addebita già. Un
progetto riscattato da un agente conteggia solo i giorni a partire dal riscatto: prima
di esso, il progetto apparteneva alla piattaforma.

Un progetto esistente può essere collegato senza doverne creare uno nuovo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Eseguire il deploy

```bash
rebase cloud deploy
```

Un solo comando, e nessun flag da ricordare. Il `rebase.json` di uno scaffold dichiara
`runtime: "managed"` per il proprio backend, e `deploy` legge tale dichiarazione — lo
segnala durante l'esecuzione (`rebase.json declares runtime: managed — deploying a
bundle`), compila l'applicazione in `dist-bundle`, carica il bundle, lo esegue sull'immagine
di runtime pubblicata e segue il deployment fino a uno stato terminale. Il codice di uscita
costituisce il verdetto, quindi la stessa riga funziona in modo non presidiato nella CI.

Al termine, indica dove risponde ciascuna app e se la nuova versione è
attiva lì:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa che l'indirizzo ha risposto dopo la build: il percorso `/health` del backend
ha restituito `ok`, e la pagina di un'app statica si è caricata (da questo deployment, quando servita dalla
piattaforma). La verifica attende fino a `--live-timeout` secondi, 60 per
impostazione predefinita; `0` la salta. Se un'app non risponde in tempo, il deploy termina comunque con codice
zero, poiché il deployment ha avuto successo, e l'ultima riga specifica quale app non ha
risposto e il motivo. Un deploy fallito termina invece su una singola riga, indicando l'app e il
motivo, rimandando a `rebase cloud logs` per il log completo di build.

Gli script possono passare `--json` per ricevere un unico oggetto contenente i medesimi dettagli — `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` e l'ID del deployment. A differenza del resto dei comandi di
`rebase cloud`, `deploy` non passa automaticamente a JSON quando usato in una pipe.

Ciò che questo runtime consente — pacchetti e moduli nativi, memoria e istanze,
timeout e dimensioni del body, filesystem, secret, storage e traffico di rete
in uscita — è illustrato nella pagina dedicata:
[Runtime backend gestito](/docs/deployment/managed-runtime/).

Per distribuire un artefatto compilato in precedenza — ad esempio in un job di CI che compila una volta e
distribuisce due volte — punta direttamente alla directory anziché ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

L'uscita dal runtime gestito richiede un flag dedicato, `--eject`, e nient'altro lo
richiede: una build che trasferirebbe un progetto gestito su un'immagine container di cui assume
la titolarità viene rifiutata finché non lo specifichi esplicitamente. In passato si usava `--force` per questo, il che metteva
l'azione meno reversibile della CLI sotto la stessa parola usata per "sovrascrivi questo
file"; ora è un'opzione non riconosciuta anziché un alias, quindi uno script che la contiene
si arresta.

### Il controllo sintattico prima dell'upload

I file di un'app statica vengono serviti esattamente come sono. Quando il relativo comando `build` si limita a
copiare script scritti a mano in `output`, nessun parser li ha controllati, e un file
contenente un errore di battitura finirebbe in produzione impedendo il caricamento della pagina. Pertanto, prima che qualsiasi
cosa venga caricata, `deploy` analizza ogni file `.js`, `.mjs` e `.cjs` nell'`output` di ciascuna app
statica, insieme a ogni tag `<script>` inline presente nei file `.html`. Questo
copre sia un'app statica distribuita singolarmente, sia le app statiche incorporate nel
bundle del backend. Un errore di sintassi arresta il deploy indicando file, riga e colonna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json` il campo `code` dell'errore è `syntax_error`. Gli script inline che un browser
non esegue come JavaScript vengono ignorati: JSON, import map, template e qualsiasi
altro `type` non JavaScript, i tag `<script src>` e gli script che contengono ancora
markup di template non renderizzato come `{{ }}`. Un file `.js` è valido se viene interpretato correttamente
come script classico o come modulo, poiché spetta alla pagina stabilirlo. Nessun elemento
all'interno di `node_modules` viene letto, e lo stesso vale per una directory precompilata `--bundle-dir`.
`--no-verify` ignora il controllo per un singolo deploy.

Monitoraggio:

```bash
rebase cloud logs               # il log di build
rebase cloud logs --runtime -f  # ciò che l'app in esecuzione stampa, in tempo reale, fino a Ctrl-C
rebase cloud status             # lo stato del progetto secondo la piattaforma
```

`status` riporta i campi `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la
piattaforma sta effettivamente lavorando e fare polling è l'operazione corretta; quando indica
un valore, quell'elemento è in attesa di un tuo intervento.

Uno di questi è `email_not_configured`: l'app ha attivato l'accesso tramite magic-link o codice
email (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) ma non dispone di un servizio email configurato, quindi
il deployment è attivo ma nessuno può effettuare l'accesso. Rebase Cloud non invia
email per conto della tua app: imposta `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e
`SMTP_FROM` con `rebase cloud env set`, quindi esegui il deploy. `status` rileva questa condizione dal
percorso `GET /api/auth/config` dell'app stessa (nel campo `unavailable`), e `deploy` segnala la
stessa cosa durante il controllo live.

## Visualizzare l'anteprima di una modifica

```bash
rebase cloud deploy --preview
```

Questo comando compila e carica esattamente ciò che farebbe `deploy`, ma rende disponibile l'anteprima a un indirizzo
dedicato, come `https://shop--k3x9ab.rebase.website`. L'ambiente di produzione continua
a servire quanto serviva in precedenza. Al termine della build, il deploy stampa l'indirizzo dell'anteprima.

Per mantenere lo stesso indirizzo attraverso più deploy, assegna un nome all'anteprima. Eseguire nuovamente il deploy
con lo stesso nome la aggiornerà:

```bash
rebase cloud deploy --preview-name new-checkout
```

I componenti con cui un'anteprima comunica dipendono da ciò che hai distribuito:

- **`rebase cloud deploy --preview`** genera un'anteprima del backend, con le sue app statiche
  incorporate, nello stesso modo in cui le esegue la produzione. Riceve un backend dedicato su
  un **database vuoto dedicato**, mai quello di produzione. L'avvio contro
  il database di produzione applicherebbe ad esso lo schema e le regole di accesso dell'anteprima.
- **`rebase cloud deploy web --preview`** genererebbe l'anteprima di una singola app statica
  a sé stante, con le relative pagine che richiamano il backend di **produzione**. Questo richiede un control plane
  in grado di servire siti statici autonomamente, cosa che Rebase Cloud non supporta ancora:
  l'operazione viene rifiutata con `PREVIEW_STATIC_UNSERVED` e non viene pubblicato nulla. Esegui invece l'anteprima del
  backend, che include le app statiche incorporate in esso; un progetto privo di
  un backend gestito non può ancora essere visualizzato in anteprima.

Un'anteprima non carica codice sorgente e non registra app o nomi host, poiché ciascuna
di queste operazioni modificherebbe il progetto di produzione. `--source` ed `--eject` non possono essere
combinati con `--preview`. Entrambi creano un'immagine container per la produzione.

```bash
rebase cloud previews                      # nome, indirizzo, app, backend, scadenza
rebase cloud logs --preview new-checkout   # il relativo log di build; -f segue una build ancora in corso
rebase cloud logs --runtime --preview new-checkout -f  # l'output del backend dell'anteprima
rebase cloud previews delete new-checkout  # interrompe l'erogazione ed elimina il relativo database
```

`rebase cloud logs` senza `--preview` fa sempre riferimento alla produzione.

La pagina **Deployments** della console elenca le stesse anteprime, consentendo di aprirne una, visualizzarne
il log di build o eliminarla. La creazione rimane un passaggio da CLI.

Un'anteprima scade una settimana dopo l'ultimo deploy effettuato su di essa.

Al termine, il deploy verifica che l'indirizzo dell'anteprima risponda, esattamente come fa
un deploy di produzione (`--live-timeout <seconds>`, `0` per saltare). Il rilascio del certificato per una nuova
anteprima può richiedere uno o due minuti, pertanto un deploy riuscito può
segnalare che l'indirizzo non risponde ancora.

Un'anteprima del backend viene fatturata come un'unità applicativa di dimensione predefinita (100m di CPU
e 384 MiB di memoria, alla tariffa della tua app per la relativa regione e capacità),
ripartita pro rata per l'intera durata della sua esistenza, e compare nella stima
mensile del progetto nella console. `rebase cloud deploy --preview` stampa la medesima stima
per essa, su base mensile (`cost` sotto `--json`). L'avvio di un'anteprima richiede una carta registrata, come
un deploy di produzione. Un primo deploy che
fallisce prima che qualsiasi processo venga eseguito viene rimosso anziché fatturato. Un progetto può eseguire fino a
tre anteprime di backend contemporaneamente.

Ogni nuovo indirizzo di anteprima riceve un certificato TLS dedicato da Let's Encrypt,
il quale concede a un dominio 50 nuovi certificati a settimana, condivisi con tutti i siti di produzione
su di esso. Le anteprime possono utilizzarne fino a 20 in qualsiasi finestra di 7 giorni, su tutta la piattaforma. Oltre
questa soglia, una nuova anteprima viene rifiutata (`429`, `preview_cert_budget`) indicando quando potrà
essere distribuita; il ridispiegamento di un'anteprima già esistente non viene mai conteggiato nel limite.

Il database di un'anteprima del backend è un secondo database sull'istanza Postgres di **produzione**:
dati separati, ma sulla stessa istanza e sullo stesso disco. È limitato a 10
connessioni, affinché le anteprime non saturino quelle di produzione, e a 2 GB: un'anteprima
il cui database superi tale limite viene sospesa. Il suo backend si arresta, il suo indirizzo smette di
rispondere, `rebase cloud previews` e la console la mostrano come `paused` con il
relativo motivo, e i proprietari e gli amministratori del progetto ricevono una notifica (`preview.paused`). I suoi
dati vengono conservati fino alla scadenza. Esegui nuovamente il deploy per avviarla (verrà sospesa nuovamente
se il database è ancora troppo grande), oppure eliminala. Un'anteprima in pausa continua a essere
fatturata finché non viene eliminata o scade. Elimina le anteprime che non ti servono più. Le estensioni installate in produzione non vengono
installate nel database di un'anteprima.

Le anteprime sono in fase di rollout graduale. Un control plane che non le supporta ancora rifiuterà
`--preview` con `previews_unavailable` senza distribuire alcunché.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback reimposta il progetto sulla versione distribuita da un precedente deployment riuscito,
senza mai ricompilare — l'utilità di un rollback risiede proprio nel ripristinare un
artefatto già precedentemente eseguito.

I criteri di idoneità dei deployment dipendono dalla modalità di deploy del progetto, ed entrambe
le modalità sono supportate:

| Come è stato distribuito | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (build da sorgente) | L'immagine pubblicata da quella build |
| `rebase cloud deploy --bundle` (runtime della piattaforma) | Il bundle distribuito da quel deploy, sulla versione del runtime attualmente in esecuzione per il progetto |

Le app statiche incorporate nel bundle del backend (un normale `rebase cloud deploy` su un
progetto con backend) fanno parte di quel bundle, quindi vengono ripristinate insieme ad esso.

Un'app statica distribuita singolarmente (`rebase cloud deploy <app>`) non può ancora essere
ripristinata tramite rollback. Il suo deployment registra l'app pubblicata ma nessun bundle, quindi il
control plane non ha elementi da cui ripristinarla. La soluzione consiste nel ridistribuire l'ultima versione
corretta, ad esempio dal commit precedente a quello problematico. Dopo un tale
deploy, `deploy` indicherà questo approccio anziché suggerire `rollback`, e un `rollback`
senza un ID rifiuterà l'operazione anziché ridistribuire il backend in esecuzione.

Pertanto, un rollback richiede un deployment che abbia registrato uno dei due elementi, il che implica un
progetto distribuito con successo almeno due volte. `rebase cloud deployments`
contrassegna quelli idonei, e `--json` riporta `rollbackable` per ciascuna riga insieme
all'`image` o al `bundle` che verrebbe ripristinato.

Due tipologie di deployment vengono rifiutate, e la CLI specifica quali: uno che non ha avuto successo,
e uno risalente a prima che la piattaforma registrasse il relativo artefatto. Non vi è nulla da presupporre
in nessuno dei due casi — avanzare ipotesi significherebbe distribuire ciò che è stato compilato o caricato più
di recente fingendo di ripristinare questo — pertanto distribuisci direttamente la versione desiderata.

Ogni deploy riuscito termina indicando la procedura di ripristino (`rebase cloud rollback`),
in modo da averla subito visibile nel momento in cui viene rilevato un rilascio errato.

Un rollback aggiunge un nuovo deployment anziché riavvolgere la cronologia, e attende che
la versione ripristinata sia operativa prima di segnalare il successo. Seguilo con
`rebase cloud logs -f`.

## Ripristinare il database a un momento specifico (PITR)

Un database gestito può essere ripristinato a qualsiasi minuto all'interno della sua finestra di conservazione,
dalla sezione **Database → Backups** nella console o tramite CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
L'operazione richiede due passaggi. Innanzitutto, una copia ripristinata viene allestita a fianco del database attivo;
la tua app continua a funzionare su quello attivo, e lo storage della copia viene fatturato fino
al cutover o alla cancellazione.
Successivamente, una volta pronta la copia, l'operazione di cutover ripunta l'app su di essa e la
riavvia. Qualsiasi dato scritto dopo l'orario di destinazione non sarà presente nella copia. Il database originale
viene mantenuto come procedura di riserva e continua a fatturare lo storage; per ripristinarlo,
rimuoverlo o eseguire un secondo ripristino è necessario contattare il supporto. Solo un owner o admin
può allestire la copia, eseguire il cutover o cancellarla, e la console richiede la conferma del nome del progetto
prima di effettuare il cutover.

## Proteggere il proprio account

Il tuo account sulla console può accedere ai database di produzione, ai secret e alla fatturazione,
quindi proteggilo adeguatamente. Apri **Account security** dal menu sotto il tuo avatar
nella console (oppure vai su `/account`). La pagina è personale, non
dell'organizzazione: le impostazioni configurate lì si applicano a tutte le organizzazioni a cui appartieni.

- **Verifica in due passaggi.** Attivala con qualsiasi app di autenticazione (1Password,
  Google Authenticator, Authy). La pagina mostra una chiave di configurazione da aggiungere all'app, oppure un
  link che apre l'app con la chiave precompilata su uno smartphone, quindi richiede il
  codice a 6 cifre mostrato dall'app. Da quel momento, ogni accesso richiederà un codice,
  indipendentemente dal fatto che tu acceda con password, Google o GitHub.
- **Codici di recupero.** L'attivazione fornisce dieci codici monouso, mostrati una sola volta.
  Ciascuno consente di accedere al posto del codice dell'authenticator in caso di smarrimento del
  telefono, quindi salvali prima di chiudere la finestra di dialogo. **New recovery codes**
  li sostituisce, rendendo non validi i precedenti. Sia la disattivazione della verifica in due passaggi
  sia la generazione di nuovi codici richiedono prima l'inserimento di un codice valido.
- **Password.** La sua modifica comporta la disconnessione da ogni altro dispositivo. Un account
  creato con Google, GitHub o LinkedIn non possiede una password; la pagina consente di
  ricevere via email un link per impostarne una.
- **Dispositivi connessi.** Mostra ogni browser e terminale connesso al tuo account,
  con il rispettivo indirizzo e l'orario di accesso. Puoi disconnettere qualsiasi dispositivo che non
  riconosci, o tutti contemporaneamente.

Gli [access token](/docs/deployment/cloud-agents/#ci-and-agents) non sono sessioni e non richiedono un secondo
fattore, quindi la CI continuerà a distribuire dopo l'attivazione. Revoca un token di cui non ti
fidi più in **Settings → Access tokens**.

## Invitare il proprio team

**Members → Add member** consente di aggiungere qualcuno che possiede già un account Rebase con un
indirizzo email verificato, in qualità di admin o member; un owner può promuoverlo a owner
successivamente. L'accesso è immediato e non viene inviata alcuna email. Rebase Cloud non
invia ancora inviti via email, pertanto chiedi a un collega privo di account di registrarsi e
verificare prima il proprio indirizzo. Da terminale:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), che
segnalerà se all'indirizzo specificato non corrisponde alcun account.

## Consultare il registro delle attività

La pagina **Activity** della console e il comando `rebase cloud activity` mostrano ai
proprietari e agli amministratori dell'organizzazione chi ha effettuato un deploy, impostato o visualizzato una variabile
d'ambiente (per nome, mai per valore), modificato un dominio, ripristinato un backup,
ridimensionato, arrestato o eliminato un progetto, modificato il ruolo di un membro o creato un
token, e quando ciò è avvenuto. La sezione **Settings** di un progetto rimanda alle proprie voci; le voci
relative a un progetto eliminato restano archiviate. Uno script può leggerle tramite un token creato con
`--can audit` sull'organizzazione. Le voci vengono conservate per un anno. I filtri sono descritti in
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agenti

Un job di CI o un agente non dovrebbe mai contenere la tua password personale. Assegna piuttosto un token limitato a
poche azioni su un singolo progetto, creato da un terminale autenticato con
`rebase cloud tokens create --project shop --can deploy,logs`, e impostalo come
`REBASE_TOKEN`. La fatturazione di un'organizzazione, il registro delle attività e le impostazioni di
notifica sono permessi specifici (`--can billing`, `audit`,
`notifications`) che un token detiene solo se esplicitamente richiesti. I permessi, un flusso di lavoro
di GitHub Actions e le prerogative che rimangono riservate a un utente autenticato sono trattati in
[CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend senza account

`rebase cloud init --claim` assegna a un'applicazione un backend attivo prima ancora che qualcuno si sia
registrato, stampando un URL di riscatto (claim) per consentire all'utente di mantenerne il possesso; un progetto non riscattato
entro 72 ore viene eliminato. Le azioni consentite al token di un progetto non riscattato, il valore
`REBASE_API_TOKEN` generato e ciò che il riscatto comporta sono illustrati in
[Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Risorse di calcolo e relativi costi

Il prezzo di un progetto si basa sulle risorse riservate, non su un piano fisso. `compute` stampa
ogni parametro di configurazione e la stima dettagliata fornita dal control plane. (`rebase cloud
resources` è un comando differente: elenca i database e i bucket dichiarati dal codice,
e se per ciascuno è stato eseguito il provisioning — consulta la [Guida di riferimento CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Risorse richieste dall'app per istanza, es. `500m` e `2Gi`. Se vuoto, si applica il valore predefinito della piattaforma, che dipende dalla regione (vedi sotto) |
| `--replicas` | Istanze sempre attive: il valore minimo dell'autoscaler e ciò che l'abbonamento del progetto fattura mensilmente |
| `--autoscale-max` | 1–16. Il tetto massimo raggiungibile. Le istanze aggiunte dall'autoscaler oltre `--replicas` sono tariffate al secondo-pod alle medesime tariffe, e addebitate solo dove la piattaforma ha abilitato tale funzione; **Usage this month** specifica dove è attiva. `--no-autoscale` la disattiva |
| `--autoscale-cpu-target` | 10–95. L'utilizzo di CPU che l'autoscaler mantiene, calcolato sulla richiesta anziché sul limite. Se vuoto, il valore predefinito è 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica, ma soggetta a riavvio senza preavviso |
| `--db-instances` | 1–3. `1` indica un'istanza singola senza failover; `2` aggiunge uno standby automatico |
| `--db-cpu`, `--db-memory` | Per istanza di database. Se vuoto, i valori predefiniti sono `160m` e `1Gi` |

Un parametro lasciato vuoto non equivale a uno impostato sullo stesso valore numerico: un parametro non valorizzato
segue le impostazioni predefinite della piattaforma e varia al variare di queste ultime.

In Belgio (europe-west1) l'impostazione predefinita riserva 100m di CPU e 384Mi con possibilità di picco (burst)
fino a 2 CPU e 2 GiB; a Falkenstein e Helsinki la memoria può estendersi fino a 1,4× rispetto alla
richiesta e la CPU fino a 10× (al massimo 1,7 vCPU). `rebase cloud compute` mostra i parametri specifici del tuo
progetto.

La CLI non esegue alcuna convalida preventiva, intenzionalmente — i limiti dipendono dal cluster su cui
è in esecuzione il progetto e variano a seconda dei provider. Il control plane rifiuterà qualunque
valore non supportato indicando il campo relativo. Esegui `rebase cloud compute` per visualizzare
il costo in €/mese prima e dopo la modifica; le variazioni si applicano immediatamente, con calcolo pro rata a partire da oggi.
Una modifica al database si applica subito; viene fatturata alle dimensioni correnti fino al completamento dell'attivazione.
Un cambio di CPU o memoria del database, o una riduzione delle istanze, riavvia il database (da circa
30 secondi a 3 minuti; le connessioni vengono interrotte e ristabilite): `compute set`
lo segnala richiedendo conferma; al di fuori di un terminale, il flag `--yes` funge da consenso. Se tale riavvio
fallisce, `rebase cloud compute apply` tenterà nuovamente l'operazione.

## Gli altri comandi disponibili

| Gruppo di comandi | Ambito di applicazione |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Gestione della sessione; `access-token` stampa il token bearer che la CLI invierebbe adesso, per script e per il server MCP |
| `tokens` | Token per CI e agenti, ciascuno limitato a un singolo progetto. Consulta [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Associazione della directory a un progetto, selezione dell'organizzazione, apertura della console |
| `connect` | Aggiunta di un server Rebase self-hosted al tuo account, affinché il [connettore Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude possa raggiungerlo accanto ai tuoi progetti Cloud. `--list` li mostra, `--remove` ne rimuove uno. Riservato a owner e admin |
| `init`, `claim` | Con `--claim`: un backend live senza account e un link per riscattarlo; `claim` stampa nuovamente tale link. Consulta [Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Creazione, visualizzazione, ispezione ed eliminazione |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Distribuzione e monitoraggio |
| `deploy-hooks` | URL segreti richiamati da un host git o dalla CI per distribuire il progetto: elenco, creazione (l'URL viene mostrato una sola volta), revoca. |
| `previews` | Build rese disponibili su un proprio indirizzo tramite `deploy --preview` e la loro eliminazione. Consulta [Visualizzare l'anteprima di una modifica](#visualizzare-lanteprima-di-una-modifica) |
| `sleep` | Sospensione durante l'inattività: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake`, e `status` (predefinito). In stato di sospensione, un progetto non consuma CPU o memoria e la prima richiesta in arrivo lo riattiva; i job pianificati e le attività in background rimangono in pausa. Laddove un progetto non possa essere sospeso, il control plane rifiuterà l'operazione indicandone il motivo |
| `start`, `stop`, `restart` | Sospensione temporanea di un progetto e suo ripristino. Un progetto arrestato mantiene la propria sottoscrizione attiva, a meno che la piattaforma non addebiti per i progetti arrestati unicamente lo storage e la quota fissa della piattaforma; la riga **Billing** della console lo specifica se applicabile |
| `status`, `metrics`, `debug` | Monitoraggio delle attività in corso e diagnosi di eventuali problemi |
| `alerts` | Incidenti aperti relativi al progetto, con possibilità di presa in carico (acknowledge) o posticipazione (snooze). |
| `cron` | Cron job dell'applicazione distribuita e storico delle loro esecuzioni, consultabili con il login `rebase cloud`. Sola lettura |
| `env` | Variabili d'ambiente. `list` non stampa mai i valori; `--secret` è in sola scrittura |
| `app-key` | La chiave scritta da `init --claim` in `.env` come `REBASE_API_TOKEN`, trasferita al momento del riscatto; `rotate` la sostituisce revocando la precedente. Riservato a owner e admin |
| `service-key` | `REBASE_SERVICE_KEY`, con privilegi di amministrazione sull'API dell'app stessa: data dell'ultima rotazione; `rotate` ne genera una nuova per l'app. Riservato a owner e admin |
| `domains` | Domini personalizzati, record DNS da configurare e verifica. Un progetto può rispondere su più domini, ciascuno verificato singolarmente; `verify` e `remove` accettano il dominio di destinazione, che può essere omesso solo quando ne è presente uno solo (per `verify`, uno ancora in sospeso). Ciascun dominio verificato serve il progetto direttamente; `primary <domain>` imposta il dominio canonico e `redirect <domain>` risponde su un altro dominio con un reindirizzamento 308 verso di esso, preservando path e query (`--off` ripristina la normale erogazione) — procedura consigliata per `www.` rispetto al dominio apex, poiché l'accesso con Google, i cookie e le passkey sono isolati per origine. Un dominio su cui è servita una specifica app (un `path` con hostname) non viene mai reindirizzato. Un dominio apex (`example.com`, senza sottodominio) richiede un record **A**, poiché il DNS non vi consente record CNAME. Tale indirizzo corrisponde all'ingress della piattaforma e la sua immutabilità non è garantita: in caso di migrazione della piattaforma, un record A continuerà a puntare al vecchio indirizzo. Se il tuo gestore DNS supporta ALIAS, ANAME o CNAME flattening sull'apex, punta l'apex al `tenantHost` del progetto, che segue automaticamente gli aggiornamenti della piattaforma. I CNAME dei sottodomini li seguono già in modo predefinito. `list` indica `verified, certificate pending` finché HTTPS non risponde con un certificato reale. `list --json` restituisce `{ projectId, tenantHost, domains: [...] }` |
| `db` | Collegamento o creazione di un database, connessione locale dalla propria macchina, backup, ripristino e point-in-time recovery |
| `guests` | Utenti guest generati dagli accessi anonimi: conteggio, eliminazione mirata, rimozione di quelli inattivi da lungo tempo. Consulta [Ospiti](/docs/cli/cloud/#guests). Riservato a owner e admin |
| `extensions` | Allowlist delle estensioni Postgres |
| `storage` | Il bucket dedicato del progetto |
| `resources` | Database e bucket gestiti dalla piattaforma a fronte di quanto dichiarato nel codice |
| `compute` | Risorse riservate dal progetto, relativi costi e modalità di modifica |
| `events` | Cronologia degli eventi del backend, dal più recente: scalabilità dell'app, modifiche pianificate e applicate al database, subentro di un'istanza di standby, espansione del disco |
| `usage` | Richieste utilizzate nel mese rispetto alla soglia inclusa e overage finora accumulato, secondo il calcolo di fatturazione. `usage org` elenca tutti i progetti dell'organizzazione |
| `clusters` | I cluster su cui vengono eseguiti i tenant. Riservato agli amministratori della piattaforma |
| `settings`, `orgs`, `billing` | Impostazioni di progetto, organizzazioni, membri, inviti e pagamenti |
| `activity` | Audit log dell'organizzazione: tracciamento di chi ha eseguito un deploy, modificato una variabile d'ambiente (per nome), un dominio, un backup, un membro o un token. Riservato a owner e admin. Consulta [Consultare il registro delle attività](#consultare-il-registro-delle-attività) |
| `notifications` | Destinazioni a cui inviare via POST gli eventi del progetto: Slack, Discord o qualsiasi URL HTTPS ([Notifiche Cloud](/docs/deployment/cloud-notifications/)) |

Ogni gruppo della tabella risponde a `--help` con una documentazione dedicata — sintassi di utilizzo,
flag ed esempi — e `--help` non esegue mai il comando. Un test automatico verifica
l'indice delle pagine: un gruppo aggiunto senza documentazione provocherà il fallimento della build anziché
mostrare l'indice generale. `verify:docs` allinea la tabella stessa a tale
indice: ogni comando gestito dalla CLI figura qui esattamente una volta; un gruppo
aggiunto senza la rispettiva riga farà fallire a sua volta la build.

Se eseguito in pipe, `--help` restituisce invece l'output in formato JSON: la medesima sintassi di utilizzo,
i flag e gli esempi strutturati per l'elaborazione programmatica anziché sessanta righe di sequenze di escape da terminale.

## Cosa non include la versione beta

Esposto chiaramente, poiché scoprirlo in un secondo momento sarebbe peggio:

- **Nessuna selezione della regione.** Attualmente tutto viene eseguito in un'unica regione. Il modello
  di posizionamento è previsto nell'architettura della piattaforma, ma un progetto non può selezionare una regione autonoma.
  I comandi `projects create --provider` e `--region` non costituiscono l'eccezione che sembrano:
  registrano a quale dei target di deploy del control plane appartiene un
  progetto, ed essendocene uno solo, entrambi assumono quello predefinito senza spostare il
  progetto altrove. `rebase cloud projects create --help` riporta la medesima precisazione.
- **Nessun modello self-service.** L'accesso viene accordato a lotti; non è presente una procedura di registrazione e pagamento immediata.
- **Nessun SLA pubblico**, né conformità SOC 2. Se necessiti di uno dei due, segnalalo
  al momento della richiesta di accesso anziché darlo per scontato.
- **Nessun branch deploy**, né integrazione nativa tramite GitHub App. I deploy hook — URL segreti
  a cui associare i webhook del repository — rappresentano il meccanismo di automazione supportato. I [deploy
  di anteprima](#visualizzare-lanteprima-di-una-modifica) sono in fase di rollout graduale e vengono avviati da CLI.
- **I token agiscono per conto di una persona fisica.** Un [token](/docs/deployment/cloud-agents/#ci-and-agents) viene generato da un account
  e opera con i privilegi di quest'ultimo; non esistono ancora identità macchina gestite a livello di organizzazione. Se
  effettui l'accesso da CI, trasmetti `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD`
  tramite un secret manager — l'uso di `--password` espone la password nella cronologia della shell
  e nella tabella dei processi, e il comando lo segnala prima di autenticarti. Se il file
  `.rebase/cloud.json` del repository fa riferimento a un control plane diverso da quello della piattaforma,
  passalo anche tramite `--url`: in assenza di un terminale interattivo, `login` rifiuterà di inviare la password
  a un host indicato esclusivamente dal file clonato.
- **Nessun endpoint pubblico per il database.** Un database gestito non viene esposto su
  Internet, quindi l'host visualizzato nella console rappresenta l'indirizzo interno raggiungibile dal tuo backend e
  non sarà risolvibile dalla tua macchina locale. `rebase cloud db connect` apre una porta
  locale verso quel database, mediante un tunnel instradato dal control plane, per tutto il tempo
  in cui il comando viene mantenuto attivo — tuttavia non esiste un hostname pubblico permanente a cui
  un servizio di terze parti possa connettersi direttamente. Per eseguire query SQL senza un client Postgres locale,
  `rebase cloud db query "<sql>"` o `rebase cloud db query --file file.sql` apre il
  medesimo tunnel per una singola interrogazione, esegue il testo come script unico (arrestandosi al primo
  errore) e stampa l'esito restituito da ciascuna istruzione (`--json` per l'uso in script). Sia l'apertura del tunnel, sia la password accessibile tramite
  `rebase cloud db info --reveal`, richiedono il ruolo di owner o admin
  nell'organizzazione: gli stessi privilegi richiesti dall'editor SQL di Studio, poiché tutte e tre le modalità consentono
  l'accesso diretto a una sessione sui dati di produzione.
- **Eseguire il deploy equivale a eseguire codice con i secret di produzione.** L'ambiente dell'applicazione
  custodisce `REBASE_SERVICE_KEY` (privilegi di amministrazione sulla propria API),
  `DATABASE_URL` e `JWT_SECRET`; pertanto, il codice distribuito da un membro del team può accedervi,
  sebbene solo i proprietari e gli amministratori possano visualizzarli in chiaro nella console. Invita
  come membro unicamente persone a cui affideresti direttamente tali credenziali.
- **La service key può essere rigenerata.** Nella sezione **Settings** del progetto
  (o tramite `rebase cloud service-key rotate`) è possibile emettere una nuova `REBASE_SERVICE_KEY`
  e riavviare l'app con essa. La chiave precedente rimane valida fino al completamento
  del riavvio e cessa di funzionare subito dopo, invalidando qualunque componente che ne conservi
  una copia. Il riscatto (claim) di un progetto esegue la medesima procedura.

## Self-hosting alternativo

Nessuna delle configurazioni descritte costituisce un vincolo di dipendenza (vendor lock-in). La [guida al self-hosting](/docs/deployment/self-hosting/)
consente di eseguire esattamente la stessa immagine e lo stesso bundle tramite `docker compose`, e la
[guida a Kubernetes](/docs/deployment/kubernetes/) riproduce la medesima topologia partendo
dal relativo Helm chart.
