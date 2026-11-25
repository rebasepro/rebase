---
sourceHash: 0dcbce5cfcf3e2de
title: Collega Claude a Rebase
sidebar_label: Connettore Rebase
description: Un unico connettore MCP per tutti i tuoi progetti Rebase, su Rebase Cloud o self-hosted — aggiungilo una sola volta in Claude, accedi con il tuo account Rebase e leggi, distribuisci e modifica i tuoi progetti con gli accessi che hai nella console, con ogni modifica confermata preventivamente.
---

Il connettore Rebase è un unico server MCP per ogni progetto Rebase che esegui: su
Rebase Cloud e sui tuoi server. Lo aggiungi una sola volta in Claude, accedi con
il tuo account Rebase e Claude potrà vedere i tuoi progetti, leggere i loro log,
distribuirli ed eseguirne il rollback, impostare le loro variabili d'ambiente e
leggere e modificare i loro dati. Funziona in Claude sul web, nell'app desktop e su mobile.

Agisce come **te**, con gli accessi che il tuo account possiede nella console: i
progetti delle organizzazioni a cui appartieni, il ruolo che ricopri in ciascuna
e l'accesso ai dati fornito dallo Studio della console. Non possiede alcuna chiave propria.

## Aggiungilo

In Claude, apri **Settings → Connectors → Add custom connector** e inserisci:

```text
https://app.rebase.pro/mcp
```

Claude apre la schermata di consenso di Rebase. Se hai già effettuato l'accesso alla console
nello stesso browser, ti proporrà quell'account: premi **Allow**. In caso contrario,
accedi da lì. La schermata elenca le autorizzazioni concesse; puoi riconnetterti in
seguito per concederne di meno.

I tuoi progetti Rebase Cloud sono già disponibili. Questa è l'intera configurazione necessaria per essi.

## Aggiungi le tue istanze self-hosted

Esegui questo comando una volta per ogni server che ospiti autonomamente:

```bash
rebase cloud connect https://admin.example.com
```

Aggiunge l'istanza al tuo account Rebase e stampa due variabili. Impostale
su quel server e riavvialo; il comando attende finché il server non risponde,
quindi segnala che è connesso. All'interno della cartella del progetto ti proporrà
di scriverle nel file `.env` per te.

```bash
REBASE_PLATFORM_TOKEN_KEY=…
REBASE_PLATFORM_TOKEN_AUDIENCE=linked:…
```

Da quel momento in poi Claude elencherà l'istanza accanto ai tuoi progetti Cloud,
e potrai indicarla allo stesso modo: "mostrami gli ordini su admin.example.com". Su
un'istanza self-hosted il connettore legge e modifica i dati, ne legge lo schema ed
esegue i suoi cron job. Deploy, variabili d'ambiente e log rimangono sul tuo server.

- **Il server richiede Rebase 0.28.1 o successivo**, raggiungibile via HTTPS a un
  indirizzo pubblico. Rebase Cloud effettua chiamate verso di esso, quindi un server
  presente solo su una rete privata non può essere connesso.
- **Le variabili non contengono segreti.** La chiave è la chiave pubblica di Rebase Cloud;
  l'audience identifica questa istanza. Grazie a esse il server accetta token di
  breve durata che Rebase Cloud firma esclusivamente per questa istanza, concedendo al
  massimo ciò che concederebbe Studio: dati, soggetti alla row-level security, e cron.
- **Le chiamate passano attraverso Rebase Cloud.** Claude comunica con il connettore
  e il connettore con il tuo server. Un server che non connetti mai mantiene il proprio
  [remote MCP endpoint](/docs/ai/remote-mcp/), senza nulla nel mezzo.
- **Per disconnetterne uno**, esegui `rebase cloud connect --remove https://admin.example.com`,
  oppure rimuovi le due variabili dal server.

L'aggiunta di un'istanza richiede il ruolo di owner o admin dell'organizzazione,
esattamente come per accedere ai dati di un progetto. `rebase cloud connect --list`
mostra quelle che hai aggiunto.

## Cosa può fare Claude con esso

Sedici strumenti. I primi dodici eseguono solo letture:

