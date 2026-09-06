---
sourceHash: ee6fa328c0acbd31
title: Aplicaciones y Repositorios
sidebar_label: Aplicaciones y Repositorios
description: Un proyecto es un backend más las aplicaciones que se comunican con él, las cuales pueden vivir cada una en su propio repositorio.
---

## Proyectos y aplicaciones

Un **proyecto** es el backend: la base de datos, autenticación, almacenamiento, tiempo real y funciones. Una **aplicación** es algo que se comunica con él.

| Tipo | Qué es |
| --- | --- |
| `backend` | Las colecciones, hooks y funciones que definen la API. Exactamente uno por proyecto. |
| `static` | Un paquete de cliente compilado: una SPA o sitio estático, servido en su propia ruta. |

Esa es toda la lista. El panel de administración es una aplicación `static` como cualquier otra: se compila en tu repositorio, con base en tus colecciones, razón por la cual los campos personalizados y las vistas personalizadas funcionan en él desde el primer día.

Quién es el propietario del proceso del servidor es una propiedad del backend, no un tipo de aplicación independiente:

| `runtime` | Qué significa |
| --- | --- |
| `managed` | La imagen de runtime de la plataforma ejecuta tu paquete. Tú proporcionas las colecciones, funciones, crons y esquema. |
| `custom` | Tú proporcionas el servidor: tu propio Dockerfile y punto de entrada. `rebase eject` configura esto. |

Esto es independiente de *dónde* se ejecuta. Ambos se ejecutan en Rebase Cloud y ambos se autoalojan: el destino reside en `.rebase/cloud.json`, no en el manifiesto.

La parte importante es quién es el *propietario* de la lista. Un repositorio declara solo las aplicaciones que contiene; el proyecto es el propietario del conjunto de aplicaciones existentes. Dos repositorios nunca necesitan saber el uno del otro; solo necesitan conocer el proyecto. Eso es lo que hace que un repositorio de frontend independiente, o una aplicación móvil sin relación alguna de repositorio, sea algo cotidiano en lugar de un caso especial.

## `rebase.json`

El manifiesto declara la topología y nada más. El esquema, las reglas de seguridad, los hooks y las funciones permanecen en TypeScript, donde un sistema de tipos puede verificarlos.

```jsonc
{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" },
    "site": {
      "type": "static",
      "root": "frontend",
      "build": "npm run build --workspace frontend",
      "output": "frontend/dist",
      "path": "/"
    },
    "admin": {
      "type": "static",
      "root": "admin",
      "build": "npm run build --workspace admin",
      "output": "admin/dist",
      "path": "/admin"
    }
  }
}
```

Un solo proceso lo sirve todo: la API en `/api`, el sitio en `/`, el panel de administración en `/admin`. Esa es la historia del autoalojamiento y un nivel pequeño perfectamente adecuado en Rebase Cloud.

`path` es tanto una entrada en **tiempo de compilación** como en tiempo de servicio. Una aplicación montada en `/admin` tiene que ser *compilada* para `/admin`, o de lo contrario `index.html` se carga y todos los recursos devuelven un error 404: una página en blanco sin ningún error en ninguna parte. `rebase build` pasa el valor como `REBASE_APP_BASE`, que tu empaquetador lee como su ruta base:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

y se niega a enviar una compilación que lo haya ignorado.

Un proyecto existente no necesita uno. La CLI infiere la misma estructura a partir de la estructura de directorios, y `rebase apps init` la escribe cuando quieres que sea explícita:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

## Compilación y despliegue de aplicaciones

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

El backend se compila primero, porque la compilación de una aplicación cliente puede consumir un SDK generado a partir de sus colecciones.

## Múltiples repositorios

El monorepo sigue siendo la opción predeterminada: un repositorio con un backend y un panel de administración es lo más simple que funciona, y `rebase init` crea su estructura inicial. Dividirlo es el paso de graduación, no un requisito.

En un repositorio de frontend independiente necesitas dos cosas: un manifiesto que declare lo que aporta este repositorio y un enlace al proyecto:

```jsonc
// rebase.json
{
  "rebase": "^1",
  "apps": {
    "marketing": {
      "type": "static",
      "root": ".",
      "build": "npm run build",
      "output": "dist"
    }
  }
}
```

```bash
rebase cloud link https://api.example.com   # a self-hosted project
rebase cloud link                           # or pick a Rebase Cloud project
```

El enlace se escribe en `.rebase/cloud.json` y **no se incluye en los commits**; es por clonación, como un remoto de git. El manifiesto se incluye en los commits; el enlace no.

## Clientes con tipado sin las colecciones

Este es el mecanismo que hace que el enfoque multi-repositorio funcione. Un repositorio que no contiene colecciones genera su SDK con tipos a partir del propio proyecto:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

La CLI obtiene `/api/meta/contract`, reconstruye las definiciones de las colecciones (incluidos los objetivos de relación, que el generador de tipos necesita para decidir si una clave foránea es una cadena de texto o un número) y emite exactamente el mismo resultado que habría producido a partir del código fuente local.

El endpoint del contrato es solo para administradores. Las definiciones de las colecciones describen cada tabla, columna y relación en el proyecto, incluidas aquellas que ninguna regla de seguridad expondría jamás; eso es un mapa de la base de datos, no documentación pública de la API.

## Detección de desviaciones

Dividir los repositorios te cuesta una cosa que vale la pena señalar: un cambio de esquema y el frontend que lo utiliza ya no se incluyen en el mismo commit. El backend puede desplegar un cambio que deje desamparado a un cliente compilado con la estructura antigua.

Cada SDK generado registra el esquema del que proviene:

```ts
// src/rebase/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

Y cada proyecto publica su versión actual, sin autenticación, porque un sello de versión no revela nada sobre el esquema que representa:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a"}
```

Comparar ambos en CI convierte una desincronización silenciosa en una verificación fallida. El sello cambia cuando los tipos generados podrían cambiar (una nueva propiedad, una relación modificada) y deliberadamente *no* cambia cuando cambia un hook, una regla de seguridad o un icono, para no dar falsas alarmas.

## Configuración del cliente

```bash
rebase apps config web
```

Imprime lo que un cliente necesita para conectarse al proyecto. Nunca imprime un secreto: la URL de la API y la identidad publicable de una aplicación están pensadas para enviarse dentro de un paquete de cliente, y todo lo que no sea seguro allí no pertenece a una salida que terminará en un archivo `.env` incluido en el repositorio.

---
