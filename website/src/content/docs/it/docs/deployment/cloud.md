---
sourceHash: 4b05c04581ef0b7d
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Cos'è, come collegare e distribuire un progetto e cosa non include ancora la beta privata.
---

Rebase Cloud esegue lo stesso Rebase open-source che ospiteresti in autonomia — la stessa immagine `rebasepro/server` pubblicata, lo stesso bundle, lo stesso Postgres. La differenza sta in chi lo gestisce.

:::note[Beta privata]
Rebase Cloud è in **beta privata**. Gestisce già tenant reali e apre l'accesso a scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi seguenti richiedono un account a cui sia stato concesso l'accesso. Tutto il resto su questo sito funziona senza di esso.
:::

## Cos'è

Un **progetto** Cloud è composto da tre elementi che la piattaforma gestisce per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine di runtime pubblicata. I deploy consistono nel caricamento di un bundle, non nella compilazione di un container |
| **Database** | Un PostgreSQL gestito, con backup automatizzati e point-in-time recovery |
| **Storage** | Un bucket dedicato, se il tuo progetto utilizza l'archiviazione di file |

Ciascuno viene sottoposto a provisioning al primo deploy e fatturato in base a ciò che riserva anziché per utente.

**Non cambia nulla del tuo progetto per essere eseguito lì.** Lo stesso repository può essere auto-ospitato con `docker compose`, e la via d'uscita è reale: `rebase build` produce un bundle che si avvia ovunque sia eseguibile l'immagine di runtime.

## Collegare un progetto

