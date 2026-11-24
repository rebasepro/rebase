---
sourceHash: f25a8ca7c4ed5faf
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Cos'è, come collegare e distribuire un progetto e cosa non include ancora la beta privata.
---

Rebase Cloud esegue lo stesso Rebase open source che ospiteresti in autonomia: la stessa
immagine pubblicata `rebasepro/server`, lo stesso bundle, lo stesso Postgres. La
differenza sta in chi lo gestisce.

:::note[Beta privata]
Rebase Cloud è in **beta privata**. Esegue tenant reali già oggi e apre l'accesso
a scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi sottostanti richiedono un account che sia stato abilitato.
Tutto il resto su questo sito funziona senza di esso.
:::

## Cos'è

Un **progetto** Cloud è composto da tre elementi gestiti dalla piattaforma per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine di runtime pubblicata. I deploy consistono nel caricamento di un bundle, non nella compilazione di un container |
| **Database** | Un PostgreSQL gestito, con backup automatici e point-in-time recovery |
| **Storage** | Un bucket dedicato su [Rebase Storage](/docs/deployment/rebase-storage/), se il tuo progetto utilizza l'archiviazione di file |

L'app e il database vengono sottoposti a provisioning al tuo primo deploy; un bucket solo
quando ne fai richiesta ([Archiviazione file](#archiviazione-file)). Ognuno di essi viene fatturato in base a quanto
riserva anziché per postazione utente.

**Non cambia nulla nel tuo progetto per poter essere eseguito lì.** Lo stesso repository
può essere ospitato in modalità self-hosted con `docker compose`, e la via d'uscita è concreta: `rebase build`
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
rileva la sessione e la scrive in `~/.rebase/credentials.json`. Se non hai
effettuato l'accesso alla console, accedi prima lì con il metodo che preferisci,
inclusi Google e GitHub. Tramite SSH, `rebase cloud login --no-browser` stampa il link
da aprire sulla tua macchina locale.

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono
flag ed entrambi sono obbligatori: su un terminale vengono richiesti in modo interattivo, mentre
un'esecuzione non interattiva (headless) che ne ometta uno termina con `input_required` anziché inventarne
uno. **Il sottodominio non è modificabile successivamente:** è l'host
`<slug>.rebase.website` su cui risponde il progetto, quindi sceglilo con cura.

`--link` collega questa directory al progetto nella stessa chiamata, eliminando la necessità di un
passaggio `link` separato. Scrive `.rebase/cloud.json`, che registra l'ID del progetto
e lo slug. Quel file non è un segreto e non rappresenta le tue credenziali, le quali si trovano
in `~/.rebase/credentials.json`, scritte da `login`.

Viene tuttavia sottoposto a commit con il codice, perciò un repository clonato può indicare qualsiasi
control plane. Quando l'host proviene esclusivamente da quel file e non corrisponde né a quello
proprietario della piattaforma né a uno a cui hai effettuato l'accesso in precedenza, `login` ne mostra il nome e chiede
conferma prima di inviare lì la tua email e la password. Senza un terminale, o con
`--json`, l'operazione viene rifiutata con `unknown_control_plane`; passa `--url <host>` (o imposta
`REBASE_CLOUD_URL`) per accedere intenzionalmente a quell'indirizzo.

Per accedere senza browser, passa la tua email: `rebase cloud login --email
me@example.com` richiede la password. **Hai effettuato la registrazione con Google, GitHub o
LinkedIn?** Il tuo account non possiede una password, quindi usa un codice:

```bash
rebase cloud login --code --email me@example.com
```

Il control plane ti invierà via email un codice a 6 cifre, valido per dieci minuti, da digitare
al prompt. Con `--email` e nessuna password, `rebase cloud login` ti chiederà
se desideri usare la password o un codice. I codici richiedono che il control plane sia in grado di inviare
email; in caso contrario, `--code` lo segnala ed esce con `otp_unavailable`.

Se hai abilitato l'autenticazione a due fattori, `login` richiederà quindi il codice dalla
tua app di autenticazione o uno dei tuoi codici di recupero, indipendentemente dal metodo usato per accedere.
Tramite browser, la console lo richiede al momento del login. Né un codice di accesso né un secondo fattore possono essere digitati senza un terminale.
Per uno script, crea un access token nella console (**Settings → Access
tokens**) e imposta `REBASE_TOKEN`; consulta [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

Una password errata risponde con `invalid_credentials` offrendo le stesse due modalità di accesso, poiché
la causa più comune è un account a cui non ne è mai stata assegnata una.

`billing setup` associa una carta all'organizzazione, una sola volta. È posta per prima
nella sequenza intenzionalmente: il primo deploy di un progetto viene rifiutato senza di essa, e
scoprirlo dopo che l'upload del bundle è stato completato sarebbe l'ordine peggiore.

Successivamente, la pagina **Billing** della console elenca le fatture dell'organizzazione,
ciascuna con la relativa pagina ospitata e il PDF di Stripe, e visualizza l'anteprima della fattura successiva per ciascun
progetto. `rebase cloud billing invoices` e `rebase cloud billing upcoming`
stampano le stesse informazioni. Entrambi i comandi sono riservati a proprietari e amministratori dell'organizzazione. Dove
la piattaforma lo offre, **Manage billing** apre il portale clienti di Stripe per gestire la
carta, i dettagli di fatturazione e le fatture passate.

Con una carta già registrata, la creazione di un altro progetto nella console non richiede
alcun secondo pagamento: il progetto viene fatturato su quella carta e distribuito. Se la carta
viene rifiutata o la banca richiede la conferma del pagamento, la console ti reindirizza a
**Billing**, dove **Fix your card** permette di salvare un'altra carta e **Complete the
payment** apre la fattura di Stripe.

L'utilizzo di un progetto è visibile nella relativa panoramica, sotto **Usage this month**, e
per tutti i progetti contemporaneamente nella pagina **Billing**: richieste rispetto alla
soglia inclusa (la barra diventa arancione all'80%), errori 5xx, l'eccedenza maturata finora
e la proiezione a fine mese con questo ritmo. L'eccedenza viene calcolata dallo
stesso codice che la comunica a Stripe, pertanto coincide con quanto sarà riportato in fattura;
compare nella fattura del mese successivo. `rebase cloud usage` stampa le
stesse metriche, e `rebase cloud usage org` mostra quelle dell'intera organizzazione. Qualsiasi membro può visualizzarle. Le cifre indicano ciò che non possono ancora contabilizzare: l'object storage viene misurato ma
non ancora fatturato ([Rebase Storage](/docs/deployment/rebase-storage/) ne indica
il prezzo); fintanto che un progetto esegue due o più pod applicativi,
le relative richieste non vengono conteggiate; e un giorno con campionamenti mancati risulterà sottostimato. Un
progetto autoscalato mostra anche i pod eseguiti oltre `--replicas`, in ore-pod,
il loro costo secondo le proprie tariffe e se questa piattaforma li fattura già. Un
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

Un singolo comando, senza flag da memorizzare. Il file `rebase.json` generato dallo scaffold dichiara
`runtime: "managed"` per il proprio backend, e `deploy` legge tale dichiarazione;
lo segnala durante l'esecuzione (`rebase.json declares runtime: managed — deploying a
bundle`), compila l'applicazione in `dist-bundle`, carica il bundle, lo esegue sull'immagine
di runtime pubblicata e segue il deployment fino a uno stato terminale. Il codice di uscita
rappresenta l'esito finale, quindi la stessa riga funziona in modo non presidiato in CI.

Termina indicando dove risponde ciascuna app e se la nuova versione è
attiva lì:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa che l'indirizzo ha risposto dopo la build: l'endpoint `/health` del backend ha
restituito `ok` e la pagina dell'app statica è stata caricata (da questo deployment, quando
la piattaforma la serve). Il controllo attende fino a un massimo di `--live-timeout` secondi, 60 per
impostazione predefinita; `0` lo salta. Se un'app non risponde in tempo, il deploy termina comunque con codice
zero, poiché il deployment è andato a buon fine, e l'ultima riga indica quale app non ha
risposto e perché. Un deploy fallito termina invece con una sola riga, indicando l'app e il
motivo, con `rebase cloud logs` a disposizione per il log di compilazione completo.

Gli script possono passare `--json` per ottenere un singolo oggetto contenente le stesse informazioni: `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` e l'ID del deployment. A differenza del resto di
`rebase cloud`, `deploy` non passa automaticamente a JSON quando usato tramite pipe.

Ciò che tale runtime consente — pacchetti e moduli nativi, memoria e istanze,
timeout e dimensioni del body, filesystem, segreti, storage e rete in
uscita — è descritto nella pagina dedicata:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Per rilasciare un artefatto compilato in precedenza — ad esempio, un job CI che compila una volta e
distribuisce due volte — punta direttamente alla directory anziché ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Uscire dal runtime gestito richiede un flag apposito, `--eject`, e nessun altro comando lo
richiede: una build che sposterebbe un progetto gestito su un'immagine container che esso stesso
governa viene rifiutata finché non lo specifichi espressamente. In precedenza si usava `--force` per questo scopo, assegnando
all'operazione meno reversibile della CLI la stessa dicitura di "sovrascrivi questo
file"; ora è un'opzione sconosciuta anziché un alias, così uno script che la contiene
si arresta.

### Il controllo sintattico prima dell'upload

I file di un'app statica vengono serviti esattamente come sono. Quando il relativo comando `build` si limita a
copiare script scritti a mano in `output`, nessun parser li ha esaminati, per cui un file
con un refuso andrebbe online impedendo il caricamento della pagina. Pertanto, prima che qualsiasi
cosa venga caricata, `deploy` analizza sintatticamente ogni file `.js`, `.mjs` e `.cjs` nell'`output` di ciascuna app
statica, insieme a ogni tag `<script>` inline nei suoi file `.html`. Questo
include sia le app statiche distribuite autonomamente sia quelle integrate nel bundle del
backend. Un errore di sintassi blocca il deploy riportando file, riga e colonna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json` il `code` dell'errore è `syntax_error`. Gli script inline che un browser
non esegue come JavaScript vengono ignorati: JSON, import map, template e qualsiasi
altro `type` non JavaScript, un tag `<script src>` e uno script che contiene ancora
markup di template non renderizzato come `{{ }}`. Un file `.js` è ritenuto valido se viene interpretato correttamente
come script classico o come modulo, poiché è la pagina a determinare quale sia. Nulla
sotto `node_modules` viene letto, così come non viene letta una cartella `--bundle-dir` già compilata.
`--no-verify` ignora il controllo per un singolo deploy.

Monitoraggio:

```bash
rebase cloud logs               # il log di build
rebase cloud logs --runtime -f  # l'output dell'app in esecuzione, live, fino a Ctrl-C
rebase cloud status             # lo stato del progetto secondo la piattaforma
```

`status` riporta i campi `blockedOn` e `nextAction`. Quando `blockedOn` è `null` la
piattaforma sta effettivamente lavorando ed è opportuno eseguire il polling; quando invece indica
un elemento, quell'elemento è in attesa di una tua azione.

Uno di questi è `email_not_configured`: l'app ha abilitato l'accesso tramite magic-link o codice
email (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) ma non dispone di un servizio email configurato, quindi
il deployment è attivo ma nessuno può effettuare il login. Rebase Cloud non invia
email per conto della tua app: imposta `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e
`SMTP_FROM` con `rebase cloud env set`, quindi effettua nuovamente il deploy. `status` ricava questo stato
dall'endpoint `GET /api/auth/config` dell'app stessa (dal campo `unavailable`), e `deploy` mostra
la stessa informazione nel proprio controllo live.

## Più di un database

Dichiara ciascuno (`database("analytics")`) ed effettua il deploy: viene creato sul server del progetto come
`DATABASE_URL__ANALYTICS` e ne condivide risorse e fattura ([dettagli](/docs/backend/multiple-sources/#on-rebase-cloud)).

## Archiviazione file

Un nuovo progetto non ha alcun bucket: i caricamenti vengono rifiutati con `501 STORAGE_NOT_CONFIGURED`,
e il riepilogo del deploy lo segnala, anziché salvare i file su un disco che ogni deploy sovrascriverebbe.

Assegnagli uno dei due tipi supportati, quindi effettua nuovamente il deploy in modo che l'app lo rilevi:

```bash
# Un bucket gestito da Rebase per te. La pagina Storage della console fa la stessa cosa.
rebase cloud storage create

# Oppure il tuo bucket compatibile con S3: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omettere per AWS; aggiungere --force-path-style per MinIO

rebase cloud deploy
```

`rebase cloud storage` elenca i bucket del progetto; ogni `bucket("media")` dichiarato ottiene il proprio ([Database e bucket multipli](/docs/backend/multiple-sources/#on-rebase-cloud)).
Con bucket propri, collega ciascuno con `--source <key>`; uno che configura lo storage via codice non necessita di nessuno dei due.

## Anteprima di una modifica

```bash
rebase cloud deploy --preview
```

Questo comando compila e carica esattamente ciò che farebbe `deploy`, ma lo serve a un indirizzo
proprio, come `https://shop--k3x9ab.rebase.website`. La produzione continua
a servire ciò che serviva prima. Il deploy stampa l'indirizzo della preview al termine della
compilazione.

Per mantenere lo stesso indirizzo attraverso più deploy, assegna un nome alla preview. Distribuendo nuovamente
con lo stesso nome la si aggiornerà:

```bash
rebase cloud deploy --preview-name new-checkout
```

I servizi con cui interagisce una preview dipendono da cosa hai distribuito:

- **`rebase cloud deploy --preview`** genera un'anteprima del backend, con le sue app statiche
  integrate, esattamente come le esegue la produzione. Ottiene un backend dedicato su
  un **proprio database vuoto**, mai quello di produzione. L'avvio sul database
  di produzione vi applicherebbe lo schema e le regole di accesso della preview.
- **`rebase cloud deploy web --preview`** genererebbe un'anteprima di una singola app statica
  in modo autonomo, le cui pagine chiamano il backend di **produzione**. Questa funzionalità richiede un control plane
  in grado di servire siti statici a sé stanti, cosa che Rebase Cloud non fa ancora:
  rifiuta l'operazione con `PREVIEW_STATIC_UNSERVED` e non pubblica nulla. Effettua invece la preview
  del backend, che serve le app statiche in esso integrate; un progetto
  privo di backend gestito non può ancora essere visualizzato in anteprima.

Una preview non carica codice sorgente e non registra app o hostname, poiché ciascuna
di queste operazioni modificherebbe il progetto di produzione. `--source` ed `--eject` non possono essere
combinati con `--preview`. Ognuno di essi compila un'immagine container per la produzione.

```bash
rebase cloud previews                      # nome, indirizzo, app, backend, scadenza
rebase cloud logs --preview new-checkout   # log di compilazione; -f segue una compilazione in corso
rebase cloud logs --runtime --preview new-checkout -f  # output generato dal relativo backend
rebase cloud previews delete new-checkout  # interrompe l'erogazione ed elimina il relativo database
```

Il comando `rebase cloud logs` privo di `--preview` fa sempre riferimento alla produzione.

La pagina **Deployments** della console elenca le stesse anteprime e consente di aprirle, visualizzarne il
log di compilazione o eliminarle. La loro creazione rimane un passaggio da CLI.

Una preview scade una settimana dopo l'ultimo deploy effettuato su di essa.

Al termine, il processo di deploy verifica che l'indirizzo della preview risponda, esattamente come avviene
per un deploy in produzione (`--live-timeout <seconds>`, `0` per saltare). L'emissione del certificato per una nuova
preview può richiedere uno o due minuti, perciò un deploy riuscito potrebbe
segnalare che l'indirizzo non risponde ancora.

Una preview di backend viene fatturata come una singola unità applicativa di dimensione predefinita (100m di CPU
e 384 MiB di memoria, alla tariffa della tua app per la relativa regione e capacità),
ripartita proporzionalmente per la sua durata effettiva, e compare nel
preventivo mensile del progetto nella console. `rebase cloud deploy --preview` stampa la stessa stima
per essa, su base mensile (`cost` sotto `--json`). L'avvio di una preview richiede una carta registrata, come
per un deploy di produzione. Un primo deploy che
fallisce prima che venga avviato qualcosa viene rimosso anziché fatturato. Un progetto può eseguire
fino a tre preview di backend contemporaneamente.

Ogni nuovo indirizzo di preview riceve un proprio certificato TLS da Let's Encrypt,
il quale concede a un dominio 50 nuovi certificati alla settimana, condivisi con tutti i siti di produzione
su di esso. Le anteprime possono utilizzarne fino a 20 ogni 7 giorni, sull'intera piattaforma. Oltre
tale soglia, una nuova preview viene rifiutata (`429`, `preview_cert_budget`) indicando l'orario a partire dal quale
sarà possibile distribuirla; il redeploy di una preview già esistente non viene mai conteggiato.

Il database di una preview di backend è un secondo database ospitato sull'istanza Postgres di **produzione**:
dati isolati, ma sulla stessa istanza e sullo stesso disco. È limitato a 10
connessioni, affinché le preview non esauriscano quelle di produzione, e a 2 GB: una preview
il cui database superi tale soglia viene messa in pausa. Il suo backend si arresta, il suo indirizzo smette di
rispondere, `rebase cloud previews` e la console la mostrano come `paused` indicandone il
motivo, e i proprietari e gli amministratori del progetto ricevono una notifica (`preview.paused`). I relativi
dati vengono conservati fino alla scadenza. Distribuiscila di nuovo per riavviarla (verrà messa nuovamente in pausa
se il database risulta ancora troppo grande), oppure eliminala. Una preview in pausa continua a essere
fatturata finché non viene eliminata o non scade. Elimina le preview non più necessarie. Le estensioni installate in produzione non vengono
installate nel database di una preview.

Le preview sono in fase di rollout graduale. Un control plane che non le supporta ancora rifiuterà
`--preview` con `previews_unavailable` e non distribuirà nulla.

## Ripristino (Roll back)

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback ripuntamento il progetto su quanto rilasciato da un precedente deployment andato a buon
fine, senza mai ricompilare: il valore di un rollback risiede proprio nel rilascio di un
artefatto già precedentemente eseguito.

I criteri di idoneità dei deployment dipendono dalla modalità di deploy del progetto, ed entrambe
le tipologie sono supportate:

| Modalità di deploy | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (build da sorgente) | L'immagine pubblicata da quella compilazione |
| `rebase cloud deploy --bundle` (runtime della piattaforma) | Il bundle rilasciato da quel deploy, sulla versione del runtime attualmente in esecuzione per il progetto |

Le app statiche integrate nel bundle del backend (un semplice `rebase cloud deploy` su un
progetto dotato di backend) fanno parte di quel bundle, quindi vengono ripristinate insieme a esso.

Un'app statica distribuita singolarmente (`rebase cloud deploy <app>`) non può ancora essere
ripristinata tramite rollback. Il suo deployment registra l'app pubblicata, ma nessun bundle, pertanto il
control plane non ha elementi da cui ripristinarla. La soluzione consiste nel distribuire nuovamente l'ultima
versione funzionante, ad esempio dal commit precedente a quello problematico. Dopo un simile
deploy, `deploy` indicherà questo approccio anziché suggerire `rollback`, e `rollback`
senza un ID rifiuterà l'operazione anziché ridistribuire il backend in esecuzione.

Pertanto, un rollback richiede un deployment che abbia registrato uno dei due artefatti, il che presuppone
un progetto distribuito con successo almeno due volte. `rebase cloud deployments`
evidenzia quelli idonei, e `--json` riporta `rollbackable` per riga insieme a
`image` o `bundle` che verrebbe ripristinato.

Due tipologie di deployment vengono rifiutate e la CLI ne specifica la motivazione: una non andata a buon fine
e una antecedente al momento in cui la piattaforma ha iniziato a registrare l'artefatto. In nessuno dei due casi
è possibile fare congetture (ipotizzare significherebbe rilasciare qualsiasi cosa sia stata compilata o caricata più
di recente, dichiarando falsamente di ripristinare quella specifica versione), pertanto distribuisci direttamente
la versione desiderata.

Ogni deploy completato con successo termina indicando il comando di ripristino (`rebase cloud rollback`),
così da averlo subito a portata di mano qualora si riscontri un problema nel rilascio.

Un rollback accoda un nuovo deployment anziché riavvolgere la cronologia, e attende che
la versione ripristinata sia attiva e pronta prima di segnalare il successo. Monitoralo con
`rebase cloud logs -f`.

## Ripristinare il database a uno specifico momento (PITR)

Un database gestito può essere ripristinato a qualsiasi minuto compreso nella finestra di conservazione,
da **Database → Backups** nella console o tramite la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
La procedura si articola in due passaggi. Per prima cosa, viene predisposta una copia di recupero (staged) a fianco del database attivo;
la tua app continua a funzionare su quello attivo, e lo storage della copia viene fatturato finché
non si esegue il cutover o la si rimuove (discard).
Successivamente, una volta pronta la copia, il cutover ripuntamento l'app su di essa e la
riavvia. Qualsiasi dato scritto dopo l'orario di destinazione non sarà presente nella copia. Il database
originale viene mantenuto come punto di ripristino e continua a fatturare lo storage; il ritorno
alla configurazione precedente, la sua eliminazione o un secondo ripristino richiedono l'intervento del supporto. Solo un proprietario o un amministratore
può predisporre la copia, eseguire il cutover o eliminarla, e la console richiederà il nome del progetto
prima di procedere al cutover.

## Sicurezza dell'account

Il tuo account console può accedere ai database di produzione, ai segreti e alla fatturazione,
pertanto proteggilo adeguatamente. Apri **Account security** dal menu sotto il tuo avatar
nella console (o vai su `/account`). La pagina è personale, non appartiene all'organizzazione:
le impostazioni definite qui si applicano a tutte le organizzazioni a cui appartieni.

- **Verifica in due passaggi (2FA).** Attivala con qualsiasi app di autenticazione (1Password,
  Google Authenticator, Authy). La pagina mostra una chiave di configurazione da inserire nell'app, o un
  link che apre l'app con la chiave già compilata su uno smartphone, per poi richiedere il
  codice a 6 cifre mostrato dall'app. Da quel momento in poi, ogni accesso richiederà un codice,
  sia effettuando l'accesso con password, sia con Google o GitHub.
- **Codici di recupero.** L'attivazione genera dieci codici monouso, mostrati una sola volta.
  Ciascuno consente l'accesso al posto del codice dell'autenticatore in caso di smarrimento del
  telefono, quindi salvali prima di chiudere la finestra di dialogo. L'opzione **New recovery codes**
  li sostituisce, invalidando i precedenti. Sia la disattivazione della verifica in due passaggi
  sia la generazione di nuovi codici richiedono prima l'inserimento di un codice valido.
- **Password.** La sua modifica disconnette l'account da tutti gli altri dispositivi. Un account
  creato con Google, GitHub o LinkedIn non possiede una password; la pagina consente di
  ricevere un link via email per impostarne una.
- **Dispositivi connessi.** Mostra ogni browser e terminale connesso al tuo account,
  con il relativo indirizzo e l'orario di accesso. Puoi disconnettere qualsiasi dispositivo che non
  riconosci o tutti contemporaneamente.

Gli [Access token](/docs/deployment/cloud-agents/#ci-and-agents) non sono sessioni e non richiedono un secondo
fattore, quindi le pipeline CI continuano a distribuire anche dopo l'attivazione della 2FA. Puoi revocare un token non più
ritenuto sicuro sotto **Settings → Access tokens**.

## Invitare il team

**Members → Add member** aggiunge un utente che possiede già un account Rebase con un
indirizzo email verificato, in qualità di admin o membro; un proprietario può successivamente promuoverlo a owner.
L'accesso è immediato e non viene inviata alcuna email. Rebase Cloud non invia
ancora inviti per posta elettronica, quindi chiedi ai collaboratori senza account di registrarsi e
verificare prima il proprio indirizzo. Da terminale:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), che
segnala opportunamente se all'indirizzo non è associato alcun account.

## Accesso al Cloud e utenti dell'app

Sono coinvolti due gruppi distinti di persone, analogamente a quanto avviene in Firebase e Supabase:

- L'**accesso al Cloud** definisce chi può operare sul progetto all'interno di Rebase Cloud. I
  proprietari e gli amministratori di un'organizzazione possiedono il ruolo `admin` su ogni progetto di sua proprietà,
  mentre i membri hanno il ruolo `developer`. Un progetto può inoltre assegnare a una singola persona un ruolo
  specifico (`admin`, `developer` o `viewer`) tramite un invito via email, senza
  renderla membro dell'intera organizzazione. Tra i due prevale il ruolo con privilegi più elevati.
  [`rebase cloud access`](/docs/cli/cloud/#project-access) gestisce questi permessi.
- Gli **utenti della tua app** risiedono nel database dell'app stessa, con i propri flussi di registrazione
  e i propri ruoli. Cloud non elenca né modifica mai tali utenti.

L'unico punto di contatto è **Open admin panel**. Questo pulsante effettua l'accesso di una persona avente
accesso Cloud come `admin` al pannello di amministrazione dell'app, associandola tramite la sua email verificata: l'app
individua o crea l'account con quell'indirizzo, gli attribuisce il ruolo `admin`
e registra che tale ruolo proviene da Rebase Cloud (la sezione Users & roles di Studio
lo evidenzia). Qualora la persona perda l'accesso Cloud `admin` al progetto, Rebase
Cloud richiede all'app di revocare tale ruolo
`admin` e ne termina le sessioni attive all'interno dell'app. Un ruolo concesso manualmente nell'app,
incluso un ruolo `admin` detenuto prima del primo utilizzo di Open admin panel, viene preservato, e l'account
non viene mai eliminato.

## Registro attività (Audit log)

La pagina **Activity** della console e il comando `rebase cloud activity` mostrano
ai proprietari e agli amministratori dell'organizzazione chi ha effettuato un deploy, impostato o visualizzato una variabile
d'ambiente (indicata per nome, mai per valore), modificato un dominio, ripristinato un backup,
ridimensionato, arrestato o eliminato un progetto, modificato il ruolo di un membro o creato un
token, specificando la data e l'ora. La sezione **Settings** di un progetto rimanda alle voci di propria pertinenza; le voci
relative a un progetto eliminato vengono conservate. Uno script può leggerle tramite un token creato con
il permesso `--can audit` sull'organizzazione. Le registrazioni sono conservate per un anno. I filtri sono documentati in
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agenti

Un job di CI o un agente non dovrebbe contenere la tua password personale. Assegnagli un token limitato a
poche azioni mirate su un singolo progetto, creato da un terminale autenticato con
`rebase cloud tokens create --project shop --can deploy,logs`, e impostalo come
`REBASE_TOKEN`. La fatturazione, l'activity log e le impostazioni di notifica
di un'organizzazione sono capacità distinte (`--can billing`, `audit`,
`notifications`) che un token include solo se espressamente richieste. Le autorizzazioni, un flusso di lavoro per GitHub Actions
e ciò che rimane di pertinenza dell'utente autenticato sono dettagliati in
[CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend senza account

`rebase cloud init --claim` dota un'applicazione di un backend live prima ancora che qualcuno si sia registrato,
stampando un URL di riscatto (claim) per consentire all'utente di mantenerne il possesso; un progetto non riscattato
entro 72 ore viene eliminato. Le operazioni consentite dal token di un progetto non riscattato, il valore
`REBASE_API_TOKEN` che genera e le modifiche apportate dal riscatto sono descritti in
[Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Risorse di calcolo e costi

I prezzi di un progetto sono determinati dalle risorse che esso riserva, non da un piano a scaglioni. Il comando `compute` stampa
ogni parametro di configurazione e il relativo preventivo dettagliato generato dal control plane. (`rebase cloud
resources` è un comando differente: elenca i database e i bucket dichiarati dal codice
e lo stato di provisioning di ciascuno; consulta la [documentazione della CLI](/docs/cli/cloud/)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Risorse richieste per singola istanza dell'app, es. `500m` e `2Gi`. Se vuoto, si applica il valore predefinito della piattaforma, che dipende dalla regione (vedi sotto) |
| `--replicas` | Istanze sempre attive: la soglia minima dell'autoscaler e la quota fatturata mensilmente dalla sottoscrizione del progetto |
| `--autoscale-max` | Da 1 a 16. Il tetto massimo raggiungibile. Le istanze aggiunte dall'autoscaler oltre `--replicas` sono contabilizzate per pod-secondo alle medesime tariffe, e addebitate solo ove la piattaforma abbia abilitato tale fatturazione; **Usage this month** indica lo stato del servizio. `--no-autoscale` disabilita la scalabilità automatica |
| `--autoscale-cpu-target` | Da 10 a 95. La percentuale di utilizzo della CPU mantenuta dall'autoscaler, calcolata rispetto alla richiesta e non al limite. Se vuoto, il valore predefinito è 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica, ma soggetta a riavvii senza preavviso |
| `--db-instances` | Da 1 a 3. `1` indica una singola istanza senza failover; `2` aggiunge uno standby automatico |
| `--db-cpu`, `--db-memory` | Valori per ciascuna istanza del database. Se vuoto, i valori predefiniti sono `160m` e `1Gi` |

Un parametro lasciato vuoto non equivale a uno impostato esplicitamente sullo stesso valore numerico: un valore vuoto
segue l'impostazione predefinita della piattaforma e si adegua alle sue future variazioni.

Nella regione Belgio (europe-west1) il valore predefinito riserva 100m di CPU e 384Mi di RAM con possibilità di burst
fino a 2 CPU e 2 GiB; a Falkenstein e Helsinki la memoria può estendersi fino a 1,4× rispetto
alla richiesta e la CPU fino a 10× (fino a un massimo di 1,7 vCPU). Il comando `rebase cloud compute` mostra i parametri specifici del tuo progetto.

La CLI non esegue alcuna convalida preventiva, intenzionalmente: i limiti dipendono dal cluster su cui
il progetto viene eseguito e variano a seconda dei provider. Il control plane rifiuterà qualsiasi
valore che non sia in grado di soddisfare, indicando il campo interessato. Esegui `rebase cloud compute` per visualizzare
il costo in €/mese prima e dopo la modifica; le variazioni si applicano immediatamente, con calcolo proporzionale a partire dalla data odierna.
Una modifica al database si applica subito; viene fatturata secondo la dimensione attuale fino all'avvenuto completamento del passaggio.
L'aggiornamento di CPU o memoria del database, o la riduzione del numero di istanze, comporta un riavvio del database (da circa
30 secondi a 3 minuti; le connessioni vengono interrotte e ristabilite): `compute set`
lo segnala esplicitamente e richiede conferma; al di fuori di un terminale interattivo, l'assenso si esprime con `--yes`. Qualora tale riavvio
non vada a buon fine, `rebase cloud compute apply` tenterà nuovamente l'operazione.

## Panoramica dei restanti comandi

| Gruppo di comandi | Ambito coperto |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Gestione della sessione; `access-token` stampa il token bearer che la CLI invierebbe attualmente, utile per script e server MCP |
| `tokens` | Token per CI e agenti, ciascuno circoscritto a un singolo progetto. Consulta [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Associazione della directory a un progetto, selezione dell'organizzazione, apertura della console |
| `connect` | Aggiunta di un server Rebase self-hosted al tuo account, consentendo al [connettore Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude di raggiungerlo accanto ai progetti Cloud. `--list` li mostra, `--remove` ne rimuove uno. Riservato a proprietari e admin |
| `init`, `claim` | Con `--claim`: inizializza un backend live senza account e restituisce un link per riscattarlo; `claim` stampa nuovamente tale link. Consulta [Un backend senza account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Creazione, elenco, ispezione ed eliminazione dei progetti |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Distribuzione e monitoraggio dei rilasci |
| `deploy-hooks` | URL segreti richiamati da hosting git o pipeline CI per distribuire il progetto: elenco, creazione (l'URL viene mostrato una sola volta), revoca |
| `previews` | Versioni servite su un indirizzo dedicato tramite `deploy --preview` e loro eliminazione. Consulta [Anteprima di una modifica](#anteprima-di-una-modifica) |
| `sleep` | Sospensione per inattività: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake` e `status` (predefinito). In stato di sospensione, il progetto non occupa CPU o memoria e la prima richiesta in arrivo lo riattiva; le attività pianificate e i task in background non vengono eseguiti nel frattempo. Ove un progetto non supporti la sospensione, il control plane rifiuterà il comando indicandone il motivo |
| `start`, `stop`, `restart` | Sospensione temporanea di un progetto e suo riavvio. Un progetto arrestato mantiene attiva la propria sottoscrizione, a meno che la piattaforma non applichi fatturazione unicamente per lo storage e la quota base della piattaforma; la voce **Billing** della console lo specifica qualora applicabile |
| `status`, `metrics`, `debug` | Monitoraggio delle attività in corso e diagnosi di eventuali anomalie |
| `alerts` | Incidenti aperti del progetto, con possibilità di presa in carico (acknowledge) o posticipo (snooze) |
| `cron` | Cron job dell'applicazione distribuita e storico delle esecuzioni registrate, consultabili tramite login `rebase cloud`. Sola lettura |
| `env` | Variabili d'ambiente. `list` non stampa mai i valori; `--secret` opera in sola scrittura |
| `app-key` | La chiave scritta da `init --claim` nel file `.env` come `REBASE_API_TOKEN`, trasferita al momento del riscatto; `rotate` la sostituisce revocando la precedente. Riservato a proprietari e admin |
| `service-key` | `REBASE_SERVICE_KEY`, con privilegi di amministrazione sulle API dell'app stessa: data dell'ultima rotazione; `rotate` ne assegna una nuova all'app. Riservato a proprietari e admin |
| `domains` | Domini personalizzati, record DNS da configurare e relativa verifica. Un progetto può rispondere su più domini, ciascuno verificato autonomamente; `verify` e `remove` accettano il dominio di riferimento, che può essere omesso unicamente se ne è presente uno solo (per `verify`, se ce n'è solo uno ancora in sospeso). Ciascun dominio verificato serve il progetto direttamente; `primary <domain>` imposta il dominio canonico e `redirect <domain>` reindirizza le richieste da un altro dominio con un codice 308 verso quello primario, preservando percorso e parametri query (`--off` ripristina la visualizzazione diretta) — procedura consigliata per domini con prefisso `www.` associati a un apex domain, poiché l'autenticazione Google, i cookie e le passkey sono legati all'origine. Un dominio associato a una specifica app (un `path` applicativo con hostname) non esegue mai reindirizzamenti. Un apex domain (`example.com`, privo di sottodominio) richiede un record **A**, poiché il DNS non vi consente l'uso di record CNAME. Tale indirizzo IP corrisponde all'ingress della piattaforma e non è garantito che rimanga invariato nel tempo: in caso di migrazione dell'infrastruttura, il record A continuerebbe a puntare al vecchio indirizzo. Se il tuo fornitore DNS supporta ALIAS, ANAME o CNAME flattening sul dominio apex, indirizza quest'ultimo verso il valore `tenantHost` del progetto, che segue automaticamente la piattaforma. Il CNAME di un sottodominio la segue già nativamente. Il comando `list` riporta `verified, certificate pending` finché la connessione HTTPS non risponde con un certificato valido. `list --json` restituisce `{ projectId, tenantHost, domains: [...] }` |
| `db` | Associazione o creazione di un database, connessione locale dalla propria macchina, gestione dei backup, ripristino e point-in-time recovery |
| `guests` | Utenti guest registrati tramite accesso anonimo: conteggio, eliminazione di singoli profili e pulizia di quelli non più attivi da tempo. Consulta [Ospiti](/docs/cli/cloud/#guests). Riservato a proprietari e admin |
| `extensions` | Allowlist delle estensioni Postgres |
| `storage` | Bucket del progetto e relative chiavi su [Rebase Storage](/docs/deployment/rebase-storage/) |
| `resources` | Elenco dei database e dei bucket gestiti dalla piattaforma a fronte di quanto dichiarato nel codice |
| `compute` | Risorse riservate dal progetto, relativi costi e modalità di aggiornamento |
| `events` | Cronologia degli eventi del backend in ordine decrescente: scalabilità dell'app, modifiche pianificate e applicate al database, attivazione di nodi standby, espansione dello storage su disco |
| `usage` | Richieste effettuate nel mese corrente a fronte della franchigia inclusa ed eccedenza maturata, conformemente a quanto calcolato in fattura. `usage org` elenca tutti i progetti dell'organizzazione |
| `clusters` | I cluster su cui vengono eseguiti i tenant. Riservato agli amministratori della piattaforma |
| `settings`, `orgs`, `access`, `billing` | Impostazioni di progetto, organizzazioni, membri e inviti, permessi di accesso al progetto e fatturazione |
| `activity` | Registro di audit dell'organizzazione: deployment eseguiti, modifiche alle variabili d'ambiente (per nome), domini, backup, membri o token. Riservato a proprietari e admin. Consulta [Registro attività](#registro-attività-audit-log) |
| `notifications` | Destinazioni per l'invio via POST degli eventi di progetto: Slack, Discord o qualsiasi URL HTTPS ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Ciascun gruppo elencato nella tabella supporta il flag `--help` mostrando una pagina informativa dedicata (sintassi d'uso, flag disponibili ed esempi pratici); l'uso di `--help` non esegue mai il comando. Una suite di test valida la corrispondenza di tale indice: l'aggiunta di un nuovo gruppo privo di documentazione comporterà il fallimento della build anziché mostrare il sommario. Il comando `verify:docs` vincola la tabella stessa a tale indice: ciascun gruppo gestito dalla CLI deve comparire qui esattamente una volta; di conseguenza, un comando privo della relativa riga provocherà il fallimento della compilazione.

Se reindirizzato tramite pipe, `--help` risponde restituendo un output in formato JSON: la medesima sintassi, i flag e gli esempi strutturati come dato elaborabile programmaticamente anziché come sequenza di caratteri di escape per il terminale.

## Cosa non include la beta

Nessuna possibilità di scelta della regione, nessuna registrazione self-service, nessun SLA pubblicato, nessun deploy basato su rami (branch), token con identità legata a persone fisiche e nessun endpoint pubblico per il database. La pagina [Cosa non include la beta](/docs/deployment/cloud-beta-limits/) descrive dettagliatamente ciascun punto, illustrando le implicazioni derivanti dall'effettuare deploy con le credenziali di produzione.

## Hosting autonomo (Self-hosting)

Nulla di quanto descritto costituisce un vincolo di lock-in. La [guida al self-hosting](/docs/deployment/self-hosting/)
consente di eseguire l'identica immagine e lo stesso bundle tramite `docker compose`, e la
[guida a Kubernetes](/docs/deployment/kubernetes/) illustra come riprodurre la medesima architettura tramite Helm chart.
