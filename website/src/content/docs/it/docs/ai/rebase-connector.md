---
sourceHash: 52757f5185d7d81b
title: Connetti Claude a Rebase
sidebar_label: Connettore Rebase
description: Un unico connettore MCP per tutti i tuoi progetti Rebase, su Rebase Cloud o self-hosted — aggiungilo una sola volta in Claude, accedi con il tuo account Rebase e visualizza, rilascia e modifica i tuoi progetti con gli accessi che hai nella console, con ogni modifica confermata preventivamente.
---

Il connettore Rebase è un unico server MCP per tutti i progetti Rebase che gestisci: su Rebase Cloud e sui tuoi server. Lo aggiungi una volta in Claude, accedi con il tuo account Rebase e Claude potrà vedere i tuoi progetti, leggerne i log, effettuarne il deploy e il rollback, impostare le variabili d'ambiente e leggerne e modificarne i dati. Funziona in Claude sul web, nell'app desktop e su mobile.

Agisce per conto **tuo**, con i permessi di accesso che il tuo account ha nella console: i progetti delle organizzazioni a cui appartieni, il ruolo che ricopri in ciascuna e l'accesso ai dati fornito dallo Studio della console. Non possiede alcuna chiave propria.

## Aggiungilo

In Claude, apri **Settings → Connectors → Add custom connector** e inserisci:

```text
https://app.rebase.pro/mcp
```

Claude aprirà la schermata di consenso di Rebase. Se hai già effettuato l'accesso alla console nello stesso browser, ti proporrà quell'account: premi **Allow**. In caso contrario, effettua l'accesso da lì. La schermata elenca i permessi che stai concedendo; puoi riconnetterti in seguito per concederne meno.

I tuoi progetti Rebase Cloud saranno già presenti. La configurazione per loro è tutta qui.

## Aggiungi le tue istanze self-hosted

Esegui questo comando una volta per ciascun server che ospiti autonomamente:

```bash
rebase cloud connect https://admin.example.com
```

Il comando aggiunge l'istanza al tuo account Rebase e stampa due variabili. Impostale su quel server e riavvialo; il comando attende finché il server non risponde, quindi segnala che è connesso. All'interno della cartella del progetto, propone di scriverle nel file `.env` per te.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Da quel momento in poi Claude elencherà l'istanza accanto ai tuoi progetti Cloud, e potrai fare riferimento a essa nello stesso modo: "mostrami gli ordini su admin.example.com". Su un'istanza self-hosted, il connettore legge e modifica i dati, ne legge lo schema ed esegue i cron job. I deploy, le variabili d'ambiente e i log rimangono sul tuo server.

- **Il server richiede Rebase 0.28.1 o successivo**, raggiungibile via HTTPS a un indirizzo pubblico. Poiché è Rebase Cloud a chiamarlo, non è possibile connettere un server situato esclusivamente su una rete privata.
- **Le variabili non contengono segreti.** La chiave è la chiave pubblica di Rebase Cloud; l'audience identifica questa istanza. Grazie a esse il server accetta token di breve durata firmati da Rebase Cloud esclusivamente per questa istanza e concede loro al massimo ciò che concederebbe Studio: l'accesso ai dati, secondo la relativa row-level security, e i cron job.
- **Le chiamate passano attraverso Rebase Cloud.** Claude comunica con il connettore e il connettore con il tuo server. Un server che non viene mai connesso mantiene il proprio [remote MCP endpoint](/docs/ai/remote-mcp/), senza intermediari.
- **Per disconnetterne una**, esegui `rebase cloud connect --remove https://admin.example.com`, oppure rimuovi le due variabili dal server.

L'aggiunta di un'istanza richiede il ruolo di owner o admin dell'organizzazione, esattamente come per accedere ai dati di un progetto. Il comando `rebase cloud connect --list` mostra quelle aggiunte.

## Cosa può fare Claude

Dodici tool. I primi otto sono di sola lettura:

