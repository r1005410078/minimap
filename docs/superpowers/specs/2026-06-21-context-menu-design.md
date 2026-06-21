# 第五阶段：右键菜单设计

## 背景

第五阶段已经具备编辑操作底座、删除、复制、粘贴、导入导出、跨父级拖拽移动和兄弟排序能力。现在需要为常用操作提供一个右键菜单入口，让用户不必只依赖顶部工具栏、键盘快捷键或外部按钮。

右键菜单定位为组件内建能力，但必须保留业务扩展空间。第一版采用“内建默认菜单 + 可覆盖 items”的方案：组件默认提供常用节点操作和画布操作，业务方可以通过 `contextMenuItems` 追加、隐藏、替换或禁用菜单项。

## 目标

- 右键普通节点时显示节点菜单，并包含通用画布菜单项。
- 右键分组框时复用节点上下文，目标解释为分组对应的 `parentId`。
- 右键空白画布时只显示通用画布菜单项。
- 默认菜单覆盖当前已有的高频编辑和视图操作。
- 配置项不在组件内部私自改状态，而是发出受控事件，由外部更新 props / options / theme。
- 外部可以通过 `contextMenuItems` 定制菜单内容。
- 第一版不做多级子菜单、不做重命名、不做新增节点 mutation。

## 范围

### 范围内

- 新增右键菜单打开、定位、关闭逻辑。
- 根据命中目标生成默认菜单：
  - 普通节点；
  - 分组框；
  - 空白画布。
- 支持默认菜单项：
  - 添加子节点（禁用）；
  - 添加兄弟节点（禁用）；
  - 复制；
  - 粘贴到此节点下；
  - 删除；
  - 居中到此节点；
  - 展开/折叠子分组；
  - 粘贴；
  - 适配视图；
  - 居中选中；
  - 显示搜索；
  - 显示网格；
  - 显示性能信息；
  - 编辑/只读切换。
- 新增 `contextMenuItems` prop，用于覆盖默认菜单。
- 新增 `context-menu-action` 事件，用于通知菜单动作。
- 新增 `config-change` 事件，用于通知显示配置切换。
- 内建动作复用现有 methods / operation：
  - `copySelection()`；
  - `paste()`；
  - `deleteSelection()`；
  - `fitToScreen()`；
  - `centerOnSelection()`；
  - `centerOnNode(id)`；
  - 分组展开/折叠继续走 `group-state-change`。

### 范围外

- 多级子菜单。
- 重命名。
- 添加子节点 / 添加兄弟节点的真实创建逻辑。
- 连线右键菜单。
- 文件导入导出菜单项。
- 系统剪贴板集成。
- 全局浏览器菜单完全替代策略之外的高级配置。
- 菜单搜索、图标库、复杂快捷键提示。

## 默认菜单

### 节点右键菜单

节点菜单由“节点操作”和“通用画布操作”组成。

节点操作：

- 添加子节点：保留入口，第一版禁用；
- 添加兄弟节点：保留入口，第一版禁用；
- 复制；
- 粘贴到此节点下；
- 删除；
- 居中到此节点；
- 展开/折叠子分组。

通用画布操作：

- 粘贴；
- 适配视图；
- 居中选中；
- 显示搜索；
- 显示网格；
- 显示性能信息；
- 编辑/只读切换。

如果右键节点已经在当前多选集合中，`复制` 和 `删除` 操作作用于当前 selection；如果右键节点不在当前 selection 中，则先以该节点作为动作目标执行。

`粘贴到此节点下` 使用右键节点作为目标父节点。`粘贴` 沿用已有 paste 默认规则，即粘贴到当前选中节点下。

### 分组右键菜单

分组框右键时复用节点菜单。

上下文目标解释为分组对应的 `parentId`：

- `粘贴到此节点下` 粘贴到分组父节点下；
- `居中到此节点` 居中到分组父节点；
- `展开/折叠子分组` 切换当前分组状态；
- `复制` / `删除` 如果当前 selection 包含该分组或分组内节点，则作用于 selection；否则作用于该分组包含的可见子节点集合。

### 空白画布菜单

空白画布只显示通用画布操作：

- 粘贴；
- 适配视图；
- 居中选中；
- 显示搜索；
- 显示网格；
- 显示性能信息；
- 编辑/只读切换。

## 菜单项数据结构

菜单项使用结构化对象描述，方便内部默认菜单和外部覆盖共享同一格式。

```js
{
  id: 'copy',
  label: '复制',
  type: 'item', // 'item' | 'separator' | 'checkbox'
  visible: true,
  disabled: false,
  checked: false,
  danger: false,
  action: 'copy',
}
```

字段说明：

