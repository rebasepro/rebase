---
sourceHash: 932f7373eaaf4e2e
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Di cosa si tratta, come collegare e distribuire un progetto e cosa non include ancora la beta privata.
---

Rebase Cloud esegue lo stesso Rebase open source che gestiresti in self-hosting — la stessa immagine `rebasepro/server` pubblicata, lo stesso bundle, lo stesso Postgres. La differenza è chi lo gestisce.

:::note[Beta privata]
Rebase Cloud è in **beta privata**. Esegue tenant reali già oggi e viene aperto a
scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi seguenti richiedono un account che sia stato autorizzato ad accedere.
Tutto il resto su questo sito funziona senza di esso.
:::

## Di cosa si tratta

Un **progetto** Cloud è costituito da tre elementi che la piattaforma gestisce per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine di runtime pubblicata. I deploy consistono nel caricamento di un bundle, non nella compilazione di un container |
| **Database** | Un PostgreSQL gestito, con backup automatici e point-in-time recovery |
| **Storage** | Un bucket dedicato, se il tuo progetto utilizza l'archiviazione di file |

Ognuno di essi viene sottoposto a provisioning al primo deploy e fatturato in base a quanto riserva, anziché per utente.

**Nel tuo progetto non cambia nulla per essere eseguito lì.** Lo stesso repository può essere eseguito in self-hosting con `docker compose`, e la via d'uscita è concreta: `rebase build` genera un bundle che si avvia ovunque sia eseguibile l'immagine di runtime.

## Collegare un progetto

