---
title: Regole di Sicurezza (RLS)
sidebar_label: Regole di Sicurezza
description: Definisci le politiche di sicurezza a livello di riga (Row Level Security) per le tue collection usando scorciatoie pratiche o espressioni SQL pure.
---

## Panoramica

Le regole di sicurezza ti consentono di definire le politiche di **Sicurezza a Livello di Riga (RLS)** per le tue tabelle PostgreSQL direttamente nelle definizioni delle tue collection. Quando lo schema Drizzle viene generato, Rebase crea le corrispondenti istruzioni `CREATE POLICY`.

```typescript
const postsCollection: CollectionConfig = {
    slug: "posts",
    table: "posts",
    properties: { /* ... */ },
    securityRules: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], ownerField: "author_id" }
    ]
};
```

## Come Funziona

1. Definisci `securityRules` su una collection
2. `rebase schema generate` crea lo schema Drizzle con RLS abilitato
3. `rebase db push` o `rebase db migrate` applica le politiche a PostgreSQL
4. Ogni query viene filtrata automaticamente in base al contesto dell'utente corrente

L'identità dell'utente autenticato è disponibile in SQL tramite:

| Funzione | Restituisce |
|----------|-------------|
| `auth.uid()` | L'ID dell'utente corrente |
| `auth.roles()` | ID dei ruoli dell'app separati da virgole |
| `auth.jwt()` | Claims JWT complete come JSONB |

Questi vengono impostati automaticamente per transazione dal backend Rebase.

## Scorciatoie Pratiche

### Accesso basato sul Proprietario

Il modello più semplice — gli utenti possono accedere solo alle righe di loro proprietà:

```typescript
securityRules: [
    { operation: "all", ownerField: "user_id" }
]
```

Questo genera: `USING (user_id = auth.uid())`

### Accesso Pubblico

Consenti a chiunque (inclusi gli utenti non autenticati) di leggere:

```typescript
securityRules: [
    { operation: "select", access: "public" }
]
```

Questo genera: `USING (true)`

### Accesso Autenticato

Consenti a qualsiasi utente autenticato:

```typescript
securityRules: [
    { operation: "select", access: "authenticated" }
]
```

### Accesso basato sui Ruoli

Limita le operazioni a ruoli specifici:

```typescript
securityRules: [
    { operation: "all", roles: ["admin"] },
    { operation: "select", roles: ["editor", "viewer"] }
]
```

## Espressioni SQL Pure

Per logiche complesse, usa `using` e `withCheck`:

```typescript
securityRules: [
    {
        operation: "select",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = auth.uid())"
    }
]
```

- **`using`** — Filtra quali righe esistenti sono visibili (si applica a SELECT, UPDATE, DELETE)
- **`withCheck`** — Convalida i nuovi valori delle righe (si applica a INSERT, UPDATE)

I riferimenti alle colonne usano la sintassi `{column_name}` che viene risolta nella colonna completa qualificata per tabella.

## Combinare Scorciatoie e SQL

Combina scorciatoie pratiche con SQL puro:

```typescript
securityRules: [
    // Gli amministratori possono fare qualsiasi cosa
    { operation: "all", roles: ["admin"], using: "true" },
    // Gli utenti regolari possono vedere solo le proprie righe
    { operation: "select", ownerField: "user_id" },
    // Gli utenti possono inserire, ma solo per se stessi
    { operation: "insert", withCheck: "{user_id} = auth.uid()" },
    // Le righe bloccate non possono essere aggiornate
    { operation: "update", mode: "restrictive", using: "{is_locked} = false" }
]
```

## Permissivo vs Restrittivo

PostgreSQL ha due modalità di policy:

- **Permissiva** (predefinita) — Più politiche permissive sono unite da un **OR**. Se una qualsiasi di esse passa, l'accesso è garantito.
- **Restrittiva** — Le politiche restrittive sono unite da un **AND**. Tutte devono passare.

```typescript
securityRules: [
    // Permissiva: i proprietari possono accedere alle proprie righe
    { operation: "all", ownerField: "user_id" },
    // Restrittiva: ma le righe bloccate non possono essere aggiornate
    { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" }
]
```

## Operazioni

| Operazione | Equivalente SQL | Descrizione            |
|------------|-----------------|------------------------|
| `"select"` | `SELECT`        | Leggere righe          |
| `"insert"` | `INSERT`        | Creare nuove righe     |
| `"update"` | `UPDATE`        | Modificare righe esistenti |
| `"delete"` | `DELETE`        | Rimuovere righe        |
| `"all"`    | Tutte le precedenti | Sintassi breve per tutte le operazioni |

