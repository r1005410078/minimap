<template>
  <div class="minimap">
    <ResourceTree
      v-if="!effectiveOptions.previewMode && !resourceTreeCollapsed"
      class="minimap-resources"
      :resources="resources"
      :used-resource-ids="resolveUsedResourceIds()"
      @collapse="resourceTreeCollapsed = true"
    />
    <div ref="containerRef" class="minimap-canvas-container">
      <canvas
        ref="canvasRef"
        :class="{ 'is-active-border-enabled': effectiveOptions.enableActiveBorder === true }"
        tabindex="0"
      ></canvas>
      <button
        v-if="!effectiveOptions.previewMode && resourceTreeCollapsed"
        class="minimap-resource-restore"
        type="button"
        aria-label="展开资源树"
        title="展开资源树"
        @click="resourceTreeCollapsed = false"
      >
        <svg class="minimap-resource-restore-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 2.5h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
          <path d="M6 2.5v11M7.5 5.5 10 8l-2.5 2.5" />
        </svg>
      </button>
      <div v-if="effectiveOptions.enableSearch !== false" class="minimap-search">
        <input
          :value="searchKeyword"
          class="minimap-search-input"
          placeholder="搜索节点..."
          @input="controller.search($event.target.value)"
          @keydown.enter="controller.searchNext"
        />
        <span class="minimap-search-count">{{ searchMatches.length ? `${searchCurrentIndex + 1}/${searchMatches.length}` : '0/0' }}</span>
        <button
          class="minimap-search-btn minimap-search-prev"
          :disabled="searchMatches.length === 0"
          @click="controller.searchPrevious"
        >
          ‹
        </button>
        <button
          class="minimap-search-btn minimap-search-next"
          :disabled="searchMatches.length === 0"
          @click="controller.searchNext"
        >
          ›
        </button>
      </div>
      <div class="minimap-canvas-footer-left">
        <div v-if="!effectiveOptions.previewMode && effectiveOptions.showPerformance" class="minimap-performance">
          <span class="minimap-performance-label">性能</span>
          <span class="minimap-performance-value">{{ renderStats ? `${renderStats.nodeCount} 总节点` : '0 总节点' }}</span>
          <span class="minimap-performance-value">{{ renderStats ? `${renderStats.drawn}/${renderStats.total} 可见项` : '0/0 可见项' }}</span>
          <span class="minimap-performance-value">{{ renderStats ? `${renderStats.culled} culled` : '0 culled' }}</span>
          <span class="minimap-performance-value">{{ renderStats ? `${renderStats.durationMs.toFixed(1)}ms` : '0.0ms' }}</span>
        </div>
        <div class="minimap-bottom-controls" aria-label="缩放与历史">
          <div class="minimap-control-pod minimap-zoom-pod">
            <button
              class="minimap-control-button"
              type="button"
              aria-label="缩小"
              :disabled="zoomOutDisabled"
              @click="handleZoomOut"
            >
              −
            </button>
            <button
              class="minimap-control-button minimap-zoom-label"
              type="button"
              aria-label="重置缩放为 100%"
              aria-live="polite"
              @click="handleZoomReset"
            >
              {{ viewportScaleLabel }}
            </button>
            <button
              class="minimap-control-button"
              type="button"
              aria-label="放大"
              :disabled="zoomInDisabled"
              @click="handleZoomIn"
            >
              +
            </button>
          </div>
          <div v-if="!effectiveOptions.previewMode" class="minimap-control-pod minimap-history-pod">
            <button
              class="minimap-control-button"
              type="button"
              aria-label="撤销"
              :disabled="!historyCanUndo"
              @click="handleUndo"
            >
              <svg class="minimap-control-icon" viewBox="0 0 16 16" aria-hidden="true">
                <polyline
                  points="6 9 4 7 6 5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.35"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M4 7h7.5a2.5 2.5 0 0 1 0 5H9"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.35"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <button
              class="minimap-control-button"
              type="button"
              aria-label="重做"
              :disabled="!historyCanRedo"
              @click="handleRedo"
            >
              <svg class="minimap-control-icon" viewBox="0 0 16 16" aria-hidden="true">
                <polyline
                  points="10 9 12 7 10 5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.35"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M12 7H4.5a2.5 2.5 0 0 0 0 5H7"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.35"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div v-if="!effectiveOptions.previewMode && effectiveOptions.enableOverview !== false" class="minimap-overview-panel">
        <div class="minimap-overview-header">
          <span>MINIMAP</span>
          <span>拖入放置</span>
        </div>
        <Overview
          ref="overviewRef"
          class="minimap-overview"
          @navigate="handleOverviewNavigate"
        />
      </div>
      <div
        v-if="contextMenuState"
        ref="contextMenuRef"
        class="minimap-context-menu"
        role="menu"
        :style="{ left: `${contextMenuState.position.x}px`, top: `${contextMenuState.position.y}px` }"
      >
        <div v-for="item in contextMenuState.items" :key="item.id">
          <div v-if="item.type === 'separator'" class="minimap-context-menu-separator"></div>
          <button
            v-else
            class="minimap-context-menu-item"
            :class="{ 'is-danger': item.danger, 'is-checked': item.checked }"
            type="button"
            role="menuitem"
            :data-menu-id="item.id"
            :aria-disabled="item.disabled ? 'true' : 'false'"
            :disabled="item.disabled"
            @click="controller.runContextMenuItem(item)"
          >
            <span class="minimap-context-menu-check" aria-hidden="true">
              {{ item.type === 'checkbox' ? (item.checked ? '✓' : '') : '' }}
            </span>
            <span class="minimap-context-menu-label">{{ item.label }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
<script>
/**
 * @typedef {Object} GraphNode
 * @property {string} id 节点唯一标识。
 * @property {string} label 显示文本。
 * @property {string|null} parentId 父节点 id；根节点为 `null`。
 * @property {string[]} children 有序子节点 id 列表。
 * @property {string|{text:string,color?:string}} [icon] 默认节点绘制器显示在标签左侧的图标文本。
 * @property {string} [kind] 业务类型标记，影响默认样式或资源拖入映射。
 * @property {number} [width] 布局宽度覆盖（世界坐标 px）。
 * @property {number} [height] 布局高度覆盖（世界坐标 px）。
 * @property {*} [data] 业务自定义载荷，组件不解读。
 */

/**
 * @typedef {Object} TreeDataNode
 * @property {string|number} id 节点唯一标识；内部会转为字符串。
 * @property {string} [label] 显示文本。
 * @property {string|{text:string,color?:string}} [icon] 默认节点绘制器显示在标签左侧的图标文本。
 * @property {string} [kind] 业务类型标记。
 * @property {number} [width] 布局宽度覆盖（世界坐标 px）。
 * @property {number} [height] 布局高度覆盖（世界坐标 px）。
 * @property {*} [data] 业务自定义载荷，组件不解读。
 * @property {TreeDataNode[]} [children] 子节点列表。
 */

/**
 * @typedef {Object} GraphEdge
 * @property {string} id 边唯一标识。
 * @property {string} source 源节点 id。
 * @property {string} target 目标节点 id。
 * @property {string} [label] 边标签。
 * @property {string} [kind] 边类型。
 * @property {*} [data] 业务自定义载荷。
 */

/**
 * @typedef {Object} Graph
 * @property {number} version 图结构版本号，导入导出时校验。
 * @property {Map<string, GraphNode>} nodes 节点表；组件就地修改，不复制整图。
 * @property {string[]} rootIds 根节点 id 有序列表。
 * @property {GraphEdge[]} edges 附加连线；不参与主树布局，仅绘制与高亮。
 */

/**
 * @typedef {Object} ResourceItem
 * @property {string} id 资源 id，拖入后通常映射为新节点 id 或 kind。
 * @property {string} label 资源树展示名。
 * @property {string} [kind] 拖入落图时的节点 kind 提示。
 */

/**
 * @typedef {Object} ResourceCategory
 * @property {string} category 分类标题。
 * @property {boolean} [expanded] 默认是否展开；可被用户本地折叠状态覆盖。
 * @property {ResourceItem[]} items 该分类下可拖拽的叶子资源。
 */

/**
 * @typedef {Object} Viewport
 * @property {number} x 视口左上角世界坐标 x。
 * @property {number} y 视口左上角世界坐标 y。
 * @property {number} scale 缩放倍率（1 = 100%）。
 */

/**
 * @typedef {Object} MinimapOptions
 * @property {boolean} [enableSearch=true] 是否渲染内建搜索框；`false` 时仍可通过 `$refs` 调用搜索方法。
 * @property {boolean} [enableOverview=true] 是否渲染右下角 Overview 缩略图。
 * @property {boolean} [enableActiveBorder=false] 画布聚焦时是否显示蓝色描边。
 * @property {boolean} [showGrid=true] 是否绘制背景网格。
 * @property {boolean} [showPerformance=true] 是否显示左下角绘制性能 HUD。
 * @property {boolean} [previewMode=false] 紧凑嵌入式展示模式；隐藏工作区 chrome，仅保留搜索与缩放控件。
 * @property {boolean} [hideTextDuringInteraction=false] 拖拽/平移等交互期间是否隐藏节点文字以减轻绘制压力。
 * @property {boolean} [disableInitialCenter=false] 为 `true` 时首次布局不自动居中（测试用）。
 * @property {boolean} [disableUsedResources=true] 禁用已在画布中出现的资源项，匹配 `node.data.resourceId`。
 * @property {number} [groupExpandedMaxHeight=560] 展开态分组框最大高度（px，世界坐标）；超过即出现滚动条，业务方可覆盖默认值。
 */

/**
 * @typedef {Object} RenderStats
 * @property {number} drawn 本帧实际绘制的可见项数量。
 * @property {number} total 画布可见布局项总数（一个合并框占 1 项）。
 * @property {number} culled 视口裁剪掉的项数量。
 * @property {number} nodeCount 图中数据节点总数（`graph.nodes.size`；合并框内的每个子节点各算 1，合并框本身不是 graph 节点）。
 * @property {number} durationMs 本帧 `renderScene` 耗时（毫秒）。
 */

/**
 * @typedef {Object} ContextMenuState
 * @property {{ x: number, y: number }} position 菜单相对画布容器的 CSS 像素坐标。
 * @property {Array<{ id: string, type?: string, label?: string, disabled?: boolean, danger?: boolean, checked?: boolean }>} items 当前可见菜单项。
 */

/**
 * @typedef {Object} NodeDropPayload
 * @property {ResourceItem} resource 被拖入的资源描述（来自 `dataTransfer`）。
 * @property {string} parentId 挂载到的父节点 id。
 * @property {number} index 在父节点 `children` 中的插入下标。
 */

/**
 * @typedef {Object} NodeMovePayload
 * @property {string} nodeId 被移动的节点 id。
 * @property {string} fromParentId 原父节点 id。
 * @property {string} toParentId 目标父节点 id。
 * @property {number} index 在目标父节点 `children` 中的新下标。
 */

/**
 * @typedef {Object} GroupReorderPayload
 * @property {string} parentId 分组所属父节点 id。
 * @property {string} nodeId 被重排的子节点 id。
 * @property {number} fromIndex 原下标。
 * @property {number} toIndex 新下标。
 */

/**
 * @typedef {Object} ChangePayload
 * @property {Graph} graph 变更后的图引用（与 `graph` prop 同一对象）。
 * @property {string} [reason] 变更原因，如 `undo` / `redo` / `drop` / `delete` 等。
 * @property {*} [meta] 与 `reason` 配套的附加元数据。
 */

/**
 * @typedef {Object} ConfigChangePayload
 * @property {string} key 被 toggled 的配置键（如 `enableSearch`、`readonly`）。
 * @property {*} value 新值。
 * @property {'context-menu'} source 变更来源。
 * @property {*} [context] 右键菜单上下文快照。
 */

/**
 * @typedef {Object} SearchEmitPayload
 * @property {string} keyword 当前关键词。
 * @property {string[]} matches 命中节点 id 列表（布局顺序）。
 * @property {number} currentIndex 当前高亮命中在 `matches` 中的下标（-1 表示无选中）。
 */

/**
 * @typedef {Object} RenderScene
 * @property {*} layout `computeLayout` 结果。
 * @property {Viewport} viewport 主画布当前视口。
 * @property {number} mainWidth 主画布 CSS 宽度。
 * @property {number} mainHeight 主画布 CSS 高度。
 * @property {Object} [theme] 合并后的有效主题。
 */

/**
 * @typedef {(payload: NodeDropPayload) => boolean|void} BeforeNodeDropHook
 * 返回 `false` 阻止默认拖入落图 mutation。
 */

/**
 * @typedef {(payload: GroupReorderPayload) => boolean|void} BeforeGroupReorderHook
 * 返回 `false` 阻止分组内子节点重排。
 */

/**
 * @typedef {(payload: NodeMovePayload) => boolean|void} BeforeNodeMoveHook
 * 返回 `false` 阻止跨父节点移动。
 */

/**
 * @typedef {(payload: *) => boolean|void} BeforeEditHook
 * 通用编辑拦截钩子（删除、复制、粘贴、导入等）；返回 `false` 阻止操作。
 */

/**
 * @typedef {(context: *, defaults: *) => Array|*} ContextMenuItemsFactory
 * 右键菜单扩展：函数形式可过滤/追加默认项；数组形式按 id 覆盖并追加。
 */

/**
 * @typedef {(scene: RenderScene, ctx: CanvasRenderingContext2D) => void} CustomRenderer
 * 自定义节点/分组/边绘制钩子；只接收稳定公开参数，不得依赖组件私有状态。
 */

/**
 * Minimap 根 Vue 组件（Options API）。
 *
 * 职责边界：
 * - **本组件**：props/emits 声明、DOM 模板（资源树 / 搜索 / 左下缩放历史 / Overview / 右键菜单）、
 *   生命周期挂载与卸载、将调用转发给 `minimap-controller`。
 * - **controller 层**：指针事件、拖拽状态机、布局动画、Canvas 绘制调度、undo/redo。
 *
 * 受控 / 非受控：
 * - 传入 `selectedIds` / `groupStates` / `viewport` 时为受控模式；省略时由 controller 内部维护，
 *   并通过对应 emit 通知外部。
 * - `readonly` 与 `options` 可在运行时经右键菜单 toggled；内部副本经 `internalReadonly` /
 *   `internalOptions` 合并为 `effectiveReadonly` / `effectiveOptions`。
 *
 * 对外命令式 API（通过 `$refs.minimap.xxx()` 调用，见各 `methods` JSDoc）：
 * 相机、选中、搜索、编辑历史与剪贴板。
 *
 * @see docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md
 * @see docs/superpowers/specs/2026-06-19-phase-2-vue-interaction.md
 * @see ../controllers/minimap-controller.js
 */
import { createMinimapController } from '../controllers/minimap-controller.js'
import { defaultTheme } from '../render/theme.js'
import { centerViewportOn, clampScale, viewportOptions } from '../coords/viewport.js'
import { graphToTreeData, treeDataToGraph } from '../graph/tree-data.js'
import Overview from './Overview.vue'
import ResourceTree from './ResourceTree.vue'

export default {
  name: 'Minimap',
  components: { Overview, ResourceTree },

  props: {
    /** @type {import('vue').PropOptions<Graph|null>} 图数据；高级入口。组件就地修改 `nodes`/`children`，不克隆整图。 */
    graph: { type: Object, default: null },

    /** @type {import('vue').PropOptions<TreeDataNode[]|TreeDataNode|null>} 简单层级数据；未传 `graph` 时内部转换为 graph。 */
    data: { type: [Array, Object], default: null },

    /** @type {import('vue').PropOptions<ResourceCategory[]>} 左侧资源树数据；默认空数组。 */
    resources: { type: Array, default: () => [] },

    /** @type {import('vue').PropOptions<'horizontal'|'vertical'>} 树布局主轴方向；变化时触发布局重算（含过渡动画）。 */
    layoutDirection: { type: String, default: 'horizontal' },

    /** @type {import('vue').PropOptions<string[]|null>} 受控选中 id 列表；`null`/省略时非受控。 */
    selectedIds: { type: Array, default: null },

    /** @type {import('vue').PropOptions<Record<string, { collapsed?: boolean }>|null>} 受控分组折叠状态；键为 parentId。 */
    groupStates: { type: Object, default: null },

    /** @type {import('vue').PropOptions<Viewport|null>} 受控视口；省略时非受控。 */
    viewport: { type: Object, default: null },

    /** @type {import('vue').PropOptions<MinimapOptions|null>} 功能开关；与内建默认值合并为 `effectiveOptions`。 */
    options: { type: Object, default: null },

    /** @type {import('vue').PropOptions<Partial<typeof defaultTheme>|null>} 主题覆盖；浅合并 `defaultTheme`。 */
    theme: { type: Object, default: null },

    /** @type {import('vue').PropOptions<CustomRenderer|null>} 自定义节点绘制；传 `null` 使用默认 renderer。 */
    nodeRenderer: { type: Function, default: null },

    /** @type {import('vue').PropOptions<CustomRenderer|null>} 自定义分组框绘制。 */
    groupRenderer: { type: Function, default: null },

    /** @type {import('vue').PropOptions<CustomRenderer|null>} 自定义边绘制。 */
    edgeRenderer: { type: Function, default: null },

    /** @type {import('vue').PropOptions<boolean>} 只读模式；为 `true` 时禁止一切编辑类操作。 */
    readonly: { type: Boolean, default: false },

    /** @type {import('vue').PropOptions<BeforeNodeDropHook|null>} 资源拖入落图前拦截。 */
    beforeNodeDrop: { type: Function, default: null },

    /** @type {import('vue').PropOptions<BeforeGroupReorderHook|null>} 分组内重排前拦截。 */
    beforeGroupReorder: { type: Function, default: null },

    /** @type {import('vue').PropOptions<BeforeEditHook|null>} 删除选中前拦截。 */
    beforeDelete: { type: Function, default: null },

    /** @type {import('vue').PropOptions<BeforeEditHook|null>} 复制选中前拦截。 */
    beforeCopy: { type: Function, default: null },

    /** @type {import('vue').PropOptions<BeforeEditHook|null>} 导入图数据前拦截。 */
    beforeImport: { type: Function, default: null },

    /** @type {import('vue').PropOptions<BeforeNodeMoveHook|null>} 跨父移动前拦截。 */
    beforeNodeMove: { type: Function, default: null },

    /** @type {import('vue').PropOptions<BeforeEditHook|null>} 粘贴前拦截。 */
    beforePaste: { type: Function, default: null },

    /** @type {import('vue').PropOptions<ContextMenuItemsFactory|null>} 覆盖或扩展右键菜单项。 */
    contextMenuItems: { type: [Function, Array], default: null },
  },

  /**
   * 组件事件。Vue 2.7 中 `emits` 选项主要用于文档与 Vue 3 兼容；运行时仍通过 `$emit` 触发。
   *
   * | 事件 | 载荷 |
   * |------|------|
   * | `select` | `string[]` 新选中 id 列表 |
   * | `node-drop` | {@link NodeDropPayload} |
   * | `node-move` | {@link NodeMovePayload} |
   * | `group-reorder` | {@link GroupReorderPayload} |
   * | `change` | {@link ChangePayload} |
   * | `viewport-change` | {@link Viewport} |
   * | `group-state-change` | `Record<string, { collapsed?: boolean }>` |
   * | `search` | {@link SearchEmitPayload} |
   * | `delete` / `copy` / `paste` / `import` / `export` | 各 edit-controller 载荷 |
   * | `context-menu-action` | `{ id: string, context: * }` |
   * | `config-change` | {@link ConfigChangePayload} |
   * | `data-change` | `TreeDataNode[]` 仅使用 `data` prop 时，图编辑后的层级数据快照 |
   */
  emits: [
    'select',
    'node-drop',
    'change',
    'group-state-change',
    'group-reorder',
    'viewport-change',
    'search',
    'delete',
    'copy',
    'import',
    'export',
    'paste',
    'node-move',
    'context-menu-action',
    'config-change',
    'data-change',
  ],

  /**
   * 组件本地 UI 状态。编排逻辑与指针状态在 `this.controller`（非响应式实例属性）中。
   * @returns {Object}
   */
  data() {
    return {
      /** @type {string} 搜索框当前关键词（由 controller 搜索状态同步）。 */
      searchKeyword: '',
      /** @type {string[]} 当前搜索命中节点 id 列表。 */
      searchMatches: [],
      /** @type {number} 当前命中在 `searchMatches` 中的下标；-1 表示无。 */
      searchCurrentIndex: -1,
      /** @type {RenderStats|null} 最近一次主画布绘制的性能统计。 */
      renderStats: null,
      /** @type {boolean} 内部只读副本；可被右键菜单或 prop 同步更新。 */
      internalReadonly: this.readonly,
      /** @type {MinimapOptions} 内部 options 副本；与 prop 默认值合并后供 controller 读取。 */
      internalOptions: { ...(this.options ?? {}) },
      /** @type {ContextMenuState|null} 右键菜单可见性与项列表；`null` 时菜单 DOM 不渲染。 */
      contextMenuState: null,
      /** @type {number} 当前视口缩放倍率，供右下角缩放控件展示。 */
      viewportScale: 1,
      /** @type {boolean} 撤销栈是否非空。 */
      historyCanUndo: false,
      /** @type {boolean} 重做栈是否非空。 */
      historyCanRedo: false,
      /** @type {number} graph 原地 mutation 后递增，用于驱动依赖 Map 内容的 computed 重新求值。 */
      graphRevision: 0,
      /** @type {boolean} 左侧资源树是否收起。 */
      resourceTreeCollapsed: false,
      /** @type {Graph} 由简单 `data` prop 转换出的内部 graph。 */
      internalGraph: treeDataToGraph(this.data),
    }
  },

  computed: {
    /** @returns {Graph} 当前 controller 使用的 graph；`graph` prop 优先于简单 `data`。 */
    effectiveGraph() {
      return this.graph || this.internalGraph
    },

    /** @returns {string} 缩放百分比标签，如 `100%`。 */
    viewportScaleLabel() {
      return `${Math.round(this.viewportScale * 100)}%`
    },

    /** @returns {boolean} 已达最小缩放时禁用缩小按钮。 */
    zoomOutDisabled() {
      const opts = viewportOptions(this.effectiveOptions)
      return clampScale(this.viewportScale / 1.1, opts) === this.viewportScale
    },

    /** @returns {boolean} 已达最大缩放时禁用放大按钮。 */
    zoomInDisabled() {
      const opts = viewportOptions(this.effectiveOptions)
      return clampScale(this.viewportScale * 1.1, opts) === this.viewportScale
    },
    /** @returns {boolean} 合并 prop 与内部 toggled 后的有效只读标志。 */
    effectiveReadonly() {
      return this.internalReadonly
    },

    /**
     * @returns {Required<MinimapOptions>} 内建默认值与 `internalOptions` 浅合并后的功能开关。
     */
    effectiveOptions() {
      return {
        enableSearch: true,
        enableOverview: true,
        enableActiveBorder: false,
        showGrid: true,
        showPerformance: true,
        previewMode: false,
        hideTextDuringInteraction: false,
        disableInitialCenter: false,
        disableUsedResources: true,
        ...this.internalOptions,
      }
    },

    /**
     * @returns {typeof defaultTheme} 传给 renderer 的最终主题；`showGrid` 会同步到 `theme.grid.visible`。
     */
    effectiveTheme() {
      const baseTheme = this.theme || defaultTheme
      return {
        ...baseTheme,
        grid: {
          ...(baseTheme.grid || {}),
          visible: this.effectiveOptions.showGrid !== false,
        },
      }
    },
  },

  watch: {
    /** 布局方向变化 → 重新 `computeLayout`（含锚点补偿动画）。 */
    layoutDirection() {
      this.controller.updateLayout()
    },

    /**
     * 图引用被宿主整体替换 → 关闭菜单、重置交互状态并全量重布局。
     * 注意：Vue 2 不追踪 `Map` 内部 mutation，就地改节点需宿主手动触发更新或替换 `graph` 引用。
     */
    graph() {
      this.controller.closeContextMenu()
      this.controller.onGraphReplaced()
      this.controller.updateLayout()
    },

    /** 简单层级数据整体替换时，重建内部 graph 并重置相关 controller 状态。 */
    data() {
      if (this.graph) return
      this.internalGraph = treeDataToGraph(this.data)
      this.graphRevision += 1
      this.controller.closeContextMenu()
      this.controller.onGraphReplaced()
      this.controller.updateLayout()
    },

    /** 受控选中变化 → 仅重绘高亮，不重算布局。 */
    selectedIds() {
      this.controller.renderCurrent()
    },

    /** 受控分组折叠变化 → 重算布局并重绘。 */
    groupStates() {
      this.controller.updateLayout()
    },

    /** 受控视口变化 → 重绘（不重复 emit `viewport-change`）。 */
    viewport() {
      this.controller.renderCurrent()
      this.syncViewportChrome()
    },

    /** options prop 变化 → 同步内部副本、关闭菜单并重布局（网格可见性等可能变化）。 */
    options() {
      this.syncConfigFromProps()
      this.controller.closeContextMenu()
      this.controller.updateLayout()
    },

    /** readonly prop 变化 → 同步内部副本。 */
    readonly() {
      this.syncConfigFromProps()
    },

    /** 自定义菜单项变化 → 关闭已打开菜单，避免展示过期项。 */
    contextMenuItems() {
      this.controller.closeContextMenu()
    },
  },

  /**
   * 创建 `minimap-controller` 实例。必须在 `mounted` 之前完成，以便 `$refs` 回调闭包可用。
   * `controller` 故意不放入 `data()`，避免 Vue 2 响应式代理破坏 controller 内部引用相等性。
   */
  created() {
    this.controller = this.createInteractionController()
  },

  /** 绑定 canvas / 容器 DOM，注册 ResizeObserver 与指针监听器，并触发首次绘制。 */
  mounted() {
    this.controller.mount(this.$refs.canvasRef, this.$refs.containerRef)
    this.syncChromeState()
  },

  /**
   * 卸载清理：取消进行中的指针交互与布局动画，断开 ResizeObserver，移除 canvas 监听器。
   * 使用 Vue 2 的 `beforeDestroy`（非 `beforeUnmount`），以确保 @vue/test-utils 的 `destroy()` 能触发。
   */
  beforeDestroy() {
    this.controller?.cancelPointerInteractions()
    this.controller?.closeContextMenu()
    this.controller?.destroy()
    this.controller = null
  },

  methods: {
    /** @returns {Set<string>} 已在画布节点 `data.resourceId` 中出现的资源 id；仅 `disableUsedResources` 时填充。 */
    resolveUsedResourceIds() {
      void this.graphRevision
      if (this.effectiveOptions.disableUsedResources !== true) return new Set()
      const ids = new Set()
      // Vue 2 不能观察父层 graph.nodes(Map) 的原地 entry mutation，因此这里在渲染期解析。
      for (const node of this.effectiveGraph.nodes.values()) {
        const resourceId = node.data?.resourceId
        if (resourceId !== undefined && resourceId !== null && resourceId !== '') ids.add(String(resourceId))
      }
      return ids
    },

    /** 将 `readonly` / `options` prop 同步到内部副本。 */
    syncConfigFromProps() {
      this.internalReadonly = this.readonly
      this.internalOptions = { ...(this.options ?? {}) }
    },

    /**
     * Overview 缩略图 `@navigate` 处理器：将点击/拖拽位置转为主视口居中。
     * @param {{ x: number, y: number }} worldPoint Overview 上的世界坐标。
     */
    handleOverviewNavigate(worldPoint) {
      const { width, height } = this.controller.getCssSize()
      this.controller.applyViewport(centerViewportOn(worldPoint, this.controller.getViewport(), width, height))
    },

    /** 同步右下角缩放/历史控件所需的响应式快照。 */
    syncChromeState() {
      this.syncViewportChrome()
      this.syncHistoryChrome()
    },

    /** 从 controller 读取当前视口缩放倍率。 */
    syncViewportChrome() {
      if (!this.controller) return
      this.viewportScale = this.controller.getViewport().scale
    },

    /** 从 controller 读取 undo/redo 可用性。 */
    syncHistoryChrome() {
      if (!this.controller) return
      this.historyCanUndo = this.controller.canUndo()
      this.historyCanRedo = this.controller.canRedo()
    },

    /** 以画布中心为锚点缩小一级（÷1.1 步进，受 minScale 限制）。 */
    handleZoomOut() {
      const opts = viewportOptions(this.effectiveOptions)
      const next = clampScale(this.controller.getViewport().scale / 1.1, opts)
      this.controller.zoomTo(next)
    },

    /** 以画布中心为锚点放大一级（×1.1 步进，受 maxScale 限制）。 */
    handleZoomIn() {
      const opts = viewportOptions(this.effectiveOptions)
      const next = clampScale(this.controller.getViewport().scale * 1.1, opts)
      this.controller.zoomTo(next)
    },

    /** 点击缩放百分比时重置为 100%。 */
    handleZoomReset() {
      this.controller.zoomTo(1)
    },

    /** 撤销一步编辑并刷新历史按钮状态。 */
    handleUndo() {
      this.controller.undo()
      this.syncHistoryChrome()
    },

    /** 重做一步编辑并刷新历史按钮状态。 */
    handleRedo() {
      this.controller.redo()
      this.syncHistoryChrome()
    },

    /**
     * 右键菜单 toggled 某项配置时调用；更新内部状态、重绘并 emit `config-change`。
     * @param {string} key 配置键。
     * @param {*} value 新值。
     * @param {*} context 菜单上下文。
     */
    emitConfigChange(key, value, context) {
      if (key === 'readonly') this.internalReadonly = value
      else this.internalOptions = { ...this.internalOptions, [key]: value }
      this.controller.renderCurrent()
      this.$emit('config-change', { key, value, source: 'context-menu', context })
    },

    /** @returns {void} 缩放视口使整张图适应画布。会先取消进行中的指针交互。 */
    fitToScreen() {
      return this.controller.fitToScreen()
    },

    /**
     * @param {string} id 目标节点 id。
     * @returns {void} 将视口平移/缩放使该节点居中。
     */
    centerOnNode(id) {
      return this.controller.centerOnNode(id)
    },

    /** @returns {void} 将当前选中节点（若有）居中。 */
    centerOnSelection() {
      return this.controller.centerOnSelection()
    },

    /**
     * @param {number} scale 目标缩放倍率。
     * @param {{ x: number, y: number }} [center] 缩放中心（世界坐标）；省略时使用视口中心。
     * @returns {void}
     */
    zoomTo(scale, center) {
      return this.controller.zoomTo(scale, center)
    },

    /**
     * @param {Viewport} viewport 完整视口快照。
     * @returns {void} 直接应用视口（受控模式下由宿主配合 `viewport-change` 使用）。
     */
    setViewport(viewport) {
      return this.controller.setViewport(viewport)
    },

    /** @returns {Viewport} 当前视口快照。 */
    getViewport() {
      return this.controller.getViewport()
    },

    /**
     * @param {string|string[]} ids 要选中的节点/分组 id。
     * @param {'replace'|'add'|'toggle'} [mode='replace'] 选中模式。
     * @returns {void}
     */
    select(ids, mode) {
      return this.controller.select(ids, mode)
    },

    /** @returns {void} 清空选中并 emit `select`。 */
    clearSelection() {
      return this.controller.clearSelection()
    },

    /**
     * @param {string} keyword 搜索关键词；空字符串清除搜索高亮。
     * @returns {SearchEmitPayload} 命中摘要（同时 emit `search`）。
     */
    search(keyword) {
      return this.controller.search(keyword)
    },

    /** @returns {SearchEmitPayload} 跳转到下一个命中并平移视口。 */
    searchNext() {
      return this.controller.searchNext()
    },

    /** @returns {SearchEmitPayload} 跳转到上一个命中并平移视口。 */
    searchPrevious() {
      return this.controller.searchPrevious()
    },

    /** @returns {void} 撤销上一步图编辑（若可 undo）。 */
    undo() {
      const result = this.controller.undo()
      this.syncHistoryChrome()
      return result
    },

    /** @returns {void} 重做上一步撤销（若可 redo）。 */
    redo() {
      const result = this.controller.redo()
      this.syncHistoryChrome()
      return result
    },

    /** @returns {boolean} 是否可撤销。 */
    canUndo() {
      return this.controller.canUndo()
    },

    /** @returns {boolean} 是否可重做。 */
    canRedo() {
      return this.controller.canRedo()
    },

    /** @returns {void} 删除当前选中（只读或 `beforeDelete` 拦截时 no-op）。 */
    deleteSelection() {
      const result = this.controller.deleteSelection()
      this.syncHistoryChrome()
      return result
    },

    /** @returns {void} 复制当前选中到内部剪贴板。 */
    copySelection() {
      return this.controller.copySelection()
    },

    /** @returns {void} 从内部剪贴板粘贴（只读或 `beforePaste` 拦截时 no-op）。 */
    paste() {
      const result = this.controller.paste()
      this.syncHistoryChrome()
      return result
    },

    /** @returns {Graph} 导出当前图 JSON 可序列化快照。 */
    exportGraph() {
      return this.controller.exportGraph()
    },

    /**
     * @param {*} data 导入数据（经 `beforeImport` 校验）。
     * @returns {void}
     */
    importGraph(data) {
      return this.controller.importGraph(data)
    },

    /**
     * 工厂：组装传给 `createMinimapController` 的 deps 闭包。
     * 所有 getter 延迟读取最新 prop/computed；emit 回调统一走 `$emit`。
     * @returns {ReturnType<typeof createMinimapController>}
     * @private
     */
    createInteractionController() {
      return createMinimapController({
        getGraph: () => this.effectiveGraph,
        getLayoutDirection: () => this.layoutDirection,
        getOptions: () => this.effectiveOptions,
        getTheme: () => this.effectiveTheme,
        getRenderers: () => ({ node: this.nodeRenderer, group: this.groupRenderer, edge: this.edgeRenderer }),
        getViewportProp: () => this.viewport,
        getGroupStatesProp: () => this.groupStates,
        getSelectedIdsProp: () => this.selectedIds,
        emitSelect: (ids) => this.$emit('select', ids),
        getReadonly: () => this.effectiveReadonly,
        getBeforeDelete: () => this.beforeDelete,
        getBeforeCopy: () => this.beforeCopy,
        getBeforeImport: () => this.beforeImport,
        getBeforePaste: () => this.beforePaste,
        emitDelete: (payload) => this.$emit('delete', payload),
        emitCopy: (payload) => this.$emit('copy', payload),
        emitPaste: (payload) => this.$emit('paste', payload),
        emitImport: (payload) => this.$emit('import', payload),
        emitExport: (payload) => this.$emit('export', payload),
        emitChange: (payload) => {
          this.graphRevision += 1
          this.$emit('change', payload)
          if (!this.graph) this.$emit('data-change', graphToTreeData(this.effectiveGraph))
          this.syncHistoryChrome()
        },
        emitSearch: (payload) => this.$emit('search', payload),
        onSearchStateChange: ({ keyword, matches, currentIndex }) => {
          this.searchKeyword = keyword
          this.searchMatches = matches
          this.searchCurrentIndex = currentIndex
        },
        emitConfigChange: (key, value, context) => this.emitConfigChange(key, value, context),
        emitContextMenuAction: (payload) => this.$emit('context-menu-action', payload),
        getContextMenuItemsProp: () => this.contextMenuItems,
        getMenuEl: () => this.$refs.contextMenuRef,
        onMenuStateChange: (state) => { this.contextMenuState = state },
        emitViewportChange: (next) => {
          this.$emit('viewport-change', next)
          this.syncViewportChrome()
        },
        emitGroupStateChange: (next) => this.$emit('group-state-change', next),
        getBeforeNodeDrop: () => this.beforeNodeDrop,
        getBeforeGroupReorder: () => this.beforeGroupReorder,
        getBeforeNodeMove: () => this.beforeNodeMove,
        emitNodeDrop: (payload) => this.$emit('node-drop', payload),
        emitGroupReorder: (payload) => this.$emit('group-reorder', payload),
        emitNodeMove: (payload) => this.$emit('node-move', payload),
        onRenderStats: (stats) => { this.renderStats = stats },
        onOverviewRender: (scene) => this.$refs.overviewRef?.render(scene),
      })
    },
  },
}
</script>
<style scoped>
.minimap {
  display: flex;
  width: 100%;
  height: 100%;
  gap: 10px;
  padding: 8px;
  background: #0b0f14;
}
.minimap-resources {
  flex: 0 0 300px;
  overflow: hidden;
}
.minimap-resource-restore {
  position: absolute;
  z-index: 5;
  top: 12px;
  left: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: #8e98a5;
  background: rgba(16, 20, 24, 0.88);
  border: 1px solid rgba(48, 55, 65, 0.92);
  border-radius: 8px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
  cursor: pointer;
}
.minimap-resource-restore:hover {
  color: #dce3ec;
  background: rgba(23, 28, 34, 0.96);
  border-color: #343c47;
}
.minimap-resource-restore:focus-visible {
  outline: 1px solid #4b8cff;
  outline-offset: 2px;
}
.minimap-resource-restore-icon {
  display: block;
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.4;
}
.minimap-canvas-container {
  flex: 1 1 auto;
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid #252b34;
  border-radius: 10px;
  background: #0f1318;
}
.minimap-canvas-container canvas {
  display: block;
  outline: none;
}
.minimap-canvas-container canvas.is-active-border-enabled:focus {
  outline: 1px solid #3d9cff;
  outline-offset: -1px;
}
.minimap-search {
  position: absolute;
  z-index: 4;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: rgba(18, 23, 29, 0.94);
  border: 1px solid #2a3038;
  border-radius: 7px;
}
.minimap-search-input {
  width: 150px;
  color: #d9e0ea;
  background: #0f141a;
  border: 1px solid #303741;
  border-radius: 5px;
  padding: 5px 7px;
  font-size: 12px;
}
.minimap-search-count {
  min-width: 36px;
  color: #87909c;
  font-size: 12px;
  text-align: center;
}
.minimap-search-btn {
  width: 22px;
  height: 22px;
  color: #cfd6df;
  background: #20262d;
  border: 1px solid #303741;
  border-radius: 4px;
}
.minimap-search-btn:disabled {
  opacity: 0.4;
}
.minimap-canvas-footer-left {
  position: absolute;
  z-index: 4;
  left: 14px;
  bottom: 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  pointer-events: none;
}
.minimap-bottom-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: auto;
}
.minimap-control-pod {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 36px;
  padding: 0 6px;
  border: 1px solid #303741;
  border-radius: 10px;
  background: rgba(22, 26, 32, 0.96);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.32);
}
.minimap-zoom-pod {
  padding: 0 8px;
  gap: 4px;
}
.minimap-history-pod {
  padding: 0 4px;
}
.minimap-control-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 4px;
  color: #d8dee8;
  background: transparent;
  border: 0;
  border-radius: 6px;
  font: 15px/1 system-ui, sans-serif;
  cursor: pointer;
}
.minimap-control-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}
.minimap-control-button:disabled {
  color: #5c6570;
  cursor: default;
}
.minimap-control-icon {
  display: block;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.minimap-zoom-label {
  position: relative;
  min-width: 44px;
  color: #d8dee8;
  font: 13px/1 system-ui, sans-serif;
  text-align: center;
  user-select: none;
  cursor: pointer;
}
.minimap-zoom-label::after {
  content: '点击重置为 100%';
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  padding: 5px 8px;
  border: 1px solid #303741;
  border-radius: 6px;
  background: rgba(18, 22, 28, 0.98);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
  color: #d8dee8;
  font: 11px/1.3 system-ui, sans-serif;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.12s ease, visibility 0.12s ease;
  pointer-events: none;
  z-index: 10;
}
.minimap-zoom-label:hover::after,
.minimap-zoom-label:focus-visible::after {
  opacity: 1;
  visibility: visible;
}
.minimap-zoom-label:hover,
.minimap-zoom-label:focus-visible {
  background: rgba(255, 255, 255, 0.06);
}
.minimap-overview-panel {
  position: absolute;
  z-index: 4;
  right: 14px;
  bottom: 14px;
  padding: 8px;
  border: 1px solid #303741;
  border-radius: 9px;
  background: rgba(18, 23, 29, 0.92);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.38);
}
.minimap-overview-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
  color: #68727f;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
}
.minimap-overview {
  display: block;
  overflow: hidden;
  border-radius: 5px;
}
.minimap-overview canvas {
  display: block;
  cursor: pointer;
}
.minimap-performance {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  color: #b8c1cc;
  background: rgba(18, 23, 29, 0.92);
  border: 1px solid #303741;
  border-radius: 8px;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.38);
  font: 12px/1 system-ui, sans-serif;
  pointer-events: auto;
}
.minimap-performance-label {
  color: #7f8a99;
  letter-spacing: 0;
}
.minimap-performance-value {
  white-space: nowrap;
}
.minimap-context-menu {
  position: absolute;
  z-index: 8;
  width: 232px;
  max-height: 360px;
  overflow-y: auto;
  padding: 6px;
  color: #d8dee8;
  background: rgba(17, 21, 27, 0.98);
  border: 1px solid #303741;
  border-radius: 8px;
  box-shadow: 0 18px 38px rgba(0, 0, 0, 0.42);
  scrollbar-width: thin;
  scrollbar-color: #2e3540 transparent;
}
.minimap-context-menu::-webkit-scrollbar {
  width: 6px;
}
.minimap-context-menu::-webkit-scrollbar-track {
  background: transparent;
}
.minimap-context-menu::-webkit-scrollbar-thumb {
  background-color: #2e3540;
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: 999px;
}
.minimap-context-menu::-webkit-scrollbar-thumb:hover {
  background-color: #3a4250;
}
.minimap-context-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  height: 30px;
  gap: 8px;
  padding: 0 8px;
  color: #cfd6df;
  background: transparent;
  border: 0;
  border-radius: 5px;
  text-align: left;
  font: 13px/1 system-ui, sans-serif;
}
.minimap-context-menu-item:hover:not(:disabled) {
  background: #232930;
}
.minimap-context-menu-item:disabled {
  opacity: 0.38;
}
.minimap-context-menu-item.is-danger:not(:disabled) {
  color: #ff8d8d;
}
.minimap-context-menu-check {
  width: 14px;
  color: #2bdd7f;
  text-align: center;
}
.minimap-context-menu-label {
  flex: 1;
}
.minimap-context-menu-separator {
  height: 1px;
  margin: 5px 4px;
  background: #2a3038;
}
</style>