Da una directory di progetto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` apre la console nel browser e stampa un codice breve. Verifica che la console mostri lo stesso codice e approva l'accesso da lì: il terminale rileva la sessione e la scrive in `~/.rebase/credentials.json`. Se non hai effettuato l'accesso alla console, accedi prima lì con il metodo che preferisci, inclusi Google e GitHub. Tramite SSH, `rebase cloud login --no-browser` stampa il link da aprire sul tuo computer locale.

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono flag ed entrambi sono obbligatori — su un terminale vengono richiesti interattivamente, mentre un'esecuzione non interattiva che ometta uno dei due termina con `input_required` anziché inventarne uno. **Il sottodominio non è modificabile successivamente:** è l'host `<slug>.rebase.website` su cui il progetto risponde, quindi sceglilo con attenzione.

`--link` associa questa directory al progetto nella stessa chiamata, evitando un passaggio `link` separato. Scrive `.rebase/cloud.json`, che registra l'ID e lo slug del progetto. Questo file non è un segreto e non contiene le tue credenziali — queste ultime risiedono in `~/.rebase/credentials.json`, scritto da `login`.

Tuttavia, viene sottoposto a commit insieme al codice, consentendo a un repository clonato di indicare qualsiasi piano di controllo. Quando l'host proviene esclusivamente da quel file e non è quello proprio della piattaforma né uno a cui hai già effettuato l'accesso in precedenza, `login` ne mostra il nome e chiede conferma prima di inviarvi email e password. Senza un terminale, o con `--json`, l'operazione viene rifiutata con `unknown_control_plane`; passa `--url <host>` (o imposta `REBASE_CLOUD_URL`) per accedere intenzionalmente a quell'endpoint.

Per accedere senza browser, specifica la tua email: `rebase cloud login --email me@example.com` richiede la password. **Ti sei registrato con Google, GitHub o LinkedIn?** Il tuo account non ha una password, quindi usa invece un codice:

```bash
rebase cloud login --code --email me@example.com
```

Il piano di controllo ti invierà via email un codice a 6 cifre valido per dieci minuti, da digitare al prompt. Con `--email` e senza password, `rebase cloud login` chiede se utilizzare la password o un codice. I codici richiedono che il piano di controllo sia in grado di inviare email; in caso contrario, `--code` lo segnala ed esce con `otp_unavailable`.

Se hai attivato l'autenticazione a due fattori, `login` chiederà quindi il codice dall'app di autenticazione o uno dei codici di recupero, indipendentemente dal metodo di accesso utilizzato. Tramite browser, la console lo richiede al momento del login. Né un codice di accesso né un secondo fattore possono essere digitati senza un terminale. Per gli script, crea un token di accesso nella console (**Settings → Access tokens**) e imposta `REBASE_TOKEN`; consulta [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

Una password errata restituisce `invalid_credentials` proponendo le stesse due modalità di accesso, poiché la causa comune è un account che non ha mai avuto una password.

`billing setup` associa una carta all'organizzazione, una sola volta. È posizionato per primo nella sequenza intenzionalmente: il primo deploy di un progetto viene rifiutato in assenza di una carta, e scoprirlo dopo aver completato l'upload del bundle sarebbe l'ordine peggiore.

Successivamente, la pagina **Billing** della console elenca le fatture dell'organizzazione, ciascuna con la pagina ospitata e il PDF di Stripe, e mostra l'anteprima della fattura successiva per ciascun progetto. `rebase cloud billing invoices` e `rebase cloud billing upcoming` stampano le stesse informazioni. Entrambi sono riservati ai proprietari e agli amministratori dell'organizzazione. Dove previsto dalla piattaforma, **Manage billing** apre il portale clienti di Stripe per gestire la carta, i dati di fatturazione e le fatture passate.

Con una carta già registrata, la creazione di un altro progetto nella console non richiede un ulteriore pagamento: il progetto viene addebitato su quella carta e distribuito. Se la carta viene rifiutata, o se la banca richiede la conferma del pagamento, la console reindirizza a **Billing**, dove **Fix your card** consente di salvare un'altra carta e **Complete the payment** apre la fattura di Stripe.

I consumi di un progetto sono visibili nella sua panoramica, sotto **Usage this month**, e per tutti i progetti contemporaneamente nella pagina **Billing**: richieste rispetto alla quota inclusa (la barra diventa ambra all'80%), errori 5xx, l'eccedenza accumulata finora e la proiezione per fine mese a questo ritmo. L'eccedenza viene calcolata dallo stesso codice che la trasmette a Stripe, corrispondendo esattamente a quanto comparirà in fattura; apparirà nella fattura del mese successivo. `rebase cloud usage` stampa le stesse metriche, e `rebase cloud usage org` quelle dell'intera organizzazione. Qualsiasi membro può visualizzarle. Le cifre segnalano ciò che non possono ancora rilevare: l'object storage non viene misurato, pertanto non viene fatturata alcuna eccedenza di archiviazione; finché un progetto esegue due o più pod applicativi, le sue richieste non vengono conteggiate; e una giornata con campioni mancanti genera un sottoconteggio. Un progetto con scalabilità automatica mostra anche i pod eseguiti oltre `--replicas`, in ore-pod, il relativo costo in base alle proprie tariffe e se questa piattaforma li fattura già. Un progetto riscattato da un agente conteggia solo i giorni a partire dal riscatto: prima di tale momento, il progetto apparteneva alla piattaforma.

Un progetto esistente può essere collegato senza doverne creare uno nuovo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Un solo comando, e nessun flag da ricordare. Il file `rebase.json` dello scaffold dichiara `runtime: "managed"` per il backend, e `deploy` legge tale dichiarazione — notificandolo durante il processo (`rebase.json declares runtime: managed — deploying a bundle`), compila l'applicazione in `dist-bundle`, carica il bundle, lo esegue sull'immagine di runtime pubblicata e segue il deployment fino allo stato finale. Il codice di uscita funge da verdetto, rendendo il comando ideale per l'esecuzione automatizzata in CI.

Al termine, indica dove risponde ciascuna app e se la nuova versione è attiva su tali endpoint:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa che l'indirizzo ha risposto dopo la compilazione: l'endpoint `/health` del backend ha restituito `ok`, e la pagina dell'app statica è stata caricata (da questo deployment, quando servita dalla piattaforma). La verifica attende fino a `--live-timeout` secondi, 60 per impostazione predefinita; impostare `0` la salta. Se un'app non risponde in tempo, il comando di deploy restituisce comunque codice zero, poiché il deployment è andato a buon fine, e l'ultima riga specifica quale app non ha risposto e per quale motivo. Un deploy non riuscito termina invece con una sola riga che indica l'app e la causa dell'errore, rimandando a `rebase cloud logs` per il registro di compilazione completo.

Gli script possono passare `--json` per ottenere un singolo oggetto contenente le medesime informazioni — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e l'ID del deployment. A differenza del resto di `rebase cloud`, `deploy` non passa automaticamente all'output JSON quando utilizzato in una pipeline.

Ciò che questo runtime supporta — pacchetti e moduli nativi, memoria e istanze, timeout e dimensioni del corpo delle richieste, filesystem, segreti, storage e traffico di rete in uscita — è descritto nella pagina dedicata:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Per rilasciare un artefatto compilato in precedenza — ad esempio in un job CI che compila una volta e distribuisce due volte — punta direttamente alla directory invece di ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

L'uscita dal runtime gestito richiede il flag specifico `--eject`, e nessun altro comando lo esegue automaticamente: qualsiasi compilazione che comporterebbe il passaggio di un progetto gestito a un'immagine container autonoma viene rifiutata finché non viene esplicitamente confermata. In precedenza si utilizzava `--force`, che associava l'azione meno reversibile della CLI alla stessa parola di "sovrascrivi questo file"; ora è un'opzione sconosciuta anziché un alias, pertanto uno script che la contiene si interrompe.

### Il controllo sintattico prima dell'upload

I file di un'app statica vengono serviti esattamente come sono. Quando la fase di `build` si limita a copiare script scritti a mano in `output`, nessun parser li ha esaminati; di conseguenza, un file contenente un refuso verrebbe rilasciato in produzione, impedendo il caricamento della pagina. Pertanto, prima di caricare qualsiasi elemento, `deploy` esegue il parsing di ogni file `.js`, `.mjs` e `.cjs` nella cartella `output` di ciascuna app statica, insieme a tutti i tag `<script>` inline nei relativi file `.html`. Questo include sia le app statiche distribuite singolarmente, sia quelle integrate nel bundle del backend. Un errore di sintassi interrompe il deploy indicando file, riga e colonna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json`, il valore `code` dell'errore è `syntax_error`. Gli script inline che un browser non esegue come JavaScript vengono ignorati: JSON, import maps, template e qualsiasi altro `type` non-JavaScript, i tag `<script src>` e gli script che contengono ancora markup di template non renderizzato come `{{ }}`. Un file `.js` supera il controllo se il parsing ha esito positivo sia come script classico sia come modulo, poiché è la pagina a determinarne la natura. Nessun file all'interno di `node_modules` viene letto, così come non viene esaminata una directory precompilata con `--bundle-dir`. Il flag `--no-verify` ignora la verifica per un singolo deploy.

