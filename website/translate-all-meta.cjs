const fs = require('fs');
const path = require('path');

const enKeys = {
  "agencies.meta.title": "Rebase for Agencies: Deliver Faster, Impress Clients",
  "agencies.meta.description": "Build custom admin panels & CMS for your clients efficiently with Rebase. Reduce development time, enhance client satisfaction, and scale your agency's offerings.",
  "ai.meta.title": "Rebase AI & Agents — MCP Server, AI Autofill & DataTalk",
  "ai.meta.description": "Make your data accessible to AI agents. Rebase provides a Model Context Protocol (MCP) server, AI-powered data enhancement, and natural language SQL queries.",
  "backend.meta.title": "Rebase Backend — Hono Server, REST, GraphQL & WebSocket APIs",
  "backend.meta.description": "A production-ready Hono backend with auto-generated REST and GraphQL APIs, WebSocket realtime, Drizzle ORM, JWT auth, S3 storage, and OpenAPI docs — all from your collection definitions.",
  "cli.meta.title": "Rebase CLI — Scaffold, Generate, Migrate & Deploy",
  "cli.meta.description": "Developer tools for Rebase projects. Create apps, generate schemas, run database migrations, bootstrap auth, and generate typed SDKs — all from one CLI.",
  "contact.meta.title": "Contact Rebase - Get in Touch",
  "contact.meta.description": "We're here to help. Whether you have a question about features, pricing, or anything else, our team is ready to answer all your questions.",
  "developers.meta.title": "Rebase for Developers - The Ultimate Back-Office Framework",
  "developers.meta.description": "Build powerful internal tools, CRUD interfaces, and custom admin panels without the frontend hassle. Built with React and TypeScript for ultimate flexibility and control.",
  "editing.meta.title": "Editing Experience — Notion-Style Rich Text & Beyond | Rebase",
  "editing.meta.description": "A block-based rich text editor, Kanban boards, inline editing, and a fully extensible content experience — all built into Rebase and backed by Postgres.",
  "features.meta.title": "Rebase Features - A Powerful, Intuitive Experience for Your Entire Team",
  "features.meta.description": "From the end-user to the developer, Rebase is designed to make building and managing back-office applications a seamless experience.",
  "rebase-vs-directus.meta.title": "Rebase vs Directus - The React & Code-First Alternative",
  "rebase-vs-directus.meta.description": "Discover why developers migrate from Directus to Rebase. Stop battling database-stored metadata, embrace React, and store your schemas securely in version control.",
  "rebase-vs-django.meta.title": "Rebase vs Django Admin & Laravel Nova - The Decoupled SPA Alternative",
  "rebase-vs-django.meta.description": "Scale beyond monolithic backend admin panels. See why teams move from Django Admin to Rebase to harness real React SPAs and decouple their architecture.",
  "rebase-vs-firebase.meta.title": "Rebase vs Firebase - The Relational Postgres Alternative",
  "rebase-vs-firebase.meta.description": "Learn why growing teams outgrow Firebase's NoSQL limitations and migrate to Rebase to unlock the relational power of PostgreSQL without giving up the BaaS developer experience.",
  "rebase-vs-hasura.meta.title": "Rebase vs Hasura - The Admin UI Alternative",
  "rebase-vs-hasura.meta.description": "Hasura gives you APIs, but Rebase gives you APIs and an entire internal application. Learn why developers choose Rebase for a cohesive full-stack experience.",
  "rebase-vs-payload.meta.title": "Rebase vs Payload CMS - The Postgres Data Alternative",
  "rebase-vs-payload.meta.description": "Compare Rebase and Payload CMS. See how Rebase gives technical and non-technical teams a seamless visual Studio to interact safely with legacy Postgres databases.",
  "rebase-vs-retool.meta.title": "Rebase vs Retool - The Open-Source Code-First Alternative",
  "rebase-vs-retool.meta.description": "Stop paying expensive per-seat pricing and fighting low-code abstractions. See why developers prefer Rebase's open-source, React-native internal tooling platform over Retool.",
  "rebase-vs-strapi.meta.title": "Rebase vs Strapi - Clean Postgres Schemas & Code Workflows",
  "rebase-vs-strapi.meta.description": "Switch to Rebase from Strapi. Stop battling opaque database tables, painful migrations, and slow server reloads.",
  "rebase-vs-supabase.meta.title": "Rebase vs Supabase - The Open-Source Postgres Alternative",
  "rebase-vs-supabase.meta.description": "Discover why teams are migrating from Supabase to Rebase for a unified Node.js backend, true schema-as-code, and built-in UI for RLS and RBAC.",
  "sdk.meta.title": "Rebase Client SDK — Type-Safe Queries, Auth, Storage & Realtime",
  "sdk.meta.description": "A unified TypeScript client for your Rebase backend. Proxy-based data access, fluent query builder, auth, admin, storage, and realtime subscriptions.",
  "security.meta.title": "Rebase Security - Security and Data Sovereignty by Design",
  "security.meta.description": "Rebase is engineered from the ground up to guarantee absolute data ownership, privacy, and security through a transparent, modern architecture.",
  "startups.meta.title": "Rebase for Startups - Move Fast, Scale Smart",
  "startups.meta.description": "Get your startup's admin panel from database to production in minutes, not weeks. Focus on your core product and let Rebase handle the back-office.",
  "studio.meta.title": "Rebase Studio — Visual Admin Panel & Schema Editor",
  "studio.meta.description": "Build and manage your Postgres admin panel visually. Schema editor, spreadsheet views, rich text editor, data import/export, and white-labeling — all from code.",
  "ui.meta.title": "Rebase UI Components - Beautiful, Accessible React Components",
  "ui.meta.description": "Explore the Rebase UI component library - a comprehensive collection of beautiful, accessible React components built for modern web applications.",
  "waitlist.meta.title": "Get Early Access — Rebase",
  "waitlist.meta.description": "Join the waitlist for Rebase, the open-source Postgres CMS.",
  "why-rebase.meta.title": "Why Choose Rebase? - The Open-Source Postgres Admin Panel",
  "why-rebase.meta.description": "Discover why developers choose Rebase over Retool, Supabase, and Forest Admin. Open-source, Postgres-native, with a built-in SQL editor and RLS management.",
  "kit-digital.meta.title": "Kit Digital - Rebase",
  "kit-digital.meta.description": "Información sobre el programa Kit Digital y Rebase."
};

