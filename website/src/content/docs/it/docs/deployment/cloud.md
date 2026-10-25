---
sourceHash: 1959160bec263545
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Di cosa si tratta, come collegare e distribuire un progetto, e cosa la beta privata non include ancora.
---

Rebase Cloud esegue lo stesso Rebase open source che ospiteresti in self-hosting — la stessa
immagine pubblicata `rebasepro/server`, lo stesso bundle, lo stesso Postgres. La
differenza sta in chi lo gestisce.

:::note[Beta privata]
Rebase Cloud è in **beta privata**. Attualmente esegue tenant reali e apre gli accessi a
scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi seguenti richiedono un account abilitato.
Tutto il resto su questo sito funziona senza bisogno di un account.
:::

## Di cosa si tratta

Un **progetto** Cloud è costituito da tre elementi che la piattaforma gestisce per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine runtime pubblicata. I deploy consistono nel caricamento di un bundle, non nella compilazione di un container |
| **Database** | Un PostgreSQL gestito, con backup automatizzati e point-in-time recovery |
| **Storage** | Un bucket dedicato, se il tuo progetto utilizza l'archiviazione di file |

Ciascun elemento viene eseguito al primo deploy ed è fatturato in base a quanto
riserva anziché per utente (seat).

**Nel tuo progetto non cambia nulla per essere eseguito lì.** Lo stesso repository
può essere ospitato in self-hosting con `docker compose`, e la via d'uscita è concreta: `rebase build`
produce un bundle avviabile ovunque venga eseguita l'immagine runtime.

## Collegare un progetto

Dalla directory di un progetto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono
flag ed entrambi sono obbligatori — su un terminale vengono richiesti in modo interattivo, mentre
un'esecuzione headless che ne ometta uno termina con `input_required` anziché inventarne
uno. **Il sottodominio non è modificabile in seguito:** è l'host
`<slug>.rebase.website` su cui risponde il progetto, quindi sceglilo con attenzione.

`--link` associa questa directory al progetto nella stessa chiamata, evitando un
passaggio di `link` separato. Scrive `.rebase/cloud.json`, che registra l'ID del progetto
e lo slug. Quel file non è un segreto e non contiene le tue credenziali — queste ultime si trovano
in `~/.rebase/credentials.json`, generato da `login`.

Viene tuttavia sottoposto a commit con il codice, consentendo a un repository clonato di indicare qualsiasi
control plane. Quando l'host proviene solo da quel file e non è né quello ufficiale
della piattaforma né uno a cui hai già effettuato l'accesso, `login` ne mostra il nome e chiede
conferma prima di inviarvi email e password. Senza terminale, o con
`--json`, rifiuta l'operazione con `unknown_control_plane`; passa `--url <host>` (oppure imposta
`REBASE_CLOUD_URL`) per accedere intenzionalmente a quell'endpoint.

`billing setup` associa una carta all'organizzazione, una sola volta. È posizionato intenzionalmente
all'inizio della sequenza: il primo deploy di un progetto viene rifiutato in assenza di essa, e
scoprirlo solo dopo aver completato l'upload di un bundle sarebbe l'ordine peggiore.

