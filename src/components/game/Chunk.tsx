import React, { useRef, useMemo, useEffect, useCallback } from 'react';
import { MeshStandardMaterial, InstancedMesh, Object3D, Color } from 'three';
import { useFrame } from '@react-three/fiber';
import { Block, BlockType, ChunkData } from '../../utils/types';
import { getTexture } from '../../utils/textures';

// Debug flags
const DEBUG_CHUNK_RENDERING = false;
const DEBUG_BLOCK_INTERACTION = false;

interface ChunkProps {
  chunk: ChunkData;
  onBlockClick: (block: Block, face: number) => void;
  onBlockRightClick: (block: Block, face: number) => void;
}

// Type for Three.js intersection events
interface ThreeEvent {
  instanceId?: number;
  faceIndex?: number;
  stopPropagation: () => void;
}

/**
 * A chunk of blocks in the world (16x16x16)
 */
const Chunk: React.FC<ChunkProps> = ({ chunk, onBlockClick, onBlockRightClick }) => {
  const chunkRef = useRef<Object3D>(null);
  const lastPosition = useRef<string>('');
  const initialized = useRef<boolean>(false);
  
  // Track chunk updates
  const chunkKey = `${chunk.position.x},${chunk.position.y},${chunk.position.z}`;
  const blockCount = chunk.blocks.length;
  
  // Group blocks by type for efficient instanced rendering
  const blocksByType = useMemo(() => {
    const result: { [key in BlockType]?: Block[] } = {};
    
    chunk.blocks.forEach(block => {
      if (!result[block.type]) {
        result[block.type] = [];
      }
      result[block.type]?.push(block);
    });
    
    if (DEBUG_CHUNK_RENDERING) {
      console.log(`[CHUNK] Chunk ${chunkKey} has ${blockCount} blocks, ${Object.keys(result).length} types`);
    }
    
    return result;
  }, [chunk, chunkKey, blockCount]);
  
  // Log chunk unmounting
  useEffect(() => {
    return () => {
      if (DEBUG_CHUNK_RENDERING) {
        console.log(`[CHUNK] Unmounting chunk ${chunkKey} (had ${blockCount} blocks)`);
      }
    };
  }, [chunkKey, blockCount]);
  
  // Update position on first render
  useEffect(() => {
    const posKey = `${chunk.position.x},${chunk.position.y},${chunk.position.z}`;
    if (posKey !== lastPosition.current) {
      if (DEBUG_CHUNK_RENDERING) {
        console.log(`[CHUNK] Chunk position updated: ${posKey}`);
      }
      lastPosition.current = posKey;
    }
    
    if (!initialized.current) {
      if (DEBUG_CHUNK_RENDERING) {
        console.log(`[CHUNK] Chunk ${chunkKey} initialized with ${blockCount} blocks`);
      }
      initialized.current = true;
    }
  }, [chunk.position.x, chunk.position.y, chunk.position.z, chunkKey, blockCount]);
  
  // Main render - a group containing all instanced block types
  return (
    <group 
      ref={chunkRef} 
      position={[chunk.position.x * 16, chunk.position.y * 16, chunk.position.z * 16]}
      userData={{ 
        chunkKey,
        blockCount,
        chunkPosition: [chunk.position.x, chunk.position.y, chunk.position.z] 
      }}
    >
      {/* Render each block type using instanced meshes */}
      {Object.entries(blocksByType).map(([type, blocks]) => (
        <InstancedBlocks
          key={`${type}-${blocks.length}`}
          blockType={type as BlockType}
          blocks={blocks}
          onBlockClick={onBlockClick}
          onBlockRightClick={onBlockRightClick}
        />
      ))}
    </group>
  );
};

interface InstancedBlocksProps {
  blockType: BlockType;
  blocks: Block[];
  onBlockClick: (block: Block, face: number) => void;
  onBlockRightClick: (block: Block, face: number) => void;
}

/**
 * Renders a group of blocks of the same type using instanced mesh
 * Optimized for performance with proper data tracking
 */
