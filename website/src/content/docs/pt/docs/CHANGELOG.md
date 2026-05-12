---
slug: docs/changelog
title: Registro de Alterações
---
## [3.1.0] - 2026-02-20

- **Integração de IA**:
  - Introduzidas funcionalidades de geração de coleção e aprimoramento de dados impulsionadas por IA.
  - Adicionado novo ícone de IA e capacidades de IA integradas ao editor de coleções.
- **Visualização Kanban**:
  - Adicionado suporte completo para quadros Kanban com colunas personalizáveis.
  - Implementada reordenação de colunas por arrastar e soltar e atualizações otimistas.
  - Adicionadas opções de configuração Kanban, incluindo cores de coluna.

- **Funcionalidades de Coleção**:
  - Adicionada visualização `display` ao editor de coleção.
  - Implementada reordenação de colunas por arrastar e soltar em tabelas de dados com persistência.
  - Inferência de coleção aprimorada com parâmetros opcionais de filtro e classificação.
- **Melhorias de UI/UX**:
  - Adicionado Seletor de Modo de Visualização (Lista, Grade, Tabela) para melhor controle da visualização de dados.
  - Implementados grupos de navegação de gaveta colapsáveis.
  - Adicionado suporte a modal de bloqueio em tela cheia para Banner de Cookies.
  - Cores de botões harmonizadas e componentes de Abas reestilizados.
  - Substituído `AutorenewIcon` por `FindInPageIcon` para maior clareza.
  - Comportamento de rolagem suave habilitado.
- **Armazenamento**:
  - Adicionado suporte para URLs de armazenamento totalmente qualificadas.
  - Adicionadas opções `includeBucketUrl` e `imageResize` para uploads de arquivos.
- **Gerenciamento de Usuários**:
  - Adicionado método `updateUserFields` para atualizações diretas no Firestore.
- **Correções**:
  - Dependência do Firebase atualizada para v12.7.0.
  - Atualizações de segurança para Next.js (CVE-2025-66478).
  - Corrigidos bugs de validação de valores automáticos de data.
  - Corrigidos problemas com fusão de objetos e alterações locais.
  - Integração de Busca de Texto aprimorada com Typesense.
  - Layout e estilo corrigidos em FormEnhanceAction.

## [3.0.0] - 2025-12-01

- **Aprimoramentos do Editor**:
  - Comportamento da tecla escape melhorado no comando slash do editor
  - Comportamento do menu de sugestões aprimorado
  - Tratamento de sugestões de caminho melhorado em componentes do editor de coleções
  - Sugestões de coleção raiz refatoradas
- **Melhorias de UI/UX**:
  - Adicionada função `prettifyIdentifier` para formatar identificadores e melhorar a legibilidade
  - Formatação de chaves refatorada para usar prettifyIdentifier
  - Pequenos ajustes de UI em toda a aplicação
  - Pequena atualização visual para diálogos
  - Removido font-mono da pré-visualização do mapa
- **Editor de Coleções**:
  - Adicionada edição de propriedades inline ao editor de coleções
  - Correções para o salvamento de propriedades do editor de coleções
  - Aplicado comportamento consistente às propriedades `editable` em coleções e propriedades
- **Atualizações de API**:
  - URLs do servidor API atualizadas para usar novos endpoints
- **Dependências**:
  - Muitas atualizações de dependência
  - Adicionada configuração PostCSS com Tailwind CSS e Autoprefixer
- **Gerenciamento de Usuários**:
  - Gerenciamento de usuários refatorado para usar consistentemente `saas_uid` e `firebase_uid`
  - Estilos de botões atualizados em EnableAuthView para consistência
  - Formulários de usuário refatorados para melhorar o layout e o gerenciamento de estado
- **Configuração do Projeto**:
  - Tratamento da configuração do projeto atualizado para considerar o status de teste
  - Adicionada tela de carregamento inicial
- **Correções**:
  - Corrigidos problemas de DND na página inicial
  - Corrigida pré-visualização de alterações locais nas ações de linha
  - Corrigido o diff de alterações locais
  - Corrigidas datas perdendo o foco ao digitar e ao selecionar valores nulos em filtros de data
  - Corrigido glitch de UI de filtros de enum de seleção
  - Corrigidas visualizações de entidade em tela cheia com caracteres codificados em seu ID
- **Armazenamento e Imagens**:
  - Adicionadas novas capacidades de redimensionamento de imagem
  - Biblioteca de compressão interna substituída por compressor.js
  - Mensagem de erro aprimorada quando o Firebase Storage provavelmente não está habilitado
- **Aprimoramento de Dados**:
  - Ajustes cosméticos no aprimoramento de dados
- **Manipulação de Formulários**:
  - Exibição de erros de pré-salvamento na visualização de tabela
  - Foco de erro aprimorado ao salvar formulário com erros e feedback
  - Debouncing na mudança de valores no Formex
  - Adicionado `initialTouched` ao controlador Formex
  - Alterada a forma como os valores sujos são persistidos no armazenamento local
- **Alterações Locais**:
  - Adicionado `enableLocalChangesBackup` às coleções, permitindo aos usuários desabilitar a cópia local de entidades não salvas no navegador
  - Alteradas as alterações locais para poderem ser aplicadas manualmente
  - Limpeza do indicador de alterações não salvas se o recurso não estiver habilitado nas coleções
- **Histórico de Entidades**:
  - Adicionado um tipo mais limpo ao plugin de histórico de entidades


## [3.0.0-rc.4] - 2025-11-25

- Formulários de usuário refatorados para melhorar o layout e o gerenciamento de estado
- Tratamento da configuração do projeto atualizado para considerar o status de teste
- Muitas atualizações de dependência

## [3.0.0-rc.3] - 2025-11-07

