---
sourceHash: 0e00ae18684830bb
title: "Multi-Faktor-Authentifizierung"
sidebar_label: "Multi-Faktor-Authentifizierung"
---

TOTP-Faktoren — eine Authentifikator-App — plus die Challenge, die eine Sitzung von `aal1` auf `aal2` hochstuft.

## Faktor registrieren

```typescript
const { factor, totp, recoveryCodes } = await client.auth.mfa.enroll({
    friendlyName: "Phone"
});

showQrCode(totp.uri);        // otpauth://… — what the authenticator scans
if (recoveryCodes) showRecoveryCodes(recoveryCodes);
```

**Zeigen Sie die Wiederherstellungscodes einmalig und nie wieder an.** Da nur deren Hashes gespeichert werden, können sie später nicht mehr angezeigt werden. Sie werden mit dem ersten Faktor des Kontos ausgegeben.
Das Hinzufügen eines weiteren Faktors behält die Codes, die das Konto bereits hat, und
`recoveryCodes` ist `null`. Eine begonnene und abgebrochene Registrierung rührt sie nie an.

Um sie zu ersetzen, nachdem mehrere verbraucht wurden oder der Ausdruck verloren ging, rufen Sie
`regenerateRecoveryCodes()` aus einer `aal2`-Sitzung auf. Die alten Codes funktionieren danach nicht mehr:

```typescript
const { recoveryCodes } = await client.auth.mfa.regenerateRecoveryCodes();
```

Wer sowohl den Authentifikator als auch die Codes verloren hat, wird von einem
Administrator wieder hereingelassen: `client.admin.resetMfa(uid)` (`DELETE /api/admin/users/:uid/mfa`,
`users:write`) entfernt die Faktoren und Codes des Kontos und beendet dessen Sitzungen,
sodass das Passwort wieder ohne zweiten Faktor anmeldet. Unter 0.23 liefert jede Registrierung
einen neuen Satz Codes, der den alten ersetzt, und weder
`regenerateRecoveryCodes()` noch `resetMfa` existieren.

Der Faktor ist erst nutzbar, wenn der Benutzer nachweist, dass sein Authentifikator einen Code aus diesem Secret generiert hat:

```typescript
await client.auth.mfa.verify(factor.id, "418293");
```

## Mit MFA anmelden

Eine Anmeldung an einem Konto mit eingerichteter MFA liefert keine Sitzung. Sie wird mit `401 MFA_REQUIRED` abgelehnt, und die `details` des Fehlers enthalten ein `mfaToken` und die verifizierten `factors` des Kontos. Übergeben Sie dieses Token an `challenge` und `verifyChallenge`, um die Sitzung zu erhalten:

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

Das `mfaToken` wird nur bei diesen beiden Anfragen gesendet und nie im Client hinterlegt. `verifyChallenge` erstellt die `aal2`-Sitzung, dieser Client übernimmt sie und sendet `SIGNED_IN` wie bei jeder anderen Anmeldung. Das `mfaToken` läuft fünf Minuten nach der Anmeldung ab, die es geliefert hat, und eine Challenge fünf Minuten nachdem sie geöffnet wurde. Eine Challenge, deren Rateversuche das Limit erreicht haben, bleibt für den Rest ihrer Lebensdauer ungültig — andernfalls würde eine offene Challenge unbegrenzte Versuche für sechs Ziffern ermöglichen.

Ohne `mfaToken` stufen die beiden Aufrufe die Sitzung, die dieser Client bereits hält, von `aal1` auf `aal2` hoch.

## Faktor entfernen

```typescript
await client.auth.mfa.unenroll(factorId);
```

Sobald ein Faktor verifiziert ist, erfordert dies eine `aal2`-Sitzung, damit ein gestohlenes `aal1`-Token MFA nicht deaktivieren kann; eine unvollendete erste Registrierung wird aus jeder Sitzung entfernt. Durch das Entfernen des letzten verifizierten Faktors werden auch die Wiederherstellungscodes gelöscht.
