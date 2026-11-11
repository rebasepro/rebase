---
sourceHash: 96c18e52b3f61548
title: Connexion par appareil
sidebar_label: Connexion par appareil
description: "Permettez à un terminal ou à un autre appareil sans navigateur de se connecter via un autre appareil : un code court, un lien et une approbation par un utilisateur connecté. Le flux d'autorisation d'appareil de la RFC 8628, tel qu'utilisé par rebase cloud login."
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un terminal, une application pour téléviseur ou un script ne disposent pas de leur propre navigateur, et y saisir un mot de passe est la chose à éviter. La connexion par appareil délègue le travail à un navigateur où la personne est déjà connectée : l'appareil affiche un code court et un lien, la personne l'approuve à cet endroit, et l'appareil reçoit une session en réponse. Cela suit la RFC 8628, le flux d'autorisation d'appareil OAuth 2.0 (Device Authorization Grant) ; c'est ainsi que `rebase cloud login` se connecte à Rebase Cloud.

```ts
auth: {
    deviceLogin: { verificationUrl: "https://app.example.com/device" }
}
```

`verificationUrl` est une page de votre application. Elle est ouverte avec le code sous la forme `?code=BCDF-GHJK`, et en tant qu'utilisateur connecté, elle affiche en quoi consiste la demande et l'approuve ou la refuse :

```ts
const request = await client.auth.describeDeviceLogin(code);   // device name, IP, status
await client.auth.approveDeviceLogin(request.userCode);        // or denyDeviceLogin
```

L'appareil démarre et effectue un sondage (polling) :

```ts
const { deviceCode, userCode, verificationUriComplete, interval } = await client.auth.startDeviceLogin({ clientName: "My CLI on laptop" });
// show userCode and verificationUriComplete, then every `interval` seconds:
const result = await client.auth.pollDeviceLogin(deviceCode);
// { status: "pending" | "slow_down", interval } | { status: "denied" } | { status: "expired" }
// | { status: "approved", user, accessToken, refreshToken }: this client is now signed in
```

Un appareil effectue le sondage dans une boucle comme celle-ci :

```typescript
const start = await client.auth.startDeviceLogin({ clientName: "My CLI on laptop" });
console.log(`Open ${start.verificationUriComplete} and check the code ${start.userCode}`);

let interval = start.interval;
for (;;) {
    await new Promise(resolve => setTimeout(resolve, interval * 1000));
    const result = await client.auth.pollDeviceLogin(start.deviceCode);
    if (result.status === "approved") break;          // signed in; the session is stored
    if (result.status === "denied" || result.status === "expired") throw new Error(result.status);
    interval = result.interval;                       // "pending", or "slow_down" with a longer one
}
```

Ce qui garantit sa sécurité :

- **L'approbation nécessite une session active**, et l'appareil obtient ce compte. Affichez le code, le nom de l'appareil et l'origine de la demande sur la page, et indiquez de n'approber qu'un code affiché par le propre appareil de la personne : l'attaque contre ce flux consiste en un inconnu envoyant un lien à quelqu'un pour faire approuver l'appareil de cet inconnu.
- **Le second facteur est reporté.** Un compte avec un facteur vérifié ne peut approuver qu'à partir d'une session `aal2`, et la session de l'appareil a le même niveau que la session qui l'a approuvée.
- **Dix minutes, décision unique, délivrance unique.** Le code de l'appareil est stocké sous forme hachée, dans `rebase.auth_device_logins`, fermé au rôle RLS.
- **Sondage cadencé.** Un appareil qui effectue des requêtes plus rapidement que son intervalle reçoit une réponse `slow_down` et son intervalle augmente de cinq secondes.
- Le sondage renvoie toujours la session dans le corps de la réponse, peu importe la valeur de `cookieAuth` : un appareil n'a pas de gestionnaire de cookies.

Les routes sont `POST /auth/device`, `POST /auth/device/token`, `GET /auth/device/:code`, `POST /auth/device/approve` et `POST /auth/device/deny`. `/auth/config` renvoie `deviceLogin: true` lorsqu'il est actif.

À suivre : le reste des [options `auth`](/docs/backend/authentication/), l'[index des endpoints](/docs/backend/endpoints/) et les [codes d'erreur](/docs/backend/errors/) renvoyés par les routes d'approbation, ainsi que [`rebase cloud login`](/docs/cli/cloud/), qui se connecte de cette manière.
