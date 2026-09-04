---
title: Autenticazione e Login
sidebar_label: Autenticazione e Login
description: Configura il controller di autenticazione, la vista di login e la simulazione dei ruoli nel tuo frontend React di Rebase.
---

## Panoramica

Rebase fornisce componenti e hook React pronti all'uso per l'autenticazione:

- **`useRebaseAuthController`** — Gestisce lo stato di autenticazione, i token e la persistenza della sessione
- **`LoginView`** — Modulo di login/registrazione predefinito con supporto OAuth
- **Simulazione dei ruoli** — Testa ruoli diversi senza disconnetterti

## Controller di Autenticazione

L'hook `useRebaseAuthController` è il cuore dell'autenticazione frontend. Gestisce l'utente corrente, i token e la sessione:

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

Passa l'`authController` al controller di navigazione di Rebase per proteggere l'intero pannello di amministrazione dietro l'autenticazione.

## Vista di Login

Il componente `LoginView` fornisce un modulo completo di login e registrazione:

```tsx
import { LoginView } from "@rebasepro/app";

if (!authController.user) {
    return (
        <LoginView
            authController={authController}
            googleClientId={GOOGLE_CLIENT_ID}
        />
    );
}
```

La vista di login gestisce:
- Login e registrazione con email/password
- Accesso con Google, GitHub e LinkedIn (quando configurato)
- Flusso di reimpostazione password
- Validazione del modulo e stati di errore

## Modello dei Ruoli

I ruoli sono archiviati come colonna array `text[]` direttamente sulla tabella `rebase.users`. Definisci i ruoli disponibili come enum nella definizione della tua collezione utenti:

```typescript title="config/collections/users.ts"
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

Per aggiungere o rimuovere opzioni di ruolo, aggiorna la mappa `enum` nella tua collezione utenti e rigenera lo schema.

## Simulazione dei Ruoli (Modalità Sviluppo)

In modalità sviluppatore, puoi simulare ruoli diversi senza disconnetterti. Questo è utile per testare le politiche RLS:

```typescript
import { useBuildEffectiveRoleController } from "@rebasepro/app";

const effectiveRoleController = useBuildEffectiveRoleController();

// When active, the UI behaves as if the current user has this role
effectiveRoleController.setEffectiveRole("editor");
```

## Prossimi Passi

- **[Autenticazione nel Backend](/docs/backend/authentication)** — JWT, provider OAuth, configurazione SMTP
- **[Regole di Sicurezza (RLS)](/docs/collections/security-rules)** — Controllo dell'accesso a livello di riga per collezione
- **[Autenticazione del SDK Client](/docs/sdk/authentication)** — Metodi di autenticazione programmatici
