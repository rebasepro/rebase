---
title: Autoalojamiento
sidebar_label: Autoalojamiento
description: "Ejecuta Rebase en cualquier lugar con la imagen de runtime oficial y el bundle de tu proyecto: Docker Compose, Fly, Railway o un VPS común."
---

## Descripción general

Autoalojar Rebase significa ejecutar dos cosas: una base de datos Postgres y la
imagen oficial `rebasepro/server` con el bundle de tu proyecto montado en ella.

**No hay ninguna imagen de aplicación que construir**. Tu proyecto viaja como un bundle,
el runtime está publicado y actualizar Rebase es un cambio de etiqueta (tag) en lugar de una
reconstrucción. Consulta [Runtime y bundles](/docs/architecture/runtime-and-bundles/) para
saber por qué está dividido de esa manera.

## Docker Compose

El archivo de compose vive en el repositorio, en
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Usa ese en lugar de copiar un fragmento de esta página: es el archivo que la
verificación de aceptación del proyecto arranca en cada push, así que no puede
divergir de lo que realmente funciona.

```bash
rebase build                    # produce ./dist-bundle
./infra/docker/quickstart.sh    # escribe infra/docker/.env si falta, y lo levanta
```

`quickstart.sh` es un comando que hace dos cosas evidentes e imprime ambas. La
forma larga, si prefieres controlar cada paso:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

No hace falta arrancar la base de datos por separado: `api` espera a su
healthcheck.

### Los cuatro valores que necesita

`quickstart.sh` los genera por ti. Para escribir el `.env` a mano:

```bash
cat > infra/docker/.env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
REBASE_SERVICE_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://app.example.com
EOF
```

Tres secretos y un dato:

- **`POSTGRES_PASSWORD`** — la contraseña de la base de datos. Cambiarla más
  tarde implica cambiarla también en el volumen, así que elígela una vez.
- **`JWT_SECRET`** — firma cada sesión. Rotarlo cierra la sesión de todo el mundo.
- **`REBASE_SERVICE_KEY`** — la credencial que salta la seguridad a nivel de fila
  para llamadas servidor a servidor. Trátala como una contraseña de root:
  cualquiera que la tenga puede leer todas las filas.
- **`CORS_ORIGINS`** — los orígenes desde los que se sirve tu frontend, separados
  por comas. No es un secreto, y tampoco es opcional: en producción el runtime se
  niega a arrancar en vez de adivinar, porque una API que adivina sus orígenes
  permitidos acaba permitiendo el equivocado.

Cada uno de los tres secretos debe tener al menos 32 caracteres. El archivo de
compose los declara con `${VAR:?…}`, de modo que si falta uno el stack se detiene
con un mensaje que lo nombra, en lugar de arrancar algo a medio configurar.

## Dependencias

`rebase build` **instala las dependencias de tu proyecto dentro del bundle** por
defecto, así que `dist-bundle` llega con un `node_modules` y un
`package-lock.json` junto a su `package.json`. Un bundle así arranca en unos
cinco segundos.

Como ya están ahí, puedes montar el bundle en solo lectura — algo que vale la
pena, porque así un hook comprometido no puede reescribir el código que se
ejecuta tras el siguiente reinicio:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` renuncia a eso y produce un bundle que instala sus
dependencias en el primer arranque, lo que tarda entre 40 y 60 segundos por
arranque y necesita que el montaje sea escribible.

Para un despliegue real, es preferible hornear ambos en una imagen, lo que
además fija exactamente lo que se ejecuta:

```dockerfile
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

## Creación del esquema

**El runtime crea las tablas que faltan al arrancar, incluidas las de tus
colecciones.** `REBASE_MIGRATE_ON_BOOT` vale `ensure` por defecto, que es aditivo
en todo el esquema: crea tablas, columnas y tipos enum que falten, y aplica su
seguridad a nivel de fila. Un primer arranque contra una base de datos vacía
levanta sirviendo tus colecciones, sin ningún paso aparte.

Lo que `ensure` nunca hace, deliberadamente, es cambiar algo que ya existe. No
altera el tipo de una columna, no elimina tablas ni columnas y no edita las
etiquetas de un enum existente, porque el reinicio de un contenedor no debe poder
reformar un esquema como efecto secundario de un despliegue.

