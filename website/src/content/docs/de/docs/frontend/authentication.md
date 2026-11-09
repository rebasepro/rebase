---
sourceHash: 62fa2c4fbfc717e1
title: Authentifizierung & Login
sidebar_label: Authentifizierung & Login
description: Richten Sie den Auth-Controller, die Login-Ansicht und die Rollensimulation in Ihrem Rebase-React-Frontend ein.
---

## Übersicht

Rebase bietet vorgefertigte React-Komponenten und Hooks für die Authentifizierung:

- **`useRebaseAuthController`** — Verwaltet Auth-Status, Tokens und Sitzungspersistenz
- **`LoginView`** — Vorgefertigtes Login-/Registrierungsformular mit OAuth-Unterstützung
- **Rollensimulation** — Testen Sie verschiedene Rollen, ohne sich abzumelden

## Auth-Controller

Der Hook `useRebaseAuthController` bildet das Herzstück der Frontend-Authentifizierung. Er verwaltet den aktuellen Benutzer, Tokens und die Sitzung:

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

Übergeben Sie den `authController` an `<Rebase authController>`. `<RebaseShell>` (oder `<RebaseAuthGate>` in einem manuellen Layout) liest ihn von dort aus und schützt das gesamte Admin-Panel hinter der Authentifizierung.

## Eigener Auth-Provider

Wenn Ihre App Benutzer über einen eigenen Provider anmeldet (Clerk, Firebase Auth, eine eigene Sitzung), übergeben Sie dem Client, den Sie an `<Rebase client>` weiterleiten, einen Token-Getter. Sowohl die HTTP-Anfragen des Panels als auch dessen Realtime-Socket senden das zurückgegebene Token, sodass Live-Collection-Ansichten unter demselben Benutzer ausgeführt werden:

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

Der daneben liegende `authController` meldet dann den angemeldeten Benutzer Ihres Providers (ein `AuthController` aus `@rebasepro/cms-types`), anstatt `client.auth` zu wrappen. Das Backend muss das Token ebenfalls akzeptieren: Siehe [Benutzerdefinierte Auth-Adapter](/docs/backend/auth-adapters) und [Eigener Auth-Provider](/docs/sdk/your-own-auth-provider/) für die vollständige Client-Seite.

## Login-Ansicht

Die Komponente `LoginView` bietet ein vollständiges Login- und Registrierungsformular:

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

Die Login-Ansicht handhabt:
- E-Mail/Passwort-Login und -Registrierung
- Google-, GitHub- und LinkedIn-OAuth-Anmeldung (sofern konfiguriert)
- Ablauf zum Zurücksetzen des Passworts
- Formularvalidierung und Fehlerzustände

## Rollenmodell

Rollen werden als `text[]`-Array-Spalte direkt in der Tabelle `rebase.users` gespeichert. Sie definieren verfügbare Rollen als Enum in Ihrer Users-Collection-Definition:

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

Um Rollenoptionen hinzuzufügen oder zu entfernen, aktualisieren Sie das `enum`-Mapping in Ihrer Users-Collection und generieren Sie das Schema neu.

Eine Rolle in dieser Liste ist ein Name, den Ihre [Sicherheitsregeln](/docs/collections/security-rules) abgleichen können. Was sie über ihre Zeilen hinaus tun darf (Benutzer verwalten, Logs lesen, das Schema ändern), wird separat unter `auth.roles` in derselben Collection deklariert. `admin` ist integriert und umfasst alle Berechtigungen. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes).

## Zugriff testen: Zugriff simulieren

Um zu prüfen, was eine Rolle, ein Benutzer oder ein Service-Key lesen kann, verwendet ein Administrator **Zugriff simulieren** (Simulate access), das Pill-Element über Ihrem Avatar im Drawer des Admin-Panels (in der App-Leiste auf kleinen Bildschirmen oder wenn die Shell keinen Drawer hat). Wählen Sie eine Rolle (mit einer optionalen Benutzer-ID, die kein Konto sein muss), einen Benutzer oder einen aktiven Service-Key.
Jede Datenansicht und der Verlauf-Tab eines Datensatzes lesen dann über den Server mit dieser Identität unter Anwendung der echten Row-Level-Security-Richtlinien: Ein Raster zeigt genau die Zeilen an, die gelesen werden dürfen, Felder, die die Rollen nicht lesen dürfen, werden maskiert, und das Banner zählt die Collections, in denen nichts sichtbar ist. Der Server prüft bei jeder Anfrage, ob Sie ein Administrator sind.

Der simulierte Zugriff ist schreibgeschützt (read-only). Während er aktiv ist, bieten die Ansichten kein Erstellen, Bearbeiten, Löschen oder Wiederherstellen des Verlaufs, und der Server verweigert jeden Schreibvorgang, der eine Simulation enthält, mit `403 SIMULATION_READ_ONLY`, sodass nichts unter einer fremden Identität gespeichert wird. Beenden Sie die Simulation, um Änderungen vorzunehmen.

Was nicht simuliert wird: das `requireAuth`-Gate der Daten-API, welches einen simulierten anonymen Aufrufer durchlässt, damit Sie sehen, was die Richtlinien der Zeilen freigeben (eine benutzerdefinierte Funktion sieht dies wie ein echter anonymer Aufrufer als fehlende Sitzung); Storage, dessen Dateien weiterhin als Sie selbst gelesen werden, während Uploads während der Simulation deaktiviert sind; und Live-Updates, die pausiert werden, bis Sie die Simulation beenden.

Dasselbe aus dem Code heraus über das SDK erfolgt mit `client.simulate()`. Dies leitet einen Client ab, dessen Anfragen die Simulation übertragen, und nur die eigene Sitzung eines Administrators darf dies verwenden:

```typescript
const asCustomer = client.simulate({ role: "customer", userId: "u_1" });
const { data } = await asCustomer.data.collection("tickets").find();
asCustomer.close();
```

Der abgeleitete Client wird durch dieselbe `Database` typisiert wie der Ursprungsclient und ist ein eigenständiger Client: Rufen Sie `close()` auf, wenn Sie fertig sind.

Der Umschalter für die effektive Rolle ist kein RLS-Tester: Er ändert lediglich, welche Studio-Ansichten die Navigation auflistet, sendet nichts an den Server und wertet keine Richtlinien aus. `useBuildEffectiveRoleController`, das einen solchen erstellt hat, ist veraltet (deprecated) und gibt beim Aufruf eine einmalige Warnung aus: `<Rebase>` erstellt einen eigenen Controller, wenn keiner übergeben wird, und Zugriff simulieren ist der vorgesehene Weg, um zu testen, was eine Rolle tun kann.

## Nächste Schritte

- **[Backend-Authentifizierung](/docs/backend/authentication)** — JWT, OAuth-Provider, SMTP-Konfiguration
- **[Sicherheitsregeln (RLS)](/docs/collections/security-rules)** — Zugriffskontrolle auf Zeilenebene pro Collection
- **[Typisierte SDK-Authentifizierung](/docs/sdk/authentication)** — Programmatische Auth-Methoden
