---
sourceHash: f5fcf560853b0193
title: Connetti Claude a Rebase
sidebar_label: Connettore Rebase
description: Un unico connettore MCP per tutti i tuoi progetti Rebase, su Rebase Cloud o self-hosted — aggiungilo una volta in Claude, accedi con il tuo account Rebase, e leggi, distribuisci e modifica i tuoi progetti con i permessi di cui disponi nella console, con ogni modifica confermata prima dell'esecuzione.
---

Il connettore Rebase è un unico server MCP per ogni progetto Rebase che esegui: su
Rebase Cloud e sui tuoi server. Lo aggiungi una volta in Claude, accedi con
il tuo account Rebase e Claude può visualizzare i tuoi progetti, leggerne i log, distribuirli
ed eseguirne il rollback, impostare le relative variabili d'ambiente, nonché leggere e modificare i
loro dati. Funziona in Claude sul web, nell'app desktop e su mobile.

Agisce a tuo **nome**, con i permessi di accesso di cui dispone il tuo account nella console: i
progetti delle organizzazioni a cui appartieni, il ruolo che ricopri in ciascuna di esse e
l'accesso ai dati che lo Studio della console ti garantisce. Non conserva alcuna chiave propria.

## Aggiungilo

In Claude, apri **Settings → Connectors → Add custom connector** e inserisci:

```text
https://app.rebase.pro/mcp
```

Claude apre la schermata di consenso di Rebase. Se hai già effettuato l'accesso alla console
nello stesso browser, ti proporrà quell'account: premi **Allow**. Altrimenti, accedi
da lì. La schermata elenca i permessi che stai concedendo; potrai riconnetterti in seguito
per concederne meno.

I tuoi progetti Rebase Cloud sono già presenti. Per loro, la configurazione termina qui.

## Aggiungi le tue istanze self-hosted

Esegui questo comando una volta per ciascun server che ospiti autonomamente:

```bash
rebase cloud connect https://admin.example.com
```

Questo aggiunge l'istanza al tuo account Rebase e stampa due variabili. Impostale
su quel server e riavvialo; il comando attende che il server risponda, quindi
conferma la connessione. All'interno della cartella del progetto, si offrirà di scriverle nel
file `.env` per te.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Da quel momento in poi, Claude elencherà l'istanza accanto ai tuoi progetti Cloud, e potrai fare
riferimento ad essa nello stesso modo: "mostrami gli ordini su admin.example.com". Su un'istanza self-hosted
il connettore legge e modifica i dati, legge il relativo schema ed esegue i
cron job. Deploy, variabili d'ambiente e log rimangono sul tuo server.

- **Il server necessita di Rebase 0.28.1 o versioni successive**, raggiungibile via HTTPS a un
  indirizzo pubblico. Rebase Cloud effettua chiamate verso di esso, pertanto un server presente solo su
  una rete privata non può essere connesso.
- **Le variabili non contengono segreti.** La chiave è la chiave pubblica di Rebase Cloud;
  l'audience identifica questa istanza. Grazie a esse il server accetta token di breve
  durata firmati da Rebase Cloud esclusivamente per questa istanza, concedendo loro al massimo
  ciò che concederebbe Studio: dati, soggetti alla row-level security, e cron.
- **Le chiamate passano attraverso Rebase Cloud.** Claude comunica con il connettore e il
  connettore con il tuo server. Un server che non connetti mai mantiene il proprio
  [endpoint MCP remoto](/docs/ai/remote-mcp/), senza nulla nel mezzo.
- **Per disconnetterne una**, esegui `rebase cloud connect --remove https://admin.example.com`,
  oppure rimuovi le due variabili dal server.

L'aggiunta di un'istanza richiede il ruolo di owner o admin dell'organizzazione, come per
accedere ai dati di un progetto. Il comando `rebase cloud connect --list` mostra quelle che hai aggiunto.

## Cosa può fare Claude

Dieci tool. I primi sei sono di sola lettura:

