---
sourceHash: 62fa2c4fbfc717e1
title: Autenticación e inicio de sesión
sidebar_label: Autenticación e inicio de sesión
description: Configura el controlador de autenticación, la vista de inicio de sesión y la simulación de roles en tu frontend de React con Rebase.
---

## Descripción general

Rebase proporciona componentes y hooks de React listos para usar para la autenticación:

- **`useRebaseAuthController`** — Gestiona el estado de autenticación, los tokens y la persistencia de la sesión
- **`LoginView`** — Formulario preconstruido de inicio de sesión/registro con soporte para OAuth
- **Simulación de roles** — Prueba diferentes roles sin cerrar sesión

## Auth Controller

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

Pasa el `authController` a `<Rebase authController>`. `<RebaseShell>` (o `<RebaseAuthGate>` en un layout manual) lo lee desde allí y restringe el acceso a todo el panel de administración tras la autenticación.

## Tu propio proveedor de autenticación

Si tu aplicación inicia sesión a los usuarios con su propio proveedor (Clerk, Firebase Auth, una sesión propia), proporciona un getter de tokens al cliente que pasas a `<Rebase client>`. Tanto las solicitudes HTTP del panel como su socket en tiempo real envían lo que este devuelva, de modo que las vistas de colecciones en vivo se ejecutan como el mismo usuario:

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

El `authController` que lo acompaña reporta entonces el usuario con sesión iniciada de tu proveedor (un `AuthController` de `@rebasepro/cms-types`) en lugar de envolver `client.auth`. El backend también debe aceptar el token: consulta [Custom auth adapters](/docs/backend/auth-adapters) y [Your Own Auth Provider](/docs/sdk/your-own-auth-provider/) para conocer los detalles completos del lado del cliente.

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

La vista de inicio de sesión maneja:
- Inicio de sesión y registro con correo electrónico/contraseña
- Inicio de sesión con OAuth mediante Google, GitHub y LinkedIn (cuando esté configurado)
- Flujo de restablecimiento de contraseña
- Validación de formularios y estados de error

## Modelo de roles

Los roles se almacenan como una columna de array `text[]` directamente en la tabla `rebase.users`. Defines los roles disponibles como un enum en la definición de tu colección de usuarios:

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

Un rol en esta lista es un nombre con el que tus [reglas de seguridad](/docs/collections/security-rules) pueden coincidir. Lo que puede hacer más allá de sus filas (administrar usuarios, leer logs, cambiar el esquema) se declara por separado, bajo `auth.roles` en la misma colección. `admin` está integrado de forma predeterminada y tiene acceso a todo. Consulta [Roles and scopes](/docs/backend/roles-and-scopes).

## Probar el acceso: Simular acceso

Para comprobar lo que un rol, un usuario o una clave de servicio pueden leer, un administrador utiliza **Simular acceso** (Simulate access), el botón con forma de píldora ubicado sobre tu avatar en el drawer del panel de administración (en la barra de la app en pantallas pequeñas, o cuando el shell no tiene drawer). Elige un rol (con un id de usuario opcional, que no necesita ser una cuenta), un usuario o una clave de servicio activa.
Cada vista de datos y la pestaña Historial de un registro leen a través del servidor como esa identidad, aplicando las políticas reales de seguridad a nivel de fila (RLS): una cuadrícula muestra exactamente las filas que puede leer, los campos que sus roles no pueden leer se enmascaran y el banner cuenta las colecciones en las que no ve nada. El servidor comprueba en cada solicitud que eres un administrador.

El acceso simulado es de solo lectura. Mientras esté activo, las vistas no ofrecen crear, editar, eliminar ni revertir el historial, y el servidor rechaza cualquier escritura que lleve una simulación con `403 SIMULATION_READ_ONLY`, por lo que nada se guarda en nombre de otra persona. Detén la simulación para realizar cambios.

Lo que no simula: la barrera `requireAuth` de la API de datos, que permite el paso de una llamada anónima simulada para que veas lo que le otorgan las políticas de las filas (una función personalizada la ve como sin sesión, al igual que un llamador anónimo real); el almacenamiento, cuyos archivos se leen como tu propio usuario, con las subidas desactivadas durante la simulación; y las actualizaciones en vivo, que se pausan hasta que te detengas.

Lo mismo desde el código, en el SDK, se realiza con `client.simulate()`. Deriva un cliente cuyas solicitudes llevan la simulación, y solo la sesión de un administrador puede usarlo:

```typescript
const asCustomer = client.simulate({ role: "customer", userId: "u_1" });
const { data } = await asCustomer.data.collection("tickets").find();
asCustomer.close();
```

El cliente derivado está tipado por la misma `Database` que aquel del que proviene, y es un cliente independiente: haz `close()` cuando hayas terminado.

El selector de rol efectivo no es un probador de RLS: solo cambia las vistas de Studio que lista la navegación, no envía nada al servidor y no evalúa ninguna política. `useBuildEffectiveRoleController`, que construía uno, está en desuso y emite una advertencia al llamarse: `<Rebase>` construye su propio controlador cuando no se pasa ninguno, y Simular acceso es la forma de probar lo que un rol puede hacer.

## Próximos pasos

- **[Autenticación en el backend](/docs/backend/authentication)** — JWT, proveedores de OAuth, configuración de SMTP
- **[Reglas de seguridad (RLS)](/docs/collections/security-rules)** — Control de acceso a nivel de fila por colección
- **[Autenticación tipada en el SDK](/docs/sdk/authentication)** — Métodos de autenticación programática
