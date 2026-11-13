---
sourceHash: 940a1c3ace06a8c3
title: Connetti Claude a Rebase
sidebar_label: Connettore Rebase
description: Un unico connettore MCP per tutti i tuoi progetti Rebase, su Rebase Cloud o self-hosted — aggiungilo una volta in Claude, accedi con il tuo account Rebase e leggi, distribuisci e modifica i tuoi progetti con l'accesso che hai nella console, con ogni modifica confermata prima dell'esecuzione.
---

Il connettore Rebase è un unico server MCP per ogni progetto Rebase che esegui: su
Rebase Cloud e sui tuoi server. Lo aggiungi una volta in Claude, accedi con
il tuo account Rebase e Claude può vedere i tuoi progetti, leggere i loro log, distribuirli
ed eseguirne il rollback, impostare le loro variabili d'ambiente e leggere e modificare i loro
dati. Funziona in Claude sul web, nell'app desktop e su dispositivi mobili.

Agisce come **te**, con l'accesso di cui dispone il tuo account nella console: i
progetti delle organizzazioni a cui appartieni, il ruolo che ricopri in ciascuna e l'accesso
ai dati che ti concede lo Studio della console. Non conserva alcuna chiave propria.

## Aggiungilo

In Claude, apri **Settings → Connectors → Add custom connector** e inserisci:

```text
https://app.rebase.pro/mcp
```

Claude apre la schermata di consenso di Rebase. Se hai effettuato l'accesso alla console
nello stesso browser, ti proporrà quell'account: premi **Allow**. In caso contrario,
accedi da lì. La schermata elenca i permessi che stai concedendo; potrai connetterti
di nuovo in seguito per concederne meno.

I tuoi progetti Rebase Cloud sono già presenti. Questa è l'intera configurazione necessaria per essi.

## Aggiungi le tue istanze self-hosted

Esegui questo comando una volta per ogni server che ospiti autonomamente:

```bash
rebase cloud connect https://admin.example.com
```

Aggiunge l'istanza al tuo account Rebase e stampa due variabili. Impostale
su quel server e riavvialo; il comando attende finché il server non risponde, quindi
segnala che è connesso. All'interno della cartella del progetto, si offrirà di scriverle
nel file `.env` per te.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Da quel momento in poi Claude elencherà l'istanza accanto ai tuoi progetti Cloud, e potrai
fare riferimento ad essa nello stesso modo: "mostrami gli ordini su admin.example.com". Su
un'istanza self-hosted il connettore legge e modifica i dati, legge il suo schema ed esegue i suoi
cron job. I deploy, le variabili d'ambiente e i log rimangono sul tuo server.

- **Il server richiede Rebase 0.28.1 o successivo**, raggiungibile via HTTPS a un
  indirizzo pubblico. Rebase Cloud lo chiama, quindi un server presente solo su una rete privata
  non può essere connesso.
- **Le variabili non contengono alcun segreto.** La chiave è la chiave pubblica di Rebase Cloud;
  l'audience indica questa istanza. Con esse il server accetta token di breve
  durata firmati da Rebase Cloud esclusivamente per questa istanza, concedendo loro al massimo
  ciò che concederebbe Studio: dati, soggetti alla row-level security, e cron.
- **Le chiamate passano attraverso Rebase Cloud.** Claude comunica con il connettore e il
  connettore con il tuo server. Un server che non colleghi mai mantiene il proprio
  [remote MCP endpoint](/docs/ai/remote-mcp/), senza intermediari.
- **Per disconnetterne uno**, esegui `rebase cloud connect --remove https://admin.example.com`,
  oppure rimuovi le due variabili dal server.

L'aggiunta di un'istanza richiede il ruolo di owner o admin dell'organizzazione, esattamente come per
accedere ai dati di un progetto. `rebase cloud connect --list` mostra quelle che hai aggiunto.

## Cosa può fare Claude con esso

Tredici tool. I primi nove sono di sola lettura:

