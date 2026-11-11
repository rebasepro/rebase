---
sourceHash: de4684f207c4a8fd
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Di cosa si tratta, come collegare e distribuire un progetto e cosa la beta privata non include ancora.
---

Rebase Cloud esegue lo stesso Rebase open-source che ospiteresti in autonomia — la stessa
immagine `rebasepro/server` pubblicata, lo stesso bundle, lo stesso Postgres. La
differenza sta in chi lo gestisce.

:::note[Beta privata]
Rebase Cloud è in **beta privata**. Esegue tenant reali già oggi e apre l'accesso a
scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi qui sotto richiedono un account a cui è stato concesso l'accesso.
Tutto il resto su questo sito funziona senza di esso.
:::

## Cos'è

Un **progetto** Cloud è composto da tre elementi che la piattaforma gestisce per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine di runtime pubblicata. I deploy sono un caricamento di bundle, non una build di container |
| **Database** | Un PostgreSQL gestito, con backup automatici e point-in-time recovery |
| **Storage** | Un bucket dedicato, se il tuo progetto usa lo storage di file |

Ognuno viene sottoposto a provisioning al tuo primo deploy, e la fatturazione si basa sulle risorse
riservate anziché per utente (per seat).

**Nulla cambia nel tuo progetto per essere eseguito lì.** Lo stesso repository
si può ospitare in autonomia con `docker compose`, e la via d'uscita è concreta: `rebase build`
produce un bundle che si avvia ovunque sia eseguibile l'immagine di runtime.

## Collegare un progetto

