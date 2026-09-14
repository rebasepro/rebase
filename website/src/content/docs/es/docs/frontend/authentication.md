---
sourceHash: 90e2137462c112d2
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

Pasa el `authController` al controlador de navegación de Rebase para proteger todo el panel de administración tras la autenticación.

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

## Simulación de roles (modo de desarrollo)

En el modo de desarrollo, puedes simular diferentes roles sin cerrar sesión. Esto resulta útil para probar políticas RLS:

```typescript
import { useBuildEffectiveRoleController } from "@rebasepro/app";

const effectiveRoleController = useBuildEffectiveRoleController();

// When active, the UI behaves as if the current user has this role
effectiveRoleController.setEffectiveRole("editor");
```

## Próximos pasos

- **[Autenticación en el backend](/docs/backend/authentication)** — JWT, proveedores de OAuth, configuración de SMTP
- **[Reglas de seguridad (RLS)](/docs/collections/security-rules)** — Control de acceso a nivel de fila por colección
- **[Autenticación del SDK de cliente](/docs/sdk/authentication)** — Métodos de autenticación programática
