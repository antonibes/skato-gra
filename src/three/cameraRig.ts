import * as THREE from "three";
import { BOARD_HALF, BOARD_FRAME_THICKNESS } from "./config";

export interface CameraPose {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
}

// Must cover the frame's actual outer edge (board + full frame thickness), not just the
// playing surface, or the frame's outer rim gets clipped at the screen edge.
const FIT_HALF_WIDTH = BOARD_HALF + BOARD_FRAME_THICKNESS + 0.25;
// On the menu screen the board spins continuously as an idle animation. A rotating square's
// corner sweeps out to half-width * sqrt(2) at 45°, so the menu camera needs that much extra
// room or the frame's corner clips out of frame partway through the spin.
const MENU_FIT_HALF_WIDTH = FIT_HALF_WIDTH * Math.SQRT2;
const FIT_SAFETY = 1.15;

// Kept comfortably away from 0° (straight down) — too close to vertical makes camera.lookAt's
// internal up-vector math nearly degenerate and can skew the view asymmetrically.
const MENU_ELEVATION_DEG = 36;
const MENU_FORWARD_BIAS = 0.5;

// Flatter (closer to top-down) than before — on a phone, a finger dragging a piece at a steeper
// tilt covers more of the target cell. Lower elevation trades a bit of the "sitting at the
// table" depth feel for a clearer, more occlusion-resistant view of the grid.
const GAME_ELEVATION_DEG = 20;
const GAME_FORWARD_BIAS = 1.8;

// A near-top-down "map" overview shown once the game ends. Reuses the same elevation already
// proven fine during actual gameplay (GAME_ELEVATION_DEG) rather than pushing flatter — an
// earlier, much flatter (10°) + tightly-cropped attempt pushed the board's corners out toward
// the edge of the frame, right where a rectilinear lens's wide-angle stretching is most visible
// (a flat grid's far corners visibly bow/stretch, the "fisheye at the edges" look). Pulling back
// to a looser fit keeps the board's corners closer to the frame center, away from that stretch.
const END_ELEVATION_DEG = 20;
const END_FORWARD_BIAS = 0;
// Baskets are hidden outright when the result screen shows (see main.ts), so this only needs to
// frame the board+frame itself — loosened from an initial edge-hugging fit (see note above).
const END_FIT_HALF_WIDTH = FIT_HALF_WIDTH * 1.15;
// Aims the camera at a point below board level instead of the board surface itself, which
// pushes the board's projection up toward the top of the frame — freeing the lower portion of
// the screen for the result card to sit in without burying the board underneath it. This has
// strongly diminishing returns (verified against projected frame-corner coordinates), so it's
// pushed close to where the extra shift stops being worth the tradeoff.
const END_LOOK_AT_Y_OFFSET = -7;

/** Distance from the board center a camera with this fov/aspect needs, so the
 *  full board fits inside the frustum. Prevents extreme zooming on wide screens. */
function fitDistance(camera: THREE.PerspectiveCamera, halfWidth: number): number {
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const halfFovY = verticalFov / 2;
  const tanHalfFovY = Math.tan(halfFovY);

  if (camera.aspect >= 1) {
    // Wide screen: fit vertically
    return (halfWidth * FIT_SAFETY) / tanHalfFovY;
  } else {
    // Narrow screen: fit horizontally
    const tanHalfFovX = tanHalfFovY * camera.aspect;
    return (halfWidth * FIT_SAFETY) / tanHalfFovX;
  }
}

function poseForElevation(
  camera: THREE.PerspectiveCamera,
  elevationDeg: number,
  forwardBias: number,
  halfWidth: number,
  lookAtYOffset = 0
): CameraPose {
  const distance = fitDistance(camera, halfWidth);
  const elevationRad = THREE.MathUtils.degToRad(elevationDeg);
  const y = distance * Math.cos(elevationRad);
  const z = distance * Math.sin(elevationRad) + forwardBias;
  return {
    position: new THREE.Vector3(0, y, z),
    lookAt: new THREE.Vector3(0, lookAtYOffset, forwardBias * 0.35),
  };
}

export function menuPose(camera: THREE.PerspectiveCamera): CameraPose {
  return poseForElevation(camera, MENU_ELEVATION_DEG, MENU_FORWARD_BIAS, MENU_FIT_HALF_WIDTH);
}

export function gamePose(camera: THREE.PerspectiveCamera): CameraPose {
  return poseForElevation(camera, GAME_ELEVATION_DEG, GAME_FORWARD_BIAS, FIT_HALF_WIDTH);
}

export function endPose(camera: THREE.PerspectiveCamera): CameraPose {
  return poseForElevation(camera, END_ELEVATION_DEG, END_FORWARD_BIAS, END_FIT_HALF_WIDTH, END_LOOK_AT_Y_OFFSET);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function animateCameraTo(
  camera: THREE.PerspectiveCamera,
  from: CameraPose,
  to: CameraPose,
  duration: number,
  onComplete?: () => void
): void {
  const start = performance.now();
  const position = from.position.clone();
  const lookAt = from.lookAt.clone();

  function step(now: number) {
    const t = Math.min((now - start) / duration, 1);
    const eased = easeInOutCubic(t);

    position.lerpVectors(from.position, to.position, eased);
    lookAt.lerpVectors(from.lookAt, to.lookAt, eased);

    camera.position.copy(position);
    camera.lookAt(lookAt);

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      onComplete?.();
    }
  }

  requestAnimationFrame(step);
}
