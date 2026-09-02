import type { Action, DeckList, Iid, PlayerId, Position, Zone } from './types'

/**
 * Constructors for every action. The reducer accepts plain objects, so these
 * are only convenience — but they keep `by` from being forgotten, which is the
 * one field every action needs and the one the UI is most likely to drop.
 */
export const act = {
  setup: (
    by: PlayerId,
    decks: [DeckList, DeckList],
    names: [string, string],
    firstPlayer: PlayerId,
    seed?: number,
  ): Action => ({ t: 'setup', by, decks, names, firstPlayer, seed }),

  mulligan: (by: PlayerId): Action => ({ t: 'mulligan', by }),
  draw: (by: PlayerId, n = 1): Action => ({ t: 'draw', by, n }),
  shuffleDeck: (by: PlayerId): Action => ({ t: 'shuffleDeck', by }),
  shuffleSecurity: (by: PlayerId): Action => ({ t: 'shuffleSecurity', by }),
  hatch: (by: PlayerId): Action => ({ t: 'hatch', by }),

  move: (
    by: PlayerId,
    iid: Iid,
    to: Zone,
    opts: { position?: Position; faceDown?: boolean } = {},
  ): Action => ({ t: 'move', by, iid, to, ...opts }),

  digivolve: (by: PlayerId, sourceIid: Iid, cardIid: Iid): Action =>
    ({ t: 'digivolve', by, sourceIid, cardIid }),
  deDigivolve: (by: PlayerId, iid: Iid, n = 1): Action => ({ t: 'deDigivolve', by, iid, n }),
  attach: (by: PlayerId, iid: Iid, targetIid: Iid): Action =>
    ({ t: 'attach', by, iid, targetIid }),

  suspend: (by: PlayerId, iid: Iid): Action => ({ t: 'suspend', by, iid }),
  unsuspend: (by: PlayerId, iid: Iid): Action => ({ t: 'unsuspend', by, iid }),
  unsuspendAll: (by: PlayerId): Action => ({ t: 'unsuspendAll', by }),

  setDp: (by: PlayerId, iid: Iid, delta: number): Action => ({ t: 'setDp', by, iid, delta }),
  setCounters: (by: PlayerId, iid: Iid, delta: number): Action =>
    ({ t: 'setCounters', by, iid, delta }),

  setMemory: (by: PlayerId, value: number): Action => ({ t: 'setMemory', by, value }),
  payMemory: (by: PlayerId, cost: number): Action => ({ t: 'payMemory', by, cost }),

  nextPhase: (by: PlayerId): Action => ({ t: 'nextPhase', by }),
  endTurn: (by: PlayerId): Action => ({ t: 'endTurn', by }),

  securityCheck: (by: PlayerId): Action => ({ t: 'securityCheck', by }),
  revealTop: (by: PlayerId, n = 1): Action => ({ t: 'revealTop', by, n }),
  revealHand: (by: PlayerId): Action => ({ t: 'revealHand', by }),
  flip: (by: PlayerId, iid: Iid): Action => ({ t: 'flip', by, iid }),

  concede: (by: PlayerId): Action => ({ t: 'concede', by }),
  chat: (by: PlayerId, text: string): Action => ({ t: 'chat', by, text }),

  undoRequest: (by: PlayerId): Action => ({ t: 'undoRequest', by }),
  undoAccept: (by: PlayerId): Action => ({ t: 'undoAccept', by }),
  undoDecline: (by: PlayerId): Action => ({ t: 'undoDecline', by }),
}
