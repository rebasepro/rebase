---
sourceHash: 2228ab84c888b578
title: Desplegar Rebase en AWS
description: Despliega tu instancia de Rebase de forma segura en Amazon Web Services utilizando RDS y AWS App Runner con un fuerte enfoque europeo.
sidebar_label: AWS
---

Amazon Web Services (AWS) ofrece una escala increíble y seguridad de nivel empresarial. Para un despliegue de Rebase en producción, recomendamos desacoplar la arquitectura utilizando **Amazon RDS** para la base de datos PostgreSQL y **AWS App Runner** (o ECS Fargate) para servir el runtime.

Para mantener un cumplimiento estricto con la normativa europea de datos, asegúrate de operar completamente dentro de una región de la UE, como **eu-central-1 (Frankfurt)**, **eu-west-1 (Irlanda)** o **eu-west-3 (París)**.

Nada en esta página es específico de AWS con respecto a tu proyecto. Un despliegue de Rebase consta de dos piezas separables: la imagen de runtime publicada y el **bundle** que genera `rebase build`; y el mismo bundle se ejecuta bajo Docker Compose en una laptop, en Rebase Cloud, bajo el [Helm chart](/docs/deployment/kubernetes) y aquí. Moverse entre ellos es un cambio de infraestructura, no de la aplicación.

## 1. Aprovisionar Amazon RDS (PostgreSQL)

1. Navega a la consola de **RDS** en tu región de la UE seleccionada.
2. Haz clic en **Create database** y selecciona **Standard create**.
3. Elige el motor **PostgreSQL**.
4. En Templates, elige **Production** o **Free tier/Dev** según tu carga de trabajo.
5. Crea un Master Username (por ejemplo, `rebase_admin`) y genera una Master Password segura.
6. En Connectivity, asegúrate de que la base de datos se encuentre dentro de una **VPC** a la que tu futura instancia de App Runner pueda acceder de forma segura (o hazla públicamente accesible si controlas estrictamente los rangos de IP de entrada).
7. Una vez aprovisionada, anota el **Endpoint address** y construye tu URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Si tus colecciones declaran una propiedad `vector`, la instancia necesita la extensión `pgvector`; RDS la incluye, pero debe habilitarse: ejecuta `CREATE EXTENSION vector;` contra la base de datos, una sola vez.

## 2. Construir el bundle e incorporarlo en una imagen

**No hay una imagen de aplicación que construir a partir de tu código fuente**. `rebase build` genera un directorio `dist-bundle` con tus colecciones compiladas, funciones, tareas cron y, si tu proyecto declara una aplicación estática, tu frontend compilado. La imagen de runtime publicada lo ejecuta:

```bash
rebase build
```

Para App Runner, que descarga imágenes desde un registro, incorpora el bundle en una imagen derivada. Son solo tres líneas y fija con exactitud lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.19.1
COPY dist-bundle /bundle
```

1. Navega a **Elastic Container Registry** y crea un repositorio privado llamado `rebase-backend`.
2. Copia los comandos de push que AWS muestra en la consola; estos gestionan la autenticación de Docker.
3. Construye y sube la imagen desde la raíz del proyecto:
   ```bash
   docker build -t rebase-backend .
   ```
4. Etiquétala y súbela a tu repositorio de ECR.

Actualizar Rebase más adelante consiste únicamente en cambiar esa línea `FROM`. Tu bundle permanece intacto y no se reconstruye nada de tu proyecto.

## 3. Desplegar mediante AWS App Runner

App Runner es la forma más sencilla de ejecutar contenedores en AWS sin gestionar orquestadores.

1. Navega a **AWS App Runner** y haz clic en **Create service**.
2. Selecciona **Container registry** y elige **Amazon ECR**.
3. Explora y selecciona tu imagen `rebase-backend`.
4. En **Service settings**, establece el Port en **8080**, el puerto en el que escucha la imagen de runtime a menos que `PORT` indique lo contrario.
5. Establece la ruta del **health check** en `/livez`. No en `/health`: esa realiza un recorrido de ida y vuelta a la base de datos, por lo que una comprobación de actividad (liveness probe) sobre ella reiniciaría un servicio perfectamente sano ante cualquier contratiempo breve de la base de datos.
6. Agrega las variables de entorno:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Tu cadena de conexión de RDS |
| `JWT_SECRET` | Una cadena segura generada aleatoriamente (32+ caracteres) |
| `REBASE_SERVICE_KEY` | Una cadena segura generada aleatoriamente (32+ caracteres) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | El dominio de tu frontend (p. ej., `https://yourdomain.com`) |
| `FRONTEND_URL` | La URL de tu frontend (utilizada para enlaces de correo y respaldo de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | La dirección del primer administrador, configurada **antes del primer inicio** |
| `REBASE_ADMIN_PASSWORD` | Al menos 12 caracteres |

Las últimas tres son la forma en que este despliegue obtiene un administrador: en producción, la primera cuenta en registrarse no es promovida automáticamente, por lo que nada más creará al primer usuario autenticado. Consulta [Tu primer administrador](/docs/getting-started/deployment/#your-first-admin). Guarda los secretos en AWS Secrets Manager y haz referencia a ellos en lugar de escribirlos directamente en el formulario de la consola.

7. (Opcional) Si tu instancia de RDS es estrictamente privada, configura las redes con **Custom VPC** en App Runner para que el contenedor pueda comunicarse con la base de datos.
8. Haz clic en **Create & deploy**.

AWS gestiona la terminación TLS, ofreciéndote una URL `https` lista para usar.

## 4. El esquema

**El runtime crea las tablas faltantes al iniciar, incluidas las de tus colecciones.** `REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, que es aditivo en todo el esquema: crea las tablas, columnas y tipos enum faltantes y aplica su seguridad a nivel de fila (RLS), de modo que el primer arranque contra una instancia de RDS vacía comienza a servir tus colecciones de inmediato.

Lo que `ensure` nunca hace es modificar algo que ya existe: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el reinicio de un contenedor no debe remodelar un esquema como efecto secundario de un despliegue.

Por lo tanto, dos cosas aún requieren el uso de la CLI, ejecutada desde un repositorio clonado o un trabajo de CI con `DATABASE_URL` apuntando a RDS:

```bash
rebase db push
```

- **RLS de tablas intermedias (junction tables)** para relaciones de muchos a muchos.
- **Cualquier cambio que no sea puramente aditivo**: una columna renombrada, un tipo más restrictivo, un campo eliminado.

Si la instancia es privada, ejecútalo desde CI o un servidor bastión dentro de la misma VPC. La imagen de runtime se distribuye sin la CLI, por lo que esto nunca se ejecuta dentro del contenedor de App Runner. Para migraciones versionadas, haz commit de los archivos de migración con `rebase db generate` y ejecuta `rebase db migrate` como un paso de la fase de release en su lugar.

## Almacenamiento de archivos

Las instancias de App Runner no disponen de disco persistente, por lo que el almacenamiento local de archivos provocaría una pérdida silenciosa de datos y el runtime lo rechaza en producción. Crea un bucket de S3 en la misma región y define `STORAGE_TYPE=s3` junto con su bucket y credenciales; consulta [Almacenamiento](/docs/backend/storage).

## Próximos pasos

- [Despliegue](/docs/getting-started/deployment) — la lista de verificación para producción y las reglas del primer administrador comunes a todas las plataformas.
- [Configuración](/docs/getting-started/configuration) — cada una de las variables de entorno que lee el runtime.

---
