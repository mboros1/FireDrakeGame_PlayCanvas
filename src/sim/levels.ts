/**
 * The level registry. This module must never import `playcanvas`.
 *
 * Built-in levels are JSON files bundled into both the client and the room
 * server, and validated on load like any other level, so a hand-edited file
 * that breaks the rules fails at startup rather than mid-game.
 */

import littleKindling from '../levels/little-kindling.json' with { type: 'json' };
import { validateLevel, type LevelDefinition } from './level';

export const DEFAULT_LEVEL = 'little-kindling';

const BUILT_IN: Record<string, LevelDefinition> = {
  'little-kindling': validateLevel(littleKindling)
};

export const levelIds = () => Object.keys(BUILT_IN);

/** A built-in level by id, or the default level for an unknown id. */
export const getLevel = (id: string = DEFAULT_LEVEL): LevelDefinition => BUILT_IN[id] ?? BUILT_IN[DEFAULT_LEVEL];
