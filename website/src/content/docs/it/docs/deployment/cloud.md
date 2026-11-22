---
sourceHash: daa75b0f6ab9dbdf
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Di cosa si tratta, come collegare e distribuire un progetto e cosa la beta privata non include ancora.
---

Rebase Cloud esegue lo stesso Rebase open source che ospiteresti in self-hosting: la stessa immagine `rebasepro/server` pubblicata, lo stesso bundle, lo stesso Postgres. La differenza sta in chi lo gestisce.

:::note[Beta privata]
Rebase Cloud è in **beta privata**. Attualmente ospita tenant reali e le aperture avvengono a scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi seguenti richiedono un account a cui è stato concesso l'accesso. Tutto il resto su questo sito funziona anche senza.
:::

## Cos'è

Un **progetto** Cloud è composto da tre elementi che la piattaforma gestisce per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine di runtime pubblicata. I deploy consistono nel caricamento di un bundle, non nella compilazione di un container |
| **Database** | Un PostgreSQL gestito, con backup automatizzati e point-in-time recovery |
| **Storage** | Un bucket dedicato, se il tuo progetto utilizza lo storage di file |

L'app e il database vengono sottoposti a provisioning al tuo primo deploy; un bucket solo quando lo richiedi ([Storage dei file](#storage-dei-file)). Ognuno è fatturato in base alle risorse riservate anziché per utente (per seat).

**Nulla cambia nel tuo progetto per essere eseguito lì.** Lo stesso repository può essere ospitato in self-hosting con `docker compose`, e la via d'uscita è concreta: `rebase build` genera un bundle che si avvia ovunque sia eseguibile l'immagine di runtime.

## Collegare un progetto

