---
sourceHash: 90e2137462c112d2
title: Authentifizierung & Login
sidebar_label: Authentifizierung & Login
description: Richten Sie den Auth-Controller, die Login-Ansicht und die Rollensimulation in Ihrem Rebase-React-Frontend ein.
---

## Überblick

Rebase bietet einsatzbereite React-Komponenten und Hooks für die Authentifizierung:

- **`useRebaseAuthController`** — Verwaltet den Auth-Zustand, Tokens und die Sitzungspersistenz
- **`LoginView`** — Vorgefertigtes Login-/Registrierungsformular mit OAuth-Unterstützung
- **Rollensimulation** — Testen Sie verschiedene Rollen, ohne sich abzumelden

## Auth-Controller

Der Hook `useRebaseAuthController` ist der Kern der Frontend-Authentifizierung. Er verwaltet den aktuellen Benutzer, Tokens und die Sitzung:

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

Übergeben Sie den `authController` an den Rebase-Navigations-Controller, um das gesamte Admin-Panel hinter der Authentifizierung abzusichern.

## Login-Ansicht

Die Komponente `LoginView` bietet ein vollständiges Login- und Registrierungsformular:

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

Die Login-Ansicht übernimmt:
- Login und Registrierung per E-Mail/Passwort
- Anmeldung über Google, GitHub und LinkedIn (wenn konfiguriert)
- Passwort-Zurücksetzungs-Flow
- Formularvalidierung und Fehlerzustände

## Rollenmodell

Rollen werden als `text[]`-Array-Spalte direkt auf der Tabelle `rebase.users` gespeichert. Sie definieren die verfügbaren Rollen als Enum in Ihrer Users-Collection-Definition:

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

Um Rollenoptionen hinzuzufügen oder zu entfernen, aktualisieren Sie die `enum`-Map in Ihrer Users-Collection und generieren Sie das Schema neu.

## Rollensimulation (Entwicklungsmodus)

Im Entwicklermodus können Sie verschiedene Rollen simulieren, ohne sich abzumelden. Dies ist nützlich zum Testen von RLS-Richtlinien:

```typescript
import { useBuildEffectiveRoleController } from "@rebasepro/app";

const effectiveRoleController = useBuildEffectiveRoleController();

// When active, the UI behaves as if the current user has this role
effectiveRoleController.setEffectiveRole("editor");
```

## Nächste Schritte

- **[Backend-Authentifizierung](/docs/backend/authentication)** — JWT, OAuth-Anbieter, SMTP-Konfiguration
- **[Sicherheitsregeln (RLS)](/docs/collections/security-rules)** — Zugriffssteuerung auf Zeilenebene pro Collection
- **[Client-SDK-Authentifizierung](/docs/sdk/authentication)** — Programmatische Auth-Methoden
