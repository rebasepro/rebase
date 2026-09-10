---
sourceHash: d1312f112637705d
title: Desplegar Rebase en AWS
description: Despliegue su instancia de Rebase de forma segura en Amazon Web Services utilizando RDS y AWS App Runner con un fuerte enfoque europeo.
sidebar_label: AWS
---

Amazon Web Services (AWS) proporciona una escala increíble y seguridad de nivel empresarial. Para un despliegue de Rebase en producción, recomendamos desacoplar la arquitectura utilizando **Amazon RDS** para la base de datos PostgreSQL y **AWS App Runner** (o ECS Fargate) para servir el runtime.

Para mantener un estricto cumplimiento normativo de datos europeo, asegúrese de operar completamente dentro de una región de la UE, como **eu-central-1 (Fráncfort)**, **eu-west-1 (Irlanda)** o **eu-west-3 (París)**.

Nada en esta página es específico de AWS con respecto a su proyecto. Un despliegue de Rebase se compone de dos piezas separables: la imagen de runtime publicada y el **bundle** que produce `rebase build`. El mismo bundle se ejecuta bajo Docker Compose en una computadora portátil, en Rebase Cloud, bajo el [Helm chart](/docs/deployment/kubernetes) y aquí. Moverse entre ellos es un cambio de infraestructura, no de aplicación.

## 1. Aprovisionar Amazon RDS (PostgreSQL)

1. Vaya a la consola de **RDS** en la región de la UE que haya seleccionado.
2. Haga clic en **Create database** y seleccione **Standard create**.
3. Elija el motor **PostgreSQL**.
4. En Templates, elija **Production** o **Free tier/Dev** según su carga de trabajo.
5. Cree un Master Username (por ejemplo, `rebase_admin`) y genere de forma segura una Master Password.
6. En Connectivity, asegúrese de que la base de datos esté ubicada dentro de una **VPC** a la que su futura instancia de App Runner pueda acceder de forma segura (o hágala públicamente accesible si controla estrictamente los rangos de IP de entrada).
7. Una vez aprovisionada, anote la dirección del **Endpoint** y construya su URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Si sus colecciones declaran una propiedad `vector`, la instancia necesita la extensión `pgvector`; RDS la incluye, pero debe habilitarse ejecutando una sola vez `CREATE EXTENSION vector;` en la base de datos.

## 2. Compilar el bundle e incorporarlo en una imagen

No hay **ninguna imagen de aplicación que deba compilar desde su código fuente**. `rebase build` genera un directorio `dist-bundle` con sus colecciones compiladas, funciones, tareas cron y, si su proyecto declara una aplicación estática, su frontend compilado. La imagen de runtime publicada lo ejecuta:

```bash
rebase build
```

Para App Runner, que descarga imágenes desde un registro, incorpore el bundle en una imagen derivada. Esto toma solo tres líneas y fija con exactitud lo que se ejecuta:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

1. Vaya a **Elastic Container Registry** y cree un repositorio privado llamado `rebase-backend`.
2. Copie los comandos de push que AWS muestra en la consola; estos gestionan la autenticación con Docker.
3. Compile y envíe la imagen desde la raíz del proyecto:
   ```bash
   docker build -t rebase-backend .
   ```
4. Asigne una etiqueta a la imagen y envíela (push) a su repositorio de ECR.

Actualizar Rebase más adelante consiste simplemente en cambiar esa línea `FROM`. Su bundle no se modifica y no es necesario recompilar nada de su proyecto.

## 3. Desplegar mediante AWS App Runner

App Runner es la forma más sencilla de ejecutar contenedores en AWS sin necesidad de gestionar orquestadores.

