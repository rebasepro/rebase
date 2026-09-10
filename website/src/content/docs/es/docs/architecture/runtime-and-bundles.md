---
sourceHash: a4b27cb5ae61a96e
title: Runtime y Bundles
sidebar_label: Runtime y Bundles
description: Cómo un proyecto de Rebase se divide en un bundle de proyecto y un runtime versionado, y por qué esa separación es lo que hace posibles las actualizaciones, las aplicaciones multirepositorio y el alojamiento gestionado.
---

## Las dos mitades de un despliegue

Un despliegue de Rebase son dos cosas, no una:

- **El bundle** — tu proyecto. Colecciones compiladas, hooks, funciones y tareas cron, además de un manifiesto generado que describe lo que necesitan.
- **El runtime** — el motor. `@rebasepro/server`, distribuido como la imagen de contenedor publicada `rebasepro/server`.

Se compilan, versionan y distribuyen por separado. De esa única decisión se deriva todo lo demás en esta página: dado que el motor no está integrado en la imagen de tu aplicación, puede ser reemplazado debajo de tu proyecto —para una corrección de seguridad, una mejora de rendimiento o una nueva funcionalidad— sin tener que reconstruir nada de lo que escribiste.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

El runtime que alojas por tu cuenta es el mismo runtime que ejecuta Rebase Cloud. No existe una compilación de "plataforma" independiente, y nada del nivel administrado deja de estar disponible para alguien que ejecute `docker compose up`.

## Compilar un bundle

```bash
rebase build
```

Esto regenera el esquema de la base de datos a partir de tus colecciones, comprueba los tipos y las compila, resuelve los especificadores de importación para que Node pueda cargar la salida directamente, y genera `dist-bundle/` conteniendo:

| Ruta | Qué es |
| --- | --- |
| `manifest.json` | Generado. El contrato que este bundle afirma cumplir. |
| `package.json` | Generado. Las dependencias de runtime de tu proyecto. |
| `config/` | Colecciones compiladas. |
| `backend/functions/` | Funciones de servidor compiladas. |
| `backend/crons/` | Tareas cron compiladas. |
| `backend/src/schema.generated.js` | Esquema de base de datos compilado. |

Vale la pena entender el manifiesto, ya que es lo que valida un runtime antes de aceptar arrancar:

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.20.0", "contract": 1 },
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

`kind` puede ser `backend` —arranca el servidor, más cualquier aplicación estática en `entry.static`— o `static`, que sirve esos recursos y nada más: sin base de datos, sin autenticación. Que un backend declare sus colecciones en código o las introspeccione desde la base de datos en vivo no es un tercer tipo; simplemente depende de si `entry.config` está presente.

## Ejecutar un bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` carga el bundle dentro del mismo proceso, de modo que las señales y los stack traces te llegan directamente. A nivel local, vincula tus dependencias ya instaladas en el bundle para que no haya una segunda instalación; un despliegue, en su lugar, instala el propio `package.json` del bundle.

## Compatibilidad

Dos números de versión determinan si un bundle y un runtime pueden funcionar juntos, y deliberadamente no son la versión del paquete.

**`bundleFormat`** es la estructura en disco. Un runtime acepta cualquier bundle cuyo formato sea menor o igual al suyo propio, y rechaza uno más nuevo en lugar de cargarlo a medias. Un bundle más antiguo en un runtime más nuevo debe seguir funcionando —ese es el propósito principal de la separación, por lo que un runtime lee todos los formatos que ha distribuido en su historia. Los bundles de formato 1, que llamaban a este campo `mode` y contenían un único directorio estático, todavía arrancan sin cambios.

**`runtime.contract`** es la interfaz entre un bundle y el motor. Dentro de una versión principal (*major*) del contrato, cualquier bundle que haya validado seguirá siendo válido. Las versiones menores y los parches son reemplazos directos (*drop-in*); una versión principal no lo es, y el runtime rechazará un bundle de una versión diferente en lugar de arrancar y fallar más adelante.

Por esto, actualizar Rebase en un despliegue autoalojado es simplemente cambiar una etiqueta:

```yaml
image: rebasepro/server:0.20.0   # a newer tag — your bundle is untouched
```

## El desarrollo utiliza la misma ruta

`rebase dev` arranca el mismo runtime sobre tu código fuente TypeScript en lugar de sobre un bundle compilado. La recarga en caliente (*hot reload*) sigue funcionando, y el desarrollo predice la producción porque ambos utilizan la misma ruta de arranque en lugar de dos implementaciones que puedan divergir.

Un proyecto que necesite algo que el runtime predeterminado no ofrece puede escribir su propio `backend/src/index.ts` e importar el servidor como una librería. `rebase dev` lo detecta y lo ejecuta. Consulta [Servidor personalizado](/docs/backend/custom-server/) — pierdes el runtime predeterminado, pero no la superficie de la API.

## Qué lee el runtime del entorno

El runtime se configura en su totalidad mediante variables de entorno, ya que es el estándar común en cualquier destino de despliegue.

| Variable | Significado |
| --- | --- |
| `DATABASE_URL` | Cadena de conexión para la base de datos predeterminada. Obligatorio. |
| `JWT_SECRET` | Secreto de firma, de al menos 32 caracteres. Obligatorio en producción. |
| `CORS_ORIGINS` | Orígenes separados por comas autorizados para llamar a la API. Obligatorio en producción. |
| `PORT` | Puerto de escucha. Por defecto `3001` localmente, `8080` en la imagen. |
| `REBASE_SERVICE_KEY` | Clave de servidor a servidor que otorga acceso de administrador. |
| `REBASE_METRICS` | `true` para exponer métricas de Prometheus en `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `none` deja el esquema intacto; cualquier otro valor —incluido no estar definido— ejecuta el paso de aprovisionamiento aditivo. Por defecto es `ensure` en todas partes, incluida producción. |
| `REBASE_SERVE_STATIC` | Sirve los recursos estáticos del bundle desde este proceso. Activado por defecto. |

Se pueden configurar varias bases de datos y varios buckets añadiendo como sufijo la clave de origen a la variable; consulta [Múltiples bases de datos y buckets](/docs/backend/multiple-sources/).

## Endpoints que el runtime siempre sirve

| Ruta | Propósito |
| --- | --- |
| `GET /health` | Preparación (*Readiness*). Realiza una consulta de ida y vuelta a la base de datos. |
| `GET /livez` | Supervivencia (*Liveness*). Deliberadamente *no* interactúa con la base de datos, de modo que un fallo temporal en la base de datos no provoque que un orquestador destruya un proceso saludable. |
| `GET /api/meta/schema-version` | La versión actual del esquema. Sin autenticación — es una marca de versión, no un esquema. |
| `GET /api/meta/contract` | El contrato completo de colecciones. Solo para administradores. |
| `GET /metrics` | Métricas de Prometheus, cuando `REBASE_METRICS=true`. |

---