Dalla directory di un progetto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` apre la console nel browser e stampa un codice breve. Verifica che
la console mostri lo stesso codice e approva l'accesso da lì: il terminale
acquisisce la sessione e la scrive in `~/.rebase/credentials.json`. Se non
hai effettuato l'accesso alla console, accedi prima lì con il metodo che preferisci,
inclusi Google e GitHub. Tramite SSH, `rebase cloud login --no-browser` stampa il link
da aprire sul tuo computer.

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono
flag ed entrambi sono obbligatori: su un terminale vengono richiesti in modo interattivo,
mentre un'esecuzione non interattiva (headless) che ne ometta uno termina con `input_required`
anziché inventarne uno. **Il sottodominio non è modificabile in seguito:** è l'host
`<slug>.rebase.website` su cui il progetto risponde, quindi sceglilo con attenzione.

`--link` collega questa directory al progetto nella stessa chiamata, evitando
un passaggio `link` separato. Scrive `.rebase/cloud.json`, che registra l'ID e
lo slug del progetto. Quel file non è un segreto e non contiene le tue credenziali — queste ultime
risiedono in `~/.rebase/credentials.json`, scritte da `login`.

Viene tuttavia sottoposto a commit con il codice, consentendo a un repository clonato di
indicare qualsiasi piano di controllo (control plane). Quando l'host proviene solo da quel file
e non è né quello della piattaforma né uno su cui hai già effettuato l'accesso in precedenza,
`login` lo indica ed esplicita una richiesta di conferma prima di inviarvi email e password.
Senza terminale, o con `--json`, rifiuta l'operazione con `unknown_control_plane`; passa
`--url <host>` (o imposta `REBASE_CLOUD_URL`) per accedere intenzionalmente lì.

Per accedere senza browser, passa la tua email: `rebase cloud login --email
me@example.com` richiederà la tua password. **Ti sei registrato con Google, GitHub o
LinkedIn?** Il tuo account non ha una password, quindi usa invece un codice:

```bash
rebase cloud login --code --email me@example.com
```

Il control plane ti invierà via email un codice a 6 cifre, valido per dieci minuti, da inserire
nel prompt. Con `--email` e senza password, `rebase cloud login` ti chiede
se usare la password o un codice. I codici richiedono che il control plane sia in grado di inviare
email; in caso contrario, `--code` lo segnala ed esce con `otp_unavailable`.

Se hai attivato l'autenticazione a due fattori, `login` richiederà quindi il codice dall'app
di autenticazione o uno dei codici di ripristino, indipendentemente dal metodo di accesso
utilizzato. Tramite browser, la console lo richiede al momento del login. Né un codice di accesso né un secondo fattore possono essere digitati senza un terminale.
Per uno script, crea un token di accesso nella console (**Settings → Access
tokens**) e imposta `REBASE_TOKEN`; consulta [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

Una password errata risponde con `invalid_credentials` offrendo le stesse due modalità di accesso,
poiché la causa comune è un account che non ha mai avuto una password.

`billing setup` collega una carta all'organizzazione, una sola volta. È posizionato per primo
nella sequenza intenzionalmente: il primo deploy di un progetto viene rifiutato in assenza di una carta,
e scoprirlo dopo aver completato l'upload del bundle sarebbe l'ordine peggiore.

Successivamente, la pagina **Billing** della console elenca le fatture dell'organizzazione,
ciascuna con la pagina hosted di Stripe e il PDF, e mostra un'anteprima della fattura successiva di ogni
progetto. `rebase cloud billing invoices` e `rebase cloud billing upcoming`
mostrano lo stesso output. Entrambi sono riservati ai proprietari e agli amministratori dell'organizzazione. Dove
previsto dalla piattaforma, **Manage billing** apre il portale clienti di Stripe per gestire la
carta, i dati di fatturazione e le fatture passate.

Se è già presente una carta registrata, la creazione di un altro progetto nella console non
richiede un secondo pagamento: il progetto viene addebitato su quella carta e distribuito. Se la carta
viene rifiutata, o se la banca richiede la conferma del pagamento, la console ti reindirizza a
**Billing**, dove **Fix your card** consente di salvare un'altra carta e **Complete the
payment** apre la fattura di Stripe.

L'utilizzo di un progetto è visibile nella sua panoramica, sotto **Usage this month**, e
per tutti i progetti contemporaneamente nella pagina **Billing**: richieste rispetto alla quota
inclusa (la barra diventa arancione all'80%), errori 5xx, l'overage accumulato finora
e la stima di fine mese a questo ritmo. L'overage è calcolato dallo
stesso codice che lo comunica a Stripe, quindi corrisponde a quanto sarà presente in fattura;
comparirà nella fattura del mese successivo. `rebase cloud usage` stampa le
stesse informazioni, e `rebase cloud usage org` mostra l'intera organizzazione. Qualsiasi membro può visualizzarlo.
I numeri indicano anche ciò che non è ancora visibile: l'object storage non viene misurato,
quindi non viene addebitato alcun overage di archiviazione; finché un progetto esegue due o più pod dell'app,
le sue richieste non vengono conteggiate; e una giornata con campionamenti mancati produce un conteggio per difetto. Un
progetto con autoscaling mostra anche i pod eseguiti oltre `--replicas`, in ore-pod,
il loro costo in base alle proprie tariffe e se questa piattaforma li fattura già. Un
progetto riscattato da un agente conteggia solo i giorni a partire dal riscatto: prima
di allora, il progetto apparteneva alla piattaforma.

È possibile collegare un progetto esistente senza crearne uno nuovo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Un solo comando, e nessun flag da ricordare. Il file `rebase.json` dello scaffold dichiara
`runtime: "managed"` per il suo backend, e `deploy` legge tale dichiarazione —
segnalandolo durante l'esecuzione (`rebase.json declares runtime: managed — deploying a
bundle`), compila l'app in `dist-bundle`, carica il bundle, lo esegue sull'immagine
di runtime pubblicata e segue il deployment fino allo stato finale. Il codice di uscita
rappresenta l'esito, quindi la stessa riga funziona in modo automatico (unattended) nei flussi di CI.

Termina indicando l'indirizzo a cui risponde ciascuna app e se la nuova versione è
attiva (live) su di esso:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa che l'indirizzo ha risposto dopo la build: l'endpoint `/health` di un backend
ha restituito `ok`, e la pagina di un'app statica si è caricata (da questo deployment, quando
servita dalla piattaforma). La verifica attende fino a `--live-timeout` secondi, 60 per
impostazione predefinita; `0` la salta. Se un'app non risponde in tempo, il deploy termina comunque
con codice zero poiché il deployment è andato a buon fine, e l'ultima riga specifica quale app non ha
risposto e perché. Un deploy fallito termina invece su una sola riga, indicando l'app e il
motivo, rimandando a `rebase cloud logs` per il log di build completo.

Gli script possono passare `--json` per ottenere un unico oggetto contenente gli stessi dati — `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` e l'ID del deployment. A differenza del resto di
`rebase cloud`, `deploy` non passa automaticamente a JSON se reindirizzato in una pipe.

Ciò che tale runtime consente — pacchetti e moduli nativi, memoria e istanze,
timeout e dimensioni del body, file system, secret, storage e rete in
uscita — è descritto nella pagina dedicata:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Per distribuire un artefatto compilato in precedenza — ad esempio in un job di CI che compila una volta
ed esegue il deploy due volte — punta alla directory anziché ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

L'uscita dal runtime gestito richiede un flag apposito, `--eject`, e nient'altro lo
richiederà: una build che sposterebbe un progetto gestito su un'immagine container proprietaria
viene rifiutata finché non lo confermi esplicitamente. In precedenza si usava `--force`, che associava
l'azione meno reversibile della CLI allo stesso termine di "sovrascrivi questo file";
ora è un'opzione sconosciuta anziché un alias, quindi uno script che la contiene
si interromperà.

### La verifica della sintassi prima dell'upload

I file di un'app statica vengono serviti esattamente come sono. Quando la sua procedura di `build`
si limita a copiare script scritti a mano in `output`, nessun parser li ha analizzati, e un file
contenente un errore di battitura finisce online impedendo il caricamento della pagina. Pertanto, prima di
caricare qualsiasi elemento, `deploy` esegue il parsing di ogni file `.js`, `.mjs` e `.cjs` nell'`output` di
ogni app statica, oltre a ogni tag `<script>` inline nei suoi file `.html`. Questo include sia un'app
statica distribuita singolarmente, sia le app statiche incorporate nel bundle del backend. Un errore
di sintassi blocca il deploy indicando file, riga e colonna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json`, il `code` dell'errore è `syntax_error`. Gli script inline che un browser
non esegue come JavaScript vengono ignorati: JSON, import map, template e qualsiasi
altro `type` non JavaScript, i tag `<script src>` e gli script che contengono ancora
markup di template non renderizzato come `{{ }}`. Un file `.js` supera la verifica se è analizzabile
come script classico o come modulo, poiché è la pagina a deciderlo. Non viene letto nulla
all'interno di `node_modules`, né viene analizzato un `--bundle-dir` precompilato.
`--no-verify` salta la verifica per un singolo deploy.

