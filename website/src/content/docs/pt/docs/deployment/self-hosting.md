---
title: Auto-Hospedagem
sidebar_label: Auto-Hospedagem
description: Execute o Rebase em qualquer lugar com a imagem de runtime oficial e o bundle do seu projeto — Docker Compose, Fly, Railway ou uma VPS comum.
---

## Visão geral

Fazer a auto-hospedagem (self-hosting) do Rebase significa executar duas coisas: um banco de dados Postgres e a imagem oficial `rebasepro/server` com o bundle do seu projeto montado nela.

Não há **nenhuma imagem de aplicação para construir**. Seu projeto viaja como um bundle, o runtime é publicado, e atualizar o Rebase é uma mudança de tag em vez de um rebuild. Veja [Runtime e bundles](/docs/architecture/runtime-and-bundles/) para entender por que ele é dividido dessa forma.

## Docker Compose

```bash
rebase build                     # produces ./dist-bundle
docker compose up -d db          # start Postgres
rebase db push                   # create the collection tables, once
docker compose up                # start the runtime
```

Um `docker-compose.yml` mínimo:

```yaml
services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: rebase
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rebase -d rebase"]
      interval: 5s
      retries: 12

  api:
    image: rebasepro/server:latest
    depends_on:
      db: { condition: service_healthy }
    environment:
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      # Writable: the container installs the bundle's declared dependencies into
      # it on first start. See "Dependencies" below for the read-only variant.
      - ./dist-bundle:/bundle
    ports:
      - "8080:8080"

volumes:
  db-data:
```

## Dependências

O comando `rebase build` escreve um `package.json` ao lado do seu bundle listando as dependências que seu projeto declarou. O contêiner as instala na primeira inicialização, motivo pelo qual a montagem acima é gravável.

Para montar como somente leitura em vez disso — algo recomendado, pois um hook comprometido não poderá reescrever o código que roda após a próxima reinicialização —, instale-as primeiro:

```bash
npm install --omit=dev --prefix dist-bundle
```

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

Para uma implantação (deployment) em produção, prefira embutir ambos em uma imagem, o que também fixa exatamente o que é executado:

```dockerfile
FROM rebasepro/server:0.13.0
COPY dist-bundle /bundle
```

## Criando o schema

O runtime cria suas próprias tabelas de **auth** na inicialização. **As tabelas de coleções são uma etapa separada e deliberada**, e a imagem do runtime não realiza essa ação — uma reinicialização do contêiner não deve ser capaz de alterar um schema como efeito colateral de um deploy.

```bash
rebase db push
```

Execute-o a partir de um checkout ou de uma tarefa de CI, apontado para o banco de dados da implantação. Ele simula a alteração primeiro (dry-run), recusa alterações destrutivas sem confirmação explícita e pode fazer um backup antes de aplicar.

`REBASE_MIGRATE_ON_BOOT` aceita `ensure` (o padrão — apenas tabelas de auth) e `none`.

## Outras plataformas

O runtime é um contêiner comum escutando na porta `$PORT`, portanto, qualquer ambiente que execute contêineres funcionará. Duas coisas para configurar corretamente em qualquer lugar:

1. O bundle deve estar presente em `/bundle` (ou onde quer que `REBASE_BUNDLE` aponte), com suas dependências instaladas ao lado dele — veja [Dependências](#dependencies).
2. Defina `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. O runtime se recusa a iniciar em produção sem essas variáveis em vez de tentar adivinhá-las.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.13.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Use o formato de imagem derivada acima para que o bundle seja enviado com a aplicação e, em seguida, execute `fly deploy`.

### Railway / Render

Aponte o serviço para a imagem derivada, defina as variáveis de ambiente e defina o caminho da verificação de saúde (health check) para `/livez`.

### Uma VPS comum

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

Execute-o sob o systemd, com linhas `Environment=` para as variáveis acima.

## Verificações de saúde

| Caminho | Uso |
| --- | --- |
| `/livez` | Liveness. Responde se "este processo está ativo" sem acessar o banco de dados. |
| `/health` | Readiness. Realiza um round-trip no banco de dados e informa a latência. |

Aponte as sondas de liveness para `/livez`. Uma sonda de liveness em `/health` reiniciaria um processo perfeitamente saudável durante uma breve oscilação do banco de dados, o que é o oposto do seu propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expõe métricas do Prometheus em `/metrics`: contagem de requisições e histogramas de latência detalhados por superfície de API (data, auth, storage, functions) e coleção, além de gauges do processo. Sem um token, o endpoint pode ser lido por qualquer pessoa que consiga alcançar a porta, portanto, defina um a menos que esteja em uma rede privada.

## Executar funções no seu próprio processo

Tudo acima é um contentor a servir o projeto inteiro, que é a forma certa para
quase todos os deployments. Quando uma função personalizada deve deixar de
competir com a API de dados pelo event loop — ou deve escalar, reiniciar e falhar
por si só — a mesma imagem e o mesmo bundle podem ser arrancados como vários
processos que cooperam. Ver
[Processos separados](/docs/deployment/split-processes/).

## Atualizando

```yaml
image: rebasepro/server:0.13.0
```

Reinicie. Seu bundle permanece inalterado. Dentro de uma versão major do contrato de runtime, um bundle validado continua funcionando — veja [Compatibilidade](/docs/architecture/runtime-and-bundles/#compatibility).
