---
sourceHash: a6cdd8811eca0897
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Cos'è, come si collega e distribuisce un progetto e cosa non include ancora la beta privata.
---

Rebase Cloud esegue lo stesso Rebase open-source che ospiteresti in self-hosting — la stessa immagine pubblicata `rebasepro/server`, lo stesso bundle, lo stesso Postgres. La differenza sta in chi lo gestisce.

:::note[Beta privata]
Rebase Cloud è in **beta privata**. Gestisce già tenant reali e apre gli accessi a scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi seguenti richiedono un account a cui sia stato concesso l'accesso. Tutto il resto su questo sito funziona anche senza.
:::

## Cos'è

Un **progetto** Cloud è costituito da tre elementi che la piattaforma gestisce per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine di runtime pubblicata. I deploy consistono nel caricamento di un bundle, non nella compilazione di un container |
| **Database** | Un PostgreSQL gestito, con backup automatizzati e point-in-time recovery |
| **Storage** | Un bucket dedicato, se il tuo progetto utilizza l'archiviazione di file |

L'app e il database vengono sottoposti a provisioning al tuo primo deploy; un bucket solo quando ne richiedi uno ([File storage](#file-storage)). Ciascuno viene fatturato in base alle risorse riservate anziché per utente (per seat).

**Non cambia nulla nel tuo progetto per essere eseguito lì.** Lo stesso repository funziona in self-hosting con `docker compose`, e la via di fuga è concreta: `rebase build` produce un bundle che si avvia ovunque venga eseguita l'immagine di runtime.

## Collegare un progetto

