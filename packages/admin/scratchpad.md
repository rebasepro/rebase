Let's analyze dnd-kit multiple containers pattern.

handleDragOver:
If active.id !== over.id, and they are in different containers.
Find the active container and over container.
If different containers:
Move active from active container to over container at the correct index (using over.rect, etc).
Update itemMapState.

handleDragEnd:
Find active container and over container.
If they are the SAME container (which they will be if handleDragOver moved them! Wait, NO. dnd-kit `active` remembers the original container? No, if we mutated itemMapState, the DOM updated, so `dnd-kit`'s SortableContext updated. So they are in the same container now).
Actually, the standard `dnd-kit` pattern uses `activeContainer` and `overContainer` derived from `active.id` and `over.id`.
Wait, in `Board.tsx`, `handleDragOver` already moves the item.
So in `handleDragEnd`, we just need to do the final reorder if `activeIndex !== overIndex`.
