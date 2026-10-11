"""Writes frontend/src/showcase/lab-examples.ts from the runs' manifest and the notes below."""
import json
import sys

manifest = json.load(open(sys.argv[1]))
out_path = sys.argv[2]

# The showcase's own files, made before with Higgsfield (Soul 2, Kling 3 Pro).
OLD = {
    "cold-brew": dict(kind="image", src="/showcase/cold-brew.webp", sm="/showcase/cold-brew-sm.webp", w=1344, h=2016, tone="#261b0f", alt="A glass of iced cold brew on a stone harbour wall at golden hour"),
    "dew-serum": dict(kind="image", src="/showcase/dew-serum.webp", sm="/showcase/dew-serum-sm.webp", w=1536, h=2048, tone="#242e1d", alt="A frosted serum bottle on wet dark stone in soft green light"),
    "friday-stems": dict(kind="image", src="/showcase/friday-stems.webp", sm="/showcase/friday-stems-sm.webp", w=1536, h=2048, tone="#3d3728", alt="A paper-wrapped bouquet of roses and ranunculus in a bicycle basket"),
    "clay-throw": dict(kind="image", src="/showcase/clay-throw.webp", sm="/showcase/clay-throw-sm.webp", w=2048, h=2048, tone="#352414", alt="Wet hands shaping a small cup on a spinning potter’s wheel"),
    "dawn-miles": dict(kind="video", src="/showcase/dawn-miles.mp4", poster="/showcase/dawn-miles-sm.webp", w=720, h=1280, tone="#554f48", alt="Runners crossing a steel bridge at sunrise", seconds=5),
    "the-pour": dict(kind="video", src="/showcase/the-pour.mp4", poster="/showcase/the-pour-sm.webp", w=720, h=1280, tone="#4e4844", alt="Cold brew poured over ice in a tall glass on a harbour wall", seconds=5),
}

Z, K, W, KIMI, VS, LS, ACE, FLOW = "Z-Image Turbo", "FLUX.2 Klein", "Wan 2.2", "Kimi K3", "VoiceStudio", "LatentSync", "ACE-Step", "FlowAI"
HF = "Higgsfield wasn’t connected for this example, so the pod stood in: "

