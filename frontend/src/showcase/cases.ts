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
/** One network's post, and the studio model that wrote it. */
export type Version = { platform: PlatformId; text: string; model?: string }
/** A brand's voice as an account profile holds it: what the writer is told before every post. */
export type Voice = Partial<Record<'tone' | 'style' | 'do' | 'avoid' | 'hashtags', string>>

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
  | { tool: 'composer'; brief: string; tone: Tone; platforms: PlatformId[]; model?: string }
  | { tool: 'image' | 'video'; prompt: string; ratio: string; model: string }
  | { tool: 'flows'; say: string }
  | { tool: 'campaigns' }

export type Case = {
  id: string
  group: Group
  kind: Kind
  brand: { name: string; handle: string; trade: string; voice?: Voice }
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
const KIMI = 'Kimi K3'
const GLM = 'GLM 5.3'
const DEEPSEEK = 'DeepSeek V4 Pro'
/** The studio's ids for the models the pictures and clips were made with. */
const SOUL_ID = 'higgsfield/soul-v2'
const MODEL_ID = { [KIMI]: 'ollama_cloud/kimi-k3', [GLM]: 'ollama_cloud/glm-5.3', [DEEPSEEK]: 'ollama_cloud/deepseek-v4-pro:0813' }
const KLING_ID = 'higgsfield/kling-3-pro'
const SOUL = 'Higgsfield Soul 2'
const KLING = 'Kling 3 Pro'
const CLEAN = ' No text, no lettering, no logos.'

/** The demo brands, each with the voice its account profile gives the writer. */
const BRANDS = {
  maisoncire: { name: "Maison Cire", handle: "maisoncire", trade: "Candle maker", voice: { tone: "Quiet, sensory and unhurried, like a perfumer's notebook.", style: "Short sentences. Concrete smells, textures and light. One idea per line.", do: "Name the scent notes. Say that every candle is poured by hand in small batches.", avoid: "Exclamation marks. The words cozy, vibe, treat yourself and must-have. More than one emoji.", hashtags: "Two at most, lowercase." } },
  lowtidecoffee: { name: "Low Tide Coffee", handle: "lowtidecoffee", trade: "Roaster and café", voice: { tone: "Dry, local and a little cheeky, like the person behind the counter who already knows your order.", style: "Short. One joke at most. Talks about the harbour and the weather like a neighbour would.", avoid: "Exclamation marks, vibes, strings of emoji.", hashtags: "Two at most." } },
  kilnandco: { name: "Kiln & Co", handle: "kilnandco", trade: "Ceramics studio", voice: { tone: "Warm, proud of the craft, precise about the process.", style: "Plain words a beginner would understand. Calm, never salesy.", do: "Use the potter's real terms (wedging, throwing, trimming, glazing, firing) and say in a few words what each one does.", avoid: "Magic, journey, labor of love, exclamation marks, numbered emoji.", hashtags: "Three at most, at the very end." } },
  northlineruns: { name: "Northline Run Club", handle: "northlineruns", trade: "Running club", voice: { tone: "Bold, short and rhythmic. Welcoming to every pace.", style: "Short lines in the present tense. One line in capitals is fine.", do: "Make the day, time and place impossible to miss. Make a first-timer feel expected.", avoid: "Gym clichés: beast mode, crush it, no excuses, grind.", hashtags: "Two at most." } },
  ledgerly: { name: "Ledgerly", handle: "ledgerly", trade: "Finance software", voice: { tone: "Plain-spoken and specific, like a finance lead talking to a peer. Never a brochure.", style: "Open with the result. Short paragraphs that tell it as a story: before, the one change, after.", do: "Keep the customer's numbers exactly as given.", avoid: "Streamline, seamless, leverage, game-changer, unlock, bullet lists, a 'key benefits' section, emoji.", hashtags: "One at most." } },
  marginsbooks: { name: "Margins Books", handle: "marginsbooks", trade: "Bookshop", voice: { tone: "Wry and bookish, gently funny, never smug.", style: "One clean joke, then the practical part.", avoid: "Bookworm, reading slump, exclamation marks, more than one emoji.", hashtags: "None." } },
  osterianove: { name: "Osteria Nove", handle: "osterianove", trade: "Restaurant", voice: { tone: "A warm Italian host: simple, generous, appetite first.", style: "Short. Describe the dish as if you were setting it down at the table.", avoid: "Foodie, labor of love, mouthwatering, exclamation marks, long hashtag lists.", hashtags: "Two at most." } },
  wildstemflowers: { name: "Wild Stem", handle: "wildstemflowers", trade: "Florist", voice: { tone: "Light, seasonal and specific.", style: "Name the flowers. Put the practical details (how to order, the deadline) on their own line at the end.", avoid: "Brighten your day, exclamation marks, more than two emoji.", hashtags: "Two at most." } },
  dewtheory: { name: 'Dew Theory', handle: 'dewtheory', trade: 'Skincare', voice: { tone: 'Calm, precise, quietly confident. Short sentences.', avoid: 'Miracle claims, before-and-after promises.' } },
} satisfies Record<string, Case['brand']>

const shot = (name: string, w: number, h: number, tone: string, alt: string): Shot => ({ src: `/showcase/${name}`, w, h, tone, alt })

export const CASES: Case[] = [
  {
    id: 'ember-fig',
    group: 'words',
    kind: 'post',
    brand: BRANDS.maisoncire,
    title: 'One brief, three networks',
    brief: "Our autumn candle Ember & Fig is back for six weeks only. Smoky fig, cedar and a little black pepper. Hand-poured in small batches.",
    prompt:
      'Amber glass candle burning on a dark walnut table, ripe split figs and a sprig of cedar beside it, a thin curl of smoke, low warm window light, shallow depth of field, editorial still life photography, muted autumn palette.' +
      CLEAN,
    shots: [shot('ember-fig', 1536, 2048, '#1a110d', 'A lit amber candle on a walnut table beside split figs and a sprig of cedar')],
    versions: [
      { platform: 'instagram', model: KIMI, text: "Ember & Fig is back.\n\nIt comes home each autumn, and it slips away again. Six weeks only.\n\nFig ripened into smoke. Cedar, dry and warm. A whisper of black pepper at the edges.\n\nEvery candle is poured by hand in small batches.\n\n#emberandfig #maisoncire" },
      { platform: 'x', model: KIMI, text: "Ember & Fig is back.\n\nSmoky fig. Cedar. A little black pepper.\n\nIt smells like woodsmoke drifting through the orchard at dusk.\n\nSix weeks, then it rests again.\n\nEvery candle is poured by hand in small batches.\n\n#emberandfig #autumn" },
      { platform: 'linkedin', model: KIMI, text: "Ember & Fig is back.\n\nSmoky fig, dark and soft.\nCedar, dry as old wood.\nA little black pepper at the edge.\n\nIt smells like late October. Lamplight against a grey afternoon.\n\nEvery candle is poured by hand in small batches.\n\nSix weeks only. Then it rests until next year.\n\nIt is good to have it back on the bench.\n\n#maisoncire #emberandfig" },
    ],
    made: [
      { did: 'Wrote a version for each network, in the brand’s voice', model: KIMI },
      { did: 'Made the picture, 3:4', model: SOUL },
    ],
    make: { tool: 'composer', model: MODEL_ID[KIMI], brief: "Our autumn candle Ember & Fig is back for six weeks only. Smoky fig, cedar and a little black pepper. Hand-poured in small batches.", tone: 'friendly', platforms: ['instagram', 'x', 'linkedin'] },
  },
  {
    id: 'dawn-miles',
    group: 'motion',
    kind: 'reel',
    brand: BRANDS.northlineruns,
    title: 'A sunrise reel from one sentence',
    brief: "Every Saturday at 6:30 in the morning we run the river bridges. All paces, nobody gets left behind. Show up once and you’ll be back.",
    prompt: 'Low tracking shot alongside a small group of runners crossing a steel bridge over a river at dawn, city skyline in soft mist behind them, breath visible in the cold air, warm sunrise light, cinematic.',
    shots: [shot('dawn-miles', 720, 1280, '#554f48', 'Runners silhouetted crossing a steel truss bridge at sunrise')],
    video: { src: '/showcase/dawn-miles.mp4', seconds: 5 },
    versions: [
      { platform: 'tiktok', model: KIMI, text: "Saturday. 6:30 AM. The river bridges.\n\nWe run. Every pace. Nobody left behind.\n\nNever run with us before? You're already expected.\n\nSHOW UP ONCE. YOU'LL BE BACK.\n\n#RunClub #NorthlineRuns" },
      { platform: 'instagram', model: KIMI, text: "Saturday. 6:30 AM. The river bridges.\n\nEvery week. Every bridge. Every pace.\nFast, slow, brand new — it all counts out here.\n\nNobody gets dropped. Nobody runs alone.\nThat's the deal.\n\nFIRST TIME? GOOD. WE'RE EXPECTING YOU.\n\nShow up once. You'll be back.\n\n#NorthlineRunClub #RiverBridgeRuns" },
    ],
    made: [
      { did: 'Filmed the clip, 9:16, 5 seconds', model: KLING },
      { did: 'Wrote the TikTok and Instagram captions in the brand’s voice', model: KIMI },
    ],
    make: { tool: 'video', prompt: 'Low tracking shot alongside a small group of runners crossing a steel bridge over a river at dawn, city skyline in soft mist behind them, breath visible in the cold air, warm sunrise light, cinematic.', ratio: '9:16', model: KLING_ID },
  },
  {
    id: 'clay-to-cup',
    group: 'pictures',
    kind: 'carousel',
    brand: BRANDS.kilnandco,
    title: 'Clay to cup, in five slides',
    brief: "A five-slide carousel on how one of our cups is made: wedging the clay, throwing it on the wheel, trimming the foot, dipping it in glaze, and the finished cups after the last firing. Weekend wheel classes are open for booking.",
    shots: [
      shot('clay-wedge', 2048, 2048, '#342d25', 'Hands wedging a block of grey clay on a canvas workbench'),
      shot('clay-throw', 2048, 2048, '#352414', 'Wet hands shaping a small cup on a spinning potter’s wheel'),
      shot('clay-trim', 2048, 2048, '#422f1e', 'Trimming the foot of a leather-hard cup with a loop tool'),
      shot('clay-glaze', 2048, 2048, '#3a3530', 'A bisque cup dipped in cream glaze, dripping from the rim'),
      shot('clay-shelf', 2048, 2048, '#3f3932', 'A row of finished speckled cups on a shelf by a window'),
    ],
    versions: [
      { platform: 'instagram', model: GLM, text: "Every cup we make starts the same way: a heavy lump of clay with no shape in it yet.\n\nSwipe through to follow one from there.\n\nWedging. We knead the clay to push out any trapped air, so it won't crack in the kiln later.\n\nThrowing. On the spinning wheel, the clay is drawn up and hollowed out until it becomes a cup.\n\nTrimming. Once it's dried firm, a loop tool shaves off the extra clay and cuts in the foot ring the cup stands on.\n\nGlazing. A quick dip in the glaze bucket gives the cup its color and the glassy coat that keeps your coffee in the cup.\n\nFiring. Hours of kiln heat turn fragile clay into ceramic and melt the glaze into glass. The cups in the last slide have just come out, cooled and ready for the shelf.\n\nNo shortcuts in there. Just clay, water, heat and patience.\n\nIf you'd like to feel how the clay moves under your own hands, our weekend wheel classes are open for booking. You'll start with your own lump at the wedging table.\n\n#pottery #wheelthrown #ceramics" },
    ],
    made: [
      { did: 'Made five slides, 1:1', model: SOUL },
      { did: 'Wrote the caption in the brand’s voice', model: GLM },
    ],
    make: { tool: 'image', prompt: 'A potter\'s wet hands shaping a small cup on a spinning wheel, slip on the fingers, motion in the clay, warm studio light, close-up documentary photography.' + CLEAN, ratio: '1:1', model: SOUL_ID },
  },
  {
    id: 'month-end',
    group: 'words',
    kind: 'post',
    brand: BRANDS.ledgerly,
    title: 'A case study, ready for LinkedIn',
    brief: "Case study: a 40-person design agency used Ledgerly to cut their month-end close from nine days to three. The main change: receipts are matched automatically as they come in, so nothing piles up at the end of the month.",
    versions: [
      { platform: 'linkedin', model: KIMI, text: "A 40-person design agency now closes the month in three days. It used to take nine.\n\nThe work itself never changed. What changed is when it happens. Receipts used to come in all month and wait. The matching started at month-end, so every close opened with a backlog, and the close ran to nine days.\n\nWith Ledgerly, receipts are matched automatically as they come in. Nothing piles up waiting for the end of the month.\n\nThree days instead of nine. The team isn't working faster. There's just less left to do when the close starts.\n\n#Accounting" },
    ],
    made: [{ did: 'Wrote the LinkedIn post in the brand’s voice', model: KIMI }],
    make: { tool: 'composer', model: MODEL_ID[KIMI], brief: "Case study: a 40-person design agency used Ledgerly to cut their month-end close from nine days to three. The main change: receipts are matched automatically as they come in, so nothing piles up at the end of the month.", tone: 'professional', platforms: ['linkedin'] },
  },
  {
    id: 'cold-brew',
    group: 'pictures',
    kind: 'picture',
    brand: BRANDS.lowtidecoffee,
    title: 'Golden hour on the harbour wall',
    brief: "Cold brew season isn’t over until we say it is. Steeped for 18 hours, poured over ice, best drunk sitting on the harbour wall.",
    prompt: 'A tall glass of iced cold brew coffee standing on a weathered stone harbour wall at golden hour, condensation on the glass, fishing boats softly out of focus behind, warm 35mm film photograph.' + CLEAN,
    shots: [shot('cold-brew', 1344, 2016, '#261b0f', 'A glass of iced cold brew on a stone harbour wall at golden hour, boats behind')],
    versions: [
      { platform: 'instagram', model: KIMI, text: "Cold brew season ends when we say it ends. Not before.\n\nEighteen hours of steeping, poured over ice, best consumed on the harbour wall pretending it's still summer. The gulls don't judge. Neither do we.\n\nCome get one before the weather files a complaint.\n\n#lowtidecoffee #coldbrew" },
    ],
    made: [
      { did: 'Made the picture, 2:3', model: SOUL },
      { did: 'Wrote the caption in the brand’s voice', model: KIMI },
    ],
    make: { tool: 'image', prompt: 'A tall glass of iced cold brew coffee standing on a weathered stone harbour wall at golden hour, condensation on the glass, fishing boats softly out of focus behind, warm 35mm film photograph.' + CLEAN, ratio: '2:3', model: SOUL_ID },
  },
  {
    id: 'friday-specials',
    group: 'automations',
    kind: 'flow',
    brand: BRANDS.osterianove,
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
    brand: BRANDS.osterianove,
    title: 'Tonight’s special, shot and captioned',
    brief: "Tonight’s special: hand-rolled pappardelle with a ragù that has been cooking since this morning. Only as many plates as the dough allows.",
    prompt:
      'Overhead photograph of a white bowl of pappardelle: long, wide, flat ribbons of hand-cut egg pasta, loosely twirled with a slow-cooked meat ragù and a little grated parmesan, on rumpled linen, a glass of red wine at the edge of the frame, natural window light, Italian trattoria.' +
      CLEAN,
    shots: [shot('pappardelle', 2048, 2048, '#41392e', 'Overhead, a white bowl of pappardelle with ragù on linen, a glass of red wine beside it')],
    versions: [
      { platform: 'instagram', model: DEEPSEEK, text: "Hand-rolled pappardelle, wide and tender, folded into a ragù that’s been simmering since this morning. We made only as much as the dough would give us, so when it’s finished, that’s it for tonight." },
    ],
    made: [
      { did: 'Made the picture, 1:1', model: SOUL },
      { did: 'Wrote the caption in the brand’s voice', model: DEEPSEEK },
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
    brand: BRANDS.marginsbooks,
    title: 'Back into reading, in one post',
    brief: "For people who stopped reading: our staff picked novels under 200 pages that will get you back into it. They are on the short-novel table by the door all month.",
    versions: [
      { platform: 'x', model: GLM, text: "A bookmark that hasn't moved in months is just a tiny monument to good intentions. Our staff picked short novels under 200 pages to change that. They're on the short-novel table by the door all month. 📚" },
    ],
    made: [{ did: 'Wrote the post for X in the brand’s voice', model: GLM }],
    make: { tool: 'composer', model: MODEL_ID[GLM], brief: "For people who stopped reading: our staff picked novels under 200 pages that will get you back into it. They are on the short-novel table by the door all month.", tone: 'playful', platforms: ['x'] },
  },
  {
    id: 'the-pour',
    group: 'motion',
    kind: 'reel',
    brand: BRANDS.lowtidecoffee,
    title: 'The pour, in slow motion',
    brief: "The pour, in slow motion: our cold brew going over ice on the harbour wall. It stays on the menu all autumn.",
    prompt: 'Slow-motion close-up of cold brew coffee being poured over ice in a tall glass on a stone harbour wall at golden hour, swirls of coffee through the ice, boats softly out of focus behind, cinematic.',
    shots: [shot('the-pour', 720, 1280, '#4e4844', 'Cold brew poured over ice in a tall glass on a harbour wall')],
    video: { src: '/showcase/the-pour.mp4', seconds: 5 },
    versions: [
      { platform: 'instagram', model: DEEPSEEK, text: "Slow pour for people who still wear shorts in October. Cold brew, harbour wall, no plans to take it off the menu. #coldbrew #harbourweather" },
      { platform: 'tiktok', model: DEEPSEEK, text: "Cold brew over ice on the harbour wall, slowed down so you can watch the weather change its mind. It’s on the menu all autumn, same as the wind. #coldbrew #harbourwall" },
    ],
    made: [
      { did: 'Filmed the clip, 9:16, 5 seconds', model: KLING },
      { did: 'Wrote the Instagram and TikTok captions in the brand’s voice', model: DEEPSEEK },
    ],
    make: { tool: 'video', prompt: 'Slow-motion close-up of cold brew coffee being poured over ice in a tall glass on a stone harbour wall at golden hour, swirls of coffee through the ice, boats softly out of focus behind, cinematic.', ratio: '9:16', model: KLING_ID },
  },
  {
    id: 'morning-serum',
    group: 'automations',
    kind: 'campaign',
    brand: BRANDS.dewtheory,
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
    brand: BRANDS.wildstemflowers,
    title: 'The Friday flower drop',
    brief: "Friday flower drop: loose bouquets of garden roses, ranunculus and wild grasses, wrapped in paper and delivered by bike around the neighbourhood. Order by noon on Thursday.",
    prompt: 'A loose bouquet of garden roses, ranunculus and wild grasses wrapped in brown paper in the front basket of a bicycle, cobblestone street, soft overcast light, lifestyle photography.' + CLEAN,
    shots: [shot('friday-stems', 1536, 2048, '#3d3728', 'A paper-wrapped bouquet of roses and ranunculus in a bicycle basket on cobblestones')],
    versions: [
      { platform: 'instagram', model: KIMI, text: "Friday's drop is garden roses, ranunculus and wild grasses, tied loose and wrapped in paper. The kind that spill sideways out of a jug.\n\nWe'll be out on the bikes delivering them around the neighbourhood. 🌿\n\nOrder by noon on Thursday.\n\n#fridayflowers #gardenroses" },
    ],
    made: [
      { did: 'Made the picture, 3:4', model: SOUL },
      { did: 'Wrote the caption in the brand’s voice', model: KIMI },
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

export const VOICE_LABEL: Record<keyof Voice, string> = { tone: 'Tone', style: 'Style', do: 'Always', avoid: 'Never', hashtags: 'Hashtags' }

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
      return `/dashboard/create?${q({ brief: make.brief, tone: make.tone, platforms: make.platforms.join(','), ...(make.model ? { model: make.model } : {}) })}`
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
