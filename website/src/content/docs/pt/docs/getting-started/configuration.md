---
sourceHash: f66784a0d8158afb
title: Ambiente e Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita por meio de variáveis de ambiente no seu arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida variáveis de ambiente com o **Zod** na inicialização. Se
> qualquer item obrigatório estiver faltando ou malformado (uma URL que não é uma URL, uma porta que
> não é um número), o servidor se recusa a inicializar e informa o nome da variável.
>
> O local onde o schema reside depende de como você executa o backend. Um projeto inicializado pelo
> runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o
> schema que pertence ao runtime (`loadBootEnv` em `@rebasepro/server`), que é a
> união de todas as tabelas abaixo. Um projeto que executou [`rebase eject`](/docs/cli)
> possui um `backend/src/env.ts` chamando `loadEnv({ extend })`, e pode adicionar suas próprias
> variáveis tipadas lá.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | String de conexão do PostgreSQL. **Opcional em desenvolvimento** — se não definida, o `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Obrigatória em todos os outros ambientes. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinar tokens JWT. Use uma string aleatória forte (mínimo de 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` é uma grafia do node-postgres, não do libpq.**
>
> O Rebase e o driver Node a aceitam — criptografar, mas não verificar o
> certificado. O `psql`, `pg_dump`, `pg_restore` e Atlas não a aceitam e não
> degradam graciosamente: eles se recusam a iniciar com `invalid sslmode value: "no-verify"`.
>
> Os comandos próprios do Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) reescrevem o valor para o equivalente `sslmode=require` antes de invocar o shell,
> funcionando assim com a URL configurada. Executar o `psql` manualmente não faz isso
> — substitua por `sslmode=require` nesses casos, o que criptografa sem verificar exatamente
> da mesma maneira.

### Frontend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `VITE_API_URL` | URL da API do backend para o SDK tipado. **Defina isso apenas em desenvolvimento** — veja abaixo. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Client ID do Google OAuth. Habilita o "Sign in with Google". | — |


> **Deixe `VITE_API_URL` indefinida em builds de produção.**
>
> Em desenvolvimento, o frontend e o backend são origens separadas, portanto o servidor
> de desenvolvimento injeta isso. Em produção, o backend do Rebase serve a SPA, de modo que a
> API é a própria origem da página e o cliente a resolve dessa forma por conta própria.
>
> Embutir uma URL absoluta em um bundle de produção funciona perfeitamente até que um segundo
> hostname aponte para a mesma aplicação: um domínio personalizado então carrega a página de
> `example.com` e chama a API em `example.rebase.website`, o que é cross-origin,
> fazendo com que todas as requisições falhem no preflight. Permitir a origem no CORS
> **não** resolve isso — o cookie de atualização (refresh cookie) é `SameSite=Lax` e não é
> enviado entre sites diferentes, de modo que você limparia os erros do console e ainda assim teria a
> autenticação quebrada. Quando não definida, qualquer domínio que aponte para a aplicação funciona sem nenhuma
> configuração de CORS.