Monitoraggio:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` riporta `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la
piattaforma sta lavorando regolarmente ed eseguire il polling è l'azione corretta; quando
indica un elemento, quell'elemento è in attesa di un tuo intervento.

## Anteprima di una modifica

```bash
rebase cloud deploy --preview
```

Questo compila e carica esattamente ciò che farebbe `deploy`, ma lo serve a un indirizzo
dedicato, come `https://shop--k3x9ab.rebase.website`. L'ambiente di produzione continua
a servire ciò che serviva prima. Il deploy stampa l'indirizzo dell'anteprima una volta completata la build.

Per mantenere lo stesso indirizzo attraverso più deploy, assegna un nome alla preview. Eseguire
nuovamente il deploy con lo stesso nome la aggiornerà:

```bash
rebase cloud deploy --preview-name new-checkout
```

I componenti con cui una preview comunica dipendono da ciò che hai distribuito:

- **`rebase cloud deploy --preview`** genera l'anteprima del backend, con le relative app statiche
  incorporate, esattamente come vengono eseguite in produzione. Riceve un backend dedicato su un
  **proprio database vuoto**, mai quello di produzione. L'avvio sul database
  di produzione applicherebbe ad esso lo schema e le regole di accesso della preview.
- **`rebase cloud deploy web --preview`** mostrerebbe l'anteprima di una singola app statica
  autonoma, le cui pagine chiamano il backend di **produzione**. Ciò richiede un control plane
  in grado di servire siti statici in modo autonomo, funzionalità non ancora supportata da Rebase Cloud:
  l'operazione viene rifiutata con `PREVIEW_STATIC_UNSERVED` e non viene pubblicato nulla. Esegui invece
  la preview del backend, che serve le app statiche incorporate; un progetto privo di backend gestito
  non può ancora essere visualizzato in anteprima.

Una preview non carica codice sorgente e non registra app o hostname, poiché ciascuna
di queste azioni modificherebbe il progetto di produzione. `--source` ed `--eject` non possono
essere combinati con `--preview`. Entrambi creano un'immagine container per la produzione.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` senza `--preview` fa sempre riferimento alla produzione.

La pagina **Deployments** della console elenca le stesse preview, consentendo di aprirle, visualizzarne il
log di build o eliminarle. La creazione rimane un passaggio da riga di comando (CLI).

Una preview scade una settimana dopo l'ultimo deploy.

