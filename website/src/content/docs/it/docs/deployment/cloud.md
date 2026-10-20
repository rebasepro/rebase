---
sourceHash: a32dc82ba7002b52
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Cos'è, come collegare e distribuire un progetto e cosa non include ancora la beta privata.
---

Rebase Cloud esegue lo stesso Rebase open-source che ospiteresti autonomamente — la stessa immagine `rebasepro/server` pubblicata, lo stesso bundle, lo stesso Postgres. La differenza sta in chi lo gestisce.

:::note[Beta privata]
Rebase Cloud è in **beta privata**. Esegue tenant reali già oggi e apre l'accesso a scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi seguenti richiedono un account a cui è stato concesso l'accesso. Tutto il resto su questo sito funziona senza.
:::

## Cos'è

Un **progetto** Cloud è composto da tre elementi che la piattaforma gestisce per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine di runtime pubblicata. I deploy consistono nel caricamento di un bundle, non nella compilazione di un container |
| **Database** | Un PostgreSQL gestito, con backup automatici e point-in-time recovery |
| **Storage** | Un bucket dedicato, se il tuo progetto utilizza l'archiviazione di file |

Ognuno viene sottoposto a provisioning al primo deploy e fatturato in base a ciò che riserva anziché per utente.

**Nel tuo progetto non cambia nulla per essere eseguito lì.** Lo stesso repository può essere ospitato autonomamente con `docker compose`, e la via d'uscita è reale: `rebase build` produce un bundle che si avvia ovunque venga eseguita l'immagine di runtime.

## Collegare un progetto

Dalla directory di un progetto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono flag ed entrambi sono obbligatori — su un terminale vengono richiesti in modo interattivo, e un'esecuzione headless che ometta l'uno o l'altro termina con `input_required` anziché inventarne uno. **Il sottodominio non è modificabile in seguito:** è l'host `<slug>.rebase.website` su cui risponde il progetto, quindi sceglilo con attenzione.

`--link` associa questa directory al progetto nella stessa chiamata, evitando un passaggio `link` separato. Scrive `.rebase/cloud.json`, che registra l'ID e lo slug del progetto. Quel file non è un segreto e non contiene le tue credenziali — queste si trovano in `~/.rebase/credentials.json`, scritto da `login`.

Tuttavia, viene sottoposto a commit insieme al codice, quindi un repository clonato può indicare qualsiasi control plane. Quando l'host proviene solo da quel file e non è né quello della piattaforma né uno su cui hai effettuato l'accesso in precedenza, `login` ne indica il nome e chiede conferma prima di inviarvi email e password. Senza un terminale, o con `--json`, rifiuta l'operazione con `unknown_control_plane`; passa `--url <host>` (o imposta `REBASE_CLOUD_URL`) per effettuare intenzionalmente l'accesso su tale host.

`billing setup` collega una carta all'organizzazione, una sola volta. Si trova all'inizio della sequenza intenzionalmente: il primo deploy di un progetto viene rifiutato senza di essa, e scoprirlo dopo che un bundle ha terminato il caricamento è l'ordine peggiore.

Un progetto esistente si collega senza crearne uno nuovo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Un solo comando, e nessun flag da ricordare. Il file `rebase.json` generato dallo scaffolding dichiara `runtime: "managed"` per il suo backend e `deploy` legge tale dichiarazione — lo segnala durante l'esecuzione (`rebase.json declares runtime: managed — deploying a bundle`), compila l'app in `dist-bundle`, carica il bundle, lo esegue sull'immagine di runtime pubblicata e segue il deployment fino a uno stato terminale. Il codice di uscita costituisce il verdetto, quindi la stessa riga funziona in modalità non presidiata nella CI.