- Exibição de erros de pré-salvamento na visualização de tabela
- Corrigidos problemas de DND na página inicial
- Adicionadas novas capacidades de redimensionamento de imagem e biblioteca de compressão interna substituída por compressor.js
- Mensagem de erro aprimorada quando o Firebase Storage provavelmente não está habilitado
- Pequena atualização visual para diálogos
- Adicionada edição de propriedades inline ao editor de coleções
- Correções para o salvamento de propriedades do editor de coleções e aplicando comportamento consistente às propriedades `editable` em coleções e propriedades
- Corrigido glitch de UI de filtros de enum de seleção
- Corrigidas datas perdendo o foco ao digitar e ao selecionar valores nulos em filtros de data
- Corrigida pré-visualização de alterações locais nas ações de linha
- Removido font-mono da pré-visualização do mapa
- Corrigido o diff de alterações locais
- Adicionado um tipo mais limpo ao plugin de histórico de entidades
- Alteradas as alterações locais para poderem ser aplicadas manualmente
- Adicionado `enableLocalChangesBackup` às coleções, permitindo aos usuários desabilitar a cópia local de entidades não salvas no navegador
- Debouncing na mudança de valores no Formex e adicionado `initialTouched` ao controlador Formex
- Alterada a forma como os valores sujos são persistidos no armazenamento local
- Foco de erro aprimorado ao salvar formulário com erros e feedback

## [3.0.0-rc.2] - 2025-10-16

- **Gerenciamento de Usuários no Rebase Core**: Adicionadas capacidades de gerenciamento de usuários diretamente ao Rebase Core, expandindo as opções de auto-hospedagem.
- **Campos de Usuário como Valores de String**: Suporte totalmente implementado para campos de usuário como valores de string, melhorando a flexibilidade no tratamento de dados de usuário.
- **Migração para TipTap V3**: Editor de markdown migrado para TipTap V3 para melhor desempenho e funcionalidades.
- **Retrofitted Tailwind 4**: Múltiplas adaptações para suportar o retrofit do Tailwind 4, modernizando a infraestrutura de estilização.
- **Aprimoramentos de Login**:
  - Login por e-mail na nuvem implementado
  - Autenticação por e-mail e senha adicionada ao Cloud SaaS
  - Eventos analíticos de login adicionados
  - Layout de login de demonstração corrigido
- **Atualizações do Site**:
  - Site de aterragem Astro adicionado (WIP)
  - Atualizações de migração do site
  - Imagens migradas
  - CSS inline do site
  - Atualizações de web design
  - Ajustes na página de segurança
- **Melhorias na Página Inicial**:
  - Estado colapsado da página inicial armazenado no armazenamento local
  - Tentativa de correção para renomear grupos na página inicial
  - Algumas alterações de arrastar e soltar revertidas
- **Correções**:
  - Suporte a SSR (Server-Side Rendering) do editor corrigido
  - Importação de referências com bancos de dados secundários corrigida
  - Suporte a referências de banco de dados secundários corrigido
  - Visualização de permissões SaaS corrigida
  - Entrada de filtro para números corrigida quando o valor é 0
  - Melhor gerenciamento de erros para o doctor (ferramenta de diagnóstico)
- **UI/UX**:
  - Botão de coleção pai forçado removido
- **Dependências**: Dependências de modelo atualizadas
- **Documentação**: 
  - Documentação aprimorada para ícones personalizados em coleções
  - Documentação de autenticação adicionada
  - Seção de informações de segurança adicionada

## [3.0.0-rc.1] - 2025-09-25

- **Atualização para Firebase 12**: Atualizado para Firebase 12 para melhor desempenho e funcionalidades.
- **Aprimoramentos do Plugin de Histórico**: 
  - Adicionado rastreamento de valores anteriores ao plugin de histórico
  - Adicionada criação programática de entradas de histórico
- **Melhorias nas Propriedades de Referência**:
  - Adicionada configuração de referência como campo de string
  - Corrigido o problema de colunas adicionais não aparecerem na seleção de referência
  - Corrigido o problema de propriedades de referência não serem renderizadas corretamente sem um caminho, mas com um Campo personalizado
- **Atualizações da UI**:
  - Ícone SaaS padrão atualizado
  - Atualizações de cor de botão
  - Seções da página inicial colapsadas
  - Pequenas atualizações da web e Algolia DocSearch removido
- **Correções**:
  - Corrigido problema de login do Google Cloud
  - Corrigido erro ao retornar da visualização de assinatura
  - Corrigido armazenamento de projeto recente
  - Corrigidas importações TipTap
  - Corrigido o problema de passagem correta do gclid para o aplicativo
  - Correção de CLS (Cumulative Layout Shift) do site
- **CLI**: Adicionadas instruções npm ao CLI
- **Dependências**: Várias atualizações e limpeza de dependências
- **Documentação**: Erro de digitação corrigido em custom_previews.md
- **Importar/Exportar**: Importações limpas
- **Gerenciamento de Funções**: Adicionada capacidade de definir funções programaticamente no código

## [3.0.0-beta.15] - 2025-08-18

- **Funcionalidade de Pesquisa**: Adicionada pesquisa inicial de usuário com rastreamento analítico para melhorar a experiência do usuário e coletar feedback.
- **Melhorias nas Ações de Entidade**:
  - Adicionado registro de ações de entidade para melhor organização
  - Adicionado contexto de formulário às ações de entidade
  - Ações de entidade agora disponíveis em modo de tela cheia
  - Página de ações de entidade aprimorada
- **Gerenciamento de Assinaturas**:
  - Adicionado link do portal Stripe para fácil gerenciamento de assinaturas
  - Visualização de assinatura aprimorada nas configurações do projeto
  - Adicionada capacidade de alterar o método de pagamento
  - Adicionados eventos analíticos para sucesso ou falha da assinatura
  - Atualizações de preços