Un progetto esistente si collega senza crearne uno nuovo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Un unico comando, senza flag da ricordare. Il file `rebase.json` di uno scaffold dichiara
`runtime: "managed"` per il proprio backend, e `deploy` legge tale dichiarazione — lo
notifica durante l'esecuzione (`rebase.json declares runtime: managed — deploying a
bundle`), compila l'app in `dist-bundle`, carica il bundle, lo esegue sull'immagine
runtime pubblicata e segue il deployment fino a uno stato finale. Il codice di uscita
costituisce il verdetto, quindi la stessa riga funziona in modo non presidiato nella CI.

Termina indicando dove risponde ora ogni app e se la nuova versione è live:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa che l'indirizzo ha risposto dopo il build: `/api/health` del backend ha restituito `ok` e la pagina di un'app statica si è caricata (da questo deployment, quando è la piattaforma a servirla). Il controllo attende fino a `--live-timeout` secondi, 60 di default; `0` lo salta. Se un'app non risponde in tempo il deploy esce comunque con codice zero, perché il deployment è riuscito, e l'ultima riga dice quale app non ha risposto e perché. Un deploy fallito termina invece con una riga che indica l'app e il motivo, con `rebase cloud logs` per il log completo del build.

Gli script passano `--json` per ottenere un oggetto con gli stessi dati — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e l'id del deployment. A differenza del resto di `rebase cloud`, `deploy` non passa da solo a JSON in una pipe.

Ciò che tale runtime consente — pacchetti e moduli nativi, memoria e istanze, timeout e dimensioni del body, filesystem, secret, storage e rete in uscita — è descritto nella relativa pagina:
[Runtime backend gestito](/docs/deployment/managed-runtime/).

Per distribuire un artefatto compilato in precedenza — ad esempio, un job di CI che compila una volta
e distribuisce due volte — punta alla directory invece di ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

L'uscita dal runtime gestito avviene tramite un flag dedicato, `--eject`, e null'altro lo
richiede: una build che sposterebbe un progetto gestito su un'immagine container proprietaria
viene rifiutata finché non lo specifichi esplicitamente. In precedenza si usava `--force`, che associava
l'azione meno reversibile della CLI allo stesso termine usato per "sovrascrivi questo
file"; ora è un'opzione non riconosciuta anziché un alias, arrestando così gli script che
la utilizzavano.

### Il controllo della sintassi prima dell'upload

I file di un'app statica vengono serviti così come sono. Quando il suo `build` si limita a copiare script scritti a mano in `output`, nessuno li ha mai analizzati, e un file con un refuso va online e impedisce alla pagina di caricarsi. Per questo, prima di caricare qualsiasi cosa, `deploy` analizza ogni file `.js`, `.mjs` e `.cjs` nell'`output` di ogni app statica, insieme a ogni `<script>` inline nei suoi file `.html`. Vale sia per un'app statica distribuita da sola sia per le app statiche incorporate nel bundle del backend. Un errore di sintassi interrompe il deploy indicando file, riga e colonna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Con `--json` il `code` dell'errore è `syntax_error`. Gli script inline che un browser non esegue come JavaScript vengono saltati: JSON, import map, template e qualsiasi altro `type` non JavaScript, uno `<script src>` e uno script che contiene ancora markup di template non renderizzato come `{{ }}`. Un file `.js` passa se si può analizzare come script classico o come modulo, perché è la pagina a deciderlo. Nulla sotto `node_modules` viene letto, né un `--bundle-dir` già compilato. `--no-verify` salta il controllo per un singolo deploy.

Monitora l'avanzamento:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` riporta `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la
piattaforma sta lavorando regolarmente ed eseguire un polling è la procedura corretta; quando indica
un valore, significa che qualcosa è in attesa di un tuo intervento.

## Anteprima di una modifica

<span class="since-badge" data-since="0.26">Dalla versione 0.26</span>

```bash
rebase cloud deploy --preview
```

Compila e carica esattamente ciò che farebbe `deploy`, ma lo serve a un indirizzo
tutto suo, come `https://shop--k3x9ab.rebase.website`. La produzione continua a servire
ciò che serviva prima. Il deploy stampa l'indirizzo dell'anteprima al termine della
build.

Per mantenere lo stesso indirizzo tra un deploy e l'altro, dai un nome all'anteprima.
Eseguire di nuovo il deploy con lo stesso nome la aggiorna:

```bash
rebase cloud deploy --preview-name new-checkout
```

Ciò con cui un'anteprima comunica dipende da ciò che hai distribuito:

- **`rebase cloud deploy web --preview`** mostra l'anteprima di una singola app statica. Le sue pagine chiamano
  il backend di **produzione**: un accesso lì è una sessione reale, e tutto ciò che
  vi viene scritto è dato di produzione.
- **`rebase cloud deploy --preview`** mostra l'anteprima del backend, con le sue app statiche
  incorporate, nello stesso modo in cui la produzione le esegue. Ottiene un backend proprio su
  un **database vuoto tutto suo**, mai quello di produzione. Avviarsi sul database di
  produzione applicherebbe a quest'ultimo lo schema e le regole di accesso dell'anteprima.

