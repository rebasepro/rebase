---
sourceHash: 77b432f86f85bc82
title: Lo que la beta de Rebase Cloud no incluye
sidebar_label: Límites de Cloud Beta
description: Lo que la beta privada de Rebase Cloud aún no ofrece — regiones, acceso de autoservicio, un SLA, despliegues por rama, identidades de máquina, un endpoint público de base de datos — y qué significa desplegar con secretos de producción.
---

[Rebase Cloud](/docs/deployment/cloud/) está en beta privada. Dicho claramente, porque enterarse más tarde es peor:

- **Sin elección de región.** Actualmente todo se ejecuta en una sola región. El modelo
  de ubicación existe en la plataforma, pero un proyecto no puede elegir una región.
  `projects create --provider` y `--region` no son la excepción que parecen:
  registran a cuál de los destinos de despliegue registrados del plano de control pertenece un
  proyecto, y como solo hay uno, ambos toman ese valor predeterminado y ninguno mueve
  el proyecto a otro lugar. `rebase cloud projects create --help` indica lo mismo.
- **Sin autoservicio.** El acceso se concede por lotes; no existe la opción de registrarse y pagar.
- **Sin SLA publicado**, ni SOC 2. Si necesitas alguno de ellos, indícalo al solicitar
  acceso en lugar de darlo por sentado.
- **Sin despliegues por rama**, y sin GitHub App oficial. Los hooks de despliegue —URLs
  secretas a las que apuntas un webhook del repositorio— son la automatización admitida. Los [despliegues
  de previsualización](/docs/deployment/cloud/#preview-a-change) se están implementando progresivamente y se inician desde la CLI.
- **Los tokens actúan como una persona.** Una cuenta genera un [token](/docs/deployment/cloud-agents/#ci-and-agents)
  y este actúa en su nombre; todavía no existen identidades de máquina pertenecientes a la organización. Si
  en su lugar inicias sesión desde CI, pasa `REBASE_CLOUD_EMAIL` y `REBASE_CLOUD_PASSWORD`
  desde un gestor de secretos; `--password` coloca la contraseña en el historial de tu shell y
  en la tabla de procesos, y así te lo advierte antes de iniciar sesión. Si el archivo
  `.rebase/cloud.json` del repositorio nombra un plano de control distinto al de la propia plataforma,
  pásalo también como `--url`: sin una terminal, `login` se niega a enviar una contraseña a un
  host especificado únicamente en el archivo descargado.
- **Sin endpoint público de base de datos.** Una base de datos administrada no está expuesta a
  internet, por lo que el host que muestra la consola es la dirección que usa tu backend para
  acceder a ella y no resuelve a nada en tu máquina local. `rebase cloud db connect` abre un
  puerto local conectado a esa base de datos a través de un túnel mediante el plano de control,
  durante todo el tiempo que lo mantengas en ejecución; sin embargo, no existe un nombre de host
  permanente al que un servicio de terceros pueda conectarse. Para ejecutar SQL sin un cliente
  de Postgres local, `rebase cloud db query "<sql>"` o `rebase cloud db query --file file.sql` abre el
  mismo túnel para una sola consulta, ejecuta el texto como un único script (deteniéndose en el primer
  error) y muestra la respuesta de cada instrucción (`--json` para un script). Tanto ese túnel como la contraseña detrás de
  `rebase cloud db info --reveal` requieren el rol de propietario (owner) o administrador (admin)
  de la organización: el mismo que solicita el editor SQL de Studio, ya que los tres desembocan
  en una sesión sobre tus datos de producción.
- **Desplegar significa ejecutar código con los secretos de producción.** El
  entorno de la aplicación contiene `REBASE_SERVICE_KEY` (administrador en su propia API),
  `DATABASE_URL` y `JWT_SECRET`, por lo que el código que despliegue un miembro puede leerlos,
  aunque solo los propietarios y administradores puedan revelarlos en la consola. Invita
  como miembro únicamente a personas en las que confiarías estos valores.
- **La clave de servicio se puede reemplazar.** La sección **Settings** del proyecto
  (o `rebase cloud service-key rotate`) emite una nueva `REBASE_SERVICE_KEY`
  y reinicia la aplicación utilizándola. La clave antigua funciona hasta que el reinicio haya
  finalizado y queda invalidada después, por lo que cualquier elemento que la haya copiado será
  rechazado a partir de ese momento. Reclamar un proyecto hace lo mismo.

## Siguiente

- [Rebase Cloud](/docs/deployment/cloud/): vinculación, despliegue y el resto de la superficie.
- [Self-hosting](/docs/deployment/self-hosting/): la misma imagen y paquete, ejecutados por ti.
