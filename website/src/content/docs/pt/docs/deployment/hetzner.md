---
sourceHash: 23edfa071775b304
title: Fazendo deploy do Rebase na Hetzner Cloud
description: Faça o deploy de um projeto Rebase em um servidor Hetzner Cloud com seu próprio arquivo Docker Compose e Caddy para HTTPS, ou provisione-o com Terraform, para hospedagem baseada na UE.
sidebar_label: Hetzner Cloud
---

A Hetzner Cloud oferece uma relação custo-benefício excepcionalmente boa e é uma excelente escolha para projetos que exigem soberania de dados europeia, com data centers em Nuremberg, Falkenstein e Helsinque.

Nada aqui sobre o seu projeto é específico da Hetzner. Um deploy do Rebase é composto por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle roda com Docker Compose em um notebook, no Rebase Cloud, com o [Helm chart](/docs/deployment/kubernetes) e em uma máquina Hetzner. Mudar entre eles é uma mudança de infraestrutura, não de aplicação.

Duas maneiras de chegar lá:

- **[Um servidor, a partir do seu projeto](#um-servidor-a-partir-do-seu-projeto):** o `docker-compose.yml` gerado pelo `rebase init`, em um servidor criado manualmente. Os uploads de arquivos permanecem no disco do servidor.
- **[Terraform](#terraform):** um módulo que provisiona o servidor, firewall, IP, TLS e um volume que sobrevive ao host.

## Um servidor, a partir do seu projeto

Um projeto criado com `rebase init` já vem com o deploy configurado: um `docker-compose.yml` que executa o Postgres e o runtime publicado com seu bundle montado, serve o painel de administração em `/` e a API em `/api` a partir de um único contêiner, e mantém os uploads em um volume. Esta seção coloca esse arquivo em um servidor e adiciona o Caddy na frente dele para HTTPS.

### 1. Crie o servidor

1. No Console da Hetzner Cloud, clique em **Add Server**.
2. Escolha uma **Location**: Falkenstein, Nuremberg ou Helsinki para residência de dados na UE.
3. Escolha a imagem **Ubuntu 24.04**.
4. Escolha um tipo com pelo menos **2 vCPUs e 4 GB de RAM**. O runtime, o Postgres e o Caddy irão compartilhá-los.
5. Ative os **Backups**. O banco de dados e os uploads ficam no disco deste servidor, e os backups são o que garante a recuperação em caso de perda.
6. Adicione sua chave SSH e crie-o.

Aponte um registro A do seu domínio — `app.example.com` abaixo — para o endereço do servidor agora. O Caddy precisa disso para obter um certificado.

### 2. Instale o Docker e o Caddy

```bash
ssh root@<server-ip>
apt update && apt install -y docker.io docker-compose-v2 caddy
mkdir -p /opt/my-app
```

### 3. Crie o bundle e copie-o para o servidor

A partir do seu projeto, na sua máquina:

```bash
rebase build
rsync -a docker-compose.yml .env dist-bundle root@<server-ip>:/opt/my-app/
```

`rebase build` compila suas tabelas, funções e crons em `dist-bundle/`, com suas dependências e o painel de administração compilado. Não há imagem de aplicação para construir: o servidor executa a imagem de runtime publicada com esse diretório montado nela.

### 4. Ajuste a configuração para produção

No servidor, edite `/opt/my-app/.env`. O `rebase init` preencheu esse arquivo para o seu computador. Altere estas linhas:

```env
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
```

Mantenha os valores gerados de `DATABASE_PASSWORD`, `JWT_SECRET`, `REBASE_SERVICE_KEY` e `REBASE_ADMIN_PASSWORD`, ou substitua-os por novos valores gerados com `openssl rand -hex 32`. O arquivo do Compose lê essas variáveis daqui e é interrompido com uma mensagem informando caso alguma esteja faltando.

O arquivo passa para o serviço `api` apenas as variáveis nomeadas por ele, de modo que o restante do `.env` — incluindo `NODE_ENV=development` — não chega ao runtime. O serviço roda com `NODE_ENV=production`. Qualquer variável não listada no arquivo deve ser colocada no bloco `environment:` do serviço.

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` definem o primeiro administrador. Em produção, a primeira conta a se registrar não é promovida automaticamente, portanto o runtime cria esta na primeira inicialização, enquanto a tabela de usuários ainda está vazia. Faça login com ela e altere a senha. Veja [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin).

Em seguida, em `/opt/my-app/docker-compose.yml`, vincule ambas as portas publicadas ao loopback:

```yaml
  db:
    ports:
      - "127.0.0.1:5490:5432"
  api:
    ports:
      - "127.0.0.1:${PORT:-3001}:3001"
```

Da forma como é gerado, o arquivo publica o Postgres e a API em todas as interfaces de rede, o que em um computador de desenvolvimento é inofensivo. Em um servidor público, isso expõe o banco de dados à internet, e o Docker publica portas ignorando o `ufw`, portanto uma regra de firewall não as bloqueia. Com `127.0.0.1`, apenas o Caddy e túneis SSH conseguem acessá-las.

### 5. Inicie a aplicação

```bash
cd /opt/my-app
docker compose up -d
```

A primeira inicialização cria todas as tabelas necessárias, incluindo as suas tabelas, juntamente com suas políticas de segurança a nível de linha (row-level security).

### 6. Faça a terminação TLS com o Caddy

Substitua o conteúdo de `/etc/caddy/Caddyfile` por:

```caddyfile
app.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

```bash
systemctl reload caddy
```

O Caddy obtém um certificado Let's Encrypt para o domínio e o renova automaticamente. Acesse `https://app.example.com` e faça login.

### Fazendo novos deploys

Recompile, copie o bundle e reinicie o runtime:

```bash
rebase build
rsync -a --delete dist-bundle/ root@<server-ip>:/opt/my-app/dist-bundle/
ssh root@<server-ip> 'cd /opt/my-app && docker compose restart api'
```

Copiar um diretório manualmente para a máquina funciona bem para um único servidor. Além disso, use uma das abordagens que não dependem desse processo:

- **Gere uma imagem com ele integrado.** `FROM rebasepro/server:0.30.1`, depois `COPY --chown=node:node dist-bundle /bundle`, e faça o deploy alterando a tag.
- **Disponibilize-o via HTTP.** Defina `REBASE_BUNDLE_URL` e o runtime buscará e descompactará o bundle a cada inicialização. O módulo Terraform abaixo faz isso, e o Helm chart utiliza o mesmo mecanismo.

## Terraform

O módulo `terraform-hcloud-rebase` provisiona o servidor, um firewall, um IP estável e — a parte que mais importa — um volume para armazenar os dados do Postgres, para que a substituição do host não destrua o banco de dados. Ele executa o runtime publicado sob o Docker Compose com o Caddy à frente, e busca o seu bundle a partir de uma URL.

O módulo não está no Terraform Registry. Use-o a partir do repositório do Rebase, fixado em uma versão específica:

```hcl
module "rebase" {
  source = "git::https://github.com/rebasepro/rebase.git//infra/terraform-hcloud-rebase?ref=v0.30.1"

  domain          = "api.example.com"
  cors_origins    = ["https://app.example.com"]
  ssh_public_keys = [file(pathexpand("~/.ssh/id_ed25519.pub"))]
  admin_email     = "you@example.com"

  bundle_url      = "https://storage.example.com/bundles/app-1.4.0.tar.gz"
  runtime_version = "0.30.1" # required with bundle_url: `latest` is refused at plan

  s3_bucket            = "example-uploads"
  s3_access_key_id     = var.s3_access_key_id
  s3_secret_access_key = var.s3_secret_access_key
}
```

Um detalhe importante antes do primeiro apply: o registro A para o `domain` já deve apontar para o servidor, caso contrário o desafio do Let's Encrypt no Caddy falhará. O endereço é criado independentemente do servidor, portanto você pode obtê-lo primeiro com `terraform apply -target=module.rebase.hcloud_primary_ip.ipv4`, configurar o DNS e depois executar o apply definitivo.

O [README](https://github.com/rebasepro/rebase/tree/main/infra/terraform-hcloud-rebase) do módulo lista todas as variáveis.

## Armazenamento de arquivos

**Os uploads podem ficar no servidor.** O arquivo Compose do projeto os mantém em um volume nomeado, montado em `/storage`, e define `FORCE_LOCAL_STORAGE=true`. Eles sobrevivem a reinicializações e novos deploys. Eles não sobrevivem à perda do servidor, e é para isso que servem os backups da Hetzner.

Sem essa configuração, o runtime recusa o armazenamento local em produção. Na maioria das plataformas de contêineres, o sistema de arquivos é substituído a cada deploy, portanto um backend local causaria perda silenciosa de dados. Os uploads responderão então com `501 STORAGE_NOT_CONFIGURED` até que um bucket seja configurado.

Quando um único disco não for mais suficiente, ou ao executar um segundo servidor, migre os uploads para o Hetzner Object Storage. Ele é compatível com S3 e fica localizado nos mesmos data centers. No bloco `environment:` do serviço `api`, substitua `STORAGE_PATH` e `FORCE_LOCAL_STORAGE` por:

```yaml
      STORAGE_TYPE: s3
      S3_BUCKET: my-uploads
      S3_ENDPOINT: https://fsn1.your-objectstorage.com
      S3_REGION: fsn1
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
```

com as duas chaves no `.env`. Arquivos já presentes no volume não são movidos automaticamente: copie-os para o bucket, mantendo suas chaves.

O módulo Terraform aceita a mesma escolha por meio de variáveis: um bucket S3 ou `force_local_storage = true`, que mantém os uploads em seu volume de dados. Veja [Armazenamento](/docs/backend/storage) para mais detalhes.

## O que a inicialização faz com seu schema

Com `REBASE_MIGRATE_ON_BOOT` no seu valor padrão `ensure`, o runtime provisiona suas tabelas **e suas políticas de segurança a nível de linha (row-level security)** na inicialização, de forma aditiva. Uma nova tabela entra no ar no próximo deploy, sem necessidade de executar uma etapa prévia de migração de schema.

O que a inicialização deliberadamente nunca faz é qualquer operação destrutiva: ela não altera o tipo de uma coluna, não remove colunas e não edita rótulos de enums existentes. O reinício de um contêiner não deve ser capaz de alterar a estrutura de um schema como efeito colateral.

Portanto, uma coisa ainda exige o [`rebase db push`](/docs/architecture/schema-as-code): qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo mais restrito, um campo removido. Execute-o a partir do seu repositório local, através de um túnel SSH para a porta de loopback:

```bash
ssh -N -L 5490:127.0.0.1:5490 root@<server-ip>
pnpm exec rebase db push --dry-run \
  --database-url 'postgresql://rebase_app:<DATABASE_PASSWORD>@localhost:5490/rebase?sslmode=disable'
```

Analise o SQL exibido pelo dry run e depois execute-o novamente sem `--dry-run`. O `sslmode=disable` está presente porque o banco de dados do Compose não possui TLS; o túnel é o responsável por criptografar a conexão.

Uma porta de banco de dados exposta para a internet é a maneira pela qual uma implantação do Rebase pode ter seus registros lidos ignorando o row-level security em vez de passar por ele. Mantenha-a em loopback e utilize o túnel.

## Atualização

Altere `REBASE_VERSION` no `.env` e recrie o runtime:

```bash
docker compose pull api && docker compose up -d api
```

Seu bundle permanece inalterado.

A exceção é a versão principal (major) do Postgres: o Postgres se recusa a iniciar com um diretório de dados gravado por uma versão principal anterior, portanto essa atualização exige dump e restore, nunca sendo feita in-place.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

## Próximos passos

- [Deploy](/docs/getting-started/deployment) — o checklist de produção e as regras de primeiro administrador compartilhadas por todas as plataformas.
- [Auto-hospedagem (Self-hosting)](/docs/deployment/self-hosting) — o mesmo deploy sem a estrutura inicial por trás, com um connection pooler e processos separados.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente que o runtime lê.
