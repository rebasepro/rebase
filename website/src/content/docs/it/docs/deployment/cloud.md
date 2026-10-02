---
sourceHash: 52e128ca94563aec
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Di cosa si tratta, come collegare ed eseguire il deploy di un progetto e cosa non include ancora la beta privata.
---

Rebase Cloud esegue lo stesso Rebase open-source che ospiteresti in self-hosting: la stessa immagine `rebasepro/server` pubblicata, lo stesso bundle, lo stesso Postgres. La differenza sta in chi lo gestisce.

:::note[Beta privata]
Rebase Cloud è in **beta privata**. Attualmente esegue tenant reali e apre gli accessi a scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi seguenti richiedono un account a cui è stato concesso l'accesso. Tutto il resto su questo sito funziona senza di esso.
:::

## Di cosa si tratta

Un **progetto** Cloud è costituito da tre elementi che la piattaforma gestisce per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine di runtime pubblicata. I deploy consistono nel caricamento di un bundle, non nella compilazione di un container |
| **Database** | Un PostgreSQL gestito, con backup automatizzati e point-in-time recovery |
| **Storage** | Un bucket dedicato, se il tuo progetto utilizza lo storage di file |

Ognuno viene sottoposto a provisioning al primo deploy e viene fatturato in base a ciò che riserva piuttosto che per postazione.

**Nulla cambia nel tuo progetto per essere eseguito lì.** Lo stesso repository funziona in self-hosting con `docker compose`, e la via di fuga è reale: `rebase build` produce un bundle che si avvia ovunque sia eseguibile l'immagine di runtime.

## Collegare un progetto

Dalla directory di un progetto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono flag ed entrambi sono obbligatori: su un terminale vengono richiesti in modo interattivo, mentre un'esecuzione headless che ometta uno dei due termina con `input_required` anziché inventarne uno. **Il sottodominio non è modificabile successivamente:** è l'host `<slug>.rebase.website` su cui risponde il progetto, quindi sceglilo con attenzione.

`--link` associa questa directory al progetto nella stessa chiamata, quindi non c'è una fase di `link` separata. Scrive `.rebase/cloud.json`, che registra l'ID del progetto e lo slug. Quel file non è un segreto e non rappresenta le tue credenziali: queste si trovano in `~/.rebase/credentials.json`, scritto da `login`.

Viene però incluso nel commit insieme al codice, quindi un repository clonato può indicare qualsiasi control plane. Quando l'host proviene solo da quel file, e non è né quello della piattaforma né uno su cui hai già effettuato l'accesso in precedenza, `login` lo indica e chiede conferma prima di inviarvi la tua email e la tua password. Senza un terminale, o con `--json`, rifiuta con `unknown_control_plane`; passa `--url <host>` (oppure imposta `REBASE_CLOUD_URL`) per accedere lì intenzionalmente.

`billing setup` associa una carta all'organizzazione, una sola volta. È posizionato all'inizio della sequenza di proposito: il primo deploy di un progetto viene rifiutato senza una carta, e scoprirlo dopo aver completato l'upload di un bundle è l'ordine peggiore.

Un progetto esistente si collega senza crearne uno nuovo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Un solo comando, e nessun flag da ricordare. Il file `rebase.json` di uno scaffold dichiara `runtime: "managed"` per il suo backend, e `deploy` legge tale dichiarazione — lo segnala durante l'esecuzione (`rebase.json declares runtime: managed — deploying a bundle`), compila l'app in `dist-bundle`, carica il bundle, lo esegue sull'immagine di runtime pubblicata e segue il deployment fino a uno stato terminale. Il codice di uscita rappresenta l'esito, quindi la stessa riga funziona in modalità non presidiata nella CI.

Per distribuire un artefatto compilato in precedenza — ad esempio, un job di CI che compila una sola volta ed esegue il deploy due volte — punta alla directory anziché ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

