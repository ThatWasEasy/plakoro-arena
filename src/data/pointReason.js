// Why a PTP line exists, in words.
//
// Shared by all three places a point entry is shown — the gift card, the player's own statement,
// and the organiser's — because those three answering differently about the same row is how a
// player ends up arguing with a screen.
//
// The server stores the two halves separately: `src` says what kind of thing happened
// ('auto:1', 'auto:participant', 'manual:ADMIN') and `tournament_name` says where. The name
// alone is not a reason — "Meetup#1" under a +50 does not tell anyone whether they were paid
// for placing or for turning up, and at an event where both are handed out that is the only
// question being asked.

/**
 * @param {object} e  a gift card (`note`) or a ledger row (`reason`); both carry `src`
 * @param {Function} t  vue-i18n's translate
 */
export function pointReason(e, t) {
  const src = e?.src || ''

  // Written beats derived, whatever kind of row this is. The derived wording names the
  // tournament, which is right when the two tournaments at one meetup awarded different
  // things — and wrong for an award that belongs to the meetup rather than to either of them.
  // Writing the reason down is how that gets said; this is the line that lets it be heard.
  const written = (e?.note || e?.reason || '').trim()
  if (written) return written

  if (src.startsWith('auto:')) {
    const name = e.tournament_name || t('points.fromEvent')
    // Everything automatic is one of the two placement tiers. Participation is the one that
    // needs naming, because placing is what people assume a prize means.
    return src === 'auto:participant'
      ? t('points.fromParticipant', { name })
      : t('points.fromPlace', { name })
  }

  // Hand-adjusted with nothing written down.
  return t('points.fromGrant')
}
