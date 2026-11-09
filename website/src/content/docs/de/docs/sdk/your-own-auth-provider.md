---
sourceHash: 07ccdb7d3bcc566d
title: Eigener Auth-Provider
sidebar_label: Eigener Auth-Provider
description: "Authentifizierung des Rebase SDK mit einem eigenen Provider – Clerk, Firebase Auth oder einer bestehenden Session – über einen Token-Getter, über HTTP und den Realtime-Socket."
---

Wenn sich Benutzer mit einem eigenen Provider anmelden (Clerk, Firebase Auth oder einer Session, die Ihre App bereits hat), ist `client.auth` nicht beteiligt. Übergeben Sie dem Client stattdessen einen Getter für das Token des Providers. Dieser wird jedes Mal aufgerufen, wenn ein Token benötigt wird: bei jeder HTTP-Anfrage und jedes Mal, wenn sich der Realtime-Socket authentifiziert.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));

// Optional: let Clerk recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await clerk.session?.reload();
    return true;
});

// The socket authenticates as the Clerk user.
client.data.posts.listen({}, (response) => render(response.data));
```

- Der Getter hat Vorrang vor der client-eigenen Session. Wenn er `null` zurückgibt oder einen Fehler wirft, sendet der Client das Token, das er hält (sofern vorhanden): das seiner Session, eines, das mit `client.setToken()` gesetzt wurde, oder die `token`-Option.
- Die `token`-Option wird jedes Mal gelesen, wenn ein Token benötigt wird, bis `setToken()` oder eine Anmeldung sie ersetzt. Sie kann daher als Getter deklariert werden (`get token() { return currentToken; }`).
- `setOnUnauthorized` deckt einen 401-Fehler über HTTP sowie einen Authentifizierungsfehler auf dem Socket ab und ersetzt den client-eigenen Session-Refresh.

Das Backend muss das Token des Providers verifizieren: siehe [Benutzerdefinierte Auth-Adapter](/docs/backend/auth-adapters). Setzen Sie im Admin-Panel den Getter auf dem Client, den Sie an `<Rebase client>` übergeben ([Eigener Auth-Provider](/docs/frontend/authentication#your-own-auth-provider)).
