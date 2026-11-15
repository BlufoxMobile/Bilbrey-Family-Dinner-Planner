// A realistic family state as v2.0.1 left it on the server (no lunch, health or coupon keys).
export const v201State = {
  settings: { meatScale: 0.85, period: 'week' },
  plan: {
    '2026-11-16': { dinner: 'smashburgers', sides: ['jewel-fries'], status: 'planned', by: 'Jeff', at: '2026-11-15T01:30:00Z' },
    '2026-11-17': { dinner: 'beef-broccoli-noodles', sides: ['carrot-sticks', 'sesame-cucumber'], status: 'planned', by: 'Jeff', at: '2026-11-15T01:30:00Z' },
    '2026-11-18': { dinner: 'griddle-sloppy-joes', sides: ['potato-wedges', 'canned-green-beans'], status: 'planned', by: 'Jeff', at: '2026-11-15T01:30:00Z' },
    '2026-11-19': { dinner: 'honey-ginger-noodles', sides: ['canned-green-beans', 'sesame-cucumber'], status: 'planned', by: 'Jeff', at: '2026-11-15T01:30:00Z' },
    '2026-11-20': { dinner: 'onion-burgers', sides: ['jewel-fries'], status: 'planned', by: 'Jeff', at: '2026-11-15T01:30:00Z' },
    '2026-11-21': { dinner: 'tikka-masala', sides: ['warm-naan', 'buttered-peas'], status: 'away', away: { reason: 'Date night', note: 'Anniversary' }, manual: true, by: 'Candi', at: '2026-11-15T02:00:00Z' },
    '2026-11-22': { dinner: 'classic-spaghetti', sides: ['romaine-salad', 'garlic-toast'], status: 'planned', by: 'Jeff', at: '2026-11-15T01:30:00Z' },
    '2026-11-23': { dinner: 'mushroom-burgers', sides: ['jewel-fries'], status: 'planned', by: 'Jeff', at: '2026-11-15T01:31:00Z' },
  },
  votes: { 'tikka-masala': { Jeff: 1, Candi: 1 }, 'beef-broccoli-noodles': { Knox: -1 } },
  substitutions: { 'onion-burgers': { 0: 'item:greenBeans@2' } },
  pantry: { greenBeans: { qty: 6, stocked: false, by: 'Jeff', at: '2026-11-14T20:00:00Z' }, salt: { qty: null, stocked: true, by: 'Candi', at: '2026-11-14T20:00:00Z' } },
  checked: { '2026-11-16+7': { beef: true } },
  receipts: [{ id: 'r1', date: '2026-11-12', store: 'jewel', amount: 64.18, by: 'Candi' }],
  extras: { 'x-milk': { name: 'Milk', qty: 1, unit: '', store: 'jewel', every: 'week', item: 'milk' } },
};
