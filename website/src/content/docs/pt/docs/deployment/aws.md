---
sourceHash: 93b3163dd1b482fd
title: Implantando o Rebase na AWS
description: Implante sua instância do Rebase com segurança no Amazon Web Services utilizando o RDS e o AWS App Runner com um forte foco europeu.
sidebar_label: AWS
---

O Amazon Web Services (AWS) oferece uma escala incrível e segurança de nível corporativo. Para uma implantação de produção do Rebase, recomendamos desacoplar a arquitetura usando o **Amazon RDS** para o banco de dados PostgreSQL e o **AWS App Runner** (ou ECS Fargate) para executar o runtime.

Para manter uma conformidade rigorosa com a legislação europeia de dados, certifique-se de operar inteiramente dentro de uma região da UE, como **eu-central-1 (Frankfurt)**, **eu-west-1 (Ireland)** ou **eu-west-3 (Paris)**.

Nada nesta página é específico da AWS em relação ao seu projeto. Uma implantação do Rebase é composta por duas partes separáveis — a imagem de runtime publicada e o **bundle** gerado pelo `rebase build` — e o mesmo bundle roda sob o Docker Compose em um notebook, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e aqui. Mover-se entre eles é uma mudança de infraestrutura, não de aplicação.

## 1. Provisionar o Amazon RDS (PostgreSQL)

1. Navegue até o console do **RDS** na sua região selecionada da UE.
2. Clique em **Create database** e selecione **Standard create**.
3. Escolha o mecanismo **PostgreSQL**.
4. Em Templates, escolha **Production** ou **Free tier/Dev** dependendo da sua carga.
5. Crie um Master Username (ex.: `rebase_admin`) e gere uma Master Password com segurança.
6. Em Connectivity, garanta que o banco de dados esteja localizado dentro de uma **VPC** que sua futura instância do App Runner possa acessar com segurança (ou torne-o acessível publicamente caso controle rigorosamente os intervalos de IP de entrada).
7. Uma vez provisionado, anote o **Endpoint address** e monte sua URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Se as suas tabelas declararem uma coluna `col.vector()`, a instância precisará da extensão `pgvector` — o RDS a inclui, mas ela precisa ser habilitada: execute `CREATE EXTENSION vector;` no banco de dados, uma única vez.

## 2. Compilar o bundle e incorporá-lo a uma imagem

Não há **nenhuma imagem de aplicação para compilar a partir do seu código-fonte**. O comando `rebase build` produz um diretório `dist-bundle` com suas tabelas, funções, crons compilados e — se o seu projeto declarar um app estático — seu frontend compilado. A imagem de runtime publicada o executa:

```bash
rebase build
```

Para o App Runner, que faz o pull de um registro (registry), incorpore o bundle em uma imagem derivada. São apenas três linhas e isso fixa exatamente o que é executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Navegue até o **Elastic Container Registry** e crie um repositório privado chamado `rebase-backend`.
2. Copie os comandos de push que a AWS exibe no console — eles cuidam da autenticação do Docker.
3. Faça o build e o push, a partir da raiz do projeto:
   ```bash
   docker build -t rebase-backend .
   ```
4. Aplique a tag e envie-a (push) para o seu repositório ECR.

Atualizar o Rebase posteriormente se resume a alterar essa linha `FROM`. O seu bundle permanece intacto e nada no seu projeto precisa ser recompilado.

## 3. Fazer o deploy via AWS App Runner

O App Runner é a maneira mais simples de executar contêineres na AWS sem a necessidade de gerenciar orquestradores.

1. Navegue até o **AWS App Runner** e clique em **Create service**.
2. Selecione **Container registry** e escolha **Amazon ECR**.
3. Navegue e selecione a sua imagem `rebase-backend`.
4. Em **Service settings**, defina a porta como **8080** — a porta em que a imagem do runtime escuta, a menos que a variável `PORT` especifique o contrário.
5. Defina o caminho do **health check** como `/livez`. Não `/health`: este realiza uma chamada de ida e volta ao banco de dados, fazendo com que uma verificação de liveness probe nele reinicie um serviço perfeitamente saudável durante uma breve oscilação do banco de dados.
6. Adicione as variáveis de ambiente:

| Chave | Valor |
|-------|-------|
| `DATABASE_URL` | Sua string de conexão do RDS |
| `JWT_SECRET` | Uma string segura gerada aleatoriamente (32+ caracteres) |
| `REBASE_SERVICE_KEY` | Uma string segura gerada aleatoriamente (32+ caracteres) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | O domínio do seu frontend (ex.: `https://yourdomain.com`) |
| `FRONTEND_URL` | A URL do seu frontend (usada para links de e-mail e fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | O endereço do primeiro administrador, definido **antes da primeira inicialização** |
| `REBASE_ADMIN_PASSWORD` | No mínimo 12 caracteres |

As últimas três são a forma como essa implantação obtém um administrador: em produção, a primeira conta a se registrar não é promovida, portanto, nada mais cria o primeiro chamador autenticado. Consulte [Your first admin](/docs/getting-started/deployment/#your-first-admin). Armazene os segredos no AWS Secrets Manager e faça referência a eles em vez de digitá-los no formulário do console.

7. (Opcional) Se a sua instância do RDS for estritamente privada, configure a rede **Custom VPC** no App Runner para que o contêiner possa alcançar o banco de dados.
8. Clique em **Create & deploy**.

A AWS lida com a terminação TLS, fornecendo uma URL `https` pronta para uso.

## 4. O schema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**O runtime cria as tabelas ausentes na inicialização, incluindo aquelas declaradas em `backend/schema`.** A variável `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditiva em todo o schema — ela cria tabelas, colunas e tipos enum ausentes e aplica a segurança em nível de linha (row-level security) deles — de modo que a primeira inicialização contra uma instância vazia do RDS já sobe servindo suas collections.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não exclui nada, nem edita os rótulos de um enum existente, pois uma reinicialização de contêiner não deve remodelar um schema como efeito colateral de um deploy.

Portanto, uma coisa ainda requer a CLI, executada a partir de um checkout ou de um job de CI com a `DATABASE_URL` apontada para o RDS:

```bash
rebase db push
```

Qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo mais restrito, um campo removido.

Se a instância for privada, execute-o a partir do CI ou de um bastion host dentro da mesma VPC. A imagem do runtime é distribuída sem a CLI, portanto isso nunca é executado dentro do contêiner do App Runner. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

As instâncias do App Runner não possuem disco permanente, de modo que o armazenamento local de arquivos causaria perda silenciosa de dados e o runtime o recusa em produção. Crie um bucket S3 na mesma região e configure `STORAGE_TYPE=s3` com o respectivo bucket e credenciais — consulte [Storage](/docs/backend/storage).

## Próximos passos

- [Deployment](/docs/getting-started/deployment) — o checklist de produção e as regras para o primeiro administrador compartilhadas por todas as plataformas.
- [Configuration](/docs/getting-started/configuration) — todas as variáveis de ambiente que o runtime lê.
