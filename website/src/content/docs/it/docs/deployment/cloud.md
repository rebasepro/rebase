---
sourceHash: 11eb4597bacc7658
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Cos'è, come si collega e distribuisce un progetto e cosa non include ancora la beta privata.
---

Rebase Cloud esegue lo stesso Rebase open-source che ospiteresti in self-hosting: la stessa immagine pubblicata `rebasepro/server`, lo stesso bundle, lo stesso Postgres. La differenza sta in chi lo gestisce.

:::note[Private beta]
Rebase Cloud è in **beta privata**. Gestisce già tenant reali e viene aperto a scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi seguenti richiedono un account che sia stato autorizzato. Tutto il resto su questo sito funziona senza di esso.
:::

## Cos'è

Un **progetto** Cloud è costituito da tre elementi che la piattaforma gestisce per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine di runtime pubblicata. I deploy sono un caricamento di bundle, non una compilazione di container |
| **Database** | Un PostgreSQL gestito, con backup automatici e point-in-time recovery |
| **Storage** | Un bucket dedicato, se il tuo progetto utilizza l'archiviazione di file |

Ciascuno viene sottoposto a provisioning al primo deploy e viene fatturato in base a ciò che riserva anziché per utente (per seat).

**Nel tuo progetto non cambia nulla per essere eseguito lì.** Lo stesso repository può essere ospitato in self-hosting con `docker compose`, e la via di fuga è reale: `rebase build` produce un bundle che si avvia ovunque sia eseguita l'immagine di runtime.

## Collegare un progetto

Dalla directory di un progetto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono flag ed entrambi sono obbligatori: in un terminale vengono richiesti in modo interattivo, mentre un'esecuzione non interattiva (headless) che ne ometta uno esce con `input_required` anziché inventarne uno. **Il sottodominio non è modificabile in seguito:** è l'host `<slug>.rebase.website` su cui risponde il progetto, quindi sceglilo con attenzione.

`--link` associa questa directory al progetto nella stessa chiamata, quindi non c'è un passaggio `link` separato. Scrive `.rebase/cloud.json`, che registra l'ID e lo slug del progetto. Quel file non è un segreto e non contiene le tue credenziali: queste ultime risiedono in `~/.rebase/credentials.json`, scritto da `login`.

`billing setup` associa una carta all'organizzazione, una sola volta. È posizionato intenzionalmente all'inizio della sequenza: il primo deploy di un progetto viene rifiutato in assenza di una carta, e scoprirlo solo dopo aver completato il caricamento del bundle sarebbe l'ordine peggiore.

Un progetto esistente si collega senza crearne uno nuovo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Un solo comando, e nessun flag da ricordare. Il file `rebase.json` di uno scaffold dichiara `runtime: "managed"` per il suo backend e `deploy` legge tale dichiarazione: lo segnala durante l'operazione (`rebase.json declares runtime: managed — deploying a bundle`), compila l'applicazione in `dist-bundle`, carica il bundle, lo esegue sull'immagine di runtime pubblicata e segue il deployment fino a uno stato finale. Il codice di uscita rappresenta il verdetto, quindi la stessa riga funziona in modalità non presidiata nella CI.

Per distribuire un artefatto compilato in precedenza — ad esempio un job di CI che compila una volta e distribuisce due volte — punta alla directory invece di ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Abbandonare il runtime gestito richiede un flag dedicato, `--eject`, e nessun'altra operazione lo richiede: una compilazione che sposterebbe un progetto gestito su un'immagine container di cui poi diventa proprietario viene rifiutata finché non lo specifichi esplicitamente. In precedenza si usava `--force`, che associava l'azione meno reversibile che la CLI potesse compiere alla stessa parola di "sovrascrivi questo file"; ora è un'opzione sconosciuta anziché un alias, quindi uno script che la contiene si interrompe.

Monitoralo:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` riporta `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la piattaforma sta effettivamente lavorando e il polling è l'operazione corretta; quando indica qualcosa, quel qualcosa è in attesa del tuo intervento.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback reindirizza il progetto a ciò che un deployment precedente riuscito aveva rilasciato, e non ricompila mai: il vantaggio di un rollback è che distribuisce un artefatto già eseguito in passato.

