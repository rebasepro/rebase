---
title: Autenticación e Inicio de Sesión
sidebar_label: Autenticación e Inicio de Sesión
description: Configure el controlador de autenticación, la vista de inicio de sesión, la gestión de usuarios y la simulación de roles en su frontend React de Rebase.
---

## Resumen

Rebase proporciona componentes y hooks de React listos para usar para la autenticación:

- **`useRebaseAuthController`** — Gestiona el estado de autenticación, los tokens y la persistencia de sesión
- **`RebaseLoginView`** — Formulario de inicio de sesión/registro prediseñado con soporte OAuth
- **`useBackendUserManagement`** — Hook para gestionar usuarios desde el panel de administración
- **`UsersView`** — Interfaz de gestión de usuarios integrada
- **Simulación de roles** — Pruebe distintos roles sin cerrar sesión

## Controlador de Autenticación

El hook `useRebaseAuthController` es el núcleo de la autenticación del frontend. Gestiona el usuario actual, los tokens y la sesión:

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

Pase el `authController` al controlador de navegación de Rebase para proteger todo el panel de administración detrás de la autenticación.

## Vista de Inicio de Sesión

El componente `RebaseLoginView` proporciona un formulario completo de inicio de sesión y registro:

```tsx
import { RebaseLoginView } from "@rebasepro/app";

if (!authController.user) {
    return (
        <RebaseLoginView
            authController={authController}
            googleEnabled={!!GOOGLE_CLIENT_ID}
            googleClientId={GOOGLE_CLIENT_ID}
        />
    );
}
```

La vista de inicio de sesión gestiona:
- Inicio de sesión y registro con email/contraseña
- Inicio de sesión con Google OAuth (cuando está configurado)
- Flujo de restablecimiento de contraseña
- Validación de formularios y estados de error

## Gestión de Usuarios

### useBackendUserManagement

Este hook se conecta a la API de gestión de usuarios del backend:

```tsx
import { useBackendUserManagement } from "@rebasepro/app";

const userManagement = useBackendUserManagement({
    client: rebaseClient,
    currentUser: authController.user
});
```

### Componente UsersView

Renderice la interfaz de gestión de usuarios integrada:

```tsx
import { UsersView } from "@rebasepro/app";

// In your routes:
<Route path="/users" element={<UsersView userManagement={userManagement} />} />
```

Esto proporciona una tabla de usuarios completa con:
- Listado de usuarios con búsqueda y filtrado
- Asignación de roles
- Creación y edición de usuarios
- Gestión del estado de la cuenta

## Modelo de Roles

Los roles se almacenan como una columna de array `text[]` directamente en la tabla `rebase.users`. Los roles disponibles se definen como un enum en la definición de su colección de usuarios:

```typescript title="config/collections/users.ts"
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
    ui: {
        readOnly: false
    }
}
```

Para añadir o eliminar opciones de roles, actualice el mapa `enum` en su colección de usuarios y regenere el esquema.

## Simulación de Roles (Modo Desarrollo)

En el modo de desarrollador, puede simular distintos roles sin cerrar sesión. Esto es útil para probar las políticas RLS:

```typescript
import { useBuildEffectiveRoleController } from "@rebasepro/app";

const effectiveRoleController = useBuildEffectiveRoleController();

// When active, the UI behaves as if the current user has this role
effectiveRoleController.setEffectiveRole("editor");
```

## Próximos Pasos

- **[Autenticación del Backend](/docs/backend/authentication)** — JWT, proveedores OAuth, configuración SMTP
- **[Reglas de Seguridad (RLS)](/docs/collections/security-rules)** — Control de acceso a nivel de fila por colección
- **[Autenticación del SDK del Cliente](/docs/sdk/authentication)** — Métodos de autenticación programáticos