L'abbandono del runtime gestito ha un flag dedicato, `--eject`, e nient'altro lo richiede: una build che sposterebbe un progetto gestito su un'immagine container di cui diventa proprietario viene rifiutata finché non lo specifichi esplicitamente. In precedenza `--force` aveva questo significato, associando l'operazione meno reversibile della CLI alla stessa parola usata per "sovrascrivi questo file"; ora è un'opzione sconosciuta anziché un alias, quindi uno script che la contiene si interrompe.

Monitora l'avanzamento:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` riporta `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la piattaforma sta effettivamente lavorando ed eseguire il polling è la cosa giusta da fare; quando indica qualcosa, quel qualcosa è in attesa di una tua azione.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback ripunta il progetto a ciò che un deployment precedente riuscito ha distribuito, e non ricompila mai: il valore di un rollback risiede nel distribuire un artefatto che è già stato eseguito.

Quali deployment siano idonei dipende da come il progetto esegue il deploy, ed entrambi i tipi funzionano:

| Modalità di deploy | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (una build dai sorgenti) | L'immagine pubblicata da quella build |
| `rebase cloud deploy --bundle` (il runtime della piattaforma) | Il bundle distribuito da quel deploy, sulla versione di runtime attualmente in esecuzione per il progetto |

Quindi un rollback richiede un deployment che abbia registrato uno dei due elementi, il che significa un progetto che ha effettuato il deploy con successo almeno due volte. `rebase cloud deployments` contrassegna quelli idonei e `--json` riporta `rollbackable` per ogni riga insieme all'`image` o al `bundle` che verrebbe ripristinato.

Due tipi di deployment vengono rifiutati, e la CLI indica quali: uno non andato a buon fine e uno risalente a prima che la piattaforma iniziasse a registrare gli artefatti. Non c'è nulla da tirare a indovinare in entrambi i casi — tirare a indovinare distribuirebbe qualsiasi cosa sia stata compilata o caricata più di recente fingendo di ripristinare questa versione — quindi esegui invece il deploy della versione desiderata.

Un rollback aggiunge un nuovo deployment invece di riavvolgere la cronologia, e attende che la versione ripristinata sia operativa prima di segnalare l'esito positivo. Seguilo con `rebase cloud logs -f`.

## CI e agent

<span class="since-badge" data-since="0.24">Da 0.24</span> Un job di CI o un agent non dovrebbe portarsi dietro la tua password. Dagli invece un token: una chiave che agisce come il tuo account, limitata a poche azioni su un progetto. Crealo da un terminale in cui hai effettuato l'accesso:

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

Il token viene stampato una sola volta, come riga `export REBASE_TOKEN=rk_live_…`. Con `REBASE_TOKEN` impostata, ogni comando `rebase cloud` si autentica con il token invece che con il tuo login, e non legge né scrive mai la sessione salvata. In GitHub Actions, salvalo come secret del repository ed esponilo con quel nome:

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

`--can` accetta una o più capacità, separate da virgole o ripetute:

| Capacità | Cosa può fare il token |
|---|---|
| `deploy` | Fare il deploy del progetto e seguirne le build: `deploy`, `deployments` |
| `logs` | Leggere i log di build e di runtime, e le metriche in tempo reale: `logs`, `metrics` |
| `env` | Leggere e modificare le variabili d'ambiente, secret compresi |
| `database` | `db list`, `db info` e `db connect`, che include la password del database |
| `backups` | Elencare, creare, ispezionare e scaricare i backup, e leggere la finestra di point-in-time recovery |