I deployment idonei dipendono da come viene distribuito il progetto, ed entrambe le modalità funzionano:

| Modalità di deploy | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (build dal sorgente) | L'immagine pubblicata da tale build |
| `rebase cloud deploy --bundle` (il runtime della piattaforma) | Il bundle rilasciato da quel deploy, sulla versione del runtime attualmente in esecuzione nel progetto |

Quindi un rollback richiede un deployment che abbia registrato uno dei due elementi, il che significa un progetto che è stato distribuito con successo almeno due volte. `rebase cloud deployments` contrassegna quelli idonei, e `--json` riporta `rollbackable` per ogni riga insieme all'`image` o al `bundle` che verrebbe ripristinato.

Due tipi di deployment vengono rifiutati, e la CLI specifica quali: uno che non è andato a buon fine e uno precedente a quando la piattaforma ha iniziato a registrare i suoi artefatti. Non c'è nulla da tirare a indovinare in entrambi i casi — tirare a indovinare significherebbe distribuire qualsiasi cosa sia stata compilata o caricata più di recente sostenendo di ripristinare questa — quindi esegui invece il deploy della versione desiderata.

Un rollback aggiunge un nuovo deployment invece di riavvolgere la cronologia, e attende che la versione ripristinata sia attiva prima di segnalare il successo. Seguilo con `rebase cloud logs -f`.

## Compute e relativi costi

