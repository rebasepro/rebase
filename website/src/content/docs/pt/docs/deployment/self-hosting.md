---
sourceHash: 2728510dde81de28
title: Auto-hospedagem
sidebar_label: Auto-hospedagem
description: Execute o Rebase em qualquer lugar com a imagem de runtime oficial e o bundle do seu projeto — Docker Compose, Fly, Railway ou uma VPS comum.
---

## Visão geral

Fazer a auto-hospedagem do Rebase significa executar duas coisas: um banco de dados Postgres e a
imagem oficial `rebasepro/server` com o bundle do seu projeto montado nela.

Não há **nenhuma imagem de aplicação para compilar**. Seu projeto é distribuído como um bundle,
o runtime é publicado e a atualização do Rebase é uma alteração de tag em vez de uma
recompilação. Consulte [Runtime e bundles](/docs/architecture/runtime-and-bundles/) para
entender por que ele é dividido dessa forma.

## Docker Compose

**Se o seu projeto foi criado a partir do `rebase init`, use o próprio `docker-compose.yml` dele.**
Ele está no seu repositório, o `init` preencheu seus segredos, sua primeira conta de administrador
e sua versão fixada do runtime, sendo o arquivo que o
[Deployment](/docs/getting-started/deployment/#docker-compose-recommended)
descreve:

```bash
rebase build
docker compose up -d
```

O restante desta página aborda a mesma implantação sem uma estrutura inicial gerada por trás —
o projeto de outra pessoa, um bundle construído no CI ou as duas coisas que o arquivo
gerado deliberadamente deixa de fora: um pooler de conexões e os formatos de processos divididos.
Esse arquivo fica no repositório, em
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Use-o em vez de copiar um trecho desta página: ambos os arquivos são inicializados pelo
próprio gate de aceitação do projeto a cada push, portanto nenhum dos dois pode divergir do que
realmente funciona.

Os dois coincidem em todas as variáveis de ambiente, exceto a senha do banco de dados, e
isso ocorre porque cada um foi escrito para o seu próprio inicializador: este lê
`POSTGRES_PASSWORD`, que o `quickstart.sh` gera; o gerado lê
`DATABASE_PASSWORD`, que o `rebase init` também embute na `DATABASE_URL` que
ele grava no seu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

O `quickstart.sh` é um único comando que faz duas coisas óbvias e imprime ambas. O
formato longo, caso prefira gerenciar cada etapa por conta própria:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Você não precisa iniciar o banco de dados separadamente — o `api` aguarda o
seu healthcheck.

### Os seis valores necessários

O `quickstart.sh` gera esses valores para você. Para escrever o `.env` manualmente:

```bash
cat > infra/docker/.env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
REBASE_SERVICE_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF
```

Três segredos, um dado de configuração e a conta com a qual você faz login:

- **`POSTGRES_PASSWORD`** — a senha do banco de dados. Alterá-la mais tarde significa
  alterá-la no volume também, então defina-a uma única vez.
- **`JWT_SECRET`** — assina todas as sessões. Rotacioná-lo desconecta todos os usuários.
- **`REBASE_SERVICE_KEY`** — a credencial que ignora a segurança em nível de linha (RLS) para
  chamadas de servidor para servidor. Trate-a como uma senha de root: qualquer entidade de posse dela pode
  ler todas as linhas.
- **`CORS_ORIGINS`** — as origens a partir das quais o seu frontend é servido, separadas por vírgula.
  Não é um segredo e não é opcional: o runtime se recusa a iniciar em produção
  sem isso em vez de tentar adivinhar, porque uma API que adivinha suas origens
  permitidas eventualmente permitirá a errada.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — o primeiro
  administrador. Um banco de dados novo não tem usuários e, fora de produção, a
  política de registro aceita o primeiro cadastro e o promove a administrador —
  caso contrário, um banco de dados vazio seria um beco sem saída, pois inicializar um admin
  exige um chamador que já esteja autenticado. No momento em que essa stack responde em um
  hostname, essa conveniência vira uma corrida que o operador pode perder; por isso, em produção,
  a janela é fechada e a conta é definida aqui. O runtime a cria
  uma única vez, enquanto a tabela de usuários estiver vazia, e não faz nada em todas as inicializações
  posteriores.

Cada um dos três segredos deve ter pelo menos 32 caracteres, e a senha do admin,
pelo menos 12. Use um endereço com um ponto no domínio: `POST /auth/login` valida
seu corpo com `z.string().email()`, portanto `admin@localhost` criaria uma conta
e depois recusaria todas as tentativas de uso. O arquivo compose declara todos os seis com
`${VAR:?…}`, de modo que a ausência de um deles interrompe a stack com uma mensagem indicando o item faltante,
em vez de iniciar algo configurado pela metade — e o autorregistro vem desativado por padrão
(`DISABLE_SELF_REGISTRATION`, padrão `true`), para que nada fique exposto.

Faça login com essas credenciais e altere a senha: elas estão salvas em um
arquivo no host.

## Dependências

O `rebase build` **instala as dependências do seu projeto dentro do bundle** por
padrão, de modo que o `dist-bundle` é gerado com um `node_modules` e um `package-lock.json`
ao lado do seu `package.json`. Um bundle com dependências embutidas (vendored) inicia em cerca de cinco segundos.

Como elas já estão presentes, você pode montar o bundle como somente leitura — algo que vale
a pena fazer, já que um hook comprometido não poderá reescrever o código executado após a
próxima reinicialização:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

O comando `rebase build --no-vendor` desativa essa opção e produz um bundle que instala suas
dependências na primeira inicialização, o que leva de 40 a 60 segundos por inicialização e
exige que a montagem seja gravável.

Para uma implantação real, dê preferência a empacotar ambos em uma imagem, o que também fixa exatamente
o que é executado:

```dockerfile
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

## Criando o schema

**O runtime cria as tabelas ausentes na inicialização, incluindo as das suas coleções.**
`REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o
schema: ele cria tabelas, colunas e tipos enum ausentes, e aplica a segurança em
nível de linha correspondente. Uma primeira inicialização em um banco de dados vazio já começa servindo
suas coleções, sem nenhuma etapa separada.

O que o `ensure` deliberadamente nunca faz é alterar qualquer coisa que já exista. Ele
não altera o tipo de uma coluna, não remove uma tabela ou coluna e não
edita os rótulos de um enum existente — porque a reinicialização de um contêiner não deve ser capaz de
redefinir a estrutura de um schema como efeito colateral de um deploy.

Portanto, ainda vale a pena executar o `rebase db push` para os dois itens que a inicialização
não modifica:

```bash
rebase db push
```

- **RLS de tabelas de junção** para relações muitos-para-muitos.
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo
  mais restrito, um campo removido.

Execute-o a partir de um clone local ou de um job de CI, apontando para o banco de dados da implantação. Ele
executa uma simulação (dry-run) da alteração primeiro, recusa alterações destrutivas sem
confirmação explícita e pode fazer um backup antes da aplicação. O banco de dados expõe uma
porta no arquivo compose para que seja acessível a partir do host; remova esse mapeamento
assim que o schema estiver configurado, caso o banco de dados não deva ser acessível
externamente.

`REBASE_MIGRATE_ON_BOOT` aceita apenas `ensure` e `none` — a
imagem **se recusa a inicializar** com `push`, pelo motivo explicado acima.

## Armazenamento de arquivos

O armazenamento fica **desativado** a menos que um bucket seja configurado, e isso é deliberado: a
alternativa padrão seria o sistema de arquivos do contêiner, que perderia silenciosamente todos os
arquivos enviados no próximo reinício. Os uploads são recusados com
`501 STORAGE_NOT_CONFIGURED` até que você configure um.

Para usar um bucket, defina `STORAGE_TYPE=s3` (ou `gcs`) juntamente com seu bucket e credenciais —
o arquivo compose lista essas variáveis comentadas.

Para disco local, o que só é apropriado quando o caminho for um volume real que
persista além do contêiner:

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - uploads:/data/uploads
```

`FORCE_LOCAL_STORAGE` não é opcional nesse caso: em produção, um backend `local` é
descartado em vez de registrado, pois a alternativa seriam uploads bem-sucedidos
em um sistema de arquivos prestes a ser destruído. A variável serve para você confirmar que a montagem
é durável.

### O armazenamento precisa de um modelo de controle de acesso

Uma vez que um bucket **esteja** configurado, o runtime **se recusa a inicializar em produção**
até que a implantação defina como os objetos são protegidos. O armazenamento não está sob a
segurança em nível de linha e suas chaves compartilham um único namespace simples; portanto, sem nenhuma regra, a
única coisa que separa os arquivos de dois usuários é a impossibilidade de adivinhar as chaves — o que o
`GET /storage/list?prefix=` contorna. Qualquer uma das opções a seguir é suficiente:

- um **hook `storageAuthorize`** (ou `storagePolicies`) na configuração do seu projeto,
  que é a solução ideal e o que o template fornece em `config/storage.ts` —
  nenhuma variável de ambiente pode expressar "este usuário pode ler esta chave";
- **`STORAGE_PUBLIC_READ=true`**, para um bucket que é genuinamente uma CDN
  pública somente leitura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para uma aplicação single-tenant onde
  toda conta autenticada tem permissão para acessar qualquer arquivo.

Fora de produção, a mesma condição gera um aviso visível em vez de uma recusa,
portanto essa é uma falha de inicialização com a qual você se depara no deploy, e não no ambiente local. Isso
é intencional: a falha que ela substitui ocorreria silenciosamente.

Defina também `MFA_ENCRYPTION_KEY` se você utiliza TOTP. Se não for definida, os segredos
armazenados do autenticador serão criptografados com `JWT_SECRET` — logo, rotacioná-lo desconectará todos os usuários
*e* tornará impossível descriptografar todos os dispositivos cadastrados.

## Outras plataformas

O runtime é um contêiner comum escutando em `$PORT`, portanto qualquer plataforma que execute
contêineres funciona. Duas coisas que você deve configurar corretamente em qualquer lugar:

1. O bundle deve estar presente em `/bundle` (ou onde `REBASE_BUNDLE` apontar),
   com suas dependências instaladas ao lado — consulte [Dependências](#dependências).
2. Defina `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. O runtime se recusa a
   iniciar em produção sem elas em vez de tentar adivinhá-las.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.20.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Use o formato de imagem derivada apresentado acima para que o bundle seja distribuído junto com o app e, em seguida, execute `fly deploy`.

### Railway / Render

Aponte o serviço para a imagem derivada, defina as variáveis de ambiente e configure
o caminho de health check para `/livez`.

### Uma VPS comum

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

O comando `rebase-server --help` lista as variáveis que ele lê. No systemd — as
três linhas de admin são novas; na versão 0.17.3, a primeira conta a se
registrar tornava-se a administradora:

```ini title="/etc/systemd/system/rebase.service"
[Service]
ExecStart=/usr/bin/rebase-server /srv/myapp/dist-bundle
Restart=always
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://rebase:...@127.0.0.1:5432/rebase
Environment=JWT_SECRET=...
Environment=REBASE_SERVICE_KEY=...
Environment=CORS_ORIGINS=https://app.example.com
Environment=DISABLE_SELF_REGISTRATION=true
Environment=REBASE_ADMIN_EMAIL=you@example.com
Environment=REBASE_ADMIN_PASSWORD=...
```

`NODE_ENV=production` não é mero detalhe. Se não for definido, o processo será executado em
modo de desenvolvimento: ele refletirá origens de localhost, servirá a especificação OpenAPI e
**deixará a janela para o primeiro admin aberta** — de modo que a primeira pessoa desconhecida a encontrar o
formulário de cadastro se tornará a administradora. As duas linhas `REBASE_ADMIN_*` são as que
substituem essa janela; consulte [Seu primeiro
admin](/docs/getting-started/deployment/#your-first-admin).

Dê preferência a `EnvironmentFile=/etc/rebase.env` com o arquivo em permissão 0600 em vez de
linhas `Environment=` para os segredos: um arquivo de unidade do systemd pode ser lido por qualquer usuário, e o
`systemctl show` imprime todos os valores de `Environment=`.

## Pool de conexões

O runtime mantém um pool pequeno e de longa duração e não precisa de um pooler. O que precisa
é qualquer outra coisa que se comunique com o mesmo banco de dados e não consiga reter uma conexão:
uma função serverless, um script agendado, uma ferramenta de BI, um worker de fila que escala
para cinquenta instâncias. O `max_connections` do Postgres é um limite rígido na faixa de poucas centenas e
cada conexão é um *processo*, de modo que a proliferação de lambdas o esgota muito antes de
o banco de dados ficar sobrecarregado.

O arquivo compose inclui um serviço `pgbouncer` para esse tráfego, protegido por um profile
para que uma implantação sem essas demandas não execute um processo desnecessário:

```bash
docker compose --profile pooler up -d
```

```
postgres://rebase:$POSTGRES_PASSWORD@your-host:6432/rebase
```

```bash
PGBOUNCER_PORT=6432           # host port
PGBOUNCER_MAX_CLIENT_CONN=500 # client connections accepted
PGBOUNCER_POOL_SIZE=20        # server connections used to serve them
```

A autenticação do cliente é gerada a partir de `DATABASE_URL` na inicialização, portanto a
senha não é escrita duas vezes. O pooler autentica-se no Postgres usando
`scram-sha-256`, que o Postgres 18 armazena — o padrão `md5` da imagem falha no login
do *servidor* com `FATAL: server login failed: wrong password type`, o que
parece um erro de senha incorreta, mas não é.

Mantenha a soma de `PGBOUNCER_POOL_SIZE` entre todos os poolers confortavelmente abaixo do
`max_connections` do banco de dados — o runtime consome a partir dessa mesma cota.

### O que o pooling de transações altera

Um cliente no pool retém uma conexão de servidor pela duração de uma transação e
depois a devolve, o que permite que 500 clientes compartilhem 20 conexões. Três
coisas deixam de funcionar através dessa porta, e cada uma delas é algo que o próprio Rebase utiliza
— que é exatamente o motivo pelo qual o runtime conecta-se diretamente e essa porta é reservada para outros
chamadores:

- **`LISTEN`/`NOTIFY`.** O Realtime é construído sobre isso, e um listener precisa de
  uma conexão que persista além de uma transação. O `LISTEN` é *aceito* através do
  pooler — ele responde ao `LISTEN`, mas nenhuma notificação jamais chega.
- **Estado de sessão**: `SET` (em oposição a `SET LOCAL`), advisory locks mantidos
  entre instruções, cursores `WITH HOLD`, tabelas temporárias. A próxima transação
  pode cair em uma conexão de servidor diferente, que não verá nada disso. Ambas
  as situações falham da mesma maneira frustrante: com um único cliente ocioso, o estado
  geralmente ainda permanece acessível, funcionando enquanto você testa e falhando sob
  a concorrência real para a qual você adicionou o pooler.
- **Prepared statements no nível de protocolo.** A maioria dos drivers pode ser configurada para não
  usá-los — o node-postgres não os usa por padrão; o asyncpg precisa de
  `statement_cache_size=0`.

`SET LOCAL` tem escopo de transação e funciona normalmente, que é como a segurança em nível de linha é
configurada — portanto, o RLS se comporta de maneira idêntica através da porta gerenciada pelo pooler.

Mantenha o profile desativado se nada fora do runtime se conectar ao seu banco de dados.
Uma porta não utilizada é superfície de ataque desnecessária.

## Verificações de integridade (Health checks)

| Caminho | Finalidade |
| --- | --- |
| `/livez` | Liveness. Responde "este processo está vivo" sem tocar no banco de dados. |
| `/health` | Readiness. Realiza um round-trip no banco de dados e relata a latência. |

Aponte as sondas de liveness para `/livez`. Uma sonda de liveness em `/health` reinicia um
processo perfeitamente saudável durante uma oscilação breve no banco de dados, o que é o oposto
do seu propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expõe métricas do Prometheus em `/metrics`: contagem de requisições e histogramas de latência
detalhados por superfície de API (data, auth, storage, functions) e coleção, além de
indicadores (gauges) de processo. Sem um token, o endpoint pode ser lido por qualquer pessoa que consiga
alcançar a porta, portanto configure um a menos que ele esteja em uma rede privada.

## Executando funções em seu próprio processo

Tudo o que foi descrito acima consiste em um único contêiner servindo todo o projeto, o que é o formato
adequado para quase todas as implantações. Quando uma função personalizada precisa parar de competir
com a API de dados pelo event loop — ou deve escalar, reiniciar e falhar de forma
independente —, a mesma imagem e o mesmo bundle podem ser inicializados como vários processos
cooperantes. Consulte [Processos divididos](/docs/deployment/split-processes/).

## Atualização

```yaml
image: rebasepro/server:0.20.0
```

Reinicie. Seu bundle permanece inalterado. Dentro de uma mesma versão major do contrato de runtime, um bundle que
foi validado continua funcionando — consulte
[Compatibilidade](/docs/architecture/runtime-and-bundles/#compatibility).

---