Dalla directory di un progetto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` apre la console nel browser e stampa un codice breve. Verifica che la console mostri lo stesso codice e approva l'accesso: il terminale rileva la sessione e la scrive in `~/.rebase/credentials.json`. Se non hai effettuato l'accesso alla console, accedi prima con il metodo che preferisci, inclusi Google e GitHub. Tramite SSH, `rebase cloud login --no-browser` stampa il link da aprire sul tuo computer.

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono flag ed entrambi sono obbligatori — su un terminale vengono richiesti in modo interattivo, mentre un'esecuzione headless che ometta uno dei due termina con `input_required` anziché inventarne uno. **Il sottodominio non è modificabile in seguito:** è l'host `<slug>.rebase.website` su cui risponde il progetto, quindi sceglilo con attenzione.

`--link` collega questa directory al progetto nella stessa chiamata, quindi non è necessario un passaggio `link` separato. Scrive `.rebase/cloud.json`, che registra l'id e lo slug del progetto. Quel file non è un segreto e non contiene le tue credenziali — queste ultime si trovano in `~/.rebase/credentials.json`, scritto da `login`.

Viene tuttavia committato con il codice, quindi un repository clonato può indicare qualsiasi control plane. Quando l'host proviene solo da quel file e non è né quello della piattaforma né uno a cui hai effettuato l'accesso in precedenza, `login` ne indica il nome e chiede conferma prima di inviare la tua email e password. Senza un terminale, o con `--json`, rifiuta l'operazione con `unknown_control_plane`; passa `--url <host>` (o imposta `REBASE_CLOUD_URL`) per effettuare l'accesso intenzionalmente.

Per accedere senza browser, passa la tua email: `rebase cloud login --email me@example.com` ti chiederà la password. **Ti sei registrato con Google, GitHub o LinkedIn?** Il tuo account non ha una password, quindi usa invece un codice:

```bash
rebase cloud login --code --email me@example.com
```

Il control plane ti invierà via email un codice a 6 cifre, valido per dieci minuti, che digiterai al prompt. Con `--email` e senza password, `rebase cloud login` ti chiederà se usare la password o un codice. I codici richiedono che il control plane sia in grado di inviare email; in caso contrario, `--code` lo segnala ed esce con `otp_unavailable`.

Se hai attivato l'autenticazione a due fattori, `login` richiede poi il codice dalla tua app di autenticazione o uno dei tuoi codici di recupero, a seconda di come hai effettuato l'accesso. Tramite browser, la console lo richiede al momento del login. Né un codice di accesso né un secondo fattore possono essere digitati senza un terminale. Per uno script, crea un token di accesso nella console (**Settings → Access tokens**) e imposta `REBASE_TOKEN`; vedi [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

Una password errata risponde con `invalid_credentials` con le stesse due modalità di accesso, poiché la causa comune è un account che non ne ha mai avuta una.

`billing setup` associa una carta all'organizzazione, una sola volta. È posizionato per primo nella sequenza intenzionalmente: il primo deploy di un progetto viene rifiutato senza di essa, e scoprirlo dopo che un bundle ha terminato il caricamento sarebbe l'ordine peggiore.

Dopodiché, la pagina **Billing** della console elenca le fatture dell'organizzazione, ciascuna con la pagina ospitata e il PDF di Stripe, e mostra l'anteprima della fattura successiva per ogni progetto. `rebase cloud billing invoices` e `rebase cloud billing upcoming` stampano le stesse informazioni. Entrambi sono riservati ai proprietari (owners) e amministratori dell'organizzazione. Dove la piattaforma lo prevede, **Manage billing** apre il portale clienti di Stripe per la carta, i dati di fatturazione e le fatture passate.

Con una carta già registrata, la creazione di un altro progetto nella console non richiede un secondo pagamento: il progetto viene fatturato su quella carta e distribuito. Se la carta viene rifiutata, o la banca richiede la conferma del pagamento, la console ti reindirizza a **Billing**, dove **Fix your card** consente di salvare un'altra carta e **Complete the payment** apre la fattura di Stripe.

L'utilizzo di un progetto viene mostrato nella sua panoramica, sotto **Usage this month**, e per tutti i progetti contemporaneamente nella pagina **Billing**: richieste rispetto alla soglia inclusa (la barra diventa ambra all'80%), errori 5xx, l'eccedenza maturata finora e la proiezione per fine mese a questo ritmo. L'eccedenza è calcolata dallo stesso codice che la segnala a Stripe, quindi corrisponde a quanto sarà addebitato in fattura; compare nella fattura del mese successivo. `rebase cloud usage` stampa gli stessi dati, e `rebase cloud usage org` quelli dell'intera organizzazione. Qualsiasi membro può visualizzarli. I dati indicano ciò che non possono ancora rilevare: l'object storage non viene misurato, quindi non viene fatturata alcuna eccedenza di archiviazione; mentre un progetto esegue due o più pod dell'app, le sue richieste non vengono conteggiate; e una giornata con campionamenti mancati produce un conteggio per difetto. Un progetto con scalabilità automatica (autoscaled) mostra anche i pod eseguiti oltre `--replicas`, in ore-pod, il loro costo in base alle proprie tariffe e se questa piattaforma li addebita già. Un progetto riscattato da un agente conteggia solo i giorni a partire dal riscatto: prima di esso, il progetto apparteneva alla piattaforma.

Un progetto esistente può essere collegato senza crearne uno nuovo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Un solo comando e nessun flag da ricordare. Il file `rebase.json` di uno scaffold dichiara `runtime: "managed"` per il proprio backend, e `deploy` legge tale dichiarazione — segnalandolo durante l'operazione (`rebase.json declares runtime: managed — deploying a bundle`), compila l'app in `dist-bundle`, carica il bundle, lo esegue sull'immagine di runtime pubblicata e segue il deployment fino a uno stato finale. Il codice di uscita rappresenta l'esito, quindi la stessa riga funziona in modo non presidiato nei flussi di CI.

Termina indicando dove risponde ciascuna app e se la nuova versione è live a quell'indirizzo:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

«Live» significa che l'indirizzo ha risposto dopo la build: il `/health` di un backend ha restituito `ok`, e la pagina di un'app statica è stata caricata (da questo deployment, quando la piattaforma la serve). Il controllo attende fino a `--live-timeout` secondi, 60 per impostazione predefinita; `0` lo salta. Se un'app non risponde in tempo, il deploy restituisce comunque codice zero, perché il deployment è riuscito, e l'ultima riga indica quale app non ha risposto e perché. Un deploy fallito termina invece su una sola riga, indicando l'app e il motivo, con `rebase cloud logs` per il log completo della build.

Gli script passano `--json` per ottenere un singolo oggetto contenente le stesse informazioni — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e l'id del deployment. A differenza del resto di `rebase cloud`, `deploy` non passa automaticamente al JSON quando è reindirizzato tramite pipe.

Ciò che tale runtime consente — pacchetti e moduli nativi, memoria e istanze, timeout e dimensioni del body, filesystem, secret, storage e rete in uscita — è descritto nella relativa pagina:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Per distribuire un artefatto compilato in precedenza — ad esempio un job CI che compila una volta e distribuisce due volte — punta alla directory invece di ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

L'uscita dal runtime gestito richiede un flag dedicato, `--eject`, e nient'altro lo richiede: una build che sposterebbe un progetto gestito su un'immagine container di cui diventa proprietario viene rifiutata finché non lo specifichi espressamente. In precedenza si usava `--force`, che associava l'azione meno reversibile della CLI alla stessa parola di «sovrascrivi questo file»; ora è un'opzione sconosciuta anziché un alias, quindi uno script che la contiene si interrompe.

### Il controllo sintattico prima dell'upload

I file di un'app statica vengono serviti esattamente come sono. Quando il suo `build` si limita a copiare script scritti a mano in `output`, nulla li ha analizzati, e un file con un errore di battitura finisce live impedendo il caricamento della pagina. Pertanto, prima di caricare qualsiasi cosa, `deploy` analizza sintatticamente ogni file `.js`, `.mjs` e `.cjs` nell'`output` di ciascuna app statica, insieme a ogni `<script>` inline nei suoi file `.html`. Questo copre sia un'app statica distribuita da sola sia le app statiche incorporate nel bundle del backend. Un errore di sintassi blocca il deploy indicando file, riga e colonna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json` il `code` dell'errore è `syntax_error`. Gli script inline che un browser non esegue come JavaScript vengono ignorati: JSON, import map, template e qualsiasi altro `type` non JavaScript, i `<script src>` e gli script che contengono ancora markup di template non renderizzato come `{{ }}`. Un file `.js` supera il controllo se viene analizzato come script classico o come modulo, poiché è la pagina a deciderlo. Non viene letto nulla all'interno di `node_modules`, né da una `--bundle-dir` precompilata. `--no-verify` salta il controllo per un singolo deploy.

