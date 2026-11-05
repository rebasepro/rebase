---
sourceHash: 97232ebc628a975c
title: Collegare Claude a Rebase Cloud
sidebar_label: Connettore Rebase Cloud
description: Un solo connettore MCP per tutti i tuoi progetti Rebase Cloud — aggiungilo una volta in Claude, accedi con il tuo account Rebase, e leggi, distribuisci e modifica i tuoi progetti con l'accesso che hai nella console, confermando prima ogni modifica.
---

Il connettore Rebase è un unico server MCP per tutto ciò che esegui su Rebase
Cloud. Lo aggiungi una volta in Claude, accedi con il tuo account Rebase, e
Claude può vedere i tuoi progetti, leggerne i log, distribuirli e riportarli
indietro, impostarne le variabili d'ambiente, e leggerne e modificarne i dati.
Funziona in Claude sul web, nell'app desktop e su mobile.

Agisce **come te**, con l'accesso che il tuo account ha nella console: i
progetti delle organizzazioni di cui fai parte, il ruolo che hai in ciascuna, e
l'accesso ai dati che ti dà lo Studio della console. Non ha alcuna chiave sua.

## Aggiungilo

In Claude, apri **Impostazioni → Connettori → Aggiungi connettore
personalizzato** e inserisci:

```text
https://app.rebase.pro/mcp
```

Claude apre la schermata di consenso di Rebase. Se hai già effettuato l'accesso
alla console nello stesso browser, propone quell'account: premi **Consenti**.
Altrimenti accedi lì. La schermata elenca ciò che concedi; puoi ricollegarti più
tardi per concedere meno.

## Cosa può farci Claude

Dieci tool. I primi sei leggono soltanto:

| Tool | Cosa fa |
|---|---|
| `projects` | Elenca i tuoi progetti, il loro stato e il tuo ruolo in ciascuno |
| `project_status` | Lo stato e l'ultimo deployment di un progetto; facoltativamente i deployment recenti, i **nomi** delle sue variabili d'ambiente, i suoi cron job |
| `logs` | L'output dell'app in esecuzione, il log di build di un deployment, o le esecuzioni di un cron job |
| `schema` | Le collection di un progetto, o i campi di una collection |
| `query` | Legge righe: una per id, una pagina filtrata, o un conteggio |
| `show_collection` | Mostra righe come tabella nella conversazione, dove puoi sfogliarle e modificare le celle |

Gli altri quattro modificano la produzione, e ciascuno chiede prima:

| Tool | Cosa fa |
|---|---|
| `write` | Crea, aggiorna o elimina una riga (utenti compresi: sono righe della tua collection degli utenti) |
| `deploy` | Distribuisce un branch git, torna a un deployment precedente, o annulla uno in corso |
| `env` | Imposta o rimuove variabili d'ambiente; una modifica si applica al deploy successivo |
| `cron` | Esegue subito un cron job, o lo attiva o disattiva |

Distribuire codice dalla tua macchina resta compito della CLI
(`rebase cloud deploy`) e del [server MCP locale](/docs/ai/mcp/), che copre anche
lo sviluppo locale, la generazione dello schema e i branch del database.

## Ogni modifica viene confermata

Un tool che modifica qualcosa richiede due chiamate. La prima non cambia nulla:
risponde con un piano, come "Riporta shop al deployment d_81f2", e un token di
conferma. Claude ti mostra il piano e richiama con il token solo se sei
d'accordo. Il token vale cinque minuti, una volta, esattamente per gli argomenti
per cui è stato creato: se qualcosa è diverso, non viene eseguito nulla.

Claude ti chiede anche il permesso prima di chiamare uno di questi quattro
tool, perché sono contrassegnati come distruttivi. Nella vista a tabella, una
cella modificata mostra il piano e aspetta che tu prema **Salva**.

I valori delle variabili d'ambiente non vengono mai rimostrati: un piano ne
indica la lunghezza, e `project_status` elenca solo i nomi. Un valore che
imposti passa comunque dalla conversazione.

## Fin dove arriva

- **Progetti e operazioni cloud**: ciò che la console ti consente. Un membro di
  un'organizzazione può leggere stato e log e, come nella console, distribuire e
  impostare variabili.
- **Dati, schemi e cron job**: ciò che Studio ti consente nella console. Cioè un
  owner o admin dell'organizzazione, su un progetto con l'accesso di Studio
  attivo. Le chiamate vengono eseguite dentro il progetto, sotto la sua
  sicurezza a livello di riga, con il ruolo admin che ha Studio. Disattivare
  l'accesso di Studio per un progetto disattiva anche questo.
- **Ciò che hai concesso.** Puoi concedere al connettore meno di quanto ha il
  tuo account: solo lettura, o un solo progetto. Non chiede mai backup,
  ripristini, credenziali del database né impostazioni del progetto.

Un progetto rende raggiungibili i suoi dati tramite il connettore appena esegue
un runtime che accetta le chiamate del connettore. Fino al suo prossimo deploy
o al prossimo aggiornamento della piattaforma, quei tool lo segnalano.

## Scollegare

Rimuovi il connettore nelle impostazioni di Claude. Il suo token di accesso
smette di funzionare entro un'ora. Se elimini il tuo account Rebase, o esci da
tutte le sessioni, si ferma alla chiamata successiva.

Il connettore è per chi costruisce su Rebase Cloud. Perché le persone che
**usano** la tua app possano collegarvi Claude a proprio nome, servi
l'[endpoint MCP remoto](/docs/ai/remote-mcp/) dal tuo backend.
