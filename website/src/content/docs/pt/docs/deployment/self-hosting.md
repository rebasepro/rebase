---
sourceHash: 769f2a8057e8c580
title: Auto-hospedagem
sidebar_label: Auto-hospedagem
description: Execute o Rebase em qualquer lugar com a imagem de runtime oficial e o bundle do seu projeto — Docker Compose, Fly, Railway ou uma VPS comum.
---

## Visão Geral

Fazer a auto-hospedagem do Rebase significa executar duas coisas: um banco de dados Postgres e a imagem oficial `rebasepro/server` com o bundle do seu projeto montado nela.

Não há **nenhuma imagem de aplicação para construir**. Seu projeto transita como um bundle, o runtime é publicado e atualizar o Rebase é apenas uma mudança de tag em vez de um rebuild. Veja [Runtime e bundles](/docs/architecture/runtime-and-bundles/) para saber por que ele é dividido dessa forma.

## Docker Compose

**Se o seu projeto veio do `rebase init`, use o próprio `docker-compose.yml` dele.**
Ele está no seu repositório, o `init` preencheu seus segredos, sua primeira conta de administrador e sua versão fixada do runtime, e é o arquivo descrito em
[Implantação](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

O restante desta página trata do mesmo deploy sem um scaffold por trás —
o projeto de outra pessoa, um bundle construído no CI, ou as duas coisas que o arquivo
gerado deliberadamente omite: um pooler de conexões e os formatos de processos divididos.
Esse arquivo fica no repositório, em
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Use-o em vez de copiar um trecho desta página: ambos os arquivos são inicializados pelo
próprio acceptance gate do projeto a cada push, de modo que nenhum dos dois pode divergir do que
realmente funciona.

Os dois concordam em todas as variáveis de ambiente, exceto a senha do banco de dados, e
isso porque cada um foi escrito para o seu próprio gravador: este lê
`POSTGRES_PASSWORD`, que o `quickstart.sh` gera; o gerado lê
`DATABASE_PASSWORD`, que o `rebase init` também embute na `DATABASE_URL` que
ele grava no seu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

O `quickstart.sh` é um comando único que faz duas coisas óbvias e exibe ambas. A
forma longa, se você preferir controlar cada etapa:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Você não precisa iniciar o banco de dados separadamente — a `api` aguarda o
healthcheck dele.

### Os seis valores necessários

O `quickstart.sh` gera isso para você. Para escrever o `.env` você mesmo:

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

Três segredos, um fato e a conta com a qual você faz login:

- **`POSTGRES_PASSWORD`** — a senha do banco de dados. Alterá-la mais tarde significa
  alterá-la também no volume, portanto, defina-a uma única vez.
- **`JWT_SECRET`** — assina cada sessão. Rotacioná-lo desconecta todos os usuários.
- **`REBASE_SERVICE_KEY`** — a credencial que ignora a segurança em nível de linha (RLS) para
  chamadas servidor-para-servidor. Trate-a como uma senha de root: qualquer coisa em posse dela pode
  ler todas as linhas.
- **`CORS_ORIGINS`** — as origens a partir das quais o seu frontend é servido, separadas por vírgula.
  Não é um segredo e não é opcional: o runtime se recusa a iniciar em produção
  sem ela em vez de tentar adivinhar, porque uma API que adivinha suas origens
  permitidas acaba permitindo a origem errada.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — o primeiro
  administrador. Um banco de dados novo não tem usuários e, fora de produção, a
  política de registro aceita o primeiro cadastro e o promove a administrador —
  caso contrário, um banco de dados vazio seria um beco sem saída, já que
  inicializar um admin exige um chamador que já esteja autenticado. No momento
  em que essa stack responde em um hostname, essa conveniência se torna uma
  corrida que o operador pode perder; por isso, em produção, essa janela é fechada
  e a conta é definida aqui. O runtime a cria uma vez, enquanto a tabela de usuários
  estiver vazia, e não faz nada nas inicializações seguintes.

`JWT_SECRET` e `REBASE_SERVICE_KEY` devem ter pelo menos 32 caracteres cada, e
a senha de administrador pelo menos 12. Use um endereço com um ponto no domínio:
`POST /auth/login` valida o corpo com `z.string().email()`, portanto o runtime
se recusa a propagar `admin@localhost` — uma conta na qual ninguém conseguiria fazer login —
e registra o motivo no log. O arquivo compose declara todos os seis com
`${VAR:?…}`, de modo que a ausência de um deles interrompe a stack com uma mensagem indicando-o
em vez de iniciar algo parcialmente configurado — e o auto-registro vem desativado por padrão
(`DISABLE_SELF_REGISTRATION`, padrão `true`), para que nada fique desprotegido.

Faça login com essas credenciais e altere a senha: elas estão expostas em um
arquivo no host.

## Dependências

O `rebase build` **instala as dependências do seu projeto dentro do bundle** por
padrão, de modo que `dist-bundle` já vem com um `node_modules` e um `package-lock.json`
ao lado do seu `package.json`. Um bundle vendored inicia em cerca de cinco segundos.

Como elas já estão lá, você pode montar o bundle como somente leitura — vale a
pena fazer isso, já que um hook comprometido não poderá reescrever o código executado após o
próximo reinício:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

O comando `rebase build --no-vendor` desativa isso e produz um bundle que instala suas
dependências na primeira inicialização, o que leva de 40 a 60 segundos por inicialização e
exige que o volume montado tenha permissão de escrita.

Para um deploy real, prefira embutir ambos em uma imagem, o que também fixa exatamente
o que é executado:

```dockerfile
FROM rebasepro/server:0.34.0
COPY dist-bundle /bundle
```

## Criando o schema

**O runtime cria as tabelas ausentes na inicialização, incluindo as declaradas em `backend/schema`.**
`REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o
schema: ele cria tabelas, colunas e tipos enum ausentes, e aplica a segurança
em nível de linha a eles. Uma primeira inicialização contra um banco de dados vazio já começa
a servir suas tabelas, sem etapas adicionais.

O que o `ensure` deliberadamente nunca faz é alterar o que já existe. Ele
não altera o tipo de uma coluna, não remove tabelas ou colunas e não
edita os rótulos de um enum existente — porque a reinicialização de um container não
deve ser capaz de remodelar um schema como efeito colateral de um deploy.

Portanto, o `rebase db push` ainda vale a pena ser executado para o que a inicialização não mexe —
qualquer alteração que não seja puramente aditiva: uma coluna renomeada, um tipo mais restrito,
um campo removido.

```bash
rebase db push
```

Execute-o a partir de um checkout ou job de CI, apontado para o banco de dados da implantação.
Ele simula a alteração primeiro (dry-run), recusa mudanças destrutivas sem
confirmação explícita e pode fazer um backup antes de aplicar. O banco de dados expõe uma
porta no arquivo compose para que ele possa ser acessado pelo host; remova esse mapeamento
assim que o schema estiver configurado caso o banco de dados não deva ser acessível
externamente.

`REBASE_MIGRATE_ON_BOOT` aceita `ensure` e `none`, e nada além disso — a
imagem **se recusa a iniciar** com `push`, pelo motivo citado acima.

## Quando apenas o seu processo de mudanças pode alterar o banco de dados

`REBASE_MIGRATE_ON_BOOT=none` não altera as suas tabelas. Mas ele não deixa
o banco de dados intocado: as tabelas do próprio framework (autenticação, chaves de API, jobs, cron)
ainda são criadas e mantidas atualizadas a cada inicialização. Quando o banco de dados só puder ser
alterado por meio de um processo de mudanças revisado, defina `REBASE_PROVISION=false` em cada processo
que serve requisições:

| Configuração | Tabelas declaradas e políticas | Tabelas do framework |
|---|---|---|
| padrão (`REBASE_MIGRATE_ON_BOOT=ensure`) | criadas e mantidas atualizadas na inicialização | criadas e mantidas atualizadas |
| `REBASE_MIGRATE_ON_BOOT=none` | intocadas | criadas e mantidas atualizadas |
| `REBASE_PROVISION=false` | intocadas | intocadas; o que estiver faltando é listado no log |

Com o provisionamento desativado, o runtime não cria nem altera nada: nenhuma tabela, coluna,
índice, função, trigger, política, role ou grant. Isso se aplica na inicialização e depois,
incluindo as tabelas que um processo que serve requisições criaria no primeiro uso
(chaves de idempotência, reservas de cron, os contadores compartilhados de rate-limit). Em vez disso,
ele apenas lê o que já existe:

- **Tabelas de autenticação ausentes ou coluna lida pela autenticação ausente:** a inicialização falha e
  lista cada uma delas.
- **A role da requisição tem acesso a uma tabela do framework** como
  `rebase.refresh_tokens` ou `rebase.api_keys`: a inicialização falha e imprime o
  `REVOKE` a ser executado. Uma inicialização com provisionamento revoga esses privilégios por conta própria.
  Com o provisionamento desativado, nada faz isso.
- **Uma tabela opcional ausente** (chaves de API, chaves de idempotência, reservas de cron,
  contadores de rate-limit, presence, histórico de métricas): esse recurso é desativado e o
  log informa qual tabela é necessária.
- **Uma tabela declarada que o banco de dados não protege** — segurança em nível de linha
  desativada, nenhuma das políticas que ela declara está presente ou uma política restritiva
  que ela declara está ausente: essa tabela não é servida (uma política permissiva ausente
  é servida, com um aviso na inicialização indicando-a). Uma requisição para ela responde `503 TABLE_WITHHELD`, e o log de inicialização
  aponta o SQL que a protege (ou `rebase db push`). As outras tabelas são
  servidas e a inicialização continua. Uma junção many-to-many é verificada da mesma
  forma: uma que o banco de dados não protege retém as tabelas cujas relações
  a utilizam, e `TABLE_WITHHELD` informa a junção. Uma tabela cuja relação `via`
  passa por uma tabela retida também é retida, e a mensagem indica a
  relação. Isso também se aplica com `REBASE_MIGRATE_ON_BOOT=none` e em uma atualização de schema em tempo real.
  Uma tabela cujo acesso o próprio app gerencia define `rlsRequired: false` para ser servida mesmo assim ([como fazer](/docs/deployment/existing-database/#another-tool-owns-the-schema-and-the-app-enforces-access)).

As linhas continuam mudando, como em qualquer banco de dados: logins, sessões, uso de chaves de API,
chaves de idempotência, reservas de cron. A primeira conta de administrador
(`REBASE_ADMIN_EMAIL`) é propagada pela execução de provisionamento, não pelos processos
que servem requisições. A [edição de schema em tempo real](/docs/backend/live-schema-editing) ainda pode
comitar uma alteração como código-fonte, mas se recusa a aplicá-la ao banco de dados.

### A execução de provisionamento

O schema vem de uma execução controlada pelo seu processo de mudanças. Use a mesma imagem e
bundle do servidor, com `REBASE_PROVISION_ONLY=true`, conectado como uma role que
tenha permissão de criação no banco de dados. O `REBASE_PROVISION_SQL_OUT` salva todas as alterações de schema
feitas pela execução na forma de um script SQL:

```bash
docker run --rm \
  -e DATABASE_URL="postgres://admin:…@scratch-db:5432/app" \
  -e JWT_SECRET="…" \
  -e CORS_ORIGINS="https://app.example.com" \
  -e REBASE_PROVISION_ONLY=true \
  -e REBASE_PROVISION_SQL_OUT=/out/rebase.sql \
  -v "$PWD/out:/out" \
  -v "$PWD/dist-bundle:/bundle" \
  "rebasepro/server:$REBASE_VERSION"
```

A imagem roda com `NODE_ENV=production`, portanto esta execução passa pelas mesmas
validações de ambiente que o servidor, incluindo `CORS_ORIGINS` ou `FRONTEND_URL`,
mesmo que ela não sirva nada.

O script é um registro, não um plano: cada instrução nele foi executada, em ordem, e
obteve sucesso. Gravado em um banco de dados vazio, ele representa todo o schema necessário
para o release. Gravado em uma cópia restaurada de produção, ele é exatamente a atualização.
As linhas gravadas pela execução não estão nele. Revise-o e, em seguida, aplique-o ao banco de dados real:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Repita o procedimento para cada atualização do Rebase, antes do roll out dos processos que servem a aplicação. Uma
versão pode adicionar uma tabela ou coluna, e um processo que não pode criá-la
informará que ela está ausente em vez de criá-la.

Um servidor construído por você segue a mesma regra: `initializeRebaseBackend` lê
`REBASE_PROVISION`, e `createRebaseBackend` aceita
[`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Armazenamento de arquivos

O armazenamento fica **desativado** a menos que um bucket esteja configurado, e isso é deliberado: a
alternativa padrão seria o sistema de arquivos do container, que perderia silenciosamente todos os
arquivos enviados na próxima reinicialização. Os uploads são recusados com
`501 STORAGE_NOT_CONFIGURED` até que você configure um.

Para um bucket, defina `STORAGE_TYPE=s3` (ou `gcs`) além do bucket e suas credenciais —
o arquivo compose lista as variáveis comentadas. O `gcs` carrega o
`@google-cloud/storage`, que não vem incluído na imagem oficial; portanto, nessa imagem,
acesse o Google Cloud Storage por meio do endpoint compatível com S3
(`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, chaves HMAC).

Para disco local, o que só é adequado quando o caminho for um volume real que
sobreviva ao container:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` não é opcional nesse caso: em produção, um backend `local` é
descartado em vez de registrado, porque a alternativa seriam uploads bem-sucedidos
em um sistema de arquivos prestes a ser destruído. A variável é a forma de você declarar que o ponto de montagem
é persistente.

Monte o volume **acima** de `STORAGE_PATH`, e não diretamente nele. `STORAGE_PATH` é o
diretório do bucket padrão, e cada bucket declarado em `backend/resources.ts`
tem o seu próprio diretório ao lado, `<STORAGE_PATH>__<key>`. Um volume apontado diretamente para `STORAGE_PATH`
mantém apenas o bucket padrão. Todos os outros buckets gravam no sistema de arquivos do
container e perdem seus arquivos quando o container é recriado.
`STORAGE_PATH__MEDIA` pode mover um bucket para outro local no volume. Ele não pode
movê-lo para dentro do diretório de outro bucket, como `/storage/uploads/media`,
pois o bucket padrão listaria, serviria e excluiria seus arquivos.

A imagem cria
`/storage` para o usuário sem privilégios `node` sob o qual ela é executada, razão pela qual o volume
deve apontar para lá. Um volume montado onde a imagem não possui um diretório pertence ao root,
e todo upload falhará com `EACCES`. O arquivo compose gerado pelo `rebase init`
faz a montagem dessa forma.

### O armazenamento exige um modelo de controle de acesso

Uma vez que um bucket **esteja** configurado, o runtime **se recusa a iniciar em produção**
até que a implantação declare como os objetos são protegidos. O armazenamento não fica sob a
segurança em nível de linha e suas chaves compartilham um namespace único e plano; logo, sem nenhuma regra,
a única coisa separando os arquivos de dois usuários é a impossibilidade de adivinhar as chaves — o que
é quebrado por `GET /storage/list?prefix=`. Qualquer uma das opções a seguir atende a essa exigência:

- um **hook `storageAuthorize`** (ou `storagePolicies`) na configuração do seu projeto,
  que é a resposta ideal e o que o scaffold fornece em `backend/storage.ts` —
  nenhuma variável de ambiente consegue expressar "este usuário pode ler esta chave";
- **`STORAGE_PUBLIC_READ=true`**, para um bucket que é genuinamente uma CDN
  somente leitura pública;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para uma aplicação single-tenant onde
  qualquer conta conectada tem permissão de acesso a todos os arquivos.

Fora de produção, a mesma condição emite um aviso em destaque em vez de uma recusa,
portanto, essa é uma falha de inicialização com a qual você se depara no deploy e não no ambiente local.
Isso é intencional: a falha que ela substitui é silenciosa.

Defina também `MFA_ENCRYPTION_KEY` caso utilize TOTP. Se deixado indefinido,
os segredos de autenticador armazenados são criptografados com `JWT_SECRET` — portanto, rotacioná-lo
desconecta todos os usuários *e* torna impossível descriptografar qualquer dispositivo registrado.

## Outras plataformas

O runtime é um container comum escutando em `$PORT`, então qualquer ambiente que execute
containers funciona. Dois pontos a garantir em qualquer lugar:

1. O bundle deve estar presente em `/bundle` (ou onde `REBASE_BUNDLE` apontar),
   com suas dependências instaladas ao lado — veja [Dependências](#dependências).
2. Defina `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. O runtime se recusa a
   iniciar em produção sem eles em vez de tentar adivinhar.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.34.0 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Use o formato de imagem derivada acima para que o bundle seja entregue junto com o app, e então
`fly deploy`.

### Railway / Render

Aponte o serviço para a imagem derivada, defina as variáveis de ambiente e configure
o caminho do health check para `/livez`.

### Uma VPS comum

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` lista as variáveis que ele lê. No systemd:

```ini title="/etc/systemd/system/rebase.service"
[Service]
ExecStart=/usr/bin/rebase-server /srv/myapp/dist-bundle
Restart=always
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://rebase:...@127.0.0.1:5432/rebase
Environment=ALLOW_LOCALHOST_IN_PRODUCTION=true
Environment=JWT_SECRET=...
Environment=REBASE_SERVICE_KEY=...
Environment=CORS_ORIGINS=https://app.example.com
Environment=DISABLE_SELF_REGISTRATION=true
Environment=REBASE_ADMIN_EMAIL=you@example.com
Environment=REBASE_ADMIN_PASSWORD=...
```

`NODE_ENV=production` não é mero detalhe. Se deixado indefinido, o processo roda em
modo de desenvolvimento: ele reflete origens de localhost, serve a especificação OpenAPI e
**deixa a janela do primeiro admin aberta** — de modo que o primeiro desconhecido que encontrar o
formulário de cadastro se tornará o administrador. As duas linhas `REBASE_ADMIN_*` são o que
substituem essa janela; veja [Seu primeiro admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` está ali porque o banco de dados está na
mesma máquina. Em produção, o runtime recusa qualquer variável apontando para
localhost — em um container, o loopback é o próprio container, então esse endereço é
sempre um erro — e essa linha informa que o endereço é intencional. Remova-a quando o
banco de dados for executado em outro lugar.

Prefira `EnvironmentFile=/etc/rebase.env` com o arquivo em permissão 0600 em vez de
linhas `Environment=` para os segredos: um arquivo de unidade (unit file) pode ser lido por qualquer usuário, e o
`systemctl show` imprime cada valor de `Environment=`.

## Pool de conexões

O runtime mantém um pool pequeno e de longa duração, não necessitando de um pooler. Quem precisa
disso é todo o resto que se comunica com o mesmo banco de dados e não consegue manter uma conexão persistente:
uma função serverless, um script agendado, uma ferramenta de BI, um worker de fila que escala
para cinquenta instâncias. O `max_connections` do Postgres é um limite rígido na faixa das poucas centenas e
cada conexão é um *processo*, de modo que uma distribuição em escala de lambdas esgota o limite muito antes de
o banco de dados ficar ocupado.

O arquivo compose traz um serviço `pgbouncer` para esse tráfego, protegido por um profile
para que uma implantação sem esse tipo de consumidor não execute um processo desnecessário:

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

A autenticação de cliente é gerada a partir de `DATABASE_URL` na inicialização, portanto a
senha não é gravada duas vezes. O pooler autentica no Postgres com
`scram-sha-256`, que o Postgres 18 armazena — o padrão `md5` da imagem falha o
login do *servidor* com `FATAL: server login failed: wrong password type`, o que
parece uma senha incorreta, mas não é.

Mantenha a soma de `PGBOUNCER_POOL_SIZE` de todos os poolers confortavelmente abaixo do
`max_connections` do banco de dados — o runtime consome dessa mesma cota.

### O que o pool de transações altera

Um cliente no pool retém uma conexão do servidor pela duração de uma transação e
depois a devolve, o que permite que 500 clientes compartilhem 20 conexões. Três
coisas param de funcionar através dessa porta, e cada uma delas é algo que o próprio Rebase utiliza
— razão exata pela qual o runtime conecta diretamente e essa porta fica reservada para outros
chamadores:

- **`LISTEN`/`NOTIFY`.** O Realtime é construído sobre isso, e um listener precisa de uma
  conexão que sobreviva a uma transação. O `LISTEN` é *aceito* através do
  pooler — ele responde `LISTEN`, e nenhuma notificação jamais chega.
- **Estado de sessão**: `SET` (ao contrário de `SET LOCAL`), locks consultivos mantidos
  entre instruções, cursores `WITH HOLD`, tabelas temporárias. A próxima transação
  pode cair em uma conexão de servidor diferente, que não verá nada disso. Ambos
  falham da mesma maneira frustrante: com apenas um cliente ocioso o estado geralmente
  continua lá, funcionando enquanto você testa e parando de funcionar sob
  a concorrência para a qual você introduziu o pooler.
- **Prepared statements no nível do protocolo.** A maioria dos drivers pode ser configurada para não
  usá-los — o node-postgres não os usa por padrão; o asyncpg precisa de
  `statement_cache_size=0`.

`SET LOCAL` tem escopo de transação e funciona, sendo o mecanismo com o qual a segurança em nível de linha é
definida — portanto, o RLS se comporta de forma idêntica através da porta gerenciada pelo pool.

Mantenha o profile desativado se nada fora do runtime conectar ao seu banco de dados.
Uma porta não utilizada é superfície de ataque.

## Health checks

| Caminho | Usado para |
| --- | --- |
| `/livez` | Liveness. Responde se "este processo está vivo" sem tocar no banco de dados. |
| `/health` | Readiness. Executa um ciclo completo de ida e volta (round-trip) ao banco de dados e informa a latência. |

Aponte as sondas de liveness para `/livez`. Uma sonda de liveness em `/health` reinicia um
processo perfeitamente saudável durante uma breve oscilação no banco de dados, o que é o oposto
do seu propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expõe métricas do Prometheus em `/metrics`: contagens de requisições e histogramas de latência
detalhados por superfície de API (dados, autenticação, armazenamento, funções) e por tabela, além de
medidores (gauges) de processo. Sem um token, o endpoint pode ser lido por qualquer um que alcance
a porta; portanto, configure um, a menos que ele esteja em uma rede privada.

`rebase_db_pool_wait_ms` é um histograma de quanto tempo cada consulta aguardou por uma
conexão do pool do banco de dados, abertura de conexão inclusa, rotulado pela chave da fonte de
dados (`source="(default)"` em um projeto que não declara fontes de dados). Um
pool saudável o mantém próximo de zero. Uma cauda que
cresce com o tráfego significa que as requisições estão na fila por conexões — mais frequentemente
retidas por hooks de escrita que aguardam algo lento; veja
[Um hook retém uma conexão](/docs/collections/context-data-api/#a-hook-holds-a-connection).

O próprio banco de dados, por fonte de dados:

| Métrica | O que indica |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Conexões de cada pool, rotuladas como `pool="primary"`, `"read"` (a réplica) ou `"session"` (o pool direto do console SQL atrás de um pooler). Um valor de `waiting` acima de zero por muito tempo indica um pool pequeno demais para a carga. |
| `rebase_db_connection_errors_total` | Requisições respondidas com 503 por falta de conexão, por `code`: `53300` / `53400` (o servidor está sem conexões), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Conexões de clientes no servidor, por `state`, contra `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | O tamanho do banco de dados. |
| `rebase_db_replica_lag_seconds` | O atraso da réplica `DATABASE_READ_URL` em relação ao banco primário. |

Os últimos quatro são amostrados a cada 30 segundos na própria conexão da instância, de modo que
uma coleta (scrape) nunca se transforma em uma query.

`rebase_realtime_*` relata os sockets e canais abertos de cada instância e os frames
que ela enviou ao barramento de canais ou conteve: veja
[Vendo o que o barramento faz](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Cabeçalhos de segurança

Toda resposta inclui `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Strict-Transport-Security: max-age=15552000`
(180 dias). O cabeçalho HSTS omite `includeSubDomains`: isso instruiria os
navegadores a recusar HTTP simples em todos os subdomínios do seu domínio, incluindo aqueles
com os quais este servidor não tem relação alguma, e o navegador mantém essa regra pelo período indicado no
cabeçalho.
Defina `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` quando todos os subdomínios forem exclusivamente HTTPS.

`strict-origin-when-cross-origin` é o padrão dos próprios navegadores: uma requisição para
outro site transporta a sua origem e nunca o caminho ou a query da página. Não é
`no-referrer` porque as verificações de origem precisam dela — o botão de login do Google
a compara com as origens JavaScript autorizadas do cliente OAuth, e sob
`no-referrer` ele respondia "The given origin is not allowed for the given client
ID" em qualquer app, independentemente do que o cliente autorizasse. Uma resposta que defina sua própria
política a mantém (a página de consentimento do MCP envia `no-referrer`); uma página que queira uma
mais restritiva pode declará-la com `<meta name="referrer" content="no-referrer">`.
O `X-Frame-Options` funciona da mesma maneira: `SAMEORIGIN`, a menos que a resposta defina a
sua própria, como faz a página de consentimento do MCP com `DENY`.

As aplicações estáticas — o painel administrativo do CMS e qualquer frontend servido pelo bundle — também incluem
`Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri
'self'`. Isso define quem pode carregar o app em um frame, impede plugins e fixa o `<base>`
na sua origem, sem restringir nada além disso, permitindo que scripts inline, workers e
autenticação de terceiros continuem funcionando. Uma resposta que configure sua própria política a preserva.
Para qualquer regra mais rígida, configure a política no proxy reverso à frente.

### Permitindo que outra origem incorpore um app em um frame

`frame-ancestors 'self'` significa que somente uma página na própria origem do app pode inseri-lo
em um iframe. Um CMS em `admin.example.com` que pré-visualiza o site em
`www.example.com` precisa que o site permita isso, usando `frameAncestors` no
app do site em `rebase.json`:

```jsonc
"site": {
  "type": "static", "root": "site", "output": "site/dist", "path": "https://www.example.com",
  "frameAncestors": ["https://admin.example.com"]
}
```

O site passa a ser servido com `frame-ancestors 'self' https://admin.example.com`,
assim como qualquer [rota](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app)
do site cuja função não envie uma política própria. Os outros apps mantêm
`'self'`. O cabeçalho `X-Frame-Options: SAMEORIGIN` ainda é enviado junto; um navegador que
reconhece `frame-ancestors` ignora o `X-Frame-Options`, conforme exigido pela especificação
de CSP.

Cada entrada é uma origem, escrita exatamente assim: `https://` com um hostname e uma
porta opcional, ou `http://` para `localhost`, `127.0.0.1` e `[::1]` durante o
desenvolvimento. Não há suporte a caracteres curinga, caminhos ou palavras-chave — `'self'` está sempre
na lista, e qualquer outra coisa é recusada pela CLI e novamente pelo runtime
antes de atingir o cabeçalho. Nada é permitido a menos que você especifique.

## Mais de uma instância

Um único container é o padrão e não necessita de mais nada. Antes que uma segunda réplica
receba tráfego — ou que um deploy contínuo (rolling deploy) execute duas lado a lado —, consulte
[Executando mais de uma instância](/docs/deployment/multiple-instances/): limites de
taxa (rate limits), canais de transmissão (broadcast channels), arquivos locais, uploads retomáveis
e o cache de imagens são isolados por processo até que uma configuração os compartilhe.

## Conectando o Claude

Um comando adiciona este servidor ao [Rebase connector](/docs/ai/rebase-connector/),
o conector MCP único que acessa todos os seus projetos a partir do Claude:

```bash
rebase cloud connect https://your-app.com
```

Defina as duas variáveis exibidas neste servidor e reinicie-o. O servidor deve
rodar o Rebase 0.28.1 ou posterior e responder via https em um endereço público. Nada
mais muda: ele não armazena segredos e concede ao conector as mesmas permissões que o Studio concederia.

## Executando funções em seu próprio processo

Tudo o que foi descrito acima consiste em um container servindo o projeto inteiro, o que é o formato
ideal para quase todas as implantações. Quando uma função personalizada precisar parar de competir
com a API de dados pelo event loop — ou precisar escalar, reiniciar e falhar de forma
independente —, a mesma imagem e o mesmo bundle podem ser inicializados como vários processos
cooperantes. Veja [Processos divididos](/docs/deployment/split-processes/).

## Atualização

```yaml
image: rebasepro/server:0.34.0
```

Reinicie. Seu bundle permanece inalterado. Dentro de uma mesma versão major do contrato de runtime, um bundle que
foi validado continuará funcionando — veja
[Compatibilidade](/docs/architecture/runtime-and-bundles/#compatibility).