Monitoralo:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` segnala `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la piattaforma sta effettivamente elaborando e il polling è l'operazione corretta; quando indica un valore, significa che il sistema è in attesa di un tuo intervento.

Uno di questi è `email_not_configured`: l'app ha attivato l'accesso tramite magic link o codice email (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) ma non dispone di un servizio email configurato, con il risultato che il deployment è attivo ma nessuno può effettuare l'accesso. Rebase Cloud non invia email per conto della tua applicazione: configura `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` tramite `rebase cloud env set`, quindi esegui il deploy. `status` rileva questa condizione chiamando l'endpoint dell'app `GET /api/auth/config` (nel campo `unavailable`), e `deploy` segnala lo stesso messaggio durante il controllo di disponibilità.

## Anteprima di una modifica

```bash
rebase cloud deploy --preview
```

Questo comando compila e carica esattamente gli stessi elementi di `deploy`, ma li rende disponibili a un indirizzo dedicato, come `https://shop--k3x9ab.rebase.website`. L'ambiente di produzione continua a erogare la versione precedente. Al termine della compilazione, il deploy stampa l'indirizzo dell'anteprima.

Per mantenere lo stesso indirizzo attraverso più deploy, assegna un nome all'anteprima. Eseguendo nuovamente il deploy con lo stesso nome, l'anteprima verrà aggiornata:

```bash
rebase cloud deploy --preview-name new-checkout
```

I servizi con cui interagisce un'anteprima dipendono da ciò che è stato distribuito:

- **`rebase cloud deploy --preview`** genera l'anteprima del backend con le relative app statiche integrate, esattamente come in produzione. Ottiene un backend dedicato collegato a un **database dedicato vuoto**, mai a quello di produzione. L'avvio sul database di produzione applicherebbe ad esso lo schema e le regole di accesso dell'anteprima.
- **`rebase cloud deploy web --preview`** genererebbe l'anteprima di una singola app statica autonoma, le cui pagine chiamano il backend di **produzione**. Questo richiede un piano di controllo in grado di servire siti statici in modo indipendente, funzionalità che Rebase Cloud non offre ancora: l'operazione viene rifiutata con `PREVIEW_STATIC_UNSERVED` e non viene pubblicato nulla. È consigliabile creare invece l'anteprima del backend, che include le app statiche integrate; un progetto privo di backend gestito non può ancora essere visualizzato in anteprima.

