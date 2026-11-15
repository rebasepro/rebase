---
sourceHash: fa28c44bef748bed
title: Ambiente e Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita por meio de variáveis de ambiente no arquivo `.env` na raiz do seu projeto.

> **Importante**: O Rebase valida as variáveis de ambiente com o **Zod** na inicialização. Se
> algo obrigatório estiver ausente ou malformado (uma URL que não é uma URL, uma porta que
> não é um número), o servidor recusa a inicialização e informa o nome da variável.
>
> O local onde o esquema reside depende de como você executa o backend. Um projeto inicializado
> pelo runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o
> esquema gerenciado pelo runtime (`loadBootEnv` em `@rebasepro/server`), que é a
> união de todas as tabelas abaixo. Um projeto que executou [`rebase eject`](/docs/cli)
> possui um `backend/src/env.ts` chamando `loadEnv({ extend })`, e pode adicionar suas próprias
> variáveis tipadas lá.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-------------|---------|
| `DATABASE_URL` | String de conexão do PostgreSQL. **Opcional em desenvolvimento** — se não definida, `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Obrigatória em todos os outros ambientes. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinar tokens JWT. Use uma string aleatória forte (mínimo de 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` é uma grafia do node-postgres, não da libpq.**
>
> O Rebase e o driver do Node a aceitam — criptografa, mas não verifica o
> certificado. O `psql`, `pg_dump`, `pg_restore` e Atlas não aceitam, e eles não
> degradam graciosamente: recusam-se a iniciar com `invalid sslmode value: "no-verify"`.
>
> Os comandos próprios do Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) reescrevem o valor para o equivalente `sslmode=require` antes de invocar o processo externo,
> para que funcionem com a URL conforme configurada. Ao usar o `psql` manualmente isso não acontece
> — substitua por `sslmode=require` lá, o qual criptografa sem verificar exatamente
> da mesma forma.

### Frontend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `VITE_API_URL` | URL da API do backend para o SDK tipado. **Defina apenas em desenvolvimento** — veja abaixo. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Client ID do Google OAuth. Habilita "Entrar com o Google". | — |


> **Deixe `VITE_API_URL` indefinida em builds de produção.**
>
> Em desenvolvimento, o frontend e o backend são origens separadas, então o servidor de
> desenvolvimento injeta isso. Em produção, o backend do Rebase serve a SPA, portanto a
> API é a própria origem da página e o cliente a resolve dessa forma por conta própria.
>
> Embutir uma URL absoluta em um bundle de produção funciona até o momento em que um segundo
> hostname aponta para a mesma aplicação: um domínio customizado carrega a página a partir de
> `example.com` e chama a API em `example.rebase.website`, o que é cross-origin, fazendo
> com que cada requisição falhe no preflight. Permitir a origem no CORS **não**
> resolve o problema — o cookie de atualização (refresh cookie) é `SameSite=Lax` e não é
> enviado cross-site, então você limparia os erros do console e continuaria com a
> autenticação quebrada. Se não definida, qualquer domínio que aponte para o app funciona sem nenhuma
> configuração de CORS.

