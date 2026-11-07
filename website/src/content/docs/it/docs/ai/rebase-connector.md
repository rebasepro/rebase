---
sourceHash: 6940f9fb7bc79a85
title: Connetti Claude a Rebase
sidebar_label: Connettore Rebase
description: Un unico connettore MCP per tutti i tuoi progetti Rebase, su Rebase Cloud o self-hosted — aggiungilo una volta in Claude, accedi con il tuo account Rebase e leggi, distribuisci e modifica i tuoi progetti con gli accessi che hai nella console, con ogni modifica confermata prima dell'esecuzione.
---

Il connettore Rebase è un unico server MCP per ogni progetto Rebase che esegui: su
Rebase Cloud e sui tuoi server. Lo aggiungi una volta in Claude, accedi con
il tuo account Rebase e Claude potrà vedere i tuoi progetti, leggere i loro log,
effettuare distribuzioni e rollback, impostare le loro variabili d'ambiente e
leggere e modificare i loro dati. Funziona in Claude sul web, nell'app desktop e su dispositivi mobili.

Agisce a nome **tuo**, con gli accessi di cui dispone il tuo account nella console: i
progetti delle organizzazioni a cui appartieni, il ruolo che ricopri in ciascuna e
l'accesso ai dati fornito da Studio nella console. Non possiede chiavi proprie.

## Aggiungilo

In Claude, apri **Settings → Connectors → Add custom connector** e inserisci:

```text
https://app.rebase.pro/mcp
```

Claude aprirà la schermata di autorizzazione di Rebase. Se hai già effettuato l'accesso
alla console nello stesso browser, ti verrà proposto quell'account: premi **Allow**.
Altrimenti, effettua l'accesso da lì. La schermata elenca i permessi concessi; potrai
riconnetterti in seguito per concederne meno.

I tuoi progetti Rebase Cloud sono già disponibili. La configurazione per questi ultimi termina qui.

## Aggiungi le tue istanze self-hosted

Esegui questo comando una volta per ogni server che ospiti autonomamente:

```bash
rebase cloud connect https://admin.example.com
```

Questo comando aggiunge l'istanza al tuo account Rebase e stampa due variabili. Impostale
su quel server e riavvialo; il comando attende la risposta del server, per poi
confermare l'avvenuta connessione. Se eseguito all'interno della cartella del progetto,
proporrà di scriverle direttamente nel file `.env`.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Da quel momento in poi, Claude elencherà l'istanza accanto ai tuoi progetti Cloud, e potrai
fare riferimento ad essa nello stesso modo: "mostrami gli ordini su admin.example.com".
Su un'istanza self-hosted, il connettore legge e modifica i dati, legge lo schema ed esegue
i cron job. I deploy, le variabili d'ambiente e i log rimangono sul tuo server.

- **Il server richiede Rebase 0.28.1 o versioni successive**, raggiungibile via HTTPS a un
  indirizzo pubblico. Poiché Rebase Cloud deve contattarlo, un server accessibile solo su
  una rete privata non può essere connesso.
- **Le variabili non contengono segreti.** La chiave è la chiave pubblica di Rebase Cloud;
  l'audience identifica questa specifica istanza. Grazie ad esse, il server accetta token di
  breve durata firmati da Rebase Cloud esclusivamente per questa istanza, concedendo al massimo
  ciò che concederebbe Studio: dati, soggetti alla row-level security, e cron.
- **Le chiamate passano attraverso Rebase Cloud.** Claude comunica con il connettore, e il
  connettore con il tuo server. Un server che non viene mai connesso mantiene il proprio
  [remote MCP endpoint](/docs/ai/remote-mcp/), senza intermediari.
- **Per disconnettere un'istanza**, esegui `rebase cloud connect --remove https://admin.example.com`,
  oppure rimuovi le due variabili dal server.

L'aggiunta di un'istanza richiede il ruolo di owner o admin dell'organizzazione, come per
accedere ai dati di un progetto. Il comando `rebase cloud connect --list` mostra quelle aggiunte.

## Cosa può fare Claude

Dodici tool. I primi otto sono di sola lettura:

