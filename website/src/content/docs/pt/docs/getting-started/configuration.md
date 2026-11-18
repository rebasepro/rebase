---
sourceHash: 69431837d4a9e199
title: Ambiente & Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita por meio de variáveis de ambiente no arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida as variáveis de ambiente com o **Zod** na inicialização. Se
> algo obrigatório estiver faltando ou malformado (uma URL que não é uma URL, uma porta que
> não é um número), o servidor se recusa a inicializar e indica o nome da variável.
>
> O local onde o schema reside depende de como você executa o backend. Um projeto inicializado
> pelo runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o
> schema pertencente ao runtime (`loadBootEnv` em `@rebasepro/server`), que é a
> união de todas as tabelas abaixo. Um projeto que executou [`rebase eject`](/docs/cli)
> possui um `backend/src/env.ts` chamando `loadEnv({ extend })`, e pode adicionar suas próprias
> variáveis tipadas lá.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | String de conexão do PostgreSQL. **Opcional em desenvolvimento** — se não configurada, `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Obrigatória em todos os outros ambientes. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinar tokens JWT. Use uma string aleatória forte (mínimo de 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> **Em um banco de dados gerenciado, `sslmode=require` pode não significar o que parece.**
>
> Para o `psql` e todas as ferramentas baseadas em libpq, `require` significa "criptografado,
> certificado não verificado". O driver Node no qual o Rebase é executado o lê como `verify-full`,
> portanto, um banco de dados cujo certificado não foi assinado por nenhuma autoridade pública —
> comum em instâncias gerenciadas do Postgres — recusa o runtime com `self-signed certificate`,
> enquanto o `psql` conecta com a mesma URL. O runtime e os comandos `rebase db` são
> interrompidos com uma mensagem informando isso.
>
> Escolha uma opção:
>
> - **`sslmode=no-verify`** — criptografado, não verificado: o que `require` significa para
>   a libpq. É uma sintaxe do node-postgres inexistente na libpq, portanto `psql`, `pg_dump`
>   e Atlas a recusam com `invalid sslmode value: "no-verify"`. Os comandos próprios do Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) repassam isso para eles como
>   `sslmode=require`, de modo que funcionam com a URL conforme configurada; para usar o
>   `psql` manualmente, substitua por `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — verificado em relação ao certificado
>   da CA do provedor. Igual para todas as ferramentas.
>
> `uselibpqcompat=true&sslmode=require`, sugerido pelo próprio aviso do driver Node,
> também funciona para o runtime; os comandos do Rebase removem `uselibpqcompat`
> antes de entregar a URL para as ferramentas da libpq, que o rejeitam.

### Frontend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `VITE_API_URL` | URL da API do backend para o SDK tipado. **Defina apenas em desenvolvimento** — veja abaixo. | origem da página |
| `VITE_GOOGLE_CLIENT_ID` | Client ID do Google OAuth. Habilita "Entrar com o Google". | — |


> **Deixe `VITE_API_URL` indefinida em builds de produção.**
>
> Em desenvolvimento, o frontend e o backend têm origens separadas, portanto o servidor de
> desenvolvimento injeta isso. Em produção, o backend do Rebase serve a SPA, portanto a
> API é a própria origem da página e o cliente a resolve dessa forma por conta própria.
>
> Embutir uma URL absoluta em um bundle de produção funciona perfeitamente até que um segundo
> hostname aponte para a mesma aplicação: um domínio personalizado então carrega a página a partir de
> `example.com` e chama a API em `example.rebase.website`, o que é cross-origin, fazendo com
> que cada requisição falhe no preflight. Permitir a origem no CORS **não** resolve o problema —
> o cookie de atualização é `SameSite=Lax` e não é enviado entre sites (cross-site), então você
> eliminaria os erros do console e ainda continuaria com a autenticação quebrada. Quando não
> definida, qualquer domínio que aponte para a aplicação funciona sem necessidade de nenhuma
> configuração de CORS.