### Backend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta para o servidor HTTP do backend. Lida pelo `rebase start`. O `rebase dev` a lê **apenas do ambiente do shell** — um `PORT` no `.env` não é lido lá, pois a porta é resolvida antes do carregamento desse arquivo — e, caso contrário, vincula uma porta derivada do caminho do projeto, para que vários projetos possam rodar ao mesmo tempo. O `rebase dev --port` tem precedência sobre ambos, e o banner de inicialização informa qual nível foi utilizado. | `3001` |
| `LOG_LEVEL` | Verbosidade do log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Exibe o SQL por trás de uma linha `Failed query: [redacted]`. Cada instrução que falha é ocultada por padrão, pois uma consulta com falha carrega seus parâmetros vinculados — um e-mail, um hash de senha. Defina como `true` ao diagnosticar uma falha de DDL, RLS ou change-capture. Ignorada quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Lista separada por vírgulas de origens permitidas. **Obrigatória em produção** se diferente do domínio do backend. Em desenvolvimento, ela é *adicionada ao* localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL da aplicação frontend. Usada como uma alternativa a CORS_ORIGINS, em ambos os ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão com o banco de dados com privilégios administrativos (usada para introspecção de schema e operações administrativas). O banco que ela nomeia não é aquele que o console SQL considera atual, nem o que uma nova branch copia por padrão: ambos são o banco de dados no qual a própria conexão da aplicação está (veja `REBASE_BRANCH_PARENT_DATABASE` para um servidor em uma branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a troca de papéis (roles) do PostgreSQL no Editor SQL (útil para autenticação personalizada onde os papéis do BD não são mapeados). O console SQL do Studio então informa que as linhas foram lidas como o proprietário da conexão, exibe seu nome e desabilita o seletor de papéis. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | O banco de dados a partir do qual a branch em que este servidor roda foi copiada. O `rebase dev` a define em um checkout [alternado para uma branch](/docs/backend/branching/#cli-integration). Um servidor com ela mantém o registro de branches naquele banco de dados e copia novas branches a partir dele por padrão, de modo que o painel Branches do Studio exibe as branches do banco de dados principal. | — |

#### CORS em desenvolvimento

O desenvolvimento permite **localhost, mais o que estiver especificado em `CORS_ORIGINS` (ou `FRONTEND_URL`)**
— a mesma lista que a produção utiliza, com o localhost adicionado em vez de
substituído. Assim, a variável funciona da mesma forma em ambos os ambientes, e os
casos que precisam dela em desenvolvimento são os comuns:

```bash
# Um celular na LAN, a máquina de um colega, um túnel ngrok,
# uma porta encaminhada do Codespaces — todas origens que não são localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não seja localhost nem esteja listada é recusada, e a recusa é
registrada em log **uma vez por origem** com a linha exata que a permitiria. A recusa
não é mera cautela: a API envia credenciais, portanto refletir um
`Origin` arbitrário permitiria que qualquer site visitado pelo desenvolvedor fizesse
requisições autenticadas contra o servidor de desenvolvimento com sua sessão e lesse as
respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `JWT_SECRET` | Segredo para assinatura de JWT (obrigatório em produção, gerado automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso assimetricamente (RS256), permitindo que qualquer serviço que possua o JWKS verifique uma sessão sem poder emitir uma. Aceita um PEM com quebras de linha reais, um PEM com escapes `\n`, ou base64 do PEM completo. Sem ela, os tokens permanecem como HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` no cabeçalho do token e no JWKS. Altere-o sempre que a chave for alterada — a rotação depende de que a chave antiga e a nova sejam distinguíveis. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de vida do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de vida do token de atualização (refresh token). Deslizante — cada rotação o renova, de modo que isso rege por quanto tempo uma sessão sobrevive à **inatividade**. Defina `400d` para sessões que devem sobreviver a uma longa ausência; os navegadores limitam o cookie de atualização a esse período. | `30d` |
| `ALLOW_REGISTRATION` | Permitir o registro de novos usuários (`true`/`false`). Fora de produção, o **primeiro** usuário sempre pode se registrar, independentemente desta configuração — uma tabela de usuários vazia precisa admitir alguém, e esse alguém se torna o administrador. Em produção (`NODE_ENV=production`), essa brecha é fechada: uma tabela vazia recusa o registro inicial com `SETUP_REQUIRED`, uma primeira conta criada por registro aberto é uma conta comum, e o administrador é definido com `REBASE_ADMIN_EMAIL` abaixo ou atribuído com a service key. O `.env.example` do scaffold o define como `true`; o padrão do framework é desativado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Botão de desligamento de emergência (kill switch). Fecha a janela de inicialização do primeiro usuário que `ALLOW_REGISTRATION=false` deliberadamente deixa aberta fora de produção, de modo que o registro fica fechado mesmo em um banco de dados vazio. Combine com `REBASE_ADMIN_EMAIL` abaixo, ou a implantação não terá como produzir seu primeiro chamador autenticado. Todos os artefatos de implantação distribuídos o definem. | — |
| `REBASE_ADMIN_EMAIL` | E-mail da primeira conta de administrador, criada na inicialização **enquanto a tabela de usuários ainda estiver vazia** e nunca depois disso. É assim que uma implantação de produção obtém seu administrador: o operador define a primeira conta em vez de disputar contra a internet por ela. A inicialização avisa quando a tabela estiver vazia em produção e isso não estiver configurado. | — |
| `REBASE_ADMIN_PASSWORD` | Senha para essa conta. Deve ter pelo menos 12 caracteres, caso contrário é recusada e a conta não é criada. Altere-a após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Criptografa todos os segredos TOTP armazenados. Se não configurada, os segredos são criptografados com `JWT_SECRET` e o boot emite um aviso — portanto, rotacionar o `JWT_SECRET` desconectará todo mundo *e* tornará todos os autenticadores cadastrados indecifráveis. Defina uma chave dedicada (32+ caracteres aleatórios) antes que qualquer pessoa se cadastre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave da qual se está fazendo a rotação *de saída*. Defina ambas durante uma rotação: novos segredos são gravados com `MFA_ENCRYPTION_KEY` e os existentes continuam legíveis, para que ninguém seja bloqueado de sua própria conta durante a transição. Remova-a assim que todos os segredos tiverem sido recriptografados. | — |
| `ALLOW_ANONYMOUS` | Habilita o login anônimo (`POST /api/auth/anonymous`). Opcional (opt-in) e deliberadamente não condicionado a `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina como `false` para uma superfície de leitura totalmente pública — o RLS ainda se aplica. | `true` |
| `AUTH_DEFAULT_ROLE` | Papel atribuído a um usuário recém-registrado quando nenhum for fornecido. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta a rota `POST /api/auth/find-user`, que resolve um e-mail para um perfil público mínimo (`uid`, `displayName`, `photoURL`) para fluxos de convite por e-mail. Apenas chamadores autenticados, e nunca retorna o e-mail, funções ou metadados do usuário encontrado. Desativado por padrão: é uma superfície de enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` no cookie de atualização: `Strict`, `Lax` ou `None`. `None` requer HTTPS e é apenas para um frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Atributo `Secure` no cookie de atualização. Seguro por padrão; use `AUTH_COOKIE_SECURE=false` para http puro — uma implantação em um endereço de LAN onde o navegador descartaria o cookie e a sessão morreria na expiração do token de acesso sem nenhum erro. Isso gera um aviso no boot. `http://localhost` não precisa disso. | `true` |
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
| `GITLAB_CLIENT_ID` | Client ID do GitLab OAuth. A `baseUrl` de uma instância self-hosted não tem formato via variável de ambiente — configure o GitLab no bloco `auth` para isso. | — |
| `GITLAB_CLIENT_SECRET` | Client Secret do GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID do Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client Secret do Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID do Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client Secret do Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID do Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client Secret do Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Apple Services ID. A Apple não tem um client secret estático — o Rebase assina um JWT ES256 de curta duração por troca de token — portanto, precisa de todos os quatro valores `APPLE_*` e não configura nada sem eles. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, o emissor do JWT. | — |
| `APPLE_KEY_ID` | Key ID da chave privada registrada na Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, incluindo quebras de linha (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave estática da API de administração. Ignora a autenticação JWT normal para chamadas server-to-server quando passada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | A chave pública da plataforma de hospedagem (PEM, EC P-256) contra a qual os tokens de plataforma `rpt_` são verificados; múltiplos blocos PEM durante uma rotação de chave. A plataforma a define no deploy e ela não contém nenhum segredo. Junto com `REBASE_PLATFORM_TOKEN_AUDIENCE`, ela permite que o gate de administração aceite um token de plataforma para `cron:read` e para nada mais. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | O ID do projeto com o qual o `aud` do token de plataforma deve ser igual, para que um token emitido para outro projeto seja recusado. Com apenas uma das duas variáveis definida, o servidor inicializa, registra um aviso e responde a cada token `rpt_` com `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Onde os contadores de limite de taxa (rate-limit) de autenticação residem: `memory` (por processo) ou `sql` (compartilhado entre réplicas). Um processo não pode ver sua própria contagem de réplicas, portanto uma implantação com instâncias paralelas deve indicar isso — três réplicas no padrão aplicam três vezes o limite. Qualquer outro valor **recusa a inicialização** em vez de aplicar fallback, incluindo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monta o fluxo de login por link sem senha (magic link). Necessita de um serviço de e-mail configurado, caso contrário o link não tem para onde ir. | `false` |
| `AUTH_EMAIL_OTP` | Monta o login sem senha com um código de seis dígitos enviado por e-mail. Mesma exigência de e-mail acima. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Cadastro sem senha: uma solicitação de magic link ou código por e-mail para um endereço desconhecido cria a conta, desde que o registro esteja aberto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | O que fazer quando um refresh token for reutilizado após sua janela de tolerância: `reject` (recusá-lo, manter a sessão) ou `revoke-session` (encerrar o login). Qualquer outro valor causa falha na inicialização. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro com confirmação prévia: nenhum login por senha até que o endereço seja verificado. Requer e-mail; o boot falha sem ele. | `false` |
| `CAPTCHA_PROVIDER` | Ativa a verificação de captcha nas rotas de autenticação: `turnstile` ou `hcaptcha`. Não definido significa sem captcha. | — |
| `CAPTCHA_SECRET` | O segredo do provedor, usado no lado do servidor para verificar o token enviado pelo navegador. Obrigatório uma vez que `CAPTCHA_PROVIDER` esteja definido. | — |
| `CAPTCHA_ROUTES` | Rotas de autenticação separadas por vírgula para proteger (por exemplo `register,login`). Não definido protege o conjunto padrão do provedor. | — |

### Armazenamento

:::caution[O armazenamento não possui segurança em nível de linha (RLS), portanto necessita de um modelo de acesso]
As coleções são protegidas pelo RLS do Postgres. O armazenamento de objetos não tem equivalente —
as chaves compartilham um namespace plano — portanto, com um bucket configurado e nenhum modelo de acesso,
o servidor **se recusa a inicializar em produção**. Satisfaça essa exigência com exatamente uma destas opções:
um hook `storageAuthorize` exportado de `config/index.ts` (o que o scaffold
já inclui), `STORAGE_PUBLIC_READ` ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `STORAGE_TYPE` | Backend de armazenamento: `local`, `s3` ou `gcs`. Em produção, `local` desativa o armazenamento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para o armazenamento local. Um caminho relativo é lido a partir do diretório em que o servidor é executado: a raiz do projeto no `rebase dev`, `backend/` em um servidor gerado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permitir armazenamento local em produção — apenas com um volume durável contendo `STORAGE_PATH` e os diretórios `<STORAGE_PATH>__<key>` dos buckets locais nomeados ao lado dele | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante os quais a URL de download de um arquivo privado funciona — o token que `getSignedUrl()` insere nela. No máximo `604800` (uma semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Maior arquivo aceito pela fonte, em bytes, em qualquer rota de upload — `__<KEY>` para uma fonte nomeada. Um valor que não seja um número inteiro de bytes recusa a inicialização | `52428800` (50 MB) |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forçar URLs no formato path-style para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto GCP. Geralmente inferido das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para um arquivo de chave de conta de serviço (service-account). Omita no GCP, onde o Workload Identity fornece as credenciais. | — |
| `STORAGE_PUBLIC_READ` | Servir todos os objetos a qualquer pessoa, sem token. Apenas para um bucket que seja genuinamente uma CDN pública. Uma das três maneiras de satisfazer a proteção de inicialização abaixo. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que qualquer chamador autenticado leia, grave, liste e exclua todos os objetos. Nomeado como `INSECURE` no objeto de configuração por um motivo: só é defensável em uma aplicação single-tenant onde todas as contas têm acesso confiável a todos os arquivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Armazenar em cache as renderizações de imagens geradas (redimensionamentos, conversões de formato) em vez de produzi-las a cada requisição. | `false` |

### E-mail (Opcional)

| Variável | Descrição |
|----------|-----------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Habilitar conexão segura (`true`/`false`) |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `SMTP_FROM` | Endereço do remetente para e-mails do sistema |
| `SMTP_NAME` | Nome de exibição no endereço do remetente |
| `APP_NAME` | Nome do produto usado nos assuntos e corpos dos e-mails (padrão: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo exibido no topo dos modelos de e-mail padrão. PNG ou JPG absoluto `http(s)` — clientes de e-mail removem SVG e bloqueiam URIs `data:`. Se não definida, uma aplicação ainda chamada `Rebase` recebe a marca do Rebase e uma renomeada não recebe nenhum |

### Pool de conexões do banco de dados

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `DB_POOL_MAX` | Número máximo de conexões no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milissegundos em que uma conexão ociosa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milissegundos de espera por uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (sem pool). O [Realtime](/docs/backend/realtime) requer uma: `LISTEN`/`NOTIFY` não sobrevivem a um pooler de transações como o PgBouncer, e sem isso as notificações de alteração são desativadas com um aviso em vez de serem perdidas silenciosamente. O [worker de tarefas](/docs/backend/jobs) também mantém seu `LISTEN` de ativação nela. Preenche o `directConnectionString` do adaptador Postgres quando não estiver definido. | — |
| `DATABASE_READ_URL` | Réplica de leitura. Leituras vão para lá quando estiver definida e for diferente de `DATABASE_URL`; se a conexão falhar, tudo recai para a primária com um aviso. Preenche o `readConnectionString` do adaptador Postgres quando não estiver definido; na versão 0.24 essa opção é ignorada. | — |
| `REBASE_DB_POOL_MAX` | Um teto para cada pool no processo, aplicado independentemente do que cada um solicitou. Apenas dígitos puros: um valor malformado é ignorado em vez de serializar o servidor silenciosamente. | — |

### Comportamento do runtime

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem de servidor publicada.
Um projeto que passou por eject possui essas decisões no seu próprio código.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_RLS_AUDIT` | `true` executa a [auditoria agendada de row-level-security](/docs/rls-check#running-it-on-a-schedule), que reporta tabelas que são servidas sem políticas. O projeto deve declarar `@rebasepro/rls-check` entre suas dependências: o runtime não inclui uma cópia e, sem o pacote, o boot falha, indicando seu nome. `false` mantém a verificação desativada neste processo. | — |
| `REBASE_BASE_PATH` | Caminho base para todas as rotas de API. O cliente deve ser configurado com o mesmo valor — veja [Alterando `basePath`](#alterando-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Servir os assets estáticos/admin do bundle a partir deste processo. Desative quando houver uma CDN à frente. | `true` |
| `REBASE_HISTORY` | Registrar o [histórico de alterações de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respostas comprimidas com gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Corpo máximo da requisição, **em bytes** (`10485760`, não `10MB` — um valor que não seja um número recusa o boot em vez de remover silenciosamente o limite). `0` desativa o limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | A superfície OpenAPI. Três estados: indefinido significa ativo em desenvolvimento, desativo em produção; `false` desativa ambos em qualquer lugar. Observe que `true` em produção serve a **especificação** em `/api/docs`, mas não a **UI** do Swagger em `/api/swagger` — a UI é condicionada a `NODE_ENV` separadamente. | — |
| `REBASE_METRICS` | Expõe métricas Prometheus em `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Adiciona `includeSubDomains` ao cabeçalho `Strict-Transport-Security`, fazendo com que os navegadores recusem HTTP simples em todos os subdomínios do host por seis meses — incluindo hosts que este processo não atende. Ative somente quando todos os subdomínios forem estritamente HTTPS. Qualquer valor que não seja `true`/`false` recusa a inicialização. Veja [Cabeçalhos de segurança](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer protegendo `/metrics`. Indefinido deixa o endpoint aberto a qualquer entidade que possa alcançar a porta — aceitável em uma rede privada, mas não em uma pública, e os logs de inicialização alertarão sobre isso. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer com o schema no boot. `ensure` (o padrão em todos os lugares — incluindo produção) executa a passagem **aditiva**: cria tabelas, colunas e tipos enum ausentes, nunca descartando ou reescrevendo nada. `none` deixa o schema das coleções intacto, mas as tabelas próprias do framework (auth, chaves de API, jobs, cron) continuam sendo criadas e mantidas atualizadas; <span class="since-badge" data-since="0.26">A partir da versão 0.26</span> `REBASE_PROVISION=false` desliga também essas. A imagem publicada aceita apenas esses dois e **recusa a inicialização em `push`**. Em um [split deployment](/docs/deployment/split-processes), exatamente um processo pode fazer o provisionamento, portanto todas as outras funções devem definir `none` ou recusarão a inicialização. | `ensure` |
| `REBASE_PROVISION` | <span class="since-badge" data-since="0.26">A partir da versão 0.26</span> `false` faz o runtime não alterar nada no seu banco de dados: nenhuma tabela, coluna, índice, função, trigger, política, role ou permissão, nem no boot nem depois, incluindo as tabelas próprias do framework. Em vez disso, informa pelo nome o que está faltando. Para um banco de dados que só o seu processo de mudanças pode alterar. Veja [Quando só o seu processo de mudanças pode alterar o banco de dados](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Apenas `true` e `false` são aceitos. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa a inicialização quando o banco de dados foi provisionado pela última vez a partir de um conjunto de coleções diferente daquele a partir do qual este processo foi construído. Indefinido (ou qualquer valor diferente de `true`/`1`) apenas emite um aviso. | warn |
| `REALTIME_CDC` | Captura de alterações em nível de banco de dados: `auto` (habilita onde a conexão suportar, recai silenciosamente caso contrário), `trigger` (força o uso, avisa se for impossível), `wal` (atualmente degrada para `trigger`), `off`. Veja [Realtime](/docs/backend/realtime-cdc/). Tem precedência sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instâncias para canais de broadcast e presence: `memory` ou `postgres`. Ignorado quando `realtime.bus` tiver recebido um transporte instanciado. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quantas inscrições um único socket realtime pode manter; a seguinte é recusada com `TOO_MANY_SUBSCRIPTIONS`. Um número inteiro positivo — qualquer outra coisa interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSubscriptionsPerSocket`. Veja [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Quantos sockets realtime um único usuário pode manter abertos em uma instância de servidor. O login do seguinte é recusado com `TOO_MANY_SOCKETS` e o socket é fechado (4002); o SDK continua tentando novamente, conectando-se assim que outro for fechado. Um número inteiro positivo — qualquer outra coisa interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSocketsPerUser`. | Sem teto |
| `REALTIME_REFETCH_MAX_WAIT_MS` | O tempo máximo que uma alteração aguarda pelo refetch que a entrega aos inscritos ativos, em ms. Um refetch aguarda por 300 ms sem nenhuma alteração e, no máximo, esse período sob um fluxo constante de gravações. Um número inteiro positivo — qualquer outra coisa interrompe o servidor na inicialização. Tem precedência sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Por quanto tempo o total de uma inscrição de lista grande pode ser reutilizado antes de ser contado novamente, em ms; os frames que o reutilizam carregam `meta.totalAsOf`. Indefinido, cada frame realiza a contagem. Tem precedência sobre `realtime.recountIntervalMs`. | Indefinido |
| `REALTIME_RECOUNT_MIN_ROWS` | O menor total anterior ao qual `REALTIME_RECOUNT_INTERVAL_MS` se aplica; listas menores são contadas a cada frame. Tem precedência sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores `localhost`/loopback sob `NODE_ENV=production`. Desativado por padrão, para que a inicialização em produção falhe expressamente em vez de conectar-se a um banco de dados inexistente. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | O que o boot faz com uma chave nas suas coleções que esta versão não reconhece: `warn`, `error` (recusa a inicialização — recomendado ativar em CI), ou `off`. Aplica-se apenas a chaves que ele não *reconhece*, que normalmente são erros de digitação e ocasionalmente metadados intencionais; uma chave que ele sabe que mudou de lugar é sempre fatal, pois a funcionalidade configurada estaria silenciosamente ausente de outra forma. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` executa a passagem de schema e encerra o processo sem abrir um socket — o formato ideal para um Job de migração, a partir da mesma imagem e do mesmo bundle do servidor que o sucede. Um valor vazio é considerado *indefinido*, garantindo que um `${SOMETHING}` não substituído em um arquivo compose não transforme uma implantação comum em uma que apenas migra e se recusa a atender requisições. Também cria as tabelas que um processo que serve criaria no primeiro uso, e não inicia o cron nem a fila de jobs. Recusado junto com <span class="since-badge" data-since="0.26">A partir da versão 0.26</span> `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | <span class="since-badge" data-since="0.26">A partir da versão 0.26</span> Um caminho de arquivo. Uma execução de provisionamento (`REBASE_PROVISION_ONLY=true`) escreve nele cada mudança de schema que fez, em ordem, como um script SQL para revisar e aplicar com `psql`. As linhas que ela escreveu não são incluídas. Recusado em um processo que serve. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que uma máquina — um agente, um job de CI — *aplique* uma alteração de schema através de `/api/admin/schema`, e não apenas a planeje. Desativado a menos que explicitamente solicitado: a credencial que realizaria tal alteração é a mais propensa a estar armazenada em uma variável de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Quanto tempo uma função personalizada pode rodar antes que sua requisição seja abortada. O mesmo ajuste que a opção `functionsTimeoutMs`. `0` desativa o timeout. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz com que uma rejeição de promise não tratada termine o processo em vez de apenas registrá-la em log. Ativado sob um orquestrador que reiniciará o contêiner; desativado onde um reinício for pior que um vazamento. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantém o agendador de cron rodando em uma plataforma que o runtime normalmente detectaria como scale-to-zero, onde um timer acionado em uma instância ociosa não dispararia em instância alguma. | — |
| `TRUSTED_PROXY_HOPS` | Quantos proxies estão à frente deste servidor, permitindo que o rate limiter leia o endereço IP real do cliente a partir de `X-Forwarded-For`. Padrão seguro contra falhas `0`: sem proxy, confiar no cabeçalho permitiria que qualquer chamador forjasse uma identidade. | `0` |

:::note[O provisionamento na inicialização é aditivo e não é uma ferramenta de migração]
A etapa de boot roda de forma não assistida, sem ninguém avaliando um diff, portanto nunca
removerá uma coluna, restringirá um tipo ou reescreverá uma tabela. É também por isso que a imagem recusa
`REBASE_MIGRATE_ON_BOOT=push`: um push completo calcula um diff e executará alegremente
`DROP COLUMN`, e um reinício de contêiner jamais deve ter a capacidade de destruir uma
coluna em produção como efeito colateral de um reagendamento.

Alterações destrutivas ou que reformulam a estrutura devem permanecer onde possam ser revisadas: `rebase db
generate` + `rebase db migrate`, ou `rebase db push` a partir de um checkout ou CI,
que simula a alteração (dry-run), recusa operações destrutivas sem confirmação e
pode realizar um backup antes de prosseguir.
:::

### Implantações particionadas (Split deployments)

Uma única imagem e um único bundle podem ser inicializados várias vezes, cada um atendendo a uma
parte diferente do projeto. Uma linha para cada aqui, pois esta página lista
todas as variáveis; o que cada combinação *monta e controla* — e quais
combinações recusam a inicialização — está documentado em
**[Processos particionados (Split Processes)](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_ROLE` | Qual parte este processo atende: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescreve se *este* processo executa os timers de cron. Indefinido segue o papel (`REBASE_ROLE`). | — |
| `REBASE_JOB_WORKERS` | Sobrescreve se este processo executa workers da fila de tarefas. Indefinido segue o papel. | — |
| `REBASE_FUNCTIONS_ONLY` | Atende apenas as funções personalizadas especificadas neste processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Atende todas as funções personalizadas, exceto as especificadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Para onde o processo de API encaminha uma requisição de função que ele próprio não atende. | — |

### Superfície MCP

Um endpoint opcional (opt-in) de Model Context Protocol em `/mcp`, permitindo que um cliente de IA leia
e escreva neste projeto **como o usuário autenticado**. Desativado a menos que explicitamente configurado e — diferentemente
de qualquer outra superfície — nenhum `REBASE_ROLE` o ativa: os outros descrevem o
formato do processo, enquanto este representa a decisão de conceder credenciais a software de
terceiros, algo que deve ser feito por uma pessoa e não herdado da
função de um contêiner.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_MCP_ENABLED` | Monta a superfície MCP. Requer `REBASE_PUBLIC_URL`; sem ela, a superfície se recusa a ser montada e informa isso no log de inicialização. | `false` |
| `REBASE_PUBLIC_URL` | A origem acessível externamente desta implantação, ex.: `https://app.example.com`. A superfície MCP não consegue derivá-la — obter a origem a partir do cabeçalho `Host` tornaria a identidade do emissor, e a audiência contra a qual seus próprios tokens são validados, um valor fornecido pelo chamador. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite o registro dinâmico de clientes OAuth (RFC 7591), permitindo que um cliente se autoinscreva. Defina como `false` para exigir que os clientes sejam registrados previamente. | `true` |

### Edição de schema ao vivo a partir de um bundle

Desativado a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esteja definido. Um bundle compilado não tem
código-fonte de coleções para editar, portanto, com essas variáveis configuradas, o editor de coleções da administração lê
o fonte a partir do repositório, faz commit de cada alteração de volta e executa seu DDL
neste banco de dados. Exclusivo para administradores e aplicado por uma pessoa, a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique o contrário. Um repositório especificado
sem nenhuma credencial utilizável recusa a inicialização. Veja
[Edição de schema ao vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | O repositório GitHub para onde commitar as alterações de schema, no formato `owner/name`. Defini-lo é o que ativa o recurso. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | A branch na qual o commit é aplicado. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Onde os arquivos fonte das coleções residem nesse repositório, relativo ao repositório. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Um token granular com acesso de leitura e escrita ao conteúdo do repositório. Defina este token ou as três variáveis `_GITHUB_APP_*`, não ambos. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | O ID de um GitHub App, para fazer commits como o aplicativo em vez de usar um token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | O ID de instalação do aplicativo no repositório. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | A chave privada do aplicativo: PEM, PEM com quebras de linha escapadas, ou base64. | — |

### Backups

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `BACKUP_SCHEDULE` | Expressão cron para backups agendados. Indefinido significa que os backups agendados estão desativados. | — |
| `BACKUP_DESTINATION` | Caminho local ou uma URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Excluir backups com mais de N dias. Indefinido ou `0` mantém tudo. | — |
| `BACKUP_KEEP_MINIMUM` | Sempre reter pelo menos N backups mais recentes, independentemente da retenção. | — |
| `PG_DUMP_PATH` | Sobrescreve o binário `pg_dump` — deve ser da versão principal do servidor ou mais recente. | — |
| `PG_RESTORE_PATH` | Sobrescreve o binário `pg_restore`. | — |
| `PSQL_PATH` | Sobrescreve o binário `psql` que o `rebase db restore --clean` executa para realizar a restauração em uma única transação. | — |
| `PG_DUMPALL_PATH` | Onde o `pg_dumpall` reside, quando não estiver no `PATH`. Sem ele — e sem as ferramentas de cliente do PostgreSQL instaladas —, um backup de globais falhará com um erro citando esta variável. | — |

A imagem de runtime oficial (`rebasepro/server`) traz embutidas as ferramentas de
cliente do PostgreSQL 18, de modo que um backup agendado roda nela contra qualquer servidor até o Postgres 18.
Fora da imagem, instale-as manualmente (`apt-get install postgresql-client-18`,
`brew install libpq`).

Os backups contêm segredos e dados pessoais identificáveis (PII). Use um destino privado com
criptografia em repouso.

### Entrega de bundles

Uma implantação gerenciada não carrega seu código na imagem: o runtime busca um
bundle durante a inicialização. Estas variáveis definem qual bundle e como.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já extraído. O que o `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | De onde baixar o arquivo compactado do bundle, quando não houver um local. | — |
| `REBASE_BUNDLE_TOKEN` | A credencial bearer para essa busca. Trate-a como um segredo: é o que autoriza um tenant a baixar seu próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Onde um bundle baixado é extraído. Deve ser gravável e persistir entre o download e a inicialização. | — |
| `REBASE_RUNTIME_MODULES` | Módulos extras que a imagem de runtime fornece ao bundle, além daqueles que ela já declara por padrão. | — |

### Vinculações de recursos (Resource bindings)

Cada banco de dados, bucket e tópico que um projeto declara em `config/resources.ts` é
vinculado por variáveis de ambiente nomeadas com base nele. Os nomes base estão abaixo; um
recurso que não seja o padrão anexa `__` e sua chave em maiúsculas, portanto um bucket chamado
`media` lê `S3_BUCKET__MEDIA`. O comando `rebase status` exibe, para cada recurso,
a variável exata que está sendo lida e se ela está definida.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_DRIVER` | O pacote npm que implementa o driver de uma fonte de dados, quando não for o padrão Postgres. Com sufixo por fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | A string de conexão para um tópico declarado. Com sufixo por tópico. | — |

### O próprio ambiente da CLI

Lido pelo `rebase`, não pelo servidor. Nada aqui afeta uma implantação.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BASE_URL` | Para onde `rebase api-keys`, `rebase storage` e `rebase auth reset-password` enviam a service key, no shell ou no `.env`. Defina quando o servidor rodar de outra forma que não `rebase dev` neste projeto: `rebase start`, um contêiner, outro host. Se não configurado, eles usam o servidor que o `rebase dev` registrou enquanto esse servidor estiver rodando, e não enviam nada quando não estiver. | — |
| `REBASE_SERVICE_KEY` | A service key com a qual esses comandos se autenticam, lida do `.env`: a mesma variável que o servidor lê (veja acima). | — |
| `SERVICE_KEY` | Um nome mais antigo para essa chave. Quando o `.env` a define, `rebase api-keys` e `rebase storage` a leem no lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qual arquivo `.env` a CLI lê e grava, quando não for o padrão do projeto. | — |
| `REBASE_CLOUD_URL` | O plano de controle com o qual o `rebase cloud` se comunica. | — |
| `REBASE_CLOUD_EMAIL` | A conta com a qual o `rebase cloud login` faz login, em vez de solicitar interativamente. | — |
| `REBASE_CLOUD_PASSWORD` | Sua senha, para que um cofre de segredos possa fornecê-la sem que ela vá para o histórico do shell. | — |
| `REBASE_TOKEN` | Um token gerado por `rebase cloud tokens create`. Quando definido, todos os comandos do `rebase cloud` se autenticam com ele em vez da sessão do `rebase cloud login`, e nunca leem ou gravam a sessão armazenada. É a forma recomendada de executar o `rebase cloud` no CI — veja [CI e agentes](/docs/deployment/cloud/#ci-and-agents). O [servidor MCP](/docs/ai/mcp/) lê o mesmo nome como um alias de `REBASE_API_TOKEN`. | — |
| `REBASE_DEBUG` | `1` exibe o erro subjacente e detalhes da requisição em vez da mensagem curta. A primeira coisa a definir quando um comando do `rebase cloud` falhar sem fornecer detalhes úteis. | — |
| `REBASE_ATLAS_DEV_URL` | O banco de dados vazio contra o qual `rebase db push`, `db generate` e `db migrate` planejam alterações, em vez do `<db>_dev_diff` que eles criam ao lado do `DATABASE_URL`. O Rebase não cria nem remove o banco de dados aqui indicado, e recusa um valor idêntico ao `DATABASE_URL`. No banco de desenvolvimento gerenciado, a CLI o define para um PGlite em memória descartável próprio. Configure-o onde a permissão `CREATE DATABASE` não for concedida. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | O `rebase dev` não inicia nenhum banco de dados e não provisiona nada — você fornece o seu próprio. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento do frontend, que o `rebase dev` normalmente deriva do caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Quanto tempo o `rebase dev` espera pelo backend se anunciar antes de declarar que ele não iniciou. `0` desativa o alerta. | `30000` |
| `DATABASE_PASSWORD` | A senha que o `rebase dev --docker` insere na string de conexão derivada do `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | A convenção comum entre ferramentas. Defina para qualquer valor diferente de `0` e a CLI não enviará telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | O mesmo, especificamente para o Rebase. Não requer arquivo, por isso é a opção indicada para uso em CI e em imagens. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Para onde a telemetria é enviada, no caso de um coletor auto-hospedado (self-hosted). | — |

## Segredos em desenvolvimento

`JWT_SECRET` e `REBASE_SERVICE_KEY` são obrigatórios em produção e gerados
automaticamente fora dela, para que você possa começar sem precisar configurar nada.

Esses valores gerados ficam armazenados em cache em `.rebase-dev-secrets.json`, ao lado de
`.rebase-dev-port` e `.rebase-dev-url`, ignorados pelo git junto com eles. Anteriormente, eles
eram gerados novamente a cada boot — portanto, reiniciar o servidor de desenvolvimento desconectava você
da sua própria aplicação e invalidava qualquer chave de API recém-criada.

- Defina qualquer uma das variáveis explicitamente e seu valor será usado; nada é armazenado ou lido do cache.
- Aponte o cache para outro local com `REBASE_DEV_SECRETS_FILE` — um caminho, e a
  única variável desta seção que você configuraria deliberadamente.
- Exclua o arquivo para renovar ambos os segredos. O próximo boot gravará um novo arquivo.
- Se o arquivo não puder ser gravado — como em um contêiner somente leitura —, o servidor iniciará
  de qualquer forma com um segredo temporário, exatamente como fazia antes.

Nada é mantido em cache em produção ou sob um executor de testes. Em produção, uma inicialização
que precise gerar qualquer um dos segredos continuará falhando e indicando o nome da variável, comportamento que
permanece inalterado:

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
```

## Objeto de Configuração do Backend

O `RebaseBackendConfig` passado para `initializeRebaseBackend()` fornece controle programático:

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

As mesmas opções,
sem `app`, `server` e `basePath` e com um `provision` obrigatório, constroem um
backend que não atende a nada até que você o monte: `createRebaseBackend`. Veja
[Integração com Servidor Customizado](/docs/backend/custom-server/).

### Alterando `basePath`

O `basePath` altera a rota de todas as APIs, portanto o cliente deve ser informado da mesma configuração —
caso contrário, continuará requisitando `/api/...` e receberá 404 para tudo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel de administração obtém isso automaticamente do cliente fornecido a ele; nada mais precisa
ser configurado. Caso você monte uma URL de requisição manualmente, concatene-a a partir do cliente em
vez de escrever `/api` por conta própria:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solução de Problemas

### Permissão Negada no SQL Editor (`permission denied for table <name>`)

* **Sintomas:** Consultas customizadas executadas no editor SQL do Rebase Studio falham com `cause: error: permission denied for table <name>`, embora a visualização de planilha do CMS carregue os dados com sucesso.
* **Causa:** Por padrão, o Rebase tenta executar consultas do SQL Editor alternando temporariamente as roles do banco de dados para corresponder ao papel do usuário ativo na aplicação (por exemplo, `SET LOCAL ROLE "admin"`). Se você estiver usando autenticação personalizada onde os papéis existem apenas em tabelas do banco de dados e não como papéis reais do PostgreSQL, a troca de papel falha ou faltam privilégios no banco. A visualização de planilha do CMS executa sob o usuário proprietário da conexão padrão e ignora essa troca.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` à sua configuração `.env` do backend. Isso força o Rebase a executar consultas do SQL Editor usando os privilégios do proprietário da conexão (normalmente um superuser/owner). O SQL Editor passa então a exibir, acima dos resultados, que eles foram lidos como o proprietário da conexão, e desabilita seu seletor de papéis.

### Falha ao Obter o Schema no SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio falha ao carregar a árvore de schema, ou o SQL Editor exibe `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** O Rebase requer privilégios administrativos para consultar os catálogos de sistema do banco de dados e executar comandos administrativos. Se `adminConnectionString` não for fornecida ao bootstrapper, ou se `getAdmin()` for sobrescrito para retornar `undefined`, essas operações falharão.
* **Solução:** Certifique-se de que `adminConnectionString` esteja configurada durante a inicialização do bootstrapper do backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Próximos Passos

- **[Implantação](/docs/getting-started/deployment)** — Guia de implantação em produção
- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
