---
sourceHash: 8861ca94a0de827a
title: Desplegando Rebase en Hetzner Cloud
description: Despliega Rebase en Hetzner Cloud con Terraform o Docker Compose, para un rendimiento excelente y soberanía de datos en la UE.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud ofrece una relación rendimiento-precio excepcionalmente buena y es una opción sólida para proyectos que necesitan soberanía de datos europea, con centros de datos en Núremberg, Falkenstein y Helsinki.

Nada de lo que hay aquí es específico de Hetzner con respecto a tu proyecto. Un despliegue de Rebase consta de dos partes separables: la imagen de runtime publicada y el **bundle** que produce `rebase build`, y el mismo bundle se ejecuta con Docker Compose en una portátil, en Rebase Cloud, con el [Helm chart](/docs/deployment/kubernetes) y en una máquina de Hetzner. Moverse entre ellos es un cambio de infraestructura, no de la aplicación.

## El camino más rápido: Terraform

El módulo `terraform-hcloud-rebase` aprovisiona el servidor, un cortafuegos, una IP estable y —la parte más importante— un volumen que contiene los datos de Postgres, de modo que reemplazar el host no destruye la base de datos.

```hcl
module "rebase" {
  source = "rebasepro/rebase/hcloud"

  domain          = "api.example.com"
  cors_origins    = ["https://app.example.com"]
  ssh_public_keys = [file(pathexpand("~/.ssh/id_ed25519.pub"))]

  bundle_url = "https://storage.example.com/bundles/app-1.4.0.tar.gz"

  s3_bucket            = "example-uploads"
  s3_access_key_id     = var.s3_access_key_id
  s3_secret_access_key = var.s3_secret_access_key
}
```

Algo que debes configurar bien antes del primer apply: el registro A para `domain` ya debe apuntar al servidor, o de lo contrario el desafío Let's Encrypt de Caddy fallará. La dirección se crea de forma independiente del servidor, por lo que puedes obtenerla primero con `terraform apply -target=hcloud_primary_ip.ipv4`, configurar el DNS y luego aplicar adecuadamente.

El resto de esta página muestra el mismo despliegue hecho a mano.

## 1. Aprovisionar un servidor

1. En la consola de Hetzner Cloud, haz clic en **Add Server**.
2. Elige una **Location** — Falkenstein, Núremberg o Helsinki para la residencia de datos en la UE.
3. Elige una **Image**: Ubuntu 24.04.
4. Elige un **Type**: `CPX21` (3 vCPU / 4GB) es un mínimo viable, `CX32` (4 vCPU / 8GB) es cómodo para el runtime más Postgres.
5. Añade un **Volume** para la base de datos. Los datos en el propio disco del servidor mueren con el servidor.
6. Añade tu clave SSH y créalo.

## 2. Instalar Docker

