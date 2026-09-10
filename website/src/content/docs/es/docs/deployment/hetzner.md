---
sourceHash: 39e0a58a37e930cb
title: Desplegar Rebase en Hetzner Cloud
description: Despliega Rebase en Hetzner Cloud con Terraform o Docker Compose, para un rendimiento excelente y soberanía de datos en la UE.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud ofrece una relación rendimiento-precio excepcionalmente buena y es una opción sólida para proyectos que necesitan soberanía de datos europea, con centros de datos en Núremberg, Falkenstein y Helsinki.

Nada de lo que se describe aquí sobre su proyecto es específico de Hetzner. Un despliegue de Rebase consta de dos piezas separables: la imagen del runtime publicada y el **bundle** que genera `rebase build`, y el mismo bundle se ejecuta con Docker Compose en una laptop, en Rebase Cloud, bajo el [Helm chart](/docs/deployment/kubernetes) y en una máquina de Hetzner. Moverse entre ellos es un cambio de infraestructura, no de aplicación.

## El camino más rápido: Terraform

El módulo `terraform-hcloud-rebase` aprovisiona el servidor, un firewall, una IP estable y —la parte fundamental— un volumen que almacena los datos de Postgres, de modo que reemplazar el host no destruye la base de datos.

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

Un aspecto a tener en cuenta antes del primer apply: el registro A para `domain` ya debe apuntar al servidor, o el desafío de Let's Encrypt de Caddy fallará. La dirección se crea de forma independiente del servidor, por lo que puede obtenerla primero con `terraform apply -target=hcloud_primary_ip.ipv4`, configurar el DNS y luego aplicar los cambios correctamente.

El resto de esta página explica el mismo despliegue realizado manualmente.

## 1. Aprovisionar un servidor

1. En la consola de Hetzner Cloud, haga clic en **Add Server**.
2. Elija una **Location**: Falkenstein, Núremberg o Helsinki para residencia de datos en la UE.
3. Elija una **Image**: Ubuntu 24.04.
4. Elija un **Type**: `CPX21` (3 vCPU / 4GB) es un mínimo viable, `CX32` (4 vCPU / 8GB) es holgado para el runtime más Postgres.
5. Agregue un **Volume** para la base de datos. Los datos en el disco propio del servidor desaparecen con el servidor.
6. Agregue su clave SSH y créelo.

## 2. Instalar Docker

