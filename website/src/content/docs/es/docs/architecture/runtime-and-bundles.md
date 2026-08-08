---
title: Runtime y Bundles
sidebar_label: Runtime y Bundles
description: Cómo un proyecto de Rebase se divide en un paquete (bundle) de proyecto y un runtime con versiones, y por qué esa separación es lo que permite las actualizaciones, las aplicaciones multi-repositorio y el hosting administrado.
---

## Las dos mitades de un despliegue

Un despliegue de Rebase consiste en dos cosas, no en una:

- **El bundle** — tu proyecto. Colecciones compiladas, hooks, funciones y tareas cron, además de un manifiesto generado que describe lo que necesitan.
- **El runtime** — el motor. `@rebasepro/server`, distribuido como la imagen de contenedor publicada `rebasepro/server`.

Se construyen, versionan y distribuyen por separado. De esa única decisión se deriva todo lo demás en esta página: debido a que el motor no está integrado en la imagen de tu aplicación, se puede reemplazar debajo de tu proyecto —para una corrección de seguridad, una mejora de rendimiento o una nueva función— sin tener que volver a compilar nada de lo que escribiste.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

El runtime que alojas por tu cuenta es el mismo runtime que ejecuta Rebase Cloud. No existe una compilación de "plataforma" separada, y nada de lo que ofrece el nivel administrado deja de estar disponible para alguien que ejecute `docker compose up`.

## Construir un bundle

```bash
rebase build
```

Esto regenera el esquema de la base de datos a partir de tus colecciones, verifica los tipos y los compila, resuelve los especificadores de importación para que Node pueda cargar la salida directamente y escribe `dist-bundle/`, que contiene:

| Ruta | Qué es |
| --- | --- |
| `manifest.json` | Generado. El contrato que este bundle pretende satisfacer. |
| `package.json` | Generado. Las dependencias del runtime de tu proyecto. |
| `config/` | Colecciones compiladas. |
| `backend/functions/` | Funciones del servidor compiladas. |
| `backend/crons/` | Tareas cron compiladas. |
| `backend/src/schema.generated.js` | Esquema de la base de datos compilado. |

Vale la pena entender el manifiesto, ya que es lo que un runtime valida antes de aceptar arrancar:

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.13.0", "contract": 1 },
  "schemaVersion": "v1:c5d97d0f96b7f87a",
  "kind": "backend",
  "entry": {
    "config": "config",
    "functions": "backend/functions",
    "static": [{ "path": "/", "dir": "static/admin", "spa": true }]
  },
  "hooks": { "native": false },
  "deps": { "declared": { "zod": "^4.4.3" } }
}
```

`kind` es `backend` —arranca el servidor, más cualquier aplicación estática en `entry.static`— o `static`, que sirve esos activos y nada más: sin base de datos, sin autenticación. Que un backend declare sus colecciones en código o las inspeccione desde la base de datos en vivo no es un tercer tipo; simplemente depende de si `entry.config` está presente.

## Ejecutar un bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` carga el bundle dentro del proceso, de modo que las señales y las trazas de la pila (stack traces) te lleguen directamente. Localmente, vincula las dependencias que ya tienes instaladas con el bundle para que no haya una segunda instalación; un despliegue instala en su lugar el propio `package.json` del bundle.

## Compatibilidad

Dos números de versión gobiernan si un bundle y un runtime pueden funcionar juntos, y deliberadamente no son la versión del paquete.

**`bundleFormat`** es la disposición en disco. Un runtime acepta cualquier bundle cuyo formato sea menor o igual al suyo, y rechaza uno más nuevo en lugar de cargarlo a medias. Un bundle más antiguo en un runtime más nuevo debe seguir funcionando —ese es todo el propósito de la separación, por lo que un runtime lee todos los formatos que ha distribuido en su historia. Los bundles de formato 1, que nombraban a este campo `mode` y contenían un único directorio estático, todavía arrancan sin cambios.

**`runtime.contract`** es la interfaz entre un bundle y el motor. Dentro de una versión mayor del contrato, cualquier bundle que haya sido validado sigue siendo válido. Las versiones parche (patches) y menores (minors) se pueden sustituir directamente; una versión mayor no lo es, y un runtime rechazará un bundle de una versión mayor diferente en lugar de arrancar y funcionar mal después.

Por eso, actualizar Rebase en un despliegue autosostenido (self-hosted) consiste simplemente en cambiar la etiqueta (tag):

```yaml
image: rebasepro/server:0.13.0   # was 0.12.0 — your bundle is untouched
```

## El desarrollo utiliza la misma ruta

`rebase dev` arranca el mismo runtime sobre tu código fuente de TypeScript en lugar de un bundle compilado. La recarga en caliente (hot reload) sigue funcionando, y el entorno de desarrollo predice la producción porque ambos pasan por una sola ruta de arranque en lugar de dos implementaciones que se desvían.

Un proyecto que necesite algo que el runtime por defecto no ofrece aún puede escribir su propio `backend/src/index.ts` e importar el servidor como una biblioteca. `rebase dev` lo detecta y lo ejecuta. Consulta [Servidor personalizado](/docs/backend/custom-server/): pierdes el runtime por defecto, pero no la superficie de la API.

## Lo que lee el runtime desde el entorno

El runtime se configura completamente mediante variables de entorno, porque eso es en lo que coinciden todos los entornos de despliegue.

| Variable | Significado |
| --- | --- |
| `DATABASE_URL` | Cadena de conexión para la base de datos predeterminada. Requerido. |
| `JWT_SECRET` | Secreto de firma, al menos 32 caracteres. Requerido en producción. |
| `CORS_ORIGINS` | Orígenes separados por comas autorizados para llamar a la API. Requerido en producción. |
| `PORT` | Puerto al que vincularse. Predeterminado `3001` localmente, `8080` en la imagen. |
| `REBASE_SERVICE_KEY` | Clave servidor a servidor que concede acceso de administrador. |
| `REBASE_METRICS` | `true` para exponer métricas de Prometheus en `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `none`, `ensure` o `push`. Por defecto es `none` en producción. |
| `REBASE_SERVE_STATIC` | Sirve los activos estáticos del bundle desde este proceso. Activado por defecto. |

Se pueden configurar varias bases de datos y varios buckets agregando un sufijo con la clave de origen a la variable; consulta [Múltiples bases de datos y buckets](/docs/backend/multiple-sources/).

## Endpoints que el runtime siempre ofrece

| Ruta | Propósito |
| --- | --- |
| `GET /health` | Estado de preparación (Readiness). Realiza una ida y vuelta (round-trip) a la base de datos. |
| `GET /livez` | Estado de vida (Liveness). Deliberadamente *no* toca la base de datos, para que un fallo temporal de la base de datos no haga que un orquestador elimine un proceso sano. |
| `GET /api/meta/schema-version` | La versión actual del esquema. Sin autenticación: es un sello de versión, no un esquema. |
| `GET /api/meta/contract` | El contrato completo de colecciones. Solo administradores. |
| `GET /metrics` | Métricas de Prometheus, cuando `REBASE_METRICS=true`. |

---
