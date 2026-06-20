# 第五阶段切片 3：节点跨父级拖拽移动与排序设计

## 背景

现有拖拽只支持"分组框内部换位"：`handlePointerDown` 只在命中分组框 item 区域时才会开始一次拖拽（`reorder-group-child`，第二阶段已上线），普通（未折叠成分组框的）节点完全没有拖拽能力。让位预览动画（`buildVirtualOrder`/`childWorldRectsById`，定义在 `drag-transition.js`）是针对单个分组框的网格布局写的，只在起点分组框范围内生效。

本切片要让任意节点（普通节点、分组框内部节点）都能被拖到**另一个父节点下面**，变成它的子节点；如果落点的目标父节点跟起点父节点是同一个，则退化为现有的同父节点内排序。复用切片 1 的 operation/history 合同（`readonly`、before hooks、undo/redo、标准化 `change` payload）。

## 目标

- 任意真实节点（普通节点或分组框内部节点）都能被拖拽。
- 松手时命中的节点变成新父节点，被拖节点（及其整个子树）成为它的子节点，插入到其 `children` 末尾。
- 如果命中的目标父节点跟起点父节点是同一个真实节点（不管视觉上是否换了分组框/换了 segment），走现有的 `reorder-group-child`，插入到具体位置；这顺带让"未分组兄弟节点之间互相拖拽排序"也免费可用。
- 如果目标父节点变了，走新增的 `move-node` operation。
- 防止把节点拖到它自己或自己的后代下面（会成环）。
- 拖拽悬停在已经折叠成分组框的目标上时，复用现有让位动画精确预览插入位置；悬停在未分组的普通节点上时，只高亮该节点，插入到其 `children` 末尾，不做兄弟让位动画。
- 光标拖近画布边缘时自动平移视口。
- `readonly`、`beforeNodeMove`（跨父级）、`beforeGroupReorder`（同父节点内，含新增的未分组互拖场景）能拦截默认行为。
- 根节点可以被拖入别的节点下面（从 `rootIds` 移除，获得 `parentId`）；本切片不支持把节点拖出去变成新根。

## 范围

### 范围内

- `src/minimap/graph-operations.js`：
  - 新增 `move-node` 操作：`{ nodeId, toParentId, index }`，校验防环，inverse 复用"整图快照回滚"模式。
- `src/minimap/drag-transition.js`：
  - `buildVirtualOrder(group, childId, insertIndex)` 改为 `buildVirtualOrder(children, childId, insertIndex)`，直接接收子节点 id 数组而不是分组对象（向后兼容：调用方改成传 `group.children`）。
  - `childWorldRectsById(group, order)` 内部按 `order.length` 重新计算 `rows`（`Math.ceil(order.length / group.columns)`），而不是信任传入的 `group.rows`——避免虚拟插入的节点超出分组框原有网格容量时预览矩形缺失。对现有同分组重排序场景（`order.length` 跟原 `group.children.length` 相等）行为不变。
- `src/minimap/interaction.js`：
  - 新增纯函数，给定 hit-test 结果和当前拖拽节点，解析出"目标父节点 id + 是否为同父节点 + 目标分组（若有）+ 防环校验结果"。
- `src/minimap/Minimap.vue`：
  - `handlePointerDown` 扩展：命中普通节点（`hit.type==='node'`）时也能起拖拽，统一记录真实 `nodeId` + 真实 `fromParentId`。
  - `handlePointerMove`：拖拽中实时对整个画布 hit-test，更新当前悬停目标和让位/高亮状态；新增边缘自动平移检测与 RAF 循环。
  - `handlePointerUp`：根据目标父节点是否等于起点父节点，派发 `reorder-group-child`（复用现有，含未分组互拖新场景）或新的 `move-node`。
  - 新增 props：`beforeNodeMove`。
  - 新增 event：`node-move`（沿用 ROADMAP 组件契约里已经预先命名的事件/钩子）。
- 测试覆盖：`graph-operations` 层（`move-node` 的 mutation/undo/redo/防环/readonly/before/invalid）、`drag-transition`/`interaction` 纯函数层、`Minimap.vue` 集成层（普通节点拖拽变成子节点、未分组兄弟拖拽排序、跨分组拖拽、防环、`readonly`/`beforeNodeMove`/`beforeGroupReorder` 拦截、边缘自动平移）。

