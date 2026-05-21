---
title: Autenticación
sidebar_label: Autenticación
description: Configure la autenticación JWT, los proveedores OAuth (Google, LinkedIn), la gestión de usuarios y el control de acceso basado en roles.
---

## Resumen

Rebase incluye un sistema de autenticación completo:

- **Tokens JWT** — Flujo de tokens de acceso y actualización
- **Plugins OAuth** — Arquitectura enchufable para Google, LinkedIn y más
- **Gestión de usuarios** — Registro, inicio de sesión, restablecimiento de contraseña
- **Acceso basado en roles** — Asignar roles a usuarios, verificar permisos en colecciones
- **Autoarranque** — El primer usuario obtiene automáticamente el rol de administrador

## Configuración del Backend

```typescript
import { createGoogleProvider, createLinkedinProvider } from "@rebasepro/server-core";

await initializeRebaseBackend({
    // ...
    auth: {
        jwtSecret: process.env.JWT_SECRET!,  // Required
        accessExpiresIn: "1h",               // Access token lifetime
        refreshExpiresIn: "30d",             // Refresh token lifetime
        requireAuth: true,                   // Require auth for data API
        allowRegistration: false,            // Allow new signups
        google: process.env.GOOGLE_CLIENT_ID ? {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET
        } : undefined,
        linkedin: process.env.LINKEDIN_CLIENT_ID ? {
            clientId: process.env.LINKEDIN_CLIENT_ID,
            clientSecret: process.env.LINKEDIN_CLIENT_SECRET
        } : undefined,
        email: {
            smtp: {
                host: "smtp.gmail.com",
                port: 587,
                secure: false,
                user: "noreply@example.com",
                pass: "app-password",
                from: "Rebase <noreply@example.com>"
            }
        }
    }
});
```

Las tablas de autenticación (`rebase.users`, `rebase.roles`, `rebase.user_roles`, `rebase.refresh_tokens`) se **crean automáticamente** en el primer inicio.

## Puntos de Acceso de Autenticación

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Crear una nueva cuenta |
| `POST` | `/api/auth/login` | Iniciar sesión con correo electrónico/contraseña |
| `POST` | `/api/auth/refresh` | Actualizar el token de acceso |
| `POST` | `/api/auth/<provider-id>` | Punto de acceso de inicio de sesión dinámico para cualquier proveedor OAuth configurado (por ejemplo, `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/logout` | Revocar token de actualización |
| `POST` | `/api/auth/forgot-password` | Enviar correo electrónico de restablecimiento de contraseña |
| `POST` | `/api/auth/reset-password` | Restablecer contraseña con token |

## Configuración del Frontend

### Controlador de Autenticación

```typescript
import { useRebaseAuthController } from "@rebasepro/auth";
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

const authController = useRebaseAuthController({
    client,
    googleClientId: GOOGLE_CLIENT_ID  // Optional
});

// Propiedades disponibles:
authController.user          // Objeto del usuario actual (o nulo)
authController.initialLoading // Verdadero mientras se comprueba la sesión almacenada
authController.signOut()     // Cerrar sesión
authController.getAuthToken() // Obtener el JWT actual para llamadas a la API
```

### Vista de Inicio de Sesión

```tsx
import { RebaseLoginView } from "@rebasepro/auth";

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

## Gestión de Usuarios y Roles

### Servicios de Backend

Después de la inicialización, la instancia del backend proporciona `userService` y `roleService`:

```typescript
const { userService, roleService } = instance;

// Listar todos los usuarios
const users = await userService.listUsers();

// Asignar un rol
await roleService.assignRole(userId, roleId);
```

### Componentes de Frontend

Rebase proporciona vistas integradas para la gestión de usuarios y roles:

```tsx
import { UsersView, RolesView } from "@rebasepro/core";
import { useBackendUserManagement } from "@rebasepro/auth";

const userManagement = useBackendUserManagement({
    client: rebaseClient,
    currentUser: authController.user
});

// En tus rutas:
<Route path="/users" element={<UsersView userManagement={userManagement} />} />
<Route path="/roles" element={<RolesView userManagement={userManagement} />} />
```

![Interfaz de gestión de usuarios](/img/user_management.png)

## Simulación de Roles (Modo de Desarrollo)

En modo de desarrollo, puedes simular diferentes roles sin cerrar sesión:

```typescript
import { useBuildEffectiveRoleController } from "@rebasepro/core";

const effectiveRoleController = useBuildEffectiveRoleController();

// Cuando está activo, la interfaz de usuario se comporta como si el usuario actual tuviera este rol
effectiveRoleController.setEffectiveRole("editor");
```

## Autoarranque del Primer Usuario

Cuando no existen usuarios en la base de datos, la primera persona en registrarse se convierte automáticamente en administrador. Después de eso, el registro se controla mediante la configuración `allowRegistration`.

Esto asegura que siempre puedas iniciar una nueva implementación sin necesidad de poblar la base de datos manualmente.

## Próximos Pasos

- **[Almacenamiento](/docs/storage)** — Configuración de almacenamiento de archivos
- **[Colecciones](/docs/collections)** — Permisos por colección
---