const esKeys = {
  "agencies.meta.title": "Rebase para Agencias: Entrega Más Rápido, Impresiona a los Clientes",
  "agencies.meta.description": "Construye paneles de administración personalizados y CMS para tus clientes de manera eficiente con Rebase. Reduce el tiempo de desarrollo, mejora la satisfacción del cliente y escala las ofertas de tu agencia.",
  "ai.meta.title": "Rebase AI & Agentes — Servidor MCP, Autocompletado de IA y DataTalk",
  "ai.meta.description": "Haz que tus datos sean accesibles para agentes de IA. Rebase proporciona un servidor de Model Context Protocol (MCP), mejora de datos con IA y consultas SQL en lenguaje natural.",
  "backend.meta.title": "Backend de Rebase — Servidor Hono, APIs REST, GraphQL y WebSocket",
  "backend.meta.description": "Un backend Hono listo para producción con APIs REST y GraphQL generadas automáticamente, WebSocket en tiempo real, ORM Drizzle, autenticación JWT, almacenamiento S3 y documentos OpenAPI — todo desde las definiciones de tus colecciones.",
  "cli.meta.title": "Rebase CLI — Genera, Migra y Despliega",
  "cli.meta.description": "Herramientas para desarrolladores de proyectos Rebase. Crea aplicaciones, genera esquemas, ejecuta migraciones de bases de datos, arranca la autenticación y genera SDKs tipados — todo desde una sola CLI.",
  "contact.meta.title": "Contacta con Rebase - Ponte en contacto",
  "contact.meta.description": "Estamos aquí para ayudar. Ya sea que tengas una pregunta sobre características, precios o cualquier otra cosa, nuestro equipo está listo para responder.",
  "developers.meta.title": "Rebase para Desarrolladores - El Marco de Back-Office Definitivo",
  "developers.meta.description": "Construye herramientas internas potentes, interfaces CRUD y paneles de administración personalizados sin problemas de frontend. Construido con React y TypeScript para flexibilidad y control absolutos.",
  "editing.meta.title": "Experiencia de Edición — Texto Enriquecido Estilo Notion y Más | Rebase",
  "editing.meta.description": "Un editor de texto enriquecido basado en bloques, tableros Kanban, edición en línea y una experiencia de contenido totalmente extensible — todo integrado en Rebase y respaldado por Postgres.",
  "features.meta.title": "Características de Rebase - Una Experiencia Potente e Intuitiva para Todo Tu Equipo",
  "features.meta.description": "Desde el usuario final hasta el desarrollador, Rebase está diseñado para hacer que la construcción y gestión de aplicaciones de back-office sea una experiencia perfecta.",
  "rebase-vs-directus.meta.title": "Rebase vs Directus - La Alternativa Code-First y React",
  "rebase-vs-directus.meta.description": "Descubre por qué los desarrolladores migran de Directus a Rebase. Deja de lidiar con metadatos almacenados en la base de datos, adopta React y almacena tus esquemas de forma segura en control de versiones.",
  "rebase-vs-django.meta.title": "Rebase vs Django Admin & Laravel Nova - La Alternativa de SPA Desacoplada",
  "rebase-vs-django.meta.description": "Escale más allá de los paneles de administración monolíticos de backend. Vea por qué los equipos pasan de Django Admin a Rebase para aprovechar aplicaciones web de una sola página en React reales y desacoplar su arquitectura.",
  "rebase-vs-firebase.meta.title": "Rebase vs Firebase - La Alternativa Relacional de Postgres",
  "rebase-vs-firebase.meta.description": "Descubra por qué los equipos en crecimiento superan las limitaciones NoSQL de Firebase y migran a Rebase para desbloquear el poder relacional de PostgreSQL sin renunciar a la experiencia de desarrollo de BaaS.",
  "rebase-vs-hasura.meta.title": "Rebase vs Hasura - La Alternativa a la Interfaz de Usuario de Administración",
  "rebase-vs-hasura.meta.description": "Hasura le proporciona API, pero Rebase le proporciona API y una aplicación interna completa. Obtenga información sobre por qué los desarrolladores eligen Rebase para obtener una experiencia integral y coherente.",
  "rebase-vs-payload.meta.title": "Rebase vs Payload CMS - La Alternativa a los Datos de Postgres",
  "rebase-vs-payload.meta.description": "Compare Rebase y Payload CMS. Descubra cómo Rebase ofrece a los equipos técnicos y no técnicos un estudio visual optimizado para interactuar de forma segura con bases de datos antiguas de Postgres.",
  "rebase-vs-retool.meta.title": "Rebase vs Retool - La Alternativa Code-First de Código Abierto",
  "rebase-vs-retool.meta.description": "Deje de pagar los costosos precios por usuario y de luchar con abstracciones de código bajo. Descubra por qué los desarrolladores prefieren la plataforma de herramientas internas nativa de React y de código abierto de Rebase a la de Retool.",
  "rebase-vs-strapi.meta.title": "Rebase vs Strapi - Esquemas Claros de Postgres y Flujos de Trabajo de Código",
  "rebase-vs-strapi.meta.description": "Cambie de Strapi a Rebase. Deje de lidiar con tablas de bases de datos opacas, migraciones dolorosas y recargas de servidores lentas.",
  "rebase-vs-supabase.meta.title": "Rebase vs Supabase - La Alternativa de Postgres de Código Abierto",
  "rebase-vs-supabase.meta.description": "Descubra por qué los equipos están migrando de Supabase a Rebase para obtener un servidor backend de Node.js unificado, verdadero código como esquema y una interfaz de usuario integrada para la seguridad a nivel de fila y el control de acceso basado en roles.",
  "sdk.meta.title": "Rebase SDK de Cliente — Consultas con Tipado Seguro, Autenticación, Almacenamiento y Tiempo Real",
  "sdk.meta.description": "Un cliente TypeScript unificado para su backend de Rebase. Acceso a datos basado en proxies, un creador de consultas fluido, autenticación, administración, almacenamiento y suscripciones en tiempo real.",
  "security.meta.title": "Seguridad de Rebase - Seguridad y Soberanía de Datos desde el Diseño",
  "security.meta.description": "Rebase está diseñado desde cero para garantizar la propiedad, privacidad y seguridad absolutas de los datos a través de una arquitectura moderna y transparente.",
  "startups.meta.title": "Rebase para Startups - Muévete Rápido, Escala con Inteligencia",
  "startups.meta.description": "Obtén el panel de administración de tu startup desde la base de datos a producción en minutos, no en semanas. Concéntrate en tu producto principal y deja que Rebase maneje el back-office.",
  "studio.meta.title": "Rebase Studio — Panel de Administración Visual y Editor de Esquemas",
  "studio.meta.description": "Construye y administra tu panel de administración de Postgres visualmente. Editor de esquemas, vistas de hoja de cálculo, editor de texto enriquecido, importación/exportación de datos y marca blanca — todo desde el código.",
  "ui.meta.title": "Componentes UI de Rebase - Componentes React Hermosos y Accesibles",
  "ui.meta.description": "Explora la biblioteca de componentes UI de Rebase: una colección completa de hermosos y accesibles componentes de React diseñados para aplicaciones web modernas.",
  "waitlist.meta.title": "Obtén Acceso Anticipado — Rebase",
  "waitlist.meta.description": "Únete a la lista de espera de Rebase, el CMS de Postgres de código abierto.",
  "why-rebase.meta.title": "¿Por qué Elegir Rebase? - El Panel de Administración de Postgres de Código Abierto",
  "why-rebase.meta.description": "Descubra por qué los desarrolladores eligen Rebase en lugar de Retool, Supabase y Forest Admin. De código abierto, nativo de Postgres, con un editor SQL incorporado y administración RLS.",
  "kit-digital.meta.title": "Kit Digital - Rebase",
  "kit-digital.meta.description": "Información sobre el programa Kit Digital y Rebase."
};

