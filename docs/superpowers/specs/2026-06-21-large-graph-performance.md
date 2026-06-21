# 大图交互性能优化设计

## 背景

当前 minimap 已经具备布局、渲染、搜索、选择、拖拽编辑和右键菜单能力。用户反馈在节点数量很多、画布缩得很小时，移动画布和框选明显卡顿。

这类卡顿通常来自三类成本叠加：

- 高频 `pointermove` 直接触发多次完整渲染；
- 缩小时仍然绘制文字、分组子项、连线等细节；
- 命中检测和框选仍按全量可见项扫描。

同时 `Minimap.vue` 已经超过 2000 行，性能优化不能继续把调度、质量策略、空间索引和缓存逻辑直接塞进组件文件。

## 目标

- 平移和框选拖动时，同一动画帧内最多触发一次主画布渲染。
- 缩放很小时自动降级绘制细节，减少不必要的文字和子项渲染。
- 框选和命中检测为后续大图空间索引预留清晰边界。
- 后续静态层缓存可以独立接入，不改动业务交互语义。
- `Minimap.vue` 只负责组装状态、绑定 DOM 事件和调用模块能力。

## 非目标

- 不引入第三方渲染库。
- 不重写布局算法。
- 不改变节点拖拽、框选、多选、搜索和右键菜单语义。
- 第一轮不做复杂瓦片缓存或 Worker 化。
- 第一轮不改变 graph 数据结构。

## 架构拆分

### `render-scheduler.js`

负责合帧渲染。

输入是一组回调：

- `render()`：执行当前状态下的真实渲染；
- 可选 `requestFrame` / `cancelFrame`：测试中可注入。

导出能力：

- `schedule(reason)`：请求下一帧渲染；同一帧多次调用只排一个 RAF；
- `flush()`：测试或关键路径立即执行等待中的渲染；
- `cancel()`：销毁组件时取消未执行帧；
- `isScheduled()`：测试状态。

第一轮中，`Minimap.vue` 的下列高频路径不再直接调用 `renderCurrent()`：

- 空白画布平移；
- 框选拖动。

滚动条拖动、hover scrollbar、普通节点拖拽移动仍保持即时渲染，避免影响现有细粒度反馈和拖拽预览测试；后续如果要继续优化，需要单独设计拖拽预览的动态层或缓存策略。

非高频路径仍可立即渲染：

- 初始化；
- layout 更新完成；
- graph 替换；
- 搜索跳转；
- 删除、粘贴、导入等 mutation 结束。

### `render-quality.js`

负责渲染质量策略。

输入：

```js
{
  scale,
  interacting,
}
```

输出：

```js
{
  level: 'full' | 'compact' | 'overview',
  showText,
  showGroupChildren,
  simplifyEdges,
  simplifyChrome,
}
```

默认策略：

- `scale >= 0.45` 且不在高频交互中：`full`；
- `0.18 <= scale < 0.45` 或正在平移/框选：`compact`；
- `scale < 0.18`：`overview`。

`compact` 隐藏普通节点文字，保留节点块、分组外框和关键连线。

`overview` 只画节点块和分组块，跳过文字、分组子项文字和昂贵装饰。

### `spatial-index.js`

负责空间索引。第一轮只设计接口，第二轮接入。

导出能力：

- `buildSpatialIndex(layout)`；
- `queryPoint(index, point)`；
- `queryRect(index, rect)`；
- `queryViewport(index, viewportRect)`。

第一版实现可以使用固定大小 bucket，避免引入依赖。索引在 layout 完成后构建，layout 变化、group scroll 变化、group expand/collapse 时失效重建。

### `render-cache.js`

负责静态层缓存。第一轮只保留设计，不立即实现。

缓存层拆分：

- `static`：背景、边、节点和分组基础形态；
- `dynamic`：选区、框选矩形、hover、拖拽预览、性能信息。

失效规则：

- graph/layout/theme/quality 改变：重建静态层；
- selection/hover/marquee/drag 改变：只重绘动态层；
- viewport 平移但 scale 不变：复用静态层偏移绘制；
- viewport scale 改变：重建静态层。

## 渲染降级细节

`renderScene(ctx, scene)` 接收新增 `quality`。

默认值为 `full`，保持现有行为兼容。

Renderer 需要按质量档位处理：

- `showText: false` 时，普通节点不调用 `fillText`；
- `showGroupChildren: false` 时，分组内部子项不逐个绘制，只画分组框和计数；
- `simplifyEdges: true` 时，连线可以保留但跳过箭头或复杂高亮；
- `simplifyChrome: true` 时，跳过阴影、部分描边和滚动条 hover 细节。

第一轮实现 `showText` 和 `showGroupChildren`，因为这两个收益最大且风险较低。

## 交互调度细节

`Minimap.vue` 增加本地 scheduler。

高频事件改造规则：

- 更新状态后调用 `scheduleRender('pan')`、`scheduleRender('marquee')` 等；
- 不在每次 pointermove 内直接 `renderCurrent()`；
- `handlePointerUp` 需要 `flushScheduledRender()`，保证最终状态立即落屏；
- `onUnmounted` 调用 `cancelScheduledRender()`。

## 验收标准

- 大图缩小时平移不再随着 pointermove 次数同步重绘。
- 框选拖动时一帧最多一次渲染。
- 缩小到 `scale < 0.45` 后，节点文字绘制次数显著下降。
- 缩小到 `scale < 0.18` 后，分组子项细节不再逐项绘制。
- 原有选择、搜索、拖拽、右键菜单测试继续通过。

## 测试策略

- `render-scheduler.test.js`：验证合帧、flush、cancel。
- `render-quality.test.js`：验证 scale 与交互状态映射。
- `renderer.test.js`：验证不同 quality 下是否跳过文字和分组子项绘制。
- `minimap-shell.test.js`：验证 pan/marquee 高频移动合帧，pointerup flush 最终帧。

## 分阶段落地

1. 切片 1：合帧渲染调度。
2. 切片 2：缩放降级渲染。
3. 切片 3：空间索引接入 hitTest / selection rect。
4. 切片 4：静态层缓存。

第一轮优先实现切片 1 和切片 2，其中合帧只覆盖空白画布平移与框选拖动。切片 3 和切片 4 保留独立文档与计划，节点拖拽合帧也留到后续动态层/缓存设计中处理，避免一次性引入过多缓存失效复杂度。
