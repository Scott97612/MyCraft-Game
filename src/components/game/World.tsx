import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Vector3, InstancedMesh, Matrix4, Object3D } from 'three';
import { TerrainGenerator } from '../../utils/noise';
import { Block, BlockChange, ChunkData } from '../../utils/types';
import Chunk from './Chunk';
import { updateWorldChanges } from '../../utils/api';
import { setTerrainReference } from './Player';
import { getBlockGeometry } from '../../utils/textures';

interface WorldProps {
  worldId: number;
  seed: string;
  initialChanges: BlockChange[];
  selectedBlock: string;
}

// Configuration
const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 3; // Chunks in each direction
const DEBUG_CHUNK_MANAGEMENT = false;
const DEBUG_BLOCK_CHANGES = false;

// Helper to create a unique block key
const makeBlockKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

const World: React.FC<WorldProps> = ({ worldId, seed, initialChanges, selectedBlock }) => {
  const { camera, scene } = useThree();
  const [chunks, setChunks] = useState<ChunkData[]>([]);
  const [changes, setChanges] = useState<BlockChange[]>(initialChanges || []);
  const [pendingChanges, setPendingChanges] = useState<BlockChange[]>([]);
  const [terrainGenerator, setTerrainGenerator] = useState<TerrainGenerator | null>(null);
  const [isInitialChunksLoaded, setIsInitialChunksLoaded] = useState(false);
  
  // Refs for performance tracking
  const lastCheckedPosition = useRef<Vector3>(new Vector3(0, 0, 0));
  const loadedChunks = useRef<Map<string, ChunkData>>(new Map());
  const visibleChunks = useRef<Set<string>>(new Set());
  const isChunkGenerationInProgress = useRef(false);
  const lastFrameTime = useRef(performance.now());
  const frameCount = useRef(0);
  
  // Track chunk and block states
  const chunkMetrics = useRef({
    lastGenerationTime: 0,
    generationsInLastSecond: 0,
    totalGeneratedChunks: 0,
    visibleChunkCount: 0,
    totalLoadedChunks: 0,
    blockChangesCount: 0
  });
  
  // Track current player chunk
  const playerChunkRef = useRef({ x: 0, y: 0, z: 0 });
  
  // Initialize terrain generator
  useEffect(() => {
    console.log("[TERRAIN] Creating terrain generator with seed:", seed);
    
    try {
      const generator = new TerrainGenerator(seed);
      setTerrainGenerator(generator);
      
      // Share terrain generator with Player component for collision detection
      setTerrainReference({
        getHeight: (x: number, z: number) => generator.getHeight(x, z)
      });
      
      // Generate initial chunks immediately when the generator is created
      if (generator) {
        generateInitialChunks(generator);
      }
    } catch (error) {
      console.error("[TERRAIN] Error initializing terrain generator:", error);
    }
  }, [seed]);
  
  // Function to generate initial chunks around the origin
  const generateInitialChunks = useCallback((generator: TerrainGenerator) => {
    if (isInitialChunksLoaded) return;
    
    console.log("[WORLD] Generating initial chunks...");
    const initialChunks: ChunkData[] = [];
    
    // Generate chunks around the player's starting position (0, 20, 0)
    const startX = Math.floor(0 / CHUNK_SIZE);
    const startY = Math.floor(20 / CHUNK_SIZE);
    const startZ = Math.floor(0 / CHUNK_SIZE);
    
    // Store the initial player chunk for reference
    playerChunkRef.current = { x: startX, y: startY, z: startZ };
    
    // Generate a sufficient cube of chunks around player's starting position
    for (let x = startX - 1; x <= startX + 1; x++) {
      for (let y = startY - 1; y <= startY + 1; y++) {
        for (let z = startZ - 1; z <= startZ + 1; z++) {
          const chunkKey = getChunkKey(x, y, z);
          
          if (!loadedChunks.current.has(chunkKey)) {
            try {
              const chunk = generator.generateChunk(x, y, z, CHUNK_SIZE);
              
              // Apply any existing changes to this chunk
              applyChangesToChunk(chunk, changes);
              
              initialChunks.push(chunk);
              loadedChunks.current.set(chunkKey, chunk);
              visibleChunks.current.add(chunkKey);
            } catch (error) {
              console.error(`[WORLD] Error generating chunk at ${chunkKey}:`, error);
            }
          }
        }
      }
    }
    
    if (initialChunks.length > 0) {
      setChunks(initialChunks);
      setIsInitialChunksLoaded(true);
      console.log(`[WORLD] Generated ${initialChunks.length} initial chunks`);
      
      chunkMetrics.current.totalGeneratedChunks += initialChunks.length;
      chunkMetrics.current.visibleChunkCount = initialChunks.length;
      chunkMetrics.current.totalLoadedChunks = initialChunks.length;
    }
  }, [isInitialChunksLoaded, changes]);
  
  // Apply changes to a chunk
  const applyChangesToChunk = useCallback((chunk: ChunkData, changesList: BlockChange[]) => {
    // Get chunk coordinates
    const chunkX = chunk.x ?? chunk.position.x;
    const chunkY = chunk.y ?? chunk.position.y;
    const chunkZ = chunk.z ?? chunk.position.z;
    
    // Calculate chunk bounds
    const minX = chunkX * CHUNK_SIZE;
    const minY = chunkY * CHUNK_SIZE;
    const minZ = chunkZ * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE - 1;
    const maxY = minY + CHUNK_SIZE - 1;
    const maxZ = minZ + CHUNK_SIZE - 1;
    
    // Filter changes that affect this chunk
    const relevantChanges = changesList.filter(change => 
      change.x >= minX && change.x <= maxX &&
      change.y >= minY && change.y <= maxY &&
      change.z >= minZ && change.z <= maxZ
    );
    
    if (relevantChanges.length === 0) return chunk;
    
    // Apply changes to chunk
    const updatedChunk = { ...chunk };
    const blocksMap = new Map<string, Block>();
    
    // First, create a map of all blocks for easy access
    updatedChunk.blocks.forEach(block => {
      blocksMap.set(makeBlockKey(block.x, block.y, block.z), block);
    });
    
    // Apply each change
    relevantChanges.forEach(change => {
      const blockKey = makeBlockKey(change.x, change.y, change.z);
      
      if (change.action === 'remove') {
        // Remove block
        blocksMap.delete(blockKey);
        
        if (DEBUG_BLOCK_CHANGES) {
          console.log(`[WORLD] Block removed at ${change.x},${change.y},${change.z} from chunk ${chunkX},${chunkY},${chunkZ}`);
        }
      } else if (change.action === 'place') {
        // Place block
        blocksMap.set(blockKey, {
          x: change.x,
          y: change.y,
          z: change.z,
          type: change.type
        });
        
        if (DEBUG_BLOCK_CHANGES) {
          console.log(`[WORLD] Block placed at ${change.x},${change.y},${change.z} in chunk ${chunkX},${chunkY},${chunkZ}`);
        }
      }
    });
    
    // Update the chunk's blocks array
    updatedChunk.blocks = Array.from(blocksMap.values());
    
    return updatedChunk;
  }, []);
  
  // Function to get chunk coordinates from world position
  const getChunkCoords = useCallback((x: number, y: number, z: number) => {
    return {
      x: Math.floor(x / CHUNK_SIZE),
      y: Math.floor(y / CHUNK_SIZE),
      z: Math.floor(z / CHUNK_SIZE)
    };
  }, []);
  
  // Function to generate a chunk key for caching
  const getChunkKey = useCallback((x: number, y: number, z: number) => {
    return `${x},${y},${z}`;
  }, []);
  
  // Update chunk system when changes occur
  useEffect(() => {
    if (changes.length === 0 || !isInitialChunksLoaded) return;
    
    if (DEBUG_BLOCK_CHANGES) {
      console.log(`[WORLD] Processing ${changes.length} block changes`);
    }
    
    // Group changes by chunk
    const chunkChanges = new Map<string, BlockChange[]>();
    
    changes.forEach(change => {
      const { x, y, z } = change;
      const chunkCoords = getChunkCoords(x, y, z);
      const chunkKey = getChunkKey(chunkCoords.x, chunkCoords.y, chunkCoords.z);
      
      if (!chunkChanges.has(chunkKey)) {
        chunkChanges.set(chunkKey, []);
      }
      
      chunkChanges.get(chunkKey)!.push(change);
    });
    
    // Update loaded chunks in memory
    let chunksNeedingUpdate: ChunkData[] = [];
    
    chunkChanges.forEach((changesForChunk, chunkKey) => {
      // Get the chunk
      const chunk = loadedChunks.current.get(chunkKey);
      
      if (chunk) {
        // Apply changes to existing chunk
        const updatedChunk = applyChangesToChunk(chunk, changesForChunk);
        
        // Update the chunk in memory
        loadedChunks.current.set(chunkKey, updatedChunk);
        
        // Add to list of chunks that need UI update
        if (visibleChunks.current.has(chunkKey)) {
          chunksNeedingUpdate.push(updatedChunk);
        }
      } else if (visibleChunks.current.has(chunkKey)) {
        // This chunk should be visible but wasn't loaded yet
        // We'll generate it with changes applied
        if (DEBUG_CHUNK_MANAGEMENT) {
          console.log(`[WORLD] Changes found for unloaded chunk: ${chunkKey}, will generate it`);
        }
        
        const [x, y, z] = chunkKey.split(',').map(Number);
        
        if (terrainGenerator) {
          const newChunk = terrainGenerator.generateChunk(x, y, z, CHUNK_SIZE);
          const updatedChunk = applyChangesToChunk(newChunk, changesForChunk);
          
          loadedChunks.current.set(chunkKey, updatedChunk);
          visibleChunks.current.add(chunkKey);
          chunksNeedingUpdate.push(updatedChunk);
          
          chunkMetrics.current.totalGeneratedChunks++;
          chunkMetrics.current.totalLoadedChunks++;
          chunkMetrics.current.visibleChunkCount++;
        }
      }
    });
    
    // Update the rendered chunks if any were changed
    if (chunksNeedingUpdate.length > 0) {
      if (DEBUG_BLOCK_CHANGES) {
        console.log(`[WORLD] Updating ${chunksNeedingUpdate.length} chunks with changes`);
      }
      
      setChunks(prevChunks => {
        const updatedChunks = [...prevChunks];
        
        // Remove chunks that need to be replaced
        const chunksToUpdate = new Set(chunksNeedingUpdate.map(c => 
          getChunkKey(c.x ?? c.position.x, c.y ?? c.position.y, c.z ?? c.position.z)
        ));
        
        const filteredChunks = updatedChunks.filter(c => {
          const chunkKey = getChunkKey(c.x ?? c.position.x, c.y ?? c.position.y, c.z ?? c.position.z);
          return !chunksToUpdate.has(chunkKey);
        });
        
        // Add the updated chunks
        return [...filteredChunks, ...chunksNeedingUpdate];
      });
      
      chunkMetrics.current.blockChangesCount += changes.length;
    }
  }, [changes, getChunkKey, getChunkCoords, applyChangesToChunk, terrainGenerator, isInitialChunksLoaded]);
  
  // Continually check for chunks to load/unload based on player position
  useFrame(() => {
    if (!terrainGenerator || !isInitialChunksLoaded || isChunkGenerationInProgress.current) return;
    
    // Throttle updates to every ~250ms (or adjust as needed)
    const now = performance.now();
    if (now - lastFrameTime.current < 250) return;
    lastFrameTime.current = now;
    
    // Get current player position and chunk
    const playerPos = new Vector3(camera.position.x, camera.position.y, camera.position.z);
    const currentChunk = getChunkCoords(playerPos.x, playerPos.y, playerPos.z);
    
    // Only update if player has moved to a new chunk
    if (
      currentChunk.x === playerChunkRef.current.x && 
      currentChunk.y === playerChunkRef.current.y && 
      currentChunk.z === playerChunkRef.current.z
    ) {
      return;
    }
    
    // Update player chunk reference
    playerChunkRef.current = currentChunk;
    
    if (DEBUG_CHUNK_MANAGEMENT) {
      console.log(`[WORLD] Player moved to chunk ${currentChunk.x},${currentChunk.y},${currentChunk.z}`);
    }
    
    // Lock chunk generation to prevent multiple concurrent updates
    isChunkGenerationInProgress.current = true;
    
    // Calculate which chunks should be visible
    const newVisibleChunks = new Set<string>();
    const chunksToLoad: ChunkData[] = [];
    
    // Determine which chunks should be visible in render distance
    for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
      for (let y = -RENDER_DISTANCE; y <= RENDER_DISTANCE; y++) {
        for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
          // Calculate Manhattan distance for faster checks
          const distance = Math.abs(x) + Math.abs(y) + Math.abs(z);
          if (distance > RENDER_DISTANCE * 1.5) continue; // Use a slightly extended range for smoother transitions
          
          const chunkX = currentChunk.x + x;
          const chunkY = currentChunk.y + y;
          const chunkZ = currentChunk.z + z;
          const chunkKey = getChunkKey(chunkX, chunkY, chunkZ);
          
          // This chunk should be visible
          newVisibleChunks.add(chunkKey);
          
          // Check if we need to load this chunk
          if (!loadedChunks.current.has(chunkKey)) {
            try {
              // Generate the chunk
              const newChunk = terrainGenerator.generateChunk(chunkX, chunkY, chunkZ, CHUNK_SIZE);
              
              // Apply any changes to this chunk
              const updatedChunk = applyChangesToChunk(newChunk, changes);
              
              // Store in our cache
              loadedChunks.current.set(chunkKey, updatedChunk);
              
              // Add to list to be added to rendered chunks
              chunksToLoad.push(updatedChunk);
              
              if (DEBUG_CHUNK_MANAGEMENT) {
                console.log(`[WORLD] Generated new chunk at ${chunkKey}`);
              }
              
              chunkMetrics.current.totalGeneratedChunks++;
              chunkMetrics.current.totalLoadedChunks++;
            } catch (error) {
              console.error(`[WORLD] Error generating chunk at ${chunkKey}:`, error);
            }
          }
        }
      }
    }
    
    // Find chunks to unload (no longer visible)
    const chunksToUnload = new Set<string>();
    for (const chunkKey of visibleChunks.current) {
      if (!newVisibleChunks.has(chunkKey)) {
        chunksToUnload.add(chunkKey);
        
        if (DEBUG_CHUNK_MANAGEMENT) {
          console.log(`[WORLD] Unloading chunk at ${chunkKey}`);
        }
      }
    }
    
    // Update the visible chunks reference
    visibleChunks.current = newVisibleChunks;
    
    // Update metrics
    chunkMetrics.current.visibleChunkCount = newVisibleChunks.size;
    
    // Update chunks state if there are changes
    if (chunksToLoad.length > 0 || chunksToUnload.size > 0) {
      setChunks(prevChunks => {
        // Remove chunks that are no longer visible
        const remainingChunks = prevChunks.filter(chunk => {
          const chunkKey = getChunkKey(
            chunk.x ?? chunk.position.x, 
            chunk.y ?? chunk.position.y, 
            chunk.z ?? chunk.position.z
          );
          return !chunksToUnload.has(chunkKey);
        });
        
        // Add new chunks
        return [...remainingChunks, ...chunksToLoad];
      });
      
      if (DEBUG_CHUNK_MANAGEMENT) {
        console.log(`[WORLD] Updated chunks: loaded ${chunksToLoad.length}, unloaded ${chunksToUnload.size}`);
      }
    }
    
    // Unlock chunk generation
    isChunkGenerationInProgress.current = false;
  });
  
  // Sync changes with server with debounce
  useEffect(() => {
    if (pendingChanges.length === 0 || !worldId) return;
    
    const syncChanges = async () => {
      if (DEBUG_BLOCK_CHANGES) {
        console.log(`[WORLD] Syncing ${pendingChanges.length} changes with server`);
      }
      
      try {
        await updateWorldChanges(worldId, pendingChanges);
        // Clear pending changes after successful sync
        setPendingChanges([]);
      } catch (error) {
        console.error('[WORLD] Failed to sync changes with server:', error);
      }
    };
    
    // Debounce the sync to avoid too many requests
    const timer = setTimeout(syncChanges, 2000);
    return () => clearTimeout(timer);
  }, [pendingChanges, worldId]);
  
  // Handle block click (remove block)
  const handleBlockClick = useCallback((block: Block, face: number) => {
    // Verify the player is close enough to break this block (distance check)
    const playerPos = new Vector3(camera.position.x, camera.position.y, camera.position.z);
    const blockCenter = new Vector3(block.x + 0.5, block.y + 0.5, block.z + 0.5);
    const distance = playerPos.distanceTo(blockCenter);
    
    // Define maximum interaction distance - should match the one in BlockInteraction.tsx
    const MAX_BREAK_DISTANCE = 5;
    
    if (distance > MAX_BREAK_DISTANCE) {
      if (DEBUG_BLOCK_CHANGES) {
        console.log(`[WORLD] Cannot break block at ${block.x},${block.y},${block.z} - too far away (${distance.toFixed(2)} > ${MAX_BREAK_DISTANCE})`);
      }
      return;
    }

    if (DEBUG_BLOCK_CHANGES) {
      console.log(`[WORLD] Breaking block at ${block.x}, ${block.y}, ${block.z}, distance: ${distance.toFixed(2)}`);
    }
    
    const change: BlockChange = {
      ...block,
      action: 'remove'
    };
    
    setChanges(prev => [...prev, change]);
    setPendingChanges(prev => [...prev, change]);
  }, [camera.position]);
  
  // Handle block right click (place block)
  const handleBlockRightClick = useCallback((block: Block, face: number) => {
    // Calculate the position of the new block based on the face
    const faceDirections = [
      [1, 0, 0],  // right
      [-1, 0, 0], // left
      [0, 1, 0],  // top
      [0, -1, 0], // bottom
      [0, 0, 1],  // front
      [0, 0, -1], // back
    ];
    
    // Ensure face index is valid
    const validFace = Math.min(Math.max(0, face), 5);
    const dir = faceDirections[validFace];
    
    if (!dir) {
      console.error(`[WORLD] Invalid face index: ${face}`);
      return;
    }
    
    const newPosition = {
      x: block.x + dir[0],
      y: block.y + dir[1],
      z: block.z + dir[2],
    };
    
    if (DEBUG_BLOCK_CHANGES) {
      console.log(`[WORLD] Attempting to place ${selectedBlock} at ${newPosition.x}, ${newPosition.y}, ${newPosition.z}, from face ${validFace}`);
    }
    
    // Check if there's already a block at this position - check all chunks
    const blockKey = makeBlockKey(newPosition.x, newPosition.y, newPosition.z);
    let blockExists = false;
    
    // Check in loaded chunks
    for (const chunk of loadedChunks.current.values()) {
      if (chunk.blocks.some(b => 
        b.x === newPosition.x && b.y === newPosition.y && b.z === newPosition.z
      )) {
        blockExists = true;
        break;
      }
    }
    
    // Check in changes
    const pendingBlockExists = changes.some(change => 
      change.action === 'place' && 
      change.x === newPosition.x && 
      change.y === newPosition.y && 
      change.z === newPosition.z &&
      // Make sure it hasn't been removed after being placed
      !changes.some(removeChange => 
        removeChange.action === 'remove' &&
        removeChange.x === newPosition.x && 
        removeChange.y === newPosition.y && 
        removeChange.z === newPosition.z &&
        changes.indexOf(removeChange) > changes.indexOf(change)
      )
    );
    
    // Also check if position is part of a player or would block the player
    const playerPosition = {
      x: Math.floor(camera.position.x),
      y: Math.floor(camera.position.y),
      z: Math.floor(camera.position.z)
    };
    
    const wouldBlockPlayer = 
      (newPosition.x === playerPosition.x && 
       newPosition.y === playerPosition.y && 
       newPosition.z === playerPosition.z) ||
      (newPosition.x === playerPosition.x && 
       newPosition.y === playerPosition.y + 1 && 
       newPosition.z === playerPosition.z);
    
    if (!blockExists && !pendingBlockExists && !wouldBlockPlayer) {
      const change: BlockChange = {
        ...newPosition,
        type: selectedBlock as any,
        action: 'place'
      };
      
      if (DEBUG_BLOCK_CHANGES) {
        console.log(`[WORLD] Placing ${selectedBlock} block at ${newPosition.x}, ${newPosition.y}, ${newPosition.z}`);
      }
      
      setChanges(prev => [...prev, change]);
      setPendingChanges(prev => [...prev, change]);
    } else {
      if (DEBUG_BLOCK_CHANGES) {
        console.log(`[WORLD] Cannot place block at ${newPosition.x}, ${newPosition.y}, ${newPosition.z} - ${
          blockExists ? 'space already occupied' : 
          pendingBlockExists ? 'pending block exists' : 
          'would block player'
        }`);
      }
    }
  }, [selectedBlock, changes, camera.position]);
  
  // Debug stats display
  useFrame(() => {
    frameCount.current++;
    
    // Show debug info every 300 frames (about every 5 seconds at 60fps)
    if (frameCount.current % 300 === 0) {
      console.log(`[WORLD] Stats: ${chunkMetrics.current.visibleChunkCount} chunks visible, ${chunkMetrics.current.totalLoadedChunks} chunks loaded, ${chunkMetrics.current.blockChangesCount} block changes`);
    }
  });
  
  // Render the world
  return (
    <>
      {/* Lighting setup */}
      <ambientLight intensity={0.5} />
      <directionalLight 
        position={[50, 100, 50]} 
        intensity={1} 
        castShadow 
        shadow-mapSize-width={1024} 
        shadow-mapSize-height={1024}
        shadow-camera-far={200}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />
      
      {/* Render chunks */}
      {chunks.map((chunk) => {
        // Make sure each chunk has x, y, z properties
        const chunkX = chunk.x ?? chunk.position.x;
        const chunkY = chunk.y ?? chunk.position.y;
        const chunkZ = chunk.z ?? chunk.position.z;
        
        return (
          <Chunk
            key={`${chunkX},${chunkY},${chunkZ}`}
            chunk={{
              x: chunkX,
              y: chunkY,
              z: chunkZ,
              blocks: chunk.blocks,
              position: {
                x: chunkX,
                y: chunkY,
                z: chunkZ
              }
            }}
            onBlockClick={handleBlockClick}
            onBlockRightClick={handleBlockRightClick}
          />
        );
      })}
    </>
  );
};

export default World; 