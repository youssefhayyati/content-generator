"""The voices FlowAI offers: the best of Kokoro's, each with a name people can pick by."""

VOICES = [
    # American English
    {"id": "af_heart", "name": "Heart", "lang": "en-us", "language": "English · US", "gender": "female", "style": "Warm and close, like a friend telling you something good."},
    {"id": "af_bella", "name": "Bella", "lang": "en-us", "language": "English · US", "gender": "female", "style": "Bright and upbeat, made for launches."},
    {"id": "af_nicole", "name": "Nicole", "lang": "en-us", "language": "English · US", "gender": "female", "style": "Soft, almost a whisper. Slow content, ASMR, night posts."},
    {"id": "af_aoede", "name": "Aoede", "lang": "en-us", "language": "English · US", "gender": "female", "style": "Light and airy, a little dreamy."},
    {"id": "af_kore", "name": "Kore", "lang": "en-us", "language": "English · US", "gender": "female", "style": "Clear and confident, good for tips and how-tos."},
    {"id": "af_sarah", "name": "Sarah", "lang": "en-us", "language": "English · US", "gender": "female", "style": "Easy and conversational."},
    {"id": "am_michael", "name": "Michael", "lang": "en-us", "language": "English · US", "gender": "male", "style": "Calm and steady, a voice you trust."},
    {"id": "am_fenrir", "name": "Fenrir", "lang": "en-us", "language": "English · US", "gender": "male", "style": "Deep and confident, a trailer voice."},
    {"id": "am_puck", "name": "Puck", "lang": "en-us", "language": "English · US", "gender": "male", "style": "Playful and quick."},
    # British English
    {"id": "bf_emma", "name": "Emma", "lang": "en-gb", "language": "English · UK", "gender": "female", "style": "Poised and polished."},
    {"id": "bf_isabella", "name": "Isabella", "lang": "en-gb", "language": "English · UK", "gender": "female", "style": "Elegant, a touch of luxury."},
    {"id": "bm_george", "name": "George", "lang": "en-gb", "language": "English · UK", "gender": "male", "style": "Seasoned and warm, a storyteller."},
    {"id": "bm_fable", "name": "Fable", "lang": "en-gb", "language": "English · UK", "gender": "male", "style": "Gentle and thoughtful."},
    # Other languages
    {"id": "ff_siwis", "name": "Siwis", "lang": "fr-fr", "language": "Français", "gender": "female", "style": "Française, douce et naturelle."},
    {"id": "ef_dora", "name": "Dora", "lang": "es", "language": "Español", "gender": "female", "style": "Cálida y cercana."},
    {"id": "em_alex", "name": "Álex", "lang": "es", "language": "Español", "gender": "male", "style": "Firme y amable."},
    {"id": "if_sara", "name": "Sara", "lang": "it", "language": "Italiano", "gender": "female", "style": "Solare e chiara."},
    {"id": "im_nicola", "name": "Nicola", "lang": "it", "language": "Italiano", "gender": "male", "style": "Calmo e rassicurante."},
    {"id": "pf_dora", "name": "Dora", "lang": "pt-br", "language": "Português · BR", "gender": "female", "style": "Leve e simpática."},
    {"id": "pm_alex", "name": "Alex", "lang": "pt-br", "language": "Português · BR", "gender": "male", "style": "Tranquilo e direto."},
    {"id": "hf_alpha", "name": "Alpha", "lang": "hi", "language": "हिन्दी", "gender": "female", "style": "Saaf aur madhur."},
    {"id": "hm_omega", "name": "Omega", "lang": "hi", "language": "हिन्दी", "gender": "male", "style": "Gehri aur sthir."},
]

# What each voice says when someone presses play on it.
SAMPLES = {
    "en-us": "Forty candles at a time, poured slow in a small studio. This is how it sounds when your posts speak.",
    "en-gb": "Forty candles at a time, poured slowly in a small studio. This is how your posts could sound.",
    "fr-fr": "Quarante bougies à la fois, coulées lentement dans un petit atelier. Voilà comment vos posts peuvent sonner.",
    "es": "Cuarenta velas a la vez, vertidas despacio en un pequeño taller. Así pueden sonar tus publicaciones.",
    "it": "Quaranta candele alla volta, colate lentamente in un piccolo laboratorio. Ecco come possono suonare i tuoi post.",
    "pt-br": "Quarenta velas de cada vez, derramadas devagar num pequeno ateliê. É assim que seus posts podem soar.",
    "hi": "एक बार में चालीस मोमबत्तियाँ, एक छोटे स्टूडियो में धीरे से ढाली गईं। आपके पोस्ट ऐसे सुनाई दे सकते हैं।",
}

# Whisper's language code for each Kokoro language.
WHISPER_LANG = {"en-us": "en", "en-gb": "en", "fr-fr": "fr", "es": "es", "it": "it", "pt-br": "pt", "hi": "hi"}


def by_id(voice_id: str):
    return next((v for v in VOICES if v["id"] == voice_id), None)
