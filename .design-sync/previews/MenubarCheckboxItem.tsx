import React from "react";
import {
    Menubar,
    MenubarMenu,
    MenubarTrigger,
    MenubarPortal,
    MenubarContent,
    MenubarCheckboxItem,
    MenubarItemIndicator,
    MenubarSeparator
} from "@rebasepro/ui";

function useOpenMenu(ref: React.RefObject<HTMLDivElement>, triggerIndex: number) {
    React.useEffect(() => {
        const trigger = ref.current?.querySelectorAll('button[aria-haspopup="menu"]')[triggerIndex] as HTMLElement | undefined;
        trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    }, [ref, triggerIndex]);
}

// A "View" menu toggling which panels are visible — the natural home for
// checkbox items in an admin console menu bar.
export const Basic = () => {
    const ref = React.useRef<HTMLDivElement>(null);
    useOpenMenu(ref, 1);
    return (
        <div ref={ref} className="p-4 h-[280px]">
            <Menubar>
                <MenubarMenu>
                    <MenubarTrigger>File</MenubarTrigger>
                </MenubarMenu>
                <MenubarMenu>
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
                            <MenubarSeparator/>
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
