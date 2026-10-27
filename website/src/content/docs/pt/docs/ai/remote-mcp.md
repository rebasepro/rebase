---
sourceHash: 3c5e837860d6c8c6
title: O Endpoint MCP Remoto
sidebar_label: Endpoint MCP remoto
description: Sirva o MCP a partir de um backend implantado em /mcp, para que as pessoas que usam seu app conectem o Claude ou o Cursor como elas mesmas — OAuth com tela de consentimento, oito ferramentas sob três escopos, cada chamada sob a própria segurança em nível de linha delas.
---

O [servidor MCP](/docs/ai/mcp/) é uma ferramenta de desenvolvedor: ele roda na sua máquina e
guarda uma chave de serviço ou uma chave de API. Um backend implantado também pode servir
o MCP por conta própria, em `/mcp`, para as pessoas que usam a sua aplicação. Um
assistente que uma delas conecta lê e grava no projeto **como essa pessoa**, e cada
chamada é executada sob a segurança em nível de linha dela.

Ele vem desligado, a menos que você o ative, e as duas variáveis são obrigatórias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sem `REBASE_PUBLIC_URL`, sem um segredo JWT, ou sem um driver de dados capaz de restringir
uma consulta a um único usuário, o endpoint se recusa a ser montado e diz o motivo no log
de inicialização. Nenhum `REBASE_ROLE` o ativa.

- **OAuth, com uma tela de consentimento.** Um cliente encontra o servidor de autorização
  por meio de `/.well-known/oauth-protected-resource`, registra-se (o registro dinâmico
  vem ativado por padrão; `REBASE_MCP_OPEN_REGISTRATION=false` o limita aos clientes que
  você registrar) e leva a pessoa a uma tela de consentimento que a autentica pelo seu
  `/auth/login` existente. Uma conta com segundo fator recebe então o pedido do código do
  seu autenticador ou de um código de recuperação, pelas rotas `/auth/mfa/challenge`
  existentes. A tela autentica apenas com senha: quem sempre usou só o Google, o GitHub ou
  um link por e-mail define uma primeiro com `/auth/forgot-password` ("Esqueci minha senha"
  do seu app), e a tela avisa isso. Ela também informa o host para o qual o código de
  autorização é enviado e diz que esse host não é verificado: qualquer pessoa pode
  registrar um cliente com qualquer nome, então o host é a parte que alguém pode conferir.
- **Oito ferramentas, três escopos.** Os mesmos [escopos](/docs/backend/roles-and-scopes/)
  que toda credencial usa. `data:read` oferece `list_collections`, `describe_collection`,
  `query_collection`, `count_documents` e `get_document`; `data:write` acrescenta
  `create_document` e `update_document`; `data:delete` acrescenta `delete_document`. Um
  cliente que não pede nada recebe `data:read`. Cada um pode ser restrito a uma coleção:
  `data:read:posts` lista, descreve e lê `posts` e nada além disso. Um escopo decide quais
  ferramentas são oferecidas e quais coleções elas alcançam, não quais linhas: uma lista
  vazia pode ser a RLS funcionando, e `data:write` continua sem poder gravar uma linha que
  a pessoa não poderia gravar.
- **Concessões feitas antes da 0.24 mantêm o seu alcance.** `mcp:read` é lido como
  `data:read`, e `mcp:write` como `data:write data:delete`, nas concessões armazenadas e
  nos tokens já emitidos.
- **Uma chave de API também funciona.** O `/mcp` também aceita `Authorization: Bearer rk_…`,
  para um cliente configurado com um cabeçalho em vez de um fluxo OAuth. A chave alcança as
  ferramentas que os seus escopos `data:*` cobrem, como quem quer que ela represente: uma
  [chave pessoal](/docs/backend/api-keys/#personal-keys) como o seu dono, uma chave de
  serviço como `api-key:<id>`.
- **O vocabulário do SDK, as respostas da REST.** As ferramentas recebem o que o SDK
  recebe — `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` ou
  `"created_at:desc"`), `limit`, `offset`, `searchString` e `data` para uma gravação — e
  leem pelo caminho de `GET /api/data/<collection>`, de modo que uma linha volta como a
  REST a serve (datas ISO, um `belongsTo` como a sua chave estrangeira, por exemplo
  `authorId`) e pode ser enviada de volta em uma atualização sem alterações.
  `query_collection` responde `{ data, meta }` com `meta.total` e `meta.hasMore`, e
  `count_documents` responde `{ count }`. Como na REST, são recusados um `limit` acima de
  1000, um argumento não declarado e a edição ou exclusão de uma linha que está na lixeira
  (404); definir o campo de exclusão lógica como `null` a restaura. `deleted: "only"` (ou
  `"include"`) em `query_collection` e `count_documents` lê a lixeira, como o `?deleted=`
  da REST, de modo que uma linha que `delete_document` enviou para a lixeira pode ser
  encontrada de novo para ser restaurada. A descrição dessa ferramenta diz ao modelo que a
  exclusão é permanente apenas onde a coleção não tem campo de exclusão lógica.
- **A listagem nomeia as coleções; `describe_collection` entrega o esquema de uma.**
  `list_collections` responde o `name`, o `title` e o `description` de cada coleção, e
  `describe_collection { collection }` responde os esquemas OpenAPI `row` e `create` dessa
  coleção, além de `softDeleteField` onde as linhas vão para uma lixeira. As descrições das
  ferramentas dizem ao modelo para descrever uma coleção antes de gravar nela. A listagem de
  um projeto com 200 coleções tem cerca de 5k tokens, e cada descrição menos de 1k; com
  todos os esquemas na listagem eram cerca de 150k.
- **Um token só para este endpoint.** Um token de acesso MCP é recusado por `/api/data`,
  `/api/admin` e pelo WebSocket, então conectar um assistente não lhe entrega uma sessão.

Toda requisição ao `/mcp` relê a conta da pessoa. Uma conta excluída ou desativada, ou um
"sair em todos os lugares" ou uma troca de senha depois da emissão do token, interrompe
imediatamente um cliente conectado com um 401. Um rebaixamento vale a partir da próxima
chamada de ferramenta. Cada renovação faz as mesmas verificações e recusa essa concessão de
vez. Uma sessão de convidado não pode dar consentimento.

Um limite. Desconectar um cliente (`DELETE /api/oauth/grants/:clientId`, com a sessão da
própria pessoa) revoga os refresh tokens dele na hora, mas um token de acesso já emitido
continua funcionando até expirar, dentro de uma hora.

As rotas estão em [Endpoints](/docs/backend/endpoints/#mcp-surface) e as variáveis em
[Configuração](/docs/getting-started/configuration/#mcp-surface).