const InstancedBlocks: React.FC<InstancedBlocksProps> = ({ 
  blockType, blocks, onBlockClick, onBlockRightClick 
}) => {
  const meshRef = useRef<InstancedMesh>(null);
  const tempObject = useMemo(() => new Object3D(), []);
  const nextUpdateRef = useRef<number>(0);
  const blocksDirty = useRef<boolean>(true);
  
  // Keep track of the previous blocks to detect changes
  const prevBlocksRef = useRef<Block[]>([]);
  
  // Maps instanceId to block index for fast lookups during interaction
  const instanceToBlockMap = useRef<Map<number, number>>(new Map());
  
  // Precompute block colors by type (for debugging/variation)
  const blockColor = useMemo(() => {
    switch (blockType) {
      case 'grass': return new Color(0.2, 0.8, 0.2);
      case 'dirt': return new Color(0.6, 0.3, 0.1);
      case 'stone': return new Color(0.5, 0.5, 0.5);
      case 'wood': return new Color(0.6, 0.4, 0.2);
      case 'leaves': return new Color(0.0, 0.7, 0.0);
      case 'water': return new Color(0.0, 0.3, 0.8);
      case 'sand': return new Color(0.9, 0.9, 0.5);
      default: return new Color(1, 1, 1);
    }
  }, [blockType]);
  
  // Get the texture for this block type
  const texture = useMemo(() => {
    return getTexture(blockType);
  }, [blockType]);
  
  // Set up material with the correct texture
  const material = useMemo(() => {
    const mat = new MeshStandardMaterial({ 
      map: texture,
      color: blockColor,
      transparent: blockType === 'water' || blockType === 'glass',
      opacity: blockType === 'water' ? 0.6 : blockType === 'glass' ? 0.7 : 1.0,
    });
    return mat;
  }, [texture, blockType, blockColor]);
  
  // Handle regular mesh click
  const handleBlockClick = useCallback((event: ThreeEvent) => {
    event.stopPropagation();
    
    if (!meshRef.current) return;
    
    // Get the instance ID that was clicked
    const instanceId = event.instanceId;
    
    if (instanceId === undefined) {
      if (DEBUG_BLOCK_INTERACTION) {
        console.log("[BLOCK CLICK] No instanceId on click event", event);
      }
      return;
    }
    
    // Find the block using the instance map
    const blockIndex = instanceToBlockMap.current.get(instanceId);
    if (blockIndex === undefined || blockIndex < 0 || blockIndex >= blocks.length) {
      if (DEBUG_BLOCK_INTERACTION) {
        console.log(`[BLOCK CLICK] Invalid block index ${blockIndex} from instanceId ${instanceId}`);
      }
      return;
    }
    
    const block = blocks[blockIndex];
    
    if (!block) {
      if (DEBUG_BLOCK_INTERACTION) {
        console.log(`[BLOCK CLICK] Cannot find block from instanceId ${instanceId}, block index ${blockIndex}`);
      }
      return;
    }
    
    // Get face information - default to 0 if missing
    const faceIndex = event.faceIndex !== undefined ? Math.floor(event.faceIndex / 2) : 0;
    
    if (DEBUG_BLOCK_INTERACTION) {
      console.log(`[BLOCK CLICK] Block clicked: ${blockType} at ${block.x},${block.y},${block.z}, face: ${faceIndex}`);
    }
    
    onBlockClick(block, faceIndex);
  }, [blocks, blockType, onBlockClick]);
  
  // Handle right click for block placement
  const handleBlockRightClick = useCallback((event: ThreeEvent) => {
    event.stopPropagation();
    
    if (!meshRef.current) return;
    
    // Similar to left click but for right-click placement
    const instanceId = event.instanceId;
    
    if (instanceId === undefined) return;
    
    const blockIndex = instanceToBlockMap.current.get(instanceId);
    if (blockIndex === undefined || blockIndex < 0 || blockIndex >= blocks.length) return;
    
    const block = blocks[blockIndex];
    if (!block) return;
    
    const faceIndex = event.faceIndex !== undefined ? Math.floor(event.faceIndex / 2) : 0;
    
    if (DEBUG_BLOCK_INTERACTION) {
      console.log(`[BLOCK RIGHT CLICK] Block right-clicked: ${blockType} at ${block.x},${block.y},${block.z}, face: ${faceIndex}`);
    }
    
    onBlockRightClick(block, faceIndex);
  }, [blocks, blockType, onBlockRightClick]);
  
  // Update instance matrices whenever blocks change
  useEffect(() => {
    // Detect if blocks array has actually changed
    const prevBlocks = prevBlocksRef.current;
    let hasChanged = prevBlocks.length !== blocks.length;
    
    if (!hasChanged) {
      // Check if any individual blocks have changed
      for (let i = 0; i < blocks.length; i++) {
        if (i >= prevBlocks.length || 
            blocks[i].x !== prevBlocks[i].x || 
            blocks[i].y !== prevBlocks[i].y || 
            blocks[i].z !== prevBlocks[i].z ||
            blocks[i].type !== prevBlocks[i].type) {
          hasChanged = true;
          break;
        }
      }
    }
    
    if (hasChanged) {
      // Mark blocks as dirty to trigger a re-render
      blocksDirty.current = true;
      // Store the new blocks for future comparison
      prevBlocksRef.current = [...blocks];
      
      if (DEBUG_CHUNK_RENDERING) {
        console.log(`[CHUNK] Block array changed for ${blockType}, now has ${blocks.length} blocks`);
      }
    }
  }, [blocks, blockType]);
  
  // Apply changes to the instanced mesh
  useFrame(() => {
    // Only update if needed
    if (!blocksDirty.current || !meshRef.current) return;
    
    // Skip if too early for next update (rate limiting)
    const now = Date.now();
    if (now < nextUpdateRef.current) return;
    
    // Set the next update time
    nextUpdateRef.current = now + 50; // 50ms = max 20 updates per second
    
    // Clear the current instance to block mapping
    instanceToBlockMap.current.clear();
    
    // Set up each instance
    blocks.forEach((block, index) => {
      tempObject.position.set(block.x % 16, block.y % 16, block.z % 16);
      tempObject.updateMatrix();
      
      if (meshRef.current) {
        // Set instance matrix
        meshRef.current.setMatrixAt(index, tempObject.matrix);
        
        // Store the mapping from instance ID to block index
        instanceToBlockMap.current.set(index, index);
      }
    });
    
    // Tell Three.js to update the matrix data
    if (meshRef.current) {
      meshRef.current.instanceMatrix.needsUpdate = true;
      
      // Store block data in the mesh for raycasting
      meshRef.current.userData.blocks = blocks;
      meshRef.current.userData.blockType = blockType;
      meshRef.current.userData.blockCount = blocks.length;
      
      if (DEBUG_CHUNK_RENDERING) {
        console.log(`[CHUNK] Updated instanced mesh for ${blockType}, ${blocks.length} blocks`);
      }
    }
    
    // Mark as clean until next change
    blocksDirty.current = false;
  });
  
  // Don't render empty instances
  if (blocks.length === 0) {
    return null;
  }
  
  // Render the instanced mesh
  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, blocks.length]}
      material={material}
      onClick={handleBlockClick}
      onContextMenu={handleBlockRightClick}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  );
};

export default Chunk; 