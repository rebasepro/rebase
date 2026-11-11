---
sourceHash: 96c18e52b3f61548
title: Login por dispositivo
sidebar_label: Login por dispositivo
description: "Permita que um terminal ou outro dispositivo sem navegador faça login por meio de um: um código curto, um link e uma aprovação por um usuário autenticado. O grant de autorização de dispositivo da RFC 8628, como o rebase cloud login o utiliza."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Um terminal, um aplicativo de TV ou um script não tem navegador próprio, e digitar
uma senha neles é algo a ser evitado. O login por dispositivo transfere esse trabalho
para um navegador onde a pessoa já está conectada: o dispositivo exibe um código curto
e um link, a pessoa o aprova lá, e o dispositivo recebe uma sessão em resposta.
Ele segue a RFC 8628, o grant de autorização de dispositivo do OAuth 2.0; é como o
`rebase cloud login` faz login no Rebase Cloud.

```ts
auth: {
    deviceLogin: { verificationUrl: "https://app.example.com/device" }
}
```

`verificationUrl` é uma página da sua aplicação. Ela é aberta com o código como
`?code=BCDF-GHJK` e, como o usuário conectado, mostra o que é a solicitação e a
aprova ou nega:

```ts
const request = await client.auth.describeDeviceLogin(code);   // device name, IP, status
await client.auth.approveDeviceLogin(request.userCode);        // or denyDeviceLogin
```

O dispositivo inicia e faz polling:

```ts
const { deviceCode, userCode, verificationUriComplete, interval } = await client.auth.startDeviceLogin({ clientName: "My CLI on laptop" });
// show userCode and verificationUriComplete, then every `interval` seconds:
const result = await client.auth.pollDeviceLogin(deviceCode);
// { status: "pending" | "slow_down", interval } | { status: "denied" } | { status: "expired" }
// | { status: "approved", user, accessToken, refreshToken }: this client is now signed in
```

Um dispositivo faz polling em um loop como este:

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

O que o mantém seguro:

- **A aprovação exige uma sessão ativa**, e o dispositivo obtém essa conta. Mostre
  o código, o nome do dispositivo e de onde a solicitação partiu na página, e oriente
  a aprovar apenas o código exibido pelo próprio dispositivo da pessoa: o ataque a
  esse grant consiste em um terceiro enviar a alguém um link para aprovar o dispositivo
  desse terceiro.
- **O segundo fator é mantido.** Uma conta com um fator verificado só pode aprovar a
  partir de uma sessão `aal2`, e a sessão do dispositivo terá o nível da sessão que a aprovou.
- **Dez minutos, decidido uma vez, entregue uma vez.** O código do dispositivo é
  armazenado com hash em `rebase.auth_device_logins`, fechado para a role de RLS.
- **Polling compassado.** Um dispositivo que faz polling mais rápido do que seu
  intervalo recebe `slow_down` como resposta e seu intervalo aumenta em cinco segundos.
- O polling sempre retorna a sessão no corpo da resposta, independentemente do que
  `cookieAuth` definir: um dispositivo não possui repositório de cookies (*cookie jar*).

As rotas são `POST /auth/device`, `POST /auth/device/token`,
`GET /auth/device/:code`, `POST /auth/device/approve` e
`POST /auth/device/deny`. O `/auth/config` informa `deviceLogin: true` enquanto estiver
ativado.

A seguir: o restante das [opções de `auth`](/docs/backend/authentication/), o
[índice de endpoints](/docs/backend/endpoints/) e os [códigos de erro](/docs/backend/errors/)
que as rotas de aprovação retornam, e o [`rebase cloud login`](/docs/cli/cloud/), que
faz login dessa forma.
