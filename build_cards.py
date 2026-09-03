"""Turn digimondle's merged card record into the Digiport payload.

Source: C:/Users/Owner/digimondle/data/build/cards.json  (TakaOtaku MIT + digimoncard.io)
Output: web/public/data/cards.json + meta.json

The payload is trimmed for the browser: image URLs collapse to a one-byte host
code that the client re-expands, and every null/empty field is dropped. Field
names stay the same as the source so the two projects can share a vocabulary.
"""
import json
import os
import collections

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "digimondle", "data", "build", "cards.json")
# digimondle's build does not carry Assembly or Burst Digivolve through, so those
# two come straight from the TakaOtaku file it already downloads. Read-only.
RAW = os.path.join(HERE, "..", "digimondle", "data", "raw", "takaotaku_cards.json")
OUT_DIR = os.path.join(HERE, "web", "public", "data")

# Host code -> URL template, re-expanded client-side in src/cards.ts
HOSTS = [
    "https://digimoncard.app/assets/images/cards/{id}.webp",
    "https://images.digimoncard.io/images/cards/{id}.jpg",
    "https://world.digimoncard.com/images/cardlist/card/{id}.png",
]

# Kept verbatim when truthy. Everything else in the source is deckbuilder noise.
KEEP = [
    "id", "name", "cardType", "colors", "level", "playCost", "dp", "form",
    "attribute", "types", "rarity", "setCode", "setPrefix", "setCategory",
    "effect", "inheritedEffect", "securityEffect", "digivolveCondition",
    "digiXros", "dnaDigivolve", "aceEffect", "linkRequirement", "linkDP",
    "rule", "restriction", "released", "altArtCount", "tcgplayerId",
    "setReleased",
]

# Requirement text the board turns into a "you can do this" button. Each names
# the other cards involved, which is what makes an assisted picker possible.
EXTRA_SOURCES = ("assembly", "burstDigivolve")

# Which rule a line actually states, read off its printed header rather than
# off the field it arrived in. Upstream mis-files three cards -- EX12-015,
# EX12-029 and EX12-056 all carry "[DigiXros -2] ..." in `assembly` with
# `digiXros` empty -- and a header is what a player reads, so it is the more
# trustworthy of the two.
HEADERS = [
    ("[DigiXros", "digiXros"),
    ("[Assembly", "assembly"),
    ("[Burst Digivolve", "burstDigivolve"),
]


def host_code(card):
    """Which host serves this card's art. digimondle already resolved this."""
    primary = (card.get("image") or {}).get("primary") or ""
    for i, tmpl in enumerate(HOSTS):
        if tmpl.split("/")[2] in primary:
            return i
    return 0


def is_released(card):
    """digimondle's release flag, with the P and LM gap closed.

    TakaOtaku's `restrictions.english` goes stale, and digimondle only overrides
    it for cards that belong to a set with a known English release date. P and
    LM are not single sets and have no such date, so the stale flag was the only
    thing deciding for them -- which hid 56 cards that are demonstrably in
    print: Arcturusmon (P-240), the whole Training cycle, the Memory Boost!
    cycle, the Time Stranger promo pack and the Unique Emblems.

    digimoncard.io naming an actual pack the card was printed in is the better
    signal, and it is already merged into `printedIn`. The handful with no
    printing at all (P-245..P-250, which carry no date either) stay hidden and
    remain reachable behind the "include unreleased" filter.
    """
    if card.get("released"):
        return True
    return bool(card.get("printedIn"))


def extras():
    """Assembly and Burst Digivolve text, keyed by card number.

    TakaOtaku writes "-" for a card that has none, which is not the same as
    having one, so those are dropped rather than shipped as a literal dash.
    """
    try:
        with open(RAW, encoding="utf-8") as fh:
            raw = json.load(fh)
    except FileNotFoundError:
        print("note: raw TakaOtaku file missing, Assembly/Burst omitted")
        return {}
    out = {}
    for row in raw:
        number = row.get("cardNumber")
        if not number:
            continue
        picked = {}
        for src_key in EXTRA_SOURCES:
            text = (row.get(src_key) or "").strip()
            if not text or text == "-":
                continue
            key = next((k for head, k in HEADERS if text.startswith(head)), src_key)
            picked.setdefault(key, text)
        if picked:
            out[number] = picked
    return out


def main():
    with open(SRC, encoding="utf-8") as fh:
        source = json.load(fh)
    extra = extras()

    seen, cards = set(), []
    for card in source:
        cid = card.get("id")
        # 15 rows carry no cardType and can't be deckbuilt; drop with the dupes.
        if not cid or cid in seen or not card.get("cardType"):
            continue
        seen.add(cid)

        out = {k: card[k] for k in KEEP if card.get(k) not in (None, "", [], False)}
        out["id"] = cid
        out["released"] = is_released(card)
        out["h"] = host_code(card)

        for key, text in extra.get(cid, {}).items():
            out.setdefault(key, text)

        jp = (card.get("names") or {}).get("japanese")
        if jp:
            out["jp"] = jp
        cards.append(out)

    cards.sort(key=lambda c: (c["setPrefix"], c["id"]))

    meta = {
        "count": len(cards),
        "hosts": HOSTS,
        "sets": sorted({c["setCode"] for c in cards}),
        "types": sorted({t for c in cards for t in c.get("types", [])}),
        "banned": sorted(c["id"] for c in cards if c.get("restriction") == "Banned"),
        "restricted": sorted(c["id"] for c in cards
                             if c.get("restriction") == "Restricted to 1"),
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    for name, blob in (("cards.json", cards), ("meta.json", meta)):
        path = os.path.join(OUT_DIR, name)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(blob, fh, ensure_ascii=False, separators=(",", ":"))
        print("%-11s %7.1f KB" % (name, os.path.getsize(path) / 1024))

    by_type = collections.Counter(c["cardType"] for c in cards)
    print("cards      %7d  (%s)" % (
        len(cards), ", ".join("%s %d" % kv for kv in by_type.most_common())))
    print("banned     %7d   restricted %d" % (len(meta["banned"]), len(meta["restricted"])))
    hidden = [c["id"] for c in cards if not c["released"]]
    promoted = sum(1 for c in source
                   if c.get("cardType") and not c.get("released") and c.get("printedIn"))
    for key in ("digiXros", "assembly", "burstDigivolve"):
        print("%-11s%7d   cards with %s requirements"
              % ("", sum(1 for c in cards if c.get(key)), key))
    print("released   %7d   (%d promoted past a stale flag)  still hidden: %s"
          % (sum(1 for c in cards if c["released"]), promoted, ", ".join(hidden) or "none"))


if __name__ == "__main__":
    main()
