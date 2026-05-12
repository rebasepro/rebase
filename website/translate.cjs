const fs = require('fs');
const path = require('path');

const newEn = {
  "about.meta.title": "About Rebase - Our Mission to Empower Developers",
  "about.meta.description": "Rebase was born from a simple, recurring frustration: building internal tools and admin panels is a slow, repetitive, and thankless task.",
  "about.hero.title": "Our Mission",
  "about.hero.subtitle": "Rebase was born from a simple, recurring frustration: building internal tools and admin panels is a <b class=\"text-white font-medium\">slow, repetitive, and thankless task</b>. We believe developers should be focused on core product innovation, not reinventing the CRUD interface for the hundredth time.",
  "about.story.title": "From a Developer's Toolkit to a Global Platform.",
  "about.story.p1": "Rebase started as an internal tool to launch a back-office in minutes, not weeks. Like many developers, our founders were tired of rebuilding the same admin interfaces for every new project. They wanted to focus on building great products, not spend weeks on CRUD operations, authentication, and form validation.",
  "about.story.p2": "What began as a side project quickly gained traction in the open-source community. Developers from around the world started using Rebase to build everything from content management systems to complex internal tools for enterprises.",
  "about.story.p3": "Today, Rebase is a platform trusted by teams at companies like <b class=\"text-white font-medium\">Microsoft</b> and <b class=\"text-white font-medium\">IKEA</b> to build the critical internal tools that power their businesses. We're proud to be helping thousands of developers save time and ship faster.",
  "about.values.title": "Our Values",
  "about.values.v1.title": "Developer First",
  "about.values.v1.desc": "Every decision we make starts with one question: \"Does this make developers' lives easier?\" We prioritize great DX, comprehensive docs, and powerful APIs.",
  "about.values.v2.title": "Transparency",
  "about.values.v2.desc": "We're open-source and proud of it. Our code, our roadmap, and our decision-making are transparent. We believe in building trust through openness.",
  "about.values.v3.title": "Community Driven",
  "about.values.v3.desc": "Our best features come from our community. We listen, we iterate, and we build what developers actually need, not what we think they need.",
  "about.stats.title": "Rebase by the Numbers",
  "about.stats.s1.value": "1k+",
  "about.stats.s1.label": "GitHub Stars",
  "about.stats.s2.value": "1M+",
  "about.stats.s2.label": "Downloads",
  "about.stats.s3.value": "100+",
  "about.stats.s3.label": "Contributors",
  "about.join.title": "Help Us Build the Future of Back-Office Development",
  "about.join.desc": "We're always looking for passionate developers to join our community and contribute to the project.",
  "about.join.github": "Contribute on GitHub",
  "about.join.discord": "Join our Discord",
};

const newEs = {
  "about.meta.title": "Sobre Rebase - Nuestra Misión de Empoderar a los Desarrolladores",
  "about.meta.description": "Rebase nació de una frustración simple y recurrente: construir herramientas internas y paneles de administración es una tarea lenta, repetitiva y poco agradecida.",
  "about.hero.title": "Nuestra Misión",
  "about.hero.subtitle": "Rebase nació de una frustración simple y recurrente: construir herramientas internas y paneles de administración es una <b class=\"text-white font-medium\">tarea lenta, repetitiva y poco agradecida</b>. Creemos que los desarrolladores deben centrarse en la innovación del producto principal, no en reinventar la interfaz CRUD por centésima vez.",
  "about.story.title": "De un kit de herramientas para desarrolladores a una plataforma global.",
  "about.story.p1": "Rebase comenzó como una herramienta interna para lanzar un back-office en minutos, no en semanas. Al igual que muchos desarrolladores, nuestros fundadores estaban cansados de reconstruir las mismas interfaces de administración para cada nuevo proyecto. Querían enfocarse en construir grandes productos, no pasar semanas en operaciones CRUD, autenticación y validación de formularios.",
  "about.story.p2": "Lo que comenzó como un proyecto paralelo ganó terreno rápidamente en la comunidad de código abierto. Desarrolladores de todo el mundo comenzaron a usar Rebase para construir desde sistemas de gestión de contenido hasta complejas herramientas internas para empresas.",
  "about.story.p3": "Hoy, Rebase es una plataforma en la que confían equipos en empresas como <b class=\"text-white font-medium\">Microsoft</b> e <b class=\"text-white font-medium\">IKEA</b> para construir las herramientas internas críticas que impulsan sus negocios. Estamos orgullosos de ayudar a miles de desarrolladores a ahorrar tiempo y lanzar más rápido.",
  "about.values.title": "Nuestros Valores",
  "about.values.v1.title": "Primero el Desarrollador",
  "about.values.v1.desc": "Cada decisión que tomamos comienza con una pregunta: \"¿Esto hace la vida de los desarrolladores más fácil?\" Priorizamos una excelente experiencia de desarrollador, documentación completa y APIs potentes.",
  "about.values.v2.title": "Transparencia",
  "about.values.v2.desc": "Somos de código abierto y estamos orgullosos de ello. Nuestro código, nuestra hoja de ruta y nuestra toma de decisiones son transparentes. Creemos en construir confianza a través de la apertura.",
  "about.values.v3.title": "Impulsado por la Comunidad",
  "about.values.v3.desc": "Nuestras mejores características provienen de nuestra comunidad. Escuchamos, iteramos y construimos lo que los desarrolladores realmente necesitan, no lo que pensamos que necesitan.",
  "about.stats.title": "Rebase en Números",
  "about.stats.s1.value": "1k+",
  "about.stats.s1.label": "Estrellas de GitHub",
  "about.stats.s2.value": "1M+",
  "about.stats.s2.label": "Descargas",
  "about.stats.s3.value": "100+",
  "about.stats.s3.label": "Colaboradores",
  "about.join.title": "Ayúdanos a Construir el Futuro del Desarrollo de Back-Office",
  "about.join.desc": "Siempre estamos buscando desarrolladores apasionados para unirse a nuestra comunidad y contribuir al proyecto.",
  "about.join.github": "Contribuir en GitHub",
  "about.join.discord": "Únete a nuestro Discord",
};

