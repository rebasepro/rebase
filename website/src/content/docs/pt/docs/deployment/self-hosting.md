---
sourceHash: d3a77712f89b7829
title: Self-Hosting
sidebar_label: Self-Hosting
description: Execute o Rebase em qualquer lugar com a imagem oficial de runtime e o bundle do seu projeto — Docker Compose, Fly, Railway ou uma VPS comum.
---

## Visão geral

Fazer self-hosting do Rebase significa executar duas coisas: um banco de dados Postgres e a imagem oficial `rebasepro/server` com o bundle do seu projeto montado nela.

Não há **nenhuma imagem de aplicação para construir**. Seu projeto trafega como um bundle, o runtime é publicado, e atualizar o Rebase é uma mudança de tag em vez de um rebuild. Veja [Runtime e bundles](/docs/architecture/runtime-and-bundles/) para entender por que ele é dividido dessa forma.

## Docker Compose

**Se o seu projeto veio do `rebase init`, use o próprio `docker-compose.yml` dele.**
Ele está no seu repositório, o `init` preencheu seus segredos, sua primeira conta de administrador e sua versão fixada do runtime, e é o arquivo que [Implantação](/docs/getting-started/deployment/#docker-compose-recommended) descreve:

```bash
rebase build
docker compose up -d
```

O restante desta página trata da mesma implantação sem um scaffold por trás — o projeto de outra pessoa, um bundle construído em CI, ou as duas coisas que o arquivo gerado deliberadamente deixa de fora: um connection pooler e os formatos de processos divididos (split-process). Esse arquivo fica no repositório, em [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Use-o em vez de copiar um trecho desta página: ambos os arquivos são inicializados pelo próprio portal de aceitação do projeto a cada push, portanto nenhum dos dois pode divergir do que realmente funciona.

Os dois concordam em todas as variáveis de ambiente, exceto na senha do banco de dados, e isso acontece porque cada um foi escrito para o seu próprio criador: este lê `POSTGRES_PASSWORD`, que o `quickstart.sh` gera; o gerado lê `DATABASE_PASSWORD`, que o `rebase init` também embute na `DATABASE_URL` que ele grava no seu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

O `quickstart.sh` é um único comando que faz duas coisas óbvias e exibe ambas. A forma estendida, se você preferir controlar cada etapa:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Você não precisa iniciar o banco de dados separadamente — a `api` aguarda pelo healthcheck dele.

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

- **`POSTGRES_PASSWORD`** — a senha do banco de dados. Alterá-la mais tarde significa alterá-la no volume também, portanto escolha-a uma vez só.
- **`JWT_SECRET`** — assina todas as sessões. Fazer a rotação desconecta todo mundo.
- **`REBASE_SERVICE_KEY`** — a credencial que ignora o row-level security para chamadas servidor-a-servidor. Trate-a como uma senha de root: qualquer serviço que a possua pode ler todas as linhas.
- **`CORS_ORIGINS`** — as origens a partir das quais o seu frontend é servido, separadas por vírgula. Não é um segredo e não é opcional: o runtime se recusa a iniciar em produção sem isso em vez de tentar adivinhar, porque uma API que adivinha suas origens permitidas eventualmente permite a origem errada.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — o primeiro administrador. Um banco de dados recém-criado não tem usuários e, fora de produção, a política de registro aceita o primeiro cadastro e o promove a administrador — caso contrário, um banco de dados vazio seria um beco sem saída, pois inicializar um admin exige um chamador que já esteja autenticado. No momento em que essa stack responde em um hostname, essa conveniência se torna uma corrida que o operador pode perder; portanto, em produção a janela é fechada e a conta é definida aqui. O runtime a cria uma única vez, enquanto a tabela de usuários estiver vazia, e não faz nada em todas as inicializações subsequentes.

`JWT_SECRET` e `REBASE_SERVICE_KEY` devem ter pelo menos 32 caracteres cada, e a senha de administrador pelo menos 12. Use um endereço com ponto no domínio: `POST /auth/login` faz o parse do body com `z.string().email()`, então o runtime se recusa a criar `admin@localhost` — uma conta na qual ninguém conseguiria fazer login — e registra o motivo no log. O arquivo compose declara todas as seis com `${VAR:?…}`, portanto a falta de qualquer uma interrompe a stack com uma mensagem indicando-a, em vez de iniciar algo configurado pela metade — e o autorregistro vem desativado por padrão (`DISABLE_SELF_REGISTRATION`, padrão `true`), para que nada fique desprotegido.

Faça login com essas credenciais e altere a senha: elas estão expostas em um arquivo no host.

## Dependências

O comando `rebase build` **instala as dependências do seu projeto dentro do bundle** por padrão, de modo que `dist-bundle` já vem com um `node_modules` e um `package-lock.json` ao lado do seu `package.json`. Um bundle com dependências inclusas inicia em cerca de cinco segundos.

Como elas já estão lá, você pode montar o bundle como somente leitura — algo que vale a pena fazer, já que um hook comprometido não poderá sobrescrever o código que será executado após o próximo reinício:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` desativa essa opção e produz um bundle que instala suas dependências na primeira inicialização, o que leva de 40 a 60 segundos por inicialização e requer que o ponto de montagem seja gravável.

Para uma implantação real, prefira embutir ambos em uma imagem, o que também fixa exatamente o que é executado:

```dockerfile
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

## Criando o schema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**O runtime cria as tabelas ausentes na inicialização, incluindo as que `backend/schema` declara.**
`REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema: ele cria tabelas, colunas e tipos enum ausentes, e aplica o row-level security deles. Uma primeira inicialização em um banco de dados vazio já sobe servindo suas tabelas, sem nenhuma etapa separada.

O que o `ensure` deliberadamente nunca faz é alterar algo que já existe. Ele não altera o tipo de uma coluna, não remove uma tabela ou coluna e não edita os rótulos de um enum existente — porque o reinício de um contêiner não deve ser capaz de remodelar um schema como efeito colateral de um deploy.

Portanto, o `rebase db push` ainda vale a pena ser executado para o que a inicialização não mexe — qualquer alteração que não seja puramente aditiva: uma coluna renomeada, um tipo mais restrito, um campo removido.

```bash
rebase db push
```

Execute-o a partir de um checkout ou de um job de CI, apontado para o banco de dados da implantação. Ele executa um teste preliminar (dry-run) da alteração primeiro, recusa mudanças destrutivas sem confirmação explícita e pode fazer um backup antes de aplicar. O banco de dados expõe uma porta no arquivo compose para que seja possível alcançá-lo a partir do host; remova esse mapeamento assim que o schema estiver definido se o banco de dados não dever ser acessível externamente.

`REBASE_MIGRATE_ON_BOOT` aceita `ensure` e `none`, e nada mais — a imagem **se recusa a inicializar** com `push`, pelo motivo citado acima.

## Quando apenas o seu processo de mudanças pode alterar o banco de dados

`REBASE_MIGRATE_ON_BOOT=none` não mexe nas suas tabelas. Mas não deixa o banco de dados intacto: as próprias tabelas do framework (autenticação, chaves de API, jobs, cron) ainda são criadas e mantidas atualizadas a cada inicialização. Quando o banco de dados só puder ser alterado por meio de um processo de mudança revisado, defina `REBASE_PROVISION=false` em cada processo que atende requisições:

| Configuração | Tabelas e políticas declaradas | Tabelas do framework |
|---|---|---|
| padrão (`REBASE_MIGRATE_ON_BOOT=ensure`) | criadas e mantidas atualizadas na inicialização | criadas e mantidas atualizadas |
| `REBASE_MIGRATE_ON_BOOT=none` | intocadas | criadas e mantidas atualizadas |
| `REBASE_PROVISION=false` | intocadas | intocadas; o que estiver faltando é listado no log |

Com o provisionamento desativado, o runtime não cria nem altera nada: nenhuma tabela, coluna, índice, função, trigger, política, role ou grant. Isso vale tanto na inicialização quanto posteriormente, incluindo as tabelas que um processo de atendimento criaria no primeiro uso (chaves de idempotência, reivindicações de cron, contadores compartilhados de rate limit). Em vez disso, ele apenas lê o que já existe:

- **Tabelas de autenticação ou uma coluna que a autenticação lê ausentes:** a inicialização é recusada e cada uma é listada.
- **A role da requisição tem acesso a uma tabela do framework** como `rebase.refresh_tokens` ou `rebase.api_keys`: a inicialização é recusada e exibe o comando `REVOKE` a ser executado. Uma inicialização com provisionamento ativo revoga esses privilégios por conta própria. Com o provisionamento desativado, nada faz isso.
- **Uma tabela opcional ausente** (chaves de API, chaves de idempotência, reivindicações de cron, contadores de rate limit, presença, histórico de métricas): essa funcionalidade fica desativada e o log indica qual tabela é necessária.
- <span class="since-badge" data-since="0.31">Desde 0.31</span> **Uma tabela declarada que o banco de dados não protege** — row-level security desativado, nenhuma das políticas que ela declara presente ou uma política restritiva declarada ausente: essa tabela não é servida (uma política permissiva ausente é servida, com um aviso na inicialização indicando-a). Uma requisição para ela responde com `503 TABLE_WITHHELD`, e o log de inicialização informa o SQL que a protege (ou `rebase db push`). As outras tabelas continuam sendo servidas e a inicialização prossegue. Uma junção many-to-many é verificada da mesma maneira: se o banco de dados não a protege, as tabelas cujos relacionamentos a utilizam são retidas, e `TABLE_WITHHELD` indica a junção. Isso também se aplica com `REBASE_MIGRATE_ON_BOOT=none` e em uma atualização de schema em tempo real.

As linhas continuam sendo alteradas normalmente, como em qualquer banco de dados: logins, sessões, uso de chaves de API, chaves de idempotência, reivindicações de cron. A primeira conta de administrador (`REBASE_ADMIN_EMAIL`) é criada na execução de provisionamento, não pelos processos que atendem requisições. A [Edição de schema em tempo real](/docs/backend/live-schema-editing) ainda pode realizar o commit de uma alteração no código-fonte, mas se recusa a aplicá-la ao banco de dados.

### A execução de provisionamento

O schema provém de uma execução que o seu processo de mudança controla. Use a mesma imagem e bundle do servidor, com `REBASE_PROVISION_ONLY=true`, conectado como uma role que tenha permissão de criação no banco de dados. O `REBASE_PROVISION_SQL_OUT` armazena cada alteração de schema feita pela execução como um script SQL:

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

A imagem executa com `NODE_ENV=production`, portanto esta execução passa pelas mesmas validações de ambiente do servidor, incluindo `CORS_ORIGINS` ou `FRONTEND_URL`, mesmo que não sirva requisições.

O script é um registro, não um plano: cada instrução nele foi executada, em ordem, e teve sucesso. Registrado contra um banco de dados vazio, ele é todo o schema de que a release precisa. Registrado contra uma cópia restaurada de produção, ele é exatamente a atualização. As linhas que a execução gravou não estão nele. Revise-o e, em seguida, aplique-o ao banco de dados real:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Repita o processo para cada atualização do Rebase, antes do rollout dos processos de atendimento. Uma release pode adicionar uma tabela ou coluna, e um processo sem permissão para criá-la reportará sua ausência em vez de gerá-la.

Um servidor construído por você mesmo segue a mesma regra: `initializeRebaseBackend` lê `REBASE_PROVISION`, e `createRebaseBackend` aceita [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Armazenamento de arquivos

O armazenamento fica **desativado** a menos que um bucket esteja configurado, e isso é deliberado: o padrão alternativo seria o sistema de arquivos do contêiner, que perderia silenciosamente todos os arquivos enviados no próximo reinício. Os uploads são recusados com `501 STORAGE_NOT_CONFIGURED` até que você configure um.

Para um bucket, defina `STORAGE_TYPE=s3` (ou `gcs`) mais o bucket e suas credenciais — o arquivo compose lista as variáveis comentadas. `gcs` carrega `@google-cloud/storage`, que a imagem oficial não inclui; portanto, nessa imagem acesse o Google Cloud Storage por meio do endpoint compatível com S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, chaves HMAC).

Para disco local, o que só é adequado quando o caminho for um volume real que sobreviva ao contêiner:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` não é opcional nesse caso: em produção, um backend `local` é descartado em vez de registrado, pois a alternativa seriam uploads bem-sucedidos em um sistema de arquivos prestes a ser destruído. A variável é a forma de informar que a montagem é durável.

Monte o volume **acima** de `STORAGE_PATH`, e não diretamente nele. `STORAGE_PATH` é o diretório do bucket padrão, e cada bucket declarado em `backend/resources.ts` ganha o seu próprio ao lado dele, `<STORAGE_PATH>__<key>`. Um volume montado diretamente em `STORAGE_PATH` comportará apenas o bucket padrão. Todos os outros buckets gravarão no sistema de arquivos do contêiner e perderão seus arquivos quando o contêiner for recriado. `STORAGE_PATH__MEDIA` pode mover um bucket para outro local no volume. Ele não pode movê-lo para dentro do diretório de outro bucket, como `/storage/uploads/media`, porque o bucket padrão listaria, serviria e excluiria seus arquivos.

A imagem cria `/storage` para o usuário não privilegiado `node` com o qual ela executa, motivo pelo qual o volume deve ir para lá. Um volume montado onde a imagem não possui diretório pertencerá ao root, e todo upload falhará com `EACCES`. O arquivo compose gerado por `rebase init` o monta dessa forma.

### O armazenamento precisa de um modelo de controle de acesso

Assim que um bucket **estiver** configurado, o runtime **se recusa a inicializar em produção** até que a implantação declare como os objetos são protegidos. O armazenamento não está sob o row-level security e suas chaves compartilham um namespace único e plano, portanto, sem regras, a única coisa que separa os arquivos de dois usuários é a impossibilidade de adivinhar as chaves — o que `GET /storage/list?prefix=` contorna. Qualquer uma das opções a seguir atende a essa exigência:

- um **hook `storageAuthorize`** (ou `storagePolicies`) na configuração do seu projeto, que é a resposta definitiva e o que o scaffold traz em `backend/storage.ts` — nenhuma variável de ambiente consegue expressar "este usuário pode ler esta chave";
- **`STORAGE_PUBLIC_READ=true`**, para um bucket que é genuinamente uma CDN pública somente leitura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para um aplicativo single-tenant onde qualquer conta autenticada tem permissão de acesso a qualquer arquivo.

Fora de produção, a mesma condição gera um aviso visível em vez de uma recusa, portanto essa é uma falha de inicialização com a qual você se depara no deploy e não no ambiente local. Isso é deliberado: a falha que isso substitui é silenciosa.

Defina também `MFA_ENCRYPTION_KEY` se utilizar TOTP. Se não for definida, os segredos de autenticador armazenados serão criptografados com `JWT_SECRET` — portanto, rotacionar essa chave desconectará todos os usuários *e* tornará impossível descriptografar os dispositivos cadastrados.

## Outras plataformas

O runtime é um contêiner comum escutando na `$PORT`, portanto qualquer plataforma que execute contêineres funciona. Duas coisas para ajustar corretamente em qualquer lugar:

1. O bundle deve estar presente em `/bundle` (ou onde quer que `REBASE_BUNDLE` aponte), com suas dependências instaladas ao lado dele — veja [Dependências](#dependências).
2. Defina `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. O runtime se recusa a iniciar em produção sem eles em vez de tentar adivinhar.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.30.1 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Use o formato de imagem derivada acima para que o bundle seja enviado junto com a aplicação e, em seguida, execute `fly deploy`.

### Railway / Render

Aponte o serviço para a imagem derivada, configure as variáveis de ambiente e defina o caminho do health check para `/livez`.

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

`NODE_ENV=production` não é mero detalhe. Se não for definida, o processo é executado em modo de desenvolvimento: ele aceita origens de localhost, serve a especificação OpenAPI e **deixa a janela do primeiro administrador aberta** — assim, o primeiro desconhecido que encontrar o formulário de cadastro se torna o administrador. As duas linhas `REBASE_ADMIN_*` são o que substitui essa janela; veja [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` está presente porque o banco de dados fica na mesma máquina. Em produção, o runtime recusa qualquer variável que aponte para localhost — em um contêiner, o loopback é o próprio contêiner, portanto esse endereço é quase sempre um engano — e esta linha indica que o endereço é intencional. Remova-a quando o banco de dados for executado em outro lugar.

Prefira `EnvironmentFile=/etc/rebase.env` com o arquivo em modo 0600 em vez de linhas `Environment=` para os segredos: um arquivo de unidade (unit file) é legível por qualquer usuário do sistema, e `systemctl show` imprime todos os valores de `Environment=`.

## Connection pooling

O runtime mantém um pool pequeno e de longa duração e não precisa de um pooler. O que precisa de um pooler é todo o resto que se comunica com o mesmo banco de dados e não pode reter uma conexão: uma função serverless, um script agendado, uma ferramenta de BI, um worker de fila que escala para cinquenta instâncias. O `max_connections` do Postgres é um limite rígido na faixa de poucas centenas e cada conexão é um *processo*, de modo que uma distribuição em escala de lambdas (fan-out) esgota esse limite muito antes de o banco de dados ficar ocupado.

O arquivo compose traz um serviço `pgbouncer` para esse tráfego, protegido por um profile para que uma implantação sem esses consumidores não execute um processo desnecessário:

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

A autenticação do cliente é gerada a partir da `DATABASE_URL` na inicialização, portanto a senha não precisa ser informada duas vezes. O pooler se autentica no Postgres com `scram-sha-256`, que o Postgres 18 armazena — o padrão `md5` da imagem faz o login do *servidor* falhar com `FATAL: server login failed: wrong password type`, o que se parece com uma senha incorreta, mas não é.

Mantenha a soma de `PGBOUNCER_POOL_SIZE` em todos os poolers confortavelmente abaixo do `max_connections` do banco de dados — o runtime está consumindo dessa mesma cota.

### O que muda com o transaction pooling

Um cliente no pool retém uma conexão de servidor apenas durante a transação e a devolve em seguida, o que permite que 500 clientes compartilhem 20 conexões. Três recursos deixam de funcionar por meio dessa porta, e cada um deles é utilizado pelo próprio Rebase — razão pela qual o runtime se conecta diretamente e essa porta é reservada para outros chamadores:

- **`LISTEN`/`NOTIFY`.** O Realtime é construído sobre isso, e um listener precisa de uma conexão que dure mais do que uma transação. O `LISTEN` é *aceito* através do pooler — ele responde com `LISTEN`, e nenhuma notificação jamais é entregue.
- **Estado de sessão**: `SET` (em oposição a `SET LOCAL`), advisory locks mantidos entre instruções, cursores `WITH HOLD`, tabelas temporárias. A próxima transação pode cair em uma conexão de servidor diferente, que não verá nada disso. Ambos falham da mesma forma traiçoeira: com um único cliente ocioso, o estado geralmente ainda estará lá, de modo que funciona durante os testes e para de funcionar sob a concorrência para a qual você implementou o pooler.
- **Prepared statements a nível de protocolo.** A maioria dos drivers pode ser configurada para não utilizá-los — o node-postgres não os utiliza por padrão; o asyncpg precisa de `statement_cache_size=0`.

`SET LOCAL` tem escopo de transação e funciona, sendo o que é utilizado para definir o row-level security — portanto o RLS se comporta de maneira idêntica através da porta do pool.

Mantenha o profile desativado se nada fora do runtime se conectar ao seu banco de dados. Uma porta não utilizada é superfície de ataque.

## Health checks

| Caminho | Finalidade |
| --- | --- |
| `/livez` | Liveness. Responde "este processo está vivo" sem tocar no banco de dados. |
| `/health` | Readiness. Realiza um ciclo de ida e volta (round-trip) no banco de dados e informa a latência. |

Aponte as sondas de liveness para `/livez`. Uma sonda de liveness em `/health` reinicia um processo perfeitamente saudável durante uma oscilação momentânea do banco de dados, o que é o oposto do seu propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expõe métricas do Prometheus em `/metrics`: contagem de requisições e histogramas de latência detalhados por superfície de API (data, auth, storage, functions) e tabela, além de gauges do processo. Sem um token, o endpoint fica legível para qualquer pessoa que possa acessar a porta, portanto configure um a menos que esteja em uma rede privada.

`rebase_db_pool_wait_ms` é um histograma de quanto tempo cada consulta aguardou por uma conexão do pool do banco de dados, incluindo a abertura de uma nova, rotulado pela chave da fonte de dados (`source="(default)"` em um projeto que não declara fontes de dados). Um pool saudável mantém esse valor próximo de zero. Uma cauda que cresce com o tráfego significa que as requisições estão formando fila por conexões — quase sempre retidas por hooks de escrita que aguardam algo lento; veja [Um hook retém uma conexão](/docs/collections/context-data-api/#a-hook-holds-a-connection).

O próprio banco de dados, por fonte de dados:

| Métrica | O que informa |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | As conexões de cada pool, rotuladas como `pool="primary"`, `"read"` (a réplica) ou `"session"` (o pool direto do console SQL atrás de um pooler). `waiting` acima de zero por muito tempo indica um pool pequeno demais para a sua carga. |
| `rebase_db_connection_errors_total` | Requisições que responderam com 503 por falta de conexão, por `code`: `53300` / `53400` (o servidor está sem conexões), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Conexões de clientes no servidor, por `state`, em relação a `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | O tamanho do banco de dados. |
| `rebase_db_replica_lag_seconds` | O quanto a `DATABASE_READ_URL` está atrasada em relação ao primário. |

Os quatro últimos são amostrados a cada 30 segundos na própria conexão da instância, de modo que uma coleta (scrape) nunca se transforma em uma consulta direta.

`rebase_realtime_*` reporta os sockets e canais abertos de cada instância e os frames que ela enviou ao barramento de canais ou conteve: veja [Vendo o que o barramento faz](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Cabeçalhos de segurança

Cada resposta contém `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Strict-Transport-Security: max-age=15552000` (180 dias). O cabeçalho HSTS omite `includeSubDomains`: isso diria aos navegadores para recusar HTTP comum em todos os subdomínios do seu domínio, incluindo aqueles com os quais este servidor não tem relação alguma, e o navegador mantém essa regra pelo período indicado no cabeçalho.
Defina `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` quando todos os subdomínios forem estritamente HTTPS.

`strict-origin-when-cross-origin` é o padrão dos próprios navegadores: uma requisição para outro site carrega a sua origem e nunca o caminho ou query da página. Não é `no-referrer` porque as verificações de origem precisam dela — o botão de login do Google a compara com as origens JavaScript autorizadas do cliente OAuth e, com `no-referrer`, ele respondia "The given origin is not allowed for the given client ID" em qualquer aplicativo, independentemente do que o cliente permitisse. Uma resposta que defina sua própria política a mantém (a página de consentimento do MCP envia `no-referrer`); uma página que deseje uma política mais restrita pode especificá-la com `<meta name="referrer" content="no-referrer">`. O `X-Frame-Options` funciona da mesma forma: `SAMEORIGIN`, a menos que a resposta defina a sua própria, como faz a página de consentimento do MCP com `DENY`.

As aplicações estáticas — o admin do CMS e qualquer frontend servido pelo bundle — também trazem `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Isso decide quem pode colocar o app em frames, exclui plugins e fixa a tag `<base>` na sua origem, sem restringir mais nada, para que scripts inline, workers e login de terceiros continuem funcionando. Uma resposta que defina sua própria política a mantém. Para qualquer restrição mais rígida, aplique a política no proxy reverso à frente.

## Mais de uma instância

Um único contêiner é o padrão e não necessita de mais nada. Antes de uma segunda réplica receber tráfego — ou de um rolling deploy executar duas lado a lado —, consulte [Executando mais de uma instância](/docs/deployment/multiple-instances/): limites de taxa (rate limits), canais de broadcast, arquivos locais, uploads retomáveis e o cache de imagens são por processo até que uma configuração os compartilhe.

## Conectando o Claude

Um único comando adiciona este servidor ao [conector do Rebase](/docs/ai/rebase-connector/), o conector MCP unificado que alcança todos os seus projetos a partir do Claude:

```bash
rebase cloud connect https://your-app.com
```

Configure as duas variáveis que ele exibe neste servidor e reinicie-o. O servidor deve rodar o Rebase 0.28.1 ou posterior e responder via https em um endereço público. Nada mais muda: ele não armazena segredos e concede ao conector o mesmo que o Studio concederia.

## Executando funções em seu próprio processo

Tudo o que foi descrito acima consiste em um único contêiner servindo todo o projeto, que é a estrutura ideal para quase todas as implantações. Quando uma função personalizada precisar parar de competir com a data API pelo event loop — ou precisar escalar, reiniciar e falhar isoladamente —, a mesma imagem e o mesmo bundle podem ser inicializados como vários processos cooperantes. Veja [Processos divididos](/docs/deployment/split-processes/).

## Atualizando

```yaml
image: rebasepro/server:0.30.1
```

Reinicie. Seu bundle permanece inalterado. Dentro de uma versão major do contrato de runtime, um bundle que foi validado continuará funcionando — veja [Compatibilidade](/docs/architecture/runtime-and-bundles/#compatibility).
