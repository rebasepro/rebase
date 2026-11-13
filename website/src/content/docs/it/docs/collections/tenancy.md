---
sourceHash: 9338d2b094861fba
title: Tenancy
sidebar_label: Tenancy
description: Limita ogni riga di una tabella a un sito, a un'organizzazione o a un workspace con una sola dichiarazione di tenant, applicata tramite la row-level security di Postgres.
---

## Cosa fa

<span class="since-badge" data-since="0.31">Da 0.31</span>

`tenant` su una tabella indica il nome della colonna che contiene il tenant a
cui appartiene una riga (un sito, un'organizzazione, un workspace) e specifica da dove proviene
il tenant del chiamante. Da questa singola dichiarazione Rebase genera:

- **Una policy RLS restrittiva**, `<table>_tenant_scope`. Le policy restrittive
  vengono combinate tramite AND con ogni altra policy sulla tabella, quindi la tenancy restringe ciò
  che la `rls` della tabella consente e non lo amplia mai. Una regola
  `access: "public"` altrove nel file non può rimuovere questo confine.
- **Una colonna `NOT NULL` indicizzata.** Una riga senza tenant non apparterrebbe a nessuno,
  e una colonna tenant non indicizzata trasformerebbe ogni lettura in una scansione sequenziale.
- **Il tenant durante le scritture.** Un'operazione di creazione che lascia il campo vuoto riceve
  il tenant del chiamante quando quest'ultimo ne ha esattamente uno. Qualsiasi valore ambiguo o estraneo viene
  rifiutato (vedi [Scritture](#scritture)).
- **Un trigger che mantiene le righe nel loro tenant.** Un aggiornamento che sposta una riga in
  un altro tenant viene rifiutato, sia nell'API sia in SQL eseguito come chiamante.

Poiché è Postgres ad applicarlo, il pannello di amministrazione, l'API REST, l'SDK e l'SQL
eseguito come chiamante vedono tutti le stesse righe.

## Un tenant per utente: un claim

<span class="since-badge" data-since="0.31">Da 0.31</span>

Quando ciascun utente appartiene esattamente a un tenant, inseriscilo nel suo token di sessione
e indica il nome del claim:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        siteId: col.uuid().notNull(),
        title:  col.text().notNull(),
    },
    tenant: { field: "siteId", from: { claim: "site_id" } },
    rls: [{ operation: "all", access: "authenticated" }],
});
```

La policy confronta il campo `site_id` della riga con il claim `site_id`, convertito nel
tipo della colonna. Il
claim proviene dal tuo identity provider, oppure dall'hook di autenticazione
`customizeAccessToken` (`auth.hooks`, vedi [Autenticazione](/docs/backend/authentication/);
il runtime gestito non ha route per gli hook, quindi questo richiede un backend espulso).
I claim riservati come `uid`, `roles` e `aal` non possono indicare un tenant: vengono
scritti dopo i custom claim, quindi un hook non può asserirli, e una configurazione
che ne indica uno viene rifiutata.

## Diversi tenant per utente: una tabella di appartenenza

<span class="since-badge" data-since="0.31">Da 0.31</span>

Quando le persone lavorano su più tenant (un editor su due siti, un consulente in tre
organizzazioni), mantieni le appartenenze in una tabella dedicata:

```ts
// backend/schema/site-members.ts
import { defineTable, col } from "@rebasepro/server/schema";