Termina indicando dove risponde ora ogni app e se la nuova versione è live:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
```

"Live" significa che l'indirizzo ha risposto dopo il build: `/api/health` del backend ha restituito `ok` e la pagina di un'app statica si è caricata (da questo deployment, quando è la piattaforma a servirla). Il controllo attende fino a `--live-timeout` secondi, 60 di default; `0` lo salta. Se un'app non risponde in tempo il deploy esce comunque con codice zero, perché il deployment è riuscito, e l'ultima riga dice quale app non ha risposto e perché. Un deploy fallito termina invece con una riga che indica l'app e il motivo, con `rebase cloud logs` per il log completo del build.

Gli script passano `--json` per ottenere un oggetto con gli stessi dati — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e l'id del deployment. A differenza del resto di `rebase cloud`, `deploy` non passa da solo a JSON in una pipe.

Per distribuire un artefatto compilato in precedenza — ad esempio, un job di CI che compila una sola volta ed esegue il deploy due volte — punta alla directory anziché ricompilare:

Ciò che tale runtime consente — pacchetti e moduli nativi, memoria e istanze, timeout e dimensioni del body, filesystem, secret, storage e rete in uscita — è descritto nella relativa pagina:
[Runtime backend gestito](/docs/deployment/managed-runtime/).

Per distribuire un artefatto creato in precedenza — ad esempio un job di CI che compila una volta ed esegue il deploy due volte — punta alla directory invece di ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

L'abbandono del runtime gestito avviene tramite un flag apposito, `--eject`, e nient'altro lo richiede: una build che sposterebbe un progetto gestito su un'immagine container di cui diventa proprietario viene rifiutata finché non lo confermi esplicitamente. In precedenza questo era il significato di `--force`, che metteva l'operazione meno reversibile della CLI sotto la stessa dicitura di "sovrascrivi questo file"; ora è un'opzione sconosciuta anziché un alias, quindi uno script che la contiene si interrompe.

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

`status` riporta `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la piattaforma sta effettivamente lavorando e fare polling è la cosa giusta da fare; quando indica un valore, significa che quel qualcosa è in attesa di una tua azione.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback reindirizza il progetto a quanto distribuito da un precedente deployment completato con successo e non ricompila mai — il valore di un rollback risiede nel fatto che distribuisce un artefatto che è già stato eseguito.

Quali deployment siano idonei dipende da come il progetto viene distribuito, ed entrambi i tipi funzionano:

| Come è stato distribuito | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (una build dai sorgenti) | L'immagine pubblicata da quella build |
| `rebase cloud deploy --bundle` (il runtime della piattaforma) | Il bundle distribuito da quel deploy, sulla versione del runtime attualmente in esecuzione per il progetto |

Le app statiche incorporate nel bundle del backend (un semplice `rebase cloud deploy` in un progetto con backend) fanno parte di quel bundle, quindi tornano indietro insieme a esso.

Un'app statica distribuita da sola (`rebase cloud deploy <app>`) non supporta ancora il rollback. Il suo deployment registra quale app ha pubblicato, ma nessun bundle, quindi il control plane non ha nulla da cui ripristinarla. La soluzione è distribuire di nuovo l'ultima versione funzionante, per esempio dal commit precedente a quello difettoso. Dopo un deploy di questo tipo, `deploy` lo segnala invece di rimandare a `rollback`.

Quindi un rollback richiede un deployment che abbia registrato uno dei due elementi, il che significa un progetto che ha effettuato il deploy con successo almeno due volte. `rebase cloud deployments` contrassegna quelli idonei e `--json` riporta `rollbackable` per ogni riga insieme all'`image` o al `bundle` che verrebbe ripristinato.

Due tipi di deployment vengono rifiutati, e la CLI specifica quali: uno che non ha avuto successo e uno risalente a prima che la piattaforma iniziasse a registrare gli artefatti. Non c'è nulla da ipotizzare in entrambi i casi — tirare a indovinare distribuirebbe qualunque cosa sia stata creata o caricata più di recente dichiarando al contempo di ripristinare questo — quindi effettua invece il deploy della versione desiderata.

Ogni deploy riuscito si conclude indicando la via del ritorno (`rebase cloud rollback`), così è in vista nel momento in cui ci si accorge di un rilascio difettoso.

Un rollback aggiunge un nuovo deployment invece di riavvolgere la cronologia, e attende che la versione ripristinata sia operativa prima di segnalare l'esito positivo. Seguilo con `rebase cloud logs -f`.

## CI e agenti

Un job di CI o un agente non dovrebbe contenere la tua password. Forniscigli invece un token: una chiave che agisce per conto del tuo account, limitata a poche azioni su un singolo progetto. Creala da un terminale autenticato:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

Il token viene stampato una sola volta, sotto forma di riga `export REBASE_TOKEN=rk_live_…`. Con `REBASE_TOKEN` impostato, ogni comando `rebase cloud` si autentica con esso anziché con il tuo login, senza mai leggere o scrivere la sessione memorizzata. In GitHub Actions, salvalo come repository secret ed esponilo con quel nome:

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

`--can` accetta una o più capability, separate da virgola o ripetute:

| Capability | Cosa può fare il token |
|---|---|
| `deploy` | Eseguire il deploy del progetto e seguirne le build: `deploy`, `deployments` |
| `logs` | Leggere i log di build e di runtime, e le metriche in tempo reale: `logs`, `metrics` |
| `env` | Leggere e modificare le variabili d'ambiente, inclusi i secret |
| `database` | `db list`, `db info` e `db connect`, che include la password del database |
| `backups` | Elencare, creare, ispezionare e scaricare backup, e leggere la finestra di point-in-time |