Dalla directory di un progetto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` apre la console nel browser e stampa un codice breve. Verifica che la console mostri lo stesso codice e approva l'accesso da lì: il terminale recupera la sessione e la scrive in `~/.rebase/credentials.json`. Se non hai effettuato l'accesso alla console, accedi prima da lì con il metodo che preferisci, inclusi Google e GitHub. Tramite SSH, `rebase cloud login --no-browser` stampa il link da aprire sulla tua macchina.

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono flag ed entrambi sono obbligatori — su un terminale vengono richiesti in modo interattivo, e un'esecuzione headless che omette uno dei due termina con `input_required` invece di inventarne uno. **Il sottodominio non è modificabile in seguito:** è l'host `<slug>.rebase.website` su cui risponde il progetto, quindi sceglilo con attenzione.

`--link` collega questa directory al progetto nella stessa chiamata, eliminando la necessità di un passaggio `link` separato. Scrive `.rebase/cloud.json`, che registra l'id e lo slug del progetto. Quel file non è un segreto e non contiene le tue credenziali — queste ultime risiedono in `~/.rebase/credentials.json`, scritte da `login`.

Tuttavia, viene sottoposto a commit insieme al codice, quindi un repository clonato può indicare qualsiasi control plane. Quando l'host proviene solo da quel file e non è né quello della piattaforma né uno a cui hai già effettuato l'accesso in precedenza, `login` ne specifica il nome e chiede conferma prima di inviarvi email e password. Senza terminale, o con `--json`, rifiuta l'operazione con `unknown_control_plane`; passa `--url <host>` (o imposta `REBASE_CLOUD_URL`) per effettuare l'accesso intenzionalmente lì.

Per accedere senza browser, passa la tua email: `rebase cloud login --email me@example.com` richiederà la tua password. **Ti sei registrato con Google, GitHub o LinkedIn?** Il tuo account non ha una password, quindi usa invece un codice:

```bash
rebase cloud login --code --email me@example.com
```

Il control plane ti invierà via email un codice a 6 cifre, valido per dieci minuti, che dovrai digitare al prompt. Con `--email` e senza password, `rebase cloud login` chiede se utilizzare la password o un codice. I codici richiedono che il control plane sia in grado di inviare email; in caso contrario, `--code` lo segnala ed esce con `otp_unavailable`.

Se hai attivato l'autenticazione a due fattori, `login` richiederà poi il codice dalla tua app di autenticazione o uno dei tuoi codici di ripristino, a prescindere da come hai effettuato l'accesso. Tramite browser, la console lo richiede al momento dell'accesso da lì. Né un codice di accesso né un secondo fattore possono essere digitati senza un terminale. Per uno script, crea un token di accesso nella console (**Settings → Access tokens**) e imposta `REBASE_TOKEN`; vedi [CI e agent](/docs/deployment/cloud-agents/#ci-and-agents).

Una password errata risponde con `invalid_credentials` offrendo le stesse due modalità di accesso, poiché la causa comune è un account che non ne ha mai avuta una.

`billing setup` collega una carta all'organizzazione, una sola volta. È posizionato per primo nella sequenza intenzionalmente: il primo deploy di un progetto viene rifiutato senza di essa, e scoprirlo dopo aver completato l'upload di un bundle è l'ordine peggiore.

Dopodiché, la pagina **Billing** della console elenca le fatture dell'organizzazione, ciascuna con la pagina ospitata e il PDF di Stripe, e mostra l'anteprima della fattura successiva per ogni progetto. `rebase cloud billing invoices` e `rebase cloud billing upcoming` stampano le stesse informazioni. Entrambi sono riservati a proprietari e amministratori dell'organizzazione. Dove la piattaforma lo prevede, **Manage billing** apre il portale clienti di Stripe per la carta, i dati di fatturazione e le fatture passate.

Con una carta già registrata, la creazione di un altro progetto nella console non richiede un secondo pagamento: il progetto viene fatturato su quella carta e distribuito. Se la carta viene rifiutata o la banca richiede la conferma del pagamento, la console ti reindirizza a **Billing**, dove **Fix your card** consente di salvare un'altra carta e **Complete the payment** apre la fattura di Stripe.

L'utilizzo di un progetto è visibile nella relativa panoramica, sotto **Usage this month**, e per tutti i progetti contemporaneamente nella pagina **Billing**: richieste rispetto alla quota inclusa (la barra diventa arancione all'80%), errori 5xx, l'eccedenza maturata finora e la proiezione per fine mese a questo ritmo. L'eccedenza è calcolata dallo stesso codice che la segnala a Stripe, quindi corrisponde a quanto sarà presente in fattura; appare nella fattura del mese successivo. `rebase cloud usage` stampa gli stessi dati, e `rebase cloud usage org` quelli dell'intera organizzazione. Qualsiasi membro può visualizzarli. Le cifre indicano ciò che non possono ancora vedere: l'object storage non viene misurato, quindi non viene fatturata alcuna eccedenza di archiviazione; finché un progetto esegue due o più pod dell'app, le sue richieste non vengono conteggiate; e una giornata con campioni mancanti sottostima i valori. Un progetto con autoscaling mostra anche i pod eseguiti oltre `--replicas`, in ore-pod, il loro costo in base alle proprie tariffe e se questa piattaforma li addebita già. Un progetto riscattato da un agent conteggia solo i giorni a partire dal riscatto: prima di allora, il progetto apparteneva alla piattaforma.

Un progetto esistente si collega senza crearne uno nuovo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Un solo comando, e nessun flag da ricordare. Il file `rebase.json` di uno scaffold dichiara `runtime: "managed"` per il proprio backend, e `deploy` legge tale dichiarazione — notificandolo durante il processo (`rebase.json declares runtime: managed — deploying a bundle`), compila l'app in `dist-bundle`, carica il bundle, lo esegue sull'immagine di runtime pubblicata e segue il deployment fino allo stato finale. Il codice di uscita rappresenta il verdetto, quindi la stessa riga funziona in modalità non presidiata nella CI.

Termina indicando dove risponde ciascuna app e se la nuova versione è attiva (live) su tali indirizzi:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa che l'indirizzo ha risposto dopo la build: l'endpoint `/health` del backend ha restituito `ok` e la pagina dell'app statica si è caricata (da questo deployment, quando la piattaforma la serve). Il controllo attende fino a `--live-timeout` secondi, 60 per impostazione predefinita; `0` lo ignora. Se un'app non risponde in tempo, il deploy termina comunque con codice zero poiché il deployment è riuscito, e l'ultima riga indica quale app non ha risposto e perché. Un deploy fallito termina invece su una sola riga, indicando l'app e il motivo, rimandando a `rebase cloud logs` per il registro di build completo.

Gli script possono passare `--json` per ottenere un singolo oggetto contenente le stesse informazioni — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e l'id del deployment. A differenza del resto di `rebase cloud`, `deploy` non passa automaticamente a JSON quando viene inviato tramite pipe.

Ciò che tale runtime consente — pacchetti e moduli nativi, memoria e istanze, timeout e dimensioni del payload, filesystem, segreti, storage e rete in uscita — è descritto nella relativa pagina:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Per distribuire un artefatto compilato in precedenza — ad esempio, un job di CI che compila una volta ed esegue il deploy due volte — punta alla directory anziché ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

L'uscita dal runtime gestito richiede un flag apposito, `--eject`, e nient'altro lo richiederà: una build che sposterebbe un progetto gestito su un'immagine container di cui diventa proprietario viene rifiutata finché non lo specifichi. In passato `--force` aveva questo significato, associando l'operazione meno reversibile della CLI alla stessa parola usata per "sovrascrivi questo file"; ora è un'opzione sconosciuta anziché un alias, quindi uno script che la contiene si interromperà.

### Il controllo sintattico prima del caricamento

I file di un'app statica vengono serviti esattamente come sono. Quando il relativo comando `build` si limita a copiare script scritti a mano in `output`, nulla ne ha eseguito il parsing, e un file con un refuso finisce in produzione impedendo il caricamento della pagina. Quindi, prima che venga caricato qualsiasi elemento, `deploy` analizza sintatticamente ogni file `.js`, `.mjs` e `.cjs` nell'`output` di ciascuna app statica, insieme a ogni `<script>` inline nei suoi file `.html`. Questo copre sia un'app statica distribuita singolarmente sia le app statiche incorporate nel bundle del backend. Un errore di sintassi blocca il deploy indicando file, riga e colonna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json` il `code` dell'errore è `syntax_error`. Gli script inline che un browser non esegue come JavaScript vengono ignorati: JSON, import map, template e qualsiasi altro `type` non JavaScript, i tag `<script src>` e gli script che contengono ancora markup di template non renderizzato come `{{ }}`. Un file `.js` supera il controllo se viene analizzato come script classico o come modulo, poiché è la pagina a deciderlo. Non viene letto nulla all'interno di `node_modules`, né una `--bundle-dir` precompilata. `--no-verify` ignora il controllo per un singolo deploy.

