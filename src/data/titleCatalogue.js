// Every title that exists. One kind of thing — a title — listed in the groups a player would
// look for them in.
//
// What differs between them is only how one is come by. Some are awarded by an event for where
// you finished, and carry that event's name; some are awarded for something that happened at
// the table, and carry the condition that unlocks them. Both are earned, never typed in: a
// profile screen that could set a title would make every one of them worthless.
//
// `rank` is what the nameplate colours it by; see TITLE_RANKS in game/playerBadges.js.
// Placement titles take the metal that matches the finish, so colour and words agree.
//
// `condition` is shown beside a title so a player can see what it takes, whether or not they
// hold it. Nothing checks these yet — the battle detail that would prove them isn't recorded —
// so they are awarded by hand for now.

export const TITLE_GROUPS = [
  {
    // Not tied to any event. These are what someone wears before a result has given them
    // something better, so they stay available no matter which Meetups a player has been to.
    key: 'general',
    label: '通用',
    titles: [
      { id: 'gen-rookie', text: '骰子新鮮人', rank: 'plain' }
    ]
  },
  {
    key: 'meetup1',
    label: 'Meetup#1',
    titles: [
      { id: 'm1-champion',  text: 'Meetup#1 冠軍', rank: 'gold' },
      { id: 'm1-runner-up', text: 'Meetup#1 亞軍', rank: 'silver' },
      { id: 'm1-third',     text: 'Meetup#1 季軍', rank: 'bronze' },
      { id: 'm1-attendee',  text: 'Meetup#1 會眾', rank: 'plain' }
    ]
  },
  {
    key: 'meetup2',
    label: 'Meetup#2',
    titles: [
      { id: 'm2-champion',  text: 'Meetup#2 冠軍', rank: 'gold' },
      { id: 'm2-runner-up', text: 'Meetup#2 亞軍', rank: 'silver' },
      { id: 'm2-third',     text: 'Meetup#2 季軍', rank: 'bronze' },
      { id: 'm2-attendee',  text: 'Meetup#2 會眾', rank: 'plain' },
      { id: 'm2-roll',      text: '骰起來！',      rank: 'plain' },
      { id: 'm2-no-regret', text: '落子無悔',      rank: 'epic' },
      { id: 'm2-general',   text: '骰子大將軍',    rank: 'legend' }
    ]
  },
  {
    // Not earned by playing — given for being here at a particular time. Deliberately its own
    // group rather than folded into 通用: everything in `general` is unlocked for everyone
    // (see isTitleUnlocked), which is the opposite of what a limited title means.
    key: 'limited',
    label: '限定',
    titles: [
      { id: 'early-player', text: '早鳥玩家', rank: 'epic' }
    ]
  },
  {
    key: 'achievement',
    label: '特殊成就',
    titles: [
      { id: 'ach-big-hit',    text: '賽到的',       rank: 'plain',  condition: '單擊打出 100 以上傷害' },
      { id: 'ach-last-stand', text: '九死一生',     rank: 'epic',   condition: '剩下 10 滴血量贏過對手' },
      { id: 'ach-untouched',  text: '怎麼結束了？', rank: 'legend', condition: '還剩下 120 滴血量贏得比賽' }
    ]
  }
]

export const ALL_TITLES = TITLE_GROUPS.flatMap(g => g.titles.map(t => ({ ...t, group: g.key })))

const BY_ID = new Map(ALL_TITLES.map(t => [t.id, t]))

export function titleById(id) {
  return BY_ID.get(id) || null
}

// A stored id that no longer names a real title resolves to nothing rather than to a guess —
// a nameplate showing the wrong accolade is worse than one showing none.
export function resolveTitle(id) {
  const t = titleById(id)
  return t ? { text: t.text, rank: t.rank } : null
}
