---
sourceHash: 0309acf690d3fb3f
title: Ambiente e Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita por meio de variáveis de ambiente no seu arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida variáveis de ambiente com **Zod** na inicialização. Se
> algo obrigatório estiver faltando ou malformado (uma URL que não é uma URL, uma porta que
> não é um número), o servidor se recusa a inicializar e indica o nome da variável.
>
> O local onde o esquema reside depende de como você executa o backend. Um projeto inicializado
> pelo runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o
> esquema que pertence ao runtime (`loadBootEnv` em `@rebasepro/server`), que é a
> união de todas as tabelas abaixo. Um projeto que executou [`rebase eject`](/docs/cli)
> possui um `backend/src/env.ts` chamando `loadEnv({ extend })`, e pode adicionar suas próprias
> variáveis tipadas lá.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | String de conexão do PostgreSQL. **Opcional em desenvolvimento** — se não definida, `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Obrigatória em qualquer outro lugar. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinatura de tokens JWT. Use uma string aleatória forte (mín. 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> Por padrão, node-postgres verifica o certificado com `sslmode=require`. Ferramentas
> libpq, como `psql`, aceitam `require` com verificações mais fracas e rejeitam
> `no-verify`. Use `sslmode=verify-full&sslrootcert=/path/to/ca.pem` para verificar a
> CA e o nome do servidor. Para criptografar sem verificar o certificado, configure
> `sslmode=no-verify` no Rebase. O Rebase passa `sslmode=require` ao Ptah Compat e às
> ferramentas de backup e restauração do PostgreSQL. Use `sslmode=require` nas
> chamadas diretas ao libpq.

### Frontend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `VITE_API_URL` | URL da API do backend para o SDK tipado. **Defina apenas em desenvolvimento** — veja abaixo. | origem da página |
| `VITE_GOOGLE_CLIENT_ID` | Client ID do Google OAuth. Habilita "Entrar com Google". | — |


> **Deixe `VITE_API_URL` indefinido em builds de produção.**
>
> Em desenvolvimento, o frontend e o backend são origens separadas, portanto o servidor
> de desenvolvimento injeta isso. Em produção, o backend do Rebase serve a SPA, portanto
> a API é a própria origem da página e o cliente a resolve dessa forma por conta própria.
>
> Embutir uma URL absoluta em um pacote de produção funciona perfeitamente até que um segundo
> hostname aponte para a mesma aplicação: um domínio customizado então carrega a página a partir
> de `example.com` e chama a API em `example.rebase.website`, o que é cross-origin, fazendo
> com que cada requisição falhe no preflight. Permitir a origem no CORS **não**
> resolve isso também — o cookie de atualização (refresh cookie) é `SameSite=Lax` e não é
> enviado entre sites (cross-site), portanto você limparia os erros do console e ainda assim
> teria a autenticação quebrada. Não definida, qualquer domínio que aponte para a aplicação
> funciona sem qualquer configuração de CORS.

### Backend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta para o servidor HTTP do backend. Lida por `rebase start`. O `rebase dev` a lê **apenas do ambiente do shell** — um `PORT` no `.env` não é lido lá, pois a porta é resolvida antes que esse arquivo seja carregado — e caso contrário vincula uma porta derivada do caminho do projeto, para que vários projetos possam rodar ao mesmo tempo. `rebase dev --port` tem precedência sobre ambos, e o banner inicial informa a origem utilizada. | `3001` |
| `LOG_LEVEL` | Nível de detalhes de log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Exibe o SQL por trás de uma linha `Failed query: [redacted]`. Toda instrução que falha é ocultada por padrão, porque uma consulta com falha carrega seus parâmetros vinculados — um e-mail, um hash de senha. Defina como `true` ao diagnosticar falhas de DDL, RLS ou captura de alterações (change-capture). Ignorado quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Lista separada por vírgulas de origens permitidas. **Obrigatório em produção** a menos que `FRONTEND_URL` esteja definido: uma inicialização em produção sem nenhum dos dois se recusa a iniciar. Em desenvolvimento, é *adicionado ao* localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL da aplicação frontend. Usada como alternativa a CORS_ORIGINS, em ambos os ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão de nível administrativo com o banco de dados (usada para introspecção de esquema e operações administrativas). O banco de dados informado aqui não é aquele que o console SQL considera atual, nem o que uma nova ramificação (branch) copia por padrão: ambos são o banco de dados no qual a própria conexão da aplicação está (veja `REBASE_BRANCH_PARENT_DATABASE` para um servidor em uma branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a alternância de funções (role-switching) do PostgreSQL no SQL Editor (útil para autenticação personalizada onde as funções de BD não estão mapeadas). O console SQL do Studio então informa que as linhas foram lidas como o proprietário da conexão, o identifica e desabilita seu seletor de papéis. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | O banco de dados a partir do qual a branch onde este servidor roda foi copiada. `rebase dev` a define em um checkout [alternado para uma branch](/docs/backend/branching/#cli-integration). Um servidor configurado com ela mantém o registro de branches nesse banco de dados e copia novas branches a partir dele por padrão, de modo que o painel Branches do Studio exibe as branches do banco de dados principal. | — |

#### CORS em desenvolvimento

O desenvolvimento permite **localhost, mais o que quer que `CORS_ORIGINS` (ou `FRONTEND_URL`)
defina** — a mesma lista usada em produção, com localhost adicionado em vez de
substituído. Portanto, a variável funciona da mesma maneira em ambos os ambientes, e os
casos que precisam dela em desenvolvimento são os comuns:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não seja localhost nem esteja listada é recusada, e a recusa é
registrada em log **uma vez por origem** com a linha exata que a permitiria. Recusar não é
mera precaução: a API envia credenciais, portanto refletir um `Origin`
arbitrário permitiria que qualquer site que o desenvolvedor visitasse fizesse
requisições autenticadas contra o servidor de desenvolvimento com sua sessão e lesse as
respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `JWT_SECRET` | Segredo para assinatura de JWT (obrigatório em produção, gerado automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso assimetricamente (RS256), de modo que qualquer entidade que possua o JWKS possa verificar uma sessão sem poder forjar uma. Aceita um PEM com quebras de linha reais, um PEM com escapes `\n`, ou base64 do PEM inteiro. Sem ela, os tokens permanecem em HS256. | — |
| `JWT_KEY_ID` | Nomeia `JWT_PRIVATE_KEY` no cabeçalho do token e no JWKS. Altere-o sempre que a chave mudar — a rotação depende de o antigo e o novo serem distinguíveis. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de vida do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de vida do refresh token. Deslizante — cada rotação o renova, portanto isso rege quanto tempo uma sessão sobrevive à **inatividade**. Defina `400d` para sessões que sobrevivem a uma longa ausência; os navegadores limitam o cookie de atualização nesse valor. | `30d` |
| `ALLOW_REGISTRATION` | Permite o registro de novos usuários (`true`/`false`). Fora de produção, o **primeiro** usuário sempre pode se registrar, independentemente do que isso diga — uma tabela de usuários vazia precisa admitir alguém, e esse alguém se torna o administrador. Em produção (`NODE_ENV=production`), essa janela é fechada: uma tabela vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma primeira conta criada por meio de registro aberto é uma conta comum, e o administrador é definido com `REBASE_ADMIN_EMAIL` abaixo ou atribuído com a service key. O `.env.example` do scaffold define como `true`; o padrão do framework é desativado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Botão de desligamento de emergência (kill switch). Fecha a janela de bootstrap do primeiro usuário que `ALLOW_REGISTRATION=false` deliberadamente deixa aberta fora de produção, de modo que o registro seja bloqueado mesmo em um banco de dados vazio. Combine com `REBASE_ADMIN_EMAIL` abaixo, ou a implantação não terá como produzir seu primeiro usuário autenticado. Todos os artefatos de implantação distribuídos o definem. | — |
| `REBASE_ADMIN_EMAIL` | E-mail da primeira conta de administrador, criada na inicialização **enquanto a tabela de usuários ainda estiver vazia** e nunca depois disso. É assim que uma implantação de produção obtém seu administrador: o operador define a primeira conta em vez de disputar contra a internet por ela. A inicialização avisa quando a tabela estiver vazia em produção e isso não estiver definido. | — |
| `REBASE_ADMIN_PASSWORD` | Senha para essa conta. Pelo menos 12 caracteres, caso contrário é recusada e a conta não é criada. Altere-a após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Criptografa todos os segredos TOTP armazenados. Se não configurada, os segredos são criptografados com `JWT_SECRET` e a inicialização emite um aviso — logo, rotacionar `JWT_SECRET` desconecta todos *e* torna qualquer autenticador cadastrado indecifrável. Defina uma chave dedicada (32+ caracteres aleatórios) antes que alguém se cadastre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave da qual se está migrando na rotação. Defina ambas durante uma rotação: novos segredos são gravados com `MFA_ENCRYPTION_KEY` e os existentes continuam legíveis, para que ninguém perca o acesso à própria conta no meio da rotação. Remova-a assim que todos os segredos forem recriptografados. | — |
| `ALLOW_ANONYMOUS` | Habilita login anônimo (`POST /api/auth/anonymous`). Opcional (opt-in) e deliberadamente não condicionado a `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina como `false` para uma superfície de leitura totalmente pública — RLS ainda se aplica. | `true` |
| `AUTH_DEFAULT_ROLE` | Papel atribuído a um usuário recém-registrado quando nenhum é fornecido. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Disponibiliza `POST /api/auth/find-user`, que resolve um e-mail em um perfil público mínimo (`uid`, `displayName`, `photoURL`) para fluxos de convite por e-mail. Apenas chamadores autenticados, e nunca retorna o e-mail, funções ou metadados do usuário encontrado. Desativado por padrão: trata-se de uma superfície de enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` no cookie de atualização: `Strict`, `Lax` ou `None`. `None` requer HTTPS e é apenas para um frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` no cookie de atualização. Seguro por padrão; `AUTH_COOKIE_SECURE=false` para http simples — uma implantação em um endereço de LAN onde o navegador, de outra forma, descartaria o cookie e a sessão expiraria junto com o token de acesso sem erro. Emite um aviso na inicialização. `http://localhost` não precisa disso. | `true` |
| `GOOGLE_CLIENT_ID` | Client ID do Google OAuth (validação no backend) | — |
| `GOOGLE_CLIENT_SECRET` | Client secret do Google OAuth | — |
| `GITHUB_CLIENT_ID` | Client ID do GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Client secret do GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | Client ID do Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Client secret do Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | Client ID do LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Client secret do LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | Client ID do Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Client secret do Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | Client ID do X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Client secret do X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | Client ID do Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Client secret do Discord OAuth | — |
| `GITLAB_CLIENT_ID` | Client ID do GitLab OAuth. O `baseUrl` de uma instância auto-hospedada não possui configuração por variável de ambiente — configure o GitLab no bloco `auth` para isso. | — |
| `GITLAB_CLIENT_SECRET` | Client secret do GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID do Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client secret do Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID do Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client secret do Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID do Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client secret do Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Apple Services ID, para login via web. É público e disponibilizado em `GET /auth/config`. A Apple não tem client secret estático, pois o Rebase assina um JWT ES256 de curta duração para cada troca de token. Portanto, a Apple precisa de `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, além deste ou de `APPLE_BUNDLE_IDS`, e não configura nada sem eles. | — |
| `APPLE_BUNDLE_IDS` | Bundle IDs separados por vírgula dos aplicativos nativos para iOS/macOS cujos códigos de "Sign in with Apple" são aceitos. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, o emissor do JWT. | — |
| `APPLE_KEY_ID` | Key ID da chave privada registrada na Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, incluindo quebras de linha (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave de API administrativa estática. Ignora a autenticação JWT normal para chamadas servidor-a-servidor quando enviada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | A chave pública da plataforma de hospedagem (PEM, EC P-256) contra a qual os tokens de plataforma `rpt_` são verificados; vários blocos PEM durante uma rotação de chave. A plataforma a define no deploy e não contém nenhum segredo. Junto com `REBASE_PLATFORM_TOKEN_AUDIENCE`, ela permite que o controle de admin aceite um token de plataforma para `cron:read`, e para nada mais. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | O ID do projeto com o qual o `aud` de um token de plataforma deve coincidir, para que um token emitido para outro projeto seja recusado. Com apenas uma das duas variáveis configurada, o servidor inicializa, registra um aviso e responde a qualquer token `rpt_` com `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Onde residem os contadores de rate-limit, para as rotas de autenticação e para `rateLimit` em funções customizadas: `memory` (por processo) ou `sql` (compartilhado entre réplicas). Um processo não pode ver sua própria contagem de réplicas, portanto uma implantação com instâncias irmãs precisa explicitar isso — três réplicas no padrão aplicam três vezes o limite. Qualquer outro valor **recusa a inicialização** em vez de aplicar fallback, `postgres` incluso. | `memory` |
| `AUTH_MAGIC_LINK` | Disponibiliza o fluxo de link de login sem senha (magic link). Necessita de um serviço de e-mail configurado, caso contrário o link não tem para onde ir. | `false` |
| `AUTH_EMAIL_OTP` | Disponibiliza login sem senha com um código de seis dígitos enviado por e-mail. Mesma exigência de serviço de e-mail que acima. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Cadastro sem senha: uma solicitação de magic link ou código por e-mail para um endereço desconhecido cria a conta, enquanto o registro estiver aberto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | O que fazer quando um refresh token for reutilizado após sua janela de reutilização: `reject` (recusá-lo, manter a sessão) ou `revoke-session` (encerrar a sessão). Qualquer outro valor falha a inicialização. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro com confirmação prévia: nenhum login com senha até que o endereço seja verificado. Requer e-mail; a inicialização recusa sem ele. | `false` |
| `CAPTCHA_PROVIDER` | Ativa verificação de captcha nas rotas de autenticação: `turnstile` ou `hcaptcha`. Indefinido significa sem captcha. | — |
| `CAPTCHA_SECRET` | O segredo do provedor, usado no servidor para verificar o token enviado pelo navegador. Obrigatório assim que `CAPTCHA_PROVIDER` for definido. | — |
| `CAPTCHA_ROUTES` | Rotas de autenticação separadas por vírgula a serem protegidas (por exemplo `register,login`). Indefinido protege o conjunto padrão do provedor. | — |

