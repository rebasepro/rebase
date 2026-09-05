import React from "react";
import {
    Menubar,
    MenubarMenu,
    MenubarTrigger,
    MenubarPortal,
    MenubarContent,
    MenubarCheckboxItem,
    MenubarRadioGroup,
    MenubarRadioItem,
    MenubarItemIndicator,
    MenubarSeparator
} from "@rebasepro/ui";

function useOpenMenu(ref: React.RefObject<HTMLDivElement | null>, triggerIndex: number) {
    React.useEffect(() => {
        const trigger = ref.current?.querySelectorAll('button[aria-haspopup="menu"]')[triggerIndex] as HTMLElement | undefined;
        trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    }, [ref, triggerIndex]);
}

// The check mark rendered by a checked checkbox item.
export const OnCheckboxItem = () => {
    const ref = React.useRef<HTMLDivElement>(null);
    useOpenMenu(ref, 0);
    return (
        <div ref={ref} className="p-4 h-[220px]">
            <Menubar>
                <MenubarMenu>
                    <MenubarTrigger>View</MenubarTrigger>
                    <MenubarPortal>
                        <MenubarContent>
                            <MenubarCheckboxItem checked onCheckedChange={() => {}}>
                                <MenubarItemIndicator/>
                                Table editor
                            </MenubarCheckboxItem>
                            <MenubarCheckboxItem checked={false} onCheckedChange={() => {}}>
                                <MenubarItemIndicator/>
                                Query logs
                            </MenubarCheckboxItem>
                        </MenubarContent>
                    </MenubarPortal>
                </MenubarMenu>
            </Menubar>
        </div>
    );
};

// The same indicator on a selected radio item.
export const OnRadioItem = () => {
    const ref = React.useRef<HTMLDivElement>(null);
    useOpenMenu(ref, 0);
    return (
        <div ref={ref} className="p-4 h-[260px]">
            <Menubar>
                <MenubarMenu>
                    <MenubarTrigger>View</MenubarTrigger>
                    <MenubarPortal>
                        <MenubarContent>
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
            </Menubar>
        </div>
    );
};
