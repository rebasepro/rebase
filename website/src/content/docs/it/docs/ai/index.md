---
sourceHash: ec9977f5b00dc133
title: AI e agenti
sidebar_label: Panoramica
description: Cosa offre Rebase per gli assistenti di programmazione IA e gli agenti autonomi — un server MCP, skill per agenti locali al progetto, file di istruzioni generati e il modello di credenziali che determina a cosa un agente può effettivamente accedere.
---

Rebase fornisce quattro elementi distinti per gli assistenti IA, e ciascuno risolve problemi diversi. Vale la pena sapere a quale ci si sta rivolgendo:

| | Cos'è | Chi lo utilizza |
|---|---|---|
| [**Server MCP**](/docs/ai/mcp) | Un server stdio Model Context Protocol con 42 strumenti per schema, dati, utenti, storage, cron e dev server | Un assistente, a runtime |
| [**Skill per agenti**](/docs/ai/skills) | 21 file di skill in Markdown inseriti nella tua repo da `rebase skills install` | Un assistente, come materiale di riferimento |
| [**File di istruzioni**](/docs/ai/instruction-files) | `ai-instructions.md` più file puntatore specifici per assistente, creati da `rebase init` | Un assistente, come regole sempre attive |
| [**Chiavi API**](/docs/backend/api-keys) | Credenziali macchina con ambito limitato (scoped), per collezione e per operazione | Qualsiasi client che chiami l'API HTTP |

I primi tre servono a fornire a un assistente *conoscenza* e *strumenti*. Il quarto è l'unico che decide cosa esso possa effettivamente fare.

## La parte fondamentale: cosa può toccare un agente

Un agente dotato di strumenti sul tuo database è un normale client API che si dà il caso decida la propria richiesta successiva. Rebase non cerca di vincolarlo con le istruzioni: un prompt non è un meccanismo di controllo degli accessi, e un agente che legge le tue righe sta leggendo testo che qualcun altro potrebbe aver scritto. Il vincolo deve risiedere al di sotto dell'agente, nelle credenziali che possiede.

Rebase fornisce a tale credenziale due gate indipendenti:

1. **L'elenco dei permessi della chiave API.** Dichiarato per collezione *e* per operazione, dove `delete` è separabile da `write` — che è solitamente il permesso che si vuole negare a un agente a cui è altrimenti consentito modificare.
2. **Row-Level Security (RLS).** Le chiavi API non ignorano l'RLS. Una chiave si connette come ruolo Postgres `rebase_user` come qualsiasi altro chiamante, quindi i criteri stabiliti (policy) determinano comunque quali righe vengono restituite.

Entrambi devono autorizzare la richiesta. Nessuno dei due sostituisce l'altro, e il secondo è il motivo per cui una chiave con permessi `"*"` può comunque restituire un set di risultati vuoto.

Un punto che spesso trae in inganno: l'impostazione `access: "public"` di una collezione estende **quali righe un chiamante può vedere**, non **chi può effettuare chiamate**. È una dichiarazione sulla visibilità delle righe, non sull'autenticazione. Concederla non aggiunge un chiamante all'elenco dei permessi, e revocarla non ne blocca uno.

Il funzionamento pratico — creazione delle chiavi, JSON dei permessi, rotazione, scadenza, rate limit — è trattato in [API REST → Chiavi API](/docs/backend/api-keys). Non tralasciare [Regole di sicurezza (RLS)](/docs/collections/security-rules); il secondo gate è efficace solo quanto le policy che hai scritto.

:::caution[Il server MCP non utilizza di default una chiave con ambito limitato]
Il modello a due gate descritto sopra spiega il funzionamento di una chiave API. **Non** è ciò che `@rebasepro/mcp` usa, a meno che non venga configurato per farlo. Per impostazione predefinita, il server MCP si autentica con la **service key** del tuo dev server — una credenziale di amministrazione senza restrizioni che soddisfa le policy admin predefinite su ogni collezione. Consulta [A cosa può accedere il server MCP](/docs/ai/mcp#what-the-server-can-reach) prima di puntare un assistente verso qualcosa a cui tieni.
:::

## Ricerca vettoriale

Rebase include un tipo di proprietà `vector` di prima classe su Postgres e un metodo di query `.vectorSearch()` con distanza `cosine`, `l2` e `inner_product`. È già documentato, in due punti diversi:

- [Interrogazione dei dati → Ricerca vettoriale](/docs/sdk/aggregates-and-search#vector-search) — il metodo dell'SDK, il campo `_distance` aggiunto a ogni riga e le avvertenze
- [API REST → Ricerca vettoriale](/docs/backend/api#vector-search) — i parametri di query `vector_search`, `vector`, `vector_distance` e `vector_threshold`

Tre cose da sapere prima di progettarvi attorno una soluzione. **Rebase memorizza ed esegue ricerche sugli embedding; non li calcola** — non c'è alcun provider di embedding, impostazione di modello o chiave API all'interno di Rebase, quindi generare i vettori è compito tuo. **pgvector è un prerequisito e la sua installazione è facoltativa.** `database({ extensions: ["vector"] })` in `config/resources.ts` consente a `rebase db push` e alla verifica dello schema all'avvio di eseguire `CREATE EXTENSION IF NOT EXISTS vector` per te; in caso contrario, creano la colonna lasciando l'installazione dell'estensione a tuo carico. In entrambi i casi il server necessita di un'immagine che includa la libreria e di un ruolo autorizzato a installarla. Inoltre, **ogni colonna vettoriale riceve un indice HNSW per la distanza del coseno**, poiché il coseno è ciò che `vectorSearch` utilizza come misura predefinita se non viene specificato `distance` — un indice serve esattamente un solo operatore. Modificalo, o disattivalo, sulla proprietà: consulta [L'indice](/docs/sdk/aggregates-and-search#the-index).

Non è inoltre possibile sottoscrivere query vettoriali; `.vectorSearch(...).listen()` viene rifiutato con `VECTOR_SEARCH_NOT_LIVE`.

Per la ricerca lessicale — ricerca full-text con ranking sui campi specificati, inclusi contenuti JSONB e array — consulta [Ricerca](/docs/backend/search). Si tratta di un meccanismo diverso e i due non interagiscono.

## Passaggi successivi

- [Server MCP](/docs/ai/mcp) — connetti Claude Code, Cursor o qualsiasi client MCP
- [Skill per agenti](/docs/ai/skills) — `rebase skills install` e le 21 skill
- [File di istruzioni IA](/docs/ai/instruction-files) — il pattern delle regole generate