Monitora l'avanzamento:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` riporta `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la piattaforma sta lavorando attivamente ed effettuare il polling è la cosa corretta da fare; quando indica un elemento, quell'elemento è in attesa di una tua azione.

Uno di questi è `email_not_configured`: l'app ha abilitato l'accesso tramite magic-link o codice email (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) ma non ha un servizio email configurato, quindi il deployment è live ma nessuno può accedere. Rebase Cloud non invia email per conto della tua app: imposta `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` con `rebase cloud env set`, quindi esegui il deploy. `status` lo rileva dal `GET /api/auth/config` dell'app stessa (nel campo `unavailable`), e `deploy` segnala lo stesso nel suo controllo live.

## File storage

Un nuovo progetto non ha alcun bucket: i caricamenti vengono rifiutati con `501 STORAGE_NOT_CONFIGURED`, come indicato nel riepilogo del deploy, anziché essere scritti su un disco che ogni deploy sostituisce.

Assegnagliene uno tra due tipologie, quindi esegui nuovamente il deploy affinché l'app lo rilevi:

```bash
# A bucket Rebase runs for you. The console's Storage page does the same.
rebase cloud storage create

# Or your own S3-compatible bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omit for AWS; add --force-path-style for MinIO

rebase cloud deploy
```

`rebase cloud storage` elenca i bucket del progetto. Un progetto con più bucket li collega ciascuno con `--source <key>`; uno che configura lo storage nel codice non richiede nessuno dei due.

## Anteprima di una modifica

```bash
rebase cloud deploy --preview
```

Questo comando compila e carica esattamente ciò che farebbe `deploy`, ma lo serve a un indirizzo dedicato, come ad esempio `https://shop--k3x9ab.rebase.website`. La produzione continua a servire ciò che serviva prima. Il deploy stampa l'indirizzo dell'anteprima al termine della build.

Per mantenere lo stesso indirizzo attraverso più deploy, assegna un nome alla preview. Distribuendo nuovamente con lo stesso nome la si aggiorna:

```bash
rebase cloud deploy --preview-name new-checkout
```

I componenti con cui interagisce una preview dipendono da cosa hai distribuito:

- **`rebase cloud deploy --preview`** genera l'anteprima del backend, con le sue app statiche incorporate, nello stesso modo in cui vengono eseguite in produzione. Riceve un proprio backend su un **proprio database vuoto**, mai su quello di produzione. L'avvio sul database di produzione applicherebbe ad esso lo schema e le regole di accesso della preview.
- **`rebase cloud deploy web --preview`** genererebbe l'anteprima di una singola app statica da sola, con le sue pagine che richiamano il backend di **produzione**. Questo richiede un control plane in grado di servire siti statici autonomamente, cosa che Rebase Cloud non fa ancora: rifiuterà l'operazione con `PREVIEW_STATIC_UNSERVED` e non pubblicherà nulla. Esegui invece l'anteprima del backend, che serve le app statiche incorporate al suo interno; un progetto senza backend gestito non può ancora essere visualizzato in anteprima.

Una preview non carica codice sorgente e non registra app o hostname, poiché ognuna di queste azioni modificherebbe il progetto di produzione. `--source` e `--eject` non possono essere combinati con `--preview`. Ciascuno di essi compila un'immagine container per la produzione.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` senza `--preview` si riferisce sempre alla produzione.