```bash
ssh root@<your-server-ip>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Llevar tu bundle al servidor

No hay ninguna imagen de aplicación que compilar. `rebase build` produce un directorio `dist-bundle`, y la imagen de runtime publicada lo ejecuta:

```bash
rebase build
rsync -a dist-bundle/ root@<your-server-ip>:/opt/rebase/dist-bundle/
```

Para un despliegue real, prefiere una de las dos opciones que no implican copiar archivos a una máquina manualmente:

- **Integrarlo en una imagen (bake)** — `FROM rebasepro/server:0.20.0`, luego `COPY dist-bundle /bundle` y despliega cambiando una etiqueta.
- **Servirlo por HTTP** — define `REBASE_BUNDLE_URL` y el runtime descargará y descomprimirá el bundle en cada inicio. Esto es lo que hace el módulo de Terraform anterior, y el mismo mecanismo que utiliza el Helm chart.

## 4. Configurar y ejecutar

Rebase incluye un archivo Compose exactamente para esto: [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Es la receta canónica para el autoalojamiento —Postgres y el runtime, con tu bundle montado dentro— y vale la pena leerlo en lugar de solo copiarlo, porque sus comentarios explican cada decisión.

Crea el entorno que espera:

```env
POSTGRES_PASSWORD=a_long_random_string
JWT_SECRET=another_long_random_string_at_least_32_chars
REBASE_SERVICE_KEY=a_third_long_random_string_at_least_32_chars
CORS_ORIGINS=https://app.yourdomain.com
REBASE_ADMIN_EMAIL=you@yourdomain.com
REBASE_ADMIN_PASSWORD=at_least_twelve_characters
```

`REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` son nuevos: en la versión 0.17.3,
la primera cuenta en registrarse se convierte en administradora, también en producción.

Las seis son obligatorias: el archivo Compose las declara con `${VAR:?…}` y
se niega a interpolar sin ellas.

Las dos últimas corresponden al primer administrador. Una base de datos nueva no tiene usuarios y,
fuera de producción, el primer registro se promueve a admin, lo cual es una condición de carrera
desde el momento en que esta máquina responde en un nombre de host, ya que Caddy tiene TLS activo
antes de que hayas escrito nada. Por lo tanto, en producción esa ventana se cierra y la cuenta se
define aquí; el runtime la crea una sola vez, mientras la tabla de usuarios está vacía, y
no hace nada en los arranques posteriores. Inicia sesión y cambia la contraseña.

Luego, levántalo:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

El runtime escucha en el puerto 8080 dentro de la red de Compose.

`REBASE_SERVICE_KEY` omite la seguridad a nivel de fila (row-level security). Trátala como una credencial de superusuario de base de datos, no como una clave de API.

## 5. Terminar TLS con Caddy

Nunca expongas el runtime directamente. Caddy aprovisiona certificados Let's Encrypt automáticamente; ejecutarlo como otro servicio de Compose mantiene todo el stack en un solo archivo:

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
```

Con un `Caddyfile` como este:

```caddyfile
api.yourdomain.com {
    reverse_proxy api:8080
}
```

Apunta el registro A de ese dominio al servidor antes de iniciar Caddy, o la solicitud de certificado fallará.

## El almacenamiento no es opcional

El runtime **se niega a iniciar en producción** con almacenamiento local configurado, porque el sistema de archivos del contenedor se destruye en cada reinicio y un backend local en producción implica una pérdida silenciosa de datos.

Hetzner Object Storage es compatible con S3 y se encuentra en los mismos centros de datos, por lo que es la combinación natural:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Si tu proyecto no almacena ningún archivo subido, define `FORCE_LOCAL_STORAGE=true` para reconocerlo explícitamente. Consulta [Storage](/docs/backend/storage) para ver todos los detalles.

## Qué hace el arranque con tu esquema

Con `REBASE_MIGRATE_ON_BOOT` en su valor predeterminado `ensure`, el runtime aprovisiona las tablas de tus colecciones **y sus políticas de seguridad a nivel de fila** en el arranque, de forma aditiva. Un primer inicio con una base de datos vacía se pone en marcha sirviéndolas: no hay ningún paso previo de esquema que ejecutar antes de que el despliegue funcione.

Lo que el arranque deliberadamente nunca hace es algo destructivo: no modifica el tipo de una columna, no elimina una columna ni edita una etiqueta de enum existente. Un reinicio de contenedor no debe tener la capacidad de remodelar un esquema como efecto secundario.

Por lo tanto, dos cosas todavía requieren [`rebase db push`](/docs/architecture/schema-as-code), ejecutado desde un checkout o CI donde la verificación de cambios destructivos y una copia de seguridad estén a mano:

- RLS en tablas intermedias (junction tables) para relaciones de muchos a muchos;
- cualquier cambio que no sea puramente aditivo.

Si el módulo o el archivo Compose vincularon Postgres a loopback —ambos lo hacen—, accede a él a través de un túnel SSH:

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<your-server-ip>
```

Un puerto de base de datos abierto a internet es la forma en que un despliegue de Rebase permite que lean sus filas eludiendo la seguridad a nivel de fila en lugar de pasar por ella.

## Actualización

Cambia la etiqueta de la imagen y reinicia. Tu bundle permanece intacto y cada proyecto en ese runtime adoptará el nuevo motor.

La excepción es la versión principal (major version) de Postgres: Postgres se niega a iniciar sobre un directorio de datos escrito por una versión principal anterior, por lo que esa actualización se realiza mediante volcado y restauración, nunca in situ.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

---
