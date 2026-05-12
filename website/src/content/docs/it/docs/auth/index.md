---
title: Autenticazione
sidebar_label: Autenticazione
slug: docs/auth
description: Configura l'autenticazione JWT, i provider OAuth (Google, LinkedIn), la gestione degli utenti e il controllo degli accessi basato sui ruoli.
---

## Panoramica

Rebase include un sistema di autenticazione completo:

- **Token JWT** — Flusso di token di accesso e di refresh
- **Plugin OAuth** — Architettura pluggabile per Google, LinkedIn e altro
- **Gestione utenti** — Registrazione, login, reimpostazione password
- **Accesso basato sui ruoli** — Assegna ruoli agli utenti, controlla i permessi nelle collezioni
- **Auto-avvio** — Il primo utente ottiene automaticamente il ruolo di amministratore

## Configurazione Backend

```typescript
import { createGoogleProvider, createLinkedinProvider } from "@rebasepro/server-core";

await initializeRebaseBackend({
    // ...
    auth: {
        jwtSecret: process.env.JWT_SECRET!,  // Required
        accessExpiresIn: "1h",               // Access token lifetime
        refreshExpiresIn: "30d",             // Refresh token lifetime
        requireAuth: true,                   // Require auth for data API
        allowRegistration: false,            // Allow new signups
        oauthProviders: [
            createGoogleProvider(process.env.GOOGLE_CLIENT_ID!),
            createLinkedinProvider({
                clientId: process.env.LINKEDIN_CLIENT_ID!,
                clientSecret: process.env.LINKEDIN_CLIENT_SECRET!
            })
        ],
        email: {                             // Optional — for password reset
            smtpHost: "smtp.gmail.com",
            smtpPort: 587,
            smtpUser: "noreply@example.com",
            smtpPass: "app-password",
            from: "Rebase <noreply@example.com>"
        }
    }
});
```

Le tabelle di autenticazione (`rebase.users`, `rebase.roles`, `rebase.user_roles`, `rebase.refresh_tokens`) vengono **create automaticamente** al primo avvio.

## Endpoint di Autenticazione

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Crea un nuovo account |
| `POST` | `/api/auth/login` | Login con email/password |
| `POST` | `/api/auth/refresh` | Aggiorna il token di accesso |
| `POST` | `/api/auth/<provider-id>` | Endpoint di accesso dinamico per qualsiasi provider OAuth configurato (es. `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/logout` | Revoca il token di refresh |
| `POST` | `/api/auth/forgot-password` | Invia email di reimpostazione password |
| `POST` | `/api/auth/reset-password` | Reimposta password con token |

## Configurazione Frontend

### Controller di Autenticazione

```typescript
import { useRebaseAuthController } from "@rebasepro/auth";
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

const authController = useRebaseAuthController({
    client,
    googleClientId: GOOGLE_CLIENT_ID  // Optional
});

// Proprietà disponibili:
authController.user          // Oggetto utente corrente (o null)
authController.initialLoading // Vero durante il controllo della sessione memorizzata
authController.signOut()     // Effettua il logout
authController.getAuthToken() // Ottieni il JWT corrente per le chiamate API
```

### Vista di Login

```tsx
import { RebaseLoginView } from "@rebasepro/auth";

if (!authController.user) {
    return (
        <RebaseLoginView
            authController={authController}
            googleEnabled={!!GOOGLE_CLIENT_ID}
            googleClientId={GOOGLE_CLIENT_ID}
        />
    );
}
```

## Gestione Utenti e Ruoli

### Servizi Backend

Dopo l'inizializzazione, l'istanza backend fornisce `userService` e `roleService`:

```typescript
const { userService, roleService } = instance;

// Elenca tutti gli utenti
const users = await userService.listUsers();

// Assegna un ruolo
await roleService.assignRole(userId, roleId);
```

### Componenti Frontend

Rebase fornisce viste integrate per la gestione di utenti e ruoli:

```tsx
import { UsersView, RolesView } from "@rebasepro/core";
import { useBackendUserManagement } from "@rebasepro/auth";

const userManagement = useBackendUserManagement({
    client: rebaseClient,
    currentUser: authController.user
});

// Nelle tue rotte:
<Route path="/users" element={<UsersView userManagement={userManagement} />} />
<Route path="/roles" element={<RolesView userManagement={userManagement} />} />
```

![User management interface](/img/user_management.png)

## Simulazione Ruoli (Modalità Sviluppo)

In modalità sviluppatore, puoi simulare diversi ruoli senza effettuare il logout:

```typescript
import { useBuildEffectiveRoleController } => "@rebasepro/core";

const effectiveRoleController = useBuildEffectiveRoleController();

// Quando attivo, l'interfaccia utente si comporta come se l'utente corrente avesse questo ruolo
effectiveRoleController.setEffectiveRole("editor");
```

## Bootstrap del Primo Utente

Quando non esistono utenti nel database, la prima persona a registrarsi diventa automaticamente un amministratore. Dopodiché, la registrazione è controllata dall'impostazione `allowRegistration`.

Questo assicura che tu possa sempre avviare una nuova distribuzione senza dover popolare manualmente il database.

## Prossimi Passi

- **[Storage](/docs/storage)** — Configurazione dell'archiviazione file
- **[Collezioni](/docs/collections)** — Permessi per collezione

---