const frKeys = {
  "agencies.meta.title": "Rebase pour les Agences : Livrez Plus Vite, Impressionnez Vos Clients",
  "agencies.meta.description": "Créez des panneaux d'administration et des CMS sur mesure pour vos clients efficacement avec Rebase. Réduisez le temps de développement, améliorez la satisfaction de vos clients et faites évoluer les offres de votre agence.",
  "ai.meta.title": "IA et Agents Rebase — Serveur MCP, Remplissage Auto IA et DataTalk",
  "ai.meta.description": "Rendez vos données accessibles aux agents IA. Rebase fournit un serveur MCP (Model Context Protocol), l'amélioration des données assistée par IA et des requêtes SQL en langage naturel.",
  "backend.meta.title": "Backend Rebase — Serveur Hono, API REST, GraphQL et WebSocket",
  "backend.meta.description": "Un backend Hono prêt pour la production avec des API REST et GraphQL générées automatiquement, un temps réel WebSocket, Drizzle ORM, l'authentification JWT, le stockage S3 et la documentation OpenAPI — tout cela depuis les définitions de vos collections.",
  "cli.meta.title": "Rebase CLI — Générer, Migrer et Déployer",
  "cli.meta.description": "Outils de développement pour les projets Rebase. Créez des applications, générez des schémas, effectuez des migrations de base de données, lancez l'authentification et générez des SDKs typés — le tout à partir d'une seule CLI.",
  "contact.meta.title": "Contactez Rebase - Entrez en contact",
  "contact.meta.description": "Nous sommes là pour vous aider. Que vous ayez une question concernant nos fonctionnalités, notre tarification ou autre, notre équipe se tient à votre entière disposition.",
  "developers.meta.title": "Rebase pour Développeurs - Le Framework Back-Office Ultime",
  "developers.meta.description": "Construisez de puissants outils internes, des interfaces CRUD et des panneaux d'administration personnalisés sans les tracas du frontend. Construit avec React et TypeScript pour une flexibilité et un contrôle ultimes.",
  "editing.meta.title": "Expérience d'Édition — Texte Riche Façon Notion & Plus | Rebase",
  "editing.meta.description": "Un éditeur de texte enrichi basé sur des blocs, des tableaux Kanban, de l'édition en ligne, et une expérience de contenu entièrement extensible — le tout intégré dans Rebase et soutenu par Postgres.",
  "features.meta.title": "Fonctionnalités de Rebase - Une Expérience Puissante et Intuitive Pour Toute Votre Équipe",
  "features.meta.description": "De l'utilisateur final au développeur, Rebase est conçu pour rendre la création et la gestion d'applications back-office transparentes.",
  "rebase-vs-directus.meta.title": "Rebase vs Directus - L'Alternative Code-First et React",
  "rebase-vs-directus.meta.description": "Découvrez pourquoi les développeurs migrent de Directus vers Rebase. Arrêtez de vous battre avec les métadonnées stockées dans la base de données, adoptez React et stockez vos schémas en toute sécurité dans un outil de contrôle de versions.",
  "rebase-vs-django.meta.title": "Rebase vs Django Admin & Laravel Nova - L'Alternative SPA Découplée",
  "rebase-vs-django.meta.description": "Allez au-delà des panneaux d'administration backend monolithiques. Découvrez pourquoi les équipes passent de Django Admin à Rebase pour exploiter de véritables applications monopages (SPA) React et découpler leur architecture.",
  "rebase-vs-firebase.meta.title": "Rebase vs Firebase - L'Alternative Relationnelle Postgres",
  "rebase-vs-firebase.meta.description": "Découvrez pourquoi les équipes en croissance dépassent les limites NoSQL de Firebase et migrent vers Rebase pour exploiter la puissance relationnelle de PostgreSQL sans sacrifier l'expérience de développement BaaS.",
  "rebase-vs-hasura.meta.title": "Rebase vs Hasura - L'Alternative pour l'Interface d'Administration",
  "rebase-vs-hasura.meta.description": "Hasura vous donne des API, mais Rebase vous donne des API et une application interne complète. Découvrez pourquoi les développeurs choisissent Rebase pour une expérience full-stack cohésive.",
  "rebase-vs-payload.meta.title": "Rebase vs Payload CMS - L'Alternative pour les Données Postgres",
  "rebase-vs-payload.meta.description": "Comparez Rebase et Payload CMS. Voyez comment Rebase donne aux équipes techniques et non techniques un Studio visuel transparent pour interagir en toute sécurité avec les anciennes bases de données Postgres.",
  "rebase-vs-retool.meta.title": "Rebase vs Retool - L'Alternative Code-First Open-Source",
  "rebase-vs-retool.meta.description": "Cessez de payer des licences par siège coûteuses et de vous battre avec des abstractions low-code. Découvrez pourquoi les développeurs préfèrent la plateforme d'outils internes native React et open source de Rebase à Retool.",
  "rebase-vs-strapi.meta.title": "Rebase vs Strapi - Schémas Postgres Propres et Flux de Travail par Code",
  "rebase-vs-strapi.meta.description": "Passez de Strapi à Rebase. Cessez de vous battre avec des tables de base de données opaques, des migrations douloureuses et des rechargements de serveur lents.",
  "rebase-vs-supabase.meta.title": "Rebase vs Supabase - L'Alternative Postgres Open-Source",
  "rebase-vs-supabase.meta.description": "Découvrez pourquoi les équipes migrent de Supabase vers Rebase pour obtenir un backend Node.js unifié, un véritable schéma en tant que code et une interface utilisateur intégrée pour la sécurité au niveau des lignes et le contrôle d'accès basé sur les rôles.",
  "sdk.meta.title": "SDK Client Rebase — Requêtes Typées, Auth, Stockage & Temps Réel",
  "sdk.meta.description": "Un client TypeScript unifié pour votre backend Rebase. Accès aux données basé sur des proxies, un générateur de requêtes fluide, authentification, administration, stockage, et abonnements en temps réel.",
  "security.meta.title": "Sécurité Rebase - Sécurité et Souveraineté des Données Dès la Conception",
  "security.meta.description": "Rebase est conçu dès le départ pour garantir la propriété absolue des données, la confidentialité et la sécurité grâce à une architecture moderne et transparente.",
  "startups.meta.title": "Rebase pour Start-ups - Allez Vite, Évoluez Intelligemment",
  "startups.meta.description": "Obtenez le panneau d'administration de votre start-up de la base de données à la production en quelques minutes, et non en plusieurs semaines. Concentrez-vous sur votre produit principal et laissez Rebase gérer le back-office.",
  "studio.meta.title": "Studio Rebase — Panneau d'Administration Visuel & Éditeur de Schéma",
  "studio.meta.description": "Créez et gérez votre panneau d'administration Postgres visuellement. Éditeur de schéma, vues tableur, éditeur de texte enrichi, importation/exportation de données et marque blanche — tout par le code.",
  "ui.meta.title": "Composants UI Rebase - De Beaux Composants React Accessibles",
  "ui.meta.description": "Explorez la bibliothèque de composants UI de Rebase : une collection complète de superbes composants React accessibles conçus pour les applications web modernes.",
  "waitlist.meta.title": "Accès Anticipé — Rebase",
  "waitlist.meta.description": "Rejoignez la liste d'attente de Rebase, le CMS Postgres open-source.",
  "why-rebase.meta.title": "Pourquoi Choisir Rebase ? - Le Panneau d'Administration Postgres Open-Source",
  "why-rebase.meta.description": "Découvrez pourquoi les développeurs choisissent Rebase plutôt que Retool, Supabase et Forest Admin. Open source, natif à Postgres, avec un éditeur SQL intégré et une gestion RLS.",
  "kit-digital.meta.title": "Kit Digital - Rebase",
  "kit-digital.meta.description": "Informations concernant le programme Kit Digital et Rebase."
};

