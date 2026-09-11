---
sourceHash: 535999d55c2b1a7c
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Di cosa si tratta, come collegare e distribuire un progetto e cosa non include ancora la beta privata.
---

Rebase Cloud esegue lo stesso Rebase open source che ospiteresti in self-hosting: la stessa immagine `rebasepro/server` pubblicata, lo stesso bundle, lo stesso Postgres. La differenza sta in chi lo gestisce.

:::note[Beta privata]
Rebase Cloud è in **beta privata**. Oggi gestisce tenant reali e apre l'accesso a scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi seguenti richiedono un account già abilitato. Tutto il resto su questo sito funziona senza di esso.
:::

## Di cosa si tratta

Un **progetto** Cloud è costituito da tre elementi gestiti dalla piattaforma per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine di runtime pubblicata. I deploy consistono nel caricamento di un bundle, non nella compilazione di un container |
| **Database** | Un PostgreSQL gestito, con backup automatici e point-in-time recovery |
| **Storage** | Un bucket dedicato, se il tuo progetto utilizza l'archiviazione di file |

Ciascuno viene allocato al primo deploy e viene fatturato per le risorse che riserva anziché per utente.

**Nulla del tuo progetto cambia per essere eseguito lì.** Lo stesso repository funziona in self-hosting con `docker compose`, e la via d'uscita è reale: `rebase build` produce un bundle che si avvia ovunque sia possibile eseguire l'immagine di runtime.

## Collegare un progetto

Dalla directory di un progetto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono flag ed entrambi sono obbligatori: da terminale vengono richiesti in modo interattivo, mentre un'esecuzione headless che ometta uno dei due termina con `input_required` anziché inventarne uno. **Il sottodominio non è modificabile in seguito:** è l'host `<slug>.rebase.website` a cui risponde il progetto, quindi sceglilo con attenzione.

`--link` associa questa directory al progetto nella stessa chiamata, quindi non è necessario alcun passaggio `link` separato. Scrive il file `.rebase/cloud.json`, che registra l'ID e lo slug del progetto. Quel file non è un segreto e non contiene le tue credenziali, le quali si trovano in `~/.rebase/credentials.json`, generate da `login`.

`billing setup` associa una carta all'organizzazione, una sola volta. Si trova all'inizio della sequenza intenzionalmente: il primo deploy di un progetto viene rifiutato senza di essa, e scoprirlo dopo che il bundle ha terminato il caricamento sarebbe l'esperienza peggiore.

Un progetto esistente può essere collegato senza crearne uno nuovo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Un solo comando e nessun flag da ricordare. Il file `rebase.json` di uno scaffold dichiara `runtime: "managed"` per il proprio backend e `deploy` legge tale dichiarazione — segnalandolo durante il processo (`rebase.json declares runtime: managed — deploying a bundle`), compila l'applicazione in `dist-bundle`, carica il bundle, lo esegue sull'immagine di runtime pubblicata e segue il deployment fino a uno stato terminale. Il codice di uscita rappresenta l'esito, quindi la stessa riga funziona in modalità non presidiata nella CI.

Per distribuire un artefatto compilato in precedenza — ad esempio, un job di CI che compila una volta e distribuisce due volte — punta direttamente alla directory invece di ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

L'abbandono del runtime gestito ha un flag dedicato, `--eject`, e nient'altro lo richiede: una compilazione che sposterebbe un progetto gestito su un'immagine container di cui assume la proprietà viene rifiutata finché non lo specifichi. In precedenza si usava `--force` per questo scopo, associando l'operazione meno reversibile della CLI alla stessa parola usata per "sovrascrivi questo file"; ora non è più un alias ma un'opzione sconosciuta, quindi uno script che la contiene si interrompe.

Monitoralo:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` riporta `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la piattaforma sta effettivamente lavorando e fare polling è l'operazione corretta; quando indica un valore, quell'elemento è in attesa di una tua azione.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback reindirizza il progetto a quanto distribuito da un precedente deployment andato a buon fine e non ricompila mai: il valore di un rollback sta nel distribuire un artefatto che è già stato eseguito con successo.