- `id`：稳定菜单项 id。
- `label`：展示文案。
- `type`：菜单项类型。第一版只支持普通项、分隔线和 checkbox 项。
- `visible`：是否显示。默认 `true`。
- `disabled`：是否禁用。默认 `false`。
- `checked`：checkbox 菜单项是否选中。
- `danger`：危险操作样式，例如删除。
- `action`：点击后触发的动作标识。内建动作由组件处理，外部动作通过事件交给业务方。

第一版不支持 `children` 子菜单。后续需要多级菜单时，可以在同一结构上扩展 `children`，不改变已有 item 字段。

## `contextMenuItems` API

新增 prop：

```js
contextMenuItems: {
  type: [Array, Function],
  default: null,
}
```

当传入数组时，数组结果直接参与菜单合成。数组中的 item 可以追加到默认菜单后，也可以通过相同 `id` 覆盖默认菜单项。

当传入函数时，组件调用：

```js
contextMenuItems(context, defaults)
```

`context` 包含：

```js
{
  targetType: 'node' | 'group' | 'canvas',
  targetId,
  groupId,
  screenPoint,
  worldPoint,
  selectedIds,
  readonly,
  canPaste,
  canUndo,
  canRedo,
  options,
}
```

`defaults` 是组件根据当前上下文生成的默认菜单项数组。函数返回最终菜单项数组。

示例：

```js
contextMenuItems(context, defaults) {
  return defaults
    .filter((item) => item.id !== 'toggle-performance')
    .concat({
      id: 'inspect-node',
      label: '查看详情',
      visible: context.targetType === 'node',
      disabled: false,
      action: 'inspect-node',
    })
}
```

如果外部自定义 item 的 `action` 不是内建动作，组件不执行默认行为，只触发 `context-menu-action`。

## 事件

### `context-menu-action`

所有菜单点击都会触发：

```js
{
  action,
  item,
  context,
}
```

内建动作触发事件后，组件继续执行默认行为。外部动作只触发事件，不修改组件状态。

### `config-change`

配置类菜单项不直接改内部状态，而是触发：

```js
{
  key: 'enableSearch',
  value: false,
  source: 'context-menu',
  context,
}
```

默认配置映射：

- `显示搜索` -> `options.enableSearch`；
- `显示网格` -> `options.showGrid`；
- `显示性能信息` -> `options.showPerformance`；
- `编辑/只读切换` -> `readonly`。

外部收到事件后更新对应 prop，再传回组件。组件内部只负责根据当前 props 计算 checked 状态。

## 禁用态规则

- `添加子节点` / `添加兄弟节点`：第一版始终禁用。
- `复制`：没有目标且 selection 为空时禁用。
- `粘贴到此节点下`：无内部 clipboard 或目标不是节点/分组时禁用；`readonly` 时禁用。
- `删除`：没有目标且 selection 为空时禁用；`readonly` 时禁用。
- `粘贴`：无内部 clipboard 时禁用；`readonly` 时禁用。
- `居中选中`：selection 为空时禁用。
- `展开/折叠子分组`：目标没有可切换分组状态时禁用。
- `编辑/只读切换`：是否允许切换由外部决定；默认可点击并通过 `config-change` 通知外部。

## 交互细节

- 使用浏览器原生 `contextmenu` 事件打开菜单，并阻止默认浏览器菜单。
- 菜单位置使用屏幕坐标，并在容器边界内自动翻转，避免超出视口。
- 点击菜单外、按 `Esc`、滚轮缩放、开始拖拽、切换 graph 或组件失焦时关闭菜单。
- 打开菜单不改变 selection；点击菜单项后根据动作需要决定是否以右键目标作为操作目标。
- 菜单 DOM 只渲染当前打开的一份，不为每个节点创建 DOM。
- 菜单应可通过键盘关闭。第一版不要求完整方向键菜单导航，但不应破坏画布已有键盘快捷键。

## 测试

需要覆盖：

- 右键普通节点显示节点菜单和通用画布菜单。
- 右键空白画布只显示通用画布菜单。
- 右键分组框生成 group 上下文。
- 禁用项状态正确，尤其是新增节点、readonly、无 clipboard、无 selection。
- 点击复制、删除、粘贴、视图定位会调用已有方法或触发对应事件。
- 点击配置项触发 `config-change`，不直接修改 props。
- `contextMenuItems` 函数可以隐藏默认项并追加自定义项。
- 自定义 action 只触发 `context-menu-action`，不执行内建 mutation。
- 菜单打开后点击外部或按 `Esc` 会关闭。

## 迁移和兼容

`contextMenuItems` 默认为 `null`，不影响现有调用方。右键菜单是新增交互入口，不改变已有 toolbar、键盘快捷键、资源树拖入和公开 methods 的行为。

配置项采用事件通知，避免把 `options`、`readonly` 或 theme 的真实状态藏在组件内部。已有调用方如果不监听 `config-change`，点击配置项只会发出事件，不会造成不可预期状态变化。
