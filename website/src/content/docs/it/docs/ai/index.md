---
sourceHash: ff803e68f256ae11
title: IA e agenti
sidebar_label: Panoramica
description: Cosa offre Rebase per gli assistenti di programmazione IA e gli agenti autonomi — un server MCP, skill per agenti a livello di progetto, file di istruzioni con scaffolding e il modello di credenziali che stabilisce a cosa un agente può effettivamente accedere.
---

**Per usare Claude con i tuoi progetti Rebase, aggiungi il [connettore Rebase](/docs/ai/rebase-connector/).**
In Claude, apri **Settings → Connectors → Add custom connector**, inserisci
`https://app.rebase.pro/mcp` ed effettua l'accesso con il tuo account Rebase. I tuoi progetti
Rebase Cloud saranno disponibili immediatamente; aggiungi ciascun server self-hosted una sola volta con
`rebase cloud connect https://your-app.com`. Un unico connettore li raggiunge tutti.

Oltre a questo, Rebase include cinque elementi distinti per gli assistenti IA, e ciascuno risolve
problemi differenti. Vale la pena sapere a quale affidarsi:

| | Cos'è | Chi lo usa |
|---|---|---|
| [**Rebase connector**](/docs/ai/rebase-connector) | Un connettore MCP ospitato su `app.rebase.pro/mcp` per ogni progetto che esegui, su Rebase Cloud o self-hosted: dati, schema, cron e, sui deploy Cloud, env e log | Claude sul web, desktop e mobile, con la tua identità |
| [**MCP server**](/docs/ai/mcp) | Un server Model Context Protocol via stdio con 53 tool per schema, dati, utenti, storage, cron, dev server e progetto Rebase Cloud | Un assistente, a runtime |
| [**Agent skills**](/docs/ai/skills) | 23 file di skill Markdown scritti nel tuo repository da `rebase skills install` | Un assistente, come materiale di riferimento |
| [**Instruction files**](/docs/ai/instruction-files) | `ai-instructions.md` più file di puntamento specifici per assistente, scritti da `rebase init` | Un assistente, come regole sempre attive |
| [**API keys**](/docs/backend/api-keys) | Credenziali macchina contenenti [scope](/docs/backend/roles-and-scopes), per collezione e per operazione | Qualsiasi entità che chiami l'API HTTP |

I primi quattro servono a fornire a un assistente *conoscenza* e *strumenti*. Il
quinto è l'unico che stabilisce cosa può effettivamente fare.

## La parte fondamentale: a cosa può accedere un agente

Un agente dotato di tool sul tuo database è un normale client API che si dà il caso
decida autonomamente la sua prossima richiesta. Rebase non tenta di limitarlo con
le istruzioni: un prompt non è un meccanismo di controllo degli accessi, e un agente che
legge le tue righe sta leggendo testo che qualcun altro potrebbe aver scritto. Il
vincolo deve risiedere al di sotto dell'agente, nelle credenziali di cui dispone.

Rebase fornisce a queste credenziali due gate indipendenti:

1. **Gli scope della chiave.** Dichiarati per operazione *e*, se lo desideri, per
   collezione: `data:read:articles`, `data:write:articles`. `data:delete` è
   separato da `data:write`, che di solito è quello che si vuole negare
   a un agente a cui è altrimenti consentito modificare.
2. **Row-Level Security (RLS).** Le chiavi API non ignorano la RLS. Una chiave si connette con il
   ruolo Postgres `rebase_user` come qualsiasi altro chiamante, quindi le tue policy
   determinano comunque quali righe vengono restituite.

Entrambi devono autorizzare una richiesta. Nessuno dei due sostituisce l'altro, e il secondo
è il motivo per cui una chiave che dispone di `data:read` su ogni collezione può comunque restituire
un set di risultati vuoto.

Un dettaglio che spesso trae in inganno: l'impostazione `access: "public"` di una collezione estende **quali
righe un chiamante può vedere**, non **chi può effettuare chiamate**. È un'indicazione sulla
visibilità delle righe, non sull'autenticazione. Concederla non assegna uno scope a una chiave,
e negarla non ne blocca una.

Il funzionamento pratico — creazione delle chiavi, scelta degli scope, rotazione, scadenza, rate
limit — è trattato in [API keys](/docs/backend/api-keys).
Non saltare le [Security Rules (RLS)](/docs/collections/security-rules);
il secondo gate è efficace solo quanto le policy che hai scritto.

:::caution[Il server MCP non utilizza di default una chiave con scope]
Il modello a due gate descritto sopra illustra il funzionamento di una chiave API. **Non** è ciò
che `@rebasepro/mcp` utilizza, a meno che non venga configurato appositamente. Se non modificato, il server MCP
si autentica con la **service key** del tuo server di sviluppo — una credenziale di amministrazione
senza scope che soddisfa le policy admin predefinite su ogni collezione. Consulta
[A cosa può accedere il server MCP](/docs/ai/mcp#what-the-server-can-reach)
prima di indirizzare un assistente verso risorse critiche.
:::

## Ricerca vettoriale

Rebase offre un tipo di proprietà `vector` nativo su Postgres e un
metodo di query `.vectorSearch()` con distanze `cosine`, `l2` e `inner_product`.
È già documentato, in due punti distinti:

- [Querying Data → Vector Search](/docs/sdk/aggregates-and-search#vector-search) — il metodo SDK,
  il campo `_distance` aggiunto a ogni riga e i relativi avvertimenti
- [REST API → Vector Search](/docs/backend/api#vector-search) — i parametri di query
  `vector_search`, `vector`, `vector_distance` e `vector_threshold`

Tre aspetti da sapere prima di progettare basandosi su di essa. **Rebase archivia ed effettua ricerche sugli
embedding; non li calcola** — non sono presenti provider di embedding, impostazioni del
modello o chiavi API all'interno di Rebase, quindi la generazione dei vettori spetta a te.
**pgvector è un prerequisito e l'installazione è facoltativa (opt-in).**
`database({ extensions: ["vector"] })` in `config/resources.ts` consente a `rebase db
push` e alla verifica dello schema all'avvio di eseguire `CREATE EXTENSION IF NOT EXISTS vector` per
te; in sua assenza, creano la colonna lasciando l'installazione dell'estensione a tuo carico. In entrambi i
casi, il server necessita di un'immagine che contenga la libreria e di un ruolo autorizzato a installarla.
Inoltre, **ogni colonna vettoriale ottiene un indice HNSW per
la distanza del coseno**, poiché il coseno è ciò che misura `vectorSearch` a meno che
non si passi `distance` — un indice supporta esattamente un operatore. Puoi regolarlo o
disattivarlo sulla proprietà: consulta [The index](/docs/sdk/aggregates-and-search#the-index).

Inoltre, non è possibile sottoscriversi alle query vettoriali; `.vectorSearch(...).listen()` viene
rifiutato con l'errore `VECTOR_SEARCH_NOT_LIVE`.

Per la ricerca lessicale — full-text con classificazione sui campi specificati, inclusi contenuti
JSONB e array — consulta [Search](/docs/backend/search). Si tratta di un meccanismo
differente e i due non interagiscono tra loro.

## Passi successivi

- [Rebase connector](/docs/ai/rebase-connector) — Claude, connesso a ogni progetto che esegui
- [MCP Server](/docs/ai/mcp) — connetti Claude Code, Cursor o qualsiasi client MCP
- [Agent Skills](/docs/ai/skills) — `rebase skills install` e le 23 skill
- [AI Instruction Files](/docs/ai/instruction-files) — il pattern per i file di regole con scaffolding
