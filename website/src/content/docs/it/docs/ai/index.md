---
sourceHash: f0b5790a3df6501a
title: IA e agenti
sidebar_label: Panoramica
description: Cosa offre Rebase per gli assistenti di programmazione IA e gli agenti autonomi — un server MCP, skill per agenti locali al progetto, file di istruzioni scaffoldati e il modello di credenziali che stabilisce cosa un agente può effettivamente raggiungere.
---

Rebase fornisce quattro componenti distinti per gli assistenti IA, e ciascuno risolve
problemi diversi. Vale la pena sapere a quale ci si sta affidando:

| | Cos'è | Chi lo utilizza |
|---|---|---|
| [**Server MCP**](/docs/ai/mcp) | Un server stdio Model Context Protocol con 53 strumenti relativi a schema, dati, utenti, storage, cron, dev server e progetto Rebase Cloud | Un assistente, a runtime |
| [**Skill per agenti**](/docs/ai/skills) | 23 file di skill Markdown scritti nel tuo repository da `rebase skills install` | Un assistente, come materiale di riferimento |
| [**File di istruzioni**](/docs/ai/instruction-files) | `ai-instructions.md` più file puntatore per ciascun assistente, scritti da `rebase init` | Un assistente, come regole sempre attive |
| [**Chiavi API**](/docs/backend/api-keys) | Credenziali macchina che contengono [scope](/docs/backend/roles-and-scopes), per collection e per operazione | Qualsiasi client che chiami l'API HTTP |

I primi tre servono a fornire a un assistente *conoscenza* e *strumenti*. Il
quarto è l'unico che stabilisce cosa possa effettivamente fare.

## La parte che conta: cosa può toccare un agente

Un agente dotato di strumenti sul tuo database è un normale chiamante API che
semplicemente decide in autonomia la sua prossima richiesta. Rebase non cerca di
limitarlo tramite istruzioni: un prompt non è un meccanismo di controllo degli accessi,
e un agente che legge le tue righe sta leggendo testo che qualcun altro potrebbe aver scritto.
Il vincolo deve risiedere al di sotto dell'agente, nelle credenziali che possiede.

Rebase impone a tale credenziale due controlli indipendenti:

1. **Gli scope della chiave.** Dichiarati per operazione *e*, se desiderato, per
   collection: `data:read:articles`, `data:write:articles`. `data:delete` è
   separato da `data:write`, che di solito è quello che si vuole negare
   a un agente a cui è altrimenti consentito modificare.
2. **Row-Level Security.** Le chiavi API non ignorano la RLS. Una chiave si connette come
   ruolo Postgres `rebase_user` come qualsiasi altro chiamante, quindi le tue policy
   stabiliscono comunque quali righe vengono restituite.

Entrambi devono autorizzare la richiesta. Nessuno dei due sostituisce l'altro, ed il secondo
è il motivo per cui una chiave che possiede `data:read` su ogni collection può comunque restituire
un set di risultati vuoto.

Un punto che trae spesso in inganno: l'impostazione `access: "public"` di una collection amplia **quali
righe un chiamante può vedere**, non **chi può effettuare chiamate**. È una dichiarazione sulla
visibilità delle righe, non sull'autenticazione. Concederla non assegna uno scope a una chiave,
e negarla non ne revoca uno.

Il funzionamento pratico — creazione delle chiavi, scelta degli scope, rotazione, scadenza, rate
limit — è trattato in [Chiavi API](/docs/backend/api-keys).
Non tralasciare le [Regole di sicurezza (RLS)](/docs/collections/security-rules);
il secondo controllo è efficace solo quanto le policy che hai scritto.

:::caution[Il server MCP non utilizza di default una chiave con scope limitati]
Il modello a due controlli descritto sopra illustra il funzionamento di una chiave API. **Non** è ciò che
`@rebasepro/mcp` utilizza a meno che non venga configurato esplicitamente. Se lasciato invariato, il server MCP
si autentica con la **service key** del tuo dev server: una credenziale di amministrazione senza restrizioni di scope
che soddisfa le policy admin predefinite su ogni collection. Consulta
[Cosa può raggiungere il server MCP](/docs/ai/mcp#what-the-server-can-reach)
prima di indirizzare un assistente verso risorse o dati importanti.
:::

## Ricerca vettoriale

Rebase offre un tipo di proprietà `vector` nativo su Postgres e un
metodo di query `.vectorSearch()` con distanze `cosine`, `l2` e `inner_product`.
È già documentato, in due sezioni distinte:

- [Interrogazione dei dati → Ricerca vettoriale](/docs/sdk/aggregates-and-search#vector-search) — il metodo
  dell'SDK, il campo `_distance` che aggiunge a ogni riga e i dettagli da considerare
- [API REST → Ricerca vettoriale](/docs/backend/api#vector-search) — i
  parametri di query `vector_search`, `vector`, `vector_distance` e `vector_threshold`

Tre aspetti da conoscere prima di progettare la propria architettura. **Rebase memorizza e cerca
gli embedding; non li calcola** — non esiste alcun provider di embedding,
impostazione del modello o chiave API all'interno di Rebase, pertanto la generazione dei vettori è a tuo carico.
**pgvector è un prerequisito e l'installazione è opt-in.**
`database({ extensions: ["vector"] })` in `config/resources.ts` consente a `rebase db
push` e alla verifica dello schema all'avvio di eseguire `CREATE EXTENSION IF NOT EXISTS vector` per
te; in caso contrario, creeranno la colonna lasciando la gestione dell'estensione a te. In entrambi
i casi, il server necessita di un'immagine contenente la libreria e di un ruolo autorizzato a installarla.
Inoltre, **ogni colonna vettoriale riceve un indice HNSW per
la distanza del coseno**, poiché il coseno è l'unità di misura predefinita di `vectorSearch` a meno che
non si specifichi `distance` — un indice serve esattamente un singolo operatore. Puoi configurarlo, o disattivarlo,
sulla proprietà: consulta [L'indice](/docs/sdk/aggregates-and-search#the-index).

Non è inoltre possibile effettuare sottoscrizioni in tempo reale a query vettoriali; `.vectorSearch(...).listen()`
viene rifiutato con l'errore `VECTOR_SEARCH_NOT_LIVE`.

Per la ricerca lessicale — full-text con ranking sui campi specificati, inclusi i contenuti JSONB
e array — consulta [Ricerca](/docs/backend/search). Si tratta di un meccanismo
differente e i due non interagiscono.

## Passaggi successivi

- [Server MCP](/docs/ai/mcp) — connetti Claude Code, Cursor o qualsiasi client MCP
- [Skill per agenti](/docs/ai/skills) — `rebase skills install` e le 23 skill
- [File di istruzioni IA](/docs/ai/instruction-files) — il pattern delle regole scaffoldate
