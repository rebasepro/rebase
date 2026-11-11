---
title: Device sign-in
sidebar_label: Device sign-in
description: "Let a terminal or another device without a browser sign in through one: a short code, a link, and an approval by a signed-in user. RFC 8628's device authorization grant, as rebase cloud login uses it."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

A terminal, a TV app or a script has no browser of its own, and typing a
password into one is the thing to avoid. Device sign-in hands the work to a
browser where the person is already signed in: the device shows a short code
and a link, the person approves it there, and the device is answered with a
session. It follows RFC 8628, the OAuth 2.0 device authorization grant; it is
how `rebase cloud login` signs in to Rebase Cloud.

```ts
auth: {
    deviceLogin: { verificationUrl: "https://app.example.com/device" }
}
```

`verificationUrl` is a page of your app. It is opened with the code as
`?code=BCDF-GHJK`, and as the signed-in user it shows what the request is and
approves or denies it:

```ts
const request = await client.auth.describeDeviceLogin(code);   // device name, IP, status
await client.auth.approveDeviceLogin(request.userCode);        // or denyDeviceLogin
```

The device starts and polls:

```ts
const { deviceCode, userCode, verificationUriComplete, interval } = await client.auth.startDeviceLogin({ clientName: "My CLI on laptop" });
// show userCode and verificationUriComplete, then every `interval` seconds:
const result = await client.auth.pollDeviceLogin(deviceCode);
// { status: "pending" | "slow_down", interval } | { status: "denied" } | { status: "expired" }
// | { status: "approved", user, accessToken, refreshToken }: this client is now signed in
```

A device polls in a loop like this one:

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

What keeps it safe:

- **Approving takes a live session**, and the device gets that account. Show
  the code, the device's name and where it asked from on the page, and say to
  approve only a code the person's own device shows: the attack on this grant
  is a stranger sending someone a link to approve the stranger's device.
- **The second factor carries over.** An account with a verified factor can
  only approve from an `aal2` session, and the device's session has the level
  of the session that approved it.
- **Ten minutes, decided once, handed out once.** The device code is stored
  hashed, in `rebase.auth_device_logins`, closed to the RLS role.
- **Paced polling.** A device that polls faster than its interval is answered
  `slow_down` and its interval grows by five seconds.
- The poll always answers the session in the body, whatever `cookieAuth` says:
  a device has no cookie jar.

The routes are `POST /auth/device`, `POST /auth/device/token`,
`GET /auth/device/:code`, `POST /auth/device/approve` and
`POST /auth/device/deny`. `/auth/config` reports `deviceLogin: true` while it is
on.

Next: the rest of the [`auth` options](/docs/backend/authentication/), the
[endpoint index](/docs/backend/endpoints/) and the [error codes](/docs/backend/errors/)
the approval routes answer, and [`rebase cloud login`](/docs/cli/cloud/), which
signs in this way.
