---
sourceHash: ab3cdcadbf2894f9
title: Il tuo provider di autenticazione
sidebar_label: Il tuo provider di autenticazione
description: "Autenticazione dell'SDK Rebase con un provider personalizzato — Clerk, Firebase Auth o una sessione esistente — tramite un getter di token, su HTTP e sul socket realtime."
---

Su 0.24 un getter di token autentica solo le richieste HTTP e il socket realtime
rimane anonimo.

Quando gli utenti accedono con un provider personalizzato (Clerk, Firebase Auth o
una sessione già presente nell'app), `client.auth` non viene coinvolto. Fornisci
invece al client un getter per il token del provider. Viene interpellato ogni volta
che è necessario un token: per ogni richiesta HTTP e ogni volta che il socket
realtime si autentica.

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

- Il getter ha la priorità sulla sessione del client stesso. Quando restituisce
  `null` o genera un'eccezione, il client invia il token che possiede, se presente:
  quello della sua sessione, uno impostato con `client.setToken()` o l'opzione
  `token`.
- L'opzione `token` viene letta ogni volta che è necessario un token, finché
  `setToken()` o un accesso non la sostituisce, quindi può essere dichiarata come
  getter (`get token() { return currentToken; }`).
- `setOnUnauthorized` copre un errore 401 su HTTP e un errore di autenticazione sul
  socket, e sostituisce il refresh della sessione proprio del client.

Il backend deve verificare il token del provider: vedi
[Adapter di autenticazione personalizzati](/docs/backend/auth-adapters). Nel pannello
di amministrazione, imposta il getter sul client che passi a `<Rebase client>`
([Il tuo provider di autenticazione](/docs/frontend/authentication#your-own-auth-provider)).
