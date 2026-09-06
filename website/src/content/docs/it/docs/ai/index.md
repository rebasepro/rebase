---
sourceHash: 29c1bcc39a3460e5
title: IA & Agenti
sidebar_label: Panoramica
description: Cosa offre Rebase per gli assistenti di programmazione AI e gli agenti autonomi — un server MCP, skill per agenti a livello di progetto, file di istruzioni generati e il modello di credenziali che stabilisce a cosa un agente può effettivamente accedere.
---

Rebase include quattro elementi distinti per gli assistenti IA, ciascuno pensato per risolvere un problema diverso. È utile sapere a quale fare riferimento in base alle proprie esigenze:

| | Cos'è | Chi lo usa |
|---|---|---|
| [**Server MCP**](/docs/ai/mcp) | Un server Model Context Protocol stdio con 40 tool su schema, dati, utenti, storage, cron e dev server | Un assistente, a runtime |
| [**Agent skill**](/docs/ai/skills) | 20 file di skill in formato Markdown scritti nel tuo repository da `rebase skills install` | Un assistente, come materiale di riferimento |
| [**File di istruzioni**](/docs/ai/instruction-files) | `ai-instructions.md` insieme ai file puntatore specifici per assistente, creati da `rebase init` | Un assistente, come regole sempre attive |
| [**Chiavi API**](/docs/backend/api#api-keys) | Credenziali macchina con permessi specifici (scoped), per collezione e per operazione | Qualsiasi client che effettua chiamate alle API HTTP |

I primi tre servono a fornire a un assistente *conoscenza* e *strumenti*. Il
quarto è l'unico che decide cosa può effettivamente fare.

## Il punto fondamentale: a cosa può accedere un agente

Un agente dotato di tool sul tuo database è un normale client API che si trova semplicemente a decidere autonomamente la sua richiesta successiva. Rebase non cerca di limitarlo tramite istruzioni di testo — un prompt non è un meccanismo di controllo degli accessi, e un agente che legge le tue righe sta leggendo testo che qualcun altro potrebbe aver scritto. Il vincolo deve risiedere a un livello inferiore rispetto all'agente, ovvero nelle credenziali che possiede.

Rebase applica a queste credenziali due livelli di controllo indipendenti:

1. **L'elenco dei permessi della chiave API.** Dichiarato per collezione *e* per operazione,
   in cui `delete` è separabile da `write` — che di solito è il permesso che si desidera
   negare a un agente a cui è invece consentito modificare i dati.
2. **Row-Level Security (RLS).** Le chiavi API non ignorano la RLS. Una chiave si connette con il
   ruolo Postgres `rebase_user` come qualsiasi altro chiamante, quindi le tue policy continuano a
   determinare quali righe vengono restituite.

Entrambi i controlli devono autorizzare la richiesta. Nessuno dei due sostituisce l'altro, ed è proprio il secondo il motivo per cui una chiave con permessi `"*"` può comunque restituire un set di risultati vuoto.

Un dettaglio che spesso trae in inganno: l'impostazione `access: "public"` di una collezione estende **quali righe un chiamante può vedere**, non **chi può effettuare la chiamata**. È una dichiarazione sulla visibilità delle righe, non sull'autenticazione. Concederla non aggiunge un chiamante all'elenco dei permessi, e revocarla non gli impedisce di effettuare chiamate.

I dettagli tecnici — creazione delle chiavi, JSON dei permessi, rotazione, scadenza, rate limit — sono trattati in [REST API → API Key](/docs/backend/api#api-keys).
Non tralasciare [Security Rules (RLS)](/docs/collections/security-rules); il secondo livello di controllo è efficace solo quanto le policy che hai definito.

:::caution[Il server MCP non utilizza di default una chiave con permessi limitati]
Il modello a due livelli descritto sopra si applica all'uso di una chiave API. **Non** è ciò che
`@rebasepro/mcp` utilizza per impostazione predefinita, a meno che non venga configurato esplicitamente. Se lasciato invariato, il server MCP si autentica con la **service key** del tuo server di sviluppo — una credenziale di amministrazione senza restrizioni che soddisfa le policy admin predefinite su ogni collezione. Consulta [A cosa può accedere il server MCP](/docs/ai/mcp#what-the-server-can-reach) prima di connettere un assistente a risorse critiche.
:::

## Ricerca vettoriale

Rebase offre un tipo di proprietà nativo `vector` su Postgres e un metodo di query `.vectorSearch()` con supporto per le distanze `cosine`, `l2` e `inner_product`.
La funzionalità è già documentata in due sezioni distinte:

- [Interrogare i dati → Ricerca vettoriale](/docs/sdk/querying#vector-search) — il metodo SDK, il campo `_distance` che viene aggiunto a ogni riga e le avvertenze
- [REST API → Ricerca vettoriale](/docs/backend/api#vector-search) — i parametri di query `vector_search`, `vector`, `vector_distance` e `vector_threshold`

Tre aspetti fondamentali da considerare prima della progettazione: **Rebase archivia ed esegue ricerche sugli embedding, ma non li calcola** — non è presente alcun provider di embedding, impostazione di modello o chiave API all'interno di Rebase, quindi la generazione dei vettori è a tuo carico. **pgvector è un prerequisito, e la sua installazione va richiesta esplicitamente.** `database({ extensions: ["vector"] })` in `config/resources.ts` consente a `rebase db push` e alla verifica dello schema all'avvio di eseguire `CREATE EXTENSION IF NOT EXISTS vector`; senza quella riga creano la colonna e lasciano l'estensione a te. In entrambi i casi il server richiede un'immagine che porti la libreria e un ruolo autorizzato a installarla. Inoltre, **ogni colonna vettoriale riceve un indice HNSW per la distanza coseno**, perché è con il coseno che `vectorSearch` misura se non passi `distance`: un indice serve esattamente un operatore. Puoi regolarlo, o disattivarlo, sulla proprietà: vedi [L'indice](/docs/sdk/querying#the-index).

Non è inoltre possibile sottoscrivere query vettoriali in tempo reale; `.vectorSearch(...).listen()` viene rifiutato con l'errore `VECTOR_SEARCH_NOT_LIVE`.

Per la ricerca lessicale — ricerca full-text con ranking sui campi specificati, inclusi contenuti JSONB e array — consulta [Ricerca](/docs/backend/search). Si tratta di un meccanismo differente e i due non interagiscono tra loro.

## Dove proseguire

- [Server MCP](/docs/ai/mcp) — connetti Claude Code, Cursor o qualsiasi client MCP
- [Agent Skill](/docs/ai/skills) — `rebase skills install` e le 21 skill disponibili
- [File di istruzioni IA](/docs/ai/instruction-files) — il pattern per le regole generate automaticamente

---
