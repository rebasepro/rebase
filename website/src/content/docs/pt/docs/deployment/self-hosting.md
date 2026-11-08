---
sourceHash: 73b578b3dd3a2d81
title: Auto-hospedagem
sidebar_label: Auto-hospedagem
description: Execute o Rebase em qualquer lugar com a imagem oficial de runtime e o bundle do seu projeto — Docker Compose, Fly, Railway ou uma VPS simples.
---

## Visão Geral

Fazer a auto-hospedagem do Rebase significa executar duas coisas: um banco de dados Postgres e a imagem oficial `rebasepro/server` com o bundle do seu projeto montado nela.

**Não há imagem de aplicação para compilar**. Seu projeto viaja como um bundle, o runtime é publicado e atualizar o Rebase é uma mudança de tag em vez de uma recompilação. Veja [Runtime and bundles](/docs/architecture/runtime-and-bundles/) para entender por que ele é dividido dessa forma.

## Docker Compose

**Se o seu projeto veio do `rebase init`, use o próprio `docker-compose.yml` dele.**
Ele está no seu repositório, o `init` preencheu seus segredos, sua primeira conta de administrador e sua versão fixada de runtime, e é o arquivo que [Deployment](/docs/getting-started/deployment/#docker-compose-recommended) descreve:

```bash
rebase build
docker compose up -d
```

O restante desta página trata da mesma implantação sem um scaffold por trás — o projeto de outra pessoa, um bundle compilado em CI ou as duas coisas que o arquivo gerado deliberadamente omite: um pooler de conexões e os formatos de processos divididos. Esse arquivo fica no repositório, em [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Use-o em vez de copiar um trecho desta página: ambos os arquivos são inicializados pelo próprio gate de aceitação do projeto a cada push, de modo que nenhum dos dois se distancia do que realmente funciona.

Os dois concordam em todas as variáveis de ambiente, exceto na senha do banco de dados, e isso acontece porque cada um foi escrito para o seu próprio criador: este lê `POSTGRES_PASSWORD`, que o `quickstart.sh` gera; o gerado lê `DATABASE_PASSWORD`, que o `rebase init` também insere na `DATABASE_URL` que ele grava no seu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

O `quickstart.sh` é um comando único que faz duas coisas óbvias e imprime ambas. A forma longa, se você preferir controlar cada etapa:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Você não precisa iniciar o banco de dados separadamente — a `api` aguarda o seu healthcheck.

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

- **`POSTGRES_PASSWORD`** — a senha do banco de dados. Alterá-la mais tarde significa alterá-la também no volume, portanto, escolha-a uma vez só.
- **`JWT_SECRET`** — assina todas as sessões. Rotacioná-lo desconecta todos os usuários.
- **`REBASE_SERVICE_KEY`** — a credencial que ignora o row-level security para chamadas de servidor para servidor. Trate-a como uma senha de root: qualquer coisa que a possua pode ler todas as linhas.
- **`CORS_ORIGINS`** — as origens a partir das quais seu frontend é servido, separadas por vírgula. Não é um segredo e não é opcional: o runtime se recusa a iniciar em produção sem ele em vez de tentar adivinhar, porque uma API que adivinha suas origens permitidas eventualmente permite a origem errada.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — o primeiro administrador. Um banco de dados novo não tem usuários e, fora de produção, a política de registro aceita o primeiro cadastro e o promove a administrador — caso contrário, um banco de dados vazio seria um beco sem saída, já que inicializar um administrador exige um chamador que já esteja autenticado. No momento em que essa stack responde em um hostname, essa conveniência se torna uma corrida que o operador pode perder; por isso, em produção, essa janela é fechada e a conta é definida aqui. O runtime a cria uma vez, enquanto a tabela de usuários estiver vazia, e não faz nada em todas as inicializações subsequentes.

`JWT_SECRET` e `REBASE_SERVICE_KEY` devem ter pelo menos 32 caracteres cada, e a senha do administrador pelo menos 12. Use um endereço com um ponto em seu domínio: `POST /auth/login` analisa seu corpo com `z.string().email()`, portanto o runtime se recusa a inicializar `admin@localhost` — uma conta na qual ninguém conseguiria fazer login — e, em vez disso, registra o motivo no log. O arquivo compose declara todos os seis com `${VAR:?…}`, portanto, a ausência de um deles interrompe a stack com uma mensagem indicando-o, em vez de iniciar algo configurado pela metade — e o autorregistro vem desativado (`DISABLE_SELF_REGISTRATION`, padrão `true`), para que nada fique disponível para reivindicação.

Faça login com essas credenciais e altere a senha: elas estão em um arquivo no host.

## Dependências

O `rebase build` **instala as dependências do seu projeto dentro do bundle** por padrão, de modo que o `dist-bundle` já vem com um `node_modules` e um `package-lock.json` ao lado do seu `package.json`. Um bundle com dependências embutidas (vendored) inicia em cerca de cinco segundos.

Como elas já estão lá, você pode montar o bundle como somente leitura — vale a pena fazer isso, pois um hook comprometido não poderá reescrever o código executado após a próxima reinicialização:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

O comando `rebase build --no-vendor` desativa isso e produz um bundle que instala suas dependências na primeira inicialização, o que leva de 40 a 60 segundos por inicialização e exige que a montagem seja gravável.

Para uma implantação real, prefira embutir ambos em uma imagem, o que também fixa exatamente o que é executado:

```dockerfile
FROM rebasepro/server:0.28.2
COPY dist-bundle /bundle
```

## Criando o schema

**O runtime cria tabelas ausentes na inicialização, incluindo as das suas coleções.**
O `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema: ele cria tabelas, colunas e tipos enum ausentes, e aplica seu row-level security. Uma primeira inicialização em um banco de dados vazio já começa servindo suas coleções, sem etapas separadas.

O que o `ensure` deliberadamente nunca faz é alterar algo que já existe. Ele não altera o tipo de uma coluna, não exclui uma tabela ou coluna e não edita os rótulos de um enum existente — porque a reinicialização de um contêiner não deve ser capaz de remodelar um schema como efeito colateral de um deploy.

Portanto, o `rebase db push` ainda vale a pena ser executado para o que a inicialização não mexe — qualquer alteração que não seja puramente aditiva: uma coluna renomeada, um tipo mais restrito, um campo removido.

```bash
rebase db push
```

Execute-o a partir de um checkout local ou de um job de CI, apontado para o banco de dados da implantação. Ele simula a alteração primeiro (dry-run), recusa alterações destrutivas sem confirmação explícita e pode fazer um backup antes de aplicar. O banco de dados expõe uma porta no arquivo compose para que este comando possa alcançá-lo a partir do host; remova esse mapeamento assim que o schema estiver definido se o banco de dados não deve ser acessível externamente.

`REBASE_MIGRATE_ON_BOOT` aceita `ensure` e `none`, e nada mais — a imagem **se recusa a inicializar** com `push`, pelo motivo citado acima.

## Quando apenas o seu processo de mudanças pode alterar o banco de dados

`REBASE_MIGRATE_ON_BOOT=none` não altera suas coleções. Mas não deixa o banco de dados intocado: as próprias tabelas do framework (autenticação, chaves de API, jobs, cron) ainda são criadas e mantidas atualizadas a cada inicialização. Quando o banco de dados só pode ser alterado por meio de um processo de mudanças revisado, defina `REBASE_PROVISION=false` em todos os processos que atendem requisições:

| Configuração | Tabelas de coleções e políticas | Tabelas do framework |
|---|---|---|
| padrão (`REBASE_MIGRATE_ON_BOOT=ensure`) | criadas e mantidas atualizadas na inicialização | criadas e mantidas atualizadas |
| `REBASE_MIGRATE_ON_BOOT=none` | não alteradas | criadas e mantidas atualizadas |
| `REBASE_PROVISION=false` | não alteradas | não alteradas; o que estiver ausente é listado no log |

Com o provisionamento desativado, o runtime não cria nem altera nada: nenhuma tabela, coluna, índice, função, trigger, política, role ou permissão (grant). Isso vale na inicialização e posteriormente, incluindo as tabelas que um processo de atendimento criaria no primeiro uso (chaves de idempotência, reivindicações de cron, contadores compartilhados de rate-limit). Em vez disso, ele lê o que já está lá:

- **Tabelas de autenticação, ou uma coluna lida pela autenticação, ausentes:** a inicialização é recusada e cada uma é listada.
- **A role da requisição pode acessar uma tabela do framework**, como `rebase.refresh_tokens` ou `rebase.api_keys`: a inicialização é recusada e exibe o comando `REVOKE` a ser executado. Uma inicialização com provisionamento remove esses privilégios por conta própria. Com o provisionamento desativado, nada faz isso.
- **Uma tabela opcional ausente** (chaves de API, chaves de idempotência, reivindicações de cron, contadores de rate-limit, presença, histórico de métricas): essa funcionalidade fica desativada e o log informa qual tabela é necessária.

As linhas ainda mudam, como em qualquer banco de dados: logins, sessões, uso de chaves de API, chaves de idempotência, reivindicações de cron. A primeira conta de administrador (`REBASE_ADMIN_EMAIL`) é criada pela execução de provisionamento, não pelos processos que atendem requisições. A [edição de schema em tempo real](/docs/backend/live-schema-editing) ainda pode comitar uma alteração como código-fonte, mas se recusa a aplicá-la ao banco de dados.

### A execução de provisionamento

O schema vem de uma execução que o seu processo de mudanças controla. Use a mesma imagem e bundle do servidor, com `REBASE_PROVISION_ONLY=true`, conectado como uma role que tenha permissão para criar no banco de dados. O `REBASE_PROVISION_SQL_OUT` grava todas as alterações de schema feitas pela execução na forma de um script SQL:

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

A imagem roda com `NODE_ENV=production`, portanto essa execução é submetida às mesmas verificações de ambiente que o servidor, incluindo `CORS_ORIGINS` ou `FRONTEND_URL`, mesmo que não atenda a nenhuma requisição.

O script é um registro, não um plano: cada instrução nele foi executada, em ordem, e teve sucesso. Registrado contra um banco de dados vazio, ele representa todo o schema necessário para a versão. Registrado contra uma cópia restaurada de produção, ele é exatamente a atualização. Linhas que a execução escreveu não estão nele. Revise-o e aplique-o ao banco de dados real:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Faça isso novamente a cada atualização do Rebase, antes que os processos que atendem requisições sejam atualizados. Uma nova versão pode adicionar uma tabela ou coluna, e um processo que não tem permissão para criá-la reportará sua ausência em vez de criá-la.

Um servidor que você mesmo constrói segue a mesma regra: `initializeRebaseBackend` lê `REBASE_PROVISION`, e `createRebaseBackend` aceita [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Armazenamento de arquivos

O armazenamento fica **desativado** a menos que um bucket seja configurado, e isso é deliberado: o padrão alternativo seria o sistema de arquivos do contêiner, que perde silenciosamente todos os arquivos enviados na próxima reinicialização. Os uploads são recusados com `501 STORAGE_NOT_CONFIGURED` até que você configure um.

Para um bucket, defina `STORAGE_TYPE=s3` (ou `gcs`) mais o respectivo bucket e credenciais — o arquivo compose lista as variáveis, comentadas. `gcs` carrega `@google-cloud/storage`, pacote que a imagem oficial não inclui; portanto, nessa imagem, acesse o Google Cloud Storage por meio de seu endpoint compatível com S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, chaves HMAC).

Para disco local, o que só é apropriado quando o caminho for um volume real que sobreviva ao ciclo de vida do contêiner:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` não é opcional nesse caso: em produção, um backend `local` é descartado em vez de registrado, pois a alternativa seriam uploads bem-sucedidos em um sistema de arquivos prestes a ser destruído. A variável é a forma de declarar que a montagem é durável.

Monte o volume **acima** de `STORAGE_PATH`, não diretamente nele. `STORAGE_PATH` é o diretório do bucket padrão, e cada bucket declarado em `config/resources.ts` ganha um diretório próprio ao lado dele, `<STORAGE_PATH>__<key>`. Um volume montado no próprio `STORAGE_PATH` conterá apenas o bucket padrão. Todos os outros buckets gravarão no sistema de arquivos do contêiner e perderão seus arquivos quando o contêiner for recriado. `STORAGE_PATH__MEDIA` pode mover um bucket para outro lugar no volume. Ele não pode movê-lo para dentro do diretório de outro bucket, como `/storage/uploads/media`, porque o bucket padrão passaria a listar, servir e excluir seus arquivos.

A imagem cria `/storage` para o usuário sem privilégios `node` com o qual ela é executada, e é por isso que o volume vai para lá. Um volume montado onde a imagem não possui diretório pertence ao root, e todo upload falha com `EACCES`. O arquivo compose que o `rebase init` gera faz a montagem dessa forma.

### O armazenamento precisa de um modelo de controle de acesso

Uma vez que um bucket **esteja** configurado, o runtime **se recusa a inicializar em produção** até que a implantação especifique como os objetos são protegidos. O armazenamento não está sob o row-level security e suas chaves compartilham um único namespace simples (flat); portanto, sem regras, a única coisa que separa os arquivos de dois usuários é a impossibilidade de adivinhar as chaves — o que o `GET /storage/list?prefix=` quebra. Qualquer uma das seguintes opções atende a essa exigência:

- um **hook `storageAuthorize`** (ou `storagePolicies`) na configuração do seu projeto, que é a solução real e o que o scaffold fornece em `config/storage.ts` — nenhuma variável de ambiente consegue expressar "este usuário pode ler esta chave";
- **`STORAGE_PUBLIC_READ=true`**, para um bucket que é genuinamente uma CDN pública somente leitura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para um aplicativo single-tenant em que qualquer conta autenticada tem permissão de acesso a todos os arquivos.

Fora de produção, essa mesma condição emite um aviso enfático em vez de uma recusa, portanto essa é uma falha de inicialização com a qual você se depara no deploy e não no ambiente local de desenvolvimento. Isso é deliberado: a falha que ela substitui é silenciosa.

Defina também `MFA_ENCRYPTION_KEY` se você usa TOTP. Se não for definido, os segredos de autenticador armazenados serão criptografados com `JWT_SECRET` — logo, rotacioná-lo desconectará todos os usuários *e* tornará todos os dispositivos cadastrados indecifráveis.

## Outras plataformas

O runtime é um contêiner comum escutando em `$PORT`, portanto qualquer serviço que execute contêineres funciona. Duas coisas para configurar corretamente em qualquer lugar:

1. O bundle deve estar presente em `/bundle` (ou onde quer que `REBASE_BUNDLE` aponte), com suas dependências instaladas ao lado dele — veja [Dependências](#dependências).
2. Defina `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. O runtime se recusa a iniciar em produção sem eles em vez de tentar adivinhar.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.28.2 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Use o modelo de imagem derivada acima para que o bundle seja enviado com a aplicação e, em seguida, execute `fly deploy`.

### Railway / Render

Aponte o serviço para a imagem derivada, defina as variáveis de ambiente e configure o caminho do health check para `/livez`.

### Uma VPS simples

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

O comando `rebase-server --help` lista as variáveis que ele lê. No systemd — as duas linhas `REBASE_ADMIN_*` exigem a versão 0.18 ou posterior; na 0.17.3, a primeira conta a se registrar torna-se o administrador:

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

`NODE_ENV=production` não é apenas decorativo. Se não for definido, o processo será executado em modo de desenvolvimento: ele aceita origens de localhost, expõe a especificação OpenAPI e **deixa a janela de primeiro administrador aberta** — de modo que o primeiro estranho que encontrar o formulário de cadastro se tornará o administrador. As duas linhas `REBASE_ADMIN_*` são o que substitui essa janela; veja [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` está ali porque o banco de dados fica na mesma máquina. Em produção, o runtime recusa qualquer variável que aponte para localhost — em um contêiner, o loopback é o próprio contêiner, portanto esse endereço é sempre um erro — e essa linha informa que o endereço é intencional. Remova-a quando o banco de dados for executado em outro local.

Prefira `EnvironmentFile=/etc/rebase.env` com as permissões do arquivo em modo 0600 em vez de linhas `Environment=` para os segredos: um arquivo de unidade (unit file) pode ser lido por qualquer usuário, e o comando `systemctl show` exibe todos os valores de `Environment=`.

## Pool de conexões

O runtime mantém um pool pequeno e de longa duração e não precisa de um pooler. Quem precisa é todo o resto que se comunica com o mesmo banco de dados e não pode reter uma conexão: uma função serverless, um script agendado, uma ferramenta de BI, um worker de fila que escala para cinquenta instâncias. O `max_connections` do Postgres é um limite rígido na faixa de poucas centenas e cada conexão é um *processo*, de modo que uma explosão de chamadas lambda o esgota muito antes de o banco de dados estar sobrecarregado.

O arquivo compose inclui um serviço `pgbouncer` para esse tráfego, protegido por um profile para que uma implantação sem esse tipo de chamador não execute um processo desnecessário:

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

A autenticação do cliente é gerada a partir da `DATABASE_URL` na inicialização, para que a senha não seja gravada duas vezes. O pooler se autentica no Postgres com `scram-sha-256`, que é o que o Postgres 18 armazena — o padrão `md5` da imagem falha no login do *servidor* com `FATAL: server login failed: wrong password type`, o que parece um erro de senha incorreta, mas não é.

Mantenha a soma de `PGBOUNCER_POOL_SIZE` em todos os poolers confortavelmente abaixo do `max_connections` do banco de dados — o runtime consome do mesmo orçamento.

### O que o pooling de transações altera

Um cliente com pooling retém uma conexão de servidor durante a duração de uma transação e depois a devolve, o que permite que 500 clientes compartilhem 20 conexões. Três coisas param de funcionar através dessa porta, e cada uma delas é algo que o próprio Rebase utiliza — razão exata pela qual o runtime se conecta diretamente e essa porta é destinada a outros chamadores:

- **`LISTEN`/`NOTIFY`.** O Realtime é baseado nisso, e um listener precisa de uma conexão que sobreviva além de uma transação. O `LISTEN` é *aceito* através do pooler — ele responde ao `LISTEN`, mas nenhuma notificação chega.
- **Estado de sessão:** `SET` (ao contrário de `SET LOCAL`), advisory locks mantidos entre instruções, cursores `WITH HOLD`, tabelas temporárias. A próxima transação pode cair em uma conexão de servidor diferente, que não verá nada disso. Ambos falham da mesma forma enganosa: com apenas um cliente ocioso, o estado geralmente ainda está lá, funcionando durante os testes locais e falhando sob a concorrência para a qual você introduziu o pooler.
- **Prepared statements a nível de protocolo.** A maioria dos drivers pode ser configurada para não usá-los — o node-postgres não os usa por padrão; o asyncpg precisa de `statement_cache_size=0`.

`SET LOCAL` tem escopo de transação e funciona, sendo o mecanismo usado para definir o row-level security — portanto, o RLS se comporta de forma idêntica através da porta com pooling.

Deixe o profile desativado se nada fora do runtime se conectar ao seu banco de dados. Uma porta não utilizada é superfície de ataque.

## Health checks

| Caminho | Uso |
| --- | --- |
| `/livez` | Liveness. Responde "este processo está vivo" sem tocar no banco de dados. |
| `/health` | Readiness. Realiza um ciclo completo de ida e volta ao banco de dados e relata a latência. |

Aponte as sondas de liveness para `/livez`. Uma sonda de liveness em `/health` reinicia um processo perfeitamente saudável durante uma breve instabilidade no banco de dados, o que é o oposto do seu propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expõe métricas do Prometheus em `/metrics`: contagens de requisições e histogramas de latência discriminados por superfície de API (data, auth, storage, functions) e coleção, além de gauges do processo. Sem um token, o endpoint pode ser lido por qualquer um que alcance a porta; portanto, configure um, a menos que ele esteja em uma rede privada.

`rebase_db_pool_wait_ms` é um histograma de quanto tempo cada consulta aguardou por uma conexão do pool do banco de dados, incluindo a abertura de uma nova conexão, rotulado pela chave da fonte de dados (`source="(default)"` em um projeto que não declara fontes de dados). Um pool saudável mantém esse valor próximo de zero. Uma cauda longa que cresce com o tráfego significa que as requisições estão formando fila por conexões — mais frequentemente retidas por callbacks de escrita que aguardam algo lento; veja [A callback holds a connection](/docs/collections/context-data-api/#a-callback-holds-a-connection).

O próprio banco de dados, por fonte de dados:

| Métrica | O que indica |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Conexões de cada pool, rotuladas como `pool="primary"`, `"read"` (a réplica) ou `"session"` (o pool direto do console SQL atrás de um pooler). `waiting` acima de zero por muito tempo indica um pool pequeno demais para sua carga. |
| `rebase_db_connection_errors_total` | Requisições respondidas com 503 por falta de conexão, por `code`: `53300` / `53400` (o servidor está sem conexões), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Conexões de clientes no servidor, por `state`, em relação a `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | O tamanho do banco de dados. |
| `rebase_db_replica_lag_seconds` | O quanto a `DATABASE_READ_URL` está atrasada em relação ao primário. |

Os últimos quatro são amostrados a cada 30 segundos na própria conexão da instância, de modo que uma coleta (scrape) nunca se transforma em uma consulta.

`rebase_realtime_*` relata os sockets e canais abertos de cada instância e os frames que ela enviou para o barramento de canais ou conteve: veja [Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Cabeçalhos de segurança

Cada resposta contém `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Strict-Transport-Security: max-age=15552000` (180 dias). O cabeçalho HSTS omite `includeSubDomains`: isso instruiria os navegadores a recusar HTTP simples em todos os subdomínios do seu domínio, incluindo aqueles com os quais este servidor não tem relação alguma, e o navegador mantém essa instrução pelo tempo determinado pelo cabeçalho.
Defina `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` quando todos os subdomínios forem exclusivamente HTTPS; até a versão 0.23 inclusive, o cabeçalho sempre incluía `includeSubDomains`.

`strict-origin-when-cross-origin` é o próprio padrão dos navegadores: uma requisição para outro site transporta a sua origem e nunca o caminho ou query da página. Não é `no-referrer` porque as verificações de origem precisam da origem — o botão de login do Google a compara com as origens JavaScript autorizadas do cliente OAuth e, com `no-referrer`, respondia "The given origin is not allowed for the given client ID" em qualquer aplicação, independentemente do que o cliente autorizava. Uma resposta que define sua própria política a mantém (a página de consentimento do MCP envia `no-referrer`); uma página que queira uma política mais restrita pode especificá-la com `<meta name="referrer" content="no-referrer">`. O `X-Frame-Options` funciona da mesma forma: `SAMEORIGIN`, a menos que a resposta defina a sua própria, como a página de consentimento do MCP faz com `DENY`.

As aplicações estáticas — o painel de administração do CMS e qualquer frontend que o bundle forneça — também incluem `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Isso determina quem pode embutir a aplicação em frames, descarta plugins e fixa a tag `<base>` na sua origem, não restringindo nada além disso, para que scripts inline, workers e login de terceiros continuem funcionando. Uma resposta que defina sua própria política a mantém. Para qualquer regra mais restritiva, configure a política no proxy reverso à frente.

## Mais de uma instância

Um único contêiner é o padrão e não necessita de mais nada. Antes que uma segunda réplica receba tráfego — ou que um deploy rolling execute duas lado a lado —, consulte [Running more than one instance](/docs/deployment/multiple-instances/): limites de taxa (rate limits), canais de broadcast, arquivos locais, uploads retomáveis e o cache de imagens são isolados por processo até que uma configuração os compartilhe.

## Conectando o Claude

Um comando adiciona este servidor ao [Rebase connector](/docs/ai/rebase-connector/), o conector MCP único que alcança todos os seus projetos a partir do Claude:

```bash
rebase cloud connect https://your-app.com
```

Defina as duas variáveis impressas por ele neste servidor e reinicie-o. O servidor deve executar o Rebase 0.28.1 ou posterior e responder via https em um endereço público. Nada mais muda: ele não armazena segredos e concede ao conector o que o Studio concederia.

## Executando funções em seu próprio processo

Tudo o que foi descrito acima é um contêiner atendendo ao projeto inteiro, que é o formato ideal para quase todas as implantações. Quando uma função customizada precisar parar de disputar o event loop com a API de dados — ou precisar escalar, reiniciar e falhar de forma independente —, a mesma imagem e o mesmo bundle podem ser inicializados como vários processos cooperantes. Veja [Split processes](/docs/deployment/split-processes/).

## Atualizando

```yaml
image: rebasepro/server:0.28.2
```

Reinicie. Seu bundle permanece inalterado. Dentro de uma versão major do contrato de runtime, um bundle validado continuará funcionando — veja [Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