Monitora il deployment:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` segnala `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la piattaforma sta effettivamente lavorando e il polling è l'azione corretta da compiere; quando indica qualcosa, quel qualcosa è in attesa di una tua azione.

## Anteprima di una modifica

```bash
rebase cloud deploy --preview
```

Questo compila e carica esattamente ciò che farebbe `deploy`, ma lo serve a un indirizzo dedicato, come `https://shop--k3x9ab.rebase.website`. L'ambiente di produzione continua a servire ciò che serviva prima. Il deploy stampa l'indirizzo dell'anteprima al termine della build.

Per mantenere lo stesso indirizzo attraverso più deploy, assegna un nome all'anteprima. Eseguendo nuovamente il deploy con lo stesso nome, l'anteprima verrà aggiornata:

```bash
rebase cloud deploy --preview-name new-checkout
```

Ciò con cui comunica un'anteprima dipende da cosa hai distribuito:

- **`rebase cloud deploy --preview`** crea un'anteprima del backend, con le relative app statiche incorporate, nello stesso modo in cui vengono eseguite in produzione. Riceve un backend dedicato su un **database vuoto dedicato**, mai quello di produzione. L'avvio sul database di produzione applicherebbe ad esso lo schema e le regole di accesso dell'anteprima.
- **`rebase cloud deploy web --preview`** mostrerebbe l'anteprima di una singola app statica autonoma, con le sue pagine che richiamano il backend di **produzione**. Ciò richiede un control plane che serva siti statici in modo autonomo, cosa che Rebase Cloud non fa ancora: rifiuta l'operazione con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Esegui invece l'anteprima del backend, che serve le app statiche incorporate in esso; un progetto privo di backend gestito non può ancora essere visualizzato in anteprima.