1. Vaya a **AWS App Runner** y haga clic en **Create service**.
2. Seleccione **Container registry** y elija **Amazon ECR**.
3. Busque y seleccione su imagen `rebase-backend`.
4. En **Service settings**, configure el puerto en **8080**, que es el puerto en el que escucha la imagen de runtime a menos que la variable `PORT` indique lo contrario.
5. Configure la ruta de **health check** en `/livez`. No utilice `/health`: esta ruta realiza un ciclo completo de ida y vuelta a la base de datos, por lo que una comprobación de liveness podría reiniciar un servicio perfectamente sano ante un breve contratiempo de la base de datos.
6. Añada las variables de entorno:

| Clave | Valor |
|-----|-------|
| `DATABASE_URL` | Su cadena de conexión de RDS |
| `JWT_SECRET` | Una cadena segura generada aleatoriamente (32+ caracteres) |
| `REBASE_SERVICE_KEY` | Una cadena segura generada aleatoriamente (32+ caracteres) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | El dominio de su frontend (por ejemplo, `https://yourdomain.com`) |
| `FRONTEND_URL` | La URL de su frontend (utilizada para enlaces en correos y respaldo de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | La dirección del primer administrador, establecida **antes del primer inicio** |
| `REBASE_ADMIN_PASSWORD` | Al menos 12 caracteres |

Las últimas tres variables son las que permiten que este despliegue obtenga un administrador: en producción, la primera cuenta en registrarse no es promovida, por lo que ningún otro mecanismo generará el primer usuario autenticado. Consulte [Su primer administrador](/docs/getting-started/deployment/#your-first-admin). Guarde los secretos en AWS Secrets Manager y haga referencia a ellos en lugar de escribirlos directamente en el formulario de la consola.

7. (Opcional) Si su instancia de RDS es estrictamente privada, configure la red **Custom VPC** en App Runner para que el contenedor pueda comunicarse con la base de datos.
8. Haga clic en **Create & deploy**.

AWS gestiona la terminación TLS, proporcionándole una URL con `https` lista para usar.

## 4. El esquema

**El runtime crea las tablas faltantes al iniciar, incluidas las de sus colecciones.** `REBASE_MIGRATE_ON_BOOT` tiene como valor predeterminado `ensure`, el cual es acumulativo en todo el esquema: crea las tablas, columnas y tipos enum faltantes y aplica su seguridad a nivel de fila (RLS), de modo que el primer inicio contra una instancia de RDS vacía arranca sirviendo sus colecciones.

Lo que `ensure` nunca hace es modificar elementos ya existentes: no altera el tipo de una columna, no elimina nada ni edita las etiquetas de un enum existente, ya que el reinicio de un contenedor no debe remodelar un esquema como efecto secundario de un despliegue.

Por lo tanto, dos cosas aún requieren el uso de la CLI, ejecutada desde una copia local o una tarea de CI con `DATABASE_URL` apuntando a RDS:

```bash
rebase db push
```

- **RLS de tablas intermedias (junction tables)** para relaciones de muchos a muchos.
- **Cualquier cambio que no sea estrictamente aditivo**: una columna renombrada, un tipo de dato más restrictivo o un campo eliminado.

Si la instancia es privada, ejecútelo desde CI o desde un host bastión dentro de la misma VPC. La imagen de runtime se distribuye sin la CLI, por lo que esto nunca se ejecuta dentro del contenedor de App Runner. Para migraciones versionadas, confirme los archivos de migración con `rebase db generate` y ejecute `rebase db migrate` como un paso del despliegue en su lugar.

## Almacenamiento de archivos

Las instancias de App Runner no cuentan con almacenamiento en disco persistente, por lo que almacenar archivos localmente provocará pérdidas silenciosas de datos y el runtime lo rechaza en producción. Cree un bucket de S3 en la misma región y defina `STORAGE_TYPE=s3` con su bucket y credenciales correspondientes; consulte [Almacenamiento](/docs/backend/storage).

## Próximos pasos

- [Despliegue](/docs/getting-started/deployment): la lista de verificación para producción y las reglas del primer administrador comunes a todas las plataformas.
- [Configuración](/docs/getting-started/configuration): todas las variables de entorno que lee el runtime.

---
