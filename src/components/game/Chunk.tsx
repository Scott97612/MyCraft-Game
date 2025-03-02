import { useMemo, useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { Block, ChunkData } from '../../utils/types';
import BlockComponent from './Block';
import { InstancedMesh, Object3D, Matrix4, BoxGeometry, MeshStandardMaterial } from 'three';
import { getTexture, getBlockMaterials } from '../../utils/textures';
import React from 'react';

interface ChunkProps {
  chunk: ChunkData;
  onBlockClick: (block: Block, face: number) => void;
  onBlockRightClick: (block: Block, face: number) => void;
}

// Configuration
const CHUNK_SIZE = 16;
const MAX_VISIBLE_DISTANCE = 32; // Maximum distance to render chunks
const BLOCK_CULL_DISTANCE = 48; // Maximum distance to render individual blocks
const USE_INSTANCING = true; // Enable GPU instancing for better performance

const Chunk: React.FC<ChunkProps> = ({ chunk, onBlockClick, onBlockRightClick }) => {
  const { camera } = useThree();

  // Determine if chunk is visible based on distance from camera
  const visibilityData = useMemo(() => {
    // Calculate chunk center
    const chunkCenterX = chunk.position.x * CHUNK_SIZE + CHUNK_SIZE / 2;
    const chunkCenterY = chunk.position.y * CHUNK_SIZE + CHUNK_SIZE / 2;
    const chunkCenterZ = chunk.position.z * CHUNK_SIZE + CHUNK_SIZE / 2;
    
    // Calculate distance to camera
    const distanceSquared = 
      Math.pow(camera.position.x - chunkCenterX, 2) +
      Math.pow(camera.position.y - chunkCenterY, 2) +
      Math.pow(camera.position.z - chunkCenterZ, 2);
    
    // Only render chunks within visible range
    const isChunkVisible = distanceSquared < MAX_VISIBLE_DISTANCE * MAX_VISIBLE_DISTANCE;
    
    return {
      isChunkVisible,
      chunkCenter: [chunkCenterX, chunkCenterY, chunkCenterZ],
      distanceSquared,
    };
  }, [chunk.position, camera.position]);
  
  // If the entire chunk is too far away, don't render anything
  if (!visibilityData.isChunkVisible) {
    return null;
  }
  
  // Memoize the blocks to avoid unnecessary re-renders
  const renderedContent = useMemo(() => {
    if (USE_INSTANCING) {
      // Group blocks by type for instanced rendering
      const blocksByType = new Map<string, Block[]>();
      
      chunk.blocks.forEach(block => {
        // Calculate distance from block to camera for block-level culling
        const distanceSquared = 
          Math.pow(camera.position.x - block.x, 2) +
          Math.pow(camera.position.y - block.y, 2) +
          Math.pow(camera.position.z - block.z, 2);
          
        // Skip blocks that are too far away (more aggressive culling)
        if (distanceSquared > BLOCK_CULL_DISTANCE * BLOCK_CULL_DISTANCE) {
          return;
        }
        
        if (!blocksByType.has(block.type)) {
          blocksByType.set(block.type, []);
        }
        
        blocksByType.get(block.type)!.push(block);
      });
      
      // Render each block type as a single instanced mesh
      return Array.from(blocksByType.entries()).map(([blockType, blocks]) => {
        // Skip if no blocks of this type
        if (blocks.length === 0) return null;
        
        // Return the instanced blocks component for this type
        return (
          <InstancedBlocks 
            key={blockType}
            blockType={blockType as BlockType}
            blocks={blocks}
            onBlockClick={onBlockClick}
            onBlockRightClick={onBlockRightClick}
          />
        );
      });
    } else {
      // Fallback to traditional rendering if instancing disabled
      return chunk.blocks
        .filter(block => {
          // Calculate distance from block to camera
          const distanceSquared = 
            Math.pow(camera.position.x - block.x, 2) +
            Math.pow(camera.position.y - block.y, 2) +
            Math.pow(camera.position.z - block.z, 2);
            
          // Only render blocks within view distance
          return distanceSquared <= BLOCK_CULL_DISTANCE * BLOCK_CULL_DISTANCE;
        })
        .map(block => (
          <BlockComponent
            key={`${block.x},${block.y},${block.z}`}
            position={[block.x, block.y, block.z]}
            type={block.type}
            onClick={(e) => {
              e.stopPropagation();
              onBlockClick(block, Math.floor(e.faceIndex / 2));
            }}
            onContextMenu={(e) => {
              e.stopPropagation();
              onBlockRightClick(block, Math.floor(e.faceIndex / 2));
            }}
          />
        ));
    }
  }, [chunk, camera.position, onBlockClick, onBlockRightClick]);
  
  return <>{renderedContent}</>;
};

// Separate component for instanced rendering
interface InstancedBlocksProps {
  blockType: BlockType;
  blocks: Block[];
  onBlockClick: (block: Block, face: number) => void;
  onBlockRightClick: (block: Block, face: number) => void;
}

const InstancedBlocks: React.FC<InstancedBlocksProps> = ({ 
  blockType, blocks, onBlockClick, onBlockRightClick 
}) => {
  const meshRef = useRef<InstancedMesh>(null);
  const tempObject = useMemo(() => new Object3D(), []);
  
  // Set up the matrices for each block instance
  useEffect(() => {
    if (!meshRef.current) return;
    
    blocks.forEach((block, i) => {
      tempObject.position.set(block.x, block.y, block.z);
      tempObject.updateMatrix();
      meshRef.current!.setMatrixAt(i, tempObject.matrix);
    });
    
    // Important: let Three.js know to update the matrices
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [blocks, tempObject]);
  
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), []);
  
  // Get material for this block type
  const materials = useMemo(() => {
    return getBlockMaterials(blockType);
  }, [blockType]);
  
  return (
    <instancedMesh 
      ref={meshRef}
      args={[geometry, undefined, blocks.length]}
      material={materials[0]} // Use first material for simplicity
      onClick={(e) => {
        if (e.instanceId === undefined) return;
        onBlockClick(blocks[e.instanceId], Math.floor(e.faceIndex! / 2));
      }}
      onContextMenu={(e) => {
        if (e.instanceId === undefined) return;
        onBlockRightClick(blocks[e.instanceId], Math.floor(e.faceIndex! / 2));
      }}
    />
  );
};

// Use React.memo to prevent unnecessary re-renders
export default React.memo(Chunk); 