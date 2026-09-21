---
sourceHash: 61fe21675b54e7a5
title: Runtime y Bundles
sidebar_label: Runtime y Bundles
description: Cómo se divide un proyecto de Rebase en un bundle de proyecto y un runtime versionado, y por qué esa separación es lo que hace posibles las actualizaciones, las aplicaciones multi-repo y el alojamiento gestionado.
---

## Las dos mitades de un despliegue

Un despliegue de Rebase consta de dos partes, no de una:

- **El bundle** — tu proyecto. Colecciones compiladas, hooks, funciones y tareas
  cron, además de un manifiesto generado que describe lo que necesitan.
- **El runtime** — el motor. `@rebasepro/server`, distribuido como la imagen de
  contenedor `rebasepro/server` publicada.

Se compilan, versionan y distribuyen por separado. De esa única decisión se deriva
todo lo demás en esta página: dado que el motor no está integrado en la imagen de
tu aplicación, se puede reemplazar por debajo de tu proyecto —para una corrección
de seguridad, una mejora de rendimiento o una nueva característica— sin necesidad
de recompilar nada de lo que hayas escrito.

```
  your repository                 built artifact              running container
  ───────────────                 ──────────────              ─────────────────
  config/collections/*.ts   ──►   dist-bundle/config/     ──►  rebasepro/server
  backend/functions/*.ts          dist-bundle/backend/         + /bundle mounted
  rebase.json                     dist-bundle/manifest.json
```

El runtime que autoalojas es el mismo runtime que ejecuta Rebase Cloud. No existe
una compilación de "plataforma" independiente, y nada del nivel gestionado es
inaccesible para alguien que ejecute `docker compose up`.

## Construir un bundle

```bash
rebase build
```

Esto regenera el esquema de la base de datos a partir de tus colecciones, comprueba
sus tipos y las compila, resuelve los especificadores de importación para que Node
pueda cargar la salida directamente y escribe en `dist-bundle/`, que contiene:

| Path | What it is |
| --- | --- |
| `manifest.json` | Generado. El contrato que este bundle afirma cumplir. |
| `package.json` | Generado. Las dependencias de runtime de tu proyecto. |
| `config/` | Colecciones compiladas. |
| `backend/functions/` | Funciones del servidor compiladas. |
| `backend/crons/` | Tareas cron compiladas. |
| `backend/src/schema.generated.js` | Esquema de la base de datos compilado. |

Vale la pena entender el manifiesto, ya que es lo que valida un runtime antes de
aceptar arrancar:

```jsonc
{
  "bundleFormat": 2,
  "runtime": { "range": "^1", "builtAgainst": "0.22.0", "contract": 1 },
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

`kind` es `backend` —arranca el servidor, más cualquier aplicación estática en
`entry.static`— o `static`, que sirve esos recursos y nada más: sin base de
datos, sin autenticación. Que un backend declare sus colecciones en código o las
introspeccione desde la base de datos en vivo no constituye un tercer tipo;
simplemente depende de si `entry.config` está presente o no.

## Ejecutar un bundle

```bash
rebase start                       # locally
docker run -v ./dist-bundle:/bundle rebasepro/server   # anywhere
```

`rebase start` carga el bundle en el mismo proceso, por lo que las señales y las
trazas de pila (stack traces) te llegan directamente. En local, vincula tus
dependencias ya instaladas al bundle para que no sea necesaria una segunda
instalación; en cambio, un despliegue instala el propio `package.json` del bundle.

## Compatibilidad

Dos números de versión determinan si un bundle y un runtime pueden funcionar
juntos, y deliberadamente no corresponden a la versión del paquete.

**`bundleFormat`** es la disposición en disco. Un runtime acepta cualquier bundle
cuyo formato sea menor o igual al suyo y rechaza uno más nuevo en lugar de cargarlo
a medias. Un bundle más antiguo en un runtime más nuevo debe seguir funcionando; ese
es el propósito fundamental de la separación, por lo que un runtime lee todos los
formatos que ha distribuido en su historia. Los bundles de formato 1, que llamaban a
este campo `mode` e incluían un único directorio estático, todavía arrancan sin cambios.

**`runtime.contract`** es la interfaz entre un bundle y el motor. Dentro de una
versión principal (major) de un contrato, cualquier bundle que haya sido validado
sigue siendo válido. Las revisiones (patches) y las versiones menores (minors) son
sustituciones directas; una versión mayor no lo es, y un runtime rechazará un bundle
de una versión principal diferente antes de arrancar y funcionar de manera incorrecta
más tarde.

Por esto es que actualizar Rebase en un despliegue autoalojado es simplemente un
cambio de etiqueta:

```yaml
image: rebasepro/server:0.22.0   # a newer tag — your bundle is untouched
```

## El desarrollo utiliza la misma ruta

`rebase dev` arranca el mismo runtime sobre tu código fuente de TypeScript en
lugar de un bundle compilado. La recarga en caliente sigue funcionando, y el
desarrollo refleja fielmente la producción porque ambos pasan por una única ruta
de arranque en lugar de dos implementaciones que divergen con el tiempo.

Un proyecto que necesite algo que el runtime predeterminado no haga todavía puede
escribir su propio `backend/src/index.ts` e importar el servidor como una biblioteca.
`rebase dev` lo detecta y lo ejecuta. Consulta [Servidor personalizado](/docs/backend/custom-server/)
— pierdes el runtime predeterminado, no la superficie de la API.

## Lo que el runtime lee del entorno

El runtime se configura en su totalidad mediante variables de entorno, ya que es el
estándar común a cualquier destino de despliegue.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Cadena de conexión para la base de datos predeterminada. Obligatoria. |
| `JWT_SECRET` | Secreto de firma, de al menos 32 caracteres. Obligatorio en producción. |
| `CORS_ORIGINS` | Orígenes separados por comas autorizados para llamar a la API. Obligatorio en producción. |
| `PORT` | Puerto al que vincularse. Por defecto `3001` en local, `8080` en la imagen. |
| `REBASE_SERVICE_KEY` | Clave de servidor a servidor que concede acceso de administrador. |
| `REBASE_METRICS` | `true` para exponer métricas de Prometheus en `/metrics`. |
| `REBASE_MIGRATE_ON_BOOT` | `none` deja el esquema intacto; cualquier otro valor —incluido si no se define— ejecuta el paso de aprovisionamiento aditivo. Por defecto es `ensure` en todas partes, incluida la producción. |
| `REBASE_SERVE_STATIC` | Sirve los recursos estáticos del bundle desde este proceso. Activado por defecto. |

Se pueden configurar varias bases de datos y varios buckets añadiendo como sufijo a
la variable la clave de origen — consulta [Múltiples bases de datos y buckets](/docs/backend/multiple-sources/).

## Endpoints que el runtime siempre sirve

| Path | Purpose |
| --- | --- |
| `GET /health` | Preparación (Readiness). Realiza un ciclo de ida y vuelta a la base de datos. |
| `GET /livez` | Funcionamiento (Liveness). Deliberadamente *no* interactúa con la base de datos, para que una falla momentánea en la base de datos no cause que un orquestador detenga un proceso en buen estado. |
| `GET /api/meta/schema-version` | La versión actual del esquema. Sin autenticación: es una marca de versión, no un esquema. |
| `GET /api/meta/contract` | El contrato completo de colecciones. Solo para administradores. |
| `GET /metrics` | Métricas de Prometheus, cuando `REBASE_METRICS=true`. |