Por eso `rebase db push` sigue mereciendo la pena, para las dos cosas que el
arranque deja de lado:

```bash
rebase db push
```

- **RLS de las tablas puente** de las relaciones muchos a muchos.
- **Cualquier cambio que no sea puramente aditivo**: una columna renombrada, un
  tipo restringido, un campo eliminado.

Ejecútalo desde un checkout o un job de CI, apuntando a la base de datos del
despliegue. Primero hace una simulación, rechaza los cambios destructivos sin
confirmación explícita y puede hacer una copia de seguridad antes de aplicar. En
el archivo de compose la base de datos publica un puerto para que esto pueda
alcanzarla desde el host; quita ese mapeo cuando el esquema ya esté en su sitio
si la base de datos no debe ser accesible desde fuera.

`REBASE_MIGRATE_ON_BOOT` acepta `ensure` y `none`, y nada más: la imagen **se
niega a arrancar** con `push`, por el motivo anterior.

## Almacenamiento de archivos

El almacenamiento está **desactivado** mientras no haya un bucket configurado, y
es deliberado: la alternativa por defecto sería el sistema de archivos del
contenedor, que pierde en silencio cada archivo subido en el siguiente reinicio.
Las subidas se rechazan con `501 STORAGE_NOT_CONFIGURED` hasta que configures uno.

Para un bucket, define `STORAGE_TYPE=s3` (o `gcs`) más su bucket y credenciales;
el archivo de compose lista las variables, comentadas.

Para disco local, algo apropiado solo cuando la ruta es un volumen real que
sobrevive al contenedor:

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
    volumes:
      - uploads:/data/uploads
```

## Otras plataformas

El runtime es un contenedor ordinario que escucha en `$PORT`, por lo que cualquier sistema
que ejecute contenedores funcionará. Dos cosas que deben configurarse correctamente en todas partes:

1. El bundle debe estar presente en `/bundle` (o donde apunte `REBASE_BUNDLE`),
   con sus dependencias instaladas junto a él —consulta [Dependencias](#dependencies).
2. Configura `CORS_ORIGINS`, `JWT_SECRET` y `DATABASE_URL`. El runtime se negará a
   iniciar en producción sin ellos en lugar de adivinarlos.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.17.3"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utiliza la forma de imagen derivada descrita anteriormente para que el bundle se envíe con la aplicación y luego ejecuta `fly deploy`.

### Railway / Render

Apunta el servicio a la imagen derivada, configura las variables de entorno y define la
ruta de comprobación de estado (health check) en `/livez`.

### Un VPS común

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

Ejecútalo bajo systemd, con líneas `Environment=` para las variables anteriores.

## Verificaciones de estado

| Ruta | Uso |
| --- | --- |
| `/livez` | Vitalidad (Liveness). Responde a "¿está vivo este proceso?" sin tocar la base de datos. |
| `/health` | Disponibilidad (Readiness). Realiza una ida y vuelta (round-trip) a la base de datos y reporta la latencia. |

Apunta las pruebas de vitalidad (liveness probes) a `/livez`. Una prueba de vitalidad
en `/health` reiniciará un proceso perfectamente sano durante un pequeño problema temporal
de la base de datos, lo cual es lo opuesto a su propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expone métricas de Prometheus en `/metrics`: recuento de solicitudes e histogramas
de latencia desglosados por superficie de API (datos, auth, almacenamiento, funciones)
y colección, además de indicadores de proceso (gauges). Sin un token, el endpoint es
legible por cualquiera que pueda acceder al puerto, así que define uno a menos que esté
en una red privada.

## Ejecutar funciones en su propio proceso

Todo lo anterior es un contenedor que sirve el proyecto entero, que es la forma
correcta para casi cualquier despliegue. Cuando una función personalizada deba
dejar de competir con la API de datos por el bucle de eventos —o deba escalar,
reiniciarse y fallar por su cuenta— la misma imagen y el mismo bundle pueden
arrancarse como varios procesos que cooperan. Consulta
[Procesos divididos](/docs/deployment/split-processes/).

## Actualización

```yaml
image: rebasepro/server:0.17.3
```

Reinicia. Tu bundle no cambia. Dentro de una versión mayor del contrato del runtime,
un bundle que haya sido validado seguirá funcionando; consulta
[Compatibilidad](/docs/architecture/runtime-and-bundles/#compatibility).