Un'anteprima non carica codice sorgente e non registra app o hostname, poiché ciascuna di queste azioni modificherebbe il progetto di produzione. `--source` ed `--eject` non possono essere combinati con `--preview`. Entrambi compilano un'immagine container per la produzione.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` senza `--preview` fa sempre riferimento alla produzione.

La pagina **Deployments** della console elenca le stesse anteprime e consente di aprire, visualizzare il log di build o eliminare ciascuna di esse. La creazione rimane un passaggio da riga di comando (CLI).

Un'anteprima scade una settimana dopo l'ultimo deploy effettuato su di essa.

Al termine, il deploy verifica che l'indirizzo dell'anteprima risponda, esattamente come avviene per un deploy di produzione (`--live-timeout <secondi>`, `0` per ignorare). Il certificato di una nuova anteprima può richiedere uno o due minuti, quindi un deploy riuscito potrebbe segnalare che l'indirizzo non risponde ancora.

L'anteprima di un backend viene fatturata come un'unità di app alla dimensione predefinita (100m di CPU e 384 MiB di memoria, alla tariffa della tua app per la relativa regione e capacità), proporzionata alla sua durata, e compare nel preventivo mensile del progetto nella console. `rebase cloud deploy --preview` stampa lo stesso preventivo mensile (`cost` sotto `--json`). L'avvio di un'anteprima richiede una carta registrata, come per un deploy in produzione. Un primo deploy che fallisce prima che qualsiasi cosa venga eseguita viene rimosso anziché fatturato. Un progetto può eseguire fino a tre anteprime backend contemporaneamente.

Ogni nuovo indirizzo di anteprima riceve un proprio certificato TLS da Let's Encrypt, che consente a un dominio 50 nuovi certificati a settimana, condivisi con ogni sito di produzione su di esso. Le anteprime possono utilizzarne fino a 20 nell'arco di 7 giorni, su tutta la piattaforma. Oltre questo limite, una nuova anteprima viene rifiutata (`429`, `preview_cert_budget`) indicando quando potrà essere distribuita; la ridistribuzione di un'anteprima già esistente non viene mai conteggiata.

Il database dell'anteprima di un backend è un secondo database sull'istanza Postgres di **produzione**: dati dedicati, ma sulla stessa istanza e sullo stesso disco. È limitato a 10 connessioni, in modo che le anteprime non esauriscano quelle della produzione, e a 2 GB: un'anteprima il cui database supera tale dimensione viene messa in pausa. Il suo backend si arresta, il suo indirizzo smette di rispondere, `rebase cloud previews` e la console lo mostrano come `paused` indicandone il motivo, e i proprietari e gli amministratori del progetto ricevono una notifica (`preview.paused`). I relativi dati vengono conservati fino alla scadenza. Esegui nuovamente il deploy per avviarla (verrà messa nuovamente in pausa se il database è ancora troppo grande) oppure eliminala. Un'anteprima in pausa continua a essere fatturata finché non viene eliminata o scade. Elimina le anteprime di cui non hai più bisogno. Le estensioni installate in produzione non vengono installate nel database di un'anteprima.

Le anteprime sono in fase di roll-out graduale. Un control plane che non le supporta ancora rifiuta `--preview` con `previews_unavailable` e non distribuisce nulla.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback reindirizza il progetto a ciò che un precedente deployment riuscito ha distribuito, senza mai ricompilare — il vantaggio di un rollback è che distribuisce un artefatto già testato ed eseguito.

Quali deployment siano idonei dipende da come è stato distribuito il progetto, ed entrambe le modalità sono supportate:

| Modalità di deploy | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (build dai sorgenti) | L'immagine pubblicata da quella build |
| `rebase cloud deploy --bundle` (runtime della piattaforma) | Il bundle distribuito da quel deploy, sulla versione del runtime attualmente in esecuzione per il progetto |

Le app statiche incorporate nel bundle del backend (un semplice `rebase cloud deploy` su un progetto con backend) fanno parte di quel bundle, quindi vengono ripristinate insieme ad esso.

Un'app statica distribuita singolarmente (`rebase cloud deploy <app>`) non può ancora essere ripristinata tramite rollback. Il suo deployment registra quale app ha pubblicato, ma nessun bundle, quindi il control plane non ha nulla da cui ripristinarla. La soluzione consiste nel ridistribuire l'ultima versione funzionante, ad esempio dal commit precedente a quello difettoso. Dopo tale deploy, `deploy` segnala questa condizione invece di suggerire `rollback`, e un `rollback` senza id viene rifiutato invece di ridistribuire il backend attualmente attivo.

Pertanto, un rollback richiede un deployment che abbia registrato uno dei due elementi, il che implica che il progetto deve essere stato distribuito con successo almeno due volte. `rebase cloud deployments` contrassegna quelli idonei e `--json` riporta `rollbackable` per ogni riga insieme all'`image` o al `bundle` che verrebbe ripristinato.

Due tipi di deployment vengono rifiutati, e la CLI specifica quale: uno che non è andato a buon fine e uno risalente a prima che la piattaforma registrasse il proprio artefatto. Non c'è nulla da tirare a indovinare in entrambi i casi — tirare a indovinare comporterebbe la distribuzione di ciò che è stato compilato o caricato più di recente fingendo di ripristinare questo — quindi distribuisci invece manualmente la versione desiderata.

Ogni deploy riuscito termina indicando la procedura di ripristino (`rebase cloud rollback`), in modo che sia subito visibile nel momento in cui si nota una release problematica.

Un rollback aggiunge un nuovo deployment anziché riscrivere la cronologia, e attende che la versione ripristinata sia attiva prima di segnalare l'esito positivo. Seguilo con `rebase cloud logs -f`.

## Ripristinare il database a un momento specifico (Point-in-Time Recovery)

Un database gestito può essere recuperato a qualsiasi minuto all'interno della sua finestra di ripristino, da **Database → Backups** nella console o tramite la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
L'operazione richiede due passaggi. Innanzitutto, viene predisposta una copia recuperata accanto al database attivo; la tua app continua a funzionare su quello attivo e lo spazio di archiviazione della copia viene fatturato finché non esegui il cutover o la elimini.
Poi, una volta pronta la copia, il cutover reindirizza l'app verso di essa e la riavvia. Tutto ciò che è stato scritto dopo l'orario di riferimento non è presente nella copia. Il database originale viene conservato come via di riserva e continua a fatturare lo spazio di archiviazione; il ritorno al database precedente, la sua rimozione o un secondo ripristino richiedono l'intervento del supporto. Solo un proprietario o un amministratore può predisporre la copia, eseguire il cutover o scartarla, e la console richiede il nome del progetto prima di procedere al cutover.

## Proteggere il proprio account

Il tuo account della console può accedere ai database di produzione, ai segreti e alla fatturazione, quindi proteggilo adeguatamente. Apri **Account security** dal menu sotto il tuo avatar nella console (o vai su `/account`). La pagina è personale, non appartiene a un'organizzazione: ciò che imposti qui si applica a tutte le organizzazioni a cui appartieni.

- **Verifica in due passaggi.** Attivala con qualsiasi app di autenticazione (1Password, Google Authenticator, Authy). La pagina mostra una chiave di configurazione da aggiungere all'app, o un link che apre l'app su smartphone con la chiave già inserita, quindi richiede il codice a 6 cifre mostrato dall'app. Da quel momento in poi, ogni accesso richiederà un codice, sia che tu acceda con password, Google o GitHub.
- **Codici di ripristino.** L'attivazione ti fornisce dieci codici monouso, mostrati una sola volta. Ciascuno di essi ti permette di accedere al posto del codice di autenticazione in caso di smarrimento del telefono, quindi salvali prima di chiudere la finestra di dialogo. **New recovery codes** li sostituisce rendendo non più validi i precedenti. Sia la disattivazione della verifica in due passaggi sia la generazione di nuovi codici richiedono prima l'inserimento di un codice.
- **Password.** Modificarla comporterà la disconnessione da tutti gli altri dispositivi. Un account creato con Google, GitHub o LinkedIn non possiede una password; la pagina consente di ricevere via email un link per impostarne una.
- **Dispositivi connessi.** Ogni browser e terminale connesso al tuo account, con il relativo indirizzo e l'orario di accesso. Disconnetti i dispositivi che non riconosci, oppure tutti contemporaneamente.

I [token di accesso](/docs/deployment/cloud-agents/#ci-and-agents) non sono sessioni e non richiedono un secondo fattore, quindi la CI continuerà a eseguire il deploy dopo l'attivazione. Revoca i token di cui non ti fidi più in **Settings → Access tokens**.

## Invitare il team

**Members → Invite member** genera un link da copiare (inviato via email se il control plane è configurato per inviare email) valido per un solo utilizzo entro 7 giorni, per un account che abbia verificato tale indirizzo; nessuno entrerà finché non accetterà l'invito. Invita un amministratore o un membro, e promuovilo a proprietario (owner) una volta entrato. Proprietari e amministratori possono visualizzare, reinviare o revocare l'invito in **Pending invitations**; da terminale, [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Vedere chi ha fatto cosa

La pagina **Activity** della console e il comando `rebase cloud activity` mostrano ai proprietari e agli amministratori dell'organizzazione chi ha eseguito il deploy, impostato o visualizzato una variabile d'ambiente (per nome, mai per valore), modificato un dominio, ripristinato un backup, ridimensionato, arrestato o eliminato un progetto, cambiato il ruolo di un membro o creato un token, con la relativa data e ora. La sezione **Settings** di un progetto rimanda alle proprie voci; le voci relative a un progetto eliminato rimangono. Uno script può leggerle tramite un token creato con `--can audit` sull'organizzazione. Le registrazioni vengono conservate per un anno. I filtri sono descritti in [`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agent

