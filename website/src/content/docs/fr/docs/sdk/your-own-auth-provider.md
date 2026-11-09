---
sourceHash: 07ccdb7d3bcc566d
title: Votre propre fournisseur d'authentification
sidebar_label: Votre propre fournisseur d'authentification
description: "Authentifier le SDK Rebase avec votre propre fournisseur — Clerk, Firebase Auth ou une session existante — via un getter de token, sur HTTP et le socket temps réel."
---

Lorsque les utilisateurs se connectent avec votre propre fournisseur (Clerk, Firebase Auth ou une session déjà existante dans votre application), `client.auth` n'intervient pas. Fournissez plutôt au client un getter pour le token du fournisseur. Il est sollicité chaque fois qu'un token est nécessaire : pour chaque requête HTTP et chaque fois que le socket temps réel s'authentifie.

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

- Le getter a la priorité sur la propre session du client. Lorsqu'il renvoie `null` ou lève une exception, le client envoie le token dont il dispose, le cas échéant : celui de sa session, un token défini avec `client.setToken()` ou l'option `token`.
- L'option `token` est lue chaque fois qu'un token est nécessaire, jusqu'à ce que `setToken()` ou une connexion la remplace ; elle peut donc être déclarée sous la forme d'un getter (`get token() { return currentToken; }`).
- `setOnUnauthorized` prend en charge les erreurs 401 sur HTTP ainsi que les erreurs d'authentification sur le socket, et remplace le rafraîchissement de session propre au client.

Le backend doit vérifier le token du fournisseur : voir [Adaptateurs d'authentification personnalisés](/docs/backend/auth-adapters). Dans le panneau d'administration, configurez le getter sur le client que vous transmettez à `<Rebase client>` ([Votre propre fournisseur d'authentification](/docs/frontend/authentication#your-own-auth-provider)).