Puoi anche usare `operations` (plurale) per applicare una singola regola a più operazioni:

```typescript
{ operations: ["insert", "update", "delete"], ownerField: "author_id" }
```

## Interfaccia Completa di SecurityRule

```typescript
interface SecurityRule {
    name?: string;              // Nome della policy leggibile dall'uomo
    operation?: SecurityOperation;   // Singola operazione
    operations?: SecurityOperation[]; // Operazioni multiple
    mode?: "permissive" | "restrictive"; // Predefinito: "permissive"
    access?: "public" | "authenticated";
    ownerField?: string;        // Colonna contenente l'ID dell'utente proprietario
    roles?: string[];           // Ruoli dell'app a cui si applica questa policy
    using?: string;             // Espressione SQL USING pura
    withCheck?: string;         // Espressione SQL WITH CHECK pura
}
```

## Esempi

### Piattaforma Blog

```typescript
securityRules: [
    // Chiunque può leggere i post pubblicati
    { operation: "select", using: "{status} = 'published'" },
    // Gli autori possono vedere le proprie bozze
    { operation: "select", ownerField: "author_id" },
    // Gli autori possono creare e modificare i propri post
    { operations: ["insert", "update"], ownerField: "author_id" },
    // Solo gli amministratori possono eliminare
    { operation: "delete", roles: ["admin"] }
]
```

### SaaS Multi-Tenant

```typescript
securityRules: [
    {
        operation: "all",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = auth.uid())"
    }
]
```

## Accesso Anonimo (Inserimenti Pubblici)

Un'esigenza comune è consentire agli **utenti non autenticati** di inviare dati — moduli di contatto, iscrizioni a newsletter, applicazioni pubbliche. Rebase fornisce un modello pulito per questo.

### Consigliato: `access: "public"` con `withCheck`

```typescript
const contactMessagesCollection: CollectionConfig = {
    slug: "contact_messages",
    securityRules: [
        // Chiunque può inviare un messaggio di contatto
        {
            operation: "insert",
            access: "public",
            withCheck: "true"
        },
        // Solo gli amministratori possono leggere, aggiornare o eliminare messaggi
        { operations: ["select", "update", "delete"], roles: ["admin"] }
    ],
    properties: { /* ... */ }
};
```

La scorciatoia `access: "public"` genera una policy che consente l'operazione senza richiedere autenticazione.

### Per la Cattura di Lead / Iscrizioni

```typescript
const leadSignupsCollection: CollectionConfig = {
    slug: "lead_magnet_signups",
    securityRules: [
        // Consenti inserimenti anonimi
        { operation: "insert", access: "public", withCheck: "true" },
        // Gli amministratori possono visualizzare tutte le iscrizioni
        { operation: "select", roles: ["admin"] }
    ],
    properties: { /* ... */ }
};
```

### Come Funzionano le Richieste Anonime

Quando una richiesta arriva senza un token JWT, il backend Rebase imposta le variabili di sessione di PostgreSQL a:

| Variabile      | Valore        |
|----------------|---------------|
| `app.user_id`  | `'anonymous'` |
| `app.user_roles` | `''` (vuoto) |

Questo significa:

- `auth.uid()` restituisce `'anonymous'`
- `auth.roles()` restituisce una stringa vuota
- Le politiche `access: "public"` passano perché generano `USING (true)` / `WITH CHECK (true)`
- Le politiche `access: "authenticated"` falliscono perché controllano un ID utente reale
- Le politiche `ownerField` falliscono perché nessuna riga avrà `user_id = 'anonymous'` (a meno che non sia impostato esplicitamente)

### Avanzato: SQL Puro per Anonimi

Se hai bisogno di un controllo più granulare, usa SQL puro:

```typescript
securityRules: [
    {
        operation: "insert",
        withCheck: "auth.uid() = 'anonymous' OR auth.uid() IS NOT NULL"
    }
]
```

:::tip
Evita il pattern legacy di controllare `string_to_array(auth.roles(), ',')` per l'accesso anonimo. La scorciatoia `access: "public"` è più semplice e genera automaticamente la policy corretta.
:::

## Prossimi Passi

- **[Relazioni](/docs/collections/relations)** — Chiavi esterne e join
- **[Callback di Entità](/docs/collections/callbacks)** — Hook del ciclo di vita
- **[Funzioni Personalizzate](/docs/backend/custom-functions)** — Endpoint API personalizzati