Un job di CI o un agent non dovrebbero mai contenere la tua password. Assegna loro un token limitato a poche azioni su un singolo progetto, creato da un terminale autenticato con `rebase cloud tokens create --project shop --can deploy,logs`, e impostalo come `REBASE_TOKEN`. La fatturazione, il log delle attività e le impostazioni di notifica dell'organizzazione sono funzionalità a sé stanti (`--can billing`, `audit`, `notifications`) che un token possiede solo se esplicitamente richieste. Le autorizzazioni, un flusso di lavoro GitHub Actions e ciò che rimane associato a una persona autenticata sono descritti in [CI e agent](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend senza account

`rebase cloud init --claim` assegna a un'app un backend attivo prima ancora che qualcuno si sia registrato, stampando un URL di riscatto (claim URL) affinché l'utente possa mantenerlo; un progetto che nessuno riscatta entro 72 ore viene eliminato. Ciò che il token del progetto non riscattato può fare, la chiave `REBASE_API_TOKEN` che scrive e cosa comporta il riscatto sono illustrati in [Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Risorse di calcolo e relativi costi

Il prezzo di un progetto si basa sulle risorse che riserva, non su un piano fisso a livelli (tier). `compute` stampa ogni parametro e il preventivo dettagliato fornito dal control plane. (`rebase cloud resources` è una cosa diversa: riguarda i database e i bucket dichiarati dal codice e se ciascuno è stato sottoposto a provisioning — consulta la [documentazione di riferimento della CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Richiesta dell'app per istanza, ad es. `500m` e `2Gi`. Vuoto indica il valore predefinito della piattaforma — `100m` e `384Mi`, con burst fino a 2 CPU e `2Gi` |
| `--replicas` | Istanze sempre attive: la soglia minima dell'autoscaler e ciò che l'abbonamento del progetto fattura mensilmente |
| `--autoscale-max` | 1–16. Il limite massimo raggiungibile. Le istanze aggiunte dall'autoscaler oltre `--replicas` vengono conteggiate per pod-secondo alle stesse tariffe e addebitate solo dove la piattaforma ha abilitato tale opzione; **Usage this month** indica lo stato. `--no-autoscale` lo disattiva |
| `--autoscale-cpu-target` | 10–95. L'utilizzo di CPU mantenuto dall'autoscaler, calcolato rispetto alla richiesta anziché al limite. Vuoto indica 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica e riavviata senza preavviso |
| `--db-instances` | 1–3. `1` indica un'istanza singola senza failover; `2` aggiunge uno standby automatico |
| `--db-cpu`, `--db-memory` | Per istanza di database. Vuoto indica `160m` e `1Gi` |

Un parametro vuoto non equivale a uno impostato sullo stesso valore numerico: un parametro vuoto segue il valore predefinito della piattaforma e si aggiorna quando questo cambia.

Nessun valore viene convalidato dalla CLI, intenzionalmente — i limiti dipendono dal cluster su cui viene eseguito il progetto e variano a seconda dei provider. Il control plane rifiuta i valori che non può soddisfare indicando il campo interessato. Esegui `rebase cloud compute` per visualizzare i €/mese prima e dopo; le modifiche vengono applicate immediatamente, ripartite proporzionalmente da oggi, eccetto quelle che comportano il riavvio del database, le quali attendono una finestra di manutenzione.

## Panoramica dei comandi rimanenti

| Gruppo di comandi | Cosa copre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | La tua sessione; `access-token` stampa il token bearer che la CLI invierebbe adesso, per script e per il server MCP |
| `tokens` | Token per CI e agent, ciascuno limitato a un singolo progetto. Vedi [CI e agent](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Collegamento di questa directory a un progetto, selezione di un'organizzazione, apertura della console |
| `connect` | Aggiunta di un server Rebase self-hosted al tuo account, in modo che il [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude possa raggiungerlo accanto ai tuoi progetti Cloud. `--list` li mostra, `--remove` ne rimuove uno. Solo proprietari e amministratori |
| `init`, `claim` | Con `--claim`: un backend attivo senza account e un link per riscattarlo; `claim` stampa nuovamente tale link. Vedi [Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Creazione, elenco, ispezione ed eliminazione |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Rilascio e monitoraggio |
| `deploy-hooks` | URL segreti richiamati da un host Git o dalla CI per distribuire il progetto: elenco, creazione (l'URL viene mostrato una sola volta) e revoca. |
| `previews` | Build servite su un proprio indirizzo da `deploy --preview` e loro eliminazione. Vedi [Anteprima di una modifica](#anteprima-di-una-modifica) |
| `start`, `stop`, `restart` | Messa in pausa di un progetto e suo ripristino. Un progetto arrestato mantiene la propria sottoscrizione, a meno che la piattaforma non fatturi per i progetti arrestati solo lo storage e la quota della piattaforma; la riga **Billing** della console lo specifica quando applicabile |
| `status`, `metrics`, `debug` | Cosa sta facendo e perché non funziona |
| `alerts` | Gli incidenti aperti del progetto, con possibilità di prenderne visione (acknowledge) o posticiparli (snooze). |
| `cron` | I cron job dell'app distribuita e le relative esecuzioni registrate, consultabili con il tuo login a `rebase cloud`. In sola lettura |
| `env` | Variabili d'ambiente. `list` non stampa mai i valori; `--secret` è di sola scrittura |
| `app-key` | La chiave scritta da `init --claim` in `.env` come `REBASE_API_TOKEN`, trasferita al momento del riscatto; `rotate` la sostituisce e revoca quella precedente. Solo proprietari e amministratori |
| `service-key` | `REBASE_SERVICE_KEY`, con privilegi di amministratore sull'API dell'app: data dell'ultima rotazione; `rotate` ne assegna una nuova all'app. Solo proprietari e amministratori |
| `domains` | Domini personalizzati, record DNS da aggiungere e verifica. Un progetto può rispondere su più domini, ciascuno verificato singolarmente; `verify` e `remove` richiedono il dominio su cui operare, che può essere omesso solo quando ce n'è uno solo (per `verify`, uno ancora in sospeso). Ogni dominio verificato serve il progetto come se stesso; `primary <domain>` seleziona quello canonico e `redirect <domain>` risponde su un altro con un reindirizzamento 308 verso di esso, mantenendo path e query (`--off` torna a servirlo direttamente) — utile per `www.` accanto a un dominio apex, poiché l'accesso con Google, i cookie e le passkey sono vincolati all'origine (per origin). Un dominio su cui è servita un'app (un `path` di un'app con un hostname) non reindirizza mai. `list --json` restituisce `{ projectId, tenantHost, domains: [...] }` |
| `db` | Collegamento o creazione di un database, connessione dalla propria macchina locale, backup, ripristino e point-in-time recovery |
| `guests` | Gli utenti guest lasciati dall'accesso anonimo: conteggio, eliminazione di un singolo utente o pulizia (prune) di quelli non visualizzati da molto tempo. Vedi [Guests](/docs/cli/cloud/#guests). Solo proprietari e amministratori |
| `extensions` | L'allowlist delle estensioni Postgres |
| `storage` | Il bucket del progetto |
| `resources` | Quali database e bucket sono gestiti dalla piattaforma rispetto a quanto dichiarato dal codice |
| `compute` | Cosa riserva questo progetto, quanto costa e come modificarlo |
| `events` | Cosa è successo al backend, dal più recente: scalabilità dell'app, modifiche al database pianificate e applicate, subentro di uno standby, aumento delle dimensioni del disco |
| `usage` | Richieste utilizzate questo mese rispetto alla quota inclusa e l'eccedenza maturata finora, così come conteggiata in fattura. `usage org` elenca tutti i progetti dell'organizzazione |
| `clusters` | I cluster su cui sono eseguiti i tenant. Solo per gli amministratori della piattaforma |
| `settings`, `orgs`, `billing` | Impostazioni del progetto, organizzazioni con relativi membri e inviti, pagamenti |
| `activity` | L'audit log dell'organizzazione: chi ha effettuato il deploy, modificato una variabile d'ambiente (per nome), un dominio, un backup, un membro o un token. Solo proprietari e amministratori. Vedi [Vedere chi ha fatto cosa](#vedere-chi-ha-fatto-cosa) |
| `notifications` | Dove vengono inviati tramite POST gli eventi del progetto: Slack, Discord o qualsiasi URL HTTPS ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Ogni gruppo in questa tabella risponde a `--help` con una propria pagina dedicata — una riga di sintassi, i relativi flag ed esempi — e `--help` non esegue mai il comando. Un test tiene traccia dell'indice delle pagine, quindi un gruppo aggiunto senza una pagina fa fallire la build anziché rispondere con il sommario. `verify:docs` vincola la tabella stessa a tale indice: ogni gruppo gestito dalla CLI compare qui esattamente una volta, quindi anche un gruppo aggiunto senza una riga nella tabella fa fallire la build.

Se reindirizzato tramite pipe, `--help` risponde invece in formato JSON: la stessa riga di utilizzo, flag ed esempi strutturati per la lettura anziché sessanta righe di sequenze di escape del terminale.

## Cosa non include la beta

Detto chiaramente, poiché scoprirlo in seguito è peggio:

- **Nessuna scelta della regione.** Attualmente tutto viene eseguito in un'unica regione. Il modello di posizionamento esiste nella piattaforma, ma un progetto non può selezionare una regione. `projects create --provider` e `--region` non rappresentano l'eccezione che sembrano: registrano a quale dei target di deploy registrati del control plane appartiene un progetto, e ce n'è uno solo, quindi entrambi assumono tale valore predefinito e nessuno dei due sposta il progetto altrove. `rebase cloud projects create --help` riporta la stessa indicazione.
- **Non è self-service.** L'accesso viene concesso a scaglioni; non è previsto un flusso diretto di registrazione e pagamento immediato.
- **Nessun SLA pubblicato** e nessuna certificazione SOC 2. Se hai bisogno di uno di questi requisiti, specificalo al momento della richiesta di accesso anziché darlo per scontato.
- **Nessun deploy per branch** e nessuna GitHub App proprietaria. I deploy hook — URL segreti verso cui puntare un webhook del repository — sono il meccanismo di automazione supportato. I [deploy di anteprima](#anteprima-di-una-modifica) sono in fase di rilascio e vengono avviati dalla CLI.
- **I token agiscono a nome di una persona.** Un [token](/docs/deployment/cloud-agents/#ci-and-agents) viene generato da un account e agisce per suo conto; non esiste ancora un'identità macchina di proprietà dell'organizzazione. Se invece effettui l'accesso dalla CI, passa `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` da un gestore di segreti — `--password` inserisce la password nella cronologia della shell e nella tabella dei processi, e lo notifica prima di completare l'accesso. Se il file `.rebase/cloud.json` del repository indica un control plane diverso da quello della piattaforma, passalo anche tramite `--url`: senza un terminale, `login` rifiuta di inviare una password a un host specificato unicamente dal file clonato.
- **Nessun endpoint di database pubblico.** Un database gestito non è esposto a Internet, quindi l'host mostrato dalla console è l'indirizzo utilizzato dal tuo backend e non risolve a nulla sulla tua macchina locale. `rebase cloud db connect` apre una porta locale collegata a quel database, tramite tunnel attraverso il control plane, per tutto il tempo in cui viene mantenuto in esecuzione — ma non esiste un hostname permanente a cui un servizio di terze parti possa connettersi. Quel tunnel e la password visibile tramite `rebase cloud db info --reveal` richiedono entrambi il ruolo di proprietario o amministratore dell'organizzazione: lo stesso richiesto dall'editor SQL di Studio, poiché tutti e tre consentono di operare direttamente sui dati di produzione.
- **Eseguire il deploy equivale a eseguire codice con i segreti di produzione.** L'ambiente dell'app contiene `REBASE_SERVICE_KEY` (amministratore sulla propria API), `DATABASE_URL` e `JWT_SECRET`, quindi il codice distribuito da un membro può leggerli, anche se solo proprietari e amministratori possono visualizzarli nella console. Invita come membro solo persone a cui affideresti tali valori.
- **La service key può essere sostituita.** La sezione **Settings** del progetto (o il comando `rebase cloud service-key rotate`) genera una nuova `REBASE_SERVICE_KEY` e riavvia l'app con essa. La vecchia chiave rimane valida fino al completamento del riavvio e mai oltre, quindi qualsiasi servizio o codice che l'abbia memorizzata verrà rifiutato da quel momento in poi. Anche il riscatto di un progetto esegue la stessa operazione.

## Alternativa: self-hosting

Niente di tutto questo comporta un lock-in. La [guida al self-hosting](/docs/deployment/self-hosting/) esegue l'identica immagine e bundle con `docker compose`, e la [guida a Kubernetes](/docs/deployment/kubernetes/) genera la stessa topologia tramite il chart Helm.
