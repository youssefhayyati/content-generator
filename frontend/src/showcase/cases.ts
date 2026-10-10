import type { PlatformId } from '../components/ui/PlatformIcon'

/*
 * The showcase: things FlowAI made, each from the brief or prompt shown beside it. The brands
 * are invented for the page; the words, pictures, clips, the flow and the campaign plan are what
 * FlowAI returned (GPT-OSS 120B through the post writer, Say it and the campaign planner;
 * Higgsfield Soul 2 and Kling 3 Pro for pictures and clips), left exactly as they came out.
 * Each case carries what it takes to make another like it in the studio.
 */

export type Group = 'words' | 'pictures' | 'motion' | 'automations'
export type Kind = 'post' | 'picture' | 'carousel' | 'reel' | 'flow' | 'campaign'
export type Tone = 'professional' | 'friendly' | 'bold' | 'playful'

export type Shot = { src: string; w: number; h: number; tone: string; alt: string }
export type Version = { platform: PlatformId; text: string }

/** A flow as the showcase draws it: the composed graph's steps, placed in lanes and rows. */
export type FlowStep = { id: string; type: string; label: string; detail: string; lane: number; row: number }
export type FlowLink = { from: string; to: string; port: 'next' | 'yes' | 'no' | 'approved' }

export type Plan = {
  idea: string
  pillars: Array<{ name: string; why: string }>
  posts: Array<{ title: string; pillar: string; format: 'image' | 'carousel' | 'video' | 'text'; hook: string; message: string }>
}

/** Where "make one like it" goes, and what it fills in when it gets there. */
export type Make =
  | { tool: 'composer'; brief: string; tone: Tone; platforms: PlatformId[] }
  | { tool: 'image' | 'video'; prompt: string; ratio: string; model: string }
  | { tool: 'flows'; say: string }
  | { tool: 'campaigns' }

export type Case = {
  id: string
  group: Group
  kind: Kind
  brand: { name: string; handle: string; trade: string }
  title: string
  /** What was typed in: the post brief, the sentence, or the campaign's message. */
  brief: string
  /** A longer brief's labelled parts, as they were filled in. */
  fields?: Array<[label: string, value: string]>
  /** The picture or clip prompt, exactly as it was sent. */
  prompt?: string
  shots?: Shot[]
  video?: { src: string; seconds: number }
  versions?: Version[]
  flow?: { name: string; steps: FlowStep[]; links: FlowLink[] }
  plan?: Plan
  /** What FlowAI did, in order, and with which model. */
  made: Array<{ did: string; model: string }>
  make: Make
}

const WRITER = 'GPT-OSS 120B'
/** The studio's ids for the models the pictures and clips were made with. */
const SOUL_ID = 'higgsfield/soul-v2'
const KLING_ID = 'higgsfield/kling-3-pro'
const SOUL = 'Higgsfield Soul 2'
const KLING = 'Kling 3 Pro'
const CLEAN = ' No text, no lettering, no logos.'

const shot = (name: string, w: number, h: number, tone: string, alt: string): Shot => ({ src: `/showcase/${name}`, w, h, tone, alt })

