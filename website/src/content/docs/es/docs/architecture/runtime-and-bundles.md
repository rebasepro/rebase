---
sourceHash: 236f1a01516e7d29
title: Runtime y bundles
sidebar_label: Runtime y bundles
description: Cómo un proyecto de Rebase se divide en un bundle de proyecto y un runtime versionado, y por qué esa separación es lo que hace posibles las actualizaciones, las aplicaciones multi-repo y el hosting administrado.
---

## Las dos mitades de un despliegue

Un despliegue de Rebase consta de dos elementos, no de uno:

- **El bundle** — tu proyecto. Colecciones compiladas, hooks, funciones y tareas
  cron, además de un manifiesto generado que describe lo que necesitan.
- **El runtime** — el motor. `@rebasepro/server`, distribuido como la imagen de
  contenedor publicada `rebasepro/server`.

Se construyen, versionan y distribuyen por separado. De esa única decisión se
desprende todo lo demás en esta página: dado que el motor no está integrado en la
imagen de tu aplicación, puede reemplazarse debajo de tu proyecto —para una
corrección de seguridad, una mejora de rendimiento o una nueva funcionalidad— sin
necesidad de reconstruir nada de lo que hayas escrito.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

El runtime que autohospedas es el mismo runtime que ejecuta Rebase Cloud. No hay
una compilación de "plataforma" separada, y nada en el nivel administrado deja de
estar disponible para alguien que ejecute `docker compose up`.

## Construir un bundle

```bash
rebase build
```

Esto regenera el esquema de la base de datos a partir de tus colecciones, comprueba
los tipos y las compila, resuelve los especificadores de importación para que Node
pueda cargar la salida directamente y escribe `dist-bundle/`, el cual contiene:

| Ruta | Qué es |
| --- | --- |
| `manifest.json` | Generado. El contrato que este bundle afirma satisfacer. |
| `package.json` | Generado. Las dependencias en tiempo de ejecución de tu proyecto. |
| `config/` | Colecciones compiladas. |
| `backend/functions/` | Funciones de servidor compiladas. |
| `backend/crons/` | Tareas cron compiladas. |
| `backend/src/schema.generated.js` | Esquema de base de datos compilado. |

Vale la pena entender el manifiesto, ya que es lo que un runtime valida antes de
aceptar arrancar:

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

`kind` puede ser `backend` —arranca el servidor, más cualquier aplicación estática
en `entry.static`— o `static`, que sirve esos recursos y nada más: sin base de
datos, sin autenticación. El hecho de que un backend declare sus colecciones en
código o las introspeccione desde la base de datos en vivo no constituye un tercer
tipo; se reduce simplemente a si `entry.config` está presente o no.

## Ejecutar un bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` carga el bundle dentro del proceso, por lo que las señales y los
rastreos de pila (stack traces) te llegan directamente. En local, vincula tus
dependencias ya instaladas al bundle para que no haya una segunda instalación; un
despliegue instala en su lugar el propio `package.json` del bundle.

## Compatibilidad

Dos números de versión determinan si un bundle y un runtime pueden funcionar
juntos, y deliberadamente no corresponden a la versión del paquete.

**`bundleFormat`** es la disposición en disco. Un runtime acepta cualquier bundle
cuyo formato sea menor o igual al suyo, y rechaza uno más nuevo en lugar de
cargarlo a medias. Un bundle más antiguo en un runtime más nuevo debe seguir
funcionando —ese es el propósito fundamental de la separación, por lo que un
runtime lee todos los formatos que se hayan publicado alguna vez—. Los bundles de
Formato 1, que llamaban a este campo `mode` e incluían un único directorio
estático, todavía arrancan sin cambios.

**`runtime.contract`** es la interfaz entre un bundle y el motor. Dentro de una
misma versión principal (*major*) del contrato, cualquier bundle que haya sido
validado continúa siéndolo. Los parches y versiones secundarias (*minors*) son
reemplazos directos; una versión principal no lo es, y un runtime rechazará un
bundle de una versión diferente en lugar de iniciarse y presentar fallos más
adelante.

Por esta razón, actualizar Rebase en un despliegue autohospedado es solo un cambio
de etiqueta:

```yaml
image: rebasepro/server:0.20.0   # a newer tag — your bundle is untouched
```

## El desarrollo utiliza la misma ruta

`rebase dev` arranca el mismo runtime sobre tu código fuente de TypeScript en
lugar de un bundle compilado. La recarga en caliente (*hot reload*) sigue
funcionando, y el entorno de desarrollo predice el comportamiento de producción
porque ambos pasan por una única ruta de arranque en lugar de dos
implementaciones sujetas a divergencias.

Un proyecto que necesite algo que el runtime predeterminado no proporciona puede
escribir su propio `backend/src/index.ts` e importar el servidor como una
biblioteca. `rebase dev` lo detecta y lo ejecuta. Consulta [Servidor personalizado](/docs/backend/custom-server/)
—pierdes el runtime predeterminado, pero no la superficie de la API.

## Lo que el runtime lee del entorno

El runtime se configura por completo mediante variables de entorno, ya que es el
mecanismo común en el que coinciden todos los destinos de despliegue.

| Variable | Significado |
| --- | --- |
| `DATABASE_URL` | Cadena de conexión para la base de datos predeterminada. Obligatoria. |
| `JWT_SECRET` | Secreto de firma, de al menos 32 caracteres. Obligatorio en producción. |
| `CORS_ORIGINS` | Orígenes separados por comas autorizados para llamar a la API. Obligatorio en producción. |
| `PORT` | Puerto de escucha. Por defecto `3001` en local, `8080` en la imagen. |
| `REBASE_SERVICE_KEY` | Clave servidor a servidor que otorga acceso de administrador. |
| `REBASE_METRICS` | `true` para exponer métricas de Prometheus en `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `none` deja el esquema intacto; cualquier otro valor —incluido no definirlo— ejecuta el paso de aprovisionamiento aditivo. Por defecto es `ensure` en todas partes, incluida producción. |
| `REBASE_SERVE_STATIC` | Sirve los recursos estáticos del bundle desde este proceso. Activado por defecto. |

Múltiples bases de datos y múltiples buckets se configuran añadiendo como sufijo a
la variable la clave de origen; consulta [Múltiples bases de datos y buckets](/docs/backend/multiple-sources/).

## Endpoints que el runtime siempre expone

| Ruta | Propósito |
| --- | --- |
| `GET /health` | Preparación (*Readiness*). Realiza un ciclo de ida y vuelta a la base de datos. |
| `GET /livez` | Actividad (*Liveness*). Deliberadamente *no* interactúa con la base de datos, de modo que una interrupción temporal de la base de datos no haga que un orquestador termine un proceso que funciona correctamente. |
| `GET /api/meta/schema-version` | La versión actual del esquema. Sin autenticación; es un sello de versión, no un esquema. |
| `GET /api/meta/contract` | El contrato completo de colecciones. Solo para administradores. |
| `GET /metrics` | Métricas de Prometheus, cuando `REBASE_METRICS=true`. |

---