const deKeys = {
  "agencies.meta.title": "Rebase für Agenturen: Schneller liefern, Kunden beeindrucken",
  "agencies.meta.description": "Erstellen Sie mit Rebase effizient benutzerdefinierte Admin-Panels & CMS für Ihre Kunden. Reduzieren Sie die Entwicklungszeit, steigern Sie die Kundenzufriedenheit und skalieren Sie die Angebote Ihrer Agentur.",
  "ai.meta.title": "Rebase AI & Agenten — MCP Server, KI Autofill & DataTalk",
  "ai.meta.description": "Machen Sie Ihre Daten für KI-Agenten zugänglich. Rebase bietet einen Model Context Protocol (MCP) Server, KI-gestützte Datenverbesserung und natürlichsprachige SQL-Abfragen.",
  "backend.meta.title": "Rebase Backend — Hono Server, REST, GraphQL & WebSocket APIs",
  "backend.meta.description": "Ein produktionsbereites Hono-Backend mit automatisch generierten REST- und GraphQL-APIs, WebSocket in Echtzeit, Drizzle ORM, JWT-Authentifizierung, S3-Speicher und OpenAPI-Dokumenten — alles aus Ihren Sammlungsdefinitionen.",
  "cli.meta.title": "Rebase CLI — Generieren, Migrieren & Bereitstellen",
  "cli.meta.description": "Entwicklertools für Rebase-Projekte. Erstellen Sie Apps, generieren Sie Schemata, führen Sie Datenbankmigrationen durch, starten Sie die Authentifizierung und generieren Sie typisierte SDKs — alles über eine CLI.",
  "contact.meta.title": "Kontaktieren Sie Rebase - Treten Sie mit uns in Verbindung",
  "contact.meta.description": "Wir sind hier, um zu helfen. Egal, ob Sie eine Frage zu Funktionen, Preisen oder etwas anderem haben, unser Team beantwortet gerne alle Ihre Fragen.",
  "developers.meta.title": "Rebase für Entwickler - Das ultimative Back-Office Framework",
  "developers.meta.description": "Erstellen Sie leistungsstarke interne Tools, CRUD-Schnittstellen und benutzerdefinierte Admin-Panels ohne den Frontend-Ärger. Entwickelt mit React und TypeScript für ultimative Flexibilität und Kontrolle.",
  "editing.meta.title": "Bearbeitungserfahrung — Notion-Style Rich Text & Mehr | Rebase",
  "editing.meta.description": "Ein blockbasierter Rich-Text-Editor, Kanban-Boards, Inline-Bearbeitung und ein vollständig erweiterbares Inhaltserlebnis — alles integriert in Rebase und unterstützt durch Postgres.",
  "features.meta.title": "Rebase Funktionen - Ein Leistungsstarkes, Intuitives Erlebnis für Ihr Gesamtes Team",
  "features.meta.description": "Vom Endbenutzer bis zum Entwickler wurde Rebase entwickelt, um die Erstellung und Verwaltung von Back-Office-Anwendungen zu einem nahtlosen Erlebnis zu machen.",
  "rebase-vs-directus.meta.title": "Rebase vs. Directus - Die React- & Code-First-Alternative",
  "rebase-vs-directus.meta.description": "Entdecken Sie, warum Entwickler von Directus zu Rebase wechseln. Hören Sie auf, sich mit datenbankgespeicherten Metadaten herumzuschlagen, nehmen Sie React an und speichern Sie Ihre Schemata sicher in der Versionskontrolle.",
  "rebase-vs-django.meta.title": "Rebase vs Django Admin & Laravel Nova - Die entkoppelte SPA-Alternative",
  "rebase-vs-django.meta.description": "Skalieren Sie über monolithische Backend-Admin-Panels hinaus. Erfahren Sie, warum Teams von Django Admin zu Rebase wechseln, um echte React SPAs zu nutzen und ihre Architektur zu entkoppeln.",
  "rebase-vs-firebase.meta.title": "Rebase vs. Firebase - Die relationale Postgres-Alternative",
  "rebase-vs-firebase.meta.description": "Erfahren Sie, warum wachsende Teams den NoSQL-Einschränkungen von Firebase entwachsen und zu Rebase migrieren, um die relationale Leistung von PostgreSQL freizusetzen, ohne auf die BaaS-Entwicklererfahrung zu verzichten.",
  "rebase-vs-hasura.meta.title": "Rebase vs. Hasura - Die Admin UI-Alternative",
  "rebase-vs-hasura.meta.description": "Hasura bietet Ihnen APIs, aber Rebase bietet Ihnen APIs und eine vollständige interne Anwendung. Erfahren Sie, warum Entwickler Rebase für ein einheitliches Full-Stack-Erlebnis wählen.",
  "rebase-vs-payload.meta.title": "Rebase vs. Payload CMS - Die Alternative für Postgres-Daten",
  "rebase-vs-payload.meta.description": "Vergleichen Sie Rebase und Payload CMS. Sehen Sie, wie Rebase technischen und nicht-technischen Teams ein nahtloses visuelles Studio bietet, um sicher mit älteren Postgres-Datenbanken zu interagieren.",
  "rebase-vs-retool.meta.title": "Rebase vs. Retool - Die Open-Source-Code-First-Alternative",
  "rebase-vs-retool.meta.description": "Hören Sie auf, teure Preise pro Arbeitsplatz zu zahlen und sich mit Low-Code-Abstraktionen herumzuschlagen. Sehen Sie, warum Entwickler die Open-Source-Plattform für React-native interne Tools von Rebase gegenüber Retool bevorzugen.",
  "rebase-vs-strapi.meta.title": "Rebase vs. Strapi - Saubere Postgres-Schemata & Code-Workflows",
  "rebase-vs-strapi.meta.description": "Wechseln Sie von Strapi zu Rebase. Hören Sie auf, sich mit undurchsichtigen Datenbanktabellen, schmerzhaften Migrationen und langsamem Server-Neuladen herumzuschlagen.",
  "rebase-vs-supabase.meta.title": "Rebase vs Supabase - Die Open-Source-Postgres-Alternative",
  "rebase-vs-supabase.meta.description": "Entdecken Sie, warum Teams von Supabase zu Rebase migrieren, um ein einheitliches Node.js-Backend, echte Schemata als Code und eine integrierte Benutzeroberfläche für RLS und RBAC zu erhalten.",
  "sdk.meta.title": "Rebase Client SDK — Typsichere Abfragen, Auth, Storage & Realtime",
  "sdk.meta.description": "Ein einheitlicher TypeScript-Client für Ihr Rebase-Backend. Proxy-basierter Datenzugriff, fließender Query-Builder, Authentifizierung, Administration, Speicher und Echtzeit-Abonnements.",
  "security.meta.title": "Rebase-Sicherheit - Sicherheit und Datensouveränität nach dem Prinzip „Secure by Design“",
  "security.meta.description": "Rebase wurde von Grund auf so konzipiert, dass durch eine transparente, moderne Architektur absolute Dateneigentümerschaft, Datenschutz und Sicherheit gewährleistet sind.",
  "startups.meta.title": "Rebase für Start-ups - Schnell Bewegen, Intelligent Skalieren",
  "startups.meta.description": "Bringen Sie das Admin-Panel Ihres Start-ups in wenigen Minuten, nicht in Wochen, von der Datenbank in die Produktion. Konzentrieren Sie sich auf Ihr Kernprodukt und lassen Sie Rebase das Back-Office verwalten.",
  "studio.meta.title": "Rebase Studio — Visuelles Admin-Panel & Schema-Editor",
  "studio.meta.description": "Erstellen und verwalten Sie Ihr Postgres-Admin-Panel visuell. Schema-Editor, Tabellenkalkulationsansichten, Rich-Text-Editor, Datenimport/-export und White-Labeling — alles aus Code.",
  "ui.meta.title": "Rebase UI Komponenten - Schöne, zugängliche React-Komponenten",
  "ui.meta.description": "Entdecken Sie die Rebase UI-Komponentenbibliothek – eine umfassende Sammlung schöner, zugänglicher React-Komponenten, die für moderne Webanwendungen entwickelt wurden.",
  "waitlist.meta.title": "Erhalten Sie Vorabzugang — Rebase",
  "waitlist.meta.description": "Tragen Sie sich in die Warteliste für Rebase, das Open-Source Postgres-CMS, ein.",
  "why-rebase.meta.title": "Warum Rebase wählen? - Das Open-Source-Postgres-Admin-Panel",
  "why-rebase.meta.description": "Erfahren Sie, warum Entwickler Rebase gegenüber Retool, Supabase und Forest Admin bevorzugen. Open Source, nativ für Postgres, mit integriertem SQL-Editor und RLS-Verwaltung.",
  "kit-digital.meta.title": "Kit Digital - Rebase",
  "kit-digital.meta.description": "Informationen über das Kit Digital Programm und Rebase."
};

const i18nDir = '/Users/francesco/rebase/website/src/i18n';

function updateLang(lang, newData) {
  const filePath = path.join(i18nDir, `${lang}.ts`);
  let content = fs.readFileSync(filePath, 'utf8');
  
  const lastBraceIndex = content.lastIndexOf('};');
  if (lastBraceIndex === -1) return;
  
  let newEntries = '';
  for (const [key, value] of Object.entries(newData)) {
    if (!content.includes(`"${key}"`)) {
      newEntries += `  "${key}": ${JSON.stringify(value)},\n`;
    }
  }
  
  if (newEntries) {
    content = content.substring(0, lastBraceIndex) + newEntries + '};\n';
    fs.writeFileSync(filePath, content);
    console.log(`Updated ${lang}.ts`);
  }
}

updateLang('en', enKeys);
updateLang('es', esKeys);
updateLang('fr', frKeys);
updateLang('de', deKeys);
