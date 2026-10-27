---
sourceHash: fe474014627c7510
title: Autenticazione e Login
sidebar_label: Autenticazione e Login
description: Configura il controller di autenticazione, la vista di login e la simulazione dei ruoli nel tuo frontend React Rebase.
---

## Panoramica

Rebase fornisce componenti e hook React pronti all'uso per l'autenticazione:

- **`useRebaseAuthController`** — Gestisce lo stato di autenticazione, i token e la persistenza della sessione
- **`LoginView`** — Form predefinito di login/registrazione con supporto OAuth
- **Simulazione dei ruoli** — Testa ruoli diversi senza effettuare il logout

## Auth Controller

L'hook `useRebaseAuthController` è il nucleo dell'autenticazione frontend. Gestisce l'utente corrente, i token e la sessione:

```typescript
import { useRebaseAuthController } from "@rebasepro/app";
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

const authController = useRebaseAuthController({
    client,
    googleClientId: GOOGLE_CLIENT_ID  // Optional — enables Google OAuth
});

// Available properties:
authController.user           // Current user object (or null)
authController.initialLoading // True while checking stored session
authController.signOut()      // Log out
authController.getAuthToken() // Get current JWT for API calls
```

Passa l'`authController` a `<Rebase authController>`. `<RebaseShell>` (o `<RebaseAuthGate>` in un layout manuale) lo legge da lì e protegge l'intero pannello di amministrazione dietro autenticazione.

## Il tuo provider di autenticazione

Su 0.24 il getter
autentica solo le richieste HTTP, e il socket realtime del pannello resta
anonimo.

Se la tua app fa accedere gli utenti con un provider proprio (Clerk, Firebase Auth, una
sessione tua), dai al client che passi a `<Rebase client>` un getter del token. Le
richieste HTTP del pannello e il suo socket realtime inviano entrambi ciò che restituisce,
così le viste live delle collection girano con lo stesso utente:

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

L'`authController` accanto a esso riporta poi l'utente connesso del tuo provider
(un `AuthController` da `@rebasepro/cms-types`) invece di avvolgere `client.auth`. Anche il
backend deve accettare il token: vedi
[Adapter di autenticazione personalizzati](/docs/backend/auth-adapters), e
[Usare il tuo provider di autenticazione](/docs/sdk/authentication#using-your-own-auth-provider)
per il lato client per intero.

## Login View

Il componente `LoginView` fornisce un form completo di login e registrazione:

```tsx
import { LoginView } from "@rebasepro/app";

function App() {
    if (!authController.user) {
        return (
            <LoginView
                authController={authController}
                googleClientId={GOOGLE_CLIENT_ID}
            />
        );
    }
    return <MyApp />;
}
```

La vista di login gestisce:
- Login e registrazione con email/password
- Accesso OAuth con Google, GitHub e LinkedIn (quando configurato)
- Flusso di reimpostazione della password
- Validazione del form e stati di errore

## Modello dei ruoli

I ruoli vengono memorizzati come colonna array `text[]` direttamente nella tabella `rebase.users`. Puoi definire i ruoli disponibili come enum nella definizione della tua collection users:

```typescript title="config/collections/users.ts" no-verify
roles: {
    name: "Roles",
    type: "array",
    columnType: "text[]",
    of: {
        name: "Role",
        type: "string",
        enum: {
            admin: "Admin",
            editor: "Editor",
            viewer: "Viewer"
        }
    },
    admin: {
        readOnly: false
    }
}
```

Per aggiungere o rimuovere opzioni di ruolo, aggiorna la mappa `enum` nella tua collection users e rigenera lo schema.

Un ruolo in questo elenco è un nome a cui le tue [regole di sicurezza](/docs/collections/security-rules) possono corrispondere. Cosa può fare oltre alle sue righe (gestire gli utenti, leggere i log, modificare lo schema) si dichiara separatamente, sotto `auth.roles` nella stessa collection. `admin` è integrato e possiede tutto. Vedi [Ruoli e scope](/docs/backend/roles-and-scopes).

## Testare gli accessi: Simulate access

Per verificare cosa può leggere un ruolo, un utente o una service key, un amministratore usa
**Simulate access**, la pillola sopra il tuo avatar nel drawer del pannello di amministrazione (nella
barra dell'app su uno schermo piccolo, o quando la shell non ha un drawer). Scegli un ruolo
(con un id utente facoltativo, che non deve necessariamente essere un account), un utente, o una
service key attiva.
Ogni vista dei dati, e la scheda History di un record, legge allora attraverso il server come
quell'identità, rispetto alle vere policy di sicurezza a livello di riga: una griglia mostra
esattamente le righe che può leggere,
i campi che i suoi ruoli non possono leggere sono mascherati, e il banner conta le collection
in cui non vede nulla. Il server verifica a ogni richiesta che tu sia un
amministratore.

L'accesso simulato è di sola lettura. Finché è attivo, le viste non offrono creazione, modifica,
eliminazione né ripristino della cronologia, e il server rifiuta qualsiasi scrittura che porti una simulazione con
`403 SIMULATION_READ_ONLY`, così nulla viene salvato come qualcun altro. Interrompi la simulazione
per apportare modifiche.

Ciò che non simula: il gate `requireAuth` dell'API dei dati, che lascia passare un chiamante
anonimo simulato in modo che tu veda cosa gli concedono le policy delle righe
(una funzione personalizzata lo vede come privo di sessione, come un vero chiamante anonimo);
lo storage, i cui file sono letti come te, con i caricamenti disattivati durante la simulazione; e
gli aggiornamenti live, che restano in pausa finché non interrompi.

La stessa cosa da codice, sull'SDK, è `client.simulate()`. Deriva un
client le cui richieste portano la simulazione, e solo la sessione di un amministratore
può usarlo:

```typescript
const asCustomer = client.simulate({ role: "customer", userId: "u_1" });
const { data } = await asCustomer.data.collection("tickets").find();
asCustomer.close();
```

Il client derivato è tipizzato dallo stesso `Database` di quello da cui proviene, ed
è un client a sé: chiudilo con `close()` quando hai finito.

L'interruttore del ruolo effettivo non è un tester RLS: cambia soltanto quali viste di Studio
elenca la navigazione, non invia nulla al server e non valuta alcuna
policy. `useBuildEffectiveRoleController`, che ne costruiva uno, è deprecato e
avvisa una sola volta quando viene chiamato: `<Rebase>` costruisce il proprio controller quando non
ne viene passato uno, e Simulate access è il modo per testare cosa può fare un ruolo.

## Passaggi successivi

- **[Autenticazione Backend](/docs/backend/authentication)** — JWT, provider OAuth, configurazione SMTP
- **[Regole di sicurezza (RLS)](/docs/collections/security-rules)** — Controllo degli accessi a livello di riga per collection
- **[Autenticazione con l'SDK tipizzato](/docs/sdk/authentication)** — Metodi di autenticazione programmatici