Dalla directory di un progetto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` apre la console nel browser e stampa un codice breve. Verifica che la console mostri lo stesso codice e approva l'accesso da lì: il terminale acquisirà la sessione e la salverà in `~/.rebase/credentials.json`. Se non hai ancora effettuato l'accesso alla console, accedi prima lì con il metodo che preferisci, inclusi Google e GitHub. Tramite SSH, `rebase cloud login --no-browser` stampa il link da aprire sul proprio computer.

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono flag ed entrambi sono obbligatori: su un terminale vengono richiesti in modo interattivo, mentre un'esecuzione non interattiva (headless) che ne omette uno termina con `input_required` anziché inventarne uno. **Il sottodominio non è modificabile in seguito:** è l'host `<slug>.rebase.website` su cui risponde il progetto, quindi sceglilo con attenzione.

`--link` collega questa directory al progetto nella stessa chiamata, eliminando la necessità di un passaggio `link` separato. Scrive `.rebase/cloud.json`, che registra l'ID del progetto e lo slug. Quel file non è un segreto e non contiene le tue credenziali: queste risiedono in `~/.rebase/credentials.json`, scritto da `login`.

Viene tuttavia sottoposto a commit insieme al codice, quindi un repository clonato può indicare qualsiasi control plane. Quando l'host proviene solo da quel file e non è né quello ufficiale della piattaforma né uno su cui hai già effettuato l'accesso in precedenza, `login` ne mostra il nome e chiede conferma prima di inviarvi email e password. Senza un terminale, o con `--json`, rifiuta l'operazione con `unknown_control_plane`; passa `--url <host>` (o imposta `REBASE_CLOUD_URL`) per accedere intenzionalmente a quell'indirizzo.

Per accedere senza il browser, specifica la tua email: `rebase cloud login --email me@example.com` ti chiederà la password. **Ti sei registrato con Google, GitHub o LinkedIn?** Il tuo account non ha una password, quindi usa invece un codice:

```bash
rebase cloud login --code --email me@example.com
```

Il control plane ti invierà un codice a 6 cifre via email, valido per dieci minuti, da digitare al prompt. Con `--email` e senza password, `rebase cloud login` ti chiederà se usare la password o un codice. L'uso dei codici richiede che il control plane sia in grado di inviare email; in caso contrario, `--code` lo segnala ed esce con `otp_unavailable`.

Se hai attivato l'autenticazione a due fattori, `login` chiederà quindi il codice dall'app di autenticazione o uno dei tuoi codici di recupero, indipendentemente dal metodo di accesso scelto. Tramite browser, la console lo richiede durante l'accesso. Né un codice di accesso né un secondo fattore possono essere digitati senza un terminale. Per gli script, crea un token di accesso nella console (**Settings → Access tokens**) e imposta `REBASE_TOKEN`; vedi [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents).

Una password errata restituisce `invalid_credentials` suggerendo le stesse due modalità di accesso, poiché la causa comune è un account a cui non è mai stata associata una password.

`billing setup` collega una carta all'organizzazione, una sola volta. È volutamente il primo passaggio della sequenza: il primo deploy di un progetto viene rifiutato senza una carta registrata, e scoprirlo dopo che il caricamento del bundle è terminato sarebbe l'ordine peggiore.

Successivamente, la pagina **Billing** della console elenca le fatture dell'organizzazione, ciascuna con la pagina ospitata e il PDF di Stripe, e mostra l'anteprima della fattura successiva di ogni progetto. `rebase cloud billing invoices` e `rebase cloud billing upcoming` mostrano le stesse informazioni. Entrambi i comandi sono riservati a owner e admin dell'organizzazione. Dove previsto dalla piattaforma, **Manage billing** apre il portale clienti di Stripe per gestire la carta, i dati di fatturazione e le fatture precedenti.

Con una carta già memorizzata, la creazione di un altro progetto nella console non richiede un secondo pagamento: il progetto viene addebitato su quella carta e distribuito. Se la carta viene rifiutata o la banca richiede la conferma del pagamento, la console ti reindirizza a **Billing**, dove **Fix your card** consente di salvare un'altra carta e **Complete the payment** apre la fattura di Stripe.

Il consumo di un progetto è mostrato nella sua panoramica, sotto **Usage this month**, e per tutti i progetti contemporaneamente nella pagina **Billing**: richieste rispetto alla quota inclusa (la barra diventa arancione all'80%), errori 5xx, l'eccedenza maturata finora e la proiezione di fine mese a questo ritmo. L'eccedenza è calcolata dallo stesso codice che la trasmette a Stripe, quindi corrisponde a quanto sarà riportato in fattura; comparirà nella fattura del mese successivo. `rebase cloud usage` stampa le stesse metriche, mentre `rebase cloud usage org` mostra quelle dell'intera organizzazione. Qualsiasi membro può visualizzarle. I dati specificano ciò che non possono ancora rilevare: l'object storage non viene misurato, quindi non viene fatturata alcuna eccedenza di archiviazione; quando un progetto esegue due o più pod applicativi, le sue richieste non vengono conteggiate; e una giornata con campioni mancanti genera un sottoconteggio. Un progetto con scalabilità automatica mostra anche i pod eseguiti oltre `--replicas`, in ore-pod, il loro costo in base alle proprie tariffe e se questa piattaforma li fattura già. Un progetto riscattato (claimed) da un agente conteggia solo i giorni successivi al riscatto: prima di allora, il progetto apparteneva alla piattaforma.

Un progetto esistente può essere collegato senza crearne uno nuovo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Un solo comando e nessun flag da ricordare. Il `rebase.json` dello scaffold dichiara `runtime: "managed"` per il proprio backend e `deploy` legge tale dichiarazione — notificandolo durante il processo (`rebase.json declares runtime: managed — deploying a bundle`), compila l'applicazione in `dist-bundle`, carica il bundle, lo esegue sull'immagine di runtime pubblicata e segue il deployment fino a uno stato terminale. Il codice di uscita rappresenta l'esito finale, quindi la stessa riga funziona in modo non presidiato nei flussi di CI.

Termina indicando dove risponde ora ciascuna app e se la nuova versione è attiva (live) su di esse:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa che l'indirizzo ha risposto dopo la compilazione: l'endpoint `/health` di un backend ha restituito `ok` e la pagina di un'app statica è stata caricata (da questo deployment, quando viene servita dalla piattaforma). Il controllo attende fino a `--live-timeout` secondi, 60 per impostazione predefinita; `0` lo disabilita. Se un'app non risponde in tempo, il deploy termina comunque con codice zero poiché il deployment è andato a buon fine, e l'ultima riga specifica quale app non ha risposto e il motivo. Al contrario, un deploy fallito termina con una singola riga che indica l'app e il motivo, rimandando a `rebase cloud logs` per il log di compilazione completo.

Gli script possono passare `--json` per ricevere un singolo oggetto contenente le medesime informazioni: `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e l'ID del deployment. A differenza del resto di `rebase cloud`, `deploy` non passa automaticamente al formato JSON quando reindirizzato via pipe.

Cosa consente tale runtime — pacchetti e moduli nativi, memoria e istanze, timeout e dimensioni del body, filesystem, secret, storage e rete in uscita — è descritto nella pagina dedicata: [Managed backend runtime](/docs/deployment/managed-runtime/).

Per distribuire un artefatto compilato in precedenza — ad esempio in un job di CI che compila una volta e distribuisce due volte — punta alla directory invece di ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

L'uscita dal runtime gestito richiede un flag dedicato, `--eject`, e nessun altro comando la richiede: una compilazione che sposterebbe un progetto gestito su un'immagine container proprietaria viene rifiutata finché non lo specifichi espressamente. In passato si usava `--force`, che associava l'azione meno reversibile della CLI allo stesso termine di "sovrascrivi questo file"; ora è un'opzione non riconosciuta anziché un alias, quindi uno script che la contiene si interromperà.