| Tool | Cosa fa |
|---|---|
| `projects` | Elenca i tuoi progetti, il loro stato e il tuo ruolo in ciascuno |
| `project_status` | Lo stato di un progetto e l'ultimo deployment; opzionalmente i suoi deployment recenti, i **nomi** delle sue variabili d'ambiente, i suoi cron job |
| `logs` | L'output dell'applicazione in esecuzione, il log di build di un deployment o le esecuzioni di un cron job |
| `schema` | Le tabelle di un progetto, o le colonne, le relazioni e le regole di sicurezza di una tabella |
| `query` | Legge le righe: una per id, una pagina filtrata o un conteggio |
| `storage_list` | Elenca una cartella dello storage di file di un progetto, una pagina alla volta, e indica le sorgenti di storage e il rispettivo bucket servito |
| `storage_head` | Indica se un file è presente, oltre a dimensioni, tipo e ultima modifica. Accetta la chiave o il valore `s3://bucket/key` memorizzato in una riga |
| `storage_get` | Legge un file: il suo contenuto se si tratta di testo (i primi 64 KB per impostazione predefinita), oppure dimensioni e tipo se è binario |
| `show_table` | Apre una tabella nella vista del tuo pannello di amministrazione, direttamente nella conversazione: una tabella, un elenco, schede o una bacheca kanban in cui puoi cercare, filtrare e sfogliare le pagine, dove una riga apre il rispettivo form |
| `show_record` | Apre il form di una riga, o un form per una nuova riga compilata da Claude, affinché tu possa verificarla e salvarla |
| `show_app` | Crea una piccola applicazione per l'attività in corso, come una coda di triage o una dashboard, e la esegue sui tuoi dati all'interno della conversazione. Può utilizzare le viste e i form del tuo pannello di amministrazione, e chiede conferma prima di apportare qualsiasi modifica |
| `show_app_guide` | Come scrivere il codice per `show_app`: gli hook, i componenti e le prop che un'app può usare, con un esempio. Claude la legge prima di compilare un'app |

Gli altri quattro apportano modifiche in produzione e ciascuno richiede prima una conferma:

| Tool | Cosa fa |
|---|---|
| `write` | Crea, aggiorna o elimina una riga (utenti inclusi: sono righe della tua tabella users) |
| `deploy` | Distribuisce un ramo git, esegue il rollback a un deployment precedente o ne annulla uno in corso |
| `env` | Imposta o rimuove variabili d'ambiente; la modifica si applica al deployment successivo |
| `cron` | Esegue un cron job subito, oppure ne attiva o disattiva uno |

La distribuzione del codice dalla tua macchina locale rimane gestita tramite la CLI (`rebase cloud deploy`) e
il [server MCP locale](/docs/ai/mcp/), che copre anche lo sviluppo locale,
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

Uno strumento che apporta una modifica richiede due chiamate. La prima non modifica
nulla: restituisce un piano, come "Roll shop back to deployment d_81f2", e un
token di conferma. Claude ti mostra il piano ed effettua una seconda chiamata con il token
solo se acconsenti. Il token è valido per cinque minuti, per una sola volta e
unicamente per gli argomenti esatti per cui è stato generato: se qualcosa differisce,
non viene eseguito nulla.

Claude chiede inoltre la tua autorizzazione prima di chiamare uno qualsiasi di questi quattro
strumenti, poiché sono contrassegnati come distruttivi. Nelle viste, il salvataggio di un
form mostra il piano e attende che tu prema **Save**.

I valori delle variabili d'ambiente non vengono mai mostrati in risposta: un piano mostra
la loro lunghezza e `project_status` elenca solo i nomi. Il valore impostato
passa comunque attraverso la conversazione.

## Cosa può raggiungere

- **Progetti e operazioni cloud**: ciò che ti consente la console. Un membro di
  un'organizzazione può leggere stato e log e, come nella console, effettuare deploy
  e impostare variabili.
- **Dati, file, schemi e cron job**: ciò che ti consente Studio nella console. Vale a dire
  un owner o admin dell'organizzazione, su un progetto per il quale l'accesso a Studio è
  abilitato, o su un'istanza self-hosted connessa dall'organizzazione. Le chiamate vengono eseguite
  all'interno del progetto, sotto la sua row-level security, con il ruolo di admin proprio di Studio.
  I file vengono letti attraverso le sorgenti di storage del progetto stesso (Rebase storage
  o il bucket configurato dalle sue variabili `S3_*`) in base alle relative regole di archiviazione,
  e non vengono mai scritti né eliminati. Disabilitare l'accesso a Studio per un progetto
  disabilita anche questo.
- **Cosa hai concesso.** Puoi concedere al connettore meno permessi di quanti ne
  possieda il tuo account: solo lettura o solo un singolo progetto. Non richiede
  mai backup, ripristini, credenziali del database o impostazioni di progetto.

Un progetto accede ai propri dati tramite il connettore una volta eseguito un runtime in grado
di accettare le chiamate del connettore, e ai suoi file una volta che tale runtime dispone
degli strumenti di archiviazione. Fino al successivo deploy o rollout della piattaforma,
tali strumenti lo segnaleranno.

## Disconnessione

Rimuovi il connettore nelle impostazioni di Claude. Il suo token di accesso smette di
funzionare entro un'ora. L'eliminazione del tuo account Rebase o la disconnessione
da tutte le sessioni lo blocca alla chiamata successiva.

Il connettore è pensato per chi sviluppa su Rebase. Per consentire a chi
**utilizza** la tua app di connettere Claude identificandosi con il proprio account, esponi il
[remote MCP endpoint](/docs/ai/remote-mcp/) dal tuo backend.
