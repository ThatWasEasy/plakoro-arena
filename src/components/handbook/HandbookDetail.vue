<script setup>
// What a volume is, and what it costs — the screen a locked book opens into.
//
// It exists because a shelf where the locked books do nothing is a shelf that cannot sell
// anything. Everything here is read from the manifest rather than written by hand: the plan
// comes from the split config, the sections from the book's own outline, the sample from the
// preview catalogue. A chapter that gains a section gains it here too.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  unit: { type: Object, required: true },
  owned: { type: Boolean, default: false },
  cover: { type: String, default: '' },
  art: { type: String, default: '' },
  code: { type: String, default: '' },
  // Units of the same bundle, when this is a bundle rather than a single volume.
  members: { type: Array, default: () => [] },
  // The plan that opens this volume — { name, usd } — and where to go and get it.
  plan: { type: Object, default: null },
  join: { type: String, default: '' },
  group: { type: String, default: '' }
})
const emit = defineEmits(['close', 'read', 'preview'])
const { t } = useI18n()

const toc = computed(() => props.unit.toc || [])
// Plan names are written "Master｜PLAKORO 上位選手" — a short name and the line that sells it.
// Set as one string it wraps mid-word in a 150px column; split, the name reads at a glance
// and its tagline sits under it where a tagline belongs.
const planName = computed(() => (props.plan?.name || '').split('｜')[0])
const planSub = computed(() => (props.plan?.name || '').split('｜').slice(1).join('｜'))
const pages = computed(() =>
  props.members.length ? props.members.reduce((n, u) => n + u.pages, 0) : props.unit.pages)
</script>

<template>
  <div class="hd" @click.self="emit('close')">
    <div class="hd-sheet">
      <button class="hd-x" :aria-label="t('common.back')" @click="emit('close')">✕</button>

      <div class="hd-head">
        <!-- The same cover the shelf shows, at a size where its printing is legible. -->
        <div class="hd-cover" :class="{ main: !art }" :style="cover ? { backgroundImage: `url(${cover})` } : {}">
          <!-- Same three printed zones as the shelf, at the same measurements: this is the
               same book, and a cover that loses its name on the way here reads as a different
               object. The two sizes are within 12px of each other, so the type carries over. -->
          <template v-if="art">
            <img :src="art" :alt="unit.title">
            <span class="hd-covername">{{ unit.title }}</span>
            <span v-if="code" class="hd-covercode">{{ code }}</span>
          </template>
          <span v-else class="hd-cover-title">{{ unit.title }}</span>
        </div>
        <div class="hd-meta">
          <div v-if="group" class="hd-group">{{ group }}</div>
          <h2 class="hd-title">{{ unit.title }}</h2>
          <div class="hd-facts">
            <span>{{ t('handbook.pages', { n: pages }) }}</span>
            <!-- Only when the cover is not already printing it. -->
            <span v-if="code && !art">{{ code }}</span>
            <span v-if="members.length">{{ t('handbook.volumes', { n: members.length }) }}</span>
          </div>
        </div>
      </div>

      <!-- What is inside. For a bundle that is its volumes; for a volume, its sections. -->
      <template v-if="members.length">
        <h3 class="hd-label">{{ t('handbook.included') }}</h3>
        <ul class="hd-list">
          <li v-for="m in members" :key="m.id">
            <span>{{ m.title }}</span>
            <span class="hd-pg">{{ t('handbook.pages', { n: m.pages }) }}</span>
          </li>
        </ul>
      </template>
      <template v-else-if="toc.length">
        <h3 class="hd-label">{{ t('handbook.contents') }}</h3>
        <ul class="hd-list">
          <li v-for="(e, i) in toc" :key="i">
            <span>{{ e.title }}</span>
            <span class="hd-pg">{{ e.page }}</span>
          </li>
        </ul>
      </template>

      <h3 class="hd-label">{{ t('handbook.sample') }}</h3>
      <!-- Wired to the preview catalogue rather than to the first pages of the real file: the
           sample is a separate, shorter book the authors prepare, so showing paid pages here
           would be giving away exactly what the lock is for. -->
      <p class="hd-note">{{ t('handbook.samplePending') }}</p>

      <div class="hd-foot">
        <button v-if="owned" class="hd-cta" @click="emit('read')">{{ t('handbook.startReading') }}</button>
        <template v-else>
          <div class="hd-plan">
            <template v-if="plan">
              <div class="hd-planlabel">{{ t('handbook.needPlan') }}</div>
              <div class="hd-planname">
                {{ planName }}
                <span class="hd-planfee">{{ t('handbook.perMonth', { n: plan.usd }) }}</span>
              </div>
              <div v-if="planSub" class="hd-plansub">{{ planSub }}</div>
            </template>
            <span v-else class="hd-plansub">{{ t('handbook.planUnknown') }}</span>
          </div>
          <!-- A link, not a button: subscribing happens on Patreon, and the control should say
               where it takes you rather than pretending the payment is ours. -->
          <a v-if="plan && join" class="hd-cta" :href="join" target="_blank" rel="noopener">
            {{ t('handbook.join') }}
          </a>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Outside #stage like the rest of the handbook, so px throughout. */
