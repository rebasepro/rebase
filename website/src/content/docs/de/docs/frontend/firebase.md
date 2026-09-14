---
sourceHash: 3e18de6e2b935fc7
title: Firebase
sidebar_label: Firebase
description: "@rebasepro/firebase führt Rebase CMS mit Firestore, Firebase Auth und Firebase Storage aus – ein clientseitiger Adapter ohne Beteiligung eines Rebase-Servers."
---

`@rebasepro/firebase` bindet Rebase CMS an Firebase an. Deine
Collections beschreiben Firestore-Dokumente, und das Panel liest und schreibt sie
über das Firebase-SDK.

:::caution[Experimentell und strukturell anders als der Rest von Rebase]
Dies ist ein **clientseitiger Adapter**. Es ist kein Rebase-Server beteiligt: Der
Browser kommuniziert direkt mit Firebase, sodass alles, was das Rebase-Backend bereitstellt –
Row-Level Security, die REST-API, das generierte SDK, Functions, Crons, das
Storage-Zugriffsmodell –, nicht Teil dieses Setups ist.

Die Autorisierung erfolgt über **Firebase Security Rules**, die in Firebase geschrieben und bereitgestellt werden.
Rebase-eigene `securityRules` für eine Collection greifen hier nicht.
:::

## Installation

```bash
pnpm add @rebasepro/firebase firebase
```

Peer Dependencies: `firebase` (10, 11 oder 12), `react` ≥ 19, `react-dom` ≥ 19 und
optional `typesense` für die Textsuche.

## Was es bietet

- **`RebaseFirebaseApp`** – eine vollständige Admin-App: Firebase Auth-Login, Routing
  und CRUD-Operationen für Firestore, basierend auf deinen Collection-Definitionen.
- **Hooks pro Dienst** – Auth, Firestore, Storage, App Check, Benutzerverwaltung.
- **Adapter für die Textsuche** – Algolia, Typesense, Pinecone oder lokal.

```tsx title="src/App.tsx" no-verify
import { RebaseFirebaseApp } from "@rebasepro/firebase";

export default function App() {
    return <RebaseFirebaseApp
        name="My Project"
        firebaseConfig={firebaseConfig}
        collections={[posts, authors]}
    />;
}
```

Ein funktionierendes Beispiel befindet sich in [`examples/firebase`](https://github.com/rebasepro/rebase/tree/main/examples/firebase).

## Was nicht übernommen wird

Alles auf dieser Website, was das Rebase-**Backend** beschreibt, bezieht sich auf den
PostgreSQL- (oder MongoDB-) Pfad, nicht auf diesen:

| | |
|---|---|
| Row-Level Security | Stattdessen Firebase Security Rules, geschrieben in Firebase |
| REST-API und generiertes SDK | Nicht vorhanden – der Browser nutzt das Firebase-SDK |
| Functions und Crons | Stattdessen Cloud Functions for Firebase |
| Storage-Zugriffsmodell | Stattdessen Firebase Storage-Regeln |
| Studio, `rls-check`, Migrationen | Postgres-Funktionen; nicht anwendbar |

## Wann dieser Ansatz sinnvoll ist

Wähle diese Option, wenn du bereits ein Firebase-Projekt hast und ein besseres Admin-Panel
dafür benötigst. Wenn du dich erst für ein Backend entscheidest, anstatt ein bestehendes
anzubinden, ist der [PostgreSQL-Pfad](/docs/getting-started/quickstart/) derjenige, um den es
im Rest dieser Dokumentation geht.

## Verwandte Themen

- [Frontend-Setup](/docs/frontend/) – das Panel, dessen Datenschicht hierdurch ersetzt wird
- [Authentifizierung & Login](/docs/frontend/authentication/) – die Anmeldeoberfläche in beiden Fällen
- [Collections definieren](/docs/collections/) – die Collection-Struktur, die von beiden Treibern gelesen wird