### 范围外

- 拖出节点变成新根。
- `options.drag.*` 细粒度配置（网格吸附、内容边界限制、是否允许跨父级移动等开关）——本切片默认允许，按需要再加开关。
- 未分组目标的精确兄弟让位动画（树布局重跑），只做高亮。
- 跨组件实例拖拽、外部系统拖拽源（如 OS 文件拖拽）。
- 触摸屏多指手势。

## 行为设计

### `move-node` 操作（`graph-operations.js`）

payload：`{ nodeId, toParentId, index }`。

校验顺序（均不抛异常，返回 `blockedResult`）：

1. `nodeId` 在 `graph.nodes` 中不存在 → `invalid`。
2. `toParentId` 在 `graph.nodes` 中不存在 → `invalid`。
3. `toParentId === nodeId`，或 `toParentId` 是 `nodeId` 的后代（沿 `children` 递归判断）→ `invalid`（防环）。

校验通过后：

1. 整图快照 `before = cloneGraphData(graph)`。
2. 从旧父节点（`graph.nodes.get(nodeId).parentId`，可能为 `null` 表示根节点）的 `children`（或 `graph.rootIds`，如果旧父节点是 `null`）中移除 `nodeId`。
3. 把 `nodeId` 插入到 `graph.nodes.get(toParentId).children` 的 `index`（clamp 到合法范围）位置。
4. 把 `graph.nodes.get(nodeId).parentId` 设为 `toParentId`。
5. 返回 `applied: true`，`inverse: { type: 'replace-graph', payload: { graph: before } }`，跟 `delete-nodes`/`paste-nodes` 一致的模式。

不会因为 `nodeId` 原本是根节点而需要特殊处理"变成新根"——本操作只处理"移入某个父节点下面"这一种方向。

### 拖拽派发规则

松手时，比较"目标父节点真实 id"和"起点父节点真实 id"（都是 `graph.nodes` 里的真实 id，不是分组框 id）：

- **相同**：走现有 `reorder-group-child`，`payload` 跟现在一样（`groupId` 字段仅用于 Vue 层事件 payload，真正起作用的是 `parentId`/`childId`/`index`）。这一分支同时覆盖"分组框内部换位"（已上线，行为不变）和"未分组兄弟节点之间拖拽排序"（新场景，免费复用现有 operation）。
- **不同**：走新的 `move-node`。

### 拖拽悬停目标解析

拖拽过程中每次 `pointermove` 都对整个画布做 `hitTest(layout, point)`：

- 命中 `{type:'group', zone:'item', id: groupId, childId}`：目标父节点 = 该分组的 `parentId`；目标分组 = 该分组对象；用现有的 `groupGridIndexAt`/`buildVirtualOrder`/`childWorldRectsById` 计算精确插入位置和让位预览（`buildVirtualOrder` 调用方传 `group.children`）。
- 命中 `{type:'node', id}`：目标父节点 = 该节点 id；目标分组 = 无；不做让位预览，只高亮该节点（视觉态，复用现有 `state.highlighted`/边框绘制风格，不新增主题字段）；插入位置固定为该节点 `children` 末尾。
- 命中分组框 header 区域，或没有命中任何东西：目标父节点 = 无效（清空高亮/让位预览，只显示跟随光标的 ghost）。

被拖节点自身（以及它的所有后代，如果当前命中目标恰好是它自己的后代）始终被排除在有效目标之外——`pointermove` 阶段就做防环判断，避免悬停时显示"可以放这里"的误导性高亮；`move-node` 操作自己也会在 `apply` 时再校验一次，双重保险。

### 边缘自动平移

拖拽中，如果光标（屏幕坐标）落在画布容器边缘 24px 范围内，按固定速度持续平移视口（复用 `panViewportBy`/`applyViewport`），通过 `requestAnimationFrame` 循环驱动，跟分组框内部的自动滚动（`groupAutoScrollSpeed`/`ensureAutoScrollLoop`）是两套独立机制，互不影响、可同时存在（比如悬停在分组框边缘的 item 上，同时光标又在画布边缘）。

