---
sourceHash: c7bebbe33f0a0611
title: La tabella utenti
sidebar_label: Tabella utenti
description: "defineAuthTable dichiara la tabella in cui l'autenticazione memorizza gli utenti: le colonne necessarie all'autenticazione, una policy di auto-lettura, colonne di privilegio solo per amministratori e il modello di accesso — ruoli, scope dell'app, chiavi personali e hook del ciclo di vita dell'utente."
---

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

`defineAuthTable` dichiara la tabella che l'autenticazione legge e scrive. È
una `defineTable` con tre elementi aggiunti:

- **Le colonne necessarie all'autenticazione** vengono aggiunte quando la tabella non le dichiara:
  l'email, l'hash della password, la colonna `roles`, lo stato di verifica e
  gli altri campi utilizzati per l'accesso.
- **Le policy su cui si basa l'autenticazione** vengono aggiunte indipendentemente da quanto specificato in `rls`: un utente
  autenticato legge la propria riga e solo un amministratore può scrivere nelle colonne dei privilegi,
  impedendo a chiunque di assegnarsi un ruolo autonomamente.
- **Un blocco `auth`** dichiara il modello di accesso e gli hook eseguiti quando un
  amministratore crea un utente o reimposta una password.

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

Un progetto può avere al massimo una tabella utenti. Una seconda `defineAuthTable` viene
rifiutata durante la compilazione dello schema; in tal caso, definiscila come `defineTable`.

`rls` è obbligatorio qui come in ogni tabella. La policy di auto-lettura inserita e il
controllo di scrittura per l'amministratore vengono aggiunti insieme alle tue regole, quindi `"admin-only"` è
un'impostazione valida: gli amministratori gestiscono gli utenti e ciascun utente continua a poter leggere la propria riga.

## Le colonne

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Dichiara le colonne che la tua app legge o visualizza, con i modificatori che preferisci;
l'autenticazione aggiunge quelle necessarie che sono state omesse. Una colonna dichiarata con la
chiave o il nome SQL di una colonna di autenticazione (`email`, `displayName`, `roles`, `passwordHash`,
`emailVerified`, `createdAt`, …) corrisponde a quella colonna.

I segreti del server non lasciano mai il server: l'hash della password e il
token di verifica sono privati indipendentemente da quanto indicato nella dichiarazione, quindi una lettura non
li restituirà mai e una scrittura dal client non potrà impostarli.

Un utente possiede un ruolo quando questo è presente nella sua colonna `roles`. Dichiarare la colonna come
`col.text({ enum: [...] }).array()` la vincola ai ruoli specificati;
omettendola rimane aperta, poiché un ruolo esiste non appena viene assegnato a un utente.

Le regole sulle altre tabelle possono fare riferimento alle colonne della tabella utenti come di consueto. Una regola
sulla tabella utenti stessa può anche fare riferimento a qualsiasi colonna di autenticazione, sia essa dichiarata o meno.

## Il blocco `auth`

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

| Chiave | Cosa fa |
|---|---|
| `roles` | I ruoli che un utente può ricoprire, ciascuno con un `name`, una `description` facoltativa e gli `scopes` del piano di amministrazione e dell'app concessi. `admin` è predefinito e non può essere dichiarato. |
| `scopes` | Gli scope specifici dell'app, nel formato `resource:action`, ciascuno con una `label`, una `description` facoltativa e un `target` facoltativo. |
| `personalKeys` | Se impostato su `true`, consente a ciascun utente di creare [chiavi API personali](/docs/backend/api-keys/#personal-keys). |
| `onCreateUser` | Viene eseguito quando un amministratore crea un utente tramite l'API: restituisce i valori da memorizzare e, facoltativamente, una password temporanea da mostrare all'amministratore. |
| `onResetPassword` | Viene eseguito quando un amministratore reimposta la password di un utente: restituisce una password temporanea oppure invia un link di reimpostazione personalizzato. |

`roles`, `scopes` e `personalKeys` vengono forniti insieme al descrittore della tabella.
I due hook rimangono sul server; il descrittore indica solo quali di essi esistono. [Ruoli e scope](/docs/backend/roles-and-scopes/)
illustra ciò che ciascuno scope concede e come chiavi e token lo limitano.

### `onCreateUser` e `onResetPassword`

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

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

La `temporaryPassword` restituita da `onResetPassword` diventa la password
dell'account: Rebase ne calcola l'hash, la salva, disconnette l'utente da tutte le sessioni e
la mostra all'amministratore per poterla comunicare. Non restituire alcun valore se l'hook invia un
proprio link di reimpostazione; in tal caso, la password rimane invariata finché l'utente non ne imposta una nuova e
le sue sessioni vengono comunque terminate.

Entrambi gli hook ricevono un contesto contenente:

- `hashPassword(password)`: calcola l'hash con l'algoritmo configurato;
- `sendEmail(options)`: invia un'e-mail, presente solo quando l'e-mail è configurata.
  Si risolve con quanto segnalato dal provider (`messageId`, `accepted`,
  `rejected`);
- `emailConfigured`, `appName` e `resetPasswordUrl`.

## Cosa non viene eseguito per le scritture di autenticazione

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

La registrazione, l'accesso OAuth e la gestione degli utenti da parte dell'amministratore scrivono
direttamente nella tabella utenti. Gli [hook](/docs/collections/callbacks/) della tabella non vengono eseguiti per queste
scritture, quindi un'e-mail di benvenuto in `afterSave` non verrà mai attivata al momento dell'iscrizione.
Inseriscila negli hook del ciclo di vita dell'autenticazione (`beforeUserCreate`, `afterUserCreate`, `afterUserDelete`,
…) configurati nel backend. Consulta [Autenticazione](/docs/backend/authentication/).

## Passaggi successivi

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

- [Autenticazione](/docs/backend/authentication/): metodi di accesso, token e hook di autenticazione
- [Ruoli e scope](/docs/backend/roles-and-scopes/): dichiarazione di ruoli e scope dell'app
- [Sicurezza a livello di riga (RLS)](/docs/collections/security-rules/): le policy che affiancano quelle inserite automaticamente
