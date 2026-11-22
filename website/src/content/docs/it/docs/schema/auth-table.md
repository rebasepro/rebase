---
sourceHash: e934bb43a5bf4916
title: La tabella utenti
sidebar_label: Tabella utenti
description: "defineAuthTable dichiara la tabella in cui auth memorizza gli utenti: le colonne necessarie ad auth, un criterio di auto-lettura, colonne di privilegio per soli amministratori e il modello di accesso — ruoli, ambiti dell'app, chiavi personali e hook del ciclo di vita dell'utente."
---

`defineAuthTable` dichiara la tabella che l'autenticazione legge e scrive. Si
tratta di una `defineTable` con tre elementi aggiunti:

- **Le colonne necessarie ad auth** vengono aggiunte quando la tabella non le dichiara:
  l'email, l'hash della password, la colonna `roles`, lo stato di verifica e
  gli altri campi utilizzati per l'accesso.
- **I criteri su cui auth si basa** vengono aggiunti indipendentemente da quanto specificato in `rls`:
  un utente autenticato legge la propria riga e solo un amministratore può scrivere nelle
  colonne dei privilegi, impedendo a chiunque di assegnarsi un ruolo.
- **Un blocco `auth`** dichiara il modello di accesso e gli hook eseguiti quando
  un amministratore crea un utente o reimposta una password.

```ts
// backend/schema/users.ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        email:       col.text().notNull().unique(),
        displayName: col.text(),
        roles:       col.text({ enum: ["admin", "editor", "support"] }).array(),
        createdAt:   col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
    },
    rls: [
        // Editors may list users; everyone reads their own row through the injected policy.
        { operation: "select", roles: ["editor"] },
    ],
    auth: {
        roles: {
            support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] },
        },
        personalKeys: true,
    },
});
```

Un progetto può avere al massimo una tabella degli utenti. Una seconda `defineAuthTable`
viene rifiutata durante la compilazione dello schema; in tal caso, utilizza `defineTable`.

`rls` è obbligatorio qui come in ogni tabella. L'auto-lettura inserita e il controllo
di scrittura per gli amministratori vengono aggiunti accanto alle tue regole, quindi
`"admin-only"` è un'impostazione valida: gli amministratori gestiscono gli utenti e
ciascun utente può comunque leggere la propria riga.

## Le colonne

Dichiara le colonne che la tua applicazione legge o visualizza, con i modificatori desiderati;
auth aggiunge quelle necessarie che sono state omesse. Una colonna dichiarata avente
la chiave o il nome SQL di una colonna di auth (`email`, `displayName`, `roles`,
`passwordHash`, `emailVerified`, `createdAt`, …) coincide con tale colonna.

I segreti del server non lasciano mai il server: l'hash della password e il
token di verifica sono privati indipendentemente dalla dichiarazione, pertanto una
lettura non li restituisce mai e una scrittura dal client non può impostarli.

Un utente possiede un ruolo quando la sua colonna `roles` lo elenca. Dichiarare la colonna
come `col.text({ enum: [...] }).array()` la vincola ai soli ruoli specificati;
ometterla la mantiene aperta, poiché un ruolo esiste non appena viene assegnato a un utente.

Le regole sulle altre tabelle possono fare riferimento alle colonne della tabella degli utenti
come di consueto. Anche una regola definita sulla tabella degli utenti stessa può fare
riferimento a ciascuna colonna di auth, dichiarata o meno.

## Senza una tabella utenti

<span class="since-badge" data-since="0.35">A partire da 0.35</span>

Dichiararne una è facoltativo. Auth funziona in entrambi i casi: in assenza di `defineAuthTable`,
mantiene i suoi utenti in `rebase.users`, mentre account e ruoli vengono gestiti
nella sezione **Users & Roles** dello Studio. L'interfaccia di amministrazione mostra Users
come tabella solo se il progetto ne dichiara una, quindi omettere il file impedisce che compaia nell'admin.

Per dichiararla, parti dal file `backend/schema/users.ts` dello scaffold oppure esegui
`rebase schema introspect --users` su un database che contiene già
`rebase.users`. Entrambi corrispondono alla tabella creata da auth (una chiave `text` e
tutte le colonne di auth), quindi `db push` non vi apporta modifiche e una migrazione
generata con `db generate` la crea con `IF NOT EXISTS`. Dopodiché, puoi aggiungere le tue colonne personalizzate.

