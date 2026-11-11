---
sourceHash: 96c18e52b3f61548
title: Accesso da dispositivo
sidebar_label: Accesso da dispositivo
description: "Consenti a un terminale o a un altro dispositivo senza browser di accedere tramite uno di essi: un codice breve, un link e l'approvazione di un utente autenticato. Il device authorization grant di RFC 8628, come utilizzato da rebase cloud login."
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

Un terminale, un'app per TV o uno script non dispongono di un proprio browser, e digitare una password al loro interno è una cosa da evitare. L'accesso da dispositivo delega il lavoro a un browser in cui l'utente ha già effettuato l'accesso: il dispositivo mostra un codice breve e un link, la persona lo approva da lì e al dispositivo viene restituita una sessione. Segue l'RFC 8628, l'OAuth 2.0 device authorization grant; è il modo in cui `rebase cloud login` accede a Rebase Cloud.

```ts
auth: {
    deviceLogin: { verificationUrl: "https://app.example.com/device" }
}
```

`verificationUrl` è una pagina della tua applicazione. Viene aperta con il codice come `?code=BCDF-GHJK` e, con l'utente autenticato, mostra i dettagli della richiesta e la approva o la rifiuta:

```ts
const request = await client.auth.describeDeviceLogin(code);   // device name, IP, status
await client.auth.approveDeviceLogin(request.userCode);        // or denyDeviceLogin
```

Il dispositivo avvia la procedura ed esegue il polling:

```ts
const { deviceCode, userCode, verificationUriComplete, interval } = await client.auth.startDeviceLogin({ clientName: "My CLI on laptop" });
// show userCode and verificationUriComplete, then every `interval` seconds:
const result = await client.auth.pollDeviceLogin(deviceCode);
// { status: "pending" | "slow_down", interval } | { status: "denied" } | { status: "expired" }
// | { status: "approved", user, accessToken, refreshToken }: this client is now signed in
```

Un dispositivo esegue il polling in un ciclo come questo:

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

Cosa garantisce la sicurezza:

- **L'approvazione richiede una sessione attiva** e il dispositivo ottiene quell'account. Mostra sulla pagina il codice, il nome del dispositivo e la provenienza della richiesta, e specifica di approvare solo un codice visualizzato sul dispositivo dell'utente stesso: l'attacco tipico contro questo grant consiste in un malintenzionato che invia a qualcuno un link per approvare il dispositivo del malintenzionato.
- **Il secondo fattore viene ereditato.** Un account con un fattore verificato può approvare solo da una sessione `aal2`, e la sessione del dispositivo riceve lo stesso livello della sessione che l'ha approvata.
- **Dieci minuti, deciso una sola volta, rilasciato una sola volta.** Il codice del dispositivo viene memorizzato tramite hash in `rebase.auth_device_logins`, inaccessibile al ruolo RLS.
- **Polling cadenzato.** Se un dispositivo esegue il polling più rapidamente del suo intervallo, riceve la risposta `slow_down` e il suo intervallo aumenta di cinque secondi.
- Il polling restituisce sempre la sessione nel body, indipendentemente dall'impostazione di `cookieAuth`: un dispositivo non dispone di un cookie jar.

Le route sono `POST /auth/device`, `POST /auth/device/token`, `GET /auth/device/:code`, `POST /auth/device/approve` e `POST /auth/device/deny`. `/auth/config` restituisce `deviceLogin: true` quando la funzionalità è attiva.

Passaggi successivi: le altre [opzioni di `auth`](/docs/backend/authentication/), l'[indice degli endpoint](/docs/backend/endpoints/) e i [codici di errore](/docs/backend/errors/) restituiti dalle route di approvazione, e [`rebase cloud login`](/docs/cli/cloud/), che effettua l'accesso in questo modo.