Un'anteprima non carica sorgenti e non registra app né hostname, perché ciascuna di
queste operazioni modificherebbe il progetto di produzione. `--source` e `--eject` non possono essere
combinati con `--preview`. Ciascuno compila un'immagine container per la produzione.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

Un'anteprima scade una settimana dopo l'ultimo deploy effettuato su di essa.

Le anteprime sono in fase di rilascio. Un control plane che non le serve ancora rifiuta
`--preview` con `previews_unavailable` e non distribuisce nulla.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback reimposta il progetto su quanto distribuito da una precedente release
riuscita, senza mai ricompilare — l'utilità di un rollback sta nel distribuire un
artefatto che è già stato eseguito con successo.

I requisiti per i deployment idonei dipendono dal modo in cui il progetto è stato distribuito, ed entrambi
i tipi sono supportati:

| Come è stato distribuito | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (build dai sorgenti) | L'immagine pubblicata da quella build |
| `rebase cloud deploy --bundle` (runtime della piattaforma) | Il bundle distribuito da quel deploy, sulla versione di runtime attualmente in esecuzione nel progetto |

Le app statiche incorporate nel bundle del backend (un semplice `rebase cloud deploy` in un progetto con backend) fanno parte di quel bundle, quindi tornano indietro insieme a esso.

Un'app statica distribuita da sola (`rebase cloud deploy <app>`) non supporta ancora il rollback. Il suo deployment registra quale app ha pubblicato, ma nessun bundle, quindi il control plane non ha nulla da cui ripristinarla. La soluzione è distribuire di nuovo l'ultima versione funzionante, per esempio dal commit precedente a quello difettoso. Dopo un deploy di questo tipo, `deploy` lo segnala invece di rimandare a `rollback`.

Quindi un rollback richiede un deployment che abbia registrato uno dei due elementi, il che significa un progetto che ha effettuato il deploy con successo almeno due volte. `rebase cloud deployments` contrassegna quelli idonei e `--json` riporta `rollbackable` per ogni riga insieme all'`image` o al `bundle` che verrebbe ripristinato.

Due categorie di deployment vengono rifiutate, e la CLI specifica quali: quelli non andati
a buon fine e quelli precedenti all'introduzione della registrazione degli artefatti sulla piattaforma. In
entrambi i casi non si effettuano ipotesi — fare ipotesi significherebbe distribuire l'ultimo elemento
compilato o caricato asserendo di ripristinare quello selezionato — pertanto distribuisci direttamente
la versione desiderata.

Ogni deploy riuscito si conclude indicando la via del ritorno (`rebase cloud rollback`), così è in vista nel momento in cui ci si accorge di un rilascio difettoso.

Un rollback aggiunge un nuovo deployment invece di riavvolgere la cronologia, e attende che la versione ripristinata sia operativa prima di segnalare l'esito positivo. Seguilo con `rebase cloud logs -f`.

## CI e agenti

Un job di CI o un agente non dovrebbe utilizzare la tua password. Forniscigli invece
un token: una chiave che agisce per conto del tuo account, limitata a poche azioni su un
singolo progetto. Creala da un terminale autenticato:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

Il token viene mostrato una sola volta, nella forma `export REBASE_TOKEN=rk_live_…`. Con
`REBASE_TOKEN` configurato, ogni comando `rebase cloud` si autentica tramite di esso invece che
con le tue credenziali di accesso, senza mai leggere o scrivere la sessione memorizzata. In GitHub Actions,
salvalo come repository secret ed esponilo con quel nome:

```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec rebase cloud deploy --project shop
        env:
          REBASE_TOKEN: ${{ secrets.REBASE_TOKEN }}
```

`--can` accetta una o più capacità, separate da virgola o ripetute:

| Capacità | Cosa può fare il token |
|---|---|
| `deploy` | Distribuire il progetto e seguirne le build: `deploy`, `deployments` |
| `logs` | Leggere i log di build e runtime, la cronologia dei cron e le metriche in tempo reale: `logs`, `cron`, `metrics` |
| `env` | Leggere e modificare le variabili d'ambiente, inclusi i secret |
| `database` | `db list`, `db info` e `db connect`, che include la password del database |
| `backups` | Elencare, creare, ispezionare e scaricare backup, e consultare la finestra temporale per il PITR |

