---
sourceHash: 0e00ae18684830bb
title: "Authentification multifacteur"
sidebar_label: "Authentification multifacteur"
---

Facteurs TOTP — une application d'authentification — ainsi que le challenge qui élève une session de `aal1` à `aal2`.

## Enrôler un facteur

```typescript
const { factor, totp, recoveryCodes } = await client.auth.mfa.enroll({
    friendlyName: "Phone"
});

showQrCode(totp.uri);        // otpauth://… — what the authenticator scans
if (recoveryCodes) showRecoveryCodes(recoveryCodes);
```

**Affichez les codes de récupération une seule fois et jamais plus.** Seuls leurs hachages sont stockés, rien ne pourra donc les afficher ultérieurement. Ils accompagnent le premier facteur du compte.
Ajouter un autre facteur conserve les codes que le compte possède déjà, et
`recoveryCodes` vaut `null`. Démarrer un enrôlement puis l'abandonner ne les touche jamais.

Pour les remplacer, après en avoir utilisé plusieurs ou perdu l'impression, appelez
`regenerateRecoveryCodes()` depuis une session `aal2`. Les anciens codes cessent de fonctionner :

```typescript
const { recoveryCodes } = await client.auth.mfa.regenerateRecoveryCodes();
```

Quelqu'un qui a perdu à la fois l'application d'authentification et les codes est
réadmis par un administrateur : `client.admin.resetMfa(uid)` (`DELETE /api/admin/users/:uid/mfa`,
`users:write`) supprime les facteurs et les codes du compte et met fin à ses sessions,
si bien que le mot de passe se connecte à nouveau sans second facteur. Sur la 0.23 chaque
enrôlement renvoie un nouvel ensemble de codes qui remplace l'ancien, et ni
`regenerateRecoveryCodes()` ni `resetMfa` n'existent.

Le facteur n'est pas utilisable tant que l'utilisateur n'a pas prouvé que son application d'authentification a généré un code à partir de ce secret :

```typescript
await client.auth.mfa.verify(factor.id, "418293");
```

## Se connecter avec la MFA

Une connexion sur un compte enrôlé en MFA ne renvoie aucune session. Elle est refusée avec `401 MFA_REQUIRED`, et les `details` de l'erreur contiennent un `mfaToken` et les `factors` vérifiés du compte. Passez ce jeton à `challenge` et `verifyChallenge` pour obtenir la session :

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

Le `mfaToken` n'est envoyé que sur ces deux requêtes et n'est jamais installé sur le client. `verifyChallenge` génère la session `aal2`, ce client l'adopte et émet `SIGNED_IN` comme pour toute autre connexion. Le `mfaToken` expire cinq minutes après la connexion qui l'a renvoyé, et un challenge cinq minutes après son ouverture. Un challenge ayant atteint sa limite de tentatives reste consommé pour le reste de sa durée de vie — sans quoi un challenge ouvert permettrait des tentatives illimitées sur six chiffres.

Sans `mfaToken`, les deux appels élèvent la session que ce client détient déjà de `aal1` à `aal2`.

## Supprimer un facteur

```typescript
await client.auth.mfa.unenroll(factorId);
```

Une fois un facteur vérifié, cela nécessite une session `aal2`, afin qu'un jeton `aal1` dérobé ne puisse pas désactiver la MFA ; une première inscription inachevée se supprime depuis n'importe quelle session. La suppression du dernier facteur vérifié élimine également les codes de récupération.