.hd {
  position: absolute; inset: 0; z-index: 20;
  background: rgba(20, 14, 8, .55);
  display: flex; align-items: flex-end;
}
.hd-sheet {
  position: relative;
  width: 100%; max-height: 88%; overflow-y: auto;
  padding: 18px 18px calc(22px + env(safe-area-inset-bottom));
  background: #EFE9DC;
  border-top: 3px solid var(--wood);
  font-family: "Noto Serif TC", "Songti TC", "Hiragino Mincho ProN", serif;
}
.hd-x {
  position: absolute; right: 12px; top: 12px;
  width: 28px; height: 28px; border: 1px solid rgba(122,86,54,.45);
  background: none; color: var(--ink); font-size: 13px; cursor: pointer;
}

.hd-head { display: flex; gap: 16px; align-items: flex-start; padding-right: 36px; }
.hd-cover {
  position: relative; flex: none;
  width: 104px; height: 149px;
  background-size: 100% 100%; background-color: #DCD3C2;
  box-shadow: 2px 3px 8px rgba(60,40,22,.4);
}
.hd-cover img {
  position: absolute; left: 17%; width: 66%; top: 20%; height: 54%;
  object-fit: contain; object-position: bottom;
  filter: drop-shadow(0 1px 1px rgba(60,44,26,.5));
}
.hd-covername {
  position: absolute; left: 4%; width: 92%; top: 79%; height: 11%;
  display: grid; place-items: center;
  font-family: 'CorporateLogoBold', 'Noto Sans TC', 'PingFang TC', sans-serif;
  font-size: 16px; font-weight: 700; line-height: 1; letter-spacing: .02em;
  color: #231C14; white-space: nowrap;
}
.hd-covercode {
  position: absolute; right: 1px; bottom: 26%;
  writing-mode: vertical-rl; transform: rotate(180deg);
  font-size: 9px; font-weight: 700; letter-spacing: .12em;
  color: #3A2F22; font-family: ui-monospace, "SFMono-Regular", monospace;
}
.hd-cover.main { background-color: #1C1510; display: grid; place-items: center; }
.hd-cover-title {
  padding: 0 10px; text-align: center; color: #F2E8D6;
  font-family: 'CorporateLogoBold', 'Noto Sans TC', 'PingFang TC', sans-serif; font-size: 15px; line-height: 1.3;
}
.hd-meta { flex: 1; min-width: 0; }
.hd-group { font-size: 11px; letter-spacing: .18em; color: var(--ink-soft); }
.hd-title {
  margin: 4px 0 8px; font-size: 24px; line-height: 1.2;
  font-family: 'CorporateLogoBold', 'Noto Sans TC', 'PingFang TC', sans-serif; font-weight: 400;
}
.hd-facts { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--ink-soft); }

.hd-label {
  margin: 22px 0 8px; font-size: 11px; font-weight: 700; letter-spacing: .26em;
  color: var(--ink-soft); padding-bottom: 7px; border-bottom: 1px solid rgba(122,86,54,.35);
}
.hd-list { list-style: none; margin: 0; padding: 0; }
.hd-list li {
  display: flex; justify-content: space-between; gap: 14px;
  padding: 9px 2px; border-bottom: 1px solid rgba(122,86,54,.2); font-size: 15px;
}
.hd-pg { flex: none; color: var(--ink-soft); font-size: 12px; font-variant-numeric: tabular-nums; }
.hd-note { font-size: 13px; color: var(--ink-soft); margin: 10px 0 0; }

.hd-foot {
  display: flex; align-items: center; gap: 14px;
  margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(122,86,54,.35);
}
.hd-plan { flex: 1; min-width: 0; }
.hd-planlabel {
  font-size: 10px; font-weight: 700; letter-spacing: .22em; color: var(--ink-soft);
}
.hd-planname {
  margin-top: 3px; font-size: 17px; line-height: 1.2;
  font-family: 'CorporateLogoBold', 'Noto Sans TC', 'PingFang TC', sans-serif;
}
.hd-planfee {
  margin-left: 6px; font-size: 13px; color: var(--ink-soft);
  font-family: inherit; font-variant-numeric: tabular-nums;
}
.hd-plansub { margin-top: 2px; font-size: 12px; color: var(--ink-soft); }
.hd-cta {
  flex: none; padding: 13px 22px; border: 0;
  background: var(--wood-dark); color: #F2E8D6; text-decoration: none; white-space: nowrap;
  font: inherit; font-size: 15px; font-weight: 700; cursor: pointer;
}
.hd-cta:not(:disabled):active { transform: translate(1px, 1px); }
</style>