Al termine, il deploy verifica che l'indirizzo della preview risponda, esattamente come avviene per
un deploy in produzione (`--live-timeout <seconds>`, `0` per saltare). Il certificato di una nuova
preview può richiedere un minuto o due, quindi un deploy completato con successo potrebbe segnalare
che l'indirizzo non risponde ancora.

La preview di un backend viene fatturata come un'unità app di dimensione predefinita (100m di CPU
e 384 MiB di memoria, alla tariffa della tua app per la relativa regione e capacità),
ripartita proporzionalmente (pro rata) per la sua durata di esistenza, e compare nel
preventivo mensile del progetto nella console. `rebase cloud deploy --preview` ne stampa lo stesso preventivo,
su base mensile (`cost` con `--json`). Per avviarne una è necessaria una carta registrata, come per un deploy in produzione. Un primo deploy che
fallisce prima che qualsiasi cosa venga eseguita viene rimosso anziché fatturato. Un progetto può eseguire
fino a tre preview di backend contemporaneamente.

Ogni nuovo indirizzo di preview riceve un certificato TLS dedicato da Let's Encrypt,
che consente a un dominio 50 nuovi certificati a settimana, condivisi con tutti i siti di produzione su di esso.
Le preview possono utilizzarne fino a 20 nell'arco di 7 giorni, a livello di piattaforma. Superata tale
soglia, una nuova preview viene rifiutata (`429`, `preview_cert_budget`) indicando quando sarà possibile
distribuirla; il nuovo deploy di una preview già esistente non viene mai conteggiato.

Il database di una preview di backend è un secondo database sull'istanza Postgres di **produzione**:
dati isolati, ma sulla stessa istanza e sullo stesso disco. È limitato a 10
connessioni, in modo che le preview non possano esaurire quelle di produzione, e a 2 GB: una preview
il cui database supera tale dimensione viene messa in pausa. Il suo backend si arresta, il suo indirizzo smette
di rispondere, `rebase cloud previews` e la console la mostrano come `paused` indicandone il
motivo, e i proprietari e gli amministratori del progetto ricevono una notifica (`preview.paused`). I dati
vengono conservati fino alla scadenza. Esegui nuovamente il deploy per avviarla (verrà messa nuovamente in pausa
finché il database rimane troppo grande) o eliminala. Una preview in pausa continua a essere
fatturata finché non viene eliminata o non scade. Elimina le preview non più necessarie. Le estensioni
installate in produzione non vengono installate nel database di una preview.

Le preview sono in fase di rilascio graduale. Un control plane che non le supporta ancora rifiuterà
`--preview` con `previews_unavailable` e non distribuirà nulla.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback reindirizza il progetto a ciò che era stato distribuito da un precedente deployment riuscito
e non esegue mai una nuova build — il valore di un rollback risiede nel fatto che distribuisce
un artefatto già testato ed eseguito.

I deployment idonei dipendono da come è stato distribuito il progetto, ed entrambe le modalità
sono supportate:

| Modalità di deploy | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (una build dai sorgenti) | L'immagine pubblicata da quella build |
| `rebase cloud deploy --bundle` (il runtime della piattaforma) | Il bundle distribuito da quel deploy, sulla versione di runtime attualmente eseguita dal progetto |

Le app statiche incorporate nel bundle del backend (un semplice `rebase cloud deploy` su
un progetto con backend) fanno parte di quel bundle, quindi vengono ripristinate insieme ad esso.

Un'app statica distribuita singolarmente (`rebase cloud deploy <app>`) non può ancora essere
ripristinata tramite rollback. Il suo deployment registra l'app pubblicata, ma nessun bundle, quindi il
control plane non ha elementi da cui ripristinarla. La soluzione consiste nel distribuire nuovamente l'ultima
versione funzionante, ad esempio dal commit precedente a quello difettoso. Dopo un tale
deploy, `deploy` segnala questa circostanza anziché suggerire `rollback`, e un `rollback`
senza ID rifiuta l'operazione anziché ridistribuire il backend attualmente attivo.

Pertanto, un rollback richiede un deployment che abbia registrato uno dei due elementi, il che presuppone un
progetto distribuito con successo almeno due volte. `rebase cloud deployments`
contrassegna quelli idonei, e `--json` riporta `rollbackable` per ogni riga insieme
all'`image` o al `bundle` che verrebbe ripristinato.