La pagina **Deployments** della console elenca le stesse anteprime, consentendo di aprirle, visualizzarne il log di build o eliminarle. La creazione rimane un passaggio da riga di comando (CLI).

Una preview scade una settimana dopo l'ultimo deploy effettuato su di essa.

Al termine, il deploy verifica che l'indirizzo della preview risponda, come avviene per un deploy di produzione (`--live-timeout <seconds>`, `0` per saltare). Il certificato di una nuova preview può richiedere un minuto o due, quindi un deploy riuscito potrebbe segnalare che l'indirizzo non risponde ancora.

Una preview del backend viene fatturata come un'unità applicativa con la dimensione predefinita (100m di CPU e 384 MiB di memoria, alla tariffa della tua app per la sua regione e capacità), ripartita proporzionalmente (pro-rata) per la sua durata di esistenza, e compare nel preventivo mensile del progetto nella console. `rebase cloud deploy --preview` stampa lo stesso preventivo mensile (`cost` con `--json`). L'avvio di una preview richiede una carta registrata, proprio come un deploy di produzione. Un primo deploy che fallisce prima dell'esecuzione di qualsiasi elemento viene rimosso anziché fatturato. Un progetto può eseguire fino a tre preview di backend contemporaneamente.

Ogni nuovo indirizzo di preview riceve un proprio certificato TLS da Let's Encrypt, che consente a un dominio 50 nuovi certificati a settimana, condivisi con tutti i siti di produzione su di esso. Le preview possono utilizzarne 20 in qualsiasi arco di 7 giorni, a livello di piattaforma. Oltre tale limite, una nuova preview viene rifiutata (`429`, `preview_cert_budget`) indicando il momento in cui potrà essere distribuita; la ridistribuzione di una preview già esistente non viene mai conteggiata.

Il database di una preview di backend è un secondo database sul Postgres di **produzione**: ha dati propri, ma condivide la stessa istanza e lo stesso disco. È limitato a 10 connessioni, in modo che le preview non esauriscano quelle di produzione, e a 2 GB: una preview il cui database supera tale dimensione viene messa in pausa. Il suo backend si ferma, il suo indirizzo smette di rispondere, `rebase cloud previews` e la console la mostrano come `paused` indicandone il motivo, e i proprietari e gli amministratori del progetto ricevono una notifica (`preview.paused`). I suoi dati vengono conservati fino alla scadenza. Esegui nuovamente il deploy per avviarla (verrà messa nuovamente in pausa se il database è ancora troppo grande), oppure eliminala. Una preview in pausa continua a essere fatturata finché non viene eliminata o non scade. Elimina le preview che non ti servono più. Le estensioni installate in produzione non vengono installate nel database di una preview.

Le preview sono in fase di rilascio progressivo. Un control plane che non le supporta ancora rifiuterà `--preview` con `previews_unavailable` e non distribuirà nulla.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback reindirizza il progetto a quanto distribuito da un precedente deployment riuscito, senza mai ricompilare — il vantaggio di un rollback è che distribuisce un artefatto già collaudato ed eseguito.

I deployment idonei dipendono dalla modalità con cui il progetto è stato distribuito, ed entrambi i tipi sono supportati:

| Modalità di deploy | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (una build dai sorgenti) | L'immagine pubblicata da quella build |
| `rebase cloud deploy --bundle` (il runtime della piattaforma) | Il bundle distribuito da quel deploy, sulla versione del runtime attualmente in esecuzione per il progetto |

Le app statiche incorporate nel bundle del backend (un normale `rebase cloud deploy` su un progetto con un backend) fanno parte di quel bundle, quindi subiscono il rollback insieme a esso.

Un'app statica distribuita singolarmente (`rebase cloud deploy <app>`) non può ancora essere ripristinata con un rollback. Il suo deployment registra quale app ha pubblicato, ma nessun bundle, quindi il control plane non ha nulla da cui ripristinarla. La soluzione consiste nel distribuire nuovamente l'ultima versione funzionante, ad esempio dal commit precedente a quello problematico. Dopo un tale deploy, `deploy` segnala questa situazione anziché suggerire `rollback`, e `rollback` senza un ID rifiuta l'operazione anziché ridistribuire il backend attualmente attivo.

Un rollback richiede quindi un deployment che abbia registrato uno dei due elementi, il che presuppone un progetto distribuito con successo almeno due volte. `rebase cloud deployments` contrassegna quelli idonei, e `--json` riporta `rollbackable` per ogni riga insieme alla `image` o al `bundle` che verrebbe ripristinato.

