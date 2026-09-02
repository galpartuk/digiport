import type { CardIndex } from './cards'
import { importDeck, type Deck } from './deck'

/**
 * Decks that ship with Digiport, so a first visit does not begin with an empty
 * 50-card hole. They are stored as plain deck lists in the same format the
 * import box takes, which means they go through the same tested parser as
 * anything a player pastes — a preset that stops resolving after a data
 * refresh will fail its test rather than quietly losing cards.
 */
export type Preset = {
  id: string
  name: string
  /** One line, shown under the name. What the deck wants to do. */
  blurb: string
  list: string
}

export const PRESETS: Preset[] = [
  {
    id: 'xros-heart',
    name: 'Xros Heart',
    blurb: 'Red aggro. Chain Shoutmon into X7, with Taiki keeping the memory swinging back.',
    list: `// Egg deck
4 BT10-003 Pickmons

// Main deck
3 BT10-029 Starmons
4 BT19-008 Shoutmon
2 BT19-057 Sparrowmon
3 BT19-035 ShootingStarmon
3 BT19-061 RaptorSparrowmon
1 BT19-012 OmniShoutmon
3 BT19-038 JaegerDorulumon
3 BT19-051 AtlurBallistamon
4 BT21-021 OmniShoutmon
3 AD1-013 ZeigGreymon
2 BT19-014 Shoutmon EX6
4 AD1-006 Shoutmon X7
2 BT8-095 Fire Rocket
4 BT10-087 Taiki Kudo
3 P-224 Kotone Amano
3 BT11-095 Taiki, Kiriha, & Nene
3 BT21-083 Taiki Kudo`,
  },
]

/** A fresh deck built from a preset. Gets its own id, so it is the player's copy. */
export function deckFromPreset(preset: Preset, index: CardIndex): Deck {
  return importDeck(preset.list, index, preset.name).deck
}

/** Ids in a preset that the current card pool does not know. Empty is the only good answer. */
export function presetMisses(preset: Preset, index: CardIndex): string[] {
  return importDeck(preset.list, index).missing
}
