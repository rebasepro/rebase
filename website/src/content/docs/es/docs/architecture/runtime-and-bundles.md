---
sourceHash: 47f5760918cfd724
title: Runtime y bundles
sidebar_label: Runtime y bundles
description: Cómo un proyecto Rebase se divide en un bundle de proyecto y un runtime con versiones, y por qué esa separación es lo que hace posibles las actualizaciones, las aplicaciones multi-repo y el hosting gestionado.
---

## Las dos mitades de un despliegue

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un despliegue de Rebase consta de dos partes, no de una:

- **El bundle** — tu proyecto. Tablas compiladas, hooks, funciones y tareas cron,
  más un manifiesto generado que describe lo que necesitan.
- **El runtime** — el motor. `@rebasepro/server`, distribuido como la imagen de
  contenedor publicada `rebasepro/server`.

Se compilan, versionan y distribuyen por separado. De esa única decisión se
desprende todo lo demás en esta página: dado que el motor no está integrado en la
imagen de tu aplicación, puede reemplazarse por debajo de tu proyecto —para una
corrección de seguridad, una mejora de rendimiento o una nueva funcionalidad—
sin tener que recompilar nada de lo que hayas escrito.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  backend/schema/*.ts       ──►   dist-bundle/backend/schema/  ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/             + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

El runtime que autoalojas es el mismo runtime que ejecuta Rebase Cloud. No hay
una compilación de "plataforma" separada, y nada del nivel gestionado deja de
estar disponible para alguien que ejecute `docker compose up`.

## Compilar un bundle

```bash
rebase build
```

Esto regenera el esquema de la base de datos a partir de tus tablas, comprueba los
tipos y las compila, resuelve los especificadores de importación para que Node
pueda cargar la salida directamente y escribe `dist-bundle/` conteniendo:

| Ruta | Qué es |
| --- | --- |
| `manifest.json` | Generado. El contrato que este bundle afirma satisfacer. |
| `package.json` | Generado. Las dependencias en tiempo de ejecución de tu proyecto. |
| `backend/schema/` | Tablas compiladas: el `index` que las exporta y un módulo por tabla. |
| `backend/resources.js`, `backend/storage.js`, `backend/hooks.js` | Los módulos compilados que el runtime lee junto a las tablas, cuando el proyecto los tiene. |
| `backend/functions/` | Funciones del servidor compiladas. |
| `backend/crons/` | Tareas cron compiladas. |
| `backend/src/schema.generated.js` | Esquema de base de datos compilado. |

Vale la pena comprender el manifiesto, ya que es lo que un runtime valida antes
de aceptar iniciar:

```jsonc
{
  "bundleFormat": 3,
  "runtime": { "range": "^1", "builtAgainst": "0.30.1", "contract": 2 },
  "schemaVersion": "v2:3f0c9a1e7d2b5c48",
  "kind": "backend",
  "entry": {
    "tables": "backend/schema",
    "resources": "backend/resources.js",
    "storage": "backend/storage.js",
    "functions": "backend/functions",
    "static": [{ "path": "/", "dir": "static/admin", "spa": true }]
  },
  "tables": ["authors", "posts", "tags", "users"],
  "hooks": { "native": false },
  "storage": { "authorize": true },
  "deps": { "declared": { "zod": "^4.4.3" } }
}
```

<span class="since-badge" data-since="0.31">Desde 0.31</span> `bundleFormat`
3 y contrato de runtime 2: el esquema es `entry.tables`, el directorio compilado
`backend/schema`, junto a `entry.resources`, `entry.storage` y
`entry.hooks`. `schemaVersion` comienza con `v2:` — se calcula a partir de las
tablas compiladas.

`kind` es o bien `backend` —inicia el servidor, más cualquier aplicación estática en
`entry.static`— o `static`, que sirve esos recursos y nada más: sin base de
datos, sin autenticación. Que un backend declare sus tablas en código o las
introspeccione desde la base de datos en vivo no es un tercer tipo; simplemente
depende de si `entry.tables` está presente.

## Ejecutar un bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` carga el bundle en el mismo proceso, por lo que las señales y
los stack traces te llegan directamente. Localmente vincula las dependencias que
ya tienes instaladas dentro del bundle para que no haya una segunda instalación;
un despliegue instala en su lugar el propio `package.json` del bundle.

## Compatibilidad

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Dos números de versión rigen si un bundle y un runtime pueden funcionar juntos,
y deliberadamente no son la versión del paquete.

**`bundleFormat`** es la disposición en disco. Un runtime rechaza un formato
más nuevo en lugar de cargarlo a medias. Un bundle más antiguo en un runtime
más nuevo sigue funcionando siempre que el diseño lo permita —ese es el
propósito de la separación— con una excepción: **un bundle de formato 1 o formato 2
es rechazado** por un runtime 0.31. Esos bundles contienen `config/collections`
—objetos `defineCollection`— y un runtime que solo lee `backend/schema` no tiene
con qué leerlos; iniciar uno introspeccionaría la base de datos en lugar de
servir las tablas declaradas. El rechazo indica la solución: ejecuta
[`rebase migrate collections-to-tables`](/docs/cli/schema/#rebase-migrate) en el
código fuente del proyecto y luego vuelve a compilar el bundle.

**`runtime.contract`** es la interfaz entre un bundle y el motor; 0.31 lo
subió a `2`. Dentro de una versión principal del contrato, cualquier bundle
que haya validado seguirá validando. Los parches y versiones menores son
reemplazos directos (drop-in); una versión principal no lo es, y un runtime
rechazará un bundle de una versión principal diferente en lugar de iniciarse
y fallar más adelante.

Por esto es que actualizar Rebase en un despliegue autoalojado es simplemente
un cambio de etiqueta:

```yaml
image: rebasepro/server:0.30.1   # a newer tag — your bundle is untouched
```

## El desarrollo utiliza la misma vía

`rebase dev` inicia el mismo runtime sobre tu código fuente de TypeScript en
lugar de un bundle compilado. La recarga en caliente sigue funcionando, y el
entorno de desarrollo predice la producción porque ambos pasan por una misma
ruta de arranque en lugar de tener dos implementaciones que divergen con el
tiempo.

Un proyecto que necesite algo que el runtime predeterminado no proporciona aún
puede escribir su propio `backend/src/index.ts` e importar el servidor como una
biblioteca. `rebase dev` lo detecta y lo ejecuta. Consulta [Servidor personalizado](/docs/backend/custom-server/)
— pierdes el runtime predeterminado, pero no la superficie de la API.

## Lo que el runtime lee del entorno

El runtime se configura completamente mediante variables de entorno, porque eso
es en lo que coinciden todos los destinos de despliegue.

| Variable | Significado |
| --- | --- |
| `DATABASE_URL` | Cadena de conexión para la base de datos predeterminada. Obligatoria. |
| `JWT_SECRET` | Secreto de firma, al menos 32 caracteres. Obligatorio en producción. |
| `CORS_ORIGINS` | Orígenes separados por comas autorizados a llamar a la API. Obligatorio en producción. |
| `PORT` | Puerto al que vincularse. Por defecto `3001` localmente, `8080` en la imagen. |
| `REBASE_SERVICE_KEY` | Clave servidor a servidor que concede acceso de administrador. |
| `REBASE_METRICS` | `true` para exponer métricas de Prometheus en `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `ensure` —el valor predeterminado en todas partes, incluida la producción— ejecuta el paso de aprovisionamiento aditivo; `none` deja el esquema intacto. Cualquier otro valor rehúsa iniciar, y la imagen del runtime también rechaza `push`. |
| `REBASE_SERVE_STATIC` | Servir los recursos estáticos del bundle desde este proceso. Activado por defecto. |

Varias bases de datos y varios buckets se configuran añadiendo como sufijo la
clave de origen a la variable — consulta [Múltiples bases de datos y buckets](/docs/backend/multiple-sources/).

## Endpoints que el runtime siempre sirve

| Ruta | Propósito |
| --- | --- |
| `GET /health` | Preparación (Readiness). Realiza un viaje de ida y vuelta a la base de datos. |
| `GET /livez` | Vitalidad (Liveness). Deliberadamente *no* toca la base de datos, para que un fallo temporal en la base de datos no haga que un orquestador detenga un proceso sano. |
| `GET /api/meta/schema-version` | La versión actual del esquema. Sin autenticación — es una marca de versión, no un esquema. |
| `GET /api/schema/tables` | Las tablas, tal como cada solicitante puede verlas — a partir de lo cual renderiza el panel de administración. Consulta [Endpoints](/docs/backend/endpoints/#schema). |
| `GET /api/meta/contract` | La versión del esquema, el runtime y cada tabla como la ve un administrador. Requiere `schema:read`. |
| `GET /metrics` | Métricas de Prometheus, cuando `REBASE_METRICS=true`. |