Quali deployment siano idonei dipende da come il progetto viene distribuito, ed entrambi i metodi sono supportati:

| Modalità di deploy | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (build dai sorgenti) | L'immagine pubblicata da quella build |
| `rebase cloud deploy --bundle` (runtime della piattaforma) | Il bundle distribuito da quel deploy, sulla versione del runtime attualmente in esecuzione nel progetto |

Di conseguenza, un rollback richiede un deployment che abbia registrato uno dei due elementi, il che presuppone un progetto distribuito con successo almeno due volte. `rebase cloud deployments` contrassegna quelli idonei, e `--json` riporta `rollbackable` per ciascuna riga insieme all'`image` o al `bundle` che verrebbe ripristinato.

Due tipologie di deployment vengono rifiutate e la CLI specifica quali: una che non è andata a buon fine e una precedente al momento in cui la piattaforma ha iniziato a registrarne l'artefatto. In entrambi i casi non c'è nulla da ipotizzare — tirare a indovinare porterebbe a distribuire qualsiasi elemento compilato o caricato più di recente pretendendo di ripristinare questo — pertanto esegui invece il deploy della versione desiderata.

Un rollback aggiunge un nuovo deployment invece di riscrivere la cronologia e attende che la versione ripristinata sia pronta a rispondere prima di segnalare il successo. Seguilo con `rebase cloud logs -f`.

## Compute e quanto costa

