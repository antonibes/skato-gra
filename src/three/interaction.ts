import * as THREE from "three";
import {
  PIECE_HEIGHT,
  PIECE_SIZE,
  DRAG_HEIGHT,
  GRAVITY,
  BOUNCE_DAMPING,
  MIN_BOUNCE_SPEED,
  TRAY_PIECES_PER_LAYER,
  cellToWorld,
  worldToCell,
} from "./config";
import { randomTraySpot, type Piece, type PieceOwner } from "./pieces";
import { isLegalMove, applyMove, type GameState } from "../game/rules";
import { playPickup, playPlace } from "../audio/sound";

export interface Tray {
  owner: PieceOwner;
  origin: { x: number; z: number };
  pieces: Piece[];
}

interface FallingPiece {
  piece: Piece;
  velocityY: number;
  targetY: number;
}

// Raycast against the board surface (y=0), not the piece's lifted drag height — otherwise the
// elevated camera creates a parallax offset between where you point and where the piece lands.
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// A tap doesn't need to land exactly inside a piece's own footprint — this is the effective
// touch target radius (in world units) used as a fallback when the precise raycast misses.
const PICKUP_TOLERANCE = PIECE_SIZE * 1.3;

export interface DragCandidate {
  col: number;
  row: number;
  legal: boolean;
}

export interface Interaction {
  update: (delta: number) => boolean;
  placeForOwner: (tray: Tray, col: number, row: number) => boolean;
  dropIn: (piece: Piece, targetY: number) => void;
}