### La verifica sintattica prima del caricamento

I file di un'app statica vengono serviti esattamente come sono. Quando la fase di `build` si limita a copiare script scritti a mano in `output`, nessun parser li ha controllati, rischiando che un file contenente un errore di battitura finisca in produzione impedendo il caricamento della pagina. Pertanto, prima di caricare qualsiasi elemento, `deploy` analizza ogni file `.js`, `.mjs` e `.cjs` nell'`output` di ciascuna app statica, insieme a ogni `<script>` inline nei suoi file `.html`. Questo include sia le app statiche distribuite singolarmente, sia quelle incorporate nel bundle del backend. Un errore di sintassi interrompe il deploy indicando file, riga e colonna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json`, il `code` dell'errore è `syntax_error`. Gli script inline che un browser non esegue come JavaScript vengono ignorati: JSON, import map, template e qualsiasi altro `type` non JavaScript, i tag `<script src>` e gli script che contengono ancora markup di template non renderizzato come `{{ }}`. Un file `.js` supera il controllo se viene analizzato correttamente sia come script classico che come modulo, poiché è la pagina a determinarlo. Non viene letto nulla all'interno di `node_modules`, né all'interno di una cartella precompilata con `--bundle-dir`. `--no-verify` ignora la verifica per un singolo deploy.

Monitora l'avanzamento:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` riporta `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la piattaforma sta lavorando regolarmente ed eseguire il polling è la procedura corretta; quando indica un valore, significa che quel componente è in attesa di una tua azione.

Uno di questi è `email_not_configured`: l'app ha attivato l'accesso tramite magic link o codice email (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) ma non dispone di un servizio email configurato, quindi il deployment è live ma nessuno può accedere. Rebase Cloud non invia email per conto della tua applicazione: imposta `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` con `rebase cloud env set`, quindi esegui il deploy. `status` rileva questa condizione dal `GET /api/auth/config` dell'app stessa (nel campo `unavailable`) e `deploy` segnala lo stesso messaggio durante il controllo di disponibilità.

## Storage dei file

Un nuovo progetto non ha un bucket: i caricamenti vengono rifiutati con `501 STORAGE_NOT_CONFIGURED`,
e il riepilogo del deploy lo dice, invece di essere scritti su un disco che ogni deploy sostituisce.

Dagliene uno dei due tipi, poi esegui di nuovo il deploy perché l'app lo usi:

```bash
# Un bucket gestito da Rebase per te. La pagina Storage della console fa lo stesso.
rebase cloud storage create

# Oppure il tuo bucket compatibile con S3: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omettilo per AWS; aggiungi --force-path-style per MinIO

rebase cloud deploy
```

`rebase cloud storage` elenca i bucket del progetto. Un progetto con più bucket
li collega ciascuno con `--source <key>`; uno che configura lo storage nel codice non ha bisogno di nessuno dei due.

## Anteprima di una modifica

```bash
rebase cloud deploy --preview
```

Questo compila e carica esattamente ciò che farebbe `deploy`, ma lo serve a un indirizzo dedicato, come `https://shop--k3x9ab.rebase.website`. L'ambiente di produzione continua a servire la versione precedente. Al termine della compilazione, il deploy stampa l'indirizzo dell'anteprima.

Per mantenere lo stesso indirizzo tra più deploy, assegna un nome all'anteprima. Eseguendo nuovamente il deploy con lo stesso nome, l'anteprima verrà aggiornata:

```bash
rebase cloud deploy --preview-name new-checkout
```

Le risorse con cui un'anteprima comunica dipendono da ciò che è stato distribuito:

- **`rebase cloud deploy --preview`** genera l'anteprima del backend con le relative app statiche incorporate, esattamente come vengono eseguite in produzione. Riceve un proprio backend su un **database dedicato vuoto**, mai su quello di produzione. L'avvio sul database di produzione applicherebbe infatti lo schema e le regole di accesso dell'anteprima a quest'ultimo.
- **`rebase cloud deploy web --preview`** visualizzerebbe in anteprima una singola app statica autonoma, con le sue pagine che richiamano il backend di **produzione**. Questa funzionalità richiede un control plane in grado di servire siti statici in modo indipendente, cosa che Rebase Cloud non supporta ancora: l'operazione viene rifiutata con `PREVIEW_STATIC_UNSERVED` e non viene pubblicato nulla. Esegui invece l'anteprima del backend, che include e serve le app statiche incorporate; un progetto privo di backend gestito non può ancora essere visualizzato in anteprima.

