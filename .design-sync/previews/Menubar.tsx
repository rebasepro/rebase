import React from "react";
import {
    Menubar,
    MenubarMenu,
    MenubarTrigger,
    MenubarPortal,
    MenubarContent,
    MenubarItem,
    MenubarSeparator,
    MenubarShortcut,
    MenubarSub,
    MenubarSubTrigger,
    MenubarSubContent,
    MenubarSubTriggerIndicator,
    MenubarCheckboxItem,
    MenubarItemIndicator,
    MenubarRadioGroup,
    MenubarRadioItem
} from "@rebasepro/ui";

// Top-level menus open declaratively: `defaultValue` on Menubar naming a
// `value` on one MenubarMenu. (Before this was fixed, the wrapper forwarded
// no rest props and no prop could open a menu at all — the preview had to
// dispatch a synthetic pointerdown.)
//
// Submenus still need a real click on the SubTrigger, fired a tick after the
// parent MenubarContent has mounted: MenubarSub's `defaultOpen` raced the
// capture, screenshotting before the SubContent's Popper position resolved.
function useOpenSubmenu(enabled?: boolean) {
    React.useEffect(() => {
        if (!enabled) return;
        const t = setTimeout(() => {
            const subTrigger = document.querySelector('[data-radix-menubar-subtrigger]') as HTMLElement | null;
            subTrigger?.click();
        }, 60);
        return () => clearTimeout(t);
    }, [enabled]);
}

// A believable admin-console menu bar: File / Edit / View / Help over
// tables, SQL queries and RLS policies.
export const Closed = () => (
    <div className="p-4">
        <Menubar>
            <MenubarMenu>
                <MenubarTrigger>File</MenubarTrigger>
            </MenubarMenu>
            <MenubarMenu>
                <MenubarTrigger>Edit</MenubarTrigger>
            </MenubarMenu>
            <MenubarMenu>
                <MenubarTrigger>View</MenubarTrigger>
            </MenubarMenu>
            <MenubarMenu>
                <MenubarTrigger>Help</MenubarTrigger>
            </MenubarMenu>
        </Menubar>
    </div>
);

export const FileMenuOpen = () => {
    useOpenSubmenu(true);
    return (
        <div className="p-4 h-[400px]">
            <Menubar defaultValue="file">
                <MenubarMenu value="file">
                    <MenubarTrigger>File</MenubarTrigger>
                    <MenubarPortal>
                        <MenubarContent>
                            <MenubarItem>New table<MenubarShortcut>⌘N</MenubarShortcut></MenubarItem>
                            <MenubarItem>New SQL query<MenubarShortcut>⌘⇧N</MenubarShortcut></MenubarItem>
                            <MenubarItem>Save<MenubarShortcut>⌘S</MenubarShortcut></MenubarItem>
                            <MenubarSeparator/>
                            <MenubarSub>
                                <MenubarSubTrigger>
                                    Export
                                    <MenubarSubTriggerIndicator/>
                                </MenubarSubTrigger>
                                <MenubarPortal>
                                    <MenubarSubContent>
                                        <MenubarItem>Export as SQL</MenubarItem>
                                        <MenubarItem>Export as CSV</MenubarItem>
                                    </MenubarSubContent>
                                </MenubarPortal>
                            </MenubarSub>
                            <MenubarSeparator/>
                            <MenubarItem disabled>Close project</MenubarItem>
                        </MenubarContent>
                    </MenubarPortal>
                </MenubarMenu>
                <MenubarMenu>
                    <MenubarTrigger>Edit</MenubarTrigger>
                </MenubarMenu>
                <MenubarMenu>
                    <MenubarTrigger>View</MenubarTrigger>
                </MenubarMenu>
                <MenubarMenu>
                    <MenubarTrigger>Help</MenubarTrigger>
                </MenubarMenu>
            </Menubar>
        </div>
    );
};

export const ViewMenuOpen = () => (
    <>
        <div className="p-4 h-[360px]">
            <Menubar defaultValue="view">
                <MenubarMenu value="file">
                    <MenubarTrigger>File</MenubarTrigger>
                </MenubarMenu>
                <MenubarMenu value="edit">
                    <MenubarTrigger>Edit</MenubarTrigger>
                </MenubarMenu>
                <MenubarMenu value="view">
                    <MenubarTrigger>View</MenubarTrigger>
                    <MenubarPortal>
                        <MenubarContent>
                            <MenubarCheckboxItem checked onCheckedChange={() => {}}>
                                <MenubarItemIndicator/>
                                Table editor
                            </MenubarCheckboxItem>
                            <MenubarCheckboxItem checked onCheckedChange={() => {}}>
                                <MenubarItemIndicator/>
                                SQL console
                            </MenubarCheckboxItem>
                            <MenubarCheckboxItem checked={false} onCheckedChange={() => {}}>
                                <MenubarItemIndicator/>
                                Query logs
                            </MenubarCheckboxItem>
                            <MenubarSeparator/>
                            <MenubarRadioGroup value="dark">
                                <MenubarRadioItem value="light">
                                    <MenubarItemIndicator/>
                                    Light
                                </MenubarRadioItem>
                                <MenubarRadioItem value="dark">
                                    <MenubarItemIndicator/>
                                    Dark
                                </MenubarRadioItem>
                                <MenubarRadioItem value="system">
                                    <MenubarItemIndicator/>
                                    System
                                </MenubarRadioItem>
                            </MenubarRadioGroup>
                        </MenubarContent>
                    </MenubarPortal>
                </MenubarMenu>
                <MenubarMenu value="help">
                    <MenubarTrigger>Help</MenubarTrigger>
                </MenubarMenu>
            </Menubar>
        </div>
    </>
);
