---
sourceHash: d9b167443cc3fd35
title: Implantando o Rebase na AWS
description: Faça o deploy da sua instância do Rebase de forma segura na Amazon Web Services utilizando RDS e AWS App Runner com um forte foco europeu.
sidebar_label: AWS
---

A Amazon Web Services (AWS) oferece uma escala incrível e segurança de nível corporativo. Para uma implantação de produção do Rebase, recomendamos desacoplar a arquitetura usando o **Amazon RDS** para o banco de dados PostgreSQL e o **AWS App Runner** (ou ECS Fargate) para executar o runtime.

Para manter uma conformidade rigorosa com a legislação europeia de proteção de dados, certifique-se de operar inteiramente dentro de uma região da UE, como **eu-central-1 (Frankfurt)**, **eu-west-1 (Irlanda)** ou **eu-west-3 (Paris)**.

Nada nesta página é específico da AWS em relação ao seu projeto. Uma implantação do Rebase é composta por duas partes separáveis — a imagem de runtime publicada e o **bundle** gerado por `rebase build` — e o mesmo bundle pode ser executado sob Docker Compose em um laptop, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) ou aqui. A transição entre eles é uma mudança de infraestrutura, não de aplicação.

## 1. Provisionar o Amazon RDS (PostgreSQL)

1. Navegue até o console do **RDS** na sua região da UE selecionada.
2. Clique em **Create database** e selecione **Standard create**.
3. Escolha o mecanismo **PostgreSQL**.
4. Em Templates, escolha **Production** ou **Free tier/Dev**, dependendo da sua carga de trabalho.
5. Crie um Master Username (ex.: `rebase_admin`) e gere uma Master Password de forma segura.
6. Em Connectivity, certifique-se de que o banco de dados esteja alocado dentro de uma **VPC** que sua futura instância do App Runner possa acessar com segurança (ou torne-o publicamente acessível se você estiver controlando estritamente os intervalos de IP de entrada).
7. Uma vez provisionado, anote o **Endpoint address** e monte sua URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Se suas tabelas declararem uma coluna `col.vector()`, a instância precisará da extensão `pgvector` — o RDS a disponibiliza, mas ela precisa ser habilitada uma única vez no banco de dados: `CREATE EXTENSION vector;`.

## 2. Gerar o bundle e incorporá-lo a uma imagem

Não há **nenhuma imagem de aplicação para construir a partir do seu código-fonte**. O comando `rebase build` gera um diretório `dist-bundle` contendo suas tabelas compiladas, funções, crons e — se o seu projeto declarar um app estático — seu frontend compilado. A imagem de runtime publicada o executa:

```bash
rebase build
```

Para o App Runner, que obtém imagens a partir de um registro, incorpore o bundle em uma imagem derivada. São apenas três linhas que fixam com precisão o que será executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Navegue até o **Elastic Container Registry** e crie um repositório privado chamado `rebase-backend`.
2. Obtenha os comandos de push exibidos pela AWS no console — eles cuidam da autenticação no Docker.
3. A partir da raiz do projeto, construa a imagem e faça o push:
   ```bash
   docker build -t rebase-backend .
   ```
4. Adicione a tag e faça o push para o seu repositório ECR.

Atualizar o Rebase no futuro consiste apenas em alterar essa linha `FROM`. Seu bundle permanece intocado e nada no seu projeto precisa ser reconstruído.

## 3. Fazer o deploy via AWS App Runner

O App Runner é a forma mais simples de executar contêineres na AWS sem gerenciar orquestradores.

1. Navegue até o **AWS App Runner** e clique em **Create service**.
2. Selecione **Container registry** e escolha **Amazon ECR**.
3. Localize e selecione a sua imagem `rebase-backend`.
4. Em **Service settings**, defina a porta para **8080** — a porta na qual a imagem de runtime escuta, a menos que a variável `PORT` especifique o contrário.
5. Defina o caminho do **health check** para `/livez`. Não utilize `/health`: este último realiza uma consulta de ida e volta ao banco de dados, fazendo com que uma sonda de liveness reinicie um serviço perfeitamente saudável durante uma breve instabilidade no banco de dados.
6. Adicione as variáveis de ambiente:

| Chave | Valor |
|-------|-------|
| `DATABASE_URL` | Sua string de conexão do RDS |
| `JWT_SECRET` | Uma string aleatória e segura (32+ caracteres) |
| `REBASE_SERVICE_KEY` | Uma string aleatória e segura (32+ caracteres) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | O domínio do seu frontend (ex.: `https://yourdomain.com`) |
| `FRONTEND_URL` | A URL do seu frontend (usada para links de e-mail e fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | O endereço do primeiro administrador, configurado **antes da primeira inicialização** |
| `REBASE_ADMIN_PASSWORD` | No mínimo 12 caracteres |

As três últimas variáveis são a forma pela qual esta implantação obtém um administrador: em produção, a primeira conta registrada não é promovida automaticamente, portanto nenhum outro processo criará o primeiro usuário autenticado. Consulte [Your first admin](/docs/getting-started/deployment/#your-first-admin). Armazene os segredos no AWS Secrets Manager e faça referência a eles em vez de digitá-los diretamente no formulário do console.

7. (Opcional) Se a sua instância do RDS for estritamente privada, configure a rede **Custom VPC** no App Runner para que o contêiner possa alcançar o banco de dados.
8. Clique em **Create & deploy**.

A AWS gerencia o encerramento de TLS (TLS termination), fornecendo uma URL `https` pronta para uso.

## 4. O schema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**O runtime cria as tabelas ausentes durante a inicialização, incluindo aquelas declaradas por `backend/schema`.** O valor padrão de `REBASE_MIGRATE_ON_BOOT` é `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica suas políticas de segurança em nível de linha (row-level security) — de modo que a primeira inicialização em uma instância vazia do RDS já entra no ar servindo suas tabelas.

O que o modo `ensure` nunca faz é alterar algo que já existe: ele não modifica o tipo de uma coluna, não remove nada e não altera os rótulos de um enum existente, garantindo que o reinício de um contêiner não altere a estrutura de um schema como efeito colateral de um deploy.

Portanto, uma operação ainda exige a CLI, executada a partir de uma cópia local ou de um job de CI com a variável `DATABASE_URL` apontada para o RDS:

```bash
rebase db push
```

Qualquer alteração que não seja estritamente aditiva — uma coluna renomeada, um tipo restringido ou um campo removido.

Se a instância for privada, execute o comando a partir de um ambiente de CI ou de um bastion host dentro da mesma VPC. A imagem de runtime não inclui a CLI, de modo que este comando nunca é executado dentro do contêiner do App Runner. Para migrações versionadas, versione os arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa do processo de release.

## Armazenamento de arquivos

As instâncias do App Runner não possuem armazenamento em disco persistente; portanto, o uso de armazenamento local de arquivos causará perda silenciosa de dados, sendo recusado pelo runtime em produção. Crie um bucket do S3 na mesma região e configure `STORAGE_TYPE=s3` informando o bucket e suas respectivas credenciais — consulte [Storage](/docs/backend/storage).

## Próximos passos

- [Deployment](/docs/getting-started/deployment) — o checklist de produção e as regras de primeiro administrador comuns a todas as plataformas.
- [Configuration](/docs/getting-started/configuration) — todas as variáveis de ambiente lidas pelo runtime.