Dietro le quinte, un token è una [chiave API personale](/docs/backend/api-keys/#personal-keys)
sul control plane. Ciascuna capacità si traduce in alcuni
[scope](/docs/backend/roles-and-scopes/): `deploy` su `shop` include
`project:deploy:<id>`, con l'ID del progetto, oltre agli scope di dati e funzioni
richiamati dai comandi di deploy. Il token non ha mai più privilegi di quanti ne possieda il tuo account nel momento
in cui viene utilizzato, quindi perde automaticamente qualsiasi permesso revocato al tuo account.

Due operazioni restano a uso esclusivo di un utente autenticato:

- **Gestione dei token.** `rebase cloud tokens list`, `create` e `revoke <id>` richiedono
  la sessione di `rebase cloud login`. Un token non può elencare, creare o revocare
  token, poiché un token in grado di emettere token potrebbe generare il proprio successore.
- **Ripristino.** Nessuna capacità autorizza il ripristino di un backup o un'operazione di `restore`
  e `cutover` point-in-time. La sovrascrittura di un database di produzione con dati precedenti resta
  prerogativa di un owner o admin autenticato.

Eseguendo `rebase cloud whoami` con un token impostato vengono mostrate le sue autorizzazioni e il
relativo progetto. Il comando `rebase cloud tokens revoke <id> --yes` lo revoca immediatamente.

## Un backend senza account

Un agent che ha costruito un'app può darle un backend attivo prima che chiunque si sia registrato, e consegnare alla persona per cui lavora un link per tenerlo:

```bash
rebase cloud init --claim
```

Il comando effettua il provisioning di un progetto su Rebase Cloud, imposta `REBASE_BASE_URL` in `.env` sul suo indirizzo attivo, collega la directory ed esegue il deploy delle collection locali con `rebase cloud deploy --bundle`. Stampa l'URL attivo, l'URL del pannello di amministrazione e un **URL di rivendicazione**. Chi apre l'URL di rivendicazione ed effettua l'accesso può spostare il progetto in una delle proprie organizzazioni. Il link funziona una sola volta. Un progetto che nessuno rivendica entro 72 ore viene eliminato, database compreso. Lo strumento `rebase_cloud_provision` del server MCP esegue lo stesso comando e restituisce gli stessi URL.

Finché non viene rivendicato, il progetto non appartiene a nessun account. Il suo token è limitato a quel solo progetto e a `deploy`, `logs`, `env` e `database`. È conservato in `~/.rebase/credentials.json`, mai nel repository, e i comandi `rebase cloud` nella directory collegata lo usano da soli. Scade insieme al progetto.

Quando il deploy ha costruito l'app, il comando imposta anche `REBASE_API_TOKEN` in `.env`: una chiave creata sull'app stessa, che è ciò che il server MCP e l'SDK le inviano. Legge e scrive dati (`data:read`, `data:write`) attraverso la sicurezza a livello di riga dell'app, come un chiamante che non è né una persona né un amministratore. Non ha alcun permesso sul piano di amministrazione e scade con la finestra di rivendicazione. Con `--no-deploy`, o se quel primo deploy fallisce, la chiave non c'è ancora: il successivo `rebase cloud deploy` riuscito nella directory ne chiede una, finché il progetto non è stato rivendicato e `.env` non imposta già `REBASE_API_TOKEN`. Quando il progetto è tuo, crea le chiavi che vuoi nel suo pannello di amministrazione.

La rivendicazione richiede una sessione con accesso effettuato nel browser, non un token, e un metodo di pagamento sull'organizzazione in cui passa il progetto. Dalla rivendicazione in poi il progetto viene fatturato come qualsiasi altro. La rivendicazione revoca anche il token dell'agent: accedi con `rebase cloud login`, oppure crea un nuovo token con `rebase cloud tokens create`.

Il provisioning senza account è limitato per indirizzo e in totale, e un control plane che non lo ha attivato lo rifiuta con un messaggio che lo spiega.

## Risorse di calcolo e relativi costi

Il prezzo di un progetto viene calcolato in base alle risorse riservate, non in base a un piano (tier). `compute` mostra
ogni parametro e il preventivo dettagliato elaborato dal control plane. (`rebase cloud
resources` è un comando diverso: mostra i database e i bucket dichiarati dal codice
e se ciascuno di essi è stato allocato — consulta i [riferimenti della CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Risorse richieste dall'app per istanza, ad es. `500m` e `2Gi`. Vuoto indica il valore predefinito della piattaforma — `100m` e `384Mi`, con burst fino a 2 CPU e `2Gi` |
| `--replicas` | Istanze sempre attive: il limite minimo dell'autoscaler e la quota fatturata a riposo |
| `--autoscale-max` | 1–16. Il limite massimo raggiungibile e il caso peggiore di fatturazione. `--no-autoscale` lo disattiva |
| `--autoscale-cpu-target` | 10–95. L'utilizzo di CPU mantenuto dall'autoscaler, calcolato sulla richiesta anziché sul limite. Vuoto indica 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica, ma soggetta a riavvio senza preavviso |
| `--db-instances` | 1–3. `1` corrisponde a un'istanza singola senza failover; `2` aggiunge uno standby automatico |
| `--db-cpu`, `--db-memory` | Per istanza di database. Vuoto corrisponde a `160m` e `1Gi` |

Un parametro lasciato vuoto non equivale a uno impostato sullo stesso valore numerico: un parametro
vuoto segue il valore predefinito della piattaforma e si aggiorna con esso.

La CLI non esegue alcuna convalida sui parametri, intenzionalmente — i vincoli appartengono al cluster
su cui viene eseguito il progetto e variano in base al provider. Il control plane rifiuta qualsiasi
valore che non può soddisfare indicando il campo interessato. Esegui `rebase cloud compute` per visualizzare
il costo in €/mese prima e dopo la modifica; le variazioni si applicano immediatamente, ripartite pro-rata a partire
da oggi, ad eccezione di quelle che comportano il riavvio del database, che attendono una finestra di manutenzione.

## Il resto dei comandi

| Gruppo di comandi | Cosa copre |
|---|---|
| `login`, `logout`, `whoami` | La tua sessione |
| `tokens` | Token per CI e agenti, ciascuno limitato a un singolo progetto. Vedi [CI e agenti](#ci-e-agenti) |
| `link`, `unlink`, `use`, `open` | Associazione della directory a un progetto, selezione di un'organizzazione, apertura della console |
| `init` | Con `--claim`: un backend attivo senza account e un link per rivendicarlo. Vedi [Un backend senza account](#un-backend-senza-account) |
| `projects` | Creazione, elenco, ispezione, eliminazione |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Distribuzione e monitoraggio |
| `previews` | Build servite al proprio indirizzo da `deploy --preview`, e la loro eliminazione. Vedi [Anteprima di una modifica](#anteprima-di-una-modifica) |
| `start`, `stop`, `restart` | Sospensione di un progetto e ripristino |
| `status`, `metrics`, `debug` | Stato di esecuzione e diagnostica di eventuali errori |
| `cron` | Cron job dell'applicazione distribuita e relative esecuzioni registrate, consultati tramite l'account `rebase cloud`. Sola lettura |
| `env` | Variabili d'ambiente. `list` non mostra mai i valori; `--secret` è di sola scrittura |
| `domains` | Domini personalizzati, record DNS da configurare e verifica. Un progetto può rispondere su più domini, ciascuno verificato singolarmente; `verify` e `remove` richiedono il dominio su cui operare, che può essere omesso solo se ne è presente uno solo (per `verify`, solo se ancora in sospeso). `list --json` restituisce `{ projectId, tenantHost, domains: [...] }` |
| `db` | Collegamento o creazione di un database, connessione locale, backup, ripristino e point-in-time recovery |
| `extensions` | Allowlist delle estensioni Postgres |
| `storage` | Il bucket del progetto |
| `resources` | Database e bucket gestiti dalla piattaforma, a fronte di quanto dichiarato nel codice |
| `compute` | Risorse riservate dal progetto, relativi costi e modalità di modifica |
| `clusters` | I cluster su cui girano i tenant. Riservato agli amministratori della piattaforma |
| `settings`, `orgs`, `webhooks`, `billing` | Impostazioni di progetto, organizzazioni, deploy hook, fatturazione |

Ogni gruppo presente nella tabella risponde a `--help` con una pagina dedicata — sintassi
d'uso, flag ed esempi — e `--help` non esegue mai il comando. Un test verifica
l'indice delle pagine, quindi l'aggiunta di un gruppo privo di pagina fa fallire la build anziché
mostrare il sommario. Il comando `verify:docs` vincola la tabella stessa a tale
indice: ogni gruppo gestito dalla CLI deve comparire qui esattamente una volta; in caso contrario,
la build fallirà.

Se reindirizzato in una pipe, `--help` restituisce una risposta in formato JSON: la stessa sintassi,
i flag e gli esempi strutturati per la lettura programmatica, anziché decine di righe di sequenze di escape da terminale.

## Cosa non include la beta

Chiarito in modo trasparente, per evitare sorprese successive:

- **Nessuna scelta della regione.** Al momento tutto viene eseguito in un'unica regione. Il modello di
  allocazione è predisposto nella piattaforma, ma i progetti non possono selezionare la regione.
  I parametri `projects create --provider` e `--region` non fanno eccezione:
  registrano a quale dei target di deploy registrati nel control plane appartiene il progetto;
  essendocene uno solo, entrambi assumono quel valore predefinito e nessuno dei due sposta il
  progetto altrove. `rebase cloud projects create --help` riporta la medesima indicazione.
- **Nessun self-service.** L'accesso viene accordato a scaglioni; non è possibile iscriversi e pagare autonomamente.
- **Nessun SLA pubblico** e nessuna certificazione SOC 2. Se hai bisogno di uno di questi requisiti,
  segnalalo nella richiesta di accesso anziché darlo per scontato.
- **Nessun deploy per branch**, e nessuna GitHub App proprietaria. I deploy hook —
  URL segreti a cui puntare un webhook del repository — rappresentano il metodo di automazione supportato. I [deploy
  di anteprima](#anteprima-di-una-modifica) sono in fase di rilascio e si avviano dalla CLI.
- **I token agiscono a nome di una persona.** Un [token](#ci-e-agenti) viene generato da un account
  e opera per suo conto; non esistono ancora identità macchina a livello di organizzazione. Se
  effettui l'accesso da CI, passa `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD`
  da un secret manager — `--password` inserisce la password nella cronologia della shell e
  nella tabella dei processi, avvisandoti prima di completare il login. Se il file
  `.rebase/cloud.json` del repository indica un control plane diverso da quello ufficiale della piattaforma,
  passalo anche come `--url`: in assenza di terminale, `login` si rifiuta di inviare le credenziali
  a un host indicato esclusivamente dal file clonato.
- **Point-in-time recovery disponibile solo da CLI.** La console mostra i backup; il flusso
  di lavoro graduale per il PITR è `rebase cloud db pitr`.
- **Nessun endpoint pubblico per il database.** Un database gestito non è esposto a
  Internet, pertanto l'host mostrato nella console è l'indirizzo interno del tuo backend e
  non è risolvibile dal tuo computer locale. Il comando `rebase cloud db connect` apre una porta
  locale verso quel database attraverso un tunnel gestito dal control plane per tutto
  il tempo in cui resta in esecuzione — ma non è disponibile alcun hostname permanente a cui un servizio
  terzo possa collegarsi. Tale tunnel, così come la password mostrata da
  `rebase cloud db info --reveal`, richiedono il ruolo di owner o admin dell'organizzazione:
  lo stesso richiesto dall'editor SQL di Studio, poiché in tutti e tre i casi si ottiene
  una sessione di accesso ai dati di produzione.

## Eseguire in self-hosting

L'utilizzo della piattaforma non comporta alcun vincolo (lock-in). La [guida al self-hosting](/docs/deployment/self-hosting/)
consente di eseguire la medesima immagine e bundle tramite `docker compose`, e la
[guida a Kubernetes](/docs/deployment/kubernetes/) riproduce la stessa topologia tramite
il relativo Helm chart.
