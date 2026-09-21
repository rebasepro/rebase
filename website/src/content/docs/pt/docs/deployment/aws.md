---
sourceHash: 62d3e254386426e3
title: Fazendo o deploy do Rebase na AWS
description: Faça o deploy da sua instância do Rebase com segurança na Amazon Web Services utilizando o RDS e o AWS App Runner com um forte foco europeu.
sidebar_label: AWS
---

A Amazon Web Services (AWS) oferece uma escala incrível e segurança de nível corporativo. Para um deploy de produção do Rebase, recomendamos desacoplar a arquitetura usando o **Amazon RDS** para o banco de dados PostgreSQL e o **AWS App Runner** (ou ECS Fargate) para executar o runtime.

Para manter uma conformidade rigorosa com os dados europeus, certifique-se de operar inteiramente dentro de uma região da UE, como **eu-central-1 (Frankfurt)**, **eu-west-1 (Ireland)** ou **eu-west-3 (Paris)**.

Nada nesta página é específico da AWS em relação ao seu projeto. Um deploy do Rebase consiste em duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle roda sob o Docker Compose em um computador pessoal, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e aqui. Mudar entre eles é uma alteração de infraestrutura, não de aplicação.

## 1. Provisionar o Amazon RDS (PostgreSQL)

1. Navegue até o console do **RDS** na sua região da UE selecionada.
2. Clique em **Create database** e selecione **Standard create**.
3. Escolha o mecanismo **PostgreSQL**.
4. Em Templates, escolha **Production** ou **Free tier/Dev**, dependendo da sua carga.
5. Crie um Master Username (ex.: `rebase_admin`) e gere uma Master Password segura.
6. Em Connectivity, certifique-se de que o banco de dados esteja posicionado dentro de uma **VPC** que sua futura instância do App Runner possa acessar com segurança (ou torne-o publicamente acessível se estiver controlando rigorosamente os intervalos de IP de entrada).
7. Depois de provisionado, anote o **Endpoint address** e monte sua URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Se suas coleções declararem uma propriedade `vector`, a instância precisará da extensão `pgvector` — o RDS a inclui, mas ela precisa ser habilitada: `CREATE EXTENSION vector;` no banco de dados, uma vez.

## 2. Construir o bundle e embuti-lo em uma imagem

Não há **nenhuma imagem de aplicação para construir a partir do seu código-fonte**. O `rebase build` produz um diretório `dist-bundle` com suas coleções, funções, crons compilados e — se o seu projeto declarar um app estático — seu frontend construído. A imagem de runtime publicada o executa:

```bash
rebase build
```

Para o App Runner, que faz o pull de um registro, incorpore o bundle em uma imagem derivada. São apenas três linhas e isso fixa exatamente o que é executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.22.0
COPY dist-bundle /bundle
```

1. Navegue até o **Elastic Container Registry** e crie um repositório privado chamado `rebase-backend`.
2. Copie os comandos de push que a AWS exibe no console — eles cuidam da autenticação do Docker.
3. Construa e envie (push), a partir da raiz do projeto:
   ```bash
   docker build -t rebase-backend .
   ```
4. Adicione uma tag e faça o push para o seu repositório do ECR.

Atualizar o Rebase posteriormente é apenas alterar essa linha `FROM`. Seu bundle permanece intocado e nada sobre seu projeto é reconstruído.

## 3. Fazer o deploy via AWS App Runner

O App Runner é a maneira mais simples de executar contêineres na AWS sem precisar gerenciar orquestradores.

1. Navegue até o **AWS App Runner** e clique em **Create service**.
2. Selecione **Container registry** e escolha **Amazon ECR**.
3. Navegue e selecione sua imagem `rebase-backend`.
4. Em **Service settings**, defina a Porta como **8080** — a porta na qual a imagem de runtime escuta, a menos que `PORT` especifique o contrário.
5. Defina o caminho do **health check** para `/livez`. Não use `/health`: este último realiza uma viagem de ida e volta ao banco de dados, portanto, uma verificação de liveness nele reiniciará um serviço perfeitamente saudável durante uma breve instabilidade do banco de dados.
6. Adicione as variáveis de ambiente:

| Chave | Valor |
|-------|-------|
| `DATABASE_URL` | Sua string de conexão do RDS |
| `JWT_SECRET` | Uma string segura gerada aleatoriamente (32+ caracteres) |
| `REBASE_SERVICE_KEY` | Uma string segura gerada aleatoriamente (32+ caracteres) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | O domínio do seu frontend (ex.: `https://yourdomain.com`) |
| `FRONTEND_URL` | A URL do seu frontend (usada para links de e-mail e fallback do CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | O endereço do primeiro administrador, definido **antes da primeira inicialização** |
| `REBASE_ADMIN_PASSWORD` | Pelo menos 12 caracteres |

As três últimas variáveis são a forma como esse deploy obtém um administrador: em produção, a primeira conta a se registrar não é promovida, portanto, nada mais produz o primeiro usuário autenticado. Consulte [Your first admin](/docs/getting-started/deployment/#your-first-admin). Coloque os segredos no AWS Secrets Manager e faça referência a eles em vez de digitá-los no formulário do console.

7. (Opcional) Se a sua instância do RDS for estritamente privada, configure a rede com **Custom VPC** no App Runner para que o contêiner possa alcançar o banco de dados.
8. Clique em **Create & deploy**.

A AWS gerencia a terminação TLS, fornecendo uma URL `https` pronta para uso.

## 4. O schema

**O runtime cria as tabelas ausentes na inicialização, incluindo as das suas coleções.** O `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica sua segurança em nível de linha (row-level security) — portanto, a primeira inicialização contra uma instância vazia do RDS já sobe servindo suas coleções.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não exclui nada nem edita os rótulos de um enum existente, porque o reinício de um contêiner não deve remodelar um schema como efeito colateral de um deploy.

Portanto, duas coisas ainda exigem a CLI, executada a partir de um checkout ou de um job de CI com a `DATABASE_URL` apontada para o RDS:

```bash
rebase db push
```

- **RLS de tabelas de junção** para relações muitos-para-muitos.
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo reduzido, um campo removido.

Se a instância for privada, execute-a a partir de um CI ou de um bastion host dentro da mesma VPC. A imagem de runtime é distribuída sem a CLI, portanto isso nunca é executado dentro do contêiner do App Runner. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

As instâncias do App Runner não têm disco durável, portanto o armazenamento local de arquivos resulta em perda silenciosa de dados e o runtime o recusa em produção. Crie um bucket S3 na mesma região e configure `STORAGE_TYPE=s3` com seu bucket e credenciais — consulte [Storage](/docs/backend/storage).

## Próximos passos

- [Deployment](/docs/getting-started/deployment) — o checklist de produção e as regras de primeiro administrador compartilhadas por todas as plataformas.
- [Configuration](/docs/getting-started/configuration) — todas as variáveis de ambiente que o runtime lê.
