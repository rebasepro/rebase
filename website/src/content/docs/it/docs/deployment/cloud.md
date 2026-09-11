---
sourceHash: 9e0f8ddeef2c5dcb
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud è lo stesso Rebase, gestito per te. Cos'è, come collegare e distribuire un progetto e cosa non include ancora la beta privata.
---

Rebase Cloud esegue lo stesso Rebase open source che ospiteresti in autonomia — la stessa
immagine pubblicata `rebasepro/server`, lo stesso bundle, lo stesso Postgres. La
differenza sta in chi lo gestisce.

:::note[Beta privata]
Rebase Cloud è in **beta privata**. Oggi gestisce tenant reali e apre l'accesso a
scaglioni. [Richiedi l'accesso](https://rebase.pro/pricing).

Non è self-service, quindi i comandi seguenti richiedono un account a cui è stato concesso l'accesso.
Tutto il resto su questo sito funziona senza di esso.
:::

## Cos'è

Un **progetto** Cloud è costituito da tre elementi che la piattaforma gestisce per te:

| | Cosa ottieni |
|---|---|
| **App** | Il tuo bundle, in esecuzione sull'immagine di runtime pubblicata. I deploy consistono nel caricamento del bundle, non nella compilazione di un container |
| **Database** | Un PostgreSQL gestito, con backup automatici e point-in-time recovery |
| **Storage** | Un bucket dedicato, se il tuo progetto utilizza l'archiviazione di file |

Ognuno di essi viene allocato al primo deploy e viene fatturato in base a ciò che
riserva anziché per postazione.

**Non cambia nulla del tuo progetto per essere eseguito qui.** Lo stesso repository
può essere ospitato in self-hosting con `docker compose`, e la via d'uscita è concreta: `rebase build`
genera un bundle che si avvia ovunque sia eseguita l'immagine di runtime.

## Collegare un progetto

Dalla directory di un progetto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` non accetta argomenti posizionali. Il nome e il sottodominio sono
flag ed entrambi sono obbligatori: su un terminale vengono richiesti in modo interattivo, e
un'esecuzione headless che ne omette uno termina con `input_required` anziché inventarne
uno. **Il sottodominio non è modificabile in seguito:** è l'host
`<slug>.rebase.website` su cui risponde il progetto, quindi sceglilo con attenzione.

`--link` associa questa directory al progetto nella stessa chiamata, quindi non c'è una
fase di `link` separata. Scrive `.rebase/cloud.json`, che registra l'ID del progetto
e lo slug. Quel file non è un segreto e non contiene le tue credenziali: queste si trovano
in `~/.rebase/credentials.json`, scritto da `login`.

`billing setup` associa una carta all'organizzazione, una sola volta. È il primo comando
della sequenza di proposito: il primo deploy di un progetto viene rifiutato senza di essa, e
scoprirlo dopo che il bundle ha terminato il caricamento è l'ordine peggiore.

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
`runtime: "managed"` per il suo backend, e `deploy` legge tale dichiarazione — lo
segnala durante l'esecuzione (`rebase.json declares runtime: managed — deploying a
bundle`), compila l'applicazione in `dist-bundle`, carica il bundle, lo esegue sull'immagine
di runtime pubblicata e segue il deployment fino a uno stato finale. Il codice di
uscita rappresenta l'esito, quindi la stessa riga funziona in modalità non presidiata nella CI.

Per distribuire un artefatto compilato in precedenza — ad esempio, un job di CI che compila una
volta e distribuisce due volte — punta alla directory anziché ricompilare:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

L'abbandono del runtime gestito avviene tramite un flag dedicato, `--eject`, e null'altro
lo richiede: una compilazione che sposterebbe un progetto gestito su un'immagine container
di cui assume la proprietà viene rifiutata finché non lo specifichi esplicitamente. In precedenza
`--force` aveva questo significato, associando l'azione meno reversibile della CLI
alla stessa parola usata per "sovrascrivi questo file"; ora è un'opzione sconosciuta
anziché un alias, quindi uno script che la include si interromperà.

Monitoralo:

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` riporta `blockedOn` e `nextAction`. Quando `blockedOn` è `null`, la
piattaforma sta effettivamente lavorando e il polling è l'operazione corretta da eseguire; quando
indica qualcosa, quel qualcosa è in attesa di una tua azione.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback ripunta il progetto su ciò che un precedente deployment riuscito
aveva distribuito, senza mai ricompilare — il valore di un rollback risiede nel distribuire
un artefatto già eseguito in precedenza.

Quali deployment siano idonei dipende da come il progetto viene distribuito, ed entrambi
i metodi funzionano:

| Come è stato distribuito | Cosa viene ripristinato |
|---|---|
| `rebase cloud deploy` (una build dai sorgenti) | L'immagine pubblicata da quella build |
| `rebase cloud deploy --bundle` (il runtime della piattaforma) | Il bundle distribuito da quel deploy, sulla versione del runtime attualmente in esecuzione per il progetto |

Pertanto, un rollback richiede un deployment che abbia registrato uno dei due elementi, il che
implica un progetto distribuito con successo almeno due volte. `rebase cloud deployments`
contrassegna quelli idonei, e `--json` riporta `rollbackable` per ogni riga insieme
all'elemento `image` o `bundle` che verrebbe ripristinato.

Due tipi di deployment vengono rifiutati, e la CLI specifica quale: uno che non è andato a buon
fine e uno antecedente alla registrazione dell'artefatto da parte della piattaforma. Non c'è nulla da
ipotizzare in entrambi i casi — tirare a indovinare porterebbe a distribuire qualsiasi elemento compilato
o caricato più di recente pretendendo di ripristinare questo — quindi distribuisci invece
la versione desiderata.

Un rollback aggiunge un nuovo deployment anziché riscrivere la cronologia, e attende che
la versione ripristinata sia pronta a gestire il traffico prima di segnalare il successo.
Seguilo con `rebase cloud logs -f`.

## Compute e relativi costi

Il prezzo di un progetto si basa sulle risorse riservate, non su un piano tariffario. `compute` stampa
ogni parametro regolabile e il preventivo dettagliato fornito direttamente dal control plane. (`rebase cloud
resources` è una cosa diversa: i database e i bucket dichiarati dal codice,
e lo stato di provisioning di ciascuno — consulta la [CLI reference](/docs/cli/#rebase-cloud).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parametro | Unità e significato |
|---|---|
| `--cpu`, `--memory` | Request dell'app per istanza, ad es. `500m` e `2Gi`. Se vuoto, si applica il valore predefinito della piattaforma — `250m` e `512Mi` |
| `--replicas` | Istanze sempre attive: la soglia minima dell'autoscaler e ciò per cui il progetto viene fatturato a riposo |
| `--autoscale-max` | 1–16. Il tetto massimo raggiungibile e il costo massimo fatturabile nello scenario peggiore. `--no-autoscale` lo disattiva |
| `--autoscale-cpu-target` | 10–95. L'utilizzo della CPU mantenuto dall'autoscaler, calcolato sulla request anziché sul limit. Se vuoto, il valore predefinito è 70 |
| `--spot` | `true` o `false`. Capacità preemptible: più economica e soggetta a riavvio senza preavviso |
| `--scale-to-zero` | `true` o `false`. Risorse di calcolo fatturate a richiesta che si arrestano quando inattive, al costo di un cold start |
| `--db-mode` | `shared` (il cluster condiviso) o `dedicated` (un cluster dedicato a questo progetto) |
| `--db-instances` | 1–3. `1` indica una singola istanza senza failover; `2` aggiunge un'istanza di standby automatico |
| `--db-cpu`, `--db-memory`, `--storage` | Per istanza di database. Se vuoto, i valori predefiniti sono `500m`, `2Gi` e il volume predefinito |

Un parametro vuoto non equivale a uno impostato sullo stesso valore numerico: un parametro
vuoto segue il valore predefinito della piattaforma e si aggiorna quando questo varia.

Nessun valore viene validato dalla CLI, intenzionalmente: i limiti dipendono dal cluster su cui
gira il progetto e differiscono a seconda dei provider. Il control plane rifiuta qualsiasi
valore che non può soddisfare, indicando il campo specifico. Esegui `rebase cloud compute` per
visualizzare il costo in €/mese prima e dopo; le modifiche si applicano immediatamente, con
tariffazione proporzionale a partire da oggi, a eccezione di quelle che richiedono il riavvio del database,
le quali attendono una finestra di manutenzione.

## Il resto delle funzionalità

| Gruppo di comandi | Cosa copre |
|---|---|
| `login`, `logout`, `whoami` | La tua sessione |
| `link`, `unlink`, `use`, `open` | Collegamento di questa directory a un progetto, selezione di un'organizzazione, apertura della console |
| `projects` | Creazione, elenco, ispezione ed eliminazione |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Distribuzione e monitoraggio |
| `start`, `stop`, `restart` | Sospensione e riattivazione di un progetto |
| `status`, `metrics`, `debug` | Cosa sta facendo e perché non funziona |
| `env` | Variabili d'ambiente. `list` non stampa mai i valori; `--secret` è di sola scrittura |
| `domains` | Domini personalizzati, record DNS da aggiungere e verifica |
| `db` | Connessione o creazione di un database, accesso dalla propria macchina, backup, ripristino e point-in-time recovery |
| `extensions` | L'elenco di elementi consentiti (allowlist) per le estensioni Postgres |
| `storage` | Il bucket del progetto |
| `resources` | Quali database e bucket sono gestiti dalla piattaforma, rispetto a quanto dichiarato nel codice |
| `compute` | Cosa riserva questo progetto, quanto costa e come modificarlo |
| `clusters` | I cluster su cui girano i tenant. Riservato agli amministratori della piattaforma |
| `settings`, `orgs`, `webhooks`, `billing` | Impostazioni di progetto, organizzazioni, webhook di deploy, fatturazione |

Ogni gruppo presente in questa tabella risponde a `--help` con una pagina dedicata — una riga
di sintassi, i relativi flag ed esempi — e `--help` non esegue mai il comando. Un test tiene
traccia dell'indice delle pagine, quindi l'aggiunta di un gruppo sprovvisto di documentazione fa fallire
la build anziché mostrare il sommario. `verify:docs` vincola la tabella stessa a tale indice:
ogni gruppo gestito dalla CLI compare qui esattamente una volta, pertanto anche un gruppo
aggiunto senza una riga corrispondente farà fallire la build.

Se reindirizzato tramite pipe, `--help` risponde invece in JSON: la stessa riga di sintassi, i flag
e gli esempi sotto forma di struttura leggibile anziché sessanta righe di sequenze di escape da terminale.

## Cosa non include la beta

Detto chiaramente, perché scoprirlo in seguito è peggio:

- **Nessuna scelta della regione.** Attualmente tutto viene eseguito in un'unica regione. Il modello
  di posizionamento esiste nella piattaforma, ma un progetto non può scegliere una regione.
  I parametri `projects create --provider` e `--region` non rappresentano l'eccezione che
  sembrano: registrano a quale dei target di deploy registrati nel control plane appartiene un
  progetto, e ne esiste solo uno; pertanto entrambi impostano tale valore predefinito e nessuno
  dei due sposta il progetto altrove. `rebase cloud projects create --help` conferma la stessa cosa.
- **Non è self-service.** L'accesso viene concesso a scaglioni; non esiste una procedura di iscrizione e pagamento immediata.
- **Nessun SLA pubblicato** e nessuna certificazione SOC 2. Se hai bisogno di uno di questi,
  segnalalo al momento della richiesta di accesso anziché darlo per scontato.
- **Nessun deploy di anteprima o per branch** e nessuna GitHub App proprietaria. I deploy hook —
  URL segreti a cui puntare un webhook del repository — sono il meccanismo di automazione supportato.
- **La CI richiede credenziali personali.** Non esiste ancora un machine token;
  `rebase cloud login` richiede un'email e una password. Trasmettile come
  `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` da un secret store —
  `--password` inserisce la password nella cronologia della shell e nella tabella dei processi,
  avvisandoti prima di effettuare l'accesso.
- **Il point-in-time recovery è disponibile solo da CLI.** La console mostra i backup; il
  flusso di lavoro di PITR a passaggi è `rebase cloud db pitr`.
- **Nessun endpoint pubblico per il database.** Un database gestito non è esposto a
  Internet, quindi l'host mostrato nella console corrisponde all'indirizzo utilizzato dal tuo backend e
  non si risolve sulla tua macchina locale. `rebase cloud db connect` apre una porta locale
  collegata a quel database tramite tunnel attraverso il control plane per tutto il tempo in cui
  rimane in esecuzione, ma non esiste un hostname permanente a cui un servizio di terze parti
  possa connettersi. Quel tunnel e la password visibile tramite
  `rebase cloud db info --reveal` richiedono entrambi il ruolo di owner o admin
  dell'organizzazione: lo stesso richiesto dall'editor SQL di Studio, poiché tutti e tre
  portano a una sessione sui dati di produzione.

## Eseguire il self-hosting in alternativa

Niente qui comporta un vincolo di vendor lock-in. La [guida al self-hosting](/docs/deployment/self-hosting/)
esegue la medesima immagine e il medesimo bundle con `docker compose`, e la
[guida a Kubernetes](/docs/deployment/kubernetes/) riproduce la stessa topologia a partire
dall'Helm chart.

---
