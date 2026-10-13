---
sourceHash: a67897c131d33a15
title: "Autenticación multifactor"
sidebar_label: "Autenticación multifactor"
description: "Factores TOTP con el SDK de Rebase: registrar uno, el segundo paso de un inicio de sesión, los códigos de recuperación y quitar un factor."
---

Factores TOTP — una aplicación de autenticación — más el desafío que eleva una sesión de `aal1` a `aal2`.

## Registrar un factor

```typescript
const { factor, totp, recoveryCodes } = await client.auth.mfa.enroll({
    friendlyName: "Phone"
});

showQrCode(totp.uri);        // otpauth://… — what the authenticator scans
if (recoveryCodes) showRecoveryCodes(recoveryCodes);
```

**Muestra los códigos de recuperación una sola vez y nunca más.** Solo se almacenan sus hashes, por lo que nada podrá mostrarlos más tarde. Vienen con el
primer factor de la cuenta. Añadir otro factor conserva los códigos que la
cuenta ya tiene, y `recoveryCodes` es `null`. Iniciar un registro y
abandonarlo nunca los toca.

Para reemplazarlos, después de usar varios o perder la copia impresa, llama a
`regenerateRecoveryCodes()` desde una sesión `aal2`. Los códigos antiguos dejan
de funcionar:

```typescript
const { recoveryCodes } = await client.auth.mfa.regenerateRecoveryCodes();
```

A quien haya perdido tanto el autenticador como los códigos, un administrador
puede dejarlo entrar de nuevo: `client.admin.resetMfa(uid)`
(`DELETE /api/admin/users/:uid/mfa`, `users:write`) elimina los factores y
códigos de la cuenta y termina sus sesiones, de modo que la contraseña vuelve
a iniciar sesión sin un segundo factor. En 0.23 cada registro devuelve un
nuevo conjunto de códigos que sustituye al anterior, y no existen ni
`regenerateRecoveryCodes()` ni `resetMfa`.

El factor no se puede utilizar hasta que el usuario demuestre que su aplicación de autenticación produjo un código a partir de ese secreto:

```typescript
await client.auth.mfa.verify(factor.id, "418293");
```

## Iniciar sesión con MFA

Un inicio de sesión contra una cuenta con MFA registrado no devuelve ninguna sesión. Se rechaza con `401 MFA_REQUIRED`, y los `details` del error incluyen un `mfaToken` y los `factors` verificados de la cuenta. Pasa ese token a `challenge` y `verifyChallenge` para obtener la sesión:

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

El `mfaToken` se envía solo en esas dos peticiones y nunca se instala en el cliente. `verifyChallenge` genera la sesión `aal2`, este cliente la adopta y emite `SIGNED_IN` como en cualquier otro inicio de sesión. El `mfaToken` expira cinco minutos después del inicio de sesión que lo devolvió, y un desafío cinco minutos después de abrirse. Un desafío que ha alcanzado su límite de intentos permanece inhabilitado durante el resto de su vida útil; de lo contrario, un desafío abierto permitiría intentos ilimitados para adivinar los seis dígitos.

Sin `mfaToken`, las dos llamadas elevan la sesión que este cliente ya tiene de `aal1` a `aal2`.

## Eliminar un factor

```typescript
await client.auth.mfa.unenroll(factorId);
```

Una vez que hay un factor verificado, esto requiere una sesión `aal2`, de modo que un token `aal1` robado no pueda desactivar MFA; una primera inscripción sin terminar se elimina desde cualquier sesión. Eliminar el último factor verificado también descarta los códigos de recuperación.
