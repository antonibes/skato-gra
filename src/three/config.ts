export const BOARD_SIZE = 8;
export const CELL_SIZE = 1;
export const BOARD_HALF = (BOARD_SIZE * CELL_SIZE) / 2;
export const PIECE_COUNT = 32;

export const PIECE_HEIGHT = 0.16;
export const PIECE_SIZE = 0.74;

export const BOARD_FRAME_THICKNESS = 0.42;

export const TRAY_RADIUS = 1.25;
export const TRAY_WALL_HEIGHT = 0.56;
export const TRAY_FLOOR_Y = 0.02;
export const TRAY_PIECES_PER_LAYER = 20;
export const TRAY_BOARD_MARGIN = 1.3;

// Held above the board while dragging. Visibility doesn't depend on this being tall — the
// screen-space aim offset (see interaction.ts) handles that — so it can sit very close to the
// board surface for a grounded, "sliding just above the grid" feel.
export const DRAG_HEIGHT = 0.7;
export const GRAVITY = -16;
export const BOUNCE_DAMPING = 0.32;
export const MIN_BOUNCE_SPEED = 0.55;

// Generous enough to fill the frame at any camera angle/rotation, without being wastefully
// larger than what's ever actually visible (120 was ~9x the area anything needs, pure overdraw).
export const TABLE_WIDTH = 60;
export const TABLE_DEPTH = 60;

export const COLOR = {
  graphite900: 0x1d1f23,
  graphite800: 0x26282e,
  woodDark: 0x3c2818,
  wood: 0x6b4a30,
  woodLight: 0x8a6440,
  gold: 0xc9a24b,
  green: 0x0f854b,
  blue: 0x184ea1,
  tableOak: 0xb98a56,
  basket: 0x8a5a34,
} as const;

export function cellToWorld(col: number, row: number): { x: number; z: number } {
  return {
    x: -BOARD_HALF + CELL_SIZE / 2 + col * CELL_SIZE,
    z: -BOARD_HALF + CELL_SIZE / 2 + row * CELL_SIZE,
  };
}

export function worldToCell(x: number, z: number): { col: number; row: number } {
  return {
    col: Math.floor((x + BOARD_HALF) / CELL_SIZE),
    row: Math.floor((z + BOARD_HALF) / CELL_SIZE),
  };
}

export function isCellOnBoard(col: number, row: number): boolean {
  return col >= 0 && col < BOARD_SIZE && row >= 0 && row < BOARD_SIZE;
}
