---
sourceHash: 62fa2c4fbfc717e1
title: Autenticazione e login
sidebar_label: Autenticazione e login
description: Configura il controller di autenticazione, la vista di login e la simulazione dei ruoli nel tuo frontend React Rebase.
---

## Panoramica

Rebase fornisce componenti e hook React pronti all'uso per l'autenticazione:

- **`useRebaseAuthController`** — Gestisce lo stato di autenticazione, i token e la persistenza della sessione
- **`LoginView`** — Modulo predefinito di login/registrazione con supporto OAuth
- **Simulazione dei ruoli** — Testa ruoli diversi senza disconnetterti

## Controller di autenticazione

L'hook `useRebaseAuthController` è il cuore dell'autenticazione lato frontend. Gestisce l'utente corrente, i token e la sessione:

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

Passa `authController` a `<Rebase authController>`. `<RebaseShell>` (o `<RebaseAuthGate>` in un layout manuale) lo legge da lì e protegge l'intero pannello di amministrazione con l'autenticazione.

## Il tuo provider di autenticazione

Se la tua applicazione autentica gli utenti con il proprio provider (Clerk, Firebase Auth, una sessione proprietaria), fornisci un token getter al client passato a `<Rebase client>`. Sia le richieste HTTP del pannello sia il suo socket realtime inviano quanto restituito da esso, in modo che le viste live delle collection vengano eseguite come lo stesso utente:

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

L'`authController` ad esso affiancato segnala quindi l'utente autenticato del tuo provider (un `AuthController` da `@rebasepro/cms-types`) invece di eseguire il wrapping di `client.auth`. Anche il backend deve accettare il token: consulta [Adapter di autenticazione personalizzati](/docs/backend/auth-adapters) e [Il tuo provider di autenticazione](/docs/sdk/your-own-auth-provider/) per la documentazione completa sul lato client.

## Vista di login

Il componente `LoginView` fornisce un modulo completo di login e registrazione:

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
- Validazione dei moduli e stati di errore

## Modello dei ruoli

I ruoli vengono memorizzati come una colonna array `text[]` direttamente nella tabella `rebase.users`. Puoi definire i ruoli disponibili come un enum nella definizione della tua collection users:

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

Un ruolo in questo elenco è un nome a cui le tue [regole di sicurezza](/docs/collections/security-rules) possono corrispondere. Ciò che può fare oltre alle sue righe (gestire utenti, leggere log, modificare lo schema) viene dichiarato separatamente, sotto `auth.roles` nella stessa collection. `admin` è integrato e dispone di tutti i permessi. Consulta [Ruoli e ambiti](/docs/backend/roles-and-scopes).

## Test dell'accesso: Simula accesso

Per verificare cosa può leggere un ruolo, un utente o una chiave di servizio, un amministratore utilizza **Simulate access**, il controllo a pillola sopra il tuo avatar nel drawer del pannello di amministrazione (nella barra dell'app su schermi piccoli, o quando la shell non ha un drawer). Seleziona un ruolo (con un ID utente opzionale, che non deve necessariamente essere un account), un utente o una chiave di servizio attiva.
Ogni vista dati e la scheda Cronologia (History) di un record leggono quindi attraverso il server con quell'identità, confrontandosi con le reali policy di sicurezza a livello di riga (RLS): una griglia mostra esattamente le righe che può leggere, i campi che i suoi ruoli non possono leggere vengono mascherati e il banner conteggia le collection in cui non vede nulla. Il server verifica a ogni richiesta che tu sia un amministratore.

L'accesso simulato è in sola lettura. Mentre è attivo, le viste non offrono opzioni per creare, modificare, eliminare o ripristinare la cronologia, e il server rifiuta qualsiasi scrittura che includa una simulazione con `403 SIMULATION_READ_ONLY`, evitando così che qualcosa venga salvato a nome di qualcun altro. Interrompi la simulazione per apportare modifiche.

Cosa non viene simulato: il gate `requireAuth` dell'API dati, che lascia passare un chiamante anonimo simulato in modo da mostrare ciò che le policy delle righe gli consentono (una funzione personalizzata lo vede come assenza di sessione, esattamente come per un vero chiamante anonimo); lo storage, i cui file vengono letti come te stesso, con i caricamenti disattivati durante la simulazione; e gli aggiornamenti live, che vengono messi in pausa fino all'interruzione.

La stessa operazione tramite codice, sull'SDK, è `client.simulate()`. Deriva un client le cui richieste includono la simulazione, e solo la sessione di un amministratore può utilizzarlo:

```typescript
const asCustomer = client.simulate({ role: "customer", userId: "u_1" });
const { data } = await asCustomer.data.collection("tickets").find();
asCustomer.close();
```

Il client derivato è tipizzato dallo stesso `Database` di quello di origine ed è un client a sé stante: usa `close()` quando hai finito.

Il selettore del ruolo effettivo non è un tester RLS: modifica solo quali viste di Studio sono mostrate nella navigazione, non invia nulla al server e non valuta alcuna policy. `useBuildEffectiveRoleController`, che ne creava uno, è deprecato e genera un avviso una sola volta quando viene chiamato: `<Rebase>` crea il proprio controller se non ne viene passato alcuno, e Simula accesso (Simulate access) è la modalità corretta per verificare cosa può fare un ruolo.

## Passaggi successivi

- **[Autenticazione backend](/docs/backend/authentication)** — JWT, provider OAuth, configurazione SMTP
- **[Regole di sicurezza (RLS)](/docs/collections/security-rules)** — Controllo degli accessi a livello di riga per collection
- **[Autenticazione nell'SDK tipizzato](/docs/sdk/authentication)** — Metodi programmatici di autenticazione