### Backend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `PORT` | Porta para o servidor HTTP do backend. Lida pelo `rebase start`. O `rebase dev` lê **apenas do ambiente do shell** — um `PORT` no `.env` não é lido lá, pois a porta é resolvida antes do carregamento desse arquivo — e, caso contrário, vincula uma porta derivada do caminho do projeto, para que vários projetos possam ser executados ao mesmo tempo. `rebase dev --port` tem precedência sobre ambos, e o banner de inicialização informa qual nível foi utilizado. | `3001` |
| `LOG_LEVEL` | Verbosidade dos logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra o SQL por trás de uma linha `Failed query: [redacted]`. Cada instrução que falha é ocultada por padrão, porque uma consulta com falha carrega seus parâmetros vinculados — um e-mail, um hash de senha. Defina como `true` ao diagnosticar uma falha de DDL, RLS ou captura de alterações. Ignorado quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Lista separada por vírgulas de origens permitidas. **Obrigatória em produção** a menos que `FRONTEND_URL` esteja definida: uma inicialização em produção sem nenhuma das duas recusa a iniciar. Em desenvolvimento, ela é *adicionada* ao localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL do app frontend. Usada como alternativa a CORS_ORIGINS, em ambos os ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão com o banco de dados em nível de administrador (usada para introspecção de esquema e operações administrativas). O banco de dados que ela nomeia não é aquele que o console SQL considera o atual, nem o que uma nova branch copia por padrão: ambos são o banco de dados no qual a própria conexão da aplicação está (consulte `REBASE_BRANCH_PARENT_DATABASE` para um servidor em uma branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a troca de papéis (role-switching) do PostgreSQL no SQL Editor (útil para autenticação personalizada onde as roles do banco não estão mapeadas). O console SQL do Studio então informa que as linhas foram lidas como o proprietário da conexão, nomeia-o e desativa o seletor de papéis. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | O banco de dados a partir do qual a branch em que este servidor está rodando foi copiada. `rebase dev` o define em um checkout [alternado para uma branch](/docs/backend/branching/#cli-integration). Um servidor com ela mantém o registro de branches nesse banco de dados e copia novas branches a partir dele por padrão, para que o painel de Branches do Studio exiba as branches do banco de dados principal. | — |

#### CORS em desenvolvimento

O desenvolvimento permite **localhost, além de qualquer origem nomeada em `CORS_ORIGINS` (ou `FRONTEND_URL`)** — a mesma lista usada em produção, com localhost adicionado em vez de substituído. Dessa forma, a variável funciona da mesma maneira em ambos os ambientes, e os casos que precisam dela em desenvolvimento são os usuais:

```bash
# Um telefone na LAN, a máquina de um colega, um túnel ngrok,
# uma porta encaminhada do Codespaces — todas são origens não-localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não seja localhost nem esteja listada é recusada, e a recusa é
registrada em log **uma vez por origem** com a linha exata que permitiria o acesso. A recusa não
é mera cautela: a API envia credenciais, portanto refletir um `Origin`
arbitrário permitiria que qualquer site que o desenvolvedor visitasse fizesse
requisições autenticadas contra o servidor de desenvolvimento usando sua sessão e lesse as
respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `JWT_SECRET` | Segredo para assinatura de JWT (obrigatório em produção, gerado automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso de forma assimétrica (RS256), de modo que qualquer entidade que possua o JWKS possa verificar uma sessão sem conseguir emitir uma nova. Aceita uma PEM com quebras de linha reais, uma PEM com escapes `\n` ou base64 de toda a PEM. Sem isso, os tokens permanecem como HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` no cabeçalho do token e no JWKS. Altere sempre que a chave for alterada — a rotação depende da capacidade de distinguir a antiga da nova. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de vida do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de vida do refresh token. Deslizante — cada rotação o renova, controlando quanto tempo uma sessão sobrevive à **inatividade**. Defina `400d` para sessões que devam durar após uma longa ausência; os navegadores limitam o refresh cookie a esse teto. | `30d` |
| `ALLOW_REGISTRATION` | Permite que novos usuários se registrem (`true`/`false`). Fora de produção, o **primeiro** usuário sempre pode se registrar, não importando esta configuração — uma tabela de usuários vazia precisa admitir alguém, e esse alguém se torna o administrador. Em produção (`NODE_ENV=production`), essa janela é fechada: uma tabela vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma primeira conta criada via registro aberto é uma conta comum, e o administrador é definido com `REBASE_ADMIN_EMAIL` abaixo ou atribuído via service key. O `.env.example` do scaffold o define como `true`; o padrão do framework é desativado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Chave de desativação geral (kill switch). Fecha a janela de bootstrap do primeiro usuário que `ALLOW_REGISTRATION=false` deliberadamente deixa aberta fora de produção, de modo que o registro seja bloqueado mesmo contra um banco de dados vazio. Combine com `REBASE_ADMIN_EMAIL` abaixo, caso contrário o deploy não terá como gerar seu primeiro usuário autenticado. Todos os artefatos de deploy fornecidos o definem. | — |
| `REBASE_ADMIN_EMAIL` | E-mail da primeira conta de administrador, criada na inicialização **enquanto a tabela de usuários ainda estiver vazia** e nunca após isso. É assim que um deploy em produção obtém seu administrador: o operador define a primeira conta em vez de disputar o acesso com a internet aberta. A inicialização avisa quando a tabela estiver vazia em produção e este campo não estiver definido. | — |
| `REBASE_ADMIN_PASSWORD` | Senha para essa conta. Deve ter pelo menos 12 caracteres, caso contrário será recusada e a conta não será criada. Altere-a após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Criptografa todos os segredos TOTP armazenados. Se não definida, os segredos são criptografados com `JWT_SECRET` e a inicialização exibe um aviso único — portanto, rotacionar `JWT_SECRET` desconecta todos os usuários *e* deixa todos os autenticadores cadastrados ilegíveis. Defina uma chave dedicada (mais de 32 caracteres aleatórios) antes que qualquer pessoa se cadastre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave da qual se está fazendo a rotação *antiga*. Defina ambas durante uma rotação: novos segredos são gravados com `MFA_ENCRYPTION_KEY` e os existentes continuam legíveis, de modo que ninguém fique bloqueado de sua própria conta durante a transição. Remova-a assim que todos os segredos tiverem sido recriptografados. | — |
| `ALLOW_ANONYMOUS` | Habilita login anônimo (`POST /api/auth/anonymous`). Opcional (opt-in), e deliberadamente não condicionado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina como `false` para uma superfície de leitura totalmente pública — RLS ainda se aplica. | `true` |
| `AUTH_DEFAULT_ROLE` | Role atribuída a um usuário recém-registrado quando nenhuma é informada. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Disponibiliza `POST /api/auth/find-user`, que resolve um e-mail para um perfil público mínimo (`uid`, `displayName`, `photoURL`) para fluxos de convite por e-mail. Apenas chamadores autenticados têm acesso, e o endpoint nunca retorna o e-mail, papéis ou metadados do usuário encontrado. Desativado por padrão: trata-se de uma superfície de enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` no refresh cookie: `Strict`, `Lax` ou `None`. `None` requer HTTPS e é indicado apenas para um frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Flag `Secure` no refresh cookie. Seguro por padrão; use `AUTH_COOKIE_SECURE=false` para http puro — um deploy em um endereço de LAN onde o navegador de outra forma descartaria o cookie e a sessão morreria na expiração do token de acesso sem nenhum erro. Isso gera um aviso na inicialização. `http://localhost` não precisa disso. | `true` |
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
| `GITLAB_CLIENT_ID` | Client ID do GitLab OAuth. O `baseUrl` de uma instância self-hosted não possui variável de ambiente correspondente — configure o GitLab no bloco `auth` para esse fim. | — |
| `GITLAB_CLIENT_SECRET` | Client Secret do GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID do Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client Secret do Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID do Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client Secret do Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID do Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client Secret do Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Apple Services ID, para login via web. É público e disponibilizado em `GET /auth/config`. A Apple não possui um client secret estático, pois o Rebase assina um JWT ES256 de curta duração para cada troca de token. Portanto, a Apple precisa de `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, além deste ou de `APPLE_BUNDLE_IDS`, não configurando nada sem eles. | — |
| `APPLE_BUNDLE_IDS` | Lista separada por vírgulas de bundle IDs dos apps nativos de iOS/macOS cujos códigos do Sign in with Apple são aceitos. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, o emissor (issuer) do JWT. | — |
| `APPLE_KEY_ID` | Key ID da chave privada registrada na Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, incluindo quebras de linha (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave estática da API de administração. Bypassa a autenticação JWT normal para chamadas servidor-a-servidor quando enviada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | A chave pública da plataforma de hospedagem (PEM, EC P-256) contra a qual os tokens de plataforma `rpt_` são validados; múltiplos blocos PEM durante uma rotação de chave. A plataforma a define no deploy, e ela não contém dados secretos. Em conjunto com `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que a barreira de administração aceite um token de plataforma para `cron:read`, e para mais nada. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | O ID do projeto com o qual o `aud` de um token de plataforma deve coincidir, para que um token emitido para outro projeto seja recusado. Com apenas uma das duas variáveis definidas, o servidor inicializa, registra um aviso e responde a qualquer token `rpt_` com `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Onde os contadores de limite de taxa (rate-limit) residem, para rotas de autenticação e para `rateLimit` em funções customizadas: `memory` (por processo) ou `sql` (compartilhado entre réplicas). Um processo não pode ver sua própria contagem de réplicas, então um deploy com pares precisa declarar isso — três réplicas no padrão aplicam três vezes o limite. Qualquer outro valor **recusa a inicialização** em vez de usar fallback, incluindo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Disponibiliza o fluxo de link de login sem senha (magic link). Requer um serviço de e-mail configurado, caso contrário o link não tem para onde ir. | `false` |
| `AUTH_EMAIL_OTP` | Disponibiliza login sem senha por meio de um código de seis dígitos enviado por e-mail. Mesma exigência de serviço de e-mail citada acima. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Cadastro sem senha: uma requisição de magic link ou código por e-mail para um endereço desconhecido cria a conta, desde que o cadastro esteja aberto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | O que fazer quando um refresh token é reutilizado fora de sua janela de reuso permitida: `reject` (recusa, mantém a sessão) ou `revoke-session` (encerra a sessão). Qualquer outro valor falha a inicialização. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Cadastro com confirmação prévia: nenhum login por senha é permitido até que o endereço de e-mail seja verificado. Requer e-mail configurado; a inicialização falha sem ele. | `false` |
| `CAPTCHA_PROVIDER` | Ativa a verificação de captcha nas rotas de autenticação: `turnstile` ou `hcaptcha`. Não definido significa sem captcha. | — |
| `CAPTCHA_SECRET` | O segredo do provedor, usado no servidor para verificar o token enviado pelo navegador. Obrigatório quando `CAPTCHA_PROVIDER` estiver definido. | — |
| `CAPTCHA_ROUTES` | Lista separada por vírgulas de rotas de autenticação a serem protegidas (por exemplo, `register,login`). Não definido protege o conjunto padrão do provedor. | — |

### Storage

:::caution[Storage não possui segurança a nível de linha, portanto necessita de um modelo de acesso]
Tabelas são protegidas pelo RLS do Postgres. Armazenamento de objetos não possui equivalente —
as chaves compartilham um único namespace plano —, portanto, com um bucket configurado e nenhum modelo de acesso,
o servidor **recusa a inicialização em produção**. Atenda a esse requisito com exatamente uma das opções:
um hook `storageAuthorize` exportado de `backend/storage.ts` (fornecido por padrão no scaffold),
`STORAGE_PUBLIC_READ` ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de armazenamento: `local`, `s3` ou `gcs`. Em produção, `local` desativa o storage a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para o storage local. Um caminho relativo é lido a partir do diretório em que o servidor roda: a raiz do projeto em `rebase dev`, `backend/` em um servidor gerado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite storage local em produção — somente com um volume persistente mantendo `STORAGE_PATH` e os diretórios `<STORAGE_PATH>__<key>` dos buckets locais nomeados ao lado dele | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante os quais a URL de download de um arquivo privado funciona — o token inserido por `getSignedUrl()`. No máximo `604800` (uma semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Tamanho máximo de arquivo aceito pela fonte, em bytes, em qualquer rota de upload — `__<KEY>` para uma fonte nomeada. Um valor que não seja um número inteiro de bytes recusa a inicialização | `52428800` (50 MB) |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região da AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso da AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta da AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Força URLs no estilo path-style para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto GCP. Geralmente inferido das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para um arquivo de chave de conta de serviço. Omita no GCP, onde o Workload Identity fornece as credenciais. | — |
| `STORAGE_PUBLIC_READ` | Disponibiliza todos os objetos publicamente, sem token. Apenas para um bucket que seja genuinamente uma CDN pública. Uma das três maneiras de satisfazer a trava de inicialização abaixo. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que qualquer usuário autenticado leia, grave, liste e exclua todos os objetos. Nomeado como `INSECURE` no objeto de configuração por um motivo: é defensável apenas em uma aplicação single-tenant onde todas as contas têm permissão total sobre todos os arquivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Armazena em cache as versões de imagens geradas (redimensionamentos, conversões de formato) em vez de processá-las a cada requisição. | `false` |

### E-mail (Opcional)

| Variável | Descrição |
|----------|-------------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Habilitar conexão segura (`true`/`false`) |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `SMTP_FROM` | Endereço do remetente para e-mails do sistema |
| `SMTP_NAME` | Nome de exibição do remetente |
| `APP_NAME` | Nome do produto usado nos assuntos e corpos dos e-mails (padrão: `Rebase`) |
| `EMAIL_LOGO_URL` | Logotipo exibido no topo dos templates de e-mail padrão. PNG ou JPG com URL `http(s)` absoluta — clientes de e-mail removem SVG e bloqueiam URIs `data:`. Não definido, um app ainda nomeado `Rebase` recebe a marca do Rebase e um renomeado não recebe nada |

### Pool de conexões do banco de dados

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `DB_POOL_MAX` | Limite máximo de conexões no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milissegundos em que uma conexão ociosa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milissegundos a aguardar por uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (não agrupada em pool). O recurso de [Realtime](/docs/backend/realtime) requer uma: `LISTEN`/`NOTIFY` não sobrevivem a um pooler transacional como o PgBouncer e, sem isso, as notificações de alteração são desativadas com um aviso em vez de serem perdidas silenciosamente. O [job worker](/docs/backend/jobs) também mantém seu `LISTEN` de ativação nessa conexão. Preenche o `directConnectionString` do adaptador Postgres quando este não estiver definido. | — |
| `DATABASE_READ_URL` | Réplica de leitura, como um hot standby. Quando aponta para outro servidor, leituras autenticadas (listagens, linhas individuais, contagens, agregações) são atendidas por lá sob a mesma segurança a nível de linha; gravações, login, realtime, crons, jobs, o console SQL e `rebase.sql` permanecem no primário. Um usuário que acabou de gravar lê do primário por `REBASE_READ_STICKY_MS`, e todos leem do primário enquanto a réplica estiver atrasada em mais de `REBASE_READ_MAX_LAG_MS` ou falhando. Preenche o `readConnectionString` do adaptador Postgres quando não estiver definido; até a versão 0.28 (inclusive), o pool da réplica era aberto e nunca lido. | — |
| `REBASE_READ_STICKY_MS` | Após uma gravação, quanto tempo as leituras do mesmo usuário continuam indo para o primário, para que um salvamento seguido de uma listagem mostre os dados recém-salvos. Por instância de servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Limite de atraso (lag) da réplica a partir do qual todas as leituras vão para o primário. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa por um pooler em modo transacional como o PgBouncer. O pool não envia `search_path` ou `statement_timeout` na conexão (o pooler os recusaria ou descartaria) e define ambos em cada transação; a inicialização define para a role do banco um `search_path` padrão de `public` para instruções fora de uma transação. `DATABASE_DIRECT_URL` torna-se obrigatória, e o realtime, o sinalizador do job worker, criação de índices, branching e o console SQL usam-na. A URL da réplica também é considerada como pooled. Use `DATABASE_POOLED__<KEY>` para outra fonte de dados. | — |
| `REBASE_DB_POOL_MAX` | Um teto para todos os pools no processo, aplicado independentemente do solicitado por cada um. Apenas dígitos puros: um valor malformado é ignorado em vez de serializar o servidor silenciosamente. | — |

### Comportamento em tempo de execução (Runtime)

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem oficial do
servidor. Um projeto que executou eject gerencia essas decisões em seu próprio código.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` executa a [auditoria agendada de segurança a nível de linha](/docs/rls-check#running-it-on-a-schedule), que reporta tabelas servidas sem policies. O projeto deve declarar `@rebasepro/rls-check` entre suas dependências: o runtime não traz uma cópia embutida e, sem o pacote, a inicialização falha informando o nome da dependência faltante. `false` mantém a verificação desativada neste processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | A role do Postgres sob a qual requisições autenticadas e anônimas são executadas. Forneça uma para cada projeto em um cluster compartilhado. O banco de dados registra a role sob a qual opera, e uma inicialização configurada para outra recusa-se a iniciar até que `rebase db request-role migrate` a transfira. Consulte [Executando em um banco de dados existente ou compartilhado](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` cria a role de requisição e permite que a conexão alterne para ela; `never` deixa ambas a seu encargo e apenas as verifica. | `auto` |
| `REBASE_RLS_GRANTS` | O que o Rebase concede à role de requisição: `schema` (todas as tabelas nos schemas servidos, mais privilégios padrão), `managed` (apenas as tabelas servidas) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe as policies permissivas do Rebase à(s) role(s) de requisição, para que outras roles que leiam as mesmas tabelas não recebam permissões delas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` define as policies que apenas o contexto do servidor ou um admin podem cumprir `TO public`, e executa admins sob a role de requisição. Por padrão, são `TO rebase_admin`, para que as leituras no escopo de proprietário dos usuários autenticados possam usar o índice de proprietário. Consulte [Requisições de administrador e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` remove a policy base de servidor-ou-administrador de todas as tabelas. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` também define `request.jwt.claims` e `request.jwt.claim.*`, para que policies escritas com `auth.uid()` identifiquem o chamador. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | O que fazer na inicialização quando outro usuário do banco puder assumir a role de requisição: `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Caminho base para todas as rotas da API. O cliente deve ser configurado da mesma forma — consulte [Alterando `basePath`](#alterando-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve os recursos estáticos/administrativos do bundle a partir deste processo. Desative quando houver uma CDN à frente. | `true` |
| `REBASE_HISTORY` | Registra o [histórico de alterações de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respostas comprimidas com gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Tamanho máximo do corpo da requisição, **em bytes** (`10485760`, não `10MB` — um valor que não seja número recusa a inicialização em vez de remover o limite silenciosamente). `0` desativa o limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Superfície da OpenAPI. Tri-state. Se não definido, em qualquer ambiente: `/api/docs` é servido aos chamadores para os quais `GET /api/schema/tables` descreve tabelas, cada um recebendo a documentação das tabelas a que tem acesso, e não há interface Swagger UI. `true` publica o documento completo para todos, com a Swagger **UI** em `/api/swagger` fora de produção (nunca em produção). `false` mantém o documento protegido sob a barreira de admin. | — |
| `REBASE_METRICS` | Expõe métricas do Prometheus em `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Adiciona `includeSubDomains` ao cabeçalho `Strict-Transport-Security`, fazendo com que os navegadores recusem HTTP simples em todos os subdomínios do host por seis meses — incluindo hosts não servidos por este processo. Ative apenas quando todos os subdomínios forem exclusivamente HTTPS. Qualquer valor diferente de `true`/`false` recusa a inicialização. Consulte [Cabeçalhos de segurança](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token de proteção para `/metrics`. Não definido deixa o endpoint acessível a qualquer um que alcance a porta — aceitável em rede privada, mas não em rede pública, conforme avisado nos logs de boot. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer com o esquema das tabelas na inicialização. `ensure` (o padrão em qualquer lugar, incluindo produção) executa o passo **aditivo**: cria tabelas, colunas e tipos enum ausentes, sem nunca remover ou reescrever nada. `none` não altera o esquema das tabelas declaradas, mas as tabelas do próprio framework (auth, API keys, jobs, cron) continuam sendo criadas e atualizadas; `REBASE_PROVISION=false` desativa essas também. A imagem oficial aceita apenas essas duas opções e **recusa a inicialização em `push`**. Em um [deploy dividido](/docs/deployment/split-processes), exatamente um processo pode fazer provisionamento, portanto todos os outros papéis devem definir `none` sob risco de falha no boot. | `ensure` |
| `REBASE_PROVISION` | `false` faz com que o runtime não altere absolutamente nada no banco de dados: nenhuma tabela, coluna, índice, função, trigger, policy, role ou permissão, na inicialização ou posteriormente, incluindo os do próprio framework. Em vez disso, ele relata nominalmente o que está faltando. Indicado para bancos de dados onde somente seu processo de migração pode fazer alterações. Consulte [Quando apenas seu processo de alteração pode modificar o banco](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Aceita apenas `true` e `false`. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa a inicialização se o banco de dados foi provisionado pela última vez a partir de um conjunto de tabelas diferente daquele com o qual este processo foi compilado. Não definido (ou qualquer valor diferente de `true`/`1`) apenas emite um aviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Recusa a inicialização se um arquivo de função ou cron lançar exceção ou falhar no parse durante a importação, identificando cada arquivo e a razão, de modo que um deploy contínuo (rolling deploy) mantenha a versão antiga em execução. Um reinício também segue essa regra. Não definido (ou diferente de `true`) ignora o arquivo com erro e serve o restante. Um arquivo que importa sem erros mas não exporta nenhuma função ou job é sempre ignorado, não recusado. | skip |
| `REALTIME_CDC` | Captura de alterações em nível de banco de dados (CDC): `auto` (lê alterações do WAL onde o banco permitir, senão usa triggers, senão faz fallback para nível de aplicação, registrando cada fallback como info), `trigger` (força triggers, emite aviso se impossível), `wal` (lê alterações do log de write-ahead em vez de triggers; requer `wal_level=logical` e role com permissão de replicação, faz fallback para `trigger` caso contrário), `off`. Consulte [Realtime](/docs/backend/realtime-cdc/). Tem precedência sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte inter-instâncias para canais de broadcast e presence: `memory` ou `postgres`. Ignorado caso `realtime.bus` receba uma instância já construída de transporte. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quantas inscrições um socket de realtime pode manter; a próxima é recusada com `TOO_MANY_SUBSCRIPTIONS`. Deve ser um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSubscriptionsPerSocket`. Consulte [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Quantos sockets de realtime um usuário, ou uma chave de API, pode manter abertos em uma única instância do servidor. Sockets de personificação de um administrador contam contra o administrador. O login do próximo socket é recusado com `TOO_MANY_SOCKETS` e o socket fechado (4002); o SDK continua tentando reconectar, conseguindo entrar assim que outro fechar. Número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSocketsPerUser`. | Sem limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo máximo de espera de uma alteração antes do refetch que a entrega aos inscritos ativos, em ms. Um refetch aguarda 300 ms sem novas alterações, e no máximo este tempo sob um fluxo constante de gravações. Número inteiro positivo — qualquer outro valor interrompe o servidor no boot. Tem precedência sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Tempo em que a contagem total de uma assinatura de listagem grande pode ser reutilizada antes de ser recalculada, em ms; frames que a reutilizam incluem `meta.totalAsOf`. Não definido conta a cada frame. Tem precedência sobre `realtime.recountIntervalMs`. | Não definido |
| `REALTIME_RECOUNT_MIN_ROWS` | O menor total anterior ao qual `REALTIME_RECOUNT_INTERVAL_MS` se aplica; listas menores têm a contagem refeita a cada frame. Tem precedência sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores apontando para `localhost`/loopback sob `NODE_ENV=production`. Desativado por padrão, para que um deploy de produção falhe de forma evidente em vez de tentar se conectar a um banco que não existe localmente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` executa a etapa de esquema e encerra a execução sem abrir uma porta de rede — o comportamento ideal para um Job de migração, usando a mesma imagem e o mesmo bundle do servidor subsequente. Também cria as tabelas que um processo servidor criaria no primeiro uso, sem iniciar agendamentos de cron ou filas de jobs. Valor vazio é considerado *não definido*, garantindo que uma variável `${VARIAVEL}` não substituída em um compose não transforme um deploy normal em um que apenas migra e se recusa a atender requisições. É incompatível com `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Caminho de arquivo. Uma execução de provisionamento (`REBASE_PROVISION_ONLY=true`) grava nela todas as alterações de esquema realizadas, em ordem, como um script SQL para revisão e aplicação via `psql`. Linhas de dados inseridas não são incluídas. Recusado em processos que servem requisições. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que uma máquina — um agente, um job de CI — *aplique* alterações de esquema via `/api/admin/schema`, em vez de apenas planejá-las. Desativado a menos que explicitamente solicitado: a credencial que realizaria tal mudança é justamente a que costuma estar exposta em variáveis de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo máximo de execução de uma função customizada antes do cancelamento da requisição. Mesmo controle da opção `functionsTimeoutMs`. `0` desativa o timeout. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz com que uma rejeição de promise não tratada encerre o processo em vez de apenas registrá-la em log. Recomendado sob orquestradores que reiniciarão o contêiner; desative se uma reinicialização for pior do que um vazamento de memória. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Suprime o aviso de boot em plataformas que o runtime detecta como scale-to-zero (onde um timer disparado em uma instância ociosa nunca seria acionado). Não altera nada além disso: ative quando mantiver pelo menos uma instância sempre ativa. | — |
| `TRUSTED_PROXY_HOPS` | Quantos proxies estão à frente deste servidor, permitindo que o rate limiter extraia o IP real do cliente a partir de `X-Forwarded-For`. Padrão seguro `0`: sem proxy, confiar no cabeçalho permitiria a qualquer chamador forjar seu endereço IP. | `0` |

:::note[O provisionamento de boot é aditivo e não substitui uma ferramenta de migração]
A etapa de inicialização roda sem supervisão humana, portanto nunca removerá uma coluna,
não restringirá um tipo de dado nem reescreverá uma tabela. Essa é também a razão pela qual a imagem recusa
`REBASE_MIGRATE_ON_BOOT=push`: um push completo calcula um diff e executaria `DROP COLUMN`
sem restrições, e a reinicialização de um contêiner nunca deve poder destruir uma
coluna em produção devido a um reagendamento de pods.

Alterações destrutivas ou de reformulação estrutural devem ser feitas onde possam ser revisadas:
`rebase db generate` + `rebase db migrate`, ou `rebase db push` a partir do repositório ou CI,
que simula a alteração, recusa ações destrutivas sem confirmação e permite realizar backup prévio.
:::

### Deploys divididos (Split deployments)

Uma mesma imagem e um mesmo bundle podem ser inicializados diversas vezes, cada instância
atendendo a uma parte diferente do projeto. Abaixo listamos as variáveis resumidamente; para detalhes
sobre o que cada combinação *carrega e gerencia* — e quais combinações são recusadas —, consulte
**[Processos Divididos](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_ROLE` | Qual função este processo assume: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescreve se *este* processo executa os agendamentos cron. Não definido segue o valor de `REBASE_ROLE`. | — |
| `REBASE_JOB_WORKERS` | Sobrescreve se este processo executa os workers da fila de jobs. Não definido segue o valor de `REBASE_ROLE`. | — |
| `REBASE_FUNCTIONS_ONLY` | Executa apenas as funções customizadas nomeadas neste processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Executa todas as funções customizadas, exceto as nomeadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Para onde o processo de API encaminha requisições de funções que ele próprio não atende. Em um `worker`, define para onde vão suas próprias chamadas `rebase.functions`. Uma URL `http(s)`. | — |

### Superfície MCP

Um endpoint opcional (opt-in) do Model Context Protocol em `/mcp`, permitindo que clientes de IA leiam
e gravem neste projeto **como o usuário autenticado**. Desativado por padrão e — ao contrário de qualquer
outra funcionalidade — nenhum `REBASE_ROLE` o ativa automaticamente: os outros definem o perfil do processo,
enquanto este representa uma concessão deliberada de credenciais para softwares de terceiros,
devendo ser uma decisão tomada conscientemente em vez de herdada da função de um contêiner.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Disponibiliza a interface MCP. Requer `REBASE_PUBLIC_URL`; sem ela, o recurso não é carregado e registra a recusa no log de inicialização. | `false` |
| `REBASE_PUBLIC_URL` | A origem acessível externamente deste deploy, ex.: `https://app.example.com`. A interface MCP não pode inferi-la — obter a origem pelo cabeçalho `Host` transformaria a identidade do emissor e a audiência contra a qual os tokens são validados em valores controlados pelo chamador. | — |
| `REBASE_MCP_VIEW` | Caminho para a visualização própria de MCP App do projeto (`rebase-view.html`, gerada por `rebaseMcpViewPlugin()`), servida ao Claude em vez da visualização genérica para exibir seus componentes, campos e ações customizados. Sem ela, o backend buscará junto ao frontend servido. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite registro dinâmico de clientes OAuth (RFC 7591), permitindo auto-registro pelo próprio cliente. Defina como `false` para exigir registro prévio dos clientes. | `true` |

### Edição de esquema em tempo real a partir de bundle

Desativado a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esteja definido. Um bundle compilado
não possui o código-fonte de `backend/schema` para edição, portanto, com essas variáveis configuradas,
o editor lê o código-fonte do repositório, faz o commit das alterações de volta e executa o DDL
no banco de dados. Exclusivo para administradores e aplicado manualmente, a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique o contrário. Um repositório configurado
sem credenciais válidas impede a inicialização. Consulte
[Edição de esquema em tempo real](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Repositório GitHub para onde os commits de esquema serão enviados, no formato `owner/name`. Defini-lo ativa a funcionalidade. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Branch onde o commit será inserido. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Onde `backend/schema` reside no repositório, relativo à raiz. Um caminho que escape do repositório impede a inicialização, assim como o depreciado `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Token com permissão refinada de leitura e gravação no conteúdo do repositório. Defina este token ou as três variáveis `_GITHUB_APP_*`, nunca ambos. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID do GitHub App, para realizar commits como o aplicativo em vez de usar um token pessoal. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | ID de instalação do App no repositório. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Chave privada do App: PEM, PEM com quebras de linha escapadas ou base64. | — |

### Backups

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Expressão cron para backups agendados. Não definido desativa os backups automáticos. | — |
| `BACKUP_DESTINATION` | Caminho local ou URL no formato `s3://bucket/prefix` / `gs://bucket/prefix`. Obrigatório ao usar `BACKUP_SCHEDULE`, que não executará sem ele. `rebase db backup` usa `./backups` como fallback no diretório onde foi executado. | — |
| `BACKUP_RETENTION_DAYS` | Exclui backups com mais de N dias. Não definido ou `0` retém tudo. | — |
| `BACKUP_KEEP_MINIMUM` | Mantém sempre pelo menos N dos backups mais recentes, independentemente da retenção configurada. | — |
| `PG_DUMP_PATH` | Caminho do executável do `pg_dump` — deve ser da mesma versão principal do servidor ou mais recente. | — |
| `PG_RESTORE_PATH` | Caminho do executável do `pg_restore`. | — |
| `PSQL_PATH` | Caminho do executável do `psql` utilizado por `rebase db restore --clean` para realizar a restauração em uma única transação. | — |
| `PG_DUMPALL_PATH` | Localização do `pg_dumpall`, caso não esteja no `PATH`. Sem ele — e sem as ferramentas de cliente PostgreSQL instaladas —, um backup de objetos globais falhará com erro citando esta variável. | — |

A imagem de runtime oficial (`rebasepro/server`) inclui as ferramentas de cliente
do PostgreSQL 18, permitindo que backups agendados rodem normalmente contra qualquer servidor até o Postgres 18.
Fora da imagem, instale-os manualmente (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups contêm segredos e informações de identificação pessoal (PII). Utilize um destino privado com
criptografia em repouso.

### Entrega de bundles

Um deploy gerenciado não armazena seu código dentro da imagem: o runtime faz o download
do bundle durante a inicialização. Estas variáveis controlam de onde e como ele é baixado.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já extraído. O que `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | Local de onde baixar o arquivo do bundle quando não houver um localmente. | — |
| `REBASE_BUNDLE_TOKEN` | Credencial bearer para autorizar o download. Trate-a como um segredo: é o que autoriza um tenant a baixar seu próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Diretório onde o bundle baixado será extraído. Deve ter permissão de escrita e persistir entre o download e a inicialização. | — |
| `REBASE_RUNTIME_MODULES` | Módulos extras que a imagem de runtime disponibiliza para o bundle, além dos declarados por ele próprio. | — |

### Vínculo de recursos (Resource bindings)

Cada banco de dados, bucket e tópico declarado por um projeto em `backend/resources.ts`
é vinculado por variáveis de ambiente correspondentes. Os nomes base estão listados abaixo;
recursos não padrão recebem o sufixo `__` acompanhado de sua chave em letras maiúsculas. Por exemplo, um bucket
chamado `media` usará `S3_BUCKET__MEDIA`. O comando `rebase status`
exibe, para cada recurso, a variável exata que está sendo lida e seu status de definição.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_DRIVER` | O pacote npm que implementa o driver de uma fonte de dados, quando não for o Postgres padrão. Sufixado por fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | String de conexão para um tópico declarado. Sufixado por tópico. | — |

### Variáveis próprias da CLI

Lidas pelo executável `rebase`, e não pelo servidor. Nenhuma configuração aqui afeta o ambiente de deploy.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Para onde comandos como `rebase api-keys`, `rebase storage` e `rebase auth reset-password` enviam a chave de serviço, no shell ou no `.env`. Configure-a quando o servidor rodar de forma diferente de `rebase dev` neste projeto: `rebase start`, um contêiner ou outro host. Não definida, utiliza o servidor registrado pelo `rebase dev` enquanto ativo, e não envia nada se estiver desligado. | — |
| `REBASE_SERVICE_KEY` | A service key utilizada para autenticação por esses comandos, lida do `.env`: a mesma variável que o servidor lê (veja acima). | — |
| `SERVICE_KEY` | Nome legado para a chave de serviço. Quando presente no `.env`, `rebase api-keys` e `rebase storage` leem-na em vez de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qual arquivo `.env` a CLI deve ler e gravar, caso não seja o padrão do projeto. | — |
| `REBASE_ROOT_RULES` | `0` impede que `rebase init` e `rebase skills install` gravem as regras do projeto nos arquivos `CLAUDE.md` e `AGENTS.md` na raiz do repositório, útil quando você gerencia manualmente as instruções para agentes na raiz. | on |
| `REBASE_CLOUD_URL` | O control plane com o qual o `rebase cloud` se comunica. | — |
| `REBASE_CLOUD_EMAIL` | A conta com a qual `rebase cloud login` se autentica automaticamente, sem solicitar interação. | — |
| `REBASE_CLOUD_PASSWORD` | A senha dessa conta, permitindo que um cofre de segredos a forneça sem expô-la no histórico do terminal. | — |
| `REBASE_TOKEN` | Token gerado via `rebase cloud tokens create`. Quando definido, todos os comandos `rebase cloud` autenticam-se com ele em vez da sessão de `rebase cloud login`, sem ler ou atualizar a sessão persistida. Em um diretório vinculado com `rebase cloud init --claim`, ele é reservado para o token do próprio projeto caso não tenha escopo sobre ele. Indicado para executar `rebase cloud` em CI — veja [CI e agentes](/docs/deployment/cloud/#ci-and-agents). O [servidor MCP](/docs/ai/mcp/) o repassa para a CLI instanciada por suas ferramentas em nuvem, nunca o enviando para o aplicativo: utilize `REBASE_API_TOKEN` para essa finalidade. | — |
| `REBASE_DEBUG` | `1` imprime o erro detalhado subjacente e informações da requisição em vez de uma mensagem simplificada. Primeira opção a ser ativada quando um comando de `rebase cloud` falhar sem detalhes suficientes. | — |
| `REBASE_ATLAS_DEV_URL` | O banco de dados vazio utilizado por `rebase db push`, `db generate` e `db migrate` para planejar alterações, em vez do `<db>_dev_diff` criado ao lado de `DATABASE_URL`. O Rebase não cria nem remove o banco informado aqui, e recusa valores iguais a `DATABASE_URL`. No banco de desenvolvimento gerenciado, a CLI o define automaticamente para uma instância efêmera em memória do PGlite. Defina-o em ambientes onde permissões de `CREATE DATABASE` não estejam disponíveis. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | Faz com que `rebase dev` não inicialize bancos nem provisione nada — você fornece sua própria infraestrutura. Equivalente à flag `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento do frontend, que de outro modo o `rebase dev` deriva com base no caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo máximo que o `rebase dev` aguarda a confirmação de inicialização do backend antes de reportar falha. `0` desativa o alerta. | `30000` |
| `DATABASE_PASSWORD` | Senha injetada pelo `rebase dev --docker` na string de conexão gerada a partir do `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenção padrão do ecossistema. Qualquer valor diferente de `0` desativa o envio de telemetria pela CLI. | — |
| `REBASE_TELEMETRY_DISABLED` | O mesmo efeito anterior, específico para o Rebase. Não requer arquivo, sendo a opção recomendada para uso em pipelines de CI e contêineres. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destino para envio de métricas de telemetria, em caso de coletor self-hosted. | — |

## Segredos em desenvolvimento

`JWT_SECRET` é obrigatória em produção. Ela e `REBASE_SERVICE_KEY` são
geradas automaticamente fora desse ambiente, permitindo que você inicie o projeto sem configurações manuais prévias.

Esses valores gerados ficam salvos em cache em `.rebase-dev-secrets.json`, ao lado de
`.rebase-dev-port` e `.rebase-dev-url`, devendo ser ignorados pelo git junto com eles. Anteriormente,
eles eram recriados a cada reinicialização — o que invalidava sua sessão no app
e tornava obsoleta qualquer chave de API recém-criada ao reiniciar o servidor de desenvolvimento.

- Defina qualquer uma das variáveis explicitamente para usar seu próprio valor; nada será lido ou salvo no cache.
- Altere o destino do cache apontando `REBASE_DEV_SECRETS_FILE` para outro caminho — a
  única variável desta seção que você definiria intencionalmente.
- Remova o arquivo para forçar a rotação de ambos os segredos. Uma nova inicialização criará um arquivo novo.
- Se o arquivo não puder ser gravado — como em um contêiner somente leitura —, o servidor iniciará
  normalmente com um segredo efêmero, operando exatamente como nas versões anteriores.

Nenhum valor é armazenado em cache em produção ou sob executores de teste. Em produção nada
é gerado automaticamente: iniciar o servidor sem `JWT_SECRET` falha na hora, apontando a variável,
mantendo o comportamento esperado:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objeto de Configuração do Backend

O objeto `RebaseBackendConfig` passado para `initializeRebaseBackend()` oferece controle programático da aplicação:

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
sem `app`, `server` e `basePath`, e com o parâmetro obrigatório `provision`, configuram um
backend que não atende requisições até ser montado: `createRebaseBackend`. Consulte
[Integração com Servidor Customizado](/docs/backend/custom-server/).

### Alterando `basePath`

A configuração `basePath` move todas as rotas da API; portanto, o cliente deve ser informado sobre a nova base —
caso contrário, continuará requisitando `/api/...` e receberá 404 em todas as chamadas:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel administrativo obtém essa informação diretamente da instância do cliente fornecida,
sem necessidade de configuração adicional. Caso monte URLs manualmente, componha o endereço a partir do cliente
em vez de fixar `/api` no código:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solução de Problemas

### Permissão Negada no SQL Editor (`permission denied for table <name>`)

* **Sintomas:** Consultas customizadas executadas no SQL Editor do Rebase Studio falham com `cause: error: permission denied for table <name>`, embora a visualização de planilha do CMS carregue os dados normalmente.
* **Causa:** Por padrão, o Rebase executa as consultas do SQL Editor alternando temporariamente as roles do banco para corresponder à role da aplicação do usuário logado (ex.: `SET LOCAL ROLE "admin"`). Caso você utilize autenticação customizada em que as roles residem apenas em tabelas de banco e não em roles reais do PostgreSQL, a troca de role falha ou faltam privilégios de banco de dados. A visão de planilha do CMS roda sob o usuário padrão proprietário da conexão e não sofre esse bloqueio.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` ao `.env` do seu backend. Isso força o Rebase a executar as consultas do SQL Editor com os privilégios do proprietário da conexão (geralmente um superuser/owner). O SQL Editor exibirá acima dos resultados que eles foram lidos como o proprietário da conexão, desativando o seletor de roles.

### Falha ao Carregar o Esquema no SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio não consegue carregar a árvore de esquema ou o SQL Editor exibe `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** O Rebase exige privilégios administrativos para inspecionar os catálogos do sistema e rodar comandos administrativos. Caso `adminConnectionString` não seja passado ao bootstrapper ou `getAdmin()` seja sobrescrito retornando `undefined`, essas operações falham.
* **Solução:** Certifique-se de configurar `adminConnectionString` durante a inicialização do bootstrapper no backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Próximos Passos

- **[Deployment](/docs/getting-started/deployment)** — Guia de deploy em produção
- **[Visão Geral do Backend](/docs/backend)** — Documentação de referência completa de configuração do backend