- **Aprimoramentos da Página Inicial**:
  - Adicionada funcionalidade de arrastar e soltar às seções da página inicial
  - Adicionada novamente a visualização vazia padrão na página inicial
  - Comportamento de drop de grupo implementado
  - Adicionada capacidade de renomear grupos
  - As coleções agora podem ser editadas dentro da visualização de edição de entidade
  - Corrigido problema de re-renderização da pesquisa na página inicial
- **Melhorias de UI/UX**:
  - Botões padrão alterados de cor primária para neutra
  - Adicionado o menor tamanho de switch
  - Gradiente de fundo do herói atualizado
  - Pequenas atualizações de estilo
  - Adicionada alternância de moeda na página de preços
  - Ícones de coleção menores
  - Otimizações móveis da página de aterragem
  - Adicionada pequena animação às visualizações de login
  - Logotipo atualizado
  - Pequenas atualizações visuais da gaveta
- **Análise**:
  - Adicionado rastreamento de campanha à análise
  - Adicionados eventos de análise de aterragem
  - Adicionados eventos analíticos para pesquisas
- **Atualizações de Componentes**:
  - Alteradas as props da classe Alert
  - Adicionado `viewportClassName` ao componente Select
  - Atualização visual de upload de arquivo
  - Permitir o uso de componentes React como ícones
  - Adicionados `previous values` ao plugin de histórico
  - Permitir desabilitar o foco no diálogo
- **Desempenho e Correções de Bugs**:
  - Corrigido tamanho do botão de carregamento
  - Corrigidas entidades ficando sujas na criação devido ao campo markdown
  - Corrigido bug de filtragem para valores nulos
  - Corrigido erro de useMemo com argumentos variáveis
  - Corrigido bug de caminhos de id
  - Corrigida ordem de coleções mescladas
  - Otimizações de desempenho e correções de bugs de DND (arrastar e soltar)
  - Corrigido tratamento de caminho de grupos de coleção
- **Campos Personalizados**: Página de campos personalizados aprimorada
- **Correção de Diálogo de Referência**: Corrigido problema de ordenação de diálogo de referência quando filtros são aplicados na coleção principal
- **Demo de Produto**: Ação de demonstração de sincronização de produto aprimorada
- **Atualizações da Web**: 
  - Atualizações de web design
  - Otimizações móveis da web
  - Função getPath aprimorada
  - Adicionados atributos de dados ao componente Button
- **Documentação**: Pipeline de geração de llms.txt aprimorada
- **Docusaurus**: Atualização de versão

## [3.0.0-beta.14] - 2025-04-17

- **Alternar Visualização JSON**: Adicionado alternador na visualização do editor de coleções para acessar dados JSON brutos.
- **Consistência da UI**: Melhorada a consistência da UI para componentes de seleção e multisseleção.
- **Melhorias no Formulário**: Aprimorado o redimensionamento do campo do formulário pop-up e o tratamento de limites.
- **Plugin de Histórico de Entidades**: Adicionada funcionalidade de rastreamento de histórico ao Rebase Cloud e Rebase PRO.
- **Correções**:
  - Corrigido estouro de texto em títulos de entidades
  - Corrigidos erros exibidos incorretamente em array de mapas
  - Corrigido truncamento de botões
  - Corrigidas entidades somente leitura sendo obscurecidas pela barra inferior
  - Corrigida cor do texto de sobreposição no modo escuro
  - Corrigidos erros não sendo limpos no editor de coleções
  - Corrigido mergeDeep para lidar corretamente com casos nulos
  - Corrigida a rolagem redefinindo o eixo x na paginação
  - Adicionada novamente a indicação de erro da célula da tabela
- **Arrastar e Soltar**: Substituído `@hello-pangea/dnd` por `@dnd-kit` para melhor desempenho e flexibilidade.

## [3.0.0-beta.13] - 2025-04-11

- **Pré-visualização JSON**: Adicionada aba de pré-visualização JSON às entidades, fornecendo uma visualização de dados brutos. Pode ser desabilitada com a prop `disableJsonTab`.
- **Aprimoramentos do TextField**: Adicionadas props `maxRows` e `minRows` ao componente TextField para melhor controle de entradas multilinha.
- **AuthController no PropertyBuilder**: Adicionado `authController` ao callback PropertyBuilder, permitindo acesso ao contexto de autenticação.
- **Melhorias de Armazenamento**: Adicionado `processFile` às propriedades de armazenamento para pré-processar arquivos antes do upload.
- **Formulários Secundários**: Os formulários secundários agora são sempre renderizados, mesmo se desabilitados, para melhor consistência.
- **Melhorias de UI**:
  - Tamanhos de campo pequeno e menor ajustados para melhor hierarquia visual
  - Estilização da cor neutra do botão atualizada
  - Layout aprimorado para IDs de entidade longos
  - Vários pequenos ajustes de layout
- **Correções**:
  - Corrigido campo de referência de array com botão de adicionar incorreto
  - Corrigidas subcoleções não resolvendo o caminho corretamente
  - Corrigido bug de navegação de subcoleção complexa com alias
  - Corrigida funcionalidade de exportação quando `flatten arrays` é falso (aspas duplas agora são escapadas corretamente)
  - Corrigidos problemas de seleção de enum de CollectionDetailsForm
  - Corrigido bug de criação de entidade
  - Corrigida atualização de URL para entidades com visualização padrão selecionada
  - Corrigidos valores não sendo redefinidos corretamente
  - Corrigidas visualizações de entidade somente leitura sem abas
  - Corrigido bug relacionado a camel case