Un'anteprima non carica codice sorgente e non registra app o nomi host, poiché ciascuna di queste azioni altererebbe il progetto di produzione. `--source` ed `--eject` non possono essere combinati con `--preview`. Entrambi compilano un'immagine container per la produzione.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` senza il flag `--preview` fa sempre riferimento alla produzione.

La pagina **Deployments** della console elenca le stesse anteprime e consente di aprirle, visualizzarne i log di compilazione o eliminarle. La creazione rimane un passaggio riservato alla CLI.

Un'anteprima scade una settimana dopo l'ultimo deploy effettuato su di essa.

Al termine, il deploy verifica che l'indirizzo dell'anteprima risponda, esattamente come avviene per un deploy di produzione (`--live-timeout <seconds>`, `0` per saltare). Il rilascio del certificato per una nuova anteprima può richiedere un minuto o due, pertanto un deploy completato con successo potrebbe segnalare che l'indirizzo non risponde ancora.

Un'anteprima di backend viene fatturata come un'unità applicativa di dimensione predefinita (100m di CPU e 384 MiB di memoria, alla tariffa della tua app per la relativa area geografica e capacità), ripartita proporzionalmente per la sua intera durata, e viene visualizzata nel preventivo mensile del progetto all'interno della console. `rebase cloud deploy --preview` stampa lo stesso preventivo mensile (`cost` con `--json`). L'avvio richiede una carta registrata, come per un deploy di produzione. Un primo deploy che fallisce prima dell'esecuzione di qualsiasi componente viene eliminato anziché fatturato. Un progetto può eseguire contemporaneamente fino a tre anteprime di backend.

Ogni nuovo indirizzo di anteprima riceve un proprio certificato TLS da Let's Encrypt, che consente fino a 50 nuovi certificati alla settimana per dominio, condivisi con tutti i siti di produzione su di esso. Le anteprime possono utilizzarne fino a 20 nell'arco di 7 giorni a livello di piattaforma. Oltre questa soglia, la richiesta di una nuova anteprima viene rifiutata (`429`, `preview_cert_budget`) indicando il momento in cui sarà possibile procedere; il redeploy di un'anteprima già esistente non viene mai conteggiata nel limite.

Il database di un'anteprima di backend è un secondo database sull'istanza Postgres di **produzione**: contiene dati propri, ma condivide la stessa istanza e lo stesso disco. È limitato a 10 connessioni, per evitare che le anteprime esauriscano le connessioni della produzione, e a 2 GB: un'anteprima il cui database supera tale dimensione viene messa in pausa. Il suo backend si arresta, l'indirizzo smette di rispondere, `rebase cloud previews` e la console la mostrano come `paused` indicandone il motivo, e i proprietari e gli amministratori del progetto ricevono una notifica (`preview.paused`). I dati vengono conservati fino alla scadenza. È possibile ridistribuirla per riavviarla (ma tornerà in pausa se il database è ancora troppo grande) oppure eliminarla. Un'anteprima in pausa continua a essere fatturata finché non viene eliminata o scade. Elimina le anteprime che non ti servono più. Le estensioni installate in produzione non vengono installate nel database di un'anteprima.

Le anteprime sono in fase di rilascio graduale. Un piano di controllo che non le supporta ancora rifiuterà `--preview` con `previews_unavailable` senza distribuire nulla.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback reindirizza il progetto verso ciò che era stato distribuito da un precedente deployment riuscito, senza mai ricompilare — il vantaggio del rollback risiede proprio nel rilascio di un artefatto già precedentemente eseguito.

I deployment idonei dipendono dalla modalità di deploy del progetto; entrambe le tipologie sono supportate:

| Modalità di deploy | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (compilazione da sorgente) | L'immagine pubblicata da quella compilazione |
| `rebase cloud deploy --bundle` (runtime della piattaforma) | Il bundle distribuito da quel deploy, sulla versione del runtime attualmente in esecuzione |

Le app statiche integrate nel bundle del backend (un normale `rebase cloud deploy` su un progetto con un backend) fanno parte di tale bundle, quindi vengono ripristinate insieme ad esso.

Un'app statica distribuita singolarmente (`rebase cloud deploy <app>`) non può ancora essere ripristinata tramite rollback. Il suo deployment registra l'app pubblicata, ma nessun bundle, pertanto il piano di controllo non ha alcun elemento da cui ripristinarla. La soluzione consiste nel ridistribuire l'ultima versione funzionante, ad esempio dal commit precedente a quello problematico. Dopo un simile deploy, `deploy` segnala questa circostanza anziché suggerire `rollback`, e `rollback` senza un ID rifiuta l'operazione anziché ridistribuire il backend attualmente attivo.

Di conseguenza, un rollback richiede un deployment che abbia registrato uno dei due elementi, il che presuppone un progetto distribuito con successo almeno due volte. `rebase cloud deployments` contrassegna quelli idonei e `--json` riporta `rollbackable` per ciascuna riga insieme a `image` o `bundle` che verrebbero ripristinati.

Due tipologie di deployment vengono rifiutate, e la CLI ne specifica il motivo: un deployment non riuscito e uno antecedente al momento in cui la piattaforma ha iniziato a registrare gli artefatti. Non c'è spazio per congetture in nessuno dei due casi — tirare a indovinare comporterebbe la distribuzione di qualunque elemento sia stato compilato o caricato più di recente, pretendendo di ripristinare quello selezionato; distribuisci invece direttamente la versione desiderata.

Ogni deploy riuscito si conclude indicando il comando per tornare indietro (`rebase cloud rollback`), rendendolo immediatamente visibile qualora ci si accorga di un rilascio errato.

Un rollback aggiunge un nuovo deployment anziché riscrivere la cronologia, e attende che la versione ripristinata sia attiva prima di confermare il successo dell'operazione. Puoi seguirne l'avanzamento con `rebase cloud logs -f`.

## Ripristinare il database a un momento specifico nel tempo

Un database gestito può essere ripristinato a qualsiasi minuto all'interno della finestra di recovery, dalla sezione **Database → Backups** della console o tramite CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
La procedura si articola in due passaggi. Innanzitutto viene predisposta una copia ripristinata accanto al database attivo; l'applicazione continua a funzionare su quest'ultimo e lo storage della copia viene fatturato fino al cutover o all'eliminazione.
Successivamente, non appena la copia è pronta, il cutover reindirizza l'applicazione verso di essa e la riavvia. Tutto ciò che è stato scritto dopo l'orario di destinazione non sarà presente nella copia. Il database originale viene conservato come punto di ripristino di sicurezza e continua a essere fatturato per lo storage; il ripristino all'originale, la sua rimozione o un secondo restore richiedono l'intervento del supporto. Solo un proprietario o un amministratore può predisporre la copia, eseguire il cutover o eliminarla, e la console richiede la conferma del nome del progetto prima di procedere al cutover.

## Proteggere il proprio account

Il tuo account della console ha accesso ai database di produzione, ai segreti e alla fatturazione, pertanto va protetto adeguatamente. Apri **Account security** dal menu sotto il tuo avatar nella console (oppure vai su `/account`). La pagina è personale e non appartiene a un'organizzazione specifica: le impostazioni definite qui si applicano a tutte le organizzazioni di cui fai parte.

- **Verifica in due passaggi.** Attivala con qualsiasi app di autenticazione (1Password, Google Authenticator, Authy). La pagina mostra una chiave di configurazione da aggiungere all'app o un link che apre l'app su uno smartphone con la chiave già precompilata, per poi richiedere il codice a 6 cifre mostrato dall'app. Da quel momento in poi, ogni accesso richiederà un codice, sia che si acceda tramite password, Google o GitHub.
- **Codici di recupero.** L'attivazione fornisce dieci codici monouso, mostrati una sola volta. Ciascuno di essi consente di accedere al posto del codice dell'authenticator in caso di smarrimento dello smartphone; salvali prima di chiudere la finestra di dialogo. L'opzione **New recovery codes** li sostituisce rendendo inutilizzabili i precedenti. Sia la disattivazione della verifica in due passaggi sia la generazione di nuovi codici richiedono prima l'inserimento di un codice valido.
- **Password.** La modifica della password comporta la disconnessione da tutti gli altri dispositivi. Un account creato con Google, GitHub o LinkedIn non dispone di alcuna password; la pagina consente di ricevere un link via email per impostarne una.
- **Dispositivi connessi.** Ogni browser e terminale connesso al tuo account, con relativo indirizzo e data/ora di accesso. Puoi disconnettere qualsiasi dispositivo che non riconosci o tutti contemporaneamente.

I [token di accesso](/docs/deployment/cloud-agents/#ci-and-agents) non sono sessioni e non richiedono un secondo fattore, consentendo alla CI di continuare i deploy anche dopo l'attivazione della verifica in due passaggi. Puoi revocare un token non più attendibile in **Settings → Access tokens**.

## Invitare il proprio team

La sezione **Members → Invite member** genera un link da copiare (inviato via email quando il piano di controllo è configurato per l'invio di posta) valido per un solo utilizzo, per 7 giorni, destinato a un account che abbia verificato tale indirizzo; nessuno entra a far parte dell'organizzazione finché l'invito non viene accettato. Puoi invitare un amministratore o un membro, e promuoverlo a proprietario una volta entrato. Proprietari e amministratori possono visualizzare, reinviare o revocare l'invito in **Pending invitations**; da terminale è possibile usare [`rebase cloud orgs members invite`](/docs/cli/cloud/#organizations).

## Verificare chi ha fatto cosa

La pagina **Activity** della console e il comando `rebase cloud activity` mostrano ai proprietari e agli amministratori dell'organizzazione chi ha effettuato un deploy, impostato o visualizzato una variabile d'ambiente (per nome, mai per valore), modificato un dominio, ripristinato un backup, ridimensionato, arrestato o eliminato un progetto, modificato il ruolo di un membro o creato un token, specificando quando è avvenuto. La sezione **Settings** di un progetto rimanda alle proprie voci; le voci relative a un progetto eliminato vengono comunque conservate. Uno script può leggerle utilizzando un token creato con `--can audit` sull'organizzazione. Le registrazioni vengono conservate per un anno. I filtri disponibili sono descritti in [`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agenti

