---
sourceHash: fe474014627c7510
title: Autenticación e inicio de sesión
sidebar_label: Autenticación e inicio de sesión
description: Configura el controlador de autenticación, la vista de inicio de sesión y la simulación de roles en tu frontend React de Rebase.
---

## Descripción general

Rebase proporciona componentes y hooks de React listos para usar para la autenticación:

- **`useRebaseAuthController`** — Gestiona el estado de autenticación, los tokens y la persistencia de la sesión
- **`LoginView`** — Formulario preconstruido de inicio de sesión/registro con soporte para OAuth
- **Simulación de roles** — Prueba diferentes roles sin cerrar sesión

## Controlador de autenticación

El hook `useRebaseAuthController` es el núcleo de la autenticación en el frontend. Gestiona el usuario actual, los tokens y la sesión:

```typescript
import { useRebaseAuthController } from "@rebasepro/app";
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

const authController = useRebaseAuthController({
    client,
    googleClientId: GOOGLE_CLIENT_ID  // Optional — enables Google OAuth
});

// Available properties:
authController.user           // Current user object (or null)
authController.initialLoading // True while checking stored session
authController.signOut()      // Log out
authController.getAuthToken() // Get current JWT for API calls
```

Pasa el `authController` a `<Rebase authController>`. `<RebaseShell>` (o `<RebaseAuthGate>` en un layout manual) lo lee de ahí y protege todo el panel de administración tras la autenticación.

## Tu propio proveedor de autenticación

En 0.24 el
getter autentica solo las solicitudes HTTP, y el socket de tiempo real del panel sigue
siendo anónimo.

Si tu aplicación inicia sesión a los usuarios con su propio proveedor (Clerk, Firebase Auth, una
sesión propia), dale al cliente que pasas a `<Rebase client>` un getter de token. Las solicitudes
HTTP del panel y su socket de tiempo real envían lo que devuelve, de modo que las vistas
de colección en vivo se ejecutan como el mismo usuario:

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

El `authController` que lo acompaña informa entonces del usuario con sesión iniciada de tu proveedor
(un `AuthController` de `@rebasepro/cms-types`) en lugar de envolver
`client.auth`. El backend también tiene que aceptar el token: consulta
[Adaptadores de autenticación personalizados](/docs/backend/auth-adapters), y
[Usar tu propio proveedor de autenticación](/docs/sdk/authentication#using-your-own-auth-provider)
para el lado del cliente al completo.

## Vista de inicio de sesión

El componente `LoginView` proporciona un formulario completo de inicio de sesión y registro:

```tsx
import { LoginView } from "@rebasepro/app";

function App() {
    if (!authController.user) {
        return (
            <LoginView
                authController={authController}
                googleClientId={GOOGLE_CLIENT_ID}
            />
        );
    }
    return <MyApp />;
}
```

La vista de inicio de sesión gestiona:
- Inicio de sesión y registro mediante correo electrónico/contraseña
- Inicio de sesión mediante OAuth con Google, GitHub y LinkedIn (cuando esté configurado)
- Flujo de restablecimiento de contraseña
- Validación de formularios y estados de error

## Modelo de roles

Los roles se almacenan como una columna de array `text[]` directamente en la tabla `rebase.users`. Los roles disponibles se definen como un enum en la definición de tu colección de usuarios:

```typescript title="config/collections/users.ts" no-verify
roles: {
    name: "Roles",
    type: "array",
    columnType: "text[]",
    of: {
        name: "Role",
        type: "string",
        enum: {
            admin: "Admin",
            editor: "Editor",
            viewer: "Viewer"
        }
    },
    admin: {
        readOnly: false
    }
}
```

Para agregar o eliminar opciones de roles, actualiza el mapa `enum` en tu colección de usuarios y regenera el esquema.

Un rol de esta lista es un nombre con el que pueden coincidir tus [reglas de seguridad](/docs/collections/security-rules). Lo que puede hacer más allá de sus filas (gestionar usuarios, leer registros, cambiar el esquema) se declara por separado, bajo `auth.roles` en la misma colección. `admin` está integrado y lo tiene todo. Consulta [Roles y alcances](/docs/backend/roles-and-scopes).

## Probar el acceso: Simulate access

Para comprobar qué puede leer un rol, un usuario o una clave de servicio, un administrador usa
**Simulate access**, la píldora sobre tu avatar en el cajón lateral del panel de administración (en
la barra de la aplicación en una pantalla pequeña, o cuando el shell no tiene cajón). Elige un rol
(con un id de usuario opcional, que no tiene por qué ser una cuenta), un usuario o una clave de
servicio activa.
Cada vista de datos, y la pestaña History de un registro, lee entonces a través del servidor como
esa identidad, contra las políticas reales de seguridad a nivel de fila: una cuadrícula muestra
exactamente las filas que puede leer,
los campos que sus roles no pueden leer aparecen enmascarados, y el banner cuenta las colecciones
en las que no ve nada. El servidor comprueba en cada solicitud que eres
administrador.

El acceso simulado es de solo lectura. Mientras está activo, las vistas no ofrecen crear, editar,
borrar ni revertir el historial, y el servidor rechaza cualquier escritura que lleve una simulación con
`403 SIMULATION_READ_ONLY`, así que nada se guarda como otra persona. Deja de simular
para hacer cambios.

Lo que no simula: la barrera `requireAuth` de la API de datos, que deja pasar a un llamante anónimo
simulado para que veas lo que las políticas de las filas le dan
(una función personalizada lo ve como sin sesión, igual que a un llamante anónimo real);
el almacenamiento, cuyos archivos se leen como tú, con las subidas desactivadas mientras se simula; y
las actualizaciones en vivo, que se pausan hasta que dejas de simular.

Lo mismo desde código, en el SDK, es `client.simulate()`. Deriva un
cliente cuyas solicitudes llevan la simulación, y solo la sesión propia de un administrador
puede usarlo:

```typescript
const asCustomer = client.simulate({ role: "customer", userId: "u_1" });
const { data } = await asCustomer.data.collection("tickets").find();
asCustomer.close();
```

El cliente derivado está tipado por el mismo `Database` que aquel del que viene, y
es un cliente por derecho propio: ciérralo con `close()` cuando termines.

El selector de rol efectivo no es un probador de RLS: solo cambia qué vistas de Studio
lista la navegación, no envía nada al servidor y no evalúa ninguna
política. `useBuildEffectiveRoleController`, que construía uno, está obsoleto y
avisa una vez cuando se llama: `<Rebase>` construye su propio controlador cuando no se
le pasa ninguno, y Simulate access es la forma de probar lo que puede hacer un rol.

## Próximos pasos

- **[Autenticación en el backend](/docs/backend/authentication)** — JWT, proveedores de OAuth, configuración de SMTP
- **[Reglas de seguridad (RLS)](/docs/collections/security-rules)** — Control de acceso a nivel de fila por colección
- **[Autenticación del SDK tipado](/docs/sdk/authentication)** — Métodos de autenticación programática