| Tool | Cosa fa |
|---|---|
| `projects` | Elenca i tuoi progetti, il loro stato e il tuo ruolo in ciascuno |
| `project_status` | Lo stato di un progetto e la sua ultima distribuzione; opzionalmente i suoi deployment recenti, i **nomi** delle sue variabili d'ambiente, i suoi cron job |
| `logs` | L'output dell'app in esecuzione, il log di compilazione di un deployment o le esecuzioni di un cron job |
| `schema` | Le tabelle di un progetto o le colonne, le relazioni e le regole di sicurezza di una tabella |
| `query` | Legge le righe: una per ID, una pagina filtrata o un conteggio |
| `show_table` | Apre una tabella nella vista del tuo pannello di amministrazione, all'interno della conversazione: una tabella, un elenco, schede o una bacheca kanban che puoi cercare, filtrare e sfogliare, in cui una riga apre il relativo modulo |
| `show_record` | Apre il modulo di una riga, oppure un modulo compilato da Claude per una nuova riga, affinché tu possa verificarlo e salvarlo |
| `show_app` | Crea una piccola app per l'attività corrente, come una coda di smistamento o una dashboard, ed eseguila sui tuoi dati all'interno della conversazione. Può utilizzare le viste e i moduli del tuo pannello di amministrazione e ti chiede conferma prima di apportare qualsiasi modifica |
| `show_app_guide` | Come scrivere il codice di `show_app`: gli hook, i componenti e le prop che un'app può utilizzare, con un esempio. Claude la legge prima di creare un'app |

Gli altri quattro modificano l'ambiente di produzione, e ciascuno chiede prima conferma:

| Tool | Cosa fa |
|---|---|
| `write` | Crea, aggiorna o elimina una riga (utenti inclusi: sono righe della tua tabella utenti) |
| `deploy` | Distribuisce un ramo git, esegue il rollback a un deployment precedente o ne annulla uno in corso |
| `env` | Imposta o rimuove variabili d'ambiente; le modifiche vengono applicate al deployment successivo |
| `cron` | Esegue subito un cron job, oppure ne attiva o disattiva uno |

La distribuzione del codice dalla tua macchina rimane affidata alla CLI (`rebase cloud deploy`) e
al [local MCP server](/docs/ai/mcp/), che copre anche lo sviluppo locale,
la generazione di schemi e i branch del database.

## Ogni modifica viene confermata

Un tool che apporta modifiche richiede due chiamate. La prima non modifica nulla:
restituisce un piano, come "Roll shop back to deployment d_81f2", e un
token di conferma. Claude ti mostra il piano e richiama il tool con il token
solo se acconsenti. Il token è valido per cinque minuti, per una sola volta e solo per gli
esatti argomenti per cui è stato generato: se qualcosa differisce, non viene eseguito nulla.

Claude richiede inoltre la tua autorizzazione prima di chiamare uno qualsiasi di questi quattro tool,
poiché sono contrassegnati come distruttivi. Nelle viste, il salvataggio di un modulo mostra
il piano e attende che tu prema **Save**.

I valori delle variabili d'ambiente non vengono mai mostrati in risposta: un piano mostra la loro lunghezza
e `project_status` elenca solo i nomi. Il valore impostato passa comunque attraverso la
conversazione.

## A cosa può accedere

- **Progetti e operazioni cloud**: ciò che la console ti consente di fare. Un membro di
  un'organizzazione può leggere stato e log e, come nella console, effettuare deploy e impostare
  variabili.
- **Dati, schemi e cron job**: ciò che Studio nella console ti consente di fare. Ovvero
  un owner o admin dell'organizzazione, su un progetto per cui l'accesso a Studio è
  abilitato, o su un'istanza self-hosted connessa dall'organizzazione. Le chiamate vengono eseguite all'interno del progetto, soggette alla sua row-level security, con
  il ruolo di amministratore di Studio. Disattivare l'accesso a Studio per un progetto disattiva
  anche questo.
- **Ciò che hai autorizzato.** Puoi concedere al connettore meno permessi rispetto a quelli
  del tuo account: solo lettura, o solo un singolo progetto. Non richiede mai backup,
  ripristini, credenziali del database o impostazioni di progetto.

Un progetto accede ai propri dati tramite il connettore solo quando esegue un runtime in grado di
gestire le chiamate del connettore. Fino al successivo deploy o rollout della piattaforma, tali
tool lo segnaleranno.

## Disconnessione

Rimuovi il connettore nelle impostazioni di Claude. Il suo token di accesso smette di funzionare
entro un'ora. L'eliminazione del tuo account Rebase, o la disconnessione da tutte le sessioni, lo
interrompe alla chiamata successiva.

Il connettore è destinato a chi sviluppa su Rebase. Per consentire agli utenti
che **utilizzano** la tua applicazione di connettervi Claude a proprio nome, esponi il
[remote MCP endpoint](/docs/ai/remote-mcp/) dal tuo backend.