### 防环规则

`toParentId` 不能是 `nodeId` 自己或 `nodeId` 的任意后代。校验方式：从 `toParentId` 沿 `parentId` 往上找祖先链，如果链上出现 `nodeId`，则判定为后代关系（跟方向反过来判断等价且更直接：从 `toParentId` 出发往根方向走，看是否经过 `nodeId`）。

## Vue 集成

### Props

新增：

```js
beforeNodeMove: { type: Function, default: null }
```

`beforeGroupReorder` 保留，覆盖范围扩大到"任意同父节点内的拖拽排序"（不只是分组框内部）。

### Events

新增：

```js
'node-move'
```

payload：`{ nodeId, fromParentId, toParentId, index }`。

`group-reorder` 事件保留，覆盖范围同样扩大到未分组兄弟互拖的场景，payload 形状不变。

### Methods

不新增 expose 方法——拖拽移动跟现有的 `drop-node`/`reorder-group-child` 一样，纯粹由指针事件驱动，不提供单独的命令式 API。

## 错误处理

- `readonly` 为真：拦截 `move-node` 和 `reorder-group-child`，跟现有约定一致，`reason: 'readonly'`。
- `beforeNodeMove`/`beforeGroupReorder` 返回 `false`：拦截对应操作，`reason: 'blocked'`。
- 防环：`reason: 'invalid'`，不抛异常。
- 这些失败都不会触发 `change`，也不会更新布局。

## 测试策略

### Operation 层（`graph-operations.test.js`）

- `move-node` 把节点从旧父节点 `children` 移除、插入新父节点 `children` 指定位置、更新 `parentId`，根节点（旧 `parentId` 为 `null`）能正确从 `rootIds` 移除。
- undo/redo 还原。
- 防环：目标是自己、目标是自己的直接/间接后代，均返回 `invalid`，graph 不变。
- `readonly`/before hook 阻止。
- `toParentId`/`nodeId` 不存在返回 `invalid`。

### 纯函数层（`drag-transition`/`interaction`）

- `buildVirtualOrder` 新签名（接收数组）对现有同分组场景结果不变。
- `childWorldRectsById` 对一个"超出原有网格容量"的虚拟插入场景，能正确生成包含新增项的 rect（验证 `rows` 重算逻辑）。
- 新增的目标解析纯函数：给定不同 hit-test 结果，正确解析出目标父节点/是否同父节点/防环结果。

### Vue 集成层（`minimap-shell.test.js` 或新增 focused 测试文件）

- 拖拽一个未分组的普通节点到另一个普通节点上 → 变成其子节点，插入到 `children` 末尾，emit `node-move`/`change`，可撤销。
- 拖拽一个分组框内部节点到另一个（不同父节点的）分组框上 → 变成新分组所属父节点的子节点，emit `node-move`，原分组和新分组的 `children` 都正确更新。
- 拖拽两个未分组的兄弟节点互相排序（同父节点）→ 走 `reorder-group-child`，emit `group-reorder`，真实顺序变化。
- 把节点拖到自己的后代上 → 不生效，graph 不变，没有 `change`。
- `readonly`/`beforeNodeMove`/`beforeGroupReorder` 阻止对应拖拽。
- 拖拽中光标靠近画布边缘 → 视口按固定速度平移（断言 `viewport-change` 事件或 `getViewport()` 变化）。

## 验收标准

- 普通节点、分组框内部节点都能被拖到另一个父节点下面，结果写回 `parentId` 和双方 `children`。
- 同父节点内的拖拽排序（不论是否分组框）继续可用，真实顺序变化。
- 防止把节点拖到自己或自己后代下面。
- `readonly`、`beforeNodeMove`、`beforeGroupReorder` 能拦截默认行为。
- 跨父级移动和同父节点排序都可撤销/重做。
- 拖拽悬停在分组框 item 上有精确插入位置预览，悬停在普通节点上有高亮反馈。
- 光标靠近画布边缘时视口自动平移。
- 完整 `npm test` 和 `npm run build` 通过。