Due tipologie di deployment vengono rifiutate, e la CLI specifica quali: uno non riuscito
e uno antecedente al momento in cui la piattaforma ha iniziato a registrarne l'artefatto. In nessuno dei due casi
è possibile fare congetture — farlo comporterebbe la distribuzione di ciò che è stato compilato o caricato
più di recente pretendendo di ripristinare quello selezionato — pertanto distribuisci direttamente la versione desiderata.

Ogni deploy riuscito termina indicando la procedura di ripristino (`rebase cloud rollback`),
in modo che sia immediatamente visibile nel momento in cui ci si accorge di un rilascio problematico.

Un rollback aggiunge un nuovo deployment anziché riavvolgere la cronologia, e attende che
la versione ripristinata sia attiva prima di confermare il successo. È possibile seguirne l'avanzamento
con `rebase cloud logs -f`.

## Ripristinare il database a un momento specifico nel tempo

Un database gestito può essere ripristinato a qualsiasi minuto all'interno della sua finestra di ripristino,
da **Database → Backups** nella console o tramite la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
Il processo richiede due passaggi. Innanzitutto viene preparata (in staging) una copia ripristinata accanto al database attivo;
la tua app continua a funzionare su quest'ultimo e lo storage della copia viene fatturato fino
al passaggio (cutover) o all'annullamento (discard).
Successivamente, una volta pronta la copia, il cutover reindirizza l'app verso di essa e la riavvia.
Tutto ciò che è stato scritto dopo l'orario di destinazione non è presente nella copia. Il database
originale viene conservato come piano di rientro e continua a occupare storage fatturabile; per tornare indietro,
rimuoverlo o eseguire un secondo ripristino è necessario contattare l'assistenza. Solo un proprietario o un amministratore
può eseguire lo staging, il cutover o l'annullamento, e la console richiede il nome del progetto
prima di procedere al cutover.

## Proteggere il proprio account

L'account della console ha accesso ai database di produzione, ai secret e alla fatturazione, quindi
proteggilo adeguatamente. Apri **Account security** dal menu sotto il tuo avatar
nella console (oppure vai su `/account`). La pagina è personale, non appartiene a
un'organizzazione: le impostazioni configurate lì si applicano a tutte le organizzazioni a cui appartieni.

- **Verifica in due passaggi.** Attivala con qualsiasi app di autenticazione (1Password,
  Google Authenticator, Authy). La pagina mostra una chiave di configurazione da aggiungere all'app, oppure un
  link che apre l'app su smartphone con la chiave già inserita, quindi richiede il
  codice a 6 cifre mostrato dall'app. Da quel momento in poi, ogni accesso richiederà un codice,
  sia che si acceda con password, Google o GitHub.
- **Codici di ripristino.** L'attivazione genera dieci codici monouso, mostrati una sola volta.
  Ciascuno di essi consente l'accesso al posto del codice dell'authenticator in caso di smarrimento
  del telefono; salvali prima di chiudere la finestra di dialogo. **New recovery codes**
  li sostituisce invalidando i precedenti. Sia la disattivazione della verifica in due passaggi
  che la generazione di nuovi codici richiedono prima l'inserimento di un codice.
- **Password.** La sua modifica disconnette la sessione su tutti gli altri dispositivi. Un account
  creato con Google, GitHub o LinkedIn non possiede una password; la pagina offre la possibilità di
  ricevere un link via email per impostarne una.
- **Dispositivi connessi.** Ogni browser e terminale connesso al tuo account,
  con il rispettivo indirizzo e data di accesso. Puoi disconnettere qualsiasi dispositivo non
  riconosciuto, oppure tutti contemporaneamente.