## Il blocco `auth`

| Chiave | Cosa fa |
|---|---|
| `roles` | I ruoli che un utente può ricoprire, ciascuno con un `name`, una `description` facoltativa e gli `scopes` del piano di amministrazione e dell'applicazione che concede. `admin` è predefinito e non può essere dichiarato. |
| `scopes` | Gli ambiti propri dell'applicazione, indicati per nome `resource:action`, ciascuno con una `label`, una `description` facoltativa e un `target` facoltativo. |
| `personalKeys` | Se impostato su `true`, consente a ciascun utente di creare [chiavi API personali](/docs/backend/api-keys/#personal-keys). |
| `onCreateUser` | Viene eseguito quando un amministratore crea un utente tramite l'API: restituisce i valori da memorizzare e, facoltativamente, una password temporanea da mostrare all'amministratore. |
| `onResetPassword` | Viene eseguito quando un amministratore reimposta la password di un utente: restituisce una password temporanea oppure invia il proprio link di reimpostazione. |

`roles`, `scopes` e `personalKeys` vengono forniti insieme al descrittore della tabella.
I due hook rimangono sul server; il descrittore indica solo quali di essi esistono. [Ruoli e ambiti](/docs/backend/roles-and-scopes/)
descrive ciò che ciascun ambito concede e in che modo chiavi e token lo limitano.

### `onCreateUser` e `onResetPassword`

```ts
import { randomBytes } from "node:crypto";
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const members = defineAuthTable("members", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
    },
    rls: "admin-only",
    auth: {
        onCreateUser: async (values, ctx) => {
            const temporaryPassword = randomBytes(12).toString("base64url");
            return {
                values: { ...values, passwordHash: await ctx.hashPassword(temporaryPassword), emailVerified: true },
                temporaryPassword,
            };
        },
        onResetPassword: async (_userId, ctx) => {
            if (ctx.emailConfigured && ctx.sendEmail) {
                // Send your own reset link here and return no temporary password.
                return { invitationSent: true };
            }
            return { temporaryPassword: randomBytes(12).toString("base64url"), invitationSent: false };
        },
    },
});
```

Una `temporaryPassword` restituita da `onResetPassword` diventa la password dell'account:
Rebase ne calcola l'hash, la salva, disconnette l'utente da tutte le sessioni e
la mostra all'amministratore affinché la trasmetta. Non restituire alcun valore se
l'hook invia un proprio link di reimpostazione; in tal caso la password rimane invariata
finché l'utente non ne imposta una nuova, e le sessioni vengono comunque terminate.

Entrambi gli hook ricevono un contesto contenente:

- `hashPassword(password)`: calcola l'hash con l'algoritmo configurato;
- `sendEmail(options)`: invia un'email, presente solo se l'email è configurata.
  Si risolve con quanto riportato dal provider (`messageId`, `accepted`,
  `rejected`);
- `emailConfigured`, `appName` e `resetPasswordUrl`.

## Cosa non viene eseguito per le scritture di auth

La registrazione, l'accesso tramite OAuth e la gestione degli utenti da parte dell'amministratore
scrivono direttamente nella tabella degli utenti. Gli [hook](/docs/collections/callbacks/) della tabella
non vengono eseguiti per queste scritture, quindi un'email di benvenuto in `afterSave` non verrà
mai attivata al momento dell'iscrizione. Inseriscila negli hook del ciclo di vita di auth (`beforeUserCreate`,
`afterUserCreate`, `afterUserDelete`, …) configurati nel backend. Consulta [Autenticazione](/docs/backend/authentication/).

## Passaggi successivi

- [Autenticazione](/docs/backend/authentication/): metodi di accesso, token e hook di auth
- [Ruoli e ambiti](/docs/backend/roles-and-scopes/): dichiarazione dei ruoli e degli ambiti dell'applicazione
- [Sicurezza a livello di riga (RLS)](/docs/collections/security-rules/): i criteri che si affiancano a quelli inseriti automaticamente
