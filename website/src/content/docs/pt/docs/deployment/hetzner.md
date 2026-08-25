---
title: Implementando Rebase na Hetzner Cloud
description: Implemente o Rebase na Hetzner Cloud com Terraform ou Docker Compose, para excelente desempenho europeu e soberania de dados.
sidebar_label: Nuvem Hetzner
---

A Hetzner Cloud oferece uma relação desempenho-preço excepcional e é uma escolha sólida para projetos que exigem soberania de dados europeia, com datacenters em Nuremberga, Falkenstein e Helsínquia.

Nada disto é específico da Hetzner do lado do seu projeto. Uma implementação Rebase são duas peças separáveis — a imagem do runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle corre sob Docker Compose num portátil, na Rebase Cloud, sob o [chart Helm](/docs/deployment/kubernetes) e numa máquina Hetzner. Mudar entre eles muda a infraestrutura, não a aplicação.

## O caminho mais rápido: Terraform

O módulo `terraform-hcloud-rebase` aprovisiona o servidor, uma firewall, um IP estável e — a parte que importa — um volume que guarda os dados do Postgres, para que substituir o host não destrua a base de dados.

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

Há uma coisa que tem de estar certa antes do primeiro apply: o registo A de `domain` já tem de apontar para o servidor, ou o desafio Let's Encrypt do Caddy falha. O endereço é criado independentemente do servidor, por isso pode obtê-lo primeiro com `terraform apply -target=hcloud_primary_ip.ipv4`, definir o DNS e depois aplicar a sério.

O resto desta página é a mesma implementação feita à mão.

## 1. Criar um servidor

1. Na consola da Hetzner Cloud, clique em **Add Server**.
2. Escolha uma **localização** — Falkenstein, Nuremberga ou Helsínquia para residência de dados na UE.
3. Escolha uma **imagem**: Ubuntu 24.04.
4. Escolha um **tipo**: `CPX21` (3 vCPU / 4 GB) é o mínimo viável, `CX32` (4 vCPU / 8 GB) é confortável para o runtime mais o Postgres.
5. Adicione um **volume** para a base de dados. Dados no disco do próprio servidor morrem com o servidor.
6. Adicione a sua chave SSH e crie-o.

## 2. Instalar o Docker

```bash
ssh root@<ip-do-seu-servidor>
apt update && apt install -y docker.io docker-compose-v2
```

## 3. Levar o bundle para o servidor

Não há nenhuma imagem de aplicação para construir. O `rebase build` produz um diretório `dist-bundle`, e a imagem do runtime publicada executa-o:

```bash
rebase build
rsync -a dist-bundle/ root@<ip-do-seu-servidor>:/opt/rebase/dist-bundle/
```

Para uma implementação real, prefira uma das duas formas que não envolvem copiar ficheiros à mão:

- **Incluí-lo numa imagem** — `FROM rebasepro/server:0.16.0` e depois `COPY dist-bundle /bundle`; implementar passa a ser uma mudança de tag.
- **Servi-lo por HTTP** — defina `REBASE_BUNDLE_URL` e o runtime descarrega e descompacta o bundle em cada arranque. É o que o módulo Terraform acima faz, e o mesmo mecanismo que o chart Helm usa.

## 4. Configurar e arrancar

O Rebase inclui um ficheiro Compose exatamente para isto: [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). É a receita canónica de auto-alojamento — Postgres e o runtime, com o seu bundle montado — e vale mais lê-la do que copiá-la, porque os comentários explicam cada escolha.

Crie o ambiente que ele espera:

```env
POSTGRES_PASSWORD=uma_string_longa_e_aleatoria
JWT_SECRET=outra_string_longa_de_pelo_menos_32_caracteres
REBASE_SERVICE_KEY=uma_terceira_string_longa_de_pelo_menos_32_caracteres
CORS_ORIGINS=https://app.oseudominio.com
```

E depois arranque:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml --env-file .env up -d
```

O runtime escuta na porta 8080 dentro da rede do Compose.

A `REBASE_SERVICE_KEY` contorna a segurança ao nível da linha. Trate-a como uma credencial de superutilizador da base de dados, não como uma chave de API.

## 5. Terminar TLS com o Caddy

Nunca exponha o runtime diretamente. O Caddy obtém certificados Let's Encrypt automaticamente; corrê-lo como mais um serviço do Compose mantém toda a stack num único ficheiro:

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
```

Com um `Caddyfile` assim:

```caddyfile
api.oseudominio.com {
    reverse_proxy api:8080
}
```

Aponte o registo A desse domínio para o servidor antes de arrancar o Caddy, ou o pedido de certificado falha.

## O armazenamento não é opcional

O runtime **recusa arrancar em produção** com armazenamento local configurado, porque o sistema de ficheiros do contentor é destruído em cada reinício e um backend local em produção é perda silenciosa de dados.

O Hetzner Object Storage é compatível com S3 e fica nos mesmos datacenters, por isso é o par natural:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Se o seu projeto não guarda quaisquer ficheiros, defina `FORCE_LOCAL_STORAGE=true` para o reconhecer explicitamente. Veja [Armazenamento](/docs/backend/storage) para o quadro completo.

## O que o arranque faz ao seu esquema

Com `REBASE_MIGRATE_ON_BOOT` no valor por omissão `ensure`, o runtime aprovisiona as tabelas das suas coleções **e as respetivas políticas de segurança ao nível da linha** no arranque, de forma aditiva. Um primeiro arranque contra uma base de dados vazia já as serve — não há nenhum passo de esquema a executar antes de a implementação funcionar.

O que o arranque deliberadamente nunca faz é algo destrutivo: não altera o tipo de uma coluna, não remove colunas e não edita uma etiqueta de enum existente. Reiniciar um contentor não pode remodelar um esquema como efeito secundário.

Por isso, duas coisas continuam a precisar de [`rebase db push`](/docs/architecture/schema-as-code), executado a partir de um checkout ou da CI, onde a barreira de alterações destrutivas e uma cópia de segurança estão ao alcance:

- a RLS das tabelas de junção para relações muitos-para-muitos;
- qualquer alteração que não seja puramente aditiva.

Se o módulo ou o ficheiro Compose ligaram o Postgres ao loopback — ambos o fazem — alcance-o através de um túnel SSH:

```bash
ssh -N -L 5433:127.0.0.1:5432 root@<ip-do-seu-servidor>
```

Uma porta de base de dados aberta à internet é a forma como as linhas de uma implementação Rebase acabam lidas a contornar a segurança ao nível da linha em vez de a atravessar.

## Atualizar

Mude a tag da imagem e reinicie. O seu bundle fica intacto, e todos os projetos sobre esse runtime recebem o novo motor.

A exceção é a versão maior do Postgres: o Postgres recusa arrancar sobre um diretório de dados escrito por uma versão maior anterior, por isso essa atualização é sempre dump e restore, nunca no lugar.

```bash
rebase db backup --out ./backups
# recriar o volume na nova versão maior
rebase db restore ./backups/<ficheiro>.dump
```
