---
sourceHash: 3594b5aeed9b6b44
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Cos'è, come collegare ed eseguire il deploy di un progetto, e cosa la beta privata non include ancora.
---

Rebase Cloud esegue lo stesso Rebase open source che ospiteresti in autonomia — la stessa
immagine pubblicata `rebasepro/server`, lo stesso bundle, lo stesso Postgres. La
differenza sta in chi lo gestisce.

:::note[Private beta]
Rebase Cloud è in **beta privata**. Attualmente ospita tenant reali e le aperture avvengono
a scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi sottostanti richiedono un account a cui è stato concesso l'accesso.
Tutto il resto su questo sito funziona senza un account.
:::

## Cos'è

Un **progetto** Cloud è costituito da tre elementi che la piattaforma gestisce per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine di runtime pubblicata. I deploy consistono nel caricamento di un bundle, non nella compilazione di un container |
| **Database** | Un PostgreSQL gestito, con backup automatici e point-in-time recovery |
| **Storage** | Un bucket dedicato su [Rebase Storage](/docs/deployment/rebase-storage/), se il tuo progetto utilizza l'archiviazione di file |

L'applicazione e il database vengono sottoposti a provisioning al tuo primo deploy; il bucket solo
quando ne richiedi uno ([Archiviazione file](#archiviazione-file)). Ciascun elemento viene fatturato in base a ciò che
riserva anziché per utente (seat).

**Non cambia nulla nel tuo progetto per poter essere eseguito qui.** Lo stesso repository
può essere ospitato in autonomia con `docker compose`, e la via di uscita è concreta: `rebase build`
produce un bundle avviabile ovunque venga eseguita l'immagine di runtime.

## Collegare un progetto

Dalla directory di un progetto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` apre la console nel browser e mostra un breve codice. Verifica che
la console mostri lo stesso codice e approva l'accesso da lì: il terminale
rileva la sessione e la salva in `~/.rebase/credentials.json`. Se non hai
effettuato l'accesso alla console, accedi prima con il metodo che preferisci, inclusi
Google e GitHub. Tramite SSH, `rebase cloud login --no-browser` stampa il link
da aprire sulla tua macchina.

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono
flag ed entrambi sono obbligatori — da terminale vengono richiesti interattivamente, mentre
un'esecuzione headless che omette uno dei due termina con `input_required` anziché inventarne
uno. **Il sottodominio non è modificabile in seguito:** è l'host
`<slug>.rebase.website` su cui il progetto risponderà, quindi sceglilo con attenzione.

`--link` collega questa directory al progetto nella stessa chiamata, evitando un
passaggio `link` separato. Crea il file `.rebase/cloud.json`, che registra l'ID e lo slug
del progetto. Quel file non è un segreto e non contiene le tue credenziali — queste ultime risiedono
in `~/.rebase/credentials.json`, scritto da `login`.

Viene tuttavia sottoposto a commit insieme al codice, consentendo a un repository clonato di indicare qualsiasi
control plane. Quando l'host proviene esclusivamente da quel file e non corrisponde né a quello della piattaforma
né a uno a cui hai effettuato l'accesso in precedenza, `login` ne indica il nome e chiede conferma
prima di inviarvi email e password. Senza un terminale o con
`--json`, rifiuterà l'operazione con `unknown_control_plane`; passa `--url <host>` (o imposta
`REBASE_CLOUD_URL`) per effettuare intenzionalmente l'accesso lì.

Per accedere senza browser, specifica la tua email: `rebase cloud login --email me@example.com`
chiederà la password. **Ti sei registrato con Google, GitHub o LinkedIn?**
Il tuo account non ha una password, quindi usa un codice:

```bash
rebase cloud login --code --email me@example.com
```

Il control plane ti invierà un codice di 6 cifre via email, valido per dieci minuti, da inserire
al prompt. Con `--email` e senza password, `rebase cloud login` ti chiederà se desideri
usare la password o un codice. I codici richiedono che il control plane sia in grado di inviare
email; in caso contrario, `--code` lo segnalerà e terminerà con `otp_unavailable`.

Se hai attivato l'autenticazione a due fattori, `login` chiederà il codice dalla tua
app di autenticazione o uno dei codici di recupero, a prescindere dal metodo di accesso
utilizzato. Tramite browser, la console lo richiede durante l'accesso. Né un codice di accesso né un secondo fattore possono essere digitati senza un terminale.
Per uno script, crea un token di accesso nella console (**Settings → Access
tokens**) e imposta `REBASE_TOKEN`; consulta [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

Una password errata risponderà con `invalid_credentials` indicando le stesse due modalità di accesso, poiché
la causa tipica è un account che non ne ha mai avuta una.

`billing setup` associa una carta all'organizzazione, una sola volta. È posizionato per primo
nella sequenza per un motivo: il primo deploy di un progetto viene rifiutato senza una carta, e
scoprirlo solo dopo aver completato l'upload di un bundle è l'ordine peggiore.

Successivamente, la pagina **Billing** della console elenca le fatture dell'organizzazione,
ciascuna con la pagina ospitata e il PDF di Stripe, e mostra l'anteprima della fattura successiva per ogni
progetto. `rebase cloud billing invoices` e `rebase cloud billing upcoming`
mostrano le stesse informazioni. Entrambi sono riservati ai proprietari e agli amministratori dell'organizzazione. Dove la
piattaforma lo supporta, **Manage billing** apre il portale clienti di Stripe per la
carta, i dettagli di fatturazione e le fatture passate.

Con una carta già registrata, la creazione di un altro progetto nella console non richiede
alcun secondo pagamento: il progetto viene fatturato su quella carta ed eseguito. Se la carta
viene rifiutata o la banca richiede la conferma del pagamento, la console ti reindirizza a
**Billing**, dove **Fix your card** permette di salvare un'altra carta e **Complete the payment**
apre la fattura su Stripe.

L'utilizzo di un progetto è visibile nella relativa panoramica, sotto **Usage this month**, e
per tutti i progetti contemporaneamente nella pagina **Billing**: richieste rispetto alla
soglia inclusa (la barra diventa arancione all'80%), errori 5xx, l'eccedenza accumulata finora
e la proiezione a questo ritmo per il mese in corso. L'eccedenza è calcolata dallo
stesso codice che la trasmette a Stripe, quindi corrisponde a quanto sarà fatturato;
compare nella fattura del mese successivo. `rebase cloud usage` stampa gli
stessi dati, e `rebase cloud usage org` per l'intera organizzazione. Qualsiasi membro può visualizzarli.
I dati indicano ciò che non è ancora visibile: l'object storage viene misurato ma non
ancora fatturato ([Rebase Storage](/docs/deployment/rebase-storage/) ne riporta
il prezzo); quando un progetto esegue due o più pod applicativi,
le relative richieste non vengono conteggiate; e una giornata con campionamenti mancati produce un conteggio per difetto. Un
progetto con ridimensionamento automatico mostra anche i pod eseguiti oltre `--replicas`, in ore-pod,
il rispettivo costo alle tariffe dedicate e se questa piattaforma li addebita già. Un
progetto riscattato da un agente conteggia solo i giorni a partire dal riscatto: prima di
esso, il progetto apparteneva alla piattaforma.

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
`runtime: "managed"` per il proprio backend, e `deploy` legge tale dichiarazione — lo
segnala durante l'esecuzione (`rebase.json declares runtime: managed — deploying a bundle`),
compila l'app in `dist-bundle`, carica il bundle, lo esegue sull'immagine di runtime pubblicata
e segue il deployment fino a uno stato terminale. Il codice di uscita rappresenta
il verdetto, quindi la stessa riga funziona in modalità non presidiata in CI.

Al termine indica dove ciascuna app risponde e se la nuova versione è
attiva:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa che l'indirizzo ha risposto dopo la compilazione: l'endpoint `/health` del backend
ha restituito `ok` e la pagina di un'app statica è stata caricata (da questo deployment, quando
gestita dalla piattaforma). La verifica attende fino a `--live-timeout` secondi, 60 di
default; `0` la salta. Se un'app non risponde in tempo, il deploy termina comunque con
codice zero perché il deployment ha avuto successo, e l'ultima riga specifica quale app non
ha risposto e per quale motivo. Un deploy fallito termina invece su una sola riga, indicando l'app e la
causa, rimandando a `rebase cloud logs` per il log di compilazione completo.

Gli script possono passare `--json` per ottenere un unico oggetto contenente gli stessi dati — `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` e l'ID del deployment. A differenza del resto dei comandi di
`rebase cloud`, `deploy` non passa automaticamente al formato JSON quando viene usato in una pipe.

Ciò che questo runtime consente — pacchetti e moduli nativi, memoria e istanze,
timeout e dimensioni del body, filesystem, segreti, storage e traffico di rete
in uscita — è descritto nella pagina dedicata:
[Managed backend runtime](/docs/deployment/managed-runtime/).

Per distribuire un artefatto compilato in precedenza — ad esempio un job di CI che compila una volta
e distribuisce due volte — punta direttamente alla directory anziché ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

L'uscita dal runtime gestito avviene tramite un flag dedicato, `--eject`, e null'altro
lo richiederà: una compilazione che sposterebbe un progetto gestito su un'immagine container proprietaria
viene rifiutata finché non lo specifichi esplicitamente. In passato `--force` aveva questo significato, associando
l'azione meno reversibile della CLI alla stessa parola di "sovrascrivi questo
file"; ora è considerata un'opzione sconosciuta anziché un alias, arrestando
gli script che la contengono.

### La verifica sintattica prima dell'upload

I file di un'app statica vengono serviti esattamente come sono. Quando la fase di `build` si limita a
copiare script scritti a mano in `output`, nessun parser li ha convalidati, rischiando che un file
con un refuso vada in produzione impedendo il caricamento della pagina. Pertanto, prima di caricare
qualsiasi elemento, `deploy` analizza sintatticamente ogni file `.js`, `.mjs` e `.cjs` nell'`output` di ciascuna
app statica, insieme a ogni `<script>` inline nei relativi file `.html`. Questo
copre sia un'app statica distribuita singolarmente, sia le app statiche incorporate nel
bundle del backend. Un errore di sintassi interrompe il deploy indicando file, riga e colonna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json` il `code` dell'errore è `syntax_error`. Gli script inline che un browser
non esegue come JavaScript vengono ignorati: JSON, import map, template e qualsiasi
altro `type` non JavaScript, i tag `<script src>` e gli script che contengono ancora
markup di template non renderizzato come `{{ }}`. Un file `.js` supera il controllo se è analizzabile
come script classico o come modulo, poiché è la pagina a determinarlo. Non viene letto nulla
all'interno di `node_modules`, né in un `--bundle-dir` precompilato.
`--no-verify` ignora la verifica per un singolo deploy.

Monitoraggio:

```bash
rebase cloud logs               # il log di compilazione
rebase cloud logs --runtime -f  # ciò che l'app in esecuzione stampa, in tempo reale, fino a Ctrl-C
rebase cloud status             # lo stato del progetto secondo la piattaforma
```

`status` riporta i campi `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la
piattaforma sta lavorando regolarmente ed eseguire il polling è la scelta corretta; quando indica
un valore, quel qualcosa è in attesa di un tuo intervento.

Uno di questi è `email_not_configured`: l'app ha abilitato l'accesso tramite magic-link o codice
email (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) ma non dispone di un servizio email configurato, pertanto
il deployment è attivo ma nessuno può accedere. Rebase Cloud non invia
email per la tua app: configura `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e
`SMTP_FROM` con `rebase cloud env set`, quindi esegui il deploy. `status` legge questo stato
dall'endpoint `GET /api/auth/config` dell'app stessa (nel campo `unavailable`), e `deploy` segnala la
stessa informazione nel suo controllo live.

## Più di un database

Dichiara ciascun database (`database("analytics")`) ed esegui il deploy: verrà creato sul server del progetto come
`DATABASE_URL__ANALYTICS`, condividendone risorse e costi ([dettagli](/docs/backend/multiple-sources/#on-rebase-cloud)).

## Archiviazione file

Un nuovo progetto non dispone di alcun bucket: i caricamenti vengono rifiutati con `501 STORAGE_NOT_CONFIGURED`,
e il riepilogo del deploy lo segnala, anziché scrivere su un disco che ogni deploy andrebbe a sostituire.

Configura una delle due tipologie, quindi esegui nuovamente il deploy affinché l'app lo rilevi:

```bash
# Un bucket gestito direttamente da Rebase. La pagina Storage della console fa la stessa cosa.
rebase cloud storage create

# Oppure un bucket compatibile S3 di tua proprietà: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # ometti per AWS; aggiungi --force-path-style per MinIO

rebase cloud deploy
```

`rebase cloud storage` elenca i bucket del progetto; ogni `bucket("media")` dichiarato
ottiene il proprio ([Database e bucket multipli](/docs/backend/multiple-sources/#on-rebase-cloud)).
Con bucket di tua proprietà, collega
ciascuno con `--source <key>`; un bucket che configura lo storage da codice non richiede nessuno dei due passaggi.

## Anteprima di una modifica (Preview)

```bash
rebase cloud deploy --preview
```

Questo comando compila e carica esattamente ciò che farebbe `deploy`, ma rende disponibile l'app a un indirizzo
dedicato, ad esempio `https://shop--k3x9ab.rebase.website`. L'ambiente di produzione continua
a servire la versione precedente. Il deploy mostra l'indirizzo della preview al termine
della compilazione.

Per mantenere lo stesso indirizzo attraverso più deploy, assegna un nome alla preview. Eseguire nuovamente il deploy
con lo stesso nome la aggiornerà:

```bash
rebase cloud deploy --preview-name new-checkout
```

Le risorse con cui una preview interagisce dipendono da ciò che è stato distribuito:

- **`rebase cloud deploy --preview`** genera un'anteprima del backend con le relative app statiche
  incorporate, esattamente come in produzione. Ottiene un backend dedicato su
  un **database vuoto dedicato**, mai quello di produzione. L'avvio sul
  database di produzione applicherebbe lo schema e le regole di accesso della preview a quest'ultimo.
- **`rebase cloud deploy web --preview`** creerebbe un'anteprima della sola app statica
  isolata, con le relative pagine che richiamano il backend di **produzione**. Ciò richiede un control plane
  in grado di gestire siti statici autonomamente, funzionalità non ancora supportata da Rebase Cloud:
  l'operazione viene rifiutata con `PREVIEW_STATIC_UNSERVED` senza pubblicare nulla. Crea invece l'anteprima
  del backend, che include al suo interno le app statiche; al momento non è possibile creare preview per un progetto
  privo di backend gestito.

Una preview non carica codice sorgente e non registra app o hostname, poiché ciascuna
di queste azioni modificherebbe il progetto di produzione. `--source` ed `--eject` non possono
essere combinati con `--preview`. Entrambi compilano un'immagine container per la produzione.

```bash
rebase cloud previews                      # nome, indirizzo, app, backend, scadenza
rebase cloud logs --preview new-checkout   # il relativo log di compilazione; -f segue una compilazione in corso
rebase cloud logs --runtime --preview new-checkout -f  # l'output del rispettivo backend
rebase cloud previews delete new-checkout  # ne interrompe l'erogazione ed elimina il relativo database
```

`rebase cloud logs` senza `--preview` fa sempre riferimento alla produzione.

La pagina **Deployments** della console elenca le stesse preview e permette di aprirle, visualizzarne
il log di compilazione o eliminarle. La creazione rimane un passaggio da CLI.

Una preview scade una settimana dopo l'ultimo deploy effettuato su di essa.

Al termine, il deploy verifica che l'indirizzo della preview risponda, esattamente come avviene
per un deploy in produzione (`--live-timeout <seconds>`, `0` per saltare). Il certificato di una nuova
preview può richiedere uno o due minuti, pertanto un deploy riuscito potrebbe
segnalare che l'indirizzo non risponde ancora.

Una preview del backend viene fatturata come un'unità applicativa di dimensione predefinita (100m di CPU
e 384 MiB di memoria, alla tariffa della tua app in base a regione e capacità),
ripartita proporzionalmente (pro-rata) per la sua intera durata, e compare nella
stima mensile del progetto nella console. `rebase cloud deploy --preview` stampa lo stesso preventivo
mensile stimato (`cost` sotto `--json`). Avviarne una richiede una carta registrata, come
per un deploy di produzione. Un primo deploy che
fallisce prima dell'avvio delle risorse viene rimosso anziché fatturato. Un progetto può eseguire
fino a tre preview di backend contemporaneamente.

Ogni nuovo indirizzo di preview riceve un certificato TLS dedicato da Let's Encrypt,
il quale limita ciascun dominio a 50 nuovi certificati alla settimana, condivisi con tutti i siti di produzione
su di esso. Le preview possono utilizzarne al massimo 20 ogni 7 giorni sull'intera piattaforma. Oltre
tale soglia, la richiesta di una nuova preview viene rifiutata (`429`, `preview_cert_budget`) indicando il momento a partire dal quale
sarà possibile effettuare il deploy; il re-deploy di una preview già esistente non viene mai conteggiato nel limite.

Il database di una preview di backend è un secondo database sull'istanza Postgres di **produzione**:
dati separati, ma sulla stessa istanza e sullo stesso disco. È limitato a 10
connessioni, affinché le preview non esauriscano quelle di produzione, e a 2 GB: una preview
il cui database supera questa soglia viene messa in pausa. Il backend si arresta, l'indirizzo smette
di rispondere, `rebase cloud previews` e la console ne mostrano lo stato come `paused` indicandone
il motivo, e i proprietari e gli amministratori del progetto ricevono una notifica (`preview.paused`). I relativi
dati vengono conservati fino alla scadenza. Esegui nuovamente il deploy per avviarla (verrà messa nuovamente in pausa
se il database risulta ancora troppo grande), oppure eliminala. Una preview in pausa continua a essere
fatturata finché non viene eliminata o scade. Elimina le preview non più necessarie. Le estensioni installate in produzione non vengono
installate nel database di una preview.

Le preview sono in fase di rollout graduale. Un control plane che non le supporta ancora rifiuterà
`--preview` con `previews_unavailable` senza distribuire nulla.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback reimposta il puntamento del progetto su quanto rilasciato da un precedente deployment completato
con successo, senza mai ricompilare — l'utilità di un rollback risiede proprio nel ripristinare un
artefatto già testato ed eseguito.

I deployment idonei dipendono dalla modalità con cui il progetto è stato distribuito, ed entrambe
sono supportate:

| Modalità di deploy | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (compilazione da sorgente) | L'immagine pubblicata da quella compilazione |
| `rebase cloud deploy --bundle` (runtime della piattaforma) | Il bundle rilasciato da quel deploy, sulla versione del runtime attualmente in esecuzione per il progetto |

Le app statiche incorporate nel bundle del backend (un semplice `rebase cloud deploy` su un
progetto dotato di backend) fanno parte di quel bundle, pertanto vengono ripristinate insieme a esso.

Un'app statica distribuita singolarmente (`rebase cloud deploy <app>`) non può ancora essere
ripristinata tramite rollback. Il relativo deployment registra quale app è stata pubblicata, ma nessun bundle, di conseguenza il
control plane non dispone di elementi da cui ripristinarla. La soluzione consiste nel distribuire nuovamente l'ultima
versione corretta, ad esempio a partire dal commit precedente a quello problematico. A seguito di un deploy
di questo tipo, `deploy` indicherà questa soluzione anziché suggerire `rollback`, e `rollback`
senza un ID rifiuterà l'operazione anziché ridistribuire il backend in esecuzione.

Un rollback richiede pertanto un deployment che abbia registrato uno dei due elementi, il che implica un
progetto distribuito con successo almeno due volte. `rebase cloud deployments`
evidenzia quelli idonei, e `--json` riporta `rollbackable` per ciascuna riga insieme all'attributo
`image` o `bundle` che verrebbe ripristinato.

Due tipologie di deployment vengono rifiutate, e la CLI ne specifica la natura: un deployment non riuscito,
e uno antecedente alla registrazione degli artefatti da parte della piattaforma. In entrambi i casi
non viene fatta alcuna ipotesi arbitraria — tirare a indovinare comporterebbe la distribuzione dell'ultimo elemento compilato o caricato
dichiarando erroneamente di aver ripristinato quello selezionato — pertanto distribuisci direttamente
la versione desiderata.

Ogni deploy completato con successo termina indicando il comando di ripristino (`rebase cloud rollback`),
garantendo che sia immediatamente visibile nel momento in cui si riscontra un problema nel rilascio.

Un rollback aggiunge un nuovo deployment anziché riscrivere la cronologia, e attende che
la versione ripristinata sia operativa prima di confermare il successo dell'operazione. Puoi seguirne l'avanzamento con
`rebase cloud logs -f`.

## Ripristino del database a un momento specifico (Point-in-time recovery)

Un database gestito può essere ripristinato a qualsiasi minuto all'interno della finestra di conservazione,
dalla sezione **Database → Backups** nella console o tramite la CLI:
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
La procedura si articola in due passaggi. Dapprima viene allestita una copia ripristinata accanto al database attivo;
l'applicazione continua a funzionare su quest'ultimo, e lo storage della copia viene fatturato fino
al cutover o allo scarto.
Successivamente, una volta pronta la copia, il cutover reindirizza l'applicazione verso di essa e la
riavvia. Qualsiasi dato scritto dopo l'orario di riferimento non sarà presente nella copia. Il database
originale viene conservato come procedura di emergenza per tornare indietro e continua a occupare storage fatturato;
il ripristino all'originale, la sua rimozione o un secondo restore richiedono l'intervento dell'assistenza. Solo un proprietario o un amministratore
può predisporre, eseguire il cutover o scartare la copia, e la console richiede il nome del progetto
prima di autorizzare il cutover.

## Proteggere il proprio account

L'account della console consente di accedere ai database di produzione, ai segreti e alla fatturazione,
pertanto va protetto adeguatamente. Apri **Account security** dal menu sotto il tuo avatar
nella console (oppure vai su `/account`). La pagina è personale, non legata a una specifica
organizzazione: le impostazioni definite qui si applicano a tutte le organizzazioni a cui appartieni.

- **Verifica in due passaggi (2FA).** Attivala con qualsiasi app di autenticazione (1Password,
  Google Authenticator, Authy). La pagina mostra una chiave di configurazione da inserire nell'app, o un
  link che apre l'app con la chiave precompilata su smartphone, richiedendo poi il
  codice a 6 cifre generato. Da quel momento in poi, ogni accesso richiederà un codice,
  sia effettuando l'accesso con password, sia con Google o GitHub.
- **Codici di recupero.** L'attivazione genera dieci codici monouso, mostrati una sola volta.
  Ciascuno consente di accedere al posto del codice dell'autenticatore in caso di smarrimento del
  telefono, pertanto salvali prima di chiudere la finestra di dialogo. **New recovery codes**
  li sostituisce invalidando quelli precedenti. La disattivazione della verifica in due passaggi
  e la generazione di nuovi codici richiedono entrambe l'inserimento preventivo di un codice valido.
- **Password.** La modifica della password comporta la disconnessione da tutti gli altri dispositivi. Un account
  creato tramite Google, GitHub o LinkedIn non possiede una password; la pagina consente di
  ricevere un link via email per impostarne una.
- **Dispositivi connessi.** Mostra ogni browser e terminale connesso al tuo account,
  con il relativo indirizzo IP e data di accesso. Disconnetti qualsiasi dispositivo non
  riconosciuto, oppure tutti contemporaneamente.

I [Token di accesso](/docs/deployment/cloud-agents/#ci-and-agents) non costituiscono sessioni e non richiedono un secondo
fattore, consentendo alla CI di continuare i deploy dopo l'attivazione della 2FA. Puoi revocare un token non più
ritenuto sicuro da **Settings → Access tokens**.

## Invitare il team

**Members → Add member** consente di aggiungere utenti che dispongono già di un account Rebase con un
indirizzo email verificato, con ruolo di admin o member; un owner potrà successivamente promuoverli a owner.
L'accesso è immediato e non viene inviata alcuna email. Rebase Cloud non gestisce ancora l'invio di inviti via email,
pertanto chiedi ai colleghi privi di account di registrarsi e
verificare il proprio indirizzo in anticipo. Da terminale:
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), che
segnalerà se l'indirizzo non corrisponde ad alcun account esistente.

## Accesso al Cloud e utenti dell'applicazione

Sono coinvolti due gruppi di persone distinti, analogamente a Firebase e Supabase:

- **Cloud access** definisce chi può operare sul progetto all'interno di Rebase Cloud. I
  proprietari e gli amministratori di un'organizzazione sono `admin` su ogni progetto di sua proprietà, e
  i relativi membri sono `developer`. Un progetto può inoltre assegnare a una singola persona un ruolo
  dedicato (`admin`, `developer` o `viewer`) tramite invito email, senza
  doverla rendere membro dell'intera organizzazione. Si applica il privilegio più elevato tra i due.
  [`rebase cloud access`](/docs/cli/cloud/#project-access) gestisce queste autorizzazioni.
- **Gli utenti dell'applicazione** risiedono nel database interno dell'applicazione stessa, con le proprie procedure di registrazione
  e i relativi ruoli. Cloud non elenca né modifica mai tali utenti.

L'unico punto di contatto è il pulsante **Open admin panel**. Questo effettua l'accesso per un utente con
accesso Cloud di livello `admin` al pannello di amministrazione dell'app, associandolo tramite email verificata: l'app
individua o crea l'account corrispondente a tale indirizzo assegnandogli il ruolo `admin`,
registrando che tale ruolo proviene da Rebase Cloud (lo indica il campo `roles` della tabella degli utenti nel pannello di amministrazione).
Nel momento in cui l'utente perde l'accesso Cloud di livello `admin` al progetto, Rebase Cloud richiede
all'app di revocare tale ruolo `admin`
terminando le relative sessioni attive nell'applicazione. Un ruolo assegnato manualmente all'interno dell'app,
compreso un ruolo di `admin` posseduto prima del primo utilizzo di Open admin panel, viene preservato, e l'account
non viene mai eliminato.

## Monitorare le attività (Chi ha fatto cosa)

La pagina **Activity** della console e il comando `rebase cloud activity` mostrano ai
proprietari e agli amministratori dell'organizzazione chi ha eseguito un deploy, impostato o visualizzato una variabile
d'ambiente (indicandone il nome, mai il valore), modificato un dominio, ripristinato un backup,
ridimensionato, arrestato o eliminato un progetto, modificato il ruolo di un membro o creato un
token, specificando la data e l'ora. La sezione **Settings** di ciascun progetto include i collegamenti alle relative voci; le informazioni
relative a un progetto eliminato vengono conservate. Uno script può consultare questi log tramite un token generato con
il permesso `--can audit` sull'organizzazione. Le registrazioni vengono conservate per un anno. I filtri disponibili sono descritti in
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agenti

Un job di CI o un agente non dovrebbero mai contenere la tua password personale. Assegna loro un token limitato a
poche azioni circoscritte a un singolo progetto, generandolo da un terminale autenticato tramite
`rebase cloud tokens create --project shop --can deploy,logs`, e impostalo come
`REBASE_TOKEN`. La fatturazione, il log delle attività e le impostazioni di notifica
dell'organizzazione costituiscono permessi dedicati (`--can billing`, `audit`,
`notifications`) che un token acquisisce solo se espressamente richiesto. I permessi, un esempio di workflow per
GitHub Actions e le funzionalità riservate a un utente connesso sono consultabili in
[CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend senza creare un account

`rebase cloud init --claim` assegna all'applicazione un backend attivo prima ancora che qualcuno si sia
registrato, stampando un URL di riscatto (claim) che consente all'utente di mantenerne la proprietà; un progetto non riscattato
entro 72 ore viene eliminato automaticamente. I permessi del token per un progetto non riscattato,
la variabile `REBASE_API_TOKEN` generata e le modifiche apportate dal riscatto sono illustrati in
[Un backend senza un account](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Risorse di calcolo (Compute) e costi

Il costo di un progetto viene calcolato in base alle risorse riservate, non in base a piani tariffari a scaglioni. Il comando `compute` mostra
tutti i parametri configurabili e il preventivo dettagliato elaborato direttamente dal control plane. (`rebase cloud resources`
è un comando differente: elenca i database e i bucket dichiarati dal codice
e lo stato di provisioning di ciascuno — consulta la [Guida di riferimento CLI](/docs/cli/cloud/)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità di misura e significato |
|---|---|
| `--cpu`, `--memory` | Risorse richieste dall'app per istanza, ad es. `500m` e `2Gi`. Se vuoto, si applica il valore predefinito della piattaforma, variabile in base alla regione (vedi sotto) |
| `--replicas` | Istanze sempre attive: il limite minimo dell'autoscaler e la quota fatturata mensilmente dalla sottoscrizione del progetto |
| `--autoscale-max` | 1–16. Il tetto massimo raggiungibile. Le istanze aggiunte dall'autoscaler oltre la soglia `--replicas` vengono conteggiate per pod-secondo alle medesime tariffe, e addebitate solo dove la piattaforma ha abilitato tale funzione; **Usage this month** indica lo stato applicato. `--no-autoscale` disabilita la funzionalità |
| `--autoscale-cpu-target` | 10–95. L'utilizzo medio di CPU mantenuto dall'autoscaler, calcolato rispetto alla richiesta e non al limite massimo. Se vuoto, il valore predefinito è 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica, ma soggetta a riavvii senza preavviso |
| `--db-instances` | 1–3. `1` corrisponde a un'istanza singola senza failover; `2` aggiunge un'istanza di standby automatico |
| `--db-cpu`, `--db-memory` | Valori per istanza di database. Se vuoto, i valori predefiniti sono `160m` e `1Gi` |

Lasciare un parametro vuoto non equivale a impostarlo esplicitamente sullo stesso valore numerico: un parametro non valorizzato
eredita il valore predefinito della piattaforma e si aggiorna automaticamente in caso di variazioni di quest'ultimo.

Nella regione Belgio (europe-west1) il profilo predefinito riserva 100m di CPU e 384Mi con possibilità di picco (burst)
fino a 2 CPU e 2 GiB; nelle regioni di Falkenstein e Helsinki la memoria può estendersi fino a 1,4× la
richiesta e la CPU fino a 10× (con un massimo di 1,7 vCPU). Il comando `rebase cloud compute` mostra i valori effettivi assegnati al tuo
progetto.

La CLI non esegue alcuna validazione preventiva sui valori, in modo del tutto intenzionale — i limiti dipendono dal cluster su cui
il progetto viene eseguito e variano da un provider all'altro. Il control plane rifiuterà
qualsiasi valore non compatibile indicando il campo interessato. Esegui `rebase cloud compute` per visualizzare
il costo in €/mese prima e dopo la modifica; le variazioni hanno effetto immediato con calcolo pro-rata a partire dalla data odierna.
Una modifica al database viene applicata immediatamente, fatturata alla dimensione corrente fino al completamento dell'operazione.
L'aggiornamento di CPU o memoria del database, o la riduzione del numero di istanze, comporta il riavvio del database (circa
da 30 secondi a 3 minuti; le connessioni attive vengono interrotte e ristabilite): `compute set`
segnala l'operazione richiedendo conferma, e in contesti non interattivi il flag `--yes` funge da consenso. Qualora il riavvio
non vada a buon fine, `rebase cloud compute apply` tenterà nuovamente l'operazione.

## Panoramica degli altri comandi

| Gruppo di comandi | Descrizione |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Gestione della sessione; `access-token` stampa il token bearer corrente utilizzato dalla CLI, per script e server MCP |
| `tokens` | Token per CI e agenti, ciascuno circoscritto a un singolo progetto. Consulta [CI e agenti](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Collegamento della directory corrente a un progetto, selezione dell'organizzazione, apertura della console |
| `connect` | Aggiunta di un server Rebase self-hosted al tuo account, consentendo al [connettore Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) in Claude di interagirvi insieme ai tuoi progetti Cloud. `--list` li elenca, `--remove` ne rimuove uno. Riservato a owner e admin |
| `init`, `claim` | Con `--claim`: avvia un backend attivo senza richiedere un account e genera un link di riscatto; `claim` stampa nuovamente tale link. Consulta [Un backend senza un account](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Creazione, visualizzazione, ispezione ed eliminazione dei progetti |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Distribuzione e monitoraggio dei rilasci |
| `deploy-hooks` | URL segreti richiamabili da provider Git o CI per distribuire il progetto: elenco, creazione (l'URL viene mostrato una sola volta) e revoca |
| `previews` | Gestione delle build esposte su indirizzi dedicati tramite `deploy --preview` e relativa eliminazione. Consulta [Anteprima di una modifica (Preview)](#anteprima-di-una-modifica-preview) |
| `sleep` | Sospensione per inattività: `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake` e `status` (predefinito). In stato di sospensione, il progetto non impegna CPU o memoria e la prima richiesta in arrivo ne provoca il risveglio; le attività pianificate e i processi in background rimangono sospesi. Se un progetto non supporta la sospensione, il control plane rifiuterà il comando indicandone il motivo |
| `start`, `stop`, `restart` | Sospensione e riattivazione di un progetto. Un progetto arrestato mantiene attiva la propria sottoscrizione pagando esclusivamente lo storage su disco, oppure la tariffa minima mensile qualora il costo del disco sia inferiore; la riga **Billing** nella console ne riporta l'importo |
| `status`, `metrics`, `debug` | Diagnostica dello stato operativo e analisi di eventuali blocchi |
| `alerts` | Incidenti aperti sul progetto, con funzioni di conferma (acknowledge) o posticipo (snooze) |
| `cron` | Job cron configurati nell'app distribuita e storico delle esecuzioni registrate, consultabili tramite l'accesso `rebase cloud`. In sola lettura |
| `env` | Variabili d'ambiente. `list` non mostra mai i valori in chiaro; `--secret` opera in sola scrittura |
| `app-key` | La chiave salvata da `init --claim` nel file `.env` come `REBASE_API_TOKEN`, trasferita al momento del riscatto; `rotate` la rigenera revocando la precedente. Riservato a owner e admin |
| `service-key` | `REBASE_SERVICE_KEY`, con privilegi amministrativi sull'API dell'applicazione: data dell'ultima rotazione; `rotate` ne assegna una nuova all'app. Riservato a owner e admin |
| `domains` | Domini personalizzati, record DNS richiesti e relativa verifica. Un progetto può rispondere su molteplici domini, verificati singolarmente; `verify` e `remove` accettano il dominio target come parametro, omettibile solo in presenza di un singolo dominio (nel caso di `verify`, uno ancora in attesa). Ciascun dominio verificato serve il progetto direttamente; `primary <domain>` definisce il dominio canonico e `redirect <domain>` reindirizza gli altri verso di esso con codice 308, mantenendo percorso e query string (`--off` ripristina la gestione diretta) — operazione raccomandata per `www.` accanto al dominio apex, poiché l'accesso con Google, i cookie e le passkey sono legati all'origine. Un dominio associato a una specifica applicazione (un `path` applicativo con hostname dedicato) non applica mai reindirizzamenti. Un dominio apex (`example.com`, senza sottodominio) richiede un record **A**, non consentendo lo standard DNS l'uso di CNAME alla radice. Tale indirizzo punta all'ingress della piattaforma e non è garantito che rimanga invariato nel tempo: in caso di migrazione dell'infrastruttura, il record A continuerà a puntare al vecchio indirizzo. Se il tuo gestore DNS supporta ALIAS, ANAME o CNAME flattening sull'apex, indirizza l'apex verso il `tenantHost` del progetto, che segue automaticamente la piattaforma. Il record CNAME di un sottodominio la segue già nativamente. `list` visualizza `verified, certificate pending` finché la connessione HTTPS non risponde con un certificato valido. `list --json` restituisce `{ projectId, tenantHost, domains: [...] }` |
| `db` | Collegamento o creazione di un database, connessione diretta dalla propria workstation, backup, ripristino e point-in-time recovery |
| `guests` | Utenti guest generati dall'autenticazione anonima: conteggio, eliminazione mirata e pulizia (pruning) degli utenti inattivi da lungo tempo. Consulta [Ospiti](/docs/cli/cloud/#guests). Riservato a owner e admin |
| `extensions` | Elenco delle estensioni Postgres consentite |
| `storage` | Bucket del progetto e relative chiavi di accesso, su [Rebase Storage](/docs/deployment/rebase-storage/) |
| `resources` | Database e bucket allocati sulla piattaforma a fronte di quanto dichiarato nel codice sorgente |
| `compute` | Risorse computazionali riservate dal progetto, relativi costi e modalità di modifica |
| `events` | Storico degli eventi del backend in ordine decrescente: ridimensionamento dell'app, modifiche al database pianificate e applicate, failover su standby, espansione del volume disco |
| `usage` | Richieste consumate nel mese a fronte della soglia inclusa ed eccedenza accumulata, ai fini del calcolo di fatturazione. `usage org` riassume i dati di tutti i progetti dell'organizzazione |
| `clusters` | Cluster su cui sono eseguiti i tenant. Riservato agli amministratori della piattaforma |
| `settings`, `orgs`, `access`, `billing` | Impostazioni di progetto, organizzazioni, gestione dei membri e degli inviti, controllo accessi al progetto e fatturazione |
| `activity` | Registro di audit dell'organizzazione: deploy eseguiti, modifiche alle variabili d'ambiente (per nome), domini, backup, membri o token. Riservato a owner e admin. Consulta [Monitorare le attività (Chi ha fatto cosa)](#monitorare-le-attività-chi-ha-fatto-cosa) |
| `notifications` | Destinazioni di inoltro (POST) degli eventi di progetto: Slack, Discord o qualsiasi endpoint HTTPS ([Notifiche Cloud](/docs/deployment/cloud-notifications/)) |

Ciascun gruppo presente nella tabella supporta il flag `--help` fornendo una schermata di documentazione dedicata — sintassi di utilizzo,
flag disponibili ed esempi pratici — e `--help` non esegue mai il comando. Una suite di test automatizzati verifica
l'indice delle pagine; l'aggiunta di un gruppo privo di documentazione comporterà il fallimento della build anziché
mostrare l'indice generale. Il controllo `verify:docs` vincola la tabella stessa
a tale indice: ogni comando gestito dalla CLI deve figurare in questa sede esattamente una volta, pena il fallimento della build.

Se utilizzato in una pipeline, `--help` restituisce l'output in formato JSON: la stessa sintassi d'uso, i flag e gli esempi pratici
vengono strutturati come dati leggibili programmaticamente anziché come sequenze di escape ANSI per terminale.

## Cosa non include la beta

Nessuna selezione della regione, nessuna registrazione in modalità self-service, nessun SLA formalizzato, nessun deploy automatico per branch,
token privi di identità personale e nessun endpoint pubblico per il database. La pagina [Cosa non include la beta](/docs/deployment/cloud-beta-limits/)
descrive in dettaglio ciascuna limitazione, chiarendo le implicazioni derivanti dall'esecuzione di deploy con segreti di produzione.

## Alternativa self-hosted

I servizi descritti non comportano alcun vincolo di lock-in. La [guida al self-hosting](/docs/deployment/self-hosting/)
consente di eseguire l'identica immagine e bundle mediante `docker compose`, e la
[guida a Kubernetes](/docs/deployment/kubernetes/) descrive la medesima topologia architetturale a partire
dal relativo Helm chart.
