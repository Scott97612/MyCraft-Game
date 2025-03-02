import { createNoise2D, createNoise3D, NoiseFunction2D, NoiseFunction3D } from 'simplex-noise';
import { BlockType } from './types';

export class TerrainGenerator {
  private noise2D: NoiseFunction2D;
  private noise3D: NoiseFunction3D;
  private seed: string;

  constructor(seed: string) {
    this.seed = seed;
    // Initialize noise generators with seed
    const seedNum = this.hashSeed(seed);
    this.noise2D = createNoise2D(() => seedNum);
    this.noise3D = createNoise3D(() => seedNum);
  }

  // Convert string seed to a number
  private hashSeed(seed: string): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) / 2147483647; // Normalize to 0-1
  }

  // Generate the height at a given x, z coordinate
  public getHeight(x: number, z: number): number {
    try {
      // Calculate base terrain height (hills and valleys)
      const scale1 = 0.01;
      const scale2 = 0.05;
      const scale3 = 0.2;
      
      // Check for invalid coordinates
      if (!isFinite(x) || !isFinite(z) || isNaN(x) || isNaN(z)) {
        console.error(`[TERRAIN] Invalid coordinates: x=${x}, z=${z}`);
        return 10; // Default height
      }
      
      const elevation = 
        (this.noise2D(x * scale1, z * scale1) * 0.7 + 0.7) * 10 + // Large hills
        (this.noise2D(x * scale2, z * scale2) * 0.3) * 5 + // Medium details
        (this.noise2D(x * scale3, z * scale3) * 0.1) * 2; // Small details
      
      // Validate the result
      if (isNaN(elevation) || !isFinite(elevation)) {
        console.error(`[TERRAIN] Invalid elevation calculated for x=${x}, z=${z}: ${elevation}`);
        return 10; // Default height
      }
      
      return Math.floor(elevation) + 10; // Add base height and round to integer
    } catch (error) {
      console.error(`[TERRAIN] Error generating height at x=${x}, z=${z}:`, error);
      return 10; // Default fallback height
    }
  }

  // Determine block type at a given position
  public getBlockType(x: number, y: number, z: number): BlockType | null {
    const terrainHeight = this.getHeight(x, z);
    
    // Air above ground
    if (y > terrainHeight) {
      // Water level
      if (y <= 12 && terrainHeight < 12) {
        return 'water';
      }
      return null;
    }
    
    // Ground blocks
    if (y === terrainHeight) {
      // Determine surface block based on height and some noise
      const surfaceNoise = this.noise3D(x * 0.1, y * 0.1, z * 0.1);
      
      if (terrainHeight > 15) {
        return surfaceNoise > 0.2 ? 'stone' : 'grass';
      } else if (terrainHeight > 12) {
        return surfaceNoise > 0.3 ? 'dirt' : 'grass';
      } else {
        return 'sand';
      }
    }
    
    // Underground blocks
    if (y < terrainHeight - 3) {
      return 'stone';
    } else {
      return 'dirt';
    }
  }

  // Generate a chunk of blocks at a given position
  public generateChunk(chunkX: number, chunkY: number, chunkZ: number, chunkSize: number) {
    const blocks = [];
    const startX = chunkX * chunkSize;
    const startY = chunkY * chunkSize;
    const startZ = chunkZ * chunkSize;
    
    for (let x = 0; x < chunkSize; x++) {
      for (let z = 0; z < chunkSize; z++) {
        const worldX = startX + x;
        const worldZ = startZ + z;
        const maxHeight = Math.min(this.getHeight(worldX, worldZ), startY + chunkSize);
        
        for (let y = 0; y < chunkSize; y++) {
          const worldY = startY + y;
          
          if (worldY <= maxHeight) {
            const blockType = this.getBlockType(worldX, worldY, worldZ);
            if (blockType) {
              blocks.push({
                x: worldX,
                y: worldY,
                z: worldZ,
                type: blockType
              });
            }
          }
        }
      }
    }
    
    return {
      position: { x: chunkX, y: chunkY, z: chunkZ },
      blocks
    };
  }
} 