- **Demonstração**: Adicionada demonstração do componente MultiSelect

## [3.0.0-beta.12] - 2025-03-13

- **Visualizações de entidade em tela cheia**: Agora você pode abrir entidades em uma visualização em tela cheia. Isso é útil quando você deseja
focar na entidade que está editando. Você pode habilitar este recurso definindo a propriedade `openEntityMode` como `full_screen`
na visualização da coleção. O modo padrão continua sendo `side_panel`. Houve uma grande reformulação da navegação para
acomodar todos os novos casos de uso.
- **Preservação de rolagem**: Ao abrir uma entidade em uma visualização em tela cheia, a posição de rolagem da visualização da coleção é preservada.
- **Rascunhos salvos localmente**: Os rascunhos agora são salvos localmente no navegador. Isso significa que, se você fechar acidentalmente o navegador ou navegar para longe, suas alterações ainda estarão lá quando você retornar.
- Preservação do estado da URL: O estado dos filtros e da ordenação agora é preservado na URL.
- **Funcionalidade de desfazer/refazer**: Adicionada a capacidade de desfazer e refazer alterações ao editar entidades.
- Adicionada flag `alwaysApplyDefaultValues` às coleções. Esta flag permite que você aplique os valores padrão ao atualizar
entidades, não apenas ao criá-las.
- Os formulários secundários agora preservam sua largura quando no modo de painel lateral. Você pode criar formulários secundários completos
que vivem em sua própria aba. Os formulários secundários são construídos como componentes personalizados e podem incluir quaisquer componentes, incluindo
ligações de campo.
- Adicionado modo de cor do sistema, além dos modos escuro e claro. O botão agora é um dropdown em vez de um toggle.
- Melhorias no formulário, incluindo redefinição do estado inicial fixada após salvar e ações de formulário de entidade desanexadas.
- Aviso ao sair de formulários não salvos para evitar perda acidental de dados.
- Agora você pode substituir as ações de entidade padrão fornecendo uma ação com uma das chaves `edit`, `copy` ou `delete`
  na propriedade `entityActions`.
- Correção: Propriedades de string com armazenamento agora têm preferência nas visualizações.
- Correção para codificação de URL para coleções.
- Diálogo de ações corrigido que rolava quando não deveria.
- Correção para navegação para novas entidades a partir do painel lateral.

## [3.0.0-beta.11] - 2024-12-13

- Novo template Next.js para Rebase PRO. Agora você pode criar um novo projeto com o template PRO usando a CLI.
- [BREAKING] Removido `userRoles` do AuthController. Agora você pode acessar a propriedade `roles` no objeto de usuário diretamente
- [BREAKING] Muitos tamanhos da UI do Rebase foram ajustados para melhor consistência. Isso só afetará você se estiver usando
  componentes personalizados.
    - `smallest` ou `tiny` foram renomeados para `small`.
    - `small` foi renomeado para `medium`.
    - `medium` foi renomeado para `large`.
- [BREAKING] Para versões auto-hospedadas, houve uma mudança na API para os controladores de gerenciamento de dados. O
  `authController` agora é passado para o controlador de Gerenciamento de Usuários, em vez do contrário. O
  `userManagementController` pode ser usado como um controlador de autenticação, mas com toda a lógica adicional para gerenciamento de usuários.

❌ Código anterior:

```typescript
    /**
 * Controller in charge of user management
 */
const userManagement = useBuildUserManagement({
        dataSourceDelegate: firestoreDelegate
    });

/**
 * Controller for managing authentication
 */
const authController: FirebaseAuthController = useFirebaseAuthController({
    firebaseApp,
    signInOptions,
    loading: userManagement.loading,
    defineRolesFor: userManagement.defineRolesFor
});
```

✅ Código depois:

```typescript
    /**
 * Controller for managing authentication
 */
const authController: FirebaseAuthController = useFirebaseAuthController({
        firebaseApp,
        signInOptions
    });

/**
 * Controller in charge of user management
 */
const userManagement = useBuildUserManagement({
    dataSourceDelegate: firestoreDelegate,
    authController
});
```

- Adicionadas muitas diretivas "use client" aos componentes da UI.
- Corrigidos problemas no diálogo de código do editor de coleções.
- Estilos da web atualizados e melhorias integradas no Docusaurus.
- Estilização aprimorada para referências vazias e pequenos ajustes de design.
- Trabalho em progresso continuado nos componentes personalizados do Editor.
- Reintroduzida variante de cor primária escura para melhores opções de tema.
- Pequenas atualizações da web para melhorar a estética e a funcionalidade.
- Corrigido um bug onde o Editor não estava salvando valores falsos.
- Todas as instâncias de cores cinza e ardósia foram substituídas por cores `surface` e `surface-accent` mais unificadas para consistência da UI.
- Adicionado fallback do componente Avatar e configuração ESLint integrada aos templates.
- Tratamento de erros aprimorado em formulários e mensagens de erro da nuvem melhoradas.
- Lógica de gerenciamento de usuários refatorada para melhor organização do código.
- Manipulação aprimorada de propriedades de switch booleano em configurações.
- Introduzido gerenciamento de estado para filhos em ArrayContainer.
- Adicionada uma receita para criação de slugs, melhorando o tratamento de URLs e SEO.
- Corrigidos problemas de travamento em campos de repetição para subpropriedades e diversos pequenos bugs de estilo e funcionalidade.
- Melhorias na responsividade do mapa de calor (correções HMR).
- Funcionalidades de pesquisa de texto refatoradas para melhor eficiência e documentação relevante adicionada.
- Corrigidos problemas com campos de entrada de número bloqueando a rolagem e substituído o seletor de data por um input de data HTML nativo para
  consistência.
