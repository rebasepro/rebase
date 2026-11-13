---
sourceHash: 4040537e5cc9b4d3
title: AI e agenti
sidebar_label: Panoramica
description: Cosa offre Rebase per assistenti di codifica AI e agenti autonomi — un server MCP, skill per agenti locali al progetto, file di istruzioni con scaffolding e il modello di credenziali che stabilisce a cosa un agente può effettivamente accedere.
---

**Per usare Claude con i tuoi progetti Rebase, aggiungi il [connettore Rebase](/docs/ai/rebase-connector/).**
In Claude, apri **Settings → Connectors → Add custom connector**, inserisci
`https://app.rebase.pro/mcp` ed effettua l'accesso con il tuo account Rebase. I tuoi progetti Rebase
Cloud saranno disponibili immediatamente; aggiungi ciascun server self-hosted una sola volta con
`rebase cloud connect https://your-app.com`. Un unico connettore consente di raggiungerli tutti.

Oltre a questo, Rebase fornisce cinque elementi distinti per gli assistenti AI, che risolvono
problemi differenti. Vale la pena sapere quale scegliere:

| | Cos'è | Chi lo usa |
|---|---|---|
| [**Connettore Rebase**](/docs/ai/rebase-connector) | Un unico connettore MCP ospitato su `app.rebase.pro/mcp` per ogni progetto che esegui, su Rebase Cloud o self-hosted: dati, schema, cron e, sui deploy Cloud, env e log | Claude sul web, desktop e mobile, con la tua identità |
| [**Server MCP**](/docs/ai/mcp) | Un server Model Context Protocol stdio con 53 strumenti relativi a schema, dati, utenti, storage, cron, dev server e progetto Rebase Cloud | Un assistente, a runtime |
| [**Skill per agenti**](/docs/ai/skills) | 24 file Markdown di skill scritti nella tua repo da `rebase skills install` | Un assistente, come materiale di riferimento |
| [**File di istruzioni**](/docs/ai/instruction-files) | `ai-instructions.md` più file di puntamento specifici per assistente, scritti da `rebase init` | Un assistente, come regole sempre attive |
| [**Chiavi API**](/docs/backend/api-keys) | Credenziali macchina che contengono [scope](/docs/backend/roles-and-scopes), per tabella e per operazione | Qualsiasi client che invoca l'API HTTP |

I primi quattro servono a fornire a un assistente *conoscenza* e *strumenti*. Il
quinto è l'unico che stabilisce cosa esso possa effettivamente fare.

## La parte che conta: cosa può toccare un agente

Un agente dotato di strumenti sul tuo database è un normale client API che si trova a
decidere autonomamente la propria richiesta successiva. Rebase non cerca di vincolarlo con
le istruzioni — un prompt non è un meccanismo di controllo degli accessi, e un agente che
legge le tue righe sta leggendo testo che qualcun altro potrebbe aver scritto. Il
vincolo deve risiedere al di sotto dell'agente, nelle credenziali che possiede.

Rebase fornisce a queste credenziali due livelli di controllo indipendenti:

1. **Gli scope della chiave.** Dichiarati per operazione *e*, se desiderato, per
   tabella: `data:read:articles`, `data:write:articles`. `data:delete` è
   separato da `data:write`, ed è solitamente quello che si desidera negare
   a un agente a cui è altrimenti consentito modificare.
2. **Row-Level Security.** Le chiavi API non scavalcano l'RLS. Una chiave si connette con il
   ruolo Postgres `rebase_user` come qualsiasi altro chiamante, quindi le tue policy
   continuano a decidere quali righe vengono restituite.

Entrambi devono autorizzare la richiesta. Nessuno dei due sostituisce l'altro, e il secondo
è il motivo per cui una chiave che detiene `data:read` su ogni tabella può comunque restituire
un set di risultati vuoto.

