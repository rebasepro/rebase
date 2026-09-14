---
sourceHash: 90e2137462c112d2
title: Authentifizierung & Anmeldung
sidebar_label: Authentifizierung & Anmeldung
description: Richten Sie den Auth-Controller, die Login-Ansicht und die Rollensimulation in Ihrem Rebase-React-Frontend ein.
---

## Übersicht

Rebase bietet einsatzbereite React-Komponenten und Hooks für die Authentifizierung:

- **`useRebaseAuthController`** —孔Verwaltet den Auth-Status, Tokens und die Persistenz von Sitzungen
- **`LoginView`** — Vorgefertigtes Anmelde-/Registrierungsformular mit OAuth-Unterstützung
- **Rollensimulation** — Testen Sie verschiedene Rollen, ohne sich abzumelden

## Auth-Controller

Der Hook `useRebaseAuthController` ist das Kernstück der Frontend-Authentifizierung. Er verwaltet den aktuellen Benutzer, Tokens und die Sitzung:

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

Übergeben Sie den `authController` an den Rebase-Navigations-Controller, um das gesamte Admin-Panel durch eine Authentifizierung zu schützen.

## Login-Ansicht

Die Komponente `LoginView` stellt ein vollständiges Formular für Anmeldung und Registrierung bereit:

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

Die Login-Ansicht übernimmt:
- E-Mail/Passwort-Anmeldung und -Registrierung
- Google-, GitHub- und LinkedIn-OAuth-Anmeldung (sofern konfiguriert)
- Ablauf zum Zurücksetzen des Passworts
- Formularvalidierung und Fehlerzustände

## Rollenmodell

Rollen werden als `text[]`-Array-Spalte direkt in der Tabelle `rebase.users` gespeichert. Sie definieren verfügbare Rollen als Enum in der Definition Ihrer Users-Collection:

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

Um Rollenoptionen hinzuzufügen oder zu entfernen, aktualisieren Sie die `enum`-Map in Ihrer Users-Collection und generieren Sie das Schema neu.

## Rollensimulation (Dev-Modus)

Im Entwicklermodus können Sie verschiedene Rollen simulieren, ohne sich abzumelden. Dies ist nützlich zum Testen von RLS-Richtlinien:

```typescript
import { useBuildEffectiveRoleController } from "@rebasepro/app";

const effectiveRoleController = useBuildEffectiveRoleController();

// When active, the UI behaves as if the current user has this role
effectiveRoleController.setEffectiveRole("editor");
```

## Nächste Schritte

- **[Backend-Authentifizierung](/docs/backend/authentication)** — JWT, OAuth-Anbieter, SMTP-Konfiguration
- **[Sicherheitsregeln (RLS)](/docs/collections/security-rules)** — Zugriffskontrolle auf Zeilenebene (Row-Level Security) pro Collection
- **[Client-SDK-Authentifizierung](/docs/sdk/authentication)** — Programmatische Authentifizierungsmethoden
