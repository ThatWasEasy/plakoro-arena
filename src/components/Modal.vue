<script setup>
import { computed, inject } from 'vue'
import CharSelectModal from './CharSelectModal.vue'
import MoveSelectModal from './MoveSelectModal.vue'

const props = defineProps({
  playerKey: { type: String, required: true }
})

const battle = inject('battle')
const state = battle.state
const modal = computed(() => state.modals[props.playerKey])
</script>

<template>
  <div class="modal-overlay" @click.self="battle.closeModal(playerKey)">
    <div class="modal-sheet">
      <CharSelectModal v-if="modal.type === 'char'" :player-key="playerKey" />
      <MoveSelectModal v-else-if="modal.type === 'move'" :player-key="playerKey" />
    </div>
  </div>
</template>