// One row per person per site they work on.
export const siteMembers = defineTable("site_members", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        userId: col.uuid().notNull(),
        siteId: col.uuid().notNull(),
    },
    // Members read their own rows. Required: the tenancy policy reads this
    // table as the caller, so without it nobody but an admin sees a post.
    rls: [{ operation: "select", ownerField: "userId" }],
});
```

```ts
// backend/schema/posts.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        siteId: col.uuid().notNull(),
        title:  col.text().notNull(),
    },
    tenant: {
        field: "siteId",
        from: { membership: { table: "site_members", userField: "userId", tenantField: "siteId" } },
    },
    rls: [{ operation: "all", access: "authenticated" }],
});
```

`membership.table` è lo slug della tabella di appartenenza; `userField` e
`tenantField` sono chiavi di colonna al suo interno.

La policy è un `EXISTS` correlato su `site_members`: "il chiamante è
membro del sito di questa riga?", risposta fornita nella stessa query. Nulla viene inserito nel
token, quindi l'aggiunta o la rimozione di un'appartenenza ha effetto sull'istruzione successiva,
senza necessità di effettuare nuovamente l'accesso.

La tabella di appartenenza deve consentire ai chiamanti di leggere le proprie righe, poiché una
policy viene valutata come l'utente che effettua la query e la RLS della tabella di appartenenza
si applica al suo interno. Boot rifiuta una configurazione in cui ciò non avviene, e l'errore indica
la regola da aggiungere. Boot rifiuta inoltre una tabella di appartenenza che non esiste, è priva di una
delle colonne indicate, oppure non è memorizzata nello stesso database Postgres.

## A chi non si applica

`bypassRoles` elenca i ruoli che possono leggere e scrivere su ogni tenant. Il valore
predefinito è `["admin"]`, in modo che il pannello di amministrazione non mostri una tabella vuota a un admin.
Un array vuoto indica che nessun ruolo ne effettua il bypass; il contesto attendibile del server
stesso (migrazioni, flussi di autenticazione) lo bypassa comunque.

```typescript
tenant: { field: "siteId", from: { claim: "site_id" }, bypassRoles: ["admin", "support"] }
```

## Scritture

Ogni rifiuto è un errore `400` che indica il campo, prima ancora di interrogare il database:

| Codice | Quando |
|---|---|
| `TENANT_REQUIRED` | Una creazione ha lasciato il campo vuoto e il chiamante non ha alcun tenant, oppure appartiene a più tenant. Invia il tenant nella scrittura |
| `TENANT_MISMATCH` | La scrittura indica un tenant a cui il chiamante non appartiene |
| `TENANT_IMMUTABLE` | Un aggiornamento sposterebbe la riga in un altro tenant. Creala nell'altro tenant ed elimina questa, oppure esegui l'operazione con un ruolo in `bypassRoles` |

L'SQL eseguito come chiamante riceve le stesse risposte da Postgres: il `WITH CHECK`
della policy rifiuta un tenant estraneo, e un trigger `BEFORE UPDATE` rifiuta uno
spostamento (`42501`). Un chiamante con un ruolo di bypass è esente da tutti e tre i controlli.

## Il campo

<span class="since-badge" data-since="0.31">Da 0.31</span>

- Una colonna di tipo text, `uuid`, enum o integer (anche `numeric`), o una relazione
  `belongsTo` verso la tabella dei tenant. Per una relazione, la colonna di foreign-key è
  il campo; non ne viene creata una seconda.
- Deve essere dichiarato sulla tabella e leggibile: lo schema viene rifiutato se il
  campo è mancante, di un altro tipo o limitato da `.private()` o
  `.access({ read })`. I tipi verificano che il campo indichi una colonna valida.
- La colonna viene impostata su `NOT NULL`, indipendentemente da come era stata dichiarata, e indicizzata.
- Non su una view: è la row-level security a renderlo effettivo.

## Cosa non copre

- **File.** Gli upload non sono righe. Limitali in base al percorso con
  l'[autorizzazione dello storage](/docs/backend/storage-authorization/), ad esempio una
  cartella per sito.
- **Navigazione.** Le tabelle vengono mostrate o nascoste nel CMS per ruolo, non per
  tenant. Un membro di un sito vede le stesse tabelle di chiunque altro, contenenti
  solo le righe del proprio sito.
- **Infrastruttura separata.** Tutti i tenant condividono un solo database e un solo server.
  Laddove i tenant non debbano condividere alcuna infrastruttura, assegna a ciascuno
  il proprio deployment.

## Correlati

- [Row-level security](/docs/collections/security-rules/): le regole a cui la tenancy viene combinata tramite AND
- [Accesso ai campi](/docs/collections/field-access/): permessi di lettura e scrittura per campo
- [Autorizzazione dello storage](/docs/backend/storage-authorization/): chi legge e scrive quali file
