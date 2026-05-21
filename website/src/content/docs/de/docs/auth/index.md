---
title: Authentifizierung
sidebar_label: Authentifizierung
description: Konfigurieren Sie JWT-Authentifizierung, OAuth-Anbieter (Google, LinkedIn), Benutzerverwaltung und rollenbasierte Zugriffssteuerung.
---

## Übersicht

Rebase enthält ein vollständiges Authentifizierungssystem:

- **JWT-Tokens** — Flow für Zugriffs- und Refresh-Tokens
- **OAuth-Plugins** — Steckbare Architektur für Google, LinkedIn und mehr
- **Benutzerverwaltung** — Registrierung, Anmeldung, Passwort zurücksetzen
- **Rollenbasierter Zugriff** — Rollen Benutzern zuweisen, Berechtigungen in Kollektionen prüfen
- **Automatisches Bootstrapping** — Der erste Benutzer erhält automatisch die Administratorrolle

## Backend-Konfiguration

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

Die Authentifizierungstabellen (`rebase.users`, `rebase.roles`, `rebase.user_roles`, `rebase.refresh_tokens`) werden beim ersten Start **automatisch erstellt**.

## Authentifizierungs-Endpunkte

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Neues Konto erstellen |
| `POST` | `/api/auth/login` | Mit E-Mail/Passwort anmelden |
| `POST` | `/api/auth/refresh` | Zugriffstoken aktualisieren |
| `POST` | `/api/auth/<provider-id>` | Dynamischer Anmelde-Endpunkt für jeden konfigurierten OAuth-Anbieter (z.B. `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/logout` | Refresh-Token widerrufen |
| `POST` | `/api/auth/forgot-password` | E-Mail zum Zurücksetzen des Passworts senden |
| `POST` | `/api/auth/reset-password` | Passwort mit Token zurücksetzen |

## Frontend-Einrichtung

### Auth-Controller

```typescript
import { useRebaseAuthController } from "@rebasepro/auth";
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

const authController = useRebaseAuthController({
    client,
    googleClientId: GOOGLE_CLIENT_ID  // Optional
});

// Verfügbare Eigenschaften:
authController.user          // Aktuelles Benutzerobjekt (oder null)
authController.initialLoading // True, während die gespeicherte Sitzung geprüft wird
authController.signOut()     // Abmelden
authController.getAuthToken() // Aktuelles JWT für API-Aufrufe abrufen
```

### Login-Ansicht

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

## Benutzer- und Rollenverwaltung

### Backend-Dienste

Nach der Initialisierung stellt die Backend-Instanz `userService` und `roleService` bereit:

```typescript
const { userService, roleService } = instance;

// Alle Benutzer auflisten
const users = await userService.listUsers();

// Eine Rolle zuweisen
await roleService.assignRole(userId, roleId);
```

### Frontend-Komponenten

Rebase bietet integrierte Ansichten zur Verwaltung von Benutzern und Rollen:

```tsx
import { UsersView, RolesView } from "@rebasepro/core";
import { useBackendUserManagement } from "@rebasepro/auth";

const userManagement = useBackendUserManagement({
    client: rebaseClient,
    currentUser: authController.user
});

// In Ihren Routen:
<Route path="/users" element={<UsersView userManagement={userManagement} />} />
<Route path="/roles" element={<RolesView userManagement={userManagement} />} />
```

![Benutzerverwaltungsoberfläche](/img/user_management.png)

## Rollensimulation (Entwicklermodus)

Im Entwicklermodus können Sie verschiedene Rollen simulieren, ohne sich abzumelden:

```typescript
import { useBuildEffectiveRoleController } from "@rebasepro/core";

const effectiveRoleController = useBuildEffectiveRoleController();

// Wenn aktiv, verhält sich die Benutzeroberfläche so, als hätte der aktuelle Benutzer diese Rolle
effectiveRoleController.setEffectiveRole("editor");
```

## Erstbenutzer-Bootstrapping

Wenn keine Benutzer in der Datenbank existieren, wird die erste Person, die sich registriert, automatisch zum Administrator. Danach wird die Registrierung durch die Einstellung `allowRegistration` gesteuert.

Dies stellt sicher, dass Sie eine neue Bereitstellung immer bootstrappen können, ohne die Datenbank manuell mit Daten füllen zu müssen.

## Nächste Schritte

- **[Speicher](/docs/storage)** — Dateispeicherkonfiguration
- **[Kollektionen](/docs/collections)** — Berechtigungen pro Kollektion

---
