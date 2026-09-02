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


def host_code(card):
    """Which host serves this card's art. digimondle already resolved this."""
    primary = (card.get("image") or {}).get("primary") or ""
    for i, tmpl in enumerate(HOSTS):
        if tmpl.split("/")[2] in primary:
            return i
    return 0


def main():
    with open(SRC, encoding="utf-8") as fh:
        source = json.load(fh)

    seen, cards = set(), []
    for card in source:
        cid = card.get("id")
        # 15 rows carry no cardType and can't be deckbuilt; drop with the dupes.
        if not cid or cid in seen or not card.get("cardType"):
            continue
        seen.add(cid)

        out = {k: card[k] for k in KEEP if card.get(k) not in (None, "", [], False)}
        out["id"] = cid
        out["released"] = bool(card.get("released"))
        out["h"] = host_code(card)

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


if __name__ == "__main__":
    main()
