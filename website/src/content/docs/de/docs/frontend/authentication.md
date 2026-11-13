---
sourceHash: 9c7b1e0ee0076030
title: Authentifizierung & Login
sidebar_label: Authentifizierung & Login
description: Richten Sie den Auth-Controller, die Login-Ansicht und die Rollensimulation in Ihrem Rebase React-Frontend ein.
---

## Übersicht

Rebase bietet einsatzbereite React-Komponenten und Hooks für die Authentifizierung:

- **`useRebaseAuthController`** — Verwaltet Authentifizierungsstatus, Tokens und Session-Persistenz
- **`LoginView`** — Vorgefertigtes Login-/Registrierungsformular mit OAuth-Unterstützung
- **Rollensimulation** — Testen Sie verschiedene Rollen, ohne sich abzumelden

## Auth-Controller

Der `useRebaseAuthController`-Hook ist das Kernstück der Frontend-Authentifizierung. Er verwaltet den aktuellen Benutzer, Tokens und die Session:

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

Übergeben Sie den `authController` an `<Rebase authController>`. `<RebaseShell>` (oder `<RebaseAuthGate>` in einem manuellen Layout) liest ihn von dort aus und schützt das gesamte Admin-Panel hinter einer Authentifizierung.

## Eigener Auth-Provider

Wenn sich Benutzer in Ihrer App über einen eigenen Provider anmelden (Clerk, Firebase Auth, eine eigene Session), übergeben Sie dem Client unter `<Rebase client>` einen Token-Getter. Sowohl die HTTP-Anfragen des Panels als auch dessen Realtime-Socket senden das zurückgegebene Token, sodass Live-Ansichten unter demselben Benutzer laufen:

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

Der danebenliegende `authController` meldet dann den angemeldeten Benutzer Ihres Providers (ein `AuthController` aus `@rebasepro/cms-types`), anstatt `client.auth` zu wrappen. Das Backend muss das Token ebenfalls akzeptieren: Siehe [Benutzerdefinierte Auth-Adapter](/docs/backend/auth-adapters) sowie [Eigener Auth-Provider](/docs/sdk/your-own-auth-provider/) für die vollständigen Details zur Client-Seite.

## Login-Ansicht

Die `LoginView`-Komponente bietet ein vollständiges Login- und Registrierungsformular:

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
- Login und Registrierung per E-Mail/Passwort
- Google-, GitHub- und LinkedIn-OAuth-Anmeldung (sofern konfiguriert)
- Passwort-Zurücksetzen-Ablauf
- Formularvalidierung und Fehlerzustände

## Rollenmodell

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Rollen werden als `text[]`-Array-Spalte in der Users-Tabelle gespeichert. Sie definieren die Rollen, die ein Benutzer innehaben kann, als geschlossene Menge auf dieser Spalte in der mit [`defineAuthTable`](/docs/schema/auth-table/) deklarierten Tabelle:

```typescript title="backend/schema/users.ts"
roles: col.text({ enum: ["admin", "editor", "viewer"] }).array(),
```

Um eine Rolle hinzuzufügen oder zu entfernen, ändern Sie diese Liste. Die Labels, die das Panel für die einzelnen Werte anzeigt, gehören zum Frontend: `enumLabels` auf dem Feld in `frontend/src/cms/users.tsx` (siehe [Tabelle anpassen](/docs/frontend/customize-table/)).

Eine Rolle in dieser Liste ist ein Name, auf den Ihre [Sicherheitsregeln](/docs/collections/security-rules) zugreifen können. Was sie über ihre Zeilen hinaus tun darf (Benutzer verwalten, Protokolle lesen, das Schema ändern), wird separat unter `auth.roles` in derselben Tabelle deklariert. `admin` ist integriert und umfasst alle Berechtigungen. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes).

## Zugriff testen: Zugriff simulieren

Um zu prüfen, was eine Rolle, ein Benutzer oder ein Service-Key lesen kann, verwendet ein Administrator **Simulate access**, die Pill-Schaltfläche über Ihrem Avatar im Drawer des Admin-Panels (in der App-Leiste auf kleinen Bildschirmen oder wenn die Shell keinen Drawer hat). Wählen Sie eine Rolle (mit einer optionalen Benutzer-ID, bei der es sich nicht um ein Konto handeln muss), einen Benutzer oder einen aktiven Service-Key.
Jede Datenansicht sowie der Verlaufs-Tab (History) eines Datensatzes liest dann über den Server unter dieser Identität und unter Anwendung der echten Row-Level-Security-Richtlinien: Ein Raster zeigt genau die Zeilen an, die gelesen werden können, Felder, die die Rollen nicht lesen dürfen, werden maskiert, und das Banner zählt die Tabellen, in denen nichts sichtbar ist. Der Server prüft bei jeder Anfrage, ob Sie ein Administrator sind.

Der simulierte Zugriff ist schreibgeschützt. Während er aktiv ist, bieten die Ansichten keine Funktionen zum Erstellen, Bearbeiten, Löschen oder Wiederherstellen des Verlaufs, und der Server lehnt jeden Schreibvorgang, der eine Simulation enthält, mit `403 SIMULATION_READ_ONLY` ab, sodass nichts im Namen einer anderen Person gespeichert wird. Beenden Sie die Simulation, um Änderungen vorzunehmen.

Was nicht simuliert wird: das `requireAuth`-Gate der Daten-API, welches einen simulierten anonymen Aufrufer durchlässt, damit Sie sehen, was die Richtlinien der Zeilen für diesen freigeben (eine benutzerdefinierte Funktion sieht dies als fehlende Session, genau wie bei einem echten anonymen Aufrufer); der Storage, dessen Dateien als Sie selbst gelesen werden, wobei Uploads während der Simulation deaktiviert sind; und Live-Updates, die pausiert werden, bis Sie die Simulation beenden.

Dasselbe aus dem Code heraus im SDK ist `client.simulate()`. Es leitet einen Client ab, dessen Anfragen die Simulation übertragen, und nur die Session eines Administrators darf diesen verwenden:

```typescript
const asCustomer = client.simulate({ role: "customer", userId: "u_1" });
const { data } = await asCustomer.data.table("tickets").find();
asCustomer.close();
```

Der abgeleitete Client wird durch dieselbe `Database` typisiert wie der Ursprungs-Client und ist ein eigenständiger Client: Rufen Sie `close()` auf, wenn Sie fertig sind.

Der Schalter für die effektive Rolle ist kein RLS-Tester: Er ändert lediglich, welche Studio-Ansichten die Navigation auflistet, sendet nichts an den Server und evaluiert keine Richtlinien. `useBuildEffectiveRoleController`, womit ein solcher erstellt wurde, ist veraltet und gibt beim Aufruf eine einmalige Warnung aus: `<Rebase>` erstellt einen eigenen Controller, wenn keiner übergeben wird, und Simulate access ist der vorgesehene Weg, um zu testen, was eine Rolle tun kann.

## Nächste Schritte

- **[Backend-Authentifizierung](/docs/backend/authentication)** — JWT, OAuth-Provider, SMTP-Konfiguration
- **[Row-Level Security](/docs/collections/security-rules)** — Zugriffskontrolle auf Zeilenebene pro Tabelle
- **[Typisierte SDK-Authentifizierung](/docs/sdk/authentication)** — Programmatische Authentifizierungsmethoden
