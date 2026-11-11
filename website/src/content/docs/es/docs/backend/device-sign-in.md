---
sourceHash: 96c18e52b3f61548
title: Inicio de sesión en dispositivos
sidebar_label: Inicio de sesión en dispositivos
description: "Permite que una terminal u otro dispositivo sin navegador inicie sesión a través de uno: un código corto, un enlace y la aprobación de un usuario con sesión iniciada. La concesión de autorización de dispositivos de RFC 8628, tal como la utiliza rebase cloud login."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Una terminal, una aplicación de TV o un script no tienen un navegador propio, y
escribir una contraseña en ellos es algo que conviene evitar. El inicio de sesión
en dispositivos delega el trabajo a un navegador donde la persona ya ha iniciado
sesión: el dispositivo muestra un código corto y un enlace, la persona lo aprueba
allí y el dispositivo recibe una sesión como respuesta. Sigue el RFC 8628, la
concesión de autorización de dispositivos de OAuth 2.0; es como `rebase cloud login`
inicia sesión en Rebase Cloud.

```ts
auth: {
    deviceLogin: { verificationUrl: "https://app.example.com/device" }
}
```

`verificationUrl` es una página de tu aplicación. Se abre con el código como
`?code=BCDF-GHJK`, y como usuario con sesión iniciada muestra en qué consiste la
solicitud y la aprueba o deniega:

```ts
const request = await client.auth.describeDeviceLogin(code);   // device name, IP, status
await client.auth.approveDeviceLogin(request.userCode);        // or denyDeviceLogin
```

El dispositivo inicia y sondea:

```ts
const { deviceCode, userCode, verificationUriComplete, interval } = await client.auth.startDeviceLogin({ clientName: "My CLI on laptop" });
// show userCode and verificationUriComplete, then every `interval` seconds:
const result = await client.auth.pollDeviceLogin(deviceCode);
// { status: "pending" | "slow_down", interval } | { status: "denied" } | { status: "expired" }
// | { status: "approved", user, accessToken, refreshToken }: this client is now signed in
```

Un dispositivo sondea en un bucle como este:

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

Qué lo mantiene seguro:

- **Aprobar requiere una sesión activa**, y el dispositivo obtiene esa cuenta.
  Muestra el código, el nombre del dispositivo y desde dónde realizó la solicitud
  en la página, e indica que solo se apruebe un código que muestre el propio
  dispositivo de la persona: el vector de ataque en esta concesión consiste en
  que un extraño envíe a alguien un enlace para que apruebe el dispositivo de dicho
  extraño.
- **El segundo factor se transfiere.** Una cuenta con un factor verificado solo
  puede aprobar desde una sesión `aal2`, y la sesión del dispositivo tiene el nivel
  de la sesión que la aprobó.
- **Diez minutos, se decide una vez, se entrega una vez.** El código del
  dispositivo se almacena con hash en `rebase.auth_device_logins`, cerrado para
  el rol de RLS.
- **Sondeo con control de ritmo.** A un dispositivo que sondea más rápido que su
  intervalo se le responde con `slow_down` y su intervalo aumenta en cinco
  segundos.
- El sondeo siempre responde con la sesión en el cuerpo, independientemente de lo
  que indique `cookieAuth`: un dispositivo no tiene almacén de cookies (cookie jar).

Las rutas son `POST /auth/device`, `POST /auth/device/token`,
`GET /auth/device/:code`, `POST /auth/device/approve` y
`POST /auth/device/deny`. `/auth/config` reporta `deviceLogin: true` mientras está
activado.

A continuación: el resto de las [opciones de `auth`](/docs/backend/authentication/),
el [índice de endpoints](/docs/backend/endpoints/) y los [códigos de error](/docs/backend/errors/)
que responden las rutas de aprobación, y [`rebase cloud login`](/docs/cli/cloud/),
que inicia sesión de esta manera.
