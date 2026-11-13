---
sourceHash: acc55c3c58895863
title: Ambiente & Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita por meio de variáveis de ambiente no arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida as variáveis de ambiente com o **Zod** na inicialização. Se
> qualquer item obrigatório estiver ausente ou malformado (uma URL que não é uma URL, uma porta que
> não é um número), o servidor se recusa a inicializar e informa o nome da variável.
>
> O local onde o schema reside depende de como você executa o backend. Um projeto inicializado pelo
> runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o schema pertencente ao
> runtime (`loadBootEnv` em `@rebasepro/server`), que é a união de todas as tabelas abaixo.
> Um projeto que executou [`rebase eject`](/docs/cli) possui um `backend/src/env.ts` chamando
> `loadEnv({ extend })`, e pode adicionar suas próprias variáveis tipadas lá.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | String de conexão do PostgreSQL. **Opcional em desenvolvimento** — se não definida, o `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Obrigatória em todos os outros ambientes. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinatura de tokens JWT. Use uma string aleatória forte (mínimo de 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` é uma grafia do node-postgres, não da libpq.**
>
> O Rebase e o driver do Node a aceitam — criptografa, mas não verifica o
> certificado. O `psql`, `pg_dump`, `pg_restore` e o Atlas não a aceitam e não
> degradam graciosamente: eles se recusam a iniciar com `invalid sslmode value: "no-verify"`.
>
> Os próprios comandos do Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) reescrevem isso para o equivalente `sslmode=require` antes de invocar o shell,
> para que funcionem com a URL configurada. Executar o `psql` manualmente não faz isso
> — substitua por `sslmode=require` lá, que criptografa sem verificar exatamente da
> mesma maneira.

### Frontend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `VITE_API_URL` | URL da API do backend para o SDK tipado. **Defina apenas em desenvolvimento** — veja abaixo. | origem da página |
| `VITE_GOOGLE_CLIENT_ID` | ID do cliente OAuth do Google. Habilita o "Entrar com o Google". | — |


> **Deixe `VITE_API_URL` indefinida em builds de produção.**
>
> Em desenvolvimento, o frontend e o backend têm origens separadas, portanto, o
> servidor de desenvolvimento injeta isso. Em produção, o backend do Rebase serve a SPA,
> portanto, a API é a própria origem da página e o cliente a resolve dessa forma por conta própria.
>
> Fixar uma URL absoluta em um bundle de produção funciona até o momento em que um segundo
> hostname aponta para a mesma aplicação: um domínio personalizado então carrega a página de
> `example.com` e chama a API em `example.rebase.website`, o que é cross-origin, fazendo com
> que cada requisição falhe no preflight. Permitir a origem no CORS também **não** resolve —
> o cookie de atualização (refresh cookie) é `SameSite=Lax` e não é enviado cross-site, então
> você limparia os erros do console e ainda continuaria com a autenticação quebrada. Não definida,
> qualquer domínio que aponte para a aplicação funciona sem nenhuma configuração de CORS.

