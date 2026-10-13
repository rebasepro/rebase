---
sourceHash: 0e00ae18684830bb
title: "Autenticazione a più fattori (MFA)"
sidebar_label: "Autenticazione a più fattori (MFA)"
---

Fattori TOTP — un'app di autenticazione — più la richiesta di verifica (challenge) che eleva una sessione da `aal1` a `aal2`.

## Registrazione di un fattore

```typescript
const { factor, totp, recoveryCodes } = await client.auth.mfa.enroll({
    friendlyName: "Phone"
});

showQrCode(totp.uri);        // otpauth://… — what the authenticator scans
if (recoveryCodes) showRecoveryCodes(recoveryCodes);
```

**Mostra i codici di recupero una sola volta e mai più.** Vengono memorizzati solo i relativi hash, quindi nulla potrà mostrarli in seguito. Arrivano insieme al primo fattore dell'account.
Aggiungere un altro fattore mantiene i codici che l'account già possiede, e
`recoveryCodes` è `null`. Avviare una registrazione e abbandonarla non li
tocca mai.

Per sostituirli, dopo averne usati diversi o aver perso la copia stampata,
chiama `regenerateRecoveryCodes()` da una sessione `aal2`. I vecchi codici
smettono di funzionare:

```typescript
const { recoveryCodes } = await client.auth.mfa.regenerateRecoveryCodes();
```

Chi ha perso sia l'autenticatore che i codici viene fatto rientrare da un
amministratore: `client.admin.resetMfa(uid)` (`DELETE /api/admin/users/:uid/mfa`,
`users:write`) rimuove i fattori e i codici dell'account e termina le sue
sessioni, cosicché la password effettua di nuovo l'accesso senza un secondo
fattore. Sulla 0.23 ogni registrazione restituisce un nuovo insieme di codici
che sostituisce il precedente, e non esistono né `regenerateRecoveryCodes()`
né `resetMfa`.

Il fattore non è utilizzabile finché l'utente non dimostra che il proprio autenticatore ha generato un codice a partire da quel segreto:

```typescript
await client.auth.mfa.verify(factor.id, "418293");
```

## Accesso con MFA

L'accesso a un account con MFA registrata non restituisce alcuna sessione. Viene rifiutato con `401 MFA_REQUIRED`, e i `details` dell'errore contengono un `mfaToken` e i `factors` verificati dell'account. Passa quel token a `challenge` e `verifyChallenge` per ottenere la sessione:

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

Il `mfaToken` viene inviato solo con queste due richieste e non viene mai installato sul client. `verifyChallenge` genera la sessione `aal2`, questo client la adotta ed emette `SIGNED_IN` come per qualsiasi altro accesso. Il `mfaToken` scade cinque minuti dopo l'accesso che lo ha restituito, e un challenge cinque minuti dopo la sua apertura. Un challenge che ha raggiunto il limite massimo di tentativi rimane esaurito per il resto della sua validità — altrimenti un challenge aperto consentirebbe tentativi illimitati di indovinare le sei cifre.

Senza `mfaToken`, le due chiamate elevano la sessione che questo client possiede già da `aal1` ad `aal2`.

## Rimozione di un fattore

```typescript
await client.auth.mfa.unenroll(factorId);
```

Una volta che un fattore è verificato, richiede una sessione `aal2`, in modo che un token `aal1` sottratto non possa disattivare l'MFA; una prima registrazione non completata viene rimossa da qualsiasi sessione. La rimozione dell'ultimo fattore verificato elimina anche i codici di recupero.