### Backend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta para o servidor HTTP do backend. Lida por `rebase start`. `rebase dev` a lê **apenas do ambiente do shell** — um `PORT` no `.env` não é lido lá, pois a porta é resolvida antes do carregamento desse arquivo — e, caso contrário, vincula uma porta derivada do caminho do projeto, permitindo que vários projetos rodem simultaneamente. `rebase dev --port` tem precedência sobre ambos, e o banner inicial exibe a opção utilizada. | `3001` |
| `LOG_LEVEL` | Verbosidade dos logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Exibe o SQL por trás de uma linha `Failed query: [redacted]`. Cada declaração com falha é ocultada por padrão, porque uma consulta com falha carrega seus parâmetros vinculados — um e-mail, um hash de senha. Defina como `true` ao diagnosticar uma falha de DDL, RLS ou captura de alterações. Ignorado quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Lista separada por vírgulas de origens permitidas. **Obrigatório em produção**, a menos que `FRONTEND_URL` esteja definido: uma inicialização de produção sem nenhum dos dois se recusará a iniciar. Em desenvolvimento, é *adicionado a* localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL da aplicação frontend. Usada como alternativa ao CORS_ORIGINS, em ambos os ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão de nível administrativo com o banco de dados (usada para introspecção de schema e operações administrativas). O banco de dados informado por ela não é aquele que o console SQL considera atual, nem o que uma nova branch copia por padrão: ambos são o banco de dados no qual a própria conexão da aplicação está (consulte `REBASE_BRANCH_PARENT_DATABASE` para um servidor em uma branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a alternância de papéis (roles) do PostgreSQL no Editor SQL (útil para autenticação personalizada onde as roles do banco de dados não estão mapeadas). O console SQL do Studio indicará que as linhas foram lidas como o proprietário da conexão, exibirá seu nome e desabilitará o seletor de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | O banco de dados a partir do qual a branch na qual este servidor é executado foi copiada. `rebase dev` o define em um checkout [alternado para uma branch](/docs/backend/branching/#cli-integration). Um servidor com essa configuração mantém o registro de branches nesse banco de dados e copia novas branches a partir dele por padrão, de modo que o painel Branches do Studio exibe as branches do banco de dados principal. | — |

#### CORS em desenvolvimento

O ambiente de desenvolvimento permite **o localhost, mais qualquer valor definido em `CORS_ORIGINS` (ou `FRONTEND_URL`)**
— a mesma lista que a produção usa, com o localhost adicionado em vez de
substituído. Portanto, a variável funciona da mesma maneira em ambos os ambientes, e os
casos que precisam dela em desenvolvimento são os usuais:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não seja localhost nem esteja listada é recusada, e a recusa é
registrada nos logs **uma vez por origem** com a linha exata que a permitiria. Recusar não é
apenas cautela excessiva: a API envia credenciais, portanto refletir uma
`Origin` arbitrária permitiria que qualquer site visitado pelo desenvolvedor fizesse
requisições autenticadas contra o servidor de desenvolvimento usando sua sessão e lesse as
respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `JWT_SECRET` | Segredo para assinatura de JWT (obrigatório em produção, gerado automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso de forma assimétrica (RS256), permitindo que qualquer parte com o JWKS verifique uma sessão sem poder emitir uma. Aceita uma PEM com quebras de linha reais, uma PEM com escapes `\n` ou base64 de toda a PEM. Sem isso, os tokens permanecem em HS256. | — |
| `JWT_KEY_ID` | Nomeia a `JWT_PRIVATE_KEY` no cabeçalho do token e no JWKS. Altere sempre que a chave for modificada — a rotação depende de o antigo e o novo serem distinguíveis. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de vida do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de vida do token de atualização (refresh token). Deslizante — cada rotação o renova, determinando por quanto tempo uma sessão sobrevive à **inatividade**. Defina `400d` para sessões que sobrevivem a uma longa ausência; os navegadores limitam o cookie de atualização a esse período. | `30d` |
| `ALLOW_REGISTRATION` | Permite que novos usuários se cadastrem (`true`/`false`). Fora de produção, o **primeiro** usuário sempre pode se cadastrar, independentemente desta configuração — uma tabela de usuários vazia precisa admitir alguém, e esse alguém se torna o administrador. Em produção (`NODE_ENV=production`), essa janela é fechada: uma tabela vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma primeira conta criada via registro aberto é uma conta comum, e o administrador é definido com `REBASE_ADMIN_EMAIL` abaixo ou atribuído via chave de serviço. O `.env.example` do scaffold o define como `true`; o padrão do framework é desativado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Mecanismo de desativação (kill switch). Fecha a janela de bootstrap do primeiro usuário que `ALLOW_REGISTRATION=false` deixa deliberadamente aberta fora de produção, de modo que o registro permaneça fechado mesmo com um banco de dados vazio. Combine com `REBASE_ADMIN_EMAIL` abaixo, caso contrário o deploy não terá como produzir seu primeiro chamador autenticado. Todos os artefatos de deploy enviados o definem. | — |
| `REBASE_ADMIN_EMAIL` | E-mail da primeira conta de administrador, criada na inicialização **enquanto a tabela de usuários ainda estiver vazia** e nunca depois disso. É assim que uma implantação em produção obtém seu administrador: o operador define a primeira conta em vez de disputar contra a internet pública. A inicialização emite um aviso quando a tabela estiver vazia em produção e essa variável não estiver definida. | — |
| `REBASE_ADMIN_PASSWORD` | Senha para essa conta. Pelo menos 12 caracteres, caso contrário será recusada e a conta não será criada. Altere-a após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Criptografa cada segredo TOTP armazenado. Se não definida, os segredos serão criptografados com `JWT_SECRET` e a inicialização emitirá um aviso — portanto, rotacionar `JWT_SECRET` desconectará todos *e* tornará todos os autenticadores configurados indecifráveis. Defina uma chave dedicada (32+ caracteres aleatórios) antes que alguém se registre no MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave anterior durante o processo de rotação. Defina ambas durante uma rotação: novos segredos serão gravados com `MFA_ENCRYPTION_KEY` e os existentes ainda poderão ser lidos, para que ninguém seja bloqueado de sua própria conta durante a transição. Remova-a assim que todos os segredos forem recriptografados. | — |
| `ALLOW_ANONYMOUS` | Habilita o login anônimo (`POST /api/auth/anonymous`). Opcional (opt-in) e deliberadamente não bloqueado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina como `false` para uma superfície de leitura totalmente pública — as políticas de RLS ainda se aplicam. | `true` |
| `AUTH_DEFAULT_ROLE` | Papel (role) atribuído a um usuário recém-registrado quando nenhum for especificado. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta a rota `POST /api/auth/find-user`, que resolve um e-mail para um perfil público mínimo (`uid`, `displayName`, `photoURL`) para fluxos de convite por e-mail. Apenas para chamadores autenticados e nunca retorna o e-mail, papéis ou metadados do usuário encontrado. Desativado por padrão: é uma superfície de enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Atributo `SameSite` no cookie de atualização: `Strict`, `Lax` ou `None`. `None` exige HTTPS e serve apenas para frontends genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Atributo `Secure` no cookie de atualização. Seguro por padrão; `AUTH_COOKIE_SECURE=false` para HTTP comum — uma implantação em um endereço de LAN onde o navegador descartaria o cookie e a sessão expiraria junto com o token de acesso sem nenhum erro. Emite um aviso na inicialização. `http://localhost` não precisa disso. | `true` |
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
| `GITLAB_CLIENT_ID` | ID do cliente OAuth do GitLab. A `baseUrl` de uma instância auto-hospedada não possui configuração por variável de ambiente — configure o GitLab no bloco `auth` para isso. | — |
| `GITLAB_CLIENT_SECRET` | Segredo do cliente OAuth do GitLab | — |
| `BITBUCKET_CLIENT_ID` | ID do cliente OAuth do Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Segredo do cliente OAuth do Bitbucket | — |
| `SLACK_CLIENT_ID` | ID do cliente OAuth do Slack | — |
| `SLACK_CLIENT_SECRET` | Segredo do cliente OAuth do Slack | — |
| `SPOTIFY_CLIENT_ID` | ID do cliente OAuth do Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Segredo do cliente OAuth do Spotify | — |
| `APPLE_CLIENT_ID` | Services ID da Apple, para login web. É público e disponibilizado em `GET /auth/config`. A Apple não possui segredo de cliente estático, pois o Rebase assina um JWT ES256 de curta duração para cada troca de token. Portanto, a Apple requer `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, além deste ou de `APPLE_BUNDLE_IDS`, e não configura nada sem eles. | — |
| `APPLE_BUNDLE_IDS` | IDs de pacote (bundle ids) separados por vírgula dos aplicativos nativos iOS/macOS cujos códigos de Sign in with Apple são aceitos. | — |
| `APPLE_TEAM_ID` | ID da equipe de desenvolvedores da Apple (Apple Developer Team ID), o emissor do JWT. | — |
| `APPLE_KEY_ID` | ID da chave privada registrada na Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, incluindo quebras de linha (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave de API estática de administrador. Ignora a autenticação normal via JWT para chamadas de servidor para servidor quando passada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Chave pública da plataforma de hospedagem (PEM, EC P-256) contra a qual os tokens de plataforma `rpt_` são verificados; múltiplos blocos PEM durante uma rotação de chave. A plataforma a define no deploy, e ela não contém dados secretos. Junto com `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que a validação de admin aceite um token de plataforma para `cron:read`, e para nada mais. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | O ID do projeto com o qual a claim `aud` de um token de plataforma deve coincidir, para que um token emitido para outro projeto seja recusado. Com apenas uma das duas variáveis definida, o servidor inicializa, registra um aviso e responde a qualquer token `rpt_` com `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Onde os contadores de limite de taxa residem, tanto para as rotas de autenticação quanto para `rateLimit` em funções personalizadas: `memory` (por processo) ou `sql` (compartilhado entre réplicas). Um processo não pode ver sua própria contagem de réplicas, então uma implantação com instâncias paralelas precisa especificar — três réplicas no padrão aplicam três vezes o limite. Qualquer outro valor **recusa a inicialização** em vez de usar fallback, incluindo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monta o fluxo de link de login sem senha (magic link). Requer um serviço de e-mail configurado, caso contrário o link não terá para onde ser enviado. | `false` |
| `AUTH_EMAIL_OTP` | Monta o login sem senha com um código de seis dígitos enviado por e-mail. Mesma exigência de e-mail que a opção acima. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Cadastro sem senha: uma solicitação de magic link ou código por e-mail para um endereço desconhecido cria a conta, enquanto o registro estiver aberto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportamento quando um token de atualização é reutilizado fora de sua janela de reutilização: `reject` (recusa o token, mantém a sessão) ou `revoke-session` (encerra a sessão). Qualquer outro valor causa falha na inicialização. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro com confirmação prévia: nenhum login por senha é permitido até que o endereço de e-mail seja verificado. Requer serviço de e-mail; a inicialização recusa sem ele. | `false` |
| `CAPTCHA_PROVIDER` | Ativa a verificação de captcha nas rotas de autenticação: `turnstile` ou `hcaptcha`. Não definida significa sem captcha. | — |
| `CAPTCHA_SECRET` | O segredo do provedor, usado no servidor para verificar o token enviado pelo navegador. Obrigatório quando `CAPTCHA_PROVIDER` estiver definido. | — |
| `CAPTCHA_ROUTES` | Rotas de autenticação separadas por vírgula a serem protegidas (por exemplo, `register,login`). Não definida protege o conjunto padrão do provedor. | — |

### Armazenamento

:::caution[O Storage não tem segurança em nível de linha, portanto precisa de um modelo de acesso]
As tabelas são protegidas pelo RLS do Postgres. O armazenamento de objetos não possui equivalente —
as chaves compartilham um único namespace simples — portanto, com um bucket configurado e sem modelo de acesso,
o servidor **se recusa a inicializar em produção**. Satisfaça isso com exatamente um dos seguintes:
um hook `storageAuthorize` exportado de `backend/storage.ts` (fornecido pelo scaffold),
`STORAGE_PUBLIC_READ` ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `STORAGE_TYPE` | Backend de armazenamento: `local`, `s3` ou `gcs`. Em produção, `local` desativa o armazenamento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para armazenamento local. Um caminho relativo é lido a partir do diretório em que o servidor executa: a raiz do projeto em `rebase dev`, `backend/` em um servidor gerado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite armazenamento local em produção — apenas com um volume persistente contendo `STORAGE_PATH` e os diretórios `<STORAGE_PATH>__<key>` dos buckets locais nomeados ao lado dele | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante os quais a URL de download de um arquivo privado é válida — o token inserido por `getSignedUrl()`. No máximo `604800` (uma semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Tamanho máximo de arquivo aceito pela fonte, em bytes, em todas as rotas de upload — `__<KEY>` para uma fonte nomeada. Valores que não forem números inteiros de bytes impedem a inicialização | `52428800` (50 MB) |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região da AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso da AWS (Access Key ID) | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta da AWS (Secret Access Key) | — |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Força URLs no estilo path-style para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto GCP. Geralmente inferido das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para o arquivo de chave da conta de serviço (service account). Omita no GCP, onde o Workload Identity fornece as credenciais. | — |
| `STORAGE_PUBLIC_READ` | Serve todos os objetos publicamente, sem token. Apenas para buckets que realmente funcionem como CDN pública. Uma das três maneiras de satisfazer a validação de inicialização descrita acima. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que qualquer usuário autenticado leia, grave, liste e exclua todos os objetos. Chamado de `INSECURE` no objeto de configuração por um motivo: só é justificável em aplicativos single-tenant onde todas as contas têm permissão total sobre todos os arquivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Armazena em cache rendições de imagem geradas (redimensionamentos, conversões de formato) em vez de gerá-las por requisição. | `false` |

### E-mail (Opcional)
<span class="since-badge" data-since="0.34">Desde 0.34</span> `MAGIC_LINK_URL`.

| Variável | Descrição |
|----------|-----------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Habilita conexão segura (`true`/`false`) |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `SMTP_FROM` | Endereço do remetente para e-mails do sistema |
| `SMTP_NAME` | Nome de exibição no endereço do remetente |
| `APP_NAME` | Nome do produto usado nos assuntos e corpos dos e-mails (padrão: `Rebase`) |
| `EMAIL_LOGO_URL` | Logotipo exibido no topo dos modelos de e-mail padrão. PNG ou JPG com `http(s)` absoluto — clientes de e-mail removem SVG e bloqueiam URIs `data:`. Não configurado, um app ainda chamado `Rebase` recebe a marca do Rebase e um renomeado não recebe nenhuma |
| `MAGIC_LINK_URL` | Para onde aponta um magic link enviado por e-mail. Uma URL base recebe `/auth/magic-link?token=…` anexado; uma URL contendo `{token}` representa o link completo, para um frontend que não atende em `/auth/magic-link`. Use aspas no `.env`, onde um `#` sem aspas inicia um comentário: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Um valor com hash ou caminho de arquivo e sem `{token}` gera um aviso na inicialização. Não configurado, a base é `FRONTEND_URL` |

### Pool de conexões do banco de dados

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `DB_POOL_MAX` | Máximo de conexões no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milissegundos em que uma conexão ociosa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milissegundos de espera por uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (sem pool). O [Realtime](/docs/backend/realtime) requer uma: `LISTEN`/`NOTIFY` não sobrevive a um pooler em modo de transação como o PgBouncer, e sem isso as notificações de alteração são desativadas com um aviso em vez de serem perdidas silenciosamente. O [job worker](/docs/backend/jobs) também mantém seu `LISTEN` de ativação nela. Preenche o `directConnectionString` do adaptador Postgres quando este não estiver configurado. | — |
| `DATABASE_READ_URL` | Réplica de leitura, como um hot standby. Ao apontar para outro servidor, leituras autenticadas (listagens, registros únicos, contagens, agregações) são atendidas lá sob a mesma segurança em nível de linha (RLS); gravações, login, realtime, crons, jobs, o console SQL e `rebase.sql` permanecem no primário. Um leitor que acabou de gravar lê do primário por `REBASE_READ_STICKY_MS`, e todos leem do primário enquanto a réplica estiver com atraso superior a `REBASE_READ_MAX_LAG_MS` ou falhando. Preenche o `readConnectionString` do adaptador Postgres quando não configurado; até a versão 0.28 (inclusive), o pool da réplica era aberto e nunca lido. | — |
| `REBASE_READ_STICKY_MS` | Após uma gravação, tempo durante o qual as leituras do mesmo usuário vão para o primário, garantindo que um salvamento seguido de uma listagem exiba a alteração. Por instância do servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Atraso máximo da réplica acima do qual todas as leituras vão para o primário. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa por um pooler em modo de transação como o PgBouncer. O pool não envia `search_path` ou `statement_timeout` na conexão (o pooler os recusaria ou descartaria) e define ambos em cada transação; a inicialização atribui à role do banco de dados um `search_path` padrão de `public` para instruções fora de uma transação. `DATABASE_DIRECT_URL` passa a ser obrigatório, e o realtime, o sinalizador do worker de jobs, a criação de índices, o branching e o console SQL usam-no. A URL da réplica também é considerada em pool. `DATABASE_POOLED__<KEY>` para outra fonte de dados. | — |
| `REBASE_DB_POOL_MAX` | Um limite máximo em cada pool do processo, aplicado independentemente do que cada um solicitou. Apenas dígitos puros: um valor malformado é ignorado em vez de serializar silenciosamente o servidor. | — |

### Comportamento do runtime

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem de servidor
publicada. Um projeto que foi ejetado gerencia essas decisões em seu próprio código.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_RLS_AUDIT` | `true` executa a [auditoria programada de segurança em nível de linha (RLS)](/docs/rls-check#running-it-on-a-schedule), que relata tabelas servidas sem políticas. O projeto deve declarar `@rebasepro/rls-check` entre suas dependências: o runtime não inclui uma cópia e, sem o pacote, a inicialização é recusada, informando o nome do pacote. `false` mantém a verificação desativada neste processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | A role do Postgres com a qual as requisições autenticadas e anônimas são executadas. Dê a cada projeto em um cluster compartilhado a sua própria role. Um banco de dados registra a role com a qual opera, e uma inicialização configurada para outra se recusa a iniciar até que `rebase db request-role migrate` a migre. Consulte [Executando em um banco de dados existente ou compartilhado](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` cria a role de requisição e permite que a conexão alterne para ela; `never` deixa ambas a seu cargo e apenas as verifica. | `auto` |
| `REBASE_RLS_GRANTS` | O que o Rebase concede à role de requisição: `schema` (todas as tabelas nos schemas que ele atende, além de privilégios padrão), `managed` (apenas as tabelas que ele atende) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe as políticas permissivas do Rebase à(s) role(s) de requisição, para que outras roles que leem as mesmas tabelas não recebam nada delas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` define as políticas que apenas o contexto do servidor ou um administrador podem passar `TO public`, e executa administradores como a role de requisição. Por padrão, são `TO rebase_admin`, para que leituras no escopo do proprietário por usuários autenticados possam usar o índice de proprietário. Consulte [Requisições de administrador e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` remove a política básica de servidor ou administrador de todas as tabelas. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` também define `request.jwt.claims` e `request.jwt.claim.*`, para que políticas escritas com `auth.uid()` vejam o chamador. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | O que a inicialização faz quando outro login pode alternar para a role de requisição: `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Caminho base para todas as rotas de API. O cliente deve ser configurado com o mesmo valor — veja [Alterando `basePath`](#alterando-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve os arquivos estáticos/de admin do bundle a partir deste processo. Desative quando uma CDN estiver à frente. | `true` |
| `REBASE_HISTORY` | Registra o [histórico de alterações de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respostas com gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` ativa as [notificações push](/docs/backend/push-notifications/): as rotas `/api/push`, a tabela `rebase.push_subscriptions` e `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | O par de chaves VAPID com o qual as mensagens push são assinadas. Fora de produção, um par é gerado e armazenado em `.rebase-dev-secrets.json` quando não definido; em produção, o push permanece desativado sem elas. | — |
| `REBASE_VAPID_SUBJECT` | Um endereço `mailto:` ou URL `https://` pelo qual os serviços de push podem entrar em contato. O padrão é a origem de um `REBASE_PUBLIC_URL` em `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Tamanho máximo do corpo da requisição, **em bytes** (`10485760`, não `10MB` — um valor que não seja um número impede a inicialização em vez de remover silenciosamente o limite). `0` desativa o limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | A interface OpenAPI. Três estados. Não configurada, em todos os ambientes: `/api/docs` é servido aos chamadores para os quais `GET /api/schema/tables` descreve tabelas, cada um recebendo a documentação das tabelas descritas, e não há UI do Swagger. `true` publica o documento completo para todos, com a **UI** do Swagger em `/api/swagger` fora de produção (nunca em produção). `false` mantém o documento protegido pelo acesso de administrador. | — |
| `REBASE_METRICS` | Expõe métricas do Prometheus em `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Adiciona `includeSubDomains` ao cabeçalho `Strict-Transport-Security`, para que navegadores recusem HTTP simples em todos os subdomínios do host por seis meses — incluindo hosts não atendidos por este processo. Ative somente quando todos os subdomínios do domínio forem exclusivamente HTTPS. Qualquer valor diferente de `true`/`false` impede a inicialização. Consulte [Cabeçalhos de segurança](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer protegendo `/metrics`. Não definido deixa o endpoint aberto a qualquer coisa que alcance a porta — adequado para uma rede privada, mas não para uma pública, e os logs de inicialização alertam sobre isso. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer com o schema das tabelas na inicialização. `ensure` (o padrão, em qualquer lugar — produção incluída) executa a passagem **aditiva**: cria tabelas, colunas e tipos enum ausentes, nunca descartando ou reescrevendo nada. `none` não altera o schema das tabelas declaradas, mas as tabelas do próprio framework (auth, chaves de API, jobs, cron) continuam sendo criadas e mantidas atualizadas; `REBASE_PROVISION=false` desativa essas também. A imagem publicada aceita apenas essas duas opções e **se recusa a inicializar com `push`**. Em uma [implantação dividida](/docs/deployment/split-processes), exatamente um processo pode provisionar, portanto qualquer outro papel deve definir `none` ou se recusará a inicializar. | `ensure` |
| `REBASE_PROVISION` | `false` faz com que o runtime não altere nada em seu banco de dados: nenhuma tabela, coluna, índice, função, trigger, política, role ou concessão, na inicialização ou posteriormente, incluindo as do próprio framework. Ele relata o que está faltando pelo nome. Para bancos de dados onde apenas seu processo de migração pode aplicar alterações. Veja [Quando apenas seu processo de mudanças pode alterar o banco de dados](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Apenas `true` e `false` são aceitos. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa a inicialização quando o banco de dados foi provisionado pela última vez a partir de um conjunto de tabelas diferente daquele a partir do qual este processo foi compilado. Não definido (ou qualquer valor diferente de `true`/`1`) apenas emite um aviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Recusa a inicialização quando um arquivo de função ou cron lança um erro ou falha no parsing durante a importação, nomeando cada arquivo e o motivo, garantindo que um rolling deploy mantenha a versão antiga em execução. Um reinício também segue essa regra. Não definido (ou qualquer valor diferente de `true`) ignora o arquivo e atende o restante. Um arquivo que é importado sem erros e não exporta nenhuma função ou job é sempre ignorado, e não recusado. | skip |
| `REALTIME_CDC` | Captura de alterações a nível de banco de dados: `auto` (lê alterações do WAL onde o banco de dados permitir, caso contrário usa triggers, e se não for possível faz fallback para nível de aplicação, registrando cada fallback como info), `trigger` (força o uso de triggers, alerta se impossível), `wal` (lê alterações do write-ahead log em vez de triggers; requer `wal_level=logical` e uma role com permissão de replicação, revertendo para `trigger` caso contrário), `off`. Consulte [Realtime](/docs/backend/realtime-cdc/). Tem precedência sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instâncias para canais de broadcast e presença: `memory` ou `postgres`. Ignorado quando `realtime.bus` recebe um transporte instanciado. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quantas assinaturas um socket realtime pode manter; a seguinte é recusada com `TOO_MANY_SUBSCRIPTIONS`. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSubscriptionsPerSocket`. Consulte [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Quantos sockets realtime um único usuário, ou uma chave de API, pode manter abertos em uma instância de servidor. Sockets de impersonação de um administrador contam contra o administrador. O próximo login é recusado com `TOO_MANY_SOCKETS` e o socket é fechado (4002); o SDK continua tentando reconectar, obtendo acesso assim que outro fechar. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSocketsPerUser`. | Sem limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo máximo que uma alteração aguarda pela nova busca (refetch) que a entrega aos assinantes ativos, em ms. Uma nova busca aguarda 300 ms sem nenhuma alteração, e no máximo este tempo sob um fluxo constante de gravações. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Tempo durante o qual o total de uma assinatura de listagem grande pode ser reutilizado antes de ser contado novamente, em ms; frames que o reutilizam trazem `meta.totalAsOf`. Não definido, cada frame conta novamente. Tem precedência sobre `realtime.recountIntervalMs`. | Não definido |
| `REALTIME_RECOUNT_MIN_ROWS` | O menor valor do último total ao qual `REALTIME_RECOUNT_INTERVAL_MS` se aplica; listas menores são contadas a cada frame. Tem precedência sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback sob `NODE_ENV=production`. Desativado por padrão, para que uma inicialização em produção falhe explicitamente em vez de conectar a um banco de dados inexistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` executa a verificação do schema e encerra sem abrir uma porta de rede — formato desejado para um Job de migração, usando a mesma imagem e o mesmo bundle do servidor que virá em seguida. Também cria as tabelas que um processo de atendimento criaria no primeiro uso, e não inicia nenhum cron ou fila de jobs. Um valor vazio é considerado *indefinido*, garantindo que uma variável `${SOMETHING}` não substituída em um arquivo compose não transforme uma implantação comum em uma que apenas migra e se recusa a atender. Recusado se usado junto com `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Um caminho de arquivo. Uma execução de provisionamento (`REBASE_PROVISION_ONLY=true`) grava todas as alterações de schema efetuadas nele, em ordem, como um script SQL para revisão e aplicação com `psql`. Linhas gravadas não são incluídas. Recusado em um processo que serve requisições. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que uma máquina — um agente, um job de CI — *aplique* alterações de schema via `/api/admin/schema`, não apenas as planeje. Desativado a menos que solicitado: a credencial necessária para tal alteração é a mais propensa a estar armazenada em uma variável de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo máximo que uma função personalizada pode executar antes que sua requisição seja abortada. Mesma configuração que a opção `functionsTimeoutMs`. `0` desativa o tempo limite. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz com que uma rejeição de promise não tratada encerre o processo em vez de apenas registrá-la em log. Recomendado sob um orquestrador que reiniciará o contêiner; desative onde um reinício for pior que um vazamento. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia o aviso de inicialização em plataformas detectadas pelo runtime como escala-para-zero (scale-to-zero), onde um timer disparado em uma instância ociosa não é disparado em nenhuma instância. Não altera nada além disso: ative quando você mantiver pelo menos uma instância sempre em execução. | — |
| `TRUSTED_PROXY_HOPS` | Quantos proxies estão posicionados à frente deste servidor, permitindo que o limitador de taxa extraia o endereço de cliente real de `X-Forwarded-For`. Padrão seguro `0`: sem proxy, confiar no cabeçalho permitiria que qualquer chamador forjasse uma identidade. | `0` |

:::note[O provisionamento na inicialização é aditivo e não é uma ferramenta de migração]
A passagem de inicialização é executada de forma autônoma sem ninguém inspecionando um diff, portanto nunca
descartará uma coluna, reduzirá um tipo ou reescreverá uma tabela. É também por isso que a imagem recusa
`REBASE_MIGRATE_ON_BOOT=push`: um push completo calcula um diff e executará `DROP COLUMN`
sem restrições, e o reinício de um contêiner nunca deve poder destruir uma
coluna de produção como efeito colateral de um reagendamento.

Alterações destrutivas ou de reestruturação permanecem onde podem ser revisadas: `rebase db
generate` + `rebase db migrate`, ou `rebase db push` a partir de um checkout ou CI,
que simula a alteração (dry-run), recusa as destrutivas sem confirmação prévia e
pode realizar um backup antes da execução.
:::

### Implantações divididas

Uma única imagem e um único bundle podem ser inicializados várias vezes, cada um atendendo
a uma parte diferente do projeto. Uma linha para cada aqui, pois esta página lista todas
as variáveis; o que cada combinação *monta e controla* — e quais combinações
se recusam a inicializar — está em
**[Processos Divididos](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_ROLE` | Qual parte este processo atende: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Substitui se *este* processo executa os agendadores de cron. Não definido segue a role. | — |
| `REBASE_JOB_WORKERS` | Substitui se este processo executa workers da fila de jobs. Não definido segue a role. | — |
| `REBASE_FUNCTIONS_ONLY` | Atende apenas as funções personalizadas especificadas neste processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Atende todas as funções personalizadas, exceto as especificadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Para onde o processo da API encaminha uma requisição de função que ele próprio não atende. Em um `worker`, para onde vão suas próprias chamadas `rebase.functions`. Uma URL `http(s)`. | — |

### Superfície MCP

Um endpoint opcional (opt-in) do Model Context Protocol em `/mcp`, permitindo
que um cliente de IA leia e grave neste projeto **como o usuário autenticado**.
Desativado a menos que configurado, e — ao contrário de qualquer outra superfície —
nenhum `REBASE_ROLE` o ativa: os outros descrevem a forma do processo,
enquanto este é uma decisão de entregar credenciais a softwares de terceiros,
e deve ser tomada por uma pessoa em vez de herdada da atribuição de um contêiner.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_MCP_ENABLED` | Monta a superfície MCP. Requer `REBASE_PUBLIC_URL`; sem ele, a superfície se recusa a montar e registra isso no log de inicialização. | `false` |
| `REBASE_PUBLIC_URL` | A origem externamente acessível desta implantação, por exemplo, `https://app.example.com`. A superfície MCP não pode derivá-la — usar a origem do cabeçalho `Host` tornaria a identidade do emissor, e o audience contra o qual seus próprios tokens são validados, um valor fornecido pelo chamador. | — |
| `REBASE_MCP_VIEW` | Caminho para a própria visualização MCP App do projeto (`rebase-view.html`, gerada por `rebaseMcpViewPlugin()`), servida ao Claude no lugar da visualização genérica para que suas visualizações personalizadas, campos e ações sejam o que ele renderiza. Sem isso, o backend procura ao lado do frontend que ele serve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite o registro dinâmico de clientes OAuth (RFC 7591), para que um cliente possa se autorregistrar. Defina como `false` para exigir que os clientes sejam registrados previamente. | `true` |

### Edição de schema ao vivo a partir de um bundle

Desativado a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esteja definido. Um bundle compilado
não tem o código-fonte de `backend/schema` para editar, portanto, com essas variáveis
configuradas, o editor de schema lê o código-fonte do repositório, faz o commit de cada alteração de volta
e executa seu DDL neste banco de dados. Exclusivo para administradores e aplicado
manualmente por uma pessoa, a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY`
determine o contrário. Um repositório configurado sem credenciais válidas se recusa a inicializar.
Consulte [Edição de schema ao vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | O repositório do GitHub no qual as alterações de schema serão commitadas, no formato `proprietario/nome`. Defini-lo é o que ativa a funcionalidade. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | A branch onde o commit é aplicado. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Onde `backend/schema` reside nesse repositório, relativo à raiz do repositório. Um caminho que saia do repositório se recusa a inicializar, assim como o depreciado `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Um token com permissões refinadas (fine-grained) com acesso de leitura e escrita ao conteúdo do repositório. Defina esta variável ou as três variáveis `_GITHUB_APP_*`, não ambas. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID de um GitHub App, para fazer o commit como o aplicativo em vez de usar um token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | ID de instalação do aplicativo no repositório. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Chave privada do aplicativo: PEM, PEM com quebras de linha escapadas ou base64. | — |

### Backups

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `BACKUP_SCHEDULE` | Expressão cron para backups agendados. Não definida significa que os backups agendados estão desativados. | — |
| `BACKUP_DESTINATION` | Caminho local ou uma URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obrigatório junto com `BACKUP_SCHEDULE`, que se recusa a executar sem isso. `rebase db backup` usa como padrão `./backups` no diretório onde foi executado. | — |
| `BACKUP_RETENTION_DAYS` | Exclui backups mais antigos que N dias. Não definido ou `0` mantém tudo. | — |
| `BACKUP_KEEP_MINIMUM` | Sempre retém pelo menos N backups mais recentes, independentemente do que a retenção definir. | — |
| `PG_DUMP_PATH` | Substitui o binário `pg_dump` — deve ser a versão principal do servidor ou mais recente. | — |
| `PG_RESTORE_PATH` | Substitui o binário `pg_restore`. | — |
| `PSQL_PATH` | Substitui o binário `psql` que `rebase db restore --clean` executa para tornar a restauração uma transação única. | — |
| `PG_DUMPALL_PATH` | Onde o `pg_dumpall` reside, quando não estiver no `PATH`. Sem ele — e sem as ferramentas de cliente do PostgreSQL instaladas — o backup global falhará com um erro indicando esta variável. | — |

A imagem de runtime oficial (`rebasepro/server`) inclui as ferramentas de cliente
do PostgreSQL 18, portanto, um backup agendado é executado nela contra qualquer servidor até o Postgres 18.
Fora da imagem, instale-as você mesmo (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups contêm segredos e informações de identificação pessoal (PII). Use um destino
privado com criptografia em repouso.

### Entrega de bundles

Uma implantação gerenciada não inclui seu código na imagem: o runtime busca um
bundle na inicialização. Estas variáveis decidem qual bundle buscar e como.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já extraído. O que `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | De onde buscar o arquivo do bundle quando não houver um local. | — |
| `REBASE_BUNDLE_TOKEN` | A credencial Bearer para essa busca. Trate-a como um segredo: é o que autoriza um locatário a baixar seu próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Onde um bundle baixado é extraído. Deve ter permissão de escrita e persistir entre a busca e a inicialização. | — |
| `REBASE_RUNTIME_MODULES` | Módulos extras que a imagem de runtime fornece ao bundle, além daqueles que ele próprio declara. | — |

### Vinculação de recursos

Todo banco de dados, bucket e tópico que um projeto declara em `backend/resources.ts` é
vinculado por variáveis de ambiente nomeadas a partir dele. Os nomes base estão abaixo; um
recurso não padrão anexa `__` e sua chave em letras maiúsculas, portanto, um bucket chamado
`media` lê `S3_BUCKET__MEDIA`. `rebase status` exibe, por recurso,
a variável exata que está sendo lida e se ela está definida.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_DRIVER` | O pacote npm que implementa o driver de uma fonte de dados, quando não for o padrão do Postgres. Com sufixo por fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | A string de conexão para um tópico declarado. Com sufixo por tópico. | — |

### Ambiente próprio da CLI

Lido pelo comando `rebase`, não pelo servidor. Nada aqui afeta uma implantação.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BASE_URL` | Para onde `rebase api-keys`, `rebase storage` e `rebase auth reset-password` enviam a chave de serviço, no shell ou no `.env`. Defina-o quando o servidor executar de outra forma além de `rebase dev` neste projeto: `rebase start`, um contêiner, outro host. Não configurado, eles usam o servidor registrado pelo `rebase dev` enquanto esse servidor estiver ativo e não enviam nada quando não estiver. | — |
| `REBASE_SERVICE_KEY` | A chave de serviço com a qual esses comandos se autenticam, lida do `.env`: a mesma variável que o servidor lê (veja acima). | — |
| `SERVICE_KEY` | Um nome mais antigo para essa chave. Quando definida no `.env`, `rebase api-keys` e `rebase storage` a leem no lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qual arquivo `.env` a CLI lê e grava, quando não for o do projeto. | — |
| `REBASE_ROOT_RULES` | `0` impede que `rebase init` e `rebase skills install` gravem as regras do projeto nos arquivos `CLAUDE.md` e `AGENTS.md` da raiz do repositório, útil para raízes onde você mantém os arquivos de agente manualmente. | on |
| `REBASE_CLOUD_URL` | O painel de controle (control plane) com o qual `rebase cloud` se comunica. | — |
| `REBASE_CLOUD_EMAIL` | A conta com a qual `rebase cloud login` se autentica, em vez de solicitar interativamente. | — |
| `REBASE_CLOUD_PASSWORD` | Sua senha, permitindo que um gerenciador de segredos a forneça sem que ela fique registrada no histórico do shell. | — |
| `REBASE_TOKEN` | Um token gerado por `rebase cloud tokens create`. Quando definido, todos os comandos `rebase cloud` autenticam com ele em vez da sessão do `rebase cloud login`, e nunca leem ou gravam a sessão armazenada. Em um diretório vinculado por `rebase cloud init --claim`, ele é reservado para o próprio token do projeto quando não possuir escopo no projeto. A forma recomendada de executar `rebase cloud` no CI — veja [CI e agentes](/docs/deployment/cloud/#ci-and-agents). O [servidor MCP](/docs/ai/mcp/) o repassa para a CLI que suas ferramentas de nuvem inicializam, e nunca o envia para o app: defina `REBASE_API_TOKEN` para isso. | — |
| `REBASE_DEBUG` | `1` exibe o erro subjacente e detalhes da requisição em vez de apenas a mensagem curta. A primeira coisa a definir quando um comando `rebase cloud` falhar sem detalhes úteis. | — |
| `REBASE_ATLAS_DEV_URL` | O banco de dados vazio contra o qual `rebase db push`, `db generate` e `db migrate` realizam o planejamento, em vez do `<db>_dev_diff` criado ao lado de `DATABASE_URL`. O Rebase não cria nem descarta o banco nomeado aqui, e recusa um valor igual a `DATABASE_URL`. No banco de desenvolvimento gerenciado, a CLI o define para uma instância temporária em memória do PGlite. Defina-o onde o privilégio `CREATE DATABASE` não for concedido. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` não inicia nenhum banco de dados e não provisiona nada — você fornece o seu próprio. O mesmo que `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento do frontend, que caso contrário o `rebase dev` deriva do caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo que o `rebase dev` aguarda o backend anunciar que está pronto antes de reportar que ele não iniciou. `0` desativa o relatório. | `30000` |
| `DATABASE_PASSWORD` | A senha que `rebase dev --docker` insere na string de conexão derivada de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | A convenção comum entre ferramentas. Defina como qualquer valor diferente de `0` e a CLI não enviará telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | O mesmo, especificamente para o Rebase. Não requer arquivo, razão pela qual é o recomendado para uso em CI e em imagens. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Para onde a telemetria é enviada, no caso de um coletor auto-hospedado. | — |

## Segredos em desenvolvimento

O `JWT_SECRET` é obrigatório em produção. Ele e o `REBASE_SERVICE_KEY` são
gerados para você fora de produção, para que você possa começar sem configurar nada.

Esses valores gerados são salvos em cache em `.rebase-dev-secrets.json`, ao lado de
`.rebase-dev-port` e `.rebase-dev-url` e adicionados ao gitignore junto com eles. Anteriormente, eles
eram gerados a cada inicialização — portanto, reiniciar o servidor de desenvolvimento desconectava você da
sua própria aplicação e invalidava qualquer chave de API recém-criada.

- Defina qualquer uma das variáveis explicitamente e a sua será usada; nada será colocado em cache ou lido.
- Aponte o cache para outro local com `REBASE_DEV_SECRETS_FILE` — um caminho, e a
  única variável nesta seção que você definiria deliberadamente.
- Exclua o arquivo para rotacionar ambos os segredos. A próxima inicialização gravará um novo arquivo.
- Se o arquivo não puder ser gravado — por exemplo, em um contêiner somente leitura —, o servidor inicializará
  mesmo assim com um segredo efêmero, exatamente como fazia antes.

Nada é armazenado em cache em produção ou sob um executor de testes. Em produção, nada
é gerado automaticamente: uma inicialização sem `JWT_SECRET` falha, indicando o nome da variável, e
esse comportamento permanece inalterado:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objeto de Configuração do Backend

O `RebaseBackendConfig` passado para `initializeRebaseBackend()` oferece controle programático:

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
backend que não serve nada até que você o monte: `createRebaseBackend`. Consulte
[Integração de Servidor Personalizado](/docs/backend/custom-server/).

### Alterando `basePath`

O `basePath` altera o caminho de todas as rotas da API, portanto o cliente deve ser configurado com o mesmo valor —
caso contrário, ele continuará requisitando `/api/...` e receberá um erro 404 para tudo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel administrativo obtém essa configuração a partir do cliente fornecido; nada mais precisa
ser configurado. Se você construir uma URL de requisição manualmente, componha-a a partir do cliente em vez
de escrever `/api` manualmente:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solução de Problemas

### Permissão Negada no Editor SQL (`permission denied for table <name>`)

* **Sintomas:** Consultas personalizadas executadas no editor SQL do Rebase Studio falham com `cause: error: permission denied for table <name>`, mesmo que a visualização de planilha do CMS carregue os dados com sucesso.
* **Causa:** Por padrão, o Rebase tenta executar consultas do Editor SQL alternando temporariamente as roles do banco de dados para corresponder à role de aplicação do usuário ativo (por exemplo, `SET LOCAL ROLE "admin"`). Se você estiver usando autenticação personalizada onde as roles existem apenas em tabelas do banco de dados e não como roles reais do PostgreSQL, a troca de role falha ou os privilégios do banco de dados ficam ausentes. A visualização em planilha do CMS é executada com o usuário proprietário da conexão padrão e ignora essa alternância.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` à configuração `.env` do seu backend. Isso força o Rebase a executar as consultas do Editor SQL usando os privilégios do proprietário da conexão (geralmente um superuser/owner). O Editor SQL indicará acima dos resultados que eles foram lidos como o proprietário da conexão e desabilitará o seletor de roles.

### Falha na Obtenção de Schema no Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio falha ao carregar a árvore de schemas ou o Editor SQL lança `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** O Rebase requer privilégios administrativos para consultar os catálogos do sistema do banco de dados e executar comandos administrativos. Se `adminConnectionString` não for fornecida ao bootstrapper, ou se `getAdmin()` for sobrescrito para retornar `undefined`, essas operações falharão.
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
