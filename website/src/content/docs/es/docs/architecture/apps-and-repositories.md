---
sourceHash: f90b94eda083f704
title: Apps y repositorios
sidebar_label: Apps y repositorios
description: Un proyecto es un backend más las apps que se comunican con él, cada una de las cuales puede residir en su propio repositorio.
---

## Proyectos y apps

Un **proyecto** es el backend: la base de datos, autenticación, almacenamiento, tiempo real y
funciones. Una **app** es algo que se comunica con él.

| Tipo | Qué es |
| --- | --- |
| `backend` | Las colecciones, hooks y funciones que definen la API. Exactamente uno por proyecto. |
| `static` | Un bundle de cliente compilado: una SPA o sitio estático, servido en su propia ruta. |

Esa es toda la lista. El panel de administración es una app `static` como cualquier otra: se
compila en tu repositorio, contra tus colecciones, por lo que los campos personalizados
y las vistas personalizadas funcionan en él desde el primer día.

Quién posee el proceso del servidor es una propiedad del backend, no un tipo de app
independiente:

| `runtime` | Qué significa |
| --- | --- |
| `managed` | La imagen de runtime de la plataforma ejecuta tu bundle. Tú proporcionas colecciones, funciones, crons y esquemas. |
| `custom` | Tú proporcionas el servidor: tu propio Dockerfile y entrypoint. `rebase eject` configura esto. |

Esto es independiente de *dónde* se ejecuta. Ambos se ejecutan en Rebase Cloud y ambos
se pueden autohospedar; el destino reside en `.rebase/cloud.json`, no en el manifiesto.

La parte importante es quién *posee* la lista. Un repositorio declara solo las apps
que contiene; el proyecto posee el conjunto de apps que existen. Dos repositorios nunca
necesitan saber el uno del otro; solo necesitan conocer el proyecto. Eso es lo que
hace que un repositorio frontend independiente, o una aplicación móvil sin relación de repositorio
alguna, sea algo común en lugar de un caso especial.

## `rebase.json`

El manifiesto declara la topología, y nada más. El esquema, las reglas de seguridad, los hooks
y las funciones permanecen en TypeScript, donde un sistema de tipos puede verificarlos.

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
      "path": "/admin",
      "cms": "/admin"
    }
  }
}
```

Un solo proceso sirve todo: la API en `/api`, el sitio en `/`, el admin en
`/admin`. Esa es la propuesta de autohospedaje, y un nivel pequeño perfectamente válido en
Rebase Cloud.

## Indicar dónde está el CMS

`cms` es la ruta URL donde una app monta `<RebaseCMS>`. Es opcional, es
el único campo aquí que describe qué hay *dentro* de una app en lugar de dónde
reside la app, y existe porque ninguna otra cosa puede averiguarlo.

El CMS es un componente de React en tu propio frontend, por lo que su dirección es una
ruta del lado del cliente. No es una ruta del servidor, no es un archivo en la compilación y no se
distingue de cualquier otra ruta no coincidente bajo una SPA: una solicitud a
`/admin` obtiene el mismo `index.html` que una solicitud a `/anything-else`. Por lo tanto, ningún
despliegue, ningún servidor en ejecución y ninguna cantidad de sondeo puede determinar dónde está tu panel
de administración. Si no lo especificas, nada lo sabrá.

Lo que lo sabe, hace algo con ello:

- **Rebase Cloud** coloca un enlace *Open CMS* en el encabezado del proyecto y lista la
  dirección en la vista general del proyecto. Sin `cms`, la consola solo puede ofrecer
  el host del proyecto, el cual solo llega al CMS si este casualmente se encuentra en
  su raíz.
- **`rebase dev`** imprime la URL del CMS en su banner de inicio cuando no es
  simplemente la página principal del frontend.
- **`rebase apps list`** lo muestra junto a la app que lo sirve.

Dos formas, y ambas son comunes:

```jsonc
// The whole app is the CMS — what `rebase init` scaffolds.
"admin": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/" }