- Se você estiver usando o componente `Select`, não precisa mais fornecer uma função `renderValue`. O componente
  irá lidar com isso automaticamente.
- Propriedades de pré-visualização personalizadas agora são renderizadas se o valor for indefinido.
- Correção para a versão Cloud atualizando a navegação com muita frequência.
- Correção para a pesquisa local não funcionar ao retornar a uma coleção.
- Correção para bug ao selecionar uma entidade somente leitura.
- Corrigido bug de seleção em grupos de coleção para entidades que compartilham ID.
- As pré-visualizações de referência agora levam em consideração arrays de imagens para a imagem de pré-visualização.

## [3.0.0-beta.10] - 2024-07-10

- Corrigidos problemas com licenças erradas.
- Dependências TipTap resolvidas.
- Várias pequenas atualizações de estilo abordadas em toda a web.
- CSS do corpo movido de importações padrão para arquivos individuais para melhor modularidade.
- Várias atualizações da web implementadas, incluindo correções de estilo de seleção e ajustes de título de diálogo para pesquisa de texto.
- A visualização de seleção de propriedades do editor de coleções foi atualizada e o layout de seleção de widgets foi aprimorado.
- Ajustes no AppBar aplicados para melhorar o comportamento em dispositivos móveis.
- Saídas do console aprimoradas e segmentos de código diversos limpos.
- UI aprimorada com a adição de um componente Slider e documentação relacionada atualizada.
- Ícone de edição de entidade substituído por um lápis para maior clareza.
- Dependências atualizadas e gerenciamento de projetos refinado com um recurso de verificação de licenças.
- Manipulação aprimorada do Formex para entradas numéricas e exportação de DateTimeField corrigida no Next.js.
- Geração de chave API e capacidades de seleção de projetos adicionadas.
- Introduzida uma mensagem de aviso de atraso e melhorias no tratamento de dados de coleção e subcoleção.
- Melhor tratamento de erros e consistência de layout na aplicação.


## [3.0.0-beta.9] - 2024-07-10

- **NOVO EDITOR MARKDOWN**: O editor markdown foi completamente reformulado. Agora ele suporta uma pré-visualização ao vivo e uma experiência de edição muito
  melhorada. Agora ele inclui um menu slash que você pode acessar digitando `/` no editor. Também uma nova
  barra de ferramentas com botões para operações comuns de markdown. O novo editor também inclui um recurso de preenchimento automático de IA, que
  sugere elementos markdown enquanto você digita, e exibe o markdown gerado em tempo real, e destacado.
- Campos adicionais agora também são exibidos no diálogo lateral da entidade.
- Importar/exportar agora está dividido em 2 plugins separados.
- Os pacotes agora não são minificados, deixando essa responsabilidade para o bundler do cliente.
- Adicionado campo de tamanho máximo no editor de coleção para arquivos.
- Melhor tratamento de erros de uploads de arquivos incorretos.
- Melhorando o erro ao abrir uma entidade não acessível na visualização lateral.
- Ajustes no componente Select e remoção da prop `multiple`.
- Novo componente `MultiSelect` com uma UX muito aprimorada.
- Introduzido AppCheck diretamente no Rebase Cloud.
- Adicionado suporte a MongoDB para Rebase PRO.
- Múltiplas correções no plugin de gerenciamento de usuários para projetos PRO.
- Dependências do react-router atualizadas.
- Personalização aprimorada, agora você pode definir os estilos para cada entrada de tipografia, incluindo tamanho da fonte, tipografia...
- Pesquisa da página inicial aprimorada, agora usando fuse.js
- Correção para índice ausente e chaves erradas em array de mapas com construtor de propriedades.
- Correção para posição do drag handle no editor.
- Renomeado `partOfBlock` para `minimalistView` nas props de campo.
- Agora é possível definir propriedades de pré-visualização no nível da coleção.
- Estilização de referências atualizada.
- Tooltips foram reformulados para usar menos divs.
- Correção para posição do plugin de aprimoramento de dados.
- Correção para como você pode substituir a fonte de dados para coleções específicas.
- Agora você também pode definir um banco de dados diferente de `(default)` na fonte de dados.
- O plugin de Gerenciamento de Usuários agora salva usuários com o e-mail como chave, em vez de um valor aleatório.
- Correção para painéis laterais ajustando-se ao tamanho correto quando a janela muda de tamanho.
- Algumas atualizações de estilo da gaveta.
- `RepeatFieldBinding` agora pode usar propriedades de array não resolvidas.

## [3.0.0-beta.8] - 2024-07-10

- Correção para excessivas re-renderizações na visualização do formulário.
- Agora você pode usar componentes `PropertyFieldBinding` em suas visualizações de entidade personalizadas, e eles serão tratados como campos regulares.
- Para visualizações de entidade adicionais, agora você pode preservar a barra de ações inferior, com a prop `includeActions`.
- Para propriedades de mapa, se não forem obrigatórias, o valor pode ser `undefined`, mas se uma propriedade filha tiver um valor,
  a validação será acionada para todos os filhos.
