import { BRANDS } from './cases'
import type { LabExample } from './lab'

/* Made by gen-lab-examples.py from the runs; the words and files are what the nodes made. */

export const LAB_EXAMPLES: Record<string, LabExample> = {
  "picture-models": {
    brand: BRANDS.lowtidecoffee,
    key: "picture-models",
    look: "panes",
    platform: "instagram",
    given: "One prompt: a tall glass of iced cold brew on a weathered harbour wall at golden hour, boats out of focus behind, 35mm film.",
    made: [
      {
        kind: "image",
        src: "/showcase/lab/picture-models/model-a.webp",
        sm: "/showcase/lab/picture-models/model-a-sm.webp",
        w: 896,
        h: 1152,
        tone: "#807b6f",
        alt: "Iced cold brew on a harbour wall, fishing boats behind"
      }
    ],
    panes: [
      {
        m: {
          kind: "image",
          src: "/showcase/lab/picture-models/model-a.webp",
          sm: "/showcase/lab/picture-models/model-a-sm.webp",
          w: 896,
          h: 1152,
          tone: "#807b6f",
          alt: "Iced cold brew on a harbour wall, fishing boats behind"
        },
        label: "Z-Image Turbo, on the pod"
      },
      {
        m: {
          kind: "image",
          src: "/showcase/cold-brew.webp",
          sm: "/showcase/cold-brew-sm.webp",
          w: 1344,
          h: 2016,
          tone: "#261b0f",
          alt: "A glass of iced cold brew on a stone harbour wall at golden hour"
        },
        label: "Higgsfield Soul 2, the same prompt"
      }
    ],
    words: [
      {
        label: "The caption",
        text: "Cold brew season is open at Low Tide. The seagulls heard first and they've been insufferable about it.\n\nNo fanfare needed. Slow-steeped coffee over ice, taken on the harbour wall while the light goes gold and the boats blur into the background. Some things don't need improving.\n\nCome by the harbour. The brew's cold, the stone's warm, the season's open.\n\n#LowTideCoffee #ColdBrewSeason #IcedColdBrew #HarbourSide #ColdBrewCoffee"
      }
    ],
    steps: [
      {
        did: "Drew the prompt on the pod",
        model: "Z-Image Turbo"
      },
      {
        did: "Drew the same prompt, for the showcase before",
        model: "Higgsfield Soul 2"
      },
      {
        did: "Wrote the caption in the brand’s voice",
        model: "Kimi K3"
      }
    ]
  },
  "product-picture": {
    brand: BRANDS.maisoncire,
    key: "product-picture",
    look: "compare",
    platform: "instagram",
    given: "The brief: Ember & Fig, a hand-poured autumn candle, back for six weeks only. Warm editorial still life, walnut and amber glass.",
    made: [
      {
        kind: "image",
        src: "/showcase/lab/product-picture/design.webp",
        sm: "/showcase/lab/product-picture/design-sm.webp",
        w: 1024,
        h: 1280,
        tone: "#867463",
        alt: "The candle picture with the headline drawn at the top"
      }
    ],
    panes: [
      {
        m: {
          kind: "image",
          src: "/showcase/lab/product-picture/picture.webp",
          sm: "/showcase/lab/product-picture/picture-sm.webp",
          w: 896,
          h: 1152,
          tone: "#877463",
          alt: "An amber candle burning on a walnut table, a split fig beside it"
        },
        label: "The picture"
      },
      {
        m: {
          kind: "image",
          src: "/showcase/lab/product-picture/design.webp",
          sm: "/showcase/lab/product-picture/design-sm.webp",
          w: 1024,
          h: 1280,
          tone: "#867463",
          alt: "The candle picture with the headline drawn at the top"
        },
        label: "With the headline"
      }
    ],
    words: [
      {
        label: "The headline",
        text: "Ember & Fig, back for six weeks only"
      },
      {
        label: "The caption",
        text: "Smoky fig, cedar, and a thread of black pepper. Ember & Fig is back, for six weeks only.\n\nIt arrives the way autumn evenings do, slowly. Fig drawn through smoke, cedar settling underneath, pepper staying just long enough to be noticed.\n\nEach candle is poured by hand into amber glass, the kind that holds low window light a little longer before letting it go.\n\nSix weeks, then it’s gone again. Order before it’s gone.\n\n#EmberAndFig #SmokyFig #HandPouredCandles #AutumnCandle #CedarAndBlackPepper"
      }
    ],
    steps: [
      {
        did: "Drew the picture from the brief, 4:5, no words in it",
        model: "Z-Image Turbo"
      },
      {
        did: "Wrote the headline",
        model: "Kimi K3"
      },
      {
        did: "Drew the headline on it, in Cormorant and the brand’s cream",
        model: "FlowAI"
      },
      {
        did: "Wrote the caption in the brand’s voice",
        model: "Kimi K3"
      }
    ]
  },
  "tips-carousel": {
    brand: BRANDS.kilnandco,
    key: "tips-carousel",
    look: "carousel",
    platform: "instagram",
    given: "The brief: Kiln & Co’s handmade stoneware cups; the promise, five things to know before your first wheel class.",
    made: [
      {
        kind: "image",
        src: "/showcase/lab/tips-carousel/slide-1.webp",
        sm: "/showcase/lab/tips-carousel/slide-1-sm.webp",
        w: 1024,
        h: 1280,
        tone: "#a79f92",
        alt: "Stoneware cups on studio shelves, the headline across the top"
      },
      {
        kind: "image",
        src: "/showcase/lab/tips-carousel/slide-2.webp",
        sm: "/showcase/lab/tips-carousel/slide-2-sm.webp",
        w: 1024,
        h: 1280,
        tone: "#938a7b",
        alt: "Stoneware cups in warm studio light"
      },
      {
        kind: "image",
        src: "/showcase/lab/tips-carousel/slide-3.webp",
        sm: "/showcase/lab/tips-carousel/slide-3-sm.webp",
        w: 1024,
        h: 1280,
        tone: "#948676",
        alt: "Stoneware cups in warm studio light"
      },
      {
        kind: "image",
        src: "/showcase/lab/tips-carousel/slide-4.webp",
        sm: "/showcase/lab/tips-carousel/slide-4-sm.webp",
        w: 1024,
        h: 1280,
        tone: "#bbb5ab",
        alt: "Stoneware cups in warm studio light"
      }
    ],
    words: [
      {
        label: "The headline",
        text: "Five things before your first wheel class"
      },
      {
        label: "The caption",
        text: "Thinking about your first wheel class? Here are five things worth knowing before your hands touch the clay.\n\nSwipe through for what to wear, what the clay really feels like on the wheel, and the small things most beginners get wrong at the start.\n\nEvery stoneware cup in our studio began as a lump of clay and two hands willing to learn. Book a class through the link in our bio. Save this for later.\n\n#WheelThrowing #PotteryClass #HandmadeStoneware #CeramicsStudio #KilnAndCo"
      }
    ],
    steps: [
      {
        did: "Drew four pictures in one look, 4:5",
        model: "Z-Image Turbo"
      },
      {
        did: "Wrote the promise for the first slide",
        model: "Kimi K3"
      },
      {
        did: "Drew it on the first slide, in Fraunces",
        model: "FlowAI"
      },
      {
        did: "Wrote the caption, ending with “save this for later”",
        model: "Kimi K3"
      }
    ]
  },
  "product-scene": {
    brand: BRANDS.dewtheory,
    key: "product-scene",
    look: "compare",
    platform: "instagram",
    given: "Their photo of the serum, and one instruction: keep the bottle exactly as it is, put it on a pale limestone shelf in morning light, eucalyptus beside it.",
    made: [
      {
        kind: "image",
        src: "/showcase/lab/product-scene/scene.webp",
        sm: "/showcase/lab/product-scene/scene-sm.webp",
        w: 880,
        h: 1168,
        tone: "#afab9e",
        alt: "The same serum bottle on a limestone shelf with eucalyptus and a linen towel"
      }
    ],
    panes: [
      {
        m: {
          kind: "image",
          src: "/showcase/dew-serum.webp",
          sm: "/showcase/dew-serum-sm.webp",
          w: 1536,
          h: 2048,
          tone: "#242e1d",
          alt: "A frosted serum bottle on wet dark stone in soft green light"
        },
        label: "Your photo"
      },
      {
        m: {
          kind: "image",
          src: "/showcase/lab/product-scene/scene.webp",
          sm: "/showcase/lab/product-scene/scene-sm.webp",
          w: 880,
          h: 1168,
          tone: "#afab9e",
          alt: "The same serum bottle on a limestone shelf with eucalyptus and a linen towel"
        },
        label: "Edited"
      }
    ],
    words: [
      {
        label: "The caption",
        text: "Some mornings your skin asks for something quieter. This is 4% niacinamide and green tea, drawn one measured drop at a time.\n\nInside the frosted glass: niacinamide at four percent, held in balance with green tea. Nothing loud, nothing rushed — a formula that keeps to its measure.\n\nOne dropper is the whole ritual. Calm skin by morning, said quietly, because it does not need more volume.\n\nTry the 7 ml sample. A small bottle, sized for deciding.\n\n#DewTheory #NiacinamideSerum #CalmingSkincare #MorningRitual #GreenTeaSkincare"
      }
    ],
    steps: [
      {
        did: "Put the bottle in the new scene, keeping it as it was",
        model: "FLUX.2 Klein"
      },
      {
        did: "Wrote the caption in the brand’s voice",
        model: "Kimi K3"
      }
    ]
  },
  "words-over-picture": {
    brand: BRANDS.wildstemflowers,
    key: "words-over-picture",
    look: "compare",
    platform: "instagram",
    given: "Their own photo of a bouquet, and two lines placed in the text editor: the headline at the top, “Order by Thursday” in a pink box at the bottom.",
    made: [
      {
        kind: "image",
        src: "/showcase/lab/words-over-picture/design.webp",
        sm: "/showcase/lab/words-over-picture/design-sm.webp",
        w: 1024,
        h: 1280,
        tone: "#7a684c",
        alt: "The bouquet photo with “Mother’s Day bouquets” at the top and “Order by Thursday” in a pink box"
      }
    ],
    panes: [
      {
        m: {
          kind: "image",
          src: "/showcase/friday-stems.webp",
          sm: "/showcase/friday-stems-sm.webp",
          w: 1536,
          h: 2048,
          tone: "#3d3728",
          alt: "A paper-wrapped bouquet of roses and ranunculus in a bicycle basket"
        },
        label: "Your photo"
      },
      {
        m: {
          kind: "image",
          src: "/showcase/lab/words-over-picture/design.webp",
          sm: "/showcase/lab/words-over-picture/design-sm.webp",
          w: 1024,
          h: 1280,
          tone: "#7a684c",
          alt: "The bouquet photo with “Mother’s Day bouquets” at the top and “Order by Thursday” in a pink box"
        },
        label: "With the words"
      }
    ],
    words: [
      {
        label: "The caption",
        text: "Pastel peonies and ranunculus, still cool from the morning market, waiting to be carried home to Mum.\n\nMother's Day is nearly here, and the shop is full of the season's best: blush peonies, layered ranunculus, stems that open gently over the week.\n\nEach bouquet is made to order, so tell us when you'd like to collect yours and we'll have it wrapped and waiting, paper the colour of the petals.\n\nOrder by Thursday through the link in our bio, and we'll take care of the rest.\n\n#WildStem #MothersDayBouquets #PeonySeason #Ranunculus #NeighbourhoodFlorist"
      }
    ],
    steps: [
      {
        did: "Drew the two lines where they were placed, in DM Serif and Montserrat, out of the parts Instagram covers",
        model: "FlowAI"
      },
      {
        did: "Wrote the caption in the brand’s voice",
        model: "Kimi K3"
      }
    ]
  },
  "moving-pictures": {
    brand: BRANDS.osterianove,
    key: "moving-pictures",
    look: "reel",
    platform: "instagram",
    given: "The brief: tonight’s special at Osteria Nove, fresh pappardelle with slow-cooked ragù. Book a table tonight.",
    from: {
      kind: "image",
      src: "/showcase/lab/moving-pictures/frame.webp",
      sm: "/showcase/lab/moving-pictures/frame-sm.webp",
      w: 732,
      h: 1280,
      tone: "#a8886f",
      alt: "Pappardelle with ragù on a candlelit table"
    },
    made: [
      {
        kind: "video",
        src: "/showcase/lab/moving-pictures/reel.mp4",
        poster: "/showcase/lab/moving-pictures/reel-poster.webp",
        w: 406,
        h: 720,
        tone: "#a88972",
        seconds: 20.6,
        sound: true,
        alt: "Pappardelle al ragù by candlelight, the pictures moving, captions lighting up"
      }
    ],
    words: [
      {
        label: "The lines the voice reads",
        text: "All afternoon our ragù has been simmering slowly, the way Nonna insisted.\nTonight we fold it through fresh pappardelle, rolled by hand this morning. Tonight's special: pappardelle al ragù.\nThe candle is lit and your table is waiting at Osteria Nove. Book a table tonight."
      },
      {
        label: "The caption",
        text: "Tonight’s special at Osteria Nove: pappardelle al ragù, slow-cooked and folded through fresh pasta ribbons for your table.\n\nThe pasta is fresh, the ragù has taken its time, and the room is set with linen, warm candlelight and the quiet promise of another forkful.\n\nBook a table tonight.\n#OsteriaNove #PappardelleAlRagu #SlowCookedRagu #FreshPasta #CandlelitDinner"
      }
    ],
    steps: [
      {
        did: "Drew three moments of the same dinner, 9:16",
        model: "Z-Image Turbo"
      },
      {
        did: "Wrote a line for each, from the hook to “book a table”",
        model: "Kimi K3"
      },
      {
        did: "Read them in a warm voice (The Documentarian)",
        model: "VoiceStudio"
      },
      {
        did: "Wrote a song for it: trattoria guitar and mandolin",
        model: "ACE-Step"
      },
      {
        did: "Put the pictures in motion with captions and an end card",
        model: "FlowAI"
      },
      {
        did: "Wrote the caption",
        model: "Kimi K3"
      }
    ]
  },
  "moving-pictures-translated": {
    brand: BRANDS.kilnandco,
    key: "moving-pictures-translated",
    look: "reel",
    platform: "instagram",
    given: "Their three photos (wheel, glaze, the finished cups) and three lines in English, to be read in French.",
    from: {
      kind: "image",
      src: "/showcase/clay-throw.webp",
      sm: "/showcase/clay-throw-sm.webp",
      w: 2048,
      h: 2048,
      tone: "#352414",
      alt: "Wet hands shaping a small cup on a spinning potter’s wheel"
    },
    made: [
      {
        kind: "video",
        src: "/showcase/lab/moving-pictures-translated/reel.mp4",
        poster: "/showcase/lab/moving-pictures-translated/reel-poster.webp",
        w: 406,
        h: 720,
        tone: "#704c33",
        seconds: 11.8,
        sound: true,
        alt: "The pottery photos moving, French captions lighting up"
      }
    ],
    words: [
      {
        label: "The lines, in English",
        text: "Every cup starts as a block of clay.\nWe throw it, trim it and glaze it by hand.\nWeekend wheel classes are open: come make your own."
      },
      {
        label: "Translated, read in French",
        text: "Chaque tasse naît d'un bloc d'argile.\nOn la tourne, on l'ébarbe et on l'émaille à la main.\nLes cours de tournage du week-end sont ouverts : venez faire la vôtre."
      }
    ],
    steps: [
      {
        did: "Translated the lines into French, the way a native would say them",
        model: "Kimi K3"
      },
      {
        did: "Read them in a French voice (French Companion)",
        model: "VoiceStudio"
      },
      {
        did: "Wrote a song for it: soft piano and guitar",
        model: "ACE-Step"
      },
      {
        did: "Put the photos in motion with the French captions",
        model: "FlowAI"
      }
    ]
  },
  "animated-picture": {
    brand: BRANDS.lowtidecoffee,
    key: "animated-picture",
    look: "reel",
    platform: "instagram",
    given: "The brief: a steaming flat white on a harbour wall at dawn. The motion: a slow push in, steam curling up, boats rocking.",
    from: {
      kind: "image",
      src: "/showcase/lab/animated-picture/still.webp",
      sm: "/showcase/lab/animated-picture/still-sm.webp",
      w: 732,
      h: 1280,
      tone: "#59524a",
      alt: "A flat white on a harbour wall at dawn"
    },
    made: [
      {
        kind: "video",
        src: "/showcase/lab/animated-picture/clip.mp4",
        poster: "/showcase/lab/animated-picture/clip-poster.webp",
        w: 414,
        h: 720,
        tone: "#565049",
        seconds: 5.1,
        sound: true,
        alt: "A flat white steaming on a harbour wall at dawn, the camera pushing in"
      }
    ],
    words: [
      {
        label: "The caption",
        text: "The harbour wakes up at seven, and so do we. Flat white, ceramic cup, the good seat on the wall.\n\nThe boats are already out, the gulls are already loud, and the steam is doing most of the talking. Golden hour doesn't wait around, but your coffee will.\n\nCome by the harbour. We'll be the ones awake on purpose.\n\n#FlatWhite #HarbourMornings #DawnCoffee #WeatheredStone #FishingBoats"
      }
    ],
    steps: [
      {
        did: "Drew the picture, 9:16",
        model: "Z-Image Turbo"
      },
      {
        did: "Brought it to life, 5 seconds",
        model: "Wan 2.2"
      },
      {
        did: "Wrote ambient music as long as the clip",
        model: "ACE-Step"
      },
      {
        did: "Put the music under it",
        model: "FlowAI"
      },
      {
        did: "Wrote the caption",
        model: "Kimi K3"
      }
    ]
  },
  "video-models": {
    brand: BRANDS.northlineruns,
    key: "video-models",
    look: "panes",
    platform: "instagram",
    given: "One prompt: a low tracking shot of runners crossing a steel bridge at dawn, the skyline in mist, breath in the cold air.",
    made: [
      {
        kind: "video",
        src: "/showcase/lab/video-models/wan.mp4",
        poster: "/showcase/lab/video-models/wan-poster.webp",
        w: 396,
        h: 720,
        tone: "#878276",
        seconds: 5,
        sound: false,
        alt: "Runners silhouetted on a bridge at dawn, the city in mist"
      }
    ],
    panes: [
      {
        m: {
          kind: "video",
          src: "/showcase/lab/video-models/wan.mp4",
          poster: "/showcase/lab/video-models/wan-poster.webp",
          w: 396,
          h: 720,
          tone: "#878276",
          seconds: 5,
          sound: false,
          alt: "Runners silhouetted on a bridge at dawn, the city in mist"
        },
        label: "Wan 2.2, on the pod"
      },
      {
        m: {
          kind: "video",
          src: "/showcase/dawn-miles.mp4",
          poster: "/showcase/dawn-miles-sm.webp",
          w: 720,
          h: 1280,
          tone: "#554f48",
          alt: "Runners crossing a steel bridge at sunrise",
          seconds: 5
        },
        label: "Kling 3 Pro, the same prompt"
      }
    ],
    words: [
      {
        label: "The caption",
        text: "The mist still sits on the river. The light is just breaking gold. And the bridges are ours — 6:30, every Saturday.\n\nNorthline Run Club runs the river bridges at sunrise. All paces. Fast, slow, first time, coming back. Nobody left behind.\n\nShow up once. The rest takes care of itself.\n\n#NorthlineRunClub #SunriseRun #SaturdayMiles #BridgeRun #NobodyLeftBehind"
      }
    ],
    steps: [
      {
        did: "Filmed the prompt on the pod, 5 seconds",
        model: "Wan 2.2"
      },
      {
        did: "Filmed the same prompt, for the showcase before",
        model: "Kling 3 Pro"
      },
      {
        did: "Wrote the caption",
        model: "Kimi K3"
      }
    ]
  },
  "talking-portrait": {
    brand: BRANDS.lowtidecoffee,
    key: "talking-portrait",
    look: "reel",
    platform: "instagram",
    given: "A portrait (made here: she isn’t a real person) and one line: “Morning! Cold brew season is open at Low Tide. Come by the harbour.”",
    from: {
      kind: "image",
      src: "/showcase/lab/talking-portrait/portrait.webp",
      sm: "/showcase/lab/talking-portrait/portrait-sm.webp",
      w: 732,
      h: 1280,
      tone: "#7b726a",
      alt: "Portrait of a smiling barista in a denim apron"
    },
    made: [
      {
        kind: "video",
        src: "/showcase/lab/talking-portrait/clip.mp4",
        poster: "/showcase/lab/talking-portrait/clip-poster.webp",
        w: 414,
        h: 720,
        tone: "#7a6f67",
        seconds: 5.1,
        sound: true,
        alt: "A barista talking to the camera, captions lighting up"
      }
    ],
    words: [
      {
        label: "What she says",
        text: "Morning! Cold brew season is open at Low Tide. Come by the harbour."
      }
    ],
    steps: [
      {
        did: "Drew the portrait: an invented barista, nobody real",
        model: "Z-Image Turbo"
      },
      {
        did: "Animated it, looking at the camera, 5 seconds",
        model: "Wan 2.2"
      },
      {
        did: "Read the line in a voice (The Neighbor)",
        model: "VoiceStudio"
      },
      {
        did: "Moved her lips to the words",
        model: "LatentSync"
      },
      {
        did: "Burned in the captions, word by word",
        model: "FlowAI"
      }
    ],
    note: "The person is invented, made for this example. With a real person, the node asks you to tick that they agreed."
  },
  "dub-language": {
    brand: BRANDS.lowtidecoffee,
    key: "dub-language",
    look: "panes",
    platform: "instagram",
    given: "The talking portrait’s video, in English, to be said in French.",
    made: [
      {
        kind: "video",
        src: "/showcase/lab/dub-language/clip.mp4",
        poster: "/showcase/lab/dub-language/clip-poster.webp",
        w: 414,
        h: 720,
        tone: "#796e67",
        seconds: 5.2,
        sound: true,
        alt: "The barista saying the line in French, lips matching"
      }
    ],
    panes: [
      {
        m: {
          kind: "video",
          src: "/showcase/lab/talking-portrait/english.mp4",
          poster: "/showcase/lab/talking-portrait/english-poster.webp",
          w: 414,
          h: 720,
          tone: "#796f68",
          seconds: 5.1,
          sound: true,
          alt: ""
        },
        label: "The video, in English"
      },
      {
        m: {
          kind: "video",
          src: "/showcase/lab/dub-language/clip.mp4",
          poster: "/showcase/lab/dub-language/clip-poster.webp",
          w: 414,
          h: 720,
          tone: "#796e67",
          seconds: 5.2,
          sound: true,
          alt: "The barista saying the line in French, lips matching"
        },
        label: "Dubbed into French"
      }
    ],
    words: [
      {
        label: "What she said",
        text: "Morning. Cold brew season is open at low tide. Come by the harbor."
      },
      {
        label: "What she says now",
        text: "Bonjour. La saison du cold brew est ouverte chez Low Tide. Passez par le port."
      }
    ],
    steps: [
      {
        did: "Heard every word",
        model: "Whisper"
      },
      {
        did: "Translated it into French, the café’s name kept as it is (Keep as it is: Low Tide)",
        model: "Kimi K3"
      },
      {
        did: "Cloned her voice from the video and read the French in it",
        model: "VoiceStudio"
      },
      {
        did: "Moved her lips to the French",
        model: "LatentSync"
      },
      {
        did: "Burned in the captions",
        model: "FlowAI"
      }
    ],
    note: "The speaker is invented, made for this example. With a real person, the node asks you to tick that they agreed."
  },
  "voiceover-video": {
    brand: BRANDS.marginsbooks,
    key: "voiceover-video",
    look: "reel",
    platform: "instagram",
    given: "The brief: Margins Books’ new table of short novels, all under 200 pages. Come browse this weekend.",
    from: {
      kind: "image",
      src: "/showcase/lab/voiceover-video/picture.webp",
      sm: "/showcase/lab/voiceover-video/picture-sm.webp",
      w: 732,
      h: 1280,
      tone: "#74563e",
      alt: "A table of paperbacks in a lamp-lit bookshop"
    },
    made: [
      {
        kind: "video",
        src: "/showcase/lab/voiceover-video/reel.mp4",
        poster: "/showcase/lab/voiceover-video/reel-poster.webp",
        w: 406,
        h: 720,
        tone: "#58402a",
        seconds: 11.7,
        sound: true,
        alt: "A warm bookshop table, the words lighting up as they are read"
      }
    ],
    words: [
      {
        label: "The script",
        text: "Something new at Margins Books. A whole table of short novels. Every one under 200 pages. Start one after lunch. Finish it by dinner. Your to-be-read pile has officially been warned. Come browse this weekend."
      }
    ],
    steps: [
      {
        did: "Wrote a short voiceover script",
        model: "Kimi K3"
      },
      {
        did: "Drew the bookshop, 9:16",
        model: "Z-Image Turbo"
      },
      {
        did: "Read it in a voice (The Explainer)",
        model: "VoiceStudio"
      },
      {
        did: "Put it together: the words lighting up as they’re said, the voice’s wave",
        model: "FlowAI"
      }
    ]
  },
  "face-swap": {
    brand: BRANDS.lowtidecoffee,
    key: "face-swap",
    look: "panes",
    platform: "instagram",
    given: "A face (made here: nobody real) and the talking portrait’s video.",
    made: [
      {
        kind: "video",
        src: "/showcase/lab/face-swap/clip.mp4",
        poster: "/showcase/lab/face-swap/clip-poster.webp",
        w: 414,
        h: 720,
        tone: "#786d65",
        seconds: 5.1,
        sound: true,
        alt: "The talking video with the new face"
      }
    ],
    panes: [
      {
        m: {
          kind: "video",
          src: "/showcase/lab/talking-portrait/english.mp4",
          poster: "/showcase/lab/talking-portrait/english-poster.webp",
          w: 414,
          h: 720,
          tone: "#796f68",
          seconds: 5.1,
          sound: true,
          alt: ""
        },
        label: "The video"
      },
      {
        m: {
          kind: "image",
          src: "/showcase/lab/face-swap/face.webp",
          sm: "/showcase/lab/face-swap/face-sm.webp",
          w: 896,
          h: 1152,
          tone: "#816553",
          alt: "Portrait of a woman with auburn hair and freckles"
        },
        label: "The face"
      },
      {
        m: {
          kind: "video",
          src: "/showcase/lab/face-swap/clip.mp4",
          poster: "/showcase/lab/face-swap/clip-poster.webp",
          w: 414,
          h: 720,
          tone: "#786d65",
          seconds: 5.1,
          sound: true,
          alt: "The talking video with the new face"
        },
        label: "With the face"
      }
    ],
    words: [],
    steps: [
      {
        did: "Drew the face: an invented woman, nobody real",
        model: "Z-Image Turbo"
      },
      {
        did: "Put her face on the video, frame by frame",
        model: "inswapper"
      },
      {
        did: "Burned in the captions",
        model: "FlowAI"
      }
    ],
    note: "Both people are invented, made for this example. With a real face, the node asks you to tick that the person agreed; never a public figure."
  },
  "hf-cinematic-shot": {
    brand: BRANDS.lowtidecoffee,
    key: "hf-cinematic-shot",
    look: "reel",
    platform: "instagram",
    given: "A cold brew on the harbour wall at golden hour, poured over ice in slow motion.",
    made: [
      {
        kind: "video",
        src: "/showcase/the-pour.mp4",
        poster: "/showcase/the-pour-sm.webp",
        w: 720,
        h: 1280,
        tone: "#4e4844",
        alt: "Cold brew poured over ice in a tall glass on a harbour wall",
        seconds: 5
      }
    ],
    words: [
      {
        label: "The caption",
        text: "Slow pour for people who still wear shorts in October. Cold brew, harbour wall, no plans to take it off the menu. #coldbrew #harbourweather"
      }
    ],
    steps: [
      {
        did: "Filmed the shot, 9:16, 5 seconds",
        model: "Kling 3 Pro"
      },
      {
        did: "Wrote the caption in the brand’s voice",
        model: "DeepSeek V4 Pro"
      }
    ],
    note: "A clip Higgsfield made for the showcase before. Cinema Studio adds the camera move you pick (a crash zoom, a drone orbit…), a lens, a grade, and sound."
  },
  "hf-character": {
    brand: BRANDS.kilnandco,
    key: "hf-character",
    look: "grid",
    platform: "instagram",
    given: "One portrait of her (made here: nobody real), then three scenes: at the wheel, at a Saturday market, at home with tea.",
    made: [
      {
        kind: "image",
        src: "/showcase/lab/hf-character/scene-1.webp",
        sm: "/showcase/lab/hf-character/scene-1-sm.webp",
        w: 896,
        h: 1152,
        tone: "#927964",
        alt: "The potter smiling at the wheel"
      },
      {
        kind: "image",
        src: "/showcase/lab/hf-character/scene-2.webp",
        sm: "/showcase/lab/hf-character/scene-2-sm.webp",
        w: 896,
        h: 1152,
        tone: "#937c6e",
        alt: "The potter at a sunny market with a cup"
      },
      {
        kind: "image",
        src: "/showcase/lab/hf-character/scene-3.webp",
        sm: "/showcase/lab/hf-character/scene-3-sm.webp",
        w: 896,
        h: 1152,
        tone: "#4e3624",
        alt: "The potter on a sofa drinking tea"
      }
    ],
    panes: [
      {
        m: {
          kind: "image",
          src: "/showcase/lab/hf-character/her.webp",
          sm: "/showcase/lab/hf-character/her-sm.webp",
          w: 896,
          h: 1152,
          tone: "#887566",
          alt: "Portrait of a young potter with a black bob and a rust apron"
        },
        label: "Her"
      },
      {
        m: {
          kind: "image",
          src: "/showcase/lab/hf-character/scene-1.webp",
          sm: "/showcase/lab/hf-character/scene-1-sm.webp",
          w: 896,
          h: 1152,
          tone: "#927964",
          alt: "The potter smiling at the wheel"
        },
        label: "At the wheel"
      },
      {
        m: {
          kind: "image",
          src: "/showcase/lab/hf-character/scene-2.webp",
          sm: "/showcase/lab/hf-character/scene-2-sm.webp",
          w: 896,
          h: 1152,
          tone: "#937c6e",
          alt: "The potter at a sunny market with a cup"
        },
        label: "At the market"
      },
      {
        m: {
          kind: "image",
          src: "/showcase/lab/hf-character/scene-3.webp",
          sm: "/showcase/lab/hf-character/scene-3-sm.webp",
          w: 896,
          h: 1152,
          tone: "#4e3624",
          alt: "The potter on a sofa drinking tea"
        },
        label: "At home"
      }
    ],
    words: [
      {
        label: "The caption",
        text: "Weekend wheel classes are open. A warm studio, a turning wheel, and a lump of clay waiting for your hands.\n\nYou will learn to centre the clay, raise the walls, and shape a cup with your own two hands, guided by the same people who throw our stoneware every day. No experience needed, just sleeves you can roll up.\n\nYour piece gets fired and glazed in our kiln, ready to pick up when it is done.\n\nBook a class through the link in our bio.\n\n#KilnAndCo #StonewareCups #WheelThrowing #HandmadeCeramics #PotteryClass"
      }
    ],
    steps: [
      {
        did: "Drew her: an invented potter, nobody real",
        model: "Z-Image Turbo"
      },
      {
        did: "Put her in three scenes, her face, hair and apron kept",
        model: "FLUX.2 Klein"
      },
      {
        did: "Wrote the caption",
        model: "Kimi K3"
      }
    ],
    note: "Higgsfield wasn’t connected for this example, so the pod stood in: FLUX.2 Klein kept her face from one picture. Soul ID, trained on 10 to 20 photos, keeps it across any number of scenes."
  },
  "hf-trend": {
    brand: BRANDS.northlineruns,
    key: "hf-trend",
    look: "reel",
    platform: "tiktok",
    given: "A photo of him (made here: nobody real), the moves, and the hook “POV: your first 6:30 run”.",
    from: {
      kind: "image",
      src: "/showcase/lab/hf-trend/him.webp",
      sm: "/showcase/lab/hf-trend/him-sm.webp",
      w: 732,
      h: 1280,
      tone: "#b39788",
      alt: "A runner in an orange jacket on a city bridge"
    },
    made: [
      {
        kind: "video",
        src: "/showcase/lab/hf-trend/clip.mp4",
        poster: "/showcase/lab/hf-trend/clip-poster.webp",
        w: 414,
        h: 720,
        tone: "#b3968b",
        seconds: 5,
        sound: false,
        alt: "A runner in an orange jacket dancing on a bridge, the hook over it"
      }
    ],
    words: [
      {
        label: "The caption",
        text: "Run club is the new night out.\nSaturdays, 6:30. All paces, nobody left behind.\nShow up once.\n#RunClub #RunningTok #SunriseRun #NorthlineRunClub #SaturdayMorning"
      }
    ],
    steps: [
      {
        did: "Drew him: an invented runner, nobody real",
        model: "Z-Image Turbo"
      },
      {
        did: "Made him dance, 5 seconds",
        model: "Wan 2.2"
      },
      {
        did: "Drew the hook over it, in Anton",
        model: "FlowAI"
      },
      {
        did: "Wrote the caption for TikTok",
        model: "Kimi K3"
      }
    ],
    note: "Higgsfield wasn’t connected for this example, so the pod stood in: Wan 2.2 made up the dance from a description. Kling Motion Control copies the exact moves of a real video."
  },
  "hf-ads": {
    brand: BRANDS.dewtheory,
    key: "hf-ads",
    look: "grid",
    platform: "instagram",
    given: "Their photo of the serum and the brief: calm skin by morning, try the 7 ml sample.",
    made: [
      {
        kind: "image",
        src: "/showcase/lab/hf-ads/ad-1.webp",
        sm: "/showcase/lab/hf-ads/ad-1-sm.webp",
        w: 1024,
        h: 1280,
        tone: "#4f5e3f",
        alt: "Serum ad: Calm skin by morning"
      },
      {
        kind: "image",
        src: "/showcase/lab/hf-ads/ad-2.webp",
        sm: "/showcase/lab/hf-ads/ad-2-sm.webp",
        w: 1024,
        h: 1280,
        tone: "#a1a989",
        alt: "Serum ad: Green tea. Niacinamide. Nothing else."
      },
      {
        kind: "image",
        src: "/showcase/lab/hf-ads/ad-3.webp",
        sm: "/showcase/lab/hf-ads/ad-3-sm.webp",
        w: 1024,
        h: 1280,
        tone: "#bfb7a8",
        alt: "Serum ad: No sting. Just calm."
      },
      {
        kind: "image",
        src: "/showcase/lab/hf-ads/ad-4.webp",
        sm: "/showcase/lab/hf-ads/ad-4-sm.webp",
        w: 1024,
        h: 1280,
        tone: "#caccbc",
        alt: "Serum ad: One drop. Every morning."
      }
    ],
    words: [
      {
        label: "The caption",
        text: "Soft green light on wet stone. A few quiet drops before the day begins.\n\nDew Theory's morning serum pairs 4% niacinamide with green tea in a frosted glass dropper bottle — measured, uncomplicated, kind to skin that wakes up reactive.\n\nNo noise, no rush. Just a calmer way to start the morning.\n\nTry the 7 ml sample at the link in bio.\n\n#DewTheory #MorningSerum #Niacinamide #GreenTeaSkincare #CalmSkinByMorning"
      }
    ],
    steps: [
      {
        did: "Put the bottle in four ad scenes, keeping it as it was",
        model: "FLUX.2 Klein"
      },
      {
        did: "Laid out a headline and a button on each",
        model: "FlowAI"
      },
      {
        did: "Wrote the caption",
        model: "Kimi K3"
      }
    ],
    note: "Higgsfield wasn’t connected for this example, so the pod stood in: FLUX.2 Klein made the scenes and the headlines were drawn here. Ads Studio designs the whole ad, words and all, several ideas at once."
  },
  "youtube-clips": {
    brand: BRANDS.ledgerly,
    key: "youtube-clips",
    look: "panes",
    platform: "instagram",
    given: "A wide podcast video (made here, standing in for a YouTube video; she isn’t a real person), cut vertical around the speaker.",
    made: [
      {
        kind: "video",
        src: "/showcase/lab/youtube-clips/clip.mp4",
        poster: "/showcase/lab/youtube-clips/clip-poster.webp",
        w: 406,
        h: 720,
        tone: "#5b473e",
        seconds: 5,
        sound: true,
        alt: "The same host, cut vertical, captions lighting up"
      }
    ],
    panes: [
      {
        m: {
          kind: "video",
          src: "/showcase/lab/youtube-clips/episode.mp4",
          poster: "/showcase/lab/youtube-clips/episode-poster.webp",
          w: 720,
          h: 414,
          tone: "#6b5544",
          seconds: 5.1,
          sound: true,
          alt: "A podcast host talking at a microphone, wide"
        },
        label: "The long video"
      },
      {
        m: {
          kind: "video",
          src: "/showcase/lab/youtube-clips/clip.mp4",
          poster: "/showcase/lab/youtube-clips/clip-poster.webp",
          w: 406,
          h: 720,
          tone: "#5b473e",
          seconds: 5,
          sound: true,
          alt: "The same host, cut vertical, captions lighting up"
        },
        label: "The clip, vertical, captioned"
      }
    ],
    words: [
      {
        label: "The caption",
        text: "It's not the close that's painful. It's copying the same ten spreadsheets by hand, month after month after month.\n\nOn this episode of the Ledgerly podcast, we get into why month-end feels like Groundhog Day for so many finance teams, and why the problem usually isn't the people doing the work.\n\nWhen the same numbers get retyped into ten different files, errors don't just sneak in. They multiply. The teams with calmer closes didn't get faster at copying. They stopped doing it.\n\nHear the full conversation at the link in bio.\n\n#MonthEndClose #FinanceTeams #AccountingLife #LedgerlyPodcast #SpreadsheetProblems"
      }
    ],
    steps: [
      {
        did: "Drew the host and the studio: nobody real",
        model: "Z-Image Turbo"
      },
      {
        did: "Animated her talking",
        model: "Wan 2.2"
      },
      {
        did: "Gave her the line, lips matching",
        model: "LatentSync"
      },
      {
        did: "Cut it 9:16 around her",
        model: "FlowAI"
      },
      {
        did: "Burned in the captions, word by word",
        model: "FlowAI"
      },
      {
        did: "Wrote the caption",
        model: "Kimi K3"
      }
    ],
    note: "With a YouTube link, it reads the transcript, finds the best moments, and cuts each one: only those parts are downloaded, once you’ve said the video is yours to use."
  },
  "recording-to-posts": {
    brand: BRANDS.ledgerly,
    key: "recording-to-posts",
    look: "recording",
    platform: "linkedin",
    given: "A 20-second voice memo from the founder about a customer.",
    made: [
      {
        kind: "audio",
        src: "/showcase/lab/recording-to-posts/memo.mp3",
        w: 0,
        h: 0,
        tone: "#222222",
        seconds: 21.5,
        sound: true,
        alt: "The founder’s voice memo"
      }
    ],
    words: [
      {
        label: "The post",
        text: "Nobody stays late on the last Friday anymore.\n\nThat's what Northwind's controller told me. Not \"we saved six days.\" Not \"the reports are cleaner.\" That.\n\nWhen they came to us, their close took nine days. Nine. Most of it was the same ten spreadsheets, copied by hand, every month.\n\nWe connected their bank feeds and let the reconciliation run overnight. Last month they closed in three days.\n\nThe speed is good. But the part nobody puts in a business case is this: a shorter close gives people their evenings back. Month-end stops being something the team braces for.\n\nIf your close still runs on copied spreadsheets, read how Northwind did it.\n\n#Accounting #MonthEndClose #Finance"
      },
      {
        label: "The moment it found",
        text: "Their controller told me, the best part is not the speed, it is that nobody stays late on the last Friday anymore."
      }
    ],
    steps: [
      {
        did: "Read the founder’s memo aloud, standing in for a recording",
        model: "VoiceStudio"
      },
      {
        did: "Heard every word",
        model: "Whisper"
      },
      {
        did: "Found the moments worth sharing",
        model: "Kimi K3"
      },
      {
        did: "Wrote a LinkedIn post on the best one",
        model: "Kimi K3"
      }
    ],
    note: "The memo was read by a VoiceStudio voice for this example. Yours can be a podcast, an interview, or a voice note."
  },
  thought: {
    brand: BRANDS.ledgerly,
    key: "thought",
    look: "post",
    platform: "linkedin",
    given: "One idea for finance leads: the close is slow because of copying, not because of accounting.",
    made: [
      {
        kind: "image",
        src: "/showcase/lab/thought/picture.webp",
        sm: "/showcase/lab/thought/picture-sm.webp",
        w: 1280,
        h: 732,
        tone: "#a6becc",
        alt: "A calm minimal desk at dawn, a closed laptop and a coffee"
      }
    ],
    words: [
      {
        label: "The post",
        text: "Most closes run slow because of copying, not accounting.\n\nThink about where the days actually go. Totals pasted from one spreadsheet into another. Invoice numbers re-keyed. Bank lines moved by hand into the reconciliation file.\n\nThat's not finance work. That's transcription.\n\nNorthwind cut its month-end close from 9 days to 3. The accounting didn't change. The copying did. Ledgerly moves the data, so the team spends close week closing.\n\nIf your close runs long, count the copy-paste steps before you question the accountants.\n\nRead how they did it: [link]\n\n#MonthEndClose #FinanceLeadership #Accounting"
      }
    ],
    steps: [
      {
        did: "Wrote the post for LinkedIn",
        model: "Kimi K3"
      },
      {
        did: "Drew a calm picture for it, 16:9",
        model: "Z-Image Turbo"
      }
    ]
  },
  "campaign-pack": {
    brand: BRANDS.wildstemflowers,
    key: "campaign-pack",
    look: "pack",
    platform: "instagram",
    given: "One brief: Mother’s Day bouquets from Wild Stem, order by Thursday.",
    made: [
      {
        kind: "image",
        src: "/showcase/lab/campaign-pack/picture.webp",
        sm: "/showcase/lab/campaign-pack/picture-sm.webp",
        w: 1024,
        h: 1280,
        tone: "#baaea8",
        alt: "Spring bouquets with the headline drawn on"
      },
      {
        kind: "video",
        src: "/showcase/lab/campaign-pack/reel.mp4",
        poster: "/showcase/lab/campaign-pack/reel-poster.webp",
        w: 406,
        h: 720,
        tone: "#978f85",
        seconds: 19.8,
        sound: true,
        alt: "Bouquets moving, a voice reading the lines"
      }
    ],
    words: [
      {
        label: "The headline",
        text: "Mother’s Day bouquets — order by Thursday"
      },
      {
        label: "The caption",
        text: "Pastel peonies and ranunculus, gathered loosely — our Mother’s Day bouquets are open for orders.\n\nBuilt low and airy, the way we like them: blush, cream, a little rose, nothing stiff.\n\nOne for her kitchen table, sent with whatever you still haven’t said out loud.\n\nOrder by Thursday, and hers will be ready in time for the day.\n\n#WildStem #PeonySeason #MothersDayBouquets #Ranunculus #NeighbourhoodFlorist"
      },
      {
        label: "The lines the voice reads",
        text: "The peonies have arrived, all blush and pastels. Spring doesn't stay long.\nThis Mother's Day, give her a Wild Stem bouquet of peonies and ranunculus, made right here in the neighbourhood.\nOrder by Thursday, and hers will be ready for Mother's Day."
      },
      {
        label: "The short post",
        text: "Peonies and ranunculus in soft pastels — our Mother’s Day bouquets have landed in the shop.\n\nEach one is arranged by hand, light and airy, using the best stems the season has to offer. Wrapped simply, ready for the woman who deserves them.\n\nOrder by Thursday and we’ll have hers ready in time.\n\n#WildStem #MothersDayBouquets #PeonySeason #Ranunculus #NeighbourhoodFlorist"
      }
    ],
    steps: [
      {
        did: "Drew the hero picture and three moments for the slideshow",
        model: "Z-Image Turbo"
      },
      {
        did: "Wrote the headline, the lines, the caption and a short post",
        model: "Kimi K3"
      },
      {
        did: "Drew the headline on the picture",
        model: "FlowAI"
      },
      {
        did: "Read the lines (The Upbeat) and wrote a song",
        model: "VoiceStudio · ACE-Step"
      },
      {
        did: "Put the slideshow together",
        model: "FlowAI"
      }
    ]
  },
}