Un'anteprima non carica codice sorgente e non registra app o hostname, poiché ognuna di queste azioni modificherebbe il progetto di produzione. `--source` ed `--eject` non possono essere combinati con `--preview`. Entrambi creano un'immagine container per la produzione.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` senza `--preview` si riferisce sempre alla produzione.

La pagina **Deployments** della console elenca le medesime anteprime e consente di aprire, visualizzare il log di compilazione o eliminare ciascuna di esse. La creazione rimane un passaggio da riga di comando (CLI).

Un'anteprima scade una settimana dopo l'ultimo deploy effettuato.

Al termine, il deploy verifica che l'indirizzo dell'anteprima risponda, esattamente come avviene per un deploy in produzione (`--live-timeout <seconds>`, `0` per saltare). Il rilascio del certificato per una nuova anteprima può richiedere un minuto o due, quindi un deploy completato con successo potrebbe indicare che l'indirizzo non risponde ancora.

Un'anteprima del backend viene fatturata come un'unità applicativa di dimensioni standard (100m di CPU e 384 MiB di memoria, alla tariffa della tua app per regione e capacità), ripartita in base alla sua durata effettiva, e compare nel preventivo mensile del progetto nella console. `rebase cloud deploy --preview` stampa lo stesso preventivo mensile (`cost` sotto `--json`). L'avvio di un'anteprima richiede una carta registrata, proprio come un deploy in produzione. Un primo deploy che fallisce prima che qualsiasi elemento venga eseguito viene rimosso anziché fatturato. Un progetto può eseguire fino a tre anteprime di backend contemporaneamente.

Ogni nuovo indirizzo di anteprima riceve un certificato TLS dedicato da Let's Encrypt, che concede a un dominio 50 nuovi certificati alla settimana, condivisi con tutti i siti di produzione su di esso. Le anteprime possono utilizzarne fino a 20 nell'arco di 7 giorni, sull'intera piattaforma. Oltre questa soglia, una nuova anteprima viene rifiutata (`429`, `preview_cert_budget`) indicando il momento in cui potrà essere distribuita; la ridistribuzione di un'anteprima già esistente non viene mai conteggiata.

Il database di un'anteprima di backend è un secondo database sull'istanza Postgres di **produzione**: dati isolati, ma stessa istanza e stesso disco. È limitato a 10 connessioni, per evitare che le anteprime esauriscano quelle di produzione, e a 2 GB: un'anteprima il cui database supera tale dimensione viene messa in pausa. Il relativo backend si arresta, il suo indirizzo smette di rispondere, `rebase cloud previews` e la console la mostrano come `paused` indicandone il motivo, e i proprietari e gli amministratori del progetto ricevono una notifica (`preview.paused`). I suoi dati vengono conservati fino alla scadenza. Esegui nuovamente il deploy per avviarla (verrà nuovamente messa in pausa se il database è ancora troppo grande) oppure eliminala. Un'anteprima in pausa continua a essere fatturata finché non viene eliminata o scade. Elimina le anteprime che non ti servono più. Le estensioni installate in produzione non vengono installate nel database di un'anteprima.

La funzionalità delle anteprime è in fase di implementazione progressiva. Un control plane che non le supporta ancora rifiuterà `--preview` con `previews_unavailable` senza distribuire nulla.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback reindirizza il progetto a quanto rilasciato da un precedente deployment riuscito, senza mai ricompilare: il valore di un rollback risiede nel distribuire un artefatto già testato ed eseguito.

Quali deployment siano idonei dipende da come viene distribuito il progetto, ed entrambe le modalità sono supportate:

| Modalità di deploy | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (compilazione dai sorgenti) | L'immagine pubblicata da quella compilazione |
| `rebase cloud deploy --bundle` (runtime della piattaforma) | Il bundle distribuito da quel deploy, sulla versione del runtime attualmente in uso dal progetto |

Le app statiche incorporate nel bundle del backend (un normale `rebase cloud deploy` su un progetto con un backend) fanno parte di quel bundle, quindi vengono ripristinate insieme ad esso.

Un'app statica distribuita singolarmente (`rebase cloud deploy <app>`) non può ancora essere ripristinata con un rollback. Il suo deployment registra quale app è stata pubblicata, ma nessun bundle, quindi il control plane non dispone di elementi da cui ripristinarla. La soluzione consiste nel ridistribuire l'ultima versione funzionante, ad esempio dal commit precedente a quello problematico. Dopo un tale deploy, `deploy` segnala questa circostanza anziché suggerire `rollback`, e `rollback` senza un ID rifiuta l'operazione anziché ridistribuire il backend attualmente attivo.

Pertanto, un rollback richiede un deployment che abbia registrato uno dei due elementi, il che implica un progetto distribuito con successo almeno due volte. `rebase cloud deployments` contrassegna quelli idonei e `--json` riporta `rollbackable` per ogni riga insieme all'`image` o al `bundle` che verrebbe ripristinato.

Due tipi di deployment vengono rifiutati, e la CLI ne specifica il motivo: uno che non è andato a buon fine e uno risalente a prima che la piattaforma iniziasse a registrare gli artefatti. In entrambi i casi non c'è spazio per supposizioni — tirare a indovinare porterebbe a distribuire qualsiasi elemento sia stato compilato o caricato più di recente pretendendo di ripristinare questo — quindi distribuisci direttamente la versione desiderata.

Ogni deploy riuscito termina indicando il comando di ripristino (`rebase cloud rollback`), rendendolo immediatamente visibile nel momento in cui ci si accorge di un rilascio errato.

Un rollback aggiunge un nuovo deployment anziché riavvolgere la cronologia, e attende che la versione ripristinata sia attiva prima di segnalare il successo. Puoi seguirne l'avanzamento con `rebase cloud logs -f`.

## Ripristinare il database a un momento specifico (Point-in-Time Recovery)

Un database gestito può essere ripristinato a qualsiasi minuto all'interno della relativa finestra di ripristino, dalla sezione **Database → Backups** della console o tramite CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
La procedura prevede due passaggi. Innanzitutto, viene predisposta (staged) una copia ripristinata accanto al database attivo; la tua app continua a funzionare su quello attivo e lo storage della copia viene fatturato finché non esegui il cutover o lo scarti.
Successivamente, una volta pronta la copia, il cutover reindirizza l'applicazione verso di essa e la riavvia. Tutto ciò che è stato scritto dopo l'orario di destinazione non sarà presente nella copia. Il database originale viene conservato come punto di ripristino e continua a fatturare lo storage; per ripristinarlo, rimuoverlo o eseguire un secondo restore è necessario contattare il supporto. Solo un owner o un admin può predisporre, eseguire il cutover o scartare la copia, e la console richiederà il nome del progetto prima di procedere al cutover.

## Proteggere il tuo account

Il tuo account della console può accedere ai database di produzione, ai secret e alla fatturazione, quindi proteggilo adeguatamente. Apri **Account security** dal menu sotto il tuo avatar nella console (oppure vai su `/account`). Questa pagina appartiene a te, non a un'organizzazione: le impostazioni configurate qui si applicano a tutte le organizzazioni a cui appartieni.

- **Verifica in due passaggi.** Attivala con qualsiasi app di autenticazione (1Password, Google Authenticator, Authy). La pagina mostra una chiave di configurazione da aggiungere all'app, oppure un link che apre l'app su smartphone con la chiave già inserita, richiedendo poi il codice a 6 cifre mostrato dall'app. Da quel momento in poi, ogni accesso richiederà un codice, sia che tu acceda tramite password, Google o GitHub.
- **Codici di recupero.** L'attivazione genera dieci codici monouso, mostrati una sola volta. Ciascuno di essi consente di accedere al posto del codice dell'autenticatore in caso di smarrimento dello smartphone; salvali quindi prima di chiudere la finestra di dialogo. **New recovery codes** li sostituisce invalidando i precedenti. Sia la disattivazione della verifica in due passaggi che la generazione di nuovi codici richiedono prima l'inserimento di un codice.
- **Password.** La sua modifica comporterà la disconnessione su tutti gli altri dispositivi. Un account creato tramite Google, GitHub o LinkedIn non possiede una password; la pagina consente di ricevere via email un link per impostarne una.
- **Dispositivi connessi.** Ogni browser e terminale connesso al tuo account, con il relativo indirizzo e data/ora di accesso. Puoi disconnettere qualsiasi dispositivo non riconosciuto o tutti contemporaneamente.

I [token di accesso](/docs/deployment/cloud-agents/#ci-and-agents) non sono sessioni e non richiedono un secondo fattore, quindi la CI continuerà a eseguire i deploy anche dopo l'attivazione. Puoi revocare un token non più ritenuto sicuro in **Settings → Access tokens**.

## Invitare il tuo team

**Members → Add member** aggiunge un utente che possiede già un account Rebase con indirizzo email verificato, con ruolo di admin o member; un owner potrà successivamente promuoverlo a owner. L'accesso è immediato e non viene inviata alcuna email. Rebase Cloud non invia ancora inviti via email, quindi chiedi ai colleghi sprovvisti di account di registrarsi e verificare il proprio indirizzo prima di procedere. Da terminale:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), che segnalerà se l'indirizzo specificato non è associato ad alcun account.

## Verificare chi ha fatto cosa

La pagina **Activity** della console e il comando `rebase cloud activity` mostrano a owner e admin dell'organizzazione chi ha effettuato un deploy, impostato o visualizzato una variabile d'ambiente (per nome, mai per valore), modificato un dominio, ripristinato un backup, ridimensionato, arrestato o eliminato un progetto, modificato il ruolo di un membro o creato un token, e quando ciò è avvenuto. La sezione **Settings** di un progetto rimanda alle proprie voci; le voci relative a un progetto eliminato vengono conservate. Uno script può leggerle tramite un token creato con permessi `--can audit` sull'organizzazione. Le registrazioni vengono conservate per un anno. I filtri disponibili sono descritti in
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agenti

Un job di CI o un agente non dovrebbero mai contenere la tua password. Assegna loro un token limitato a poche azioni su un singolo progetto, creato da un terminale autenticato con
`rebase cloud tokens create --project shop --can deploy,logs`, e impostalo come
`REBASE_TOKEN`. La fatturazione dell'organizzazione, il log delle attività e le impostazioni di notifica sono permessi specifici (`--can billing`, `audit`, `notifications`) che il token acquisisce solo se esplicitamente richiesto. L'elenco dei permessi, un flusso di lavoro di GitHub Actions e le prerogative esclusive di un utente autenticato sono trattati in
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend senza account

`rebase cloud init --claim` assegna a un'applicazione un backend attivo prima ancora che qualcuno si sia registrato e stampa un URL di riscatto (claim) per consentire all'utente di mantenerlo; un progetto che non viene riscattato entro 72 ore viene eliminato. Le operazioni consentite al token del progetto non riscattato, il `REBASE_API_TOKEN` generato e ciò che comporta il riscatto sono descritti in
[A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Risorse di calcolo e relativi costi

Il prezzo di un progetto dipende da ciò che riserva, non da un piano a scaglioni fisso. `compute` mostra ogni parametro di configurazione e il relativo preventivo dettagliato calcolato dal control plane. (`rebase cloud resources` è diverso: indica i database e i bucket dichiarati dal codice e se per ciascuno è stato effettuato il provisioning — vedi il [riferimento CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Risorse richieste dall'app per istanza, es. `500m` e `2Gi`. Vuoto indica il valore predefinito della piattaforma — `100m` e `384Mi`, con burst fino a 2 CPU e `2Gi` |
| `--replicas` | Istanze sempre attive: il limite minimo dell'autoscaler e la quota fissa addebitata mensilmente dall'abbonamento del progetto |
| `--autoscale-max` | 1–16. Il tetto massimo raggiungibile. Le istanze aggiunte dall'autoscaler oltre `--replicas` sono misurate al secondo-pod alle stesse tariffe e addebitate solo dove la piattaforma ha abilitato tale opzione; **Usage this month** ne specifica lo stato. `--no-autoscale` lo disattiva |
| `--autoscale-cpu-target` | 10–95. L'utilizzo della CPU che l'autoscaler mira a mantenere, calcolato rispetto alla richiesta (request) anziché al limite (limit). Vuoto indica 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica, ma soggetta a riavvii senza preavviso |
| `--db-instances` | 1–3. `1` indica un'istanza singola senza failover; `2` aggiunge uno standby automatico |
| `--db-cpu`, `--db-memory` | Per istanza di database. Vuoto indica `160m` e `1Gi` |

Un parametro vuoto non equivale a uno impostato sullo stesso valore: un parametro vuoto segue i valori predefiniti della piattaforma e si adegua automaticamente quando questi cambiano.

Nulla viene convalidato intenzionalmente dalla CLI — i limiti dipendono dal cluster su cui gira il progetto e variano a seconda del provider. Il control plane rifiuterà i valori non supportati indicando il campo interessato. Esegui `rebase cloud compute` per visualizzare il costo in €/mese prima e dopo; le modifiche hanno effetto immediato, ripartite proporzionalmente da oggi, tranne quelle che richiedono il riavvio del database, che attendono una finestra di manutenzione.

## Il resto delle funzionalità

| Gruppo di comandi | Cosa include |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | La tua sessione; `access-token` stampa il token bearer che la CLI invierebbe ora, utile per script e server MCP |
| `tokens` | Token per CI e agenti, ciascuno limitato a un singolo progetto. Vedi [CI and agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Collegamento di questa directory a un progetto, selezione di un'organizzazione, apertura della console |
| `connect` | Aggiunta di un server Rebase in self-hosting al tuo account, in modo che il [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude possa raggiungerlo accanto ai tuoi progetti Cloud. `--list` li mostra, `--remove` ne rimuove uno. Riservato a owner e admin |
| `init`, `claim` | Con `--claim`: un backend attivo senza account e un link per riscattarlo; `claim` stampa nuovamente tale link. Vedi [A backend with no account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Creazione, visualizzazione, ispezione ed eliminazione |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Distribuzione e monitoraggio |
| `deploy-hooks` | URL segreti richiamati da un host git o da una CI per distribuire il progetto: elenco, creazione (l'URL viene mostrato una sola volta), revoca. |
| `previews` | Build servite su un proprio indirizzo tramite `deploy --preview` e loro eliminazione. Vedi [Anteprima di una modifica](#anteprima-di-una-modifica) |
| `start`, `stop`, `restart` | Messa in pausa di un progetto e suo ripristino. Un progetto arrestato mantiene il proprio abbonamento, a meno che la piattaforma non fatturi per i progetti fermati solo lo storage e la quota di piattaforma; la riga **Billing** della console lo specifica quando applicabile |
| `status`, `metrics`, `debug` | Cosa sta facendo il sistema e perché eventualmente è bloccato |
| `alerts` | Incidenti aperti del progetto, con possibilità di prenderli in carico (acknowledge) o posticiparli (snooze). |
| `cron` | Cron job dell'app distribuita e relative esecuzioni registrate, consultabili tramite le credenziali di accesso a `rebase cloud`. In sola lettura |
| `env` | Variabili d'ambiente. `list` non stampa mai i valori; `--secret` è in sola scrittura |
| `app-key` | La chiave scritta da `init --claim` in `.env` come `REBASE_API_TOKEN`, trasferita al momento del riscatto; `rotate` la sostituisce revocando la precedente. Riservato a owner e admin |
| `service-key` | `REBASE_SERVICE_KEY`, con privilegi di admin sull'API dell'app: data dell'ultima rotazione; `rotate` assegna una nuova chiave all'app. Riservato a owner e admin |
| `domains` | Domini personalizzati, record DNS da configurare e verifica. Un progetto può rispondere su più domini, ciascuno verificato singolarmente; `verify` e `remove` richiedono il dominio su cui operare, che può essere omesso solo quando ce n'è uno solo (per `verify`, uno ancora in sospeso). Ciascun dominio verificato serve il progetto come host autonomo; `primary <domain>` sceglie quello canonico e `redirect <domain>` risponde su un altro con un reindirizzamento 308 verso di esso, mantenendo percorso e parametri di query (`--off` torna a servirlo direttamente) — operazione consigliata per `www.` accanto al dominio principale (apex), poiché l'accesso Google, i cookie e le passkey sono limitati all'origine (origin). Un dominio su cui viene servita un'app (un `path` di un'app con un hostname) non esegue mai reindirizzamenti. Un dominio apex (`example.com`, senza sottodominio) richiede un record **A**, poiché il DNS non ammette record CNAME alla radice. Tale indirizzo rappresenta l'ingress della piattaforma e non è garantito che rimanga invariato: in caso di migrazione della piattaforma, un record A continuerà a puntare al vecchio indirizzo. Se il tuo provider DNS supporta ALIAS, ANAME o CNAME flattening sull'apex, punta l'apex al `tenantHost` del progetto, che segue automaticamente la piattaforma. Il CNAME di un sottodominio la segue già normalmente. `list` mostra `verified, certificate pending` finché HTTPS non risponde con un certificato valido. `list --json` restituisce `{ projectId, tenantHost, domains: [...] }` |
| `db` | Connessione o creazione di un database, connessione ad esso dal proprio computer, backup, ripristino e point-in-time recovery |
| `guests` | Utenti guest generati dagli accessi anonimi: conteggio, eliminazione di singoli utenti, eliminazione massiva (prune) di quelli inattivi da tempo. Vedi [Guests](/docs/cli/cloud/#guests). Riservato a owner e admin |
| `extensions` | Allowlist delle estensioni Postgres |
| `storage` | Il bucket del progetto |
| `resources` | Quali database e bucket sono gestiti dalla piattaforma rispetto a quanto dichiarato dal codice |
| `compute` | Risorse riservate dal progetto, relativi costi e modalità di modifica |
| `events` | Eventi che hanno interessato il backend, dal più recente: scalabilità dell'app, modifiche pianificate e applicate al database, subentro di uno standby, espansione del disco |
| `usage` | Richieste utilizzate questo mese rispetto alla quota inclusa ed eccedenza maturata finora, come conteggiato in fattura. `usage org` elenca tutti i progetti dell'organizzazione |
| `clusters` | I cluster su cui vengono eseguiti i tenant. Riservato agli amministratori della piattaforma |
| `settings`, `orgs`, `billing` | Impostazioni del progetto, organizzazioni con relativi membri e inviti, pagamenti |
| `activity` | Audit log dell'organizzazione: chi ha eseguito un deploy, modificato una variabile d'ambiente (per nome), un dominio, un backup, un membro o un token. Riservato a owner e admin. Vedi [Verificare chi ha fatto cosa](#verificare-chi-ha-fatto-cosa) |
| `notifications` | Destinazioni a cui vengono inviati gli eventi del progetto tramite POST: Slack, Discord o qualsiasi URL HTTPS ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Ogni gruppo in quella tabella risponde a `--help` con una pagina dedicata — una riga di utilizzo (usage), i relativi flag ed esempi — e `--help` non esegue mai il comando. Un test tiene traccia dell'indice delle pagine, quindi un gruppo aggiunto senza di essa fa fallire la build anziché rispondere con il sommario. `verify:docs` vincola la tabella stessa a tale indice: ogni gruppo gestito dalla CLI compare qui esattamente una volta, quindi anche un gruppo aggiunto senza una corrispondente riga farebbe fallire la build.

Se reindirizzato tramite pipe, `--help` risponde invece in formato JSON: la stessa riga di utilizzo, flag ed esempi strutturati per la lettura anziché sessanta righe di sequenze di escape del terminale.

## Cosa non include la versione beta

Detto chiaramente, perché scoprirlo in seguito sarebbe peggio:

- **Nessuna scelta della regione.** Attualmente tutto viene eseguito in un'unica regione. Il modello di allocazione esiste nella piattaforma, ma un progetto non può selezionare una regione.
  `projects create --provider` e `--region` non costituiscono l'eccezione che potrebbero sembrare: registrano a quale dei target di deploy registrati del control plane appartiene un progetto, e poiché ce n'è solo uno, entrambi assumono quel valore predefinito e nessuno dei due sposta il progetto altrove. `rebase cloud projects create --help` riporta la stessa indicazione.
- **Non è self-service.** L'accesso viene concesso a scaglioni; non esiste una procedura immediata di registrazione e pagamento.
- **Nessun SLA pubblicato** e nessuna certificazione SOC 2. Se hai bisogno dell'uno o dell'altra, segnalalo al momento della richiesta di accesso anziché darlo per scontato.
- **Nessun branch deploy** e nessuna GitHub App proprietaria. I deploy hook — URL segreti a cui puntare un webhook del repository — rappresentano l'automazione supportata. I [deploy di anteprima](#anteprima-di-una-modifica) sono in fase di rilascio progressivo e vengono avviati dalla CLI.
- **I token agiscono per conto di una persona.** Un [token](/docs/deployment/cloud-agents/#ci-and-agents) viene generato da un account e agisce a suo nome; non esiste ancora un'identità macchina di proprietà dell'organizzazione. Se invece effettui l'accesso da CI, passa `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` da un gestore di segreti — `--password` inserisce la password nella cronologia della shell e nella tabella dei processi, segnalandolo prima di effettuare l'accesso. Se il file `.rebase/cloud.json` del repository specifica un control plane diverso da quello ufficiale della piattaforma, passalo anche tramite `--url`: in assenza di un terminale, `login` rifiuta di inviare una password a un host indicato unicamente dal file scaricato dal repository.
- **Nessun endpoint di database pubblico.** Un database gestito non è esposto a Internet, quindi l'host mostrato dalla console rappresenta il relativo indirizzo interno per il tuo backend e non è risolvibile sul tuo computer locale. `rebase cloud db connect` apre una porta locale collegata a quel database, tramite tunnel attraverso il control plane, per tutto il tempo in cui viene lasciato in esecuzione — ma non esiste un hostname permanente a cui un servizio di terze parti possa connettersi. Per eseguire istruzioni SQL senza un client Postgres locale,
  `rebase cloud db query "<sql>"` o `rebase cloud db query --file file.sql` apre lo stesso tunnel per una singola query, esegue il testo come un unico script (interrompendosi al primo errore) e stampa la risposta di ciascuna istruzione (`--json` per l'uso con script). Sia quel tunnel che la password mostrata da
  `rebase cloud db info --reveal` richiedono il ruolo di owner o admin dell'organizzazione: lo stesso richiesto dall'editor SQL di Studio, poiché in tutti e tre i casi si accede a una sessione sui dati di produzione.
- **Eseguire un deploy equivale a eseguire codice con i secret di produzione.** L'ambiente dell'applicazione contiene `REBASE_SERVICE_KEY` (admin sulla propria API),
  `DATABASE_URL` e `JWT_SECRET`, quindi il codice distribuito da un membro può leggerli,
  anche se solo owner e admin possono visualizzarli nella console. Invita
  con il ruolo di membro solo persone a cui affideresti tali valori.
- **La service key può essere sostituita.** Dalla sezione **Settings** del progetto
  (o con `rebase cloud service-key rotate`) è possibile generare una nuova `REBASE_SERVICE_KEY`
  e riavviare l'applicazione associandola ad essa. La vecchia chiave rimane valida fino al completamento del riavvio
  e non oltre, quindi qualsiasi client che l'abbia memorizzata verrà rifiutato da
  quel momento in poi. Il riscatto (claim) di un progetto esegue la stessa operazione.

## Self-hosting alternativo

Nulla di tutto questo comporta un lock-in. La [guida al self-hosting](/docs/deployment/self-hosting/)
consente di eseguire la medesima immagine e lo stesso bundle con `docker compose`, mentre la
[guida a Kubernetes](/docs/deployment/kubernetes/) riproduce la stessa topologia a partire dall'Helm chart.
