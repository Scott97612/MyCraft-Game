import { Camera, Raycaster, Vector3, Vector2, Object3D, Intersection } from 'three';
import { Block } from './types';

// Constants for configuration
const MAX_DISTANCE = 5; // Max interaction distance (5 blocks)
const INTERACTION_COOLDOWN = 250; // ms cooldown between interactions
const DEBUG_RAYCASTING = false; // Enable for detailed debugging output

// Create a persistent raycaster instance
const raycaster = new Raycaster();
// Center screen coordinates
const screenCenter = new Vector2(0, 0);

// Configure the raycaster
raycaster.params.Points.threshold = 0.1;
raycaster.far = MAX_DISTANCE;

// Track the currently targeted block
let targetedBlock: { block: Block, face: number, distance: number } | null = null;
let lastInteractionTime = 0;

// Face direction mapping (for block placement)
const faceDirections = [
  [1, 0, 0],  // right (0)
  [-1, 0, 0], // left (1)
  [0, 1, 0],  // top (2)
  [0, -1, 0], // bottom (3)
  [0, 0, 1],  // front (4)
  [0, 0, -1], // back (5)
];

/**
 * Cast a ray from the camera center (crosshair) to find targeted block
 */
export function updateRaycast(camera: Camera, objects: Object3D[]): { 
  hasTarget: boolean, 
  position?: { x: number, y: number, z: number }, 
  face?: number,
  placePosition?: { x: number, y: number, z: number },
  distance?: number
} {
  // Update the raycaster with the camera position/direction
  raycaster.setFromCamera(screenCenter, camera);
  
  if (DEBUG_RAYCASTING) {
    console.log("[RAYCAST] Casting ray from camera at", 
      camera.position.toArray().map(v => v.toFixed(2)).join(", "));
  }
  
  // Find all intersections
  const intersects = raycaster.intersectObjects(objects, true);
  
  // Debug all found intersections
  if (DEBUG_RAYCASTING && intersects.length > 0) {
    console.log(`[RAYCAST] Found ${intersects.length} intersections`);
  }
  
  // Process intersections
  if (intersects.length > 0) {
    // Find the closest valid intersection
    const intersection = findValidIntersection(intersects);
    
    if (intersection) {
      const { object, faceIndex, point, instanceId, distance } = intersection;
      
      // Get the actual face index (0-5)
      const validFaceIndex = faceIndex !== undefined ? Math.floor(faceIndex / 2) : 0;
            
      // Get block instance data
      const block = getBlockFromIntersection(object, instanceId);
      
      if (block) {
        // Calculate block center for better distance measurement
        const blockCenter = new Vector3(
          block.x + 0.5, 
          block.y + 0.5, 
          block.z + 0.5
        );
        
        // Calculate actual distance to block center (not just intersection point)
        const actualDistance = camera.position.distanceTo(blockCenter);
        
        // Only target if within range
        if (actualDistance <= MAX_DISTANCE) {
          // Store the targeted block
          targetedBlock = { 
            block, 
            face: validFaceIndex,
            distance: actualDistance
          };
          
          // Calculate position for a new block using face normal
          const direction = faceDirections[validFaceIndex];
          const placePosition = {
            x: block.x + direction[0],
            y: block.y + direction[1],
            z: block.z + direction[2]
          };
          
          if (DEBUG_RAYCASTING) {
            console.log(`[RAYCAST] Target found: ${block.type} at ${block.x},${block.y},${block.z}, face: ${validFaceIndex}, distance: ${actualDistance.toFixed(2)}`);
          }
          
          return { 
            hasTarget: true, 
            position: { x: block.x, y: block.y, z: block.z },
            face: validFaceIndex,
            placePosition,
            distance: actualDistance
          };
        } else if (DEBUG_RAYCASTING) {
          console.log(`[RAYCAST] Block found but too far: ${actualDistance.toFixed(2)} > ${MAX_DISTANCE}`);
        }
      } else if (DEBUG_RAYCASTING) {
        console.log(`[RAYCAST] Intersection found but couldn't extract block data:`, intersection);
      }
    } else if (DEBUG_RAYCASTING) {
      console.log(`[RAYCAST] No valid intersection found among ${intersects.length} intersections`);
    }
  }
  
  // No valid target found
  targetedBlock = null;
  return { hasTarget: false };
}

/**
 * Find a valid intersection from the intersections array
 */