# key: look, brand, platform, given, media refs, panes, from, steps, note, alts
EX = {
    "picture-models": dict(look="panes", brand="lowtidecoffee", platform="instagram",
        given="One prompt: a tall glass of iced cold brew on a weathered harbour wall at golden hour, boats out of focus behind, 35mm film.",
        panes=[("model-a", "Z-Image Turbo, on the pod"), ("old:cold-brew", "Higgsfield Soul 2, the same prompt")], made=["model-a"],
        steps=[("Drew the prompt on the pod", Z), ("Drew the same prompt, for the showcase before", "Higgsfield Soul 2"), ("Wrote the caption in the brand’s voice", KIMI)],
        alts={"model-a": "Iced cold brew on a harbour wall, fishing boats behind"}),
    "product-picture": dict(look="compare", brand="maisoncire", platform="instagram",
        given="The brief: Ember & Fig, a hand-poured autumn candle, back for six weeks only. Warm editorial still life, walnut and amber glass.",
        panes=[("picture", "The picture"), ("design", "With the headline")], made=["design"],
        steps=[("Drew the picture from the brief, 4:5, no words in it", Z), ("Wrote the headline", KIMI), ("Drew the headline on it, in Cormorant and the brand’s cream", FLOW), ("Wrote the caption in the brand’s voice", KIMI)],
        alts={"picture": "An amber candle burning on a walnut table, a split fig beside it", "design": "The candle picture with the headline drawn at the top"}),
    "tips-carousel": dict(look="carousel", brand="kilnandco", platform="instagram",
        given="The brief: Kiln & Co’s handmade stoneware cups; the promise, five things to know before your first wheel class.",
        made=["slide-1", "slide-2", "slide-3", "slide-4"],
        steps=[("Drew four pictures in one look, 4:5", Z), ("Wrote the promise for the first slide", KIMI), ("Drew it on the first slide, in Fraunces", FLOW), ("Wrote the caption, ending with “save this for later”", KIMI)],
        alts={"slide-1": "Stoneware cups on studio shelves, the headline across the top", "slide-2": "Stoneware cups in warm studio light", "slide-3": "Stoneware cups in warm studio light", "slide-4": "Stoneware cups in warm studio light"}),
    "product-scene": dict(look="compare", brand="dewtheory", platform="instagram",
        given="Their photo of the serum, and one instruction: keep the bottle exactly as it is, put it on a pale limestone shelf in morning light, eucalyptus beside it.",
        panes=[("old:dew-serum", "Your photo"), ("scene", "Edited")], made=["scene"],
        steps=[("Put the bottle in the new scene, keeping it as it was", K), ("Wrote the caption in the brand’s voice", KIMI)],
        alts={"scene": "The same serum bottle on a limestone shelf with eucalyptus and a linen towel"}),
    "words-over-picture": dict(look="compare", brand="wildstemflowers", platform="instagram",
        given="Their own photo of a bouquet, and two lines placed in the text editor: the headline at the top, “Order by Thursday” in a pink box at the bottom.",
        panes=[("old:friday-stems", "Your photo"), ("design", "With the words")], made=["design"],
        steps=[("Drew the two lines where they were placed, in DM Serif and Montserrat, out of the parts Instagram covers", FLOW), ("Wrote the caption in the brand’s voice", KIMI)],
        alts={"design": "The bouquet photo with “Mother’s Day bouquets” at the top and “Order by Thursday” in a pink box"}),
    "moving-pictures": dict(look="reel", brand="osterianove", platform="instagram",
        given="The brief: tonight’s special at Osteria Nove, fresh pappardelle with slow-cooked ragù. Book a table tonight.",
        made=["reel"], frm="frame",
        steps=[("Drew three moments of the same dinner, 9:16", Z), ("Wrote a line for each, from the hook to “book a table”", KIMI), ("Read them in a warm voice (The Documentarian)", VS), ("Wrote a song for it: trattoria guitar and mandolin", ACE), ("Put the pictures in motion with captions and an end card", FLOW), ("Wrote the caption", KIMI)],
        alts={"reel": "Pappardelle al ragù by candlelight, the pictures moving, captions lighting up", "frame": "Pappardelle with ragù on a candlelit table"}),
    "moving-pictures-translated": dict(look="reel", brand="kilnandco", platform="instagram",
        given="Their three photos (wheel, glaze, the finished cups) and three lines in English, to be read in French.",
        made=["reel"], frm="old:clay-throw",
        steps=[("Translated the lines into French, the way a native would say them", KIMI), ("Read them in a French voice (French Companion)", VS), ("Wrote a song for it: soft piano and guitar", ACE), ("Put the photos in motion with the French captions", FLOW)],
        alts={"reel": "The pottery photos moving, French captions lighting up"}),
    "animated-picture": dict(look="reel", brand="lowtidecoffee", platform="instagram",
        given="The brief: a steaming flat white on a harbour wall at dawn. The motion: a slow push in, steam curling up, boats rocking.",
        made=["clip"], frm="still",
        steps=[("Drew the picture, 9:16", Z), ("Brought it to life, 5 seconds", W), ("Wrote ambient music as long as the clip", ACE), ("Put the music under it", FLOW), ("Wrote the caption", KIMI)],
        alts={"clip": "A flat white steaming on a harbour wall at dawn, the camera pushing in", "still": "A flat white on a harbour wall at dawn"}),
    "video-models": dict(look="panes", brand="northlineruns", platform="instagram",
        given="One prompt: a low tracking shot of runners crossing a steel bridge at dawn, the skyline in mist, breath in the cold air.",
        panes=[("wan", "Wan 2.2, on the pod"), ("old:dawn-miles", "Kling 3 Pro, the same prompt")], made=["wan"],
        steps=[("Filmed the prompt on the pod, 5 seconds", W), ("Filmed the same prompt, for the showcase before", "Kling 3 Pro"), ("Wrote the caption", KIMI)],
        alts={"wan": "Runners silhouetted on a bridge at dawn, the city in mist"}),
    "talking-portrait": dict(look="reel", brand="lowtidecoffee", platform="instagram",
        given="A portrait (made here: she isn’t a real person) and one line: “Morning! Cold brew season is open at Low Tide. Come by the harbour.”",
        made=["clip"], frm="portrait",
        steps=[("Drew the portrait: an invented barista, nobody real", Z), ("Animated it, looking at the camera, 5 seconds", W), ("Read the line in a voice (The Neighbor)", VS), ("Moved her lips to the words", LS), ("Burned in the captions, word by word", FLOW)],
        note="The person is invented, made for this example. With a real person, the node asks you to tick that they agreed.",
        alts={"clip": "A barista talking to the camera, captions lighting up", "portrait": "Portrait of a smiling barista in a denim apron"}),
    "dub-language": dict(look="panes", brand="lowtidecoffee", platform="instagram",
        given="The talking portrait’s video, in English, to be said in French.",
        panes=[("tp:english", "The video, in English"), ("clip", "Dubbed into French")], made=["clip"],
        steps=[("Heard every word", "Whisper"), ("Translated it into French, the café’s name kept as it is (Keep as it is: Low Tide)", KIMI), ("Cloned her voice from the video and read the French in it", VS), ("Moved her lips to the French", LS), ("Burned in the captions", FLOW)],
        note="The speaker is invented, made for this example. With a real person, the node asks you to tick that they agreed.",
        alts={"clip": "The barista saying the line in French, lips matching"}),
    "voiceover-video": dict(look="reel", brand="marginsbooks", platform="instagram",
        given="The brief: Margins Books’ new table of short novels, all under 200 pages. Come browse this weekend.",
        made=["reel"], frm="picture",
        steps=[("Wrote a short voiceover script", KIMI), ("Drew the bookshop, 9:16", Z), ("Read it in a voice (The Explainer)", VS), ("Put it together: the words lighting up as they’re said, the voice’s wave", FLOW)],
        alts={"reel": "A warm bookshop table, the words lighting up as they are read", "picture": "A table of paperbacks in a lamp-lit bookshop"}),
    "face-swap": dict(look="panes", brand="lowtidecoffee", platform="instagram",
        given="A face (made here: nobody real) and the talking portrait’s video.",
        panes=[("tp:english", "The video"), ("face", "The face"), ("clip", "With the face")], made=["clip"],
        steps=[("Drew the face: an invented woman, nobody real", Z), ("Put her face on the video, frame by frame", "inswapper"), ("Burned in the captions", FLOW)],
        note="Both people are invented, made for this example. With a real face, the node asks you to tick that the person agreed; never a public figure.",
        alts={"clip": "The talking video with the new face", "face": "Portrait of a woman with auburn hair and freckles"}),
    "hf-cinematic-shot": dict(look="reel", brand="lowtidecoffee", platform="instagram",
        given="A cold brew on the harbour wall at golden hour, poured over ice in slow motion.",
        made=["old:the-pour"],
        steps=[("Filmed the shot, 9:16, 5 seconds", "Kling 3 Pro"), ("Wrote the caption in the brand’s voice", "DeepSeek V4 Pro")],
        words=[("The caption", "Slow pour for people who still wear shorts in October. Cold brew, harbour wall, no plans to take it off the menu. #coldbrew #harbourweather")],
        note="A clip Higgsfield made for the showcase before. Cinema Studio adds the camera move you pick (a crash zoom, a drone orbit…), a lens, a grade, and sound."),
    "hf-character": dict(look="grid", brand="kilnandco", platform="instagram",
        given="One portrait of her (made here: nobody real), then three scenes: at the wheel, at a Saturday market, at home with tea.",
        panes=[("her", "Her"), ("scene-1", "At the wheel"), ("scene-2", "At the market"), ("scene-3", "At home")], made=["scene-1", "scene-2", "scene-3"],
        steps=[("Drew her: an invented potter, nobody real", Z), ("Put her in three scenes, her face, hair and apron kept", K), ("Wrote the caption", KIMI)],
        note=HF + "FLUX.2 Klein kept her face from one picture. Soul ID, trained on 10 to 20 photos, keeps it across any number of scenes.",
        alts={"her": "Portrait of a young potter with a black bob and a rust apron", "scene-1": "The potter smiling at the wheel", "scene-2": "The potter at a sunny market with a cup", "scene-3": "The potter on a sofa drinking tea"}),
    "hf-trend": dict(look="reel", brand="northlineruns", platform="tiktok",
        given="A photo of him (made here: nobody real), the moves, and the hook “POV: your first 6:30 run”.",
        made=["clip"], frm="him",
        steps=[("Drew him: an invented runner, nobody real", Z), ("Made him dance, 5 seconds", W), ("Drew the hook over it, in Anton", FLOW), ("Wrote the caption for TikTok", KIMI)],
        note=HF + "Wan 2.2 made up the dance from a description. Kling Motion Control copies the exact moves of a real video.",
        alts={"clip": "A runner in an orange jacket dancing on a bridge, the hook over it", "him": "A runner in an orange jacket on a city bridge"}),
    "hf-ads": dict(look="grid", brand="dewtheory", platform="instagram",
        given="Their photo of the serum and the brief: calm skin by morning, try the 7 ml sample.",
        made=["ad-1", "ad-2", "ad-3", "ad-4"],
        steps=[("Put the bottle in four ad scenes, keeping it as it was", K), ("Laid out a headline and a button on each", FLOW), ("Wrote the caption", KIMI)],
        note=HF + "FLUX.2 Klein made the scenes and the headlines were drawn here. Ads Studio designs the whole ad, words and all, several ideas at once.",
        alts={"ad-1": "Serum ad: Calm skin by morning", "ad-2": "Serum ad: Green tea. Niacinamide. Nothing else.", "ad-3": "Serum ad: No sting. Just calm.", "ad-4": "Serum ad: One drop. Every morning."}),
    "hf-restyle": dict(look="panes", brand="lowtidecoffee", platform="instagram",
        given="The cold brew clip, turned into claymation, with a hook over it.",
        panes=[("old:the-pour", "The clip"), ("clip", "In clay")], made=["clip"],
        steps=[("Turned its first frame into claymation", K), ("Moved it again, stop-motion style", W), ("Wrote the hook", KIMI), ("Drew it over the clip", FLOW)],
        note=HF + "the first frame was restyled, then animated again. Genjutsu restyles the whole clip, keeping its motion and sound.",
        alts={"clip": "The cold brew pour as claymation, a hook over it"}),
    "youtube-clips": dict(look="panes", brand="ledgerly", platform="instagram",
        given="A wide podcast video (made here, standing in for a YouTube video; she isn’t a real person), cut vertical around the speaker.",
        panes=[("episode", "The long video"), ("clip", "The clip, vertical, captioned")], made=["clip"],
        steps=[("Drew the host and the studio: nobody real", Z), ("Animated her talking", W), ("Gave her the line, lips matching", LS), ("Cut it 9:16 around her", FLOW), ("Burned in the captions, word by word", FLOW), ("Wrote the caption", KIMI)],
        note="With a YouTube link, it reads the transcript, finds the best moments, and cuts each one: only those parts are downloaded, once you’ve said the video is yours to use.",
        alts={"episode": "A podcast host talking at a microphone, wide", "clip": "The same host, cut vertical, captions lighting up"}),
    "recording-to-posts": dict(look="recording", brand="ledgerly", platform="linkedin",
        given="A 20-second voice memo from the founder about a customer.",
        made=["memo"],
        steps=[("Read the founder’s memo aloud, standing in for a recording", VS), ("Heard every word", "Whisper"), ("Found the moments worth sharing", KIMI), ("Wrote a LinkedIn post on the best one", KIMI)],
        note="The memo was read by a VoiceStudio voice for this example. Yours can be a podcast, an interview, or a voice note.",
        alts={"memo": "The founder’s voice memo"}),
    "thought": dict(look="post", brand="ledgerly", platform="linkedin",
        given="One idea for finance leads: the close is slow because of copying, not because of accounting.",
        made=["picture"],
        steps=[("Wrote the post for LinkedIn", KIMI), ("Drew a calm picture for it, 16:9", Z)],
        alts={"picture": "A calm minimal desk at dawn, a closed laptop and a coffee"}),
    "campaign-pack": dict(look="pack", brand="wildstemflowers", platform="instagram",
        given="One brief: Mother’s Day bouquets from Wild Stem, order by Thursday.",
        made=["picture", "reel"],
        steps=[("Drew the hero picture and three moments for the slideshow", Z), ("Wrote the headline, the lines, the caption and a short post", KIMI), ("Drew the headline on the picture", FLOW), ("Read the lines (The Upbeat) and wrote a song", VS + " · " + ACE), ("Put the slideshow together", FLOW)],
        alts={"picture": "Spring bouquets with the headline drawn on", "reel": "Bouquets moving, a voice reading the lines"}),
}

