---
title: Autenticazione
sidebar_label: Autenticazione
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
import { createGoogleProvider, createLinkedinProvider } from "@rebasepro/server";

await initializeRebaseBackend({
    // ...
    auth: {
        jwtSecret: process.env.JWT_SECRET!,  // Required
        accessExpiresIn: "1h",               // Access token lifetime
        refreshExpiresIn: "30d",             // Refresh token lifetime
        requireAuth: true,                   // Require auth for data API
        allowRegistration: false,            // Allow new signups
        google: process.env.GOOGLE_CLIENT_ID ? {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET
        } : undefined,
        linkedin: process.env.LINKEDIN_CLIENT_ID ? {
            clientId: process.env.LINKEDIN_CLIENT_ID,
            clientSecret: process.env.LINKEDIN_CLIENT_SECRET
        } : undefined,
        email: {
            smtp: {
                host: "smtp.gmail.com",
                port: 587,
                secure: false,
                user: "noreply@example.com",
                pass: "app-password",
                from: "Rebase <noreply@example.com>"
            }
        }
    }
});
```

Le tabelle di autenticazione (`rebase.users`, `rebase.roles`, `rebase.user_roles`, `rebase.refresh_tokens`) vengono **create automaticamente** al primo avvio.

### Adattatori di Autenticazione Personalizzati

Rebase consente la sostituzione completa del sistema di autenticazione predefinito tramite l'interfaccia `AuthAdapter`. Passa un adattatore personalizzato alla proprietà `auth` per bypassare completamente il meccanismo integrato di JWT e tabelle utenti (ad esempio, per integrare Firebase Auth, Auth0 o un provider SSO aziendale esterno).

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
import { useRebaseAuthController } from "@rebasepro/app";
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
import { RebaseLoginView } from "@rebasepro/app";

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
import { UsersView, RolesView } from "@rebasepro/app";
import { useBackendUserManagement } from "@rebasepro/app";

const userManagement = useBackendUserManagement({
    client: rebaseClient,
    currentUser: authController.user
});

// Nelle tue rotte:
<Route path="/users" element={<UsersView userManagement={userManagement} />} />
<Route path="/roles" element={<RolesView userManagement={userManagement} />} />
```

![Interfaccia gestione utenti](/img/user_management.png)

## Simulazione Ruoli (Modalità Sviluppo)

In modalità sviluppatore, puoi simulare diversi ruoli senza effettuare il logout:

```typescript
import { useBuildEffectiveRoleController } => "@rebasepro/app";

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
