---
sourceHash: 3f0338ecb589f00b
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Cos'è, come collegare ed eseguire il deploy di un progetto, e cosa la beta privata non include ancora.
---

Rebase Cloud esegue lo stesso Rebase open source che ospiteresti in self-hosting: la stessa
immagine pubblicata `rebasepro/server`, lo stesso bundle, lo stesso Postgres. La
differenza sta in chi lo gestisce.

:::note[Beta privata]
Rebase Cloud è in **beta privata**. Esegue tenant reali già oggi e apre l'accesso
a scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi seguenti richiedono un account già abilitato.
Tutto il resto su questo sito funziona senza di esso.
:::

## Cos'è

Un **progetto** Cloud è composto da tre elementi che la piattaforma gestisce per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine di runtime pubblicata. I deploy consistono nel caricamento di un bundle, non nella compilazione di un container |
| **Database** | Un PostgreSQL gestito, con backup automatizzati e point-in-time recovery |
| **Storage** | Un bucket dedicato, se il tuo progetto utilizza l'archiviazione di file |

Ciascuno viene eseguito tramite provisioning al primo deploy ed è fatturato in base a ciò che
riserva anziché per utente (seat).

**Non cambia nulla nel tuo progetto per farlo funzionare qui.** Lo stesso repository
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
flag, ed entrambi sono obbligatori: su un terminale vengono richiesti in modo interattivo, e
un'esecuzione headless che ometta uno dei due termina con `input_required` invece di inventarne
uno. **Il sottodominio non è modificabile in seguito:** è l'host
`<slug>.rebase.website` su cui risponde il progetto, quindi sceglilo con attenzione.

`--link` collega questa directory al progetto nella stessa chiamata, quindi non c'è
un passaggio `link` separato. Crea `.rebase/cloud.json`, che registra l'ID del progetto
e lo slug. Quel file non è un segreto e non contiene le tue credenziali: queste ultime risiedono
in `~/.rebase/credentials.json`, generato da `login`.

Tuttavia, viene sottoposto a commit insieme al codice, quindi un repository clonato può indicare qualsiasi
control plane. Quando l'host proviene solo da quel file e non corrisponde né a quello
della piattaforma né a uno a cui hai effettuato l'accesso in precedenza, `login` ne mostra il nome e chiede
conferma prima di inviarvi email e password. Senza un terminale, o con
`--json`, rifiuta l'operazione con `unknown_control_plane`; passa `--url <host>` (o imposta
`REBASE_CLOUD_URL`) per effettuare l'accesso lì intenzionalmente.

**Hai effettuato la registrazione con Google, GitHub o LinkedIn?** Il tuo account non ha una password, quindi
accedi invece con un codice:

```bash
rebase cloud login --code --email me@example.com
```

Il control plane ti invierà un codice a 6 cifre via email, valido per dieci minuti, da digitare
al prompt. Eseguito semplicemente da terminale, `rebase cloud login` chiede se
usare la password o un codice. I codici richiedono che il control plane sia in grado di inviare
email; in caso contrario, `--code` lo segnala e termina con `otp_unavailable`.

