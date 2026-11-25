---
sourceHash: 94bd49dce72c5651
title: Connettere Claude a Rebase
sidebar_label: Connettore Rebase
description: Un unico connettore MCP per tutti i tuoi progetti Rebase, su Rebase Cloud o self-hosted — aggiungilo una sola volta in Claude, accedi con il tuo account Rebase e visualizza, distribuisci e modifica i tuoi progetti con gli accessi che hai nella console, con ogni modifica confermata prima dell'esecuzione.
---

Il connettore Rebase è un unico server MCP per ogni progetto Rebase che esegui: su
Rebase Cloud e sui tuoi server. Lo aggiungi una sola volta in Claude, accedi con
il tuo account Rebase e Claude potrà visualizzare i tuoi progetti, leggerne i log,
distribuirli ed eseguirne il rollback, impostare le relative variabili d'ambiente,
nonché leggerne e modificarne i dati. Funziona in Claude sul web, nell'app desktop e su dispositivi mobili.

Agisce a **tuo** nome, con i permessi di accesso che il tuo account possiede nella
console: i progetti delle organizzazioni a cui appartieni, il ruolo che ricopri in
ciascuna e l'accesso ai dati fornito da Studio nella console. Non possiede alcuna chiave propria.

## Aggiungilo

In Claude, apri **Settings → Connectors → Add custom connector** e inserisci:

```text
https://app.rebase.pro/mcp
```

Claude aprirà la schermata di consenso di Rebase. Se hai già effettuato l'accesso alla
console nello stesso browser, ti proporrà tale account: premi **Allow**. Altrimenti, effettua
l'accesso da lì. La schermata elenca i permessi concessi; puoi connetterti di nuovo
in seguito per concederne meno.

I tuoi progetti Rebase Cloud saranno già presenti. La loro configurazione termina qui.

## Aggiungi le tue istanze self-hosted

Esegui questo comando una volta per ciascun server di cui gestisci l'hosting:

```bash
rebase cloud connect https://admin.example.com
```

Il comando aggiunge l'istanza al tuo account Rebase e mostra due variabili. Impostale
su quel server e riavvialo; il comando attende finché il server non risponde, quindi
notifica l'avvenuta connessione. All'interno della cartella del progetto, si offrirà
di scriverle nel file `.env` per te.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Da quel momento in poi, Claude mostrerà l'istanza accanto ai tuoi progetti Cloud, e potrai
riferirti a essa nello stesso modo: "mostrami gli ordini su admin.example.com". Su un'istanza
self-hosted, il connettore legge e modifica i dati, ne legge lo schema ed esegue i relativi
cron job. Distribuzioni, variabili d'ambiente e log rimangono sul tuo server.

- **Il server richiede Rebase 0.28.1 o successivo**, raggiungibile tramite HTTPS a un
  indirizzo pubblico. Rebase Cloud invia richieste verso di esso, pertanto un server accessibile
  esclusivamente su una rete privata non può essere connesso.
- **Le variabili non contengono segreti.** La chiave corrisponde alla chiave pubblica di Rebase Cloud;
  l'audience identifica questa istanza. Tramite di esse, il server accetta token di breve durata
  firmati da Rebase Cloud unicamente per questa istanza e concede loro al massimo ciò che
  concederebbe Studio: dati, soggetti alla sicurezza a livello di riga (row-level security), e cron job.
- **Le chiamate transitano attraverso Rebase Cloud.** Claude comunica con il connettore, e il
  connettore con il tuo server. Un server mai connesso mantiene il proprio
  [remote MCP endpoint](/docs/ai/remote-mcp/), senza intermediari.
- **Per disconnetterne una**, esegui `rebase cloud connect --remove https://admin.example.com`,
  oppure rimuovi le due variabili dal server.

L'aggiunta di un'istanza richiede il ruolo di owner o admin dell'organizzazione, esattamente come
per accedere ai dati di un progetto. Il comando `rebase cloud connect --list` mostra quelle aggiunte.

## Cosa può fare Claude

Tredici tool. I primi nove sono di sola lettura:

| Tool | Cosa fa |
|---|---|
| `projects` | Elenca i tuoi progetti, il loro stato e il tuo ruolo in ciascuno |
| `project_status` | Lo stato di un singolo progetto e l'ultima distribuzione; facoltativamente le sue distribuzioni recenti, i **nomi** delle sue variabili d'ambiente, i suoi cron job |
| `logs` | L'output dell'app in esecuzione, il log di build di un deployment o le esecuzioni di un cron job |
| `schema` | Le tabelle di un progetto, oppure le colonne, le relazioni e le regole di sicurezza di una singola tabella |
| `query` | Legge le righe: una per ID, una pagina filtrata o un conteggio |
| `show_table` | Apre una tabella nella vista del tuo pannello di amministrazione, all'interno della conversazione: una tabella, un elenco, schede o una bacheca kanban in cui puoi cercare, filtrare e paginare, dove ogni riga apre il rispettivo form |
| `show_record` | Apre il form di una singola riga, o un form precompilato da Claude per una nuova riga, da verificare e salvare |
| `show_app` | Crea una piccola app per l'attività corrente, come una coda di smistamento o una dashboard, ed esegue l'elaborazione sui tuoi dati nella conversazione. Può utilizzare le viste e i form del tuo pannello di amministrazione e richiede sempre conferma prima di apportare modifiche |
| `show_app_guide` | Come scrivere il codice per `show_app`: hook, componenti e prop che un'app può utilizzare, corredati da un esempio. Claude la consulta prima di creare un'app |

