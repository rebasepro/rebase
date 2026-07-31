import React from "react";
import {
    Menubar,
    MenubarMenu,
    MenubarTrigger,
    MenubarPortal,
    MenubarContent,
    MenubarItem,
    MenubarSeparator,
    MenubarShortcut
} from "@rebasepro/ui";

function useOpenMenu(ref: React.RefObject<HTMLDivElement>, triggerIndex: number) {
    React.useEffect(() => {
        const trigger = ref.current?.querySelectorAll('button[aria-haspopup="menu"]')[triggerIndex] as HTMLElement | undefined;
        trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    }, [ref, triggerIndex]);
}

// MenubarPortal has no visual identity of its own — it just moves its
// MenubarContent child to the portal container (or document body) so it
// escapes any clipping ancestor. The only honest way to show it is the
// content it carries, rendered open.
export const Basic = () => {
    const ref = React.useRef<HTMLDivElement>(null);
    useOpenMenu(ref, 0);
    return (
        <div ref={ref} className="p-4 h-[280px]">
            <Menubar>
                <MenubarMenu>
                    <MenubarTrigger>File</MenubarTrigger>
                    <MenubarPortal>
                        <MenubarContent>
                            <MenubarItem>New table<MenubarShortcut>⌘N</MenubarShortcut></MenubarItem>
                            <MenubarItem>New SQL query<MenubarShortcut>⌘⇧N</MenubarShortcut></MenubarItem>
                            <MenubarItem>Save<MenubarShortcut>⌘S</MenubarShortcut></MenubarItem>
                            <MenubarSeparator/>
                            <MenubarItem disabled>Close project</MenubarItem>
                        </MenubarContent>
                    </MenubarPortal>
                </MenubarMenu>
                <MenubarMenu>
                    <MenubarTrigger>Edit</MenubarTrigger>
                </MenubarMenu>
            </Menubar>
        </div>
    );
};