// The CMS is one route of a bigger app, sharing its session and its client.
"web": { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/", "cms": "/admin" }
```

El valor es la dirección que escribirías, no una ruta relativa a `path`, y tiene
que estar dentro de la app que lo declara: el fallback de SPA de esa app es lo que
responde allí. Un proyecto tiene un solo CMS; declarar un segundo es un error en lugar de
un lanzamiento de moneda para decidir a cuál enlaza la consola.

`path` es una entrada tanto en **tiempo de compilación** como para servir la aplicación. Una app montada en
`/admin` debe ser *compilada* para `/admin`, o de lo contrario `index.html` se cargará y todos los recursos
darán error 404: una página en blanco sin ningún error visible. `rebase build` pasa el valor como
`REBASE_APP_BASE`, que tu empaquetador lee como su ruta base:

```ts
// vite.config.ts
export default defineConfig({
  base: process.env.REBASE_APP_BASE ?? "/",
  // …
});
```

y se niega a entregar una compilación que lo haya ignorado.

Un proyecto existente no necesita uno. La CLI infiere la misma estructura a partir de la
disposición de directorios, y `rebase apps init` lo escribe cuando deseas que sea
explícito:

```bash
rebase apps list      # what this repository contributes
rebase apps init      # write an inferred rebase.json
```

## Compilar y desplegar apps

```bash
rebase build              # every app in this repository
rebase build backend      # just the bundle
rebase build admin        # just that app's static assets
```

El backend se compila primero, porque la compilación de una app cliente puede consumir un SDK
generado a partir de sus colecciones.

## Múltiples repositorios

El monorepo sigue siendo la opción predeterminada: un repositorio con un backend y un panel de administración
es lo más simple que funciona, y `rebase init` genera su estructura inicial. Dividirlo es
el paso de graduación, no un requisito.

En un repositorio frontend independiente necesitas dos cosas: un manifiesto que declare
qué aporta este repositorio y un enlace al proyecto:

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

El enlace se escribe en `.rebase/cloud.json` y **no se commitea**; es
específico de cada checkout, como un git remote. El manifiesto se commitea; el enlace no.

## Clientes tipados sin las colecciones

Este es el mecanismo que hace funcionar el enfoque multi-repo. Un repositorio que no contiene
colecciones genera su SDK tipado a partir del proyecto mismo:

```bash
rebase generate-sdk --from link
rebase generate-sdk --from https://api.example.com --token $REBASE_SERVICE_KEY
```

La CLI obtiene `/api/meta/contract`, reconstruye las definiciones de las colecciones
—incluidos los destinos de las relaciones, que el generador de tipos necesita para decidir si una
clave foránea es una cadena de texto o un número— y emite exactamente la misma salida que habría
producido a partir del código fuente local.

El endpoint del contrato es solo para administradores. Las definiciones de colección describen cada tabla,
columna y relación en el proyecto, incluidas aquellas que ninguna regla de seguridad expondría
jamás; eso es un mapa de la base de datos, no documentación pública de la API.

## Detectar drift

Dividir los repositorios tiene un costo digno de mención: un cambio de esquema y el
frontend que lo usa ya no coinciden en el mismo commit. El backend puede desplegar un
cambio que deje desamparado a un cliente compilado con la estructura anterior.

Cada SDK generado registra el esquema del que proviene:

```ts
// src/rebase/schema.meta.ts — generated
export const SCHEMA_VERSION = "v1:c5d97d0f96b7f87a";
```

Y cada proyecto publica el suyo actual, sin autenticación, porque una
marca de versión no revela nada sobre el esquema al que representa:

```bash
curl -s https://api.example.com/api/meta/schema-version
# {"schemaVersion":"v1:c5d97d0f96b7f87a"}
```

Comparar ambos en CI convierte un desajuste silencioso en una comprobación fallida. La marca
cambia cuando los tipos generados podrían cambiar —una nueva propiedad, una relación
modificada— y deliberadamente *no* cuando cambia un hook, una regla de seguridad o un icono,
evitando así falsas alarmas.

## Configuración del cliente

```bash
rebase apps config web
```

Imprime lo que un cliente necesita para conectarse al proyecto. Nunca imprime un secreto: la
URL de la API y la identidad publicable de una app están diseñadas para enviarse dentro de un bundle
de cliente, y todo lo que no sea seguro allí no debe estar en una salida que terminará
en un archivo `.env` commiteado.

## Relacionado

- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — lo que produce `rebase build` y lo que lo inicializa
- [Split Processes](/docs/deployment/split-processes/) — ejecutar un solo bundle como varios procesos
- [CLI Commands](/docs/cli/) — `rebase apps` y el resto

---
