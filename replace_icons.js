const fs = require('fs');
const path = '/Users/francesco/rebase/website/src/components/SchemaEditorDemo.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Import Icon
content = content.replace(
    'import React, { useEffect, useState } from "react";',
    'import React, { useEffect, useState } from "react";\nimport { Icon } from "@rebasepro/ui";'
);

// 2. Replacements for simple material-icons spans
const spanRegex1 = /<span className="material-icons select-none" style={{ fontSize: "(\d+)px" }}>\s*([a-z_]+)\s*<\/span>/g;
const spanRegex2 = /<span className="material-icons text-text-disabled dark:text-text-disabled-dark select-none absolute -right-2 -top-2"\s*style={{ fontSize: "(\d+)px" }}\s*>\s*([a-z_]+)\s*<\/span>/g;
const spanRegex3 = /<span className="material-icons select-none"\s*style={{ fontSize: "(\d+)px" }}>([a-z_]+)<\/span>/g;
const spanRegex4 = /<span className="material-icons select-none transition"\s*style={{ fontSize: "(\d+)px" }}>([a-z_]+)<\/span>/g;

const iconMap = {
    'drag_handle': 'GripVertical',
    'do_not_disturb_on': 'Ban',
    'code': 'Code',
    'autorenew': 'RefreshCw',
    'add': 'Plus',
    'ballot': 'ListTodo',
    'short_text': 'Type',
    'delete': 'Trash2',
    'rule': 'CheckSquare',
    'keyboard_arrow_down': 'ChevronDown',
};

function replacer(match, size, iconName) {
    let iconKey = iconMap[iconName] || iconName;
    return `<Icon iconKey="${iconKey}" size={${size}} className="select-none" />`;
}

content = content.replace(spanRegex1, replacer);
content = content.replace(spanRegex3, replacer);

content = content.replace(spanRegex2, (match, size, iconName) => {
    let iconKey = iconMap[iconName] || iconName;
    return `<Icon iconKey="${iconKey}" size={${size}} className="text-text-disabled dark:text-text-disabled-dark select-none absolute -right-2 -top-2" />`;
});

content = content.replace(spanRegex4, (match, size, iconName) => {
    let iconKey = iconMap[iconName] || iconName;
    return `<Icon iconKey="${iconKey}" size={${size}} className="select-none transition" />`;
});

// For {icon} variable usage
content = content.replace(
    /<span className="material-icons select-none" style={{ fontSize: "20px" }}>\s*\{icon\}\s*<\/span>/g,
    '<Icon iconKey={icon} size={20} className="select-none" />'
);

// Map the array properties
const arrayIconMap = {
    'short_text': 'Type',
    'upload_file': 'Upload',
    'list': 'List',
    'flag': 'ToggleRight',
    'functions': 'FunctionSquare',
    'format_quote': 'Quote',
    'http': 'Globe',
    'drive_folder_upload': 'FolderUp',
    'add_link': 'Link2',
    'list_alt': 'ListChecks',
    'repeat': 'Repeat',
    'schedule': 'Clock',
    'ballot': 'ListTodo',
    'subject': 'AlignLeft',
    'mail': 'Mail',
    'link': 'Link',
    'format_list_numbered': 'ListOrdered',
    'person': 'User',
    'numbers': 'Hash',
    'view_stream': 'Rows'
};

for (const [oldIcon, newIcon] of Object.entries(arrayIconMap)) {
    content = content.replace(new RegExp(`icon: "${oldIcon}"`, 'g'), `icon: "${newIcon}"`);
    content = content.replace(new RegExp(`icon="${oldIcon}"`, 'g'), `icon="${newIcon}"`);
}

// Ensure Validation header text is aligned properly by adding items-center if missing (script replace)
content = content.replace(
    '<div className="flex flex-row text-text-secondary dark:text-text-secondary-dark">',
    '<div className="flex flex-row text-text-secondary dark:text-text-secondary-dark items-center">'
);

fs.writeFileSync(path, content, 'utf8');
console.log("Replaced all material-icons in SchemaEditorDemo.tsx");
