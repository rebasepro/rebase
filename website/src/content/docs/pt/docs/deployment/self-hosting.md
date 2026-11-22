---
sourceHash: 7cfed3fdc9ab52e4
title: Auto-hospedagem
sidebar_label: Auto-hospedagem
description: Execute o Rebase em qualquer lugar com a imagem oficial de runtime e o bundle do seu projeto — Docker Compose, Fly, Railway ou uma VPS comum.
---

## Visão geral

Fazer auto-hospedagem do Rebase significa executar duas coisas: um banco de dados Postgres e a
imagem oficial `rebasepro/server` com o bundle do seu projeto montado nela.

Não há **nenhuma imagem de aplicação para compilar**. Seu projeto viaja como um bundle,
o runtime é publicado e atualizar o Rebase é uma alteração de tag em vez de uma
recompilação. Consulte [Runtime e bundles](/docs/architecture/runtime-and-bundles/) para
entender por que ele é dividido dessa forma.

## Docker Compose

**Se o seu projeto veio do `rebase init`, use o seu próprio `docker-compose.yml`.**
Ele está no seu repositório, o `init` preencheu seus segredos, sua primeira conta de administrador
e sua versão fixada do runtime, e é o arquivo que
[Implantação](/docs/getting-started/deployment/#docker-compose-recommended)
descreve:

```bash
rebase build
docker compose up -d
```

O restante desta página trata da mesma implantação sem um scaffold por trás —
o projeto de outra pessoa, um bundle construído em CI, ou as duas coisas que o arquivo gerado
deliberadamente deixa de fora: um pooler de conexões e os formatos de processos divididos.
Esse arquivo reside no repositório, em
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Use-o em vez de copiar um trecho desta página: ambos os arquivos são inicializados pelo
próprio portal de aceitação do projeto a cada push, portanto nenhum deles pode divergir do que
realmente funciona.

Os dois concordam em todas as variáveis de ambiente, exceto a senha do banco de dados, e
isso acontece porque cada um foi escrito para o seu próprio criador: este lê
`POSTGRES_PASSWORD`, que o `quickstart.sh` gera; o gerado lê
`DATABASE_PASSWORD`, que o `rebase init` também embute na `DATABASE_URL` gravada
no seu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` é um comando que faz duas coisas óbvias e imprime ambas. A
forma longa, se você preferir controlar cada etapa:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Você não precisa iniciar o banco de dados separadamente — a `api` aguarda o seu
healthcheck.

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
  alterá-la no volume também, portanto escolha-a uma única vez.
- **`JWT_SECRET`** — assina todas as sessões. Rotacioná-lo desconecta todos os usuários.
- **`REBASE_SERVICE_KEY`** — a credencial que ignora a segurança em nível de linha (RLS) para
  chamadas servidor-a-servidor. Trate-a como uma senha de root: qualquer coisa que a possua pode
  ler todas as linhas.
- **`CORS_ORIGINS`** — as origens a partir das quais o seu frontend é servido, separadas por vírgula.
  Não é um segredo e não é opcional: o runtime se recusa a iniciar em produção
  sem isso em vez de tentar adivinhar, porque uma API que adivinha suas origens permitidas
  eventualmente permite a origem errada.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — o primeiro
  administrador. Um banco de dados novo não tem usuários e, fora de produção, a
  política de registro aceita o primeiro cadastro e o promove a administrador —
  caso contrário, um banco de dados vazio seria um beco sem saída, pois inicializar um administrador
  requer um chamador já autenticado. No momento em que essa stack responde em um
  hostname, essa conveniência se torna uma corrida que o operador pode perder; portanto, em produção,
  a janela é fechada e a conta é definida aqui. O runtime a cria uma única vez,
  enquanto a tabela de usuários estiver vazia, e não faz nada em todas as inicializações subsequentes.

`JWT_SECRET` e `REBASE_SERVICE_KEY` devem ter pelo menos 32 caracteres cada, e
a senha do administrador pelo menos 12. Use um endereço com um ponto em seu domínio:
`POST /auth/login` analisa seu corpo com `z.string().email()`, portanto o runtime
se recusa a criar `admin@localhost` — uma conta na qual ninguém conseguiria fazer login — e registra
o motivo no log. O arquivo compose declara todas as seis com
`${VAR:?…}`, de modo que a ausência de uma interrompe a stack com uma mensagem indicando-a,
em vez de iniciar algo configurado pela metade — e o autorregistro vem desativado por padrão
(`DISABLE_SELF_REGISTRATION`, padrão `true`), portanto nada fica exposto para reivindicação.

Faça login com essas credenciais e altere a senha: elas estão expostas em um
arquivo no host.

## Dependências

O `rebase build` **instala as dependências do seu projeto dentro do bundle** por
padrão, de modo que o `dist-bundle` já vem com um `node_modules` e um `package-lock.json`
ao lado do seu `package.json`. Um bundle com dependências embutidas (vendored) inicia em cerca de cinco segundos.

Como elas já estão lá, você pode montar o bundle como somente leitura — algo que vale a pena
fazer, já que um hook comprometido não poderá reescrever o código executado após a
próxima reinicialização:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` desativa isso e produz um bundle que instala suas
dependências na primeira inicialização, o que leva de 40 a 60 segundos por inicialização e
requer que a montagem tenha permissão de escrita.

Para uma implantação real, prefira embutir ambos em uma imagem, o que também fixa com precisão
o que é executado:

```dockerfile
FROM rebasepro/server:0.34.2
COPY dist-bundle /bundle
```

## Criando o schema

**O runtime cria tabelas ausentes na inicialização, incluindo as que `backend/schema` declara.**
`REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o
schema: ele cria tabelas, colunas e tipos enum ausentes, e aplica a
segurança em nível de linha (RLS) correspondente. Uma primeira inicialização em um banco de dados vazio já sobe
servindo suas tabelas, sem nenhuma etapa separada.

O que o `ensure` deliberadamente nunca faz é alterar qualquer coisa que já exista. Ele
não altera o tipo de uma coluna, não exclui uma tabela ou coluna e não
edita os rótulos de um enum existente — porque a reinicialização de um contêiner não deve ser capaz de
remodelar um schema como efeito colateral de um deploy.

Portanto, ainda vale a pena executar `rebase db push` para o que a inicialização não altera —
qualquer modificação que não seja puramente aditiva: uma coluna renomeada, um tipo mais restrito,
um campo removido.

```bash
rebase db push
```

Execute-o a partir de um checkout local ou de um job de CI, apontado para o banco de dados da implantação. Ele
simula a alteração primeiro (dry-run), recusa mudanças destrutivas sem confirmação explícita
e pode fazer um backup antes de aplicar. O banco de dados expõe uma
porta no arquivo compose para que este comando possa alcançá-lo a partir do host; remova esse mapeamento
assim que o schema estiver configurado, caso o banco de dados não deva ser acessível externamente.

`REBASE_MIGRATE_ON_BOOT` aceita `ensure` e `none`, e nada mais — a imagem
**se recusa a inicializar** com `push`, pelo motivo citado acima.

## Quando apenas o seu processo de mudanças puder alterar o banco de dados

`REBASE_MIGRATE_ON_BOOT=none` não altera suas tabelas. Mas não deixa
o banco de dados completamente intocado: as tabelas do próprio framework (autenticação, chaves de API, jobs, cron)
ainda são criadas e mantidas atualizadas a cada inicialização. Quando o banco de dados só puder ser alterado
por meio de um processo de mudanças revisado, defina `REBASE_PROVISION=false` em todos os processos
que atendem requisições:

| Configuração | Tabelas e políticas declaradas | Tabelas do framework |
|---|---|---|
| padrão (`REBASE_MIGRATE_ON_BOOT=ensure`) | criadas e mantidas atualizadas na inicialização | criadas e mantidas atualizadas |
| `REBASE_MIGRATE_ON_BOOT=none` | intocadas | criadas e mantidas atualizadas |
| `REBASE_PROVISION=false` | intocadas | intocadas; o que estiver ausente será listado no log |

Com o provisionamento desativado, o runtime não cria nem altera nada: nenhuma tabela, coluna,
índice, função, trigger, política, role ou permissão (grant). Isso se aplica na inicialização e posteriormente,
incluindo as tabelas que um processo servidor criaria no primeiro uso
(chaves de idempotência, reivindicações de cron, contadores compartilhados de rate limit). Em vez disso, ele
apenas lê o que já existe:

- **Tabelas de autenticação ou colunas lidas pela autenticação ausentes:** a inicialização é recusada e
  cada item é listado.
- **A role da requisição tem acesso a uma tabela do framework**, como
  `rebase.refresh_tokens` ou `rebase.api_keys`: a inicialização é recusada e exibe o
  `REVOKE` a ser executado. Uma inicialização com provisionamento ativado revoga esses privilégios por conta própria.
  Com o provisionamento desativado, nada faz isso.
- **Uma tabela opcional ausente** (chaves de API, chaves de idempotência, reivindicações de cron,
  contadores de rate limit, presença, histórico de métricas): essa funcionalidade fica desativada e o
  log informa qual tabela é necessária.
- **Uma tabela declarada que o banco de dados não protege** — segurança em nível de linha (RLS)
  desativada, nenhuma das políticas declaradas presente ou uma política restritiva
  declarada ausente: essa tabela não é servida (uma política permissiva ausente
  ainda é servida, com um aviso na inicialização indicando-a). Uma requisição para ela responde com `503 TABLE_WITHHELD`, e o log de inicialização
  indica o SQL que a protege (ou `rebase db push`). As outras tabelas são
  servidas e a inicialização continua. Uma tabela de junção muitos-para-muitos é verificada da mesma
  forma: se o banco de dados não a proteger, as tabelas cujas relações a utilizam são retidas, e `TABLE_WITHHELD` nomeia a junção. Uma tabela cuja relação `via`
  passe por uma tabela retida também é retida, e a mensagem indica a
  relação. Isso também é válido com `REBASE_MIGRATE_ON_BOOT=none` e em uma atualização de schema em tempo real.
  Uma tabela cujo controle de acesso é aplicado pela própria aplicação deve definir `rlsRequired: false` para ser servida mesmo assim ([como fazer](/docs/deployment/existing-database/#another-tool-owns-the-schema-and-the-app-enforces-access)).

As linhas ainda são alteradas, como ocorreria em qualquer banco de dados: logins, sessões, uso de chaves de API,
chaves de idempotência, reivindicações de cron. A primeira conta de administrador
(`REBASE_ADMIN_EMAIL`) é criada pela execução de provisionamento, não pelos processos que atendem
requisições. A [edição de schema em tempo real](/docs/backend/live-schema-editing) ainda pode
realizar commit de uma alteração no código-fonte, mas se recusa a aplicá-la ao banco de dados.

### A execução de provisionamento

O schema vem de uma execução controlada pelo seu processo de mudanças. Use a mesma imagem e
bundle do servidor, com `REBASE_PROVISION_ONLY=true`, conectado como uma role que
possa criar no banco de dados. `REBASE_PROVISION_SQL_OUT` salva todas as alterações de schema
feitas pela execução como um script SQL:

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

A imagem é executada com `NODE_ENV=production`, portanto esta execução é submetida às mesmas
verificações de ambiente do servidor, incluindo `CORS_ORIGINS` ou `FRONTEND_URL`,
mesmo que não atenda a nenhuma requisição.

O script é um registro, não um plano: cada instrução contida nele foi executada, em ordem, e
foi bem-sucedida. Gravado em um banco de dados vazio, ele representa todo o schema necessário para a versão.
Gravado em uma cópia restaurada de produção, ele é exatamente a atualização necessária.
Linhas gravadas durante a execução não estão nele. Revise-o e, em seguida, aplique-o ao banco de dados real:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Faça isso novamente a cada atualização do Rebase, antes da rotação dos processos de atendimento. Uma
nova versão pode adicionar uma tabela ou coluna, e um processo sem permissão para criá-la
informará sua ausência em vez de gerá-la.

Um servidor que você mesmo compilar segue a mesma regra: `initializeRebaseBackend` lê
`REBASE_PROVISION`, e `createRebaseBackend` aceita
[`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Armazenamento de arquivos

O armazenamento fica **desativado** a menos que um bucket seja configurado, e isso é deliberado: a
alternativa padrão seria o sistema de arquivos do contêiner, que perderia silenciosamente todos os
arquivos enviados na próxima reinicialização. Os uploads são recusados com
`501 STORAGE_NOT_CONFIGURED` até que você configure um.

Para um bucket, defina `STORAGE_TYPE=s3` (ou `gcs`) mais o seu bucket e credenciais —
o arquivo compose lista as variáveis comentadas. `gcs` carrega
`@google-cloud/storage`, pacote que não vem na imagem oficial; portanto, nessa imagem,
acesse o Google Cloud Storage por meio do endpoint compatível com S3
(`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, chaves HMAC).

Para disco local, o que só é apropriado quando o caminho for um volume real que
sobreviva ao ciclo de vida do contêiner:

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
descartado em vez de registrado, pois a alternativa seriam uploads bem-sucedidos
em um sistema de arquivos prestes a ser destruído. A variável é a forma de declarar que a montagem
é durável.

Monte o volume **acima** de `STORAGE_PATH`, não diretamente nele. `STORAGE_PATH` é o
diretório do bucket padrão, e cada bucket declarado em `backend/resources.ts`
recebe o seu próprio ao lado dele, `<STORAGE_PATH>__<key>`. Um volume montado no próprio `STORAGE_PATH`
conterá apenas o bucket padrão. Todos os outros buckets gravarão no
sistema de arquivos do contêiner e perderão seus arquivos quando o contêiner for recriado.
`STORAGE_PATH__MEDIA` pode mover um bucket para outro local no volume. Não é possível
movê-lo para dentro do diretório de outro bucket, como `/storage/uploads/media`,
pois o bucket padrão listaria, serviria e excluiria seus arquivos.

A imagem cria
`/storage` para o usuário sem privilégios `node` com o qual ela é executada, e é por isso que o volume
vai para lá. Um volume montado onde a imagem não possui um diretório pertencerá ao root,
e todo upload falhará com `EACCES`. O arquivo compose gerado pelo `rebase init`
o monta dessa maneira.

### O armazenamento precisa de um modelo de controle de acesso

<span class="since-badge" data-since="0.35">Desde 0.35</span>

Uma vez que um bucket **esteja** configurado, o runtime **se recusa a inicializar em produção**
até que a implantação defina como os objetos são protegidos. O armazenamento não está sob a
segurança em nível de linha (RLS) e suas chaves compartilham um namespace plano único; portanto, sem regras,
a única coisa que separa os arquivos de dois usuários é a imprevisibilidade da chave — algo que
`GET /storage/list?prefix=` quebra. Qualquer uma destas opções atende ao requisito:

- um **hook `storageAuthorize`** (ou `storagePolicies`) na configuração do seu projeto,
  que é o que o scaffold fornece em `backend/storage.ts`;
- **`STORAGE_POLICIES`**, as mesmas regras em formato JSON — "owner" para uma pasta por
  usuário, roles para administradores (consulte
  [Storage authorization](/docs/backend/storage-authorization/#as-data-storage_policies));
- **`STORAGE_PUBLIC_READ=true`**, para um bucket que seja genuinamente uma CDN pública
  somente leitura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para uma aplicação single-tenant onde
  qualquer conta autenticada tem permissão em todos os arquivos.

Fora de produção, a mesma condição emite um aviso enfático em vez de uma recusa,
portanto esta é uma falha de inicialização com a qual você se depara no deploy e não no ambiente local.
Isso é deliberado: a falha que ela substitui é silenciosa.

Defina `MFA_ENCRYPTION_KEY` também se você usa TOTP. Se não for definida, os segredos de autenticador
armazenados serão criptografados com `JWT_SECRET` — portanto, rotacioná-lo desconectará todos os usuários
*e* tornará todos os dispositivos cadastrados indecifráveis.

## Outras plataformas

O runtime é um contêiner comum que escuta em `$PORT`, portanto qualquer plataforma que execute
contêineres funciona. Duas coisas que você deve configurar corretamente em qualquer lugar:

1. O bundle deve estar presente em `/bundle` (ou onde quer que `REBASE_BUNDLE` aponte),
   com suas dependências instaladas ao lado dele — consulte [Dependências](#dependências).
2. Defina `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. O runtime se recusa a
   iniciar em produção sem eles em vez de tentar adivinhar.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.34.2 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Use o formato de imagem derivada acima para que o bundle vá junto com a aplicação e, em seguida,
execute `fly deploy`.

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

`NODE_ENV=production` não é mero detalhe. Se não for definido, o processo será executado em
modo de desenvolvimento: ele reflete origens de localhost, serve a especificação OpenAPI e
**deixa a janela do primeiro administrador aberta** — assim, o primeiro estranho que encontrar o
formulário de cadastro se tornará o administrador. As duas linhas `REBASE_ADMIN_*` são o que
substituem essa janela; consulte [Seu primeiro
administrador](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` está presente porque o banco de dados está na
mesma máquina. Em produção, o runtime recusa qualquer variável que aponte para
localhost — em um contêiner, o loopback é o próprio contêiner, portanto esse endereço é
sempre um erro — e essa linha informa que o endereço é intencional. Remova-a quando o
banco de dados for executado em outro local.

Prefira `EnvironmentFile=/etc/rebase.env` com o arquivo em modo 0600 em vez de
linhas `Environment=` para os segredos: um arquivo de unidade do systemd pode ser lido por qualquer usuário do sistema, e
`systemctl show` exibe todos os valores de `Environment=`.

## Pooling de conexões

O runtime mantém seu próprio pool pequeno e não necessita de um pooler. Para todo o resto que
se comunica com o mesmo banco de dados e não pode manter uma conexão aberta — funções serverless,
scripts agendados, um worker com escalonamento horizontal — o arquivo compose disponibiliza um serviço `pgbouncer`
sob o perfil `pooler`. Consulte [Pooling de conexões](/docs/deployment/connection-pooling/).

## Health checks

| Caminho | Utilização |
| --- | --- |
| `/livez` | Vivacidade (Liveness). Responde "este processo está vivo" sem tocar no banco de dados. |
| `/health` | Prontidão (Readiness). Realiza um ciclo de ida e volta ao banco de dados e reporta a latência. |

Aponte as sondas de vivacidade (liveness probes) para `/livez`. Uma sonda de vivacidade em `/health` reinicia um
processo perfeitamente saudável durante uma breve oscilação do banco de dados, o que é o oposto
do seu propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expõe métricas do Prometheus em `/metrics`: contagem de requisições e histogramas de latência
detalhados por área da API (data, auth, storage, functions) e por tabela, além de
medidores (gauges) do processo. Sem um token, o endpoint pode ser lido por qualquer pessoa que consiga alcançar
a porta, portanto configure um, a menos que esteja em uma rede privada.

`rebase_db_pool_wait_ms` é um histograma de quanto tempo cada consulta aguardou por uma
conexão do pool do banco de dados, incluindo a abertura de uma nova conexão, rotulado pela
chave da fonte de dados (`source="(default)"` em um projeto que não declara fontes de dados). Um
pool saudável mantém esse valor próximo de zero. Uma cauda que
cresce com o tráfego significa que as requisições estão enfileiradas aguardando conexões — na maioria das vezes
retidas por hooks de gravação que aguardam por operações lentas; consulte
[Um hook retém uma conexão](/docs/collections/context-data-api/#a-hook-holds-a-connection).

O banco de dados em si, por fonte de dados:

| Métrica | O que indica |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | As conexões de cada pool, rotuladas como `pool="primary"`, `"read"` (a réplica) ou `"session"` (o pool direto do console SQL atrás de um pooler). `waiting` acima de zero por muito tempo indica um pool pequeno demais para a carga. |
| `rebase_db_connection_errors_total` | Requisições respondidas com 503 por falta de conexão, por `code`: `53300` / `53400` (o servidor está sem conexões), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Conexões de clientes no servidor, por `state`, em comparação com `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | O tamanho do banco de dados. |
| `rebase_db_replica_lag_seconds` | O quanto a `DATABASE_READ_URL` está atrasada em relação ao primário. |

Os quatro últimos são coletados a cada 30 segundos na própria conexão da instância, de
modo que uma coleta (scrape) nunca se transforma em uma consulta direta.

`rebase_realtime_*` relata os sockets e canais abertos de cada instância e os frames
que ela enviou para o barramento de canais ou conteve: consulte
[Vendo o que o barramento faz](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Cabeçalhos de segurança

Cada resposta inclui `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Strict-Transport-Security: max-age=15552000`
(180 dias). O cabeçalho HSTS omite `includeSubDomains`: isso instruiria os
navegadores a recusar HTTP simples em todos os subdomínios do seu domínio, inclusive naqueles
com os quais este servidor não tem nenhuma relação, e o navegador mantém essa regra pelo período indicado no
cabeçalho.
Defina `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` quando todos os subdomínios forem estritamente HTTPS.

`strict-origin-when-cross-origin` é o próprio padrão dos navegadores: uma requisição para
outro site envia a sua origem e nunca o caminho ou a query da página. Não é utilizado
`no-referrer` porque as verificações de origem precisam da origem — o botão de login do Google
a compara com as origens JavaScript autorizadas do cliente OAuth e, sob
`no-referrer`, ele respondia "The given origin is not allowed for the given client
ID" em qualquer aplicação, independentemente do que o cliente autorizasse. Uma resposta que defina sua própria
política a mantém (a página de consentimento do MCP envia `no-referrer`); uma página que deseje uma regra mais
restrita pode especificá-la com `<meta name="referrer" content="no-referrer">`.
`X-Frame-Options` funciona da mesma forma: `SAMEORIGIN` a menos que a resposta defina a
sua própria, como a página de consentimento do MCP faz com `DENY`.

As aplicações estáticas — a administração do CMS e qualquer frontend servido pelo bundle — também incluem
`Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri
'self'`. Ela define quem pode renderizar a aplicação em um frame, bloqueia plugins e fixa `<base>`
na sua origem, sem restringir nada além disso, permitindo que scripts inline, workers e
login de terceiros continuem funcionando. Uma resposta que defina sua própria política a mantém.
Para qualquer regra mais restrita, configure a política no proxy reverso à frente.

### Permitindo que outra origem renderize uma aplicação em frame

`frame-ancestors 'self'` significa que apenas uma página na própria origem da aplicação pode colocá-la
em um iframe. Um CMS em `admin.example.com` que visualiza previamente o site em
`www.example.com` precisa que o site permita isso, configurando `frameAncestors` na
aplicação do site em `rebase.json`:

```jsonc
"site": {
  "type": "static", "root": "site", "output": "site/dist", "path": "https://www.example.com",
  "frameAncestors": ["https://admin.example.com"]
}
```

O site é então servido com `frame-ancestors 'self' https://admin.example.com`,
assim como qualquer [rota](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app)
do site cuja função não envie uma política própria. As outras aplicações mantêm
`'self'`. `X-Frame-Options: SAMEORIGIN` ainda é enviado junto; navegadores compatíveis com
`frame-ancestors` ignoram o `X-Frame-Options`, conforme exigido pela especificação do CSP.

Cada entrada é uma única origem, escrita com precisão: `https://` com um hostname e uma
porta opcional, ou `http://` para `localhost`, `127.0.0.1` e `[::1]` durante o
desenvolvimento. Não há suporte a caracteres curinga, caminhos ou palavras-chave — `'self'` está sempre na
lista, e qualquer outra coisa é recusada pela CLI e novamente pelo runtime
antes de chegar ao cabeçalho. Nada é permitido a menos que você especifique.

## Mais de uma instância

Um único contêiner é o padrão e não necessita de mais nada. Antes que uma segunda réplica
receba tráfego — ou que um rolling deploy execute duas lado a lado —, consulte
[Executando mais de uma instância](/docs/deployment/multiple-instances/): rate
limits, canais de broadcast, arquivos locais, uploads retomáveis e o cache de imagens
funcionam por processo até que uma configuração os compartilhe.

## Conectando o Claude

Um único comando adiciona este servidor ao [Rebase connector](/docs/ai/rebase-connector/),
o conector MCP unificado que acessa todos os seus projetos a partir do Claude:

```bash
rebase cloud connect https://your-app.com
```

Defina as duas variáveis exibidas neste servidor e reinicie-o. O servidor deve
rodar o Rebase 0.28.1 ou posterior e responder via HTTPS em um endereço público. Nada
mais muda: ele não armazena segredos e concede ao conector as mesmas permissões que o Studio concederia.

## Executando funções em seu próprio processo

Tudo acima consiste em um único contêiner atendendo todo o projeto, o que é o formato
ideal para quase todas as implantações. Quando uma função personalizada precisar parar de competir
com a API de dados pelo event loop — ou precisar escalar, reiniciar e falhar de forma
independente —, a mesma imagem e o mesmo bundle podem ser inicializados como vários
processos cooperativos. Consulte [Processos divididos](/docs/deployment/split-processes/).

## Atualização

```yaml
image: rebasepro/server:0.34.2
```

Reinicie. Seu bundle permanece inalterado. Dentro de uma mesma versão major do contrato de runtime, um bundle que
foi validado continuará funcionando — consulte
[Compatibilidade](/docs/architecture/runtime-and-bundles/#compatibility).