| Tool | Cosa fa |
|---|---|
| `projects` | Elenca i tuoi progetti, il loro stato e il tuo ruolo in ciascuno |
| `project_status` | Lo stato e l'ultima distribuzione di un progetto; opzionalmente i suoi deployment recenti, i **nomi** delle sue variabili d'ambiente, i suoi cron job |
| `logs` | L'output dell'app in esecuzione, il log di build di un deployment o le esecuzioni di un cron job |
| `schema` | Le collection di un progetto o i campi di una singola collection |
| `query` | Legge le righe: una per ID, una pagina filtrata o un conteggio |
| `show_collection` | Mostra le righe come tabella nella conversazione, dove puoi sfogliare le pagine e modificare le celle |

Gli altri quattro apportano modifiche alla produzione e ciascuno richiede prima una conferma:

| Tool | Cosa fa |
|---|---|
| `write` | Crea, aggiorna o elimina una riga (utenti inclusi: sono righe della tua collection users) |
| `deploy` | Distribuisce un branch Git, esegue il rollback a un deployment precedente o ne annulla uno in corso |
| `env` | Imposta o rimuove variabili d'ambiente; una modifica viene applicata al deployment successivo |
| `cron` | Esegue subito un cron job, oppure ne attiva o disattiva uno |

La distribuzione del codice dalla tua macchina rimane gestita dalla CLI (`rebase cloud deploy`) e
dal [server MCP locale](/docs/ai/mcp/), che gestisce anche lo sviluppo locale,
la generazione dello schema e i branch del database.

## Ogni modifica viene confermata

Un tool che modifica qualcosa richiede due chiamate. La prima non modifica nulla:
risponde con un piano, come "Roll shop back to deployment d_81f2", e un
token di conferma. Claude ti mostra il piano e invia una nuova chiamata con il token
solo se acconsenti. Il token è valido per cinque minuti, per una sola volta e per gli esatti
argomenti per cui è stato generato: se qualcosa differisce, non viene eseguito nulla.

Inoltre, Claude richiede la tua autorizzazione prima di chiamare uno qualsiasi di questi quattro tool,
poiché sono contrassegnati come distruttivi. Nella vista a tabella, una cella modificata
mostra il piano e attende che tu prema **Save**.

I valori delle variabili d'ambiente non vengono mai mostrati in risposta: un piano ne mostra la lunghezza
e `project_status` ne elenca solo i nomi. Tuttavia, un valore che imposti passa attraverso la
conversazione.

## A cosa può accedere

- **Progetti e operazioni cloud**: ciò che ti consente la console. Un membro di
  un'organizzazione può leggere stato e log e, come nella console, effettuare deploy e impostare
  variabili.
- **Dati, schemi e cron job**: ciò che ti consente lo Studio nella console. Vale a
  dire un owner o admin dell'organizzazione, su un progetto per cui l'accesso a Studio è
  abilitato, o su un'istanza self-hosted connessa dall'organizzazione. Le chiamate vengono eseguite all'interno del progetto, soggette alla sua row-level security, con
  il ruolo di admin proprio di Studio. La disattivazione dell'accesso a Studio per un progetto disattiva
  anche questa funzionalità.
- **Cosa hai autorizzato.** Puoi concedere al connettore meno permessi di quanti ne
  possegga il tuo account: sola lettura, o un solo progetto. Non richiede mai backup,
  ripristini, credenziali del database o impostazioni del progetto.

Un progetto accede ai propri dati tramite il connettore non appena esegue un runtime in grado
di gestire le chiamate del connettore. Fino al successivo deploy o rollout della piattaforma,
tali tool lo segnaleranno.

## Disconnessione

Rimuovi il connettore nelle impostazioni di Claude. Il suo token di accesso smette di funzionare
entro un'ora. L'eliminazione del tuo account Rebase, o la disconnessione da tutte le sessioni,
lo blocca alla chiamata successiva.

Il connettore è pensato per chi sviluppa su Rebase. Per consentire a chi
**utilizza** la tua app di connettere Claude a essa con la propria identità, esponi
l'[endpoint MCP remoto](/docs/ai/remote-mcp/) dal tuo backend.
