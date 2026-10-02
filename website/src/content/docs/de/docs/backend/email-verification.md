---
sourceHash: 922c44ae945d9509
title: E-Mail-Verifizierung
sidebar_label: E-Mail-Verifizierung
description: "Wie ein Konto seine E-Mail-Adresse nachweist: der bei der Registrierung versendete Link, was das Folgen behält und entfernt, und Registrierung mit vorheriger Bestätigung über requireEmailVerification."
---

<span class="since-badge" data-since="0.24">Seit 0.24</span> Wenn E-Mail konfiguriert ist, versendet
die Registrierung an das neue Konto einen Verifizierungslink (`<frontend>/verify-email?token=…`,
24 Stunden gültig), sodass der Eigentümer die Adresse bei der Registrierung von sich aus
nachweist. `POST /api/auth/send-verification` versendet ihn erneut. An die synthetischen
Adressen von Gästen und X-(Twitter)-Konten wird nichts versendet.

Der Link beweist den Zugriff auf das Postfach, nicht, wer die Adresse registriert hat. Jeder
kann die Adresse einer anderen Person mit einem Passwort registrieren und verlangen, dass der
Link dorthin versendet wird, daher behält das Folgen des Links nur das, was der Request
ebenfalls nachweist:

| Folgt man dem Link mit … | Was passiert |
|---|---|
| einer aktiven Sitzung dieses Kontos (`Authorization`-Header) | Verifiziert. Nichts wird entfernt: Nur wer das Konto registriert hat, kann dessen Sitzung halten |
| dem Passwort des Kontos (`POST`, `password`) | Verifiziert, das Passwort bleibt erhalten, eine nicht verbürgte Identität wird entfernt, und der Aufrufer wird angemeldet |
| keinem von beiden | Verifiziert, und das Passwort sowie jede nicht verbürgte Identität werden entfernt, jede Sitzung wird beendet. `POST` fragt zuerst nach (`409 PROOF_REQUIRED`), außer `removeUnproven: true` ist gesetzt |

Ein Eigentümer, der angemeldet dem Link folgt oder das von ihm gewählte Passwort eingibt, behält
es also; wessen Adresse ein Fremder registriert hat, verifiziert ohne es, und der Zugang des
Fremden ist dahin. Die Antwort nennt `passwordRemoved`, wenn eines entfernt wurde. Das CMS fragt
vor der Verifizierung nach dem Passwort.

## Zuerst bestätigen, dann registrieren

`auth.requireEmailVerification: true` (oder `AUTH_REQUIRE_EMAIL_VERIFICATION=true`) ändert zwei
Dinge:

- `POST /api/auth/register` meldet niemanden an. Es antwortet mit
  `200 { confirmationRequired: true }`, unabhängig davon, ob die Adresse bereits ein Konto hat,
  und in derselben Zeit, sodass niemandem verraten wird, welche Adressen registriert sind. Ein
  bestehendes Konto, das nie bestätigt hat, erhält seinen Link erneut per Mail; sein Passwort
  wird nicht geändert.
- `POST /api/auth/login` antwortet mit `403 EMAIL_NOT_CONFIRMED` für ein nicht verifiziertes
  Konto, und das auch nur, wenn das Passwort stimmt, sodass die Antwort niemandem außer dem
  Inhaber des Passworts verrät, dass die Adresse nicht bestätigt ist. Es versendet den Link
  erneut, höchstens einmal pro Minute.

Die registrierende Person folgt dem Link und gibt ihr Passwort ein
(`POST /api/auth/verify-email { token, password }`), was die Adresse verifiziert und sie
anmeldet. Ist es aus, was der Standard ist, wird eine Adresse, die bereits ein Konto hat, wie
bisher mit `409 EMAIL_EXISTS` beantwortet.

Um eine Zurückweisung aus Schritt 3 aufzulösen, meldet sich der Benutzer mit seiner bestehenden
Methode an und ruft den expliziten Verknüpfungsendpunkt auf:

```http
POST /api/auth/link/google
Authorization: Bearer <access token>

{ "idToken": "..." }
```

Das Verknüpfen im authentifizierten Zustand erfordert absichtlich **keine** verifizierte E-Mail
und verlangt auch nicht, dass die E-Mail-Adressen übereinstimmen — die Google-Adresse eines
Benutzers unterscheidet sich oft von der App-Adresse. Diese Asymmetrie ist gewollt: Bei der
Anmeldung ist die E-Mail des Providers der einzige Nachweis, der die eingehende Identität an ein
Konto bindet. Hier jedoch hat der Aufrufer die Inhaberschaft bereits durch eine gültige Sitzung
nachgewiesen. Es wird `409 IDENTITY_ALREADY_LINKED` zurückgegeben, wenn die Provider-Identität
einem anderen Benutzer gehört; der Aufruf ist idempotent, wenn sie bereits mit dem Aufrufer
verknüpft ist.

#### Die umgekehrte Richtung

Ein Benutzer, der sich über Google registriert hat und kein Passwort besitzt:

- **Eine Registrierung mit derselben E-Mail** wird mit `409 EMAIL_EXISTS` abgewiesen.
- **`POST /api/auth/change-password`** liefert `400 INVALID_ACCOUNT` zurück — es gibt kein
  bestehendes Passwort, gegen das geprüft werden könnte.
- **`forgot-password` → `reset-password` ist der offizielle Weg, eines hinzuzufügen.** Hierbei
  wird der Besitz der Adresse per E-Mail erneut nachgewiesen, woraufhin das Konto über beide
  Anmeldemethoden verfügt.


## Siehe auch

- [Authentifizierung](/docs/backend/authentication/): die Auth-Konfiguration, die Verknüpfung
  von OAuth-Konten, und warum ein erster Adressnachweis entfernt, was niemand bewiesen hat.
- [Auth-Endpunkte](/docs/backend/auth-endpoints/): `POST /api/auth/verify-email`
  und `POST /api/auth/send-verification` mit dem Rest der Routen.
- [SDK-Authentifizierung](/docs/sdk/authentication/#email-verification):
  `verifyEmail` und `signUp` vom Client aus.