const newFr = {
  "about.meta.title": "À propos de Rebase - Notre mission d'autonomiser les développeurs",
  "about.meta.description": "Rebase est né d'une frustration simple et récurrente : la création d'outils internes et de panneaux d'administration est une tâche lente, répétitive et ingrate.",
  "about.hero.title": "Notre Mission",
  "about.hero.subtitle": "Rebase est né d'une frustration simple et récurrente : la création d'outils internes et de panneaux d'administration est une <b class=\"text-white font-medium\">tâche lente, répétitive et ingrate</b>. Nous pensons que les développeurs devraient se concentrer sur l'innovation de base du produit, et non sur la réinvention de l'interface CRUD pour la centième fois.",
  "about.story.title": "D'une boîte à outils pour développeurs à une plateforme mondiale.",
  "about.story.p1": "Rebase a commencé comme un outil interne pour lancer un back-office en quelques minutes, pas en quelques semaines. Comme beaucoup de développeurs, nos fondateurs étaient fatigués de reconstruire les mêmes interfaces d'administration pour chaque nouveau projet. Ils voulaient se concentrer sur la création d'excellents produits, pas passer des semaines sur les opérations CRUD, l'authentification et la validation des formulaires.",
  "about.story.p2": "Ce qui a commencé comme un projet parallèle a rapidement gagné du terrain dans la communauté open-source. Les développeurs du monde entier ont commencé à utiliser Rebase pour créer tout, des systèmes de gestion de contenu aux outils internes complexes pour les entreprises.",
  "about.story.p3": "Aujourd'hui, Rebase est une plateforme approuvée par des équipes d'entreprises comme <b class=\"text-white font-medium\">Microsoft</b> et <b class=\"text-white font-medium\">IKEA</b> pour construire les outils internes critiques qui propulsent leurs activités. Nous sommes fiers d'aider des milliers de développeurs à gagner du temps et à publier plus rapidement.",
  "about.values.title": "Nos Valeurs",
  "about.values.v1.title": "Le développeur d'abord",
  "about.values.v1.desc": "Chaque décision que nous prenons commence par une question : « Est-ce que cela facilite la vie des développeurs ? » Nous accordons la priorité à une excellente expérience de développement, à une documentation complète et à des API puissantes.",
  "about.values.v2.title": "Transparence",
  "about.values.v2.desc": "Nous sommes open source et nous en sommes fiers. Notre code, notre feuille de route et nos prises de décision sont transparents. Nous croyons qu'il faut bâtir la confiance par l'ouverture.",
  "about.values.v3.title": "Axé sur la communauté",
  "about.values.v3.desc": "Nos meilleures fonctionnalités proviennent de notre communauté. Nous écoutons, nous itérons et nous construisons ce dont les développeurs ont réellement besoin, et non ce que nous pensons qu'ils ont besoin.",
  "about.stats.title": "Rebase en chiffres",
  "about.stats.s1.value": "1k+",
  "about.stats.s1.label": "Étoiles GitHub",
  "about.stats.s2.value": "1M+",
  "about.stats.s2.label": "Téléchargements",
  "about.stats.s3.value": "100+",
  "about.stats.s3.label": "Contributeurs",
  "about.join.title": "Aidez-nous à construire l'avenir du développement Back-Office",
  "about.join.desc": "Nous sommes toujours à la recherche de développeurs passionnés pour rejoindre notre communauté et contribuer au projet.",
  "about.join.github": "Contribuer sur GitHub",
  "about.join.discord": "Rejoignez notre Discord",
};