Un job CI o un agente non dovrebbero mai contenere la tua password. Assegna piuttosto un token limitato a poche azioni specifiche su un singolo progetto, creato da un terminale autenticato con `rebase cloud tokens create --project shop --can deploy,logs`, e impostalo come `REBASE_TOKEN`. La fatturazione, il log delle attività e le impostazioni di notifica dell'organizzazione sono capability specifiche (`--can billing`, `audit`, `notifications`) che un token include solo se espressamente richiesto. L'elenco delle capability, un workflow per GitHub Actions e le operazioni riservate a una persona autenticata sono disponibili in [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend senza account

`rebase cloud init --claim` fornisce a un'applicazione un backend attivo prima ancora che qualcuno si sia registrato, stampando un URL di riscatto per permettere all'utente di mantenerlo; un progetto che nessuno riscatta entro 72 ore viene eliminato. I permessi del token di un progetto non riscattato, il valore `REBASE_API_TOKEN` che scrive e le modifiche apportate dal riscatto sono descritti in [Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Risorse di calcolo e relativi costi

Il prezzo di un progetto viene calcolato in base alle risorse riservate, non in base a piani tariffari a scaglioni. Il comando `compute` mostra ogni parametro di configurazione e il relativo preventivo dettagliato elaborato dal piano di controllo. (`rebase cloud resources` è un comando differente: elenca i database e i bucket dichiarati dal codice e se ciascuno di essi è stato sottoposto a provisioning — vedi la [documentazione di riferimento della CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Richiesta dell'app per istanza, ad es. `500m` e `2Gi`. Se vuoto, viene utilizzato il valore predefinito della piattaforma — `100m` e `384Mi`, con burst fino a 2 CPU e `2Gi` |
| `--replicas` | Istanze sempre attive: la soglia minima dell'autoscaler e la quota fatturata mensilmente dall'abbonamento del progetto |
| `--autoscale-max` | 1–16. Il limite massimo raggiungibile. Le istanze aggiunte dall'autoscaler oltre `--replicas` sono conteggiate al secondo per pod alle stesse tariffe, e addebitate solo dove la piattaforma ha abilitato tale opzione; la sezione **Usage this month** ne indica lo stato. `--no-autoscale` lo disattiva |
| `--autoscale-cpu-target` | 10–95. L'utilizzo della CPU che l'autoscaler mira a mantenere, calcolato rispetto alla richiesta anziché al limite. Se vuoto, il valore predefinito è 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica, ma soggetta a riavvio senza preavviso |
| `--db-instances` | 1–3. `1` corrisponde a una singola istanza senza failover; `2` aggiunge uno standby automatico |
| `--db-cpu`, `--db-memory` | Per istanza di database. Se vuoto, i valori predefiniti sono `160m` e `1Gi` |

Un parametro lasciato vuoto non equivale a uno impostato esplicitamente sullo stesso valore numerico: un parametro vuoto segue il valore predefinito della piattaforma e si aggiorna automaticamente qualora quest'ultimo dovesse cambiare.

La CLI non esegue alcuna convalida preventiva, intenzionalmente: i limiti dipendono dal cluster su cui viene eseguito il progetto e variano in base al provider. Il piano di controllo rifiuta qualsiasi valore che non sia in grado di soddisfare, specificando il campo interessato. Esegui `rebase cloud compute` per visualizzare il costo in €/mese prima e dopo la modifica; le variazioni si applicano immediatamente con calcolo proporzionale a partire dalla data odierna, ad eccezione di quelle che comportano il riavvio del database, le quali vengono posticipate alla finestra di manutenzione.

## Il resto dei comandi

| Gruppo di comandi | Cosa include |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | La sessione; `access-token` stampa il token bearer che la CLI invierebbe attualmente, utile per gli script e per il server MCP |
| `tokens` | Token per CI e agenti, ciascuno limitato a un singolo progetto. Consulta [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Associazione di questa directory a un progetto, selezione di un'organizzazione, apertura della console |
| `connect` | Aggiunta di un server Rebase self-hosted al tuo account, in modo che il [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude possa raggiungerlo accanto ai tuoi progetti Cloud. `--list` li mostra, `--remove` ne rimuove uno. Proprietari e amministratori |
| `init`, `claim` | Con `--claim`: un backend attivo senza account e un link per riscattarlo; `claim` stampa nuovamente tale link. Consulta [Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Creazione, visualizzazione elenco, ispezione ed eliminazione |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Rilascio e monitoraggio |
| `deploy-hooks` | URL segreti richiamati da un host git o dalla CI per distribuire il progetto: elenco, creazione (l'URL viene mostrato una sola volta) e revoca. |
| `previews` | Build erogate su un indirizzo dedicato tramite `deploy --preview`, e la loro eliminazione. Consulta [Anteprima di una modifica](#anteprima-di-una-modifica) |
| `start`, `stop`, `restart` | Sospensione di un progetto e riattivazione. Un progetto arrestato mantiene la sua sottoscrizione, a meno che la piattaforma non fatturi per i progetti arrestati solo lo storage e la tariffa di piattaforma; la riga **Billing** della console lo specifica quando applicabile |
| `status`, `metrics`, `debug` | Cosa sta facendo il sistema e perché non risponde |
| `alerts` | Gli incidenti aperti del progetto, con possibilità di prenderne atto o posticiparli. |
| `cron` | I cron job dell'applicazione distribuita e le relative esecuzioni registrate, consultabili con il tuo login `rebase cloud`. Sola lettura |
| `env` | Variabili d'ambiente. `list` non stampa mai i valori; `--secret` è di sola scrittura |
| `app-key` | La chiave scritta da `init --claim` in `.env` come `REBASE_API_TOKEN`, trasferita al momento del riscatto; `rotate` la sostituisce revocando la precedente. Proprietari e amministratori |
| `service-key` | `REBASE_SERVICE_KEY`, con permessi di amministratore sull'API dell'app: data/ora dell'ultima rotazione; `rotate` ne assegna una nuova all'app. Proprietari e amministratori |
| `domains` | Domini personalizzati, record DNS da aggiungere e verifica. Un progetto può rispondere su più domini, ciascuno verificato singolarmente; `verify` e `remove` accettano il dominio su cui intervenire, che può essere omesso solo quando ce n'è uno solo (per `verify`, uno ancora in sospeso). Ogni dominio verificato serve il progetto come tale; `primary <domain>` imposta quello canonico e `redirect <domain>` risponde su un altro con un reindirizzamento 308 verso di esso, mantenendo path e query (`--off` torna a servirlo direttamente) — operazione consigliata per `www.` accanto al dominio apex, poiché l'accesso con Google, i cookie e le passkey sono legati all'origine. Un dominio su cui è servita una singola app (un `path` di un'app associato a un hostname) non esegue mai redirect. `list --json` restituisce `{ projectId, tenantHost, domains: [...] }` |
| `db` | Collegamento o creazione di un database, connessione locale dal proprio computer, backup, ripristino e point-in-time recovery |
| `guests` | Gli utenti guest generati dall'accesso anonimo: conteggio, eliminazione di singoli utenti e rimozione di quelli inattivi da lungo tempo. Consulta [Guests](/docs/cli/cloud/#guests). Proprietari e amministratori |
| `extensions` | L'allowlist delle estensioni Postgres |
| `storage` | Il bucket del progetto |
| `resources` | Quali database e bucket sono gestiti dalla piattaforma rispetto a quanto dichiarato dal codice |
| `compute` | Risorse riservate da questo progetto, relativi costi e modalità di modifica |
| `events` | Eventi del backend in ordine decrescente: scalabilità dell'app, modifiche pianificate e applicate al database, subentro di uno standby, espansione del disco |
| `usage` | Richieste utilizzate questo mese rispetto alla quota inclusa ed eccedenza maturata finora, come conteggiato in fattura. `usage org` elenca tutti i progetti dell'organizzazione |
| `clusters` | I cluster su cui vengono eseguiti i tenant. Riservato agli amministratori della piattaforma |
| `settings`, `orgs`, `billing` | Impostazioni di progetto, organizzazioni con relativi membri e inviti, pagamenti |
| `activity` | Audit log dell'organizzazione: chi ha effettuato deploy, modificato variabili d'ambiente (per nome), domini, backup, membri o token. Proprietari e amministratori. Consulta [Verificare chi ha fatto cosa](#verificare-chi-ha-fatto-cosa) |
| `notifications` | Destinazioni a cui inviare via POST gli eventi del progetto: Slack, Discord o qualsiasi URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Ogni gruppo in questa tabella risponde a `--help` con una pagina dedicata — una sintassi di utilizzo, i relativi flag ed esempi — e `--help` non esegue mai il comando. Un test verifica l'indice delle pagine, quindi un gruppo aggiunto senza di essa causa il fallimento della build anziché rispondere con il sommario. `verify:docs` vincola la tabella stessa a tale indice: ogni gruppo gestito dalla CLI compare qui esattamente una volta, pertanto l'aggiunta di un gruppo senza la relativa riga provocherà anch'essa il fallimento della build.

In una pipeline, `--help` risponde invece in formato JSON: la stessa riga di utilizzo, flag ed esempi strutturati per la lettura automatica anziché sessanta righe di sequenze di escape da terminale.

## Cosa non include la beta

Detto chiaramente, perché scoprirlo in seguito sarebbe peggio:

- **Nessuna scelta della regione.** Attualmente tutto viene eseguito in un'unica regione. Il modello di posizionamento esiste nella piattaforma, ma un progetto non può selezionare una regione. `projects create --provider` e `--region` non costituiscono l'eccezione che potrebbero sembrare: registrano a quale dei target di deploy registrati del piano di controllo appartiene un progetto; esistendone solo uno, entrambi assumono tale valore come predefinito e nessuno dei due sposta il progetto altrove. `rebase cloud projects create --help` riporta la medesima indicazione.
- **Non è self-service.** L'accesso viene concesso a scaglioni; non è prevista una registrazione immediata con pagamento autonomo.
- **Nessun SLA pubblicato** e nessuna certificazione SOC 2. Se hai bisogno di uno dei due, segnalalo al momento della richiesta di accesso anziché darlo per scontato.
- **Nessun deploy per branch** e nessuna GitHub App di prima parte. I deploy hook — URL segreti verso cui puntare un webhook del repository — rappresentano l'automazione supportata. I [deploy di anteprima](#anteprima-di-una-modifica) sono in fase di rilascio e vengono avviati dalla CLI.
- **I token agiscono per conto di una persona.** Un [token](/docs/deployment/cloud-agents/#ci-and-agents) viene generato da un account e ne assume l'identità; non esiste ancora un'identità macchina di proprietà dell'organizzazione. Se invece effettui l'accesso da CI, passa `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` da un gestore di segreti — il flag `--password` inserisce la password nella cronologia della shell e nella tabella dei processi, avvisandoti prima di completare il login. Se il file `.rebase/cloud.json` del repository fa riferimento a un piano di controllo diverso da quello proprio della piattaforma, passalo anche tramite `--url`: in assenza di un terminale, `login` si rifiuta di inviare una password a un host indicato unicamente dal file estratto dal repository.
- **Nessun endpoint pubblico per il database.** Un database gestito non è esposto a Internet, pertanto l'host mostrato dalla console è l'indirizzo interno utilizzato dal backend e non è risolvibile dal tuo computer locale. `rebase cloud db connect` apre una porta locale collegata al database, incanalata tramite tunnel attraverso il piano di controllo, per tutto il tempo in cui viene mantenuta attiva — tuttavia non esiste un hostname permanente a cui un servizio di terze parti possa connettersi. Per eseguire query SQL senza un client Postgres locale, `rebase cloud db query "<sql>"` o `rebase cloud db query --file file.sql` apre lo stesso tunnel per una singola query, esegue il testo come un unico script (interrompendosi al primo errore) e stampa la risposta di ciascuna istruzione (`--json` per l'uso negli script). Quel tunnel e la password visibile tramite `rebase cloud db info --reveal` richiedono entrambi il ruolo di proprietario o amministratore dell'organizzazione: lo stesso richiesto dall'editor SQL di Studio, poiché in tutti e tre i casi si accede a una sessione sui dati di produzione.
- **Effettuare un deploy equivale a eseguire codice con i segreti di produzione.** L'ambiente dell'applicazione contiene `REBASE_SERVICE_KEY` (amministratore sulla propria API), `DATABASE_URL` e `JWT_SECRET`, quindi il codice distribuito da un membro può leggerli, anche se solo i proprietari e gli amministratori possono visualizzarli nella console. Invita come membro solo persone a cui affideresti tali valori.
- **La service key può essere sostituita.** Dalla sezione **Settings** del progetto (o tramite `rebase cloud service-key rotate`) viene emessa una nuova `REBASE_SERVICE_KEY` e l'applicazione viene riavviata con essa. La vecchia chiave rimane valida solo fino al completamento del riavvio e non oltre, pertanto qualsiasi servizio che l'abbia memorizzata verrà rifiutato da quel momento in poi. Il riscatto di un progetto esegue la medesima operazione.

## Scegliere invece il self-hosting

Nessun elemento descritto qui comporta un vincolo. La [guida al self-hosting](/docs/deployment/self-hosting/) esegue la medesima immagine e bundle con `docker compose`, e la [guida a Kubernetes](/docs/deployment/kubernetes/) riproduce la stessa topologia a partire dall'Helm chart.
