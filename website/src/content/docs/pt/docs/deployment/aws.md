---
sourceHash: 2228ab84c888b578
title: Implantando o Rebase na AWS
description: Implante sua instância do Rebase com segurança no Amazon Web Services utilizando o RDS e o AWS App Runner com um forte foco europeu.
sidebar_label: AWS
---

A Amazon Web Services (AWS) oferece uma escala incrível e segurança de nível empresarial. Para uma implantação do Rebase em produção, recomendamos desacoplar a arquitetura usando o **Amazon RDS** para o banco de dados PostgreSQL e o **AWS App Runner** (ou ECS Fargate) para executar o runtime.

Para manter a conformidade rigorosa com os dados europeus, certifique-se de operar inteiramente dentro de uma região da UE, como **eu-central-1 (Frankfurt)**, **eu-west-1 (Irlanda)** ou **eu-west-3 (Paris)**.

Nada nesta página é específico da AWS em relação ao seu projeto. Uma implantação do Rebase é composta por duas partes separáveis: a imagem de runtime publicada e o **bundle** gerado pelo `rebase build` — e o mesmo bundle é executado no Docker Compose em um laptop, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e aqui. Mover-se entre eles é uma mudança de infraestrutura, não de aplicação.

## 1. Provisionar o Amazon RDS (PostgreSQL)

1. Navegue até o console do **RDS** na região da UE selecionada.
2. Clique em **Create database** (Criar banco de dados) e selecione **Standard create** (Criação padrão).
3. Escolha o mecanismo **PostgreSQL**.
4. Em Templates, escolha **Production** (Produção) ou **Free tier/Dev** (Nível gratuito/Dev), dependendo da sua carga.
5. Crie um Master Username (por exemplo, `rebase_admin`) e gere uma Master Password de forma segura.
6. Em Connectivity (Conectividade), certifique-se de que o banco de dados esteja localizado em uma **VPC** que sua futura instância do App Runner possa acessar com segurança (ou torne-o publicamente acessível se estiver controlando rigorosamente as faixas de IP de entrada).
7. Depois de provisionado, anote o **Endpoint address** e monte sua URI:
   `postgresql://rebase_admin:SUA_SENHA@SEU_ENDPOINT:5432/postgres`

Se suas coleções declararem uma propriedade `vector`, a instância precisará da extensão `pgvector` — o RDS a inclui, mas ela precisa ser habilitada uma vez no banco de dados executando: `CREATE EXTENSION vector;`.

## 2. Gerar o bundle e incorporá-lo a uma imagem

Não há **nenhuma imagem de aplicação para compilar a partir do seu código-fonte**. O comando `rebase build` produz um diretório `dist-bundle` com suas coleções compiladas, funções, crons e — se o seu projeto declarar um aplicativo estático — o seu frontend compilado. A imagem de runtime publicada o executa:

```bash
rebase build
```

Para o App Runner, que extrai imagens de um registro, incorpore o bundle em uma imagem derivada. Isso leva apenas três linhas e fixa exatamente o que será executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

1. Navegue até o **Elastic Container Registry** e crie um repositório privado chamado `rebase-backend`.
2. Obtenha os comandos de push exibidos pela AWS no console — eles cuidam da autenticação do Docker.
3. Compile e envie, a partir da raiz do projeto:
   ```bash
   docker build -t rebase-backend .
   ```
4. Adicione uma tag e envie para o seu repositório ECR.

Atualizar o Rebase no futuro se resume a alterar a linha `FROM`. O seu bundle permanece intocado e nada no seu projeto precisa ser reconstruído.

## 3. Fazer o deploy via AWS App Runner

O App Runner é a maneira mais simples de executar contêineres na AWS sem precisar gerenciar orquestradores.

1. Navegue até o **AWS App Runner** e clique em **Create service** (Criar serviço).
2. Selecione **Container registry** (Registro de contêiner) e escolha **Amazon ECR**.
3. Navegue e selecione a sua imagem `rebase-backend`.
4. Em **Service settings** (Configurações de serviço), defina a Porta como **8080** — a porta na qual a imagem de runtime escuta, a menos que especificado de outra forma por `PORT`.
5. Defina o caminho do **health check** para `/livez`. Não utilize `/health`: este último executa uma consulta completa de ida e volta ao banco de dados, logo, uma verificação de liveness nele reiniciaria um serviço perfeitamente saudável durante uma breve oscilação momentânea do banco de dados.
6. Adicione as variáveis de ambiente:

| Chave | Valor |
|-------|-------|
| `DATABASE_URL` | Sua string de conexão do RDS |
| `JWT_SECRET` | Uma string segura gerada aleatoriamente (mais de 32 caracteres) |
| `REBASE_SERVICE_KEY` | Uma string segura gerada aleatoriamente (mais de 32 caracteres) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | O domínio do seu frontend (ex.: `https://seudominio.com`) |
| `FRONTEND_URL` | A URL do seu frontend (usada para links de e-mail e fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | O endereço do primeiro administrador, definido **antes da primeira inicialização** |
| `REBASE_ADMIN_PASSWORD` | Pelo menos 12 caracteres |

As três últimas variáveis são a forma pela qual esta implantação obtém um administrador inicial: em produção, a primeira conta registrada não é promovida automaticamente, portanto, nada mais criará o primeiro usuário autenticado. Consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin). Armazene os segredos no AWS Secrets Manager e faça referência a eles em vez de digitá-los diretamente no formulário do console.

7. (Opcional) Se a sua instância RDS for estritamente privada, configure a rede com **Custom VPC** no App Runner para que o contêiner possa alcançar o banco de dados.
8. Clique em **Create & deploy** (Criar e implantar).

A AWS gerencia a terminação TLS automaticamente, fornecendo uma URL `https` pronta para uso.

## 4. O schema

**O runtime cria tabelas ausentes na inicialização, incluindo as das suas coleções.** A variável `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é cumulativa em todo o schema — ela cria tabelas ausentes, colunas e tipos enum, aplicando suas regras de segurança em nível de linha (RLS) —, de modo que a primeira inicialização em uma instância RDS vazia já começa disponibilizando suas coleções.

O que o `ensure` nunca faz é alterar algo que já existe: ele não modifica o tipo de uma coluna, não remove nada nem edita rótulos de um enum existente, garantindo que o reinício de um contêiner nunca altere a estrutura do schema como efeito colateral de um deploy.

Portanto, duas coisas ainda requerem a CLI, executada a partir de uma cópia local do código ou de uma etapa de CI com a variável `DATABASE_URL` apontando para o RDS:

```bash
rebase db push
```

- **RLS em tabelas intermediárias (junction tables)** para relações muitos-para-muitos.
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo mais restrito, um campo removido.

Se a instância for privada, execute o comando a partir de uma pipeline de CI ou de um bastion host dentro da mesma VPC. A imagem de runtime não inclui a CLI, de modo que isso nunca é executado dentro do contêiner do App Runner. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

As instâncias do App Runner não possuem disco persistente, portanto, o armazenamento de arquivos local resultaria em perda silenciosa de dados e o runtime o recusa em produção. Crie um bucket S3 na mesma região e configure `STORAGE_TYPE=s3` com os dados do bucket e as credenciais necessárias — consulte [Armazenamento](/docs/backend/storage).

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — a lista de verificação de produção e as regras para o primeiro administrador comuns a todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente lidas pelo runtime.

---