Gli altri quattro applicano modifiche alla produzione e ciascuno richiede prima una conferma:

| Tool | Cosa fa |
|---|---|
| `write` | Crea, aggiorna o elimina una singola riga (utenti inclusi: sono righe della tua tabella degli utenti) |
| `deploy` | Distribuisce un branch Git, esegue il rollback a una distribuzione precedente o ne annulla una in corso |
| `env` | Imposta o rimuove variabili d'ambiente; le modifiche vengono applicate alla distribuzione successiva |
| `cron` | Esegue immediatamente un cron job oppure ne attiva/disattiva uno |

La distribuzione del codice dalla tua macchina locale rimane gestita tramite la CLI (`rebase cloud deploy`) e
il [server MCP locale](/docs/ai/mcp/), che gestisce anche lo sviluppo locale,
la generazione dello schema e i branch del database.

## Skill

Il connettore fornisce inoltre le 24 [skill dell'agente Rebase](/docs/ai/skills/),
le stesse che `rebase skills install` copia all'interno di un progetto. Claude ne carica una
quando l'attività lo richiede: come definire una tabella, scrivere un hook, configurare l'autenticazione,
distribuire. Non è necessario installare alcunché. Claude Code le elenca come
`<connector>:rebase-tables` e così via, con il nome assegnato al connettore.
Le skill tramite MCP richiedono un client conforme alla revisione del protocollo 2026-07-28 o successiva,
e sono attualmente disponibili in beta pubblica in Claude Code.

## Ogni modifica viene confermata

Un tool che effettua modifiche richiede due chiamate. La prima non modifica nulla:
risponde con un piano d'azione, ad esempio "Roll shop back to deployment d_81f2", e un
token di conferma. Claude mostra il piano ed effettua una seconda chiamata con il token
solo se confermi. Il token è valido per cinque minuti, per un solo utilizzo e per gli esatti
argomenti per cui è stato generato: se un parametro differisce, non viene eseguita alcuna operazione.

Claude richiede inoltre la tua autorizzazione prima di chiamare uno qualsiasi di questi quattro tool,
poiché sono contrassegnati come distruttivi. Nelle viste, il salvataggio di un form mostra
il piano e attende che tu prema **Save**.

I valori delle variabili d'ambiente non vengono mai mostrati in risposta: il piano indica solo
la loro lunghezza e `project_status` elenca esclusivamente i nomi. Un valore impostato passa
comunque attraverso la conversazione.

## A cosa può accedere

- **Progetti e operazioni cloud**: ciò che ti consente la console. Un membro di
  un'organizzazione può visualizzare stato e log e, come nella console, effettuare distribuzioni
  e impostare variabili.
- **Dati, schemi e cron job**: ciò che consente Studio nella console. Ovvero
  un owner o admin dell'organizzazione, su un progetto per il quale l'accesso a Studio è
  abilitato, o su un'istanza self-hosted connessa dall'organizzazione. Le chiamate vengono eseguite
  all'interno del progetto, soggette alla sicurezza a livello di riga (row-level security), con
  il ruolo admin proprio di Studio. La disattivazione dell'accesso a Studio per un progetto disattiva
  anche questo accesso.
- **Ciò che hai autorizzato.** Puoi concedere al connettore meno permessi rispetto a
  quelli del tuo account: solo lettura, o un solo progetto. Non richiede mai backup,
  ripristini, credenziali del database o impostazioni di progetto.

Un progetto consente l'accesso ai propri dati tramite il connettore solo una volta in esecuzione
su un runtime compatibile con le chiamate del connettore. Fino alla successiva distribuzione o
rilascio della piattaforma, tali tool segnaleranno questo stato.

## Disconnessione

Rimuovi il connettore nelle impostazioni di Claude. Il relativo token di accesso cesserà di funzionare
entro un'ora. L'eliminazione del tuo account Rebase o la disconnessione da tutte le sessioni
lo bloccherà alla chiamata successiva.

Il connettore è progettato per chi crea su Rebase. Per consentire agli utenti
che **utilizzano** la tua applicazione di connettervi Claude a proprio nome, esponi il
[remote MCP endpoint](/docs/ai/remote-mcp/) dal tuo backend.
