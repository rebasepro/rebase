---
sourceHash: 0e00ae18684830bb
title: "Autenticação Multifator"
sidebar_label: "Autenticação Multifator"
---

Fatores TOTP — um aplicativo autenticador — mais o desafio que eleva uma sessão
de `aal1` para `aal2`.

## Cadastrando um fator

```typescript
const { factor, totp, recoveryCodes } = await client.auth.mfa.enroll({
    friendlyName: "Phone"
});

showQrCode(totp.uri);        // otpauth://… — what the authenticator scans
if (recoveryCodes) showRecoveryCodes(recoveryCodes);
```

**Exiba os códigos de recuperação uma única vez e nunca mais.** Apenas os hashes são armazenados,
portanto nada poderá exibi-los mais tarde. Eles vêm com o primeiro fator da conta.
Adicionar outro fator mantém os códigos que a conta já tem, e
`recoveryCodes` é `null`. Iniciar um cadastro e abandoná-lo nunca os afeta.

Para substituí-los, depois de usar vários ou perder a impressão, chame
`regenerateRecoveryCodes()` a partir de uma sessão `aal2`. Os códigos antigos deixam de funcionar:

```typescript
const { recoveryCodes } = await client.auth.mfa.regenerateRecoveryCodes();
```

Alguém que perdeu tanto o autenticador quanto os códigos é deixado entrar de volta por um
administrador: `client.admin.resetMfa(uid)` (`DELETE /api/admin/users/:uid/mfa`,
`users:write`) remove os fatores e códigos da conta e encerra suas sessões,
de modo que a senha faz login novamente sem um segundo fator. Na 0.23 todo cadastro
retorna um novo conjunto de códigos que substitui o antigo, e nem
`regenerateRecoveryCodes()` nem `resetMfa` existem.

O fator não pode ser usado até que o usuário comprove que seu autenticador gerou um
código a partir desse segredo:

```typescript
await client.auth.mfa.verify(factor.id, "418293");
```

## Fazendo login com MFA

Um login em uma conta com MFA cadastrado não retorna nenhuma sessão. Ele é recusado com `401 MFA_REQUIRED`, e os `details` do erro trazem um `mfaToken` e os `factors` verificados da conta. Passe esse token para `challenge` e `verifyChallenge` para obter a sessão:

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

O `mfaToken` é enviado apenas nessas duas requisições e nunca é instalado no cliente. `verifyChallenge` emite a sessão `aal2`, este cliente a adota e emite `SIGNED_IN` como em qualquer outro login. O `mfaToken` expira cinco minutos após o login que o retornou, e um desafio cinco minutos após ser aberto. Um desafio cujas tentativas atingiram o limite é invalidado pelo resto de sua duração — caso contrário, um desafio aberto permitiria tentativas ilimitadas para adivinhar os seis dígitos.

Sem `mfaToken`, as duas chamadas elevam a sessão que este cliente já mantém de `aal1` para `aal2`.

## Removendo um fator

```typescript
await client.auth.mfa.unenroll(factorId);
```

Depois que um fator é verificado, isso requer uma sessão `aal2`, para que um token
`aal1` roubado não possa desativar o MFA; um primeiro cadastro inacabado é removido a
partir de qualquer sessão. Remover o último fator verificado também
descarta os códigos de recuperação.