Dietro le quinte, un token è una [chiave API personale](/docs/backend/api-keys/#personal-keys) sul control plane. Ogni capability si traduce in alcuni [scope](/docs/backend/roles-and-scopes/): `deploy` su `shop` contiene `project:deploy:<id>`, con l'ID del progetto, oltre agli scope di dati e funzioni chiamati dai comandi di deploy. Il token non detiene mai più permessi di quanti ne abbia il tuo account nel momento in cui viene utilizzato, quindi perde automaticamente qualsiasi permesso revocato al tuo account.

Due operazioni rimangono riservate a un utente autenticato:

- **Gestione dei token.** `rebase cloud tokens list`, `create` e `revoke <id>` richiedono la sessione del tuo `rebase cloud login`. Un token non può elencare, creare o revocare token, perché un token in grado di coniare token potrebbe coniare il proprio successore.
- **Ripristino.** Nessuna capability concede il ripristino di un backup o le operazioni di point-in-time `restore` e `cutover`. La sovrascrittura di dati esistenti su un database in produzione rimane riservata a un owner o admin autenticato.

`rebase cloud whoami` con un token impostato mostra cosa può fare e su quale progetto. `rebase cloud tokens revoke <id> --yes` lo revoca immediatamente.

## Compute e relativi costi

Il prezzo di un progetto si basa sulle risorse riservate, non su un piano fisso. `compute` mostra ogni parametro e il relativo preventivo dettagliato del control plane. (`rebase cloud resources` è una cosa diversa: i database e i bucket dichiarati dal codice, e lo stato di provisioning di ciascuno — consulta il [riferimento CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Risorse richieste per istanza dell'app, ad es. `500m` e `2Gi`. Vuoto indica il valore predefinito della piattaforma — `250m` e `512Mi` |
| `--replicas` | Istanze sempre attive: il limite minimo dell'autoscaler e ciò per cui il progetto viene fatturato a riposo |
| `--autoscale-max` | 1–16. Il tetto massimo raggiungibile e il caso peggiore di fatturazione. `--no-autoscale` lo disattiva |
| `--autoscale-cpu-target` | 10–95. L'utilizzo di CPU mantenuto dall'autoscaler, calcolato rispetto alla richiesta anziché al limite. Vuoto indica 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica, ma soggetta a riavvii senza preavviso |
| `--scale-to-zero` | `true` o `false`. Compute fatturato a richiesta che si arresta quando inattivo, al costo di un cold start |
| `--db-instances` | 1–3. `1` indica un'istanza singola senza failover; `2` aggiunge uno standby automatico |
| `--db-cpu`, `--db-memory`, `--storage` | Per istanza di database. Vuoto indica `500m`, `2Gi` e il volume predefinito |

Un parametro vuoto non equivale a uno impostato sullo stesso valore: un parametro vuoto segue il valore predefinito della piattaforma e si aggiorna quando questo cambia.

Nessun valore viene convalidato dalla CLI, intenzionalmente — i limiti appartengono al cluster su cui viene eseguito un progetto e variano a seconda dei provider. Il control plane rifiuta un valore che non può soddisfare indicando il campo specifico. Esegui `rebase cloud compute` per visualizzare il costo in €/mese prima e dopo; le modifiche si applicano immediatamente, con calcolo proporzionale a partire da oggi, a eccezione di quelle che comportano il riavvio del database, che attendono una finestra di manutenzione.

## Gli altri comandi disponibili

| Gruppo di comandi | Cosa include |
|---|---|
| `login`, `logout`, `whoami` | La tua sessione |
| `tokens` | Token per CI e agenti, ciascuno limitato a un singolo progetto. Vedi [CI e agenti](#ci-e-agenti) |
| `link`, `unlink`, `use`, `open` | Associazione di questa directory a un progetto, selezione di un'organizzazione, apertura della console |
| `projects` | Creazione, elenco, ispezione, eliminazione |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Distribuzione e monitoraggio |
| `start`, `stop`, `restart` | Sospensione di un progetto e riattivazione |
| `status`, `metrics`, `debug` | Cosa sta facendo e perché non funziona |
| `cron` | I cron job dell'app distribuita e le relative esecuzioni registrate, letti tramite il tuo login `rebase cloud`. Di sola lettura |
| `env` | Variabili d'ambiente. `list` non stampa mai i valori; `--secret` è di sola scrittura |
| `domains` | Domini personalizzati, record DNS da aggiungere e verifica. Un progetto può rispondere su più domini, ciascuno verificato singolarmente; `verify` e `remove` accettano il dominio su cui operare, che può essere omesso solo quando ce n'è uno solo (per `verify`, uno ancora in sospeso). `list --json` restituisce `{ projectId, tenantHost, domains: [...] }` |
| `db` | Collegamento o creazione di un database, connessione a esso dalla propria macchina, backup, ripristino e point-in-time recovery |
| `extensions` | L'allowlist delle estensioni Postgres |
| `storage` | Il bucket del progetto |
| `resources` | Quali database e bucket sono gestiti dalla piattaforma, a fronte di quanto dichiarato nel codice |
| `compute` | Cosa riserva questo progetto, quanto costa e come modificarlo |
| `clusters` | I cluster su cui vengono eseguiti i tenant. Riservato agli amministratori della piattaforma |
| `settings`, `orgs`, `webhooks`, `billing` | Impostazioni del progetto, organizzazioni, webhook di deploy, pagamenti |

Ogni gruppo in questa tabella risponde a `--help` con una pagina dedicata — una riga di utilizzo, i relativi flag ed esempi — e `--help` non esegue mai il comando. Un test mantiene l'indice delle pagine, quindi un gruppo aggiunto senza una pagina associata fa fallire la build anziché rispondere con il sommario. `verify:docs` vincola la tabella stessa a tale indice: ogni gruppo gestito dalla CLI compare qui esattamente una volta, pertanto anche un gruppo aggiunto senza una corrispondente riga farà fallire la build.

Se reindirizzato in una pipe, `--help` risponde invece in formato JSON: la stessa riga di utilizzo, flag ed esempi sotto forma di struttura da leggere anziché sessanta righe di sequenze di escape del terminale.

## Cosa non include la beta

Detto chiaramente, perché scoprirlo in seguito è peggio:

- **Nessuna scelta della regione.** Attualmente tutto viene eseguito in un'unica regione. Il modello di posizionamento esiste nella piattaforma, ma un progetto non può scegliere una regione. `projects create --provider` e `--region` non costituiscono l'eccezione che sembrano: registrano a quale dei target di deploy registrati del control plane appartiene un progetto; essendocene uno solo, entrambi assumono quel valore predefinito e nessuno dei due sposta il progetto altrove. `rebase cloud projects create --help` riporta la stessa indicazione.
- **Non è self-service.** L'accesso viene concesso a scaglioni; non è disponibile una registrazione immediata con pagamento diretto.
- **Nessun SLA pubblicato** e nessuna certificazione SOC 2. Se hai bisogno dell'uno o dell'altra, segnalalo al momento della richiesta di accesso anziché darlo per scontato.
- **Nessun deploy di anteprima o di branch** e nessuna GitHub App proprietaria. I deploy hook — URL segreti a cui puntare un webhook del repository — rappresentano l'automazione supportata.
- **I token agiscono per conto di una persona.** Un [token](#ci-e-agenti) viene generato da un account e agisce come tale; non esiste ancora un'identità macchina gestita dall'organizzazione. Se invece effettui l'accesso da CI, passa `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` da un secret store — `--password` inserisce la password nella cronologia della shell e nella tabella dei processi, e lo notifica prima di completare l'accesso. Se il file `.rebase/cloud.json` del repository fa riferimento a un control plane diverso da quello della piattaforma, passalo anche tramite `--url`: in assenza di un terminale, `login` rifiuta di inviare una password a un host specificato unicamente nel file clonato.
- **Il point-in-time recovery è disponibile solo da CLI.** La console mostra i backup; il flusso di lavoro PITR a fasi è `rebase cloud db pitr`.
- **Nessun endpoint pubblico per il database.** Un database gestito non è esposto a Internet, quindi l'host mostrato dalla console è l'indirizzo utilizzato dal tuo backend e non si risolve sulla tua macchina locale. `rebase cloud db connect` apre una porta locale associata al database, incanalata tramite un tunnel attraverso il control plane per tutto il tempo in cui viene lasciata in esecuzione — ma non esiste un hostname permanente a cui un servizio di terze parti possa connettersi. Quel tunnel e la password visibile con `rebase cloud db info --reveal` richiedono entrambi il ruolo di owner o admin dell'organizzazione: lo stesso richiesto dall'editor SQL di Studio, poiché tutte e tre le modalità consentono una sessione di accesso diretto ai dati di produzione.

## Hosting autonomo in alternativa

Niente di tutto questo comporta un lock-in. La [guida all'hosting autonomo](/docs/deployment/self-hosting/) esegue l'identica immagine e lo stesso bundle con `docker compose`, mentre la [guida a Kubernetes](/docs/deployment/kubernetes/) riproduce la stessa topologia a partire dall'Helm chart.