export function setupInteraction(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  trays: Tray[],
  state: GameState,
  onChange: () => void,
  getHumanOwner: () => PieceOwner | null,
  onDragUpdate: (candidate: DragCandidate | null) => void = () => {}
): Interaction {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const falling: FallingPiece[] = [];

  let dragging: { piece: Piece; tray: Tray } | null = null;

  function updatePointer(event: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function isPlayableByTouch(tray: Tray): boolean {
    if (tray.owner !== state.current) return false;
    const humanOwner = getHumanOwner();
    return humanOwner === null || tray.owner === humanOwner;
  }

  /** Fallback for imprecise touch: finds the nearest pickable piece to where the ray crosses
   *  that piece's own height, within a forgiving radius — used only when the exact-geometry
   *  raycast below misses, so slightly missing a small piece on a phone screen still works. */
  function nearestPieceWithinTolerance(): { piece: Piece; tray: Tray } | null {
    raycaster.setFromCamera(pointer, camera);
    let best: { piece: Piece; tray: Tray; dist: number } | null = null;

    for (const tray of trays) {
      if (!isPlayableByTouch(tray)) continue;
      for (const piece of tray.pieces) {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -piece.mesh.position.y);
        const point = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(plane, point)) continue;
        const dist = Math.hypot(point.x - piece.mesh.position.x, point.z - piece.mesh.position.z);
        if (dist <= PICKUP_TOLERANCE && (!best || dist < best.dist)) {
          best = { piece, tray, dist };
        }
      }
    }

    return best ? { piece: best.piece, tray: best.tray } : null;
  }

  function pieceAtPointer(): { piece: Piece; tray: Tray } | null {
    raycaster.setFromCamera(pointer, camera);
    for (const tray of trays) {
      if (!isPlayableByTouch(tray)) continue;
      const meshes = tray.pieces.map((p) => p.mesh);
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length > 0) {
        const mesh = hits[0].object;
        const piece = tray.pieces.find((p) => p.mesh === mesh);
        if (piece) return { piece, tray };
      }
    }
    return nearestPieceWithinTolerance();
  }

  function dropInto(piece: Piece, targetY: number) {
    falling.push({ piece, velocityY: 0, targetY });
  }

  function returnToTray(piece: Piece, tray: Tray) {
    piece.mesh.castShadow = true;
    const layer = Math.floor(tray.pieces.length / TRAY_PIECES_PER_LAYER);
    const spot = randomTraySpot(tray.origin, layer);
    piece.mesh.position.x = spot.x;
    piece.mesh.position.z = spot.z;
    tray.pieces.push(piece);
    dropInto(piece, spot.y);
  }

  function commitPlacement(piece: Piece, col: number, row: number) {
    piece.mesh.castShadow = true;
    const world = cellToWorld(col, row);
    piece.mesh.position.x = world.x;
    piece.mesh.position.z = world.z;
    piece.mesh.rotation.y = 0;
    piece.placed = true;
    dropInto(piece, PIECE_HEIGHT / 2);
    playPlace();
    applyMove(state, piece.owner, col, row);
    onChange();
  }

  function onPointerDown(event: PointerEvent) {
    if (state.over) return;
    updatePointer(event);
    const hit = pieceAtPointer();
    if (!hit) return;

    try {
      renderer.domElement.setPointerCapture(event.pointerId);
    } catch {
      // some mobile browsers reject capture on rapid re-touch — the drag still works without it
    }
    const { piece, tray } = hit;
    tray.pieces.splice(tray.pieces.indexOf(piece), 1);
    dragging = { piece, tray };
    piece.mesh.position.y = DRAG_HEIGHT;
    // No cast shadow while airborne — the live gold/red cell highlight is the authoritative
    // "where will this land" indicator; a real cast shadow at this height would drift away from
    // it (light isn't perfectly vertical) and read as a second, conflicting target.
    piece.mesh.castShadow = false;
    playPickup();
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const point = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, point)) {
      dragging.piece.mesh.position.x = point.x;
      dragging.piece.mesh.position.z = point.z;
      const { col, row } = worldToCell(point.x, point.z);
      onDragUpdate({ col, row, legal: isLegalMove(state, col, row) });
    }
  }

  function onPointerUp(event: PointerEvent) {
    if (!dragging) return;
    const { piece, tray } = dragging;
    dragging = null;
    onDragUpdate(null);

    const { x, z } = piece.mesh.position;
    const { col, row } = worldToCell(x, z);

    if (isLegalMove(state, col, row)) {
      commitPlacement(piece, col, row);
    } else {
      returnToTray(piece, tray);
    }

    try {
      renderer.domElement.releasePointerCapture(event.pointerId);
    } catch {
      // pointer capture may already have been released by the browser (e.g. touch-cancel) — safe to ignore
    }
  }

  const dom = renderer.domElement;
  dom.addEventListener("pointerdown", onPointerDown);
  dom.addEventListener("pointermove", onPointerMove);
  dom.addEventListener("pointerup", onPointerUp);
  dom.addEventListener("pointercancel", onPointerUp);

  /** Returns whether anything actually moved this frame — used to decide whether the shadow
   *  map needs recomputing (see scene.ts: it's frozen by default for performance). */
  function update(delta: number): boolean {
    const wasActive = falling.length > 0 || dragging !== null;

    for (let i = falling.length - 1; i >= 0; i--) {
      const fp = falling[i];
      fp.velocityY += GRAVITY * delta;
      const nextY = fp.piece.mesh.position.y + fp.velocityY * delta;

      if (nextY <= fp.targetY) {
        fp.piece.mesh.position.y = fp.targetY;
        if (Math.abs(fp.velocityY) > MIN_BOUNCE_SPEED) {
          fp.velocityY = -fp.velocityY * BOUNCE_DAMPING;
        } else {
          falling.splice(i, 1);
        }
      } else {
        fp.piece.mesh.position.y = nextY;
      }
    }

    return wasActive || falling.length > 0 || dragging !== null;
  }

  function placeForOwner(tray: Tray, col: number, row: number): boolean {
    if (!isLegalMove(state, col, row)) return false;
    const piece = tray.pieces.pop();
    if (!piece) return false;
    piece.mesh.position.y = DRAG_HEIGHT;
    commitPlacement(piece, col, row);
    return true;
  }

  return { update, placeForOwner, dropIn: dropInto };
}
