---
sourceHash: 8861ca94a0de827a
title: Fazendo deploy do Rebase na Hetzner Cloud
description: Faça o deploy do Rebase na Hetzner Cloud com Terraform ou Docker Compose, para excelente desempenho baseado na UE e soberania de dados.
sidebar_label: Hetzner Cloud
---

A Hetzner Cloud oferece uma relação custo-benefício excepcionalmente boa e é uma ótima opção para projetos que exigem soberania de dados europeia, com datacenters em Nuremberg, Falkenstein e Helsinque.

Nada aqui é específico da Hetzner em relação ao seu projeto. Uma implantação do Rebase é composta por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle roda sob o Docker Compose em um laptop, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e em uma máquina da Hetzner. Migrar entre eles é uma mudança de infraestrutura, não de aplicação.

## O caminho mais rápido: Terraform

O módulo `terraform-hcloud-rebase` provisiona o servidor, um firewall, um IP estável e — a parte mais importante — um volume que armazena os dados do Postgres, para que a substituição do host não destrua o banco de dados.

```hcl
module "rebase" {
  source = "rebasepro/rebase/hcloud"

  domain          = "api.example.com"
  cors_origins    = ["https://app.example.com"]
  ssh_public_keys = [file(pathexpand("~/.ssh/id_ed25519.pub"))]

  bundle_url = "https://storage.example.com/bundles/app-1.4.0.tar.gz"

  s3_bucket            = "example-uploads"
  s3_access_key_id     = var.s3_access_key_id
  s3_secret_access_key = var.s3_secret_access_key
}
```

Uma coisa importante antes do primeiro apply: o registro A para `domain` já deve apontar para o servidor, caso contrário o desafio Let's Encrypt do Caddy falhará. O endereço é criado independentemente do servidor, portanto você pode obtê-lo primeiro com `terraform apply -target=hcloud_primary_ip.ipv4`, configurar o DNS e depois aplicar corretamente.

O restante desta página descreve a mesma implantação de forma manual.

## 1. Provisionar um servidor

1. No Hetzner Cloud Console, clique em **Add Server**.
2. Escolha uma **Location** — Falkenstein, Nuremberg ou Helsinki para residência de dados na UE.
3. Escolha uma **Image**: Ubuntu 24.04.
4. Escolha um **Type**: `CPX21` (3 vCPUs / 4GB) é um patamar mínimo viável, `CX32` (4 vCPUs / 8GB) é confortável para o runtime mais o Postgres.
5. Adicione um **Volume** para o banco de dados. Os dados no próprio disco do servidor são perdidos se o servidor for excluído.
6. Adicione sua chave SSH e crie o servidor.

## 2. Instalar o Docker

```bash
ssh root@<your-server-ip>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Enviar seu bundle para o servidor

Não há imagem de aplicação para compilar. O `rebase build` produz um diretório `dist-bundle`, e a imagem de runtime publicada o executa:

```bash
rebase build
rsync -a dist-bundle/ root@<your-server-ip>:/opt/rebase/dist-bundle/
```

Para uma implantação real, prefira um dos dois formatos que não envolvem copiar arquivos manualmente para a máquina:

- **Embutir em uma imagem** — `FROM rebasepro/server:0.20.0`, depois `COPY dist-bundle /bundle`, e faça o deploy alterando uma tag.
- **Servir via HTTP** — defina `REBASE_BUNDLE_URL` e o runtime baixa e descompacta o bundle a cada inicialização. É isso que o módulo Terraform acima faz e o mesmo mecanismo que o Helm chart utiliza.

## 4. Configurar e executar

O Rebase fornece um arquivo Compose exatamente para isso: [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). É a receita canônica de auto-hospedagem — Postgres e o runtime, com seu bundle montado — e vale a pena lê-lo em vez de apenas copiar, pois seus comentários explicam cada escolha.

Crie o ambiente esperado:

```env
POSTGRES_PASSWORD=a_long_random_string
JWT_SECRET=another_long_random_string_at_least_32_chars
REBASE_SERVICE_KEY=a_third_long_random_string_at_least_32_chars
CORS_ORIGINS=https://app.yourdomain.com
REBASE_ADMIN_EMAIL=you@yourdomain.com
REBASE_ADMIN_PASSWORD=at_least_twelve_characters
```

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` são novos: na versão 0.17.3,
a primeira conta a se registrar torna-se a administradora, inclusive em produção.

