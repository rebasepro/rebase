---
sourceHash: fcd75234f992e56c
title: Desplegar Rebase en Microsoft Azure
description: Despliega tu instancia de Rebase de forma segura en Azure usando Azure Database for PostgreSQL y Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure ofrece integraciones estrechas y cumplimiento normativo empresarial. La arquitectura óptima para ejecutar Rebase en Azure utiliza **Azure Database for PostgreSQL – Flexible Server** para la capa de datos y **Azure Container Apps** para el runtime.

Para cumplir con las normativas europeas de datos y obtener tiempos de respuesta locales rápidos, aprovisiona tus recursos en regiones como **West Europe (Ámsterdam)**, **North Europe (Irlanda)** o **France Central (París)**.

Nada en esta página es específico de Azure respecto a tu proyecto. Un despliegue de Rebase consta de dos partes separables: la imagen del runtime publicada y el **bundle** que produce `rebase build`, y el mismo bundle se ejecuta bajo Docker Compose en un ordenador portátil, en Rebase Cloud, bajo el [Helm chart](/docs/deployment/kubernetes) y aquí.

## 1. Aprovisionar PostgreSQL Flexible Server

1. Desde Azure Portal, busca y selecciona **Azure Database for PostgreSQL servers**.
2. Haz clic en **Create** y selecciona **Flexible Server**.
3. Elige tu Resource Group y establece tu región de la UE preferida.
4. Selecciona el tamaño de Compute (por ejemplo, General Purpose, o Burstable `B2s` para despliegues más pequeños).
5. Configura la pestaña **Authentication** con un nombre de usuario administrador y una contraseña segura.
6. En **Networking**, asegúrate de que la opción "Allow public access from any Azure service within Azure to this server" esté marcada para que tu Container App pueda conectarse, o configura una VNet segura.
7. Anota el nombre de tu servidor y construye el URI de conexión:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Si tus colecciones declaran una propiedad `vector`, habilita la extensión una vez: Azure la restringe detrás del parámetro del servidor `azure.extensions`, luego ejecuta `CREATE EXTENSION vector;`.

## 2. Construir el bundle e integrarlo en una imagen

**No hay ninguna imagen de aplicación que compilar a partir de tu código fuente**. `rebase build` genera un directorio `dist-bundle` con tus colecciones, funciones y crons compilados y, si tu proyecto declara una aplicación estática, tu frontend compilado. La imagen de runtime publicada lo ejecuta:

```bash
rebase build
```

Container Apps extrae imágenes desde un registro, por lo que debes incorporar el bundle en una imagen derivada. Tres líneas, y fija exactamente lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.19.1
COPY dist-bundle /bundle
```

1. Crea un **Container Registry** en la región de la UE que hayas elegido.
2. Inicia sesión desde tu CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Compila y sube la imagen, desde la raíz del proyecto:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

Actualizar Rebase más adelante consistirá simplemente en cambiar esa línea `FROM`. Tu bundle no se modificará.

## 3. Desplegar la Container App

Azure Container Apps proporciona un entorno de contenedores serverless con ingress HTTPS integrado.

1. Busca **Container Apps** en el portal y haz clic en **Create**.
2. Crea un nuevo Container Apps Environment en tu región de la UE.
3. En la pestaña **Container**, apunta a tu registro de ACR y selecciona la imagen `rebase-backend:latest`.
4. Establece las **Variables de entorno**:

| Nombre | Valor |
|------|-------|
| `DATABASE_URL` | Tu cadena de conexión de Azure Postgres |
| `JWT_SECRET` | Una cadena aleatoria y segura de más de 32 caracteres |
| `REBASE_SERVICE_KEY` | Una cadena aleatoria y segura de más de 32 caracteres |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | El dominio de tu frontend (p. ej., `https://yourdomain.com`) |
| `FRONTEND_URL` | La URL de tu frontend (utilizada para enlaces de correo y fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | La dirección del primer administrador, configurada **antes del primer arranque** |
| `REBASE_ADMIN_PASSWORD` | Al menos 12 caracteres |

Las últimas tres variables son la forma en que este despliegue obtiene un administrador: en producción, la primera cuenta en registrarse no se promociona, por lo que ninguna otra cosa genera el primer llamador autenticado. Consulta [Tu primer administrador](/docs/getting-started/deployment/#your-first-admin). Almacena los secretos como secretos de Container Apps y haz referencia a ellos, en lugar de usarlos como valores de entorno en texto plano.

5. En la pestaña **Ingress**, habilita el ingress.
6. Establece el Target Port en **8080** — el puerto en el que escucha la imagen de runtime a menos que `PORT` indique lo contrario.
7. Apunta la sonda de salud (health probe) a `/livez`. No a `/health`: esa realiza una consulta de ida y vuelta a la base de datos, por lo que una sonda de liveness sobre ella reiniciaría un contenedor en buen estado durante un breve fallo temporal de la base de datos.
8. Completa la creación. Azure aprovisionará el contenedor y te proporcionará una URL de aplicación protegida con TLS.

## 4. El esquema

**El runtime crea las tablas que faltan durante el arranque, incluidas las de tus colecciones.** `REBASE_MIGRATE_ON_BOOT` tiene por defecto el valor `ensure`, que es aditivo en todo el esquema: crea las tablas, columnas y tipos enum que faltan y aplica su seguridad a nivel de fila (RLS), de modo que el primer inicio contra un servidor vacío arranca sirviendo tus colecciones.

Lo que `ensure` nunca hace es modificar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el reinicio de un contenedor no debe remodelar un esquema como efecto secundario de un despliegue.

Por lo tanto, dos cosas todavía requieren la CLI, ejecutada desde una copia local del código o un trabajo de CI con `DATABASE_URL` apuntando a tu Flexible Server (agrega una regla de firewall que permita tu IP de cliente si es necesario):

```bash
rebase db push
```

- **RLS de tablas de unión (junction tables)** para relaciones de muchos a muchos.
- **Cualquier cambio que no sea puramente aditivo**: una columna renombrada, un tipo restringido, un campo eliminado.

La imagen de runtime se distribuye sin la CLI, por lo que esto nunca se ejecuta dentro del contenedor. Para migraciones versionadas, confirma los archivos de migración en Git con `rebase db generate` y ejecuta `rebase db migrate` como un paso del release en su lugar.

## Almacenamiento de archivos

Las réplicas de Container Apps no tienen disco persistente, por lo que el almacenamiento de archivos local supone una pérdida silenciosa de datos y el runtime lo rechaza en producción. Crea una cuenta de Azure Storage y utiliza su interfaz compatible con S3, o un bucket compatible con S3 en la misma región, con `STORAGE_TYPE=s3` — consulta [Almacenamiento](/docs/backend/storage).

## Próximos pasos

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación para producción y las reglas del primer administrador que comparten todas las plataformas.
- [Configuración](/docs/getting-started/configuration) — cada variable de entorno que lee el runtime.

---
