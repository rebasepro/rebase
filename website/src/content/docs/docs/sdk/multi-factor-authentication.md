---
title: Multi-Factor Authentication
sidebar_label: Multi-Factor Authentication
description: "TOTP factors with the Rebase SDK: enrolling one, the second step of a sign-in, recovery codes, and removing a factor."
---

TOTP factors — an authenticator app — plus the challenge that raises a session
from `aal1` to `aal2`.

## Enrolling a factor

```typescript
const { factor, totp, recoveryCodes } = await client.auth.mfa.enroll({
    friendlyName: "Phone"
});

showQrCode(totp.uri);        // otpauth://… — what the authenticator scans
if (recoveryCodes) showRecoveryCodes(recoveryCodes);
```

**Show the recovery codes once and never again.** Only their hashes are stored,
so nothing can display them later. They come with the account's first factor.
Adding another factor keeps the codes the account already has, and
`recoveryCodes` is `null`. Starting an enrolment and abandoning it never touches
them.

To replace them, after using several or losing the printout, call
`regenerateRecoveryCodes()` from an `aal2` session. The old codes stop working:

```typescript
const { recoveryCodes } = await client.auth.mfa.regenerateRecoveryCodes();
```

Someone who lost both the authenticator and the codes is let back in by an
administrator: `client.admin.resetMfa(uid)` (`DELETE /api/admin/users/:uid/mfa`,
`users:write`) removes the account's factors and codes and ends its sessions,
so the password signs in again without a second factor. On 0.23 every enrolment
returns a new set of codes that replaces the old one, and neither
`regenerateRecoveryCodes()` nor `resetMfa` exists.

The factor is not usable until the user proves their authenticator produced a
code from that secret:

```typescript
await client.auth.mfa.verify(factor.id, "418293");
```

## Signing in with MFA

A sign-in against an MFA-enrolled account returns no session. It is refused
with `401 MFA_REQUIRED`, and the error's `details` carry an `mfaToken` and the
account's verified `factors`. Pass that token to `challenge` and
`verifyChallenge` to get the session:

```typescript
import { RebaseApiError } from "@rebasepro/client";

type MfaRequired = {
    mfaToken: string;
    factors: { id: string; factorType: string; friendlyName?: string }[];
};

try {
    await client.auth.signInWithEmail(email, password);
} catch (e) {
    if (!(e instanceof RebaseApiError) || e.code !== "MFA_REQUIRED") throw e;
    const { mfaToken, factors } = e.details as MfaRequired;

    const { challengeId } = await client.auth.mfa.challenge(factors[0].id, { mfaToken });

    // A TOTP code, or one of the recovery codes.
    const { user } = await client.auth.mfa.verifyChallenge(challengeId, "418293", { mfaToken });
}
```

The `mfaToken` is sent on those two requests only, never installed on the
client. `verifyChallenge` mints the `aal2` session, this client adopts it, and
it emits `SIGNED_IN` like any other sign-in. The `mfaToken` expires five minutes
after the sign-in that returned it, and a challenge five minutes after it was
opened. A challenge that has been guessed at its limit stays spent for the rest
of its life — otherwise one open challenge is unlimited guesses at six digits.

Without `mfaToken`, the two calls step up the session this client already
holds from `aal1` to `aal2`.

## Removing a factor

```typescript
await client.auth.mfa.unenroll(factorId);
```

Once a factor is verified this requires an `aal2` session, so a stolen `aal1`
token cannot turn MFA off; an unfinished first enrolment is removed from any
session. Removing the last verified factor also discards the recovery codes.

## Next Steps

- **[Authentication](/docs/sdk/authentication/)** — Sign-in, sessions and the rest of `client.auth`
- **[Auth endpoints](/docs/backend/auth-endpoints/#multi-factor-authentication-totp)** — The HTTP routes behind enrolment and the challenge
