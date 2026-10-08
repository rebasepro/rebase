---
title: Email verification
sidebar_label: Email verification
description: "How an account proves its email address: the link mailed at registration, what following it keeps and removes, and confirm-first registration with requireEmailVerification."
---

When email is configured, registering
mails the new account a verification link (`<frontend>/verify-email?token=…`, valid for 24 hours),
so the owner proves the address at sign-up, on their own terms. `POST /api/auth/send-verification`
mails it again. Nothing is mailed to the synthetic addresses of guests and X (Twitter) accounts.

The link proves the inbox, not who registered the address. Anyone can register
someone else's address with a password and ask for the link to be mailed, so
following it keeps only what the request also proves:

| Following the link with… | What happens |
|---|---|
| a live session of that account (`Authorization` header) | Verified. Nothing removed: only whoever registered the account can hold its session |
| the account's password (`POST`, `password`) | Verified, the password kept, an unvouched identity removed, and the caller signed in |
| neither | Verified, and the password and every unvouched identity removed, every session ended. `POST` asks first (`409 PROOF_REQUIRED`) unless `removeUnproven: true` |

So an owner who follows the link signed in, or types the password they chose,
keeps it; someone whose address a stranger registered verifies without it, and
the stranger's way in is gone. The response says `passwordRemoved` when it
removed one. The CMS asks for the password before verifying.

## Confirm-first registration

`auth.requireEmailVerification: true` (or `AUTH_REQUIRE_EMAIL_VERIFICATION=true`) changes two
things:

- `POST /api/auth/register` signs nobody in. It answers `200 { confirmationRequired: true }`
  whether or not the address already has an account, in the same time, so it
  does not tell anyone which addresses are registered. An existing account that
  never confirmed is mailed its link again; its password is not changed.
- `POST /api/auth/login` answers `403 EMAIL_NOT_CONFIRMED` for an unverified account,
  and only once the password is right, so the answer tells nobody but the
  password's holder that the address is unconfirmed. It mails the link again, at
  most once a minute.

The registrant follows the link and enters their password
(`POST /api/auth/verify-email { token, password }`), which verifies the address
and signs them in. With it off, which is the default, an address that already
has an account is answered `409 EMAIL_EXISTS`, as before.

To recover from a step-3 rejection, the user signs in with their existing
method and calls the explicit link endpoint:

```http
POST /api/auth/link/google
Authorization: Bearer <access token>

{ "idToken": "..." }
```

Linking while authenticated intentionally does **not** require a verified
email, and does not require the emails to match at all — a user's Google
address is often not their app address. The asymmetry is deliberate: on
sign-in the provider's email is the only evidence tying the incoming identity
to an account, whereas here the caller has already proven ownership by holding
a valid session. It returns `409 IDENTITY_ALREADY_LINKED` if that provider
identity belongs to another user, and is idempotent if it is already linked to
the caller.

#### The reverse direction

A user who signed up with Google and has no password:

- **Registering with the same email** is refused with `409 EMAIL_EXISTS`.
- **`POST /api/auth/change-password`** returns `400 INVALID_ACCOUNT` — there is
  no existing password to verify against.
- **`forgot-password` → `reset-password` is the supported way to add one.**
  It re-proves ownership of the address by email, after which the account has
  both sign-in methods.


## See also

- [Authentication](/docs/backend/authentication/): the auth configuration, OAuth
  account linking, and why a first proof of address removes what nobody proved.
- [Auth endpoints](/docs/backend/auth-endpoints/): `POST /api/auth/verify-email`
  and `POST /api/auth/send-verification` with the rest of the routes.
- [SDK authentication](/docs/sdk/authentication/#email-verification):
  `verifyEmail` and `signUp` from the client.
