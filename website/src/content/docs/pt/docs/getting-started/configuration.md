---
sourceHash: 6598745a12831632
title: Ambiente e Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita por meio de variáveis de ambiente no seu arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida as variáveis de ambiente com o **Zod** durante a inicialização. Se
> qualquer item obrigatório estiver ausente ou malformatado (uma URL que não é uma URL, uma porta que
> não é um número), o servidor recusa a inicialização e informa o nome da variável.
>
> O local onde o esquema reside depende de como você executa o backend. Um projeto inicializado pelo
> runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o
> esquema que o runtime possui (`loadBootEnv` em `@rebasepro/server`), que é a
> união de todas as tabelas abaixo. Um projeto que executou [`rebase eject`](/docs/cli)
> possui um `backend/src/env.ts` chamando `loadEnv({ extend })`, e pode adicionar suas próprias
> variáveis tipadas lá.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-------------|---------|
| `DATABASE_URL` | String de conexão do PostgreSQL. **Opcional em desenvolvimento** — se não definida, o `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Obrigatória em todos os outros ambientes. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinar tokens JWT. Use uma string aleatória forte (mínimo de 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` é uma sintaxe do node-postgres, não do libpq.**
>
> O Rebase e o driver do Node a aceitam — criptografar, mas não verificar o
> certificado. O `psql`, `pg_dump`, `pg_restore` e Atlas não a aceitam e não fazem
> fallback gracioso: eles recusam a inicialização com `invalid sslmode value: "no-verify"`.
>
> Os comandos próprios do Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) reescrevem isso para o equivalente `sslmode=require` antes de executar os comandos shell,
> funcionando assim com a URL conforme configurada. Usar o `psql` manualmente não funciona
> dessa forma — substitua por `sslmode=require` lá, que criptografa sem verificar exatamente
> da mesma maneira.

### Frontend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `VITE_API_URL` | URL da API do backend para o SDK tipado. **Defina apenas em desenvolvimento** — veja abaixo. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Client ID do Google OAuth. Habilita o "Entrar com o Google". | — |


> **Deixe `VITE_API_URL` indefinida em builds de produção.**
>
> Em desenvolvimento, o frontend e o backend são origens separadas, portanto o servidor de
> desenvolvimento injeta isso. Em produção, o backend do Rebase serve a SPA, de modo que a
> API é a própria origem da página e o cliente a resolve dessa forma por conta própria.
>
> Fixar uma URL absoluta em um bundle de produção funciona até o momento em que um segundo
> hostname aponta para a mesma aplicação: um domínio personalizado então carrega a página de
> `example.com` e chama a API em `example.rebase.website`, o que é
> cross-origin, fazendo com que todas as requisições falhem no preflight. Permitir a origem no CORS
> **não** resolve o problema — o cookie de atualização é `SameSite=Lax` e não é
> enviado cross-site, portanto você eliminaria os erros do console mas continuaria com a
> autenticação quebrada. Quando não definida, qualquer domínio que aponte para a aplicação funciona sem nenhuma
> configuração de CORS.

