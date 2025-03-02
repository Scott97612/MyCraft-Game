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

const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 3; // Chunks in each direction

const World: React.FC<WorldProps> = ({ worldId, seed, initialChanges, selectedBlock }) => {
  const { camera, scene } = useThree();
  const [chunks, setChunks] = useState<ChunkData[]>([]);
  const [changes, setChanges] = useState<BlockChange[]>(initialChanges || []);
  const [pendingChanges, setPendingChanges] = useState<BlockChange[]>([]);
  const [terrainGenerator, setTerrainGenerator] = useState<TerrainGenerator | null>(null);
  const [isInitialChunksLoaded, setIsInitialChunksLoaded] = useState(false);
  const [useInstancing, setUseInstancing] = useState(true); // Enable GPU instancing by default
  
  // Refs for performance tracking
  const lastCheckedPosition = useRef<Vector3>(new Vector3(0, 0, 0));
  const loadedChunks = useRef<Set<string>>(new Set());
  const isChunkGenerationInProgress = useRef(false);
  const lastFrameTime = useRef(performance.now());
  const frameCount = useRef(0);
  
  // Track chunk generation metrics
  const chunkMetrics = useRef({
    lastGenerationTime: 0,
    generationsInLastSecond: 0,
    totalGeneratedChunks: 0
  });
  
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
      generateInitialChunks(generator);
    } catch (error) {
      console.error("[TERRAIN] Error initializing terrain generator:", error);
    }
  }, [seed]);
  
  // Function to generate initial chunks around the origin
  const generateInitialChunks = useCallback((generator: TerrainGenerator) => {
    if (isInitialChunksLoaded) return;
    
    console.log("[DEBUG] Generating initial chunks...");
    const initialChunks: ChunkData[] = [];
    
    // Generate chunks around the player's starting position
    const startX = Math.floor(0 / CHUNK_SIZE);
    const startY = Math.floor(20 / CHUNK_SIZE);
    const startZ = Math.floor(0 / CHUNK_SIZE);
    
    // Only generate a minimal set of chunks for startup
    // Just generate one layer at the player's level
    for (let x = startX - 1; x <= startX + 1; x++) {
      for (let z = startZ - 1; z <= startZ + 1; z++) {
        const chunkKey = `${x},${startY},${z}`;
        if (!loadedChunks.current.has(chunkKey)) {
          console.log(`[DEBUG] Generating initial chunk at ${chunkKey}`);
          try {
            const chunk = generator.generateChunk(x, startY, z, CHUNK_SIZE);
            initialChunks.push(chunk);
            loadedChunks.current.add(chunkKey);
          } catch (error) {
            console.error(`[DEBUG] Error generating chunk at ${chunkKey}:`, error);
          }
        }
      }
    }
    
    if (initialChunks.length > 0) {
      setChunks(initialChunks);
      setIsInitialChunksLoaded(true);
      console.log(`[DEBUG] Generated ${initialChunks.length} initial chunks`);
    }
  }, [isInitialChunksLoaded]);
  
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
  
  // Generate or load a single chunk
  const loadChunk = useCallback((chunkX: number, chunkY: number, chunkZ: number) => {
    if (!terrainGenerator) return null;
    
    const chunkKey = getChunkKey(chunkX, chunkY, chunkZ);
    
    // Skip if already loaded
    if (loadedChunks.current.has(chunkKey)) {
      return null;
    }
    
    // Track generation metrics
    chunkMetrics.current.generationsInLastSecond++;
    chunkMetrics.current.totalGeneratedChunks++;
    
    console.log(`[DEBUG] Generating chunk at ${chunkKey}`);
    
    // Generate the chunk
    const chunk = terrainGenerator.generateChunk(chunkX, chunkY, chunkZ, CHUNK_SIZE);
    loadedChunks.current.add(chunkKey);
    return chunk;
  }, [terrainGenerator, getChunkKey]);
  
  // Check for needed chunks dynamically as player moves
  useFrame(() => {
    // Throttle CPU usage by limiting frame rate when not moving
    const now = performance.now();
    const frameTime = now - lastFrameTime.current;
    lastFrameTime.current = now;
    frameCount.current++;
    
    // Log frame times occasionally
    if (frameCount.current % 300 === 0) {
      console.log(`[FRAME] Average frame time: ${frameTime.toFixed(2)}ms, loaded chunks: ${chunks.length}`);
    }
    
    if (!terrainGenerator || !isInitialChunksLoaded || isChunkGenerationInProgress.current) return;
    
    // Check every 10 blocks moved
    const playerPos = new Vector3(camera.position.x, camera.position.y, camera.position.z);
    if (playerPos.distanceTo(lastCheckedPosition.current) < 10) {
      return;
    }
    
    // Lock chunk generation to prevent multiple concurrent updates
    isChunkGenerationInProgress.current = true;
    
    // Update last checked position
    lastCheckedPosition.current.copy(playerPos);
    
    // Get player's chunk coordinates
    const playerChunk = getChunkCoords(playerPos.x, playerPos.y, playerPos.z);
    
    // Determine which chunks need to be loaded
    const newChunks: ChunkData[] = [];
    
    // Limit the number of chunks we process per frame to prevent lag
    let chunksToProcess = 0;
    const MAX_CHUNKS_PER_FRAME = 3;
    
    for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
      if (chunksToProcess >= MAX_CHUNKS_PER_FRAME) break;
      
      for (let y = -1; y <= RENDER_DISTANCE; y++) {
        if (chunksToProcess >= MAX_CHUNKS_PER_FRAME) break;
        
        for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
          if (chunksToProcess >= MAX_CHUNKS_PER_FRAME) break;
          
          const chunkX = playerChunk.x + x;
          const chunkY = playerChunk.y + y;
          const chunkZ = playerChunk.z + z;
          
          const chunkKey = getChunkKey(chunkX, chunkY, chunkZ);
          
          // Skip if already loaded
          if (loadedChunks.current.has(chunkKey)) continue;
          
          // Prioritize chunks closer to the player
          const distance = Math.sqrt(x * x + y * y + z * z);
          if (distance > RENDER_DISTANCE) continue;
          
          const newChunk = loadChunk(chunkX, chunkY, chunkZ);
          if (newChunk) {
            newChunks.push(newChunk);
            chunksToProcess++;
          }
        }
      }
    }
    
    // Only update state if there are new chunks
    if (newChunks.length > 0) {
      console.log(`Loaded ${newChunks.length} new chunks`);
      setChunks(prev => [...prev, ...newChunks]);
    }
    
    // Unlock chunk generation
    isChunkGenerationInProgress.current = false;
  });
  
  // Apply changes to chunks efficiently
  useEffect(() => {
    if (changes.length === 0) return;
    
    // Create a map to collect changes by chunk
    const chunkChanges = new Map<string, { add: Block[], remove: Set<string> }>();
    
    // Process each change and organize by chunk
    changes.forEach(change => {
      const { x, y, z } = change;
      const chunkX = Math.floor(x / CHUNK_SIZE);
      const chunkY = Math.floor(y / CHUNK_SIZE);
      const chunkZ = Math.floor(z / CHUNK_SIZE);
      
      const chunkKey = getChunkKey(chunkX, chunkY, chunkZ);
      
      if (!chunkChanges.has(chunkKey)) {
        chunkChanges.set(chunkKey, { add: [], remove: new Set() });
      }
      
      const blockKey = `${x},${y},${z}`;
      const chunkChange = chunkChanges.get(chunkKey)!;
      
      if (change.action === 'remove') {
        chunkChange.remove.add(blockKey);
      } else if (change.action === 'place') {
        chunkChange.add.push({
          x, y, z, type: change.type as any
        });
      }
    });
    
    // Apply changes to chunks
    setChunks(prevChunks => {
      const updatedChunks = [...prevChunks];
      
      chunkChanges.forEach((changes, chunkKey) => {
        const [x, y, z] = chunkKey.split(',').map(Number);
        
        // Find the chunk to update
        const chunkIndex = updatedChunks.findIndex(
          c => c.position.x === x && c.position.y === y && c.position.z === z
        );
        
        if (chunkIndex !== -1) {
          const chunk = { ...updatedChunks[chunkIndex] };
          
          // Remove blocks
          if (changes.remove.size > 0) {
            chunk.blocks = chunk.blocks.filter(b => 
              !changes.remove.has(`${b.x},${b.y},${b.z}`)
            );
          }
          
          // Add blocks
          if (changes.add.length > 0) {
            const existingBlockKeys = new Set(
              chunk.blocks.map(b => `${b.x},${b.y},${b.z}`)
            );
            
            const newBlocks = changes.add.filter(b => 
              !existingBlockKeys.has(`${b.x},${b.y},${b.z}`)
            );
            
            chunk.blocks = [...chunk.blocks, ...newBlocks];
          }
          
          updatedChunks[chunkIndex] = chunk;
        }
      });
      
      return updatedChunks;
    });
  }, [changes, getChunkKey]);
  
  // Sync changes with server with debounce
  useEffect(() => {
    if (pendingChanges.length === 0) return;
    
    const syncChanges = async () => {
      try {
        await updateWorldChanges(worldId, pendingChanges);
        // Clear pending changes after successful sync
        setPendingChanges([]);
      } catch (error) {
        console.error('Failed to sync changes with server:', error);
      }
    };
    
    // Debounce the sync to avoid too many requests
    const timer = setTimeout(syncChanges, 2000);
    return () => clearTimeout(timer);
  }, [pendingChanges, worldId]);
  
  // Handle block click (remove block) with throttling
  const handleBlockClick = useCallback((block: Block, face: number) => {
    const change: BlockChange = {
      ...block,
      action: 'remove'
    };
    
    setChanges(prev => [...prev, change]);
    setPendingChanges(prev => [...prev, change]);
  }, []);
  
  // Handle block right click (place block) with throttling
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
    
    const dir = faceDirections[face];
    const newPosition = {
      x: block.x + dir[0],
      y: block.y + dir[1],
      z: block.z + dir[2],
    };
    
    // Check if there's already a block at this position
    const blockExists = chunks.some(chunk => 
      chunk.blocks.some(b => 
        b.x === newPosition.x && b.y === newPosition.y && b.z === newPosition.z
      )
    );
    
    if (!blockExists) {
      const change: BlockChange = {
        ...newPosition,
        type: selectedBlock as any,
        action: 'place'
      };
      
      setChanges(prev => [...prev, change]);
      setPendingChanges(prev => [...prev, change]);
    }
  }, [chunks, selectedBlock]);
  
  // Add to useFrame hook or create one if it doesn't exist
  useFrame(() => {
    // Monitor for excessive chunk generation
    const now = performance.now();
    if (now - chunkMetrics.current.lastGenerationTime > 1000) {
      if (chunkMetrics.current.generationsInLastSecond > 10) {
        console.warn(`[DEBUG] Excessive chunk generation: ${chunkMetrics.current.generationsInLastSecond} chunks in the last second`);
      }
      chunkMetrics.current.generationsInLastSecond = 0;
      chunkMetrics.current.lastGenerationTime = now;
    }
    
    // Additional debug info every 5 seconds
    if (Math.floor(now / 5000) > Math.floor(chunkMetrics.current.lastGenerationTime / 5000)) {
      console.log(`[DEBUG] World stats: ${chunks.length} chunks loaded, ${chunkMetrics.current.totalGeneratedChunks} total chunks generated, ${changes.length} block changes`);
    }
  });
  
  // Add a function to efficiently render chunks using instancing
  const renderChunksEfficiently = useCallback(() => {
    // We'll simplify this and just use the Chunk component which already handles instancing
    return chunks.map((chunk) => (
      <Chunk
        key={`${chunk.position.x},${chunk.position.y},${chunk.position.z}`}
        chunk={chunk}
        onBlockClick={handleBlockClick}
        onBlockRightClick={handleBlockRightClick}
      />
    ));
  }, [chunks, handleBlockClick, handleBlockRightClick]);
  
  return (
    <>
      {/* Use a more efficient lighting setup */}
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
      
      {/* Render chunks using efficient method for GPU utilization */}
      {renderChunksEfficiently()}
    </>
  );
};

export default World; 