Il prezzo di un progetto si basa sulle risorse riservate, non su un piano fisso. `compute` mostra ogni parametro e il preventivo dettagliato del piano di controllo corrispondente. (`rebase cloud resources` è una cosa diversa: i database e i bucket dichiarati dal codice, e se ciascuno è stato sottoposto a provisioning — vedi il [riferimento della CLI](/docs/cli/#rebase-cloud).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Richiesta dell'app per istanza, ad es. `500m` e `2Gi`. Vuoto indica il valore predefinito della piattaforma: `250m` e `512Mi` |
| `--replicas` | Istanze sempre attive: il limite inferiore dell'autoscaler e ciò per cui il progetto viene fatturato a riposo |
| `--autoscale-max` | 1–16. Il tetto massimo raggiungibile e il caso peggiore di fatturazione. `--no-autoscale` lo disattiva |
| `--autoscale-cpu-target` | 10–95. L'utilizzo della CPU che l'autoscaler mantiene, rispetto alla richiesta (request) anziché al limite (limit). Vuoto significa 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica e riavviata senza preavviso |
| `--scale-to-zero` | `true` o `false`. Compute fatturato a richiesta che si arresta quando inattivo, al costo di un cold start |
| `--db-instances` | 1–3. `1` indica una singola istanza senza failover; `2` aggiunge uno standby automatico |
| `--db-cpu`, `--db-memory`, `--storage` | Per istanza di database. Vuoto significa `500m`, `2Gi` e il volume predefinito |

Un parametro vuoto non equivale a uno impostato sullo stesso valore numerico: un parametro vuoto segue i valori predefiniti della piattaforma e cambia quando questi cambiano.

Nulla viene convalidato dalla CLI, intenzionalmente: i limiti dipendono dal cluster su cui viene eseguito un progetto e variano a seconda del provider. Il control plane rifiuta i valori che non può soddisfare indicando il campo interessato. Esegui `rebase cloud compute` per visualizzare gli €/mese prima e dopo; una modifica si applica immediatamente, calcolata su base proporzionale a partire da oggi, tranne nel caso di modifiche che richiedono il riavvio del database, le quali attendono una finestra di manutenzione.

## I restanti comandi

| Gruppo di comandi | Cosa copre |
|---|---|
| `login`, `logout`, `whoami` | La tua sessione |
| `link`, `unlink`, `use`, `open` | Associazione di questa directory a un progetto, selezione dell'organizzazione, apertura della console |
| `projects` | Creazione, elenco, ispezione ed eliminazione |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Distribuzione e monitoraggio |
| `start`, `stop`, `restart` | Sospensione di un progetto e riattivazione |
| `status`, `metrics`, `debug` | Cosa sta facendo il progetto e perché non funziona |
| `env` | Variabili d'ambiente. `list` non stampa mai i valori; `--secret` è di sola scrittura |
| `domains` | Domini personalizzati, record DNS da aggiungere e verifica |
| `db` | Collegamento o creazione di un database, connessione dalla propria macchina, backup, ripristino e point-in-time recovery |
| `extensions` | Elenco di estensioni Postgres consentite (allowlist) |
| `storage` | Il bucket del progetto |
| `resources` | Quali database e bucket sono gestiti dalla piattaforma, a fronte di quanto dichiarato dal codice |
| `compute` | Cosa riserva questo progetto, quanto costa e come modificarlo |
| `clusters` | I cluster su cui vengono eseguiti i tenant. Riservato agli amministratori di piattaforma |
| `settings`, `orgs`, `webhooks`, `billing` | Impostazioni di progetto, organizzazioni, webhook di deploy, pagamenti |

Ogni gruppo in quella tabella risponde a `--help` con una propria schermata: una riga di utilizzo, i relativi flag ed esempi; inoltre `--help` non esegue mai il comando. Un test controlla l'indice delle pagine, quindi un gruppo aggiunto senza una pagina fa fallire la build anziché mostrare il sommario. `verify:docs` confronta la tabella stessa con tale indice: ogni gruppo gestito dalla CLI appare qui esattamente una volta, quindi anche un gruppo aggiunto senza una riga corrispondente fa fallire la build.

Se usato in pipe, `--help` risponde invece in JSON: la stessa riga di utilizzo, flag ed esempi come struttura leggibile anziché sessanta righe di sequenze di escape da terminale.

## Cosa non include la beta

Detto chiaramente, perché scoprirlo in seguito è peggio:

- **Nessuna scelta della regione.** Attualmente tutto viene eseguito in un'unica regione. Il modello di posizionamento esiste nella piattaforma, ma un progetto non può selezionare una regione. `projects create --provider` e `--region` non rappresentano l'eccezione che sembrano: registrano a quale dei target di deploy registrati nel control plane appartiene un progetto; essendocene solo uno, entrambi prendono quel valore predefinito e nessuno dei due sposta il progetto altrove. Lo stesso vale per quanto riportato da `rebase cloud projects create --help`.
- **Non è self-service.** L'accesso viene concesso a scaglioni; non esiste un modello di iscrizione e pagamento immediato.
- **Nessun SLA pubblicato** e nessuna certificazione SOC 2. Se hai bisogno di uno di essi, specificalo al momento della richiesta di accesso anziché darlo per scontato.
- **Nessun deploy di anteprima o per branch** e nessuna GitHub App proprietaria. Gli hook di deploy — URL segreti a cui puntare un webhook del repository — sono l'automazione supportata.
- **La CI richiede le credenziali di una persona.** Non esiste ancora un token di macchina; `rebase cloud login` accetta un'email e una password. Passale come `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` da un archivio di secret: l'opzione `--password` inserisce la password nella cronologia della shell e nella tabella dei processi, segnalandolo prima di effettuare l'accesso.
- **Il point-in-time recovery è disponibile solo via CLI.** La console mostra i backup; il flusso di lavoro PITR guidato si esegue con `rebase cloud db pitr`.
- **Nessun endpoint pubblico per il database.** Un database gestito non è esposto a Internet, pertanto l'host mostrato dalla console è l'indirizzo utilizzato dal tuo backend e non corrisponde a nulla sulla tua macchina locale. `rebase cloud db connect` apre una porta locale che si collega a quel database tramite un tunnel attraverso il control plane per tutto il tempo in cui rimane in esecuzione, ma non esiste un hostname permanente a cui un servizio di terze parti possa connettersi. Quel tunnel e la password visibile con `rebase cloud db info --reveal` richiedono entrambi il ruolo di owner o admin dell'organizzazione: lo stesso richiesto dall'editor SQL di Studio, poiché tutti e tre consentono l'accesso a una sessione sui tuoi dati di produzione.

## Alternativa: il self-hosting

Nulla di tutto questo comporta vincoli di lock-in. La [guida al self-hosting](/docs/deployment/self-hosting/) esegue la medesima immagine e bundle con `docker compose`, e la [guida a Kubernetes](/docs/deployment/kubernetes/) riproduce la stessa topologia a partire dal grafico Helm.

---