| Tool | Descrizione |
|---|---|
| `projects` | Elenca i tuoi progetti, il loro stato e il tuo ruolo in ciascuno di essi |
| `project_status` | Lo stato di un progetto e l'ultimo deployment; opzionalmente i suoi deployment recenti, i **nomi** delle sue variabili d'ambiente, i suoi cron job |
| `logs` | L'output dell'applicazione in esecuzione, il log di build di un deployment o le esecuzioni di un cron job |
| `schema` | Le collection di un progetto, o i campi di una singola collection |
| `query` | Legge i record: uno tramite ID, una pagina filtrata o un conteggio |
| `show_collection` | Apre una collection direttamente nella vista del tuo pannello di amministrazione, all'interno della conversazione: una tabella, un elenco, schede o una bacheca kanban in cui puoi cercare, filtrare e sfogliare le pagine, dove ogni record apre il relativo modulo |
| `show_record` | Apre il modulo di un singolo record, oppure un modulo per un nuovo record precompilato da Claude, pronto per la verifica e il salvataggio |
| `show_app` | Crea una mini-app su misura per l'attività corrente (come una coda di smistamento o una dashboard) ed esegue l'elaborazione sui tuoi dati all'interno della conversazione. Può utilizzare le viste e i moduli del tuo pannello di amministrazione e richiede la tua autorizzazione prima di apportare modifiche |

Gli altri quattro modificano l'ambiente di produzione e richiedono sempre una conferma preventiva:

| Tool | Descrizione |
|---|---|
| `write` | Crea, aggiorna o elimina un record (inclusi gli utenti: sono record della collection degli utenti) |
| `deploy` | Esegue il deploy di un branch Git, effettua il rollback a un deployment precedente o ne annulla uno in corso |
| `env` | Imposta o rimuove variabili d'ambiente; le modifiche vengono applicate al deploy successivo |
| `cron` | Esegue un cron job immediatamente, oppure ne attiva o disattiva uno |

Il deploy del codice dalla propria macchina locale rimane gestito tramite la CLI (`rebase cloud deploy`) e
il [local MCP server](/docs/ai/mcp/), che copre anche lo sviluppo locale,
la generazione di schemi e i branch del database.

## Ogni modifica richiede conferma

Un tool che apporta modifiche richiede due chiamate. La prima non modifica nulla:
restituisce un piano di azione, come ad esempio "Roll shop back to deployment d_81f2", e un
token di conferma. Claude mostra il piano ed esegue una seconda chiamata con il token
solo se confermi. Il token è valido per cinque minuti, per una sola volta ed esclusivamente per
gli argomenti esatti per cui è stato generato: se un parametro differisce, non viene eseguito nulla.

Claude richiede inoltre la tua autorizzazione prima di chiamare ciascuno di questi quattro tool,
poiché sono contrassegnati come distruttivi. Nelle viste, il salvataggio di un modulo mostra
il piano e attende che tu prema **Save**.

I valori delle variabili d'ambiente non vengono mai mostrati in risposta: un piano mostra solo la loro
lunghezza e `project_status` elenca esclusivamente i nomi. Qualsiasi valore impostato
passa comunque attraverso la conversazione.

## A cosa ha accesso

- **Progetti e operazioni cloud**: ciò che la console ti consente di fare. Un membro di
  un'organizzazione può visualizzare stato e log e, come nella console, effettuare deploy
  e impostare variabili.
- **Dati, schemi e cron job**: ciò che Studio nella console ti consente di fare. Ovvero,
  per un owner o admin dell'organizzazione, su un progetto per cui l'accesso a Studio è
  abilitato, o su un'istanza self-hosted connessa dall'organizzazione. Le chiamate vengono eseguite
  all'interno del progetto, soggette alla sua row-level security, con il ruolo di amministrazione
  previsto da Studio. Disattivando l'accesso a Studio per un progetto, viene disattivato anche questo.
- **Ciò che hai autorizzato.** Puoi concedere al connettore meno permessi rispetto a quelli
  del tuo account: ad esempio, solo lettura o l'accesso a un solo progetto. Non richiede mai
  l'accesso a backup, ripristini, credenziali del database o impostazioni di progetto.

Un progetto accede ai propri dati tramite il connettore solo se esegue un runtime compatibile
con le chiamate del connettore stesso. Fino al deploy successivo o a un aggiornamento della piattaforma,
i relativi tool segnaleranno questa condizione.

## Disconnessione

Rimuovi il connettore nelle impostazioni di Claude. Il suo token di accesso smetterà di funzionare
entro un'ora. L'eliminazione del tuo account Rebase, o la disconnessione da tutte le sessioni, ne bloccherà
il funzionamento alla chiamata successiva.

Il connettore è pensato per chi sviluppa su Rebase. Per consentire agli utenti che
**utilizzano** la tua app di connettervi Claude con la propria identità, esponi il
[remote MCP endpoint](/docs/ai/remote-mcp/) dal tuo backend.
