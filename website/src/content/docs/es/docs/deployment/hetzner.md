---
sourceHash: ed3d35fa1a4e347f
title: Desplegar Rebase en Hetzner Cloud
description: Despliega un proyecto de Rebase en un único servidor de Hetzner Cloud con su propio archivo Docker Compose y Caddy para HTTPS, o aprovisiónalo con Terraform, para alojamiento basado en la UE.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud ofrece una relación rendimiento-precio excepcionalmente buena y es una opción sólida para proyectos que necesitan soberanía de datos europea, con centros de datos en Núremberg, Falkenstein y Helsinki.

Nada de lo que hay aquí sobre tu proyecto es específico de Hetzner. Un despliegue de Rebase se compone de dos partes separables: la imagen del runtime publicada y el **bundle** que genera `rebase build`, y el mismo bundle se ejecuta bajo Docker Compose en un portátil, en Rebase Cloud, bajo el [Helm chart](/docs/deployment/kubernetes) y en un servidor de Hetzner. Moverse entre ellos es un cambio de infraestructura, no de aplicación.

Dos formas de lograrlo:

- **[Un servidor, desde tu proyecto](#one-server-from-your-project):** el archivo `docker-compose.yml` generado por `rebase init`, en un servidor creado manualmente. Las subidas de archivos permanecen en el disco del servidor.
- **[Terraform](#terraform):** un módulo que aprovisiona el servidor, el cortafuegos, la IP, TLS y un volumen que sobrevive al host.

## One server, from your project

Un proyecto generado con `rebase init` ya incluye el despliegue: un `docker-compose.yml` que ejecuta Postgres y el runtime publicado con tu bundle montado, sirve el panel de administración en `/` y la API en `/api` desde un único contenedor, y guarda las subidas en un volumen. Esta sección coloca ese archivo en un servidor y sitúa Caddy delante de él para HTTPS.

### 1. Crear el servidor

1. En la consola de Hetzner Cloud, haz clic en **Add Server**.
2. Elige una ubicación (**Location**): Falkenstein, Núremberg o Helsinki para residencia de datos en la UE.
3. Elige la imagen **Ubuntu 24.04**.
4. Elige un tipo con al menos **2 vCPU y 4 GB de RAM**. El runtime, Postgres y Caddy los compartirán.
5. Activa las copias de seguridad (**Backups**). La base de datos y las subidas residen en el disco de este servidor, y las copias de seguridad son lo único que sobrevivirá si se pierde.
6. Añade tu clave SSH y créalo.

Apunta ahora un registro A de tu dominio (en el ejemplo siguiente, `app.example.com`) a la dirección del servidor. Caddy lo necesita para obtener un certificado.

### 2. Instalar Docker y Caddy

```bash
ssh root@<server-ip>
apt update && apt install -y docker.io docker-compose-v2 caddy
mkdir -p /opt/my-app
```

### 3. Compilar el bundle y copiarlo

Desde tu proyecto, en tu máquina:

```bash
rebase build
rsync -a docker-compose.yml .env dist-bundle root@<server-ip>:/opt/my-app/
```

`rebase build` compila tus colecciones, funciones y tareas cron en `dist-bundle/`, junto con sus dependencias y el panel de administración compilado. No hay ninguna imagen de aplicación que construir: el servidor ejecuta la imagen del runtime publicada con ese directorio montado en ella.

### 4. Adaptar la configuración para producción

En el servidor, edita `/opt/my-app/.env`. `rebase init` lo configuró para tu portátil. Modifica estas líneas:

```env
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
```

Mantén los valores generados para `DATABASE_PASSWORD`, `JWT_SECRET`, `REBASE_SERVICE_KEY` y `REBASE_ADMIN_PASSWORD`, o reemplázalos por valores nuevos generados con `openssl rand -hex 32`. El archivo Compose los lee de aquí y se detendrá mostrando un mensaje que indicará cualquiera que falte.

El archivo solo pasa al servicio `api` las variables que nombra, por lo que el resto del `.env` (entre ellas `NODE_ENV=development`) no llega al runtime. El servicio se ejecuta con `NODE_ENV=production`. Cualquier variable que el archivo no liste debe colocarse en el bloque `environment:` del servicio.

`REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` corresponden al primer administrador. En producción, la primera cuenta que se registra no se promociona automáticamente, por lo que el runtime crea esta en el primer arranque, mientras la tabla de usuarios está vacía. Inicia sesión con ella y cambia la contraseña. Consulta [Tu primer administrador](/docs/getting-started/deployment/#your-first-admin).

A continuación, en `/opt/my-app/docker-compose.yml`, vincula ambos puertos publicados a loopback:

```yaml
  db:
    ports:
      - "127.0.0.1:5490:5432"
  api:
    ports:
      - "127.0.0.1:${PORT:-3001}:3001"
```

Tal como se genera, el archivo publica Postgres y la API en todas las interfaces, lo cual en un portátil es inofensivo. En un servidor público expone la base de datos a internet, y Docker publica puertos saltándose `ufw`, por lo que una regla de cortafuegos no los cerrará. Con `127.0.0.1`, únicamente Caddy y los túneles SSH podrán acceder a ellos.

### 5. Iniciarlo

```bash
cd /opt/my-app
docker compose up -d
```

El primer inicio crea todas las tablas necesarias, incluidas las de tus colecciones, junto con sus políticas de seguridad a nivel de fila (Row-Level Security).

### 6. Terminar TLS con Caddy

Reemplaza `/etc/caddy/Caddyfile` con:

```caddyfile
app.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

```bash
systemctl reload caddy
```

Caddy obtiene un certificado de Let's Encrypt para el dominio y lo renueva automáticamente. Abre `https://app.example.com` e inicia sesión.

### Desplegar de nuevo

Vuelve a compilar, copia el bundle y reinicia el runtime:

```bash
rebase build
rsync -a --delete dist-bundle/ root@<server-ip>:/opt/my-app/dist-bundle/
ssh root@<server-ip> 'cd /opt/my-app && docker compose restart api'
```

Copiar un directorio a un servidor manualmente está bien para una sola máquina. Más allá de eso, utiliza una de las alternativas que no lo requieran:

- **Integrarlo en una imagen.** `FROM rebasepro/server:0.30.1`, después `COPY --chown=node:node dist-bundle /bundle`, y despliega cambiando una etiqueta.
- **Servirlo a través de HTTP.** Configura `REBASE_BUNDLE_URL` y el runtime descargará y descomprimirá el bundle en cada inicio. El módulo de Terraform que se muestra a continuación hace esto, y el Helm chart utiliza el mismo mecanismo.

## Terraform

El módulo `terraform-hcloud-rebase` aprovisiona el servidor, un cortafuegos, una IP estable y —la parte más importante— un volumen que contiene los datos de Postgres, de modo que reemplazar el host no destruye la base de datos. Ejecuta el runtime publicado bajo Docker Compose con Caddy al frente y obtiene tu bundle desde una URL.

El módulo no está en el Terraform Registry. Úsalo desde el repositorio de Rebase, fijado a una versión:

```hcl
module "rebase" {
  source = "git::https://github.com/rebasepro/rebase.git//infra/terraform-hcloud-rebase?ref=v0.30.1"

  domain          = "api.example.com"
  cors_origins    = ["https://app.example.com"]
  ssh_public_keys = [file(pathexpand("~/.ssh/id_ed25519.pub"))]
  admin_email     = "you@example.com"

  bundle_url      = "https://storage.example.com/bundles/app-1.4.0.tar.gz"
  runtime_version = "0.30.1" # required with bundle_url: `latest` is refused at plan

  s3_bucket            = "example-uploads"
  s3_access_key_id     = var.s3_access_key_id
  s3_secret_access_key = var.s3_secret_access_key
}
```

Un aspecto crucial antes del primer `apply`: el registro A para `domain` ya debe apuntar al servidor, o el desafío de Let's Encrypt de Caddy fallará. La dirección se crea de forma independiente al servidor, por lo que puedes obtenerla primero con `terraform apply -target=module.rebase.hcloud_primary_ip.ipv4`, configurar el DNS y luego aplicar el despliegue completo.

El archivo [README](https://github.com/rebasepro/rebase/tree/main/infra/terraform-hcloud-rebase) del módulo enumera todas las variables.

## Almacenamiento de archivos

**Las subidas pueden quedarse en el servidor.** El archivo Compose del proyecto las mantiene en un volumen con nombre, montado en `/storage`, y establece `FORCE_LOCAL_STORAGE=true`. Sobreviven a reinicios y redespliegues. No sobreviven a la pérdida del servidor, que es para lo que sirven las copias de seguridad de Hetzner.

Sin esa configuración, el runtime rechaza el almacenamiento local en producción. En la mayoría de las plataformas de contenedores, el sistema de archivos se reemplaza en cada despliegue, por lo que un backend local provocaría una pérdida silenciosa de datos. En ese caso, las subidas responderán con `501 STORAGE_NOT_CONFIGURED` hasta que se configure un bucket.

Cuando superes la capacidad de un solo disco, o ejecutes un segundo servidor, migra las subidas a Hetzner Object Storage. Es compatible con S3 y se encuentra en los mismos centros de datos. En el bloque `environment:` del servicio `api`, reemplaza `STORAGE_PATH` y `FORCE_LOCAL_STORAGE` por:

```yaml
      STORAGE_TYPE: s3
      S3_BUCKET: my-uploads
      S3_ENDPOINT: https://fsn1.your-objectstorage.com
      S3_REGION: fsn1
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
```

con ambas claves en `.env`. Los archivos que ya estén en el volumen no se migran por sí solos: cópialos al bucket manteniendo sus claves.

El módulo de Terraform ofrece la misma elección mediante variables: un bucket S3 o `force_local_storage = true`, que mantiene las subidas en su volumen de datos. Consulta [Almacenamiento](/docs/backend/storage) para obtener una visión completa.

## Qué hace el arranque con tu esquema

Con `REBASE_MIGRATE_ON_BOOT` en su valor por defecto `ensure`, el runtime aprovisiona las tablas de tus colecciones **y sus políticas de seguridad a nivel de fila** durante el arranque, de forma aditiva. Una nueva colección estará activa en el siguiente despliegue, sin necesidad de ejecutar un paso previo de esquema.

Lo que el arranque deliberadamente nunca hace es algo destructivo: no modifica el tipo de una columna, no elimina columnas ni edita una etiqueta enum existente. Un reinicio del contenedor nunca debe ser capaz de alterar la estructura de un esquema como efecto secundario.

Por lo tanto, hay algo que sigue necesitando [`rebase db push`](/docs/architecture/schema-as-code): cualquier cambio que no sea estrictamente aditivo (una columna renombrada, un tipo más restrictivo, un campo eliminado). Ejecútalo desde tu copia local del código, a través de un túnel SSH hacia el puerto de loopback:

```bash
ssh -N -L 5490:127.0.0.1:5490 root@<server-ip>
pnpm exec rebase db push --dry-run \
  --database-url 'postgresql://rebase_app:<DATABASE_PASSWORD>@localhost:5490/rebase?sslmode=disable'
```

Revisa el SQL generado por el simulacro (dry run) y luego ejecútalo de nuevo sin `--dry-run`. `sslmode=disable` está ahí porque la base de datos de Compose no tiene TLS; el túnel es el que cifra la conexión.

Un puerto de base de datos abierto a internet es la forma en que un despliegue de Rebase permite que se lean filas eludiendo la seguridad a nivel de fila en lugar de pasar por ella. Mantenlo en loopback y utiliza el túnel.

## Actualizaciones

Cambia `REBASE_VERSION` en `.env` y vuelve a crear el runtime:

```bash
docker compose pull api && docker compose up -d api
```

Tu bundle no se modificará.

La excepción es la versión principal de Postgres: Postgres se niega a arrancar sobre un directorio de datos escrito por una versión principal anterior, por lo que esa actualización se realiza mediante volcado y restauración, nunca de forma directa sobre los datos existentes.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

## Siguientes pasos

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación para producción y las reglas del primer administrador comunes a todas las plataformas.
- [Autohospedaje](/docs/deployment/self-hosting) — el mismo despliegue sin estructuras preconfiguradas, con un agrupador de conexiones y procesos divididos.
- [Configuración](/docs/getting-started/configuration) — todas las variables de entorno que lee el runtime.
