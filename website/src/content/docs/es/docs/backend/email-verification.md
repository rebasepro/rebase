---
sourceHash: 3d6a5a62a25e5b8c
title: Verificación de correo electrónico
sidebar_label: Verificación de correo electrónico
description: "Cómo una cuenta demuestra su dirección de correo electrónico: el enlace que se envía al registrarse, lo que seguirlo conserva y elimina, y el registro con confirmación previa con requireEmailVerification."
---

Cuando el correo está configurado, registrarse
envía a la cuenta nueva un enlace de verificación (`<frontend>/verify-email?token=…`, válido durante 24 horas),
de modo que el titular demuestra la dirección al registrarse, en sus propios términos. `POST /api/auth/send-verification`
lo envía de nuevo. No se envía nada a las direcciones sintéticas de los invitados ni a las cuentas de X (Twitter).

El enlace demuestra la bandeja de entrada, no quién registró la dirección. Cualquiera puede
registrar la dirección de otra persona con una contraseña y pedir que se envíe el enlace, así
que seguirlo conserva solo lo que la propia solicitud también demuestra:

| Seguir el enlace con… | Qué ocurre |
|---|---|
| una sesión en vivo de esa cuenta (cabecera `Authorization`) | Verificada. No se elimina nada: solo quien registró la cuenta puede tener su sesión |
| la contraseña de la cuenta (`POST`, `password`) | Verificada, se conserva la contraseña, se elimina una identidad no avalada y el emisor inicia sesión |
| ninguna de las dos | Verificada, y se eliminan la contraseña y cada identidad no avalada, y se cierran todas las sesiones. `POST` pregunta primero (`409 PROOF_REQUIRED`) a menos que `removeUnproven: true` |

Así, un titular que sigue el enlace con la sesión iniciada, o que escribe la contraseña que eligió,
la conserva; alguien cuya dirección registró un desconocido se verifica sin ella, y
la vía de acceso del desconocido desaparece. La respuesta indica `passwordRemoved` cuando
elimina una. El CMS pide la contraseña antes de verificar.

## Registro con confirmación previa

`auth.requireEmailVerification: true` (o `AUTH_REQUIRE_EMAIL_VERIFICATION=true`) cambia dos
cosas:

- `POST /api/auth/register` no inicia la sesión de nadie. Responde `200 { confirmationRequired: true }`
  tanto si la dirección ya tiene una cuenta como si no, en el mismo tiempo, de modo que
  no revela a nadie qué direcciones están registradas. A una cuenta existente que
  nunca confirmó se le envía de nuevo su enlace; su contraseña no cambia.
- `POST /api/auth/login` responde `403 EMAIL_NOT_CONFIRMED` para una cuenta no verificada,
  y solo una vez que la contraseña es correcta, de modo que la respuesta no revela a nadie
  salvo a quien tiene la contraseña que la dirección no está confirmada. Envía el enlace de
  nuevo, como máximo una vez por minuto.

Quien se registra sigue el enlace e introduce su contraseña
(`POST /api/auth/verify-email { token, password }`), lo que verifica la dirección
y le inicia la sesión. Con esta opción desactivada, que es lo predeterminado, una dirección
que ya tiene una cuenta recibe `409 EMAIL_EXISTS`, como antes.

Para recuperarse de un rechazo en el paso 3, el usuario inicia sesión con su método existente y
llama al endpoint de vinculación explícito:

```http
POST /api/auth/link/google
Authorization: Bearer <access token>

{ "idToken": "..." }
```

La vinculación mientras se está autenticado intencionalmente **no** requiere un correo electrónico
verificado, ni exige que los correos coincidan en absoluto — la dirección de Google de un usuario
a menudo no es su dirección en la aplicación. La asimetría es deliberada: al iniciar sesión, el
correo del proveedor es la única evidencia que vincula la identidad entrante con una cuenta,
mientras que aquí el emisor ya ha demostrado la titularidad al contar con una sesión válida.
Devuelve `409 IDENTITY_ALREADY_LINKED` si esa identidad de proveedor pertenece a otro usuario, y
es idempotente si ya está vinculada al emisor.

#### La dirección inversa

Un usuario que se registró con Google y no tiene contraseña:

- **El registro con el mismo correo** se rechaza con `409 EMAIL_EXISTS`.
- **`POST /api/auth/change-password`** devuelve `400 INVALID_ACCOUNT` — no existe una
  contraseña previa con la cual contrastar.
- **`forgot-password` → `reset-password` es el método admitido para agregar una.** Vuelve
  a demostrar la posesión de la dirección por correo electrónico, tras lo cual la cuenta
  dispondrá de ambos métodos de inicio de sesión.


## Consulta también

- [Autenticación](/docs/backend/authentication/): la configuración de autenticación, la
  vinculación de cuentas OAuth, y por qué una primera prueba de la dirección elimina lo que
  nadie demostró.
- [Endpoints de autenticación](/docs/backend/auth-endpoints/): `POST /api/auth/verify-email`
  y `POST /api/auth/send-verification` con el resto de las rutas.
- [Autenticación del SDK](/docs/sdk/authentication/#email-verification):
  `verifyEmail` y `signUp` desde el cliente.