- Correção para mapas de dados não sendo percorridos corretamente com valor nulo.
- O template pro CLI agora suporta a criação de configuração de aplicativo web.
- Correção para inferência de dados do editor de coleção para enums.
- Pequena melhoria de estilo da Sheet.
- Corrigido problema de carregamento da pesquisa local com dados em cache.
- Pequena correção visual para IDs.
- Atualizações do AppCheck.
- Corrigida a abertura inconsistente de diálogos laterais de pré-visualização de referência.
- Corrigidos ícones para pré-visualizações de imagem.
- Navegando para a URL da página inicial ao sair da sessão.
- Adicionada a prop `previewUrl` nas opções de armazenamento (#639).
- Corrigido problema de segurança XLSX CVE-2024-22363 (#654).
- Correção para a remoção de chaves em campos KeyValue.
- Adicionado tamanho grande para switches booleanos.
- eslint atualizado para a versão mais recente e configuração.
- Correção de tipos para `removePropsIfExisting`.
- Correção para bug de arrastar vídeo em campos de array.
- Adicionada opção para solicitar redefinição de senha, na visualização de login PRO
- Permitindo valores padrão nulos para propriedades.
- Adicionada contagem a ligações de campo de array.
- Corrigidos valores padrão em mapas aninhados em arrays.
- Resolvendo o caminho da coleção de entidades com o que vem da entidade, não da configuração da visualização.
- Pequena correção para a imagem do logotipo.
- Corrigidos campos condicionais não atualizando corretamente.
- Botão de novo usuário oculto se `disabledSignupScreen`.
- Estilização da barra de navegação de documentos aprimorada.
- Permitindo que mapas sejam completamente indefinidos.
- Botão de adicionar desabilitado em grupos de coleção.
- Grande refatoração de entidades, as visualizações personalizadas agora estão sob o provedor formex.
- Correção CLI para usuários não logados.
- Correção para datamaps não sendo percorridos corretamente com valores nulos.
- Atualizações de prop do Scaffold.

## [3.0.0-beta.7] - 2024-06-18

- Renomeada a classe utilitária `cn` para `cls`, mantendo `cn` disponível com um aviso de depreciação.
- Adicionada documentação para Menubar e documentação de esqueleto ausente.
- Corrigido o tipo de ordem das propriedades para permitir subcoleções.
- Nova seção de UI adicionada à página de destino.
- Fluxo de salvamento e fechamento de diálogo aprimorado.
- Permitir ocultar IDs e links de entidade em referências e pré-visualizações.
- Removidas algumas transições CSS.
- Permitir ocultar o alternador de modo de cor.
- Adicionado exemplo de visualização JSON.
- Alterada a tabela virtual para usar tamanho em pixels.
- Algumas atualizações de design para melhor experiência do usuário.
- Adicionada de volta a coluna de grupo de coleção com IDs pai.
- Saída de resultados vazios aprimorada.
- Adicionados exemplos de prompts e sugestões para DataTalk.
- Visualização de entidade lateral aprimorada, calculada dinamicamente com base na profundidade da propriedade da coleção.
- Corrigidos tipos de mergeDeep.
- Corrigido problema com a exportação de propriedades inexistentes definidas em `propertiesOrder`.
- Corrigidos problemas de template PRO sem projetos Cloud.
- Tratamento aprimorado para valores enum com valor 0.

## [3.0.0-beta.6] - 2024-04-23

- AppCheck adicionado a cada variante do Rebase.
- Várias correções para o delegado da fonte de dados.
- Correção ao salvar dados limpos.
- Problema de criação de novas funções de usuário na nuvem corrigido.
- Problema de exibição de mensagens de erro em células de tabela corrigido.
- Problema de atualização de subcoleções corrigido.
- Análises de importação/exportação e conversões de mapeamento de dados relacionadas atualizadas.
- Manuseio de funções e permissões de usuário atualizado e aprimorado.
- Manuseio de arquivos de conta de serviço e criação de projeto usando SA aprimorado.
- Comportamento de consultas não indexadas atualizado.
- Conexão de gerenciamento de usuários com demo removida.
- Atualizações de dependência para mitigar problemas de segurança.
- Expondo métodos adicionais da inferência de dados para melhor personalização.
- Atualizações do template Pro para melhor UI/UX.
- Documentação atualizada para coleções e gerenciamento de usuários.

## [3.0.0-beta.5] - 2024-04-01

- [BREAKING] O componente principal para Rebase Cloud foi renomeado de `RebaseApp` para `RebaseCloudApp`. Por favor, atualize
  suas importações de acordo.
- Correções relacionadas à CLI. Agora você pode instalar a CLI globalmente com `npm install -g @rebasepro/cli`.

## [3.0.0-beta.4] - 2024-03-27

- [BREAKING] O nome do pacote para Rebase Cloud mudou de `rebase` para `@rebasepro/cloud`. Isso é feito
  para evitar conflitos com o pacote principal do Rebase. Se você estiver usando o Rebase Cloud, precisará atualizar
  suas importações.
- [BREAKING] Se você estiver importando a configuração do tailwind, agora poderá encontrar a importação em:
  `import rebaseConfig from "@rebasepro/ui/tailwind.config.js";`
- [BREAKING] Nesse caso, você também precisa adicionar `@tailwindcss/typography` às suas dependências de desenvolvimento.
- [BREAKING] Você precisa atualizar seu `vite.config.js` e substituir o nome do pacote na configuração federada:
    ```javascript
    import { defineConfig } from "vite"
    import react from "@vitejs/plugin-react"
    import federation from "@originjs/vite-plugin-federation"
    
    // https://vitejs.dev/config/
    export default defineConfig({
        esbuild: {
            logOverride: { "this-is-undefined-in-esm": "silent" }
        },
        plugins: [
            react(),
            federation({
                name: "remote_app",
                filename: "remoteEntry.js",
                exposes: {
                    "./config": "./src/index"
                },
                shared: ["react", "react-dom", "@rebasepro/cloud", "@rebasepro/core", "@rebasepro/firebase", "@rebasepro/ui"]
            })
        ],
        build: {
            modulePreload: false,
            target: "ESNEXT",
            cssCodeSplit: false,
        }
    })
    ```
- Pequenas melhorias de desempenho e correções de bugs.
- Capacidade aprimorada de filtragem e classificação para campos indexados.
- StorageSource estendido para suportar `bucketUrl` personalizado.
- Limpeza de genéricos do controlador de navegação e classes Markdown prose.
- Abordados problemas de salvamento do Gerenciamento de Usuários e renomeado o template Cloud.
- Corrigidos rerenders de ReferenceWidget.tsx.
- Corrigido problema do botão de nova coleção na página inicial.
- Corrigido caminho de templates CLI.
- Funções integradas ao AuthController.
- Pequena mudança na API de plugins.
- Adicionados detalhes do usuário ao dropdown da barra de navegação.
- Dependências atualizadas.
- Pré-visualização da visualização de entidade e refatoração do título.
- Trabalho em progresso do quadro Kanban.
- Correção para novos valores de seleção vazios do radix.
- Correções para propriedades indefinidas em arrays e no editor.
- Parâmetros adicionais adicionados nos controladores de autenticação.
- Refatoração de cartões de navegação e limpeza da API de plugins.
- Correção para importação de dados com IDs não string.
- Documentação: Adicionada receita para gerenciar callbacks de entidade.
- Atualizações da web e correção CLI para yarn.

## [3.0.0-beta.3] - 2024-02-21

- Correção para importação de dados em subcoleções.
- Reordenação de código.
- Minificação removida. Verificações de tipo EntityReference alteradas.
- Atualizações de upload de imagem do editor.
- Cosmético.
- Plugin do editor tailwind.config.js movido.
- Callbacks removidos em visualizações de navegação lateral, evita bug.
- Correção de template PRO.
- Limpeza da visualização de login PRO.

## [3.0.0-beta.2] - 2024-02-21

- Adicionado pacote Formex para lidar com formulários em toda a plataforma. Formex é uma
  biblioteca de gerenciamento de formulários interna com uma API semelhante ao Formik, mas com melhor desempenho,
  e muito mais leve.
- Processo de integração aprimorado para novos usuários.
- Corrigidos problemas de importação de dados para novas coleções.
- Ajustado o processo de integração SaaS para melhor experiência do usuário.
- Validação de expressões regulares implementada para campos de entrada.
- Feedback de erro de login aprimorado.
- Controlador de navegação extraído para melhor gerenciamento.
- Estilos atualizados para consistência.
- Vite e dependências atualizadas para desempenho e segurança.
- Formulários de usuário e função refatorados para usar Formex.
- Corrigidos problemas de formulários de cabeçalho de tabela e editor de coleções.
- Problemas de importação JSON incorretos resolvidos.
- Formik removido, aprimorando o gerenciamento de formulários com Formex.
- Pequenas correções de aninhamento HTML e debounce.
- Corrigidos bugs de menu de contêiner de array e entrada multilinha.
- Configuração do Tailwind migrada para a lib para facilitar o gerenciamento.
- Configuração do Sentry ajustada para relatório de erros.
- Correção para a visualização de edição de subcoleções aparecendo vazia.
- Correções para propriedades de bloco e grupo no editor salvando múltiplas entradas ao editar uma subpropriedade existente.

## [3.0.0-beta.1] - 2024-02-01

A primeira versão beta do Rebase v3.0.0.
Verifique todas as novas funcionalidades e melhorias na [documentação](./what_is_new_v3)
e no [guia de migração](./cloud/migrating_from_v2)

## [2.2.0] - 2023-11-09

- Correção para links de subcoleção ausentes.
- Novo fluxo de login por e-mail e senha
- Botão de adicionar removido em grupo de coleção
- Correções de exportação
- Correção para pesquisa de coleções

## [2.1.0] - 2023-09-12

- [BREAKING] A lógica para verificar combinações de filtro válidas foi movida para a interface `DataSource`.
  Isso melhora a capacidade de personalizar a fonte de dados e permite filtros mais complexos.
  Essa alteração só afetará você se você tiver implementado uma fonte de dados personalizada. Você precisará
  adicionar um método `isFilterCombinationValid` à sua fonte de dados.
- [BREAKING] A propriedade `filterCombinations` foi removida do componente `EntityCollection`.
  Isso agora é tratado pela fonte de dados. Se você precisar permitir vários filtros, pode usar o
  novo callback `FireStoreIndexesBuilder`. Verifique
  a [documentação](https://rebase.pro/docs/collections/multiple_filters)
  para mais informações.
- Agora você pode usar `spreadChildren` aninhados em propriedades de mapa, permitindo exibir
  estruturas aninhadas arbitrárias como colunas únicas na visualização da coleção.
- O valor da contagem da coleção agora é atualizado com os filtros aplicados.
- Correção para exportação csv não funcionando quando os dados subjacentes são inválidos.
- Correção para bug de pesquisa de coleção retornando um único resultado.
- Correção para campos de referência quebrando com valores incorretos.

## [2.0.5] - 2023-07-11

- O valor padrão para propriedades de string agora é `null` em vez de `""`.
- Correção para a mudança do controlador de pesquisa de texto não atualizar como dependência.
- Correção para a definição de um campo único usando uma referência, que estava
  gerando uma consulta inválida no Firestore.

## [2.0.4] - 2023-06-15

- Correção para `forceFilter` não ser aplicado corretamente nas visualizações de referência.
- Correção para configuração de validação de enum anulável.

## [2.0.3] - 2023-06-15

- Correção para o formulário redefinindo valores ao salvar.

## [2.0.2] - 2023-06-14

- Substituído `flexsearch` por `js-search`. Suas importações são muito confusas.
- Correção para formulário atribuindo IDs errados
-

## [2.0.1] - 2023-06-12

- Correção para entradas de bloco que não geravam o valor padrão correto ao adicionar uma nova entrada. Isso estava causando
  um bug quando a propriedade filha é um array, como no exemplo do blog.
- Adicionada a propriedade `formAutoSave` às coleções. Isso remove os botões do formulário e salva automaticamente
  a entidade quando há alterações ou o usuário sai do formulário.
- Agora você pode acessar o `formContext` a partir das visualizações de coleção, permitindo acessar a entidade atual
  sendo editada, modificar valores e `save`.

## [2.0.0] - 2023-06-07

- Agora você pode usar um callback para definir a visualização padrão de uma entidade.
- Correção ao abrir entidades de uma visualização personalizada, que também usa subcoleções.

## [2.0.0-rc.2] - 2023-06-05

- Dependência `@mui/x-date-pickers` revertida para `^5.0.0`
- Valores padrão atribuídos a cada propriedade agora, com base no tipo de propriedade.
  Por exemplo, propriedades booleanas terão um valor padrão de `false`, mapas para `{}`,
  e a maioria das outras propriedades para `null`.
- Espaço vazio removido para propriedades ocultas no diálogo lateral da entidade.

## [2.0.0-rc.1] - 2023-05-31

- Adicionados campos arbitrários de chave-valor com a propriedade `keyValue` em propriedades de mapa
- Dependência `@mui/x-date-pickers` atualizada (pode ser necessário atualizar sua versão
  para 6.5.0)
- Algumas melhorias no componente `EntityCollectionTable`, referentes a
  valores sendo atualizados em segundo plano. Também debouncing correto para
  campos de tabela.

## [2.0.0-beta.7] - 2023-05-23

- Adicionado suporte para grupos de coleção
- [BREAKING] A função `countEntities` na fonte de dados agora recebe um
  objeto em vez de uma string como parâmetro. Isso só afetará você se você
  tiver construído um componente personalizado usando essa função.
- Adicionadas pré-visualizações de URL de string aos campos
- Correção para geopontos não sendo serializados corretamente ao salvar.

## [2.0.0-beta.6] - 2023-05-11

- Correção para tipos Typescript não sendo exportados corretamente e gerando erros
  ao usar a biblioteca com o quickstart.
- Correção para mensagens de erro não aparecendo corretamente em novas entradas de texto.
- Correção para importação flexsearch causando falha usando webpack

## [2.0.0-beta.5] - 2023-04-28

- Aparência dos campos atualizada. Os campos de texto agora são personalizados, não os
  fornecidos pelo Material UI. Isso permite mais personalização, menos código e
  melhor desempenho.
- Visualização de login corrigida, não centralizada
- Seleção de campo pop-up e bug de arrastar e soltar corrigidos
- Correção para campo de pular login
- HTML agora renderizado corretamente em pré-visualizações de markdown
- Correção para a permissão `read` não sendo aplicada corretamente.
- Correção para o estado de visualização vazia não centralizado nas coleções

## [2.0.0-beta.4] - 2023-03-30

- Bug de cabeçalho de tabela corrigido
- Barra de pesquisa adicionada na página inicial
- Visualização de coleções favoritas e recentes adicionada na página inicial.
- Correção para alguns construtores de propriedades profundamente aninhados em arrays
- Adicionada a propriedade `autoOpenDrawer`, permitindo abrir o drawer automaticamente ao
  passar o mouse sobre o menu.
- Permitir escolher qual visualização personalizada ou subcoleção é aberta por padrão,
  com a propriedade `defaultSelectedView`. Obrigado a @SeeringPhil pelo PR!
- Renomeado `builder` para `Builder` em visualizações personalizadas de coleção para consistência.

## [2.0.0-beta.3] - 2023-03-21

- Bug corrigido em relação a controladores de seleção personalizados.
- Correção para o valor padrão não ser definido em propriedades de array.
- Firebase App Check habilitado. Obrigado a @sengerts pelo PR!
- Função de cópia adicionada às visualizações de array. Obrigado a @guustmc pelo PR!
- O diálogo lateral da entidade agora é mais largo por padrão.
- Pequenas melhorias nas propriedades de bloco. Agora o primeiro tipo é selecionado por
  padrão.
- Ordem adicional corrigida adicionada quando múltiplos filtros aplicados, o que criou um
  bug.
  Obrigado a @juanleondev pelo PR!
- `ReferenceSelectionView` renomeado para `ReferenceSelectionInner`
- Adicionados filtros de referência
- Atraso na atualização da tabela ao excluir uma entidade corrigido
- Agora você pode alterar o valor de qualquer propriedade dentro de um campo personalizado.

## [2.0.0-beta.2] - 2023-01-30

- Bug corrigido onde as ações da coleção estavam tendo seu estado interno redefinido.
- Pré-visualização de arquivos que não são imagens, vídeos ou arquivos de áudio aprimorada.
- Otimizações de formulário
- Correção para o diálogo de referência não limpar a seleção
- Correção para múltiplas snackbars de erro, quando há um erro ao fazer upload de um arquivo.
- Correção para destaque ausente ao fechar o diálogo lateral.
- Correção para atualização de dados atrasada ao alterar filtros.
- Refatoração interna do componente `EntityCollectionTable`.
- [BREAKING] No componente `EntityCollectionTable`, a propriedade `ActionsBuilder`
  foi substituída por `actions`.

## [2.0.0-beta.1] - 2023-01-18

Esta é a primeira versão beta do Rebase v2.0.0.
Embora ainda em beta, consideramos esta versão estável o suficiente para ser usada em
produção.

> Todas as alterações relacionadas à versão alfa V2 estão atualmente agrupadas nestes documentos:
> - [O que há de novo na versão 2.0.0](https://rebase.pro/docs/new_in_v2)
> - [Guia de migração da versão 1.x para 2.0.0](https://rebase.pro/docs/migrating_from_v1)

> O registro de alterações para as versões 1.0.0 e anteriores pode ser
> encontrado [aqui](https://rebase.pro/docs/1.0.0/changelog)

---
