const fs = require('fs');
const file = 'packages/admin/src/components/EntityCollectionView/Board.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
`                const activeSortableIndex = active.data.current?.sortable?.index;
                const overSortableIndex = over.data.current?.sortable?.index;

                const activeIndex = typeof activeSortableIndex === 'number' 
                    ? activeSortableIndex 
                    : finalItemMapState[currentColumn].findIndex(i => i.id === activeId);
                    
                const overIndex = typeof overSortableIndex === 'number'
                    ? overSortableIndex
                    : finalItemMapState[overColumn].findIndex(i => i.id === overId);`,
`                const activeIndex = finalItemMapState[currentColumn].findIndex(i => i.id === activeId);
                
                let overIndex = finalItemMapState[overColumn].findIndex(i => i.id === overId);
                if (overIndex === -1 && over.data.current?.type === "COLUMN") {
                    overIndex = finalItemMapState[overColumn].length;
                } else if (overIndex === -1 && typeof over.data.current?.sortable?.index === 'number') {
                    overIndex = over.data.current.sortable.index;
                }`
);

fs.writeFileSync(file, code);