export const CASES: Case[] = [
  {
    id: 'ember-fig',
    group: 'words',
    kind: 'post',
    brand: { name: 'Maison Cire', handle: 'maisoncire', trade: 'Candle maker' },
    title: 'One brief, three networks',
    brief: 'Our autumn candle Ember & Fig is back for six weeks only. Smoky fig, cedar and a little black pepper. Hand-poured in small batches.',
    prompt:
      'Amber glass candle burning on a dark walnut table, ripe split figs and a sprig of cedar beside it, a thin curl of smoke, low warm window light, shallow depth of field, editorial still life photography, muted autumn palette.' +
      CLEAN,
    shots: [shot('ember-fig', 1536, 2048, '#1a110d', 'A lit amber candle on a walnut table beside split figs and a sprig of cedar')],
    versions: [
      {
        platform: 'instagram',
        text: 'Our cozy autumn favorite is back! 🌰✨ Ember & Fig is here for just six weeks—so light it up while you can.\n\nSmoky fig mingles with cedar and just a hint of black pepper, creating the perfect seasonal vibe. Hand‑poured in small batches, each candle is made with love and attention to detail.\n\nGrab yours before the season’s scent fades!\n\n#EmberAndFig #AutumnCandle #HandPoured',
      },
      {
        platform: 'x',
        text: 'Our autumn favorite Ember & Fig is back—for six weeks only! 🌿 Smoky fig, cedar, and a hint of black pepper, hand‑poured in small batches. Grab yours before the season fades. #candle #autumn',
      },
      {
        platform: 'linkedin',
        text: 'Our beloved Ember & Fig autumn candle is back—for just six weeks! 🌿🍂\n\nImagine the cozy scent of smoky fig layered with rich cedar and just a hint of black pepper. Each candle is hand‑poured in small batches, so you’ll get the same care and quality that made it a seasonal favorite.\n\nBecause it’s a limited‑time release, now’s the perfect moment to treat yourself (or a loved one) to that warm, seasonal glow before the season ends.\n\nTap the link to reserve yours while they last: [link]\n\n#AutumnVibes #HandPoured #CandleLovers',
      },
    ],
    made: [
      { did: 'Wrote a version for each network', model: WRITER },
      { did: 'Made the picture, 3:4', model: SOUL },
    ],
    make: { tool: 'composer', brief: 'Our autumn candle Ember & Fig is back for six weeks only. Smoky fig, cedar and a little black pepper. Hand-poured in small batches.', tone: 'friendly', platforms: ['instagram', 'x', 'linkedin'] },
  },
  {
    id: 'dawn-miles',
    group: 'motion',
    kind: 'reel',
    brand: { name: 'Northline Run Club', handle: 'northlineruns', trade: 'Running club' },
    title: 'A sunrise reel from one sentence',
    brief: 'Every Saturday at 6:30 in the morning we run the river bridges. All paces, nobody gets left behind. Show up once and you’ll be back.',
    prompt: 'Low tracking shot alongside a small group of runners crossing a steel bridge over a river at dawn, city skyline in soft mist behind them, breath visible in the cold air, warm sunrise light, cinematic.',
    shots: [shot('dawn-miles', 720, 1280, '#554f48', 'Runners silhouetted crossing a steel truss bridge at sunrise')],
    video: { src: '/showcase/dawn-miles.mp4', seconds: 5 },
    versions: [
      { platform: 'tiktok', text: 'RISE BEFORE SUNRISE 🌅\nEvery Saturday at 6:30 am we run the river bridges.\nAll paces welcome—nobody gets left behind.\nShow up once and you’ll be back for more.\n\n💪🌊 #RiverBridges #SaturdayRun #AllPaces' },
      { platform: 'instagram', text: 'Rise before sunrise. Every Saturday at 6:30 am we hit the River Bridges. All paces, nobody gets left behind. One run and you’ll be back for more. 🏃‍♂️💥 #RiverBridges #SaturdayRun #AllPaces' },
    ],
    made: [
      { did: 'Filmed the clip, 9:16, 5 seconds', model: KLING },
      { did: 'Wrote the TikTok and Instagram captions', model: WRITER },
    ],
    make: { tool: 'video', prompt: 'Low tracking shot alongside a small group of runners crossing a steel bridge over a river at dawn, city skyline in soft mist behind them, breath visible in the cold air, warm sunrise light, cinematic.', ratio: '9:16', model: KLING_ID },
  },
  {
    id: 'clay-to-cup',
    group: 'pictures',
    kind: 'carousel',
    brand: { name: 'Kiln & Co', handle: 'kilnandco', trade: 'Ceramics studio' },
    title: 'Clay to cup, in five slides',
    brief: 'A carousel showing how one of our cups is made, from wedging the clay to the final firing. Weekend wheel classes are open for booking.',
    shots: [
      shot('clay-wedge', 2048, 2048, '#342d25', 'Hands wedging a block of grey clay on a canvas workbench'),
      shot('clay-throw', 2048, 2048, '#352414', 'Wet hands shaping a small cup on a spinning potter’s wheel'),
      shot('clay-trim', 2048, 2048, '#422f1e', 'Trimming the foot of a leather-hard cup with a loop tool'),
      shot('clay-glaze', 2048, 2048, '#3a3530', 'A bisque cup dipped in cream glaze, dripping from the rim'),
      shot('clay-shelf', 2048, 2048, '#3f3932', 'A row of finished speckled cups on a shelf by a window'),
    ],
    versions: [
      {
        platform: 'instagram',
        text: 'Watch our cup come to life, step by step!\n\n1️⃣ Wedging the clay – getting that perfect, even body.\n2️⃣ Shaping on the wheel – turning a lump into a sleek silhouette.\n3️⃣ Trimming & detailing – adding that personal touch.\n4️⃣ Glazing – a splash of color and shine.\n5️⃣ Final firing – where the magic locks in forever.\n\nFeel the process? 🎨✨ Our weekend wheel classes are now open for booking—perfect time to try your hand at the wheel and create your own pieces. Tap the link in our bio or visit [link] to reserve your spot!\n\n#pottery #handmade #ceramics #wheelclass #craftsmanship #creativelife',
      },
    ],
    made: [
      { did: 'Made five slides, 1:1', model: SOUL },
      { did: 'Wrote the caption', model: WRITER },
    ],
    make: { tool: 'image', prompt: 'A potter\'s wet hands shaping a small cup on a spinning wheel, slip on the fingers, motion in the clay, warm studio light, close-up documentary photography.' + CLEAN, ratio: '1:1', model: SOUL_ID },
  },
  {
    id: 'month-end',
    group: 'words',
    kind: 'post',
    brand: { name: 'Ledgerly', handle: 'ledgerly', trade: 'Finance software' },
    title: 'A case study, ready for LinkedIn',
    brief: 'Case study: a 40-person design agency used Ledgerly to cut their month-end close from nine days to three. The main change: receipts are matched automatically as they come in, so nothing piles up at the end of the month.',
    versions: [
      {
        platform: 'linkedin',
        text: 'Case Study: How a 40‑person design agency streamlined its finance workflow with Ledgerly\n\nThe agency struggled with a month‑end close that routinely took nine days. The bottleneck? Receipts piled up, requiring manual matching and endless follow‑ups.\n\nAfter implementing Ledgerly, every receipt is captured and matched automatically as it arrives. The result? The month‑end close dropped from nine days to just three, freeing up time for the team to focus on design work and strategic initiatives.\n\nKey benefits:\n- Real‑time receipt matching eliminates end‑of‑month backlogs\n- Faster close cycles improve cash visibility and forecasting\n- Reduced manual effort cuts operational costs\n\nLedgerly’s automation turned a time‑intensive process into a seamless, near‑instant workflow, demonstrating how smart finance tools can boost efficiency across creative businesses.\n\n#FinanceAutomation #DesignIndustry #Efficiency #Ledgerly',
      },
    ],
    made: [{ did: 'Wrote the post for LinkedIn', model: WRITER }],
    make: { tool: 'composer', brief: 'Case study: a 40-person design agency used Ledgerly to cut their month-end close from nine days to three. The main change: receipts are matched automatically as they come in, so nothing piles up at the end of the month.', tone: 'professional', platforms: ['linkedin'] },
  },
  {
    id: 'cold-brew',
    group: 'pictures',
    kind: 'picture',
    brand: { name: 'Low Tide Coffee', handle: 'lowtidecoffee', trade: 'Roaster and café' },
    title: 'Golden hour on the harbour wall',
    brief: 'Cold brew season isn’t over until we say it is. Steeped for 18 hours, poured over ice, best drunk sitting on the harbour wall.',
    prompt: 'A tall glass of iced cold brew coffee standing on a weathered stone harbour wall at golden hour, condensation on the glass, fishing boats softly out of focus behind, warm 35mm film photograph.' + CLEAN,
    shots: [shot('cold-brew', 1344, 2016, '#261b0f', 'A glass of iced cold brew on a stone harbour wall at golden hour, boats behind')],
    versions: [{ platform: 'instagram', text: 'Cold brew season isn’t over until we say it is ☕❄️ Steeped for 18 hours, poured over ice and sipped on the harbour wall 🌊🧊 #ColdBrew #HarbourVibes #SummerSip' }],
    made: [
      { did: 'Made the picture, 2:3', model: SOUL },
      { did: 'Wrote the caption', model: WRITER },
    ],
    make: { tool: 'image', prompt: 'A tall glass of iced cold brew coffee standing on a weathered stone harbour wall at golden hour, condensation on the glass, fishing boats softly out of focus behind, warm 35mm film photograph.' + CLEAN, ratio: '2:3', model: SOUL_ID },
  },
  {
    id: 'friday-specials',
    group: 'automations',
    kind: 'flow',
    brand: { name: 'Osteria Nove', handle: 'osterianove', trade: 'Restaurant' },
    title: 'Friday specials, written at four',
    brief: 'Every Friday at 4pm, write tonight’s specials post for Instagram and score how well it fits our voice. If it scores under 7, rewrite it. Then wait for my approval and post it in the next free slot.',
    flow: {
      name: 'Friday Specials Post',
      steps: [
        { id: 'schedule', type: 'trigger.schedule', label: 'Every Friday', detail: 'at 16:00', lane: 1, row: 0 },
        { id: 'write', type: 'ai.write', label: 'Write a post', detail: 'Tonight’s specials post', lane: 1, row: 1 },
        { id: 'score', type: 'ai.score', label: 'Score it', detail: 'Fit to brand voice', lane: 1, row: 2 },
        { id: 'check', type: 'logic.if', label: 'If', detail: 'score ≤ 7', lane: 1, row: 3 },
        { id: 'rewrite', type: 'ai.rewrite', label: 'Rewrite', detail: 'Match the brand voice better', lane: 0, row: 4 },
        { id: 'approve_low', type: 'human.approve', label: 'Approve', detail: 'the revised post', lane: 0, row: 5 },
        { id: 'post_low', type: 'action.post', label: 'Post', detail: 'next free slot', lane: 0, row: 6 },
        { id: 'approve_good', type: 'human.approve', label: 'Approve', detail: 'the post', lane: 2, row: 4 },
        { id: 'post_good', type: 'action.post', label: 'Post', detail: 'next free slot', lane: 2, row: 5 },
      ],
      links: [
        { from: 'schedule', to: 'write', port: 'next' },
        { from: 'write', to: 'score', port: 'next' },
        { from: 'score', to: 'check', port: 'next' },
        { from: 'check', to: 'rewrite', port: 'yes' },
        { from: 'rewrite', to: 'approve_low', port: 'next' },
        { from: 'approve_low', to: 'post_low', port: 'approved' },
        { from: 'check', to: 'approve_good', port: 'no' },
        { from: 'approve_good', to: 'post_good', port: 'approved' },
      ],
    },
    made: [
      { did: 'Turned the sentence into a nine-step flow', model: WRITER },
      { did: 'Put your approval in front of every post', model: 'Flows' },
    ],
    make: { tool: 'flows', say: 'Every Friday at 4pm, write tonight’s specials post for Instagram and score how well it fits our voice. If it scores under 7, rewrite it. Then wait for my approval and post it in the next free slot.' },
  },
  {
    id: 'pappardelle',
    group: 'pictures',
    kind: 'picture',
    brand: { name: 'Osteria Nove', handle: 'osterianove', trade: 'Restaurant' },
    title: 'Tonight’s special, shot and captioned',
    brief: 'Tonight’s special: hand-rolled pappardelle with a ragù that has been cooking since this morning. Only as many plates as the dough allows.',
    prompt:
      'Overhead photograph of a white bowl of pappardelle: long, wide, flat ribbons of hand-cut egg pasta, loosely twirled with a slow-cooked meat ragù and a little grated parmesan, on rumpled linen, a glass of red wine at the edge of the frame, natural window light, Italian trattoria.' +
      CLEAN,
    shots: [shot('pappardelle', 2048, 2048, '#41392e', 'Overhead, a white bowl of pappardelle with ragù on linen, a glass of red wine beside it')],
    versions: [
      {
        platform: 'instagram',
        text: 'Tonight’s special is a true labor‑of‑love: hand‑rolled pappardelle tossed with a ragù that’s been simmering since sunrise. 🍝✨ The sauce has had the whole day to develop deep, comforting flavors, and the fresh pasta is rolled to the perfect bite. Because we make every strand by hand, we can only serve as many plates as the dough allows – so grab yours while they last!\n\nCome taste the patience and passion in every forkful.\n\n#pappardelle #ragù #handmadepasta #foodie #dinnertime #freshflavors #limitededition #chefsguide',
      },
    ],
    made: [
      { did: 'Made the picture, 1:1', model: SOUL },
      { did: 'Wrote the caption', model: WRITER },
    ],
    make: {
      tool: 'image',
      prompt:
        'Overhead photograph of a white bowl of pappardelle: long, wide, flat ribbons of hand-cut egg pasta, loosely twirled with a slow-cooked meat ragù and a little grated parmesan, on rumpled linen, a glass of red wine at the edge of the frame, natural window light, Italian trattoria.' +
        CLEAN,
      ratio: '1:1',
      model: SOUL_ID,
    },
  },
  {
    id: 'short-novels',
    group: 'words',
    kind: 'post',
    brand: { name: 'Margins Books', handle: 'marginsbooks', trade: 'Bookshop' },
    title: 'Back into reading, in one post',
    brief: 'For people who stopped reading: our staff picked novels under 200 pages that will get you back into it. They are on the short-novel table by the door all month.',
    versions: [
      {
        platform: 'x',
        text: '📚 Stuck in a reading slump? Our crew hand‑picked snappy novels under 200 pages to pull you back in! Grab one from the Short‑Novel table by the door—open all month long. #QuickReads #BookLove',
      },
    ],
    made: [{ did: 'Wrote the post for X', model: WRITER }],
    make: { tool: 'composer', brief: 'For people who stopped reading: our staff picked novels under 200 pages that will get you back into it. They are on the short-novel table by the door all month.', tone: 'playful', platforms: ['x'] },
  },
  {
    id: 'the-pour',
    group: 'motion',
    kind: 'reel',
    brand: { name: 'Low Tide Coffee', handle: 'lowtidecoffee', trade: 'Roaster and café' },
    title: 'The pour, in slow motion',
    brief: 'The pour, in slow motion: our cold brew going over ice on the harbour wall. It stays on the menu all autumn.',
    prompt: 'Slow-motion close-up of cold brew coffee being poured over ice in a tall glass on a stone harbour wall at golden hour, swirls of coffee through the ice, boats softly out of focus behind, cinematic.',
    shots: [shot('the-pour', 720, 1280, '#4e4844', 'Cold brew poured over ice in a tall glass on a harbour wall')],
    video: { src: '/showcase/the-pour.mp4', seconds: 5 },
    versions: [
      { platform: 'instagram', text: 'Watch the magic cascade 🌊❄️ Our cold brew swoops over ice on the harbour wall in slo‑mo glory. 🍂 It’s hanging out on the menu all autumn long—so sip, savor, and let the waves roll. #ColdBrew #HarbourVibes #AutumnSip' },
      { platform: 'tiktok', text: 'Watch the magic unfold 🌊☕️ Slow‑motion pour of our icy cold brew cascading over the harbour wall. It’s the perfect autumn vibe and it’s staying on the menu all season! #ColdBrew #AutumnSips #HarbourVibes' },
    ],
    made: [
      { did: 'Filmed the clip, 9:16, 5 seconds', model: KLING },
      { did: 'Wrote the Instagram and TikTok captions', model: WRITER },
    ],
    make: { tool: 'video', prompt: 'Slow-motion close-up of cold brew coffee being poured over ice in a tall glass on a stone harbour wall at golden hour, swirls of coffee through the ice, boats softly out of focus behind, cinematic.', ratio: '9:16', model: KLING_ID },
  },
  {
    id: 'morning-serum',
    group: 'automations',
    kind: 'campaign',
    brand: { name: 'Dew Theory', handle: 'dewtheory', trade: 'Skincare' },
    title: 'A launch week, planned from the brief',
    brief: 'A serum gentle enough for every morning: niacinamide and green tea, nothing that stings.',
    fields: [
      ['Goal', 'Launch Morning Serum, our first serum, and get people to try the sample size.'],
      ['Audience', 'People with sensitive skin who have been burned by harsh actives.'],
      ['Key facts', 'Niacinamide 4% and green tea extract. Fragrance-free. 30 ml bottle and a 7 ml sample size. Launches Monday.'],
    ],
    prompt: 'A frosted glass serum bottle with a dropper standing on wet dark stone, morning dew droplets, soft green light filtering through leaves, calm luxury skincare product photography.' + CLEAN,
    shots: [shot('dew-serum', 1536, 2048, '#242e1d', 'A frosted serum bottle on wet dark stone in soft green light')],
    plan: {
      idea: 'Gentle mornings start with a calm serum',
      pillars: [
        { name: 'Ingredient Transparency', why: 'Explain the soothing benefits of niacinamide and green tea, and the fragrance‑free formula.' },
        { name: 'Try the Sample', why: 'Encourage low‑risk trial with the 7 ml sample size.' },
        { name: 'Morning Routine Simplicity', why: 'Show how the serum fits effortlessly into a calm AM skincare routine for sensitive skin.' },
      ],
      posts: [
        { title: 'Morning Calm in a Bottle', pillar: 'Ingredient Transparency', format: 'image', hook: 'Gentle power, no sting.', message: 'Our serum blends 4% niacinamide with green tea, fragrance‑free.' },
        { title: 'Three Simple Steps', pillar: 'Morning Routine Simplicity', format: 'carousel', hook: 'Start your day with calm.', message: 'Add the serum to your AM routine, it soothes without irritation.' },
        { title: 'Feel the Calm', pillar: 'Ingredient Transparency', format: 'video', hook: 'Watch the serum melt in.', message: 'A fluid blend of niacinamide and green tea that absorbs gently.' },
        { title: 'Free Sample Inside', pillar: 'Try the Sample', format: 'text', hook: 'A tiny bottle, big relief.', message: 'Grab the 7 ml sample and test gentle care today.' },
        { title: 'Green Tea Calm', pillar: 'Morning Routine Simplicity', format: 'image', hook: 'Nature’s whisper for your skin.', message: 'Green tea extract comforts sensitive skin each morning.' },
      ],
    },
    made: [
      { did: 'Planned the big idea, three pillars and five posts', model: WRITER },
      { did: 'Made the launch picture, 3:4', model: SOUL },
    ],
    make: { tool: 'campaigns' },
  },
  {
    id: 'friday-stems',
    group: 'pictures',
    kind: 'picture',
    brand: { name: 'Wild Stem', handle: 'wildstemflowers', trade: 'Florist' },
    title: 'The Friday flower drop',
    brief: 'Friday flower drop: loose seasonal bouquets wrapped in paper, delivered by bike around the neighbourhood. Order by noon on Thursday.',
    prompt: 'A loose bouquet of garden roses, ranunculus and wild grasses wrapped in brown paper in the front basket of a bicycle, cobblestone street, soft overcast light, lifestyle photography.' + CLEAN,
    shots: [shot('friday-stems', 1536, 2048, '#3d3728', 'A paper-wrapped bouquet of roses and ranunculus in a bicycle basket on cobblestones')],
    versions: [
      {
        platform: 'instagram',
        text: 'Friday flower drop is here! 🌼✨ We’re handing out loose, seasonal bouquets wrapped in paper, delivered by bike right around the neighbourhood. Fresh, local, and ready to brighten your day.\n\nOrder yours by noon on Thursday to make sure you get a spot in the drop. Just tap the link in our bio or DM us to reserve your bouquet.\n\nLet the flowers roll in! 🚲💐 #FridayFlowers #LocalBlooms #BikeDelivery',
      },
    ],
    made: [
      { did: 'Made the picture, 3:4', model: SOUL },
      { did: 'Wrote the caption', model: WRITER },
    ],
    make: { tool: 'image', prompt: 'A loose bouquet of garden roses, ranunculus and wild grasses wrapped in brown paper in the front basket of a bicycle, cobblestone street, soft overcast light, lifestyle photography.' + CLEAN, ratio: '3:4', model: SOUL_ID },
  },
]