I [token di accesso](/docs/deployment/cloud-agents/#ci-and-agents) non sono sessioni e non richiedono un secondo
fattore, quindi la CI continuerà a eseguire i deploy dopo l'attivazione. Revoca i token non più
ritenuti affidabili in **Settings → Access tokens**.

## Invitare il tuo team

**Members → Invite member** fornisce un link da copiare (inviato via email quando questo control plane
supporta l'invio di email) utilizzabile una sola volta, per 7 giorni, per un account che ha verificato tale
indirizzo; nessuno entra a far parte dell'organizzazione finché non accetta. Invita un admin o un membro, e promuovilo
a proprietario (owner) una volta completata l'adesione. I proprietari e gli amministratori possono visualizzare, reinviare o revocare l'invito in
**Pending invitations**; da terminale, [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Verificare chi ha fatto cosa

La pagina **Activity** della console e il comando `rebase cloud activity` mostrano ai
proprietari e agli amministratori dell'organizzazione chi ha eseguito un deploy, impostato o visualizzato una variabile d'ambiente
(per nome, mai per valore), modificato un dominio, ripristinato un backup,
ridimensionato, arrestato o eliminato un progetto, modificato il ruolo di un membro o creato un
token, con il relativo timestamp. La sezione **Settings** di un progetto rimanda alle proprie voci; un'entrata
relativa a un progetto eliminato viene mantenuta. Uno script può leggerle tramite un token creato con
`--can audit` sull'organizzazione. Le registrazioni vengono conservate per un anno. I filtri sono descritti in
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agenti

Un job di CI o un agente non dovrebbe mai gestire la tua password. Assegnagli un token limitato a
poche azioni su un singolo progetto, creato da un terminale autenticato con
`rebase cloud tokens create --project shop --can deploy,logs`, e impostalo come
`REBASE_TOKEN`. La fatturazione, il log delle attività e le impostazioni di notifica
dell'organizzazione sono permessi specifici (`--can billing`, `audit`,
`notifications`) che un token include solo se richiesto. I permessi, un flusso di lavoro per
GitHub Actions e ciò che rimane vincolato alla persona autenticata sono disponibili in
[CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend senza account

`rebase cloud init --claim` fornisce a un'app un backend funzionante prima ancora che qualcuno si sia
registrato, stampando un URL di riscatto (claim URL) affinché l'utente possa mantenerlo; un progetto che nessuno riscatta
entro 72 ore viene eliminato. Le operazioni consentite dal token di un progetto non riscattato, il
`REBASE_API_TOKEN` che scrive e cosa comporta il riscatto sono descritti in
[Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Risorse di calcolo e costi

Il prezzo di un progetto si basa sulle risorse riservate, non su piani a livelli (tier). `compute` mostra
tutti i parametri regolabili e il preventivo dettagliato del control plane per ciascuno di essi. (`rebase cloud
resources` è una cosa diversa: riguarda i database e i bucket dichiarati dal codice
e lo stato del loro provisioning — vedi la [guida di riferimento della CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Risorse richieste per istanza dell'app, es. `500m` e `2Gi`. Se vuoto, si applica il valore predefinito della piattaforma — `100m` e `384Mi`, con burst fino a 2 CPU e `2Gi` |
| `--replicas` | Istanze sempre attive: la soglia minima per l'autoscaler e la base per la fatturazione mensile dell'abbonamento del progetto |
| `--autoscale-max` | 1–16. Il tetto massimo raggiungibile. Le istanze aggiunte dall'autoscaler oltre `--replicas` sono conteggiate al pod-secondo con le stesse tariffe, e addebitate solo dove la piattaforma ha abilitato tale funzione; **Usage this month** ne indica lo stato. `--no-autoscale` lo disattiva |
| `--autoscale-cpu-target` | 10–95. L'utilizzo di CPU mantenuto dall'autoscaler, calcolato rispetto alla richiesta (request) anziché al limite. Se vuoto, corrisponde a 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica, ma soggetta a riavvio senza preavviso |
| `--db-instances` | 1–3. `1` indica una singola istanza senza failover; `2` aggiunge uno standby automatico |
| `--db-cpu`, `--db-memory` | Per istanza di database. Se vuoto, corrisponde a `160m` e `1Gi` |

Un parametro vuoto non equivale a uno bloccato sullo stesso valore numerico: un parametro non
specificato segue le impostazioni predefinite della piattaforma e si aggiorna di conseguenza.

La CLI non convalida nulla a priori, intenzionalmente: i limiti appartengono al cluster su cui
viene eseguito il progetto e variano in base al provider. Il control plane rifiuterà qualsiasi
valore non supportato specificando il campo. Esegui `rebase cloud compute` per verificare
il costo in €/mese prima e dopo; le modifiche hanno effetto immediato, ripartite pro rata a partire da oggi,
ad eccezione di quelle che comportano il riavvio del database, le quali attendono una finestra di manutenzione.

## Gli altri comandi disponibili

| Gruppo di comandi | Descrizione |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | La tua sessione; `access-token` stampa il bearer token che la CLI invierebbe ora, utile per gli script e il server MCP |
| `tokens` | Token per CI e agenti, ciascuno limitato a un singolo progetto. Vedi [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Collegamento di questa directory a un progetto, selezione dell'organizzazione, apertura della console |
| `connect` | Aggiunta di un server Rebase self-hosted al tuo account, in modo che il [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude possa raggiungerlo accanto ai tuoi progetti Cloud. `--list` li mostra, `--remove` ne rimuove uno. Solo proprietari e admin |
| `init`, `claim` | Con `--claim`: un backend attivo senza account e un link per riscattarlo; `claim` stampa nuovamente tale link. Vedi [Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Creazione, visualizzazione elenco, ispezione ed eliminazione dei progetti |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Distribuzione e monitoraggio |
| `previews` | Build servite a un indirizzo dedicato tramite `deploy --preview`, e relativa eliminazione. Vedi [Anteprima di una modifica](#anteprima-di-una-modifica) |
| `start`, `stop`, `restart` | Mettere in pausa un progetto e ripristinarlo. Un progetto arrestato mantiene la sottoscrizione attiva, a meno che la piattaforma non fatturi per i progetti fermati solo lo storage e la quota di piattaforma; la riga **Billing** della console lo specifica quando applicabile |
| `status`, `metrics`, `debug` | Stato di esecuzione e cause di eventuali problemi |
| `cron` | I cron job dell'app distribuita e le loro esecuzioni registrate, letti con il tuo account `rebase cloud`. Sola lettura |
| `env` | Variabili d'ambiente. `list` non stampa mai i valori; `--secret` è in sola scrittura |
| `app-key` | La chiave scritta da `init --claim` in `.env` come `REBASE_API_TOKEN`, trasferita al momento del riscatto; `rotate` la sostituisce revocando la precedente. Solo proprietari e admin |
| `service-key` | `REBASE_SERVICE_KEY`, con permessi di amministratore sull'API dell'app: quando è stata ruotata l'ultima volta; `rotate` ne assegna una nuova all'app. Solo proprietari e admin |
| `domains` | Domini personalizzati, record DNS da aggiungere e verifica. Un progetto può rispondere su più domini, ciascuno verificato singolarmente; `verify` e `remove` richiedono il dominio su cui intervenire, che può essere omesso solo se ne è presente uno solo (per `verify`, solo se ancora in sospeso). `list --json` restituisce `{ projectId, tenantHost, domains: [...] }` |
| `db` | Connessione o creazione di un database, connessione locale dalla propria macchina, backup, ripristino e point-in-time recovery |
| `guests` | Gli utenti guest generati dagli accessi anonimi: conteggio, eliminazione singola, pulizia di quelli inattivi da tempo. Vedi [Guests](/docs/cli/cloud/#guests). Solo proprietari e admin |
| `extensions` | La allowlist delle estensioni Postgres |
| `storage` | Il bucket del progetto |
| `resources` | Quali database e bucket sono gestiti dalla piattaforma, a fronte di quanto dichiarato nel codice |
| `compute` | Risorse riservate dal progetto, relativi costi e modalità di modifica |
| `events` | Eventi del backend, dai più recenti: scalabilità dell'app, modifiche al database pianificate e applicate, failover su standby, espansione del disco |
| `usage` | Richieste utilizzate questo mese a fronte della quota inclusa e overage accumulato, come contabilizzato in fattura. `usage org` elenca tutti i progetti dell'organizzazione |
| `clusters` | I cluster su cui vengono eseguiti i tenant. Riservato agli amministratori della piattaforma |
| `settings`, `orgs`, `billing` | Impostazioni di progetto, organizzazioni, membri, inviti e pagamenti |
| `activity` | Audit log dell'organizzazione: chi ha distribuito, modificato una variabile d'ambiente (per nome), un dominio, un backup, un membro o un token. Solo proprietari e admin. Vedi [Verificare chi ha fatto cosa](#verificare-chi-ha-fatto-cosa) |
| `notifications`, `webhooks` | Destinazione delle richieste POST per gli eventi del progetto: Slack, Discord o qualsiasi URL HTTPS ([Notifiche Cloud](/docs/deployment/cloud-notifications/)). `webhooks` è deprecato ed esce con codice 1 ed errore `command_retired` |

Ogni gruppo in quella tabella risponde a `--help` con una pagina dedicata — sintassi di utilizzo,
flag ed esempi — e `--help` non esegue mai il comando. Un test verifica
l'indice delle pagine, quindi un gruppo aggiunto senza di essa causa il fallimento della build anziché
rispondere con il sommario. Il comando `verify:docs` vincola la tabella stessa
a tale indice: ogni gruppo gestito dalla CLI deve comparire qui esattamente una volta, quindi qualsiasi gruppo
aggiunto senza la rispettiva riga fa fallire la build.

Se reindirizzato in una pipe, `--help` risponde invece in formato JSON: la stessa riga di utilizzo, flag ed esempi
strutturati per una facile lettura, al posto di sessanta righe di sequenze di escape da terminale.

## Cosa non include la beta

Esposto chiaramente, perché scoprirlo in seguito sarebbe peggio:

- **Nessuna scelta della regione.** Attualmente tutto viene eseguito in un'unica regione. Il modello di
  posizionamento esiste nella piattaforma, ma un progetto non può scegliere una regione specifica.
  I parametri `projects create --provider` e `--region` non rappresentano un'eccezione come potrebbe sembrare:
  registrano a quale dei target di deploy registrati nel control plane appartiene un
  progetto; essendocene uno solo, entrambi assumono quel valore predefinito e nessuno dei due sposta un
  progetto altrove. `rebase cloud projects create --help` riporta la stessa indicazione.
- **Non è self-service.** L'accesso viene concesso a scaglioni; non esiste una procedura immediata di registrazione e pagamento.
- **Nessun SLA pubblicato** e nessuna certificazione SOC 2. Se hai bisogno di uno di essi, specificalo
  nella richiesta di accesso anziché darlo per scontato.
- **Nessun branch deploy** e nessuna GitHub App proprietaria. I deploy hook — URL segreti
  verso cui puntare un webhook del repository — costituiscono l'automazione supportata. I [deploy
  di anteprima (preview)](#anteprima-di-una-modifica) sono in fase di rilascio e vengono avviati dalla CLI.
- **I token agiscono per conto di una persona.** Un [token](/docs/deployment/cloud-agents/#ci-and-agents) viene generato da un account
  e agisce a suo nome; non esiste ancora un'identità macchina gestita dall'organizzazione. Se invece
  effettui l'accesso dalla CI, passa `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD`
  tramite un secret store — l'opzione `--password` inserisce la password nella cronologia della shell e
  nella tabella dei processi, e te lo segnala prima di autenticarti. Se il file
  `.rebase/cloud.json` del repository fa riferimento a un control plane diverso da quello della piattaforma, passalo
  anche tramite `--url`: senza un terminale, `login` rifiuta di inviare una password a un
  host specificato unicamente nel file del codice clonato.
- **Nessun endpoint di database pubblico.** Un database gestito non è esposto a
  Internet, quindi l'host mostrato dalla console è l'indirizzo utilizzato internamente dal backend e
  non si risolverà sulla tua macchina locale. `rebase cloud db connect` apre una porta locale
  collegata a quel database tramite un tunnel attraverso il control plane per tutto il tempo
  in cui rimane in esecuzione — ma non esiste un hostname permanente a cui un servizio di terze parti
  possa connettersi. Quel tunnel e la password visibile con
  `rebase cloud db info --reveal` richiedono entrambi il ruolo di proprietario o amministratore
  dell'organizzazione: lo stesso richiesto dall'editor SQL di Studio, poiché tutti e tre aprono
  una sessione diretta sui tuoi dati di produzione.
- **Eseguire il deploy equivale a eseguire codice con i secret di produzione.** L'ambiente
  dell'app contiene `REBASE_SERVICE_KEY` (amministratore della propria API),
  `DATABASE_URL` e `JWT_SECRET`, pertanto il codice distribuito da un membro può leggerli,
  anche se solo i proprietari e gli amministratori possono visualizzarli nella console. Invita
  come membro solo persone a cui affideresti tali valori.
- **La service key può essere sostituita.** Nelle **Settings** del progetto
  (o tramite `rebase cloud service-key rotate`) viene emessa una nuova `REBASE_SERVICE_KEY`
  e l'app viene riavviata su di essa. La vecchia chiave rimane valida fino al completamento
  del riavvio e non oltre; qualsiasi sistema che l'abbia memorizzata verrà rifiutato
  da quel momento in poi. Il riscatto (claim) di un progetto esegue la stessa operazione.

## Self-hosting in alternativa

Non c'è alcun vincolo di lock-in. La [guida al self-hosting](/docs/deployment/self-hosting/)
esegue la medesima immagine e lo stesso bundle tramite `docker compose`, e la
[guida a Kubernetes](/docs/deployment/kubernetes/) genera la stessa topologia a partire
dall'Helm chart.
