---
title: Your Own Auth Provider
sidebar_label: Your Own Auth Provider
description: "Authenticating the Rebase SDK with a provider of your own — Clerk, Firebase Auth or an existing session — through a token getter, over HTTP and the realtime socket."
---

When users sign in with a provider of your own (Clerk, Firebase Auth, or a
session your app already has), `client.auth` is not involved. Give the client a
getter for the provider's token instead. It is asked each time a token is
needed: for every HTTP request, and every time the realtime socket
authenticates.

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

- The getter wins over the client's own session. When it answers `null` or
  throws, the client sends the token it holds, if any: its session's, one set
  with `client.setToken()`, or the `token` option.
- The `token` option is read each time a token is needed, until `setToken()` or
  a sign-in replaces it, so it may be declared as a getter
  (`get token() { return currentToken; }`).
- `setOnUnauthorized` covers a 401 over HTTP and an auth error on the socket,
  and replaces the client's own session refresh.

The backend has to verify the provider's token: see
[Custom auth adapters](/docs/backend/auth-adapters). In the admin panel, set
the getter on the client you pass to `<Rebase client>`
([Your Own Auth Provider](/docs/frontend/authentication#your-own-auth-provider)).