function findValidIntersection(intersects: Intersection[]): Intersection | null {
  // First, check if any intersections have valid faceIndex
  const validIntersections = intersects.filter(i => {
    // Require faceIndex to be defined
    const hasFaceIndex = i.faceIndex !== undefined && i.faceIndex !== null;
    return hasFaceIndex && isObjectWithBlockData(i.object);
  });
  
  // Sort by distance (closest first)
  const sortedIntersects = validIntersections.sort((a, b) => a.distance - b.distance);
  
  // Return closest valid intersection
  return sortedIntersects[0] || null;
}

/**
 * Check if an object has block data (directly or via parent)
 */
function isObjectWithBlockData(object: Object3D): boolean {
  // Check object directly
  if (object.userData && (object.userData.block || object.userData.blocks)) {
    return true;
  }
  
  // Check parent if needed
  if (object.parent && object.parent.userData && 
      (object.parent.userData.block || object.parent.userData.blocks)) {
    return true;
  }
  
  return false;
}

/**
 * Extract block data from intersection
 */
function getBlockFromIntersection(object: Object3D, instanceId?: number): Block | null {
  // First try object itself
  if (object.userData) {
    // Case 1: Single block on this object
    if (object.userData.block) {
      return object.userData.block;
    }
    
    // Case 2: Instanced blocks array
    if (object.userData.blocks && Array.isArray(object.userData.blocks) && 
        instanceId !== undefined && instanceId >= 0 && 
        instanceId < object.userData.blocks.length) {
      return object.userData.blocks[instanceId];
    }
  }
  
  // Try parent object if needed
  if (object.parent && object.parent.userData) {
    // Case 3: Single block on parent
    if (object.parent.userData.block) {
      return object.parent.userData.block;
    }
    
    // Case 4: Instanced blocks on parent
    if (object.parent.userData.blocks && Array.isArray(object.parent.userData.blocks) && 
        instanceId !== undefined && instanceId >= 0 && 
        instanceId < object.parent.userData.blocks.length) {
      return object.parent.userData.blocks[instanceId];
    }
  }
  
  if (DEBUG_RAYCASTING) {
    console.warn("[RAYCAST] Failed to extract block from object", object);
  }
  
  return null;
}

/**
 * Try to break the targeted block if it exists
 */
export function tryBreakBlock(
  onBlockBreak: (block: Block, face: number) => void
): boolean {
  const now = Date.now();
  
  // Check if there's a targeted block and cooldown has elapsed
  if (targetedBlock && (now - lastInteractionTime) > INTERACTION_COOLDOWN) {
    if (DEBUG_RAYCASTING) {
      console.log(`[RAYCAST] Breaking block: ${targetedBlock.block.type} at ${targetedBlock.block.x},${targetedBlock.block.y},${targetedBlock.block.z}`);
    }
    
    onBlockBreak(targetedBlock.block, targetedBlock.face);
    lastInteractionTime = now;
    return true;
  }
  
  if (DEBUG_RAYCASTING && !targetedBlock) {
    console.log("[RAYCAST] Can't break - no block targeted");
  } else if (DEBUG_RAYCASTING) {
    console.log("[RAYCAST] Can't break - on cooldown");
  }
  
  return false;
}

/**
 * Try to place a block at the targeted position
 */
export function tryPlaceBlock(
  onBlockPlace: (block: Block, face: number) => void
): boolean {
  const now = Date.now();
  
  // Check if there's a targeted block and cooldown has elapsed
  if (targetedBlock && (now - lastInteractionTime) > INTERACTION_COOLDOWN) {
    if (DEBUG_RAYCASTING) {
      const direction = faceDirections[targetedBlock.face];
      const placePos = {
        x: targetedBlock.block.x + direction[0],
        y: targetedBlock.block.y + direction[1],
        z: targetedBlock.block.z + direction[2]
      };
      console.log(`[RAYCAST] Placing block at ${placePos.x},${placePos.y},${placePos.z} from face ${targetedBlock.face}`);
    }
    
    onBlockPlace(targetedBlock.block, targetedBlock.face);
    lastInteractionTime = now;
    return true;
  }
  
  if (DEBUG_RAYCASTING && !targetedBlock) {
    console.log("[RAYCAST] Can't place - no block targeted");
  } else if (DEBUG_RAYCASTING) {
    console.log("[RAYCAST] Can't place - on cooldown");
  }
  
  return false;
}

/**
 * Get the currently targeted block if any
 */
export function getTargetedBlock(): { block: Block, face: number, distance: number } | null {
  return targetedBlock;
}

/**
 * Check if a point is within the player's reach distance
 */
export function isWithinReachDistance(position: Vector3, playerPosition: Vector3): boolean {
  const distance = position.distanceTo(playerPosition);
  return distance <= MAX_DISTANCE;
} 