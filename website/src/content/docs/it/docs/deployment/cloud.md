---
sourceHash: 6a1d65000e50846a
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Cos'è, come collegare e distribuire un progetto e cosa non include ancora la beta privata.
---

Rebase Cloud esegue lo stesso Rebase open source che ospiteresti autonomamente: la stessa
immagine pubblicata `rebasepro/server`, lo stesso bundle, lo stesso Postgres. La
differenza sta in chi lo gestisce.

:::note[Beta privata]
Rebase Cloud è in **beta privata**. Gestisce già tenant reali e apre l'accesso a
scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi seguenti richiedono un account abilitato.
Tutto il resto su questo sito funziona senza di esso.
:::

## Cos'è

Un **progetto** Cloud è composto da tre elementi che la piattaforma gestisce per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine di runtime pubblicata. I deploy consistono nel caricamento di un bundle, non nella compilazione di un container |
| **Database** | Un PostgreSQL gestito, con backup automatizzati e point-in-time recovery |
| **Storage** | Un bucket dedicato, se il tuo progetto utilizza lo storage di file |

L'app e il database vengono sottoposti a provisioning al tuo primo deploy; il bucket solo
quando ne richiedi uno ([Storage di file](#file-storage)). Ciascuno viene fatturato in base a ciò che
riserva anziché per utente (per seat).

**Non cambia nulla del tuo progetto per essere eseguito lì.** Lo stesso repository
può essere ospitato autonomamente con `docker compose`, e la via d'uscita è concreta: `rebase build`
produce un bundle che si avvia ovunque venga eseguita l'immagine di runtime.

## Collegare un progetto

Dalla directory di un progetto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` apre la console nel tuo browser e stampa un codice breve. Verifica che
la console mostri lo stesso codice e approva l'accesso da lì: il terminale
acquisirà la sessione e la scriverà in `~/.rebase/credentials.json`. Se non hai
effettuato l'accesso alla console, accedi prima da lì con il metodo che preferisci,
inclusi Google e GitHub. Tramite SSH, `rebase cloud login --no-browser` stampa il link
da aprire sulla tua macchina locale.

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono
flag ed entrambi sono obbligatori: su un terminale vengono richiesti in modo interattivo,
mentre un'esecuzione non interattiva (headless) che ometta uno dei due termina con `input_required`
anziché inventarne uno. **Il sottodominio non è modificabile in seguito:** è l'host
`<slug>.rebase.website` su cui risponde il progetto, quindi sceglilo con attenzione.

`--link` associa questa directory al progetto nella stessa chiamata, evitando un passaggio
`link` separato. Scrive il file `.rebase/cloud.json`, che registra l'ID del progetto
e lo slug. Quel file non è un segreto e non contiene le tue credenziali: queste risiedono
in `~/.rebase/credentials.json`, scritto da `login`.

Tuttavia, viene sottoposto a commit insieme al codice, quindi un repository clonato può indicare
qualsiasi control plane. Quando l'host proviene esclusivamente da quel file e non è né quello
della piattaforma né uno a cui hai effettuato l'accesso in precedenza, `login` ne indica il nome e
chiede conferma prima di inviare lì email e password. Senza terminale, o con
`--json`, rifiuta l'operazione con `unknown_control_plane`; passa `--url <host>` (o imposta
`REBASE_CLOUD_URL`) per accedere lì intenzionalmente.

Per accedere senza browser, passa la tua email: `rebase cloud login --email
me@example.com` ti chiederà la password. **Ti sei registrato con Google, GitHub o
LinkedIn?** Il tuo account non ha una password, quindi usa invece un codice:

```bash
rebase cloud login --code --email me@example.com
```

Il control plane ti invia via email un codice a 6 cifre, valido per dieci minuti, da inserire
al prompt. Con `--email` e senza password, `rebase cloud login` ti chiede se usare la
password o un codice. I codici richiedono che il control plane sia in grado di inviare
email; in caso contrario, `--code` lo segnala ed esce con `otp_unavailable`.

Se hai abilitato l'autenticazione a due fattori, `login` richiede quindi il codice dall'app
di autenticazione o uno dei tuoi codici di recupero, a seconda di come hai effettuato l'accesso.
Tramite browser, la console lo richiede al momento dell'accesso. Né un codice di accesso né un secondo
fattore possono essere inseriti senza un terminale.
Per uno script, crea un token di accesso nella console (**Settings → Access
tokens**) e imposta `REBASE_TOKEN`; consulta [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

Una password errata restituisce `invalid_credentials` indicando le stesse due modalità di accesso,
poiché la causa comune è un account che non ne ha mai avuta una.

`billing setup` associa una carta all'organizzazione, una sola volta. È posizionato
intenzionalmente all'inizio della sequenza: il primo deploy di un progetto viene rifiutato senza di essa,
e scoprirlo dopo aver completato l'upload del bundle sarebbe l'ordine peggiore.

Dopodiché, la pagina **Billing** della console elenca le fatture dell'organizzazione,
ciascuna con la pagina ospitata e il PDF di Stripe, e mostra un'anteprima della fattura successiva di ogni
progetto. `rebase cloud billing invoices` e `rebase cloud billing upcoming`
stampano le stesse informazioni. Entrambi sono riservati ai proprietari e agli amministratori dell'organizzazione.
Dove la piattaforma lo prevede, **Manage billing** apre il portale clienti di Stripe per gestire la
carta, i dati di fatturazione e le fatture precedenti.

Con una carta già registrata, la creazione di un altro progetto nella console non richiede
un secondo pagamento: il progetto viene fatturato su tale carta e distribuito. Se la carta
viene rifiutata o la banca richiede la conferma del pagamento, la console ti indirizza a
**Billing**, dove **Fix your card** permette di salvare un'altra carta e **Complete the
payment** apre la fattura Stripe.

L'utilizzo di un progetto è visibile nella relativa panoramica, sotto **Usage this month**, e
cumulativamente per ogni progetto nella pagina **Billing**: richieste rispetto alla
soglia inclusa (la barra diventa ambra all'80%), errori 5xx, l'eccedenza maturata finora
e la proiezione per fine mese a questo ritmo. L'eccedenza viene calcolata dallo
stesso codice che la comunica a Stripe, quindi corrisponde a quanto sarà presente in fattura;
compare nella fattura del mese successivo. `rebase cloud usage` stampa le
stesse informazioni, e `rebase cloud usage org` mostra l'intera organizzazione. Qualsiasi membro può
visualizzarlo. I dati specificano ciò che non è ancora visibile: lo storage di oggetti non viene conteggiato,
quindi non viene fatturata alcuna eccedenza di storage; finché un progetto esegue due o più pod dell'app,
le sue richieste non vengono conteggiate; e una giornata con campionamenti mancati risulterà sottostimata. Un
progetto con autoscaling mostra anche i pod eseguiti oltre `--replicas`, in ore-pod,
il loro costo alle tariffe applicate e se questa piattaforma li addebita già. Un
progetto riscattato da un agente conteggia solo i giorni a partire dal riscatto: prima
di esso, il progetto apparteneva alla piattaforma.

Un progetto esistente si collega senza doverne creare uno nuovo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Un solo comando, e nessun flag da ricordare. Il file `rebase.json` di uno scaffold dichiara
`runtime: "managed"` per il suo backend, e `deploy` legge tale dichiarazione —
indicandolo durante il processo (`rebase.json declares runtime: managed — deploying a
bundle`), compila l'app in `dist-bundle`, carica il bundle, lo esegue sull'immagine
di runtime pubblicata e segue il deployment fino a uno stato terminale. Il codice di uscita
rappresenta l'esito finale, quindi la stessa riga funziona in modalità non presidiata nella CI.

Termina indicando dove risponde ciascuna app e se la nuova versione è attiva (live) a quell'indirizzo:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa che l'indirizzo ha risposto dopo il build: l'endpoint `/health` del backend
ha restituito `ok`, e la pagina dell'app statica è stata caricata (da questo deployment,
quando viene servita dalla piattaforma). La verifica attende fino a `--live-timeout` secondi, 60 per
impostazione predefinita; `0` la salta. Se un'app non risponde in tempo, il deploy termina comunque con
codice zero poiché il deployment è riuscito, e l'ultima riga indica quale app non ha
risposto e perché. Un deploy fallito termina invece su una sola riga, indicando l'app e il
motivo, rimandando a `rebase cloud logs` per il registro di compilazione completo.

Gli script possono passare `--json` per ottenere un unico oggetto contenente gli stessi dati — `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` e l'ID del deployment. A differenza del resto di
`rebase cloud`, `deploy` non passa automaticamente a JSON quando usato in una pipe.

Ciò che tale runtime consente — pacchetti e moduli nativi, memoria e istanze,
timeout e dimensioni del body, filesystem, secret, storage e rete in uscita — è
descritto nella pagina dedicata:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Per distribuire un artefatto compilato in precedenza — ad esempio un job di CI che compila una volta e
distribuisce due volte — punta direttamente alla directory invece di ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

L'uscita dal runtime gestito richiede un flag apposito, `--eject`, e nient'altro lo richiederà:
una compilazione che sposterebbe un progetto gestito su un'immagine container di sua proprietà
viene rifiutata finché non lo specifichi espressamente. In passato questo era il significato di `--force`,
il che associava l'azione meno reversibile della CLI allo stesso termine usato per
"sovrascrivi questo file"; ora è un'opzione sconosciuta anziché un alias, pertanto uno script che la
contiene si interromperà.

### Il controllo di sintassi prima dell'upload

I file di un'app statica vengono serviti esattamente come sono. Quando la relativa fase di `build` si
limita a copiare script scritti a mano in `output`, nulla li ha analizzati, e un file
con un refuso va online impedendo il caricamento della pagina. Pertanto, prima di caricare
qualsiasi cosa, `deploy` analizza ogni file `.js`, `.mjs` e `.cjs` nell'`output` di ciascuna
app statica, insieme a ogni `<script>` inline nei suoi file `.html`. Questo include sia le app
statiche distribuite singolarmente, sia quelle incorporate nel bundle del backend. Un errore
di sintassi interrompe il deploy indicando file, riga e colonna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json`, il `code` dell'errore è `syntax_error`. Gli script inline che il browser
non esegue come JavaScript vengono ignorati: JSON, import map, template e qualsiasi
altro `type` non JavaScript, i tag `<script src>` e gli script che contengono ancora
markup di template non renderizzato come `{{ }}`. Un file `.js` supera la verifica se
viene analizzato correttamente come script classico o come modulo, poiché è la pagina a
deciderlo. Non viene letto nulla all'interno di `node_modules`, né in un `--bundle-dir`
precompilato. `--no-verify` salta il controllo per un singolo deploy.

Monitora le operazioni:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` riporta `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la
piattaforma sta effettivamente elaborando e il polling è l'operazione corretta; quando
indica un valore, significa che quel qualcosa è in attesa di un tuo intervento.

Uno di questi è `email_not_configured`: l'app ha attivato l'accesso tramite magic-link o codice
email (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) ma non dispone di un servizio email configurato, quindi
il deployment è attivo ma nessuno può accedere. Rebase Cloud non invia email per conto
della tua app: imposta `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e
`SMTP_FROM` con `rebase cloud env set`, quindi esegui il deploy. `status` rileva questa condizione
dal `GET /api/auth/config` dell'app stessa (dal campo `unavailable`), e `deploy` segnala la
stessa cosa nel controllo del suo stato di live.

## File storage

Un nuovo progetto non ha alcun bucket: i caricamenti vengono rifiutati con `501 STORAGE_NOT_CONFIGURED`
e il riepilogo del deploy lo segnala, invece di scrivere su un disco che ogni deploy sostituisce.

Configurane uno dei due tipi disponibili, quindi esegui nuovamente il deploy affinché l'app lo rilevi:

```bash
# A bucket Rebase runs for you. The console's Storage page does the same.
rebase cloud storage create

# Or your own S3-compatible bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omit for AWS; add --force-path-style for MinIO

rebase cloud deploy
```

`rebase cloud storage` elenca i bucket del progetto. Un progetto con più bucket li
associa singolarmente con `--source <key>`; un progetto che configura lo storage direttamente nel codice non necessita di nessuno dei due.

## Anteprima di una modifica

```bash
rebase cloud deploy --preview
```

Questo comando compila e carica esattamente ciò che farebbe `deploy`, ma lo serve a un indirizzo
dedicato, come ad esempio `https://shop--k3x9ab.rebase.website`. L'ambiente di produzione continua a
servire la versione precedente. Il deploy stampa l'indirizzo della preview al termine della
compilazione.

Per mantenere lo stesso indirizzo attraverso più deploy, assegna un nome alla preview. Distribuire
nuovamente con lo stesso nome la aggiornerà:

```bash
rebase cloud deploy --preview-name new-checkout
```

Le risorse con cui la preview comunica dipendono da ciò che è stato distribuito:

- **`rebase cloud deploy --preview`** genera un'anteprima del backend, con le relative app statiche
  incorporate, esattamente come vengono eseguite in produzione. Riceve un backend dedicato su un
  **database dedicato vuoto**, mai quello di produzione. L'avvio sul database di
  produzione applicherebbe ad esso lo schema e le regole di accesso della preview.
- **`rebase cloud deploy web --preview`** genererebbe l'anteprima di una singola app statica
  autonoma, le cui pagine chiamano il backend di **produzione**. Questo richiede un control plane
  in grado di servire siti statici autonomamente, cosa che Rebase Cloud non supporta ancora:
  l'operazione viene rifiutata con `PREVIEW_STATIC_UNSERVED` e non viene pubblicato nulla. Esegui invece
  l'anteprima del backend, che serve le app statiche incorporate; un progetto senza backend gestito non può
  ancora essere visualizzato in anteprima.

Una preview non carica il codice sorgente e non registra app o hostname, poiché ciascuna di
queste azioni modificherebbe il progetto di produzione. `--source` ed `--eject` non possono essere
combinati con `--preview`. Entrambi creano un'immagine container per la produzione.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` senza `--preview` si riferisce sempre alla produzione.

La pagina **Deployments** della console elenca le stesse preview, consentendo di aprirle, visualizzarne
il log di compilazione o eliminarle. La creazione rimane un passaggio da eseguire tramite CLI.

Una preview scade una settimana dopo l'ultimo deploy.

Al termine, il deploy verifica che l'indirizzo della preview risponda, esattamente come avviene per un
deploy in produzione (`--live-timeout <seconds>`, `0` per saltare). Il certificato di una nuova
preview può richiedere uno o due minuti, quindi un deploy completato con successo potrebbe indicare
che l'indirizzo non risponde ancora.

Una preview di backend viene fatturata come un'unità di app con dimensione predefinita (100m di CPU
e 384 MiB di memoria, alla tariffa della tua app per la relativa regione e capacità),
ripartita proporzionalmente (pro-rata) per la sua intera durata, e compare nel preventivo mensile
del progetto nella console. `rebase cloud deploy --preview` stampa lo stesso preventivo su base
mensile (`cost` con `--json`). L'avvio di una preview richiede una carta registrata, come per i deploy di produzione.
Un primo deploy che fallisce prima dell'esecuzione viene rimosso anziché fatturato. Un progetto può
eseguire fino a tre preview di backend contemporaneamente.

Ogni nuovo indirizzo di preview riceve un proprio certificato TLS da Let's Encrypt,
che concede a un dominio 50 nuovi certificati a settimana, condivisi con tutti i siti di produzione su di esso.
Le preview possono utilizzarne 20 nell'arco di 7 giorni, a livello di intera piattaforma. Superata tale
soglia, una nuova preview viene rifiutata (`429`, `preview_cert_budget`) indicando il momento in cui potrà
essere distribuita; la ridistribuzione di una preview esistente non viene mai conteggiata nel limite.

Il database di una preview di backend è un secondo database sull'istanza Postgres di **produzione**:
ha dati propri, ma condivide la stessa istanza e lo stesso disco. È limitato a 10
connessioni, in modo che le preview non esauriscano quelle di produzione, e a 2 GB: una preview
il cui database supera tale dimensione viene messa in pausa. Il relativo backend si arresta, il suo indirizzo smette
di rispondere, `rebase cloud previews` e la console lo mostrano come `paused` indicandone il motivo,
e i proprietari e gli amministratori del progetto ricevono una notifica (`preview.paused`). I relativi
dati vengono conservati fino alla scadenza. Esegui nuovamente il deploy per avviarla (verrà messa nuovamente in pausa
se il database è ancora troppo grande), oppure eliminala. Una preview in pausa continua a essere
fatturata finché non viene eliminata o scade. Elimina le preview non più necessarie. Le estensioni installate
in produzione non vengono installate nel database di una preview.

Le preview sono in fase di rilascio graduale. Un control plane che non le supporta ancora rifiuterà
`--preview` con `previews_unavailable` senza distribuire nulla.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback reindirizza il progetto verso quanto distribuito da un precedente deployment
riuscito e non ricompila mai: il valore di un rollback sta proprio nel fatto di distribuire un
artefatto già testato ed eseguito.

I deployment idonei dipendono dalla modalità di deploy del progetto, ed entrambi i tipi
sono supportati:

| Come è stato distribuito | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (compilazione dai sorgenti) | L'immagine pubblicata da quella compilazione |
| `rebase cloud deploy --bundle` (runtime della piattaforma) | Il bundle distribuito da quel deploy, sulla versione del runtime attualmente in esecuzione per il progetto |

Le app statiche incorporate nel bundle del backend (un semplice `rebase cloud deploy` su un
progetto con backend) fanno parte di quel bundle, quindi vengono ripristinate insieme ad esso.

Un'app statica distribuita singolarmente (`rebase cloud deploy <app>`) non può ancora essere
ripristinata con un rollback. Il suo deployment registra quale app è stata pubblicata, ma nessun bundle,
quindi il control plane non ha nulla da cui ripristinarla. La soluzione consiste nel distribuire nuovamente l'ultima
versione funzionante, ad esempio dal commit precedente a quello problematico. Dopo un deploy di questo
tipo, `deploy` segnala questa circostanza invece di suggerire `rollback`, e un `rollback` senza ID rifiuta
l'operazione anziché ridistribuire il backend in esecuzione.

Pertanto, un rollback richiede un deployment che abbia registrato uno dei due elementi, il che presuppone un
progetto distribuito con successo almeno due volte. `rebase cloud deployments` contrassegna quelli idonei,
e `--json` riporta `rollbackable` per ogni riga insieme alla `image` o al `bundle` che verrebbe ripristinato.

Due tipi di deployment vengono rifiutati, e la CLI specifica quali: uno non riuscito
e uno precedente al momento in cui la piattaforma ha iniziato a registrare l'artefatto. In entrambi i casi
non c'è spazio per supposizioni — tirare a indovinare comporterebbe la distribuzione di qualsiasi cosa sia stata
compilata o caricata più di recente sostenendo falsamente di ripristinare quella richiesta — quindi distribuisci
direttamente la versione desiderata.

Ogni deploy completato con successo termina indicando la procedura di ripristino (`rebase cloud rollback`),
così da averla sott'occhio nel momento in cui ci si accorge di un rilascio errato.

Un rollback accoda un nuovo deployment anziché riavvolgere la cronologia, e attende che
la versione ripristinata sia attiva prima di segnalare il successo. Puoi seguirne l'avanzamento con
`rebase cloud logs -f`.

## Ripristinare il database a un punto nel tempo

Un database gestito può essere ripristinato a qualsiasi minuto all'interno della sua finestra di recupero,
da **Database → Backups** nella console oppure tramite la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
La procedura prevede due passaggi. Innanzitutto, viene preparata (staged) una copia ripristinata a fianco del database attivo;
la tua app continua a funzionare su quest'ultimo, e lo storage della copia viene fatturato fino
al cutover o all'eliminazione (discard).
Successivamente, una volta pronta la copia, il cutover reindirizza l'app verso di essa e la riavvia.
Tutto ciò che è stato scritto dopo l'orario di destinazione non sarà presente nella copia. Il database
originale viene conservato come via di riserva e continua a essere fatturato per lo storage; il ripristino
del database precedente, la sua rimozione o un secondo ripristino richiedono l'intervento dell'assistenza. Solo
un proprietario o un amministratore può eseguire lo staging, il cutover o il discard, e la console richiede la
conferma del nome del progetto prima del cutover.

## Proteggi il tuo account

Il tuo account console ha accesso a database di produzione, secret e fatturazione, quindi
proteggilo adeguatamente. Apri **Account security** dal menu sotto il tuo avatar nella
console (o vai su `/account`). La pagina appartiene a te e non a un'organizzazione:
le impostazioni configurate lì si applicano a tutte le organizzazioni a cui appartieni.

- **Verifica in due passaggi.** Attivala con qualsiasi app di autenticazione (1Password,
  Google Authenticator, Authy). La pagina mostra una chiave di configurazione da aggiungere all'app, o un
  link che apre l'app con la chiave precompilata su uno smartphone, quindi richiede il
  codice a 6 cifre mostrato dall'app. Da quel momento in poi, ogni accesso richiederà un codice,
  sia che tu acceda con password, Google o GitHub.
- **Codici di recupero.** L'attivazione genera dieci codici monouso, mostrati una sola volta.
  Ciascuno di essi consente l'accesso al posto del codice dell'autenticatore in caso di smarrimento
  del telefono, quindi salvali prima di chiudere la finestra di dialogo. **New recovery codes**
  li sostituisce invalidando quelli precedenti. Sia la disattivazione della verifica in due passaggi
  che la generazione di nuovi codici richiedono prima l'inserimento di un codice.
- **Password.** La sua modifica disconnette tutti gli altri dispositivi. Un account
  creato con Google, GitHub o LinkedIn non possiede una password; la pagina consente di
  ricevere via email un link per impostarne una.
- **Dispositivi connessi.** Ogni browser e terminale connesso al tuo account,
  con il relativo indirizzo e data/ora di accesso. Disconnetti qualsiasi dispositivo non
  riconosciuto, o tutti contemporaneamente.

I [token di accesso](/docs/deployment/cloud-agents/#ci-and-agents) non sono sessioni e non richiedono un secondo
fattore, quindi la CI continuerà a eseguire i deploy anche dopo l'attivazione. Revoca i token di cui non ti fidi
più in **Settings → Access tokens**.

## Invita il tuo team

**Members → Add member** aggiunge un utente che possiede già un account Rebase con un
indirizzo email verificato, con ruolo di amministratore o membro; un proprietario può successivamente promuoverlo
a proprietario. L'accesso è immediato e non viene inviata alcuna email. Rebase Cloud non
invia ancora inviti, quindi chiedi al collega senza account di registrarsi e
verificare prima il proprio indirizzo. Da terminale:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), che
segnala se l'indirizzo non corrisponde ad alcun account.

## Verifica chi ha fatto cosa

La pagina **Activity** della console e il comando `rebase cloud activity` mostrano ai
proprietari e agli amministratori dell'organizzazione chi ha eseguito un deploy, impostato o visualizzato
una variabile d'ambiente (per nome, mai per valore), modificato un dominio, ripristinato un backup,
ridimensionato, arrestato o eliminato un progetto, modificato il ruolo di un membro o creato un
token, e quando. La sezione **Settings** di un progetto contiene i link alle relative voci; le voci relative a un
progetto eliminato vengono conservate. Uno script può leggerle tramite un token creato con permessi
`--can audit` sull'organizzazione. Le registrazioni vengono conservate per un anno. I filtri disponibili sono descritti in
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agenti

Un job di CI o un agente non dovrebbe contenere la tua password. Assegnagli un token limitato a
poche azioni su un singolo progetto, creato da un terminale autenticato con
`rebase cloud tokens create --project shop --can deploy,logs`, e impostalo come
`REBASE_TOKEN`. La fatturazione dell'organizzazione, il log delle attività e le impostazioni di notifica
sono permessi specifici (`--can billing`, `audit`,
`notifications`) che il token possiede solo se esplicitamente richiesti. I permessi disponibili, un
flusso di lavoro GitHub Actions e le funzionalità riservate a un utente autenticato sono trattati in
[CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend senza account

`rebase cloud init --claim` fornisce all'app un backend funzionante prima ancora che qualcuno si sia
registrato, stampando un URL di riscatto (claim) per consentire all'utente di mantenerne il controllo; un progetto
non riscattato entro 72 ore viene eliminato. Le operazioni consentite al token del progetto non riscattato, il valore
`REBASE_API_TOKEN` generato e ciò che il riscatto comporta sono illustrati in
[Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Risorse di calcolo e relativi costi

Il prezzo di un progetto si basa sulle risorse riservate, non su piani a scaglioni. `compute` stampa
ogni parametro e il relativo preventivo dettagliato fornito dal control plane. (`rebase cloud
resources` è un comando diverso: mostra i database e i bucket dichiarati dal codice e se
ciascuno è stato sottoposto a provisioning — vedi la [documentazione di riferimento della CLI](/docs/cli/cloud/)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Richiesta (request) dell'app per istanza, es. `500m` e `2Gi`. Vuoto indica il valore predefinito della piattaforma, che dipende dalla regione (vedi sotto) |
| `--replicas` | Istanze sempre attive: la soglia minima dell'autoscaler e la base della fatturazione mensile della sottoscrizione del progetto |
| `--autoscale-max` | 1–16. Il limite massimo raggiungibile. Le istanze aggiunte dall'autoscaler oltre `--replicas` sono conteggiate per secondo-pod alle stesse tariffe, e addebitate solo dove la piattaforma ha abilitato tale opzione; **Usage this month** specifica dove. `--no-autoscale` lo disattiva |
| `--autoscale-cpu-target` | 10–95. La percentuale di utilizzo CPU mantenuta dall'autoscaler, calcolata rispetto alla request anziché al limit. Vuoto indica 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica, ma soggetta a riavvii senza preavviso |
| `--db-instances` | 1–3. `1` indica un'istanza singola senza failover; `2` aggiunge uno standby automatico |
| `--db-cpu`, `--db-memory` | Per istanza di database. Vuoto indica `160m` e `1Gi` |

Un parametro lasciato vuoto non equivale a uno impostato sullo stesso valore: un parametro vuoto
segue i valori predefiniti della piattaforma e si adegua alle loro variazioni.

In Belgio (europe-west1) il valore predefinito riserva 100m di CPU e 384 MiB, con possibilità di burst
fino a 2 CPU e 2 GiB; a Falkenstein e Helsinki la memoria può estendersi fino a 1,4× la
request e la CPU fino a 10× (al massimo 1,7 vCPU). `rebase cloud compute` mostra i numeri
esatti del tuo progetto.

Nessun dato viene validato preventivamente dalla CLI, intenzionalmente: i limiti appartengono al cluster su
cui il progetto viene eseguito e variano da un provider all'altro. Il control plane rifiuterà
qualsiasi valore non valido indicando il campo interessato. Esegui `rebase cloud compute` per vedere
i costi in €/mese prima e dopo; le modifiche hanno effetto immediato, ripartite proporzionalmente da oggi.
Le modifiche al database si applicano subito, con fatturazione alla dimensione corrente fino alla piena operatività.
La modifica di CPU o memoria del database, o la riduzione del numero di istanze, riavvia il database (da circa
30 secondi a 3 minuti; le connessioni vengono interrotte e ristabilite): `compute set`
avvisa di questo passaggio chiedendo conferma; in ambienti non interattivi `--yes` funge da consenso. Se il riavvio
non va a buon fine, `rebase cloud compute apply` tenterà nuovamente l'operazione.

## Panoramica degli altri comandi

| Gruppo di comandi | Cosa include |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | La tua sessione; `access-token` stampa il token bearer che la CLI invierebbe al momento, utile per script e per il server MCP |
| `tokens` | Token per CI e agenti, ciascuno limitato a un singolo progetto. Vedi [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Associazione della directory a un progetto, selezione di un'organizzazione, apertura della console |
| `connect` | Aggiunta di un server Rebase self-hosted al tuo account, consentendo al [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude di raggiungerlo insieme ai tuoi progetti Cloud. `--list` li mostra, `--remove` ne rimuove uno. Riservato a proprietari e amministratori |
| `init`, `claim` | Con `--claim`: un backend attivo senza account e un link per riscattarlo; `claim` ristampa tale link. Vedi [Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Creazione, visualizzazione, ispezione ed eliminazione |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Distribuzione e monitoraggio |
| `deploy-hooks` | URL segreti che un host git o una CI richiama per distribuire il progetto: elenco, creazione (l'URL viene mostrato una sola volta) e revoca. |
| `previews` | Compilazioni servite a un indirizzo dedicato tramite `deploy --preview` e relativa eliminazione. Vedi [Anteprima di una modifica](#anteprima-di-una-modifica) |
| `sleep` | Sospensione in caso di inattività: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake` e `status` (predefinito). In sospensione, un progetto non riserva né CPU né memoria e la richiesta successiva lo riattiva; nel frattempo le attività pianificate e i processi in background non vengono eseguiti. Se un progetto non può andare in sospensione, il control plane rifiuta la richiesta indicandone il motivo |
| `start`, `stop`, `restart` | Messa in pausa e riattivazione di un progetto. Un progetto arrestato mantiene la propria sottoscrizione, a meno che la piattaforma non fatturi per i progetti arrestati solo lo storage e la tariffa della piattaforma; la riga **Billing** della console specifica quando questo accade |
| `status`, `metrics`, `debug` | Cosa sta eseguendo il progetto e perché non funziona |
| `alerts` | Gli incidenti aperti del progetto, con possibilità di prenderne atto (ack) o posticiparli. |
| `cron` | I cron job dell'app distribuita e le relative esecuzioni registrate, consultabili con il tuo login `rebase cloud`. In sola lettura |
| `env` | Variabili d'ambiente. `list` non stampa mai i valori; `--secret` è in sola scrittura |
| `app-key` | La chiave scritta da `init --claim` in `.env` come `REBASE_API_TOKEN`, trasferita al momento del riscatto; `rotate` la sostituisce revocando la precedente. Riservato a proprietari e amministratori |
| `service-key` | `REBASE_SERVICE_KEY`, chiave di amministrazione per l'API interna dell'app: data dell'ultima rotazione; `rotate` ne assegna una nuova. Riservato a proprietari e amministratori |
| `domains` | Domini personalizzati, record DNS da aggiungere e verifica. Un progetto può rispondere su più domini, ciascuno verificato individualmente; `verify` e `remove` richiedono il dominio su cui operare, che può essere omesso solo quando ne è presente uno solo (per `verify`, uno ancora in sospeso). Ogni dominio verificato serve il progetto direttamente; `primary <domain>` definisce quello canonico e `redirect <domain>` reindirizza un altro dominio verso di esso con un codice 308, mantenendo path e query (`--off` torna a servirlo direttamente) — consigliato per `www.` affiancato a un dominio apex, poiché l'accesso Google, i cookie e le passkey sono legati all'origine. Un dominio su cui è servita una specifica app (un `path` di un'app con un hostname) non esegue mai reindirizzamenti. Un dominio apex (`example.com`, senza sottodominio) richiede un record **A**, poiché il DNS non ammette record CNAME alla radice. Tale indirizzo è l'ingress della piattaforma e non è garantito che rimanga immutato: in caso di migrazione della piattaforma, un record A continuerà a puntare al vecchio indirizzo. Se il tuo gestore DNS supporta record ALIAS, ANAME o CNAME flattening sull'apex, fai puntare l'apex al parametro `tenantHost` del progetto, che segue la piattaforma automaticamente. Il record CNAME di un sottodominio lo segue già per sua natura. `list` riporta `verified, certificate pending` finché HTTPS non risponde con un certificato valido. `list --json` restituisce `{ projectId, tenantHost, domains: [...] }` |
| `db` | Associazione o creazione di un database, connessione dalla tua macchina locale, backup, ripristino e point-in-time recovery |
| `guests` | Gli utenti guest generati dall'accesso anonimo: conteggio, eliminazione di singoli utenti, rimozione di quelli inattivi da molto tempo. Vedi [Guest](/docs/cli/cloud/#guests). Riservato a proprietari e amministratori |
| `extensions` | L'allowlist delle estensioni Postgres |
| `storage` | Il bucket del progetto |
| `resources` | Database e bucket gestiti dalla piattaforma rispetto a quanto dichiarato nel codice |
| `compute` | Risorse riservate dal progetto, relativi costi e modalità di modifica |
| `events` | Cronologia degli eventi del backend, dai più recenti: scalabilità dell'app, modifiche al database pianificate e applicate, subentro di uno standby, espansione del disco |
| `usage` | Richieste utilizzate questo mese rispetto alla quota inclusa ed eventuale eccedenza maturata, come conteggiato in fattura. `usage org` elenca ogni progetto dell'organizzazione |
| `clusters` | I cluster su cui vengono eseguiti i tenant. Riservato agli amministratori della piattaforma |
| `settings`, `orgs`, `billing` | Impostazioni di progetto, organizzazioni, membri, inviti e pagamenti |
| `activity` | Il registro di audit dell'organizzazione: chi ha eseguito un deploy, modificato una variabile d'ambiente (per nome), un dominio, un backup, un membro o un token. Riservato a proprietari e amministratori. Vedi [Verifica chi ha fatto cosa](#verifica-chi-ha-fatto-cosa) |
| `notifications` | Destinazione a cui vengono inviati (POST) gli eventi del progetto: Slack, Discord o qualsiasi URL HTTPS ([Notifiche Cloud](/docs/deployment/cloud-notifications/)) |

Ogni gruppo presente in questa tabella risponde a `--help` con una pagina dedicata — sintassi di
utilizzo, flag ed esempi — e `--help` non esegue mai il comando. Un test verifica l'indice di queste
pagine: pertanto, l'aggiunta di un gruppo senza la relativa pagina fa fallire il build anziché mostrare
il sommario. Il controllo `verify:docs` vincola la tabella stessa a tale indice: ogni gruppo gestito
dalla CLI compare qui esattamente una volta, quindi anche un gruppo aggiunto senza la corrispondente
riga nella tabella causerà il fallimento del build.

Quando usato all'interno di una pipe, `--help` risponde in formato JSON: la medesima sintassi d'uso, i
flag e gli esempi strutturati per una facile lettura, al posto di sessanta righe di sequenze di escape da terminale.

## Cosa non include la beta

Nessuna possibilità di scelta della regione, nessuna registrazione self-service, nessun SLA pubblicato,
nessun deploy per branch, nessun token che operi a nome di una persona e nessun endpoint pubblico per il
database. La pagina [Cosa non include la beta](/docs/deployment/cloud-beta-limits/) descrive chiaramente ciascuno
di questi punti, spiegando inoltre cosa comporta eseguire il deploy con i secret di produzione.

## Self-hosting come alternativa

Nessuna di queste soluzioni comporta un vincolo proprietario (vendor lock-in). La [guida al self-hosting](/docs/deployment/self-hosting/)
esegue la medesima immagine e bundle tramite `docker compose`, mentre la
[guida a Kubernetes](/docs/deployment/kubernetes/) riproduce la stessa topologia a partire
dall'Helm chart.