Il prezzo di un progetto si basa sulle risorse che riserva, non su un piano tariffario fisso. `compute` stampa ogni parametro di configurazione e il relativo preventivo dettagliato fornito dal control plane. (`rebase cloud resources` è una cosa diversa: riguarda i database e i bucket dichiarati dal codice e se ciascuno di essi è allocato — consulta il [riferimento CLI](/docs/cli/#rebase-cloud)).

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Richiesta dell'app per istanza, ad es. `500m` e `2Gi`. Se vuoto, viene utilizzato il valore predefinito della piattaforma: `250m` e `512Mi` |
| `--replicas` | Istanze sempre attive: il limite minimo dell'autoscaler e ciò per cui il progetto viene fatturato a riposo |
| `--autoscale-max` | 1–16. Il limite massimo raggiungibile e lo scenario peggiore di fatturazione. `--no-autoscale` lo disattiva |
| `--autoscale-cpu-target` | 10–95. L'utilizzo della CPU mantenuto dall'autoscaler, calcolato rispetto alla richiesta (request) anziché al limite. Se vuoto, il valore predefinito è 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica e riavviata senza preavviso |
| `--scale-to-zero` | `true` o `false`. Risorse di calcolo fatturate per richiesta che si arrestano quando inattive, al costo di un cold start |
| `--db-mode` | `shared` (cluster condiviso in pool) o `dedicated` (un'istanza dedicata a questo progetto) |
| `--db-instances` | 1–3. `1` indica una singola istanza senza failover; `2` aggiunge un'istanza di standby automatico |
| `--db-cpu`, `--db-memory`, `--storage` | Per istanza di database. Se vuoto, corrisponde a `500m`, `2Gi` e al volume predefinito |

Un parametro lasciato vuoto non equivale a uno impostato esplicitamente sullo stesso valore: un parametro vuoto segue il valore predefinito della piattaforma e varia al variare di quest'ultimo.

Nulla viene validato dalla CLI, intenzionalmente: i limiti appartengono al cluster su cui viene eseguito il progetto e variano a seconda del provider. Il control plane rifiuta i valori che non può soddisfare e specifica il campo. Esegui `rebase cloud compute` per visualizzare il costo in €/mese prima e dopo; le modifiche si applicano immediatamente, calcolate pro-rata a partire da oggi, ad eccezione di quelle che richiedono il riavvio del database, che attendono una finestra di manutenzione.

## Il resto dei comandi

| Gruppo di comandi | Cosa include |
|---|---|
| `login`, `logout`, `whoami` | La tua sessione |
| `link`, `unlink`, `use`, `open` | Associazione di questa directory a un progetto, selezione di un'organizzazione, apertura della console |
| `projects` | Creazione, elenco, ispezione, eliminazione |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Distribuzione e monitoraggio |
| `start`, `stop`, `restart` | Sospensione di un progetto e riattivazione |
| `status`, `metrics`, `debug` | Cosa sta facendo e perché non funziona |
| `env` | Variabili d'ambiente. `list` non stampa mai i valori; `--secret` è in sola scrittura |
| `domains` | Domini personalizzati, record DNS da aggiungere e verifica |
| `db` | Connessione o creazione di un database, connessione dalla propria macchina, backup, ripristino e point-in-time recovery |
| `extensions` | Allowlist delle estensioni Postgres |
| `storage` | Il bucket del progetto |
| `resources` | Quali database e bucket gestisce la piattaforma rispetto a quanto dichiarato dal codice |
| `compute` | Cosa riserva questo progetto, quanto costa e come modificarlo |
| `clusters` | I cluster su cui girano i tenant. Solo per amministratori della piattaforma |
| `settings`, `orgs`, `webhooks`, `billing` | Impostazioni di progetto, organizzazioni, webhook di deploy, fatturazione |

Ogni gruppo in questa tabella risponde a `--help` con una pagina dedicata — una riga di sintassi, i relativi flag ed esempi — e `--help` non esegue mai il comando. Un test vincola l'indice delle pagine, quindi un gruppo aggiunto senza di essa fa fallire la build anziché mostrare il sommario. `verify:docs` vincola la tabella stessa a tale indice: ogni gruppo gestito dalla CLI compare qui esattamente una volta, quindi un gruppo aggiunto senza una riga corrispondente farà fallire la build a sua volta.

In una pipe, `--help` risponde invece in JSON: la stessa riga di utilizzo, flag ed esempi strutturati per la lettura anziché sessanta righe di sequenze di escape del terminale.

## Cosa non include la beta

Detto chiaramente, perché scoprirlo in seguito è peggio:

- **Nessuna scelta della regione.** Oggi tutto viene eseguito in un'unica regione. Il modello di posizionamento esiste all'interno della piattaforma, ma un progetto non può selezionare una regione. `projects create --provider` e `--region` non rappresentano l'eccezione che sembrano: registrano a quale dei target di deploy registrati nel control plane appartiene un progetto, e ce n'è solo uno, quindi entrambi usano tale impostazione predefinita e nessuno dei due sposta il progetto altrove. `rebase cloud projects create --help` riporta la stessa cosa.
- **Non è self-service.** L'accesso viene concesso a scaglioni; non è prevista una procedura di registrazione immediata con pagamento autonomo.
- **Nessun SLA pubblicato** e nessuna conformità SOC 2. Se hai bisogno di uno di questi elementi, specificalo al momento della richiesta di accesso anziché darlo per scontato.
- **Nessun deploy di preview o per branch**, né un'app GitHub proprietaria. I deploy hook — URL segreti verso cui puntare un webhook di repository — costituiscono l'automazione supportata.
- **La CI richiede le credenziali di un utente.** Non esiste ancora un token macchina; `rebase cloud login` richiede un'email e una password. Passali come `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` da un secret store — `--password` inserisce la password nella cronologia della shell e nella tabella dei processi, e lo segnala prima di effettuare l'accesso.
- **Il point-in-time recovery è disponibile solo da CLI.** La console mostra i backup; il flusso di lavoro di PITR preparato avviene tramite `rebase cloud db pitr`.
- **Nessun endpoint pubblico per il database.** Un database gestito non è esposto a Internet, quindi l'host mostrato dalla console rappresenta l'indirizzo utilizzato dal backend e non risolve nulla sulla tua macchina. `rebase cloud db connect` apre una porta locale che punta a quel database, tramite tunnel attraverso il control plane, per tutto il tempo in cui viene mantenuta in esecuzione — tuttavia non esiste un hostname permanente a cui un servizio di terze parti possa connettersi.

## Self-hosting in alternativa

Nulla di tutto questo comporta un lock-in. La [guida al self-hosting](/docs/deployment/self-hosting/) esegue la medesima immagine e bundle con `docker compose`, e la [guida a Kubernetes](/docs/deployment/kubernetes/) genera la stessa topologia a partire dall'Helm chart.

---
