---
sourceHash: 07ccdb7d3bcc566d
title: Seu Próprio Provedor de Autenticação
sidebar_label: Seu Próprio Provedor de Autenticação
description: "Autenticando o SDK do Rebase com um provedor próprio — Clerk, Firebase Auth ou uma sessão existente — por meio de um getter de token, via HTTP e socket em tempo real."
---

Quando os usuários fazem login com um provedor próprio (Clerk, Firebase Auth ou uma sessão que seu aplicativo já possui), o `client.auth` não é envolvido. Em vez disso, forneça ao cliente um getter para o token do provedor. Ele é chamado sempre que um token for necessário: para cada requisição HTTP e sempre que o socket em tempo real se autenticar.

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

- O getter tem precedência sobre a própria sessão do cliente. Quando ele retorna `null` ou lança um erro, o cliente envia o token que possui, se houver: o de sua sessão, um definido com `client.setToken()` ou a opção `token`.
- A opção `token` é lida sempre que um token for necessário, até que `setToken()` ou um login o substitua, portanto, ela pode ser declarada como um getter (`get token() { return currentToken; }`).
- O `setOnUnauthorized` cobre erros 401 via HTTP e erros de autenticação no socket, substituindo a própria atualização de sessão do cliente.

O backend precisa verificar o token do provedor: consulte [Adaptadores de autenticação personalizados](/docs/backend/auth-adapters). No painel de administração, defina o getter no cliente passado para `<Rebase client>` ([Seu Próprio Provedor de Autenticação](/docs/frontend/authentication#your-own-auth-provider)).
