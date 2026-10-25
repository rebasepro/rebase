---
sourceHash: 6ac0abb490b5801e
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

Übergeben Sie den `authController` an `<Rebase authController>`. `<RebaseShell>` (oder `<RebaseAuthGate>` in einem manuellen Layout) liest ihn von dort und schützt das gesamte Admin-Panel durch eine Authentifizierung.

## Ihr eigener Auth-Provider

Unter 0.24 authentifiziert der
Getter nur HTTP-Anfragen, und der Realtime-Socket des Panels bleibt anonym.

Wenn Ihre App Benutzer mit einem eigenen Provider anmeldet (Clerk, Firebase Auth, eine
eigene Session), geben Sie dem Client, den Sie an `<Rebase client>` übergeben, einen
Token-Getter. Die HTTP-Anfragen des Panels und sein Realtime-Socket senden beide, was er
zurückgibt, sodass Live-Collection-Ansichten als derselbe Benutzer laufen:

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

Der `authController` daneben meldet dann den angemeldeten Benutzer Ihres Providers
(ein `AuthController` aus `@rebasepro/cms-types`), statt `client.auth` zu umhüllen. Auch das
Backend muss das Token akzeptieren: siehe
[Benutzerdefinierte Auth-Adapter](/docs/backend/auth-adapters) und
[Einen eigenen Auth-Provider verwenden](/docs/sdk/authentication#using-your-own-auth-provider)
für die Client-Seite im Ganzen.

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

Eine Rolle in dieser Liste ist ein Name, auf den Ihre [Sicherheitsregeln](/docs/collections/security-rules) passen können. Was sie über ihre Zeilen hinaus darf (Benutzer verwalten, Logs lesen, das Schema ändern), wird separat deklariert, unter `auth.roles` in derselben Collection. `admin` ist integriert und hält alles. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes).

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
- **[Authentifizierung im typisierten SDK](/docs/sdk/authentication)** — Programmatische Authentifizierungsmethoden