Due tipi di deployment vengono rifiutati, e la CLI specifica quale: uno che non è andato a buon fine e uno risalente a prima che la piattaforma registrasse il relativo artefatto. Non c'è nulla da ipotizzare in entrambi i casi — tirare a indovinare comporterebbe la distribuzione di ciò che è stato compilato o caricato più di recente pretendendo di ripristinare questo — pertanto distribuisci direttamente la versione desiderata.

Ogni deploy riuscito termina indicando la via di ripristino (`rebase cloud rollback`), in modo che sia subito visibile nel momento in cui ci si accorge di una release problematica.

Un rollback aggiunge un nuovo deployment anziché riavvolgere la cronologia, e attende che la versione ripristinata sia attiva prima di segnalare l'esito positivo. Seguilo con `rebase cloud logs -f`.

## Ripristinare il database a un punto nel tempo

Un database gestito può essere ripristinato a qualsiasi minuto all'interno della sua finestra di ripristino, da **Database → Backups** nella console o tramite la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
L'operazione richiede due passaggi. Innanzitutto viene preparata (staged) una copia ripristinata accanto al database attivo; la tua app continua a funzionare su quest'ultimo, e lo storage della copia viene fatturato finché non effettui il cutover o la scarti.
Poi, una volta pronta la copia, il cutover reindirizza l'app verso di essa e la riavvia. Tutto ciò che è stato scritto dopo l'orario di destinazione non è presente nella copia. Il database originale viene conservato come piano di rientro e continua a essere fatturato per lo storage; il ritorno al database precedente, la sua rimozione o un secondo ripristino richiedono l'intervento dell'assistenza. Solo un proprietario (owner) o amministratore (admin) può eseguire lo staging, il cutover o lo scarto, e la console richiede il nome del progetto prima di effettuare il cutover.

## Proteggere il tuo account

Il tuo account della console può accedere ai database di produzione, ai secret e alla fatturazione, quindi proteggilo adeguatamente. Apri **Account security** dal menu sotto il tuo avatar nella console (oppure vai su `/account`). La pagina è personale, non appartiene a un'organizzazione: le impostazioni configurate qui si applicano a tutte le organizzazioni a cui appartieni.

- **Verifica in due passaggi (Two-step verification).** Attivala con qualsiasi app di autenticazione (1Password, Google Authenticator, Authy). La pagina mostra una chiave di configurazione da aggiungere all'app, oppure un link che apre l'app con la chiave precompilata su uno smartphone, per poi richiedere il codice a 6 cifre mostrato dall'app. Da quel momento in poi, ogni accesso richiederà un codice, sia che tu acceda con password, Google o GitHub.
- **Codici di recupero (Recovery codes).** L'attivazione genera dieci codici monouso, mostrati una sola volta. Ciascuno di essi consente l'accesso al posto del codice dell'autenticatore in caso di smarrimento del telefono, pertanto salvali prima di chiudere la finestra di dialogo. **New recovery codes** li sostituisce e invalida quelli vecchi. Sia la disattivazione della verifica in due passaggi sia la generazione di nuovi codici richiedono prima l'inserimento di un codice.
- **Password.** La sua modifica comporta la disconnessione su tutti gli altri dispositivi. Un account creato con Google, GitHub o LinkedIn non possiede una password; la pagina offre la possibilità di ricevere un'email con un link per impostarne una.
- **Dispositivi connessi (Signed-in devices).** Ogni browser e terminale connesso al tuo account, con il relativo indirizzo e l'orario di accesso. Disconnetti qualsiasi dispositivo che non riconosci, oppure tutti contemporaneamente.