Todas as seis variáveis são obrigatórias — o arquivo Compose as declara com `${VAR:?…}` e
recusa-se a interpolar sem elas.

As duas últimas correspondem ao primeiro administrador. Um banco de dados recém-criado não possui usuários e,
fora de produção, o primeiro cadastro é promovido a administrador — o que se torna uma corrida
a partir do momento em que esta máquina responde em um hostname, já que o Caddy ativa o TLS antes que você tenha
digitado qualquer coisa. Portanto, em produção, essa brecha é fechada e a conta é definida
aqui; o runtime a cria uma única vez, enquanto a tabela de usuários estiver vazia, e
não faz nada nas inicializações seguintes. Faça login e altere a senha.

Depois, inicie o serviço:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

O runtime escuta na porta 8080 dentro da rede do Compose.

A `REBASE_SERVICE_KEY` ignora a segurança em nível de linha (row-level security). Trate-a como uma credencial de superusuário do banco de dados, não como uma chave de API.

## 5. Terminar TLS com o Caddy

Nunca exponha o runtime diretamente. O Caddy provisiona certificados Let's Encrypt automaticamente; executá-lo como outro serviço do Compose mantém toda a stack em um único arquivo:

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
```

Com o seguinte `Caddyfile`:

```caddyfile
api.yourdomain.com {
    reverse_proxy api:8080
}
```

Aponte o registro A desse domínio para o servidor antes de iniciar o Caddy, caso contrário a solicitação do certificado falhará.

## O armazenamento não é opcional

O runtime **se recusa a iniciar em produção** se configurado com armazenamento local, pois o sistema de arquivos do contêiner é destruído a cada reinicialização, e um backend local em produção resulta em perda silenciosa de dados.

O Hetzner Object Storage é compatível com S3 e fica nos mesmos datacenters, sendo a combinação natural:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Se o seu projeto não armazena nenhum upload, defina `FORCE_LOCAL_STORAGE=true` para confirmar isso explicitamente. Consulte [Storage](/docs/backend/storage) para mais detalhes.

## O que a inicialização faz com seu schema

Com `REBASE_MIGRATE_ON_BOOT` em seu padrão `ensure`, o runtime provisiona as tabelas das suas coleções **e suas políticas de row-level security** na inicialização, de forma aditiva. Uma primeira inicialização em um banco de dados vazio já sobe disponibilizando-os — não há etapa de schema a executar antes que o deploy funcione.

O que a inicialização deliberadamente nunca faz é qualquer alteração destrutiva: ela não altera o tipo de uma coluna, não exclui uma coluna nem edita um rótulo de enum existente. Uma reinicialização de contêiner não deve ser capaz de remodelar um schema como efeito colateral.

Portanto, duas coisas ainda exigem o [`rebase db push`](/docs/architecture/schema-as-code), executado a partir de um checkout ou de CI onde a barreira contra alterações destrutivas e um backup estejam acessíveis:

- RLS de tabela de junção (junction table) para relações muitos-para-muitos;
- qualquer alteração que não seja puramente aditiva.

Se o módulo ou o arquivo Compose vincularam o Postgres ao loopback — ambos fazem isso —, acesse-o por meio de um túnel SSH:

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<your-server-ip>
```

Uma porta de banco de dados aberta para a internet é como uma implantação do Rebase tem suas linhas lidas ignorando o row-level security em vez de passar por ele.

## Atualização

Altere a tag da imagem e reinicie. Seu bundle permanece intacto, e todos os projetos nesse runtime passam a usar o novo motor.

A exceção é a versão principal (major version) do Postgres: o Postgres se recusa a iniciar em um diretório de dados gravado por uma versão principal anterior, portanto essa atualização exige um dump e restore, nunca sendo feita in-place.

```bash
rebase db backup --out ./backups
# recreate the volume on the new major
rebase db restore ./backups/<file>.dump
```

---
