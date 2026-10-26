---
sourceHash: fe474014627c7510
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

## Zugriff testen: Simulate access

Um zu prüfen, was eine Rolle, ein Benutzer oder ein Service-Key lesen kann, verwendet ein Administrator
**Simulate access**, die Pill über Ihrem Avatar in der Drawer-Leiste des Admin-Panels (in
der App-Leiste auf einem kleinen Bildschirm oder wenn die Shell keinen Drawer hat). Wählen Sie eine Rolle
(mit einer optionalen Benutzer-ID, die kein Konto sein muss), einen Benutzer oder einen aktiven
Service-Key.
Jede Datenansicht und der Tab „Verlauf“ eines Datensatzes lesen dann über den Server als
diese Identität, gegen die echten Row-Level-Security-Richtlinien: Ein Grid zeigt
genau die Zeilen, die sie lesen kann,
Felder, die ihre Rollen nicht lesen können, werden maskiert, und das Banner zählt die Collections,
in denen sie nichts sieht. Der Server prüft bei jeder Anfrage, dass Sie
Administrator sind.

Simulierter Zugriff ist schreibgeschützt. Solange er aktiv ist, bieten die Ansichten kein Erstellen, Bearbeiten,
Löschen oder Zurücksetzen des Verlaufs an, und der Server verweigert jeden Schreibvorgang, der eine Simulation trägt, mit
`403 SIMULATION_READ_ONLY`, sodass nichts als jemand anderes gespeichert wird. Beenden Sie die Simulation,
um Änderungen vorzunehmen.

Was sie nicht simuliert: das `requireAuth`-Gate der Daten-API, das einen
simulierten anonymen Aufrufer durchlässt, damit Sie sehen, was die Richtlinien der Zeilen ihm geben
(eine benutzerdefinierte Funktion sieht ihn als ohne Sitzung, wie einen echten anonymen Aufrufer);
Storage, dessen Dateien als Sie gelesen werden, mit deaktivierten Uploads während der Simulation; und
Live-Updates, die pausieren, bis Sie die Simulation beenden.

Dasselbe aus Code, im SDK, ist `client.simulate()`. Es leitet einen
Client ab, dessen Anfragen die Simulation tragen, und nur die eigene Sitzung eines Administrators
darf es verwenden:

```typescript
const asCustomer = client.simulate({ role: "customer", userId: "u_1" });
const { data } = await asCustomer.data.collection("tickets").find();
asCustomer.close();
```

Der abgeleitete Client ist mit demselben `Database` typisiert wie der, von dem er stammt, und
ist ein eigener Client: Rufen Sie `close()` auf, wenn Sie fertig sind.

Der Schalter für die effektive Rolle ist kein RLS-Tester: Er ändert nur, welche Studio-
Ansichten die Navigation auflistet, sendet nichts an den Server und wertet keine
Richtlinie aus. `useBuildEffectiveRoleController`, das einen solchen gebaut hat, ist veraltet und
warnt einmal beim Aufruf: `<Rebase>` baut seinen eigenen Controller, wenn keiner
übergeben wird, und Simulate access ist der Weg, um zu testen, was eine Rolle tun kann.

## Nächste Schritte

- **[Backend-Authentifizierung](/docs/backend/authentication)** — JWT, OAuth-Anbieter, SMTP-Konfiguration
- **[Sicherheitsregeln (RLS)](/docs/collections/security-rules)** — Zugriffskontrolle auf Zeilenebene (Row-Level Security) pro Collection
- **[Authentifizierung im typisierten SDK](/docs/sdk/authentication)** — Programmatische Authentifizierungsmethoden
