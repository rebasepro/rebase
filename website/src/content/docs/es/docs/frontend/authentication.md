---
sourceHash: 9c7b1e0ee0076030
title: Autenticación e inicio de sesión
sidebar_label: Autenticación e inicio de sesión
description: Configura el controlador de autenticación, la vista de inicio de sesión y la simulación de roles en tu frontend React de Rebase.
---

## Descripción general

Rebase proporciona componentes y hooks de React listos para usar para la autenticación:

- **`useRebaseAuthController`** — Administra el estado de autenticación, los tokens y la persistencia de la sesión
- **`LoginView`** — Formulario preconstruido de inicio de sesión/registro con soporte para OAuth
- **Simulación de roles** — Prueba diferentes roles sin cerrar sesión

## Controlador de autenticación

El hook `useRebaseAuthController` es el núcleo de la autenticación en el frontend. Administra el usuario actual, los tokens y la sesión:

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

Pasa el `authController` a `<Rebase authController>`. `<RebaseShell>` (o `<RebaseAuthGate>` en un diseño manual) lo lee desde allí y restringe el acceso a todo el panel de administración tras la autenticación.

## Tu propio proveedor de autenticación

Si tu aplicación inicia sesión con su propio proveedor (Clerk, Firebase Auth o una sesión propia), proporciona al cliente que pasas a `<Rebase client>` un método de obtención de tokens (*token getter*). Tanto las solicitudes HTTP del panel como su socket en tiempo real envían lo que este devuelve, de modo que las vistas en vivo se ejecutan como el mismo usuario:

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

El `authController` situado junto a él informa entonces el usuario que ha iniciado sesión en tu proveedor (un `AuthController` de `@rebasepro/cms-types`) en lugar de envolver `client.auth`. El backend también debe aceptar el token: consulta [Adaptadores de autenticación personalizados](/docs/backend/auth-adapters) y [Tu propio proveedor de autenticación](/docs/sdk/your-own-auth-provider/) para obtener todos los detalles del lado del cliente.

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
- Inicio de sesión y registro con correo electrónico/contraseña
- Inicio de sesión con OAuth mediante Google, GitHub y LinkedIn (cuando esté configurado)
- Flujo de restablecimiento de contraseña
- Validación de formularios y estados de error

## Modelo de roles

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Los roles se almacenan como una columna de array `text[]` en la tabla de usuarios. Defines los roles que un usuario puede tener como un conjunto cerrado en esa columna, dentro de la tabla declarada con [`defineAuthTable`](/docs/schema/auth-table/):

```typescript title="backend/schema/users.ts"
roles: col.text({ enum: ["admin", "editor", "viewer"] }).array(),
```

Para agregar o eliminar un rol, modifica esa lista. Las etiquetas que el panel muestra para cada valor pertenecen al frontend: `enumLabels` en el campo dentro de `frontend/src/cms/users.tsx` (consulta [Personalizar una tabla](/docs/frontend/customize-table/)).

Un rol en esta lista es un nombre con el que tus [reglas de seguridad](/docs/collections/security-rules) pueden coincidir. Lo que puede hacer más allá de sus filas (administrar usuarios, leer registros, modificar el esquema) se declara por separado, bajo `auth.roles` en la misma tabla. `admin` está integrado de forma predeterminada y contiene todos los permisos. Consulta [Roles y alcances](/docs/backend/roles-and-scopes).

## Probar el acceso: Simular acceso

Para comprobar qué puede leer un rol, un usuario o una clave de servicio, un administrador utiliza **Simular acceso** (*Simulate access*), la píldora situada sobre tu avatar en el menú lateral del panel de administración (en la barra de la aplicación en pantallas pequeñas o cuando el shell no tiene menú lateral). Elige un rol (con un ID de usuario opcional, que no necesita corresponder a una cuenta real), un usuario o una clave de servicio activa.
A partir de ese momento, cada vista de datos y la pestaña Historial de un registro leen a través del servidor bajo esa identidad, aplicando las políticas reales de seguridad a nivel de fila: una cuadrícula muestra exactamente las filas que puede leer, los campos que sus roles no pueden leer aparecen enmascarados y el banner cuenta las tablas en las que no puede ver nada. El servidor comprueba en cada solicitud que seas un administrador.

El acceso simulado es de solo lectura. Mientras está activo, las vistas no permiten crear, editar, eliminar ni revertir el historial, y el servidor rechaza cualquier escritura que conlleve una simulación con `403 SIMULATION_READ_ONLY`, de modo que nada se guarde como otra persona. Detén la simulación para realizar cambios.

Lo que no simula: la barrera `requireAuth` de la API de datos, que permite el paso a un emisor anónimo simulado para que puedas ver lo que le otorgan las políticas de las filas (una función personalizada lo verá sin sesión, tal como ocurre con un emisor anónimo real); el almacenamiento, cuyos archivos se leen bajo tu propia identidad, deshabilitando las subidas mientras se simula; y las actualizaciones en vivo, que se pausan hasta que te detengas.

Lo mismo desde el código, en el SDK, se realiza con `client.simulate()`. Este método deriva un cliente cuyas solicitudes llevan la simulación, y solo la sesión de un administrador puede usarlo:

```typescript
const asCustomer = client.simulate({ role: "customer", userId: "u_1" });
const { data } = await asCustomer.data.table("tickets").find();
asCustomer.close();
```

El cliente derivado está tipado por la misma `Database` de la que proviene y es un cliente independiente: utiliza `close()` cuando hayas terminado.

El selector de rol efectivo no es un evaluador de RLS: solo cambia las vistas de Studio que lista la navegación, no envía nada al servidor y no evalúa ninguna política. `useBuildEffectiveRoleController`, que construía uno, está obsoleto y muestra una advertencia al invocarse: `<Rebase>` construye su propio controlador cuando no se pasa ninguno, y Simular acceso es el método indicado para comprobar lo que un rol puede hacer.

## Próximos pasos

- **[Autenticación en el backend](/docs/backend/authentication)** — JWT, proveedores de OAuth, configuración de SMTP
- **[Seguridad a nivel de fila](/docs/collections/security-rules)** — Control de acceso a nivel de fila por tabla
- **[Autenticación en el SDK tipado](/docs/sdk/authentication)** — Métodos de autenticación programáticos
