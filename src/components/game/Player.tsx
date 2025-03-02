import { useRef, useEffect, useState, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import { Vector3 } from 'three';

interface PlayerProps {
  onPlayerMove: (position: [number, number, number]) => void;
  onPlayerRotate: (rotation: [number, number, number]) => void;
}

// Added interface for terrain checking
interface TerrainCheck {
  getHeight: (x: number, z: number) => number;
}

// Global terrain reference - will be set by the World component
let terrainRef: TerrainCheck | null = null;

// Export function to allow World to pass terrain reference
export const setTerrainReference = (terrain: TerrainCheck) => {
  terrainRef = terrain;
  console.log("[TERRAIN] Terrain reference set");
};

const Player: React.FC<PlayerProps> = ({ onPlayerMove, onPlayerRotate }) => {
  const { camera } = useThree();
  // Using type assertion for the PointerLockControls ref because the type definition doesn't 
  // expose all runtime properties we need (isLocked, moveRight, moveForward)
  const controlsRef = useRef<any>(null);
  const velocity = useRef<Vector3>(new Vector3(0, 0, 0));
  const direction = useRef<Vector3>(new Vector3(0, 0, 0));
  
  // Track last update time for throttling
  const lastUpdateTime = useRef<number>(0);
  const lastPosition = useRef<Vector3>(new Vector3(0, 0, 0));
  const lastRotation = useRef<Vector3>(new Vector3(0, 0, 0));
  
  // Movement state
  const [moveForward, setMoveForward] = useState(false);
  const [moveBackward, setMoveBackward] = useState(false);
  const [moveLeft, setMoveLeft] = useState(false);
  const [moveRight, setMoveRight] = useState(false);
  const [jump, setJump] = useState(false);
  const [isGrounded, setIsGrounded] = useState(false);
  
  // Track frame execution
  const frameCount = useRef(0);
  const lastFrameTime = useRef(0);
  
  // Constants
  const SPEED = 7;
  const GRAVITY = 2; // Adjusted gravity for better feel
  const JUMP_FORCE = 0.4; // Initial upward velocity when jumping
  const UPDATE_INTERVAL = 100; // Throttle updates to 10 per second
  const POSITION_THRESHOLD = 0.1; // Only update if moved more than this
  
  // Set initial position
  useEffect(() => {
    camera.position.set(0, 20, 0);
    lastPosition.current.copy(camera.position);
    
    // Auto-enable pointer lock when the canvas is clicked
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.addEventListener('click', () => {
        if (controlsRef.current && !controlsRef.current.isLocked) {
          console.log('Locking pointer');
          controlsRef.current.lock();
        }
      });
    }
    
    return () => {
      if (canvas) {
        canvas.removeEventListener('click', () => {});
      }
    };
  }, [camera]);
  
  // Handle lock/unlock
  useEffect(() => {
    if (!controlsRef.current) return;
    
    const onLock = () => console.log('Pointer locked');
    const onUnlock = () => console.log('Pointer unlocked');
    
    controlsRef.current.addEventListener('lock', onLock);
    controlsRef.current.addEventListener('unlock', onUnlock);
    
    return () => {
      if (controlsRef.current) {
        controlsRef.current.removeEventListener('lock', onLock);
        controlsRef.current.removeEventListener('unlock', onUnlock);
      }
    };
  }, []);
  
  // Efficient key handling with useCallback
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    console.log(`Key down: ${e.code}`);
    switch (e.code) {
      case 'KeyW':
        setMoveForward(true); // W should move forward (negative Z in three.js)
        break;
      case 'KeyS':
        setMoveBackward(true); // S should move backward (positive Z in three.js)
        break;
      case 'KeyA':
        setMoveLeft(true);
        break;
      case 'KeyD':
        setMoveRight(true);
        break;
      case 'Space':
        if (isGrounded) {
          setJump(true);
        }
        break;
    }
  }, [isGrounded]);
  
  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    console.log(`Key up: ${e.code}`);
    switch (e.code) {
      case 'KeyW':
        setMoveForward(false); // W should move forward (negative Z in three.js)
        break;
      case 'KeyS':
        setMoveBackward(false); // S should move backward (positive Z in three.js)
        break;
      case 'KeyA':
        setMoveLeft(false);
        break;
      case 'KeyD':
        setMoveRight(false);
        break;
    }
  }, []);
  
  // Handle keyboard input - ensure this is called only once
  useEffect(() => {
    console.log('[DEBUG] Setting up keyboard listeners');
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    // Make sure to clean up properly
    return () => {
      console.log('[DEBUG] Cleaning up keyboard listeners');
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);
  
  // Update player movement with safe default height
  useFrame((state, delta) => {
    frameCount.current++;
    
    // Log every 100 frames to avoid console spam
    if (frameCount.current % 100 === 0) {
      const currentTime = performance.now();
      const fps = 100 / ((currentTime - lastFrameTime.current) / 1000);
      console.log(`[DEBUG] Frame rate: ${fps.toFixed(1)} FPS, Controls locked: ${controlsRef.current?.isLocked}, Movement state: forward=${moveForward}, back=${moveBackward}, left=${moveLeft}, right=${moveRight}`);
      lastFrameTime.current = currentTime;
    }
    
    // Make sure we have valid delta time to prevent physics glitches
    if (delta > 0.1) {
      console.log(`[DEBUG] Large delta time detected: ${delta}, capping to 0.1`);
      delta = 0.1;
    }
    
    // Only process movement if pointer is locked
    if (controlsRef.current?.isLocked) {
      // Calculate movement direction
      direction.current.z = Number(moveForward) - Number(moveBackward);
      direction.current.x = Number(moveRight) - Number(moveLeft);
      direction.current.normalize();
      
      // Apply movement
      if (moveForward || moveBackward) {
        velocity.current.z = direction.current.z * SPEED * delta; // Removed the negative sign to correct direction
      } else {
        velocity.current.z = 0;
      }
      
      if (moveLeft || moveRight) {
        velocity.current.x = direction.current.x * SPEED * delta;
      } else {
        velocity.current.x = 0;
      }
      
      // Get terrain height at player position with safety checks
      let terrainHeight = 1; // Default for flat world
      
      try {
        if (terrainRef) {
          // Get terrain height at current position with safety bounds
          const playerX = Math.floor(camera.position.x);
          const playerZ = Math.floor(camera.position.z);
          
          terrainHeight = terrainRef.getHeight(playerX, playerZ);
          
          // Validate terrain height to catch bad values
          if (isNaN(terrainHeight) || !isFinite(terrainHeight)) {
            console.error(`[TERRAIN] Invalid terrain height at (${playerX}, ${playerZ}): ${terrainHeight}`);
            terrainHeight = 1; // Fallback to a safe default
          }
          
          // Add player height (1.8 blocks tall)
          terrainHeight += 1.8;
          
          // Log occasionally for debugging
          if (frameCount.current % 200 === 0) {
            console.log(`[TERRAIN] Player at (${playerX}, ${playerZ}), terrain height: ${terrainHeight}`);
          }
        }
      } catch (error) {
        console.error("[TERRAIN] Error getting terrain height:", error);
        terrainHeight = 1 + 1.8; // Fallback to a safe default plus player height
      }
      
      // Apply gravity with proper terrain collision
      if (camera.position.y > terrainHeight) {
        // Apply gravity - continuous acceleration downward
        velocity.current.y -= GRAVITY * delta;
        setIsGrounded(false);
        
        // Cap maximum falling speed to prevent falling through objects at high velocities
        if (velocity.current.y < -20) {
          velocity.current.y = -20;
        }
        
        // Log collision info occasionally
        if (frameCount.current % 100 === 0) {
          console.log(`[COLLISION] Player position: ${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)}, isGrounded: ${isGrounded}, terrainHeight: ${terrainHeight}, velocity Y: ${velocity.current.y.toFixed(2)}`);
        }
      } else {
        // Landing on ground
        velocity.current.y = 0;
        camera.position.y = terrainHeight; // Position player on top of terrain
        setIsGrounded(true);
        
        if (frameCount.current % 100 === 0) {
          console.log(`[COLLISION] Player grounded at position: ${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)}, terrainHeight: ${terrainHeight}`);
        }
      }
      
      // Apply jump - just set initial velocity and let physics handle the rest
      if (jump && isGrounded) {
        velocity.current.y = JUMP_FORCE; // No delta multiplication - this is initial velocity
        setJump(false);
        setIsGrounded(false);
      }
      
      // Move the camera
      if (controlsRef.current) {
        // Store current position for collision detection
        const oldX = camera.position.x;
        const oldZ = camera.position.z;
        
        // Apply movement
        controlsRef.current.moveRight(velocity.current.x);
        controlsRef.current.moveForward(velocity.current.z);
        
        // Check if new position collides with blocks
        try {
          if (terrainRef) {
            const newX = camera.position.x;
            const newZ = camera.position.z;
            
            // Check terrain height at new position
            const newTerrainHeight = terrainRef.getHeight(Math.floor(newX), Math.floor(newZ)) + 1.8;
            
            // Validate new terrain height
            if (isNaN(newTerrainHeight) || !isFinite(newTerrainHeight)) {
              console.error(`[TERRAIN] Invalid new terrain height at (${newX}, ${newZ}): ${newTerrainHeight}`);
            } else {
              // FIXED: Improved collision logic to respect jump arcs
              
              // If we're on the ground, only allow small steps (0.5 blocks)
              if (isGrounded) {
                if (newTerrainHeight > camera.position.y + 0.5) {
                  // Revert horizontal movement - can't step up that high
                  camera.position.x = oldX;
                  camera.position.z = oldZ;
                  
                  if (frameCount.current % 100 === 0) {
                    console.log(`[COLLISION] Blocked ground movement at ${newX.toFixed(2)}, ${newZ.toFixed(2)}, terrain height: ${newTerrainHeight}`);
                  }
                }
              } 
              // If we're actively jumping (moving upward)
              else if (velocity.current.y > 0) {
                // Check if we would horizontally collide with a block that's too high to jump onto
                if (newTerrainHeight > camera.position.y) {
                  // Calculate where the player would be if they continued their jump arc
                  const projectedHeight = camera.position.y + velocity.current.y;
                  
                  // If the projected height is still below the terrain, we'd hit the side of the block
                  if (projectedHeight < newTerrainHeight) {
                    // Block horizontal movement - this maintains the vertical jumping motion
                    camera.position.x = oldX;
                    camera.position.z = oldZ;
                    
                    if (frameCount.current % 100 === 0) {
                      console.log(`[COLLISION] Jump blocked by terrain wall: current height=${camera.position.y.toFixed(2)}, projected=${projectedHeight.toFixed(2)}, terrain=${newTerrainHeight.toFixed(2)}`);
                    }
                  }
                  // Otherwise, if we'd clear the block top, allow the movement (proper jump over)
                }
              }
              // If we're falling, check if we'd hit a block horizontally
              else if (velocity.current.y < 0) {
                if (newTerrainHeight > camera.position.y) {
                  // Block horizontal movement while falling into a wall
                  camera.position.x = oldX;
                  camera.position.z = oldZ;
                }
              }
            }
          }
        } catch (error) {
          console.error("[TERRAIN] Error checking collision:", error);
          // No collision handling on error, just let the player move
        }
      }
      
      // Apply vertical movement from gravity/jumping
      camera.position.y += velocity.current.y;
      
      // Throttle position and rotation updates
      const currentTime = state.clock.getElapsedTime() * 1000;
      const timeSinceLastUpdate = currentTime - lastUpdateTime.current;
      
      // Check if enough time has passed since the last update
      if (timeSinceLastUpdate > UPDATE_INTERVAL) {
        // Get current position and rotation
        const currentPosition = camera.position.clone();
        const currentRotation = new Vector3(camera.rotation.x, camera.rotation.y, camera.rotation.z);
        
        // Calculate change in position
        const positionDelta = currentPosition.distanceTo(lastPosition.current);
        
        // Only notify about significant position/rotation changes
        if (positionDelta > POSITION_THRESHOLD) {
          // Update last position and rotation
          lastPosition.current.copy(currentPosition);
          lastRotation.current.copy(currentRotation);
          lastUpdateTime.current = currentTime;
          
          // Notify about position change
          onPlayerMove([
            currentPosition.x, 
            currentPosition.y, 
            currentPosition.z
          ]);
          
          // Notify about rotation change
          onPlayerRotate([
            currentRotation.x,
            currentRotation.y,
            currentRotation.z
          ]);
        }
      }
    }
  });
  
  return (
    <>
      <PointerLockControls ref={controlsRef} />
      {/* Debug visualization */}
      <mesh position={[0, 0, 0]} visible={false}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshBasicMaterial color="red" />
      </mesh>
    </>
  );
};

export default Player; 