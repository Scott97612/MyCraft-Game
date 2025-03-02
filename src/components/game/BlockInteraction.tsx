import { useEffect, useRef, useState, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Raycaster, Vector2, Mesh, DoubleSide, Vector3, Intersection } from 'three';
import { Block } from '../../utils/types';

interface BlockInteractionProps {
  onBreakBlock: (x: number, y: number, z: number) => void;
  onPlaceBlock: (x: number, y: number, z: number, face: number) => void;
}

// Constants
const MAX_INTERACTION_DISTANCE = 5; // Maximum distance to interact with blocks
const INTERACTION_COOLDOWN = 250; // ms cooldown between interactions

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
 * Component to handle raycasting and block interaction
 */
const BlockInteraction: React.FC<BlockInteractionProps> = ({ onBreakBlock, onPlaceBlock }) => {
  const { camera, scene } = useThree();
  
  // Create persistent raycaster
  const raycaster = useRef<Raycaster>(new Raycaster());
  const screenCenter = useRef<Vector2>(new Vector2(0, 0));
  
  // Track the currently targeted block
  const targetedBlock = useRef<{ block: Block, face: number } | null>(null);
  const lastInteraction = useRef<number>(0);
  const lastActionKey = useRef<string>("");
  
  // Debug counter
  const frameCount = useRef(0);
  const logCounter = useRef(0);
  
  // State for block highlight
  const [targetPosition, setTargetPosition] = useState<[number, number, number] | null>(null);
  const [placePosition, setPlacePosition] = useState<[number, number, number] | null>(null);
  const highlightRef = useRef<Mesh>(null);
  const placeHighlightRef = useRef<Mesh>(null);
  
  // For debugging - track success/failure counts
  const interactionStats = useRef({
    breakAttempts: 0,
    breakSuccesses: 0,
    placeAttempts: 0,
    placeSuccesses: 0,
    lastFailureReason: ''
  });
  
  // Set up raycaster parameters
  useEffect(() => {
    // Configure the raycaster for precise detection
    raycaster.current.far = MAX_INTERACTION_DISTANCE;
    
    console.log("[RAYCASTER] Block interaction system initialized with max distance:", MAX_INTERACTION_DISTANCE);
    
    return () => {
      console.log("[RAYCASTER] Final interaction stats:", 
        `Break: ${interactionStats.current.breakSuccesses}/${interactionStats.current.breakAttempts}`,
        `Place: ${interactionStats.current.placeSuccesses}/${interactionStats.current.placeAttempts}`);
    };
  }, []);
  
  // Extract block data from an intersection
  const extractBlockFromIntersection = useCallback((intersection: Intersection) => {
    if (!intersection) return null;
    
    const { object, instanceId } = intersection;
    let block: Block | null = null;
    
    // Try these methods in sequence to find the block data
    
    // 1. Direct object userData block
    if (object.userData && object.userData.block) {
      block = object.userData.block;
    } 
    // 2. Instanced mesh blocks array
    else if (object.userData && object.userData.blocks && Array.isArray(object.userData.blocks) && 
             instanceId !== undefined && instanceId >= 0 && instanceId < object.userData.blocks.length) {
      block = object.userData.blocks[instanceId];
    }
    // 3. Parent object's userData
    else if (object.parent && object.parent.userData) {
      if (object.parent.userData.block) {
        block = object.parent.userData.block;
      } else if (object.parent.userData.blocks && Array.isArray(object.parent.userData.blocks) && 
                 instanceId !== undefined && instanceId >= 0 && instanceId < object.parent.userData.blocks.length) {
        block = object.parent.userData.blocks[instanceId];
      }
    }
    
    return block;
  }, []);
  
  // Calculate distance between the camera and a block
  const getDistanceToBlock = useCallback((block: Block) => {
    const blockCenter = new Vector3(block.x + 0.5, block.y + 0.5, block.z + 0.5);
    return camera.position.distanceTo(blockCenter);
  }, [camera]);
  
  // Generate a unique key for an action (break/place at specific coordinates)
  const getActionKey = useCallback((action: string, x: number, y: number, z: number) => {
    return `${action}-${x},${y},${z}`;
  }, []);
  
  // Handle mouse and keyboard interactions with a single unified function
  const handleInteraction = useCallback((type: 'break' | 'place') => {
    // Only act if we have pointer lock (game mode)
    if (!document.pointerLockElement) {
      console.log("[INPUT] Ignoring interaction - pointer not locked");
      return false;
    }
    
    // Log the attempt
    if (type === 'break') {
      interactionStats.current.breakAttempts++;
    } else {
      interactionStats.current.placeAttempts++;
    }
    
    // Check if we have a targeted block
    if (!targetedBlock.current) {
      interactionStats.current.lastFailureReason = "No block targeted";
      console.log("[INPUT] No block targeted for interaction");
      return false;
    }
    
    const { block, face } = targetedBlock.current;
    
    // Validate the block
    if (!block || typeof block.x !== 'number' || typeof block.y !== 'number' || typeof block.z !== 'number') {
      interactionStats.current.lastFailureReason = "Invalid block data";
      console.log("[INPUT] Invalid block data:", block);
      return false;
    }
    
    // Check cooldown
    const now = Date.now();
    if (now - lastInteraction.current < INTERACTION_COOLDOWN) {
      interactionStats.current.lastFailureReason = "Interaction on cooldown";
      console.log("[INPUT] Interaction on cooldown");
      return false;
    }
    
    // Check distance
    const distance = getDistanceToBlock(block);
    if (distance > MAX_INTERACTION_DISTANCE) {
      interactionStats.current.lastFailureReason = `Block too far away: ${distance.toFixed(2)} blocks`;
      console.log(`[INPUT] Block too far away: ${distance.toFixed(2)} blocks`);
      return false;
    }
    
    // Perform the interaction
    lastInteraction.current = now;
    if (type === 'break') {
      // Create a unique key for this break action
      const actionKey = getActionKey('break', block.x, block.y, block.z);
      
      // Prevent breaking the same block multiple times rapidly
      if (actionKey === lastActionKey.current && now - lastInteraction.current < 1000) {
        interactionStats.current.lastFailureReason = "Same block broken too quickly";
        return false;
      }
      
      lastActionKey.current = actionKey;
      console.log(`[INPUT] Breaking block at ${block.x},${block.y},${block.z}, distance: ${distance.toFixed(2)}`);
      onBreakBlock(block.x, block.y, block.z);
      interactionStats.current.breakSuccesses++;
    } else {
      // Get placement coordinates
      const validFace = Math.min(Math.max(0, face), 5);
      const dir = faceDirections[validFace];
      
      if (!dir) {
        interactionStats.current.lastFailureReason = `Invalid face direction: ${face}`;
        return false;
      }
      
      const newX = block.x + dir[0];
      const newY = block.y + dir[1];
      const newZ = block.z + dir[2];
      
      // Create a unique key for this place action
      const actionKey = getActionKey('place', newX, newY, newZ);
      
      // Prevent placing in the same location multiple times rapidly
      if (actionKey === lastActionKey.current && now - lastInteraction.current < 1000) {
        interactionStats.current.lastFailureReason = "Same block placed too quickly";
        return false;
      }
      
      lastActionKey.current = actionKey;
      console.log(`[INPUT] Placing block at ${newX},${newY},${newZ}, from face: ${validFace}`);
      onPlaceBlock(newX, newY, newZ, validFace);
      interactionStats.current.placeSuccesses++;
    }
    
    return true;
  }, [getDistanceToBlock, onBreakBlock, onPlaceBlock, getActionKey]);
  
  // Set up event listeners
  useEffect(() => {
    // Mouse click handler for breaking blocks
    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault(); // Prevents default browser behavior
      
      if (e.button === 0) { // Left click
        if (handleInteraction('break')) {
          e.stopPropagation();
        }
      } else if (e.button === 2) { // Right click
        if (handleInteraction('place')) {
          e.stopPropagation();
        }
      }
    };

    // Prevent context menu
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault(); // Prevent browser context menu
    };

    // Keyboard handler for 'R' key to place blocks
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        console.log("[INPUT] R key pressed for block placement");
        handleInteraction('place');
      }
    };

    // Add event listeners with appropriate capture
    window.addEventListener('mousedown', handleMouseDown, { capture: true });
    window.addEventListener('contextmenu', handleContextMenu, { capture: true });
    window.addEventListener('keydown', handleKeyDown, { capture: true });

    // Clean up
    return () => {
      window.removeEventListener('mousedown', handleMouseDown, { capture: true });
      window.removeEventListener('contextmenu', handleContextMenu, { capture: true });
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [handleInteraction]);

  // Update raycasting each frame for targeting and highlighting
  useFrame(() => {
    if (!scene) return;
    
    frameCount.current++;
    
    // Update the raycaster with camera position/direction (center of screen)
    raycaster.current.setFromCamera(screenCenter.current, camera);
    
    // Calculate player's position (camera position)
    const playerPosition = new Vector3().copy(camera.position);
    
    // Find all intersections
    const intersects = raycaster.current.intersectObjects(scene.children, true);
    
    // Reset targeted block
    targetedBlock.current = null;
    setTargetPosition(null);
    setPlacePosition(null);
    
    // Find the closest valid block intersection
    if (intersects.length > 0) {
      // Filter and sort valid intersections
      const validIntersections = intersects
        .filter(i => {
          // Check faceIndex for null
          const hasFaceIndex = i.faceIndex !== undefined && i.faceIndex !== null;
          // Check face for being a valid number
          const hasFace = i.face !== undefined && typeof i.face === 'number';
          // Must have at least one valid face identifier
          return (hasFaceIndex || hasFace) && i.distance <= MAX_INTERACTION_DISTANCE;
        });
      
      if (validIntersections.length > 0) {
        // Sort by distance (closest first)
        validIntersections.sort((a, b) => a.distance - b.distance);
        
        // Find first valid intersection with block data
        for (const intersection of validIntersections) {
          const block = extractBlockFromIntersection(intersection);
          
          if (block) {
            // Get face information - carefully handle both faceIndex and face properties
            let faceNum = 0;
            
            // Safely handle faceIndex
            if (intersection.faceIndex !== undefined && intersection.faceIndex !== null) {
              faceNum = Math.floor(intersection.faceIndex / 2);
            } 
            // Fall back to face property if needed
            else if (intersection.face !== undefined && typeof intersection.face === 'number') {
              faceNum = Math.floor(intersection.face / 2);
            }
            
            // Validate face index range
            const validFaceIndex = Math.min(Math.max(0, faceNum), 5);
            
            // Calculate actual distance to block center
            const blockCenter = new Vector3(block.x + 0.5, block.y + 0.5, block.z + 0.5);
            const actualDistance = playerPosition.distanceTo(blockCenter);
            
            // Set this as the targeted block if it's close enough
            if (actualDistance <= MAX_INTERACTION_DISTANCE) {
              // Store the targeted block
              targetedBlock.current = { block, face: validFaceIndex };
              
              // Set position for highlight meshes
              setTargetPosition([block.x, block.y, block.z]);
              
              // Calculate position for placement highlight
              const dir = faceDirections[validFaceIndex];
              if (dir) {
                const newPos = {
                  x: block.x + dir[0],
                  y: block.y + dir[1],
                  z: block.z + dir[2],
                };
                
                // Calculate distance to new position
                const newPosCenter = new Vector3(newPos.x + 0.5, newPos.y + 0.5, newPos.z + 0.5);
                const placementDistance = playerPosition.distanceTo(newPosCenter);
                
                // Only show placement highlight if within range
                if (placementDistance <= MAX_INTERACTION_DISTANCE) {
                  setPlacePosition([newPos.x, newPos.y, newPos.z]);
                }
              }
              
              // Log debugging info occasionally
              logCounter.current++;
              if (logCounter.current % 60 === 0) {
                console.log(
                  `[RAYCASTER] Targeting block: ${block.type} at ${block.x},${block.y},${block.z}`,
                  `face: ${validFaceIndex}, distance: ${actualDistance.toFixed(2)}`
                );
              }
              
              // Only use the first valid intersection
              break;
            }
          }
        }
      }
    }
  });
  
  // This component renders the block highlighting
  return (
    <>
      {/* Highlight for targeted block */}
      {targetPosition && (
        <mesh 
          ref={highlightRef}
          position={targetPosition}
          visible={true}
        >
          <boxGeometry args={[1.01, 1.01, 1.01]} />
          <meshBasicMaterial color="red" wireframe={true} transparent={true} opacity={0.5} side={DoubleSide} />
        </mesh>
      )}
      
      {/* Highlight for placement position */}
      {placePosition && (
        <mesh 
          ref={placeHighlightRef}
          position={placePosition}
          visible={true}
        >
          <boxGeometry args={[1.01, 1.01, 1.01]} />
          <meshBasicMaterial color="green" wireframe={true} transparent={true} opacity={0.3} side={DoubleSide} />
        </mesh>
      )}
    </>
  );
};

export default BlockInteraction; 