const newDe = {
  "about.meta.title": "Über Rebase - Unsere Mission, Entwickler zu stärken",
  "about.meta.description": "Rebase entstand aus einer einfachen, wiederkehrenden Frustration: Das Erstellen von internen Tools und Admin-Panels ist eine langsame, sich wiederholende und undankbare Aufgabe.",
  "about.hero.title": "Unsere Mission",
  "about.hero.subtitle": "Rebase entstand aus einer einfachen, wiederkehrenden Frustration: Das Erstellen von internen Tools und Admin-Panels ist eine <b class=\"text-white font-medium\">langsame, sich wiederholende und undankbare Aufgabe</b>. Wir glauben, dass Entwickler sich auf die Kerninnovation des Produkts konzentrieren sollten und nicht zum hundertsten Mal die CRUD-Oberfläche neu erfinden sollten.",
  "about.story.title": "Von einem Entwickler-Toolkit zu einer globalen Plattform.",
  "about.story.p1": "Rebase begann als internes Tool, um ein Backoffice in Minuten und nicht in Wochen zu starten. Wie viele Entwickler waren unsere Gründer es leid, für jedes neue Projekt dieselben Admin-Schnittstellen neu zu erstellen. Sie wollten sich auf die Entwicklung großartiger Produkte konzentrieren und keine Wochen mit CRUD-Operationen, Authentifizierung und Formularvalidierung verbringen.",
  "about.story.p2": "Was als Nebenprojekt begann, gewann in der Open-Source-Community schnell an Bedeutung. Entwickler auf der ganzen Welt nutzten Rebase, um alles zu erstellen, von Content-Management-Systemen bis hin zu komplexen internen Tools für Unternehmen.",
  "about.story.p3": "Heute ist Rebase eine Plattform, der Teams bei Unternehmen wie <b class=\"text-white font-medium\">Microsoft</b> und <b class=\"text-white font-medium\">IKEA</b> vertrauen, um die kritischen internen Tools zu erstellen, die ihre Geschäfte antreiben. Wir sind stolz darauf, Tausenden von Entwicklern zu helfen, Zeit zu sparen und schneller zu liefern.",
  "about.values.title": "Unsere Werte",
  "about.values.v1.title": "Entwickler zuerst",
  "about.values.v1.desc": "Jede Entscheidung, die wir treffen, beginnt mit einer Frage: „Macht das das Leben der Entwickler einfacher?“ Wir legen Wert auf großartige DX, umfassende Dokumentation und leistungsstarke APIs.",
  "about.values.v2.title": "Transparenz",
  "about.values.v2.desc": "Wir sind Open Source und stolz darauf. Unser Code, unsere Roadmap und unsere Entscheidungsfindung sind transparent. Wir glauben daran, durch Offenheit Vertrauen aufzubauen.",
  "about.values.v3.title": "Community-getrieben",
  "about.values.v3.desc": "Unsere besten Funktionen stammen aus unserer Community. Wir hören zu, iterieren und entwickeln das, was Entwickler tatsächlich brauchen, und nicht das, was wir denken, dass sie brauchen.",
  "about.stats.title": "Rebase in Zahlen",
  "about.stats.s1.value": "1k+",
  "about.stats.s1.label": "GitHub-Sterne",
  "about.stats.s2.value": "1M+",
  "about.stats.s2.label": "Downloads",
  "about.stats.s3.value": "100+",
  "about.stats.s3.label": "Mitwirkende",
  "about.join.title": "Helfen Sie uns, die Zukunft der Backoffice-Entwicklung aufzubauen",
  "about.join.desc": "Wir sind immer auf der Suche nach leidenschaftlichen Entwicklern, die unserer Community beitreten und zum Projekt beitragen.",
  "about.join.github": "Tragen Sie auf GitHub bei",
  "about.join.discord": "Treten Sie unserem Discord bei",
};

const i18nDir = '/Users/francesco/rebase/website/src/i18n';

function updateLang(lang, newData) {
  const filePath = path.join(i18nDir, `${lang}.ts`);
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Find the end of the exported object
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

updateLang('en', newEn);
updateLang('es', newEs);
updateLang('fr', newFr);
updateLang('de', newDe);
