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

const GAME_ELEVATION_DEG = 28;
const GAME_FORWARD_BIAS = 1.8;

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
  halfWidth: number
): CameraPose {
  const distance = fitDistance(camera, halfWidth);
  const elevationRad = THREE.MathUtils.degToRad(elevationDeg);
  const y = distance * Math.cos(elevationRad);
  const z = distance * Math.sin(elevationRad) + forwardBias;
  return {
    position: new THREE.Vector3(0, y, z),
    lookAt: new THREE.Vector3(0, 0, forwardBias * 0.35),
  };
}

export function menuPose(camera: THREE.PerspectiveCamera): CameraPose {
  return poseForElevation(camera, MENU_ELEVATION_DEG, MENU_FORWARD_BIAS, MENU_FIT_HALF_WIDTH);
}

export function gamePose(camera: THREE.PerspectiveCamera): CameraPose {
  return poseForElevation(camera, GAME_ELEVATION_DEG, GAME_FORWARD_BIAS, FIT_HALF_WIDTH);
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