Internamente un token è una [chiave API personale](/docs/backend/api-keys/#personal-keys) sul control plane. Ogni capacità diventa alcuni [scope](/docs/backend/roles-and-scopes/): `deploy` su `shop` possiede `project:deploy:<id>`, con l'id del progetto, più gli scope di dati e di funzioni che i comandi di deploy chiamano. Il token non possiede mai più di quanto possieda il tuo account nel momento in cui viene usato, quindi perde tutto ciò che perde il tuo account.

Due cose restano a una persona che ha effettuato l'accesso:

- **Gestire i token.** `rebase cloud tokens list`, `create` e `revoke <id>` usano la tua sessione di `rebase cloud login`. Un token non può elencare, creare né revocare token, perché un token in grado di creare token potrebbe creare il proprio successore.
- **Ripristinare.** Nessuna capacità consente di ripristinare un backup né di eseguire `restore` e `cutover` di un point-in-time recovery. Rimettere dati vecchi su un database in produzione resta compito di un owner o di un admin che ha effettuato l'accesso.

`rebase cloud whoami`, con un token impostato, mostra cosa può fare e su quale progetto. `rebase cloud tokens revoke <id> --yes` lo ferma subito.

## Risorse di calcolo e relativi costi

Il prezzo di un progetto si basa sulle risorse riservate, non su un piano tariffario (tier). `compute` mostra ogni parametro e il relativo preventivo dettagliato fornito dal control plane. (`rebase cloud resources` è una cosa diversa: i database e i bucket dichiarati dal codice, e lo stato di provisioning di ciascuno — consulta il [riferimento della CLI](/docs/cli/#rebase-cloud).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Richiesta (request) dell'app per istanza, es. `500m` e `2Gi`. Vuoto indica il valore predefinito della piattaforma — `250m` e `512Mi` |
| `--replicas` | Istanze sempre attive: il limite minimo dell'autoscaler e ciò per cui il progetto viene fatturato a riposo |
| `--autoscale-max` | 1–16. Il tetto massimo raggiungibile e il costo peggiore fatturabile. `--no-autoscale` lo disattiva |
| `--autoscale-cpu-target` | 10–95. L'utilizzo della CPU mantenuto dall'autoscaler, calcolato sulla request anziché sul limit. Vuoto indica 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica e riavviata senza preavviso |
| `--scale-to-zero` | `true` o `false`. Risorse di calcolo fatturate a richiesta che si arrestano quando inattive, al costo di un cold start |
| `--db-instances` | 1–3. `1` è una singola istanza senza failover; `2` aggiunge uno standby automatico |
| `--db-cpu`, `--db-memory`, `--storage` | Per istanza di database. Vuoto indica `500m`, `2Gi` e il volume predefinito |

Un parametro lasciato vuoto non equivale a uno fissato sullo stesso valore numerico: un parametro vuoto segue le impostazioni predefinite della piattaforma e cambia quando queste cambiano.

Nessun valore viene convalidato dalla CLI, intenzionalmente: i limiti appartengono al cluster su cui è in esecuzione il progetto e differiscono tra i vari provider. Il control plane rifiuta i valori che non può soddisfare indicando il campo specifico. Esegui `rebase cloud compute` per visualizzare il costo in €/mese prima e dopo; una modifica si applica immediatamente, ripartita proporzionalmente da oggi, tranne quella che comporta il riavvio del database, che attende una finestra di manutenzione.

## La restante superficie dei comandi

| Gruppo di comandi | Cosa comprende |
|---|---|
| `login`, `logout`, `whoami` | La tua sessione |
| `tokens` | Token per la CI e gli agent, ciascuno limitato a un progetto. Vedi [CI e agent](#ci-e-agent) |
| `link`, `unlink`, `use`, `open` | Associazione di questa directory a un progetto, selezione dell'organizzazione, apertura della console |
| `projects` | Creazione, visualizzazione, ispezione, eliminazione |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Rilascio e monitoraggio |
| `start`, `stop`, `restart` | Sospensione di un progetto e ripristino |
| `status`, `metrics`, `debug` | Cosa sta facendo e perché non funziona |
| `env` | Variabili d'ambiente. `list` non stampa mai i valori; `--secret` è di sola scrittura |
| `domains` | Domini personalizzati, record DNS da aggiungere e verifica. Un progetto può rispondere su più domini, ciascuno verificato separatamente; `verify` e `remove` accettano il dominio su cui agire, che può essere omesso solo quando ce n'è uno (per `verify`, uno ancora in attesa). `list --json` restituisce `{ projectId, tenantHost, domains: [...] }` |
| `db` | Connessione o creazione di un database, connessione dalla tua macchina, backup, ripristino e point-in-time recovery |
| `extensions` | L'elenco consentito (allowlist) delle estensioni Postgres |
| `storage` | Il bucket del progetto |
| `resources` | Quali database e bucket sono gestiti dalla piattaforma rispetto a quanto dichiarato dal codice |
| `compute` | Cosa riserva questo progetto, quanto costa e come modificarlo |
| `clusters` | I cluster su cui girano i tenant. Solo per amministratori della piattaforma |
| `settings`, `orgs`, `webhooks`, `billing` | Impostazioni di progetto, organizzazioni, webhook di deploy, pagamenti |

Ogni gruppo in quella tabella risponde a `--help` con una pagina dedicata — una riga di sintassi d'uso, i relativi flag ed esempi — e `--help` non esegue mai il comando. Un test verifica l'indice delle pagine, quindi un gruppo aggiunto senza una pagina fa fallire la build anziché rispondere con il sommario. `verify:docs` vincola la tabella stessa a tale indice: ogni gruppo gestito dalla CLI compare qui esattamente una volta, quindi anche un gruppo aggiunto senza una riga corrispondente farà fallire la build.

Se reindirizzato tramite pipe, `--help` risponde invece in formato JSON: la stessa riga di utilizzo, flag ed esempi strutturati per la lettura anziché sessanta righe di sequenze di escape del terminale.

## Cosa non include la beta

Detto chiaramente, perché scoprirlo in seguito è peggio:

- **Nessuna scelta della regione.** Al momento tutto viene eseguito in un'unica regione. Il modello di posizionamento esiste nella piattaforma, ma un progetto non può scegliere una regione. `projects create --provider` e `--region` non sono l'eccezione che sembrano: registrano a quale dei target di deploy registrati del control plane appartiene un progetto, e ce n'è solo uno, quindi entrambi usano tale valore predefinito e nessuno dei due sposta un progetto altrove. `rebase cloud projects create --help` conferma la stessa cosa.
- **Nessun servizio self-service.** L'accesso viene concesso a scaglioni; non è prevista una procedura di registrazione e pagamento immediata.
- **Nessun SLA pubblicato** e nessuna certificazione SOC 2. Se hai bisogno di uno dei due, segnalalo al momento della richiesta di accesso anziché darlo per scontato.
- **Nessun deploy di preview o di branch**, e nessuna GitHub App proprietaria. Gli hook di deploy — URL segreti a cui puntare il webhook del repository — sono l'automazione supportata.
- **I token agiscono come una persona.** Un [token](#ci-e-agent) viene creato da un account e agisce come quell'account; non esiste ancora un'identità macchina di proprietà dell'organizzazione. Se invece accedi dalla CI, passa `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` da un gestore di segreti — `--password` memorizza la password nella cronologia della shell e nella tabella dei processi, e lo segnala prima di effettuare l'accesso. Se il `.rebase/cloud.json` del repository indica un control plane diverso da quello della piattaforma, passalo anche come `--url`: senza un terminale, `login` si rifiuta di inviare una password a un host indicato soltanto dal file estratto.
- **Il point-in-time recovery è disponibile solo da CLI.** La console mostra i backup; il flusso di lavoro di PITR a stadi si esegue con `rebase cloud db pitr`.
- **Nessun endpoint pubblico per il database.** Un database gestito non è esposto a Internet, pertanto l'host visualizzato nella console è l'indirizzo utilizzato dal backend e non si risolve a nulla sulla tua macchina locale. `rebase cloud db connect` apre una porta locale collegata al database, incanalata tramite tunnel attraverso il control plane per tutto il tempo in cui viene mantenuta attiva — tuttavia non esiste un hostname permanente a cui un servizio di terze parti possa connettersi. Quel tunnel e la password visibile tramite `rebase cloud db info --reveal` richiedono entrambi il ruolo di owner o admin dell'organizzazione: lo stesso richiesto dall'editor SQL di Studio, poiché tutti e tre consentono l'accesso a una sessione sui tuoi dati di produzione.

## Alternativa con self-hosting

Niente di tutto questo comporta un lock-in. La [guida al self-hosting](/docs/deployment/self-hosting/) esegue la medesima immagine e bundle con `docker compose`, mentre la [guida a Kubernetes](/docs/deployment/kubernetes/) riproduce la stessa topologia tramite il chart Helm.
