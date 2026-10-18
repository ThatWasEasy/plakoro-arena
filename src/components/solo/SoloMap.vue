<script setup>
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import dagre from 'dagre'

const solo = inject('solo')
const { t } = useI18n()
const state = solo.state

const TYPE_ICON = { monster: '⚔️', event: '❓', campfire: '🔥', boss: '👑' }

// Sizes below are in rem (dagre just does arithmetic on these numbers — it doesn't care what
// unit they represent — and every place they're used in inline styles appends 'rem').
const NODE_SIZE = 3
const NODE_SEP = 1.3125
const RANK_SEP = 2.4375
const MARGIN = 0.625

// Real layered-graph layout (same family of algorithm d3-dag's sugiyama layout and
// graphviz's `dot` use): dagre assigns each node a non-overlapping x/y and routes each
// edge as a point path that reserves lanes between nodes, so lines never cross through
// another node's icon even though layer widths vary node-to-node. Node count per layer is
// random (2-5), so the map can end up taller or wider than the screen — rather than shrink
// things to force a fit, the viewport just scrolls in both directions.
const layout = computed(() => {
  const g = new dagre.graphlib.Graph()
  // dagre's edgesep (spacing reserved for dummy/routing nodes) defaults to 20 if left unset —
  // harmless back when sizes were in px (NODE_SIZE=96 etc.) but now that everything's in rem
  // (NODE_SIZE=3), that unset default dwarfs nodesep and silently inflates the whole layout.
  g.setGraph({ rankdir: 'LR', nodesep: NODE_SEP, ranksep: RANK_SEP, edgesep: NODE_SEP, marginx: MARGIN, marginy: MARGIN })
  g.setDefaultEdgeLabel(() => ({}))
  const allNodes = Object.values(state.map.nodes)
  allNodes.forEach(n => g.setNode(n.id, { width: NODE_SIZE, height: NODE_SIZE }))
  allNodes.forEach(n => n.edges.forEach(targetId => g.setEdge(n.id, targetId)))
  dagre.layout(g)
  return g
})

const layoutW = computed(() => layout.value.graph().width)
const layoutH = computed(() => layout.value.graph().height)

function topLeftOf(nodeId) {
  const gn = layout.value.node(nodeId)
  return { left: (gn.x - NODE_SIZE / 2) + 'rem', top: (gn.y - NODE_SIZE / 2) + 'rem' }
}

const edgePaths = computed(() => {
  const g = layout.value
  return g.edges().map(e => {
    const points = g.edge(e).points
    const d = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ',' + p.y).join(' ')
    return { key: e.v + '->' + e.w, d, active: e.v === state.currentNodeId }
  })
})

function nodeStatus(node) {
  if (node.id === state.currentNodeId) return 'current'
  if (state.reachableNodeIds.includes(node.id)) return 'reachable'
  return 'locked'
}

function pick(node) {
  if (nodeStatus(node) !== 'reachable') return
  solo.enterNode(node.id)
}
</script>

<template>
  <div class="board" style="display:flex; flex-direction:column; min-height:0;">
    <div style="flex-shrink:0;">
      <div class="modal-title" style="margin:0.5rem 0 0.25rem;">{{ t('solo.map.title', { act: state.act }) }}</div>
      <div class="center-hint" style="padding-bottom:0.375rem;">{{ t('solo.map.hint') }}</div>
    </div>
    <div style="flex:1; min-height:0; overflow:auto;">
      <div style="position:relative;" :style="{ width: layoutW + 'rem', height: layoutH + 'rem' }">
        <svg :viewBox="`0 0 ${layoutW} ${layoutH}`" :style="{ width: layoutW + 'rem', height: layoutH + 'rem', position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }">
          <path
            v-for="line in edgePaths"
            :key="line.key"
            :d="line.d"
            fill="none"
            :stroke="line.active ? '#1F1F1D' : '#DEDACD'"
            :stroke-width="line.active ? 0.1875 : 0.125"
          />
        </svg>
        <div
          v-for="node in Object.values(state.map.nodes)"
          :key="node.id"
          class="select-card"
          :style="{
            position: 'absolute',
            ...topLeftOf(node.id),
            width: NODE_SIZE + 'rem',
            height: NODE_SIZE + 'rem',
            padding: '0.0625rem',
            gap: '0.0625rem',
            justifyContent: 'center',
            borderRadius: '50%',
            background: 'var(--card)',
            cursor: nodeStatus(node) === 'reachable' ? 'pointer' : 'default',
            opacity: nodeStatus(node) === 'locked' ? 0.35 : 1,
            border: nodeStatus(node) === 'current' ? '0.09375rem solid #AEFF3E' : (nodeStatus(node) === 'reachable' ? '0.09375rem solid #1F1F1D' : '0.09375rem solid transparent')
          }"
          @click="pick(node)"
        >
          <div style="font-size:1.09375rem; line-height:1;">{{ TYPE_ICON[node.type] }}</div>
          <div style="font-size:0.40625rem; line-height:1.1; font-weight:800; text-align:center; white-space:nowrap;">{{ t('solo.node.' + node.type) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