I [token di accesso](/docs/deployment/cloud-agents/#ci-and-agents) non sono sessioni e non richiedono un secondo fattore, consentendo alla CI di continuare a effettuare i deploy anche dopo l'attivazione. Revoca un token di cui non ti fidi più in **Settings → Access tokens**.

## Invitare il tuo team

**Members → Add member** aggiunge un utente che possiede già un account Rebase con un indirizzo email verificato, come amministratore (admin) o membro; un owner può promuoverlo a owner successivamente. L'accesso è immediato e non viene inviata alcuna email. Rebase Cloud non invia ancora inviti, quindi chiedi a un collega privo di account di registrarsi e verificare prima il proprio indirizzo. Da terminale:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), che segnala se l'indirizzo non corrisponde ad alcun account.

## Accesso a Cloud e utenti della tua app

<span class="since-badge" data-since="0.35">Da 0.35</span>

Sono coinvolti due gruppi distinti di persone, come in Firebase e Supabase:

- **L'accesso a Cloud** riguarda chi può lavorare sul progetto in Rebase Cloud. Gli owner e gli admin di un'organizzazione sono `admin` su ogni progetto di sua proprietà, e i suoi membri sono `developer`. Un progetto può anche assegnare a una singola persona un ruolo specifico, `admin`, `developer` o `viewer`, tramite un invito via email, senza renderla membro dell'organizzazione. Si applica il ruolo più elevato tra i due. [`rebase cloud access`](/docs/cli/cloud/#project-access) si occupa della sua gestione.
- **Gli utenti della tua app** risiedono nel database dell'app stessa, con le proprie registrazioni e i propri ruoli. Cloud non li visualizza né li modifica mai.

L'unico punto di contatto è **Open admin panel**. Questo effettua l'accesso per una persona con accesso Cloud `admin` al pannello di amministrazione dell'app, confrontando il suo indirizzo email verificato: l'app individua o crea l'account con quell'indirizzo, gli assegna il ruolo `admin` e registra che tale ruolo proviene da Rebase Cloud (Utenti e ruoli di Studio lo contrassegna). Quando tale persona perde l'accesso Cloud `admin` al progetto, Rebase Cloud richiede all'app di revocare quel ruolo `admin` e termina le sue sessioni nell'app. Un ruolo concesso manualmente nell'app, compreso un ruolo `admin` posseduto prima del primo Open admin panel, viene mantenuto e l'account non viene mai eliminato.

## Vedere chi ha fatto cosa

La pagina **Activity** della console e `rebase cloud activity` mostrano agli owner e admin dell'organizzazione chi ha effettuato un deploy, impostato o visualizzato una variabile d'ambiente (per nome, mai per valore), modificato un dominio, ripristinato un backup, ridimensionato, arrestato o eliminato un progetto, cambiato il ruolo di un membro o creato un token, e quando. La sezione **Settings** di un progetto rimanda alle proprie voci; le voci relative a un progetto eliminato rimangono. Uno script può leggerle tramite un token creato con `--can audit` sull'organizzazione. Le voci vengono conservate per un anno. I filtri sono disponibili in
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agenti

Un job di CI o un agente non dovrebbe contenere la tua password. Assegnagli un token limitato a poche azioni su un singolo progetto, creato da un terminale autenticato con `rebase cloud tokens create --project shop --can deploy,logs`, e impostalo come `REBASE_TOKEN`. La fatturazione, il log delle attività e le impostazioni di notifica di un'organizzazione sono permessi specifici (`--can billing`, `audit`, `notifications`) che un token possiede solo se esplicitamente richiesto. I permessi, un flusso di lavoro GitHub Actions e ciò che rimane associato a una persona autenticata sono descritti in
[CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend senza account

`rebase cloud init --claim` fornisce a un'app un backend attivo prima ancora che qualcuno si sia registrato, e stampa un URL di riscatto (claim) affinché la persona possa mantenerlo; un progetto non riscattato entro 72 ore viene eliminato. Ciò che il token del progetto non riscattato può fare, il `REBASE_API_TOKEN` che scrive e cosa comporta il riscatto sono descritti in
[Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Compute e i relativi costi

Il prezzo di un progetto si basa sulle risorse riservate, non su un piano fisso. `compute` stampa ogni parametro e il relativo preventivo dettagliato fornito dal control plane. (`rebase cloud resources` è una cosa diversa: i database e i bucket dichiarati dal codice e lo stato di provisioning di ciascuno — consulta la [documentazione della CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Risorse richieste dall'app per istanza, es. `500m` e `2Gi`. Se vuoto, indica il valore predefinito della piattaforma, che dipende dalla regione (sotto) |
| `--replicas` | Istanze sempre attive: il limite minimo dell'autoscaler e ciò che la sottoscrizione del progetto fattura mensilmente |
| `--autoscale-max` | 1–16. Il tetto massimo raggiungibile. Le istanze aggiunte dall'autoscaler oltre `--replicas` sono misurate per secondo-pod alle stesse tariffe, e fatturate solo dove la piattaforma ha abilitato tale funzione; **Usage this month** indica se è attivo. `--no-autoscale` lo disattiva |
| `--autoscale-cpu-target` | 10–95. L'utilizzo di CPU mantenuto dall'autoscaler, calcolato rispetto alla richiesta anziché al limite. Vuoto equivale a 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica e riavviabile senza preavviso |
| `--db-instances` | 1–3. `1` è un'istanza singola senza failover; `2` aggiunge uno standby automatico |
| `--db-cpu`, `--db-memory` | Per singola istanza di database. Vuoto equivale a `160m` e `1Gi` |

Un parametro vuoto non equivale a uno impostato sullo stesso numero: un parametro vuoto segue il valore predefinito della piattaforma e cambia quando quest'ultimo cambia.

In Belgio (europe-west1) il default riserva 100m di CPU e 384Mi con possibilità di picco (burst) fino a 2 CPU e 2 GiB; a Falkenstein e Helsinki la memoria può estendersi fino a 1,4× la richiesta e la CPU fino a 10× (massimo 1,7 vCPU). `rebase cloud compute` mostra i valori del tuo progetto.

Nulla viene validato dalla CLI, intenzionalmente — i limiti appartengono al cluster su cui viene eseguito un progetto e variano a seconda dei provider. Il control plane rifiuta un valore che non può soddisfare indicando il campo corrispondente. Esegui `rebase cloud compute` per visualizzare il costo in €/mese prima e dopo; una modifica si applica immediatamente, ripartita proporzionalmente da oggi. Una modifica al database si applica subito; viene fatturata alla dimensione attuale finché non è operativa. L'assegnazione di nuova CPU o memoria al database, oppure una riduzione delle istanze, comporta il riavvio del database (da circa 30 secondi a 3 minuti; le connessioni vengono interrotte e si riconnettono): `compute set` lo segnala e chiede conferma, mentre al di fuori di un terminale interattivo `--yes` funge da consenso. Se tale riavvio fallisce, `rebase cloud compute apply` ritenta l'operazione.

## Il resto dei comandi

| Gruppo di comandi | Cosa include |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | La tua sessione; `access-token` stampa il bearer token che la CLI invierebbe attualmente, utile per script e server MCP |
| `tokens` | Token per CI e agenti, ciascuno limitato a un singolo progetto. Vedi [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Collegamento di questa directory a un progetto, selezione di un'organizzazione, apertura della console |
| `connect` | Aggiunta di un server Rebase self-hosted al tuo account, in modo che il [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude possa raggiungerlo accanto ai tuoi progetti Cloud. `--list` li mostra, `--remove` ne rimuove uno. Riservato a owner e admin |
| `init`, `claim` | Con `--claim`: un backend attivo senza account e un link per riscattarlo; `claim` stampa nuovamente tale link. Vedi [Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Creazione, elenco, ispezione, eliminazione |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Distribuzione e monitoraggio |
| `deploy-hooks` | URL segreti che un host git o una CI richiama per distribuire il progetto: elenco, creazione (l'URL viene mostrato una sola volta), revoca. |
| `previews` | Build servite su un proprio indirizzo tramite `deploy --preview`, e loro eliminazione. Vedi [Anteprima di una modifica](#anteprima-di-una-modifica) |
| `sleep` | Sospensione in caso di inattività: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake`, e `status` (predefinito). In stato di sospensione, un progetto non occupa CPU o memoria e la richiesta successiva lo risveglia; i job pianificati e le attività in background non vengono eseguiti durante la sospensione. Nei casi in cui un progetto non può essere sospeso, il control plane rifiuta la richiesta indicandone il motivo |
| `start`, `stop`, `restart` | Messa in pausa di un progetto e riattivazione. Un progetto arrestato mantiene la sua sottoscrizione, a meno che la piattaforma non fatturi per i progetti arrestati solo lo storage e la tariffa della piattaforma; la riga **Billing** della console lo specifica quando applicabile |
| `status`, `metrics`, `debug` | Cosa sta facendo il sistema e perché non risponde |
| `alerts` | Incidenti aperti del progetto, con conferma di presa in carico (acknowledgement) o sospensione temporanea (snooze). |
| `cron` | Cron job dell'app distribuita e relative esecuzioni registrate, consultabili con il login di `rebase cloud`. Di sola lettura |
| `env` | Variabili d'ambiente. `list` non stampa mai i valori; `--secret` è di sola scrittura |
| `app-key` | La chiave scritta da `init --claim` in `.env` come `REBASE_API_TOKEN`, trasferita al momento del riscatto; `rotate` la sostituisce revocando la precedente. Riservato a owner e admin |
| `service-key` | `REBASE_SERVICE_KEY`, admin sull'API dell'app stessa: data dell'ultima rotazione; `rotate` assegna una nuova chiave all'app. Riservato a owner e admin |
| `domains` | Domini personalizzati, record DNS da aggiungere e verifica. Un progetto può rispondere su più domini, ciascuno verificato singolarmente; `verify` e `remove` accettano il dominio su cui operare, che può essere omesso solo quando ce n'è uno solo (per `verify`, uno ancora in sospeso). Ogni dominio verificato serve il progetto direttamente; `primary <domain>` seleziona quello canonico e `redirect <domain>` reindirizza un altro con un 308 verso di esso, preservando path e query (`--off` torna a servirlo direttamente) — operazione consigliata per `www.` accanto a un apex domain, poiché l'accesso Google, i cookie e le passkey sono legati all'origine (origin). Un dominio su cui è servita un'app (un `path` di app con un hostname) non effettua mai redirect. Un dominio apex (`example.com`, senza sottodominio) richiede un record **A**, poiché il DNS non ammette record CNAME a tale livello. Tale indirizzo corrisponde all'ingress della piattaforma e non è garantito che rimanga invariato: se la piattaforma viene spostata, un record A continuerà a puntare al vecchio indirizzo. Se il tuo gestore DNS offre ALIAS, ANAME o CNAME flattening a livello apex, punta l'apex al `tenantHost` del progetto, che segue automaticamente la piattaforma. Il CNAME di un sottodominio la segue già. `list` indica `verified, certificate pending` finché HTTPS non risponde con un certificato valido. `list --json` restituisce `{ projectId, tenantHost, domains: [...] }` |
| `db` | Collegamento o creazione di un database, connessione ad esso dal proprio computer, backup, ripristino e point-in-time recovery |
| `guests` | Gli utenti guest lasciati dall'accesso anonimo: conteggio, eliminazione singola, pulizia (pruning) di quelli non visti da molto tempo. Vedi [Ospiti](/docs/cli/cloud/#guests). Riservato a owner e admin |
| `extensions` | La allowlist delle estensioni Postgres |
| `storage` | Il bucket del progetto |
| `resources` | Quali database e bucket sono gestiti dalla piattaforma rispetto a quanto dichiarato dal codice |
| `compute` | Risorse riservate dal progetto, relativi costi e come modificarle |
| `events` | Cronologia degli eventi del backend, dal più recente: scalabilità dell'app, modifiche al database pianificate e applicate, subentro di uno standby, espansione del disco |
| `usage` | Richieste utilizzate questo mese rispetto alla soglia inclusa ed eccedenza attuale, calcolata ai fini della fatturazione. `usage org` elenca ogni progetto dell'organizzazione |
| `clusters` | I cluster su cui vengono eseguiti i tenant. Riservato agli amministratori della piattaforma |
| `settings`, `orgs`, `access`, `billing` | Impostazioni del progetto, organizzazioni con relativi membri e inviti, autorizzazioni di accesso al progetto, pagamenti |
| `activity` | Audit log dell'organizzazione: chi ha eseguito un deploy, modificato una variabile d'ambiente (per nome), un dominio, un backup, un membro o un token. Riservato a owner e admin. Vedi [Vedere chi ha fatto cosa](#vedere-chi-ha-fatto-cosa) |
| `notifications` | Destinazione a cui vengono inviati gli eventi del progetto tramite POST: Slack, Discord o qualsiasi URL https ([Notifiche Cloud](/docs/deployment/cloud-notifications/)) |

Ogni gruppo in quella tabella risponde a `--help` con una pagina dedicata — una sintassi di utilizzo, i relativi flag ed esempi — e `--help` non esegue mai il comando. Un test verifica l'indice di queste pagine, quindi l'aggiunta di un gruppo privo di documentazione fa fallire la build anziché mostrare il sommario. `verify:docs` vincola la tabella stessa a tale indice: ogni gruppo gestito dalla CLI compare qui esattamente una volta, pertanto anche un gruppo aggiunto senza la rispettiva riga farà fallire la build.

Quando reindirizzato tramite pipe, `--help` risponde invece in formato JSON: la stessa riga di utilizzo, flag ed esempi strutturati per una lettura programmatica anziché sessanta righe di sequenze di escape da terminale.

## Cosa non include la beta

Nessuna scelta della regione, nessuna registrazione self-service, nessuno SLA pubblicato, nessun deploy per branch, nessun token che agisca per conto di una persona e nessun endpoint pubblico per il database. [Cosa non include la beta](/docs/deployment/cloud-beta-limits/) descrive chiaramente ciascuno di questi punti, spiegando cosa comporti distribuire con i secret di produzione.

## Alternative in self-hosting

Non vi è alcun vincolo di lock-in. La [guida al self-hosting](/docs/deployment/self-hosting/) esegue la medesima immagine e lo stesso bundle tramite `docker compose`, e la [guida a Kubernetes](/docs/deployment/kubernetes/) applica la stessa topologia a partire dal chart Helm.