BRANDS = {"lowtidecoffee": "lowtidecoffee", "maisoncire": "maisoncire", "kilnandco": "kilnandco", "dewtheory": "dewtheory", "wildstemflowers": "wildstemflowers",
          "osterianove": "osterianove", "northlineruns": "northlineruns", "marginsbooks": "marginsbooks", "ledgerly": "ledgerly"}


def media(key, ref, alts):
    if ref.startswith("old:"):
        return dict(OLD[ref[4:]])
    if ref.startswith("tp:"):
        key, ref = "talking-portrait", ref[3:]
    m = manifest.get(key, {}).get("media", {}).get(ref)
    if not m:
        return None
    m = dict(m)
    m["alt"] = alts.get(ref, "")
    return m


def ts(v, indent=2):
    return json.dumps(v, ensure_ascii=False, indent=indent)


lines = ["import { BRANDS } from './cases'", "import type { LabExample } from './lab'", "",
         "/* Made by gen-lab-examples.py from the runs; the words and files are what the nodes made. */", "",
         "export const LAB_EXAMPLES: Record<string, LabExample> = {"]
missing = []
for key, e in EX.items():
    alts = e.get("alts", {})
    made = [media(key, r, alts) for r in e["made"]]
    panes = [(media(key, r, alts), label) for r, label in e.get("panes", [])]
    frm = media(key, e["frm"], alts) if e.get("frm") else None
    if any(m is None for m in made) or any(m is None for m, _ in panes) or (e.get("frm") and frm is None):
        missing.append(key)
        continue
    if key == "recording-to-posts":
        pass
    written = manifest.get(key, {}).get("words") or {}  # PHP writes an empty one as []
    words = e.get("words") or list(written.items())
    obj = {
        "key": key, "look": e["look"], "platform": e["platform"], "given": e["given"],
        **({"from": frm} if frm else {}),
        "made": made,
        **({"panes": [{"m": m, "label": label} for m, label in panes]} if panes else {}),
        "words": [{"label": k, "text": v} for k, v in words],
        "steps": [{"did": d, "model": m} for d, m in e["steps"]],
        **({"note": e["note"]} if e.get("note") else {}),
    }
    body = ts(obj, 2).replace("\n", "\n  ")
    body = body[:1] + f"\n    brand: BRANDS.{BRANDS[e['brand']]}," + body[1:]
    lines.append(f"  {json.dumps(key)}: {body},")
lines.append("}")
lines.append("")
import re
text = re.sub(r'^(\s*)"([A-Za-z_]\w*)": ', r'\1\2: ', "\n".join(lines), flags=re.M)
open(out_path, "w").write(text)
print("written", len(EX) - len(missing), "missing", missing)
