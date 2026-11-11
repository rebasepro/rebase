---
sourceHash: 96c18e52b3f61548
title: Geräte-Anmeldung
sidebar_label: Geräte-Anmeldung
description: "Ermöglicht einem Terminal oder einem anderen Gerät ohne Browser die Anmeldung über einen Browser: ein kurzer Code, ein Link und die Bestätigung durch einen angemeldeten Benutzer. RFC 8628 Device Authorization Grant, wie er von rebase cloud login verwendet wird."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein Terminal, eine TV-App oder ein Skript verfügt über keinen eigenen Browser,
und das Eintippen eines Passworts sollte dort vermieden werden. Die Geräte-Anmeldung
überträgt diesen Schritt an einen Browser, in dem die Person bereits angemeldet
ist: Das Gerät zeigt einen kurzen Code sowie einen Link an, die Person bestätigt
die Anfrage dort, und das Gerät erhält als Antwort eine Sitzung. Dies folgt
RFC 8628, dem OAuth 2.0 Device Authorization Grant; genau so meldet sich
`rebase cloud login` bei Rebase Cloud an.

```ts
auth: {
    deviceLogin: { verificationUrl: "https://app.example.com/device" }
}
```

`verificationUrl` ist eine Seite Ihrer Anwendung. Sie wird mit dem Code als
`?code=BCDF-GHJK` geöffnet und zeigt als angemeldeter Benutzer an, worum es sich
bei der Anfrage handelt, und bestätigt diese oder lehnt sie ab:

```ts
const request = await client.auth.describeDeviceLogin(code);   // device name, IP, status
await client.auth.approveDeviceLogin(request.userCode);        // or denyDeviceLogin
```

Das Gerät startet und führt Polling durch:

```ts
const { deviceCode, userCode, verificationUriComplete, interval } = await client.auth.startDeviceLogin({ clientName: "My CLI on laptop" });
// show userCode and verificationUriComplete, then every `interval` seconds:
const result = await client.auth.pollDeviceLogin(deviceCode);
// { status: "pending" | "slow_down", interval } | { status: "denied" } | { status: "expired" }
// | { status: "approved", user, accessToken, refreshToken }: this client is now signed in
```

Ein Gerät führt das Polling in einer Schleife wie dieser durch:

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

Was die Sicherheit gewährleistet:

- **Die Bestätigung erfordert eine aktive Sitzung**, und das Gerät erhält dieses
  Konto. Zeigen Sie den Code, den Namen des Geräts und den Ursprungsort der Anfrage
  auf der Seite an und weisen Sie darauf hin, nur Codes zu bestätigen, die das
  eigene Gerät der Person anzeigt: Der Angriffsvektor bei diesem Grant besteht darin,
  dass ein Fremder jemandem einen Link sendet, um das Gerät des Fremden zu autorisieren.
- **Der zweite Faktor wird übertragen.** Ein Konto mit einem verifizierten Faktor
  kann nur aus einer `aal2`-Sitzung heraus bestätigen, und die Sitzung des Geräts
  erhält das Sicherheitslevel der Sitzung, die sie bestätigt hat.
- **Zehn Minuten, einmal entschieden, einmal ausgegeben.** Der Geräte-Code wird
  gehasht in `rebase.auth_device_logins` gespeichert, gesperrt für die RLS-Rolle.
- **Gedrosseltes Polling (Paced Polling).** Ein Gerät, das schneller pollt als
  sein Intervall erlaubt, erhält als Antwort `slow_down`, und sein Intervall
  verlängert sich um fünf Sekunden.
- Das Polling liefert die Sitzung immer im Body zurück, unabhängig von den
  Einstellungen für `cookieAuth`: Ein Gerät verfügt über keinen Cookie-Speicher (Cookie Jar).

Die Routen lauten `POST /auth/device`, `POST /auth/device/token`,
`GET /auth/device/:code`, `POST /auth/device/approve` und
`POST /auth/device/deny`. `/auth/config` meldet `deviceLogin: true`, solange es
aktiviert ist.

Weiteres: die restlichen [`auth`-Optionen](/docs/backend/authentication/), der
[Endpunkt-Index](/docs/backend/endpoints/) und die [Fehlercodes](/docs/backend/errors/),
die von den Bestätigungsrouten zurückgegeben werden, sowie [`rebase cloud login`](/docs/cli/cloud/),
das sich auf diese Weise anmeldet.
