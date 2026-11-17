---
sourceHash: 094e14e4d6fed30b
title: Implantando o Rebase no Out Plane
description: Faça o deploy de um projeto rebase init no Out Plane — um app compilado a partir do seu repositório, PostgreSQL gerenciado do Out Plane e uploads de arquivos em um bucket do Out Plane.
sidebar_label: Out Plane
---

O [Out Plane](https://outplane.com) compila e executa aplicações a partir de um repositório GitHub, com PostgreSQL gerenciado e buckets compatíveis com S3 no mesmo console, na Alemanha. Um backend Rebase consiste em um contêiner e um Postgres, portanto, ele é mapeado em três recursos do Out Plane: um **app**, um **banco de dados** e um **bucket**.

Esta página leva um projeto recém-criado com `rebase init` para uma URL ativa, em uma única instância.

**Escrito para o Rebase 0.32.0.** A versão está fixada no Dockerfile no passo 3; atualizar posteriormente requer apenas a alteração dessa única linha.

**Os uploads de arquivos vão para um bucket desde o primeiro dia.** O sistema de arquivos de um app no Out Plane é redefinido a cada novo deploy, de modo que os arquivos gravados no disco seriam perdidos no próximo push. Consulte [Armazenamento de arquivos](#armazenamento-de-arquivos).

## O que você precisa

- Uma conta no Out Plane. O plano **Starter** atende a esta página: um app, um banco de dados gerenciado e um bucket.
- Um repositório GitHub para o projeto.
- Opcionalmente, a [CLI do `outplane`](https://docs.outplane.com). Cada passo abaixo pode ser realizado no console; os comandos equivalentes da CLI são fornecidos quando economizam tempo.

## 1. Crie o projeto e faça o push

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
```

Faça o commit e envie-o (push) para um repositório GitHub. O arquivo `.env` está no gitignore e deve continuar assim: o app receberá seus próprios valores no passo 5.

## 2. Crie o banco de dados

No console, selecione **Create → Database**:

- **Versão:** 17 (o padrão) ou 16. Qualquer versão a partir da 16 funciona.
- **Região:** Frankfurt, próxima ao seu app.

```bash
outplane db create my-app-db --region aws-eu-central-1
```

No painel **Connection** do banco de dados, copie a string de conexão (no formato `psql`) ou exiba-a com `outplane db url my-app-db`. O Out Plane exige SSL em todas as conexões. A sua `DATABASE_URL` é essa string com `sslmode=no-verify` no final, substituindo qualquer `sslmode` que ela já possua:

```
postgresql://<user>:<password>@<host>:5432/<database>?sslmode=no-verify
```

**Use `no-verify`, não `require`.** Ambos criptografam a conexão. Para o `psql`, `require` também significa "não verificar o certificado em relação a uma autoridade pública", mas o driver Postgres utilizado pelo Rebase interpreta isso como "verificar", e um certificado de banco de dados que não seja assinado publicamente falhará na primeira conexão com `self-signed certificate`. `no-verify` é a forma como o driver expressa o que `require` significa em outros lugares. O próprio guia de Node.js do Out Plane desativa a verificação pelo mesmo motivo. A mesma URL funciona para o `rebase db push` a partir da sua máquina: a CLI a repassa para o mecanismo de esquema Atlas como `sslmode=require`.

### A role para a qual o Rebase alterna

O Rebase impõe segurança em nível de linha (row-level security) alternando cada requisição autenticada para uma role restrita, `rebase_user`. Na primeira inicialização, o runtime cria essa role, concede à role especificada na sua string de conexão a permissão para alternar para ela e valida se a alternância funciona antes de atender a qualquer requisição. Não há nada a ser executado manualmente.

Se a primeira inicialização falhar com um `AppRoleSetupError` mencionando `rebase_user`, a role da sua string de conexão não tem permissão para criar roles ou para conceder a si mesma essa alternância. O erro exibirá o SQL que deve ser executado: execute-o uma vez, usando uma role no banco de dados que possa criar roles, e depois faça o deploy novamente.

Se as suas tabelas declararem uma coluna `col.vector()`, o banco de dados precisará da extensão pgvector. O scaffold não declara nenhuma.

## 3. Crie um bucket

Em **Buckets → Create bucket**, crie um e mantenha-o como **private** (o padrão). O Rebase disponibiliza todos os downloads por meio de sua própria API, e a função `storageAuthorize` em `backend/storage.ts` decide quem pode ler, gravar e listar.

O Out Plane adiciona um sufixo aleatório ao nome. Use o nome **completo** exibido, e não o nome curto que você digitou.

Na aba **Access** do bucket, crie uma chave com a permissão **Read and write**. O secret é exibido apenas uma vez: copie-o agora.

```bash
outplane bucket create my-app-uploads
outplane bucket key create my-app-uploads
```

As observações do Out Plane sobre uploads pelo navegador exigirem uma regra CORS não se aplicam aqui: o painel administrativo e o SDK do Rebase fazem o upload pela API, e o runtime grava no bucket a partir do servidor.

## 4. Adicione um Dockerfile

O Out Plane compila tanto a partir de um Dockerfile quanto com Buildpacks. Use um Dockerfile: o projeto é instalado com o pnpm, e a imagem compila o bundle por conta própria, entregando-o em seguida ao runtime publicado. Faça o commit disto na raiz do projeto:

```dockerfile title="Dockerfile"
# Build the bundle from your source
FROM node:22 AS build
WORKDIR /app
COPY . .
RUN npx -y pnpm@11 install --frozen-lockfile && npx -y pnpm@11 run build

# The published runtime, with nothing added but the bundle
FROM rebasepro/server:0.33.1
COPY --from=build --chown=node:node /app/dist-bundle /bundle
```

Três detalhes são importantes aqui:

- **`node:22`, e não `node:22-slim`.** A instalação da CLI faz o download do mecanismo de esquema Atlas, que precisa de `curl` e de certificados CA. A imagem slim não tem nenhum dos dois, e a instalação falha.
- **`--chown=node:node`.** O runtime é executado como `node` e vincula seus próprios pacotes ao bundle na inicialização. Um bundle pertencente ao root ainda funciona, mas registra um aviso para cada pacote que não conseguiu vincular.
- **Nenhum código-fonte na imagem final.** Ela contém apenas o runtime e o seu bundle compilado, e o diretório `dist-bundle/` permanece no gitignore.

A imagem do runtime escuta na porta **8080** e a declara com `EXPOSE`, portanto, o Out Plane preenche a porta automaticamente ao ler o Dockerfile.

## 5. Crie o app

Crie uma aplicação no console, conecte o repositório e a branch, e configure:

| Campo | Valor |
| --- | --- |
| Build method | **Dockerfile** |
| Root directory | `/` |
| Port | `8080`, **HTTP**, **public** |
| Start command | *(deixe em branco — o padrão da própria imagem)* |

```bash
outplane app create my-app --repo <owner>/<repo> --branch main --port 8080:http:public
```

Em **Settings → Environment**, selecione **Edit as .env** e cole:

```env
NODE_ENV=production
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<database>?sslmode=no-verify
JWT_SECRET=<openssl rand -hex 32>
REBASE_SERVICE_KEY=<openssl rand -hex 32, a second one>
CORS_ORIGINS=https://<your-app>.outplane.app
FRONTEND_URL=https://<your-app>.outplane.app
DISABLE_SELF_REGISTRATION=true
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
STORAGE_TYPE=s3
S3_BUCKET=<full bucket name, with its suffix>
S3_REGION=auto
S3_ENDPOINT=https://obj.outplane.dev
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret>
S3_FORCE_PATH_STYLE=false
```

Em seguida, clique em **Save & deploy**. O Out Plane aplica as alterações de ambiente apenas no próximo deploy. Usando a CLI, coloque as mesmas linhas em um arquivo e execute `outplane env push --app my-app --deploy`.

Para que servem as linhas menos óbvias:

- **`NODE_ENV=production`.** O Out Plane não a define. Sem ela, o runtime inicia em modo de desenvolvimento, no qual a primeira pessoa desconhecida que se registrar se torna a administradora.
- **`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`.** Em produção, a primeira conta a se registrar não é promovida, portanto, essas variáveis definem o primeiro administrador. O runtime cria a conta uma única vez, enquanto a tabela de usuários estiver vazia. Consulte [Seu primeiro admin](/docs/getting-started/deployment/#your-first-admin).
- **`S3_FORCE_PATH_STYLE=false`.** Por padrão, o Rebase acessa endpoints S3 customizados no formato path-style, pois o MinIO e a maioria dos armazenamentos auto-hospedados exigem isso. Os buckets do Out Plane aceitam apenas requisições em formato virtual-hosted (`https://<bucket>.obj.outplane.dev/…`), e requisições path-style falham. Esta linha é obrigatória.
- **`S3_REGION=auto`.** Os buckets do Out Plane são globais, e os clientes assinam com `auto`.

O endereço `outplane.app` do app é exibido assim que o app for criado. Se for diferente do que você previu, corrija `CORS_ORIGINS` e `FRONTEND_URL` e clique em **Save & deploy** novamente.

## 6. Abra a aplicação

Abra a URL do app. Um único contêiner serve o painel administrativo em `/` e a API em `/api`. Faça login com o `REBASE_ADMIN_EMAIL` e a `REBASE_ADMIN_PASSWORD` e, em seguida, altere a senha.

A primeira inicialização cria todas as tabelas necessárias, incluindo as suas, junto com suas políticas de segurança em nível de linha (RLS). Não há nenhuma migração para rodar antes. Faça o upload de um arquivo pelo painel administrativo para confirmar as configurações do bucket: um erro aqui quase sempre significa que o nome do bucket está sem o sufixo ou que `S3_FORCE_PATH_STYLE=false` está ausente.

Cada push para a branch dispara um novo deploy. Para usar seu próprio domínio, adicione-o em **Domains**, conecte-o à porta 8080 do app e crie o CNAME (ou, para um domínio raiz, o registro A) exibido no console. O certificado HTTPS é emitido assim que o registro propagar. Depois, adicione a nova origem a `CORS_ORIGINS` e `FRONTEND_URL`.

## Uma única instância

Esta página roda em **uma instância**, que é o padrão do Out Plane e o limite do plano Starter. Um único contêiner atende a API, o painel administrativo, realtime, cron e a fila de jobs.

Tarefas agendadas continuariam funcionando corretamente com mais instâncias: cada execução de cron é reivindicada no Postgres antes de iniciar, portanto, um slot é executado apenas uma vez, independentemente de quantas instâncias tentem dispará-lo. Outros recursos funcionam por instância — rate limiters, caches de transformação de imagens, uploads resumíveis em andamento — portanto, leia [Mais de uma instância](/docs/deployment/multiple-instances/) antes de aumentar a contagem em **Settings → Scale**.

## Armazenamento de arquivos

Os uploads ficam no bucket do Out Plane criado no passo 3, portanto, sobrevivem a novos deploys, e o disco do próprio app não guarda nada crítico.

Para fazer a rotação da chave: crie uma nova na aba **Access** do bucket, configure-a como `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY`, clique em **Save & deploy** e, em seguida, exclua a chave antiga. O Out Plane observa que uma chave excluída pode continuar funcionando por até 15 minutos.

Quem pode ler, gravar e listar arquivos é determinado por `storageAuthorize` em `backend/storage.ts`, independentemente de qual bucket os armazene. Consulte [Armazenamento](/docs/backend/storage).

## O esquema

**O runtime cria as tabelas ausentes na inicialização, incluindo as declaradas em `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o esquema. Ele cria tabelas, colunas e tipos enum ausentes e aplica suas políticas de row-level security, de forma que uma nova tabela já esteja ativa no próximo deploy.

O `ensure` nunca altera algo que já existe. Ele não modifica o tipo de uma coluna, não exclui nada e não edita os rótulos de um enum existente, pois um deploy não deve reestruturar um esquema como efeito colateral.

Qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo mais restrito, um campo removido — precisa do `rebase db push`, executado a partir do seu ambiente local:

```bash
pnpm exec rebase db push --dry-run --database-url '<your DATABASE_URL>'
```

Analise o SQL exibido pelo dry run e execute o comando novamente sem `--dry-run`. Uma alteração que exclui dados também precisa de `--allow-destructive`.

O `db push` planeja cada alteração em uma cópia temporária do esquema, em um banco de dados com o mesmo nome do seu acrescido de `_dev_diff` no final. Crie-o uma vez na aba **Access** do banco de dados, com a mesma role proprietária do seu banco de dados principal.

Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `pnpm exec rebase db migrate --database-url '<your DATABASE_URL>'` a partir do seu checkout local antes de fazer o push. O Out Plane não possui uma etapa de release que seja executada antes do deploy.

## Próximos passos

- [Deploy](/docs/getting-started/deployment) — o checklist de produção e as regras do primeiro administrador comuns a todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente lidas pelo runtime.
- [Armazenamento](/docs/backend/storage) — buckets, regras de acesso e múltiplas fontes de armazenamento simultâneas.