### Backend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `PORT` | Porta para o servidor HTTP do backend. Lida pelo `rebase start`. O `rebase dev` lê **apenas do ambiente do shell** — um `PORT` no `.env` não é lido lá, pois a porta é resolvida antes do carregamento desse arquivo — e, caso contrário, vincula uma porta derivada do caminho do projeto, permitindo que vários projetos rodem ao mesmo tempo. `rebase dev --port` tem precedência sobre ambos, e o banner inicial informa a porta utilizada. | `3001` |
| `LOG_LEVEL` | Verbosidade dos logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Exibe o SQL por trás de uma linha `Failed query: [redacted]`. Cada instrução que falha é ocultada por padrão, pois uma query que falhou carrega seus parâmetros vinculados — um e-mail, um hash de senha. Defina como `true` durante o diagnóstico de falhas de DDL, RLS ou change-capture. Ignorado quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Lista separada por vírgulas de origens permitidas. **Obrigatória em produção** se diferente do domínio do backend. Em desenvolvimento, ela é *adicionada ao* localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL da aplicação frontend. Usada como alternativa ao CORS_ORIGINS em ambos os ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão do banco de dados em nível de administrador (usada para introspecção de esquema e operações administrativas). O banco de dados informado não é aquele que o console SQL considera atual, nem o que uma nova branch copia por padrão: ambos são o banco de dados em que a própria conexão do app está (veja `REBASE_BRANCH_PARENT_DATABASE` para um servidor em uma branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a alternância de roles do PostgreSQL no SQL Editor (útil para autenticação personalizada onde as roles do BD não estão mapeadas). O console SQL do Studio indicará então que as linhas foram lidas como o proprietário da conexão, nomeará o mesmo e desativará o seletor de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | O banco de dados a partir do qual a branch em que este servidor roda foi copiada. O `rebase dev` a define em um checkout [alternado para uma branch](/docs/backend/branching/#cli-integration). Um servidor com ela mantém o registro de branches naquele banco de dados e copia novas branches a partir dele por padrão, permitindo que o painel Branches do Studio exiba as branches do banco de dados principal. | — |

#### CORS em desenvolvimento

O ambiente de desenvolvimento permite **localhost, além do que for especificado em `CORS_ORIGINS` (ou `FRONTEND_URL`)**
— a mesma lista que a produção usa, porém com o localhost adicionado em vez de
substituído. Assim, a variável funciona da mesma maneira em ambos os ambientes, e os
casos que precisam dela em desenvolvimento são os comuns:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não seja localhost nem esteja listada é recusada, e a recusa é
registrada nos logs **uma vez por origem** com a linha exata necessária para permiti-la. A recusa
não é mera cautela por si só: a API envia credenciais, portanto refletir um
`Origin` arbitrário permitiria que qualquer site que o desenvolvedor visitasse fizesse
requisições autenticadas contra o servidor de desenvolvimento com a sua sessão e lesse as
respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `JWT_SECRET` | Chave secreta para assinatura JWT (obrigatória em produção, gerada automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso assimetricamente (RS256), de modo que qualquer entidade que possua o JWKS possa verificar uma sessão sem conseguir gerar uma. Aceita uma chave PEM com quebras de linha reais, com escapes `\n` ou em base64 da chave PEM completa. Sem ela, os tokens permanecem em HS256. | — |
| `JWT_KEY_ID` | Identifica a `JWT_PRIVATE_KEY` no cabeçalho do token e no JWKS. Altere sempre que a chave for modificada — o processo de rotação depende de o valor antigo e o novo serem distinguíveis. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de vida do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de vida do token de atualização (refresh token). Janela deslizante — cada rotação o renova, de modo que isso define quanto tempo uma sessão sobrevive à **inatividade**. Defina como `400d` para sessões que sobrevivem a uma longa ausência; os navegadores limitam o cookie de atualização nesse período. | `30d` |
| `ALLOW_REGISTRATION` | Permitir o registro de novos usuários (`true`/`false`). Fora de produção, o **primeiro** usuário sempre pode se registrar, não importa o valor aqui — uma tabela de usuários vazia precisa admitir alguém, e essa pessoa se torna o administrador. Em produção (`NODE_ENV=production`), essa brecha é fechada: uma tabela vazia recusa o registro inicial com `SETUP_REQUIRED`, uma primeira conta criada por meio de registro aberto é uma conta comum, e o administrador é definido por meio de `REBASE_ADMIN_EMAIL` abaixo ou atribuído via service key. O arquivo `.env.example` do scaffold o define como `true`; o padrão do framework é desativado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interruptor geral de emergência. Fecha a janela de inicialização do primeiro usuário que `ALLOW_REGISTRATION=false` deliberadamente mantém aberta fora de produção, de modo que o registro permanece fechado mesmo contra um banco de dados vazio. Combine com `REBASE_ADMIN_EMAIL` abaixo, ou a implantação não terá como gerar seu primeiro usuário autenticado. Todos os artefatos de implantação distribuídos o definem. | — |
| `REBASE_ADMIN_EMAIL` | E-mail da primeira conta de administrador, criada na inicialização **enquanto a tabela de usuários ainda estiver vazia** e nunca depois. É assim que uma implantação de produção obtém seu administrador: o operador define a primeira conta em vez de competir com a internet por ela. A inicialização avisa com um warning quando a tabela estiver vazia em produção e este campo não estiver definido. | — |
| `REBASE_ADMIN_PASSWORD` | Senha para essa conta. Deve ter pelo menos 12 caracteres, caso contrário é recusada e a conta não é criada. Altere após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Criptografa todos os segredos TOTP armazenados. Se não definida, os segredos são criptografados com `JWT_SECRET` e a inicialização exibe um warning — logo, rotacionar o `JWT_SECRET` desconectaria todos *e* deixaria todos os autenticadores configurados indecifráveis. Defina uma chave dedicada (32+ caracteres aleatórios) antes que alguém configure o MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave anterior que está sendo *substituída*. Defina ambas durante uma rotação: novos segredos são gravados com `MFA_ENCRYPTION_KEY` e os existentes continuam legíveis, de modo que ninguém seja bloqueado da própria conta durante a transição. Remova-a assim que todos os segredos tiverem sido recriptografados. | — |
| `ALLOW_ANONYMOUS` | Habilita login anônimo (`POST /api/auth/anonymous`). Ativação opcional, e deliberadamente não condicionada a `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina como `false` para uma interface de leitura totalmente pública — as regras de RLS ainda se aplicam. | `true` |
| `AUTH_DEFAULT_ROLE` | Role atribuída a um usuário recém-registrado quando nenhuma for informada. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Habilita `POST /api/auth/find-user`, que resolve um e-mail para um perfil público mínimo (`uid`, `displayName`, `photoURL`) para fluxos de convite por e-mail. Apenas chamadores autenticados, e nunca retorna o e-mail, roles ou metadados do usuário encontrado. Desativado por padrão: trata-se de uma superfície de enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` no cookie de atualização: `Strict`, `Lax` ou `None`. `None` exige HTTPS e serve apenas para frontends genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Flag `Secure` no cookie de atualização. Ativada por padrão; `AUTH_COOKIE_SECURE=false` para HTTP comum — uma implantação em endereço de LAN onde o navegador descartaria o cookie e a sessão morreria na expiração do token de acesso sem aviso de erro. Exibe um warning na inicialização. `http://localhost` não precisa disso. | `true` |
| `GOOGLE_CLIENT_ID` | Client ID do Google OAuth (validação no backend) | — |
| `GOOGLE_CLIENT_SECRET` | Client Secret do Google OAuth | — |
| `GITHUB_CLIENT_ID` | Client ID do GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Client Secret do GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | Client ID da Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Client Secret da Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | Client ID do LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Client Secret do LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | Client ID do Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Client Secret do Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | Client ID do X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Client Secret do X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | Client ID do Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Client Secret do Discord OAuth | — |
| `GITLAB_CLIENT_ID` | Client ID do GitLab OAuth. O `baseUrl` de uma instância self-hosted não possui variável de ambiente — configure o GitLab no bloco `auth` para isso. | — |
| `GITLAB_CLIENT_SECRET` | Client Secret do GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID do Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client Secret do Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID do Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client Secret do Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID do Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client Secret do Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Apple Services ID. A Apple não possui client secret estático — o Rebase assina um JWT ES256 de curta duração por troca de token —, portanto necessita de todos os quatro valores `APPLE_*`, não configurando nada sem eles. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, o emissor do JWT. | — |
| `APPLE_KEY_ID` | Key ID da chave privada registrada na Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, incluindo quebras de linha (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave estática da API de administração. Ignora a autenticação normal via JWT para chamadas server-to-server quando passada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | A chave pública da plataforma de hospedagem (PEM, EC P-256) contra a qual os tokens de plataforma `rpt_` são verificados; múltiplos blocos PEM durante rotação de chave. A plataforma a define no deploy, e ela não contém dados secretos. Junto com `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que a interface de administração aceite um token de plataforma para `cron:read`, e para nada mais. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | O ID de projeto ao qual a claim `aud` de um token de plataforma deve ser igual, de modo que um token gerado para outro projeto seja recusado. Com apenas uma das duas variáveis definidas, o servidor inicializa, registra um warning nos logs e responde a qualquer token `rpt_` com `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Onde os contadores de rate-limit de autenticação residem: `memory` (por processo) ou `sql` (compartilhado entre réplicas). Um processo não enxerga sua própria contagem de réplicas, então uma implantação com pares precisa declarar isso — três réplicas com o padrão aplicam três vezes o limite. Qualquer outro valor **recusa a inicialização** em vez de fazer fallback, incluindo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Habilita o fluxo de link de login sem senha (magic link). Exige um serviço de e-mail configurado, caso contrário o link não terá para onde ser enviado. | `false` |
| `AUTH_EMAIL_OTP` | Habilita login sem senha com código de seis dígitos enviado por e-mail. Mesma exigência de serviço de e-mail descrita acima. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Cadastro sem senha: uma requisição de magic-link ou código por e-mail para um endereço desconhecido cria a conta, desde que o registro esteja aberto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamento quando um token de atualização é reutilizado após sua janela de tolerância: `reject` (recusa-o, mantendo a sessão) ou `revoke-session` (encerra a sessão). Qualquer outro valor falha a inicialização. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro com confirmação prévia: nenhum login com senha é permitido até que o endereço seja verificado. Requer e-mail; a inicialização é recusada sem ele. | `false` |
| `CAPTCHA_PROVIDER` | Habilita verificação por captcha nas rotas de autenticação: `turnstile` ou `hcaptcha`. Não definido significa sem captcha. | — |
| `CAPTCHA_SECRET` | O segredo do provedor, usado no servidor para verificar o token que o navegador envia. Obrigatório quando `CAPTCHA_PROVIDER` estiver definido. | — |
| `CAPTCHA_ROUTES` | Rotas de autenticação separadas por vírgula para proteger (por exemplo `register,login`). Não definido protege o conjunto padrão do provedor. | — |

### Armazenamento (Storage)

:::caution[O Storage não possui segurança em nível de linha (RLS), portanto necessita de um modelo de acesso]
As coleções são protegidas pelo RLS do Postgres. O armazenamento de objetos não possui equivalente —
as chaves compartilham um namespace único e plano —, portanto, com um bucket configurado e nenhum modelo de acesso,
o servidor **recusa a inicialização em produção**. Atenda a essa exigência com exatamente uma das seguintes opções:
um hook `storageAuthorize` exportado de `config/index.ts` (o padrão distribuído
pelo scaffold), `STORAGE_PUBLIC_READ` ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de armazenamento: `local`, `s3` ou `gcs`. Em produção, `local` desativa o armazenamento, a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para o armazenamento local. Um caminho relativo é lido a partir do diretório em que o servidor roda: a raiz do projeto com `rebase dev`, `backend/` em um servidor escrito por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite armazenamento local em produção — apenas com um volume persistente contendo o `STORAGE_PATH` e os diretórios `<STORAGE_PATH>__<key>` dos buckets locais nomeados ao lado | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante os quais a URL de download de um arquivo privado funciona — o token que `getSignedUrl()` insere nela. No máximo `604800` (uma semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Maior tamanho de arquivo que a fonte aceita, em bytes, em todas as rotas de upload — `__<KEY>` para uma fonte nomeada. Um valor que não seja um número inteiro de bytes recusa a inicialização | `52428800` (50 MB) |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região da AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso da AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta da AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forçar URLs estilo path-style para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto GCP. Geralmente inferido a partir das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para o arquivo de chave da conta de serviço. Omita no GCP, onde o Workload Identity fornece as credenciais. | — |
| `STORAGE_PUBLIC_READ` | Disponibiliza todos os objetos publicamente para qualquer um, sem token. Apenas para um bucket que seja genuinamente uma CDN pública. Uma das três formas de satisfazer a proteção de inicialização abaixo. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que qualquer chamador autenticado leia, grave, liste e exclua todos os objetos. Nomeado como `INSECURE` no objeto de configuração por um motivo: só é justificável em uma aplicação single-tenant onde todas as contas têm permissão total para acessar qualquer arquivo. | `false` |
| `STORAGE_RENDITION_CACHE` | Armazena em cache rendições de imagem geradas (redimensionamentos, conversões de formato) em vez de processá-las a cada requisição. | `false` |

### E-mail (Opcional)

| Variável | Descrição |
|----------|-------------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Habilitar conexão segura (`true`/`false`) |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `SMTP_FROM` | Endereço do remetente para e-mails do sistema |
| `SMTP_NAME` | Nome de exibição no endereço do remetente |
| `APP_NAME` | Nome do produto usado no assunto e corpo dos e-mails (padrão: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo exibido no topo dos modelos de e-mail padrão. PNG ou JPG com URL absoluta `http(s)` — clientes de e-mail removem SVG e bloqueiam URIs `data:`. Não definido, um app ainda nomeado como `Rebase` recebe a marca do Rebase e um app renomeado não recebe nenhuma |

### Pool de conexões do banco de dados

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `DB_POOL_MAX` | Número máximo de conexões no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milissegundos em que uma conexão ociosa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milissegundos para aguardar por uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (sem pooler). O recurso de [Realtime](/docs/backend/realtime) requer uma: `LISTEN`/`NOTIFY` não sobrevive a um transaction pooler como o PgBouncer, e sem ela as notificações de alteração são desativadas com um warning em vez de serem perdidas silenciosamente. O [job worker](/docs/backend/jobs) também mantém seu `LISTEN` de ativação nela. <span class="since-badge" data-since="0.25">A partir da 0.25</span> Preenche o `directConnectionString` do adaptador Postgres quando não estiver definido. | — |
| `DATABASE_READ_URL` | Réplica de leitura. Leituras são direcionadas para lá quando definida e diferente de `DATABASE_URL`; se a conexão falhar, tudo volta para a primária com um warning. <span class="since-badge" data-since="0.25">A partir da 0.25</span> Preenche o `readConnectionString` do adaptador Postgres quando não estiver definido; na versão 0.24 essa opção é ignorada. | — |
| `REBASE_DB_POOL_MAX` | Um teto para todos os pools no processo, aplicado independentemente do valor solicitado por cada um. Apenas dígitos puros: um valor malformatado é ignorado em vez de serializar silenciosamente as operações do servidor. | — |

### Comportamento em tempo de execução (Runtime)

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem de servidor
publicada. Um projeto que executou o eject gerencia essas decisões em seu próprio código.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` executa a [auditoria agendada de row-level-security](/docs/rls-check#running-it-on-a-schedule), que reporta tabelas servidas sem policies. O projeto deve declarar `@rebasepro/rls-check` entre suas dependências: o runtime não inclui uma cópia integrada e, sem o pacote, a inicialização é recusada, informando o erro. `false` mantém a varredura desativada neste processo. | — |
| `REBASE_BASE_PATH` | Caminho base para todas as rotas da API. O cliente deve ser configurado com o mesmo valor — veja [Alterando `basePath`](#alterando-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve os assets estáticos/admin do bundle a partir deste processo. Desative quando houver uma CDN à frente. | `true` |
| `REBASE_HISTORY` | Registra o [histórico de alterações de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respostas comprimidas com gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Tamanho máximo do corpo da requisição, **em bytes** (`10485760`, não `10MB` — um valor que não seja número recusa a inicialização em vez de remover silenciosamente o limite). | — |
| `REBASE_ENABLE_SWAGGER` | A interface OpenAPI. Três estados: não definido significa ativado em desenvolvimento, desativado em produção; `false` desativa ambos em qualquer ambiente. Note que `true` em produção serve a **especificação** em `/api/docs`, mas não a **UI** do Swagger em `/api/swagger` — a UI é controlada separadamente pelo `NODE_ENV`. | — |
| `REBASE_METRICS` | Expõe métricas do Prometheus em `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Adiciona `includeSubDomains` ao cabeçalho `Strict-Transport-Security`, fazendo com que os navegadores recusem HTTP simples em todos os subdomínios do host por seis meses — incluindo hosts não atendidos por este processo. Ative apenas quando todos os subdomínios do domínio forem exclusivamente HTTPS. Qualquer valor diferente de `true`/`false` recusa a inicialização. Veja [Security headers](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token que protege `/metrics`. Não definido deixa o endpoint acessível a qualquer um que alcance a porta — adequado em uma rede privada, mas não em uma pública, e os logs de inicialização alertam sobre isso. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer com o esquema na inicialização. `ensure` (o padrão em todos os ambientes — produção inclusa) executa a passagem **aditiva**: cria tabelas, colunas e tipos enum ausentes, nunca descartando ou reescrevendo nenhum. `none` não altera nada. A imagem publicada aceita apenas essas duas opções e **recusa a inicialização com `push`**. Em um [split deployment](/docs/deployment/split-processes), exatamente um processo pode provisionar, logo todas as outras instâncias devem definir `none` ou a inicialização falhará. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa a inicialização quando o banco de dados foi provisionado pela última vez a partir de um conjunto de coleções diferente do qual este processo foi construído. Não definido (ou qualquer valor diferente de `true`/`1`) exibe apenas um warning. | warn |
| `REALTIME_CDC` | Captura de alterações em nível de banco de dados: `auto` (habilita onde a conexão suportar, recua silenciosamente caso contrário), `trigger` (força o uso, emite warning se impossível), `wal` (degrada para `trigger` atualmente), `off`. Veja [Realtime](/docs/backend/realtime-cdc/). <span class="since-badge" data-since="0.25">A partir da 0.25</span> Tem precedência sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instâncias para canais de broadcast e presence: `memory` ou `postgres`. Ignorado quando `realtime.bus` receber um transporte instanciado explicitamente. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quantas inscrições um socket realtime pode manter; a próxima é recusada com `TOO_MANY_SUBSCRIPTIONS`. Deve ser um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSubscriptionsPerSocket`. Veja [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | <span class="since-badge" data-since="0.25">A partir da 0.25</span> Quantos sockets realtime um único usuário pode manter abertos em uma instância do servidor. A tentativa seguinte de autenticação é recusada com `TOO_MANY_SOCKETS` e o socket é fechado (4002); o SDK continua tentando, conectando-se assim que outro for fechado. Deve ser um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSocketsPerUser`. | Sem limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | <span class="since-badge" data-since="0.25">A partir da 0.25</span> O tempo máximo que uma alteração aguarda pela busca de dados (refetch) que a entrega aos assinantes ao vivo, em ms. Um refetch aguarda por 300 ms sem novas alterações, e no máximo este tempo sob um fluxo constante de escritas. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | <span class="since-badge" data-since="0.25">A partir da 0.25</span> Por quanto tempo o total de uma inscrição de lista grande pode ser reutilizado antes de ser recalculado, em ms; frames que o reutilizam carregam `meta.totalAsOf`. Não definido, cada frame realiza a contagem. Tem precedência sobre `realtime.recountIntervalMs`. | Não definido |
| `REALTIME_RECOUNT_MIN_ROWS` | <span class="since-badge" data-since="0.25">A partir da 0.25</span> O menor total anterior ao qual `REALTIME_RECOUNT_INTERVAL_MS` se aplica; listas menores são contadas em cada frame. Tem precedência sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback sob `NODE_ENV=production`. Desativado por padrão, para que uma inicialização em produção falhe expressamente em vez de conectar a um banco de dados inexistente. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | O que a inicialização faz com uma chave nas suas coleções que esta versão não reconhece: `warn`, `error` (recusa a inicialização — recomendado ativar em CI) ou `off`. Aplica-se apenas a chaves que o sistema não *reconhece*, que geralmente são erros de digitação e, ocasionalmente, metadados propositais; uma chave que o sistema sabe que mudou de lugar é sempre um erro fatal, caso contrário o recurso configurado ficaria ausente silenciosamente. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` executa a etapa de validação/criação do esquema e encerra sem abrir uma porta de rede — o comportamento esperado por um Job de migração, a partir da mesma imagem e do mesmo bundle que o servidor subsequente. Um valor vazio é considerado *não definido*, garantindo que uma variável `${SOMETHING}` não substituída em um compose file não transforme uma implantação comum em uma que apenas migra e se recusa a responder requisições. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que uma máquina — um agente, um job de CI — *aplique* alterações de esquema via `/api/admin/schema`, em vez de apenas planejá-las. Desativado por padrão: a credencial necessária para tal operação é a que tem maior probabilidade de estar configurada em uma variável de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo máximo que uma função personalizada pode executar antes que sua requisição seja abortada. Mesma funcionalidade que a opção `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz com que uma rejeição de promise não tratada encerre o processo em vez de apenas registrar um log. Recomendado ativar sob um orquestrador que reinicie o container; desative quando reiniciar for pior do que lidar com um leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantém o agendador de tarefas cron ativo em uma plataforma que o runtime identificaria como scale-to-zero, onde um timer acionado em uma instância ociosa não executaria em nenhuma instância. | — |
| `TRUSTED_PROXY_HOPS` | Quantidade de proxies à frente deste servidor, permitindo que o rate limiter identifique o endereço IP real do cliente via `X-Forwarded-For`. Padrão seguro de contingência `0`: sem um proxy, confiar nesse cabeçalho permitiria a qualquer chamador forjar uma identidade. | `0` |

:::note[O provisionamento de inicialização é aditivo e não serve como ferramenta de migração]
A etapa de inicialização executa de forma autônoma sem supervisão humana sobre o diff, logo ela nunca removerá
uma coluna, restringirá um tipo ou reescreverá uma tabela. É por essa razão que a imagem recusa
`REBASE_MIGRATE_ON_BOOT=push`: um push completo calcula um diff e executaria `DROP COLUMN`
sem restrições, e a reinicialização de um container nunca deve ser capaz de destruir uma
coluna de produção como efeito colateral de um reagendamento de tarefas.

Alterações destrutivas ou que reestruturem dados devem permanecer onde possam ser revisadas: `rebase db
generate` + `rebase db migrate`, ou `rebase db push` a partir de um checkout local ou CI,
que simula a alteração, recusa ações destrutivas sem confirmação prévia e
pode realizar um backup antes da execução.
:::

### Implantações divididas (Split deployments)

Uma mesma imagem e um mesmo bundle podem ser inicializados diversas vezes, com cada instância
atendendo a uma parte distinta do projeto. Listamos uma linha para cada uma aqui, pois esta página
documenta todas as variáveis; detalhes sobre o que cada combinação *carrega e gerencia* — e quais
combinações impedem a inicialização — estão disponíveis em
**[Split Processes](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_ROLE` | Qual função este processo assume: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescreve se *este* processo deve executar os timers do cron. Não definido segue o padrão da role. | — |
| `REBASE_JOB_WORKERS` | Sobrescreve se este processo deve executar os workers de filas de jobs. Não definido segue o padrão da role. | — |
| `REBASE_FUNCTIONS_ONLY` | Atende apenas as funções customizadas nomeadas neste processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Atende todas as funções customizadas, exceto as nomeadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Destino para onde o processo de API encaminha requisições de funções que ele mesmo não atende. | — |

### Interface MCP (MCP surface)

Um endpoint opcional do Model Context Protocol em `/mcp`, permitindo que um cliente de IA leia
e grave neste projeto **representando o usuário autenticado**. Desativado por padrão e — ao contrário
de outras interfaces — nenhum `REBASE_ROLE` o ativa automaticamente: os demais definem
o formato do processo, enquanto este representa uma autorização para conceder credenciais a
softwares de terceiros, devendo ser uma decisão expressa tomada por uma pessoa em vez de
herdada da função de um container.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Habilita a interface MCP. Exige `REBASE_PUBLIC_URL`; sem ela, o endpoint não é montado e exibe o motivo no log de inicialização. | `false` |
| `REBASE_PUBLIC_URL` | A origem externamente acessível desta implantação, ex.: `https://app.example.com`. A interface MCP não tem como deduzir esse valor — extrair a origem do cabeçalho `Host` tornaria a identidade do emissor, e a audiência contra a qual os tokens são validados, um valor fornecido pelo chamador. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite o registro dinâmico de clientes OAuth (RFC 7591), permitindo que um cliente se registre de forma autônoma. Defina como `false` para exigir que os clientes sejam registrados previamente. | `true` |

### Edição de esquemas em tempo real a partir de um bundle

Desativado a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esteja definido. Um bundle compilado não tem
código-fonte de coleções para editar; portanto, com essas variáveis definidas, o editor de coleções
do painel administrativo lê o código do repositório, faz o commit de cada alteração de volta e executa o DDL
neste banco de dados. Exclusivo para administradores e aplicado manualmente por uma pessoa, a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique o contrário. A definição de um repositório
sem credenciais válidas causa a recusa da inicialização. Veja
[Live schema editing](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Repositório do GitHub no qual os commits das alterações de esquema serão feitos, no formato `owner/name`. O preenchimento desta variável habilita o recurso. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | A branch na qual o commit será aplicado. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Caminho relativo dentro do repositório onde reside o código-fonte das coleções. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Token de acesso pessoal granular com permissões de leitura e escrita no conteúdo do repositório. Defina esta variável ou as três variáveis `_GITHUB_APP_*`, não ambas. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | O ID de um GitHub App, para realizar commits como o aplicativo em vez de usar um token de usuário. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | O ID da instalação do app no repositório. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Chave privada do app: PEM, PEM com novas linhas escapadas ou base64. | — |

### Backups

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Expressão cron para backups agendados. Não definido desativa os backups agendados. | — |
| `BACKUP_DESTINATION` | Caminho local ou uma URL no formato `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Remove backups com mais de N dias. Não definido ou `0` mantém todos os arquivos. | — |
| `BACKUP_KEEP_MINIMUM` | Sempre mantém no mínimo os N backups mais recentes, independentemente da retenção configurada. | — |
| `PG_DUMP_PATH` | Sobrescreve o binário do `pg_dump` — deve corresponder à versão principal do servidor ou ser mais recente. | — |
| `PG_RESTORE_PATH` | Sobrescreve o binário do `pg_restore`. | — |
| `PG_DUMPALL_PATH` | Caminho para o executável `pg_dumpall`, caso não esteja presente no `PATH`. Sem ele — e sem as ferramentas de cliente do PostgreSQL instaladas —, o backup de variáveis globais falha com um erro indicando esta variável. | — |

A imagem de runtime oficial (`rebasepro/server`) inclui as ferramentas de
cliente do PostgreSQL 18, permitindo a execução de backups agendados contra qualquer
servidor até a versão 18 do Postgres. Fora dessa imagem, instale-as manualmente
(`apt-get install postgresql-client-18`, `brew install libpq`).

Backups contêm credenciais e dados sensíveis (PII). Utilize um destino privado com
criptografia em repouso (encryption-at-rest).

### Entrega de bundles (Bundle delivery)

Uma implantação gerenciada não armazena seu código fixado dentro da imagem: o runtime faz o download
de um bundle durante a inicialização. Essas opções determinam qual pacote obter e como.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já descompactado. Configurado localmente pelo comando `rebase start`. | — |
| `REBASE_BUNDLE_URL` | Local para baixar o arquivo do bundle quando não houver uma versão local disponível. | — |
| `REBASE_BUNDLE_TOKEN` | Credencial de autenticação Bearer para o download. Trate-a como um segredo: é a chave que autoriza um locatário a baixar seu próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Diretório onde o bundle baixado é extraído. Deve ter permissão de escrita e persistir entre a etapa de download e a inicialização. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionais disponibilizados pela imagem de runtime para o bundle, além dos já declarados pelo próprio pacote. | — |

### Vínculos de recursos (Resource bindings)

Cada banco de dados, bucket e tópico declarado por um projeto em `config/resources.ts`
é mapeado por variáveis de ambiente nomeadas com base nele. Os prefixos básicos estão listados abaixo;
recursos não padrão recebem o sufixo `__` acompanhado de sua chave em letras maiúsculas — por exemplo, um bucket
chamado `media` utilizará `S3_BUCKET__MEDIA`. O comando `rebase status`
exibe, para cada recurso, o nome exato da variável avaliada e se ela está definida.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_DRIVER` | Pacote npm que implementa o driver de uma fonte de dados quando não for o Postgres padrão. Aplica o sufixo correspondente à fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | String de conexão para um tópico declarado. Aplica o sufixo específico de cada tópico. | — |

### Ambiente da própria CLI

Lido pelo `rebase`, não pelo servidor. Nenhuma dessas opções afeta uma implantação de produção.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_BASE_URL` | O backend com o qual `rebase auth` e `rebase api-keys` se comunicam, em vez de inferir o endereço a partir do projeto. | — |
| `REBASE_PORT` | Porta assumida por esses comandos ao resolver essa URL. | — |
| `SERVICE_KEY` | Chave de serviço usada para autenticação automática, evitando a solicitação interativa no terminal. | — |
| `REBASE_ENV_FILE_PATH` | Especifica qual arquivo `.env` a CLI deve ler e gravar, caso seja diferente do padrão do projeto. | — |
| `REBASE_CLOUD_URL` | O plano de controle com o qual `rebase cloud` se comunica. | — |
| `REBASE_CLOUD_EMAIL` | Conta utilizada para autenticação em `rebase cloud login`, evitando a solicitação interativa no terminal. | — |
| `REBASE_CLOUD_PASSWORD` | Senha da conta, permitindo que gerenciadores de credenciais a repassem sem registrá-la no histórico do shell. | — |
| `REBASE_TOKEN` | Token gerado via `rebase cloud tokens create`. Quando definido, todos os comandos `rebase cloud` autenticam usando este valor em vez da sessão local de `rebase cloud login`, sem ler nem alterar a sessão salva. É o método recomendado para executar `rebase cloud` em CI — veja [CI e agentes](/docs/deployment/cloud/#ci-and-agents). O [servidor MCP](/docs/ai/mcp/) aceita a mesma variável como um alias de `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` exibe o erro subjacente completo e os detalhes das requisições em vez da mensagem resumida. É a primeira variável a ser configurada quando um comando `rebase cloud` falhar sem detalhes suficientes. | — |
| `REBASE_ATLAS_DEV_URL` | <span class="since-badge" data-since="0.25">A partir da 0.25</span> O banco de dados vazio utilizado para planejamento por `rebase db push`, `db generate` e `db migrate`, em vez do banco `<db>_dev_diff` que costumam criar ao lado de `DATABASE_URL`. O Rebase não cria nem descarta bancos informados aqui, e recusa valores idênticos ao `DATABASE_URL`. No banco de desenvolvimento gerenciado, a CLI define essa variável usando uma instância PGlite temporária própria em memória. Defina caso a permissão `CREATE DATABASE` não esteja disponível. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` não inicializa nenhum banco de dados e não provisiona nada — você fornece sua própria infraestrutura. Equivalente ao parâmetro `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento do frontend, a qual o `rebase dev` caso contrário deduz a partir do caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo limite que o `rebase dev` aguarda pela resposta de inicialização do backend antes de reportar falha. `0` desativa essa verificação. | `30000` |
| `DATABASE_PASSWORD` | A senha que `rebase dev --docker` insere na string de conexão derivada do `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenção padrão comum entre diversas ferramentas. Se definida com qualquer valor diferente de `0`, a CLI desativa o envio de telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | Mesma finalidade da anterior, específica para o Rebase. Não depende de arquivos no disco, sendo a opção recomendada para ambientes de CI e containers. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Endpoint para onde os eventos de telemetria são enviados, permitindo o uso de coletores próprios (self-hosted). | — |

## Segredos em desenvolvimento

`JWT_SECRET` e `REBASE_SERVICE_KEY` são obrigatórios em produção e gerados
automaticamente fora dela, permitindo que você inicie o projeto sem configurações manuais prévias.

Esses valores gerados são salvos em cache em `.rebase-dev-secrets.json`, ao lado
de `.rebase-dev-port` e `.rebase-dev-url`, e são ignorados pelo Git junto com eles. Anteriormente,
eram gerados a cada nova inicialização — o que fazia com que reiniciar o servidor de desenvolvimento
desconectasse você da sua própria aplicação e invalidasse qualquer chave de API recém-criada.

- Defina qualquer uma das variáveis explicitamente e seu valor terá prioridade; nada será salvo em cache ou lido dele.
- Altere o local do cache configurando `REBASE_DEV_SECRETS_FILE` — que recebe um caminho de arquivo,
  sendo a única variável desta seção destinada a ser configurada intencionalmente.
- Exclua o arquivo para renovar ambos os segredos. A próxima inicialização gerará um arquivo novo.
- Se o arquivo não puder ser gravado — como em um container com sistema de arquivos somente leitura —,
  o servidor inicia mesmo assim usando um segredo temporário em memória, exatamente como fazia antes.

Nada é mantido em cache em produção ou durante a execução de testes automatizados. Em produção, qualquer inicialização
que dependa da geração automática de segredos falhará expressamente, indicando o nome da variável pendente:

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
```

## Objeto de Configuração do Backend

O objeto `RebaseBackendConfig` passado para `initializeRebaseBackend()` fornece controle programático:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    basePath: "/api",        // Base path for all API routes (default: "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Authentication config
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Require auth for data API (default: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    // No bucket configured in production means storage is off, not local:
    // uploads answer 501 rather than landing on a filesystem that is erased
    // on the next redeploy.
    storage: env.STORAGE_TYPE === "s3"
        ? {
            type: "s3",
            bucket: env.S3_BUCKET!,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            endpoint: env.S3_ENDPOINT
        }
        : env.STORAGE_TYPE === "gcs"
            ? {
                type: "gcs",
                bucket: env.GCS_BUCKET!,
                projectId: env.GCS_PROJECT_ID,
                keyFilename: env.GCS_KEY_FILENAME
            }
            : isProduction && !env.FORCE_LOCAL_STORAGE
                ? undefined
                : {
                    type: "local",
                    basePath: env.STORAGE_PATH || "./uploads"
                },

    history: true,           // Enable entity change history

    enableSwagger: true,     // Enable OpenAPI docs at /api/docs

    logging: {
        level: "info"
    }
});
```

<span class="since-badge" data-since="0.25">A partir da 0.25</span> As mesmas opções,
sem `app`, `server` e `basePath`, e contendo a propriedade obrigatória `provision`, constroem um
backend desacoplado que não serve requisições até ser montado: `createRebaseBackend`. Consulte
[Integração com Servidor Customizado](/docs/backend/custom-server/).

### Alterando `basePath`

`basePath` altera o prefixo de todas as rotas da API; logo, o cliente deve ser configurado com o mesmo valor —
caso contrário, ele continuará requisitando caminhos em `/api/...` e receberá status 404 em todas as chamadas:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel administrativo obtém essa configuração automaticamente a partir da instância do cliente fornecida; nenhuma outra etapa é necessária. Se você monta URLs de requisição manualmente, concatene-as a partir do cliente em vez de escrever `/api` fixo no código:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solução de Problemas

### Permissão Negada no SQL Editor (`permission denied for table <name>`)

* **Sintomas:** Consultas customizadas executadas no SQL Editor do Rebase Studio falham com `cause: error: permission denied for table <name>`, embora a visualização de planilha do CMS carregue os dados sem erros.
* **Causa:** Por padrão, o Rebase tenta executar consultas no SQL Editor alternando temporariamente a role do banco para corresponder à role da aplicação do usuário ativo (por exemplo, `SET LOCAL ROLE "admin"`). Caso você utilize autenticação customizada em que as roles residem apenas em tabelas da aplicação em vez de roles nativas do PostgreSQL, a troca de role falha ou os privilégios do banco estarão ausentes. A visualização de planilha do CMS opera sob o usuário padrão proprietário da conexão, ignorando essa validação.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` ao arquivo `.env` do backend. Isso força o Rebase a executar as consultas do SQL Editor utilizando as permissões do proprietário da conexão (geralmente superuser/owner). O SQL Editor exibirá então, acima dos resultados, que eles foram lidos como o proprietário da conexão, desativando o seletor de roles.

### Falha ao Carregar Esquema no SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio falha ao exibir a árvore de esquemas ou o SQL Editor retorna `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** O Rebase necessita de privilégios administrativos para inspecionar os catálogos de sistema do banco de dados e rodar comandos administrativos. Se `adminConnectionString` não for fornecida ao bootstrapper, ou se `getAdmin()` for sobrescrito para retornar `undefined`, essas operações falham.
* **Solução:** Certifique-se de configurar `adminConnectionString` durante a inicialização do bootstrapper do backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Próximos Passos

- **[Implantação](/docs/getting-started/deployment)** — Guia de implantação em produção
- **[Visão Geral do Backend](/docs/backend)** — Documentação completa de configuração do backend