Se hai abilitato l'autenticazione a due fattori, `login` richiede quindi il codice dall'app
di autenticazione, o uno dei tuoi codici di recupero, indipendentemente dalla modalità di
accesso scelta. Né un codice di accesso né un secondo fattore possono essere digitati senza un terminale.
Per uno script, crea un token di accesso nella console (**Settings → Access
tokens**) e imposta `REBASE_TOKEN`; consulta [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

Una password errata risponde con `invalid_credentials` offrendo le stesse due modalità di accesso, poiché
la causa più comune è un account che non ne ha mai avuta una.

`billing setup` associa una carta all'organizzazione, una sola volta. È posizionato per primo
nella sequenza intenzionalmente: il primo deploy di un progetto viene rifiutato senza una carta, e
scoprirlo dopo il caricamento di un intero bundle è l'ordine peggiore.

Successivamente, la pagina **Billing** della console elenca le fatture dell'organizzazione,
ciascuna con la pagina ospitata di Stripe e il PDF, oltre a mostrare l'anteprima della prossima fattura di ogni
progetto. `rebase cloud billing invoices` e `rebase cloud billing upcoming`
mostrano le stesse informazioni. Entrambi sono riservati ai proprietari e agli amministratori dell'organizzazione. Dove
la piattaforma lo prevede, **Manage billing** apre il portale clienti di Stripe per la
carta, i dettagli di fatturazione e le fatture precedenti.

Con una carta già registrata, la creazione di un altro progetto nella console non richiede
un secondo pagamento: il progetto viene addebitato su quella carta e distribuito. Se la carta
viene rifiutata, o se la banca richiede la conferma del pagamento, la console ti reindirizza a
**Billing**, dove **Fix your card** permette di salvare un'altra carta e **Complete the
payment** apre la fattura di Stripe.

Il consumo di un progetto è visibile nella sua panoramica, sotto **Usage this month**, e
per tutti i progetti contemporaneamente nella pagina **Billing**: richieste rispetto alla
soglia inclusa (la barra diventa ambra all'80%), errori 5xx, l'eccedenza maturata finora
e la proiezione a fine mese con questo ritmo. L'eccedenza viene calcolata dallo
stesso codice che la comunica a Stripe, quindi corrisponde a ciò che comparirà in fattura;
viene addebitata nella fattura del mese successivo. `rebase cloud usage` mostra gli
stessi dati, e `rebase cloud usage org` quelli dell'intera organizzazione. Qualsiasi membro può visualizzarli.
I dati specificano ciò che non possono ancora rilevare: l'object storage non viene misurato,
quindi non viene fatturata alcuna eccedenza di storage; finché un progetto esegue due o più pod applicativi,
le sue richieste non vengono conteggiate; e una giornata con campionamenti mancati genera un sottoconteggio. Un
progetto con scalabilità automatica mostra anche i pod eseguiti oltre `--replicas`, in ore-pod,
il loro costo alle tariffe dedicate e se questa piattaforma li addebita già. Un
progetto riscattato da un agente conteggia solo i giorni a partire dal riscatto: prima
di esso, il progetto apparteneva alla piattaforma.

Un progetto esistente può essere collegato senza doverne creare uno nuovo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Un solo comando, e nessun flag da ricordare. Il file `rebase.json` di uno scaffold dichiara
`runtime: "managed"` per il proprio backend, e `deploy` legge questa dichiarazione: lo
indica durante l'esecuzione (`rebase.json declares runtime: managed — deploying a
bundle`), compila l'app in `dist-bundle`, carica il bundle, lo esegue sull'immagine
di runtime pubblicata e segue il deployment fino a uno stato terminale. Il codice di uscita
costituisce il verdetto, quindi la stessa riga funziona senza presidio in CI.

Termina indicando dove risponde ciascuna app e se la nuova versione è
attiva lì:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa che l'indirizzo ha risposto dopo la compilazione: l'endpoint `/health` di un backend ha
restituito `ok`, e la pagina di un'app statica si è caricata (da questo deployment, quando la
piattaforma la serve). Il controllo attende fino a `--live-timeout` secondi, 60 di
default; `0` lo salta. Se un'app non risponde in tempo, il deploy termina comunque con codice
zero, perché il deployment è riuscito, e l'ultima riga specifica quale app non ha
risposto e perché. Un deploy fallito termina invece su una sola riga, indicando l'app e il
motivo, rimandando a `rebase cloud logs` per il registro di compilazione completo.

Gli script possono passare `--json` per ricevere un singolo oggetto contenente gli stessi dati: `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` e l'ID del deployment. A differenza del resto di
`rebase cloud`, `deploy` non passa automaticamente a JSON quando viene reindirizzato in una pipe.

Ciò che questo runtime consente (pacchetti e moduli nativi, memoria e istanze,
timeout e dimensioni del body, filesystem, secret, storage e rete in
uscita) è documentato nella pagina dedicata:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Per distribuire un artefatto compilato in precedenza (ad esempio, un job CI che compila una volta ed
esegue il deploy due volte), punta alla directory invece di ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

L'uscita dal runtime gestito richiede un flag dedicato, `--eject`, e nient'altro lo
richiederà: una build che sposterebbe un progetto gestito su un'immagine container di cui diventa
proprietario viene rifiutata finché non lo specifichi esplicitamente. In passato si usava `--force`, ma questo
associava l'operazione meno reversibile della CLI alla stessa parola usata per "sovrascrivi questo
file"; ora è un'opzione sconosciuta anziché un alias, quindi uno script che la contiene
si interrompe.

### Il controllo di sintassi prima del caricamento

I file di un'app statica vengono serviti esattamente come sono. Quando il suo `build` si limita a
copiare script scritti a mano in `output`, nessuno strumento li ha analizzati, e un file
con un refuso andrebbe online impedendo il caricamento della pagina. Pertanto, prima che venga
caricato qualsiasi elemento, `deploy` analizza ogni file `.js`, `.mjs` e `.cjs` nell'`output` di ciascuna
app statica, insieme a ogni tag `<script>` inline nei suoi file `.html`. Questo
copre sia un'app statica distribuita da sola, sia le app statiche incorporate nel
bundle del backend. Un errore di sintassi interrompe il deploy indicando file, riga e colonna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json`, il `code` dell'errore è `syntax_error`. Gli script inline che un browser
non esegue come JavaScript vengono ignorati: JSON, import map, template e qualsiasi
altro `type` non JavaScript, un `<script src>`, e uno script che contiene ancora
markup di template non renderizzato come `{{ }}`. Un file `.js` supera il controllo se viene analizzato correttamente
come script classico o come modulo, poiché è la pagina a decidere. Nulla
sotto `node_modules` viene letto, e lo stesso vale per una directory precompilata `--bundle-dir`.
`--no-verify` salta il controllo per un singolo deploy.

Monitoraggio:

```bash
rebase cloud logs               # il log di compilazione
rebase cloud logs --runtime -f  # ciò che l'app in esecuzione stampa, in tempo reale, fino a Ctrl-C
rebase cloud status             # lo stato del progetto secondo la piattaforma
```

`status` riporta `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la
piattaforma sta lavorando regolarmente ed eseguire il polling è l'approccio corretto; quando indica
un valore, quell'elemento è in attesa di una tua azione.

## Anteprima di una modifica

```bash
rebase cloud deploy --preview
```

Questo comando compila e carica esattamente ciò che farebbe `deploy`, ma lo serve a un indirizzo
dedicato, come `https://shop--k3x9ab.rebase.website`. La produzione continua a
servire ciò che serviva prima. Il deploy stampa l'indirizzo dell'anteprima al termine
della compilazione.

Per mantenere un unico indirizzo tra più deploy, assegna un nome all'anteprima. Eseguire nuovamente il deploy
con lo stesso nome la aggiornerà:

```bash
rebase cloud deploy --preview-name new-checkout
```

I servizi con cui un'anteprima comunica dipendono da ciò che hai distribuito:

- **`rebase cloud deploy --preview`** crea un'anteprima del backend, con le relative app statiche
  incorporate, nello stesso modo in cui vengono eseguite in produzione. Riceve un backend dedicato su
  un **database vuoto e dedicato**, mai quello di produzione. L'avvio sul
  database di produzione applicherebbe ad esso lo schema e le regole di accesso dell'anteprima.
- **`rebase cloud deploy web --preview`** creerebbe un'anteprima di una singola app statica
  a sé stante, con le sue pagine che richiamano il backend di **produzione**. Questa operazione richiede un control plane
  in grado di servire siti statici autonomamente, cosa che Rebase Cloud non supporta ancora:
  rifiuta l'operazione con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Crea invece un'anteprima
  del backend, che serve le app statiche incorporate al suo interno; un progetto privo
  di un backend gestito non può ancora essere visualizzato in anteprima.

Un'anteprima non carica codice sorgente e non registra app o nomi host, perché ciascuna
di queste operazioni modificherebbe il progetto di produzione. `--source` ed `--eject` non possono essere
combinati con `--preview`. Entrambi creano un'immagine container per la produzione.

```bash
rebase cloud previews                      # nome, indirizzo, app, backend, scadenza
rebase cloud logs --preview new-checkout   # il relativo log di build; -f segue una build ancora in corso
rebase cloud logs --runtime --preview new-checkout -f  # ciò che il relativo backend stampa
rebase cloud previews delete new-checkout  # interrompe l'erogazione ed elimina il relativo database
```

`rebase cloud logs` senza `--preview` si riferisce sempre alla produzione.

La pagina **Deployments** della console elenca le stesse anteprime, consentendo di aprirne una, visualizzarne
il log di compilazione o eliminarla. La creazione rimane un passaggio da CLI.

Un'anteprima scade una settimana dopo l'ultimo deploy effettuato su di essa.

Al termine, il deploy verifica che l'indirizzo dell'anteprima risponda, esattamente come fa
un deploy di produzione (`--live-timeout <seconds>`, `0` per saltare). Il rilascio del certificato per una nuova
anteprima può richiedere uno o due minuti, quindi un deploy completato con successo potrebbe
segnalare che l'indirizzo non risponde ancora.

Un'anteprima del backend viene fatturata come un'unità applicativa con dimensioni predefinite (100m di CPU
e 384 MiB di memoria, alla tariffa della tua app per la sua regione e capacità),
ripartita proporzionalmente per tutta la sua durata, e compare nella stima
mensile del progetto nella console. `rebase cloud deploy --preview` stampa la stessa stima
per essa, su base mensile (`cost` sotto `--json`). L'avvio di un'anteprima richiede una carta registrata, come per
un deploy di produzione. Un primo deploy che
fallisce prima dell'avvio di qualsiasi componente viene rimosso anziché fatturato. Un progetto può eseguire
fino a tre anteprime di backend contemporaneamente.

Ogni nuovo indirizzo di anteprima riceve un certificato TLS dedicato da Let's Encrypt,
che consente 50 nuovi certificati a settimana per dominio, condivisi con ogni
sito di produzione su di esso. Le anteprime possono utilizzarne fino a 20 ogni 7 giorni, a livello di piattaforma. Oltre
questa soglia, una nuova anteprima viene rifiutata (`429`, `preview_cert_budget`) indicando quando potrà
essere distribuita; ridistribuire un'anteprima già esistente non viene mai conteggiato.

Il database di un'anteprima di backend è un secondo database sull'istanza Postgres di **produzione**:
dati separati, ma stessa istanza e stesso disco. È limitato a 10
connessioni, affinché le anteprime non esauriscano quelle di produzione, e a 2 GB: un'anteprima
il cui database superi tale limite viene messa in pausa. Il suo backend si arresta, il suo indirizzo smette di
rispondere, `rebase cloud previews` e la console la mostrano come `paused` con la relativa
motivazione, e i proprietari e gli amministratori del progetto ricevono una notifica (`preview.paused`). I suoi
dati vengono conservati fino alla scadenza. Esegui nuovamente il deploy per avviarla (verrà messa nuovamente in pausa
se il database è ancora troppo grande), oppure eliminala. Un'anteprima in pausa continua a essere
fatturata finché non viene eliminata o non scade. Elimina le anteprime non più necessarie. Le estensioni installate in produzione non vengono
installate nel database di un'anteprima.

Le anteprime sono in fase di rilascio graduale. Un control plane che non le supporta ancora rifiuta
`--preview` con `previews_unavailable` e non esegue alcun deploy.

## Eseguire il rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback reimposta il progetto su quanto distribuito da un precedente deployment riuscito,
senza mai ricompilare: il valore di un rollback risiede nel distribuire un
artefatto già precedentemente eseguito.

I deployment idonei dipendono dalla modalità di deploy del progetto, ed entrambe le
tipologie sono supportate:

| Come è stato distribuito | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (build da sorgente) | L'immagine pubblicata da quella build |
| `rebase cloud deploy --bundle` (runtime della piattaforma) | Il bundle distribuito da quel deploy, sulla versione del runtime attualmente in esecuzione nel progetto |

Le app statiche incorporate nel bundle del backend (un semplice `rebase cloud deploy` su un
progetto con backend) fanno parte di quel bundle, quindi vengono ripristinate insieme ad esso.

Un'app statica distribuita singolarmente (`rebase cloud deploy <app>`) non può ancora essere
ripristinata tramite rollback. Il suo deployment registra quale app è stata pubblicata, ma nessun bundle, quindi il
control plane non ha nulla da cui ripristinarla. La soluzione consiste nel distribuire nuovamente l'ultima versione
funzionante, ad esempio dal commit precedente a quello difettoso. Dopo un tale
deploy, `deploy` mostra questo avviso invece di suggerire `rollback`, e l'esecuzione di `rollback`
senza un ID rifiuta l'operazione anziché ridistribuire il backend in esecuzione.

Pertanto, un rollback richiede un deployment che abbia registrato uno dei due elementi, il che implica un
progetto distribuito con successo almeno due volte. `rebase cloud deployments`
contrassegna quelli idonei, e `--json` riporta `rollbackable` per ciascuna riga insieme
all'attributo `image` o `bundle` che verrebbe ripristinato.

Due tipi di deployment vengono rifiutati, e la CLI ne specifica il motivo: uno non riuscito,
e uno antecedente alla registrazione degli artefatti da parte della piattaforma. Non c'è nulla da ipotizzare
in entrambi i casi (ipotizzare significherebbe distribuire qualsiasi cosa sia stata compilata o caricata
più di recente sostenendo di ripristinare questa), quindi distribuisci invece direttamente la versione desiderata.

Ogni deploy riuscito termina indicando il comando di ripristino (`rebase cloud rollback`),
in modo che sia immediatamente visibile nel momento in cui si nota un rilascio problematico.

Un rollback aggiunge un nuovo deployment invece di riscrivere la cronologia, e attende che
la versione ripristinata sia operativa prima di segnalare il successo. Puoi seguirne l'avanzamento con
`rebase cloud logs -f`.

## Ripristinare il database a un momento specifico (PITR)

Un database gestito può essere ripristinato a qualsiasi minuto all'interno della sua finestra di retention,
da **Database → Backups** nella console o tramite la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
L'operazione richiede due passaggi. Innanzitutto, una copia ripristinata viene predisposta accanto al database attivo;
l'app continua a funzionare su quello attivo, e lo storage della copia viene fatturato fino
al cutover o all'eliminazione.
Successivamente, una volta pronta la copia, il cutover reindirizza l'app verso di essa e la riavvia.
Tutto ciò che è stato scritto dopo l'orario di destinazione non sarà presente nella copia. Il database originale
viene mantenuto come punto di ripristino e continua a fatturare lo storage; tornare indietro,
rimuoverlo o eseguire un secondo ripristino richiede il contatto con il supporto. Solo un proprietario o amministratore
può predisporre, eseguire il cutover o scartare la copia, e la console richiede il nome del progetto
prima di effettuare il cutover.

## Proteggere il proprio account

Il tuo account della console può accedere a database di produzione, secret e fatturazione,
quindi proteggilo adeguatamente. Apri **Account security** dal menu sotto il tuo avatar
nella console (o vai su `/account`). La pagina è personale, non legata a una
singola organizzazione: le impostazioni definite qui si applicano a tutte le organizzazioni a cui appartieni.

- **Verifica in due passaggi.** Attivala con qualsiasi app di autenticazione (1Password,
  Google Authenticator, Authy). La pagina mostra una chiave di configurazione da aggiungere all'app, o un
  link che apre l'app con la chiave già compilata su smartphone, quindi richiede il
  codice a 6 cifre mostrato dall'app. Da quel momento in poi, ogni accesso richiederà un codice,
  sia che tu acceda con password, Google o GitHub.
- **Codici di recupero.** L'attivazione genera dieci codici monouso, mostrati una sola volta.
  Ciascuno consente di accedere al posto del codice di autenticazione in caso di smarrimento del
  telefono, quindi salvali prima di chiudere la finestra di dialogo. **New recovery codes**
  li sostituisce, invalidando i precedenti. Disattivare la verifica in due passaggi
  e richiedere nuovi codici richiedono entrambi l'inserimento preventivo di un codice.
- **Password.** La sua modifica disconnette l'account da tutti gli altri dispositivi. Un account
  creato con Google, GitHub o LinkedIn non ha una password; la pagina consente di
  ricevere un link via email per impostarne una.
- **Dispositivi connessi.** Mostra ogni browser e terminale connesso al tuo account,
  con il rispettivo indirizzo e l'orario di accesso. Disconnetti i dispositivi che non
  riconosci, o tutti contemporaneamente.

I [token di accesso](/docs/deployment/cloud-agents/#ci-and-agents) non sono sessioni e non richiedono un secondo
fattore, quindi la CI continuerà a distribuire dopo l'attivazione. Revoca un token non più
ritenuto sicuro sotto **Settings → Access tokens**.

## Invitare il team

**Members → Invite member** fornisce un link da copiare (inviato via email quando questo control plane
è configurato per l'invio) valido per una sola volta, per 7 giorni, per un account che abbia verificato tale
indirizzo; nessuno entrerà a far parte del team finché non accetta. Invita un amministratore o un membro, e promuovilo
a proprietario una volta entrato. Proprietari e amministratori possono visualizzarlo, reinviarlo o revocarlo in
**Pending invitations**; da terminale, [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Monitorare le attività

La pagina **Activity** della console e il comando `rebase cloud activity` mostrano ai
proprietari e agli amministratori dell'organizzazione chi ha eseguito un deploy, impostato o visualizzato una variabile
d'ambiente (per nome, mai per valore), modificato un dominio, ripristinato un backup,
ridimensionato, arrestato o eliminato un progetto, modificato il ruolo di un membro o creato un
token, e quando. La sezione **Settings** di un progetto rimanda alle proprie voci; le voci
relative a un progetto eliminato rimangono archiviate. Uno script può leggerle utilizzando un token creato con
`--can audit` sull'organizzazione. Le voci vengono conservate per un anno. I filtri sono documentati in
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agenti

Un job di CI o un agente non dovrebbero utilizzare la tua password. Assegna loro un token limitato a
poche azioni su un singolo progetto, creato da un terminale autenticato con
`rebase cloud tokens create --project shop --can deploy,logs`, e impostalo come
`REBASE_TOKEN`. La fatturazione, il log delle attività e le impostazioni di notifica di un'organizzazione
sono permessi a sé stanti (`--can billing`, `audit`,
`notifications`) che un token include solo se esplicitamente richiesti. I permessi, un
flusso di lavoro GitHub Actions e le funzioni riservate a un utente autenticato sono trattati in
[CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend senza account

`rebase cloud init --claim` assegna a un'app un backend attivo prima ancora che qualcuno si sia
registrato, e stampa un URL di riscatto (claim) affinché l'utente possa mantenerlo; un progetto non riscattato
entro 72 ore viene eliminato. I permessi del token del progetto non riscattato, il valore
`REBASE_API_TOKEN` generato e le modifiche apportate dal riscatto sono descritti in
[Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Risorse di calcolo e costi

Il prezzo di un progetto si basa su quanto riserva, non su un piano a livelli. `compute` stampa
ogni parametro e la relativa stima dettagliata fornita dal control plane. (`rebase cloud
resources` è un comando diverso: mostra i database e i bucket dichiarati dal codice,
e se per ciascuno è stato eseguito il provisioning — consulta la [Guida di riferimento CLI](/docs/cli/cloud/)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Risorse richieste dall'app per istanza, es. `500m` e `2Gi`. Vuoto indica il valore predefinito della piattaforma: `100m` e `384Mi`, con possibilità di burst fino a 2 CPU e `2Gi` |
| `--replicas` | Istanze sempre attive: il limite minimo dell'autoscaler e la base fatturata mensilmente dall'abbonamento del progetto |
| `--autoscale-max` | Da 1 a 16. Il tetto massimo raggiungibile. Le istanze aggiunte dall'autoscaler oltre `--replicas` vengono misurate in secondi-pod alle stesse tariffe, e addebitate solo dove la piattaforma ha abilitato tale funzione; **Usage this month** ne indica lo stato. `--no-autoscale` lo disattiva |
| `--autoscale-cpu-target` | Da 10 a 95. L'utilizzo di CPU mantenuto dall'autoscaler, calcolato rispetto alla richiesta anziché al limite. Vuoto equivale a 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica, ma soggetta a riavvii senza preavviso |
| `--db-instances` | Da 1 a 3. `1` indica un'istanza singola senza failover; `2` aggiunge un'istanza di standby automatico |
| `--db-cpu`, `--db-memory` | Per istanza di database. Vuoto equivale a `160m` e `1Gi` |

Un parametro lasciato vuoto non equivale a uno fissato sullo stesso valore numerico: un parametro vuoto
segue il valore predefinito della piattaforma e si aggiorna insieme ad esso.

Nessun valore viene validato dalla CLI, per precisa scelta progettuale: i limiti appartengono al cluster su cui
il progetto viene eseguito e variano a seconda dei provider. Il control plane rifiuta qualsiasi
valore che non può soddisfare indicando il campo interessato. Esegui `rebase cloud compute` per visualizzare
il costo in €/mese prima e dopo; una modifica si applica immediatamente, calcolata pro-rata a partire da oggi,
ad eccezione di quelle che richiedono il riavvio del database, che attenderanno una finestra di manutenzione.

## Gli altri comandi disponibili

| Gruppo di comandi | Ambito coperto |
|---|---|
| `login`, `logout`, `whoami` | La tua sessione |
| `tokens` | Token per CI e agenti, ciascuno limitato a un singolo progetto. Consulta [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Collegamento di questa directory a un progetto, selezione di un'organizzazione, apertura della console |
| `init`, `claim` | Con `--claim`: un backend attivo senza account e un link per riscattarlo; `claim` stampa nuovamente tale link. Consulta [Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Creazione, elenco, ispezione, eliminazione |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Distribuzione e monitoraggio |
| `previews` | Build servite a un indirizzo dedicato tramite `deploy --preview`, e la loro eliminazione. Consulta [Anteprima di una modifica](#anteprima-di-una-modifica) |
| `start`, `stop`, `restart` | Sospensione di un progetto e suo ripristino. Un progetto arrestato mantiene la sottoscrizione, a meno che la piattaforma non applichi tariffe solo per lo storage e la quota di piattaforma; la riga **Billing** della console lo segnala esplicitamente in tal caso |
| `status`, `metrics`, `debug` | Cosa sta eseguendo il sistema e le cause di eventuali blocchi |
| `cron` | I cron job dell'app distribuita e le relative esecuzioni registrate, accessibili con il login di `rebase cloud`. Sola lettura |
| `env` | Variabili d'ambiente. `list` non stampa mai i valori; `--secret` è in sola scrittura |
| `app-key` | La chiave scritta da `init --claim` in `.env` come `REBASE_API_TOKEN`, trasferita al momento del riscatto; `rotate` la sostituisce revocando la precedente. Solo proprietari e amministratori |
| `service-key` | `REBASE_SERVICE_KEY`, con privilegi di amministrazione sull'API dell'app: data dell'ultima rotazione; `rotate` ne assegna una nuova all'app. Solo proprietari e amministratori |
| `domains` | Domini personalizzati, record DNS da aggiungere e verifica. Un progetto può rispondere su più domini, ciascuno verificato singolarmente; `verify` e `remove` accettano il dominio su cui intervenire, parametro omettibile solo se ne è presente uno solo (per `verify`, se ce n'è solo uno ancora in sospeso). `list --json` restituisce `{ projectId, tenantHost, domains: [...] }` |
| `db` | Collegamento o creazione di un database, connessione locale dal proprio computer, backup, ripristino e point-in-time recovery |
| `guests` | <span class="since-badge" data-since="0.27">Da 0.27</span> Gli utenti guest creati dall'accesso anonimo: conteggio, eliminazione singola, rimozione di quelli inattivi da tempo. Consulta [Guests](/docs/cli/cloud/#guests). Solo proprietari e amministratori |
| `extensions` | La lista delle estensioni Postgres consentite |
| `storage` | Il bucket del progetto |
| `resources` | Quali database e bucket sono presenti sulla piattaforma, a fronte di quanto dichiarato dal codice |
| `compute` | Risorse riservate da questo progetto, relativi costi e modalità di modifica |
| `usage` | Richieste utilizzate questo mese rispetto alla soglia inclusa ed eccedenza maturata finora, come calcolato in fattura. `usage org` elenca tutti i progetti dell'organizzazione |
| `clusters` | I cluster su cui vengono eseguiti i tenant. Riservato agli amministratori della piattaforma |
| `settings`, `orgs`, `billing` | Impostazioni del progetto, organizzazioni con relativi membri e inviti, pagamenti |
| `activity` | Registro di audit dell'organizzazione: chi ha eseguito un deploy, modificato una variabile d'ambiente (per nome), un dominio, un backup, un membro o un token. Solo proprietari e amministratori. Consulta [Monitorare le attività](#monitorare-le-attività) |
| `notifications`, `webhooks` | Destinazione a cui vengono inviati in POST gli eventi del progetto: Slack, Discord o qualsiasi URL HTTPS ([Cloud notifications](/docs/deployment/cloud-notifications/)). `webhooks` è deprecato ed esce con codice 1 ed errore `command_retired` |

Ogni gruppo presente in questa tabella risponde a `--help` con una schermata dedicata (sintassi d'uso,
flag ed esempi) e `--help` non esegue mai il comando vero e proprio. Un test verifica
l'indice delle pagine, quindi un gruppo aggiunto senza di essa provocherà il fallimento della build anziché
mostrare l'indice. `verify:docs` allinea la tabella stessa a
quell'indice: ogni gruppo gestito dalla CLI compare qui esattamente una volta, quindi un gruppo
aggiunto senza una riga corrispondente causerà a sua volta il fallimento della build.

Se utilizzato in una pipe, `--help` restituisce un output in formato JSON: la stessa riga d'uso, flag ed esempi
strutturati per la lettura automatica anziché sessanta righe di sequenze di escape per terminale.

## Cosa non è incluso nella beta

Chiarito in modo trasparente, per evitare sorprese:

- **Nessuna scelta della regione.** Al momento tutto viene eseguito in un'unica regione. Il modello
  di posizionamento è predisposto nella piattaforma, ma un progetto non può selezionare una regione.
  `projects create --provider` e `--region` non costituiscono l'eccezione che potrebbero sembrare:
  registrano a quale dei target di deploy configurati nel control plane appartiene un
  progetto; essendocene uno solo, entrambi assumono quel valore predefinito e nessuno dei due sposta
  il progetto altrove. `rebase cloud projects create --help` riporta la stessa indicazione.
- **Nessun accesso self-service.** L'accesso viene concesso a scaglioni; non è possibile iscriversi e pagare direttamente.
- **Nessun SLA pubblicato**, né certificazione SOC 2. Se hai bisogno di uno di questi requisiti, segnalalo
  al momento della richiesta di accesso anziché darlo per scontato.
- **Nessun deploy per branch**, né GitHub App ufficiale. I deploy hook (URL segreti
  a cui puntare un webhook del repository) sono il meccanismo di automazione supportato. I [deploy di
  anteprima](#anteprima-di-una-modifica) sono in fase di rilascio e vengono avviati da CLI.
- **I token agiscono per conto di una persona.** Un [token](/docs/deployment/cloud-agents/#ci-and-agents) viene generato da un account
  e ne assume l'identità; non esiste ancora un'identità macchina gestita a livello di organizzazione. Se
  effettui l'accesso da CI, passa `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD`
  da un secret manager: `--password` memorizza la password nella cronologia della shell e
  nella tabella dei processi, e segnala questo comportamento prima di eseguire l'accesso. Se il file
  `.rebase/cloud.json` del repository fa riferimento a un control plane diverso da quello della piattaforma, passalo
  anche tramite `--url`: in assenza di un terminale interattivo, `login` rifiuta di inviare una password a un
  host specificato unicamente dal file clonato.
- **Nessun endpoint pubblico per il database.** Un database gestito non è esposto su
  Internet, quindi l'host mostrato dalla console è l'indirizzo interno utilizzato dal backend e
  non è risolvibile dal tuo computer locale. `rebase cloud db connect` apre una porta locale
  collegata a quel database tramite un tunnel attraverso il control plane per tutto il tempo in
  cui il comando resta attivo; tuttavia, non esiste un hostname permanente a cui un servizio
  terzo possa connettersi. Quel tunnel e la password visibile tramite
  `rebase cloud db info --reveal` richiedono entrambi il ruolo di proprietario o amministratore
  dell'organizzazione: lo stesso richiesto dall'editor SQL di Studio, poiché tutte e tre le operazioni danno
  accesso a una sessione sui dati di produzione.
- **Eseguire il deploy equivale a eseguire codice con i secret di produzione.** L'ambiente
  dell'app include `REBASE_SERVICE_KEY` (amministratore sulla propria API),
  `DATABASE_URL` e `JWT_SECRET`, quindi il codice distribuito da un membro può leggerli,
  anche se solo proprietari e amministratori possono visualizzarli nella console. Invita
  come membro solo persone a cui affideresti tali valori.
- **La service key può essere sostituita.** La sezione **Settings** del progetto
  (o il comando `rebase cloud service-key rotate`) genera una nuova `REBASE_SERVICE_KEY`
  e riavvia l'app utilizzandola. La vecchia chiave rimane valida fino al completamento
  del riavvio, dopodiché cessa di funzionare; qualsiasi client che l'abbia memorizzata verrà rifiutato da quel
  momento in poi. Il riscatto di un progetto esegue la stessa procedura.

## Alternativa: self-hosting

Nessuna scelta qui comporta un vendor lock-in. La [guida al self-hosting](/docs/deployment/self-hosting/)
consente di eseguire esattamente la stessa immagine e lo stesso bundle con `docker compose`, e la
[guida a Kubernetes](/docs/deployment/kubernetes/) riproduce la medesima topologia a partire
dall'Helm chart.
