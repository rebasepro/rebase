export function getSidePanelDefaultWidthPercentage(key: "chat_history" | "dashboard_history" | "dashboard_chat" | "dashboard_theme") {
    switch (key) {
        case "chat_history":
            return 30;
        case "dashboard_history":
            return 30;
        case "dashboard_chat":
            return 50;
        case "dashboard_theme":
            return 25;
    }
}

export function saveSidePanelWidth(key: "chat_history" | "dashboard_history" | "dashboard_chat" | "dashboard_theme", width: number) {
    if (width <= 0) {
        return;
    }
    localStorage.setItem(`side_panel_${key}`, JSON.stringify(width));
}

export function getSidePanelWidth(key: "chat_history" | "dashboard_history" | "dashboard_chat" | "dashboard_theme") {
    const width = localStorage.getItem(`side_panel_${key}`);
    if (width) {
        const res = JSON.parse(width) as number;
        if (res > 0) {
            return res;
        }
    }
    return getSidePanelDefaultWidthPercentage(key);
}
