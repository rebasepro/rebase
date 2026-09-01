---
title: Despliegue de Rebase en Hetzner Cloud
description: Despliega Rebase en Hetzner Cloud con Terraform o Docker Compose, para un rendimiento europeo excelente y soberanía de datos.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud ofrece una relación rendimiento-precio excepcional y es una opción sólida para proyectos que necesitan soberanía de datos europea, con centros de datos en Núremberg, Falkenstein y Helsinki.

Nada de esto es específico de Hetzner en lo que respecta a tu proyecto. Un despliegue de Rebase son dos piezas separables — la imagen del runtime publicada y el **bundle** que produce `rebase build` — y el mismo bundle se ejecuta bajo Docker Compose en un portátil, en Rebase Cloud, bajo el [chart de Helm](/docs/deployment/kubernetes) y en una máquina de Hetzner. Cambiar entre ellos cambia la infraestructura, no la aplicación.

## La vía más rápida: Terraform

El módulo `terraform-hcloud-rebase` aprovisiona el servidor, un cortafuegos, una IP estable y — lo que de verdad importa — un volumen que contiene los datos de Postgres, de modo que reemplazar el host no destruye la base de datos.

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

Hay algo que debe estar bien antes del primer apply: el registro A de `domain` ya tiene que apuntar al servidor, o el desafío de Let's Encrypt de Caddy fallará. La dirección se crea de forma independiente del servidor, así que puedes obtenerla primero con `terraform apply -target=hcloud_primary_ip.ipv4`, configurar el DNS y luego aplicar de verdad.

El resto de esta página es ese mismo despliegue a mano.

## 1. Crear un servidor

1. En la consola de Hetzner Cloud, haz clic en **Add Server**.
2. Elige una **ubicación** — Falkenstein, Núremberg o Helsinki para residencia de datos en la UE.
3. Elige una **imagen**: Ubuntu 24.04.
4. Elige un **tipo**: `CPX21` (3 vCPU / 4 GB) es el mínimo viable, `CX32` (4 vCPU / 8 GB) es cómodo para el runtime más Postgres.
5. Añade un **volumen** para la base de datos. Los datos en el disco propio del servidor mueren con el servidor.
6. Añade tu clave SSH y créalo.

## 2. Instalar Docker

```bash
ssh root@<ip-de-tu-servidor>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Llevar tu bundle al servidor

No hay ninguna imagen de aplicación que construir. `rebase build` produce un directorio `dist-bundle`, y la imagen del runtime publicada lo ejecuta:

```bash
rebase build
rsync -a dist-bundle/ root@<ip-de-tu-servidor>:/opt/rebase/dist-bundle/
```

Para un despliegue real, es preferible una de las dos formas que no implican copiar archivos a mano:

- **Hornearlo en una imagen** — `FROM rebasepro/server:0.17.3` y luego `COPY dist-bundle /bundle`; desplegar pasa a ser un cambio de etiqueta.
- **Servirlo por HTTP** — define `REBASE_BUNDLE_URL` y el runtime descarga y descomprime el bundle en cada arranque. Es lo que hace el módulo de Terraform de arriba, y el mismo mecanismo que usa el chart de Helm.

## 4. Configurar y arrancar

Rebase incluye un fichero Compose exactamente para esto: [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Es la receta canónica de autoalojamiento — Postgres y el runtime, con tu bundle montado — y merece la pena leerla en lugar de copiarla, porque sus comentarios explican cada decisión.

Crea el entorno que espera:

```env
POSTGRES_PASSWORD=una_cadena_larga_y_aleatoria
JWT_SECRET=otra_cadena_larga_de_al_menos_32_caracteres
REBASE_SERVICE_KEY=una_tercera_cadena_larga_de_al_menos_32_caracteres
CORS_ORIGINS=https://app.tudominio.com
```

Y levántalo:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

El runtime escucha en el puerto 8080 dentro de la red de Compose.

`REBASE_SERVICE_KEY` se salta la seguridad a nivel de fila. Trátala como una credencial de superusuario de base de datos, no como una clave de API.

## 5. Terminar TLS con Caddy

Nunca expongas el runtime directamente. Caddy provisiona certificados de Let's Encrypt automáticamente; ejecutarlo como otro servicio de Compose mantiene toda la pila en un solo fichero:

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
```

Con un `Caddyfile` así:

```caddyfile
api.tudominio.com {
    reverse_proxy api:8080
}
```

Apunta el registro A de ese dominio al servidor antes de arrancar Caddy, o la solicitud del certificado fallará.

## El almacenamiento no es opcional

El runtime **se niega a arrancar en producción** con almacenamiento local configurado, porque el sistema de ficheros del contenedor se destruye en cada reinicio y un backend local en producción es pérdida silenciosa de datos.

Hetzner Object Storage es compatible con S3 y está en los mismos centros de datos, así que es el emparejamiento natural:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Si tu proyecto no almacena ningún fichero, define `FORCE_LOCAL_STORAGE=true` para reconocerlo explícitamente. Consulta [Almacenamiento](/docs/backend/storage) para el panorama completo.

## Qué le hace el arranque a tu esquema

Con `REBASE_MIGRATE_ON_BOOT` en su valor por defecto `ensure`, el runtime aprovisiona tus tablas de colecciones **y sus políticas de seguridad a nivel de fila** al arrancar, de forma aditiva. Un primer arranque contra una base de datos vacía ya las sirve — no hay ningún paso de esquema que ejecutar antes de que el despliegue funcione.

Lo que el arranque deliberadamente nunca hace es nada destructivo: no altera un tipo de columna, no elimina una columna ni edita una etiqueta de enum existente. Un reinicio de contenedor no debe poder remodelar un esquema como efecto secundario.

Por eso dos cosas siguen necesitando [`rebase db push`](/docs/architecture/schema-as-code), ejecutado desde un checkout o desde CI, donde la barrera de cambios destructivos y una copia de seguridad están a mano:

- la RLS de tablas de unión para relaciones muchos-a-muchos;
- cualquier cambio que no sea puramente aditivo.

Si el módulo o el fichero Compose ataron Postgres a loopback — ambos lo hacen — alcánzalo por un túnel SSH:

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<ip-de-tu-servidor>
```

Un puerto de base de datos abierto a internet es la forma en que las filas de un despliegue Rebase acaban leyéndose esquivando la seguridad a nivel de fila en lugar de a través de ella.

## Actualizar

Cambia la etiqueta de la imagen y reinicia. Tu bundle queda intacto, y todos los proyectos sobre ese runtime recogen el nuevo motor.

La excepción es la versión mayor de Postgres: Postgres se niega a arrancar contra un directorio de datos escrito por una versión mayor anterior, así que esa actualización es siempre volcado y restauración, nunca in situ.

```bash
rebase db backup --out ./backups
# recrear el volumen en la nueva versión mayor
rebase db restore ./backups/<fichero>.dump
```
