export function mergeMessages(previous,incoming){const rows=new Map(previous.map(row=>[row.id,row]));for(const row of incoming)rows.set(row.id,row);return [...rows.values()].sort((a,b)=>a.seq-b.seq);}
// Retain mounted message nodes, including playing GIFs and focused controls.
export function reconcileChildren(parent,desired){const keep=new Set(desired);for(const node of [...parent.children])if(!keep.has(node))node.remove();let cursor=parent.firstElementChild;for(const node of desired){if(node===cursor)cursor=cursor.nextElementSibling;else parent.insertBefore(node,cursor);}}