### Backend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta para o servidor HTTP do backend. Lida pelo `rebase start`. O `rebase dev` a lê **apenas do ambiente do shell** — um `PORT` no `.env` não é lido lá, pois a porta é resolvida antes do carregamento desse arquivo — e, caso contrário, vincula uma porta derivada do caminho do projeto, permitindo que vários projetos sejam executados ao mesmo tempo. `rebase dev --port` tem precedência sobre ambos, e o banner de inicialização indica a opção utilizada. | `3001` |
| `LOG_LEVEL` | Verbosidade dos logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra o SQL por trás de uma linha `Failed query: [redacted]`. Cada instrução com falha é ocultada por padrão, pois uma consulta com falha carrega seus parâmetros vinculados — um e-mail, um hash de senha. Defina como `true` ao diagnosticar uma falha de DDL, RLS ou captura de alterações. Ignorado quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Lista separada por vírgulas de origens permitidas. **Obrigatório em produção**, a menos que `FRONTEND_URL` esteja definido: uma inicialização em produção sem nenhum dos dois se recusa a iniciar. Em desenvolvimento, ela é *adicionada ao* localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL da aplicação frontend. Usada como alternativa a CORS_ORIGINS, em ambos os ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão de nível administrativo com o banco de dados (usada para introspecção de schema e operações de administração). O banco de dados que ela especifica não é aquele que o console SQL considera atual, nem o que uma nova branch copia por padrão: ambos são o banco de dados em que a própria conexão da aplicação reside (consulte `REBASE_BRANCH_PARENT_DATABASE` para um servidor em uma branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a alternância de papéis (roles) do PostgreSQL no Editor SQL (útil para autenticação personalizada onde os papéis do banco de dados não estão mapeados). O console SQL do Studio então informa que as linhas foram lidas como o proprietário da conexão, exibe seu nome e desabilita o seletor de papéis. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | O banco de dados a partir do qual a branch em que este servidor está rodando foi copiada. O `rebase dev` o define em um checkout [alternado para uma branch](/docs/backend/branching/#cli-integration). Um servidor com ele mantém o registro de branches nesse banco de dados e copia novas branches a partir dele por padrão, de modo que o painel Branches do Studio exiba as branches do banco de dados principal. | — |

#### CORS em desenvolvimento

O desenvolvimento permite o **localhost, além de qualquer origem especificada por `CORS_ORIGINS` (ou `FRONTEND_URL`)**
— a mesma lista usada em produção, com o localhost adicionado em vez de
substituído. Portanto, a variável funciona da mesma maneira em ambos os ambientes, e os
casos que precisam dela em desenvolvimento são os comuns:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não seja localhost nem esteja listada é recusada, e a recusa é
registrada em log **uma vez por origem** com a linha exata que a permitiria. Recusar não é
apenas cautela vazia: a API envia credenciais, portanto refletir um `Origin`
arbitrário permitiria que qualquer site visitado pelo desenvolvedor fizesse requisições
autenticadas contra o servidor de desenvolvimento usando sua sessão e lesse as respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `JWT_SECRET` | Segredo para assinatura de JWT (obrigatório em produção, gerado automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso de forma assimétrica (RS256), permitindo que qualquer parte com acesso ao JWKS verifique uma sessão sem poder emitir uma nova. Aceita um PEM com quebras de linha reais, um PEM com escapes `\n` ou base64 do PEM completo. Sem ela, os tokens permanecem em HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` no cabeçalho do token e no JWKS. Altere-o sempre que a chave mudar — a rotação depende de o antigo e o novo serem distinguíveis. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de vida do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de vida do token de atualização. Deslizante (sliding) — cada rotação o renova, controlando quanto tempo uma sessão sobrevive à **inatividade**. Defina `400d` para sessões que devam durar além de uma longa ausência; os navegadores limitam o cookie de atualização a esse período. | `30d` |
| `ALLOW_REGISTRATION` | Permite que novos usuários se registrem (`true`/`false`). Fora de produção, o **primeiro** usuário sempre pode se registrar, independentemente desta configuração — uma tabela de usuários vazia precisa admitir alguém, e esse alguém se torna o administrador. Em produção (`NODE_ENV=production`), essa janela é fechada: uma tabela vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma primeira conta criada por registro aberto é uma conta comum, e o administrador é definido com `REBASE_ADMIN_EMAIL` abaixo ou atribuído com a chave de serviço. O `.env.example` do scaffold o define como `true`; o padrão do framework é desativado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Disjuntor de segurança (kill switch). Fecha a janela de bootstrap do primeiro usuário que `ALLOW_REGISTRATION=false` deliberadamente deixa aberta fora de produção, de modo que o registro seja bloqueado mesmo em um banco de dados vazio. Combine com `REBASE_ADMIN_EMAIL` abaixo, caso contrário o deploy não terá como produzir seu primeiro chamador autenticado. Todos os artefatos de deploy fornecidos o definem. | — |
| `REBASE_ADMIN_EMAIL` | E-mail da primeira conta de administrador, criada na inicialização **enquanto a tabela de usuários ainda estiver vazia** e nunca depois. É assim que um deploy em produção obtém seu administrador: o operador define a primeira conta em vez de disputá-la com a internet. A inicialização avisa quando a tabela está vazia em produção e essa variável não está configurada. | — |
| `REBASE_ADMIN_PASSWORD` | Senha para essa conta. No mínimo 12 caracteres, caso contrário ela é recusada e a conta não é criada. Altere-a após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Criptografa cada segredo TOTP armazenado. Se não configurada, os segredos são criptografados com `JWT_SECRET` e a inicialização avisa uma vez — assim, a rotação de `JWT_SECRET` desconecta todos *e* torna indecifrável qualquer autenticador cadastrado. Defina uma chave dedicada (mais de 32 caracteres aleatórios) antes que qualquer usuário se cadastre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave que está sendo *substituída* durante a rotação. Defina ambas durante uma rotação: novos segredos são gravados com `MFA_ENCRYPTION_KEY` e os existentes continuam legíveis, para que ninguém perca o acesso à própria conta no meio da rotação. Remova-a assim que todos os segredos tiverem sido recriptografados. | — |
| `ALLOW_ANONYMOUS` | Habilita o login anônimo (`POST /api/auth/anonymous`). Opcional (opt-in) e deliberadamente não controlado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina como `false` para uma superfície de leitura totalmente pública — o RLS ainda se aplica. | `true` |
| `AUTH_DEFAULT_ROLE` | Papel (role) atribuído a um usuário recém-registrado quando nenhum é informado. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta `POST /api/auth/find-user`, que resolve um e-mail em um perfil público mínimo (`uid`, `displayName`, `photoURL`) para fluxos de convite por e-mail. Apenas para chamadores autenticados e nunca retorna o e-mail, papéis ou metadados do usuário encontrado. Desativado por padrão: é uma superfície de enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` no cookie de atualização: `Strict`, `Lax` ou `None`. `None` requer HTTPS e serve apenas para um frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` no cookie de atualização. Seguro por padrão; `AUTH_COOKIE_SECURE=false` para HTTP simples — um deploy em um endereço de LAN onde o navegador, de outra forma, descartaria o cookie e a sessão expiraria no término do token de acesso sem nenhum erro. Emite um aviso na inicialização. `http://localhost` não precisa disso. | `true` |
| `GOOGLE_CLIENT_ID` | ID do cliente OAuth do Google (validação no backend) | — |
| `GOOGLE_CLIENT_SECRET` | Segredo do cliente OAuth do Google | — |
| `GITHUB_CLIENT_ID` | ID do cliente OAuth do GitHub | — |
| `GITHUB_CLIENT_SECRET` | Segredo do cliente OAuth do GitHub | — |
| `MICROSOFT_CLIENT_ID` | ID do cliente OAuth da Microsoft | — |
| `MICROSOFT_CLIENT_SECRET` | Segredo do cliente OAuth da Microsoft | — |
| `LINKEDIN_CLIENT_ID` | ID do cliente OAuth do LinkedIn | — |
| `LINKEDIN_CLIENT_SECRET` | Segredo do cliente OAuth do LinkedIn | — |
| `FACEBOOK_CLIENT_ID` | ID do cliente OAuth do Facebook | — |
| `FACEBOOK_CLIENT_SECRET` | Segredo do cliente OAuth do Facebook | — |
| `TWITTER_CLIENT_ID` | ID do cliente OAuth do X/Twitter | — |
| `TWITTER_CLIENT_SECRET` | Segredo do cliente OAuth do X/Twitter | — |
| `DISCORD_CLIENT_ID` | ID do cliente OAuth do Discord | — |
| `DISCORD_CLIENT_SECRET` | Segredo do cliente OAuth do Discord | — |
| `GITLAB_CLIENT_ID` | ID do cliente OAuth do GitLab. A `baseUrl` de uma instância auto-hospedada não possui uma variável de ambiente correspondente — configure o GitLab no bloco `auth` para isso. | — |
| `GITLAB_CLIENT_SECRET` | Segredo do cliente OAuth do GitLab | — |
| `BITBUCKET_CLIENT_ID` | ID do cliente OAuth do Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Segredo do cliente OAuth do Bitbucket | — |
| `SLACK_CLIENT_ID` | ID do cliente OAuth do Slack | — |
| `SLACK_CLIENT_SECRET` | Segredo do cliente OAuth do Slack | — |
| `SPOTIFY_CLIENT_ID` | ID do cliente OAuth do Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Segredo do cliente OAuth do Spotify | — |
| `APPLE_CLIENT_ID` | Apple Services ID, para login via web. É público e publicado em `GET /auth/config`. A Apple não possui um segredo de cliente estático, pois o Rebase assina um JWT ES256 de curta duração para cada troca de token. Portanto, a Apple precisa de `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, além deste ou de `APPLE_BUNDLE_IDS`, e nada é configurado sem eles. | — |
| `APPLE_BUNDLE_IDS` | IDs de bundle separados por vírgula dos aplicativos nativos para iOS/macOS cujos códigos do Sign in with Apple são aceitos. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, o emissor do JWT. | — |
| `APPLE_KEY_ID` | ID da chave privada registrada na Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, incluindo quebras de linha (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave de API de administrador estática. Ignora a autenticação JWT comum para chamadas servidor a servidor quando passada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | A chave pública da plataforma de hospedagem (PEM, EC P-256) com a qual os tokens de plataforma `rpt_` são verificados; múltiplos blocos PEM durante uma rotação de chave. A plataforma a define no deploy e ela não contém nada secreto. Juntamente com `REBASE_PLATFORM_TOKEN_AUDIENCE`, ela permite que o controle de administrador aceite um token de plataforma para `cron:read`, e para nada mais. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | O ID do projeto com o qual o `aud` do token de plataforma deve ser igual, para que um token gerado para outro projeto seja recusado. Com apenas uma das duas variáveis definida, o servidor inicializa, registra um aviso e responde a qualquer token `rpt_` com `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Onde residem os contadores de rate limit da autenticação: `memory` (por processo) ou `sql` (compartilhado entre réplicas). Um processo não pode ver sua própria contagem de réplicas, portanto, um deploy com réplicas deve explicitar isso — três réplicas no valor padrão aplicam três vezes o limite. Qualquer outro valor **recusa a inicialização** em vez de usar fallback, incluindo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monta o fluxo de link de login sem senha (magic link). Requer um serviço de e-mail configurado, caso contrário o link não terá para onde ir. | `false` |
| `AUTH_EMAIL_OTP` | Monta o login sem senha com um código de seis dígitos enviado por e-mail. Mesmo requisito de e-mail acima. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Cadastro sem senha: uma solicitação de magic link ou código de e-mail para um endereço desconhecido cria a conta, enquanto o registro estiver aberto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | O que um token de atualização reutilizado após a janela de tolerância faz: `reject` (recusa-o, mantendo a sessão) ou `revoke-session` (encerra a sessão). Qualquer outro valor causa falha na inicialização. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro com confirmação prévia: nenhum login com senha é permitido até que o endereço seja verificado. Requer e-mail; a inicialização recusa sem ele. | `false` |
| `CAPTCHA_PROVIDER` | Ativa a verificação por captcha nas rotas de autenticação: `turnstile` ou `hcaptcha`. Não definida significa sem captcha. | — |
| `CAPTCHA_SECRET` | O segredo do provedor, usado no servidor para verificar o token que o navegador envia. Obrigatório quando `CAPTCHA_PROVIDER` estiver definido. | — |
| `CAPTCHA_ROUTES` | Rotas de autenticação separadas por vírgula para proteger (por exemplo, `register,login`). Não definida protege o conjunto padrão do provedor. | — |

### Armazenamento

:::caution[O armazenamento não tem segurança em nível de linha, portanto precisa de um modelo de acesso]
As tabelas são protegidas pelo RLS do Postgres. O armazenamento de objetos não tem equivalente —
as chaves compartilham um namespace único e plano — portanto, com um bucket configurado e sem modelo de acesso,
o servidor **se recusa a inicializar em produção**. Satisfaça isso com exatamente um dos seguintes:
um hook `storageAuthorize` exportado de `backend/storage.ts` (o que o scaffold
fornece), `STORAGE_PUBLIC_READ` ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `STORAGE_TYPE` | Backend de armazenamento: `local`, `s3` ou `gcs`. Em produção, `local` desativa o armazenamento, a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para armazenamento local. Um caminho relativo é lido a partir do diretório em que o servidor roda: a raiz do projeto no `rebase dev`, `backend/` em um servidor gerado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite armazenamento local em produção — somente com um volume durável contendo `STORAGE_PATH` e os diretórios `<STORAGE_PATH>__<key>` de buckets locais nomeados ao lado | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos em que a URL de download de um arquivo privado funciona — o token que `getSignedUrl()` insere nela. No máximo `604800` (uma semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Maior arquivo que a fonte aceita, em bytes, em cada caminho de upload — `__<KEY>` para uma fonte nomeada. Um valor que não seja um número inteiro de bytes recusa a inicialização | `52428800` (50 MB) |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região da AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso da AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta da AWS | — |
| `S3_ENDPOINT` | Endpoint customizado do S3 (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Força URLs no estilo de caminho (path-style) para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto do GCP. Geralmente inferido a partir das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para o arquivo de chave da conta de serviço. Omita no GCP, onde o Workload Identity fornece as credenciais. | — |
| `STORAGE_PUBLIC_READ` | Serve todos os objetos para qualquer pessoa, sem token. Apenas para um bucket que seja genuinamente uma CDN pública. Uma das três maneiras de satisfazer a proteção de inicialização mencionada. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que qualquer chamador autenticado leia, escreva, liste e exclua todos os objetos. Chamado de `INSECURE` no objeto de configuração por um motivo: só é defensável em uma aplicação single-tenant onde todas as contas têm permissão para acessar todos os arquivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Armazena em cache as renderizações de imagem geradas (redimensionamentos, conversões de formato) em vez de produzi-las por requisição. | `false` |

### E-mail (Opcional)

| Variável | Descrição |
|----------|-----------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Habilita conexão segura (`true`/`false`) |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `SMTP_FROM` | Endereço do remetente para e-mails do sistema |
| `SMTP_NAME` | Nome de exibição no endereço do remetente |
| `APP_NAME` | Nome do produto usado em assuntos e corpos de e-mail (padrão: `Rebase`) |
| `EMAIL_LOGO_URL` | Logotipo exibido no topo dos modelos de e-mail padrão. PNG ou JPG com `http(s)` absoluto — os clientes de e-mail removem SVG e bloqueiam URIs `data:`. Se não definido, um aplicativo que ainda se chame `Rebase` recebe a marca do Rebase e um renomeado não recebe nenhum |

### Pool de conexões com o banco de dados

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `DB_POOL_MAX` | Máximo de conexões no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milissegundos que uma conexão ociosa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milissegundos de espera por uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (sem pooling). O [Realtime](/docs/backend/realtime) precisa de uma: o `LISTEN`/`NOTIFY` não sobrevive a um pooler em modo de transação como o PgBouncer e, sem ela, as notificações de alteração são desativadas com um aviso em vez de serem perdidas silenciosamente. O [job worker](/docs/backend/jobs) mantém seu `LISTEN` de ativação nela também. Preenche a `directConnectionString` do adaptador Postgres quando ela não está definida. | — |
| `DATABASE_READ_URL` | Réplica de leitura, como um hot standby. Quando aponta para outro servidor, leituras autenticadas (listagens, linhas individuais, contagens, agregações) são atendidas lá sob a mesma segurança em nível de linha; gravações, login, realtime, crons, jobs, o console SQL e `rebase.sql` permanecem no primário. Um leitor que acabou de gravar lê do primário durante `REBASE_READ_STICKY_MS`, e todos leem dele enquanto a réplica estiver com atraso maior que `REBASE_READ_MAX_LAG_MS` ou falhando. Preenche a `readConnectionString` do adaptador Postgres quando não estiver definida; até a versão 0.28 inclusive, o pool da réplica era aberto e nunca lido. | — |
| `REBASE_READ_STICKY_MS` | Após uma gravação, por quanto tempo as leituras do mesmo usuário vão para o primário, para que um salvamento seguido de uma listagem exiba a alteração feita. Por instância de servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Atraso (lag) da réplica a partir do qual todas as leituras vão para o primário. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa por um pooler em modo de transação como o PgBouncer. O pool não envia `search_path` ou `statement_timeout` na conexão (o pooler os recusaria ou descartaria) e define ambos em cada transação; a inicialização define para o papel do banco de dados um `search_path` padrão de `public` para instruções fora de uma transação. `DATABASE_DIRECT_URL` passa a ser obrigatória, e realtime, a ativação do worker de jobs, criação de índices, branching e o console SQL usam-na. A URL da réplica também é considerada sob pooling. `DATABASE_POOLED__<KEY>` para outra fonte de dados. | — |
| `REBASE_DB_POOL_MAX` | Um teto para cada pool no processo, aplicado independentemente do que cada um solicitou. Apenas dígitos puros: um valor malformado é ignorado em vez de serializar o servidor silenciosamente. | — |

### Comportamento do runtime

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem de servidor publicada.
Um projeto que foi ejetado assume essas decisões em seu próprio código.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_RLS_AUDIT` | `true` executa a [auditoria de segurança em nível de linha](/docs/rls-check#running-it-on-a-schedule) agendada, que relata tabelas servidas sem políticas. O projeto deve declarar `@rebasepro/rls-check` entre suas dependências: o runtime não inclui uma cópia e, sem o pacote, a inicialização é recusada, informando o nome dele. `false` mantém a varredura desativada neste processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | O papel do Postgres com o qual as requisições autenticadas e anônimas são executadas. Atribua a cada projeto em um cluster compartilhado o seu próprio papel. Um banco de dados registra o papel com o qual é executado, e uma inicialização configurada para outro se recusa a iniciar até que `rebase db request-role migrate` o migre. Consulte [Executando em um banco de dados existente ou compartilhado](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` cria o papel da requisição e permite que a conexão alterne para ele; `never` deixa ambos a seu cargo e apenas os verifica. | `auto` |
| `REBASE_RLS_GRANTS` | O que o Rebase concede ao papel da requisição: `schema` (todas as tabelas nos schemas que atende, além de privilégios padrão), `managed` (apenas as tabelas que atende) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe as políticas permissivas do Rebase ao(s) papel(is) de requisição, para que outros papéis lendo as mesmas tabelas não obtenham nada delas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` grava as políticas que apenas o contexto do servidor ou um administrador podem satisfazer `TO public`, e executa administradores como o papel da requisição. Por padrão, elas são `TO rebase_admin`, para que as leituras no escopo do proprietário por usuários autenticados possam usar o índice de proprietário. Consulte [Requisições de administrador e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` remove a política básica de servidor-ou-administrador de todas as tabelas. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` também define `request.jwt.claims` e `request.jwt.claim.*`, de modo que políticas escritas com `auth.uid()` reconheçam o chamador. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | O que a inicialização faz quando outro login pode alternar para o papel da requisição: `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Caminho base para todas as rotas da API. O cliente deve ser configurado com o mesmo valor — veja [Alterando `basePath`](#alterando-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve os assets estáticos/administrativos do bundle a partir deste processo. Desative quando houver uma CDN à frente. | `true` |
| `REBASE_HISTORY` | Registra o [histórico de alterações de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respostas compactadas com gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Corpo máximo da requisição, **em bytes** (`10485760`, não `10MB` — um valor que não seja número recusa a inicialização em vez de remover o limite silenciosamente). `0` desativa o limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | A superfície OpenAPI. Três estados (tri-state). <span class="since-badge" data-since="0.31">Desde 0.31</span> Não definida, em todos os ambientes: `/api/docs` é servido aos chamadores aos quais `GET /api/schema/tables` descreve tabelas, cada um recebendo o documento das tabelas descritas para si, e não há Swagger UI. `true` publica o documento completo para todos, com a **UI** do Swagger em `/api/swagger` fora de produção (nunca em produção). `false` mantém o documento restrito ao acesso de administrador. | — |
| `REBASE_METRICS` | Expõe métricas do Prometheus em `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Adiciona `includeSubDomains` ao cabeçalho `Strict-Transport-Security`, para que os navegadores recusem HTTP simples em todos os subdomínios do host por seis meses — incluindo hosts que este processo não atende. Ative somente quando todos os subdomínios do domínio forem exclusivamente HTTPS. Qualquer valor diferente de `true`/`false` recusa a inicialização. Consulte [Cabeçalhos de segurança](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer protegendo `/metrics`. Não definido deixa o endpoint aberto a qualquer entidade que possa alcançar a porta — aceitável em uma rede privada, não em uma pública, e os logs de inicialização alertam sobre isso. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer com o schema das tabelas na inicialização. `ensure` (o padrão em qualquer lugar — produção incluída) executa a etapa **aditiva**: cria tabelas, colunas e tipos enum ausentes, nunca descartando ou reescrevendo nenhum. `none` não altera o schema das tabelas declaradas, mas as próprias tabelas do framework (auth, chaves de API, jobs, cron) ainda são criadas e mantidas atualizadas; `REBASE_PROVISION=false` desativa essas também. A imagem publicada aceita apenas essas duas opções e **se recusa a inicializar com `push`**. Em um [deploy dividido (split deployment)](/docs/deployment/split-processes), exatamente um processo pode provisionar, portanto, qualquer outro papel deve definir `none` ou falhar na inicialização. | `ensure` |
| `REBASE_PROVISION` | `false` faz com que o runtime não altere nada em seu banco de dados: nenhuma tabela, coluna, índice, função, trigger, política, papel ou concessão (grant), na inicialização ou posteriormente, incluindo os do próprio framework. Em vez disso, relata o que está faltando pelo nome. Para um banco de dados que apenas seu processo de mudança pode alterar. Consulte [Quando apenas seu processo de mudanças pode alterar o banco de dados](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Apenas `true` e `false` são aceitos. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa a inicialização quando o banco de dados foi provisionado pela última vez a partir de um conjunto de tabelas diferente daquele para o qual este processo foi compilado. Não definido (ou qualquer coisa diferente de `true`/`1`) apenas emite um aviso. | aviso |
| `REBASE_REQUIRE_FILES_LOADED` | Recusa a inicialização quando um arquivo de função ou cron lança um erro ou falha no parse durante a importação, indicando cada arquivo e o motivo, para que um rolling deploy mantenha a versão antiga em execução. Uma reinicialização também segue essa regra. Não definido (ou qualquer coisa diferente de `true`) ignora o arquivo e serve o restante. Um arquivo importado sem erros que não exporta nenhuma função ou job é sempre ignorado, e não recusado. | ignorar |
| `REALTIME_CDC` | Captura de alterações a nível de banco de dados (CDC): `auto` (habilita onde a conexão suportar, fallback silencioso caso contrário), `trigger` (força o uso, avisa se for impossível), `wal` (lê alterações do write-ahead log em vez de triggers; requer `wal_level=logical` e um papel com permissão de replicação, caso contrário faz fallback para `trigger`), `off`. Consulte [Realtime](/docs/backend/realtime-cdc/). Prevalece sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instâncias para canais de broadcast e presença: `memory` ou `postgres`. Ignorado quando `realtime.bus` recebe um transporte já instanciado. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quantas inscrições um socket de realtime pode manter; a seguinte é recusada com `TOO_MANY_SUBSCRIPTIONS`. Um número inteiro positivo — qualquer outra coisa interrompe o servidor na inicialização. Prevalece sobre `realtime.maxSubscriptionsPerSocket`. Consulte [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Quantos sockets de realtime um usuário, ou uma chave de API, pode manter abertos em uma instância de servidor. Sockets de impersonação de um administrador contam contra o administrador. O login do próximo é recusado com `TOO_MANY_SOCKETS` e o socket é fechado (4002); o SDK continua tentando novamente, conectando-se assim que outro fechar. Um número inteiro positivo — qualquer outra coisa interrompe o servidor na inicialização. Prevalece sobre `realtime.maxSocketsPerUser`. | Sem limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | O tempo máximo que uma alteração espera pela nova busca (refetch) que a entrega aos assinantes ativos, em ms. Uma nova busca aguarda 300 ms sem alterações, e no máximo este tempo sob um fluxo constante de gravações. Um número inteiro positivo — qualquer outra coisa interrompe o servidor na inicialização. Prevalece sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Por quanto tempo o total de uma inscrição em uma lista grande pode ser reutilizado antes de ser recalculado, em ms; frames que o reutilizam trazem `meta.totalAsOf`. Não definido, cada frame é contado. Prevalece sobre `realtime.recountIntervalMs`. | Não definido |
| `REALTIME_RECOUNT_MIN_ROWS` | O menor total recente ao qual `REALTIME_RECOUNT_INTERVAL_MS` se aplica; listas menores são contadas a cada frame. Prevalece sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback sob `NODE_ENV=production`. Desativado por padrão, para que uma inicialização em produção falhe explicitamente em vez de tentar se conectar a um banco de dados inexistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` executa a etapa de schema e encerra sem abrir um socket — o formato que um Job de migração precisa, a partir da mesma imagem e do mesmo bundle que o servidor que o sucede. Também cria as tabelas que um processo servidor criaria no primeiro uso e não inicia cron nem fila de jobs. Um valor vazio é considerado *não definido*, garantindo que um `${SOMETHING}` não substituído em um arquivo compose não transforme um deploy normal em um que apenas migra e se recusa a atender requisições. Recusado quando combinado com `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Um caminho de arquivo. Uma execução de provisionamento (`REBASE_PROVISION_ONLY=true`) grava nele todas as alterações de schema feitas, em ordem, como um script SQL para revisão e aplicação via `psql`. Linhas gravadas não são incluídas. Recusado em um processo que serve requisições. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que uma máquina — um agente, um job de CI — *aplique* uma alteração de schema através de `/api/admin/schema`, e não apenas a planeje. Desativado a menos que solicitado: a credencial que faria tal alteração é a mais propensa a estar exposta em uma variável de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Quanto tempo uma função personalizada pode rodar antes que sua requisição seja abortada. Mesmo parâmetro que a opção `functionsTimeoutMs`. `0` desativa. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz com que uma rejeição de promise não tratada finalize o processo em vez de apenas registrá-la em log. Ativado sob um orquestrador que irá reiniciar o processo; desativado onde uma reinicialização for pior que um vazamento de recursos. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia o aviso de inicialização em uma plataforma que o runtime detecta como scale-to-zero, onde um timer acionado em uma instância ociosa não é acionado em instância alguma. Não altera mais nada: defina-o quando você mantiver pelo menos uma instância em execução contínua. | — |
| `TRUSTED_PROXY_HOPS` | Quantos proxies estão à frente deste servidor, permitindo que o rate limiter leia o endereço real do cliente a partir do `X-Forwarded-For`. Padrão seguro `0`: sem proxy, confiar no cabeçalho permitiria que qualquer chamador forjasse uma identidade. | `0` |

:::note[O provisionamento na inicialização é aditivo e não é uma ferramenta de migração]
A etapa de inicialização roda sem supervisão e sem ninguém revisando um diff, portanto, nunca removerá
uma coluna, restringirá um tipo ou reescreverá uma tabela. É também por isso que a imagem recusa
`REBASE_MIGRATE_ON_BOOT=push`: um push completo calcula um diff e executará alegremente
um `DROP COLUMN`, e o reinício de um container nunca deve ser capaz de destruir uma
coluna de produção como efeito colateral de um reagendamento.

Alterações destrutivas ou de reestruturação permanecem onde podem ser revisadas: `rebase db
generate` + `rebase db migrate`, ou `rebase db push` a partir de um checkout ou CI,
que simula a alteração (dry-run), recusa alterações destrutivas sem confirmação e
pode fazer um backup primeiro.
:::

### Deploys divididos (Split deployments)

Uma imagem e um bundle podem ser inicializados várias vezes, cada um servindo uma
parte diferente do projeto. Uma linha para cada aqui, pois esta página se propõe a
listar todas as variáveis; o que cada combinação *monta e controla* — e quais
combinações se recusam a inicializar — está em
**[Processos Divididos](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_ROLE` | Qual parte este processo serve: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Substitui a definição de se *este* processo executa os agendadores cron. Não definido segue o papel (`REBASE_ROLE`). | — |
| `REBASE_JOB_WORKERS` | Substitui a definição de se este processo executa workers de fila de jobs. Não definido segue o papel. | — |
| `REBASE_FUNCTIONS_ONLY` | Serve apenas as funções customizadas nomeadas neste processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Serve todas as funções customizadas, exceto as nomeadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Para onde o processo de API encaminha uma requisição de função que ele próprio não atende. Em um `worker`, para onde suas próprias chamadas `rebase.functions` são enviadas. Uma URL `http(s)`. | — |

### Superfície MCP

Um endpoint opcional do Model Context Protocol em `/mcp`, para que um cliente de IA possa ler
e gravar neste projeto **como o usuário autenticado**. Desativado a menos que configurado e — ao
contrário de qualquer outra superfície — nenhum `REBASE_ROLE` o ativa: os outros descrevem o
formato do processo, enquanto este é uma decisão de fornecer credenciais a software de
terceiros, devendo ser tomada por uma pessoa em vez de herdada da atribuição do container.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_MCP_ENABLED` | Monta a superfície MCP. Requer `REBASE_PUBLIC_URL`; sem ela, a superfície se recusa a montar e registra isso no log de inicialização. | `false` |
| `REBASE_PUBLIC_URL` | A origem externamente acessível deste deploy, por exemplo, `https://app.example.com`. A superfície MCP não pode derivá-la — obter a origem do cabeçalho `Host` tornaria a identidade do emissor e o público (audience) contra o qual seus próprios tokens são validados valores fornecidos pelo chamador. | — |
| `REBASE_MCP_VIEW` | Caminho para a visualização do MCP App do próprio projeto (`rebase-view.html`, gerada por `rebaseMcpViewPlugin()`), servida ao Claude no lugar da visualização genérica para que suas visualizações, campos e ações personalizadas sejam exibidos. Sem isso, o backend procura ao lado do frontend que ele atende. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite o registro dinâmico de clientes OAuth (RFC 7591), para que um cliente possa se cadastrar sozinho. Defina como `false` para exigir que os clientes sejam registrados com antecedência. | `true` |

### Edição de schema ao vivo a partir de um bundle

Desativado a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esteja definido. Um bundle compilado não tem
o código-fonte de `backend/schema` para editar, então, com essas variáveis configuradas, o editor de schema
lê o código-fonte do repositório, comita cada alteração de volta e executa seu DDL
neste banco de dados. Exclusivo para administradores e aplicado por uma pessoa, a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` determine o contrário. Um repositório especificado sem
uma credencial utilizável recusa a inicialização. Consulte
[Edição de schema ao vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | O repositório do GitHub no qual comitar as alterações de schema, como `owner/name`. Defini-lo é o que ativa o recurso. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | A branch na qual o commit é aplicado. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | <span class="since-badge" data-since="0.31">Desde 0.31</span> Onde `backend/schema` reside nesse repositório, relativo à raiz do repositório. Um caminho que saia do repositório recusa a inicialização, assim como a variável removida `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Um token fine-grained com acesso de leitura e escrita ao conteúdo do repositório. Defina este ou as três variáveis `_GITHUB_APP_*`, não ambos. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | O ID de um GitHub App, para comitar como o app em vez de usar um token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | A instalação do aplicativo no repositório. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | A chave privada do app: PEM, PEM com quebras de linha escapadas ou base64. | — |

### Backups

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `BACKUP_SCHEDULE` | Expressão cron para backups agendados. Não definida significa que os backups agendados estão desativados. | — |
| `BACKUP_DESTINATION` | Caminho local ou uma URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obrigatório com `BACKUP_SCHEDULE`, que se recusa a rodar sem ele. `rebase db backup` usa `./backups` como fallback no local em que foi executado. | — |
| `BACKUP_RETENTION_DAYS` | Exclui backups com mais de N dias. Não definido ou `0` mantém tudo. | — |
| `BACKUP_KEEP_MINIMUM` | Sempre retém pelo menos N dos backups mais recentes, independentemente do que a retenção definir. | — |
| `PG_DUMP_PATH` | Substitui o binário do `pg_dump` — deve ser a versão principal (major) do servidor ou mais recente. | — |
| `PG_RESTORE_PATH` | Substitui o binário do `pg_restore`. | — |
| `PSQL_PATH` | Substitui o binário do `psql` que o `rebase db restore --clean` executa para tornar a restauração uma única transação. | — |
| `PG_DUMPALL_PATH` | Onde o `pg_dumpall` reside, quando não estiver no `PATH`. Sem ele — e sem as ferramentas de cliente do PostgreSQL instaladas — um backup de globais falha com um erro indicando esta variável. | — |

A imagem oficial de runtime (`rebasepro/server`) já inclui as ferramentas de cliente do PostgreSQL 18,
de modo que um backup agendado roda nela contra qualquer servidor até o Postgres 18.
Fora da imagem, instale-as você mesmo (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups contêm segredos e dados pessoais identificáveis (PII). Use um destino privado com
criptografia em repouso.

### Entrega do bundle

Um deploy gerenciado não carrega seu código na imagem: o runtime busca um
bundle na inicialização. Estas variáveis decidem qual e como.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já extraído. O que o `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | De onde buscar o arquivo do bundle, quando não houver um local. | — |
| `REBASE_BUNDLE_TOKEN` | A credencial Bearer para essa busca. Trate-a como um segredo: é o que autoriza um tenant a baixar seu próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Onde um bundle baixado é extraído. Deve ter permissão de escrita e persistir entre a busca e a inicialização. | — |
| `REBASE_RUNTIME_MODULES` | Módulos extras que a imagem de runtime fornece ao bundle, além daqueles que ele próprio declara. | — |

### Vinculações de recursos (Resource bindings)

Cada banco de dados, bucket e tópico que um projeto declara em `backend/resources.ts` é
vinculado por variáveis de ambiente nomeadas a partir dele. Os nomes base estão abaixo; um
recurso não padrão anexa `__` e sua chave em maiúsculas, portanto um bucket chamado
`media` lê `S3_BUCKET__MEDIA`. O comando `rebase status`
exibe, por recurso,
a variável exata que está lendo e se ela está definida.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_DRIVER` | O pacote npm que implementa o driver de uma fonte de dados, quando não for o padrão do Postgres. Sufixado por fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | A string de conexão para um tópico declarado. Sufixada por tópico. | — |

### Ambiente da própria CLI

Lido pelo `rebase`, não pelo servidor. Nada aqui afeta um deploy.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BASE_URL` | Para onde `rebase api-keys`, `rebase storage` e `rebase auth reset-password` enviam a chave de serviço, no shell ou no `.env`. Defina quando o servidor rodar de outra maneira que não seja `rebase dev` neste projeto: `rebase start`, um container, outro host. Não definido, eles usam o servidor registrado pelo `rebase dev` enquanto esse servidor estiver rodando e não enviam nada quando não estiver. | — |
| `REBASE_SERVICE_KEY` | A chave de serviço com a qual esses comandos se autenticam, lida do `.env`: a mesma variável que o servidor lê (veja acima). | — |
| `SERVICE_KEY` | Um nome legado para essa chave. Quando o `.env` a define, `rebase api-keys` e `rebase storage` a leem no lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qual `.env` a CLI lê e grava, quando não for o do projeto. | — |
| `REBASE_ROOT_RULES` | `0` impede que `rebase init` e `rebase skills install` gravem as regras do projeto nos arquivos `CLAUDE.md` e `AGENTS.md` na raiz do repositório, útil para raízes onde você mantém os arquivos de agentes manualmente. | ativado |
| `REBASE_CLOUD_URL` | O plano de controle com o qual o `rebase cloud` se comunica. | — |
| `REBASE_CLOUD_EMAIL` | A conta com a qual o `rebase cloud login` faz login, em vez de solicitar interativamente. | — |
| `REBASE_CLOUD_PASSWORD` | Sua senha, permitindo que um gerenciador de segredos a forneça sem gravá-la no histórico do shell. | — |
| `REBASE_TOKEN` | Um token de `rebase cloud tokens create`. Quando definido, qualquer comando `rebase cloud` se autentica com ele em vez da sessão de `rebase cloud login`, e nunca lê ou grava a sessão armazenada. Em um diretório vinculado por `rebase cloud init --claim`, ele é reservado para o próprio token do projeto quando não tiver escopo sobre o projeto. A forma de executar o `rebase cloud` em CI — consulte [CI e agentes](/docs/deployment/cloud/#ci-and-agents). O [servidor MCP](/docs/ai/mcp/) o repassa para a CLI gerada por suas ferramentas em nuvem e nunca o envia para a aplicação: defina `REBASE_API_TOKEN` para isso. | — |
| `REBASE_DEBUG` | `1` exibe o erro subjacente e os detalhes da requisição em vez da mensagem curta. A primeira coisa a configurar quando um comando `rebase cloud` falhar sem detalhes úteis. | — |
| `REBASE_ATLAS_DEV_URL` | O banco de dados vazio contra o qual `rebase db push`, `db generate` e `db migrate` planejam alterações, em vez do `<db>_dev_diff` que eles criam ao lado de `DATABASE_URL`. O Rebase não cria nem descarta um banco de dados nomeado aqui, e recusa um igual a `DATABASE_URL`. No banco de dados de desenvolvimento gerenciado, a CLI o define para um PGlite temporário em memória próprio. Configure-o onde `CREATE DATABASE` não for concedido. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` não inicializa nenhum banco de dados e não provisiona nada — você fornece o seu próprio. O mesmo que `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento do frontend, que de outra forma o `rebase dev` derivaria do caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Quanto tempo o `rebase dev` aguarda o backend se anunciar antes de informar que ele não iniciou. `0` desativa o relatório. | `30000` |
| `DATABASE_PASSWORD` | A senha que o `rebase dev --docker` insere na string de conexão derivada do `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | A convenção padrão entre ferramentas. Defina como qualquer valor diferente de `0` e a CLI não enviará telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | O mesmo, especificamente para o Rebase. Não requer arquivo, por isso é a opção recomendada para uso em CI e em imagens. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Para onde a telemetria é enviada, no caso de um coletor auto-hospedado. | — |

## Segredos em desenvolvimento

`JWT_SECRET` é obrigatório em produção. Ele e `REBASE_SERVICE_KEY` são
gerados para você fora de produção, para que você possa começar sem configurar nada.

Esses valores gerados são armazenados em cache em `.rebase-dev-secrets.json`, ao lado de
`.rebase-dev-port` e `.rebase-dev-url`, e ignorados no Git com eles. Anteriormente, eles
eram regenerados a cada inicialização — logo, reiniciar o servidor de desenvolvimento desconectava você
de sua própria aplicação e invalidava qualquer chave de API recém-criada.

- Defina qualquer uma das variáveis explicitamente e a sua será usada; nada é armazenado em cache ou lido.
- Aponte o cache para outro local com `REBASE_DEV_SECRETS_FILE` — um caminho, e a
  única variável nesta seção que você definiria deliberadamente.
- Exclua o arquivo para renovar ambos os segredos. A próxima inicialização gravará um novo.
- Se o arquivo não puder ser gravado — em um container somente leitura, por exemplo —, o servidor inicia
  mesmo assim com um segredo efêmero, exatamente como costumava fazer.

Nada é armazenado em cache em produção ou sob um executor de testes. Em produção, nada
é gerado também: uma inicialização sem `JWT_SECRET` falha, informando o nome da variável, e
isso permanece inalterado:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objeto de Configuração do Backend

<span class="since-badge" data-since="0.31">Desde 0.31</span>

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
sem `app`, `server` e `basePath` e com um `provision` obrigatório, compilam um
backend que não serve nada até que você o monte: `createRebaseBackend`. Consulte
[Integração de Servidor Customizado](/docs/backend/custom-server/).

### Alterando `basePath`

`basePath` move todas as rotas da API, portanto o cliente deve ser informado sobre a mesma coisa —
caso contrário, ele continuará requisitando `/api/...` e receberá 404 em tudo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel administrativo obtém isso a partir do cliente fornecido; nada mais precisa
ser configurado. Se você montar uma URL de requisição manualmente, concatene-a a partir do
cliente em vez de escrever `/api` você mesmo:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solução de Problemas

### Permissão Negada no Editor SQL (`permission denied for table <name>`)

* **Sintomas:** Consultas customizadas executadas no editor SQL do Rebase Studio falham com `cause: error: permission denied for table <name>`, mesmo que a visualização de planilha do CMS carregue os dados com sucesso.
* **Causa:** Por padrão, o Rebase tenta executar consultas do Editor SQL alternando temporariamente os papéis do banco de dados para corresponder ao papel de aplicação do usuário ativo (por exemplo, `SET LOCAL ROLE "admin"`). Se você estiver usando autenticação customizada em que os papéis existem apenas em tabelas do banco de dados em vez de papéis reais do PostgreSQL, a alternância de papel falha ou os privilégios do banco de dados ficam ausentes. A visualização de planilha do CMS é executada com o usuário proprietário da conexão padrão e ignora isso.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` à configuração do `.env` do seu backend. Isso força o Rebase a executar as consultas do Editor SQL usando os privilégios do proprietário da conexão (geralmente um superuser/owner). O Editor SQL então informa, acima dos resultados, que eles foram lidos como o proprietário da conexão e desabilita o seletor de papéis.

### Falha na Busca de Schema no Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio falha ao carregar a árvore de schema, ou o Editor SQL lança `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** O Rebase requer privilégios administrativos para consultar os catálogos de sistema do banco de dados e executar comandos administrativos. Se `adminConnectionString` não for fornecida ao inicializador (bootstrapper), ou se `getAdmin()` for sobrescrito para retornar `undefined`, essas operações falham.
* **Solução:** Garanta que `adminConnectionString` esteja configurada durante a inicialização do bootstrapper do backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Próximos Passos

- **[Deploy](/docs/getting-started/deployment)** — Guia de deploy em produção
- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
