---
sourceHash: 1fdfb40ed3615bbd
title: Desplegar Rebase en Microsoft Azure
description: Despliega tu instancia de Rebase de forma segura en Azure usando Azure Database for PostgreSQL y Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure ofrece integraciones estrechas y cumplimiento normativo empresarial. La arquitectura óptima para ejecutar Rebase en Azure utiliza **Azure Database for PostgreSQL – Flexible Server** para la capa de datos y **Azure Container Apps** para el runtime.

Para cumplir con la normativa europea de datos y obtener tiempos de respuesta locales rápidos, aprovisiona tus recursos en regiones como **West Europe (Amsterdam)**, **North Europe (Ireland)** o **France Central (Paris)**.

Nada en esta página es específico de Azure con respecto a tu proyecto. Un despliegue de Rebase consta de dos partes separables: la imagen de runtime publicada y el **bundle** que genera `rebase build`; y el mismo bundle se ejecuta bajo Docker Compose en un portátil, en Rebase Cloud, bajo el [Helm chart](/docs/deployment/kubernetes) y aquí.

## 1. Aprovisionar PostgreSQL Flexible Server

1. Desde Azure Portal, busca y selecciona **Azure Database for PostgreSQL servers**.
2. Haz clic en **Create** y selecciona **Flexible Server**.
3. Elige tu Grupo de recursos (Resource Group) y define tu región de la UE preferida.
4. Selecciona el tamaño de proceso (Compute) (por ejemplo, General Purpose, o Burstable `B2s` para despliegues más pequeños).
5. Configura la pestaña **Authentication** con un nombre de usuario administrador y una contraseña segura.
6. En **Networking**, asegúrate de que la opción "Allow public access from any Azure service within Azure to this server" esté marcada para que tu Container App pueda conectarse, o bien configura una VNet segura.
7. Toma nota del nombre de tu servidor y crea la URI de conexión:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Si tus tablas declaran una columna `col.vector()`, habilita la extensión una sola vez: Azure la restringe tras el parámetro de servidor `azure.extensions`, y luego ejecuta `CREATE EXTENSION vector;`.

## 2. Compilar el bundle e incorporarlo en una imagen

**No hay una imagen de aplicación que compilar a partir de tu código fuente**. `rebase build` genera un directorio `dist-bundle` con tus tablas, funciones y crons compilados y —si tu proyecto declara una aplicación estática— tu frontend compilado. La imagen de runtime publicada lo ejecuta:

```bash
rebase build
```

Container Apps descarga imágenes desde un registro, así que incorpora el bundle en una imagen derivada. Tres líneas, y fija exactamente lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Crea un **Container Registry** en la región de la UE que elijas.
2. Inicia sesión desde tu CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Compila y haz push, desde la raíz del proyecto:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

Actualizar Rebase más adelante consiste simplemente en cambiar esa línea `FROM`. Tu bundle no se modifica.

## 3. Desplegar la Container App

Azure Container Apps proporciona un entorno de contenedores serverless con ingress HTTPS integrado.

1. Busca **Container Apps** en el portal y haz clic en **Create**.
2. Crea un nuevo Container Apps Environment en tu región de la UE.
3. En la pestaña **Container**, apunta a tu registro de ACR y selecciona la imagen `rebase-backend:latest`.
4. Define las **Variables de entorno**:

| Nombre | Valor |
|------|-------|
| `DATABASE_URL` | Tu cadena de conexión a Azure Postgres |
| `JWT_SECRET` | Una cadena aleatoria segura de más de 32 caracteres |
| `REBASE_SERVICE_KEY` | Una cadena aleatoria segura de más de 32 caracteres |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Tu dominio de frontend (p. ej., `https://yourdomain.com`) |
| `FRONTEND_URL` | La URL de tu frontend (usada para enlaces en correos y fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | La dirección del primer administrador, configurada **antes del primer arranque** |
| `REBASE_ADMIN_PASSWORD` | Al menos 12 caracteres |

Las últimas tres son la forma en que este despliegue obtiene un administrador: en producción, la primera cuenta en registrarse no es promovida, por lo que nada más generará el primer llamador autenticado. Consulta [Tu primer administrador](/docs/getting-started/deployment/#your-first-admin). Almacena los secretos como secretos de Container Apps y referéncialos, en lugar de ponerlos como valores de entorno en texto plano.

5. En la pestaña **Ingress**, habilita el ingress.
6. Establece el Target Port en **8080**, el puerto en el que escucha la imagen de runtime a menos que `PORT` indique lo contrario.
7. Apunta el probe de salud a `/livez`. No a `/health`: este último realiza un viaje de ida y vuelta a la base de datos, por lo que un liveness probe en él reiniciaría un contenedor en buen estado ante un hipo momentáneo de la base de datos.
8. Completa la creación. Azure aprovisiona el contenedor y te proporciona una Application URL protegida con TLS.

## 4. El esquema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**El runtime crea las tablas que falten al arrancar, incluidas las que declara `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` tiene por defecto el valor `ensure`, el cual es aditivo en todo el esquema: crea las tablas, columnas y tipos enum faltantes y aplica su seguridad a nivel de fila (row-level security), por lo que el primer inicio frente a un servidor vacío se pone en marcha sirviendo tus tablas.

Lo que `ensure` nunca hace es cambiar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el reinicio de un contenedor no debe remodelar un esquema como efecto secundario de un despliegue.

Por lo tanto, hay algo que todavía requiere la CLI, ejecutada desde una copia local del repositorio o un trabajo de CI con `DATABASE_URL` apuntando a tu Flexible Server (añade una regla de firewall que permita la IP de tu cliente si es necesario):

```bash
rebase db push
```

Cualquier cambio que no sea puramente aditivo: una columna renombrada, un tipo más restringido, un campo eliminado.

La imagen de runtime se distribuye sin la CLI, por lo que esto nunca se ejecuta dentro del contenedor. Para migraciones versionadas, haz commit de los archivos de migración con `rebase db generate` y ejecuta `rebase db migrate` como un paso de release en su lugar.

## Almacenamiento de archivos

Las réplicas de Container Apps no disponen de disco persistente, por lo que el almacenamiento de archivos local implica una pérdida silenciosa de datos y el runtime lo rechaza en producción. Azure Blob Storage no es compatible de forma nativa con la API de S3, así que utiliza un bucket compatible con S3 en la misma región con `STORAGE_TYPE=s3` y su respectivo `S3_ENDPOINT`; consulta [Almacenamiento](/docs/backend/storage).

## Próximos pasos

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación para producción y las reglas del primer administrador que comparten todas las plataformas.
- [Configuración](/docs/getting-started/configuration) — todas las variables de entorno que lee el runtime.
