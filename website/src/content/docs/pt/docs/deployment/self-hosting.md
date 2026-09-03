---
title: Auto-Hospedagem
sidebar_label: Auto-Hospedagem
description: Execute o Rebase em qualquer lugar com a imagem de runtime oficial e o bundle do seu projeto — Docker Compose, Fly, Railway ou uma VPS comum.
---

## Visão geral

Fazer a auto-hospedagem (self-hosting) do Rebase significa executar duas coisas: um banco de dados Postgres e a imagem oficial `rebasepro/server` com o bundle do seu projeto montado nela.

Não há **nenhuma imagem de aplicação para construir**. Seu projeto viaja como um bundle, o runtime é publicado, e atualizar o Rebase é uma mudança de tag em vez de um rebuild. Veja [Runtime e bundles](/docs/architecture/runtime-and-bundles/) para entender por que ele é dividido dessa forma.

## Docker Compose

O arquivo compose vive no repositório, em
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Use esse em vez de copiar um trecho desta página: é o arquivo que o acceptance
gate do projeto sobe a cada push, portanto não pode divergir do que realmente
funciona.

```bash
rebase build                    # produz ./dist-bundle
./infra/docker/quickstart.sh    # escreve infra/docker/.env se faltar, e sobe tudo
```

`quickstart.sh` é um comando que faz duas coisas óbvias e imprime as duas. A
forma longa, se preferir controlar cada passo:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Não é preciso subir o banco separadamente: `api` espera pelo healthcheck dele.

### Os quatro valores necessários

O `quickstart.sh` gera todos. Para escrever o `.env` você mesmo:

```bash
cat > infra/docker/.env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
REBASE_SERVICE_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://app.example.com
EOF
```

Três segredos e um fato:

- **`POSTGRES_PASSWORD`** — a senha do banco. Trocá-la depois significa trocá-la
  também no volume; escolha uma vez.
- **`JWT_SECRET`** — assina cada sessão. Rotacioná-lo desconecta todo mundo.
- **`REBASE_SERVICE_KEY`** — a credencial que ignora a row-level security em
  chamadas de servidor para servidor. Trate como senha de root: quem a tiver lê
  todas as linhas.
- **`CORS_ORIGINS`** — as origens de onde seu frontend é servido, separadas por
  vírgula. Não é segredo, e também não é opcional: em produção o runtime se
  recusa a subir em vez de adivinhar, porque uma API que adivinha as origens
  permitidas acaba permitindo a errada.

Cada um dos três segredos precisa ter pelo menos 32 caracteres. O arquivo compose
os declara com `${VAR:?…}`, de modo que um valor ausente para a stack com uma
mensagem que o nomeia, em vez de subir algo meio configurado.

## Dependências

`rebase build` **instala as dependências do seu projeto dentro do bundle** por
padrão, então `dist-bundle` chega com um `node_modules` e um `package-lock.json`
ao lado do seu `package.json`. Um bundle assim sobe em cerca de cinco segundos.

Como já estão lá, você pode montar o bundle como somente leitura — o que vale a
pena, pois um hook comprometido não consegue então reescrever o código que roda
após o próximo reinício:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` abre mão disso e produz um bundle que instala as
dependências no primeiro start, o que leva de 40 a 60 segundos por start e exige
que o mount seja gravável.

Para um deploy real, prefira assar os dois numa imagem, o que também fixa
exatamente o que roda:

```dockerfile
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

## Criando o schema

**O runtime cria as tabelas que faltam no boot, inclusive as das suas
collections.** `REBASE_MIGRATE_ON_BOOT` vale `ensure` por padrão, o que é aditivo
em todo o schema: cria tabelas, colunas e tipos enum ausentes e aplica a
row-level security deles. Um primeiro boot contra um banco vazio já sobe servindo
suas collections, sem passo separado.

O que `ensure` nunca faz, deliberadamente, é mexer no que já existe. Não altera o
tipo de uma coluna, não remove tabela nem coluna e não edita os rótulos de um
enum existente — porque reiniciar um container não pode remodelar um schema como
efeito colateral de um deploy.

Por isso `rebase db push` continua valendo a pena, para as duas coisas que o boot
deixa de lado:

```bash
rebase db push
```

- **A RLS das tabelas de junção** das relações muitos-para-muitos.
- **Qualquer mudança que não seja puramente aditiva**: uma coluna renomeada, um
  tipo restringido, um campo removido.

Rode a partir de um checkout ou de um job de CI, apontando para o banco do
deploy. Ele simula a mudança primeiro, recusa as destrutivas sem confirmação
explícita e pode fazer um backup antes de aplicar. No arquivo compose o banco
publica uma porta para que isso o alcance a partir do host; remova esse
mapeamento quando o schema estiver pronto, se o banco não deve ser alcançável de
fora.

`REBASE_MIGRATE_ON_BOOT` aceita `ensure` e `none`, e nada mais: a imagem **se
recusa a subir** com `push`, pelo motivo acima.

## Armazenamento de arquivos

O armazenamento fica **desligado** enquanto não houver um bucket configurado, e
isso é deliberado: a alternativa padrão seria o sistema de arquivos do container,
que perde silenciosamente cada arquivo enviado no próximo reinício. Uploads são
recusados com `501 STORAGE_NOT_CONFIGURED` até você configurar um.

Para um bucket, defina `STORAGE_TYPE=s3` (ou `gcs`) mais o bucket e as
credenciais — o arquivo compose lista as variáveis, comentadas.

Para disco local, apropriado apenas quando o caminho é um volume real que
sobrevive ao container:

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
    volumes:
      - uploads:/data/uploads
```

## Outras plataformas

O runtime é um contêiner comum escutando na porta `$PORT`, portanto, qualquer ambiente que execute contêineres funcionará. Duas coisas para configurar corretamente em qualquer lugar:

1. O bundle deve estar presente em `/bundle` (ou onde quer que `REBASE_BUNDLE` aponte), com suas dependências instaladas ao lado dele — veja [Dependências](#dependencies).
2. Defina `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. O runtime se recusa a iniciar em produção sem essas variáveis em vez de tentar adivinhá-las.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.17.3"

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
image: rebasepro/server:0.17.3
```

Reinicie. Seu bundle permanece inalterado. Dentro de uma versão major do contrato de runtime, um bundle validado continua funcionando — veja [Compatibilidade](/docs/architecture/runtime-and-bundles/#compatibility).
