---
sourceHash: 59bdc8b898c974d7
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

Passa l'`authController` al navigation controller di Rebase per proteggere l'intero pannello di amministrazione dietro autenticazione.

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

## Simulazione dei ruoli (Modalità Dev)

In modalità sviluppatore, puoi simulare ruoli diversi senza effettuare il logout. Questo è utile per testare le policy RLS:

```typescript
import { useBuildEffectiveRoleController } from "@rebasepro/app";

const effectiveRoleController = useBuildEffectiveRoleController();

// When active, the UI behaves as if the current user has this role
effectiveRoleController.setEffectiveRole("editor");
```

## Passaggi successivi

- **[Autenticazione Backend](/docs/backend/authentication)** — JWT, provider OAuth, configurazione SMTP
- **[Regole di sicurezza (RLS)](/docs/collections/security-rules)** — Controllo degli accessi a livello di riga per collection
- **[Autenticazione con l'SDK tipizzato](/docs/sdk/authentication)** — Metodi di autenticazione programmatici
