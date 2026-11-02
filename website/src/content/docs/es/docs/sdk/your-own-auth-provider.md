---
sourceHash: ab3cdcadbf2894f9
title: Tu propio proveedor de autenticación
sidebar_label: Tu propio proveedor de autenticación
description: "Autenticación del SDK de Rebase con un proveedor propio —Clerk, Firebase Auth o una sesión existente— a través de un getter de tokens, sobre HTTP y el socket en tiempo real."
---

En 0.24, un getter de tokens solo autentica peticiones HTTP, y el socket en tiempo real permanece anónimo.

Cuando los usuarios inician sesión con un proveedor propio (Clerk, Firebase Auth o una sesión que tu aplicación ya tenga), `client.auth` no interviene. En su lugar, proporciona al cliente un getter para el token del proveedor. Se solicita cada vez que se necesita un token: para cada petición HTTP y cada vez que el socket en tiempo real se autentica.

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

- El getter tiene prioridad sobre la propia sesión del cliente. Cuando devuelve `null` o lanza un error, el cliente envía el token que contiene, si tiene alguno: el de su sesión, uno establecido con `client.setToken()` o la opción `token`.
- La opción `token` se lee cada vez que se necesita un token, hasta que `setToken()` o un inicio de sesión la reemplacen, por lo que puede declararse como un getter (`get token() { return currentToken; }`).
- `setOnUnauthorized` cubre un 401 sobre HTTP y un error de autenticación en el socket, y reemplaza la propia actualización de sesión del cliente.

El backend debe verificar el token del proveedor: consulta [Adaptadores de autenticación personalizados](/docs/backend/auth-adapters). En el panel de administración, configura el getter en el cliente que pasas a `<Rebase client>` ([Tu propio proveedor de autenticación](/docs/frontend/authentication#your-own-auth-provider)).