```bash
ssh root@<your-server-ip>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Llevar su bundle al servidor

No hay una imagen de la aplicación para compilar. `rebase build` genera un directorio `dist-bundle` y la imagen del runtime publicada lo ejecuta:

```bash
rebase build
rsync -a dist-bundle/ root@<your-server-ip>:/opt/rebase/dist-bundle/
```

Para un despliegue real, prefiera una de las dos modalidades que no implican copiar archivos manualmente a la máquina:

- **Empaquetarlo en una imagen** — `FROM rebasepro/server:0.20.0`, luego `COPY dist-bundle /bundle`, y desplegar cambiando una etiqueta.
- **Servirlo a través de HTTP** — configure `REBASE_BUNDLE_URL` y el runtime descargará y descomprimirá el bundle en cada inicio. Esto es lo que hace el módulo de Terraform anterior y es el mismo mecanismo que utiliza el Helm chart.

## 4. Configurar y ejecutar

Rebase incluye un archivo Compose exactamente para esto: [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Es la receta canónica para el autoalojamiento —Postgres y el runtime, con su bundle montado dentro— y vale la pena leerlo en lugar de solo copiarlo, porque sus comentarios explican cada decisión.

Cree el entorno que este espera:

```env
POSTGRES_PASSWORD=a_long_random_string
JWT_SECRET=another_long_random_string_at_least_32_chars
REBASE_SERVICE_KEY=a_third_long_random_string_at_least_32_chars
CORS_ORIGINS=https://app.yourdomain.com
REBASE_ADMIN_EMAIL=you@yourdomain.com
REBASE_ADMIN_PASSWORD=at_least_twelve_characters
```

`REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD` son nuevos: en la versión 0.17.3
la primera cuenta que se registra se convierte en la administradora, también en producción.

Los seis son obligatorios; el archivo Compose los declara con `${VAR:?…}` y
se niega a interpolar sin ellos.

Los dos últimos corresponden al primer administrador. Una base de datos nueva no tiene usuarios y,
fuera de producción, el primer registro se promueve a admin, lo cual se convierte en una condición de carrera
en el momento en que esta máquina responde en un nombre de host, ya que Caddy tiene TLS activo antes de que haya
escrito nada. Por lo tanto, en producción esa ventana se cierra y la cuenta se define
aquí en su lugar; el runtime la crea una sola vez, mientras la tabla de usuarios esté vacía, y
no hace nada en cada inicio posterior. Inicie sesión y cambie la contraseña.

Luego inícielo:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

El runtime escucha en el puerto 8080 dentro de la red de Compose.

`REBASE_SERVICE_KEY` elude la seguridad a nivel de fila (row-level security). Trátela como una credencial de superusuario de la base de datos, no como una clave de API.

## 5. Terminar TLS con Caddy

Nunca exponga el runtime directamente. Caddy aprovisiona certificados de Let's Encrypt automáticamente; ejecutarlo como otro servicio de Compose mantiene todo el stack en un solo archivo:

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

Apunte el registro A de ese dominio al servidor antes de iniciar Caddy, o la solicitud del certificado fallará.

## El almacenamiento no es opcional

El runtime **se niega a iniciar en producción** si está configurado con almacenamiento local, porque el sistema de archivos del contenedor se destruye en cada reinicio y un backend local en producción equivale a una pérdida silenciosa de datos.

Hetzner Object Storage es compatible con S3 y se encuentra en los mismos centros de datos, por lo que es la combinación natural:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Si su proyecto no almacena ninguna subida en absoluto, establezca `FORCE_LOCAL_STORAGE=true` para confirmarlo explícitamente. Consulte [Storage](/docs/backend/storage) para obtener más detalles.

## Qué hace el arranque con su esquema

Con `REBASE_MIGRATE_ON_BOOT` en su valor predeterminado de `ensure`, el runtime aprovisiona las tablas de sus colecciones **y sus políticas de seguridad a nivel de fila** durante el arranque, de forma aditiva. Un primer inicio con una base de datos vacía se levanta sirviéndolas: no hay ningún paso de esquema que deba ejecutarse antes de que el despliegue funcione.

Lo que el arranque deliberadamente nunca hace es algo destructivo: no altera el tipo de una columna, no elimina una columna ni edita una etiqueta de enum existente. Un reinicio de contenedor no debe poder remodelar un esquema como efecto secundario.

Por lo tanto, dos cosas todavía requieren [`rebase db push`](/docs/architecture/schema-as-code), ejecutado desde un checkout o CI donde el control de cambios destructivos y una copia de seguridad estén al alcance:

- RLS en tablas intermedias para relaciones many-to-many;
- cualquier cambio que no sea puramente aditivo.

Si el módulo o el archivo Compose vincularon Postgres a loopback (ambos lo hacen), acceda a él a través de un túnel SSH:

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<your-server-ip>
```

Un puerto de base de datos abierto a internet es la manera en que un despliegue de Rebase permite que sus filas se lean eludiendo la seguridad a nivel de fila en lugar de a través de ella.

## Actualización

Cambie la etiqueta de la imagen y reinicie. Su bundle permanecerá intacto y cada proyecto en ese runtime adoptará el nuevo motor.

La excepción es la versión principal de Postgres: Postgres se niega a iniciar sobre un directorio de datos escrito por una versión principal anterior, por lo que esa actualización se realiza mediante volcado y restauración, nunca in situ.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

---