Un aspetto che spesso trae in inganno: l'impostazione `access: "public"` di una tabella estende **quali
righe un chiamante può vedere**, non **chi può effettuare chiamate**. È un'indicazione sulla visibilità
delle righe, non sull'autenticazione. Concederla non assegna uno scope a una chiave,
e negarla non ne blocca uno.

I dettagli operativi — creazione delle chiavi, scelta degli scope, rotazione, scadenza, rate
limit — sono trattati in [Chiavi API](/docs/backend/api-keys).
Non saltare [Regole di sicurezza (RLS)](/docs/collections/security-rules);
il secondo livello di controllo è efficace solo quanto le policy che hai scritto.

:::caution[Il server MCP non utilizza di default una chiave con scope limitati]
Il modello a due livelli descritto sopra riguarda il funzionamento di una chiave API. **Non** è ciò che
`@rebasepro/mcp` utilizza, a meno che non venga configurato appositamente. Se non configurato diversamente, il server MCP
si autentica con la **service key** del tuo dev server — una credenziale amministrativa senza restrizioni di scope
che soddisfa le policy di amministrazione predefinite su ogni tabella. Consulta
[Cosa può raggiungere il server MCP](/docs/ai/mcp#what-the-server-can-reach)
prima di puntare un assistente verso qualsiasi elemento a cui tieni.
:::

## Ricerca vettoriale

Rebase offre un tipo di proprietà nativo `vector` su Postgres e un
metodo di query `.vectorSearch()` con distanze `cosine`, `l2` e `inner_product`.
È già documentato, in due sezioni distinte:

- [Interrogazione dei dati → Ricerca vettoriale](/docs/sdk/aggregates-and-search#vector-search) — il metodo
  SDK, il campo `_distance` che viene aggiunto a ogni riga e i relativi avvertimenti
- [API REST → Ricerca vettoriale](/docs/backend/api#vector-search) — i parametri di
  query `vector_search`, `vector`, `vector_distance` e `vector_threshold`

Tre aspetti fondamentali da sapere prima di iniziare a progettarne l'integrazione. **Rebase archivia ed effettua ricerche
sugli embedding; non li calcola** — non è presente alcun provider di embedding, impostazione di modello
o chiave API all'interno di Rebase, pertanto la generazione dei vettori è a tuo carico.
**pgvector è un prerequisito e la sua installazione è facoltativa.**
`database({ extensions: ["vector"] })` in `backend/resources.ts` consente a `rebase db
push` e alla procedura di verifica dello schema all'avvio di eseguire `CREATE EXTENSION IF NOT EXISTS vector` al
posto tuo; in caso contrario, creeranno la colonna lasciando l'installazione dell'estensione a tuo carico. In entrambi i casi,
il server necessita di un'immagine che includa la libreria e di un ruolo autorizzato a installarla.
Inoltre, **ogni colonna vettoriale riceve un indice HNSW per
la distanza coseno**, poiché il coseno è ciò che `vectorSearch` misura a meno che
non venga passato `distance` — un indice supporta esattamente un operatore. Configuralo o
disabilitalo sulla proprietà: vedi [L'indice](/docs/sdk/aggregates-and-search#the-index).

Inoltre, non è possibile sottoscriversi alle query vettoriali; `.vectorSearch(...).listen()` viene
rifiutata con `VECTOR_SEARCH_NOT_LIVE`.

Per la ricerca lessicale — full-text con ranking sui campi specificati, inclusi contenuti JSONB
e array — consulta [Ricerca](/docs/backend/search). Si tratta di un meccanismo differente
e i due non interagiscono tra loro.

## Passaggi successivi

- [Connettore Rebase](/docs/ai/rebase-connector) — Claude, connesso a ogni progetto che esegui
- [Server MCP](/docs/ai/mcp) — connetti Claude Code, Cursor o qualsiasi client MCP
- [Skill per agenti](/docs/ai/skills) — `rebase skills install` e le 24 skill
- [File di istruzioni AI](/docs/ai/instruction-files) — il pattern delle regole con scaffolding