| Tool | Cosa fa |
|---|---|
| `projects` | Elenca i tuoi progetti, il loro stato e il tuo ruolo in ciascuno di essi |
| `project_status` | Lo stato di un progetto e l'ultimo deployment; opzionalmente i deployment recenti, i **nomi** delle variabili d'ambiente, i suoi cron job |
| `logs` | L'output dell'applicazione in esecuzione, il log di build di un deployment o le esecuzioni di un cron job |
| `schema` | Le collezioni di un progetto o i campi di una singola collezione |
| `query` | Legge le righe: una per ID, una pagina filtrata o un conteggio |
| `show_collection` | Apre una collezione nella vista del tuo pannello di amministrazione, direttamente nella conversazione: una tabella, un elenco, schede o una bacheca kanban in cui cercare, filtrare e paginare, dove selezionando una riga si apre il rispettivo modulo |
| `show_record` | Apre il modulo di una singola riga, o il modulo compilato da Claude per una nuova riga, affinché tu possa verificarlo e salvarlo |
| `show_app` | Apre una schermata dedicata per l'attività in corso: viste di collezioni, moduli e conteggi, in cui un elemento può aggiornarsi in base alla riga selezionata in un altro |

Gli altri quattro modificano la produzione e ciascuno richiede prima una conferma:

| Tool | Cosa fa |
|---|---|
| `write` | Crea, aggiorna o elimina una riga (utenti inclusi: sono righe della tua collezione users) |
| `deploy` | Esegue il deploy di un ramo Git, effettua il rollback a un deployment precedente o ne annulla uno in corso |
| `env` | Imposta o rimuove variabili d'ambiente; le modifiche vengono applicate al deploy successivo |
| `cron` | Esegue un cron job immediatamente, oppure ne attiva o disattiva uno |

Il deployment del codice dalla tua macchina locale rimane gestito tramite la CLI (`rebase cloud deploy`) e il [server MCP locale](/docs/ai/mcp/), che gestisce anche lo sviluppo locale, la generazione degli schemi e i branch del database.

## Ogni modifica viene confermata

Un tool che apporta modifiche richiede due chiamate. La prima non modifica nulla: restituisce un piano, come ad esempio "Roll shop back to deployment d_81f2", e un token di conferma. Claude ti mostra il piano ed esegue una seconda chiamata con il token solo se confermi. Il token è valido per cinque minuti, per una sola volta e solo per gli argomenti esatti per cui è stato generato: se qualcosa differisce, non viene eseguito nulla.

Claude richiede inoltre la tua autorizzazione prima di invocare uno qualsiasi di questi quattro tool, poiché sono contrassegnati come distruttivi. Nelle viste, il salvataggio di un modulo mostra il piano e attende che tu prema **Save**.

I valori delle variabili d'ambiente non vengono mai mostrati in risposta: il piano mostra solo la loro lunghezza e `project_status` ne elenca unicamente i nomi. I valori impostati passano comunque attraverso la conversazione.

## A cosa può accedere

- **Progetti e operazioni cloud**: ciò che la console ti consente. Un membro di un'organizzazione può visualizzare lo stato e i log e, come nella console, effettuare deploy e impostare variabili.
- **Dati, schemi e cron job**: ciò che consente Studio nella console. Questo riguarda un owner o admin dell'organizzazione, su un progetto in cui l'accesso a Studio è abilitato, o su un'istanza self-hosted connessa dall'organizzazione. Le chiamate vengono eseguite all'interno del progetto, nel rispetto della sua row-level security, con il ruolo di admin assegnato a Studio. Disattivare l'accesso a Studio per un progetto disattiva anche questa funzionalità.
- **I permessi concessi.** Puoi concedere al connettore meno permessi rispetto a quelli del tuo account: ad esempio solo lettura, o l'accesso a un solo progetto. Non richiede mai l'accesso a backup, ripristini, credenziali del database o impostazioni di progetto.

Un progetto accede ai propri dati tramite il connettore solo se esegue un runtime in grado di gestire le chiamate del connettore stesso. Fino al successivo deploy o rollout della piattaforma, questi tool segnaleranno tale condizione.

## Disconnessione

Rimuovi il connettore nelle impostazioni di Claude. Il suo token di accesso smetterà di funzionare entro un'ora. L'eliminazione del tuo account Rebase o la disconnessione da tutte le sessioni lo bloccherà alla chiamata successiva.

Il connettore è pensato per chi sviluppa su Rebase. Per consentire agli utenti che **utilizzano** la tua applicazione di connettervi Claude a proprio nome, esponi il [remote MCP endpoint](/docs/ai/remote-mcp/) direttamente dal tuo backend.