### Storage

:::caution[O storage não possui segurança em nível de linha (RLS), portanto precisa de um modelo de acesso]
As tabelas são protegidas pelo RLS do Postgres. O armazenamento de objetos não possui equivalente —
as chaves compartilham um único namespace simples — portanto, com um bucket configurado e nenhum modelo de acesso,
o servidor **se recusa a inicializar em produção**. Atenda a isso com exatamente um dos seguintes:
um hook `storageAuthorize` exportado de `backend/storage.ts` (o que o scaffold
fornece), `STORAGE_PUBLIC_READ` ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `STORAGE_TYPE` | Backend de armazenamento: `local`, `s3` ou `gcs`. Em produção, `local` desativa o armazenamento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para armazenamento local. Um caminho relativo é lido a partir do diretório onde o servidor é executado: a raiz do projeto em `rebase dev`, `backend/` em um servidor gerado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite armazenamento local em produção — apenas com um volume persistente contendo `STORAGE_PATH` e os diretórios `<STORAGE_PATH>__<key>` de buckets locais nomeados ao lado dele | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante os quais a URL de download de um arquivo privado funciona — o token que `getSignedUrl()` inclui nela. No máximo `604800` (uma semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Maior arquivo que a fonte aceita, em bytes, em todos os caminhos de upload — `__<KEY>` para uma fonte nomeada. Um valor que não seja um número inteiro de bytes recusa a inicialização | `52428800` (50 MB) |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região da AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso da AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta da AWS | — |
| `S3_ENDPOINT` | Endpoint customizado do S3 (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forçar URLs path-style para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto GCP. Geralmente inferido das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para o arquivo de chave da conta de serviço. Omitir no GCP, onde o Workload Identity fornece as credenciais. | — |
| `STORAGE_PUBLIC_READ` | Serve todos os objetos para qualquer pessoa, sem token. Apenas para um bucket que seja genuinamente uma CDN pública. Uma das três formas de atender à proteção de inicialização mencionada. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que qualquer usuário autenticado leia, grave, liste e exclua qualquer objeto. Nomeado como `INSECURE` no objeto de configuração por um motivo: só é defensável em uma aplicação single-tenant onde todas as contas têm permissão irrestrita para todos os arquivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Armazena em cache as renderizações de imagem geradas (redimensionamentos, conversões de formato) em vez de gerá-las a cada requisição. | `false` |

### E-mail (Opcional)

| Variável | Descrição |
|----------|-----------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Ativar conexão segura (`true`/`false`) |
| `SMTP_USER` | Nome de usuário do SMTP |
| `SMTP_PASS` | Senha do SMTP |
| `SMTP_FROM` | Endereço de remetente para e-mails do sistema |
| `SMTP_NAME` | Nome de exibição no endereço do remetente |
| `APP_NAME` | Nome do produto usado no assunto e corpo dos e-mails (padrão: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo exibido no topo dos modelos de e-mail padrão. PNG ou JPG `http(s)` absoluto — os clientes de e-mail removem SVG e bloqueiam URIs `data:`. Indefinido, uma aplicação ainda chamada `Rebase` recebe a marca do Rebase e uma renomeada não recebe nenhum |

### Pool de conexões do banco de dados

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `DB_POOL_MAX` | Conexões máximas no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milissegundos em que uma conexão ociosa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milissegundos de espera por uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (sem pool). O [Realtime](/docs/backend/realtime) precisa de uma: `LISTEN`/`NOTIFY` não sobrevive a um pooler de transação como o PgBouncer, e sem isso as notificações de alteração são desativadas com um aviso em vez de serem perdidas silenciosamente. O [job worker](/docs/backend/jobs) mantém seu `LISTEN` de ativação nela também. Preenche o `directConnectionString` do adaptador Postgres quando não estiver definido. | — |
| `DATABASE_READ_URL` | Réplica de leitura, como um hot standby. Quando aponta para outro servidor, leituras autenticadas (listagens, linhas únicas, contagens, agregações) são atendidas lá sob a mesma segurança em nível de linha (RLS); gravações, autenticação, realtime, crons, jobs, o console SQL e `rebase.sql` permanecem no primário. Um leitor que acabou de gravar lê do primário por `REBASE_READ_STICKY_MS`, e todos o fazem enquanto a réplica estiver com atraso maior que `REBASE_READ_MAX_LAG_MS` ou falhando. Preenche o `readConnectionString` do adaptador Postgres quando não estiver definido; até a versão 0.28 (inclusive), o pool da réplica era aberto e nunca lido. | — |
| `REBASE_READ_STICKY_MS` | Após uma gravação, por quanto tempo as leituras do mesmo usuário vão para o primário, de modo que uma gravação seguida de uma listagem mostre o dado salvo. Por instância do servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Atraso (lag) da réplica a partir do qual todas as leituras vão para o primário. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa por um pooler em modo de transação, como o PgBouncer. O pool então não envia `search_path` ou `statement_timeout` na conexão (o pooler os recusaria ou descartaria) e define ambos em cada transação; a inicialização define para a role do banco um `search_path` padrão como `public` para instruções fora de uma transação. `DATABASE_DIRECT_URL` torna-se obrigatória, e realtime, ativação de workers de jobs, criação de índices, branching e o console SQL usam-na. A URL da réplica também é considerada com pool. `DATABASE_POOLED__<KEY>` para outra fonte de dados. | — |
| `REBASE_DB_POOL_MAX` | Um teto para cada pool no processo, aplicado independentemente do que cada um solicitou. Apenas dígitos puros: um valor malformado é ignorado em vez de serializar silenciosamente o servidor. | — |

### Comportamento do runtime

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem de servidor publicada.
Um projeto ejetado assume essas decisões em seu próprio código.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_RLS_AUDIT` | `true` executa a [auditoria agendada de segurança em nível de linha](/docs/rls-check#running-it-on-a-schedule), que reporta tabelas que estão sendo servidas sem políticas. O projeto deve declarar `@rebasepro/rls-check` entre suas dependências: o runtime não inclui uma cópia e, sem o pacote, a inicialização falha informando o nome dele. `false` mantém a verificação desativada neste processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | O papel (role) do Postgres sob o qual as requisições autenticadas e anônimas são executadas. Atribua um exclusivo para cada projeto em um cluster compartilhado. O banco de dados registra a role sob a qual executa, e uma inicialização configurada com outra se recusa a iniciar até que `rebase db request-role migrate` a altere. Veja [Executando em um banco de dados existente ou compartilhado](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` cria a role da requisição e permite que a conexão alterne para ela; `never` deixa ambos sob sua responsabilidade e apenas os verifica. | `auto` |
| `REBASE_RLS_GRANTS` | O que o Rebase concede à role da requisição: `schema` (todas as tabelas nos esquemas que serve, além dos privilégios padrão), `managed` (apenas as tabelas que serve) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe as políticas permissivas do Rebase à(s) role(s) da requisição, para que outros papéis que leiam as mesmas tabelas não recebam permissões delas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` cria as políticas que apenas o contexto do servidor ou um administrador podem passar `TO public`, e executa administradores como a role da requisição. Por padrão, elas são `TO rebase_admin`, para que as leituras com escopo de proprietário de usuários autenticados possam usar o índice de proprietário. Veja [Requisições de administrador e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` remove a política de linha de base de servidor ou administrador de todas as tabelas. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` também define `request.jwt.claims` e `request.jwt.claim.*`, para que políticas escritas com `auth.uid()` identifiquem o chamador. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | O que a inicialização faz quando outro login puder alternar para a role da requisição: `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Caminho base para todas as rotas de API. O cliente deve ser configurado com o mesmo valor — veja [Alterando `basePath`](#alterando-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve os ativos estáticos/administrativos do bundle a partir deste processo. Desative quando houver uma CDN à frente. | `true` |
| `REBASE_HISTORY` | Registra o [histórico de alterações de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Compactação gzip/brotli nas respostas. | `true` |
| `REBASE_PUSH` | `true` ativa as [notificações push](/docs/backend/push-notifications/): as rotas `/api/push`, a tabela `rebase.push_subscriptions` e `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | O par de chaves VAPID com o qual as mensagens push são assinadas. Fora de produção, um par é gerado e mantido em `.rebase-dev-secrets.json` quando não configurado; em produção, o push permanece desativado sem elas. | — |
| `REBASE_VAPID_SUBJECT` | Um endereço `mailto:` ou URL `https://` que os serviços de push podem contatar. O padrão é a origem de um `REBASE_PUBLIC_URL` em `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Tamanho máximo do corpo da requisição, **em bytes** (`10485760`, e não `10MB` — um valor que não seja número recusa a inicialização em vez de remover o limite silenciosamente). `0` desativa o limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | A superfície OpenAPI. Três estados. Indefinido, em todos os ambientes: `/api/docs` é servido aos chamadores para os quais `GET /api/schema/tables` descreve tabelas, cada um recebendo o documento das tabelas descritas, e não há Swagger UI. `true` publica o documento inteiro para todos, com a **UI** do Swagger em `/api/swagger` fora de produção (nunca em produção). `false` mantém o documento protegido pelo controle de admin. | — |
| `REBASE_METRICS` | Expõe métricas Prometheus em `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Adiciona `includeSubDomains` ao cabeçalho `Strict-Transport-Security`, para que os navegadores recusem HTTP simples em todos os subdomínios do host por seis meses — incluindo hosts que este processo não atende. Ative apenas quando todos os subdomínios do domínio forem exclusivos em HTTPS. Qualquer valor que não seja `true`/`false` recusa a inicialização. Veja [Cabeçalhos de segurança](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer que protege `/metrics`. Se indefinido, deixa o endpoint aberto a qualquer entidade que possa acessar a porta — aceitável em uma rede privada, mas não em uma pública, e os logs de inicialização alertam sobre isso. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer com o esquema das tabelas na inicialização. `ensure` (o padrão, em todos os lugares — incluindo produção) executa a passagem **aditiva**: cria tabelas, colunas e tipos enum ausentes, nunca descartando ou reescrevendo nenhum. `none` não altera o esquema das tabelas declaradas, mas as próprias tabelas do framework (auth, chaves de API, jobs, cron) ainda são criadas e mantidas atualizadas; `REBASE_PROVISION=false` também desativa essas. A imagem publicada aceita apenas essas duas opções e **recusa a inicialização com `push`**. Em uma [implantação dividida](/docs/deployment/split-processes), exatamente um processo pode provisionar, portanto, qualquer outra role deve definir `none` ou a inicialização será recusada. | `ensure` |
| `REBASE_PROVISION` | `false` faz com que o runtime não altere nada em seu banco de dados: nenhuma tabela, coluna, índice, função, gatilho (trigger), política, role ou permissão, na inicialização ou posteriormente, incluindo as do próprio framework. Em vez disso, informa o que está faltando pelo nome. Para bancos de dados em que apenas o seu processo de mudança tem autorização para alterar. Veja [Quando apenas seu processo de mudança pode alterar o banco de dados](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Apenas `true` e `false` são aceitos. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa a inicialização quando o banco de dados foi provisionado pela última vez a partir de um conjunto diferente de tabelas daquele em que este processo foi compilado. Indefinido (ou qualquer valor diferente de `true`/`1`) apenas emite um aviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Recusa a inicialização quando um arquivo de função ou cron lança um erro ou falha no parse durante a importação, nomeando cada arquivo e o motivo, para que um rolling deploy mantenha a versão antiga servindo. Uma reinicialização também segue essa regra. Indefinido (ou qualquer valor diferente de `true`) pula o arquivo e serve o restante. Um arquivo importado com sucesso que não exporta nenhuma função ou job é sempre ignorado, e não recusado. | skip |
| `REALTIME_CDC` | Captura de alterações em nível de banco de dados: `auto` (lê alterações do WAL onde o banco de dados permitir, caso contrário usa triggers, ou faz fallback para nível de aplicação, registrando cada fallback como info), `trigger` (força o uso de triggers, alerta se for impossível), `wal` (lê alterações do write-ahead log em vez de triggers; requer `wal_level=logical` e uma role autorizada para replicação, recorrendo a `trigger` caso contrário), `off`. Veja [Realtime](/docs/backend/realtime-cdc/). Prevalece sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instâncias para canais de transmissão (broadcast) e presença: `memory` ou `postgres`. Ignorado quando `realtime.bus` recebe um transporte já instanciado. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quantas inscrições um único socket de realtime pode manter; a seguinte é recusada com `TOO_MANY_SUBSCRIPTIONS`. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Prevalece sobre `realtime.maxSubscriptionsPerSocket`. Veja [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Quantos sockets de realtime um usuário, ou uma chave de API, pode manter abertos em uma única instância do servidor. Sockets com impersonação de administrador contam contra o administrador. O próximo login é recusado com `TOO_MANY_SOCKETS` e o socket fechado (4002); o SDK continua tentando, conectando-se assim que outro fechar. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Prevalece sobre `realtime.maxSocketsPerUser`. | Sem limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | O tempo máximo que uma alteração aguarda pela re-busca (refetch) que a entrega aos inscritos ativos, em ms. Um refetch aguarda por 300 ms sem alterações, e no máximo este tempo sob um fluxo constante de gravações. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Prevalece sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Por quanto tempo o total de uma inscrição de lista grande pode ser reutilizado antes de ser recalculado, em ms; frames que o reutilizam carregam `meta.totalAsOf`. Indefinido, cada frame realiza a contagem. Prevalece sobre `realtime.recountIntervalMs`. | Indefinido |
| `REALTIME_RECOUNT_MIN_ROWS` | O menor total anterior ao qual `REALTIME_RECOUNT_INTERVAL_MS` se aplica; listas menores têm contagem feita a cada frame. Prevalece sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores `localhost`/loopback sob `NODE_ENV=production`. Desativado por padrão, para que uma inicialização em produção falhe expressamente em vez de tentar conectar-se a um banco de dados inexistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` executa a aplicação do esquema e finaliza sem abrir um socket — o formato ideal para um Job de migração, a partir da mesma imagem e do mesmo bundle que o servidor subsequente. Ele também cria as tabelas que um processo ativo criaria no primeiro uso, e não inicializa nenhum cron ou fila de jobs. Um valor vazio é considerado *indefinido*, de modo que um `${SOMETHING}` não substituído em um arquivo compose não transforme uma implantação comum em uma que apenas migra e se recusa a servir. Recusado em conjunto com `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Um caminho de arquivo. Uma execução de provisionamento (`REBASE_PROVISION_ONLY=true`) grava nele todas as alterações de esquema realizadas, em ordem, como um script SQL para revisão e aplicação com `psql`. Linhas de dados gravadas não são incluídas. Recusado em um processo que serve tráfego. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que uma máquina — um agente, um job de CI — *aplique* uma alteração de esquema via `/api/admin/schema`, e não apenas planeje uma. Desativado a menos que solicitado: a credencial que realizaria tal alteração é a mais propensa a estar armazenada em uma variável de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Quanto tempo uma função customizada pode executar antes que sua requisição seja abortada. Mesmo ajuste que a opção `functionsTimeoutMs`. `0` desativa o limite. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz com que uma rejeição de promise não tratada finalize o processo em vez de apenas registrá-la em log. Ativado sob um orquestrador que fará o reinício; desativado onde uma reinicialização for pior que um vazamento. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Suprime o aviso de inicialização em uma plataforma que o runtime detecta como scale-to-zero (escala até zero), onde um temporizador acionado em uma instância ociosa não dispararia em instância alguma. Não altera mais nada: defina-o quando você mantiver pelo menos uma instância em execução contínua. | — |
| `TRUSTED_PROXY_HOPS` | Quantos proxies estão à frente deste servidor, permitindo que o rate limiter leia o endereço IP real do cliente a partir de `X-Forwarded-For`. Padrão seguro contra falhas `0`: sem proxy, confiar no cabeçalho permitiria que qualquer chamador forjasse uma identidade. | `0` |

:::note[O provisionamento na inicialização é aditivo e não é uma ferramenta de migração]
A rotina de inicialização executa de forma autônoma sem ninguém avaliando um diff, portanto ela nunca
removerá uma coluna, restringirá um tipo ou reescreverá uma tabela. É também por isso que a imagem recusa
`REBASE_MIGRATE_ON_BOOT=push`: um push completo calcula um diff e executará
`DROP COLUMN` sem hesitar, e uma reinicialização de contêiner jamais deve ser capaz de destruir uma
coluna de produção como efeito colateral de um reagendamento.

Alterações destrutivas ou de reformulação permanecem onde possam ser revisadas: `rebase db
generate` + `rebase db migrate`, ou `rebase db push` a partir de um checkout ou CI,
que simula a alteração (dry-run), recusa alterações destrutivas sem confirmação e
pode criar um backup previamente.
:::

### Implantações divididas

Uma única imagem e um único bundle podem ser inicializados várias vezes, cada um
atendendo a uma parte diferente do projeto. Uma linha para cada aqui, pois esta página se propõe
a listar todas as variáveis; o que cada combinação *monta e gerencia* — e quais
combinações recusam a inicialização — está em
**[Processos Divididos](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_ROLE` | Qual parte este processo atende: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Substitui a definição de se *este* processo executa os agendadores de cron. Indefinido segue o papel (role). | — |
| `REBASE_JOB_WORKERS` | Substitui a definição de se este processo executa workers de fila de jobs. Indefinido segue o papel. | — |
| `REBASE_FUNCTIONS_ONLY` | Serve apenas as funções customizadas indicadas neste processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Serve todas as funções customizadas, exceto as indicadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Para onde o processo da API encaminha uma requisição de função que ele próprio não atende. Em um `worker`, para onde suas próprias chamadas `rebase.functions` são direcionadas. Uma URL `http(s)`. | — |

### Superfície MCP

Um endpoint opcional (opt-in) do Model Context Protocol em `/mcp`, permitindo
que um cliente de IA leia e escreva neste projeto **como o usuário autenticado**. Desativado a menos que configurado e —
diferentemente de qualquer outra superfície — nenhum `REBASE_ROLE` o ativa: os
outros descrevem a estrutura de um processo, enquanto este representa uma decisão de conceder credenciais a softwares
de terceiros, devendo ser tomada por uma pessoa em vez de herdada da atribuição de um contêiner.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_MCP_ENABLED` | Disponibiliza a superfície MCP. Requer `REBASE_PUBLIC_URL`; sem ele, a superfície recusa a montagem e registra isso no log de inicialização. | `false` |
| `REBASE_PUBLIC_URL` | A origem externamente acessível desta implantação, por exemplo, `https://app.example.com`. A superfície MCP não pode deduzi-la — obter a origem do cabeçalho `Host` tornaria a identidade do emissor e a audiência com a qual seus tokens são verificados um valor fornecido pelo chamador. | — |
| `REBASE_MCP_VIEW` | Caminho para a visualização própria do MCP App do projeto (`rebase-view.html`, gerado por `rebaseMcpViewPlugin()`), servida ao Claude no lugar da exibição genérica para que suas views, campos e ações personalizadas sejam renderizados. Sem isso, o backend procura ao lado do frontend que ele serve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite o registro dinâmico de clientes OAuth (RFC 7591), para que um cliente possa se auto-cadastrar. Defina como `false` para exigir que os clientes sejam registrados previamente. | `true` |

### Edição de esquema ao vivo a partir de um bundle

Desativado a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esteja configurado. Um bundle compilado não possui
o código-fonte de `backend/schema` para edição; assim, com essas variáveis configuradas, o editor de esquema lê
o código a partir do repositório, envia commits com cada alteração de volta e executa seu DDL
neste banco de dados. Exclusivo para administradores e aplicado por uma pessoa, a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` determine o contrário. Um repositório definido sem
credenciais válidas recusa a inicialização. Veja
[Edição de esquema ao vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | O repositório do GitHub para o qual enviar commits de alterações de esquema, como `owner/name`. Configurá-lo é o que ativa o recurso. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | A branch na qual o commit é aplicado. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Onde `backend/schema` reside nesse repositório, relativo à raiz do repositório. Um caminho que saia do repositório recusa a inicialização, assim como a variável removida `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Um token refinado (fine-grained) com acesso de leitura e escrita ao conteúdo do repositório. Defina este ou as três variáveis `_GITHUB_APP_*`, nunca ambos. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | O ID de um GitHub App, para fazer commit como o app em vez de usar um token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | A instalação do aplicativo no repositório. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | A chave privada do aplicativo: PEM, PEM com quebras de linha escapadas ou base64. | — |

### Backups

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `BACKUP_SCHEDULE` | Expressão cron para backups agendados. Indefinido significa que os backups agendados estão desativados. | — |
| `BACKUP_DESTINATION` | Caminho local ou uma URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obrigatório com `BACKUP_SCHEDULE`, que se recusa a executar sem ele. `rebase db backup` recorre a `./backups` onde foi executado. | — |
| `BACKUP_RETENTION_DAYS` | Exclui backups com mais de N dias. Indefinido ou `0` mantém tudo. | — |
| `BACKUP_KEEP_MINIMUM` | Sempre retém pelo menos N dos backups mais recentes, independentemente da retenção definida. | — |
| `PG_DUMP_PATH` | Substitui o binário `pg_dump` — deve ser a versão principal do servidor ou mais recente. | — |
| `PG_RESTORE_PATH` | Substitui o binário `pg_restore`. | — |
| `PSQL_PATH` | Substitui o binário `psql` que `rebase db restore --clean` executa para fazer a restauração em uma única transação. | — |
| `PG_DUMPALL_PATH` | Onde `pg_dumpall` reside, caso não esteja no `PATH`. Sem ele — e sem as ferramentas de cliente do PostgreSQL instaladas —, o backup de globais falha com um erro indicando esta variável. | — |

A imagem oficial do runtime (`rebasepro/server`) inclui as ferramentas de cliente do PostgreSQL 18,
de modo que um backup agendado é executado nela contra qualquer servidor até o Postgres 18.
Fora da imagem, instale-as você mesmo (`apt-get install postgresql-client-18`,
`brew install libpq`).

Os backups contêm segredos e dados de identificação pessoal (PII). Use um destino privado com
criptografia em repouso (encryption-at-rest).

### Entrega de bundles

Uma implantação gerenciada não inclui seu código na imagem: o runtime busca um
bundle na inicialização. Essas variáveis definem qual e de que forma.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já extraído. O que o `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | De onde buscar o arquivo do bundle, quando não houver um local. | — |
| `REBASE_BUNDLE_TOKEN` | A credencial bearer para essa busca. Trate-a como um segredo: é o que autoriza um locatário (tenant) a baixar seu próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Onde um bundle obtido é extraído. Deve ter permissão de escrita e deve persistir entre a busca e a inicialização. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionais que a imagem do runtime fornece ao bundle, além dos declarados por ele mesmo. | — |

### Vinculações de recursos (Resource bindings)

Todo banco de dados, bucket e tópico declarado por um projeto em `backend/resources.ts` é
vinculado por variáveis de ambiente nomeadas com base nele. Os nomes base estão abaixo; um
recurso não padrão anexa `__` e sua chave em maiúsculas, portanto um bucket chamado
`media` lê `S3_BUCKET__MEDIA`. O `rebase status`
 exibe, por recurso,
a variável exata que está sendo lida e se ela está configurada.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_DRIVER` | O pacote npm que implementa o driver de uma fonte de dados, quando não for o padrão do Postgres. Com sufixo por fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | A string de conexão para um tópico declarado. Com sufixo por tópico. | — |

### O ambiente próprio da CLI

Lido por `rebase`, e não pelo servidor. Nada aqui afeta uma implantação.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BASE_URL` | Para onde `rebase api-keys`, `rebase storage` e `rebase auth reset-password` enviam a service key, no shell ou no `.env`. Defina quando o servidor executar de outra forma além de `rebase dev` neste projeto: `rebase start`, um contêiner, outro host. Indefinido, eles usam o servidor registrado por `rebase dev` enquanto esse servidor estiver em execução, e não enviam nada quando não estiver. | — |
| `REBASE_SERVICE_KEY` | A service key com a qual esses comandos se autenticam, lida do `.env`: a mesma variável que o servidor lê (veja acima). | — |
| `SERVICE_KEY` | Um nome mais antigo para essa chave. Quando o `.env` a define, `rebase api-keys` e `rebase storage` a leem no lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qual arquivo `.env` a CLI lê e grava, quando não for o do próprio projeto. | — |
| `REBASE_ROOT_RULES` | `0` impede `rebase init` e `rebase skills install` de gravarem as regras do projeto nos arquivos `CLAUDE.md` e `AGENTS.md` na raiz do repositório, para raízes cujos arquivos de agentes você gerencia manualmente. | on |
| `REBASE_CLOUD_URL` | O plano de controle com o qual o `rebase cloud` se comunica. | — |
| `REBASE_CLOUD_EMAIL` | A conta com a qual `rebase cloud login` autentica, em vez de solicitar interativamente. | — |
| `REBASE_CLOUD_PASSWORD` | A senha dessa conta, para que um cofre de segredos possa fornecê-la sem que vá parar no histórico do shell. | — |
| `REBASE_TOKEN` | Um token gerado por `rebase cloud tokens create`. Quando definido, qualquer comando `rebase cloud` autentica-se com ele em vez da sessão de `rebase cloud login`, e nunca lê ou grava a sessão armazenada. Em um diretório vinculado por `rebase cloud init --claim`, ele é desconsiderado em favor do token do próprio projeto quando não possui escopo sobre o projeto. É a forma recomendada de executar `rebase cloud` em CI — veja [CI e agentes](/docs/deployment/cloud/#ci-and-agents). O [servidor MCP](/docs/ai/mcp/) o repassa para a CLI que suas ferramentas cloud inicializam, e nunca o envia para a aplicação: defina `REBASE_API_TOKEN` para isso. | — |
| `REBASE_DEBUG` | `1` imprime os detalhes do erro e da requisição subjacentes em vez da mensagem curta. A primeira coisa a definir quando um comando `rebase cloud` falhar sem informações claras. | — |
| `REBASE_ATLAS_DEV_URL` | Banco de desenvolvimento vazio para `db push` e `db generate`. O nome permanece para projetos existentes. O Rebase não gerencia um banco indicado aqui e recusa a URL de destino. O PGlite gerenciado recebe um banco temporário em memória. Use esta opção sem `CREATE DATABASE`; `db migrate` não precisa dela. | `<db>_dev_diff` |
| `PTAH_TRUST_REPLAY_SQL` | Com PostgreSQL externo, inclusive um serviço Docker Compose local, o Ptah pode reexecutar SQL para `db push`, `db push --dry-run` e `db generate`. Use `PTAH_DEV_SERVER_DISPOSABLE=1` apenas quando puder descartar todo o servidor de desenvolvimento. Em um servidor compartilhado, `PTAH_TRUST_REPLAY_SQL=1` permite a execução com os privilégios da conexão de desenvolvimento. Ative a opção somente se confiar no SQL. O PGlite gerenciado já é descartável. | — |
| `PTAH_DEV_SERVER_DISPOSABLE` | Defina como `1` somente se todo o servidor de desenvolvimento puder ser descartado. O Rebase define isso automaticamente para seu servidor PGlite de desenvolvimento gerenciado. | não definido |
| `PTAH_ATLAS_ALLOW_UNMATCHED_EXCLUDE` | O Rebase define isso para que a mesma lista de exclusões funcione mesmo quando um objeto estiver ausente. Não é preciso definir manualmente. | `1` durante comandos do banco de dados |
| `PTAH_ATLAS_MIGRATE_DIFF_EXCLUDE` | O Rebase define isso a partir dos seletores de objetos protegidos durante `db generate`. Não é preciso definir manualmente. | gerado |
| `PTAH_ATLAS_MIGRATE_DIFF_INCLUDE` | O Rebase define isso a partir dos seletores de objetos declarados durante `db generate`. Não é preciso definir manualmente. | gerado |
| `REBASE_PTAH_DEV_PGLITE` | Marcador interno da conexão de desenvolvimento PGlite gerenciada. O Rebase o define automaticamente. | não definido |
| `REBASE_DEV_NO_DB` | `rebase dev` não inicializa nenhum banco de dados e não provisiona nada — você fornece o seu próprio. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento do frontend, que caso contrário `rebase dev` deriva do caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Quanto tempo o `rebase dev` aguarda o backend se anunciar antes de informar que ele não iniciou. `0` desativa o relatório. | `30000` |
| `DATABASE_PASSWORD` | A senha que `rebase dev --docker` insere na string de conexão derivada do `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenção comum entre ferramentas. Definido para qualquer valor diferente de `0`, a CLI não envia telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | O mesmo, especificamente para o Rebase. Não requer arquivo, motivo pelo qual é a variável ideal para usar em CI e em imagens. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Para onde a telemetria é enviada, no caso de um coletor auto-hospedado. | — |

## Segredos em desenvolvimento

`JWT_SECRET` é obrigatório em produção. Ele e `REBASE_SERVICE_KEY` são
gerados para você fora dela, para que você possa começar sem configurar nada.

Esses valores gerados são armazenados em cache no `.rebase-dev-secrets.json`, ao lado
de `.rebase-dev-port` e `.rebase-dev-url` e ignorados pelo git junto com eles. Anteriormente, eles
eram gerados novamente a cada inicialização — fazendo com que reiniciar o servidor de desenvolvimento desconectasse você da
sua própria aplicação e invalidasse qualquer chave de API que você tivesse acabado de criar.

- Defina qualquer uma das variáveis explicitamente e a sua será usada; nada é armazenado em cache ou lido.
- Aponte o cache para outro local com `REBASE_DEV_SECRETS_FILE` — um caminho, e a
  única variável nesta seção que você definiria deliberadamente.
- Exclua o arquivo para renovar ambos os segredos. A próxima inicialização gerará um novo.
- Se o arquivo não puder ser gravado — digamos, em um contêiner somente leitura —, o servidor inicia
  mesmo assim com um segredo efêmero, exatamente como antes.

Nada é armazenado em cache em produção, ou sob um executor de testes. Em produção, nada
é gerado também: uma inicialização sem `JWT_SECRET` falha, identificando a variável, e
esse comportamento permanece inalterado:

```
The environment is not valid:
  JWT_SECRET: is required
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
    schemaDir: "./schema",     // The backend/schema directory: the tables, and what the schema editor writes
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

    enableSwagger: true,     // Publish the whole OpenAPI document at /api/docs to everyone

    logging: {
        level: "info"
    }
});
```

As mesmas opções,
sem `app`, `server` e `basePath` e com um `provision` obrigatório, constroem um
backend que não serve nada até que você o monte: `createRebaseBackend`. Veja
[Integração de Servidor Customizado](/docs/backend/custom-server/).

### Alterando `basePath`

`basePath` move todas as rotas de API, portanto o cliente deve ser informado da mesma coisa —
caso contrário, ele continuará solicitando `/api/...` e receberá 404 para tudo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel administrativo obtém isso do cliente fornecido a ele; nada mais precisa ser
configurado. Se você construir uma URL de requisição manualmente, concatene-a a partir do cliente em
vez de escrever `/api` você mesmo:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solução de Problemas

### Permissão Negada no Editor SQL (`permission denied for table <name>`)

* **Sintomas:** Consultas personalizadas executadas no editor SQL do Rebase Studio falham com `cause: error: permission denied for table <name>`, embora a visualização de planilha do CMS carregue os dados com sucesso.
* **Causa:** Por padrão, o Rebase tenta executar consultas do Editor SQL alternando temporariamente os papéis (roles) do banco de dados para corresponder ao papel de aplicação do usuário ativo (por exemplo, `SET LOCAL ROLE "admin"`). Se você estiver usando autenticação personalizada onde os papéis existem apenas em tabelas do banco de dados em vez de papéis reais do PostgreSQL, a troca de role falha ou os privilégios do banco de dados ficam ausentes. A visualização de planilha do CMS executa sob o usuário proprietário da conexão padrão e ignora isso.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` à sua configuração `.env` do backend. Isso força o Rebase a executar consultas do Editor SQL usando os privilégios do proprietário da conexão (geralmente um superusuário/owner). O Editor SQL então informa, acima dos resultados, que eles foram lidos como o proprietário da conexão, e desabilita seu seletor de papéis.

### Falha na Busca de Esquema do Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio falha ao carregar a árvore de esquema, ou o Editor SQL lança `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** O Rebase exige privilégios administrativos para consultar os catálogos de sistema do banco de dados e executar comandos administrativos. Se `adminConnectionString` não for fornecido ao bootstrapper, ou `getAdmin()` for sobrescrito para retornar `undefined`, essas operações falham.
* **Solução:** Certifique-se de que `adminConnectionString` esteja configurado durante a inicialização do bootstrapper do backend:
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