export const GROUPS: Array<{ id: Group | 'all'; label: string }> = [
  { id: 'all', label: 'Everything' },
  { id: 'words', label: 'Words' },
  { id: 'pictures', label: 'Pictures' },
  { id: 'motion', label: 'Motion' },
  { id: 'automations', label: 'Automations' },
]

export const KIND_LABEL: Record<Kind, string> = {
  post: 'Post',
  picture: 'Picture',
  carousel: 'Carousel',
  reel: 'Reel',
  flow: 'Flow',
  campaign: 'Campaign',
}

/** What the case's own line says when it is about to be made again. */
export const MAKE_LABEL: Record<Make['tool'], string> = {
  composer: 'Write one like it',
  image: 'Make a picture like it',
  video: 'Film one like it',
  flows: 'Build this flow',
  campaigns: 'Plan a campaign',
}

/** The studio page that makes another like it, with the brief, prompt or sentence filled in. */
export function makePath(make: Make) {
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString()
  switch (make.tool) {
    case 'composer':
      return `/dashboard/create?${q({ brief: make.brief, tone: make.tone, platforms: make.platforms.join(',') })}`
    case 'image':
    case 'video':
      return `/dashboard/studio?${q({ tab: make.tool, prompt: make.prompt, ratio: make.ratio, model: make.model })}`
    case 'flows':
      return `/dashboard/flows?${q({ say: make.say })}`
    case 'campaigns':
      return '/dashboard/campaigns'
  }
}

export const caseById = (id: string | null) => CASES.find((c) => c.id === id) ?? null

/** The picture a case is shown by: its first shot (a clip's poster frame). */
export const cover = (c: Case) => c.shots?.[0] ?? null

/** Shots come in two sizes: the full one for the viewer, -sm for cards. */
export const src = (s: Shot, size: 'sm' | 'full' = 'full') => `${s.src}${size === 'sm' ? '-sm' : ''}.webp`

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

/** The picture or clip prompt a case can be remade from, and the shape it was made in. */
export function promptOf(c: Case): { prompt: string; ratio: string; model: string } | null {
  if (c.make.tool === 'image' || c.make.tool === 'video') return { prompt: c.make.prompt, ratio: c.make.ratio, model: c.make.model }
  const s = c.shots?.[0]
  if (!c.prompt || !s) return null
  const g = gcd(s.w, s.h)
  return { prompt: c.prompt, ratio: `${s.w / g}:${s.h / g}`, model: c.video ? KLING_ID : SOUL_ID }
}
