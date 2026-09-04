---
title: Autenticación e Inicio de Sesión
sidebar_label: Autenticación e Inicio de Sesión
description: Configure el controlador de autenticación, la vista de inicio de sesión y la simulación de roles en su frontend React de Rebase.
---

## Resumen

Rebase proporciona componentes y hooks de React listos para usar para la autenticación:

- **`useRebaseAuthController`** — Gestiona el estado de autenticación, los tokens y la persistencia de sesión
- **`LoginView`** — Formulario de inicio de sesión/registro prediseñado con soporte OAuth
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

El componente `LoginView` proporciona un formulario completo de inicio de sesión y registro:

```tsx
import { LoginView } from "@rebasepro/app";

if (!authController.user) {
    return (
        <LoginView
            authController={authController}
            googleClientId={GOOGLE_CLIENT_ID}
        />
    );
}
```

La vista de inicio de sesión gestiona:
- Inicio de sesión y registro con email/contraseña
- Inicio de sesión con Google, GitHub y LinkedIn (cuando está configurado)
- Flujo de restablecimiento de contraseña
- Validación de formularios y estados de error

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
    admin: {
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
